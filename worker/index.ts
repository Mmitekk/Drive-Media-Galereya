// ============================================================
// Cloudflare Worker — Google Drive Media Gallery API Proxy
// ============================================================
//
// Скрывает API-ключ Google Drive на сервере.
// Проверяет JWT-токены для авторизации.
// Фильтрует папки по ролям (admin/guest) на сервере.
// Генерирует и валидирует ключ-файлы на сервере.
//
// Секреты (Settings → Variables):
//   DRIVE_API_KEY          — Google Drive API key
//   DRIVE_ROOT_FOLDER_ID   — Корневая папка Google Drive
//   ADMIN_PASSWORD         — Пароль администратора
//   JWT_SECRET             — Секрет для подписи JWT (случайная строка)
//   TOKEN_SALT             — Соль для анти-тамперинг токенов
//
// ============================================================

export interface Env {
  DRIVE_API_KEY: string;
  DRIVE_ROOT_FOLDER_ID: string;
  ADMIN_PASSWORD: string;
  JWT_SECRET: string;
  TOKEN_SALT: string;
}

// ── CORS ─────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, X-DMGA-Status",
};

// ── Helpers ──────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(str: string): string {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}

// ── JWT (HS256) ──────────────────────────────────────────────

async function createJWT(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
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

async function verifyJWT(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
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
  if (payload.exp && payload.exp < Date.now() / 1000) return null;

  return payload;
}

// ── AES-256-GCM + PBKDF2 (для ключ-файлов) ──────────────────
// Используем 100_000 итераций (вместо 600_000) для совместимости
// с лимитом CPU времени Cloudflare Worker (10мс на бесплатном тарифе).
// 100K итераций — это всё равно ~3 года брутфорса на GPU.

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
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
      hash: "SHA-256",
    },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(
  data: unknown,
  password: string
): Promise<string> {
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

async function decrypt(base64: string, password: string): Promise<unknown> {
  const combined = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (combined.length < SALT_LENGTH + IV_LENGTH + 1)
    throw new Error("Повреждённый файл ключа");

  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ct = combined.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt);

  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    throw new Error("Неверный пароль или повреждённый файл");
  }

  return JSON.parse(new TextDecoder().decode(pt));
}

// ── Anti-tampering token ─────────────────────────────────────

async function generateToken(
  role: string,
  adminFolders: string[],
  salt: string
): Promise<string> {
  const data = `${role}:${adminFolders.sort().join(",")}:${salt}`;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Google Drive API ─────────────────────────────────────────

async function driveFetch(
  path: string,
  params: Record<string, string>,
  apiKey: string
): Promise<Record<string, unknown>> {
  const url = new URL(`https://www.googleapis.com/drive/v3${path}`);
  url.searchParams.set("key", apiKey);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as Record<string, unknown>)?.error
        ? String(((body as Record<string, unknown>).error as Record<string, unknown>)?.message || `Drive API error ${res.status}`)
        : `Drive API error ${res.status}`
    );
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Auth helper ──────────────────────────────────────────────

async function getAuth(
  request: Request,
  env: Env
): Promise<Record<string, unknown> | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return verifyJWT(auth.slice(7), env.JWT_SECRET);
}

// ── Route handlers ───────────────────────────────────────────

