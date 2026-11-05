import { Unauthorized } from "../util/errors";

export type InviteRow = { code: string; max_uses: number; used_count: number };

/**
 * Validates an invite code without consuming it. Callers increment used_count
 * only after the rest of signup succeeds.
 */
export async function validateInvite(db: D1Database, code: string): Promise<InviteRow> {
  const row = await db
    .prepare("SELECT code, max_uses, used_count FROM invite_codes WHERE code = ?")
    .bind(code)
    .first<InviteRow>();

  if (!row) throw new Unauthorized("unknown_invite_code");
  if (row.used_count >= row.max_uses) throw new Unauthorized("invite_code_exhausted");
  return row;
}

/** Atomically consumes one use; returns false if the code was exhausted concurrently. */
export async function consumeInvite(db: D1Database, code: string): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ? AND used_count < max_uses",
    )
    .bind(code)
    .run();
  return (result.meta.changes ?? 0) === 1;
}
