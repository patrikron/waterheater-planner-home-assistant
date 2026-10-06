"""Pure planning core: which quarter-hours to heat in, and what that costs.

No Home Assistant imports, no I/O, no clock: `build_plan(PlanInputs)` is a function of its
arguments, so every rule is a plain unit test.

Three modes share one skeleton:

* cheapest: buy the whole need in the cheapest quarter-hours before the deadline.
* solar:    buy nothing from the grid; the live solar controller heats from surplus.
* hybrid:   cheapest planning that holds back part of the need in the hope of sun.

The hybrid rules (safety slack, price rule, forecast credit) are adapted from the SpotNav
integration's `planning/hybrid_plan.py` (MIT, (c) 2026 Sensnology AB,
https://github.com/henrikekblad/spotnav-home-assistant).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Mapping, Sequence

UTC = timezone.utc
SLOT = timedelta(minutes=15)
UNIT_MIN = 5  # the planner's smallest step; a slot is three of them
_EPS = 1e-9

MODE_CHEAPEST = "cheapest"
MODE_SOLAR = "solar"
MODE_HYBRID = "hybrid"


# --------------------------------------------------------------------------------------------
# Inputs and results
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PriceSlot:
    """One 15-minute interval. `price` is the all-in price in the minor unit per kWh."""

    start: datetime  # timezone-aware
    price: float


@dataclass(frozen=True, slots=True, kw_only=True)
class HybridConfig:
    #: Public solar forecasts run optimistic; trust only half of one.
    confidence: float = 0.5
    #: Derate on the heating capacity available before the deadline.
    feasibility_margin: float = 0.8
    #: What the house takes before the heater sees any sun.
    house_baseline_w: float = 500.0
    #: Sun below this cannot start the heater.
    solar_start_w: float = 2000.0
    #: Required expected gain as a share of the slot's price.
    min_gain_fraction: float = 0.1


@dataclass(frozen=True, slots=True, kw_only=True)
class PlanInputs:
    mode: str
    now: datetime
    deadline: datetime
    need_kwh: float
    power_kw: float
    max_periods: int
    price_slots: tuple[PriceSlot, ...]
    forecast_wh: Mapping[datetime, float] | None
    hybrid: HybridConfig
    #: Solar and Hybrid mode: energy the grid must put in (cheapest hours before `base_deadline`) to reach the base
    #: temperature; the rest of the need is left to the sun.
    base_kwh: float = 0.0
    base_deadline: datetime | None = None
    #: Solar mode only: sun hours cheaper than this (minor unit/kWh) are all open to the heater; dearer ones are
    #: used only as far as needed, cheapest first. 0 = off (heat only on live surplus).
    solar_price_cap: float = 0.0
    #: ... and the sun is then priced at the slot price (unsold electricity) instead of counted as free.
    sun_priced: bool = True
    sun_surplus_only: bool = False  # chosen sun hours only heat on real surplus: the grid never fills in
    #: Waiting for a cheaper hour must save at least this much (minor unit/kWh) or heating starts now. 0 = off.
    wait_saving: float = 0.0


@dataclass(frozen=True, slots=True)
class Period:
    start: datetime
    end: datetime
    kwh: float
    cost_minor: float

    @property
    def price_minor(self) -> float:
        return self.cost_minor / self.kwh if self.kwh > 0 else 0.0


@dataclass(frozen=True, slots=True)
class SolarHour:
    start: datetime
    end: datetime
    kwh: float  # what the heater could take from the sun in this hour


@dataclass(frozen=True, slots=True)
class Plan:
    """What the planner wants, and why.

    `status`: `satisfied` (nothing to heat), `no_prices`, `ok`, or `insufficient` (the deadline is
    too close for the cheapest plan: heat as much as possible, now).
    """

    mode: str
    status: str
    created: datetime
    deadline: datetime
    need_kwh: float
    grid_kwh: float
    solar_kwh: float
    runtime_min: float
    periods: tuple[Period, ...]
    #: Every whole slot the controller may switch on in, a superset of `periods`' time.
    run_slots: tuple[tuple[datetime, datetime], ...]
    solar_hours: tuple[SolarHour, ...]
    cost_minor: float
    cost_now_minor: float
    hybrid_state: str | None = None
    waiting_for_prices: bool = False
    force_now: bool = False
    #: Solar mode with a price limit: slots in sun hours where the heater may run, whatever the live surplus.
    sun_slots: tuple[tuple[datetime, datetime], ...] = ()
    #: The plan starts later, but waiting saves less than the "wait only if it saves" setting: with sun to spare, start now.
    heat_now_ok: bool = False

    @property
    def saving_minor(self) -> float:
        return max(0.0, self.cost_now_minor - self.cost_minor)

    def runs_at(self, moment: datetime) -> bool:
        return self.force_now or any(start <= moment < end for start, end in self.run_slots)

    def sun_runs_at(self, moment: datetime) -> bool:
        return any(start <= moment < end for start, end in self.sun_slots)

    @property
    def next_start(self) -> datetime | None:
        return self.periods[0].start if self.periods else None


# --------------------------------------------------------------------------------------------
# The window: price slots between now and the deadline
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class WindowSlot:
    start: datetime  # clipped to `now` for the slot that is under way
    end: datetime  # clipped to the deadline
    units: int  # whole 5-minute steps available
    price: float

    def kwh(self, power_kw: float) -> float:
        return power_kw * self.units * UNIT_MIN / 60.0


def build_window(
    price_slots: Sequence[PriceSlot], now: datetime, deadline: datetime
) -> list[WindowSlot]:
    """Slots inside `[now, deadline)`, in time order. The slot under way and the last one are clipped."""
    now_u = now.astimezone(UTC)
    deadline_u = deadline.astimezone(UTC)
    window: list[WindowSlot] = []
    for slot in sorted(price_slots, key=lambda s: s.start):
        start = max(slot.start.astimezone(UTC), now_u)
        end = min(slot.start.astimezone(UTC) + SLOT, deadline_u)
        minutes = (end - start).total_seconds() / 60.0
        units = int(minutes // UNIT_MIN + _EPS)
        if units > 0:
            window.append(WindowSlot(start=start, end=end, units=units, price=slot.price))
    return window


# --------------------------------------------------------------------------------------------
# Cheapest selection: dynamic programming over (slot, blocks used, units covered, selected?)
# --------------------------------------------------------------------------------------------


def select_cheapest(
    window: Sequence[WindowSlot], need_units: int, max_blocks: int, power_kw: float
) -> list[int] | None:
    """Indices of the slots to heat in, or `None` if the window cannot cover `need_units`.

    Minimises what the heating costs subject to covering the need and using at most `max_blocks`
    contiguous runs. Exact, not greedy: with few blocks allowed, a slightly dearer hour that joins
    two cheap ones can win. The heater fills the selected slots in time order, so the slot that
    crosses the need is only used for the part that is still missing, and is only charged for that.
    """
    if need_units <= 0:
        return []
    inf = math.inf
    blocks = max(1, max_blocks)
    n = len(window)

    def table() -> list[list[list[float]]]:
        return [[[inf, inf] for _ in range(need_units + 1)] for _ in range(blocks + 1)]

    prev = table()
    prev[0][0][0] = 0.0
    parents: list[dict[tuple[int, int, int], tuple[int, int, int]]] = []

    for i, slot in enumerate(window):
        cur = table()
        parent: dict[tuple[int, int, int], tuple[int, int, int]] = {}
        contiguous = i > 0 and window[i - 1].end == slot.start
        for b in range(blocks + 1):
            row = prev[b]
            for c in range(need_units + 1):
                off, on = row[c]
                best = off if off <= on else on
                if best == inf:
                    continue
                # Not selected (from either state).
                if best < cur[b][c][0]:
                    cur[b][c][0] = best
                    parent[(b, c, 0)] = (b, c, 0 if off <= on else 1)
                used = min(slot.units, need_units - c)
                if used <= 0:
                    continue  # already covered: heating more here would be pointless
                nc = c + used
                cost = slot.price * used * UNIT_MIN / 60.0 * power_kw
                # Selected, continuing the previous slot's block.
                if contiguous and on < inf and on + cost < cur[b][nc][1]:
                    cur[b][nc][1] = on + cost
                    parent[(b, nc, 1)] = (b, c, 1)
                # Selected, starting a new block.
                if b < blocks:
                    base, base_state = (off, 0) if contiguous else (best, 0 if off <= on else 1)
                    if base < inf and base + cost < cur[b + 1][nc][1]:
                        cur[b + 1][nc][1] = base + cost
                        parent[(b + 1, nc, 1)] = (b, c, base_state)
        parents.append(parent)
        prev = cur

    best_value, best_state = inf, None
    for b in range(blocks + 1):
        for s in (0, 1):
            if prev[b][need_units][s] < best_value:
                best_value, best_state = prev[b][need_units][s], (b, need_units, s)
    if best_state is None:
        return None

    selected: list[int] = []
    state = best_state
    for i in range(n - 1, -1, -1):
        previous = parents[i][state]
        if state[2] == 1:
            selected.append(i)
        state = previous
    selected.reverse()
    return selected


def _allocate(
    window: Sequence[WindowSlot], indices: Sequence[int], need_kwh: float, power_kw: float
) -> tuple[list[Period], float]:
    """Fill the selected slots in time order until the need is met; the last one may be partial."""
    periods: list[Period] = []
    remaining = need_kwh
    total_cost = 0.0
    previous_index: int | None = None
    previous_full = False
    for index in indices:
        if remaining <= _EPS:
            break
        slot = window[index]
        use = min(slot.kwh(power_kw), remaining)
        remaining -= use
        end = slot.start + timedelta(hours=use / power_kw)
        cost = use * slot.price
        total_cost += cost
        if periods and previous_index is not None and previous_full and index == previous_index + 1:
            last = periods[-1]
            periods[-1] = Period(last.start, end, last.kwh + use, last.cost_minor + cost)
        else:
            periods.append(Period(slot.start, end, use, cost))
        previous_index = index
        previous_full = use >= slot.kwh(power_kw) - _EPS
    return periods, total_cost


def _wait_pays_little(
    window: Sequence[WindowSlot], indices: list[int], need_kwh: float, power_kw: float, now: datetime, wait_saving: float
) -> bool:
    """True if the plan starts later but waiting saves less than `wait_saving` per kWh.

    The cheapest plan is compared with heating from now without a break. Costs are the real prices. The planner
    keeps the cheapest plan; the engine uses this to start earlier when there is sun to spare right now.
    """
    if wait_saving <= 0 or not indices or not window or window[indices[0]].start <= now or window[0].start > now:
        return False
    _, best_cost = _allocate(window, indices, need_kwh, power_kw)
    now_indices: list[int] = []
    remaining = need_kwh
    for i, slot in enumerate(window):
        if remaining <= _EPS:
            break
        if i and window[i - 1].end != slot.start:
            return False  # a gap in the prices: no unbroken heating from now
        now_indices.append(i)
        remaining -= slot.kwh(power_kw)
    if remaining > _EPS:
        return False
    _, now_cost = _allocate(window, now_indices, need_kwh, power_kw)
    return now_cost - best_cost < wait_saving * need_kwh


def _cost_starting_now(window: Sequence[WindowSlot], need_kwh: float, power_kw: float) -> float:
    """What it would cost to just start heating now and keep going until done."""
    remaining = need_kwh
    cost = 0.0
    for slot in window:
        if remaining <= _EPS:
            break
        use = min(slot.kwh(power_kw), remaining)
        cost += use * slot.price
        remaining -= use
    return cost


# --------------------------------------------------------------------------------------------
# Solar forecast credit and the hybrid split
# --------------------------------------------------------------------------------------------


def solar_hours(
    forecast_wh: Mapping[datetime, float],
    *,
    now: datetime,
    deadline: datetime,
    power_kw: float,
    config: HybridConfig,
) -> list[SolarHour]:
    """The forecast hours in `[now, deadline)` in which the sun could start and feed the heater."""
    now_u, deadline_u = now.astimezone(UTC), deadline.astimezone(UTC)
    hours: list[SolarHour] = []
    for hour_start, wh in sorted(forecast_wh.items()):
        if hour_start.tzinfo is None:
            raise ValueError("forecast hours must be timezone-aware")
        start_u = hour_start.astimezone(UTC)
        start, end = max(start_u, now_u), min(start_u + timedelta(hours=1), deadline_u)
        if end <= start:
            continue
        usable_w = max(0.0, wh) - config.house_baseline_w
        if usable_w < config.solar_start_w:
            continue
        heater_w = min(usable_w, power_kw * 1000.0)
        hours.append(SolarHour(start, end, heater_w * (end - start).total_seconds() / 3600.0 / 1000.0))
    return hours


@dataclass(frozen=True, slots=True)
class HybridSplit:
    grid_kwh: float
    credit_kwh: float
    state: str  # satisfied | no_forecast | last_call | waiting_for_sun | not_worth_it


def split_hybrid(
    *,
    need_kwh: float,
    now: datetime,
    deadline: datetime,
    power_kw: float,
    window: Sequence[WindowSlot],
    forecast_hours: Sequence[SolarHour] | None,
    config: HybridConfig,
) -> HybridSplit:
    """How much to buy from the grid and how much to hold back for the sun.

    Safety rule: never hold back more than the spare heating capacity before the deadline
    (`slack`), so hoping for sun can make heating dearer but never late. Price rule: hold a
    kWh back only when its expected gain, `p - (1 - confidence) * p_fallback`, is at least
    `min_gain_fraction` of its price `p`, walking the cheapest plan from its dearest slot.
    """
    if need_kwh <= 0:
        return HybridSplit(0.0, 0.0, "satisfied")
    if forecast_hours is None:
        return HybridSplit(need_kwh, 0.0, "no_forecast")

    hours_left = max(0.0, (deadline - now).total_seconds() / 3600.0)
    slack = max(0.0, hours_left * power_kw * config.feasibility_margin - need_kwh)
    if slack <= 0:
        return HybridSplit(need_kwh, 0.0, "last_call")

    forecast_kwh = sum(h.kwh for h in forecast_hours)
    cap = max(0.0, min(forecast_kwh * config.confidence, slack, need_kwh))
    if cap <= 0:
        return HybridSplit(need_kwh, 0.0, "waiting_for_sun")
    if not window:
        return HybridSplit(need_kwh, 0.0, "not_worth_it")

    first_sun = min(h.start for h in forecast_hours)
    order = sorted(range(len(window)), key=lambda i: (window[i].price, window[i].start))
    full_plan: list[int] = []
    covered = 0.0
    for i in order:
        if covered >= need_kwh - _EPS:
            break
        full_plan.append(i)
        covered += window[i].kwh(power_kw)

    claimed = set(full_plan)
    fallback_candidates = [
        window[i].price for i in range(len(window)) if i not in claimed and window[i].start >= first_sun
    ]
    if not fallback_candidates:
        return HybridSplit(need_kwh, 0.0, "not_worth_it")
    fallback = min(fallback_candidates)

    held = 0.0
    remaining_cap = cap
    for i in sorted(full_plan, key=lambda i: (-window[i].price, window[i].start)):
        if remaining_cap <= 0:
            break
        price = window[i].price
        gain = price - (1.0 - config.confidence) * fallback
        if gain < config.min_gain_fraction * price or gain <= 0.0:
            break
        take = min(window[i].kwh(power_kw), remaining_cap)
        held += take
        remaining_cap -= take

    if held > 0:
        return HybridSplit(need_kwh - held, held, "waiting_for_sun")
    return HybridSplit(need_kwh, 0.0, "not_worth_it")


# --------------------------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SunPlan:
    slots: tuple[tuple[datetime, datetime], ...]
    periods: tuple[Period, ...]
    grid_kwh: float
    solar_kwh: float
    cost_minor: float
    cost_now_minor: float


def plan_sun_slots(
    window: Sequence[WindowSlot],
    hours: Sequence[SolarHour],
    *,
    need_kwh: float,
    cap_minor: float,
    power_kw: float,
    max_periods: int,
    confidence: float,
    sun_priced: bool = True,
    surplus_only: bool = False,
) -> SunPlan | None:
    """Solar mode with a price limit.

    Only slots inside forecast sun hours are used. Those at or below `cap_minor` are all open to the
    heater (it can heat the moment hot water is used). If they cannot carry the whole need, the
    cheapest dearer sun slots are added, as few as possible. The sun is not free: every kWh it gives the heater
    is a kWh not sold, so all heating is priced at the slot's price (what is not sold or not bought).
    """

    def sun_kw(slot: WindowSlot) -> float | None:
        for h in hours:
            if h.start <= slot.start < h.end:
                return h.kwh / max((h.end - h.start).total_seconds() / 3600.0, 1e-9)
        return None

    eligible = [i for i, w in enumerate(window) if sun_kw(w) is not None]
    if not eligible:
        return None
    free = [i for i in eligible if window[i].price <= cap_minor]
    free_kwh = sum(window[i].kwh(power_kw) for i in free)
    chosen: list[int] = []
    remaining = need_kwh - free_kwh
    if remaining > _EPS:
        dear = [i for i in eligible if window[i].price > cap_minor]
        unit_kwh = power_kw * UNIT_MIN / 60.0
        picked = select_cheapest([window[i] for i in dear], max(1, math.ceil(remaining / unit_kwh - _EPS)), max_periods, power_kw)
        chosen = dear if picked is None else [dear[j] for j in picked]
    indices = sorted(set(free) | set(chosen))
    periods, _ = _allocate(window, indices, need_kwh, power_kw)
    grid = solar = cost = 0.0
    fixed: list[Period] = []
    for p in periods:
        slot = next(w for w in window if w.start <= p.start < w.end)
        share = min(1.0, (sun_kw(slot) or 0.0) / power_kw) * confidence
        grid += 0.0 if surplus_only else p.kwh * (1.0 - share)
        solar += p.kwh * share
        if surplus_only and not sun_priced:  # nothing is bought and the sun is free
            fixed.append(Period(p.start, p.end, p.kwh, 0.0))
        elif sun_priced:
            cost += p.cost_minor
            fixed.append(p)
        else:  # the sun is free: only the grid's share costs
            cost += p.cost_minor * (1.0 - share)
            fixed.append(Period(p.start, p.end, p.kwh, p.cost_minor * (1.0 - share)))
    return SunPlan(
        slots=tuple((window[i].start, window[i].end) for i in indices),
        periods=tuple(fixed),
        grid_kwh=grid,
        solar_kwh=solar,
        cost_minor=cost,
        cost_now_minor=_cost_starting_now(window, need_kwh, power_kw) if sun_priced else 0.0,
    )


@dataclass(frozen=True, slots=True)
class _BasePart:
    """Hybrid mode: the grid energy bought in the cheapest slots before the base-temperature deadline."""

    kwh: float
    periods: tuple[Period, ...]
    slots: tuple[tuple[datetime, datetime], ...]
    cost_minor: float
    cost_now_minor: float
    indices: tuple[int, ...]


def _plan_base_part(inputs: PlanInputs, now: datetime, deadline: datetime, power_kw: float, base_kwh: float) -> _BasePart | None:
    """Cheapest slots (at most `max_periods` runs) before the base deadline that bring in `base_kwh`."""
    if base_kwh <= _EPS or inputs.base_deadline is None or not inputs.price_slots:
        return None
    limit = min(deadline, inputs.base_deadline.astimezone(UTC))
    window = build_window(inputs.price_slots, now, limit)
    priced_until = max((s.start + SLOT for s in inputs.price_slots), default=now).astimezone(UTC)
    kwh = base_kwh
    if limit > priced_until:  # prices for the rest are not out yet: buy only what could not be bought later
        later = (limit - max(priced_until, now)).total_seconds() / 3600.0 * power_kw * inputs.hybrid.feasibility_margin
        kwh = max(0.0, kwh - later)
    if kwh <= _EPS or not window:
        return None
    unit_kwh = power_kw * UNIT_MIN / 60.0
    indices = select_cheapest(window, max(1, math.ceil(kwh / unit_kwh - _EPS)), inputs.max_periods, power_kw)
    if indices is None:  # too close to the deadline for all of it: everything there is, now
        indices = list(range(len(window)))
    periods, cost = _allocate(window, indices, kwh, power_kw)
    return _BasePart(
        kwh=kwh,
        periods=tuple(periods),
        slots=tuple((window[i].start, window[i].end) for i in indices),
        cost_minor=cost,
        cost_now_minor=_cost_starting_now(window, kwh, power_kw),
        indices=tuple(indices),
    )


def build_plan(inputs: PlanInputs) -> Plan:
    now, deadline = inputs.now.astimezone(UTC), inputs.deadline.astimezone(UTC)
    mode, power_kw = inputs.mode, inputs.power_kw

    sun: SunPlan | None = None
    base_part: _BasePart | None = None  # Hybrid mode: the grid share that reaches the base temperature

    def result(status: str, **kwargs: object) -> Plan:
        base: dict[str, object] = dict(
            mode=mode,
            status=status,
            created=now,
            deadline=deadline,
            need_kwh=inputs.need_kwh,
            grid_kwh=0.0,
            solar_kwh=0.0,
            runtime_min=0.0,
            periods=(),
            run_slots=(),
            solar_hours=(),
            cost_minor=0.0,
            cost_now_minor=0.0,
        )
        base.update(kwargs)
        if sun is not None:
            base["periods"] = tuple(sorted([*base["periods"], *sun.periods], key=lambda q: q.start))  # type: ignore[misc]
            base["grid_kwh"] += sun.grid_kwh  # type: ignore[operator]
            base["solar_kwh"] = sun.solar_kwh
            base["runtime_min"] += sum((q.end - q.start).total_seconds() for q in sun.periods) / 60.0  # type: ignore[operator]
            base["cost_minor"] += sun.cost_minor  # type: ignore[operator]
            base["sun_slots"] = sun.slots
            base["cost_now_minor"] += sun.cost_now_minor  # type: ignore[operator]
        if base_part is not None:
            base["periods"] = tuple(sorted([*base["periods"], *base_part.periods], key=lambda q: q.start))  # type: ignore[misc]
            base["grid_kwh"] += base_part.kwh  # type: ignore[operator]
            base["runtime_min"] += sum((q.end - q.start).total_seconds() for q in base_part.periods) / 60.0  # type: ignore[operator]
            base["cost_minor"] += base_part.cost_minor  # type: ignore[operator]
            base["run_slots"] = tuple(sorted([*base["run_slots"], *base_part.slots]))  # type: ignore[misc]
            base["cost_now_minor"] += base_part.cost_now_minor  # type: ignore[operator]
        return Plan(**base)  # type: ignore[arg-type]

    if inputs.need_kwh <= 0:
        return result("satisfied")

    window = build_window(inputs.price_slots, now, deadline)
    forecast_hours: list[SolarHour] | None = None
    if inputs.forecast_wh is not None:
        forecast_hours = solar_hours(
            inputs.forecast_wh, now=now, deadline=deadline, power_kw=power_kw, config=inputs.hybrid
        )
    forecast_kwh = sum(h.kwh for h in forecast_hours) if forecast_hours else 0.0
    shown_hours = tuple(forecast_hours or ())

    grid_deadline = deadline
    base_kwh = 0.0
    if mode == MODE_SOLAR:
        base_kwh = min(max(0.0, inputs.base_kwh), inputs.need_kwh)
        expected = min(inputs.need_kwh - base_kwh, forecast_kwh * inputs.hybrid.confidence)
        if inputs.solar_price_cap > 0 and forecast_hours:
            sun = plan_sun_slots(
                build_window(inputs.price_slots, now, deadline),
                forecast_hours,
                need_kwh=inputs.need_kwh - base_kwh,
                cap_minor=inputs.solar_price_cap,
                power_kw=power_kw,
                max_periods=inputs.max_periods,
                confidence=inputs.hybrid.confidence,
                sun_priced=inputs.sun_priced,
                surplus_only=inputs.sun_surplus_only,
            )
        if base_kwh <= _EPS:
            return result("ok", solar_kwh=expected, solar_hours=shown_hours)
        # Only the base temperature is bought from the grid, in the cheapest hours before its deadline.
        if inputs.base_deadline is not None:
            grid_deadline = min(deadline, inputs.base_deadline.astimezone(UTC))  # (Solar mode only)
        window = build_window(inputs.price_slots, now, grid_deadline)

    if not inputs.price_slots:
        return result("no_prices", solar_hours=shown_hours)

    hybrid_need = inputs.need_kwh
    if mode == MODE_HYBRID:
        # The base temperature is bought first; the sun-or-grid split then works on what is left.
        base_kwh = min(max(0.0, inputs.base_kwh), inputs.need_kwh)
        base_part = _plan_base_part(inputs, now, deadline, power_kw, base_kwh)
        hybrid_need = inputs.need_kwh - base_kwh
        if base_part is not None:
            taken = set(base_part.indices)
            window = [replace(w, units=0) if i in taken else w for i, w in enumerate(window)]

    hybrid_state: str | None = None
    grid_kwh = inputs.need_kwh
    solar_kwh = 0.0
    if mode == MODE_SOLAR:
        grid_kwh, solar_kwh = base_kwh, expected
    if mode == MODE_HYBRID:
        split = split_hybrid(
            need_kwh=hybrid_need,
            now=now,
            deadline=deadline,
            power_kw=power_kw,
            window=window,
            forecast_hours=forecast_hours,
            config=inputs.hybrid,
        )
        grid_kwh, solar_kwh, hybrid_state = split.grid_kwh, split.credit_kwh, split.state

    # Prices for the rest of the window may not be published yet. Buy only what could not be
    # bought later even at full power; the plan is extended when the prices arrive.
    priced_until = max((s.start + SLOT for s in inputs.price_slots), default=now).astimezone(UTC)
    waiting = False
    if grid_deadline > priced_until:
        unpriced_h = (grid_deadline - max(priced_until, now)).total_seconds() / 3600.0
        later = unpriced_h * power_kw * inputs.hybrid.feasibility_margin
        must_now = max(0.0, grid_kwh - later)
        waiting = must_now < grid_kwh - _EPS
        grid_kwh = must_now

    if grid_kwh <= _EPS:
        return result(
            "ok",
            solar_kwh=solar_kwh,
            solar_hours=shown_hours,
            hybrid_state=hybrid_state,
            waiting_for_prices=waiting,
        )

    unit_kwh = power_kw * UNIT_MIN / 60.0
    need_units = max(1, math.ceil(grid_kwh / unit_kwh - _EPS))
    indices = select_cheapest(window, need_units, inputs.max_periods, power_kw)
    early_ok = indices is not None and _wait_pays_little(window, indices, grid_kwh, power_kw, now, inputs.wait_saving)
    status = "ok"
    force_now = False
    if indices is None:
        # The deadline is too close for the whole need: heat as much as possible, now.
        indices = list(range(len(window)))
        status = "insufficient"
        force_now = True

    periods, cost = _allocate(window, indices, grid_kwh, power_kw)
    runtime = sum((p.end - p.start).total_seconds() for p in periods) / 60.0
    return result(
        status,
        grid_kwh=grid_kwh,
        solar_kwh=solar_kwh,
        runtime_min=runtime,
        periods=tuple(periods),
        run_slots=tuple((window[i].start, window[i].end) for i in indices),
        solar_hours=shown_hours,
        cost_minor=cost,
        cost_now_minor=_cost_starting_now(window, grid_kwh, power_kw),
        hybrid_state=hybrid_state,
        waiting_for_prices=waiting,
        force_now=force_now,
        heat_now_ok=early_ok,
    )
