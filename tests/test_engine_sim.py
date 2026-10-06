"""Closed-loop simulation: a real tank, real prices, the real engine, 30-second ticks."""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from custom_components.waterheater_planner.engine import Engine, HeaterConfig, Settings
from custom_components.waterheater_planner.model import KWH_PER_LITRE_KELVIN, Fiscal
from custom_components.waterheater_planner.planner import HybridConfig, PriceSlot, build_plan
from custom_components.waterheater_planner.solar import SolarConfig
from .conftest import load_fixture

UTC = timezone.utc
STO = ZoneInfo("Europe/Stockholm")
FISCAL = Fiscal(vat_percent=25, tax_minor=36, transfer_minor=30)  # SE4's suggested values
POWER_W, VOLUME_L = 3000.0, 200.0


def price_slots():
    """Two consecutive days: the real 2026-09-22 document and a copy shifted one day."""
    base = load_fixture("day_SE4_2026-09-22_96.json")  # EUR/kWh quarter prices, published SEK rate
    start = datetime(2026, 9, 21, 22, 0, tzinfo=UTC)  # 00:00 local
    slots = []
    for day in range(2):  # the same day twice
        for i, eur in enumerate(base["prices"]):
            slots.append(PriceSlot(start + timedelta(days=day, minutes=15 * i), FISCAL.effective_minor(eur * base["fx"]["SEK"])))
    return tuple(slots)


def make_engine(**settings):
    cfg = HeaterConfig(
        power_w=POWER_W, volume_l=VOLUME_L, tz=STO, fiscal=FISCAL,
        hybrid=HybridConfig(solar_start_w=2400), solar=SolarConfig(start_w=2400, stop_w=1500),
        has_surplus_sensor=True,
    )
    engine = Engine(cfg, Settings(**settings))
    engine.price_slots = price_slots()
    return engine


class Tank:
    def __init__(self, temp):
        self.temp, self.on = temp, False

    def step(self, seconds, now_local):
        if self.on:
            self.temp += POWER_W / 1000 * seconds / 3600 / (VOLUME_L * KWH_PER_LITRE_KELVIN)
        self.temp -= 0.08 * seconds / 3600  # standing loss, K/h


