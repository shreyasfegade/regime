/* REGIME — methodology page. The text is static; this fills in the live
   parts: the covered list, the exclusions and the dates. */

import { loadExcluded, loadIndex } from './data.js';
import { SHORT } from './decode.js';
import { date, num } from './format.js';
import { initShell } from './shell.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fill = (key, v) => document.querySelectorAll(`[data-fill="${key}"]`).forEach(el => { el.textContent = v; });

initShell();

loadIndex().then(idx => {
  const u = idx.universe;
  fill('list-date', `list of ${date(u.list_date)}`);
  fill('indices', num(u.indices));
  fill('asof', date(idx.asof));
  const stocks = idx.items.filter(i => i.cap !== 'I').sort((a, b) => a.rank - b.rank);
  const indices = idx.items.filter(i => i.cap === 'I');
  const li = it => `<li><a href="/stock/${encodeURIComponent(it.slug)}"><span class="sw r${it.regime}" aria-hidden="true"></span>${esc(it.name.replace(/ Ltd$/, ''))}</a> <span class="mono muted">${esc(it.slug)}</span><span class="visually-hidden">, ${SHORT[it.regime]}</span></li>`;
  document.getElementById('covered').innerHTML = `
    <h3>Covered: ${u.covered} stocks</h3><ol class="cols">${stocks.map(li).join('')}</ol>
    <h3>and ${u.indices} indices</h3><ul class="cols">${indices.map(li).join('')}</ul>
    <p class="small">The swatch is each ticker's regime today. Stocks are in AMFI market-cap order.</p>`;
}).catch(() => {
  document.getElementById('covered').innerHTML = '<p class="pending">The covered list could not be loaded.</p>';
});

loadExcluded().then(ex => {
  const el = document.getElementById('excluded');
  if (!ex.rows.length) { el.innerHTML = '<p>Nothing is excluded this week: every candidate was analysed.</p>'; return; }
  el.innerHTML = `<div class="table-scroll"><table class="table">
    <thead><tr><th>Ticker</th><th>Kind</th><th>Reason</th></tr></thead>
    <tbody>${ex.rows.map(r => `<tr><td>${esc(r.name)} <span class="mono muted">${esc(r.sym)}</span></td><td>${r.kind === 'index' ? 'Index' : 'Stock'}</td><td class="small">${esc(r.reason.replace(/^[^:]+:\s*/, ''))}</td></tr>`).join('')}</tbody>
    <caption>${ex.rows.length} excluded. Most are sector indices that Yahoo Finance carries only a day or two of history for.</caption>
  </table></div>`;
}).catch(() => {
  document.getElementById('excluded').innerHTML = '<p class="pending">The exclusions list could not be loaded.</p>';
});
