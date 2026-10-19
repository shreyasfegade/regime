"""
REGIME — HMM Model
Fits a Gaussian HMM from several starts, decodes hidden states via Viterbi,
auto-labels states by inspecting learned emission parameters, and reorders
everything into the canonical regime order (config.REGIME_ORDER) so that
downstream code identifies a regime by index rather than by state number.
"""

import warnings
from dataclasses import dataclass, field

import numpy as np
from hmmlearn.hmm import GaussianHMM

from regime.config import (
    COVARIANCE_TYPE,
    LABEL_ACCUMULATION,
    LABEL_BEARISH,
    LABEL_BULLISH,
    LABEL_CRISIS,
    N_ITER,
    N_STATES,
    PRIMARY_SEED,
    REGIME_ORDER,
    SEEDS,
    TOL,
)


@dataclass
class Fit:
    """A fitted model plus its decoding, in canonical regime order."""
    model: GaussianHMM
    seed: int | None              # None for a warm-started candidate
    log_likelihood: float
    perm: np.ndarray              # perm[r] = HMM state index of regime r
    regimes: np.ndarray           # (n,) Viterbi path as regime indices
    posteriors: np.ndarray        # (n, 4) posteriors, columns in regime order
    transmat: np.ndarray          # (4, 4) transition matrix, regime order
    means: np.ndarray             # (4, d) emission means, regime order
    covars: np.ndarray            # (4, d, d) emission covariances, regime order
    candidates: list = field(default_factory=list)  # every candidate fit


def fit_hmm(
    features: np.ndarray,
    n_states: int = N_STATES,
    seed: int = PRIMARY_SEED,
    init: dict | None = None,
) -> GaussianHMM:
    """
    Fit a Gaussian HMM to the normalized feature matrix.

    Args:
        features: (n, d) array of normalized features.
        n_states: number of hidden states.
        seed:     random start for the k-means initialisation.
        init:     optional warm start, {'transmat', 'means', 'covars'} in any
                  state order. EM then starts from these parameters instead
                  of a fresh initialisation.

    Returns:
        Trained GaussianHMM model.
    """
    model = GaussianHMM(
        n_components=n_states,
        covariance_type=COVARIANCE_TYPE,
        n_iter=N_ITER,
        tol=TOL,
        random_state=seed,
        init_params='' if init else 'stmc',
        verbose=False,
    )
    if init:
        model.startprob_ = np.full(n_states, 1.0 / n_states)
        model.transmat_ = _row_normalise(np.asarray(init['transmat'], dtype=float))
        model.means_ = np.asarray(init['means'], dtype=float)
        model.covars_ = _regularise(np.asarray(init['covars'], dtype=float))
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        model.fit(features)
    return model


def fit_best(
    features: np.ndarray,
    seeds: tuple[int, ...] = SEEDS,
    warm: dict | None = None,
) -> Fit:
    """
    Fit a 4-state HMM from every seed (plus an optional warm start) and keep
    the highest-likelihood model. EM only finds a local optimum, so a single
    start can land in a poor one; the losing candidates are kept for the
    seed-stability measure.
    """
    candidates: list[Fit] = []
    starts: list[tuple[int | None, dict | None]] = [(s, None) for s in seeds]
    if warm is not None:
        starts.append((None, warm))
    for seed, init in starts:
        try:
            model = fit_hmm(features, N_STATES, seed if seed is not None else PRIMARY_SEED, init)
            candidates.append(decode(model, features, seed))
        except (ValueError, np.linalg.LinAlgError):
            continue  # a degenerate start; the others still count
    if not candidates:
        raise ValueError('The HMM failed to converge from every start.')
    best = max(candidates, key=lambda f: f.log_likelihood)
    best.candidates = candidates
    return best