def simulate(engine, tank, start, hours, draws=(), sun_w=lambda t: 0.0, house_w=400.0):
    """Returns (kwh, cost_minor, log) and drives the engine like the controller does."""
    now, end = start, start + timedelta(hours=hours)
    kwh = cost = 0.0
    key, plan = None, None
    log = []
    prices = {s.start: s.price for s in engine.price_slots}
    while now < end:
        for when, drop in draws:
            if now.timestamp() <= when.timestamp() < now.timestamp() + 30:
                tank.temp -= drop
        k = engine.plan_key(now, tank.temp)
        if k != key:
            plan = build_plan(engine.plan_inputs(now, tank.temp))
            key = k
        pv = sun_w(now)
        grid_import = house_w + (POWER_W if tank.on else 0.0) - pv
        avail = engine.available_w(grid_import, None, tank.on)
        decision = engine.decide(now, tank.temp, plan, avail, tank.on)
        if decision.command is not None:
            tank.on = decision.command
        tank.step(30, now)
        if tank.on:
            e = POWER_W / 1000 * 30 / 3600
            slot = datetime.fromtimestamp((now.timestamp() // 900) * 900, UTC)
            solar_share = min(1.0, max(0.0, pv - house_w) / POWER_W)  # the sun's share is free
            kwh += e
            cost += e * (1 - solar_share) * prices[slot]
        log.append((now, tank.temp, tank.on, decision.status))
        now += timedelta(seconds=30)
    return kwh, cost, log


START = datetime(2026, 9, 22, 18, 0, tzinfo=STO).astimezone(UTC)


def thermostat_cost(start_temp, hours, draws):
    """A dumb thermostat on the same prices: heat whenever 2 K below target."""
    engine = make_engine()
    tank, now, cost = Tank(start_temp), START, 0.0
    prices = {s.start: s.price for s in engine.price_slots}
    while now < START + timedelta(hours=hours):
        for when, drop in draws:
            if now.timestamp() <= when.timestamp() < now.timestamp() + 30:
                tank.temp -= drop
        if tank.temp < 58:
            tank.on = True
        elif tank.temp >= 60:
            tank.on = False
        tank.step(30, now)
        if tank.on:
            e = POWER_W / 1000 * 30 / 3600
            cost += e * prices[datetime.fromtimestamp((now.timestamp() // 900) * 900, UTC)]
        now += timedelta(seconds=30)
    return cost


DRAWS = [(datetime(2026, 9, 23, 7, 0, tzinfo=STO), 9.0), (datetime(2026, 9, 22, 20, 0, tzinfo=STO), 6.0)]


def test_cheapest_reaches_the_target_in_cheap_hours_and_beats_a_thermostat():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=40)
    kwh, cost, log = simulate(engine, Tank(48.0), START, 24, draws=DRAWS)
    at_deadline = next(t for now, t, _, _ in log if now >= datetime(2026, 9, 23, 6, 59, tzinfo=STO))
    assert at_deadline >= 59.0
    assert max(t for _, t, _, _ in log) < 61.0  # never overshoots by more than one step
    assert min(t for _, t, _, _ in log) > 40.0  # comfort floor never needed
    dumb = thermostat_cost(48.0, 24, DRAWS)
    assert cost < dumb, (cost, dumb)


def test_cheapest_only_heats_inside_planned_slots():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=0)
    _, _, log = simulate(engine, Tank(48.0), START, 13)
    plan = build_plan(engine.plan_inputs(START, 48.0))
    assert plan.status == "ok" and plan.periods
    for now, _, on, status in log:
        if on:
            assert status == "heating_grid"
    heated_hours = {now.astimezone(STO).hour for now, _, on, _ in log if on}
    assert heated_hours <= {22, 23, 0, 1, 2, 3, 4, 5, 6, 18, 19, 20, 21}


def test_stops_exactly_at_target_whatever_the_plan_says():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=0)
    _, _, log = simulate(engine, Tank(59.5), START, 3)
    assert all(not on for _, t, on, _ in log if t >= 60.0 + 0.05)


def test_comfort_floor_heats_immediately_even_in_an_expensive_hour():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=40)
    _, _, log = simulate(engine, Tank(38.0), START, 1)
    assert log[0][2] is True and log[0][3] == "comfort_floor"


def test_disabled_leaves_the_switch_alone():
    engine = make_engine(enabled=False)
    decision = engine.decide(START, 30.0, None, None, True)
    assert decision.command is None and decision.status == "disabled"


def test_missing_temperature_is_bridged_briefly_then_fails_safe():
    engine = make_engine(mode="cheapest", min_c=0)
    engine.decide(START, 50.0, None, None, False)
    assert engine.decide(START + timedelta(minutes=5), None, None, None, False).status != "no_temperature"
    later = engine.decide(START + timedelta(minutes=20), None, None, None, True)
    assert later.status == "no_temperature" and later.command is False


def test_small_deficit_inside_the_hysteresis_band_does_not_start_a_cycle():
    engine = make_engine(mode="cheapest", target_c=60, min_c=0)
    assert engine.need_kwh(59.0) == 0.0  # 1 K < 2 K hysteresis
    assert engine.need_kwh(57.0) > 0.0
    engine.cycle_active = True
    assert engine.need_kwh(59.0) > 0.0  # but a running cycle finishes the job


def test_min_on_time_keeps_a_just_started_heater_running():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=0)
    now = START
    engine.decide(now, 50.0, None, None, False)
    engine.decide(now + timedelta(seconds=30), 50.0, None, None, True)  # we see it switched on
    d = engine.decide(now + timedelta(seconds=60), 50.0, build_plan(engine.plan_inputs(now, 50.0)), None, True)
    assert d.command is True


def test_deadline_rolls_to_tomorrow_after_ready_by():
    engine = make_engine(ready_by=time(7, 0))
    before = datetime(2026, 9, 23, 6, 0, tzinfo=STO).astimezone(UTC)
    after = datetime(2026, 9, 23, 8, 0, tzinfo=STO).astimezone(UTC)
    assert engine.deadline(before).astimezone(STO) == datetime(2026, 9, 23, 7, 0, tzinfo=STO)
    assert engine.deadline(after).astimezone(STO) == datetime(2026, 9, 24, 7, 0, tzinfo=STO)


def test_deadline_is_correct_across_the_autumn_clock_change():
    engine = make_engine(ready_by=time(7, 0))
    night = datetime(2026, 10, 24, 22, 0, tzinfo=STO).astimezone(UTC)  # clocks go back on 25 Oct
    assert engine.deadline(night).astimezone(STO) == datetime(2026, 10, 25, 7, 0, tzinfo=STO)
    assert engine.deadline(night) - night == timedelta(hours=10)  # 9 h of wall clock + the repeated hour


# ------------------------------------------------------------ solar and hybrid


def sun_curve(now):
    h = now.astimezone(STO).hour + now.astimezone(STO).minute / 60
    return max(0.0, 6000 * (1 - ((h - 13) / 4.5) ** 2)) if 8.5 <= h <= 17.5 else 0.0


