"""
REGIME — Data Fetching & Validation
Fetches OHLCV data via yfinance for Indian (NSE/BSE) and US equities and
indices. Validates for completeness. Raises ValueError with human-readable
messages on any failure.

yfinance ticker conventions this module understands:
    RELIANCE.NS   NSE-listed equity   (₹)
    TATASTEEL.BO  BSE-listed equity   (₹)
    ^NSEI         NSE index, NIFTY 50 (₹)
    ^BSESN        BSE index, SENSEX   (₹)
    AAPL / ^GSPC  US equity / index   ($)
"""

import re

import pandas as pd
import yfinance as yf

from config import (
    CURRENCY_BY_SUFFIX,
    INR_INDEX_SYMBOLS,
    MIN_YEARS_DATA,
)

# A ticker is: an optional '^' index prefix, an alphanumeric core (dots and
# dashes allowed for things like BRK-B), and an optional .NS/.BO exchange
# suffix. This is deliberately permissive — yfinance is the real validator.
_TICKER_RE = re.compile(r'^\^?[A-Z0-9][A-Z0-9.\-&]{0,14}$')


def normalize_ticker(ticker: str) -> str:
    """
    Clean and canonicalize a user-entered ticker.

    Uppercases, trims whitespace, and maps a few friendly aliases (e.g.
    'NIFTY' → '^NSEI', 'SENSEX' → '^BSESN') to their yfinance symbols.
    """
    t = ticker.strip().upper()
    aliases = {
        'NIFTY': '^NSEI',
        'NIFTY50': '^NSEI',
        'NIFTYBANK': '^NSEBANK',
        'BANKNIFTY': '^NSEBANK',
        'SENSEX': '^BSESN',
        'SPX': '^GSPC',
        'SP500': '^GSPC',
    }
    return aliases.get(t, t)


def currency_for(ticker: str) -> dict[str, str]:
    """Return {'code', 'symbol'} for how prices of this ticker should render."""
    t = ticker.upper()
    if t in INR_INDEX_SYMBOLS:
        return {'code': 'INR', 'symbol': '₹'}
    for suffix, info in CURRENCY_BY_SUFFIX.items():
        if suffix != '_DEFAULT' and t.endswith(suffix):
            return info
    return CURRENCY_BY_SUFFIX['_DEFAULT']


def fetch_ohlcv(ticker: str, start: str, end: str) -> pd.DataFrame:
    """
    Fetch daily OHLCV from yfinance for the given ticker and date range.

    Returns a clean DataFrame with columns: Open, High, Low, Close, Volume.
    Index is a DatetimeIndex sorted ascending.

    Raises:
        ValueError: with a human-readable message on any failure.
    """
    ticker = normalize_ticker(ticker)
    _validate_ticker_format(ticker)
    df = _download_data(ticker, start, end)
    _validate_row_count(df, ticker)
    _validate_nan_ratio(df, ticker)
    df = _clean_data(df)
    return df


def _validate_ticker_format(ticker: str) -> None:
    """Reject obviously malformed ticker strings before hitting the network."""
    if not ticker or not _TICKER_RE.match(ticker):
        raise ValueError(
            f"'{ticker}' doesn't look like a valid symbol. "
            "Try an NSE symbol like RELIANCE.NS, a BSE symbol like "
            "TATASTEEL.BO, an index like ^NSEI, or a US symbol like AAPL."
        )


def _download_data(ticker: str, start: str, end: str) -> pd.DataFrame:
    """Download OHLCV from Yahoo Finance."""
    try:
        data = yf.download(
            ticker,
            start=start,
            end=end,
            auto_adjust=True,
            progress=False,
        )
    except Exception:
        raise ValueError(
            "Yahoo Finance is temporarily unavailable. "
            "Try again in a moment."
        )

    if data is None or data.empty:
        raise ValueError(
            f"No data returned for '{ticker}'. Check the symbol — Indian "
            "equities need a .NS (NSE) or .BO (BSE) suffix, e.g. INFY.NS."
        )

    # yfinance may return MultiIndex columns for single ticker
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    required_cols = ['Open', 'High', 'Low', 'Close']
    missing = [c for c in required_cols if c not in data.columns]
    if missing:
        raise ValueError(
            f"Ticker '{ticker}' returned incomplete data. "
            f"Missing columns: {', '.join(missing)}."
        )

    # Indices (^NSEI, ^GSPC) often report zero or missing volume on Yahoo.
    # That's expected, not an error — synthesize a zero column so the rest
    # of the pipeline (volume z-score) stays well-defined.
    if 'Volume' not in data.columns:
        data['Volume'] = 0.0

    return data[['Open', 'High', 'Low', 'Close', 'Volume']].copy()


def _validate_row_count(df: pd.DataFrame, ticker: str) -> None:
    """Ensure we have at least MIN_YEARS_DATA worth of trading days."""
    min_rows = MIN_YEARS_DATA * 252
    if len(df) < min_rows:
        raise ValueError(
            f"Only {len(df)} days of data found for '{ticker}'. "
            f"Regime detection needs at least {MIN_YEARS_DATA} years "
            f"(~{min_rows} trading days). Try an earlier start date."
        )


def _validate_nan_ratio(df: pd.DataFrame, ticker: str) -> None:
    """Reject data with >5% NaN in any price column (volume may be sparse)."""
    price_cols = ['Open', 'High', 'Low', 'Close']
    nan_ratio = df[price_cols].isna().mean()
    bad_cols = nan_ratio[nan_ratio > 0.05]
    if not bad_cols.empty:
        col_list = ', '.join(bad_cols.index.tolist())
        raise ValueError(
            f"Data for '{ticker}' has too many missing values in: {col_list}. "
            "Try a different ticker or date range."
        )


def _clean_data(df: pd.DataFrame) -> pd.DataFrame:
    """Forward-fill then drop any remaining NaNs. Sort ascending by date."""
    df = df.sort_index(ascending=True)
    df = df.ffill()
    df['Volume'] = df['Volume'].fillna(0.0)
    df = df.dropna()
    return df
