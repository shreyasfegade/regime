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
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXEC });
const failures = [];
for (const shot of SHOTS) {
  if (ONLY && !ONLY.includes(shot.page)) continue;
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: size, colorScheme: shot.theme || 'light', reducedMotion: 'reduce', deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    if (shot.hold) await page.route(shot.hold, () => {});            // never answers: the loading state
    if (shot.abort) await page.route(shot.abort, r => r.abort('internetdisconnected'));
    await page.goto(BASE + shot.path, { waitUntil: shot.hold ? 'domcontentloaded' : 'networkidle' });
    await page.waitForTimeout(shot.hold ? 400 : 700);
    if (shot.scrollTo) await page.locator(shot.scrollTo).scrollIntoViewIfNeeded();
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
await browser.close();
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('all screenshots clean');
