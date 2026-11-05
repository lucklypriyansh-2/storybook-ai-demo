import type { Env } from "../env";
import { Forbidden, Unauthorized } from "../util/errors";
import { resolveSession, type SessionUser } from "./session";

export async function requireSession(env: Env, req: Request): Promise<SessionUser> {
  const session = await resolveSession(env, req);
  if (!session) throw new Unauthorized();
  return session;
}

export async function requireAdmin(env: Env, req: Request): Promise<SessionUser> {
  const session = await requireSession(env, req);
  if (!session.is_admin) throw new Forbidden("admin_only");
  return session;
}
