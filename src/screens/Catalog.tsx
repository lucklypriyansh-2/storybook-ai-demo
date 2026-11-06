import { useEffect, useState } from 'react';
import { Avatar, DEFAULT_LOOK, Nibbs } from '../mascot';
import { img } from '../motion';
import { useStore } from '../store';
import { Btn } from '../ui';
import { fill } from '../data/seed';
import type { CatalogShot, CatalogTemplate, DataApi } from '../data';

/**
 * Narrow Worker-only surface the catalog needs. LocalApi / SupabaseApi do not
 * expose `/api/catalog`, so this screen degrades honestly there.
 */
type CatalogApi = DataApi & {
  catalog?: () => Promise<CatalogTemplate[]>;
  catalogDetail?: (id: string) => Promise<{ template: CatalogTemplate; shots: CatalogShot[] }>;
  generateFromTemplate?: (
    templateId: string, tier: 'free' | 'paid' | 'hd', kidId?: string, useSheet?: boolean,
  ) => Promise<{ reel_id: string; job_id: string }>;
  health?: () => Promise<{ flags?: { fal?: boolean; openrouter?: boolean; motion?: boolean } }>;
};

/** `local:` covers ship with the SPA; anything else is already an absolute (signed) URL. */
export function coverUrl(cover: string | null): string {
  if (!cover) return img('cover.jpg');
  if (cover.startsWith('local:')) return img(cover.slice('local:'.length));
  return cover;
}

/**
 * Tier badge. Anything that would need a provider is marked "paused" when that
 * provider is off (Phase B #11): since §H both HD (motion) and paid bill through
 * OpenRouter, so both follow `openrouter` and neither reads fal. We never print
 * a bare "paid"/"HD" on a box where tapping the story would fail — the badge is
 * a promise about what tapping the story will actually do.
 */
export function tierBadge(tier: string, motion: boolean, openrouter = true): string {
  if (tier === 'hd') return motion ? '🎞 HD' : '🎞 HD — paused';
  if (tier === 'paid') return openrouter ? '✨ paid' : '✨ paid — paused';
  return 'free';
}

