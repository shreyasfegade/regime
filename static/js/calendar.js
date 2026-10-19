/* REGIME — regime calendar. One row per year, one cell per session, coloured
   by the Viterbi regime with opacity from the model's posterior for it. */

import { regimeFill, text } from './figure.js';

const LEFT = 40;
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export function calendarLayout(dates) {
  const years = [];
  let cur = null;
  dates.forEach((iso, i) => {
    const y = +iso.slice(0, 4);
    if (!cur || cur.year !== y) { cur = { year: y, start: i, days: [] }; years.push(cur); }
    // Position within the year by calendar day, so years line up by date.
    const doy = (Date.parse(iso) - Date.UTC(y, 0, 1)) / 86400000;
    cur.days.push({ i, doy });
  });
  return years;
}

export function renderCalendar(ctx, w, h, P, cursor, d, years) {
  const rowH = Math.max(10, Math.min(16, (h - 18) / years.length - 3));
  const top = 16;
  const span = w - LEFT - 4;
  const xOf = doy => LEFT + (doy / 366) * span;
  const cellW = Math.max(1, span / 366 * 1.45);
  for (let m = 0; m < 12; m++) {
    const doy = (Date.UTC(2001, m, 1) - Date.UTC(2001, 0, 1)) / 86400000;
    text(ctx, w < 520 ? MONTHS[m] : new Date(Date.UTC(2001, m, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
      xOf(doy), 10, { font: P.monoSmall, color: P.ink3 });
  }
  const rows = [];
  years.forEach((yr, k) => {
    const y = top + k * (rowH + 3);
    text(ctx, String(yr.year), 0, y + rowH - 2, { font: P.monoSmall, color: P.ink3 });
    for (const { i, doy } of yr.days) {
      const r = d.vit[i];
      if (r < 0) continue;
      const conf = d.post[i][r];
      ctx.globalAlpha = .35 + .65 * Math.max(0, (conf - .25) / .75);
      ctx.fillStyle = r === 3 ? regimeFill(ctx, P, 3) : P.regime[r];
      ctx.fillRect(xOf(doy), y, cellW, rowH);
    }
    ctx.globalAlpha = 1;
    rows.push({ y, yr });
  });
  if (cursor >= 0) {
    const yr = years.findIndex(v => cursor >= v.start && cursor < v.start + v.days.length);
    if (yr >= 0) {
      const day = years[yr].days[cursor - years[yr].start];
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5;
      ctx.strokeRect(xOf(day.doy) - 1.5, top + yr * (rowH + 3) - 1.5, cellW + 3, rowH + 3);
    }
  }
  return { rows, rowH, xOf, span, top };
}

export function calendarHeight(years) { return 16 + years.length * 17 + 4; }

export function calendarIndexAt(geom, px, py) {
  if (!geom) return -1;
  const k = Math.floor((py - geom.top) / (geom.rowH + 3));
  const row = geom.rows[Math.max(0, Math.min(geom.rows.length - 1, k))];
  if (!row) return -1;
  const doy = (px - 40) / geom.span * 366;
  let best = row.yr.days[0], bd = Infinity;
  for (const day of row.yr.days) { const dd = Math.abs(day.doy - doy); if (dd < bd) { bd = dd; best = day; } }
  return best.i;
}
