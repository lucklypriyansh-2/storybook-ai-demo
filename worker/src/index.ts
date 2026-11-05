import type { Env, JobMessage } from "./env";
import { preflight, withCors } from "./cors";
import { consume } from "./jobs/consumer";
import { dispatch } from "./router";
import { resetDaily } from "./scheduled/reset_daily";
import { sweepTmp } from "./scheduled/sweep_tmp";
import { errorResponse, NotFound } from "./util/errors";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pre = preflight(env, req);
    if (pre) return pre;
    try {
      return withCors(env, await dispatch(env, req));
    } catch (err) {
      if (!(err instanceof NotFound)) {
        // Log type only — never bindings or secrets.
        console.error("request_failed", err instanceof Error ? err.name : "unknown");
      }
      return withCors(env, errorResponse(err));
    }
  },

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    await consume(env, batch);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([sweepTmp(env), resetDaily(env)]));
  },
};
