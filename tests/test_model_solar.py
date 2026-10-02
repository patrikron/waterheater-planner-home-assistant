import pytest

from custom_components.waterheater_planner.model import Fiscal, energy_needed_kwh, runtime_minutes
from custom_components.waterheater_planner.solar import SolarConfig, SolarController, surplus_w


def test_fiscal_order_vat_is_last():
    fiscal = Fiscal(vat_percent=25, tax_minor=36, transfer_minor=30)
    # 2 kr/kWh spot = 200 öre; (200 + 36 + 30) * 1.25
    assert fiscal.effective_minor(2.0) == pytest.approx(332.5)
    assert Fiscal().effective_minor(2.0) == pytest.approx(200.0)
    assert Fiscal(vat_percent=25).effective_minor(-0.1) == pytest.approx(-12.5)  # negative spot stays negative


def test_physics():
    # 200 l from 45 to 60 degrees: 15 K * 200 l * 4.186 kJ / 3600 = 3.488 kWh
    assert energy_needed_kwh(200, 45, 60) == pytest.approx(3.488, abs=0.002)
    assert energy_needed_kwh(200, 60, 55) == 0
    assert runtime_minutes(3.488, 3000) == pytest.approx(69.8, abs=0.1)


def test_surplus_uses_the_energy_balance():
    # exporting 2.5 kW with the heater off: 2.5 kW is available
    assert surplus_w(grid_import_w=-2500, battery_charging_w=None, heater_w=0) == 2500
    # heater (3 kW) running, house imports 500 W: the sun supplies 2.5 kW of it
    assert surplus_w(grid_import_w=500, battery_charging_w=None, heater_w=3000) == 2500
    # a battery charging at 1 kW could be diverted to the heater
    assert surplus_w(grid_import_w=0, battery_charging_w=1000, heater_w=0) == 1000
    assert surplus_w(grid_import_w=None, battery_charging_w=None, heater_w=0) is None


def run(ctrl, samples):
    return [(t, ctrl.observe(t, w)) for t, w in samples]


def test_solar_controller_starts_after_delay_and_stops_after_delay():
    c = SolarController(SolarConfig(start_w=2400, stop_w=1500, start_delay_s=120, stop_delay_s=300, min_on_s=300, min_off_s=300))
    out = dict(run(c, [(t, 3000) for t in range(0, 130, 30)]))
    assert out[0] is False and out[90] is False and out[120] is True  # 120 s of steady sun
    # a brief cloud does not stop it
    assert c.observe(150, 1000) is True and c.observe(240, 3000) is True and c.state == "on"
    # a long dip does, but only after 300 s
    assert c.observe(300, 1000) is True and c.observe(570, 1000) is True and c.observe(600, 1000) is False


def test_solar_controller_ignores_a_short_spike():
    c = SolarController(SolarConfig(start_w=2400, stop_w=1500))
    assert not c.observe(0, 3000) and not c.observe(30, 3000)
    assert not c.observe(60, 500)  # sun faded before the delay: back to off
    assert not c.observe(90, 3000) and c.state == "arming"


def test_solar_controller_without_data_never_starts_and_gives_up_a_run_after_the_grace():
    c = SolarController(SolarConfig(start_w=2400, stop_w=1500, stale_grace_s=180))
    assert c.observe(0, None) is False
    for t in range(0, 130, 30):
        c.observe(t, 3000)
    assert c.state == "on"
    assert c.observe(200, None) is True and c.observe(300, None) is True
    assert c.observe(400, None) is False
