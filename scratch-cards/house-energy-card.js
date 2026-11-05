/*
 * House energy card
 *
 * One file, no build step. Put it in /config/www/house-energy-card.js and add it as a dashboard
 * resource (/local/house-energy-card.js?v=1, JavaScript module). Same look as the go-e, EV6,
 * wood stove and pump cards: header with icon box and status chip, boxed stats at the bottom.
 *
 * The middle is a drawn isometric house (SVG, no images): solar panels on the roof that light up
 * with production, the grid wire with a flow that runs in (buying) or out (selling), the car on the
 * driveway with the charger cable, and the outdoor unit of the air heat pump with a spinning fan.
 * Night/day follows sun.sun and the sky follows the weather entity (clouds, rain, snow).
 *
 *   type: custom:house-energy-card
 *   name: Huset                                         # optional
 *   # every entity below has Patrik's entity as default, override any of them
 *   pv_power: sensor.growatt_tl_x_xh_tl3_xh_pv_power     # W
 *   grid_power: sensor.growatt_tl_x_xh_tl3_xh_grid_power # W, + = buying, - = selling
 *   load_power: sensor.growatt_tl_x_xh_tl3_xh_load_power # W, the whole house
 *   pv_today / grid_in_today / grid_out_today / load_today   # kWh today
 *   grid_in_cost_today / grid_out_comp_today            # SEK today
 *   pv_forecast_today: sensor.solcast_pv_forecast_forecast_today
 *   price: sensor.nordpool_kwh_se3_sek_3_10_025         # SEK/kWh now
 *   charger_power: sensor.go_echarger_404702_power_total
 *   charger_status: sensor.goe_404702_car_value          # Idle | Charging | Wait for car | Complete | Error
 *   charger_session: sensor.goe_404702_wh                # kWh this session
 *   car_soc: sensor.ev6_laddningsniva_soc   car_range: sensor.ev6_ev_range   car_target: sensor.ev6_malladdningsniva
 *   heatpump: climate.daikinap97060_room_temperature
 *   heatpump_power: sensor.shellypmminig3_48f6eeb4a5d4_effekt
 *   heatpump_today: sensor.daikinap97060_climatecontrol_daglig_energiforbrukning_for_varme
 *   room_temp: sensor.daikinap97060_climatecontrol_rumstemperatur
 *   outdoor_temp: sensor.daikinap97060_climatecontrol_utomhustemperatur
 *   weather: weather.smhi_home
 *   sun: sun.sun
 *   pv_peak: 10000          # W where the panels glow at full strength
 *   heatpump_on_w: 20       # W above which the fan spins
 *   car_color: "#c8102e"
 *   tap_car / tap_charger / tap_heatpump / tap_solar / tap_grid: "#path"   # optional navigation instead of more-info
 *   show_header: true      # false hides the top row (name, price, buy/sell chip)
 *   show_stats: true       # false hides the "Sol idag / Köpt / Sålt / Förbrukat" boxes
 *   secondary_text: theme | bright | primary
 */

const HE_VERSION = "0.4.4";

const HE_DEFAULTS = {
  pv_power: "sensor.growatt_tl_x_xh_tl3_xh_pv_power",
  grid_power: "sensor.growatt_tl_x_xh_tl3_xh_grid_power",
  load_power: "sensor.growatt_tl_x_xh_tl3_xh_load_power",
  pv_today: "sensor.growatt_tl_x_xh_tl3_xh_pv_energy_today",
  grid_in_today: "sensor.growatt_tl_x_xh_tl3_xh_grid_energy_in_today",
  grid_out_today: "sensor.growatt_tl_x_xh_tl3_xh_grid_energy_out_today",
  load_today: "sensor.growatt_tl_x_xh_tl3_xh_load_energy_today",
  grid_in_cost_today: "sensor.growatt_tl_x_xh_tl3_xh_grid_energy_in_cost_daily",
  grid_out_comp_today: "sensor.growatt_tl_x_xh_tl3_xh_grid_energy_out_compensation_daily",
  pv_forecast_today: "sensor.solcast_pv_forecast_forecast_today",
  price: "sensor.nordpool_kwh_se3_sek_3_10_025",
  charger_power: "sensor.go_echarger_404702_power_total",
  charger_status: "sensor.goe_404702_car_value",
  charger_session: "sensor.goe_404702_wh",
  car_soc: "sensor.ev6_laddningsniva_soc",
  car_range: "sensor.ev6_ev_range",
  car_target: "sensor.ev6_malladdningsniva",
  heatpump: "climate.daikinap97060_room_temperature",
  heatpump_power: "sensor.shellypmminig3_48f6eeb4a5d4_effekt",
  heatpump_today: "sensor.daikinap97060_climatecontrol_daglig_energiforbrukning_for_varme",
  room_temp: "sensor.daikinap97060_climatecontrol_rumstemperatur",
  outdoor_temp: "sensor.daikinap97060_climatecontrol_utomhustemperatur",
  weather: "weather.smhi_home",
  sun: "sun.sun",
};
const HE_ENTITY_KEYS = Object.keys(HE_DEFAULTS);

const HE_HVAC = { heat: "Värme", cool: "Kyla", fan_only: "Fläkt", dry: "Avfuktning", heat_cool: "Auto", auto: "Auto", off: "Av" };

/* ---------- isometric helpers (1 unit = 1 m, 10 px per m) ---------- */
const S = 10, C30 = 0.8660254, DY = 0.42; // DY < 0.5 = a little lower camera, so walls show more
const P = (x, y, z = 0) => [(x - y) * C30 * S, (x + y) * DY * S - z * S];
const pts = (list) => list.map((p) => P(...p).map((n) => n.toFixed(1)).join(",")).join(" ");
const poly = (list, cls, extra = "") => `<polygon class="${cls}" points="${pts(list)}" ${extra}/>`;
// box faces: top, +y face (left on screen), +x face (right on screen)
const box = (x0, y0, z0, x1, y1, z1, cls) =>
  poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], `${cls} l`) +
  poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], `${cls} r`) +
  poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], `${cls} t`);
// matrix that maps a flat 2D drawing (u right, v up, metres) onto a wall plane
const planeY = (x, y, z) => { const [ex, ey] = P(x, y, z); return `matrix(${(C30 * S).toFixed(3)},${(DY * S).toFixed(3)},0,${-S},${ex.toFixed(2)},${ey.toFixed(2)})`; };
const planeX = (x, y, z) => { const [ex, ey] = P(x, y, z); return `matrix(${(-C30 * S).toFixed(3)},${(DY * S).toFixed(3)},0,${-S},${ex.toFixed(2)},${ey.toFixed(2)})`; };
const winY = (y, x0, x1, z0, z1, cls = "win") => poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], cls);
const winX = (x, y0, y1, z0, z1, cls = "win") => poly([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], cls);

// scene geometry
const H = { x0: 0, x1: 13, y0: 0, y1: 8, wall: 2.8, ridgeY: 4, ridge: 4.7, ov: 0.45 };
const PORCH = { x0: 2.7, depth: 1.3, low: 2.6 };
const SUN = { x0: -3.0, x1: 0, yb: 4.4, front: 8, h: 2.3, base: 0.45 };
const G = { x0: 13, x1: 20.6, y0: 8, y1: 14.8, wall: 2.9, ridgeX: 16.8, ridge: 3.75, ov: 0.35 };
const CAR = { x: 14.05, y: 16.0, w: 1.9, l: 4.7 };
const HP = { x0: 13.05, x1: 13.5, y0: 0.6, y1: 1.7, z0: 0.18, z1: 0.92 };
const POLE = { x: -5.6, y: 14.2, h: 7 };
const GOE = { x0: 16.55, x1: 17.05, z0: 1.0, z1: 1.75 };
const GROUND = { x0: -7, y0: -1.5, x1: 23, y1: 22.3 };
const VB = { x: -262, y: -116, w: 478, h: 322 };
// pill positions (bottom centre, scene units)
const PILLS = { solar: [52, -62], grid: [-178, -58], house: [-150, 122], hp: [150, 22], car: [80, 192] };
const roofPt = (u, t) => [u, H.y1 + H.ov - t * (H.y1 + H.ov - H.ridgeY), H.wall + t * (H.ridge - H.wall)];

function heFmtW(w) {
  if (w == null || isNaN(w)) return "–";
  const a = Math.abs(w);
  if (a < 1000) return `${Math.round(a)} W`;
  return `${(a / 1000).toLocaleString("sv-SE", { minimumFractionDigits: a < 10000 ? 2 : 1, maximumFractionDigits: a < 10000 ? 2 : 1 })} kW`;
}
const heNum = (v, d = 1) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d }));

