import assert from 'node:assert/strict';
import { test } from 'node:test';
import { date, frac, inr, num, pct, price } from '../../static/js/format.js';
import { rank } from '../../static/js/search.js';

test('indian digit grouping and rupees', () => {
  assert.equal(num(1234567), '12,34,567');
  assert.equal(inr(23144.4), '₹23,144');
  assert.equal(inr(512.34), '₹512.3');
  assert.equal(price(23144.4, true), '23,144');
});

test('signs use a true minus', () => {
  assert.equal(pct(-2.5, 1, true), '−2.5%');
  assert.equal(pct(2.5, 1, true), '+2.5%');
  assert.equal(frac(0.873), '87%');
  assert.equal(num(null), '—');
});

test('dates', () => {
  assert.equal(date('2020-03-23'), '23 Mar 2020');
});

test('search ranks exact symbols, aliases and larger companies first', () => {
  const items = [
    { slug: 'RELIANCE', sym: 'RELIANCE', name: 'Reliance Industries Ltd', rank: 1 },
    { slug: 'RELINFRA', sym: 'RELINFRA', name: 'Reliance Infrastructure Ltd', rank: 600 },
    { slug: 'NIFTY50', sym: '^NSEI', name: 'NIFTY 50', rank: null },
  ];
  assert.equal(rank(items, 'reliance')[0].slug, 'RELIANCE');
  assert.equal(rank(items, 'nifty')[0].slug, 'NIFTY50');
  assert.equal(rank(items, 'infra')[0].slug, 'RELINFRA');
  assert.deepEqual(rank(items, 'zzz'), []);
});
