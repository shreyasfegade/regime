import numpy as np
import pytest

from regime.analytics import crisis_early_warning, forward_return_edge, model_diagnostics
from regime.config import CRISIS_IDX


def test_forward_edge_by_hand():
    close = np.array([100, 110, 121, 121, 121, 133.1])
    reg = np.array([0, 0, 1, 1, 1, 1])
    edge = forward_return_edge(close, reg, horizons=(1,))['1']
    assert edge[0]['mean'] == pytest.approx(10.0)
    assert edge[0]['samples'] == 2
    assert edge[1]['samples'] == 3            # the last day has no forward return
    assert edge[2] is None and edge[3] is None


def test_crisis_warning_absorbing_state_rises_monotonically():
    t = np.eye(4) * 0.9
    t[:, CRISIS_IDX] += 0.1
    t[CRISIS_IDX] = [0, 0, 0, 1]
    cw = crisis_early_warning(t, np.array([1, 0, 0, 0]), horizon=5)
    traj = cw['trajectory']
    assert traj[0] == 0 and len(traj) == 6
    assert all(b >= a for a, b in zip(traj, traj[1:]))
    assert cw['peak'] == traj[-1] and 0 <= cw['peak'] <= 100


def test_diagnostics_information_criteria():
    d = model_diagnostics(-1000.0, 2000, 5, 4)
    assert d['n_params'] == 3 + 12 + 20 + 60
    assert d['aic'] == pytest.approx(2000 + 2 * 95)
    assert d['bic'] == pytest.approx(2000 + 95 * np.log(2000), abs=0.1)
