// ============================================================
// Custom Next.js server with API proxy
// ============================================================
// Intercepts /dmga-api/* requests and proxies them to the
// Cloudflare Worker. This bypasses workers.dev blocking in Russia
// since the browser only talks to this server (same origin).
//
// Usage: node server.js (instead of next dev / next start)
// ============================================================

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");

const WORKER_ORIGIN = "https://dmga-api.galinakostrik2023.workers.dev";
const API_PREFIX = "/dmga-api";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;

    // ── Proxy /dmga-api/* → Cloudflare Worker ──
    if (pathname.startsWith(API_PREFIX)) {
      const workerPath = pathname.slice(API_PREFIX.length) || "/";
      const workerUrl = WORKER_ORIGIN + workerPath + (parsedUrl.search || "");

      console.log(`[proxy] ${req.method} ${pathname} → ${workerUrl}`);

      try {
        // Collect request body
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

        // Forward request to Worker
        const workerHeaders = { ...req.headers };
        delete workerHeaders["host"];
        delete workerHeaders["connection"];
        delete workerHeaders["transfer-encoding"];
        workerHeaders["host"] = "dmga-api.galinakostrik2023.workers.dev";

        const workerRes = await fetch(workerUrl, {
          method: req.method,
          headers: workerHeaders,
          body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
        });

        // Copy response headers
        for (const [key, value] of workerRes.headers.entries()) {
          // Skip hop-by-hop headers
          if (
            key === "transfer-encoding" ||
            key === "connection" ||
            key === "keep-alive"
          )
            continue;
          res.setHeader(key, value);
        }

        // Ensure CORS allows the frontend
        res.setHeader("Access-Control-Allow-Origin", "*");

        res.statusCode = workerRes.status;

        // Stream response body
        const arrayBuffer = await workerRes.arrayBuffer();
        res.end(Buffer.from(arrayBuffer));
      } catch (err) {
        console.error(`[proxy] Error proxying ${pathname}:`, err.message);
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: "Прокси-сервер не смог подключиться к API",
          })
        );
      }
      return;
    }

    // ── Everything else → Next.js ──
    handle(req, res, parsedUrl);
  }).listen(3000, () => {
    console.log(`> Ready on http://localhost:3000`);
    console.log(`> API proxy: ${API_PREFIX}/* → ${WORKER_ORIGIN}/*`);
  });
});
