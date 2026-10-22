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

if [[ "${STACKS_VERIFY_PROD:-}" == "1" ]]; then
  npm run build
  exec npx next start -H 0.0.0.0 -p "$PORT"
fi

exec npx next dev -H 0.0.0.0 -p "$PORT"
