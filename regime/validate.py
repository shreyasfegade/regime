"""
REGIME — Data validation
The gate between a pipeline run and the live site. Returns a list of
problems; an empty list means the data may be published.
"""

import json
from pathlib import Path

from regime.config import MAX_FILE_BYTES, MIN_COVERED

REQUIRED_TICKER_KEYS: set[str] = {
    'v', 'slug', 'asof', 'n', 'dates', 'px', 'post', 'vit', 'today', 'stats',
    'robustness', 'backtest', 'model',
}
REQUIRED_FILES: tuple[str, ...] = ('index.json', 'breadth.json', 'meta.json', 'excluded.json')


def validate(data: Path, previous: dict | None = None, min_covered: int = MIN_COVERED) -> list[str]:
    problems: list[str] = []
    for name in REQUIRED_FILES:
        if not (data / name).exists():
            problems.append(f'missing {name}')
    if problems:
        return problems
    index = _load(data / 'index.json', problems)
    meta = _load(data / 'meta.json', problems)
    if index is None or meta is None:
        return problems

    slugs = [r[0] for r in index.get('rows', [])]
    files = {f.stem: f for f in (data / 't').glob('*.json')}
    if set(slugs) != set(files):
        missing = sorted(set(slugs) - set(files))[:5]
        extra = sorted(set(files) - set(slugs))[:5]
        problems.append(f'index and files disagree (missing files {missing}, unindexed {extra})')
    for slug, f in sorted(files.items()):
        size = f.stat().st_size
        if size > MAX_FILE_BYTES:
            problems.append(f'{slug}: {size} bytes exceeds {MAX_FILE_BYTES}')
        p = _load(f, problems)
        if p is None:
            continue
        missing = REQUIRED_TICKER_KEYS - set(p)
        if missing:
            problems.append(f'{slug}: missing keys {sorted(missing)}')
        elif p['v'] != 2 or p['slug'] != slug:
            problems.append(f'{slug}: wrong version or slug')

    covered = index['universe']['covered']
    floor = min_covered
    if previous:
        floor = max(floor, int(0.95 * previous.get('universe', {}).get('covered', 0)))
        if previous.get('asof') and index.get('asof') and index['asof'] < previous['asof']:
            problems.append(f"as-of date went backwards: {index['asof']} < {previous['asof']}")
    if covered < floor:
        problems.append(f'only {covered} stocks covered (needs at least {floor})')
    return problems


def _load(path: Path, problems: list[str]):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        problems.append(f'{path.name}: unreadable ({exc.__class__.__name__})')
        return None
