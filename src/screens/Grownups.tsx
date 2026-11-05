import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Btn, Toggle } from '../ui';
import type { ConsentKind } from '../data';

export const CONSENT_ROWS: [ConsentKind, string, string][] = [
  ['create', "Make {name}'s character and reels", 'Needed for the app. Cartoon avatar only, no photos.'],
  ['family_share', 'Share with family I invite', 'Private links to people you add. Never public.'],
  ['ai_training', 'Help improve our AI', 'Separate consent (COPPA 2026). Off unless you turn it on.'],
  ['marketing', 'Marketing emails to me', 'About new books and offers. Nothing to {name}.'],
  ['publish_social', 'Allow social publishing', 'Lets you post reels you approve, one by one.'],
];
export function ConsentList() {
  const s = useStore();
  return <div className="card list" data-testid="consents">{CONSENT_ROWS.map(([k, t, c]) =>
    <div className="row" key={k}><div style={{ flex: 1 }}><b>{t.replace('{name}', s.name)}</b><div className="cap">{c.replace('{name}', s.name)}</div></div>
      <Toggle on={s.consent(k)} label={t.replace('{name}', s.name)} set={async v => { await s.api.setConsent(k, v); await s.refresh(); }} /></div>)}</div>;
}

export function Grownups() {
  const s = useStore();
  const st = s.hh!.settings;
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (!s.unlocked()) s.askGate('Grown-ups area', () => {}); }, []);
  if (s.gate) return <div className="body cream" />;
  const upd = async (p: Partial<typeof st>) => { await s.api.updateSettings(p); await s.refresh(); };
  const drafts = s.publish;
  return <div className="body cream scroll tabbed" data-testid="grownups">
    <h1>Grown-ups</h1><div className="cap" style={{ marginTop: 4 }}>Unlocked with the parent gate · locks again in 5 min</div>
    <div className="card backend" data-testid="backend">
      {s.api.mode === 'supabase' ? <><b>☁️ Synced with Supabase</b><div className="cap">Household-only (row-level security).</div></>
        : <><b>📱 Saved on this phone</b><div className="cap">v1 keeps everything in this browser (IndexedDB). Cloud sync comes later.</div></>}</div>

    <div className="cap sect">SETTINGS</div>
    <div className="card list">
      <div className="row"><div style={{ flex: 1 }}><b>Reels per day</b><div className="cap">Feed ends after this many</div></div>
        <div className="stepper"><button aria-label="Fewer reels" onClick={() => upd({ reels_per_day: Math.max(1, st.reels_per_day - 1) })}>−</button><b data-testid="rpd">{st.reels_per_day}</b><button aria-label="More reels" onClick={() => upd({ reels_per_day: Math.min(12, st.reels_per_day + 1) })}>+</button></div></div>
      <div className="row"><div style={{ flex: 1 }}><b>Bedtime mode</b><div className="cap">After {st.bedtime_after} only calm reels, then books</div></div><Toggle on={st.bedtime_mode} label="Bedtime mode" set={v => upd({ bedtime_mode: v })} /></div>
      <div className="row"><div style={{ flex: 1 }}><b>Remake &amp; new scenes</b><div className="cap">Lets {s.name} pick scenes (no free text)</div></div><Toggle on={st.remake_enabled} label="Remake and new scenes" set={v => upd({ remake_enabled: v })} /></div>
    </div>

    <div className="cap sect">CONSENT</div>
    <ConsentList />

    <div className="cap sect">PUBLISHING QUEUE (INSTAGRAM)</div>
    <div className="card list" data-testid="publish-queue">
      {drafts.length === 0 ? <div className="cap">No drafts yet. Use Family 🔒 on a reel → Publish.</div> : drafts.map(p => { const r = s.reels.find(r => r.id === p.reel_id);
        return <div className="row" key={p.id} data-testid="draft-row"><div style={{ flex: 1 }}><b>{r ? s.title(r) : 'Reel'}</b><div className="cap">{p.caption.slice(0, 60)}</div></div>
          <span className={`pill st-${p.status}`}>{p.status}</span>{p.status === 'draft' && <button className="linkish" style={{ margin: 0 }} onClick={async () => { await s.api.cancelPublish(p.id); await s.refresh(); }}>Cancel</button>}</div>; })}
      <div className="cap" style={{ marginTop: 4 }}>Posting is not connected yet: it needs your Instagram login (Meta app) and your OK per post.</div>
    </div>

    <div className="cap sect">RENDERS</div>
    <div className="card list"><div className="cap">{s.jobs.length} render jobs · {s.jobs.filter(j => j.status === 'done').length} done · {s.jobs.filter(j => j.status === 'queued' || j.status === 'rendering').length} in progress · filmed on this device, $0</div></div>

    <div className="row" style={{ marginTop: 14, gap: 10 }}>
      <Btn kind="ghost" onClick={() => s.go('paywall', 'plans')}>Plans</Btn>
      <a className="btn ghost" href={`${import.meta.env.BASE_URL}privacy/`}>Privacy</a></div>
    <Btn kind="danger" style={{ marginTop: 14 }} onClick={() => setConfirm(true)}>Delete {s.name}'s data</Btn>
    {confirm && <div className="card" style={{ marginTop: 10, borderColor: 'var(--danger)' }}><b>Delete everything on this phone?</b><div className="cap">Character, reels, videos, books, drafts and consents.</div>
      <div className="row" style={{ marginTop: 10 }}><Btn kind="danger" onClick={async () => { await s.api.deleteAll(); localStorage.clear(); location.hash = ''; location.reload(); }}>Yes, delete</Btn><Btn kind="ghost" onClick={() => setConfirm(false)}>Keep</Btn></div></div>}
    <div style={{ height: 24 }} />
  </div>;
}
