#!/usr/bin/env bash
# Build, test, run locally, push and deploy duskbloods.build to Cloud Run.
#
#   ./deploy.sh test      run the unit tests inside Docker
#   ./deploy.sh build     build the production image (runs tests first)
#   ./deploy.sh local     build and run the container at http://localhost:8080 (live sheet; SAMPLE=1 for sample data)
#   ./deploy.sh smoke     build, start the container, check every page type responds, stop it
#   ./deploy.sh setup     one-time: enable APIs and create the Artifact Registry repo
#   ./deploy.sh push      build and push the image to Artifact Registry
#   ./deploy.sh deploy    deploy the pushed image to Cloud Run
#   ./deploy.sh all       test, build, smoke, push and deploy
#
# Config comes from env vars, or a .env.deploy file next to this script:
#   PROJECT_ID  (default: current gcloud project)   REGION   (default: europe-west1)
#   SERVICE     (default: duskbloods)                REPO     (default: duskbloods)
#   SHEET_ID    (default: the Duskbloods sheet)      CACHE_SECONDS (default: 60)
#   PORT        local port for `local` (default: 8080)
#   DRY_RUN=1   print the gcloud/docker commands for setup/push/deploy instead of running them
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env.deploy ]] && set -a && source .env.deploy && set +a

SERVICE="${SERVICE:-duskbloods}"
REPO="${REPO:-duskbloods}"
REGION="${REGION:-europe-west1}"
SHEET_ID="${SHEET_ID:-15wyNicWMxF-fM4o-_m5uUODuEoL5WFaXnoZy_VNHOaA}"
CACHE_SECONDS="${CACHE_SECONDS:-60}"
PORT="${PORT:-8080}"
LOCAL_IMAGE="${SERVICE}:local"

TAG="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
# Uncommitted changes get a -dirty tag (Cloud Run pins the image digest at deploy time either way).
[[ -n "$(git status --porcelain 2>/dev/null)" ]] && TAG="${TAG}-dirty"

