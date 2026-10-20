#!/bin/sh
# Container entrypoint: the site listens on port 3000 inside the container and Anubis takes the public port in front
# of it. Anubis only starts once the site is up, so Cloud Run's startup probe still means "the sheet loaded".
# If either one exits, the container exits too, so Cloud Run replaces it rather than serving 502s.
APP_PORT=3000
PORT="$APP_PORT" node src/server.js &
until wget -qO- "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; do
  kill -0 $! 2>/dev/null || exit 1
  sleep 0.2
done
# No ANUBIS_KEY: Anubis makes up a signing key, so pass cookies stop working on restart (fine locally, not deployed).
# After a challenge, Anubis only redirects to the site's own host, not wherever ?redir= says.
site_host="${SITE_URL#*://}"
BIND=":${PORT:-8080}" TARGET="http://127.0.0.1:${APP_PORT}" ED25519_PRIVATE_KEY_HEX="${ANUBIS_KEY:-}" \
  REDIRECT_DOMAINS="${SITE_URL:+${site_host%%/*}}" POLICY_FNAME=/app/anubis/policy.yaml anubis &
wait -n
exit 1
