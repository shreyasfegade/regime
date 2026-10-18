/* REGIME — figures for "How an HMM sees the market". Each step of the
   explainer has one renderer; all of them draw real NIFTY 50 data from
   explainer.json, prepared once by prepare(). */

import { decodeDates, decodeLogSeries, decodeRuns, SHORT, unb64 } from './decode.js';
import { hline, linear, text, vline } from './figure.js';
import { pct } from './format.js';
import { renderRibbon, renderTimeline } from './timeline.js';

const SQRT252 = Math.sqrt(252);
export const FEATURE_NAMES = ['Daily log return', '5-day volatility', '20-day volatility', 'Volume z-score', '10-day momentum'];

export function runsOf(path) {
  const out = [];
  for (let i = 0; i < path.length;) {
    let j = i; while (j + 1 < path.length && path[j + 1] === path[i]) j++;
    out.push([i, j - i + 1, path[i]]); i = j + 1;
  }
  return out;
}

/** Decode explainer.json into arrays the figures use. */
export function prepare(ex) {
  const dates = decodeDates(ex.dates);
  const close = decodeLogSeries(ex.px);
  const cols = ex.x.map(c => unb64(c, 'int16'));
  const xs = Array.from({ length: ex.n }, (_, t) => cols.map(c => c[t] / ex.x_scale));
  const vit = decodeRuns(ex.vit, ex.n);
  const real = (j, z) => z * ex.scaler_scale[j] + ex.scaler_mean[j];
  const vol20 = xs.map(x => real(2, x[2]) * SQRT252 * 100);
  const ret = xs.map(x => real(0, x[0]) * 100);
  return { ex, n: ex.n, dates, close, xs, vit, vitRuns: runsOf(vit), vol20, ret, real, cap: 'I' };
}

// ── Step 1–2: price, then price and volatility ──────────────────────

export function drawPrice(ctx, w, h, P, S) {
  renderTimeline(ctx, w, h, P, -1, { ...S, vitRuns: [] }, { i0: 0, i1: S.n - 1 }, S.events);
}

export function drawVol(ctx, w, h, P, S) {
  const h1 = Math.round(h * .56);
  renderTimeline(ctx, w, h1, P, -1, { ...S, vitRuns: [] }, { i0: 0, i1: S.n - 1 }, S.events);
  ctx.save(); ctx.translate(0, h1 + 14);
  const hh = h - h1 - 14, pad = { l: 4, r: 58, t: 16, b: 22 };
  const x = linear(0, S.n - 1, pad.l, w - pad.r);
  const max = Math.ceil(Math.max(...S.vol20) / 10) * 10;
  const y = linear(0, max, hh - pad.b, pad.t);
  text(ctx, '20-day volatility, annualised', pad.l, 10, { font: P.sansSmall, color: P.ink2 });
  for (const v of [0, max / 2, max]) {
    hline(ctx, pad.l, w - pad.r, y(v), v ? P.rule : P.ruleInk);
    text(ctx, `${v}%`, w - pad.r + 6, y(v) + 4, { font: P.monoSmall, color: P.ink3 });
  }
  const mean = S.vol20.reduce((a, b) => a + b, 0) / S.n;
  hline(ctx, pad.l, w - pad.r, y(mean), P.ink2, [4, 3]);
  text(ctx, `average ${Math.round(mean)}%`, pad.l + 4, y(mean) - 5, { font: P.monoSmall, color: P.ink2 });
  ctx.beginPath();
  S.vol20.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = P.ink; ctx.lineWidth = 1.25; ctx.stroke();
  ctx.restore();
}

// ── Step 3: the five features ───────────────────────────────────────

export function drawFeatures(ctx, w, h, P, S) {
  const n = S.n, i0 = Math.max(0, n - 750);
  const rows = 5, gap = 8, rh = (h - 22 - gap * (rows - 1)) / rows;
  const pad = { l: 4, r: 58 };
  const x = linear(i0, n - 1, pad.l, w - pad.r);
  for (let j = 0; j < rows; j++) {
    const top = j * (rh + gap);
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i < n; i++) { const v = S.xs[i][j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    lo = Math.max(lo, -4); hi = Math.min(hi, 4);
    const y = linear(lo, hi, top + rh, top + 12);
    hline(ctx, pad.l, w - pad.r, y(Math.max(lo, Math.min(hi, 0))), P.rule2);
    text(ctx, FEATURE_NAMES[j], pad.l, top + 9, { font: P.sansSmall, color: P.ink2 });
    text(ctx, '0σ', w - pad.r + 6, y(Math.max(lo, Math.min(hi, 0))) + 4, { font: P.monoSmall, color: P.ink3 });
    ctx.beginPath();
    for (let i = i0; i < n; i++) {
      const v = Math.max(lo, Math.min(hi, S.xs[i][j]));
      i === i0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v));
    }
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1; ctx.stroke();
  }
  const yr = d => d.slice(0, 4);
  let last = null;
  for (let i = i0; i < n; i++) {
    if (yr(S.dates[i]) !== last && last !== null) text(ctx, yr(S.dates[i]), x(i), h - 4, { font: P.monoSmall, color: P.ink3, align: 'center' });
    last = yr(S.dates[i]);
  }
}

