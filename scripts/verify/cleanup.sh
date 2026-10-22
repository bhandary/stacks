#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-43177}"

# Leave Postgres and user books alone. Only stop a verify-owned Next process
# and drop generated camera fixtures that can be rebuilt by doctor.
if [[ -f /tmp/stacks-verify.pid ]]; then
  kill "$(cat /tmp/stacks-verify.pid)" 2>/dev/null || true
  rm -f /tmp/stacks-verify.pid
fi

pkill -f "next dev -H 0.0.0.0 -p ${PORT}" 2>/dev/null || true

rm -f \
  "$ROOT/scripts/verify/fixtures/isbn_barcode.png" \
  "$ROOT/scripts/verify/fixtures/isbn_barcode.y4m" \
  "$ROOT/scripts/verify/fixtures/isbn_barcode.mjpeg"

echo "Verify leftovers cleaned. Artifacts in artifacts/verify/ were kept."
