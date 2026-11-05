import { LocalApi } from '../data/local';
import type { DataApi } from '../data';
import { renderReel, canRender } from './renderReel';

/** v1 render worker: runs in the page, one job at a time (claims queued render_jobs from the local store). */
let running = false;
export async function pumpRenders(api: DataApi, onProgress?: (jobId: string, p: number) => void) {
  if (!(api instanceof LocalApi) || running) return;
  running = true;
  try {
    for (let j = await api.nextJob(); j; j = await api.nextJob()) {
      const { version, template, household } = await api.jobContext(j);
      if (!canRender()) { await api.markJob(j.id, 'failed', undefined, 'This browser cannot record video'); continue; }
      await api.markJob(j.id, 'rendering');
      try {
        const { blob } = await renderReel({ template, state: version.state, name: household.kid.display_name, look: household.character.look, base: import.meta.env.BASE_URL, onProgress: p => onProgress?.(j!.id, p) });
        if (!blob.size) throw new Error('empty recording');
        await api.markJob(j.id, 'done', blob);
      } catch (e) { await api.markJob(j.id, 'failed', undefined, String((e as Error)?.message ?? e)); }
    }
  } finally { running = false; }
}
