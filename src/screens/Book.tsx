import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Nibbs } from '../mascot';
import { D, E, img } from '../motion';
import { useStore } from '../store';
import { Btn } from '../ui';
import type { DataApi } from '../data';

/** Narrow Worker-only surface for saving per-page text (R.5.3). */
type PageApi = DataApi & {
  saveBookPageText?: (reelId: string, bookId: string, index: number, text: string) => Promise<{ saved: boolean; server: boolean }>;
  resetBookPage?: (reelId: string, bookId: string, index: number) => Promise<{ ok: boolean }>;
};

function speak(text: string, onword: (i: number) => void, onend: () => void) {
  const ss = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!ss) { setTimeout(onend, 2000); return; }
  ss.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 0.95; u.pitch = 1.1;
  u.onend = onend; u.onboundary = e => onword(text.slice(0, e.charIndex).split(/\s+/).filter(Boolean).length); ss.speak(u);
}
/** Book reader (second layer): page-turn, read-along highlight with the device voice (live, not recorded). */
export function BookReader() {
  const s = useStore();
  const book = s.books.find(b => b.id === s.arg) ?? s.books[0];
  const [i, setI] = useState(0);
  const [turn, setTurn] = useState<0 | 1 | -1>(0);
  const [word, setWord] = useState(-1);
  const [reading, setReading] = useState(false);
  const rm = useReducedMotion();
  // R.5 M-21 per-page editor state.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const api = s.api as PageApi;
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);
  if (!book) return <div className="body"><h1>No book yet</h1></div>;
  const N = book.pages.length;
  // The editor needs a place to persist: only the Worker exposes the page routes.
  const canEdit = !!book.reel_id && !!api.saveBookPageText;
  const openEditor = () => { window.speechSynthesis?.cancel(); setReading(false); setWord(-1); setDraft(book.pages[i].text); setEditing(true); };
  const savePage = async () => {
    const text = draft.trim();
    if (!text || !book.reel_id) return;
    setSaving(true);
    try {
      if (api.saveBookPageText) await api.saveBookPageText(book.reel_id, book.id, i, text);
      await s.refresh();
      s.toast('✓ Page saved');
      setEditing(false);
    } finally { setSaving(false); }
  };
  const resetPage = async () => {
    if (!book.reel_id) return;
    setSaving(true);
    try {
      if (api.resetBookPage) await api.resetBookPage(book.reel_id, book.id, i);
      await s.refresh();
      // The refreshed book carries the template text again; reopening shows it.
      s.toast('↺ Back to the template text');
      setEditing(false);
    } finally { setSaving(false); }
  };
  const flip = (d: 1 | -1) => { if (turn || i + d < 0 || i + d >= N) return; window.speechSynthesis?.cancel(); setReading(false); setWord(-1); setTurn(d); };
  const finish = () => { setI(x => x + turn); setTurn(0); };
  const read = () => { if (reading) { window.speechSynthesis?.cancel(); setReading(false); setWord(-1); return; } setReading(true); speak(book.pages[i].text, setWord, () => { setReading(false); setWord(-1); }); };
  const Pg = ({ k }: { k: number }) => { const p = book.pages[k]; const words = p.text.split(' ');
    return <div className="pg"><div className="img" role="img" aria-label={`Illustration for page ${k + 1}`} style={{ flex: 1, borderRadius: 0, backgroundImage: `url(${img(p.image)})`, backgroundPosition: `${(k * 23) % 100}% center` }} />
      <div className="story-text" data-testid="page-text">{words.map((w, j) => <span key={j}>{(word >= 0 ? j === word : w.replace(/\W/g, '') === s.name) ? <mark>{w}</mark> : w}{' '}</span>)}</div></div>; };
  const next = turn === 1 ? i + 1 : turn === -1 ? i - 1 : i;
  return <div className="body" data-testid="book">
    <div className="top"><button className="x" aria-label="Close book" onClick={() => s.go('feed')}>✕</button>
      <div className="progress"><motion.i initial={false} animate={{ width: `${((i + 1) / N) * 100}%` }} style={{ background: 'var(--sky)' }} /></div>
      <span style={{ fontWeight: 900, color: 'var(--muted)' }} data-testid="page-no">{i + 1}/{N}</span></div>
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <h2 style={{ marginBottom: 8, flex: 1 }} data-testid="book-title">{book.title}</h2>
      {canEdit && !editing && <button className="linkish" style={{ margin: 0, flexShrink: 0 }} onClick={openEditor} data-testid="edit-page">✏️ Edit this page</button>}
    </div>
    <div className="book-wrap" onClick={e => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; if (x > 0.8) flip(1); else if (x < 0.2) flip(-1); }}>
      <motion.div className="bookpg under" drag={turn ? false : 'x'} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.3} onDragEnd={(_, inf) => { if (inf.offset.x < -80) flip(1); else if (inf.offset.x > 80) flip(-1); }}><Pg k={turn === 1 ? next : i} /></motion.div>
      {turn !== 0 && (rm
        ? <motion.div className="bookpg" initial={{ opacity: turn === 1 ? 1 : 0 }} animate={{ opacity: turn === 1 ? 0 : 1 }} transition={{ duration: 0.2 }} onAnimationComplete={finish}><Pg k={turn === 1 ? i : next} /></motion.div>
        : <motion.div className="bookpg turning" style={{ transformOrigin: 'left center' }} initial={{ rotateY: turn === 1 ? 0 : -180 }} animate={{ rotateY: turn === 1 ? -180 : 0 }} transition={{ duration: D.page, ease: E.page }} onAnimationComplete={finish}>
          <Pg k={turn === 1 ? i : next} /><motion.div className="shade" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: D.page, times: [0, 0.45, 1] }} /></motion.div>)}
    </div>
    <div className="row" style={{ marginTop: 14 }}><Nibbs mood={reading ? 'talking' : 'idle'} width={64} />
      <Btn kind="ghost" style={{ height: 50 }} onClick={read} aria-label="Read aloud">{reading ? '⏸ Stop' : '🔊 Read to me'}</Btn>
      {i < N - 1 ? <Btn kind="sun" style={{ height: 50, width: 110, flexShrink: 0 }} onClick={() => flip(1)} aria-label="Next page">Next ▶</Btn>
        : <Btn kind="sun" style={{ height: 50, width: 110, flexShrink: 0 }} onClick={() => s.askGate('Buying a printed book', () => s.go('paywall', 'book'))}>Print 📕</Btn>}</div>
    <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}><button className="cap linkish" style={{ margin: 0 }} onClick={() => flip(-1)} disabled={i === 0} aria-label="Previous page">◀ Back</button><span className="cap">Voice: this device (live)</span></div>

    {editing && <div className="card" style={{ marginTop: 12 }} data-testid="page-editor">
      <b>Edit page {i + 1}</b>
      <div className="img" role="img" aria-label={`Illustration for page ${i + 1}`} style={{ height: 90, borderRadius: 12, marginTop: 8, backgroundImage: `url(${img(book.pages[i].image)})`, backgroundSize: 'cover', backgroundPosition: `${(i * 23) % 100}% center` }} />
      <textarea className="card field" aria-label="Page text" data-testid="page-textarea" value={draft} maxLength={400} rows={3}
        style={{ marginTop: 8, minHeight: 84, resize: 'vertical' }}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void savePage(); } }} />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <Btn disabled={saving || !draft.trim()} onClick={savePage} data-testid="save-page">{saving ? 'Saving…' : 'Save'}</Btn>
        <Btn kind="ghost" disabled={saving} onClick={resetPage} data-testid="reset-page">Reset to template</Btn>
        <Btn kind="ghost" disabled={saving} onClick={() => setEditing(false)} data-testid="cancel-edit">Cancel</Btn>
      </div>
      <p className="cap" style={{ textAlign: 'left' }}>Save keeps the drawing and changes only the words. ⌘/Ctrl + Enter to save.</p>
    </div>}
  </div>;
}
