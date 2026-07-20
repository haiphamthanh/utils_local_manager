#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [port]"
  echo "Example: $0 3000"
}

if [[ $# -gt 1 ]]; then
  usage
  exit 1
fi

if [[ $# -eq 1 ]]; then
  PORT="$1"
else
  read -r -p "Enter port to stop: " PORT
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "Port must be a number"
  exit 1
fi

if (( PORT < 1 || PORT > 65535 )); then
  echo "Port must be between 1 and 65535"
  exit 1
fi

if command -v lsof >/dev/null 2>&1; then
  PID_LIST="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
elif command -v fuser >/dev/null 2>&1; then
  PID_LIST="$(fuser "$PORT/tcp" 2>/dev/null || true)"
else
  echo "Neither lsof nor fuser is available. Please install one of them."
  exit 1
fi

if [[ -z "$PID_LIST" ]]; then
  echo "No process is listening on port $PORT"
  exit 0
fi

for PID in $PID_LIST; do
  if ! kill -0 "$PID" 2>/dev/null; then
    continue
  fi

  echo "Stopping process $PID using port $PORT"
  kill "$PID" 2>/dev/null || true

  sleep 1

  if kill -0 "$PID" 2>/dev/null; then
    echo "Process $PID did not stop gracefully. Sending SIGKILL."
    kill -9 "$PID" 2>/dev/null || true
  fi
done

if command -v lsof >/dev/null 2>&1; then
  REMAINING="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
elif command -v fuser >/dev/null 2>&1; then
  REMAINING="$(fuser "$PORT/tcp" 2>/dev/null || true)"
fi

if [[ -n "$REMAINING" ]]; then
  echo "Port $PORT is still in use by PID(s): $REMAINING"
  exit 1
else
  echo "Port $PORT is free"
fi
