"""Shared fixtures. Every test runs offline: outbound sockets are blocked."""

import logging
import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
logging.getLogger('hmmlearn').setLevel(logging.ERROR)

from regime.synthetic import synthetic_ohlcv  # noqa: E402

# Regimes far enough apart that a correct fit should recover them.
SEPARATED = dict(
    drift=[0.0015, 0.0, -0.0015, -0.006],
    vol=[0.008, 0.004, 0.016, 0.045],
    stay=[0.99, 0.99, 0.985, 0.96],
)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    def guard(*args, **kwargs):
        raise RuntimeError('Network access is disabled in tests.')
    monkeypatch.setattr(socket.socket, 'connect', guard)
    monkeypatch.setattr(socket, 'create_connection', guard)


@pytest.fixture(scope='session')
def market():
    """A 10-year synthetic market with well-separated regimes."""
    return synthetic_ohlcv(2500, seed=11, **SEPARATED)


@pytest.fixture(scope='session')
def analysed(market):
    from regime.analysis import analyze
    df, _ = market
    return analyze(df, seeds=(42, 7, 1234))
