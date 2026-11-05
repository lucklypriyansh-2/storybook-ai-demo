import type { Env } from "./env";

export const DEFAULT_ALLOWED_ORIGIN = "https://lucklypriyansh-2.github.io";

const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = "content-type, authorization";

function allowedOrigin(env: Env): string {
  return env.ALLOWED_ORIGIN ?? DEFAULT_ALLOWED_ORIGIN;
}

/** Echoes the configured origin + credentials on a response (H-4). */
export function withCors(env: Env, res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", allowedOrigin(env));
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.append("Vary", "Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Short-circuits an OPTIONS preflight with the CORS headers; returns null for
 * non-preflight requests so the caller can dispatch normally.
 */
export function preflight(env: Env, req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin(env),
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": ALLOW_METHODS,
      "Access-Control-Allow-Headers": ALLOW_HEADERS,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}
