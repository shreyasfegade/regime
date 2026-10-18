"""
REGIME — Data Fetching & Validation
Fetches daily OHLCV for NSE/BSE equities and indices from Yahoo Finance in
batches, retrying with exponential backoff, and validates each series for
completeness. Failures are reported per symbol, never raised for the batch,
so one bad ticker cannot stop a 1,500-ticker run.

yfinance ticker conventions this module understands:
    RELIANCE.NS   NSE-listed equity
    TATASTEEL.BO  BSE-listed equity
    ^NSEI         NSE index, NIFTY 50
    ^BSESN        BSE index, SENSEX
"""

import random
import time
from typing import Callable

import pandas as pd

from regime.config import (
    FETCH_BACKOFF_S,
    FETCH_TRIES,
    MAX_NAN_RATIO,
    MIN_YEARS_DATA,
)

PRICE_COLS: list[str] = ['Open', 'High', 'Low', 'Close']


def with_retry(fn: Callable, tries: int = FETCH_TRIES, base: float = FETCH_BACKOFF_S,
               sleep: Callable[[float], None] = time.sleep, retry_if=None):
    """
    Call fn() until it succeeds, waiting base·2^k (plus up to 50% jitter)
    between attempts. `retry_if(result)` may flag a returned value as a soft
    failure (e.g. an empty frame from a rate-limited request). The last
    exception is re-raised once the tries are exhausted.
    """
    last: Exception | None = None
    for attempt in range(tries):
        try:
            result = fn()
            if retry_if is None or not retry_if(result):
                return result
            last = RuntimeError('Empty response')
        except Exception as exc:  # noqa: BLE001 — any fetch error is retried
            last = exc
        if attempt < tries - 1:
            delay = base * (2 ** attempt)
            sleep(delay + random.uniform(0, delay / 2))
    raise last if last else RuntimeError('No attempts made')


def download_batch(symbols: list[str], start: str, end: str | None = None,
                   downloader: Callable | None = None, sleep=time.sleep,
                   tries: int = FETCH_TRIES) -> dict[str, pd.DataFrame]:
    """
    Download several symbols in one request. Returns {symbol: raw frame} for
    every symbol that came back with rows; missing symbols are simply absent.
    The whole batch is retried on error or on an entirely empty response.
    """
    if not symbols:
        return {}
    if downloader is None:
        import yfinance as yf
        downloader = yf.download

    def call():
        return downloader(
            symbols, start=start, end=end, auto_adjust=True, progress=False,
            group_by='ticker', threads=True,
        )

    data = with_retry(call, tries=tries, sleep=sleep, retry_if=lambda d: d is None or d.empty)
    out: dict[str, pd.DataFrame] = {}
    for sym in symbols:
        try:
            if isinstance(data.columns, pd.MultiIndex):
                if sym not in data.columns.get_level_values(0):
                    continue
                frame = data[sym]
            else:
                frame = data
            frame = frame.dropna(how='all')
        except (KeyError, ValueError):
            continue
        if len(frame):
            out[sym] = frame.copy()
    return out


def clean_ohlcv(raw: pd.DataFrame) -> pd.DataFrame:
    """
    Validate and clean one symbol's OHLCV frame.

    Raises:
        ValueError with a short human-readable reason on any failure.
    """
    if raw is None or raw.empty:
        raise ValueError('no data returned by Yahoo Finance')
    missing = [c for c in PRICE_COLS if c not in raw.columns]
    if missing:
        raise ValueError(f'missing columns: {", ".join(missing)}')
    df = raw.copy()
    if 'Volume' not in df.columns:
        df['Volume'] = 0.0
    df = df[PRICE_COLS + ['Volume']]
    df = df[~df.index.duplicated(keep='last')].sort_index()
    df.index = pd.DatetimeIndex(df.index).tz_localize(None).normalize()

    # Yahoo sometimes reports a zero or missing price on a holiday stub;
    # treat non-positive prices as missing before measuring completeness.
    df[PRICE_COLS] = df[PRICE_COLS].where(df[PRICE_COLS] > 0)
    nan_ratio = df['Close'].isna().mean()
    if nan_ratio > MAX_NAN_RATIO:
        raise ValueError(f'{nan_ratio:.0%} of closing prices missing')

    df['Close'] = df['Close'].ffill()
    for c in ('Open', 'High', 'Low'):
        df[c] = df[c].fillna(df['Close'])
    df['Volume'] = df['Volume'].fillna(0.0)
    df = df.dropna()

    min_rows = MIN_YEARS_DATA * 252
    if len(df) < min_rows:
        raise ValueError(
            f'only {len(df)} session{"" if len(df) == 1 else "s"} of history '
            f'(needs {MIN_YEARS_DATA}+ years, {min_rows} sessions)'
        )
    return df


def pick_longer(candidates: dict[str, pd.DataFrame]) -> tuple[str, pd.DataFrame]:
    """
    Among cleaned frames for the same company on different exchanges (e.g.
    AMAL.NS with 42 sessions vs AMAL.BO with ten years), keep the one with
    the longest history. Ties go to the first listed (NSE).
    """
    if not candidates:
        raise ValueError('no exchange returned usable history')
    return max(candidates.items(), key=lambda kv: len(kv[1]))
