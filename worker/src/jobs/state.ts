import type { Env } from "../env";

export async function markFailed(env: Env, jobId: string, reason: string): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(
      reason,
      now,
      jobId,
    ),
    env.DB.prepare(
      "UPDATE reels SET status = 'failed' WHERE id IN (SELECT reel_id FROM jobs WHERE id = ?)",
    ).bind(jobId),
  ]);
}

export async function setProgress(env: Env, jobId: string, progress: number): Promise<void> {
  await env.DB.prepare("UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?")
    .bind(progress, Date.now(), jobId)
    .run();
}
