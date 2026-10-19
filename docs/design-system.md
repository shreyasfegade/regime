# REGIME design system

REGIME reads like a research note with a terminal underneath. Pages look like a
well-set financial report: serif headlines, ruled tables and figures that could
be printed. The data underneath is dense, exact and navigable from the keyboard.
This document is the reference for every page.

## Principles

1. **The reading order is the argument.** Every stock page answers three
   questions in order: what is the regime today, how did it get here, and why
   should you believe it. Headline, figure, evidence.
2. **Colour means regime.** The four regime colours are the only hues on the
   site. Everything else is paper and ink. If something is coloured, it is
   telling you which regime it belongs to.
3. **Every number is set in mono.** Figures use tabular, lining numerals, so
   columns align and digits never jump while a cursor moves.
4. **Charts are figures.** Each one is numbered, titled, has a one-line dek,
   labelled axes with units, a source line and an as-of date. No chart library;
   everything is drawn on Canvas.
5. **Nothing decorative.** No gradients, glows, glass, particles, emoji or
   animated backdrops. Motion is a 200 ms fade, and none at all under
   `prefers-reduced-motion`.
6. **Every state is designed.** Loading, not covered, offline, malformed
   data, stale data and short history each have their own screen or panel
   message. One failing panel never takes the page down.

## Colour

All colours are CSS custom properties in `static/css/regime.css`. A test
(`tests/test_static.py`) fails the build if any other hex colour appears, or if
any text colour drops below WCAG AA (4.5:1) on either paper tone in either
theme.

| Token | Light (paper) | Dark (terminal) | Use |
|---|---|---|---|
| `--paper` | `#F5F2EA` | `#111214` | page background |
| `--paper-2` | `#ECE8DD` | `#191B1E` | tracks, hover, selected rows |
| `--ink` | `#17160F` | `#ECE9E1` | text, price line, strategy line |
| `--ink-2` | `#47443B` | `#BDB9AE` | secondary text, deks |
| `--ink-3` | `#66625A` | `#9A968C` | axis labels, captions, buy-and-hold line |
| `--rule` / `--rule-2` / `--rule-ink` | ink at 14% / 32% / 78% | paper-ink at 13% / 28% / 74% | hairlines, dividers, axis baselines |

**Regimes.** Each has an *ink* tone for text, swatches and lines, and a *wash*
for bands behind price.

| Regime | Light ink | Dark ink | Character |
|---|---|---|---|
| Bullish Trending | `#1D6A46` deep green | `#63BE8E` | up-trend, contained volatility |
| Accumulation | `#355A8F` slate blue | `#8EAEE0` | quiet, low-volatility base |
| Bearish Trending | `#8A5208` ochre | `#DDA352` | down-trend, elevated volatility |
| Crisis | `#B02A1F` vermilion | `#F27B6B` | highest volatility, disorderly |

The four are separated by lightness as well as hue. Crisis is also always
**hatched** (diagonal lines) in bands and swatches. Every regime appears next
to its name, so no reading depends on colour alone.

Themes: light is the default. Dark follows `prefers-color-scheme` and can be
set with the masthead toggle, which is stored per visitor. Canvas figures
re-read the tokens and redraw when the theme changes.

## Type

| Role | Face | Setting |
|---|---|---|
| Headlines, figure titles, prose | Newsreader (variable, optical size) | 64 / 32 / 22 / 18 px, `opsz` matched to size |
| Interface, labels, captions | IBM Plex Sans 400 / 500 / 600 | 15 px body, 11 px uppercase kickers at +0.14em |
| Every number | IBM Plex Mono 400 / 500 | tabular lining figures, −0.01em |

Fonts are self-hosted WOFF2, subset to the characters the site uses (Latin,
typographic punctuation, the true minus sign). The rupee sign ₹ ships as a
separate one-glyph file selected by `unicode-range`. About 176 KB in all, under
the SIL Open Font License (`static/fonts/OFL-*.txt`).

Numbers: Indian digit grouping (12,34,567), a true minus (−), explicit + on
signed changes, ₹ for stock prices, and plain points for index levels.

## Layout

- One column, max 1240 px, gutters `clamp(16px, 4vw, 40px)`.
- Sections are separated by a full-width ink rule (`--rule-ink`), never by
  cards or shadows.
- Detail panels sit in a two-column grid on desktop and stack below 900 px.
- Tables: uppercase 11 px headers over an ink rule, hairline row rules,
  right-aligned mono numerals, a caption underneath giving the basis.
- Touch targets are at least 32 px tall, 44 px for primary controls.

## Figures

Anatomy, top to bottom:

