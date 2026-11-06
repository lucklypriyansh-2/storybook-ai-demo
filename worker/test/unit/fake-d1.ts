// Minimal in-memory D1 supporting exactly the statements used by the modules under test.
type BudgetRow = { total_usd: number; updated_at: number };
type BucketRow = { tokens: number; updated_at: number };
type LedgerRow = {
  id: string;
  user_id: string | null;
  provider: string;
  model: string;
  step: string;
  est_usd: number;
  actual_usd: number | null;
  request_id: string | null;
  created_at: number;
};
type InviteRow = { code: string; max_uses: number; used_count: number; note: string | null };
type KidRow = { id: string; user_id: string; display_name: string; deleted_at: number | null };
type JobRow = {
  id: string;
  reel_id: string | null;
  kid_id: string | null;
  type: string;
  status: string;
  progress: number;
  error: string | null;
  photo_id: string | null;
  consent_id: string | null;
  payload: string | null;
};
type PhotoRow = {
  id: string; user_id: string; r2_key: string; created_at?: number; deleted_at: number | null;
};
type CharacterRow = {
  id: string; kid_id: string; sheet_r2_key: string; model: string; created_at: number;
  hints?: string | null;
};
type ReelRow = {
  id: string; user_id: string; kid_id: string; status: string; tier: string; story: string;
  created_at: number; template_id?: string | null; use_sheet?: number | null;
};
type ConsentRow = { id: string; user_id: string; kid_id: string };
type UserRow = { id: string; is_admin: number; email_hash?: string };
type SessionRow = { id: string; user_id: string; expires_at: number };
type TemplateRow = {
  id: string; slug: string; title: string; cover_key: string | null; description: string | null;
  age_band: string; tier_default: string; page_count: number; enabled: number;
  created_at: number; updated_at: number;
};
type ShotRow = { template_id: string; index: number; caption_prompt: string; keyframe_prompt: string | null };
type PageOverrideRow = { reel_id: string; index: number; text: string | null; keyframe_key: string | null; updated_at: number };

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();

export class FakeD1 {
  budget = new Map<string, BudgetRow>();
  ledger = new Map<string, LedgerRow>();
  buckets = new Map<string, BucketRow>();
  invites = new Map<string, InviteRow>();
  kill = { enabled: 0 };
  kids = new Map<string, KidRow>();
  jobs = new Map<string, JobRow>();
  photos = new Map<string, PhotoRow>();
  characters = new Map<string, CharacterRow>();
  reels = new Map<string, ReelRow>();
  consents = new Map<string, ConsentRow>();
  users = new Map<string, UserRow>();
  sessions = new Map<string, SessionRow>();
  templates = new Map<string, TemplateRow>();
  shots = new Map<string, ShotRow>();
  pageOverrides = new Map<string, PageOverrideRow>();

  getJob(id: string): JobRow | undefined {
    return this.jobs.get(id);
  }

  getTemplate(id: string): TemplateRow | undefined {
    return this.templates.get(id);
  }

  getOverride(reelId: string, index: number): PageOverrideRow | undefined {
    return this.pageOverrides.get(`${reelId}:${index}`);
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, norm(sql));
  }

  async batch(statements: FakeStatement[]): Promise<{ meta: { changes: number } }[]> {
    const out: { meta: { changes: number } }[] = [];
    for (const statement of statements) out.push(await statement.run());
    return out;
  }
}

class FakeStatement {
  private args: unknown[] = [];

  constructor(
    private db: FakeD1,
    private sql: string,
  ) {}

  bind(...args: unknown[]): FakeStatement {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const [rows] = this.exec();
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; meta: { changes: number } }> {
    const [rows, changes] = this.exec();
    return { results: rows as T[], meta: { changes } };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const [, changes] = this.exec();
    return { meta: { changes } };
  }

