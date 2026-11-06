import { describe, expect, it } from "vitest";
import {
  compensateSpend,
  currentSpend,
  guardSpend,
  reconcileSpend,
} from "../../src/budget/ledger";
import { BudgetExceeded, KillSwitchOn } from "../../src/util/errors";
import { asD1, FakeD1 } from "./fake-d1";

const base = {
  provider: "openrouter" as const,
  model: "google/gemini-2.5-flash-image",
  step: "character_sheet",
};

function envFor(db: FakeD1, killSwitch?: string) {
  return { DB: asD1(db), ...(killSwitch ? { KILL_SWITCH: killSwitch } : {}) };
}

describe("budget ledger", () => {
  it("pre-charges under the cap and exposes the spent total", async () => {
    const db = new FakeD1();
    const id = await guardSpend({ env: envFor(db), ...base, estUsd: 0.039 });
    expect(id).toBeTruthy();
    expect(await currentSpend(asD1(db), "openrouter")).toBeCloseTo(0.039, 6);
    expect(db.ledger.get(id)?.est_usd).toBeCloseTo(0.039, 6);
  });

  it("throws BudgetExceeded when the pre-charge would cross $100", async () => {
    const db = new FakeD1();
    db.budget.set("openrouter", { total_usd: 99.99, updated_at: 0 });
    await expect(
      guardSpend({ env: envFor(db), ...base, estUsd: 0.039 }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
    expect(await currentSpend(asD1(db), "openrouter")).toBeCloseTo(99.99, 6);
    expect(db.ledger.size).toBe(0);
  });

  it("allows a charge that lands exactly on the $100 cap", async () => {
    const db = new FakeD1();
    db.budget.set("openrouter", { total_usd: 99.96, updated_at: 0 });
    await expect(
      guardSpend({ env: envFor(db), ...base, estUsd: 0.039 }),
    ).resolves.toBeTruthy();
  });

  it("reconciles the budget total to the provider's actual charge", async () => {
    const db = new FakeD1();
    const id = await guardSpend({ env: envFor(db), ...base, estUsd: 0.039 });
    await reconcileSpend(asD1(db), id, 0.05, "req_1");
    expect(await currentSpend(asD1(db), "openrouter")).toBeCloseTo(0.05, 6);
    expect(db.ledger.get(id)?.actual_usd).toBeCloseTo(0.05, 6);
    expect(db.ledger.get(id)?.request_id).toBe("req_1");
  });

  it("compensates the pre-charge on provider error", async () => {
    const db = new FakeD1();
    const id = await guardSpend({ env: envFor(db), ...base, estUsd: 0.039 });
    await compensateSpend(asD1(db), id);
    expect(await currentSpend(asD1(db), "openrouter")).toBe(0);
    expect(db.ledger.has(id)).toBe(false);
  });

  it("refuses when the D1 kill switch is enabled", async () => {
    const db = new FakeD1();
    db.kill.enabled = 1;
    await expect(
      guardSpend({ env: envFor(db), ...base, estUsd: 0.039 }),
    ).rejects.toBeInstanceOf(KillSwitchOn);
  });
});
