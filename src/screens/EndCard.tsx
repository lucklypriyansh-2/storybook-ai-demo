import { motion } from 'framer-motion';
import { img } from '../motion';
import { useStore } from '../store';
import { Btn } from '../ui';
import { fill } from '../data/seed';
import type { Reel } from '../data';

export function EndCard({ reel, onClose, onNext }: { reel: Reel; onClose: () => void; onNext: () => void }) {
  const s = useStore();
  const t = s.tpl(reel.template_id);
  const b = s.books.find(b => b.reel_id === reel.id);
  return <motion.div className="endcard" data-testid="endcard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
    <div className="eyebrow2">TO BE CONTINUED…</div>
    <h1>{fill(t.cliffhanger, s.name, reel.state)}</h1>
    <motion.div className="cover3d" style={{ backgroundImage: `url(${img(t.cover)})` }} initial={{ rotateY: 30, y: 30, opacity: 0 }} animate={{ rotateY: -14, y: 0, opacity: 1 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
    <b className="bt">{b?.title ?? 'This story'}</b>
    <span className="bs" data-testid="endcard-pages">{b && b.pages.length > 0 ? `The full story · ${b.pages.length} pages · read-along with Nibbs` : 'The full story · read-along with Nibbs'}</span>
    <div className="spacer" />
    <Btn kind="sun" disabled={!b} onClick={() => b && s.go('book', b.id)}>Read the whole story</Btn>
    <Btn kind="outline-dk" style={{ marginTop: 12 }} disabled={!b} onClick={() => b && s.askGate('Buying a printed book', () => s.go('paywall', 'book'))}>Get it as a real book 🔒</Btn>
    <p className="nx"><button className="linkish dk" onClick={onNext}>Next reel</button> · <button className="linkish dk" onClick={onClose}>Stay here</button></p>
  </motion.div>;
}
