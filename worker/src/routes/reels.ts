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
import { regenerateCaption } from "../jobs/caption";
import { regenerateKeyframe } from "../jobs/keyframe";
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
  // Headroom check whenever a live OpenRouter call *could* happen. That is now
  // any tier when the provider is live, because free gets real stills too. A
  // mocked or keyless run spends $0 and skips the check.
  if (tier !== "free") {
    if (await isKilled(env)) throw new KillSwitchOn();
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
  }
  if (!flags.mockProviders && flags.openrouter && env.OPENROUTER_API_KEY) {
    await assertHeadroom(env.DB, "openrouter", prechargeUsd(tier));
  }
  if (tier === "hd") {
    // Motion is OpenRouter now (§H): gate on the same key/flag as every other
    // paid step, and check its headroom — never fal's.
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    await assertHeadroom(
      env.DB,
      "openrouter",
      SHOT_COUNT * SHOT_SECONDS * COSTS.motion_i2v.usdPerSecond,
    );
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

/**
 * R.5/#13: the list echoes `template_id` and `tier` so the SPA can bind a reel
 * to its book straight from this payload. That removes the per-reel
 * `GET /api/reels/:id` hydration fetch the client used to run for every row it
 * did not already know about on a cold load.
 */
export async function list({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const rows = await env.DB.prepare(
    "SELECT id, status, tier, template_id, created_at FROM reels WHERE user_id = ? ORDER BY created_at DESC",
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

  const stored: ShotManifest[] = await readManifest(env, reel.id);
  const overrides = await pageOverrides(env, reel.id);

  // Serve signed 1h URLs, never raw R2 keys (H-9). Overrides are overlaid so
  // the SPA renders the edited page without extra round-trips (R.5.2).
  // `index` is the manifest's, but an override for an index the manifest lost
  // (partial write) is still shown rather than silently dropped.
  const indexes = new Set<number>(stored.map((s) => s.index));
  for (const i of overrides.keys()) indexes.add(i);
  const shots = await Promise.all(
    [...indexes].sort((a, b) => a - b).map(async (index) => {
      const s = stored.find((row) => row.index === index);
      const over = overrides.get(index);
      const caption = over?.text ?? s?.caption ?? "";
      const key = over?.keyframe_key ?? s?.keyframe_key ?? null;
      return {
        index,
        caption,
        edited: over?.text != null,
        keyframe_edited: over?.keyframe_key != null && over.keyframe_key !== s?.keyframe_key,
        keyframe_url: key ? await mediaUrl(env, key) : null,
        video_url: s?.video_key ? await mediaUrl(env, s.video_key) : null,
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
 * R.5.3 per-page edit. Two payloads, mutually exclusive:
 *   `{ text }`                        — save the words verbatim (no AI, no spend);
 *   `{ regenerate: { caption?, keyframe? } }` — ask the AI for new ones (R.5.1).
 *
 * Sending `text` together with `regenerate.caption` is refused with
 * `ambiguous_page_patch`: the caption is a billed model call whose output the
 * explicit text would immediately discard. `text` + `regenerate.keyframe` is
 * fine — the redraw is of the words the parent is saving.
 *
 * A `regenerate` runs synchronously through the same provider/ledger stack as
 * every other paid step, so it respects the kill switch, the $100 cap and
 * `provider_disabled`. There is no job id: a single caption or keyframe is far
 * below the reel pipeline's cost and the client would otherwise poll for a
 * sub-second operation.
 *
 * Responses always carry the page's *effective* text and the override state, so
 * the caller can render the result without a follow-up GET.
 */
export async function patchPage({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const reelId = params.id ?? "";
  const index = Number.parseInt(params.index ?? "", 10);
  if (!Number.isInteger(index) || index < 1) throw new BadRequest("invalid_page_index");

  const reel = await env.DB.prepare(
    "SELECT id, kid_id, tier, story, template_id FROM reels WHERE id = ? AND user_id = ?",
  )
    .bind(reelId, session.user_id)
    .first<{ id: string; kid_id: string; tier: string; story: string; template_id: string | null }>();
  if (!reel) throw new NotFound("reel_not_found");

  const body = await readJson<{
    text?: string;
    regenerate?: { caption?: boolean; keyframe?: boolean; hint?: string };
  }>(req);

  const regen = body.regenerate;
  const wantsCaption = regen?.caption === true;
  const wantsKeyframe = regen?.keyframe === true;
  const hasText = typeof body.text === "string" && body.text.trim().length > 0;
  if (!hasText && !wantsCaption && !wantsKeyframe) throw new BadRequest("text_or_regenerate_required");
  // `regenerate.caption` is a *live* model call: it pre-charges the ledger and
  // bills OpenRouter. Accepting it alongside an explicit `text` would pay for a
  // rewrite and then overwrite it with the parent's words (the applied order is
  // caption → text), so nothing the parent sees would be the thing they paid
  // for. Refuse the combination at the boundary instead of spending silently.
  // A manual edit and a keyframe redraw *can* share a request: the keyframe
  // regenerates from the page's own words and redraws nothing that was saved.
  if (hasText && wantsCaption) throw new BadRequest("ambiguous_page_patch");

  const now = Date.now();
  const existing = await env.DB.prepare(
    'SELECT text, keyframe_key FROM reel_page_overrides WHERE reel_id = ? AND "index" = ?',
  )
    .bind(reelId, index)
    .first<{ text: string | null; keyframe_key: string | null }>();

  // The page's current words: an override if one exists, else the stored manifest.
  const stored = await readManifest(env, reelId);
  const manifestShot = stored.find((s) => s.index === index);
  if (!manifestShot && !existing) throw new NotFound("page_not_found");
  const baseCaption = existing?.text ?? manifestShot?.caption ?? "";
  const baseKeyframe = existing?.keyframe_key ?? manifestShot?.keyframe_key ?? null;

  let text = baseCaption;
  let keyframeKey = baseKeyframe;
  const applied: string[] = [];

  if (wantsCaption) {
    const hint = typeof regen?.hint === "string" ? regen.hint.trim().slice(0, 120) : undefined;
    const out = await regenerateCaption(
      env,
      {
        story: reel.story,
        index,
        pageCount: stored.length || 1,
        current: baseCaption || null,
        hint,
      },
      reel.tier as Tier,
    );
    if (out.text) {
      text = out.text;
      applied.push("caption");
    }
  }
  if (hasText && typeof body.text === "string") {
    text = body.text.trim().slice(0, MAX_PAGE_TEXT);
    applied.push("text");
  }
  if (wantsKeyframe) {
    const out = await regenerateKeyframe(env, {
      reelId,
      index,
      kidId: reel.kid_id,
      caption: text || baseCaption,
      tier: reel.tier as Tier,
    });
    keyframeKey = out.key;
    applied.push("keyframe");
  }

  const textChanged = text !== baseCaption;
  const keyframeChanged = keyframeKey !== baseKeyframe;

  if (existing) {
    await env.DB.prepare(
      'UPDATE reel_page_overrides SET text = ?, keyframe_key = ?, updated_at = ? WHERE reel_id = ? AND "index" = ?',
    )
      .bind(textChanged ? text : existing.text, keyframeKey, now, reelId, index)
      .run();
  } else if (textChanged || keyframeChanged) {
    await env.DB.prepare(
      'INSERT INTO reel_page_overrides (reel_id, "index", text, keyframe_key, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(reelId, index, textChanged ? text : null, keyframeKey, now)
      .run();
  }

  return Response.json({
    page: {
      index,
      text,
      edited: textChanged,
      keyframe_url: keyframeKey ? await mediaUrl(env, keyframeKey) : null,
      keyframe_edited: keyframeChanged,
    },
    // Kept for the pre-R.5.1 client, which reads `saved`. True only for an
    // explicit `text` write — a caption/keyframe regenerate is a preview the
    // caller still has to Save, so reporting it as saved would be a lie.
    saved: applied.includes("text"),
    regenerated: applied,
  });
}

async function readManifest(env: Env, reelId: string): Promise<ShotManifest[]> {
  const manifest = await env.R2.get(keys.reel(reelId, "shots.json"));
  if (!manifest) return [];
  try {
    const parsed = (await manifest.json()) as ShotManifest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
