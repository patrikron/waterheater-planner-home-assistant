import pytest

from custom_components.waterheater_planner.learning import EnergyLearner
from custom_components.waterheater_planner.model import KWH_PER_LITRE_KELVIN


def run_episode(learner, t0, t1, kwh, start=0.0, target=60.0, draw=False, measured=False):
    """Heat at constant power from `t0` to `t1` using `kwh`, then let the sensor settle."""
    power_w = learner.power_w
    seconds = kwh / (power_w / 1000.0) * 3600.0
    now, steps = start, int(seconds // 30)
    for i in range(steps):
        temp = t0 + (t1 - t0) * i / steps
        learner.observe(now, temp, True, target, power_w if measured else None)
        now += 30
        if draw and i == steps // 2:
            learner.observe(now, temp - 10, True, target, power_w if measured else None)
            now += 30
    for _ in range(40):  # 20 minutes off
        learner.observe(now, t1, False, target)
        now += 30
    return now


def learner():
    return EnergyLearner(volume_l=300, power_w=3000)


def test_needs_a_few_good_episodes_before_it_trusts_itself():
    l = learner()
    now = 0.0
    for n in range(2):
        now = run_episode(l, 20, 62, 7.0, start=now)
        assert l.ratio is None
    now = run_episode(l, 20, 62, 7.0, start=now)
    assert l.count == 3 and l.ratio is not None


def test_ratio_is_real_over_textbook():
    l = learner()
    now = 0.0
    for _ in range(4):
        now = run_episode(l, 20, 62, 7.0, start=now)
    textbook = 300 * KWH_PER_LITRE_KELVIN * 42
    assert l.ratio == pytest.approx(7.0 / textbook, rel=0.02)
    assert l.correction_pct == pytest.approx((7.0 / textbook - 1) * 100, abs=2)


def test_weights_big_heatings_more_than_small_ones():
    l = learner()
    now = 0.0
    now = run_episode(l, 20, 62, 7.0, start=now)
    now = run_episode(l, 20, 62, 7.0, start=now)
    now = run_episode(l, 45, 62, 5.0, start=now)  # odd small one: 0.29 kWh/K
    textbook = 300 * KWH_PER_LITRE_KELVIN
    assert l.ratio == pytest.approx(19.0 / (textbook * (42 + 42 + 17)), rel=0.02)


def test_a_draw_during_heating_spoils_the_episode():
    l = learner()
    run_episode(l, 20, 62, 7.0, draw=True)
    assert l.count == 0


def test_small_or_unfinished_heatings_are_ignored():
    l = learner()
    now = run_episode(l, 55, 62, 1.5)  # 7 K: too small
    now = run_episode(l, 20, 45, 4.0, start=now)  # never near the target 60
    assert l.count == 0


def test_measured_power_beats_the_nominal_power():
    l = learner()
    now = 0.0
    for _ in range(3):
        # the sensor says the element drew only 2.5 kW (thermostat cycling): same time, less energy
        seconds = 7.0 / 3.0 * 3600
        steps = int(seconds // 30)
        for i in range(steps):
            l.observe(now, 20 + 42 * i / steps, True, 60.0, 2500.0)
            now += 30
        for _ in range(40):
            l.observe(now, 62, False, 60.0)
            now += 30
    used = sum(u for u, _ in l.samples) / l.count
    assert used == pytest.approx(7.0 * 2.5 / 3.0, rel=0.03)


def test_a_long_gap_is_not_counted_as_heating_time():
    l = learner()
    l.observe(0, 20, True, 60.0)
    l.observe(10_000, 20, True, 60.0)  # HA was down for hours: only one capped step counts
    assert l._episode.energy_kwh < 0.15


def test_save_and_restore():
    l = learner()
    now = 0.0
    for _ in range(3):
        now = run_episode(l, 20, 62, 7.0, start=now)
    other = learner()
    other.load(l.as_dict())
    assert other.ratio == pytest.approx(l.ratio, rel=1e-3)
    other.load({"samples": "garbage"})
    assert other.count == 0


def test_ratio_is_clamped():
    l = learner()
    now = 0.0
    for _ in range(3):
        now = run_episode(l, 20, 62, 30.0, start=now)  # absurdly high
    assert l.ratio == 1.5
