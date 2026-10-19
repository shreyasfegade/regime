"""
REGIME — Configuration
Single source of truth for every model, pipeline and backtest constant.
No other module defines magic numbers. They all import from here.
"""

# ─── HMM Parameters ─────────────────────────────────────────────────
N_STATES: int = 4
N_ITER: int = 200
TOL: float = 1e-4
COVARIANCE_TYPE: str = 'full'
# Every full-history fit is run from several random starts and the
# highest-likelihood model wins. The spread between them is reported as
# seed stability, so the choice of starts is part of the evidence.
SEEDS: tuple[int, ...] = (42, 7, 1234, 2024, 99)
PRIMARY_SEED: int = 42
# Numbers of states compared by BIC for every ticker.
BIC_KS: tuple[int, ...] = (2, 3, 4, 5, 6)

# ─── History ─────────────────────────────────────────────────────────
DATA_YEARS: int = 10          # analysed window, in calendar years
MIN_YEARS_DATA: int = 2       # below this a ticker is excluded
MAX_NAN_RATIO: float = 0.05   # max share of missing prices tolerated

# ─── Feature Engineering ─────────────────────────────────────────────
VOLATILITY_WINDOW_SHORT: int = 5
VOLATILITY_WINDOW_LONG: int = 20
VOLUME_ZSCORE_WINDOW: int = 20
MOMENTUM_WINDOW: int = 10
WARMUP_PERIOD: int = 20  # rows dropped after rolling windows

# ─── Regime Labels ───────────────────────────────────────────────────
# The four market states the HMM resolves to. "Crisis" is the
# highest-volatility, panic-driven state (drawdowns, capitulation);
# "Accumulation" is the quiet, low-volatility base-building state.
LABEL_BULLISH: str = 'Bullish Trending'
LABEL_BEARISH: str = 'Bearish Trending'
LABEL_CRISIS: str = 'Crisis'
LABEL_ACCUMULATION: str = 'Accumulation'

# Canonical order. Every array written to disk (posteriors, transition
# matrix, emission means) is reordered into this order, so a regime is
# identified by its index everywhere downstream: 0 Bullish, 1 Accumulation,
# 2 Bearish, 3 Crisis.
REGIME_ORDER: list[str] = [
    LABEL_BULLISH,
    LABEL_ACCUMULATION,
    LABEL_BEARISH,
    LABEL_CRISIS,
]
CRISIS_IDX: int = REGIME_ORDER.index(LABEL_CRISIS)

# ─── Analytics ───────────────────────────────────────────────────────
FORWARD_HORIZONS: tuple[int, ...] = (5, 20)
CRISIS_HORIZON: int = 10

# ─── Walk-forward ────────────────────────────────────────────────────
WF_MIN_TRAIN: int = 504   # ~2 years of sessions before the first OOS day
WF_STEP: int = 126        # refit every ~6 months

# ─── Backtest ────────────────────────────────────────────────────────
TRADING_DAYS_PER_YEAR: int = 252
# How each regime maps to market exposure for the long/flat strategy.
# 1.0 = fully invested, 0.0 = in cash. Crisis and Bearish sit out.
REGIME_EXPOSURE: dict[str, float] = {
    LABEL_BULLISH: 1.0,
    LABEL_ACCUMULATION: 0.5,
    LABEL_BEARISH: 0.0,
    LABEL_CRISIS: 0.0,
}
# The full set of strategy variants evaluated for every ticker. The
# Deflated Sharpe Ratio deflates the headline strategy (the first entry)
# by the number and spread of these trials. Exposures are in REGIME_ORDER.
TRIAL_EXPOSURES: list[tuple[float, float, float, float]] = [
    (1.0, 0.5, 0.0, 0.0),
    (1.0, 1.0, 0.0, 0.0),
    (1.0, 0.0, 0.0, 0.0),
]
TRIAL_LAGS: tuple[int, ...] = (1, 2)   # sessions between signal close and fill

# Zerodha equity-delivery charges (zerodha.com/charges, checked 2026-10-18).
# Rates are fractions of traded value unless noted.
COST_SCHEDULE_DATE: str = '2026-10-18'
COSTS: dict[str, float] = {
    'brokerage': 0.0,              # zero brokerage on delivery
    'stt': 0.001,                  # 0.1% on buy and sell
    'txn_nse': 0.0000307,          # 0.00307%
    'txn_bse': 0.0000375,          # 0.00375%
    'sebi': 10 / 1e7,              # ₹10 per crore
    'stamp_buy': 0.00015,          # 0.015% on the buy side
    'gst': 0.18,                   # on brokerage + SEBI + transaction charges
    'dp_per_sell': 15.34,          # ₹ per scrip per sell day, GST included
}
# Slippage per side, in basis points, by market-cap band. An assumption,
# not a measurement: wider for smaller, less liquid names.
SLIPPAGE_BPS: dict[str, float] = {'L': 5.0, 'M': 10.0, 'S': 20.0, 'I': 5.0}
# Notional capital the flat DP charge is measured against.
NOTIONAL_INR: float = 1_000_000.0

