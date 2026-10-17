#!/usr/bin/env bash
# Build, test, run locally, push and deploy duskbloods.build to Cloud Run.
#
#   ./deploy.sh test      run the unit tests inside Docker
#   ./deploy.sh build     build the production image (runs tests first)
#   ./deploy.sh local     build and run the container at http://localhost:8080 (live sheet; SAMPLE=1 for sample data)
#   ./deploy.sh smoke     build, start the container, check every page type responds, stop it
#   ./deploy.sh setup     one-time: enable APIs, create the image repo, runtime account and page view sink to BigQuery;
#                         with DEPLOYER_SA set, also grant that account what CI needs to push and deploy
#   ./deploy.sh push      build and push the image to Artifact Registry
#   ./deploy.sh deploy    deploy the pushed image to Cloud Run
#   ./deploy.sh all       test, build, smoke, push and deploy
#
# Config comes from env vars, or a .env.deploy file next to this script:
#   PROJECT_ID  (default: current gcloud project)   REGION   (default: europe-west1)
#   SERVICE     (default: duskbloods)                REPO     (default: duskbloods)
#   SHEET_ID    (default: the Duskbloods sheet)      CACHE_SECONDS (default: 60)
#   SITE_URL    public origin for canonical/sitemap URLs, e.g. https://duskbloods.build (default: the request host)
#   FEEDBACK_FORM_URL  Google Form pre-filled link for "Report a problem" (unset: the form is hidden)
#   PORT        local port for `local` (default: 8080)
#   RUNTIME_SA  account the service runs as (default: duskbloods-runtime@PROJECT_ID, which has no roles)
#   DEPLOYER_SA account CI deploys as, for `setup` to grant roles to (e.g. duskbloods-build-sa@PROJECT_ID)
#   DATASET     BigQuery dataset the page view sink writes to (default: analytics)
#   DRY_RUN=1   print the gcloud/docker commands for setup/push/deploy instead of running them
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
[[ -f .env.deploy ]] && set -a && source .env.deploy && set +a

SERVICE="${SERVICE:-duskbloods}"
REPO="${REPO:-duskbloods}"
DATASET="${DATASET:-analytics}"
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
  RUNTIME_SA="${RUNTIME_SA:-duskbloods-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
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

# Starts the container, waits for /health, and checks each page type returns the expected status.
smoke_check() {
  local label="$1"; shift
  local name="${SERVICE}-smoke-$$" port
  docker run -d --rm --name "$name" -p 127.0.0.1::8080 "$@" "$LOCAL_IMAGE" >/dev/null
  # shellcheck disable=SC2064 # expand $name now: it's local and gone by the time the trap fires
  trap "docker rm -f $name >/dev/null 2>&1 || true" RETURN
  port="$(docker port "$name" 8080 | head -1 | sed 's/.*://')"
  local base="http://127.0.0.1:${port}"
  for _ in $(seq 1 30); do curl -sf "$base/health" >/dev/null && break; sleep 0.5; done

  local failures=0
  check() {
    local path="$1" want="$2" got
    got="$(curl -s -o /dev/null -w '%{http_code}' "$base$path")"
    if [[ "$got" == "$want" ]]; then echo "  ok   $got $path"; else echo "  FAIL $got $path (wanted $want)"; failures=$((failures + 1)); fi
  }
  log "Smoke test (${label}) on $base"
  echo "  health: $(curl -s "$base/health")"
  local path want
  for spec in "${SMOKE_PATHS[@]}"; do read -r path want <<<"$spec"; check "$path" "$want"; done
  [[ $failures == 0 ]] || { docker logs "$name" | tail -20; die "Smoke test (${label}) failed"; }
}

cmd_smoke() {
  cmd_build
  node scripts/make-sample.js >/dev/null
  SMOKE_PATHS=("/ 200" "/compendium 200" "/c/bloodsworn 200" "/c/bloodsworn/sample-bloodsworn-a 200" "/c/weapons 200" "/updates 200"
    "/updates/sample-update-site-launched 200" "/search?q=sabre 200" "/api/content 200" "/static/style.css 200" "/static/app.js 200" "/c/nope 404")
  smoke_check "sample data" -e SHEET_FILE=/data/sample.xlsx -v "$PWD/sample.xlsx:/data/sample.xlsx:ro"
  SMOKE_PATHS=("/ 200" "/compendium 200" "/updates 200" "/search?q=x 200" "/health 200")
  smoke_check "live sheet" -e "SHEET_ID=${SHEET_ID}"
  log "Smoke tests passed"
}

