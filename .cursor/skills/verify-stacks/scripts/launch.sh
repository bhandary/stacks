#!/usr/bin/env bash
# Start an isolated Stacks dev server and the local OIDC fixture.
# Exits 0 only after migrations have run and a fixture sign-in works.
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_ROOT/../../.." && pwd)"
cd "$REPO_ROOT"

if [[ "${DATABASE_URL:-}" == *railway* || "${DATABASE_URL:-}" == *neon.tech* || "${DATABASE_URL:-}" == *supabase* || "${DATABASE_URL:-}" == *rlwy.net* ]]; then
  echo "fail  refusing hosted DATABASE_URL" >&2
  exit 1
fi

RUN_ID="${STACKS_VERIFY_RUN_ID:-$(date -u +%Y%m%d%H%M%S)_$$}"
if [[ ! "$RUN_ID" =~ ^[a-z0-9_]+$ ]]; then
  echo "fail  STACKS_VERIFY_RUN_ID must match [a-z0-9_]+" >&2
  exit 1
fi

PORT="${PORT:-43177}"
FIXTURE_PORT="${STACKS_OIDC_FIXTURE_PORT:-43179}"
DB_NAME="stacks_verify_${RUN_ID}"
STATE_DIR="/tmp/stacks-verify-${RUN_ID}"
EVIDENCE_DIR="$REPO_ROOT/artifacts/verify/${RUN_ID}"
AUTH_URL="http://localhost:${PORT}"
ISSUER="http://127.0.0.1:${FIXTURE_PORT}"
NEXT_BIN="$REPO_ROOT/node_modules/.bin/next"

port_listening() {
  python3 - "$1" <<'PY'
import socket, sys
port = int(sys.argv[1])
sock = socket.socket()
sock.settimeout(0.3)
try:
    code = sock.connect_ex(("127.0.0.1", port))
finally:
    sock.close()
sys.exit(0 if code == 0 else 1)
PY
}

if port_listening "$PORT"; then
  echo "fail  port ${PORT} is already in use; refusing to attach. Set PORT and STACKS_OIDC_FIXTURE_PORT." >&2
  exit 1
fi
if port_listening "$FIXTURE_PORT"; then
  echo "fail  fixture port ${FIXTURE_PORT} is already in use. Set STACKS_OIDC_FIXTURE_PORT." >&2
  exit 1
fi

if ! command -v psql >/dev/null || ! command -v pg_isready >/dev/null; then
  echo "fail  psql or pg_isready is missing. Install with: sudo apt-get install -y postgresql postgresql-client" >&2
  exit 1
fi

if [[ ! -x "$NEXT_BIN" ]]; then
  echo "npm ci (node_modules/.bin/next missing)"
  npm ci
fi

mkdir -p "$STATE_DIR" "$EVIDENCE_DIR/logs"
chmod 700 "$STATE_DIR"

if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  cluster="$(ls /usr/lib/postgresql 2>/dev/null | head -1 || true)"
  if [[ -z "$cluster" ]] || ! command -v pg_ctlcluster >/dev/null; then
    echo "fail  Postgres is not accepting connections on 127.0.0.1:5432" >&2
    exit 1
  fi
  echo "starting postgres cluster ${cluster}"
  sudo pg_ctlcluster "$cluster" main start
fi
pg_isready -h 127.0.0.1 -p 5432 >/dev/null

sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres <<'SQL'
DO $$ BEGIN
  CREATE USER stacks WITH PASSWORD 'stacks';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
SQL

sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER stacks;"

DATABASE_URL="postgres://stacks:stacks@127.0.0.1:5432/${DB_NAME}"
openssl rand -base64 32 | tr -d '\n' > "$STATE_DIR/secret"
chmod 600 "$STATE_DIR/secret"
SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"

cat > "$STATE_DIR/run.env" <<EOF
RUN_ID=${RUN_ID}
PORT=${PORT}
FIXTURE_PORT=${FIXTURE_PORT}
FIXTURE_PID=
FIXTURE_PGID=
APP_PID=
APP_PGID=
DB_NAME=${DB_NAME}
DATABASE_URL=${DATABASE_URL}
AUTH_URL=${AUTH_URL}
ISSUER=${ISSUER}
SHA=${SHA}
ROOT=${REPO_ROOT}
EVIDENCE_DIR=${EVIDENCE_DIR}
STATE_DIR=${STATE_DIR}
EOF
chmod 600 "$STATE_DIR/run.env"
ln -sfn "$STATE_DIR/run.env" "$REPO_ROOT/artifacts/verify/current-run.env"
cp "$STATE_DIR/run.env" "$EVIDENCE_DIR/run.env"
chmod 600 "$EVIDENCE_DIR/run.env"

APP_PID=""
FIXTURE_PID=""
APP_PGID=""
FIXTURE_PGID=""
on_err() {
  local status=${1:-$?}
  trap - ERR
  echo "Launch failed (exit ${status}). Cleaning up this attempt." >&2
  if [[ -n "${APP_PGID}" ]]; then kill -TERM -- "-${APP_PGID}" 2>/dev/null || true; fi
  if [[ -n "${FIXTURE_PGID}" ]]; then kill -TERM -- "-${FIXTURE_PGID}" 2>/dev/null || true; fi
  STACKS_VERIFY_STATE="$STATE_DIR/run.env" bash "$SKILL_ROOT/scripts/cleanup.sh" || true
  exit "$status"
}
# Explicit `exit 1` does not fire ERR, so a next/fixture failure would leak the
# fixture process and the scratch database. Call on_err instead.
fail() {
  echo "fail  $1" >&2
  on_err 1
}
trap on_err ERR

