/* REGIME — shared page chrome: theme, search, stale-data notice, shortcuts. */

import { loadMeta } from './data.js';
import { date, daysBetween } from './format.js';
import { mountSearch } from './search.js';

const STALE_DAYS = 10;
const KEY = 'regime-theme';

export function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initTheme() {
  const btn = document.querySelector('.theme-toggle');
  const label = () => { if (btn) btn.textContent = currentTheme() === 'dark' ? 'Light' : 'Dark'; };
  label();
  btn?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
    label();
    window.dispatchEvent(new Event('regime:theme'));
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    label(); window.dispatchEvent(new Event('regime:theme'));
  });
}

async function staleNotice() {
  const slot = document.getElementById('notices');
  if (!slot) return;
  try {
    const meta = await loadMeta();
    document.querySelectorAll('[data-asof]').forEach(el => { el.textContent = date(meta.asof); });
    const today = new Date().toISOString().slice(0, 10);
    const age = daysBetween(meta.asof, today);
    if (age > STALE_DAYS) {
      slot.innerHTML = `<div class="notice warn" role="status"><b>Data as of ${date(meta.asof)}.</b> The weekly refresh hasn't landed for ${age} days, so the figures below may be out of date. Everything shown is the last complete, validated run.</div>`;
    }
  } catch { /* the page itself reports data failures */ }
}

export function initShell() {
  initTheme();
  const search = document.querySelector('.search');
  if (search) mountSearch(search);
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault(); search?.querySelector('input').focus();
    }
  });
  staleNotice();
}
