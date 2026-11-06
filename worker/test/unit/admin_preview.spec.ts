import { describe, expect, it } from "vitest";
import { bootstrap, templatePreviewRoute } from "../../src/routes/admin";
import { list as listReels } from "../../src/routes/reels";
import { SESSION_COOKIE, signSessionId } from "../../src/auth/session";
import { sha256Hex } from "../../src/util/hash";
import { MAX_PREVIEW_SHOTS } from "../../src/config/limits";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const SECRET = "test-secret-not-real";
const USER = "user_1";
const ADMIN = "admin_1";
const KID = "kid_1";

async function ctxFor(
  db: FakeD1,
  r2: FakeR2,
  opts: { admin?: boolean; adminToken?: string | null; reels?: unknown } = {},
  req: { method?: string; path?: string; body?: unknown; headers?: Record<string, string> } = {},
  params: Record<string, string> = {},
): Promise<Ctx> {
  const env = {
    DB: asD1(db),
    R2: asR2(r2),
    WORKER_SESSION_SECRET: SECRET,
    PUBLIC_API_BASE: "https://api.example.dev",
    ...(opts.adminToken ? { ADMIN_TOKEN: opts.adminToken } : {}),
  } as unknown as Env;
  const sig = await signSessionId(SECRET, "sess_1");
  const request = new Request(`https://x${req.path ?? "/"}`, {
    method: req.method ?? "GET",
    headers: { Cookie: `${SESSION_COOKIE}=sess_1.${sig}`, ...(req.headers ?? {}) },
    ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
  });
  return { env, req: request, params };
}

async function seed(db: FakeD1, r2: FakeR2, opts: { admin?: boolean; shots?: number; sheet?: boolean } = {}): Promise<void> {
  db.users.set(USER, { id: USER, is_admin: 0 });
  db.users.set(ADMIN, { id: ADMIN, is_admin: 1 });
  const sessionKey = await sha256Hex("sess_1");
  db.sessions.set(sessionKey, { id: sessionKey, user_id: opts.admin ? ADMIN : USER, expires_at: Date.now() + 1e9 });
  db.kids.set(KID, { id: KID, user_id: opts.admin ? ADMIN : USER, display_name: "Mira", deleted_at: null });
  db.templates.set("tpl_a", {
    id: "tpl_a", slug: "tpl_a", title: "{name} and the lantern", cover_key: "local:cover.jpg",
    description: "PLACEHOLDER", age_band: "3-5", tier_default: "free", page_count: 6,
    enabled: 1, created_at: 1000, updated_at: 1000,
  });
  const shots = opts.shots ?? 2;
  for (let i = 1; i <= shots; i++) {
    db.shots.set(`tpl_a:${i}`, { template_id: "tpl_a", index: i, caption_prompt: `beat ${i}`, keyframe_prompt: `draw ${i}` });
  }
  if (opts.sheet !== false) {
    await r2.put(`sheets/${KID}/s1.png`, new Uint8Array([1]));
    db.characters.set("c1", {
      id: "c1", kid_id: KID, sheet_r2_key: `sheets/${KID}/s1.png`, model: "m", created_at: 10, hints: null,
    });
  }
}

const PREVIEW_PARAMS = { id: "tpl_a" };

