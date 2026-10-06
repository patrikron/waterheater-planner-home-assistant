"""Config flow and options flow.

Three short steps: the heater itself (including which existing price sensor to use), the optional solar
inputs, and optional price add-ons (tax, grid fee, VAT) for a sensor that shows the bare spot price.
The options flow walks the same steps, so everything can be changed later.
"""

from __future__ import annotations

from typing import Any
from zoneinfo import ZoneInfo

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_NAME
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.util import dt as dt_util

from .const import (
    CONF_ADVANCED,
    CONF_BATTERY_INVERTED,
    CONF_ENERGY_DAY,
    CONF_ENERGY_MONTH,
    CONF_ENERGY_WEEK,
    CONF_BATTERY_POWER,
    CONF_FORECAST_ENTRIES,
    CONF_GRID_INVERTED,
    CONF_HEATER_POWER,
    CONF_GRID_POWER,
    CONF_HOUSE_BASELINE_W,
    CONF_POWER_W,
    CONF_PRICE_ENTITY,
    CONF_SOLAR_START_W,
    CONF_SWITCH,
    CONF_TAX,
    CONF_TEMPERATURE,
    CONF_TRANSFER,
    CONF_VAT,
    CONF_VOLUME_L,
    DEFAULT_HOUSE_BASELINE_W,
    DOMAIN,
)
from .forecast import async_forecast_capable_domains
from .price_sensor import PriceParseError, parse_prices, parse_unit

#: Optional keys: a cleared field must be stored as `None`, or the value from `entry.data` would leak back.
OPTIONAL_KEYS = (
    CONF_HEATER_POWER, CONF_ENERGY_DAY, CONF_ENERGY_WEEK, CONF_ENERGY_MONTH, CONF_GRID_POWER, CONF_BATTERY_POWER, CONF_FORECAST_ENTRIES, CONF_SOLAR_START_W,
    CONF_VAT, CONF_TAX, CONF_TRANSFER,
)


def _optional(key: str, current: dict[str, Any]) -> vol.Optional:
    value = current.get(key)
    return vol.Optional(key, description={"suggested_value": value}) if value is not None else vol.Optional(key)


def _number(min_: float, max_: float, step: float, unit: str | None = None) -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=min_, max=max_, step=step, unit_of_measurement=unit, mode=selector.NumberSelectorMode.BOX
        )
    )


def _entity(domains: list[str]) -> selector.EntitySelector:
    return selector.EntitySelector(selector.EntitySelectorConfig(domain=domains))


def level_schema(current: dict[str, Any]) -> vol.Schema:
    """The first question: simple (the essentials) or advanced (every setting)."""
    default = "advanced" if current.get(CONF_ADVANCED, True) else "simple"
    return vol.Schema(
        {
            vol.Required("level", default=default): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=["simple", "advanced"],
                    translation_key="level",
                    mode=selector.SelectSelectorMode.LIST,
                )
            )
        }
    )


def basic_schema(current: dict[str, Any], first_setup: bool, advanced: bool = True) -> vol.Schema:
    fields: dict[Any, Any] = {}
    if first_setup:
        fields[vol.Required(CONF_NAME, default=current.get(CONF_NAME, "Varmvattenberedare"))] = str
    fields[vol.Required(CONF_PRICE_ENTITY, default=current.get(CONF_PRICE_ENTITY, vol.UNDEFINED))] = _entity(["sensor"])
    fields[vol.Required(CONF_SWITCH, default=current.get(CONF_SWITCH, vol.UNDEFINED))] = _entity(["switch", "input_boolean"])
    fields[vol.Required(CONF_TEMPERATURE, default=current.get(CONF_TEMPERATURE, vol.UNDEFINED))] = _entity(["sensor", "input_number"])
    fields[vol.Required(CONF_POWER_W, default=current.get(CONF_POWER_W, 3000))] = _number(100, 30000, 50, "W")
    fields[vol.Required(CONF_VOLUME_L, default=current.get(CONF_VOLUME_L, 200))] = _number(10, 2000, 5, "L")
    if advanced:
        fields[_optional(CONF_HEATER_POWER, current)] = _entity(["sensor", "input_number"])
        for key in (CONF_ENERGY_DAY, CONF_ENERGY_WEEK, CONF_ENERGY_MONTH):
            fields[_optional(key, current)] = _entity(["sensor", "input_number"])
    return vol.Schema(fields)


def solar_schema(
    current: dict[str, Any], forecast_options: list[selector.SelectOptionDict], advanced: bool = True
) -> vol.Schema:
    fields: dict[Any, Any] = {
        _optional(CONF_GRID_POWER, current): _entity(["sensor", "input_number"]),
        vol.Required(CONF_GRID_INVERTED, default=current.get(CONF_GRID_INVERTED, False)): bool,
    }
    if advanced:
        fields[_optional(CONF_BATTERY_POWER, current)] = _entity(["sensor", "input_number"])
        fields[vol.Required(CONF_BATTERY_INVERTED, default=current.get(CONF_BATTERY_INVERTED, False))] = bool
    if forecast_options:
        fields[_optional(CONF_FORECAST_ENTRIES, current)] = selector.SelectSelector(
            selector.SelectSelectorConfig(options=forecast_options, multiple=True, mode=selector.SelectSelectorMode.DROPDOWN)
        )
    if advanced:
        fields[vol.Required(CONF_HOUSE_BASELINE_W, default=current.get(CONF_HOUSE_BASELINE_W, DEFAULT_HOUSE_BASELINE_W))] = _number(0, 10000, 50, "W")
        fields[_optional(CONF_SOLAR_START_W, current)] = _number(100, 30000, 50, "W")
    return vol.Schema(fields)


