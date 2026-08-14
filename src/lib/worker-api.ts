// ============================================================
// Cloudflare Worker API client — auth, folders, admin
// ============================================================
// Worker URL is injected at build time via NEXT_PUBLIC_WORKER_URL
// Hardcoded fallback prevents breakage if .env is accidentally wiped

const FALLBACK_WORKER_URL = "/dmga-api";

const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL || FALLBACK_WORKER_URL;

// ── types ─────────────────────────────────────────────────────

export interface WorkerFolder {
  id: string;
  name: string;
  /** Parent folder ID — extracted from 'parents' array or 'parentId' field */
  parentId: string | null;
  restricted: boolean;
}

export interface WorkerHealth {
  ok: boolean;
  hasApiKey: boolean;
  hasRootId: boolean;
  hasAdminPassword: boolean;
  hasTokenSecret: boolean;
  tokenSecretLength?: number;
}

export interface KeyfilePayload {
  version: number;
  allowedFolders: string[];
  exp: number;
  iv: string;
  tag: string;
  salt: string;
}

// ── helpers ───────────────────────────────────────────────────

function apiUrl(path: string): string {
  if (!WORKER_URL) throw new Error("NEXT_PUBLIC_WORKER_URL не задан");
  return `${WORKER_URL}${path}`;
}

// ── Retry strategy ──
// Auth endpoints: 1 retry (they should be fast)
// Data endpoints (/folders, /files): 2 retries (Worker BFS can be slow on cold start)
// Other: 3 retries
const MAX_RETRIES_AUTH = 1;
const MAX_RETRIES_DATA = 2;
const MAX_RETRIES_DEFAULT = 3;
const RETRY_DELAYS = [1000, 3000, 6000]; // ms — exponential backoff

function getMaxRetriesForPath(path: string): number {
  if (path.startsWith("/auth")) return MAX_RETRIES_AUTH;
  if (path.startsWith("/folders") || path.startsWith("/files")) return MAX_RETRIES_DATA;
  return MAX_RETRIES_DEFAULT;
}

/**
 * Make an authenticated JSON request to the Worker API.
 *
 * Timeout strategy:
 *  - Auth endpoints (/auth/*) — 15s (fast, should never be slow)
 *  - Data endpoints (/folders, /files/*) — 30s (Worker has 30s wall limit on Cloudflare;
 *    no point waiting longer — the Worker is already dead)
 *  - Default — 20s
 */
function getTimeoutForPath(path: string): number {
  if (path.startsWith("/auth")) return 15_000;
  if (path.startsWith("/folders") || path.startsWith("/files")) return 30_000;
  return 20_000;
}

async function requestJSON<T>(path: string, options: RequestInit = {}): Promise<T> {
  let lastError: Error | null = null;
  const timeout = getTimeoutForPath(path);
  const maxRetries = getMaxRetriesForPath(path);
  const url = apiUrl(path);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Create a new AbortController for each attempt so a timed-out request
    // doesn't carry over to the next retry.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      console.log(`[DMGA] fetch ${path} attempt ${attempt + 1}/${MAX_RETRIES + 1}, url=${url}`);
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      console.log(`[DMGA] fetch ${path} response: ${res.status} ${res.statusText}`);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const errorMessage = body?.error || `Worker API error ${res.status}`;
        // Attach status code so callers can detect 401 specifically
        const err = new Error(errorMessage);
        (err as any).status = res.status;
        throw err;
      }
      return res.json();
    } catch (err) {
      clearTimeout(timeoutId);

      // If it's an auth error (401/403), don't retry — re-throw immediately
      if (err instanceof Error && (err as any).status) throw err;

      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[DMGA] fetch ${path} failed: ${lastError.message}`, lastError);

      // On timeout (abort), retry for data endpoints — the Worker BFS can be slow
      // on cold starts and a retry often succeeds. Don't retry on auth timeouts.
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (isAbort && path.startsWith("/auth")) {
        throw new Error(
          "Сервер слишком долго отвечал. Попробуйте обновить страницу или повторить позже."
        );
      }

      // If we have retries left, wait and try again
      if (attempt < maxRetries) {
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        console.log(`[DMGA] retry ${path} in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // All retries exhausted
  throw new Error(
    `Не удалось подключиться к серверу (${url}) после нескольких попыток. Проверьте интернет и нажмите «Повторить». Если не помогает — возможно, сервер заблокирован в вашей сети.`
  );
}

/**
 * Extract an array from a Worker response.
 * The Worker may return:
 *   - a plain array: [...]
 *   - an object with a key: { folders: [...] } or { files: [...] }
 *   - anything else → fallback to []
 */
function extractArray<T>(data: unknown, ...keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    for (const key of keys) {
      const val = (data as Record<string, unknown>)[key];
      if (Array.isArray(val)) return val as T[];
    }
    // Try common keys automatically
    for (const key of Object.keys(data as Record<string, unknown>)) {
      const val = (data as Record<string, unknown>)[key];
      if (Array.isArray(val)) return val as T[];
    }
  }
  return [];
}

