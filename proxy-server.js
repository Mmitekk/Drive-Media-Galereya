// ============================================================
// DMGA API Proxy Server
// ============================================================
// Proxies all requests to the Cloudflare Worker at
// https://dmga-api.galinakostrik2023.workers.dev
//
// This bypasses workers.dev domain blocking in Russia.
// The browser connects to this proxy (same origin as the app),
// and the proxy forwards requests to the Worker from the server
// (which is not blocked).
//
// Run: node proxy-server.js
// Port: 3001 (configured below)
// ============================================================

const http = require("http");

const WORKER_ORIGIN = "https://dmga-api.galinakostrik2023.workers.dev";
const PORT = 3001;

// Headers that should not be forwarded to the Worker
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "keep-alive",
  "accept-encoding",
  "content-length", // Let fetch set this automatically
]);

const server = http.createServer(async (req, res) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS, PUT",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
      "Access-Control-Expose-Headers":
        "Content-Range, Content-Length, Accept-Ranges, X-DMGA-Status",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  const workerUrl = WORKER_ORIGIN + req.url;
  console.log(`[dmga-proxy] ${req.method} ${req.url} → ${workerUrl}`);

  try {
    // ── Read request body ──
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : null;

    // ── Build headers for Worker ──
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key)) continue;
      headers[key] = value;
    }
    // Override host to match the Worker's expected host
    headers["host"] = "dmga-api.galinakostrik2023.workers.dev";

    // ── Forward request to Worker ──
    const workerRes = await fetch(workerUrl, {
      method: req.method,
      headers,
      body:
        body && !["GET", "HEAD"].includes(req.method) ? body : undefined,
      redirect: "manual", // Don't follow redirects — pass them through
    });

    // ── Copy response headers ──
    const resHeaders = {};
    for (const [key, value] of workerRes.headers.entries()) {
      if (
        ["transfer-encoding", "connection", "keep-alive", "content-encoding"].includes(key)
      )
        continue;
      resHeaders[key] = value;
    }
    // Ensure CORS
    resHeaders["Access-Control-Allow-Origin"] = "*";

    res.writeHead(workerRes.status, resHeaders);

    // ── Stream response body ──
    const arrayBuffer = await workerRes.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(`[dmga-proxy] Error: ${err.message}`);
    res.writeHead(502, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        error: "Прокси-сервер не смог подключиться к API. Попробуйте позже.",
      })
    );
  }
});

server.listen(PORT, () => {
  console.log(`✓ DMGA API proxy on http://localhost:${PORT}`);
  console.log(`  Proxying /* → ${WORKER_ORIGIN}/*`);
});
