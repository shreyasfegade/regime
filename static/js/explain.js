/* REGIME — plain-English explainers. Deterministic sentences built from the
   numbers on the page; nothing here is generated freely. */

import { SHORT } from './decode.js';
import { date, num, pct } from './format.js';

export const MEANING = [
  'a positive drift with contained volatility: the price is trending up',
  'little drift and the lowest volatility: a quiet, range-bound base',
  'a negative drift with elevated volatility: the price is trending down',
  'the highest-volatility state, with sharp and disorderly moves, mostly down',
];

export const PLAIN = [
  { name: 'Bullish Trending', body: 'Prices drift upwards and day-to-day swings stay contained. Historically the calmest way up.' },
  { name: 'Accumulation', body: 'Little net movement and unusually low volatility. Often a pause or a base before the next move.' },
  { name: 'Bearish Trending', body: 'Prices drift downwards with wider swings than in a bull trend. An orderly decline.' },
  { name: 'Crisis', body: 'The most volatile state the model finds: large, fast moves, mostly down. Rare, but it is where drawdowns happen.' },
];

const article = name => (/^[AEIOU]/i.test(name) ? 'an' : 'a');

/** The headline sentence for the Today card. */
export function todaySentence(d) {
  const t = d.today, r = t.regime, s = d.stats[r];
  const label = SHORT[r];
  const who = d.cap === 'I' ? d.name : d.name.replace(/ Ltd$/, '');
  const parts = [];
  parts.push(`${who} has been in ${article(label)} ${label.toLowerCase()} regime for ${num(t.days_in)} session${t.days_in === 1 ? '' : 's'}, which the model reads as ${MEANING[r]}.`);
  parts.push(`It puts ${Math.round(t.posterior * 100)}% probability on that regime today.`);
  if (s && s.median_run) {
    parts.push(`Past ${label.toLowerCase()} spells here have lasted a median ${num(s.median_run)} sessions.`);
  }
  return parts.join(' ');
}

/** One line on what the regime has meant for this stock historically. */
export function regimeCharacter(d, r) {
  const s = d.stats[r];
  if (!s || s.avg_ret == null) return `${d.name} has not been in this regime.`;
  return `${SHORT[r]} days averaged ${pct(s.avg_ret, 2, true)} with ${pct(s.ann_vol, 0)} annualised volatility, ${pct(s.pct, 0)} of the time.`;
}

/** Backtest summary sentence. */
export function backtestSentence(bt, oos) {
  const m = bt.metrics, s = m.strategy, b = m.benchmark;
  const when = oos ? `Out of sample, from ${date(bt.start)}` : `Over the full history`;
  const beat = s.cagr >= b.cagr ? 'ahead of' : 'behind';
  return `${when}, the rotation strategy compounded at ${pct(s.cagr, 1, true)} a year, ${beat} buy-and-hold at ${pct(b.cagr, 1, true)}, with a worst drawdown of ${pct(s.max_drawdown, 0)} against ${pct(b.max_drawdown, 0)}. Costs took ${pct(m.cost_drag_pct_per_year.total, 2)} a year.`;
}
