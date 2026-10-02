"""Mode selector: cheapest / solar / hybrid."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import MODES
from .controller import WaterHeaterController
from .entity import WaterHeaterEntity


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([ModeSelect(entry.runtime_data)])


class ModeSelect(WaterHeaterEntity, SelectEntity):
    _attr_options = list(MODES)

    def __init__(self, c: WaterHeaterController) -> None:
        super().__init__(c, "mode")

    @property
    def current_option(self) -> str:
        return self.controller.settings.mode

    async def async_select_option(self, option: str) -> None:
        await self.controller.async_update_settings(mode=option)
