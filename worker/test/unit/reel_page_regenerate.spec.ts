import { describe, expect, it } from "vitest";
import { patchPage } from "../../src/routes/reels";
import { currentSpend } from "../../src/budget/ledger";
import { cleanCaption } from "../../src/jobs/caption";
import { SESSION_COOKIE, signSessionId } from "../../src/auth/session";
import { sha256Hex } from "../../src/util/hash";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const SECRET = "test-secret-not-real";
const USER = "user_1";
const KID = "kid_1";
const REEL = "reel_1";

function envFor(db: FakeD1, r2: FakeR2, overrides: Partial<Env> = {}): Env {
  return {
    DB: asD1(db),
    R2: asR2(r2),
    WORKER_SESSION_SECRET: SECRET,
    PUBLIC_API_BASE: "https://api.example.dev",
    ...overrides,
  } as unknown as Env;
}

async function ctxFor(
  db: FakeD1,
  r2: FakeR2,
  req: { method?: string; body?: unknown } = {},
  params: Record<string, string> = {},
  overrides: Partial<Env> = {},
): Promise<Ctx> {
  const sig = await signSessionId(SECRET, "sess_1");
  const request = new Request("https://x/api", {
    method: req.method ?? "PATCH",
    headers: { Cookie: `${SESSION_COOKIE}=sess_1.${sig}` },
    ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
  });
  return { env: envFor(db, r2, overrides), req: request, params };
}

async function seed(db: FakeD1, r2: FakeR2, tier = "free"): Promise<void> {
  db.users.set(USER, { id: USER, is_admin: 0 });
  const sessionKey = await sha256Hex("sess_1");
  db.sessions.set(sessionKey, { id: sessionKey, user_id: USER, expires_at: Date.now() + 1e9 });
  db.kids.set(KID, { id: KID, user_id: USER, display_name: "Mira", deleted_at: null });
  db.reels.set(REEL, {
    id: REEL, user_id: USER, kid_id: KID, status: "done", tier,
    story: "Mira and the lantern", template_id: "tpl_a", created_at: 1,
  });
  await r2.put(
    "reels/reel_1/shots.json",
    JSON.stringify([
      { index: 1, caption: "template one", keyframe_key: "reels/reel_1/shot-1.png", video_key: null },
    ]),
  );
}

const PATCH_PARAMS = { id: REEL, index: "1" };

