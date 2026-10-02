"""Learns how much energy the heater really needs per degree on the *sensor's* scale. Pure Python.

A tank with a sensor that does not sit in the middle of the water (outside the insulation, low in the
tank, ...) does not follow the textbook `litres x 4.186 kJ/K`. Instead of asking the user to guess a
correction, this watches complete heating episodes and measures it:

    episode  = heater goes on at sensor temperature T0 ... target reached, sensor settles at T1
    sample   = (kWh really used, kWh the textbook formula gives for T1 - T0)
    ratio    = sum(used) / sum(textbook) over the latest samples

Episodes disturbed by a hot-water draw, too small to mean anything, or that never got near the target
are thrown away. The ratio is only trusted after a few good episodes.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any

from .model import KWH_PER_LITRE_KELVIN

MAX_SAMPLES = 20
MIN_SAMPLES = 3
MIN_DELTA_K = 15.0  # smaller heatings say little about the ratio
MIN_KWH = 1.0
DRAW_DROP_K = 3.0  # a fall this far below the highest reading during an episode is a draw
SETTLE_S = 900.0  # after the heater stops the sensor keeps rising for a while
GIVE_UP_S = 3 * 3600.0  # an episode that never reaches the target is dropped after this
TARGET_SLACK_K = 3.0
RATIO_MIN, RATIO_MAX = 0.2, 1.5
MAX_STEP_S = 120.0  # never integrate over a longer gap than this (restarts, outages)


@dataclass
class _Episode:
    started: float
    t0: float
    t_max: float
    energy_kwh: float = 0.0
    last_on: float = 0.0
    dirty: bool = False


@dataclass
class EnergyLearner:
    volume_l: float
    power_w: float
    samples: deque[tuple[float, float]] = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    _episode: _Episode | None = field(default=None, init=False, repr=False)
    _last_tick: float | None = field(default=None, init=False, repr=False)

    # ---- results -------------------------------------------------------------------------

    @property
    def count(self) -> int:
        return len(self.samples)

    @property
    def ratio(self) -> float | None:
        """Real energy / textbook energy, or None until enough good episodes have been seen."""
        if len(self.samples) < MIN_SAMPLES:
            return None
        used = sum(u for u, _ in self.samples)
        textbook = sum(t for _, t in self.samples)
        if textbook <= 0:
            return None
        return min(RATIO_MAX, max(RATIO_MIN, used / textbook))

    @property
    def correction_pct(self) -> float | None:
        r = self.ratio
        return None if r is None else (r - 1.0) * 100.0

    # ---- feeding it ------------------------------------------------------------------------

    def observe(
        self, now_s: float, temp: float | None, switch_on: bool | None, target_c: float, measured_w: float | None = None
    ) -> None:
        """Call once per tick. `measured_w` is the heater's real power if there is a sensor for it."""
        dt = 0.0 if self._last_tick is None else max(0.0, min(now_s - self._last_tick, MAX_STEP_S))
        self._last_tick = now_s
        if temp is None or switch_on is None:
            return
        ep = self._episode

        if ep is None:
            if switch_on:
                self._episode = _Episode(started=now_s, t0=temp, t_max=temp, last_on=now_s)
                ep = self._episode
            else:
                return

        ep.t_max = max(ep.t_max, temp)
        if temp < ep.t_max - DRAW_DROP_K:
            ep.dirty = True
        if switch_on:
            ep.last_on = now_s
            watts = self.power_w if measured_w is None else max(0.0, measured_w)
            ep.energy_kwh += watts * dt / 3.6e6
            return

        idle = now_s - ep.last_on
        settled = idle >= SETTLE_S and temp >= target_c - TARGET_SLACK_K - 1.0
        if settled or idle >= GIVE_UP_S:
            self._finish(ep, target_c)

    def _finish(self, ep: _Episode, target_c: float) -> None:
        self._episode = None
        delta = ep.t_max - ep.t0
        good = (
            not ep.dirty
            and delta >= MIN_DELTA_K
            and ep.energy_kwh >= MIN_KWH
            and ep.t_max >= target_c - TARGET_SLACK_K
        )
        if good:
            self.samples.append((ep.energy_kwh, self.volume_l * KWH_PER_LITRE_KELVIN * delta))

    # ---- storage ---------------------------------------------------------------------------

    def as_dict(self) -> dict[str, Any]:
        return {"samples": [[round(u, 3), round(t, 3)] for u, t in self.samples]}

    def load(self, data: Any) -> None:
        """Restore saved samples; anything unreadable is ignored."""
        self.samples.clear()
        try:
            for used, textbook in data.get("samples", []):
                used, textbook = float(used), float(textbook)
                if used > 0 and textbook > 0:
                    self.samples.append((used, textbook))
        except (AttributeError, TypeError, ValueError):
            self.samples.clear()
