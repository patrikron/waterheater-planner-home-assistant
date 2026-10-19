/*
 * go-e charger card
 *
 * One file, no build step. Put it in /config/www/goe-card.js and add it as a dashboard
 * resource (/local/goe-card.js?v=1, JavaScript module). Same look as the pump, wood stove,
 * washer and EV6 cards: big thin number, status chip, power curve, controls and a fold-out section.
 *
 * Reads the go-e Charger API v2 integration (entities named <prefix>_car_value, _nrg_11, _frc ...).
 * Car battery, cheapest hours and the car's own start/stop live on the EV6 card, not here.
 *
 *   type: custom:goe-card
 *   name: Laddbox                               # optional
 *   prefix: goe_404702                          # every go-e entity below defaults from it
 *   load_balancing: input_boolean.element_laddning_balansering   # on = radiators paused. Optional
 *   water_heater: binary_sensor.shelly_shem_3_485519d75132_2_active # on = forced to 1 phase. Optional
 *   history_power: sensor.go_echarger_404702_power_total  # recorded power sensor for the curve, if power: is not recorded
 *   history_hours: 168                          # how far back the card looks for the last session
 *   car_soc: sensor.ev6_laddningsniva_soc       # the car's battery %, shown as a bar while plugged in. Optional
 *   car_target: sensor.ev6_malladdningsniva     # the car's charge limit %, a mark on that bar. Optional
 *   price: sensor.tibber_elpris                 # SEK/kWh with long-term statistics (mean), for the cost. Optional
 *   price_extra: 0.856                          # added to every kWh (fees, tax) when price: is spot only
 *   expanded: false
 *   secondary_text: theme                       # grey texts: theme (default) | bright | primary
 *
 * go-e entities (override any of them if your names differ), defaults with prefix P:
 *   car: sensor.P_car_value            connected: binary_sensor.P_car_0
 *   power: sensor.P_nrg_11             session_energy: sensor.P_wh       total_energy: sensor.P_eto
 *   force: select.P_frc                phase_mode: select.P_psm          logic_mode: select.P_lmo
 *   current: number.P_amp              allowed_current: sensor.P_acu     pv_surplus: switch.P_fup
 *   error: sensor.P_err_value          status: sensor.P_modelstatus_value
 *   wifi: sensor.P_wst_value           rssi: sensor.P_rssi
 *   temp_plug: sensor.P_tma_0          temp_board: sensor.P_tma_1        cable: sensor.P_cbl
 *   voltage_l1..l3: sensor.P_nrg_0..2  current_l1..l3: sensor.P_nrg_4..6 power_l1..l3: sensor.P_nrg_7..9
 *
 * All grey text goes through one CSS variable, --gc-dim, set on ha-card.
 */

const GC_CARD_VERSION = "0.2.3";

const GC_KEYS = {
  car: "sensor.%_car_value",
  connected: "binary_sensor.%_car_0",
  power: "sensor.%_nrg_11",
  session_energy: "sensor.%_wh",
  total_energy: "sensor.%_eto",
  force: "select.%_frc",
  phase_mode: "select.%_psm",
  logic_mode: "select.%_lmo",
  current: "number.%_amp",
  allowed_current: "sensor.%_acu",
  pv_surplus: "switch.%_fup",
  error: "sensor.%_err_value",
  status: "sensor.%_modelstatus_value",
  wifi: "sensor.%_wst_value",
  rssi: "sensor.%_rssi",
  temp_plug: "sensor.%_tma_0",
  temp_board: "sensor.%_tma_1",
  cable: "sensor.%_cbl",
  voltage_l1: "sensor.%_nrg_0", voltage_l2: "sensor.%_nrg_1", voltage_l3: "sensor.%_nrg_2",
  current_l1: "sensor.%_nrg_4", current_l2: "sensor.%_nrg_5", current_l3: "sensor.%_nrg_6",
  power_l1: "sensor.%_nrg_7", power_l2: "sensor.%_nrg_8", power_l3: "sensor.%_nrg_9",
};
const GC_OTHER_KEYS = ["load_balancing", "water_heater", "history_power", "price", "car_soc", "car_target"];

// go-e option values: force state, phase switch mode, logic mode.
const GC_FORCE = { auto: "0", off: "1", on: "2" };
const GC_PHASE = { auto: "0", one: "1", three: "2" };
const GC_LOGIC = { standard: "3", eco: "4", trip: "5" };

const GC_TEXT = {
  sv: {
    chip: {
      charging: (ph, a) => `Laddar · ${ph} · ${a} A`, chargingShort: "Laddar", waiting: "Väntar på bilen",
      complete: "Klar", paused: "Pausad", idle: "Ingen bil", error: "Fel", offline: "Offline",
    },
    phases: (n) => `${n}-fas`,
    last: "senaste", session: "laddat", nowLabel: "nu",
    since: (t) => `sedan ${t}`,
    mode: { standard: "Standard", eco: "Eco", trip: "Nästa resa" },
    modeLabel: (m) => `Läge ${m}`,
    maxA: (a) => `max ${a} A`,
    lastSession: (s) => `Senast ${s}`,
    plugged: (t) => `Ansluten ${t}`,
    noCar: "Ingen bil ansluten",
    charge: "Laddning", auto: "Auto", now: "Ladda nu", pause: "Pausa",
    amps: "Ström", phaseMode: "Faser", one: "1-fas", three: "3-fas", logic: "Läge",
    pv: "Solöverskott", on: "På", off: "Av",
    alertError: (e) => `Laddboxen rapporterar ett fel: ${e}.`,
    alertOffline: "Laddboxen svarar inte. Kontrollera wifi.",
    alertForcedOff: "Laddningen är pausad manuellt. Välj Auto för att låta schemat styra igen.",
    alertForcedOn: "Laddar nu oavsett pris. Välj Auto för att låta schemat styra igen.",
    balancing: "Elementen är pausade medan bilen laddar.",
    vvb: "1-fas medan varmvattenberedaren värmer.",
    thisSession: "Den här laddningen", lastSessionHead: "Senaste laddningen",
    started: (t, d) => `start ${t} · ${d}`,
    statEnergy: "Energi", statPeak: "Toppeffekt", statCharged: (d) => `laddade i ${d}`,
    statTotal: "Totalt laddat", statPlug: "Temp. kontakt", board: (v) => `kretskort ${v}`,
    statCable: "Kabel max", statWifi: "Wifi", phase: (n) => `L${n}`,
    hover: (t, w) => `${t} · ${w}`,
    status: "Status",
    socTarget: (v) => `mål ${v} %`,
    charged: "Laddat", month: "Denna månad", year: "I år", kr: (v) => `${v} kr`,
    perDay: "per dag, senaste 30 dagarna", dayHover: (d, k, c) => [d, k, c].filter(Boolean).join(" · "),
    expand: "Visa mer", collapse: "Visa mindre",
    missing: (e) => `Hittar inte ${e}. Ställ in prefix: eller car:.`,
    pick: {
      name: "Namn (valfritt)", prefix: "go-e-prefix (t.ex. goe_404702)", load_balancing: "Lastbalansering (på = element pausade)",
      water_heater: "Varmvattenberedare (på = 1-fas)", history_power: "Effekt med historik (för kurvan)", history_hours: "Timmar bakåt för senaste laddningen",
      car_soc: "Bilens laddnivå i % (stapel när den är ansluten)", car_target: "Bilens målnivå i %",
      price: "Elpris med statistik (för kostnaden)", price_extra: "Påslag per kWh (avgifter, skatt)",
      expanded: "Utfälld från start", secondary_text: "Gråa texter", look: "Utseende", extra: "Övrigt",
      ents: "go-e-entiteter (bara om de heter annorlunda)",
    },
    dimOptions: { theme: "Temats färg", bright: "Ljusare", primary: "Samma som huvudtexten (vit i mörkt tema)" },
    statusText: {
      "Charging because of fallback (default)": "Laddar enligt standardläget",
      "Not charging because of phase switch": "Byter faser",
      "Not charging because of fallback (default)": "Laddar inte (standardläget)",
      "Charging because of force state on": "Laddar nu (tvingad)",
      "Not charging because of force state off": "Pausad manuellt",
      "Not charging because no car connected": "Ingen bil ansluten",
      "Charging because of pv surplus": "Laddar på solöverskott",
      "Not charging because of pv surplus": "Väntar på solöverskott",
      "Charging because of cheap price": "Laddar på billigt pris",
      "Not charging because price is too high": "Väntar på lägre pris",
      "Charging because of scheduler": "Laddar enligt schema",
      "Not charging because of scheduler": "Väntar på schemat",
      "Not charging because of energy limit": "Energigränsen nådd",
      "Not charging because car is full": "Bilen är full",
      "Charging because of next trip test": "Laddar för nästa resa",
      "Charging because of next trip": "Laddar för nästa resa",
      "Not charging because of next trip": "Väntar (nästa resa)",
    },
  },
  en: {
    chip: {
      charging: (ph, a) => `Charging · ${ph} · ${a} A`, chargingShort: "Charging", waiting: "Waiting for car",
      complete: "Done", paused: "Paused", idle: "No car", error: "Error", offline: "Offline",
    },
    phases: (n) => `${n}-phase`,
    last: "last", session: "charged", nowLabel: "now",
    since: (t) => `since ${t}`,
    mode: { standard: "Standard", eco: "Eco", trip: "Next trip" },
    modeLabel: (m) => `Mode ${m}`,
    maxA: (a) => `max ${a} A`,
    lastSession: (s) => `Last ${s}`,
    plugged: (t) => `Plugged in ${t}`,
    noCar: "No car connected",
    charge: "Charging", auto: "Auto", now: "Charge now", pause: "Pause",
    amps: "Current", phaseMode: "Phases", one: "1-phase", three: "3-phase", logic: "Mode",
    pv: "PV surplus", on: "On", off: "Off",
    alertError: (e) => `The charger reports an error: ${e}.`,
    alertOffline: "The charger is not responding. Check Wi-Fi.",
    alertForcedOff: "Charging is paused by hand. Pick Auto to let the schedule decide again.",
    alertForcedOn: "Charging now whatever the price. Pick Auto to let the schedule decide again.",
    balancing: "The radiators are paused while the car charges.",
    vvb: "1-phase while the water heater runs.",
    thisSession: "This session", lastSessionHead: "Last session",
    started: (t, d) => `started ${t} · ${d}`,
    statEnergy: "Energy", statPeak: "Peak power", statCharged: (d) => `charged for ${d}`,
    statTotal: "Total charged", statPlug: "Plug temp.", board: (v) => `board ${v}`,
    statCable: "Cable max", statWifi: "Wi-Fi", phase: (n) => `L${n}`,
    hover: (t, w) => `${t} · ${w}`,
    status: "Status",
    socTarget: (v) => `target ${v} %`,
    charged: "Charged", month: "This month", year: "This year", kr: (v) => `${v} kr`,
    perDay: "per day, last 30 days", dayHover: (d, k, c) => [d, k, c].filter(Boolean).join(" · "),
    expand: "Show more", collapse: "Show less",
    missing: (e) => `Cannot find ${e}. Set prefix: or car:.`,
    pick: {
      name: "Name (optional)", prefix: "go-e prefix (e.g. goe_404702)", load_balancing: "Load balancing (on = radiators paused)",
      water_heater: "Water heater (on = 1-phase)", history_power: "Recorded power (for the curve)", history_hours: "Hours back for the last session",
      car_soc: "Car battery % (bar while plugged in)", car_target: "Car charge limit %",
      price: "Electricity price with statistics (for the cost)", price_extra: "Added per kWh (fees, tax)",
      expanded: "Folded out from start", secondary_text: "Grey texts", look: "Appearance", extra: "Extras",
      ents: "go-e entities (only if named differently)",
    },
    dimOptions: { theme: "Theme colour", bright: "Brighter", primary: "Same as the main text (white in a dark theme)" },
    statusText: {},
  },
};

