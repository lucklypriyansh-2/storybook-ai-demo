import type { Look } from '../mascot';
export type Mode = 'day' | 'bedtime' | 'birthday';
export type ReelStatus = 'ready' | 'queued' | 'rendering' | 'failed';
export type ConsentKind = 'create' | 'family_share' | 'ai_training' | 'marketing' | 'publish_social';
export interface ReelState { scene: string; outfit: string; co_star: string; text: string }
export interface Template { id: string; title: string; mode: Mode; duration_s: number; cover: string; video: string; book_title: string; cliffhanger: string; script: string[]; default_state: ReelState; sort: number }
export interface Kid { id: string; display_name: string; age_band: string }
export interface Character { id: string; kid_id: string; look: Look }
export interface Reel { id: string; template_id: string; state: ReelState; version: number; status: ReelStatus; video_url: string | null; loved: boolean; saved: boolean; created_at: string; updated_at: string }
export interface ReelVersion { id: string; reel_id: string; version: number; state: ReelState; state_hash: string; status: ReelStatus; created_at: string }
export interface RenderJob { id: string; reel_id: string; reel_version_id: string; status: 'queued' | 'rendering' | 'done' | 'failed'; attempts: number; created_at: string }
export interface BookPage { text: string; image: string }
/**
 * Admin-curated catalog row (R.1.2). Every string here is PLACEHOLDER sample
 * content owned by this product — no licensed IP is imported.
 */
export interface CatalogTemplate {
  id: string; slug: string; title: string; cover: string | null; description: string;
  age_band: string; tier_default: string; page_count: number; enabled: boolean;
}
export interface CatalogShot { index: number; caption_prompt: string; keyframe_prompt: string | null }
export interface Book { id: string; reel_id: string | null; title: string; pages: BookPage[] }
export interface Consent { kind: ConsentKind; granted: boolean; updated_at: string }
export interface PublishItem { id: string; reel_id: string; reel_version_id: string; platform: 'instagram'; caption: string; status: 'draft' | 'approved' | 'posted' | 'failed' | 'cancelled'; created_at: string }
export interface Settings { reels_per_day: number; bedtime_after: string; autoplay: boolean; bedtime_mode: boolean; remake_enabled: boolean }
export interface Household { id: string; kid: Kid; character: Character; settings: Settings }
export interface RemakeResult { reel_id: string; version: number; job_id: string }

/** The backend contract. Implemented by Supabase (real), WorkerApi (Cloudflare Worker), and LocalApi (in-browser fallback). */
export interface DataApi {
  readonly mode: 'supabase' | 'local' | 'worker';
  init(): Promise<Household>;
  household(): Promise<Household>;
  templates(): Promise<Template[]>;
  reels(): Promise<Reel[]>;
  reelVersions(reelId: string): Promise<ReelVersion[]>;
  jobs(): Promise<RenderJob[]>;
  books(): Promise<Book[]>;
  setLoved(reelId: string, v: boolean): Promise<void>;
  setSaved(reelId: string, v: boolean): Promise<void>;
  remake(reelId: string, state: ReelState): Promise<RemakeResult>;
  createReel(templateId: string): Promise<RemakeResult>;
  /** Resolve a stored video (e.g. idb:<job>) to a Blob; null for plain URLs. */
  videoBlob(url: string): Promise<Blob | null>;
  consents(): Promise<Consent[]>;
  setConsent(kind: ConsentKind, granted: boolean): Promise<void>;
  queuePublish(reelId: string, caption: string): Promise<PublishItem>;
  publishQueue(): Promise<PublishItem[]>;
  cancelPublish(id: string): Promise<void>;
  updateKid(name: string): Promise<void>;
  updateLook(look: Look): Promise<void>;
  updateSettings(p: Partial<Settings>): Promise<void>;
  deleteAll(): Promise<void>;
  /** Called with fresh reels whenever a reel row changes (realtime or poll). Returns an unsubscribe. */
  onReels(cb: (r: Reel[]) => void): () => void;
}

export const SCENES: { id: string; label: string; image: string; template: string }[] = [
  { id: 'moon', label: 'Moon trip', image: 'reel-space.jpg', template: 'moon' },
  { id: 'ocean', label: 'Under the sea', image: 'reel-ocean.jpg', template: 'ocean' },
  { id: 'jungle', label: 'Dino jungle', image: 'reel-jungle.jpg', template: 'jungle' },
  { id: 'birthday', label: 'Birthday party', image: 'reel-birthday.jpg', template: 'birthday' },
  { id: 'bedtime', label: 'Cosy bedtime', image: 'spread-03-bedtime.jpg', template: 'bedtime-stars' },
];
export const OUTFITS = [['raincoat', '🧥 Raincoat'], ['astronaut', '👩‍🚀 Astronaut'], ['cape', '🦸 Cape'], ['party', '👗 Party']] as const;
export const COSTARS = [['nibbs', '🐉 Nibbs'], ['arjun', '👦 Arjun (brother)'], ['bruno', '🐶 Bruno']] as const;
export const OUTFIT_COLOR: Record<string, string> = { raincoat: '#FFC800', astronaut: '#F4F4FA', cape: '#3B3A9E', party: '#FF6B9A' };
export const STATE_KEYS = ['scene', 'outfit', 'co_star', 'text'] as const;
export const MAX_TEXT = 120;
