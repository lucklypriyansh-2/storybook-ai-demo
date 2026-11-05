import { motion } from 'framer-motion';
import { useMemo, useRef, useState } from 'react';
import { Nibbs } from '../mascot';
import { useStore } from '../store';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export const HOLD_MS = 600;
/** Parent gate: press-and-hold three numbers shown as words (Apple Kids 1.3 style). Unlocks for 5 minutes. */
export function ParentGate() {
  const s = useStore();
  const code = useMemo(() => { const a: number[] = []; while (a.length < 3) { const n = 1 + Math.floor(Math.random() * 9); if (!a.includes(n)) a.push(n); } return a; }, [s.gate]);
  const [step, setStep] = useState(0);
  const [holding, setHolding] = useState<number | null>(null);
  const [shake, setShake] = useState(0);
  const tm = useRef<ReturnType<typeof setTimeout>>(undefined);
  if (!s.gate) return null;
  const down = (n: number) => { setHolding(n); clearTimeout(tm.current); tm.current = setTimeout(() => { setHolding(null); if (n === code[step]) { if (step === 2) { setStep(0); s.closeGate(true); } else setStep(step + 1); } else { setStep(0); setShake(x => x + 1); } }, HOLD_MS); };
  const up = () => { clearTimeout(tm.current); setHolding(null); };
  return <motion.div className="gate" role="dialog" aria-label="Parent gate" data-testid="gate" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="top"><button className="x" aria-label="Close" onClick={() => s.closeGate(false)}>✕</button><span className="cap">{s.gate.why}</span></div>
    <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}><Nibbs mood="idle" width={84} /><div className="bubble" style={{ marginTop: 12, flex: 1 }}>Grown-up time! Ask a parent to help with this part. 🛡️</div></div>
    <h1 style={{ marginTop: 18 }}>Are you a grown-up?</h1><p className="lead">Press and hold the numbers in order:</p>
    <div className="gatewords" data-testid="gate-words" data-code={code.join('')}>{code.map((n, i) => <span key={i} className={i < step ? 'ok' : ''}>{WORDS[n]}</span>).reduce((a: React.ReactNode[], x, i) => (i ? [...a, ' · ', x] : [x]), [])}</div>
    <motion.div className="keypad" animate={shake ? { x: [0, -12, 12, -8, 8, 0] } : {}} key={shake} transition={{ duration: 0.4 }}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <button key={n} className={`card key${holding === n ? ' sel' : ''}`} aria-label={`Number ${n}`}
        onPointerDown={e => { e.preventDefault(); down(n); }} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} onContextMenu={e => e.preventDefault()}>
        {n}{holding === n && <motion.i className="hold" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: HOLD_MS / 1000, ease: 'linear' }} />}</button>)}
    </motion.div>
    <p className="cap" style={{ textAlign: 'center', marginTop: 14 }}>Words, not digits, so early readers can't guess it.</p>
    <div className="spacer" /><p className="cap" style={{ textAlign: 'center' }}>Protects: sharing, publishing, purchases, settings and links out of the app</p>
  </motion.div>;
}
