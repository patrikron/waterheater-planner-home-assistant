"""Read spot prices from an existing Home Assistant price sensor. Pure Python, no Home Assistant imports.

Supported attribute layouts (checked in this order, the first one that yields prices wins):

* ``raw_today`` / ``raw_tomorrow``: list of ``{start, end, value}`` (Nord Pool custom component, and
  Energi Data Service which uses ``hour`` / ``price``),
* ``prices_today`` / ``prices_tomorrow`` and ``prices``: list of ``{time, price}`` (ENTSO-e),
* ``today`` / ``tomorrow``: plain lists of numbers from local midnight (Nord Pool, Tibber-style templates).

Hourly, half-hourly and quarter-hourly data are all spread over 15-minute slots, which is what the planner uses.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone, tzinfo
from typing import Any, Final, Mapping

UTC = timezone.utc
SLOT: Final = timedelta(minutes=15)

#: Currency -> name of its minor unit.
MINOR_UNITS: Final = {
    "SEK": "öre", "NOK": "øre", "DKK": "øre", "EUR": "cent", "GBP": "p", "USD": "¢", "CHF": "Rp.", "PLN": "gr",
    "CZK": "hal.",
}
#: Spellings of a minor unit in a sensor's unit_of_measurement (lower case).
_MINOR_SPELLINGS: Final = {"öre", "ore", "øre", "c", "ct", "cent", "cents", "¢", "p", "pence", "rp.", "gr", "hal."}
_MINOR_TO_CURRENCY: Final = {"öre": "SEK", "ore": "SEK", "øre": "NOK"}
_SYMBOLS: Final = {"€": "EUR", "kr": "SEK", "$": "USD", "£": "GBP"}

_START_KEYS: Final = ("start", "hour", "time", "start_time", "datetime", "from")
_END_KEYS: Final = ("end", "end_time", "to")
_VALUE_KEYS: Final = ("value", "price", "total", "cost")


class PriceParseError(ValueError):
    """The sensor does not look like a price sensor, or its data is unusable."""


@dataclass(frozen=True, slots=True)
class PriceUnit:
    """What the sensor's numbers mean."""

    currency: str  # ISO code, e.g. SEK
    minor_unit: str  # öre, cent, ...
    to_major_per_kwh: float  # multiply a sensor value by this to get currency per kWh

    @property
    def major_unit(self) -> str:
        return self.currency


def parse_unit(unit: str | None, currency_hint: str | None, default_currency: str = "SEK") -> PriceUnit:
    """`SEK/kWh`, `öre/kWh`, `c/kWh`, `EUR/MWh`, `€/kWh` ... -> a `PriceUnit`.

    A missing unit is taken to be the main currency unit per kWh, since that is what nearly every
    price sensor reports.
    """
    currency = (currency_hint or "").strip().upper() or None
    factor = 1.0
    if unit:
        numerator, _, denominator = unit.strip().partition("/")
        numerator, denominator = numerator.strip(), denominator.strip().lower()
        if denominator in ("mwh",):
            factor /= 1000.0
        elif denominator in ("wh",):
            factor *= 1000.0
        low = numerator.lower()
        if low in _MINOR_SPELLINGS:
            factor /= 100.0
            currency = currency or _MINOR_TO_CURRENCY.get(low)
        elif numerator in _SYMBOLS:
            currency = currency or _SYMBOLS[numerator]
        elif len(numerator) == 3 and numerator.isalpha():
            currency = currency or numerator.upper()
    currency = currency or default_currency
    return PriceUnit(currency, MINOR_UNITS.get(currency, "1/100"), factor)


def _parse_dt(value: Any, tz: tzinfo) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError as err:
            raise PriceParseError(f"unreadable time {value!r}") from err
    else:
        raise PriceParseError(f"unreadable time {value!r}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return dt.astimezone(UTC)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        if isinstance(value, str):
            try:
                value = float(value)
            except ValueError:
                return None
        else:
            return None
    return float(value) if math.isfinite(value) else None


def _pick(item: Mapping[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in item and item[key] is not None:
            return item[key]
    return None


def _from_dict_lists(lists: list[Any], tz: tzinfo) -> dict[datetime, float]:
    """Entries with their own timestamps."""
    rows: list[tuple[datetime, datetime | None, float]] = []
    for lst in lists:
        if not isinstance(lst, list):
            continue
        for item in lst:
            if not isinstance(item, Mapping):
                continue
            start, value = _pick(item, _START_KEYS), _number(_pick(item, _VALUE_KEYS))
            if start is None or value is None:
                continue
            end = _pick(item, _END_KEYS)
            rows.append((_parse_dt(start, tz), _parse_dt(end, tz) if end is not None else None, value))
    rows.sort(key=lambda r: r[0])
    out: dict[datetime, float] = {}
    for i, (start, end, value) in enumerate(rows):
        if end is None:
            nxt = next((r[0] for r in rows[i + 1:] if r[0] > start), None)
            end = nxt if nxt is not None else start + timedelta(hours=1)
        minutes = (end - start).total_seconds() / 60.0
        if minutes < 15 or minutes % 15:
            raise PriceParseError(f"unsupported price resolution: {minutes:g} minutes")
        for k in range(int(minutes // 15)):
            out.setdefault(start + k * SLOT, value)
    return out


def _from_number_lists(days: list[tuple[datetime, Any]]) -> dict[datetime, float]:
    """Plain lists, one per local day, starting at local midnight."""
    out: dict[datetime, float] = {}
    for midnight, values in days:
        if not isinstance(values, list) or not values:
            continue
        numbers = [_number(v) for v in values]
        if any(n is None for n in numbers):
            continue  # tomorrow not published yet: some sensors fill it with nulls
        start = midnight.astimezone(UTC)
        day_minutes = ((midnight + timedelta(days=1)).astimezone(UTC) - start).total_seconds() / 60.0
        res = day_minutes / len(numbers)
        if res not in (15.0, 30.0, 60.0):
            raise PriceParseError(f"a day with {len(numbers)} prices is not hourly, half-hourly or quarter-hourly")
        for i, price in enumerate(numbers):
            for k in range(int(res // 15)):
                out.setdefault(start + timedelta(minutes=res * i + 15 * k), price)
    return out


def parse_prices(
    attributes: Mapping[str, Any], tz: tzinfo, now: datetime, default_currency: str = "SEK"
) -> tuple[PriceUnit, list[tuple[datetime, float]]]:
    """-> the sensor's unit and ascending 15-minute UTC slots with the sensor's own numbers.

    Slots keep the sensor's unit; the caller multiplies by `unit.to_major_per_kwh`.
    """
    unit = parse_unit(attributes.get("unit_of_measurement"), attributes.get("currency"), default_currency)
    local_midnight = now.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    # Local midnight tomorrow, built from the date so a DST change in between cannot skew it.
    tomorrow_midnight = datetime.combine(local_midnight.date() + timedelta(days=1), datetime.min.time(), tzinfo=tz)

    slots: dict[datetime, float] = {}
    for keys in (("raw_today", "raw_tomorrow"), ("prices_today", "prices_tomorrow"), ("prices",)):
        slots = _from_dict_lists([attributes.get(k) for k in keys], tz)
        if slots:
            break
    if not slots:
        slots = _from_number_lists(
            [(local_midnight, attributes.get("today")), (tomorrow_midnight, attributes.get("tomorrow"))]
        )
    if not slots:
        raise PriceParseError("the sensor has no price list (expected raw_today/raw_tomorrow, prices or today/tomorrow)")
    return unit, sorted(slots.items())
