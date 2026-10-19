/* REGIME — the market page. Today's regime mix across the NIFTY 50, the
   indices, breadth over time, and every stock on one map (or table). All of
   it comes from index.json and breadth.json; no ticker file is loaded. */

import { composition, indexAtX, renderBreadth, shares } from './breadth.js';
import { DataError, loadBreadth, loadEvents, loadIndex } from './data.js';
import { REGIMES, SHORT } from './decode.js';
import { Figure } from './figure.js';
import { date, frac, num, pct } from './format.js';
import { COVERAGE_REASON } from './search.js';
import { initShell } from './shell.js';

const page = document.getElementById('page');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sw = r => `<span class="sw r${r}" aria-hidden="true"></span>`;
const short = sym => sym.replace(/\.(NS|BO)$/, '');
const SURE = 0.8;    // posterior at or above this draws a solid tile
const RANGES = [['1Y', 52], ['3Y', 156], ['5Y', 260], ['Max', Infinity]];
const COLS = [
  ['name', 'Stock', false], ['sector', 'Sector', false], ['regime', 'Regime', false], ['posterior', 'Confidence', true],
  ['days_in', 'Sessions in', true], ['expected_remaining', 'Expected left', true], ['crisis_10d', 'Crisis in 10d', true], ['score', 'Score', true],
];

const params = new URLSearchParams(location.search);
const state = {
  view: params.get('view') === 'table' ? 'table' : 'map',
  group: params.get('group') === 'regime' ? 'regime' : 'sector',
  show: new Set((params.get('show') ?? '0,1,2,3').split(',').filter(v => /^[0-3]$/.test(v)).map(Number)),
  sort: params.get('sort') || 'rank',
  dir: params.get('dir') === 'desc' ? -1 : 1,
};

initShell();
boot();

async function boot() {
  let index, breadth, events;
  try {
    [index, breadth, events] = await Promise.all([loadIndex(), loadBreadth(), loadEvents()]);
  } catch (err) {
    return renderError(err);
  }
  render(index, breadth, events.events || []);
}

function renderError(err) {
  const offline = err instanceof DataError && err.kind === 'network';
  page.innerHTML = `<section class="state" role="alert">
    <p class="kicker">${offline ? 'Connection problem' : 'Data problem'}</p>
    <h1 class="title">${offline ? "Couldn't load the market data" : "The market data couldn't be read"}</h1>
    <p class="dek">${offline ? 'The regime index didn\'t arrive. Check your connection and try again; nothing is computed live, so a retry is all it needs.' : 'The index file is missing or in an unexpected format.'}</p>
    <div class="actions"><button class="btn" type="button" id="retry">Try again</button><a class="btn ghost" href="/methodology">Read the methodology</a></div>
  </section>`;
  page.setAttribute('aria-busy', 'false');
  document.getElementById('retry').addEventListener('click', () => location.reload());
}

function syncUrl() {
  const u = new URL(location.href);
  const set = (k, v, dflt) => (v === dflt ? u.searchParams.delete(k) : u.searchParams.set(k, v));
  set('view', state.view, 'map');
  set('group', state.group, 'sector');
  set('show', [...state.show].sort().join(','), '0,1,2,3');
  set('sort', state.sort, 'rank');
  set('dir', state.dir < 0 ? 'desc' : 'asc', 'asc');
  history.replaceState(null, '', u);
}

// ── Page ───────────────────────────────────────────────────────────

const phrase = r => (r === 1 ? 'in Accumulation' : r === 3 ? 'in Crisis' : SHORT[r]);