SUNNY_FORECAST = {
    datetime(2026, 9, 23, h, 0, tzinfo=STO).astimezone(UTC): max(0.0, sun_curve(datetime(2026, 9, 23, h, 30, tzinfo=STO)))
    for h in range(24)
}


def test_solar_mode_heats_only_when_the_sun_is_there():
    engine = make_engine(mode="solar", target_c=60, ready_by=time(7, 0), min_c=0)
    start = datetime(2026, 9, 23, 6, 0, tzinfo=STO).astimezone(UTC)
    _, cost, log = simulate(engine, Tank(48.0), start, 12, sun_w=sun_curve)
    heated = [now.astimezone(STO) for now, _, on, _ in log if on]
    assert heated, "the sun should have heated the tank"
    assert min(heated).hour >= 9 and max(heated).hour <= 17
    assert all(status in ("heating_solar", "waiting_sun", "at_target") for _, _, _, status in log)
    # Sun is free apart from the ramp-up (the heater starts when the surplus first reaches 80 % of its
    # power, so a fifth of the first minutes comes from the grid). 3.5 kWh from the grid would cost ~700 öre.
    assert cost < 60.0


def test_solar_mode_without_a_surplus_sensor_says_so():
    engine = make_engine(mode="solar", min_c=0)
    engine.config = HeaterConfig(power_w=POWER_W, volume_l=VOLUME_L, tz=STO, has_surplus_sensor=False)
    plan = build_plan(engine.plan_inputs(START, 50.0))
    assert engine.decide(START, 50.0, plan, None, False).status == "no_surplus_sensor"


def test_hybrid_waits_for_tomorrows_sun_when_the_deadline_is_in_the_evening():
    engine = make_engine(mode="hybrid", target_c=60, ready_by=time(18, 0), min_c=0)
    engine.forecast_wh = SUNNY_FORECAST
    plan = build_plan(engine.plan_inputs(START, 48.0))  # 18:00, deadline 18:00 tomorrow
    assert plan.hybrid_state == "waiting_for_sun"
    assert plan.solar_kwh > 0 and plan.solar_kwh + plan.grid_kwh == pytest.approx(plan.need_kwh)


def test_hybrid_full_day_ends_warm_and_cheaper_than_a_thermostat():
    def day(mode):
        engine = make_engine(mode=mode, target_c=60, ready_by=time(18, 0), min_c=40)
        engine.forecast_wh = SUNNY_FORECAST
        return simulate(engine, Tank(48.0), START, 24, sun_w=sun_curve)
    _, hybrid_cost, hybrid_log = day("hybrid")
    # (Not compared with Cheapest: on this day the cheapest hours are the sunny ones, so Cheapest
    # also heats in the sun and both are almost free. A price-blind thermostat is the fair yardstick.)
    dumb = thermostat_cost(48.0, 24, [])
    deadline_temp = next(t for now, t, _, _ in hybrid_log if now >= datetime(2026, 9, 23, 17, 59, tzinfo=STO))
    assert deadline_temp >= 59.0, "hybrid must still deliver by the deadline"
    assert hybrid_cost < dumb, (hybrid_cost, dumb)


def test_hybrid_falls_back_to_the_grid_when_the_sun_fails():
    engine = make_engine(mode="hybrid", target_c=60, ready_by=time(18, 0), min_c=0)
    engine.forecast_wh = SUNNY_FORECAST  # forecast promises sun ...
    _, _, log = simulate(engine, Tank(48.0), START, 24, sun_w=lambda t: 0.0)  # ... but it never comes
    deadline_temp = next(t for now, t, _, _ in log if now >= datetime(2026, 9, 23, 17, 59, tzinfo=STO))
    assert deadline_temp >= 59.0
    assert any(status == "heating_grid" for _, _, _, status in log)


def test_energy_correction_scales_the_estimate():
    engine = make_engine(mode="cheapest", target_c=60)
    base = engine.need_kwh(45.0)
    engine.settings.energy_adjust_pct = 20
    assert engine.need_kwh(45.0) == pytest.approx(base * 1.2)
    engine.settings.energy_adjust_pct = -30
    assert engine.need_kwh(45.0) == pytest.approx(base * 0.7)
    engine.settings.energy_adjust_pct = -100  # never zero or negative
    assert engine.need_kwh(45.0) > 0


