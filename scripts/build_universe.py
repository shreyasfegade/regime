"""
REGIME — build data/universe.csv: today's NIFTY 50 constituents, with rank
and market-cap band from the newest AMFI classification list.

    python scripts/build_universe.py

Cheap (two downloads), so the weekly refresh rebuilds it every time and
picks up index rebalances as well as new AMFI lists.
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import requests  # noqa: E402

from regime.config import UNIVERSE_MEMBERS_URL  # noqa: E402
from regime.universe import (  # noqa: E402
    build_universe, fetch_latest_amfi, stamp_to_iso, write_universe,
)

OUT = ROOT / 'data' / 'universe.csv'
HEADERS = {'User-Agent': 'Mozilla/5.0 (research; REGIME universe builder)'}


def get(url: str) -> tuple[int, bytes]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=60)
        return r.status_code, r.content
    except requests.RequestException:
        return 0, b''


def yahoo_lookup(symbol: str) -> tuple[str | None, str | None]:
    import yfinance as yf
    info = yf.Ticker(symbol).info
    return info.get('sector'), info.get('industry')


def main() -> None:
    argparse.ArgumentParser(description=__doc__).parse_args()
    stamp, xlsx = fetch_latest_amfi(get)
    list_date = stamp_to_iso(stamp)
    status, body = get(UNIVERSE_MEMBERS_URL)
    if status != 200:
        raise SystemExit(f'could not fetch the index constituent list ({status})')
    rows = build_universe(xlsx, stamp, [], yahoo_lookup,
                          members_csv=body.decode('utf-8', errors='replace'))
    if len(rows) < 50:
        print(f'warning: only {len(rows)} constituents matched the AMFI list')
    OUT.parent.mkdir(exist_ok=True)
    write_universe(OUT, rows)
    by_source = {}
    for r in rows:
        by_source[r['sector_source']] = by_source.get(r['sector_source'], 0) + 1
    print(f'{len(rows)} companies; AMFI list of {list_date}; sectors {by_source}')


if __name__ == '__main__':
    main()
