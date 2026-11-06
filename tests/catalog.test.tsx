import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StoreProvider, useStore } from '../src/store';
import { Catalog } from '../src/screens/Catalog';
import { Admin } from '../src/screens/Admin';
import { DEFAULT_LOOK } from '../src/mascot';
import { SETTINGS_DEFAULTS } from '../src/data/local';
import { TEMPLATES } from '../src/data/seed';
import type { CatalogTemplate } from '../src/data/types';

function Ready({ which }: { which: 'catalog' | 'admin' }) {
  const s = useStore();
  if (!s.ready || !s.hh) return null;
  return which === 'catalog' ? <Catalog /> : <Admin />;
}

const household = () => ({
  id: 'k1',
  kid: { id: 'k1', display_name: 'Mira', age_band: '4-6' },
  character: { id: 'pending:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } },
  settings: { ...SETTINGS_DEFAULTS },
});

/** Two PLACEHOLDER rows, mirroring what the Worker seeds. */
const CATALOG: CatalogTemplate[] = [
  { id: 'tpl_lighthouse_mouse', slug: 'lighthouse-mouse', title: '{name} and the Lighthouse Mouse', cover: 'local:reel-ocean.jpg', description: 'PLACEHOLDER sample', age_band: '3-5', tier_default: 'free', page_count: 6, enabled: true },
  { id: 'tpl_cloud_whale', slug: 'cloud-whale', title: '{name} and the Cloud Whale', cover: 'local:spread-02-whale.jpg', description: 'PLACEHOLDER sample', age_band: '5-7', tier_default: 'hd', page_count: 6, enabled: true },
];

function fakeWorkerApi(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'worker',
    init: async () => household(),
    household: async () => household(),
    templates: async () => TEMPLATES,
    reels: async () => [], reelVersions: async () => [], books: async () => [], jobs: async () => [],
    consents: async () => [], publishQueue: async () => [],
    setConsent: async () => {}, setLoved: async () => {}, setSaved: async () => {},
    updateKid: async () => {}, updateLook: async () => {}, updateSettings: async () => {},
    queuePublish: async () => ({}), cancelPublish: async () => {}, videoBlob: async () => null,
    onReels: () => () => {}, deleteAll: async () => {},
    createReel: async () => ({ reel_id: 'r1', version: 1, job_id: 'j1' }),
    remake: async () => ({ reel_id: 'r1', version: 2, job_id: 'j2' }),
    me: vi.fn(async () => ({ user_id: 'u1', is_admin: false })),
    catalog: vi.fn(async () => CATALOG),
    catalogDetail: vi.fn(async (id: string) => ({ template: CATALOG.find(t => t.id === id)!, shots: [{ index: 1, caption_prompt: '{name} meets a tiny mouse.', keyframe_prompt: null }] })),
    generateFromTemplate: vi.fn(async () => ({ reel_id: 'r9', job_id: 'j9' })),
    health: vi.fn(async () => ({ ok: true, build: 'test', flags: { openrouter: true, fal: false, motion: true, kill: false, ffmpeg: true } })),
    adminTemplates: vi.fn(async () => CATALOG),
    adminTemplateDetail: vi.fn(async (id: string) => ({ template: CATALOG.find(t => t.id === id)!, shots: [{ index: 1, caption_prompt: '{name} meets a tiny mouse.', keyframe_prompt: null }] })),
    adminCreateTemplate: vi.fn(async () => ({})),
    adminUpdateTemplate: vi.fn(async () => ({})),
    adminDeleteTemplate: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as Record<string, unknown> & {
    catalog: ReturnType<typeof vi.fn>; generateFromTemplate: ReturnType<typeof vi.fn>;
    adminCreateTemplate: ReturnType<typeof vi.fn>; adminUpdateTemplate: ReturnType<typeof vi.fn>;
    adminTemplateDetail: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => cleanup());

describe('Catalog browse + story detail (§R.1.3/§R.1.4)', () => {
  it('renders PLACEHOLDER story cards with a kid name + avatar chip', async () => {
    const api = fakeWorkerApi();
    render(<StoreProvider api={api as never}><Ready which="catalog" /></StoreProvider>);

    const card = await screen.findByTestId('catalog-card-tpl_lighthouse_mouse');
    expect(card).toHaveTextContent("Mira and the Lighthouse Mouse");
    // Personalisation chip is client-side: kid name over the cover.
    expect(screen.getAllByTestId('kid-chip')[0]).toHaveTextContent('with Mira');
    expect(api.catalog).toHaveBeenCalledOnce();
  });

  it('shows an honest HD-paused badge when the Worker reports motion=false (§H: no fal gate)', async () => {
    // fal=true on purpose: motion must follow the new OpenRouter signal, not fal.
    const api = fakeWorkerApi({
      health: vi.fn(async () => ({ ok: true, build: 'test', flags: { openrouter: true, fal: true, motion: false, kill: false, ffmpeg: true } })),
    });
    render(<StoreProvider api={api as never}><Ready which="catalog" /></StoreProvider>);
    await screen.findByTestId('catalog-card-tpl_cloud_whale');
    const badges = screen.getAllByTestId('tier-badge').map(n => n.textContent);
    expect(badges).toContain('free');
    expect(badges).toContain('🎞 HD — paused');
  });

  it('shows a live HD badge when the Worker reports motion=true (§H)', async () => {
    render(<StoreProvider api={fakeWorkerApi() as never}><Ready which="catalog" /></StoreProvider>);
    await screen.findByTestId('catalog-card-tpl_cloud_whale');
    const badges = screen.getAllByTestId('tier-badge').map(n => n.textContent);
    expect(badges).toContain('🎞 HD');
  });

  it('opens story detail with personalised shot captions and generates from template_id', async () => {
    const api = fakeWorkerApi();
    render(<StoreProvider api={api as never}><Ready which="catalog" /></StoreProvider>);
    fireEvent.click(await screen.findByTestId('catalog-card-tpl_lighthouse_mouse'));

    expect(await screen.findByTestId('detail-title')).toHaveTextContent("Mira and the Lighthouse Mouse");
    expect(screen.getByTestId('detail-shots')).toHaveTextContent('Mira meets a tiny mouse.');

    fireEvent.click(screen.getByTestId('generate-story'));
    await waitFor(() => expect(api.generateFromTemplate).toHaveBeenCalledWith('tpl_lighthouse_mouse', 'free', 'k1', false));
  });

  it('degrades honestly on a backend without the catalog route', async () => {
    render(<StoreProvider api={fakeWorkerApi({ catalog: undefined, catalogDetail: undefined }) as never}><Ready which="catalog" /></StoreProvider>);
    expect(await screen.findByText('Catalog needs the cloud')).toBeInTheDocument();
  });
});

describe('Admin gate (§R.2.1 — no password field)', () => {
  it('shows the operator-only message for a non-admin session, with no credential input', async () => {
    render(<StoreProvider api={fakeWorkerApi() as never}><Ready which="admin" /></StoreProvider>);
    expect(await screen.findByTestId('admin-operator-only')).toHaveTextContent('operators only');
    expect(screen.queryByTestId('admin-templates')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('renders the catalog editor when the session is admin, and toggles a row', async () => {
    const api = fakeWorkerApi({ me: vi.fn(async () => ({ user_id: 'u1', is_admin: true })) });
    render(<StoreProvider api={api as never}><Ready which="admin" /></StoreProvider>);

    expect(await screen.findByTestId('admin-templates')).toBeInTheDocument();
    // Wait for the rows (not just the container) before clicking a row control.
    await screen.findByTestId('admin-row-tpl_lighthouse_mouse');
    // #14: row controls are labelled with the *filled* title (the kid's name), so a
    // screen reader hears what the operator sees — never the raw "{name}" token.
    fireEvent.click(screen.getByLabelText('Disable Mira and the Lighthouse Mouse'));
    await waitFor(() => expect(api.adminUpdateTemplate).toHaveBeenCalledWith('tpl_lighthouse_mouse', { enabled: false }));
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('creates a template through the admin route', async () => {
    const api = fakeWorkerApi({ me: vi.fn(async () => ({ user_id: 'u1', is_admin: true })) });
    render(<StoreProvider api={api as never}><Ready which="admin" /></StoreProvider>);
    await screen.findByTestId('admin-templates');

    fireEvent.change(screen.getByTestId('admin-title'), { target: { value: 'PLACEHOLDER New Story' } });
    fireEvent.click(screen.getByTestId('admin-create'));
    await waitFor(() => expect(api.adminCreateTemplate).toHaveBeenCalledWith(expect.objectContaining({ title: 'PLACEHOLDER New Story', age_band: '3-5', page_count: 6 })));
  });

  it('edits per-shot prompts and PATCHes them as scene_prompts[] (A-03)', async () => {
    const api = fakeWorkerApi({ me: vi.fn(async () => ({ user_id: 'u1', is_admin: true })) });
    render(<StoreProvider api={api as never}><Ready which="admin" /></StoreProvider>);
    await screen.findByTestId('admin-templates');

    await screen.findByTestId('admin-row-tpl_lighthouse_mouse');
    fireEvent.click(screen.getByTestId('admin-edit-tpl_lighthouse_mouse'));
    expect(await screen.findByTestId('admin-shot-editor')).toBeInTheDocument();
    // Shots load keyed by index, pre-filled from the detail route.
    const caption = await screen.findByTestId('editor-caption-1') as HTMLTextAreaElement;
    expect(caption.value).toBe('{name} meets a tiny mouse.');

    fireEvent.change(caption, { target: { value: 'PLACEHOLDER new beat' } });
    fireEvent.change(screen.getByTestId('editor-title'), { target: { value: 'PLACEHOLDER Renamed' } });
    fireEvent.click(screen.getByTestId('editor-save'));

    await waitFor(() => expect(api.adminUpdateTemplate).toHaveBeenCalledWith('tpl_lighthouse_mouse', {
      title: 'PLACEHOLDER Renamed',
      scene_prompts: [{ index: 1, caption_prompt: 'PLACEHOLDER new beat', keyframe_prompt: null }],
    }));
  });

  it('asks the Worker for sheet conditioning only when the kid has a sheet', async () => {
    // A kid whose character id is `sheet:<kid>` → useSheet=true is honest to request.
    const withSheet = { ...household(), character: { id: 'sheet:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } } };
    const api = fakeWorkerApi({ household: async () => withSheet, init: async () => withSheet });
    render(<StoreProvider api={api as never}><Ready which="catalog" /></StoreProvider>);
    fireEvent.click(await screen.findByTestId('catalog-card-tpl_lighthouse_mouse'));
    fireEvent.click(await screen.findByTestId('generate-story'));
    await waitFor(() => expect(api.generateFromTemplate).toHaveBeenCalledWith('tpl_lighthouse_mouse', 'free', 'k1', true));
  });
});
