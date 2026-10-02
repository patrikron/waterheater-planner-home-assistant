"""Switches: automatic control on/off, and "heat now"."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .controller import WaterHeaterController
from .entity import WaterHeaterEntity


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    c = entry.runtime_data
    async_add_entities([AutomaticSwitch(c), BoostSwitch(c), LearnSwitch(c), SunPricedSwitch(c), SunSurplusOnlySwitch(c), SellOtherSunSwitch(c)])


class AutomaticSwitch(WaterHeaterEntity, SwitchEntity):
    """Off = the planner leaves the heater switch completely alone."""

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "automatic")

    @property
    def is_on(self) -> bool:
        return self.controller.settings.enabled

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(enabled=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(enabled=False, boost=False)


class BoostSwitch(WaterHeaterEntity, SwitchEntity):
    """Heat to the target now, whatever the price. Switches itself off when the target is reached."""

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "boost")

    @property
    def is_on(self) -> bool:
        return self.controller.settings.boost

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(boost=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(boost=False)


class LearnSwitch(WaterHeaterEntity, SwitchEntity):
    """On: the energy correction is learned from the real heatings. Off: the manual correction is used."""

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "learn_energy")

    @property
    def is_on(self) -> bool:
        return self.controller.settings.energy_auto

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(energy_auto=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(energy_auto=False)


class SunPricedSwitch(WaterHeaterEntity, SwitchEntity):
    """Solar mode with a price limit: how the plan's cost is counted. On: the sun is priced at the hour's
    electricity price (it could have been sold). Off: the sun is free. Does not change what the heater does."""

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "sun_priced")

    @property
    def is_on(self) -> bool:
        return self.controller.settings.sun_priced

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(sun_priced=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(sun_priced=False)


class SunSurplusOnlySwitch(WaterHeaterEntity, SwitchEntity):
    """Solar mode with a price limit. On: the chosen sun hours heat only while there is real surplus (nothing is
    bought from the grid). Off: they heat whatever the surplus, and the grid fills in what the sun cannot give."""

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "sun_surplus_only")

    @property
    def is_on(self) -> bool:
        return self.controller.settings.sun_surplus_only

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(sun_surplus_only=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(sun_surplus_only=False)


class SellOtherSunSwitch(WaterHeaterEntity, SwitchEntity):
    """Solar mode with a price limit. On: surplus outside the chosen sun hours is sold, not used. Off: surplus
    is used in every hour, also those the planner did not choose."""

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "sell_other_sun")

    @property
    def is_on(self) -> bool:
        return self.controller.settings.sell_other_sun

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(sell_other_sun=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.controller.async_update_settings(sell_other_sun=False)
