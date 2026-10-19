import numpy as np

from regime.config import WARMUP_PERIOD
from regime.features import engineer_features, raw_feature_matrix
from regime.synthetic import synthetic_ohlcv


def test_shapes_and_warmup(market):
    df, _ = market
    x, dates, scaler = engineer_features(df)
    assert x.shape == (len(df) - WARMUP_PERIOD, 5)
    assert dates[0] == df.index[WARMUP_PERIOD]
    assert np.allclose(x.mean(axis=0), 0, atol=1e-9)
    assert np.allclose(x.std(axis=0), 1, atol=1e-9)


def test_raw_matrix_matches_normalised(market):
    df, _ = market
    x, dates, scaler = engineer_features(df)
    raw, raw_dates = raw_feature_matrix(df)
    assert raw_dates.equals(dates)
    assert np.allclose(scaler.transform(raw), x)


def test_zero_volume_index_keeps_every_row():
    df, _ = synthetic_ohlcv(600, seed=1, zero_volume=True)
    x, dates, _ = engineer_features(df)
    assert len(x) == 600 - WARMUP_PERIOD
    raw, _ = raw_feature_matrix(df)
    assert np.all(raw[:, 3] == 0.0)


def test_features_use_only_the_past(market):
    df, _ = market
    raw, _ = raw_feature_matrix(df)
    shocked = df.copy()
    shocked.iloc[1500:, :4] *= 1.7
    raw2, _ = raw_feature_matrix(shocked)
    cut = 1500 - WARMUP_PERIOD
    assert np.allclose(raw[:cut], raw2[:cut])
