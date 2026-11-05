import { describe, expect, it } from "vitest";
import { deletePage, get, patchPage } from "../../src/routes/reels";
import { characterSheetRead } from "../../src/routes/kids";
import { SESSION_COOKIE, signSessionId } from "../../src/auth/session";
import { sha256Hex } from "../../src/util/hash";
import { MAX_PAGE_TEXT } from "../../src/config/limits";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const SECRET = "test-secret-not-real";
const USER = "user_1";
const KID = "kid_1";
const REEL = "reel_1";

function envFor(db: FakeD1, r2: FakeR2): Env {
  return {
    DB: asD1(db),
    R2: asR2(r2),
    WORKER_SESSION_SECRET: SECRET,
    PUBLIC_API_BASE: "https://api.example.dev",
  } as unknown as Env;
}

async function ctxFor(
  db: FakeD1,
  r2: FakeR2,
  req: { method?: string; body?: unknown } = {},
  params: Record<string, string> = {},
): Promise<Ctx> {
  const sig = await signSessionId(SECRET, "sess_1");
  const request = new Request("https://x/api", {
    method: req.method ?? "GET",
    headers: { Cookie: `${SESSION_COOKIE}=sess_1.${sig}` },
    ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
  });
  return { env: envFor(db, r2), req: request, params };
}

async function seed(db: FakeD1, r2: FakeR2): Promise<void> {
  db.users.set(USER, { id: USER, is_admin: 0 });
  const sessionKey = await sha256Hex("sess_1");
  db.sessions.set(sessionKey, { id: sessionKey, user_id: USER, expires_at: Date.now() + 1e9 });
  db.kids.set(KID, { id: KID, user_id: USER, display_name: "Mira", deleted_at: null });
  db.reels.set(REEL, { id: REEL, user_id: USER, kid_id: KID, status: "done", tier: "free", story: "s", template_id: "tpl_a", created_at: 1 });
  await r2.put(
    "reels/reel_1/shots.json",
    JSON.stringify([
      { index: 1, caption: "template one", keyframe_key: "reels/reel_1/shot-1.png", video_key: null },
      { index: 2, caption: "template two", keyframe_key: "reels/reel_1/shot-2.png", video_key: null },
    ]),
  );
}

describe("PATCH/DELETE /api/reels/:id/pages/:index", () => {
  it("saves a text override and GET overlays it without extra round-trips", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    const patched = await patchPage(await ctxFor(db, r2, { method: "PATCH", body: { text: "my new words" } }, { id: REEL, index: "1" }));
    expect(patched.status).toBe(200);
    const pageBody = (await patched.json()) as { page: { index: number; text: string; keyframe_url: string | null } };
    expect(pageBody.page).toEqual({ index: 1, text: "my new words", keyframe_url: null });

    const res = await get(await ctxFor(db, r2, {}, { id: REEL }));
    const body = (await res.json()) as { template_id: string; shots: { index: number; caption: string; edited: boolean; keyframe_url: string }[] };
    expect(body.template_id).toBe("tpl_a");
    expect(body.shots[0]).toMatchObject({ index: 1, caption: "my new words", edited: true });
    expect(body.shots[1]).toMatchObject({ index: 2, caption: "template two", edited: false });
    // Still a signed URL, never a raw key.
    expect(body.shots[0]!.keyframe_url).toMatch(/^https:\/\/api\.example\.dev\/api\/media\/reels\/reel_1\/shot-1\.png\?exp=/);
  });

  it("trims and clamps the saved text", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await patchPage(await ctxFor(db, r2, { method: "PATCH", body: { text: `  ${"x".repeat(MAX_PAGE_TEXT + 50)}  ` } }, { id: REEL, index: "2" }));
    expect(db.getOverride(REEL, 2)?.text).toHaveLength(MAX_PAGE_TEXT);
  });

  it("DELETE clears the override so the page reverts to the template", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await patchPage(await ctxFor(db, r2, { method: "PATCH", body: { text: "edited" } }, { id: REEL, index: "1" }));

    const cleared = await deletePage(await ctxFor(db, r2, { method: "DELETE" }, { id: REEL, index: "1" }));
    expect(((await cleared.json()) as { ok: boolean }).ok).toBe(true);

    const res = await get(await ctxFor(db, r2, {}, { id: REEL }));
    const body = (await res.json()) as { shots: { caption: string; edited: boolean }[] };
    expect(body.shots[0]).toMatchObject({ caption: "template one", edited: false });
  });

  it("rejects a blank text, a bad index, and a reel owned by someone else", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await expect(
      patchPage(await ctxFor(db, r2, { method: "PATCH", body: { text: "   " } }, { id: REEL, index: "1" })),
    ).rejects.toMatchObject({ status: 400, code: "text_required" });
    await expect(
      patchPage(await ctxFor(db, r2, { method: "PATCH", body: { text: "hi" } }, { id: REEL, index: "0" })),
    ).rejects.toMatchObject({ status: 400, code: "invalid_page_index" });
    await expect(
      patchPage(await ctxFor(db, r2, { method: "PATCH", body: { text: "hi" } }, { id: "someone_elses", index: "1" })),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("GET /api/kids/:id/character_sheet", () => {
  it("returns a signed 1h sheet_url + version for the latest stored blob", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await r2.put(`sheets/${KID}/old.png`, new Uint8Array([1]));
    await r2.put(`sheets/${KID}/new.png`, new Uint8Array([2]));
    db.characters.set("c1", { id: "c1", kid_id: KID, sheet_r2_key: `sheets/${KID}/old.png`, model: "m", created_at: 10 });
    db.characters.set("c2", { id: "c2", kid_id: KID, sheet_r2_key: `sheets/${KID}/new.png`, model: "m", created_at: 20 });

    const res = await characterSheetRead(await ctxFor(db, r2, {}, { id: KID }));
    const body = (await res.json()) as { sheet_url: string; version: number; updated_at: string };
    expect(res.status).toBe(200);
    expect(body.sheet_url).toMatch(new RegExp(`^https://api\\.example\\.dev/api/media/sheets/${KID}/new\\.png\\?exp=`));
    expect(body.version).toBe(2);
    expect(Number.isNaN(Date.parse(body.updated_at))).toBe(false);
  });

  it("404s no_character_sheet when the row exists but the blob is gone", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    db.characters.set("c1", { id: "c1", kid_id: KID, sheet_r2_key: "sheets/kid_1/missing.png", model: "m", created_at: 10 });
    await expect(characterSheetRead(await ctxFor(db, r2, {}, { id: KID }))).rejects.toMatchObject({ status: 404, code: "no_character_sheet" });
  });

  it("404s for another user's kid", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    db.kids.set("other", { id: "other", user_id: "someone", display_name: "X", deleted_at: null });
    await expect(characterSheetRead(await ctxFor(db, r2, {}, { id: "other" }))).rejects.toMatchObject({ status: 404 });
  });
});
