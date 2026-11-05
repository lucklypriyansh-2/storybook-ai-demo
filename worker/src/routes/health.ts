import type { Ctx } from "../router";
import { readFlags } from "../config/flags";
import { TMP_MAX_AGE_MS, SWEEP_INTERVAL_MS } from "../config/limits";
import { probeFfmpeg } from "../config/ffmpeg";
import { isKilled } from "../budget/kill_switch";

export async function get({ env }: Ctx): Promise<Response> {
  const flags = readFlags(env);
  const ffmpeg = await probeFfmpeg();
  return Response.json({
    ok: true,
    build: env.BUILD ?? "dev",
    flags: {
      openrouter: flags.openrouter,
      fal: flags.fal,
      kill: await isKilled(env),
      // null until the first probe completes; never a guess.
      ffmpeg: ffmpeg.available,
    },
    sweep: { interval_ms: SWEEP_INTERVAL_MS, tmp_max_age_ms: TMP_MAX_AGE_MS },
  });
}
