import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Look } from '../mascot';
import { SETTINGS_DEFAULTS, validateState } from './local';
import type { Book, Consent, ConsentKind, DataApi, Household, PublishItem, Reel, ReelState, ReelVersion, RenderJob, Settings, Template } from './types';

/** Real backend: Supabase Postgres + anonymous Auth + RLS (household-scoped). */
export class SupabaseApi implements DataApi {
  readonly mode = 'supabase' as const;
  readonly sb: SupabaseClient;
  private hid = '';
  private kidId = '';
  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'starringme.auth' } });
  }
  private must<T>(r: { data: T | null; error: { message: string } | null }): NonNullable<T> {
    if (r.error) throw new Error(r.error.message);
    return r.data as NonNullable<T>;
  }
  async init() {
    const { data: s } = await this.sb.auth.getSession();
    if (!s.session) this.must(await this.sb.auth.signInAnonymously());
    this.hid = this.must(await this.sb.rpc('bootstrap_household', { p_kid_name: 'Mira' })) as string;
    return this.household();
  }
  async household(): Promise<Household> {
    const kid: Household['kid'] = this.must(await this.sb.from('kids').select('id,display_name,age_band').eq('household_id', this.hid).order('created_at').limit(1).single()) as Household['kid'];
    this.kidId = kid.id;
    const ch: Household['character'] = this.must(await this.sb.from('characters').select('id,kid_id,look').eq('kid_id', kid.id).order('created_at').limit(1).single()) as Household['character'];
    const st = (await this.sb.from('settings').select('*').eq('household_id', this.hid).maybeSingle()).data;
    const settings: Settings = { ...SETTINGS_DEFAULTS, ...(st ?? {}), bedtime_after: (st?.bedtime_after ?? SETTINGS_DEFAULTS.bedtime_after).slice(0, 5) };
    return { id: this.hid, kid, character: ch, settings };
  }
  async templates() { return this.must(await this.sb.from('templates').select('*').order('sort')) as Template[]; }
  async reels() { return this.must(await this.sb.from('reels').select('id,template_id,state,version,status,video_url,loved,saved,created_at,updated_at').order('created_at').order('id')) as Reel[]; }
  async reelVersions(id: string) { return this.must(await this.sb.from('reel_versions').select('id,reel_id,version,state,state_hash,status,created_at').eq('reel_id', id).order('version')) as ReelVersion[]; }
  async jobs() { return this.must(await this.sb.from('render_jobs').select('id,reel_id,reel_version_id,status,attempts,created_at').order('created_at')) as RenderJob[]; }
  async books() { return this.must(await this.sb.from('books').select('id,reel_id,title,pages').order('created_at')) as Book[]; }
  async setLoved(id: string, v: boolean) { this.must(await this.sb.from('reels').update({ loved: v }).eq('id', id)); }
  async setSaved(id: string, v: boolean) { this.must(await this.sb.from('reels').update({ saved: v }).eq('id', id)); }
  async remake(id: string, state: ReelState) {
    validateState(state);
    return this.must(await this.sb.rpc('remake_reel', { p_reel: id, p_state: state })) as { reel_id: string; version: number; job_id: string };
  }
  async createReel(templateId: string) { return this.must(await this.sb.rpc('create_reel', { p_template: templateId })) as { reel_id: string; version: number; job_id: string }; }
  async videoBlob(_url: string) { return null; }
  async consents() { return this.must(await this.sb.from('consents').select('kind,granted,updated_at').eq('household_id', this.hid)) as Consent[]; }
  async setConsent(kind: ConsentKind, granted: boolean) {
    this.must(await this.sb.from('consents').upsert({ household_id: this.hid, kind, granted, method: 'parent_gate', updated_at: new Date().toISOString() }, { onConflict: 'household_id,kind' }));
  }
  async queuePublish(reelId: string, caption: string) {
    const id = this.must(await this.sb.rpc('queue_publish', { p_reel: reelId, p_caption: caption })) as string;
    return this.must(await this.sb.from('publish_queue').select('id,reel_id,reel_version_id,platform,caption,status,created_at').eq('id', id).single()) as PublishItem;
  }
  async publishQueue() { return this.must(await this.sb.from('publish_queue').select('id,reel_id,reel_version_id,platform,caption,status,created_at').order('created_at', { ascending: false })) as PublishItem[]; }
  async cancelPublish(id: string) { this.must(await this.sb.from('publish_queue').update({ status: 'cancelled' }).eq('id', id).eq('status', 'draft')); }
  async updateKid(name: string) { this.must(await this.sb.rpc('rename_kid', { p_kid: this.kidId, p_name: name })); }
  async updateLook(look: Look) { this.must(await this.sb.from('characters').update({ look }).eq('kid_id', this.kidId)); }
  async updateSettings(p: Partial<Settings>) { this.must(await this.sb.from('settings').update(p).eq('household_id', this.hid)); }
  async deleteAll() { this.must(await this.sb.rpc('delete_my_household')); await this.sb.auth.signOut(); }
  onReels(cb: (r: Reel[]) => void) {
    const refresh = () => { this.reels().then(cb).catch(() => {}); };
    const ch = this.sb.channel('reels-' + this.hid).on('postgres_changes', { event: '*', schema: 'public', table: 'reels', filter: `household_id=eq.${this.hid}` }, refresh).subscribe();
    // Poll as a backstop while anything is queued/rendering (realtime can drop on iOS when backgrounded).
    const t = setInterval(() => { this.reels().then(r => { if (r.some(x => x.status === 'queued' || x.status === 'rendering')) cb(r); }).catch(() => {}); }, 8000);
    return () => { clearInterval(t); this.sb.removeChannel(ch); };
  }
}
