import random
from datetime import datetime, timedelta, timezone

import pytest

from custom_components.waterheater_planner.planner import (
    HybridConfig, PlanInputs, build_plan, build_window, select_cheapest, solar_hours,
)
from .helpers import slots_from

UTC = timezone.utc
T0 = datetime(2026, 9, 22, 0, 0, tzinfo=UTC)


def fill_cost(window, idx, need_units, power_kw):
    """What heating costs in the chosen slots: filled in time order, the last one only as far as needed."""
    remaining, cost = need_units, 0.0
    for i in idx:
        used = min(window[i].units, remaining)
        cost += window[i].price * used * 5 / 60.0 * power_kw
        remaining -= used
    return cost


def brute_force(window, need_units, max_blocks, power_kw):
    """Cheapest subset covering need with at most max_blocks contiguous runs, by enumeration."""
    best = None
    n = len(window)
    for mask in range(1 << n):
        idx = [i for i in range(n) if mask >> i & 1]
        units = sum(window[i].units for i in idx)
        if units < need_units:
            continue
        blocks = sum(1 for k, i in enumerate(idx) if k == 0 or window[idx[k - 1]].end != window[i].start)
        if blocks > max_blocks:
            continue
        cost = fill_cost(window, idx, need_units, power_kw)
        if best is None or cost < best - 1e-9:
            best = cost
    return best


def cost_of(window, idx, power_kw):
    return sum(window[i].price * window[i].kwh(power_kw) for i in idx)


@pytest.mark.parametrize("seed", range(40))
def test_dp_matches_brute_force(seed):
    rng = random.Random(seed)
    n = rng.randint(3, 11)
    prices = [round(rng.uniform(-5, 60), 1) for _ in range(n)]
    slots = slots_from(prices)
    window = build_window(slots, T0, T0 + timedelta(minutes=15 * n))
    need_units = rng.randint(1, 3 * n)
    blocks = rng.randint(1, 4)
    chosen = select_cheapest(window, need_units, blocks, 3.0)
    expected = brute_force(window, need_units, blocks, 3.0)
    if expected is None:
        assert chosen is None
    else:
        assert chosen is not None
        assert fill_cost(window, chosen, need_units, 3.0) == pytest.approx(expected)
        assert sum(window[i].units for i in chosen) >= need_units
        runs = sum(1 for k, i in enumerate(chosen) if k == 0 or chosen[k - 1] != i - 1)
        assert runs <= blocks


def test_a_short_current_slot_is_not_used_just_because_it_is_cheap_in_total():
    # Now is 13 minutes before the end of a dear slot; much cheaper slots follow. Heating in the short
    # dear slot must not win just because it is small (it used to, the cost was counted per whole slot).
    prices = [150, 150, 150, 120, 120, 120, 110, 110, 110, 110, 110, 110, 110, 110]
    slots = slots_from(prices)
    now = T0 + timedelta(minutes=2)
    deadline = T0 + timedelta(minutes=15 * len(prices))
    plan = build_plan(PlanInputs(
        mode="cheapest", now=now, deadline=deadline, need_kwh=1.5, power_kw=3.0, max_periods=4,
        price_slots=slots, forecast_wh=None, hybrid=HybridConfig(),
    ))
    assert plan.status == "ok" and plan.cost_minor == pytest.approx(1.5 * 110)
    assert all(p.start >= T0 + timedelta(minutes=90) for p in plan.periods)


def test_window_clips_current_and_last_slot():
    slots = slots_from([10, 20, 30, 40])
    now = T0 + timedelta(minutes=7)  # 8 minutes left of the first slot -> one 5-minute unit
    window = build_window(slots, now, T0 + timedelta(minutes=50))  # last slot ends 5 min in
    assert [w.units for w in window] == [1, 3, 3, 1]
    assert window[0].start == now
    assert window[-1].end == T0 + timedelta(minutes=50)


def inputs(**kw):
    base = dict(
        mode="cheapest", now=T0, deadline=T0 + timedelta(hours=6), need_kwh=3.0, power_kw=3.0,
        max_periods=4, price_slots=slots_from([50] * 24), forecast_wh=None, hybrid=HybridConfig(),
    )
    base.update(kw)
    return PlanInputs(**base)


