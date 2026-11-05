import { describe, expect, it } from "vitest";
import { detail, list } from "../../src/routes/catalog";
import {
  bootstrap,
  createTemplateRoute,
  deleteTemplateRoute,
  getTemplateRoute,
  listTemplatesRoute,
  patchTemplateRoute,
} from "../../src/routes/admin";
import { SESSION_COOKIE, signSessionId } from "../../src/auth/session";
import { sha256Hex } from "../../src/util/hash";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const SECRET = "test-secret-not-real";
const USER = "user_1";
const ADMIN = "admin_1";

type SeedOpts = { admin?: boolean; adminToken?: string | null };

async function ctxFor(
  db: FakeD1,
  r2: FakeR2,
  opts: SeedOpts,
  req: { method?: string; path?: string; body?: unknown; headers?: Record<string, string> } = {},
  params: Record<string, string> = {},
): Promise<Ctx> {
  const user = opts.admin ? ADMIN : USER;
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
  void user;
  return { env, req: request, params };
}

async function seed(db: FakeD1, opts: SeedOpts = {}): Promise<void> {
  db.users.set(USER, { id: USER, is_admin: 0 });
  db.users.set(ADMIN, { id: ADMIN, is_admin: 1 });
  const sessionKey = await sha256Hex("sess_1");
  // The session belongs to USER unless the admin flag is requested.
  db.sessions.set(sessionKey, { id: sessionKey, user_id: opts.admin ? ADMIN : USER, expires_at: Date.now() + 1e9 });
  seedTemplate(db, "tpl_a", 1);
  seedTemplate(db, "tpl_b", 0);
}

function seedTemplate(db: FakeD1, id: string, enabled: number): void {
  db.templates.set(id, {
    id, slug: id, title: `{name} and the ${id}`, cover_key: "local:cover.jpg",
    description: "PLACEHOLDER", age_band: "3-5", tier_default: "free", page_count: 6,
    enabled, created_at: 1000, updated_at: 1000,
  });
  db.shots.set(`${id}:1`, { template_id: id, index: 1, caption_prompt: "beat one", keyframe_prompt: null });
}

describe("GET /api/catalog", () => {
  it("returns only enabled templates with a resolved cover url and no session needed", async () => {
    const db = new FakeD1();
    await seed(db);
    const res = await list(await ctxFor(db, new FakeR2(), {}));
    const body = (await res.json()) as { templates: { id: string; cover_url: string }[] };

    expect(res.status).toBe(200);
    expect(body.templates.map((t) => t.id)).toEqual(["tpl_a"]);
    // local: placeholders are shipped with the SPA, never signed.
    expect(body.templates[0]!.cover_url).toBe("local:cover.jpg");
  });

  it("detail includes shot meta and 404s a disabled template", async () => {
    const db = new FakeD1();
    await seed(db);
    const ok = await detail(await ctxFor(db, new FakeR2(), {}, {}, { id: "tpl_a" }));
    const body = (await ok.json()) as { shots: { index: number; caption_prompt: string }[] };
    expect(ok.status).toBe(200);
    expect(body.shots).toEqual([{ index: 1, caption_prompt: "beat one", keyframe_prompt: null }]);

    await expect(detail(await ctxFor(db, new FakeR2(), {}, {}, { id: "tpl_b" }))).rejects.toMatchObject({ status: 404, code: "template_not_found" });
    await expect(detail(await ctxFor(db, new FakeR2(), {}, {}, { id: "nope" }))).rejects.toMatchObject({ status: 404, code: "template_not_found" });
  });
});

