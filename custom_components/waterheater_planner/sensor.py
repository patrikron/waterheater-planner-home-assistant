"""Sensors: status (with the full plan for the card), cost, energy, runtime, next start, price."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfEnergy, UnitOfPower, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_SWITCH, CONF_TEMPERATURE, DOMAIN
from .controller import WaterHeaterController
from .engine import STATUSES
from .entity import WaterHeaterEntity


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    c: WaterHeaterController = entry.runtime_data
    entities: list[SensorEntity] = [
        StatusSensor(c),
        PlannedCostSensor(c),
        EnergyNeededSensor(c),
        RuntimeSensor(c),
        NextStartSensor(c),
        CurrentPriceSensor(c),
        EnergyCorrectionSensor(c),
        LastHeatingEnergySensor(c),
        LastHeatingCostSensor(c),
        PeriodCostSensor(c, "day"),
        PeriodCostSensor(c, "week"),
        PeriodCostSensor(c, "month"),
    ]
    if c.has_surplus_sensor:
        entities.append(SurplusSensor(c))
    async_add_entities(entities)


def _ms(moment: datetime) -> int:
    return int(moment.timestamp() * 1000)


class StatusSensor(WaterHeaterEntity, SensorEntity):
    """State = what the heater is doing. Attributes = everything the card draws."""

    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = list(STATUSES)
    # Large or derived data that has no business filling the recorder database.
    _unrecorded_attributes = frozenset({"prices", "periods", "solar_hours", "entities"})

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "status")

    @property
    def native_value(self) -> str:
        return self.controller.status

    def _last_heating_attrs(self) -> dict[str, Any]:
        rec = self.controller.session.shown()
        if rec is None:
            return {"last_heating_kwh": None}
        return {
            "last_heating_kwh": round(rec.kwh, 2),
            "last_heating_cost": round(rec.cost_minor / 100.0, 2),
            "last_heating_solar_kwh": round(rec.solar_kwh, 2),
            "last_heating_start": int(rec.start_s * 1000),
            "last_heating_end": int(rec.end_s * 1000),
            "last_heating_running": self.controller.session.running,
        }

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        c = self.controller
        s, plan, unit = c.settings, c.plan, c.unit
        registry = er.async_get(self.hass)
        entities = {}
        for platform, key in (
            ("select", "mode"),
            ("number", "target_temperature"),
            ("number", "min_temperature"),
            ("number", "max_periods"),
            ("number", "energy_adjust"),
            ("number", "floor_max_price"),
            ("number", "wait_saving"),
            ("number", "early_start_pct"),
            ("number", "early_keep_pct"),
            ("number", "base_temperature"),
            ("number", "regrid_below"),
            ("number", "solar_price_cap"),
            ("number", "solar_start"),
            ("number", "house_baseline"),
            ("time", "ready_by"),
            ("time", "base_by"),
            ("switch", "automatic"),
            ("switch", "boost"),
            ("switch", "learn_energy"),
            ("switch", "sun_priced"),
            ("switch", "sun_surplus_only"),
            ("switch", "sell_other_sun"),
        ):
            entity_id = registry.async_get_entity_id(platform, DOMAIN, f"{c.entry.entry_id}_{key}")
            if entity_id:
                entities[key] = entity_id
        attrs: dict[str, Any] = {
            "temperature": None if c.temperature is None else round(c.temperature, 1),
            "target_temperature": s.target_c,
            "min_temperature": s.min_c,
            "mode": s.mode,
            "ready_by": s.ready_by.strftime("%H:%M"),
            "solar_price_cap": s.solar_price_cap,
            "solar_start": s.solar_start_w,
            "house_baseline": s.house_baseline_w,
            "sun_priced_setting": s.sun_priced,
            "sun_surplus_only": s.sun_surplus_only,
            "sell_other_sun": s.sell_other_sun,
            "regrid_c": s.regrid_c,
            "regrid_below": s.regrid_c,
            "regrid_armed": c.engine.regrid_armed(datetime.now(UTC)),
            "base_c": s.base_c,
            "base_temperature": s.base_c,
            "base_by": s.base_by.strftime("%H:%M"),
            "max_periods": s.max_periods,
            "energy_adjust": s.energy_adjust_pct,
            "floor_max_price": s.floor_max_price,
            "wait_saving": s.wait_saving,
            "early_start_pct": s.early_start_pct,
            "early_keep_pct": s.early_keep_pct,
            "energy_auto": s.energy_auto,
            **self._last_heating_attrs(),
            "energy_learned": None if c.learner.correction_pct is None else round(c.learner.correction_pct, 1),
            "energy_in_use": round(c.engine.energy_correction_pct, 1),
            "energy_samples": c.learner.count,
            "automatic": s.enabled,
            "boost": s.boost,
            "heater_on": c.switch_on,
            "switch_entity": c.config.get(CONF_SWITCH),
            "power_w": c.engine.config.power_w,
            "currency": unit.currency,
            "major_unit": unit.major_unit,
            "minor_unit": unit.minor_unit,
            "price_area": c.price_entity,
            "price_now": None if c.current_price_minor is None else round(c.current_price_minor, 1),
            "price_error": c.price_error,
            "surplus_w": None if c.surplus_w is None else round(c.surplus_w),
            "prices": c.prices_for_card(),
            "heated": c.runs_for_card(),
            "temperature_entity": c.config.get(CONF_TEMPERATURE),
            "usage": c.usage_for_card(),
            "entities": entities,
        }
        if plan is not None:
            attrs.update(
                {
                    "plan_status": plan.status,
                    "hybrid_state": plan.hybrid_state,
                    "waiting_for_prices": plan.waiting_for_prices,
                    "deadline": _ms(plan.deadline),
                    "need_kwh": round(plan.need_kwh, 2),
                    "grid_kwh": round(plan.grid_kwh, 2),
                    "solar_kwh": round(plan.solar_kwh, 2),
                    "runtime_min": round(plan.runtime_min),
                    "sun_priced": bool(plan.sun_slots) and s.sun_priced,
                    "cost": round(plan.cost_minor / 100.0, 2),
                    "cost_now": round(plan.cost_now_minor / 100.0, 2),
                    "saving": round(plan.saving_minor / 100.0, 2),
                    "periods": [
                        {"s": _ms(p.start), "e": _ms(p.end), "kwh": round(p.kwh, 2)} for p in plan.periods
                    ],
                    "solar_hours": [
                        {"s": _ms(h.start), "e": _ms(h.end), "kwh": round(h.kwh, 2)} for h in plan.solar_hours
                    ],
                }
            )
        return attrs


class PlannedCostSensor(WaterHeaterEntity, SensorEntity):
    """What the planned grid energy costs, all-in, in the price sensor's currency."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_suggested_display_precision = 2

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "planned_cost")
        self._attr_native_unit_of_measurement = c.unit.currency

    @property
    def native_value(self) -> float | None:
        plan = self.controller.plan
        return None if plan is None else round(plan.cost_minor / 100.0, 2)


