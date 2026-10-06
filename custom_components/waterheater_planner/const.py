"""Constants for Water Heater Planner."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "waterheater_planner"

# Config entry data (set up in the config flow; changing them reloads the entry).
CONF_SWITCH: Final = "switch_entity"
CONF_TEMPERATURE: Final = "temperature_entity"
CONF_POWER_W: Final = "power_w"
CONF_VOLUME_L: Final = "volume_l"
CONF_PRICE_ENTITY: Final = "price_entity"  # an existing price sensor (Nord Pool, ENTSO-e, ...)
CONF_HEATER_POWER: Final = "heater_power_entity"  # optional: the heater's real power, for learning
CONF_GRID_POWER: Final = "grid_power_entity"
CONF_GRID_INVERTED: Final = "grid_power_inverted"
CONF_BATTERY_POWER: Final = "battery_power_entity"
CONF_BATTERY_INVERTED: Final = "battery_power_inverted"
CONF_FORECAST_ENTRIES: Final = "solar_forecast_entries"
CONF_VAT: Final = "vat_percent"
CONF_TAX: Final = "tax_minor"
CONF_TRANSFER: Final = "transfer_minor"
CONF_ENERGY_DAY: Final = "energy_day_entity"  # optional: the heater's energy today / this week / this month (kWh)
CONF_ENERGY_WEEK: Final = "energy_week_entity"
CONF_ENERGY_MONTH: Final = "energy_month_entity"
CONF_HOUSE_BASELINE_W: Final = "house_baseline_w"
CONF_SOLAR_START_W: Final = "solar_start_w"
CONF_ADVANCED: Final = "advanced"  # False = simple setup/card; a missing value (older entries) counts as advanced

DEFAULT_HOUSE_BASELINE_W: Final = 500.0

MODE_CHEAPEST: Final = "cheapest"
MODE_SOLAR: Final = "solar"
MODE_HYBRID: Final = "hybrid"
MODES: Final = (MODE_CHEAPEST, MODE_SOLAR, MODE_HYBRID)

# Runtime settings (stored in `.storage`, changed from entities and the card).
DEFAULT_TARGET_C: Final = 60.0
DEFAULT_MIN_C: Final = 40.0
DEFAULT_READY_BY: Final = "16:00"
DEFAULT_MAX_PERIODS: Final = 4

SIGNAL_UPDATE: Final = "waterheater_planner_update_{}"
TICK_SECONDS: Final = 30

CARD_URL_PATH: Final = f"/{DOMAIN}/waterheater-planner-card.js"