describe("R.2.2 A-04 admin template preview", () => {
  it("returns a signed overlay and one placeholder shot per template page", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2, { admin: true });

    const res = await templatePreviewRoute(
      await ctxFor(db, r2, { admin: true }, { path: `/api/admin/templates/tpl_a/preview?kid_id=${KID}` }, PREVIEW_PARAMS),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      template_id: string; live: boolean; overlay_url: string; base: string;
      kid: { id: string; display_name: string };
      shots: { index: number; keyframe_url: string | null; caption: string; prompt: string }[];
    };
    expect(body.template_id).toBe("tpl_a");
    expect(body.kid).toMatchObject({ id: KID, display_name: "Mira" });
    // Honest: a preview never claims a live provider call was made.
    expect(body.live).toBe(false);
    expect(body.overlay_url).toMatch(/^https:\/\/api\.example\.dev\/api\/media\/sheets\/kid_1\/s1\.png\?exp=/);
    // No keyframe is stored on catalog shots, so this is null — never fabricated.
    expect(body.shots.map((s) => s.index)).toEqual([1, 2]);
    expect(body.shots[0]).toEqual({ index: 1, keyframe_url: null, caption: "beat 1", prompt: "draw 1" });
  });

  it("is admin-only", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await expect(
      templatePreviewRoute(
        await ctxFor(db, r2, {}, { path: `/api/admin/templates/tpl_a/preview?kid_id=${KID}` }, PREVIEW_PARAMS),
      ),
    ).rejects.toMatchObject({ status: 403, code: "admin_only" });
  });

  it("requires a kid, an existing kid, and an existing sheet", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2, { admin: true });

    await expect(
      templatePreviewRoute(await ctxFor(db, r2, { admin: true }, { path: "/api/admin/templates/tpl_a/preview" }, PREVIEW_PARAMS)),
    ).rejects.toMatchObject({ status: 400, code: "kid_id_required" });

    await expect(
      templatePreviewRoute(
        await ctxFor(db, r2, { admin: true }, { path: "/api/admin/templates/tpl_a/preview?kid_id=nope" }, PREVIEW_PARAMS),
      ),
    ).rejects.toMatchObject({ status: 404, code: "kid_not_found" });

    db.characters.clear();
    await expect(
      templatePreviewRoute(
        await ctxFor(db, r2, { admin: true }, { path: `/api/admin/templates/tpl_a/preview?kid_id=${KID}` }, PREVIEW_PARAMS),
      ),
    ).rejects.toMatchObject({ status: 400, code: "sheet_required" });
  });

  it("404s an unknown template and a template with no shots", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2, { admin: true, shots: 0 });

    await expect(
      templatePreviewRoute(
        await ctxFor(db, r2, { admin: true }, { path: `/api/admin/templates/nope/preview?kid_id=${KID}` }, { id: "nope" }),
      ),
    ).rejects.toMatchObject({ status: 404, code: "template_not_found" });

    await expect(
      templatePreviewRoute(
        await ctxFor(db, r2, { admin: true }, { path: `/api/admin/templates/tpl_a/preview?kid_id=${KID}` }, PREVIEW_PARAMS),
      ),
    ).rejects.toMatchObject({ status: 404, code: "template_has_no_shots" });
  });

  it("caps the preview at MAX_PREVIEW_SHOTS so a long template cannot blow up the panel", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2, { admin: true, shots: MAX_PREVIEW_SHOTS + 4 });
    const res = await templatePreviewRoute(
      await ctxFor(db, r2, { admin: true }, { path: `/api/admin/templates/tpl_a/preview?kid_id=${KID}` }, PREVIEW_PARAMS),
    );
    const body = (await res.json()) as { shots: unknown[] };
    expect(body.shots).toHaveLength(MAX_PREVIEW_SHOTS);
  });
});

describe("POST /api/admin/bootstrap", () => {
  it("promotes the signed-in user when the X-Admin-Token header matches", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    const res = await bootstrap(
      await ctxFor(db, r2, { adminToken: "correct-horse" }, {
        method: "POST", path: "/api/admin/bootstrap", headers: { "X-Admin-Token": "correct-horse" },
      }),
    );
    expect(res.status).toBe(200);
    expect(db.users.get(USER)?.is_admin).toBe(1);
    const body = (await res.json()) as Record<string, unknown>;
    // The token is never echoed back.
    expect(JSON.stringify(body)).not.toContain("correct-horse");
  });

  it("401s a wrong token and 503s when ADMIN_TOKEN is unset", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await expect(
      bootstrap(
        await ctxFor(db, r2, { adminToken: "correct-horse" }, {
          method: "POST", headers: { "X-Admin-Token": "wrong" },
        }),
      ),
    ).rejects.toMatchObject({ status: 401, code: "admin_token_invalid" });
    expect(db.users.get(USER)?.is_admin).toBe(0);

    const unset = await bootstrap(await ctxFor(db, r2, {}, { method: "POST" }));
    expect(unset.status).toBe(503);
  });
});

describe("R.5/#13 GET /api/reels echoes template_id and tier", () => {
  it("returns tier and template_id per row so the SPA needs no per-reel GET", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    db.reels.set("reel_1", {
      id: "reel_1", user_id: USER, kid_id: KID, status: "done", tier: "paid",
      story: "s", template_id: "tpl_a", use_sheet: 1, created_at: 5,
    });
    db.reels.set("reel_2", {
      id: "reel_2", user_id: USER, kid_id: KID, status: "queued", tier: "free",
      story: "legacy", template_id: null, use_sheet: 0, created_at: 9,
    });
    // Another user's reel must not appear.
    db.reels.set("reel_x", {
      id: "reel_x", user_id: "someone", kid_id: KID, status: "done", tier: "hd",
      story: "s", template_id: "tpl_a", created_at: 20,
    });

    const res = await listReels(await ctxFor(db, r2));
    const body = (await res.json()) as {
      reels: { id: string; tier: string; template_id: string | null }[];
    };
    expect(body.reels.map((r) => r.id)).toEqual(["reel_2", "reel_1"]);
    expect(body.reels[1]).toMatchObject({ id: "reel_1", tier: "paid", template_id: "tpl_a" });
    // A legacy free-text reel honestly reports no template.
    expect(body.reels[0]).toMatchObject({ id: "reel_2", tier: "free", template_id: null });
  });
});
