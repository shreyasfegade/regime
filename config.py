"""
REGIME — Configuration
Single source of truth for every constant, color, and parameter.
No other module defines magic numbers. They all import from here.
"""

# ─── HMM Parameters ─────────────────────────────────────────────────
N_STATES: int = 4
N_ITER: int = 200
RANDOM_STATE: int = 42
MIN_YEARS_DATA: int = 2
COVARIANCE_TYPE: str = 'full'

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

REGIME_ORDER: list[str] = [
    LABEL_BULLISH,
    LABEL_ACCUMULATION,
    LABEL_BEARISH,
    LABEL_CRISIS,
]

# ─── Regime Colors ───────────────────────────────────────────────────
# A considered four-way palette: emerald (trend up), azure (base build),
# coral (trend down), crimson (panic). Each is distinct at a glance even
# for color-vision-deficient viewers — hue AND luminance separate them.
REGIME_COLORS: dict[str, dict[str, str]] = {
    'Bullish Trending': {
        'primary': '#1FC77D',
        'fill': 'rgba(31, 199, 125, 0.12)',
        'fill_band': 'rgba(31, 199, 125, 0.60)',
        'line_band': 'rgba(31, 199, 125, 0.40)',
        'dim': '#0F7D4E',
    },
    'Bearish Trending': {
        'primary': '#E8623A',
        'fill': 'rgba(232, 98, 58, 0.12)',
        'fill_band': 'rgba(232, 98, 58, 0.60)',
        'line_band': 'rgba(232, 98, 58, 0.40)',
        'dim': '#A03E22',
    },
    'Crisis': {
        'primary': '#F5384E',
        'fill': 'rgba(245, 56, 78, 0.18)',
        'fill_band': 'rgba(245, 56, 78, 0.60)',
        'line_band': 'rgba(245, 56, 78, 0.40)',
        'dim': '#A81F30',
    },
    'Accumulation': {
        'primary': '#4D8DF5',
        'fill': 'rgba(77, 141, 245, 0.10)',
        'fill_band': 'rgba(77, 141, 245, 0.60)',
        'line_band': 'rgba(77, 141, 245, 0.40)',
        'dim': '#21509E',
    },
}

# Stacking order for probability bands (bottom to top)
BAND_ORDER: list[str] = [
    'Accumulation',
    'Bullish Trending',
    'Bearish Trending',
    'Crisis',
]

# ─── Markets & Tickers ───────────────────────────────────────────────
# REGIME is India-first. yfinance exposes NSE symbols with a `.NS`
# suffix and BSE symbols with `.BO`. Indices use a `^` prefix.
DEFAULT_TICKER: str = 'RELIANCE.NS'
DEFAULT_START: str = '2018-01-01'

# Curated presets surfaced in the UI ticker picker. Grouped by market.
# Each entry: symbol, display name, market tag.
TICKER_PRESETS: list[dict[str, str]] = [
    # Indian indices
    {'symbol': '^NSEI', 'name': 'NIFTY 50', 'market': 'India · Index'},
    {'symbol': '^NSEBANK', 'name': 'NIFTY Bank', 'market': 'India · Index'},
    {'symbol': '^BSESN', 'name': 'SENSEX', 'market': 'India · Index'},
    # Indian large caps
    {'symbol': 'RELIANCE.NS', 'name': 'Reliance Industries', 'market': 'India · NSE'},
    {'symbol': 'TCS.NS', 'name': 'Tata Consultancy', 'market': 'India · NSE'},
    {'symbol': 'INFY.NS', 'name': 'Infosys', 'market': 'India · NSE'},
    {'symbol': 'HDFCBANK.NS', 'name': 'HDFC Bank', 'market': 'India · NSE'},
    {'symbol': 'ICICIBANK.NS', 'name': 'ICICI Bank', 'market': 'India · NSE'},
    {'symbol': 'TATAMOTORS.NS', 'name': 'Tata Motors', 'market': 'India · NSE'},
    {'symbol': 'ADANIENT.NS', 'name': 'Adani Enterprises', 'market': 'India · NSE'},
    {'symbol': 'BAJFINANCE.NS', 'name': 'Bajaj Finance', 'market': 'India · NSE'},
    # US reference
    {'symbol': '^GSPC', 'name': 'S&P 500', 'market': 'US · Index'},
    {'symbol': 'AAPL', 'name': 'Apple', 'market': 'US · NASDAQ'},
    {'symbol': 'TSLA', 'name': 'Tesla', 'market': 'US · NASDAQ'},
]

# Currency rendering, keyed by the symbol suffix yfinance uses.
CURRENCY_BY_SUFFIX: dict[str, dict[str, str]] = {
    '.NS': {'code': 'INR', 'symbol': '₹'},   # NSE
    '.BO': {'code': 'INR', 'symbol': '₹'},   # BSE
    '_DEFAULT': {'code': 'USD', 'symbol': '$'},
}
# Indices that are denominated in INR despite carrying a `^` prefix.
INR_INDEX_SYMBOLS: set[str] = {'^NSEI', '^NSEBANK', '^BSESN', '^CNXIT', '^CNXAUTO'}

# ─── Dark Theme Palette ──────────────────────────────────────────────
BG_PRIMARY: str = '#08090C'
BG_SURFACE: str = '#0F1217'
BG_ELEVATED: str = '#141821'
BG_HOVER: str = '#1B202C'
BORDER_COLOR: str = '#222838'
BORDER_LIGHT: str = '#2C3344'

# ─── Text Colors ─────────────────────────────────────────────────────
TEXT_PRIMARY: str = '#ECEEF3'
TEXT_SECONDARY: str = '#9AA1B0'
TEXT_MUTED: str = '#646B7C'
TEXT_DIM: str = '#3A4150'

# ─── Chart Colors ────────────────────────────────────────────────────
CANDLE_UP: str = '#1FC77D'
CANDLE_DOWN: str = '#E8623A'
GRID_COLOR: str = '#141821'
ZERO_LINE_COLOR: str = '#222838'

# ─── Typography ──────────────────────────────────────────────────────
FONT_FAMILY: str = "'Inter', 'system-ui', '-apple-system', sans-serif"

# ─── Layout Dimensions ──────────────────────────────────────────────
PAGE_PADDING: int = 24
HEADER_HEIGHT: int = 64
CHART_HEIGHT_CANDLE: int = 420
CHART_HEIGHT_PROB: int = 160
SIDEBAR_PADDING: int = 20
PANEL_PADDING: int = 20
PANEL_BORDER_RADIUS: int = 8

# ─── Transition Matrix Heatmap ───────────────────────────────────────
HEATMAP_COLORSCALE: list[list] = [
    [0, '#0F1217'],
    [1, '#1FC77D'],
]
HEATMAP_SIZE: int = 220

# ─── Backtest ────────────────────────────────────────────────────────
TRADING_DAYS_PER_YEAR: int = 252
# Round-trip cost applied on every position change, in basis points.
# 5 bps is a realistic blended estimate for liquid Indian equities
# (brokerage + STT + slippage on a switch).
BACKTEST_COST_BPS: float = 5.0
# How each regime maps to market exposure for the long/flat strategy.
# 1.0 = fully invested, 0.0 = in cash. Crisis and Bearish sit out.
REGIME_EXPOSURE: dict[str, float] = {
    'Bullish Trending': 1.0,
    'Accumulation': 0.5,
    'Bearish Trending': 0.0,
    'Crisis': 0.0,
}
