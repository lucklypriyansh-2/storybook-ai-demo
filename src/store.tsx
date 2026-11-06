import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { makeApi, type Book, type Consent, type ConsentKind, type DataApi, type Household, type PublishItem, type Reel, type RenderJob, type Template } from './data';
import { fill } from './data/seed';
import { applyOverrides, loadBookPages } from './data/bookPages';
import { pumpRenders } from './render/worker';

export type Route = 'welcome' | 'consent' | 'feed' | 'make' | 'catalog' | 'admin' | 'shelf' | 'grownups' | 'book' | 'paywall';
export type GateFor = { why: string; then: () => void };
interface Ctx {
  api: DataApi; ready: boolean; error: string | null; hh: Household | null; name: string;
  templates: Template[]; reels: Reel[]; books: Book[]; consents: Consent[]; publish: PublishItem[]; jobs: RenderJob[];
  consent: (k: ConsentKind) => boolean; tpl: (id: string) => Template; title: (r: Reel) => string;
  refresh: () => Promise<void>; setReels: (r: Reel[]) => void;
  route: Route; go: (r: Route, arg?: string) => void; arg: string;
  toast: (m: string) => void; toastMsg: string | null;
  renderProg: Record<string, number>; videoSrc: (url: string | null) => Promise<string | null>;
  gate: GateFor | null; askGate: (why: string, then: () => void) => void; closeGate: (passed: boolean) => void; unlocked: () => boolean;
}
const C = createContext<Ctx>(null as unknown as Ctx);
export const useStore = () => useContext(C);
const ROUTES: Route[] = ['welcome', 'consent', 'feed', 'make', 'catalog', 'admin', 'shelf', 'grownups', 'book', 'paywall'];
export const ONBOARD_KEY = 'starringme.onboarded';

export function StoreProvider({ children, api: given }: { children: ReactNode; api?: DataApi }) {
  const api = useMemo(() => given ?? makeApi(), [given]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hh, setHh] = useState<Household | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [reels, setReels] = useState<Reel[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [publish, setPublish] = useState<PublishItem[]>([]);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const parse = () => { const [r, a] = location.hash.slice(1).split('/'); return { r: (ROUTES.includes(r as Route) ? r : null) as Route | null, a: a ?? '' }; };
  const [route, setRoute] = useState<Route>(() => parse().r ?? (localStorage.getItem(ONBOARD_KEY) ? 'feed' : 'welcome'));
  const [arg, setArg] = useState(() => parse().a);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [gate, setGate] = useState<GateFor | null>(null);
  const unlockedUntil = useRef(0);
  const [renderProg, setRenderProg] = useState<Record<string, number>>({});
  const urls = useRef(new Map<string, string>());
  const tt = useRef<ReturnType<typeof setTimeout>>(undefined);
  const aliveRef = useRef(true); // mirrors the mount effect's `alive` so `refresh` can bail after unmount

  const refresh = useCallback(async () => {
    const [h, t, r, b, c, p, j] = await Promise.all([api.household(), api.templates(), api.reels(), api.books(), api.consents(), api.publishQueue(), api.jobs()]);
    // R.5.2: per-page edits live in localStorage and are overlaid on the derived
    // template pages, so an edit survives reloads on every backend.
    const overrides = loadBookPages();
    // The awaits above can resolve after the provider unmounts or after the test
    // env (jsdom window) is torn down; setState then throws (react-dom reads
    // window.event), so bail out before touching state.
    if (!aliveRef.current || typeof window === 'undefined') return;
    setHh(h); setTemplates(t); setReels(r); setBooks(b.map(x => applyOverrides(x, overrides))); setConsents(c); setPublish(p); setJobs(j);
  }, [api]);
  useEffect(() => {
    let off = () => {};
    let alive = true; // don't set state after the provider unmounts (avoids post-teardown setState)
    aliveRef.current = true;
    // state is safe to set while mounted and while the env (jsdom window) still exists
    const safe = () => alive && typeof window !== 'undefined';
    const pump = () => pumpRenders(api, (id, p) => { if (safe()) setRenderProg(x => ({ ...x, [id]: p })); });
    api.init().then(refresh).then(() => { if (!safe()) return; setReady(true); pump(); off = api.onReels(r => { if (!safe()) return; setReels(r); api.jobs().then(j => { if (safe()) setJobs(j); }).catch(() => {}); if (r.some(x => x.status === 'queued')) pump(); }); })
      .catch(e => { if (safe()) setError(String(e?.message ?? e)); });
    return () => { alive = false; aliveRef.current = false; off(); };
  }, [api, refresh]);
  useEffect(() => { // revoke object URLs for video versions no reel points at any more
    const live = new Set(reels.map(r => r.video_url));
    for (const [k, u] of urls.current) if (!live.has(k)) { URL.revokeObjectURL(u); urls.current.delete(k); }
  }, [reels]);
  useEffect(() => { history.replaceState(null, '', '#' + route + (arg ? '/' + arg : '')); }, [route, arg]);
  useEffect(() => { const f = () => { const p = parse(); if (p.r) { setRoute(p.r); setArg(p.a); } }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);

  const name = hh?.kid.display_name ?? 'Mira';
  const v: Ctx = {
    api, ready, error, hh, name, templates, reels, books, consents, publish, jobs,
    consent: k => consents.find(c => c.kind === k)?.granted ?? false,
    tpl: id => templates.find(t => t.id === id) ?? templates[0],
    title: r => fill((templates.find(t => t.id === r.template_id) ?? templates[0])?.title ?? '', name, r.state),
    refresh, setReels, renderProg,
    videoSrc: async url => {
      if (!url) return null;
      if (!url.startsWith('idb:')) return /^https?:|^blob:/.test(url) ? url : `${import.meta.env.BASE_URL}${url}`;
      const hit = urls.current.get(url); if (hit) return hit;
      const b = await api.videoBlob(url); if (!b) return null;
      const u = URL.createObjectURL(b); urls.current.set(url, u); return u;
    },
    route, arg, go: (r, a = '') => { setRoute(r); setArg(a); },
    toast: m => { setToast(m); clearTimeout(tt.current); tt.current = setTimeout(() => setToast(null), 2600); }, toastMsg,
    gate, unlocked: () => Date.now() < unlockedUntil.current,
    askGate: (why, then) => { if (Date.now() < unlockedUntil.current) then(); else setGate({ why, then }); },
    closeGate: passed => { const g = gate; setGate(null); if (!passed && route === 'grownups') { setRoute('feed'); setArg(''); } if (passed && g) { unlockedUntil.current = Date.now() + 5 * 60_000; g.then(); } },
  };
  return <C.Provider value={v}>{children}</C.Provider>;
}
