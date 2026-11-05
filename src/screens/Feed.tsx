import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Nibbs } from '../mascot';
import { img } from '../motion';
import { useStore } from '../store';
import { ICON, Btn } from '../ui';
import { fill, sceneOf } from '../data/seed';
import type { Reel } from '../data';
import { RemakeSheet } from './Remake';
import { EndCard } from './EndCard';
import { FamilySheet } from './Family';

export type FeedTab = 'for' | 'bedtime' | 'birthday';
export const media = (u: string) => (/^https?:|^blob:/.test(u) ? u : `${import.meta.env.BASE_URL}${u}`);
const isNight = (after: string, d = new Date()) => { const [h, m] = after.split(':').map(Number); return d.getHours() * 60 + d.getMinutes() >= h * 60 + m || d.getHours() < 6; };

/** Vertical snap feed: native CSS scroll-snap (smooth on iOS Safari, real momentum), IntersectionObserver picks the active reel. */
export function Feed() {
  const s = useStore();
  const st = s.hh!.settings;
  const bedtimeForced = st.bedtime_mode && isNight(st.bedtime_after);
  const [tab, setTab] = useState<FeedTab>(bedtimeForced ? 'bedtime' : 'for');
  const list = useMemo(() => {
    const mode = (r: Reel) => s.tpl(r.template_id)?.mode;
    const l = tab === 'for' ? s.reels.filter(r => mode(r) !== 'bedtime').concat(s.reels.filter(r => mode(r) === 'bedtime')) : s.reels.filter(r => mode(r) === (tab === 'bedtime' ? 'bedtime' : 'birthday'));
    return l.slice(0, st.reels_per_day);
  }, [s.reels, tab, st.reels_per_day, s.templates]);
  const total = list.length;
  const [idx, setIdx] = useState(0);
  const [prog, setProg] = useState(0);
  const [ended, setEnded] = useState<string | null>(null);
  const [remake, setRemake] = useState<Reel | null>(null);
  const [family, setFamily] = useState<Reel | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const night = tab === 'bedtime';
  const [muted, setMuted] = useState(() => localStorage.getItem('starringme.sound') !== 'on');
  const toggleSound = () => { const m = !muted; setMuted(m); localStorage.setItem('starringme.sound', m ? 'off' : 'on'); };

  useEffect(() => { setIdx(0); setEnded(null); box.current?.scrollTo({ top: 0 }); }, [tab]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const i = Number((e.target as HTMLElement).dataset.i); setIdx(i); setProg(0); setEnded(null); } }), { root: el, threshold: 0.6 });
    el.querySelectorAll('[data-i]').forEach(n => io.observe(n));
    return () => io.disconnect();
  }, [list.map(r => r.id).join(), tab]);
  const scrollTo = (i: number) => { const el = box.current; if (!el) return; el.scrollTo({ top: i * el.clientHeight, behavior: 'smooth' }); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (s.gate || remake || family) return; if (e.key === 'ArrowDown') { e.preventDefault(); scrollTo(Math.min(idx + 1, total)); } if (e.key === 'ArrowUp') { e.preventDefault(); scrollTo(Math.max(idx - 1, 0)); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [idx, total, s.gate, remake, family]);

  const loveCount = s.reels.filter(r => r.loved).length;
  const love = async (r: Reel) => {
    const nv = !r.loved;
    s.setReels(s.reels.map(x => (x.id === r.id ? { ...x, loved: nv } : x)));
    await s.api.setLoved(r.id, nv);
    if (nv && loveCount + 1 === 3 && !localStorage.getItem('starringme.pw.seen')) { localStorage.setItem('starringme.pw.seen', '1'); setTimeout(() => s.go('paywall', 'loved'), 900); }
  };
  const save = async (r: Reel) => { const nv = !r.saved; s.setReels(s.reels.map(x => (x.id === r.id ? { ...x, saved: nv } : x))); await s.api.setSaved(r.id, nv); s.toast(nv ? '🔖 Saved to your Shelf' : 'Removed from Shelf'); };
  const book = (r: Reel) => { const b = s.books.find(b => b.reel_id === r.id); if (b) s.go('book', b.id); };

  return <div className={`feed-wrap${night ? ' night-mode' : ''}`} data-testid="feed" data-tab={tab}>
    <div className="feed" ref={box} data-testid="feed-scroller">
      {list.map((r, i) => <Slide key={r.id} r={r} i={i} active={i === idx} night={night} muted={muted} onProg={setProg} onEnd={() => setEnded(r.id)}
        onLove={() => love(r)} onSave={() => save(r)} onRemake={() => setRemake(r)} onBook={() => book(r)} onFamily={() => s.askGate('Family sharing', () => setFamily(r))}
        endCard={ended === r.id} closeEnd={() => setEnded(null)} next={() => { setEnded(null); scrollTo(i + 1); }} />)}
      <section className="slide done" data-i={total} data-testid="feed-done"><FeedDone n={total} night={night} /></section>
    </div>
    <div className="feed-top">
      <div className="toptabs2">{(bedtimeForced ? (['bedtime'] as FeedTab[]) : (['for', 'bedtime', 'birthday'] as FeedTab[])).map(t =>
        <button key={t} className={`ptab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)} aria-pressed={tab === t}>{t === 'for' ? `For ${s.name}` : t === 'bedtime' ? '🌙 Bedtime' : 'Birthday'}</button>)}</div>
      {idx < total && <><div className="eps2" aria-hidden>{list.map((_, i) => <i key={i} className={i < idx ? 'done' : ''}>{i === idx && <motion.b style={{ width: `${prog * 100}%` }} />}</i>)}</div>
        <div className="today"><span data-testid="today">TODAY · {Math.min(idx + 1, total)} OF {total}</span>{night && <span className="calm">calm reels only</span>}
          <button className="sound" onClick={toggleSound} aria-label={muted ? 'Sound on' : 'Sound off'} aria-pressed={!muted}>{muted ? '🔇 Sound' : '🔊 On'}</button></div></>}
    </div>
    <AnimatePresence>{remake && <RemakeSheet key="rm" reel={remake} onClose={() => setRemake(null)} />}</AnimatePresence>
    <AnimatePresence>{family && <FamilySheet key="fam" reel={family} onClose={() => setFamily(null)} />}</AnimatePresence>
  </div>;
}

function Slide({ r, i, active, night, muted, onProg, onEnd, onLove, onSave, onRemake, onBook, onFamily, endCard, closeEnd, next }: {
  r: Reel; i: number; active: boolean; night: boolean; muted: boolean; onProg: (p: number) => void; onEnd: () => void; onLove: () => void; onSave: () => void; onRemake: () => void; onBook: () => void; onFamily: () => void; endCard: boolean; closeEnd: () => void; next: () => void;
}) {
  const s = useStore();
  const t = s.tpl(r.template_id);
  const v = useRef<HTMLVideoElement>(null);
  const [pop, setPop] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);
  const rendering = r.status === 'queued' || r.status === 'rendering';
  const scene = sceneOf(r.state.scene);
  const poster = img(scene.image);
  const bk = s.books.find(b => b.reel_id === r.id);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; s.videoSrc(r.video_url).then(u => on && setSrc(u)); return () => { on = false; }; }, [r.video_url]);
  const job = s.jobs.filter(j => j.reel_id === r.id).at(-1);
  const rp = job ? s.renderProg[job.id] ?? 0 : 0;
  useEffect(() => {
    const el = v.current; if (!el) return;
    el.muted = muted;
    if (active && !endCard) { el.play().then(() => setNeedsTap(false)).catch(() => { el.muted = true; el.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true)); }); } else el.pause();
    if (!active) { try { el.currentTime = 0; } catch { /* not loaded */ } }
  }, [active, endCard, src, muted]);
  // Image-only reels (no video yet): progress on a timer so the set bar still fills.
  useEffect(() => {
    if (!active || src || rendering || endCard || r.status === 'failed') return;
    const t0 = Date.now(), d = (t?.duration_s ?? 8) * 1000;
    const h = setInterval(() => { const p = (Date.now() - t0) / d; onProg(Math.min(1, p)); if (p >= 1) { clearInterval(h); onEnd(); } }, 200);
    return () => clearInterval(h);
  }, [active, src, rendering, endCard]);
  const line = fill(r.state.text, s.name, r.state);
  const words = line.split(/(\s+)/).map((w, k) => /\b(Nibbs|moon|stars?|whale|dino|wish|cloud|Bruno|Arjun)\b/i.test(w) || w.includes(s.name) ? <b key={k}>{w}</b> : w);
  return <section className="slide" data-i={i} data-testid={`reel-${i}`} data-reel={r.id} data-status={r.status} data-version={r.version} data-line={line} aria-label={s.title(r)}>
    {src && !rendering
      ? <video ref={v} className="media" src={src} poster={poster} muted playsInline preload={active ? 'auto' : 'metadata'} data-testid="reel-video"
          onTimeUpdate={e => { const el = e.currentTarget; if (active && el.duration) onProg(el.currentTime / el.duration); }} onEnded={() => active && onEnd()} />
      : <div className={`media kb${active ? ' on' : ''}`} style={{ backgroundImage: `url(${poster})` }} role="img" aria-label={scene.label} />}
    <div className="shade2" />
    {needsTap && active && src && !rendering && <button className="tapplay" aria-label="Play reel" onClick={() => v.current?.play().then(() => setNeedsTap(false)).catch(() => {})}>▶</button>}
    {rendering && <div className="rendering" data-testid="rendering"><div className="spin" /><b>{r.status === 'queued' ? 'Queued…' : 'Rendering…'}</b><span>Version {r.version} · {scene.label}</span>
      <div className="rbar"><i style={{ width: `${Math.round(rp * 100)}%` }} /></div><small>Nibbs is filming it on this phone. Keep the app open (about 10 s).</small></div>}
    {r.status === 'failed' && <div className="rendering" data-testid="render-failed"><b>Couldn't film this one</b><small>This browser can't record video. Try Safari or Chrome.</small></div>}
    <div className="rail2">
      <button className={`rb2${r.loved ? ' love' : ''}`} onClick={() => { if (!r.loved) setPop(p => p + 1); onLove(); }} aria-pressed={r.loved} aria-label="Love it">
        <motion.span className="c" key={pop} animate={pop ? { scale: [1, 1.3, 1] } : {}} transition={{ duration: 0.45, ease: [0.34, 1.56, 0.64, 1] }}>{ICON.heart}</motion.span>Love it
        <AnimatePresence>{pop > 0 && r.loved && <motion.i key={'h' + pop} className="float-heart" initial={{ opacity: 1, y: 0, scale: 0.6 }} animate={{ opacity: 0, y: -70, scale: 1.3 }} transition={{ duration: 0.9 }}>💖</motion.i>}</AnimatePresence></button>
      <button className={`rb2${r.saved ? ' saved' : ''}`} onClick={onSave} aria-pressed={r.saved} aria-label="Save"><span className="c">{ICON.save(r.saved)}</span>{r.saved ? 'Saved' : 'Save'}</button>
      {s.hh?.settings.remake_enabled !== false && <button className="rb2 hot" onClick={onRemake} aria-label="Remake"><span className="c">{ICON.remake}</span>Remake</button>}
      <button className="rb2" onClick={onBook} aria-label="Book"><span className="c">{ICON.book}</span>Book</button>
      <button className="rb2" onClick={onFamily} aria-label="Family (grown-ups)"><span className="c">{ICON.family}</span>Family 🔒</button>
    </div>
    <div className="cap3">
      <div className="who"><span className="av"><Avatar look={s.hh!.character.look} width={34} /></span>{s.name} &amp; {fill('{costar}', s.name, r.state)}<span className="lock2">Private</span>{r.version > 1 && <span className="lock2">v{r.version}</span>}</div>
      <div className="title2">{s.title(r)}</div>
      {line && !r.video_url?.startsWith('idb:') && <div className="sub">“{words}”</div>}
    </div>
    {bk && <button className={`bookpill2${night ? ' big' : ''}`} onClick={onBook} aria-label={`Read ${bk.title}`}>
      <span className="cv" style={{ backgroundImage: `url(${img(t?.cover ?? 'cover.jpg')})` }} /><span className="t">{night ? 'Bedtime book: ' : 'From the book: '}{bk.title}<small>{bk.pages.length} pages · read-along</small></span><span className="mini">Read</span></button>}
    <AnimatePresence>{endCard && <EndCard key="end" reel={r} onClose={closeEnd} onNext={next} />}</AnimatePresence>
  </section>;
}

function FeedDone({ n, night }: { n: number; night: boolean }) {
  const s = useStore();
  const first = s.books.find(b => { const r = s.reels.find(r => r.id === b.reel_id); return r && s.tpl(r.template_id)?.mode === 'bedtime'; }) ?? s.books[0];
  return <div className="donebox">
    <div className="eyebrow2">ALL DONE FOR TODAY</div>
    <h1>Nibbs is getting sleepy…</h1>
    <Nibbs mood="idle" width={180} style={{ margin: '18px auto 0', display: 'block' }} />
    <p>{s.name} watched {n} reels. New ones arrive tomorrow morning.</p>
    <Btn kind="sun" onClick={() => first && s.go('book', first.id)}>📖 Read a bedtime book</Btn>
    <p className="small">Daily limit set by a grown-up: {s.hh!.settings.reels_per_day} reels · {s.hh!.settings.bedtime_after} bedtime mode{night ? ' (on)' : ''}</p>
  </div>;
}
