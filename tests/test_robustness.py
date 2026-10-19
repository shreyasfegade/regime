from dataclasses import replace

import numpy as np
import pytest

from regime.robustness import agreement, bic_by_k, confidence_score, refit_stability, seed_stability


def test_agreement_bounds():
    a = np.array([0, 1, 2, 3])
    assert agreement(a, a) == 1.0
    assert agreement(a, np.array([0, 1, 0, 0])) == 0.5
    with pytest.raises(ValueError):
        agreement(a, a[:2])


def test_seed_stability_identical_fits_agree_fully(analysed):
    fit = analysed['fit']
    s = seed_stability(fit, [fit, replace(fit)])
    assert s['agreement'] == 1.0 and s['n'] == 2
    assert seed_stability(fit, [fit])['agreement'] is None


def test_robustness_in_analysis_is_bounded(analysed):
    rob = analysed['robustness']
    assert 0 <= rob['seeds']['agreement'] <= 1
    assert 0 <= rob['refits']['agreement'] <= 1
    assert rob['refits']['n'] == len(analysed['walkforward']['windows'])
    assert 0 <= rob['score']['value'] <= 100


def test_refit_stability_is_length_weighted():
    r = refit_stability([{'agreement': 1.0, 'days': 300}, {'agreement': 0.5, 'days': 100}])
    assert r['agreement'] == pytest.approx(0.875)
    assert refit_stability([])['agreement'] is None


def test_bic_recovers_the_number_of_states_of_a_gaussian_hmm():
    # Draw from a genuine 3-state Gaussian HMM; BIC should pick k = 3.
    from hmmlearn.hmm import GaussianHMM
    true = GaussianHMM(n_components=3, covariance_type='full', random_state=0)
    true.startprob_ = np.array([1.0, 0.0, 0.0])
    true.transmat_ = np.array([[0.97, 0.02, 0.01], [0.02, 0.97, 0.01], [0.03, 0.03, 0.94]])
    true.means_ = np.array([[1.0, -1.0, 0.0, 0.5, 0.0], [-1.0, 1.0, 0.5, 0.0, 0.0], [0.0, 0.0, -2.0, -1.0, 2.0]])
    true.covars_ = np.stack([np.eye(5) * v for v in (0.3, 0.5, 0.8)])
    x, _ = true.sample(2000, random_state=1)
    out = bic_by_k(x, ks=(2, 3, 4, 5))
    assert out['best'] == 3
    assert out['bic'][out['ks'].index(3)] == min(out['bic'])


def test_confidence_score_formula_and_monotonicity():
    s = confidence_score(0.9, 0.9, 0.9)
    assert s['value'] == pytest.approx(90.0)
    assert confidence_score(0.9, 0.5, 0.9)['value'] < s['value']
    assert confidence_score(1.0, 1.0, None)['value'] == 100.0
    assert confidence_score(1.0, 1.0, None)['components']['refits'] is None
    assert confidence_score(0.8, 0.2, 0.5)['value'] == pytest.approx(100 * (0.8 * 0.2 * 0.5) ** (1 / 3), abs=0.05)
