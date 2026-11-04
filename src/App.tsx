import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { D, E, img } from './motion';
import { Avatar, DEFAULT_LOOK, HAIRS, Nibbs, SKINS, type Look, type Mood } from './mascot';
import { FORMATS, THEMES, cleanName, makeStory, orderTotal, SHIPPING, type Hero, type Pronoun, type Theme } from './story';

export type Screen = 'onboarding' | 'consent' | 'upload' | 'create' | 'reveal' | 'pick' | 'loading' | 'reader' | 'video' | 'checkout' | 'share' | 'library' | 'settings';
const ORDER: Screen[] = ['onboarding', 'consent', 'upload', 'create', 'reveal', 'pick', 'loading', 'reader', 'video', 'checkout', 'share', 'library', 'settings'];
type Story = ReturnType<typeof makeStory>;
type P = { go: (s: Screen) => void; hero: Hero; setHero: (h: Hero) => void; look: Look; setLook: (l: Look) => void; cape: boolean; n: string; her: string; theme: Theme; setTheme: (t: Theme) => void; story: Story; dedication: string; setDedication: (s: string) => void; books: Theme[]; setBooks: (b: Theme[]) => void; photosDeleted: boolean; setPhotosDeleted: (b: boolean) => void; photos: string[]; setPhotos: (f: (p: string[]) => string[]) => void };

function Btn({ kind = 'primary', children, style, ...p }: { kind?: string; children: ReactNode; style?: React.CSSProperties } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <motion.button className={`btn ${kind}`} style={style} whileTap={{ y: 4, boxShadow: '0 0 0 rgba(0,0,0,0)' }} transition={{ duration: 0.1 }} {...(p as object)}>{children}</motion.button>;
}
function Chip({ on, children, onClick }: { on?: boolean; children: ReactNode; onClick?: () => void }) {
  return <motion.button type="button" className={`chip${on ? ' on' : ''}`} onClick={onClick} whileTap={{ y: 3, boxShadow: '0 0 0 rgba(0,0,0,0)' }} transition={{ duration: 0.1 }} aria-pressed={!!on}>{children}</motion.button>;
}
function Top({ close, pct, color, right }: { close: () => void; pct: number; color?: string; right?: ReactNode }) {
  return <div className="top"><button className="x" aria-label="Close" onClick={close}>✕</button>
    <div className="progress"><motion.i initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: E.std }} style={color ? { background: color } : undefined} /></div>{right}</div>;
}
function Says({ mood, children, trigger }: { mood: Mood; children: ReactNode; trigger?: 'wave' | 'celebrate' | 'error' }) {
  return <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}><Nibbs mood={mood} trigger={trigger} width={80} />
    <motion.div className="bubble" style={{ marginTop: 14, flex: 1, transformOrigin: 'left center' }} initial={{ opacity: 0, scale: 0.85, x: -8 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ delay: 0.15, duration: D.base, ease: E.bounce }}>{children}</motion.div></div>;
}
function Tabbar({ on, go }: { on: string; go: (s: Screen) => void }) {
  const t: [string, string, Screen][] = [['📚', 'Shelf', 'library'], ['✨', 'Create', 'upload'], ['🎬', 'Watch', 'video'], ['⚙️', 'Grown-ups', 'settings']];
  return <nav className="tabbar">{t.map(([i, l, s]) => <button key={l} className={on === l ? 'on' : ''} onClick={() => go(s)}><b>{i}</b>{l}</button>)}</nav>;
}
function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} className="tg" style={{ background: on ? 'var(--teal)' : 'var(--line)' }}>
    <motion.span layout transition={{ duration: D.fast, ease: E.bounce }} style={{ marginLeft: on ? 23 : 3 }} /></button>;
}

export default function App({ initial = 'onboarding' as Screen }) {
  const [screen, setScreen] = useState<Screen>(() => { const h = location.hash.slice(1) as Screen; return ORDER.includes(h) ? h : initial; });
  const [dir, setDir] = useState(1);
  const [hero, setHero] = useState<Hero>({ name: 'Mira', age: 6, pronoun: 'she', outfit: 'Raincoat', sidekick: 'Nibbs' });
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [theme, setTheme] = useState<Theme>('door');
  const [dedication, setDedication] = useState('For Mira, braver than she knows. Love, Papa');
  const [books, setBooks] = useState<Theme[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photosDeleted, setPhotosDeleted] = useState(false);
  const go = (s: Screen) => { setDir(ORDER.indexOf(s) >= ORDER.indexOf(screen) ? 1 : -1); setScreen(s); };
  useEffect(() => { history.replaceState(null, '', '#' + screen); }, [screen]);
  const story = makeStory(theme, hero, dedication);
  const n = cleanName(hero.name);
  const her = hero.pronoun === 'she' ? 'her' : hero.pronoun === 'he' ? 'his' : 'their';
  const props: P = { go, hero, setHero, look, setLook, cape: hero.outfit === 'Cape', n, her, theme, setTheme, story, dedication, setDedication, books, setBooks, photosDeleted, setPhotosDeleted, photos, setPhotos };
  const rm = useReducedMotion();
  const variants = rm ? { i: { opacity: 0 }, a: { opacity: 1, x: 0 }, x: { opacity: 0 } } : {
    i: (d: number) => ({ x: d > 0 ? '100%' : '-30%', opacity: d > 0 ? 1 : 0 }), a: { x: 0, opacity: 1 },
    x: (d: number) => ({ x: d > 0 ? '-30%' : '100%', opacity: d > 0 ? 0 : 1 }),
  };
  return <MotionConfig reducedMotion="user"><div className="stage"><div className="phone" data-screen={screen}>
    <div className="status"><span>9:41</span><span className="demo-pill">DEMO</span><span>●●● ▮</span></div>
    <AnimatePresence initial={false} custom={dir} mode="popLayout">
      <motion.div key={screen} className="screen" custom={dir} variants={variants} initial="i" animate="a" exit="x" transition={{ duration: rm ? 0.15 : D.base, ease: E.std }}>
        {SCREENS[screen](props)}
      </motion.div>
    </AnimatePresence>
  </div></div></MotionConfig>;
}

