"""
REGIME — Quant Analytics
Signal-quality and risk diagnostics that sit on top of the fitted HMM:

  • forward_return_edge   — does each regime actually predict forward returns?
  • crisis_early_warning  — probability of rotating into Crisis over a horizon,
                            propagated through the transition matrix
  • model_diagnostics     — log-likelihood, AIC, BIC for model-selection rigor

Every function takes regimes as indices in config.REGIME_ORDER.
"""

import numpy as np

from regime.config import CRISIS_HORIZON, CRISIS_IDX, FORWARD_HORIZONS, REGIME_ORDER
from regime.model import n_params


def forward_return_edge(
    close: np.ndarray,
    regimes: np.ndarray,
    horizons: tuple[int, ...] = FORWARD_HORIZONS,
) -> dict:
    """
    For each regime, the distribution of the *next* h-session return
    conditioned on being in that regime today.

    This is the core "is the signal real?" test: a regime that classifies the
    past is only useful if, on average, what follows it differs by regime.

    Returns {str(h): [per-regime {mean, median, win_rate, samples} | None]}
    with returns in percent, regimes in REGIME_ORDER.
    """
    close = np.asarray(close, dtype=float)
    n = len(close)
    out: dict[str, list] = {}
    for h in horizons:
        fwd = np.full(n, np.nan)
        if n > h:
            fwd[:n - h] = close[h:] / close[:n - h] - 1.0
        rows = []
        for r in range(len(REGIME_ORDER)):
            vals = fwd[(regimes == r) & ~np.isnan(fwd)]
            if len(vals) == 0:
                rows.append(None)
                continue
            rows.append({
                'mean': round(float(np.mean(vals)) * 100, 3),
                'median': round(float(np.median(vals)) * 100, 3),
                'win_rate': round(float(np.mean(vals > 0)) * 100, 1),
                'samples': int(len(vals)),
            })
        out[str(h)] = rows
    return out


def crisis_early_warning(
    transmat: np.ndarray,
    current_probs: np.ndarray,
    horizon: int = CRISIS_HORIZON,
) -> dict:
    """
    Propagate today's posterior distribution (regime order) forward through
    the transition matrix to estimate the probability of being in Crisis on
    each of the next `horizon` sessions.

    Returns {horizon, current, projected, peak, trajectory[]} in percent.
    """
    T = np.asarray(transmat, dtype=float)
    d = np.asarray(current_probs, dtype=float)
    d = d / d.sum() if d.sum() > 0 else d
    trajectory = [round(float(d[CRISIS_IDX]) * 100, 2)]
    for _ in range(horizon):
        d = d @ T
        trajectory.append(round(float(d[CRISIS_IDX]) * 100, 2))
    return {
        'horizon': horizon,
        'current': trajectory[0],
        'projected': trajectory[-1],
        'peak': round(max(trajectory), 2),
        'trajectory': trajectory,
    }


def model_diagnostics(log_likelihood: float, n_samples: int, n_dim: int, n_states: int) -> dict:
    """
    Information-criteria diagnostics for the fitted Gaussian HMM. AIC and
    BIC (lower is better; BIC penalises complexity more heavily) let the
    choice of states be justified rather than asserted.
    """
    k = n_params(n_states, n_dim)
    return {
        'log_likelihood': round(log_likelihood, 1),
        'aic': round(-2.0 * log_likelihood + 2.0 * k, 1),
        'bic': round(float(-2.0 * log_likelihood + k * np.log(n_samples)), 1),
        'n_params': int(k),
        'n_samples': int(n_samples),
    }
