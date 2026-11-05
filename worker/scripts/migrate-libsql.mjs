#!/usr/bin/env node
// Applies worker/migrations/*.sql in lexical order against a libSQL URL.
// Local default: file:./.data/worker.db. Turso: LIBSQL_URL + LIBSQL_AUTH_TOKEN.
import { createClient } from "@libsql/client";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "..", "migrations");

const url = process.env.LIBSQL_URL ?? "file:./.data/worker.db";
const authToken = process.env.LIBSQL_AUTH_TOKEN;

if (url.startsWith("file:")) {
  const relative = url.slice("file:".length);
  const fullPath = resolve(process.cwd(), relative);
  mkdirSync(dirname(fullPath), { recursive: true });
}

const client = createClient({ url, ...(authToken ? { authToken } : {}) });

await client.execute(
  "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
);

const applied = new Set(
  (await client.execute("SELECT name FROM _migrations")).rows.map((r) => String(r[0])),
);

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  // Split on ; but keep it simple — all our migrations are plain DDL.
  // Strip `-- …` line comments before splitting so header comments don't glue
  // onto the first statement (and never cause it to be dropped by the filter).
  const stripped = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  const statements = stripped
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    try {
      await client.execute(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Idempotent DDL: skip "already exists" when re-applying the fresh branch.
      if (!/already exists/i.test(msg)) throw err;
    }
  }
  await client.execute({
    sql: "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
    args: [file, Date.now()],
  });
  process.stdout.write(`applied ${file}\n`);
  count++;
}

process.stdout.write(`migrate done (${count} new)\n`);
process.exit(0);