const rise = (i = 0) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.1 + i * 0.08, duration: D.slow, ease: E.enter } });

const SCREENS: Record<Screen, (p: P) => ReactNode> = {
  onboarding: ({ go }) => <div className="body">
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <motion.div initial={{ scale: 0.6, opacity: 0, y: 30 }} animate={{ scale: 1, opacity: 1, y: 0 }} transition={{ duration: D.slow, ease: E.bounce }}><Nibbs mood="idle" trigger="wave" width={210} /></motion.div>
      <motion.div {...rise(1)} style={{ fontWeight: 900, fontSize: 40, color: 'var(--teal)', marginTop: 10, letterSpacing: -1 }}>starring me</motion.div>
      <motion.p {...rise(2)} className="lead" style={{ maxWidth: 280 }}>Hi! I'm Nibbs. Let's make a storybook where <b style={{ color: 'var(--ink)' }}>your child</b> is the hero.</motion.p></div>
    <Btn onClick={() => go('consent')}>Get started</Btn><Btn kind="ghost" style={{ marginTop: 12 }} onClick={() => go('library')}>I already have an account</Btn></div>,

  consent: ({ go }) => <Consent go={go} />,
  upload: p => <Upload {...p} />,
  create: p => <Create {...p} />,

  reveal: ({ go, n, her, look, cape }) => <div className="body"><div className="night">
    <motion.div {...rise(4)} style={{ fontWeight: 900, color: 'var(--sun)', letterSpacing: 2 }}>TA-DA!</motion.div>
    <motion.h1 {...rise(5)} style={{ marginTop: 6 }}>Meet {n} the Brave!</motion.h1>
    <div style={{ position: 'relative', width: 320, height: 340, marginTop: 20, maxWidth: '100%' }}>
      <motion.div aria-hidden initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: [0, 1, 0.35, 0.8], scale: [0.4, 1.1, 1, 1] }} transition={{ duration: D.reveal, ease: E.enter }} style={{ position: 'absolute', inset: 20, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,200,0,.55),transparent 65%)' }} />
      {[[-130, -120, '#FFC800'], [120, -140, '#FF6B57'], [-140, 90, '#1CB0F6'], [130, 60, '#FFC800']].map(([x, y, c], i) => <motion.span key={i} aria-hidden className="spark" style={{ color: c as string }} initial={{ opacity: 0, x: 0, y: 0, scale: 0 }} animate={{ opacity: [0, 1, 0], x: x as number, y: y as number, scale: [0, 1.3, 0.8] }} transition={{ delay: 0.3 + i * 0.06, duration: 1.1, ease: E.bounce }}>★</motion.span>)}
      <motion.div data-testid="reveal-card" style={{ position: 'absolute', left: 20, top: 40 }} initial={{ opacity: 0, scale: 0.6, rotate: -6, filter: 'blur(12px) brightness(2)' }} animate={{ opacity: 1, scale: 1, rotate: 0, filter: 'blur(0px) brightness(1)' }} transition={{ duration: D.reveal, ease: E.enter }}>
        <Avatar look={look} cape={cape} width={220} label={`${n}'s avatar`} /></motion.div>
      <motion.div style={{ position: 'absolute', right: -6, bottom: 0 }} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6, duration: D.slow, ease: E.bounce }}><Nibbs mood="idle" trigger="celebrate" width={130} /></motion.div></div>
    <div className="spacer" /><Btn kind="sun" onClick={() => go('pick')}>Pick {her} adventure</Btn>
    <p style={{ opacity: 0.8, fontWeight: 800, marginTop: 12, fontSize: 14 }}>Change something? <u style={{ cursor: 'pointer' }} onClick={() => go('create')}>Edit avatar</u></p></div></div>,

  pick: ({ go, n, theme, setTheme, dedication, setDedication }) => <div className="body">
    <Top close={() => go('reveal')} pct={70} />
    <Says mood="talking">Which adventure should {n} and I go on?</Says>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      {THEMES.map((t, i) => <motion.button key={t.id} className={`card pick${theme === t.id ? ' sel' : ''}`} onClick={() => setTheme(t.id)} aria-pressed={theme === t.id} {...rise(i)} whileTap={{ y: 4 }}>
        <div className="img" style={{ width: 100, height: 72, borderRadius: 14, flexShrink: 0, backgroundImage: `url(${img(t.image)})` }} />
        <div><b style={{ fontSize: 16 }}>{t.title}</b><div className="cap" style={{ marginTop: 4 }}>{t.meta}</div></div></motion.button>)}</div>
    <label className="card" style={{ marginTop: 12, background: 'var(--sun1)', borderColor: '#F5E2A0', boxShadow: '0 4px 0 #F5E2A0', display: 'block' }}><b>✍️ Dedication</b>
      <textarea aria-label="Dedication" className="ded cap" rows={2} value={dedication} onChange={e => setDedication(e.target.value.slice(0, 140))} /></label>
    <div className="spacer" /><Btn onClick={() => go('loading')}>Write our story</Btn></div>,

  loading: ({ go, n, theme, books, setBooks }) => <Loader n={n} done={() => { if (!books.includes(theme)) setBooks([theme, ...books]); go('reader'); }} />,
  reader: ({ go, story, n }) => <Reader go={go} story={story} n={n} />,
  video: ({ go, story }) => <Video go={go} story={story} />,
  checkout: ({ go, story, n }) => <Checkout go={go} story={story} n={n} />,

  share: ({ go, story }) => <div className="body">
    <div style={{ textAlign: 'center' }}><Nibbs mood="idle" trigger="celebrate" width={170} style={{ margin: 'auto', display: 'block' }} />
      <motion.h1 {...rise(2)} style={{ color: 'var(--teal-d)' }}>Book on its way!</motion.h1><motion.p {...rise(3)} className="lead">Demo order, nothing charged. Arrives Nov 12–15. Nibbs is SO proud.</motion.p></div>
    <motion.div {...rise(4)} className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
      <div className="img" style={{ height: 150, borderRadius: 0, backgroundImage: `url(${img(story.pages[0].image)})` }} /><div style={{ padding: '12px 16px' }}><b>{story.title}</b><div className="cap">Private link · 30 days · avatar only, no photos</div></div></motion.div>
    <ShareRow />
    <div className="spacer" /><Btn onClick={() => go('library')}>Continue</Btn></div>,

  library: ({ go, books, n, setTheme, look }) => <div className="body tabbed">{books.length === 0 ? <>
    <h1>Your shelf</h1>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <Nibbs mood="sad" width={180} /><h2 style={{ marginTop: 6 }}>No stories yet…</h2><p className="lead" style={{ maxWidth: 270 }}>Nibbs is ready for an adventure. Your first book takes about 3 minutes!</p>
      <Btn style={{ marginTop: 22, width: 260 }} onClick={() => go('upload')}>Create a story</Btn></div></> : <>
    <div className="row" style={{ justifyContent: 'space-between' }}><h1>{n}'s shelf</h1><div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--sun1)', overflow: 'hidden' }}><Avatar look={look} width={52} /></div></div>
    <motion.div {...rise(0)} className="card" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--teal1)', borderColor: '#B5ECE5', boxShadow: '0 4px 0 #B5ECE5' }}><Nibbs width={56} /><div><b>🔥 1-night reading streak!</b><div className="cap">Read tonight to keep it going</div></div></motion.div>
    <div className="scroll" style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14, alignContent: "start" }}>
      {[...books.map(b => ({ b, st: '📖 Ready' })), { b: null, st: '✨ Sample' }].map(({ b, st }, i) => { const t = b ? THEMES.find(x => x.id === b)! : null;
        return <motion.button key={i} className="book" initial={{ opacity: 0, y: -40, scale: 0.7 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.08, duration: D.slow, ease: E.enter }} onClick={() => { if (b) { setTheme(b); go('reader'); } }}>
          <div className="img" style={{ aspectRatio: '3/4', borderRadius: '6px 16px 16px 6px', backgroundImage: `url(${img(t ? t.image : 'cover.jpg')})`, boxShadow: '0 5px 0 var(--line),inset 6px 0 0 rgba(0,0,0,.14)' }} />
          <b style={{ display: 'block', marginTop: 8, fontSize: 14 }}>{t ? t.title : 'Fly to the Moon'}</b><span className="chip" style={{ padding: '3px 8px', fontSize: 11, marginTop: 4 }}>{st}</span></motion.button>; })}</div></>}
    <Tabbar on="Shelf" go={go} /></div>,

  settings: p => <Settings {...p} />,
};

