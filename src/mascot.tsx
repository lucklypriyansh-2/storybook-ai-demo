import { useEffect, useState, type CSSProperties } from 'react';
import { NIBBS_SVG } from './nibbs-svg';
import './nibbs.css';
export type Mood = 'idle' | 'wave' | 'celebrate' | 'thinking' | 'talking' | 'sad';
/** Nibbs: SVG + CSS state machine (fallback for the Rive file, same state names).
 *  `mood` is the persistent pose; `trigger` plays a one-shot (wave 1.2s, celebrate 2×1s, error→sad 1.8s) then returns to mood. */
export function Nibbs({ mood = 'idle', trigger, width = 80, style, className = '' }: { mood?: Mood; trigger?: 'wave' | 'celebrate' | 'error'; width?: number; style?: CSSProperties; className?: string }) {
  const [shot, setShot] = useState<Mood | null>(trigger ? (trigger === 'error' ? 'sad' : trigger) : null);
  useEffect(() => {
    if (!trigger) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShot(null); return; }
    setShot(trigger === 'error' ? 'sad' : trigger);
    const t = setTimeout(() => setShot(null), trigger === 'wave' ? 2400 : trigger === 'celebrate' ? 2000 : 1800);
    return () => clearTimeout(t);
  }, [trigger]);
  const st = shot ?? mood;
  return <div className={`nibbs st-${st} ${className}`} data-nibbs={st} role="img" aria-label={`Nibbs the dragon, ${st}`} style={{ width, ...style }} dangerouslySetInnerHTML={{ __html: NIBBS_SVG }} />;
}

export interface Look { skin: string; hair: 'curly' | 'bob' | 'buzz' | 'puffs' | 'braids'; hairColor: string; outfit: string; glasses: boolean; freckles: boolean }
export const DEFAULT_LOOK: Look = { skin: '#B9764F', hair: 'curly', hairColor: '#2B1B14', outfit: '#FFC800', glasses: false, freckles: false };
export const SKINS = ['#F2C7A5', '#D9A07A', '#B9764F', '#8A5636', '#5E3A24'];
export const HAIRS: Look['hair'][] = ['curly', 'bob', 'buzz', 'puffs', 'braids'];
const H: Record<Look['hair'], (c: string) => string> = {
  curly: c => `<g fill="${c}">${[[60, 52, 22], [85, 38, 24], [115, 38, 24], [140, 52, 22], [100, 32, 22], [46, 78, 15], [154, 78, 15]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`,
  bob: c => `<path d="M44 90 q0 -62 56 -62 q56 0 56 62 v34 h-22 v-50 h-68 v50 h-22z" fill="${c}"/>`,
  buzz: c => `<path d="M52 72 q4 -40 48 -40 q44 0 48 40 q-48 -18 -96 0z" fill="${c}"/>`,
  puffs: c => `<circle cx="52" cy="44" r="24" fill="${c}"/><circle cx="148" cy="44" r="24" fill="${c}"/><path d="M54 76 q4 -40 46 -40 q42 0 46 40 q-46 -14 -92 0z" fill="${c}"/>`,
  braids: c => `<path d="M50 80 q2 -48 50 -48 q48 0 50 48 q-50 -22 -100 0z" fill="${c}"/>${[0, 1, 2, 3].map(i => `<circle cx="46" cy="${100 + i * 16}" r="9" fill="${c}"/><circle cx="154" cy="${100 + i * 16}" r="9" fill="${c}"/>`).join('')}`,
};
export function avatarSvg(t: Partial<Look>, cape = false) {
  const a = { ...DEFAULT_LOOK, ...t };
  return `<svg viewBox="0 0 200 210" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
${cape ? `<path d="M30 210 q10 -70 70 -64 q60 -6 70 64z" fill="#FF6B57"/>` : ''}
<path d="M40 210 q0 -52 60 -52 q60 0 60 52z" fill="${a.outfit}"/><path d="M82 160 l18 14 l18 -14z" fill="#fff" opacity=".9"/>
<rect x="88" y="138" width="24" height="26" fill="${a.skin}"/>
<circle cx="50" cy="104" r="11" fill="${a.skin}"/><circle cx="150" cy="104" r="11" fill="${a.skin}"/>
<rect x="52" y="48" width="96" height="104" rx="46" fill="${a.skin}"/>
${H[a.hair](a.hairColor)}
<g class="av-eyes"><circle cx="80" cy="102" r="12" fill="#fff"/><circle cx="120" cy="102" r="12" fill="#fff"/><circle cx="81" cy="104" r="7.5" fill="#1D1B3A"/><circle cx="121" cy="104" r="7.5" fill="#1D1B3A"/><circle cx="84" cy="100" r="2.6" fill="#fff"/><circle cx="124" cy="100" r="2.6" fill="#fff"/></g>
${a.glasses ? `<g fill="none" stroke="#3B3A9E" stroke-width="5"><circle cx="80" cy="102" r="17"/><circle cx="120" cy="102" r="17"/><path d="M97 102 h6"/></g>` : ''}
${a.freckles ? `<g fill="#8A4B2E" opacity=".6"><circle cx="70" cy="122" r="2"/><circle cx="77" cy="126" r="2"/><circle cx="123" cy="126" r="2"/><circle cx="130" cy="122" r="2"/></g>` : ''}
<circle cx="68" cy="124" r="7" fill="#FF6B57" opacity=".35"/><circle cx="132" cy="124" r="7" fill="#FF6B57" opacity=".35"/>
<path d="M96 112 q4 6 8 0" stroke="#1D1B3A" stroke-opacity=".35" stroke-width="4" fill="none" stroke-linecap="round"/>
<path d="M88 128 q12 12 24 0z" fill="#1D1B3A"/><path d="M93 133 q7 4 14 0 q-7 -3 -14 0z" fill="#FF6B7A"/></svg>`;
}
export function Avatar({ look, cape, width, style, label }: { look: Partial<Look>; cape?: boolean; width: number; style?: CSSProperties; label?: string }) {
  return <div role="img" aria-label={label ?? 'Child avatar'} style={{ width, aspectRatio: '200/210', ...style }} dangerouslySetInnerHTML={{ __html: avatarSvg(look, cape) }} />;
}
