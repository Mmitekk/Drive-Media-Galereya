// ============================================================
// DMGA Combined Server: Static Files + API Proxy
// ============================================================
// Serves the static Next.js export from /out/ AND proxies
// /dmga-api/* requests to the Cloudflare Worker.
//
// This eliminates the need to modify Caddy's Caddyfile —
// Caddy already proxies everything from :81 → :3000.
//
// Browser → Caddy(:81) → this server(:3000)
//   /dmga-api/*  → proxy → Cloudflare Worker
//   everything   → static files from /out/
// ============================================================

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const WORKER_ORIGIN = "https://dmga-api.galinakostrik2023.workers.dev";
const API_PREFIX = "/dmga-api";
const BASE_PATH = "/Drive-Media-Galereya"; // Next.js basePath from next.config.ts
const STATIC_DIR = path.join(__dirname, "out");
const PORT = 3000;

const HOP_BY_HOP = new Set([
  "host", "connection", "transfer-encoding", "keep-alive",
  "accept-encoding", "content-length",
]);

// ── MIME types ──
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm":  "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".eot":  "application/vnd.ms-fontobject",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4":  "video/mp4",
  ".txt":  "text/plain; charset=utf-8",
  ".xml":  "application/xml",
  ".map":  "application/json",
};

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

// ── Static file serving ──
function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];

  // Strip basePath so /Drive-Media-Galereya/_next/... → /_next/...
  // The files in /out/ are stored WITHOUT the basePath prefix.
  if (urlPath.startsWith(BASE_PATH + "/")) {
    urlPath = urlPath.slice(BASE_PATH.length);
  } else if (urlPath === BASE_PATH) {
    urlPath = "/";
  }

  let filePath = path.join(STATIC_DIR, urlPath);

  // Normalize: if path is a directory, try index.html
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    // File doesn't exist — try .html extension (Next.js static export pattern)
    filePath = filePath + ".html";
  }

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      // Try with .html extension
      const htmlPath = filePath + ".html";
      try {
        const htmlStat = fs.statSync(htmlPath);
        if (htmlStat.isFile()) {
          filePath = htmlPath;
        } else {
          throw new Error("not found");
        }
      } catch {
        // SPA fallback: serve index.html for client-side routing
        filePath = path.join(STATIC_DIR, "index.html");
      }
    }
  } catch {
    // Try with .html extension
    try {
      const htmlPath = filePath + ".html";
      const htmlStat = fs.statSync(htmlPath);
      if (htmlStat.isFile()) {
        filePath = htmlPath;
      } else {
        throw new Error("not found");
      }
    } catch {
      // SPA fallback
      try {
        filePath = path.join(STATIC_DIR, "index.html");
        fs.statSync(filePath);
      } catch {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>404 — Not Found</h1>");
        return;
      }
    }
  }

  const mime = getMime(filePath);
  const content = fs.readFileSync(filePath);

  // Cache static assets for 1 hour, HTML for 5 seconds
  const isHTML = filePath.endsWith(".html");
  const cacheControl = isHTML ? "public, max-age=5" : "public, max-age=3600, immutable";

  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": content.length,
    "Cache-Control": cacheControl,
  });
  res.end(content);
}

// ── API Proxy ──
function proxyApi(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, X-DMGA-Status",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  // Strip /dmga-api prefix before forwarding
  const apiPath = req.url.slice(API_PREFIX.length) || "/";
  const workerUrl = WORKER_ORIGIN + apiPath;
  console.log(`[proxy] ${req.method} ${req.url} → ${workerUrl}`);

  // Read request body
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = chunks.length > 0 ? Buffer.concat(chunks) : null;

    // Build forwarded headers
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key)) continue;
      headers[key] = value;
    }
    headers["host"] = "dmga-api.galinakostrik2023.workers.dev";
    headers["x-forwarded-for"] = req.socket.remoteAddress;

    // Forward to Worker
    const workerReq = https.request(workerUrl, {
      method: req.method,
      headers,
    }, (workerRes) => {
      // Copy response headers
      const resHeaders = {};
      for (const [key, value] of Object.entries(workerRes.headers)) {
        if (["transfer-encoding", "connection", "keep-alive", "content-encoding"].includes(key)) continue;
        resHeaders[key] = value;
      }
      resHeaders["Access-Control-Allow-Origin"] = "*";

      res.writeHead(workerRes.statusCode, resHeaders);

      // Pipe response
      workerRes.on("data", (chunk) => res.write(chunk));
      workerRes.on("end", () => res.end());
      workerRes.on("error", (err) => {
        console.error(`[proxy] Worker response error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify({ error: "Ошибка ответа от API" }));
      });
    });

    workerReq.on("error", (err) => {
      console.error(`[proxy] Worker request error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
      }
      res.end(JSON.stringify({ error: "Прокси не смог подключиться к API" }));
    });

    workerReq.setTimeout(30000, () => {
      workerReq.destroy(new Error("Worker timeout (30s)"));
    });

    // Write body
    if (body && !["GET", "HEAD"].includes(req.method)) {
      workerReq.write(body);
    }
    workerReq.end();
  });

  req.on("error", (err) => {
    console.error(`[proxy] Client request error: ${err.message}`);
  });
}

// ── Main server ──
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  // Route /dmga-api/* to proxy, everything else to static files
  // Also handle /Drive-Media-Galereya/dmga-api/* (basePath + api prefix)
  const effectiveUrl = url.startsWith(BASE_PATH + "/") ? url.slice(BASE_PATH.length) : url;
  if (effectiveUrl.startsWith(API_PREFIX + "/") || effectiveUrl === API_PREFIX) {
    // Rewrite req.url so proxyApi strips the prefix correctly
    req.url = effectiveUrl + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
    proxyApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.on("error", (err) => {
  console.error(`[server] Error: ${err.message}`);
  if (err.code === "EADDRINUSE") {
    console.error(`[server] Port ${PORT} already in use, exiting`);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`✓ DMGA combined server on http://localhost:${PORT}`);
  console.log(`  /dmga-api/* → proxy → ${WORKER_ORIGIN}`);
  console.log(`  everything  → static files from ${STATIC_DIR}`);
});
