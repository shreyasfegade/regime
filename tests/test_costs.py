import pytest

from regime.config import COSTS, NOTIONAL_INR, SLIPPAGE_BPS
from regime.costs import rebalance_cost_fraction, trade_cost


def test_zerodha_delivery_buy_by_hand():
    # Buy ₹1,00,000 on NSE, large cap.
    c = trade_cost(100_000, 0, 'NSE', 'L')
    assert c['stt'] == pytest.approx(100.0)          # 0.1%
    assert c['exchange'] == pytest.approx(3.07)      # 0.00307%
    assert c['sebi'] == pytest.approx(0.10)          # ₹10 / crore
    assert c['stamp'] == pytest.approx(15.0)         # 0.015% on buys
    assert c['gst'] == pytest.approx(0.18 * (3.07 + 0.10))
    assert c['dp'] == 0.0                            # only on sell days
    assert c['slippage'] == pytest.approx(50.0)      # 5 bps
    assert c['total'] == pytest.approx(100 + 3.07 + 0.10 + 15 + 0.18 * 3.17 + 50)


def test_sell_side_pays_dp_not_stamp():
    c = trade_cost(0, 50_000, 'BSE', 'S')
    assert c['stamp'] == 0.0
    assert c['dp'] == COSTS['dp_per_sell']
    assert c['exchange'] == pytest.approx(50_000 * COSTS['txn_bse'])
    assert c['slippage'] == pytest.approx(50_000 * SLIPPAGE_BPS['S'] / 1e4)


def test_half_rebalance_is_half_the_value():
    full = rebalance_cost_fraction(0.0, 1.0, 1.0)
    half = rebalance_cost_fraction(0.0, 0.5, 1.0)
    assert half['stt'] == pytest.approx(full['stt'] / 2)
    assert rebalance_cost_fraction(0.5, 0.5, 1.0)['total'] == 0.0


def test_flat_dp_charge_shrinks_as_portfolio_grows():
    small = rebalance_cost_fraction(1.0, 0.0, 1.0)['dp']
    big = rebalance_cost_fraction(1.0, 0.0, 4.0)['dp']
    assert small == pytest.approx(COSTS['dp_per_sell'] / NOTIONAL_INR)
    assert big == pytest.approx(small / 4)


def test_negative_values_rejected():
    with pytest.raises(ValueError):
        trade_cost(-1, 0)
