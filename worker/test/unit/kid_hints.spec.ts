import { describe, expect, it } from "vitest";
import { characterSheet, characterSheetHints, characterSheetRead } from "../../src/routes/kids";
import { runJob } from "../../src/jobs/consumer";
import { SESSION_COOKIE, signSessionId } from "../../src/auth/session";
import { sha256Hex } from "../../src/util/hash";
import { hintsOrNull, hintsPrompt, parseHints, serializeHints } from "../../src/util/hints";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const SECRET = "test-secret-not-real";
const USER = "user_1";
const KID = "kid_1";

async function ctxFor(
  db: FakeD1,
  r2: FakeR2,
  req: { method?: string; body?: unknown } = {},
  params: Record<string, string> = { id: KID },
): Promise<Ctx> {
  const sig = await signSessionId(SECRET, "sess_1");
  const request = new Request("https://x/api", {
    method: req.method ?? "PATCH",
    headers: { Cookie: `${SESSION_COOKIE}=sess_1.${sig}` },
    ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
  });
  const env = {
    DB: asD1(db),
    R2: asR2(r2),
    WORKER_SESSION_SECRET: SECRET,
    PUBLIC_API_BASE: "https://api.example.dev",
    MOCK_PROVIDERS: "1",
    AI: {},
    JOBS: { send: async (_m: { job_id: string }) => {} },
  } as unknown as Env;
  return { env, req: request, params };
}

async function seed(db: FakeD1, r2: FakeR2): Promise<void> {
  db.users.set(USER, { id: USER, is_admin: 0 });
  const sessionKey = await sha256Hex("sess_1");
  db.sessions.set(sessionKey, { id: sessionKey, user_id: USER, expires_at: Date.now() + 1e9 });
  db.kids.set(KID, { id: KID, user_id: USER, display_name: "Mira", deleted_at: null });
  db.consents.set("con1", { id: "con1", user_id: USER, kid_id: KID });
  await r2.put(`sheets/${KID}/s1.png`, new Uint8Array([1]));
  db.characters.set("c1", {
    id: "c1", kid_id: KID, sheet_r2_key: `sheets/${KID}/s1.png`, model: "m", created_at: 10, hints: null,
  });
}

