import type { Env, JobMessage } from "../env";
import { characterSheetJob } from "./character_sheet";
import { motionI2VJob } from "./motion_i2v";
import { reelGenerateJob } from "./reel_generate";
import { markFailed } from "./state";

const handlers: Record<string, (env: Env, jobId: string) => Promise<void>> = {
  character_sheet: characterSheetJob,
  reel_generate: reelGenerateJob,
  motion_i2v: motionI2VJob,
};

/**
 * Runs one job to completion, writing terminal state. Idempotent: an already
 * done/failed job is a no-op. Shared by the queue consumer and the in-process
 * fallback so both paths behave identically.
 */
export async function runJob(env: Env, jobId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT type, status FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ type: string; status: string }>();

  if (!job || job.status === "done" || job.status === "failed") return;

  const handler = handlers[job.type];
  if (!handler) {
    await markFailed(env, jobId, `unknown_job_type:${job.type}`);
    return;
  }

  await env.DB.prepare(
    "UPDATE jobs SET status = 'running', attempt = attempt + 1, updated_at = ? WHERE id = ?",
  )
    .bind(Date.now(), jobId)
    .run();

  try {
    await handler(env, jobId);
  } catch (err) {
    await markFailed(env, jobId, err instanceof Error ? err.message : "job_error");
  }
}

export async function consume(env: Env, batch: MessageBatch<JobMessage>): Promise<void> {
  for (const message of batch.messages) {
    await runJob(env, message.body.job_id);
    // Failures are marked failed (non-retryable for now); always ack so the
    // local dev consumer does not redeliver a job the fallback already ran.
    message.ack();
  }
}