const GC_STYLE = `
  :host { display: block; }
  ha-card { display: block; position: relative;
    --gc-accent: var(--gc-accent-color, #35c7d9);
    --gc-ok: #4cc38a;
    --gc-amber: #e3a43a;
    --gc-heat: #ff8a3d;
    --gc-warn: var(--error-color, #e5534b);
    --gc-text: var(--primary-text-color, #e6e6e6);
    --gc-dim: var(--secondary-text-color, #9aa0a6);
    --gc-line: color-mix(in srgb, var(--gc-text) 14%, transparent);
    --gc-soft: color-mix(in srgb, var(--gc-text) 8%, transparent);
    padding: 16px 16px 14px;
    overflow: hidden;
    container-type: inline-size;
  }
  /* A slow accent glow drifting across the card while it charges. ha-card is never rewritten, so it runs unbroken. */
  ha-card::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .6s;
    background: radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--gc-accent) 16%, transparent), transparent 60%),
      linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--gc-accent) 9%, transparent) 50%, transparent 70%);
    background-size: 100% 100%, 250% 100%; background-repeat: no-repeat; }
  ha-card.charging::before { opacity: 1; animation: gc-sweep 4.5s ease-in-out infinite; }
  ha-card > .body { position: relative; }
  ha-card.txt-bright { --gc-dim: color-mix(in srgb, var(--primary-text-color, #e6e6e6) 82%, var(--card-background-color, #1c1c1c)); }
  ha-card.txt-primary { --gc-dim: var(--gc-text); }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--gc-text); outline-offset: 2px; }

  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .lead { display: flex; align-items: center; gap: 12px; min-width: 0; }
  button.ibox { border: 0; padding: 0; }
  .ibox { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 14px;
    background: var(--gc-soft); color: var(--gc-dim); }
  .ibox ha-icon { --mdc-icon-size: 28px; display: inline-flex; }
  .ibox.on { background: color-mix(in srgb, var(--gc-accent) 18%, transparent); color: var(--gc-accent); }
  .ibox.on ha-icon { animation: gc-pulse 2.4s ease-in-out infinite; }
  .ibox.ok { background: color-mix(in srgb, var(--gc-ok) 18%, transparent); color: var(--gc-ok); }
  .ibox.warn { background: color-mix(in srgb, var(--gc-warn) 18%, transparent); color: var(--gc-warn); }
  .name { font-size: 14px; color: var(--gc-dim); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  button.big { border: 0; background: none; padding: 0; margin: 0; text-align: left; display: block; border-radius: 6px; }
  .big { font-size: 38px; line-height: 1; font-weight: 300; letter-spacing: -1px; color: var(--gc-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .big small { font-size: 16px; font-weight: 400; color: var(--gc-dim); letter-spacing: 0; margin-left: 5px; }
  .sub { margin-top: 8px; font-size: 13px; color: var(--gc-dim); line-height: 1.35; }

  .chip { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; flex: none;
    padding: 6px 12px; border-radius: 999px; font-size: 13px; line-height: 1.2; white-space: nowrap;
    color: var(--gc-text); background: var(--gc-soft); border: 0; }
  .chip::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--gc-dim); }
  .chip.on { background: color-mix(in srgb, var(--gc-accent) 18%, transparent); }
  .chip.on::before { background: var(--gc-accent); animation: gc-dot 1.6s ease-in-out infinite; }
  .chip.paused { background: color-mix(in srgb, var(--gc-accent) 10%, transparent); }
  .chip.paused::before { background: var(--gc-accent); }
  .chip.amber { background: color-mix(in srgb, var(--gc-amber) 16%, transparent); }
  .chip.amber::before { background: var(--gc-amber); }
  .chip.ok { background: color-mix(in srgb, var(--gc-ok) 18%, transparent); }
  .chip.ok::before { background: var(--gc-ok); }
  .chip.warn { background: color-mix(in srgb, var(--gc-warn) 18%, transparent); }
  .chip.warn::before { background: var(--gc-warn); }

  button.soc { display: flex; align-items: center; gap: 10px; width: 100%; margin-top: 10px; padding: 0; border: 0; background: none; text-align: left; }
  .soc b { flex: none; min-width: 44px; font-size: 15px; font-weight: 400; color: var(--gc-text); font-variant-numeric: tabular-nums; }
  .soc span { flex: none; font-size: 12px; color: var(--gc-dim); white-space: nowrap; }
  .soc .track { position: relative; flex: 1; min-width: 0; height: 10px; border-radius: 999px; overflow: hidden; background: var(--gc-soft); }
  .soc .fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 999px; background: var(--gc-accent); transition: width .6s ease; }
  ha-card.charging .soc .fill { background: linear-gradient(90deg, var(--gc-accent) 0%, color-mix(in srgb, var(--gc-accent) 55%, white) 50%, var(--gc-accent) 100%);
    background-size: 200% 100%; animation: gc-bar 2s linear infinite; }
  .soc .tgt { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--gc-text); opacity: .55; }
  .alert { margin: 10px 0 0; padding: 8px 10px; border-radius: 10px; font-size: 13px; line-height: 1.35;
    color: var(--gc-text); background: color-mix(in srgb, var(--gc-warn) 14%, transparent); }
  .alert.amber { background: color-mix(in srgb, var(--gc-amber) 16%, transparent); }
  .alert.heat { background: color-mix(in srgb, var(--gc-heat) 14%, transparent); }

  .chartrow { display: flex; align-items: flex-end; gap: 10px; margin-top: 12px; }
  .chartwrap { flex: 1; min-width: 0; }
  svg.ch { display: block; width: 100%; height: auto; touch-action: pan-y; user-select: none; overflow: visible; }
  svg.ch .line { fill: none; stroke: var(--gc-accent); stroke-width: 1.4; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  svg.ch .area { fill: color-mix(in srgb, var(--gc-accent) 16%, transparent); }
  svg.ch .base { stroke: var(--gc-line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  svg.ch .grid { stroke: var(--gc-dim); stroke-width: 1; stroke-dasharray: 2 3; opacity: .5; vector-effect: non-scaling-stroke; }
  svg.ch .now { stroke: var(--gc-text); stroke-width: 1; opacity: .45; vector-effect: non-scaling-stroke; }
  svg.ch .cur { stroke: var(--gc-text); stroke-width: 1; opacity: .7; vector-effect: non-scaling-stroke; }
  svg.ch .flow { fill: none; stroke: color-mix(in srgb, var(--gc-accent) 45%, white); stroke-width: 2; stroke-linecap: round;
    stroke-dasharray: 3 21; vector-effect: non-scaling-stroke; animation: gc-flow 1.2s linear infinite; }
  svg.ch .dot { fill: var(--gc-accent); }
  svg.ch .halo { fill: var(--gc-accent); transform-box: fill-box; transform-origin: center; animation: gc-halo 1.6s ease-out infinite; }
  svg.ch text { font-size: 11px; fill: var(--gc-dim); font-family: inherit; }
  .empty { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--gc-dim);
    border-radius: 10px; background: color-mix(in srgb, var(--gc-text) 4%, transparent); }
  .fold { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 999px;
    color: var(--gc-dim); background: var(--gc-soft); }
  .chartrow .fold { margin-bottom: 14px; }
  .fold:hover { color: var(--gc-text); }
  .fold svg { width: 16px; height: 16px; transition: transform .15s; }
  .fold[aria-expanded="true"] svg { transform: rotate(180deg); }

  .ctrls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-top: 12px; align-items: stretch; }
  .lbl { font-size: 12px; color: var(--gc-dim); margin: 0 0 5px 2px; }
  .seg { display: flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--gc-soft); min-width: 0; }
  .seg button { flex: 1 1 0; min-width: 0; border: 0; border-radius: 9px; background: none; padding: 7px 6px; font-size: 13px;
    color: var(--gc-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .seg button.sel { color: var(--gc-text); background: color-mix(in srgb, var(--gc-text) 12%, transparent); }
  .seg button.sel.acc { background: color-mix(in srgb, var(--gc-accent) 22%, transparent); }
  .seg button.sel.stop { background: color-mix(in srgb, var(--gc-warn) 22%, transparent); }
  .seg.na { opacity: .55; pointer-events: none; }
  .step { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 12px; background: var(--gc-soft); }
  .step button { width: 30px; height: 30px; border: 0; border-radius: 9px; background: none; color: var(--gc-dim); font-size: 18px; line-height: 1; padding: 0; }
  .step button:hover { color: var(--gc-text); background: var(--gc-soft); }
  .step button:disabled { opacity: .35; cursor: default; }
  .step b { min-width: 44px; text-align: center; font-size: 15px; font-weight: 400; color: var(--gc-text); font-variant-numeric: tabular-nums; }
  .step b.pend { color: var(--gc-accent); }

  .more { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--gc-line); }
  .ghead { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; font-size: 13px; color: var(--gc-text); }
  .hint { font-size: 12px; color: var(--gc-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .hint.live { color: var(--gc-text); }
  .rows { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; margin-top: 12px; }
  .rows .tog { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 12px; border: 0; border-radius: 12px; background: var(--gc-soft); min-height: 38px; font-size: 13px; color: var(--gc-text); }
  .rows .tog span { color: var(--gc-dim); }
  .rows .tog.on span { color: var(--gc-accent); }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .stat { display: flex; flex-direction: column; justify-content: flex-start; min-width: 0; padding: 8px 9px; border-radius: 12px; background: color-mix(in srgb, var(--gc-text) 5%, transparent); border: 1px solid color-mix(in srgb, var(--gc-text) 7%, transparent); }
  .stat b { display: block; overflow: hidden; text-overflow: ellipsis; font-size: 17px; font-weight: 400; color: var(--gc-text); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .stat span { display: block; font-size: 12px; color: var(--gc-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stat span + span { font-size: 11px; }
  button.stat { align-self: stretch; font: inherit; text-align: left; cursor: pointer; }
  .stat.cal { flex-direction: row; align-items: center; gap: 10px; padding: 10px 12px; }
  .stat.cal ha-icon { --mdc-icon-size: 22px; color: var(--gc-dim); flex: none; display: inline-flex; }
  .stat.cal div { min-width: 0; }
  .stat.cal b { font-size: 19px; }
  .stat.cal em { font-style: normal; color: var(--gc-dim); font-size: 13px; margin-left: 4px; }
  .duo { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; margin-top: 10px; }
  .usage { margin-top: 14px; }
  svg.bars .bar { fill: var(--gc-accent); opacity: .85; }
  svg.bars .bar.hl { opacity: 1; fill: color-mix(in srgb, var(--gc-accent) 70%, white); }
  svg.bars .bar.today { opacity: .55; }
  svg.bars .gl { stroke: var(--gc-line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .foot { margin-top: 10px; font-size: 12px; color: var(--gc-dim); }
  .error { padding: 8px 0; font-size: 14px; color: var(--gc-warn); }

  @container (max-width: 340px) {
    .ctrls { grid-template-columns: minmax(0, 1fr); }
    .ctrls .step { width: max-content; }
  }
  @container (max-width: 400px) {
    .rows { grid-template-columns: minmax(0, 1fr); }
  }
  @container (max-width: 360px) {
    .big { font-size: 32px; }
    .ibox { width: 40px; height: 40px; border-radius: 12px; }
    .ibox ha-icon { --mdc-icon-size: 24px; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @keyframes gc-dot { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--gc-accent) 60%, transparent); } 50% { box-shadow: 0 0 0 5px transparent; } }
  @keyframes gc-bar { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  @keyframes gc-flow { to { stroke-dashoffset: -24; } }
  @keyframes gc-halo { 0% { transform: scale(.4); opacity: .7; } 100% { transform: scale(1.6); opacity: 0; } }
  @keyframes gc-sweep { 0% { background-position: 0 0, 120% 0; } 100% { background-position: 0 0, -20% 0; } }
  @keyframes gc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
  @media (prefers-reduced-motion: reduce) {
    .ibox.on ha-icon, .chip.on::before, ha-card.charging::before, svg.ch .flow, svg.ch .halo, ha-card.charging .soc .fill { animation: none; }
    svg.ch .halo { opacity: 0; }
    .fold svg { transition: none; }
  }
`;