function headline(comp) {
  const order = [0, 1, 2, 3].sort((a, b) => comp.count[b] - comp.count[a]);
  const lead = order[0];
  const rest = order.slice(1).filter(r => comp.count[r]).map(r => `${comp.count[r]} ${phrase(r)}`);
  return { lead, text: `${comp.count[lead]} of the ${comp.total} NIFTY 50 stocks are ${phrase(lead)}.`, rest: rest.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' };
}

function render(index, breadth, eventList) {
  const stocks = index.items.filter(it => it.cap !== 'I').sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const indices = index.items.filter(it => it.cap === 'I');
  const comp = composition(stocks);
  const h = headline(comp);
  const all = shares(breadth.groups.all);
  const ago = all[Math.max(0, all.length - 5)];
  const nifty = index.bySlug.get('NIFTY50');
  const fresh = stocks.filter(s => s.days_in <= 5).sort((a, b) => a.days_in - b.days_in || a.rank - b.rank).slice(0, 12);
  const sectors = Object.keys(breadth.groups).filter(k => k.startsWith('sector:')).map(k => k.slice(7));
  const sectorCount = Object.fromEntries(sectors.map(s => [s, stocks.filter(x => x.sector === s).length]));

  page.innerHTML = `
  <section class="today market-today" aria-labelledby="mk-h">
    <div class="today-call r${h.lead}">
      <p class="kicker" id="mk-h">The market today · close of ${date(index.asof)}</p>
      <p class="headline market-headline">${esc(h.text)}</p>
      <p class="explain">${esc(h.rest)} ${nifty ? `The NIFTY 50 index itself is ${phrase(nifty.regime)}, at ${frac(nifty.posterior)} confidence, ${num(nifty.days_in)} session${nifty.days_in === 1 ? '' : 's'} in.` : ''}
      Four weeks earlier, ${ago.count[h.lead]} ${ago.count[h.lead] === 1 ? 'was' : 'were'} ${phrase(h.lead)}.</p>
    </div>
    <div>
      <div class="mix" role="img" aria-label="${SHORT.map((n, k) => `${n} ${comp.count[k]}`).join(', ')} of ${comp.total} stocks">
        ${[0, 1, 2, 3].map(k => comp.count[k] ? `<span class="mix-seg m${k}" style="flex:${comp.count[k]}"></span>` : '').join('')}
      </div>
      <dl class="figs mix-figs">${[0, 1, 2, 3].map(k => `<div><dt>${sw(k)}${SHORT[k]}</dt><dd>${comp.count[k]}<small>${pct(comp.share[k] * 100, 0)}</small></dd></div>`).join('')}</dl>
      <p class="small" style="margin-top:10px">Each stock's regime comes from its own model. Counts are of the ${comp.total} stocks; indices are listed separately below.</p>
    </div>
  </section>

  <section class="section" aria-labelledby="idx-h">
    <div class="section-head"><h2 class="kicker" id="idx-h">Indices</h2><span class="asof">Each index has its own model, fitted to its own history</span></div>
    <ul class="index-strip">${indices.map(it => `<li><a href="/stock/${encodeURIComponent(it.slug)}">
      <span class="ix-name">${esc(it.name)}</span>
      <span class="ix-reg r${it.regime}">${sw(it.regime)}${SHORT[it.regime]}</span>
      <span class="ix-meta num">${frac(it.posterior)} · ${num(it.days_in)} sess.</span></a></li>`).join('')}</ul>
  </section>

  <section class="section" aria-labelledby="f1">
    <figure class="figure">
      <div class="fig-head"><span class="fig-label">Fig. 1</span><h2 class="fig-title" id="f1">Regime breadth over time</h2>
      <p class="fig-dek">Share of stocks in each regime at the end of every week. Crisis sits on the baseline with Bearish above it, so the top of the ochre band is the share of the market in a falling regime.</p></div>
      <div class="fig-tools">
        <label class="select"><span class="visually-hidden">Group</span><select id="b-group">
          <option value="all">All ${comp.total} stocks</option>
          ${sectors.map(s => `<option value="sector:${esc(s)}">${esc(s)} (${sectorCount[s]})</option>`).join('')}
        </select></label>
        <div class="seg" role="group" aria-label="Time range" id="b-range">${RANGES.map(([l], k) => `<button type="button" aria-pressed="${k === 3}" data-k="${k}">${l}</button>`).join('')}</div>
        <div class="legend">${REGIMES.map((n, k) => `<span>${sw(k)}${n}</span>`).join('')}</div>
      </div>
      <div class="fig-canvas" id="fig-breadth" aria-describedby="b-readout"><canvas></canvas></div>
      <p class="fig-readout" id="b-readout" aria-live="polite"></p>
      <div class="fig-foot"><span>Source: Yahoo Finance daily data; REGIME 4-state Gaussian HMM per stock. ${esc(breadth.basis)}, so past weeks are labelled with hindsight.</span><span>Data as of ${date(index.asof)}</span></div>
    </figure>
  </section>

  <section class="section" aria-labelledby="f2">
    <div class="fig-head"><span class="fig-label">Fig. 2</span><h2 class="fig-title" id="f2">Every NIFTY 50 stock, today</h2>
      <p class="fig-dek">One tile per stock, largest companies first. Solid tiles are regimes the model is at least ${SURE * 100}% sure of; pale tiles are less certain. Select a tile to open the stock.</p></div>
    <div class="fig-tools">
      <div class="seg" role="group" aria-label="View" id="m-view">
        <button type="button" data-v="map" aria-pressed="${state.view === 'map'}">Map</button>
        <button type="button" data-v="table" aria-pressed="${state.view === 'table'}">Table</button></div>
      <div class="seg" role="group" aria-label="Group the map by" id="m-group">
        <button type="button" data-g="sector" aria-pressed="${state.group === 'sector'}">By sector</button>
        <button type="button" data-g="regime" aria-pressed="${state.group === 'regime'}">By regime</button></div>
      <div class="seg toggles" role="group" aria-label="Show regimes" id="m-show">${SHORT.map((n, k) => `<button type="button" data-r="${k}" aria-pressed="${state.show.has(k)}">${sw(k)}${n}</button>`).join('')}</div>
    </div>
    <div id="m-body"></div>
    <p class="small" style="margin-top:14px">${COVERAGE_REASON} <a href="/methodology#coverage">What's covered</a></p>
  </section>

  ${fresh.length ? `<section class="section" aria-labelledby="fresh-h">
    <div class="section-head"><h2 class="kicker" id="fresh-h">Newest regimes: entered in the last 5 sessions</h2></div>
    <ul class="fresh">${fresh.map(s => `<li><a href="/stock/${encodeURIComponent(s.slug)}"><span>${esc(s.name.replace(/ Ltd$/, ''))}</span>
      <span class="r${s.regime}">${sw(s.regime)}${SHORT[s.regime]}</span><span class="num muted">${num(s.days_in)} sess. · ${frac(s.posterior)}</span></a></li>`).join('')}</ul>
  </section>` : ''}`;
  page.setAttribute('aria-busy', 'false');
  page.classList.add('fade-in');

  mountBreadth(breadth, eventList, comp.total);
  const body = document.getElementById('m-body');
  const draw = () => {
    document.getElementById('m-group').hidden = state.view !== 'map';
    const shown = stocks.filter(s => state.show.has(s.regime));
    if (!shown.length) {
      body.innerHTML = `<div class="notice" role="status"><b>No stocks to show.</b> Every regime is switched off; turn one back on above.</div>`;
    } else if (state.view === 'map') renderMap(body, shown, stocks.length);
    else renderTable(body, shown);
    syncUrl();
  };
  document.querySelectorAll('#m-view button').forEach(b => b.addEventListener('click', () => {
    state.view = b.dataset.v; press('#m-view', b); draw();
  }));
  document.querySelectorAll('#m-group button').forEach(b => b.addEventListener('click', () => {
    state.group = b.dataset.g; press('#m-group', b); draw();
  }));
  document.querySelectorAll('#m-show button').forEach(b => b.addEventListener('click', () => {
    const r = +b.dataset.r;
    if (state.show.has(r)) state.show.delete(r); else state.show.add(r);
    b.setAttribute('aria-pressed', String(state.show.has(r)));
    draw();
  }));
  draw();
}

function press(sel, btn) {
  document.querySelectorAll(`${sel} button`).forEach(x => x.setAttribute('aria-pressed', String(x === btn)));
}

// ── Fig. 1 ─────────────────────────────────────────────────────────

function mountBreadth(breadth, eventList, total) {
  const weeks = breadth.weeks;
  const nearest = iso => { let i = weeks.findIndex(w => w >= iso); return i < 0 ? weeks.length - 1 : i; };
  const events = eventList.map(e => ({ ...e, i: nearest(e.date) })).filter(e => e.i > 0 && e.i < weeks.length - 1);
  const b = { weeks, series: shares(breadth.groups.all), name: `all ${total} stocks` };
  const view = { i0: 0, i1: weeks.length - 1 };
  const readout = document.getElementById('b-readout');
  const show = i => {
    const k = i < 0 ? weeks.length - 1 : i, s = b.series[k];
    readout.innerHTML = `Week to ${date(weeks[k])} · ${[0, 1, 2, 3].map(r => `<b class="r${r}">${SHORT[r]} ${s.count[r]}</b>`).join(' · ')} · of ${s.total}`;
  };
  const fig = new Figure(document.getElementById('fig-breadth'), {
    height: w => (w < 560 ? 260 : 340), n: weeks.length, label: `Weekly share of stocks in each regime, ${b.name}`,
    render: (ctx, w, h, P, c) => renderBreadth(ctx, w, h, P, c, b, view, events),
    indexAt: (g, px) => indexAtX(g, px), onCursor: show,
  });
  show(-1);
  document.getElementById('b-group').addEventListener('change', e => {
    const g = e.target.value;
    b.series = shares(breadth.groups[g]);
    b.name = e.target.selectedOptions[0].textContent;
    fig.canvas.setAttribute('aria-label', `Weekly share of stocks in each regime, ${b.name}`);
    fig.draw(); show(fig.cursor);
  });
  document.querySelectorAll('#b-range button').forEach(btn => btn.addEventListener('click', () => {
    press('#b-range', btn);
    const len = RANGES[+btn.dataset.k][1];
    view.i1 = weeks.length - 1;
    view.i0 = Math.max(0, weeks.length - Math.min(len, weeks.length));
    fig.draw();
  }));
}

// ── Fig. 2: map ────────────────────────────────────────────────────

function tile(s) {
  const sure = s.posterior >= SURE;
  const label = `${s.name}: ${REGIMES[s.regime]}, ${frac(s.posterior)} confidence, ${num(s.days_in)} sessions in`;
  return `<a class="tile t${s.regime}${sure ? ' sure' : ''}" href="/stock/${encodeURIComponent(s.slug)}" tabindex="-1" data-slug="${esc(s.slug)}" aria-label="${esc(label)}">
    <span class="tile-sym">${esc(short(s.sym))}</span><span class="tile-p">${Math.round(s.posterior * 100)}</span></a>`;
}

function renderMap(body, shown, total) {
  let groups;
  if (state.group === 'regime') {
    groups = [0, 1, 2, 3].filter(r => state.show.has(r)).map(r => ({ key: `<span class="r${r}">${sw(r)}${REGIMES[r]}</span>`, items: shown.filter(s => s.regime === r) }));
  } else {
    const by = new Map();
    for (const s of shown) { if (!by.has(s.sector)) by.set(s.sector, []); by.get(s.sector).push(s); }
    groups = [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([k, items]) => ({ key: esc(k), items }));
  }
  groups = groups.filter(g => g.items.length);
  body.innerHTML = `<div class="map" role="group" aria-label="Map of ${shown.length} of ${total} stocks. Arrow keys move between tiles.">
    ${groups.map(g => `<div class="map-row"><h3 class="map-key">${g.key}<span class="num muted"> ${g.items.length}</span></h3>
      <div class="map-tiles">${g.items.map(tile).join('')}</div></div>`).join('')}
  </div>
  <p class="legend" style="margin-top:12px"><span><span class="tile-key sure"></span>at least ${SURE * 100}% confident</span><span><span class="tile-key"></span>less certain</span><span class="muted">The number is today's confidence, in %.</span></p>`;
  roving(body.querySelector('.map'));
  tooltips(body, shown);
}

/** One tab stop for the whole map; arrow keys move within and between rows. */
function roving(map) {
  const rows = [...map.querySelectorAll('.map-tiles')].map(r => [...r.children]);
  const flat = rows.flat();
  if (!flat.length) return;
  flat[0].tabIndex = 0;
  const at = el => { for (let r = 0; r < rows.length; r++) { const c = rows[r].indexOf(el); if (c >= 0) return [r, c]; } return [0, 0]; };
  const focus = el => { flat.forEach(t => (t.tabIndex = -1)); el.tabIndex = 0; el.focus(); };
  map.addEventListener('keydown', e => {
    const [r, c] = at(document.activeElement);
    let next = null;
    if (e.key === 'ArrowRight') next = rows[r][c + 1] || rows[r + 1]?.[0];
    else if (e.key === 'ArrowLeft') next = rows[r][c - 1] || rows[r - 1]?.at(-1);
    else if (e.key === 'ArrowDown') next = rows[r + 1] && rows[r + 1][Math.min(c, rows[r + 1].length - 1)];
    else if (e.key === 'ArrowUp') next = rows[r - 1] && rows[r - 1][Math.min(c, rows[r - 1].length - 1)];
    else if (e.key === 'Home') next = rows[r][0];
    else if (e.key === 'End') next = rows[r].at(-1);
    if (next) { e.preventDefault(); focus(next); }
  });
}

function tooltips(body, shown) {
  const tip = document.getElementById('tip');
  const bySlug = new Map(shown.map(s => [s.slug, s]));
  const open = el => {
    const s = bySlug.get(el.dataset.slug);
    tip.innerHTML = `<b>${esc(s.name)}</b><br>${REGIMES[s.regime]} · ${frac(s.posterior)}<br>${num(s.days_in)} sessions in · ~${num(s.expected_remaining)} expected left<br>${esc(s.sector)}`;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left));
    const y = r.bottom + 6 + tip.offsetHeight > window.innerHeight ? r.top - tip.offsetHeight - 6 : r.bottom + 6;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  const close = () => { tip.hidden = true; };
  body.querySelectorAll('.tile').forEach(el => {
    el.addEventListener('mouseenter', () => open(el));
    el.addEventListener('mouseleave', close);
    el.addEventListener('focus', () => open(el));
    el.addEventListener('blur', close);
  });
}

