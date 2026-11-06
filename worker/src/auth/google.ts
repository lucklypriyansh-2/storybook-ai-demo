// Google OAuth helpers (authorization-code flow with OpenID Connect).
//
// The route layer handles HTTP: this module is the pure-logic surface tests can
// drive without a live Google. All I/O (token exchange) is injected through a
// `fetchImpl` so unit tests can stub it.
import type { Env } from "../env";
import { fromBase64Url, hmac, timingSafeEqual, toBase64Url } from "../util/hash";
import { Unauthorized } from "../util/errors";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleProfile = { sub: string; email: string; email_verified: boolean };

export function isGoogleConfigured(env: Env): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}

/** Signed `<nonce>.<sig>` state so the callback can verify it came from us. */
export async function makeState(secret: string, returnTo: string, nonce?: string): Promise<string> {
  const payload = `${nonce ?? toBase64Url(crypto.getRandomValues(new Uint8Array(16)))}|${returnTo}`;
  const sig = toBase64Url(await hmac(secret, payload));
  return `${toBase64Url(new TextEncoder().encode(payload))}.${sig}`;
}

export async function verifyState(secret: string, state: string | null): Promise<string | null> {
  if (!state) return null;
  const dot = state.indexOf(".");
  if (dot <= 0 || dot === state.length - 1) return null;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(state.slice(0, dot));
    sigBytes = fromBase64Url(state.slice(dot + 1));
  } catch {
    return null;
  }
  const payload = new TextDecoder().decode(payloadBytes);
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(expected, sigBytes)) return null;
  const pipe = payload.indexOf("|");
  if (pipe <= 0) return null;
  return payload.slice(pipe + 1);
}

export function authorizeUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    scope: "openid email",
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "select_account",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Decodes a JWT payload without verifying the signature. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Unauthorized("google_id_token_malformed");
  try {
    const json = new TextDecoder().decode(fromBase64Url(parts[1]!));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Unauthorized("google_id_token_malformed");
  }
}

export function profileFromIdToken(idToken: string): GoogleProfile {
  const claims = decodeJwtPayload(idToken);
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (!sub || !email) throw new Unauthorized("google_id_token_missing_claims");
  return { sub, email, email_verified: emailVerified };
}

export type TokenExchange = { id_token: string; access_token?: string; expires_in?: number };

/**
 * Exchanges the authorization code for an id_token. The route layer is what
 * turns that into a user row + session. `fetchImpl` is injected so tests do
 * not call live Google.
 */
export async function exchangeCode(
  env: Env,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenExchange> {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: env.GOOGLE_REDIRECT_URI!,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Unauthorized(`google_token_http_${res.status}`);
  const json = (await res.json().catch(() => null)) as TokenExchange | null;
  if (!json?.id_token) throw new Unauthorized("google_token_no_id_token");
  return json;
}
