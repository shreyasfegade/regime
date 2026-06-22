# REGIME

**Classify any equity into one of four hidden market regimes with a Gaussian Hidden Markov Model — then see it, trade it, and stress-test it.** Built India-first for NSE/BSE equities and indices, rendered through a zero-dependency HTML5 Canvas engine where every pixel is drawn by hand.

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![Canvas API](https://img.shields.io/badge/Canvas_API-E34F26?style=flat-square&logo=html5&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

![REGIME Dashboard](demo.gif)

> The demo above predates the current redesign — see [Running it](#running-it) to spin up the live interface.

---

## The idea

Markets are non-stationary. A stock spends months grinding higher in a calm uptrend, then a few brutal weeks in a volatility spike, then a long quiet base — and a single set of "average" statistics describes none of those phases well. **REGIME treats the market as a hidden state machine.** A 4-state Gaussian HMM reads daily return, volatility, volume, and momentum and infers which *unobserved* regime the market is in on any given day:

| Regime | Character | Strategy stance |
|---|---|---|
| 🟢 **Bullish Trending** | Positive drift, contained volatility | 100% invested |
| 🔵 **Accumulation** | Near-zero drift, very low volatility — quiet basing | 50% invested |
| 🟠 **Bearish Trending** | Negative drift, elevated volatility | Cash |
| 🔴 **Crisis** | Extreme dispersion, sharp downside — panic | Cash |

The states are discovered unsupervised; a labeler then maps each one to a semantic regime by inspecting the learned emission parameters, so the dashboard stays consistent across tickers and reruns.

## What's in it

- **4-state Gaussian HMM** over five engineered features — log return, 5- and 20-day volatility, volume z-score, and 10-day momentum — fit with `hmmlearn`, decoded via Viterbi, with posterior probabilities per day.
- **India-first data layer.** Native handling of NSE (`.NS`), BSE (`.BO`), and Indian indices (`^NSEI`, `^BSESN`, `^NSEBANK`), plus US symbols for comparison. Friendly aliases (`NIFTY` → `^NSEI`) and per-symbol currency rendering (₹ / $).
- **Regime-rotation backtest.** Turns the classification into a tradable long/flat signal, executes on the *prior* day's regime (no lookahead), charges realistic switching costs, and benchmarks against buy-and-hold — reporting CAGR, Sharpe, Sortino, max drawdown, Calmar, and time-in-market with an animated equity curve.
- **A custom Canvas renderer, not a charting library.** Candlesticks, probability fields, the transition heatmap, the regime timeline, and the equity curve are all drawn directly to `<canvas>` and animated with GSAP. The whole UI re-tints itself from the active regime.
- **Considered dark interface** — glass panels, a command-palette ticker picker, breathing probability bands, a regime-reactive particle field, and number count-ups, all tuned for a professional-tool feel.

## How it works

```
   ┌──────────────┐      ┌───────────────────┐      ┌────────────────────┐
   │  DATA LAYER  │      │     ML ENGINE     │      │      FRONTEND      │
   │              │      │                   │      │                    │
   │ yfinance     │─OHLCV│ 5-feature matrix  │states│ Canvas candlesticks│
   │ NSE/BSE/US   │─────►│ Gaussian HMM (EM) │─────►│ probability field  │
   │ validation   │ raw  │ Viterbi decode    │+probs│ transition heatmap │
   │ currency tag │      │ state auto-labeler│      │ backtest equity    │
   └──────────────┘      └─────────┬─────────┘      └────────────────────┘
                                   │ states + prices
                                   ▼
                         ┌───────────────────┐
                         │  BACKTEST ENGINE  │  regime → exposure,
                         │  1-bar lag + costs│  equity curve, metrics
                         └───────────────────┘
```

`server.py` exposes `/api/analyze?ticker=&start=&end=` (full pipeline → JSON) and `/api/presets` (the curated ticker list). The frontend is served static and talks only to those two endpoints.

## Running it

**Prerequisites:** Python 3.10+ and a modern browser.

```bash
git clone https://github.com/shreyasfegade/regime.git
cd regime
pip install -r requirements.txt
python -m uvicorn server:app --port 8050
```

Open **http://localhost:8050** and analyze. Defaults to `RELIANCE.NS`; try `^NSEI`, `INFY.NS`, `HDFCBANK.NS`, `TATAMOTORS.NS`, or a US name like `AAPL`. Indian equities need their exchange suffix (`.NS` for NSE, `.BO` for BSE); the picker fills it in for you.

## About the backtest

The backtest is a **diagnostic of the regime concept, not an out-of-sample trading record** — and the interface says so. Two design choices keep it honest:

- **One-bar execution lag.** The position held on day *t* is decided by the regime observed at the *close of day t-1*, so the strategy only ever acts on information it already had.
- **Switching costs.** A 5 bps round-trip cost (a realistic blended estimate of brokerage + STT + slippage on liquid Indian equities) is charged every time exposure changes.

The honest caveat: the HMM is fit once over the *entire* history, so the regime *labels* are in-sample. The lag and costs make the comparison fair; they don't make it predictive. A walk-forward refit is the natural next step (see below).

## Notes on yfinance & Indian coverage

- NSE and BSE equities resolve cleanly with `.NS` / `.BO` suffixes; large-cap history typically goes back well over a decade.
- **Indices often report zero or missing volume** on Yahoo (`^NSEI`, `^BSESN`). REGIME tolerates this — the volume z-score degrades gracefully rather than erroring.
- Yahoo data is **adjusted-close based** and occasionally has gaps around corporate actions or holidays; the data layer forward-fills small gaps and rejects series with more than 5% missing prices.
- A minimum of **two years** of history is required to fit the HMM reliably.

## Project layout

```
regime/
├── static/
│   ├── index.html     # Shell, design system, layout
│   └── app.js         # Canvas engine, animations, backtest curve
├── config.py          # Single source of truth: params, palette, presets, costs
├── data.py            # yfinance ingestion, ticker/currency handling, validation
├── features.py        # Five-feature engineering + normalization
├── model.py           # HMM fit, Viterbi decode, state labeling, regime stats
├── backtest.py        # Regime-rotation strategy + performance metrics
├── server.py          # FastAPI endpoints
└── requirements.txt
```

## Roadmap

- **Walk-forward backtest** — periodically refit the HMM on a trailing window and classify only forward, for a genuine out-of-sample record.
- **Regime-conditional position sizing** beyond the simple long/flat exposure map.
- **Intraday and crypto support** — adapt the features for 24/7 markets.

## License

MIT — see [LICENSE](LICENSE).
