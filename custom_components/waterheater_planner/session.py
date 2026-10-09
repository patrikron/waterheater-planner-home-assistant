"""Energy and cost of the latest heating (pure, no Home Assistant imports).

With a cycle key (the "ready by" a heating works towards) every heating for the same "ready by" is added
into one record, so the night's and the day's heatings for 16:00 show as one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: A pause shorter than this does not end a heating (the dwell time makes short pauses normal).
GAP_S = 600.0
#: Longest step that is integrated in one go (a stalled tick must not invent energy).
MAX_STEP_S = 120.0
#: Heating periods are remembered this long, for the card's chart.
RUNS_KEEP_S = 24 * 3600.0
#: Daily totals are kept this many days (a month plus a spare week).
DAYS_KEEP = 70
#: A switch-off shorter than this is drawn as one continuous period.
RUN_MERGE_S = 150.0
#: Reasons that are drawn as sun on the card.
SUN_REASONS = ("heating_solar", "heating_sun_slot")


@dataclass(slots=True)
class HeatingRecord:
    start_s: float
    end_s: float
    kwh: float = 0.0
    cost_minor: float = 0.0
    solar_kwh: float = 0.0
    priced: bool = True  # False if some of the energy had no known price
    cycle: float | None = None  # the "ready by" (epoch s) the heating was for; same cycle = one record

    def as_dict(self) -> dict[str, Any]:
        return {"start": self.start_s, "end": self.end_s, "kwh": self.kwh, "cost": self.cost_minor,
                "solar_kwh": self.solar_kwh, "priced": self.priced, "cycle": self.cycle}


class HeatingLog:
    """Integrates energy and cost while the heater is on; a heating ends after `GAP_S` of being off.

    Energy is the heater's measured power if a power sensor is set, else the rated power.
    Cost is energy x the all-in price of the slot; energy marked as solar is free.
    """

    def __init__(self, power_w: float) -> None:
        self.power_w = power_w
        self.current: HeatingRecord | None = None
        self.last: HeatingRecord | None = None
        self._prev_s: float | None = None
        self._off_since: float | None = None
        self.days: dict[str, list[float]] = {}  # local date (ISO) -> [kwh, cost_minor, solar_kwh, unpriced_kwh]
        self.runs: list[list[Any]] = []  # [start_s, end_s, 1.0 if sun else 0.0, status that heated it]
        self.finished = 0  # counts finished heatings (a record may be continued, so `last` can stay the same object)

    def observe(self, now_s: float, switch_on: bool | None, measured_w: float | None,
                price_minor: float | None, solar: bool, reason: str | None = None,
                day: str | None = None, cycle: float | None = None) -> None:
        prev, self._prev_s = self._prev_s, now_s
        if switch_on is None:
            return
        if switch_on:
            self._off_since = None
            self._record_run(now_s, solar, reason)
            if self.current is None:
                last = self.last
                if cycle is not None and last is not None and last.cycle == cycle:
                    self.current = last  # another heating for the same "ready by": add to it
                else:
                    self.current = HeatingRecord(now_s, now_s, cycle=cycle)
            if prev is not None:
                dt = min(max(now_s - prev, 0.0), MAX_STEP_S)
                watts = measured_w if measured_w is not None and measured_w > 50 else self.power_w
                kwh = watts / 1000.0 * dt / 3600.0
                c = self.current
                c.kwh += kwh
                c.end_s = now_s
                d = self.days.setdefault(day, [0.0, 0.0, 0.0, 0.0]) if day else None
                if d is not None:
                    d[0] += kwh
                if solar:
                    c.solar_kwh += kwh
                    if d is not None:
                        d[2] += kwh
                elif price_minor is None:
                    c.priced = False
                    if d is not None:
                        d[3] += kwh
                else:
                    c.cost_minor += kwh * price_minor
                    if d is not None:
                        d[1] += kwh * price_minor
                if d is not None and len(self.days) > DAYS_KEEP:
                    for old in sorted(self.days)[: len(self.days) - DAYS_KEEP]:
                        del self.days[old]
        elif self.current is not None:
            if self._off_since is None:
                self._off_since = now_s
            if now_s - self._off_since >= GAP_S:
                self._finish()

    def _record_run(self, now_s: float, solar: bool, reason: str | None = None) -> None:
        flag = 1.0 if (solar or reason in SUN_REASONS) else 0.0
        last = self.runs[-1] if self.runs else None
        if last is not None and last[2] == flag and last[3] == reason and now_s - last[1] <= RUN_MERGE_S:
            last[1] = now_s
        else:
            self.runs.append([now_s, now_s, flag, reason])
        cutoff = now_s - RUNS_KEEP_S
        while self.runs and self.runs[0][1] < cutoff:
            self.runs.pop(0)

    def recent_runs(self, since_s: float) -> list[list[Any]]:
        return [r for r in self.runs if r[1] >= since_s]

    def _finish(self) -> None:
        if self.current is not None and self.current.kwh >= 0.05:
            self.last = self.current
            self.finished += 1
        self.current = None
        self._off_since = None

    def shown(self) -> HeatingRecord | None:
        """The heating to display: the running one once it has used something, else the last finished."""
        if self.current is not None and self.current.kwh >= 0.05:
            return self.current
        return self.last

    @property
    def running(self) -> bool:
        return self.current is not None

    def backfill_runs(self, intervals: list[tuple[float, float]], now_s: float) -> int:
        """Add heatings seen in the recorder that the log does not already hold.

        Intervals that overlap a logged run are skipped; the rest get no reason (unknown).
        """
        cutoff = now_s - RUNS_KEEP_S
        added = 0
        for start, end in intervals:
            if end < cutoff or end <= start:
                continue
            start = max(start, cutoff)
            if any(r[0] <= end and r[1] >= start for r in self.runs):
                continue
            self.runs.append([start, end, 0.0, None])
            added += 1
        self.runs.sort(key=lambda r: r[0])
        return added

    def totals(self, since_day: str) -> dict[str, float]:
        """Energy, grid cost (minor unit), solar energy and unpriced energy from `since_day` (ISO date) on."""
        rows = [v for k, v in self.days.items() if k >= since_day]
        return {
            "kwh": sum(r[0] for r in rows), "cost_minor": sum(r[1] for r in rows),
            "solar_kwh": sum(r[2] for r in rows), "unpriced_kwh": sum(r[3] for r in rows),
        }

    def load_days(self, data: Any) -> None:
        try:
            self.days = {str(k): [float(x) for x in (list(v) + [0.0] * 4)[:4]] for k, v in (data or {}).items()}
        except (TypeError, ValueError, AttributeError):
            self.days = {}

    def load_runs(self, data: Any) -> None:
        try:
            self.runs = [[float(r[0]), float(r[1]), float(r[2]), r[3] if len(r) > 3 else None] for r in (data or [])]
        except (TypeError, ValueError):
            self.runs = []

    def load(self, data: dict[str, Any] | None) -> None:
        try:
            if data:
                self.last = HeatingRecord(float(data["start"]), float(data["end"]), float(data["kwh"]),
                                          float(data["cost"]), float(data.get("solar_kwh", 0.0)),
                                          bool(data.get("priced", True)),
                                          None if data.get("cycle") is None else float(data["cycle"]))
        except (KeyError, TypeError, ValueError):
            self.last = None
