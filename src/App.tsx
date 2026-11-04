import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { D, E, img } from './motion';
import { FORMATS, THEMES, cleanName, makeStory, orderTotal, SHIPPING, type Hero, type Pronoun, type Theme } from './story';

export type Screen = 'onboarding' | 'consent' | 'upload' | 'create' | 'reveal' | 'pick' | 'loading' | 'reader' | 'video' | 'checkout' | 'share' | 'library' | 'settings';
const ORDER: Screen[] = ['onboarding', 'consent', 'upload', 'create', 'reveal', 'pick', 'loading', 'reader', 'video', 'checkout', 'share', 'library', 'settings'];
const avatar = { backgroundImage: `url(${img('character-sheet-mira.jpg')})`, backgroundSize: '400% 200%', backgroundPosition: '0% 0%', backgroundRepeat: 'no-repeat' };

function Btn({ kind = 'primary', children, style, ...p }: { kind?: string; children: ReactNode; style?: React.CSSProperties } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const rm = useReducedMotion();
  return <motion.button className={`btn ${kind}`} style={style} whileTap={rm ? undefined : { scale: 0.96, y: 4, boxShadow: kind === 'primary' ? '0 2px 0 var(--indigo9)' : kind === 'sun' ? '0 2px 0 #D69A12' : undefined }} transition={{ duration: D.fast, ease: E.bounce }} {...(p as object)}>{children}</motion.button>;
}
function Chip({ on, children, onClick }: { on?: boolean; children: ReactNode; onClick?: () => void }) {
  return <motion.button type="button" className={`chip${on ? ' on' : ''}`} onClick={onClick} whileTap={{ scale: 0.94 }} aria-pressed={!!on} style={{ border: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>{children}</motion.button>;
}
function Top({ back, pct, children }: { back: () => void; pct?: number; children?: ReactNode }) {
  return <div className="top"><button className="icon-btn" aria-label="Back" onClick={back}>←</button>
    {pct !== undefined ? <div className="progress"><motion.i initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: E.std }} /></div> : children}</div>;
}
function Tabbar({ on, go }: { on: string; go: (s: Screen) => void }) {
  const t: [string, string, Screen][] = [['📚', 'Library', 'library'], ['✨', 'Create', 'upload'], ['🎬', 'Watch', 'video'], ['⚙️', 'Settings', 'settings']];
  return <nav className="tabbar">{t.map(([i, l, s]) => <button key={l} className={on === l ? 'on' : ''} onClick={() => go(s)}><b>{i}</b>{l}</button>)}</nav>;
}
function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} className="tg" style={{ background: on ? 'var(--teal)' : 'var(--cream2)' }}>
    <motion.span layout transition={{ duration: D.fast, ease: E.bounce }} style={{ marginLeft: on ? 23 : 3 }} /></button>;
}

export default function App({ initial = 'onboarding' as Screen }) {
  const [screen, setScreen] = useState<Screen>(() => { const h = location.hash.slice(1) as Screen; return ORDER.includes(h) ? h : initial; });
  const [dir, setDir] = useState(1);
  const [hero, setHero] = useState<Hero>({ name: 'Mira', age: 6, pronoun: 'she', outfit: 'Raincoat', sidekick: '🦊 Fox' });
  const [theme, setTheme] = useState<Theme>('door');
  const [dedication, setDedication] = useState('For Mira, who is braver than she knows. Love, Papa');
  const [books, setBooks] = useState<Theme[]>([]);
  const [photosDeleted, setPhotosDeleted] = useState(false);
  const go = (s: Screen) => { setDir(ORDER.indexOf(s) >= ORDER.indexOf(screen) ? 1 : -1); setScreen(s); window.scrollTo(0, 0); };
  useEffect(() => { history.replaceState(null, '', '#' + screen); }, [screen]);
  const story = makeStory(theme, hero, dedication);
  const n = cleanName(hero.name);
  const her = hero.pronoun === 'she' ? 'her' : hero.pronoun === 'he' ? 'his' : 'their';
  const props = { go, hero, setHero, n, her, theme, setTheme, story, dedication, setDedication, books, setBooks, photosDeleted, setPhotosDeleted };
  const rm = useReducedMotion();
  const variants = rm ? { i: { opacity: 0 }, a: { opacity: 1, x: 0 }, x: { opacity: 0 } } : {
    i: (d: number) => ({ x: d > 0 ? '100%' : '-30%', opacity: d > 0 ? 1 : 0 }), a: { x: 0, opacity: 1 },
    x: (d: number) => ({ x: d > 0 ? '-30%' : '100%', opacity: d > 0 ? 0 : 1 }),
  };
  return <MotionConfig reducedMotion="user"><div className="stage"><div className="phone" data-screen={screen}>
    <div className="status"><span>9:41</span><span className="demo-pill">DEMO</span><span className="i">●●● ▮</span></div>
    <AnimatePresence initial={false} custom={dir} mode="popLayout">
      <motion.div key={screen} className="screen" custom={dir} variants={variants} initial="i" animate="a" exit="x" transition={{ duration: rm ? 0.15 : D.base, ease: E.std }}>
        {SCREENS[screen](props)}
      </motion.div>
    </AnimatePresence>
  </div></div></MotionConfig>;
}
type P = { go: (s: Screen) => void; hero: Hero; setHero: (h: Hero) => void; n: string; her: string; theme: Theme; setTheme: (t: Theme) => void; story: ReturnType<typeof makeStory>; dedication: string; setDedication: (s: string) => void; books: Theme[]; setBooks: (b: Theme[]) => void; photosDeleted: boolean; setPhotosDeleted: (b: boolean) => void };

