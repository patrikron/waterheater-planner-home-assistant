import pytest
from custom_components.waterheater_planner.session import GAP_S, HeatingLog


def run(log, seconds, on, price=100.0, solar=False, start=0.0, w=None):
    t = start
    while t < start + seconds:
        log.observe(t, on, w, price, solar)
        t += 30
    return t


def test_energy_and_cost_of_one_heating():
    log = HeatingLog(3000)
    t = run(log, 3600, True, price=100.0)          # 1 h at 3 kW = 3 kWh
    run(log, GAP_S + 60, False, start=t)
    rec = log.shown()
    assert rec is log.last and not log.running
    assert abs(rec.kwh - 3.0) < 0.1
    assert abs(rec.cost_minor - 300.0) < 10        # 3 kWh x 100 öre


def test_short_pause_does_not_split_a_heating():
    log = HeatingLog(3000)
    t = run(log, 1800, True)
    t = run(log, 300, False, start=t)
    run(log, 1800, True, start=t)
    assert log.running and abs(log.shown().kwh - 3.0) < 0.1


def test_measured_power_and_solar_is_free():
    log = HeatingLog(3000)
    t = run(log, 3600, True, price=50.0, solar=True, w=2000)
    run(log, GAP_S + 60, False, start=t)
    assert abs(log.last.kwh - 2.0) < 0.1 and log.last.cost_minor == 0 and abs(log.last.solar_kwh - 2.0) < 0.1


def test_unknown_price_is_flagged_and_roundtrip():
    log = HeatingLog(3000)
    t = run(log, 600, True, price=None)
    run(log, GAP_S + 60, False, start=t)
    assert not log.last.priced
    other = HeatingLog(3000)
    other.load(log.last.as_dict())
    assert other.last.kwh == log.last.kwh


def test_stalled_tick_does_not_invent_energy():
    log = HeatingLog(3000)
    log.observe(0, True, None, 100.0, False)
    log.observe(10_000, True, None, 100.0, False)
    assert log.current.kwh < 0.15


def test_runs_merge_short_gaps_split_on_solar_and_expire():
    log = HeatingLog(3000)
    t = run(log, 600, True)
    t = run(log, 60, False, start=t)           # short pause: same run
    t = run(log, 600, True, start=t)
    t = run(log, 600, True, solar=True, start=t)  # a new run, now solar
    assert len(log.runs) == 2 and log.runs[0][2] == 0.0 and log.runs[1][2] == 1.0
    log.observe(t + 25 * 3600, True, None, 1.0, False)
    assert len(log.runs) == 1                  # the old ones are forgotten
    other = HeatingLog(3000)
    other.load_runs(log.runs)
    assert other.runs == log.runs


def test_runs_remember_why_and_split_when_the_reason_changes():
    log = HeatingLog(3000)
    t = 0.0
    for status in ("heating_grid", "heating_grid", "heating_sun_slot", "heating_sun_slot"):
        log.observe(t, True, None, 100.0, False, status)
        t += 30
    assert [r[3] for r in log.runs] == ["heating_grid", "heating_sun_slot"]
    assert [r[2] for r in log.runs] == [0.0, 1.0]  # a chosen sun hour is drawn as sun
    other = HeatingLog(3000)
    other.load_runs([[1, 2, 0.0]])  # runs saved by an older version have no reason
    assert other.runs[0][3] is None


def test_backfill_adds_missing_runs_and_skips_logged_ones():
    log = HeatingLog(3000)
    now = 100_000.0
    log.runs = [[now - 3000, now - 2000, 0.0, "heating_cheap"]]
    added = log.backfill_runs([(now - 20_000, now - 19_000), (now - 2900, now - 2100), (now - 400_000, now - 399_000)], now)
    assert added == 1
    assert [r[0] for r in log.runs] == [now - 20_000, now - 3000]
    assert log.runs[0][3] is None


def test_daily_ledger_sums_energy_cost_and_sun_by_day():
    log = HeatingLog(3000)
    t = 1_000_000.0
    for i in range(0, 31):  # 30 steps of 60 s, grid at 100 öre
        log.observe(t + i * 60, True, 3000, 100.0, False, "heating_grid", "2026-10-01")
    for i in range(31, 61):  # 30 more steps on the sun, the next day
        log.observe(t + i * 60, True, 3000, 100.0, True, "heating_solar", "2026-10-02")
    assert log.totals("2026-10-01")["kwh"] == pytest.approx(3.0, abs=0.06)
    assert log.totals("2026-10-02")["kwh"] == pytest.approx(1.5, abs=0.06)
    assert log.totals("2026-10-02")["solar_kwh"] == pytest.approx(1.5, abs=0.06)
    assert log.totals("2026-10-02")["cost_minor"] == 0.0  # the sun is free
    assert log.totals("2026-10-01")["cost_minor"] == pytest.approx(150.0, abs=3.0)
    log.load_days({k: list(v) for k, v in log.days.items()})
    assert set(log.days) == {"2026-10-01", "2026-10-02"}


def test_daily_ledger_forgets_old_days():
    log = HeatingLog(3000)
    for d in range(80):
        log.days[f"2026-07-{d:03d}"] = [1.0, 1.0, 0.0, 0.0]
    log.observe(10.0, True, 3000, 100.0, False, None, "2026-10-01")
    log.observe(70.0, True, 3000, 100.0, False, None, "2026-10-01")
    assert len(log.days) <= 70


def test_heatings_for_the_same_ready_by_add_up():
    log = HeatingLog(3000)
    t = 0.0
    for _ in range(2):  # night and day, both for the same "ready by"
        while t % 7200 < 1800:
            log.observe(t, True, None, 100.0, False, cycle=86400.0)
            t += 30
        while t % 7200 >= 1800:
            log.observe(t, False, None, 100.0, False, cycle=86400.0)
            t += 30
    assert not log.running and abs(log.last.kwh - 3.0) < 0.1 and log.last.start_s == 0.0
    assert log.finished == 2
    for k in range(21):  # after "ready by": a new record
        log.observe(t + 30 * k, True, None, 100.0, False, cycle=2 * 86400.0)
    assert log.shown() is not log.last and abs(log.shown().kwh - 0.5) < 0.05
    other = HeatingLog(3000)
    other.load(log.last.as_dict())
    assert other.last.cycle == 86400.0
