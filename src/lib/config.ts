// ============================================================
// Google Drive Media Gallery — Configuration
// ============================================================
// Two modes:
// 1. Direct API: GOOGLE_DRIVE_API_KEY + ROOT_FOLDER_ID in .env
// 2. Via Worker: WORKER_URL in .env (Worker holds the keys)
// ============================================================

// HARDCODED FALLBACK: even if .env gets wiped, the Worker URL
// is baked into the build so the SetupGuide screen NEVER appears.
const FALLBACK_WORKER_URL = "https://dmga-api.galinakostrik2023.workers.dev";

export const CONFIG = {
  // Google Drive API key (for direct client-side access)
  GOOGLE_DRIVE_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY || "",

  // Root folder ID (for direct client-side access)
  GOOGLE_DRIVE_ROOT_FOLDER_ID:
    process.env.NEXT_PUBLIC_GOOGLE_DRIVE_ROOT_FOLDER_ID || "",

  // Cloudflare Worker URL (for auth + media proxy, and optionally data)
  // Uses hardcoded fallback if env var is missing — prevents SetupGuide screen
  WORKER_URL: process.env.NEXT_PUBLIC_WORKER_URL || FALLBACK_WORKER_URL,

  // How many files to fetch per page (max 1000 for Drive API)
  PAGE_SIZE: 200,

  // Thumbnail size for gallery cards (Drive thumbnail API)
  THUMBNAIL_SIZE: 400,

  // Auto-advance interval for Stories player (ms)
  STORY_AUTO_ADVANCE_MS: 15000,
} as const;

/** Check if app can load data (either direct API keys or Worker URL) */
export function isConfigured(): boolean {
  const hasDirectApi =
    CONFIG.GOOGLE_DRIVE_API_KEY.length > 0 &&
    CONFIG.GOOGLE_DRIVE_ROOT_FOLDER_ID.length > 0;
  const hasWorker = CONFIG.WORKER_URL.length > 0;
  return hasDirectApi || hasWorker;
}

/** Check if direct Google Drive API access is available */
export function hasDirectApiAccess(): boolean {
  return (
    CONFIG.GOOGLE_DRIVE_API_KEY.length > 0 &&
    CONFIG.GOOGLE_DRIVE_ROOT_FOLDER_ID.length > 0
  );
}

/** Check if Worker mode is active (has Worker URL but no direct API keys) */
export function isWorkerMode(): boolean {
  return CONFIG.WORKER_URL.length > 0 && !hasDirectApiAccess();
}
