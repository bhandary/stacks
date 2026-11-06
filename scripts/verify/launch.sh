#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PORT="${PORT:-43177}"
export DATABASE_URL="${DATABASE_URL:-postgres://stacks:stacks@127.0.0.1:5432/stacks}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  sudo pg_ctlcluster 16 main start
fi

if curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
  echo "Stacks already running on :${PORT}"
  exit 0
fi

if [[ -z "${AUTH_GOOGLE_ID:-}" || -z "${AUTH_GOOGLE_SECRET:-}" ]]; then
  FIXTURE_PORT="${STACKS_OIDC_FIXTURE_PORT:-43179}"
  export STACKS_AUTH_TEST_OIDC=1
  export STACKS_AUTH_TEST_ISSUER="http://127.0.0.1:${FIXTURE_PORT}"
  export AUTH_URL="http://localhost:${PORT}"
  if [[ -z "${AUTH_SECRET:-}" || ${#AUTH_SECRET} -lt 32 ]]; then
    AUTH_SECRET="$(openssl rand -base64 32)"
    export AUTH_SECRET
  fi
  if ! curl -sf "${STACKS_AUTH_TEST_ISSUER}/.well-known/openid-configuration" >/dev/null 2>&1; then
    node scripts/test/oidc-fixture.mjs "$STACKS_AUTH_TEST_ISSUER" >/tmp/stacks-oidc-verify.log 2>&1 &
    echo $! >/tmp/stacks-oidc-verify.pid
  fi
  echo "Local test sign-in is on. This is not Google."
fi

if [[ "${STACKS_VERIFY_PROD:-}" == "1" ]]; then
  npm run build
  exec npx next start -H 0.0.0.0 -p "$PORT"
fi

exec npx next dev -H 0.0.0.0 -p "$PORT"
