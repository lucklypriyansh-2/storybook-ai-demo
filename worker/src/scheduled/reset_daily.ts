import type { Env } from "../env";
import { utcDay, utcHour } from "../util/day";

/**
 * Prunes stale rate buckets. Daily buckets end in `<yyyymmdd>`; hourly invite
 * buckets end in `<yyyymmddhh>`, so the current hour must be preserved too or
 * this per-minute job would wipe the invite limiter mid-hour (H-5).
 */
export async function resetDaily(env: Env, now = Date.now()): Promise<number> {
  const result = await env.DB.prepare(
    "DELETE FROM rate_buckets WHERE key LIKE '%:%' AND key NOT LIKE ? AND key NOT LIKE ?",
  )
    .bind(`%:${utcDay(now)}`, `%:${utcHour(now)}`)
    .run();
  return result.meta.changes ?? 0;
}
