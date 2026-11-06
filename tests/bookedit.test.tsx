import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StoreProvider, useStore } from '../src/store';
import { BookReader } from '../src/screens/Book';
import { DEFAULT_LOOK } from '../src/mascot';
import { SETTINGS_DEFAULTS } from '../src/data/local';
import { TEMPLATES, bookPages } from '../src/data/seed';
import { BOOK_PAGES_KEY, clearBookPage, saveBookPage } from '../src/data/bookPages';
import type { Book, Reel } from '../src/data/types';

const t = TEMPLATES.find(x => x.id === 'moon')!;
const reel: Reel = { id: 'r1', template_id: 'moon', state: t.default_state, version: 1, status: 'ready', video_url: null, loved: false, saved: false, created_at: '', updated_at: '' };
const BOOK: Book = { id: 'book:r1', reel_id: 'r1', title: "Mira's Moon Trip", pages: bookPages(t, 'Mira', reel.state) };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'worker',
    init: async () => ({ id: 'k1', kid: { id: 'k1', display_name: 'Mira', age_band: '4-6' }, character: { id: 'pending:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } }, settings: { ...SETTINGS_DEFAULTS } }),
    household: async () => ({ id: 'k1', kid: { id: 'k1', display_name: 'Mira', age_band: '4-6' }, character: { id: 'pending:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } }, settings: { ...SETTINGS_DEFAULTS } }),
    templates: async () => TEMPLATES, reels: async () => [reel], books: async () => [BOOK],
    reelVersions: async () => [], jobs: async () => [], consents: async () => [], publishQueue: async () => [],
    setConsent: async () => {}, setLoved: async () => {}, setSaved: async () => {}, updateKid: async () => {}, updateLook: async () => {}, updateSettings: async () => {},
    queuePublish: async () => ({}), cancelPublish: async () => {}, videoBlob: async () => null, onReels: () => () => {}, deleteAll: async () => {},
    createReel: async () => ({ reel_id: 'r1', version: 1, job_id: 'j' }), remake: async () => ({ reel_id: 'r1', version: 2, job_id: 'j' }),
    // Delegate to the real localStorage helpers so the fake behaves like WorkerApi.
    saveBookPageText: vi.fn(async (_reel: string, bookId: string, index: number, text: string) => { saveBookPage(bookId, index, text); return { saved: true, server: true }; }),
    resetBookPage: vi.fn(async (_reel: string, bookId: string, index: number) => { clearBookPage(bookId, index); return { ok: true }; }),
    ...overrides,
  } as Record<string, unknown> & { saveBookPageText: ReturnType<typeof vi.fn>; resetBookPage: ReturnType<typeof vi.fn> };
}

function Ready() { const s = useStore(); return s.ready && s.hh && s.books.length ? <BookReader /> : null; }
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); window.speechSynthesis = undefined as never; });
afterEach(() => cleanup());

describe('BookReader per-page editor (§R.5 M-21)', () => {
  it('opens the editor, saves the text through WorkerApi and stores it under sb.bookPages.v1', async () => {
    saveBookPage('book:r1', 0, 'edited line');
    const api = fakeApi();
    render(<StoreProvider api={api as never}><Ready /></StoreProvider>);

    expect(await screen.findByTestId('book')).toBeInTheDocument();
    // The override was overlaid before the reader rendered.
    expect(screen.getByTestId('page-text')).toHaveTextContent('edited line');

    fireEvent.click(screen.getByTestId('edit-page'));
    const area = screen.getByTestId('page-textarea') as HTMLTextAreaElement;
    expect(area.value).toBe('edited line');
    fireEvent.change(area, { target: { value: '  a brand new page  ' } });
    fireEvent.click(screen.getByTestId('save-page'));

    await waitFor(() => expect(api.saveBookPageText).toHaveBeenCalledWith('r1', 'book:r1', 0, 'a brand new page'));
    const stored = JSON.parse(localStorage.getItem(BOOK_PAGES_KEY)!) as Record<string, Record<string, { text: string }>>;
    expect(stored['book:r1']?.['0']?.text).toBe('a brand new page');
  });

  it('cmd/ctrl + enter saves without clicking', async () => {
    const api = fakeApi();
    render(<StoreProvider api={api as never}><Ready /></StoreProvider>);
    await screen.findByTestId('book');
    fireEvent.click(screen.getByTestId('edit-page'));
    fireEvent.change(screen.getByTestId('page-textarea'), { target: { value: 'keyboard save' } });
    fireEvent.keyDown(screen.getByTestId('page-textarea'), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(api.saveBookPageText).toHaveBeenCalledWith('r1', 'book:r1', 0, 'keyboard save'));
  });

  it('Reset to template clears the override locally and on the server', async () => {
    saveBookPage('book:r1', 0, 'edited line');
    const api = fakeApi();
    render(<StoreProvider api={api as never}><Ready /></StoreProvider>);
    await screen.findByTestId('book');

    fireEvent.click(screen.getByTestId('edit-page'));
    fireEvent.click(screen.getByTestId('reset-page'));
    await waitFor(() => expect(api.resetBookPage).toHaveBeenCalledWith('r1', 'book:r1', 0));
    // The template text comes back after the store refresh.
    await waitFor(() => expect(screen.getByTestId('page-text')).not.toHaveTextContent('edited line'));
    expect(JSON.parse(localStorage.getItem(BOOK_PAGES_KEY) ?? '{}')).toEqual({});
  });

  it('hides the pencil on a backend with no page endpoints', async () => {
    const api = fakeApi({ saveBookPageText: undefined, resetBookPage: undefined, mode: 'local' });
    render(<StoreProvider api={api as never}><Ready /></StoreProvider>);
    await screen.findByTestId('book');
    expect(screen.queryByTestId('edit-page')).not.toBeInTheDocument();
  });
});
