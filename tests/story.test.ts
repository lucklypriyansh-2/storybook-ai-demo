import { describe, it, expect } from 'vitest';
import { makeStory, cleanName, orderTotal, THEMES } from '../src/story';
const hero = { name: 'aarav', age: 5, pronoun: 'he' as const, outfit: 'Explorer', sidekick: '🐉 Dragon' };
describe('seeded story', () => {
  it('substitutes the name, pronoun, outfit and sidekick', () => {
    const s = makeStory('door', hero);
    const all = s.pages.map(p => p.text).join(' ');
    expect(all).toContain('Aarav');
    expect(all).not.toContain('Mira');
    expect(all).toContain('his explorer');
    expect(all).toContain('Dot the Dragon');
    expect(all).toContain('5 years old');
  });
  it('every theme has 8 pages with images', () => {
    for (const t of THEMES) { const s = makeStory(t.id, hero); expect(s.pages).toHaveLength(8); s.pages.forEach(p => expect(p.image).toMatch(/\.jpg$/)); }
  });
  it('sanitises names and falls back to Mira', () => {
    expect(cleanName('  <script>zoe')).toBe('Scriptzoe');
    expect(cleanName('***')).toBe('Mira');
    expect(cleanName('a'.repeat(40))).toHaveLength(20);
  });
  it('they/them reads naturally', () => {
    const all = makeStory('door', { ...hero, pronoun: 'they' }).pages.map(p => p.text).join(' ');
    expect(all).toContain('They were');
  });
  it('totals match the design ($39.99 + $6.99 = $46.98)', () => { expect(orderTotal(39.99)).toBe(46.98); });
});
