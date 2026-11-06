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
import { Catalog } from './screens/Catalog';
import { Admin } from './screens/Admin';
import type { DataApi } from './data';

export default function App({ api }: { api?: DataApi }) {
  return <MotionConfig reducedMotion="user"><StoreProvider api={api}><Shell /></StoreProvider></MotionConfig>;
}

function Shell() {
  const s = useStore();
  const dark = s.route === 'feed' || s.route === 'welcome';
  const tabs = s.route === 'feed' || s.route === 'make' || s.route === 'catalog' || s.route === 'shelf' || s.route === 'grownups';
  let body: React.ReactNode;
  if (s.error && String(s.error).includes('worker_session_required')) body = <AuthGate />;
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
    case 'catalog': return <Catalog />;
    case 'admin': return <Admin />;
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
  const t: [string, string, Route][] = [['🎬', 'Reels', 'feed'], ['📖', 'Catalog', 'catalog'], ['✨', 'Make', 'make'], ['📚', 'Shelf', 'shelf'], ['🔒', 'Grown-ups', 'grownups']];
  return <nav className={`tabbar2${dark ? ' dk' : ''}`}>{t.map(([i, l, r]) => <button key={l} className={s.route === r ? 'on' : ''} aria-label={l} onClick={() => r === 'grownups' ? s.askGate('Grown-ups area', () => s.go('grownups')) : s.go(r)}><b>{i}</b>{l}</button>)}</nav>;
}


type AuthApi = DataApi & {
  register?: (e: string, p: string) => Promise<unknown>;
  login?: (e: string, p: string) => Promise<unknown>;
  invite?: (c: string, e: string) => Promise<unknown>;
  providers?: () => Promise<{ email: boolean; google: boolean; invite: boolean }>;
  googleStartUrl?: (returnTo: string) => string;
};

type AuthMode = 'signup' | 'login' | 'invite';

/**
 * Replaces the old invite-only gate. Primary paths are email+password signup
 * and Google OAuth; the invite code form stays behind a "have an invite code?"
 * disclosure so existing users can still get in.
 */
function AuthGate() {
  const s = useStore();
  const api = s.api as AuthApi;
  const [mode, setMode] = useState<AuthMode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [googleOn, setGoogleOn] = useState(false);

  useEffect(() => {
    if (!api.providers) return;
    api.providers().then(p => setGoogleOn(!!p.google)).catch(() => {});
  }, [api]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === 'signup') {
        if (!api.register) throw new Error('register not available');
        await api.register(email.trim(), password);
      } else if (mode === 'login') {
        if (!api.login) throw new Error('login not available');
        await api.login(email.trim(), password);
      } else {
        if (!api.invite) throw new Error('invite not available');
        await api.invite(code.trim(), email.trim());
      }
      location.reload();
    } catch (e) {
      setErr(prettyAuthError(String((e as Error)?.message ?? e)));
      setBusy(false);
    }
  };

  const onGoogle = () => {
    if (!api.googleStartUrl) return;
    location.href = api.googleStartUrl(location.href);
  };

  const canSubmit = mode === 'invite'
    ? (code.trim().length > 0 && email.includes('@'))
    : (email.includes('@') && password.length >= 8);

  const inputStyle: React.CSSProperties = { width: '100%', marginBottom: 12, padding: 12, borderRadius: 12, border: '2px solid #D9D6F5' };

  return <div className="body cream scroll" data-testid="auth-gate">
    <Nibbs mood="wave" width={140} />
    <h2>{mode === 'invite' ? 'Family invite' : mode === 'login' ? 'Welcome back' : 'Create an account'}</h2>
    <p className="lead">
      {mode === 'invite'
        ? 'Enter an invite code to unlock cloud reels on this phone.'
        : 'One account for every device, so your books follow you.'}
    </p>

    {googleOn && mode !== 'invite' && <>
      <Btn kind="sun" onClick={onGoogle} style={{ marginBottom: 12 }}>Continue with Google</Btn>
      <p className="cap" style={{ textAlign: 'center', marginBottom: 12 }}>— or —</p>
    </>}

    {mode === 'invite' && <>
      <label className="cap">Invite code</label>
      <input value={code} onChange={e => setCode(e.target.value)} autoCapitalize="characters" style={inputStyle} data-testid="auth-invite-code" />
    </>}
    <label className="cap">Email</label>
    <input value={email} onChange={e => setEmail(e.target.value)} type="email" inputMode="email" placeholder="you@example.com" style={inputStyle} data-testid="auth-email" />
    {mode !== 'invite' && <>
      <label className="cap">Password {mode === 'signup' && <span style={{ color: '#666' }}>(8+ characters)</span>}</label>
      <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} style={inputStyle} data-testid="auth-password" />
    </>}

    {err && <p className="cap" style={{ color: '#B00020' }}>{err}</p>}
    <Btn disabled={busy || !canSubmit} onClick={submit}>
      {busy ? 'Working…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : 'Continue'}
    </Btn>

    <div className="cap" style={{ textAlign: 'center', marginTop: 16 }}>
      {mode === 'signup' && <>Already have an account? <a href="#" onClick={e => { e.preventDefault(); setMode('login'); setErr(null); }}>Log in</a></>}
      {mode === 'login' && <>New here? <a href="#" onClick={e => { e.preventDefault(); setMode('signup'); setErr(null); }}>Create an account</a></>}
      {mode === 'invite' && <><a href="#" onClick={e => { e.preventDefault(); setMode('signup'); setErr(null); }}>Back to signup</a></>}
    </div>
    {mode !== 'invite' && <p className="cap" style={{ textAlign: 'center', marginTop: 8 }}>
      Have an invite code? <a href="#" onClick={e => { e.preventDefault(); setMode('invite'); setErr(null); }}>Use it instead</a>
    </p>}
  </div>;
}

/** Turn the Worker's machine-readable error codes into something a parent can read. */
function prettyAuthError(raw: string): string {
  const codeMatch = raw.match(/(email_invalid|email_required|password_required|password_length|email_in_use|invalid_credentials|unknown_invite_code|invite_code_exhausted|rate_limited)/);
  const code = codeMatch?.[1] ?? '';
  switch (code) {
    case 'email_invalid': return 'That email doesn’t look right.';
    case 'email_required': return 'Enter an email.';
    case 'password_required': return 'Enter a password.';
    case 'password_length': return 'Use 8 characters or more.';
    case 'email_in_use': return 'An account already exists for that email. Try logging in.';
    case 'invalid_credentials': return 'Wrong email or password.';
    case 'unknown_invite_code': return 'We don’t recognise that invite code.';
    case 'invite_code_exhausted': return 'That invite code is used up.';
    case 'rate_limited': return 'Too many tries — wait a minute and try again.';
    default: return raw;
  }
}
