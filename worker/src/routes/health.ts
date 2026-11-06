import type { Ctx } from "../router";
import { readFlags } from "../config/flags";
import {
  PHOTOS_MAX_AGE_MS,
  SWEEP_INTERVAL_MS,
  TMP_MAX_AGE_MS,
} from "../config/limits";
import { cachedFfmpeg, startFfmpegProbe } from "../config/ffmpeg";
import { isKilled } from "../budget/kill_switch";

export async function get({ env }: Ctx): Promise<Response> {
  const flags = readFlags(env);

  // Cached value only (Phase C #9): the response never blocks on an exec, and an
  // unresolved probe reports null rather than guessing. Nudge a probe along so a
  // cold or stale cache resolves for the next caller.
  const ffmpeg = cachedFfmpeg();
  if (ffmpeg === null) startFfmpegProbe();

  return Response.json({
    ok: true,
    build: env.BUILD ?? "dev",
    flags: {
      openrouter: flags.openrouter,
      fal: flags.fal,
      // Motion follows OpenRouter (§H). Reported separately so the SPA can gate
      // the HD/motion affordance without treating fal — no longer used — as on.
      motion: flags.motion,
      kill: await isKilled(env),
      // null until the first probe completes; never a guess.
      ffmpeg,
    },
    // Honest retention report (Phase C #E): a photo is guaranteed gone within
    // PHOTOS_MAX_AGE_MS; tmp blobs with no live row go at TMP_MAX_AGE_MS.
    sweep: {
      interval_ms: SWEEP_INTERVAL_MS,
      tmp_max_age_ms: TMP_MAX_AGE_MS,
      photos_max_age_ms: PHOTOS_MAX_AGE_MS,
    },
  });
}
