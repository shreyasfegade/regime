"""
REGIME — Build the precomputed example cache.

Runs the full analysis pipeline for each curated showcase ticker and writes the
resulting `/api/analyze` payload to `cache/`. These cached payloads power an
instant, offline-resilient first paint and the example chips in the UI.

No API key required — this only uses public Yahoo Finance data via yfinance.

Usage (from the repo root):
    python scripts/build_cache.py
    python scripts/build_cache.py RELIANCE.NS ^NSEI   # rebuild a subset
"""

import sys
from datetime import datetime
from pathlib import Path

# Make the repo root importable when run as `python scripts/build_cache.py`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cache import EXAMPLES, save_cached  # noqa: E402
from config import DEFAULT_START  # noqa: E402
from data import normalize_ticker  # noqa: E402
from server import _run_pipeline  # noqa: E402


def build(tickers: list[str]) -> None:
    end = datetime.now().strftime("%Y-%m-%d")
    failures = []
    for raw in tickers:
        ticker = normalize_ticker(raw)
        print(f">> {ticker:<14} fetching + fitting...", flush=True)
        try:
            payload = _run_pipeline(ticker, DEFAULT_START, end)
            save_cached(ticker, payload)
            sessions = len(payload.get("dates", []))
            regime = payload.get("current_regime", "?")
            print(f"   OK {ticker:<14} {sessions} sessions - now {regime}", flush=True)
        except Exception as exc:  # noqa: BLE001 — report and continue
            failures.append((ticker, str(exc)))
            print(f"   FAIL {ticker:<14} {exc}", flush=True)

    print()
    if failures:
        print(f"Done with {len(failures)} failure(s):")
        for ticker, msg in failures:
            print(f"  - {ticker}: {msg}")
        sys.exit(1)
    print(f"Done. Cached {len(tickers)} ticker(s) through {end}.")


if __name__ == "__main__":
    requested = sys.argv[1:]
    if requested:
        build(requested)
    else:
        build([ex["ticker"] for ex in EXAMPLES])