def decode(model: GaussianHMM, features: np.ndarray, seed: int | None = None) -> Fit:
    """Decode a fitted model and reorder its outputs into regime order."""
    label_map = label_states(model)
    perm = canonical_permutation(label_map)
    states = model.predict(features)
    state_to_regime = np.empty(len(perm), dtype=int)
    state_to_regime[perm] = np.arange(len(perm))
    return Fit(
        model=model,
        seed=seed,
        log_likelihood=float(model.score(features)),
        perm=perm,
        regimes=state_to_regime[states],
        posteriors=model.predict_proba(features)[:, perm],
        transmat=model.transmat_[np.ix_(perm, perm)],
        means=model.means_[perm],
        covars=np.asarray(model.covars_)[perm],
    )


def label_states(model: GaussianHMM) -> dict[int, str]:
    """
    Assign human-readable labels to discovered state indices by inspecting
    the learned Gaussian emission means.

    Logic:
        - Feature index 0 = log_return (mean return character)
        - Feature index 2 = volatility_20d (volatility character)
        - Highest vol_20d mean → 'Crisis'
        - Lowest vol_20d mean AND lowest |return| → 'Accumulation'
        - Among remaining: higher return → 'Bullish Trending'
        - Among remaining: lower return  → 'Bearish Trending'

    Returns:
        Dict mapping state_index → label string.
    """
    means = model.means_
    n = means.shape[0]

    mean_return = means[:, 0]
    mean_vol_20d = means[:, 2]

    label_map: dict[int, str] = {}
    assigned: set[int] = set()

    # 1. Highest volatility → Crisis
    vol_order = np.argsort(mean_vol_20d)
    high_vol_idx = int(vol_order[-1])
    label_map[high_vol_idx] = LABEL_CRISIS
    assigned.add(high_vol_idx)

    # 2. Among remaining: lowest vol AND lowest |return| → Accumulation
    remaining = [i for i in range(n) if i not in assigned]
    accum_candidates = sorted(
        remaining, key=lambda i: (mean_vol_20d[i], abs(mean_return[i]))
    )
    accum_idx = accum_candidates[0]
    label_map[accum_idx] = LABEL_ACCUMULATION
    assigned.add(accum_idx)

    # 3. Among remaining two: higher return → Bullish, lower → Bearish
    remaining = [i for i in range(n) if i not in assigned]
    remaining_sorted = sorted(remaining, key=lambda i: mean_return[i])
    label_map[remaining_sorted[0]] = LABEL_BEARISH
    label_map[remaining_sorted[1]] = LABEL_BULLISH

    return label_map


def canonical_permutation(label_map: dict[int, str]) -> np.ndarray:
    """perm[r] = the HMM state index labelled REGIME_ORDER[r]."""
    by_label = {label: state for state, label in label_map.items()}
    return np.array([by_label[label] for label in REGIME_ORDER], dtype=int)


def compute_persistence_forecast(transmat: np.ndarray, regime: int) -> float:
    """
    Expected remaining sessions in a regime before a transition.

    Formula: 1 / (1 - P(stay)). A Markov chain is memoryless, so this is
    the same however long the regime has already lasted.
    """
    stay = float(transmat[regime, regime])
    if stay >= 1.0:
        return float('inf')
    return 1.0 / (1.0 - stay)


def runs(regimes: np.ndarray) -> list[tuple[int, int, int]]:
    """Run-length encode a regime path into (start, length, regime) runs."""
    regimes = np.asarray(regimes)
    if len(regimes) == 0:
        return []
    change = np.flatnonzero(np.diff(regimes)) + 1
    starts = np.concatenate([[0], change])
    ends = np.concatenate([change, [len(regimes)]])
    return [(int(s), int(e - s), int(regimes[s])) for s, e in zip(starts, ends)]


def days_in_current(regimes: np.ndarray) -> int:
    """Sessions spent in the latest regime, counting today."""
    return runs(regimes)[-1][1] if len(regimes) else 0


