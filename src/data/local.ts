import { DEFAULT_LOOK, type Look } from '../mascot';
import { TEMPLATES, DEFAULT_KID, bookPages, fill, stateHash } from './seed';
import { MAX_TEXT, STATE_KEYS, type Book, type Consent, type ConsentKind, type DataApi, type Household, type PublishItem, type Reel, type ReelState, type ReelVersion, type RenderJob, type Settings } from './types';

import { kv } from './idb';
/** v1 backend: IndexedDB on the device (household-only, nothing leaves the phone). Used when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing.
 *  Mirrors the SQL RPCs in supabase/migrations (bootstrap_household, remake_reel, queue_publish) so Supabase can swap in later. */
interface DB { household: Household; reels: Reel[]; versions: ReelVersion[]; jobs: RenderJob[]; books: Book[]; consents: Consent[]; publish: PublishItem[] }
const KEY = 'db.v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const now = () => new Date().toISOString();
export const CONSENT_DEFAULTS: Record<ConsentKind, boolean> = { create: true, family_share: false, ai_training: false, marketing: false, publish_social: false };
export const SETTINGS_DEFAULTS: Settings = { reels_per_day: 6, bedtime_after: '19:30', autoplay: false, bedtime_mode: false, remake_enabled: true };

export function validateState(s: ReelState) {
  const keys = Object.keys(s);
  if (keys.some(k => !(STATE_KEYS as readonly string[]).includes(k))) throw new Error('invalid state key');
  if ((s.text ?? '').length > MAX_TEXT) throw new Error('text too long');
}

export class LocalApi implements DataApi {
  readonly mode = 'local' as const;
  private subs = new Set<(r: Reel[]) => void>();
  private mem: DB | null = null;
  private save(db: DB) { this.mem = db; return kv.set(KEY, db); }
  private db(): DB { if (!this.mem) throw new Error('not initialised'); return this.mem; }
  private async mut<T>(f: (d: DB) => T): Promise<T> { const d = this.db(); const r = f(d); await this.save(d); return r; }
  private emit() { const r = [...this.db().reels]; this.subs.forEach(cb => cb(r)); }

