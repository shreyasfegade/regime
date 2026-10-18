import json

import pandas as pd
import pytest

from regime import pipeline
from regime.data import clean_ohlcv, download_batch, pick_longer, with_retry
from regime.synthetic import synthetic_ohlcv
from regime.validate import validate

UNIVERSE = [
    {'rank': 1, 'slug': 'AAA', 'name': 'Aaa Ltd', 'nse': 'AAA', 'bse': 'AAA', 'cap': 'L', 'sector': 'Power'},
    {'rank': 2, 'slug': 'BBB', 'name': 'Bbb Ltd', 'nse': 'BBB', 'bse': '', 'cap': 'M', 'sector': 'Power'},
    {'rank': 3, 'slug': 'CCC-BSE', 'name': 'Ccc Ltd', 'nse': '', 'bse': 'CCC', 'cap': 'S', 'sector': 'Realty'},
    {'rank': 4, 'slug': 'DDD', 'name': 'Ddd Ltd', 'nse': 'DDD', 'bse': '', 'cap': 'S', 'sector': 'Realty'},
]


def frames_downloader(frames, calls=None):
    """A fake yf.download over a dict of symbol → frame."""
    def dl(symbols, **kwargs):
        if calls is not None:
            calls.append(list(symbols))
        got = {s: frames[s] for s in symbols if s in frames}
        return pd.concat(got, axis=1) if got else pd.DataFrame()
    return dl


def test_retry_backs_off_then_succeeds():
    attempts, sleeps = [], []

    def flaky():
        attempts.append(1)
        if len(attempts) < 3:
            raise ConnectionError('rate limited')
        return 'ok'
    assert with_retry(flaky, tries=4, base=1.0, sleep=sleeps.append) == 'ok'
    assert len(attempts) == 3
    assert 1.0 <= sleeps[0] <= 1.5 and 2.0 <= sleeps[1] <= 3.0


def test_retry_gives_up_and_raises():
    with pytest.raises(ConnectionError):
        with_retry(lambda: (_ for _ in ()).throw(ConnectionError('down')), tries=3, sleep=lambda s: None)


def test_empty_batch_response_is_retried():
    calls = []
    df, _ = synthetic_ohlcv(600, seed=1)

    def dl(symbols, **kw):
        calls.append(1)
        return pd.DataFrame() if len(calls) == 1 else pd.concat({'AAA.NS': df}, axis=1)
    out = download_batch(['AAA.NS'], '2016-01-01', downloader=dl, sleep=lambda s: None)
    assert list(out) == ['AAA.NS'] and len(calls) == 2


def test_clean_rejects_short_and_gappy_series():
    short, _ = synthetic_ohlcv(300, seed=1)
    with pytest.raises(ValueError, match='sessions of history'):
        clean_ohlcv(short)
    gappy, _ = synthetic_ohlcv(800, seed=1)
    gappy.iloc[::10, 3] = float('nan')
    with pytest.raises(ValueError, match='missing'):
        clean_ohlcv(gappy)


def test_pick_longer_prefers_longer_exchange_history():
    a, _ = synthetic_ohlcv(600, seed=1)
    b, _ = synthetic_ohlcv(900, seed=2)
    assert pick_longer({'X.NS': a, 'X.BO': b})[0] == 'X.BO'


def test_shards_partition_jobs_exactly():
    jobs = pipeline.jobs_from_universe(UNIVERSE)
    parts = [pipeline.shard(jobs, i, 3) for i in range(3)]
    slugs = sorted(j['slug'] for p in parts for j in p)
    assert slugs == sorted(j['slug'] for j in jobs)
    assert len(set(slugs)) == len(slugs)
    with pytest.raises(ValueError):
        pipeline.shard(jobs, 3, 3)