def regime_stats(close: np.ndarray, regimes: np.ndarray) -> list[dict]:
    """
    Per-regime breakdown in regime order: share of time, average daily log
    return, annualised volatility, and run-length statistics. A regime the
    path never visits gets zero counts and None averages.
    """
    close = np.asarray(close, dtype=float)
    log_ret = np.full(len(close), np.nan)
    log_ret[1:] = np.log(close[1:] / close[:-1])
    all_runs = runs(regimes)
    out = []
    for r in range(len(REGIME_ORDER)):
        mask = regimes == r
        rets = log_ret[mask & ~np.isnan(log_ret)]
        lengths = [n for _, n, k in all_runs if k == r]
        out.append({
            'days': int(mask.sum()),
            'pct': round(float(mask.mean()) * 100, 1),
            'avg_ret': round(float(rets.mean()) * 100, 3) if len(rets) else None,
            'ann_vol': round(float(rets.std(ddof=1)) * np.sqrt(252) * 100, 1) if len(rets) > 1 else None,
            'runs': len(lengths),
            'mean_run': round(float(np.mean(lengths)), 1) if lengths else None,
            'median_run': float(np.median(lengths)) if lengths else None,
        })
    return out


def n_params(n_states: int, n_dim: int) -> int:
    """Free parameters of a full-covariance Gaussian HMM."""
    k, d = n_states, n_dim
    return (k - 1) + k * (k - 1) + k * d + k * d * (d + 1) // 2


def _row_normalise(m: np.ndarray) -> np.ndarray:
    m = np.clip(m, 1e-6, None)
    return m / m.sum(axis=1, keepdims=True)


def _regularise(covars: np.ndarray, eps: float = 1e-4) -> np.ndarray:
    """Symmetrise and nudge covariances so a warm start is always valid."""
    covars = (covars + np.swapaxes(covars, -1, -2)) / 2
    return covars + eps * np.eye(covars.shape[-1])


def filtered_posteriors(model: GaussianHMM, features: np.ndarray) -> np.ndarray:
    """
    Forward-filtered state probabilities P(state_t | x_1..x_t).

    Unlike predict / predict_proba (Viterbi and forward-backward smoothing),
    the value on day t uses no observation after day t. This is what the
    walk-forward uses to classify out-of-sample days, so a label never
    depends on the future, even within one forward block.
    Columns are in the model's own state order.
    """
    log_b = emission_log_likelihood(model.means_, np.asarray(model.covars_), features)
    log_a = np.log(np.clip(model.transmat_, 1e-300, None))
    n, k = log_b.shape
    out = np.empty((n, k))
    alpha = np.log(np.clip(model.startprob_, 1e-300, None)) + log_b[0]
    alpha -= _logsumexp(alpha)
    out[0] = alpha
    for t in range(1, n):
        alpha = _logsumexp(alpha[:, None] + log_a, axis=0) + log_b[t]
        alpha -= _logsumexp(alpha)
        out[t] = alpha
    return np.exp(out)


def emission_log_likelihood(means: np.ndarray, covars: np.ndarray, x: np.ndarray) -> np.ndarray:
    """(n, k) log N(x_t | mean_k, cov_k) for full covariances, via Cholesky."""
    n, d = x.shape
    out = np.empty((n, len(means)))
    for j, (mu, cov) in enumerate(zip(means, covars)):
        chol = np.linalg.cholesky(cov)
        z = np.linalg.solve(chol, (x - mu).T)
        log_det = 2.0 * np.sum(np.log(np.diag(chol)))
        out[:, j] = -0.5 * (d * np.log(2 * np.pi) + log_det + np.sum(z * z, axis=0))
    return out


def _logsumexp(a: np.ndarray, axis: int | None = None) -> np.ndarray:
    m = np.max(a, axis=axis, keepdims=True)
    s = m + np.log(np.sum(np.exp(a - m), axis=axis, keepdims=True))
    return np.squeeze(s, axis=axis) if axis is not None else float(s.squeeze())
