export type Theme = 'door' | 'whale' | 'market';
export type Pronoun = 'she' | 'he' | 'they';
export interface Hero { name: string; age: number; pronoun: Pronoun; outfit: string; sidekick: string; }
export interface Page { text: string; image: string; pos?: string }
export interface Story { id: Theme; title: string; pages: Page[]; dedication: string }

export const THEMES: { id: Theme; title: string; meta: string; image: string }[] = [
  { id: 'door', title: 'The Door in the Oak Tree', meta: 'Ages 3-6 · courage · 24 pages', image: 'spread-01-door.jpg' },
  { id: 'whale', title: 'Cloud Whale Morning', meta: 'Ages 2-5 · calm · 20 pages', image: 'spread-02-whale.jpg' },
  { id: 'market', title: 'Lantern Market Night', meta: 'Ages 4-8 · kindness · 24 pages', image: 'spread-03-market.jpg' },
];

const P = { she: ['she', 'her', 'her'], he: ['he', 'him', 'his'], they: ['they', 'them', 'their'] } as const;

export function cleanName(n: string) {
  const t = n.replace(/[^\p{L}\p{M}' -]/gu, '').trim().slice(0, 20);
  return t ? t[0].toUpperCase() + t.slice(1) : 'Mira';
}

const SIDE: Record<string, string> = { '🦊 Fox': 'Fox', '🐘 Elephant': 'Ellie the Elephant', '🐉 Dragon': 'Dot the Dragon' };

export function makeStory(theme: Theme, h: Hero, dedication = ''): Story {
  const n = cleanName(h.name);
  const [s, , pos] = P[h.pronoun];
  const S = s[0].toUpperCase() + s.slice(1);
  const pal = SIDE[h.sidekick] ?? h.sidekick.replace(/^\W+\s*/, '');
  const outfit = h.outfit.toLowerCase();
  const brave = h.age <= 4 ? 'little and brave' : `${h.age} years old and very brave`;
  const are = h.pronoun === 'they' ? 'were' : 'was';
  const T = THEMES.find(t => t.id === theme)!;
  const img = (i: string) => i;
  const books: Record<Theme, Page[]> = {
    door: [
      { text: `At the bottom of the old oak tree, ${n} found a door no bigger than a teacup.`, image: img('spread-01-door.jpg'), pos: '40% center' },
      { text: `${S} ${are} ${brave}, so ${s} knocked three times. Knock. Knock. Knock.`, image: img('spread-01-door.jpg'), pos: '70% center' },
      { text: `The door creaked open, and out peeked ${pal}. "We've been waiting for you, ${n}!"`, image: img('spread-03-market.jpg'), pos: '30% center' },
      { text: `${n} zipped up ${pos} ${outfit} and stepped into a world of glowing lanterns.`, image: img('spread-03-market.jpg'), pos: '70% center' },
      { text: `A cloud whale floated down. "Hold on tight!" it sang, and up they flew.`, image: img('spread-02-whale.jpg'), pos: '50% center' },
      { text: `Being brave, ${n} learned, means trying even when your tummy wobbles.`, image: img('spread-02-whale.jpg'), pos: '20% center' },
      { text: `And when the stars came out, ${n} and ${pal} dreamed of tomorrow's adventure.`, image: img('spread-04-bedtime.jpg'), pos: '50% center' },
      { text: `The End. ${n}, the door will always open for you.`, image: img('spread-04-bedtime.jpg'), pos: '80% center' },
    ],
    whale: [
      { text: `One sleepy morning, ${n} looked up and saw a whale made of clouds.`, image: img('spread-02-whale.jpg'), pos: '50% center' },
      { text: `"Hold on tight!" sang the cloud whale, and up they flew into the morning.`, image: img('spread-02-whale.jpg'), pos: '20% center' },
      { text: `${n} and ${pal} breathed in slowly, and the wind breathed out with them.`, image: img('spread-02-whale.jpg'), pos: '80% center' },
      { text: `Far below, an oak tree waved its leaves. "Hello, ${n}!"`, image: img('spread-01-door.jpg'), pos: '40% center' },
      { text: `In ${pos} ${outfit}, ${n} drifted past lanterns that hummed soft songs.`, image: img('spread-03-market.jpg'), pos: '50% center' },
      { text: `"When you feel big feelings," said the whale, "float like a cloud."`, image: img('spread-02-whale.jpg'), pos: '60% center' },
      { text: `Back in bed, ${n} smiled. Calm was something ${s} could carry everywhere.`, image: img('spread-04-bedtime.jpg'), pos: '50% center' },
      { text: `The End. Sweet dreams, ${n}.`, image: img('spread-04-bedtime.jpg'), pos: '80% center' },
    ],
    market: [
      { text: `When the lanterns lit up, ${n} and ${pal} tiptoed into the night market.`, image: img('spread-03-market.jpg'), pos: '50% center' },
      { text: `There were mangoes and kites and music, and one baby elephant who looked sad.`, image: img('spread-03-market.jpg'), pos: '80% center' },
      { text: `${n} shared ${pos} mangoes, and the baby elephant trumpeted a thank-you.`, image: img('spread-03-market.jpg'), pos: '30% center' },
      { text: `"Kindness grows," whispered ${pal}. "Look!" Every lantern glowed brighter.`, image: img('spread-01-door.jpg'), pos: '60% center' },
      { text: `A cloud whale came to see the light, and offered everyone a ride.`, image: img('spread-02-whale.jpg'), pos: '50% center' },
      { text: `${n}, ${brave}, held the smallest hand so nobody was left behind.`, image: img('spread-02-whale.jpg'), pos: '20% center' },
      { text: `And when the stars came out, ${n} and ${pal} dreamed of tomorrow's adventure.`, image: img('spread-04-bedtime.jpg'), pos: '50% center' },
      { text: `The End. Thank you for being kind, ${n}.`, image: img('spread-04-bedtime.jpg'), pos: '80% center' },
    ],
  };
  return { id: theme, title: theme === 'door' ? T.title : `${n}'s ${T.title}`, pages: books[theme], dedication };
}

export const FORMATS = [
  { id: 'soft', name: 'Softcover', meta: '8.5" square · 24 pages', price: 29.99 },
  { id: 'hard', name: 'Hardcover ⭐ most gifted', meta: 'Lay-flat · gift box', price: 39.99 },
] as const;
export const SHIPPING = 6.99;
export const orderTotal = (price: number) => Math.round((price + SHIPPING) * 100) / 100;
