const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 7000;
const HOST = "127.0.0.1";

const apps = {
  jlpt: {
    id: "jlpt",
    title: "JLPT Daily",
    subtitle: "Quan ly va doc bai hoc JLPT hang ngay",
    url: "http://127.0.0.1:3000/"
  },
  roadmap: {
    id: "roadmap",
    title: "Roadmap Words",
    subtitle: "Study the roadmap, one word at a time",
    url: "http://127.0.0.1:8000/"
  }
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
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

    const extension = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

async function checkAppHealth(app) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(app.url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error.name === "AbortError" ? "timeout" : "unreachable"
    };
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/apps") {
    sendJson(res, 200, { apps: Object.values(apps) });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/health/")) {
    const appId = requestUrl.pathname.replace("/api/health/", "");
    const app = apps[appId];

    if (!app) {
      sendJson(res, 404, { error: "Unknown app" });
      return;
    }

    const health = await checkAppHealth(app);
    sendJson(res, 200, { ...health, appId });
    return;
  }

  const publicDir = path.join(__dirname, "public");
  const staticPath =
    requestUrl.pathname === "/"
      ? path.join(publicDir, "index.html")
      : path.join(publicDir, requestUrl.pathname);

  if (!staticPath.startsWith(publicDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  serveStaticFile(res, staticPath);
});

server.listen(PORT, HOST, () => {
  console.log(`Learning Hub running at http://${HOST}:${PORT}`);
});
