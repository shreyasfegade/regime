/* REGIME — Fig. 1 regime timeline over price, Fig. 2 posterior ribbon.
   Both draw the same window [i0, i1] of sessions and share a cursor. */

import { hline, layoutLabels, linear, logScale, logTicks, regimeFill, text, timeTicks, vline } from './figure.js';
import { num, price } from './format.js';

const tick = (v, idx) => (idx ? '' : '₹') + num(v, v < 10 ? 1 : 0);

const PAD = { l: 4, r: 58, b: 26 };
const STRIP = 6;

function xScale(i0, i1, w) {
  return linear(i0, Math.max(i1, i0 + 1), PAD.l, w - PAD.r);
}

export function indexAtX(geom, px) {
  if (!geom) return -1;
  const i = Math.round(geom.x.invert(px));
  return Math.max(geom.i0, Math.min(geom.i1, i));
}

/** Fig. 1 — log-scale close over Viterbi regime bands, with event markers. */
export function renderTimeline(ctx, w, h, P, cursor, d, view, events) {
  const { i0, i1 } = view;
  const narrow = w < 560;
  const eventRows = narrow ? 1 : 2;
  const top = events.length ? 14 * eventRows + 10 : 10;
  const x = xScale(i0, i1, w);
  const yTop = top, yBot = h - PAD.b;

  let lo = Infinity, hi = -Infinity;
  for (let i = i0; i <= i1; i++) { const c = d.close[i]; if (c < lo) lo = c; if (c > hi) hi = c; }
  const padLog = (Math.log(hi) - Math.log(lo)) * .06 || .05;
  const y = logScale(Math.exp(Math.log(lo) - padLog), Math.exp(Math.log(hi) + padLog), yBot, yTop);

  // Regime bands.
  for (const [s, len, r] of d.vitRuns) {
    const a = Math.max(s, i0), b = Math.min(s + len - 1, i1);
    if (b < a) continue;
    const xa = a === i0 ? PAD.l : x(a - .5), xb = b === i1 ? w - PAD.r : x(b + .5);
    ctx.fillStyle = regimeFill(ctx, P, r);
    ctx.fillRect(xa, yTop, Math.max(xb - xa, 1), yBot - yTop);
    // A solid strip along the floor of the plot, so the regime reads at a glance.
    ctx.fillStyle = P.regime[r];
    ctx.fillRect(xa, yBot - STRIP, Math.max(xb - xa, 1), STRIP);
  }

  // Price gridlines and right-hand axis.
  for (const v of logTicks(y.invert(yBot), y.invert(yTop), narrow ? 4 : 5)) {
    const py = y(v);
    hline(ctx, PAD.l, w - PAD.r, py, P.rule);
    text(ctx, tick(v, d.cap === 'I'), w - PAD.r + 6, py + 4, { font: P.monoSmall, color: P.ink3 });
  }
  hline(ctx, PAD.l, w - PAD.r, yBot, P.ruleInk);
  for (const t of timeTicks(d.dates, i0, i1, w)) {
    const px = x(t.i);
    vline(ctx, px, yBot, yBot + 4, P.ruleInk);
    text(ctx, t.label, px, yBot + 16, { font: P.monoSmall, color: P.ink3, align: 'center' });
  }

  // Event annotations: hairline plus a label in the header rows.
  const evs = events.map(e => ({ ...e, x: x(e.i) })).filter(e => e.i >= i0 && e.i <= i1);
  const placed = layoutLabels(ctx, evs.map(e => ({ ...e, x: e.x - 2 })), P.sansSmall, eventRows);
  for (const e of placed) {
    vline(ctx, e.x + 2, 4 + e.row * 14 + 10, yBot, P.rule2, [2, 3]);
    text(ctx, e.label, e.x + 6, 4 + e.row * 14 + 9, { font: P.sansSmall, color: P.ink2 });
  }

  // Price line.
  ctx.save();
  ctx.beginPath();
  const step = Math.max(1, Math.floor((i1 - i0) / (w * 1.5)));
  for (let i = i0; i <= i1; i += step) { const px = x(i), py = y(d.close[i]); i === i0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
  ctx.lineTo(x(i1), y(d.close[i1]));
  ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();

  // Last value, labelled at the axis.
  const lx = x(i1), ly = y(d.close[i1]);
  ctx.fillStyle = P.ink; ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = P.ink; ctx.fillRect(w - PAD.r + 2, ly - 8, PAD.r - 2, 16);
  text(ctx, price(d.close[i1], d.cap === 'I'), w - PAD.r + 6, ly + 4, { font: P.monoSmall, color: P.paper });

  // Cursor.
  if (cursor >= i0 && cursor <= i1) {
    const cx = x(cursor), cy = y(d.close[cursor]);
    vline(ctx, cx, yTop, yBot, P.ink);
    ctx.fillStyle = P.paper; ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  return { x, i0, i1 };
}

/** Fig. 2 — posterior probability of each regime, stacked to 100%. */
export function renderRibbon(ctx, w, h, P, cursor, d, view) {
  const { i0, i1 } = view;
  const x = xScale(i0, i1, w);
  const yTop = 4, yBot = h - 20;
  const ih = yBot - yTop;
  const px0 = Math.floor(x(i0)), px1 = Math.ceil(x(i1));
  // One column per device-independent pixel: average the days it covers.
  const ORDER = [0, 1, 2, 3];
  for (let px = px0; px < px1; px++) {
    const a = Math.max(i0, Math.floor(x.invert(px))), b = Math.min(i1, Math.max(a, Math.floor(x.invert(px + 1))));
    const avg = [0, 0, 0, 0];
    for (let i = a; i <= b; i++) for (let r = 0; r < 4; r++) avg[r] += d.post[i][r];
    let acc = 0;
    for (const r of ORDER) {
      const v = avg[r] / (b - a + 1);
      if (v <= 0) continue;
      ctx.fillStyle = P.regime[r];
      ctx.globalAlpha = r === 3 ? .9 : .78;
      ctx.fillRect(px, yBot - (acc + v) * ih, 1.02, v * ih);
      acc += v;
    }
  }
  ctx.globalAlpha = 1;
  for (const v of [0, .5, 1]) {
    const py = yBot - v * ih;
    hline(ctx, PAD.l, w - PAD.r, py, v === 0 ? P.ruleInk : P.rule);
    text(ctx, `${v * 100}%`, w - PAD.r + 6, py + 4, { font: P.monoSmall, color: P.ink3 });
  }
  for (const t of timeTicks(d.dates, i0, i1, w)) text(ctx, t.label, x(t.i), yBot + 14, { font: P.monoSmall, color: P.ink3, align: 'center' });
  if (cursor >= i0 && cursor <= i1) vline(ctx, x(cursor), yTop, yBot, P.ink);
  return { x, i0, i1 };
}
