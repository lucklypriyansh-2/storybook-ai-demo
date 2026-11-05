import type { Ctx } from "../router";
import { requireSession } from "../auth/middleware";
import { consumeInvite, validateInvite } from "../auth/invite";
import { clearSessionCookie, createSession } from "../auth/session";
import { consumeInviteAttempt } from "../budget/rate_limit";
import { sha256Hex } from "../util/hash";
import { clientIp, readJson, requireString } from "../util/http";
import { Unauthorized } from "../util/errors";
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