function Consent({ go }: { go: (s: Screen) => void }) {
  const [ok, setOk] = useState(false);
  return <div className="body"><Top close={() => go('onboarding')} pct={15} />
    <Says mood="idle">First, a quick grown-up check! 🛡️</Says>
    <div className="card" style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[['🎨', 'Photos only help draw the avatar', 'Never used to train AI'], ['🗑️', 'Auto-deleted after delivery', 'Or delete any time'], ['🔒', 'Private by default', 'Only links you create']].map(([i, b, c], k) =>
        <motion.div key={b} className="row" {...rise(k + 1)}><span style={{ fontSize: 26 }}>{i}</span><div><b>{b}</b><div className="cap">{c}</div></div></motion.div>)}</div>
    <label className={`card${ok ? ' sel' : ''}`} style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
      <input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} className="sr" aria-label="I am the parent or guardian and agree" />
      <motion.span animate={{ background: ok ? '#1CB0F6' : '#ffffff', scale: ok ? [1, 1.15, 1] : 1 }} transition={{ duration: D.base, ease: E.bounce }} style={{ width: 28, height: 28, borderRadius: 8, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900, flexShrink: 0, border: ok ? 0 : '2px solid var(--line)' }}>{ok ? '✓' : ''}</motion.span>
      <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 700 }}>I'm the parent or guardian, and I agree to the <u>Privacy Notice</u> (COPPA / GDPR / DPDP).</span></label>
    <div className="spacer" /><Btn disabled={!ok} className={`btn primary${ok ? '' : ' off'}`} onClick={() => ok && go('upload')}>Verify with OTP</Btn>
    <p className="cap" style={{ textAlign: 'center', marginTop: 10 }}>Demo: no OTP is sent</p></div>;
}