def test_nothing_to_heat():
    plan = build_plan(inputs(need_kwh=0))
    assert plan.status == "satisfied" and plan.periods == ()


def test_cheapest_picks_the_cheap_hour_and_costs_it():
    prices = [50] * 24
    prices[8:12] = [10, 10, 10, 10]  # one cheap hour at 02:00-03:00
    plan = build_plan(inputs(price_slots=slots_from(prices), need_kwh=3.0))
    assert plan.status == "ok"
    assert len(plan.periods) == 1
    p = plan.periods[0]
    assert p.start == T0 + timedelta(hours=2) and p.end == T0 + timedelta(hours=3)
    assert plan.cost_minor == pytest.approx(30.0)  # 3 kWh * 10
    assert plan.cost_now_minor == pytest.approx(150.0)  # 3 kWh * 50 starting now
    assert plan.saving_minor == pytest.approx(120.0)
    assert plan.runtime_min == pytest.approx(60.0)
    assert plan.runs_at(T0 + timedelta(hours=2, minutes=30))
    assert not plan.runs_at(T0 + timedelta(hours=1))


def test_last_period_is_trimmed_to_the_need():
    prices = [50] * 24
    prices[8:12] = [10] * 4
    plan = build_plan(inputs(price_slots=slots_from(prices), need_kwh=2.25))  # 45 min at 3 kW
    assert plan.periods[0].end - plan.periods[0].start == timedelta(minutes=45)
    assert plan.cost_minor == pytest.approx(22.5)


def test_max_periods_forces_one_block():
    prices = [90] * 24
    prices[2:4] = [1, 1]
    prices[10:12] = [1, 1]
    two = build_plan(inputs(price_slots=slots_from(prices), need_kwh=3.0, max_periods=2))
    one = build_plan(inputs(price_slots=slots_from(prices), need_kwh=3.0, max_periods=1))
    assert len(two.periods) == 2 and len(one.periods) == 1
    assert two.cost_minor < one.cost_minor


def test_deadline_too_close_means_heat_now():
    plan = build_plan(inputs(deadline=T0 + timedelta(minutes=30), need_kwh=6.0))
    assert plan.status == "insufficient" and plan.force_now
    assert plan.runs_at(T0 + timedelta(minutes=1))


def test_no_prices():
    plan = build_plan(inputs(price_slots=()))
    assert plan.status == "no_prices"


def test_fully_priced_window_is_not_waiting():
    plan = build_plan(inputs(deadline=T0 + timedelta(hours=6)))  # 24 slots = exactly 6 h of prices
    assert plan.waiting_for_prices is False and plan.periods


def test_unpublished_tail_defers_what_can_wait():
    # 6 h priced, deadline in 30 h: 24 h * 3 kW * 0.8 of capacity is still to come, so buy nothing now
    plan = build_plan(inputs(deadline=T0 + timedelta(hours=30)))
    assert plan.waiting_for_prices is True and plan.periods == ()


def test_unpublished_tail_buys_only_what_cannot_wait():
    # deadline 2 h after the last price: 2 h * 3 kW * 0.8 = 4.8 kWh can wait, so 6 - 4.8 = 1.2 kWh now
    plan = build_plan(inputs(deadline=T0 + timedelta(hours=8), need_kwh=6.0))
    assert plan.waiting_for_prices is True
    assert plan.grid_kwh == pytest.approx(1.2)


def test_solar_mode_buys_nothing_from_the_grid():
    sun = {T0 + timedelta(hours=h): 6000.0 for h in range(10, 14)}
    plan = build_plan(inputs(mode="solar", forecast_wh=sun, deadline=T0 + timedelta(hours=16), hybrid=HybridConfig(solar_start_w=2000)))
    assert plan.grid_kwh == 0 and plan.periods == ()
    assert plan.solar_kwh == pytest.approx(3.0)  # capped at the need


# ---------------------------------------------------------------- hybrid


