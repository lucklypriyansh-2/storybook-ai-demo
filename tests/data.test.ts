import { describe, it, expect, beforeEach } from 'vitest';
import { LocalApi } from '../src/data/local';
import { kv } from '../src/data/idb';
import { canonical, stateHash, TEMPLATES } from '../src/data/seed';
import { remakesLeft } from '../src/screens/Remake';

beforeEach(async () => { await kv.clear(); });
describe('local data layer (IndexedDB-backed, mirrors SQL RPCs)', () => {
  it('bootstrap seeds a household with one reel + book per template, consents default AI training OFF', async () => {
    const a = new LocalApi(); const h = await a.init();
    expect(h.kid.display_name).toBe('Mira');
    expect((await a.reels()).length).toBe(TEMPLATES.length);
    expect((await a.books()).length).toBe(TEMPLATES.length);
    const c = Object.fromEntries((await a.consents()).map(x => [x.kind, x.granted]));
    expect(c).toEqual({ create: true, family_share: false, ai_training: false, marketing: false, publish_social: false });
  });
  it('remake writes a new version + queued render job and resets video', async () => {
    const a = new LocalApi(); await a.init(); const [r] = await a.reels();
    const res = await a.remake(r.id, { scene: 'ocean', outfit: 'cape', co_star: 'bruno', text: 'Hi {name}' });
    expect(res.version).toBe(2);
    const r2 = (await a.reels()).find(x => x.id === r.id)!;
    expect(r2.status).toBe('queued'); expect(r2.video_url).toBeNull(); expect(r2.state.scene).toBe('ocean');
    const vs = await a.reelVersions(r.id); expect(vs.map(v => v.version)).toEqual([1, 2]); expect(vs[0].state_hash).not.toBe(vs[1].state_hash);
    const jobs = await a.jobs(); expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ reel_id: r.id, status: 'queued', reel_version_id: vs[1].id });
    expect(remakesLeft(await a.reels())).toBe(9);
  });
  it('remake rejects unknown keys, long text, and missing consent', async () => {
    const a = new LocalApi(); await a.init(); const [r] = await a.reels();
    await expect(a.remake(r.id, { scene: 'moon', outfit: 'x', co_star: 'nibbs', text: 'a', prompt: 'evil' } as never)).rejects.toThrow(/invalid state key/);
    await expect(a.remake(r.id, { scene: 'moon', outfit: 'x', co_star: 'nibbs', text: 'a'.repeat(121) })).rejects.toThrow(/too long/);
    await a.setConsent('create', false);
    await expect(a.remake(r.id, { scene: 'moon', outfit: 'x', co_star: 'nibbs', text: 'a' })).rejects.toThrow(/consent/);
  });
  it('render worker marks the job done and stores the video blob', async () => {
    const a = new LocalApi(); await a.init(); const { reel_id, job_id } = await a.createReel('ocean');
    expect((await a.nextJob())!.id).toBe(job_id);
    await a.markJob(job_id, 'rendering'); await a.markJob(job_id, 'done', new Blob(['x'.repeat(10)], { type: 'video/mp4' }));
    const r = (await a.reels()).find(x => x.id === reel_id)!; expect(r.status).toBe('ready'); expect(r.video_url).toBe('idb:' + job_id);
    expect((await a.videoBlob(r.video_url!))!.size).toBe(10);
  });
  it('publish only ever creates a draft; cancel works; nothing else', async () => {
    const a = new LocalApi(); await a.init(); const [r] = await a.reels();
    const p = await a.queuePublish(r.id, 'cap'); expect(p.status).toBe('draft'); expect(p.platform).toBe('instagram');
    await a.cancelPublish(p.id); expect((await a.publishQueue())[0].status).toBe('cancelled');
  });
  it('consent choices persist across app restarts', async () => {
    const a = new LocalApi(); await a.init(); await a.setConsent('marketing', true);
    const b = new LocalApi(); await b.init(); const c = Object.fromEntries((await b.consents()).map(x => [x.kind, x.granted]));
    expect(c.marketing).toBe(true); expect(c.ai_training).toBe(false);
  });
  it('state hash uses Postgres jsonb::text canonical form', async () => {
    expect(canonical({ scene: 'moon', outfit: 'cape', co_star: 'nibbs', text: 'hi' })).toBe('{"text": "hi", "scene": "moon", "outfit": "cape", "co_star": "nibbs"}');
    expect(await stateHash({ scene: 'moon', outfit: 'cape', co_star: 'nibbs', text: 'hi' })).toBe(await stateHash({ text: 'hi', co_star: 'nibbs', outfit: 'cape', scene: 'moon' }));
  });
});
