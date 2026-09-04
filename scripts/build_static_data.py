"""
REGIME — export the static data bundle the Vercel frontend falls back to.

The frontend is hosted as a static site on Vercel and proxies `/api/*` to the
Python backend. A free-tier backend cold-starts (or, if it is ever torn down,
disappears), which would leave the demo with a live page and no data. This
script writes the parts of the API that never need a live fit into plain JSON
next to the frontend:

    static/data/presets.json          ← /api/presets
    static/data/examples.json         ← /api/examples
    static/data/analyze/<SLUG>.json   ← /api/analyze for each showcase ticker

`app.js` reads these first and only calls `/api/*` for a live fit, so the
dashboard paints real data instantly and never depends on the backend being
awake. Regenerate with `python scripts/build_static_data.py` after
`scripts/build_cache.py`, and commit the result.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from cache import EXAMPLES, _slug, load_cached, list_examples  # noqa: E402
from config import TICKER_PRESETS  # noqa: E402

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

    print("Done.")


if __name__ == "__main__":
    main()