const SCREENS: Record<Screen, (p: P) => ReactNode> = {
  onboarding: ({ go }) => <div className="body">
    <motion.div className="img" initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 1.4, ease: E.enter }} style={{ height: 430, margin: '-8px -20px 0', borderRadius: '0 0 40px 40px', backgroundImage: `url(${img('landing-hero.jpg')})`, backgroundPosition: '70% center' }} role="img" aria-label="A child in a yellow raincoat with a fox at a glowing tree door" />
    <motion.div style={{ marginTop: 24 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: D.slow, ease: E.enter }}>
      <div className="cap" style={{ color: 'var(--fox)' }}>STARRING ME</div>
      <h1 style={{ marginTop: 6 }}>Every bedtime story,<br />starring your child.</h1>
      <p className="lead">Upload a photo, pick an adventure, and we paint a picture book where your little one is the hero.</p></motion.div>
    <div className="spacer" />
    <div className="row" style={{ justifyContent: 'center', gap: 6, marginBottom: 16 }}><i className="dot on" /><i className="dot" /><i className="dot" /></div>
    <Btn onClick={() => go('consent')}>Make a free preview ✨</Btn>
    <p className="cap" style={{ textAlign: 'center', marginTop: 12 }}>Already have a book? <u style={{ cursor: 'pointer' }} onClick={() => go('library')}>Sign in</u></p></div>,

  consent: ({ go }) => <Consent go={go} />,
  upload: ({ go }) => <Upload go={go} />,

  create: ({ go, hero, setHero, n }) => <div className="body">
    <Top back={() => go('upload')} pct={60} />
    <h1>Meet your hero</h1><p className="lead">Tweak anything that doesn't look right.</p>
    <div style={{ marginTop: 14, height: 250, flexShrink: 0, borderRadius: 28, background: 'radial-gradient(circle at 50% 60%,#FDF1CF,#FFF8EE 70%)', position: 'relative', overflow: 'hidden', boxShadow: 'var(--sh-md)' }}>
      <motion.div key={hero.outfit + hero.sidekick} initial={{ opacity: 0.4, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: D.slow, ease: E.enter }} style={{ position: 'absolute', inset: 0, ...avatar }} role="img" aria-label={`Painted character of ${n}`} />
      <span className="chip" style={{ position: 'absolute', left: 12, bottom: 12 }}>✨ {n}, age {hero.age}</span></div>
    <div className="scroll">
      <div style={{ marginTop: 16 }}><div className="cap">NAME</div>
        <div className="row" style={{ marginTop: 6 }}><input aria-label="Child's name" className="card field" value={hero.name} maxLength={20} onChange={e => setHero({ ...hero, name: e.target.value })} />
          <select aria-label="Age" className="card field" style={{ width: 84, flex: 'none' }} value={hero.age} onChange={e => setHero({ ...hero, age: +e.target.value })}>{[2, 3, 4, 5, 6, 7, 8].map(a => <option key={a}>{a}</option>)}</select></div></div>
      <div style={{ marginTop: 14 }}><div className="cap">PRONOUN</div><div className="row wrap">{(['she', 'he', 'they'] as Pronoun[]).map(p => <Chip key={p} on={hero.pronoun === p} onClick={() => setHero({ ...hero, pronoun: p })}>{p === 'she' ? 'She / her' : p === 'he' ? 'He / him' : 'They / them'}</Chip>)}</div></div>
      <div style={{ marginTop: 14 }}><div className="cap">OUTFIT</div><div className="row wrap">{['Raincoat', 'Explorer', 'Superhero', 'Kurta'].map(o => <Chip key={o} on={hero.outfit === o} onClick={() => setHero({ ...hero, outfit: o })}>{o}</Chip>)}</div></div>
      <div style={{ marginTop: 14 }}><div className="cap">SIDEKICK</div><div className="row wrap">{['🦊 Fox', '🐘 Elephant', '🐉 Dragon'].map(o => <Chip key={o} on={hero.sidekick === o} onClick={() => setHero({ ...hero, sidekick: o })}>{o}</Chip>)}</div></div>
    </div>
    <Btn style={{ marginTop: 12, flexShrink: 0 }} onClick={() => go('reveal')}>Looks like {n}! →</Btn></div>,

  reveal: ({ go, n, her }) => <Reveal go={go} n={n} her={her} />,

  pick: ({ go, n, theme, setTheme, dedication, setDedication }) => <div className="body">
    <Top back={() => go('reveal')} pct={80} />
    <h1>Pick {n}'s adventure</h1>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      {THEMES.map((t, i) => <motion.button key={t.id} className="card pick" onClick={() => setTheme(t.id)} aria-pressed={theme === t.id} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, duration: D.slow, ease: E.enter }} whileTap={{ scale: 0.98 }}
        style={{ outline: theme === t.id ? '3px solid var(--indigo)' : '3px solid transparent' }}>
        <div className="img" style={{ width: 96, height: 80, borderRadius: 14, flexShrink: 0, backgroundImage: `url(${img(t.image)})` }} />
        <div><b style={{ fontSize: 16 }}>{t.title}</b><div className="cap" style={{ marginTop: 4 }}>{t.meta}</div></div></motion.button>)}</div>
    <label className="card" style={{ marginTop: 12, background: 'var(--sun1)', boxShadow: 'none', display: 'block' }}><b>✍️ Add a dedication</b>
      <textarea aria-label="Dedication" className="ded cap" rows={2} value={dedication} onChange={e => setDedication(e.target.value.slice(0, 140))} /></label>
    <div className="spacer" /><Btn onClick={() => go('loading')}>Write my story ✨</Btn></div>,

  loading: ({ go, n, theme, books, setBooks }) => <Loader n={n} done={() => { if (!books.includes(theme)) setBooks([theme, ...books]); go('reader'); }} />,
  reader: ({ go, story, n }) => <Reader go={go} story={story} n={n} />,
  video: ({ go, story, books }) => <Video go={go} story={story} has={books.length > 0} />,
  checkout: ({ go, story }) => <Checkout go={go} story={story} />,

  share: ({ go, story }) => <div className="body" style={{ paddingBottom: 12 }}>
    <div style={{ textAlign: 'center', paddingTop: 10 }}><motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ duration: D.slow, ease: E.bounce }} style={{ fontSize: 44 }}>🎉</motion.div>
      <h1 style={{ marginTop: 6 }}>Book on its way!</h1><p className="lead">Demo order: nothing was charged. Arrives Nov 12–15. Share the magic while you wait.</p></div>
    <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: D.slow, ease: E.enter }} style={{ marginTop: 20, borderRadius: 24, overflow: 'hidden', boxShadow: 'var(--sh-lg)', background: '#fff' }}>
      <div className="img" style={{ height: 220, borderRadius: 0, backgroundImage: `url(${img(story.pages[0].image)})` }} /><div style={{ padding: '14px 16px' }}><b>{story.title}</b><div className="cap">Private link · expires in 30 days · face blurred in preview ✓</div></div></motion.div>
    <ShareRow />
    <div className="spacer" /><div className="card" style={{ background: 'var(--indigo1)', boxShadow: 'none' }}><b>Give $10, get $10</b><div className="cap">Friends get $10 off their first book</div></div>
    <Tabbar on="Library" go={go} /></div>,

  library: ({ go, books, n, setTheme }) => <div className="body" style={{ paddingBottom: 12 }}>{books.length === 0 ? <>
    <h1>Your shelf</h1>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <motion.div className="img" animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }} style={{ width: 240, height: 240, backgroundImage: `url(${img('empty-library.jpg')})` }} role="img" aria-label="Fox reading by an empty shelf" />
      <h2 style={{ marginTop: 16 }}>No stories yet</h2><p className="lead" style={{ maxWidth: 260 }}>Your first adventure takes about 3 minutes. The fox is waiting!</p>
      <Btn style={{ marginTop: 24, width: 240 }} onClick={() => go('upload')}>Create a story ✨</Btn></div></> : <>
    <div className="row" style={{ justifyContent: 'space-between' }}><h1>{n}'s shelf</h1><div className="icon-btn" style={{ background: 'var(--sun1)' }}>👧</div></div>
    <div className="scroll" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16, alignContent: 'start' }}>
      {[...books.map(b => ({ b, st: '📖 Ready to read' })), { b: null, st: '✨ Sample' }].map(({ b, st }, i) => { const t = b ? THEMES.find(x => x.id === b)! : null;
        return <motion.button key={i} className="book" initial={{ opacity: 0, y: -40, scale: 0.7 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.08, duration: D.slow, ease: E.enter }} onClick={() => { if (b) { setTheme(b); go('reader'); } }}>
          <div className="img" style={{ aspectRatio: '3/4', borderRadius: '8px 16px 16px 8px', backgroundImage: `url(${img(t ? t.image : 'spread-04-bedtime.jpg')})`, boxShadow: 'var(--sh-md),inset 6px 0 0 rgba(0,0,0,.12)' }} />
          <b style={{ display: 'block', marginTop: 8, fontSize: 14 }}>{t ? t.title : 'Goodnight, Stars'}</b><span className="cap">{st}</span></motion.button>; })}</div>
    <Btn style={{ marginTop: 12 }} onClick={() => go('pick')}>＋ New story</Btn></>}
    <Tabbar on="Library" go={go} /></div>,

  settings: p => <Settings {...p} />,
};