class HouseEnergyCard extends HTMLElement {
  static getConfigForm() {
    const e = (name, domain) => ({ name, selector: { entity: domain ? { domain } : {} } });
    return {
      schema: [
        { name: "name", selector: { text: {} } },
        { type: "grid", name: "", schema: [{ name: "show_header", selector: { boolean: {} } }, { name: "show_stats", selector: { boolean: {} } }] },
        { type: "expandable", name: "", title: "Sol och nät", schema: ["pv_power", "grid_power", "load_power", "pv_today", "grid_in_today", "grid_out_today", "load_today", "grid_in_cost_today", "grid_out_comp_today", "pv_forecast_today", "price"].map((k) => e(k, "sensor")) },
        { type: "expandable", name: "", title: "Bil och laddbox", schema: ["charger_power", "charger_status", "charger_session", "car_soc", "car_range", "car_target"].map((k) => e(k, "sensor")) },
        { type: "expandable", name: "", title: "Värmepump", schema: [e("heatpump", "climate"), ...["heatpump_power", "heatpump_today", "room_temp", "outdoor_temp"].map((k) => e(k, "sensor"))] },
        { type: "expandable", name: "", title: "Himmel och utseende", schema: [e("weather", "weather"), e("sun", "sun"),
          { name: "pv_peak", selector: { number: { min: 1000, max: 30000, step: 500, unit_of_measurement: "W" } } },
          { name: "car_color", selector: { text: {} } },
          { name: "secondary_text", selector: { select: { options: ["theme", "bright", "primary"] } } }] },
      ],
    };
  }
  static getStubConfig() { return { name: "Huset" }; }