async function handleAdminAuth(
  request: Request,
  env: Env
): Promise<Response> {
  const body = (await request.json()) as { password?: string };
  const { password } = body;

  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({ error: "Неверный пароль" }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const jwt = await createJWT(
    {
      role: "admin",
      adminFolders: [],
      iat: now,
      exp: now + 7 * 24 * 3600, // 7 дней
    },
    env.JWT_SECRET
  );

  return json({ token: jwt, role: "admin" });
}

async function handleGuestAuth(
  request: Request,
  env: Env
): Promise<Response> {
  const body = (await request.json()) as {
    keyFile?: string;
    password?: string;
  };
  const { keyFile, password } = body;

  if (!keyFile || !password) {
    return json({ error: "Не указан ключ-файл или пароль" }, 400);
  }

  let kf: Record<string, unknown>;
  try {
    kf = (await decrypt(keyFile, password)) as Record<string, unknown>;
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Ошибка расшифровки" },
      401
    );
  }

  if (kf.v !== 4) {
    return json({ error: "Неподдерживаемая версия ключ-файла" }, 400);
  }

  // Проверка анти-тамперинг токена (TOKEN_SALT скрыт на сервере!)
  const expectedToken = await generateToken(
    String(kf.role),
    (kf.adminFolders as string[]) || [],
    env.TOKEN_SALT
  );
  if (kf.token !== expectedToken) {
    return json({ error: "Ключ-файл повреждён или был изменён" }, 401);
  }

  if (kf.role !== "guest") {
    return json({ error: "Это не гостевой ключ-файл" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const adminFolders = (kf.adminFolders as string[]) || [];
  const jwt = await createJWT(
    {
      role: "guest",
      adminFolders,
      iat: now,
      exp: now + 30 * 24 * 3600, // 30 дней
    },
    env.JWT_SECRET
  );

  return json({ token: jwt, role: "guest", adminFolders });
}

async function handleKeyFileGenerate(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await getAuth(request, env);
  if (!auth || auth.role !== "admin") {
    return json({ error: "Требуется авторизация администратора" }, 403);
  }

  const body = (await request.json()) as {
    password?: string;
    adminFolders?: string[];
  };
  const { password, adminFolders } = body;

  if (!password || password.length < 4) {
    return json(
      { error: "Пароль должен быть не менее 4 символов" },
      400
    );
  }

  // Генерация анти-тамперинг токена (TOKEN_SALT скрыт на сервере!)
  const token = await generateToken(
    "guest",
    adminFolders || [],
    env.TOKEN_SALT
  );

  const keyFileData = {
    v: 4,
    role: "guest",
    adminFolders: adminFolders || [],
    token,
  };

  // Шифрование ключ-файла на сервере
  const encrypted = await encrypt(keyFileData, password);

  return json({ keyFile: encrypted });
}

async function handleFolders(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await getAuth(request, env);
  if (!auth) {
    return json({ error: "Требуется авторизация" }, 401);
  }

  // ── BFS: recursively discover ALL subfolders (not just top-level) ──
  // The old code only fetched direct children of the root folder.
  // This missed nested subfolders like "Видео / Как Шерон Стоун / Красотка в белом".
  // Now we walk the entire folder tree level by level.
  // SAFETY: stops after MAX_DEPTH levels, MAX_FOLDERS folders, or WALL_TIME_MS.
  const allFolders: Record<string, unknown>[] = [];
  let currentLevel = [env.DRIVE_ROOT_FOLDER_ID];
  const visited = new Set<string>([env.DRIVE_ROOT_FOLDER_ID]);
  const MAX_DEPTH = 10;      // Don't go deeper than 10 levels
  const MAX_FOLDERS = 500;   // Don't discover more than 500 folders
  const CHUNK_SIZE = 25;     // Max parent IDs per Drive API query (avoid URL length limits)
  const WALL_TIME_MS = 20_000; // Stop BFS after 20s to avoid Cloudflare Worker timeout (30s)
  const startTime = Date.now();

  for (let depth = 0; depth < MAX_DEPTH && currentLevel.length > 0 && allFolders.length < MAX_FOLDERS; depth++) {
    // Check wall-clock time before each level
    if (Date.now() - startTime > WALL_TIME_MS) {
      console.log(`[DMGA] BFS timeout after ${depth} levels, ${allFolders.length} folders, ${Date.now() - startTime}ms`);
      break;
    }

    const nextLevel: string[] = [];

    // Process current level in chunks to avoid Drive API query length limits
    for (let i = 0; i < currentLevel.length; i += CHUNK_SIZE) {
      // Check time before each chunk too
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
          includeItemsFromAllDrives: "true",
        },
        env.DRIVE_API_KEY
      );

      const folders = (data.files as Record<string, unknown>[]) || [];
      for (const folder of folders) {
        const id = folder.id as string;
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

  // Фильтрация папок на сервере! Гость не видит admin-папки.
  if (auth.role === "guest" && (auth.adminFolders as string[])?.length > 0) {
    const adminFolders = auth.adminFolders as string[];
    folders = folders.filter((f) => !adminFolders.includes(f.id as string));
  }

  return json({ folders });
}

async function handleFiles(
  request: Request,
  env: Env,
  folderId: string
): Promise<Response> {
  const auth = await getAuth(request, env);
  if (!auth) {
    return json({ error: "Требуется авторизация" }, 401);
  }

  // Проверка доступа к папке на сервере!
  if (
    auth.role === "guest" &&
    (auth.adminFolders as string[])?.includes(folderId)
  ) {
    return json({ error: "Доступ запрещён" }, 403);
  }

  const data = await driveFetch(
    "/files",
    {
      q: `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`,
      fields:
        "files(id, name, mimeType, createdTime, modifiedTime, parents, size, webViewLink, webContentLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata)",
      pageSize: "200",
      orderBy: "createdTime desc",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    },
    env.DRIVE_API_KEY
  );

  return json({ files: data.files || [] });
}

async function handleBatchFiles(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await getAuth(request, env);
  if (!auth) {
    return json({ error: "Требуется авторизация" }, 401);
  }

  // Parse folder IDs from query params: ?ids=id1,id2,id3
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam) {
    return json({ error: "Не указаны ID папок (параметр ids)" }, 400);
  }

  const folderIds = idsParam.split(",").filter(Boolean);
  if (folderIds.length === 0) {
    return json({ error: "Пустой список ID папок" }, 400);
  }

  // Filter out admin-only folders for guest users
  const adminFolders = (auth.adminFolders as string[]) || [];
  const allowedFolderIds = auth.role === "guest" && adminFolders.length > 0
    ? folderIds.filter((id) => !adminFolders.includes(id))
    : folderIds;

  if (allowedFolderIds.length === 0) {
    return json({ files: {} });
  }

  // ── Chunked batch: split folder IDs into chunks to avoid Drive API query length limits ──
  // With nested subfolders, the list of IDs can be very long (50+).
  // Each `'ID' in parents` clause is ~35 chars, so ~25 IDs per query is safe.
  const BATCH_CHUNK_SIZE = 25;
  const filesByFolder: Record<string, Record<string, unknown>[]> = {};

  for (let i = 0; i < allowedFolderIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = allowedFolderIds.slice(i, i + BATCH_CHUNK_SIZE);
    const parentQueries = chunk.map((id) => `'${id}' in parents`).join(" or ");
    const query = `(${parentQueries}) and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`;

    const data = await driveFetch(
      "/files",
      {
        q: query,
        fields:
          "files(id, name, mimeType, createdTime, modifiedTime, parents, size, webViewLink, webContentLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata)",
        pageSize: "1000",
        orderBy: "createdTime desc",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      },
      env.DRIVE_API_KEY
    );

    // Group files by their parent folder
    const rawFiles = (data.files as Record<string, unknown>[]) || [];
    for (const file of rawFiles) {
      const parents = (file.parents as string[]) || [];
      for (const parentId of parents) {
        if (allowedFolderIds.includes(parentId)) {
          if (!filesByFolder[parentId]) filesByFolder[parentId] = [];
          filesByFolder[parentId].push(file);
        }
      }
    }
  }

  // Ensure all requested folders have an entry (even empty ones)
  for (const folderId of allowedFolderIds) {
    if (!filesByFolder[folderId]) {
      filesByFolder[folderId] = [];
    }
  }

  return json({ files: filesByFolder });
}

async function handleRootFiles(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await getAuth(request, env);
  if (!auth) {
    return json({ error: "Требуется авторизация" }, 401);
  }

  const data = await driveFetch(
    "/files",
    {
      q: `'${env.DRIVE_ROOT_FOLDER_ID}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`,
      fields:
        "files(id, name, mimeType, createdTime, modifiedTime, parents, size, webViewLink, webContentLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata)",
      pageSize: "200",
      orderBy: "createdTime desc",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    },
    env.DRIVE_API_KEY
  );

  return json({ files: data.files || [] });
}

// ── Media proxy — streams files from Google Drive ──────────

async function handleMedia(
  request: Request,
  env: Env,
  fileId: string
): Promise<Response> {
  // Auth: check token from query param or Authorization header
  let token: string | null = null;
  const url = new URL(request.url);
  if (url.searchParams.has("token")) {
    token = url.searchParams.get("token");
  } else {
    const auth = await getAuth(request, env);
    if (!auth) {
      return json({ error: "Требуется авторизация" }, 401);
    }
    token = request.headers.get("Authorization")?.slice(7) || null;
  }

  if (!token) {
    return json({ error: "Требуется авторизация" }, 401);
  }

  // Verify JWT
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) {
    return json({ error: "Недействительный токен" }, 401);
  }

  // ── HEAD request: probe if file is accessible ──
  // The client sends a HEAD request to check if the video URL works
  // before setting it as <video src>. This prevents the native
  // browser error overlay from appearing.
  if (request.method === "HEAD") {
    const probeUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${env.DRIVE_API_KEY}&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    try {
      const probeRes = await fetch(probeUrl, {
        headers: { "Range": "bytes=0-1" },
      });
      if (probeRes.ok || probeRes.status === 206) {
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
        let errorMsg = `Drive API error ${probeRes.status}`;
        try {
          const errBody = await probeRes.json();
          errorMsg = (errBody as Record<string, unknown>)?.error
            ? String(((errBody as Record<string, unknown>).error as Record<string, unknown>)?.message || errorMsg)
            : errorMsg;
        } catch {}
        return json({ error: errorMsg }, probeRes.status as 400 | 401 | 403 | 404 | 500);
      }
    } catch (err) {
      return json({ error: `Network error: ${err instanceof Error ? err.message : "unknown"}` }, 502);
    }
  }

  // ── GET request: stream the file from Google Drive ──
  // Forward Range header for video seeking support
  const driveHeaders: Record<string, string> = {};
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    driveHeaders["Range"] = rangeHeader;
  }

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${env.DRIVE_API_KEY}&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const driveRes = await fetch(driveUrl, { headers: driveHeaders });
  if (!driveRes.ok) {
    const body = await driveRes.text().catch(() => "");
    return json(
      { error: `Не удалось получить файл: ${driveRes.status}` },
      driveRes.status as 400 | 401 | 403 | 404 | 500
    );
  }

  // Stream response with CORS headers
  const contentType = driveRes.headers.get("Content-Type") || "application/octet-stream";
  const contentLength = driveRes.headers.get("Content-Length");
  const contentRange = driveRes.headers.get("Content-Range");
  const acceptRanges = driveRes.headers.get("Accept-Ranges");
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600", // 1h cache
    "Accept-Ranges": acceptRanges || "bytes",
  };
  if (contentLength) headers["Content-Length"] = contentLength;
  if (contentRange) headers["Content-Range"] = contentRange;

  // 206 Partial Content for range requests
  const isPartial = driveRes.status === 206;
  return new Response(driveRes.body, {
    status: isPartial ? 206 : 200,
    headers,
  });
}

