const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 7070);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SETTINGS_PATH = path.join(ROOT_DIR, "resources", "settings.json");

const RONBUN_START_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.server.pid"
PORT_FILE="$ROOT_DIR/.server.port"
LOG_FILE="$ROOT_DIR/.server.log"

load_env_file() {
  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    return
  fi

  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
}

cleanup_stale_pid() {
  if [[ -f "$PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$PID_FILE")"

    if kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "Server is already running on PID $existing_pid"
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

server_is_ready() {
  node -e "
    const http = require('http');
    const request = http.get(
      { host: process.env.HOST, port: process.env.PORT, path: '/', timeout: 800 },
      (response) => process.exit(response.statusCode === 200 ? 0 : 1),
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => process.exit(1));
  " >/dev/null 2>&1
}

cd "$ROOT_DIR"
load_env_file
PORT="\${PORT:-5050}"
HOST="\${HOST:-127.0.0.1}"
cleanup_stale_pid
ensure_port_is_free

nohup env HOST="$HOST" PORT="$PORT" node server.js >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"
echo "$PORT" >"$PORT_FILE"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    break
  fi

  if HOST="$HOST" PORT="$PORT" server_is_ready; then
    echo "Server started"
    echo "PID: $SERVER_PID"
    echo "URL: http://$HOST:$PORT"
    echo "Log: $LOG_FILE"
    exit 0
  fi

  sleep 1
done

if ! kill -0 "$SERVER_PID" >/dev/null 2>&1 || ! HOST="$HOST" PORT="$PORT" server_is_ready; then
  echo "Failed to start server on port $PORT"
  echo "Recent log:"
  sed -n '1,40p' "$LOG_FILE"
  rm -f "$PID_FILE" "$PORT_FILE"
  exit 1
fi
`;

const RONBUN_STOP_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.server.pid"
PORT_FILE="$ROOT_DIR/.server.port"

read_port() {
  if [[ -f "$PORT_FILE" ]]; then
    cat "$PORT_FILE"
  else
    printf "5050"
  fi
}

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found. Server may already be stopped."
  exit 0
fi

SERVER_PID="$(cat "$PID_FILE")"
SERVER_PORT="$(read_port)"

if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  kill "$SERVER_PID"

  for _ in 1 2 3 4 5; do
    if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill -9 "$SERVER_PID"
    echo "Process $SERVER_PID did not stop gracefully. Sent SIGKILL."
  else
    echo "Stopped server PID $SERVER_PID"
  fi
else
  echo "Process $SERVER_PID is not running"
fi

PORT_LISTENER="$(lsof -tiTCP:"$SERVER_PORT" -sTCP:LISTEN || true)"
if [[ -n "$PORT_LISTENER" ]]; then
  echo "Warning: port $SERVER_PORT is still being used by PID $PORT_LISTENER"
else
  echo "Port $SERVER_PORT is free"
fi

rm -f "$PID_FILE" "$PORT_FILE"
`;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function loadSettings() {
  const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
  const parsed = JSON.parse(raw);

  return parsed.projects.map((project) => {
    const resourceDir = path.resolve(ROOT_DIR, project.resourceDir);
    return {
      ...project,
      resourceDir,
      scripts: {
        start: project.scripts?.start
          ? path.join(resourceDir, project.scripts.start)
          : null,
        stop: project.scripts?.stop
          ? path.join(resourceDir, project.scripts.stop)
          : null,
      },
    };
  });
}

function getProject(projectId) {
  const project = loadSettings().find((item) => item.id === projectId);
  if (!project) {
    throw new Error("Unknown project");
  }
  return project;
}

function fileExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type":
        mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: { ...process.env, ...(options.env || {}) },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ ok: false, code: null, stdout, stderr, error: error.message });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function checkProjectHealth(project) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    const response = await fetch(project.url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return {
      running: true,
      reachable: true,
      statusCode: response.status,
    };
  } catch (error) {
    return {
      running: false,
      reachable: false,
      statusCode: null,
      error: error.name === "AbortError" ? "timeout" : "unreachable",
    };
  }
}

async function getGitMetadata(project) {
  if (
    !fileExists(project.resourceDir) ||
    !fileExists(path.join(project.resourceDir, ".git"))
  ) {
    return {
      exists: false,
      branch: null,
      commit: null,
      dirty: false,
    };
  }

  const [branch, commit, status] = await Promise.all([
    runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: project.resourceDir,
    }),
    runCommand("git", ["rev-parse", "--short", "HEAD"], {
      cwd: project.resourceDir,
    }),
    runCommand("git", ["status", "--porcelain"], { cwd: project.resourceDir }),
  ]);

  return {
    exists: true,
    branch: branch.ok ? branch.stdout.trim() : null,
    commit: commit.ok ? commit.stdout.trim() : null,
    dirty: Boolean(status.stdout.trim()),
  };
}

