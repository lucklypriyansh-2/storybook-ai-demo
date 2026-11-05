import type { Env } from "../env";
import { TMP_MAX_AGE_MS } from "../config/limits";

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
