import { useState } from 'react';
import { Nibbs } from '../mascot';
import { img } from '../motion';
import { useStore } from '../store';
import { Btn, Chip, Sheet } from '../ui';
import { COSTARS, MAX_TEXT, OUTFITS, SCENES, type Reel, type ReelState } from '../data';
import { fill } from '../data/seed';

export const REMAKES_PER_MONTH = 10;
export const remakesLeft = (reels: { version: number }[]) => Math.max(0, REMAKES_PER_MONTH - reels.reduce((a, r) => a + r.version - 1, 0));
/** Remake: kids pick tiles (scene / outfit / co-star); the line text is editable (kept short, no free prompts to an AI). */
export function RemakeSheet({ reel, onClose }: { reel: Reel; onClose: () => void }) {
  const s = useStore();
  const [st, setSt] = useState<ReelState>({ ...reel.state });
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(st) !== JSON.stringify(reel.state);
  const left = remakesLeft(s.reels);
  const set = (p: Partial<ReelState>) => setSt({ ...st, ...p });
  const go = async () => {
    if (left <= 0) { onClose(); s.go('paywall', 'remakes'); return; }
    setBusy(true);
    try { const r = await s.api.remake(reel.id, st); await s.refresh(); s.toast(`✨ Remaking · version ${r.version} queued`); onClose(); }
    catch (e) { s.toast('Could not remake: ' + (e as Error).message); setBusy(false); }
  };
  return <Sheet label="Remake this reel" onClose={onClose}>
    <div className="row" style={{ justifyContent: 'space-between' }}><h2>Remake this reel</h2><Nibbs mood="thinking" width={56} /></div>
    <p className="cap" style={{ marginTop: -4, textAlign: 'left' }}>Same story, new world. {s.name} stays the star.</p>
    <div className="cap sect">NEW SCENE</div>
    <div className="tiles">{SCENES.map(x => <button key={x.id} className={`tile2${st.scene === x.id ? ' sel' : ''}`} aria-pressed={st.scene === x.id} aria-label={`Scene ${x.label}`} onClick={() => set({ scene: x.id })} style={{ backgroundImage: `url(${img(x.image)})` }}><span>{x.label}</span></button>)}</div>
    <div className="cap sect">OUTFIT</div>
    <div className="row wrap">{OUTFITS.map(([id, l]) => <Chip key={id} on={st.outfit === id} onClick={() => set({ outfit: id })} label={`Outfit ${id}`}>{l}</Chip>)}</div>
    <div className="cap sect">CO-STAR</div>
    <div className="row wrap">{COSTARS.map(([id, l]) => <Chip key={id} on={st.co_star === id} onClick={() => set({ co_star: id })} label={`Co-star ${id}`}>{l}</Chip>)}</div>
    <div className="cap sect">WHAT {s.name.toUpperCase()} SAYS <span style={{ fontWeight: 700 }}>(grown-ups can edit)</span></div>
    <input className="card field" aria-label="Reel line" maxLength={MAX_TEXT} value={st.text} onChange={e => set({ text: e.target.value.replace(/[<>]/g, '') })} />
    <div className="cap" style={{ textAlign: 'left', marginTop: 4, fontWeight: 700 }}>Preview: “{fill(st.text, s.name, st)}”</div>
    <Btn style={{ marginTop: 14 }} disabled={!changed || busy} className={!changed ? 'off' : ''} onClick={go} data-testid="remake-go">{busy ? 'Queuing…' : changed ? `Remake · ${left} of ${REMAKES_PER_MONTH} left` : 'Pick something new'}</Btn>
    <p className="cap" style={{ marginTop: 8 }}>Filmed on this phone in about 10 seconds · free</p>
  </Sheet>;
}
