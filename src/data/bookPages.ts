import type { Book } from './types';

/**
 * Client-persisted per-page text overrides (R.5.2). Shape:
 * `{ [book_id]: { [index]: { text } } }`, stored under `sb.bookPages.v1`.
 * Survives reloads; the server keeps the same override in
 * `reel_page_overrides` via PATCH /api/reels/:id/pages/:index.
 */
export type PageOverride = { text: string };
export type BookPageOverrides = Record<string, Record<number, PageOverride>>;

export const BOOK_PAGES_KEY = 'sb.bookPages.v1';

export function loadBookPages(): BookPageOverrides {
  try {
    const raw = localStorage.getItem(BOOK_PAGES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: BookPageOverrides = {};
    for (const [bookId, pages] of Object.entries(parsed as Record<string, unknown>)) {
      if (!pages || typeof pages !== 'object') continue;
      const clean: Record<number, PageOverride> = {};
      for (const [index, value] of Object.entries(pages as Record<string, unknown>)) {
        const i = Number(index);
        const text = (value as { text?: unknown } | null)?.text;
        if (Number.isInteger(i) && i >= 0 && typeof text === 'string') clean[i] = { text };
      }
      if (Object.keys(clean).length > 0) out[bookId] = clean;
    }
    return out;
  } catch {
    return {}; // private mode / corrupt JSON: start empty rather than crash
  }
}

function persist(map: BookPageOverrides): void {
  try { localStorage.setItem(BOOK_PAGES_KEY, JSON.stringify(map)); }
  catch { /* private mode: overrides live for this session only */ }
}

/** Merges the persisted overrides into derived template pages (pure, no I/O). */
export function applyOverrides(book: Book, overrides: BookPageOverrides): Book {
  const mine = overrides[book.id];
  if (!mine) return book;
  const pages = book.pages.map((page, i) => (mine[i] ? { ...page, text: mine[i]!.text } : page));
  return { ...book, pages };
}

export function saveBookPage(bookId: string, index: number, text: string): BookPageOverrides {
  const map = loadBookPages();
  const pages = { ...(map[bookId] ?? {}) };
  pages[index] = { text };
  map[bookId] = pages;
  persist(map);
  return map;
}

export function clearBookPage(bookId: string, index: number): BookPageOverrides {
  const map = loadBookPages();
  const pages = { ...(map[bookId] ?? {}) };
  delete pages[index];
  if (Object.keys(pages).length > 0) map[bookId] = pages;
  else delete map[bookId];
  persist(map);
  return map;
}

/** Overrides keyed for a book, in-memory only (used for optimistic UI). */
export function withPageText(book: Book, index: number, text: string): Book {
  return { ...book, pages: book.pages.map((p, i) => (i === index ? { ...p, text } : p)) };
}
