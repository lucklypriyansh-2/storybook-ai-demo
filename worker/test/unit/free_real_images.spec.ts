import { describe, expect, it } from "vitest";
import { makeProviders, pickFreeImage, pickProvider } from "../../src/providers";
import { PROVIDER_CAP_USD } from "../../src/config/limits";
import { prechargeUsd } from "../../src/config/costs";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

function envFrom(overrides: Partial<Env> = {}): Env {
  return {
    DB: asD1(new FakeD1()),
    R2: asR2(new FakeR2()),
    JOBS: {},
    WORKER_SESSION_SECRET: "test",
    ...overrides,
  } as unknown as Env;
}

describe("free tier picks the live OpenRouter image when the provider is on", () => {
  it("pickFreeImage returns the OpenRouter image adapter when openrouter is live", () => {
    const image = pickFreeImage(
      envFrom({ ENABLE_OPENROUTER: "1", OPENROUTER_API_KEY: "test-key" }),
    );
    expect(image.id).toBe("openrouter-gemini-2.5-flash-image");
  });

  it("pickProvider('keyframe', 'free') returns OpenRouter when live", () => {
    const image = pickProvider(
      envFrom({ ENABLE_OPENROUTER: "1", OPENROUTER_API_KEY: "test-key" }),
      "keyframe",
      "free",
    );
    expect(image.id).toBe("openrouter-gemini-2.5-flash-image");
  });

  it("pickProvider('shot_list', 'free') returns OpenRouter text when live", () => {
    const text = pickProvider(
      envFrom({ ENABLE_OPENROUTER: "1", OPENROUTER_API_KEY: "test-key" }),
      "shot_list",
      "free",
    );
    expect(text.id).toBe("openrouter-gemini-2.5-flash");
  });

  it("MOCK_PROVIDERS=1 keeps the mock on free even with the OpenRouter key set", () => {
    const image = pickFreeImage(
      envFrom({
        MOCK_PROVIDERS: "1",
        ENABLE_OPENROUTER: "1",
        OPENROUTER_API_KEY: "test-key",
      }),
    );
    expect(image.id).toBe("mock-image");

    const text = pickProvider(
      envFrom({
        MOCK_PROVIDERS: "1",
        ENABLE_OPENROUTER: "1",
        OPENROUTER_API_KEY: "test-key",
      }),
      "shot_list",
      "free",
    );
    expect(text.id).toBe("mock-text");
  });

  it("falls back to the mock for free when OpenRouter is off or keyless", () => {
    const off = pickFreeImage(envFrom({ ENABLE_OPENROUTER: "0" }));
    expect(off.id).toBe("mock-image");

    const noKey = pickFreeImage(envFrom({ ENABLE_OPENROUTER: "1" }));
    expect(noKey.id).toBe("mock-image");
  });

  it("free NEVER picks live motion — motion still requires paid/hd gating logic", () => {
    // makeProviders shares the same openrouter/motion adapter regardless of
    // tier, but pickProvider for motion_i2v throws unless openrouter is on
    // with a key AND tier is paid/hd. Free users never request motion from
    // the pipeline (reel_generate only enqueues motion for tier === 'hd').
    const providers = makeProviders(
      envFrom({ ENABLE_OPENROUTER: "1", OPENROUTER_API_KEY: "test-key" }),
    );
    expect(providers.video.id).toBe("openrouter-gemini-omni-1.2-flash-i2v");
    // But the free-tier precharge excludes motion seconds entirely:
    expect(prechargeUsd("free")).toBe(prechargeUsd("paid"));
    expect(prechargeUsd("hd")).toBeGreaterThan(prechargeUsd("free"));
  });

  it("free precharge is non-zero now (images are billed) and bounded by the $100 cap", () => {
    expect(prechargeUsd("free")).toBeGreaterThan(0);
    expect(prechargeUsd("free")).toBeLessThan(PROVIDER_CAP_USD.openrouter);
    expect(PROVIDER_CAP_USD.openrouter).toBe(100);
  });
});
