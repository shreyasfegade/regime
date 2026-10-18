"""
REGIME — Compact data format
Turns an analysis result into the per-ticker JSON file the static site
lazy-loads. Ten years of daily data fits in well under 50 KB by:

  • dates     — first date + base64 uint8 calendar-day gaps
  • prices    — base64 int16 deltas of round(ln close × 2000) (±0.025%)
  • posteriors— base64 uint8 × 3 per day (the fourth is 1 − the rest)
  • regimes   — run-length encoded [start, length, regime]
  • equity    — every 5th session, encoded like prices

Integer arrays are little-endian. Output is deterministic (fixed rounding,
sorted keys), so a re-run on unchanged data produces identical bytes and
the weekly refresh commits only what actually moved.

The decode_* functions mirror static/js/decode.js and exist so the tests
can prove the format round-trips.
"""

import base64
import json

import numpy as np

from regime.config import REGIME_ORDER
from regime.model import runs

FORMAT_VERSION: int = 2
PRICE_SCALE: float = 2000.0
POST_SCALE: int = 255
EQUITY_STRIDE: int = 5


# ─── Primitives ──────────────────────────────────────────────────────

def b64(arr: np.ndarray, dtype: str) -> str:
    a = np.asarray(arr)
    info = np.iinfo(dtype)
    if a.size and (a.min() < info.min or a.max() > info.max):
        raise ValueError(f'value out of range for {dtype}')
    return base64.b64encode(a.astype(np.dtype(dtype).newbyteorder('<')).tobytes()).decode('ascii')


def unb64(s: str, dtype: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), dtype=np.dtype(dtype).newbyteorder('<')).astype(np.int64)


def encode_dates(dates) -> dict:
    days = np.asarray(dates.values.astype('datetime64[D]').astype(np.int64))
    gaps = np.diff(days, prepend=days[0])
    return {'d0': str(dates[0].date()), 'gaps': b64(gaps, 'uint8')}


def decode_dates(enc: dict) -> np.ndarray:
    d0 = np.datetime64(enc['d0'], 'D').astype(np.int64)
    return (d0 + np.cumsum(unb64(enc['gaps'], 'uint8'))).astype('datetime64[D]')


def encode_log_series(values: np.ndarray) -> dict:
    q = np.round(np.log(np.asarray(values, dtype=float)) * PRICE_SCALE).astype(np.int64)
    return {'q0': int(q[0]), 'd': b64(np.diff(q, prepend=q[0]), 'int16')}


def decode_log_series(enc: dict) -> np.ndarray:
    q = enc['q0'] + np.cumsum(unb64(enc['d'], 'int16'))
    return np.exp(q / PRICE_SCALE)


def encode_posteriors(p: np.ndarray) -> str:
    q = np.round(np.asarray(p)[:, :3] * POST_SCALE).astype(np.int64)
    return b64(q.reshape(-1), 'uint8')


def decode_posteriors(s: str) -> np.ndarray:
    q = unb64(s, 'uint8').reshape(-1, 3).astype(float)
    last = np.clip(POST_SCALE - q.sum(axis=1, keepdims=True), 0, None)
    full = np.hstack([q, last])
    return full / full.sum(axis=1, keepdims=True)


def encode_runs(regimes: np.ndarray, offset: int = 0) -> list[list[int]]:
    return [[s + offset, n, r] for s, n, r in runs(regimes)]


def decode_runs(rle: list[list[int]], n: int, fill: int = -1) -> np.ndarray:
    out = np.full(n, fill, dtype=int)
    for s, length, r in rle:
        out[s:s + length] = r
    return out


def equity_sample_index(m: int, stride: int = EQUITY_STRIDE) -> np.ndarray:
    """Sampled positions of an m-point curve: every stride-th plus the last."""
    return np.unique(np.concatenate([np.arange(0, m, stride), [m - 1]]))