// ── Fig. 2: table ──────────────────────────────────────────────────

function renderTable(body, shown) {
  const key = state.sort, dir = state.dir;
  const val = s => (key === 'rank' ? s.rank : s[key]);
  const rows = [...shown].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === 'string' ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity);
    return c * dir || a.rank - b.rank;
  });
  const th = ([k, label, n]) => {
    const sorted = key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none';
    return `<th scope="col" class="${n ? 'n' : ''}" aria-sort="${sorted}"><button type="button" class="sort" data-k="${k}">${label}<span aria-hidden="true">${sorted === 'none' ? '' : dir > 0 ? ' ↑' : ' ↓'}</span></button></th>`;
  };
  body.innerHTML = `<div class="table-scroll"><table class="table market-table">
    <thead><tr><th scope="col" class="n" aria-sort="${key === 'rank' ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sort" data-k="rank">#</button></th>${COLS.map(th).join('')}</tr></thead>
    <tbody>${rows.map(s => `<tr>
      <td class="n muted">${s.rank}</td>
      <td><a href="/stock/${encodeURIComponent(s.slug)}">${esc(s.name.replace(/ Ltd$/, ''))}</a> <span class="mono muted">${esc(short(s.sym))}</span></td>
      <td class="small">${esc(s.sector)}</td>
      <td class="r${s.regime}">${sw(s.regime)}${SHORT[s.regime]}</td>
      <td class="n">${frac(s.posterior)}</td><td class="n">${num(s.days_in)}</td>
      <td class="n">${s.expected_remaining == null ? '—' : num(s.expected_remaining)}</td>
      <td class="n">${pct(s.crisis_10d, 1)}</td><td class="n">${num(s.score)}</td></tr>`).join('')}</tbody>
    <caption>${rows.length} stocks. Rank is AMFI's average market capitalisation rank. Expected left is in sessions; crisis in 10d is the projected probability of being in Crisis ten sessions from now. Select a column heading to sort.</caption>
  </table></div>`;
  body.querySelectorAll('button.sort').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (state.sort === k) state.dir = -state.dir;
    else { state.sort = k; state.dir = COLS.find(c => c[0] === k)?.[2] ? -1 : 1; }
    renderTable(body, shown);
    syncUrl();
    body.querySelector(`button.sort[data-k="${k}"]`).focus();
  }));
}