function ensureRonbunScripts(project) {
  if (project.repoName !== "utils_learnJP_ronbun") {
    return;
  }

  const startScript = path.join(project.resourceDir, "start.sh");
  const stopScript = path.join(project.resourceDir, "stop.sh");

  if (!fileExists(startScript)) {
    fs.writeFileSync(startScript, RONBUN_START_SCRIPT, "utf8");
  }
  fs.chmodSync(startScript, 0o755);

  if (!fileExists(stopScript)) {
    fs.writeFileSync(stopScript, RONBUN_STOP_SCRIPT, "utf8");
  }
  fs.chmodSync(stopScript, 0o755);
}

async function buildProjectSummary(project) {
  ensureRonbunScripts(project);

  const [health, git] = await Promise.all([
    checkProjectHealth(project),
    getGitMetadata(project),
  ]);

  return {
    id: project.id,
    type: project.type || null,
    title: project.title,
    subtitle: project.subtitle,
    description: project.description,
    url: project.url,
    host: project.host,
    port: project.port,
    branch: project.branch,
    githubRepo: project.githubRepo,
    repoUrl: project.repoUrl,
    resourceDir: path.relative(ROOT_DIR, project.resourceDir),
    tags: project.tags || [],
    scripts: {
      start: path.relative(ROOT_DIR, project.scripts.start),
      stop: path.relative(ROOT_DIR, project.scripts.stop),
    },
    health,
    git,
  };
}

async function cloneProjectWithGh(project) {
  const parentDir = path.dirname(project.resourceDir);
  fs.mkdirSync(parentDir, { recursive: true });

  const result = await runCommand(
    "gh",
    ["repo", "clone", project.githubRepo, project.resourceDir],
    { cwd: ROOT_DIR },
  );

  if (!result.ok) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Failed to clone repository",
    );
  }

  ensureRonbunScripts(project);
  return result;
}

async function syncProjectWithGh(project) {
  if (!fileExists(project.resourceDir)) {
    return cloneProjectWithGh(project);
  }

  const status = await runCommand("git", ["status", "--porcelain"], {
    cwd: project.resourceDir,
  });
  const isDirty = Boolean(status.stdout.trim());
  let stashed = false;
  let output = "";

  if (isDirty) {
    const stash = await runCommand(
      "git",
      ["stash", "push", "--all", "-m", "learning-hub-temp-sync"],
      {
        cwd: project.resourceDir,
      },
    );
    output += stash.stdout + stash.stderr;
    stashed = stash.ok && !stash.stdout.includes("No local changes to save");
  }

  const sync = await runCommand(
    "gh",
    [
      "repo",
      "sync",
      "--source",
      project.githubRepo,
      "--branch",
      project.branch,
    ],
    { cwd: project.resourceDir },
  );
  output += sync.stdout + sync.stderr;

  if (stashed) {
    const pop = await runCommand("git", ["stash", "pop"], {
      cwd: project.resourceDir,
    });
    output += pop.stdout + pop.stderr;
    if (!pop.ok) {
      throw new Error(output.trim() || "Sync succeeded but stash pop failed");
    }
  }

  if (!sync.ok) {
    throw new Error(output.trim() || "Failed to sync repository");
  }

  ensureRonbunScripts(project);
  return { stdout: output, stderr: "", ok: true };
}

