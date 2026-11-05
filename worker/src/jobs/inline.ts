import type { Env } from "../env";
import { readFlags } from "../config/flags";
import { runJob } from "./consumer";

/**
 * `wrangler dev --local` does not reliably drive queue consumers, so under
 * MOCK_PROVIDERS we also run the job in-process right after enqueueing. The
 * queue send is still performed; runJob is a no-op if the consumer wins first.
 */
export async function maybeRunInline(env: Env, jobId: string): Promise<void> {
  if (!readFlags(env).mockProviders) return;
  await runJob(env, jobId);
}
