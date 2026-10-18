/* REGIME — figure primitives for hand-drawn Canvas charts.
   No chart library: every axis, tick, band and label is drawn here, in the
   house style (hairlines, tabular numerals, direct labels). */

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Current theme colours, read from CSS custom properties. */
export function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return {
    paper: v('--paper'), paper2: v('--paper-2'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'),
    rule: v('--rule'), rule2: v('--rule-2'), ruleInk: v('--rule-ink'),
    regime: [v('--bull'), v('--accum'), v('--bear'), v('--crisis')],
    wash: [v('--bull-wash'), v('--accum-wash'), v('--bear-wash'), v('--crisis-wash')],
    mono: "400 11px 'Plex Mono', ui-monospace, monospace",
    monoSmall: "400 10px 'Plex Mono', ui-monospace, monospace",
    sans: "400 12px 'Plex Sans', system-ui, sans-serif",
    sansSmall: "500 10.5px 'Plex Sans', system-ui, sans-serif",
  };
}

/** Diagonal hatch for Crisis, so it never relies on colour alone. */
const hatchCache = new Map();
export function hatch(ctx, color, wash) {
  const key = color + wash;
  if (!hatchCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = c.height = 6;
    const g = c.getContext('2d');
    g.fillStyle = wash; g.fillRect(0, 0, 6, 6);
    g.strokeStyle = color; g.globalAlpha = .55; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 6); g.lineTo(6, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(5, 7); g.lineTo(7, 5); g.stroke();
    hatchCache.set(key, c);
  }
  return ctx.createPattern(hatchCache.get(key), 'repeat');
}

export function regimeFill(ctx, P, r) {
  return r === 3 ? hatch(ctx, P.regime[3], P.wash[3]) : P.wash[r];
}

// ── Scales & ticks ──────────────────────────────────────────────────

export function linear(d0, d1, r0, r1) {
  const k = (r1 - r0) / ((d1 - d0) || 1);
  const f = v => r0 + (v - d0) * k;
  f.invert = p => d0 + (p - r0) / k;
  return f;
}

export function logScale(d0, d1, r0, r1) {
  const l0 = Math.log(d0), l1 = Math.log(d1), k = (r1 - r0) / ((l1 - l0) || 1);
  const f = v => r0 + (Math.log(v) - l0) * k;
  f.invert = p => Math.exp(l0 + (p - r0) / k);
  return f;
}

export function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Ticks for a log price axis: 1-2-5 sequence, thinned to ~count. */
export function logTicks(min, max, count = 5) {
  const out = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= min && v <= max) out.push(v); }
  }
  if (out.length < 3) return niceTicks(min, max, count);
  while (out.length > count + 1) { for (let i = out.length - 2; i > 0; i -= 2) out.splice(i, 1); }
  return out;
}

/** Year (or month) tick positions over sorted ISO date strings. */
export function timeTicks(dates, i0, i1, width) {
  const ticks = [];
  const years = (Date.parse(dates[i1]) - Date.parse(dates[i0])) / 3.156e10;
  const everyYears = years > 14 ? 4 : years > 7 ? 2 : 1;
  if (years >= 2) {
    // A tick at the first session of each (every n-th) year.
    for (let i = i0 + 1; i <= i1; i++) {
      const y = +dates[i].slice(0, 4);
      if (y !== +dates[i - 1].slice(0, 4) && y % everyYears === 0) ticks.push({ i, label: String(y) });
    }
  } else {
    const every = years > 1 ? 3 : width < 500 ? 2 : 1;
    let last = null;
    for (let i = i0; i <= i1; i++) {
      const m = dates[i].slice(0, 7);
      if (m !== last && last !== null && (+m.slice(5) - 1) % every === 0) {
        const mon = new Date(dates[i] + 'T00:00:00Z').toLocaleString('en', { month: 'short', timeZone: 'UTC' });
        ticks.push({ i, label: m.slice(5) === '01' ? `${mon} ${m.slice(0, 4)}` : mon });
      }
      last = m;
    }
  }
  return ticks;
}

// ── Canvas setup ────────────────────────────────────────────────────

