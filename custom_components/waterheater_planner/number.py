"""Numbers: target temperature, comfort floor, maximum number of heating periods."""

from __future__ import annotations

from homeassistant.components.number import NumberDeviceClass, NumberEntity, NumberMode
from homeassistant.const import PERCENTAGE, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .controller import WaterHeaterController
from .entity import WaterHeaterEntity


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    c = entry.runtime_data
    async_add_entities([TargetTemperature(c), MinTemperature(c), MaxPeriods(c), EnergyAdjust(c), FloorMaxPrice(c), BaseTemperature(c), RegridBelow(c), SolarPriceCap(c), SolarStart(c), HouseBaseline(c)])


class TargetTemperature(WaterHeaterEntity, NumberEntity):
    _attr_device_class = NumberDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _attr_native_min_value = 30
    _attr_native_max_value = 85
    _attr_native_step = 1
    _attr_mode = NumberMode.BOX

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "target_temperature")

    @property
    def native_value(self) -> float:
        return self.controller.settings.target_c

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(target_c=float(value))


class MinTemperature(WaterHeaterEntity, NumberEntity):
    """Below this the heater runs at once, whatever the price. 0 turns the floor off."""

    _attr_device_class = NumberDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _attr_native_min_value = 0
    _attr_native_max_value = 70
    _attr_native_step = 1
    _attr_mode = NumberMode.BOX

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "min_temperature")

    @property
    def native_value(self) -> float:
        return self.controller.settings.min_c

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(min_c=float(value))


class MaxPeriods(WaterHeaterEntity, NumberEntity):
    """At most this many separate runs; fewer means fewer switch cycles, a little less saving."""

    _attr_native_min_value = 1
    _attr_native_max_value = 8
    _attr_native_step = 1
    _attr_mode = NumberMode.BOX

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "max_periods")

    @property
    def native_value(self) -> float:
        return self.controller.settings.max_periods

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(max_periods=int(value))


class EnergyAdjust(WaterHeaterEntity, NumberEntity):
    """Corrects the calculated energy: +15 % if the real heating takes longer than the plan said, -10 % if shorter."""

    _attr_native_min_value = -50
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_mode = NumberMode.BOX

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "energy_adjust")

    @property
    def native_value(self) -> float:
        return self.controller.settings.energy_adjust_pct

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(energy_adjust_pct=float(value))


class FloorMaxPrice(WaterHeaterEntity, NumberEntity):
    """The comfort floor does not heat while the price is above this (minor unit per kWh, e.g. öre). 0 = no limit."""

    _attr_native_min_value = 0
    _attr_native_max_value = 1000
    _attr_native_step = 5
    _attr_mode = NumberMode.BOX

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "floor_max_price")
        self._attr_native_unit_of_measurement = f"{c.unit.minor_unit}/kWh"

    @property
    def native_value(self) -> float:
        return self.controller.settings.floor_max_price

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(floor_max_price=float(value))


class BaseTemperature(WaterHeaterEntity, NumberEntity):
    """Solar mode: the grid heats (in the cheapest hours) up to this temperature, the sun does the rest. 0 = off."""

    _attr_native_min_value = 0
    _attr_native_max_value = 60
    _attr_native_step = 1
    _attr_mode = NumberMode.BOX
    _attr_native_unit_of_measurement = "°C"

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "base_temperature")

    @property
    def native_value(self) -> float:
        return self.controller.settings.base_c

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(base_c=float(value))


class RegridBelow(WaterHeaterEntity, NumberEntity):
    """No grid heating while the water is at or above this temperature; once it has fallen below, it is
    heated to the target again (cheapest hours). The sun may still heat. 0 = off."""

    _attr_native_min_value = 0
    _attr_native_max_value = 85
    _attr_native_step = 1
    _attr_mode = NumberMode.BOX
    _attr_native_unit_of_measurement = "°C"

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "regrid_below")

    @property
    def native_value(self) -> float:
        return self.controller.settings.regrid_c

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(regrid_c=float(value))


class SolarPriceCap(WaterHeaterEntity, NumberEntity):
    """Solar mode: sun hours at or below this price (minor unit per kWh) are open to the heater the whole time;
    in dearer ones it heats only as far as needed, in the cheapest sun hours. 0 = off."""

    _attr_native_min_value = 0
    _attr_native_max_value = 1000
    _attr_native_step = 5
    _attr_mode = NumberMode.BOX

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "solar_price_cap")
        self._attr_native_unit_of_measurement = f"{c.unit.minor_unit}/kWh"

    @property
    def native_value(self) -> float:
        return self.controller.settings.solar_price_cap

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(solar_price_cap=float(value))


class SolarStart(WaterHeaterEntity, NumberEntity):
    """Surplus needed to start heating on solar (W). Stopping happens below half the heater's power."""

    _attr_native_min_value = 50
    _attr_native_max_value = 10000
    _attr_native_step = 50
    _attr_mode = NumberMode.BOX
    _attr_native_unit_of_measurement = "W"

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "solar_start")

    @property
    def native_value(self) -> float:
        return self.controller.settings.solar_start_w

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(solar_start_w=float(value))


class HouseBaseline(WaterHeaterEntity, NumberEntity):
    """What the house draws anyway; taken off the solar forecast when sun hours are picked (W)."""

    _attr_native_min_value = 0
    _attr_native_max_value = 10000
    _attr_native_step = 50
    _attr_mode = NumberMode.BOX
    _attr_native_unit_of_measurement = "W"

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "house_baseline")

    @property
    def native_value(self) -> float:
        return self.controller.settings.house_baseline_w

    async def async_set_native_value(self, value: float) -> None:
        await self.controller.async_update_settings(house_baseline_w=float(value))
