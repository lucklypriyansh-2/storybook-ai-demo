// Pinned 2026-11-05 (motion repriced 2026-11-06). Changing any number requires a
// PR (design §12).
export const COSTS = {
  shot_list: { provider: "openrouter", model: "google/gemini-2.5-flash", usd: 0.0002 },
  shot_list_free: { provider: "mock", model: "mock-text", usd: 0 },
  character_sheet: { provider: "openrouter", model: "google/gemini-2.5-flash-image", usd: 0.039 },
  keyframe_paid: { provider: "openrouter", model: "google/gemini-2.5-flash-image", usd: 0.039 },
  // Free now gets real stills when OpenRouter is live; the price matches a paid
  // still so the ledger/cap guards the same per-call amount. When OpenRouter is
  // not live the free path stays on the mock and bills $0 — see pipeline jobs.
  keyframe_free: { provider: "openrouter", model: "google/gemini-2.5-flash-image", usd: 0.039 },
  // Motion moved onto OpenRouter's Videos API. Default is
  // `google/gemini-omni-1.2-flash`, billed per second of generated video with
  // `generate_audio: false`. Estimate: the listed 360p SKU is ~$0.023–0.025/s,
  // so a 3s clip is ~$0.07. We budget at the top of that band ($0.025/s) so the
  // pre-charge never under-estimates; reconcileSpend corrects to the actual.
  motion_i2v: { provider: "openrouter", model: "google/gemini-omni-1.2-flash", usdPerSecond: 0.025 },
  tts: { provider: "none", model: "kokoro-in-browser", usd: 0 },
  music: { provider: "none", model: "cc0-bundled", usd: 0 },
  compose: { provider: "none", model: "browser-mediarecorder", usd: 0 },
} as const;

// `fal` remains a valid ledger provider so historical rows still reconcile, but
// nothing new charges it: motion is OpenRouter now.
export type PaidProvider = "openrouter" | "fal";
export type Tier = "free" | "paid" | "hd";

export const SHOT_COUNT = 6;
export const SHOT_SECONDS = 3; // gemini-omni-1.2-flash short-clip duration (see §H)

/**
 * Pre-charge for the whole reel pipeline (shot list + N keyframes). Free, paid
 * and hd all precharge the same base now when OpenRouter is live, because free
 * now gets real stills too (motion stays paid-only). Callers only invoke this
 * when `livePaid(env, "openrouter")` is true; the mock path still spends $0.
 */
export function prechargeUsd(tier: Tier): number {
  const paid = COSTS.shot_list.usd + SHOT_COUNT * COSTS.keyframe_paid.usd;
  if (tier === "free" || tier === "paid") return round(paid);
  return round(paid + SHOT_COUNT * SHOT_SECONDS * COSTS.motion_i2v.usdPerSecond);
}

export function motionUsd(seconds: number): number {
  return round(seconds * COSTS.motion_i2v.usdPerSecond);
}

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}
