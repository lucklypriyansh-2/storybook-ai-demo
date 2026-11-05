import type { Env } from "../env";
import { runJob } from "./consumer";

/**
 * Portable (Vercel/Node) build has no managed queue consumer, so every enqueue
 * runs the job in-process. If the handler throws, runJob has already marked the
 * job failed and the crash-recovery poller in node-server.ts (or a next request
 * on Vercel) picks up any job still in `queued`/`running` past the stale cutoff.
 */
export async function maybeRunInline(env: Env, jobId: string): Promise<void> {
  await runJob(env, jobId);
}
