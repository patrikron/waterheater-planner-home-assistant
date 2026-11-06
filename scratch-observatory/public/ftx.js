// FTX-sidan: temperaturer, återvinning, fläktar, rum, smart styrning, energi och styrning.
// Styrningen går via servern, som bara släpper igenom vitlistade brytare och börvärdet.
(() => {
  'use strict';
  // Temafärg från CSS-variabel (temat sätts av theme.js)
  const TC = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const VERSION = '0.9.0';
  const $ = id => document.getElementById(id);
  let F = {}, states = {}, connected = false;

  // ---------- Hjälpare ----------
  const st = id => (id && connected) ? states[id] : undefined;
  const bad = s => !s || ['unknown', 'unavailable', ''].includes(s.state);
  function num(id, attr) {
    const s = st(id); if (!s) return null;
    const v = parseFloat(attr ? s.attributes[attr] : s.state);
    return Number.isFinite(v) ? v : null;
  }
  const on = id => { const s = st(id); return bad(s) ? null : s.state === 'on'; };
  const nf = (v, d = 1) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hm = t => t ? new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '–';
  function ago(t) {
    if (!t) return '–';
    const m = Math.round((Date.now() - Date.parse(t)) / 60000);
    if (m < 1) return 'nyss'; if (m < 60) return `${m} min sedan`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h sedan`;
    const d = Math.round(h / 24); return d < 60 ? `${d} d sedan` : new Date(t).toLocaleDateString('sv-SE');
  }
  const kv = (k, v, u = '', cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}${u ? `<small>${u}</small>` : ''}</b></div>`;
  const bar = (pct, cls = '') => `<div class="so-bar ${cls}"><span style="width:${Math.max(0, Math.min(100, pct || 0))}%"></span></div>`;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
  const tsOf = t => typeof t === 'string' ? Date.parse(t) : t;
  // Egen beräkning av temperaturverkningsgraden: (tilluft − ute) / (frånluft − ute)
  function calcEff(side) {
    const o = num(F.outdoor), s = num(F.supply), e = num(F.extract), x = num(F.exhaust);
    if (o == null || e == null || e - o < 3) return null;
    const v = side === 'exhaust' ? (x == null ? null : (e - x) / (e - o)) : (s == null ? null : (s - o) / (e - o));
    return v == null ? null : Math.max(0, Math.min(100, v * 100));
  }

  // ---------- Styrning ----------
  const pending = {};
  async function send(action, value, entity) {
    if (!F.controls) return;
    pending[action + entity] = { value, until: Date.now() + 20000 };
    render();
    try {
      const r = await fetch('api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, value, entity }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
    } catch (e) { delete pending[action + entity]; render(); toast('Gick inte: ' + e.message); }
  }
  const pend = (action, entity) => { const p = pending[action + entity]; return p && Date.now() < p.until ? p : null; };
  function clearPending() {
    for (const [k, p] of Object.entries(pending)) {
      if (Date.now() > p.until) { delete pending[k]; continue; }
      if (k.startsWith('toggle') && on(k.slice(6)) === p.value) delete pending[k];
      if (k.startsWith('number') && num(k.slice(6)) === p.value) delete pending[k];
    }
  }
  let draft = null, draftTimer;
  function bump(dir) {
    const s = st(F.setpoint); if (!s) return;
    const lo = +s.attributes.min, hi = +s.attributes.max, step = +s.attributes.step || 1;
    const base = draft ?? (pend('number', F.setpoint) ? pend('number', F.setpoint).value : num(F.setpoint));
    if (base == null) return;
    draft = Math.max(lo, Math.min(hi, Math.round((base + dir * step) / step) * step));
    render();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { const v = draft; draft = null; send('number', v, F.setpoint); }, 1200);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'sp') return bump(+b.dataset.dir);
    if (act === 'toggle') {
      const v = b.getAttribute('aria-pressed') !== 'true';
      if (b.dataset.ent === F.unit && !v && !confirm('Stänga av FTX-aggregatet? Då står ventilationen still.')) return;
      return send('toggle', v, b.dataset.ent);
    }
  });

  // ---------- Hero: flödesbild ----------
  function unitSvg() {
    const o = num(F.outdoor), s = num(F.supply), e = num(F.extract), x = num(F.exhaust), w = num(F.wheel);
    const run = on(F.running) ?? on(F.unit), rec = num(F.recovery);
    const spin = run && rec > 0 ? Math.max(1.2, 6 - rec / 25) : 0;
    const t = v => v == null ? '–' : nf(v) + '°';
    return `<svg viewBox="0 0 300 170" class="ftxsvg" role="img" aria-label="Luftflöden genom FTX-aggregatet">
      <defs><marker id="ah" viewBox="0 0 8 8" refX="4" refY="4" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13" orient="auto"><path d="M0,0 L8,4 L0,8z" fill="context-stroke"/></marker></defs>
      <rect x="95" y="22" width="110" height="126" rx="6" class="cab"/>
      <path d="M8,52 H128" class="duct cold" marker-end="url(#ah)"/><path d="M172,52 H286" class="duct warm" marker-end="url(#ah)"/>
      <path d="M292,118 H172" class="duct warm2" marker-end="url(#ah)"/><path d="M128,118 H14" class="duct out" marker-end="url(#ah)"/>
      ${run ? `<path d="M8,52 H138" class="flow cold"/><path d="M162,52 H292" class="flow warm"/><path d="M292,118 H162" class="flow warm2"/><path d="M138,118 H8" class="flow out"/>` : ''}
      <g class="wheel" style="transform-origin:150px 85px;${spin ? `animation:spin ${spin.toFixed(1)}s linear infinite` : ''}">
        <circle cx="150" cy="85" r="30"/>${[0, 30, 60, 90, 120, 150].map(a => `<line x1="${150 + 30 * Math.cos(a * Math.PI / 180)}" y1="${85 + 30 * Math.sin(a * Math.PI / 180)}" x2="${150 - 30 * Math.cos(a * Math.PI / 180)}" y2="${85 - 30 * Math.sin(a * Math.PI / 180)}"/>`).join('')}
      </g>
      <circle cx="150" cy="85" r="5" class="hub"/>
      <text x="150" y="140" text-anchor="middle" class="wl">hjul ${t(w)}</text>
      <text x="10" y="40" class="lb">UTELUFT</text><text x="10" y="76" class="tv cold">${t(o)}</text>
      <text x="290" y="40" text-anchor="end" class="lb">TILLUFT</text><text x="290" y="76" text-anchor="end" class="tv warm">${t(s)}</text>
      <text x="290" y="104" text-anchor="end" class="lb">FRÅNLUFT</text><text x="290" y="140" text-anchor="end" class="tv warm2">${t(e)}</text>
      <text x="10" y="104" class="lb">AVLUFT</text><text x="10" y="140" class="tv out">${t(x)}</text>
    </svg>`;
  }
  function renderHero() {
    const eff = num(F.efficiency), mine = calcEff(), mineX = calcEff('exhaust'), rec = num(F.recovery), reheat = num(F.reheat);
    const unitOn = on(F.unit), boost = on(F.boost), away = on(F.away), press = on(F.pressure);
    const state = st(F.state);
    const label = unitOn === false ? 'Avstängd' : boost ? 'Forcering' : away ? 'Bortaläge' : unitOn ? 'Normal drift' : 'Okänt';
    const lvl = num(F.fan_level), w = num(F.power);
    $('hero').innerHTML = `
      <div class="ftxw">${unitSvg()}</div>
      <div class="hmain">
        <div class="eyebrow">Temperaturverkningsgrad</div>
        <div class="hbig">${nf(eff, 0)}<small>%</small></div>
        <div class="hsub">Enligt aggregatet. Räknat på tilluften ${mine == null ? '–' : nf(mine, 0)} %, på avluften ${mineX == null ? '–' : nf(mineX, 0)} % · värmeåtervinning ${nf(rec, 0)} % · eftervärme ${nf(reheat, 0)} %</div>
        <div class="hstatus ${unitOn ? 'heat ftxs' : ''} ${boost ? 'boost' : ''} ${away ? 'away' : ''}"><i></i>${label}${state && !bad(state) && state.state !== 'På' ? ` · ${esc(state.state)}` : ''}</div>
        <div class="hchips">
          ${lvl != null ? `<span class="chip on">Fläktnivå ${nf(lvl, 0)}</span>` : ''}
          ${press ? '<span class="chip info">Tryckkompensering</span>' : ''}
          ${num(F.filter_days) != null ? `<span class="chip">Filtertimer ${nf(num(F.filter_days), 0)} d</span>` : ''}
        </div>
      </div>
      <div class="hside">
        ${kv('Tilluft', nf(num(F.supply)), '°C', 'heat')}
        ${kv('Börvärde', nf(num(F.setpoint), 0), '°C')}
        ${kv('Frånluft', nf(num(F.extract)), '°C')}
        ${kv('Ute', nf(num(F.outdoor)), '°C')}
        ${kv('Effekt', w == null ? '–' : Math.round(w), 'W')}
        ${kv('Idag', nf(num(F.energy_today), 2), 'kWh')}
      </div>`;
  }

  // ---------- Styrning ----------
  function tgl(id, lbl, hint) {
    const p = pend('toggle', id), v = p ? p.value : on(id);
    return `<div class="ftg"><div><b>${lbl}</b><span>${hint}</span></div>
      <button class="tgl ${v ? 'on' : ''} ${p ? 'pending' : ''}" data-act="toggle" data-ent="${id}" aria-pressed="${!!v}" ${F.controls && st(id) ? '' : 'disabled'}><i></i>${v ? 'På' : 'Av'}</button></div>`;
  }
  function renderControl() {
    const s = st(F.setpoint), p = pend('number', F.setpoint);
    const sp = draft ?? (p ? p.value : num(F.setpoint));
    const unitP = pend('toggle', F.unit), unitOn = unitP ? unitP.value : on(F.unit);
    $('control').innerHTML = `<div class="wh"><div><div class="eyebrow">Styrning</div><h3>${unitOn ? 'Aggregatet är på' : unitOn === false ? 'Aggregatet är avstängt' : 'Okänt läge'}</h3></div>
        ${F.controls ? '' : '<span class="chip">Styrning avstängd i config</span>'}</div>
      <div class="ftx-ctl">
        <button class="pwr ${unitOn ? 'on' : ''} ${unitP ? 'pending' : ''}" data-act="toggle" data-ent="${F.unit}" aria-pressed="${!!unitOn}" ${F.controls ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M7 6.3a8 8 0 1 0 10 0"/></svg><span>${unitOn ? 'På' : 'Av'}</span></button>
        <div class="ctl-temp ${s ? '' : 'dim'}">
          <div class="eyebrow" style="text-align:center">Tilluft börvärde</div>
          <div class="tempbox">
            <button data-act="sp" data-dir="-1" ${F.controls && s ? '' : 'disabled'} aria-label="Sänk">−</button>
            <div class="tval ${p || draft != null ? 'pending' : ''}">${nf(sp, 0)}<small>°C</small></div>
            <button data-act="sp" data-dir="1" ${F.controls && s ? '' : 'disabled'} aria-label="Höj">+</button>
          </div>
          <div class="hint">${s ? `${nf(+s.attributes.min, 0)}–${nf(+s.attributes.max, 0)} °C · aggregatet rapporterar ${nf(num(F.setpoint_unit), 0)} °C` : ''}</div>
        </div>
        <div class="ftgs">
          ${tgl(F.boost, 'Forcering', 'Högre flöde, slås på av fukt i badrummet eller hög CO₂ i sovrummet')}
          ${tgl(F.away, 'Bortaläge', 'Lägre flöde när ingen är hemma')}
          ${tgl(F.pressure, 'Tryckkompensering', 'Mer tilluft än frånluft, t.ex. när kaminen eldas')}
        </div>
      </div>`;
  }

  // ---------- Fläktar ----------
  function renderFans() {
    const fan = (lbl, rpm, pct, lvl, cls) => `<div class="so-str">
      <div class="so-strh"><span>${lbl}</span><b>${nf(num(rpm), 0)}<small>rpm</small></b></div>
      ${bar(num(pct), cls)}
      <div class="so-strv"><span>${nf(num(pct), 0)} % effekt</span><span>nivå ${nf(num(lvl), 0)}</span></div></div>`;
    const a = num(F.supply_rpm), b = num(F.extract_rpm);
    const bal = a && b ? (a - b) / b * 100 : null;
    $('fans').innerHTML = `<div class="eyebrow">Fläktar</div><h3>Nivå ${nf(num(F.fan_level), 0)}${num(F.user_fan_level) != null && num(F.user_fan_level) !== num(F.fan_level) ? ` <small class="mut">(vald ${nf(num(F.user_fan_level), 0)})</small>` : ''}</h3>
      ${fan('Tilluftsfläkt', F.supply_rpm, F.supply_pct, F.supply_fan_level, 'orange')}
      ${fan('Frånluftsfläkt', F.extract_rpm, F.extract_pct, F.extract_fan_level, 'sage')}
      <p class="so-note">${bal == null ? '' : Math.abs(bal) < 10 ? `Fläktarna är i balans (${bal > 0 ? '+' : ''}${nf(bal, 0)} % varvtal på tilluften).` : bal > 0 ? `Tilluften går ${nf(bal, 0)} % fortare än frånluften (lite övertryck).` : `Frånluften går ${nf(-bal, 0)} % fortare än tilluften (lite undertryck).`}</p>`;
  }

  // ---------- Rum ----------
  function renderRooms() {
    const rows = (F.rooms || []).map(r => `<div class="srow"><span>${esc(r.name)}</span><b>${nf(num(r.temp))}<small>°C</small>${r.humidity && num(r.humidity) != null ? ` <em class="hum">${nf(num(r.humidity), 0)} %</em>` : ''}</b></div>`).join('');
    $('rooms').innerHTML = `<div class="eyebrow">Ventilationsrör och tilluftsdon</div><h3>Temperatur i kanalerna</h3>${rows || '<div class="empty">Inga rum i config.</div>'}
      <p class="so-note">Givare i ventilationsrören och vid tilluftsdonen. Luftfuktighet visas där givaren har det.</p>`;
  }

  // ---------- Smart styrning ----------
  function gauge(lbl, v, limit, unit, d = 0) {
    const pct = v == null ? 0 : v / (limit * 1.25) * 100, over = v != null && v > limit;
    return `<div class="ftgauge"><div class="so-pb"><span>${lbl}</span><b class="${over ? 'warnc' : ''}">${nf(v, d)}<small> ${unit}</small></b></div>
      <div class="so-bar ${over ? 'orange' : 'sage'} lim"><span style="width:${Math.min(100, pct)}%"></span><i style="left:${100 / 1.25}%"></i></div>
      <div class="lim-l">forcering över ${nf(limit, 0)} ${unit}</div></div>`;
  }
  function renderSmart() {
    const autos = (F.automations || []).map(id => {
      const s = st(id); if (!s) return '';
      const name = (s.attributes.friendly_name || id).replace(/^FTX - /, '');
      return `<div class="srow"><span class="${s.state === 'on' ? '' : 'off'}">${esc(name)}</span><b>${s.state === 'on' ? ago(s.attributes.last_triggered) : 'avstängd'}</b></div>`;
    }).join('');
    $('smart').innerHTML = `<div class="eyebrow">Smart styrning</div><h3>${on(F.boost) ? 'Forcering är på' : 'Ingen forcering nu'}</h3>
      ${gauge('CO₂ sovrum', num(F.co2_bedroom), F.boost_co2 || 1500, 'ppm')}
      ${gauge('Luftfuktighet badrum', num(F.bath_humidity), F.boost_humidity || 73, '%')}
      <div class="hg" style="margin-top:14px">Automationer · senast körd</div>${autos}`;
  }

  // ---------- Energi ----------
  let daily = [];
  function renderEnergy() {
    const w = num(F.power), today = num(F.energy_today);
    const avg = daily.length ? daily.reduce((a, p) => a + (p[1] || 0), 0) / daily.length : null;
    const max = Math.max(0.01, ...daily.map(p => p[1] || 0));
    $('energy').innerHTML = `<div class="eyebrow">Energi</div><h3>${w == null ? '–' : Math.round(w)} W just nu</h3>
      <div class="kvs">${kv('Idag', nf(today, 2), 'kWh')}${kv('Veckan', nf(num(F.energy_week), 1), 'kWh')}${kv('Månaden', nf(num(F.energy_month), 1), 'kWh')}${kv('Totalt', nf(num(F.energy_total), 0), 'kWh')}</div>
      ${daily.length ? `<div class="mini-bars" title="kWh per dag, 14 dagar">${daily.map(([t, v]) => `<span style="height:${Math.max(3, (v || 0) / max * 100)}%" title="${new Date(t).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}: ${nf(v, 2)} kWh"></span>`).join('')}</div>
      <p class="so-note">14 dagar, snitt ${nf(avg, 2)} kWh per dag. Ungefär ${nf(avg * 365, 0)} kWh om året.</p>` : ''}`;
  }

  // ---------- Aggregatet ----------
  function renderUnit() {
    const fd = num(F.filter_days), wt = st(F.week_timer);
    $('unit').innerHTML = `<div class="eyebrow">Aggregatet</div><h3>${esc(F.model || 'FTX')}</h3>
      <div class="srow"><span>Filtertimer</span><b>${fd == null ? '–' : nf(fd, 0)}<small>dagar</small></b></div>
      <div class="srow"><span>Veckotimer</span><b>${wt && !bad(wt) ? (wt.state === '0' ? 'Av' : esc(wt.state)) : '–'}</b></div>
      <div class="srow"><span>Eftervärme</span><b>${nf(num(F.reheat), 0)}<small>%</small></b></div>
      <div class="srow"><span>Värmeåtervinning</span><b>${nf(num(F.recovery), 0)}<small>%</small></b></div>
      <div class="srow"><span>Hjulets temperatur</span><b>${nf(num(F.wheel))}<small>°C</small></b></div>
      <div class="srow"><span>Uppkoppling</span><b>Modbus TCP</b></div>
      <p class="so-note">Filtertimern nollställs i aggregatet eller med knappen i Home Assistant efter filterbyte.</p>`;
  }

  // ---------- Grafer ----------
  async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); }
  const histPts = async (id, h) => (await getJSON(`api/history?entity=${encodeURIComponent(id)}&hours=${h}`)).points.map(([t, v]) => [tsOf(t), v]);
  function multiLine(series, opt = {}) {
    const all = series.flatMap(s => s.points);
    if (!all.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 760, Hh = opt.h || 240, pl = 36, pr = 8, pt = 10, pb = 22;
    const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(Date.now(), ...all.map(p => p[0]));
    let lo = opt.min ?? Math.floor(Math.min(...all.map(p => p[1])) - 1), hi = opt.max ?? Math.ceil(Math.max(...all.map(p => p[1])) + 1);
    if (hi <= lo) hi = lo + 1;
    const x = t => pl + (t - t0) / (t1 - t0 || 1) * (Wd - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`; }
    const span = (t1 - t0) / 3600e3, every = span > 30 ? 6 : 3;
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t <= t1; t += 3600e3) { const h = new Date(t).getHours();
      if (h === 0) g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${Hh - pb}"/>`;
      if (h % every) continue; g += `<text class="ax" x="${x(t)}" y="${Hh - 6}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`; }
    const paths = series.map(s => { if (!s.points.length) return '';
      const d = s.points.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
      return `<path class="ln${s.dash ? ' dash' : ''}" stroke="${s.color}" d="${d}"/>`; }).join('');
    return `<svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}${paths}<line class="now" x1="${x(Date.now())}" x2="${x(Date.now())}" y1="${pt}" y2="${Hh - pb}"/></svg>
      <div class="legend">${series.map(s => `<span><i style="background:${s.color};height:3px"></i>${esc(s.label)}</span>`).join('')}</div>`;
  }
  async function loadCharts() {
    const tc = $('temp-chart'), ec = $('eff-chart');
    if (!tc.innerHTML) tc.innerHTML = '<div class="eyebrow">Temperaturer genom aggregatet · 24 h <span style="float:right">°C</span></div><div class="body"><div class="empty">Hämtar …</div></div>';
    if (!ec.innerHTML) ec.innerHTML = '<div class="eyebrow">Verkningsgrad och utetemperatur · 48 h</div><div class="body"><div class="empty">Hämtar …</div></div>';
    try {
      const ids = [[F.outdoor, 'Uteluft', TC('blue')], [F.supply, 'Tilluft', TC('orange')], [F.extract, 'Frånluft', TC('gold')], [F.exhaust, 'Avluft', '#7b8873']];
      const res = await Promise.all(ids.map(([id]) => histPts(id, 24).catch(() => [])));
      tc.querySelector('.body').innerHTML = multiLine(ids.map(([, label, color], i) => ({ label, color, points: res[i] })));
    } catch (e) { tc.querySelector('.body').innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; }
    try {
      const [ef, out] = await Promise.all([histPts(F.efficiency, 48), histPts(F.outdoor, 48).catch(() => [])]);
      // Utetemperaturen ritas på samma skala (0–100) efter omskalning: −20…+30 °C → 0…100
      const sc = out.map(([t, v]) => [t, (v + 20) * 2]);
      ec.querySelector('.body').innerHTML = multiLine([{ label: 'Temperaturverkningsgrad %', color: TC('sage'), points: ef }, { label: 'Ute (skala −20…30 °C)', color: TC('blue'), points: sc, dash: true }], { min: 0, max: 100, h: 200 });
    } catch (e) { ec.querySelector('.body').innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; }
    try {
      const d = await getJSON(`api/daily?entity=${encodeURIComponent(F.energy_total)}&days=14`);
      daily = d.points.map(([t, v]) => [tsOf(t), v]); renderEnergy();
    } catch {}
  }

  // ---------- Rendering ----------
  let queued = false;
  function render() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false; clearPending();
      const live = connected && !bad(states[F.supply]);
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      for (const f of [renderHero, renderControl, renderFans, renderRooms, renderSmart, renderEnergy, renderUnit]) { try { f(); } catch (e) { console.error(f.name, e); } }
    });
  }
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();
  setInterval(render, 60000); // "x min sedan"

  async function start() {
    F = await getJSON('api/ftx');
    if (F.title) $('title').textContent = F.title;
    if (F.subtitle) $('subtitle').textContent = F.subtitle;
    const es = new EventSource('api/stream');
    let loaded = false;
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; render(); if (!loaded) { loaded = true; loadCharts(); } });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; render(); });
    es.onerror = () => { connected = false; render(); };
    setInterval(loadCharts, 10 * 60 * 1000);
  }
  start().catch(e => { $('subtitle').textContent = 'Kunde inte starta: ' + e.message; });
  console.info('observatory ftx view', VERSION);
})();
