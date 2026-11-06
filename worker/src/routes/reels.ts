import type { Ctx } from "../router";
import type { Env } from "../env";
import { requireSession } from "../auth/middleware";
import {
  COSTS,
  prechargeUsd,
  SHOT_COUNT,
  SHOT_SECONDS,
  type Tier,
} from "../config/costs";
import { assertHeadroom } from "../budget/ledger";
import { isKilled } from "../budget/kill_switch";
import { consumeReel } from "../budget/rate_limit";
import { readFlags } from "../config/flags";
import { MAX_PAGE_TEXT } from "../config/limits";
import { getTemplate } from "../catalog/templates";
import { maybeRunInline } from "../jobs/inline";
import { keys } from "../storage/r2";
import { mediaUrl } from "../storage/signed";
import { readJson, requireString } from "../util/http";
import { ApiError, BadRequest, KillSwitchOn, NotFound, ProviderDisabled } from "../util/errors";
import { uuid } from "../util/uuid";

const TIERS: readonly Tier[] = ["free", "paid", "hd"];

function parseTier(value: unknown): Tier {
  if (typeof value !== "string" || !TIERS.includes(value as Tier)) throw new BadRequest("invalid_tier");
  return value as Tier;
}

export async function create({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const body = await readJson<{
    kid_id?: unknown;
    story?: unknown;
    tier?: unknown;
    template_id?: unknown;
    use_sheet?: unknown;
  }>(req);
  const kidId = requireString(body, "kid_id");
  const tier = parseTier(body.tier);

  const kid = await env.DB.prepare("SELECT id FROM kids WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(kidId, session.user_id)
    .first();
  if (!kid) throw new NotFound("kid_not_found");

  // Catalog path (R.1.4): a template_id supplies the story text. The legacy
  // path still accepts a free-text `story`, so exactly one must be present.
  const templateId = typeof body.template_id === "string" && body.template_id.trim()
    ? body.template_id.trim()
    : null;
  let story: string;
  if (templateId) {
    const template = await getTemplate(env.DB, templateId);
    if (!template || template.enabled !== 1) throw new ApiError(404, "template_not_found");
    story = template.title;
  } else {
    story = requireString(body, "story");
  }
  // `use_sheet` is accepted for API compatibility. Phase B's pipeline still does
  // not consume the column, so we never claim sheet intake we cannot deliver
  // (R.0 honesty):
  //   - explicit `true` on a kid with no sheet → fail fast with sheet_required;
  //   - omitted → default to the kid's real state (1 only when a sheet exists);
  //   - explicit `false` → 0, so "one cartoon reel without the likeness" works.
  const hasSheet = !!(await env.DB.prepare(
    "SELECT id FROM characters WHERE kid_id = ? LIMIT 1",
  )
    .bind(kidId)
    .first());
  const wantsSheet = body.use_sheet === undefined ? hasSheet : body.use_sheet === true;
  if (wantsSheet && !hasSheet) throw new BadRequest("sheet_required");
  const useSheet = wantsSheet ? 1 : 0;

  const flags = readFlags(env);
  if (tier !== "free") {
    if (await isKilled(env)) throw new KillSwitchOn();
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    await assertHeadroom(env.DB, "openrouter", prechargeUsd("paid"));
  }
  if (tier === "hd") {
    if (!flags.mockProviders && !flags.fal) throw new ProviderDisabled("fal");
    await assertHeadroom(env.DB, "fal", SHOT_COUNT * SHOT_SECONDS * COSTS.motion_i2v.usdPerSecond);
  }

  const reelId = uuid();
  const jobId = uuid();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO reels (id, user_id, kid_id, status, tier, story, template_id, use_sheet, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)",
    ).bind(reelId, session.user_id, kidId, tier, story, templateId, useSheet, now),
    env.DB.prepare(
      "INSERT INTO jobs (id, reel_id, kid_id, type, status, progress, error, attempt, created_at, updated_at) VALUES (?, ?, ?, 'reel_generate', 'queued', 0, NULL, 0, ?, ?)",
    ).bind(jobId, reelId, kidId, now, now),
  ]);
  await env.JOBS.send({ job_id: jobId });

  // M-12: consume daily reel credit only after the rows and queue send succeed,
  // so a failed enqueue does not burn the user's credit for the day.
  await consumeReel(env.DB, session.user_id);

  await maybeRunInline(env, jobId);

  return Response.json({ reel_id: reelId, job_id: jobId });
}

