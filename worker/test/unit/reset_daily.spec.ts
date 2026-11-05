import { describe, expect, it } from "vitest";
import { resetDaily } from "../../src/scheduled/reset_daily";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";

const NOW = Date.UTC(2026, 10, 5, 14, 0, 0); // 2026-11-05T14:00Z → day 20261105, hour 2026110514
const envFor = (db: FakeD1) => ({ DB: asD1(db) } as unknown as Env);

describe("resetDaily bucket pruning", () => {
  it("drops yesterday's buckets but keeps today's daily bucket", async () => {
    const db = new FakeD1();
    db.buckets.set("reels:user_1:20261104", { tokens: 3, updated_at: 0 });
    db.buckets.set("reels:user_1:20261105", { tokens: 7, updated_at: 0 });

    await resetDaily(envFor(db), NOW);

    expect(db.buckets.has("reels:user_1:20261104")).toBe(false);
    expect(db.buckets.has("reels:user_1:20261105")).toBe(true);
  });

  it("keeps the current hourly invite bucket so the limiter survives the sweep (H-5)", async () => {
    const db = new FakeD1();
    db.buckets.set("invite:1.2.3.4:2026110514", { tokens: 5, updated_at: 0 }); // current hour
    db.buckets.set("invite:1.2.3.4:2026110513", { tokens: 5, updated_at: 0 }); // previous hour

    await resetDaily(envFor(db), NOW);

    expect(db.buckets.has("invite:1.2.3.4:2026110514")).toBe(true);
    expect(db.buckets.has("invite:1.2.3.4:2026110513")).toBe(false);
  });
});