  setConfig(config) {
    this._cfg = { name: "Huset", pv_peak: 10000, heatpump_on_w: 20, car_color: "#c8102e", secondary_text: "theme", show_header: true, show_stats: true, ...HE_DEFAULTS, ...config };
    this._sceneKey = null;
    if (this._hass) this._render();
  }
  set hass(h) { this._hass = h; this._render(); }
  getCardSize() { return 7; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  _st(key) { const id = this._cfg[key]; return id && this._hass ? this._hass.states[id] : undefined; }
  _n(key) { const s = this._st(key); if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; }

  _data() {
    const c = this._cfg;
    const pv = Math.max(0, this._n("pv_power") ?? 0);
    const grid = this._n("grid_power") ?? 0;
    const load = this._n("load_power") ?? Math.max(0, pv + grid);
    const sun = this._st("sun");
    const night = sun ? sun.state === "below_horizon" : (new Date().getHours() < 7 || new Date().getHours() > 17);
    const wx = this._st("weather")?.state || "";
    const sky = /rain|pouring|lightning/.test(wx) ? "rain" : /snow/.test(wx) ? "snow" : /fog/.test(wx) ? "fog" : /cloudy/.test(wx) ? (wx === "partlycloudy" ? "partly" : "cloudy") : "clear";
    const chStatus = this._st("charger_status")?.state || "";
    const chPower = Math.max(0, this._n("charger_power") ?? 0);
    const charging = chPower > 100 || chStatus === "Charging";
    const plugged = charging || ["Wait for car", "Complete", "Charging"].includes(chStatus);
    const hp = this._st("heatpump");
    const hpPower = this._n("heatpump_power");
    const hpMode = hp ? hp.state : "off";
    const hpOn = hpPower != null ? hpPower > c.heatpump_on_w : hpMode !== "off";
    const flow = grid > 30 ? "import" : grid < -30 ? "export" : "idle";
    const speed = (w) => (w > 5000 ? 3 : w > 1500 ? 2 : 1);
    return {
      pv, grid, load, night, sky, wx, flow, charging, plugged, chStatus, chPower, hpOn, hpMode, hpPower,
      pvLevel: Math.min(1, pv / c.pv_peak),
      gridSpeed: speed(Math.abs(grid)), carSpeed: speed(chPower),
      soc: this._n("car_soc"), range: this._n("car_range"), target: this._n("car_target"), session: this._n("charger_session"),
      room: this._n("room_temp") ?? hp?.attributes?.current_temperature, outdoor: this._n("outdoor_temp"),
      setpoint: hp?.attributes?.temperature,
      pvToday: this._n("pv_today"), inToday: this._n("grid_in_today"), outToday: this._n("grid_out_today"), loadToday: this._n("load_today"),
      inCost: this._n("grid_in_cost_today"), outComp: this._n("grid_out_comp_today"), forecast: this._n("pv_forecast_today"),
      price: this._n("price"), hpToday: this._n("heatpump_today"),
    };
  }

  _render() {
    if (!this._cfg || !this._hass) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>${HE_CSS}</style><ha-card><div class="wrap"></div></ha-card>`;
      this.shadowRoot.addEventListener("click", (ev) => {
        const t = ev.target.closest("[data-tap]");
        if (t) this._tap(t.dataset.tap);
      });
    }
    const d = this._data();
    const card = this.shadowRoot.querySelector("ha-card");
    card.className = `txt-${this._cfg.secondary_text}${this._cfg.show_header === false ? " no-head" : ""}${this._cfg.show_stats === false ? " no-stats" : ""}`;
    const key = JSON.stringify([d.night, d.sky, d.flow, d.gridSpeed, d.charging, d.carSpeed, d.plugged, d.hpOn, d.pv > 20, Math.round(d.pvLevel * 10), this._cfg.car_color]);
    const wrap = this.shadowRoot.querySelector(".wrap");
    if (key !== this._sceneKey) {
      // keep the height while swapping content (iOS scroll lesson from the EV6 card)
      const h = wrap.offsetHeight; if (h) wrap.style.minHeight = `${h}px`;
      wrap.innerHTML = this._html(d);
      this._sceneKey = key;
      requestAnimationFrame(() => requestAnimationFrame(() => { wrap.style.minHeight = ""; }));
    }
    this._fill(d);
  }

  _tap(key) {
    const nav = this._cfg[`tap_${key}`];
    if (nav) { history.pushState(null, "", nav); window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } })); return; }
    const map = { solar: "pv_power", grid: "grid_power", house: "load_power", car: "car_soc", charger: "charger_power", heatpump: "heatpump", in: "grid_in_today", out: "grid_out_today", pvday: "pv_today", load: "load_today" };
    const id = this._cfg[map[key] || key];
    if (id) this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: id } }));
  }

  /* text that changes every few seconds, without rebuilding the drawing */
  _set(sel, txt) { const el = this.shadowRoot.querySelector(sel); if (el && el.textContent !== txt) el.textContent = txt; }
  _fill(d) {
    const sub = [];
    if (d.price != null) sub.push(`${heNum(d.price, 2)} kr/kWh nu`);
    if (d.outdoor != null) sub.push(`${heNum(d.outdoor, 1)} °C ute`);
    this._set(".hsub", sub.join(" · "));
    this._set(".chip .t", d.flow === "import" ? `Köper ${heFmtW(d.grid)}` : d.flow === "export" ? `Säljer ${heFmtW(d.grid)}` : "I balans");
    const self = d.loadToday ? Math.max(0, Math.min(100, ((d.pvToday ?? 0) - (d.outToday ?? 0)) / d.loadToday * 100)) : null;
    this._set(".self b", self == null ? "–" : `${Math.round(self)} %`);
    this._set(".p-solar b", heFmtW(d.pv));
    this._set(".p-solar span", d.pv > 20 ? "Sol" : d.night ? "Sol · natt" : "Sol · vila");
    this._set(".p-grid b", heFmtW(d.grid));
    this._set(".p-grid span", d.flow === "import" ? "Köper" : d.flow === "export" ? "Säljer" : "Nät");
    this._set(".p-house b", heFmtW(d.load));
    this._set(".p-house span", "Förbrukning");
    this._set(".p-car b", d.charging ? heFmtW(d.chPower) : d.soc != null ? `${Math.round(d.soc)} %` : "–");
    const carSub = d.charging ? `Laddar · ${d.soc != null ? Math.round(d.soc) + " %" : ""}` :
      d.chStatus === "Complete" ? "Laddad" : d.plugged ? "Ansluten" : d.range != null ? `${Math.round(d.range)} km` : "EV6";
    this._set(".p-car span", carSub);
    this._set(".p-hp b", d.hpPower != null ? heFmtW(d.hpPower) : HE_HVAC[d.hpMode] || d.hpMode);
    this._set(".p-hp span", `${HE_HVAC[d.hpMode] || d.hpMode}${d.room != null ? " · " + heNum(d.room, 1) + " °C" : ""}`);

    this._set(".s-pv b", d.pvToday != null ? `${heNum(d.pvToday)} kWh` : "–");
    this._set(".s-pv .x", d.forecast != null ? `prognos ${heNum(d.forecast)} kWh` : "");
    this._set(".s-in b", d.inToday != null ? `${heNum(d.inToday)} kWh` : "–");
    this._set(".s-in .x", d.inCost != null ? `${heNum(d.inCost, 2)} kr` : "");
    this._set(".s-out b", d.outToday != null ? `${heNum(d.outToday)} kWh` : "–");
    this._set(".s-out .x", d.outComp != null ? `+${heNum(d.outComp, 2)} kr` : "");
    this._set(".s-load b", d.loadToday != null ? `${heNum(d.loadToday)} kWh` : "–");
    this._set(".s-load .x", d.hpToday != null ? `värmepump ${heNum(d.hpToday)} kWh` : "");
    const max = Math.max(d.pvToday || 0, d.inToday || 0, d.outToday || 0, d.loadToday || 0, 0.1);
    for (const [k, v] of [["pv", d.pvToday], ["in", d.inToday], ["out", d.outToday], ["load", d.loadToday]]) {
      const bar = this.shadowRoot.querySelector(`.s-${k} .bar i`);
      if (bar) bar.style.width = `${Math.max(2, (v || 0) / max * 100)}%`;
    }
  }

  _html(d) {
    const c = this._cfg;
    const pct = (x, y) => `left:${((x - VB.x) / VB.w * 100).toFixed(2)}%;top:${((y - VB.y) / VB.h * 100).toFixed(2)}%`;
    const pill = (cls, tap, icon, pos, state = "") =>
      `<button class="pill ${cls} ${state}" data-tap="${tap}" style="${pct(...pos)}"><ha-icon icon="${icon}"></ha-icon><div><b></b><span></span></div></button>`;
    const chipCls = d.flow === "export" ? "ok" : d.flow === "import" ? "on" : "";
    const head = this._cfg.show_header === false ? "" : `
      <div class="head">
        <div class="ibox ${d.pv > 20 ? "sun" : ""}"><ha-icon icon="mdi:home-lightning-bolt-outline"></ha-icon></div>
        <div class="hmain"><div class="name">${c.name}</div><div class="hsub"></div></div>
        <div class="hright">
          <div class="chip ${chipCls}"><span class="t"></span></div>
          <div class="self" title="Andel av dagens förbrukning som kom från solen"><ha-icon icon="mdi:leaf"></ha-icon><b></b><span>egen el idag</span></div>
        </div>
      </div>`;
    const stats = this._cfg.show_stats === false ? "" : `
      <div class="stats">
        ${[["pv", "pvday", "mdi:solar-power-variant", "Sol idag"], ["in", "in", "mdi:transmission-tower-import", "Köpt"], ["out", "out", "mdi:transmission-tower-export", "Sålt"], ["load", "load", "mdi:home-lightning-bolt-outline", "Förbrukat"]]
          .map(([k, tap, icon, label]) => `<button class="stat s-${k}" data-tap="${tap}"><span class="l"><ha-icon icon="${icon}"></ha-icon>${label}</span><b></b><span class="x"></span><span class="bar"><i></i></span></button>`).join("")}
      </div>`;
    return `${head}
      <div class="scene ${d.night ? "night" : "day"} sky-${d.sky}">
        ${this._svg(d)}
        ${pill("p-solar", "solar", "mdi:solar-power-variant", PILLS.solar, d.pv > 20 ? "sun" : "dim")}
        ${pill("p-grid", "grid", "mdi:transmission-tower", PILLS.grid, d.flow)}
        ${pill("p-house", "house", "mdi:home-lightning-bolt", PILLS.house, "house")}
        ${pill("p-hp", "heatpump", d.hpMode === "cool" ? "mdi:snowflake" : d.hpMode === "heat" ? "mdi:heat-pump-outline" : "mdi:fan", PILLS.hp, d.hpOn ? "hp" : "dim")}
        ${pill("p-car", "car", d.charging ? "mdi:ev-station" : "mdi:car-electric", PILLS.car, d.charging ? "car" : d.plugged ? "car idle" : "dim")}
      </div>${stats}`;
  }

  _svg(d) {
    const c = this._cfg;
    const t0 = -(Date.now() % 60000) / 1000; // shared phase so a rebuild does not restart animations visibly
    const anim = `style="animation-delay:${t0.toFixed(2)}s"`;
    const out = [];
    out.push(`<svg viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="he-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sky0"/><stop offset="1" class="sky1"/></linearGradient>
        <linearGradient id="he-panel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c4f86"/><stop offset=".55" stop-color="#1b3361"/><stop offset="1" stop-color="#132447"/></linearGradient>
        <linearGradient id="he-panel-day" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f6bb0"/><stop offset=".5" stop-color="#244a8a"/><stop offset="1" stop-color="#1a3566"/></linearGradient>
        <linearGradient id="he-glint" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#ffe7a8" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <radialGradient id="he-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffc46b" stop-opacity=".55"/><stop offset="1" stop-color="#ffc46b" stop-opacity="0"/></radialGradient>
        <radialGradient id="he-moon" cx=".4" cy=".4" r=".6"><stop offset="0" stop-color="#fffbe9"/><stop offset="1" stop-color="#d9d3bd"/></radialGradient>
        <filter id="he-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
        <filter id="he-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
        <clipPath id="he-panels">${this._panels(true)}</clipPath>
      </defs>
      <rect class="skybg" x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}" fill="url(#he-sky)"/>`);
    // sky: stars, moon or sun, clouds, rain
    if (d.night && (d.sky === "clear" || d.sky === "partly")) {
      let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < 38; i++) out.push(`<circle class="star" cx="${(VB.x + rnd() * VB.w).toFixed(1)}" cy="${(VB.y + rnd() * 120).toFixed(1)}" r="${(0.4 + rnd() * 0.8).toFixed(2)}" style="animation-delay:${(-rnd() * 4).toFixed(2)}s"/>`);
    }
    if (d.sky !== "rain" && d.sky !== "fog" && d.sky !== "cloudy" && d.sky !== "snow")
      out.push(d.night ? `<circle cx="${VB.x + VB.w - 48}" cy="${VB.y + 34}" r="11" fill="url(#he-moon)"/><circle cx="${VB.x + VB.w - 48}" cy="${VB.y + 34}" r="22" fill="#fffbe9" opacity=".08"/>`
        : `<circle cx="${VB.x + VB.w - 48}" cy="${VB.y + 34}" r="26" fill="#ffd36e" opacity=".18" filter="url(#he-blur)"/><circle cx="${VB.x + VB.w - 48}" cy="${VB.y + 34}" r="12" fill="#ffd36e"/>`);
    if (d.sky !== "clear") {
      const n = d.sky === "partly" ? 3 : 5;
      const xs = [-170, -50, 60, 150, -110], ys = [-100, -112, -90, -110, -80];
      for (let i = 0; i < n; i++) out.push(`<g class="cloud" style="animation-delay:${(t0 - i * 9).toFixed(1)}s"><ellipse cx="${xs[i]}" cy="${ys[i]}" rx="${30 + i * 4}" ry="9" filter="url(#he-blur)"/></g>`);
    }
    // ground slab
    const g0 = [GROUND.x0, GROUND.y0], g1 = [GROUND.x1, GROUND.y1];
    out.push(poly([[g0[0], g1[1], -0.7], [g1[0], g1[1], -0.7], [g1[0], g1[1], 0], [g0[0], g1[1], 0]], "slab l"));
    out.push(poly([[g1[0], g0[1], -0.7], [g1[0], g1[1], -0.7], [g1[0], g1[1], 0], [g1[0], g0[1], 0]], "slab r"));
    out.push(poly([[g0[0], g0[1], 0], [g1[0], g0[1], 0], [g1[0], g1[1], 0], [g0[0], g1[1], 0]], "lawn"));
    out.push(poly([[G.x0 - 0.3, G.y1, 0.01], [G.x1 + 0.6, G.y1, 0.01], [G.x1 + 0.6, g1[1], 0.01], [G.x0 - 0.3, g1[1], 0.01]], "drive"));
    out.push(poly([[PORCH.x0, H.y1, 0.01], [H.x1, H.y1, 0.01], [H.x1, H.y1 + PORCH.depth, 0.01], [PORCH.x0, H.y1 + PORCH.depth, 0.01]], "drive path"));
    // straight, diagonal footpath from the front door to the driveway
    { const a = [3.8, H.y1 + PORCH.depth - 0.2], b = [G.x0 + 0.2, 16.8], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L * 0.6, ny = dx / L * 0.6;
      out.push(poly([[a[0] + nx, a[1] + ny, 0.01], [a[0] - nx, a[1] - ny, 0.01], [b[0] - nx, b[1] - ny, 0.01], [b[0] + nx, b[1] + ny, 0.01]], "drive path")); }
    out.push(box(GROUND.x0 + 0.3, GROUND.y0 + 0.2, 0, GROUND.x1 - 0.5, GROUND.y0 + 0.8, 0.7, "hedge"));
    // warm light pools on the ground at night
    if (d.night) out.push(`<ellipse cx="${P(9, 10.6)[0]}" cy="${P(9, 10.6)[1]}" rx="46" ry="14" fill="url(#he-glow)" opacity=".7"/>`);

    // grid pole (behind the house in depth order is not needed, it stands to the left)
    const pb = P(POLE.x, POLE.y, 0), pt = P(POLE.x, POLE.y, POLE.h);
    out.push(`<line class="pole" x1="${pb[0]}" y1="${pb[1]}" x2="${pt[0]}" y2="${pt[1]}"/>`);
    const arm = [P(POLE.x - 1.2, POLE.y + 1.2, POLE.h - 0.4), P(POLE.x + 1.2, POLE.y - 1.2, POLE.h - 0.4)];
    out.push(`<line class="pole arm" x1="${arm[0][0]}" y1="${arm[0][1]}" x2="${arm[1][0]}" y2="${arm[1][1]}"/>`);
    const offA = P(POLE.x - 1.2, POLE.y + 1.2, POLE.h - 0.4), offB = [VB.x, P(POLE.x, POLE.y, POLE.h)[1] - 18];
    out.push(`<path class="wire" d="M${offA[0]},${offA[1]} Q${(offA[0] + offB[0]) / 2},${offA[1] + 6} ${offB[0]},${offB[1]}"/>`);

    // house
    out.push(this._sunroom(d, "a"));
    out.push(this._house(d));
    out.push(this._heatpump(d, t0));
    // wire pole -> house (drawn after the house so it sits in front of the wall)
    const wA = P(POLE.x + 1.2, POLE.y - 1.2, POLE.h - 0.4), wB = P(0.5, H.y1, 2.6);
    const wire = `M${wA[0].toFixed(1)},${wA[1].toFixed(1)} Q${((wA[0] + wB[0]) / 2).toFixed(1)},${(Math.max(wA[1], wB[1]) + 10).toFixed(1)} ${wB[0].toFixed(1)},${wB[1].toFixed(1)}`;
    out.push(`<path class="wire" d="${wire}"/>`);
    if (d.flow !== "idle") out.push(`<path class="flow grid ${d.flow} sp${d.gridSpeed}" d="${wire}" ${anim}/><path class="flowglow grid ${d.flow}" d="${wire}"/>`);
    out.push(`<circle class="anchor" cx="${wB[0]}" cy="${wB[1]}" r="1.3"/>`);

    out.push(this._garage(d));
    out.push(this._car(d, anim));

    // leader lines from pills to their objects
    const lead = (from, to, cls = "") => `<line class="lead ${cls}" x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}"/><circle class="leaddot ${cls}" cx="${to[0]}" cy="${to[1]}" r="1.6"/>`;
    const up = ([px, py], dy = 8) => [px, py + dy];
    out.push(lead(up(PILLS.solar, 6), P(...roofPt(9.2, 0.6)), d.pv > 20 ? "sun" : ""));
    out.push(lead(up(PILLS.grid), pt, d.flow));
    out.push(lead([PILLS.house[0], PILLS.house[1] - 26], P(9.8, H.y1 + PORCH.depth - 0.3, 0.4), "house"));
    out.push(lead([PILLS.hp[0] - 30, PILLS.hp[1] - 4], P(HP.x1, HP.y0 + 0.5, HP.z1), d.hpOn ? "hp" : ""));
    out.push(lead(up(PILLS.car, -10), P(CAR.x + CAR.w - 0.2, CAR.y + 1.8, 1.45), d.charging ? "car" : ""));
    out.push(`</svg>`);
    return out.join("");
  }

