export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  JOBS: Queue<JobMessage>;
  AI: Ai;

  OPENROUTER_API_KEY?: string;
  FAL_KEY?: string;
  WORKER_SESSION_SECRET: string;

  ENABLE_WORKERS_AI?: string;
  ENABLE_OPENROUTER?: string;
  ENABLE_FAL?: string;
  KILL_SWITCH?: string;
  MOCK_PROVIDERS?: string;
  ALLOWED_ORIGIN?: string;
  PUBLIC_API_BASE?: string;
  BUILD?: string;
}

export type JobMessage = { job_id: string };