class _LastHeating(WaterHeaterEntity, SensorEntity):
    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        rec = self.controller.session.shown()
        if rec is None:
            return {}
        return {
            "started": datetime.fromtimestamp(rec.start_s, UTC).isoformat(),
            "ended": None if self.controller.session.running else datetime.fromtimestamp(rec.end_s, UTC).isoformat(),
            "running": self.controller.session.running,
            "solar_kwh": round(rec.solar_kwh, 2),
            "all_priced": rec.priced,
        }


class LastHeatingEnergySensor(_LastHeating):
    """Energy used by the latest heating (the one running now, or the last finished)."""

    _attr_device_class = SensorDeviceClass.ENERGY
    _attr_native_unit_of_measurement = UnitOfEnergy.KILO_WATT_HOUR
    _attr_suggested_display_precision = 2

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "last_heating_energy")

    @property
    def native_value(self) -> float | None:
        rec = self.controller.session.shown()
        return None if rec is None else round(rec.kwh, 3)


class LastHeatingCostSensor(_LastHeating):
    """Grid cost of the latest heating, all-in, in the price sensor's currency (solar energy is free)."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_suggested_display_precision = 2

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "last_heating_cost")
        self._attr_native_unit_of_measurement = c.unit.currency

    @property
    def native_value(self) -> float | None:
        rec = self.controller.session.shown()
        return None if rec is None else round(rec.cost_minor / 100.0, 2)


class PeriodCostSensor(WaterHeaterEntity, SensorEntity):
    """Grid cost so far today / this week / this month, as the integration has measured it."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_suggested_display_precision = 2

    def __init__(self, c: WaterHeaterController, period: str) -> None:
        super().__init__(c, f"cost_{period}")
        self._period = period
        self._attr_native_unit_of_measurement = c.unit.currency

    @property
    def native_value(self) -> float:
        return self.controller.usage_for_card()[self._period]["cost"]


