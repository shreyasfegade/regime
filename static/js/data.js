/* REGIME — data layer. Everything comes from static files under /data/;
   there is no API. Fetches time out, retry once, and fail with a typed error
   so every page can show the right state instead of hanging. */

import { decodeTicker, indexRows } from './decode.js';

const BASE = '/data/';
const TIMEOUT_MS = 10000;
const cache = new Map();

export class DataError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
// kinds: 'not-found' (no such file), 'network' (offline / timeout), 'schema' (unexpected data)

async function fetchJSON(path, { retries = 1 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(BASE + path, { signal: ctl.signal });
      if (res.status === 404) throw new DataError('not-found', `${path} not found`);
      if (!res.ok) throw new DataError('network', `HTTP ${res.status}`);
      try { return await res.json(); } catch { throw new DataError('schema', `${path} is not valid JSON`); }
    } catch (err) {
      last = err instanceof DataError ? err : new DataError('network', err.name === 'AbortError' ? 'timed out' : 'offline');
      if (last.kind !== 'network') throw last;
    } finally { clearTimeout(timer); }
  }
  throw last;
}

function memo(key, fn) {
  if (!cache.has(key)) {
    const p = fn().catch(err => { cache.delete(key); throw err; });
    cache.set(key, p);
    if (cache.size > 24) cache.delete(cache.keys().next().value);  // small LRU for ticker files
  }
  return cache.get(key);
}

function requireVersion(obj, what) {
  if (!obj || obj.v !== 2) throw new DataError('schema', `${what} has an unexpected format`);
  return obj;
}

export function loadIndex() {
  return memo('index', async () => {
    const idx = requireVersion(await fetchJSON('index.json'), 'index');
    idx.items = indexRows(idx);
    idx.bySlug = new Map(idx.items.map(r => [r.slug, r]));
    return idx;
  });
}

export function loadTicker(slug) {
  return memo('t:' + slug, async () => {
    const raw = requireVersion(await fetchJSON(`t/${encodeURIComponent(slug)}.json`), slug);
    return decodeTicker(raw);
  });
}

export const loadMeta = () => memo('meta', () => fetchJSON('meta.json'));
export const loadBreadth = () => memo('breadth', async () => requireVersion(await fetchJSON('breadth.json'), 'breadth'));
export const loadExcluded = () => memo('excluded', async () => requireVersion(await fetchJSON('excluded.json'), 'exclusions'));
export const loadEvents = () => memo('events', () => fetch('/events.json').then(r => r.json()).catch(() => ({ events: [] })));
export const loadExplainer = () => memo('explainer', async () => requireVersion(await fetchJSON('explainer.json'), 'explainer'));
