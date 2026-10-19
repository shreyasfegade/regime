import numpy as np
import pytest

from regime.config import CRISIS_IDX, REGIME_ORDER
from regime.features import engineer_features
from regime.model import (
    canonical_permutation, compute_persistence_forecast, days_in_current, filtered_posteriors,
    fit_best, fit_hmm, label_states, regime_stats, runs,
)


def test_recovers_known_regimes(market, analysed):
    _, path = market
    fit = analysed['fit']
    truth = path[-len(fit.regimes):]
    assert np.mean(truth == fit.regimes) >= 0.8


def test_crisis_is_highest_volatility_state(analysed):
    fit = analysed['fit']
    assert np.argmax(fit.means[:, 2]) == CRISIS_IDX
    # Bullish has the higher mean return of the two trending regimes.
    assert fit.means[0, 0] > fit.means[2, 0]


def test_canonical_outputs_are_consistent(market):
    df, _ = market
    x, _, _ = engineer_features(df)
    model = fit_hmm(x)
    perm = canonical_permutation(label_states(model))
    assert sorted(perm.tolist()) == [0, 1, 2, 3]
    best = fit_best(x, seeds=(42,))
    assert np.allclose(best.posteriors.sum(axis=1), 1)
    assert np.allclose(best.transmat.sum(axis=1), 1)
    assert set(np.unique(best.regimes)) <= set(range(len(REGIME_ORDER)))


def test_best_of_seeds_has_highest_likelihood(analysed):
    fit = analysed['fit']
    assert fit.log_likelihood == max(c.log_likelihood for c in fit.candidates)
    assert len(fit.candidates) == 3


def test_warm_start_reproduces_the_fit(market, analysed):
    df, _ = market
    x, _, _ = engineer_features(df)
    fit = analysed['fit']
    warm = {'transmat': fit.transmat, 'means': fit.means, 'covars': fit.covars}
    again = fit_best(x, seeds=(), warm=warm)
    assert np.mean(again.regimes == fit.regimes) > 0.98
    assert again.log_likelihood == pytest.approx(fit.log_likelihood, rel=1e-3)


def test_persistence_formula():
    t = np.array([[0.9, 0.1], [0.5, 0.5]])
    assert compute_persistence_forecast(t, 0) == pytest.approx(10.0)
    assert compute_persistence_forecast(t, 1) == pytest.approx(2.0)
    assert compute_persistence_forecast(np.eye(2), 0) == float('inf')


def test_runs_and_days_in_current():
    path = np.array([1, 1, 0, 0, 0, 3, 2, 2])
    assert runs(path) == [(0, 2, 1), (2, 3, 0), (5, 1, 3), (6, 2, 2)]
    assert days_in_current(path) == 2
    assert runs(np.array([])) == []


def test_regime_stats_cover_every_regime():
    close = np.exp(np.cumsum(np.full(10, 0.01))) * 100
    stats = regime_stats(close, np.array([0] * 6 + [1] * 4))
    assert [s['days'] for s in stats] == [6, 4, 0, 0]
    assert stats[0]['avg_ret'] == pytest.approx(1.0, abs=1e-3)
    assert stats[3]['avg_ret'] is None and stats[3]['runs'] == 0
    assert sum(s['pct'] for s in stats) == pytest.approx(100.0)


def test_filtered_posteriors_ignore_the_future(market):
    df, _ = market
    x, _, _ = engineer_features(df)
    model = fit_hmm(x)
    full = filtered_posteriors(model, x)
    head = filtered_posteriors(model, x[:900])
    assert np.allclose(full[:900], head)
    assert np.allclose(full.sum(axis=1), 1)
    # On the last day filtering and smoothing see the same data.
    assert np.allclose(full[-1], model.predict_proba(x)[-1], atol=1e-6)
