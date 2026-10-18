"""Checks on the static site itself: no backend, accessible colours, and the
JS decoder fixtures in step with the Python encoder."""

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / 'static'
CSS = (STATIC / 'css' / 'regime.css').read_text(encoding='utf-8')
TEXT_TOKENS = ['--ink', '--ink-2', '--ink-3', '--bull', '--accum', '--bear', '--crisis']


def site_files():
    return [p for p in STATIC.rglob('*') if p.suffix in ('.html', '.js', '.css', '.json')
            and 'data' not in p.relative_to(STATIC).parts]


@pytest.mark.parametrize('pattern', [r'onrender\.com', r'railway\.app', r'/api/', r'gsap', r'aurora', r'particle'])
def test_no_backend_or_retired_effects(pattern):
    hits = [str(p.relative_to(ROOT)) for p in site_files() if re.search(pattern, p.read_text(encoding='utf-8'), re.I)]
    assert hits == [], f'{pattern} found in {hits}'


def test_vercel_config_has_no_proxy():
    cfg = json.loads((STATIC / 'vercel.json').read_text())
    assert all('/api' not in r['source'] for r in cfg.get('rewrites', []))


def _block(selector: str) -> dict[str, str]:
    m = re.search(re.escape(selector) + r'\s*\{(.*?)\n\}', CSS, re.S)
    assert m, selector
    return dict(re.findall(r'(--[\w-]+):\s*(#[0-9A-Fa-f]{6})', m.group(1)))


def _luminance(hex_):
    c = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a, b):
    la, lb = sorted([_luminance(a), _luminance(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


@pytest.mark.parametrize('theme', [':root', ":root[data-theme='dark']"])
def test_text_tokens_meet_wcag_aa(theme):
    t = _block(theme)
    for bg in ('--paper', '--paper-2'):
        for tok in TEXT_TOKENS:
            ratio = contrast(t[tok], t[bg])
            assert ratio >= 4.5, f'{theme} {tok} on {bg}: {ratio:.2f}'


def test_dark_tokens_are_identical_in_both_dark_rules():
    explicit = _block(":root[data-theme='dark']")
    system = dict(re.findall(r'(--[\w-]+):\s*(#[0-9A-Fa-f]{6})', CSS.split(":root:not([data-theme='light'])")[1].split('}')[0]))
    assert explicit == system


def test_only_regime_hues_are_used():
    # Every hex colour in the stylesheet is a token: paper/ink neutrals or a regime ink.
    colours = set(re.findall(r'#[0-9A-Fa-f]{6}', CSS))
    tokens = set(_block(':root').values()) | set(_block(":root[data-theme='dark']").values())
    assert colours <= tokens


def test_js_fixtures_are_current():
    from tests.js_fixtures import build, build_explainer
    ticker, expected = build()
    assert json.loads((ROOT / 'tests' / 'js' / 'fixtures' / 'explainer.json').read_text()) == json.loads(build_explainer())
    fx = ROOT / 'tests' / 'js' / 'fixtures'
    assert json.loads((fx / 'ticker.json').read_text()) == json.loads(ticker), 'run python tests/js_fixtures.py'
    assert json.loads((fx / 'expected.json').read_text()) == json.loads(expected)
