// Laddboxsidan: go-e V5 + Kia EV6. Laddning nu, styrning, smart laddning, bilen, faser, historik och hårdvara.
// Styrningen går via servern, som bara släpper igenom vitlistade entiteter.
(() => {
  'use strict';
  const VERSION = '0.10.0';
  const $ = id => document.getElementById(id);
  let C = {}, states = {}, connected = false;

  // ---------- Hjälpare ----------
  const st = id => (id && connected) ? states[id] : undefined;
  const bad = s => !s || ['unknown', 'unavailable', ''].includes(s.state);
  function num(id, attr) {
    const s = st(id); if (!s) return null;
    const v = parseFloat(attr ? s.attributes[attr] : s.state);
    return Number.isFinite(v) ? v : null;
  }
  const attr = (id, k) => { const s = st(id); return s ? s.attributes[k] : undefined; };
  const on = id => { const s = st(id); return bad(s) ? null : s.state === 'on'; };
  const nf = (v, d = 1) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hm = t => t ? new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '–';
  const dur = m => m == null ? '–' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min`;
  function ago(t) {
    if (!t) return '–';
    const m = Math.round((Date.now() - Date.parse(t)) / 60000);
    if (m < 1) return 'nyss'; if (m < 60) return `${m} min sedan`;
    const h = Math.round(m / 60); return h < 48 ? `${h} h sedan` : new Date(t).toLocaleDateString('sv-SE');
  }
  const kv = (k, v, u = '', cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}${u ? `<small>${u}</small>` : ''}</b></div>`;
  const srow = (k, v, u = '') => `<div class="srow"><span>${k}</span><b>${v}${u ? `<small>${u}</small>` : ''}</b></div>`;
  const bar = (pct, cls = '') => `<div class="so-bar ${cls}"><span style="width:${Math.max(0, Math.min(100, pct || 0))}%"></span></div>`;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
  const tsOf = t => typeof t === 'string' ? Date.parse(t) : t;

  const CAR = { Idle: 'Ingen bil ansluten', Charging: 'Laddar', 'Wait for car': 'Väntar på bilen', Complete: 'Laddning klar', Error: 'Fel' };
  const FRC = [['0', 'Auto'], ['1', 'Av'], ['2', 'På']];
  const PSM = [['0', 'Auto'], ['1', '1-fas'], ['2', '3-fas']];
  const LMO = [['3', 'Standard'], ['4', 'Eco'], ['5', 'Nästa resa']];
  const SMART = { smart_charging_not_active: 'Inte aktiv', waiting_for_new_prices: 'Väntar på nya priser', no_good_schedule: 'Hittar inget bra schema',
    waiting_for_charging: 'Väntar på planerad laddning', charging: 'Laddar enligt plan', ev_not_connected: 'Bilen är inte ansluten',
    charging_completed: 'Klar', keep_charger_on: 'Håller laddaren på', disconnected: 'Bilen är inte ansluten', connected: 'Ansluten' };
  const charging = () => { const s = st(C.car_state); return s && s.state === 'Charging'; };

  // ---------- Styrning ----------
  const pending = {};
  async function send(action, value, entity) {
    if (!C.controls) return;
    pending[action + entity] = { value, until: Date.now() + 25000 };
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
      const m = k.match(/^(toggle|select|number)(.+)$/); if (!m) continue;
      const cur = m[1] === 'toggle' ? on(m[2]) : m[1] === 'number' ? num(m[2]) : (st(m[2]) || {}).state;
      if (cur === p.value) delete pending[k];
    }
  }
  const drafts = {}, timers = {};
  function bump(ent, dir, step) {
    const s = st(ent); if (!s) return;
    const lo = +s.attributes.min, hi = +s.attributes.max, st0 = +s.attributes.step || 1, stp = step || st0;
    const base = drafts[ent] ?? (pend('number', ent) ? pend('number', ent).value : num(ent));
    if (base == null) return;
    drafts[ent] = Math.max(lo, Math.min(hi, Math.round((base + dir * stp) / st0) * st0));
    render();
    clearTimeout(timers[ent]);
    timers[ent] = setTimeout(() => { const v = drafts[ent]; delete drafts[ent]; send('number', v, ent); }, 1200);
  }
  const cur = (kind, ent) => { const p = pend(kind, ent); return p ? p.value : kind === 'toggle' ? on(ent) : kind === 'number' ? (drafts[ent] ?? num(ent)) : (st(ent) || {}).state; };
  function seg(ent, opts, cls = '') {
    const s = st(ent), val = cur('select', ent), p = pend('select', ent);
    return `<div class="ctl-seg ${cls}">${opts.map(([v, l]) => `<button data-act="select" data-ent="${ent}" data-val="${esc(v)}" aria-pressed="${val === v}" class="${p && p.value === v ? 'pending' : ''}" ${C.controls && s ? '' : 'disabled'}>${esc(l)}</button>`).join('')}</div>`;
  }
  function numSeg(ent, values, unit) {
    const s = st(ent), val = cur('number', ent), p = pend('number', ent);
    return `<div class="ctl-seg mini">${values.map(v => `<button data-act="setnum" data-ent="${ent}" data-val="${v}" aria-pressed="${val === v}" class="${p && p.value === v ? 'pending' : ''}" ${C.controls && s ? '' : 'disabled'}>${v}${unit}</button>`).join('')}</div>`;
  }
  function tgl(ent) {
    const p = pend('toggle', ent), v = cur('toggle', ent);
    return `<button class="tgl ${v ? 'on' : ''} ${p ? 'pending' : ''}" data-act="toggle" data-ent="${ent}" aria-pressed="${!!v}" ${C.controls && st(ent) ? '' : 'disabled'}><i></i>${v ? 'På' : 'Av'}</button>`;
  }
  function stepper(ent, unit, step) {
    const s = st(ent), p = pend('number', ent), v = cur('number', ent);
    return `<div class="stp"><button data-act="num" data-ent="${ent}" data-dir="-1" data-step="${step || ''}" ${C.controls && s ? '' : 'disabled'} aria-label="Minska">−</button>
      <b class="${p || drafts[ent] != null ? 'pending' : ''}">${nf(v, 0)}<small>${unit}</small></b>
      <button data-act="num" data-ent="${ent}" data-dir="1" data-step="${step || ''}" ${C.controls && s ? '' : 'disabled'} aria-label="Öka">+</button></div>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
    const a = b.dataset.act, ent = b.dataset.ent;
    if (a === 'num') return bump(ent, +b.dataset.dir, b.dataset.step ? +b.dataset.step : null);
    if (a === 'setnum') { if (ent === C.ac_limit && !confirm(`Ändra bilens AC-laddgräns till ${b.dataset.val} %? Kommandot skickas till Kia och väcker bilen.`)) return; return send('number', +b.dataset.val, ent); }
    if (a === 'toggle') return send('toggle', b.getAttribute('aria-pressed') !== 'true', ent);
    if (a === 'select') {
      if (ent === C.force && b.dataset.val === '1' && charging() && !confirm('Stoppa laddningen nu?')) return;
      return send('select', b.dataset.val, ent);
    }
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('select[data-ent]'); if (!el) return;
    send('select', el.value, el.dataset.ent);
  });

  // ---------- Hero ----------
  function chargerSvg(state) {
    const live = state === 'Charging', plugged = state && state !== 'Idle';
    return `<svg viewBox="0 0 170 150" class="chsvg ${live ? 'live' : ''}" aria-hidden="true">
      <rect x="18" y="14" width="62" height="96" rx="12" class="cbx"/>
      <circle cx="49" cy="46" r="15" class="ring"/>
      <path d="M52 36 l-7 11 h6 l-3 10 l9-13 h-6 z" class="bolt"/>
      <rect x="34" y="78" width="30" height="5" rx="2.5" class="led"/>
      ${plugged ? `<path d="M49 110 C49 140, 110 140, 120 112" class="cable"/>${live ? '<path d="M49 110 C49 140, 110 140, 120 112" class="flow"/>' : ''}
        <rect x="112" y="88" width="20" height="26" rx="5" class="plug"/><rect x="118" y="80" width="3" height="9" class="pin"/><rect x="124" y="80" width="3" height="9" class="pin"/>`
        : `<path d="M49 110 C49 128, 70 132, 82 132" class="cable idle"/><rect x="80" y="122" width="20" height="16" rx="4" class="plug idle"/>`}
    </svg>`;
  }
  function renderHero() {
    const s = st(C.car_state), state = s ? s.state : null;
    const w = num(C.power), soc = num(C.car_soc), target = num(C.car_target);
    const phases = (C.currents || []).filter(id => num(id) > 1).length;
    const frc = (st(C.force) || {}).state, frcL = (FRC.find(x => x[0] === frc) || [])[1];
    const bal = on(C.balancing);
    $('hero').innerHTML = `
      <div class="chw">${chargerSvg(state)}</div>
      <div class="hmain">
        <div class="eyebrow">Laddeffekt nu</div>
        <div class="hbig">${w == null ? '–' : nf(w / 1000, 2)}<small>kW</small></div>
        <div class="hsub">${phases ? `${phases} fas${phases > 1 ? 'er' : ''} · ` : ''}${nf(num(C.amp), 0)} A inställt</div>
        <div class="hstatus ${state === 'Charging' ? 'heat chg' : state === 'Error' ? 'err' : ''}"><i></i>${esc(CAR[state] || state || 'Okänt')}</div>
        <div class="hchips">
          ${frcL ? `<span class="chip ${frc === '0' ? '' : frc === '2' ? 'on' : 'warn'}">Laddning: ${frcL}</span>` : ''}
          ${on(C.smart_on) ? '<span class="chip info">Smart laddning på</span>' : ''}
          ${on(C.pv_surplus) ? '<span class="chip">Solöverskott</span>' : ''}
          ${bal ? '<span class="chip heat">Elementen pausade</span>' : ''}
        </div>
      </div>
      <div class="hside">
        ${kv('Bilen', soc == null ? '–' : Math.round(soc), '%', 'sun')}
        ${kv('Mål', target == null ? '–' : Math.round(target), '%')}
        ${kv('Räckvidd', nf(num(C.car_range), 0), 'km')}
        ${kv('Denna laddning', nf(num(C.session_kwh), 1), 'kWh')}
        ${kv('Tid', dur(num(C.session_min)))}
        ${kv('Snitt 30 s', num(C.power_avg30) == null ? '–' : nf(num(C.power_avg30) / 1000, 2), 'kW')}
      </div>
      ${soc != null ? `<div class="soc-wide"><div class="socbar"><span style="width:${soc}%"></span>${target != null ? `<i style="left:${target}%"></i>` : ''}</div>
        <div class="soc-l"><span>${Math.round(soc)} % nu</span><span>mål ${target == null ? '–' : Math.round(target)} % · AC-gräns ${nf(num(C.ac_limit), 0)} %</span></div></div>` : ''}`;
  }

  // ---------- Styrning ----------
  function renderControl() {
    const ends = attr(C.smart_end, 'options') || [], endV = cur('select', C.smart_end);
    $('control').innerHTML = `<div class="wh"><div><div class="eyebrow">Styrning</div><h3>Laddboxen och smart laddning</h3></div>
        ${C.controls ? '' : '<span class="chip">Styrning avstängd i config</span>'}</div>
      <div class="ch-ctl">
        <div class="crow"><span class="eyebrow">Laddning</span>${seg(C.force, FRC, 'modes')}</div>
        <div class="crow"><span class="eyebrow">Ström</span>${stepper(C.amp, 'A')}</div>
        <div class="crow"><span class="eyebrow">Faser</span>${seg(C.phase_mode, PSM)}</div>
        <div class="crow"><span class="eyebrow">Läge</span>${seg(C.logic, LMO)}</div>
        <div class="crow"><span class="eyebrow">Solöverskott</span><div class="crow-r">${tgl(C.pv_surplus)}<span class="hint">Ladda med överskott från solcellerna</span></div></div>
        <div class="crow"><span class="eyebrow">Smart laddning</span><div class="crow-r">${tgl(C.smart_on)}<span class="hint">Laddar de billigaste timmarna</span></div></div>
        <div class="crow"><span class="eyebrow">Klar senast</span><div class="crow-r">
          <select data-ent="${C.smart_end}" ${C.controls && st(C.smart_end) ? '' : 'disabled'} class="${pend('select', C.smart_end) ? 'pending' : ''}">${ends.map(o => `<option value="${esc(o)}" ${o === endV ? 'selected' : ''}>${o === 'None' ? 'Ingen' : esc(o)}</option>`).join('')}</select>
          <span class="hint">Lägsta nivå</span>${stepper(C.smart_min_soc, '%', 5)}</div></div>
        <div class="crow"><span class="eyebrow">EV6 AC-gräns</span><div class="crow-r">${numSeg(C.ac_limit, [50, 60, 70, 80, 90, 100], ' %')}<span class="hint">Skickas till bilen</span></div></div>
      </div>
      <p class="so-note">"Auto" betyder att go-e och dina automationer bestämmer. "Av" stoppar laddningen tills du väljer Auto eller På igen.</p>`;
  }

  // ---------- Laddningen ----------
  function renderSession() {
    const kwh = num(C.session_kwh), min = num(C.session_min), price = num(C.price), extra = +C.price_extra || 0;
    const avg = kwh != null && min > 1 ? kwh / (min / 60) : null;
    const soc = num(C.car_soc), target = num(C.car_target) ?? 100;
    const left = soc != null ? Math.max(0, (target - soc) / 100 * 77.4) : null;
    const w = num(C.power), eta = left != null && w > 500 ? left / (w / 1000) * 60 : null;
    $('session').innerHTML = `<div class="eyebrow">Den här laddningen</div><h3>${nf(kwh, 1)} kWh sedan bilen kopplades in</h3>
      <div class="kvs">
        ${kv('Tid', dur(min))}${kv('Snitteffekt', nf(avg, 1), 'kW')}
        ${kv('Elpris nu', price == null ? '–' : nf(price + extra, 2), 'kr/kWh')}${kv('Ungefärlig kostnad', kwh != null && price != null ? nf(kwh * (price + extra), 0) : '–', 'kr')}
        ${kv('Kvar till målet', nf(left, 1), 'kWh')}${kv('Klar om', eta == null ? (num(C.car_charge_time) != null && charging() ? dur(num(C.car_charge_time)) : '–') : dur(eta))}
      </div>
      <p class="so-note">Kostnaden räknas med nuvarande elpris inklusive nät och skatt (${nf(extra, 3)} kr/kWh). Kvar till målet utgår från ett 77,4 kWh-batteri.</p>`;
  }

  // ---------- Smart laddning ----------
  function renderSmart() {
    const s = st(C.smart_status), plan = st(C.smart_plan), a = plan ? plan.attributes : {};
    const planned = a.charging_is_planned, start = a.charging_start_time, stop = a.charging_stop_time;
    $('smart').innerHTML = `<div class="eyebrow">Smart laddning</div><h3>${s ? esc(SMART[s.state] || s.state) : '–'}</h3>
      ${srow('Aktiverad', on(C.smart_on) ? 'Ja' : 'Nej')}
      ${srow('Planerad laddning', planned ? `${hm(start)}–${hm(stop)}` : 'Ingen')}
      ${srow('Antal timmar', a.charging_number_of_hours != null ? nf(a.charging_number_of_hours, 1) : '–', 'h')}
      ${srow('Klar senast', esc((st(C.smart_end) || {}).state || '–'))}
      ${srow('Lägsta laddnivå', nf(num(C.smart_min_soc), 0), '%')}
      ${srow('Elprisgräns', `${nf(num(C.smart_price_limit), 2)}`, on(C.smart_apply_limit) ? 'kr/kWh · används' : 'kr/kWh · används inte')}
      ${srow('Pris just nu', a.current_price != null ? nf(a.current_price, 2) : '–', 'kr/kWh')}
      ${srow('Elementen pausade', on(C.balancing) ? 'Ja, bilen laddar' : 'Nej')}
      ${srow('Varmvattnet värmer', on(C.water_heater) ? 'Ja' : 'Nej')}`;
  }

  // ---------- Bilen ----------
  function renderCar() {
    const soc = num(C.car_soc), kia = num(C.car_soc_kia), loc = st(C.car_location);
    const cons = num(C.avg_consumption), consKwh = cons == null ? null : cons > 50 ? cons / 10 : cons;
    const yes = id => on(id) == null ? '–' : on(id) ? 'Ja' : 'Nej';
    $('car').innerHTML = `<div class="eyebrow">Kia EV6</div><h3>${soc == null ? '–' : Math.round(soc)} % · ${nf(num(C.car_range), 0)} km</h3>
      ${srow('Laddnivå (Tibber / Kia)', `${soc == null ? '–' : Math.round(soc)} / ${kia == null ? '–' : Math.round(kia)}`, '%')}
      ${srow('Räckvidd vid AC-mål', nf(num(C.target_range_ac), 0), 'km')}
      ${srow('Kabel i bilen', yes(C.car_plug))}
      ${srow('Bilen säger att den laddar', yes(C.car_charging))}
      ${srow('Laddlucka öppen', yes(C.car_port))}
      ${srow('12 V-batteri', nf(num(C.car_12v), 0), '%')}
      ${srow('Förbrukning 30 dagar', nf(consKwh, 1), 'kWh/100 km')}
      ${srow('Mätarställning', nf(num(C.odometer), 0), 'km')}
      ${srow('Plats', loc ? (loc.state === 'home' ? 'Hemma' : loc.state === 'not_home' ? 'Borta' : esc(loc.state)) : '–')}
      ${srow('Senast uppdaterad', ago((st(C.car_updated) || {}).state))}
      <p class="so-note">Tibber ger laddnivån direkt. Kias värde uppdateras bara när bilen väcks och släpar ofta under laddning.</p>`;
  }

  // ---------- Faser ----------
  function renderPhases() {
    const amp = num(C.amp) || 16;
    const rows = [0, 1, 2].map(i => {
      const v = num((C.voltages || [])[i]), a = num((C.currents || [])[i]), w = num((C.phase_power || [])[i]);
      return `<div class="ph"><div class="phh"><span>L${i + 1}</span><b>${nf(a, 1)}<small>A</small></b></div>${bar(a / amp * 100, 'orange')}
        <div class="so-strv"><span>${nf(v, 0)} V</span><span>${w == null ? '–' : nf(w / 1000, 2)} kW</span></div></div>`;
    }).join('');
    $('phases').innerHTML = `<div class="eyebrow">Faser</div><h3>${esc((st(C.phase_wish) || {}).state || 'Faser')}</h3>${rows}
      ${srow('Max tillåten ström', nf(num(C.max_current), 0), 'A')}${srow('Kabelns max', nf(num(C.cable_max), 0), 'A')}`;
  }

  // ---------- Hårdvara ----------
  function renderHardware() {
    const err = st(C.error), rssi = num(C.wifi);
    const g = (title, rows) => `<div class="sgroup"><div class="eyebrow">${title}</div>${rows}</div>`;
    $('hardware').innerHTML = `<div class="eyebrow">Laddboxen</div><h3>go-e Charger V5</h3><div class="sgroups">
      ${g('Status', srow('Fel', err && err.state !== '-none-' ? `<span class="warnc">${esc(err.state)}</span>` : 'Inga') + srow('Laddning tillåten', on(C.allowed) ? 'Ja' : 'Nej') + srow('Bil ansluten', on(C.connected) ? 'Ja' : 'Nej') + srow('Status', esc((st(C.status) || {}).state || '–')))}
      ${g('Kabel och temperatur', srow('Kabellås', esc((st(C.cable_lock) || {}).state || '–')) + srow('Låsåterkoppling', esc((st(C.lock_feedback) || {}).state || '–')) + srow('Temperatur kontakt', nf(num(C.temp_plug), 0), '°C') + srow('Temperatur kretskort', nf(num(C.temp_board), 1), '°C') + srow('Strömgräns p.g.a. värme', nf(num(C.temp_limit), 0), 'A'))}
      ${g('Nätverk och mätare', srow('WiFi', rssi == null ? '–' : `${nf(rssi, 0)} dBm · ${rssi > -60 ? 'bra' : rssi > -75 ? 'ok' : 'svag'}`) + srow('Omstarter totalt', nf(num(C.reboots), 0)) + srow('Mätarställning', nf(num(C.energy_total), 0), 'kWh'))}
    </div>`;
  }

  // ---------- Historik ----------
  async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); }
  let days = [], prices = [], months = [];
  function renderDays() {
    const el = $('days');
    if (!days.length) { el.innerHTML = '<div class="eyebrow">Senaste 30 dagarna</div><div class="empty">Ingen historik.</div>'; return; }
    const pm = new Map(prices.map(([t, v]) => [new Date(t).toDateString(), v])), extra = +C.price_extra || 0;
    const rows = days.map(([t, v]) => { const k = Math.max(0, v || 0), p = pm.get(new Date(t).toDateString()); return { t, k, kr: p != null ? k * (p + extra) : null }; });
    const Wd = 760, Hh = 220, pl = 34, pr = 8, pt = 12, pb = 22, n = rows.length, bw = (Wd - pl - pr) / n;
    const hi = Math.max(1, ...rows.map(r => r.k)) * 1.1, y = v => pt + (hi - v) / hi * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = hi * i / 4; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`; }
    rows.forEach((r, i) => { const xx = pl + i * bw + bw * .14, w = bw * .72, d = new Date(r.t);
      g += `<rect class="b-chg" x="${xx}" y="${y(r.k)}" width="${w}" height="${Math.max(0, y(0) - y(r.k))}"><title>${d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}: ${nf(r.k, 1)} kWh${r.kr != null ? ` · ca ${nf(r.kr, 0)} kr` : ''}</title></rect>`;
      if (i % 3 === 0 || i === n - 1) g += `<text class="ax" x="${xx + w / 2}" y="${Hh - 7}" text-anchor="middle">${d.getDate()}/${d.getMonth() + 1}</text>`; });
    const tot = rows.reduce((a, r) => a + r.k, 0), kr = rows.reduce((a, r) => a + (r.kr || 0), 0), cnt = rows.filter(r => r.k > 0.5).length;
    el.innerHTML = `<div class="wh"><div><div class="eyebrow">Senaste 30 dagarna</div><h3>${nf(tot, 0)} kWh laddat</h3></div><span class="chip">ca ${nf(kr, 0)} kr · ${cnt} laddningsdagar</span></div>
      <div class="dchart flat"><svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}</svg>
      <div class="legend"><span><i class="l-chg"></i>kWh per dag</span><span>Kostnad uppskattad med dygnets snittpris + nät och skatt</span></div></div>`;
  }
  function renderTotals() {
    const now = new Date(), cy = now.getFullYear(), cm = now.getMonth();
    const v = m => Math.max(0, m[1] || 0);
    const by = (y, mo) => months.filter(m => { const d = new Date(m[0]); return d.getFullYear() === y && (mo == null || d.getMonth() === mo); }).reduce((a, m) => a + v(m), 0);
    const thisM = by(cy, cm), lastM = cm ? by(cy, cm - 1) : by(cy - 1, 11), year = by(cy, null), prevY = by(cy - 1, null);
    const odo = num(C.odometer), cons = num(C.avg_consumption), consKwh = cons == null ? null : cons > 50 ? cons / 10 : cons;
    $('totals').innerHTML = `<div class="eyebrow">Laddat hemma</div><h3>${nf(year, 0)} kWh i år</h3>
      ${srow('Den här månaden', nf(thisM, 0), 'kWh')}${srow('Förra månaden', nf(lastM, 0), 'kWh')}
      ${srow(`Hela ${cy - 1}`, prevY ? nf(prevY, 0) : '–', 'kWh')}
      ${srow('Mätarställning laddbox', nf(num(C.energy_total), 0), 'kWh')}
      ${srow('Räcker till ungefär', consKwh ? nf(year / consKwh * 100, 0) : '–', 'km i år')}
      <p class="so-note">Månader räknas från laddboxens energimätare. Negativa värden (mätaren nollställdes i april 2026) räknas som noll.</p>`;
  }
  function powerChart(points) {
    if (!points.length) return '<div class="empty">Ingen laddning senaste dygnet.</div>';
    const Wd = 760, Hh = 200, pl = 34, pr = 8, pt = 10, pb = 22;
    const t0 = Date.now() - 24 * 3600e3, t1 = Date.now();
    const hi = Math.max(1, ...points.map(p => p[1] / 1000)) * 1.1;
    const x = t => pl + (t - t0) / (t1 - t0) * (Wd - pl - pr), y = v => pt + (hi - v) / hi * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = hi * i / 4; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, hi < 5 ? 1 : 0)}</text>`; }
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t <= t1; t += 3600e3) { const h = new Date(t).getHours(); if (h % 3) continue; g += `<text class="ax" x="${x(t)}" y="${Hh - 6}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`; }
    // stegkurva: effekten håller sitt värde tills nästa mätning
    let d = '', prev = null;
    for (const [t, v] of points.filter(p => p[0] >= t0)) { const yy = y(v / 1000); d += prev == null ? `M${x(t)},${yy}` : `L${x(t)},${prev}L${x(t)},${yy}`; prev = yy; }
    if (prev != null) d += `L${x(t1)},${prev}`;
    return `<svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}<path class="ar" fill="#aebf91" style="opacity:.18" d="${d}L${x(t1)},${y(0)}L${pl},${y(0)}Z"/><path class="ln" stroke="#aebf91" d="${d}"/></svg>`;
  }
  async function loadCharts() {
    const pc = $('power-chart');
    if (!pc.innerHTML) pc.innerHTML = '<div class="eyebrow">Laddeffekt · 24 h <span style="float:right">kW</span></div><div class="body"><div class="empty">Hämtar …</div></div>';
    try { const h = await getJSON(`api/history?entity=${encodeURIComponent(C.power)}&hours=24`); pc.querySelector('.body').innerHTML = powerChart(h.points.map(([t, v]) => [tsOf(t), v])); }
    catch (e) { pc.querySelector('.body').innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; }
    try {
      const [d, p, m] = await Promise.all([
        getJSON(`api/daily?entity=${encodeURIComponent(C.energy_total)}&days=30`),
        getJSON(`api/daily?entity=${encodeURIComponent(C.price)}&days=30&stat=mean`).catch(() => ({ points: [] })),
        getJSON(`api/monthly?entity=${encodeURIComponent(C.energy_total)}&months=24`).catch(() => ({ points: [] })),
      ]);
      days = d.points.map(([t, v]) => [tsOf(t), v]); prices = p.points.map(([t, v]) => [tsOf(t), v]); months = m.points.map(([t, v]) => [tsOf(t), v]);
    } catch (e) { console.error(e); }
    for (const f of [renderDays, renderTotals]) { try { f(); } catch (e) { console.error(f.name, e); } }
  }

  // ---------- Rendering ----------
  let queued = false;
  function render() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false; clearPending();
      const live = connected && !bad(states[C.car_state]);
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      // rita inte om styrningen medan en rullista är öppen
      const focusSel = document.activeElement && document.activeElement.tagName === 'SELECT';
      for (const f of [renderHero, focusSel ? null : renderControl, renderSession, renderSmart, renderCar, renderPhases, renderHardware]) { if (!f) continue; try { f(); } catch (e) { console.error(f.name, e); } }
    });
  }
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();
  setInterval(render, 60000);

  async function start() {
    C = await getJSON('api/charger');
    if (C.title) $('title').textContent = C.title;
    if (C.subtitle) $('subtitle').textContent = C.subtitle;
    const es = new EventSource('api/stream');
    let loaded = false;
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; render(); if (!loaded) { loaded = true; loadCharts(); } });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; render(); });
    es.onerror = () => { connected = false; render(); };
    setInterval(loadCharts, 5 * 60 * 1000);
  }
  start().catch(e => { $('subtitle').textContent = 'Kunde inte starta: ' + e.message; });
  console.info('observatory charger view', VERSION);
})();
