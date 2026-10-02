"""Physics and money for a hot water tank. Pure Python, no Home Assistant imports."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

#: kWh needed to warm one litre of water by one kelvin (4.186 kJ/(kg*K) / 3600).
KWH_PER_LITRE_KELVIN: Final = 4.186 / 3600.0


def energy_needed_kwh(volume_l: float, from_c: float, to_c: float) -> float:
    """Electrical energy to heat `volume_l` litres from `from_c` to `to_c` (never negative).

    Standing losses are ignored on purpose: the controller re-reads the real temperature
    all the time and stops at the target, so a model error only moves the plan, never the
    final temperature.
    """
    return max(0.0, to_c - from_c) * volume_l * KWH_PER_LITRE_KELVIN


def runtime_minutes(energy_kwh: float, power_w: float) -> float:
    """How long a heater of `power_w` takes to deliver `energy_kwh`."""
    if power_w <= 0:
        raise ValueError("power_w must be positive")
    return energy_kwh / (power_w / 1000.0) * 60.0


@dataclass(frozen=True, slots=True)
class Fiscal:
    """Everything added on top of the spot price, in the price's minor unit (öre, cent)."""

    vat_percent: float = 0.0
    tax_minor: float = 0.0
    transfer_minor: float = 0.0

    def effective_minor(self, local_major_per_kwh: float) -> float:
        """Spot price in the price's major unit -> what a kWh costs, in the minor unit.

        Order matters: spot (x100) + energy tax + grid fee, then VAT over the whole sum.
        """
        minor = local_major_per_kwh * 100.0 + self.tax_minor + self.transfer_minor
        return minor * (1.0 + self.vat_percent / 100.0)
