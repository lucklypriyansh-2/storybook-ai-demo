import { useState } from 'react';
import { Nibbs } from '../mascot';
import { useStore } from '../store';
import { Btn } from '../ui';

const PLANS = [
  { id: 'year', name: 'Nibbs Pass · yearly', sub: 'New reels daily, 10 remakes/mo, every digital book, 20% off print', price: '$59.99/yr', strike: '$95.88', tag: 'BEST VALUE · 7 DAYS FREE' },
  { id: 'month', name: 'Nibbs Pass · monthly', sub: 'Same as yearly, cancel any time', price: '$7.99/mo' },
  { id: 'book', name: 'Just one book', sub: 'This story as a digital book + its reels', price: '$9.99' },
  { id: 'free', name: 'Free plan', sub: '1 new reel a day · Shelf · sharing with family', price: 'stays free' },
];
/** MOCK paywall: no payment provider is wired; nothing is ever charged. */
export function Paywall() {
  const s = useStore();
  const [pick, setPick] = useState('year');
  const [done, setDone] = useState(false);
  const loved = s.reels.filter(r => r.loved).length;
  const head = s.arg === 'remakes' ? `${s.name} used all 10 remakes.` : s.arg === 'book' ? `Make ${s.name}'s book real?` : `${s.name} loved ${loved || 3} reel${(loved || 3) === 1 ? '' : 's'}.`;
  return <div className="body cream" data-testid="paywall">
    <div className="top"><button className="x" aria-label="Close" onClick={() => s.go('feed')}>✕</button><span className="spacer" /><span className="lock">Grown-ups only</span><span className="demo-tag">MOCK · NO PAYMENTS</span></div>
    <div className="row" style={{ alignItems: 'center', gap: 10 }}><Nibbs mood="idle" trigger="celebrate" width={86} /><h1 style={{ fontSize: 25, lineHeight: '30px' }}>{head} Keep the show going?</h1></div>
    <div className="plans">{PLANS.map(p => <button key={p.id} className={`card plan${pick === p.id ? ' sel' : ''}`} aria-pressed={pick === p.id} onClick={() => setPick(p.id)}>
      {p.tag && <span className="tag2">{p.tag}</span>}<div style={{ flex: 1 }}><b>{p.name}</b><div className="cap">{p.sub}</div></div>
      <div style={{ textAlign: 'right' }}><div className={p.id === 'free' ? 'cap' : 'price'}>{p.price}</div>{p.strike && <div className="strike">{p.strike}</div>}</div></button>)}</div>
    <div className="spacer" />
    {done ? <p className="okline" data-testid="paywall-mock">✓ Mock only: no card asked, nothing charged. Payments aren't built yet.</p>
      : <Btn onClick={() => s.askGate('Starting a plan', () => setDone(true))} data-testid="start-trial">{pick === 'free' ? 'Keep the free plan' : pick === 'book' ? 'Get this book' : 'Start 7 free days'}</Btn>}
    <p className="cap" style={{ textAlign: 'center', marginTop: 8 }}>Prices are proposals · India: ₹299/mo or ₹1,999/yr · this screen is a mock</p>
  </div>;
}