export async function list({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const rows = await env.DB.prepare(
    "SELECT id, status, created_at FROM reels WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(session.user_id)
    .all();
  return Response.json({ reels: rows.results });
}

type ShotManifest = {
  index: number;
  caption: string;
  keyframe_key: string | null;
  video_key: string | null;
};

type OverrideRow = { index: number; text: string | null; keyframe_key: string | null };

/** Per-page overrides for a reel, keyed by index (R.5.2). */
async function pageOverrides(env: Env, reelId: string): Promise<Map<number, OverrideRow>> {
  const rows = await env.DB.prepare(
    'SELECT "index", text, keyframe_key FROM reel_page_overrides WHERE reel_id = ? ORDER BY "index"',
  )
    .bind(reelId)
    .all<OverrideRow>();
  return new Map(rows.results.map((r) => [r.index, r]));
}

export async function get({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const reel = await env.DB.prepare(
    "SELECT id, status, tier, template_id FROM reels WHERE id = ? AND user_id = ?",
  )
    .bind(params.id ?? "", session.user_id)
    .first<{ id: string; status: string; tier: string; template_id: string | null }>();
  if (!reel) throw new NotFound("reel_not_found");

  const manifest = await env.R2.get(keys.reel(reel.id, "shots.json"));
  const stored: ShotManifest[] = manifest ? ((await manifest.json()) as ShotManifest[]) : [];
  const overrides = await pageOverrides(env, reel.id);

  // Serve signed 1h URLs, never raw R2 keys (H-9). Overrides are overlaid so
  // the SPA renders the edited page without extra round-trips (R.5.2).
  const shots = await Promise.all(
    stored.map(async (s) => {
      const over = overrides.get(s.index);
      const caption = over?.text ?? s.caption;
      const key = over?.keyframe_key ?? s.keyframe_key;
      return {
        index: s.index,
        caption,
        edited: over !== undefined && over.text !== null,
        keyframe_url: key ? await mediaUrl(env, key) : null,
        video_url: s.video_key ? await mediaUrl(env, s.video_key) : null,
      };
    }),
  );
  return Response.json({
    id: reel.id,
    status: reel.status,
    tier: reel.tier,
    template_id: reel.template_id,
    shots,
  });
}

/**
 * R.5.3 per-page text edit — the only way to tweak a single caption without
 * redoing the whole reel. `regenerate` is not implemented yet, so a request
 * asking for it is answered with a synchronous text-only save and no job id
 * (no AI call is made, so nothing is spent).
 */
export async function patchPage({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const reelId = params.id ?? "";
  const index = Number.parseInt(params.index ?? "", 10);
  if (!Number.isInteger(index) || index < 1) throw new BadRequest("invalid_page_index");

  const reel = await env.DB.prepare("SELECT id FROM reels WHERE id = ? AND user_id = ?")
    .bind(reelId, session.user_id)
    .first<{ id: string }>();
  if (!reel) throw new NotFound("reel_not_found");

  const body = await readJson<{ text?: unknown }>(req);
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    throw new BadRequest("text_required");
  }
  const text = body.text.trim().slice(0, MAX_PAGE_TEXT);
  const now = Date.now();

  const existing = await env.DB.prepare(
    'SELECT text, keyframe_key FROM reel_page_overrides WHERE reel_id = ? AND "index" = ?',
  )
    .bind(reelId, index)
    .first<{ text: string | null; keyframe_key: string | null }>();

  if (existing) {
    await env.DB.prepare(
      'UPDATE reel_page_overrides SET text = ?, updated_at = ? WHERE reel_id = ? AND "index" = ?',
    )
      .bind(text, now, reelId, index)
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO reel_page_overrides (reel_id, "index", text, keyframe_key, updated_at) VALUES (?, ?, ?, NULL, ?)',
    )
      .bind(reelId, index, text, now)
      .run();
  }

  return Response.json({ page: { index, text, keyframe_url: null }, saved: true });
}

/** Clears an override so the page reverts to the template caption (R.5.3). */
export async function deletePage({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const reelId = params.id ?? "";
  const index = Number.parseInt(params.index ?? "", 10);
  if (!Number.isInteger(index) || index < 1) throw new BadRequest("invalid_page_index");

  const reel = await env.DB.prepare("SELECT id FROM reels WHERE id = ? AND user_id = ?")
    .bind(reelId, session.user_id)
    .first<{ id: string }>();
  if (!reel) throw new NotFound("reel_not_found");

  await env.DB.prepare('DELETE FROM reel_page_overrides WHERE reel_id = ? AND "index" = ?')
    .bind(reelId, index)
    .run();
  return Response.json({ ok: true });
}
