/* REGIME — the stock page. Reading order: today's regime, the regime
   timeline over price, then the detail panels. Every section renders from
   the one lazy-loaded ticker file; a section whose data is missing says so
   without taking the rest of the page down. */

import { DataError, loadEvents, loadExcluded, loadIndex, loadTicker } from './data.js';
import { REGIMES, SHORT } from './decode.js';
import { backtestSentence, PLAIN, regimeCharacter, todaySentence } from './explain.js';
import { Figure, linkCursors, palette, sizeCanvas } from './figure.js';
import { CAP, date, frac, num, pct, price, signedNum } from './format.js';
import { renderCalendar, calendarHeight, calendarIndexAt, calendarLayout } from './calendar.js';
import { renderEquity } from './equity.js';
import { COVERAGE_REASON, rank } from './search.js';
import { initShell } from './shell.js';
import { renderBic, renderCrisis, renderSpark } from './small.js';
import { indexAtX, renderRibbon, renderTimeline } from './timeline.js';

const RANGES = [['1Y', 252], ['3Y', 756], ['5Y', 1260], ['Max', Infinity]];
const page = document.getElementById('page');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sw = r => `<span class="sw r${r}" aria-hidden="true"></span>`;

function slugFromUrl() {
  const q = new URLSearchParams(location.search).get('s');
  if (q) return q.toUpperCase();
  const m = location.pathname.match(/\/stock\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).toUpperCase() : '';
}

initShell();
boot();

async function boot() {
  const slug = slugFromUrl();
  const line = document.getElementById('loading-line');
  if (line && slug) line.textContent = `Loading ${slug}…`;
  if (!slug) return renderMissing('', null);
  let index;
  try {
    index = await loadIndex();
  } catch (err) {
    return renderError(err, slug);
  }
  if (!index.bySlug.has(slug)) return renderMissing(slug, index);
  try {
    const [d, events] = await Promise.all([loadTicker(slug), loadEvents()]);
    render(d, index, events.events || []);
  } catch (err) {
    renderError(err, slug);
  }
}

// ── States ─────────────────────────────────────────────────────────

