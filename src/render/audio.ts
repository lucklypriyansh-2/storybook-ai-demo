/** One shared AudioContext, unlocked on the first user gesture (iOS Safari keeps contexts created outside a gesture suspended). */
let ac: AudioContext | null = null;
export function audioCtx(): AudioContext | null {
  if (ac) return ac;
  try { const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; ac = AC ? new AC() : null; } catch { ac = null; }
  return ac;
}
export function installAudioUnlock() {
  const unlock = () => { const c = audioCtx(); c?.resume().catch(() => {}); if (c?.state === 'running') { removeEventListener('pointerdown', unlock, true); removeEventListener('touchend', unlock, true); } };
  addEventListener('pointerdown', unlock, true); addEventListener('touchend', unlock, true);
}