  private exec(): [Record<string, unknown>[], number] {
    const { db, sql, args } = this;

    if (sql.startsWith("SELECT enabled FROM kill_switch")) {
      return [[{ enabled: db.kill.enabled }], 0];
    }

    if (sql.startsWith("INSERT INTO budget_state")) {
      const provider = String(args[0]);
      if (!db.budget.has(provider)) {
        db.budget.set(provider, { total_usd: 0, updated_at: Number(args[1]) });
        return [[], 1];
      }
      return [[], 0];
    }

    if (sql.startsWith("UPDATE budget_state SET total_usd = total_usd + ?")) {
      const [est, now, provider, estAgain, cap] = args as [number, number, string, number, number];
      const row = db.budget.get(provider);
      if (!row || row.total_usd + estAgain > cap) return [[], 0];
      row.total_usd = row.total_usd + est;
      row.updated_at = now;
      return [[], 1];
    }

    if (sql.startsWith("SELECT total_usd FROM budget_state")) {
      const row = db.budget.get(String(args[0]));
      return [row ? [{ total_usd: row.total_usd }] : [], 0];
    }

    if (sql.startsWith("INSERT INTO ledger")) {
      const [id, user_id, provider, model, step, est_usd, now] = args as [
        string,
        string | null,
        string,
        string,
        string,
        number,
        number,
      ];
      db.ledger.set(id, {
        id,
        user_id,
        provider,
        model,
        step,
        est_usd,
        actual_usd: null,
        request_id: null,
        created_at: now,
      });
      return [[], 1];
    }

    if (sql.startsWith("SELECT est_usd, provider FROM ledger")) {
      const row = db.ledger.get(String(args[0]));
      return [row ? [{ est_usd: row.est_usd, provider: row.provider }] : [], 0];
    }

    if (sql.startsWith("UPDATE budget_state SET total_usd = MAX(0, total_usd - ?)")) {
      const [delta, now, provider] = args as [number, number, string];
      const row = db.budget.get(provider);
      if (!row) return [[], 0];
      row.total_usd = Math.max(0, row.total_usd - delta);
      row.updated_at = now;
      return [[], 1];
    }

    if (sql.startsWith("UPDATE budget_state SET total_usd = MAX(0, total_usd + ?)")) {
      const [delta, now, provider] = args as [number, number, string];
      const row = db.budget.get(provider);
      if (!row) return [[], 0];
      row.total_usd = Math.max(0, row.total_usd + delta);
      row.updated_at = now;
      return [[], 1];
    }

    if (sql.startsWith("UPDATE ledger SET actual_usd")) {
      const [actual, requestId, id] = args as [number, string | null, string];
      const row = db.ledger.get(id);
      if (!row) return [[], 0];
      row.actual_usd = actual;
      row.request_id = requestId;
      return [[], 1];
    }

    if (sql.startsWith("DELETE FROM ledger")) {
      const deleted = db.ledger.delete(String(args[0]));
      return [[], deleted ? 1 : 0];
    }

    if (sql.startsWith("INSERT INTO rate_buckets")) {
      const [key, tokens, now] = args as [string, number, number];
      if (!db.buckets.has(key)) {
        db.buckets.set(key, { tokens, updated_at: now });
        return [[], 1];
      }
      return [[], 0];
    }

    if (sql.startsWith("UPDATE rate_buckets SET tokens = tokens - 1")) {
      const [now, key] = args as [number, string];
      const row = db.buckets.get(key);
      if (!row || row.tokens < 1) return [[], 0];
      row.tokens -= 1;
      row.updated_at = now;
      return [[], 1];
    }

    if (sql.startsWith("SELECT tokens FROM rate_buckets")) {
      const row = db.buckets.get(String(args[0]));
      return [row ? [{ tokens: row.tokens }] : [], 0];
    }

    if (sql.startsWith("DELETE FROM rate_buckets")) {
      // Keep keys ending in today's day stamp or the current hour stamp.
      const anyOf = (args as string[]).map((a) => a.replace(/^%:/, ":"));
      let n = 0;
      for (const key of [...db.buckets.keys()]) {
        if (anyOf.some((suffix) => key.endsWith(suffix))) continue;
        db.buckets.delete(key);
        n++;
      }
      return [[], n];
    }

    if (sql.startsWith("SELECT code, max_uses, used_count FROM invite_codes")) {
      const row = db.invites.get(String(args[0]));
      return [
        row ? [{ code: row.code, max_uses: row.max_uses, used_count: row.used_count }] : [],
        0,
      ];
    }

    if (sql.startsWith("UPDATE invite_codes SET used_count = used_count + 1")) {
      const row = db.invites.get(String(args[0]));
      if (!row || row.used_count >= row.max_uses) return [[], 0];
      row.used_count += 1;
      return [[], 1];
    }

    // ---- users / sessions (enough for requireSession) ----
    if (sql.startsWith("INSERT INTO users")) {
      // is_admin is the literal 0 in the INSERT, so args hold id/email/code/created_at.
      const [id, email_hash] = args as [string, string, string, number];
      db.users.set(id, { id, is_admin: 0, email_hash });
      return [[], 1];
    }
    if (sql.startsWith("SELECT id, is_admin FROM users WHERE email_hash")) {
      const email_hash = String(args[0]);
      for (const u of db.users.values()) {
        if (u.email_hash === email_hash) return [[{ id: u.id, is_admin: u.is_admin }], 0];
      }
      return [[], 0];
    }
    if (sql.startsWith("UPDATE users SET is_admin = 1 WHERE id = ?")) {
      const row = db.users.get(String(args[0]));
      if (!row) return [[], 0];
      row.is_admin = 1;
      return [[], 1];
    }
    if (sql.startsWith("INSERT INTO sessions")) {
      const [id, user_id, expires_at] = args as [string, string, number, number];
      db.sessions.set(id, { id, user_id, expires_at });
      return [[], 1];
    }
    if (sql.startsWith("SELECT s.expires_at, u.id AS user_id")) {
      const s = db.sessions.get(String(args[0]));
      if (!s) return [[], 0];
      const u = db.users.get(s.user_id);
      return [[{ expires_at: s.expires_at, user_id: s.user_id, is_admin: u?.is_admin ?? 0 }], 0];
    }
    if (sql.startsWith("DELETE FROM sessions WHERE id")) {
      return [[], db.sessions.delete(String(args[0])) ? 1 : 0];
    }

    // ---- kids ----
    if (sql.startsWith("SELECT id, deleted_at FROM kids WHERE id = ?")) {
      const [kidId, userId] = args as [string, string];
      const row = db.kids.get(kidId);
      if (!row || row.user_id !== userId) return [[], 0];
      return [[{ id: row.id, deleted_at: row.deleted_at }], 0];
    }
    if (sql.startsWith("SELECT id FROM kids WHERE id = ?")) {
      const [kidId, userId] = args as [string, string];
      const row = db.kids.get(kidId);
      if (!row || row.user_id !== userId) return [[], 0];
      if (sql.includes("deleted_at IS NULL") && row.deleted_at !== null) return [[], 0];
      return [[{ id: row.id }], 0];
    }
    // R.2.2 A-04 admin preview resolves the picked kid's display name.
    if (sql.startsWith("SELECT id, display_name FROM kids WHERE id = ?")) {
      const [kidId, userId] = args as [string, string];
      const row = db.kids.get(kidId);
      if (!row || row.user_id !== userId) return [[], 0];
      if (sql.includes("deleted_at IS NULL") && row.deleted_at !== null) return [[], 0];
      return [[{ id: row.id, display_name: row.display_name }], 0];
    }
    if (sql.startsWith("INSERT INTO kids")) {
      const [id, user_id, display_name, created_at] = args as [string, string, string, number];
      db.kids.set(id, { id, user_id, display_name, deleted_at: null, created_at } as KidRow & { created_at: number });
      return [[], 1];
    }
    if (sql.startsWith("SELECT user_id FROM kids WHERE id")) {
      const row = db.kids.get(String(args[0]));
      return [row ? [{ user_id: row.user_id }] : [], 0];
    }
    if (sql.startsWith("UPDATE kids SET deleted_at")) {
      const [now, id] = args as [number, string];
      const row = db.kids.get(id);
      if (!row) return [[], 0];
      row.deleted_at = now;
      return [[], 1];
    }

    // ---- photos_tmp ----
    if (sql.startsWith("INSERT INTO photos_tmp")) {
      const [id, user_id, r2_key] = args as [string, string, string];
      db.photos.set(id, { id, user_id, r2_key, created_at: Date.now(), deleted_at: null });
      return [[], 1];
    }
    // 24h retention sweep (Phase C #E): live rows older than the cutoff.
    if (sql.startsWith("SELECT id, r2_key FROM photos_tmp WHERE deleted_at IS NULL")) {
      const cutoff = Number(args[0]);
      const rows = [...db.photos.values()]
        .filter((p) => p.deleted_at === null && (p.created_at ?? 0) < cutoff)
        .map((p) => ({ id: p.id, r2_key: p.r2_key }));
      return [rows, 0];
    }
    if (sql.startsWith("SELECT r2_key FROM photos_tmp")) {
      const [id, user_id] = args as [string, string];
      const row = db.photos.get(id);
      if (!row || row.user_id !== user_id || row.deleted_at !== null) return [[], 0];
      return [[{ r2_key: row.r2_key }], 0];
    }
    if (sql.startsWith("SELECT id FROM photos_tmp WHERE id = ?")) {
      const [id, user_id] = args as [string, string];
      const row = db.photos.get(id);
      if (!row || row.user_id !== user_id || row.deleted_at !== null) return [[], 0];
      return [[{ id: row.id }], 0];
    }
    // R.3.2: the photo the latest sheet job used, while it is still retained.
    // Returns the newest *live* one so "Regenerate with edits" works after a
    // re-render without a fresh upload.
    if (sql.startsWith("SELECT j.photo_id AS photo_id FROM jobs j")) {
      const [kidId, userId] = args as [string, string];
      const candidates = [...db.jobs.values()]
        .filter((j) => j.kid_id === kidId && j.type === "character_sheet" && !!j.photo_id)
        .map((j) => ({ job: j, photo: db.photos.get(j.photo_id as string) }))
        .filter((c) => c.photo && c.photo.user_id === userId && c.photo.deleted_at === null);
      if (candidates.length === 0) return [[], 0];
      // jobs have no created_at in the fake; the newest insertion wins.
      const last = candidates[candidates.length - 1]!;
      return [[{ photo_id: last.photo!.id }], 0];
    }
    if (sql.startsWith("SELECT p.id, p.r2_key FROM photos_tmp p")) {
      const [kidId, userId] = args as [string, string];
      const rows: { id: string; r2_key: string }[] = [];
      for (const job of db.jobs.values()) {
        if (job.kid_id !== kidId || !job.photo_id) continue;
        const photo = db.photos.get(job.photo_id);
        if (photo && photo.user_id === userId && photo.deleted_at === null) {
          rows.push({ id: photo.id, r2_key: photo.r2_key });
        }
      }
      return [rows, 0];
    }
    if (sql.startsWith("SELECT id FROM photos_tmp WHERE r2_key")) {
      for (const row of db.photos.values()) {
        if (row.r2_key === String(args[0]) && row.deleted_at === null) return [[{ id: row.id }], 0];
      }
      return [[], 0];
    }
    if (sql.startsWith("UPDATE photos_tmp SET deleted_at")) {
      const [now, id] = args as [number, string];
      const row = db.photos.get(id);
      if (!row) return [[], 0];
      row.deleted_at = now;
      return [[], 1];
    }

    // ---- characters ----
    if (sql.startsWith("INSERT INTO characters")) {
      // The render writes the look it used onto the row it creates, so a
      // hint-only regenerate survives for a kid with no prior character row.
      const [id, kid_id, sheet_r2_key, model, hints, created_at] = args as [
        string, string, string, string, string | null, number,
      ];
      db.characters.set(id, { id, kid_id, sheet_r2_key, model, hints, created_at });
      return [[], 1];
    }
    if (sql.startsWith("SELECT id FROM characters WHERE kid_id")) {
      const kid_id = String(args[0]);
      const row = [...db.characters.values()].find((c) => c.kid_id === kid_id);
      return [row ? [{ id: row.id }] : [], 0];
    }
    if (sql.startsWith("SELECT COUNT(*) AS n FROM characters")) {
      const kid_id = String(args[0]);
      const n = [...db.characters.values()].filter((c) => c.kid_id === kid_id).length;
      return [[{ n }], 0];
    }
    if (sql.startsWith("SELECT sheet_r2_key, created_at FROM characters")) {
      const kid_id = String(args[0]);
      const rows = [...db.characters.values()]
        .filter((c) => c.kid_id === kid_id)
        .sort((a, b) => b.created_at - a.created_at)
        .map((c) => ({ sheet_r2_key: c.sheet_r2_key, created_at: c.created_at }));
      return [rows.slice(0, 1), 0];
    }
    if (sql.startsWith("SELECT sheet_r2_key FROM characters WHERE kid_id")) {
      const kid_id = String(args[0]);
      const rows = [...db.characters.values()]
        .filter((c) => c.kid_id === kid_id)
        .sort((a, b) => b.created_at - a.created_at)
        .map((c) => ({ sheet_r2_key: c.sheet_r2_key }));
      return [rows.slice(0, 1), 0];
    }
    // R.3.2: the who/what of the saved look, read by the sheet render and GET.
    if (sql.startsWith("SELECT sheet_r2_key, created_at, hints FROM characters")) {
      const kid_id = String(args[0]);
      const rows = [...db.characters.values()]
        .filter((c) => c.kid_id === kid_id)
        .sort((a, b) => b.created_at - a.created_at)
        .map((c) => ({ sheet_r2_key: c.sheet_r2_key, created_at: c.created_at, hints: c.hints ?? null }));
      return [rows.slice(0, 1), 0];
    }
    if (sql.startsWith("SELECT hints FROM characters WHERE kid_id")) {
      const kid_id = String(args[0]);
      const rows = [...db.characters.values()]
        .filter((c) => c.kid_id === kid_id)
        .sort((a, b) => b.created_at - a.created_at)
        .map((c) => ({ hints: c.hints ?? null }));
      return [rows.slice(0, 1), 0];
    }
    if (sql.startsWith("UPDATE characters SET hints = ? WHERE id = (SELECT")) {
      const [hints, kid_id] = args as [string, string];
      const row = [...db.characters.values()]
        .filter((c) => c.kid_id === kid_id)
        .sort((a, b) => b.created_at - a.created_at)[0];
      if (!row) return [[], 0];
      row.hints = hints;
      return [[], 1];
    }
    if (sql.startsWith("UPDATE characters SET hints = ? WHERE id = ?")) {
      const [hints, id] = args as [string, string];
      const row = db.characters.get(id);
      if (!row) return [[], 0];
      row.hints = hints;
      return [[], 1];
    }
    if (sql.startsWith("DELETE FROM characters WHERE kid_id")) {
      let n = 0;
      for (const [id, row] of db.characters) if (row.kid_id === String(args[0])) { db.characters.delete(id); n++; }
      return [[], n];
    }

    // ---- consents ----
    if (sql.startsWith("INSERT INTO consents")) {
      const [id, user_id, kid_id] = args as [string, string, string, string, number, number];
      db.consents.set(id, { id, user_id, kid_id });
      return [[], 1];
    }
    if (sql.startsWith("SELECT id FROM consents WHERE id")) {
      const [id, kid_id, user_id] = args as [string, string, string];
      const row = db.consents.get(id);
      if (!row || row.kid_id !== kid_id || row.user_id !== user_id) return [[], 0];
      return [[{ id: row.id }], 0];
    }
    if (sql.startsWith("DELETE FROM consents WHERE kid_id")) {
      let n = 0;
      for (const [id, row] of db.consents) if (row.kid_id === String(args[0])) { db.consents.delete(id); n++; }
      return [[], n];
    }

    // ---- reels ----
    if (sql.startsWith("INSERT INTO reels")) {
      const [id, user_id, kid_id, tier, story, template_id, use_sheet, created_at] =
        args as [string, string, string, string, string, string | null, number, number];
      db.reels.set(id, { id, user_id, kid_id, status: "queued", tier, story, template_id, use_sheet, created_at });
      return [[], 1];
    }
    if (sql.startsWith("SELECT user_id, kid_id, tier, story FROM reels WHERE id")) {
      const row = db.reels.get(String(args[0]));
      return [row ? [{ user_id: row.user_id, kid_id: row.kid_id, tier: row.tier, story: row.story }] : [], 0];
    }
    if (sql.startsWith("SELECT id, status, tier") && sql.includes("FROM reels WHERE id = ? AND user_id")) {
      const [id, user_id] = args as [string, string];
      const row = db.reels.get(id);
      if (!row || row.user_id !== user_id) return [[], 0];
      return [[{ id: row.id, status: row.status, tier: row.tier, template_id: row.template_id ?? null }], 0];
    }
    // R.5/#13: list echoes tier + template_id so the SPA binds a reel to its book
    // without a per-reel GET.
    if (sql.startsWith("SELECT id, status, tier, template_id, created_at FROM reels WHERE user_id")) {
      const user_id = String(args[0]);
      const rows = [...db.reels.values()]
        .filter((r) => r.user_id === user_id)
        .sort((a, b) => b.created_at - a.created_at)
        .map((r) => ({
          id: r.id, status: r.status, tier: r.tier,
          template_id: r.template_id ?? null, created_at: r.created_at,
        }));
      return [rows, 0];
    }
    // R.5.1: patchPage needs the reel's kid/tier/story to regenerate a page.
    if (sql.startsWith("SELECT id, kid_id, tier, story, template_id FROM reels WHERE id")) {
      const [id, user_id] = args as [string, string];
      const row = db.reels.get(id);
      if (!row || row.user_id !== user_id) return [[], 0];
      return [[{
        id: row.id, kid_id: row.kid_id, tier: row.tier,
        story: row.story, template_id: row.template_id ?? null,
      }], 0];
    }
    if (sql.startsWith("SELECT id FROM reels WHERE id = ? AND user_id")) {
      const [id, user_id] = args as [string, string];
      const row = db.reels.get(id);
      if (!row || row.user_id !== user_id) return [[], 0];
      return [[{ id: row.id }], 0];
    }
    if (sql.startsWith("SELECT id FROM reels WHERE kid_id")) {
      const [kid_id, user_id] = args as [string, string];
      const rows = [...db.reels.values()].filter((r) => r.kid_id === kid_id && r.user_id === user_id).map((r) => ({ id: r.id }));
      return [rows, 0];
    }
    if (sql.startsWith("UPDATE reels SET status = 'failed'")) {
      const jobId = String(args[0]);
      const job = db.jobs.get(jobId);
      const reel = job?.reel_id ? db.reels.get(job.reel_id) : undefined;
      if (!reel) return [[], 0];
      reel.status = "failed";
      return [[], 1];
    }
    if (sql.startsWith("UPDATE reels SET status = 'running'")) {
      const row = db.reels.get(String(args[0]));
      if (!row) return [[], 0];
      row.status = "running";
      return [[], 1];
    }
    if (sql.startsWith("UPDATE reels SET status = 'done'")) {
      const row = db.reels.get(String(args[0]));
      if (!row) return [[], 0];
      row.status = "done";
      return [[], 1];
    }

    // ---- jobs ----
    if (sql.startsWith("INSERT INTO jobs")) {
      const base: JobRow = {
        id: String(args[0]), reel_id: null, kid_id: null, type: "", status: "queued",
        progress: 0, error: null, photo_id: null, consent_id: null, payload: null,
      };
      if (sql.includes("'character_sheet'")) {
        const [id, kid_id, photo_id, consent_id, payload] = args as [
          string, string, string, string, string | null, number, number,
        ];
        Object.assign(base, { id, kid_id, type: "character_sheet", photo_id, consent_id, payload });
      } else if (sql.includes("'reel_generate'")) {
        const [id, reel_id, kid_id] = args as [string, string, string, number, number];
        Object.assign(base, { id, reel_id, kid_id, type: "reel_generate" });
      } else if (sql.includes("'motion_i2v'")) {
        const [id, reel_id, payload] = args as [string, string, string, number, number];
        Object.assign(base, { id, reel_id, type: "motion_i2v", payload });
      } else {
        throw new Error(`FakeD1: unknown jobs insert: ${sql}`);
      }
      db.jobs.set(base.id, base);
      return [[], 1];
    }
    if (sql.startsWith("SELECT kid_id, photo_id, payload FROM jobs WHERE id")) {
      const row = db.jobs.get(String(args[0]));
      return [row ? [{ kid_id: row.kid_id, photo_id: row.photo_id, payload: row.payload }] : [], 0];
    }
    if (sql.startsWith("SELECT reel_id FROM jobs WHERE id")) {
      const row = db.jobs.get(String(args[0]));
      return [row ? [{ reel_id: row.reel_id }] : [], 0];
    }
    if (sql.startsWith("SELECT type, status FROM jobs WHERE id")) {
      const row = db.jobs.get(String(args[0]));
      return [row ? [{ type: row.type, status: row.status }] : [], 0];
    }
    if (sql.startsWith("SELECT j.reel_id, j.payload")) {
      const row = db.jobs.get(String(args[0]));
      if (!row) return [[], 0];
      const reel = row.reel_id ? db.reels.get(row.reel_id) : undefined;
      return [[{ reel_id: row.reel_id, payload: row.payload, user_id: reel?.user_id ?? null }], 0];
    }
    if (sql.startsWith("UPDATE jobs SET status = 'running'")) {
      const row = db.jobs.get(String(args[1]));
      if (!row) return [[], 0];
      row.status = "running";
      return [[], 1];
    }
    if (sql.startsWith("UPDATE jobs SET status = 'done', progress = 100")) {
      const row = db.jobs.get(String(args[1]));
      if (!row) return [[], 0];
      row.status = "done";
      row.progress = 100;
      return [[], 1];
    }
    if (sql.startsWith("UPDATE jobs SET status = 'done'")) {
      const row = db.jobs.get(String(args[1]));
      if (!row) return [[], 0];
      row.status = "done";
      return [[], 1];
    }
    if (sql.startsWith("UPDATE jobs SET status = 'failed'")) {
      const [reason, , id] = args as [string, number, string];
      const row = db.jobs.get(id);
      if (!row) return [[], 0];
      row.status = "failed";
      row.error = reason;
      return [[], 1];
    }
    if (sql.startsWith("UPDATE jobs SET error = ?")) {
      const [reason, , id] = args as [string, number, string];
      const row = db.jobs.get(id);
      if (!row) return [[], 0];
      row.error = reason;
      return [[], 1];
    }
    if (sql.startsWith("UPDATE jobs SET progress = ?")) {
      const [progress, , id] = args as [number, number, string];
      const row = db.jobs.get(id);
      if (!row) return [[], 0];
      row.progress = progress;
      return [[], 1];
    }

    // ---- story_templates (catalog) ----
    if (sql.startsWith("INSERT INTO story_templates")) {
      const [id, slug, title, cover_key, description, age_band, tier_default, page_count, enabled, created_at, updated_at] =
        args as [string, string, string, string | null, string | null, string, string, number, number, number, number];
      db.templates.set(id, {
        id, slug, title, cover_key, description, age_band, tier_default, page_count, enabled, created_at, updated_at,
      });
      return [[], 1];
    }
    if (sql.startsWith("SELECT") && sql.includes("FROM story_templates")) {
      let rows = [...db.templates.values()];
      if (sql.includes("WHERE enabled = 1")) rows = rows.filter((t) => t.enabled === 1);
      if (sql.includes("WHERE id = ?")) {
        const row = db.templates.get(String(args[0]));
        return [row ? [row] : [], 0];
      }
      if (sql.includes("WHERE slug = ?")) {
        const row = rows.find((t) => t.slug === String(args[0]));
        return [row ? [row] : [], 0];
      }
      rows.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return [rows, 0];
    }
    if (sql.startsWith("UPDATE story_templates SET")) {
      const id = String(args[args.length - 1]);
      const row = db.templates.get(id);
      if (!row) return [[], 0];
      if (sql.startsWith("UPDATE story_templates SET updated_at = ?")) {
        // Prompt-only edit: bump updated_at and nothing else.
        row.updated_at = Number(args[0]);
        return [[], 1];
      }
      // Every writable column is passed positionally in the SQL's own order.
      const columns = [
        "title", "slug", "cover_key", "description", "age_band", "tier_default", "page_count", "enabled",
      ] as const;
      let a = 0;
      for (const column of columns) if (sql.includes(`${column} = ?`)) {
        (row as unknown as Record<string, unknown>)[column] = args[a++];
      }
      row.updated_at = args[args.length - 2] as number;
      return [[], 1];
    }
    if (sql.startsWith("DELETE FROM story_templates")) {
      return [[], db.templates.delete(String(args[0])) ? 1 : 0];
    }

    // ---- story_template_shots ----
    if (sql.startsWith("INSERT INTO story_template_shots")) {
      const [template_id, index, caption_prompt, keyframe_prompt] =
        args as [string, number, string, string | null];
      const key = `${template_id}:${index}`;
      if (db.shots.has(key) && sql.includes("ON CONFLICT")) {
        const row = db.shots.get(key)!;
        if (sql.includes("caption_prompt = excluded.caption_prompt")) row.caption_prompt = caption_prompt;
        if (sql.includes("keyframe_prompt = excluded.keyframe_prompt")) row.keyframe_prompt = keyframe_prompt;
        return [[], 1];
      }
      db.shots.set(key, { template_id, index, caption_prompt, keyframe_prompt });
      return [[], 1];
    }
    if (sql.startsWith("SELECT template_id") && sql.includes("FROM story_template_shots")) {
      const template_id = String(args[0]);
      const rows = [...db.shots.values()].filter((s) => s.template_id === template_id).sort((a, b) => a.index - b.index);
      return [rows, 0];
    }
    if (sql.startsWith("DELETE FROM story_template_shots")) {
      let n = 0;
      for (const [key, row] of db.shots) if (row.template_id === String(args[0])) { db.shots.delete(key); n++; }
      return [[], n];
    }

    // ---- reel_page_overrides ----
    if (sql.startsWith("INSERT INTO reel_page_overrides")) {
      const [reel_id, index, text, keyframe_key, updated_at] =
        args as [string, number, string | null, string | null, number];
      db.pageOverrides.set(`${reel_id}:${index}`, { reel_id, index, text, keyframe_key, updated_at });
      return [[], 1];
    }
    if (sql.startsWith("SELECT") && sql.includes("FROM reel_page_overrides")) {
      if (sql.includes("AND \"index\" = ?")) {
        const row = db.pageOverrides.get(`${args[0]}:${args[1]}`);
        return [row ? [{ text: row.text, keyframe_key: row.keyframe_key }] : [], 0];
      }
      const reel_id = String(args[0]);
      const rows = [...db.pageOverrides.values()].filter((o) => o.reel_id === reel_id).sort((a, b) => a.index - b.index);
      return [rows, 0];
    }
    if (sql.startsWith("UPDATE reel_page_overrides SET text")) {
      const [text, keyframe_key, updated_at, reel_id, index] =
        args as [string | null, string | null, number, string, number];
      const row = db.pageOverrides.get(`${reel_id}:${index}`);
      if (!row) return [[], 0];
      row.text = text;
      row.keyframe_key = keyframe_key;
      row.updated_at = updated_at;
      return [[], 1];
    }
    if (sql.startsWith("DELETE FROM reel_page_overrides")) {
      return [[], db.pageOverrides.delete(`${args[0]}:${args[1]}`) ? 1 : 0];
    }

    throw new Error(`FakeD1: unhandled SQL: ${sql}`);
  }
}

export function asD1(db: FakeD1): D1Database {
  return db as unknown as D1Database;
}
