/*
 * Water Heater Planner card
 *
 * One file, no build step. Served by the integration itself (no dashboard resource needed).
 * Reads everything from the integration's "Status" sensor: its attributes carry the plan, the
 * prices and the ids of the settings entities, so the card only needs that one entity.
 *
 *   type: custom:waterheater-planner-card
 *   entity: sensor.varmvattenberedare_status
 *   name: Varmvatten              # optional
 *   settings: collapsed           # collapsed (default) | open | hidden
 */

const WH_CARD_VERSION = "0.1.0";

const WH_TEXT = {
  sv: {
    now: "nu",
    ready: "klar",
    modes: { cheapest: "Billigast", solar: "Sol", hybrid: "Hybrid" },
    status: {
      disabled: "Automatiken är av",
      no_temperature: "Temperatur saknas",
      switch_unavailable: "Strömbrytaren svarar inte",
      at_target: "Varmt nog",
      idle: "Vilar",
      waiting_cheap: "Väntar på billig tid",
      waiting_sun: "Väntar på sol",
      heating_grid: "Värmer med billig el",
      heating_solar: "Värmer med sol",
      heating_base: "Värmer till grundtemperatur",
      heating_sun_slot: "Värmer, soltimme",
      comfort_floor: "Värmer, under komfortgränsen",
      floor_price_cap: "Väntar, elpriset över taket",
      manual: "Manuell värmning",
      boost: "Värmer nu",
      no_prices: "Elpris saknas, värmer ändå",
      no_surplus_sensor: "Sol-läget saknar elnätssensor",
    },
    plannedCost: "Planerad kostnad",
    sunPriced: "Kostnaden räknar solenergin som utebliven försäljning.",
    lastHeating: "Senaste värmning",
    lastRunning: "Pågående värmning",
    lastNone: "ingen registrerad än",
    lastSolar: (k) => `varav ${k} sol`,
    saving: (v) => `${v} billigare än att värma direkt`,
    free: "Gratis från solen",
    energy: "Energi",
    runtime: "Värmetid",
    sunExpected: (v) => `Solen väntas ge ca ${v}`,
    split: (sun, grid) => `${sun} från sol, ${grid} från nätet`,
    allSun: "Allt väntas komma från solen. Nätet tar över om solen uteblir.",
    warm: "Vattnet är varmt nog, inget att planera.",
    waitPrices: "Väntar på morgondagens elpris, planen byggs ut då.",
    tooLate: "Hinner inte till klockslaget, värmer så fort det går.",
    noPrices: "Elpriset kunde inte hämtas.",
    periods: "Planerad värmning",
    noPeriods: "Ingen värmning från nätet planerad.",
    legendHeated: "värmt",
    legendPlan: "planerad värme",
    legendSun: "sol",
    legendPrice: "elpris",
    planned: "planerad",
    ranFor: (m) => `värmde ${m} min`,
    reasons: {
      heating_grid: "billig el enligt planen", heating_solar: "solöverskott", heating_sun_slot: "vald soltimme",
      heating_base: "grundtemperaturen", comfort_floor: "under komfortgränsen", boost: "Värm nu",
      no_prices: "elpris saknades",
    },
    settings: "Inställningar",
    mode: "Läge",
    targetTemp: "Måltemperatur",
    floor: "Komfortgräns",
    floorOff: "av",
    floorCap: "Komfortgräns, max pris",
    noLimit: "ingen gräns",
    readyBy: "Färdigt senast",
    solarCap: "Soltimmar, elprisgräns",
    solarStart: "Överskott för start",
    houseBase: "Husets grundlast",
    sunPricedSwitch: "Sol har ett pris (säljvärde)",
    surplusOnly: "Soltimmar: bara vid överskott",
    sellOther: "Sälj överskott utanför valda timmar",
    baseTemp: "Grundtemp. natt (Sol/Hybrid)",
    regrid: "Värm på nätet först under",
    baseBy: "Grundtemp. klar senast",
    baseOff: "av",
    maxPeriods: "Max antal värmeperioder",
    energyAdjust: "Energikorrigering",
    learnEnergy: "Lär sig energibehovet",
    learnedFrom: (n) => `auto, från ${n} värmningar`,
    learnWaiting: (n) => `lär sig (${n} av 3)`,
    automatic: "Automatik",
    boost: "Värm nu",
    boostOn: "Värmer nu, avbryt",
    missing: (e) => `Hittar inte ${e}. Välj statussensorn för varmvattenberedaren.`,
    pickEntity: "Statussensor",
    pickName: "Namn (valfritt)",
    tempSensor: "Temperatursensorn",
    usage: "Förbrukning",
    usageTitle: "Förbrukning och kostnad",
    today: "Idag", week: "Vecka", month: "Månad",
    energy: "Energi", cost: "Kostnad", ofWhichSun: "varav sol",
    costSince: (d) => `Kostnaden räknas sedan ${d}.`,
    energyOwn: "Energin är det integrationen själv har mätt. Välj energisensorer i integrationens inställningar för exakta värden.",
    close: "Stäng",
    help: {
      target_temperature: "Temperaturen vattnet ska värmas till.",
      min_temperature: "Under den här temperaturen värms vattnet direkt, oavsett plan. Ett skydd mot kallt vatten. 0 = av.",
      floor_max_price: "Komfortgränsen värmer inte när elpriset är över detta. Då väntar den på den vanliga planen (billiga timmar, sol). 0 = ingen gräns.",
      regrid_below: "Efter att en värmning nått måltemperaturen planeras ingen ny nätvärme före nästa Färdigt senast så länge vattnet är minst så här varmt. Solöverskott får fortfarande värma. Därefter nollställs den. 0 = av.",
      solar_start: "Solöverskott som krävs för att starta värmning på sol. Den stänger av sig när överskottet ligger under hälften av beredarens effekt i 5 minuter.",
      house_baseline: "Vad huset förbrukar ändå. Dras bort från solprognosen när soltimmar räknas ut.",
      solar_price_cap: "Soltimmar med pris under gränsen är öppna för beredaren. Är de inte nog läggs de billigaste dyrare soltimmarna till. 0 = av.",
      sunpriced: "Bara kostnadsberäkningen. På: solen kostar timmens elpris (den hade kunnat säljas). Av: solen är gratis. Ändrar inte vad beredaren gör.",
      sellother: "På: överskott utanför de valda soltimmarna säljs i stället för att värma. Av: överskott används i alla timmar.",
      surplusonly: "På: de valda soltimmarna värmer bara på verkligt överskott och köper inget från nätet. Av: de värmer oavsett överskott och nätet fyller i.",
      base_temperature: "Sol- och Hybrid-läge: nätet värmer upp till den här temperaturen i de billigaste timmarna före tiden nedan. Resten tar solen. 0 = av.",
      baseby: "När grundtemperaturen ska vara nådd.",
      ready: "När vattnet ska vara varmt. Planen räknas fram till nästa gång den tiden inträffar.",
      max_periods: "Det högsta antalet separata värmeperioder planeraren får dela upp värmningen i.",
      energy_adjust: "Justerar energibehovet som räknas ut. Plus = mer energi, minus = mindre. Med inlärning på räknas det ut av hur tidigare värmningar gått.",
      learn: "På: energikorrigeringen lärs av riktiga värmningar. Av: den manuella korrigeringen används.",
      automatic: "Av: planeraren rör inte strömbrytaren alls.",
      boost: "Värmer till måltemperaturen direkt, oavsett pris. Slutar när målet nåtts.",
    },
    pickSettings: "Inställningar",
    settingsOptions: { collapsed: "Hopfällda", open: "Öppna", hidden: "Dolda" },
  },
  en: {
    now: "now",
    ready: "ready",
    modes: { cheapest: "Cheapest", solar: "Solar", hybrid: "Hybrid" },
    status: {
      disabled: "Automation is off",
      no_temperature: "No temperature reading",
      switch_unavailable: "Switch not responding",
      at_target: "Warm enough",
      idle: "Idle",
      waiting_cheap: "Waiting for a cheap hour",
      waiting_sun: "Waiting for sun",
      heating_grid: "Heating on cheap power",
      heating_solar: "Heating on solar",
      heating_base: "Heating to base temperature",
      heating_sun_slot: "Heating, sun hour",
      comfort_floor: "Heating, below comfort floor",
      floor_price_cap: "Waiting, price above the cap",
      manual: "Manual heating",
      boost: "Heating now",
      no_prices: "No price data, heating anyway",
      no_surplus_sensor: "Solar mode needs a grid sensor",
    },
    plannedCost: "Planned cost",
    sunPriced: "Cost counts sun energy as electricity not sold.",
    lastHeating: "Last heating",
    lastRunning: "Heating now",
    lastNone: "none recorded yet",
    lastSolar: (k) => `of which ${k} solar`,
    saving: (v) => `${v} cheaper than heating right away`,
    free: "Free from the sun",
    energy: "Energy",
    runtime: "Heating time",
    sunExpected: (v) => `The sun is expected to give about ${v}`,
    split: (sun, grid) => `${sun} from solar, ${grid} from the grid`,
    allSun: "All of it is expected from the sun. The grid takes over if the sun fails.",
    warm: "The water is warm enough, nothing to plan.",
    waitPrices: "Waiting for tomorrow's prices, the plan is extended then.",
    tooLate: "Cannot make the deadline, heating as fast as possible.",
    noPrices: "Spot prices could not be fetched.",
    periods: "Planned heating",
    noPeriods: "No grid heating planned.",
    legendHeated: "heated",
    legendPlan: "planned heating",
    legendSun: "solar",
    legendPrice: "price",
    planned: "planned",
    ranFor: (m) => `heated ${m} min`,
    reasons: {
      heating_grid: "cheap power as planned", heating_solar: "solar surplus", heating_sun_slot: "chosen sun hour",
      heating_base: "base temperature", comfort_floor: "below the comfort floor", boost: "Heat now",
      no_prices: "no price data",
    },
    settings: "Settings",
    mode: "Mode",
    targetTemp: "Target temperature",
    floor: "Comfort floor",
    floorOff: "off",
    floorCap: "Comfort floor, max price",
    noLimit: "no limit",
    readyBy: "Ready by",
    solarCap: "Sun hours, price limit",
    solarStart: "Surplus to start",
    houseBase: "House base load",
    sunPricedSwitch: "Price the sun (sell value)",
    surplusOnly: "Sun hours: only with surplus",
    sellOther: "Sell surplus outside chosen hours",
    baseTemp: "Night base temp (Solar/Hybrid)",
    regrid: "Grid re-heat only below",
    baseBy: "Base temp ready by",
    baseOff: "off",
    maxPeriods: "Max heating periods",
    energyAdjust: "Energy correction",
    learnEnergy: "Learn the energy need",
    learnedFrom: (n) => `auto, from ${n} heatings`,
    learnWaiting: (n) => `learning (${n} of 3)`,
    automatic: "Automatic",
    boost: "Heat now",
    boostOn: "Heating now, cancel",
    missing: (e) => `Cannot find ${e}. Pick the water heater's status sensor.`,
    pickEntity: "Status sensor",
    pickName: "Name (optional)",
    tempSensor: "Temperature sensor",
    usage: "Usage",
    usageTitle: "Usage and cost",
    today: "Today", week: "Week", month: "Month",
    energy: "Energy", cost: "Cost", ofWhichSun: "of which sun",
    costSince: (d) => `Cost is counted since ${d}.`,
    energyOwn: "Energy is what the integration has measured itself. Pick energy sensors in the integration's options for exact values.",
    close: "Close",
    help: {
      target_temperature: "The temperature the water is heated to.",
      min_temperature: "Below this temperature the water is heated immediately, whatever the plan. A guard against cold water. 0 = off.",
      floor_max_price: "The comfort floor does not heat while the price is above this. It then waits for the normal plan (cheap hours, sun). 0 = no limit.",
      regrid_below: "After a heating has reached the target, no new grid heating is planned before the next Ready by while the water is at least this warm. Solar surplus may still heat. It resets afterwards. 0 = off.",
      solar_start: "Solar surplus needed to start heating on sun. It stops when the surplus stays below half of the heater's power for 5 minutes.",
      house_baseline: "What the house draws anyway. Subtracted from the solar forecast when sun hours are worked out.",
      solar_price_cap: "Sun hours priced below the limit are open to the heater. If they are not enough, the cheapest dearer sun hours are added. 0 = off.",
      sunpriced: "Only the cost calculation. On: the sun costs the hour's electricity price (it could have been sold). Off: the sun is free. Does not change what the heater does.",
      sellother: "On: surplus outside the chosen sun hours is sold instead of heating. Off: surplus is used in every hour.",
      surplusonly: "On: the chosen sun hours heat only on real surplus and buy nothing from the grid. Off: they heat whatever the surplus and the grid fills in.",
      base_temperature: "Solar and Hybrid mode: the grid heats up to this temperature in the cheapest hours before the time below. The sun does the rest. 0 = off.",
      baseby: "When the base temperature should be reached.",
      ready: "When the water should be hot. The plan runs until the next time this occurs.",
      max_periods: "The most separate heating periods the planner may split the heating into.",
      energy_adjust: "Adjusts the calculated energy need. Plus = more energy, minus = less. With learning on it is worked out from how earlier heatings went.",
      learn: "On: the energy correction is learned from real heatings. Off: the manual correction is used.",
      automatic: "Off: the planner does not touch the switch at all.",
      boost: "Heats to the target now, whatever the price. Ends when the target is reached.",
    },
    pickSettings: "Settings",
    settingsOptions: { collapsed: "Collapsed", open: "Open", hidden: "Hidden" },
  },
};

