import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { unb64 } from '../../static/js/decode.js';
import { cholesky, forwardFilter, withStickiness } from '../../static/js/hmm.js';

const ex = JSON.parse(readFileSync(new URL('./fixtures/explainer.json', import.meta.url), 'utf8'));
const cols = ex.x.map(c => unb64(c, 'int16'));
const xs = Array.from({ length: ex.n }, (_, t) => cols.map(c => c[t] / ex.x_scale));

test('forward filter matches Python on the same model and data', () => {
  const py = unb64(ex.filtered, 'uint8');
  const js = forwardFilter(xs, ex.transmat, ex.means, ex.covars);
  let worst = 0;
  js.forEach((row, t) => row.forEach((p, k) => { worst = Math.max(worst, Math.abs(p - py[t * 4 + k] / 255)); }));
  assert.ok(worst <= 0.5 / 255 + 1e-3, `max abs difference ${worst}`);
});

test('filtered probabilities sum to one', () => {
  for (const row of forwardFilter(xs.slice(0, 50), ex.transmat, ex.means, ex.covars)) {
    assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
});

test('cholesky reproduces the matrix', () => {
  const a = [[4, 2, 0.4], [2, 5, 1], [0.4, 1, 3]];
  const L = cholesky(a);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0; for (let k = 0; k < 3; k++) s += L[i][k] * L[j][k];
    assert.ok(Math.abs(s - a[i][j]) < 1e-12);
  }
  assert.throws(() => cholesky([[1, 2], [2, 1]]));
});

test('stickiness keeps rows stochastic', () => {
  const t = withStickiness(ex.transmat, 0.8);
  t.forEach((row, i) => { assert.ok(Math.abs(row[i] - 0.8) < 1e-12); assert.ok(Math.abs(row.reduce((a, b) => a + b) - 1) < 1e-12); });
});