  async init() {
    const existing = this.mem ?? (await kv.get<DB>(KEY));
    if (existing) { // merge defaults added later; un-wedge jobs interrupted by a reload
      for (const k of Object.keys(CONSENT_DEFAULTS) as ConsentKind[]) if (!existing.consents.find(c => c.kind === k)) existing.consents.push({ kind: k, granted: CONSENT_DEFAULTS[k], updated_at: now() });
      existing.household.settings = { ...SETTINGS_DEFAULTS, ...existing.household.settings };
      for (const j of existing.jobs) if (j.status === 'rendering') { j.status = 'queued'; const r = existing.reels.find(r => r.id === j.reel_id); if (r && r.status === 'rendering') r.status = 'queued'; }
      this.mem = existing; await this.save(existing); return existing.household;
    }
    const kid = { id: uid(), display_name: DEFAULT_KID, age_band: '4-6' };
    const household: Household = { id: uid(), kid, character: { id: uid(), kid_id: kid.id, look: { ...DEFAULT_LOOK } }, settings: { ...SETTINGS_DEFAULTS } };
    const db: DB = { household, reels: [], versions: [], jobs: [], books: [], publish: [],
      consents: (Object.keys(CONSENT_DEFAULTS) as ConsentKind[]).map(kind => ({ kind, granted: CONSENT_DEFAULTS[kind], updated_at: now() })) };
    for (const t of TEMPLATES) {
      const r: Reel = { id: uid(), template_id: t.id, state: { ...t.default_state }, version: 1, status: 'ready', video_url: t.video, loved: false, saved: false, created_at: now(), updated_at: now() };
      db.reels.push(r);
      db.versions.push({ id: uid(), reel_id: r.id, version: 1, state: r.state, state_hash: await stateHash(r.state), status: 'ready', created_at: now() });
      db.books.push({ id: uid(), reel_id: r.id, title: fill(t.book_title, kid.display_name), pages: bookPages(t, kid.display_name, r.state) });
    }
    await this.save(db);
    return household;
  }
  async household() { return this.db().household; }
  async templates() { return TEMPLATES; }
  async reels() { return this.db().reels; }
  async reelVersions(id: string) { return this.db().versions.filter(v => v.reel_id === id).sort((a, b) => a.version - b.version); }
  async jobs() { return this.db().jobs; }
  async books() { return this.db().books; }
  async setLoved(id: string, v: boolean) { await this.mut(d => { const r = d.reels.find(x => x.id === id); if (r) r.loved = v; }); this.emit(); }
  async setSaved(id: string, v: boolean) { await this.mut(d => { const r = d.reels.find(x => x.id === id); if (r) r.saved = v; }); this.emit(); }
  async remake(id: string, state: ReelState) {
    validateState(state);
    const hash = await stateHash(state);
    const res = await this.mut(d => {
      if (!d.consents.find(c => c.kind === 'create')?.granted) throw new Error('consent required: create');
      const r = d.reels.find(x => x.id === id); if (!r) throw new Error('reel not found');
      r.version += 1; r.state = { ...state }; r.status = 'queued'; r.video_url = null; r.updated_at = now();
      const v: ReelVersion = { id: uid(), reel_id: id, version: r.version, state: r.state, state_hash: hash, status: 'queued', created_at: now() };
      const j: RenderJob = { id: uid(), reel_id: id, reel_version_id: v.id, status: 'queued', attempts: 0, created_at: now() };
      d.versions.push(v); d.jobs.push(j);
      const t = TEMPLATES.find(t => t.id === r.template_id)!; const b = d.books.find(b => b.reel_id === id);
      if (b) b.pages = bookPages(t, d.household.kid.display_name, r.state);
      return { reel_id: id, version: r.version, job_id: j.id };
    });
    this.emit(); return res;
  }
  async consents() { return this.db().consents; }
  async setConsent(kind: ConsentKind, granted: boolean) { await this.mut(d => { const c = d.consents.find(c => c.kind === kind); if (c) { c.granted = granted; c.updated_at = now(); } else d.consents.push({ kind, granted, updated_at: now() }); }); }
  async queuePublish(reelId: string, caption: string) {
    return await this.mut(d => {
      const r = d.reels.find(x => x.id === reelId); if (!r) throw new Error('reel not found');
      const v = d.versions.find(v => v.reel_id === reelId && v.version === r.version)!;
      const p: PublishItem = { id: uid(), reel_id: reelId, reel_version_id: v.id, platform: 'instagram', caption: caption.slice(0, 2200), status: 'draft', created_at: now() };
      d.publish.push(p); return p;
    });
  }
  async publishQueue() { return [...this.db().publish].reverse(); }
  async cancelPublish(id: string) { await this.mut(d => { const p = d.publish.find(p => p.id === id); if (p && p.status === 'draft') p.status = 'cancelled'; }); }
  async updateKid(name: string) { await this.mut(d => { d.household.kid.display_name = name; d.books.forEach(b => { const r = d.reels.find(r => r.id === b.reel_id); const t = r && TEMPLATES.find(t => t.id === r.template_id); if (r && t) { b.title = fill(t.book_title, name); b.pages = bookPages(t, name, r.state); } }); }); }
  async updateLook(look: Look) { await this.mut(d => { d.household.character.look = look; }); }
  async updateSettings(p: Partial<Settings>) { await this.mut(d => { d.household.settings = { ...d.household.settings, ...p }; }); }
  async deleteAll() { this.mem = null; await kv.clear(); }
  /** New reel from a template (status queued + render job): "generate reel". */
  async createReel(templateId: string) {
    const t = TEMPLATES.find(t => t.id === templateId); if (!t) throw new Error('template not found');
    const state = { ...t.default_state }; const hash = await stateHash(state);
    const res = await this.mut(d => {
      if (!d.consents.find(c => c.kind === 'create')?.granted) throw new Error('consent required: create');
      const r: Reel = { id: uid(), template_id: t.id, state, version: 1, status: 'queued', video_url: null, loved: false, saved: false, created_at: now(), updated_at: now() };
      const v: ReelVersion = { id: uid(), reel_id: r.id, version: 1, state, state_hash: hash, status: 'queued', created_at: now() };
      const j: RenderJob = { id: uid(), reel_id: r.id, reel_version_id: v.id, status: 'queued', attempts: 0, created_at: now() };
      d.reels.unshift(r); d.versions.push(v); d.jobs.push(j);
      d.books.push({ id: uid(), reel_id: r.id, title: fill(t.book_title, d.household.kid.display_name), pages: bookPages(t, d.household.kid.display_name, state) });
      return { reel_id: r.id, version: 1, job_id: j.id };
    });
    this.emit(); return res;
  }
  // ---- in-browser render worker hooks (milestone 3 server worker replaces these) ----
  async nextJob() { return this.mem?.jobs.find(j => j.status === 'queued') ?? null; }
  async jobContext(j: RenderJob) { const d = this.db(); const v = d.versions.find(v => v.id === j.reel_version_id)!; const r = d.reels.find(r => r.id === j.reel_id)!; return { version: v, reel: r, template: TEMPLATES.find(t => t.id === r.template_id)!, household: d.household }; }
  async markJob(id: string, status: RenderJob['status'], blob?: Blob, error?: string) {
    if (blob) await kv.set('video:' + id, { type: blob.type || 'video/mp4', buf: await blob.arrayBuffer() });
    await this.mut(d => {
      const j = d.jobs.find(j => j.id === id); if (!j) return; j.status = status; if (status === 'rendering') j.attempts += 1; if (error) (j as RenderJob & { error?: string }).error = error;
      const v = d.versions.find(v => v.id === j.reel_version_id); const r = d.reels.find(r => r.id === j.reel_id);
      const st = status === 'done' ? 'ready' : status === 'failed' ? 'failed' : status;
      if (v) v.status = st as ReelVersion['status'];
      if (r && v && r.version === v.version) { r.status = st as Reel['status']; if (status === 'done') r.video_url = 'idb:' + id; r.updated_at = now(); }
    });
    this.emit();
  }
  async videoBlob(url: string) {
    if (!url.startsWith('idb:')) return null;
    const v = await kv.get<{ type: string; buf: ArrayBuffer } | Blob>('video:' + url.slice(4)); if (!v) return null;
    return v instanceof Blob ? v : new Blob([v.buf], { type: v.type });
  }
  onReels(cb: (r: Reel[]) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
}
