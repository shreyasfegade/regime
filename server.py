"""
REGIME — FastAPI Server
Exposes /api/analyze endpoint returning full regime analysis as JSON.
Serves the static frontend from /static.
"""

from datetime import datetime

import numpy as np
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from analytics import crisis_early_warning, forward_return_edge, model_diagnostics
from backtest import run_backtest, run_walkforward
from config import DEFAULT_START, DEFAULT_TICKER, REGIME_COLORS, TICKER_PRESETS
from data import currency_for, fetch_ohlcv, normalize_ticker
from features import engineer_features, raw_feature_matrix
from model import (
    compute_persistence_forecast,
    compute_regime_stats,
    decode_states,
    fit_hmm,
    get_regime_blocks,
    label_states,
)

app = FastAPI(title="REGIME API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> FileResponse:
    """Serve the main frontend page."""
    return FileResponse("static/index.html")


@app.get("/api/presets")
async def presets() -> JSONResponse:
    """Return the curated ticker presets for the UI picker."""
    return JSONResponse(content={"presets": TICKER_PRESETS})


@app.get("/api/analyze")
async def analyze(
    ticker: str = Query(default=DEFAULT_TICKER),
    start: str = Query(default=DEFAULT_START),
    end: str = Query(default=None),
) -> JSONResponse:
    """Run the full regime analysis pipeline and return JSON."""
    if end is None:
        end = datetime.now().strftime("%Y-%m-%d")

    try:
        result = _run_pipeline(normalize_ticker(ticker), start, end)
        return JSONResponse(content=result)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    except Exception:
        return JSONResponse(
            status_code=500,
            content={"error": "Something went wrong. Check your connection and try again."},
        )


@app.get("/api/walkforward")
async def walkforward(
    ticker: str = Query(default=DEFAULT_TICKER),
    start: str = Query(default=DEFAULT_START),
    end: str = Query(default=None),
) -> JSONResponse:
    """
    Out-of-sample walk-forward backtest. Heavier than /api/analyze (it refits
    the HMM on a rolling schedule), so it's a separate, opt-in endpoint the UI
    calls only when the user asks for it.
    """
    if end is None:
        end = datetime.now().strftime("%Y-%m-%d")
    try:
        df = fetch_ohlcv(normalize_ticker(ticker), start, end)
        raw, dates_index = raw_feature_matrix(df)
        close = df.loc[dates_index, "Close"].values
        result = run_walkforward(raw, dates_index, close, label_states, fit_hmm)
        if result is None:
            return JSONResponse(
                status_code=400,
                content={"error": "Need a longer history (3+ years) to run a walk-forward test."},
            )
        return JSONResponse(content=result)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    except Exception:
        return JSONResponse(
            status_code=500,
            content={"error": "Walk-forward failed. Try again in a moment."},
        )


def _run_pipeline(ticker: str, start: str, end: str) -> dict:
    """Execute fetch → features → HMM → decode → package JSON."""
    df = fetch_ohlcv(ticker, start, end)
    features_array, dates_index, scaler = engineer_features(df)
    hmm_model = fit_hmm(features_array)
    state_sequence, state_probs = decode_states(hmm_model, features_array)
    label_map = label_states(hmm_model)

    df_trimmed = df.loc[dates_index]
    current_state = int(state_sequence[-1])
    current_label = label_map[current_state]
    current_confidence = float(state_probs[-1, current_state])
    persistence = compute_persistence_forecast(hmm_model, current_state)
    stats = compute_regime_stats(df_trimmed, state_sequence, label_map)
    blocks = get_regime_blocks(dates_index, state_sequence, label_map)
    close = df_trimmed["Close"].values
    backtest = run_backtest(close, dates_index, state_sequence, label_map)
    analytics = {
        "forward_edge": forward_return_edge(close, state_sequence, label_map),
        "crisis_warning": crisis_early_warning(
            hmm_model.transmat_, state_probs[-1], label_map,
        ),
        "diagnostics": model_diagnostics(hmm_model, features_array, len(label_map)),
    }

    return _build_response(
        ticker, df_trimmed, dates_index, state_sequence,
        state_probs, label_map, stats, blocks,
        hmm_model, current_label, current_confidence, persistence,
        backtest, analytics,
    )


def _build_response(
    ticker: str, df, dates_index, state_sequence,
    state_probs, label_map, stats, blocks,
    hmm_model, current_label, current_confidence, persistence,
    backtest, analytics,
) -> dict:
    """Package all analysis results into the JSON response dict."""
    dates_list = [d.strftime("%Y-%m-%d") for d in dates_index]

    ohlc_list = [
        {
            "o": round(float(row["Open"]), 2),
            "h": round(float(row["High"]), 2),
            "l": round(float(row["Low"]), 2),
            "c": round(float(row["Close"]), 2),
        }
        for _, row in df.iterrows()
    ]

    color_map = {
        label: REGIME_COLORS[label]["primary"]
        for label in REGIME_COLORS
    }

    stats_dict = {}
    for _, row in stats.iterrows():
        stats_dict[row["regime"]] = {
            "days": int(row["days_count"]),
            "pct": float(row["pct_time"]),
            "avg_ret": float(row["avg_daily_return"]),
            "avg_vol": float(row["avg_volatility"]),
        }

    trans_matrix = hmm_model.transmat_.tolist()

    regime_blocks = [
        {
            "start": s.strftime("%Y-%m-%d"),
            "end": e.strftime("%Y-%m-%d"),
            "label": lbl,
        }
        for s, e, lbl in blocks
    ]

    str_label_map = {str(k): v for k, v in label_map.items()}

    return {
        "ticker": ticker,
        "currency": currency_for(ticker),
        "dates": dates_list,
        "ohlc": ohlc_list,
        "volume": [int(v) for v in df["Volume"].values],
        "state_sequence": [int(s) for s in state_sequence],
        "state_probs": [
            [round(float(p), 4) for p in row]
            for row in state_probs
        ],
        "label_map": str_label_map,
        "regime_colors": color_map,
        "regime_stats": stats_dict,
        "transition_matrix": trans_matrix,
        "current_regime": current_label,
        "current_confidence": round(current_confidence, 4),
        "persistence_forecast": round(persistence, 1),
        "regime_blocks": regime_blocks,
        "backtest": backtest,
        "analytics": analytics,
    }


app.mount("/static", StaticFiles(directory="static"), name="static")
