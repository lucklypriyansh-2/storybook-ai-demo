import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';
import { img } from './motion';
import { ONBOARD_KEY, StoreProvider, useStore, type Route } from './store';
import { Btn } from './ui';
import { Nibbs } from './mascot';
import { Feed } from './screens/Feed';
import { BookReader } from './screens/Book';
import { ParentGate } from './screens/Gate';
import { ConsentList, Grownups } from './screens/Grownups';
import { Make } from './screens/Make';
import { Paywall } from './screens/Paywall';
import { Shelf } from './screens/Shelf';
import type { DataApi } from './data';

export default function App({ api }: { api?: DataApi }) {
  return <MotionConfig reducedMotion="user"><StoreProvider api={api}><Shell /></StoreProvider></MotionConfig>;
}

function Shell() {
  const s = useStore();
  const dark = s.route === 'feed' || s.route === 'welcome';
  const tabs = s.route === 'feed' || s.route === 'make' || s.route === 'shelf' || s.route === 'grownups';
  let body: React.ReactNode;
  if (s.error && String(s.error).includes('worker_session_required')) body = <InviteGate />;
  else if (s.error) body = <div className="body cream"><Nibbs mood="sad" width={140} /><h2>Something went wrong</h2><p className="cap">{s.error}</p><Btn onClick={() => location.reload()}>Try again</Btn></div>;
  else if (!s.ready) body = <div className="body cream center" data-testid="loading"><Nibbs mood="thinking" width={150} /><p className="lead">Nibbs is getting ready…</p></div>;
  else body = <Screen r={s.route} />;
  return <div className="stage"><div className={`phone app${dark ? ' dark' : ''}`} data-route={s.route} data-backend={s.api.mode}>
    <main className="main">{body}</main>
    {tabs && s.ready && <Tabbar dark={s.route === 'feed'} />}
    <AnimatePresence>{s.gate && <ParentGate key="gate" />}</AnimatePresence>
    <AnimatePresence>{s.toastMsg && <motion.div key={s.toastMsg} className="toast" role="status" initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>{s.toastMsg}</motion.div>}</AnimatePresence>
  </div></div>;
}

function Screen({ r }: { r: Route }) {
  const s = useStore();
  switch (r) {
    case 'welcome': return <Welcome />;
    case 'consent': return <div className="body cream scroll" data-testid="consent-first"><h1>Your choices, one by one</h1>
      <p className="lead">You can say yes to making {s.name}'s reels without saying yes to anything else.</p><div style={{ height: 12 }} /><ConsentList />
      <div className="card" style={{ marginTop: 12, background: 'var(--teal1)', borderColor: '#BDEDE6', boxShadow: '0 4px 0 #BDEDE6' }}><b>Never in this app:</b> ads, public profiles, comments, strangers or chat.</div>
      <div className="spacer" /><Btn style={{ marginTop: 16 }} onClick={() => s.go('make', 'first')}>Continue</Btn>
      <p className="cap" style={{ textAlign: 'center', marginTop: 8 }}><a href={`${import.meta.env.BASE_URL}privacy/`}>Privacy policy</a></p></div>;
    case 'make': return s.arg === 'first' ? <FirstMake /> : <Make />;
    case 'shelf': return <Shelf />;
    case 'grownups': return <Grownups />;
    case 'book': return <BookReader />;
    case 'paywall': return <Paywall />;
    default: return <Feed />;
  }
}
function FirstMake() { useEffect(() => { localStorage.setItem(ONBOARD_KEY, '1'); }, []); return <Make first />; }

function Welcome() {
  const s = useStore();
  return <div className="welcome" data-testid="welcome" style={{ backgroundImage: `url(${img('reel-space.jpg')})` }}>
    <div className="wfade" />
    <div className="win">
      <div className="eyebrow2">STARRING ME</div>
      <h1>Tiny shows where your child is the star</h1>
      <p>Short adventures starring your kid and Nibbs. Love one? Turn it into a book.</p>
      <Btn kind="sun" style={{ marginTop: 20 }} onClick={() => s.askGate('Setting up', () => s.go('consent'))}>Make my child the star</Btn>
      <p className="small">For grown-ups · free · no ads, ever · <a href={`${import.meta.env.BASE_URL}privacy/`}>privacy</a></p>
    </div></div>;
}

function Tabbar({ dark }: { dark: boolean }) {
  const s = useStore();
  const t: [string, string, Route][] = [['🎬', 'Reels', 'feed'], ['✨', 'Make', 'make'], ['📚', 'Shelf', 'shelf'], ['🔒', 'Grown-ups', 'grownups']];
  return <nav className={`tabbar2${dark ? ' dk' : ''}`}>{t.map(([i, l, r]) => <button key={l} className={s.route === r ? 'on' : ''} aria-label={l} onClick={() => r === 'grownups' ? s.askGate('Grown-ups area', () => s.go('grownups')) : s.go(r)}><b>{i}</b>{l}</button>)}</nav>;
}


function InviteGate() {
  const [code, setCode] = useState('FAMILY1');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = useStore();
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const api = s.api as DataApi & { invite?: (c: string, e: string) => Promise<unknown> };
      if (!api.invite) throw new Error('invite not available');
      await api.invite(code.trim(), email.trim());
      location.reload();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };
  return <div className="body cream scroll" data-testid="invite-gate">
    <Nibbs mood="wave" width={140} />
    <h2>Family invite</h2>
    <p className="lead">Enter the invite code to unlock cloud reels for this phone.</p>
    <label className="cap">Invite code</label>
    <input value={code} onChange={e => setCode(e.target.value)} autoCapitalize="characters" style={{ width: '100%', marginBottom: 12, padding: 12, borderRadius: 12, border: '2px solid #D9D6F5' }} />
    <label className="cap">Your email</label>
    <input value={email} onChange={e => setEmail(e.target.value)} type="email" inputMode="email" placeholder="you@example.com" style={{ width: '100%', marginBottom: 12, padding: 12, borderRadius: 12, border: '2px solid #D9D6F5' }} />
    {err && <p className="cap" style={{ color: '#B00020' }}>{err}</p>}
    <Btn disabled={busy || !code.trim() || !email.includes('@')} onClick={submit}>{busy ? 'Signing in…' : 'Continue'}</Btn>
  </div>;
}