// ── Step 4: four Gaussians ──────────────────────────────────────────

function quantile(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(q * (s.length - 1))];
}

/** Points on the k-sigma ellipse of a 2-D Gaussian (mean m, covariance c). */
export function ellipse(m, c, k = 2, steps = 72) {
  const [a, b, d] = [c[0][0], c[0][1], c[1][1]];
  const tr = a + d, det = a * d - b * b, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  const ang = Math.abs(b) < 1e-12 ? (a >= d ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b);
  const out = [];
  for (let s = 0; s <= steps; s++) {
    const t = (s / steps) * Math.PI * 2;
    const u = k * Math.sqrt(l1) * Math.cos(t), v = k * Math.sqrt(l2) * Math.sin(t);
    out.push([m[0] + u * Math.cos(ang) - v * Math.sin(ang), m[1] + u * Math.sin(ang) + v * Math.cos(ang)]);
  }
  return out;
}

export function drawStates(ctx, w, h, P, S) {
  const { ex } = S;
  const pad = { l: 44, r: 14, t: 14, b: 34 };
  const vx = S.vol20, ry = S.ret;
  const x = linear(0, Math.ceil(quantile(vx, .99) / 10) * 10, pad.l, w - pad.r);
  const yLim = Math.max(Math.abs(quantile(ry, .005)), quantile(ry, .995));
  const y = linear(-yLim, yLim, h - pad.b, pad.t);
  for (const v of [-yLim, -yLim / 2, 0, yLim / 2, yLim]) {
    hline(ctx, pad.l, w - pad.r, y(v), v === 0 ? P.rule2 : P.rule);
    text(ctx, pct(v, 1, true), pad.l - 6, y(v) + 4, { font: P.monoSmall, color: P.ink3, align: 'right' });
  }
  const xmax = x.invert(w - pad.r);
  for (let v = 0; v <= xmax; v += 10) {
    vline(ctx, x(v), h - pad.b, h - pad.b + 4, P.ruleInk);
    text(ctx, `${v}%`, x(v), h - pad.b + 16, { font: P.monoSmall, color: P.ink3, align: 'center' });
  }
  hline(ctx, pad.l, w - pad.r, h - pad.b, P.ruleInk);
  text(ctx, '20-day volatility, annualised →', w - pad.r, h - 4, { font: P.sansSmall, color: P.ink3, align: 'right' });
  text(ctx, '↑ return that day', pad.l + 4, pad.t + 2, { font: P.sansSmall, color: P.ink3 });

  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b); ctx.clip();
  for (let i = 0; i < S.n; i++) {
    ctx.fillStyle = P.regime[S.vit[i]]; ctx.globalAlpha = .32;
    ctx.fillRect(x(vx[i]) - 1, y(ry[i]) - 1, 2.2, 2.2);
  }
  ctx.globalAlpha = 1;
  // Each state's 2σ ellipse over (return, 20d vol), mapped from z-scores to real units.
  const toReal = ([zr, zv]) => [x(S.real(2, zv) * SQRT252 * 100), y(S.real(0, zr) * 100)];
  const tops = [];
  ex.means.forEach((mu, k) => {
    const c = ex.covars[k];
    const pts = ellipse([mu[0], mu[2]], [[c[0][0], c[0][2]], [c[2][0], c[2][2]]], 2).map(toReal);
    ctx.beginPath(); pts.forEach(([px, py], s) => (s ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.strokeStyle = P.regime[k]; ctx.lineWidth = 2; ctx.setLineDash(k === 3 ? [5, 3] : []); ctx.stroke(); ctx.setLineDash([]);
    const [cx, cy] = toReal([mu[0], mu[2]]);
    ctx.fillStyle = P.regime[k]; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 7); ctx.fill();
    // Label just above the ellipse's highest point (or at the centre if that is off the plot).
    const top = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
    tops.push(top[1] > pad.t + 16 ? [top[0], top[1] - 6] : [cx + 8, cy - 6]);
  });
  ctx.restore();
  ctx.font = P.mono;
  tops.forEach(([lx, ly], k) => {
    const label = SHORT[k], tw = ctx.measureText(label).width;
    const ax = Math.min(w - pad.r - tw, Math.max(pad.l + 2, lx - tw / 2));
    ctx.fillStyle = P.paper; ctx.globalAlpha = .85; ctx.fillRect(ax - 3, ly - 11, tw + 6, 15); ctx.globalAlpha = 1;
    text(ctx, label, ax, ly, { font: P.mono, color: P.regime[k] });
  });
}

