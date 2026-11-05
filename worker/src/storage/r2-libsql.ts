// R2-compatible shim backed by a libSQL `blobs` table. Supports the subset of
// the R2 surface the worker uses: put/get/delete(single|string[])/list({prefix,
// cursor}) and bodies that expose arrayBuffer/text/json/body/writeHttpMetadata/
// httpEtag/httpMetadata/customMetadata.
import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";

type PutOpts = {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

type ListObject = { key: string; customMetadata?: Record<string, string> };

type ListResult = { objects: ListObject[]; truncated: boolean; cursor?: string };

async function etagFor(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so the SharedArrayBuffer case doesn't widen
  // the type crypto.subtle.digest expects.
  const buf = bytes.slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex}"`;
}

function toBytes(value: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

export class LibsqlR2Body {
  constructor(
    private bytes: Uint8Array,
    private meta: { contentType?: string; customMetadata?: Record<string, string>; etag: string },
  ) {}

  get httpMetadata(): { contentType?: string } {
    return { contentType: this.meta.contentType };
  }

  get customMetadata(): Record<string, string> | undefined {
    return this.meta.customMetadata;
  }

  get httpEtag(): string {
    return this.meta.etag;
  }

  get body(): ReadableStream<Uint8Array> {
    const bytes = this.bytes;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  writeHttpMetadata(headers: Headers): void {
    if (this.meta.contentType) headers.set("Content-Type", this.meta.contentType);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.slice().buffer;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.bytes);
  }

  async json<T>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }
}

export class LibsqlR2 {
  constructor(private client: Client) {}

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: PutOpts,
  ): Promise<void> {
    const bytes = toBytes(value);
    const now = Date.now();
    const customMeta = options?.customMetadata
      ? JSON.stringify(options.customMetadata)
      : null;
    await this.client.execute({
      sql: `INSERT INTO blobs (key, content, content_type, uploaded_at, custom_meta)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              content = excluded.content,
              content_type = excluded.content_type,
              uploaded_at = excluded.uploaded_at,
              custom_meta = excluded.custom_meta`,
      args: [key, bytes, options?.httpMetadata?.contentType ?? null, now, customMeta],
    });
  }

  async get(key: string): Promise<LibsqlR2Body | null> {
    const rs = await this.client.execute({
      sql: "SELECT content, content_type, custom_meta FROM blobs WHERE key = ?",
      args: [key],
    });
    const row = rs.rows[0];
    if (!row) return null;
    const content = row[0];
    const contentType = (row[1] as string | null) ?? undefined;
    const rawMeta = (row[2] as string | null) ?? null;
    const bytes =
      content instanceof Uint8Array
        ? content
        : content instanceof ArrayBuffer
          ? new Uint8Array(content)
          : new Uint8Array(0);
    const customMetadata = rawMeta ? (JSON.parse(rawMeta) as Record<string, string>) : undefined;
    const etag = await etagFor(bytes);
    return new LibsqlR2Body(bytes, { contentType, customMetadata, etag });
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    if (list.length === 0) return;
    const placeholders = list.map(() => "?").join(",");
    await this.client.execute({
      sql: `DELETE FROM blobs WHERE key IN (${placeholders})`,
      args: list,
    });
  }

  async list(options?: { prefix?: string; cursor?: string }): Promise<ListResult> {
    const prefix = options?.prefix ?? "";
    const rs = await this.client.execute({
      sql: "SELECT key, custom_meta FROM blobs WHERE key LIKE ? ORDER BY key",
      args: [`${prefix}%`],
    });
    const objects: ListObject[] = rs.rows.map((row) => {
      const key = String(row[0]);
      const rawMeta = (row[1] as string | null) ?? null;
      const customMetadata = rawMeta
        ? (JSON.parse(rawMeta) as Record<string, string>)
        : undefined;
      return { key, ...(customMetadata ? { customMetadata } : {}) };
    });
    return { objects, truncated: false };
  }
}

export function makeLibsqlR2(url: string, authToken?: string): LibsqlR2 {
  const client = createClient({ url, ...(authToken ? { authToken } : {}) });
  return new LibsqlR2(client);
}

// Allow sharing one libSQL client with the D1 shim when the same connection is used.
export function makeLibsqlR2FromClient(client: Client): LibsqlR2 {
  return new LibsqlR2(client);
}
