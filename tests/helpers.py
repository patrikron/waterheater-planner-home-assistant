from datetime import datetime, timedelta, timezone

from custom_components.waterheater_planner.planner import PriceSlot

UTC = timezone.utc


def slots_from(prices, start=datetime(2026, 9, 22, 0, 0, tzinfo=UTC)):
    return tuple(PriceSlot(start + timedelta(minutes=15 * i), p) for i, p in enumerate(prices))
