import { DEFAULT_LOOK, type Look } from '../mascot';
import { SETTINGS_DEFAULTS, CONSENT_DEFAULTS } from './local';
import { TEMPLATES } from './seed';
import type { Consent, ConsentKind, DataApi, Household, PublishItem, Reel, ReelState, ReelVersion, RenderJob, Settings } from './types';

/** Error carrying the Worker's HTTP status + error code so the UI can map 402/429/401 to modals. */
export class WorkerError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail?: unknown) {
    super(code);
    this.name = 'WorkerError';
  }
}

type JobRow = { id: string; type: string; status: string; progress: number; error?: string };

/** A kid as the Worker returns it (docs/ai-backend/BUDGET-SECURITY-DESIGN.md §6). */
type WorkerKid = { id: string; display_name: string; has_sheet: boolean };
type WorkerReel = { id: string; status: string; tier: string; created_at: number };

/**
 * Cloudflare Worker backend (worker/). Activated when VITE_API_URL is baked in at build time.
 * Thin bridge for this milestone: auth, kids, photos, character sheets, reels and job polling are
 * worker-backed; the template/book/render-job surface has no Worker equivalent yet and degrades
 * to static templates + in-memory state so views still load.
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

  constructor(private base: string) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.base + path, {
      credentials: 'include',
      ...init,
      headers: { ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new WorkerError(res.status, (body as { error?: string } | null)?.error ?? 'request_failed', body);
    return body as T;
  }

  // ---- auth (invite-code only, design §4) ----
  async invite(code: string, email: string) {
    return this.req<{ user_id: string; is_admin: boolean }>('/api/auth/invite', {
      method: 'POST', body: JSON.stringify({ code, email }),
    });
  }
  async me() { return this.req<{ user_id: string; is_admin: boolean }>('/api/auth/me'); }
  async logout() { await this.req('/api/auth/logout', { method: 'POST' }); }

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

  /** Polls a job until it is done/failed or the deadline passes. */
  async pollJob(jobId: string, { timeoutMs = 120_000, intervalMs = 1000 } = {}): Promise<JobRow> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.req<JobRow>(`/api/jobs/${jobId}`);
      if (job.status === 'done' || job.status === 'failed') return job;
      if (Date.now() > deadline) throw new Error(`job_timeout:${jobId}`);
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  // ---- reels ----
  async listReels(): Promise<WorkerReel[]> {
    const { reels } = await this.req<{ reels: WorkerReel[] }>('/api/reels');
    return reels;
  }
  async getReel(id: string) {
    return this.req<{ id: string; status: string; tier: string; shots: { index: number; caption: string }[] }>(`/api/reels/${id}`);
  }
  async generateReel(story: string, tier: 'free' | 'paid' | 'hd', kidId = this.kidId) {
    return this.req<{ reel_id: string; job_id: string }>('/api/reels', {
      method: 'POST', body: JSON.stringify({ kid_id: kidId, story, tier }),
    });
  }

  private mapStatus(status: string): Reel['status'] {
    if (status === 'done') return 'ready';
    if (status === 'running') return 'rendering';
    if (status === 'failed') return 'failed';
    return 'queued';
  }

  // ---- DataApi surface ----
  async templates() { return TEMPLATES; }
  async reels(): Promise<Reel[]> {
    const rows = await this.listReels();
    return rows.map(r => this.toReel(r));
  }
  private toReel(r: WorkerReel): Reel {
    const iso = new Date(r.created_at).toISOString();
    return {
      id: r.id, template_id: '', state: { scene: '', outfit: '', co_star: 'nibbs', text: '' },
      version: 1, status: this.mapStatus(r.status), video_url: null,
      loved: this.loved.get(r.id) ?? false, saved: this.saved.get(r.id) ?? false,
      created_at: iso, updated_at: iso,
    };
  }
  async reelVersions(id: string): Promise<ReelVersion[]> {
    const r = (await this.reels()).find(x => x.id === id);
    if (!r) return [];
    return [{ id: `${id}:1`, reel_id: id, version: 1, state: r.state, state_hash: '', status: r.status, created_at: r.created_at }];
  }
  async jobs() { return this.lastJobs; }
  async books() { return []; }
  async setLoved(id: string, v: boolean) { this.loved.set(id, v); this.emit(); }
  async setSaved(id: string, v: boolean) { this.saved.set(id, v); }
  async remake(id: string, state: ReelState) {
    const { reel_id, job_id } = await this.generateReel(state.text || 'A new adventure', 'free');
    return { reel_id: reel_id || id, version: 2, job_id };
  }
  async createReel(templateId: string) {
    const t = TEMPLATES.find(t => t.id === templateId);
    const { reel_id, job_id } = await this.generateReel(t?.title ?? 'A new adventure', 'free');
    return { reel_id, version: 1, job_id };
  }
  async videoBlob(_url: string) { return null; }
  async consents() { return this.consentList; }
  async setConsent(kind: ConsentKind, granted: boolean) {
    // The Worker consent endpoint records per-kid parent affirmations (name typed), not per-kind
    // toggles. Only the create consent is persisted there; the rest stay client-side for now.
    if (kind === 'create' && granted && this.kidId) {
      await this.req('/api/consent', { method: 'POST', body: JSON.stringify({ kid_id: this.kidId, parent_name: this.kidName || 'Parent', others_consented: false }) });
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
    const t = setInterval(() => { this.reels().then(r => { if (r.some(x => x.status === 'queued' || x.status === 'rendering')) cb(r); }).catch(() => {}); }, 8000);
    return () => { clearInterval(t); this.subs.delete(cb); };
  }
  private emit() { this.reels().then(r => this.subs.forEach(cb => cb(r))).catch(() => {}); }
}
