import type { Env } from "../env";
import { PHOTOS_MAX_AGE_MS, TMP_MAX_AGE_MS } from "../config/limits";

/**
 * The 24h photo guarantee (design §5, Phase C #E). Two passes, cheapest first:
 *
 *  1. `sweepPhotos` — every `photos_tmp` row still live 24h after upload is
 *     soft-deleted and its R2 object removed. This is the promise the product
 *     copy makes, independent of whether any job ever claimed the photo (a
 *     user who uploads and never taps "make" is covered too).
 *  2. `sweepTmp` — objects under `tmp/` older than TMP_MAX_AGE_MS that have no
 *     live row are pure orphans (failed upload, forget, crashed job).
 *
 * `sweepAll` runs both in that order so pass 2 also collects the objects pass 1
 * just orphaned. Both are idempotent and report the number of R2 objects removed.
 */
export async function sweepPhotos(env: Env, now = Date.now()): Promise<number> {
  const cutoff = now - PHOTOS_MAX_AGE_MS;
  const rows = await env.DB.prepare(
    "SELECT id, r2_key FROM photos_tmp WHERE deleted_at IS NULL AND created_at < ? LIMIT 500",
  )
    .bind(cutoff)
    .all<{ id: string; r2_key: string }>();

  let deleted = 0;
  for (const row of rows.results) {
    // Object first, row second: a crash between the two leaves a live row whose
    // blob is gone (harmless, re-swept next tick) rather than an orphaned blob
    // with no row to find it by.
    await env.R2.delete(row.r2_key);
    await env.DB.prepare("UPDATE photos_tmp SET deleted_at = ? WHERE id = ?")
      .bind(now, row.id)
      .run();
    deleted++;
  }
  return deleted;
}

export async function sweepTmp(env: Env, now = Date.now()): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const listed = await env.R2.list({ prefix: "tmp/", cursor });
    for (const object of listed.objects) {
      const uploadedAt = Number(object.customMetadata?.uploaded_at ?? 0);
      if (!uploadedAt || now - uploadedAt < TMP_MAX_AGE_MS) continue;

      const row = await env.DB.prepare(
        "SELECT id FROM photos_tmp WHERE r2_key = ? AND deleted_at IS NULL",
      )
        .bind(object.key)
        .first();
      if (row) continue;

      await env.R2.delete(object.key);
      deleted++;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return deleted;
}

/** Both passes in order; the return value is the total R2 objects removed. */
export async function sweepAll(env: Env, now = Date.now()): Promise<number> {
  const photos = await sweepPhotos(env, now);
  const tmp = await sweepTmp(env, now);
  return photos + tmp;
}