export function Catalog() {
  const s = useStore();
  const api = s.api as CatalogApi;
  const [templates, setTemplates] = useState<CatalogTemplate[] | null>(null);
  // Motion availability follows OpenRouter (§H); fal is no longer consulted.
  const [motion, setMotion] = useState(false);
  // Default true until the Worker says otherwise: we only downgrade a badge when
  // we have actually been told the provider is off (never invent "paused").
  const [openrouter, setOpenrouter] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ template: CatalogTemplate; shots: CatalogShot[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!api.catalog) { setTemplates([]); return; }
    let on = true;
    api.catalog().then(t => on && setTemplates(t)).catch(e => on && setErr(String((e as Error)?.message ?? e)));
    api.health?.().then(h => { if (!on) return; setMotion(!!(h.flags?.motion ?? h.flags?.openrouter)); setOpenrouter(!!h.flags?.openrouter); }).catch(() => {});
    return () => { on = false; };
  }, [api]);

  const open = async (t: CatalogTemplate) => {
    setDetail({ template: t, shots: [] });
    if (!api.catalogDetail) return;
    try { const d = await api.catalogDetail(t.id); setDetail(d); }
    catch { /* keep the summary row; the CTA still works */ }
  };

  const generate = async (t: CatalogTemplate) => {
    if (!api.generateFromTemplate) { s.toast('Catalog needs the cloud backend'); return; }
    setBusy(true);
    try {
      const tier = (t.tier_default === 'hd' && motion ? 'hd' : t.tier_default === 'paid' ? 'paid' : 'free') as 'free' | 'paid' | 'hd';
      // Only ask the Worker to use a sheet when the kid actually has one; the
      // server rejects use_sheet=true for a sheet-less kid (honesty, review #5).
      const hasSheet = s.hh?.character.id.startsWith('sheet:') ?? false;
      await api.generateFromTemplate(t.id, tier, s.hh?.kid.id, hasSheet);
      // Single source of truth: generateFromTemplate records the template binding
      // in sb.reelMeta.v1, which books()/title() read. No parallel store here.
      await s.refresh();
      s.toast('🎬 Storybook queued');
      s.go('feed');
    } catch (e) {
      setErr(String((e as { code?: string })?.code ?? (e as Error)?.message ?? e));
    } finally { setBusy(false); }
  };

  const name = s.name;
  return <div className="body cream scroll tabbed" data-testid="catalog">
    <h1>Story catalog</h1>
    <p className="cap" style={{ textAlign: 'left', marginTop: 4 }}>Pick a story. {name}'s AI avatar stars in every page.</p>

    {!api.catalog && <div className="card" style={{ marginTop: 12 }}><b>Catalog needs the cloud</b><div className="cap">This build is on-device only; use ✨ Make for the quick path.</div></div>}
    {templates === null && <div className="center" data-testid="catalog-loading" style={{ marginTop: 20 }}><Nibbs mood="thinking" width={120} /><p className="cap">Loading stories…</p></div>}
    {templates?.length === 0 && api.catalog && <p className="cap" data-testid="catalog-empty" style={{ marginTop: 12 }}>No stories published yet. An operator adds them in the admin catalog.</p>}
    {err && <p className="cap" data-testid="catalog-error" style={{ marginTop: 8, color: 'var(--danger)' }}>{err}</p>}

    <div className="eplist" style={{ marginTop: 12 }} data-testid="catalog-list">
      {templates?.map(t => <button key={t.id} className="card pick" data-testid={`catalog-card-${t.id}`} onClick={() => open(t)} aria-label={`Story ${fill(t.title, name)}`}>
        <span className="img" style={{ width: 72, height: 96, borderRadius: 12, flexShrink: 0, backgroundImage: `url(${coverUrl(t.cover)})`, position: 'relative' }}>
          {/* Personalisation chip (R.1.3): "with <kid>", avatar over the cover. */}
          <span data-testid="kid-chip" style={{ position: 'absolute', left: -6, bottom: -6, background: 'var(--sky)', color: '#fff', borderRadius: 99, font: '900 10px var(--ui)', padding: '2px 6px 2px 2px', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar look={s.hh?.character.look ?? DEFAULT_LOOK} width={18} />with {name}
          </span>
        </span>
        <span style={{ flex: 1 }}>
          <b>{fill(t.title, name)}</b>
          <span className="cap" style={{ display: 'block' }}>Ages {t.age_band} · {t.page_count} pages · <span className={`tier ${t.tier_default}`} data-testid="tier-badge">{tierBadge(t.tier_default, motion, openrouter)}</span></span>
          <span className="cap" style={{ display: 'block' }}>{t.description}</span>
        </span>
      </button>)}
    </div>

    {detail && <div className="card" style={{ marginTop: 14 }} data-testid="catalog-detail">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b data-testid="detail-title">{fill(detail.template.title, name)}</b>
        <button className="x" aria-label="Close story detail" onClick={() => setDetail(null)}>✕</button>
      </div>
      <div className="cap" style={{ textAlign: 'left' }}>PLACEHOLDER sample story · ages {detail.template.age_band} · {detail.template.page_count} pages</div>
      <p className="cap" style={{ textAlign: 'left' }}>{detail.template.description}</p>
      {detail.shots.length > 0 && <ol className="cap" style={{ textAlign: 'left', paddingLeft: 18 }} data-testid="detail-shots">
        {detail.shots.map(shot => <li key={shot.index}>{fill(shot.caption_prompt, name)}</li>)}
      </ol>}
      <Btn style={{ marginTop: 10 }} disabled={busy} onClick={() => generate(detail.template)} data-testid="generate-story">
        {busy ? 'Queuing…' : `Generate ${name}'s storybook`}
      </Btn>
    </div>}
    <div style={{ height: 20 }} />
  </div>;
}
