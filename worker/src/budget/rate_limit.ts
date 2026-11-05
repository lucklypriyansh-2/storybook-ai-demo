import { DAILY_LIMITS, INVITE_LIMITS } from "../config/limits";
import { utcDay, utcHour } from "../util/day";
import { RateLimited } from "../util/errors";

/**
 * Consumes one token from a fixed-window bucket, creating it at `limit` on first
 * use. Returns the remaining count; throws RateLimited when exhausted.
 */
async function consumeBucket(
  db: D1Database,
  key: string,
  scope: string,
  limit: number,
  now: number,
): Promise<number> {
  await db
    .prepare(
      "INSERT INTO rate_buckets (key, tokens, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
    )
    .bind(key, limit, now)
    .run();

  const taken = await db
    .prepare(
      "UPDATE rate_buckets SET tokens = tokens - 1, updated_at = ? WHERE key = ? AND tokens >= 1",
    )
    .bind(now, key)
    .run();

  if ((taken.meta.changes ?? 0) !== 1) throw new RateLimited(scope);

  const row = await db
    .prepare("SELECT tokens FROM rate_buckets WHERE key = ?")
    .bind(key)
    .first<{ tokens: number }>();
  return row?.tokens ?? 0;
}

/** Consumes one token from a fixed daily window bucket, keyed by user. */
export function consumeDaily(
  db: D1Database,
  scope: string,
  userId: string,
  limit: number,
  now = Date.now(),
): Promise<number> {
  return consumeBucket(db, `${scope}:${userId}:${utcDay(now)}`, scope, limit, now);
}

export function consumeCharacter(db: D1Database, userId: string, now = Date.now()): Promise<number> {
  return consumeDaily(db, "chars", userId, DAILY_LIMITS.chars, now);
}

export function consumeReel(db: D1Database, userId: string, now = Date.now()): Promise<number> {
  return consumeDaily(db, "reels", userId, DAILY_LIMITS.reels, now);
}

/** Caps invite-code attempts per client IP per UTC hour (guards brute force, H-5). */
export function consumeInviteAttempt(db: D1Database, ip: string, now = Date.now()): Promise<number> {
  return consumeBucket(db, `invite:${ip}:${utcHour(now)}`, "invite", INVITE_LIMITS.perHour, now);
}
