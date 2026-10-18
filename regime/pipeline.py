"""
REGIME — Precompute pipeline
Builds the static data the site serves:

    static/data/t/<SLUG>.json   one compact file per ticker (regime.encode)
    static/data/index.json      every covered ticker's headline numbers
    static/data/breadth.json    weekly share of the market in each regime
    static/data/meta.json       run metadata (as-of date, counts)
    static/data/excluded.json   every universe member without a file, and why
    static/data/explainer.json  NIFTY 50 features and model for the explainer

A run is: jobs → shard → fetch in batches (with retries) → analyse in a
process pool → write per-ticker files → merge. A ticker that fails is
logged with its reason and skipped; a ticker that fails but has a file from
an earlier run keeps it (marked stale by its own as-of date), so one bad
week never removes good data.
"""

import json
import os
import shutil
import time
import zlib
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from regime.config import (
    DATA_YEARS, EXPLAINER_SLUG, FETCH_BATCH, INDICES, MAX_FILE_BYTES, REGIME_ORDER, UNIVERSE_NAME,
    WARN_FILE_BYTES,
)
from regime.data import clean_ohlcv, download_batch, pick_longer

INDEX_COLS: list[str] = [
    'slug', 'sym', 'name', 'sector', 'cap', 'rank', 'regime', 'posterior', 'days_in',
    'expected_remaining', 'crisis_10d', 'score', 'asof',
]


# ─── Jobs ────────────────────────────────────────────────────────────

def jobs_from_universe(universe: list[dict], include_indices: bool = True) -> list[dict]:
    """One job per stock (NSE and BSE candidates) plus one per index."""
    jobs = []
    for c in universe:
        cands = []
        if c.get('nse'):
            cands.append((f"{c['nse']}.NS", 'NSE'))
        if c.get('bse'):
            cands.append((f"{c['bse']}.BO", 'BSE'))
            if not c.get('nse'):
                # AMFI sometimes leaves the NSE symbol blank for companies
                # listed on both exchanges; the BSE symbol usually matches.
                cands.append((f"{c['bse']}.NS", 'NSE'))
        jobs.append({
            'slug': c['slug'], 'sym': c.get('nse') or c.get('bse'), 'name': c['name'],
            'sector': c['sector'], 'cap': c['cap'], 'rank': int(c['rank']),
            'kind': 'stock', 'candidates': cands,
        })
    if include_indices:
        for ix in INDICES:
            jobs.append({
                'slug': ix['slug'], 'sym': ix['yahoo'], 'name': ix['name'], 'sector': 'Index',
                'cap': 'I', 'rank': None, 'kind': 'index', 'candidates': [(ix['yahoo'], 'NSE')],
            })
    return jobs


def shard(jobs: list[dict], index: int, count: int) -> list[dict]:
    """Deterministic partition: sorted by slug, every count-th job."""
    if not 0 <= index < count:
        raise ValueError('shard index out of range')
    ordered = sorted(jobs, key=lambda j: j['slug'])
    return [j for k, j in enumerate(ordered) if k % count == index]


def fetch_start(today: date | None = None) -> str:
    today = today or date.today()
    return (today - timedelta(days=int(DATA_YEARS * 365.25) + 45)).isoformat()


# ─── Fetch ───────────────────────────────────────────────────────────

def fetch_jobs(jobs: list[dict], start: str, downloader=None, sleep=time.sleep,
               batch: int = FETCH_BATCH):
    """
    Yield (job, df, exchange, symbol, reason) for every job. df is None when
    every exchange failed, with the reason. Symbols are downloaded in batches
    (each batch retried with backoff); a symbol missing from a batch that
    otherwise succeeded is usually delisted, so it gets one quick retry alone.
    """
    symbols = [s for j in jobs for s, _ in j['candidates']]
    frames: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), batch):
        chunk = symbols[i:i + batch]
        try:
            frames.update(download_batch(chunk, start, downloader=downloader, sleep=sleep))
        except Exception:  # noqa: BLE001 — fall back to one-by-one below
            pass
    for j in jobs:
        cleaned, reasons, exchanges = {}, [], {}
        for sym, exch in j['candidates']:
            raw = frames.get(sym)
            if raw is None:
                try:
                    raw = download_batch([sym], start, downloader=downloader, sleep=sleep, tries=2).get(sym)
                except Exception:  # noqa: BLE001
                    reasons.append(f'{sym}: no data on Yahoo Finance (delisted or renamed)')
                    continue
            try:
                cleaned[sym] = clean_ohlcv(raw)
                exchanges[sym] = exch
            except ValueError as exc:
                reasons.append(f'{sym}: {exc}')
        if not cleaned:
            yield j, None, None, None, '; '.join(reasons) or 'no symbol to fetch'
            continue
        sym, df = pick_longer(cleaned)
        yield j, df, exchanges[sym], sym, None


