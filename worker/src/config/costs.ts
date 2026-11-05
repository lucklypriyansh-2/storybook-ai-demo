// Pinned 2026-11-05. Changing any number requires a PR (design §12).
export const COSTS = {
  shot_list: { provider: "openrouter", model: "google/gemini-2.5-flash", usd: 0.0002 },
  shot_list_free: { provider: "workers_ai", model: "@cf/meta/llama-3.1-8b-instruct", usd: 0 },
  character_sheet: { provider: "openrouter", model: "google/gemini-2.5-flash-image", usd: 0.039 },
  keyframe_paid: { provider: "openrouter", model: "google/gemini-2.5-flash-image", usd: 0.039 },
  keyframe_free: { provider: "workers_ai", model: "@cf/black-forest-labs/flux-1-schnell", usd: 0 },
  motion_i2v: { provider: "fal", model: "fal-ai/wan-2.1/image-to-video", usdPerSecond: 0.01 },
  tts: { provider: "none", model: "kokoro-in-browser", usd: 0 },
  music: { provider: "none", model: "cc0-bundled", usd: 0 },
  compose: { provider: "none", model: "browser-mediarecorder", usd: 0 },
} as const;

export type PaidProvider = "openrouter" | "fal";
export type Tier = "free" | "paid" | "hd";

export const SHOT_COUNT = 6;
export const SHOT_SECONDS = 2.5; // 15s of motion per reel

export function prechargeUsd(tier: Tier): number {
  if (tier === "free") return 0;
  const paid = COSTS.shot_list.usd + SHOT_COUNT * COSTS.keyframe_paid.usd;
  if (tier === "paid") return round(paid);
  return round(paid + SHOT_COUNT * SHOT_SECONDS * COSTS.motion_i2v.usdPerSecond);
}

export function motionUsd(seconds: number): number {
  return round(seconds * COSTS.motion_i2v.usdPerSecond);
}

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}
