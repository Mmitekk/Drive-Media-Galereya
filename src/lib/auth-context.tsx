"use client";

// ============================================================
// Auth context — admin / guest authentication
// Admin: logs in via Worker /auth/admin → gets real JWT
// Guest: decrypts .dmga keyfile client-side → gets "guest:" token
//        with allowed folders stored locally
// ============================================================
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  adminLogin,
  isWorkerConfigured,
  type KeyfilePayload,
} from "@/lib/worker-api";

// ── types ─────────────────────────────────────────────────────

export type UserRole = "admin" | "guest" | null;

interface GuestSession {
  allowedFolders: string[];
  exp: number;
  /** Real admin JWT extracted from keyfile — used for Worker API calls */
  jwt: string;
}

interface AuthState {
  /** Current user role */
  role: UserRole;
  /** JWT token (admin: real JWT from Worker, guest: "guest:..." pseudo-token) */
  token: string | null;
  /** Whether auth is initialized (checked localStorage) */
  initialized: boolean;
  /** Login as admin with password */
  loginAdmin: (password: string) => Promise<void>;
  /** Login as guest with keyfile + password (client-side decryption) */
  loginGuest: (keyfile: KeyfilePayload, password: string) => Promise<void>;
  /** Logout */
  logout: () => void;
  /** Whether Worker is configured */
  workerAvailable: boolean;
  /** Get allowed folders for guest (null = all for admin) */
  getAllowedFolders: () => string[] | null;
}

const AuthContext = createContext<AuthState | null>(null);

// ── localStorage keys ─────────────────────────────────────────

const LS_TOKEN_KEY = "dmga_token";
const LS_ROLE_KEY = "dmga_role";
const LS_GUEST_SESSION_KEY = "dmga_guest_session";

// ── helpers ───────────────────────────────────────────────────

function isGuestToken(token: string | null): boolean {
  return !!token && token.startsWith("guest:");
}

function decodeGuestSession(token: string): GuestSession | null {
  try {
    const json = atob(token.slice(6)); // skip "guest:"
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Get the real Worker token for API calls.
 * - Admin: their JWT directly
 * - Guest: the admin JWT embedded in their keyfile
 */
export function getWorkerToken(token: string | null): string | null {
  if (!token) return null;
  if (isGuestToken(token)) {
    const session = decodeGuestSession(token);
    return session?.jwt || null;
  }
  return token;
}

// ── Decrypt keyfile client-side using Web Crypto API ──────────

interface DecryptResult {
  allowed: string[];
  jwt: string;
}

async function decryptKeyfile(
  keyfile: KeyfilePayload,
  password: string
): Promise<DecryptResult> {
  const encoder = new TextEncoder();

  // Decode base64 values
  const salt = Uint8Array.from(atob(keyfile.salt), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(keyfile.iv), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(keyfile.data), (c) => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(keyfile.tag), (c) => c.charCodeAt(0));

  // Combine data + tag for AES-GCM (Web Crypto expects them concatenated)
  const ciphertext = new Uint8Array(data.length + tag.length);
  ciphertext.set(data, 0);
  ciphertext.set(tag, data.length);

  // Derive key using PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  const payload = JSON.parse(new TextDecoder().decode(decrypted));

  if (!payload.allowed || !Array.isArray(payload.allowed)) {
    throw new Error("Неверный формат ключ-файла");
  }

  // Check expiry
  if (payload.exp && Date.now() > payload.exp) {
    throw new Error("Срок действия ключ-файла истёк");
  }

  // Return both allowed folders and embedded JWT
  return { allowed: payload.allowed, jwt: payload.jwt || "" };
}

// ── provider ──────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [initialized, setInitialized] = useState(false);

  const workerAvailable = isWorkerConfigured();

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const savedToken = localStorage.getItem(LS_TOKEN_KEY);
      const savedRole = localStorage.getItem(LS_ROLE_KEY) as UserRole;
      if (savedToken && savedRole) {
        // For guest tokens, check expiry
        if (savedRole === "guest" && isGuestToken(savedToken)) {
          const session = decodeGuestSession(savedToken);
          if (session && session.exp > Date.now()) {
            setToken(savedToken);
            setRole(savedRole);
          } else {
            // Expired — clean up
            localStorage.removeItem(LS_TOKEN_KEY);
            localStorage.removeItem(LS_ROLE_KEY);
            localStorage.removeItem(LS_GUEST_SESSION_KEY);
          }
        } else if (savedRole === "admin") {
          // For admin tokens, we'll accept it but let the data loader
          // validate it by making an API call. If it's expired, the
          // 401 handler in use-data-loader will auto-logout.
          setToken(savedToken);
          setRole(savedRole);
        }
      }
    } catch {
      // localStorage not available
    }
    setInitialized(true);
  }, []);

  const persist = useCallback((newToken: string | null, newRole: UserRole) => {
    setToken(newToken);
    setRole(newRole);
    try {
      if (newToken && newRole) {
        localStorage.setItem(LS_TOKEN_KEY, newToken);
        localStorage.setItem(LS_ROLE_KEY, newRole);
      } else {
        localStorage.removeItem(LS_TOKEN_KEY);
        localStorage.removeItem(LS_ROLE_KEY);
        localStorage.removeItem(LS_GUEST_SESSION_KEY);
      }
    } catch {
      // ignore
    }
  }, []);

  const loginAdmin = useCallback(
    async (password: string) => {
      console.log("[DMGA] Admin login attempt...");
      try {
        const result = await adminLogin(password);
        console.log("[DMGA] Admin login success, token length:", result.token?.length);
        persist(result.token, "admin");
      } catch (err) {
        console.error("[DMGA] Admin login failed:", err);
        throw err;
      }
    },
    [persist]
  );

  const loginGuest = useCallback(
    async (keyfile: KeyfilePayload, password: string) => {
      // Decrypt keyfile client-side
      const decrypted = await decryptKeyfile(keyfile, password);

      // Check expiry from keyfile itself
      if (keyfile.exp && Date.now() > keyfile.exp) {
        throw new Error("Срок действия ключ-файла истёк");
      }

      // Warn if no embedded JWT (old-style keyfile without portability)
      if (!decrypted.jwt) {
        throw new Error(
          "Ключ-файл не содержит токен доступа. Попросите администратора сгенерировать новый ключ-файл."
        );
      }

      // Create a guest pseudo-token that includes the embedded admin JWT
      const guestSession: GuestSession = {
        allowedFolders: decrypted.allowed,
        exp: keyfile.exp || Date.now() + 365 * 24 * 60 * 60 * 1000,
        jwt: decrypted.jwt,
      };
      const guestToken = "guest:" + btoa(JSON.stringify(guestSession));

      // Also store allowed folders separately for easy access
      try {
        localStorage.setItem(LS_GUEST_SESSION_KEY, JSON.stringify(guestSession));
      } catch {
        // ignore
      }

      persist(guestToken, "guest");
    },
    [persist]
  );

  const logout = useCallback(() => {
    persist(null, null);
  }, [persist]);

  const getAllowedFolders = useCallback((): string[] | null => {
    // Admin sees everything
    if (role === "admin") return null;

    // Guest — get allowed folders from token
    if (role === "guest" && token && isGuestToken(token)) {
      const session = decodeGuestSession(token);
      return session?.allowedFolders || [];
    }

    return null;
  }, [role, token]);

  return (
    <AuthContext.Provider
      value={{
        role,
        token,
        initialized,
        loginAdmin,
        loginGuest,
        logout,
        workerAvailable,
        getAllowedFolders,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ── hook ──────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
