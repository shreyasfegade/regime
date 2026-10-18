"""
REGIME — build data/universe.csv from the newest AMFI market-cap list.

    python scripts/build_universe.py            # rebuild if AMFI has a newer list
    python scripts/build_universe.py --force    # rebuild regardless

Exit code 0 either way; prints whether the universe changed, so the weekly
workflow can decide whether to commit it.
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import requests  # noqa: E402

from regime.config import INDUSTRY_LISTS  # noqa: E402
from regime.universe import (  # noqa: E402
    build_universe, fetch_latest_amfi, read_universe, stamp_to_iso, write_universe,
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
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()

    stamp, xlsx = fetch_latest_amfi(get)
    list_date = stamp_to_iso(stamp)
    if OUT.exists() and not args.force:
        current = read_universe(OUT)
        if current and current[0]['list_date'] == list_date:
            print(f'unchanged: universe already uses the AMFI list of {list_date}')
            return

    csvs = []
    for url in INDUSTRY_LISTS:
        status, body = get(url)
        if status == 200:
            csvs.append(body.decode('utf-8', errors='replace'))
        else:
            print(f'warning: could not fetch {url} ({status})')
    rows = build_universe(xlsx, stamp, csvs, yahoo_lookup)
    OUT.parent.mkdir(exist_ok=True)
    write_universe(OUT, rows)
    by_source = {}
    for r in rows:
        by_source[r['sector_source']] = by_source.get(r['sector_source'], 0) + 1
    print(f'changed: {len(rows)} companies from the AMFI list of {list_date}; sectors {by_source}')


if __name__ == '__main__':
    main()