# ─── Universe ────────────────────────────────────────────────────────
# REGIME covers the NIFTY 50 constituents (NSE's official list), ranked and
# banded by AMFI's market-cap classification. Every stock gets a full
# multi-start fit, walk-forward refits and robustness checks; keeping the
# universe to the NIFTY 50 keeps the weekly refresh to a few minutes.
UNIVERSE_NAME: str = 'NIFTY 50'
UNIVERSE_MEMBERS_URL: str = 'https://niftyindices.com/IndexConstituent/ind_nifty50list.csv'
UNIVERSE_SIZE: int = 1500           # AMFI ranks parsed before filtering to members
MIN_COVERED: int = 45               # validation floor for a publishable run
AMFI_URL: str = (
    'https://www.amfiindia.com/Themes/Theme1/downloads/'
    'AverageMarketCapitalization{stamp}.xlsx'
)
CAP_BANDS: dict[str, str] = {'Large Cap': 'L', 'Mid Cap': 'M', 'Small Cap': 'S'}

# Indices tracked alongside the stocks. Only those Yahoo carries with at
# least MIN_YEARS_DATA of history survive a run; the rest are listed as
# excluded with the reason, and are picked up automatically if Yahoo ever
# backfills them.
INDICES: list[dict[str, str]] = [
    {'slug': 'NIFTY50', 'yahoo': '^NSEI', 'name': 'NIFTY 50'},
    {'slug': 'SENSEX', 'yahoo': '^BSESN', 'name': 'S&P BSE SENSEX'},
    {'slug': 'NIFTYBANK', 'yahoo': '^NSEBANK', 'name': 'NIFTY Bank'},
    {'slug': 'NIFTYNEXT50', 'yahoo': '^NSMIDCP', 'name': 'NIFTY Next 50'},
    {'slug': 'NIFTY500', 'yahoo': '^CRSLDX', 'name': 'NIFTY 500'},
    {'slug': 'NIFTYMIDCAP50', 'yahoo': '^NSEMDCP50', 'name': 'NIFTY Midcap 50'},
    {'slug': 'NIFTYIT', 'yahoo': '^CNXIT', 'name': 'NIFTY IT'},
    {'slug': 'NIFTYPHARMA', 'yahoo': '^CNXPHARMA', 'name': 'NIFTY Pharma'},
    {'slug': 'NIFTYAUTO', 'yahoo': '^CNXAUTO', 'name': 'NIFTY Auto'},
    {'slug': 'NIFTYFMCG', 'yahoo': '^CNXFMCG', 'name': 'NIFTY FMCG'},
    {'slug': 'NIFTYMETAL', 'yahoo': '^CNXMETAL', 'name': 'NIFTY Metal'},
    {'slug': 'NIFTYENERGY', 'yahoo': '^CNXENERGY', 'name': 'NIFTY Energy'},
    {'slug': 'NIFTYREALTY', 'yahoo': '^CNXREALTY', 'name': 'NIFTY Realty'},
    {'slug': 'NIFTYPSUBANK', 'yahoo': '^CNXPSUBANK', 'name': 'NIFTY PSU Bank'},
    {'slug': 'NIFTYMEDIA', 'yahoo': '^CNXMEDIA', 'name': 'NIFTY Media'},
    {'slug': 'NIFTYINFRA', 'yahoo': '^CNXINFRA', 'name': 'NIFTY Infrastructure'},
    {'slug': 'NIFTYFINSERV', 'yahoo': 'NIFTY_FIN_SERVICE.NS', 'name': 'NIFTY Financial Services'},
]
EXPLAINER_SLUG: str = 'NIFTY50'

# ─── Pipeline ────────────────────────────────────────────────────────
FETCH_BATCH: int = 40
FETCH_TRIES: int = 4
FETCH_BACKOFF_S: float = 1.0
MAX_FILE_BYTES: int = 50_000
WARN_FILE_BYTES: int = 45_000
STALE_AFTER_DAYS: int = 10
