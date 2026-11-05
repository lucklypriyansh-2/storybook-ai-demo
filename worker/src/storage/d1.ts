export async function first<T>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...bindings)
    .first<T>();
}

export async function all<T>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  const result = await db
    .prepare(sql)
    .bind(...bindings)
    .all<T>();
  return result.results;
}

export async function exec(db: D1Database, sql: string, ...bindings: unknown[]) {
  return db
    .prepare(sql)
    .bind(...bindings)
    .run();
}