function Consent({ go }: { go: (s: Screen) => void }) {
  const [ok, setOk] = useState(false);
  return <div className="body"><Top back={() => go('onboarding')} pct={20} />
    <div style={{ fontSize: 40 }}>🛡️</div><h1 style={{ marginTop: 8 }}>First, a grown-up promise</h1>
    <p className="lead">Only a parent or legal guardian can add a child. Here's exactly what we do with photos.</p>
    <div className="card" style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[['🎨', 'Used only to draw the character', 'Never for training AI models'], ['🗑️', 'Auto-deleted after delivery', 'Or delete any time in Settings'], ['🔒', 'Private by default', 'Shared only via links you create']].map(([i, b, c], k) =>
        <motion.div key={b} className="row" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + k * 0.08, duration: D.slow, ease: E.enter }}><span style={{ fontSize: 22 }}>{i}</span><div><b>{b}</b><div className="cap">{c}</div></div></motion.div>)}</div>
    <label className="row" style={{ marginTop: 18, alignItems: 'flex-start', cursor: 'pointer' }}>
      <input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} className="sr" aria-label="I am the parent or guardian and consent" />
      <motion.span animate={{ background: ok ? 'var(--indigo)' : '#fff', scale: ok ? [1, 1.15, 1] : 1 }} transition={{ duration: D.base, ease: E.bounce }} style={{ width: 26, height: 26, borderRadius: 8, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, border: '2px solid var(--indigo)' }}>{ok ? '✓' : ''}</motion.span>
      <span style={{ fontSize: 14, lineHeight: '20px' }}>I'm this child's parent or guardian and I consent to processing their photo as described in the <u>Privacy Notice</u> (COPPA / DPDP).</span></label>
    <div className="spacer" /><Btn disabled={!ok} style={{ opacity: ok ? 1 : 0.5 }} onClick={() => ok && go('upload')}>Verify &amp; continue</Btn>
    <p className="cap" style={{ textAlign: 'center', marginTop: 10 }}>Demo: no verification is run. Live app: $0 card check or OTP to the parent's phone.</p></div>;
}

