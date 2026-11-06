// Email+password credential storage.
//
// Format: `pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>`.
// Uses WebCrypto's PBKDF2 so the same code runs in both the Node and Workers
// builds without pulling node:crypto. 210_000 iterations is OWASP 2023's floor
// for SHA-256.
import { fromBase64Url, timingSafeEqual, toBase64Url } from "../util/hash";

const ITERATIONS = 210_000;
const HASH_LEN_BITS = 256;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

function b64(bytes: Uint8Array): string {
  return toBase64Url(bytes);
}

function fromB64(value: string): Uint8Array {
  return fromBase64Url(value);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey(
    "raw",
    passwordBytes.buffer as ArrayBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer as ArrayBuffer, iterations },
    key,
    HASH_LEN_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

/** Returns true on a constant-time match; false for every malformed stored value. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number.parseInt(parts[1]!, 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromB64(parts[2]!);
    expected = fromB64(parts[3]!);
  } catch {
    return false;
  }
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(expected, actual);
}
