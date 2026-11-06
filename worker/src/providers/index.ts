import type { Env } from "../env";
import { readFlags } from "../config/flags";
import type { Tier } from "../config/costs";
import { mediaUrl } from "../storage/signed";
import { ProviderDisabled } from "../util/errors";
import { makeMockImage, makeMockText, makeMockVideo } from "./mock";
import { makeOpenRouterImage, makeOpenRouterText } from "./openrouter";
import { makeOpenRouterVideo } from "./openrouter_video";
import type { ImageGen, TextGen, VideoGen } from "./types";

export type ProviderSet = { image: ImageGen; text: TextGen; video: VideoGen; mocked: boolean };

/**
 * Paid steps now bill through OpenRouter for images, text **and** motion (§H).
 * `fal` stays in the union only so historical ledger rows still typecheck; no
 * live path selects it.
 */
export type PaidStep = "openrouter" | "fal";

/** Free path always resolves to the mock in the portable build (no Workers AI). */
export function pickFreeImage(_env: Env): ImageGen {
  return makeMockImage();
}

/**
 * True only when a step would make a real billed provider call: the flag is on,
 * a key is present, and providers are not mocked. Jobs use this to decide
 * whether to touch the ledger — mocked/disabled steps stay at $0.
 */
export function livePaid(env: Env, provider: PaidStep): boolean {
  const flags = readFlags(env);
  if (flags.mockProviders) return false;
  return provider === "openrouter"
    ? flags.openrouter && !!env.OPENROUTER_API_KEY
    : flags.fal && !!env.FAL_KEY;
}

/**
 * Selection order: mock mode wins; then a disabled flag throws; then a missing
 * key falls back to mocks. A flag alone must never cause an unkeyed real call.
 */
export function makeProviders(env: Env): ProviderSet {
  const flags = readFlags(env);
  const mock = flags.mockProviders;

  let image: ImageGen;
  if (mock) {
    image = makeMockImage();
  } else if (flags.openrouter) {
    image = env.OPENROUTER_API_KEY ? makeOpenRouterImage(env.OPENROUTER_API_KEY) : makeMockImage();
  } else {
    image = makeMockImage();
  }

  let text: TextGen;
  if (mock) {
    text = makeMockText();
  } else if (flags.openrouter && env.OPENROUTER_API_KEY) {
    text = makeOpenRouterText(env.OPENROUTER_API_KEY);
  } else {
    text = makeMockText();
  }

  // Motion is OpenRouter now (§H): no fal gate, no fal key. Same rule as images —
  // the flag must be on AND a key present, else we stay on the mock.
  const video: VideoGen =
    !mock && flags.openrouter && env.OPENROUTER_API_KEY
      ? makeOpenRouterVideo(env.OPENROUTER_API_KEY, (key) => mediaUrl(env, key))
      : makeMockVideo();

  return { image, text, video, mocked: mock };
}

export type StepKind = "character_sheet" | "shot_list" | "keyframe" | "motion_i2v";

/** Picks the adapter for a pipeline step, honoring flags and tier. */
export function pickProvider(
  env: Env,
  step: StepKind,
  tier: Tier = "paid",
): ImageGen | TextGen | VideoGen {
  const flags = readFlags(env);
  const set = makeProviders(env);

  if (step === "character_sheet") {
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    return set.image;
  }

  if (step === "keyframe") {
    if (tier === "free") return makeMockImage();
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    return set.image;
  }

  if (step === "shot_list") {
    if (tier === "free") return makeMockText();
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    return set.text;
  }

  // Motion follows OpenRouter, not fal (§H). Honesty rule: a keyless OpenRouter
  // must not silently "succeed" as a mock for a paid HD request, so we throw —
  // but the message never names fal.
  if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
  // Flag on but no key: `set.video` is the mock here, which is only acceptable
  // for a free-tier request. A paid HD render must fail loudly instead.
  if (!flags.mockProviders && tier !== "free" && set.video.id === "mock-video") {
    throw new ProviderDisabled("openrouter");
  }
  return set.video;
}
