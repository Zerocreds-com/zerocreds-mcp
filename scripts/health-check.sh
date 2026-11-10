#!/usr/bin/env bash
# health-check.sh — Verify the ZeroCreds MCP server is running and reachable.
#
# Usage:
#   ./scripts/health-check.sh
#
# This script:
#   1. Checks if a zerocreds-mcp process is alive.
#   2. Verifies the admin token file exists.
#   3. Reports a concise status (OK / NOT_RUNNING / MISSING_TOKEN).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TOKEN_FILE="$HOME/.config/zerocreds/local/admin-token"

# --- 1. Process check ---------------------------------------------------------
SERVER_PIDS=$(pgrep -f "node $REPO_ROOT/dist/index.js" 2>/dev/null || true)
RUNNING_PID=""
for PID in $SERVER_PIDS; do
  # Use ps to check if process is alive and not a zombie
  STAT=$(ps -p "$PID" -o stat= 2>/dev/null | tr -d ' ')
  if [ -n "$STAT" ] && [ "$STAT" != "Z" ]; then
    RUNNING_PID=$PID
    break
  fi
done

if [ -n "$RUNNING_PID" ]; then
  echo "✅ Server process is running (PID: $RUNNING_PID)"
else
  echo "❌ Server process is NOT running."
  echo "   Run: ./scripts/ensure-server.sh"
  exit 1
fi

# --- 2. Token file check ------------------------------------------------------
if [ -f "$TOKEN_FILE" ]; then
  echo "✅ Admin token file exists: $TOKEN_FILE"
else
  echo "⚠️  Admin token file not found: $TOKEN_FILE"
  echo "   The server may refuse to start without a valid token."
fi

# --- 3. Summary ---------------------------------------------------------------
echo ""
echo "Health check complete."