def test_comfort_floor_waits_while_the_price_is_over_its_cap():
    now = datetime(2026, 9, 22, 18, 0, tzinfo=UTC)
    engine = make_engine(mode="cheapest", target_c=60, min_c=40, ready_by=time(7, 0))
    price = engine.price_at(now)
    assert price is not None
    plan = build_plan(engine.plan_inputs(now, 30.0))
    assert engine.decide(now, 30.0, plan, None, False).status == "comfort_floor"  # no cap: heats

    capped = make_engine(mode="cheapest", target_c=60, min_c=40, ready_by=time(7, 0), floor_max_price=price - 1)
    plan = build_plan(capped.plan_inputs(now, 30.0))
    d = capped.decide(now, 30.0, plan, None, False)
    assert d.command is False and d.status in ("floor_price_cap", "heating_grid")

    ok = make_engine(mode="cheapest", target_c=60, min_c=40, ready_by=time(7, 0), floor_max_price=price + 1)
    plan = build_plan(ok.plan_inputs(now, 30.0))
    assert ok.decide(now, 30.0, plan, None, False).status == "comfort_floor"


def test_a_capped_floor_still_lets_the_cheap_plan_heat_and_boost_ignores_the_cap():
    # Find a moment inside a planned slot where the price is over a very low cap.
    engine = make_engine(mode="cheapest", target_c=60, min_c=40, ready_by=time(7, 0), floor_max_price=1)
    now = START
    plan = build_plan(engine.plan_inputs(now, 30.0))
    slot_start = plan.run_slots[0][0]
    d = engine.decide(slot_start, 30.0, plan, None, False)
    assert d.status == "heating_grid"  # the plan's cheap slot is not blocked by the floor cap
    engine.settings.boost = True
    assert engine.decide(START, 30.0, plan, None, False).status == "boost"


def test_learned_correction_replaces_the_manual_one_only_when_learning_is_on_and_has_an_answer():
    engine = make_engine(mode="cheapest", target_c=60)
    base = engine.need_kwh(45.0)
    engine.settings.energy_adjust_pct = -20
    engine.learned_pct = None  # nothing learned yet: manual applies
    assert engine.need_kwh(45.0) == pytest.approx(base * 0.8)
    engine.learned_pct = -50
    assert engine.need_kwh(45.0) == pytest.approx(base * 0.5)  # learned wins
    engine.settings.energy_auto = False
    assert engine.need_kwh(45.0) == pytest.approx(base * 0.8)  # learning switched off: manual again


def test_solar_base_temperature_heats_to_base_at_night_then_stops():
    # 10 °C water, base 25 °C by 07:00, nothing but the grid at night
    engine = make_engine(mode="solar", target_c=60, ready_by=time(16, 0), min_c=0, base_c=25, base_by=time(7, 0))
    start = datetime(2026, 9, 22, 20, 0, tzinfo=STO).astimezone(UTC)
    tank = Tank(10.0)
    _, _, log = simulate(engine, tank, start, 11)  # until 07:00, no sun
    assert any(st == "heating_base" for _, _, _, st in log)
    assert tank.temp >= 24.0, "base temperature reached by the morning"
    assert tank.temp < 27.0, "and the grid stopped there"
    assert not tank.on
    heated = [now for now, _, on, _ in log if on]
    assert max(heated) < datetime(2026, 9, 23, 7, 0, tzinfo=STO).astimezone(UTC)


