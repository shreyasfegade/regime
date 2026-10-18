/* REGIME — "How an HMM sees the market". A scrolling explainer: on wide
   screens one sticky figure follows the step being read; on narrow screens,
   or with reduced motion, each step carries its own static figure. The
   filtering step re-runs the forward algorithm in the browser. */

import { DataError, loadEvents, loadExplainer } from './data.js';
import { REGIMES, SHORT } from './decode.js';
import { argmaxPath, forwardFilter, scaleSwitching } from './hmm.js';
import { prepare, runsOf, STEPS } from './explainer.js';
import { Figure, reducedMotion } from './figure.js';
import { date, frac, num, pct } from './format.js';
import { initShell } from './shell.js';

const CAPTIONS = [
  ['Ten years of the NIFTY 50', 'Daily close, log scale. One line; no regimes yet.'],
  ['The same years, with volatility', 'Annualised 20-day volatility of daily returns, under the price. Calm and storm alternate; the dashed line is the ten-year average.'],
  ['What the model actually sees', 'The five daily features, standardised, over the last three years. Each day is one point in five dimensions.'],
  ['Four hidden states', 'Every day plotted by its volatility and return, coloured by the state the model assigns. Each ellipse covers about 95% of its state\'s days in these two features.'],
  ['How states follow one another', 'The fitted transition matrix. Arrow weight is the chance of switching on the next session; the circle says how often a state persists.'],
  ['Filtering, one day at a time', 'Bands: the most likely state using only data up to each day. Ribbon: the full probability of each state. Drag the controls to change the model.'],
  ['Hindsight versus live', 'The last three years. Top strip: the live, filtered call each day. Bottom strip: the Viterbi path, decoded with the whole history in view.'],
];

const S = { cursor: -1, events: [], scale: 1 };
let stageFig = null, inlineFigs = [];

initShell();
boot();

async function boot() {
  let ex, events;
  try {
    [ex, events] = await Promise.all([loadExplainer(), loadEvents()]);
  } catch (err) {
    const slot = document.getElementById('how-status');
    slot.hidden = false;
    slot.innerHTML = `<b>The figures couldn't load.</b> ${err instanceof DataError && err.kind === 'network' ? 'Check your connection and reload; the text below reads on its own.' : 'The explainer data is missing or unreadable; the text below reads on its own.'}`;
    return;
  }
  Object.assign(S, prepare(ex));
  S.events = (events.events || []).map(e => ({ ...e, i: S.dates.findIndex(d => d >= e.date) })).filter(e => e.i > 0);
  refilter();
  fillNumbers();
  const inline = reducedMotion() || matchMedia('(max-width: 899px)').matches;
  document.body.classList.toggle('how-inline', inline);
  if (inline) mountInline(); else mountStage();
  mountControls();
}

function refilter() {
  const T = scaleSwitching(S.ex.transmat, S.scale);
  S.transmat = T;
  S.filt = forwardFilter(S.xs, T, S.ex.means, S.ex.covars);
  const { path, switches } = argmaxPath(S.filt);
  S.filtPath = path; S.filtRuns = runsOf(path); S.switches = switches;
}

function agreement(a, b, from = 0) {
  let same = 0;
  for (let i = from; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / (a.length - from);
}

function fill(key, value) { document.querySelectorAll(`[data-fill="${key}"]`).forEach(el => { el.textContent = value; }); }

function fillNumbers() {
  const T = S.ex.transmat, years = S.n / 252;
  const mean = S.vol20.reduce((a, b) => a + b, 0) / S.n;
  fill('asof', date(S.ex.asof));
  fill('sessions', num(S.n));
  fill('start', date(S.dates[0]));
  fill('vol-mean', pct(mean, 0));
  fill('vol-min', pct(Math.min(...S.vol20), 0));
  fill('vol-max', pct(Math.max(...S.vol20), 0));
  fill('stay-bull', frac(T[0][0], 1));
  fill('spell-bull', num(1 / (1 - T[0][0])));
  fill('stay-crisis', frac(T[3][3], 1));
  fill('spell-crisis', num(1 / (1 - T[3][3])));
  const tc = S.vit.reduce((a, r) => a + (r === 3), 0);
  fill('crisis-share', pct(100 * tc / S.n, 0));
  const fitted = argmaxPath(forwardFilter(S.xs, S.ex.transmat, S.ex.means, S.ex.covars));
  fill('switch-fitted', num(fitted.switches));
  fill('switch-year', num(fitted.switches / years, 0));
  fill('vit-switches', num(runsOf(S.vit).length - 1));
  fill('agree', frac(agreement(fitted.path, S.vit), 0));
}

// ── Figures ────────────────────────────────────────────────────────

function heightFor(k, w) {
  if (k === 4) return Math.min(420, Math.max(300, w * .7));
  if (k === 3) return Math.min(440, Math.max(300, w * .72));
  return w < 560 ? 300 : 420;
}

function mountStage() {
  const stage = document.getElementById('stage');
  stage.hidden = false;
  const label = stage.querySelector('.fig-label'), title = stage.querySelector('.fig-title'), dek = stage.querySelector('.fig-dek');
  let active = 0;
  stageFig = new Figure(stage.querySelector('.fig-canvas'), {
    height: w => heightFor(active, w), n: S.n,
    render: (ctx, w, h, P) => STEPS[active](ctx, w, h, P, S),
  });
  const setStep = k => {
    active = k;
    label.textContent = `Fig. ${k + 1} of ${STEPS.length}`;
    title.textContent = CAPTIONS[k][0];
    dek.textContent = CAPTIONS[k][1];
    stageFig.canvas.setAttribute('aria-label', `${CAPTIONS[k][0]}. ${CAPTIONS[k][1]}`);
    document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i === k));
    stageFig.draw();
  };
  setStep(0);
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) setStep(+e.target.dataset.step);
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('.step[data-step]').forEach(s => io.observe(s));
}

