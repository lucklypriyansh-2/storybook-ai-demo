import { describe, expect, it } from "vitest";
import { sweepTmp } from "../../src/scheduled/sweep_tmp";
import { TMP_MAX_AGE_MS } from "../../src/config/limits";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const NOW = 1_700_000_000_000;

function envWith(db: FakeD1, r2: FakeR2): Env {
  return { DB: asD1(db), R2: asR2(r2) } as unknown as Env;
}

describe("sweep_tmp", () => {
  it("deletes tmp objects older than 60s that have no live row", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await r2.put("tmp/old", new Uint8Array([1]), { customMetadata: { uploaded_at: String(NOW - TMP_MAX_AGE_MS - 1) } });
    await r2.put("tmp/young", new Uint8Array([2]), { customMetadata: { uploaded_at: String(NOW - 1000) } });

    expect(await sweepTmp(envWith(db, r2), NOW)).toBe(1);
    expect(r2.keys()).toEqual(["tmp/young"]);
  });

  it("leaves tmp objects that still have a live photos_tmp row", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await r2.put("tmp/claimed", new Uint8Array([1]), { customMetadata: { uploaded_at: String(NOW - TMP_MAX_AGE_MS - 1) } });
    db.photos.set("p1", { id: "p1", user_id: "u1", r2_key: "tmp/claimed", deleted_at: null });

    expect(await sweepTmp(envWith(db, r2), NOW)).toBe(0);
    expect(r2.keys()).toEqual(["tmp/claimed"]);
  });

  it("sweeps an orphan once its row is soft-deleted", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await r2.put("tmp/done", new Uint8Array([1]), { customMetadata: { uploaded_at: String(NOW - TMP_MAX_AGE_MS - 1) } });
    db.photos.set("p1", { id: "p1", user_id: "u1", r2_key: "tmp/done", deleted_at: NOW - 5000 });

    expect(await sweepTmp(envWith(db, r2), NOW)).toBe(1);
    expect(r2.keys()).toEqual([]);
  });

  it("ignores objects without uploaded_at metadata", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await r2.put("tmp/no-meta", new Uint8Array([1]));
    expect(await sweepTmp(envWith(db, r2), NOW)).toBe(0);
    expect(r2.keys()).toEqual(["tmp/no-meta"]);
  });
});
