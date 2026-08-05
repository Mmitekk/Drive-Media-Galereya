// index.ts
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, X-DMGA-Status"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}
async function createJWT(payload, secret) {
  const header = b64url(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  );
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const msg = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = b64url(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg))
  );
  return `${msg}.${sig}`;
}
async function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const msg = `${h}.${b}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sigStr = b64urlDecode(s);
  const sigBuf = new Uint8Array(sigStr.length);
  for (let i = 0; i < sigStr.length; i++) sigBuf[i] = sigStr.charCodeAt(i);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBuf,
    new TextEncoder().encode(msg)
  );
  if (!valid) return null;
  const payload = JSON.parse(b64urlDecode(b));
  if (payload.exp && payload.exp < Date.now() / 1e3) return null;
  return payload;
}
var PBKDF2_ITERATIONS = 1e5;
var SALT_LENGTH = 16;
var IV_LENGTH = 12;
async function deriveKey(password, salt) {
  const km = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encrypt(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(data))
  );
  const combined = new Uint8Array(salt.length + iv.length + ct.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ct), salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}
async function decrypt(base64, password) {
  const combined = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (combined.length < SALT_LENGTH + IV_LENGTH + 1)
    throw new Error("\u041F\u043E\u0432\u0440\u0435\u0436\u0434\u0451\u043D\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043A\u043B\u044E\u0447\u0430");
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ct = combined.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt);
  let pt;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    throw new Error("\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C \u0438\u043B\u0438 \u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0451\u043D\u043D\u044B\u0439 \u0444\u0430\u0439\u043B");
  }
  return JSON.parse(new TextDecoder().decode(pt));
}
async function generateToken(role, adminFolders, salt) {
  const data = `${role}:${adminFolders.sort().join(",")}:${salt}`;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function driveFetch(path, params, apiKey) {
  const url = new URL(`https://www.googleapis.com/drive/v3${path}`);
  url.searchParams.set("key", apiKey);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.error ? String(body.error?.message || `Drive API error ${res.status}`) : `Drive API error ${res.status}`
    );
  }
  return res.json();
}
async function getAuth(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return verifyJWT(auth.slice(7), env.JWT_SECRET);
}
async function handleAdminAuth(request, env) {
  const body = await request.json();
  const { password } = body;
  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({ error: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C" }, 401);
  }
  const now = Math.floor(Date.now() / 1e3);
  const jwt = await createJWT(
    {
      role: "admin",
      adminFolders: [],
      iat: now,
      exp: now + 7 * 24 * 3600
      // 7 дней
    },
    env.JWT_SECRET
  );
  return json({ token: jwt, role: "admin" });
}
async function handleGuestAuth(request, env) {
  const body = await request.json();
  const { keyFile, password } = body;
  if (!keyFile || !password) {
    return json({ error: "\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D \u043A\u043B\u044E\u0447-\u0444\u0430\u0439\u043B \u0438\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C" }, 400);
  }
  let kf;
  try {
    kf = await decrypt(keyFile, password);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438" },
      401
    );
  }
  if (kf.v !== 4) {
    return json({ error: "\u041D\u0435\u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F \u043A\u043B\u044E\u0447-\u0444\u0430\u0439\u043B\u0430" }, 400);
  }
  const expectedToken = await generateToken(
    String(kf.role),
    kf.adminFolders || [],
    env.TOKEN_SALT
  );
  if (kf.token !== expectedToken) {
    return json({ error: "\u041A\u043B\u044E\u0447-\u0444\u0430\u0439\u043B \u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0451\u043D \u0438\u043B\u0438 \u0431\u044B\u043B \u0438\u0437\u043C\u0435\u043D\u0451\u043D" }, 401);
  }
  if (kf.role !== "guest") {
    return json({ error: "\u042D\u0442\u043E \u043D\u0435 \u0433\u043E\u0441\u0442\u0435\u0432\u043E\u0439 \u043A\u043B\u044E\u0447-\u0444\u0430\u0439\u043B" }, 400);
  }
  const now = Math.floor(Date.now() / 1e3);
  const adminFolders = kf.adminFolders || [];
  const jwt = await createJWT(
    {
      role: "guest",
      adminFolders,
      iat: now,
      exp: now + 30 * 24 * 3600
      // 30 дней
    },
    env.JWT_SECRET
  );
  return json({ token: jwt, role: "guest", adminFolders });
}
async function handleKeyFileGenerate(request, env) {
  const auth = await getAuth(request, env);
  if (!auth || auth.role !== "admin") {
    return json({ error: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430" }, 403);
  }
  const body = await request.json();
  const { password, adminFolders } = body;
  if (!password || password.length < 4) {
    return json(
      { error: "\u041F\u0430\u0440\u043E\u043B\u044C \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C \u043D\u0435 \u043C\u0435\u043D\u0435\u0435 4 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432" },
      400
    );
  }
  const token = await generateToken(
    "guest",
    adminFolders || [],
    env.TOKEN_SALT
  );
  const keyFileData = {
    v: 4,
    role: "guest",
    adminFolders: adminFolders || [],
    token
  };
  const encrypted = await encrypt(keyFileData, password);
  return json({ keyFile: encrypted });
}
async function handleFolders(request, env) {
  const auth = await getAuth(request, env);
  if (!auth) {
    return json({ error: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F" }, 401);
  }
  const allFolders = [];
  let currentLevel = [env.DRIVE_ROOT_FOLDER_ID];
  const visited = /* @__PURE__ */ new Set([env.DRIVE_ROOT_FOLDER_ID]);
  const MAX_DEPTH = 10;
  const MAX_FOLDERS = 500;
  const CHUNK_SIZE = 25;
  const WALL_TIME_MS = 2e4;
  const startTime = Date.now();
  for (let depth = 0; depth < MAX_DEPTH && currentLevel.length > 0 && allFolders.length < MAX_FOLDERS; depth++) {
    if (Date.now() - startTime > WALL_TIME_MS) {
      console.log(`[DMGA] BFS timeout after ${depth} levels, ${allFolders.length} folders, ${Date.now() - startTime}ms`);
      break;
    }
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += CHUNK_SIZE) {
      if (Date.now() - startTime > WALL_TIME_MS) break;
      const chunk = currentLevel.slice(i, i + CHUNK_SIZE);
      const parentQueries = chunk.map((id) => `'${id}' in parents`).join(" or ");
      const query = `(${parentQueries}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const data = await driveFetch(
        "/files",
        {
          q: query,
          fields: "files(id, name, createdTime, parents)",
          pageSize: "500",
          orderBy: "name",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true"
        },
        env.DRIVE_API_KEY
      );
      const folders2 = data.files || [];
      for (const folder of folders2) {
        const id = folder.id;
        if (!visited.has(id)) {
          visited.add(id);
          allFolders.push(folder);
          nextLevel.push(id);
        }
      }
    }
    currentLevel = nextLevel;
  }
  console.log(`[DMGA] BFS done: ${allFolders.length} folders in ${Date.now() - startTime}ms`);
  let folders = allFolders;
  if (auth.role === "guest" && auth.adminFolders?.length > 0) {
    const adminFolders = auth.adminFolders;
    folders = folders.filter((f) => !adminFolders.includes(f.id));
  }
  return json({ folders });
}
async function handleFiles(request, env, folderId) {
  const auth = await getAuth(request, env);
  if (!auth) {
    return json({ error: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F" }, 401);
  }
  if (auth.role === "guest" && auth.adminFolders?.includes(folderId)) {
    return json({ error: "\u0414\u043E\u0441\u0442\u0443\u043F \u0437\u0430\u043F\u0440\u0435\u0449\u0451\u043D" }, 403);
  }
  const data = await driveFetch(
    "/files",
    {
      q: `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`,
      fields: "files(id, name, mimeType, createdTime, modifiedTime, parents, size, webViewLink, webContentLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata)",
      pageSize: "200",
      orderBy: "createdTime desc",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true"
    },
    env.DRIVE_API_KEY
  );
  return json({ files: data.files || [] });
}
async function handleBatchFiles(request, env) {
  const auth = await getAuth(request, env);
  if (!auth) {
    return json({ error: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F" }, 401);
  }
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam) {
    return json({ error: "\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u044B ID \u043F\u0430\u043F\u043E\u043A (\u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440 ids)" }, 400);
  }
  const folderIds = idsParam.split(",").filter(Boolean);
  if (folderIds.length === 0) {
    return json({ error: "\u041F\u0443\u0441\u0442\u043E\u0439 \u0441\u043F\u0438\u0441\u043E\u043A ID \u043F\u0430\u043F\u043E\u043A" }, 400);
  }
  const adminFolders = auth.adminFolders || [];
  const allowedFolderIds = auth.role === "guest" && adminFolders.length > 0 ? folderIds.filter((id) => !adminFolders.includes(id)) : folderIds;
  if (allowedFolderIds.length === 0) {
    return json({ files: {} });
  }
  const BATCH_CHUNK_SIZE = 25;
  const filesByFolder = {};
  for (let i = 0; i < allowedFolderIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = allowedFolderIds.slice(i, i + BATCH_CHUNK_SIZE);
    const parentQueries = chunk.map((id) => `'${id}' in parents`).join(" or ");
    const query = `(${parentQueries}) and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`;
    const data = await driveFetch(
      "/files",
      {
        q: query,
        fields: "files(id, name, mimeType, createdTime, modifiedTime, parents, size, webViewLink, webContentLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata)",
        pageSize: "1000",
        orderBy: "createdTime desc",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true"
      },
      env.DRIVE_API_KEY
    );
    const rawFiles = data.files || [];
    for (const file of rawFiles) {
      const parents = file.parents || [];
      for (const parentId of parents) {
        if (allowedFolderIds.includes(parentId)) {
          if (!filesByFolder[parentId]) filesByFolder[parentId] = [];
          filesByFolder[parentId].push(file);
        }
      }
    }
  }
  for (const folderId of allowedFolderIds) {
    if (!filesByFolder[folderId]) {
      filesByFolder[folderId] = [];
    }
  }
  return json({ files: filesByFolder });
}
async function handleRootFiles(request, env) {
  const auth = await getAuth(request, env);
  if (!auth) {
    return json({ error: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F" }, 401);
  }
  const data = await driveFetch(
    "/files",
    {
      q: `'${env.DRIVE_ROOT_FOLDER_ID}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`,
      fields: "files(id, name, mimeType, createdTime, modifiedTime, parents, size, webViewLink, webContentLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata)",
      pageSize: "200",
      orderBy: "createdTime desc",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true"
    },
    env.DRIVE_API_KEY
  );
  return json({ files: data.files || [] });
}
async function handleMedia(request, env, fileId) {
  let token = null;
  const url = new URL(request.url);
  if (url.searchParams.has("token")) {
    token = url.searchParams.get("token");
  } else {
    const auth = await getAuth(request, env);
    if (!auth) {
      return json({ error: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F" }, 401);
    }
    token = request.headers.get("Authorization")?.slice(7) || null;
  }
  if (!token) {
    return json({ error: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F" }, 401);
  }
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) {
    return json({ error: "\u041D\u0435\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0442\u043E\u043A\u0435\u043D" }, 401);
  }
  if (request.method === "HEAD") {
    const probeUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${env.DRIVE_API_KEY}&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    try {
      const probeRes = await fetch(probeUrl, {
        headers: { "Range": "bytes=0-1" }
      });
      if (probeRes.ok || probeRes.status === 206) {
        const contentType2 = probeRes.headers.get("Content-Type") || "application/octet-stream";
        const contentLength2 = probeRes.headers.get("Content-Range")?.split("/")?.[1] || probeRes.headers.get("Content-Length") || "0";
        return new Response(null, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": contentType2,
            "Content-Length": contentLength2,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
            "X-DMGA-Status": "accessible"
          }
        });
      } else {
        let errorMsg = `Drive API error ${probeRes.status}`;
        try {
          const errBody = await probeRes.json();
          errorMsg = errBody?.error ? String(errBody.error?.message || errorMsg) : errorMsg;
        } catch {
        }
        return json({ error: errorMsg }, probeRes.status);
      }
    } catch (err) {
      return json({ error: `Network error: ${err instanceof Error ? err.message : "unknown"}` }, 502);
    }
  }
  const driveHeaders = {};
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    driveHeaders["Range"] = rangeHeader;
  }
  const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${env.DRIVE_API_KEY}&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const driveRes = await fetch(driveUrl, { headers: driveHeaders });
  if (!driveRes.ok) {
    const body = await driveRes.text().catch(() => "");
    return json(
      { error: `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0444\u0430\u0439\u043B: ${driveRes.status}` },
      driveRes.status
    );
  }
  const contentType = driveRes.headers.get("Content-Type") || "application/octet-stream";
  const contentLength = driveRes.headers.get("Content-Length");
  const contentRange = driveRes.headers.get("Content-Range");
  const acceptRanges = driveRes.headers.get("Accept-Ranges");
  const headers = {
    ...CORS_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600",
    // 1h cache
    "Accept-Ranges": acceptRanges || "bytes"
  };
  if (contentLength) headers["Content-Length"] = contentLength;
  if (contentRange) headers["Content-Range"] = contentRange;
  const isPartial = driveRes.status === 206;
  return new Response(driveRes.body, {
    status: isPartial ? 206 : 200,
    headers
  });
}
async function handleThumbnail(request, env, fileId) {
  let token = null;
  const url = new URL(request.url);
  if (url.searchParams.has("token")) {
    token = url.searchParams.get("token");
  } else {
    const auth = await getAuth(request, env);
    if (!auth) {
      return json({ error: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F" }, 401);
    }
    token = request.headers.get("Authorization")?.slice(7) || null;
  }
  if (!token) {
    return json({ error: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F" }, 401);
  }
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) {
    return json({ error: "\u041D\u0435\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0442\u043E\u043A\u0435\u043D" }, 401);
  }
  const sizeParam = url.searchParams.get("sz") || "w400";
  const size = parseInt(sizeParam.replace("w", ""), 10) || 400;
  try {
    const fileData = await driveFetch(
      `/files/${fileId}`,
      {
        fields: "thumbnailLink,mimeType",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true"
      },
      env.DRIVE_API_KEY
    );
    const thumbnailLink = fileData.thumbnailLink;
    if (thumbnailLink) {
      const sizedUrl = thumbnailLink.replace(/=s\d+$/, `=s${size}`);
      const thumbRes = await fetch(sizedUrl);
      if (thumbRes.ok) {
        const contentType = thumbRes.headers.get("Content-Type") || "image/jpeg";
        const body = await thumbRes.arrayBuffer();
        return new Response(body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    }
  } catch {
  }
  const thumbUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
  try {
    const thumbRes = await fetch(thumbUrl, {
      headers: { "Authorization": `Bearer ${env.DRIVE_API_KEY}` }
    });
    if (thumbRes.ok) {
      const contentType = thumbRes.headers.get("Content-Type") || "image/jpeg";
      const body = await thumbRes.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600"
        }
      });
    }
  } catch {
  }
  return json({ error: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u043C\u0438\u043D\u0438\u0430\u0442\u044E\u0440\u0443" }, 404);
}
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/auth/admin" && request.method === "POST") {
        return handleAdminAuth(request, env);
      }
      if (url.pathname === "/auth/guest" && request.method === "POST") {
        return handleGuestAuth(request, env);
      }
      if (url.pathname === "/keyfile/generate" && request.method === "POST") {
        return handleKeyFileGenerate(request, env);
      }
      if (url.pathname === "/folders" && request.method === "GET") {
        return handleFolders(request, env);
      }
      if (url.pathname === "/files/root" && request.method === "GET") {
        return handleRootFiles(request, env);
      }
      if (url.pathname === "/files/batch" && request.method === "GET") {
        return handleBatchFiles(request, env);
      }
      if (url.pathname.startsWith("/files/") && request.method === "GET") {
        const folderId = url.pathname.slice(7);
        return handleFiles(request, env, folderId);
      }
      if (url.pathname.startsWith("/thumbnail/") && request.method === "GET") {
        const fileId = url.pathname.slice(11);
        return handleThumbnail(request, env, fileId);
      }
      if (url.pathname.startsWith("/media/") && (request.method === "GET" || request.method === "HEAD")) {
        const fileId = url.pathname.slice(7);
        return handleMedia(request, env, fileId);
      }
      if (url.pathname === "/") {
        return json({ status: "ok", service: "DMGA API Proxy" });
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      return json({ error: message }, 500);
    }
  }
};
export {
  index_default as default
};
