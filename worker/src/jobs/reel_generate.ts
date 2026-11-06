import type { Env } from "../env";
import { compensateSpend, guardSpend, reconcileSpend } from "../budget/ledger";
import { isKilled } from "../budget/kill_switch";
import {
  COSTS,
  motionUsd,
  prechargeUsd,
  SHOT_COUNT,
  SHOT_SECONDS,
  type Tier,
} from "../config/costs";
import { MODELS } from "../config/models";
import { livePaid, pickProvider } from "../providers";
import type { ImageGen, TextGen } from "../providers/types";
import { deletePrefix, keys } from "../storage/r2";
import { BudgetExceeded, KillSwitchOn } from "../util/errors";
import { uuid } from "../util/uuid";
import { setProgress } from "./state";

type ReelRow = { user_id: string; kid_id: string; tier: string; story: string };

export type Shot = { index: number; caption: string; keyframe_key: string | null; video_key: string | null };

const KEYFRAME_PROGRESS = [20, 40, 60, 80];

export async function reelGenerateJob(env: Env, jobId: string): Promise<void> {
  const reelId = await jobReelId(env, jobId);
  if (!reelId) throw new Error("reel_generate_missing_reel");

  const reel = await env.DB.prepare(
    "SELECT user_id, kid_id, tier, story FROM reels WHERE id = ?",
  )
    .bind(reelId)
    .first<ReelRow>();
  if (!reel) throw new Error("reel_generate_missing_reel");

  const tier = reel.tier as Tier;
  await setProgress(env, jobId, 5);
  await env.DB.prepare("UPDATE reels SET status = 'running' WHERE id = ?").bind(reelId).run();
  if (await isKilled(env)) throw new KillSwitchOn();

  // One pre-charge for the whole reel covers the shot list + all keyframes, then
  // reconciles to the summed actual at the end (H-11). Per-shot charges would
  // strand R2 objects and a partly-reconciled ledger if a later shot failed.
  // Free also precharges when OpenRouter is live, because free now gets real
  // stills (motion stays paid-only). A mocked or keyless run stays at $0.
  const paidReel = livePaid(env, "openrouter");
  const ledger = paidReel
    ? await guardSpend({
        env,
        provider: "openrouter",
        estUsd: prechargeUsd(tier),
        model: MODELS.openrouterImage,
        step: "reel_generate",
        userId: reel.user_id,
      })
    : null;

  let actualUsd = 0;
  let shots: Shot[] = [];
  try {
    const built = await buildShotList(env, reel, tier);
    shots = built.shots;
    actualUsd += built.actualUsd;

    // Keyframes: paid/hd use openrouter image with the kid's character sheet as a
    // reference; free uses mock. The provider id pins the model and
    // decides whether the sheet reference is even applicable.
    const image = pickProvider(env, "keyframe", tier) as ImageGen;
    const paidImage = image.id === "openrouter-gemini-2.5-flash-image";
    const sheetKey = paidImage ? await latestSheetKey(env, reel.kid_id) : null;

    for (let i = 0; i < SHOT_COUNT; i++) {
      const shot = shots[i]!;
      const ref = sheetKey ? await refFromR2(env, sheetKey) : undefined;
      const out = await image.generate({
        prompt: `Storybook keyframe ${i + 1} of ${SHOT_COUNT}: ${shot.caption}`,
        ...(ref ? { image: ref } : {}),
      });
      if (paidImage) actualUsd += out.actualUsd ?? COSTS.keyframe_paid.usd;

      shot.keyframe_key = keys.reel(reelId, `shot-${i + 1}.png`);
      await env.R2.put(shot.keyframe_key, out.value.bytes, {
        httpMetadata: { contentType: out.value.mime },
      });
      await setProgress(
        env,
        jobId,
        KEYFRAME_PROGRESS[Math.min(i >> 1, KEYFRAME_PROGRESS.length - 1)]!,
      );
    }

    await env.R2.put(keys.reel(reelId, "shots.json"), JSON.stringify(shots), {
      httpMetadata: { contentType: "application/json" },
    });

    await setProgress(env, jobId, 100);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?").bind(now, jobId),
      env.DB.prepare("UPDATE reels SET status = 'done' WHERE id = ?").bind(reelId),
    ]);
  } catch (err) {
    // A failed reel leaves nothing behind: drop the pre-charge and every object
    // written under reels/<id>/ so no orphan R2 data or spend survives (H-11).
    if (ledger) await compensateSpend(env.DB, ledger);
    await deletePrefix(env.R2, `reels/${reelId}/`);
    throw err;
  }

  if (ledger) await reconcileSpend(env.DB, ledger, actualUsd);

  // hd adds one motion_i2v per shot. Each is headroom-checked; if OpenRouter's
  // budget would be crossed the reel stays done with keyframes only and the
  // parent job records how many shots were skipped.
  if (tier === "hd") await enqueueMotion(env, reelId, shots, jobId);
}

