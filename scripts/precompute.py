"""
REGIME — precompute the static data the site serves.

Full local run (fetch, fit, write, merge):
    python scripts/precompute.py --workers 4

One shard of a parallel run (the weekly workflow runs 16), then the merge:
    python scripts/precompute.py --shard 3 --of 16 --out build/shard-3 --no-merge
    python scripts/precompute.py --merge-only

Offline, with synthetic markets instead of Yahoo Finance:
    python scripts/precompute.py --synthetic --limit 20 --out /tmp/regime-data

Each ticker that fails is logged with its reason and skipped; the run never
stops for one ticker. See regime/pipeline.py.
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from regime import pipeline  # noqa: E402
from regime.universe import read_universe  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--universe', default=str(ROOT / 'data' / 'universe.csv'))
    ap.add_argument('--out', default=str(ROOT / 'static' / 'data'))
    ap.add_argument('--prev', default=None, help='data folder to warm-start from (default: --out)')
    ap.add_argument('--shard', type=int, default=0)
    ap.add_argument('--of', type=int, default=1)
    ap.add_argument('--tickers', default='', help='comma-separated slugs to run')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--workers', type=int, default=1)
    ap.add_argument('--synthetic', action='store_true')
    ap.add_argument('--no-indices', action='store_true')
    ap.add_argument('--no-merge', action='store_true')
    ap.add_argument('--merge-only', action='store_true')
    args = ap.parse_args()

    universe = read_universe(args.universe)
    jobs = pipeline.jobs_from_universe(universe, include_indices=not args.no_indices)
    list_date = universe[0]['list_date'] if universe else ''

    if not args.merge_only:
        todo = pipeline.shard(jobs, args.shard, args.of)
        if args.tickers:
            wanted = {t.strip().upper() for t in args.tickers.split(',') if t.strip()}
            todo = [j for j in todo if j['slug'] in wanted]
        if args.limit:
            todo = todo[:args.limit]
        print(f'{len(todo)} tickers in shard {args.shard + 1}/{args.of}', flush=True)
        statuses = pipeline.run(
            todo, args.out, prev_dir=args.prev or args.out, workers=args.workers,
            downloader=pipeline.synthetic_downloader if args.synthetic else None,
            label=f'shard-{args.shard:02d}-of-{args.of:02d}',
            log=lambda m: print(m, flush=True),
        )
        ok = sum(s['ok'] for s in statuses)
        print(f'done: {ok}/{len(statuses)} written to {args.out}', flush=True)

    if args.merge_only or not args.no_merge:
        if args.synthetic or args.tickers or args.limit:
            covered = {f.stem for f in (Path(args.out) / 't').glob('*.json')}
            jobs = [j for j in jobs if j['slug'] in covered or args.synthetic]
        meta = pipeline.merge(args.out, jobs, list_date)
        u = meta['universe']
        print(f"merged: {u['covered']}/{u['size']} stocks + {u['indices']} indices, "
              f"{meta['excluded']} excluded, {meta['stale']} stale, as of {meta['asof']}")


if __name__ == '__main__':
    main()
