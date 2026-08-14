// Cloudflare Pages Function: /dmga-api/*
// Proxies all requests under /dmga-api/ to the Cloudflare Worker.
// This replaces the Node.js proxy-server.js in production.
//
// Browser → drive-photo-gallery.ru/dmga-api/auth/admin → this function → Worker
// The browser never contacts workers.dev directly.

const WORKER_URL = "https://dmga-api.galinakostrik2023.workers.dev";

export async function onRequest(context) {
  const { request } = context;

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS, PUT, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, X-DMGA-Status",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Build the Worker URL: strip /dmga-api prefix, forward to Worker
  const url = new URL(request.url);
  const workerPath = url.pathname.replace(/^\/dmga-api/, "") || "/";
  const workerUrl = WORKER_URL + workerPath + url.search;

  // Copy headers, update Host
  const headers = new Headers(request.headers);
  headers.set("Host", "dmga-api.galinakostrik2023.workers.dev");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("cf-visitor");

  // Forward request to Worker
  const workerRequest = new Request(workerUrl, {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
  });

  try {
    const workerResponse = await fetch(workerRequest);

    // Copy response, add CORS headers
    const responseHeaders = new Headers(workerResponse.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    // Remove problematic headers
    responseHeaders.delete("cf-ray");
    responseHeaders.delete("cf-cache-status");

    return new Response(workerResponse.body, {
      status: workerResponse.status,
      statusText: workerResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Прокси не смог подключиться к API" }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
