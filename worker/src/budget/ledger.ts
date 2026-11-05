import type { PaidProvider } from "../config/costs";
import { capFor } from "../config/limits";
import { isKilled, type KillSwitchEnv } from "./kill_switch";
import { BudgetExceeded, KillSwitchOn } from "../util/errors";

import { uuid } from "../util/uuid";

export type GuardArgs = {
  env: KillSwitchEnv;
  provider: PaidProvider;
  estUsd: number;
  userId?: string;
  model: string;
  step: string;
  now?: number;
};

const SELECT_LEDGER = "SELECT est_usd, provider FROM ledger WHERE id = ?";

export async function currentSpend(db: D1Database, provider: string): Promise<number> {
  const row = await db
    .prepare("SELECT total_usd FROM budget_state WHERE provider = ?")
    .bind(provider)
    .first<{ total_usd: number }>();
  return row?.total_usd ?? 0;
}

/**
 * Pre-charges estUsd against the provider cap. The conditional UPDATE makes the
 * cap check atomic under D1's serialized writes: two concurrent guards cannot
 * both push the total over the cap.
 */
export async function guardSpend(args: GuardArgs): Promise<string> {
  const { provider, estUsd } = args;
  const db = args.env.DB;
  const now = args.now ?? Date.now();
  const cap = capFor(provider);
  if (cap === undefined) throw new Error(`unknown_paid_provider:${provider}`);

  // Env KILL_SWITCH wins over the D1 row; every paid path funnels through here (H-3).
  if (await isKilled(args.env)) throw new KillSwitchOn();

  await db
    .prepare(
      "INSERT INTO budget_state (provider, total_usd, updated_at) VALUES (?, 0, ?) ON CONFLICT(provider) DO NOTHING",
    )
    .bind(provider, now)
    .run();

  const charge = await db
    .prepare(
      "UPDATE budget_state SET total_usd = total_usd + ?, updated_at = ? WHERE provider = ? AND total_usd + ? <= ?",
    )
    .bind(estUsd, now, provider, estUsd, cap)
    .run();

  if ((charge.meta.changes ?? 0) !== 1) {
    const spent = await currentSpend(db, provider);
    throw new BudgetExceeded(provider, Math.max(0, round6(cap - spent)));
  }

  const ledgerId = uuid();
  try {
    await db
      .prepare(
        "INSERT INTO ledger (id, user_id, provider, model, step, est_usd, actual_usd, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
      )
      .bind(ledgerId, args.userId ?? null, provider, args.model, args.step, estUsd, now)
      .run();
  } catch (err) {
    await db
      .prepare(
        "UPDATE budget_state SET total_usd = MAX(0, total_usd - ?), updated_at = ? WHERE provider = ?",
      )
      .bind(estUsd, now, provider)
      .run();
    throw err;
  }

  return ledgerId;
}

/** Non-reserving headroom check for fast route-level 402s; jobs re-guard atomically. */
export async function assertHeadroom(
  db: D1Database,
  provider: PaidProvider,
  estUsd: number,
): Promise<void> {
  const cap = capFor(provider);
  if (cap === undefined) throw new Error(`unknown_paid_provider:${provider}`);
  const spent = await currentSpend(db, provider);
  if (spent + estUsd > cap) throw new BudgetExceeded(provider, Math.max(0, round6(cap - spent)));
}

/** Delta-corrects the budget total to the provider's actual charge. */
export async function reconcileSpend(
  db: D1Database,
  ledgerId: string,
  actualUsd: number,
  requestId?: string,
  now = Date.now(),
): Promise<void> {
  const row = await db.prepare(SELECT_LEDGER).bind(ledgerId).first<{
    est_usd: number;
    provider: string;
  }>();
  if (!row) throw new Error("ledger_not_found");

  await db.batch([
    db
      .prepare(
        "UPDATE budget_state SET total_usd = MAX(0, total_usd + ?), updated_at = ? WHERE provider = ?",
      )
      .bind(round6(actualUsd - row.est_usd), now, row.provider),
    db
      .prepare("UPDATE ledger SET actual_usd = ?, request_id = ? WHERE id = ?")
      .bind(actualUsd, requestId ?? null, ledgerId),
  ]);
}

/** Removes a pre-charge after a provider error. Idempotent. */
export async function compensateSpend(
  db: D1Database,
  ledgerId: string,
  now = Date.now(),
): Promise<void> {
  const row = await db.prepare(SELECT_LEDGER).bind(ledgerId).first<{
    est_usd: number;
    provider: string;
  }>();
  if (!row) return;

  await db.batch([
    db
      .prepare(
        "UPDATE budget_state SET total_usd = MAX(0, total_usd - ?), updated_at = ? WHERE provider = ?",
      )
      .bind(row.est_usd, now, row.provider),
    db.prepare("DELETE FROM ledger WHERE id = ?").bind(ledgerId),
  ]);
}

function round6(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}
