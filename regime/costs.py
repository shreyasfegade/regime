"""
REGIME — Trading costs
What a rebalance actually costs a retail investor in India, using Zerodha's
equity-delivery schedule (config.COSTS) plus a slippage assumption by
market-cap band (config.SLIPPAGE_BPS).

Indices cannot be bought directly. They are backtested as an index-ETF
proxy charged at the same delivery schedule, which errs on the expensive
side (ETF units attract lower STT than shares).
"""

from regime.config import COSTS, NOTIONAL_INR, SLIPPAGE_BPS

COMPONENTS: tuple[str, ...] = ('stt', 'exchange', 'sebi', 'stamp', 'gst', 'dp', 'slippage')


def trade_cost(buy_value: float, sell_value: float, exchange: str = 'NSE',
               cap: str = 'L') -> dict[str, float]:
    """
    Cost of one rebalance, in rupees, broken down by component.

    Args:
        buy_value:  rupee value bought on the day (>= 0).
        sell_value: rupee value sold on the day (>= 0).
        exchange:   'NSE' or 'BSE' (sets the transaction charge).
        cap:        'L' / 'M' / 'S' / 'I' market-cap band (sets slippage).
    """
    if buy_value < 0 or sell_value < 0:
        raise ValueError('Traded values must be non-negative.')
    traded = buy_value + sell_value
    txn_rate = COSTS['txn_bse'] if exchange == 'BSE' else COSTS['txn_nse']
    exchange_fee = traded * txn_rate
    sebi = traded * COSTS['sebi']
    brokerage = traded * COSTS['brokerage']
    out = {
        'stt': traded * COSTS['stt'],
        'exchange': exchange_fee,
        'sebi': sebi,
        'stamp': buy_value * COSTS['stamp_buy'],
        'gst': COSTS['gst'] * (brokerage + exchange_fee + sebi),
        'dp': COSTS['dp_per_sell'] if sell_value > 0 else 0.0,
        'slippage': traded * SLIPPAGE_BPS.get(cap, SLIPPAGE_BPS['S']) / 10_000,
    }
    out['total'] = sum(out[c] for c in COMPONENTS)
    return out


def rebalance_cost_fraction(w_from: float, w_to: float, equity: float,
                            exchange: str = 'NSE', cap: str = 'L') -> dict[str, float]:
    """
    Cost of moving exposure from w_from to w_to, as a fraction of current
    portfolio value. `equity` is the portfolio value relative to its start,
    so the flat DP charge shrinks as the portfolio grows.
    """
    value = max(equity, 1e-9) * NOTIONAL_INR
    delta = w_to - w_from
    buy = max(delta, 0.0) * value
    sell = max(-delta, 0.0) * value
    if buy == 0 and sell == 0:
        return {c: 0.0 for c in (*COMPONENTS, 'total')}
    rupees = trade_cost(buy, sell, exchange, cap)
    return {k: v / value for k, v in rupees.items()}