def test_solar_base_temperature_goes_in_the_cheapest_hours():
    engine = make_engine(mode="solar", target_c=60, ready_by=time(16, 0), min_c=0, base_c=25, base_by=time(7, 0))
    start = datetime(2026, 9, 22, 20, 0, tzinfo=STO).astimezone(UTC)
    _, cost, log = simulate(engine, Tank(10.0), start, 11)
    prices = {s.start: s.price for s in engine.price_slots}
    paid = sorted(
        prices[datetime.fromtimestamp((n.timestamp() // 900) * 900, UTC)] for n, _, on, _ in log if on
    )
    night = sorted(p for s, p in prices.items() if start <= s < start + timedelta(hours=11))
    assert paid and sum(paid) / len(paid) <= sum(night) / len(night)


def test_solar_without_base_does_not_use_the_grid():
    engine = make_engine(mode="solar", target_c=60, ready_by=time(16, 0), min_c=0, base_c=0)
    start = datetime(2026, 9, 22, 20, 0, tzinfo=STO).astimezone(UTC)
    _, _, log = simulate(engine, Tank(10.0), start, 11)
    assert not any(on for _, _, on, _ in log)


def test_base_is_ignored_outside_solar_mode_and_when_above_target():
    e = make_engine(mode="cheapest", target_c=60, base_c=25)
    assert e.base_need_kwh(10.0) == 0
    e = make_engine(mode="solar", target_c=20, base_c=25)
    assert e.base_need_kwh(10.0) == 0
    e = make_engine(mode="solar", target_c=60, base_c=25)
    assert e.base_need_kwh(10.0) > 0 and e.base_need_kwh(26.0) == 0


def _sunny_engine(**settings):
    engine = make_engine(mode="solar", target_c=60, ready_by=time(18, 0), min_c=0, **settings)
    engine.forecast_wh = SUNNY_FORECAST
    return engine


MORNING = datetime(2026, 9, 23, 6, 0, tzinfo=STO).astimezone(UTC)


def test_sun_price_cap_off_plans_no_sun_slots():
    plan = build_plan(_sunny_engine(solar_price_cap=0).plan_inputs(MORNING, 40.0))
    assert plan.sun_slots == ()


def test_sun_price_cap_high_opens_every_sun_hour_even_with_no_live_surplus():
    engine = _sunny_engine(solar_price_cap=10_000)
    plan = build_plan(engine.plan_inputs(MORNING, 40.0))
    assert plan.sun_slots and all(9 <= s.astimezone(STO).hour <= 17 for s, _ in plan.sun_slots)
    # cloudy in reality: no surplus at all, yet the heater is allowed to run in a sun hour
    noon = datetime(2026, 9, 23, 12, 0, tzinfo=STO).astimezone(UTC)
    d = engine.decide(noon, 40.0, build_plan(engine.plan_inputs(noon, 40.0)), -500.0, False)
    assert d.command is True and d.status == "heating_sun_slot"
    night = datetime(2026, 9, 23, 3, 0, tzinfo=STO).astimezone(UTC)
    d = engine.decide(night, 40.0, build_plan(engine.plan_inputs(night, 40.0)), -500.0, False)
    assert d.command is False


def test_sun_price_cap_low_picks_only_the_cheapest_sun_hours():
    engine = _sunny_engine(solar_price_cap=1)  # nothing is that cheap
    plan = build_plan(engine.plan_inputs(MORNING, 40.0))
    open_all = build_plan(_sunny_engine(solar_price_cap=10_000).plan_inputs(MORNING, 40.0))
    assert plan.sun_slots, "the need still has to be covered inside sun hours"
    assert len(plan.sun_slots) < len(open_all.sun_slots)
    prices = {s.start: s.price for s in engine.price_slots}
    chosen = sorted(prices[s] for s, _ in plan.sun_slots)
    sun_prices = sorted(prices[s] for s, _ in open_all.sun_slots)
    assert sum(chosen) / len(chosen) <= sum(sun_prices) / len(sun_prices), "the cheapest sun hours, not just any"
    assert plan.grid_kwh < plan.need_kwh  # the sun's share is free


def test_sun_price_cap_closed_loop_heats_in_open_hours_and_stops_at_target():
    engine = _sunny_engine(solar_price_cap=10_000)
    tank = Tank(40.0)
    _, _, log = simulate(engine, tank, MORNING, 12, sun_w=lambda t: 0.0)  # sun never shows
    heated = [now.astimezone(STO) for now, _, on, _ in log if on]
    assert heated and min(heated).hour >= 9 and max(heated).hour <= 17
    assert tank.temp <= 61.0


def test_sun_hours_are_priced_as_unsold_electricity_not_free():
    engine = _sunny_engine(solar_price_cap=1)
    plan = build_plan(engine.plan_inputs(MORNING, 40.0))
    prices = {s.start: s.price for s in engine.price_slots}
    kwh = sum(p.kwh for p in plan.periods)
    lo, hi = min(prices.values()), max(prices.values())
    assert plan.cost_minor > 0 and kwh * lo <= plan.cost_minor <= kwh * hi
    assert plan.cost_minor / kwh > lo, "priced at the slot's price, not at the sun's zero"
    assert plan.cost_now_minor >= plan.cost_minor - 1e-6


def test_with_a_price_limit_surplus_in_a_dear_unchosen_hour_is_sold_not_heated():
    engine = _sunny_engine(solar_price_cap=1)
    plan = build_plan(engine.plan_inputs(MORNING, 40.0))
    chosen = {s for s, _ in plan.sun_slots}
    prices = {s.start: s.price for s in engine.price_slots}
    sun_hours = [datetime(2026, 9, 23, h, 0, tzinfo=STO).astimezone(UTC) for h in range(10, 17)]
    dear = max((t for t in sun_hours if t not in chosen), key=lambda t: prices[t])
    when = dear + timedelta(minutes=5)
    p = build_plan(engine.plan_inputs(when, 40.0))
    assert not p.sun_runs_at(when)
    d = engine.decide(when, 40.0, p, 4000.0, False)
    assert d.command is False and d.status in ("waiting_sun", "waiting_cheap")
    # without a limit the same surplus is used
    off = _sunny_engine(solar_price_cap=0)
    d = off.decide(when, 40.0, build_plan(off.plan_inputs(when, 40.0)), 4000.0, False)
    for _ in range(12):  # the controller needs a few ticks above the start threshold
        when += timedelta(seconds=30)
        d = off.decide(when, 40.0, build_plan(off.plan_inputs(when, 40.0)), 4000.0, False)
    assert d.command is True and d.status == "heating_solar"


def test_sun_priced_off_counts_the_sun_as_free():
    on = build_plan(_sunny_engine(solar_price_cap=1).plan_inputs(MORNING, 40.0))
    off = build_plan(_sunny_engine(solar_price_cap=1, sun_priced=False).plan_inputs(MORNING, 40.0))
    assert off.sun_slots == on.sun_slots
    assert 0 < off.cost_minor < on.cost_minor and off.cost_now_minor == 0


def _unchosen_hour_decision(**settings):
    engine = _sunny_engine(solar_price_cap=1, **settings)
    chosen = {s for s, _ in build_plan(engine.plan_inputs(MORNING, 40.0)).sun_slots}
    when = next(datetime(2026, 9, 23, h, 5, tzinfo=STO).astimezone(UTC) for h in range(10, 17)
                if datetime(2026, 9, 23, h, 0, tzinfo=STO).astimezone(UTC) not in chosen)
    d = None
    for i in range(12):
        t = when + timedelta(seconds=30 * i)
        d = engine.decide(t, 40.0, build_plan(engine.plan_inputs(t, 40.0)), 4000.0, False)
    return d


def test_surplus_in_an_unchosen_hour_is_sold_when_sell_other_sun_is_on():
    assert _unchosen_hour_decision(sell_other_sun=True).command is False


def test_surplus_in_an_unchosen_hour_is_used_when_sell_other_sun_is_off():
    d = _unchosen_hour_decision(sell_other_sun=False)
    assert d.command is True and d.status == "heating_solar"


def test_sun_priced_is_only_about_the_cost_not_about_what_the_heater_does():
    for priced in (True, False):
        assert _unchosen_hour_decision(sell_other_sun=False, sun_priced=priced).command is True
        assert _unchosen_hour_decision(sell_other_sun=True, sun_priced=priced).command is False


def _armed_engine(**kw):
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=0, regrid_c=50, **kw)
    engine.regrid_until = (START + timedelta(hours=30)).timestamp()  # a heating reached the target; "ready by" not yet passed
    return engine


def test_regrid_limit_is_not_in_force_before_a_heating_has_reached_the_target():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=0, regrid_c=50)
    assert engine.need_kwh(55.0, START) > 0.0  # never armed: planned as usual


def test_regrid_limit_keeps_the_grid_off_while_the_water_is_warm_enough():
    engine = _armed_engine()
    assert engine.need_kwh(55.0, START) == 0.0
    assert engine.need_kwh(49.0, START) > 0.0
    _, _, log = simulate(engine, Tank(55.0), START, 24)
    assert not any(on for _, _, on, _ in log)  # 55 only drifts down to ~53: no heating all day


def test_regrid_limit_heats_all_the_way_to_target_once_it_has_fallen_below():
    engine = _armed_engine()
    _, _, log = simulate(engine, Tank(49.0), START, 24)
    assert any(on for _, _, on, _ in log)
    assert max(t for _, t, _, _ in log) >= 59.0  # not stopped at 50 when the latch opened


def test_regrid_limit_ends_at_ready_by_and_normal_planning_resumes():
    engine = _armed_engine()
    before = START + timedelta(hours=8)   # 06:00 before the 07:00 deadline
    after = START + timedelta(hours=11)   # 09:00, deadline has rolled to tomorrow
    engine.regrid_until = (START + timedelta(hours=9)).timestamp()  # until 07:00
    assert engine.need_kwh(55.0, before) == 0.0
    assert engine.need_kwh(55.0, after) > 0.0


def test_regrid_limit_is_armed_when_a_heating_reaches_the_target_not_by_sitting_at_it():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=0, regrid_c=50)
    plan = build_plan(engine.plan_inputs(START, 55.0))
    engine.decide(START, 60.5, plan, None, False)  # already at target, nothing was heated
    assert engine.regrid_until == 0.0
    engine.cycle_active = True  # a heating was under way
    engine.decide(START + timedelta(minutes=30), 60.5, plan, None, False)
    assert engine.regrid_until == engine.deadline(START + timedelta(minutes=30)).timestamp()