def synthetic_downloader(symbols, start=None, **_):
    """Stand-in for yf.download that returns deterministic synthetic markets."""
    from regime.synthetic import synthetic_ohlcv
    out = {}
    for s in symbols if isinstance(symbols, list) else [symbols]:
        seed = zlib.crc32(s.encode())
        if seed % 17 == 0:
            continue  # some symbols "don't exist", like on Yahoo
        n = 2550 if seed % 11 else 400 + seed % 300  # and some are too short
        df, _ = synthetic_ohlcv(n, seed=seed % 10_000, zero_volume=s.startswith('^'))
        out[s] = df
    if not out:
        return pd.DataFrame()
    return pd.concat(out, axis=1)


# ─── Analyse one ticker ──────────────────────────────────────────────

def process_one(job: dict, df: pd.DataFrame, exchange: str, yahoo: str,
                out_dir: str, prev_dir: str | None) -> dict:
    """Analyse, encode and write one ticker. Runs inside a worker process."""
    import logging
    logging.getLogger('hmmlearn').setLevel(logging.ERROR)
    from regime.analysis import analyze
    from regime.encode import encode_ticker, to_json, warm_start_from

    t0 = time.time()
    warm = None
    if prev_dir:
        prev = _read_json(Path(prev_dir) / 't' / f"{job['slug']}.json")
        warm = warm_start_from(prev) if prev else None
    try:
        result = analyze(df, warm=warm, exchange=exchange, cap=job['cap'])
        meta = {**job, 'yahoo': yahoo, 'exchange': exchange}
        text = to_json(encode_ticker(result, meta))
    except Exception as exc:  # noqa: BLE001 — one ticker never stops the run
        return _status(job, False, f'analysis failed: {_short(exc)}', t0)
    size = len(text.encode('utf-8'))
    if size > MAX_FILE_BYTES:
        return _status(job, False, f'encoded file is {size} bytes (limit {MAX_FILE_BYTES})', t0)
    _atomic_write(Path(out_dir) / 't' / f"{job['slug']}.json", text)
    if job['slug'] == EXPLAINER_SLUG:
        _atomic_write(Path(out_dir) / 'explainer.json', explainer_payload(result, job))
    st = _status(job, True, None, t0)
    st.update(bytes=size, asof=str(result['dates'][-1].date()), warn=size > WARN_FILE_BYTES)
    return st


def run(jobs: list[dict], out_dir: str, prev_dir: str | None = None, workers: int = 1,
        downloader=None, start: str | None = None, label: str = 'run', log=print) -> list[dict]:
    """Fetch and analyse `jobs`, writing files under out_dir. Returns statuses."""
    start = start or fetch_start()
    out = Path(out_dir)
    (out / 't').mkdir(parents=True, exist_ok=True)
    statuses: list[dict] = []
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = []
        for job, df, exch, sym, reason in fetch_jobs(jobs, start, downloader):
            if df is None:
                statuses.append({'slug': job['slug'], 'ok': False, 'reason': reason})
                log(f"skip {job['slug']:<16} {reason}")
                continue
            futures.append(pool.submit(process_one, job, df, exch, sym, str(out), prev_dir))
        for k, fut in enumerate(as_completed(futures), 1):
            st = fut.result()
            statuses.append(st)
            mark = 'ok  ' if st['ok'] else 'FAIL'
            log(f"{mark} {st['slug']:<16} {st.get('bytes', '')} {st.get('reason') or ''} "
                f"[{k}/{len(futures)} · {time.time() - t0:.0f}s]")
    statuses.sort(key=lambda s: s['slug'])
    status_dir = out / '_status'
    status_dir.mkdir(exist_ok=True)
    _atomic_write(status_dir / f'{label}.json', json.dumps(
        {'label': label, 'seconds': round(time.time() - t0, 1), 'statuses': statuses}, indent=0))
    return statuses


