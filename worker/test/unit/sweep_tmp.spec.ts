import { describe, expect, it } from "vitest";
import { sweepAll, sweepPhotos, sweepTmp } from "../../src/scheduled/sweep_tmp";
import { PHOTOS_MAX_AGE_MS, TMP_MAX_AGE_MS } from "../../src/config/limits";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function envWith(db: FakeD1, r2: FakeR2): Env {
  return { DB: asD1(db), R2: asR2(r2) } as unknown as Env;
}

/** A photo uploaded `ageMs` ago, with its blob present under tmp/. */
async function seedPhoto(
  db: FakeD1,
  r2: FakeR2,
  id: string,
  ageMs: number,
  key = `tmp/${id}`,
): Promise<string> {
  const createdAt = NOW - ageMs;
  db.photos.set(id, { id, user_id: "u1", r2_key: key, created_at: createdAt, deleted_at: null });
  await r2.put(key, new Uint8Array([1]), { customMetadata: { uploaded_at: String(createdAt) } });
  return key;
}

describe("sweepPhotos (24h retention)", () => {
  it("soft-deletes a photo older than 24h and removes its R2 object", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seedPhoto(db, r2, "old", PHOTOS_MAX_AGE_MS + 1000);

    expect(await sweepPhotos(envWith(db, r2), NOW)).toBe(1);
    expect(db.photos.get("old")?.deleted_at).toBe(NOW);
    expect(r2.keys()).toEqual([]);
  });

  it("keeps a photo younger than 24h, untouched and still live", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seedPhoto(db, r2, "young", PHOTOS_MAX_AGE_MS - 1000);

    expect(await sweepPhotos(envWith(db, r2), NOW)).toBe(0);
    expect(db.photos.get("young")?.deleted_at).toBeNull();
    expect(r2.keys()).toEqual(["tmp/young"]);
  });

  it("is idempotent: a second pass over the same window deletes nothing", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seedPhoto(db, r2, "old", PHOTOS_MAX_AGE_MS + 1000);
    await seedPhoto(db, r2, "young", 1000);

    expect(await sweepPhotos(envWith(db, r2), NOW)).toBe(1);
    expect(await sweepPhotos(envWith(db, r2), NOW)).toBe(0);
    expect(r2.keys()).toEqual(["tmp/young"]);
  });

  it("sweeps a photo uploaded and never used by any job", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    // No jobs row at all: the promise holds for an abandoned upload too.
    await seedPhoto(db, r2, "abandoned", 2 * DAY);
    expect(db.jobs.size).toBe(0);

    expect(await sweepPhotos(envWith(db, r2), NOW)).toBe(1);
    expect(r2.keys()).toEqual([]);
  });
});

describe("sweepAll", () => {
  it("runs the 24h photo pass then collects the tmp orphans it just freed", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seedPhoto(db, r2, "expired", PHOTOS_MAX_AGE_MS + 1);

    // One call removes the blob: pass 1 by the row cutoff, so pass 2 finds nothing
    // left to do. Total counts R2 objects, not passes.
    expect(await sweepAll(envWith(db, r2), NOW)).toBe(1);
    expect(r2.keys()).toEqual([]);
    expect(db.photos.get("expired")?.deleted_at).toBe(NOW);
  });

  it("reports the sum of both passes", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seedPhoto(db, r2, "expired", PHOTOS_MAX_AGE_MS + 1);
    // An orphan with a soft-deleted row, past the 60s tmp window: pass 2's job.
    await r2.put("tmp/orphan", new Uint8Array([2]), {
      customMetadata: { uploaded_at: String(NOW - TMP_MAX_AGE_MS - 1) },
    });
    db.photos.set("gone", { id: "gone", user_id: "u1", r2_key: "tmp/orphan", created_at: NOW, deleted_at: NOW - 5000 });

    expect(await sweepAll(envWith(db, r2), NOW)).toBe(2);
    expect(r2.keys()).toEqual([]);
  });
});

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