def test_regrid_limit_off_is_the_old_behaviour():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=0, regrid_c=0)
    engine.regrid_until = (START + timedelta(hours=30)).timestamp()
    assert engine.need_kwh(55.0, START) > 0.0


def _manual_setup(**kw):
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(7, 0), min_c=0, **kw)
    plan = build_plan(engine.plan_inputs(START, 50.0))
    return engine, plan


def test_a_heater_switched_on_by_hand_is_left_on_until_the_target():
    engine, plan = _manual_setup()
    now = START
    engine.decide(now, 55.0, plan, None, False)  # the planner sees it off
    now += timedelta(seconds=30)
    d = engine.decide(now, 55.0, plan, None, True)  # on, and the planner did not ask for it
    assert d.command is True and d.status == "manual"
    now += timedelta(minutes=30)
    assert engine.decide(now, 58.0, plan, None, True).status == "manual"
    d = engine.decide(now + timedelta(minutes=5), 60.2, plan, None, True)
    assert d.command is False and d.status == "at_target"
    assert not engine.manual_active


def test_switching_it_off_by_hand_ends_the_manual_heating():
    engine, plan = _manual_setup()
    engine.decide(START, 55.0, plan, None, False)
    engine.decide(START + timedelta(seconds=30), 55.0, plan, None, True)
    assert engine.manual_active
    engine.decide(START + timedelta(minutes=20), 56.0, plan, None, False)
    assert not engine.manual_active


