"""Render the card screenshots in docs/images from the real planner and engine.

The numbers are *sample data*: the SE4 price day in tests/fixtures, a made-up sunny forecast and a
made-up tank, run through the real planner so the plans on the card are genuine plans.

    pip install playwright && playwright install chromium
    python docs/tools/make_screenshots.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import types
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
for _name, _path in (("custom_components", ROOT / "custom_components"),
                     ("custom_components.waterheater_planner", ROOT / "custom_components" / "waterheater_planner")):
    _m = types.ModuleType(_name)
    _m.__path__ = [str(_path)]
    sys.modules.setdefault(_name, _m)

from custom_components.waterheater_planner.engine import Engine, HeaterConfig, Settings  # noqa: E402
from custom_components.waterheater_planner.model import Fiscal  # noqa: E402
from custom_components.waterheater_planner.planner import HybridConfig, PriceSlot, build_plan  # noqa: E402
from custom_components.waterheater_planner.solar import SolarConfig  # noqa: E402

UTC = timezone.utc
STO = ZoneInfo("Europe/Stockholm")
FISCAL = Fiscal(vat_percent=25, tax_minor=36, transfer_minor=30)
CARD = ROOT / "custom_components" / "waterheater_planner" / "www" / "waterheater-planner-card.js"
OUT = ROOT / "docs" / "images"

ENTITIES = {
    "mode": "select.varmvattenberedare_mode",
    "target_temperature": "number.varmvattenberedare_target_temperature",
    "min_temperature": "number.varmvattenberedare_comfort_floor",
    "max_periods": "number.varmvattenberedare_max_heating_periods",
    "energy_adjust": "number.varmvattenberedare_energy_correction",
    "floor_max_price": "number.varmvattenberedare_comfort_floor_max_price",
    "base_temperature": "number.varmvattenberedare_base_temperature",
    "regrid_below": "number.varmvattenberedare_grid_re_heat_below",
    "solar_price_cap": "number.varmvattenberedare_solar_price_limit",
    "solar_start": "number.varmvattenberedare_surplus_to_start",
    "house_baseline": "number.varmvattenberedare_house_base_load",
    "ready_by": "time.varmvattenberedare_ready_by",
    "base_by": "time.varmvattenberedare_base_temperature_ready_by",
    "automatic": "switch.varmvattenberedare_automatic",
    "boost": "switch.varmvattenberedare_heat_now",
    "learn_energy": "switch.varmvattenberedare_learn_energy_need",
    "sun_priced": "switch.varmvattenberedare_price_the_sun",
    "sell_other_sun": "switch.varmvattenberedare_solar_mode_sell_surplus_outside_the_chosen_sun_hours",
    "sun_surplus_only": "switch.varmvattenberedare_solar_mode_heat_in_sun_hours_only_when_the_surplus_is_enough",
}


def price_slots() -> tuple[PriceSlot, ...]:
    doc = json.loads((ROOT / "tests" / "fixtures" / "day_SE4_2026-09-22_96.json").read_text())
    start = datetime(2026, 9, 21, 22, 0, tzinfo=UTC)  # 00:00 local on 22 Sep
    return tuple(
        PriceSlot(start + timedelta(days=d, minutes=15 * i), FISCAL.effective_minor(eur * doc["fx"]["SEK"]))
        for d in range(2) for i, eur in enumerate(doc["prices"])
    )


def sun_w(hour: float) -> float:
    return max(0.0, 6000 * (1 - ((hour - 13) / 4.5) ** 2)) if 8.5 <= hour <= 17.5 else 0.0


FORECAST = {
    datetime(2026, 9, 23, h, 0, tzinfo=STO).astimezone(UTC): sun_w(h + 0.5) for h in range(24)
}


def ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def local(day: int, h: int, m: int = 0) -> datetime:
    return datetime(2026, 9, day, h, m, tzinfo=STO).astimezone(UTC)


def scenario(now: datetime, temp: float, status: str, heater_on: bool, surplus: float | None,
             heated: list, last: tuple | None, **settings) -> dict:
    cfg = HeaterConfig(
        power_w=3000, volume_l=300, tz=STO, fiscal=FISCAL, hybrid=HybridConfig(house_baseline_w=500, solar_start_w=2400),
        solar=SolarConfig(start_w=2400, stop_w=1500), has_surplus_sensor=True,
    )
    base = dict(target_c=60, min_c=40, max_periods=4, energy_adjust_pct=-50.0, energy_auto=True)
    base.update(settings)
    eng = Engine(cfg, Settings(**base))
    eng.price_slots = price_slots()
    eng.forecast_wh = FORECAST
    eng.learned_pct = -48.7
    s = eng.settings
    plan = build_plan(eng.plan_inputs(now, temp))
    day0 = datetime.combine(now.astimezone(STO).date(), time(0), tzinfo=STO).astimezone(UTC)
    horizon = min(plan.deadline, now + timedelta(hours=48))
    cur = next((p.price for p in eng.price_slots if p.start <= now < p.start + timedelta(minutes=15)), None)
    attrs = {
        "friendly_name": "Varmvattenberedare Status", "temperature": temp, "target_temperature": s.target_c,
        "min_temperature": s.min_c, "mode": s.mode, "ready_by": s.ready_by.strftime("%H:%M"),
        "solar_price_cap": s.solar_price_cap, "solar_start": 2400, "house_baseline": 500,
        "sun_priced_setting": s.sun_priced, "sun_surplus_only": False, "sell_other_sun": True, "base_c": s.base_c, "base_temperature": s.base_c,
        "base_by": s.base_by.strftime("%H:%M"), "max_periods": s.max_periods, "energy_adjust": s.energy_adjust_pct,
        "floor_max_price": s.floor_max_price, "energy_auto": True, "energy_learned": -48.7, "energy_in_use": -48.7,
        "energy_samples": 7, "automatic": True, "boost": False, "heater_on": heater_on, "switch_entity": "switch.vvb", "temperature_entity": "sensor.vvb_temp",
        "power_w": 3000, "currency": "SEK", "major_unit": "kr", "minor_unit": "öre", "price_area": "sensor.nordpool_kwh_se4_sek_3_10_025",
        "price_now": cur, "price_error": None, "surplus_w": surplus,
        "prices": [[ms(p.start), round(p.price, 2)] for p in eng.price_slots if day0 - timedelta(minutes=1) < p.start < horizon],
        "heated": [[ms(a), ms(b), c, r] for a, b, c, r in heated], "entities": ENTITIES,
        "plan_status": plan.status, "hybrid_state": plan.hybrid_state, "waiting_for_prices": plan.waiting_for_prices,
        "deadline": ms(plan.deadline), "need_kwh": round(plan.need_kwh, 2), "grid_kwh": round(plan.grid_kwh, 2),
        "solar_kwh": round(plan.solar_kwh, 2), "runtime_min": round(plan.runtime_min),
        "sun_priced": bool(plan.sun_slots) and s.sun_priced, "cost": round(plan.cost_minor / 100, 2),
        "cost_now": round(plan.cost_now_minor / 100, 2), "saving": round(plan.saving_minor / 100, 2),
        "periods": [{"s": ms(p.start), "e": ms(p.end), "kwh": round(p.kwh, 2)} for p in plan.periods],
        "solar_hours": [{"s": ms(h.start), "e": ms(h.end), "kwh": round(h.kwh, 2)} for h in plan.solar_hours],
        "last_heating_kwh": None,
        "usage": {
            "day": {"kwh": 5.8, "kwh_source": "sensor", "cost": 6.9, "solar_kwh": 1.6, "since": "2026-09-23", "complete": True},
            "week": {"kwh": 21.4, "kwh_source": "sensor", "cost": 24.3, "solar_kwh": 7.2, "since": "2026-09-21", "complete": True},
            "month": {"kwh": 88.0, "kwh_source": "sensor", "cost": 96.7, "solar_kwh": 31.5, "since": "2026-09-01", "complete": True},
        },
    }
    if last:
        start, end, kwh, cost, solar = last
        attrs.update(last_heating_kwh=kwh, last_heating_cost=cost, last_heating_solar_kwh=solar,
                     last_heating_start=ms(start), last_heating_end=ms(end), last_heating_running=False)
    return {"now": now.isoformat(), "state": status, "attrs": attrs}


def build_scenarios(cap_for_sun: float) -> dict[str, dict]:
    return {
        "cheapest": scenario(
            local(22, 21, 35), 41.5, "waiting_cheap", False, None,
            [(local(22, 6, 15), local(22, 7, 5), 0, "heating_grid")], (local(22, 6, 15), local(22, 7, 5), 3.4, 5.12, 0.0),
            mode="cheapest", ready_by=time(7, 0),
        ),
        "solar": scenario(
            local(23, 12, 10), 52.3, "heating_sun_slot", True, -1200.0,
            [(local(23, 3, 5), local(23, 3, 50), 0, "heating_base"), (local(23, 11, 30), local(23, 12, 10), 1, "heating_sun_slot")],
            (local(23, 3, 5), local(23, 3, 50), 1.1, 1.58, 0.0),
            mode="solar", ready_by=time(18, 0), solar_price_cap=cap_for_sun, base_c=30, base_by=time(7, 0),
        ),
        "hybrid": scenario(
            local(23, 6, 0), 48.0, "waiting_sun", False, 0.0,
            [], (local(22, 18, 20), local(22, 19, 5), 2.2, 3.74, 0.0),
            mode="hybrid", ready_by=time(18, 0),
        ),
    }


def main() -> None:
    from playwright.sync_api import sync_playwright

    slots = price_slots()
    sun = sorted(p.price for p in slots if p.start >= local(23, 9) and p.start < local(23, 17))
    cap = round(sun[len(sun) // 3] / 5) * 5
    scen = build_scenarios(cap)
    html = (Path(tempfile.mkdtemp()) / "harness.html")
    html.write_text(f"""<!doctype html><html><head><meta charset="utf-8"><style>