def test_fetch_skips_failures_and_keeps_going():
    good, _ = synthetic_ohlcv(900, seed=1)
    short, _ = synthetic_ohlcv(200, seed=2)
    frames = {'AAA.NS': good, 'AAA.BO': good.iloc[:700], 'BBB.NS': short, 'CCC.BO': good}
    jobs = pipeline.jobs_from_universe(UNIVERSE, include_indices=False)
    got = {j['slug']: (df, exch, sym, reason) for j, df, exch, sym, reason in
           pipeline.fetch_jobs(jobs, '2016-01-01', frames_downloader(frames))}
    assert got['AAA'][2] == 'AAA.NS' and got['AAA'][1] == 'NSE'
    assert got['BBB'][0] is None and 'sessions of history' in got['BBB'][3]
    assert got['CCC-BSE'][1] == 'BSE'
    assert got['DDD'][0] is None


@pytest.fixture(scope='module')
def built(tmp_path_factory):
    """A small synthetic run, end to end."""
    out = tmp_path_factory.mktemp('data')
    good, _ = synthetic_ohlcv(1500, seed=3)
    frames = {'AAA.NS': good, 'BBB.NS': synthetic_ohlcv(1500, seed=4)[0], 'CCC.BO': synthetic_ohlcv(1500, seed=5)[0]}
    jobs = pipeline.jobs_from_universe(UNIVERSE, include_indices=False)
    statuses = pipeline.run(jobs, str(out), downloader=frames_downloader(frames), workers=2,
                            start='2016-01-01', log=lambda m: None)
    meta = pipeline.merge(str(out), jobs, '2025-12-31')
    return out, jobs, statuses, meta


def test_run_writes_files_and_logs_failures(built):
    out, jobs, statuses, meta = built
    assert sorted(f.stem for f in (out / 't').glob('*.json')) == ['AAA', 'BBB', 'CCC-BSE']
    failed = [s for s in statuses if not s['ok']]
    assert [s['slug'] for s in failed] == ['DDD']
    assert meta['universe'] == {'source': 'AMFI average market capitalisation list', 'list_date': '2025-12-31',
                                'size': 4, 'covered': 3, 'indices': 0}
    excluded = json.loads((out / 'excluded.json').read_text())['rows']
    assert [e['slug'] for e in excluded] == ['DDD'] and excluded[0]['reason']
    assert not (out / '_status').exists()


def test_index_and_breadth_are_consistent(built):
    out, *_ = built
    index = json.loads((out / 'index.json').read_text())
    assert [r[0] for r in index['rows']] == ['AAA', 'BBB', 'CCC-BSE']   # by AMFI rank
    b = json.loads((out / 'breadth.json').read_text())
    counts = b['groups']['all']
    weeks = len(b['weeks'])
    assert len(counts) == 4 and all(len(c) == weeks for c in counts)
    assert max(sum(c[w] for c in counts) for w in range(weeks)) == 3
    assert sum(sum(c) for c in b['groups']['cap:M']) <= weeks


def test_failed_ticker_keeps_its_previous_file(built, tmp_path):
    out, jobs, _, _ = built
    import shutil
    data = tmp_path / 'data'
    shutil.copytree(out, data)
    before = (data / 't' / 'AAA.json').read_text()
    # This week Yahoo has nothing for AAA.
    pipeline.run([j for j in jobs if j['slug'] == 'AAA'], str(data), downloader=frames_downloader({}),
                 start='2016-01-01', log=lambda m: None)
    meta = pipeline.merge(str(data), jobs, '2025-12-31')
    assert (data / 't' / 'AAA.json').read_text() == before
    assert meta['universe']['covered'] == 3


def test_validator_accepts_good_data_and_rejects_collapse(built, tmp_path):
    out, *_ = built
    assert validate(out, None, min_covered=3) == []
    problems = validate(out, {'universe': {'covered': 1400}, 'asof': '2099-01-01'}, min_covered=1)
    assert any('covered' in p for p in problems)
    assert any('backwards' in p for p in problems)


def test_validator_rejects_oversize_and_orphans(built, tmp_path):
    out, *_ = built
    import shutil
    data = tmp_path / 'd'
    shutil.copytree(out, data)
    (data / 't' / 'ZZZ.json').write_text('{"v": 2}' + ' ' * 60_000)
    problems = validate(data, None, min_covered=1)
    assert any('exceeds' in p for p in problems)
    assert any('disagree' in p for p in problems)