const WH_CHIP = {
  heating_grid: "grid",
  heating_solar: "sun",
  heating_base: "grid",
  heating_sun_slot: "sun",
  waiting_cheap: "grid",
  waiting_sun: "sun",
  comfort_floor: "warn",
  floor_price_cap: "warn",
  manual: "warn",
  boost: "warn",
  no_temperature: "warn",
  switch_unavailable: "warn",
  no_prices: "warn",
  no_surplus_sensor: "warn",
};

const WH_STYLE = `
  :host { display: block; }
  ha-card { display: block; position: relative;
    --wh-grid: var(--wh-grid-color, #35c7d9);
    --wh-sun: var(--wh-sun-color, #f2a93b);
    --wh-text: var(--primary-text-color, #e6e6e6);
    --wh-dim: var(--secondary-text-color, #9aa0a6);
    --wh-line: color-mix(in srgb, var(--wh-text) 14%, transparent);
    --wh-bar: color-mix(in srgb, var(--wh-text) 20%, transparent);
    padding: 16px 16px 14px;
    overflow: hidden;
  }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--wh-grid); outline-offset: 2px; }

  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .name { font-size: 14px; color: var(--wh-dim); margin-bottom: 2px; }
  button.temp { border: 0; background: none; padding: 0; margin: 0; font-family: inherit; cursor: pointer; text-align: left; display: block; }
  button.temp:focus-visible { outline: 2px solid var(--wh-text); outline-offset: 4px; border-radius: 6px; }
  .temp { font-size: 44px; line-height: 1; font-weight: 300; letter-spacing: -1px; color: var(--wh-text); }
  .temp small { font-size: 18px; font-weight: 400; color: var(--wh-dim); letter-spacing: 0; margin-left: 4px; }
  .right { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; max-width: 70%; }
  .usagebtn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 999px; cursor: pointer;
    color: var(--wh-dim); background: color-mix(in srgb, var(--wh-text) 8%, transparent); }
  .usagebtn:hover { color: var(--wh-text); }
  .usagebtn:focus-visible, .xbtn:focus-visible { outline: 2px solid var(--wh-text); outline-offset: 2px; }
  .usagebtn svg { width: 16px; height: 16px; }
  .scrim { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; padding: 16px;
    background: color-mix(in srgb, var(--card-background-color, #1c1c1c) 70%, transparent); border-radius: inherit; }
  .sheet { width: 100%; max-width: 420px; box-sizing: border-box; padding: 16px; border-radius: 14px; color: var(--wh-text);
    background: var(--card-background-color, #1c1c1c); border: 1px solid var(--wh-line); box-shadow: 0 8px 28px rgba(0,0,0,.35); }
  .sheet h3 { margin: 0; font-size: 16px; font-weight: 500; }
  .sheet .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .xbtn { border: 0; background: none; color: var(--wh-dim); font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 8px; }
  .utable { display: grid; grid-template-columns: auto 1fr 1fr 1fr; gap: 8px 12px; align-items: baseline; font-size: 14px; }
  .utable .h { color: var(--wh-dim); font-size: 12px; text-align: right; }
  .utable .l { color: var(--wh-dim); }
  .utable .v { text-align: right; font-variant-numeric: tabular-nums; }
  .utable .sub { color: var(--wh-dim); font-size: 12px; }
  .unote { margin: 12px 0 0; font-size: 12px; color: var(--wh-dim); line-height: 1.4; }
  .chip {
    display: inline-flex; align-items: center; gap: 7px; max-width: 100%;
    padding: 6px 12px; border-radius: 999px; font-size: 13px; line-height: 1.2; text-align: right;
    color: var(--wh-text);
    background: color-mix(in srgb, var(--wh-text) 8%, transparent);
  }
  button.chip { border: 0; margin: 0; font-family: inherit; cursor: pointer; }
  button.chip:focus-visible { outline: 2px solid var(--wh-text); outline-offset: 2px; }
  .chip::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--wh-dim); }
  .chip.grid::before { background: var(--wh-grid); }
  .chip.sun::before { background: var(--wh-sun); }
  .chip.warn::before { background: var(--error-color, #e5534b); }
  .chip.on { background: color-mix(in srgb, var(--wh-grid) 18%, transparent); }
  .chip.on.sun { background: color-mix(in srgb, var(--wh-sun) 20%, transparent); }

  .gauge { position: relative; height: 6px; margin: 14px 0 4px; border-radius: 3px; background: var(--wh-line); }
  .gauge .fill { position: absolute; inset: 0 auto 0 0; border-radius: 3px; background: linear-gradient(90deg, var(--wh-grid), var(--wh-sun)); }
  .gauge .mark { position: absolute; top: -3px; width: 2px; height: 12px; border-radius: 1px; background: var(--wh-text); opacity: .75; }
  .gauge-labels { position: relative; height: 14px; font-size: 11px; color: var(--wh-dim); }
  .gauge-labels span { position: absolute; transform: translateX(-50%); white-space: nowrap; }

  .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin: 14px 0 12px; padding: 3px; border-radius: 10px; background: var(--wh-line); }
  .modes button { border: 0; padding: 8px 6px; border-radius: 8px; background: transparent; font-size: 14px; color: var(--wh-dim); }
  .modes button[aria-pressed="true"] { color: #10181c; font-weight: 600; }
  .modes button[data-mode="cheapest"][aria-pressed="true"] { background: var(--wh-grid); }
  .modes button[data-mode="solar"][aria-pressed="true"] { background: var(--wh-sun); }
  .modes button[data-mode="hybrid"][aria-pressed="true"] { background: linear-gradient(100deg, var(--wh-grid) 0 50%, var(--wh-sun) 50% 100%); }

  .summary { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 14px; margin-bottom: 4px; }
  .summary > div:first-child { flex: 1 1 150px; min-width: 0; }
  .lastheat { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--wh-dim); margin: 8px 0 0; }
  .lastheat b { font-weight: 500; color: var(--wh-text); }
  .cost-label { font-size: 12px; color: var(--wh-dim); }
  .cost { font-size: 28px; line-height: 1.1; font-weight: 400; color: var(--wh-text); }
  .saving { font-size: 12px; color: var(--wh-grid); margin-top: 2px; }
  .facts { display: flex; gap: 18px; text-align: right; margin-left: auto; }
  .fact b { display: block; font-size: 16px; font-weight: 500; color: var(--wh-text); white-space: nowrap; }
  .fact span { font-size: 11px; color: var(--wh-dim); white-space: nowrap; }
  .note { font-size: 13px; color: var(--wh-dim); margin: 6px 0 2px; }

  .hint { height: 18px; margin-top: 10px; font-size: 12px; color: var(--wh-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint.live { color: var(--wh-text); }
  svg.chart { display: block; width: 100%; height: auto; max-width: 100%; touch-action: pan-y; user-select: none; }
  svg text { font-size: 11px; fill: var(--wh-dim); font-family: inherit; }
  .legend { display: flex; gap: 14px; margin-top: 4px; font-size: 11px; color: var(--wh-dim); }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }

  .periods { margin-top: 12px; border-top: 1px solid var(--wh-line); }
  .periods h3 { margin: 10px 0 4px; font-size: 12px; font-weight: 500; color: var(--wh-dim); }
  .period { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; font-size: 14px; color: var(--wh-text); }
  .period span:last-child { color: var(--wh-dim); text-align: right; }

  .toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 10px; padding: 10px 0 2px; border: 0; border-top: 1px solid var(--wh-line); background: none; font-size: 13px; color: var(--wh-dim); }
  .toggle svg { width: 16px; height: 16px; transition: transform .15s; }
  .toggle[aria-expanded="true"] svg { transform: rotate(180deg); }
  .settings { display: none; padding-top: 4px; }
  .settings.open { display: block; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-size: 14px; color: var(--wh-text); }
  .row .dimval { color: var(--wh-dim); font-size: 13px; }
  .row [data-action="help"] { cursor: help; text-decoration: underline dotted color-mix(in srgb, var(--wh-dim) 60%, transparent); text-underline-offset: 4px; }
  .helptext { margin: -6px 0 8px; font-size: 12px; color: var(--wh-dim); line-height: 1.4; }
  .row small { color: var(--wh-dim); font-size: 12px; }
  .stepper { display: inline-flex; align-items: center; gap: 2px; border-radius: 10px; background: var(--wh-line); }
  .stepper button { width: 36px; height: 36px; border: 0; background: none; font-size: 20px; line-height: 1; color: var(--wh-text); border-radius: 10px; }
  .stepper output { min-width: 46px; text-align: center; font-variant-numeric: tabular-nums; }
  input[type="time"] { font: inherit; color: var(--wh-text); background: var(--wh-line); border: 0; border-radius: 10px; padding: 8px 10px; color-scheme: dark light; }
  .switch { position: relative; width: 44px; height: 26px; border: 0; border-radius: 13px; background: var(--wh-line); padding: 0; transition: background .15s; }
  .switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--wh-text); opacity: .7; transition: transform .15s; }
  .switch[aria-checked="true"] { background: var(--wh-grid); }
  .switch[aria-checked="true"]::after { transform: translateX(18px); background: #10181c; opacity: 1; }
  .boost { width: 100%; margin-top: 8px; padding: 11px; border-radius: 10px; border: 1px solid var(--wh-line); background: none; font-size: 14px; color: var(--wh-text); }
  .boost[aria-pressed="true"] { background: color-mix(in srgb, var(--wh-sun) 22%, transparent); border-color: var(--wh-sun); }
  .error { padding: 8px 0; font-size: 14px; color: var(--error-color, #e5534b); }
  @media (prefers-reduced-motion: reduce) { .toggle svg, .switch, .switch::after { transition: none; } }
`;

function whEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

class WaterHeaterPlannerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._open = null;
    this._usageOpen = false;
    this._helpOpen = new Set();
    this._sig = "";
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
    this.shadowRoot.addEventListener("pointermove", (e) => this._onPointer(e));
    this.shadowRoot.addEventListener("pointerout", (e) => {
      const inChart = e.target.closest?.("svg.chart");
      if (inChart && !e.relatedTarget?.closest?.("svg.chart")) this._resetHint();
    });
    this._w = 0;
  }

  connectedCallback() {
    if (typeof ResizeObserver === "undefined") return;
    this._ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width) - 32; // the card's own padding
      if (w > 120 && Math.abs(w - this._w) >= 6) {
        this._w = w;
        this._sig = "";
        this._render();
      }
    });
    this._ro.observe(this);
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    this._ro = null;
  }

  static getConfigElement() {
    return document.createElement("waterheater-planner-card-editor");
  }

  static getStubConfig(hass) {
    const found = Object.keys(hass?.states || {}).find((id) => id.startsWith("sensor.") && hass.states[id].attributes?.price_area !== undefined && hass.states[id].attributes?.entities);
    return { entity: found || "" };
  }

  setConfig(config) {
    if (!config || !config.entity) throw new Error("entity is required");
    this._config = { settings: "collapsed", ...config };
    if (this._open === null) this._open = this._config.settings === "open";
    this._sig = "";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() { return 7; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  // ------------------------------------------------------------------ helpers

  get _lang() {
    const l = this._hass?.locale?.language || this._hass?.language || "en";
    return l;
  }
  get _t() { return this._lang.startsWith("sv") ? WH_TEXT.sv : WH_TEXT.en; }
  get _tz() { return this._hass?.config?.time_zone || undefined; }

  _num(value, digits = 1) {
    return new Intl.NumberFormat(this._lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  }
  _money(value, currency) {
    try {
      return new Intl.NumberFormat(this._lang, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    } catch (_) {
      return `${this._num(value, 2)} ${currency}`;
    }
  }
  _time(ms) {
    return new Intl.DateTimeFormat(this._lang, { hour: "2-digit", minute: "2-digit", timeZone: this._tz, hour12: false }).format(ms);
  }
  _day(ms) {
    return new Intl.DateTimeFormat(this._lang, { weekday: "short", timeZone: this._tz }).format(ms);
  }
  _dayKey(ms) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: this._tz }).format(ms);
  }
  _whenLabel(ms) {
    const sameDay = this._dayKey(ms) === this._dayKey(Date.now());
    return sameDay ? this._time(ms) : `${this._day(ms)} ${this._time(ms)}`;
  }
  _hours(minutes) {
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  _signature(stateObj) {
    const ids = Object.values(stateObj.attributes.entities || {});
    return [stateObj.last_updated, ...ids.map((id) => this._hass.states[id]?.last_updated)].join("|") + this._lang + this._open + this._usageOpen + [...this._helpOpen].join(",");
  }

  // ------------------------------------------------------------------ rendering

  _render() {
    if (!this._config || !this._hass) return;
    const stateObj = this._hass.states[this._config.entity];
    const sig = stateObj ? this._signature(stateObj) : "missing";
    if (sig === this._sig) return;
    this._sig = sig;
    const t = this._t;
    if (!stateObj) {
      this.shadowRoot.innerHTML = `<style>${WH_STYLE}</style><ha-card><div class="error">${whEsc(t.missing(this._config.entity))}</div></ha-card>`;
      return;
    }
    this.shadowRoot.innerHTML = `<style>${WH_STYLE}</style><ha-card>${this._body(stateObj)}</ha-card>`;
    this._decorateHelp();
  }

  /** Explanatory texts for the settings: a tooltip on hover, and a tap on the label shows them under the row. */
  _decorateHelp() {
    const help = this._t.help || {};
    for (const row of this.shadowRoot.querySelectorAll(".settings .row")) {
      const control = row.querySelector("[data-key],[data-action]");
      const key = control ? control.dataset.key || control.dataset.action : "energy_adjust";
      const text = help[key];
      const label = row.querySelector("span");
      if (!text || !label) continue;
      row.title = text;
      label.dataset.action = "help";
      label.dataset.help = key;
      if (this._helpOpen.has(key)) row.insertAdjacentHTML("afterend", `<p class="helptext">${whEsc(text)}</p>`);
    }
    const boost = this.shadowRoot.querySelector('[data-action="boost"]');
    if (boost && help.boost) boost.title = help.boost;
  }

  _body(stateObj) {
    const a = stateObj.attributes;
    const t = this._t;
    const status = stateObj.state;
    const name = this._config.name || a.friendly_name?.replace(/\s+Status$/i, "") || "";
    const temp = a.temperature;
    const parts = [];

    const chipKind = WH_CHIP[status] || "";
    const heating = a.heater_on === true;
    const sunHeat = status === "heating_solar" || status === "heating_sun_slot";
    parts.push(`
      <div class="top">
        <div>
          <div class="name">${whEsc(name)}</div>
          ${a.temperature_entity ? `<button type="button" class="temp" data-action="temp" aria-label="${whEsc(t.tempSensor)}" title="${whEsc(t.tempSensor)}">` : '<div class="temp">'}${temp == null ? "–" : this._num(temp, 1)}<small>°C</small>${a.temperature_entity ? "</button>" : "</div>"}
        </div>
        <div class="right">${`<button type="button" class="usagebtn" data-action="usage" aria-label="${whEsc(t.usage)}" title="${whEsc(t.usage)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V4M19 20v-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>`}<button type="button" class="chip ${chipKind} ${heating ? "on" : ""} ${heating && sunHeat ? "sun" : ""}" data-action="heater">${whEsc(t.status[status] || status)}</button></div>
      </div>
      ${this._gauge(a)}
      ${this._modes(a)}
      ${this._summary(a)}
      ${this._lastHeating(a)}
      ${this._chart(a)}
      ${this._periods(a)}
      ${this._settings(a)}
      ${this._usageSheet(a)}
    `);
    return parts.join("");
  }

  _usageSheet(a) {
    if (!this._usageOpen || !a.usage) return "";
    const t = this._t;
    const u = a.usage;
    const cols = [["day", t.today], ["week", t.week], ["month", t.month]];
    const kwh = (v) => `${this._num(Number(v), 1)} kWh`;
    const cell = (cls, text) => `<span class="${cls}">${text}</span>`;
    const rows = [
      cell("l", whEsc(t.energy)) + cols.map(([k]) => cell("v", kwh(u[k].kwh))).join(""),
      cell("l", whEsc(t.cost)) + cols.map(([k]) => cell("v", whEsc(this._money(u[k].cost, a.currency)))).join(""),
      cell("l sub", whEsc(t.ofWhichSun)) + cols.map(([k]) => cell("v sub", kwh(u[k].solar_kwh))).join(""),
    ];
    const since = [u.week, u.month].find((p) => p && p.complete === false) || (u.day.complete === false ? u.day : null);
    const notes = [];
    if (since) notes.push(t.costSince(since.since));
    if (cols.some(([k]) => u[k].kwh_source === "own")) notes.push(t.energyOwn);
    return `<div class="scrim" data-action="usage-close"><div class="sheet" role="dialog" aria-modal="true" aria-label="${whEsc(t.usageTitle)}">
      <div class="head"><h3>${whEsc(t.usageTitle)}</h3><button type="button" class="xbtn" data-action="usage-close" aria-label="${whEsc(t.close)}">×</button></div>
      <div class="utable"><span></span>${cols.map(([, label]) => cell("h", whEsc(label))).join("")}${rows.join("")}</div>
      ${notes.map((n) => `<p class="unote">${whEsc(n)}</p>`).join("")}
    </div></div>`;
  }

  _gauge(a) {
    if (a.temperature == null) return "";
    const lo = Math.min(20, a.temperature, a.min_temperature || 20);
    const hi = Math.max(a.target_temperature, a.temperature) + 5;
    const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const marks = [`<div class="mark" style="left:${pos(a.target_temperature)}%"></div>`];
    const labels = [`<span style="left:${pos(a.target_temperature)}%">${this._num(a.target_temperature, 0)}°</span>`];
    if (a.min_temperature > 0) {
      marks.push(`<div class="mark" style="left:${pos(a.min_temperature)}%;opacity:.4"></div>`);
      labels.push(`<span style="left:${pos(a.min_temperature)}%">${this._num(a.min_temperature, 0)}°</span>`);
    }
    return `<div class="gauge" aria-hidden="true"><div class="fill" style="width:${pos(a.temperature)}%"></div>${marks.join("")}</div><div class="gauge-labels" aria-hidden="true">${labels.join("")}</div>`;
  }

  _modes(a) {
    const t = this._t;
    return `<div class="modes" role="group" aria-label="${whEsc(t.mode)}">${["cheapest", "solar", "hybrid"]
      .map((m) => `<button data-action="mode" data-mode="${m}" aria-pressed="${a.mode === m}">${whEsc(t.modes[m])}</button>`)
      .join("")}</div>`;
  }

  _summary(a) {
    const t = this._t;
    if (a.plan_status === undefined) return "";
    const money = (v) => this._money(v, a.currency);
    let note = "";
    if (a.need_kwh <= 0) note = t.warm;
    else if (a.plan_status === "no_prices") note = t.noPrices;
    else if (a.plan_status === "insufficient") note = t.tooLate;
    else if (a.waiting_for_prices) note = t.waitPrices;
    else if (a.sun_priced) note = t.sunPriced;
    else if (a.mode === "solar") note = t.sunExpected(`${this._num(a.solar_kwh, 1)} kWh`);
    else if (a.mode === "hybrid" && a.grid_kwh <= 0 && a.solar_kwh > 0) note = t.allSun;
    else if (a.solar_kwh > 0) note = t.split(`${this._num(a.solar_kwh, 1)} kWh`, `${this._num(a.grid_kwh, 1)} kWh`);

    if (a.need_kwh <= 0) return `<p class="note">${whEsc(note)}</p>`;

    const free = a.grid_kwh <= 0 && a.solar_kwh > 0 && !a.sun_priced;
    const saving = a.saving > 0.005 ? `<div class="saving">${whEsc(t.saving(money(a.saving)))}</div>` : "";
    return `
      <div class="summary">
        <div>
          <div class="cost-label">${whEsc(t.plannedCost)}</div>
          <div class="cost">${free ? whEsc(t.free) : money(a.cost)}</div>
          ${free ? "" : saving}
        </div>
        <div class="facts">
          <div class="fact"><b>${this._num(a.need_kwh, 1)} kWh</b><span>${whEsc(t.energy)}</span></div>
          ${a.grid_kwh > 0 ? `<div class="fact"><b>${this._hours(a.runtime_min)}</b><span>${whEsc(t.runtime)}</span></div>` : ""}
        </div>
      </div>
      ${note ? `<p class="note">${whEsc(note)}</p>` : ""}`;
  }

  _lastHeating(a) {
    const t = this._t;
    if (a.last_heating_kwh == null) return `<div class="lastheat"><span>${whEsc(t.lastHeating)}</span><b>${whEsc(t.lastNone)}</b></div>`;
    const money = (v) => this._money(v, a.currency);
    const solar = Number(a.last_heating_solar_kwh || 0) > 0.01 ? ` · ${t.lastSolar(`${this._num(a.last_heating_solar_kwh, 1)} kWh`)}` : "";
    const when = a.last_heating_running ? t.lastRunning : `${t.lastHeating} · ${this._whenLabel(a.last_heating_start)}`;
    return `<div class="lastheat"><span>${whEsc(when)}</span><b>${this._num(a.last_heating_kwh, 1)} kWh · ${money(a.last_heating_cost)}${whEsc(solar)}</b></div>`;
  }

  _chart(a) {
    const prices = a.prices || [];
    if (prices.length < 2) return "";
    const t = this._t;
    const W = Math.max(240, this._w || 400), H = 162, top = 16, bottom = 128;
    const STEP = 15 * 60 * 1000;
    const t0 = prices[0][0];
    const t1 = prices[prices.length - 1][0] + STEP;
    const x = (ms) => ((ms - t0) / (t1 - t0)) * W;
    const values = prices.map((p) => p[1]);
    const lo = Math.min(0, ...values), hi = Math.max(...values, 1);
    const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
    const zero = y(0);
    const periods = a.periods || [];
    const planned = (ms) => periods.some((p) => ms < p.e && ms + STEP > p.s);
    const heated = a.heated || [];
    const ranOn = (ms) => heated.find((h) => ms < h[1] && ms + STEP > h[0]);
    this._chartData = { prices, t0, t1, W, planned, heated, power: a.power_w, minor: a.minor_unit };

    let sun = "";
    for (const h of a.solar_hours || []) {
      const x0 = Math.max(0, x(h.s)), x1 = Math.min(W, x(h.e));
      if (x1 <= x0) continue;
      sun += `<rect x="${x0.toFixed(1)}" y="${top - 6}" width="${(x1 - x0).toFixed(1)}" height="${bottom - top + 6}" fill="var(--wh-sun)" opacity=".13"/>`;
      sun += `<rect x="${x0.toFixed(1)}" y="${bottom + 3}" width="${(x1 - x0).toFixed(1)}" height="4" rx="2" fill="var(--wh-sun)"/>`;
    }

    let ran = "";
    for (const [s, e, solar] of heated) {
      const x0 = Math.max(0, x(s)), x1 = Math.min(W, x(Math.max(e, s + 60000)));
      if (x1 <= x0) continue;
      ran += `<rect x="${x0.toFixed(1)}" y="${bottom + 9}" width="${Math.max(1.5, x1 - x0).toFixed(1)}" height="5" rx="2" fill="${solar ? "var(--wh-sun)" : "var(--wh-grid)"}"/>`;
    }

    let bars = "";
    prices.forEach(([ms, v]) => {
      const bw = Math.max(0.6, x(ms + STEP) - x(ms) - 0.7);
      const yTop = Math.min(y(v), zero), h = Math.max(1, Math.abs(y(v) - zero));
      bars += `<rect x="${x(ms).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="0.8" fill="${ranOn(ms) ? (ranOn(ms)[2] ? "var(--wh-sun)" : "var(--wh-grid)") : planned(ms) ? "var(--wh-grid)" : "var(--wh-bar)"}" opacity="${ranOn(ms) ? 1 : planned(ms) ? 0.55 : 1}"/>`;
    });

    // time axis: a label every 3 or 6 hours, on local clock hours
    const spanH = (t1 - t0) / 3600000;
    const every = spanH > 30 ? 6 : 3;
    let ticks = "";
    for (let ms = Math.ceil(t0 / 3600000) * 3600000; ms < t1; ms += 3600000) {
      const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: this._tz }).format(ms)) % 24;
      if (hour % every !== 0) continue;
      const px = x(ms);
      if (px < 14 || px > W - 14) continue;
      ticks += `<text x="${px.toFixed(1)}" y="${H - 2}" text-anchor="middle">${String(hour).padStart(2, "0")}</text>`;
    }

    const nowX = Math.max(0, Math.min(W, x(Date.now())));
    const nowLine = `<line x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="${top - 8}" y2="${bottom}" stroke="var(--wh-text)" stroke-opacity=".55" stroke-width="1" stroke-dasharray="2 3"/>`;
    const deadline = a.deadline && a.deadline <= t1 + STEP
      ? `<text x="${W}" y="10" text-anchor="end">${whEsc(t.ready)} ${this._time(a.deadline)}</text>` : "";
    const peak = `<text x="2" y="10">${Math.round(hi)} ${whEsc(a.minor_unit)}/kWh</text>`;

    return `
      <div class="hint" id="hint" aria-live="polite"></div>
      <svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${whEsc(t.periods)}">
        ${sun}${lo < 0 ? `<line x1="0" x2="${W}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}" stroke="var(--wh-line)"/>` : ""}${bars}${ran}${nowLine}${peak}${deadline}${ticks}
      </svg>
      <div class="legend">${heated.length ? `<span><i style="background:var(--wh-grid)"></i>${whEsc(t.legendHeated)}</span>` : ""}<span><i style="background:var(--wh-grid);opacity:.55"></i>${whEsc(t.legendPlan)}</span>${(a.solar_hours || []).length ? `<span><i style="background:var(--wh-sun)"></i>${whEsc(t.legendSun)}</span>` : ""}<span><i style="background:var(--wh-bar)"></i>${whEsc(t.legendPrice)}</span></div>`;
  }

  _periods(a) {
    const t = this._t;
    if (a.plan_status === undefined || a.need_kwh <= 0 || a.mode === "solar") return "";
    const list = a.periods || [];
    if (!list.length) {
      return a.waiting_for_prices || a.grid_kwh > 0 ? "" : `<div class="periods"><h3>${whEsc(t.periods)}</h3><div class="period"><span>${whEsc(t.noPeriods)}</span></div></div>`;
    }
    const rows = list.map((p) => {
      const price = p.kwh > 0 ? this._avgPrice(p) : null;
      return `<div class="period"><span>${whEsc(this._whenLabel(p.s))} – ${whEsc(this._time(p.e))}</span><span>${this._num(p.kwh, 1)} kWh${price == null ? "" : ` · ${Math.round(price)} ${whEsc(a.minor_unit)}/kWh`}</span></div>`;
    });
    return `<div class="periods"><h3>${whEsc(t.periods)}</h3>${rows.join("")}</div>`;
  }

  _avgPrice(period) {
    const prices = this._chartData?.prices || [];
    const STEP = 15 * 60 * 1000;
    let energy = 0, cost = 0;
    for (const [ms, v] of prices) {
      const overlap = Math.min(period.e, ms + STEP) - Math.max(period.s, ms);
      if (overlap <= 0) continue;
      energy += overlap; cost += overlap * v;
    }
    return energy > 0 ? cost / energy : null;
  }

  _signed(pct) {
    return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${this._num(Math.abs(pct), 0)} %`;
  }

  _energyRows(a, stepper, adjust) {
    const t = this._t;
    if (!a.entities?.energy_adjust) return "";
    const learning = a.entities.learn_energy && a.energy_auto;
    const learned = a.energy_learned != null;
    const row = learning && learned
      ? `<div class="row"><span>${whEsc(t.energyAdjust)}</span><span class="dimval">${whEsc(this._signed(Number(a.energy_learned)))} · ${whEsc(t.learnedFrom(a.energy_samples))}</span></div>`
      : stepper("energy_adjust", adjust, t.energyAdjust, 5, this._signed(adjust));
    const toggle = a.entities.learn_energy
      ? `<div class="row"><span>${whEsc(t.learnEnergy)}${learning && !learned ? ` <small>${whEsc(t.learnWaiting(a.energy_samples || 0))}</small>` : ""}</span><button class="switch" role="switch" data-action="learn" aria-checked="${!!a.energy_auto}" aria-label="${whEsc(t.learnEnergy)}"></button></div>`
      : "";
    return row + toggle;
  }

  _settings(a) {
    if (this._config.settings === "hidden") return "";
    const t = this._t;
    const open = this._open;
    const stepper = (key, value, label, step = 1, shown = null) => `
      <div class="row"><span>${whEsc(label)}</span>
        <span class="stepper"><button data-action="step" data-key="${key}" data-delta="${-step}" aria-label="${whEsc(label)} −">−</button><output>${shown ?? (label === t.floor && value <= 0 ? whEsc(t.floorOff) : this._num(value, 0))}</output><button data-action="step" data-key="${key}" data-delta="${step}" aria-label="${whEsc(label)} +">+</button></span></div>`;
    const adjust = Number(a.energy_adjust || 0);
    return `
      <button class="toggle" data-action="toggle" aria-expanded="${open}"><span>${whEsc(t.settings)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="settings ${open ? "open" : ""}">
        ${stepper("target_temperature", a.target_temperature, t.targetTemp)}
        ${stepper("min_temperature", a.min_temperature, t.floor)}
        ${a.entities?.floor_max_price && a.min_temperature > 0 ? stepper("floor_max_price", Number(a.floor_max_price || 0), t.floorCap, 10, Number(a.floor_max_price || 0) > 0 ? `${this._num(Number(a.floor_max_price), 0)} ${whEsc(a.minor_unit || "")}` : whEsc(t.noLimit)) : ""}
        ${a.entities?.regrid_below ? stepper("regrid_below", Number(a.regrid_c || 0), t.regrid, 1, Number(a.regrid_c || 0) > 0 ? `${this._num(Number(a.regrid_c), 0)} °C` : whEsc(t.baseOff)) : ""}
        ${a.mode !== "cheapest" && a.entities?.solar_start ? stepper("solar_start", Number(a.solar_start), t.solarStart, 100, `${this._num(Number(a.solar_start), 0)} W`) : ""}
        ${a.mode !== "cheapest" && a.entities?.house_baseline ? stepper("house_baseline", Number(a.house_baseline), t.houseBase, 100, `${this._num(Number(a.house_baseline), 0)} W`) : ""}
        ${a.mode === "solar" && a.entities?.solar_price_cap ? stepper("solar_price_cap", Number(a.solar_price_cap || 0), t.solarCap, 10, Number(a.solar_price_cap || 0) > 0 ? `${this._num(Number(a.solar_price_cap), 0)} ${whEsc(a.minor_unit || "")}` : whEsc(t.baseOff)) : ""}
        ${a.mode === "solar" && a.entities?.sun_priced && Number(a.solar_price_cap || 0) > 0 ? `<div class="row"><span>${whEsc(t.sunPricedSwitch)}</span><button class="switch" role="switch" data-action="sunpriced" aria-checked="${!!a.sun_priced_setting}" aria-label="${whEsc(t.sunPricedSwitch)}"></button></div>` : ""}
        ${a.mode === "solar" && a.entities?.sell_other_sun && Number(a.solar_price_cap || 0) > 0 ? `<div class="row"><span>${whEsc(t.sellOther)}</span><button class="switch" role="switch" data-action="sellother" aria-checked="${!!a.sell_other_sun}" aria-label="${whEsc(t.sellOther)}"></button></div>` : ""}
        ${a.mode === "solar" && a.entities?.sun_surplus_only && Number(a.solar_price_cap || 0) > 0 ? `<div class="row"><span>${whEsc(t.surplusOnly)}</span><button class="switch" role="switch" data-action="surplusonly" aria-checked="${!!a.sun_surplus_only}" aria-label="${whEsc(t.surplusOnly)}"></button></div>` : ""}
        ${a.entities?.base_temperature ? stepper("base_temperature", Number(a.base_c || 0), t.baseTemp, 1, Number(a.base_c || 0) > 0 ? `${this._num(Number(a.base_c), 0)} °C` : whEsc(t.baseOff)) : ""}
        ${a.entities?.base_by && Number(a.base_c || 0) > 0 ? `<div class="row"><span>${whEsc(t.baseBy)}</span><input type="time" data-action="baseby" value="${whEsc(a.base_by)}" aria-label="${whEsc(t.baseBy)}"></div>` : ""}
        <div class="row"><span>${whEsc(t.readyBy)}</span><input type="time" data-action="ready" value="${whEsc(a.ready_by)}" aria-label="${whEsc(t.readyBy)}"></div>
        ${stepper("max_periods", a.max_periods, t.maxPeriods)}
        ${this._energyRows(a, stepper, adjust)}
        <div class="row"><span>${whEsc(t.automatic)}</span><button class="switch" role="switch" data-action="automatic" aria-checked="${a.automatic}" aria-label="${whEsc(t.automatic)}"></button></div>
        <button class="boost" data-action="boost" aria-pressed="${a.boost}">${whEsc(a.boost ? t.boostOn : t.boost)}</button>
      </div>`;
  }

  // ------------------------------------------------------------------ interaction

  _attrs() { return this._hass?.states[this._config?.entity]?.attributes; }

  _call(domain, service, data) {
    return this._hass.callService(domain, service, data);
  }

  _onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = this._attrs();
    if (!a) return;
    const ids = a.entities || {};
    switch (el.dataset.action) {
      case "mode":
        if (ids.mode) this._call("select", "select_option", { entity_id: ids.mode, option: el.dataset.mode });
        break;
      case "help":
        if (this._helpOpen.has(el.dataset.help)) this._helpOpen.delete(el.dataset.help);
        else this._helpOpen.add(el.dataset.help);
        this._sig = "";
        this._render();
        break;
      case "usage":
        this._usageOpen = true;
        this._sig = "";
        this._render();
        break;
      case "usage-close":
        if (e.target.closest(".sheet") && !e.target.closest(".xbtn")) break;
        this._usageOpen = false;
        this._sig = "";
        this._render();
        break;
      case "temp":
        if (a.temperature_entity) this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: a.temperature_entity } }));
        break;
      case "heater":
        if (a.switch_entity) this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: a.switch_entity } }));
        break;
      case "toggle":
        this._open = !this._open;
        this._sig = "";
        this._render();
        break;
      case "step": {
        const key = el.dataset.key;
        const limits = { target_temperature: [30, 85], min_temperature: [0, 70], max_periods: [1, 8], energy_adjust: [-50, 100], floor_max_price: [0, 1000], base_temperature: [0, 60], regrid_below: [0, 85], solar_price_cap: [0, 1000], solar_start: [50, 10000], house_baseline: [0, 10000] }[key];
        const next = Math.max(limits[0], Math.min(limits[1], Number(a[key]) + Number(el.dataset.delta)));
        if (ids[key] && next !== Number(a[key])) this._call("number", "set_value", { entity_id: ids[key], value: next });
        break;
      }
      case "automatic":
        if (ids.automatic) this._call("switch", a.automatic ? "turn_off" : "turn_on", { entity_id: ids.automatic });
        break;
      case "sellother":
        if (ids.sell_other_sun) this._call("switch", a.sell_other_sun ? "turn_off" : "turn_on", { entity_id: ids.sell_other_sun });
        break;
      case "surplusonly":
        if (ids.sun_surplus_only) this._call("switch", a.sun_surplus_only ? "turn_off" : "turn_on", { entity_id: ids.sun_surplus_only });
        break;
      case "sunpriced":
        if (ids.sun_priced) this._call("switch", a.sun_priced_setting ? "turn_off" : "turn_on", { entity_id: ids.sun_priced });
        break;
      case "learn":
        if (ids.learn_energy) this._call("switch", a.energy_auto ? "turn_off" : "turn_on", { entity_id: ids.learn_energy });
        break;
      case "boost":
        if (ids.boost) this._call("switch", a.boost ? "turn_off" : "turn_on", { entity_id: ids.boost });
        break;
    }
  }

  _onChange(e) {
    const el = e.target.closest("[data-action='ready'],[data-action='baseby']");
    const a = this._attrs();
    const id = a?.entities?.[el?.dataset.action === "baseby" ? "base_by" : "ready_by"];
    if (!el || !id || !el.value) return;
    this._call("time", "set_value", { entity_id: id, time: `${el.value}:00`.slice(0, 8) });
  }

  _onPointer(e) {
    const svg = e.target.closest?.("svg.chart");
    const d = this._chartData;
    const hint = this.shadowRoot.getElementById("hint");
    if (!svg || !d || !hint) return;
    const rect = svg.getBoundingClientRect();
    const ms = d.t0 + ((e.clientX - rect.left) / rect.width) * (d.t1 - d.t0);
    const STEP = 15 * 60 * 1000;
    const slot = d.prices.find(([s]) => ms >= s && ms < s + STEP);
    if (!slot) return this._resetHint();
    hint.classList.add("live");
    const parts = [this._whenLabel(slot[0]), `${Math.round(slot[1])} ${d.minor}/kWh`];
    const ran = this._ranIn(d, slot[0], STEP);
    if (ran) parts.push(ran);
    else if (d.planned(slot[0])) parts.push(this._t.planned);
    hint.textContent = parts.join("  ·  ");
  }

  /** What the heater did in a quarter: minutes, energy and why (empty if it did not run). */
  _ranIn(d, start, step) {
    const t = this._t;
    let ms = 0;
    const reasons = [];
    for (const [s, e, , reason] of d.heated || []) {
      const overlap = Math.min(e, start + step) - Math.max(s, start);
      if (overlap <= 0) continue;
      ms += overlap;
      const label = (t.reasons || {})[reason];
      if (label && !reasons.includes(label)) reasons.push(label);
    }
    if (ms <= 0) return "";
    const minutes = Math.max(1, Math.round(ms / 60000));
    const kwh = d.power ? ` (${this._num((d.power * ms) / 3600000 / 1000, 1)} kWh)` : "";
    return `${t.ranFor(minutes)}${kwh}${reasons.length ? ": " + reasons.join(", ") : ""}`;
  }

  _resetHint() {
    const hint = this.shadowRoot.getElementById("hint");
    if (!hint) return;
    hint.classList.remove("live");
    hint.textContent = "";
  }
}

class WaterHeaterPlannerCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._build();
  }
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }
  _build() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (e) => {
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: e.detail.value }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    const lang = (this._hass?.locale?.language || this._hass?.language || "en").startsWith("sv") ? WH_TEXT.sv : WH_TEXT.en;
    const labels = { entity: lang.pickEntity, name: lang.pickName, settings: lang.pickSettings };
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.computeLabel = (s) => labels[s.name] || s.name;
    this._form.schema = [
      { name: "entity", required: true, selector: { entity: { domain: "sensor", integration: "waterheater_planner" } } },
      { name: "name", selector: { text: {} } },
      {
        name: "settings",
        selector: { select: { mode: "dropdown", options: Object.entries(lang.settingsOptions).map(([value, label]) => ({ value, label })) } },
      },
    ];
  }
}

if (!customElements.get("waterheater-planner-card")) {
  customElements.define("waterheater-planner-card", WaterHeaterPlannerCard);
  customElements.define("waterheater-planner-card-editor", WaterHeaterPlannerCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "waterheater-planner-card",
    name: "Water Heater Planner",
    description: "Planned heating, cost and settings for the water heater planner.",
    preview: false,
  });
  console.info(`%c WATERHEATER-PLANNER-CARD %c ${WH_CARD_VERSION} `, "background:#35c7d9;color:#10181c;font-weight:700", "background:#f2a93b;color:#10181c");
}
