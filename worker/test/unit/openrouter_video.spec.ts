import { describe, expect, it, vi } from "vitest";
import {
  assertSafeVideoInput,
  buildVideoBody,
  makeOpenRouterVideo,
} from "../../src/providers/openrouter_video";
import { makeProviders, pickProvider } from "../../src/providers";
import { motionI2VJob } from "../../src/jobs/motion_i2v";
import { currentSpend } from "../../src/budget/ledger";
import { PROVIDER_CAP_USD } from "../../src/config/limits";
import { SHOT_SECONDS } from "../../src/config/costs";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const sign = async (key: string) => `https://api.example.dev/api/media/${key}?exp=1&sig=x`;

function envFrom(overrides: Partial<Env> = {}): Env {
  return {
    DB: asD1(new FakeD1()),
    R2: asR2(new FakeR2()),
    JOBS: {},
    AI: {},
    WORKER_SESSION_SECRET: "test",
    KILL_SWITCH: "0",
    ...overrides,
  } as unknown as Env;
}

/** Three-legged fetch: submit → poll(completed) → content bytes. */
function happyFetch(bytes = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112])) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ id: "vid_123", status: "queued" }), { status: 200 });
    }
    if (url.endsWith("/content")) return new Response(bytes, { status: 200 });
    return new Response(JSON.stringify({ id: "vid_123", status: "completed" }), { status: 200 });
  });
}

describe("OpenRouter video adapter (§H)", () => {
  it("posts frame_images first_frame with the pinned model, 3s, 9:16 and no audio", () => {
    const body = buildVideoBody("google/gemini-omni-1.2-flash", "https://x/api/media/reels/r/shot-1.png", {
      imageKey: "reels/r/shot-1.png",
      seconds: 3,
    });
    expect(body.model).toBe("google/gemini-omni-1.2-flash");
    expect(body.duration).toBe(3);
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.generate_audio).toBe(false);
    expect(body.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://x/api/media/reels/r/shot-1.png" },
        frame_type: "first_frame",
      },
    ]);
    // No fallbacks: a silent model swap could bill a different price (§5).
    expect(body.provider).toMatchObject({ allow_fallbacks: false, data_collection: "deny" });
  });

  it("submits, polls to completed and downloads the content endpoint", async () => {
    const fetchImpl = happyFetch();
    const adapter = makeOpenRouterVideo("test-key", sign, fetchImpl, { pollIntervalMs: 0 });

    const out = await adapter.i2v({ imageKey: "reels/r1/shot-1.png", seconds: SHOT_SECONDS });

    expect(out.value.bytes.byteLength).toBeGreaterThan(0);
    expect(out.value.seconds).toBe(SHOT_SECONDS);
    expect(out.requestId).toBe("vid_123");
    // Est. $0.025/s × 3s = $0.075 per clip (listed 360p SKU is ~$0.023–0.025/s).
    expect(out.actualUsd).toBeCloseTo(0.075, 6);
    expect(adapter.id).toBe("openrouter-gemini-omni-1.2-flash-i2v");

    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe("https://openrouter.ai/api/v1/videos");
    expect(urls.some((u) => u.endsWith("/vid_123"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/vid_123/content"))).toBe(true);
  });

  it("refuses a non sheet/reel key before any network call", async () => {
    const fetchImpl = vi.fn();
    const adapter = makeOpenRouterVideo("test-key", sign, fetchImpl);
    await expect(adapter.i2v({ imageKey: "tmp/evil", seconds: 4 })).rejects.toThrow(
      /unsafe_video_input_key/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts sheets/ and reels/ keys", () => {
    expect(() => assertSafeVideoInput("sheets/kid/sheet.png")).not.toThrow();
    expect(() => assertSafeVideoInput("reels/r1/shot-0.png")).not.toThrow();
  });

  it("fails honestly when the job reports failed — no fabricated bytes", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: "vid_bad" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "vid_bad", status: "failed", error: "nsfw filter" }), {
        status: 200,
      });
    });
    const adapter = makeOpenRouterVideo("test-key", sign, fetchImpl, { pollIntervalMs: 0 });
    await expect(adapter.i2v({ imageKey: "reels/r1/shot-1.png", seconds: 4 })).rejects.toThrow(
      /openrouter_video_failed/,
    );
  });

  it("fails honestly on a submit HTTP error, without polling", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 402 }));
    const adapter = makeOpenRouterVideo("test-key", sign, fetchImpl);
    await expect(adapter.i2v({ imageKey: "reels/r1/shot-1.png", seconds: 4 })).rejects.toThrow(
      /openrouter_video_submit_http_402/,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("times out rather than hanging forever on a stuck render", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ id: "vid_slow" }), { status: 200 });
      return new Response(JSON.stringify({ id: "vid_slow", status: "processing" }), { status: 200 });
    });
    const adapter = makeOpenRouterVideo("test-key", sign, fetchImpl, { pollIntervalMs: 0, timeoutMs: 1 });
    await expect(adapter.i2v({ imageKey: "reels/r1/shot-1.png", seconds: 4 })).rejects.toThrow(
      /openrouter_video_timeout/,
    );
  });

  it("fails honestly when the content endpoint yields nothing and there is no URL", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ id: "vid_empty" }), { status: 200 });
      if (url.endsWith("/content")) return new Response("", { status: 404 });
      return new Response(JSON.stringify({ id: "vid_empty", status: "completed" }), { status: 200 });
    });
    const adapter = makeOpenRouterVideo("test-key", sign, fetchImpl, { pollIntervalMs: 0 });
    await expect(adapter.i2v({ imageKey: "reels/r1/shot-1.png", seconds: 4 })).rejects.toThrow(
      /openrouter_video_content_http_404/,
    );
  });

  it("falls back to an unsigned_urls entry only when the content route fails", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ id: "vid_alt" }), { status: 200 });
      if (url.endsWith("/content")) return new Response("gone", { status: 404 });
      if (url === "https://cdn.example.dev/vid_alt.mp4") return new Response(bytes, { status: 200 });
      return new Response(
        JSON.stringify({ id: "vid_alt", status: "completed", unsigned_urls: ["https://cdn.example.dev/vid_alt.mp4"] }),
        { status: 200 },
      );
    });
    const adapter = makeOpenRouterVideo("test-key", sign, fetchImpl, { pollIntervalMs: 0 });
    const out = await adapter.i2v({ imageKey: "reels/r1/shot-1.png", seconds: 3 });
    expect([...out.value.bytes]).toEqual([...bytes]);
  });
});

