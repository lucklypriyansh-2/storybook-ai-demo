import type { Ctx } from "../router";
import type { Env } from "../env";
import { requireSession } from "../auth/middleware";
import { assertHeadroom } from "../budget/ledger";
import { isKilled } from "../budget/kill_switch";
import { consumeCharacter } from "../budget/rate_limit";
import { COSTS } from "../config/costs";
import { maybeRunInline } from "../jobs/inline";
import { livePaid } from "../providers";
import { deleteObject, deletePrefix } from "../storage/r2";
import { mediaUrl } from "../storage/signed";
import { readJson, requireString } from "../util/http";
import { hintsOrNull, parseHints, serializeHints } from "../util/hints";
import { ApiError, BadRequest, Forbidden, KillSwitchOn, NotFound } from "../util/errors";
import { uuid } from "../util/uuid";

/** Photo a previous sheet was rendered from, while it is still retained. */
async function retainedPhotoId(
  env: Env,
  kidId: string,
  userId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT j.photo_id AS photo_id
       FROM jobs j
       JOIN photos_tmp p ON p.id = j.photo_id
      WHERE j.kid_id = ? AND j.type = 'character_sheet' AND j.photo_id IS NOT NULL
        AND p.user_id = ? AND p.deleted_at IS NULL
      ORDER BY j.created_at DESC LIMIT 1`,
  )
    .bind(kidId, userId)
    .first<{ photo_id: string }>();
  return row?.photo_id ?? null;
}

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

/**
 * R.3.1 visible AI-avatar preview. Returns the latest character sheet as a
 * signed 1h URL (same scheme as reel keyframes). A row without a stored blob —
 * or no row at all — 404s so the SPA keeps its honest "coming shortly" state.
 */
export async function characterSheetRead({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const kidId = params.id ?? "";
  const kid = await env.DB.prepare(
    "SELECT id FROM kids WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
  )
    .bind(kidId, session.user_id)
    .first<{ id: string }>();
  if (!kid) throw new NotFound("kid_not_found");

  const row = await env.DB.prepare(
    "SELECT sheet_r2_key, created_at, hints FROM characters WHERE kid_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(kidId)
    .first<{ sheet_r2_key: string; created_at: number; hints: string | null }>();

  const stored = row?.sheet_r2_key ? await env.R2.get(row.sheet_r2_key) : null;
  if (!row || !stored) throw new ApiError(404, "no_character_sheet");

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM characters WHERE kid_id = ?",
  )
    .bind(kidId)
    .first<{ n: number }>();

  return Response.json({
    sheet_url: await mediaUrl(env, row.sheet_r2_key),
    version: count?.n ?? 1,
    updated_at: new Date(row.created_at).toISOString(),
    // R.3.2: the saved look, or null when the parent never edited it. The SPA
    // pre-fills the editor from this and never invents defaults of its own.
    hints: hintsOrNull(row.hints),
  });
}

/**
 * R.3.2 "Save look": records the parent's hints on the current sheet without
 * spending anything. Deliberately separate from the regenerate route so the
 * cheap, instant action never queues an image call.
 */
export async function characterSheetHints({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const kidId = params.id ?? "";
  const kid = await env.DB.prepare(
    "SELECT id FROM kids WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
  )
    .bind(kidId, session.user_id)
    .first<{ id: string }>();
  if (!kid) throw new NotFound("kid_not_found");

  const body = await readJson<{ hints?: unknown }>(req);
  if (!body.hints || typeof body.hints !== "object") throw new BadRequest("hints_required");
  const hints = parseHints(body.hints);

  const row = await env.DB.prepare(
    "SELECT id FROM characters WHERE kid_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(kidId)
    .first<{ id: string }>();
  if (!row) throw new ApiError(404, "no_character_sheet");

  await env.DB.prepare("UPDATE characters SET hints = ? WHERE id = ?")
    .bind(serializeHints(hints), row.id)
    .run();

  return Response.json({ ok: true, kid_id: kidId, hints: hintsOrNull(hints) });
}

/**
 * Queues a character-sheet render (R.3.1/R.3.2).
 *
 * `hints` is optional and, when sent, is carried on the job payload so the
 * render honours it and stores it on the character row it creates — this is what
 * makes a hint-only regenerate work for a kid who has no `characters` row yet.
 * `photo_id` is optional too: a kid who already has a sheet can regenerate from
 * the *retained* photo of the most recent sheet job, which is what makes
 * "Regenerate with edits" work after the 24h photo window closes. With neither
 * an upload nor a retained photo this fails fast with `photo_expired` rather
 * than queueing a job that can only fail later.
 */
export async function characterSheet({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const kidId = params.id ?? "";
  const body = await readJson<{ photo_id?: unknown; consent_id?: unknown; hints?: unknown }>(req);
  const consentId = requireString(body, "consent_id");
  const photoId = typeof body.photo_id === "string" && body.photo_id.trim() ? body.photo_id.trim() : null;
  const hints = body.hints === undefined ? null : parseHints(body.hints);

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

  let sourcePhotoId = photoId;
  if (sourcePhotoId) {
    const photo = await env.DB.prepare(
      "SELECT id FROM photos_tmp WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
      .bind(sourcePhotoId, session.user_id)
      .first();
    if (!photo) throw new BadRequest("photo_not_found");
  } else {
    // No upload this time: reuse the photo the previous sheet was made from, if
    // it is still inside the retention window.
    sourcePhotoId = await retainedPhotoId(env, kidId, session.user_id);
    if (!sourcePhotoId) throw new BadRequest("photo_expired");
  }

  if (await isKilled(env)) throw new KillSwitchOn();
  // Free path (mock providers / openrouter disabled) stays at $0; only a real
  // paid call is headroom-checked.
  if (livePaid(env, "openrouter")) {
    await assertHeadroom(env.DB, "openrouter", COSTS.character_sheet.usd);
  }

  const jobId = uuid();
  const now = Date.now();
  // The look travels on the job, not on a `characters` row. For a brand-new kid
  // there is no row to update yet — the old conditional UPDATE matched zero rows
  // and the render silently ran without the hints the parent had just chosen.
  // The job carries them instead and the render writes them onto the character
  // row it inserts, so GET returns them afterwards too.
  const jobHints = serializeHints(hints);
  await env.DB.prepare(
    "INSERT INTO jobs (id, reel_id, kid_id, type, status, progress, error, attempt, photo_id, consent_id, payload, created_at, updated_at) VALUES (?, NULL, ?, 'character_sheet', 'queued', 0, NULL, 0, ?, ?, ?, ?, ?)",
  )
    .bind(
      jobId,
      kidId,
      sourcePhotoId,
      consentId,
      jobHints ? JSON.stringify({ hints: hintsOrNull(jobHints) }) : null,
      now,
      now,
    )
    .run();
  await env.JOBS.send({ job_id: jobId });

  // M-12: consume daily character credit only after the job row + queue send
  // succeed, so an enqueue failure never burns credit.
  await consumeCharacter(env.DB, session.user_id);

  await maybeRunInline(env, jobId);

  return Response.json({ job_id: jobId });
}