async function runProjectScript(project, action) {
  if (action === "restart") {
    const stopResult = await runProjectScript(project, "stop");
    const startResult = await runProjectScript(project, "start");
    return {
      ok: startResult.ok,
      stdout: `${stopResult.stdout}\n${startResult.stdout}`.trim(),
      stderr: `${stopResult.stderr}\n${startResult.stderr}`.trim(),
    };
  }

  const scriptPath = project.scripts[action];
  if (!scriptPath) {
    throw new Error(`No ${action} script configured for ${project.id}`);
  }

  ensureRonbunScripts(project);

  const result = await runCommand("bash", [scriptPath], {
    cwd: project.resourceDir,
    env: {
      HOST: String(project.host),
      PORT: String(project.port),
    },
  });
  if (!result.ok) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Failed to ${action} project`,
    );
  }
  return result;
}

async function performProjectAction(project, action) {
  if (action === "sync") {
    return syncProjectWithGh(project);
  }

  if (action === "start" || action === "stop" || action === "restart") {
    return runProjectScript(project, action);
  }

  throw new Error("Unsupported action");
}

function sanitizeStaticPath(requestPath) {
  const targetPath =
    requestPath === "/"
      ? path.join(PUBLIC_DIR, "index.html")
      : path.join(PUBLIC_DIR, requestPath);
  const normalized = path.resolve(targetPath);

  if (!normalized.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return normalized;
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && requestUrl.pathname === "/api/projects") {
      const projects = await Promise.all(
        loadSettings().map((project) => buildProjectSummary(project)),
      );
      sendJson(res, 200, {
        settingsPath: path.relative(ROOT_DIR, SETTINGS_PATH),
        resourcesRoot: "resources",
        projects,
      });
      return;
    }

    const actionMatch =
      req.method === "POST" &&
      requestUrl.pathname.match(/^\/api\/projects\/([^/]+)\/actions$/);
    if (actionMatch) {
      const [, projectId] = actionMatch;
      const project = getProject(projectId);
      const body = await collectRequestBody(req);
      const action = body.action;
      const result = await performProjectAction(project, action);
      const summary = await buildProjectSummary(project);

      sendJson(res, 200, {
        ok: true,
        action,
        output: [result.stdout, result.stderr]
          .filter(Boolean)
          .join("\n")
          .trim(),
        project: summary,
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/ports/stop") {
      const body = await collectRequestBody(req);
      const port = Number(body.port);

      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        sendJson(res, 400, {
          ok: false,
          message: "Port must be a valid number between 1 and 65535",
        });
        return;
      }

      const scriptPath = path.join(ROOT_DIR, "stop_port.sh");
      if (!fs.existsSync(scriptPath)) {
        sendJson(res, 500, {
          ok: false,
          message: "stop_port.sh is missing",
        });
        return;
      }

      const result = await runCommand("bash", [scriptPath, String(port)], {
        cwd: ROOT_DIR,
      });

      if (!result.ok) {
        sendJson(res, 500, {
          ok: false,
          message: (
            result.stderr ||
            result.stdout ||
            `Failed to stop port ${port}`
          ).trim(),
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        message: (
          result.stdout ||
          result.stderr ||
          `Port ${port} stopped`
        ).trim(),
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/storage") {
      const dirPath = requestUrl.searchParams.get("path") || "";
      try {
        const resolved = path.resolve(ROOT_DIR, dirPath);
        if (!resolved.startsWith(ROOT_DIR)) {
          sendJson(res, 403, { error: "Access denied" });
          return;
        }
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          sendJson(res, 404, { error: "Directory not found" });
          return;
        }
        const entries = fs
          .readdirSync(resolved, { withFileTypes: true })
          .filter((e) => !e.name.startsWith(".") || e.name === ".gitignore")
          .map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "dir" : "file",
            ext: e.isFile() ? path.extname(e.name).toLowerCase() : null,
          }))
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        const breadcrumbs = dirPath
          ? dirPath
              .split("/")
              .filter(Boolean)
              .map((seg, i, arr) => ({
                name: seg,
                path: arr.slice(0, i + 1).join("/"),
              }))
          : [];
        sendJson(res, 200, {
          data: { path: dirPath, entries, breadcrumbs },
          error: null,
        });
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/storage/file") {
      const filePath = requestUrl.searchParams.get("path") || "";
      try {
        const resolved = path.resolve(ROOT_DIR, filePath);
        if (!resolved.startsWith(ROOT_DIR)) {
          sendJson(res, 403, { error: "Access denied" });
          return;
        }
        if (!fs.existsSync(resolved)) {
          sendJson(res, 404, { error: "File not found" });
          return;
        }
        const stat = fs.statSync(resolved);
        if (stat.size > 1024 * 1024) {
          sendJson(res, 413, { error: "File too large", size: stat.size });
          return;
        }
        const content = fs.readFileSync(resolved, "utf-8");
        sendJson(res, 200, {
          data: {
            name: path.basename(resolved),
            ext: path.extname(resolved).toLowerCase(),
            size: stat.size,
            content,
          },
          error: null,
        });
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
      return;
    }

    const staticPath = sanitizeStaticPath(requestUrl.pathname);
    if (!staticPath) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    serveStaticFile(res, staticPath);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: error.message || "Unexpected server error",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Learning Hub running at http://${HOST}:${PORT}`);
});
