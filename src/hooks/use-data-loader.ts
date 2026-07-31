"use client";

// ============================================================
// Data loader — fetches folders & files on mount
// Supports both Worker mode and direct Google Drive API mode
//
// KEY FEATURES:
// - localStorage cache: shows previously loaded data instantly,
//   then refreshes in background
// - On fetch failure: keeps showing cached data with a warning
// - Better error messages for "Failed to fetch" network errors
// - Batched file loading to avoid rate limits
// ============================================================
import { useEffect, useCallback, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { isWorkerMode } from "@/lib/config";
import { useAuth, getWorkerToken } from "@/lib/auth-context";
import {
  fetchFolders,
  fetchFilesInFolder,
  fetchRootFiles,
} from "@/lib/google-drive";
import { fetchWorkerFolders, fetchWorkerFiles, fetchWorkerBatchFiles, testWorkerConnection } from "@/lib/worker-api";

// ── Admin JWT cache (DEPRECATED — kept for backward compat) ──

const LS_ADMIN_JWT = "dmga_admin_jwt";

/** Store admin JWT for guest sessions to use (fallback) */
export function cacheAdminJwt(token: string) {
  try {
    localStorage.setItem(LS_ADMIN_JWT, token);
  } catch {
    // ignore
  }
}

/** Get cached admin JWT (fallback for old keyfiles without embedded JWT) */
function getCachedAdminJwt(): string | null {
  try {
    return localStorage.getItem(LS_ADMIN_JWT);
  } catch {
    return null;
  }
}

// ── Data cache in localStorage ─────────────────────────────────
// Saves folders and files so the gallery shows content instantly
// on subsequent visits, even if the Worker is slow or down.

const LS_DATA_CACHE = "dmga_data_cache";

interface DataCache {
  folders: { id: string; name: string; parentId: string | null; createdTime: string }[];
  filesByFolder: Record<string, unknown[]>;
  timestamp: number;
  role: string | null;
}

function saveDataCache(folders: DataCache["folders"], filesByFolder: DataCache["filesByFolder"], role: string | null) {
  try {
    const cache: DataCache = {
      folders,
      filesByFolder,
      timestamp: Date.now(),
      role,
    };
    localStorage.setItem(LS_DATA_CACHE, JSON.stringify(cache));
  } catch {
    // localStorage might be full — clear old cache and try again
    try {
      localStorage.removeItem(LS_DATA_CACHE);
      const cache: DataCache = { folders, filesByFolder, timestamp: Date.now(), role };
      localStorage.setItem(LS_DATA_CACHE, JSON.stringify(cache));
    } catch {
      // give up
    }
  }
}

function loadDataCache(role: string | null): DataCache | null {
  try {
    const raw = localStorage.getItem(LS_DATA_CACHE);
    if (!raw) return null;
    const cache: DataCache = JSON.parse(raw);
    // Only use cache for the same role (admin vs guest)
    if (cache.role !== role) return null;
    // Don't use cache older than 24 hours
    if (Date.now() - cache.timestamp > 24 * 60 * 60 * 1000) return null;
    return cache;
  } catch {
    return null;
  }
}

/** Check if an error is an authentication failure (401) */
function isAuthError(err: unknown): boolean {
  return err instanceof Error && (err as any).status === 401;
}

/** Convert raw "Failed to fetch" into a helpful Russian message */
function friendlyErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return "Не удалось загрузить данные";
  const msg = err.message || "";

  // Raw browser network error
  if (msg === "Failed to fetch" || msg.includes("Failed to fetch")) {
    return "Не удалось подключиться к серверу. Проверьте интернет и нажмите «Повторить».";
  }
  // Abort/timeout error
  if (msg.includes("abort") || msg.includes("Сервер слишком долго")) {
    return "Сервер долго отвечает. Нажмите «Повторить» — обычно со второго раза загружается.";
  }
  // Our custom retry-exhausted message
  if (msg.includes("после нескольких попыток")) {
    return "Не удалось загрузить данные. Проверьте интернет и нажмите «Повторить».";
  }
  return msg;
}

