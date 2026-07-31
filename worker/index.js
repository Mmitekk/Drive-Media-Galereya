// ============================================================
// DMGA Cloudflare Worker — Google Drive Media Gallery API
// ============================================================
// Endpoints:
//   POST /auth/admin          — admin login by password
//   POST /auth/guest          — guest login by key-file + password
//   GET  /folders             — list folders (filtered by role)
//   GET  /files/:folderId     — list files in folder
//   GET  /files/root          — list files in root folder
//   POST /keyfile/generate    — generate guest key-file (admin only)
//   GET  /media/:fileId       — stream video/image through proxy
//   GET  /thumbnail/:fileId   — proxy thumbnail image (small, fast)
// ============================================================

const DRIVE_API = "https://www.googleapis.com/drive/v3";

// ── CORS helpers ──────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function corsResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extraHeaders },
  });
}

// ── JWT helpers (HMAC-SHA256) ─────────────────────────────────

async function signJWT(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

async function verifyJWT(token, secret) {
  try {
    if (!secret) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = await hmacSign(`${header}.${body}`, secret);
    if (sig !== expected) return null;
    const payload = JSON.parse(b64urlDecode(body));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

async function hmacSign(data, secret) {
  if (!secret) throw new Error("TOKEN_SECRET not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── AES-256-GCM encryption for key-files ──────────────────────

async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  // Format: version(1) + salt(16) + iv(12) + ciphertext
  const result = new Uint8Array(1 + 16 + 12 + encrypted.byteLength);
  result[0] = 4; // version
  result.set(salt, 1);
  result.set(iv, 17);
  result.set(new Uint8Array(encrypted), 29);
  return btoa(String.fromCharCode(...result));
}

async function decrypt(encoded, password) {
  const data = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (data[0] !== 4) throw new Error("Unsupported key-file version");
  const salt = data.slice(1, 17);
  const iv = data.slice(17, 29);
  const ciphertext = data.slice(29);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

// ── Google Drive API helpers ──────────────────────────────────

async function driveGet(path, apiKey) {
  const url = new URL(`${DRIVE_API}${path}`);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Drive API error ${res.status}`);
  }
  return res.json();
}

async function driveListFiles(query, apiKey, fields, pageSize = 200, orderBy = "name") {
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("fields", fields);
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("orderBy", orderBy);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Drive API error ${res.status}`);
  }
  return res.json();
}

// ── Auth middleware ────────────────────────────────────────────

function getBearerToken(request) {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

async function requireAuth(request, jwtSecret) {
  const token = getBearerToken(request);
  if (!token) throw new Error("Требуется авторизация");
  const payload = await verifyJWT(token, jwtSecret);
  if (!payload) throw new Error("Недействительный токен");
  return payload;
}

// ── Route handlers ────────────────────────────────────────────

async function handleAdminLogin(request, env) {
  const { password } = await request.json();
  if (!password) throw new Error("Введите пароль");

  if (password !== env.ADMIN_PASSWORD) {
    throw new Error("Неверный пароль");
  }

  const payload = {
    role: "admin",
    adminFolders: [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, // 7 days
  };

  const token = await signJWT(payload, env.TOKEN_SECRET);
  return corsResponse(JSON.stringify({ token, role: "admin", adminFolders: [] }));
}

async function handleGuestLogin(request, env) {
  const { keyFile, password } = await request.json();
  if (!keyFile) throw new Error("Загрузите ключ-файл");
  if (!password) throw new Error("Введите пароль");

  let payload;
  try {
    const decrypted = await decrypt(keyFile, password);
    payload = JSON.parse(decrypted);
  } catch {
    throw new Error("Неверный пароль или повреждённый ключ-файл");
  }

  if (payload.version !== 4) throw new Error("Неподдерживаемая версия ключ-файла");

  const jwtPayload = {
    role: "guest",
    adminFolders: payload.adminFolders || [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  };

  const token = await signJWT(jwtPayload, env.TOKEN_SECRET);
  return corsResponse(
    JSON.stringify({ token, role: "guest", adminFolders: payload.adminFolders || [] })
  );
}

async function handleGetFolders(request, env) {
  const user = await requireAuth(request, env.TOKEN_SECRET);
  const rootId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const apiKey = env.GOOGLE_DRIVE_API_KEY;

  // Recursively fetch ALL folders under root (not just direct children)
  const allFolders = [];
  const queue = [rootId]; // BFS: start from root
  const visited = new Set();

  while (queue.length > 0) {
    const parentId = queue.shift();
    if (visited.has(parentId)) continue;
    visited.add(parentId);

    const query = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const data = await driveListFiles(
      query,
      apiKey,
      "nextPageToken, files(id, name, createdTime, parents)",
      500,
      "name"
    );

    const children = data.files || [];
    for (const folder of children) {
      allFolders.push(folder);
      queue.push(folder.id); // Search inside this folder too
    }
  }

  // Filter folders based on role
  let folders = allFolders;
  if (user.role === "guest" && user.adminFolders?.length > 0) {
    // Guest can see everything EXCEPT admin-only folders AND their subfolders
    const blocked = new Set(user.adminFolders);
    // Also block any folder whose ancestor is blocked
    folders = allFolders.filter((f) => {
      const parentArr = f.parents || [];
      // Block if this folder itself or any parent in its chain is blocked
      if (blocked.has(f.id)) return false;
      // Check if any ancestor is blocked (walk up the tree)
      let checkId = parentArr[0];
      const seen = new Set();
      while (checkId && !seen.has(checkId)) {
        seen.add(checkId);
        if (blocked.has(checkId)) return false;
        const parent = allFolders.find((ff) => ff.id === checkId);
        checkId = parent?.parents?.[0];
      }
      return true;
    });
  }

  return corsResponse(JSON.stringify({ folders }));
}

async function handleGetFiles(folderId, request, env) {
  const user = await requireAuth(request, env.TOKEN_SECRET);

  // Check access
  if (user.role === "guest" && user.adminFolders?.includes(folderId)) {
    throw new Error("Доступ запрещён");
  }

  const query = `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`;
  const data = await driveListFiles(
    query,
    env.GOOGLE_DRIVE_API_KEY,
    "nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, parents, size, webViewLink, webContentLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata)",
    200,
    "createdTime desc"
  );

  return corsResponse(JSON.stringify({ files: data.files || [] }));
}

async function handleGetRootFiles(request, env) {
  return handleGetFiles(env.GOOGLE_DRIVE_ROOT_FOLDER_ID, request, env);
}

async function handleGenerateKeyFile(request, env) {
  const user = await requireAuth(request, env.TOKEN_SECRET);
  if (user.role !== "admin") throw new Error("Только для администратора");

  const { password, adminFolders } = await request.json();
  if (!password || password.length < 4) throw new Error("Пароль минимум 4 символа");
  if (!adminFolders || !Array.isArray(adminFolders)) {
    throw new Error("Укажите список папок");
  }

  const payload = JSON.stringify({
    version: 4,
    adminFolders,
    created: new Date().toISOString(),
  });

  const encrypted = await encrypt(payload, password);

  return corsResponse(JSON.stringify({ keyFile: encrypted }));
}

// ── Media streaming proxy ─────────────────────────────────────

async function handleMediaProxy(fileId, request, env) {
  // Validate token from query param (for <video> / <img> src)
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return corsResponse(JSON.stringify({ error: "Требуется авторизация" }), 401);
  }

  const user = await verifyJWT(token, env.TOKEN_SECRET);
  if (!user) {
    return corsResponse(JSON.stringify({ error: "Недействительный токен" }), 401);
  }

  // Check folder-level access
  if (user.role === "guest" && user.adminFolders?.length > 0) {
    // Need to check the file's parent folder
    try {
      const fileInfo = await driveGet(`/files/${fileId}?fields=parents&supportsAllDrives=true&includeItemsFromAllDrives=true`, env.GOOGLE_DRIVE_API_KEY);
      const parentIds = fileInfo.parents || [];
      if (parentIds.some((pid) => user.adminFolders.includes(pid))) {
        return corsResponse(JSON.stringify({ error: "Доступ запрещён" }), 403);
      }
    } catch {
      // If we can't check, allow through (file might not exist)
    }
  }

  // ── HEAD request: probe if file is accessible ──
  // The client sends a HEAD request to check if the video URL works
  // before setting it as <video src>. This prevents the native
  // browser error overlay from appearing.
  if (request.method === "HEAD") {
    // Make a small range request to Google Drive to check accessibility
    const probeUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${env.GOOGLE_DRIVE_API_KEY}&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    try {
      const probeRes = await fetch(probeUrl, {
        headers: { "Range": "bytes=0-1" }, // Just check first 2 bytes
      });
      if (probeRes.ok || probeRes.status === 206) {
        // File is accessible — return 200 with CORS headers
        const contentType = probeRes.headers.get("Content-Type") || "application/octet-stream";
        const contentLength = probeRes.headers.get("Content-Range")?.split("/")?.[1] || probeRes.headers.get("Content-Length") || "0";
        return new Response(null, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": contentType,
            "Content-Length": contentLength,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
            "X-DMGA-Status": "accessible",
          },
        });
      } else {
        // File not accessible — return the error status
        let errorMsg = `Drive API error ${probeRes.status}`;
        try {
          const errBody = await probeRes.json();
          errorMsg = errBody?.error?.message || errorMsg;
        } catch {}
        return corsResponse(JSON.stringify({ error: errorMsg }), probeRes.status);
      }
    } catch (err) {
      return corsResponse(JSON.stringify({ error: `Network error: ${err.message}` }), 502);
    }
  }

  // ── GET request: stream the file ──

  // Build Google Drive download URL (include shared drive support)
  const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${env.GOOGLE_DRIVE_API_KEY}&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  // Forward Range header from client to Google Drive
  const driveHeaders = {};
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    driveHeaders["Range"] = rangeHeader;
  }

  // Stream the response from Google Drive
  const driveResponse = await fetch(driveUrl, { headers: driveHeaders });

  if (!driveResponse.ok) {
    // Try to read error body
    let errorMsg = `Drive API error ${driveResponse.status}`;
    try {
      const errBody = await driveResponse.json();
      errorMsg = errBody?.error?.message || errorMsg;
    } catch {}
    // Return error with no-cache to prevent browser caching the error
    return corsResponse(JSON.stringify({ error: errorMsg }), driveResponse.status, {
      "Cache-Control": "no-cache",
    });
  }

  // Build response headers — stream body directly (no buffering!)
  const responseHeaders = {
    ...CORS_HEADERS,
    "Accept-Ranges": "bytes",
    "Content-Type": driveResponse.headers.get("Content-Type") || "application/octet-stream",
    // Don't cache Range requests (probe requests) — only cache full responses
    // This prevents the browser from caching a 2-byte probe response
    // and serving it to the <video> tag later
    "Cache-Control": rangeHeader ? "no-cache, no-store" : "public, max-age=3600",
  };

  // Forward Content-Range and Content-Length for partial content
  const contentRange = driveResponse.headers.get("Content-Range");
  const contentLength = driveResponse.headers.get("Content-Length");
  if (contentRange) {
    responseHeaders["Content-Range"] = contentRange;
  }
  if (contentLength) {
    responseHeaders["Content-Length"] = contentLength;
  }

  // Return streaming response — body is ReadableStream, not buffered
  return new Response(driveResponse.body, {
    status: driveResponse.status,
    headers: responseHeaders,
  });
}

// ── Thumbnail proxy ──────────────────────────────────────────
// Returns a small thumbnail image for a file. This is MUCH faster
// than /media/ because it uses Google's pre-generated thumbnail
// instead of streaming the entire file.
// Used for gallery card thumbnails and Stories circle avatars.

async function handleThumbnailProxy(fileId, request, env) {
  // Validate token from query param
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return corsResponse(JSON.stringify({ error: "Требуется авторизация" }), 401);
  }

  const user = await verifyJWT(token, env.TOKEN_SECRET);
  if (!user) {
    return corsResponse(JSON.stringify({ error: "Недействительный токен" }), 401);
  }

  // Check folder-level access for guests
  if (user.role === "guest" && user.adminFolders?.length > 0) {
    try {
      const fileInfo = await driveGet(`/files/${fileId}?fields=parents&supportsAllDrives=true&includeItemsFromAllDrives=true`, env.GOOGLE_DRIVE_API_KEY);
      const parentIds = fileInfo.parents || [];
      if (parentIds.some((pid) => user.adminFolders.includes(pid))) {
        return corsResponse(JSON.stringify({ error: "Доступ запрещён" }), 403);
      }
    } catch {
      // If we can't check, allow through
    }
  }

  // Optional size parameter: ?sz=w400 (default w400)
  const sz = url.searchParams.get("sz") || "w400";

  // Strategy 1: Use Drive API to get thumbnailLink, then proxy it
  try {
    const fileInfo = await driveGet(
      `/files/${fileId}?fields=thumbnailLink,mimeType&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      env.GOOGLE_DRIVE_API_KEY
    );

    if (fileInfo.thumbnailLink) {
      // Modify the thumbnail URL size if needed
      let thumbUrl = fileInfo.thumbnailLink;
      // Replace size suffix (e.g., =s220 → =w400)
      thumbUrl = thumbUrl.replace(/=s\d+/, `=${sz}`);

      const thumbRes = await fetch(thumbUrl);
      if (thumbRes.ok) {
        const contentType = thumbRes.headers.get("Content-Type") || "image/jpeg";
        const body = thumbRes.body;
        return new Response(body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600", // 1h cache
            "X-DMGA-Source": "thumbnailLink",
          },
        });
      }
    }
  } catch (err) {
    console.error("Thumbnail strategy 1 failed:", err.message);
  }

  // Strategy 2: Fallback — use Drive alt=media with Range request
  // This downloads just the beginning of the file, which for images
  // is enough for a small preview. For videos, it won't produce
  // a useful thumbnail, but at least won't error.
  try {
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${env.GOOGLE_DRIVE_API_KEY}&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const driveRes = await fetch(driveUrl, {
      headers: { "Range": "bytes=0-50000" }, // First 50KB — enough for a thumbnail
    });

    if (driveRes.ok || driveRes.status === 206) {
      const contentType = driveRes.headers.get("Content-Type") || "application/octet-stream";
      // Only return image types (not video)
      if (contentType.startsWith("image/")) {
        const buf = await driveRes.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
            "X-DMGA-Source": "alt-media-range",
          },
        });
      }
    }
  } catch (err) {
    console.error("Thumbnail strategy 2 failed:", err.message);
  }

  // All strategies failed — return a 1x1 transparent PNG placeholder
  const TRANSPARENT_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  return new Response(TRANSPARENT_PNG, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "image/png",
      "Cache-Control": "no-cache",
      "X-DMGA-Source": "placeholder",
    },
  });
}

// ── Main router ───────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // ── Auth ──
      if (path === "/auth/admin" && request.method === "POST") {
        return await handleAdminLogin(request, env);
      }
      if (path === "/auth/guest" && request.method === "POST") {
        return await handleGuestLogin(request, env);
      }

      // ── Folders ──
      if (path === "/folders" && request.method === "GET") {
        return await handleGetFolders(request, env);
      }

      // ── Files ──
      if (path === "/files/root" && request.method === "GET") {
        return await handleGetRootFiles(request, env);
      }
      if (path.startsWith("/files/") && request.method === "GET") {
        const folderId = path.slice("/files/".length);
        return await handleGetFiles(folderId, request, env);
      }

      // ── Key-file ──
      if (path === "/keyfile/generate" && request.method === "POST") {
        return await handleGenerateKeyFile(request, env);
      }

      // ── Media proxy (streaming) ──
      // Support both GET (stream file) and HEAD (probe accessibility)
      if (path.startsWith("/media/") && (request.method === "GET" || request.method === "HEAD")) {
        const fileId = path.slice("/media/".length);
        return await handleMediaProxy(fileId, request, env);
      }

      // ── Thumbnail proxy (fast, small image) ──
      if (path.startsWith("/thumbnail/") && request.method === "GET") {
        const fileId = path.slice("/thumbnail/".length);
        return await handleThumbnailProxy(fileId, request, env);
      }

      // ── Health check (for debugging env vars) ──
      if (path === "/health") {
        const status = {
          ok: true,
          hasApiKey: !!env.GOOGLE_DRIVE_API_KEY,
          hasRootId: !!env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
          hasAdminPassword: !!env.ADMIN_PASSWORD,
          hasTokenSecret: !!env.TOKEN_SECRET,
          tokenSecretLength: env.TOKEN_SECRET?.length || 0,
          worker: "dmga-api",
        };
        if (!status.hasApiKey || !status.hasRootId || !status.hasTokenSecret) {
          status.ok = false;
          status.missing = [];
          if (!status.hasApiKey) status.missing.push("GOOGLE_DRIVE_API_KEY");
          if (!status.hasRootId) status.missing.push("GOOGLE_DRIVE_ROOT_FOLDER_ID");
          if (!status.hasTokenSecret) status.missing.push("TOKEN_SECRET");
        }
        return corsResponse(JSON.stringify(status, null, 2), status.ok ? 200 : 500);
      }

      // ── 404 ──
      return corsResponse(JSON.stringify({ error: "Not found" }), 404);

    } catch (err) {
      const message = err instanceof Error ? err.message : "Внутренняя ошибка";
      const status =
        message.includes("авториза") || message.includes("пароль") || message.includes("токен") || message.includes("not configured")
          ? 401
          : message.includes("Доступ")
          ? 403
          : 500;
      return corsResponse(JSON.stringify({ error: message }), status);
    }
  },
};
