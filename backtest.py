"""
REGIME — Backtesting Engine
Turns the regime classification into a tradable signal and measures how it
would have performed against simply buying and holding.

Strategy — "Regime Rotation":
    Each regime maps to a target market exposure (config.REGIME_EXPOSURE):
        Bullish Trending → 100% invested
        Accumulation     →  50% invested
        Bearish Trending →   0% (cash)
        Crisis           →   0% (cash)
    The position for day t is decided by the regime observed at the close of
    day t-1, so the strategy only ever acts on information it already had —
    a one-bar execution lag that removes immediate lookahead. A round-trip
    cost (config.BACKTEST_COST_BPS) is charged whenever exposure changes.

Honest caveat (surfaced in the UI and README):
    The HMM is fit once over the full history, so the *regime labels* are
    in-sample. This is a research/diagnostic backtest of the regime concept,
    not a walk-forward out-of-sample trading record. The one-bar lag and
    costs make it fair, not predictive.
"""

import numpy as np
import pandas as pd

from config import (
    BACKTEST_COST_BPS,
    REGIME_EXPOSURE,
    TRADING_DAYS_PER_YEAR,
)


def run_backtest(
    close: np.ndarray,
    dates: pd.DatetimeIndex,
    state_sequence: np.ndarray,
    label_map: dict[int, str],
) -> dict:
    """
    Run the regime-rotation backtest and package results for the API.

    Args:
        close:          (n,) close prices aligned with state_sequence.
        dates:          DatetimeIndex aligned with close.
        state_sequence: (n,) HMM state index per day.
        label_map:      state_index → regime label.

    Returns:
        dict with strategy/benchmark equity curves, per-strategy metrics,
        and the drawdown series for the strategy.
    """
    close = np.asarray(close, dtype=float)
    n = len(close)

    daily_ret = np.zeros(n)
    daily_ret[1:] = close[1:] / close[:-1] - 1.0

    # Target exposure from yesterday's regime (one-bar lag, no lookahead).
    target = np.array(
        [REGIME_EXPOSURE.get(label_map[int(s)], 0.0) for s in state_sequence]
    )
    position = np.zeros(n)
    position[1:] = target[:-1]  # act on day t using regime known at t-1 close

    # Transaction cost charged on the day exposure changes.
    cost = np.zeros(n)
    turnover = np.abs(np.diff(position, prepend=position[0]))
    cost = turnover * (BACKTEST_COST_BPS / 10_000.0)

    strat_ret = position * daily_ret - cost
    strat_equity = np.cumprod(1.0 + strat_ret)
    bench_equity = np.cumprod(1.0 + daily_ret)

    metrics = _compute_metrics(
        strat_ret, daily_ret, position, dates, turnover,
    )
    drawdown = _drawdown_series(strat_equity)

    return {
        'dates': [d.strftime('%Y-%m-%d') for d in dates],
        'strategy_equity': [round(float(v), 4) for v in strat_equity],
        'benchmark_equity': [round(float(v), 4) for v in bench_equity],
        'strategy_drawdown': [round(float(v), 4) for v in drawdown],
        'metrics': metrics,
        'cost_bps': BACKTEST_COST_BPS,
    }


def _compute_metrics(
    strat_ret: np.ndarray,
    bench_ret: np.ndarray,
    position: np.ndarray,
    dates: pd.DatetimeIndex,
    turnover: np.ndarray,
) -> dict:
    """Compute the full metrics block for strategy and benchmark."""
    years = max((dates[-1] - dates[0]).days / 365.25, 1e-9)

    strat = _performance(strat_ret, years)
    bench = _performance(bench_ret, years)

    # A "trade" is any day the position changed by a meaningful amount.
    trades = int(np.sum(turnover > 1e-9))
    exposure = float(np.mean(position))

    return {
        'years': round(float(years), 2),
        'strategy': strat,
        'benchmark': bench,
        'excess_cagr': round(strat['cagr'] - bench['cagr'], 2),
        'time_in_market': round(exposure * 100, 1),
        'trades': trades,
    }


def _performance(returns: np.ndarray, years: float) -> dict:
    """Standard performance stats for a daily return stream."""
    equity = np.cumprod(1.0 + returns)
    total_return = float(equity[-1] - 1.0)
    cagr = float(equity[-1] ** (1.0 / years) - 1.0) if equity[-1] > 0 else -1.0

    ann_vol = float(np.std(returns, ddof=1) * np.sqrt(TRADING_DAYS_PER_YEAR))
    mean_daily = float(np.mean(returns))
    sharpe = (
        mean_daily / np.std(returns, ddof=1) * np.sqrt(TRADING_DAYS_PER_YEAR)
        if np.std(returns, ddof=1) > 0 else 0.0
    )

    downside = returns[returns < 0]
    downside_std = float(np.std(downside, ddof=1)) if len(downside) > 1 else 0.0
    sortino = (
        mean_daily / downside_std * np.sqrt(TRADING_DAYS_PER_YEAR)
        if downside_std > 0 else 0.0
    )

    max_dd = float(np.min(_drawdown_series(equity)))
    calmar = cagr / abs(max_dd) if max_dd < 0 else 0.0

    win_rate = float(np.mean(returns[returns != 0] > 0) * 100) if np.any(returns != 0) else 0.0

    return {
        'total_return': round(total_return * 100, 1),
        'cagr': round(cagr * 100, 2),
        'volatility': round(ann_vol * 100, 1),
        'sharpe': round(float(sharpe), 2),
        'sortino': round(float(sortino), 2),
        'max_drawdown': round(max_dd * 100, 1),
        'calmar': round(float(calmar), 2),
        'win_rate': round(win_rate, 1),
    }


def _drawdown_series(equity: np.ndarray) -> np.ndarray:
    """Drawdown (<= 0) at each point relative to the running peak."""
    running_max = np.maximum.accumulate(equity)
    return equity / running_max - 1.0
