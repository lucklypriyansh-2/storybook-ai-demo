import type { Env } from "../env";
import { readFlags } from "../config/flags";
import type { Tier } from "../config/costs";
import { mediaUrl } from "../storage/signed";
import { ProviderDisabled } from "../util/errors";
import { makeFalVideo } from "./fal";
import { makeMockImage, makeMockText, makeMockVideo } from "./mock";
import { makeOpenRouterImage, makeOpenRouterText } from "./openrouter";
import type { ImageGen, TextGen, VideoGen } from "./types";
import { makeWorkersAiImage, makeWorkersAiText } from "./workers_ai";

export type ProviderSet = { image: ImageGen; text: TextGen; video: VideoGen; mocked: boolean };

/** Free image path: workers_ai when enabled, else the mock. Never a paid call. */
export function pickFreeImage(env: Env): ImageGen {
  const flags = readFlags(env);
  if (!flags.mockProviders && flags.workersAi) return makeWorkersAiImage(env.AI, env.DB);
  return makeMockImage();
}

/**
 * True only when a step would make a real billed provider call: the flag is on,
 * a key is present, and providers are not mocked. Jobs use this to decide
 * whether to touch the ledger — mocked/disabled steps stay at $0.
 */
export function livePaid(env: Env, provider: "openrouter" | "fal"): boolean {
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
  } else if (flags.workersAi) {
    text = makeWorkersAiText(env.AI, env.DB);
  } else {
    text = makeMockText();
  }

  const video: VideoGen =
    !mock && flags.fal && env.FAL_KEY
      ? makeFalVideo(env.FAL_KEY, (key) => mediaUrl(env, key))
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
    if (tier === "free") {
      if (!flags.mockProviders && !flags.workersAi) throw new ProviderDisabled("workers_ai");
      return flags.workersAi && !flags.mockProviders
        ? makeWorkersAiImage(env.AI, env.DB)
        : makeMockImage();
    }
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    return set.image;
  }

  if (step === "shot_list") {
    if (tier === "free") {
      if (!flags.mockProviders && !flags.workersAi) throw new ProviderDisabled("workers_ai");
      return flags.workersAi && !flags.mockProviders
        ? makeWorkersAiText(env.AI, env.DB)
        : makeMockText();
    }
    if (!flags.mockProviders && !flags.openrouter) throw new ProviderDisabled("openrouter");
    return set.text;
  }

  if (!flags.mockProviders && !flags.fal) throw new ProviderDisabled("fal");
  return set.video;
}
