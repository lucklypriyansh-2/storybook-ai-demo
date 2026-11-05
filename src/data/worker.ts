import { DEFAULT_LOOK, type Look } from '../mascot';
import { SETTINGS_DEFAULTS, CONSENT_DEFAULTS } from './local';
import { bookPages, fill } from './seed';
import { allTemplates, templateById, templateFromCatalog } from './catalog';
import { clearBookPage, saveBookPage } from './bookPages';
import type { Book, CatalogShot, CatalogTemplate, Consent, ConsentKind, DataApi, Household, PublishItem, Reel, ReelState, ReelVersion, RenderJob, Settings, Template } from './types';

/** Client-side metadata the Worker doesn't return yet (template + edited state per reel). */
type ReelMeta = { template_id: string; state: ReelState; version: number };
const META_KEY = 'sb.reelMeta.v1';

/** Seed templates + placeholder catalog rows, de-duplicated. */
const CATALOG_TEMPLATES = allTemplates();

/** Error carrying the Worker's HTTP status + error code so the UI can map 402/429/401 to modals. */
export class WorkerError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail?: unknown) {
    super(code);
    this.name = 'WorkerError';
  }
}

type JobRow = { id: string; type: string; status: string; progress: number; error?: string };

/** A story_templates row as the Worker serialises it (cover is a signed URL or `local:` key). */
type RowTemplate = {
  id: string; slug: string; title: string; cover_url?: string | null; description: string;
  age_band: string; tier_default: string; page_count: number; enabled: boolean;
};

function toCatalogTemplate(row: RowTemplate): CatalogTemplate {
  return {
    id: row.id, slug: row.slug, title: row.title,
    cover: row.cover_url ?? null, description: row.description ?? '',
    age_band: row.age_band, tier_default: row.tier_default,
    page_count: row.page_count, enabled: row.enabled,
  };
}

/** A kid as the Worker returns it (docs/ai-backend/BUDGET-SECURITY-DESIGN.md §6). */
type WorkerKid = { id: string; display_name: string; has_sheet: boolean };
type WorkerReel = { id: string; status: string; tier: string; created_at: number };

/**
 * Cloudflare Worker backend (worker/). Activated when VITE_API_URL is baked in at build time.
 * Auth, kids, photos, consent, character sheets, reels and job polling are worker-backed.
 * Templates are static seed rows; per-reel template/state/version live in a client metadata map
 * (`sb.reelMeta.v1`) and books are derived from that map + the server reel list (no book endpoint).
 */
export class WorkerApi implements DataApi {
  readonly mode = 'worker' as const;
  private hid = '';
  private kidId = '';
  private kidName = '';
  private loved = new Map<string, boolean>();
  private saved = new Map<string, boolean>();
  private publish: PublishItem[] = [];
  private consentList: Consent[] = (Object.keys(CONSENT_DEFAULTS) as ConsentKind[]).map(kind => ({
    kind, granted: CONSENT_DEFAULTS[kind], updated_at: new Date().toISOString(),
  }));
  private lastJobs: RenderJob[] = [];
  private subs = new Set<(r: Reel[]) => void>();
  /** reel_id -> template/state/version. Catalog reels also learn their template from the Worker. */
  private reelMeta = new Map<string, ReelMeta>();
  /** Catalog rows fetched this session (placeholder seeds are in the module-load snapshot). */
  private catalogRows = new Map<string, CatalogTemplate>();
  private catalogRowsLoaded = false;
  /** Reel ids we already tried to hydrate, so a failed/foreign reel is not re-fetched forever. */
  private hydratedReels = new Set<string>();
  /** Short-lived memo of the last `listReels()` snapshot so reels() + books() agree. */
  private lastList: { at: number; rows: WorkerReel[] } | null = null;

  constructor(private base: string) {
    try { this.token = sessionStorage.getItem('sb_session_token') ?? ''; } catch { this.token = ''; }
    this.loadMeta();
  }