set -m
nohup node "$REPO_ROOT/scripts/test/oidc-fixture.mjs" "$ISSUER" > "$EVIDENCE_DIR/logs/oidc.log" 2>&1 &
FIXTURE_PID=$!
FIXTURE_PGID="$(ps -o pgid= -p "$FIXTURE_PID" | tr -d ' ')"

AUTH_SECRET="$(cat "$STATE_DIR/secret")"
nohup env \
  -u AUTH_GOOGLE_ID \
  -u AUTH_GOOGLE_SECRET \
  -u AUTH_REDIRECT_PROXY_URL \
  -u NODE_ENV \
  -u RAILWAY_ENVIRONMENT \
  -u RAILWAY_PROJECT_ID \
  -u RAILWAY_PUBLIC_DOMAIN \
  -u RAILWAY_STATIC_URL \
  -u RAILWAY_ENVIRONMENT_NAME \
  -u RAILWAY_SERVICE_ID \
  -u VERCEL \
  -u VERCEL_ENV \
  -u VERCEL_URL \
  DATABASE_URL="$DATABASE_URL" \
  PGSSL=0 \
  AUTH_URL="$AUTH_URL" \
  AUTH_SECRET="$AUTH_SECRET" \
  STACKS_AUTH_TEST_OIDC=1 \
  STACKS_AUTH_TEST_ISSUER="$ISSUER" \
  PORT="$PORT" \
  "$NEXT_BIN" dev -H 0.0.0.0 -p "$PORT" > "$EVIDENCE_DIR/logs/next.log" 2>&1 &
APP_PID=$!
APP_PGID="$(ps -o pgid= -p "$APP_PID" | tr -d ' ')"
disown "$FIXTURE_PID" "$APP_PID" 2>/dev/null || true

SELF_PGID="$(ps -o pgid= -p "$$" | tr -d ' ')"
if [[ -z "$APP_PGID" || "$APP_PGID" == "$SELF_PGID" || -z "$FIXTURE_PGID" || "$FIXTURE_PGID" == "$SELF_PGID" ]]; then
  fail "server or fixture stayed in the launch script process group"
fi

python3 - "$STATE_DIR/run.env" "$FIXTURE_PID" "$FIXTURE_PGID" "$APP_PID" "$APP_PGID" <<'PY'
import sys
path, fixture_pid, fixture_pgid, app_pid, app_pgid = sys.argv[1:]
text = open(path).read()
repls = {
    "FIXTURE_PID=": f"FIXTURE_PID={fixture_pid}",
    "FIXTURE_PGID=": f"FIXTURE_PGID={fixture_pgid}",
    "APP_PID=": f"APP_PID={app_pid}",
    "APP_PGID=": f"APP_PGID={app_pgid}",
}
lines = []
for line in text.splitlines():
    for key, value in repls.items():
        if line.startswith(key):
            line = value
            break
    lines.append(line)
open(path, "w").write("\n".join(lines) + "\n")
PY
cp "$STATE_DIR/run.env" "$EVIDENCE_DIR/run.env"
chmod 600 "$EVIDENCE_DIR/run.env"

ready=0
for _ in $(seq 1 60); do
  if curl -sf "$ISSUER/.well-known/openid-configuration" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$FIXTURE_PID" 2>/dev/null; then
    fail "oidc fixture exited. See $EVIDENCE_DIR/logs/oidc.log"
  fi
  sleep 0.25
done
if [[ "$ready" != "1" ]]; then
  fail "oidc fixture did not publish discovery at $ISSUER"
fi

health=0
for _ in $(seq 1 180); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    fail "next dev exited. See $EVIDENCE_DIR/logs/next.log"
  fi
  body="$(curl -sf "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || true)"
  if [[ "$body" == *'"ok":true'* && "$body" == *'"db":true'* ]]; then
    health=1
    break
  fi
  sleep 1
done
if [[ "$health" != "1" ]]; then
  fail "GET /api/health did not return ok and db. See $EVIDENCE_DIR/logs/next.log"
fi

tables="$(psql "$DATABASE_URL" -Atc "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND relname IN ('users','accounts','sessions','books','user_settings') ORDER BY 1")"
expected=$'accounts\nbooks\nsessions\nuser_settings\nusers'
if [[ "$tables" != "$expected" ]]; then
  echo "fail  schema tables after /api/health:" >&2
  echo "$tables" >&2
  fail "schema tables after /api/health did not match"
fi

AUTH_URL="$AUTH_URL" node "$SKILL_ROOT/scripts/ready-sign-in.mjs"

trap - ERR
echo "Stacks verify launch ready"
echo "url ${AUTH_URL}"
echo "database ${DB_NAME}"
echo "issuer ${ISSUER}"
echo "sha ${SHA}"
echo "state ${STATE_DIR}/run.env"
echo "evidence ${EVIDENCE_DIR}"
