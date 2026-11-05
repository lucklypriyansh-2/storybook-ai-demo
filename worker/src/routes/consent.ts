import type { Ctx } from "../router";
import { requireSession } from "../auth/middleware";
import { readJson, requireString } from "../util/http";
import { BadRequest, Forbidden } from "../util/errors";
import { uuid } from "../util/uuid";

export async function create({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const body = await readJson<{ kid_id?: unknown; parent_name?: unknown; others_consented?: unknown }>(
    req,
  );
  const kidId = requireString(body, "kid_id");
  const parentName = requireString(body, "parent_name");
  if (typeof body.others_consented !== "boolean") throw new BadRequest("others_consented_required");

  const kid = await env.DB.prepare("SELECT id FROM kids WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(kidId, session.user_id)
    .first();
  if (!kid) throw new Forbidden("kid_not_found");

  const consentId = uuid();
  await env.DB.prepare(
    "INSERT INTO consents (id, user_id, kid_id, parent_name, others_consented, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(consentId, session.user_id, kidId, parentName, body.others_consented ? 1 : 0, Date.now())
    .run();

  return Response.json({ consent_id: consentId });
}
