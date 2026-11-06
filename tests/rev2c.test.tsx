import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StoreProvider, useStore } from '../src/store';
import { BookReader } from '../src/screens/Book';
import { Catalog } from '../src/screens/Catalog';
import { Admin } from '../src/screens/Admin';
import { PhotoLikenessCard } from '../src/screens/PhotoLikenessCard';
import { DEFAULT_LOOK } from '../src/mascot';
import { SETTINGS_DEFAULTS } from '../src/data/local';
import { TEMPLATES, bookPages } from '../src/data/seed';
import { BOOK_PAGES_KEY, saveBookPage } from '../src/data/bookPages';
import { ERROR_COPY, errorCopy } from '../src/data/errorCopy';
import type { Book, Reel } from '../src/data/types';

const t = TEMPLATES.find(x => x.id === 'moon')!;
const reel: Reel = { id: 'r1', template_id: 'moon', state: t.default_state, version: 1, status: 'ready', video_url: null, loved: false, saved: false, created_at: '', updated_at: '' };
const BOOK: Book = { id: 'book:r1', reel_id: 'r1', title: "Mira's Moon Trip", pages: bookPages(t, 'Mira', reel.state) };

const household = () => ({
  id: 'k1',
  kid: { id: 'k1', display_name: 'Mira', age_band: '4-6' },
  character: { id: 'pending:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } },
  settings: { ...SETTINGS_DEFAULTS },
});

/** A household that already has a character sheet, so the R.3.2 editor is reachable. */
const sheetHousehold = () => ({
  ...household(),
  character: { id: 'sheet:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } },
});

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'worker',
    init: async () => household(),
    household: async () => household(),
    templates: async () => TEMPLATES,
    reels: async () => [reel], books: async () => [BOOK],
    reelVersions: async () => [], jobs: async () => [], consents: async () => [], publishQueue: async () => [],
    setConsent: async () => {}, setLoved: async () => {}, setSaved: async () => {},
    updateKid: async () => {}, updateLook: async () => {}, updateSettings: async () => {},
    queuePublish: async () => ({}), cancelPublish: async () => {}, videoBlob: async () => null,
    onReels: () => () => {}, deleteAll: async () => {},
    saveBookPageText: async () => ({ saved: true, server: true }),
    resetBookPage: async () => ({ ok: true }),
    ...overrides,
  } as never;
}

