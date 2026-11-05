import type { Env } from "../env";
import { isOn } from "../config/flags";

/** The subset `isKilled` needs, so budget guards can pass their own env shape. */
export type KillSwitchEnv = { DB: D1Database; KILL_SWITCH?: string };

/** Env KILL_SWITCH wins over the D1 row (design §3.5). */
export async function isKilled(env: KillSwitchEnv): Promise<boolean> {
  if (isOn(env.KILL_SWITCH, false)) return true;
  const row = await env.DB.prepare("SELECT enabled FROM kill_switch WHERE id = 1").first<{
    enabled: number;
  }>();
  return row?.enabled === 1;
}

export async function setKillSwitch(
  env: Env,
  enabled: boolean,
  reason?: string,
  now = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO kill_switch (id, enabled, reason, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, reason = excluded.reason, updated_at = excluded.updated_at`,
  )
    .bind(enabled ? 1 : 0, reason ?? null, now)
    .run();
}
