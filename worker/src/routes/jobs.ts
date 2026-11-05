import type { Ctx } from "../router";
import { requireSession } from "../auth/middleware";
import { NotFound } from "../util/errors";

export async function get({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const job = await env.DB.prepare(
    `SELECT j.id, j.type, j.status, j.progress, j.error
       FROM jobs j
      WHERE j.id = ?
        AND (j.reel_id IN (SELECT id FROM reels WHERE user_id = ?)
             OR j.kid_id IN (SELECT id FROM kids WHERE user_id = ?))`,
  )
    .bind(params.id ?? "", session.user_id, session.user_id)
    .first<{ id: string; type: string; status: string; progress: number; error: string | null }>();

  if (!job) throw new NotFound("job_not_found");
  return Response.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    ...(job.error ? { error: job.error } : {}),
  });
}