function Upload({ go, photos, setPhotos }: P) {
  const ref = useRef<HTMLInputElement>(null);
  const [mood, setMood] = useState<'error' | undefined>();
  const add = (files: FileList | null) => { if (!files) return; const ok = [...files].filter(f => f.type.startsWith('image/')); if (ok.length < files.length) { setMood(undefined); setTimeout(() => setMood('error')); } setPhotos(p => [...p, ...ok.map(f => URL.createObjectURL(f))].slice(0, 3)); };
  const tints = ['var(--sun1)', 'var(--teal1)', 'var(--coral1)'];
  return <div className="body"><Top close={() => go('consent')} pct={30} />
    <Says mood="thinking" trigger={mood}>Add a photo or two. I'll use them to suggest features, and you'll confirm everything next.</Says>
    <input ref={ref} type="file" accept="image/*" multiple hidden data-testid="file" onChange={e => add(e.target.files)} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 18 }}>
      {[0, 1, 2].map(i => photos[i] ? <motion.div key={photos[i] + i} className="card" initial={{ y: -40, scale: 0.7, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ duration: D.slow, ease: E.enter }}
        style={{ aspectRatio: '3/4', padding: 0, display: 'grid', placeItems: 'center', background: photos[i].startsWith('blob:') ? `center/cover url(${photos[i]})` : tints[i], position: 'relative', fontSize: 34 }}>
        {photos[i].startsWith('blob:') ? '' : photos[i]}
        <motion.span initial={{ scale: 0 }} animate={{ scale: [0, 1.15, 1] }} transition={{ delay: 0.35, duration: D.base, ease: E.bounce }} className="badge">✓</motion.span></motion.div>
        : <motion.button key={'e' + i} whileTap={{ scale: 0.95 }} className="slot" aria-label="Add photo" onClick={() => ref.current?.click()}>＋</motion.button>)}</div>
    <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 16 }}><span className="chip">☀️ Good light</span><span className="chip">👀 Eyes visible</span><span className="chip">🧢 No hats</span></div>
    <motion.button whileTap={{ y: 3 }} className="card" onClick={() => go('create')} style={{ marginTop: 14, background: 'var(--indigo1)', borderColor: '#D3D1F5', boxShadow: '0 4px 0 #D3D1F5', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}><b>No photo? No problem.</b><div className="cap">Skip it and build the avatar by hand.</div></motion.button>
    {photos.length < 2 && <button className="cap linkish" onClick={() => setPhotos(p => [...p, '🙂', '😄'].slice(0, 2))}>Demo: use sample photos</button>}
    <div className="spacer" /><Btn onClick={() => go('create')}>Continue</Btn>
    <p className="cap" style={{ textAlign: 'center', marginTop: 10 }}>🔒 Demo: photos stay in your browser, never uploaded</p></div>;
}

