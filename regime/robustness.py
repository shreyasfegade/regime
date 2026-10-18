"""
REGIME — Robustness
Evidence that a ticker's regime labels are a property of the data rather
than of one lucky fit:

  • seed_stability    — do fits from other random starts label the same days
                        the same way?
  • refit_stability   — do the walk-forward models, each fit on a shorter
                        history, agree with the full-history labels on the
                        days they share?
  • bic_by_k          — how many states does BIC prefer for this ticker?
  • confidence_score  — one 0-100 number that combines today's posterior
                        with both stability measures.

Labels are compared after semantic labelling, so state-number permutations
between fits cannot inflate or deflate agreement.
"""

import warnings

import numpy as np

from regime.config import BIC_KS, PRIMARY_SEED
from regime.model import fit_hmm, n_params


def agreement(a: np.ndarray, b: np.ndarray) -> float:
    """Share of days on which two regime paths agree."""
    a, b = np.asarray(a), np.asarray(b)
    if len(a) == 0 or len(a) != len(b):
        raise ValueError('Regime paths must be non-empty and the same length.')
    return float(np.mean(a == b))


def seed_stability(best, candidates) -> dict:
    """
    Agreement between the winning fit's labels and every other start's.

    Returns {n, agreement, per_start: [{seed, agreement, log_likelihood}]}.
    With a single start there is nothing to compare, so agreement is None.
    """
    others = [c for c in candidates if c is not best]
    per = [
        {
            'seed': c.seed,
            'agreement': round(agreement(best.regimes, c.regimes), 4),
            'log_likelihood': round(c.log_likelihood, 1),
        }
        for c in others
    ]
    value = float(np.mean([p['agreement'] for p in per])) if per else None
    return {
        'n': len(candidates),
        'agreement': round(value, 4) if value is not None else None,
        'per_start': per,
    }


def refit_stability(windows: list[dict]) -> dict:
    """
    Combine per-window agreement captured during the walk-forward.

    Each window dict holds {'agreement', 'days'}: the window model's labels
    on its own training span compared with the full-history labels for the
    same dates. The result is weighted by window length.
    """
    if not windows:
        return {'n': 0, 'agreement': None, 'per_window': []}
    days = np.array([w['days'] for w in windows], dtype=float)
    agree = np.array([w['agreement'] for w in windows], dtype=float)
    return {
        'n': len(windows),
        'agreement': round(float(np.sum(days * agree) / np.sum(days)), 4),
        'per_window': [round(float(a), 4) for a in agree],
    }


def bic_by_k(features: np.ndarray, ks: tuple[int, ...] = BIC_KS, fitted: dict | None = None) -> dict:
    """
    BIC for each candidate number of states (lower is better).

    `fitted` maps k → an already-fitted model to reuse (the primary 4-state
    fit), so it is not fit twice. A k that fails to converge is skipped.
    """
    fitted = fitted or {}
    n, d = features.shape
    values: dict[int, float] = {}
    for k in ks:
        try:
            model = fitted.get(k) or fit_hmm(features, k, PRIMARY_SEED)
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                ll = float(model.score(features))
        except (ValueError, np.linalg.LinAlgError):
            continue
        values[k] = -2.0 * ll + n_params(k, d) * np.log(n)
    if not values:
        return {'ks': [], 'bic': [], 'best': None}
    best = min(values, key=values.get)
    return {
        'ks': list(values),
        'bic': [round(float(v), 1) for v in values.values()],
        'best': int(best),
    }


def confidence_score(posterior_today: float, seed_agreement: float | None,
                     refit_agreement: float | None) -> dict:
    """
    REGIME confidence score: 100 × the geometric mean of today's posterior
    probability for the current regime, seed stability and refit stability.

    A geometric mean means one weak component pulls the score down hard,
    which is the intent: a confident posterior from an unstable model is not
    a confident call. Missing components (too little history for a
    walk-forward) are left out and reported as such.
    """
    parts = {
        'posterior': posterior_today,
        'seeds': seed_agreement,
        'refits': refit_agreement,
    }
    used = [float(v) for v in parts.values() if v is not None]
    if not used:
        raise ValueError('At least one component is required.')
    clipped = np.clip(used, 1e-9, 1.0)
    score = float(np.exp(np.mean(np.log(clipped)))) * 100
    return {
        'value': round(score, 1),
        'components': {k: (round(float(v), 4) if v is not None else None) for k, v in parts.items()},
    }