function Ready({ which }: { which: 'book' | 'catalog' | 'admin' | 'likeness' }) {
  const s = useStore();
  if (!s.ready || !s.hh) return null;
  if (which === 'book') return s.books.length ? <BookReader /> : null;
  if (which === 'catalog') return <Catalog />;
  if (which === 'admin') return <Admin />;
  return <PhotoLikenessCard kidId="k1" kidName="Mira" />;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); window.speechSynthesis = undefined as never; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('R.5.1 Book reader — Regenerate this page (AI)', () => {
  it('offers the CTA only when the reel is a Worker reel, and puts the new words in the draft', async () => {
    const regenerateBookPage = vi.fn(async () => ({ text: 'A brand new moon page.', keyframe_url: null, regenerated: ['caption'] }));
    render(<StoreProvider api={fakeApi({ regenerateBookPage })}><Ready which="book" /></StoreProvider>);
    await screen.findByTestId('book');

    fireEvent.click(screen.getByTestId('edit-page'));
    fireEvent.click(screen.getByTestId('regenerate-page'));

    await waitFor(() => expect(regenerateBookPage).toHaveBeenCalledWith('r1', 'book:r1', 0, { caption: true }));
    await waitFor(() => expect(screen.getByTestId('page-textarea')).toHaveValue('A brand new moon page.'));
    expect(screen.getByTestId('regen-note')).toHaveTextContent('New words from the AI');
    // Preview only: the regenerate itself must not have written the page anywhere.
    expect(JSON.parse(localStorage.getItem(BOOK_PAGES_KEY) ?? '{}')).toEqual({});
  });

  it('persists the AI words only when Save is tapped', async () => {
    const saveBookPageText = vi.fn(async (_reel: string, bookId: string, index: number, text: string) => {
      saveBookPage(bookId, index, text);
      return { saved: true, server: true };
    });
    const regenerateBookPage = vi.fn(async () => ({ text: 'A brand new moon page.', keyframe_url: null, regenerated: ['caption'] }));
    render(<StoreProvider api={fakeApi({ regenerateBookPage, saveBookPageText })}><Ready which="book" /></StoreProvider>);
    await screen.findByTestId('book');

    fireEvent.click(screen.getByTestId('edit-page'));
    fireEvent.click(screen.getByTestId('regenerate-page'));
    await waitFor(() => expect(screen.getByTestId('page-textarea')).toHaveValue('A brand new moon page.'));
    expect(saveBookPageText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('save-page'));
    await waitFor(() => expect(saveBookPageText).toHaveBeenCalledWith('r1', 'book:r1', 0, 'A brand new moon page.'));
    expect(JSON.parse(localStorage.getItem(BOOK_PAGES_KEY)!)['book:r1']['0'].text).toBe('A brand new moon page.');
  });

  it('discards the AI words on Cancel without writing them to the page', async () => {
    const saveBookPageText = vi.fn(async () => ({ saved: true, server: true }));
    const regenerateBookPage = vi.fn(async () => ({ text: 'A brand new moon page.', keyframe_url: null, regenerated: ['caption'] }));
    render(<StoreProvider api={fakeApi({ regenerateBookPage, saveBookPageText })}><Ready which="book" /></StoreProvider>);
    await screen.findByTestId('book');

    fireEvent.click(screen.getByTestId('edit-page'));
    fireEvent.click(screen.getByTestId('regenerate-page'));
    await waitFor(() => expect(screen.getByTestId('page-textarea')).toHaveValue('A brand new moon page.'));

    fireEvent.click(screen.getByTestId('cancel-edit'));
    await waitFor(() => expect(screen.queryByTestId('page-editor')).toBeNull());
    // Neither copy moved: no save call, no local override, the page keeps its words.
    expect(saveBookPageText).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(BOOK_PAGES_KEY) ?? '{}')).toEqual({});
    expect(screen.getByTestId('page-text')).toHaveTextContent(BOOK.pages[0]!.text);
  });

  it('hides the CTA when the backend has no regenerate method (on-device build)', async () => {
    render(<StoreProvider api={fakeApi()}><Ready which="book" /></StoreProvider>);
    await screen.findByTestId('book');
    fireEvent.click(screen.getByTestId('edit-page'));
    expect(screen.queryByTestId('regenerate-page')).toBeNull();
  });

  it('surfaces a refusal as human copy rather than reporting success', async () => {
    const err = Object.assign(new Error('provider_disabled'), { code: 'provider_disabled' });
    const regenerateBookPage = vi.fn(async () => { throw err; });
    render(<StoreProvider api={fakeApi({ regenerateBookPage })}><Ready which="book" /></StoreProvider>);
    await screen.findByTestId('book');

    fireEvent.click(screen.getByTestId('edit-page'));
    fireEvent.click(screen.getByTestId('regenerate-page'));

    await waitFor(() => expect(screen.getByTestId('regen-note')).toHaveTextContent(ERROR_COPY.provider_disabled!));
    // The draft keeps the original words — a failed regenerate never blanks a page.
    expect(screen.getByTestId('page-textarea')).toHaveValue(BOOK.pages[0]!.text);
  });
});

describe('Phase B #11 / R.4 Catalog — paid tier badge honesty', () => {
  it('shows "paid — paused" when the health probe says openrouter is off', async () => {
    const api = fakeApi({
      health: vi.fn(async () => ({ ok: true, build: 'test', flags: { openrouter: false, fal: false, kill: false, ffmpeg: null } })),
      catalog: vi.fn(async () => [
        { id: 'tpl_paid', slug: 'paid-one', title: '{name} and the Paid One', cover: 'local:reel-ocean.jpg', description: 'PLACEHOLDER', age_band: '3-5', tier_default: 'paid', page_count: 6, enabled: true },
      ]),
    });
    render(<StoreProvider api={api}><Ready which="catalog" /></StoreProvider>);
    expect(await screen.findByText(/paid — paused/)).toBeInTheDocument();
  });

  it('shows a plain paid badge when openrouter is on', async () => {
    const api = fakeApi({
      health: vi.fn(async () => ({ ok: true, build: 'test', flags: { openrouter: true, fal: false, kill: false, ffmpeg: true } })),
      catalog: vi.fn(async () => [
        { id: 'tpl_paid', slug: 'paid-one', title: '{name} and the Paid One', cover: 'local:reel-ocean.jpg', description: 'PLACEHOLDER', age_band: '3-5', tier_default: 'paid', page_count: 6, enabled: true },
      ]),
    });
    render(<StoreProvider api={api}><Ready which="catalog" /></StoreProvider>);
    // Titles are filled with the kid's name before display, so the literal
    // "{name}" placeholder is never what a parent reads.
    await screen.findByText('Mira and the Paid One');
    expect(screen.queryByText(/paused/)).toBeNull();
    expect(screen.getByTestId('tier-badge')).toHaveTextContent('✨ paid');
  });
});