function mountInline() {
  document.querySelectorAll('.step[data-step]').forEach(step => {
    const k = +step.dataset.step;
    const slot = step.querySelector('.step-fig');
    slot.hidden = false;
    slot.innerHTML = `<figure class="figure"><div class="fig-head"><span class="fig-label">Fig. ${k + 1}</span>
      <h3 class="fig-title">${CAPTIONS[k][0]}</h3><p class="fig-dek">${CAPTIONS[k][1]}</p></div>
      <div class="fig-canvas"><canvas></canvas></div></figure>`;
    const fig = new Figure(slot.querySelector('.fig-canvas'), {
      height: w => heightFor(k, w), label: `${CAPTIONS[k][0]}. ${CAPTIONS[k][1]}`,
      render: (ctx, w, h, P) => STEPS[k](ctx, w, h, P, S),
    });
    fig.step = k;
    inlineFigs.push(fig);
  });
}

function redraw() {
  stageFig?.draw();
  inlineFigs.forEach(f => { if (f.step >= 4) f.draw(); });
}

// ── Controls for the filtering step ────────────────────────────────

function mountControls() {
  const box = document.getElementById('controls');
  box.hidden = false;
  const sw = document.getElementById('c-switch'), swOut = document.getElementById('c-switch-out');
  const day = document.getElementById('c-day'), dayOut = document.getElementById('c-day-out');
  const belief = document.getElementById('c-belief');
  day.max = S.n - 1; day.value = S.n - 1;

  const showDay = () => {
    const i = +day.value, p = S.filt[i];
    S.cursor = i;
    dayOut.textContent = date(S.dates[i]);
    belief.innerHTML = [0, 1, 2, 3].map(k => `<div class="bar-row"><span>${SHORT[k]}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(p[k] * 100).toFixed(1)}%;background:var(--${['bull', 'accum', 'bear', 'crisis'][k]})"></span></span>
      <span class="num" style="text-align:right">${frac(p[k])}</span></div>`).join('');
    belief.setAttribute('aria-label', `On ${date(S.dates[i])} the model put ${[0, 1, 2, 3].map(k => `${frac(p[k])} on ${REGIMES[k]}`).join(', ')}`);
  };
  const showSwitch = () => {
    const f = 10 ** +sw.value;
    S.scale = f;
    refilter();
    swOut.textContent = Math.abs(+sw.value) < 1e-9 ? '×1, as fitted' : `×${f < 1 ? f.toFixed(2) : f.toFixed(1)} the fitted switching`;
    fill('switch-now', num(S.switches));
    fill('switch-now-year', num(S.switches / (S.n / 252), 0));
    fill('agree-now', frac(agreement(S.filtPath, S.vit), 0));
    showDay(); redraw();
  };
  sw.addEventListener('input', showSwitch);
  day.addEventListener('input', () => { showDay(); redraw(); });
  document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
    const i = b.dataset.jump === 'last' ? S.n - 1 : S.dates.findIndex(d => d >= b.dataset.jump);
    if (i >= 0) { day.value = i; showDay(); redraw(); }
  }));
  document.getElementById('c-reset').addEventListener('click', () => { sw.value = 0; showSwitch(); });
  showSwitch();
}