function Upload({ go }: { go: (s: Screen) => void }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  const add = (files: FileList | null) => { if (!files) return; const urls = [...files].filter(f => f.type.startsWith('image/')).map(f => URL.createObjectURL(f)); setPhotos(p => [...p, ...urls].slice(0, 3)); };
  const samples = ['🙂', '😄', '😊'];
  const tints = ['var(--sun1)', 'var(--teal1)', 'var(--coral1)'];
  return <div className="body"><Top back={() => go('consent')} pct={40} />
    <h1>Add 3 clear photos</h1><p className="lead">Front-facing, good light, no sunglasses. More photos = a better likeness.</p>
    <input ref={ref} type="file" accept="image/*" multiple hidden data-testid="file" onChange={e => add(e.target.files)} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 18 }}>
      {[0, 1, 2].map(i => photos[i] ? <motion.div key={photos[i]} initial={{ y: -40, scale: 0.7, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ duration: D.slow, ease: E.enter }}
        style={{ aspectRatio: '3/4', borderRadius: 18, background: photos[i].startsWith('blob:') ? `center/cover url(${photos[i]})` : tints[i], display: 'grid', placeItems: 'center', fontSize: 34, position: 'relative' }}>
        {photos[i].startsWith('blob:') ? '' : photos[i]}
        <motion.span initial={{ scale: 0 }} animate={{ scale: [0, 1.15, 1] }} transition={{ delay: 0.35, duration: D.base, ease: E.bounce }} className="badge">✓</motion.span></motion.div>
        : <button key={'e' + i} className="slot" aria-label="Add photo" onClick={() => ref.current?.click()}>＋</button>)}</div>
    <div className="img" style={{ height: 190, flexShrink: 1, minHeight: 80, marginTop: 16, backgroundImage: `url(${img('empty-upload.jpg')})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundColor: 'transparent' }} />
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}><span className="chip">☀️ Good light</span><span className="chip">👀 Eyes visible</span><span className="chip">🧢 No hats</span></div>
    {photos.length < 3 && <button className="cap linkish" onClick={() => setPhotos(p => [...p, ...samples.slice(p.length)].slice(0, 3))}>No photo handy? Use sample photos</button>}
    <div className="spacer" /><div className="row"><Btn kind="ghost" style={{ width: 'auto', padding: '0 20px' }} aria-label="Take photo" onClick={() => ref.current?.click()}>📷</Btn>
      <Btn disabled={!photos.length} style={{ opacity: photos.length ? 1 : 0.5 }} onClick={() => photos.length && go('create')}>Continue ({photos.length}/3)</Btn></div>
    <p className="cap" style={{ textAlign: 'center', marginTop: 10 }}>🔒 Demo: photos stay in your browser and are never uploaded</p></div>;
}

function Reveal({ go, n, her }: { go: (s: Screen) => void; n: string; her: string }) {
  const rm = useReducedMotion();
  const sparks = [[-150, -170], [150, -140], [-140, 160], [160, 150]];
  return <div className="body"><div className="night">
    <div className="stars" />
    <motion.div className="cap" style={{ color: 'var(--sun)', letterSpacing: 2 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: D.slow, ease: E.enter }}>TA-DA!</motion.div>
    <motion.h1 style={{ color: '#fff', textAlign: 'center', marginTop: 8 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: D.slow, ease: E.enter }}>{n} is ready<br />for adventure</motion.h1>
    <div style={{ position: 'relative', marginTop: 28 }}>
      {!rm && <motion.div aria-hidden initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: [0, 1, 0.35], scale: [0.4, 1.1, 1] }} transition={{ duration: D.reveal, ease: E.enter }} style={{ position: 'absolute', inset: -40, borderRadius: '50%', background: 'radial-gradient(circle,rgba(246,195,67,.6),transparent 65%)' }} />}
      {!rm && sparks.map(([x, y], i) => <motion.span key={i} aria-hidden className="spark" initial={{ opacity: 0, x: 0, y: 0, scale: 0 }} animate={{ opacity: [0, 1, 0], x, y, scale: [0, 1.2, 0.8] }} transition={{ delay: 0.3 + i * 0.06, duration: 1.1, ease: E.bounce }}>✦</motion.span>)}
      <motion.div data-testid="reveal-card" initial={rm ? false : { opacity: 0, scale: 0.6, rotate: -6, filter: 'blur(12px) brightness(2)' }} animate={{ opacity: 1, scale: 1, rotate: 0, filter: 'blur(0px) brightness(1)' }} transition={{ duration: D.reveal, ease: E.enter }}
        style={{ width: 280, height: 360, maxHeight: '42vh', borderRadius: 32, backgroundColor: '#FFF8EE', ...avatar, boxShadow: '0 0 0 8px rgba(246,195,67,.35),0 0 80px rgba(246,195,67,.5)', position: 'relative' }} role="img" aria-label={`${n} as a painted storybook hero`} /></div>
    <div className="spacer" /><Btn kind="sun" onClick={() => go('pick')}>Choose {her} story →</Btn>
    <p style={{ opacity: 0.7, fontSize: 13, marginTop: 12 }}>Not quite right? <u style={{ cursor: 'pointer' }} onClick={() => go('create')}>Regenerate (2 left)</u></p></div></div>;
}

const MSGS = (n: string, p: number) => [`Writing ${n}'s story…`, 'Sketching the characters…', `Painting page ${p} of 24…`, 'Binding the book…'];
function Loader({ n, done }: { n: string; done: () => void }) {
  const [pct, setPct] = useState(4);
  const [m, setM] = useState(0);
  useEffect(() => {
    const a = setInterval(() => setPct(p => Math.min(100, p + 8 + Math.random() * 6)), 420);
    const b = setInterval(() => setM(x => (x + 1) % 4), 2000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  useEffect(() => { if (pct >= 100) { const t = setTimeout(done, 500); return () => clearTimeout(t); } }, [pct]);
  const page = Math.max(1, Math.round((pct / 100) * 24));
  const msg = pct >= 92 ? 3 : m === 3 ? 2 : m;
  return <div className="body"><div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: 40 }}>
    <div style={{ width: 240, height: 180, position: 'relative' }} aria-hidden>
      <div style={{ position: 'absolute', left: 20, right: 20, bottom: 0, height: 130, background: '#fff', borderRadius: 12, boxShadow: 'var(--sh-book)', transform: 'perspective(600px) rotateX(18deg)' }} />
      {[0, 1, 2].map(i => <motion.div key={i} style={{ position: 'absolute', left: 120, bottom: 20, width: 100, height: 110, background: ['var(--sun1)', 'var(--teal1)', 'var(--coral1)'][i], borderRadius: '4px 12px 12px 4px', transformOrigin: 'left', transformPerspective: 500 }}
        animate={{ rotateY: [0, -170, -170], opacity: [1, 0, 0] }} transition={{ duration: 1.6, times: [0, 0.6, 1], repeat: Infinity, delay: i * 0.53, ease: E.page }} />)}
      <motion.div style={{ position: 'absolute', top: 0, left: 110, fontSize: 28 }} animate={{ y: [0, -10, 0], rotate: [0, -12, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>🖌️</motion.div>
      <motion.div style={{ position: 'absolute', top: 30, left: 40, fontSize: 18 }} animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }} transition={{ duration: 2, repeat: Infinity }}>⭐</motion.div></div>
    <div style={{ height: 72, marginTop: 28, overflow: 'hidden' }}><AnimatePresence mode="wait"><motion.h1 key={msg} initial={{ y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -28, opacity: 0 }} transition={{ duration: D.base, ease: E.std }}>{MSGS(n, page)[msg]}</motion.h1></AnimatePresence></div>
    <p className="lead">{n} is meeting the fox behind the little door.</p>
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} style={{ width: '100%', height: 14, marginTop: 24, flex: 'none' }}>
      <motion.i className="shimmer" style={{ transformOrigin: 'left', width: '100%' }} initial={{ scaleX: 0.04 }} animate={{ scaleX: pct / 100 }} transition={{ duration: 0.6, ease: E.std }} /></div>
    <div className="card" style={{ marginTop: 28, textAlign: 'left', width: '100%' }}><div className="cap">DID YOU KNOW?</div><p style={{ marginTop: 6 }}>Kids who see themselves in stories read for longer. 📖</p></div>
    <div className="spacer" /><p className="cap">Demo: a sample story with {n}'s details filled in · no AI calls</p></div></div>;
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

function Reader({ go, story, n }: { go: (s: Screen) => void; story: ReturnType<typeof makeStory>; n: string }) {
  const [i, setI] = useState(0);
  const [turn, setTurn] = useState<0 | 1 | -1>(0);
  const [word, setWord] = useState(-1);
  const [reading, setReading] = useState(false);
  const rm = useReducedMotion();
  const N = story.pages.length;
  const flip = (d: 1 | -1) => { if (turn || i + d < 0 || i + d >= N) return; speechSynthesis?.cancel?.(); setReading(false); setWord(-1); setTurn(d); };
  const finish = () => { setI(x => x + turn); setTurn(0); };
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);
  const read = () => { if (reading) { speechSynthesis.cancel(); setReading(false); setWord(-1); return; } setReading(true); speak(story.pages[i].text, { onword: setWord, onend: () => { setReading(false); setWord(-1); } }); };
  const Pg = ({ k }: { k: number }) => { const p = story.pages[k]; const words = p.text.split(' ');
    return <div className="pg"><div className="img" role="img" aria-label={`Illustration: ${p.text}`} style={{ flex: 1, borderRadius: 0, backgroundImage: `url(${img(p.image)})`, backgroundPosition: p.pos }} />
      <div className="story-text" data-testid="page-text">{words.map((w, j) => { const hl = word >= 0 ? j === word : w.replace(/\W/g, '') === n; return <span key={j}>{hl ? <mark>{w}</mark> : w}{' '}</span>; })}</div></div>; };
  const next = turn === 1 ? i + 1 : turn === -1 ? i - 1 : i;
  return <div className="body">
    <div className="top"><button className="icon-btn" aria-label="Close" onClick={() => go('library')}>✕</button><div style={{ flex: 1, textAlign: 'center', fontWeight: 800 }}>{story.title}</div><button className="icon-btn" aria-label="Read aloud" onClick={read} style={{ background: reading ? 'var(--sun1)' : '#fff' }}>🔊</button></div>
    <div className="book-wrap" onClick={e => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; if (x > 0.8) flip(1); else if (x < 0.2) flip(-1); }}>
      <motion.div className="bookpg under" drag={turn ? false : 'x'} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.3} onDragEnd={(_, inf) => { if (inf.offset.x < -80) flip(1); else if (inf.offset.x > 80) flip(-1); }}><Pg k={turn === 1 ? next : i} /></motion.div>
      {turn !== 0 && (rm
        ? <motion.div className="bookpg" initial={{ opacity: turn === 1 ? 1 : 0 }} animate={{ opacity: turn === 1 ? 0 : 1 }} transition={{ duration: 0.2 }} onAnimationComplete={finish}><Pg k={turn === 1 ? i : next} /></motion.div>
        : <motion.div className="bookpg turning" style={{ transformOrigin: 'left center' }} initial={{ rotateY: turn === 1 ? 0 : -180 }} animate={{ rotateY: turn === 1 ? -180 : 0 }} transition={{ duration: D.page, ease: E.page }} onAnimationComplete={finish}>
          <Pg k={turn === 1 ? i : next} />
          <motion.div className="shade" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: D.page, times: [0, 0.45, 1] }} /></motion.div>)}
    </div>
    <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}><button className="icon-btn" aria-label="Previous page" onClick={() => flip(-1)} disabled={i === 0}>◀</button><div className="cap" data-testid="page-no">Page {i + 1} / {N}</div><button className="icon-btn" aria-label="Next page" onClick={() => flip(1)} disabled={i === N - 1}>▶</button></div>
    <div className="row" style={{ marginTop: 12, gap: 10 }}><Btn kind="ghost" style={{ height: 48, fontSize: 15 }} onClick={() => go('video')}>🎬 Watch</Btn><Btn kind="sun" style={{ height: 48, fontSize: 15 }} onClick={() => go('checkout')}>📕 Print book</Btn></div></div>;
}