# Public access uses --no-invoker-iam-check rather than granting allUsers the invoker role: the duskbloods-build
# organisation's domain-restricted-sharing policy forbids allUsers bindings, and gcloud only warns when that fails.
# Idempotent: safe to re-run; existing resources and bindings are left as they are.
cmd_setup() {
  cloud_config
  log "Enabling Cloud Run + Artifact Registry APIs in ${PROJECT_ID}"
  run gcloud services enable run.googleapis.com artifactregistry.googleapis.com --project "$PROJECT_ID"

  if [[ "${DRY_RUN:-}" != 1 ]] && gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    log "Artifact Registry repo ${REPO} already exists"
  else
    log "Creating Artifact Registry repo ${REPO} in ${REGION}"
    run gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --project "$PROJECT_ID" \
      --description "duskbloods.build images"
  fi

  # The site only reads a public sheet, so it runs as an account with no roles at all.
  if [[ "${DRY_RUN:-}" != 1 ]] && gcloud iam service-accounts describe "$RUNTIME_SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
    log "Runtime account ${RUNTIME_SA} already exists"
  else
    log "Creating runtime account ${RUNTIME_SA} (no roles)"
    run gcloud iam service-accounts create "${RUNTIME_SA%%@*}" --project "$PROJECT_ID" --display-name "duskbloods.build Cloud Run runtime"
  fi

  # Page views (src/analytics.js) are log lines; a sink copies them into one day-partitioned BigQuery table,
  # ${DATASET}.run_googleapis_com_stdout. Partitions older than 400 days are deleted, as the privacy page promises.
  log "Routing ${SERVICE} page view logs to BigQuery dataset ${DATASET}"
  run gcloud services enable bigquery.googleapis.com logging.googleapis.com --project "$PROJECT_ID"
  if [[ "${DRY_RUN:-}" != 1 ]] && bq --project_id "$PROJECT_ID" show --dataset "${PROJECT_ID}:${DATASET}" >/dev/null 2>&1; then
    log "Dataset ${DATASET} already exists"
  else
    run bq --project_id "$PROJECT_ID" mk --dataset --location "$REGION" --default_partition_expiration $((400 * 86400)) \
      --description "duskbloods.build page views" "${PROJECT_ID}:${DATASET}"
  fi
  local sink="${SERVICE}-pageviews"
  local filter="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND jsonPayload.message=\"pageview\""
  local verb=create
  [[ "${DRY_RUN:-}" != 1 ]] && gcloud logging sinks describe "$sink" --project "$PROJECT_ID" >/dev/null 2>&1 && verb=update
  run gcloud logging sinks "$verb" "$sink" "bigquery.googleapis.com/projects/${PROJECT_ID}/datasets/${DATASET}" \
    --log-filter "$filter" --use-partitioned-tables --project "$PROJECT_ID" --quiet
  # The sink writes as a Google-managed account, which needs write access to this one dataset only.
  local writer
  writer="$([[ "${DRY_RUN:-}" == 1 ]] && echo 'serviceAccount:<sink writer identity>' \
    || gcloud logging sinks describe "$sink" --project "$PROJECT_ID" --format 'value(writerIdentity)')"
  run bq --project_id "$PROJECT_ID" add-iam-policy-binding --dataset --member "$writer" --role roles/bigquery.dataEditor \
    "${PROJECT_ID}:${DATASET}"

  if [[ -n "${DEPLOYER_SA:-}" ]]; then
    log "Granting ${DEPLOYER_SA} what CI needs: deploy Cloud Run, push to ${REPO} only, run the service as ${RUNTIME_SA%%@*} only"
    run gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${DEPLOYER_SA}" --role roles/run.admin --condition None --quiet
    run gcloud artifacts repositories add-iam-policy-binding "$REPO" --location "$REGION" --project "$PROJECT_ID" \
      --member "serviceAccount:${DEPLOYER_SA}" --role roles/artifactregistry.writer --quiet
    run gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project "$PROJECT_ID" \
      --member "serviceAccount:${DEPLOYER_SA}" --role roles/iam.serviceAccountUser --quiet
  fi
}

cmd_push() {
  cloud_config
  cmd_build
  log "Pushing ${IMAGE}:${TAG}"
  run gcloud auth configure-docker "$REGISTRY" --quiet
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
    --service-account "$RUNTIME_SA" \
    --no-invoker-iam-check \
    --port 8080 \
    --cpu 1 --memory 256Mi \
    --min-instances 0 --max-instances 3 \
    --set-env-vars "^@^SHEET_ID=${SHEET_ID}@CACHE_SECONDS=${CACHE_SECONDS}@SITE_URL=${SITE_URL:-}@FEEDBACK_FORM_URL=${FEEDBACK_FORM_URL:-}"
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
  *) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
