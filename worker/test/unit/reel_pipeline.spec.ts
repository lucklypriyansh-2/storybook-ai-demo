import { describe, expect, it } from "vitest";
import { reelGenerateJob } from "../../src/jobs/reel_generate";
import { motionI2VJob } from "../../src/jobs/motion_i2v";
import { currentSpend } from "../../src/budget/ledger";
import { SHOT_COUNT } from "../../src/config/costs";
import type { Env, JobMessage } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

function mockEnv(db: FakeD1, r2: FakeR2): { env: Env; sent: JobMessage[] } {
  const sent: JobMessage[] = [];
  const env = {
    DB: asD1(db),
    R2: asR2(r2),
    JOBS: { send: async (m: JobMessage) => { sent.push(m); } },
    AI: {},
    WORKER_SESSION_SECRET: "test",
    MOCK_PROVIDERS: "1",
    ENABLE_OPENROUTER: "0",
    ENABLE_FAL: "0",
  } as unknown as Env;
  return { env, sent };
}

function seedReel(db: FakeD1, r2: FakeR2, tier: string): Promise<void> {
  db.reels.set("reel_1", { id: "reel_1", user_id: "user_1", kid_id: "kid_1", status: "queued", tier, story: "Mira and the moon", created_at: 1 });
  db.jobs.set("job_1", { id: "job_1", reel_id: "reel_1", kid_id: "kid_1", type: "reel_generate", status: "running", progress: 0, error: null, photo_id: null, consent_id: null, payload: null });
  return Promise.resolve();
}

describe("reel_generate under mocked providers", () => {
  it("writes 6 keyframes + a shots manifest, marks the reel done, and charges $0", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seedReel(db, r2, "free");
    const { env, sent } = mockEnv(db, r2);

    await reelGenerateJob(env, "job_1");

    expect(db.getJob("job_1")?.status).toBe("done");
    expect(db.reels.get("reel_1")?.status).toBe("done");
    expect(r2.keys().filter((k) => k.match(/^reels\/reel_1\/shot-\d+\.png$/))).toHaveLength(SHOT_COUNT);
    expect(r2.keys()).toContain("reels/reel_1/shots.json");
    expect(await currentSpend(asD1(db), "openrouter")).toBe(0);
    expect(db.ledger.size).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("hd enqueues one motion_i2v job per shot, still at $0 under mocks", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seedReel(db, r2, "hd");
    const { env, sent } = mockEnv(db, r2);

    await reelGenerateJob(env, "job_1");

    expect(sent).toHaveLength(SHOT_COUNT);
    const motionJobs = [...db.jobs.values()].filter((j) => j.type === "motion_i2v");
    expect(motionJobs).toHaveLength(SHOT_COUNT);
    expect(await currentSpend(asD1(db), "fal")).toBe(0);
  });
});

describe("motion_i2v under mocked providers", () => {
  it("writes the mp4 and records it on the shots manifest", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seedReel(db, r2, "hd");
    const { env } = mockEnv(db, r2);
    await reelGenerateJob(env, "job_1");

    const motion = [...db.jobs.values()].find((j) => j.type === "motion_i2v")!;
    await motionI2VJob(env, motion.id);

    expect(db.getJob(motion.id)?.status).toBe("done");
    const manifest = (await (await r2.get("reels/reel_1/shots.json"))!.json()) as { video_key: string | null }[];
    expect(manifest.filter((s) => s.video_key).length).toBe(1);
    expect(await currentSpend(asD1(db), "fal")).toBe(0);
  });

  it("refuses a payload whose keyframe key is not sheets/ or reels/", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    db.reels.set("reel_1", { id: "reel_1", user_id: "user_1", kid_id: "kid_1", status: "done", tier: "hd", story: "s", created_at: 1 });
    db.jobs.set("m1", {
      id: "m1", reel_id: "reel_1", kid_id: null, type: "motion_i2v", status: "running", progress: 0,
      error: null, photo_id: null, consent_id: null, payload: JSON.stringify({ shot: 1, keyframe_key: "tmp/evil" }),
    });
    const { env } = mockEnv(db, r2);

    await expect(motionI2VJob(env, "m1")).rejects.toThrow(/unsafe_video_input_key/);
  });
});
