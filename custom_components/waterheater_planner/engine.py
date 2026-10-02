"""The brain: settings + prices + forecast + live readings -> plan and on/off decision.

Pure Python (no Home Assistant). `controller.py` feeds it readings and applies its decisions;
the tests drive it against a simulated tank.

Closed loop: the plan is only a schedule. Heating always stops when the measured temperature
reaches the target, so a wrong volume, a wrong wattage or standing losses make the plan less
accurate, never the result.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from typing import Mapping
from zoneinfo import ZoneInfo

from .model import Fiscal, energy_needed_kwh
from .planner import (
    MODE_CHEAPEST,
    MODE_HYBRID,
    MODE_SOLAR,
    HybridConfig,
    Plan,
    PlanInputs,
    PriceSlot,
)
from .solar import SolarConfig, SolarController, surplus_w

UTC = timezone.utc

#: A switch-on this long after the planner last asked for one is not the planner's own.
MANUAL_GRACE_S = 120.0
#: A manual heating is left alone at most this long (the heater's own thermostat is the last safeguard).
MANUAL_MAX_S = 6 * 3600.0

#: Every state `Decision.status` can take (also the status sensor's options).
STATUSES = (
    "disabled",
    "no_temperature",
    "switch_unavailable",
    "at_target",
    "idle",
    "waiting_cheap",
    "waiting_sun",
    "heating_grid",
    "heating_solar",
    "heating_base",
    "heating_sun_slot",
    "comfort_floor",
    "floor_price_cap",
    "boost",
    "manual",
    "no_prices",
    "no_surplus_sensor",
)

#: How long a missing temperature reading may be bridged with the last good one.
TEMPERATURE_GRACE_S = 600.0
#: A heater is not switched off again sooner than this after it was switched on (and v.v.),
#: except for the safety stops and the comfort floor.
MIN_ON_S = 300.0
MIN_OFF_S = 300.0


@dataclass(slots=True)
class Settings:
    mode: str = MODE_CHEAPEST
    target_c: float = 60.0
    min_c: float = 40.0  # comfort floor; 0 turns it off
    floor_max_price: float = 0.0  # the comfort floor does not heat above this price (minor unit/kWh); 0 = no limit
    ready_by: time = time(16, 0)
    max_periods: int = 4
    energy_adjust_pct: float = 0.0  # manual correction of the energy estimate, e.g. +15 = 15 % more than calculated
    base_c: float = 0.0  # Solar mode: the grid heats (cheapest hours) up to this much, the sun does the rest; 0 = off
    regrid_c: float = 0.0  # no grid heating while the water is at or above this; 0 = off (heat to the target as usual)
    base_by: time = time(7, 0)  # ... and wants it reached by this time of day
    solar_start_w: float = 0.0  # surplus needed to start on solar; 0 = taken from the integration's configuration
    house_baseline_w: float = 0.0  # what the house draws anyway, taken off the solar forecast; 0 = from configuration
    sell_other_sun: bool = True  # with the price limit: no heating on surplus outside the chosen sun hours (it is sold)
    sun_surplus_only: bool = False  # with the price limit: chosen sun hours heat only while there is real surplus
    sun_priced: bool = True  # with the price limit: the sun costs the slot price (unsold electricity), not nothing
    solar_price_cap: float = 0.0  # Solar mode: sun hours at or below this price are open to the heater all through; 0 = off
    energy_auto: bool = True  # use the correction learned from real heatings once there is one
    enabled: bool = True
    boost: bool = False


@dataclass(frozen=True, slots=True)
class HeaterConfig:
    power_w: float
    volume_l: float
    tz: ZoneInfo
    fiscal: Fiscal = Fiscal()
    hybrid: HybridConfig = HybridConfig()
    solar: SolarConfig = SolarConfig(start_w=2000.0, stop_w=1200.0)
    #: A new heating cycle starts only when the water is at least this far below target.
    hysteresis_k: float = 2.0
    has_surplus_sensor: bool = False


@dataclass(frozen=True, slots=True)
class Decision:
    command: bool | None  # True = on, False = off, None = leave the switch alone
    status: str


@dataclass(slots=True)
class Engine:
    config: HeaterConfig
    settings: Settings = field(default_factory=Settings)
    price_slots: tuple[PriceSlot, ...] = ()
    forecast_wh: Mapping[datetime, float] | None = None

    cycle_active: bool = False
    floor_active: bool = False
    _floor_capped: bool = field(default=False, init=False, repr=False)
    regrid_active: bool = False  # a re-heating below `regrid_c` has begun and runs on to the target
    regrid_until: float = 0.0  # the limit holds until then (epoch s): set when a heating reaches the target, ends at "ready by"
    manual_active: bool = False  # someone switched the heater on outside the planner: leave it on until the target
    base_active: bool = False  # a base-temperature heating is under way (hysteresis)
    learned_pct: float | None = None  # set by the controller from `EnergyLearner`
    _solar: SolarController = field(init=False, repr=False)
    _last_temp: float | None = field(default=None, init=False, repr=False)
    _last_temp_ts: float = field(default=-math.inf, init=False, repr=False)
    _switch_prev: bool | None = field(default=None, init=False, repr=False)
    _last_on: float = field(default=-math.inf, init=False, repr=False)
    _last_off: float = field(default=-math.inf, init=False, repr=False)
    _cmd_on_s: float = field(default=-math.inf, init=False, repr=False)  # when the planner last asked for "on"
    _manual_since: float = field(default=-math.inf, init=False, repr=False)

    def __post_init__(self) -> None:
        self._solar = SolarController(self.config.solar)

    # ---- planning ------------------------------------------------------------------------

    def _next_time_of_day(self, now: datetime, at: time) -> datetime:
        tz = self.config.tz
        local = now.astimezone(tz)
        candidate = datetime.combine(local.date(), at, tzinfo=tz)
        if candidate <= local:
            candidate = datetime.combine(local.date() + timedelta(days=1), at, tzinfo=tz)
        return candidate.astimezone(UTC)

    def deadline(self, now: datetime) -> datetime:
        """The next time the water must be hot: today's `ready_by` if still ahead, else tomorrow's."""
        return self._next_time_of_day(now, self.settings.ready_by)

    def base_deadline(self, now: datetime) -> datetime:
        """The next time the base temperature must be reached (never later than the main deadline)."""
        return min(self._next_time_of_day(now, self.settings.base_by), self.deadline(now))

    def base_need_kwh(self, temp: float | None) -> float:
        """Solar mode: what the grid must supply to reach the base temperature (0 if off or already there)."""
        s = self.settings
        if s.mode not in (MODE_SOLAR, MODE_HYBRID) or s.base_c <= 0 or temp is None or s.base_c >= s.target_c:
            return 0.0
        deficit = s.base_c - temp
        if deficit <= 0 or (deficit < self.config.hysteresis_k and not self.base_active):
            return 0.0
        return energy_needed_kwh(self.config.volume_l, temp, s.base_c) * max(0.1, 1.0 + self.energy_correction_pct / 100.0)

    def regrid_armed(self, now: datetime | None = None) -> bool:
        """The re-heat limit holds: a heating has reached the target and the next "ready by" has not come yet."""
        return self.settings.regrid_c > 0 and self.regrid_until > (now.timestamp() if now is not None else 0.0)

    def need_kwh(self, temp: float | None, now: datetime | None = None) -> float:
        if temp is None:
            return 0.0
        deficit = self.settings.target_c - temp
        if deficit <= 0:
            return 0.0
        if self.regrid_armed(now) and temp >= self.settings.regrid_c and not self.regrid_active:
            return 0.0  # warm enough, and heated to the target since the last "ready by": no new grid heating
        if deficit < self.config.hysteresis_k and not self.cycle_active:
            return 0.0
        calculated = energy_needed_kwh(self.config.volume_l, temp, self.settings.target_c)
        return calculated * max(0.1, 1.0 + self.energy_correction_pct / 100.0)

    @property
    def energy_correction_pct(self) -> float:
        """The correction in use: the learned one when learning is on and has an answer, else the manual one."""
        if self.settings.energy_auto and self.learned_pct is not None:
            return self.learned_pct
        return self.settings.energy_adjust_pct

    def price_at(self, now: datetime) -> float | None:
        """The all-in price (minor unit/kWh) of the slot `now` falls in, or None if it is not known."""
        for slot in self.price_slots:
            if slot.start <= now < slot.start + timedelta(minutes=15):
                return slot.price
        return None

    def plan_key(self, now: datetime, temp: float | None) -> tuple:
        """Changes whenever the plan should be rebuilt; cheap to compute every tick."""
        s = self.settings
        need = self.need_kwh(temp, now)
        slot = int(now.timestamp() // 900)
        return (
            slot, s.mode, s.target_c, s.ready_by, s.max_periods, int(need / 0.5), need > 0,
            s.solar_price_cap, s.sun_priced, s.sun_surplus_only, s.regrid_c, self.regrid_armed(now), self.regrid_active, s.base_c, s.base_by, int(self.base_need_kwh(temp) / 0.5),
            hash(self.price_slots), hash(tuple(sorted(self.forecast_wh.items()))) if self.forecast_wh else None,
        )

    def plan_inputs(self, now: datetime, temp: float | None) -> PlanInputs:
        """An immutable snapshot, safe to hand to an executor thread."""
        s = self.settings
        return PlanInputs(
            mode=s.mode,
            now=now,
            deadline=self.deadline(now),
            need_kwh=self.need_kwh(temp, now),
            power_kw=self.config.power_w / 1000.0,
            max_periods=s.max_periods,
            price_slots=self.price_slots,
            forecast_wh=dict(self.forecast_wh) if self.forecast_wh is not None else None,
            hybrid=self.config.hybrid,
            base_kwh=self.base_need_kwh(temp),
            base_deadline=self.base_deadline(now),
            solar_price_cap=s.solar_price_cap if s.mode == MODE_SOLAR else 0.0,
            sun_priced=s.sun_priced,
            sun_surplus_only=s.sun_surplus_only,
        )

    # ---- live decision -------------------------------------------------------------------

    def available_w(
        self, grid_import_w: float | None, battery_charging_w: float | None, switch_on: bool
    ) -> float | None:
        return surplus_w(
            grid_import_w=grid_import_w,
            battery_charging_w=battery_charging_w,
            heater_w=self.config.power_w if switch_on else 0.0,
        )

    def _bridge_temperature(self, now_s: float, temp: float | None) -> float | None:
        if temp is not None:
            self._last_temp, self._last_temp_ts = temp, now_s
            return temp
        if self._last_temp is not None and now_s - self._last_temp_ts < TEMPERATURE_GRACE_S:
            return self._last_temp
        return None

    def decide(
        self,
        now: datetime,
        temp: float | None,
        plan: Plan | None,
        available_w: float | None,
        switch_on: bool,
    ) -> Decision:
        now_s = now.timestamp()
        if self._switch_prev is not None and switch_on != self._switch_prev:
            if switch_on:
                self._last_on = now_s
                if now_s - self._cmd_on_s > MANUAL_GRACE_S:  # not our doing: a person (or another automation)
                    self.manual_active = True
                    self._manual_since = now_s
            else:
                self._last_off = now_s
                self.manual_active = False
        self._switch_prev = switch_on
        if not switch_on:
            self.manual_active = False

        decision = self._apply_dwell(now_s, self._decide(now, now_s, temp, plan, available_w), switch_on)
        if decision.command and not switch_on:
            self._cmd_on_s = now_s
        return decision

    def _decide(
        self, now: datetime, now_s: float, temp_in: float | None, plan: Plan | None, available_w: float | None
    ) -> Decision:
        decision = self._decide_core(now, now_s, temp_in, plan, available_w)
        if self._floor_capped and decision.command is False and decision.status in ("idle", "waiting_cheap", "waiting_sun"):
            return Decision(False, "floor_price_cap")  # below the floor, but the price is over the cap
        return decision

    def _decide_core(
        self, now: datetime, now_s: float, temp_in: float | None, plan: Plan | None, available_w: float | None
    ) -> Decision:
        s = self.settings
        self._floor_capped = False
        if not s.enabled:
            return Decision(None, "disabled")
        temp = self._bridge_temperature(now_s, temp_in)
        if temp is None:
            return Decision(False, "no_temperature")

        if s.regrid_c > 0 and temp < s.regrid_c:
            self.regrid_active = True  # a started re-heating runs on to the target
        if temp >= s.target_c:
            if s.regrid_c > 0 and (self.cycle_active or self.manual_active):
                self.regrid_until = self.deadline(now).timestamp()  # a heating has just reached the target
            self.manual_active = False
            self.regrid_active = False
            self.cycle_active = False
            self.floor_active = False
            self._solar.reset(now_s)
            if s.boost:
                s.boost = False  # a boost ends when the target is reached
            return Decision(False, "at_target")

        if self.manual_active:
            if now_s - self._manual_since > MANUAL_MAX_S:
                self.manual_active = False
            else:
                self.cycle_active = True
                return Decision(True, "manual")  # switched on by hand: let it run to the target
        if s.min_c > 0:
            if temp < s.min_c:
                self.floor_active = True
            elif temp >= s.min_c + 1.0:
                self.floor_active = False
            if self.floor_active:
                price = self.price_at(now)
                if s.floor_max_price <= 0 or price is None or price <= s.floor_max_price:
                    self.cycle_active = True
                    return Decision(True, "comfort_floor")
                self._floor_capped = True  # too dear: wait, but let the normal plan (cheap slots, sun) work
        if s.boost:
            self.cycle_active = True
            return Decision(True, "boost")

        solar_wanted = False
        if s.mode in (MODE_SOLAR, MODE_HYBRID):
            solar_wanted = self._solar.observe(now_s, available_w)
        else:
            self._solar.reset(now_s)

        in_slot = plan is not None and plan.runs_at(now)
        need_open = plan is not None and plan.need_kwh > 0

        if s.mode == MODE_SOLAR and not self.config.has_surplus_sensor:
            return Decision(False, "no_surplus_sensor")
        if plan is not None and plan.status == "no_prices" and s.mode != MODE_SOLAR and need_open:
            self.cycle_active = True
            return Decision(True, "no_prices")  # price-blind thermostat beats cold water

        # Solar mode base temperature: the grid heats up to base_c in the cheapest hours, the sun does the rest
        base_open = False
        if s.mode in (MODE_SOLAR, MODE_HYBRID) and s.base_c > 0 and temp is not None and s.base_c < s.target_c:
            if temp >= s.base_c:
                self.base_active = False
            elif temp <= s.base_c - self.config.hysteresis_k:
                self.base_active = True
            base_open = self.base_active and temp < s.base_c
            if base_open and in_slot and not solar_wanted:
                self.cycle_active = True
                return Decision(True, "heating_base")
            if base_open and plan is not None and plan.status == "no_prices":
                self.cycle_active = True
                return Decision(True, "heating_base")  # price-blind: cold water beats waiting
        else:
            self.base_active = False

        if s.mode == MODE_SOLAR and plan is not None and plan.sun_runs_at(now) and (solar_wanted or not s.sun_surplus_only):
            self.cycle_active = True
            return Decision(True, "heating_sun_slot")  # a chosen sun hour: heat now, whatever the live surplus
        if s.mode in (MODE_CHEAPEST, MODE_HYBRID) and in_slot:
            self.cycle_active = True
            return Decision(True, "heating_grid")
        # With a price limit, Solar mode picks its sun hours by price (surplus in other hours is better sold)
        sell_other = s.sell_other_sun and s.mode == MODE_SOLAR and plan is not None and bool(plan.sun_slots)
        if s.mode in (MODE_SOLAR, MODE_HYBRID) and solar_wanted and not sell_other:
            self.cycle_active = True
            return Decision(True, "heating_solar")

        if not need_open and s.mode != MODE_SOLAR:
            return Decision(False, "idle")
        if s.mode == MODE_CHEAPEST:
            return Decision(False, "waiting_cheap")
        if s.mode == MODE_SOLAR:
            return Decision(False, "waiting_cheap" if base_open else "waiting_sun")
        # hybrid: grid slots later, or waiting for the sun
        return Decision(False, "waiting_cheap" if plan is not None and plan.run_slots else "waiting_sun")

    def _apply_dwell(self, now_s: float, decision: Decision, switch_on: bool) -> Decision:
        """Keep a heater that was just switched on (or off) from flipping straight back."""
        if decision.command is None:
            return decision
        urgent = decision.status in ("comfort_floor", "boost", "at_target", "no_temperature")
        if decision.command and not switch_on and not urgent and now_s - self._last_off < MIN_OFF_S:
            return Decision(False, decision.status)
        if not decision.command and switch_on and not urgent and now_s - self._last_on < MIN_ON_S:
            return Decision(True, decision.status)
        return decision