function Create({ go, hero, setHero, look, setLook, cape, n }: P) {
  const toggle = (k: 'glasses' | 'freckles') => setLook({ ...look, [k]: !look[k] });
  return <div className="body"><Top close={() => go('upload')} pct={50} />
    <div style={{ height: 230, flexShrink: 0, borderRadius: 30, background: 'var(--teal1)', position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
      <motion.div key={JSON.stringify(look) + cape} initial={{ scale: 0.94, y: 6 }} animate={{ scale: 1, y: 0 }} transition={{ duration: D.base, ease: E.bounce }}><Avatar look={look} cape={cape} width={175} style={{ marginBottom: -6 }} label={`${n}'s avatar preview`} /></motion.div>
      <Nibbs width={90} style={{ position: 'absolute', right: 14, bottom: 10 }} />
      <span className="chip" style={{ position: 'absolute', left: 12, top: 12 }}>✨ Suggested from photo</span></div>
    <div className="scroll">
      <div className="row" style={{ marginTop: 12 }}><input aria-label="Child's name" className="card field" value={hero.name} maxLength={20} onChange={e => setHero({ ...hero, name: e.target.value })} />
        <select aria-label="Age" className="card field" style={{ width: 78, flex: 'none' }} value={hero.age} onChange={e => setHero({ ...hero, age: +e.target.value })}>{[2, 3, 4, 5, 6, 7, 8].map(a => <option key={a}>{a}</option>)}</select>
        <select aria-label="Pronoun" className="card field" style={{ width: 96, flex: 'none' }} value={hero.pronoun} onChange={e => setHero({ ...hero, pronoun: e.target.value as Pronoun })}><option value="she">she</option><option value="he">he</option><option value="they">they</option></select></div>
      <div className="cap" style={{ marginTop: 12 }}>SKIN TONE</div><div className="row" style={{ marginTop: 8, gap: 12 }}>{SKINS.map(s => <motion.button key={s} aria-label={`Skin tone ${s}`} aria-pressed={look.skin === s} whileTap={{ scale: 0.88 }} onClick={() => setLook({ ...look, skin: s })} className="swatch" style={{ background: s, outline: look.skin === s ? '4px solid var(--sky)' : 'none' }} />)}</div>
      <div className="cap" style={{ marginTop: 12 }}>HAIR</div><div className="row" style={{ marginTop: 8, gap: 6, width: "100%" }}>{HAIRS.map(h => <motion.button key={h} aria-label={`Hair ${h}`} aria-pressed={look.hair === h} whileTap={{ y: 3 }} onClick={() => setLook({ ...look, hair: h })} className={`card hairopt${look.hair === h ? ' sel' : ''}`}><Avatar look={{ ...look, hair: h }} width={46} /></motion.button>)}</div>
      <div className="cap" style={{ marginTop: 12 }}>EXTRAS</div><div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <Chip on={look.glasses} onClick={() => toggle('glasses')}>👓 Glasses</Chip><Chip on={look.freckles} onClick={() => toggle('freckles')}>✨ Freckles</Chip>
        <Chip on={hero.outfit === 'Raincoat'} onClick={() => { setHero({ ...hero, outfit: 'Raincoat' }); setLook({ ...look, outfit: '#FFC800' }); }}>🧥 Raincoat</Chip>
        <Chip on={hero.outfit === 'Cape'} onClick={() => { setHero({ ...hero, outfit: 'Cape' }); setLook({ ...look, outfit: '#3B3A9E' }); }}>🦸 Cape</Chip></div></div>
    <Btn style={{ marginTop: 12, flexShrink: 0 }} onClick={() => go('reveal')}>That's {n}!</Btn></div>;
}

const MSGS = (n: string, p: number) => [`Nibbs is writing ${n}'s story…`, 'Nibbs is sketching…', `Nibbs is painting page ${p} of 24…`, 'Nibbs is binding the book…'];
function Loader({ n, done }: { n: string; done: () => void }) {
  const [pct, setPct] = useState(4);
  const [m, setM] = useState(0);
  useEffect(() => {
    const a = setInterval(() => setPct(p => Math.min(100, p + 8 + Math.random() * 6)), 420);
    const b = setInterval(() => setM(x => (x + 1) % 4), 2000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  useEffect(() => { if (pct >= 100) { const t = setTimeout(done, 900); return () => clearTimeout(t); } }, [pct]);
  const page = Math.max(1, Math.round((pct / 100) * 24));
  const msg = pct >= 92 ? 3 : m === 3 ? 2 : m;
  return <div className="body"><div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', justifyContent: 'center' }}>
    <Nibbs mood={pct >= 100 ? 'celebrate' : 'thinking'} width={220} />
    <div style={{ minHeight: 72, marginTop: 8, overflow: 'hidden', width: '100%' }}><AnimatePresence mode="wait"><motion.h1 key={msg} initial={{ y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -28, opacity: 0 }} transition={{ duration: D.base, ease: E.std }}>{MSGS(n, page)[msg]}</motion.h1></AnimatePresence></div>
    <p className="lead">{n} is peeking through the little door.</p>
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} style={{ width: '100%', height: 20, marginTop: 22, flex: 'none' }}>
      <motion.i className="shimmer" style={{ transformOrigin: 'left', width: '100%' }} initial={{ scaleX: 0.04 }} animate={{ scaleX: pct / 100 }} transition={{ duration: 0.6, ease: E.std }} /></div>
    <div className="card" style={{ marginTop: 22, textAlign: 'left', width: '100%' }}><div className="cap" style={{ color: 'var(--teal-d)' }}>FUN FACT</div><p style={{ marginTop: 6, fontWeight: 700 }}>Kids who see themselves in stories read for longer. 📖</p></div></div>
    <p className="cap" style={{ textAlign: 'center' }}>Demo: sample story with {n}'s details · no AI calls</p></div>;
}

function speak(text: string, opts: { rate?: number; pitch?: number; lang?: string; onend?: () => void; onword?: (i: number) => void } = {}) {
  const ss = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!ss) { opts.onend && setTimeout(opts.onend, 2500); return; }
  ss.cancel(); const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 0.95; u.pitch = opts.pitch ?? 1; u.lang = opts.lang ?? 'en-US';
  const v = ss.getVoices().find(v => v.lang.startsWith(u.lang.slice(0, 2))); if (v) u.voice = v;
  u.onend = () => opts.onend?.();
  u.onboundary = e => { if (e.name === 'word' || e.name === undefined) opts.onword?.(text.slice(0, e.charIndex).split(/\s+/).filter(Boolean).length); };
  ss.speak(u);
}

function Reader({ go, story, n }: { go: (s: Screen) => void; story: Story; n: string }) {
  const [i, setI] = useState(0);
  const [turn, setTurn] = useState<0 | 1 | -1>(0);
  const [word, setWord] = useState(-1);
  const [reading, setReading] = useState(false);
  const rm = useReducedMotion();
  const N = story.pages.length;
  const flip = (d: 1 | -1) => { if (turn || i + d < 0 || i + d >= N) return; window.speechSynthesis?.cancel(); setReading(false); setWord(-1); setTurn(d); };
  const finish = () => { setI(x => x + turn); setTurn(0); };
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);
  const read = () => { if (reading) { window.speechSynthesis?.cancel(); setReading(false); setWord(-1); return; } setReading(true); speak(story.pages[i].text, { onword: setWord, onend: () => { setReading(false); setWord(-1); } }); };
  const Pg = ({ k }: { k: number }) => { const p = story.pages[k]; const words = p.text.split(' ');
    return <div className="pg"><div className="img" role="img" aria-label={`Illustration: ${p.text}`} style={{ flex: 1, borderRadius: 0, backgroundImage: `url(${img(p.image)})`, backgroundPosition: p.pos }} />
      <div className="story-text" data-testid="page-text">{words.map((w, j) => { const hl = word >= 0 ? j === word : w.replace(/\W/g, '') === n; return <span key={j}>{hl ? <mark>{w}</mark> : w}{' '}</span>; })}</div></div>; };
  const next = turn === 1 ? i + 1 : turn === -1 ? i - 1 : i;
  return <div className="body">
    <Top close={() => go('library')} pct={((i + 1) / N) * 100} color="var(--sky)" right={<span style={{ fontWeight: 900, color: 'var(--muted)' }} data-testid="page-no">{i + 1}/{N}</span>} />
    <div className="book-wrap" onClick={e => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; if (x > 0.8) flip(1); else if (x < 0.2) flip(-1); }}>
      <motion.div className="bookpg under" drag={turn ? false : 'x'} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.3} onDragEnd={(_, inf) => { if (inf.offset.x < -80) flip(1); else if (inf.offset.x > 80) flip(-1); }}><Pg k={turn === 1 ? next : i} /></motion.div>
      {turn !== 0 && (rm
        ? <motion.div className="bookpg" initial={{ opacity: turn === 1 ? 1 : 0 }} animate={{ opacity: turn === 1 ? 0 : 1 }} transition={{ duration: 0.2 }} onAnimationComplete={finish}><Pg k={turn === 1 ? i : next} /></motion.div>
        : <motion.div className="bookpg turning" style={{ transformOrigin: 'left center' }} initial={{ rotateY: turn === 1 ? 0 : -180 }} animate={{ rotateY: turn === 1 ? -180 : 0 }} transition={{ duration: D.page, ease: E.page }} onAnimationComplete={finish}>
          <Pg k={turn === 1 ? i : next} />
          <motion.div className="shade" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: D.page, times: [0, 0.45, 1] }} /></motion.div>)}
    </div>
    <div className="row" style={{ marginTop: 14 }}><Nibbs mood={reading ? 'talking' : 'idle'} width={70} />
      <Btn kind="ghost" style={{ height: 50 }} onClick={read} aria-label="Read aloud">{reading ? '⏸ Stop' : '🔊 Read to me'}</Btn>
      {i < N - 1 ? <Btn kind="sun" style={{ height: 50, width: 110, flexShrink: 0 }} onClick={() => flip(1)} aria-label="Next page">Next ▶</Btn>
        : <Btn kind="sun" style={{ height: 50, width: 110, flexShrink: 0 }} onClick={() => go('checkout')}>Print 📕</Btn>}</div>
    <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}><button className="cap linkish" style={{ margin: 0 }} onClick={() => flip(-1)} disabled={i === 0} aria-label="Previous page">◀ Back</button>
      <button className="cap linkish" style={{ margin: 0 }} onClick={() => go('video')}>🎬 Watch</button><button className="cap linkish" style={{ margin: 0 }} onClick={() => go('checkout')}>📕 Print book</button></div></div>;
}