const GC_CHEVRON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.41 8.58 12 13.17l4.59-4.59L18 10l-6 6-6-6z"/></svg>`;

function gcEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

class GoeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._expanded = null;
    this._pts = null;        // power [{t, v}] (one-minute means, then live values)
    this._cars = null;       // car state history [{t, s}]
    this._fetchKey = "";
    this._fetchAt = 0;
    this._loading = false;
    this._hover = null;
    this._pendingAmp = null; // stepper value waiting to be sent
    this._days = null;       // charged energy per local day {"2026-10-18": {kwh, kr}}
    this._statsAt = 0;
    this._statsKey = "";
    this._statsLoading = false;
    this._barHover = null;   // hovered day key in the bar chart
    this._ampTimer = null;
    this._sig = "";
    this._w = 0;
    // The style and ha-card stay; only the body is rewritten, so the card never collapses mid-render.
    this.shadowRoot.innerHTML = `<style>${GC_STYLE}</style><ha-card><div class="body"></div></ha-card>`;
    this._card = this.shadowRoot.querySelector("ha-card");
    this._body = this.shadowRoot.querySelector(".body");
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("pointermove", (e) => this._onPointer(e));
    this.shadowRoot.addEventListener("pointerout", (e) => {
      if (e.target.closest?.("svg.bars") && !e.relatedTarget?.closest?.("svg.bars")) {
        if (this._barHover !== null) { this._barHover = null; this._sig = ""; this._render(); }
        return;
      }
      if (e.target.closest?.("svg.ch") && !e.relatedTarget?.closest?.("svg.ch")) this._setHover(null);
    });
  }

  connectedCallback() {
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver((entries) => {
        const w = Math.floor(entries[0].contentRect.width) - 32;
        if (w > 120 && Math.abs(w - this._w) >= 6) {
          this._w = w;
          this._sig = "";
          this._render();
        }
      });
      this._ro.observe(this);
    }
    this._timer = setInterval(() => this._render(), 10000);
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    this._ro = null;
    clearInterval(this._timer);
    this._timer = null;
  }

  static getConfigElement() {
    return document.createElement("goe-card-editor");
  }

  static getStubConfig(hass) {
    const id = Object.keys(hass?.states || {}).find((e) => /^sensor\.goe_\d+_car_value$/.test(e));
    return { prefix: id ? id.slice(7, -"_car_value".length) : "goe_000000" };
  }

  setConfig(config) {
    if (!config) throw new Error("invalid config");
    const c = { history_hours: 168, secondary_text: "theme", ...config };
    const p = c.prefix;
    for (const [k, pat] of Object.entries(GC_KEYS)) if (!c[k] && p) c[k] = pat.replace("%", p);
    this._config = c;
    if (this._expanded === null) this._expanded = !!c.expanded;
    this._pts = this._cars = null;
    this._fetchKey = "";
    this._statsKey = "";
    this._sig = "";
    if (this._hass) this._maybeFetch();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    // Grow the power curve and the car state live between fetches.
    const ps = this._pts && hass.states[this._config.power];
    if (ps) {
      const v = parseFloat(ps.state), t = Date.parse(ps.last_updated);
      const last = this._pts[this._pts.length - 1];
      if (Number.isFinite(v) && (!last || t > last.t)) this._pts.push({ t, v });
    }
    const cs = this._cars && hass.states[this._config.car];
    if (cs) {
      const last = this._cars[this._cars.length - 1];
      if (!last || last.s !== cs.state) this._cars.push({ t: Date.parse(cs.last_changed), s: cs.state });
    }
    if (this._pendingAmp !== null && this._val(this._config.current) === this._pendingAmp && !this._ampTimer) this._pendingAmp = null;
    this._maybeFetch();
    this._maybeStats();
    this._render();
  }

  getCardSize() { return this._expanded ? 9 : 5; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  // ------------------------------------------------------------------ helpers

  get _lang() { return this._hass?.locale?.language || this._hass?.language || "en"; }
  get _t() { return this._lang.startsWith("sv") ? GC_TEXT.sv : GC_TEXT.en; }
  get _tz() { return this._hass?.config?.time_zone || undefined; }

  _st(id) { return id ? this._hass.states[id] : undefined; }
  _s(id) { return this._st(id)?.state; }
  _ok(id) { const s = this._s(id); return s !== undefined && s !== "unavailable" && s !== "unknown"; }
  _val(id) {
    const v = parseFloat(this._s(id));
    return Number.isFinite(v) ? v : null;
  }
  _num(value, digits = 1) {
    return new Intl.NumberFormat(this._lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  }
  _kwhNum(v) { return `${this._num(v, v < 10 ? 2 : 1)} kWh`; }
  _watt(v) { return v >= 1000 ? `${this._num(v / 1000, 1)} kW` : `${this._num(v, 0)} W`; }
  _time(ms) {
    return new Intl.DateTimeFormat(this._lang, { hour: "2-digit", minute: "2-digit", timeZone: this._tz, hour12: false }).format(ms);
  }
  _hourOf(ms) {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: this._tz }).format(ms)) % 24;
  }
  _dayKey(ms) { return new Intl.DateTimeFormat("en-CA", { timeZone: this._tz }).format(ms); }
  _when(ms) {
    if (this._dayKey(ms) === this._dayKey(Date.now())) return this._time(ms);
    if (this._dayKey(ms) === this._dayKey(Date.now() - 86400000)) return `${this._lang.startsWith("sv") ? "igår" : "yesterday"} ${this._time(ms)}`;
    if (Date.now() - ms < 6 * 86400000) return `${new Intl.DateTimeFormat(this._lang, { weekday: "short", timeZone: this._tz }).format(ms)} ${this._time(ms)}`;
    return `${new Intl.DateTimeFormat(this._lang, { day: "numeric", month: "short", timeZone: this._tz }).format(ms)} ${this._time(ms)}`;
  }
  _dur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return `${sec} s`;
    if (sec < 3600) return `${Math.round(sec / 60)} min`;
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  _carState(s) {
    const v = String(s ?? "").toLowerCase();
    if (v === "charging") return "charging";
    if (v.startsWith("wait")) return "waiting";
    if (v === "complete") return "complete";
    if (v === "error") return "error";
    if (v === "idle") return "idle";
    return "offline";
  }
  _keyOf(map, value) { return Object.keys(map).find((k) => map[k] === String(value)) || null; }
  _phasesNow() {
    const c = this._config;
    const n = [c.current_l1, c.current_l2, c.current_l3].filter((id) => (this._val(id) ?? 0) > 1).length;
    if (n) return n;
    const pm = this._keyOf(GC_PHASE, this._s(c.phase_mode));
    return pm === "one" ? 1 : 3;
  }

  // ------------------------------------------------------------------ history

  _maybeFetch() {
    const c = this._config;
    if (!this._hass || this._loading || !this._st(c.car)) return;
    const car = this._carState(this._s(c.car));
    // Refetch when the car state changes, else every 15 minutes (the curve grows live in between).
    const key = `${car}|${c.history_hours}`;
    if (key === this._fetchKey && Date.now() - this._fetchAt < 900000) return;
    this._fetch(key);
  }

  async _fetch(key) {
    const c = this._config;
    this._loading = true;
    const now = Date.now();
    const start = now - (Number(c.history_hours) || 168) * 3600000;
    const hp = c.history_power || c.power;
    const read = (res, id) => (res?.[id] || []).map((it) => ({
      t: it.last_changed ? Date.parse(it.last_changed) : (it.lc ?? it.lu) * 1000,
      s: it.s ?? it.state,
    }));
    try {
      const hist = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(now).toISOString(),
        entity_ids: [c.car],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      this._cars = read(hist, c.car);
      // Power only for the latest session: the charger reports every second, so the window stays short.
      const sess = this._sessions().pop();
      this._pts = [];
      if (sess && hp && this._st(hp)) {
        const a = sess.start, b = sess.end ?? now;
        const res = await this._hass.callWS({
          type: "history/history_during_period",
          start_time: new Date(a).toISOString(),
          end_time: new Date(b).toISOString(),
          entity_ids: [hp],
          minimal_response: true,
          no_attributes: true,
          significant_changes_only: false,
        });
        this._pts = this._bucket(read(res, hp).map((p) => ({ t: p.t, v: parseFloat(p.s) })).filter((p) => Number.isFinite(p.v)));
      }
    } catch (err) {
      console.warn("goe-card: history", err);
      this._cars = this._cars || [];
      this._pts = this._pts || [];
    }
    this._fetchKey = key;
    this._fetchAt = Date.now();
    this._loading = false;
    this._sig = "";
    this._render();
  }

  // ------------------------------------------------------------------ statistics (month, year, per day)

  _maybeStats() {
    const c = this._config;
    if (this._statsLoading || !this._st(c.total_energy)) return;
    const key = `${c.total_energy}|${c.price}|${c.price_extra}`;
    // Hourly statistics only grow once an hour; the live meter covers the hour in between.
    if (key === this._statsKey && Date.now() - this._statsAt < 1800000) return;
    this._fetchStats(key);
  }

  async _fetchStats(key) {
    const c = this._config;
    this._statsLoading = true;
    const now = Date.now();
    // Finished months never change, so their per-day totals are kept in the browser and only the
    // current month is fetched hour by hour. Without a cache: from New Year, or 32 days back in January.
    const month = this._dayKey(now).slice(0, 7);
    const [cy, cm] = month.split("-").map(Number);
    const prevMonth = cm === 1 ? `${cy - 1}-12` : `${cy}-${String(cm - 1).padStart(2, "0")}`;
    const cacheId = `goe-card:days:${key}`;
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem(cacheId) || "null"); } catch (e) { cache = null; }
    const cached = cache && cache.through === prevMonth ? cache.days : null;
    // A day of margin in case the browser and Home Assistant are in different time zones.
    const start = cached
      ? new Date(cy, cm - 1, 1).getTime() - 86400000
      : Math.min(new Date(cy, 0, 1).getTime() - 86400000, now - 32 * 86400000);
    const ms = (v) => (typeof v === "number" ? v : Date.parse(v));
    try {
      const ids = [c.total_energy, ...(c.price && this._st(c.price) ? [c.price] : [])];
      const [en, pr] = await Promise.all(ids.map((id, i) => this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(now).toISOString(),
        statistic_ids: [id],
        period: "hour",
        types: i === 0 ? ["change", "state"] : ["mean"],
      }).then((r) => r?.[id] || [])));
      const prices = new Map((pr || []).filter((r) => Number.isFinite(r.mean)).map((r) => [ms(r.start), r.mean]));
      const extra = Number(c.price_extra) || 0;
      const hasPrice = prices.size > 0;
      let lastPrice = hasPrice ? prices.values().next().value : null;
      const days = {};
      let lastState = null, lastEnd = start;
      for (const r of en) {
        const t = ms(r.start);
        // With a cache, hours before this month (the time-zone margin) are already in it.
        if (cached && this._dayKey(t).slice(0, 7) < month) continue;
        if (prices.has(t)) lastPrice = prices.get(t);
        // A meter reset shows up as a big negative change: count it as nothing.
        const kwh = Math.max(0, Number(r.change) || 0);
        if (Number.isFinite(r.state)) { lastState = r.state; lastEnd = r.end ? ms(r.end) : t + 3600000; }
        if (!kwh) continue;
        const d = (days[this._dayKey(t)] ||= { kwh: 0, kr: hasPrice ? 0 : null });
        d.kwh += kwh;
        if (hasPrice) d.kr += kwh * (lastPrice + extra);
      }
      if (cached) Object.assign(days, Object.fromEntries(Object.entries(cached).filter(([k]) => k.slice(0, 7) < month)));
      this._days = days;
      this._statsBase = { state: lastState, end: lastEnd, hasPrice, extra };
      if (!cached) {
        // Keep finished days from this year and the last 40 days (the bars reach into last year in January).
        const keep = Math.min(new Date(cy, 0, 1).getTime(), now - 40 * 86400000);
        const old = Object.fromEntries(Object.entries(days).filter(([k]) => k.slice(0, 7) < month && k >= this._dayKey(keep)));
        try { localStorage.setItem(cacheId, JSON.stringify({ through: prevMonth, days: old })); } catch (e) { /* no storage: fetch the year each time */ }
      }
    } catch (err) {
      console.warn("goe-card: statistics", err);
      this._days = this._days || {};
    }
    this._statsKey = key;
    this._statsAt = Date.now();
    this._statsLoading = false;
    this._sig = "";
    this._render();
  }

  // Per-day energy with the hour that is not in the statistics yet added from the live meter.
  _daysLive() {
    if (!this._days) return null;
    const days = { ...this._days };
    const b = this._statsBase, c = this._config;
    const eto = this._val(c.total_energy);
    if (b && b.state !== null && eto !== null && eto > b.state && eto - b.state < 100) {
      const k = this._dayKey(Date.now());
      const add = eto - b.state;
      const price = this._val(c.price);
      const prev = days[k] || { kwh: 0, kr: b.hasPrice ? 0 : null };
      days[k] = { kwh: prev.kwh + add, kr: prev.kr !== null && price !== null ? prev.kr + add * (price + b.extra) : prev.kr };
    }
    return days;
  }

  _usageHtml() {
    const t = this._t;
    const days = this._daysLive();
    if (!days) return "";
    const today = this._dayKey(Date.now());
    const sum = (prefix) => Object.entries(days).filter(([k]) => k.startsWith(prefix))
      .reduce((a, [, d]) => ({ kwh: a.kwh + d.kwh, kr: d.kr === null || a.kr === null ? null : a.kr + d.kr }), { kwh: 0, kr: 0 });
    const m = sum(today.slice(0, 7)), y = sum(today.slice(0, 4));
    const kwh = (v) => `${new Intl.NumberFormat(this._lang, { maximumFractionDigits: v < 100 ? 1 : 0 }).format(v)}`;
    const box = (icon, label, s) => `<button class="stat cal" data-action="info" data-entity="${gcEsc(this._config.total_energy)}"><ha-icon icon="${icon}"></ha-icon><div>
        <span>${gcEsc(label)}</span><b>${gcEsc(kwh(s.kwh))}<em>kWh</em></b>${s.kr !== null ? `<span>${gcEsc(t.kr(this._num(s.kr, 0)))}</span>` : ""}</div></button>`;
    // The last 30 days, today included.
    const keys = [];
    for (let i = 29; i >= 0; i--) {
      const k = this._dayKey(Date.now() - i * 86400000);
      if (keys[keys.length - 1] !== k) keys.push(k);
    }
    let hint = t.perDay, live = false;
    if (this._barHover && keys.includes(this._barHover)) {
      const d = days[this._barHover] || { kwh: 0, kr: null };
      hint = t.dayHover(this._dayLabel(this._barHover), `${this._num(d.kwh, 1)} kWh`, d.kr !== null ? t.kr(this._num(d.kr, 0)) : "");
      live = true;
    }
    return `<div class="usage"><div class="ghead"><span>${gcEsc(t.charged)}</span><span class="hint${live ? " live" : ""}">${gcEsc(hint)}</span></div>
      <div class="duo">${box("mdi:calendar-month", t.month, m)}${box("mdi:calendar", t.year, y)}</div>
      ${this._bars(keys, days, today)}</div>`;
  }

  _dayLabel(key) {
    const [y, mo, d] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(this._lang, { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(y, mo - 1, d));
  }

  _bars(keys, days, today) {
    const W = Math.max(200, (this._w || 300));
    const H = 96, AX = 16, L = 22;
    const vals = keys.map((k) => days[k]?.kwh || 0);
    const peak = Math.max(...vals);
    // A round axis step: 1, 2, 5, 10, 20 ... so three or four grid lines fit.
    const steps = [1, 2, 5, 10, 20, 25, 50, 100];
    const step = steps.find((s) => peak / s <= 4) || 100;
    const top = Math.max(step, Math.ceil(peak / step) * step);
    const y = (v) => H - (v / top) * (H - 6);
    const slot = (W - L) / keys.length;
    const bw = Math.max(3, Math.min(16, slot * 0.72));
    this._barGeom = { keys, L, slot };
    let out = "";
    for (let v = 0; v <= top + 1e-9; v += step) {
      const yy = y(v).toFixed(1);
      out += `<line class="gl" x1="${L}" x2="${W}" y1="${yy}" y2="${yy}"/><text x="${L - 5}" y="${(Number(yy) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
    }
    keys.forEach((k, i) => {
      const v = vals[i];
      const cx = L + slot * (i + 0.5);
      if (v > 0) {
        const h = Math.max(2, H - y(v));
        const r = Math.min(bw / 2, h / 2, 4);
        const x0 = cx - bw / 2, y0 = H - h;
        // Rounded top, square bottom.
        const d = `M${x0.toFixed(1)},${H}V${(y0 + r).toFixed(1)}Q${x0.toFixed(1)},${y0.toFixed(1)} ${(x0 + r).toFixed(1)},${y0.toFixed(1)}H${(x0 + bw - r).toFixed(1)}Q${(x0 + bw).toFixed(1)},${y0.toFixed(1)} ${(x0 + bw).toFixed(1)},${(y0 + r).toFixed(1)}V${H}Z`;
        out += `<path class="bar${k === this._barHover ? " hl" : k === today ? " today" : ""}" d="${d}"/>`;
      }
      const dom = Number(k.slice(8));
      // Date labels on the 1st and every fifth day, when there is room.
      if ((dom === 1 || dom % 5 === 0) && dom !== 30 && slot * 4 >= 34 && cx > L + 12 && cx < W - 16) {
        out += `<text x="${cx.toFixed(1)}" y="${H + 13}" text-anchor="middle">${gcEsc(this._dayLabel(k))}</text>`;
      }
    });
    return `<svg class="ch bars" viewBox="0 0 ${W} ${H + AX}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H + AX};margin-top:12px" role="img">${out}</svg>`;
  }

  // One-minute means of a step series, keeping the drops to zero sharp.
  _bucket(pts) {
    const out = [];
    let cur = null;
    for (const p of pts) {
      const b = Math.floor(p.t / 60000) * 60000;
      // A stop or start opens its own bucket so the edge stays where it happened.
      const edge = cur && (p.v < 100) !== (cur.sum / cur.n < 100);
      if (cur && cur.b === b && !edge) { cur.sum += p.v; cur.n += 1; continue; }
      if (cur) out.push({ t: Math.max(cur.t, cur.b), v: cur.sum / cur.n });
      cur = { b: edge ? p.t : b, t: p.t, sum: p.v, n: 1 };
    }
    if (cur) out.push({ t: Math.max(cur.t, cur.b), v: cur.sum / cur.n });
    return out;
  }

  // Sessions from the car state history: plugged in (anything but Idle) until Idle again.
  _sessions() {
    const out = [];
    let cur = null, prev = null;
    for (const o of this._cars || []) {
      const s = this._carState(o.s);
      if (s === "offline") continue;
      if (s !== "idle" && !cur) cur = { start: o.t, end: null, chargeStart: null, chargeEnd: null };
      if (cur && s === "charging") {
        if (cur.chargeStart === null) cur.chargeStart = o.t;
        cur.chargeEnd = null;
      } else if (cur && prev === "charging") cur.chargeEnd = o.t;
      if (s === "idle" && cur) { cur.end = o.t; out.push(cur); cur = null; }
      prev = s;
    }
    if (cur) out.push(cur);
    return out;
  }

  // Energy, peak and time spent charging from the curve within [a, b].
  _analyse(a, b) {
    const pts = this._pts || [];
    let kwh = 0, peak = 0, onSec = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const t1 = Math.max(a, p.t);
      const t2 = Math.min(b, i + 1 < pts.length ? pts[i + 1].t : b);
      if (t2 <= t1) continue;
      kwh += (p.v * (t2 - t1)) / 3600000 / 1000;
      peak = Math.max(peak, p.v);
      if (p.v > 500) onSec += (t2 - t1) / 1000;
    }
    return { kwh, peak, onSec };
  }

  // ------------------------------------------------------------------ rendering

  _signature() {
    const c = this._config;
    const ids = [...Object.keys(GC_KEYS).map((k) => c[k]), ...GC_OTHER_KEYS.map((k) => c[k])];
    return ids.map((id) => (id ? this._hass.states[id]?.last_updated : "")).join("|")
      + this._lang + this._expanded + this._fetchAt + (this._pts?.length || 0) + this._hover + this._pendingAmp + this._statsAt + this._barHover
      + this._w + Math.floor(Date.now() / 60000) + JSON.stringify(c);
  }

  _render() {
    if (!this._config || !this._hass) return;
    const t = this._t, c = this._config;
    const dimCls = c.secondary_text === "bright" ? "txt-bright" : c.secondary_text === "primary" ? "txt-primary" : "";
    const liveCls = [dimCls, this._carState(this._s(c.car)) === "charging" ? "charging" : ""].filter(Boolean).join(" ");
    if (this._card.className !== liveCls) this._card.className = liveCls;
    if (!this._st(c.car)) {
      if (this._sig === "missing") return;
      this._sig = "missing";
      this._body.innerHTML = `<div class="error">${gcEsc(t.missing(c.car || "car"))}</div>`;
      return;
    }
    const sig = this._signature();
    if (sig === this._sig) return;
    this._sig = sig;

    const now = Date.now();
    const car = this._carState(this._s(c.car));
    const offline = car === "offline" || (this._ok(c.wifi) && this._s(c.wifi) !== "Connected");
    const charging = !offline && car === "charging";
    const plugged = !offline && ["charging", "waiting", "complete"].includes(car);
    const force = this._keyOf(GC_FORCE, this._s(c.force));
    const logic = this._keyOf(GC_LOGIC, this._s(c.logic_mode));
    const phaseMode = this._keyOf(GC_PHASE, this._s(c.phase_mode));
    const err = this._s(c.error);
    const hasErr = this._ok(c.error) && !/^-?none-?$/i.test(err) && err !== "None";
    const power = this._val(c.power) ?? 0;
    const sessKwh = this._val(c.session_energy);
    const amp = this._val(c.current);
    const allowed = this._val(c.allowed_current);

    const sessions = this._sessions();
    let sess = sessions.length ? sessions[sessions.length - 1] : null;
    if (plugged && (!sess || sess.end)) sess = { start: Date.parse(this._st(c.car).last_changed), end: null, chargeStart: charging ? Date.parse(this._st(c.car).last_changed) : null, estimated: true };
    const sessEnd = sess ? (sess.end ?? now) : now;
    const an = sess ? this._analyse(sess.start, sessEnd) : null;

    // Big number and chip
    let big = "–", bigUnit = "", chipCls = "", chipText = "", iconCls = "";
    if (offline) { chipCls = "warn"; chipText = t.chip.offline; iconCls = "warn"; }
    else if (car === "error" || hasErr) { big = sessKwh !== null ? this._kwhNum(sessKwh).replace(" kWh", "") : "–"; bigUnit = "kWh"; chipCls = "warn"; chipText = t.chip.error; iconCls = "warn"; }
    else if (charging) {
      big = this._num(power / 1000, power >= 10000 ? 1 : 2); bigUnit = "kW";
      chipCls = "on"; iconCls = "on";
      const a = allowed ?? amp;
      chipText = a !== null ? t.chip.charging(t.phases(this._phasesNow()), Math.round(a)) : t.chip.chargingShort;
    } else {
      if (sessKwh !== null) { big = this._num(sessKwh, sessKwh < 10 ? 2 : 1); bigUnit = plugged ? `kWh ${t.session}` : `kWh ${t.last}`; }
      if (car === "complete") { chipCls = "ok"; chipText = t.chip.complete; iconCls = "ok"; }
      else if (car === "waiting") { chipCls = force === "off" ? "amber" : "paused"; chipText = force === "off" ? t.chip.paused : t.chip.waiting; }
      else chipText = t.chip.idle;
    }

    // Subline
    const sub = [];
    // The chosen mode is always first, so it shows even with the card folded and no car.
    if (logic && !offline) sub.push(t.modeLabel(t.mode[logic]));
    if (plugged || charging) {
      if (amp !== null) sub.push(t.maxA(Math.round(this._pendingAmp ?? amp)));
      if (charging && sessKwh !== null) sub.push(`${this._kwhNum(sessKwh)} ${t.since(this._time(sess.chargeStart ?? sess.start))}`);
      else if (sess) sub.push(t.plugged(this._when(sess.start)));
    } else if (sess && sess.end) {
      const cs = sess.chargeStart ?? sess.start, ce = sess.chargeEnd ?? sess.end;
      sub.push(t.lastSession(`${this._when(cs)}–${this._time(ce)} · ${this._dur((ce - cs) / 1000)}`));
    } else if (!offline) sub.push(t.noCar);

    // The car's own battery level as a bar while it is plugged in, with its charge limit marked.
    let socHtml = "";
    const soc = this._val(c.car_soc), target = this._val(c.car_target);
    if ((plugged || charging) && soc !== null) {
      const pct = Math.max(0, Math.min(100, soc));
      const lag = `animation-delay:-${((now % 2000) / 1000).toFixed(2)}s`;
      socHtml = `<button class="soc" data-action="info" data-entity="${gcEsc(c.car_soc)}"><b>${Math.round(soc)} %</b>
        <div class="track"><div class="fill" style="width:${pct}%;${lag}"></div>${target !== null && target > 0 && target < 100 ? `<div class="tgt" style="left:${target}%"></div>` : ""}</div>
        ${target !== null ? `<span>${gcEsc(t.socTarget(Math.round(target)))}</span>` : ""}</button>`;
    }

    // Alerts
    const alerts = [];
    if (offline) alerts.push(["", t.alertOffline]);
    else if (hasErr) alerts.push(["", t.alertError(err)]);
    if (!offline && force === "off" && plugged) alerts.push(["amber", t.alertForcedOff]);
    if (!offline && force === "on" && plugged) alerts.push(["amber", t.alertForcedOn]);
    if (charging && this._expanded && this._s(c.load_balancing) === "on") alerts.push(["heat", t.balancing]);
    if (charging && phaseMode === "one" && this._s(c.water_heater) === "on") alerts.push(["heat", t.vvb]);

    const fold = `<button class="fold" data-action="fold" aria-expanded="${this._expanded}" aria-label="${gcEsc(this._expanded ? t.collapse : t.expand)}" title="${gcEsc(this._expanded ? t.collapse : t.expand)}">${GC_CHEVRON}</button>`;
    const showChart = sess && (plugged || this._expanded);
    const chart = showChart ? this._chart(sess, an, charging) : "";
    const middle = `<div class="chartrow"><div class="chartwrap">${chart}</div>${fold}</div>`;

    const name = c.name || "go-e";
    const icon = gcEsc(c.icon || "mdi:ev-station");
    const html = `
        <div class="top">
          <div class="lead">
            <button class="ibox ${iconCls}" data-action="info" data-entity="${gcEsc(c.car)}" aria-label="${gcEsc(name)}"><ha-icon icon="${icon}"></ha-icon></button>
            <div style="min-width:0">
              <div class="name">${gcEsc(name)}</div>
              <button class="big" data-action="info" data-entity="${gcEsc(charging ? c.power : c.session_energy)}">${gcEsc(big)}${bigUnit ? `<small>${gcEsc(bigUnit)}</small>` : ""}</button>
            </div>
          </div>
          <button class="chip ${chipCls}" data-action="info" data-entity="${gcEsc(c.status && this._st(c.status) ? c.status : c.car)}"><span>${gcEsc(chipText)}</span></button>
        </div>
        ${sub.filter(Boolean).length ? `<div class="sub">${sub.filter(Boolean).map(gcEsc).join(" · ")}</div>` : ""}
        ${socHtml}
        ${alerts.map(([cls, text]) => `<div class="alert ${cls}">${gcEsc(text)}</div>`).join("")}
        ${this._ctrlHtml(force, amp, offline)}
        ${middle}
        ${this._expanded ? this._moreHtml(sess, an, plugged, phaseMode, logic, offline, now) : ""}`;

    // Hold the current height for two frames so a re-render never shrinks the page under the finger.
    const h = this._card.offsetHeight;
    if (h) this._card.style.minHeight = `${h}px`;
    this._body.innerHTML = html;
    requestAnimationFrame(() => requestAnimationFrame(() => { this._card.style.minHeight = ""; }));
  }

  _chart(sess, an, charging) {
    const t = this._t;
    const W = Math.max(160, (this._w || 300) - 42);
    const H = 64, AX = 16;
    const now = Date.now();
    const t0 = sess.start;
    const t1 = Math.max(sess.end ?? now, t0 + 600000);
    const span = t1 - t0;
    const pts = (this._pts || []).filter((p, i, a) => (p.t >= t0 || (a[i + 1] && a[i + 1].t > t0)) && p.t <= t1);
    if (!pts.some((p) => p.v > 100)) return "";
    const peak = Math.max(an?.peak || 0, ...pts.map((p) => p.v));
    const hi = Math.max(3700, peak) * 1.1;
    this._chartGeom = { W, t0, span };
    const x = (ms) => Math.max(0, Math.min(W, ((ms - t0) / span) * W));
    const y = (v) => H - 1 - (Math.max(0, Math.min(hi, v)) / hi) * (H - 4);
    let out = `<line class="base" x1="0" x2="${W}" y1="${H}" y2="${H}"/>`;
    // A dashed line at the nearest whole kW below the peak.
    const gridKw = Math.max(1, Math.floor(peak / 1000));
    if (peak > 1000) out += `<line class="grid" x1="0" x2="${W}" y1="${y(gridKw * 1000).toFixed(1)}" y2="${y(gridKw * 1000).toFixed(1)}"/><text x="2" y="${(y(gridKw * 1000) - 3).toFixed(1)}">${gridKw} kW</text>`;
    const vis = pts.map((p) => ({ t: Math.max(t0, p.t), v: p.v }));
    vis.push({ t: Math.min(now, sess.end ?? now), v: sess.end ? 0 : vis[vis.length - 1].v });
    let d = `M${x(vis[0].t).toFixed(1)},${y(vis[0].v).toFixed(1)}`;
    for (let i = 1; i < vis.length; i++) {
      const px = x(vis[i].t).toFixed(1);
      d += `L${px},${y(vis[i - 1].v).toFixed(1)}`;
      if (vis[i].v !== vis[i - 1].v) d += `L${px},${y(vis[i].v).toFixed(1)}`;
    }
    const area = `${d}L${x(vis[vis.length - 1].t).toFixed(1)},${H}L${x(vis[0].t).toFixed(1)},${H}Z`;
    out += `<path class="area" d="${area}"/><path class="line" d="${d}"/>`;
    if (charging && !sess.end) {
      // Energy running along the curve and a pulse at its live end. The negative delay keeps the
      // animation phase steady across re-renders, so it never restarts when the power updates.
      const lag = (ms) => `animation-delay:-${((now % ms) / 1000).toFixed(2)}s`;
      const ex = x(vis[vis.length - 1].t), ey = y(vis[vis.length - 1].v);
      out += `<path class="flow" d="${d}" style="${lag(1200)}"/>`
        + `<circle class="halo" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="7" style="${lag(1600)}"/>`
        + `<circle class="dot" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3"/>`;
    }
    const xn = x(now);
    if (!sess.end && xn > 0 && xn < W) out += `<line class="now" x1="${xn.toFixed(1)}" x2="${xn.toFixed(1)}" y1="0" y2="${H}"/>`;
    // Hour labels
    const stepH = span <= 4 * 3600000 ? 1 : span <= 10 * 3600000 ? 2 : span <= 24 * 3600000 ? 3 : 6;
    for (let ms = Math.ceil(t0 / 3600000) * 3600000; ms <= t1; ms += 3600000) {
      const hh = this._hourOf(ms);
      if (hh % stepH !== 0) continue;
      const px = x(ms);
      if (px < 44 || px > W - 44) continue;
      out += `<text x="${px.toFixed(1)}" y="${H + 13}" text-anchor="middle">${String(hh).padStart(2, "0")}</text>`;
    }
    out += `<text x="0" y="${H + 13}">${this._time(t0)}</text><text x="${W}" y="${H + 13}" text-anchor="end">${sess.end ? this._time(t1) : t.nowLabel}</text>`;
    if (this._hover !== null) {
      const hx = x(this._hover);
      out += `<line class="cur" x1="${hx.toFixed(1)}" x2="${hx.toFixed(1)}" y1="0" y2="${H}"/>`;
    }
    return `<svg class="ch" viewBox="0 0 ${W} ${H + AX}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H + AX}" role="img">${out}</svg>`;
  }

  _seg(entity, current, options, na) {
    return `<div class="seg ${na ? "na" : ""}" role="group">${options.map(([key, value, label, cls]) =>
      `<button class="${current === key ? `sel ${cls || ""}` : ""}" data-action="select" data-entity="${gcEsc(entity)}" data-option="${gcEsc(value)}" aria-pressed="${current === key}">${gcEsc(label)}</button>`).join("")}</div>`;
  }

  _ctrlHtml(force, amp, offline) {
    const t = this._t, c = this._config;
    if (!this._st(c.force) && !this._st(c.current)) return "";
    const seg = this._st(c.force) ? `<div style="min-width:0"><div class="lbl">${gcEsc(t.charge)}</div>${this._seg(c.force, force, [
      ["auto", GC_FORCE.auto, t.auto, "acc"], ["on", GC_FORCE.on, t.now, "acc"], ["off", GC_FORCE.off, t.pause, "stop"],
    ], offline || !this._ok(c.force))}</div>` : "<div></div>";
    let step = "";
    if (this._st(c.current) && amp !== null) {
      const a = this._st(c.current).attributes;
      const v = this._pendingAmp ?? amp;
      step = `<div><div class="lbl">${gcEsc(t.amps)}</div><div class="step">
        <button data-action="amp" data-delta="-1" aria-label="−" ${v <= (a.min ?? 6) || offline ? "disabled" : ""}>−</button>
        <b class="${this._pendingAmp !== null ? "pend" : ""}">${Math.round(v)} A</b>
        <button data-action="amp" data-delta="1" aria-label="+" ${v >= (a.max ?? 16) || offline ? "disabled" : ""}>+</button></div></div>`;
    }
    return `<div class="ctrls">${seg}${step}</div>`;
  }

  _moreHtml(sess, an, plugged, phaseMode, logic, offline, now) {
    const t = this._t, c = this._config;
    const stat = (value, label, extra = "", id = null) => {
      if (value === null || value === undefined || value === "") return "";
      const tag = id ? `button class="stat" data-action="info" data-entity="${gcEsc(id)}"` : `div class="stat"`;
      return `<${tag}><b>${gcEsc(value)}</b><span>${gcEsc(label)}</span>${extra ? `<span>${gcEsc(extra)}</span>` : ""}</${id ? "button" : "div"}>`;
    };
    let head = "";
    if (sess) {
      const dur = this._dur(((sess.end ?? now) - sess.start) / 1000);
      head = `<div class="ghead"><span>${gcEsc(plugged ? t.thisSession : t.lastSessionHead)}</span><span class="hint${this._hover !== null ? " live" : ""}">${gcEsc(this._hintText(sess, dur))}</span></div>`;
    }
    const rows = [];
    if (this._st(c.phase_mode)) rows.push(`<div style="min-width:0"><div class="lbl">${gcEsc(t.phaseMode)}</div>${this._seg(c.phase_mode, phaseMode, [
      ["auto", GC_PHASE.auto, t.auto], ["one", GC_PHASE.one, t.one], ["three", GC_PHASE.three, t.three],
    ], offline || !this._ok(c.phase_mode))}</div>`);
    if (this._st(c.logic_mode)) rows.push(`<div style="min-width:0"><div class="lbl">${gcEsc(t.logic)}</div>${this._seg(c.logic_mode, logic, [
      ["standard", GC_LOGIC.standard, t.mode.standard], ["eco", GC_LOGIC.eco, t.mode.eco], ["trip", GC_LOGIC.trip, t.mode.trip],
    ], offline || !this._ok(c.logic_mode))}</div>`);
    const sessKwh = this._val(c.session_energy);
    const phase = (n) => {
      const v = this._val(c[`voltage_l${n}`]), a = this._val(c[`current_l${n}`]), w = this._val(c[`power_l${n}`]);
      if (v === null && a === null) return "";
      return stat(`${a !== null ? this._num(a, 1) : "–"} A`, t.phase(n), `${v !== null ? Math.round(v) : "–"} V · ${w !== null ? this._watt(w) : "–"}`, c[`current_l${n}`]);
    };
    const pv = this._st(c.pv_surplus);
    const stats = [
      stat(sessKwh !== null ? this._kwhNum(sessKwh) : null, t.statEnergy, an && an.onSec > 60 ? t.statCharged(this._dur(an.onSec)) : "", c.session_energy),
      an && an.peak > 0 ? stat(this._watt(an.peak), t.statPeak, "", c.power) : "",
      stat(this._val(c.total_energy) !== null ? `${new Intl.NumberFormat(this._lang, { maximumFractionDigits: 0 }).format(this._val(c.total_energy))} kWh` : null, t.statTotal, "", c.total_energy),
      phase(1), phase(2), phase(3),
    ].join("");
    const pvRow = pv ? `<div class="rows"><button class="tog ${this._s(c.pv_surplus) === "on" ? "on" : ""}" data-action="toggle" data-entity="${gcEsc(c.pv_surplus)}">${gcEsc(t.pv)}<span>${gcEsc(this._s(c.pv_surplus) === "on" ? t.on : t.off)}</span></button>${this._statusHtml()}</div>` : "";
    return `<div class="more">${head}<div class="rows">${rows.join("")}</div>${pvRow}<div class="stats">${stats}</div>${this._usageHtml()}</div>`;
  }

  _statusHtml() {
    const c = this._config, t = this._t;
    if (!this._ok(c.status)) return "";
    const raw = this._s(c.status);
    const text = t.statusText[raw] || raw;
    return `<button class="tog" data-action="info" data-entity="${gcEsc(c.status)}">${gcEsc(t.status)}<span>${gcEsc(text)}</span></button>`;
  }

  _hintText(sess, dur) {
    if (this._hover !== null) {
      let hit = null;
      for (const p of this._pts || []) { if (p.t <= this._hover) hit = p; else break; }
      if (hit) return this._t.hover(this._time(this._hover), this._watt(hit.v));
    }
    return this._t.started(this._when(sess.start), dur);
  }

  // ------------------------------------------------------------------ events

  _setHover(ms) {
    if (ms === this._hover) return;
    this._hover = ms;
    this._sig = "";
    this._render();
  }

  _onPointer(e) {
    const bars = e.target.closest?.("svg.bars");
    if (bars) {
      const g = this._barGeom;
      if (!g) return;
      const box = bars.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * Number(bars.viewBox.baseVal.width);
      const i = Math.floor((px - g.L) / g.slot);
      const k = i >= 0 && i < g.keys.length ? g.keys[i] : null;
      if (k !== this._barHover) { this._barHover = k; this._sig = ""; this._render(); }
      return;
    }
    const svg = e.target.closest?.("svg.ch");
    if (!svg || !this._expanded || !this._chartGeom) return;
    const box = svg.getBoundingClientRect();
    const g = this._chartGeom;
    const frac = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    const ms = g.t0 + frac * g.span;
    if (ms > Date.now()) { this._setHover(null); return; }
    this._setHover(Math.round(ms / 60000) * 60000);
  }

  _onClick(e) {
    if (e.target.closest?.("svg.ch") && !this._expanded) {
      this._expanded = true; this._sig = ""; this._render();
      return;
    }
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action, id = el.dataset.entity;
    if (action === "fold") {
      this._expanded = !this._expanded;
      this._hover = null;
      this._sig = "";
      this._render();
    } else if (action === "select" && id) {
      if (this._s(id) !== el.dataset.option) this._hass.callService("select", "select_option", { entity_id: id, option: el.dataset.option });
    } else if (action === "toggle" && id) {
      this._hass.callService("switch", "toggle", { entity_id: id });
    } else if (action === "amp") {
      // Collect taps for a moment and send one value, so the charger is not stepped through every amp.
      const id2 = this._config.current;
      const a = this._st(id2)?.attributes || {};
      const base = this._pendingAmp ?? this._val(id2);
      if (base === null) return;
      const next = Math.max(a.min ?? 6, Math.min(a.max ?? 16, base + Number(el.dataset.delta)));
      this._pendingAmp = next;
      clearTimeout(this._ampTimer);
      this._ampTimer = setTimeout(() => {
        this._ampTimer = null;
        this._hass.callService("number", "set_value", { entity_id: id2, value: this._pendingAmp });
        // Drop the pending mark if the charger never confirms.
        setTimeout(() => { if (this._pendingAmp !== null) { this._pendingAmp = null; this._sig = ""; this._render(); } }, 8000);
      }, 700);
      this._sig = "";
      this._render();
    } else if (action === "info" && id) {
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
    }
  }
}

class GoeCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._build();
  }
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    else this._build();
  }
  get _t() { return (this._hass?.locale?.language || this._hass?.language || "en").startsWith("sv") ? GC_TEXT.sv : GC_TEXT.en; }

  _build() {
    if (!this._config || !this._hass) return;
    if (this._form) { this._form.data = this._config; return; }
    const t = this._t;
    const sel = (options) => ({ select: { mode: "dropdown", options: Object.entries(options).map(([value, label]) => ({ value, label })) } });
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._config;
    form.computeLabel = (s) => t.pick[s.name] || s.name;
    form.schema = [
      { name: "prefix", selector: { text: {} } },
      { name: "name", selector: { text: {} } },
      {
        name: "extra", type: "expandable", flatten: true, schema: [
          { name: "load_balancing", selector: { entity: {} } },
          { name: "water_heater", selector: { entity: {} } },
          { name: "history_power", selector: { entity: { domain: "sensor", device_class: "power" } } },
          { name: "history_hours", selector: { number: { min: 24, max: 240, step: 1, mode: "box", unit_of_measurement: "h" } } },
          { name: "car_soc", selector: { entity: { domain: "sensor" } } },
          { name: "car_target", selector: { entity: { domain: "sensor" } } },
          { name: "price", selector: { entity: { domain: "sensor" } } },
          { name: "price_extra", selector: { number: { min: 0, max: 10, step: 0.001, mode: "box", unit_of_measurement: "kr/kWh" } } },
        ],
      },
      {
        name: "look", type: "expandable", flatten: true, schema: [
          { name: "secondary_text", selector: sel(t.dimOptions) },
          { name: "expanded", selector: { boolean: {} } },
        ],
      },
      {
        name: "ents", type: "expandable", flatten: true,
        schema: Object.keys(GC_KEYS).map((k) => ({ name: k, selector: { entity: {} } })),
      },
    ];
    form.addEventListener("value-changed", (e) => {
      const v = { ...e.detail.value };
      for (const k of Object.keys(v)) if (v[k] === "" || v[k] === undefined || v[k] === null) delete v[k];
      this._config = v;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: v }, bubbles: true, composed: true }));
    });
    this.appendChild(form);
    this._form = form;
  }
}

if (!customElements.get("goe-card")) {
  customElements.define("goe-card", GoeCard);
  customElements.define("goe-card-editor", GoeCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "goe-card",
    name: "go-e laddbox",
    description: "go-e charger: power, session energy and curve, charge now/pause/auto, current, phases, mode, charged per month/year with cost.",
    preview: true,
  });
  console.info(`%c GOE-CARD %c ${GC_CARD_VERSION} `, "background:#35c7d9;color:#10181c;font-weight:700", "background:#e6e6e6;color:#10181c");
}
