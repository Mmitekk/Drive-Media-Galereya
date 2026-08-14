// ============================================================
// DMGA API Proxy Server (simplified)
// ============================================================
// Proxies requests to the Cloudflare Worker, bypassing
// workers.dev DNS blocking for the browser.
//
// Browser → Caddy/dmga-api/* → this proxy → Worker (workers.dev)
// The server CAN reach workers.dev, only browsers can't.
//
// Run: node proxy-server.js
// Port: 3001
// ============================================================

const http = require("http");
const https = require("https");

const WORKER_ORIGIN = "https://dmga-api.galinakostrik2023.workers.dev";
const PORT = 3001;

const HOP_BY_HOP = new Set([
  "host", "connection", "transfer-encoding", "keep-alive",
  "accept-encoding", "content-length",
]);

const server = http.createServer((req, res) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS, PUT",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, X-DMGA-Status",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  const workerUrl = WORKER_ORIGIN + req.url;
  console.log(`[proxy] ${req.method} ${req.url} → ${workerUrl}`);

  // ── Read body ──
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = chunks.length > 0 ? Buffer.concat(chunks) : null;

    // ── Build headers ──
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key)) continue;
      headers[key] = value;
    }
    headers["host"] = "dmga-api.galinakostrik2023.workers.dev";

    // ── Forward to Worker via https.request ──
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

      // Pipe response body
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

    // Write body if present
    if (body && !["GET", "HEAD"].includes(req.method)) {
      workerReq.write(body);
    }
    workerReq.end();
  });

  req.on("error", (err) => {
    console.error(`[proxy] Client request error: ${err.message}`);
  });
});

server.on("error", (err) => {
  console.error(`[proxy] Server error: ${err.message}`);
});

server.listen(PORT, () => {
  console.log(`✓ DMGA proxy on http://localhost:${PORT}`);
  console.log(`  → ${WORKER_ORIGIN}`);
});
