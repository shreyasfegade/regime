"""
REGIME — HMM Model
Fits a Gaussian HMM, decodes hidden states via Viterbi, auto-labels states
by inspecting learned emission parameters, and computes regime analytics.
"""

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM

from config import (
    COVARIANCE_TYPE,
    LABEL_ACCUMULATION,
    LABEL_BEARISH,
    LABEL_BULLISH,
    LABEL_CRISIS,
    N_ITER,
    N_STATES,
    RANDOM_STATE,
    VOLATILITY_WINDOW_LONG,
    VOLUME_ZSCORE_WINDOW,
)


def fit_hmm(features: np.ndarray) -> GaussianHMM:
    """
    Fit a 4-state Gaussian HMM to the normalized feature matrix.

    Args:
        features: (n, 5) array of normalized features.

    Returns:
        Trained GaussianHMM model.
    """
    model = GaussianHMM(
        n_components=N_STATES,
        covariance_type=COVARIANCE_TYPE,
        n_iter=N_ITER,
        random_state=RANDOM_STATE,
        verbose=False,
    )
    model.fit(features)
    return model


def decode_states(
    model: GaussianHMM,
    features: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Decode hidden state sequence and compute posterior probabilities.

    Args:
        model:    Trained GaussianHMM.
        features: (n, 5) array of normalized features.

    Returns:
        state_sequence: (n,) array of most likely state index per day (Viterbi).
        state_probs:    (n, 4) array of posterior probabilities per state per day.
    """
    state_sequence = model.predict(features)
    state_probs = model.predict_proba(features)
    return state_sequence, state_probs


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


def compute_persistence_forecast(
    model: GaussianHMM,
    current_state: int,
) -> float:
    """
    Expected remaining days in the current regime before a transition.

    Formula: 1 / (1 - P(stay in same state))
    where P(stay) = model.transmat_[current_state, current_state]

    Args:
        model:         Trained GaussianHMM.
        current_state: Integer index of the current state.

    Returns:
        Expected remaining days (float).
    """
    self_transition = model.transmat_[current_state, current_state]
    if self_transition >= 1.0:
        return float('inf')
    return 1.0 / (1.0 - self_transition)


def compute_regime_stats(
    df: pd.DataFrame,
    state_sequence: np.ndarray,
    label_map: dict[int, str],
) -> pd.DataFrame:
    """
    Per-regime statistical breakdown aligned with the feature window.

    Args:
        df:             OHLCV DataFrame trimmed to match state_sequence length.
        state_sequence: (n,) array of state indices.
        label_map:      Dict mapping state_index → label string.

    Returns:
        DataFrame with columns: regime, days_count, pct_time,
        avg_daily_return, avg_volatility, avg_volume_zscore.
    """
    close = df['Close'].values
    volume = df['Volume'].values

    log_returns = _compute_log_returns(close)
    vol_20d = _compute_rolling_vol(log_returns)
    vol_zscore = _compute_volume_zscore(volume)

    records: list[dict] = []
    total_days = len(state_sequence)

    for state_idx, label in sorted(label_map.items()):
        mask = state_sequence == state_idx
        days = int(mask.sum())
        records.append({
            'regime': label,
            'days_count': days,
            'pct_time': round(days / total_days * 100, 1),
            'avg_daily_return': round(float(np.nanmean(log_returns[mask])) * 100, 4),
            'avg_volatility': round(float(np.nanmean(vol_20d[mask])) * 100, 4),
            'avg_volume_zscore': round(float(np.nanmean(vol_zscore[mask])), 2),
        })

    return pd.DataFrame(records)


def get_regime_blocks(
    dates: pd.DatetimeIndex,
    state_sequence: np.ndarray,
    label_map: dict[int, str],
) -> list[tuple[pd.Timestamp, pd.Timestamp, str]]:
    """
    Group consecutive same-regime days into contiguous blocks.

    Returns:
        List of (start_date, end_date, label) tuples.
    """
    blocks: list[tuple[pd.Timestamp, pd.Timestamp, str]] = []
    if len(state_sequence) == 0:
        return blocks

    current_state = state_sequence[0]
    block_start = dates[0]

    for i in range(1, len(state_sequence)):
        if state_sequence[i] != current_state:
            blocks.append((
                block_start,
                dates[i - 1],
                label_map[current_state],
            ))
            current_state = state_sequence[i]
            block_start = dates[i]

    # Final block
    blocks.append((
        block_start,
        dates[-1],
        label_map[current_state],
    ))

    return blocks


# ─── Private Helpers ─────────────────────────────────────────────────

def _compute_log_returns(close: np.ndarray) -> np.ndarray:
    """Compute log returns from close prices."""
    log_ret = np.zeros_like(close, dtype=float)
    log_ret[1:] = np.log(close[1:] / close[:-1])
    log_ret[0] = np.nan
    return log_ret


def _compute_rolling_vol(log_returns: np.ndarray) -> np.ndarray:
    """Compute rolling standard deviation of log returns."""
    series = pd.Series(log_returns)
    rolling = series.rolling(window=VOLATILITY_WINDOW_LONG).std()
    return rolling.values


def _compute_volume_zscore(volume: np.ndarray) -> np.ndarray:
    """Compute rolling z-score of volume."""
    series = pd.Series(volume, dtype=float)
    rolling_mean = series.rolling(window=VOLUME_ZSCORE_WINDOW).mean()
    rolling_std = series.rolling(window=VOLUME_ZSCORE_WINDOW).std()
    zscore = (series - rolling_mean) / rolling_std
    return zscore.values
