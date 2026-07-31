// ============================================================
// AES-256-GCM encryption for key-file protection
// Uses Web Crypto API (available in all modern browsers)
// ============================================================

const PBKDF2_ITERATIONS = 600_000; // OWASP recommendation for PBKDF2-SHA256
const SALT_LENGTH = 16; // 128-bit salt
const IV_LENGTH = 12; // 96-bit IV for GCM
const KEY_LENGTH = 256; // AES-256

/**
 * Derive an AES-256 key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
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
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a JavaScript object as a password-protected binary blob.
 * Returns base64-encoded string: [salt(16)][iv(12)][ciphertext]
 */
export async function encryptData(data: unknown, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  // Combine salt + iv + ciphertext into one buffer
  const combined = new Uint8Array(
    salt.length + iv.length + ciphertext.byteLength
  );
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

  // Convert to base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64-encoded blob back to a JavaScript object.
 * Throws if the password is wrong or data is corrupted.
 */
export async function decryptData<T = unknown>(
  base64: string,
  password: string
): Promise<T> {
  // Decode from base64
  const combined = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  if (combined.length < SALT_LENGTH + IV_LENGTH + 1) {
    throw new Error("Повреждённый файл ключа");
  }

  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(password, salt);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error("Неверный пароль или повреждённый файл");
  }

  const decoder = new TextDecoder();
  const json = decoder.decode(plaintext);

  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error("Повреждённые данные в файле ключа");
  }
}