async function renderMissing(slug, index) {
  document.title = 'Not in the universe — REGIME';
  let excluded = null;
  try { excluded = (await loadExcluded()).rows.find(e => e.slug === slug || (e.sym || '').toUpperCase() === slug); } catch { /* optional */ }
  const u = index?.universe;
  const near = index && slug ? rank(index.items, slug.slice(0, 4)).slice(0, 5) : [];
  page.innerHTML = `<section class="state">
    <p class="kicker">Not covered</p>
    <h1 class="title">${slug ? `${esc(slug)} isn't covered` : 'No stock selected'}</h1>
    ${excluded ? `<p class="dek"><b>${esc(excluded.name)}</b> is tracked, but has no analysis: ${esc(excluded.reason)}.</p>` : ''}
    <p class="dek"${excluded ? ' style="margin-top:10px"' : ''}>${COVERAGE_REASON}${u ? ` That is ${u.covered} stocks and ${u.indices} indices.` : ''}</p>
    ${near.length ? `<ul aria-label="Similar names">${near.map(n => `<li><a href="/stock/${encodeURIComponent(n.slug)}"><span>${sw(n.regime)}${esc(n.name)}</span><span class="mono muted">${esc(n.slug)}</span></a></li>`).join('')}</ul>` : ''}
    <div class="actions"><a class="btn ghost" href="/">Browse the Regime Map</a><a class="btn ghost" href="/methodology#coverage">What's covered</a></div>
  </section>`;
  page.setAttribute('aria-busy', 'false');
}

function renderError(err, slug) {
  document.title = 'Could not load — REGIME';
  const offline = err instanceof DataError && err.kind === 'network';
  page.innerHTML = `<section class="state" role="alert">
    <p class="kicker">${offline ? 'Connection problem' : 'Data problem'}</p>
    <h1 class="title">${offline ? `Couldn't load ${esc(slug)}` : `${esc(slug)}'s data couldn't be read`}</h1>
    <p class="dek">${offline ? 'The regime file didn\'t arrive. Check your connection and try again; nothing is computed live, so a retry is all it needs.' : 'The file for this ticker is missing or in an unexpected format. The rest of the site is unaffected.'}</p>
    <div class="actions"><button class="btn" type="button" id="retry">Try again</button><a class="btn ghost" href="/">Back to the Regime Map</a></div>
  </section>`;
  page.setAttribute('aria-busy', 'false');
  document.getElementById('retry').addEventListener('click', () => location.reload());
}

function safe(id, fn) {
  const el = document.getElementById(id);
  try { fn(el); } catch (err) {
    console.error(id, err);
    el.innerHTML = '<p class="pending">This panel could not be drawn from the data available.</p>';
  }
}

// ── Page ───────────────────────────────────────────────────────────

function render(d, index, eventList) {
  const t = d.today, r = t.regime;
  const isIndex = d.cap === 'I';
  document.title = `${d.name}: ${SHORT[r]} — REGIME`;
  d.vitRuns = runsOf(d.vit);
  const events = eventList.map(e => ({ ...e, i: nearestIndex(d.dates, e.date) })).filter(e => e.i > 0 && e.i < d.n - 1);
  const score = d.robustness.score;
  const s = d.stats[r];

  page.innerHTML = `
  <div class="ticker-head">
    <h1>${esc(d.name)}<span class="sym">${esc(d.sym)}</span></h1>
    <p class="asof">Close of ${date(d.asof)} · ${num(d.n)} sessions from ${date(d.dates[0])}</p>
  </div>

  <section class="today" aria-labelledby="today-h">
    <div class="today-call r${r}">
      <p class="kicker" id="today-h">Today's regime</p>
      <p class="headline">${REGIMES[r]}</p>
      <p class="explain">${esc(todaySentence(d))}</p>
      <div class="ticker-meta">
        ${isIndex ? '<span>Index, in points</span>' : `<span>${esc(d.sector)}</span><span>${CAP[d.cap]}</span>
        <span>AMFI rank <b class="num">${d.rank}</b></span><span>${d.exchange} prices</span>`}
      </div>
    </div>
    <dl class="figs">
      <div><dt>Confidence</dt><dd>${Math.round(t.posterior * 100)}<small>%</small></dd><dd class="note">posterior probability today</dd></div>
      <div><dt>Expected sessions left</dt><dd>${t.expected_remaining == null ? '—' : num(t.expected_remaining)}</dd><dd class="note">1 / (1 − stay probability)<a href="#fn-memoryless" aria-label="Footnote">*</a></dd></div>
      <div><dt>Sessions so far</dt><dd>${num(t.days_in)}</dd><dd class="note">${s && s.median_run ? `median spell ${num(s.median_run)}` : '&nbsp;'}</dd></div>
      <div><dt>Confidence score</dt><dd>${num(score.value)}<small>/100</small></dd><dd class="note"><a href="#robustness">posterior × seed × refit stability</a></dd></div>
    </dl>
  </section>

  <section class="section" aria-labelledby="f1">
    <figure class="figure">
      <div class="fig-head"><span class="fig-label">Fig. 1</span><h2 class="fig-title" id="f1">Regime timeline over price</h2>
      <p class="fig-dek">Daily close on a log scale. Each band is the regime the model assigns to that day, decoded with hindsight over the full history.</p></div>
      <div class="fig-tools">
        <div class="seg" role="group" aria-label="Time range" id="range">${RANGES.map(([l], k) => `<button type="button" aria-pressed="${k === 3}" data-k="${k}">${l}</button>`).join('')}</div>
        <div class="legend">${REGIMES.map((n, k) => `<span>${sw(k)}${n}</span>`).join('')}</div>
      </div>
      <div class="fig-canvas" id="fig-timeline" aria-describedby="readout"><canvas></canvas></div>
      <p class="fig-readout" id="readout" aria-live="polite"></p>
    </figure>
    <figure class="figure" style="margin-top:22px">
      <div class="fig-head"><span class="fig-label">Fig. 2</span><h2 class="fig-title">Posterior ribbon</h2>
      <p class="fig-dek">How sure the model was, day by day: the probability of each regime, stacked to 100%. Thin, mixed stretches are where it was undecided.</p></div>
      <div class="fig-canvas" id="fig-ribbon"><canvas></canvas></div>
      <div class="fig-foot"><span>Source: Yahoo Finance daily data; REGIME 4-state Gaussian HMM. Arrow keys move the cursor on either figure.</span><span>Data as of ${date(d.asof)}</span></div>
    </figure>
  </section>

  <section class="section grid-2">
    <div class="panel" id="p-stats"></div>
    <div class="panel" id="p-calendar"></div>
  </section>
  <section class="section" id="p-matrix"></section>
  <section class="section grid-2">
    <div class="panel" id="p-edge"></div>
    <div class="panel" id="p-crisis"></div>
  </section>
  <section class="section" id="robustness"></section>
  <section class="section" id="backtest"></section>
  <section class="section grid-2">
    <div class="panel" id="p-model"></div>
    <div class="panel" id="p-plain"></div>
  </section>
  <section class="section small" id="notes">
    <p id="fn-memoryless">* A hidden Markov model is memoryless: the expected time left in a regime is the same however long it has already lasted. The median spell is the historical counterpart.</p>
    <p style="margin-top:6px">Research, not investment advice. <a href="/methodology">How REGIME works</a>.</p>
  </section>`;
  page.setAttribute('aria-busy', 'false');
  page.classList.add('fade-in');

  const view = { i0: 0, i1: d.n - 1 };
  const params = new URLSearchParams(location.search);
  const rk = RANGES.findIndex(([l]) => l.toLowerCase() === (params.get('range') || '').toLowerCase());
  if (rk >= 0) setRange(view, d, rk);
  const timeline = new Figure(document.getElementById('fig-timeline'), {
    height: w => (w < 560 ? 280 : 400), n: d.n, label: `Price and regime timeline for ${d.name}`,
    render: (ctx, w, h, P, c) => renderTimeline(ctx, w, h, P, c, d, view, events),
    indexAt: (g, px) => indexAtX(g, px), onCursor: () => {},
  });
  const ribbon = new Figure(document.getElementById('fig-ribbon'), {
    height: 120, n: d.n, label: `Posterior probability of each regime for ${d.name}`,
    render: (ctx, w, h, P, c) => renderRibbon(ctx, w, h, P, c, d, view),
    indexAt: (g, px) => indexAtX(g, px), onCursor: () => {},
  });
  const readout = document.getElementById('readout');
  const showReadout = i => {
    if (i < 0) { readout.textContent = `${date(d.asof)} · ${price(d.close[d.n - 1], isIndex)} · ${REGIMES[r]} ${frac(t.posterior)}`; return; }
    const p = d.post[i], vr = d.vit[i];
    readout.innerHTML = `${date(d.dates[i])} · ${price(d.close[i], isIndex)} · <b class="r${vr}">${REGIMES[vr]}</b> · ${SHORT.map((n, k) => `${n} ${frac(p[k])}`).join(' · ')}`;
  };
  const figs = [timeline, ribbon];
  let calendarFig = null;
  linkCursors(figs, i => {
    showReadout(i);
    calendarFig?.setCursor(i, 'link');
    const u = new URL(location.href);
    if (i >= 0) u.searchParams.set('at', d.dates[i]); else u.searchParams.delete('at');
    history.replaceState(null, '', u);
  });
  showReadout(-1);
  const at = params.get('at');
  if (at) { const i = nearestIndex(d.dates, at); ensureVisible(view, i, d); figs.forEach(f => f.setCursor(i, 'link')); showReadout(i); }

  document.querySelectorAll('#range button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#range button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    setRange(view, d, +b.dataset.k);
    const u = new URL(location.href);
    if (+b.dataset.k === 3) u.searchParams.delete('range'); else u.searchParams.set('range', RANGES[+b.dataset.k][0]);
    history.replaceState(null, '', u);
    figs.forEach(f => f.draw());
  }));

  const jumpTo = i => {
    ensureVisible(view, i, d);
    figs.forEach(f => f.draw());
    timeline.setCursor(i);
    document.getElementById('fig-timeline').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    document.getElementById('fig-timeline').focus({ preventScroll: true });
  };

  safe('p-stats', el => renderStats(el, d));
  safe('p-calendar', el => { calendarFig = renderCalendarPanel(el, d, i => jumpTo(i)); });
  safe('p-matrix', el => renderMatrix(el, d, jumpTo));
  safe('p-edge', el => renderEdge(el, d));
  safe('p-crisis', el => renderCrisisPanel(el, d));
  safe('robustness', el => renderRobustness(el, d));
  safe('backtest', el => renderBacktest(el, d));
  safe('p-model', el => renderModel(el, d));
  safe('p-plain', el => renderPlain(el, d));
}

function setRange(view, d, k) {
  const len = RANGES[k][1];
  view.i1 = d.n - 1;
  view.i0 = Math.max(0, d.n - Math.min(len, d.n));
}

function ensureVisible(view, i, d) {
  if (i < view.i0 || i > view.i1) { view.i0 = 0; view.i1 = d.n - 1; document.querySelectorAll('#range button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === 3))); }
}

function nearestIndex(dates, iso) {
  let lo = 0, hi = dates.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < iso) lo = mid + 1; else hi = mid; }
  return lo;
}

function runsOf(path) {
  const out = [];
  for (let i = 0; i < path.length;) {
    let j = i; while (j + 1 < path.length && path[j + 1] === path[i]) j++;
    out.push([i, j - i + 1, path[i]]); i = j + 1;
  }
  return out;
}

// ── Panels ─────────────────────────────────────────────────────────

function panelHead(label, title, dek) {
  return `<div class="fig-head"><span class="fig-label">${label}</span><h2 class="fig-title">${title}</h2>${dek ? `<p class="fig-dek">${dek}</p>` : ''}</div>`;
}

function renderStats(el, d) {
  const rows = d.stats.map((s, k) => `<tr${k === d.today.regime ? ' class="em"' : ''}>
      <td>${sw(k)}${REGIMES[k]}</td><td class="n">${pct(s.pct, 1)}</td>
      <td class="n">${s.avg_ret == null ? '—' : pct(s.avg_ret, 2, true)}</td><td class="n">${s.ann_vol == null ? '—' : pct(s.ann_vol, 0)}</td>
      <td class="n">${num(s.runs)}</td><td class="n">${s.median_run == null ? '—' : num(s.median_run)}</td></tr>`).join('');
  el.innerHTML = `${panelHead('Table 1', 'How each regime has behaved', 'Share of sessions, average daily log return and annualised volatility on days in each regime, and how long its spells last.')}
    <div class="table-scroll"><table class="table">
      <thead><tr><th>Regime</th><th class="n">Time</th><th class="n">Avg day</th><th class="n">Vol (ann.)</th><th class="n">Spells</th><th class="n">Median spell</th></tr></thead>
      <tbody>${rows}</tbody>
      <caption>Spell lengths in sessions. Full-history labels.</caption>
    </table></div>`;
}

function renderCalendarPanel(el, d, onPick) {
  const years = calendarLayout(d.dates);
  el.innerHTML = `${panelHead('Fig. 3', 'Regime calendar', 'Every session since the start of the data, one row per year. Fainter cells are days the model was less sure of.')}
    <div class="fig-canvas" id="fig-cal"><canvas></canvas></div><p class="fig-readout" id="cal-readout"></p>`;
  const out = document.getElementById('cal-readout');
  const fig = new Figure(document.getElementById('fig-cal'), {
    height: calendarHeight(years), n: d.n, label: `Regime calendar for ${d.name}`,
    render: (ctx, w, h, P, c) => renderCalendar(ctx, w, h, P, c, d, years),
    indexAt: calendarIndexAt,
    onCursor: i => { out.textContent = i < 0 ? '' : `${date(d.dates[i])} · ${REGIMES[d.vit[i]]} · ${frac(d.post[i][d.vit[i]])}`; },
  });
  document.getElementById('fig-cal').addEventListener('click', () => { if (fig.cursor >= 0) onPick(fig.cursor); });
  document.getElementById('fig-cal').addEventListener('keydown', e => { if (e.key === 'Enter' && fig.cursor >= 0) onPick(fig.cursor); });
  return fig;
}

function switches(d, from, to) {
  const out = [];
  for (let i = 1; i < d.n; i++) if (d.vit[i - 1] === from && d.vit[i] === to) out.push(i);
  return out;
}

function renderMatrix(el, d, jumpTo) {
  const T = d.model.transmat;
  const counts = T.map((row, i) => row.map((_, j) => (i === j ? d.stats[i].runs : switches(d, i, j).length)));
  el.innerHTML = `${panelHead('Fig. 4', 'Transition explorer', 'The fitted probability of moving from one regime (row) to another (column) on the next session. Select a cell to see every time it happened.')}
    <div class="grid-2">
      <div>
        <table class="matrix">
          <caption class="visually-hidden">Probability of moving from the row regime to the column regime on the next session</caption>
          <thead><tr><th scope="col">From ↓ To →</th>${SHORT.map((n, j) => `<th scope="col">${sw(j)}${n}</th>`).join('')}</tr></thead>
          <tbody>${T.map((row, i) => `<tr><th scope="row">${sw(i)}${SHORT[i]}</th>${row.map((p, j) => {
            const alpha = Math.min(1, .08 + Math.sqrt(p) * .9);
            return `<td><button type="button" data-i="${i}" data-j="${j}" aria-pressed="false"
              aria-label="${SHORT[i]} to ${SHORT[j]}: ${(p * 100).toFixed(1)}% per session, ${counts[i][j]} ${i === j ? 'spells' : 'switches'} in the data"
              style="background:color-mix(in srgb, var(--${['bull', 'accum', 'bear', 'crisis'][j]}) ${Math.round(alpha * 100)}%, var(--paper));color:${alpha > .55 ? 'var(--paper)' : 'var(--ink)'}">${(p * 100).toFixed(p < .1 ? 1 : 0)}%</button></td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table>
        <p class="matrix-axis">Diagonal: chance of staying put. The expected spell length is 1 ÷ (1 − diagonal).</p>
      </div>
      <div class="examples" id="examples" aria-live="polite"><p class="small">Select a cell to list its historical examples.</p></div>
    </div>`;
  const cells = [...el.querySelectorAll('.matrix button')];
  const pick = btn => {
    cells.forEach(c => c.setAttribute('aria-pressed', String(c === btn)));
    const i = +btn.dataset.i, j = +btn.dataset.j;
    const box = document.getElementById('examples');
    let list;
    if (i === j) {
      list = d.vitRuns.filter(r => r[2] === i).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, len]) => ({ at: s, note: `${num(len)} sessions` }));
    } else {
      list = switches(d, i, j).reverse().slice(0, 12).map(at => ({ at, note: '' }));
    }
    if (!list.length) { box.innerHTML = `<p class="small">${SHORT[i]} → ${SHORT[j]} never happened in this stock's history.</p>`; return; }
    box.innerHTML = `<p class="kicker">${i === j ? `Longest ${SHORT[i].toLowerCase()} spells` : `${SHORT[i]} → ${SHORT[j]}, most recent first`}</p>
      <ol style="margin-top:12px">${list.map(x => `<li><button type="button" data-at="${x.at}"><canvas width="150" height="44" aria-hidden="true"></canvas>
      <span class="d">${date(d.dates[x.at])}</span>${x.note ? `<span class="d muted">${x.note}</span>` : ''}</button></li>`).join('')}</ol>
      <p class="small" style="margin-top:10px">${i === j ? 'Each sparkline is the 40 sessions around the start of the spell.' : 'Each sparkline is the 40 sessions around the switch, marked.'} Select one to find it on Fig. 1.</p>`;
    const P = palette();
    box.querySelectorAll('li button').forEach(b => {
      const cv = b.querySelector('canvas');
      const ctx = sizeCanvas(cv, cv.parentElement.clientWidth || 150, 44);
      renderSpark(ctx, cv.parentElement.clientWidth || 150, 44, P, d.close, +b.dataset.at, 20, 20, P.regime[j]);
      b.addEventListener('click', () => jumpTo(+b.dataset.at));
    });
  };
  cells.forEach((c, k) => {
    c.addEventListener('click', () => pick(c));
    c.addEventListener('keydown', e => {
      const map = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 };
      if (e.key in map) { e.preventDefault(); cells[(k + map[e.key] + 16) % 16].focus(); }
    });
  });
  const start = cells[d.today.regime * 4 + d.today.regime];
  if (start) pick(start);
}