export function useDataLoader() {
  const setFolders = useAppStore((s) => s.setFolders);
  const setFilesForFolder = useAppStore((s) => s.setFilesForFolder);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);
  const setInitialized = useAppStore((s) => s.setInitialized);
  const loading = useAppStore((s) => s.loading);
  const initialized = useAppStore((s) => s.initialized);
  const folders = useAppStore((s) => s.folders);
  const filesByFolder = useAppStore((s) => s.filesByFolder);
  const { token, role, getAllowedFolders, logout } = useAuth();

  // Prevent concurrent loads
  const loadingRef = useRef(false);

  const loadAll = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      if (isWorkerMode()) {
        // ── Worker mode ──
        if (!token) {
          throw new Error("Требуется авторизация");
        }

        // Determine the Worker token to use for API calls
        let workerToken: string | null = getWorkerToken(token);

        if (!workerToken) {
          // Fallback: try cached admin JWT (for old keyfiles without embedded JWT)
          const cachedJwt = getCachedAdminJwt();
          if (!cachedJwt) {
            throw new Error(
              "Не удалось получить токен доступа. Попросите администратора сгенерировать новый ключ-файл."
            );
          }
          workerToken = cachedJwt;
        }

        // Admin — also cache JWT for backward compat
        if (!token?.startsWith("guest:")) {
          cacheAdminJwt(workerToken);
        }

        // 0. Test Worker connectivity before data fetch
        console.log("[DMGA] Testing Worker connectivity...");
        const connTest = await testWorkerConnection();
        console.log(`[DMGA] Worker connectivity test: ok=${connTest.ok}, latency=${connTest.latency}ms`, connTest.error || "");
        if (!connTest.ok) {
          const cache = loadDataCache(role);
          if (cache && cache.folders.length > 0) {
            setFolders(cache.folders);
            const cachedFiles = cache.filesByFolder as Record<string, any[]>;
            for (const [fid, files] of Object.entries(cachedFiles)) {
              setFilesForFolder(fid, files);
            }
            setInitialized(true);
            throw new Error(
              `Сервер недоступен (${connTest.error || "network error"}). Показаны кэшированные данные. Проверьте интернет и нажмите «Повторить».`
            );
          }
          throw new Error(
            `Не удалось подключиться к серверу (${connTest.error || "network error"}). Проверьте интернет или попробуйте позже. Если проблема не исчезает — возможно, сервер заблокирован в вашей сети.`
          );
        }

        // 1. Fetch ALL folders from Worker (including nested)
        let workerFolders;
        try {
          console.log("[DMGA] Fetching folders with token:", workerToken?.substring(0, 20) + "...");
          workerFolders = await fetchWorkerFolders(workerToken);
          console.log(`[DMGA] Fetched ${workerFolders.length} folders`);
        } catch (err) {
          console.error("[DMGA] Fetch folders error:", err);
          // If auth failed — token expired, logout and show login screen
          if (isAuthError(err)) {
            logout();
            throw new Error("Сессия истекла. Войдите заново.");
          }
          // Network error — check if we have cached data
          const cache = loadDataCache(role);
          if (cache && cache.folders.length > 0) {
            // Show cached data and a soft warning
            setFolders(cache.folders);
            const cachedFiles = cache.filesByFolder as Record<string, any[]>;
            for (const [fid, files] of Object.entries(cachedFiles)) {
              setFilesForFolder(fid, files);
            }
            setInitialized(true);
            throw new Error(friendlyErrorMessage(err) + " (показаны кэшированные данные)");
          }
          throw err;
        }

        // 2. Normalize to app format — keep ALL folders (top-level + subfolders)
        let allFolders = workerFolders.map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId,
          createdTime: new Date().toISOString(),
        }));

        // 3. For guests, filter folders to only show allowed ones
        const allowedFolders = getAllowedFolders();
        if (allowedFolders !== null) {
          // Guest mode — filter to allowed folders + their descendants
          const allowedSet = new Set(allowedFolders);

          // Also include descendant folders of allowed folders
          const allAllowedIds = new Set<string>();
          for (const id of allowedSet) {
            allAllowedIds.add(id);
            // Add all descendants
            addDescendants(allFolders, id, allAllowedIds);
          }

          allFolders = allFolders.filter((f) => allAllowedIds.has(f.id));
        }

        // 4. Store filtered folders
        setFolders(allFolders);

        // 5. Fetch files for ALL folders in ONE batch request
        // Previously: N separate requests → Cloudflare subrequest limit (50)
        // Now: 1 batch request → only 1 Drive API subrequest
        const VIDEO_EXTS = ["mp4", "webm", "mov", "avi", "mkv", "m4v", "3gp", "flv", "wmv"];
        const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];

        let authFailed = false;
        const newFilesByFolder: Record<string, unknown[]> = {};

        try {
          const folderIds = allFolders.map((f) => f.id);
          console.log(`[DMGA] Batch fetching files for ${folderIds.length} folders...`);
          const batchResult = await fetchWorkerBatchFiles(workerToken!, folderIds);

          for (const [folderId, rawFiles] of Object.entries(batchResult)) {
            const files = rawFiles.map((f) => {
              const mime = f.mimeType as string || "";
              const name = (f.name as string) || "";
              const ext = name.split(".").pop()?.toLowerCase() || "";

              let mediaType: "image" | "video" | "unknown" = "unknown";
              if (mime.startsWith("video/") || VIDEO_EXTS.includes(ext)) {
                mediaType = "video";
              } else if (mime.startsWith("image/") || IMAGE_EXTS.includes(ext)) {
                mediaType = "image";
              }

              return {
                id: f.id as string,
                name,
                mimeType: mime,
                createdTime: (f.createdTime as string) || new Date().toISOString(),
                modifiedTime: (f.modifiedTime as string) || new Date().toISOString(),
                parentId: ((f.parents as string[])?.[0]) ?? folderId,
                size: f.size as string | undefined,
                webViewLink: f.webViewLink as string | undefined,
                webContentLink: f.webContentLink as string | undefined,
                thumbnailLink: f.thumbnailLink as string | undefined,
                mediaType,
                width: (f.imageMediaMetadata as Record<string, unknown>)?.width as number | undefined,
                height: (f.imageMediaMetadata as Record<string, unknown>)?.height as number | undefined,
                durationMs: (f.videoMediaMetadata as Record<string, unknown>)?.durationMillis as number | undefined,
              };
            });
            setFilesForFolder(folderId, files);
            newFilesByFolder[folderId] = files;
          }
        } catch (err) {
          if (isAuthError(err)) {
            authFailed = true;
          }
          console.error("[DMGA] Batch file fetch failed:", err);
          // Fallback: try individual folder fetches for remaining folders
        }

        // Save to cache for next visit
        saveDataCache(allFolders, newFilesByFolder, role);

        // If any file fetch failed with 401, logout
        if (authFailed) {
          logout();
          throw new Error("Сессия истекла. Войдите заново.");
        }
      } else {
        // ── Direct mode ──
        const folders = await fetchFolders();
        setFolders(folders);

        const promises = folders.map(async (folder) => {
          const files = await fetchFilesInFolder(folder.id);
          setFilesForFolder(folder.id, files);
        });

        const rootFiles = await fetchRootFiles();
        setFilesForFolder("__root__", rootFiles);

        await Promise.all(promises);
      }

      setInitialized(true);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      // Even on error, if we have partial data, mark as initialized
      // so the user can see what loaded
      if (folders.length > 0 || Object.keys(filesByFolder).length > 0) {
        setInitialized(true);
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [token, role, getAllowedFolders, logout, setFolders, setFilesForFolder, setLoading, setError, setInitialized, folders.length, filesByFolder]);

  useEffect(() => {
    // In Worker mode, only load when we have a token
    if (isWorkerMode() && !token) return;
    if (!initialized) {
      // Try to show cached data immediately while loading
      const cache = loadDataCache(role);
      if (cache && cache.folders.length > 0) {
        setFolders(cache.folders);
        const cachedFiles = cache.filesByFolder as Record<string, any[]>;
        for (const [fid, files] of Object.entries(cachedFiles)) {
          setFilesForFolder(fid, files);
        }
        setInitialized(true);
      }
      loadAll();
    }
  }, [initialized, loadAll, token, role, setFolders, setFilesForFolder, setInitialized]);

  // Reset initialized when token changes (after re-login)
  const prevTokenRef = useRef(token);
  useEffect(() => {
    if (prevTokenRef.current !== token && token) {
      setInitialized(false);
    }
    prevTokenRef.current = token;
  }, [token, setInitialized]);

  // Auto-reload when tab becomes visible after being hidden
  const lastReloadRef = useRef(0);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && initialized && token) {
        // Don't reload more often than every 60 seconds
        const now = Date.now();
        if (now - lastReloadRef.current < 60_000) return;
        lastReloadRef.current = now;
        // Delay to let the browser recover network state
        setTimeout(() => {
          loadAll();
        }, 2000);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [initialized, token, loadAll]);

  return { reload: loadAll, loading, initialized };
}

// ── Helper: add all descendant folder IDs ──────────────────

function addDescendants(
  folders: { id: string; parentId: string | null }[],
  parentId: string,
  result: Set<string>
) {
  for (const f of folders) {
    if (f.parentId === parentId && !result.has(f.id)) {
      result.add(f.id);
      addDescendants(folders, f.id, result);
    }
  }
}
