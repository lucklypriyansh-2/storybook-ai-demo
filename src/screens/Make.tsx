import { motion } from 'framer-motion';
import { useState } from 'react';
import { Avatar, HAIRS, Nibbs, SKINS, type Look } from '../mascot';
import { D, E, img } from '../motion';
import { useStore } from '../store';
import { Btn, Chip } from '../ui';
import { fill } from '../data/seed';

/** Make: build the trait avatar (no photo) and generate new reels from templates. */
export function Make({ first }: { first?: boolean }) {
  const s = useStore();
  const [name, setName] = useState(s.name);
  const [look, setLook] = useState<Look>(s.hh!.character.look);
  const [busy, setBusy] = useState(false);
  const saveChar = async () => {
    const n = name.replace(/[^\p{L}\p{M}' -]/gu, '').trim().slice(0, 20) || 'Mira';
    await s.api.updateKid(n); await s.api.updateLook(look); await s.refresh();
  };
  const make = async (tid: string) => { setBusy(true); await saveChar(); const r = await s.api.createReel(tid); await s.refresh(); s.toast('🎬 New reel queued · filming now'); setBusy(false); s.go('feed'); return r; };
  return <div className={`body cream scroll${first ? '' : ' tabbed'}`} data-testid="make">
    <h1>{first ? 'Build the star' : 'Make'}</h1>
    <div className="avstage" style={{ backgroundImage: `url(${img('reel-space.jpg')})` }}>
      <motion.div key={JSON.stringify(look)} initial={{ scale: 0.94, y: 6 }} animate={{ scale: 1, y: 0 }} transition={{ duration: D.base, ease: E.bounce }}><Avatar look={look} width={170} label={`${name}'s avatar preview`} /></motion.div>
      <Nibbs mood="idle" trigger="wave" width={84} style={{ position: 'absolute', right: 10, bottom: 8 }} />
      <span className="chip" style={{ position: 'absolute', left: 12, top: 12 }}>🎨 Cartoon only · no photos</span></div>
    <input aria-label="Child's name" className="card field" style={{ marginTop: 12 }} value={name} maxLength={20} onChange={e => setName(e.target.value)} />
    <div className="cap sect">SKIN</div><div className="row" style={{ gap: 12 }}>{SKINS.map(c => <button key={c} aria-label={`Skin tone ${c}`} aria-pressed={look.skin === c} onClick={() => setLook({ ...look, skin: c })} className="swatch" style={{ background: c, outline: look.skin === c ? '4px solid var(--sky)' : 'none' }} />)}</div>
    <div className="cap sect">HAIR</div><div className="row" style={{ gap: 6 }}>{HAIRS.map(h => <button key={h} aria-label={`Hair ${h}`} aria-pressed={look.hair === h} onClick={() => setLook({ ...look, hair: h })} className={`card hairopt${look.hair === h ? ' sel' : ''}`}><Avatar look={{ ...look, hair: h }} width={44} /></button>)}</div>
    <div className="cap sect">EXTRAS</div><div className="row wrap"><Chip on={look.glasses} onClick={() => setLook({ ...look, glasses: !look.glasses })}>👓 Glasses</Chip><Chip on={look.freckles} onClick={() => setLook({ ...look, freckles: !look.freckles })}>✨ Freckles</Chip></div>
    {first ? <Btn style={{ marginTop: 16 }} disabled={busy} onClick={() => make('moon')} data-testid="make-first">Make {name || 'Mira'}'s first reel</Btn>
      : <><Btn kind="ghost" style={{ marginTop: 14 }} onClick={async () => { await saveChar(); s.toast('✓ Character saved'); }}>Save character</Btn>
        <div className="cap sect">NEW EPISODE</div>
        <div className="eplist">{s.templates.map(t => <button key={t.id} className="card pick" disabled={busy} onClick={() => make(t.id)} aria-label={`New reel ${fill(t.title, name)}`}>
          <span className="img" style={{ width: 54, height: 80, borderRadius: 12, flexShrink: 0, backgroundImage: `url(${img(t.cover)})` }} /><span><b>{fill(t.title, name)}</b><span className="cap" style={{ display: 'block' }}>{t.mode} · ~{t.duration_s}s · free</span></span></button>)}</div></>}
  </div>;
}