/**
 * Extract parentId from raw folder data.
 * Google Drive API returns `parents: ["id"]` (array).
 * Worker may return `parentId: "id"` or `parents: ["id"]`.
 */
function extractParentId(raw: Record<string, unknown>): string | null {
  // Try parentId first
  if (typeof raw.parentId === "string") return raw.parentId;
  // Try parents array (Google Drive API format)
  if (Array.isArray(raw.parents) && raw.parents.length > 0 && typeof raw.parents[0] === "string") {
    return raw.parents[0] as string;
  }
  return null;
}

// ── public API ────────────────────────────────────────────────

/** Check Worker health */
export async function checkHealth(): Promise<WorkerHealth> {
  return requestJSON<WorkerHealth>("/");
}

/** Admin login — returns JWT token */
export async function adminLogin(password: string): Promise<{ token: string }> {
  return requestJSON<{ token: string }>("/auth/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

/** Keyfile login — returns JWT token + role */
export async function keyfileLogin(
  keyfileData: KeyfilePayload,
  password: string
): Promise<{ token: string; role: string }> {
  return requestJSON<{ token: string; role: string }>("/auth/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyFile: keyfileData, password }),
  });
}

/**
 * Fetch ALL folders from Worker (including nested).
 * Returns normalized WorkerFolder[] with correct parentId extracted
 * from both `parentId` and `parents` array formats.
 */
export async function fetchWorkerFolders(token: string): Promise<WorkerFolder[]> {
  const data = await requestJSON<unknown>("/folders", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rawFolders = extractArray<Record<string, unknown>>(data, "folders", "items");

  return rawFolders.map((f) => ({
    id: (f.id as string) || "",
    name: (f.name as string) || "",
    parentId: extractParentId(f),
    restricted: (f.restricted as boolean) || false,
  }));
}

/** Fetch files for a folder from Worker */
export async function fetchWorkerFiles(
  token: string,
  folderId: string
): Promise<Record<string, unknown>[]> {
  const data = await requestJSON<unknown>(`/files/${folderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return extractArray<Record<string, unknown>>(data, "files", "items");
}

/**
 * Fetch files for MULTIPLE folders in a single Worker request.
 * Uses the /files/batch endpoint which makes only ONE Drive API call
 * (instead of N separate calls) — avoids the Cloudflare subrequest limit.
 *
 * Returns: { [folderId]: DriveFile[] }
 */
export async function fetchWorkerBatchFiles(
  token: string,
  folderIds: string[]
): Promise<Record<string, Record<string, unknown>[]>> {
  if (folderIds.length === 0) return {};

  const ids = folderIds.join(",");
  const data = await requestJSON<unknown>(`/files/batch?ids=${encodeURIComponent(ids)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Response format: { files: { folderId: [...], folderId: [...] } }
  if (data && typeof data === "object") {
    const filesObj = (data as Record<string, unknown>).files;
    if (filesObj && typeof filesObj === "object") {
      const result: Record<string, Record<string, unknown>[]> = {};
      for (const [folderId, files] of Object.entries(filesObj as Record<string, unknown>)) {
        if (Array.isArray(files)) {
          result[folderId] = files as Record<string, unknown>[];
        }
      }
      return result;
    }
  }

  return {};
}

/** Update folder restrictions (admin only) */
export async function updateFolderRestrictions(
  token: string,
  restrictedIds: string[]
): Promise<{ ok: boolean }> {
  return requestJSON<{ ok: boolean }>("/admin/restrictions", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ restrictedFolderIds: restrictedIds }),
  });
}

/** Generate a keyfile for guest access */
export async function generateKeyfile(
  token: string,
  password: string,
  allowedFolderIds: string[]
): Promise<KeyfilePayload> {
  return requestJSON<KeyfilePayload>("/keyfile/generate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password, adminFolders: allowedFolderIds }),
  });
}

/** Get full media URL through Worker proxy (for video playback / full image) */
export function getWorkerMediaUrl(fileId: string, token?: string): string {
  const base = `${WORKER_URL}/media/${fileId}`;
  if (token) return `${base}?token=${token}`;
  return base;
}

/** Get thumbnail URL through Worker proxy (fast, small image for gallery cards) */
export function getWorkerThumbnailUrl(fileId: string, token?: string, size: number = 400): string {
  const base = `${WORKER_URL}/thumbnail/${fileId}`;
  const params = new URLSearchParams();
  params.set("sz", `w${size}`);
  if (token) params.set("token", token);
  return `${base}?${params.toString()}`;
}

/** Get thumbnail URL — uses Google Drive thumbnail service (works without API key) */
export function getThumbnailUrl(fileId: string, size: number = 400): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

/** Get Worker URL (for checking if configured) */
export function isWorkerConfigured(): boolean {
  return WORKER_URL.length > 0;
}

/** Test Worker connectivity — returns { ok, latency, error? } */
export async function testWorkerConnection(): Promise<{
  ok: boolean;
  latency: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const res = await fetch(apiUrl("/auth/admin"), {
      method: "OPTIONS",
    });
    const latency = Date.now() - start;
    return { ok: res.ok || res.status === 204, latency };
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, latency, error: msg };
  }
}
