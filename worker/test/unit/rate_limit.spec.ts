import { describe, expect, it } from "vitest";
import { consumeCharacter, consumeDaily, consumeReel } from "../../src/budget/rate_limit";
import { RateLimited } from "../../src/util/errors";
import { asD1, FakeD1 } from "./fake-d1";

const NOON = Date.UTC(2026, 10, 5, 12, 0, 0);

describe("daily rate limits", () => {
  it("allows exactly 5 character sheets per user per UTC day", async () => {
    const db = new FakeD1();
    for (let i = 0; i < 5; i++) {
      await expect(consumeCharacter(asD1(db), "user_1", NOON)).resolves.toBeGreaterThanOrEqual(0);
    }
    await expect(consumeCharacter(asD1(db), "user_1", NOON)).rejects.toBeInstanceOf(RateLimited);
  });

  it("allows exactly 10 reels per user per UTC day", async () => {
    const db = new FakeD1();
    for (let i = 0; i < 10; i++) await consumeReel(asD1(db), "user_1", NOON);
    await expect(consumeReel(asD1(db), "user_1", NOON)).rejects.toBeInstanceOf(RateLimited);
  });

  it("keeps users independent", async () => {
    const db = new FakeD1();
    for (let i = 0; i < 10; i++) await consumeReel(asD1(db), "user_1", NOON);
    await expect(consumeReel(asD1(db), "user_2", NOON)).resolves.toBe(9);
  });

  it("resets at the UTC day boundary", async () => {
    const db = new FakeD1();
    for (let i = 0; i < 5; i++) await consumeCharacter(asD1(db), "user_1", NOON);
    await expect(consumeCharacter(asD1(db), "user_1", NOON)).rejects.toBeInstanceOf(RateLimited);

    const tomorrow = NOON + 24 * 60 * 60 * 1000;
    await expect(consumeCharacter(asD1(db), "user_1", tomorrow)).resolves.toBe(4);
  });

  it("namespaces buckets by scope so chars and reels do not share a budget", async () => {
    const db = new FakeD1();
    for (let i = 0; i < 5; i++) await consumeDaily(asD1(db), "chars", "user_1", 5, NOON);
    await expect(consumeReel(asD1(db), "user_1", NOON)).resolves.toBe(9);
  });
});