const VOICES = { '🌙 Gentle Grandma': { rate: 0.85, pitch: 0.9 }, '🎈 Playful': { rate: 1.05, pitch: 1.35 }, '🎙️ Your voice': { rate: 1, pitch: 1 } } as Record<string, { rate: number; pitch: number }>;
const LANGS = { English: 'en-US', 'हिन्दी': 'hi-IN', Deutsch: 'de-DE' } as Record<string, string>;
function Video({ go, story }: { go: (s: Screen) => void; story: ReturnType<typeof makeStory>; has: boolean }) {
  const [voice, setVoice] = useState('🌙 Gentle Grandma');
  const [lang, setLang] = useState('English');
  const [playing, setPlaying] = useState(false);
  const [i, setI] = useState(0);
  const N = story.pages.length;
  const playing$ = useRef(false);
  const run = (k: number) => {
    if (!playing$.current) return;
    if (k >= N) { setPlaying(false); playing$.current = false; setI(0); return; }
    setI(k); speak(story.pages[k].text, { ...VOICES[voice], lang: LANGS[lang], onend: () => setTimeout(() => run(k + 1), 500) });
  };
  const toggle = () => { if (playing) { playing$.current = false; setPlaying(false); window.speechSynthesis?.cancel(); } else { playing$.current = true; setPlaying(true); run(i); } };
  useEffect(() => () => { playing$.current = false; window.speechSynthesis?.cancel(); }, []);
  const p = story.pages[i];
  return <div className="body" style={{ paddingBottom: 12 }}>
    <div className="player" onClick={toggle} role="button" aria-label={playing ? 'Pause video' : 'Play video'}>
      <AnimatePresence><motion.div key={i} className="kb" initial={{ opacity: 0, scale: 1.0 }} animate={{ opacity: 1, scale: playing ? 1.15 : 1.02, x: playing ? (i % 2 ? -14 : 14) : 0 }} exit={{ opacity: 0 }} transition={{ opacity: { duration: 0.8 }, scale: { duration: 7, ease: 'linear' }, x: { duration: 7, ease: 'linear' } }}
        style={{ backgroundImage: `url(${img(p.image)})`, backgroundPosition: p.pos }} /></AnimatePresence>
      {playing && <motion.div key={'c' + i} className="caption" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{p.text}</motion.div>}
      {!playing && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><motion.div whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }} className="playbtn">▶</motion.div></div>}
      <div className="vbar"><motion.i animate={{ width: `${((i + (playing ? 1 : 0)) / N) * 100}%` }} transition={{ duration: 0.6, ease: E.std }} /></div></div>
    <div className="scroll">
      <h1 style={{ marginTop: 20 }}>{story.title}</h1><p className="cap" style={{ marginTop: 4 }}>{N} scenes · narrated by your browser's voice · Ken Burns slideshow</p>
      <div className="cap" style={{ marginTop: 18 }}>NARRATOR VOICE</div><div className="row wrap">{Object.keys(VOICES).map(v => <Chip key={v} on={voice === v} onClick={() => setVoice(v)}>{v}</Chip>)}</div>
      <div className="cap" style={{ marginTop: 16 }}>LANGUAGE</div><div className="row wrap">{Object.keys(LANGS).map(v => <Chip key={v} on={lang === v} onClick={() => setLang(v)}>{v}</Chip>)}</div>
      {voice === '🎙️ Your voice' && <p className="cap" style={{ marginTop: 8 }}>Demo: voice cloning isn't included. Using the default voice.</p>}</div>
    <div className="row" style={{ marginTop: 12 }}><Btn kind="ghost" onClick={() => alert('Demo: MP4 export is not part of this demo.')}>⬇ Save MP4</Btn><Btn onClick={() => go('share')}>↗ Share</Btn></div>
    <Tabbar on="Watch" go={go} /></div>;
}

