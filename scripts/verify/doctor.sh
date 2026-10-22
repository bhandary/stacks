#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ok() { printf 'ok  %s\n' "$1"; }
fail() { printf 'fail  %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null || fail "node is not on PATH"
command -v npm >/dev/null || fail "npm is not on PATH"
command -v python3 >/dev/null || fail "python3 is not on PATH"
command -v ffmpeg >/dev/null || fail "ffmpeg is not on PATH"
command -v psql >/dev/null || fail "psql is not on PATH"
ok "node $(node -v), npm $(npm -v)"

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  if command -v pg_ctlcluster >/dev/null; then
    sudo pg_ctlcluster 16 main start || true
  fi
fi
pg_isready -h 127.0.0.1 -p 5432 >/dev/null || fail "postgres is not accepting connections"
ok "postgres is up"

export DATABASE_URL="${DATABASE_URL:-postgres://stacks:stacks@127.0.0.1:5432/stacks}"
if ! psql "$DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1; then
  sudo -u postgres psql -c "DO \$\$ BEGIN CREATE USER stacks WITH PASSWORD 'stacks'; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"
  sudo -u postgres psql -c "CREATE DATABASE stacks OWNER stacks;" 2>/dev/null || true
fi
psql "$DATABASE_URL" -c 'SELECT 1' >/dev/null || fail "cannot connect with DATABASE_URL"
ok "DATABASE_URL $DATABASE_URL"

if [[ ! -d node_modules ]]; then
  npm ci
fi
ok "npm dependencies"

npx playwright install chromium >/dev/null
ok "playwright chromium"

python3 scripts/verify/generate_barcode_video.py >/dev/null
[[ -f scripts/verify/fixtures/isbn_barcode.y4m ]] || fail "barcode y4m was not generated"
[[ -f scripts/verify/fixtures/isbn_barcode.mjpeg ]] || fail "barcode mjpeg was not generated"
ok "ISBN barcode fake-camera fixtures"

echo "Stacks doctor passed."