def test_the_planners_own_switch_on_is_not_manual():
    engine, plan = _manual_setup()
    now = START
    for _ in range(1000):  # until the plan wants heat
        d = engine.decide(now, 50.0, plan, None, False)
        if d.command:
            break
        now += timedelta(seconds=30)
    assert d.command is True and d.status != "manual"
    d2 = engine.decide(now + timedelta(seconds=30), 50.0, plan, None, True)  # the switch follows the command
    assert d2.status != "manual" and not engine.manual_active


def test_hybrid_base_temperature_is_bought_at_night_even_when_the_sun_covers_the_rest():
    engine = make_engine(mode="hybrid", target_c=60, ready_by=time(16, 0), min_c=0, base_c=25, base_by=time(7, 0))
    engine.forecast_wh = dict(SUNNY_FORECAST)
    start = datetime(2026, 9, 22, 20, 0, tzinfo=STO).astimezone(UTC)
    plan = build_plan(engine.plan_inputs(start, 10.0))
    base_kwh = engine.base_need_kwh(10.0)
    assert base_kwh > 3.0
    assert plan.grid_kwh >= base_kwh - 0.01
    assert plan.periods and plan.run_slots
    assert max(p.end for p in plan.periods) <= datetime(2026, 9, 23, 7, 0, tzinfo=STO).astimezone(UTC)
    # without a base temperature the same day is left to the sun
    plain = make_engine(mode="hybrid", target_c=60, ready_by=time(16, 0), min_c=0)
    plain.forecast_wh = dict(SUNNY_FORECAST)
    assert build_plan(plain.plan_inputs(start, 10.0)).grid_kwh < plan.grid_kwh


def test_hybrid_base_temperature_heats_to_base_at_night_then_stops():
    engine = make_engine(mode="hybrid", target_c=60, ready_by=time(16, 0), min_c=0, base_c=25, base_by=time(7, 0))
    engine.forecast_wh = dict(SUNNY_FORECAST)
    start = datetime(2026, 9, 22, 20, 0, tzinfo=STO).astimezone(UTC)
    tank = Tank(10.0)
    _, _, log = simulate(engine, tank, start, 11)  # until 07:00
    assert any(st == "heating_base" for _, _, _, st in log)
    assert 24.0 <= tank.temp < 28.0
    assert not tank.on


def test_base_temperature_is_ignored_in_cheapest_mode():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(16, 0), min_c=0, base_c=25, base_by=time(7, 0))
    assert engine.base_need_kwh(10.0) == 0.0


def test_surplus_only_sun_hours_do_not_heat_without_real_surplus():
    engine = _sunny_engine(solar_price_cap=10_000, sun_priced=False, sun_surplus_only=True)
    noon = datetime(2026, 9, 23, 12, 0, tzinfo=STO).astimezone(UTC)
    plan = build_plan(engine.plan_inputs(noon, 40.0))
    assert plan.sun_slots and plan.grid_kwh == 0.0 and plan.cost_minor == 0.0  # nothing bought, the sun is free
    d = engine.decide(noon, 40.0, plan, -500.0, False)  # a cloudy hour inside a chosen sun hour
    assert d.command is False and d.status == "waiting_sun"


def test_surplus_only_sun_hours_heat_when_the_surplus_is_there():
    engine = _sunny_engine(solar_price_cap=10_000, sun_priced=False, sun_surplus_only=True)
    start = datetime(2026, 9, 23, 9, 0, tzinfo=STO).astimezone(UTC)
    tank = Tank(40.0)
    _, _, log = simulate(engine, tank, start, 8, sun_w=sun_curve, house_w=400.0)
    assert any(on and st == "heating_sun_slot" for _, _, on, st in log)
    assert tank.temp > 41.0


