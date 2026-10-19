"""
REGIME — Per-ticker analysis
Runs the whole computation for one cleaned OHLCV series: features, the
multi-start fit, robustness, walk-forward, both backtests and the signal
analytics. Pure computation, no I/O; regime.encode turns the result into
the compact file the site reads.
"""

import numpy as np
import pandas as pd

from regime.analytics import crisis_early_warning, forward_return_edge, model_diagnostics
from regime.backtest import run_backtest, run_walkforward
from regime.config import N_STATES, SEEDS
from regime.features import engineer_features, raw_feature_matrix
from regime.model import compute_persistence_forecast, days_in_current, fit_best, regime_stats
from regime.robustness import bic_by_k, confidence_score, refit_stability, seed_stability


def analyze(df: pd.DataFrame, warm: dict | None = None, exchange: str = 'NSE',
            cap: str = 'L', seeds: tuple[int, ...] = SEEDS) -> dict:
    """
    Full analysis of one series.

    Args:
        df:       cleaned OHLCV (regime.data.clean_ohlcv).
        warm:     previous run's model {'transmat','means','covars'} in regime
                  order, used as one extra EM start.
        exchange: 'NSE' or 'BSE', for the transaction charge.
        cap:      'L' / 'M' / 'S' / 'I', for slippage.
    """
    features, dates, scaler = engineer_features(df)
    raw, raw_dates = raw_feature_matrix(df)
    assert raw_dates.equals(dates)
    trimmed = df.loc[dates]
    close = trimmed['Close'].to_numpy(dtype=float)
    open_ = trimmed['Open'].to_numpy(dtype=float)

    best = fit_best(features, seeds, warm)
    regimes = best.regimes
    today_regime = int(regimes[-1])
    posterior_today = float(best.posteriors[-1, today_regime])

    seeds_info = seed_stability(best, best.candidates)
    bic = bic_by_k(features, fitted={N_STATES: best.model})

    wf = run_walkforward(raw, regimes)
    refits = refit_stability(wf['windows'] if wf else [])
    score = confidence_score(posterior_today, seeds_info['agreement'], refits['agreement'])

    bt_is = run_backtest(open_, close, dates, regimes, 0, exchange, cap)
    bt_oos = run_backtest(open_, close, dates, wf['regimes'], wf['split'], exchange, cap) if wf else None

    return {
        'dates': dates,
        'close': close,
        'scaler': {'mean': scaler.mean_, 'scale': scaler.scale_},
        'features': features,
        'fit': best,
        'today': {
            'regime': today_regime,
            'posterior': posterior_today,
            'days_in': days_in_current(regimes),
            'expected_remaining': compute_persistence_forecast(best.transmat, today_regime),
        },
        'stats': regime_stats(close, regimes),
        'forward_edge': forward_return_edge(close, regimes),
        'crisis_warning': crisis_early_warning(best.transmat, best.posteriors[-1]),
        'diagnostics': model_diagnostics(best.log_likelihood, len(features),
                                         features.shape[1], N_STATES),
        'robustness': {'seeds': seeds_info, 'refits': refits, 'bic': bic, 'score': score},
        'walkforward': wf,
        'backtest': {'is': bt_is, 'oos': bt_oos},
    }
