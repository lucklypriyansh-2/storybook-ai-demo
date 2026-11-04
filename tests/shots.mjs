import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:4173';
const out = process.argv[3] || '/workspace/storybook-demo/screenshots';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const shot = async (n, w = 1700) => { await p.waitForTimeout(w); await p.screenshot({ path: `${out}/${n}.png` }); };
const screens = ['onboarding','consent','upload','create','reveal','pick','loading','reader','video','checkout','share','settings'];
const nums = { onboarding:'01', consent:'02', upload:'03', create:'04', reveal:'05', pick:'06', loading:'07', reader:'08', video:'09', checkout:'10', share:'11', settings:'14' };
for (const s of screens) {
  await p.goto('about:blank'); await p.goto(`${base}/app/#${s}`); await p.evaluate(() => document.fonts.ready);
  if (s === 'upload') { await p.getByText('Demo: use sample photos').click(); }
  await shot(`${nums[s]}-${s}`, s === 'loading' ? 1500 : 1700);
}
await p.goto('about:blank'); await p.goto(`${base}/app/#library`); await shot('13-library-empty');
await p.goto('about:blank'); await p.goto(`${base}/app/#loading`); await p.waitForSelector('[data-testid=page-no]', { timeout: 20000 });
await p.getByLabel('Next page').click(); await p.waitForTimeout(330); await p.screenshot({ path: `${out}/08b-reader-page-turn.png` });
await p.waitForTimeout(800); await p.getByLabel('Close').click(); await shot('12-library');
await p.goto('about:blank'); await p.goto(`${base}/app/#settings`); await p.waitForTimeout(800); await p.getByRole('button', { name: /Delete .*photos now/ }).click(); await shot('15-delete-confirm', 1200);
await p.goto(`${base}/`); await p.waitForTimeout(1200); await p.screenshot({ path: `${out}/landing-hero.png` });
await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); });
await p.waitForTimeout(800); await p.screenshot({ path: `${out}/landing-full.png`, fullPage: true });
console.log('errors:', JSON.stringify(errs));
await b.close();
