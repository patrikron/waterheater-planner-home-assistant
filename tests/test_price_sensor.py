import copy
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from custom_components.waterheater_planner.price_sensor import PriceParseError, parse_prices, parse_unit
from .conftest import load_fixture

UTC = timezone.utc
STO = ZoneInfo("Europe/Stockholm")
NOW = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


def nordpool():
    """Attributes of a real Nord Pool sensor (SE3, SEK/kWh, quarter-hourly, tomorrow published)."""
    return {"unit_of_measurement": "SEK/kWh", **load_fixture("nordpool_se3_sensor.json")}


def test_real_nordpool_sensor_gives_192_quarters_from_local_midnight():
    unit, slots = parse_prices(nordpool(), STO, NOW)
    assert (unit.currency, unit.minor_unit, unit.to_major_per_kwh) == ("SEK", "öre", 1.0)
    assert len(slots) == 192
    assert slots[0] == (datetime(2026, 9, 30, 22, 0, tzinfo=UTC), 1.946)  # 00:00 +02:00
    assert slots[96][0] == datetime(2026, 10, 1, 22, 0, tzinfo=UTC)
    assert all(b[0] - a[0] == timedelta(minutes=15) for a, b in zip(slots, slots[1:]))


def test_plain_today_tomorrow_lists_match_the_timestamped_ones():
    attrs = nordpool()
    plain = {k: v for k, v in attrs.items() if k not in ("raw_today", "raw_tomorrow")}
    assert parse_prices(plain, STO, NOW)[1] == parse_prices(attrs, STO, NOW)[1]


def test_duplicate_entries_are_collapsed():
    attrs = nordpool()
    attrs["raw_today"] = attrs["raw_today"] * 9  # one sensor repeats its list
    assert len(parse_prices(attrs, STO, NOW)[1]) == 192


def test_hourly_prices_are_spread_over_quarters():
    attrs = {"unit_of_measurement": "EUR/kWh", "today": [float(i) for i in range(24)], "tomorrow": []}
    unit, slots = parse_prices(attrs, STO, NOW)
    assert unit.currency == "EUR" and len(slots) == 96
    assert [p for _, p in slots[:5]] == [0.0, 0.0, 0.0, 0.0, 1.0]


def test_dst_day_has_real_elapsed_hours():
    # 2026-10-25 is the day the clocks go back: 25 hours.
    now = datetime(2026, 10, 25, 6, 0, tzinfo=UTC)
    attrs = {"today": [float(i) for i in range(25)]}
    slots = parse_prices(attrs, STO, now)[1]
    assert len(slots) == 100 and slots[0][0] == datetime(2026, 10, 24, 22, 0, tzinfo=UTC)
    assert slots[-1][0] == datetime(2026, 10, 25, 22, 45, tzinfo=UTC)


def test_unpublished_tomorrow_is_ignored_not_fatal():
    attrs = nordpool()
    attrs["raw_tomorrow"] = []
    attrs["tomorrow"] = [None] * 96
    assert len(parse_prices(attrs, STO, NOW)[1]) == 96


def test_dict_lists_with_hour_price_keys_and_naive_local_time():
    attrs = {"raw_today": [{"hour": f"2026-10-01T{h:02d}:00:00", "price": 100.0 + h} for h in range(24)]}
    slots = parse_prices(attrs, STO, NOW)[1]
    assert len(slots) == 96 and slots[0] == (datetime(2026, 9, 30, 22, 0, tzinfo=UTC), 100.0)


def test_entsoe_style_prices_list():
    attrs = {"prices": [{"time": f"2026-10-01 {h:02d}:00:00+02:00", "price": 0.1 * h} for h in range(24)]}
    assert len(parse_prices(attrs, STO, NOW)[1]) == 96


@pytest.mark.parametrize(
    "unit, hint, expected",
    [
        ("SEK/kWh", None, ("SEK", "öre", 1.0)),
        ("öre/kWh", None, ("SEK", "öre", 0.01)),
        ("c/kWh", "EUR", ("EUR", "cent", 0.01)),
        ("EUR/MWh", None, ("EUR", "cent", 0.001)),
        ("€/kWh", None, ("EUR", "cent", 1.0)),
        (None, "NOK", ("NOK", "øre", 1.0)),
    ],
)
def test_units(unit, hint, expected):
    u = parse_unit(unit, hint)
    assert (u.currency, u.minor_unit) == expected[:2]
    assert u.to_major_per_kwh == pytest.approx(expected[2])


@pytest.mark.parametrize(
    "attrs",
    [
        {},
        {"today": []},
        {"today": [1.0] * 7},  # not a sensible resolution
        {"raw_today": [{"start": "2026-10-01T00:00:00+02:00", "end": "2026-10-01T00:07:00+02:00", "value": 1}]},
    ],
)
def test_sensors_without_usable_prices_are_refused(attrs):
    with pytest.raises(PriceParseError):
        parse_prices(attrs, STO, NOW)


def test_nan_and_non_numeric_values_are_skipped():
    attrs = copy.deepcopy(nordpool())
    attrs["raw_today"][5]["value"] = float("nan")
    attrs["raw_today"][6]["value"] = "n/a"
    assert len(parse_prices(attrs, STO, NOW)[1]) == 190
