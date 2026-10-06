"""The simple/advanced levels of the config flow (schemas only; Home Assistant itself is stubbed)."""

import importlib
import sys
from unittest.mock import MagicMock

import pytest

pytest.importorskip("voluptuous")


@pytest.fixture(scope="module")
def flow():
    names = [
        "homeassistant", "homeassistant.config_entries", "homeassistant.const", "homeassistant.core",
        "homeassistant.helpers", "homeassistant.helpers.selector", "homeassistant.util",
        "homeassistant.util.dt", "custom_components.waterheater_planner.forecast",
    ]
    saved = {n: sys.modules.get(n) for n in names + ["custom_components.waterheater_planner.config_flow"]}
    for n in names:
        sys.modules[n] = MagicMock()
    sys.modules["homeassistant.core"].callback = lambda f: f
    sys.modules["homeassistant.config_entries"].ConfigFlow = type("ConfigFlow", (), {"__init_subclass__": classmethod(lambda cls, **kw: None)})
    sys.modules["homeassistant.config_entries"].OptionsFlow = type("OptionsFlow", (), {})
    sys.modules.pop("custom_components.waterheater_planner.config_flow", None)
    try:
        yield importlib.import_module("custom_components.waterheater_planner.config_flow")
    finally:
        for n, mod in saved.items():
            if mod is None:
                sys.modules.pop(n, None)
            else:
                sys.modules[n] = mod


def keys(schema):
    return {str(k) for k in schema.schema}


def test_simple_hides_the_advanced_fields(flow):
    simple = keys(flow.basic_schema({}, True, advanced=False))
    full = keys(flow.basic_schema({}, True, advanced=True))
    assert {"switch_entity", "temperature_entity", "power_w", "volume_l", "price_entity"} <= simple
    assert {"heater_power_entity", "energy_day_entity", "energy_week_entity", "energy_month_entity"} <= full - simple
    sol_simple = keys(flow.solar_schema({}, [], advanced=False))
    sol_full = keys(flow.solar_schema({}, [], advanced=True))
    assert "grid_power_entity" in sol_simple
    assert {"battery_power_entity", "house_baseline_w", "solar_start_w"} <= sol_full - sol_simple


def test_default_level_follows_the_entry(flow):
    def default(current):
        schema = flow.level_schema(current)
        (marker,) = schema.schema
        return marker.default()

    assert default({}) == "advanced"  # entries from before the levels existed stay advanced
    assert default({"advanced": True}) == "advanced"
    assert default({"advanced": False}) == "simple"


def test_clearing_only_touches_fields_that_were_shown(flow):
    target = {"energy_day_entity": "sensor.kept"}
    flow._clear_unset(target, [flow.basic_schema({}, False, advanced=False), flow.solar_schema({}, [], advanced=False)])
    assert target["energy_day_entity"] == "sensor.kept"  # hidden in simple: left as it was
    assert target["grid_power_entity"] is None  # shown and left empty: cleared
    assert target["solar_forecast_entries"] is None
