"""
REGIME — Data Fetching & Validation
Fetches OHLCV data via yfinance. Validates for completeness.
Raises ValueError with human-readable messages on any failure.
"""

import pandas as pd
import yfinance as yf

from config import MIN_YEARS_DATA


def fetch_ohlcv(ticker: str, start: str, end: str) -> pd.DataFrame:
    """
    Fetch daily OHLCV from yfinance for the given ticker and date range.

    Returns a clean DataFrame with columns: Open, High, Low, Close, Volume.
    Index is a DatetimeIndex sorted ascending.

    Raises:
        ValueError: with a human-readable message on any failure.
    """
    ticker = ticker.strip().upper()
    _validate_ticker_format(ticker)
    df = _download_data(ticker, start, end)
    _validate_row_count(df, ticker)
    _validate_nan_ratio(df, ticker)
    df = _clean_data(df)
    return df


def _validate_ticker_format(ticker: str) -> None:
    """Reject obviously invalid ticker strings."""
    if not ticker or not ticker.isalpha() or len(ticker) > 5:
        raise ValueError(
            f"'{ticker}' is not a valid US stock ticker. "
            "Use 1–5 uppercase letters (e.g. SPY, AAPL, TSLA)."
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
            f"Ticker '{ticker}' not found. "
            "Check the symbol and try again."
        )

    # yfinance may return MultiIndex columns for single ticker
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    required_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    missing = [c for c in required_cols if c not in data.columns]
    if missing:
        raise ValueError(
            f"Ticker '{ticker}' returned incomplete data. "
            f"Missing columns: {', '.join(missing)}."
        )

    return data[required_cols].copy()


def _validate_row_count(df: pd.DataFrame, ticker: str) -> None:
    """Ensure we have at least MIN_YEARS_DATA worth of trading days."""
    min_rows = MIN_YEARS_DATA * 252
    if len(df) < min_rows:
        raise ValueError(
            f"Only {len(df)} days of data found for '{ticker}'. "
            f"Regime detection needs at least {MIN_YEARS_DATA} years "
            f"(~{min_rows} trading days)."
        )


def _validate_nan_ratio(df: pd.DataFrame, ticker: str) -> None:
    """Reject data with >5% NaN in any column."""
    nan_ratio = df.isna().mean()
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
    df = df.dropna()
    return df
