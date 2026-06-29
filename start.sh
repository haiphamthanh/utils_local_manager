#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.server.pid"
PORT_FILE="$ROOT_DIR/.server.port"
LOG_FILE="$ROOT_DIR/.server.log"
SETTINGS_FILE="$ROOT_DIR/resources/settings.json"

cleanup_stale_pid() {
  if [[ -f "$PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$PID_FILE")"

    if kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "Learning Hub is already running on PID $existing_pid"
      exit 0
    fi

    rm -f "$PID_FILE"
  fi
}

ensure_port_is_free() {
  local listener_pid
  listener_pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"

  if [[ -n "$listener_pid" ]]; then
    echo "Port $PORT is already in use by PID $listener_pid"
    exit 1
  fi
}

ensure_dependencies() {
  if [[ -d "$ROOT_DIR/node_modules" ]]; then
    return
  fi

  echo "Dependencies not found. Running yarn install..."
  yarn install
}

ensure_github_cli() {
  if command -v gh >/dev/null 2>&1; then
    return
  fi

  echo "GitHub CLI (gh) is required to sync resources before starting Learning Hub."
  exit 1
}

sync_project_repo() {
  local github_repo="$1"
  local resource_dir="$2"
  local branch="$3"
  local resource_parent
  local stash_name="learning-hub-start-sync"

  if [[ ! -d "$resource_dir/.git" ]]; then
    resource_parent="$(dirname "$resource_dir")"
    mkdir -p "$resource_parent"
    echo "Cloning $github_repo into $resource_dir"
    gh repo clone "$github_repo" "$resource_dir"
    return
  fi

  echo "Syncing $github_repo in $resource_dir"
  pushd "$resource_dir" >/dev/null

  local is_dirty
  local stashed=0
  is_dirty="$(git status --porcelain)"

  if [[ -n "$is_dirty" ]]; then
    git stash push --all -m "$stash_name" >/dev/null
    stashed=1
  fi

  gh repo sync --source "$github_repo" --branch "$branch"

  if [[ "$stashed" -eq 1 ]]; then
    git stash pop >/dev/null || {
      echo "Failed to restore local changes after syncing $github_repo"
      popd >/dev/null
      exit 1
    }
  fi

  popd >/dev/null
}

sync_resources() {
  if [[ ! -f "$SETTINGS_FILE" ]]; then
    echo "Missing settings file: $SETTINGS_FILE"
    exit 1
  fi

  ensure_github_cli

  while IFS=$'\t' read -r github_repo resource_dir branch; do
    [[ -z "$github_repo" ]] && continue
    sync_project_repo "$github_repo" "$ROOT_DIR/$resource_dir" "$branch"
  done < <(
    node -e "
      const fs = require('fs');
      const settings = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      for (const project of settings.projects || []) {
        console.log([project.githubRepo, project.resourceDir, project.branch].join('\t'));
      }
    " "$SETTINGS_FILE"
  )
}

server_is_ready() {
  node -e "
    const http = require('http');
    const request = http.get(
      { host: process.env.HOST, port: process.env.PORT, path: '/api/projects', timeout: 800 },
      (response) => process.exit(response.statusCode === 200 ? 0 : 1),
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => process.exit(1));
  " >/dev/null 2>&1
}

cd "$ROOT_DIR"
PORT="${PORT:-7070}"
HOST="${HOST:-127.0.0.1}"
cleanup_stale_pid
ensure_port_is_free
ensure_dependencies
sync_resources

nohup env HOST="$HOST" PORT="$PORT" yarn start >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"
echo "$PORT" >"$PORT_FILE"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    break
  fi

  if HOST="$HOST" PORT="$PORT" server_is_ready; then
    echo "Learning Hub started"
    echo "PID: $SERVER_PID"
    echo "URL: http://$HOST:$PORT"
    echo "Log: $LOG_FILE"
    exit 0
  fi

  sleep 1
done

if ! kill -0 "$SERVER_PID" >/dev/null 2>&1 || ! HOST="$HOST" PORT="$PORT" server_is_ready; then
  echo "Failed to start Learning Hub on port $PORT"
  echo "Recent log:"
  sed -n '1,80p' "$LOG_FILE"
  rm -f "$PID_FILE" "$PORT_FILE"
  exit 1
fi
