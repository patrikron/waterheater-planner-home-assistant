"""Home Assistant side of the planner: readings in, prices and forecast kept fresh, switch out.

All decisions are made by `engine.Engine` (pure, tested against a simulated tank). This class only
does the I/O around it, once every `TICK_SECONDS`:

    refresh prices/forecast -> read temperature, grid power, switch -> (re)plan -> decide -> switch
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_OFF, STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    CONF_BATTERY_INVERTED,
    CONF_BATTERY_POWER,
    CONF_ENERGY_DAY,
    CONF_ENERGY_MONTH,
    CONF_ENERGY_WEEK,
    CONF_FORECAST_ENTRIES,
    CONF_GRID_INVERTED,
    CONF_GRID_POWER,
    CONF_HEATER_POWER,
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
    DEFAULT_MAX_PERIODS,
    DEFAULT_MIN_C,
    DEFAULT_READY_BY,
    DEFAULT_TARGET_C,
    DOMAIN,
    MODE_CHEAPEST,
    MODE_HYBRID,
    MODES,
    SIGNAL_UPDATE,
    TICK_SECONDS,
)
from .engine import Engine, HeaterConfig, Settings
from .forecast import async_read_forecast_wh
from .learning import EnergyLearner
from .session import HeatingLog
from .model import Fiscal
from .planner import UTC, HybridConfig, Plan, PriceSlot, build_plan
from .price_sensor import PriceParseError, parse_prices, parse_unit
from dataclasses import replace

from .solar import SolarConfig

_LOGGER = logging.getLogger(__name__)

FORECAST_REFRESH = timedelta(minutes=30)
STORE_VERSION = 1


def _fiscal(config: dict[str, Any]) -> Fiscal:
    """Optional add-ons for a sensor that shows the bare spot price; nothing when it is already all-in."""

    def pick(key: str) -> float:
        value = config.get(key)
        return float(value) if value is not None else 0.0

    return Fiscal(vat_percent=pick(CONF_VAT), tax_minor=pick(CONF_TAX), transfer_minor=pick(CONF_TRANSFER))


class WaterHeaterController:
    """One water heater: its engine, its price/forecast data and its entities' shared state."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        config: dict[str, Any],
    ) -> None:
        self.hass = hass
        self.entry = entry
        self.config = config
        self.price_entity: str = config[CONF_PRICE_ENTITY]
        self._tz = ZoneInfo(hass.config.time_zone)
        #: Currency and minor unit as the price sensor reports them; refreshed when the sensor is read.
        self.unit = parse_unit(None, hass.config.currency)

        power_w = float(config[CONF_POWER_W])
        start_w = float(config.get(CONF_SOLAR_START_W) or power_w * 0.8)
        stop_w = min(start_w, power_w * 0.5)
        self._solar_cfg = [round(start_w), round(float(config.get(CONF_HOUSE_BASELINE_W, DEFAULT_HOUSE_BASELINE_W)))]
        self.has_surplus_sensor = bool(config.get(CONF_GRID_POWER))
        self.engine = Engine(
            HeaterConfig(
                power_w=power_w,
                volume_l=float(config[CONF_VOLUME_L]),
                tz=self._tz,
                fiscal=_fiscal(config),
                hybrid=HybridConfig(
                    house_baseline_w=float(config.get(CONF_HOUSE_BASELINE_W, DEFAULT_HOUSE_BASELINE_W)),
                    solar_start_w=start_w,
                ),
                solar=SolarConfig(start_w=start_w, stop_w=stop_w),
                has_surplus_sensor=self.has_surplus_sensor,
            ),
            Settings(
                mode=MODE_HYBRID if config.get(CONF_FORECAST_ENTRIES) else MODE_CHEAPEST,
                target_c=DEFAULT_TARGET_C,
                min_c=DEFAULT_MIN_C,
                solar_start_w=start_w,
                house_baseline_w=float(config.get(CONF_HOUSE_BASELINE_W, DEFAULT_HOUSE_BASELINE_W)),
                ready_by=time.fromisoformat(DEFAULT_READY_BY),
                max_periods=DEFAULT_MAX_PERIODS,
            ),
        )
        self.session = HeatingLog(power_w=power_w)
        self._prev_switch: bool | None = None
        self._saved_regrid = 0.0
        self.learner = EnergyLearner(volume_l=float(config[CONF_VOLUME_L]), power_w=power_w)
        self._store: Store[dict[str, Any]] = Store(hass, STORE_VERSION, f"{DOMAIN}.{entry.entry_id}")
        self._lock = asyncio.Lock()
        self._unsub_timer: Any = None

        self._last_forecast_try = datetime.min.replace(tzinfo=UTC)
        self.price_error: str | None = None

        self._plan_key: tuple | None = None
        self.plan: Plan | None = None
        self.status = "idle"
        self.temperature: float | None = None
        self.surplus_w: float | None = None
        self.switch_on: bool | None = None

    # ---- lifecycle -----------------------------------------------------------------------

    async def async_setup(self) -> None:
        self._refresh_prices(dt_util.utcnow())  # learns the currency before the entities are created
        stored = await self._store.async_load()
        if stored:
            s = self.engine.settings
            try:
                if stored.get("mode") in MODES:
                    s.mode = stored["mode"]
                s.target_c = float(stored.get("target_c", s.target_c))
                s.min_c = float(stored.get("min_c", s.min_c))
                s.ready_by = time.fromisoformat(stored.get("ready_by", DEFAULT_READY_BY))
                s.max_periods = int(stored.get("max_periods", s.max_periods))
                s.sun_priced = bool(stored.get("sun_priced", s.sun_priced))
                s.sun_surplus_only = bool(stored.get("sun_surplus_only", s.sun_surplus_only))
                # Before this setting existed, "sun priced" also decided this: keep what the user had
                s.sell_other_sun = bool(stored.get("sell_other_sun", stored.get("sun_priced", s.sell_other_sun)))
                # Values set here win over the integration's configuration, until that is changed
                if stored.get("solar_cfg") == self._solar_cfg:
                    s.solar_start_w = float(stored.get("solar_start_w", s.solar_start_w))
                    s.house_baseline_w = float(stored.get("house_baseline_w", s.house_baseline_w))
                    self._apply_solar_tuning()
                s.solar_price_cap = float(stored.get("solar_price_cap", s.solar_price_cap))
                s.base_c = float(stored.get("base_c", s.base_c))
                s.regrid_c = float(stored.get("regrid_c", s.regrid_c))
                self.engine.regrid_until = float(stored.get("regrid_until", 0.0))
                s.base_by = time.fromisoformat(stored.get("base_by", "07:00"))
                s.floor_max_price = float(stored.get("floor_max_price", s.floor_max_price))
                s.energy_auto = bool(stored.get("energy_auto", s.energy_auto))
                s.energy_adjust_pct = float(stored.get("energy_adjust_pct", s.energy_adjust_pct))
                s.enabled = bool(stored.get("enabled", True))
                self.learner.load(stored.get("learner"))
                self.session.load(stored.get("last_heating"))
                self.session.load_runs(stored.get("runs"))
                self.session.load_days(stored.get("days"))
            except (TypeError, ValueError):
                _LOGGER.warning("Ignoring unreadable stored settings")

    async def _async_backfill_runs(self) -> None:
        """Fill the heated history from the recorder (covers time before this integration logged)."""
        entity = self.config.get(CONF_SWITCH)
        if not entity:
            return
        try:
            from homeassistant.components.recorder import get_instance, history

            now = dt_util.utcnow()
            start = now - timedelta(hours=24)
            states = await get_instance(self.hass).async_add_executor_job(
                lambda: history.get_significant_states(
                    self.hass, start, now, [entity], include_start_time_state=True,
                    significant_changes_only=False, no_attributes=True,
                )
            )
        except Exception as err:  # recorder missing or busy: the history simply stays as logged
            _LOGGER.debug("No recorder history for the heater switch: %s", err)
            return
        intervals: list[tuple[float, float]] = []
        on_since: float | None = None
        for st in states.get(entity, []):
            ts = st.last_changed.timestamp() if st.last_changed > start else start.timestamp()
            if st.state == "on":
                if on_since is None:
                    on_since = ts
            elif on_since is not None:
                intervals.append((on_since, ts))
                on_since = None
        if on_since is not None:
            intervals.append((on_since, now.timestamp()))
        if self.session.backfill_runs(intervals, now.timestamp()):
            self._store.async_delay_save(self._settings_dict, 1)

    async def async_start(self) -> None:
        await self._async_backfill_runs()
        self._unsub_timer = async_track_time_interval(
            self.hass, self._async_on_timer, timedelta(seconds=TICK_SECONDS)
        )
        await self.async_tick()

    @callback
    def async_stop(self) -> None:
        if self._unsub_timer is not None:
            self._unsub_timer()
            self._unsub_timer = None

    # ---- settings (called by the entities) ------------------------------------------------

    @property
    def settings(self) -> Settings:
        return self.engine.settings

    async def async_update_settings(self, **changes: Any) -> None:
        s = self.engine.settings
        for key, value in changes.items():
            setattr(s, key, value)
        if "mode" in changes:
            self.engine.cycle_active = False
        if "solar_start_w" in changes or "house_baseline_w" in changes:
            self._apply_solar_tuning()
        self._store.async_delay_save(self._settings_dict, 1)
        self._plan_key = None
        await self.async_tick()

    def _apply_solar_tuning(self) -> None:
        """Start threshold and house baseline are settings; push them into the live configuration."""
        s, eng = self.engine.settings, self.engine
        start_w = max(50.0, s.solar_start_w)
        stop_w = min(start_w, eng.config.power_w * 0.5)
        eng.config = replace(
            eng.config,
            hybrid=replace(eng.config.hybrid, solar_start_w=start_w, house_baseline_w=max(0.0, s.house_baseline_w)),
            solar=replace(eng.config.solar, start_w=start_w, stop_w=stop_w),
        )
        eng._solar.config = eng.config.solar  # in place: a running solar heating is not interrupted

    def _settings_dict(self) -> dict[str, Any]:
        s = self.engine.settings
        return {
            "mode": s.mode,
            "target_c": s.target_c,
            "min_c": s.min_c,
            "ready_by": s.ready_by.isoformat(timespec="minutes"),
            "max_periods": s.max_periods,
            "sun_priced": s.sun_priced,
            "sun_surplus_only": s.sun_surplus_only,
            "sell_other_sun": s.sell_other_sun,
            "solar_cfg": self._solar_cfg,
            "solar_start_w": s.solar_start_w,
            "house_baseline_w": s.house_baseline_w,
            "solar_price_cap": s.solar_price_cap,
            "base_c": s.base_c,
            "days": self.session.days,
            "regrid_c": s.regrid_c,
            "regrid_until": self.engine.regrid_until,
            "base_by": s.base_by.isoformat(timespec="minutes"),
            "floor_max_price": s.floor_max_price,
            "energy_adjust_pct": s.energy_adjust_pct,
            "energy_auto": s.energy_auto,
            "learner": self.learner.as_dict(),
            "runs": [[round(r[0]), round(r[1]), r[2], r[3]] for r in self.session.runs],
            "last_heating": (self.session.last.as_dict() if self.session.last else None),
            "enabled": s.enabled,
        }

    # ---- the tick -------------------------------------------------------------------------

    async def _async_on_timer(self, _now: datetime) -> None:
        await self.async_tick()

    async def async_tick(self) -> None:
        async with self._lock:
            try:
                await self._async_step()
            except Exception:  # noqa: BLE001 - a bad tick must not kill the timer
                _LOGGER.exception("Water heater planner tick failed")
            async_dispatcher_send(self.hass, SIGNAL_UPDATE.format(self.entry.entry_id))

    async def _async_step(self) -> None:
        now = dt_util.utcnow()
        self._refresh_prices(now)
        await self._async_refresh_forecast(now)

        temp = self._read_temperature()
        switch_on = self._read_switch()
        self.temperature, self.switch_on = temp, switch_on
        self._track_heating(now, switch_on)
        self._learn(now, temp, switch_on)  # before planning: the plan uses what was learned

        key = self.engine.plan_key(now, temp)
        if key != self._plan_key:
            inputs = self.engine.plan_inputs(now, temp)
            self.plan = await self.hass.async_add_executor_job(build_plan, inputs)
            self._plan_key = key

        if switch_on is None:
            self.status = "switch_unavailable"
            return

        grid_w = self._read_power(self.config.get(CONF_GRID_POWER), self.config.get(CONF_GRID_INVERTED))
        battery_w = self._read_power(
            self.config.get(CONF_BATTERY_POWER), self.config.get(CONF_BATTERY_INVERTED)
        )
        if not self.has_surplus_sensor:
            grid_w = None
        self.surplus_w = self.engine.available_w(grid_w, battery_w, switch_on)

        decision = self.engine.decide(now, temp, self.plan, self.surplus_w, switch_on)
        self.status = decision.status
        if self.engine.regrid_until != self._saved_regrid:
            self._saved_regrid = self.engine.regrid_until
            self._store.async_delay_save(self._settings_dict, 1)
        if decision.command is not None and decision.command != switch_on:
            await self.hass.services.async_call(
                "homeassistant",
                "turn_on" if decision.command else "turn_off",
                {"entity_id": self.config[CONF_SWITCH]},
                blocking=True,
            )
            _LOGGER.debug("Heater %s (%s)", "on" if decision.command else "off", decision.status)

    def _track_heating(self, now: datetime, switch_on: bool | None) -> None:
        """Add this tick to the running heating; save when one has just finished."""
        before = self.session.last
        heater_w = self._read_power(self.config.get(CONF_HEATER_POWER), False)
        self.session.observe(
            now.timestamp(), switch_on, heater_w, self.engine.price_at(now), self.status == "heating_solar",
            self.status, dt_util.as_local(now).date().isoformat(),
        )
        changed = switch_on != self._prev_switch
        self._prev_switch = switch_on
        if self.session.last is not before or changed:
            self._store.async_delay_save(self._settings_dict, 1)

    def _learn(self, now: datetime, temp: float | None, switch_on: bool | None) -> None:
        """Let the learner watch this tick; save its samples when a new one arrived."""
        before = self.learner.count
        heater_w = self._read_power(self.config.get(CONF_HEATER_POWER), False)
        self.learner.observe(now.timestamp(), temp, switch_on, self.engine.settings.target_c, heater_w)
        self.engine.learned_pct = self.learner.correction_pct
        if self.learner.count != before:
            self._store.async_delay_save(self._settings_dict, 1)

    # ---- reading entities -------------------------------------------------------------------

    def _state(self, entity_id: str | None) -> Any:
        if not entity_id:
            return None
        state = self.hass.states.get(entity_id)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return None
        return state

    def _read_temperature(self) -> float | None:
        state = self._state(self.config[CONF_TEMPERATURE])
        if state is None:
            return None
        try:
            value = float(state.state)
        except ValueError:
            return None
        unit = state.attributes.get("unit_of_measurement")
        if unit == "°F":
            value = (value - 32.0) * 5.0 / 9.0
        elif unit == "K":
            value -= 273.15
        return value

    def _read_power(self, entity_id: str | None, inverted: bool | None) -> float | None:
        state = self._state(entity_id)
        if state is None:
            return None
        try:
            value = float(state.state)
        except ValueError:
            return None
        unit = state.attributes.get("unit_of_measurement")
        value *= {"kW": 1000.0, "MW": 1e6}.get(unit, 1.0)
        return -value if inverted else value

    def _read_energy(self, entity_id: str | None) -> float | None:
        """A kWh reading (Wh and MWh are converted); None if it is not set or not a number."""
        state = self._state(entity_id)
        if state is None:
            return None
        try:
            value = float(state.state)
        except ValueError:
            return None
        return value * {"Wh": 0.001, "MWh": 1000.0}.get(state.attributes.get("unit_of_measurement"), 1.0)

    def usage_for_card(self, now: datetime | None = None) -> dict[str, Any]:
        """Energy and grid cost today, this week (from Monday) and this month.

        Energy comes from the configured sensors when there are any, else from what this integration
        has measured; cost is always the integration's own (energy x the price of the slot, sun is free).
        """
        today = dt_util.as_local(now or dt_util.utcnow()).date()
        starts = {
            "day": (today, CONF_ENERGY_DAY),
            "week": (today - timedelta(days=today.weekday()), CONF_ENERGY_WEEK),
            "month": (today.replace(day=1), CONF_ENERGY_MONTH),
        }
        out: dict[str, Any] = {}
        for key, (since, conf) in starts.items():
            own = self.session.totals(since.isoformat())
            sensor_kwh = self._read_energy(self.config.get(conf))
            out[key] = {
                "kwh": round(own["kwh"] if sensor_kwh is None else sensor_kwh, 2),
                "kwh_source": "own" if sensor_kwh is None else "sensor",
                "cost": round(own["cost_minor"] / 100.0, 2),
                "solar_kwh": round(own["solar_kwh"], 2),
                "since": since.isoformat(),
                "complete": not self.session.days or min(self.session.days) <= since.isoformat(),
            }
        return out

    def _read_switch(self) -> bool | None:
        state = self._state(self.config[CONF_SWITCH])
        if state is None:
            return None
        if state.state == STATE_ON:
            return True
        if state.state == STATE_OFF:
            return False
        return None

    # ---- prices ---------------------------------------------------------------------------

    def _refresh_prices(self, now: datetime) -> None:
        """Re-read the price sensor. A sensor that is briefly unavailable keeps the last known prices."""
        state = self._state(self.price_entity)
        if state is None:
            self.price_error = "sensor_unavailable"
            return
        try:
            unit, rows = parse_prices(state.attributes, self._tz, now, self.hass.config.currency or "SEK")
        except PriceParseError as err:
            self.price_error = str(err)
            _LOGGER.warning("Price sensor %s: %s", self.price_entity, err)
            return
        self.unit = unit
        fiscal = self.engine.config.fiscal
        # The sensor's number -> currency per kWh -> minor unit, then the optional add-ons.
        slots = tuple(
            PriceSlot(start, fiscal.effective_minor(value * unit.to_major_per_kwh)) for start, value in rows
        )
        # Keep today from 00:00 (the card's chart starts there); drop older, so the plan key stays small and stable.
        local = now.astimezone(self._tz)
        cutoff = datetime.combine(local.date(), time.min, tzinfo=self._tz).astimezone(UTC)
        self.engine.price_slots = tuple(s for s in slots if s.start >= cutoff)
        self.price_error = None if self.engine.price_slots else "no_current_prices"

    # ---- solar forecast ---------------------------------------------------------------------

    async def _async_refresh_forecast(self, now: datetime) -> None:
        entries = self.config.get(CONF_FORECAST_ENTRIES) or []
        if not entries or now - self._last_forecast_try < FORECAST_REFRESH:
            return
        self._last_forecast_try = now
        self.engine.forecast_wh = await async_read_forecast_wh(self.hass, entries)

    # ---- what the entities show -----------------------------------------------------------

    @property
    def current_price_minor(self) -> float | None:
        now = dt_util.utcnow()
        for slot in self.engine.price_slots:
            if slot.start <= now < slot.start + timedelta(minutes=15):
                return slot.price
        return None

    def runs_for_card(self) -> list[list[float]]:
        """`[[start ms, end ms, solar 0/1], ...]` for the part of the chart that lies in the past."""
        since = self._chart_start().timestamp()
        return [[int(r[0] * 1000), int(r[1] * 1000), int(r[2]), r[3]] for r in self.session.runs if r[1] >= since]

    def _chart_start(self) -> datetime:
        """The chart starts at 00:00 local time today."""
        local = dt_util.utcnow().astimezone(self._tz)
        return datetime.combine(local.date(), datetime.min.time(), tzinfo=self._tz).astimezone(UTC)

    def prices_for_card(self) -> list[list[float]]:
        """`[[epoch ms, minor/kWh], ...]` from the current slot to the deadline (max 48 h)."""
        now = dt_util.utcnow()
        deadline = self.plan.deadline if self.plan else self.engine.deadline(now)
        horizon = min(deadline, now + timedelta(hours=48))
        floor = self._chart_start() - timedelta(minutes=1)
        return [
            [int(s.start.timestamp() * 1000), round(s.price, 2)]
            for s in self.engine.price_slots
            if floor < s.start < horizon
        ]
