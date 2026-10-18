"""
REGIME — Synthetic markets
Generates OHLCV series from a known 4-regime Markov chain. The tests use it
to check that the model recovers regimes it was given, and the pipeline's
--synthetic mode uses it to exercise the full build without a network.
"""

import numpy as np
import pandas as pd

# Per-regime daily log-return drift and volatility, in REGIME_ORDER
# (Bullish, Accumulation, Bearish, Crisis).
DRIFT = np.array([0.0012, 0.0001, -0.0010, -0.0040])
VOL = np.array([0.010, 0.005, 0.016, 0.040])
STAY = np.array([0.985, 0.985, 0.975, 0.93])


def regime_path(n: int, rng: np.random.Generator, stay=STAY) -> np.ndarray:
    """Sample a regime path from a sticky Markov chain."""
    k = len(stay)
    path = np.empty(n, dtype=int)
    path[0] = 1
    for t in range(1, n):
        if rng.random() < stay[path[t - 1]]:
            path[t] = path[t - 1]
        else:
            path[t] = rng.choice([j for j in range(k) if j != path[t - 1]])
    return path


def synthetic_ohlcv(n: int = 2500, seed: int = 0, start: str = '2016-10-03',
                    zero_volume: bool = False, drift=DRIFT, vol=VOL, stay=STAY,
                    ) -> tuple[pd.DataFrame, np.ndarray]:
    """
    Returns (ohlcv DataFrame on business days, true regime path).
    Opens gap from the previous close by a fraction of the day's move, so
    next-open execution differs measurably from close-to-close.
    """
    rng = np.random.default_rng(seed)
    path = regime_path(n, rng, stay)
    ret = rng.normal(np.asarray(drift)[path], np.asarray(vol)[path])
    close = 100.0 * np.exp(np.cumsum(ret))
    prev = np.concatenate([[100.0], close[:-1]])
    gap = rng.uniform(0.2, 0.6, n)
    open_ = prev * np.exp(ret * gap)
    hi = np.maximum(open_, close) * np.exp(np.abs(rng.normal(0, 0.003, n)))
    lo = np.minimum(open_, close) * np.exp(-np.abs(rng.normal(0, 0.003, n)))
    volume = np.zeros(n) if zero_volume else rng.lognormal(13, 0.4, n) * (1 + 3 * (path == 3))
    idx = pd.bdate_range(start, periods=n)
    df = pd.DataFrame({'Open': open_, 'High': hi, 'Low': lo, 'Close': close, 'Volume': volume}, index=idx)
    return df, path
