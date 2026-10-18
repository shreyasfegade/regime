/* REGIME — market breadth: the weekly share of stocks in each regime,
   drawn as a 100% stacked area. Crisis sits on the baseline and Bearish on
   top of it, so the risk-off share reads straight off the axis. */

import { hline, layoutLabels, linear, regimeFill, text, timeTicks, vline } from './figure.js';

// Bottom to top.
export const STACK = [3, 2, 1, 0];
const PAD = { l: 4, r: 92, b: 26 };

/** Weekly counts [regime][week] → shares per week, [{total, share[4]}]. */
export function shares(counts) {
  const weeks = counts[0].length;
  const out = new Array(weeks);
  for (let t = 0; t < weeks; t++) {
    const c = counts.map(row => row[t] || 0);
    const total = c.reduce((a, b) => a + b, 0);
    out[t] = { total, count: c, share: c.map(v => (total ? v / total : 0)) };
  }
  return out;
}

/** Composition of today's index rows (stocks only): counts and shares per regime. */
export function composition(items) {
  const count = [0, 0, 0, 0];
  for (const it of items) if (it.cap !== 'I' && it.regime >= 0) count[it.regime]++;
  const total = count.reduce((a, b) => a + b, 0);
  return { count, total, share: count.map(c => (total ? c / total : 0)) };
}

export function indexAtX(geom, px) {
  if (!geom) return -1;
  return Math.max(geom.i0, Math.min(geom.i1, Math.round(geom.x.invert(px))));
}

export function renderBreadth(ctx, w, h, P, cursor, b, view, events) {
  const { i0, i1 } = view, s = b.series;
  const narrow = w < 560;
  const pad = { ...PAD, r: narrow ? 40 : PAD.r };
  const top = events.length ? (narrow ? 24 : 38) : 10;
  const x = linear(i0, Math.max(i1, i0 + 1), pad.l, w - pad.r);
  const yBot = h - pad.b;
  const y = linear(0, 1, yBot, top);

  // Stacked bands, one polygon per regime.
  const base = new Float64Array(i1 - i0 + 1);
  const tops = {};
  for (const r of STACK) {
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) ctx.lineTo(x(i), y(base[i - i0] + s[i].share[r]));
    for (let i = i1; i >= i0; i--) ctx.lineTo(x(i), y(base[i - i0]));
    ctx.closePath();
    ctx.fillStyle = regimeFill(ctx, P, r);
    ctx.fill();
    const mid = base[i1 - i0] + s[i1].share[r] / 2;
    for (let i = i0; i <= i1; i++) base[i - i0] += s[i].share[r];
    tops[r] = { mid, share: s[i1].share[r] };
    // Boundary line in the regime ink.
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) ctx.lineTo(x(i), y(base[i - i0]));
    ctx.strokeStyle = P.regime[r]; ctx.lineWidth = r === 2 ? 1.75 : 1; ctx.stroke();
  }

  // Axis: share of stocks, on the right.
  for (const v of [0, .25, .5, .75, 1]) {
    hline(ctx, pad.l, w - pad.r, y(v), v === 0 ? P.ruleInk : P.rule, v === 0 || v === 1 ? null : [2, 3]);
    if (narrow || v === 0 || v === 1) text(ctx, `${v * 100}%`, w - pad.r + 6, y(v) + 4, { font: P.monoSmall, color: P.ink3 });
  }
  for (const t of timeTicks(b.weeks, i0, i1, w)) {
    vline(ctx, x(t.i), yBot, yBot + 4, P.ruleInk);
    text(ctx, t.label, x(t.i), yBot + 16, { font: P.monoSmall, color: P.ink3, align: 'center' });
  }

  // Direct labels at the right end of each band.
  if (!narrow) {
    let lastY = Infinity;
    for (const r of STACK) {
      const t = tops[r];
      let ly = y(t.mid) + 4;
      if (ly > lastY - 12) ly = lastY - 12;
      lastY = ly;
      text(ctx, `${['Bullish', 'Accum.', 'Bearish', 'Crisis'][r]} ${Math.round(t.share * 100)}%`, w - pad.r + 8, ly,
        { font: P.mono, color: P.regime[r] });
    }
  }

  // Events.
  const placed = layoutLabels(ctx, events.filter(e => e.i >= i0 && e.i <= i1).map(e => ({ ...e, x: x(e.i) + 4 })), P.sansSmall, narrow ? 1 : 2);
  for (const e of placed) {
    vline(ctx, x(e.i), 6 + e.row * 14, yBot, P.ink3, [2, 3]);
    text(ctx, e.label, e.x, 14 + e.row * 14, { font: P.sansSmall, color: P.ink2 });
  }

  if (cursor >= i0 && cursor <= i1) {
    vline(ctx, x(cursor), top, yBot, P.ink);
  }
  return { x, i0, i1 };
}
