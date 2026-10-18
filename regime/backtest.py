"""
REGIME — Backtesting Engine
Turns the regime classification into a tradable signal and measures how it
would have performed against simply buying and holding, under the frictions
a retail investor in India actually faces.

Strategy — "Regime Rotation":
    Each regime maps to a target market exposure (config.REGIME_EXPOSURE):
        Bullish Trending → 100% invested
        Accumulation     →  50% invested
        Bearish Trending →   0% (cash)
        Crisis           →   0% (cash)

Execution:
    The regime is read at the close of day t and the rebalance is filled at
    the OPEN of day t+lag (lag 1 for the headline strategy). Overnight gaps
    are earned at the old weight, the session after the fill at the new one.
    Every rebalance pays Zerodha's delivery charges plus slippage
    (regime.costs).

Two views share this engine:
    • In-sample   — regimes from one fit over the full history. A diagnostic:
                    the labels have seen the whole series.
    • Walk-forward — the HMM is refit every WF_STEP sessions on past data only,
                    each window standardised on its own statistics, and every
                    out-of-sample day is classified from forward-filtered
                    probabilities, so no label uses a later observation.

Overfitting is measured, not assumed away: the headline strategy is reported
with the Probabilistic Sharpe Ratio against buy-and-hold's Sharpe and with
the Deflated Sharpe Ratio across every variant evaluated (config.TRIAL_*).
"""

from statistics import NormalDist

import numpy as np

from regime.config import (
    PRIMARY_SEED,
    REGIME_EXPOSURE,
    REGIME_ORDER,
    TRADING_DAYS_PER_YEAR,
    TRIAL_EXPOSURES,
    TRIAL_LAGS,
    WF_MIN_TRAIN,
    WF_STEP,
)
from regime.costs import COMPONENTS, rebalance_cost_fraction
from regime.model import decode, filtered_posteriors, fit_hmm

HEADLINE_EXPOSURE: tuple[float, ...] = tuple(REGIME_EXPOSURE[l] for l in REGIME_ORDER)
EULER_GAMMA: float = 0.5772156649015329
_N = NormalDist()


# ─── Execution ───────────────────────────────────────────────────────

def simulate(
    open_: np.ndarray,
    close: np.ndarray,
    regimes: np.ndarray,
    exposure: tuple[float, ...] = HEADLINE_EXPOSURE,
    lag: int = 1,
    start: int = 0,
    exchange: str = 'NSE',
    cap: str = 'L',
) -> dict:
    """
    Simulate the rotation strategy from day `start` to the end.

    Args:
        open_, close: (n,) prices.
        regimes:      (n,) regime index per day; values before `start` are
                      ignored (use -1 for "no signal").
        exposure:     target weight per regime, in REGIME_ORDER.
        lag:          sessions between the signal close and the fill open.
        start:        first day of the evaluation window.

    Returns:
        dict of daily arrays over [start, n): strategy and benchmark
        returns, weights held after each open, turnover, and the cost
        drag per component (fractions of portfolio value).
    """
    open_ = np.asarray(open_, dtype=float)
    close = np.asarray(close, dtype=float)
    regimes = np.asarray(regimes)
    n = len(close)
    exp_arr = np.asarray(exposure, dtype=float)

    # target[t] = weight wanted after seeing the close of day t.
    target = np.zeros(n)
    valid = regimes >= 0
    target[valid] = exp_arr[regimes[valid]]
    target[:start] = 0.0

    # held[t] = weight in force from the open of day t to the next open.
    held = np.zeros(n)
    if lag < n:
        held[lag:] = target[:n - lag]
    held[:start + lag] = 0.0  # nothing can be filled before the first signal

    m = n - start
    strat = np.zeros(m)
    costs = {c: np.zeros(m) for c in COMPONENTS}
    turnover = np.zeros(m)
    equity = 1.0
    prev_w = 0.0
    for i in range(1, m):
        t = start + i
        overnight = prev_w * (open_[t] / close[t - 1] - 1.0)
        w = held[t]
        cost = rebalance_cost_fraction(prev_w, w, equity * (1 + overnight), exchange, cap)
        intraday = w * (close[t] / open_[t] - 1.0)
        growth = (1.0 + overnight) * (1.0 - cost['total']) * (1.0 + intraday)
        strat[i] = growth - 1.0
        for c in COMPONENTS:
            costs[c][i] = cost[c]
        turnover[i] = abs(w - prev_w)
        equity *= growth
        prev_w = w

    bench = np.zeros(m)
    bench[1:] = close[start + 1:] / close[start:-1] - 1.0
    entry = rebalance_cost_fraction(0.0, 1.0, 1.0, exchange, cap)['total']
    bench[0] = -entry  # buy-and-hold pays to get in, once

    return {
        'strategy': strat,
        'benchmark': bench,
        'weights': held[start:],
        'turnover': turnover,
        'costs': costs,
    }


