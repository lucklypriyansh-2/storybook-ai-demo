import raw from './templates.json';
import { SCENES, COSTARS, type ReelState, type Template, type BookPage } from './types';
export const TEMPLATES = raw as Template[];
export const DEFAULT_KID = 'Mira';
export const costarName = (id: string) => (COSTARS.find(c => c[0] === id)?.[1] ?? '🐉 Nibbs').replace(/^\S+\s/, '').replace(/ \(.*\)$/, '');
export const sceneOf = (id: string) => SCENES.find(s => s.id === id) ?? SCENES[0];
export function fill(text: string, name: string, state?: Partial<ReelState>) {
  return text.replace(/\{name\}/g, name).replace(/\{costar\}/g, costarName(state?.co_star ?? 'nibbs'));
}
/** Book pages derived from a template script + the reel's current state (same rule as SQL bootstrap). */
export function bookPages(t: Template, name: string, state: ReelState): BookPage[] {
  const img = sceneOf(state.scene).image;
  return t.script.map(line => ({ text: fill(line, name, state), image: img }));
}
/** Canonical JSON (sorted keys) so the hash matches Postgres jsonb::text ordering for flat objects. */
export function canonical(o: Record<string, unknown>) {
  return '{' + Object.keys(o).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(k => `${JSON.stringify(k)}: ${JSON.stringify(o[k])}`).join(', ') + '}';
}
export async function stateHash(s: ReelState) {
  const data = new TextEncoder().encode(canonical(s as unknown as Record<string, unknown>));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