function renderEdge(el, d) {
  const fe = d.forward_edge;
  const hs = Object.keys(fe).sort((a, b) => a - b);
  el.innerHTML = `${panelHead('Table 2', 'What came next', `Average return over the following ${hs.join(' and ')} sessions, by the regime on the day. The test of whether a label predicts anything.`)}
    <div class="table-scroll"><table class="table">
      <thead><tr><th>Regime today</th>${hs.map(h => `<th class="n">Next ${h}d</th><th class="n">Up</th>`).join('')}<th class="n">Days</th></tr></thead>
      <tbody>${SHORT.map((n, k) => `<tr><td>${sw(k)}${n}</td>${hs.map(h => { const v = fe[h][k]; return v ? `<td class="n">${pct(v.mean, 2, true)}</td><td class="n">${pct(v.win_rate, 0)}</td>` : '<td class="n">—</td><td class="n">—</td>'; }).join('')}<td class="n">${fe[hs[0]][k] ? num(fe[hs[0]][k].samples) : '—'}</td></tr>`).join('')}</tbody>
      <caption>In-sample: regimes decoded with hindsight, so treat this as description, not a forecast.</caption>
    </table></div>`;
}

function renderCrisisPanel(el, d) {
  const cw = d.crisis_warning;
  el.innerHTML = `${panelHead('Fig. 5', 'Crisis early warning', `Today's regime probabilities pushed forward through the transition matrix: the chance of being in Crisis on each of the next ${cw.horizon} sessions.`)}
    <p class="small">Now <b class="num">${pct(cw.current, 1)}</b> · in ${cw.horizon} sessions <b class="num">${pct(cw.projected, 1)}</b> · peak <b class="num">${pct(cw.peak, 1)}</b></p>
    <div class="fig-canvas" id="fig-crisis" style="margin-top:8px"><canvas></canvas></div>`;
  new Figure(document.getElementById('fig-crisis'), { height: 130, label: `Projected probability of Crisis over the next ${cw.horizon} sessions, from ${pct(cw.current, 1)} to ${pct(cw.projected, 1)}`, render: (ctx, w, h, P) => renderCrisis(ctx, w, h, P, -1, cw) }).draw();
}

function bar(label, v, note) {
  return `<div class="bar-row"><span>${label}</span><span class="bar-track"><span class="bar-fill" style="width:${v == null ? 0 : Math.round(v * 100)}%"></span></span><span class="num" style="text-align:right">${v == null ? 'n/a' : frac(v, 0)}</span></div>${note ? `<p class="small" style="margin:-2px 0 6px">${note}</p>` : ''}`;
}

function renderRobustness(el, d) {
  const rb = d.robustness, c = rb.score.components;
  const prefers = rb.bic.best;
  el.innerHTML = `${panelHead('Fig. 6', 'Robustness, shown', 'Whether these labels are a property of the data or of one lucky fit.')}
    <div class="grid-2">
      <div>
        <p class="kicker">Confidence score</p>
        <p style="font:400 44px/1.1 var(--mono);margin:6px 0 14px">${num(rb.score.value)}<small style="font-size:16px;color:var(--ink-3)">/100</small></p>
        <div class="bars">
          ${bar("Today's posterior", c.posterior)}
          ${bar('Seed stability', c.seeds, `Agreement of ${rb.seeds.n - 1} other random starts with the winning fit, day by day.`)}
          ${bar('Refit stability', c.refits, c.refits == null ? 'Needs three or more years of history.' : `Agreement of ${rb.refits.n} walk-forward refits, each on a shorter history, with today's labels.`)}
        </div>
        <p class="small" style="margin-top:12px">Score = 100 × geometric mean of the three. One weak part pulls it down hard.</p>
      </div>
      <div>
        <p class="kicker">Number of states preferred by BIC</p>
        <div class="fig-canvas" id="fig-bic" style="margin-top:10px"><canvas></canvas></div>
        <p class="small" style="margin-top:8px">${prefers === 4 ? 'BIC agrees with four states for this ticker.' : `BIC would choose ${prefers} states here. REGIME keeps four everywhere so a regime means the same thing on every page; the five features are autocorrelated, which tends to push BIC towards more states.`}</p>
      </div>
    </div>`;
  new Figure(document.getElementById('fig-bic'), { height: 150, label: `BIC by number of states; lowest at ${rb.bic.best}`, render: (ctx, w, h, P) => renderBic(ctx, w, h, P, -1, rb.bic) }).draw();
}

function renderBacktest(el, d) {
  const has = { oos: !!d.bt.oos, is: !!d.bt.is };
  let mode = has.oos ? 'oos' : 'is';
  el.innerHTML = `${panelHead('Fig. 7', 'Backtest: regime rotation', 'Fully invested in Bullish, half in Accumulation, cash in Bearish and Crisis. Signals at the close are filled at the next open, and every switch pays Zerodha delivery charges plus slippage.')}
    <div class="fig-tools"><div class="seg" role="group" aria-label="Backtest view" id="bt-mode">
      <button type="button" data-m="oos" aria-pressed="${mode === 'oos'}" ${has.oos ? '' : 'disabled'}>Walk-forward (out of sample)</button>
      <button type="button" data-m="is" aria-pressed="${mode === 'is'}">In-sample</button></div></div>
    ${has.oos ? '' : '<p class="notice">Walk-forward needs at least three years of history; this ticker has less, so only the in-sample view is available.</p>'}
    <p class="dek" id="bt-sentence" style="margin-bottom:14px"></p>
    <div class="fig-canvas" id="fig-bt"><canvas></canvas></div>
    <p class="fig-readout" id="bt-readout"></p>
    <div class="grid-2" style="margin-top:20px">
      <div class="table-scroll" id="bt-metrics"></div>
      <div><div class="table-scroll" id="bt-stats"></div><div class="table-scroll" id="bt-costs" style="margin-top:20px"></div></div>
    </div>`;
  const out = document.getElementById('bt-readout');
  let bt = d.bt[mode];
  const fig = new Figure(document.getElementById('fig-bt'), {
    height: w => (w < 560 ? 260 : 320), n: bt.idx.length, label: `Backtest equity curves for ${d.name}`,
    render: (ctx, w, h, P, c) => renderEquity(ctx, w, h, P, c, bt, d.dates),
    indexAt: (g, px) => Math.max(0, Math.min(g.i1, Math.round(g.x.invert(px)))),
    onCursor: k => { out.textContent = k < 0 ? '' : `${date(d.dates[bt.idx[k]])} · strategy ₹${bt.strategy[k].toFixed(2)} · buy & hold ₹${bt.benchmark[k].toFixed(2)} per ₹1`; },
  });
  const fill = () => {
    const m = bt.metrics, s = m.strategy, b = m.benchmark;
    document.getElementById('bt-sentence').textContent = backtestSentence(bt, mode === 'oos');
    const rows = [['CAGR', s.cagr, b.cagr, v => pct(v, 1, true)], ['Total return', s.total_return, b.total_return, v => pct(v, 0, true)],
      ['Volatility', s.volatility, b.volatility, v => pct(v, 1)], ['Sharpe', s.sharpe, b.sharpe, v => signedNum(v, 2)],
      ['Sortino', s.sortino, b.sortino, v => signedNum(v, 2)], ['Max drawdown', s.max_drawdown, b.max_drawdown, v => pct(v, 1)],
      ['Calmar', s.calmar, b.calmar, v => signedNum(v, 2)], ['Daily VaR 95%', s.var_95, b.var_95, v => pct(v, 2)], ['Daily CVaR 95%', s.cvar_95, b.cvar_95, v => pct(v, 2)]];
    document.getElementById('bt-metrics').innerHTML = `<table class="table"><thead><tr><th></th><th class="n">Strategy</th><th class="n">Buy &amp; hold</th></tr></thead>
      <tbody>${rows.map(([l, a, c, f]) => `<tr><td>${l}</td><td class="n">${f(a)}</td><td class="n">${f(c)}</td></tr>`).join('')}</tbody>
      <caption>${num(m.years, 1)} years from ${date(bt.start)}. ${num(m.trades)} rebalances, ${pct(m.time_in_market, 0)} average exposure.</caption></table>`;
    document.getElementById('bt-stats').innerHTML = `<table class="table"><thead><tr><th>Overfitting check</th><th class="n">Value</th></tr></thead><tbody>
      <tr><td>Deflated Sharpe ratio</td><td class="n">${frac(m.dsr, 0)}</td></tr>
      <tr><td>P(Sharpe beats buy &amp; hold)</td><td class="n">${frac(m.psr_vs_buy_hold, 0)}</td></tr>
      <tr><td>Variants tested</td><td class="n">${m.n_trials}</td></tr></tbody>
      <caption>Deflated Sharpe: probability the Sharpe ratio is above what the best of ${m.n_trials} unskilled variants would show by luck. The second row is the probabilistic Sharpe ratio with buy-and-hold's Sharpe as the bar.</caption></table>`;
    const cd = m.cost_drag_pct_per_year;
    const names = { stt: 'Securities transaction tax', exchange: 'Exchange transaction charge', sebi: 'SEBI turnover fee', stamp: 'Stamp duty (buys)', gst: 'GST on charges', dp: 'Depository charge (sells)', slippage: 'Slippage (assumed)' };
    document.getElementById('bt-costs').innerHTML = `<table class="table"><thead><tr><th>Cost, % of capital a year</th><th class="n">Drag</th></tr></thead><tbody>
      ${Object.keys(names).map(k => `<tr><td>${names[k]}</td><td class="n">${pct(cd[k], 3)}</td></tr>`).join('')}
      <tr class="em"><td>Total</td><td class="n">${pct(cd.total, 2)}</td></tr></tbody>
      <caption>Zerodha equity-delivery schedule${d.cap === 'I' ? ', applied to an index-ETF proxy' : ''}; ₹10 lakh notional for the flat depository charge.</caption></table>`;
  };
  fill();
  el.querySelectorAll('#bt-mode button').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    mode = b.dataset.m; bt = d.bt[mode];
    el.querySelectorAll('#bt-mode button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    fig.n = bt.idx.length; fig.cursor = -1; out.textContent = '';
    fill(); fig.draw();
  }));
}