```
FIG. 1                                   ← mono label
Regime timeline over price               ← serif title
Daily close on a log scale. Each band…   ← dek: what you are looking at
[1Y 3Y 5Y Max]  ■ Bullish ■ Accum…       ← tools and legend
┌───────────────────────────────┐ ₹1,211 ← direct labels on the right axis
│ bands · price line · events   │
└───────────────────────────────┘
16 Oct 2026 · ₹1,211 · Bearish 99%       ← live readout (aria-live)
Source: … · Data as of …                 ← foot
```

- **Axes:** values on the right, hairline gridlines, sparse ticks (1-2-5 on log
  scales, years or months on time).
- **Bands:** a regime wash for the full plot height, plus a 6 px solid strip
  along the floor so the regime reads at a glance.
- **Events:** dashed hairlines with labels in up to two rows above the plot,
  laid out left to right so they never collide.
- **Legends:** direct labels at line ends where possible, otherwise a single
  legend row above the figure.
- **Cursor:** a one-pixel ink rule. Linked figures (timeline, ribbon,
  calendar) share it.

The kit lives in `static/js/figure.js`: DPR-aware sizing, `ResizeObserver`
redraws, scales, tick generators, the Crisis hatch, label layout and the
`Figure` class.

## Pages

**Market (`/`).** Opens with one serif sentence naming the largest regime
("19 of the 50 NIFTY 50 stocks are Bearish"), a 100% composition bar and the
four counts. Below it: an indices strip (a ruled 4 × 2 grid), Fig. 1 breadth
over time, and Fig. 2, the map.

- *Breadth* is a 100% stacked area of weekly counts. Crisis sits on the
  baseline and Bearish above it, so the top of the ochre band reads directly as
  the share of the market in a falling regime. Direct labels sit at the right
  end; a sector selector and range buttons sit above.
- *Map tiles* are 104 × 46 px links carrying the symbol and today's confidence.
  A tile is solid regime ink when confidence is at least 80%, and the regime
  wash with a 3 px ink edge when it is lower. Crisis tiles add a hatched right
  edge. Tiles group by sector (largest group first) or by regime, ordered by
  AMFI rank. The map is a single tab stop; arrow keys, Home and End move
  between tiles, and focus or hover opens the tooltip card.
- *Table view* has the same rows, with sortable column headings (`aria-sort`).
  Turning every regime off shows an empty-filter notice instead of a blank.

**Explainer (`/how-it-works`).** On desktop, a 5 : 7 grid: numbered steps on
the left in the prose face, and one sticky figure on the right that switches
when a step crosses the middle of the viewport. The active step carries a 3 px
ink rule on its left edge; inactive steps keep full contrast. On screens under
900 px, or with reduced motion, every step instead carries its own static
figure inline. Controls (range inputs, link-style buttons) sit in the step
text, and the belief bars beside them are plain HTML, so they work with a
screen reader. Without JavaScript the page reads as an article.

**Methodology (`/methodology`).** A 200 px sticky table of contents beside a
74ch column of prose. Formulas are set in mono on a paper-2 block with an ink
rule. Reference tables (features, costs, exclusions) use the standard table
style inside the prose column. The covered list is set in three columns, each
name with its regime swatch.

**404.** The not-covered state layout: kicker, serif title, one sentence
pointing to the `/stock/SYMBOL` pattern, and two actions.

## Interaction and accessibility

- Search is an ARIA combobox (`/` focuses it; ↑ ↓ Enter Esc). It covers
  exactly the universe, and says so when a query misses.
- Every figure is focusable. ← → move the cursor one session, Shift+← → or
  PgUp/PgDn a month, Home/End jump to the ends, Esc clears. The readout under
  the figure is an `aria-live` region, and each canvas has a text alternative.
- The transition matrix is a real table of buttons with arrow-key movement.
  Selecting a cell lists every historical example, and each one jumps the
  timeline to that date.
- URLs are shareable: `/stock/RELIANCE?range=5Y&at=2020-03-23` restores the
  range and the cursor; `/?view=table&sort=posterior&group=regime&show=0,3`
  restores the market view.
- A skip link, landmarks, visible 2 px focus rings, and an axe-core pass with
  no serious or critical violations on every page and state
  (`scripts/screenshots.mjs`).

## States

| State | Treatment |
|---|---|
| Loading | Kicker plus a mono "Loading RELIANCE…" line over a ruled skeleton. No spinner, no shimmer. |
| Not covered | Serif headline naming the ticker, the universe definition, the exclusion reason if it is a known member, and similar names. |
| Offline / timeout | Plain explanation, a **Try again** button, and a link back. Nothing is computed live, so a retry always suffices. |
| Malformed data | Same layout, worded as a data problem. |
| Stale data | Ochre-ruled notice under the masthead when the latest data is over 10 days old. |
| Short history | The walk-forward view is disabled with a note saying why. |
| Panel failure | That panel alone shows "This panel could not be drawn". |
