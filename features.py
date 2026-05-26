"""
REGIME — Feature Engineering
Transforms raw OHLCV data into the 5-feature matrix consumed by the HMM.
Returns normalized features, aligned date index, and the fitted scaler.
"""

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from config import (
    MOMENTUM_WINDOW,
    VOLATILITY_WINDOW_LONG,
    VOLATILITY_WINDOW_SHORT,
    VOLUME_ZSCORE_WINDOW,
    WARMUP_PERIOD,
)


def engineer_features(
    df: pd.DataFrame,
) -> tuple[np.ndarray, pd.DatetimeIndex, StandardScaler]:
    """
    Compute 5 statistical features from OHLCV data and normalize.

    Features (column order matters):
        0 — log_return:     log(Close_t / Close_{t-1})
        1 — volatility_5d:  rolling std of log_return, window=5
        2 — volatility_20d: rolling std of log_return, window=20
        3 — volume_zscore:  (Volume - rolling_mean_20d) / rolling_std_20d
        4 — momentum_10d:   log(Close_t / Close_{t-10})

    Args:
        df: Clean OHLCV DataFrame with DatetimeIndex.

    Returns:
        features_array: (n, 5) numpy array of normalized features.
        dates_index:     DatetimeIndex aligned with features_array rows.
        scaler:          Fitted StandardScaler for potential inverse transforms.
    """
    raw_features = _compute_raw_features(df)
    trimmed = _trim_warmup(raw_features)
    features_array, scaler = _normalize(trimmed)
    dates_index = trimmed.index
    return features_array, dates_index, scaler


def _compute_raw_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute all 5 raw features from the OHLCV DataFrame."""
    close = df['Close']
    volume = df['Volume']

    log_return = np.log(close / close.shift(1))

    volatility_5d = log_return.rolling(
        window=VOLATILITY_WINDOW_SHORT
    ).std()

    volatility_20d = log_return.rolling(
        window=VOLATILITY_WINDOW_LONG
    ).std()

    vol_mean = volume.rolling(window=VOLUME_ZSCORE_WINDOW).mean()
    vol_std = volume.rolling(window=VOLUME_ZSCORE_WINDOW).std()
    volume_zscore = (volume - vol_mean) / vol_std

    momentum_10d = np.log(close / close.shift(MOMENTUM_WINDOW))

    features = pd.DataFrame(
        {
            'log_return': log_return,
            'volatility_5d': volatility_5d,
            'volatility_20d': volatility_20d,
            'volume_zscore': volume_zscore,
            'momentum_10d': momentum_10d,
        },
        index=df.index,
    )
    return features


def _trim_warmup(features: pd.DataFrame) -> pd.DataFrame:
    """Drop the first WARMUP_PERIOD rows (NaN from rolling windows)."""
    trimmed = features.iloc[WARMUP_PERIOD:].copy()
    trimmed = trimmed.dropna()
    return trimmed


def _normalize(
    features: pd.DataFrame,
) -> tuple[np.ndarray, StandardScaler]:
    """StandardScaler normalize the feature matrix."""
    scaler = StandardScaler()
    normalized = scaler.fit_transform(features.values)
    return normalized, scaler
