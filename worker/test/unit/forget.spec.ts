import { describe, expect, it } from "vitest";
import { forget } from "../../src/routes/kids";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
// requireSession resolves from the cookie + WORKER_SESSION_SECRET. Signing a real
// cookie keeps the test honest about the auth path rather than stubbing it.
import { signSessionId, SESSION_COOKIE } from "../../src/auth/session";
import { sha256Hex } from "../../src/util/hash";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const SECRET = "test-secret-not-real";
const USER = "user_1";
const KID = "kid_1";

async function ctxFor(db: FakeD1, r2: FakeR2, kidId: string): Promise<Ctx> {
  const env = { DB: asD1(db), R2: asR2(r2), WORKER_SESSION_SECRET: SECRET } as unknown as Env;
  const sig = await signSessionId(SECRET, "sess_1");
  const req = new Request(`https://x/api/kids/${kidId}/forget`, {
    method: "POST",
    headers: { Cookie: `${SESSION_COOKIE}=sess_1.${sig}` },
  });
  return { env, req, params: { id: kidId } };
}

async function seed(db: FakeD1, r2: FakeR2): Promise<void> {
  db.users.set(USER, { id: USER, is_admin: 0 });
  // Sessions are stored under sha256(cookie id), not the raw id (H-2).
  const sessionKey = await sha256Hex("sess_1");
  db.sessions.set(sessionKey, { id: sessionKey, user_id: USER, expires_at: Date.now() + 1e9 });
  db.kids.set(KID, { id: KID, user_id: USER, display_name: "Mira", deleted_at: null });
  db.characters.set("c1", { id: "c1", kid_id: KID, sheet_r2_key: `sheets/${KID}/s.png`, model: "m", created_at: 1 });
  db.reels.set("r1", { id: "r1", user_id: USER, kid_id: KID, status: "done", tier: "free", story: "s", created_at: 1 });
  db.consents.set("con1", { id: "con1", user_id: USER, kid_id: KID });
  await r2.put(`sheets/${KID}/s.png`, new Uint8Array([1]));
  await r2.put("reels/r1/shot-1.png", new Uint8Array([2]));
  await r2.put("tmp/keep", new Uint8Array([3]));
}

describe("POST /api/kids/:id/forget", () => {
  it("removes R2 sheets + reel objects and the kid's rows", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    const res = await forget(await ctxFor(db, r2, KID));
    const body = (await res.json()) as { ok: boolean; deleted: { r2: number; rows: number } };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted.r2).toBe(2);
    expect(db.characters.size).toBe(0);
    expect(db.consents.size).toBe(0);
    expect(db.kids.get(KID)?.deleted_at).not.toBeNull();
    // Unrelated tmp/ objects are untouched.
    expect(r2.keys()).toEqual(["tmp/keep"]);
  });

  it("is idempotent on a second call", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    await forget(await ctxFor(db, r2, KID));
    const res2 = await forget(await ctxFor(db, r2, KID));
    const body2 = (await res2.json()) as { ok: boolean; deleted: { rows: number } };
    expect(res2.status).toBe(200);
    expect(body2.deleted.rows).toBe(0);
  });

  it("404s for a kid owned by someone else", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    db.kids.set("other", { id: "other", user_id: "someone_else", display_name: "X", deleted_at: null });

    await expect(forget(await ctxFor(db, r2, "other"))).rejects.toMatchObject({ status: 404 });
  });
});