// ── Thumbnail proxy — returns thumbnail image from Google Drive ──
// Used as fallback when thumbnailLink is not available.
// Supports ?token= query param for auth and ?sz= for size.

async function handleThumbnail(
  request: Request,
  env: Env,
  fileId: string
): Promise<Response> {
  // Auth: check token from query param or Authorization header
  let token: string | null = null;
  const url = new URL(request.url);
  if (url.searchParams.has("token")) {
    token = url.searchParams.get("token");
  } else {
    const auth = await getAuth(request, env);
    if (!auth) {
      return json({ error: "Требуется авторизация" }, 401);
    }
    token = request.headers.get("Authorization")?.slice(7) || null;
  }

  if (!token) {
    return json({ error: "Требуется авторизация" }, 401);
  }

  // Verify JWT
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) {
    return json({ error: "Недействительный токен" }, 401);
  }

  // Get thumbnail size from query param (default w400)
  const sizeParam = url.searchParams.get("sz") || "w400";
  const size = parseInt(sizeParam.replace("w", ""), 10) || 400;

  // First, try to get the thumbnailLink from the Drive API
  try {
    const fileData = await driveFetch(
      `/files/${fileId}`,
      {
        fields: "thumbnailLink,mimeType",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      },
      env.DRIVE_API_KEY
    );

    const thumbnailLink = fileData.thumbnailLink as string | undefined;
    if (thumbnailLink) {
      // Replace the size suffix in the thumbnail URL
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
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }
  } catch {
    // thumbnailLink approach failed, try direct thumbnail
  }

  // Fallback: use drive.google.com/thumbnail
  const thumbUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
  try {
    const thumbRes = await fetch(thumbUrl, {
      headers: { "Authorization": `Bearer ${env.DRIVE_API_KEY}` },
    });
    if (thumbRes.ok) {
      const contentType = thumbRes.headers.get("Content-Type") || "image/jpeg";
      const body = await thumbRes.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
  } catch {
    // All thumbnail methods failed
  }

  return json({ error: "Не удалось получить миниатюру" }, 404);
}

