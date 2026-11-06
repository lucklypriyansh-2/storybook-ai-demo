import { describe, expect, it } from "vitest";
import { create } from "../../src/routes/reels";
import { SESSION_COOKIE, signSessionId } from "../../src/auth/session";
import { sha256Hex } from "../../src/util/hash";
import type { Ctx } from "../../src/router";
import type { Env, JobMessage } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const SECRET = "test-secret-not-real";
const USER = "user_1";
const KID = "kid_1";

async function ctxFor(db: FakeD1, r2: FakeR2, body: unknown): Promise<Ctx> {
  const env = {
    DB: asD1(db), R2: asR2(r2), JOBS: { send: async (_m: JobMessage) => {} },
    WORKER_SESSION_SECRET: SECRET, MOCK_PROVIDERS: "1", ENABLE_FAL: "0", ENABLE_OPENROUTER: "0",
  } as unknown as Env;
  const sig = await signSessionId(SECRET, "sess_1");
  return {
    env,
    req: new Request("https://x/api/reels", {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE}=sess_1.${sig}` },
      body: JSON.stringify(body),
    }),
    params: {},
  };
}

async function seed(db: FakeD1, enabled = 1): Promise<void> {
  db.users.set(USER, { id: USER, is_admin: 0 });
  const sessionKey = await sha256Hex("sess_1");
  db.sessions.set(sessionKey, { id: sessionKey, user_id: USER, expires_at: Date.now() + 1e9 });
  db.kids.set(KID, { id: KID, user_id: USER, display_name: "Mira", deleted_at: null });
  db.templates.set("tpl_a", {
    id: "tpl_a", slug: "tpl-a", title: "{name} and the Lighthouse Mouse", cover_key: null, description: null,
    age_band: "3-5", tier_default: "free", page_count: 6, enabled, created_at: 1, updated_at: 1,
  });
}

describe("POST /api/reels from the catalog", () => {
  it("accepts template_id and records template_id, with use_sheet=0 (no sheet exists)", async () => {
    const db = new FakeD1();
    await seed(db);
    const res = await create(await ctxFor(db, new FakeR2(), { kid_id: KID, template_id: "tpl_a", tier: "free", use_sheet: false }));
    const body = (await res.json()) as { reel_id: string; job_id: string };
    expect(res.status).toBe(200);
    const reel = db.reels.get(body.reel_id)!;
    expect(reel.template_id).toBe("tpl_a");
    expect(reel.use_sheet).toBe(0);
    // Story text falls back to the template title (PLACEHOLDER sample).
    expect(reel.story).toBe("{name} and the Lighthouse Mouse");
  });

  it("records use_sheet=1 when the kid has a character sheet and a sheet is requested", async () => {
    const db = new FakeD1();
    await seed(db);
    db.characters.set("char_1", { id: "char_1", kid_id: KID, sheet_r2_key: "sheets/kid_1/c1.png", model: "m", created_at: 1 });
    const res = await create(await ctxFor(db, new FakeR2(), { kid_id: KID, template_id: "tpl_a", tier: "free" }));
    const body = (await res.json()) as { reel_id: string };
    expect(db.reels.get(body.reel_id)!.use_sheet).toBe(1);
  });

  it("defaults use_sheet to 0 when omitted and the kid has no sheet", async () => {
    const db = new FakeD1();
    await seed(db);
    const res = await create(await ctxFor(db, new FakeR2(), { kid_id: KID, template_id: "tpl_a", tier: "free" }));
    const body = (await res.json()) as { reel_id: string };
    expect(db.reels.get(body.reel_id)!.use_sheet).toBe(0);
  });

  it("fails fast with sheet_required when use_sheet=true but the kid has none", async () => {
    const db = new FakeD1();
    await seed(db);
    await expect(create(await ctxFor(db, new FakeR2(), { kid_id: KID, template_id: "tpl_a", tier: "free", use_sheet: true })))
      .rejects.toMatchObject({ status: 400, code: "sheet_required" });
    // Nothing is written on the honest failure.
    expect(db.reels.size).toBe(0);
  });

  it("404s a disabled or unknown template", async () => {
    const db = new FakeD1();
    await seed(db, 0);
    await expect(create(await ctxFor(db, new FakeR2(), { kid_id: KID, template_id: "tpl_a", tier: "free" })))
      .rejects.toMatchObject({ status: 404, code: "template_not_found" });
    await expect(create(await ctxFor(db, new FakeR2(), { kid_id: KID, template_id: "nope", tier: "free" })))
      .rejects.toMatchObject({ status: 404, code: "template_not_found" });
  });

  it("still accepts the legacy free-text story path", async () => {
    const db = new FakeD1();
    await seed(db);
    const res = await create(await ctxFor(db, new FakeR2(), { kid_id: KID, story: "A moon trip", tier: "free" }));
    const body = (await res.json()) as { reel_id: string };
    expect(db.reels.get(body.reel_id)!.story).toBe("A moon trip");
    expect(db.reels.get(body.reel_id)!.template_id).toBeNull();
  });
});
