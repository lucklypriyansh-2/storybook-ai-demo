import type { Env } from "../env";
import { compensateSpend, guardSpend, reconcileSpend } from "../budget/ledger";
import { isKilled } from "../budget/kill_switch";
import { COSTS } from "../config/costs";
import { MODELS } from "../config/models";
import { livePaid, makeProviders, pickFreeImage } from "../providers";
import { keys } from "../storage/r2";
import { KillSwitchOn } from "../util/errors";
import { uuid } from "../util/uuid";
import { setProgress } from "./state";

type JobRow = { kid_id: string | null; photo_id: string | null };

export async function characterSheetJob(env: Env, jobId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT kid_id, photo_id FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<JobRow>();
  if (!job?.kid_id || !job.photo_id) throw new Error("character_sheet_missing_context");

  const kid = await env.DB.prepare("SELECT user_id FROM kids WHERE id = ?")
    .bind(job.kid_id)
    .first<{ user_id: string }>();
  if (!kid) throw new Error("character_sheet_missing_kid");

  const photo = await env.DB.prepare(
    "SELECT r2_key FROM photos_tmp WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
  )
    .bind(job.photo_id, kid.user_id)
    .first<{ r2_key: string }>();
  if (!photo) throw new Error("character_sheet_missing_photo");

  await setProgress(env, jobId, 10);
  if (await isKilled(env)) throw new KillSwitchOn();

  // Mocked or openrouter-disabled: free path, no ledger entry at all.
  const paid = livePaid(env, "openrouter");
  const image = paid ? makeProviders(env).image : pickFreeImage(env);
  const model = paid ? MODELS.openrouterImage : MODELS.freeImage;
  const estUsd = paid ? COSTS.character_sheet.usd : 0;
  const ledgerId = paid
    ? await guardSpend({
        env,
        provider: "openrouter",
        estUsd,
        model,
        step: "character_sheet",
        userId: kid.user_id,
      })
    : null;

  try {
    const stored = await env.R2.get(photo.r2_key);
    if (!stored) throw new Error("character_sheet_photo_missing");

    const result = await image.generate({
      prompt:
        "Character sheet for a children's storybook. Preserve the child's likeness, keep it gentle and consistent.",
      image: {
        data: new Uint8Array(await stored.arrayBuffer()),
        mime: stored.httpMetadata?.contentType ?? "image/jpeg",
      },
    });

    const sheetId = uuid();
    const sheetKey = keys.sheet(job.kid_id, sheetId);
    await env.R2.put(sheetKey, result.value.bytes, {
      httpMetadata: { contentType: result.value.mime },
    });
    await setProgress(env, jobId, 90);

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO characters (id, kid_id, sheet_r2_key, model, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(sheetId, job.kid_id, sheetKey, model, now),
      env.DB.prepare("UPDATE photos_tmp SET deleted_at = ? WHERE id = ?").bind(now, job.photo_id),
      env.DB.prepare("UPDATE jobs SET status = 'done', progress = 100, updated_at = ? WHERE id = ?")
        .bind(now, jobId),
    ]);

    await env.R2.delete(photo.r2_key);
    if (ledgerId) {
      await reconcileSpend(env.DB, ledgerId, result.actualUsd ?? estUsd, result.requestId);
    }
    await setProgress(env, jobId, 100);
  } catch (err) {
    if (ledgerId) await compensateSpend(env.DB, ledgerId);
    await env.R2.delete(photo.r2_key);
    await env.DB.prepare("UPDATE photos_tmp SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), job.photo_id)
      .run();
    throw err;
  }
}
