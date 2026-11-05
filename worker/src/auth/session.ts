import type { Env } from "../env";
import { SESSION_TTL_MS } from "../config/limits";
import { fromBase64Url, hmac, sha256Hex, timingSafeEqual, toBase64Url } from "../util/hash";

export const SESSION_COOKIE = "sb_session";

function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function signSessionId(secret: string, id: string): Promise<string> {
  return toBase64Url(await hmac(secret, id));
}

function sessionCookie(id: string, sig: string): string {
  return [
    `${SESSION_COOKIE}=${id}.${sig}`,
    "Secure",
    "HttpOnly",
    "SameSite=None",
    "Partitioned",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Secure; HttpOnly; SameSite=None; Partitioned; Path=/; Max-Age=0`;
}

export async function createSession(
  env: Env,
  userId: string,
  now = Date.now(),
): Promise<{ id: string; cookie: string; token: string }> {
  const id = randomToken();
  const sig = await signSessionId(env.WORKER_SESSION_SECRET, id);
  // Only the hash is persisted so a D1 read cannot lift a live cookie (H-2); the
  // cookie still carries the raw id + HMAC the client presents.
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(await sha256Hex(id), userId, now + SESSION_TTL_MS, now)
    .run();
  const token = `${id}.${sig}`;
  return { id, cookie: sessionCookie(id, sig), token };
}

export function readSessionCookie(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const header = req.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

/** Returns the session id when the HMAC is valid; null on malformed input or bad signature. */
export async function verifySessionCookie(
  secret: string,
  cookieValue: string | null,
): Promise<string | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null;

  const id = cookieValue.slice(0, dot);
  let provided: Uint8Array;
  try {
    provided = fromBase64Url(cookieValue.slice(dot + 1));
  } catch {
    return null;
  }
  const expected = await hmac(secret, id);
  return timingSafeEqual(expected, provided) ? id : null;
}

export type SessionUser = { user_id: string; is_admin: boolean; session_id: string };

export async function resolveSession(
  env: Env,
  req: Request,
  now = Date.now(),
): Promise<SessionUser | null> {
  const id = await verifySessionCookie(env.WORKER_SESSION_SECRET, readSessionCookie(req));
  if (!id) return null;

  // The stored primary key is sha256(id), so hash the cookie id before the SELECT.
  const hashedId = await sha256Hex(id);
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id AS user_id, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(hashedId)
    .first<{ expires_at: number; user_id: string; is_admin: number }>();

  if (!row || row.expires_at <= now) return null;
  return { user_id: row.user_id, is_admin: row.is_admin === 1, session_id: hashedId };
}
