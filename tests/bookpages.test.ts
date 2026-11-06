import { describe, it, expect, beforeEach } from 'vitest';
import { applyOverrides, BOOK_PAGES_KEY, clearBookPage, loadBookPages, saveBookPage, withPageText } from '../src/data/bookPages';
import type { Book } from '../src/data/types';

const book = (): Book => ({ id: 'book:r1', reel_id: 'r1', title: 'T', pages: [{ text: 'one', image: 'a.jpg' }, { text: 'two', image: 'a.jpg' }] });

beforeEach(() => localStorage.clear());

describe('sb.bookPages.v1 override store (R.5.2)', () => {
  it('persists, reads back and overlays a page edit', () => {
    saveBookPage('book:r1', 1, 'edited two');
    expect(loadBookPages()).toEqual({ 'book:r1': { 1: { text: 'edited two' } } });
    const merged = applyOverrides(book(), loadBookPages());
    expect(merged.pages.map(p => p.text)).toEqual(['one', 'edited two']);
  });

  it('tolerates corrupt JSON and private-mode failures', () => {
    localStorage.setItem(BOOK_PAGES_KEY, '{ not json');
    expect(loadBookPages()).toEqual({});
    localStorage.setItem(BOOK_PAGES_KEY, JSON.stringify({ 'book:r1': { x: { text: 'nope' }, 0: { text: 'ok' } } }));
    expect(loadBookPages()).toEqual({ 'book:r1': { 0: { text: 'ok' } } });
  });

  it('clears one page and drops the book when nothing is left', () => {
    saveBookPage('book:r1', 0, 'a');
    saveBookPage('book:r1', 1, 'b');
    clearBookPage('book:r1', 0);
    expect(loadBookPages()).toEqual({ 'book:r1': { 1: { text: 'b' } } });
    clearBookPage('book:r1', 1);
    expect(loadBookPages()).toEqual({});
  });

  it('withPageText returns a new book with just that page changed', () => {
    const b = book();
    const next = withPageText(b, 0, 'zed');
    expect(next).not.toBe(b);
    expect(next.pages[0]!.text).toBe('zed');
    expect(b.pages[0]!.text).toBe('one');
  });
});
