import type { Ctx } from "../router";
import { requireSession } from "../auth/middleware";
import {
  authorizeUrl,
  exchangeCode,
  isGoogleConfigured,
  makeState,
  profileFromIdToken,
  verifyState,
} from "../auth/google";
import { consumeInvite, validateInvite } from "../auth/invite";
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from "../auth/password";
import { clearSessionCookie, createSession } from "../auth/session";
import { consumeInviteAttempt } from "../budget/rate_limit";
import { sha256Hex } from "../util/hash";
import { clientIp, readJson, requireString } from "../util/http";
import { BadRequest, ProviderDisabled, Unauthorized } from "../util/errors";
import { uuid } from "../util/uuid";

export async function invite({ env, req }: Ctx): Promise<Response> {
  const body = await readJson(req);
  const code = requireString(body, "code");
  const email = requireString(body, "email");

  // Cap guessing before touching the DB or validating the code (H-5).
  await consumeInviteAttempt(env.DB, clientIp(req));

  await validateInvite(env.DB, code);

  const emailHash = await sha256Hex(email.toLowerCase());
  let user = await env.DB.prepare("SELECT id, is_admin FROM users WHERE email_hash = ?")
    .bind(emailHash)
    .first<{ id: string; is_admin: number }>();

  if (!user) {
    // Only a net-new user burns an invite use (H-1); returning logins do not.
    if (!(await consumeInvite(env.DB, code))) throw new Unauthorized("invite_code_exhausted");
    const id = uuid();
    await env.DB.prepare(
      "INSERT INTO users (id, email_hash, invite_code, is_admin, created_at) VALUES (?, ?, ?, 0, ?)",
    )
      .bind(id, emailHash, code, Date.now())
      .run();
    user = { id, is_admin: 0 };
  }

  const { cookie, token } = await createSession(env, user.id);
  return Response.json(
    { user_id: user.id, is_admin: user.is_admin === 1, session_token: token },
    { headers: { "Set-Cookie": cookie } },
  );
}

export async function me({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  return Response.json({ user_id: session.user_id, is_admin: session.is_admin });
}

export async function logout({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.session_id).run();
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new BadRequest("email_required");
  const trimmed = value.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) throw new BadRequest("email_invalid");
  return trimmed;
}

function assertPassword(value: unknown): string {
  if (typeof value !== "string") throw new BadRequest("password_required");
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    throw new BadRequest("password_length");
  }
  return value;
}

/**
 * Email + password signup. No invite code required — this is the new default
 * way in. An existing row for the same email returns 400 `email_in_use` rather
 * than silently resetting their password.
 */
export async function register({ env, req }: Ctx): Promise<Response> {
  const body = await readJson<{ email?: unknown; password?: unknown }>(req);
  const email = normalizeEmail(body.email);
  const password = assertPassword(body.password);

  // Cheap IP-level rate limit so this route is not an unlimited user-creation
  // endpoint. Reuses the pre-session invite bucket (H-5) — a brand-new account
  // is as expensive to create as validating an invite code.
  await consumeInviteAttempt(env.DB, clientIp(req));

  const emailHash = await sha256Hex(email);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email_hash = ?")
    .bind(emailHash)
    .first<{ id: string }>();
  if (existing) throw new BadRequest("email_in_use");

  const passwordHash = await hashPassword(password);
  const id = uuid();
  await env.DB.prepare(
    "INSERT INTO users (id, email_hash, invite_code, is_admin, created_at, password_hash, auth_kind) VALUES (?, ?, ?, 0, ?, ?, 'email')",
  )
    .bind(id, emailHash, "email", Date.now(), passwordHash)
    .run();

  const { cookie, token } = await createSession(env, id);
  return Response.json(
    { user_id: id, is_admin: false, session_token: token },
    { headers: { "Set-Cookie": cookie } },
  );
}

/**
 * Email + password login. 401 `invalid_credentials` on *either* an unknown
 * email or a bad password — never distinguish, so the response is useless for
 * account enumeration. A user who signed up via Google (no password_hash) also
 * lands on `invalid_credentials` for the same reason.
 */
