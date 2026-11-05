import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkerApi } from '../src/data/worker';
import { CATALOG_SEED, allTemplates, templateFromCatalog } from '../src/data/catalog';
import { TEMPLATES } from '../src/data/seed';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('placeholder catalog data (R.1.2)', () => {
  it('exposes 3 PLACEHOLDER seed templates without clashing with the v1 seeds', () => {
    expect(CATALOG_SEED).toHaveLength(3);
    const ids = allTemplates().map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['tpl_lighthouse_mouse', 'tpl_pebble_pyjamas', 'tpl_cloud_whale']));
    expect(allTemplates().length).toBe(TEMPLATES.length + 3);
  });

  it('builds a template from an admin row, generic and clearly placeholder when unknown', () => {
    const known = templateFromCatalog({ id: 'tpl_cloud_whale', slug: 's', title: '{name} and the Cloud Whale', cover: 'local:x.jpg', description: '', age_band: '5-7', tier_default: 'free', page_count: 6, enabled: true });
    expect(known.script).toHaveLength(6);
    expect(known.title).toBe('{name} and the Cloud Whale');

    const custom = templateFromCatalog({ id: 'tpl_custom', slug: 's', title: 'PLACEHOLDER Custom', cover: null, description: '', age_band: '3-5', tier_default: 'paid', page_count: 9, enabled: true });
    expect(custom.script).toHaveLength(8);
    expect(custom.script[0]).toContain('PLACEHOLDER Custom');
  });
});

describe('WorkerApi catalog + page routes', () => {
  it('maps /api/catalog rows and resolves detail shots', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/api/catalog')) return new Response(JSON.stringify({ templates: [{ id: 'tpl_a', slug: 'a', title: 'T', cover_url: 'local:cover.jpg', description: 'd', age_band: '3-5', tier_default: 'free', page_count: 6, enabled: true }] }), { status: 200 });
      if (u.endsWith('/api/catalog/tpl_a')) return new Response(JSON.stringify({ template: { id: 'tpl_a', slug: 'a', title: 'T', cover_url: null, description: 'd', age_band: '3-5', tier_default: 'free', page_count: 6, enabled: true }, shots: [{ index: 1, caption_prompt: 'beat', keyframe_prompt: null }] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    const api = new WorkerApi('https://w.test');
    const rows = await api.catalog();
    expect(rows[0]).toMatchObject({ id: 'tpl_a', cover: 'local:cover.jpg' });
    const detail = await api.catalogDetail('tpl_a');
    expect(detail.shots).toEqual([{ index: 1, caption_prompt: 'beat', keyframe_prompt: null }]);
  });

  it('sends template_id + use_sheet to POST /api/reels', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/reels') && init?.method === 'POST') {
        return new Response(JSON.stringify({ reel_id: 'r1', job_id: 'j1' }), { status: 200 });
      }
      return new Response(JSON.stringify({ reels: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new WorkerApi('https://w.test');
    await api.generateFromTemplate('tpl_lighthouse_mouse', 'free', 'kid1', false);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body).toEqual({ kid_id: 'kid1', template_id: 'tpl_lighthouse_mouse', tier: 'free', use_sheet: false });
  });

  it('sends scene_prompts[] on adminUpdateTemplate (A-03)', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/admin/templates/') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ template: { id: 'tpl_a', slug: 'a', title: 'T', cover_url: null, description: '', age_band: '3-5', tier_default: 'free', page_count: 6, enabled: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new WorkerApi('https://w.test');
    await api.adminUpdateTemplate('tpl_a', { title: 'T', scene_prompts: [{ index: 1, caption_prompt: 'beat', keyframe_prompt: null }] });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body).toEqual({ title: 'T', scene_prompts: [{ index: 1, caption_prompt: 'beat', keyframe_prompt: null }] });
  });

  it('maps adminTemplateDetail shots keyed by index', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/admin/templates/tpl_a')) {
        return new Response(JSON.stringify({
          template: { id: 'tpl_a', slug: 'a', title: 'T', cover_url: null, description: '', age_band: '3-5', tier_default: 'free', page_count: 6, enabled: true },
          shots: [{ index: 1, caption_prompt: 'beat one', keyframe_prompt: 'art' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    const api = new WorkerApi('https://w.test');
    const detail = await api.adminTemplateDetail('tpl_a');
    expect(detail.template.id).toBe('tpl_a');
    expect(detail.shots).toEqual([{ index: 1, caption_prompt: 'beat one', keyframe_prompt: 'art' }]);
  });

  it('saves a page both locally and on the server, and survives a server error', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/pages/1') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ page: { index: 1, text: 'x', keyframe_url: null } }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new WorkerApi('https://w.test');
    expect(await api.saveBookPageText('r1', 'book:r1', 1, 'hello')).toEqual({ saved: true, server: true });
    expect(localStorage.getItem('sb.bookPages.v1')).toContain('hello');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })));
    expect(await api.saveBookPageText('r1', 'book:r1', 2, 'still local')).toEqual({ saved: true, server: false });
    expect(localStorage.getItem('sb.bookPages.v1')).toContain('still local');
  });
});
