#!/usr/bin/env bash
# Stop only the process groups recorded by launch.sh and drop that scratch database.
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_ROOT/../../.." && pwd)"
STATE="${STACKS_VERIFY_STATE:-$REPO_ROOT/artifacts/verify/current-run.env}"

if [[ ! -f "$STATE" ]]; then
  echo "No verify-stacks state at $STATE. Nothing to stop."
  exit 0
fi

# shellcheck disable=SC1090
source "$STATE"

kill_group() {
  local pgid="$1"
  local label="$2"
  if [[ -z "$pgid" || ! "$pgid" =~ ^[0-9]+$ ]]; then
    echo "skip $label (no process group)"
    return 0
  fi
  if ! ps -o pgid= -p "$pgid" >/dev/null 2>&1 && ! kill -0 "-$pgid" 2>/dev/null; then
    echo "$label process group $pgid already gone"
    return 0
  fi
  kill -TERM -- "-$pgid" 2>/dev/null || true
  for _ in $(seq 1 25); do
    if ! kill -0 "-$pgid" 2>/dev/null; then
      echo "stopped $label process group $pgid"
      return 0
    fi
    sleep 0.2
  done
  kill -KILL -- "-$pgid" 2>/dev/null || true
  echo "killed $label process group $pgid"
}

kill_group "${APP_PGID:-}" "app"
kill_group "${FIXTURE_PGID:-}" "fixture"

if [[ "${DB_NAME:-}" =~ ^stacks_verify_[a-z0-9_]+$ ]]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE);"
  echo "dropped database $DB_NAME"
else
  echo "skip database drop (name ${DB_NAME:-missing} is not a stacks_verify scratch db)"
fi

if [[ -n "${STATE_DIR:-}" && "$STATE_DIR" == /tmp/stacks-verify-* ]]; then
  rm -rf "$STATE_DIR"
  echo "removed $STATE_DIR"
fi

pointer="$REPO_ROOT/artifacts/verify/current-run.env"
if [[ -L "$pointer" ]]; then
  target="$(readlink -f "$pointer" 2>/dev/null || true)"
  if [[ -n "${STATE_DIR:-}" && "$target" == "$STATE_DIR/run.env" ]] || [[ ! -e "$pointer" ]]; then
    rm -f "$pointer"
    echo "removed current-run symlink"
  fi
fi

echo "Cleanup finished. Evidence under ${EVIDENCE_DIR:-artifacts/verify} was kept."
