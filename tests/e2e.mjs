// E2E against a running site (local preview or LIVE). Usage: node tests/e2e.mjs <base> [chromium|webkit] [shotsDir]
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
const base = (process.argv[2] || 'http://localhost:4173/storybook-ai-demo').replace(/\/$/, '');
const engine = process.argv[3] || 'chromium';
const shots = process.argv[4] || '';
const b = await (engine === 'webkit' ? webkit : chromium).launch({ args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
const ctx = await b.newContext({ ...devices['iPhone 14'], ...(engine === 'chromium' ? { defaultBrowserType: undefined } : {}) });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const results = [];
const step = async (name, f) => { const t = Date.now(); try { await f(); results.push(['PASS', name, Date.now() - t]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); if (shots) await p.screenshot({ path: `${shots}/FAIL-${engine}-${name.replace(/\W+/g, '-')}.png` }).catch(() => {}); } };
const shot = async n => { if (shots) { await p.waitForTimeout(600); await p.screenshot({ path: `${shots}/${n}.png` }); } };
const passGate = async (optional = false) => {
  try { await p.getByTestId('gate').waitFor({ timeout: optional ? 1500 : 10000 }); } catch (e) { if (optional) return; throw e; }
  const code = await p.getByTestId('gate-words').getAttribute('data-code');
  for (const d of code) { const k = p.getByLabel(`Number ${d}`); const bb = await k.boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.waitForTimeout(750); await p.mouse.up(); await p.waitForTimeout(80); }
  await p.getByTestId('gate').waitFor({ state: 'detached' });
};
const active = async () => { const i = await p.evaluate(() => { const f = document.querySelector('[data-testid=feed-scroller]'); return Math.round(f.scrollTop / f.clientHeight); }); return p.getByTestId(`reel-${i}`); };

await step('app loads (200) and welcome shows', async () => { const r = await p.goto(`${base}/app/`); assert.equal(r.status(), 200); await p.getByTestId('welcome').waitFor(); await shot('01-welcome'); });
await step('parent gate on setup', async () => { await p.getByRole('button', { name: /Make my child the star/i }).click(); await p.getByTestId('gate').waitFor(); await shot('02-parent-gate'); await passGate(); });
await step('consent: AI training defaults OFF', async () => { await p.getByTestId('consent-first').waitFor(); assert.equal(await p.getByRole('switch', { name: 'Help improve our AI' }).getAttribute('aria-checked'), 'false'); assert.equal(await p.getByRole('switch', { name: /character and reels/ }).getAttribute('aria-checked'), 'true'); await shot('03-consent'); await p.getByRole('button', { name: 'Continue' }).click(); });
await step('create character', async () => { await p.getByTestId('make').waitFor(); await p.getByLabel("Child's name").fill('Zoya'); await p.getByLabel('Hair puffs').click(); await p.getByLabel(/Skin tone #8A5636/).click(); await shot('04-character'); await p.getByTestId('make-first').click(); });
let first;
await step('generate reel: real video file rendered in the browser', async () => {
  await p.getByTestId('feed').waitFor(); first = p.getByTestId('reel-0');
  await first.getByTestId('rendering').waitFor({ timeout: 10000 }); await shot('05-rendering');
  await first.locator('video').waitFor({ timeout: 40000 });
  const src = await first.locator('video').getAttribute('src'); assert.match(src, /^blob:/);
  const size = await p.evaluate(async s => (await (await fetch(s)).blob()).size, src); assert.ok(size > 20000, 'video too small ' + size);
  assert.equal(await first.getAttribute('data-status'), 'ready');
});
await step('feed: Today bar, title has kid name', async () => { await p.waitForTimeout(1500); assert.match(await p.getByTestId('today').innerText(), /TODAY · 1 OF \d/); assert.match(await first.getAttribute('aria-label'), /Zoya/); await shot('06-feed'); });
await step('feed swipe to next reel', async () => {
  await p.evaluate(() => { const f = document.querySelector('[data-testid=feed-scroller]'); f.scrollTo({ top: f.clientHeight }); });
  await p.waitForFunction(() => /TODAY · 2 OF/.test(document.querySelector('[data-testid=today]')?.textContent || ''), null, { timeout: 5000 });
  await p.evaluate(() => { const f = document.querySelector('[data-testid=feed-scroller]'); f.scrollTo({ top: 0 }); }); await p.waitForTimeout(700);
});
await step('love it + save', async () => { await first.getByLabel('Love it').click(); assert.equal(await first.getByLabel('Love it').getAttribute('aria-pressed'), 'true'); await first.getByLabel('Save').click(); assert.equal(await first.getByLabel('Save').getAttribute('aria-pressed'), 'true'); });
await step('remake: edit scene/outfit/co-star/text -> new version + job, re-render', async () => {
  await first.getByLabel('Remake').click(); await p.getByRole('dialog', { name: 'Remake this reel' }).waitFor();
  await p.getByLabel('Scene Under the sea').click(); await p.getByLabel('Outfit astronaut').click(); await p.getByLabel('Co-star bruno').click();
  await p.getByLabel('Reel line').fill('Bubbles for Bruno! Swim with me!'); await shot('07-remake-sheet');
  await p.getByTestId('remake-go').click();
  await p.waitForFunction(() => document.querySelector('[data-testid=reel-0]')?.getAttribute('data-version') === '2');
  await first.getByTestId('rendering').waitFor({ timeout: 5000 }); await shot('08-rendering-v2');
  await p.waitForFunction(() => document.querySelector('[data-testid=reel-0]')?.getAttribute('data-status') === 'ready', null, { timeout: 40000 });
  await first.locator('video').waitFor(); assert.match(await first.innerText(), /Bubbles for Bruno/);
});
await step('end card -> book reader', async () => {
  await p.evaluate(() => document.querySelector('[data-testid=reel-0] video')?.dispatchEvent(new Event('ended')));
  await p.getByTestId('endcard').waitFor({ timeout: 15000 }); await shot('09-endcard');
  await p.getByRole('button', { name: /Read the whole story/i }).click(); await p.getByTestId('book').waitFor();
  assert.match(await p.getByTestId('book-title').innerText(), /Zoya/); await shot('10-book');
  await p.getByLabel('Next page').click(); await p.waitForTimeout(900); assert.equal(await p.getByTestId('page-no').innerText(), '2/6');
  await p.getByLabel('Close book').click(); await p.getByTestId('feed').waitFor();
});
await step('family (gated): share file + publish creates draft only', async () => {
  await p.waitForTimeout(600); await first.getByLabel('Family (grown-ups)').click(); await passGate(true);
  await p.getByRole('dialog', { name: 'Family and sharing' }).waitFor(); await p.getByTestId('share-file').waitFor();
  await p.waitForFunction(() => !document.querySelector('[data-testid=share-file]')?.hasAttribute('disabled'), null, { timeout: 10000 });
  await p.getByTestId('publish').click(); await p.getByTestId('draft-ok').waitFor(); await shot('11-publish-draft');
  await p.getByRole('button', { name: 'Done' }).click();
});
await step('grown-ups: queue shows draft (not posted); AI consent persists', async () => {
  await p.getByRole('button', { name: 'Grown-ups', exact: true }).click(); await passGate(true); await p.getByTestId('grownups').waitFor();
  const rows = p.getByTestId('draft-row'); assert.equal(await rows.count(), 1); assert.match(await rows.first().innerText(), /draft/i);
  assert.equal(await p.getByRole('switch', { name: 'Help improve our AI' }).getAttribute('aria-checked'), 'false');
  await p.getByRole('switch', { name: 'Marketing emails to me' }).click(); await shot('12-grownups-consent');
  await p.reload(); await passGate(true); await p.getByTestId('grownups').waitFor();
  assert.equal(await p.getByRole('switch', { name: 'Marketing emails to me' }).getAttribute('aria-checked'), 'true');
  assert.equal(await p.getByRole('switch', { name: 'Help improve our AI' }).getAttribute('aria-checked'), 'false');
  assert.equal(await p.getByTestId('draft-row').count(), 1);
});
await step('bedtime mode feed', async () => { await p.getByRole('button', { name: 'Reels', exact: true }).click(); await p.getByRole('button', { name: /Bedtime/ }).click(); await p.waitForTimeout(1200); assert.equal(await p.getByTestId('feed').getAttribute('data-tab'), 'bedtime'); await shot('13-bedtime'); await p.getByRole('button', { name: /For Zoya/ }).click(); });
await step('paywall is a mock (no payment)', async () => { await p.goto(`${base}/app/#paywall/loved`); await p.getByTestId('paywall').waitFor(); await shot('14-paywall'); await p.getByTestId('start-trial').click(); await passGate(true); await p.getByTestId('paywall-mock').waitFor(); });
await step('privacy page', async () => { const r = await p.goto(`${base}/privacy/`); assert.equal(r.status(), 200); assert.match(await p.content(), /lucklypriyansh@gmail.com/); await shot('15-privacy'); });
await step('no page errors', async () => { assert.deepEqual(errs, []); });
for (const r of results) console.log(r.join('  '));
console.log(`${engine}: ${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`);
await b.close();
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
