#!/usr/bin/env bash
# Read-only check that the verify-stacks instance is the one launch.sh started.
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_ROOT/../../.." && pwd)"

fail() {
  printf 'fail  %s\n' "$1" >&2
  exit 1
}
ok() { printf 'ok  %s\n' "$1"; }

STATE="${STACKS_VERIFY_STATE:-$REPO_ROOT/artifacts/verify/current-run.env}"
[[ -f "$STATE" ]] || fail "no run state at $STATE. Launch first."
# shellcheck disable=SC1090
source "$STATE"

[[ -n "${APP_PID:-}" && -n "${APP_PGID:-}" && -n "${PORT:-}" && -n "${DB_NAME:-}" ]] || fail "run state is incomplete"
kill -0 "$APP_PID" 2>/dev/null || fail "app pid $APP_PID is not running"
ok "pid $APP_PID alive"

python3 - "$PORT" "$APP_PID" "$APP_PGID" <<'PY' || exit 1
import os, sys
port, app_pid, app_pgid = sys.argv[1:]
hex_port = f"{int(port):04X}"
inodes = set()
for path in ("/proc/net/tcp", "/proc/net/tcp6"):
    try:
        lines = open(path).read().splitlines()[1:]
    except FileNotFoundError:
        continue
    for line in lines:
        fields = line.split()
        local, state, inode = fields[1], fields[3], fields[9]
        if state == "0A" and local.rsplit(":", 1)[-1].upper() == hex_port:
            inodes.add(inode)
if not inodes:
    print(f"fail  nothing is listening on port {port}", file=sys.stderr)
    sys.exit(1)
listeners = []
for pid in os.listdir("/proc"):
    if not pid.isdigit():
        continue
    fd_dir = f"/proc/{pid}/fd"
    try:
        fds = os.listdir(fd_dir)
    except OSError:
        continue
    for fd in fds:
        try:
            target = os.readlink(f"{fd_dir}/{fd}")
        except OSError:
            continue
        if target.startswith("socket:[") and target[8:-1] in inodes:
            listeners.append(pid)
            break

def owns(pid):
    seen = set()
    while pid and pid not in seen and pid != "1":
        if pid == app_pid:
            return True
        seen.add(pid)
        try:
            stat = open(f"/proc/{pid}/stat").read()
            ppid = stat.rsplit(")", 1)[1].split()[1]
            pgid = stat.rsplit(")", 1)[1].split()[2]
        except OSError:
            return False
        if pgid == app_pgid:
            return True
        pid = ppid
    return False

if not listeners or not all(owns(pid) for pid in listeners):
    print(f"fail  port {port} listeners {listeners or ['none']} are not process group {app_pgid}", file=sys.stderr)
    sys.exit(1)
print(f"ok  port {port} owned by process group {app_pgid}")
PY

head_sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
[[ "$head_sha" == "$SHA" ]] || fail "HEAD is $head_sha but this instance launched at $SHA"
cwd="$(readlink -f "/proc/$APP_PID/cwd" 2>/dev/null || true)"
[[ "$cwd" == "$REPO_ROOT" ]] || fail "app cwd is ${cwd:-missing}, expected $REPO_ROOT"
cmdline="$(tr '\0' ' ' < "/proc/$APP_PID/cmdline")"
[[ "$cmdline" == *next* && "$cmdline" == *"dev"* && "$cmdline" == *"$PORT"* ]] || fail "app command is not next dev on port $PORT"
ok "build $SHA"

health="$(curl -sf "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || true)"
[[ "$health" == *'"ok":true'* && "$health" == *'"db":true'* ]] || fail "health is ${health:-unreachable}"
ok "health $health"

psql "$DATABASE_URL" -Atc "SELECT 1" >/dev/null || fail "database $DB_NAME is not reachable"
ok "database $DB_NAME reachable"
tables="$(psql "$DATABASE_URL" -Atc "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND relname IN ('users','accounts','sessions','books','user_settings') ORDER BY 1")"
expected=$'accounts\nbooks\nsessions\nuser_settings\nusers'
[[ "$tables" == "$expected" ]] || fail "schema missing tables: $(echo "$tables" | tr '\n' ' ')"
ok "schema users accounts sessions books user_settings"

discovery="$(curl -sf "${ISSUER}/.well-known/openid-configuration" 2>/dev/null || true)"
[[ "$discovery" == *"\"issuer\":\"${ISSUER}\""* ]] || fail "fixture discovery at $ISSUER did not report that issuer"
ok "fixture $ISSUER issuer matches"
providers="$(curl -sf "${AUTH_URL}/api/auth/providers" 2>/dev/null || true)"
[[ "$providers" == *'"stacks-test-oidc"'* ]] || fail "stacks-test-oidc is not registered at ${AUTH_URL}/api/auth/providers"
ok "provider stacks-test-oidc registered"
login="$(curl -sf "${AUTH_URL}/login" 2>/dev/null || true)"
[[ "$login" == *'data-testid="continue-test-alice"'* && "$login" == *'data-testid="test-oidc-note"'* ]] || fail "login page is missing the test-account control"
ok "login page offers test account A"

echo "Stacks verify doctor passed."