# ─── Merge ───────────────────────────────────────────────────────────

def merge(data_dir: str, jobs: list[dict], list_date: str, now: datetime | None = None) -> dict:
    """
    Build index.json, breadth.json, meta.json and excluded.json from the
    per-ticker files in data_dir/t and the run statuses in data_dir/_status.
    Files for slugs no longer in the universe are removed.
    """
    data = Path(data_dir)
    now = now or datetime.now(timezone.utc)
    by_slug = {j['slug']: j for j in jobs}
    for f in (data / 't').glob('*.json'):
        if f.stem not in by_slug:
            f.unlink()

    reasons: dict[str, str] = {}
    run_seconds = 0.0
    for f in sorted((data / '_status').glob('*.json')) if (data / '_status').exists() else []:
        s = _read_json(f) or {}
        run_seconds += float(s.get('seconds', 0))
        for st in s.get('statuses', []):
            if not st.get('ok'):
                reasons[st['slug']] = st.get('reason') or 'failed'
            else:
                reasons.pop(st['slug'], None)

    payloads = {}
    for slug in sorted(by_slug):
        p = _read_json(data / 't' / f'{slug}.json')
        if p and p.get('v') == 2:
            payloads[slug] = p

    sectors = sorted({p['sector'] for p in payloads.values() if p.get('cap') != 'I'})
    rows = []
    for slug, p in payloads.items():
        t = p['today']
        rows.append([
            slug, p['sym'], p['name'], p['sector'], p['cap'], p['rank'], t['regime'],
            t['posterior'], t['days_in'], t['expected_remaining'],
            p['crisis_warning']['projected'], p['robustness']['score']['value'], p['asof'],
        ])
    rows.sort(key=lambda r: (r[5] is None, r[5] if r[5] is not None else 0, r[0]))

    asofs = sorted({p['asof'] for p in payloads.values()})
    asof = asofs[-1] if asofs else None
    stale = [s for s, p in payloads.items() if asof and p['asof'] < asof]
    stocks = [j for j in jobs if j['kind'] == 'stock']
    covered_stocks = [j for j in stocks if j['slug'] in payloads]
    indices_covered = [j['slug'] for j in jobs if j['kind'] == 'index' and j['slug'] in payloads]

    excluded = []
    for j in jobs:
        if j['slug'] in payloads:
            continue
        excluded.append({
            'slug': j['slug'], 'sym': j['sym'], 'name': j['name'], 'kind': j['kind'],
            'rank': j['rank'], 'reason': reasons.get(j['slug'], 'not processed in this run'),
        })
    excluded.sort(key=lambda e: (e['kind'] != 'stock', e['rank'] or 0, e['slug']))

    universe = {
        'name': UNIVERSE_NAME,
        'source': 'NSE NIFTY 50 constituents, ranked by AMFI average market capitalisation',
        'list_date': list_date,
        'size': len(stocks),
        'covered': len(covered_stocks),
        'indices': len(indices_covered),
    }
    index = {'v': 2, 'asof': asof, 'universe': universe, 'labels': REGIME_ORDER,
             'sectors': sectors, 'cols': INDEX_COLS, 'rows': rows}
    meta = {
        'v': 2, 'asof': asof, 'generated_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'universe': universe, 'stale': len(stale), 'excluded': len(excluded),
        'compute_seconds': round(run_seconds, 1),
        'file_bytes': _size_stats(data / 't'),
    }
    _atomic_write(data / 'index.json', _dump(index))
    _atomic_write(data / 'breadth.json', _dump(breadth(payloads)))
    _atomic_write(data / 'excluded.json', _dump({'v': 2, 'list_date': list_date, 'rows': excluded}))
    _atomic_write(data / 'meta.json', json.dumps(meta, indent=1, sort_keys=True))
    shutil.rmtree(data / '_status', ignore_errors=True)  # run logs are not served
    return meta


