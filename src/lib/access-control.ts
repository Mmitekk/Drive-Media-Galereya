// ============================================================
// Access Control — JWT-сессии, сохранение в IndexedDB
// ============================================================
//
// Теперь вся логика проверки на сервере (Cloudflare Worker).
// Клиент только хранит JWT и роль.
// API ключ и TOKEN_SALT скрыты на сервере.
//
// ============================================================

import type { Role } from "./types";

/** Сессия, сохраняемая в IndexedDB */
export interface SessionData {
  jwt: string;
  role: Role;
  adminFolders: string[];
}

// ── IndexedDB persistence ────────────────────────────────────

const DB_NAME = "dmga-gallery";
const STORE_NAME = "settings";
const SESSION_KEY = "session";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Сохранить сессию в IndexedDB */
export async function saveSession(session: SessionData): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(session, SESSION_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Загрузить сессию из IndexedDB */
export async function loadSession(): Promise<SessionData | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(SESSION_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** Очистить сессию (выход) */
export async function clearSession(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(SESSION_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
