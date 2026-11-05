import { describe, expect, it, vi } from "vitest";
import { reelGenerateJob } from "../../src/jobs/reel_generate";
import { currentSpend } from "../../src/budget/ledger";
import type { Env, JobMessage } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

/**
 * Paid reel path: ENABLE_OPENROUTER=1 + a key + MOCK_PROVIDERS=0 makes the
 * openrouter adapter live. A fetch that fails on the 3rd call exercises the
 * mid-reel failure the pre-charge + cleanup must survive (H-11).
 */
function envFor(db: FakeD1, r2: FakeR2, failsAfter: number): Env {
  let calls = 0;
  const env = {
    DB: asD1(db),
    R2: asR2(r2),
    JOBS: { send: async (_m: JobMessage) => {} },
    AI: {},
    WORKER_SESSION_SECRET: "test",
    MOCK_PROVIDERS: "0",
    ENABLE_OPENROUTER: "1",
    ENABLE_WORKERS_AI: "0",
    OPENROUTER_API_KEY: "test-key",
    ALLOWED_ORIGIN: "https://x",
    PUBLIC_API_BASE: "https://api.example.dev",
  } as unknown as Env;

  // Override global fetch with a counter that succeeds then fails.
  vi.stubGlobal("fetch", async () => {
    calls++;
    if (calls > failsAfter) return new Response("boom", { status: 500 });
    return new Response(
      JSON.stringify({
        id: `req_${calls}`,
        choices: [{ message: { content: JSON.stringify({ shots: [] }), images: [{ image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }] } }],
      }),
      { status: 200 },
    );
  });
  return env;
}

describe("paid reel failure cleanup (H-11)", () => {
  it("leaves no R2 objects and no residual spend when a keyframe fails mid-reel", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    db.reels.set("reel_1", { id: "reel_1", user_id: "user_1", kid_id: "kid_1", status: "queued", tier: "paid", story: "Mira", created_at: 1 });
    db.jobs.set("job_1", { id: "job_1", reel_id: "reel_1", kid_id: "kid_1", type: "reel_generate", status: "running", progress: 0, error: null, photo_id: null, consent_id: null, payload: null });

    // call 1 = shot list (ok), calls 2-3 = first two keyframes (ok), call 4 = fails.
    const env = envFor(db, r2, 3);

    await expect(reelGenerateJob(env, "job_1")).rejects.toThrow(/openrouter_http_500/);
    vi.unstubAllGlobals();

    expect(r2.keys().filter((k) => k.startsWith("reels/reel_1/"))).toEqual([]);
    expect(await currentSpend(asD1(db), "openrouter")).toBe(0);
    expect(db.ledger.size).toBe(0);
  });
});
