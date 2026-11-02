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

# Use a named pipe to keep stdin open so the stdio server doesn't exit
PIPE_PATH="/tmp/zerocreds-server-stdin"
rm -f "$PIPE_PATH"
mkfifo "$PIPE_PATH"

# Start the server with stdin from the pipe, stdout/stderr to log file
nohup node "$REPO_ROOT/dist/index.js" < "$PIPE_PATH" > "$REPO_ROOT/server.log" 2>&1 &
SERVER_PID=$!

# Keep the write end of the pipe open so the server doesn't get EOF
exec 3> "$PIPE_PATH"

echo "   Server PID: $SERVER_PID"

# --- 3. Wait for readiness ---------------------------------------------------
MAX_WAIT=5
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  sleep 0.5
  WAITED=$((WAITED + 1))
  if pgrep -f "node $REPO_ROOT/dist/index.js" > /dev/null 2>&1; then
    echo "✅ ZeroCreds MCP server is ready (PID $SERVER_PID)."
    exit 0
  fi
done

echo "❌ Server process died. Check logs or run manually." >&2
exit 1