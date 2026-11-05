import { LocalApi } from '../data/local';
import type { DataApi } from '../data';
import { renderReel, canRender } from './renderReel';

/** Can this browser actually play the recorded file back from a blob: URL? (iOS fMP4 quirk guard) */
export function playable(blob: Blob, ms = 4000): Promise<boolean> {
  return new Promise(res => {
    const v = document.createElement('video'); const u = URL.createObjectURL(blob);
    const end = (ok: boolean) => { clearTimeout(t); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(u); res(ok); };
    const t = setTimeout(() => end(false), ms);
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadeddata = () => end(true); v.onerror = () => end(false);
    v.src = u;
  });
}
/** v1 render worker: runs in the page, one job at a time (claims queued render_jobs from the local store). */
let running = false;
export async function pumpRenders(api: DataApi, onProgress?: (jobId: string, p: number) => void) {
  if (!(api instanceof LocalApi) || running) return;
  running = true;
  try {
    for (let j = await api.nextJob(); j; j = await api.nextJob()) {
      const job = j;
      const { version, template, household } = await api.jobContext(job);
      if (!canRender()) { await api.markJob(job.id, 'failed', undefined, 'This browser cannot record video'); continue; }
      await api.markJob(job.id, 'rendering');
      try {
        const input = { template, state: version.state, name: household.kid.display_name, look: household.character.look, base: import.meta.env.BASE_URL, onProgress: (p: number) => onProgress?.(job.id, p) };
        let out = await renderReel(input);
        if (!out.blob.size || !(await playable(out.blob))) {
          const other = out.mime.includes('mp4') ? 'video/mp4' : 'video/webm';
          out = await renderReel({ ...input, avoid: [other] });
          if (!out.blob.size || !(await playable(out.blob))) throw new Error('recorded video does not play on this browser');
        }
        await api.markJob(job.id, 'done', out.blob);
      } catch (e) { await api.markJob(job.id, 'failed', undefined, String((e as Error)?.message ?? e)); }
    }
  } finally { running = false; }
}
