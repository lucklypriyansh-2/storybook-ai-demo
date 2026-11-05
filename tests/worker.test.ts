import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkerApi } from '../src/data/worker';
import { TEMPLATES, bookPages } from '../src/data/seed';

const META_KEY = 'sb.reelMeta.v1';

/** Minimal fetch stub over a mutable server reel list that mirrors the Worker routes we use. */
function installFetch(rows: { id: string; status: string; tier: string; created_at: number }[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/api/reels') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ reels: rows }), { status: 200 });
    }
    if (u.endsWith('/api/reels') && init?.method === 'POST') {
      const id = 'reel-' + (rows.length + 1);
      rows.unshift({ id, status: 'queued', tier: 'free', created_at: Date.now() });
      return new Response(JSON.stringify({ reel_id: id, job_id: 'job-' + id }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('WorkerApi client metadata map (T3–T5)', () => {
  it('createReel records template + default state and reels()/books() read it back', async () => {
    const rows: { id: string; status: string; tier: string; created_at: number }[] = [];
    installFetch(rows);
    const api = new WorkerApi('https://w.test');
    const t = TEMPLATES.find(x => x.id === 'moon')!;

    const { reel_id, version } = await api.createReel('moon');
    expect(version).toBe(1);

    const reels = await api.reels();
    expect(reels).toHaveLength(1);
    expect(reels[0].id).toBe(reel_id);
    expect(reels[0].template_id).toBe('moon');
    expect(reels[0].state).toEqual(t.default_state);

    const books = await api.books();
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe(`book:${reel_id}`);
    expect(books[0].reel_id).toBe(reel_id);
    expect(books[0].title).toBe("Mira's Moon Trip");
    expect(books[0].pages).toEqual(bookPages(t, 'Mira', t.default_state));
  });

  it('remake bumps version + carries state onto the Worker-returned reel and re-derives pages', async () => {
    const rows: { id: string; status: string; tier: string; created_at: number }[] = [];
    installFetch(rows);
    const api = new WorkerApi('https://w.test');
    const { reel_id } = await api.createReel('moon');
    const t = TEMPLATES.find(x => x.id === 'moon')!;
    const next = { scene: 'ocean', outfit: 'cape', co_star: 'bruno', text: 'Hi {name}' };

    // POST /api/reels always creates a fresh reel; remake returns that new id (T4).
    const res = await api.remake(reel_id, next);
    expect(res.version).toBe(2);
    expect(res.reel_id).not.toBe(reel_id);

    const reel = (await api.reels()).find(r => r.id === res.reel_id)!;
    expect(reel.version).toBe(2);
    expect(reel.template_id).toBe('moon');
    expect(reel.state).toEqual(next);

    const book = (await api.books()).find(b => b.reel_id === res.reel_id)!;
    expect(book.pages).toEqual(bookPages(t, 'Mira', next));
  });

  it('books() and reels() share one cached server snapshot within the memo window', async () => {
    const rows = [{ id: 'r1', status: 'done', tier: 'free', created_at: 5 }];
    const fetchMock = installFetch(rows);
    const api = new WorkerApi('https://w.test');
    await api.reels();
    await api.books();
    const listCalls = fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/api/reels'));
    expect(listCalls).toHaveLength(1);
  });

  it('prunes metadata for reels the server no longer returns (no invented books)', async () => {
    const rows = [{ id: 'r1', status: 'done', tier: 'free', created_at: 5 }];
    installFetch(rows);
    const api = new WorkerApi('https://w.test');
    await api.createReel('moon'); // writes metadata for reel-1
    // Server forgets the reel (e.g. deleted on another device).
    rows.length = 0;
    (api as unknown as { lastList: unknown }).lastList = null;
    expect(await api.reels()).toEqual([]);
    expect(await api.books()).toEqual([]);
    expect(localStorage.getItem(META_KEY)).toBe('{}');
  });

  it('reels() falls back honestly when metadata is missing (unknown source)', async () => {
    const rows = [{ id: 'foreign', status: 'done', tier: 'free', created_at: 9 }];
    installFetch(rows);
    const api = new WorkerApi('https://w.test');
    const [r] = await api.reels();
    expect(r.template_id).toBe('');
    expect(r.version).toBe(1);
    expect(r.state).toEqual({ scene: '', outfit: '', co_star: 'nibbs', text: '' });
    expect(await api.books()).toEqual([]);
  });

  it('createConsent posts once and caches consent_id for the kid (T6)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).endsWith('/api/consent')) return new Response(JSON.stringify({ consent_id: 'c9' }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    const api = new WorkerApi('https://w.test');
    const a = await api.createConsent('Priya', false);
    const b = await api.createConsent('Priya', false);
    expect(a.consent_id).toBe('c9');
    expect(b.consent_id).toBe('c9');
    expect(calls.filter(u => u.endsWith('/api/consent'))).toHaveLength(1);
    expect(sessionStorage.getItem('sb.consentId.')).toBe('c9');
  });

  it('setConsent("create") reuses the cached consent instead of double-POSTing (T6 review)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).endsWith('/api/consent')) return new Response(JSON.stringify({ consent_id: 'c9' }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    const api = new WorkerApi('https://w.test');
    (api as unknown as { kidId: string }).kidId = 'k1';
    // PhotoLikenessCard path first, then a Grownups toggle for the same kind.
    await api.createConsent('Priya', false);
    await api.setConsent('create', true);
    expect(calls.filter(u => u.endsWith('/api/consent'))).toHaveLength(1);
  });
});