  _panels(clip) {
    const out = [];
    const cols = 10, rows = 2, u0 = 3.9, u1 = 12.7, t0 = 0.1, t1 = 0.96, gu = 0.06, gt = 0.025;
    const cw = (u1 - u0) / cols, rh = (t1 - t0) / rows;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const a = u0 + k * cw + gu / 2, b = u0 + (k + 1) * cw - gu / 2, s = t0 + r * rh + gt / 2, e = t0 + (r + 1) * rh - gt / 2;
      const q = [roofPt(a, s), roofPt(b, s), roofPt(b, e), roofPt(a, e)];
      out.push(clip ? `<polygon points="${pts(q)}"/>` : poly(q, "panel"));
      if (!clip) {
        // cell lines
        for (let i = 1; i < 3; i++) { const uu = a + (b - a) * i / 3; const p1 = P(...roofPt(uu, s)), p2 = P(...roofPt(uu, e)); out.push(`<line class="cell" x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}"/>`); }
        const mid = (s + e) / 2; const m1 = P(...roofPt(a, mid)), m2 = P(...roofPt(b, mid));
        out.push(`<line class="cell" x1="${m1[0]}" y1="${m1[1]}" x2="${m2[0]}" y2="${m2[1]}"/>`);
      }
    }
    return out.join("");
  }

  /* main house: single storey, low-pitch standing-seam roof, porch with white posts on the right half of the front */
  _house(d) {
    const o = [];
    const { x0, x1, y0, y1, wall, ridgeY, ridge, ov } = H;
    o.push(poly([[x0, y1, 0], [x1, y1, 0], [x1, y1, wall], [x0, y1, wall]], "wall l"));
    o.push(poly([[x1, y0, 0], [x1, y1, 0], [x1, y1, wall], [x1, ridgeY, ridge], [x1, y0, wall]], "wall r"));
    o.push(poly([[x0, y1 + 0.02, 0], [x1, y1 + 0.02, 0], [x1, y1 + 0.02, 0.3], [x0, y1 + 0.02, 0.3]], "plinth l"));
    o.push(poly([[x1 + 0.02, y0, 0], [x1 + 0.02, y1, 0], [x1 + 0.02, y1, 0.3], [x1 + 0.02, y0, 0.3]], "plinth r"));
    for (let x = x0 + 0.4; x < x1; x += 0.4) { const a = P(x, y1, 0.3), b = P(x, y1, wall); o.push(`<line class="board" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`); }
    for (let y = y0 + 0.4; y < y1; y += 0.4) { const zt = y < ridgeY ? wall + (ridge - wall) * (y / ridgeY) : wall + (ridge - wall) * ((y1 - y) / (y1 - ridgeY)); const a = P(x1, y, 0.3), b = P(x1, y, zt); o.push(`<line class="board r" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`); }
    o.push(winY(y1 + 0.01, x1 - 0.15, x1, 0.3, wall, "trim"));
    // porch shade on the wall
    o.push(poly([[PORCH.x0, y1 + 0.005, 0], [x1, y1 + 0.005, 0], [x1, y1 + 0.005, wall], [PORCH.x0, y1 + 0.005, wall]], "porchshade"));
    const lit = d.night ? "win lit" : "win";
    // white-framed windows with sashes, like the photo: pairs and a three-light window
    // left window outside the porch, then the front door and the rest under the porch
    o.push(this._window("y", y1, 0.7, 2.2, 0.75, 2.25, 2, lit));
    o.push(winY(y1, 3.3, 4.3, 0.0, 2.25, "door glassdoor" + (d.night ? " lit" : "")));
    o.push(this._mullion(y1, 3.3, 4.3, 0.0, 2.25));
    o.push(this._window("y", y1, 5.1, 6.1, 0.75, 2.25, 2, lit));
    o.push(this._window("y", y1, 7.1, 8.7, 0.75, 2.25, 2, lit));
    o.push(this._window("y", y1, 9.8, 11.4, 0.75, 2.25, 2, lit));
    // gable end
    // roof
    o.push(poly([[x0 - ov, ridgeY, ridge], [x1 + ov, ridgeY, ridge], [x1 + ov, y0 - ov, wall], [x0 - ov, y0 - ov, wall]], "roof b"));
    o.push(poly([[x0 - ov, y1 + ov, wall], [x1 + ov, y1 + ov, wall], [x1 + ov, ridgeY, ridge], [x0 - ov, ridgeY, ridge]], "roof f"));
    for (let u = x0; u <= x1 + 0.01; u += 0.45) { const a = P(...roofPt(u, 0)), b = P(...roofPt(u, 1)); o.push(`<line class="seam" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`); }
    o.push(poly([[x1 + ov, y1 + ov, wall], [x1 + ov, ridgeY, ridge], [x1 + ov, ridgeY, ridge - 0.2], [x1 + ov, y1 + ov, wall - 0.2]], "fascia"));
    o.push(poly([[x1 + ov, ridgeY, ridge], [x1 + ov, y0 - ov, wall], [x1 + ov, y0 - ov, wall - 0.2], [x1 + ov, ridgeY, ridge - 0.2]], "fascia"));
    o.push(poly([[x0 - ov, y1 + ov, wall], [x1 + ov, y1 + ov, wall], [x1 + ov, y1 + ov, wall - 0.18], [x0 - ov, y1 + ov, wall - 0.18]], "fascia l"));
    // chimney left of the panels
    o.push(box(2.6, 4.5, 3.9, 3.3, 5.2, 5.6, "chim"));
    o.push(box(2.5, 4.4, 5.6, 3.4, 5.3, 5.75, "chimcap"));
    o.push(this._panels(false));
    if (d.pv > 20) {
      o.push(`<g clip-path="url(#he-panels)"><rect class="pvglow" x="-140" y="-60" width="260" height="120" style="opacity:${(0.03 + 0.1 * d.pvLevel).toFixed(2)}"/>
        <rect class="glint" x="-160" y="-70" width="40" height="150" fill="url(#he-glint)" transform="skewX(-20)"/></g>`);
    }
    // porch roof (lower pitch, continues out from the eave) on white posts
    const { x0: px0, depth, low } = PORCH, py = y1 + ov;
    o.push(poly([[px0, py, wall], [x1 + ov, py, wall], [x1 + ov, y1 + depth, low], [px0, y1 + depth, low]], "roof f porch"));
    for (let u = px0; u <= x1 + ov; u += 0.45) { const a = P(u, py, wall), b = P(u, y1 + depth, low); o.push(`<line class="seam" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`); }
    o.push(poly([[px0, y1 + depth, low], [x1 + ov, y1 + depth, low], [x1 + ov, y1 + depth, low - 0.2], [px0, y1 + depth, low - 0.2]], "fascia l"));
    o.push(poly([[x1 + ov, py, wall], [x1 + ov, y1 + depth, low], [x1 + ov, y1 + depth, low - 0.2], [x1 + ov, py, wall - 0.2]], "fascia"));
    o.push(poly([[px0, py, wall], [px0, y1 + depth, low], [px0, y1 + depth, low - 0.2], [px0, py, wall - 0.2]], "fascia"));
    for (const px of [px0 + 0.15, 4.7, 6.6, 9.25, 11.6, x1 + 0.1]) o.push(box(px, y1 + depth - 0.35, 0, px + 0.16, y1 + depth - 0.19, low - 0.2, "post"));
    return o.join("");
  }

  /* window with a white frame and n vertical lights; axis "y" = front wall, "x" = gable */
  _window(axis, at, a, b, z0, z1, n, cls) {
    const o = [axis === "y" ? winY(at, a, b, z0, z1, cls) : winX(at, a, b, z0, z1, cls)];
    const pt = (u, z) => (axis === "y" ? P(u, at, z) : P(at, u, z));
    for (let i = 1; i < n; i++) { const u = a + (b - a) * i / n, p = pt(u, z0), q = pt(u, z1); o.push(`<line class="mull thick" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`); }
    const zm = z0 + (z1 - z0) * 0.3, s = pt(a, zm), e = pt(b, zm);
    o.push(`<line class="mull" x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}"/>`);
    return o.join("");
  }

  /* glazed sunroom (uterum) at the front-left: part A sticks out to the left of the house and is
     drawn before it, part B sits in front of the house wall and is drawn after it */
  _sunroom(d, part) {
    const o = [], { h, base, front } = SUN;
    const [xa, xb, ya] = part === "a" ? [SUN.x0, H.x0, SUN.yb] : [H.x0, SUN.x1, H.y1];
    const glass = d.night ? "sunglass lit" : "sunglass";
    // front face (+y)
    o.push(poly([[xa, front, 0], [xb, front, 0], [xb, front, base], [xa, front, base]], "wall l"));
    o.push(poly([[xa, front, base], [xb, front, base], [xb, front, h], [xa, front, h]], glass));
    for (let x = xa; x <= xb + 0.01; x += 0.95) { const p = P(x, front, base), q = P(x, front, h); o.push(`<line class="sunpost" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`); }
    const t1 = P(xa, front, h - 0.35), t2 = P(xb, front, h - 0.35); o.push(`<line class="mull" x1="${t1[0]}" y1="${t1[1]}" x2="${t2[0]}" y2="${t2[1]}"/>`);
    if (part === "a" && d.night) { const c = P((xa + xb) / 2, front + 0.8, 0); o.push(`<ellipse cx="${c[0]}" cy="${c[1] + 3}" rx="22" ry="7" fill="url(#he-glow)"/>`); }
    if (part === "b") {
      // right face (+x), only the part in front of the house
      o.push(poly([[xb, ya, 0], [xb, front, 0], [xb, front, base], [xb, ya, base]], "wall r"));
      o.push(poly([[xb, ya, base], [xb, front, base], [xb, front, h], [xb, ya, h]], glass + " side"));
      for (let y = ya; y <= front + 0.01; y += 0.95) { const p = P(xb, y, base), q = P(xb, y, h); o.push(`<line class="sunpost" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`); }
      if (d.night) { const c = P((xa + xb) / 2 - 1, (ya + front) / 2, 0); o.push(`<ellipse cx="${c[0]}" cy="${c[1] + 8}" rx="34" ry="11" fill="url(#he-glow)"/>`); }
    }
    // low flat roof with white fascia
    const r = 0.25;
    o.push(poly([[xa - (part === "a" ? r : 0), ya - (part === "a" ? r : 0), h + 0.25], [xb + (part === "b" ? r : 0), ya, h + 0.25], [xb + (part === "b" ? r : 0), front + r, h + 0.1], [xa - (part === "a" ? r : 0), front + r, h + 0.1]], "roof t sunroof"));
    o.push(poly([[xa - (part === "a" ? r : 0), front + r, h + 0.1], [xb + (part === "b" ? r : 0), front + r, h + 0.1], [xb + (part === "b" ? r : 0), front + r, h - 0.08], [xa - (part === "a" ? r : 0), front + r, h - 0.08]], "fascia l"));
    if (part === "b") o.push(poly([[xb + r, ya, h + 0.25], [xb + r, front + r, h + 0.1], [xb + r, front + r, h - 0.08], [xb + r, ya, h + 0.07]], "fascia"));
    return o.join("");
  }

  _mullion(y, a, b, z0, z1) {
    const m = (a + b) / 2; const p = P(m, y, z0), q = P(m, y, z1);
    return `<line class="mull" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`;
  }

  _garage(d) {
    const o = [];
    const { x0, x1, y0, y1, wall, ridgeX, ridge, ov } = G;
    // front gable wall (+y) with the two doors, and the long side (+x)
    o.push(poly([[x0, y1, 0], [x1, y1, 0], [x1, y1, wall], [ridgeX, y1, ridge], [x0, y1, wall]], "wall l"));
    o.push(poly([[x1, y0, 0], [x1, y1, 0], [x1, y1, wall], [x1, y0, wall]], "wall r"));
    o.push(poly([[x0, y1 + 0.02, 0], [x1, y1 + 0.02, 0], [x1, y1 + 0.02, 0.25], [x0, y1 + 0.02, 0.25]], "plinth l"));
    for (let x = x0 + 0.45; x < x1; x += 0.45) {
      const zt = x < ridgeX ? wall + (ridge - wall) * ((x - x0) / (ridgeX - x0)) : wall + (ridge - wall) * ((x1 - x) / (x1 - ridgeX));
      const a = P(x, y1, 0.25), b = P(x, y1, zt); o.push(`<line class="board" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`);
    }
    for (let y = y0 + 0.45; y < y1; y += 0.45) { const a = P(x1, y, 0.25), b = P(x1, y, wall); o.push(`<line class="board r" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`); }
    // double doors
    for (const [a, b] of [[13.55, 16.45], [17.15, 20.05]]) {
      o.push(winY(y1 + 0.01, a - 0.12, b + 0.12, 0, 2.37, "trim"));
      o.push(winY(y1 + 0.02, a, b, 0, 2.25, "gdoor"));
      for (let z = 0.45; z < 2.25; z += 0.45) { const p = P(a, y1 + 0.02, z), q = P(b, y1 + 0.02, z); o.push(`<line class="gline" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`); }
    }
    o.push(winY(y1 + 0.01, ridgeX - 0.45, ridgeX + 0.45, 2.75, 3.45, d.night ? "win lit dimlit" : "win"));
    // roof, ridge along y
    o.push(poly([[x0 - ov, y0 - ov, wall], [x0 - ov, y1 + ov, wall], [ridgeX, y1 + ov, ridge], [ridgeX, y0 - ov, ridge]], "roof b"));
    o.push(poly([[ridgeX, y0 - ov, ridge], [ridgeX, y1 + ov, ridge], [x1 + ov, y1 + ov, wall], [x1 + ov, y0 - ov, wall]], "roof f"));
    // barge boards on the front gable
    o.push(poly([[x0 - ov, y1 + ov, wall], [ridgeX, y1 + ov, ridge], [ridgeX, y1 + ov, ridge - 0.22], [x0 - ov, y1 + ov, wall - 0.22]], "fascia l"));
    o.push(poly([[ridgeX, y1 + ov, ridge], [x1 + ov, y1 + ov, wall], [x1 + ov, y1 + ov, wall - 0.22], [ridgeX, y1 + ov, ridge - 0.22]], "fascia l"));
    o.push(poly([[x1 + ov, y0 - ov, wall], [x1 + ov, y1 + ov, wall], [x1 + ov, y1 + ov, wall - 0.2], [x1 + ov, y0 - ov, wall - 0.2]], "fascia"));
    // go-e wallbox on the front wall between the two doors
    const { x0: gx0, x1: gx1, z0, z1 } = GOE;
    o.push(box(gx0, y1, z0, gx1, y1 + 0.16, z1, "goe"));
    const led = [P((gx0 + gx1) / 2 - 0.15, y1 + 0.17, z1 - 0.2), P((gx0 + gx1) / 2 + 0.15, y1 + 0.17, z1 - 0.2)];
    o.push(`<line class="goeled ${d.charging ? "on" : d.plugged ? "idle" : ""}" x1="${led[0][0]}" y1="${led[0][1]}" x2="${led[1][0]}" y2="${led[1][1]}"/>`);
    if (d.night) { const l = P(16.5, y1 + 0.05, 2.55); o.push(`<circle cx="${l[0]}" cy="${l[1]}" r="1.2" fill="#ffe2a6"/><circle cx="${l[0]}" cy="${l[1] + 6}" r="12" fill="url(#he-glow)"/>`); }
    return o.join("");
  }

  /* outdoor unit on the right gable (+x), near the back corner; front face points +x */
  _heatpump(d, t0) {
    const { x0, x1, y0, y1, z0, z1 } = HP, o = [];
    o.push(box(x0, y0 + 0.1, 0, x1, y0 + 0.2, z0, "foot"));
    o.push(box(x0, y1 - 0.2, 0, x1, y1 - 0.1, z0, "foot"));
    o.push(box(x0, y0, z0, x1, y1, z1, "hpu"));
    const pa = P(x0 + 0.1, y0 + 0.05, z1 - 0.15), pb = P(H.x1, y0 - 0.35, z1 + 0.6);
    o.push(`<path class="pipe" d="M${pa[0]},${pa[1]} L${pb[0]},${pb[1]}"/>`);
    const cx = 0.68, cz = (z1 - z0) / 2;
    const blades = [0, 120, 240].map((a) => `<path d="M0,0 C0.08,0.1 0.22,0.12 0.25,0.02 C0.2,-0.05 0.1,-0.06 0,0Z" transform="rotate(${a})"/>`).join("");
    o.push(`<g transform="${planeX(x1 + 0.01, y0, z0)}">
      <circle cx="${cx}" cy="${cz}" r="0.3" class="grille"/>
      <g transform="translate(${cx} ${cz})"><g class="blades ${d.hpOn ? "spin" : ""}" style="animation-delay:${t0.toFixed(2)}s">${blades}</g></g>
      <circle cx="${cx}" cy="${cz}" r="0.3" class="grillering"/>
      <rect x="0.08" y="0.12" width="0.2" height="0.46" class="hpgrid"/>
      <circle cx="0.18" cy="0.62" r="0.025" class="hpled ${d.hpOn ? "on" : ""}"/>
    </g>`);
    if (d.hpOn && (d.hpMode === "heat" || d.hpMode === "cool")) {
      const w = P(x1 + 0.6, (y0 + y1) / 2, cz + z0);
      o.push(`<g class="breath ${d.hpMode}"><ellipse cx="${w[0] + 5}" cy="${w[1] + 3}" rx="8" ry="3"/></g>`);
    }
    return o.join("");
  }

  /* Kia EV6: low crossover-fastback. Body to the belt line, a narrower glasshouse on top,
     black roof, black wheel arches, the rising silver side garnish and the rear light bar. */
  _car(d, anim) {
    const { x, y, w } = CAR, o = [];
    const col = this._cfg.car_color, cs = `style="--car:${col}"`;
    const X0 = x, X1 = x + w, IN = 0.2;
    const strips = (prof, xa, xb, clsFor) => {
      for (let i = 0; i < prof.length - 1; i++) {
        const [ya, za] = prof[i], [yb, zb] = prof[i + 1];
        if ((zb - za) * -1 + (yb - ya) <= 0) continue; // back-facing
        o.push(poly([[xa, y + ya, za], [xb, y + ya, za], [xb, y + yb, zb], [xa, y + yb, zb]], clsFor(i), cs));
      }
    };
    const c = P(x + w / 2, y + 2.4);
    o.push(`<ellipse cx="${c[0]}" cy="${c[1] + 2}" rx="31" ry="10" class="carshadow" filter="url(#he-soft)"/>`);
    // lower body (rear -> front)
    const prof = [[0.04, 0.38], [0, 0.84], [0.1, 1.0], [0.55, 1.03], [3.4, 1.0], [4.35, 0.86], [4.66, 0.72], [4.72, 0.5], [4.6, 0.36]];
    strips(prof, X0, X1, (i) => (i === 5 ? "car top hood" : i >= 6 ? "car front" : "car top"));
    o.push(poly(prof.map(([py, pz]) => [X1, y + py, pz]), "car side", cs));
    // headlights: thin strips at the outer corners of the nose, joined by a thin line
    const nose = (xa, xb, cls) => poly([[xa, y + 4.62, 0.75], [xb, y + 4.62, 0.75], [xb, y + 4.68, 0.71], [xa, y + 4.68, 0.71]], cls);
    o.push(nose(X0 + 0.04, X0 + 0.5, d.night ? "lamp on" : "lamp"), nose(X1 - 0.5, X1 - 0.04, d.night ? "lamp on" : "lamp"));
    o.push(poly([[X0 + 0.5, y + 4.7, 0.55], [X1 - 0.5, y + 4.7, 0.55], [X1 - 0.5, y + 4.71, 0.5], [X0 + 0.5, y + 4.71, 0.5]], "grillbar"));
    // lower black cladding and arches on the side
    o.push(poly([[X1 + 0.005, y + 0.04, 0.38], [X1 + 0.005, y + 4.6, 0.38], [X1 + 0.005, y + 4.64, 0.5], [X1 + 0.005, y + 0.02, 0.5]], "clad"));
    // silver garnish rising to the rear
    o.push(poly([[X1 + 0.006, y + 1.35, 0.5], [X1 + 0.006, y + 3.3, 0.5], [X1 + 0.006, y + 3.25, 0.56], [X1 + 0.006, y + 1.3, 0.72]], "garnish"));
    // rear light bar wrapping onto the side
    o.push(poly([[X1 + 0.006, y + 0.02, 0.86], [X1 + 0.006, y + 0.5, 0.97], [X1 + 0.006, y + 0.52, 1.0], [X1 + 0.006, y + 0.08, 0.92]], d.night ? "tail on" : "tail"));
    for (const wy of [0.88, 3.85]) {
      const spokes = [0, 72, 144, 216, 288].map((a) => `<rect x="-0.025" y="0.05" width="0.05" height="0.2" transform="rotate(${a})" class="spoke"/>`).join("");
      o.push(`<g transform="${planeX(X1 + 0.01, y + wy, 0.4)}"><circle r="0.4" class="tyre"/><circle r="0.28" class="rim"/>${spokes}<circle r="0.07" class="hub"/></g>`);
    }
    // glasshouse, inset from the body sides
    const cab = [[0.22, 1.03], [0.75, 1.42], [2.35, 1.52], [3.5, 1.0]];
    strips(cab, X0 + IN, X1 - IN, (i) => (i === 1 ? "car top" : "glass"));
    o.push(poly([[X1 - IN, y + 0.22, 1.03], [X1 - IN, y + 0.75, 1.42], [X1 - IN, y + 2.35, 1.52], [X1 - IN, y + 3.5, 1.0]], "car side cab", cs));
    // black C-pillar swoop and B-pillar
    // side windows: one long band with a rising rear edge, red C-pillar left around it
    o.push(poly([[X1 - IN + 0.004, y + 0.62, 1.1], [X1 - IN + 0.004, y + 0.92, 1.38], [X1 - IN + 0.004, y + 2.32, 1.47], [X1 - IN + 0.004, y + 3.36, 1.04], [X1 - IN + 0.004, y + 1.0, 1.04]], "glass sidewin"));
    // rear spoiler lip on the roof
    o.push(poly([[X0 + IN, y + 0.62, 1.44], [X1 - IN, y + 0.62, 1.44], [X1 - IN, y + 0.85, 1.47], [X0 + IN, y + 0.85, 1.47]], "spoiler"));
    o.push(poly([[X1 - IN + 0.006, y + 2.0, 1.04], [X1 - IN + 0.006, y + 2.07, 1.04], [X1 - IN + 0.006, y + 2.09, 1.45], [X1 - IN + 0.006, y + 2.02, 1.45]], "pillar"));
    // mirror
    o.push(box(X1 - 0.02, y + 3.15, 0.98, X1 + 0.16, y + 3.35, 1.1, "car mirror"));
    // the car is drawn 1.25x so it reads at card size; scale around its footprint centre
    const K = 1.25, ctr = P(x + w / 2, y + 2.35);
    const body = o.splice(0).join("");
    o.push(`<g transform="translate(${ctr[0].toFixed(1)} ${ctr[1].toFixed(1)}) scale(${K}) translate(${(-ctr[0]).toFixed(1)} ${(-ctr[1]).toFixed(1)})">${body}</g>`);
    // charge cable: wallbox -> ground -> charge port (rear right)
    if (d.plugged) {
      const a = P((GOE.x0 + GOE.x1) / 2, G.y1 + 0.1, GOE.z0), b = P((GOE.x0 + GOE.x1) / 2 - 0.3, G.y1 + 0.5, 0.05), cR = P(X1, y + 0.6, 0.82), cP = [ctr[0] + K * (cR[0] - ctr[0]), ctr[1] + K * (cR[1] - ctr[1])];
      const path = `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${(b[0] + 4).toFixed(1)},${(b[1] + 2).toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)} T${cP[0].toFixed(1)},${cP[1].toFixed(1)}`;
      o.push(`<path class="cable" d="${path}"/>`);
      if (d.charging) o.push(`<path class="flow car sp${d.carSpeed}" d="${path}" ${anim}/><path class="flowglow car" d="${path}"/>`);
      o.push(`<circle cx="${cP[0]}" cy="${cP[1]}" r="1.3" class="port ${d.charging ? "on" : ""}"/>`);
    }
    return o.join("");
  }
}