  private loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, ReelMeta>;
      for (const [id, m] of Object.entries(parsed)) if (m && typeof m === 'object') this.reelMeta.set(id, m);
    } catch { /* private mode / corrupt: start empty */ }
  }
  private saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(Object.fromEntries(this.reelMeta))); }
    catch { /* private mode: metadata lives for this session only */ }
  }

  /** Cached server reel list (~1s) shared by reels() and books() so they see the same snapshot. */
  private async getList(): Promise<WorkerReel[]> {
    if (this.lastList && Date.now() - this.lastList.at < 1000) return this.lastList.rows;
    const rows = await this.listReels();
    this.lastList = { at: Date.now(), rows };
    return rows;
  }
  private invalidateList() { this.lastList = null; }

  // ---- consent (per-kid parent affirmation, design §5) ----
  // Cached in sessionStorage so repeat sheets reuse the same consent instead of
  // spamming new rows for one upload session.
  async createConsent(parentName: string, othersConsented: boolean, kidId = this.kidId): Promise<{ consent_id: string }> {
    const cacheKey = 'sb.consentId.' + kidId;
    try { const cached = sessionStorage.getItem(cacheKey); if (cached) return { consent_id: cached }; } catch { /* private */ }
    const out = await this.req<{ consent_id: string }>('/api/consent', {
      method: 'POST', body: JSON.stringify({ kid_id: kidId, parent_name: parentName, others_consented: othersConsented }),
    });
    try { sessionStorage.setItem(cacheKey, out.consent_id); } catch { /* private */ }
    return out;
  }
  private token = '';
  private persistToken(token: string) {
    this.token = token;
    try {
      if (token) sessionStorage.setItem('sb_session_token', token);
      else sessionStorage.removeItem('sb_session_token');
    } catch { /* private mode */ }
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    const res = await fetch(this.base + path, {
      credentials: 'include',
      ...init,
      headers,
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new WorkerError(res.status, (body as { error?: string } | null)?.error ?? 'request_failed', body);
    return body as T;
  }

  // ---- auth (invite-code only, design §4) ----
  async invite(code: string, email: string) {
    const out = await this.req<{ user_id: string; is_admin: boolean; session_token?: string }>('/api/auth/invite', {
      method: 'POST', body: JSON.stringify({ code, email }),
    });
    if (out.session_token) this.persistToken(out.session_token);
    return out;
  }
  async me() { return this.req<{ user_id: string; is_admin: boolean }>('/api/auth/me'); }
  /** Provider flags from the Worker (used for honest HD/motion gating; never fakes availability). */
  async health() {
    return this.req<{
      ok: boolean; build: string;
      flags: { openrouter: boolean; fal: boolean; kill: boolean; ffmpeg: boolean | null };
      sweep?: { interval_ms: number; tmp_max_age_ms: number };
    }>('/api/health');
  }
  async logout() { await this.req('/api/auth/logout', { method: 'POST' }); this.persistToken(''); }

  async init(): Promise<Household> {
    try { await this.me(); } catch (e) {
      if (e instanceof WorkerError && e.status === 401) throw new Error('worker_session_required: sign in with an invite code first');
      throw e;
    }
    return this.household();
  }

  async household(): Promise<Household> {
    const { kids } = await this.req<{ kids: WorkerKid[] }>('/api/kids');
    let kid = kids[0];
    if (!kid) {
      const created = await this.req<{ kid_id: string }>('/api/kids', {
        method: 'POST', body: JSON.stringify({ display_name: 'Mira' }),
      });
      kid = { id: created.kid_id, display_name: 'Mira', has_sheet: false };
    }
    this.kidId = kid.id; this.kidName = kid.display_name;
    const characterId = kid.has_sheet ? `sheet:${kid.id}` : `pending:${kid.id}`;
    return {
      id: kid.id,
      kid: { id: kid.id, display_name: kid.display_name, age_band: '4-6' },
      character: { id: characterId, kid_id: kid.id, look: { ...DEFAULT_LOOK } },
      settings: { ...SETTINGS_DEFAULTS },
    };
  }

  // ---- photos + character sheets (design §5) ----
  async uploadPhoto(file: File): Promise<{ photo_id: string }> {
    const form = new FormData(); form.set('photo', file);
    return this.req<{ photo_id: string }>('/api/photos', { method: 'POST', body: form });
  }

  async requestCharacterSheet(photoId: string, consentId: string, kidId = this.kidId): Promise<{ job_id: string }> {
    return this.req<{ job_id: string }>(`/api/kids/${kidId}/character_sheet`, {
      method: 'POST', body: JSON.stringify({ photo_id: photoId, consent_id: consentId }),
    });
  }

  /** Polls a job until it is done/failed or the deadline passes. `onTick` streams progress to the UI. */
  async pollJob(jobId: string, { timeoutMs = 120_000, intervalMs = 1000, onTick }: { timeoutMs?: number; intervalMs?: number; onTick?: (job: JobRow) => void } = {}): Promise<JobRow> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.req<JobRow>(`/api/jobs/${jobId}`);
      onTick?.(job);
      if (job.status === 'done' || job.status === 'failed') return job;
      if (Date.now() > deadline) throw new Error(`job_timeout:${jobId}`);
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  /** Latest character-sheet row for a kid; `sheet_url` is a signed 1h URL when a blob is stored. */
  async characterSheet(kidId = this.kidId): Promise<{ version: number; sheet_url: string | null; updated_at: string | null }> {
    return this.req<{ version: number; sheet_url: string | null; updated_at: string | null }>(`/api/kids/${kidId}/character_sheet`);
  }

  // ---- reels ----
  async listReels(): Promise<WorkerReel[]> {
    const { reels } = await this.req<{ reels: WorkerReel[] }>('/api/reels');
    return reels;
  }
  async getReel(id: string) {
    return this.req<{
      id: string; status: string; tier: string; template_id?: string | null;
      shots: { index: number; caption: string; edited?: boolean; keyframe_url?: string | null; video_url?: string | null }[];
    }>(`/api/reels/${id}`);
  }
  async generateReel(story: string, tier: 'free' | 'paid' | 'hd', kidId = this.kidId) {
    return this.req<{ reel_id: string; job_id: string }>('/api/reels', {
      method: 'POST', body: JSON.stringify({ kid_id: kidId, story, tier }),
    });
  }

  // ---- catalog (R.1): public browse feed + detail, admin-editable server-side ----
  /** Enabled catalog templates. Anything without a cover falls back to a bundled placeholder. */
  async catalog(): Promise<CatalogTemplate[]> {
    const { templates } = await this.req<{ templates: RowTemplate[] }>('/api/catalog');
    const rows = templates.map(toCatalogTemplate);
    for (const row of rows) this.catalogRows.set(row.id, row);
    return rows;
  }
  async catalogDetail(id: string): Promise<{ template: CatalogTemplate; shots: CatalogShot[] }> {
    const out = await this.req<{ template: RowTemplate; shots: CatalogShot[] }>(`/api/catalog/${encodeURIComponent(id)}`);
    return { template: toCatalogTemplate(out.template), shots: out.shots ?? [] };
  }

  /** Cached catalog row for a template id — module seed first, else a live fetch. */
  private async resolveTemplate(templateId: string): Promise<Template | undefined> {
    const local = templateById(templateId);
    if (local) return local;
    const row = this.catalogRows.get(templateId);
    if (row) return templateFromCatalog(row);
    try {
      const detail = await this.catalogDetail(templateId);
      this.catalogRows.set(templateId, detail.template);
      return templateFromCatalog(detail.template);
    } catch {
      return undefined;
    }
  }

  /**
   * Every catalog row the server knows about, seeded into the local row cache.
   * Fetched at most once per session (review #2/#13); unknown ids still fall back
   * to a per-id `catalogDetail` in resolveTemplate().
   */
  private async loadCatalogRows(): Promise<void> {
    if (this.catalogRowsLoaded) return;
    this.catalogRowsLoaded = true;
    try {
      for (const row of await this.catalog()) this.catalogRows.set(row.id, row);
    } catch { this.catalogRowsLoaded = false; /* offline: retry on a later call */ }
  }

  /**
   * Generates a reel from a catalog template (R.1.4). The Worker owns the
   * template's title and shot prompts; `story` is only sent on the legacy path.
   */
  async generateFromTemplate(templateId: string, tier: 'free' | 'paid' | 'hd', kidId = this.kidId, useSheet = true) {
    const out = await this.req<{ reel_id: string; job_id: string }>('/api/reels', {
      method: 'POST',
      body: JSON.stringify({ kid_id: kidId, template_id: templateId, tier, use_sheet: useSheet }),
    });
    // Remember which catalog template this reel came from so books()/title() work
    // even before the server row is visible to the client.
    const t = await this.resolveTemplate(templateId);
    this.reelMeta.set(out.reel_id, {
      template_id: templateId,
      state: { ...(t?.default_state ?? { scene: '', outfit: '', co_star: 'nibbs', text: '' }) },
      version: 1,
    });
    this.saveMeta();
    this.invalidateList();
    this.emit();
    return out;
  }

  /**
   * Hydrates template/state metadata from the Worker's persisted `template_id`
   * (catalog path). Runs on every `reels()` for rows still missing meta, so a
   * reel that lands later (another tab, a background job completing) still gets a
   * book — the empty/partial first load no longer freezes hydration (review #3).
   * A reel is only marked hydrated once its row is known; a transient failure
   * leaves it eligible for a retry on the next call.
   */
  private async hydrateCatalogTemplates(rows: WorkerReel[]): Promise<void> {
    const targets = rows
      .filter(r => !this.reelMeta.has(r.id) && !this.hydratedReels.has(r.id))
      .slice(0, 10);
    if (targets.length === 0) return;
    await Promise.all(targets.map(async (r) => {
      let reel: Awaited<ReturnType<WorkerApi['getReel']>>;
      try { reel = await this.getReel(r.id); }
      catch { return; /* transient: retry on the next reels() call */ }
      this.hydratedReels.add(r.id);
      const templateId = reel.template_id;
      if (!templateId) return;
      const t = await this.resolveTemplate(templateId);
      this.reelMeta.set(r.id, {
        template_id: templateId,
        state: { ...(t?.default_state ?? { scene: '', outfit: '', co_star: 'nibbs', text: '' }) },
        version: 1,
      });
    }));
    this.saveMeta();
  }

  // ---- per-page book text (R.5): client localStorage + server override ----
  /** Saves page text locally (always) and to the server override (best effort). */
  async saveBookPageText(reelId: string, bookId: string, index: number, text: string): Promise<{ saved: boolean; server: boolean }> {
    saveBookPage(bookId, index, text);
    try {
      await this.req(`/api/reels/${encodeURIComponent(reelId)}/pages/${index}`, {
        method: 'PATCH', body: JSON.stringify({ text }),
      });
      return { saved: true, server: true };
    } catch {
      // Offline / server rejected: the local copy still holds the edit.
      return { saved: true, server: false };
    }
  }
  /** Reverts a page to the template text (clears both copies). */
  async resetBookPage(reelId: string, bookId: string, index: number): Promise<{ ok: boolean }> {
    clearBookPage(bookId, index);
    try { await this.req(`/api/reels/${encodeURIComponent(reelId)}/pages/${index}`, { method: 'DELETE' }); }
    catch { /* server copy may not exist; local reset already applied */ }
    return { ok: true };
  }

  // ---- admin catalog (R.2, requireAdmin server-side) ----
  async adminTemplates(): Promise<CatalogTemplate[]> {
    const { templates } = await this.req<{ templates: RowTemplate[] }>('/api/admin/templates');
    return templates.map(toCatalogTemplate);
  }
  /** One template plus its per-shot prompts, for the admin editor (A-03). */
  async adminTemplateDetail(id: string): Promise<{ template: CatalogTemplate; shots: CatalogShot[] }> {
    const out = await this.req<{ template: RowTemplate; shots: CatalogShot[] }>(
      `/api/admin/templates/${encodeURIComponent(id)}`,
    );
    return { template: toCatalogTemplate(out.template), shots: out.shots ?? [] };
  }
  async adminCreateTemplate(patch: Partial<CatalogTemplate> & { title: string }) {
    return this.req<{ template: RowTemplate }>('/api/admin/templates', {
      method: 'POST', body: JSON.stringify(patch),
    });
  }
  /**
   * Partial template update. `scene_prompts` carries per-shot prompt edits and is
   * sent as-is; the Worker upserts them keyed by (template_id, index).
   */
  async adminUpdateTemplate(
    id: string,
    patch: Partial<CatalogTemplate> & { scene_prompts?: { index: number; caption_prompt?: string; keyframe_prompt?: string | null }[] },
  ) {
    return this.req<{ template: RowTemplate }>(`/api/admin/templates/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    });
  }
  async adminDeleteTemplate(id: string) {
    return this.req<{ ok: boolean }>(`/api/admin/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  private mapStatus(status: string): Reel['status'] {
    if (status === 'done') return 'ready';
    if (status === 'running') return 'rendering';
    if (status === 'failed') return 'failed';
    return 'queued';
  }

  // ---- DataApi surface ----
  async templates(): Promise<Template[]> { return CATALOG_TEMPLATES; }
  async reels(): Promise<Reel[]> {
    const rows = await this.getList();
    // Drop metadata for reels the server no longer returns (deleted elsewhere/other device).
    const live = new Set(rows.map(r => r.id));
    let pruned = false;
    for (const id of [...this.reelMeta.keys()]) if (!live.has(id)) { this.reelMeta.delete(id); pruned = true; }
    for (const id of [...this.hydratedReels]) if (!live.has(id)) this.hydratedReels.delete(id);
    if (pruned) this.saveMeta();
    // Learn template_id for catalog-created reels the Worker persisted. Runs while
    // any row is still un-hydrated (not a one-shot process memo) so later reels
    // are not silently skipped.
    await this.hydrateCatalogTemplates(rows);
    return rows.map(r => this.toReel(r));
  }
  private toReel(r: WorkerReel): Reel {
    const iso = new Date(r.created_at).toISOString();
    const meta = this.reelMeta.get(r.id);
    return {
      id: r.id,
      template_id: meta?.template_id ?? '',
      state: meta ? { ...meta.state } : { scene: '', outfit: '', co_star: 'nibbs', text: '' },
      version: meta?.version ?? 1,
      status: this.mapStatus(r.status), video_url: null,
      loved: this.loved.get(r.id) ?? false, saved: this.saved.get(r.id) ?? false,
      created_at: iso, updated_at: iso,
    };
  }
  async reelVersions(id: string): Promise<ReelVersion[]> {
    const r = (await this.reels()).find(x => x.id === id);
    if (!r) return [];
    return [{ id: `${id}:${r.version}`, reel_id: id, version: r.version, state: r.state, state_hash: '', status: r.status, created_at: r.created_at }];
  }
  async jobs() { return this.lastJobs; }
  /**
   * Books derived from the cached server reel list + local metadata. Catalog rows
   * are resolved live (seeds first, then the operator's catalog) so an
   * admin-added template produces a book instead of being silently skipped (#2).
   */
  async books(): Promise<Book[]> {
    const rows = await this.getList();
    // Make sure template bindings are loaded even if books() runs before reels().
    await this.hydrateCatalogTemplates(rows);
    // Anything the local snapshot doesn't know about (admin-added rows) needs the
    // server catalog. Fetch it once per session; if it is unavailable, fall
    // through to the local seeds so placeholder books keep working offline.
    if (rows.some(r => this.reelMeta.get(r.id) && !templateById(this.reelMeta.get(r.id)!.template_id))) {
      await this.loadCatalogRows();
    }
    const out: Book[] = [];
    for (const r of rows) {
      const meta = this.reelMeta.get(r.id);
      if (!meta) continue; // unknown source (e.g. created on another device) → don't invent a book
      const t = await this.resolveTemplate(meta.template_id);
      if (!t) continue;
      const book: Book = {
        id: `book:${r.id}`,
        reel_id: r.id,
        title: fill(t.book_title, this.kidName || 'Mira'),
        pages: bookPages(t, this.kidName || 'Mira', meta.state),
      };
      out.push(book);
    }
    // rows() already arrive newest-first (server ORDER BY created_at DESC), matching Feed order.
    return out;
  }
  async setLoved(id: string, v: boolean) { this.loved.set(id, v); this.emit(); }
  async setSaved(id: string, v: boolean) { this.saved.set(id, v); }
  async remake(id: string, state: ReelState) {
    const prev = this.reelMeta.get(id);
    const t = prev ? templateById(prev.template_id) : undefined;
    // Align the Worker's `story` with the edited line where possible (non-breaking).
    const { reel_id, job_id } = await this.generateReel(state.text || t?.title || 'A new adventure', 'free');
    const version = (prev?.version ?? 1) + 1;
    const target = reel_id || id;
    this.reelMeta.set(target, {
      template_id: prev?.template_id ?? t?.id ?? '',
      state: { ...state },
      version,
    });
    this.saveMeta();
    this.invalidateList();
    this.emit();
    return { reel_id: target, version, job_id };
  }
  async createReel(templateId: string) {
    const t = templateById(templateId);
    const { reel_id, job_id } = await this.generateReel(t?.title ?? 'A new adventure', 'free');
    if (reel_id) {
      this.reelMeta.set(reel_id, { template_id: templateId, state: { ...(t?.default_state ?? { scene: '', outfit: '', co_star: 'nibbs', text: '' }) }, version: 1 });
      this.saveMeta();
    }
    this.invalidateList();
    this.emit();
    return { reel_id, version: 1, job_id };
  }
  async videoBlob(_url: string) { return null; }
  async consents() { return this.consentList; }
  async setConsent(kind: ConsentKind, granted: boolean) {
    // The Worker consent endpoint records per-kid parent affirmations (name typed), not per-kind
    // toggles. Only the create consent is persisted there; the rest stay client-side for now.
    // Route through createConsent so the sessionStorage cache is authoritative — a raw POST here
    // would double-post /api/consent (e.g. PhotoLikenessCard ran first, Grownups toggles later).
    if (kind === 'create' && granted && this.kidId) {
      await this.createConsent(this.kidName || 'Parent', false);
    }
    const c = this.consentList.find(c => c.kind === kind);
    const next = { kind, granted, updated_at: new Date().toISOString() };
    if (c) Object.assign(c, next); else this.consentList.push(next);
  }
  async queuePublish(reelId: string, caption: string): Promise<PublishItem> {
    const p: PublishItem = { id: crypto.randomUUID(), reel_id: reelId, reel_version_id: `${reelId}:1`, platform: 'instagram', caption: caption.slice(0, 2200), status: 'draft', created_at: new Date().toISOString() };
    this.publish.push(p); return p;
  }
  async publishQueue() { return [...this.publish].reverse(); }
  async cancelPublish(id: string) { const p = this.publish.find(p => p.id === id); if (p && p.status === 'draft') p.status = 'cancelled'; }
  async updateKid(name: string) { this.kidName = name; }
  async updateLook(_look: Look) { /* no Worker endpoint for the trait avatar yet */ }
  async updateSettings(_p: Partial<Settings>) { /* settings live server-side in a later milestone */ }
  async deleteAll() {
    if (this.kidId) await this.req(`/api/kids/${this.kidId}/forget`, { method: 'POST' });
    this.loved.clear(); this.saved.clear(); this.publish = [];
  }
  onReels(cb: (r: Reel[]) => void) {
    this.subs.add(cb);
    const t = setInterval(() => { this.invalidateList(); this.reels().then(r => { if (r.some(x => x.status === 'queued' || x.status === 'rendering')) cb(r); }).catch(() => {}); }, 8000);
    return () => { clearInterval(t); this.subs.delete(cb); };
  }
  private emit() { this.reels().then(r => this.subs.forEach(cb => cb(r))).catch(() => {}); }
}