export async function login({ env, req }: Ctx): Promise<Response> {
  const body = await readJson<{ email?: unknown; password?: unknown }>(req);
  const email = normalizeEmail(body.email);
  const password = assertPassword(body.password);

  await consumeInviteAttempt(env.DB, clientIp(req));

  const emailHash = await sha256Hex(email);
  const user = await env.DB.prepare(
    "SELECT id, is_admin, password_hash FROM users WHERE email_hash = ?",
  )
    .bind(emailHash)
    .first<{ id: string; is_admin: number; password_hash: string | null }>();

  const ok = await verifyPassword(password, user?.password_hash ?? null);
  if (!user || !ok) throw new Unauthorized("invalid_credentials");

  const { cookie, token } = await createSession(env, user.id);
  return Response.json(
    { user_id: user.id, is_admin: user.is_admin === 1, session_token: token },
    { headers: { "Set-Cookie": cookie } },
  );
}

/**
 * GET /api/auth/google/start?return_to=…
 *
 * Builds the Google authorize URL, signs the return_to into state so the
 * callback can trust it, and 302s. 503 `provider_disabled` when Google env is
 * not configured — the route exists in every build so the frontend can probe
 * it, but we never send users at Google without a real client.
 */
export async function googleStart({ env, req }: Ctx): Promise<Response> {
  if (!isGoogleConfigured(env)) throw new ProviderDisabled("google");
  const url = new URL(req.url);
  const returnTo = url.searchParams.get("return_to") ?? "/";
  const state = await makeState(env.WORKER_SESSION_SECRET, returnTo);
  return new Response(null, { status: 302, headers: { Location: authorizeUrl(env, state) } });
}

/**
 * GET /api/auth/google/callback?code=…&state=…
 *
 * Exchanges the code with Google, looks up (or creates) the user keyed by
 * google_sub, mints a session, and redirects back to the verified return_to.
 * Never swallows an OAuth error from Google — a failure here results in a
 * descriptive 401 code rather than a 200 with no session.
 */
export async function googleCallback({ env, req }: Ctx): Promise<Response> {
  if (!isGoogleConfigured(env)) throw new ProviderDisabled("google");
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) throw new BadRequest("code_required");

  const returnTo = await verifyState(env.WORKER_SESSION_SECRET, state);
  if (returnTo === null) throw new Unauthorized("state_invalid");

  const tokens = await exchangeCode(env, code);
  const profile = profileFromIdToken(tokens.id_token);
  if (!profile.email_verified) throw new Unauthorized("google_email_unverified");

  const emailHash = await sha256Hex(profile.email);
  let user = await env.DB.prepare(
    "SELECT id, is_admin FROM users WHERE google_sub = ?",
  )
    .bind(profile.sub)
    .first<{ id: string; is_admin: number }>();

  if (!user) {
    // Second chance: an email-first signup can be upgraded to Google without
    // creating a duplicate row, by binding google_sub onto the existing row.
    const byEmail = await env.DB.prepare(
      "SELECT id, is_admin FROM users WHERE email_hash = ?",
    )
      .bind(emailHash)
      .first<{ id: string; is_admin: number }>();
    if (byEmail) {
      await env.DB.prepare("UPDATE users SET google_sub = ? WHERE id = ?")
        .bind(profile.sub, byEmail.id)
        .run();
      user = byEmail;
    }
  }

  if (!user) {
    const id = uuid();
    await env.DB.prepare(
      "INSERT INTO users (id, email_hash, invite_code, is_admin, created_at, google_sub, auth_kind) VALUES (?, ?, ?, 0, ?, ?, 'google')",
    )
      .bind(id, emailHash, "google", Date.now(), profile.sub)
      .run();
    user = { id, is_admin: 0 };
  }

  const { cookie } = await createSession(env, user.id);
  return new Response(null, {
    status: 302,
    headers: { "Set-Cookie": cookie, Location: returnTo },
  });
}

/**
 * GET /api/auth/providers — advertises which signup paths are available in this
 * deployment. The SPA shows/hides the Google button based on this (no point
 * sending the user at a 503 route). `invite` is always true (feature-flag stays
 * optional, see Gate).
 */
export async function providers({ env }: Ctx): Promise<Response> {
  return Response.json({
    email: true,
    invite: true,
    google: isGoogleConfigured(env),
  });
}
