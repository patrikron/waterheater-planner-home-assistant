"""Solar surplus: when is there enough sun to run the heater?

Pure Python. Two parts:

* `surplus_w` computes the surplus from the grid meter (and optionally a house battery) with
  the same energy balance SpotNav uses for the car:

      available = heater_w + battery_charging_w - net_grid_import_w

  Looking at export alone would be wrong: once the heater runs and the house imports a little,
  the heater's own draw would be reported back as "surplus". The identity subtracts it out.

* `SolarController` turns that number into on/off with start/stop delays and minimum on/off
  times, so a passing cloud does not make the heater chatter.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


def surplus_w(
    *, grid_import_w: float | None, battery_charging_w: float | None, heater_w: float
) -> float | None:
    """Power the sun could give the heater, or `None` when there is no basis for a decision.

    `grid_import_w` is positive when the house imports. `battery_charging_w` is positive when a
    house battery charges (`None` if there is no battery). `heater_w` is what the heater draws
    right now (0 when it is off).
    """
    if grid_import_w is None:
        return None
    return heater_w + (battery_charging_w or 0.0) - grid_import_w


@dataclass(frozen=True, slots=True)
class SolarConfig:
    start_w: float
    stop_w: float
    start_delay_s: float = 120.0
    stop_delay_s: float = 300.0
    min_on_s: float = 300.0
    min_off_s: float = 300.0
    stale_grace_s: float = 180.0


class SolarController:
    """off -> arming -> on -> disarming -> off, driven by `observe`."""

    def __init__(self, config: SolarConfig) -> None:
        self.config = config
        self.state = "off"
        self._since = 0.0
        self._last_on = -math.inf
        self._last_off = -math.inf
        self._stale_since: float | None = None

    @property
    def wants_on(self) -> bool:
        return self.state in ("on", "disarming")

    def reset(self, now: float) -> None:
        """Forget the current run (target reached, mode changed, ...)."""
        if self.wants_on:
            self._last_off = now
        self.state = "off"
        self._stale_since = None

    def _to_off(self, now: float) -> None:
        self.state = "off"
        self._last_off = now

    def observe(self, now: float, available_w: float | None) -> bool:
        cfg = self.config
        if available_w is None:
            if not self.wants_on:
                self.state = "off"
                return False
            if self._stale_since is None:
                self._stale_since = now
            if now - self._stale_since >= cfg.stale_grace_s:
                self._to_off(now)
                self._stale_since = None
                return False
            return True
        self._stale_since = None

        if self.state == "off":
            if available_w >= cfg.start_w:
                self.state, self._since = "arming", now
            return False
        if self.state == "arming":
            if available_w < cfg.start_w:
                self.state = "off"
                return False
            if now - self._since >= cfg.start_delay_s and now - self._last_off >= cfg.min_off_s:
                self.state, self._last_on = "on", now
                return True
            return False
        if self.state == "on":
            if available_w < cfg.stop_w:
                self.state, self._since = "disarming", now
            return True
        # disarming
        if available_w >= cfg.stop_w:
            self.state = "on"
            return True
        if now - self._since >= cfg.stop_delay_s and now - self._last_on >= cfg.min_on_s:
            self._to_off(now)
            return False
        return True
