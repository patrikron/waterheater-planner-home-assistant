"""The time the water should be hot."""

from __future__ import annotations

from datetime import time

from homeassistant.components.time import TimeEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .controller import WaterHeaterController
from .entity import WaterHeaterEntity


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([ReadyBy(entry.runtime_data), BaseBy(entry.runtime_data)])


class ReadyBy(WaterHeaterEntity, TimeEntity):
    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "ready_by")

    @property
    def native_value(self) -> time:
        return self.controller.settings.ready_by

    async def async_set_value(self, value: time) -> None:
        await self.controller.async_update_settings(ready_by=value.replace(second=0, microsecond=0))


class BaseBy(WaterHeaterEntity, TimeEntity):
    """Solar mode: the base temperature should be reached by this time (default 07:00)."""

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "base_by")

    @property
    def native_value(self) -> time:
        return self.controller.settings.base_by

    async def async_set_value(self, value: time) -> None:
        await self.controller.async_update_settings(base_by=value.replace(second=0, microsecond=0))
