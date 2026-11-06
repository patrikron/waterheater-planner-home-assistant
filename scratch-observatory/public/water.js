// Varmvattensidan: allt som går att läsa om varmvattenberedaren i Home Assistant.
// Läser bara. Inga inställningar ändras härifrån.
(() => {
  'use strict';
  // Temafärg från CSS-variabel (temat sätts av theme.js)
  const TC = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const VERSION = '0.6.0';
  const $ = id => document.getElementById(id);
  let W = {}, S = {}, states = {}, connected = false;

  // ---------- Hjälpare ----------
  const st = id => (id && connected) ? states[id] : undefined;
  const bad = s => !s || ['unknown', 'unavailable', ''].includes(s.state);
  function num(id, attr) {
    const s = st(id); if (!s) return null;
    const v = parseFloat(attr ? s.attributes[attr] : s.state);
    return Number.isFinite(v) ? v : null;
  }
  const A = (k) => { const s = st(W.status); return s && s.attributes ? s.attributes[k] : undefined; };
  const nf = (v, d = 1) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const unit = id => { const s = st(id); return s && s.attributes.unit_of_measurement || ''; };
  const hm = t => t ? new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '–';
  function when(t) {
    if (!t) return '–';
    const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.floor((new Date(d).setHours(0, 0, 0, 0) - today) / 86400000);
    const day = diff === 0 ? 'idag' : diff === 1 ? 'imorgon' : diff === -1 ? 'igår' : d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
    return `${day} ${hm(t)}`;
  }
  const dur = min => { if (min == null) return '–'; const m = Math.round(min); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
  const onoff = id => { const s = st(id); return !s ? null : s.state === 'on'; };
  const chip = (on, yes = 'På', no = 'Av') => on == null ? '<span class="chip">–</span>' : `<span class="chip ${on ? 'on' : ''}">${on ? yes : no}</span>`;

  const STATUS = { disabled: 'Av (manuell styrning)', no_temperature: 'Temperatur saknas', switch_unavailable: 'Strömbrytaren svarar inte', at_target: 'Måltemperatur nådd',
    idle: 'Vilar', waiting_cheap: 'Väntar på billig tid', waiting_sun: 'Väntar på sol', heating_grid: 'Värmer (billig el)', heating_solar: 'Värmer (sol)',
    heating_sun_slot: 'Värmer (soltimme)', heating_base: 'Värmer (grundtemperatur)', comfort_floor: 'Värmer (komfortgräns)', boost: 'Värmer nu',
    no_prices: 'Elpris saknas', no_surplus_sensor: 'Elnätssensor saknas', floor_price_cap: 'Väntar (priset över komforttaket)', manual: 'Manuell värmning' };
  const PLAN = { satisfied: 'Inget behöver värmas just nu', ok: 'Planen är klar', insufficient: 'Hinner inte bli klar i tid', no_prices: 'Väntar på elpriser' };
  const HYBRID = { satisfied: 'Ingen värmning behövs', no_forecast: 'Ingen solprognos', last_call: 'Sista chansen före deadline', waiting_for_sun: 'Väntar på solen', not_worth_it: 'Solen räcker inte, nätet är billigare' };
  const MODE = { cheapest: 'Billigast', solar: 'Sol', hybrid: 'Hybrid' };
  const heatingNow = s => s && /^heating|^boost$|^comfort_floor$|^manual$/.test(s);

  // ---------- Hero ----------
  function tank(t, target, min) {
    const lo = 5, hi = Math.max(65, (target || 60) + 5);
    const f = t == null ? 0 : Math.max(0, Math.min(1, (t - lo) / (hi - lo)));
    const H = 150, top = 14, fillY = top + (1 - f) * H;
    const ty = v => top + (1 - (v - lo) / (hi - lo)) * H;
    const mark = (v, cls, lbl) => v == null ? '' : `<line class="${cls}" x1="10" x2="86" y1="${ty(v)}" y2="${ty(v)}"/><text class="tl" x="92" y="${ty(v) + 3}">${lbl}</text>`;
    return `<svg class="tank" viewBox="0 0 132 180" role="img" aria-label="Beredaren ${nf(t)} grader">
      <defs><linearGradient id="wg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5f8fa6"/><stop offset=".55" stop-color="${TC('gold')}"/><stop offset="1" stop-color="${TC('orange')}"/></linearGradient>
      <clipPath id="tc"><rect x="14" y="${top}" width="68" height="${H}" rx="22"/></clipPath></defs>
      <rect class="shell" x="14" y="${top}" width="68" height="${H}" rx="22"/>
      <rect clip-path="url(#tc)" x="14" y="${fillY}" width="68" height="${H + top - fillY}" fill="url(#wg)" opacity=".9"/>
      <rect class="shell2" x="14" y="${top}" width="68" height="${H}" rx="22"/>
      ${mark(target, 'tgt', 'mål')}${mark(min, 'flr', 'komfort')}
    </svg>`;
  }
  function renderHero() {
    const s = st(W.status), state = s ? s.state : null;
    const t = num(W.temperature) ?? A('temperature'), target = A('target_temperature'), min = A('min_temperature');
    const heating = onoff(W.switch) ?? A('heater_on'), power = num(W.power);
    const boost = A('boost'), auto = A('automatic');
    $('hero').innerHTML = `
      <div class="htank">${tank(t, target, min)}</div>
      <div class="hmain">
        <div class="eyebrow">Vattentemperatur</div>
        <div class="hbig">${nf(t)}<small>°C</small></div>
        <div class="hsub">Mål ${nf(target, 0)} °C · komfortgräns ${nf(min, 0)} °C</div>
        <div class="hstatus ${heatingNow(state) ? 'heat' : ''}"><i></i>${esc(state ? (STATUS[state] || state) : 'Okänd status')}</div>
        <div class="hchips">
          <span class="chip info">Läge: ${esc(MODE[A('mode')] || A('mode') || '–')}</span>
          ${auto == null ? '' : `<span class="chip ${auto ? 'on' : 'warn'}">Automatik ${auto ? 'på' : 'av'}</span>`}
          ${boost ? '<span class="chip heat">Värm nu är på</span>' : ''}
          ${A('energy_auto') ? '<span class="chip">Lär sig energibehovet</span>' : ''}
        </div>
      </div>
      <div class="hside">
        <div class="kv"><span>Elementet</span><b class="${heating ? 'heat' : ''}">${heating == null ? '–' : heating ? 'På' : 'Av'}</b></div>
        <div class="kv"><span>Effekt nu</span><b>${power == null ? '–' : nf(power / 1000, 2)}<small>kW</small></b></div>
        <div class="kv"><span>Elementets effekt</span><b>${nf((A('power_w') || 0) / 1000, 1)}<small>kW</small></b></div>
        <div class="kv"><span>Elpris nu</span><b>${nf(A('price_now') ?? num(W.price_now), 0)}<small>öre/kWh</small></b></div>
        <div class="kv"><span>Solöverskott</span><b class="${(num(W.surplus) ?? A('surplus_w')) > 0 ? 'sun' : ''}">${nf((num(W.surplus) ?? A('surplus_w') ?? 0) / 1000, 2)}<small>kW</small></b></div>
        <div class="kv"><span>Klart senast</span><b>${esc(A('ready_by') || '–')}</b></div>
      </div>`;
  }

  // ---------- Plan + elpris ----------
  function renderPlan() {
    const prices = (A('prices') || []).filter(p => Array.isArray(p) && Number.isFinite(+p[1]));
    const heated = A('heated') || [], periods = A('periods') || [], sunHours = A('solar_hours') || [];
    const status = A('plan_status'), hybrid = A('hybrid_state');
    const nextStart = st(W.next_start) && !bad(st(W.next_start)) ? Date.parse(st(W.next_start).state) : (periods[0] && periods[0].s);
    const facts = [
      ['Planstatus', esc(PLAN[status] || status || '–')],
      A('mode') === 'hybrid' && hybrid ? ['Hybrid', esc(HYBRID[hybrid] || hybrid)] : null,
      ['Nästa start', nextStart ? when(nextStart) : 'Ingen planerad'],
      ['Klart senast', A('deadline') ? when(A('deadline')) : '–'],
      ['Energi som behövs', `${nf(A('need_kwh') ?? num(W.need_kwh), 2)} kWh`],
      ['Från nätet / sol', `${nf(A('grid_kwh'), 2)} / ${nf(A('solar_kwh'), 2)} kWh`],
      ['Planerad värmetid', dur(A('runtime_min') ?? num(W.planned_time))],
      ['Planerad kostnad', `${nf(A('cost') ?? num(W.planned_cost), 2)} kr`],
      ['Om den värmde nu', `${nf(A('cost_now'), 2)} kr`],
      ['Sparar', `${nf(A('saving'), 2)} kr`],
    ].filter(Boolean);
    const list = periods.length ? periods.map(p => `<li><b>${when(p.s)}–${hm(p.e)}</b><span>${nf(p.kwh, 2)} kWh</span></li>`).join('')
      : '<li class="none">Inga värmeperioder planerade.</li>';
    $('plan').innerHTML = `<div class="wh"><div><div class="eyebrow">Plan / elpris</div><h3>Värmeplan</h3></div>
        ${A('waiting_for_prices') ? '<span class="chip warn">Väntar på morgondagens priser</span>' : ''}${A('price_error') ? `<span class="chip warn">${esc(A('price_error'))}</span>` : ''}</div>
      <div class="plangrid">
        <div class="facts">${facts.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
        <div class="pchart">${priceChart(prices, heated, periods, sunHours)}</div>
      </div>
      <div class="periods"><div class="eyebrow">Planerade perioder</div><ul>${list}</ul></div>`;
  }
  function priceChart(prices, heated, periods, sunHours) {
    if (!prices.length) return '<div class="empty">Inga elpriser.</div>';
    const Wd = 760, H = 230, pl = 40, pr = 8, pt = 12, pb = 24;
    const step = prices.length > 1 ? prices[1][0] - prices[0][0] : 900000;
    const t0 = prices[0][0], t1 = prices[prices.length - 1][0] + step;
    const vals = prices.map(p => +p[1]);
    let lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.08 || 1;
    const x = t => pl + (Math.max(t0, Math.min(t1, t)) - t0) / (t1 - t0) * (Wd - pl - pr);
    const y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4;
      g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`; }
    // dagsgränser och timetiketter
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t < t1; t += 3600e3) {
      const h = new Date(t).getHours();
      if (h === 0) g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${H - pb}"/><text class="ax day" x="${x(t) + 4}" y="${pt + 9}">${new Date(t).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric' })}</text>`;
      if (h % 3 === 0) g += `<text class="ax" x="${x(t)}" y="${H - 7}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`;
    }
    const band = (s, e, cls) => e <= t0 || s >= t1 ? '' : `<rect class="${cls}" x="${x(s)}" y="${pt}" width="${Math.max(1.5, x(e) - x(s))}" height="${H - pt - pb}"/>`;
    const bands = sunHours.map(h => band(h.s, h.e, 'b-sunh')).join('') + periods.map(p => band(p.s, p.e, 'b-plan')).join('') +
      heated.map(r => band(r[0], r[1], r[2] ? 'b-sol' : 'b-grid')).join('');
    let d = ''; prices.forEach(([t, v], i) => { d += `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}L${x(t + step).toFixed(1)},${y(v).toFixed(1)}`; });
    const now = Date.now();
    const nowL = now > t0 && now < t1 ? `<line class="now" x1="${x(now)}" x2="${x(now)}" y1="${pt}" y2="${H - pb}"/><text class="ax nowt" x="${x(now)}" y="${pt - 2}" text-anchor="middle">nu</text>` : '';
    return `<svg viewBox="0 0 ${Wd} ${H}" preserveAspectRatio="none" class="pc">${g}${bands}
      <path class="par" d="${d}L${x(t1)},${y(Math.max(lo, 0))}L${x(t0)},${y(Math.max(lo, 0))}Z"/><path class="pln" d="${d}"/>${nowL}</svg>
      <div class="legend"><span><i class="lp"></i>Elpris öre/kWh</span><span><i class="lplan"></i>Planerad värmning</span><span><i class="lgrid"></i>Värmt på nätet</span><span><i class="lsol"></i>Värmt med sol</span>${sunHours.length ? '<span><i class="lsunh"></i>Soltimmar</span>' : ''}</div>`;
  }

  // ---------- Senaste värmning, förbrukning, inlärning ----------
  function renderLast() {
    const s = A('last_heating_start'), e = A('last_heating_end'), running = A('last_heating_running');
    const kwh = A('last_heating_kwh'), sol = A('last_heating_solar_kwh') || 0;
    const solPct = kwh ? Math.min(100, sol / kwh * 100) : 0;
    $('last').innerHTML = `<div class="eyebrow">Senaste värmning</div><h3>${running ? 'Pågår nu' : s ? when(s) : 'Ingen ännu'}</h3>
      <div class="kvs">
        <div class="kv"><span>Tid</span><b>${s ? `${hm(s)}–${running ? 'nu' : hm(e)}` : '–'}</b></div>
        <div class="kv"><span>Längd</span><b>${s ? dur(((running ? Date.now() : e) - s) / 60000) : '–'}</b></div>
        <div class="kv"><span>Energi</span><b>${nf(kwh, 2)}<small>kWh</small></b></div>
        <div class="kv"><span>Kostnad</span><b>${nf(A('last_heating_cost'), 2)}<small>kr</small></b></div>
      </div>
      <div class="split"><span style="width:${solPct}%" class="sol"></span><span style="width:${100 - solPct}%" class="grid"></span></div>
      <div class="splitl"><span>Sol ${nf(sol, 2)} kWh</span><span>Nät ${nf(Math.max(0, (kwh || 0) - sol), 2)} kWh</span></div>`;
  }
  function renderUsage() {
    const u = A('usage') || {};
    const row = (lbl, k, kwhId, costId) => {
      const r = u[k] || {}; const kwh = r.kwh ?? num(kwhId), cost = r.cost ?? num(costId), sol = r.solar_kwh || 0;
      const p = kwh ? Math.min(100, sol / kwh * 100) : 0;
      return `<div class="urow"><span class="ul">${lbl}</span><b>${nf(kwh, 1)}<small>kWh</small></b><b>${nf(cost, 2)}<small>kr</small></b>
        <div class="ubar" title="Sol ${nf(sol, 1)} kWh"><span style="width:${p}%"></span></div><span class="up">${Math.round(p)} % sol</span></div>`;
    };
    const kwhD = (u.day || {}).kwh ?? num(W.kwh_today), costD = (u.day || {}).cost ?? num(W.cost_today);
    $('usage').innerHTML = `<div class="eyebrow">Förbrukning och kostnad</div><h3>${nf(costD, 2)} kr idag</h3>
      <div class="urows">${row('Idag', 'day', W.kwh_today, W.cost_today)}${row('Veckan', 'week', W.kwh_week, W.cost_week)}${row('Månaden', 'month', W.kwh_month, W.cost_month)}</div>
      <div class="kvs two">
        <div class="kv"><span>Snittpris idag</span><b>${kwhD ? nf(costD / kwhD * 100, 0) : '–'}<small>öre/kWh</small></b></div>
        <div class="kv"><span>Mätare totalt</span><b>${nf(num(W.energy_total), 0)}<small>kWh</small></b></div>
      </div>`;
  }
  function renderLearn() {
    const learned = A('energy_learned'), inUse = A('energy_in_use'), n = A('energy_samples');
    const manual = num(S.energy_adjust);
    $('learn').innerHTML = `<div class="eyebrow">Inlärning av energibehov</div><h3>${inUse == null ? '–' : `${inUse > 0 ? '+' : ''}${nf(inUse, 1)} %`}</h3>
      <p class="lead">${inUse == null ? '' : inUse < 0
        ? `Beredaren behöver ${nf(Math.abs(inUse), 0)} % mindre energi än den teoretiska beräkningen. Planen räknar med det.`
        : `Beredaren behöver ${nf(inUse, 0)} % mer energi än den teoretiska beräkningen. Planen räknar med det.`}</p>
      <div class="kvs">
        <div class="kv"><span>Inlärt</span><b>${learned == null ? '–' : nf(learned, 1)}<small>%</small></b></div>
        <div class="kv"><span>Används</span><b>${nf(inUse, 1)}<small>%</small></b></div>
        <div class="kv"><span>Antal värmningar</span><b>${n ?? '–'}</b></div>
        <div class="kv"><span>Manuell korrigering</span><b>${nf(manual, 0)}<small>%</small></b></div>
      </div>
      <div class="kv line"><span>Lär sig automatiskt</span>${chip(onoff(S.learn))}</div>`;
  }

  // ---------- Grafer ----------
  async function hist(id, hours) {
    const r = await fetch(`api/history?entity=${encodeURIComponent(id)}&hours=${hours}`, { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return (await r.json()).points.map(([t, v]) => [typeof t === 'string' ? Date.parse(t) : t, v]);
  }
  function lineChart(pts, color, opt = {}) {
    if (!pts || !pts.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 440, H = 170, pl = 34, pr = 6, pt = 8, pb = 20, div = opt.div || 1;
    const p = pts.map(([t, v]) => [t, v / div]);
    const t0 = p[0][0], t1 = Math.max(p[p.length - 1][0], Date.now());
    let lo = Math.min(...p.map(q => q[1]), ...(opt.marks || []).map(m => m[0])), hi = Math.max(...p.map(q => q[1]), ...(opt.marks || []).map(m => m[0]));
    if (opt.zero) lo = Math.min(0, lo);
    if (hi === lo) hi = lo + 1; const pad = (hi - lo) * .08; if (!opt.zero) lo -= pad; hi += pad;
    const x = t => pl + (t - t0) / (t1 - t0 || 1) * (Wd - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4;
      g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, hi - lo < 5 ? 1 : 0)}</text>`; }
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t <= t1; t += 3600e3) { const h = new Date(t).getHours();
      if (h === 0) g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${H - pb}"/>`;
      if (h % 6) continue; g += `<text class="ax" x="${x(t)}" y="${H - 5}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`; }
    for (const [v, lbl] of opt.marks || []) g += `<line class="mk" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax mkt" x="${Wd - pr - 2}" y="${y(v) - 3}" text-anchor="end">${lbl}</text>`;
    let d = ''; p.forEach(([t, v], i) => { if (opt.step && i) d += `L${x(t).toFixed(1)},${y(p[i - 1][1]).toFixed(1)}`; d += `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`; });
    const base = y(Math.max(lo, 0));
    return `<svg viewBox="0 0 ${Wd} ${H}" preserveAspectRatio="none">${g}<path class="ar" fill="${color}" d="${d}L${x(p[p.length - 1][0])},${base}L${x(t0)},${base}Z"/><path class="ln" stroke="${color}" d="${d}"/></svg>`;
  }
  function barChart(pts, color) {
    if (!pts || !pts.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 440, H = 170, pl = 30, pr = 6, pt = 14, pb = 20;
    const hi = Math.max(...pts.map(p => p[1] || 0)) * 1.12 || 1, n = pts.length, bw = (Wd - pl - pr) / n;
    const y = v => pt + (hi - v) / hi * (H - pt - pb);
    let g = '';
    for (let i = 0; i <= 3; i++) { const v = hi * i / 3; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`; }
    const avg = pts.reduce((a, p) => a + (p[1] || 0), 0) / n;
    pts.forEach(([t, v], i) => {
      const xx = pl + i * bw + bw * .15, w = bw * .7, last = i === n - 1;
      g += `<rect class="bar${last ? ' cur' : ''}" fill="${color}" x="${xx}" y="${y(v || 0)}" width="${w}" height="${Math.max(0, y(0) - y(v || 0))}"><title>${new Date(t).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}: ${nf(v, 1)} kWh</title></rect>`;
      if (n <= 16 || i % 2 === 0) g += `<text class="ax" x="${xx + w / 2}" y="${H - 6}" text-anchor="middle">${new Date(t).getDate()}</text>`;
    });
    g += `<line class="mk" x1="${pl}" x2="${Wd - pr}" y1="${y(avg)}" y2="${y(avg)}"/><text class="ax mkt" x="${Wd - pr - 2}" y="${y(avg) - 3}" text-anchor="end">snitt ${nf(avg, 1)}</text>`;
    return `<svg viewBox="0 0 ${Wd} ${H}" preserveAspectRatio="none">${g}</svg>`;
  }
  async function loadCharts() {
    const box = (id, title, unitTxt, body) => { $(id).innerHTML = `<div class="eyebrow">${title} <span style="float:right">${unitTxt}</span></div><div class="dchart flat">${body}</div>`; };
    box('temp-chart', 'Vattentemperatur · 48 h', '°C', '<div class="empty">Hämtar …</div>');
    box('power-chart', 'Effekt · 48 h', 'kW', '<div class="empty">Hämtar …</div>');
    box('daily-chart', 'Energi per dag · 14 dagar', 'kWh', '<div class="empty">Hämtar …</div>');
    const fail = (id, e) => { const el = $(id).querySelector('.dchart'); if (el) el.innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; };
    hist(W.temperature, 48).then(p => { $('temp-chart').querySelector('.dchart').innerHTML = lineChart(p, TC('orange'), { marks: [[A('target_temperature') ?? 60, 'mål'], ...(A('min_temperature') != null ? [[A('min_temperature'), 'komfort']] : [])] }); }).catch(e => fail('temp-chart', e));
    hist(W.power, 48).then(p => { $('power-chart').querySelector('.dchart').innerHTML = lineChart(p, TC('gold'), { div: 1000, zero: true, step: true }); }).catch(e => fail('power-chart', e));
    fetch(`api/daily?entity=${encodeURIComponent(W.energy_total)}&days=14`, { cache: 'no-store' }).then(async r => { if (!r.ok) throw new Error((await r.json()).error || r.statusText); return r.json(); })
      .then(d => { $('daily-chart').querySelector('.dchart').innerHTML = barChart(d.points.map(([t, v]) => [typeof t === 'string' ? Date.parse(t) : t, v]), TC('sage')); }).catch(e => fail('daily-chart', e));
  }

  // ---------- Inställningar ----------
  const SETTINGS = [
    ['Grundinställningar', [
      ['Läge', 'mode', s => MODE[s.state] || s.state], ['Automatik', 'automatic'], ['Värm nu', 'boost'],
      ['Måltemperatur', 'target'], ['Komfortgräns', 'comfort'], ['Färdigt senast', 'ready_by'],
    ]],
    ['Smart planering', [
      ['Max antal värmeperioder', 'max_periods'], ['Vänta på billigare timme om det sparar', 'wait_saving'],
      ['Max elpris för komfortgräns', 'floor_max_price'], ['Energikorrigering', 'energy_adjust'], ['Lär energibehovet', 'learn'],
    ]],
    ['Sol-läge', [
      ['Grundtemperatur', 'base_temp'], ['Grundtemperatur klar senast', 'base_by'], ['Värm på nätet först under', 'regrid_below'],
      ['Elprisgräns', 'solar_price_cap'], ['Överskott för start', 'solar_start'], ['Husets grundlast', 'house_baseline'],
      ['Tidig start: överskott för att starta', 'early_start'], ['Tidig start: överskott för att fortsätta', 'early_keep'],
      ['Värm i soltimmar bara när överskottet räcker', 'sun_surplus_only'], ['Sol prissätts som utebliven försäljning', 'sun_priced'],
      ['Sälj överskott utanför valda soltimmar', 'sell_other_sun'],
    ]],
  ];
  function settingVal(id, fmt) {
    const s = st(id); if (!s) return '–';
    if (fmt) return esc(fmt(s));
    if (/^(switch|input_boolean)\./.test(id)) return chip(s.state === 'on');
    if (/^time\./.test(id)) return esc(s.state.slice(0, 5));
    if (bad(s)) return '–';
    const v = parseFloat(s.state); const u = s.attributes.unit_of_measurement || '';
    return Number.isFinite(v) ? `${nf(v, v % 1 ? 1 : 0)}${u ? `<small>${esc(u)}</small>` : ''}` : esc(s.state);
  }
  function renderSettings() {
    $('settings').innerHTML = `<div class="wh"><div><div class="eyebrow">Inställningar</div><h3>Hur planeraren är inställd</h3></div><span class="chip">Visas bara, ändras i Home Assistant</span></div>
      <div class="sgroups">${SETTINGS.map(([g, rows]) => `<div class="sgroup"><div class="eyebrow">${g}</div>${rows.map(([lbl, k, fmt]) =>
        `<div class="srow"><span>${esc(lbl)}</span><b>${settingVal(S[k], fmt)}</b></div>`).join('')}</div>`).join('')}</div>`;
  }

  // ---------- Hårdvara ----------
  function renderHardware() {
    const v = (id, d = 1) => { const s = st(id); if (bad(s)) return '–'; const n = parseFloat(s.state); return Number.isFinite(n) ? `${nf(n, d)}<small>${esc(unit(id))}</small>` : esc(s.state); };
    const bin = (id, yes, no, warnOn) => { const s = st(id); if (bad(s)) return '<span class="chip">okänt</span>'; const on = s.state === 'on'; return `<span class="chip ${on ? (warnOn ? 'alarm' : 'on') : ''}">${on ? yes : no}</span>`; };
    const autos = Object.entries(W.automations || {});
    const timer = st(W.timer);
    $('hardware').innerHTML = `<div class="eyebrow">Hårdvara och givare</div><h3>Status</h3>
      <div class="hgroup"><div class="hg">Shelly EM3 (styr elementet)</div>
        <div class="srow"><span>Brytare</span><b>${bin(W.switch, 'På', 'Av')}</b></div>
        <div class="srow"><span>Spänning</span><b>${v(W.shelly_voltage, 1)}</b></div>
        <div class="srow"><span>Ström</span><b>${v(W.shelly_current, 2)}</b></div>
        <div class="srow"><span>Effektfaktor</span><b>${v(W.shelly_pf, 2)}</b></div>
        <div class="srow"><span>Wifi-signal</span><b>${v(W.shelly_rssi, 0)}</b></div>
        <div class="srow"><span>Överlast</span><b>${bin(W.shelly_overpower, 'Ja', 'Nej', true)}</b></div></div>
      <div class="hgroup"><div class="hg">Temperaturgivare (MQTT)</div>
        <div class="srow"><span>Givaren svarar</span><b>${bin(W.mqtt_active, 'Ja', 'Nej')}</b></div>
        <div class="srow"><span>Över maxtemperatur</span><b>${bin(W.over_max, 'Ja', 'Nej', true)}</b></div></div>
      <div class="hgroup"><div class="hg">Läcksensor under beredaren</div>
        <div class="srow"><span>Läcka</span><b>${bin(W.leak, 'LÄCKA', 'Torrt', true)}</b></div>
        <div class="srow"><span>Batteri</span><b>${v(W.leak_battery, 0)}</b></div>
        <div class="srow"><span>Temperatur vid golvet</span><b>${v(W.leak_temperature, 0)}</b></div>
        <div class="srow"><span>Zigbee-länk</span><b>${v(W.leak_link, 0)}</b></div></div>
      <div class="hgroup"><div class="hg">Automationer</div>
        ${autos.map(([lbl, id]) => `<div class="srow"><span>${esc(lbl)}</span><b>${bin(id, 'På', 'Av')}</b></div>`).join('')}
        ${timer ? `<div class="srow"><span>Timer</span><b><span class="chip ${timer.state === 'active' ? 'on' : ''}">${timer.state === 'active' ? 'Igång' : timer.state === 'paused' ? 'Pausad' : 'Vilar'}</span></b></div>` : ''}</div>`;
  }

  // ---------- Rendering ----------
  let queued = false;
  function refresh() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const live = connected && !bad(states[W.status]);
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      for (const f of [renderHero, renderPlan, renderLast, renderUsage, renderLearn, renderSettings, renderHardware]) {
        try { f(); } catch (e) { console.error(f.name, e); }
      }
    });
  }
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();

  async function start() {
    W = await fetch('api/water', { cache: 'no-store' }).then(r => r.json());
    S = W.settings || {};
    if (W.title) $('title').textContent = W.title;
    if (W.subtitle) $('subtitle').textContent = W.subtitle;
    const es = new EventSource('api/stream');
    let chartsLoaded = false;
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; refresh();
      if (!chartsLoaded) { chartsLoaded = true; loadCharts(); } });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; refresh(); });
    es.onerror = () => { connected = false; refresh(); };
    setInterval(loadCharts, 5 * 60 * 1000);
    setInterval(refresh, 60000); // flytta nu-markören
  }
  start().catch(e => { $('subtitle').textContent = 'Kunde inte starta: ' + e.message; });
  console.info('observatory water view', VERSION);
})();
