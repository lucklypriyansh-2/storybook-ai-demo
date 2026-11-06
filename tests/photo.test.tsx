import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StoreProvider, useStore } from '../src/store';
import { Make } from '../src/screens/Make';
import { DEFAULT_LOOK } from '../src/mascot';
import { SETTINGS_DEFAULTS } from '../src/data/local';
import { TEMPLATES } from '../src/data/seed';

/** Mimic App: screens only render once the store is ready (hh loaded). */
function ReadyMake() { const s = useStore(); return s.ready && s.hh ? <Make /> : null; }
const mount = (api: Record<string, unknown>) => render(<StoreProvider api={api as never}><ReadyMake /></StoreProvider>);

const household = () => ({
  id: 'k1',
  kid: { id: 'k1', display_name: 'Mira', age_band: '4-6' },
  character: { id: 'pending:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } },
  settings: { ...SETTINGS_DEFAULTS },
});

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
    uploadPhoto: vi.fn(async () => ({ photo_id: 'p1' })),
    createConsent: vi.fn(async () => ({ consent_id: 'c1' })),
    requestCharacterSheet: vi.fn(async () => ({ job_id: 'j1' })),
    pollJob: vi.fn(async (_id: string, opts?: { onTick?: (j: unknown) => void }) => { opts?.onTick?.({ progress: 100 }); return { status: 'done', progress: 100 }; }),
    characterSheet: vi.fn(async () => ({ version: 1, sheet_url: null, updated_at: null })),
    health: async () => ({ ok: true, build: 'test', flags: { openrouter: true, fal: false, motion: false, kill: false } }),
    ...overrides,
  } as Record<string, unknown> & {
    uploadPhoto: ReturnType<typeof vi.fn>; createConsent: ReturnType<typeof vi.fn>;
    requestCharacterSheet: ReturnType<typeof vi.fn>; pollJob: ReturnType<typeof vi.fn>;
  };
}

const file = () => new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' });

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => cleanup());

async function pickAndStart(name = 'Priya') {
  await screen.findByTestId('photo-likeness');
  fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file()] } });
  fireEvent.change(screen.getByLabelText('Your name for consent'), { target: { value: name } });
  fireEvent.click(screen.getByTestId('make-likeness'));
}

describe('photo likeness card (T6–T7)', () => {
  it('runs photo → consent → upload → sheet → poll and shows the honest preview chip', async () => {
    const api = fakeWorkerApi();
    mount(api);
    await pickAndStart();
    await waitFor(() => expect(api.requestCharacterSheet).toHaveBeenCalledWith('p1', 'c1'));
    await waitFor(() => expect(screen.getByTestId('ai-preview')).toBeInTheDocument());
    expect(api.uploadPhoto).toHaveBeenCalledOnce();
    expect(api.createConsent).toHaveBeenCalledWith('Priya', false);
    expect(screen.getByText('Preview coming shortly')).toBeInTheDocument();
  });

  it('shows a signed image instead of the chip when a sheet_url is available', async () => {
    const api = fakeWorkerApi({ characterSheet: vi.fn(async () => ({ version: 1, sheet_url: 'https://cdn.test/sheet.png', updated_at: null })) });
    mount(api);
    await pickAndStart();
    const img = await screen.findByAltText("AI drawing of Mira");
    expect(img).toHaveAttribute('src', 'https://cdn.test/sheet.png');
    expect(screen.queryByText('Preview coming shortly')).not.toBeInTheDocument();
  });

  it('maps a job failure to honest copy and never shows a fake preview', async () => {
    const api = fakeWorkerApi({ pollJob: vi.fn(async () => ({ status: 'failed', error: 'photo_too_small' })) });
    mount(api);
    await pickAndStart();
    expect(await screen.findByTestId('likeness-error')).toHaveTextContent('too small');
    expect(screen.queryByTestId('ai-preview')).not.toBeInTheDocument();
  });

  it('maps a network WorkerError code (photo_too_large) to copy', async () => {
    const api = fakeWorkerApi({ uploadPhoto: vi.fn(async () => { const e = new Error('photo_too_large'); (e as { code?: string }).code = 'photo_too_large'; throw e; }) });
    mount(api);
    await pickAndStart();
    expect(await screen.findByTestId('likeness-error')).toHaveTextContent('too big');
  });

  it('requires a parent name before starting (consent guard)', async () => {
    const api = fakeWorkerApi();
    mount(api);
    await screen.findByTestId('photo-likeness');
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file()] } });
    fireEvent.click(screen.getByTestId('make-likeness'));
    expect(api.uploadPhoto).not.toHaveBeenCalled();
    expect(screen.getByTestId('likeness-error')).toHaveTextContent('Type your name');
  });

  it('sanitises and clamps the parent name before sending it to consent (legal artefact)', async () => {
    const api = fakeWorkerApi();
    mount(api);
    await pickAndStart('Pri😀ya!!  ' + 'x'.repeat(60));
    await waitFor(() => expect(api.createConsent).toHaveBeenCalled());
    const [sent] = api.createConsent.mock.calls[0] as [string, boolean];
    expect(sent).not.toMatch(/😀|!/);
    expect(sent.length).toBeLessThanOrEqual(40);
    expect(sent.startsWith('Priya')).toBe(true);
  });

  it('keeps a Cancel affordance visible while uploading/rendering', async () => {
    let resolvePoll: (v: { status: string; progress: number }) => void = () => {};
    const api = fakeWorkerApi({
      pollJob: vi.fn(async () => new Promise<{ status: string; progress: number }>(res => { resolvePoll = res; })),
    });
    mount(api);
    await pickAndStart();
    expect(await screen.findByTestId('cancel-likeness')).toBeInTheDocument();
    resolvePoll({ status: 'done', progress: 100 });
  });

  it('hides entirely on non-Worker backends so the trait avatar still works', async () => {
    const api = fakeWorkerApi({ uploadPhoto: undefined });
    mount(api);
    await screen.findByTestId('make');
    expect(screen.queryByTestId('photo-likeness')).not.toBeInTheDocument();
    expect(screen.getByTestId('avatar-chip')).toBeInTheDocument();
  });

  it('shows the honest motion-paused line when the Worker reports motion=false (T9)', async () => {
    mount(fakeWorkerApi({ health: async () => ({ ok: true, build: 'test', flags: { openrouter: false, fal: false, motion: false, kill: false } }) }));
    expect(await screen.findByTestId('motion-paused')).toHaveTextContent('Motion is paused today');
  });

  it('never claims motion works even if VITE_HD_ENABLED is on but motion is false', async () => {
    vi.stubEnv('VITE_HD_ENABLED', 'true');
    mount(fakeWorkerApi({ health: async () => ({ ok: true, build: 'test', flags: { openrouter: true, fal: false, motion: false, kill: false } }) }));
    expect(await screen.findByTestId('motion-paused')).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('drops the paused line when the Worker reports motion=true — but only with the build flag (§H)', async () => {
    vi.stubEnv('VITE_HD_ENABLED', 'true');
    mount(fakeWorkerApi({ health: async () => ({ ok: true, build: 'test', flags: { openrouter: true, fal: false, motion: true, kill: false } }) }));
    await screen.findByTestId('make');
    await waitFor(() => expect(screen.queryByTestId('motion-paused')).toBeNull());
    vi.unstubAllEnvs();
  });
});