# ─── Metrics ─────────────────────────────────────────────────────────

def performance(returns: np.ndarray, years: float) -> dict:
    """Standard performance stats for a daily return stream."""
    returns = np.asarray(returns, dtype=float)
    equity = np.cumprod(1.0 + returns)
    total_return = float(equity[-1] - 1.0)
    cagr = float(equity[-1] ** (1.0 / years) - 1.0) if equity[-1] > 0 else -1.0

    std = float(np.std(returns, ddof=1))
    ann_vol = std * np.sqrt(TRADING_DAYS_PER_YEAR)
    mean_daily = float(np.mean(returns))
    sharpe = mean_daily / std * np.sqrt(TRADING_DAYS_PER_YEAR) if std > 0 else 0.0

    downside = returns[returns < 0]
    downside_std = float(np.std(downside, ddof=1)) if len(downside) > 1 else 0.0
    sortino = (
        mean_daily / downside_std * np.sqrt(TRADING_DAYS_PER_YEAR)
        if downside_std > 0 else 0.0
    )

    max_dd = float(np.min(drawdown_series(equity)))
    calmar = cagr / abs(max_dd) if max_dd < 0 else 0.0

    active = returns[returns != 0]
    win_rate = float(np.mean(active > 0) * 100) if len(active) else 0.0

    # Historical daily tail risk (positive numbers = loss magnitude).
    var95 = float(-np.percentile(returns, 5))
    tail = returns[returns <= -var95]
    cvar95 = float(-np.mean(tail)) if len(tail) > 0 else var95

    return {
        'total_return': round(total_return * 100, 1),
        'cagr': round(cagr * 100, 2),
        'volatility': round(float(ann_vol) * 100, 1),
        'sharpe': round(float(sharpe), 2),
        'sortino': round(float(sortino), 2),
        'max_drawdown': round(max_dd * 100, 1),
        'calmar': round(float(calmar), 2),
        'win_rate': round(win_rate, 1),
        'var_95': round(var95 * 100, 2),
        'cvar_95': round(cvar95 * 100, 2),
    }


def drawdown_series(equity: np.ndarray) -> np.ndarray:
    """Drawdown (<= 0) at each point relative to the running peak."""
    running_max = np.maximum.accumulate(equity)
    return equity / running_max - 1.0


def sharpe_per_period(returns: np.ndarray) -> float:
    """Non-annualised Sharpe ratio (mean / std of per-period returns)."""
    returns = np.asarray(returns, dtype=float)
    std = float(np.std(returns, ddof=1))
    return float(np.mean(returns)) / std if std > 0 else 0.0


def psr_from_moments(sr: float, sr_star: float, t: int, skew: float, kurt: float) -> float:
    """PSR from a per-period Sharpe, sample length, skew and Pearson kurtosis."""
    denom = 1.0 - skew * sr + (kurt - 1.0) / 4.0 * sr ** 2
    if t < 3 or denom <= 0:
        return 0.5
    return float(_N.cdf((sr - sr_star) * np.sqrt(t - 1) / np.sqrt(denom)))


def probabilistic_sharpe(returns: np.ndarray, sr_star: float) -> float:
    """
    Probabilistic Sharpe Ratio (Bailey & López de Prado, 2012): the
    probability that the true per-period Sharpe exceeds `sr_star`, given the
    sample length, skewness and kurtosis of the returns.
    """
    returns = np.asarray(returns, dtype=float)
    std = float(np.std(returns))
    if len(returns) < 3 or std == 0:
        return 0.5
    z = (returns - returns.mean()) / std
    return psr_from_moments(sharpe_per_period(returns), sr_star, len(returns),
                            float(np.mean(z ** 3)), float(np.mean(z ** 4)))


def expected_max_sharpe(trial_srs: list[float]) -> float:
    """
    Expected maximum per-period Sharpe among N unskilled trials with the
    observed cross-trial variance (Bailey & López de Prado, 2014, eq. 2).
    """
    if len(trial_srs) < 2:
        return 0.0
    return expected_max_sharpe_from_var(float(np.var(trial_srs, ddof=1)), len(trial_srs))


def expected_max_sharpe_from_var(var: float, n: int) -> float:
    return float(np.sqrt(var)) * (
        (1 - EULER_GAMMA) * _N.inv_cdf(1 - 1.0 / n)
        + EULER_GAMMA * _N.inv_cdf(1 - 1.0 / (n * np.e))
    )


def deflated_sharpe(returns: np.ndarray, trial_srs: list[float]) -> float:
    """Deflated Sharpe Ratio: PSR against the expected maximum trial Sharpe."""
    return probabilistic_sharpe(returns, expected_max_sharpe(trial_srs))