const VOICES = { '🐉 Nibbs': { rate: 1.05, pitch: 1.35 }, '🌙 Gentle Grandma': { rate: 0.85, pitch: 0.9 }, '🎙️ Your voice': { rate: 1, pitch: 1 } } as Record<string, { rate: number; pitch: number }>;
const LANGS = { English: 'en-US', 'हिन्दी': 'hi-IN', Deutsch: 'de-DE' } as Record<string, string>;
function Video({ go, story }: { go: (s: Screen) => void; story: Story }) {
  const [voice, setVoice] = useState('🐉 Nibbs');
  const [lang, setLang] = useState('English');
  const [playing, setPlaying] = useState(false);
  const [i, setI] = useState(0);
  const N = story.pages.length;
  const live = useRef(false);
  const run = (k: number) => {
    if (!live.current) return;
    if (k >= N) { setPlaying(false); live.current = false; setI(0); return; }
    setI(k); speak(story.pages[k].text, { ...VOICES[voice], lang: LANGS[lang], onend: () => setTimeout(() => run(k + 1), 500) });
  };
  const toggle = () => { if (playing) { live.current = false; setPlaying(false); window.speechSynthesis?.cancel(); } else { live.current = true; setPlaying(true); run(i); } };
  useEffect(() => () => { live.current = false; window.speechSynthesis?.cancel(); }, []);
  const p = story.pages[i];
  return <div className="body tabbed">
    <div className="player" onClick={toggle} role="button" aria-label={playing ? 'Pause video' : 'Play video'}>
      <AnimatePresence><motion.div key={i} className="kb" initial={{ opacity: 0, scale: 1 }} animate={{ opacity: 1, scale: playing ? 1.15 : 1.02, x: playing ? (i % 2 ? -14 : 14) : 0 }} exit={{ opacity: 0 }} transition={{ opacity: { duration: 0.8 }, scale: { duration: 7, ease: 'linear' }, x: { duration: 7, ease: 'linear' } }}
        style={{ backgroundImage: `url(${img(p.image)})`, backgroundPosition: p.pos }} /></AnimatePresence>
      {playing && <><motion.div key={'c' + i} className="caption" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{p.text}</motion.div><Nibbs mood="talking" width={64} style={{ position: 'absolute', right: 10, top: 10 }} /></>}
      {!playing && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><motion.div whileHover={{ scale: 1.06 }} whileTap={{ y: 4, boxShadow: '0 0 0 #000' }} className="playbtn">▶</motion.div></div>}
      <div className="vbar"><motion.i animate={{ width: `${((i + (playing ? 1 : 0)) / N) * 100}%` }} transition={{ duration: 0.6, ease: E.std }} /></div></div>
    <div className="scroll">
      <h1 style={{ marginTop: 18 }}>{story.title}</h1><p className="cap">{N} scenes · narrated by {voice.split(' ').slice(1).join(' ')} (browser voice)</p>
      <div className="cap" style={{ marginTop: 16 }}>NARRATOR</div><div className="row wrap">{Object.keys(VOICES).map(v => <Chip key={v} on={voice === v} onClick={() => setVoice(v)}>{v}</Chip>)}</div>
      <div className="cap" style={{ marginTop: 14 }}>LANGUAGE</div><div className="row wrap">{Object.keys(LANGS).map(v => <Chip key={v} on={lang === v} onClick={() => setLang(v)}>{v}</Chip>)}</div>
      {voice === '🎙️ Your voice' && <p className="cap" style={{ marginTop: 8 }}>Demo: voice cloning isn't included, so the default voice is used.</p>}</div>
    <div className="row" style={{ marginTop: 12 }}><Btn kind="ghost" onClick={() => alert('Demo: MP4 export is not part of this demo.')}>Save MP4</Btn><Btn onClick={() => go('share')}>Share</Btn></div>
    <Tabbar on="Watch" go={go} /></div>;
}

function Checkout({ go, story, n }: { go: (s: Screen) => void; story: Story; n: string }) {
  const [f, setF] = useState<string>('hard');
  const [paying, setPaying] = useState(false);
  const price = FORMATS.find(x => x.id === f)!.price;
  return <div className="body">
    <div className="top"><button className="x" aria-label="Back" onClick={() => go('reader')}>←</button><h2 style={{ flex: 1, whiteSpace: 'nowrap' }}>Order the book</h2><span className="demo-tag">DEMO</span></div>
    <div style={{ height: 210, flexShrink: 0, borderRadius: 26, background: 'var(--sun1)', display: 'grid', placeItems: 'center', position: 'relative', perspective: 700 }}>
      <motion.div animate={{ rotateY: [-14, -22, -14] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} style={{ width: 145, height: 190, borderRadius: '6px 16px 16px 6px', background: `url(${img('cover.jpg')}) center/cover`, boxShadow: '0 24px 40px -12px rgba(29,27,58,.5),inset 8px 0 0 rgba(0,0,0,.18)', position: 'relative' }}>
        <b style={{ position: 'absolute', left: 12, right: 8, top: 12, color: '#fff', fontWeight: 900, fontSize: 16, lineHeight: '20px' }}>{n} &amp; Nibbs<br /><span style={{ color: 'var(--sun)' }}>{story.title.replace(`${n}'s `, '')}</span></b></motion.div>
      <Nibbs trigger="wave" width={80} style={{ position: 'absolute', right: 12, bottom: 8 }} /></div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
      {FORMATS.map(x => <motion.button key={x.id} whileTap={{ y: 4 }} className={`card fmt${f === x.id ? ' sel' : ''}`} aria-pressed={f === x.id} onClick={() => setF(x.id)}>
        <div><b>{x.name}</b><div className="cap">{x.id === 'hard' ? 'Lay-flat · gift box · sticker sheet' : x.meta}</div></div><b>${x.price.toFixed(2)}</b></motion.button>)}</div>
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, fontWeight: 700 }}><span>Video + e-book</span><span className="chip" style={{ background: 'var(--teal1)', borderColor: 'var(--teal1)', boxShadow: 'none', color: 'var(--teal-d)' }}>FREE</span></div>
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 6, fontWeight: 700 }}><span>Shipping (US)</span><b>${SHIPPING.toFixed(2)}</b></div>
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}><b style={{ fontSize: 18 }}>Total</b><b style={{ fontSize: 24 }} data-testid="total">${orderTotal(price).toFixed(2)}</b></div>
    <div className="spacer" /><Btn kind="indigo" disabled={paying} onClick={() => { setPaying(true); setTimeout(() => go('share'), 900); }}>{paying ? 'Placing demo order…' : 'Place demo order (no charge)'}</Btn>
    <p className="cap" style={{ textAlign: 'center', marginTop: 8 }}>Demo checkout: no card, no payment · prices proposed</p></div>;
}

