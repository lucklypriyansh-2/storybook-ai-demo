import { avatarSvg, type Look } from '../mascot';
import { NIBBS_SVG } from '../nibbs-svg';
import { fill, sceneOf } from '../data/seed';
import { OUTFIT_COLOR, type ReelState, type Template } from '../data/types';

/** $0 in-browser renderer: canvas (scene art Ken Burns + trait avatar + co-star + burned-in captions) + WebAudio music,
 *  recorded with MediaRecorder. MP4/H.264 where supported (iPhone Safari), WebM otherwise. Nothing leaves the device. */
export const W = 540, H = 960, FPS = 30;
export function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return c.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? '';
}
export const canRender = () => typeof document !== 'undefined' && !!pickMime() && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + src)); i.src = src; });
const svgImg = (svg: string) => loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.includes('xmlns') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(' '); const lines: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines.slice(0, 4);
}
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

export interface RenderInput { template: Template; state: ReelState; name: string; look: Look; base: string; seconds?: number; onProgress?: (p: number) => void }
export async function renderReel({ template, state, name, look, base, seconds = 8, onProgress }: RenderInput): Promise<{ blob: Blob; mime: string }> {
  const mime = pickMime(); if (!mime) throw new Error('This browser cannot record video (MediaRecorder missing)');
  const scene = sceneOf(state.scene);
  const outfit = OUTFIT_COLOR[state.outfit] ?? look.outfit;
  const [bg, av, co] = await Promise.all([
    loadImg(`${base}images/${scene.image}`),
    svgImg(avatarSvg({ ...look, outfit }, state.outfit === 'cape')),
    state.co_star === 'nibbs' ? svgImg(NIBBS_SVG) : state.co_star === 'arjun' ? svgImg(avatarSvg({ skin: look.skin, hair: 'buzz', hairColor: '#2B1B14', outfit: '#1CB0F6', glasses: false, freckles: false })) : Promise.resolve(null),
  ]);
  try { await (document as Document & { fonts?: FontFaceSet }).fonts?.load('700 34px Andika'); } catch { /* font optional */ }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const lines = [fill(template.script[0], name, state), fill(state.text || template.script[1], name, state), fill(template.cliffhanger, name, state)];
  const title = fill(template.title, name, state);
  const zoomIn = template.sort % 2 === 1;

  const draw = (t: number) => { // t: seconds
    const p = t / seconds;
    const z = zoomIn ? 1.05 + 0.18 * p : 1.23 - 0.18 * p;
    const s = Math.max(W / bg.width, H / bg.height) * z; const bw = bg.width * s, bh = bg.height * s;
    ctx.drawImage(bg, (W - bw) / 2 + Math.sin(p * Math.PI) * 14, (H - bh) / 2, bw, bh);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(20,19,43,.5)'); g.addColorStop(.2, 'rgba(20,19,43,0)'); g.addColorStop(.55, 'rgba(20,19,43,0)'); g.addColorStop(1, 'rgba(20,19,43,.85)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // star + co-star bob in
    const inT = ease(Math.min(1, t / 0.9)); const bob = Math.sin(t * 3) * 6;
    const aw = 230, ah = aw * 210 / 200, ax = 40, ay = H - 300 - ah + (1 - inT) * 300 + bob;
    ctx.drawImage(av, ax, ay, aw, ah);
    if (state.outfit === 'astronaut') { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 6; ctx.fillStyle = 'rgba(200,230,255,.18)'; ctx.beginPath(); ctx.arc(ax + aw / 2, ay + ah * 0.47, aw * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    if (state.outfit === 'party') { ctx.fillStyle = '#FF6B57'; ctx.beginPath(); ctx.moveTo(ax + aw / 2 - 34, ay + 40); ctx.lineTo(ax + aw / 2 + 34, ay + 40); ctx.lineTo(ax + aw / 2, ay - 50); ctx.fill(); ctx.fillStyle = '#FFC800'; ctx.beginPath(); ctx.arc(ax + aw / 2, ay - 52, 10, 0, 7); ctx.fill(); }
    const cIn = ease(Math.min(1, Math.max(0, (t - 0.4) / 0.9)));
    const cx = W - 40 - 190 + (1 - cIn) * 260, cy = H - 300 - 200 - Math.sin(t * 3 + 1) * 8;
    if (co) ctx.drawImage(co, cx, cy, 190, 190 * 210 / 200);
    else { ctx.font = '150px serif'; ctx.textAlign = 'center'; ctx.fillText('🐶', cx + 95, cy + 170); }
    // title + badge
    ctx.textAlign = 'left';
    if (t < 1.6) { ctx.globalAlpha = Math.min(1, (1.6 - t) * 2); ctx.fillStyle = '#FFC800'; ctx.font = '900 20px Nunito, system-ui, sans-serif'; ctx.fillText(`STARRING ${name.toUpperCase()}`, 30, H * 0.17); ctx.fillStyle = '#fff'; ctx.font = '900 32px Nunito, system-ui, sans-serif'; ctx.fillText(title, 30, H * 0.17 + 40); ctx.globalAlpha = 1; }
    // captions: three beats, burned in, dark pill, key words in sun
    const beat = Math.min(2, Math.floor(p * 3)); const lp = (p * 3) % 1;
    const txt = beat === 2 ? 'To be continued… ' + lines[2] : lines[beat];
    ctx.font = '700 32px Andika, Nunito, sans-serif';
    const ls = wrap(ctx, txt, W - 100); const lh = 42, bh2 = ls.length * lh + 28, by = H * 0.26;
    ctx.globalAlpha = Math.min(1, lp * 6, (1 - lp) * 8 + (beat === 2 ? 1 : 0));
    ctx.fillStyle = 'rgba(20,19,43,.72)'; rr(ctx, 30, by, W - 60, bh2, 22); ctx.fill();
    ls.forEach((l, i) => { let x = 50; for (const w of l.split(' ')) { const key = /Nibbs|moon|star|whale|dino|wish|cloud|Bruno|Arjun|continued/i.test(w) || w.includes(name); ctx.fillStyle = key ? '#FFC800' : '#fff'; ctx.fillText(w, x, by + 46 + i * lh); x += ctx.measureText(w + ' ').width; } });
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(0, H - 8, W, 8); ctx.fillStyle = '#FFC800'; ctx.fillRect(0, H - 8, W * p, 8);
  };

  const stream = (cv as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(FPS);
  let ac: AudioContext | null = null;
  try { // CC0-by-construction music: a generated pentatonic lullaby, mixed into the recording
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ac = new AC(); await ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination(); const master = ac.createGain(); master.gain.value = 0.16; master.connect(dest);
    const notes = template.mode === 'bedtime' ? [392, 330, 294, 330, 262, 294, 330, 262] : [523, 587, 659, 784, 659, 587, 523, 659];
    const step = template.mode === 'bedtime' ? 0.75 : 0.5;
    for (let k = 0; k * step < seconds; k++) {
      const o = ac.createOscillator(), gn = ac.createGain(); o.type = 'triangle'; o.frequency.value = notes[k % notes.length];
      const at = ac.currentTime + 0.05 + k * step; gn.gain.setValueAtTime(0, at); gn.gain.linearRampToValueAtTime(1, at + 0.03); gn.gain.exponentialRampToValueAtTime(0.001, at + step * 0.95);
      o.connect(gn).connect(master); o.start(at); o.stop(at + step);
    }
    dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
  } catch { /* video without music */ }

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>(r => { rec.onstop = () => r(); });
  draw(0); rec.start(250);
  const t0 = performance.now();
  await new Promise<void>(res => {
    const tick = () => { const t = (performance.now() - t0) / 1000; draw(Math.min(t, seconds)); onProgress?.(Math.min(1, t / seconds)); if (t >= seconds) res(); else setTimeout(tick, 1000 / FPS); };
    tick();
  });
  rec.stop(); await done; stream.getTracks().forEach(t => t.stop()); ac?.close().catch(() => {});
  const type = mime.split(';')[0];
  return { blob: new Blob(chunks, { type }), mime: type };
}
