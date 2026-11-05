// Builds the portable Env from process.env. Shared by node-server.ts and the
// Vercel serverless handler. Never logs secrets.
import type { Env, JobMessage } from "./env";
import { createClient, type Client } from "@libsql/client";
import { LibsqlDb } from "./storage/d1-libsql";
import { LibsqlR2 } from "./storage/r2-libsql";
import { runJob } from "./jobs/consumer";

export type NodeEnv = Env & { __client: Client };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

let cached: NodeEnv | undefined;

/**
 * One libSQL client + Env per process (Vercel reuses warm handlers, so this
 * caches). The JOBS queue is a thin in-process send that dispatches runJob;
 * failed jobs are marked failed by runJob itself (see jobs/consumer.ts).
 */
export function getEnv(): NodeEnv {
  if (cached) return cached;

  const url = process.env.LIBSQL_URL ?? "file:./.data/worker.db";
  const authToken = process.env.LIBSQL_AUTH_TOKEN;
  const client = createClient({ url, ...(authToken ? { authToken } : {}) });

  const db = new LibsqlDb(client);
  const r2 = new LibsqlR2(client);

  const env: NodeEnv = {
    __client: client,
    DB: db as unknown as D1Database,
    R2: r2 as unknown as R2Bucket,
    JOBS: {
      async send(message: JobMessage) {
        // Fire-and-forget: route handlers also call maybeRunInline right after,
        // so the main execution path runs the job synchronously. This send is
        // kept for compatibility; a missed dispatch gets recovered by the stale
        // job poller.
        try {
          await runJob(env, message.job_id);
        } catch {
          // runJob already marked the job failed.
        }
      },
    } as Queue<JobMessage>,
    WORKER_SESSION_SECRET: requireEnv("WORKER_SESSION_SECRET"),
    ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
    ...(process.env.FAL_KEY ? { FAL_KEY: process.env.FAL_KEY } : {}),
    ...(process.env.ENABLE_OPENROUTER ? { ENABLE_OPENROUTER: process.env.ENABLE_OPENROUTER } : {}),
    ...(process.env.ENABLE_FAL ? { ENABLE_FAL: process.env.ENABLE_FAL } : {}),
    ...(process.env.KILL_SWITCH ? { KILL_SWITCH: process.env.KILL_SWITCH } : {}),
    ...(process.env.MOCK_PROVIDERS ? { MOCK_PROVIDERS: process.env.MOCK_PROVIDERS } : {}),
    ...(process.env.ALLOWED_ORIGIN ? { ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN } : {}),
    ...(process.env.PUBLIC_API_BASE ? { PUBLIC_API_BASE: process.env.PUBLIC_API_BASE } : {}),
    ...(process.env.BUILD ? { BUILD: process.env.BUILD } : {}),
  };

  cached = env;
  return env;
}