const HE_CSS = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; padding: 14px 14px 12px;
    --he-accent: #35c7d9; --he-ok: #4cc38a; --he-sun: #f5b942; --he-import: #4aa3ff; --he-heat: #ff8a3d; --he-cool: #6cc3ff;
    --he-text: var(--primary-text-color, #e6e6e6); --he-dim: var(--secondary-text-color, #9aa0a6);
    --he-soft: color-mix(in srgb, var(--he-text) 8%, transparent); }
  ha-card.txt-bright { --he-dim: color-mix(in srgb, var(--primary-text-color, #e6e6e6) 82%, var(--card-background-color, #1c1c1c)); }
  ha-card.txt-primary { --he-dim: var(--he-text); }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
  button:focus-visible { outline: 2px solid var(--he-text); outline-offset: 2px; }
  .head { display: flex; align-items: center; gap: 12px; }
  .ibox { flex: none; width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: var(--he-soft); color: var(--he-dim); }
  .ibox ha-icon { --mdc-icon-size: 28px; display: inline-flex; }
  .ibox.sun { background: color-mix(in srgb, var(--he-sun) 18%, transparent); color: var(--he-sun); }
  .hmain { flex: 1; min-width: 0; }
  .name { font-size: 16px; color: var(--he-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hsub { font-size: 12px; color: var(--he-dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hright { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: 999px; font-size: 12.5px; color: var(--he-text); background: var(--he-soft); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .chip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--he-dim); }
  .chip.on { background: color-mix(in srgb, var(--he-import) 18%, transparent); }
  .chip.on::before { background: var(--he-import); animation: he-dot 1.6s ease-in-out infinite; }
  .chip.ok { background: color-mix(in srgb, var(--he-ok) 18%, transparent); }
  .chip.ok::before { background: var(--he-ok); animation: he-dot 1.6s ease-in-out infinite; }
  .self { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--he-dim); }
  .self ha-icon { --mdc-icon-size: 14px; color: var(--he-ok); display: inline-flex; }
  .self b { font-weight: 500; color: var(--he-text); font-size: 12px; font-variant-numeric: tabular-nums; }

  ha-card.no-head .scene { margin-top: -14px; }
  ha-card.no-stats { padding-bottom: 0; }
  .scene { position: relative; margin: 10px -14px 0; aspect-ratio: ${VB.w} / ${VB.h}; }
  .scene > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .pill { position: absolute; transform: translate(-50%, -100%); display: flex; align-items: center; gap: 6px; padding: 5px 10px 5px 6px; border-radius: 999px;
    background: color-mix(in srgb, #0d1117 72%, transparent); border: 1px solid rgba(255,255,255,.10);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); box-shadow: 0 4px 14px rgba(0,0,0,.35); color: #eef2f6; white-space: nowrap; }
  .pill ha-icon { --mdc-icon-size: 16px; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,.08); color: #b8c0ca; }
  .pill b { display: block; font-size: 13px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .pill span { display: block; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: #9aa4b0; line-height: 1.2; }
  .pill.sun ha-icon { color: var(--he-sun); background: color-mix(in srgb, var(--he-sun) 22%, transparent); }
  .pill.import ha-icon { color: var(--he-import); background: color-mix(in srgb, var(--he-import) 22%, transparent); }
  .pill.export ha-icon { color: var(--he-ok); background: color-mix(in srgb, var(--he-ok) 22%, transparent); }
  .pill.house ha-icon { color: #9d8cff; background: color-mix(in srgb, #9d8cff 22%, transparent); }
  .pill.hp ha-icon { color: var(--he-heat); background: color-mix(in srgb, var(--he-heat) 22%, transparent); }
  .pill.car ha-icon { color: var(--he-accent); background: color-mix(in srgb, var(--he-accent) 22%, transparent); }
  .pill.car.idle ha-icon { color: #b8c0ca; background: rgba(255,255,255,.08); }
  .pill.dim { opacity: .82; }
  

  /* sky */
  .day .sky0 { stop-color: #2f4f78; } .day .sky1 { stop-color: #7d9ec0; }
  .night .sky0 { stop-color: #070b16; } .night .sky1 { stop-color: #18233a; }
  .day.sky-cloudy .sky0, .day.sky-rain .sky0, .day.sky-fog .sky0, .day.sky-snow .sky0 { stop-color: #4a5664; }
  .day.sky-cloudy .sky1, .day.sky-rain .sky1, .day.sky-fog .sky1, .day.sky-snow .sky1 { stop-color: #8c97a3; }
  .night.sky-rain .sky0, .night.sky-cloudy .sky0 { stop-color: #0b0f17; }
  .star { fill: #fff; animation: he-twinkle 4s ease-in-out infinite; }
  .cloud ellipse { fill: #c9d3de; opacity: .35; }
  .night .cloud ellipse { fill: #56627a; opacity: .45; }
  .cloud { animation: he-drift 60s linear infinite; }

  /* ground + buildings */
  .slab.l { fill: #2a2f36; } .slab.r { fill: #1e2228; }
  .lawn { fill: #34463a; } .night .lawn { fill: #1c2620; }
  .drive { fill: #5a5f66; } .night .drive { fill: #30343a; }
  .drive.path { fill: #6c7077; } .night .drive.path { fill: #393d43; }
  .wall.l { fill: #c9cdd2; } .wall.r { fill: #a4a9b0; }
  .night .wall.l { fill: #5d636b; } .night .wall.r { fill: #454a51; }
  .board { stroke: rgba(0,0,0,.08); stroke-width: .5; }
  .plinth.l { fill: #6f747b; } .night .plinth.l { fill: #34383d; }
  .roof.f { fill: #343a44; } .roof.b { fill: #262b33; }
  .night .roof.f { fill: #1f242c; } .night .roof.b { fill: #171b21; }
  .fascia { fill: #e9ecef; } .fascia.l { fill: #f4f5f7; } .night .fascia { fill: #6b7078; } .night .fascia.l { fill: #7a8088; }
  .chim.l { fill: #8b5a4a; } .chim.r { fill: #6d4337; } .chim.t { fill: #3a2621; }
  .night .chim.l { fill: #4a3029; } .night .chim.r { fill: #3a241f; }
  .win { fill: #42566e; stroke: #eef1f4; stroke-width: .8; } .night .win { stroke: #7a8088; }
  .win.lit { fill: #ffc874; } .win.lit.dimlit { fill: #e8a95a; }
  .mull { stroke: #eef1f4; stroke-width: .6; } .night .mull { stroke: #8a7350; }
  .door { fill: #3b2d26; stroke: #eef1f4; stroke-width: .8; } .night .door { stroke: #7a8088; }
  .step.l, .step.r, .step.t { fill: #8a8f96; } .night .step.t { fill: #4b4f55; }
  .gdoor { fill: #e0e3e7; } .night .gdoor { fill: #686d75; }
  .gline { stroke: rgba(0,0,0,.18); stroke-width: .6; }
  .panel { fill: url(#he-panel); stroke: #b9c7da; stroke-width: .35; }
  .day .panel { fill: url(#he-panel-day); }
  .night .panel { stroke: #3a4a63; }
  .cell { stroke: rgba(160,185,220,.25); stroke-width: .3; }
  .pvglow { fill: var(--he-sun); mix-blend-mode: screen; }
  .glint { animation: he-glint 6s ease-in-out infinite; }
  .pole { stroke: #4d3b2c; stroke-width: 2.2; stroke-linecap: round; } .pole.arm { stroke-width: 1.4; }
  .wire { fill: none; stroke: #11151b; stroke-width: .8; opacity: .85; }
  .night .wire { stroke: #000; }
  .anchor { fill: #11151b; }
  .goe.l { fill: #2b2f35; } .goe.r { fill: #1d2126; } .goe.t { fill: #3a3f46; }
  .goeled { stroke: #6b7078; stroke-width: 1.2; stroke-linecap: round; }
  .goeled.on { stroke: var(--he-accent); filter: drop-shadow(0 0 2px var(--he-accent)); animation: he-dot 1.6s infinite; }
  .goeled.idle { stroke: var(--he-ok); }
  .hpu.l { fill: #eceef0; } .hpu.r { fill: #c5c9ce; } .hpu.t { fill: #f7f8f9; }
  .night .hpu.l { fill: #8d939a; } .night .hpu.r { fill: #6d7278; } .night .hpu.t { fill: #9da2a8; }
  .foot.l, .foot.r, .foot.t { fill: #3a3f46; }
  .grille { fill: #262a30; } .grillering { fill: none; stroke: #8a9099; stroke-width: .03; }
  .blades path { fill: #7d848d; }
  .blades.spin { animation: he-spin 1.1s linear infinite; }
  .hpgrid { fill: none; stroke: #9aa0a8; stroke-width: .02; }
  .hpled { fill: #555; } .hpled.on { fill: var(--he-ok); }
  .pipe { fill: none; stroke: #d9dde1; stroke-width: 1.4; stroke-linecap: round; } .night .pipe { stroke: #7a8088; }
  .breath ellipse { fill: var(--he-heat); opacity: .35; filter: blur(3px); animation: he-breath 2.4s ease-in-out infinite; }
  .breath.cool ellipse { fill: var(--he-cool); }


  .wall.l { fill: #2d4466; } .wall.r { fill: #213551; }
  .night .wall.l { fill: #1a2840; } .night .wall.r { fill: #131e31; }
  .board { stroke: rgba(255,255,255,.07); stroke-width: .5; } .board.r { stroke: rgba(255,255,255,.05); }
  .trim { fill: #eef1f4; } .night .trim { fill: #8b929b; }
  .plinth.r { fill: #5a5f66; } .night .plinth.r { fill: #2b2f34; }
  .hedge.l { fill: #2f4a35; } .hedge.r { fill: #253b2b; } .hedge.t { fill: #3b5a41; }
  .night .hedge.l { fill: #18261b; } .night .hedge.r { fill: #121d15; } .night .hedge.t { fill: #1e3022; }
  .gdoor { fill: #eef0f2; } .night .gdoor { fill: #79808a; }
  .car.hood { fill: color-mix(in srgb, var(--car) 88%, white); }
  .night .car.hood { fill: color-mix(in srgb, var(--car) 58%, black); }
  .car.roofblk { fill: #121418; }
  .pillar { fill: #0c0e11; }
  .car.mirror.l, .car.mirror.r, .car.mirror.t { fill: #121418; }
  .arch { fill: #121418; }
  .garnish { fill: #a9b0b8; } .night .garnish { fill: #5c6168; }
  .tail { fill: #7a1420; } .tail.on { fill: #ff2a3a; filter: drop-shadow(0 0 2px #ff2a3a); }
  .grillbar { fill: #121418; }
  .spoke { fill: #4a4f56; }
  .rim { fill: #24272b; } .night .rim { fill: #1a1c1f; }
  .spoiler { fill: #121418; }
  .car.side.cab { fill: color-mix(in srgb, var(--car) 76%, black); }
  .night .car.side.cab { fill: color-mix(in srgb, var(--car) 45%, black); }
  .lead.house, .leaddot.house { stroke: #9d8cff; fill: #9d8cff; }

  .panel { fill: #15181d !important; stroke: #3b4048; stroke-width: .3; }
  .cell { stroke: rgba(120,130,145,.18); }
  .day .panel { fill: #1d2532 !important; }
  .seam { stroke: rgba(255,255,255,.07); stroke-width: .45; }
  .roof.f { fill: #30353d; } .roof.b { fill: #24282e; } .roof.t { fill: #3a3f47; }
  .night .roof.f { fill: #1d2127; } .night .roof.b { fill: #16191e; } .night .roof.t { fill: #23272d; }
  .roof.porch { fill: #2b3037; } .night .roof.porch { fill: #1a1d22; }
  .post.l, .post.r, .post.t { fill: #f3f4f6; } .post.r { fill: #d5d8dc; }
  .night .post.l, .night .post.t { fill: #9aa0a8; } .night .post.r { fill: #7d838b; }
  .porchshade { fill: rgba(0,0,0,.14); }
  .win { stroke-width: 1.1; }
  .mull.thick { stroke-width: .9; }
  .glassdoor { fill: #42566e; stroke: #eef1f4; stroke-width: 1.1; } .glassdoor.lit { fill: #ffc874; } .night .glassdoor { stroke: #8b929b; }
  .chimcap.l, .chimcap.r, .chimcap.t { fill: #1b1d21; }
  .chim.l { fill: #2a2d33; } .chim.r { fill: #1f2227; } .chim.t { fill: #15171a; }
  .night .chim.l { fill: #1b1d21; } .night .chim.r { fill: #141619; }
  .sunglass { fill: #5d7891; opacity: .92; } .sunglass.side { fill: #4b6378; }
  .sunglass.lit { fill: #f2bd72; opacity: 1; } .sunglass.lit.side { fill: #d99f58; }
  .sunpost { stroke: #f3f4f6; stroke-width: .9; } .night .sunpost { stroke: #9aa0a8; }
  .sidedoor { fill: #f3f4f6; stroke: #f3f4f6; } .night .sidedoor { fill: #8d939b; }
  .sidedoorwin { fill: #6d8299; } .night .sidedoorwin { fill: #3b4552; }
  .awning { fill: #15171a; } .awning.edge { fill: #0d0f11; }
  .walllamp { fill: #2a2d31; } .walllamp.on { fill: #ffe2a6; }
  /* car */
  .carshadow { fill: rgba(0,0,0,.45); }
  .car.side { fill: color-mix(in srgb, var(--car) 82%, black); }
  .car.top { fill: color-mix(in srgb, var(--car) 92%, white); }
  .car.roof { fill: color-mix(in srgb, var(--car) 92%, white); }
  .night .car.roof { fill: color-mix(in srgb, var(--car) 62%, black); }
  .car.front { fill: color-mix(in srgb, var(--car) 60%, black); }
  .car.pillar { fill: #15181c; }
  .night .car.side { fill: color-mix(in srgb, var(--car) 50%, black); }
  .night .car.top { fill: color-mix(in srgb, var(--car) 62%, black); }
  .night .car.front { fill: color-mix(in srgb, var(--car) 38%, black); }
  .glass { fill: #1c2633; } .glass.sidewin { fill: #222d3b; stroke: #0d1014; stroke-width: .5; }
  .clad { fill: #15181c; }
  .lamp { fill: #e9eef3; } .lamp.on { fill: #f4fbff; filter: drop-shadow(0 0 3px #dff3ff); }
  .tyre { fill: #0d0f12; } .hub { fill: #3a3e44; }
  .socbg { fill: rgba(0,0,0,.45); } .socfill { fill: var(--he-ok); } .socfill.charging { fill: var(--he-accent); }
  .cable { fill: none; stroke: #121417; stroke-width: 1.3; stroke-linecap: round; }
  .port { fill: #3a3f46; } .port.on { fill: var(--he-accent); filter: drop-shadow(0 0 2px var(--he-accent)); }

  /* energy flows */
  .flow { fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-dasharray: 2 7; animation: he-flow 1.6s linear infinite; }
  .flow.sp2 { animation-duration: 1s; } .flow.sp3 { animation-duration: .6s; }
  .flow.grid.import { stroke: #9fd0ff; } .flow.grid.export { stroke: #9ff0c6; animation-direction: reverse; }
  .flow.car { stroke: #a6f2fb; }
  .flowglow { fill: none; stroke-width: 4.5; stroke-linecap: round; opacity: .35; filter: blur(2px); }
  .flowglow.import { stroke: var(--he-import); } .flowglow.export { stroke: var(--he-ok); } .flowglow.car { stroke: var(--he-accent); }
  .lead { stroke: rgba(255,255,255,.35); stroke-width: .6; }
  .leaddot { fill: rgba(255,255,255,.7); }
  .lead.sun, .leaddot.sun { stroke: var(--he-sun); fill: var(--he-sun); }
  .lead.import, .leaddot.import { stroke: var(--he-import); fill: var(--he-import); }
  .lead.export, .leaddot.export { stroke: var(--he-ok); fill: var(--he-ok); }
  .lead.car, .leaddot.car { stroke: var(--he-accent); fill: var(--he-accent); }
  .lead.hp, .leaddot.hp { stroke: var(--he-heat); fill: var(--he-heat); }
  .leaddot { stroke: none !important; }

  /* rain / snow */
  .sky-rain svg { background: none; }
  .scene.sky-rain::after, .scene.sky-snow::after { content: ""; position: absolute; inset: 0; pointer-events: none;
    background-image: repeating-linear-gradient(105deg, transparent 0 14px, rgba(200,220,255,.16) 14px 15px);
    background-size: 60px 60px; animation: he-rain .5s linear infinite; mask-image: linear-gradient(#000 0 60%, transparent); -webkit-mask-image: linear-gradient(#000 0 60%, transparent); }
  .scene.sky-snow::after { background-image: radial-gradient(circle, rgba(255,255,255,.7) 0 1px, transparent 1.5px); background-size: 22px 22px; animation: he-snow 6s linear infinite; }
  .scene.sky-fog::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(transparent 30%, rgba(180,190,200,.18) 60%, transparent 90%); }

  /* stats */
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
  .stat { display: flex; flex-direction: column; min-width: 0; padding: 8px 9px; border-radius: 12px;
    background: color-mix(in srgb, var(--he-text) 5%, transparent); border: 1px solid color-mix(in srgb, var(--he-text) 7%, transparent); }
  .stat .l { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--he-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stat .l ha-icon { --mdc-icon-size: 15px; display: inline-flex; flex: none; }
  .s-pv .l ha-icon { color: var(--he-sun); } .s-in .l ha-icon { color: var(--he-import); } .s-out .l ha-icon { color: var(--he-ok); } .s-load .l ha-icon { color: #9d8cff; }
  .stat b { display: block; margin-top: 3px; font-size: 17px; font-weight: 400; color: var(--he-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .stat .x { font-size: 11px; color: var(--he-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 14px; }
  .stat .bar { display: block; margin-top: 6px; height: 4px; border-radius: 999px; background: var(--he-soft); overflow: hidden; }
  .stat .bar i { display: block; height: 100%; border-radius: 999px; transition: width .6s ease; }
  .s-pv .bar i { background: var(--he-sun); } .s-in .bar i { background: var(--he-import); } .s-out .bar i { background: var(--he-ok); } .s-load .bar i { background: #9d8cff; }
  @media (max-width: 460px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .pill { padding: 3px 8px 3px 4px; gap: 4px; } .pill b { font-size: 11.5px; } .pill span { font-size: 8.5px; } .pill ha-icon { width: 20px; height: 20px; --mdc-icon-size: 14px; } }

  @keyframes he-flow { to { stroke-dashoffset: -18; } }
  @keyframes he-spin { to { transform: rotate(360deg); } }
  @keyframes he-dot { 50% { opacity: .35; } }
  @keyframes he-twinkle { 50% { opacity: .25; } }
  @keyframes he-drift { from { transform: translateX(-30px); } 50% { transform: translateX(30px); } to { transform: translateX(-30px); } }
  @keyframes he-glint { 0% { transform: skewX(-20deg) translateX(0); } 60%, 100% { transform: skewX(-20deg) translateX(320px); } }
  @keyframes he-breath { 0%, 100% { opacity: .1; transform: translateX(0); } 50% { opacity: .45; transform: translateX(-4px); } }
  @keyframes he-rain { to { background-position: -16px 60px; } }
  @keyframes he-snow { to { background-position: -22px 110px; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
`;

customElements.define("house-energy-card", HouseEnergyCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "house-energy-card", name: "Hus – energi", description: "Isometriskt hus med sol, nät, elbil, laddbox och värmepump", preview: true });
console.info(`%c HOUSE-ENERGY-CARD %c ${HE_VERSION} `, "background:#f5b942;color:#000", "background:#333;color:#fff");
