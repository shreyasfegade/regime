/* REGIME — screenshots of every page and state, desktop and mobile, plus an
   axe-core accessibility pass. Runs against scripts/serve.py.

     python scripts/serve.py &          # or: --data <folder>
     node scripts/screenshots.mjs [--only stock] [--out screenshots]

   Writes screenshots/<viewport>-<page>-<state>.png and fails on any console
   error or serious/critical axe violation. */

import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(x => x.length));
const BASE = args.base || 'http://127.0.0.1:8050';
const OUT = args.out || 'screenshots';
const ONLY = args.only ? args.only.split(',') : null;
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const STOCK = args.stock || 'RELIANCE';
const SHOTS = [
  { page: 'stock', state: 'loaded', path: `/stock/${STOCK}` },
  { page: 'stock', state: 'dark', path: '/stock/NIFTY50', theme: 'dark' },
  { page: 'stock', state: 'cursor', path: `/stock/${STOCK}?at=2020-03-23&range=5Y`, viewportOnly: true, scrollTo: '#fig-timeline' },
  { page: 'stock', state: 'loading', path: `/stock/${STOCK}`, hold: '**/data/t/**', viewportOnly: true },
  { page: 'stock', state: 'not-in-universe', path: '/stock/RELIANC' },
  { page: 'stock', state: 'network-error', path: `/stock/${STOCK}`, abort: '**/data/t/**', expectErrors: true },
  { page: 'stock', state: 'stale', path: `/stock/${STOCK}`, stale: true, viewportOnly: true },
  { page: 'stock', state: 'transition-cell', path: `/stock/${STOCK}`, click: '.matrix button[data-i="0"][data-j="2"]', scrollTo: '#p-matrix', viewportOnly: true },
  { page: 'map', state: 'default', path: '/' },
  { page: 'map', state: 'dark', path: '/', theme: 'dark' },
  { page: 'map', state: 'by-regime', path: '/?group=regime', scrollTo: '#m-body', viewportOnly: true },
  { page: 'map', state: 'table', path: '/?view=table&sort=posterior&dir=asc', scrollTo: '#m-body', viewportOnly: true },
  { page: 'map', state: 'empty-filter', path: '/?show=', scrollTo: '#m-body', viewportOnly: true },
  { page: 'map', state: 'network-error', path: '/', abort: '**/data/index.json', expectErrors: true },
  { page: 'explainer', state: 'full', path: '/how-it-works' },
  ...[0, 3, 4, 5, 6].map(k => ({ page: 'explainer', state: `step-${k + 1}`, path: '/how-it-works', motion: 'no-preference', scrollTo: `.step[data-step="${k}"] h2`, center: true, viewportOnly: true, desktopOnly: true })),
  { page: 'explainer', state: 'stickier', path: '/how-it-works', motion: 'no-preference', scrollTo: '.step[data-step="5"] h2', center: true, viewportOnly: true, desktopOnly: true, input: ['#c-switch', '-0.8'] },
  { page: 'methodology', state: 'default', path: '/methodology' },
  { page: '404', state: 'default', path: '/no-such-page', expectErrors: true },  // the document itself is a 404
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXEC });
const failures = [];
for (const shot of SHOTS) {
  if (ONLY && !ONLY.includes(shot.page)) continue;
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    if (shot.desktopOnly && vp !== 'desktop') continue;
    const ctx = await browser.newContext({ viewport: size, colorScheme: shot.theme || 'light', reducedMotion: shot.motion || 'reduce', deviceScaleFactor: shot.viewportOnly ? 2 : 1 });  // full pages at 1x keep the folder small
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    if (shot.hold) await page.route(shot.hold, () => {});            // never answers: the loading state
    if (shot.abort) await page.route(shot.abort, r => r.abort('internetdisconnected'));
    if (shot.stale) await page.route('**/data/meta.json', async r => {
      const meta = await (await r.fetch()).json();
      await r.fulfill({ json: { ...meta, asof: '2026-09-25' } });
    });
    await page.goto(BASE + shot.path, { waitUntil: shot.hold ? 'domcontentloaded' : 'networkidle' });
    await page.waitForTimeout(shot.hold ? 400 : 700);
    if (shot.click) await page.locator(shot.click).click();
    if (shot.input) await page.locator(shot.input[0]).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input')); }, shot.input[1]);
    if (shot.scrollTo) {
      if (shot.center) await page.locator(shot.scrollTo).evaluate(e => e.scrollIntoView({ block: 'center' }));
      else await page.locator(shot.scrollTo).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }
    const file = `${OUT}/${vp}-${shot.page}-${shot.state}.png`;
    await page.screenshot({ path: file, fullPage: !shot.viewportOnly });
    if (!shot.hold) {
      await page.addScriptTag({ content: AXE });
      const res = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
        .filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.length} node(s) — ${v.help}`));
      res.forEach(r => failures.push(`${file}: axe ${r}`));
    }
    if (!shot.expectErrors) errors.forEach(e => failures.push(`${file}: ${e}`));
    console.log(`${file}${errors.length && !shot.expectErrors ? ' (errors)' : ''}`);
    await ctx.close();
  }
}
// Social preview image and README hero.
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  if (!ONLY) await page.screenshot({ path: 'static/og.png' });
  await ctx.close();
  const hero = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: 2 });
  const hp = await hero.newPage();
  await hp.goto(BASE + '/stock/NIFTY50', { waitUntil: 'networkidle' });
  await hp.waitForTimeout(700);
  if (!ONLY) await hp.screenshot({ path: `${OUT}/hero.png` });
  await hero.close();
}
await browser.close();
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('all screenshots clean');