function Checkout({ go, story }: { go: (s: Screen) => void; story: ReturnType<typeof makeStory> }) {
  const [f, setF] = useState<string>('hard');
  const [paying, setPaying] = useState(false);
  const price = FORMATS.find(x => x.id === f)!.price;
  return <div className="body">
    <div className="top"><button className="icon-btn" aria-label="Back" onClick={() => go('reader')}>←</button><div style={{ flex: 1, fontWeight: 800, fontSize: 18, whiteSpace: 'nowrap' }}>Order the book</div><span className="demo-tag">DEMO · NO PAYMENT</span></div>
    <div style={{ height: 210, flexShrink: 0, borderRadius: 24, background: 'linear-gradient(160deg,#FDF1CF,#FDE3DF)', display: 'grid', placeItems: 'center', perspective: 700 }}>
      <motion.div animate={{ rotateY: [-16, -24, -16] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} style={{ width: 150, height: 170, borderRadius: '6px 14px 14px 6px', background: `url(${img(story.pages[0].image)}) 30% center/cover`, boxShadow: 'var(--sh-book),inset 8px 0 0 rgba(0,0,0,.15)', position: 'relative' }}>
        <b style={{ position: 'absolute', left: 12, right: 8, top: 12, fontFamily: 'var(--display)', color: '#fff', fontSize: 17, textShadow: '0 2px 6px rgba(0,0,0,.5)' }}>{story.title}</b></motion.div></div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
      {FORMATS.map(x => <motion.button key={x.id} whileTap={{ scale: 0.98 }} className="card fmt" aria-pressed={f === x.id} onClick={() => setF(x.id)} style={{ outline: f === x.id ? '3px solid var(--indigo)' : '3px solid transparent' }}>
        <div><b>{x.name}</b><div className="cap">{x.meta}</div></div><b>${x.price.toFixed(2)}</b></motion.button>)}</div>
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}><span>Video + e-book</span><span className="chip" style={{ background: 'var(--teal1)', boxShadow: 'none' }}>Included free</span></div>
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}><span>Shipping (US, 5-8 days)</span><b>${SHIPPING.toFixed(2)}</b></div>
    <div style={{ height: 1, background: 'var(--line)', margin: '12px 0' }} /><div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 18 }}>Total</b><b style={{ fontSize: 22 }} data-testid="total">${orderTotal(price).toFixed(2)}</b></div>
    <div className="spacer" /><Btn style={{ background: '#000', boxShadow: 'none' }} disabled={paying} onClick={() => { setPaying(true); setTimeout(() => go('share'), 900); }}>{paying ? 'Placing demo order…' : 'Place demo order (no charge)'}</Btn>
    <p className="cap" style={{ textAlign: 'center', marginTop: 8 }}>Demo checkout: no card, no payment. Prices are proposed placeholders.</p></div>;
}