log() { printf '\033[1;35m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
run() { if [[ "${DRY_RUN:-}" == 1 ]]; then echo "+ $*"; else "$@"; fi; }

cloud_config() {
  PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
  [[ -n "$PROJECT_ID" ]] || die "No GCP project. Set PROJECT_ID or run: gcloud config set project <id>"
  REGISTRY="${REGION}-docker.pkg.dev"
  IMAGE="${REGISTRY}/${PROJECT_ID}/${REPO}/${SERVICE}"
}

cmd_test() {
  log "Running tests in Docker"
  local out
  out="$(mktemp)"
  if docker build --target test --progress=plain --no-cache-filter test -t "${SERVICE}:test" . >"$out" 2>&1; then
    grep -E '# (tests|pass|fail) ' "$out" | sed 's/^#[0-9]* [0-9.]* /  /'
    rm -f "$out"
    log "Tests passed"
  else
    tail -60 "$out"
    rm -f "$out"
    die "Tests failed"
  fi
}

cmd_build() {
  cmd_test
  log "Building ${LOCAL_IMAGE} (linux/amd64, as Cloud Run requires)"
  docker build --platform linux/amd64 --target runtime -t "$LOCAL_IMAGE" .
}

cmd_local() {
  cmd_build
  local args=(-e "SHEET_ID=${SHEET_ID}" -e "CACHE_SECONDS=${CACHE_SECONDS}")
  if [[ "${SAMPLE:-}" == 1 ]]; then
    node scripts/make-sample.js
    args=(-e SHEET_FILE=/data/sample.xlsx -v "$PWD/sample.xlsx:/data/sample.xlsx:ro")
  fi
  log "Serving on http://localhost:${PORT} (Ctrl-C to stop)"
  docker run --rm -it --init -p "${PORT}:8080" "${args[@]}" "$LOCAL_IMAGE"
}

# Starts the container, waits for /healthz, and checks each page type returns the expected status.
smoke_check() {
  local label="$1"; shift
  local name="${SERVICE}-smoke-$$" port
  docker run -d --rm --name "$name" -p 127.0.0.1::8080 "$@" "$LOCAL_IMAGE" >/dev/null
  trap "docker rm -f $name >/dev/null 2>&1 || true" RETURN
  port="$(docker port "$name" 8080 | head -1 | sed 's/.*://')"
  local base="http://127.0.0.1:${port}"
  for _ in $(seq 1 30); do curl -sf "$base/healthz" >/dev/null && break; sleep 0.5; done

  local failures=0
  check() {
    local path="$1" want="$2" got
    got="$(curl -s -o /dev/null -w '%{http_code}' "$base$path")"
    if [[ "$got" == "$want" ]]; then echo "  ok   $got $path"; else echo "  FAIL $got $path (wanted $want)"; failures=$((failures + 1)); fi
  }
  log "Smoke test (${label}) on $base"
  echo "  healthz: $(curl -s "$base/healthz")"
  for spec in "${SMOKE_PATHS[@]}"; do check ${spec}; done
  [[ $failures == 0 ]] || { docker logs "$name" | tail -20; die "Smoke test (${label}) failed"; }
}

cmd_smoke() {
  cmd_build
  node scripts/make-sample.js >/dev/null
  SMOKE_PATHS=("/ 200" "/compendium 200" "/c/bloodsworn 200" "/c/bloodsworn/sample-bloodsworn-a 200" "/c/weapons 200" "/updates 200"
    "/updates/sample-update-site-launched 200" "/search?q=sabre 200" "/api/content 200" "/static/style.css 200" "/static/app.js 200" "/c/nope 404")
  smoke_check "sample data" -e SHEET_FILE=/data/sample.xlsx -v "$PWD/sample.xlsx:/data/sample.xlsx:ro"
  SMOKE_PATHS=("/ 200" "/compendium 200" "/updates 200" "/search?q=x 200" "/healthz 200")
  smoke_check "live sheet" -e "SHEET_ID=${SHEET_ID}"
  log "Smoke tests passed"
}

cmd_setup() {
  cloud_config
  log "Enabling Cloud Run + Artifact Registry APIs in ${PROJECT_ID}"
  run gcloud services enable run.googleapis.com artifactregistry.googleapis.com --project "$PROJECT_ID"
  if gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    log "Artifact Registry repo ${REPO} already exists"
  else
    log "Creating Artifact Registry repo ${REPO} in ${REGION}"
    run gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --project "$PROJECT_ID"
  fi
  run gcloud auth configure-docker "$REGISTRY" --quiet
}

cmd_push() {
  cloud_config
  cmd_build
  log "Pushing ${IMAGE}:${TAG}"
  run docker tag "$LOCAL_IMAGE" "${IMAGE}:${TAG}"
  run docker tag "$LOCAL_IMAGE" "${IMAGE}:latest"
  run docker push "${IMAGE}:${TAG}"
  run docker push "${IMAGE}:latest"
}

cmd_deploy() {
  cloud_config
  log "Deploying ${IMAGE}:${TAG} to Cloud Run service ${SERVICE} (${REGION})"
  run gcloud run deploy "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --image "${IMAGE}:${TAG}" \
    --allow-unauthenticated \
    --port 8080 \
    --cpu 1 --memory 256Mi \
    --min-instances 0 --max-instances 3 \
    --set-env-vars "SHEET_ID=${SHEET_ID},CACHE_SECONDS=${CACHE_SECONDS}"
  [[ "${DRY_RUN:-}" == 1 ]] || log "Live at: $(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')"
}

case "${1:-}" in
  test) cmd_test ;;
  build) cmd_build ;;
  local) cmd_local ;;
  smoke) cmd_smoke ;;
  setup) cmd_setup ;;
  push) cmd_push ;;
  deploy) cmd_deploy ;;
  all) cmd_smoke && cmd_push && cmd_deploy ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