def hybrid_inputs(**kw):
    sun = {T0 + timedelta(hours=h): 6000.0 for h in range(10, 14)}  # 4 sunny hours
    prices = [80.0] * 40 + [30.0] * 16 + [80.0] * 40  # dear night, cheap-ish midday
    base = dict(
        mode="hybrid", deadline=T0 + timedelta(hours=16), need_kwh=6.0,
        price_slots=slots_from(prices), forecast_wh=sun, hybrid=HybridConfig(solar_start_w=2000),
    )
    base.update(kw)
    return inputs(**base)


def test_hybrid_without_forecast_equals_cheapest():
    h = build_plan(hybrid_inputs(forecast_wh=None))
    c = build_plan(hybrid_inputs(forecast_wh=None, mode="cheapest"))
    assert h.hybrid_state == "no_forecast"
    assert h.grid_kwh == pytest.approx(6.0) and h.cost_minor == pytest.approx(c.cost_minor)


def test_hybrid_holds_everything_back_when_half_the_forecast_covers_the_need():
    # 4 sunny hours * min(5.5 kW, 3 kW) = 12 kWh forecast; trusted at 50 % = 6 kWh = the whole need
    plan = build_plan(hybrid_inputs())
    assert plan.hybrid_state == "waiting_for_sun"
    assert plan.solar_kwh == pytest.approx(6.0)
    assert plan.grid_kwh == pytest.approx(0.0) and plan.periods == ()


def test_hybrid_small_forecast_means_some_night_heating():
    sun = {T0 + timedelta(hours=11): 3000.0}  # one weak hour: 2.5 kW usable -> 2.5 kWh, trusted at half
    plan = build_plan(hybrid_inputs(forecast_wh=sun))
    assert plan.solar_kwh == pytest.approx(1.25)
    assert plan.grid_kwh == pytest.approx(4.75)
    assert plan.periods  # part of it is bought from the grid


def test_hybrid_never_holds_back_more_than_it_can_still_buy():
    # sun at 01:00-03:00, deadline 03:00: capacity 3 h * 3 kW * 0.8 = 7.2 kWh vs a need of 6 -> slack 1.2
    sun = {T0 + timedelta(hours=1): 6000.0, T0 + timedelta(hours=2): 6000.0}
    plan = build_plan(
        hybrid_inputs(forecast_wh=sun, deadline=T0 + timedelta(hours=3), price_slots=slots_from([80.0] * 96))
    )
    assert plan.hybrid_state == "waiting_for_sun"
    assert plan.solar_kwh == pytest.approx(1.2)  # half the forecast would be 3.0; the slack caps it
    assert plan.grid_kwh == pytest.approx(4.8)


def test_hybrid_last_call():
    plan = build_plan(hybrid_inputs(deadline=T0 + timedelta(hours=2), need_kwh=6.0))
    assert plan.hybrid_state == "last_call" and plan.solar_kwh == 0


def test_hybrid_holding_back_pays_even_at_equal_prices():
    # sun is free if it comes and costs the same as tonight if it does not
    plan = build_plan(hybrid_inputs(price_slots=slots_from([30.0] * 96)))
    assert plan.hybrid_state == "waiting_for_sun" and plan.solar_kwh > 0


def test_hybrid_not_worth_it_when_the_night_is_much_cheaper_than_the_fallback():
    # night at 10, from sunrise on 30: holding back 10 to maybe pay 30 loses on average
    prices = [10.0] * 40 + [30.0] * 56
    plan = build_plan(hybrid_inputs(price_slots=slots_from(prices)))
    assert plan.hybrid_state == "not_worth_it"
    assert plan.grid_kwh == pytest.approx(6.0) and plan.solar_kwh == 0


def test_solar_hours_respect_baseline_and_start_threshold():
    cfg = HybridConfig(house_baseline_w=500, solar_start_w=2000)
    hours = solar_hours(
        {T0 + timedelta(hours=9): 2400.0, T0 + timedelta(hours=10): 2600.0},
        now=T0, deadline=T0 + timedelta(hours=24), power_kw=3.0, config=cfg,
    )
    assert [h.start.hour for h in hours] == [10]  # 2400-500 < 2000, 2600-500 >= 2000
    assert hours[0].kwh == pytest.approx(2.1)