def fiscal_schema(current: dict[str, Any], minor_unit: str) -> vol.Schema:
    def suggested(key: str) -> dict[str, Any]:
        return {"suggested_value": current.get(key)}

    return vol.Schema(
        {
            vol.Optional(CONF_TAX, description=suggested(CONF_TAX)): _number(0, 1000, 0.1, f"{minor_unit}/kWh"),
            vol.Optional(CONF_TRANSFER, description=suggested(CONF_TRANSFER)): _number(0, 1000, 0.1, f"{minor_unit}/kWh"),
            vol.Optional(CONF_VAT, description=suggested(CONF_VAT)): _number(0, 100, 0.5, "%"),
        }
    )


def check_price_sensor(hass: Any, entity_id: str) -> str | None:
    """None when the sensor can be used, otherwise the translation key of the error."""
    state = hass.states.get(entity_id)
    if state is None:
        return "price_sensor_missing"
    try:
        parse_prices(state.attributes, ZoneInfo(hass.config.time_zone), dt_util.utcnow())
    except PriceParseError:
        return "price_sensor_unsupported"
    return None


def minor_unit_of(hass: Any, entity_id: str | None) -> str:
    state = hass.states.get(entity_id) if entity_id else None
    attrs = state.attributes if state else {}
    return parse_unit(attrs.get("unit_of_measurement"), attrs.get("currency"), hass.config.currency or "SEK").minor_unit


async def _forecast_options(hass: Any) -> list[selector.SelectOptionDict]:
    domains = await async_forecast_capable_domains(hass)
    return [
        selector.SelectOptionDict(value=e.entry_id, label=f"{e.title} ({e.domain})")
        for e in hass.config_entries.async_entries()
        if e.domain in domains
    ]


def _clear_unset(target: dict[str, Any], schemas: list[vol.Schema]) -> None:
    """A cleared optional field is stored as None; fields the chosen level never showed are left alone."""
    shown = {str(k) for schema in schemas for k in schema.schema} | {CONF_FORECAST_ENTRIES}
    for key in OPTIONAL_KEYS:
        if key in shown:
            target.setdefault(key, None)


class WaterHeaterConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return WaterHeaterOptionsFlow()

    @property
    def _advanced(self) -> bool:
        return bool(self._data.get(CONF_ADVANCED, True))

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Simple or advanced?"""
        if user_input is not None:
            self._data[CONF_ADVANCED] = user_input["level"] == "advanced"
            return await self.async_step_heater()
        return self.async_show_form(step_id="user", data_schema=level_schema(self._data))

    async def async_step_heater(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            error = check_price_sensor(self.hass, user_input[CONF_PRICE_ENTITY])
            if error is None:
                self._data.update(user_input)
                return await self.async_step_solar()
            errors[CONF_PRICE_ENTITY] = error
        return self.async_show_form(
            step_id="heater", data_schema=basic_schema(user_input or {}, True, self._advanced), errors=errors
        )

    async def async_step_solar(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            self._data.update(user_input)
            return await self.async_step_fiscal() if self._advanced else self._finish()
        return self.async_show_form(
            step_id="solar", data_schema=solar_schema(self._data, await _forecast_options(self.hass), self._advanced)
        )

    async def async_step_fiscal(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            self._data.update(user_input)
            return self._finish()
        unit = minor_unit_of(self.hass, self._data[CONF_PRICE_ENTITY])
        return self.async_show_form(step_id="fiscal", data_schema=fiscal_schema(self._data, unit))

    def _finish(self) -> ConfigFlowResult:
        for key in OPTIONAL_KEYS:
            self._data.setdefault(key, None)
        return self.async_create_entry(title=self._data[CONF_NAME], data=self._data)


class WaterHeaterOptionsFlow(OptionsFlow):
    """Same steps as setup, minus the name. Choosing simple hides fields; values already set are kept."""

    def __init__(self) -> None:
        self._options: dict[str, Any] = {}

    def _current(self) -> dict[str, Any]:
        return {**self.config_entry.data, **self.config_entry.options, **self._options}

    @property
    def _advanced(self) -> bool:
        return bool(self._current().get(CONF_ADVANCED, True))

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            self._options[CONF_ADVANCED] = user_input["level"] == "advanced"
            return await self.async_step_heater()
        return self.async_show_form(step_id="init", data_schema=level_schema(self._current()))

    async def async_step_heater(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            error = check_price_sensor(self.hass, user_input[CONF_PRICE_ENTITY])
            if error is None:
                self._options.update(user_input)
                return await self.async_step_solar()
            errors[CONF_PRICE_ENTITY] = error
        current = {**self._current(), **(user_input or {})}
        return self.async_show_form(
            step_id="heater", data_schema=basic_schema(current, False, self._advanced), errors=errors
        )

    async def async_step_solar(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            self._options.update(user_input)
            return await self.async_step_fiscal() if self._advanced else self._finish()
        return self.async_show_form(
            step_id="solar", data_schema=solar_schema(self._current(), await _forecast_options(self.hass), self._advanced)
        )

    async def async_step_fiscal(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            self._options.update(user_input)
            return self._finish()
        current = self._current()
        unit = minor_unit_of(self.hass, current.get(CONF_PRICE_ENTITY))
        return self.async_show_form(step_id="fiscal", data_schema=fiscal_schema(current, unit))

    def _finish(self) -> ConfigFlowResult:
        current = self._current()
        shown = [basic_schema(current, False, self._advanced), solar_schema(current, [], self._advanced)]
        if self._advanced:
            shown.append(fiscal_schema(current, ""))
        _clear_unset(self._options, shown)
        return self.async_create_entry(data=self._options)