function ShareRow() {
  const [copied, setCopied] = useState(false);
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginTop: 20, textAlign: 'center', fontSize: 12, fontWeight: 700 }}>
    {[['✆', 'WhatsApp', '#25D366'], ['✉', 'Email', ''], ['🔗', copied ? 'Copied!' : 'Copy link', ''], ['🎁', 'Gift a book', 'var(--sun)']].map(([i, l, bg]) =>
      <motion.button key={i} whileTap={{ scale: 0.9 }} className="sharebtn" onClick={() => { if (i === '🔗') { navigator.clipboard?.writeText(location.href).catch(() => {}); setCopied(true); } }}>
        <div className="icon-btn" style={{ margin: 'auto', background: bg || '#fff', color: bg === '#25D366' ? '#fff' : undefined }}>{i}</div>{l}</motion.button>)}</div>;
}

function Settings({ go, n, photosDeleted, setPhotosDeleted }: P) {
  const [t, setT] = useState([true, true, false]);
  const [sheet, setSheet] = useState(false);
  const set = (k: number) => (v: boolean) => setT(t.map((x, j) => (j === k ? v : x)));
  return <div className="body" style={{ paddingBottom: 12, position: 'relative' }}>
    <h1>Settings</h1>
    <div className="cap" style={{ marginTop: 18 }}>CHILDREN</div>
    <div className="card" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: '#FFF8EE', ...avatar }} /><div style={{ flex: 1 }}><b>{n}</b><div className="cap">{photosDeleted ? 'Photos deleted ✓' : '3 photos stored · auto-delete Nov 20'}</div></div>›</div>
    <div className="cap" style={{ marginTop: 18 }}>PRIVACY</div>
    <div className="card" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row"><div style={{ flex: 1 }}><b>Auto-delete photos after delivery</b><div className="cap">Recommended</div></div><Toggle on={t[0]} set={set(0)} label="Auto-delete photos" /></div>
      <div className="row"><div style={{ flex: 1 }}><b>Blur face in shared previews</b></div><Toggle on={t[1]} set={set(1)} label="Blur face" /></div>
      <div className="row"><div style={{ flex: 1 }}><b>Marketing emails</b></div><Toggle on={t[2]} set={set(2)} label="Marketing emails" /></div></div>
    <motion.button whileTap={{ scale: 0.98 }} className="card" disabled={photosDeleted} onClick={() => setSheet(true)} style={{ marginTop: 14, border: '2px solid var(--coral1)', boxShadow: 'none', textAlign: 'left', font: 'inherit', opacity: photosDeleted ? 0.5 : 1 }}>
      <b style={{ color: 'var(--danger)' }}>🗑️ Delete {n}'s photos now</b><div className="cap" style={{ marginTop: 4 }}>Removes originals and face data within 24h. Your finished books stay.</div></motion.button>
    <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}><span className="cap">Download my data</span><span className="cap" style={{ color: 'var(--danger)' }}>Delete account</span></div>
    <div className="spacer" /><Tabbar on="Settings" go={go} />
    <AnimatePresence>{sheet && <motion.div key="scrim" className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: D.base, ease: E.exit } }} onClick={() => setSheet(false)}>
      <motion.div className="sheet" role="dialog" aria-label="Delete photos" onClick={e => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%', transition: { duration: D.base, ease: E.exit } }} transition={{ duration: D.slow, ease: E.enter }}
        drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 1 }} onDragEnd={(_, i) => { if (i.offset.y > 120) setSheet(false); }}>
        <div className="grab" /><div style={{ fontSize: 44 }}>🗑️</div>
        <h2 style={{ marginTop: 8 }}>Delete {n}'s photos?</h2><p className="lead">3 photos and the face data used to draw them will be permanently erased. Finished books and videos stay in your library.</p>
        <Btn style={{ marginTop: 22, background: 'var(--danger)', color: '#fff', boxShadow: '0 6px 0 #A83A2C' }} onClick={() => { setPhotosDeleted(true); setSheet(false); }}>Yes, delete photos</Btn>
        <Btn kind="ghost" style={{ marginTop: 12 }} onClick={() => setSheet(false)}>Keep them</Btn></motion.div></motion.div>}</AnimatePresence></div>;
}
