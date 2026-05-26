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
LABEL_BULLISH: str = 'Bullish Trending'
LABEL_BEARISH: str = 'Bearish Trending'
LABEL_HIGH_VOL: str = 'High Volatility'
LABEL_ACCUMULATION: str = 'Accumulation'

# ─── Regime Colors ───────────────────────────────────────────────────
REGIME_COLORS: dict[str, dict[str, str]] = {
    'Bullish Trending': {
        'primary': '#1D9E75',
        'fill': 'rgba(29, 158, 117, 0.12)',
        'fill_band': 'rgba(29, 158, 117, 0.6)',
        'line_band': 'rgba(29, 158, 117, 0.4)',
        'dim': '#0F6E56',
    },
    'Bearish Trending': {
        'primary': '#D85A30',
        'fill': 'rgba(216, 90, 48, 0.12)',
        'fill_band': 'rgba(216, 90, 48, 0.6)',
        'line_band': 'rgba(216, 90, 48, 0.4)',
        'dim': '#993C1D',
    },
    'High Volatility': {
        'primary': '#BA7517',
        'fill': 'rgba(186, 117, 23, 0.18)',
        'fill_band': 'rgba(186, 117, 23, 0.6)',
        'line_band': 'rgba(186, 117, 23, 0.4)',
        'dim': '#854F0B',
    },
    'Accumulation': {
        'primary': '#378ADD',
        'fill': 'rgba(55, 138, 221, 0.10)',
        'fill_band': 'rgba(55, 138, 221, 0.6)',
        'line_band': 'rgba(55, 138, 221, 0.4)',
        'dim': '#185FA5',
    },
}

# Stacking order for probability bands (bottom to top)
BAND_ORDER: list[str] = [
    'Accumulation',
    'Bullish Trending',
    'Bearish Trending',
    'High Volatility',
]

# ─── Dark Theme Palette ──────────────────────────────────────────────
BG_PRIMARY: str = '#0D0F14'
BG_SURFACE: str = '#13161E'
BG_ELEVATED: str = '#1A1E29'
BG_HOVER: str = '#1E2333'
BORDER_COLOR: str = '#262C3D'
BORDER_LIGHT: str = '#2E3547'

# ─── Text Colors ─────────────────────────────────────────────────────
TEXT_PRIMARY: str = '#E8EAF0'
TEXT_SECONDARY: str = '#9CA3AF'
TEXT_MUTED: str = '#6B7280'
TEXT_DIM: str = '#3D4557'

# ─── Chart Colors ────────────────────────────────────────────────────
CANDLE_UP: str = '#1D9E75'
CANDLE_DOWN: str = '#D85A30'
GRID_COLOR: str = '#1A1E29'
ZERO_LINE_COLOR: str = '#262C3D'

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
    [0, '#13161E'],
    [1, '#1D9E75'],
]
HEATMAP_SIZE: int = 220