// ── Main handler ─────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      // Авторизация
      if (url.pathname === "/auth/admin" && request.method === "POST") {
        return handleAdminAuth(request, env);
      }
      if (url.pathname === "/auth/guest" && request.method === "POST") {
        return handleGuestAuth(request, env);
      }

      // Генерация ключ-файлов (только для админа)
      if (url.pathname === "/keyfile/generate" && request.method === "POST") {
        return handleKeyFileGenerate(request, env);
      }

      // Данные — требуют авторизацию
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

      // Миниатюры — проксирует thumbnails из Google Drive
      if (url.pathname.startsWith("/thumbnail/") && request.method === "GET") {
        const fileId = url.pathname.slice(11);
        return handleThumbnail(request, env, fileId);
      }

      // Медиа-прокси — стримит файлы Google Drive через Worker
      // Используется для видео и полноразмерных изображений
      // Поддерживает GET (стриминг) и HEAD (проверка доступности)
      if (url.pathname.startsWith("/media/") && (request.method === "GET" || request.method === "HEAD")) {
        const fileId = url.pathname.slice(7);
        return handleMedia(request, env, fileId);
      }

      // Health check
      if (url.pathname === "/") {
        return json({ status: "ok", service: "DMGA API Proxy" });
      }

      return json({ error: "Not found" }, 404);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error";
      return json({ error: message }, 500);
    }
  },
};