function renderModel(el, d) {
  const m = d.model, mu = m.scaler_mean, sc = m.scaler_scale;
  const ret = k => (m.means[k][0] * sc[0] + mu[0]) * 100;
  const vol = k => (m.means[k][2] * sc[2] + mu[2]) * Math.sqrt(252) * 100;
  const g = d.diagnostics;
  el.innerHTML = `${panelHead('Table 3', 'The fitted model', 'Each hidden state is a Gaussian over five daily features. The labels come from these centres: highest volatility is Crisis, the quietest is Accumulation, and the remaining two split by drift.')}
    <div class="table-scroll"><table class="table"><thead><tr><th>State</th><th class="n">Mean day</th><th class="n">20d vol (ann.)</th><th class="n">Stay</th><th class="n">Exp. spell</th></tr></thead>
    <tbody>${SHORT.map((n, k) => `<tr><td>${sw(k)}${n}</td><td class="n">${pct(ret(k), 2, true)}</td><td class="n">${pct(vol(k), 0)}</td><td class="n">${frac(m.transmat[k][k], 1)}</td><td class="n">${num(1 / (1 - m.transmat[k][k]))}</td></tr>`).join('')}</tbody>
    <caption>Log-likelihood ${num(g.log_likelihood)} · AIC ${num(g.aic)} · BIC ${num(g.bic)} · ${g.n_params} parameters · ${num(g.n_samples)} sessions.</caption></table></div>`;
}

function renderPlain(el, d) {
  el.innerHTML = `${panelHead('Guide', 'The four regimes, in plain English', '')}
    <dl>${PLAIN.map((p, k) => `<div style="border-top:1px solid var(--rule);padding:10px 0"><dt style="font-weight:500">${sw(k)}${p.name}</dt>
      <dd class="small" style="margin-top:3px">${p.body} ${esc(regimeCharacter(d, k))}</dd></div>`).join('')}</dl>`;
}