describe("R.5.1 PATCH /api/reels/:id/pages/:index regenerate", () => {
  it("regenerates a caption on the free path at $0, writing no ledger row", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    const res = await patchPage(
      await ctxFor(db, r2, { body: { regenerate: { caption: true } } }, PATCH_PARAMS, { MOCK_PROVIDERS: "1" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      page: { text: string; edited: boolean; keyframe_edited: boolean };
      regenerated: string[];
      saved: boolean;
    };
    expect(body.regenerated).toEqual(["caption"]);
    // Preview contract (#1): a regenerate is the caller's draft — it does not
    // claim to have saved anything, so "Save to keep them" stays true.
    expect(body.saved).toBe(false);
    // The mock text adapter emits `{"shots":[],"prompt_hash":"…"}`; it must never
    // reach the page, so the caption falls back to the page's current words.
    expect(body.page.text).toBe("template one");
    expect(body.page.text).not.toContain("{");
    expect(body.page.keyframe_edited).toBe(false);

    expect(await currentSpend(asD1(db), "openrouter")).toBe(0);
    expect(db.ledger.size).toBe(0);
  });

  it("never touches fal, and redraws the keyframe through the mock image adapter for free", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    const res = await patchPage(
      await ctxFor(
        db,
        r2,
        { body: { regenerate: { keyframe: true } } },
        PATCH_PARAMS,
        { MOCK_PROVIDERS: "1", ENABLE_FAL: "0" },
      ),
    );
    const body = (await res.json()) as {
      page: { keyframe_url: string; keyframe_edited: boolean };
      regenerated: string[];
    };
    expect(body.regenerated).toEqual(["keyframe"]);
    expect(body.page.keyframe_edited).toBe(true);
    // Signed URL for the freshly written page-1.png, never a raw key.
    expect(body.page.keyframe_url).toMatch(
      /^https:\/\/api\.example\.dev\/api\/media\/reels\/reel_1\/page-1\.png\?exp=/,
    );
    expect(r2.keys()).toContain("reels/reel_1/page-1.png");
    // A still is an OpenRouter/mock job; fal is the motion provider and is never used.
    expect(await currentSpend(asD1(db), "fal")).toBe(0);
    expect(db.ledger.size).toBe(0);
  });

  it("refuses `text` together with `regenerate.caption` instead of billing then discarding", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2, "paid");

    await expect(
      patchPage(
        await ctxFor(
          db,
          r2,
          { body: { text: "Mira found the lantern", regenerate: { caption: true } } },
          PATCH_PARAMS,
          { MOCK_PROVIDERS: "0", ENABLE_OPENROUTER: "1", OPENROUTER_API_KEY: "not-a-real-key" },
        ),
      ),
    ).rejects.toMatchObject({ status: 400, code: "ambiguous_page_patch" });
    // The refusal happens at the boundary: no ledger row, no override written.
    expect(db.ledger.size).toBe(0);
    expect(db.getOverride(REEL, 1)).toBeUndefined();
  });

  it("still lets a manual text and a keyframe redraw share one request", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    const res = await patchPage(
      await ctxFor(
        db,
        r2,
        { body: { text: "Mira found the lantern", regenerate: { keyframe: true } } },
        PATCH_PARAMS,
        { MOCK_PROVIDERS: "1" },
      ),
    );
    const body = (await res.json()) as { page: { text: string }; regenerated: string[]; saved: boolean };
    expect(body.page.text).toBe("Mira found the lantern");
    expect(body.regenerated).toEqual(["text", "keyframe"]);
    // `saved` is true only for the explicit write, never for a preview regenerate.
    expect(body.saved).toBe(true);
    expect(db.getOverride(REEL, 1)?.text).toBe("Mira found the lantern");
  });

  it("is blocked by the kill switch instead of spending", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2, "paid");
    db.kill.enabled = 1;

    await expect(
      patchPage(
        await ctxFor(
          db,
          r2,
          { body: { regenerate: { caption: true } } },
          PATCH_PARAMS,
          { MOCK_PROVIDERS: "0", ENABLE_OPENROUTER: "1", OPENROUTER_API_KEY: "not-a-real-key" },
        ),
      ),
    ).rejects.toMatchObject({ status: 402, code: "kill_switch" });
    expect(db.ledger.size).toBe(0);
    expect(db.getOverride(REEL, 1)).toBeUndefined();
  });

  it("refuses a paid regenerate when openrouter is disabled (provider_disabled)", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2, "paid");

    await expect(
      patchPage(
        await ctxFor(
          db,
          r2,
          { body: { regenerate: { caption: true } } },
          PATCH_PARAMS,
          { MOCK_PROVIDERS: "0", ENABLE_OPENROUTER: "0", ENABLE_FAL: "1", FAL_KEY: "not-a-real-key" },
        ),
      ),
    ).rejects.toMatchObject({ code: "provider_disabled" });
    expect(db.ledger.size).toBe(0);
    expect(db.getOverride(REEL, 1)).toBeUndefined();
  });

  it("404s a page the reel does not have, and a reel that is not the caller's", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    await expect(
      patchPage(
        await ctxFor(db, r2, { body: { regenerate: { caption: true } } }, { id: REEL, index: "99" }, { MOCK_PROVIDERS: "1" }),
      ),
    ).rejects.toMatchObject({ status: 404, code: "page_not_found" });

    await expect(
      patchPage(
        await ctxFor(db, r2, { body: { text: "hi" } }, { id: "someone_elses", index: "1" }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("requires either text or a regenerate flag", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await expect(
      patchPage(await ctxFor(db, r2, { body: {} }, PATCH_PARAMS)),
    ).rejects.toMatchObject({ status: 400, code: "text_or_regenerate_required" });
    await expect(
      patchPage(await ctxFor(db, r2, { body: { regenerate: {} } }, PATCH_PARAMS)),
    ).rejects.toMatchObject({ status: 400, code: "text_or_regenerate_required" });
  });

  it("re-reads a caption override rather than the template on a second regenerate", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await patchPage(await ctxFor(db, r2, { body: { text: "first edit" } }, PATCH_PARAMS, { MOCK_PROVIDERS: "1" }));

    const res = await patchPage(
      await ctxFor(db, r2, { body: { regenerate: { caption: true } } }, PATCH_PARAMS, { MOCK_PROVIDERS: "1" }),
    );
    const body = (await res.json()) as { page: { text: string } };
    // The mock returns nothing usable, so the page keeps the *edit*, not the template.
    expect(body.page.text).toBe("first edit");
  });
});

describe("cleanCaption", () => {
  it("unwraps a text envelope and rejects a bare JSON object", () => {
    expect(cleanCaption('{"text":"A new page"}')).toBe("A new page");
    expect(cleanCaption('{"shots":[],"prompt_hash":"abc"}')).toBe("");
    expect(cleanCaption('"  quoted words  "')).toBe("quoted words");
    expect(cleanCaption("  plain words  ")).toBe("plain words");
    expect(cleanCaption("")).toBe("");
  });
});
