import { describe, expect, it } from "vitest";
import { characterSheetJob } from "../../src/jobs/character_sheet";
import { currentSpend } from "../../src/budget/ledger";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

// Bug guard: with MOCK_PROVIDERS=1 (or openrouter disabled) the character-sheet
// job must take the free path and leave budget_state.total_usd at 0.
function mockEnv(db: FakeD1, r2: FakeR2, overrides: Partial<Env> = {}): Env {
  return {
    DB: asD1(db),
    R2: asR2(r2),
    WORKER_SESSION_SECRET: "test",
    MOCK_PROVIDERS: "1",
    ENABLE_OPENROUTER: "1",
    AI: {},
    ...overrides,
  } as unknown as Env;
}

function seed(db: FakeD1, r2: FakeR2): Promise<void> {
  db.kids.set("kid_1", { id: "kid_1", user_id: "user_1", display_name: "Mira", deleted_at: null });
  db.photos.set("p1", { id: "p1", user_id: "user_1", r2_key: "tmp/p1", deleted_at: null });
  db.jobs.set("job_1", {
    id: "job_1", reel_id: null, kid_id: "kid_1", type: "character_sheet", status: "running",
    progress: 0, error: null, photo_id: "p1", consent_id: "con1", payload: null,
  });
  return r2.put("tmp/p1", new Uint8Array([1, 2, 3]));
}

describe("character sheet under mocked providers", () => {
  it("charges no budget when MOCK_PROVIDERS=1", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    await characterSheetJob(mockEnv(db, r2), "job_1");

    expect(await currentSpend(asD1(db), "openrouter")).toBe(0);
    expect(db.ledger.size).toBe(0);
    expect(db.getJob("job_1")?.status).toBe("done");
    expect(db.characters.size).toBe(1);
  });

  it("charges no budget when openrouter is disabled without mocks", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    await characterSheetJob(mockEnv(db, r2, { MOCK_PROVIDERS: "0", ENABLE_OPENROUTER: "0", ENABLE_WORKERS_AI: "0" }), "job_1");

    expect(await currentSpend(asD1(db), "openrouter")).toBe(0);
    expect(db.ledger.size).toBe(0);
    expect(db.getJob("job_1")?.status).toBe("done");
  });

  it("deletes the source photo even when the job fails", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    db.photos.set("p1", { id: "p1", user_id: "user_1", r2_key: "tmp/missing", deleted_at: null });

    await expect(characterSheetJob(mockEnv(db, r2), "job_1")).rejects.toThrow();
    expect(db.photos.get("p1")?.deleted_at).not.toBeNull();
  });
});
