import type { Env } from "../env";
import { compensateSpend, guardSpend, reconcileSpend } from "../budget/ledger";
import { isKilled } from "../budget/kill_switch";
import { COSTS, type Tier } from "../config/costs";
import { MODELS } from "../config/models";
import { livePaid, pickProvider } from "../providers";
import type { ImageGen } from "../providers/types";
import { keys } from "../storage/r2";
import { KillSwitchOn } from "../util/errors";

/**
 * Redraws a single page's keyframe (R.5.1). Same provider rules as the reel
 * pipeline's keyframe step:
 *
 *  - `free` uses the mock image adapter (deterministic placeholder bytes, $0);
 *  - `paid`/`hd` use OpenRouter's image model when the flag is on and a key is
 *    present, and throw `provider_disabled` when it is not.
 *
 * fal is never used here — this generates a still, not motion.
 *
 * Returns the stored R2 key so the caller can record it on the page override.
 */
export async function regenerateKeyframe(
  env: Env,
  opts: { reelId: string; index: number; kidId: string; caption: string; tier: Tier },
): Promise<{ key: string; actualUsd: number; model: string }> {
  if (await isKilled(env)) throw new KillSwitchOn();

  const image = pickProvider(env, "keyframe", opts.tier) as ImageGen;
  // `pickProvider` returns the mock adapter for a free tier or a disabled
  // provider, so a paid ledger charge only ever happens for the real model.
  // (`reel_generate.ts` keys off the adapter id the same way.)
  const paid = image.id === "openrouter-gemini-2.5-flash-image" && livePaid(env, "openrouter");
  const model = paid ? MODELS.openrouterImage : MODELS.freeImage;
  const estUsd = paid ? COSTS.keyframe_paid.usd : 0;

  const ledgerId = paid
    ? await guardSpend({
        env,
        provider: "openrouter",
        estUsd,
        model,
        step: "page_keyframe",
      })
    : null;

  try {
    // Reuse the kid's latest character sheet as the likeness reference, exactly
    // as the reel pipeline does, so a redraw matches the rest of the book.
    const ref = paid ? await sheetRef(env, opts.kidId) : undefined;
    const out = await image.generate({
      prompt: `Storybook illustration for page ${opts.index}: ${opts.caption}`,
      ...(ref ? { image: ref } : {}),
    });

    const key = keys.reel(opts.reelId, `page-${opts.index}.png`);
    await env.R2.put(key, out.value.bytes, {
      httpMetadata: { contentType: out.value.mime },
    });
    const actualUsd = paid ? out.actualUsd ?? estUsd : 0;
    if (ledgerId) await reconcileSpend(env.DB, ledgerId, actualUsd, out.requestId);
    return { key, actualUsd, model };
  } catch (err) {
    if (ledgerId) await compensateSpend(env.DB, ledgerId);
    throw err;
  }
}

async function sheetRef(env: Env, kidId: string): Promise<{ data: Uint8Array; mime: string } | undefined> {
  const row = await env.DB.prepare(
    "SELECT sheet_r2_key FROM characters WHERE kid_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(kidId)
    .first<{ sheet_r2_key: string }>();
  if (!row) return undefined;
  const stored = await env.R2.get(row.sheet_r2_key);
  if (!stored) return undefined;
  return {
    data: new Uint8Array(await stored.arrayBuffer()),
    mime: stored.httpMetadata?.contentType ?? "image/png",
  };
}
