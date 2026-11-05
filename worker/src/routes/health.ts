import type { Ctx } from "../router";
import { readFlags } from "../config/flags";
import { isKilled } from "../budget/kill_switch";

export async function get({ env }: Ctx): Promise<Response> {
  const flags = readFlags(env);
  return Response.json({
    ok: true,
    build: env.BUILD ?? "dev",
    flags: {
      openrouter: flags.openrouter,
      fal: flags.fal,
      workers_ai: flags.workersAi,
      kill: await isKilled(env),
    },
  });
}
