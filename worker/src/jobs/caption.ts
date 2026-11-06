import type { Env } from "../env";
import { guardSpend, reconcileSpend, compensateSpend } from "../budget/ledger";
import { isKilled } from "../budget/kill_switch";
import { COSTS, type Tier } from "../config/costs";
import { MODELS } from "../config/models";
import { MAX_PAGE_TEXT } from "../config/limits";
import { livePaid, pickProvider } from "../providers";
import { KillSwitchOn } from "../util/errors";
import type { TextGen } from "../providers/types";

export type CaptionContext = {
  story: string;
  index: number;
  pageCount: number;
  /** The page's current text, so a regenerate edits rather than restarts. */
  current: string | null;
  hint?: string;
};

/**
 * Rewrites one page caption through the existing text stack (R.5.1).
 *
 * Free path (mock providers, or openrouter off/no key) spends $0 and writes no
 * ledger row — same rule as the character-sheet and reel jobs. A live call is
 * pre-charged, reconciled to the actual, and compensated on error, so a failed
 * regenerate never strands budget.
 *
 * The result is clamped to MAX_PAGE_TEXT (the same cap a manual edit gets) and
 * falls back to the current text when the model returns nothing usable, so a
 * regenerate can never blank a page.
 */
export async function regenerateCaption(
  env: Env,
  ctx: CaptionContext,
  tier: Tier = "free",
): Promise<{ text: string; actualUsd: number; model: string }> {
  if (await isKilled(env)) throw new KillSwitchOn();

  const paid = livePaid(env, "openrouter");
  const text = pickProvider(env, "shot_list", tier) as TextGen;
  const model = paid ? MODELS.openrouterText : MODELS.freeText;
  const estUsd = paid ? COSTS.shot_list.usd : 0;

  const ledgerId = paid
    ? await guardSpend({
        env,
        provider: "openrouter",
        estUsd,
        model,
        step: "page_regenerate",
      })
    : null;

  try {
    const out = await text.complete({
      system:
        "You rewrite ONE page of a gentle children's storybook. Keep it under 30 words, kind and concrete. Reply with the page text only — no quotes, no preamble.",
      prompt: [
        `Story: ${ctx.story}`,
        `This is page ${ctx.index} of ${ctx.pageCount}.`,
        ctx.current ? `Current text: ${ctx.current}` : "",
        ctx.hint ? `What to change: ${ctx.hint}` : "",
        "Write the new page text.",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const cleaned = cleanCaption(out.value.text);
    const value = cleaned || ctx.current || "";
    if (ledgerId) {
      await reconcileSpend(env.DB, ledgerId, out.actualUsd ?? estUsd, out.requestId);
    }
    return { text: value.slice(0, MAX_PAGE_TEXT), actualUsd: out.actualUsd ?? estUsd, model };
  } catch (err) {
    if (ledgerId) await compensateSpend(env.DB, ledgerId);
    throw err;
  }
}

/**
 * Mock adapters return `{"shots":[],"prompt_hash":"…"}` for every text call, so a
 * naive read would write JSON into the page. Unwrap a `{text}` envelope and drop
 * anything that still looks like a raw JSON object.
 */
export function cleanCaption(raw: string): string {
  let value = (raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { text?: unknown; caption?: unknown };
      const inner = parsed.text ?? parsed.caption;
      if (typeof inner === "string") value = inner.trim();
      else return "";
    } catch {
      return "";
    }
  }
  // Strip a wrapping pair of straight quotes the model may add despite the system prompt.
  value = value.replace(/^"(.*)"$/s, "$1").replace(/\s+/g, " ").trim();
  return value;
}
