import { describe, expect, it } from "vitest";
import { guardSpend } from "../../src/budget/ledger";
import { isKilled } from "../../src/budget/kill_switch";
import { motionI2VJob } from "../../src/jobs/motion_i2v";
import { KillSwitchOn } from "../../src/util/errors";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

function envFor(db: FakeD1, r2: FakeR2, killSwitch: string): Env {
  return {
    DB: asD1(db),
    R2: asR2(r2),
    JOBS: {},
    AI: {},
    WORKER_SESSION_SECRET: "test",
    KILL_SWITCH: killSwitch,
    MOCK_PROVIDERS: "1",
  } as unknown as Env;
}

describe("env KILL_SWITCH wins over the D1 row (H-3)", () => {
  it("isKilled is true from the env flag even when D1 says off", async () => {
    const db = new FakeD1();
    db.kill.enabled = 0;
    await expect(isKilled(envFor(db, new FakeR2(), "1"))).resolves.toBe(true);
  });

  it("guardSpend throws KillSwitchOn from the env flag with a clean D1 row", async () => {
    const db = new FakeD1();
    db.kill.enabled = 0;
    await expect(
      guardSpend({
        env: envFor(db, new FakeR2(), "1"),
        provider: "fal",
        estUsd: 0.025,
        model: "fal-ai/wan-2.1/image-to-video",
        step: "motion_i2v",
      }),
    ).rejects.toBeInstanceOf(KillSwitchOn);
    expect(db.ledger.size).toBe(0);
  });

  it("motion_i2v refuses before any work when the env kill switch is on", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    db.reels.set("reel_1", { id: "reel_1", user_id: "user_1", kid_id: "kid_1", status: "done", tier: "hd", story: "s", created_at: 1 });
    db.jobs.set("m1", {
      id: "m1", reel_id: "reel_1", kid_id: null, type: "motion_i2v", status: "running", progress: 0,
      error: null, photo_id: null, consent_id: null, payload: JSON.stringify({ shot: 1, keyframe_key: "reels/reel_1/shot-1.png" }),
    });

    await expect(motionI2VJob(envFor(db, r2, "1"), "m1")).rejects.toBeInstanceOf(KillSwitchOn);
    expect(r2.keys()).toEqual([]);
  });
});
