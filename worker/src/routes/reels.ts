import type { Ctx } from "../router";
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
import { maybeRunInline } from "../jobs/inline";
import { keys } from "../storage/r2";
import { mediaUrl } from "../storage/signed";
import { readJson, requireString } from "../util/http";
import { BadRequest, KillSwitchOn, NotFound, ProviderDisabled } from "../util/errors";
import { uuid } from "../util/uuid";

const TIERS: readonly Tier[] = ["free", "paid", "hd"];

function parseTier(value: unknown): Tier {
  if (typeof value !== "string" || !TIERS.includes(value as Tier)) throw new BadRequest("invalid_tier");
  return value as Tier;
}

export async function create({ env, req }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const body = await readJson<{ kid_id?: unknown; story?: unknown; tier?: unknown }>(req);
  const kidId = requireString(body, "kid_id");
  const story = requireString(body, "story");
  const tier = parseTier(body.tier);

  const kid = await env.DB.prepare("SELECT id FROM kids WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(kidId, session.user_id)
    .first();
  if (!kid) throw new NotFound("kid_not_found");

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
      "INSERT INTO reels (id, user_id, kid_id, status, tier, story, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)",
    ).bind(reelId, session.user_id, kidId, tier, story, now),
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

export async function get({ env, req, params }: Ctx): Promise<Response> {
  const session = await requireSession(env, req);
  const reel = await env.DB.prepare(
    "SELECT id, status, tier FROM reels WHERE id = ? AND user_id = ?",
  )
    .bind(params.id ?? "", session.user_id)
    .first<{ id: string; status: string; tier: string }>();
  if (!reel) throw new NotFound("reel_not_found");

  const manifest = await env.R2.get(keys.reel(reel.id, "shots.json"));
  const stored: ShotManifest[] = manifest ? ((await manifest.json()) as ShotManifest[]) : [];

  // Serve signed 1h URLs, never raw R2 keys (H-9).
  const shots = await Promise.all(
    stored.map(async (s) => ({
      index: s.index,
      caption: s.caption,
      keyframe_url: s.keyframe_key ? await mediaUrl(env, s.keyframe_key) : null,
      video_url: s.video_key ? await mediaUrl(env, s.video_key) : null,
    })),
  );
  return Response.json({ id: reel.id, status: reel.status, tier: reel.tier, shots });
}
