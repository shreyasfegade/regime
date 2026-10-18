/* REGIME — number and date formatting. Every figure on the site goes through
   here so units, signs and precision are consistent. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINUS = '−';

function sign(v, s) { return v < 0 ? MINUS : (s && v > 0 ? '+' : ''); }

/** 1234.5 → "1,234.50"; Indian digit grouping (12,34,567). */
export function num(v, dp = 0) {
  if (v == null || !isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return sign(v) + s;
}

/** Price in rupees with precision suited to its size. */
export function inr(v) {
  if (v == null || !isFinite(v)) return '—';
  const dp = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2;
  return '₹' + num(v, dp);
}

/** A price: rupees for stocks, plain points for indices. */
export function price(v, isIndex) {
  if (!isIndex) return inr(v);
  return v == null || !isFinite(v) ? '—' : num(v, Math.abs(v) >= 1000 ? 0 : 2);
}

/** Percent from a value already in percent units. */
export function pct(v, dp = 1, signed = false) {
  if (v == null || !isFinite(v)) return '—';
  return sign(v, signed) + Math.abs(v).toFixed(dp) + '%';
}

/** Percent from a fraction (0.873 → "87%"). */
export function frac(v, dp = 0) {
  return v == null || !isFinite(v) ? '—' : (v * 100).toFixed(dp) + '%';
}

export function signedNum(v, dp = 2) {
  if (v == null || !isFinite(v)) return '—';
  return sign(v, true) + Math.abs(v).toFixed(dp);
}

/** '2020-03-23' → '23 Mar 2020'. */
export function date(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}

/** '2020-03-23' → 'Mar 2020'. */
export function month(iso) {
  const [y, m] = iso.split('-');
  return `${MONTHS[+m - 1]} ${y}`;
}

export function sessions(n) {
  if (n == null || !isFinite(n)) return '—';
  return `${num(n, 0)} session${Math.round(n) === 1 ? '' : 's'}`;
}

/** Days between two ISO dates. */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export const CAP = { L: 'Large cap', M: 'Mid cap', S: 'Small cap', I: 'Index' };
