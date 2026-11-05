// D1-compatible shim over @libsql/client. Only the surface the worker actually
// uses is implemented: prepare().bind().first/all/run and top-level batch().
// Callers cast the shim to `D1Database` at the boundary so route/job code is
// unchanged from the Cloudflare build.
import { createClient, type Client, type InArgs } from "@libsql/client";

type D1Meta = { changes: number; last_row_id?: number };
type D1Result<T> = { results: T[]; success: true; meta: D1Meta };

function toInArgs(args: unknown[]): InArgs {
  return args.map((a) => {
    if (a === null || a === undefined) return null;
    if (typeof a === "boolean") return a ? 1 : 0;
    if (a instanceof Uint8Array) return a;
    if (typeof a === "number" || typeof a === "bigint" || typeof a === "string") return a;
    return String(a);
  }) as InArgs;
}

function rowToObject(columns: string[], row: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    const v = row[i];
    out[columns[i]!] = typeof v === "bigint" ? Number(v) : v;
  }
  return out;
}

class LibsqlStatement {
  private args: InArgs = [];

  constructor(
    private client: Client,
    private sql: string,
  ) {}

  bind(...values: unknown[]): LibsqlStatement {
    this.args = toInArgs(values);
    return this;
  }

  async first<T>(): Promise<T | null> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    const row = rs.rows[0];
    return row ? (rowToObject(rs.columns, row as unknown as unknown[]) as T) : null;
  }

  async all<T>(): Promise<D1Result<T>> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    const results = rs.rows.map(
      (row) => rowToObject(rs.columns, row as unknown as unknown[]) as T,
    );
    return { results, success: true, meta: { changes: Number(rs.rowsAffected) } };
  }

  async run(): Promise<{ meta: D1Meta; success: true }> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    return {
      success: true,
      meta: {
        changes: Number(rs.rowsAffected),
        last_row_id:
          rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : undefined,
      },
    };
  }

  // Internal accessor for batch().
  _payload(): { sql: string; args: InArgs } {
    return { sql: this.sql, args: this.args };
  }
}

export class LibsqlDb {
  constructor(private client: Client) {}

  prepare(sql: string): LibsqlStatement {
    return new LibsqlStatement(this.client, sql);
  }

  async batch(statements: LibsqlStatement[]): Promise<{ meta: D1Meta; success: true }[]> {
    const payloads = statements.map((s) => s._payload());
    const results = await this.client.batch(payloads, "deferred");
    return results.map((rs) => ({
      success: true,
      meta: { changes: Number(rs.rowsAffected) },
    }));
  }
}

export function makeLibsqlDb(url: string, authToken?: string): LibsqlDb {
  const client = createClient({ url, ...(authToken ? { authToken } : {}) });
  return new LibsqlDb(client);
}

export function makeLibsqlDbFromClient(client: Client): LibsqlDb {
  return new LibsqlDb(client);
}

export { createClient };
export type { Client };
