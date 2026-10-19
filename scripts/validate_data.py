"""
REGIME — validate the static data before it is committed.

    python scripts/validate_data.py [--data static/data] [--previous prev_meta.json]

Exits non-zero, printing every problem, if the data should not go live:
missing or malformed files, a ticker file over the size limit, an index that
disagrees with the files, coverage that collapsed versus the previous run,
or an as-of date that went backwards. The weekly workflow commits only when
this passes, so a bad run leaves the last good data in place.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from regime.validate import validate  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=str(ROOT / 'static' / 'data'))
    ap.add_argument('--previous', default=None, help='meta.json of the data currently live')
    ap.add_argument('--min-covered', type=int, default=None)
    args = ap.parse_args()
    previous = None
    if args.previous and Path(args.previous).exists():
        previous = json.loads(Path(args.previous).read_text(encoding='utf-8'))
    problems = validate(Path(args.data), previous, *([args.min_covered] if args.min_covered else []))
    if problems:
        print(f'{len(problems)} problem(s):')
        for p in problems[:50]:
            print(f'  - {p}')
        sys.exit(1)
    print('data OK')


if __name__ == '__main__':
    main()
