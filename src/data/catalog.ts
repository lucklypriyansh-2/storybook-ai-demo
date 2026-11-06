import { TEMPLATES } from './seed';
import type { CatalogTemplate, Template } from './types';

/**
 * Client-side mirror of the PLACEHOLDER catalog templates seeded by
 * worker/migrations/0007_catalog.sql. The Worker owns the catalog; this local
 * copy exists so books(), titles and per-page text work offline and before the
 * server detail is fetched. Every string is sample content owned by this product.
 */
const PLACEHOLDER_STATE = { scene: '', outfit: '', co_star: 'nibbs', text: '' } as const;

export const CATALOG_SEED: Template[] = [
  {
    id: 'tpl_lighthouse_mouse',
    title: '{name} and the Lighthouse Mouse',
    mode: 'day', duration_s: 8, cover: 'reel-ocean.jpg', video: '',
    book_title: '{name} and the Lighthouse Mouse',
    cliffhanger: 'Will the little lamp stay lit until morning?',
    script: [
      '{name} meets a tiny mouse by the harbour wall.',
      'The lighthouse lamp flickers and the fog rolls in.',
      'The mouse climbs the winding stairs with a match.',
      '{name} lifts the mouse up to the great lamp.',
      'The lamp blazes and the little boats find their way home.',
      '{name} and the mouse wave goodnight from the tower.',
    ],
    default_state: { ...PLACEHOLDER_STATE }, sort: 90,
  },
  {
    id: 'tpl_pebble_pyjamas',
    title: "{name}'s Pebble Pyjama Party",
    mode: 'bedtime', duration_s: 8, cover: 'reel-birthday.jpg', video: '',
    book_title: "{name}'s Pebble Pyjama Party",
    cliffhanger: 'Who will fall asleep first?',
    script: [
      '{name} finds a smooth pebble that says hello.',
      'Pebble invites every stone to a pyjama party.',
      'They roll down the hill and land in a pillow pile.',
      '{name} reads the sleepiest goodnight story.',
      'Everyone snores gently as the moon rises.',
    ],
    default_state: { ...PLACEHOLDER_STATE }, sort: 91,
  },
  {
    id: 'tpl_cloud_whale',
    title: '{name} and the Cloud Whale',
    mode: 'bedtime', duration_s: 8, cover: 'spread-02-whale.jpg', video: '',
    book_title: '{name} and the Cloud Whale',
    cliffhanger: 'Where will the cloud whale swim next?',
    script: [
      '{name} spots a whale swimming through the clouds.',
      'The whale lowers a rope of mist for a ride.',
      'They sail over rooftops where the lamps are being lit.',
      'The whale hums a low song only children can hear.',
      'A sleepy star climbs aboard and curls up tight.',
      'The whale sets {name} down, right onto the pillow.',
    ],
    default_state: { ...PLACEHOLDER_STATE }, sort: 92,
  },
];

/** Seed templates plus the placeholder catalog, de-duplicated by id. */
export function allTemplates(): Template[] {
  const seen = new Set<string>();
  const out: Template[] = [];
  for (const t of [...TEMPLATES, ...CATALOG_SEED]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export function templateById(id: string): Template | undefined {
  return allTemplates().find(t => t.id === id);
}

/**
 * Builds a book Template from a catalog row. Known placeholder ids get their
 * authored script; an admin-added template gets a generic, clearly-labelled
 * page script so it still renders a book rather than failing.
 */
export function templateFromCatalog(row: CatalogTemplate): Template {
  const known = CATALOG_SEED.find(t => t.id === row.id);
  if (known) return { ...known, title: row.title, cover: row.cover ?? known.cover };

  const pages = Math.max(1, Math.min(8, row.page_count || 6));
  return {
    id: row.id,
    title: row.title,
    mode: 'day',
    duration_s: 8,
    cover: row.cover ?? 'cover.jpg',
    video: '',
    book_title: row.title,
    cliffhanger: 'What happens next?',
    script: Array.from({ length: pages }, (_, i) => `${row.title} — page ${i + 1}`),
    default_state: { ...PLACEHOLDER_STATE },
    sort: 100,
  };
}
