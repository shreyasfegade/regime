/* REGIME — ticker search. An ARIA combobox over the universe index; it can
   only find what REGIME covers, and says so when a query misses. */

import { loadExcluded, loadIndex } from './data.js';
import { date } from './format.js';

const ALIASES = { NIFTY: 'NIFTY50', 'NIFTY 50': 'NIFTY50', BANKNIFTY: 'NIFTYBANK', 'NIFTY BANK': 'NIFTYBANK', SENSEX: 'SENSEX' };
const MAX = 12;
const CAP_SHORT = { L: 'Large', M: 'Mid', S: 'Small', I: 'Index' };

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export function rank(items, q) {
  q = q.trim().toUpperCase();
  if (!q) return [];
  const alias = ALIASES[q];
  const scored = [];
  for (const it of items) {
    const sym = (it.sym || '').toUpperCase().replace(/^\^/, '');
    const slug = it.slug.toUpperCase();
    const name = it.name.toUpperCase();
    let s = 0;
    if (slug === alias) s = 100;
    else if (sym === q || slug === q) s = 90;
    else if (sym.startsWith(q) || slug.startsWith(q)) s = 70 - sym.length / 100;
    else if (name.startsWith(q)) s = 60;
    else if (name.split(/[\s&.\-]+/).some(w => w.startsWith(q))) s = 50;
    else if (name.includes(q) || slug.includes(q)) s = 30;
    if (s) scored.push([s - (it.rank || 0) / 1e5, it]);  // ties: larger companies first
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, MAX).map(x => x[1]);
}

export function mountSearch(root) {
  const input = root.querySelector('input');
  const list = root.querySelector('[role="listbox"]');
  let items = [], options = [], active = -1, index = null;

  loadIndex().then(idx => {
    index = idx;
    const u = idx.universe;
    input.placeholder = `Search ${u.covered.toLocaleString('en-IN')} stocks + ${u.indices} indices`;
    input.setAttribute('aria-description',
      `Covers ${u.covered} of AMFI's top ${u.size} companies by market cap (list of ${date(u.list_date)}) and ${u.indices} indices.`);
    items = idx.items;
  }).catch(() => { input.placeholder = 'Search unavailable — data did not load'; });

  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; input.removeAttribute('aria-activedescendant'); }
  function go(slug) { location.href = '/stock/' + encodeURIComponent(slug); }

  function setActive(i) {
    active = i;
    options.forEach((o, k) => o.setAttribute('aria-selected', String(k === i)));
    if (i >= 0 && options[i]) { input.setAttribute('aria-activedescendant', options[i].id); options[i].scrollIntoView({ block: 'nearest' }); }
  }

  async function render() {
    const q = input.value;
    if (!q.trim()) { close(); return; }
    const hits = rank(items, q);
    if (hits.length) {
      list.innerHTML = hits.map((it, i) => `<li role="option" id="opt-${i}" data-slug="${esc(it.slug)}" aria-selected="false">
        <span class="sw r${it.regime}" aria-hidden="true"></span>
        <span class="opt-name">${esc(it.name)} <span class="opt-sym">${esc(it.sym.replace(/\.(NS|BO)$/, ''))}</span></span>
        <span class="opt-meta">${CAP_SHORT[it.cap] || ''}</span></li>`).join('');
    } else {
      let note = '';
      try {
        const ex = await loadExcluded();
        const qq = q.trim().toUpperCase();
        const miss = ex.rows.find(e => e.slug === qq || (e.sym || '').toUpperCase() === qq || e.name.toUpperCase().includes(qq));
        if (miss) note = `<b>${esc(miss.name)}</b> is in the universe but has no analysis: ${esc(miss.reason)}. `;
      } catch { /* exclusions are optional here */ }
      const u = index ? index.universe : null;
      list.innerHTML = `<li class="empty" role="presentation">${note}No match in the REGIME universe${u ? ` — AMFI's top ${u.size.toLocaleString('en-IN')} companies by market cap (list of ${date(u.list_date)}) and ${u.indices} indices` : ''}. <a href="/methodology#coverage">What's covered</a></li>`;
    }
    options = [...list.querySelectorAll('[role="option"]')];
    options.forEach((o, i) => {
      o.addEventListener('mousedown', e => { e.preventDefault(); go(o.dataset.slug); });
      o.addEventListener('mousemove', () => setActive(i));
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(options.length ? 0 : -1);
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(); else setActive(Math.min(active + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') { if (active >= 0 && options[active]) { e.preventDefault(); go(options[active].dataset.slug); } }
    else if (e.key === 'Escape') { if (!list.hidden) { close(); } else { input.value = ''; input.blur(); } }
  });
}
