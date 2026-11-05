import { describe, expect, it } from "vitest";
import { consumeInvite, validateInvite } from "../../src/auth/invite";
import { Unauthorized } from "../../src/util/errors";
import { asD1, FakeD1 } from "./fake-d1";

describe("invite codes", () => {
  it("rejects an unknown code", async () => {
    const db = new FakeD1();
    await expect(validateInvite(asD1(db), "nope")).rejects.toBeInstanceOf(Unauthorized);
  });

  it("accepts a valid code with uses remaining", async () => {
    const db = new FakeD1();
    db.invites.set("FAMILY", { code: "FAMILY", max_uses: 2, used_count: 0, note: null });
    await expect(validateInvite(asD1(db), "FAMILY")).resolves.toMatchObject({ max_uses: 2 });
  });

  it("rejects an exhausted code", async () => {
    const db = new FakeD1();
    db.invites.set("FAMILY", { code: "FAMILY", max_uses: 1, used_count: 1, note: null });
    await expect(validateInvite(asD1(db), "FAMILY")).rejects.toBeInstanceOf(Unauthorized);
  });

  it("consumes one use per call and stops at max_uses", async () => {
    const db = new FakeD1();
    db.invites.set("FAMILY", { code: "FAMILY", max_uses: 2, used_count: 0, note: null });

    await expect(consumeInvite(asD1(db), "FAMILY")).resolves.toBe(true);
    await expect(consumeInvite(asD1(db), "FAMILY")).resolves.toBe(true);
    await expect(consumeInvite(asD1(db), "FAMILY")).resolves.toBe(false);
    expect(db.invites.get("FAMILY")?.used_count).toBe(2);
  });
});