async function buildShotList(
  env: Env,
  reel: ReelRow,
  tier: Tier,
): Promise<{ shots: Shot[]; actualUsd: number }> {
  const text = pickProvider(env, "shot_list", tier) as TextGen;
  const paidText = text.id === "openrouter-gemini-2.5-flash";
  const out = await text.complete({
    system: "You write safe, gentle children's storyboard shots.",
    prompt: `Story: ${reel.story}. Return ${SHOT_COUNT} short shot descriptions as JSON.`,
    json: true,
  });
  const actualUsd = paidText ? out.actualUsd ?? COSTS.shot_list.usd : 0;
  return { shots: parseShots(out.value.text, reel.story), actualUsd };
}

async function enqueueMotion(env: Env, reelId: string, shots: Shot[], parentJobId: string): Promise<void> {
  const motionPaid = livePaid(env, "openrouter");
  const perShot = motionUsd(SHOT_SECONDS);
  const eligible = shots.filter((s) => s.keyframe_key);

  // H-10: pre-reserve OpenRouter budget for every shot in a single atomic
  // guardSpend so two HD reels running at once cannot both satisfy a per-shot
  // headroom check and later overspend the cap. On BudgetExceeded, skip every
  // motion shot and record the parent-job error without inserting any jobs.
  let runnable = eligible.length;
  let skipped = 0;
  let reservation: string | null = null;

  if (motionPaid && runnable > 0) {
    try {
      reservation = await guardSpend({
        env,
        provider: "openrouter",
        estUsd: round6(runnable * perShot),
        model: MODELS.openrouterVideo,
        step: "motion_i2v_reserve",
      });
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        skipped = runnable;
        runnable = 0;
      } else {
        throw err;
      }
    }
  }

  // Release the aggregate reservation: individual motion jobs re-guard
  // atomically per shot in motion_i2v.ts, which also reconciles to actuals.
  // The reservation here exists only to enforce the all-or-none budget check
  // and is compensated before the jobs are actually inserted.
  if (reservation) await compensateSpend(env.DB, reservation);

  for (let i = 0; i < runnable; i++) {
    const shot = eligible[i]!;
    const keyframeKey = shot.keyframe_key!;
    const jobId = uuid();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO jobs (id, reel_id, kid_id, type, status, progress, error, attempt, payload, created_at, updated_at) VALUES (?, ?, NULL, 'motion_i2v', 'queued', 0, NULL, 0, ?, ?, ?)",
    )
      .bind(jobId, reelId, JSON.stringify({ shot: shot.index, keyframe_key: keyframeKey }), now, now)
      .run();
    await env.JOBS.send({ job_id: jobId });
  }

  if (skipped > 0) {
    await env.DB.prepare("UPDATE jobs SET error = ?, updated_at = ? WHERE id = ?")
      .bind(`motion_skipped_budget:${skipped}`, Date.now(), parentJobId)
      .run();
  }
}

function round6(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

async function jobReelId(env: Env, jobId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT reel_id FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ reel_id: string | null }>();
  return row?.reel_id ?? null;
}

async function latestSheetKey(env: Env, kidId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT sheet_r2_key FROM characters WHERE kid_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(kidId)
    .first<{ sheet_r2_key: string }>();
  return row?.sheet_r2_key ?? null;
}

async function refFromR2(
  env: Env,
  key: string,
): Promise<{ data: Uint8Array; mime: string } | undefined> {
  const stored = await env.R2.get(key);
  if (!stored) return undefined;
  return {
    data: new Uint8Array(await stored.arrayBuffer()),
    mime: stored.httpMetadata?.contentType ?? "image/png",
  };
}

function parseShots(text: string, story: string): Shot[] {
  let captions: string[] = [];
  try {
    const parsed = JSON.parse(text) as { shots?: unknown };
    if (Array.isArray(parsed.shots)) {
      captions = parsed.shots.map(readCaption).filter((c) => c.length > 0);
    }
  } catch {
    // Free text (not JSON) falls back to story-derived captions.
  }
  while (captions.length < SHOT_COUNT) captions.push(`${story} — beat ${captions.length + 1}`);
  return captions.slice(0, SHOT_COUNT).map((caption, i) => ({
    index: i + 1,
    caption,
    keyframe_key: null,
    video_key: null,
  }));
}

function readCaption(shot: unknown): string {
  if (typeof shot === "string") return shot;
  if (shot && typeof shot === "object" && "caption" in shot) {
    return String((shot as { caption: unknown }).caption);
  }
  return "";
}
