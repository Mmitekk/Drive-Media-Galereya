// ============================================================
// Data client — uses direct Google Drive API when keys are
// available, falls back to Worker API otherwise.
// Worker is always used for auth and media proxy.
// ============================================================
import { CONFIG, hasDirectApiAccess } from "./config";
import type { DriveFile, DriveFolder, MediaType } from "./types";

const BASE = "https://www.googleapis.com/drive/v3";

// ── helpers ──────────────────────────────────────────────────

function resolveMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "unknown";
}

function apiUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("key", CONFIG.GOOGLE_DRIVE_API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function workerUrl(path: string): string {
  return `${CONFIG.WORKER_URL}${path}`;
}

function getAuthHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

// ── Direct Google Drive API ──────────────────────────────────

async function fetchFoldersDirect(): Promise<DriveFolder[]> {
  const query = `'${CONFIG.GOOGLE_DRIVE_ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const url = apiUrl("/files", {
    q: query,
    fields: "nextPageToken, files(id, name, createdTime, parents)",
    pageSize: String(CONFIG.PAGE_SIZE),
    orderBy: "name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Drive API error ${res.status}`);
  }

  const data = await res.json();
  return (data.files || []).map(
    (f: Record<string, unknown>) =>
      ({
        id: f.id as string,
        name: f.name as string,
        parentId: (f.parents as string[])?.[0] ?? null,
        createdTime: f.createdTime as string,
      }) satisfies DriveFolder
  );
}

async function fetchFilesInFolderDirect(folderId: string): Promise<DriveFile[]> {
  const query = `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`;

  const url = apiUrl("/files", {
    q: query,
    fields:
      "nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, parents, size, webViewLink, webContentLink, thumbnailLink, imageMediaMetadata, videoMediaMetadata)",
    pageSize: String(CONFIG.PAGE_SIZE),
    orderBy: "createdTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Drive API error ${res.status}`);
  }

  const data = await res.json();
  return (data.files || []).map(
    (f: Record<string, unknown>) =>
      ({
        id: f.id as string,
        name: f.name as string,
        mimeType: f.mimeType as string,
        createdTime: f.createdTime as string,
        modifiedTime: f.modifiedTime as string,
        parentId: (f.parents as string[])?.[0] ?? folderId,
        size: f.size as string | undefined,
        webViewLink: f.webViewLink as string | undefined,
        webContentLink: f.webContentLink as string | undefined,
        thumbnailLink: f.thumbnailLink as string | undefined,
        mediaType: resolveMediaType(f.mimeType as string),
        width: (f.imageMediaMetadata as Record<string, unknown>)?.width as number | undefined,
        height: (f.imageMediaMetadata as Record<string, unknown>)?.height as number | undefined,
        durationMs: (f.videoMediaMetadata as Record<string, unknown>)?.durationMillis as number | undefined,
      }) satisfies DriveFile
  );
}

// ── Worker API (fallback) ────────────────────────────────────

async function fetchFoldersViaWorker(token?: string): Promise<DriveFolder[]> {
  const res = await fetch(workerUrl("/folders"), {
    headers: getAuthHeaders(token),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Worker API error ${res.status}`);
  }
  const data = await res.json();
  return (data.folders || data || []).map(
    (f: Record<string, unknown>) =>
      ({
        id: f.id as string,
        name: f.name as string,
        parentId: (f.parentId as string) || (f.parents as string[])?.[0] || null,
        createdTime: f.createdTime as string,
      }) satisfies DriveFolder
  );
}

async function fetchFilesInFolderViaWorker(
  folderId: string,
  token?: string
): Promise<DriveFile[]> {
  const res = await fetch(workerUrl(`/files/${folderId}`), {
    headers: getAuthHeaders(token),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Worker API error ${res.status}`);
  }
  const data = await res.json();
  return (data.files || data || []).map(
    (f: Record<string, unknown>) =>
      ({
        id: f.id as string,
        name: f.name as string,
        mimeType: f.mimeType as string,
        createdTime: f.createdTime as string,
        modifiedTime: f.modifiedTime as string,
        parentId: (f.parents as string[])?.[0] || folderId,
        size: f.size as string | undefined,
        webViewLink: f.webViewLink as string | undefined,
        webContentLink: f.webContentLink as string | undefined,
        thumbnailLink: f.thumbnailLink as string | undefined,
        mediaType: resolveMediaType(f.mimeType as string),
        width: (f.imageMediaMetadata as Record<string, unknown>)?.width as number | undefined,
        height: (f.imageMediaMetadata as Record<string, unknown>)?.height as number | undefined,
        durationMs: (f.videoMediaMetadata as Record<string, unknown>)?.durationMillis as number | undefined,
      }) satisfies DriveFile
  );
}

// ── public API (auto-selects direct or Worker) ───────────────

export async function fetchFolders(token?: string): Promise<DriveFolder[]> {
  if (hasDirectApiAccess()) {
    return fetchFoldersDirect();
  }
  return fetchFoldersViaWorker(token);
}

export async function fetchFilesInFolder(
  folderId: string,
  token?: string
): Promise<DriveFile[]> {
  if (hasDirectApiAccess()) {
    return fetchFilesInFolderDirect(folderId);
  }
  return fetchFilesInFolderViaWorker(folderId, token);
}

export async function fetchRootFiles(token?: string): Promise<DriveFile[]> {
  if (hasDirectApiAccess()) {
    return fetchFilesInFolderDirect(CONFIG.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  }
  return fetchFilesInFolderViaWorker("root", token);
}

// ── URL helpers ──────────────────────────────────────────────

export function getThumbnailUrl(
  fileId: string,
  size: number = CONFIG.THUMBNAIL_SIZE
): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

export function getImageUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

export function getVideoEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function getDirectDownloadUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.GOOGLE_DRIVE_API_KEY}`;
}

export function getWorkerMediaUrl(fileId: string, token?: string): string {
  const base = workerUrl(`/media/${fileId}`);
  if (token) return `${base}?token=${token}`;
  return base;
}

/** Get thumbnail URL through Worker proxy — primary method for private files */
export function getWorkerThumbnailUrl(fileId: string, token?: string, size: number = CONFIG.THUMBNAIL_SIZE): string {
  const base = workerUrl(`/thumbnail/${fileId}`);
  const params = new URLSearchParams();
  params.set("sz", `w${size}`);
  if (token) params.set("token", token);
  return `${base}?${params.toString()}`;
}

export function formatFileSize(bytes: string | undefined): string {
  if (!bytes) return "";
  const n = Number(bytes);
  if (isNaN(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function formatDuration(ms: number | undefined): string {
  if (!ms) return "";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
