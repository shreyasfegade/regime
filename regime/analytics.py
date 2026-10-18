"""
REGIME — Quant Analytics
Signal-quality and risk diagnostics that sit on top of the fitted HMM:

  • forward_return_edge   — does each regime actually predict forward returns?
  • crisis_early_warning  — probability of rotating into Crisis over a horizon,
                            propagated through the transition matrix
  • model_diagnostics     — log-likelihood, AIC, BIC for model-selection rigor

These turn REGIME from a descriptive classifier into something a quant can
interrogate: every regime label comes with measured forward edge and a
forward-looking tail-risk signal, not just a color.
"""

import numpy as np

from config import LABEL_CRISIS


def forward_return_edge(
    close: np.ndarray,
    state_sequence: np.ndarray,
    label_map: dict[int, str],
    horizon: int = 5,
) -> dict:
    """
    For each regime, measure the distribution of the *next* `horizon`-day
    return conditioned on being in that regime today.

    This is the core "is the signal real?" test: a regime that classifies the
    past is only useful if, on average, what follows it differs by regime.

    Returns dict: { horizon, by_regime: { label: {mean, median, win_rate,
    samples, best, worst} } } with returns in percent.
    """
    close = np.asarray(close, dtype=float)
    n = len(close)
    fwd = np.full(n, np.nan)
    if n > horizon:
        fwd[:n - horizon] = close[horizon:] / close[:n - horizon] - 1.0

    by_regime: dict[str, dict] = {}
    for state_idx, label in sorted(label_map.items(), key=lambda kv: kv[1]):
        mask = (state_sequence == state_idx) & ~np.isnan(fwd)
        vals = fwd[mask]
        if len(vals) == 0:
            continue
        by_regime[label] = {
            'mean': round(float(np.mean(vals)) * 100, 3),
            'median': round(float(np.median(vals)) * 100, 3),
            'win_rate': round(float(np.mean(vals > 0)) * 100, 1),
            'samples': int(len(vals)),
            'best': round(float(np.max(vals)) * 100, 2),
            'worst': round(float(np.min(vals)) * 100, 2),
        }
    return {'horizon': horizon, 'by_regime': by_regime}


def crisis_early_warning(
    transition_matrix: list[list[float]],
    current_probs: np.ndarray,
    label_map: dict[int, str],
    horizon: int = 10,
) -> dict:
    """
    Propagate today's posterior state distribution forward through the HMM
    transition matrix to estimate the probability of being in the Crisis
    regime on each of the next `horizon` days.

    Returns dict: { current, projected (at horizon), peak, trajectory[] } as
    probabilities in percent — a genuine forward-looking risk gauge.
    """
    T = np.asarray(transition_matrix, dtype=float)
    dist = np.asarray(current_probs, dtype=float)
    dist = dist / dist.sum() if dist.sum() > 0 else dist

    crisis_states = [i for i, lbl in label_map.items() if lbl == LABEL_CRISIS]
    crisis_now = float(sum(dist[i] for i in crisis_states))

    trajectory = [round(crisis_now * 100, 2)]
    d = dist.copy()
    for _ in range(horizon):
        d = d @ T
        trajectory.append(round(float(sum(d[i] for i in crisis_states)) * 100, 2))

    return {
        'horizon': horizon,
        'current': round(crisis_now * 100, 2),
        'projected': trajectory[-1],
        'peak': round(max(trajectory), 2),
        'trajectory': trajectory,
    }


def model_diagnostics(model, features: np.ndarray, n_states: int) -> dict:
    """
    Information-criteria diagnostics for the fitted Gaussian HMM.

    AIC/BIC let you justify the choice of 4 states rather than asserting it —
    lower is better, and BIC penalizes complexity more heavily. Parameter
    count assumes full covariance matrices.
    """
    n_samples, n_dim = features.shape
    log_likelihood = float(model.score(features))

    # startprob (k-1) + transmat k*(k-1) + means k*d + full covars k*d*(d+1)/2
    k, d = n_states, n_dim
    n_params = (k - 1) + k * (k - 1) + k * d + k * d * (d + 1) // 2

    aic = -2.0 * log_likelihood + 2.0 * n_params
    bic = -2.0 * log_likelihood + n_params * np.log(n_samples)

    return {
        'log_likelihood': round(log_likelihood, 1),
        'aic': round(float(aic), 1),
        'bic': round(float(bic), 1),
        'n_params': int(n_params),
        'n_samples': int(n_samples),
    }