def test_surplus_only_off_still_fills_in_from_the_grid():
    engine = _sunny_engine(solar_price_cap=10_000, sun_priced=False, sun_surplus_only=False)
    noon = datetime(2026, 9, 23, 12, 0, tzinfo=STO).astimezone(UTC)
    plan = build_plan(engine.plan_inputs(noon, 40.0))
    assert plan.grid_kwh > 0.0
    assert engine.decide(noon, 40.0, plan, -500.0, False).status == "heating_sun_slot"


def _early_sun_case(wait_saving, surplus_w):
    from custom_components.waterheater_planner.planner import PriceSlot as PS
    engine = make_engine(mode="hybrid", target_c=60, ready_by=time(18, 0), min_c=0, wait_saving=wait_saving)
    base = START.replace(minute=0, second=0, microsecond=0)
    # Now costs 50; an hour later 47 (3 cheaper); everything else is dear.
    engine.price_slots = tuple(PS(base + timedelta(minutes=15 * i), 50 if i < 4 else 47 if i < 8 else 90) for i in range(96))
    plan = build_plan(engine.plan_inputs(base, 45.0))
    return engine, plan, base, surplus_w


def test_small_saving_plus_sun_to_spare_heats_now():
    engine, plan, now, surplus = _early_sun_case(wait_saving=10, surplus_w=1200)
    assert plan.heat_now_ok and not plan.runs_at(now)
    d = engine.decide(now, 45.0, plan, 1200.0, switch_on=False)
    assert d.command is True and d.status == "heating_solar"


def test_small_saving_but_no_sun_keeps_waiting():
    engine, plan, now, _ = _early_sun_case(wait_saving=10, surplus_w=100)
    d = engine.decide(now, 45.0, plan, 100.0, switch_on=False)
    assert d.command is False and d.status == "waiting_cheap"


def test_without_the_setting_sun_to_spare_does_not_start_early():
    engine, plan, now, _ = _early_sun_case(wait_saving=0, surplus_w=1200)
    assert not plan.heat_now_ok
    d = engine.decide(now, 45.0, plan, 1200.0, switch_on=False)
    assert d.status == "waiting_cheap"


def test_early_start_levels_are_settings():
    engine, plan, now, _ = _early_sun_case(wait_saving=10, surplus_w=0)
    power = engine.config.power_w
    engine.settings.early_start_pct = 50.0
    assert engine.decide(now, 45.0, plan, power * 0.4, switch_on=False).status == "waiting_cheap"
    assert engine.decide(now + timedelta(seconds=30), 45.0, plan, power * 0.6, switch_on=False).status == "heating_solar"
    engine.settings.early_keep_pct = 40.0  # keeps going down to 40 %
    assert engine.decide(now + timedelta(seconds=60), 45.0, plan, power * 0.45, switch_on=True).status == "heating_solar"
    assert engine.decide(now + timedelta(seconds=90), 45.0, plan, power * 0.3, switch_on=True).status == "waiting_cheap"


def test_a_heating_that_finishes_just_after_ready_by_does_not_guard_the_evening():
    # Began at 17:30 for the 18:00 deadline, reached the target at 18:02: the next day's heating is planned as usual.
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(18, 0), min_c=0, regrid_c=20)
    began = START - timedelta(minutes=30)  # START is 18:00 local
    plan = build_plan(engine.plan_inputs(began, 50.0))
    engine.decide(began, 50.0, plan, None, False)
    engine.cycle_active = True
    engine.decide(began, 50.0, plan, None, True)  # the cycle is under way
    assert engine._cycle_start_s == began.timestamp()
    done = START + timedelta(minutes=2)
    engine.decide(done, 60.5, plan, None, True)
    assert engine.regrid_until == 0.0
    assert engine.need_kwh(35.0, done + timedelta(hours=1)) > 0.0


def test_a_night_heating_still_guards_until_the_next_ready_by():
    engine = make_engine(mode="cheapest", target_c=60, ready_by=time(18, 0), min_c=0, regrid_c=20)
    began = START + timedelta(hours=9)  # 03:00 local
    plan = build_plan(engine.plan_inputs(began, 50.0))
    engine.cycle_active = True
    engine.decide(began, 50.0, plan, None, True)
    done = began + timedelta(hours=1)
    engine.decide(done, 60.5, plan, None, True)
    assert engine.regrid_until == engine.deadline(done).timestamp() > done.timestamp()
    assert engine.need_kwh(35.0, done + timedelta(hours=2)) == 0.0
