// Husvyn: foto av huset med live-rutor, flödeslinjer och klickbara ytor.
// Positioner anges i procent av fotot. Layouten kan redigeras och sparas på servern.
(() => {
  'use strict';
  // Temafärg från CSS-variabel (temat sätts av theme.js)
  const TC = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const VERSION = '0.28.0';
  const $ = id => document.getElementById(id);
  const stage = $('stage'), boxesEl = $('boxes'), hot = $('hot'), wires = $('wires'), handles = $('handles');
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- Standardlayout (procent av fotot) ----------
  const DEFAULT = {
    boxes: {
      // Översta raden: Import, Solpaneler, Huset, FTX, Varmvatten, Luftvärmepump
      nat:     { x: 1.5,  y: 3,  anchor: [36, 52] },
      sol:     { x: 18,   y: 3,  anchor: [45, 37] },
      hus:     { x: 34.5, y: 3,  anchor: [49, 50] },
      ftx:     { x: 51,   y: 3,  anchor: [33, 31.5] }, // FTX-utblåset på taket
      vv:      { x: 67.5, y: 3,  anchor: [47, 50.3] },
      vp:      { x: 84,   y: 3,  anchor: [55.2, 34.4] }, // värmepumpen sitter på baksidan
      vader:   { x: 1.5,  y: 27 },
      ladd:    { x: 84,   y: 60, anchor: [75, 50] }, // på fasaden, vänster om garagedörren
      ev6:     { x: 84,   y: 45, anchor: [87.5, 52], auto: true }, // ovanför laddboxen, strecket en bit till höger om laddboxens
      elpris:  { x: 1.5,  y: 64 },
      kostnad: { x: 54,   y: 72 },
    },
    hotspots: {
      solar:    { points: [[30.7, 33.2], [55, 33.6], [61.4, 40], [45.7, 44], [35.5, 40]] },
      house:    { points: [[29.8, 33.3], [56, 33.3], [64.8, 41.5], [64, 56.5], [47, 59], [44, 63.5], [36, 64], [35.5, 46.5], [25.3, 41]] },
      veranda:  { points: [[14.5, 43.3], [25, 41.4], [35, 46.7], [35.2, 63], [19.3, 69], [15, 61.7]] },
      garage:   { points: [[61.8, 39.4], [72.1, 35.8], [90, 39.4], [85.4, 42.9], [85, 58.7], [78.6, 58.4], [64.3, 54.3], [64.6, 41.5]] },
    },
  };
  // Fönster som lyser på natten (procent)
  // Tredje värdet 'down' = takbelysning: ljuset börjar vid takkanten och lyser bara nedåt
  const GLOWS = [[47.2, 46.6, 'down'], [52.1, 45.9, 'down'], [58.3, 44.0, 'down'], [67.6, 45], [75.9, 46.3]];
  // Ljusslingan i uterummet: en liten lampa per glödlampa i fotot
  const BULBS = [[24.15, 51.97], [24.79, 52.31], [25.6, 52.31], [26.44, 51.71], [28.83, 51.41], [29.53, 50.64], [29.79, 50.3]];

  let cfg = {}, FX = {}, HPC = {}, WC = {}, CHC = {}, CARC = {}, states = {}, connected = false;
  const CAR_STATE = { Idle: 'Ingen bil ansluten', Charging: 'Laddar', 'Wait for car': 'Väntar på bilen', Complete: 'Laddning klar', Error: 'Fel' };
  let layout = clone(DEFAULT), saved = clone(DEFAULT);
  let editing = false, lightMode = load('obs-light') || 'auto';

  // ---------- Hjälpare ----------
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
  const st = id => (id && connected) ? states[id] : undefined;
  function num(id, attr) {
    const s = st(id); if (!s) return null;
    const v = parseFloat(attr ? s.attributes[attr] : s.state);
    return Number.isFinite(v) ? v : null;
  }
  const nf = (v, d = 1) => v == null ? '–' : v.toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const kw = w => w == null ? '–' : nf(Math.abs(w) / 1000, 2);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const time = iso => iso ? new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '–';
  function outdoorTemp() { const id = cfg.outdoor; return id && id.startsWith('weather.') ? num(id, 'temperature') : num(id); }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2600); }

  const HW = { disabled: 'Av (manuell)', no_temperature: 'Temperatur saknas', switch_unavailable: 'Brytaren svarar inte', at_target: 'Måltemperatur nådd',
    idle: 'Vilar', waiting_cheap: 'Väntar på billig tid', waiting_sun: 'Väntar på sol', heating_grid: 'Värmer (billig el)', heating_solar: 'Värmer (sol)',
    heating_sun_slot: 'Värmer (soltimme)', heating_base: 'Värmer (grundtemp)', comfort_floor: 'Värmer (komfortgräns)', boost: 'Värmer nu',
    no_prices: 'Elpris saknas', no_surplus_sensor: 'Nätsensor saknas', floor_price_cap: 'Väntar (pristak)', manual: 'Manuell värmning' };
  const WX = { 'clear-night': 'Klart', sunny: 'Soligt', partlycloudy: 'Halvklart', cloudy: 'Molnigt', rainy: 'Regn', pouring: 'Skyfall', snowy: 'Snö',
    'snowy-rainy': 'Snöblandat regn', fog: 'Dimma', windy: 'Blåsigt', 'windy-variant': 'Blåsigt', lightning: 'Åska', 'lightning-rainy': 'Åskregn', hail: 'Hagel', exceptional: 'Ovanligt' };

  // ---------- Ikoner ----------
  // Linjeikoner för rutorna (färg från rubriken) och färgade väderikoner. Delas med kiosksidan via window.ObsIcons.
  const svgI = d => `<svg class="bi" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const BOX_ICON = {
    nat: svgI('<path d="M12 2 7 22M12 2l5 20M8.6 15h6.8M9.8 9.5h4.4M5 6h14M6 11h12"/>'),
    sol: svgI('<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>'),
    hus: svgI('<path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/>'),
    ftx: svgI('<path d="M3 8h9a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>'),
    vv: svgI('<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>'),
    vp: svgI('<path d="M3 5h18v14H3z"/><circle cx="10" cy="12" r="3.5"/><path d="M10 8.5v7M6.5 12h7M17 9h1.5M17 12h1.5M17 15h1.5"/>'),
    ev6: svgI('<path d="M3 15v-3l2-5h11l3 5h2v3h-2M7 15H3M17 15H9M5 12h14"/><circle cx="7" cy="16" r="2"/><circle cx="17" cy="16" r="2"/>'),
    ladd: svgI('<path d="M5 3h8v18H5zM9.5 7 8 11h3l-1.5 4M13 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-2-2"/>'),
    elpris: svgI('<path d="M3 17l5-6 4 3 5-7 4 4M3 21h18"/>'),
    kostnad: svgI('<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3v3M16 13.5h2"/>'),
  };
  // Väderikoner, 32×32, med egna färger
  const CLOUD = (y = 0, fill = 'var(--c-wxcloud, color-mix(in srgb,var(--text) 78%,var(--bg)))') => `<path transform="translate(0 ${y})" d="M9 24h14.5a5 5 0 0 0 .3-10 7.5 7.5 0 0 0-14.3 1.8A4.1 4.1 0 0 0 9 24z" fill="${fill}" stroke="none"/>`;
  const SUN = (cx, cy, r) => `<g stroke="var(--gold)" stroke-width="2" stroke-linecap="round"><circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--gold)"/>${[0, 45, 90, 135, 180, 225, 270, 315].map(a => { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); return `<line x1="${(cx + c * (r + 2.5)).toFixed(1)}" y1="${(cy + s * (r + 2.5)).toFixed(1)}" x2="${(cx + c * (r + 5)).toFixed(1)}" y2="${(cy + s * (r + 5)).toFixed(1)}"/>`; }).join('')}</g>`;
  const MOON = '<path d="M20 5.5a10 10 0 1 0 6.5 15.8A8 8 0 0 1 20 5.5z" fill="var(--gold)"/>';
  const DROPS = (n = 3) => `<g stroke="var(--blue)" stroke-width="2" stroke-linecap="round">${[10, 16, 22].slice(0, n).map(x => `<line x1="${x}" y1="24" x2="${x - 1.5}" y2="28.5"/>`).join('')}</g>`;
  const FLAKES = '<g fill="var(--text)">' + [10, 16, 22].map((x, i) => `<circle cx="${x - i % 2}" cy="${26 + (i % 2) * 2}" r="1.5"/>`).join('') + '</g>';
  const BOLT = '<path d="M17 21l-3.5 5h3l-1.5 4.5 5-6h-3l1.5-3.5z" fill="var(--gold)"/>';
  const WX_SVG = {
    sunny: SUN(16, 16, 6), 'clear-night': MOON,
    partlycloudy: SUN(12, 11, 4.5) + CLOUD(3), cloudy: CLOUD(1, 'color-mix(in srgb,var(--text) 55%,var(--bg))') + CLOUD(4),
    rainy: CLOUD(-4) + DROPS(3), pouring: CLOUD(-4) + DROPS(3) + '<g stroke="var(--blue)" stroke-width="2" stroke-linecap="round"><line x1="13" y1="25" x2="11.5" y2="29.5"/><line x1="19" y1="25" x2="17.5" y2="29.5"/></g>',
    snowy: CLOUD(-4) + FLAKES, 'snowy-rainy': CLOUD(-4) + DROPS(1) + '<circle cx="16" cy="27" r="1.5" fill="var(--text)"/><circle cx="22" cy="26" r="1.5" fill="var(--text)"/>',
    hail: CLOUD(-4) + FLAKES, lightning: CLOUD(-5) + BOLT, 'lightning-rainy': CLOUD(-5) + BOLT + DROPS(1),
    fog: CLOUD(-5) + '<g stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><line x1="6" y1="23" x2="26" y2="23"/><line x1="9" y1="27" x2="23" y2="27"/></g>',
    windy: '<g fill="none" stroke="var(--blue)" stroke-width="2.2" stroke-linecap="round"><path d="M4 12h15a3.5 3.5 0 1 0-3.5-3.5"/><path d="M4 18h20a3.5 3.5 0 1 1-3.5 3.5"/><path d="M4 24h9"/></g>',
    exceptional: '<path d="M16 5 28 26H4z" fill="none" stroke="var(--orange)" stroke-width="2"/><path d="M16 13v6M16 22v1" stroke="var(--orange)" stroke-width="2" stroke-linecap="round"/>',
  };
  WX_SVG['windy-variant'] = WX_SVG.windy;
  const wxIcon = (cond, cls = 'wxi') => `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true">${WX_SVG[cond] || WX_SVG.cloudy}</svg>`;
  window.ObsIcons = { box: BOX_ICON, wx: wxIcon, label: c => WX[c] || c };
  // Aktuellt väder för kiosksidans klocka
  window.ObsHouse = { open: id => openDrawer(id), media: () => mediaHtml(), alarm: () => { const A = cfg.alarm, s = A && st(A.entity); return s ? { state: s.state, label: ALARM_L[s.state] || s.state, cls: alarmCls(s.state) } : null; }, st: id => st(id), alerts: () => { const I = cfg.info; if (!I) return 0; const on = id => (st(id) || {}).state === 'on';
      return (I.doors || []).filter(d => on(d.entity)).length + (I.leaks || []).filter(d => on(d.entity)).length + (I.smoke || []).filter(d => on(d.entity)).length; }, lightsOn: () => cfg.lights ? cfg.lights.groups.flatMap(g => g.lights).filter(l => (st(l.entity) || {}).state === 'on').length : 0, weather: () => {
    const s = st(cfg.outdoor), sun = st(cfg.sun); if (!s) return null;
    const a = s.attributes || {};
    return { cond: s.state, temp: outdoorTemp(), wind: a.wind_speed != null ? a.wind_speed / 3.6 : null, humidity: a.humidity,
      rise: sun ? time(sun.attributes.next_rising) : null, set: sun ? time(sun.attributes.next_setting) : null };
  } };

  // ---------- Rutornas innehåll ----------
  const BOX = {
    sol: { title: 'Solpaneler', cls: 'key', drawer: 'solar', wire: 'sol', render() {
      const w = num(cfg.solar), today = num(cfg.pv_today);
      const rem = num(cfg.fc_remaining), tom = num(cfg.fc_tomorrow);
      return { v: kw(w), u: 'kW', s: `${nf(today)} kWh idag`,
        flow: w > 20 ? { cls: 'sol', dir: 'out', w } : null };
    } },
    hus: { title: 'Huset', cls: 'key', drawer: 'house', render() {
      const load = num(cfg.load), ch = num(cfg.charger);
      const house = load != null && ch != null && ch <= load ? load - ch : load;
      return { v: kw(house), u: 'kW', s: `Förbrukat ${nf(num(cfg.load_today))} kWh`, flow: house > 30 ? { cls: '', dir: 'in', w: house } : null };
    } },
    vv: { title: 'Varmvatten', drawer: 'hotwater', render() {
      const t = num(cfg.hot_water, 'temperature'), s = st(cfg.hot_water);
      const heating = s && /heat|boost|comfort_floor|manual/.test(s.state);
      return { v: nf(t), u: '°C', s: s ? (HW[s.state] || s.state) : 'okänt', flow: heating ? { cls: 'warm', dir: 'in', w: 2000 } : null };
    } },
    nat: { title: 'Elnät', cls: 'key', drawer: 'grid', wire: 'grid', render() {
      const g = num(cfg.grid);
      const lbl = g == null ? 'okänt' : g > 30 ? 'Köper från nätet' : g < -30 ? 'Säljer till nätet' : 'I balans';
      return { v: kw(g), u: 'kW', s: `Köpt idag ${nf(num(cfg.grid_in_today))} kWh`, s2: `Sålt idag ${nf(num(cfg.grid_out_today))} kWh`, title: g < -30 ? 'Export' : 'Import', flow: g != null && Math.abs(g) > 30 ? { cls: 'grid', dir: g > 0 ? 'in' : 'out', w: g } : null };
    } },
    vp: { title: 'Värmepump', drawer: 'heatpump', render() {
      const w = num(cfg.heatpump), inne = num(cfg.indoor);
      return { v: w == null ? '–' : Math.round(w).toLocaleString('sv-SE'), u: 'W', s: `Inne ${nf(inne)} °C`, flow: w > 50 ? { cls: 'warm', dir: 'in', w } : null };
    } },
    ladd: { title: 'Laddbox', drawer: 'charger', render() {
      const w = num(cfg.charger), cs = st(CHC.car_state), kwh = num(CHC.session_kwh);
      const lbl = cs ? (CAR_STATE[cs.state] || cs.state) : (w > 50 ? 'Laddar' : 'Laddar inte');
      return { v: kw(w), u: 'kW', s: lbl, s2: kwh != null ? `Laddat ${nf(kwh)} kWh` : '',
        flow: w > 50 ? { cls: '', dir: 'in', w } : null };
    } },
    ev6: { title: 'EV6', drawer: 'car', render() {
      const soc = num(CARC.soc || cfg.ev_soc), range = num(CARC.range), chg = st(CARC.charging), plug = st(CARC.plug);
      // Laddboxen vet oftast före Kia-molnet om bilen laddar eller är ansluten
      const cs = st(CHC.car_state) ? st(CHC.car_state).state : null;
      const charging = (chg && chg.state === 'on') || cs === 'Charging';
      const plugged = (plug && plug.state === 'on') || (cs && cs !== 'Idle');
      return { v: soc == null ? '–' : Math.round(soc), u: '%', s: `${range == null ? '–' : Math.round(range)} km räckvidd`, s2: charging ? 'Laddar' : plugged ? 'Ansluten' : 'Inte ansluten', soc, socLabel: false,
        flow: charging ? { cls: '', dir: 'in', w: num(cfg.charger) || 3000 } : null };
    } },
    vader: { title: 'Ute / nu', cls: 'weather', render() {
      const s = st(cfg.outdoor), sun = st(cfg.sun);
      const a = s ? s.attributes : {};
      return { custom: `<div class="k">Ute / nu</div>
        <div class="v">${nf(outdoorTemp())}<small>°C</small></div>
        <div class="s">${s ? (WX[s.state] || s.state) : 'okänt'}</div>
        <div class="row"><span>Vind<b>${a.wind_speed != null ? nf(a.wind_speed / 3.6) : '–'} <small>m/s</small></b></span>
          <span>Fukt<b>${a.humidity != null ? Math.round(a.humidity) : '–'} %</b></span>
          <span>↑ Sol upp<b>${sun ? time(sun.attributes.next_rising) : '–'}</b></span>
          <span>↓ Sol ned<b>${sun ? time(sun.attributes.next_setting) : '–'}</b></span></div>` };
    } },
    elpris: { title: 'Elpris idag', cls: 'wide price-box', drawer: 'price', render() {
      const p = num(cfg.price), s = st(cfg.price), a = s ? s.attributes : {};
      const list = v => Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
      const arr = list(a.today), tom = a.tomorrow_valid === false ? [] : list(a.tomorrow);
      const mean = xs => xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null;
      const avg = Number.isFinite(+a.average) && +a.average > 0 ? +a.average : mean(arr);
      const spot = num(cfg.spot), pct = p != null && avg ? Math.round((p / avg - 1) * 100) : null;
      const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v);
      // Sol idag mot prognos och imorgon (Solcast)
      const sol = num(cfg.pv_today), prog = num(cfg.solcast_today), solTom = num(cfg.solcast_tomorrow);
      const bar = prog > 0 && sol != null ? Math.min(100, sol / prog * 100) : 0;
      return { custom: `<div class="k">Idag / elpris</div>
        <div class="ptop"><div class="v">${nf(p, 2)}<small>kr/kWh nu</small></div>
          <div class="pnow">${spot != null ? `<span class="spot">Spotpris ${nf(spot, 2)} kr</span>` : ''}${pct != null ? `<span class="${pct > 0 ? 'up' : 'down'}">${sign(pct)} % mot snitt</span>` : ''}</div></div>
        ${priceSpark(arr, tom)}
        <div class="psol"><div><div class="psl">Sol idag <b>${nf(sol)}</b> / ${nf(prog)} kWh</div><div class="pbar"><span style="width:${bar}%"></span></div></div>
          <div class="pst">Imorgon <b>${nf(solTom)}</b> kWh</div></div>` };
    } },
    ftx: { title: 'FTX', drawer: 'ftx', render() {
      if (!FX.supply) return { custom: '<div class="k">FTX</div><div class="s">Ingen FTX i config</div>' };
      const unitOn = st(FX.unit) ? st(FX.unit).state === 'on' : null, boost = st(FX.boost) && st(FX.boost).state === 'on', away = st(FX.away) && st(FX.away).state === 'on';
      const lbl = unitOn === false ? 'avstängd' : boost ? 'forcering' : away ? 'bortaläge' : `nivå ${num(FX.fan_level) == null ? '–' : Math.round(num(FX.fan_level))}`;
      return { custom: `<div class="k">FTX</div><div class="v">${nf(num(FX.supply))}<small>°C tilluft</small></div>
        <div class="s">Återvinner ${nf(num(FX.efficiency), 0)} % · ${esc(lbl)}</div>`,
        flow: unitOn ? { cls: 'air', dir: 'in', w: 1200 } : null };
    } },
    kostnad: { title: 'Idag / pengar', cls: 'wide money-box', drawer: 'money', render() { return { custom: moneyPage() }; } },
  };

  // Sida 1: elkostnad och sparat med solel idag. Sida 2: kostnaden i detalj + solen i år. Sida 3: energi idag.
  let moneyData = null;
  async function loadMoney() {
    try { moneyData = await fetch('api/money', { cache: 'no-store' }).then(r => r.ok ? r.json() : null); } catch {}
    refresh();
  }
  const kr = (v, d = 2) => v == null ? '–' : nf(v, d);
  function moneyCalc() {
    const inn = num(cfg.grid_in_today), costIn = num(cfg.cost_in_today), sold = num(cfg.sold_today);
    const fee = num(cfg.net_fee), feeTax = num(cfg.net_fee_tax);
    const now = new Date(), days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const fixedMonth = num(cfg.fixed_fees) ?? (Number(cfg.fixed_fees_month) || null);
    const fixed = fixedMonth > 0 ? fixedMonth / days : null;
    const transfer = inn != null && fee != null ? inn * fee : null;
    const tax = inn != null && fee != null && feeTax != null ? inn * Math.max(0, feeTax - fee) : null;
    const energy = costIn != null && transfer != null && tax != null ? Math.max(0, costIn - transfer - tax) : null;
    const spent = costIn != null ? costIn - (sold || 0) + (fixed || 0) : num(cfg.cost_today);
    // Sparat idag = egen solel värderad till totalpriset (löpande sensor minus värdet vid midnatt)
    const base = moneyData && moneyData.base || {};
    const save = num(cfg.solar_saving), sb = base[cfg.solar_saving];
    const savedToday = save != null && sb != null ? Math.max(0, save - sb) : null;
    const pv = num(cfg.pv_today), out = num(cfg.grid_out_today);
    const self = pv != null && out != null ? Math.max(0, pv - out) : null;
    return { self, inn, sold, fixed, transfer, tax, energy, spent, savedToday, y: moneyData && moneyData.year };
  }
  function moneyPage() {
    const m = moneyCalc();
    return `<div class="k">Idag</div>
      <div class="money-top"><div class="ml">Faktisk kostnad</div><div class="v money">${kr(num(cfg.cost_today))}<small>kr</small></div></div>
      <div class="money-sub three">
        <div><span>Uppskattad</span><b class="money">${kr(m.spent)} <small>kr</small></b></div>
        <div><span>Sparat sol</span><b class="saved">${kr(m.savedToday)} <small>kr</small></b></div>
        <div><span>Egen sol</span><b class="saved">${nf(m.self)} <small>kWh</small></b></div>
      </div>`;
  }
  function detailPage() {
    const m = moneyCalc(), y = m.y;
    const row = (k, v, cls = '') => `<div class="mrow ${cls}"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="eyebrow">Kostnad i detalj</div>
      <div class="mrows two">
        ${row('Köpt från nätet', `${nf(m.inn)} <small>kWh</small>`)}
        ${row('Elpris', `${kr(m.energy)} <small>kr</small>`)}
        ${row('Nätavgift', `${kr(m.transfer)} <small>kr</small>`)}
        ${row('Skatt och avgifter', `${kr(m.tax)} <small>kr</small>`)}
        ${m.fixed != null ? row('Fasta avgifter', `${kr(m.fixed)} <small>kr</small>`) : ''}
        ${row('Såld el', `${m.sold ? '−' + kr(m.sold) : kr(m.sold)} <small>kr</small>`, 'neg')}
      </div>
      <div class="myear"><span>Solen har gett i år</span><b>${y ? nf(y.total_kr, 0) : '–'} <small>kr</small></b></div>
      <div class="mnote">${y ? `${y.year} · använd ${nf(y.self_kr, 0)} + såld ${nf(y.sold_kr, 0)} kr` : 'Räknas från statistiken …'}</div>`;
  }
  // Sida 3: energi idag
  function energyPage() {
    const cost = num(cfg.cost_today), inn = num(cfg.grid_in_today), out = num(cfg.grid_out_today);
    const pv = num(cfg.pv_today), use = num(cfg.load_today);
    const self = pv != null && out != null ? Math.max(0, pv - out) : null;
    return `<div class="k">Idag / energi</div>
      <div class="cost"><div><div class="s">Elkostnad</div><div class="v money">${nf(cost, 2)}<small>kr</small></div></div>
        <div><div class="s">Egen sol använd</div><div class="v saved">${nf(self)}<small>kWh</small></div></div></div>
      <div class="row"><span>Förbrukat<b>${nf(use)} kWh</b></span><span>Sol<b>${nf(pv)} kWh</b></span>
        <span>Köpt<b>${nf(inn)} kWh</b></span><span>Sålt<b>${nf(out)} kWh</b></span></div>`;
  }

  function priceSpark(arr, tom = []) {
    if (!arr.length) return '<div class="s">Inga priser</div>';
    const all = arr.concat(tom);
    const W = 100, H = 40, n = arr.length, lo = Math.min(...all), hi = Math.max(...all);
    const x = (i, m = n) => i / (m - 1) * W, y = v => H - (hi === lo ? .5 : (v - lo) / (hi - lo)) * (H - 4) - 2;
    let d = ''; arr.forEach((v, i) => { d += `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`; });
    // Morgondagens priser ritas streckat ovanpå samma 00–24-axel
    let dt = ''; tom.forEach((v, i) => { dt += `${i ? 'L' : 'M'}${x(i, tom.length).toFixed(2)},${y(v).toFixed(2)}`; });
    const now = new Date(), idx = (now.getHours() * 60 + now.getMinutes()) / 1440 * (n - 1);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${dt ? `<path class="tm" d="${dt}"/>` : ''}<path class="ar" d="${d}L${W},${H}L0,${H}Z"/><path class="ln" d="${d}"/>
      <line class="now" x1="${x(idx)}" x2="${x(idx)}" y1="0" y2="${H}"/></svg>
      <div class="lohi"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
      <div class="lohi"><span>Lägst ${nf(lo, 2)}</span><span class="hi">Högst ${nf(hi, 2)}</span></div>`;
  }

  // ---------- Rendera rutor ----------
  function buildBoxes() {
    boxesEl.innerHTML = '';
    for (const id of ['nat', 'sol', 'hus', 'ftx', 'vv', 'vp', 'vader', 'ladd', 'ev6', 'elpris', 'kostnad']) {
      const el = document.createElement('div');
      el.className = 'box ' + (BOX[id].cls || '');
      el.dataset.id = id;
      el.tabIndex = 0;
      el.addEventListener('click', () => { if (!editing && !el._dragged && BOX[id].drawer) openDrawer(BOX[id].drawer); el._dragged = false; });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && BOX[id].drawer && !editing) openDrawer(BOX[id].drawer); });
      el.addEventListener('pointerdown', e => startBoxDrag(e, id, el));
      el.addEventListener('mouseenter', () => highlight(BOX[id].drawer, true));
      el.addEventListener('mouseleave', () => highlight(BOX[id].drawer, false));
      boxesEl.appendChild(el);
    }
    placeBoxes();
  }
  function placeBoxes() {
    for (const el of boxesEl.children) {
      const b = layout.boxes[el.dataset.id] || DEFAULT.boxes[el.dataset.id];
      el.style.left = b.x + '%'; el.style.top = b.y + '%';
    }
    fitBoxes();
  }
  // Rutor som blivit högre än platsen de sparats på flyttas upp så att de håller sig inne i bilden
  function fitBoxes() {
    const H = boxesEl.clientHeight; if (!H || editing) return;
    for (const el of boxesEl.children) {
      const b = layout.boxes[el.dataset.id] || DEFAULT.boxes[el.dataset.id];
      // EV6-rutan utan sparad plats läggs direkt ovanför laddboxen, var den än står
      if (b.auto && el.dataset.id === 'ev6') {
        const ladd = boxesEl.querySelector('.box[data-id="ladd"]'), lb = layout.boxes.ladd;
        if (ladd && lb) { const bottom = Math.min(Math.min(lb.y, ladd.offsetTop / H * 100) - 1.5, b.anchor[1] - 4); b.x = lb.x; b.y = Math.max(0, bottom - el.offsetHeight / H * 100); }
      }
      const maxTop = (H - el.offsetHeight) / H * 100 - 1.5;
      el.style.top = Math.max(0, Math.min(b.y, maxTop)) + '%';
    }
  }
  function renderBoxes() {
    for (const el of boxesEl.children) {
      const def = BOX[el.dataset.id], r = def.render();
      el._flow = r.flow || null;
      if (r.custom) el.innerHTML = r.custom;
      else el.innerHTML = `<div class="k">${esc(r.title || def.title)}</div><div class="v">${r.v}<small>${r.u}</small></div><div class="s">${esc(r.s || '')}</div>${r.s2 ? `<div class="s s2">${esc(r.s2)}</div>` : ''}` +
        (r.soc != null ? `<div class="soc"><span style="width:${Math.max(0, Math.min(100, r.soc))}%"></span></div>${r.socLabel === false ? '' : `<div class="s">EV6 ${Math.round(r.soc)} %</div>`}` : '');
      // Liten ikon framför rubriken; väderrutan får ikonen för aktuellt väder
      const k = el.querySelector('.k'), id = el.dataset.id;
      const ic = id === 'vader' ? (st(cfg.outdoor) ? wxIcon(st(cfg.outdoor).state, 'bi wx') : '') : BOX_ICON[id];
      if (k && ic) k.insertAdjacentHTML('afterbegin', ic);
    }
    fitBoxes(); drawWires(); renderLocks();
    window.dispatchEvent(new CustomEvent('obs-render'));
  }

  // ---------- Klickytor ----------
  const HOT_TITLES = { solar: 'Solpaneler', house: 'Huset', veranda: 'Uterummet', garage: 'Garage / laddbox', heatpump: 'Värmepump' };
  function buildHot() {
    hot.innerHTML = '';
    // Stora ytor först, så att mindre ytor (t.ex. solpanelerna på taket) hamnar överst och går att klicka på
    const area = pts => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    const entries = Object.entries(layout.hotspots).sort((a, b) => area(b[1].points) - area(a[1].points));
    for (const [id, h] of entries) {
      const p = document.createElementNS(SVGNS, 'polygon');
      p.setAttribute('points', h.points.map(q => q.join(',')).join(' '));
      p.dataset.id = id;
      const t = document.createElementNS(SVGNS, 'title'); t.textContent = HOT_TITLES[id] || id; p.appendChild(t);
      p.addEventListener('click', () => { if (!editing) openDrawer(id); });
      p.addEventListener('mouseenter', () => boxHighlight(id, true));
      p.addEventListener('mouseleave', () => boxHighlight(id, false));
      hot.appendChild(p);
    }
  }
  function highlight(drawerId, on) {
    const p = hot.querySelector(`polygon[data-id="${drawerId}"]`); if (p) p.classList.toggle('hl', on);
  }
  function boxHighlight(drawerId, on) {
    for (const el of boxesEl.children) if (BOX[el.dataset.id].drawer === drawerId) el.classList.toggle('hl', on);
  }

  // ---------- Linjer med flödespulser ----------
  // ---------- Låsikoner på dörrarna i fotot ----------
  const LOCK_SVG = {
    locked: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    unlocked: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
  };
  const LOCK_L = { locked: 'Låst', unlocked: 'Olåst', locking: 'Låser …', unlocking: 'Låser upp …', jammed: 'Fastnat', open: 'Öppen', opening: 'Öppnar …', unavailable: 'Ej nåbar', unknown: 'Okänt' };
  function renderLocks() {
    const D = cfg.door; if (!D || !Array.isArray(D.markers)) return;
    let wrap = $('locks');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'locks'; wrap.className = 'locks'; stage.appendChild(wrap); }
    const html = D.markers.map(m => {
      const s = st(m.entity), state = s ? s.state : 'unknown';
      const cls = state === 'locked' ? 'ok' : state === 'unlocked' || state === 'open' || state === 'jammed' ? 'warn' : 'mid';
      return `<button class="lockm ${cls}" data-lock="${esc(m.entity)}" data-state="${esc(state)}" title="${esc(m.name || '')}: ${esc(LOCK_L[state] || state)}" aria-label="${esc(m.name || 'Lås')}: ${esc(LOCK_L[state] || state)}">${state === 'locked' ? LOCK_SVG.locked : LOCK_SVG.unlocked}</button>`;
    }).join('');
    if (wrap._h !== html) { wrap.innerHTML = html; wrap._h = html; placeLocks(); }
  }
  const lockPos = m => m && ((layout.locks && layout.locks[m.entity]) || m.pos);
  function placeLocks(sr) {
    const wrap = $('locks'), D = cfg.door; if (!wrap || !D) return;
    const c = parseFloat(stage.style.getPropertyValue('--crop')) || 0;
    wrap.querySelectorAll('.lockm').forEach((el, i) => {
      const m = D.markers[i]; const pos = lockPos(m); if (!pos) return;
      el.style.left = ((pos[0] / 100 - c) / (1 - 2 * c) * 100) + '%'; el.style.top = pos[1] + '%';
    });
  }
  stage.addEventListener('click', e => {
    const b = e.target.closest('.lockm'); if (!b) return;
    e.stopPropagation();
    const D = cfg.door || {}, m = (D.markers || []).find(x => x.entity === b.dataset.lock) || {}, state = b.dataset.state, name = m.name || 'Dörren';
    if (D.items && DRAWERS.access) return openDrawer('access');
    if (state === 'locked') {
      if (D.allow_unlock !== true) return toast(`${name} är låst. Upplåsning är avstängd här.`);
      if (confirm(`Låsa upp ${name.toLowerCase()}?`)) sendCtl({ action: 'lock', entity: b.dataset.lock, value: 'unlock' });
    } else if (state === 'unlocked' || state === 'open') {
      if (confirm(`${name} är olåst. Låsa nu?`)) sendCtl({ action: 'lock', entity: b.dataset.lock, value: 'lock' });
    } else toast(`${name}: ${LOCK_L[state] || state}`);
  }, true);

  function drawWires() {
    if (getComputedStyle(wires).display === 'none') return;
    const sr = stage.getBoundingClientRect();
    if (!sr.width) return;
    wires.setAttribute('viewBox', `0 0 ${sr.width} ${sr.height}`);
    let out = '';
    for (const el of boxesEl.children) {
      const b = layout.boxes[el.dataset.id];
      if (!b || !b.anchor) continue;
      const r = el.getBoundingClientRect();
      const bx = r.left - sr.left, by = r.top - sr.top, bw = r.width, bh = r.height;
      // Beskuren bild (kioskens 10"-läge): punkterna ligger i fotots koordinater, rutorna i den synliga ytan
      const c = parseFloat(stage.style.getPropertyValue('--crop')) || 0;
      const ax = (b.anchor[0] / 100 - c) / (1 - 2 * c) * sr.width, ay = b.anchor[1] / 100 * sr.height;
      // Fäst linjen i den kant som ligger närmast punkten
      let sx, sy;
      if (ay > by + bh) { sx = Math.min(Math.max(ax, bx + 14), bx + bw - 14); sy = by + bh; }
      else if (ay < by) { sx = Math.min(Math.max(ax, bx + 14), bx + bw - 14); sy = by; }
      else { sy = Math.min(Math.max(ay, by + 10), by + bh - 10); sx = ax > bx + bw ? bx + bw : bx; }
      const vertical = sy === by + bh || sy === by;
      const dy = ay - sy, dx = ax - sx;
      // En knyck: först rakt ut från rutan, sedan diagonalt mot punkten
      const k = vertical ? [sx, sy + Math.sign(dy) * Math.min(Math.abs(dy) * .35, 40)] : [sx + Math.sign(dx) * Math.min(Math.abs(dx) * .35, 40), sy];
      const d = `M${sx.toFixed(1)},${sy.toFixed(1)} L${k[0].toFixed(1)},${k[1].toFixed(1)} L${ax.toFixed(1)},${ay.toFixed(1)}`;
      out += `<path class="base" d="${d}"/>`;
      const f = el._flow;
      if (f) {
        const sec = Math.max(.35, Math.min(2.4, 2.6 - Math.abs(f.w) / 2500));
        out += `<path class="flow ${f.cls} ${f.dir === 'out' ? 'rev' : ''}" d="${d}" style="animation-duration:${sec.toFixed(2)}s"/>`;
      }
      out += `<circle class="dot" cx="${ax}" cy="${ay}" r="5"/><circle class="dotc" cx="${ax}" cy="${ay}" r="1.8"/>`;
    }
    wires.innerHTML = out;
    placeLocks(sr);
  }

  // ---------- Dag / natt ----------
  function applyLight() {
    const sun = st(cfg.sun);
    const night = lightMode === 'night' || (lightMode === 'auto' && sun && sun.state === 'below_horizon');
    stage.classList.toggle('night', !!night);
    document.querySelectorAll('.seg button[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === lightMode)));
  }
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { lightMode = b.dataset.mode; store('obs-light', lightMode); applyLight(); }));
  $('glows').innerHTML = GLOWS.map(([x, y, k]) => `<i class="${k || ''}" style="left:${x}%;top:${y}%"></i>`).join('') +
    BULBS.map(([x, y], i) => `<b class="bulb" style="left:${x}%;top:${y}%;animation-delay:${(i * 0.37) % 2}s"></b>`).join('');

  // ---------- Detaljpanel ----------
  // ---------- Solpanelernas detaljvy ----------
  let solarPeak = null;
  function bar(pct, cls = '') { const p = Math.max(0, Math.min(100, pct || 0)); return `<div class="sbar ${cls}"><span style="width:${p}%"></span></div>`; }
  const DAYS = { Monday: 'Mån', Tuesday: 'Tis', Wednesday: 'Ons', Thursday: 'Tor', Friday: 'Fre', Saturday: 'Lör', Sunday: 'Sön' };
  function forecastSection(today) {
    const fc = num(cfg.fc_today), rem = num(cfg.fc_remaining), tom = num(cfg.fc_tomorrow), peak = st(cfg.fc_peak_tomorrow);
    const sc = num(cfg.solcast_today), scRem = num(cfg.solcast_remaining), scTom = num(cfg.solcast_tomorrow);
    if (fc == null && sc == null) return '';
    const reached = fc > 0 && today != null ? today / fc * 100 : null;
    const days = [{ k: 'Imorgon', v: scTom }];
    for (let i = 3; i <= 7; i++) { const s = st(cfg['solcast_day_' + i]); days.push({ k: s ? (DAYS[s.attributes.dayname] || s.attributes.dayname || 'Dag ' + i) : 'Dag ' + i, v: num(cfg['solcast_day_' + i]) }); }
    const max = Math.max(1, ...days.map(d => d.v || 0));
    const peakTxt = peak && !['unknown', 'unavailable'].includes(peak.state) ? time(peak.state) : null;
    const cell = (k, v, u) => `<div class="sc"><span>${k}</span><b>${v}<small>${u}</small></b></div>`;
    return `<section class="sx">
      <div class="sh">Prognos</div>
      <div class="sgrid3">
        ${cell('Väntat idag', nf(fc), 'kWh')}
        ${cell('Kvar idag', nf(rem), 'kWh')}
        ${cell('Imorgon', nf(tom), peakTxt ? 'kWh · topp ' + peakTxt : 'kWh')}
      </div>
      ${reached != null ? `<div class="pbh" style="margin-top:12px"><span>Producerat av dagens prognos</span><b>${Math.round(reached)} %</b></div>${bar(reached, 'gold')}` : ''}
      <div class="ss" style="margin-top:8px">Forecast.Solar. Solcast säger ${nf(sc)} kWh idag, ${nf(scRem)} kvar och ${nf(scTom)} imorgon.</div>
      <div class="fdays">${days.map(d => `<div class="fday"><div class="fbar"><span style="height:${Math.max(3, (d.v || 0) / max * 100)}%"></span></div><b>${nf(d.v, 0)}</b><span>${esc(d.k)}</span></div>`).join('')}</div>
      <div class="ss">Kommande dagar enligt Solcast, kWh</div>
    </section>`;
  }
  function solarRich() {
    const w = num(cfg.solar), pred = num(cfg.pv_predicted), today = num(cfg.pv_today), rem = num(cfg.pv_remaining_today);
    const out = num(cfg.grid_out_today), self = today != null && out != null ? Math.max(0, today - out) : null;
    const selfPct = today > 0 && self != null ? self / today * 100 : null;
    const ofPred = pred > 50 && w != null ? w / pred * 100 : null;
    const cloud = num(cfg.cloud_cover);
    const strings = [1, 2].map(i => ({ i, w: num(cfg['solar_' + i]), v: num(cfg['pv_voltage_' + i]), a: num(cfg['pv_current_' + i]) }));
    const sum = strings.reduce((a, x) => a + (x.w || 0), 0);
    const base = moneyData && moneyData.base || {};
    const save = num(cfg.solar_saving), sb = base[cfg.solar_saving];
    const sold = num(cfg.solar_sold), slb = base[cfg.solar_sold];
    const savedToday = save != null && sb != null ? Math.max(0, save - sb) : null;
    const soldToday = sold != null && slb != null ? Math.max(0, sold - slb) : null;
    const y = moneyData && moneyData.year;
    const paid = num(cfg.solar_paid_pct), paidDate = st(cfg.solar_paid_date), earned = num(cfg.solar_earned_total), inv = num(cfg.solar_investment);
    const ac = num(cfg.ac_power), eff = w > 100 && ac != null ? ac / w * 100 : null;
    const mode = st(cfg.device_mode);
    const status = w == null ? 'Ingen data' : w < 20 ? 'Ingen produktion just nu' : ofPred == null ? 'Producerar' :
      ofPred >= 90 ? 'Producerar som väntat' : ofPred >= 60 ? 'Lite under prognosen' : 'Klart under prognosen';
    const cell = (k, v, u) => `<div class="sc"><span>${k}</span><b>${v}<small>${u}</small></b></div>`;
    return `
    <section class="sx hero">
      <div><div class="sk">Nu</div><div class="sbig">${kw(w)}<small>kW</small></div><div class="ss">${status}</div></div>
      <div class="hr">
        <div class="sk">Prognos nu</div><div class="smid">${kw(pred)}<small>kW</small></div>
        ${ofPred != null ? bar(ofPred, 'gold') + `<div class="ss">${Math.round(ofPred)} % av prognosen${cloud != null ? ` · molnighet ${Math.round(cloud)} %` : ''}</div>` : `<div class="ss">${cloud != null ? `Molnighet ${Math.round(cloud)} %` : ''}</div>`}
      </div>
    </section>
    <section class="sx">
      <div class="sh">Idag</div>
      <div class="sgrid2">
        ${cell('Producerat', nf(today), 'kWh')}
        ${cell('Topp', solarPeak ? nf(solarPeak.v / 1000, 2) : '–', solarPeak ? 'kW ' + time(new Date(solarPeak.t).toISOString()) : 'kW')}
      </div>
      <div class="split">
        <div class="splitbar"><span class="a" style="width:${selfPct ?? 0}%"></span><span class="b" style="width:${selfPct == null ? 0 : 100 - selfPct}%"></span></div>
        <div class="splitlbl"><span><i class="a"></i>Använt själv ${nf(self)} kWh${selfPct != null ? ` (${Math.round(selfPct)} %)` : ''}</span><span><i class="b"></i>Sålt ${nf(out)} kWh</span></div>
      </div>
    </section>
    ${forecastSection(today)}
    <section class="sx">
      <div class="sh">Strängar</div>
      <div class="sgrid2">
        ${strings.map(x => `<div class="str">
          <div class="strh"><span>Sträng ${x.i}</span><b>${kw(x.w)}<small>kW</small></b></div>
          ${bar(sum > 0 ? (x.w || 0) / sum * 100 : 0, x.i === 1 ? 'orange' : '')}
          <div class="strv"><span>${x.v == null ? '–' : nf(x.v, 0)} V</span><span>${x.a == null ? '–' : nf(x.a, 1)} A</span><span>${sum > 0 ? Math.round((x.w || 0) / sum * 100) : 0} %</span></div>
        </div>`).join('')}
      </div>
    </section>
    <section class="sx">
      <div class="sh">Växelriktare</div>
      <div class="sgrid3">
        ${cell('AC ut', kw(ac), 'kW')}
        ${cell('Verkningsgrad', eff == null ? '–' : nf(Math.min(eff, 100), 0), '%')}
        ${cell('Belastning', nf(num(cfg.inverter_load), 0), '%')}
        ${cell('Temperatur', nf(num(cfg.inverter_temp)), '°C')}
        ${cell('DC-buss', nf(num(cfg.bus_voltage), 0), 'V')}
        ${cell('Nät', nf(num(cfg.grid_voltage), 0) + ' V · ' + nf(num(cfg.grid_frequency), 2), 'Hz')}
      </div>
      <div class="ss">Läge: ${mode ? esc(mode.state) : '–'}</div>
    </section>
    <section class="sx">
      <div class="sh">Ekonomi</div>
      <div class="sgrid3">
        ${cell('Sparat idag', nf(savedToday, 2), 'kr')}
        ${cell('Sålt idag', nf(soldToday, 2), 'kr')}
        ${cell('Solen i år', y ? nf(y.total_kr, 0) : '–', 'kr')}
      </div>
      <div class="payback">
        <div class="pbh"><span>Återbetalt</span><b>${nf(paid, 1)} %</b></div>
        ${bar(paid, 'sage')}
        <div class="ss">${earned != null ? `${nf(earned, 0)} kr av ${inv != null ? nf(inv, 0) : '–'} kr` : ''}${paidDate && !['unknown', 'unavailable'].includes(paidDate.state) ? ` · betald ungefär ${new Date(paidDate.state).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' })}` : ''}</div>
      </div>
    </section>`;
  }

  const DRAWERS = {
    solar: { eyebrow: 'Sol / produktion', title: 'Solpaneler', wide: true, rich: solarRich, stats: () => [],
      charts: () => [
        { title: 'Produktion mot prognos', unit: 'kW', div: 1000, series: [[cfg.solar, 'Produktion', TC('gold')], [cfg.pv_predicted, 'Prognos', '#9fb4c8', 'dash']], peak: true },
        { title: 'Sträng 1 mot sträng 2', unit: 'kW', div: 1000, series: [[cfg.solar_1, 'Sträng 1', TC('orange')], [cfg.solar_2, 'Sträng 2', TC('sage')]] },
        [cfg.inverter_temp, 'Växelriktarens temperatur', '#c98f6a', 1, '°C'],
      ], extra: () => '<a class="btn primary-link" href="solceller.html">Öppna solcellssidan →</a>' },
    house: { eyebrow: 'Huset / förbrukning', title: 'Huset', stats: () => [
      ['Förbrukning', kw(num(cfg.load)), 'kW'], ['Idag', nf(num(cfg.load_today)), 'kWh'],
      ['Inne', nf(num(cfg.indoor)), '°C'], ['Varmvatten', nf(num(cfg.hot_water, 'temperature')), '°C']],
      ctl: () => phasesCtl(),
      charts: () => [[cfg.load, 'Förbrukning', TC('sage'), 1000, 'kW']].concat(cfg.phases && cfg.phases.current ? [{ title: 'Ström per fas', unit: 'A', div: 1,
        series: cfg.phases.current.map((e, i) => [e, 'L' + (i + 1), [TC('gold'), TC('sage'), TC('blue')][i]]) }] : []) },
    grid: { eyebrow: 'Elnät / import & export', title: 'Elnät', stats: () => [
      ['Nät nu', kw(num(cfg.grid)), num(cfg.grid) < 0 ? 'kW ut' : 'kW in'], ['Elpris', nf(num(cfg.price), 2), 'kr/kWh'],
      ['Köpt idag', nf(num(cfg.grid_in_today)), 'kWh'], ['Sålt idag', nf(num(cfg.grid_out_today)), 'kWh'],
      ['Elkostnad idag', nf(num(cfg.cost_today), 2), 'kr']],
      charts: () => [[cfg.grid, 'Nät (+ köp / − sälj)', TC('blue'), 1000, 'kW']] },
    heatpump: { eyebrow: 'Klimat / värmepump', title: 'Värmepump', ctl: ctlHeatpump, stats: () => [
      ['Effekt', num(cfg.heatpump) == null ? '–' : Math.round(num(cfg.heatpump)).toLocaleString('sv-SE'), 'W'],
      ['Inne', nf(num(cfg.indoor)), '°C'], ['Utblås', nf(num(HPC.exhaust)), '°C'], ['Ute', nf(outdoorTemp()), '°C']],
      charts: () => [[cfg.heatpump, 'Effekt', TC('orange'), 1, 'W'], { title: 'Utblås mot inne', unit: '°C', div: 1, series: [[HPC.exhaust, 'Utblås', TC('orange')], [cfg.indoor, 'Inne', TC('sage')]] }],
      extra: () => '<a class="btn primary-link" href="varmepump.html">Öppna luftvärmepumpssidan →</a>' },
    garage: { eyebrow: 'Garage / laddning', title: 'Laddbox & EV6', stats: () => [
      ['Laddeffekt', kw(num(cfg.charger)), 'kW'], ['EV6', num(cfg.ev_soc) == null ? '–' : Math.round(num(cfg.ev_soc)), '%']],
      charts: () => [[cfg.charger, 'Laddeffekt', TC('sage'), 1000, 'kW'], [cfg.ev_soc, 'EV6 laddnivå', TC('blue'), 1, '%']],
      extra: () => '<a class="btn primary-link" href="laddbox.html">Öppna laddboxsidan →</a> <a class="btn primary-link" href="ev6.html">Öppna EV6-sidan →</a>' },
    hotwater: { eyebrow: 'Värme / varmvatten', title: 'Varmvattenberedare', ctl: ctlWater, stats: () => {
      const s = st(cfg.hot_water);
      return [['Temperatur', nf(num(cfg.hot_water, 'temperature')), '°C'], ['Mål', nf(num(cfg.hot_water, 'target_temperature'), 0), '°C'],
        ['Status', s ? (HW[s.state] || s.state) : '–', '']];
    }, charts: () => [], extra: () => '<a class="btn primary-link" href="varmvatten.html">Öppna varmvattensidan →</a>' },
    // Laddbox och EV6 visar sina egna sidor i en bredare panel
    charger: { eyebrow: 'Garage / laddbox', title: 'Laddbox', frame: 'laddbox.html' },
    car: { eyebrow: 'Garage / bil', title: 'Kia EV6', frame: 'ev6.html' },
    media: { eyebrow: 'Media / spelar nu', title: 'Media', rich: () => '', stats: () => [], charts: () => [], ctl: () => { const h = mediaHtml(); return h ? `<div class="kmlist">${h}</div>` : '<p class="dnote">Inget spelar just nu.</p>'; } },
    access: { eyebrow: 'Säkerhet / lås och portar', title: 'Lås och garageportar', rich: () => '', stats: () => [], charts: () => [], ctl: accessCtl },
    vacuum: { eyebrow: 'Städning / robotdammsugare', title: 'Robotdammsugaren', wide: true, rich: () => '', stats: () => [], charts: () => [], ctl: vacuumCtl },
    info: { eyebrow: 'Huset / säkerhet och luft', title: 'Hus-info', wide: true, rich: () => '', stats: () => [], charts: () => [], ctl: infoCtl },
    lights: { eyebrow: 'Styrning / belysning', title: 'Lampor', wide: true, rich: () => '', stats: () => [], charts: () => [], ctl: lightsCtl },
    alarm: { eyebrow: 'Säkerhet / larm', title: 'Larm', rich: () => '', stats: () => [], charts: () => [], ctl: alarmCtl },
    chores: { eyebrow: 'Barnen / sysslor', title: 'Poäng', wide: true, rich: () => '', stats: () => [], charts: () => [], ctl: choresCtl },
    money: { eyebrow: 'Idag', title: 'Kostnad och energi', stats: () => {
      const m = moneyCalc();
      return [['Faktisk kostnad', kr(num(cfg.cost_today)), 'kr'], ['Uppskattad elkostnad', kr(m.spent), 'kr'], ['Sparat med solel', kr(m.savedToday), 'kr'],
        ['Förbrukat', nf(num(cfg.load_today)), 'kWh'], ['Sol', nf(num(cfg.pv_today)), 'kWh'], ['Egen sol använd', nf(m.self), 'kWh'],
        ['Köpt', nf(num(cfg.grid_in_today)), 'kWh'], ['Sålt', nf(num(cfg.grid_out_today)), 'kWh']];
    }, extra: () => `<div class="dmoney">${detailPage()}</div>`, charts: () => [[cfg.grid, 'Nät (+ köp / − sälj)', TC('blue'), 1000, 'kW']] },
    ftx: { eyebrow: 'Ventilation / FTX', title: 'FTX-aggregatet', ctl: ctlFtx, stats: () => [
      ['Tilluft', nf(num(FX.supply)), '°C'], ['Frånluft', nf(num(FX.extract)), '°C'], ['Ute', nf(num(FX.outdoor)), '°C'],
      ['Verkningsgrad', nf(num(FX.efficiency), 0), '%'], ['Fläktnivå', num(FX.fan_level) == null ? '–' : Math.round(num(FX.fan_level)), ''], ['Effekt', num(FX.power) == null ? '–' : Math.round(num(FX.power)), 'W']],
      charts: () => [{ title: 'Tilluft mot frånluft och ute', unit: '°C', div: 1, series: [[FX.supply, 'Tilluft', TC('orange')], [FX.extract, 'Frånluft', TC('gold')], [FX.outdoor, 'Ute', TC('blue')]] }],
      extra: () => '<a class="btn primary-link" href="ftx.html">Öppna FTX-sidan →</a>' },
    veranda: { eyebrow: 'Uterummet', title: 'Uterummet', stats: () => [['Ute', nf(outdoorTemp()), '°C']], charts: () => [],
      note: 'Här finns inga sensorer kopplade ännu. Säg till vilka entiteter som hör till uterummet.' },
    price: { eyebrow: 'Elpris / idag och imorgon', title: 'Elpris', wide: true, rich: priceRich, stats: () => [], charts: () => [] },
  };
  let drawerOpen = null;
  // ---------- Styrning i detaljpanelen (värmepump, FTX, varmvatten) ----------
  // Servern släpper bara igenom entiteter och värden som står i config; här byggs bara knapparna.
  let lastCtl = '';
  // ---------- Lampor och barnens poäng (menyn längst ner i kiosken) ----------
  const BULB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>';
  let armed = null; // två tryck för "Släck alla" och sysslor: första trycket väljer, andra skickar
  const isArmed = k => armed && armed.k === k && Date.now() - armed.t < 4000;
  function arm(k) { armed = { k, t: Date.now() }; renderDrawerStats(); setTimeout(() => { if (armed && armed.k === k && Date.now() - armed.t >= 4000) { armed = null; renderDrawerStats(); } }, 4100); }
  const ago = iso => { if (!iso) return ''; const m = Math.floor((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'nyss' : m < 60 ? m + ' min' : m < 1440 ? Math.floor(m / 60) + ' h' : Math.floor(m / 1440) + ' d'; };
  const pill = (txt, cls) => `<span class="ipill ${cls || ''}">${esc(txt)}</span>`;
  // Fasbelastning i Huset-panelen
  function phasesCtl() {
    const P = cfg.phases; if (!P || !P.current) return '';
    const fuse = P.fuse || 20;
    const rows = P.current.map((e, i) => {
      const a = num(e), w = P.power && num(P.power[i]), v = P.voltage && num(P.voltage[i]);
      const pct = a == null ? 0 : Math.min(100, a / fuse * 100), cls = pct >= 90 ? 'hi' : pct >= 70 ? 'mid' : '';
      return `<div class="prow ${cls}"><span class="pl">L${i + 1}</span><div class="pbar"><i style="width:${pct}%"></i></div><b>${a == null ? '–' : nf(a, 1)}<small> A</small></b><span class="px">${w == null ? '' : nf(w / 1000, 2) + ' kW'}${v == null ? '' : ' · ' + nf(v, 0) + ' V'}</span></div>`;
    }).join('');
    return `<div class="eyebrow">Belastning per fas · säkring ${fuse} A</div><div class="phases">${rows}</div>`;
  }
  // Lås och garageportar
  const COVER_L = { closed: 'Stängd', open: 'Öppen', opening: 'Öppnar …', closing: 'Stänger …', unavailable: 'Ej nåbar', unknown: 'Okänt' };
  function accessCtl() {
    const D = cfg.door; if (!D || !D.items) return '';
    return `<div class="acc">${D.items.map(it => {
      const s = st(it.entity), state = s ? s.state : 'unavailable', isCover = it.entity.startsWith('cover.');
      let label, cls, btn = '', key;
      if (isCover) {
        label = COVER_L[state] || state; cls = state === 'closed' ? 'ok' : state === 'open' ? 'warn' : state === 'opening' || state === 'closing' ? 'mid' : 'off';
        const cmd = state === 'opening' || state === 'closing' ? 'stop' : state === 'open' ? 'close' : state === 'closed' ? 'open' : null;
        key = 'cov:' + it.entity + ':' + cmd;
        if (cmd) btn = `<button class="abtn${isArmed(key) ? ' armed' : ''}" data-cover="${esc(it.entity)}" data-cmd="${cmd}">${isArmed(key) ? 'Tryck igen' : { open: 'Öppna', close: 'Stäng', stop: 'Stoppa' }[cmd]}</button>`;
      } else {
        label = LOCK_L[state] || state; cls = state === 'locked' ? 'ok' : state === 'unlocked' || state === 'open' || state === 'jammed' ? 'warn' : state === 'unavailable' || state === 'unknown' ? 'off' : 'mid';
        const cmd = state === 'locked' ? (D.allow_unlock ? 'unlock' : null) : state === 'unlocked' || state === 'open' || state === 'jammed' ? 'lock' : null;
        key = 'lock:' + it.entity + ':' + cmd;
        if (cmd) btn = `<button class="abtn${isArmed(key) ? ' armed' : ''}" data-lockc="${esc(it.entity)}" data-cmd="${cmd}">${isArmed(key) ? 'Tryck igen' : cmd === 'lock' ? 'Lås' : 'Lås upp'}</button>`;
      }
      const icon = isCover ? '<svg viewBox="0 0 24 24"><path d="M3 21V9l9-5 9 5v12M7 21v-8h10v8M7 16h10"/></svg>' : (state === 'locked' ? LOCK_SVG.locked : LOCK_SVG.unlocked);
      return `<div class="arow ${cls}"><span class="aic">${icon}</span><div class="atx"><b>${esc(it.name)}</b><small>${esc(label)}${it.sub ? ' · ' + esc(it.sub) : ''}${s && s.last_updated ? ' · ' + ago(s.last_updated) : ''}</small></div>${btn}</div>`;
    }).join('')}</div><p class="dnote">Alla knappar kräver två tryck.</p>`;
  }
  // Robotdammsugaren
  const VAC_L = { docked: 'I dockan', cleaning: 'Städar', returning: 'Åker hem', idle: 'Väntar', paused: 'Pausad', error: 'Fel', unavailable: 'Ej nåbar' };
  function vacuumCtl() {
    const V = cfg.vacuum; if (!V) return '';
    const s = st(V.entity), state = s ? s.state : 'unavailable', bat = num(V.battery);
    const on = V.rooms.filter(r => (st(r.entity) || {}).state === 'on');
    const extra = [];
    const room = st(V.room_now); if (state === 'cleaning' && room && !['unknown', 'unavailable'].includes(room.state)) extra.push('Nu: ' + room.state);
    const prog = num(V.progress); if (state === 'cleaning' && prog != null) extra.push(nf(prog, 0) + ' %');
    const err = st(V.error); if (err && !['no_error', 'unknown', 'unavailable'].includes(err.state)) extra.push('Fel: ' + err.state.replace(/_/g, ' '));
    const head = `<div class="vhead ${state}"><div><b>${esc(VAC_L[state] || state)}</b><small>${bat != null ? 'Batteri ' + nf(bat, 0) + ' %' : ''}${extra.length ? ' · ' + esc(extra.join(' · ')) : ''}</small></div>
      <div class="vcmds">${state === 'cleaning' ? '<button class="abtn" data-vaccmd="pause">Pausa</button>' : ''}${['cleaning', 'paused', 'idle', 'error'].includes(state) ? '<button class="abtn" data-vaccmd="return_to_base">Åk hem</button>' : ''}</div></div>`;
    const rooms = `<div class="eyebrow">Välj rum · ${on.length ? on.length + ' valda' : 'inga valda'}</div><div class="vrooms">${V.rooms.map(r => {
      const rs = st(r.entity), o = rs && rs.state === 'on';
      return `<button class="vroom ${o ? 'on' : ''}" data-room="${esc(r.entity)}" data-on="${o}" ${rs ? '' : 'disabled'}>${esc(r.name)}</button>`;
    }).join('')}</div>`;
    const go = `<div class="vgo">${V.modes.map(m => { const k = 'vac:' + m.script; return `<button class="vstart${isArmed(k) ? ' armed' : ''}" data-vacgo="${esc(m.script)}" ${on.length ? '' : 'disabled'}>${isArmed(k) ? 'Tryck igen för att starta' : esc(m.name)}</button>`; }).join('')}</div>`;
    return head + rooms + go + `<p class="dnote">${on.length ? 'Starta kräver två tryck.' : 'Välj minst ett rum först.'}</p>`;
  }
  // Hus-info: luft, dörrar, rörelse, vattenläckor, brandvarnare
  function infoCtl() {
    const I = cfg.info; if (!I) return '';
    const sec = (title, sum, cls, tiles) => `<div class="isec"><div class="ihead"><span class="eyebrow">${esc(title)}</span>${pill(sum, cls)}</div><div class="igrid">${tiles}</div></div>`;
    const tile = (name, val, cls, extra) => `<div class="itile ${cls || ''}"><span>${esc(name)}</span><b>${val}</b>${extra || ''}</div>`;
    const dead = s => !s || s.state === 'unavailable' || s.state === 'unknown';
    let worst = -1;
    const air = (I.air || []).map(a => { const v = num(a.entity); const l = v == null ? -1 : v < a.t[0] ? 0 : v < a.t[1] ? 1 : v < a.t[2] ? 2 : 3; worst = Math.max(worst, l);
      return tile(a.name, v == null ? '–' : nf(v, 0) + (a.unit ? `<small> ${esc(a.unit)}</small>` : ''), ['ok', '', 'mid', 'warn'][l] || 'off', `<i class="ibar"><em style="width:${v == null ? 0 : Math.min(100, v / a.max * 100)}%"></em></i>`); }).join('');
    let open = 0; const doors = (I.doors || []).map(d => { const s = st(d.entity); const o = s && s.state === 'on'; if (o) open++;
      return tile(d.name, dead(s) ? 'Offline' : o ? 'Öppen' : 'Stängd', dead(s) ? 'off' : o ? 'warn' : 'ok', o && s.last_updated ? `<small>${ago(s.last_updated)}</small>` : ''); }).join('');
    let act = 0; const motion = (I.motion || []).map(d => { const s = st(d.entity); const o = s && s.state === 'on'; if (o) act++;
      return tile(d.name, dead(s) ? 'Offline' : o ? (d.camera ? 'Person!' : 'Rörelse') : 'Lugnt', dead(s) ? 'off' : o ? (d.camera ? 'warn' : 'mid') : 'ok', !o && s && s.last_updated ? `<small>${ago(s.last_updated) === 'nyss' ? 'nyss' : ago(s.last_updated) + ' sedan'}</small>` : ''); }).join('');
    let leak = 0, loff = 0; const leaks = (I.leaks || []).map(d => { const s = st(d.entity); const o = s && s.state === 'on'; if (o) leak++; if (dead(s)) loff++;
      return tile(d.name, dead(s) ? 'Offline' : o ? 'LÄCKA!' : 'Torrt', dead(s) ? 'off' : o ? 'alarm' : 'ok'); }).join('');
    let fire = 0, chk = 0; const smoke = (I.smoke || []).map(d => { const s = st(d.entity); const o = s && s.state === 'on';
      const bat = (d.bat && (st(d.bat) || {}).state === 'on') || (d.batpct && num(d.batpct) != null && num(d.batpct) < 20), fault = d.fault && (st(d.fault) || {}).state === 'on', test = d.test && (st(d.test) || {}).state === 'on';
      let v = 'OK', c = 'ok'; if (o) { v = 'RÖK!'; c = 'alarm'; fire++; } else if (test) { v = 'Test'; c = 'mid'; } else if (dead(s)) { v = 'Offline'; c = 'off'; chk++; } else if (fault) { v = 'Fel'; c = 'mid'; chk++; } else if (bat) { v = 'Batteri'; c = 'mid'; chk++; }
      return tile(d.name, v, c); }).join('');
    return sec('Luftkvalitet', worst < 0 ? '–' : ['Bra', 'Okej', 'Sämre', 'Dålig'][worst], ['ok', '', 'mid', 'warn'][worst] || '', air)
      + sec('Dörrar', open ? open + (open === 1 ? ' öppen' : ' öppna') : 'Allt stängt', open ? 'warn' : 'ok', doors)
      + sec('Rörelse', act ? act + ' aktiva' : 'Lugnt', act ? 'mid' : 'ok', motion)
      + sec('Vattenläckor', leak ? 'LÄCKA' : loff ? loff + ' offline' : 'Torrt', leak ? 'alarm' : loff ? 'mid' : 'ok', leaks)
      + sec('Brandvarnare', fire ? 'BRAND' : chk ? chk + ' behöver koll' : 'Inga larm', fire ? 'alarm' : chk ? 'mid' : 'ok', smoke);
  }
  // Media som spelar och tv som är på (visas överst i kiosken)
  function mediaHtml() {
    const M = cfg.media; if (!M) return '';
    // de som spelar först, sedan tv som bara är på och pausade
    const rank = p => { const s = st(p.entity); return s && s.state === 'playing' ? 0 : 1; };
    return [...M.players].sort((a, b) => rank(a) - rank(b)).map(p => {
      const s = st(p.entity); if (!s) return '';
      const show = p.tv ? !['off', 'unavailable', 'unknown', 'standby'].includes(s.state) : s.state === 'playing' || s.state === 'paused';
      if (!show) return '';
      const a = s.attributes || {}, title = a.media_title || a.app_name || a.source || (s.state === 'on' ? 'På' : ''), sub = [a.media_artist || a.media_series_title, a.media_title ? a.app_name : ''].filter(Boolean).join(' · ');
      const play = s.state === 'playing';
      const b = (cmd, svg, t) => `<button data-mcmd="${cmd}" data-ment="${esc(p.entity)}" aria-label="${t}"><svg viewBox="0 0 24 24">${svg}</svg></button>`;
      return `<div class="kmp ${play ? 'play' : ''}"><span class="kmi"><svg viewBox="0 0 24 24">${p.tv ? '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 21h8M12 17v4"/>' : '<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="14" r="3.5"/><circle cx="12" cy="7" r="1"/>'}</svg></span>
        <div class="kmt"><b>${esc(p.name)}</b><small>${esc(title)}${sub ? ' · ' + esc(sub) : ''}</small></div>
        <span class="kmb">${b('volume_down', '<path d="M5 12h14"/>', 'Sänk')}${b('media_play_pause', play ? '<path d="M8 5v14M16 5v14"/>' : '<path d="M7 5l12 7-12 7z"/>', play ? 'Paus' : 'Spela')}${b('volume_up', '<path d="M5 12h14M12 5v14"/>', 'Höj')}${p.tv ? b('turn_off', '<path d="M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0"/>', 'Stäng av') : b('media_next_track', '<path d="M6 5l9 7-9 7zM18 5v14"/>', 'Nästa')}</span></div>`;
    }).join('');
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-mcmd]'); if (!b) return;
    e.stopPropagation();
    if (b.dataset.mcmd === 'turn_off') { if (!isArmed('moff:' + b.dataset.ment)) { armed = { k: 'moff:' + b.dataset.ment, t: Date.now() }; return toast('Tryck igen för att stänga av tv:n.'); } armed = null; }
    sendCtl({ action: 'media', entity: b.dataset.ment, value: b.dataset.mcmd }, true);
  }, true);
  function lightsCtl() {
    const L = cfg.lights; if (!L) return '<p class="dnote">Inga lampor i config.</p>';
    const on = L.groups.flatMap(g => g.lights).filter(l => (st(l.entity) || {}).state === 'on');
    const head = `<div class="lhead"><span><b>${on.length}</b> tända</span>${L.all_off ? `<button class="lalloff${isArmed('alloff') ? ' armed' : ''}" data-alloff ${on.length ? '' : 'disabled'}>${isArmed('alloff') ? 'Tryck igen för att släcka' : 'Släck alla'}</button>` : ''}</div>`;
    return head + L.groups.map(g => `<div class="lgroup"><div class="eyebrow">${esc(g.name)}</div><div class="lgrid">${g.lights.map(l => {
      const s = st(l.entity), state = s ? s.state : 'unavailable', ok = state === 'on' || state === 'off';
      const br = state === 'on' && s.attributes && s.attributes.brightness != null ? Math.round(s.attributes.brightness / 2.55) + ' %' : '';
      return `<button class="lbtn ${state === 'on' ? 'on' : ''}" data-light="${esc(l.entity)}" data-on="${state === 'on'}" ${ok ? '' : 'disabled'}>${BULB}<span>${esc(l.name)}</span><small>${ok ? (state === 'on' ? (br || 'På') : 'Av') : 'Ej nåbar'}</small></button>`;
    }).join('')}</div></div>`).join('');
  }
  let choreKid = null;
  function choresCtl() {
    const C = cfg.chores; if (!C) return '<p class="dnote">Inga sysslor i config.</p>';
    const goal = num(C.threshold) || 50;
    if (!choreKid || !C.kids.some(k => k.id === choreKid)) choreKid = C.kids[0].id;
    const kids = `<div class="ckids">${C.kids.map(k => {
      const p = num(k.points) || 0, w = num(k.pending) || 0, pct = Math.min(100, p / goal * 100);
      return `<button class="ckid ${k.id === choreKid ? 'sel' : ''}" data-kid="${esc(k.id)}"><div class="cname">${esc(k.name)}</div>
        <div class="cpts"><b>${nf(p, 0)}</b><small> / ${nf(goal, 0)} p</small></div>
        <div class="cbar"><i style="width:${pct}%"></i></div><div class="cwait">${w ? `${nf(w, 0)} väntar på godkännande` : 'Inget väntar'}</div></button>`;
    }).join('')}</div>`;
    const last = st(C.last), lastTxt = last && last.state && !['unknown', 'unavailable', ''].includes(last.state) ? `<p class="clast">Senast: ${esc(last.state)}</p>` : '';
    const kid = C.kids.find(k => k.id === choreKid);
    const list = [...C.chores].sort((a, b) => a.name.localeCompare(b.name, 'sv')).map(c => {
      const k = 'chore:' + choreKid + ':' + c.id;
      return `<button class="cbtn${isArmed(k) ? ' armed' : ''}" data-chore="${esc(c.id)}"><span>${isArmed(k) ? 'Tryck igen' : esc(c.name)}</span><small>+${c.points} p</small></button>`;
    }).join('');
    return kids + lastTxt + `<div class="eyebrow">Vad har ${esc(kid.name)} gjort?</div><div class="cgrid">${list}</div><p class="dnote">Poängen läggs till när en förälder godkänner i mobilen.</p>`;
  }
  // ---------- Elpris-panelen: lägst/snitt/högst, imorgon och AI-sammanfattningen från HA ----------
  function priceDays() {
    const s = st(cfg.price), a = s ? s.attributes : {};
    const list = v => Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
    return { today: list(a.today), tom: a.tomorrow_valid === false ? [] : list(a.tomorrow) };
  }
  function dayStats(arr) {
    if (!arr.length) return null;
    const sorted = [...arr].sort((x, y) => x - y), n = arr.length, mid = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const lo = Math.min(...arr), hi = Math.max(...arr), slot = 1440 / n;
    const at = i => { const m = Math.round(i * slot); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
    return { lo, hi, avg: arr.reduce((x, y) => x + y, 0) / n, mid, loAt: at(arr.indexOf(lo)), hiAt: at(arr.indexOf(hi)) };
  }
  const ptile = (k, v, sub, cls) => `<div class="ptile ${cls || ''}"><span>${k}</span><b>${v}<small> kr</small></b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const pctTxt = (a, b) => { const p = Math.round((a / b - 1) * 100); return (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p) + ' %'; };
  function priceTiles(d, extra = '') {
    if (!d) return '';
    return `<div class="ptiles">${ptile('Lägst', nf(d.lo, 2), 'kl ' + d.loAt, 'lo')}${ptile('Snitt', nf(d.avg, 2), 'Mitt ' + nf(d.mid, 2) + ' kr')}${ptile('Högst', nf(d.hi, 2), 'kl ' + d.hiAt, 'hi')}${extra}</div>`;
  }
  function priceRich() {
    const { today, tom } = priceDays(), dt = dayStats(today), dm = dayStats(tom);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const pts = (arr, off) => arr.map((v, i) => [start.getTime() + off + i * 86400000 / arr.length, v]);
    const tomTile = dm && dt ? ptile('Imorgon', nf(dm.avg, 2), pctTxt(dm.avg, dt.avg) + ' mot idag', dm.avg > dt.avg ? 'hi' : 'lo') : '';
    let h = `<div class="eyebrow">Idag</div>${priceTiles(dt, tomTile)}` + (today.length ? chartBlock('Elpris idag (kr/kWh)', pts(today, 0), TC('orange'), 1, 'kr', true) : '');
    h += `<div class="pday"><div class="eyebrow">Imorgon</div>` + (dm
      ? priceTiles(dm, dt ? ptile('Mot idag', (dm.avg >= dt.avg ? '+' : '−') + nf(Math.abs(dm.avg - dt.avg), 2), pctTxt(dm.avg, dt.avg) + ' i snitt', dm.avg > dt.avg ? 'hi' : 'lo') : '') + chartBlock('Elpris imorgon (kr/kWh)', pts(tom, 86400000), TC('gold'), 1, 'kr', true)
      : '<p class="dnote">Morgondagens priser kommer vid 13-tiden.</p>') + '</div>';
    const A = cfg.ai;
    if (A) {
      // AI-råd från HA (input_text.elrad_*): rubrik, status, sammanfattning och när maskinerna bör köras
      const tx = id => { const s = st(id); return id && s && s.state && !['unknown', 'unavailable'].includes(s.state) ? s.state.trim() : ''; };
      const s0 = st(A.rubrik), when = s0 && s0.last_changed ? new Date(s0.last_changed).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '';
      const status = tx(A.status).toLowerCase(), scls = /dyr/.test(status) ? 'hi' : /billig/.test(status) ? 'lo' : 'mid';
      const IC = { disk: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 8h14"/><circle cx="12" cy="14.5" r="3.5"/>', tvatt: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13.5" r="4.5"/><path d="M8 6h.01M11 6h3"/>', tork: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13.5" r="4.5"/><path d="M10 12c1-1 3 1 4 0M10 15c1-1 3 1 4 0"/>' };
      const rows = (A.rows || []).map(r => tx(r.entity) ? `<div class="airow"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[r.icon] || IC.disk}</svg><span>${esc(tx(r.entity))}</span></div>` : '').join('');
      if (tx(A.rubrik) || tx(A.sammanfattning)) h = `<div class="aisum ${scls}"><div class="aieye"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>AI-råd${when ? ' · ' + when : ''}${status ? `<em class="aistat">${esc(status.charAt(0).toUpperCase() + status.slice(1))}</em>` : ''}</div>
        <div class="aihead"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg><b>${esc(tx(A.rubrik))}</b></div>
        ${tx(A.sammanfattning) ? `<p class="aitext">${esc(tx(A.sammanfattning))}</p>` : ''}${rows ? `<div class="airows">${rows}</div>` : ''}</div>` + h;
    }
    return h;
  }
  // ---------- Larm ----------
  const ALARM_L = { disarmed: 'Avlarmat', armed_home: 'Larmat hemma', armed_away: 'Larmat borta', armed_night: 'Larmat natt', armed_vacation: 'Larmat semester', armed_custom_bypass: 'Larmat (förbikoppling)', arming: 'Larmar på …', pending: 'Inpassering – avlarma!', triggered: 'LARMET HAR GÅTT', disarming: 'Avlarmar …', unavailable: 'Ej nåbart', unknown: 'Okänt' };
  const ALARM_M = { arm_home: 'Hemma', arm_away: 'Borta', arm_night: 'Natt', arm_vacation: 'Semester' };
  const alarmCls = state => state === 'triggered' || state === 'pending' ? 'alarm' : state === 'arming' || state === 'disarming' ? 'mid' : state && state.startsWith('armed') ? 'on' : state === 'disarmed' ? 'ok' : 'off';
  let alarmCode = '', alarmT = null, alarmBusy = false;
  const clearCode = () => { alarmCode = ''; clearTimeout(alarmT); };
  const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.6-3.4 8.1-8 9-4.6-.9-8-4.4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>';
  function alarmCtl() {
    const A = cfg.alarm; if (!A) return '';
    const s = st(A.entity), state = s ? s.state : 'unavailable', at = (s && s.attributes) || {}, cls = alarmCls(state);
    const isArmedState = state.startsWith('armed') || state === 'arming' || state === 'pending' || state === 'triggered';
    const needCode = isArmedState || at.code_arm_required !== false, ok = !needCode || alarmCode.length >= 4;
    const dots = alarmCode ? '●'.repeat(alarmCode.length) : '<span>Ange kod</span>';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k => `<button data-akey="${k}"${k === 'C' || k === '⌫' ? ' class="aux"' : ''}>${k}</button>`).join('');
    const modes = isArmedState
      ? (A.allow_disarm ? `<button class="amode off" data-amode="disarm" ${ok && !alarmBusy ? '' : 'disabled'}>Avlarma</button>` : '<p class="dnote">Avlarmning från kiosken är avstängd.</p>')
      : (A.modes || []).map(m => `<button class="amode" data-amode="${m}" ${ok && !alarmBusy && state === 'disarmed' ? '' : 'disabled'}>${SHIELD}${esc(ALARM_M[m] || m)}</button>`).join('');
    const who = at.changed_by ? ' · ' + esc(at.changed_by) : '';
    return `<div class="alhead ${cls}"><span class="alic">${SHIELD}</span><div><b>${esc(ALARM_L[state] || state)}</b><small>${s && s.last_changed ? 'sedan ' + ago(s.last_changed) : ''}${who}</small></div></div>
      ${at.code_format === 'text' ? '<p class="dnote">Larmet använder textkod, det går inte att skriva här.</p>' : `<div class="alcode">${dots}</div><div class="alkeys">${keys}</div>`}
      <div class="almodes">${modes}</div><p class="dnote">Koden skickas direkt till Home Assistant och sparas inte. Tre fel koder spärrar i fem minuter.</p>`;
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-akey],[data-amode]'); if (!t || !t.closest('#dctl')) return;
    e.stopPropagation();
    clearTimeout(alarmT); alarmT = setTimeout(() => { clearCode(); renderDrawerStats(); }, 30000);
    if (t.dataset.akey) {
      const k = t.dataset.akey;
      alarmCode = k === 'C' ? '' : k === '⌫' ? alarmCode.slice(0, -1) : alarmCode.length < 12 ? alarmCode + k : alarmCode;
      return renderDrawerStats();
    }
    const code = alarmCode; clearCode(); alarmBusy = true; renderDrawerStats();
    sendCtl({ action: 'alarm', entity: cfg.alarm.entity, value: { mode: t.dataset.amode, code } }, true)
      .then(ok => { alarmBusy = false; renderDrawerStats(); if (ok) toast(t.dataset.amode === 'disarm' ? 'Avlarmar.' : 'Larmar på: ' + (ALARM_M[t.dataset.amode] || '')); });
  }, true);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-light],[data-alloff],[data-kid],[data-chore],[data-cover],[data-lockc],[data-room],[data-vacgo],[data-vaccmd]'); if (!t || !t.closest('#dctl')) return;
    e.stopPropagation();
    if (t.dataset.cover || t.dataset.lockc) {
      const ent = t.dataset.cover || t.dataset.lockc, k = (t.dataset.cover ? 'cov:' : 'lock:') + ent + ':' + t.dataset.cmd;
      if (!isArmed(k)) return arm(k);
      armed = null; renderDrawerStats();
      sendCtl(t.dataset.cover ? { action: 'cover', entity: ent, value: t.dataset.cmd } : { action: 'lock', entity: ent, value: t.dataset.cmd });
    } else if (t.dataset.room) {
      const on = t.dataset.on !== 'true', s = states[t.dataset.room];
      if (s) { states[t.dataset.room] = Object.assign({}, s, { state: on ? 'on' : 'off' }); renderDrawerStats(); }
      sendCtl({ action: 'toggle', entity: t.dataset.room, value: on }, true);
    } else if (t.dataset.vacgo) {
      const k = 'vac:' + t.dataset.vacgo;
      if (!isArmed(k)) return arm(k);
      armed = null; renderDrawerStats(); sendCtl({ action: 'script', entity: t.dataset.vacgo });
    } else if (t.dataset.vaccmd) sendCtl({ action: 'vacuum', entity: cfg.vacuum.entity, value: t.dataset.vaccmd });
    else if (t.dataset.light) {
      const on = t.dataset.on !== 'true';
      const s = states[t.dataset.light]; if (s) { states[t.dataset.light] = Object.assign({}, s, { state: on ? 'on' : 'off' }); renderDrawerStats(); } // visa direkt, strömmen rättar
      sendCtl({ action: 'toggle', entity: t.dataset.light, value: on }, true);
    } else if (t.hasAttribute('data-alloff')) {
      if (!isArmed('alloff')) return arm('alloff');
      armed = null; sendCtl({ action: 'lights_off' }); renderDrawerStats();
    } else if (t.dataset.kid) { choreKid = t.dataset.kid; armed = null; renderDrawerStats(); }
    else if (t.dataset.chore) {
      const k = 'chore:' + choreKid + ':' + t.dataset.chore;
      if (!isArmed(k)) return arm(k);
      armed = null; renderDrawerStats();
      const C = cfg.chores, kid = C.kids.find(x => x.id === choreKid), ch = C.chores.find(x => x.id === t.dataset.chore);
      sendCtl({ action: 'chore', value: { barn: choreKid, syssla: t.dataset.chore } }, true).then(ok => { if (ok) toast(`${kid.name}: ${ch.name.toLowerCase()} skickat för godkännande.`); });
    }
  }, true);
  const pendingVal = {}, sendT = {};
  const A = (id, k) => { const s = st(id); return s && s.attributes ? s.attributes[k] : undefined; };
  const isOn = id => !!(st(id) && st(id).state === 'on');
  const segBtns = (opts, cur, act, entity) => `<div class="seg cseg">${opts.map(([v, l]) => `<button data-ctl="${act}" data-entity="${esc(entity || '')}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('')}</div>`;
  const toggleBtn = (id, label) => id && st(id) ? `<button class="ctog${isOn(id) ? ' on' : ''}" data-ctl="toggle" data-entity="${esc(id)}" data-v="${isOn(id) ? 'off' : 'on'}" aria-pressed="${isOn(id)}"><i></i>${esc(label)}</button>` : '';
  const stepper = (key, val, unit, dec, act, entity) => `<div class="cstep"><button data-ctl="${act}" data-entity="${esc(entity)}" data-step="-1" aria-label="Sänk">−</button><b>${val == null ? '–' : nf(val, dec)}<small>${unit}</small></b><button data-ctl="${act}" data-entity="${esc(entity)}" data-step="1" aria-label="Höj">+</button></div>`;
  const crow = (label, html) => html ? `<div class="crow"><span>${esc(label)}</span>${html}</div>` : '';
  const HVAC_L = { heat: 'Värme', cool: 'Kyla', fan_only: 'Fläkt', dry: 'Torka', auto: 'Auto', heat_cool: 'Auto', off: 'Av' };
  const FAN_L = { auto: 'Auto', quiet: 'Tyst', low: 'Låg', medium: 'Mellan', high: 'Hög' };
  const W_MODE = { cheapest: 'Billigast', solar: 'Sol', hybrid: 'Hybrid' };
  const numVal = id => pendingVal[id] != null ? pendingVal[id] : num(id);
  function ctlHeatpump() {
    const id = HPC.climate; if (!HPC.controls || !id || !st(id)) return '';
    const modes = A(id, 'hvac_modes') || [], fans = A(id, 'fan_modes') || [];
    const t = pendingVal[id] != null ? pendingVal[id] : A(id, 'temperature');
    const on = st(id).state !== 'off', fm = A(id, 'fan_mode');
    const now = `<div class="cnow"><span>Nu</span><b>${esc(HVAC_L[st(id).state] || st(id).state)}</b>${on && A(id, 'temperature') != null ? `<b>${nf(A(id, 'temperature'), 1)} °C</b>` : ''}${on && fm ? `<b>Fläkt ${esc(FAN_L[fm] || fm)}</b>` : ''}</div>`;
    return `<div class="eyebrow">Styr värmepumpen</div>${now}
      ${crow('Läge', segBtns(modes.map(m => [m, HVAC_L[m] || m]), st(id).state, 'hvac_mode'))}
      ${st(id).state !== 'off' && t != null ? crow('Måltemperatur', stepper(id, t, '°C', 1, 'temperature', id)) : ''}
      ${fans.length && st(id).state !== 'off' ? crow('Fläkt', segBtns(fans.map(f => [f, FAN_L[f] || f]), A(id, 'fan_mode'), 'fan_mode')) : ''}`;
  }
  function ctlFtx() {
    if (!FX.controls) return '';
    return `<div class="eyebrow">Styr FTX</div>
      <div class="ctogs">${toggleBtn(FX.unit, 'Aggregat på')}${toggleBtn(FX.boost, 'Forcering')}${toggleBtn(FX.away, 'Bortaläge')}${toggleBtn(FX.pressure, 'Tryckkompensering')}</div>
      ${FX.setpoint && st(FX.setpoint) ? crow('Tilluft börvärde', stepper(FX.setpoint, numVal(FX.setpoint), '°C', 0, 'number', FX.setpoint)) : ''}`;
  }
  function ctlWater() {
    const S = WC.settings || {}; if (!WC.controls) return '';
    const mode = st(S.mode);
    return `<div class="eyebrow">Styr varmvattnet</div>
      <div class="ctogs">${toggleBtn(S.boost, 'Värm nu')}${toggleBtn(S.automatic, 'Automatik')}</div>
      ${mode ? crow('Läge', segBtns((mode.attributes.options || []).map(o => [o, W_MODE[o] || o]), mode.state, 'select', S.mode)) : ''}
      ${S.target && st(S.target) ? crow('Måltemperatur', stepper(S.target, numVal(S.target), '°C', 0, 'number', S.target)) : ''}
      ${S.comfort && st(S.comfort) ? crow('Komfortgräns', stepper(S.comfort, numVal(S.comfort), '°C', 0, 'number', S.comfort)) : ''}`;
  }
  async function sendCtl(body, quiet) {
    try {
      const r = await fetch('api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      if (!quiet) toast('Skickat till Home Assistant.');
      return true;
    } catch (e) { toast('Gick inte: ' + e.message); return false; }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ctl]'); if (!b || !b.closest('#dctl')) return;
    e.stopPropagation();
    const act = b.dataset.ctl, entity = b.dataset.entity || undefined, v = b.dataset.v;
    if (b.dataset.step) {
      // −/+ samlas ihop en kort stund så att flera tryck blir ett kommando
      const id = entity, climate = act === 'temperature';
      const step = climate ? (A(id, 'target_temp_step') || 0.5) : (A(id, 'step') || 1);
      const lo = climate ? (A(id, 'min_temp') ?? 10) : A(id, 'min'), hi = climate ? (A(id, 'max_temp') ?? 30) : A(id, 'max');
      const cur = pendingVal[id] != null ? pendingVal[id] : climate ? A(id, 'temperature') : num(id);
      if (cur == null) return;
      let nv = Math.round((cur + step * Number(b.dataset.step)) / step) * step;
      if (lo != null) nv = Math.max(lo, nv); if (hi != null) nv = Math.min(hi, nv);
      pendingVal[id] = +nv.toFixed(2); renderDrawerStats();
      clearTimeout(sendT[id]);
      sendT[id] = setTimeout(async () => { const val = pendingVal[id]; await sendCtl(climate ? { action: 'temperature', value: val } : { action: 'number', entity: id, value: val }); setTimeout(() => { delete pendingVal[id]; renderDrawerStats(); }, 4000); }, 800);
      return;
    }
    if (act === 'toggle') {
      if (entity === FX.unit && v === 'off' && !confirm('Stänga av FTX-aggregatet?')) return;
      sendCtl({ action: 'toggle', entity, value: v === 'on' });
    } else if (act === 'select') sendCtl({ action: 'select', entity, value: v });
    else if (act === 'hvac_mode' || act === 'fan_mode') {
      if (act === 'hvac_mode' && v === 'off' && !confirm('Stänga av värmepumpen?')) return;
      sendCtl({ action: act, value: v });
    }
  }, true);

  async function openDrawer(id) {
    const d = DRAWERS[id]; if (!d) return;
    drawerOpen = id;
    $('drawer-eyebrow').textContent = d.eyebrow; $('drawer-title').textContent = d.title;
    $('drawer').classList.toggle('wide', !!d.wide);
    $('drawer').classList.toggle('framed', !!d.frame);
    if (d.frame) {
      $('drawer-stats').innerHTML = '';
      const cur = $('drawer-charts').querySelector('iframe');
      if (!cur || cur.dataset.src !== d.frame) $('drawer-charts').innerHTML = `<iframe class="dframe" data-src="${d.frame}" src="${d.frame}?embed=1" title="${esc(d.title)}"></iframe>`;
      $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('scrim').hidden = false;
      return;
    }
    renderDrawerStats();
    $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('scrim').hidden = false;
    const body = $('drawer-charts');
    const charts = d.charts().map(c => Array.isArray(c) ? { title: c[1], unit: c[4], div: c[3], series: [[c[0], c[1], c[2]]] } : c);
    lastCtl = '';
    body.innerHTML = (d.ctl ? `<div id="dctl" class="dctl">${(lastCtl = d.ctl())}</div>` : '') + (d.extra ? d.extra() : '') + charts.map((c, i) => `<div class="dchart" id="dc${i}"><div class="eyebrow">${esc(c.title)} · senaste 24 h</div><div class="empty">Hämtar historik …</div></div>`).join('') +
      (d.note ? `<p class="dnote">${esc(d.note)}</p>` : '');
    charts.forEach(async (c, i) => {
      const box = $('dc' + i);
      try {
        const res = await Promise.all(c.series.filter(x => x[0]).map(async ([eid, label, color, style]) => {
          const r = await fetch(`api/history?entity=${encodeURIComponent(eid)}&hours=24`, { cache: 'no-store' });
          if (!r.ok) throw new Error((await r.json()).error || r.statusText);
          return { label, color, style, points: (await r.json()).points };
        }));
        if (drawerOpen !== id || !box.isConnected) return;
        if (c.peak && res[0] && res[0].points.length) {
          const mid = new Date(); mid.setHours(0, 0, 0, 0);
          const todayPts = res[0].points.map(([t, v]) => [typeof t === 'string' ? Date.parse(t) : t, v]).filter(p => p[0] >= mid.getTime());
          if (todayPts.length) { const m = todayPts.reduce((a, p) => p[1] > a[1] ? p : a); solarPeak = { t: m[0], v: m[1] }; renderDrawerStats(); }
        }
        box.outerHTML = res.length > 1 ? chartMulti(`${c.title} · senaste 24 h`, res, c.div, c.unit)
          : chartBlock(`${c.title} · senaste 24 h`, res[0] && res[0].points, res[0] && res[0].color, c.div, c.unit);
      } catch (e) { if (box.isConnected) box.querySelector('.empty').textContent = 'Kunde inte hämta historik (' + e.message + ').'; }
    });
  }
  function renderDrawerStats() {
    if (!drawerOpen) return;
    const d = DRAWERS[drawerOpen];
    if (d.frame) return;
    if (d.ctl && $('dctl')) { const h = d.ctl(); if (h !== lastCtl) { $('dctl').innerHTML = h; lastCtl = h; } }
    if (d.rich) { $('drawer-stats').innerHTML = d.rich(); return; }
    $('drawer-stats').innerHTML = `<div class="dstats">${d.stats().map(([k, v, u]) => `<div class="dstat"><span>${esc(k)}</span><b>${v}<small>${esc(u)}</small></b></div>`).join('')}</div>`;
  }
  function closeDrawer() {
    const wasFrame = drawerOpen && DRAWERS[drawerOpen] && DRAWERS[drawerOpen].frame;
    if (drawerOpen === 'alarm') clearCode();
    drawerOpen = null; $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); $('scrim').hidden = true;
    // Sidan i panelen stängs så att dess liveström inte ligger kvar
    if (wasFrame) setTimeout(() => { if (!drawerOpen) { $('drawer').classList.remove('framed'); $('drawer-charts').innerHTML = ''; } }, 320);
  }
  $('drawer-close').addEventListener('click', closeDrawer);
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || !e.data.obsOpen) return;
    const id = Object.keys(DRAWERS).find(k => DRAWERS[k].frame === e.data.obsOpen);
    if (id) openDrawer(id); else if (!document.body.classList.contains('kiosk')) location.href = e.data.href;
  });
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  function chartBlock(title, points, color, div, unit, step) {
    if (!points || !points.length) return `<div class="dchart"><div class="eyebrow">${esc(title)}</div><div class="empty">Ingen historik.</div></div>`;
    const W = 440, H = 170, pl = 34, pr = 6, pt = 8, pb = 20;
    const pts = points.map(([t, v]) => [typeof t === 'string' ? Date.parse(t) : t, v / div]);
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
    if (lo > 0 && unit !== '°C' && unit !== '%') lo = 0;
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * .08; lo -= lo === 0 ? 0 : pad; hi += pad;
    const x = t => pl + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - pl - pr);
    const y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    let d = ''; pts.forEach(([t, v], i) => {
      if (step && i) d += `L${x(t).toFixed(1)},${y(pts[i - 1][1]).toFixed(1)}`;
      d += `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
    });
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4;
      g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, Math.abs(hi - lo) < 5 ? 1 : 0)}</text>`;
    }
    if (lo < 0 && hi > 0) g += `<line class="zero" x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}"/>`;
    const span = t1 - t0, stepH = span > 30 * 3600e3 ? 12 : span > 8 * 3600e3 ? 4 : 1;
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t <= t1; t += 3600e3) {
      const hh = new Date(t).getHours(); if (hh % stepH) continue;
      g += `<text class="ax" x="${x(t)}" y="${H - 5}" text-anchor="middle">${String(hh).padStart(2, '0')}</text>`;
    }
    const base = y(Math.max(lo, 0));
    return `<div class="dchart"><div class="eyebrow">${esc(title)} <span style="float:right">${esc(unit)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}
      <path class="ar" fill="${color}" d="${d}L${x(t1)},${base}L${x(t0)},${base}Z"/><path class="ln" stroke="${color}" d="${d}"/></svg></div>`;
  }

  function chartMulti(title, series, div, unit) {
    const all = series.flatMap(sr => (sr.points || []).map(([t, v]) => [typeof t === 'string' ? Date.parse(t) : t, v / div]));
    if (!all.length) return `<div class="dchart"><div class="eyebrow">${esc(title)}</div><div class="empty">Ingen historik.</div></div>`;
    const W = 440, H = 170, pl = 34, pr = 6, pt = 8, pb = 20;
    const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]));
    let lo = Math.min(0, ...all.map(p => p[1])), hi = Math.max(...all.map(p => p[1]));
    if (hi === lo) hi = lo + 1; hi += (hi - lo) * .08;
    const x = t => pl + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - pl - pr);
    const y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4;
      g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, hi - lo < 5 ? 1 : 0)}</text>`; }
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t <= t1; t += 3600e3) { const hh = new Date(t).getHours(); if (hh % 4) continue;
      g += `<text class="ax" x="${x(t)}" y="${H - 5}" text-anchor="middle">${String(hh).padStart(2, '0')}</text>`; }
    const paths = series.map((sr, k) => {
      const pts = (sr.points || []).map(([t, v]) => [typeof t === 'string' ? Date.parse(t) : t, v / div]);
      if (!pts.length) return '';
      const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
      const area = k === 0 ? `<path class="ar" fill="${sr.color}" d="${d}L${x(pts[pts.length - 1][0])},${y(0)}L${x(pts[0][0])},${y(0)}Z"/>` : '';
      return area + `<path class="ln${sr.style === 'dash' ? ' dash' : ''}" stroke="${sr.color}" d="${d}"/>`;
    }).join('');
    const legend = series.map(sr => `<span><i style="background:${sr.color}"></i>${esc(sr.label)}</span>`).join('');
    return `<div class="dchart"><div class="eyebrow">${esc(title)} <span style="float:right">${esc(unit)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}${paths}</svg><div class="legend">${legend}</div></div>`;
  }

  // ---------- Redigeringsläge ----------
  const pct = (e) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100]; };
  const round = v => Math.round(v * 10) / 10;
  function startBoxDrag(e, id, el) {
    if (!editing) return;
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const r = stage.getBoundingClientRect(), b = layout.boxes[id];
    const sx = e.clientX, sy = e.clientY, ox = b.x, oy = b.y;
    const move = ev => {
      b.x = round(ox + (ev.clientX - sx) / r.width * 100); b.y = round(oy + (ev.clientY - sy) / r.height * 100);
      el.style.left = b.x + '%'; el.style.top = b.y + '%'; el._dragged = true; drawWires();
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  }
  function dragHandle(h, onMove, onEnd) {
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId);
      const move = ev => { const p = pct(ev).map(round); h.style.left = p[0] + '%'; h.style.top = p[1] + '%'; onMove(p); };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); onEnd && onEnd(); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
    });
  }
  function buildHandles() {
    handles.innerHTML = '';
    if (!editing) return;
    const mk = (cls, p, title) => { const h = document.createElement('div'); h.className = 'h ' + cls; h.style.left = p[0] + '%'; h.style.top = p[1] + '%'; if (title) h.title = title; handles.appendChild(h); return h; };
    for (const [id, b] of Object.entries(layout.boxes)) {
      if (!b.anchor) continue;
      dragHandle(mk('anchor', b.anchor, 'Punkt för ' + (BOX[id] ? BOX[id].title : id)), p => { b.anchor = p; drawWires(); });
    }
    for (const m of (cfg.door && cfg.door.markers) || []) {
      const p = lockPos(m); if (!p) continue;
      dragHandle(mk('lockh', p, 'Låsikon ' + (m.name || m.entity)), q => { (layout.locks = layout.locks || {})[m.entity] = q; placeLocks(); });
    }
    for (const [id, hs] of Object.entries(layout.hotspots)) {
      const poly = hot.querySelector(`polygon[data-id="${id}"]`);
      const sync = () => poly.setAttribute('points', hs.points.map(q => q.join(',')).join(' '));
      hs.points.forEach((p, i) => {
        const h = mk('vtx', p, (HOT_TITLES[id] || id) + ' – dubbelklicka för att ta bort');
        dragHandle(h, q => { hs.points[i] = q; sync(); }, buildHandles);
        h.addEventListener('dblclick', () => { if (hs.points.length > 3) { hs.points.splice(i, 1); sync(); buildHandles(); } });
      });
      hs.points.forEach((p, i) => {
        const q = hs.points[(i + 1) % hs.points.length];
        const m = [round((p[0] + q[0]) / 2), round((p[1] + q[1]) / 2)];
        const h = mk('mid', m, 'Dra för att lägga till ett hörn');
        let added = false;
        dragHandle(h, np => { if (!added) { hs.points.splice(i + 1, 0, np); added = true; } else hs.points[i + 1] = np; sync(); }, buildHandles);
      });
    }
  }
  function setEditing(on) {
    editing = on;
    document.body.classList.toggle('edit', on);
    $('edit-bar').hidden = !on;
    $('edit-btn').textContent = on ? 'Redigerar …' : 'Redigera layout';
    if (on) { delete layout.boxes.ev6.auto; saved = clone(layout); closeDrawer(); }
    buildHandles();
  }
  $('edit-btn').addEventListener('click', () => setEditing(!editing));
  $('edit-cancel').addEventListener('click', () => { layout = clone(saved); buildHot(); placeBoxes(); placeLocks(); setEditing(false); drawWires(); });
  $('edit-reset').addEventListener('click', () => { layout = clone(DEFAULT); delete layout.boxes.ev6.auto; buildHot(); placeBoxes(); placeLocks(); buildHandles(); drawWires(); toast('Standardlayouten är tillbaka. Tryck Spara för att behålla den.'); });
  $('edit-save').addEventListener('click', async () => {
    try {
      const r = await fetch('api/layout', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(layout) });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      setEditing(false); toast('Layouten är sparad.');
    } catch (e) { toast('Kunde inte spara: ' + e.message); }
  });

  // ---------- Klocka ----------
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();

  // ---------- Data ----------
  let queued = false;
  function refresh() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const live = connected && [cfg.solar, cfg.load, cfg.grid].every(id => states[id] && !['unknown', 'unavailable'].includes(states[id].state));
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      renderBoxes(); applyLight();
      if (drawerOpen) renderDrawerStats();
    });
  }

  async function start() {
    const [c, l] = await Promise.all([
      fetch('api/house', { cache: 'no-store' }).then(r => r.json()),
      fetch('api/layout', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('api/ftx', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch('api/heatpump', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch('api/water', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch('api/charger', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch('api/car', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]).then(([a, b, f, h, w, ch, car]) => { FX = f || {}; HPC = h || {}; WC = w || {}; CHC = ch || {}; CARC = car || {}; return [a, b]; });
    cfg = c;
    if (cfg.title) $('title').textContent = cfg.title;
    if (cfg.subtitle) $('subtitle').textContent = cfg.subtitle;
    // Sparad layout ovanpå standarden (nya rutor får standardläge)
    const OLD_ANCHOR = { ladd: [81.5, 51] }; // gamla standardpunkter som flyttats, byts bara om de inte dragits för hand
    for (const [id, b] of Object.entries(l.boxes || {})) if (layout.boxes[id]) {
      const old = OLD_ANCHOR[id], def = layout.boxes[id].anchor;
      Object.assign(layout.boxes[id], b); if (!b.auto) delete layout.boxes[id].auto;
      if (old && b.anchor && b.anchor[0] === old[0] && b.anchor[1] === old[1]) layout.boxes[id].anchor = def;
    }
    for (const [id, h] of Object.entries(l.hotspots || {})) if (layout.hotspots[id] && h.points) layout.hotspots[id].points = h.points;
    if (l.locks && typeof l.locks === 'object') layout.locks = l.locks;
    buildBoxes(); buildHot(); refresh();
    loadMoney(); setInterval(loadMoney, 10 * 60 * 1000);

    const es = new EventSource('api/stream');
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; refresh(); });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; refresh(); });
    es.onerror = () => { connected = false; refresh(); };
  }
  new ResizeObserver(() => drawWires()).observe(stage);
  window.addEventListener('resize', () => { fitBoxes(); drawWires(); });
  setInterval(() => { if (!drawerOpen) renderBoxes(); }, 60000); // flytta "nu"-markören i elpriset
  start().catch(e => toast('Kunde inte starta: ' + e.message));
  console.info('observatory house view', VERSION);
})();
