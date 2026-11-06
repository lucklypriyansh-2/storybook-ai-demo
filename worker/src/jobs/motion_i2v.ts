import type { Env } from "../env";
import { assertSafeVideoInput } from "../providers/openrouter_video";
import { livePaid, pickProvider } from "../providers";
import { COSTS, motionUsd, SHOT_SECONDS } from "../config/costs";
import { MODELS } from "../config/models";
import { compensateSpend, guardSpend, reconcileSpend } from "../budget/ledger";
import { isKilled } from "../budget/kill_switch";
import { keys } from "../storage/r2";
import { KillSwitchOn } from "../util/errors";
import { setProgress } from "./state";
import type { VideoGen } from "../providers/types";

type MotionRow = { reel_id: string | null; user_id: string | null; payload: string | null };
type Payload = { shot: number; keyframe_key: string };

export async function motionI2VJob(env: Env, jobId: string): Promise<void> {
  // Kill switch blocks the paid render before any provider work, even for an
  // already-enqueued HD reel (H-3).
  if (await isKilled(env)) throw new KillSwitchOn();

  const row = await env.DB.prepare(
    "SELECT j.reel_id, j.payload, r.user_id FROM jobs j LEFT JOIN reels r ON r.id = j.reel_id WHERE j.id = ?",
  )
    .bind(jobId)
    .first<MotionRow>();
  if (!row?.reel_id || !row.payload) throw new Error("motion_i2v_missing_context");

  const { shot, keyframe_key } = JSON.parse(row.payload) as Payload;
  // Refuse anything that is not a sheet/reel key before any network call (§5).
  assertSafeVideoInput(keyframe_key);

  await setProgress(env, jobId, 20);

  // Motion bills OpenRouter now (§H), same provider/cap as every other AI step.
  const paid = livePaid(env, "openrouter");
  const video = pickProvider(env, "motion_i2v") as VideoGen;
  const ledger = paid
    ? await guardSpend({
        env,
        provider: "openrouter",
        estUsd: motionUsd(SHOT_SECONDS),
        model: MODELS.openrouterVideo,
        step: "motion_i2v",
        userId: row.user_id ?? undefined,
      })
    : null;

  let bytes: Uint8Array;
  try {
    const out = await video.i2v({ imageKey: keyframe_key, seconds: SHOT_SECONDS });
    bytes = out.value.bytes;
    if (ledger) {
      await reconcileSpend(
        env.DB,
        ledger,
        out.actualUsd ?? COSTS.motion_i2v.usdPerSecond * SHOT_SECONDS,
        out.requestId,
      );
    }
  } catch (err) {
    // A failed/unsupported render leaves video_url null on the manifest: the
    // reel keeps its still, and we never invent video bytes to look successful.
    if (ledger) await compensateSpend(env.DB, ledger);
    throw err;
  }

  const videoKey = keys.reel(row.reel_id, `shot-${shot}.mp4`);
  await env.R2.put(videoKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
  await appendShotVideo(env, row.reel_id, shot, videoKey);

  await setProgress(env, jobId, 100);
  await env.DB.prepare("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?")
    .bind(Date.now(), jobId)
    .run();
}

/** Records the finished mp4 key on the reel's shots.json manifest so GET can serve it. */
async function appendShotVideo(env: Env, reelId: string, shot: number, videoKey: string): Promise<void> {
  const manifest = await env.R2.get(keys.reel(reelId, "shots.json"));
  if (!manifest) return;
  const shots = JSON.parse(await manifest.text()) as { index: number; video_key: string | null }[];
  const target = shots.find((s) => s.index === shot);
  if (!target) return;
  target.video_key = videoKey;
  await env.R2.put(keys.reel(reelId, "shots.json"), JSON.stringify(shots), {
    httpMetadata: { contentType: "application/json" },
  });
}
