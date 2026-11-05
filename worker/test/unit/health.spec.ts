import { describe, expect, it } from "vitest";
import { get } from "../../src/routes/health";
import { cachedFfmpeg, probeFfmpeg, resetFfmpegCache } from "../../src/config/ffmpeg";
import { SWEEP_INTERVAL_MS, TMP_MAX_AGE_MS } from "../../src/config/limits";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

function ctxFor(overrides: Partial<Env> = {}): Ctx {
  const db = new FakeD1();
  const env = { DB: asD1(db), R2: asR2(new FakeR2()), BUILD: "test", ...overrides } as unknown as Env;
  return { env, req: new Request("https://x/api/health"), params: {} };
}

describe("GET /api/health", () => {
  it("reports provider flags, ffmpeg and the sweep limits", async () => {
    resetFfmpegCache();
    const res = await get(ctxFor({ ENABLE_OPENROUTER: "1", ENABLE_FAL: "0" }));
    const body = (await res.json()) as {
      ok: boolean; build: string;
      flags: { openrouter: boolean; fal: boolean; kill: boolean; ffmpeg: boolean | null };
      sweep: { interval_ms: number; tmp_max_age_ms: number };
    };

    expect(body.ok).toBe(true);
    expect(body.build).toBe("test");
    expect(body.flags).toMatchObject({ openrouter: true, fal: false, kill: false });
    // Probe already resolved by the time the response is serialised.
    expect(typeof body.flags.ffmpeg).toBe("boolean");
    expect(body.sweep).toEqual({ interval_ms: SWEEP_INTERVAL_MS, tmp_max_age_ms: TMP_MAX_AGE_MS });
    // Honest: tmp age is 60s, never the old "24h" copy.
    expect(body.sweep.tmp_max_age_ms).toBe(60_000);
  });

  it("ffmpeg is null before the first probe and cached after it", async () => {
    resetFfmpegCache();
    expect(cachedFfmpeg()).toBeNull();
    const first = await probeFfmpeg();
    expect(typeof first.available).toBe("boolean");
    expect(cachedFfmpeg()).toBe(first.available);
    const second = await probeFfmpeg();
    expect(second).toEqual(first);
  });
});
