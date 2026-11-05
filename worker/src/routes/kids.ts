import type { Ctx } from "../router";
import { requireSession } from "../auth/middleware";
import { assertHeadroom } from "../budget/ledger";
import { isKilled } from "../budget/kill_switch";
import { consumeCharacter } from "../budget/rate_limit";
import { COSTS } from "../config/costs";
import { maybeRunInline } from "../jobs/inline";
import { livePaid } from "../providers";
import { deleteObject, deletePrefix } from "../storage/r2";
import { readJson, requireString } from "../util/http";
import { BadRequest, Forbidden, KillSwitchOn, NotFound } from "../util/errors";
import { uuid } from "../util/uuid";

export async function list({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const rows = await env.DB.prepare(
    `SELECT k.id, k.display_name,
            EXISTS (SELECT 1 FROM characters c WHERE c.kid_id = k.id) AS has_sheet
       FROM kids k WHERE k.user_id = ? AND k.deleted_at IS NULL ORDER BY k.created_at`,
  )
    .bind(session.user_id)
    .all<{ id: string; display_name: string; has_sheet: number }>();

  return Response.json({
    kids: rows.results.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      has_sheet: r.has_sheet === 1,
    })),
  });
}

export async function create({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const body = await readJson(req);
  const displayName = requireString(body, "display_name");

  const id = uuid();
  await env.DB.prepare(
    "INSERT INTO kids (id, user_id, display_name, created_at, deleted_at) VALUES (?, ?, ?, ?, NULL)",
  )
    .bind(id, session.user_id, displayName, Date.now())
    .run();

  return Response.json({ kid_id: id });
}

export async function forget({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const kidId = params.id ?? "";
  const kid = await env.DB.prepare("SELECT id, deleted_at FROM kids WHERE id = ? AND user_id = ?")
    .bind(kidId, session.user_id)
    .first<{ id: string; deleted_at: number | null }>();
  if (!kid) throw new NotFound("kid_not_found");
  // Idempotent: a second forget on an already-deleted kid is a no-op success.
  if (kid.deleted_at !== null) return Response.json({ ok: true, deleted: { r2: 0, rows: 0 } });

  // In-flight uploads for this kid's jobs are removed now rather than waiting for
  // the 60s sweep, so a forget immediately severs the photo link (M-16).
  const inflight = await env.DB.prepare(
    `SELECT p.id, p.r2_key FROM photos_tmp p
       JOIN jobs j ON j.photo_id = p.id
      WHERE j.kid_id = ? AND p.user_id = ? AND p.deleted_at IS NULL`,
  )
    .bind(kidId, session.user_id)
    .all<{ id: string; r2_key: string }>();
  for (const photo of inflight.results) await deleteObject(env.R2, photo.r2_key);

  let r2Deleted = await deletePrefix(env.R2, `sheets/${kidId}/`);
  const reels = await env.DB.prepare("SELECT id FROM reels WHERE kid_id = ? AND user_id = ?")
    .bind(kidId, session.user_id)
    .all<{ id: string }>();
  for (const reel of reels.results) r2Deleted += await deletePrefix(env.R2, `reels/${reel.id}/`);

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE kids SET deleted_at = ? WHERE id = ?").bind(now, kidId),
    env.DB.prepare("DELETE FROM characters WHERE kid_id = ?").bind(kidId),
    env.DB.prepare("DELETE FROM consents WHERE kid_id = ?").bind(kidId),
    ...inflight.results.map((p) =>
      env.DB.prepare("UPDATE photos_tmp SET deleted_at = ? WHERE id = ?").bind(now, p.id),
    ),
  ]);

  return Response.json({ ok: true, deleted: { r2: r2Deleted, rows: 1 + reels.results.length } });
}

export async function characterSheet({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const kidId = params.id ?? "";
  const body = await readJson<{ photo_id?: unknown; consent_id?: unknown }>(req);
  const photoId = requireString(body, "photo_id");
  const consentId = requireString(body, "consent_id");

  const kid = await env.DB.prepare("SELECT id FROM kids WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(kidId, session.user_id)
    .first();
  if (!kid) throw new NotFound("kid_not_found");

  const consent = await env.DB.prepare(
    "SELECT id FROM consents WHERE id = ? AND kid_id = ? AND user_id = ?",
  )
    .bind(consentId, kidId, session.user_id)
    .first();
  if (!consent) throw new Forbidden("consent_required");

  const photo = await env.DB.prepare(
    "SELECT id FROM photos_tmp WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
  )
    .bind(photoId, session.user_id)
    .first();
  if (!photo) throw new BadRequest("photo_not_found");

  if (await isKilled(env)) throw new KillSwitchOn();
  // Free path (mock providers / openrouter disabled) stays at $0; only a real
  // paid call is headroom-checked.
  if (livePaid(env, "openrouter")) {
    await assertHeadroom(env.DB, "openrouter", COSTS.character_sheet.usd);
  }

  const jobId = uuid();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO jobs (id, reel_id, kid_id, type, status, progress, error, attempt, photo_id, consent_id, created_at, updated_at) VALUES (?, NULL, ?, 'character_sheet', 'queued', 0, NULL, 0, ?, ?, ?, ?)",
  )
    .bind(jobId, kidId, photoId, consentId, now, now)
    .run();
  await env.JOBS.send({ job_id: jobId });

  // M-12: consume daily character credit only after the job row + queue send
  // succeed, so an enqueue failure never burns credit.
  await consumeCharacter(env.DB, session.user_id);

  await maybeRunInline(env, jobId);

  return Response.json({ job_id: jobId });
}