function ShareRow() {
  const [copied, setCopied] = useState(false);
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginTop: 16, textAlign: 'center', fontSize: 12, fontWeight: 900 }}>
    {[['✆', 'WhatsApp', 'wa'], ['✉', 'Email', 'ghost'], ['🔗', copied ? 'Copied!' : 'Copy', 'ghost'], ['🎁', 'Gift', 'sun']].map(([i, l, k]) =>
      <div key={i}><Btn kind={k === 'wa' ? 'wa' : k} style={{ width: 56, height: 56, margin: '0 auto 4px', padding: 0 }} aria-label={l} onClick={() => { if (i === '🔗') { navigator.clipboard?.writeText(location.href).catch(() => {}); setCopied(true); } }}>{i}</Btn>{l}</div>)}</div>;
}

function Settings({ go, n, look, photosDeleted, setPhotosDeleted, photos }: P) {
  const [t, setT] = useState([true, true, false]);
  const [sheet, setSheet] = useState(false);
  const count = Math.max(photos.length, 2);
  const set = (k: number) => (v: boolean) => setT(t.map((x, j) => (j === k ? v : x)));
  return <div className="body tabbed" style={{ position: 'relative' }}>
    <h1>Grown-ups</h1><div className="cap" style={{ marginTop: 4 }}>🔒 Locked with a parent PIN (demo: no PIN)</div>
    <div className="card" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--sun1)', overflow: 'hidden', flexShrink: 0 }}><Avatar look={look} width={54} /></div><div style={{ flex: 1 }}><b>{n}</b><div className="cap">{photosDeleted ? 'Avatar saved · photos deleted ✓' : `Avatar saved · ${count} photos stored · auto-delete Nov 20`}</div></div>›</div>
    <div className="cap" style={{ marginTop: 16 }}>PRIVACY</div>
    <div className="card" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row"><div style={{ flex: 1 }}><b>Auto-delete photos after delivery</b></div><Toggle on={t[0]} set={set(0)} label="Auto-delete photos" /></div>
      <div className="row"><div style={{ flex: 1 }}><b>Keep avatar only (no photos)</b><div className="cap">Recommended</div></div><Toggle on={t[1]} set={set(1)} label="Keep avatar only" /></div>
      <div className="row"><div style={{ flex: 1 }}><b>Marketing emails</b></div><Toggle on={t[2]} set={set(2)} label="Marketing emails" /></div></div>
    <Btn kind="danger" style={{ marginTop: 16, opacity: photosDeleted ? 0.5 : 1 }} disabled={photosDeleted} onClick={() => setSheet(true)}>{photosDeleted ? 'Photos deleted' : `Delete ${n}'s photos now`}</Btn>
    <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}><span className="cap">Download my data</span><span className="cap" style={{ color: 'var(--danger)' }}>Delete account</span></div>
    <div className="spacer" /><Tabbar on="Grown-ups" go={go} />
    <AnimatePresence>{sheet && <motion.div key="scrim" className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: D.base, ease: E.exit } }} onClick={() => setSheet(false)}>
      <motion.div className="sheet" role="dialog" aria-label="Delete photos" onClick={e => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%', transition: { duration: D.base, ease: E.exit } }} transition={{ duration: D.slow, ease: E.enter }}
        drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 1 }} onDragEnd={(_, i) => { if (i.offset.y > 120) setSheet(false); }}>
        <div className="grab" /><Nibbs mood="sad" width={130} style={{ margin: 'auto', display: 'block' }} />
        <h2>Delete {n}'s photos?</h2><p className="lead">{count} photos and the face data are erased for good. The avatar and finished books stay.</p>
        <Btn kind="danger" style={{ marginTop: 20 }} onClick={() => { setPhotosDeleted(true); setSheet(false); }}>Yes, delete photos</Btn>
        <Btn kind="ghost" style={{ marginTop: 12 }} onClick={() => setSheet(false)}>Keep them</Btn></motion.div></motion.div>}</AnimatePresence></div>;
}
