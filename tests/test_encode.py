import json

import numpy as np
import pandas as pd

from regime.config import MAX_FILE_BYTES
from regime.encode import (
    decode_dates, decode_log_series, decode_posteriors, decode_runs, encode_dates,
    encode_log_series, encode_posteriors, encode_runs, encode_ticker, equity_sample_index,
    to_json, warm_start_from,
)

META = {'slug': 'SYN', 'sym': 'SYN', 'yahoo': 'SYN.NS', 'name': 'Synthetic Ltd', 'sector': 'Test',
        'cap': 'L', 'rank': 1, 'exchange': 'NSE'}


def test_dates_round_trip():
    d = pd.bdate_range('2016-10-03', periods=500)
    assert np.array_equal(decode_dates(encode_dates(d)), d.values.astype('datetime64[D]'))


def test_prices_round_trip_within_quantisation(market):
    df, _ = market
    c = df['Close'].to_numpy()
    back = decode_log_series(encode_log_series(c))
    assert np.max(np.abs(back / c - 1)) < 0.0003   # half a step of 1/2000 in log


def test_posteriors_round_trip():
    p = np.random.default_rng(0).dirichlet([1, 1, 1, 1], 300)
    back = decode_posteriors(encode_posteriors(p))
    assert np.allclose(back.sum(axis=1), 1)
    assert np.max(np.abs(back - p)) < 0.01


def test_runs_round_trip():
    reg = np.array([0, 0, 1, 1, 1, 3, 2])
    assert np.array_equal(decode_runs(encode_runs(reg), 7), reg)
    oos = decode_runs(encode_runs(reg[3:], 3), 7)
    assert oos.tolist() == [-1, -1, -1, 1, 1, 3, 2]


def test_equity_sample_index_keeps_last_point():
    assert equity_sample_index(11).tolist() == [0, 5, 10]
    assert equity_sample_index(12).tolist() == [0, 5, 10, 11]


def test_ticker_file_is_compact_and_deterministic(analysed):
    a = to_json(encode_ticker(analysed, META))
    b = to_json(encode_ticker(analysed, META))
    assert a == b
    assert len(a.encode()) <= MAX_FILE_BYTES
    payload = json.loads(a)
    assert payload['n'] == len(analysed['dates'])
    assert np.array_equal(decode_runs(payload['vit'], payload['n']), analysed['fit'].regimes)
    assert payload['today']['regime'] == analysed['today']['regime']


def test_warm_start_recovers_the_model(analysed):
    payload = json.loads(to_json(encode_ticker(analysed, META)))
    warm = warm_start_from(payload)
    assert np.allclose(warm['covars'], analysed['fit'].covars, atol=1e-4)
    assert np.allclose(warm['means'], analysed['fit'].means, atol=1e-4)
    assert warm_start_from({}) is None