class EnergyNeededSensor(WaterHeaterEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.ENERGY
    _attr_native_unit_of_measurement = UnitOfEnergy.KILO_WATT_HOUR
    _attr_suggested_display_precision = 1

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "energy_needed")

    @property
    def native_value(self) -> float | None:
        plan = self.controller.plan
        return None if plan is None else round(plan.need_kwh, 2)


class RuntimeSensor(WaterHeaterEntity, SensorEntity):
    """Planned heating time from the grid (sun time is not counted: it depends on the clouds).

    A standard duration sensor in seconds, so Home Assistant formats it as a time. The same value is
    also given as text (`formatted`, "2 h 47 min") and in minutes for templates.
    """

    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.SECONDS

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "runtime")

    @property
    def _minutes(self) -> int | None:
        plan = self.controller.plan
        return None if plan is None else round(plan.runtime_min)

    @property
    def native_value(self) -> int | None:
        minutes = self._minutes
        return None if minutes is None else minutes * 60

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        minutes = self._minutes
        if minutes is None:
            return {}
        hours, rest = divmod(minutes, 60)
        text = f"{hours} h {rest} min" if hours and rest else (f"{hours} h" if hours else f"{rest} min")
        return {"minutes": minutes, "formatted": text}


class NextStartSensor(WaterHeaterEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "next_start")

    @property
    def native_value(self) -> datetime | None:
        plan = self.controller.plan
        return None if plan is None else plan.next_start


class CurrentPriceSensor(WaterHeaterEntity, SensorEntity):
    """The all-in price right now (spot + tax + grid fee + VAT) per kWh in the minor unit."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "current_price")
        self._attr_native_unit_of_measurement = f"{c.unit.minor_unit}/kWh"

    @property
    def native_value(self) -> float | None:
        price = self.controller.current_price_minor
        return None if price is None else round(price, 1)


class EnergyCorrectionSensor(WaterHeaterEntity, SensorEntity):
    """The energy correction in use, in percent. Attributes tell where it comes from."""

    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_suggested_display_precision = 0
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "energy_correction")

    @property
    def native_value(self) -> float:
        return round(self.controller.engine.energy_correction_pct, 1)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        c = self.controller
        learned = c.learner.correction_pct
        return {
            "source": "learned" if (c.settings.energy_auto and learned is not None) else "manual",
            "learned_pct": None if learned is None else round(learned, 1),
            "manual_pct": c.settings.energy_adjust_pct,
            "heatings_learned_from": c.learner.count,
        }


class SurplusSensor(WaterHeaterEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.POWER
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "solar_surplus")

    @property
    def native_value(self) -> float | None:
        w = self.controller.surplus_w
        return None if w is None else round(w)
