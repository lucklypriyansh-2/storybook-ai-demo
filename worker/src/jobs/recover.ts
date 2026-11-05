import type { Env } from "../env";
import { runJob } from "./consumer";

/**
 * Picks up any job the inline runner left behind (process crash mid-run, Vercel
 * cold-start interruption, etc.). A job is "stale" if it's still queued/running
 * past the cutoff; we re-dispatch it so runJob can finish it or mark it failed.
 */
export async function recoverStaleJobs(env: Env, now = Date.now(), maxAgeMs = 10 * 60_000): Promise<number> {
  const cutoff = now - maxAgeMs;
  const rows = await env.DB.prepare(
    "SELECT id FROM jobs WHERE status IN ('queued','running') AND updated_at <= ? ORDER BY updated_at LIMIT 20",
  )
    .bind(cutoff)
    .all<{ id: string }>();

  let n = 0;
  for (const row of rows.results) {
    try {
      await runJob(env, row.id);
      n++;
    } catch {
      // runJob already marked failed; swallow so one bad job doesn't stop the sweep.
    }
  }
  return n;
}