def _r(x, nd):
    """Round a float, array or None to nd decimals for stable JSON."""
    if x is None:
        return None
    if isinstance(x, (list, tuple, np.ndarray)):
        return [_r(v, nd) for v in x]
    x = float(x)
    if not np.isfinite(x):
        return None
    return round(x, nd)


# ─── Ticker file ─────────────────────────────────────────────────────

def _encode_backtest(bt: dict | None, offset: int) -> dict | None:
    if bt is None:
        return None
    s, b = bt['strategy_equity'], bt['benchmark_equity']
    idx = equity_sample_index(len(s))
    return {
        'start': bt['start'],
        'offset': offset,
        'm': len(s),
        'stride': EQUITY_STRIDE,
        'strategy': encode_log_series(s[idx]),
        'benchmark': encode_log_series(b[idx]),
        'metrics': bt['metrics'],
    }


def encode_ticker(result: dict, meta: dict) -> dict:
    """
    Build the per-ticker JSON payload.

    `meta` carries the universe fields: slug, sym, yahoo, name, sector, cap,
    rank (None for indices), exchange.
    """
    fit = result['fit']
    dates = result['dates']
    wf = result['walkforward']
    rob = result['robustness']
    today = result['today']
    tril = np.tril_indices(fit.covars.shape[-1])
    exp_rem = today['expected_remaining']

    return {
        'v': FORMAT_VERSION,
        **{k: meta.get(k) for k in ('slug', 'sym', 'yahoo', 'name', 'sector', 'cap', 'rank', 'exchange')},
        'ccy': 'INR',
        'asof': str(dates[-1].date()),
        'n': len(dates),
        'labels': REGIME_ORDER,
        'dates': encode_dates(dates),
        'px': encode_log_series(result['close']),
        'post': encode_posteriors(fit.posteriors),
        'vit': encode_runs(fit.regimes),
        'oos': None if wf is None else {
            'split': str(dates[wf['split']].date()),
            'runs': encode_runs(wf['regimes'][wf['split']:], wf['split']),
        },
        'model': {
            'transmat': _r(fit.transmat, 4),
            'means': _r(fit.means, 4),
            'covars_tril': [_r(c[tril], 5) for c in fit.covars],
            'scaler_mean': _r(result['scaler']['mean'], 6),
            'scaler_scale': _r(result['scaler']['scale'], 6),
        },
        'today': {
            'regime': today['regime'],
            'posterior': _r(today['posterior'], 4),
            'days_in': today['days_in'],
            'expected_remaining': _r(exp_rem, 1),
        },
        'stats': result['stats'],
        'forward_edge': result['forward_edge'],
        'crisis_warning': result['crisis_warning'],
        'diagnostics': result['diagnostics'],
        'robustness': rob,
        'backtest': {
            'is': _encode_backtest(result['backtest']['is'], 0),
            'oos': _encode_backtest(result['backtest']['oos'], wf['split'] if wf else 0),
        },
    }


def to_json(payload: dict) -> str:
    """Deterministic compact JSON."""
    return json.dumps(payload, separators=(',', ':'), sort_keys=True, ensure_ascii=False,
                      default=_json_default)


def warm_start_from(payload: dict) -> dict | None:
    """Recover the warm-start parameters stored in a previous ticker file."""
    try:
        m = payload['model']
        tril_rows = np.asarray(m['covars_tril'], dtype=float)
        k = tril_rows.shape[0]
        d = len(m['means'][0])
        covars = np.zeros((k, d, d))
        il = np.tril_indices(d)
        for j in range(k):
            covars[j][il] = tril_rows[j]
            covars[j] = covars[j] + np.tril(covars[j], -1).T
        return {'transmat': np.asarray(m['transmat']), 'means': np.asarray(m['means']), 'covars': covars}
    except (KeyError, TypeError, ValueError, IndexError):
        return None


def _json_default(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f'not JSON serialisable: {type(o).__name__}')
