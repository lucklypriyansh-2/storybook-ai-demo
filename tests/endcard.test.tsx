import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StoreProvider, useStore } from '../src/store';
import { EndCard } from '../src/screens/EndCard';
import { DEFAULT_LOOK } from '../src/mascot';
import { SETTINGS_DEFAULTS } from '../src/data/local';
import { TEMPLATES, bookPages } from '../src/data/seed';
import type { Book, Reel } from '../src/data/types';

const t = TEMPLATES.find(x => x.id === 'moon')!;
const reel: Reel = { id: 'r1', template_id: 'moon', state: t.default_state, version: 1, status: 'ready', video_url: null, loved: false, saved: false, created_at: '', updated_at: '' };

function apiWith(books: Book[]) {
  return {
    mode: 'worker' as const,
    init: async () => ({ id: 'k1', kid: { id: 'k1', display_name: 'Mira', age_band: '4-6' }, character: { id: 'pending:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } }, settings: { ...SETTINGS_DEFAULTS } }),
    household: async () => ({ id: 'k1', kid: { id: 'k1', display_name: 'Mira', age_band: '4-6' }, character: { id: 'pending:k1', kid_id: 'k1', look: { ...DEFAULT_LOOK } }, settings: { ...SETTINGS_DEFAULTS } }),
    templates: async () => TEMPLATES, reels: async () => [reel], books: async () => books,
    reelVersions: async () => [], jobs: async () => [], consents: async () => [], publishQueue: async () => [],
    setConsent: async () => {}, setLoved: async () => {}, setSaved: async () => {}, updateKid: async () => {}, updateLook: async () => {}, updateSettings: async () => {},
    queuePublish: async () => ({}), cancelPublish: async () => {}, videoBlob: async () => null, onReels: () => () => {}, deleteAll: async () => {},
    createReel: async () => ({ reel_id: 'r1', version: 1, job_id: 'j' }), remake: async () => ({ reel_id: 'r1', version: 2, job_id: 'j' }),
  };
}

function Ready() { const s = useStore(); return s.ready && s.hh ? <EndCard reel={reel} onClose={() => {}} onNext={() => {}} /> : null; }
afterEach(() => cleanup());

describe('EndCard pages copy (T10)', () => {
  it('shows the page count when the derived book has pages', async () => {
    const book: Book = { id: 'book:r1', reel_id: 'r1', title: "Mira's Moon Trip", pages: bookPages(t, 'Mira', reel.state) };
    render(<StoreProvider api={apiWith([book]) as never}><Ready /></StoreProvider>);
    const pages = await screen.findByTestId('endcard-pages');
    expect(pages).toHaveTextContent(`${book.pages.length} pages`);
    expect(pages.textContent).not.toContain('0 pages');
  });

  it('omits the page count honestly when no book is derived (never prints "0 pages")', async () => {
    render(<StoreProvider api={apiWith([]) as never}><Ready /></StoreProvider>);
    const pages = await screen.findByTestId('endcard-pages');
    expect(pages.textContent).not.toContain('0 pages');
    expect(pages).toHaveTextContent('The full story · read-along with Nibbs');
  });

  it('never offers to buy a book that was not generated (no book → CTA disabled)', async () => {
    render(<StoreProvider api={apiWith([]) as never}><Ready /></StoreProvider>);
    await screen.findByTestId('endcard');
    expect(screen.getByRole('button', { name: /Read the whole story/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /real book/ })).toBeDisabled();
  });
});
