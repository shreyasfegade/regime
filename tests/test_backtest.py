import math

import numpy as np
import pandas as pd
import pytest

from regime.backtest import (
    deflated_sharpe, expected_max_sharpe_from_var, probabilistic_sharpe, psr_from_moments,
    run_backtest, run_walkforward, sharpe_per_period, simulate,
)
from regime.config import TRIAL_EXPOSURES, TRIAL_LAGS, WF_MIN_TRAIN, WF_STEP
from regime.costs import rebalance_cost_fraction
from regime.features import raw_feature_matrix

FREE = {'stt': 0, 'txn_nse': 0, 'txn_bse': 0, 'sebi': 0, 'stamp_buy': 0, 'gst': 0, 'dp_per_sell': 0, 'brokerage': 0}


@pytest.fixture
def no_costs(monkeypatch):
    import regime.costs as c
    monkeypatch.setattr(c, 'COSTS', FREE)
    monkeypatch.setattr(c, 'SLIPPAGE_BPS', {'L': 0, 'M': 0, 'S': 0, 'I': 0})


def test_next_open_execution_by_hand(no_costs):
    o = np.array([100, 102, 105, 103, 108], dtype=float)
    c = np.array([101, 104, 104, 106, 110], dtype=float)
    # Bullish signal at the close of day 1 → filled at the open of day 2.
    reg = np.array([2, 0, 0, 2, 2])
    sim = simulate(o, c, reg)
    assert sim['weights'].tolist() == [0, 0, 1, 1, 0]
    expect = [0, 0, 104 / 105 - 1, (103 / 104) * (106 / 103) - 1, 108 / 106 - 1]
    assert np.allclose(sim['strategy'], expect)
    # Buy and hold earns close-to-close.
    assert np.allclose(sim['benchmark'][1:], c[1:] / c[:-1] - 1)


def test_lag_two_fills_a_session_later(no_costs):
    o = np.full(6, 100.0)
    c = np.full(6, 100.0)
    sim = simulate(o, c, np.array([0, 2, 2, 2, 2, 2]), lag=2)
    assert sim['weights'].tolist() == [0, 0, 1, 0, 0, 0]


def test_costs_are_charged_on_each_switch():
    o = c = np.full(4, 100.0)
    sim = simulate(o, c, np.array([0, 2, 2, 2]))
    entry = rebalance_cost_fraction(0, 1, 1)['total']
    exit_ = rebalance_cost_fraction(1, 0, 1 - entry)['total']
    assert sim['strategy'][1] == pytest.approx(-entry)
    assert sim['strategy'][2] == pytest.approx(-exit_)
    assert sim['turnover'].sum() == 2


def test_no_lookahead_in_execution(market, analysed):
    df, _ = market
    reg = analysed['fit'].regimes
    close = analysed['close']
    o = df.loc[analysed['dates'], 'Open'].to_numpy()
    base = simulate(o, close, reg)
    t = 1800
    reg2 = reg.copy()
    reg2[t + 1:] = (reg2[t + 1:] + 1) % 4
    alt = simulate(o, close, reg2)
    # Weights up to the open of t+1 depend only on signals up to close t.
    assert np.array_equal(base['weights'][:t + 2], alt['weights'][:t + 2])
    assert np.allclose(base['strategy'][:t + 2], alt['strategy'][:t + 2])


def test_walkforward_split_and_refits(analysed):
    wf = analysed['walkforward']
    n = len(analysed['dates'])
    assert wf['split'] == WF_MIN_TRAIN
    assert np.all(wf['regimes'][:WF_MIN_TRAIN] == -1)
    assert np.all(wf['regimes'][WF_MIN_TRAIN:] >= 0)
    assert len(wf['windows']) == math.ceil((n - WF_MIN_TRAIN) / WF_STEP)


def test_walkforward_never_sees_the_future(market, analysed):
    df, _ = market
    raw, _ = raw_feature_matrix(df)
    cut = WF_MIN_TRAIN + 2 * WF_STEP + 40      # mid-block
    shocked = raw.copy()
    shocked[cut:] = shocked[cut:] * 3 + 1
    full = analysed['fit'].regimes
    a = run_walkforward(raw[:cut + 200], full[:cut + 200])
    b = run_walkforward(shocked[:cut + 200], full[:cut + 200])
    assert np.array_equal(a['regimes'][:cut], b['regimes'][:cut])


def test_short_history_has_no_walkforward():
    assert run_walkforward(np.zeros((WF_MIN_TRAIN + WF_STEP, 5)), np.zeros(1, int)) is None


def test_backtest_reports_trials_and_overfitting_stats(analysed):
    bt = analysed['backtest']['oos']
    m = bt['metrics']
    assert m['n_trials'] == len(TRIAL_EXPOSURES) * len(TRIAL_LAGS)
    assert 0 <= m['dsr'] <= 1 and 0 <= m['psr_vs_buy_hold'] <= 1
    assert m['cost_drag_pct_per_year']['total'] > 0
    assert bt['start'] == analysed['dates'][WF_MIN_TRAIN].strftime('%Y-%m-%d')
    assert len(bt['strategy_equity']) == len(analysed['dates']) - WF_MIN_TRAIN


def test_psr_is_half_at_its_own_sharpe():
    r = np.random.default_rng(0).normal(0.001, 0.01, 1000)
    assert probabilistic_sharpe(r, sharpe_per_period(r)) == pytest.approx(0.5)
    assert probabilistic_sharpe(r, -1) > 0.99


def test_deflated_sharpe_matches_the_paper():
    # Bailey & López de Prado (2014), worked example: SR 2.5/yr, T = 1250,
    # V[SR] = 0.5/yr across N = 100 trials, skew −3, kurtosis 10 → DSR 0.9004.
    sr0 = expected_max_sharpe_from_var(0.5 / 250, 100)
    assert sr0 == pytest.approx(0.1132, abs=1e-4)
    assert psr_from_moments(2.5 / math.sqrt(250), sr0, 1250, -3, 10) == pytest.approx(0.9004, abs=1e-4)


def test_deflated_sharpe_falls_with_more_dispersed_trials():
    r = np.random.default_rng(1).normal(0.0008, 0.01, 1500)
    tight = deflated_sharpe(r, [0.05, 0.051, 0.049])
    wide = deflated_sharpe(r, [0.0, 0.05, 0.1])
    assert wide < tight
