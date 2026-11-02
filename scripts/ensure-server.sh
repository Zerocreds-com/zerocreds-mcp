#!/usr/bin/env bash
# ensure-server.sh — Start the ZeroCreds MCP server if it is not already running.
#
# Usage:
#   ./scripts/ensure-server.sh
#
# This script:
#   1. Checks if a zerocreds-mcp process is already listening.
#   2. If not, starts `node dist/index.js` in the background.
#   3. Waits up to 5 seconds for the server to become ready.
#
# The script is idempotent: running it multiple times is safe.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# --- 1. Check if server is already running -----------------------------------
# We look for a process that matches `node dist/index.js` started from this repo.
# Using pgrep with a pattern that includes the absolute path to avoid false matches.
if pgrep -f "node $REPO_ROOT/dist/index.js" > /dev/null 2>&1; then
  echo "✅ ZeroCreds MCP server is already running."
  exit 0
fi

# --- 2. Start the server -----------------------------------------------------
export ZEROCREDS_TOKEN="$(cat "$HOME/.config/zerocreds/local/admin-token" 2>/dev/null || echo "")"

if [ -z "$ZEROCREDS_TOKEN" ]; then
  echo "⚠️  Warning: admin token not found at ~/.config/zerocreds/local/admin-token" >&2
  echo "   The server may fail to start without a valid token." >&2
fi

echo "🚀 Starting ZeroCreds MCP server..."
nohup node "$REPO_ROOT/dist/index.js" > /dev/null 2>&1 &
SERVER_PID=$!
echo "   Server PID: $SERVER_PID"

# --- 3. Wait for readiness ---------------------------------------------------
# Give the server a moment to bind its transport.
MAX_WAIT=5
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if pgrep -f "node $REPO_ROOT/dist/index.js" > /dev/null 2>&1; then
    # The process is alive; assume it's ready.
    sleep 0.5
    WAITED=$((WAITED + 1))
  else
    echo "❌ Server process died immediately. Check logs or run manually." >&2
    exit 1
  fi
done

echo "✅ ZeroCreds MCP server is ready (PID $SERVER_PID)."