// ── Step 5: transitions ─────────────────────────────────────────────

export function drawTransitions(ctx, w, h, P, S) {
  const T = S.transmat || S.ex.transmat;
  const r = Math.min(46, w / 9);
  // A diamond: Accumulation on top, Bullish left, Bearish right, Crisis at the bottom. The two
  // diagonals (Bullish–Bearish, Accumulation–Crisis) cross in the middle, and on the NIFTY 50 the
  // second carries no traffic, so no labels collide.
  const cx = [w * .18, w * .5, w * .82, w * .5], cy = [h * .5, r + 14, h * .5, h - r - 14];
  const arrow = (i, j) => {
    const p = T[i][j];
    if (p < 0.0015) return;
    const dx = cx[j] - cx[i], dy = cy[j] - cy[i], len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const off = 9;
    const x0 = cx[i] + ux * (r + 4) + nx * off, y0 = cy[i] + uy * (r + 4) + ny * off;
    const x1 = cx[j] - ux * (r + 10) + nx * off, y1 = cy[j] - uy * (r + 10) + ny * off;
    const lw = Math.max(1, Math.min(7, p * 160));
    ctx.strokeStyle = P.regime[j]; ctx.fillStyle = P.regime[j]; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1 + ux * 9, y1 + uy * 9);
    ctx.lineTo(x1 - nx * (4 + lw / 2), y1 - ny * (4 + lw / 2)); ctx.lineTo(x1 + nx * (4 + lw / 2), y1 + ny * (4 + lw / 2)); ctx.fill();
    const mx = (x0 + x1) / 2 + nx * 12, my = (y0 + y1) / 2 + ny * 12;
    const s = `${(p * 100).toFixed(1)}%`;
    ctx.font = P.monoSmall; const tw = ctx.measureText(s).width;
    ctx.fillStyle = P.paper; ctx.fillRect(mx - tw / 2 - 2, my - 8, tw + 4, 12);
    text(ctx, s, mx, my + 2, { font: P.monoSmall, color: P.ink2, align: 'center' });
  };
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) arrow(i, j);
  for (let k = 0; k < 4; k++) {
    ctx.beginPath(); ctx.arc(cx[k], cy[k], r, 0, Math.PI * 2);
    ctx.fillStyle = P.paper; ctx.fill();
    ctx.fillStyle = P.wash[k]; ctx.fill();
    ctx.strokeStyle = P.regime[k]; ctx.lineWidth = 2; ctx.setLineDash(k === 3 ? [5, 3] : []); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, SHORT[k], cx[k], cy[k] - 6, { font: P.sans, color: P.ink, align: 'center' });
    text(ctx, `stays ${(T[k][k] * 100).toFixed(1)}%`, cx[k], cy[k] + 9, { font: P.monoSmall, color: P.ink2, align: 'center' });
    text(ctx, `~${Math.round(1 / (1 - T[k][k]))} sessions`, cx[k], cy[k] + 22, { font: P.monoSmall, color: P.ink3, align: 'center' });
  }
}

// ── Step 6: filtering live ──────────────────────────────────────────

export function drawFilter(ctx, w, h, P, S) {
  const h1 = Math.round(h * .66);
  const view = { i0: 0, i1: S.n - 1 };
  renderTimeline(ctx, w, h1, P, S.cursor, { ...S, vitRuns: S.filtRuns }, view, S.events);
  ctx.save(); ctx.translate(0, h1 + 10);
  renderRibbon(ctx, w, h - h1 - 10, P, S.cursor, { dates: S.dates, post: S.filt }, view);
  ctx.restore();
}

// ── Step 7: hindsight versus live ───────────────────────────────────

export function drawHindsight(ctx, w, h, P, S) {
  const i0 = Math.max(0, S.n - 756), i1 = S.n - 1;
  const strip = 16, gap = 22, h1 = h - 2 * (strip + gap) - 8;
  renderTimeline(ctx, w, h1, P, -1, { ...S, vitRuns: [] }, { i0, i1 }, S.events);
  const x = linear(i0, i1, 4, w - 58);
  const rows = [['Live: most likely state each day, using only data up to that day', S.filtPath], ['Hindsight: Viterbi path over the full history', S.vit]];
  rows.forEach(([label, path], k) => {
    const top = h1 + 8 + k * (strip + gap) + gap - 6;
    text(ctx, label, 4, top - 5, { font: P.sansSmall, color: P.ink2 });
    for (let i = i0; i <= i1; i++) {
      ctx.fillStyle = P.regime[path[i]];
      ctx.fillRect(x(i - .5), top, Math.max(1, x(i + .5) - x(i - .5)) + .3, strip);
    }
  });
}

export const STEPS = [drawPrice, drawVol, drawFeatures, drawStates, drawTransitions, drawFilter, drawHindsight];
