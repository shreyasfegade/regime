/* REGIME — small multiples: BIC by number of states, crisis trajectory,
   and the price sparkline used by the transition explorer. */

import { hline, linear, text, vline } from './figure.js';

export function renderBic(ctx, w, h, P, _c, bic, chosen = 4) {
  const ks = bic.ks, vals = bic.bic;
  if (!ks.length) return;
  const min = Math.min(...vals);
  const delta = vals.map(v => v - min);
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const x = linear(ks[0] - .5, ks[ks.length - 1] + .5, pad.l, w - pad.r);
  const y = linear(0, Math.max(...delta) * 1.1 || 1, h - pad.b, pad.t);
  hline(ctx, pad.l, w - pad.r, y(0), P.ruleInk);
  ks.forEach((k, j) => {
    const px = x(k), py = y(delta[j]);
    vline(ctx, px, py, y(0), k === chosen ? P.ink : P.rule2);
    ctx.fillStyle = k === bic.best ? P.ink : P.paper; ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill(); ctx.stroke();
    text(ctx, `${k}`, px, h - 10, { font: P.mono, color: k === chosen ? P.ink : P.ink3, align: 'center' });
  });
  text(ctx, 'states', w - pad.r, h - 10, { font: P.sansSmall, color: P.ink3, align: 'right' });
  text(ctx, 'ΔBIC', 0, pad.t + 4, { font: P.sansSmall, color: P.ink3 });
}

export function renderCrisis(ctx, w, h, P, _c, cw) {
  const traj = cw.trajectory;
  const pad = { l: 4, r: 40, t: 10, b: 20 };
  const max = Math.max(10, Math.ceil(Math.max(...traj) / 10) * 10);
  const x = linear(0, traj.length - 1, pad.l, w - pad.r);
  const y = linear(0, max, h - pad.b, pad.t);
  for (const v of [0, max / 2, max]) {
    hline(ctx, pad.l, w - pad.r, y(v), v === 0 ? P.ruleInk : P.rule);
    text(ctx, `${v}%`, w - pad.r + 6, y(v) + 4, { font: P.monoSmall, color: P.ink3 });
  }
  ctx.beginPath(); traj.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
  ctx.strokeStyle = P.regime[3]; ctx.lineWidth = 1.75; ctx.stroke();
  text(ctx, 'today', pad.l, h - 6, { font: P.monoSmall, color: P.ink3 });
  text(ctx, `+${traj.length - 1} sessions`, w - pad.r, h - 6, { font: P.monoSmall, color: P.ink3, align: 'right' });
}

/** Close price around one session, with the session marked. */
export function renderSpark(ctx, w, h, P, close, center, before = 20, after = 20, color) {
  const a = Math.max(0, center - before), b = Math.min(close.length - 1, center + after);
  let lo = Infinity, hi = -Infinity;
  for (let i = a; i <= b; i++) { lo = Math.min(lo, close[i]); hi = Math.max(hi, close[i]); }
  const x = linear(a, b, 1, w - 1), y = linear(lo, hi, h - 2, 2);
  vline(ctx, x(center), 0, h, color || P.ink3);
  ctx.beginPath();
  for (let i = a; i <= b; i++) (i === a ? ctx.moveTo(x(i), y(close[i])) : ctx.lineTo(x(i), y(close[i])));
  ctx.strokeStyle = P.ink; ctx.lineWidth = 1.25; ctx.stroke();
}
