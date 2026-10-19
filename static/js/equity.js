/* REGIME — backtest figure: growth of ₹1 for the rotation strategy against
   buy-and-hold, with the strategy's drawdown underneath. */

import { hline, linear, logScale, logTicks, text, timeTicks, vline } from './figure.js';
import { pct } from './format.js';

const PAD = { l: 4, r: 58, t: 22, b: 24 };

export function renderEquity(ctx, w, h, P, cursor, bt, dates) {
  const n = bt.idx.length;
  const ddH = Math.round(h * .22);
  const yTop = PAD.t, yBot = h - PAD.b - ddH - 14;
  const x = linear(0, n - 1, PAD.l, w - PAD.r);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < n; k++) for (const v of [bt.strategy[k], bt.benchmark[k]]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const y = logScale(lo * .95, hi * 1.05, yBot, yTop);

  for (const v of logTicks(lo * .95, hi * 1.05, 4)) {
    hline(ctx, PAD.l, w - PAD.r, y(v), v === 1 ? P.rule2 : P.rule);
    text(ctx, `₹${v < 10 ? v.toFixed(v < 1 ? 2 : 1) : v.toFixed(0)}`, w - PAD.r + 6, y(v) + 4, { font: P.monoSmall, color: P.ink3 });
  }
  const sDates = bt.idx.map(i => dates[i]);
  for (const t of timeTicks(sDates, 0, n - 1, w)) text(ctx, t.label, x(t.i), h - 8, { font: P.monoSmall, color: P.ink3, align: 'center' });

  const line = (arr, color, width, dash) => {
    ctx.save(); ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    arr.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
    ctx.stroke(); ctx.restore();
  };
  line(bt.benchmark, P.ink3, 1.25, [4, 3]);
  line(bt.strategy, P.ink, 1.75);

  // Direct labels at the line ends.
  const ends = [
    { v: bt.strategy[n - 1], label: 'Strategy', color: P.ink },
    { v: bt.benchmark[n - 1], label: 'Buy & hold', color: P.ink2 },
  ].sort((a, b) => b.v - a.v);
  let lastY = -Infinity;
  for (const e of ends) {
    let ly = y(e.v) - 6;
    if (ly - lastY < 13) ly = lastY + 13;
    lastY = ly;
    text(ctx, e.label, w - PAD.r - 4, ly, { font: P.sansSmall, color: e.color, align: 'right' });
  }

  // Drawdown panel.
  const d0 = yBot + 14, d1 = d0 + ddH;
  let peak = 0, minDd = 0;
  const dd = bt.strategy.map(v => { peak = Math.max(peak, v); const z = v / peak - 1; minDd = Math.min(minDd, z); return z; });
  const yd = linear(Math.min(minDd, -.05), 0, d1, d0);
  ctx.beginPath(); ctx.moveTo(x(0), yd(0));
  dd.forEach((z, k) => ctx.lineTo(x(k), yd(z)));
  ctx.lineTo(x(n - 1), yd(0)); ctx.closePath();
  ctx.fillStyle = P.rule2; ctx.fill();
  hline(ctx, PAD.l, w - PAD.r, yd(0), P.ruleInk);
  text(ctx, '0%', w - PAD.r + 6, yd(0) + 4, { font: P.monoSmall, color: P.ink3 });
  text(ctx, pct(minDd * 100, 0), w - PAD.r + 6, yd(minDd) + 4, { font: P.monoSmall, color: P.ink3 });
  text(ctx, 'Strategy drawdown', PAD.l + 2, d0 + 11, { font: P.sansSmall, color: P.ink3 });

  if (cursor >= 0 && cursor < n) {
    vline(ctx, x(cursor), yTop, d1, P.ink);
    for (const [arr, c] of [[bt.strategy, P.ink], [bt.benchmark, P.ink3]]) {
      ctx.fillStyle = P.paper; ctx.strokeStyle = c; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x(cursor), y(arr[cursor]), 3, 0, 7); ctx.fill(); ctx.stroke();
    }
  }
  return { x, i0: 0, i1: n - 1, dd };
}