describe("admin template CRUD", () => {
  it("403s a non-admin on every admin route", async () => {
    const db = new FakeD1();
    await seed(db);
    const ctx = await ctxFor(db, new FakeR2(), {});
    await expect(listTemplatesRoute(ctx)).rejects.toMatchObject({ status: 403, code: "admin_only" });
  });

  it("lists, creates, patches and deletes as an admin", async () => {
    const db = new FakeD1();
    await seed(db, { admin: true });
    const r2 = new FakeR2();

    const listed = await listTemplatesRoute(await ctxFor(db, r2, { admin: true }));
    expect(((await listed.json()) as { templates: unknown[] }).templates).toHaveLength(2);

    const created = await createTemplateRoute(
      await ctxFor(db, r2, { admin: true }, {
        method: "POST",
        body: { title: "PLACEHOLDER New Story", age_band: "5-7", page_count: 9 },
      }),
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { template: { id: string; slug: string; page_count: number } };
    expect(createdBody.template.slug).toBe("placeholder-new-story");
    // page_count clamps into the 5..8 design range.
    expect(createdBody.template.page_count).toBe(8);

    const patched = await patchTemplateRoute(
      await ctxFor(db, r2, { admin: true }, {
        method: "PATCH",
        body: { enabled: false, title: "PLACEHOLDER Renamed", scene_prompts: [{ index: 1, caption_prompt: "new beat" }] },
      }, { id: createdBody.template.id }),
    );
    const patchedBody = (await patched.json()) as { template: { title: string; enabled: boolean } };
    expect(patchedBody.template.title).toBe("PLACEHOLDER Renamed");
    expect(patchedBody.template.enabled).toBe(false);
    expect(db.shots.get(`${createdBody.template.id}:1`)?.caption_prompt).toBe("new beat");

    const deleted = await deleteTemplateRoute(
      await ctxFor(db, r2, { admin: true }, { method: "DELETE" }, { id: createdBody.template.id }),
    );
    expect(((await deleted.json()) as { ok: boolean }).ok).toBe(true);
    expect(db.getTemplate(createdBody.template.id)).toBeUndefined();
  });

  it("rejects a duplicate slug and a missing title", async () => {
    const db = new FakeD1();
    await seed(db, { admin: true });
    const r2 = new FakeR2();
    const first = await createTemplateRoute(
      await ctxFor(db, r2, { admin: true }, { method: "POST", body: { title: "One", slug: "only-once" } }),
    );
    expect(first.status).toBe(200);

    await expect(
      createTemplateRoute(await ctxFor(db, r2, { admin: true }, { method: "POST", body: { title: "Two", slug: "only-once" } })),
    ).rejects.toMatchObject({ status: 400, code: "slug_taken" });
    await expect(
      createTemplateRoute(await ctxFor(db, r2, { admin: true }, { method: "POST", body: {} })),
    ).rejects.toMatchObject({ status: 400, code: "title_required" });
  });

  it("GET /api/admin/templates/:id returns the template with its shots for the editor (A-03)", async () => {
    const db = new FakeD1();
    await seed(db, { admin: true });
    const res = await getTemplateRoute(await ctxFor(db, new FakeR2(), { admin: true }, {}, { id: "tpl_a" }));
    const body = (await res.json()) as { template: { id: string }; shots: { index: number; caption_prompt: string }[] };
    expect(body.template.id).toBe("tpl_a");
    expect(body.shots).toEqual([{ index: 1, caption_prompt: "beat one", keyframe_prompt: null }]);
  });

  it("scene_prompts patches a keyframe-only shot without clobbering the caption", async () => {
    const db = new FakeD1();
    await seed(db, { admin: true });
    const res = await patchTemplateRoute(
      await ctxFor(db, new FakeR2(), { admin: true }, {
        method: "PATCH",
        body: { scene_prompts: [{ index: 1, keyframe_prompt: "new art direction" }] },
      }, { id: "tpl_a" }),
    );
    expect(res.status).toBe(200);
    const shot = db.shots.get("tpl_a:1")!;
    expect(shot.keyframe_prompt).toBe("new art direction");
    expect(shot.caption_prompt).toBe("beat one"); // untouched
  });

  it("scene_prompts ignores patches for a non-positive index", async () => {
    const db = new FakeD1();
    await seed(db, { admin: true });
    await patchTemplateRoute(
      await ctxFor(db, new FakeR2(), { admin: true }, {
        method: "PATCH",
        body: { scene_prompts: [{ index: 0, caption_prompt: "bogus" }] },
      }, { id: "tpl_a" }),
    );
    expect(db.shots.has("tpl_a:0")).toBe(false);
  });
});

describe("POST /api/admin/bootstrap", () => {
  it("503s with admin_token_unset when no ADMIN_TOKEN env is configured", async () => {
    const db = new FakeD1();
    await seed(db);
    const res = await bootstrap(
      await ctxFor(db, new FakeR2(), {}, { method: "POST", headers: { "X-Admin-Token": "anything" } }),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("admin_token_unset");
    // Never touches the row without a configured token.
    expect(db.users.get(USER)?.is_admin).toBe(0);
  });

  it("promotes the signed-in user when the token matches, and rejects a wrong token", async () => {
    const db = new FakeD1();
    await seed(db);
    const TOKEN = "operator-secret-not-in-repo";

    await expect(
      bootstrap(await ctxFor(db, new FakeR2(), { adminToken: TOKEN }, { method: "POST", headers: { "X-Admin-Token": "wrong" } })),
    ).rejects.toMatchObject({ status: 401, code: "admin_token_invalid" });

    const res = await bootstrap(
      await ctxFor(db, new FakeR2(), { adminToken: TOKEN }, { method: "POST", headers: { "X-Admin-Token": TOKEN } }),
    );
    const body = (await res.json()) as { ok: boolean; is_admin: boolean; user_id: string };
    expect(body).toMatchObject({ ok: true, is_admin: true, user_id: USER });
    expect(db.users.get(USER)?.is_admin).toBe(1);
    // The token is never echoed back.
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("401s without a session even when the token is correct", async () => {
    const db = new FakeD1();
    const env = {
      DB: asD1(db), R2: asR2(new FakeR2()), WORKER_SESSION_SECRET: SECRET, ADMIN_TOKEN: "tok",
    } as unknown as Env;
    const req = new Request("https://x/api/admin/bootstrap", { method: "POST", headers: { "X-Admin-Token": "tok" } });
    await expect(bootstrap({ env, req, params: {} })).rejects.toMatchObject({ status: 401 });
  });
});
