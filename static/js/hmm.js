/* REGIME — a Gaussian HMM forward filter in the browser, for the explainer.
   Same maths as regime/model.py:filtered_posteriors, so the page can
   re-filter real NIFTY 50 data live when the reader changes the model. */

/** Lower-triangular Cholesky factor of a symmetric positive-definite matrix. */
export function cholesky(a) {
  const n = a.length, L = a.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (s <= 0) throw new Error('matrix is not positive definite'); L[i][i] = Math.sqrt(s); }
      else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

/** Per-state log-density functions for full-covariance Gaussians. */
export function emissionModel(means, covars) {
  return means.map((mu, k) => {
    const L = cholesky(covars[k]), d = mu.length;
    let logDet = 0;
    for (let i = 0; i < d; i++) logDet += 2 * Math.log(L[i][i]);
    const c = -0.5 * (d * Math.log(2 * Math.PI) + logDet);
    const z = new Float64Array(d);
    return x => {
      let q = 0;
      for (let i = 0; i < d; i++) {          // solve L z = x - mu
        let s = x[i] - mu[i];
        for (let j = 0; j < i; j++) s -= L[i][j] * z[j];
        z[i] = s / L[i][i]; q += z[i] * z[i];
      }
      return c - 0.5 * q;
    };
  });
}

function logSumExp(a) {
  let m = -Infinity;
  for (const v of a) if (v > m) m = v;
  let s = 0;
  for (const v of a) s += Math.exp(v - m);
  return m + Math.log(s);
}

/**
 * P(state_t | x_1..x_t) for every t. `xs` is an array of feature vectors,
 * `transmat` a k×k row-stochastic matrix. Returns Float64Array rows.
 */
export function forwardFilter(xs, transmat, means, covars, start = null) {
  const k = means.length, logB = emissionModel(means, covars);
  const logA = transmat.map(r => r.map(p => Math.log(Math.max(p, 1e-300))));
  let alpha = new Float64Array(k).map((_, j) => Math.log(start ? start[j] : 1 / k) + logB[j](xs[0]));
  const out = new Array(xs.length);
  const norm = a => { const z = logSumExp(a); return a.map(v => v - z); };
  alpha = norm(alpha);
  out[0] = alpha.map(Math.exp);
  const tmp = new Float64Array(k);
  for (let t = 1; t < xs.length; t++) {
    const next = new Float64Array(k);
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < k; i++) tmp[i] = alpha[i] + logA[i][j];
      next[j] = logSumExp(tmp) + logB[j](xs[t]);
    }
    alpha = norm(next);
    out[t] = alpha.map(Math.exp);
  }
  return out;
}

/** Rescale a transition matrix's diagonal to `stay` and renormalise the rest. */
export function withStickiness(transmat, stay) {
  return transmat.map((row, i) => {
    const off = row.reduce((s, p, j) => (j === i ? s : s + p), 0) || 1;
    return row.map((p, j) => (j === i ? stay : (1 - stay) * p / off));
  });
}

/**
 * Scale every switching probability by `f` (f < 1: stickier, f > 1: jumpier),
 * keeping each row's mix of destinations as fitted. f is capped so that no
 * diagonal goes negative.
 */
export function scaleSwitching(transmat, f) {
  const maxF = Math.min(...transmat.map((row, i) => 1 / Math.max(1e-12, 1 - row[i])));
  const g = Math.min(f, maxF);
  return transmat.map((row, i) => row.map((p, j) => (j === i ? 0 : p * g))).map((row, i) => {
    row[i] = 1 - row.reduce((s, p) => s + p, 0);
    return row;
  });
}

/** Most probable state per day, and how many times it changes. */
export function argmaxPath(post) {
  const path = new Int8Array(post.length);
  let switches = 0;
  for (let t = 0; t < post.length; t++) {
    let best = 0;
    for (let k = 1; k < post[t].length; k++) if (post[t][k] > post[t][best]) best = k;
    path[t] = best;
    if (t && best !== path[t - 1]) switches++;
  }
  return { path, switches };
}
