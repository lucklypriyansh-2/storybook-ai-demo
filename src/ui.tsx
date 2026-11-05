import { motion } from 'framer-motion';
import type { ReactNode, CSSProperties, ButtonHTMLAttributes } from 'react';
import { D, E } from './motion';

export function Btn({ kind = 'primary', children, style, className = '', ...p }: { kind?: string; children: ReactNode; style?: CSSProperties; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <motion.button className={`btn ${kind} ${className}`} style={style} whileTap={{ y: 4, boxShadow: '0 0 0 rgba(0,0,0,0)' }} transition={{ duration: 0.1 }} {...(p as object)}>{children}</motion.button>;
}
export function Chip({ on, children, onClick, label }: { on?: boolean; children: ReactNode; onClick?: () => void; label?: string }) {
  return <motion.button type="button" className={`chip${on ? ' on' : ''}`} onClick={onClick} aria-label={label} whileTap={{ y: 3, boxShadow: '0 0 0 rgba(0,0,0,0)' }} transition={{ duration: 0.1 }} aria-pressed={!!on}>{children}</motion.button>;
}
export function Toggle({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => set(!on)} className="tg" style={{ background: on ? 'var(--teal)' : 'var(--line)', opacity: disabled ? 0.5 : 1 }}>
    <motion.span layout transition={{ duration: D.fast, ease: E.bounce }} style={{ marginLeft: on ? 23 : 3 }} /></button>;
}
export const ICON = {
  heart: <svg viewBox="0 0 24 24" fill="#fff"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.5 1.2 4.3 2.4.8-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" /></svg>,
  save: (on: boolean) => <svg viewBox="0 0 24 24" fill={on ? '#fff' : 'none'} stroke="#fff" strokeWidth="2.6" strokeLinejoin="round"><path d="M6 3.5h12v17l-6-4.2-6 4.2z" /></svg>,
  remake: <svg viewBox="0 0 24 24" fill="none" stroke="#1D1B3A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" /></svg>,
  book: <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round"><path d="M3 5.5c3-1 6-1 9 1v13c-3-2-6-2-9-1zM21 5.5c-3-1-6-1-9 1v13c3-2 6-2 9-1z" /></svg>,
  family: <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"><path d="M3 11 12 4l9 7v9H3z" /><path d="M12 17.5s-3.2-1.9-3.2-4c0-1 .8-1.8 1.7-1.8.7 0 1.2.4 1.5.9.3-.5.8-.9 1.5-.9.9 0 1.7.8 1.7 1.8 0 2.1-3.2 4-3.2 4z" fill="#fff" stroke="none" /></svg>,
};
export function Sheet({ children, onClose, label, dark }: { children: ReactNode; onClose: () => void; label: string; dark?: boolean }) {
  return <motion.div className="scrim2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
    <motion.div className={`sheet2${dark ? ' dark' : ''}`} role="dialog" aria-label={label} onClick={e => e.stopPropagation()}
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%', transition: { duration: D.base, ease: E.exit } }} transition={{ duration: D.slow, ease: E.enter }}
      drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.8 }} dragListener={false}>
      <button className="grab2" aria-label="Close sheet" onClick={onClose} />{children}</motion.div></motion.div>;
}
