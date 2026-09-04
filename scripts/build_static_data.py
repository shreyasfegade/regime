"""
REGIME — export the static data bundle the Vercel frontend falls back to.

The frontend is hosted as a static site on Vercel and proxies `/api/*` to the
Python backend. A free-tier backend cold-starts (or, if it is ever torn down,
disappears), which would leave the demo with a live page and no data. This
script writes the parts of the API that never need a live fit into plain JSON
next to the frontend:

    static/data/presets.json              ← /api/presets
    static/data/examples.json             ← /api/examples
    static/data/analyze/<SLUG>.json       ← /api/analyze for each showcase ticker
    static/data/walkforward/<SLUG>.json   ← /api/walkforward, ditto

`app.js` reads these first and only calls the backend for a live fit, so the
dashboard paints real data instantly and never depends on the backend being
awake. The walk-forward payloads matter most: refitting the HMM on a rolling
schedule takes minutes on a free instance, far past any gateway timeout, so
the toggle would simply never resolve for a visitor without them.

Regenerate with `python scripts/build_static_data.py` after
`scripts/build_cache.py`, and commit the result.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from datetime import datetime  # noqa: E402

from backtest import run_walkforward  # noqa: E402
from cache import EXAMPLES, _slug, list_examples, load_cached  # noqa: E402
from config import DEFAULT_START, TICKER_PRESETS  # noqa: E402
from data import fetch_ohlcv, normalize_ticker  # noqa: E402
from features import raw_feature_matrix  # noqa: E402
from model import fit_hmm, label_states  # noqa: E402

OUT = ROOT / "static" / "data"


def write(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"  {path.relative_to(ROOT)}  ({path.stat().st_size / 1024:.0f} KB)")


def main() -> None:
    print("Exporting static data bundle…")
    write(OUT / "presets.json", {"presets": TICKER_PRESETS})
    write(OUT / "examples.json", {"examples": list_examples()})

    for ex in EXAMPLES:
        payload = load_cached(ex["ticker"])
        if payload is None:
            print(f"  skip {ex['ticker']} — no cache file")
            continue
        write(OUT / "analyze" / f"{_slug(ex['ticker'])}.json", payload)

    end = datetime.now().strftime("%Y-%m-%d")
    for ex in EXAMPLES:
        ticker = normalize_ticker(ex["ticker"])
        out = OUT / "walkforward" / f"{_slug(ex['ticker'])}.json"
        if out.exists():
            print(f"  keep {out.name} — delete it to refit")
            continue
        print(f"  walk-forward {ticker} (refits on a rolling schedule, slow)…", flush=True)
        try:
            df = fetch_ohlcv(ticker, DEFAULT_START, end)
            raw, dates_index = raw_feature_matrix(df)
            close = df.loc[dates_index, "Close"].values
            result = run_walkforward(raw, dates_index, close, label_states, fit_hmm)
        except Exception as exc:  # noqa: BLE001 — report and continue
            print(f"  FAIL {ticker}: {exc}")
            continue
        if result is None:
            print(f"  skip {ticker} — history too short for a walk-forward")
            continue
        write(out, result)

    print("Done.")


if __name__ == "__main__":
    main()
