"""Water Heater Planner: heat the hot water tank when electricity is cheap, or when the sun shines."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.loader import async_get_integration

from .const import CARD_URL_PATH, DOMAIN
from .controller import WaterHeaterController

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

PLATFORMS = ["number", "select", "sensor", "switch", "time"]
CARD_FILE = Path(__file__).parent / "www" / "waterheater-planner-card.js"

type WaterHeaterConfigEntry = ConfigEntry[WaterHeaterController]


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Serve the Lovelace card from the integration itself, so no dashboard resource is needed."""
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("card_served") or hass.http is None:
        return True
    if not await hass.async_add_executor_job(CARD_FILE.is_file):
        _LOGGER.warning("The card file is missing: %s", CARD_FILE)
        return True
    await hass.http.async_register_static_paths([StaticPathConfig(CARD_URL_PATH, str(CARD_FILE), cache_headers=False)])
    digest = await hass.async_add_executor_job(lambda: hashlib.sha256(CARD_FILE.read_bytes()).hexdigest()[:8])
    version = (await async_get_integration(hass, DOMAIN)).version
    add_extra_js_url(hass, f"{CARD_URL_PATH}?v={version}-{digest}")
    data["card_served"] = True
    return True


async def async_setup_entry(hass: HomeAssistant, entry: WaterHeaterConfigEntry) -> bool:
    config = {**entry.data, **entry.options}
    controller = WaterHeaterController(hass, entry, config)
    await controller.async_setup()
    entry.runtime_data = controller
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    await controller.async_start()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: WaterHeaterConfigEntry) -> bool:
    entry.runtime_data.async_stop()
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