describe("R.3.2 character look hints", () => {
  it("saves a look and reflects it on the next GET", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);

    const before = (await (await characterSheetRead(await ctxFor(db, r2, {}, { id: KID }))).json()) as {
      hints: unknown;
    };
    // Never edited → null, not an invented default set.
    expect(before.hints).toBeNull();

    const saved = await characterSheetHints(
      await ctxFor(db, r2, { body: { hints: { hair: "short curls", outfit: "an astronaut suit" } } }),
    );
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { hints: Record<string, string> };
    expect(savedBody.hints).toMatchObject({ hair: "short curls", outfit: "an astronaut suit", skin: "", style: "" });

    const after = (await (await characterSheetRead(await ctxFor(db, r2, {}, { id: KID }))).json()) as {
      hints: Record<string, string>;
    };
    expect(after.hints).toMatchObject({ hair: "short curls", outfit: "an astronaut suit" });
    expect(db.characters.get("c1")?.hints).toContain("short curls");
  });

  it("refuses a body with no hints object", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await expect(
      characterSheetHints(await ctxFor(db, r2, { body: {} })),
    ).rejects.toMatchObject({ status: 400, code: "hints_required" });
    await expect(
      characterSheetHints(await ctxFor(db, r2, { body: { hints: "curls" } })),
    ).rejects.toMatchObject({ status: 400, code: "hints_required" });
  });

  it("404s saving a look for a kid with no sheet yet", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    db.characters.clear();
    await expect(
      characterSheetHints(await ctxFor(db, r2, { body: { hints: { hair: "a bob" } } })),
    ).rejects.toMatchObject({ status: 404, code: "no_character_sheet" });
  });

  it("carries hints on the job payload for the render to store", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await r2.put("tmp/p1", new Uint8Array([1, 2, 3]));
    db.photos.set("p1", { id: "p1", user_id: USER, r2_key: "tmp/p1", created_at: Date.now(), deleted_at: null });

    const res = await characterSheet(
      await ctxFor(db, r2, {
        body: { photo_id: "p1", consent_id: "con1", hints: { style: "bold crayon outlines" } },
      }),
    );
    expect(res.status).toBe(200);
    const { job_id } = (await res.json()) as { job_id: string };
    // The look lives on the job, not on a character row that may not exist yet.
    expect(JSON.parse(db.getJob(job_id)?.payload ?? "null")).toMatchObject({
      hints: { style: "bold crayon outlines" },
    });
  });

  it("recovers the hints after a brand-new kid's first render (no prior character row)", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    // A kid with a photo and consent but *no* `characters` row: the exact first-run
    // path where the old conditional UPDATE matched zero rows and dropped the look.
    db.users.set(USER, { id: USER, is_admin: 0 });
    const sessionKey = await sha256Hex("sess_1");
    db.sessions.set(sessionKey, { id: sessionKey, user_id: USER, expires_at: Date.now() + 1e9 });
    db.kids.set(KID, { id: KID, user_id: USER, display_name: "Mira", deleted_at: null });
    db.consents.set("con1", { id: "con1", user_id: USER, kid_id: KID });
    expect(db.characters.size).toBe(0);
    await r2.put("tmp/first", new Uint8Array([1, 2, 3]));
    db.photos.set("first", {
      id: "first", user_id: USER, r2_key: "tmp/first", created_at: Date.now(), deleted_at: null,
    });
    // Fresh sheet: no prior GET to 404 against, so the editor's pre-fill is `hints: null`.
    await expect(
      characterSheetRead(await ctxFor(db, r2, {}, { id: KID })),
    ).rejects.toMatchObject({ status: 404, code: "no_character_sheet" });

    const queued = await characterSheet(
      await ctxFor(db, r2, {
        body: { photo_id: "first", consent_id: "con1", hints: { hair: "long braids", outfit: "party clothes" } },
      }),
    );
    expect(queued.status).toBe(200);
    const { job_id } = (await queued.json()) as { job_id: string };

    // The render ran inline (portable build, mock providers, $0) and wrote the
    // character row itself; runJob is a no-op now that the job is done.
    const jobCtx = await ctxFor(db, r2, {}, { id: KID });
    expect(db.getJob(job_id)?.status).toBe("done");
    await runJob(jobCtx.env, job_id);

    const row = [...db.characters.values()][0];
    expect(row?.hints).toContain("long braids");
    const after = (await (await characterSheetRead(await ctxFor(db, r2, {}, { id: KID }))).json()) as {
      hints: Record<string, string>;
    };
    expect(after.hints).toMatchObject({ hair: "long braids", outfit: "party clothes" });
  });

  it("regenerates from the retained photo when photo_id is omitted", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await r2.put("tmp/p1", new Uint8Array([1]));
    // Still inside the 24h window: the previous sheet's photo is reusable.
    db.photos.set("p1", { id: "p1", user_id: USER, r2_key: "tmp/p1", created_at: Date.now(), deleted_at: null });
    db.jobs.set("job_old", {
      id: "job_old", reel_id: null, kid_id: KID, type: "character_sheet", status: "done",
      progress: 100, error: null, photo_id: "p1", consent_id: "con1", payload: null,
    });

    const res = await characterSheet(
      await ctxFor(db, r2, { body: { consent_id: "con1", hints: { hair: "long braids" } } }),
    );
    expect(res.status).toBe(200);
    const { job_id } = (await res.json()) as { job_id: string };
    expect(db.getJob(job_id)?.photo_id).toBe("p1");
  });

  it("fails fast with photo_expired when there is no photo to regenerate from", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    // A sheet exists, but the photo it came from is already gone.
    db.jobs.set("job_old", {
      id: "job_old", reel_id: null, kid_id: KID, type: "character_sheet", status: "done",
      progress: 100, error: null, photo_id: "p_gone", consent_id: "con1", payload: null,
    });
    db.photos.set("p_gone", {
      id: "p_gone", user_id: USER, r2_key: "tmp/gone", created_at: 0, deleted_at: Date.now() - 1000,
    });

    await expect(
      characterSheet(await ctxFor(db, r2, { body: { consent_id: "con1", hints: { hair: "a bob" } } })),
    ).rejects.toMatchObject({ status: 400, code: "photo_expired" });
    // Nothing queued: a job that could only fail is never created.
    expect(db.jobs.size).toBe(1);
  });

  it("still requires a consent row", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    await seed(db, r2);
    await expect(
      characterSheet(await ctxFor(db, r2, { body: { consent_id: "nope" } })),
    ).rejects.toMatchObject({ status: 403, code: "consent_required" });
  });
});

describe("hints vocabulary", () => {
  it("clamps to a closed, prompt-safe vocabulary", () => {
    const parsed = parseHints({
      skin: "  warm brown  ",
      hair: "x".repeat(500),
      outfit: "a bright yellow raincoat",
      style: 42,
      extras: null,
    });
    expect(parsed.skin).toBe("warm brown");
    expect(parsed.hair).toHaveLength(80);
    expect(parsed.style).toBe("");
    expect(parsed.extras).toBe("");
  });

  it("round-trips through storage and reports null for an empty look", () => {
    expect(hintsOrNull(parseHints({}))).toBeNull();
    expect(serializeHints(parseHints({}))).toBeNull();
    const stored = serializeHints(parseHints({ hair: "a bob" }));
    expect(hintsOrNull(stored)).toMatchObject({ hair: "a bob" });
    expect(hintsOrNull(null)).toBeNull();
    expect(hintsOrNull("not json")).toBeNull();
    expect(hintsOrNull('{"hair":"a bob"}')).toMatchObject({ hair: "a bob" });
  });

  it("phrases hints as labelled clauses, never free-form prose", () => {
    const clause = hintsPrompt(parseHints({ skin: "olive", hair: "short curls", extras: "wearing glasses" }));
    expect(clause).toContain("skin tone: olive");
    expect(clause).toContain("hair: short curls");
    expect(clause).toContain("extra details (glasses, freckles): wearing glasses");
    // Absent groups are simply left out, so the prompt stays stable.
    expect(clause).not.toContain("outfit");
    expect(hintsPrompt(parseHints({}))).toBe("");
    expect(hintsPrompt(null)).toBe("");
  });
});