:root{{--primary-text-color:#e6e6e6;--secondary-text-color:#9aa0a6;--card-background-color:#1c1f24;--primary-background-color:#111316;--error-color:#e5534b;color-scheme:dark}}
body.light{{--primary-text-color:#1b1e22;--secondary-text-color:#5f6670;--card-background-color:#fff;--primary-background-color:#eceff2;color-scheme:light}}
body{{margin:0;padding:16px;background:var(--primary-background-color);color:var(--primary-text-color);font-family:Roboto,system-ui,sans-serif;width:440px}}
#box{{display:block;background:var(--card-background-color);border-radius:12px;color:var(--primary-text-color);padding:16px}}
</style></head><body><div id="box"><waterheater-planner-card id="c"></waterheater-planner-card></div>
<script src="{CARD.as_uri()}"></script></body></html>""")
    OUT.mkdir(parents=True, exist_ok=True)
    shots = [  # file, scenario, theme, settings
        ("overview-cheapest", "cheapest", "dark", "collapsed"),
        ("overview-solar", "solar", "dark", "collapsed"),
        ("overview-hybrid", "hybrid", "light", "collapsed"),
        ("settings-solar", "solar", "light", "open"),
        ("settings-cheapest", "cheapest", "dark", "open"),
        ("usage", "solar", "dark", "collapsed"),
    ]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for lang in ("en", "sv"):
            (OUT / lang).mkdir(exist_ok=True)
            for name, key, theme, settings in shots:
                sc = scen[key]
                page = browser.new_page(viewport={"width": 472, "height": 900}, device_scale_factor=2, locale=lang, timezone_id="Europe/Stockholm")
                page.clock.install(time=datetime.fromisoformat(sc["now"]))
                page.goto(html.as_uri())
                page.evaluate("t => document.body.classList.toggle('light', t === 'light')", theme)
                page.evaluate("""([sc, lang, settings]) => {
                  const el = document.getElementById('c');
                  const hass = { states: { 'sensor.vvb_status': { entity_id: 'sensor.vvb_status', state: sc.state, last_updated: 'x', attributes: sc.attrs } },
                    language: lang, locale: { language: lang }, config: { time_zone: 'Europe/Stockholm' }, callService: () => Promise.resolve() };
                  el.setConfig({ entity: 'sensor.vvb_status', name: lang === 'sv' ? 'Varmvatten' : 'Hot water', settings });
                  el.hass = hass;
                }""", [sc, lang, settings])
                page.wait_for_timeout(500)
                if name == "usage":
                    page.evaluate("document.getElementById('c').shadowRoot.querySelector('[data-action=usage]').click()")
                    page.wait_for_timeout(300)
                page.locator("#box").screenshot(path=str(OUT / lang / f"{name}.png"))
                page.close()
        browser.close()
    print("sunhour price cap used:", cap, "öre")


if __name__ == "__main__":
    main()
