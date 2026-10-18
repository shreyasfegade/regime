"""
Fixtures shared by the Python and JavaScript test suites: a synthetic
ticker encoded by regime.encode, and the values Python decodes from it.
static/js/decode.js must decode the same file to the same numbers.

    python tests/js_fixtures.py     # regenerate tests/js/fixtures/
"""

import json
import logging
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
logging.getLogger('hmmlearn').setLevel(logging.ERROR)

from regime.analysis import analyze  # noqa: E402
from regime.encode import (  # noqa: E402
    decode_dates, decode_log_series, decode_posteriors, decode_runs, encode_ticker, to_json,
)
from regime.synthetic import synthetic_ohlcv  # noqa: E402

OUT = HERE / 'js' / 'fixtures'
META = {'slug': 'SYN', 'sym': 'SYN', 'yahoo': 'SYN.NS', 'name': 'Synthetic Ltd', 'sector': 'Test',
        'cap': 'M', 'rank': 7, 'exchange': 'NSE'}


def build() -> tuple[str, str]:
    df, _ = synthetic_ohlcv(900, seed=5)
    payload = json.loads(to_json(encode_ticker(analyze(df, seeds=(42, 7)), META)))
    expected = {
        'dates': [str(d) for d in decode_dates(payload['dates'])],
        'close': [round(float(v), 6) for v in decode_log_series(payload['px'])],
        'post': [[round(float(v), 6) for v in row] for row in decode_posteriors(payload['post'])],
        'vit': decode_runs(payload['vit'], payload['n']).tolist(),
        'oos': decode_runs(payload['oos']['runs'], payload['n']).tolist(),
    }
    return to_json(payload), json.dumps(expected, separators=(',', ':'))


def build_explainer() -> str:
    from regime.pipeline import explainer_payload
    df, _ = synthetic_ohlcv(400, seed=8)
    return explainer_payload(analyze(df, seeds=(42,)), {'slug': 'SYN', 'name': 'Synthetic'})


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'explainer.json').write_text(build_explainer(), encoding='utf-8')
    ticker, expected = build()
    (OUT / 'ticker.json').write_text(ticker, encoding='utf-8')
    (OUT / 'expected.json').write_text(expected, encoding='utf-8')
    print('wrote', OUT)