describe('Phase B #10 Admin — non-admin bootstrap hint', () => {
  it('explains the operator path without ever offering a token form', async () => {
    const api = fakeApi({
      me: vi.fn(async () => ({ user_id: 'u1', is_admin: false })),
      adminTemplates: vi.fn(async () => []),
    });
    render(<StoreProvider api={api}><Ready which="admin" /></StoreProvider>);

    const hint = await screen.findByTestId('admin-bootstrap-hint');
    expect(hint).toHaveTextContent('/api/admin/bootstrap');
    expect(hint).toHaveTextContent('X-Admin-Token');
    // No credential input anywhere in the gate.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});

describe('R.2.2 A-04 Admin — personalisation preview', () => {
  const KIDS = { kids: [{ id: 'k1', display_name: 'Mira', has_sheet: true }, { id: 'k2', display_name: 'Sam', has_sheet: false }] };
  const PREVIEW = {
    template_id: 'tpl_a',
    kid: { id: 'k1', display_name: 'Mira' },
    live: false,
    base: 'https://api.example.dev',
    overlay_url: 'https://api.example.dev/api/media/sheets/k1/s1.png?exp=1&sig=x',
    shots: [
      { index: 1, keyframe_url: null, caption: '{name} meets a tiny mouse.', prompt: null },
      { index: 2, keyframe_url: null, caption: '{name} sails home.', prompt: null },
    ],
  };

  it('renders one placeholder shot per page with the kid drawing as the overlay', async () => {
    const adminTemplatePreview = vi.fn(async () => PREVIEW);
    const api = fakeApi({
      me: vi.fn(async () => ({ user_id: 'u1', is_admin: true })),
      kids: vi.fn(async () => KIDS),
      adminTemplates: vi.fn(async () => [
        { id: 'tpl_a', slug: 'a', title: '{name} and the Lantern', cover: 'local:cover.jpg', description: 'PLACEHOLDER', age_band: '3-5', tier_default: 'free', page_count: 6, enabled: true },
      ]),
      adminTemplatePreview,
    });
    render(<StoreProvider api={api}><Ready which="admin" /></StoreProvider>);

    fireEvent.click(await screen.findByTestId('admin-preview-tpl_a'));
    await waitFor(() => expect(adminTemplatePreview).toHaveBeenCalledWith('tpl_a', 'k1'));

    expect(await screen.findByTestId('preview-shot-1')).toBeInTheDocument();
    expect(screen.getByTestId('preview-shot-2')).toBeInTheDocument();
    // The kid's display name is filled into the template caption, never "{name}".
    expect(screen.getByTestId('preview-shots')).toHaveTextContent('Mira meets a tiny mouse.');
    expect(screen.getByTestId('preview-overlay-1')).toBeInTheDocument();
  });

  it('shows the sheet_required refusal as copy when the picked kid has no drawing', async () => {
    const err = Object.assign(new Error('sheet_required'), { code: 'sheet_required' });
    const api = fakeApi({
      me: vi.fn(async () => ({ user_id: 'u1', is_admin: true })),
      kids: vi.fn(async () => KIDS),
      adminTemplates: vi.fn(async () => [
        { id: 'tpl_a', slug: 'a', title: '{name} and the Lantern', cover: 'local:cover.jpg', description: 'PLACEHOLDER', age_band: '3-5', tier_default: 'free', page_count: 6, enabled: true },
      ]),
      adminTemplatePreview: vi.fn(async () => { throw err; }),
    });
    render(<StoreProvider api={api}><Ready which="admin" /></StoreProvider>);

    fireEvent.click(await screen.findByTestId('admin-preview-tpl_a'));
    await waitFor(() => expect(screen.getByTestId('preview-error')).toHaveTextContent(ERROR_COPY.sheet_required!));
  });

  it('names templates by their filled title in aria-labels, and offers no Preview without the API', async () => {
    const tpl = { id: 'tpl_a', slug: 'a', title: '{name} and the Lantern', cover: 'local:cover.jpg', description: 'PLACEHOLDER', age_band: '3-5', tier_default: 'free', page_count: 6, enabled: true };
    const withPreview = fakeApi({
      me: vi.fn(async () => ({ user_id: 'u1', is_admin: true })),
      kids: vi.fn(async () => KIDS),
      adminTemplates: vi.fn(async () => [tpl]),
      adminTemplatePreview: vi.fn(async () => PREVIEW),
    });
    render(<StoreProvider api={withPreview}><Ready which="admin" /></StoreProvider>);
    // "Mira", not "{name}": the button announces what the operator will actually see.
    const btn = await screen.findByTestId('admin-preview-tpl_a');
    expect(btn).toHaveAttribute('aria-label', 'Preview personalisation for Mira and the Lantern');
    cleanup();

    // A build whose API has no preview method shows no Preview button at all.
    const withoutPreview = fakeApi({
      me: vi.fn(async () => ({ user_id: 'u1', is_admin: true })),
      kids: vi.fn(async () => KIDS),
      adminTemplates: vi.fn(async () => [tpl]),
    });
    render(<StoreProvider api={withoutPreview}><Ready which="admin" /></StoreProvider>);
    await screen.findByTestId('admin');
    await waitFor(() => expect(screen.queryByTestId('admin-preview-tpl_a')).toBeNull());
  });
});

describe('R.3.2 avatar editor', () => {
  const sheetApi = (overrides: Record<string, unknown> = {}) => fakeApi({
    init: async () => sheetHousehold(),
    household: async () => sheetHousehold(),
    uploadPhoto: async () => ({ photo_id: 'p1' }),
    createConsent: async () => ({ consent_id: 'c1' }),
    requestCharacterSheet: async () => ({ job_id: 'j1' }),
    pollJob: async () => ({ status: 'done' }),
    characterSheet: async () => ({ version: 3, sheet_url: 'https://x/sheet.png', updated_at: new Date().toISOString(), hints: null }),
    saveLookHints: vi.fn(async () => ({ ok: true, hints: { skin: '', hair: '', extras: '', outfit: '', style: '' } })),
    ...overrides,
  });

  it('pre-fills from the server, saves a look, and can cancel without writing', async () => {
    const saveLookHints = vi.fn(async (_hints: Record<string, string>, _kidId?: string) => ({ ok: true, hints: { skin: '', hair: 'short curls', extras: '', outfit: '', style: '' } }));
    const characterSheet = vi.fn(async () => ({
      version: 2, sheet_url: 'https://x/sheet.png', updated_at: new Date().toISOString(),
      hints: { skin: 'olive', hair: '', extras: '', outfit: '', style: '' },
    }));
    render(<StoreProvider api={sheetApi({ saveLookHints, characterSheet })}><Ready which="likeness" /></StoreProvider>);

    // Once a sheet exists the card shows the editor link.
    fireEvent.click(await screen.findByTestId('edit-look'));
    expect(await screen.findByTestId('character-editor')).toBeInTheDocument();

    // Pre-filled from the server's stored hints, not a client default.
    await waitFor(() => expect(screen.getByTestId('hint-skin-olive')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Drawing v2');

    fireEvent.click(screen.getByTestId('hint-hair-short curls'));
    fireEvent.click(screen.getByTestId('save-look'));
    await waitFor(() => expect(saveLookHints).toHaveBeenCalled());
    expect(saveLookHints.mock.calls[0]![0]).toMatchObject({ skin: 'olive', hair: 'short curls' });
    expect(await screen.findByTestId('editor-note')).toHaveTextContent('Look saved');

    fireEvent.click(screen.getByTestId('cancel-character-editor'));
    await waitFor(() => expect(screen.queryByTestId('character-editor')).toBeNull());
  });

  it('regenerates with the edits, omitting photo_id so the Worker reuses the retained photo', async () => {
    const requestCharacterSheet = vi.fn(
      async (_photoId: string | null, _consentId: string, _kidId?: string, _hints?: Record<string, string>) => ({ job_id: 'j9' }),
    );
    const pollJob = vi.fn(async (_jobId: string) => ({ status: 'done' }));
    render(<StoreProvider api={sheetApi({ requestCharacterSheet, pollJob })}><Ready which="likeness" /></StoreProvider>);

    fireEvent.click(await screen.findByTestId('edit-look'));
    await screen.findByTestId('character-editor');
    fireEvent.click(screen.getByTestId('hint-outfit-an astronaut suit'));
    fireEvent.click(screen.getByTestId('regenerate-with-edits'));

    await waitFor(() => expect(requestCharacterSheet).toHaveBeenCalled());
    const args = requestCharacterSheet.mock.calls[0]!;
    expect(args[0]).toBeNull();
    expect(args[2]).toBe('k1');
    expect(args[3]).toMatchObject({ outfit: 'an astronaut suit' });
    expect(pollJob).toHaveBeenCalledWith('j9');
  });

  it('explains a photo_expired regenerate instead of silently doing nothing', async () => {
    const err = Object.assign(new Error('photo_expired'), { code: 'photo_expired' });
    render(<StoreProvider api={sheetApi({ requestCharacterSheet: vi.fn(async () => { throw err; }) })}><Ready which="likeness" /></StoreProvider>);

    fireEvent.click(await screen.findByTestId('edit-look'));
    await screen.findByTestId('character-editor');
    fireEvent.click(screen.getByTestId('regenerate-with-edits'));
    await waitFor(() => expect(screen.getByTestId('editor-error')).toHaveTextContent(ERROR_COPY.photo_expired!));
  });
});

describe('Phase B #12 shared error copy', () => {
  it('covers every code the Phase C routes can return, and never leaks a raw code', () => {
    for (const code of [
      'photo_expired', 'photo_not_found', 'no_character_sheet', 'sheet_required', 'hints_required',
      'provider_disabled', 'kill_switch', 'budget_exceeded', 'rate_limited',
      'page_not_found', 'text_or_regenerate_required', 'ambiguous_page_patch', 'invalid_page_index',
      'template_not_found', 'template_has_no_shots', 'admin_only', 'consent_required',
    ]) {
      expect(ERROR_COPY[code], `missing copy for ${code}`).toBeTruthy();
      expect(errorCopy(code)).not.toBe(code);
    }
    // Unknown codes still get a sentence, never the code or an empty string.
    expect(errorCopy('brand_new_code')).toBe(errorCopy(undefined));
    expect(errorCopy('brand_new_code')).not.toContain('brand_new_code');
  });

  it('maps §H motion failures to honest copy, including status-carrying codes', () => {
    // A job error can be dynamic (`…_http_502`), so these resolve by family.
    for (const code of [
      'openrouter_video_failed', 'openrouter_video_timeout',
      'openrouter_video_submit_http_502', 'openrouter_video_status_http_429',
      'openrouter_video_content_http_404', 'openrouter_video_download_http_500',
      'unsafe_video_input_key',
    ]) {
      const copy = errorCopy(code);
      expect(copy, `missing copy for ${code}`).toBeTruthy();
      expect(copy).not.toContain(code);
      expect(copy).not.toContain('fal');
      // Never a raw status or an internal identifier on screen.
      expect(copy).not.toMatch(/\d{3}/);
    }
    // Known motion codes keep their distinct wording (the prefix rule is a
    // fallback, not an override), and unknown families stay generic.
    expect(errorCopy('openrouter_video_timeout')).toBe(ERROR_COPY.openrouter_video_timeout);
    expect(errorCopy('openrouter_video_no_job_id')).toBe(ERROR_COPY.openrouter_video_no_job_id);
    expect(errorCopy('some_unmapped_thing')).toBe(errorCopy(undefined));
  });

  it('mentions the 24h retention promise only where the sweep backs it', async () => {
    render(<StoreProvider api={fakeApi({
      uploadPhoto: async () => ({ photo_id: 'p1' }),
      createConsent: async () => ({ consent_id: 'c1' }),
      requestCharacterSheet: async () => ({ job_id: 'j1' }),
      pollJob: async () => ({ status: 'done' }),
      characterSheet: async () => ({ version: 1, sheet_url: null, updated_at: null, hints: null }),
      saveLookHints: async () => ({ ok: true, hints: { skin: '', hair: '', extras: '', outfit: '', style: '' } }),
    })}><Ready which="likeness" /></StoreProvider>);
    // Rendered on a plain (no-sheet) kid too, so the promise is always visible.
    expect(await screen.findByTestId('photo-retention')).toHaveTextContent('24 hours');
  });
});
