// Husvyn: foto av huset med live-rutor, flödeslinjer och klickbara ytor.
// Positioner anges i procent av fotot. Layouten kan redigeras och sparas på servern.
(() => {
  'use strict';
  const VERSION = '0.5.0';
  const $ = id => document.getElementById(id);
  const stage = $('stage'), boxesEl = $('boxes'), hot = $('hot'), wires = $('wires'), handles = $('handles');
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- Standardlayout (procent av fotot) ----------
  const DEFAULT = {
    boxes: {
      sol:     { x: 23,   y: 3,  anchor: [45, 37] },
      hus:     { x: 51,   y: 3,  anchor: [49, 50] },
      vv:      { x: 37,   y: 3,  anchor: [47, 50.3] },
      vader:   { x: 82.5, y: 3 },
      nat:     { x: 1.5,  y: 24, anchor: [36, 52] },
      vp:      { x: 65.5, y: 3,  anchor: [55.2, 34.4] }, // värmepumpen sitter på baksidan
      ladd:    { x: 84,   y: 64, anchor: [81.5, 51] },
      elpris:  { x: 1.5,  y: 70 },
      kostnad: { x: 52,   y: 65 },
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

  let cfg = {}, states = {}, connected = false;
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

  const HW = { waiting_cheap: 'Väntar på billig el', heating: 'Värmer', heating_cheap: 'Värmer på billig el', idle: 'Klar', done: 'Klar', boost: 'Boost', off: 'Av' };
  const WX = { 'clear-night': 'Klart', sunny: 'Soligt', partlycloudy: 'Halvklart', cloudy: 'Molnigt', rainy: 'Regn', pouring: 'Skyfall', snowy: 'Snö',
    'snowy-rainy': 'Snöblandat regn', fog: 'Dimma', windy: 'Blåsigt', 'windy-variant': 'Blåsigt', lightning: 'Åska', 'lightning-rainy': 'Åskregn', hail: 'Hagel', exceptional: 'Ovanligt' };

  // ---------- Rutornas innehåll ----------
  const BOX = {
    sol: { title: 'Solpaneler', drawer: 'solar', wire: 'sol', render() {
      const w = num(cfg.solar), today = num(cfg.pv_today);
      const rem = num(cfg.fc_remaining), tom = num(cfg.fc_tomorrow);
      const sub = rem != null && rem > 0.05 ? `${nf(today)} kWh idag · ${nf(rem)} kvar` : tom != null ? `${nf(today)} kWh idag · imorgon ~${nf(tom)}` : `${nf(today)} kWh idag`;
      return { v: kw(w), u: 'kW', s: sub,
        flow: w > 20 ? { cls: 'sol', dir: 'out', w } : null };
    } },
    hus: { title: 'Huset', drawer: 'house', render() {
      const load = num(cfg.load), ch = num(cfg.charger);
      const house = load != null && ch != null && ch <= load ? load - ch : load;
      return { v: kw(house), u: 'kW', s: 'Förbrukning utan laddbox', flow: house > 30 ? { cls: '', dir: 'in', w: house } : null };
    } },
    vv: { title: 'Varmvatten', drawer: 'hotwater', render() {
      const t = num(cfg.hot_water, 'temperature'), s = st(cfg.hot_water);
      const heating = s && /heat|boost/.test(s.state);
      return { v: nf(t), u: '°C', s: s ? (HW[s.state] || s.state) : 'okänt', flow: heating ? { cls: 'warm', dir: 'in', w: 2000 } : null };
    } },
    nat: { title: 'Elnät', drawer: 'grid', wire: 'grid', render() {
      const g = num(cfg.grid);
      const lbl = g == null ? 'okänt' : g > 30 ? 'Köper från nätet' : g < -30 ? 'Säljer till nätet' : 'I balans';
      return { v: kw(g), u: 'kW', s: lbl, title: g < -30 ? 'Export' : 'Import', flow: g != null && Math.abs(g) > 30 ? { cls: 'grid', dir: g > 0 ? 'in' : 'out', w: g } : null };
    } },
    vp: { title: 'Värmepump', drawer: 'heatpump', render() {
      const w = num(cfg.heatpump), inne = num(cfg.indoor);
      return { v: w == null ? '–' : Math.round(w).toLocaleString('sv-SE'), u: 'W', s: `Inne ${nf(inne)} °C`, flow: w > 50 ? { cls: 'warm', dir: 'in', w } : null };
    } },
    ladd: { title: 'Laddbox / EV6', drawer: 'garage', render() {
      const w = num(cfg.charger), soc = num(cfg.ev_soc);
      return { v: kw(w), u: 'kW', s: w > 50 ? 'Laddar' : 'Laddar inte', soc,
        flow: w > 50 ? { cls: '', dir: 'in', w } : null };
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
    elpris: { title: 'Elpris idag', cls: 'wide', drawer: 'price', render() {
      const p = num(cfg.price), s = st(cfg.price);
      const arr = s && Array.isArray(s.attributes.today) ? s.attributes.today.map(Number) : [];
      return { custom: `<div class="k">Idag / elpris</div>
        <div class="v">${nf(p, 2)}<small>kr/kWh nu</small></div>${priceSpark(arr)}` };
    } },
    kostnad: { title: 'Idag / pengar', cls: 'wide money-box', drawer: 'grid', render() {
      const page = kostnadPage === 1 ? energyPage() : moneyPage();
      return { custom: page + `<div class="pager"><button data-page="-1" aria-label="Föregående">‹</button><span>${kostnadPage + 1} av 2</span><button data-page="1" aria-label="Nästa">›</button></div>` };
    } },
  };

  // Sida 1: pengar idag (uppskattat) och vad solen sparat
  let kostnadPage = load('obs-kostnad-page') === '1' ? 1 : 0;
  let moneyData = null;
  async function loadMoney() {
    try { moneyData = await fetch('api/money', { cache: 'no-store' }).then(r => r.ok ? r.json() : null); } catch {}
    refresh();
  }
  const kr = (v, d = 2) => v == null ? '–' : nf(v, d);
  function moneyPage() {
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
    const y = moneyData && moneyData.year;
    const row = (k, v, cls = '') => `<div class="mrow ${cls}"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="k">Idag / uppskattat</div>
      <div class="money-grid">
        <div>
          <div class="ml">Elkostnad</div>
          <div class="v money">${kr(spent)}<small>kr</small></div>
          <div class="mrows">
            ${row('Köpt från nätet', `${nf(inn)} <small>kWh</small>`)}
            ${row('Elpris', `${kr(energy)} <small>kr</small>`)}
            ${row('Nätavgift', `${kr(transfer)} <small>kr</small>`)}
            ${row('Skatt och avgifter', `${kr(tax)} <small>kr</small>`)}
            ${fixed != null ? row('Fasta avgifter', `${kr(fixed)} <small>kr</small>`) : ''}
            ${row('Såld el', `${sold ? '−' + kr(sold) : kr(sold)} <small>kr</small>`, 'neg')}
          </div>
        </div>
        <div class="msave">
          <div class="ml">Sparat med sol</div>
          <div class="v saved">${kr(savedToday)}<small>kr</small></div>
          <div class="mnote">Egen solel du slapp köpa idag</div>
          <div class="ml year">Solen har gett i år</div>
          <div class="v2 saved">${y ? nf(y.total_kr, 0) : '–'}<small>kr</small></div>
          <div class="mnote">${y ? `${y.year} · använd ${nf(y.self_kr, 0)} + såld ${nf(y.sold_kr, 0)} kr` : 'Räknas från statistiken …'}</div>
        </div>
      </div>`;
  }
  // Sida 2: energi idag (den gamla rutan)
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
  boxesEl.addEventListener('click', e => {
    const b = e.target.closest('.pager button'); if (!b) return;
    e.stopPropagation(); e.preventDefault();
    kostnadPage = (kostnadPage + 2 + Number(b.dataset.page)) % 2; store('obs-kostnad-page', String(kostnadPage));
    renderBoxes(); drawWires();
  }, true);

  function priceSpark(arr) {
    if (!arr.length) return '<div class="s">Inga priser</div>';
    const W = 100, H = 40, n = arr.length, lo = Math.min(...arr), hi = Math.max(...arr);
    const x = i => i / (n - 1) * W, y = v => H - (hi === lo ? .5 : (v - lo) / (hi - lo)) * (H - 4) - 2;
    let d = ''; arr.forEach((v, i) => { d += `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`; });
    const now = new Date(), idx = (now.getHours() * 60 + now.getMinutes()) / 1440 * (n - 1);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path class="ar" d="${d}L${W},${H}L0,${H}Z"/><path class="ln" d="${d}"/>
      <line class="now" x1="${x(idx)}" x2="${x(idx)}" y1="0" y2="${H}"/></svg>
      <div class="lohi"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
      <div class="lohi"><span>Lägst ${nf(lo, 2)}</span><span class="hi">Högst ${nf(hi, 2)}</span></div>`;
  }

  // ---------- Rendera rutor ----------
  function buildBoxes() {
    boxesEl.innerHTML = '';
    for (const id of Object.keys(BOX)) {
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
  }
  function renderBoxes() {
    for (const el of boxesEl.children) {
      const def = BOX[el.dataset.id], r = def.render();
      el._flow = r.flow || null;
      if (r.custom) { el.innerHTML = r.custom; continue; }
      el.innerHTML = `<div class="k">${esc(r.title || def.title)}</div><div class="v">${r.v}<small>${r.u}</small></div><div class="s">${esc(r.s || '')}</div>` +
        (r.soc != null ? `<div class="soc"><span style="width:${Math.max(0, Math.min(100, r.soc))}%"></span></div><div class="s">EV6 ${Math.round(r.soc)} %</div>` : '');
    }
    drawWires();
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
      const ax = b.anchor[0] / 100 * sr.width, ay = b.anchor[1] / 100 * sr.height;
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
  }

  // ---------- Dag / natt ----------
  function applyLight() {
    const sun = st(cfg.sun);
    const night = lightMode === 'night' || (lightMode === 'auto' && sun && sun.state === 'below_horizon');
    stage.classList.toggle('night', !!night);
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === lightMode)));
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
        { title: 'Produktion mot prognos', unit: 'kW', div: 1000, series: [[cfg.solar, 'Produktion', '#d8bb72'], [cfg.pv_predicted, 'Prognos', '#9fb4c8', 'dash']], peak: true },
        { title: 'Sträng 1 mot sträng 2', unit: 'kW', div: 1000, series: [[cfg.solar_1, 'Sträng 1', '#e0895a'], [cfg.solar_2, 'Sträng 2', '#aebf91']] },
        [cfg.inverter_temp, 'Växelriktarens temperatur', '#c98f6a', 1, '°C'],
      ] },
    house: { eyebrow: 'Huset / förbrukning', title: 'Huset', stats: () => [
      ['Förbrukning', kw(num(cfg.load)), 'kW'], ['Idag', nf(num(cfg.load_today)), 'kWh'],
      ['Inne', nf(num(cfg.indoor)), '°C'], ['Varmvatten', nf(num(cfg.hot_water, 'temperature')), '°C']],
      charts: () => [[cfg.load, 'Förbrukning', '#aebf91', 1000, 'kW']] },
    grid: { eyebrow: 'Elnät / import & export', title: 'Elnät', stats: () => [
      ['Nät nu', kw(num(cfg.grid)), num(cfg.grid) < 0 ? 'kW ut' : 'kW in'], ['Elpris', nf(num(cfg.price), 2), 'kr/kWh'],
      ['Köpt idag', nf(num(cfg.grid_in_today)), 'kWh'], ['Sålt idag', nf(num(cfg.grid_out_today)), 'kWh'],
      ['Elkostnad idag', nf(num(cfg.cost_today), 2), 'kr']],
      charts: () => [[cfg.grid, 'Nät (+ köp / − sälj)', '#8fb7ba', 1000, 'kW']] },
    heatpump: { eyebrow: 'Klimat / värmepump', title: 'Värmepump', stats: () => [
      ['Effekt', num(cfg.heatpump) == null ? '–' : Math.round(num(cfg.heatpump)).toLocaleString('sv-SE'), 'W'],
      ['Inne', nf(num(cfg.indoor)), '°C'], ['Ute', nf(outdoorTemp()), '°C']],
      charts: () => [[cfg.heatpump, 'Effekt', '#e0895a', 1, 'W'], [cfg.indoor, 'Inomhustemperatur', '#aebf91', 1, '°C']] },
    garage: { eyebrow: 'Garage / laddning', title: 'Laddbox & EV6', stats: () => [
      ['Laddeffekt', kw(num(cfg.charger)), 'kW'], ['EV6', num(cfg.ev_soc) == null ? '–' : Math.round(num(cfg.ev_soc)), '%']],
      charts: () => [[cfg.charger, 'Laddeffekt', '#aebf91', 1000, 'kW'], [cfg.ev_soc, 'EV6 laddnivå', '#8fb7ba', 1, '%']] },
    hotwater: { eyebrow: 'Värme / varmvatten', title: 'Varmvattenberedare', stats: () => {
      const s = st(cfg.hot_water);
      return [['Temperatur', nf(num(cfg.hot_water, 'temperature')), '°C'], ['Mål', nf(num(cfg.hot_water, 'target_temperature'), 0), '°C'],
        ['Status', s ? (HW[s.state] || s.state) : '–', '']];
    }, charts: () => [] },
    veranda: { eyebrow: 'Uterummet', title: 'Uterummet', stats: () => [['Ute', nf(outdoorTemp()), '°C']], charts: () => [],
      note: 'Här finns inga sensorer kopplade ännu. Säg till vilka entiteter som hör till uterummet.' },
    price: { eyebrow: 'Elpris / idag', title: 'Elpris', stats: () => {
      const s = st(cfg.price); const arr = s && Array.isArray(s.attributes.today) ? s.attributes.today.map(Number) : [];
      return [['Nu', nf(num(cfg.price), 2), 'kr/kWh'], ['Snitt', arr.length ? nf(arr.reduce((a, b) => a + b, 0) / arr.length, 2) : '–', 'kr/kWh'],
        ['Lägst', arr.length ? nf(Math.min(...arr), 2) : '–', 'kr/kWh'], ['Högst', arr.length ? nf(Math.max(...arr), 2) : '–', 'kr/kWh']];
    }, charts: () => [], extra: () => {
      const s = st(cfg.price); const arr = s && Array.isArray(s.attributes.today) ? s.attributes.today.map(Number) : [];
      const start = new Date(); start.setHours(0, 0, 0, 0);
      return chartBlock('Elpris idag (kr/kWh)', arr.map((v, i) => [start.getTime() + i * 86400000 / arr.length, v]), '#e0895a', 1, 'kr', true).replace('<div class="dchart">', '<div class="dchart" id="price-chart">');
    } },
  };
  let drawerOpen = null;
  async function openDrawer(id) {
    const d = DRAWERS[id]; if (!d) return;
    drawerOpen = id;
    $('drawer-eyebrow').textContent = d.eyebrow; $('drawer-title').textContent = d.title;
    $('drawer').classList.toggle('wide', !!d.wide);
    renderDrawerStats();
    $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('scrim').hidden = false;
    const body = $('drawer-charts');
    const charts = d.charts().map(c => Array.isArray(c) ? { title: c[1], unit: c[4], div: c[3], series: [[c[0], c[1], c[2]]] } : c);
    body.innerHTML = (d.extra ? d.extra() : '') + charts.map((c, i) => `<div class="dchart" id="dc${i}"><div class="eyebrow">${esc(c.title)} · senaste 24 h</div><div class="empty">Hämtar historik …</div></div>`).join('') +
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
    if (d.rich) { $('drawer-stats').innerHTML = d.rich(); return; }
    $('drawer-stats').innerHTML = `<div class="dstats">${d.stats().map(([k, v, u]) => `<div class="dstat"><span>${esc(k)}</span><b>${v}<small>${esc(u)}</small></b></div>`).join('')}</div>`;
    if (d.extra && drawerOpen === 'price' && $('price-chart')) $('price-chart').outerHTML = d.extra();
  }
  function closeDrawer() {
    drawerOpen = null; $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); $('scrim').hidden = true;
  }
  $('drawer-close').addEventListener('click', closeDrawer);
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
    if (on) { saved = clone(layout); closeDrawer(); }
    buildHandles();
  }
  $('edit-btn').addEventListener('click', () => setEditing(!editing));
  $('edit-cancel').addEventListener('click', () => { layout = clone(saved); buildHot(); placeBoxes(); setEditing(false); drawWires(); });
  $('edit-reset').addEventListener('click', () => { layout = clone(DEFAULT); buildHot(); placeBoxes(); buildHandles(); drawWires(); toast('Standardlayouten är tillbaka. Tryck Spara för att behålla den.'); });
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
    ]);
    cfg = c;
    if (cfg.title) $('title').textContent = cfg.title;
    if (cfg.subtitle) $('subtitle').textContent = cfg.subtitle;
    // Sparad layout ovanpå standarden (nya rutor får standardläge)
    for (const [id, b] of Object.entries(l.boxes || {})) if (layout.boxes[id]) Object.assign(layout.boxes[id], b);
    for (const [id, h] of Object.entries(l.hotspots || {})) if (layout.hotspots[id] && h.points) layout.hotspots[id].points = h.points;
    buildBoxes(); buildHot(); refresh();
    loadMoney(); setInterval(loadMoney, 10 * 60 * 1000);

    const es = new EventSource('api/stream');
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; refresh(); });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; refresh(); });
    es.onerror = () => { connected = false; refresh(); };
  }
  new ResizeObserver(() => drawWires()).observe(stage);
  window.addEventListener('resize', drawWires);
  setInterval(() => { if (!drawerOpen) renderBoxes(); }, 60000); // flytta "nu"-markören i elpriset
  start().catch(e => toast('Kunde inte starta: ' + e.message));
  console.info('observatory house view', VERSION);
})();