# ─── Backtests ───────────────────────────────────────────────────────

def run_backtest(
    open_: np.ndarray,
    close: np.ndarray,
    dates,
    regimes: np.ndarray,
    start: int = 0,
    exchange: str = 'NSE',
    cap: str = 'L',
) -> dict:
    """
    Run the headline strategy and every trial variant over [start, n) and
    package curves, metrics, costs and the overfitting statistics.
    """
    sim = simulate(open_, close, regimes, HEADLINE_EXPOSURE, 1, start, exchange, cap)
    n = len(close)
    years = max((dates[n - 1] - dates[start]).days / 365.25, 1e-9)

    trials = []
    for exposure in TRIAL_EXPOSURES:
        for lag in TRIAL_LAGS:
            r = simulate(open_, close, regimes, exposure, lag, start, exchange, cap)['strategy']
            trials.append({
                'exposure': list(exposure),
                'lag': lag,
                'sharpe': round(sharpe_per_period(r) * np.sqrt(TRADING_DAYS_PER_YEAR), 3),
                '_sr': sharpe_per_period(r),
            })
    trial_srs = [t.pop('_sr') for t in trials]

    s_ret, b_ret = sim['strategy'], sim['benchmark']
    strat = performance(s_ret, years)
    bench = performance(b_ret, years)
    cost_drag = {
        c: round(float(np.sum(sim['costs'][c])) / years * 100, 3) for c in COMPONENTS
    }
    cost_drag['total'] = round(sum(cost_drag.values()), 3)

    return {
        'start': dates[start].strftime('%Y-%m-%d'),
        'strategy_equity': np.cumprod(1.0 + s_ret),
        'benchmark_equity': np.cumprod(1.0 + b_ret),
        'metrics': {
            'years': round(float(years), 2),
            'strategy': strat,
            'benchmark': bench,
            'excess_cagr': round(strat['cagr'] - bench['cagr'], 2),
            'time_in_market': round(float(np.mean(sim['weights'])) * 100, 1),
            'trades': int(np.sum(sim['turnover'] > 1e-9)),
            'turnover_per_year': round(float(np.sum(sim['turnover'])) / years, 2),
            'cost_drag_pct_per_year': cost_drag,
            'psr_vs_buy_hold': round(probabilistic_sharpe(s_ret, sharpe_per_period(b_ret)), 4),
            'dsr': round(deflated_sharpe(s_ret, trial_srs), 4),
            'n_trials': len(trials),
            'trials': trials,
        },
    }


def run_walkforward(
    raw_features: np.ndarray,
    full_regimes: np.ndarray,
    min_train: int = WF_MIN_TRAIN,
    step: int = WF_STEP,
) -> dict | None:
    """
    Walk-forward regime classification — the credibility test for the
    in-sample labels. The HMM is refit on an expanding window every `step`
    sessions (~6 months); each window is standardised on its own statistics,
    warm-started from the previous window's model (which only saw earlier
    data) and compared against a fresh start, the better fit winning.

    Every day in the block that follows a refit is classified by the argmax
    of the forward-filtered probabilities, which use observations up to that
    day only.

    As a by-product, each window model's labels on its own training span are
    compared with the full-history labels for refit stability.

    Returns None when there isn't enough history (need > min_train + step).
    Otherwise {split, regimes (n,) with -1 before the split, windows}.
    """
    raw = np.asarray(raw_features, dtype=float)
    n = len(raw)
    if n <= min_train + step:
        return None

    regimes = np.full(n, -1, dtype=int)
    windows = []
    warm = None
    t = min_train
    while t < n:
        end = min(t + step, n)
        train = raw[:t]
        mu = train.mean(axis=0)
        sd = train.std(axis=0)
        sd[sd == 0] = 1.0
        x_train = (train - mu) / sd

        candidates = [decode(fit_hmm(x_train, seed=PRIMARY_SEED), x_train)]
        if warm is not None:
            try:
                candidates.append(decode(fit_hmm(x_train, init=warm), x_train))
            except (ValueError, np.linalg.LinAlgError):
                pass
        fit = max(candidates, key=lambda f: f.log_likelihood)
        warm = {'transmat': fit.transmat, 'means': fit.means, 'covars': fit.covars}

        windows.append({
            'agreement': float(np.mean(fit.regimes == full_regimes[:t])),
            'days': t,
        })

        x_upto = (raw[:end] - mu) / sd
        filt = filtered_posteriors(fit.model, x_upto)[:, fit.perm]
        regimes[t:end] = np.argmax(filt[t:end], axis=1)
        t = end

    return {'split': min_train, 'regimes': regimes, 'windows': windows}

