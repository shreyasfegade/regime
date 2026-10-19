/* REGIME — decoders for the compact data format written by regime/encode.py.
   Pure functions with no DOM access, so the same module runs in Node tests. */

export const PRICE_SCALE = 2000;
export const POST_SCALE = 255;
export const REGIMES = ['Bullish Trending', 'Accumulation', 'Bearish Trending', 'Crisis'];
export const SHORT = ['Bullish', 'Accumulation', 'Bearish', 'Crisis'];

function bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Little-endian integer array from base64. type: 'uint8' | 'int16' */
export function unb64(b64, type) {
  const u8 = bytes(b64);
  if (type === 'uint8') return u8;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8.byteLength / 2;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

/** Dates as 'YYYY-MM-DD' strings from {d0, gaps}. */
export function decodeDates(enc) {
  const gaps = unb64(enc.gaps, 'uint8');
  const t0 = Date.parse(enc.d0 + 'T00:00:00Z');
  const out = new Array(gaps.length);
  let day = 0;
  for (let i = 0; i < gaps.length; i++) {
    day += gaps[i];
    out[i] = new Date(t0 + day * 86400000).toISOString().slice(0, 10);
  }
  return out;
}

/** Float64Array of values from a log-delta series {q0, d}. */
export function decodeLogSeries(enc) {
  const d = unb64(enc.d, 'int16');
  const out = new Float64Array(d.length);
  let q = enc.q0;
  for (let i = 0; i < d.length; i++) {
    q += d[i];  // d[0] is 0, so out[0] is exp(q0 / scale)
    out[i] = Math.exp(q / PRICE_SCALE);
  }
  return out;
}

/** Array of Float32Array(4) posteriors per day. */
export function decodePosteriors(b64) {
  const q = unb64(b64, 'uint8');
  const n = q.length / 3;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = q[3 * i], b = q[3 * i + 1], c = q[3 * i + 2];
    const d = Math.max(0, POST_SCALE - a - b - c);
    const s = a + b + c + d || 1;
    out[i] = Float32Array.of(a / s, b / s, c / s, d / s);
  }
  return out;
}

/** Int8Array regime path of length n from runs [[start, len, regime]]; -1 where absent. */
export function decodeRuns(runs, n) {
  const out = new Int8Array(n).fill(-1);
  for (const [s, len, r] of runs) out.fill(r, s, s + len);
  return out;
}

/** Sampled positions of an m-point curve: every stride-th plus the last. */
export function sampleIndex(m, stride) {
  const idx = [];
  for (let i = 0; i < m; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== m - 1) idx.push(m - 1);
  return idx;
}

/** Decode a whole ticker payload into arrays the charts use directly. */
export function decodeTicker(p) {
  const dates = decodeDates(p.dates);
  const close = decodeLogSeries(p.px);
  const post = decodePosteriors(p.post);
  const vit = decodeRuns(p.vit, p.n);
  const oos = p.oos ? decodeRuns(p.oos.runs, p.n) : null;
  const bt = {};
  for (const k of ['is', 'oos']) {
    const b = p.backtest && p.backtest[k];
    if (!b) { bt[k] = null; continue; }
    const idx = sampleIndex(b.m, b.stride).map(i => i + b.offset);
    bt[k] = { ...b, idx, strategy: decodeLogSeries(b.strategy), benchmark: decodeLogSeries(b.benchmark) };
  }
  return { ...p, dates, close, post, vit, oos, bt };
}

/** Index rows as objects keyed by the column names. */
export function indexRows(index) {
  const cols = index.cols;
  return index.rows.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}
