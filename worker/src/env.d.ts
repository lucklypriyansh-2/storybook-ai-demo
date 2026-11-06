// Portable Env. DB/R2 are the libSQL-backed shims (storage/d1-libsql,
// storage/r2-libsql), typed with minimal interfaces so routes/jobs compile
// unchanged from the Cloudflare build. JOBS is an in-process queue the Node
// entry constructs.
export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  JOBS: Queue<JobMessage>;

  OPENROUTER_API_KEY?: string;
  FAL_KEY?: string;
  WORKER_SESSION_SECRET: string;
  /** Operator-only secret enabling POST /api/admin/bootstrap. Never logged. */
  ADMIN_TOKEN?: string;

  ENABLE_OPENROUTER?: string;
  ENABLE_FAL?: string;
  KILL_SWITCH?: string;
  MOCK_PROVIDERS?: string;
  ALLOWED_ORIGIN?: string;
  PUBLIC_API_BASE?: string;
  BUILD?: string;

  /** Google OAuth. The route 503s when either the id or secret is unset. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Absolute HTTPS URL Google should redirect to; e.g. "$PUBLIC_API_BASE/api/auth/google/callback". */
  GOOGLE_REDIRECT_URI?: string;
}

export type JobMessage = { job_id: string };

declare global {
  // --- D1 ---------------------------------------------------------------
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(): Promise<T | null>;
    all<T = unknown>(): Promise<{ results: T[]; success?: true; meta: { changes: number } }>;
    run(): Promise<{ success?: true; meta: { changes: number; last_row_id?: number } }>;
  }
  interface D1Database {
    prepare(sql: string): D1PreparedStatement;
    batch(
      statements: D1PreparedStatement[],
    ): Promise<{ success?: true; meta: { changes: number } }[]>;
  }

  // --- R2 (subset the worker uses) --------------------------------------
  interface R2HttpMetadata {
    contentType?: string;
  }
  interface R2PutOptions {
    httpMetadata?: R2HttpMetadata;
    customMetadata?: Record<string, string>;
  }
  interface R2ObjectBody {
    readonly httpMetadata?: R2HttpMetadata;
    readonly customMetadata?: Record<string, string>;
    readonly httpEtag: string;
    readonly body: ReadableStream<Uint8Array>;
    writeHttpMetadata(headers: Headers): void;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json<T>(): Promise<T>;
  }
  interface R2ListEntry {
    key: string;
    customMetadata?: Record<string, string>;
  }
  interface R2ListResult {
    objects: R2ListEntry[];
    truncated: boolean;
    cursor?: string;
  }
  interface R2Bucket {
    put(
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      options?: R2PutOptions,
    ): Promise<void>;
    get(key: string): Promise<R2ObjectBody | null>;
    delete(keys: string | string[]): Promise<void>;
    list(options?: { prefix?: string; cursor?: string }): Promise<R2ListResult>;
  }

  // --- Job queue (just the shape the inline runner needs) ---------------
  interface Queue<T> {
    send(message: T): Promise<void>;
  }
  interface MessageBatch<T> {
    messages: { body: T; ack: () => void }[];
  }

  // --- Legacy CF handler types, kept as opaque for removed index.ts -----
  type ExecutionContext = { waitUntil(p: Promise<unknown>): void };
  type ScheduledController = { scheduledTime: number };
  type Ai = unknown;
}
