"""Solar forecast for hybrid mode, read from the integrations the Energy dashboard uses.

Any integration that feeds the Energy dashboard's solar forecast (Forecast.Solar, Solcast,
Open-Meteo, ...) implements `async_get_solar_forecast(hass, config_entry_id)` in its `energy.py`
and returns `{"wh_hours": {iso timestamp: Wh}} | None`. Nothing is fetched here: that call
returns the integration's cached estimate.

`wh_hours` is not always hourly (Solcast: 30 min, Forecast.Solar: 15-60 min, Open-Meteo: hourly and
about 92 days of past hours), so each source is normalised to Wh per UTC hour before summing.
Adapted from the SpotNav integration's `planning/hybrid_forecast.py` (MIT, (c) 2026 Sensnology AB).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.integration_platform import async_process_integration_platforms
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)
_UTC = timezone.utc
_HOUR = timedelta(hours=1)

GetSolarForecast = Callable[[HomeAssistant, str], Awaitable[dict[str, Any] | None]]


def hourly_wh(slots: dict[datetime, float], *, now: datetime) -> dict[datetime, float]:
    """One source's `{slot start (UTC): Wh}` as Wh per UTC hour.

    The slot length is the smallest gap between keys. A length that divides an hour is summed into
    the hour each slot starts in; anything else is kept as it is. Slots that ended before the start
    of yesterday (UTC) are dropped.
    """
    if not slots:
        return {}
    starts = sorted(slots)
    gaps = [later - earlier for earlier, later in zip(starts, starts[1:]) if later > earlier]
    step = min(gaps) if gaps else _HOUR
    cutoff = (now.astimezone(_UTC) - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    sub_hourly = step < _HOUR and _HOUR % step == timedelta(0)
    result: dict[datetime, float] = {}
    for start in starts:
        if start + (step if sub_hourly else _HOUR) <= cutoff:
            continue
        key = start.replace(minute=0, second=0, microsecond=0) if sub_hourly else start
        result[key] = result.get(key, 0.0) + slots[start]
    return result


async def _async_platforms(hass: HomeAssistant) -> dict[str, GetSolarForecast]:
    data = hass.data.setdefault(DOMAIN, {})
    if (platforms := data.get("forecast_platforms")) is not None:
        return platforms
    platforms = {}
    data["forecast_platforms"] = platforms  # stored first: later callbacks mutate this same dict

    def _collect(_hass: HomeAssistant, domain: str, platform: Any) -> None:
        if (getter := getattr(platform, "async_get_solar_forecast", None)) is not None:
            platforms[domain] = getter

    await async_process_integration_platforms(hass, "energy", _collect, wait_for_platforms=True)
    return platforms


async def async_forecast_capable_domains(hass: HomeAssistant) -> frozenset[str]:
    """Loaded integration domains that provide a solar forecast (for the config flow's picker)."""
    return frozenset((await _async_platforms(hass)).keys())


async def async_read_forecast_wh(
    hass: HomeAssistant, entry_ids: Sequence[str]
) -> dict[datetime, float] | None:
    """The summed hourly PV forecast (UTC hour -> Wh) from every readable entry, or `None`."""
    if not entry_ids:
        return None
    now = dt_util.utcnow()
    platforms = await _async_platforms(hass)
    combined: dict[datetime, float] = {}
    for entry_id in entry_ids:
        entry = hass.config_entries.async_get_entry(entry_id)
        getter = platforms.get(entry.domain) if entry else None
        if getter is None:
            _LOGGER.debug("solar forecast source %s: not available", entry_id)
            continue
        try:
            forecast = await getter(hass, entry_id)
        except Exception:  # noqa: BLE001 - one source failing must not sink the others
            _LOGGER.debug("solar forecast source %s raised", entry_id, exc_info=True)
            continue
        wh_hours = forecast.get("wh_hours") if isinstance(forecast, dict) else None
        if not isinstance(wh_hours, dict):
            continue
        slots: dict[datetime, float] = {}
        for iso, wh in wh_hours.items():
            try:
                hour = datetime.fromisoformat(iso)
                if hour.tzinfo is None:
                    raise ValueError("naive")
                slots[hour.astimezone(_UTC)] = slots.get(hour.astimezone(_UTC), 0.0) + float(wh)
            except (TypeError, ValueError):
                continue
        for hour_key, value in hourly_wh(slots, now=now).items():
            combined[hour_key] = combined.get(hour_key, 0.0) + value
    return combined or None
