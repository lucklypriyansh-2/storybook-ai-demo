import type { Ctx } from "../router";
import { requireSession } from "../auth/middleware";
import { MAX_PHOTO_BYTES, PHOTO_MIME_ALLOWLIST } from "../config/limits";
import { putTmp } from "../storage/r2";
import { BadRequest } from "../util/errors";
import { uuid } from "../util/uuid";

export async function upload({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) throw new BadRequest("photo_required");
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) throw new BadRequest("photo_too_large");
  if (!(PHOTO_MIME_ALLOWLIST as readonly string[]).includes(file.type)) {
    throw new BadRequest("photo_type_not_allowed");
  }

  const id = uuid();
  const key = await putTmp(env.R2, id, await file.arrayBuffer(), file.type);
  await env.DB.prepare(
    "INSERT INTO photos_tmp (id, user_id, r2_key, created_at, deleted_at) VALUES (?, ?, ?, ?, NULL)",
  )
    .bind(id, session.user_id, key, Date.now())
    .run();

  return Response.json({ photo_id: id });
}
