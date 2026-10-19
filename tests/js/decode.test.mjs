import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeTicker, decodeRuns, sampleIndex, indexRows } from '../../static/js/decode.js';

const load = f => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const raw = load('ticker.json');
const exp = load('expected.json');
const d = decodeTicker(raw);

test('dates match the Python decoder', () => {
  assert.deepEqual(d.dates, exp.dates);
});

test('prices match the Python decoder', () => {
  assert.equal(d.close.length, exp.close.length);
  exp.close.forEach((v, i) => assert.ok(Math.abs(d.close[i] - v) < 1e-6 * v, `close[${i}]`));
});

test('posteriors match and sum to one', () => {
  exp.post.forEach((row, i) => {
    row.forEach((v, k) => assert.ok(Math.abs(d.post[i][k] - v) < 1e-5, `post[${i}][${k}]`));
    assert.ok(Math.abs(d.post[i].reduce((a, b) => a + b, 0) - 1) < 1e-5);
  });
});

test('regime paths match', () => {
  assert.deepEqual(Array.from(d.vit), exp.vit);
  assert.deepEqual(Array.from(d.oos), exp.oos);
});

test('backtest curves align with sessions', () => {
  for (const k of ['is', 'oos']) {
    const b = d.bt[k];
    assert.equal(b.idx.length, b.strategy.length);
    assert.equal(b.idx[b.idx.length - 1], raw.n - 1);
    assert.ok(Math.abs(b.strategy[0] - 1) < 0.02, 'equity starts near 1');
  }
});

test('helpers', () => {
  assert.deepEqual(sampleIndex(11, 5), [0, 5, 10]);
  assert.deepEqual(sampleIndex(12, 5), [0, 5, 10, 11]);
  assert.deepEqual(Array.from(decodeRuns([[1, 2, 3]], 4)), [-1, 3, 3, -1]);
  assert.deepEqual(indexRows({ cols: ['a', 'b'], rows: [[1, 2]] }), [{ a: 1, b: 2 }]);
});
