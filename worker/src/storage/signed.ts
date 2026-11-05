import type { Env } from "../env";
import { fromBase64Url, hmac, timingSafeEqual, toBase64Url } from "../util/hash";

/** Media signatures live 1h (design §6). */
export const MEDIA_TTL_SEC = 3600;

/** Fallback origin for signed URLs; deploy sets PUBLIC_API_BASE to the real Worker. */
export const DEFAULT_PUBLIC_API_BASE = "https://storybook-ai.workers.dev";

export function publicBase(env: Env): string {
  return env.PUBLIC_API_BASE ?? DEFAULT_PUBLIC_API_BASE;
}

/** Absolute signed URL for `key`, bound to the Worker's public origin. */
export function mediaUrl(env: Env, key: string, now = Date.now()): Promise<string> {
  return signedMediaUrl(env.WORKER_SESSION_SECRET, publicBase(env), key, MEDIA_TTL_SEC, now);
}

/** Signature binds the object key and its expiry so a sig cannot be replayed elsewhere. */
async function mediaSignature(secret: string, key: string, exp: number): Promise<Uint8Array> {
  return hmac(secret, `${key}:${exp}`);
}

export async function signMediaPath(
  secret: string,
  key: string,
  ttlSec = MEDIA_TTL_SEC,
  now = Date.now(),
): Promise<{ path: string; exp: number }> {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = toBase64Url(await mediaSignature(secret, key, exp));
  return { path: `/api/media/${key}?exp=${exp}&sig=${sig}`, exp };
}

/** Absolute URL for a signed media object; `base` is the Worker's public origin. */
export async function signedMediaUrl(
  secret: string,
  base: string,
  key: string,
  ttlSec = MEDIA_TTL_SEC,
  now = Date.now(),
): Promise<string> {
  const { path } = await signMediaPath(secret, key, ttlSec, now);
  return base.replace(/\/+$/, "") + path;
}

export async function verifyMediaSignature(
  secret: string,
  key: string,
  exp: number,
  sig: string,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false;
  let provided: Uint8Array;
  try {
    provided = fromBase64Url(sig);
  } catch {
    return false;
  }
  return timingSafeEqual(await mediaSignature(secret, key, exp), provided);
}