def breadth(payloads: dict[str, dict]) -> dict:
    """
    Weekly count of stocks in each regime (Viterbi, full-history labels),
    for the whole universe, each cap band and each sector. Indices excluded.
    A stock counts from its first full week of data.
    """
    from regime.encode import decode_dates, decode_runs
    weekly: dict[str, dict[str, np.ndarray]] = {}
    all_weeks: set = set()
    per_stock = []
    for p in payloads.values():
        if p.get('cap') == 'I':
            continue
        dates = pd.DatetimeIndex(decode_dates(p['dates']))
        reg = decode_runs(p['vit'], p['n'])
        s = pd.Series(reg, index=dates)
        wk = s.groupby(dates.to_period('W-FRI')).last()
        all_weeks.update(wk.index)
        per_stock.append((p['cap'], p['sector'], wk))
    weeks = sorted(all_weeks)
    pos = {w: i for i, w in enumerate(weeks)}
    groups: dict[str, np.ndarray] = {}

    def add(key, wk):
        arr = groups.setdefault(key, np.zeros((len(weeks), len(REGIME_ORDER)), dtype=np.int64))
        idx = np.array([pos[w] for w in wk.index])
        np.add.at(arr, (idx, wk.to_numpy()), 1)

    for cap, sector, wk in per_stock:
        add('all', wk)
        add(f'cap:{cap}', wk)
        add(f'sector:{sector}', wk)
    return {
        'v': 2,
        'weeks': [w.end_time.date().isoformat() for w in weeks],
        'labels': REGIME_ORDER,
        'basis': 'Viterbi regimes from each stock\'s full-history fit (in-sample)',
        'groups': {k: v.T.tolist() for k, v in sorted(groups.items())},
    }


def explainer_payload(result: dict, job: dict) -> str:
    """NIFTY 50's standardised features and fitted model for the explainer page."""
    from regime.encode import b64, encode_dates, encode_log_series, encode_runs
    from regime.model import emission_log_likelihood, filtered_posteriors

    fit = result['fit']
    q = np.round(result['features'] * 1000).astype(np.int64)
    x = q / 1000.0
    transmat = np.round(fit.transmat, 4)
    transmat = transmat / transmat.sum(axis=1, keepdims=True)
    means = np.round(fit.means, 4)
    covars = np.round(fit.covars, 5)

    class _M:  # the stored, rounded model, as the browser will see it
        means_ = means
        covars_ = covars
        transmat_ = transmat
        startprob_ = np.full(len(REGIME_ORDER), 1.0 / len(REGIME_ORDER))

    emission_log_likelihood(means, covars, x)  # fails loudly if not positive definite
    filt = filtered_posteriors(_M, x)
    return _dump({
        'v': 2, 'slug': job['slug'], 'name': job['name'], 'asof': str(result['dates'][-1].date()),
        'labels': REGIME_ORDER,
        'features': ['log_return', 'volatility_5d', 'volatility_20d', 'volume_zscore', 'momentum_10d'],
        'n': len(x),
        'dates': encode_dates(result['dates']),
        'px': encode_log_series(result['close']),
        'x': [b64(q[:, j], 'int16') for j in range(q.shape[1])],
        'x_scale': 1000,
        'scaler_mean': [round(float(v), 6) for v in result['scaler']['mean']],
        'scaler_scale': [round(float(v), 6) for v in result['scaler']['scale']],
        'transmat': transmat.round(6).tolist(),
        'means': means.tolist(),
        'covars': covars.tolist(),
        'vit': encode_runs(fit.regimes),
        'filtered': b64(np.round(filt * 255).astype(np.int64).reshape(-1), 'uint8'),
    })


# ─── Helpers ─────────────────────────────────────────────────────────

def _status(job, ok, reason, t0):
    return {'slug': job['slug'], 'ok': ok, 'reason': reason, 'seconds': round(time.time() - t0, 1)}


def _short(exc: Exception) -> str:
    return (str(exc) or type(exc).__name__).splitlines()[0][:160]


def _dump(obj) -> str:
    return json.dumps(obj, separators=(',', ':'), sort_keys=True, ensure_ascii=False)


def _read_json(path: Path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f'.tmp{os.getpid()}')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, path)


def _size_stats(folder: Path) -> dict:
    sizes = [f.stat().st_size for f in folder.glob('*.json')]
    if not sizes:
        return {'count': 0}
    return {'count': len(sizes), 'mean': int(np.mean(sizes)), 'max': int(max(sizes)),
            'total': int(sum(sizes))}