describe("motion provider selection follows OpenRouter, never fal (§H)", () => {
  it("builds an OpenRouter video adapter when openrouter + key are set", () => {
    const providers = makeProviders(
      envFrom({ ENABLE_OPENROUTER: "1", OPENROUTER_API_KEY: "k", ENABLE_FAL: "0" }),
    );
    expect(providers.video.id).toBe("openrouter-gemini-omni-1.2-flash-i2v");
  });

  it("keeps the mock when MOCK_PROVIDERS=1 even with a real key", () => {
    const providers = makeProviders(
      envFrom({ MOCK_PROVIDERS: "1", ENABLE_OPENROUTER: "1", OPENROUTER_API_KEY: "k" }),
    );
    expect(providers.mocked).toBe(true);
    expect(providers.video.id).toBe("mock-video");
  });

  it("pickProvider(motion_i2v) returns the mock under MOCK_PROVIDERS and never throws fal", () => {
    const video = pickProvider(envFrom({ MOCK_PROVIDERS: "1" }), "motion_i2v", "hd");
    expect(video.id).toBe("mock-video");
  });

  it("throws provider_disabled (openrouter) — not fal — when openrouter is off for a paid HD step", () => {
    expect(() =>
      pickProvider(envFrom({ MOCK_PROVIDERS: "0", ENABLE_OPENROUTER: "0" }), "motion_i2v", "hd"),
    ).toThrowError(/provider_disabled/);
    try {
      pickProvider(envFrom({ MOCK_PROVIDERS: "0", ENABLE_OPENROUTER: "0" }), "motion_i2v", "hd");
    } catch (err) {
      expect((err as { details?: { provider?: string } }).details?.provider).toBe("openrouter");
      expect(JSON.stringify(err)).not.toMatch(/fal/);
    }
  });

  it("a paid HD step with the flag on but no key fails instead of silently mocking", () => {
    expect(() =>
      pickProvider(envFrom({ MOCK_PROVIDERS: "0", ENABLE_OPENROUTER: "1" }), "motion_i2v", "hd"),
    ).toThrowError(/provider_disabled/);
  });
});

describe("motion_i2v charging (§H: openrouter ledger, not fal)", () => {
  function seedMotion(db: FakeD1): void {
    db.reels.set("reel_1", {
      id: "reel_1", user_id: "user_1", kid_id: "kid_1", status: "done", tier: "hd", story: "s", created_at: 1,
    });
    db.jobs.set("m1", {
      id: "m1", reel_id: "reel_1", kid_id: null, type: "motion_i2v", status: "running", progress: 0,
      error: null, photo_id: null, consent_id: null,
      payload: JSON.stringify({ shot: 1, keyframe_key: "reels/reel_1/shot-1.png" }),
    });
  }

  it("charges the openrouter ledger and writes the mp4 (mocked, $0)", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    seedMotion(db);
    const env = envFrom({ DB: asD1(db), R2: asR2(r2), MOCK_PROVIDERS: "1", ENABLE_OPENROUTER: "0" });

    await motionI2VJob(env, "m1");

    expect(db.getJob("m1")?.status).toBe("done");
    expect(r2.keys()).toContain("reels/reel_1/shot-1.mp4");
    // Mocks spend nothing on either provider.
    expect(await currentSpend(asD1(db), "openrouter")).toBe(0);
    expect(await currentSpend(asD1(db), "fal")).toBe(0);
  });

  it("leaves video_url null and compensates the ledger when the render fails", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    seedMotion(db);
    // Real (non-mock) path with a key, so a pre-charge is written first. The
    // global fetch is stubbed to fail immediately: no live/paid call, but the
    // job still exercises the real HTTP error branch.
    const failing = vi.fn(async () => new Response("upstream down", { status: 502 }));
    vi.stubGlobal("fetch", failing);
    try {
      const env = envFrom({
        DB: asD1(db),
        R2: asR2(r2),
        MOCK_PROVIDERS: "0",
        ENABLE_OPENROUTER: "1",
        OPENROUTER_API_KEY: "not-a-real-key",
      });

      await expect(motionI2VJob(env, "m1")).rejects.toThrow(/openrouter_video_submit_http_502/);
      expect(failing).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }

    // No mp4, no residual spend, and the pre-charge is fully compensated.
    expect(r2.keys()).not.toContain("reels/reel_1/shot-1.mp4");
    expect(await currentSpend(asD1(db), "openrouter")).toBe(0);
    expect(db.ledger.size).toBe(0);
  });

  it("never charges fal for motion", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    seedMotion(db);
    const env = envFrom({ DB: asD1(db), R2: asR2(r2), MOCK_PROVIDERS: "1" });
    await motionI2VJob(env, "m1");
    expect(await currentSpend(asD1(db), "fal")).toBe(0);
  });
});

describe("caps", () => {
  it("keeps a $10 cap for openrouter (motion + images share it)", () => {
    expect(PROVIDER_CAP_USD.openrouter).toBe(10.0);
  });
});