export function sizeCanvas(canvas, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Crisp 1px line at half-pixel offset. */
export function hline(ctx, x0, x1, y, color, dash) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1; if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + .5); ctx.lineTo(x1, Math.round(y) + .5); ctx.stroke(); ctx.restore();
}
export function vline(ctx, x, y0, y1, color, dash) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1; if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, y0); ctx.lineTo(Math.round(x) + .5, y1); ctx.stroke(); ctx.restore();
}

export function text(ctx, s, x, y, { font, color, align = 'left', base = 'alphabetic' } = {}) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y);
}

/**
 * Lay out event labels left to right, dropping each to the next free row if
 * it would collide. Returns [{...ev, x, row}] with rows < maxRows only.
 */
export function layoutLabels(ctx, events, font, maxRows = 2, pad = 10) {
  ctx.font = font;
  const rowsEnd = new Array(maxRows).fill(-Infinity);
  const out = [];
  for (const ev of [...events].sort((a, b) => a.x - b.x)) {
    const w = ctx.measureText(ev.label).width;
    const row = rowsEnd.findIndex(end => ev.x >= end + pad);
    if (row < 0) continue;
    rowsEnd[row] = ev.x + w;
    out.push({ ...ev, row, w });
  }
  return out;
}

/**
 * A responsive figure. `render(ctx, width, height, P)` draws everything and
 * may return a geometry object used for hit-testing. The container gets a
 * keyboard cursor: ← → move a session, Shift+← → / PgUp PgDn a month,
 * Home/End jump; Escape clears.
 */
export class Figure {
  constructor(container, { height, render, n = 0, indexAt, onCursor, label }) {
    this.el = container;
    this.canvas = container.querySelector('canvas') || container.appendChild(document.createElement('canvas'));
    this.height = height; this.renderFn = render; this.n = n;
    this.indexAt = indexAt; this.onCursor = onCursor; this.cursor = -1; this.geom = null;
    this.canvas.setAttribute('role', 'img');
    if (label) this.canvas.setAttribute('aria-label', label);
    this.draw = this.draw.bind(this);
    new ResizeObserver(() => this.draw()).observe(container);
    window.addEventListener('regime:theme', this.draw);
    if (onCursor) this.bindCursor();
  }

  draw() {
    const w = this.el.clientWidth;
    if (!w) return;
    const h = typeof this.height === 'function' ? this.height(w) : this.height;
    const ctx = sizeCanvas(this.canvas, w, h);
    this.geom = this.renderFn(ctx, w, h, palette(), this.cursor) || null;
  }

  setCursor(i, source = 'self') {
    i = i < 0 ? -1 : Math.max(0, Math.min(this.n - 1, i));
    if (i === this.cursor) return;
    this.cursor = i; this.draw();
    if (source === 'self' && this.onCursor) this.onCursor(i);
  }

  bindCursor() {
    const el = this.el;
    el.tabIndex = 0;
    const fromEvent = e => {
      if (!this.geom || !this.indexAt) return -1;
      const r = this.canvas.getBoundingClientRect();
      return this.indexAt(this.geom, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) this.setCursor(fromEvent(e)); });
    el.addEventListener('pointerdown', e => this.setCursor(fromEvent(e)));
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.setCursor(-1); });
    el.addEventListener('keydown', e => {
      const n = this.n, c = this.cursor < 0 ? n - 1 : this.cursor;
      const month = 21;
      const moves = {
        ArrowLeft: e.shiftKey ? c - month : c - 1, ArrowRight: e.shiftKey ? c + month : c + 1,
        PageUp: c - month, PageDown: c + month, Home: 0, End: n - 1,
      };
      if (e.key in moves) { e.preventDefault(); this.setCursor(moves[e.key]); }
      else if (e.key === 'Escape') this.setCursor(-1);
    });
    el.addEventListener('focus', () => { if (this.cursor < 0) this.setCursor(this.n - 1); });
  }
}

/** Keep the cursor of several figures in step. */
export function linkCursors(figs, onChange) {
  figs.forEach(f => {
    const own = f.onCursor;
    f.onCursor = i => { figs.forEach(g => { if (g !== f) g.setCursor(i, 'link'); }); onChange?.(i); own?.(i); };
  });
}
