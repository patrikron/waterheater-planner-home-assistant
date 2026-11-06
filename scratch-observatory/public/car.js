// EV6-sidan: batteri, laddning, klimat, lås, karossen, körning, energi, plats, varningar och schema.
// Styrningen går via servern, som bara släpper igenom vitlistade entiteter och skript.
(() => {
  'use strict';
  // Temafärg från CSS-variabel (temat sätts av theme.js)
  const TC = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const VERSION = '0.12.1';
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
  const attrs = id => { const s = st(id); return s ? s.attributes : {}; };
  const on = id => { const s = st(id); return bad(s) ? null : s.state === 'on'; };
  const sv = id => { const s = st(id); return bad(s) ? null : s.state; };
  const nf = (v, d = 1) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dur = m => m == null ? '–' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min`;
  function ago(t) {
    if (!t) return '–';
    const m = Math.round((Date.now() - Date.parse(t)) / 60000);
    if (!Number.isFinite(m)) return '–';
    if (m < 1) return 'nyss'; if (m < 60) return `${m} min sedan`;
    const h = Math.round(m / 60); return h < 48 ? `${h} h sedan` : `${Math.round(h / 24)} dagar sedan`;
  }
  const when = t => t ? new Date(t).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
  const kv = (k, v, u = '', cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}${u ? `<small>${u}</small>` : ''}</b></div>`;
  const srow = (k, v, u = '', cls = '') => `<div class="srow ${cls}"><span>${k}</span><b>${v}${u ? `<small>${u}</small>` : ''}</b></div>`;
  const yes = id => on(id) == null ? '–' : on(id) ? 'Ja' : 'Nej';
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3600); }
  const tsOf = t => typeof t === 'string' ? Date.parse(t) : t;
  const kwh100 = () => { const v = num(C.avg_consumption); return v == null ? null : v > 50 ? v / 10 : v; };

  // ---------- Styrning ----------
  const pending = {};
  async function send(action, value, entity, hold = 25000) {
    if (!C.controls) return;
    pending[action + entity] = { value, until: Date.now() + hold };
    render();
    try {
      const r = await fetch('api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, value, entity }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
      if (action === 'script') toast('Skickat till bilen. Det kan ta upp till en minut innan den svarar.');
    } catch (e) { delete pending[action + entity]; render(); toast('Gick inte: ' + e.message); }
  }
  const pend = (action, entity) => { const p = pending[action + entity]; return p && Date.now() < p.until ? p : null; };
  function clearPending() {
    for (const [k, p] of Object.entries(pending)) {
      if (Date.now() > p.until) { delete pending[k]; continue; }
      const m = k.match(/^(toggle|number|lock)(.+)$/); if (!m) continue;
      const cur = m[1] === 'toggle' ? on(m[2]) : m[1] === 'number' ? num(m[2]) : (sv(m[2]) === 'locked' ? 'lock' : sv(m[2]) === 'unlocked' ? 'unlock' : null);
      if (cur === p.value) delete pending[k];
    }
  }
  const drafts = {}, timers = {};
  function bump(ent, dir) {
    const s = st(ent); if (!s) return;
    const lo = +s.attributes.min, hi = +s.attributes.max, stp = +s.attributes.step || 1;
    const base = drafts[ent] ?? (pend('number', ent) ? pend('number', ent).value : num(ent));
    if (base == null) return;
    drafts[ent] = Math.max(lo, Math.min(hi, Math.round((base + dir * stp) / stp) * stp));
    render();
    clearTimeout(timers[ent]);
    timers[ent] = setTimeout(() => { const v = drafts[ent]; delete drafts[ent]; send('number', v, ent); }, 1200);
  }
  const curNum = ent => { const p = pend('number', ent); return drafts[ent] ?? (p ? p.value : num(ent)); };
  const curTgl = ent => { const p = pend('toggle', ent); return p ? p.value : on(ent); };
  const dis = ent => C.controls && st(ent) ? '' : 'disabled';
  function stepper(ent, unit, d = 0) {
    const p = pend('number', ent), v = curNum(ent);
    return `<div class="stp"><button data-act="num" data-ent="${ent}" data-dir="-1" ${dis(ent)} aria-label="Minska">−</button>
      <b class="${p || drafts[ent] != null ? 'pending' : ''}">${nf(v, d)}<small>${unit}</small></b>
      <button data-act="num" data-ent="${ent}" data-dir="1" ${dis(ent)} aria-label="Öka">+</button></div>`;
  }
  function tgl(ent, label) {
    const p = pend('toggle', ent), v = curTgl(ent);
    return `<button class="tgl ${v ? 'on' : ''} ${p ? 'pending' : ''}" data-act="toggle" data-ent="${ent}" aria-pressed="${!!v}" ${dis(ent)}><i></i>${esc(label)}</button>`;
  }
  function numSeg(ent, values) {
    const val = curNum(ent), p = pend('number', ent);
    return `<div class="ctl-seg mini">${values.map(v => `<button data-act="setnum" data-ent="${ent}" data-val="${v}" aria-pressed="${val === v}" class="${p && p.value === v ? 'pending' : ''}" ${dis(ent)}>${v} %</button>`).join('')}</div>`;
  }
  const sbtn = (ent, label, cls = '', ask = '') => `<button class="cbtn ${cls} ${pend('script', ent) ? 'pending' : ''}" data-act="script" data-ent="${ent}" data-ask="${esc(ask)}" ${dis(ent)}>${label}</button>`;

  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
    const a = b.dataset.act, ent = b.dataset.ent;
    if (a === 'num') return bump(ent, +b.dataset.dir);
    if (a === 'setnum') {
      if (!confirm(`Ändra till ${b.dataset.val} %? Kommandot skickas till Kia och väcker bilen.`)) return;
      return send('number', +b.dataset.val, ent);
    }
    if (a === 'toggle') return send('toggle', b.getAttribute('aria-pressed') !== 'true', ent);
    if (a === 'script') { if (b.dataset.ask && !confirm(b.dataset.ask)) return; return send('script', true, ent, 20000); }
    if (a === 'lock') {
      if (b.dataset.val === 'unlock' && !confirm('Låsa upp bilen?')) return;
      return send('lock', b.dataset.val, ent, 60000);
    }
  });

  // ---------- Hero ----------
  function carSvg(plugged, live) {
    return `<svg viewBox="0 0 240 110" class="carsvg ${live ? 'live' : ''}" aria-hidden="true">
      <path class="body" d="M14 74 C14 62, 22 56, 38 54 L70 50 C84 36, 102 28, 132 28 L160 28 C178 28, 194 38, 208 50 L222 54 C230 56, 234 62, 234 70 L234 78 L14 78 Z"/>
      <path class="glass" d="M78 50 C90 38, 104 33, 128 33 L146 33 L146 50 Z M152 33 L160 33 C174 33, 186 40, 198 50 L152 50 Z"/>
      <line class="trim" x1="24" y1="64" x2="226" y2="64"/>
      <circle class="wheel" cx="60" cy="80" r="15"/><circle class="hub" cx="60" cy="80" r="6"/>
      <circle class="wheel" cx="190" cy="80" r="15"/><circle class="hub" cx="190" cy="80" r="6"/>
      <rect class="port ${plugged ? 'on' : ''}" x="206" y="58" width="9" height="6" rx="1.5"/>
      ${plugged ? `<path class="cable" d="M215 62 C232 64, 236 92, 236 104"/>${live ? '<path class="flow" d="M236 104 C236 92, 232 64, 215 62"/>' : ''}` : ''}
    </svg>`;
  }
  function renderHero() {
    const soc = num(C.soc), kia = num(C.soc_kia), target = num(C.target_soc), ac = num(C.ac_limit);
    const plugged = on(C.plug) || (sv(C.charger_state) && sv(C.charger_state) !== 'Idle');
    const live = on(C.charging) || sv(C.charger_state) === 'Charging';
    const lock = sv(C.lock), loc = sv(C.location), eng = on(C.engine), clim = on(C.air_conditioner) || (sv(C.climate) && sv(C.climate) !== 'off');
    const openDoors = Object.values(C.doors || {}).filter(id => on(id)).length, openWin = Object.values(C.windows || {}).filter(id => on(id)).length;
    const warn = [...(C.warnings || []), ...(C.lamps || [])].filter(([id]) => on(id)).length + (on((C.tires || {}).all) ? 1 : 0);
    const status = eng ? ['Motorn är på', 'heat'] : live ? ['Laddar', 'chg'] : plugged ? ['Inkopplad', 'chg'] : clim ? ['Klimatet är på', 'heat'] : loc === 'home' ? ['Står hemma', ''] : ['Borta', ''];
    const kwhLeft = soc != null ? soc / 100 * (+C.battery_kwh || 77.4) : null;
    $('hero').innerHTML = `
      <div class="carw"><img class="carimg" src="ev6.webp" alt="Kia EV6"></div>
      <div class="hmain">
        <div class="eyebrow">Batteri</div>
        <div class="hbig">${soc == null ? '–' : Math.round(soc)}<small>%</small></div>
        <div class="hsub">${nf(num(C.range), 0)} km räckvidd · ca ${nf(kwhLeft, 0)} kWh i batteriet</div>
        <div class="hstatus ${status[1]}"><i></i>${status[0]}</div>
        <div class="hchips">
          ${lock ? `<span class="chip ${lock === 'locked' ? 'on' : 'warn'}">${lock === 'locked' ? 'Låst' : lock === 'unlocked' ? 'Olåst' : esc(lock)}</span>` : ''}
          ${openDoors ? `<span class="chip warn">${openDoors} dörr${openDoors > 1 ? 'ar' : ''} öppen</span>` : ''}
          ${openWin ? `<span class="chip warn">${openWin} fönster öppet</span>` : ''}
          ${on((C.doors || {}).trunk) ? '<span class="chip warn">Bakluckan öppen</span>' : ''}
          ${warn ? `<span class="chip alarm">${warn} varning${warn > 1 ? 'ar' : ''}</span>` : '<span class="chip">Inga varningar</span>'}
        </div>
      </div>
      <div class="hside">
        ${kv('Kia säger', kia == null ? '–' : Math.round(kia), '%')}
        ${kv('Mål', target == null ? '–' : Math.round(target), '%')}
        ${kv('AC-gräns', nf(ac, 0), '%')}
        ${kv('12 V', nf(num(C.battery_12v), 0), '%', num(C.battery_12v) != null && num(C.battery_12v) < 70 ? 'warnc' : '')}
        ${kv('Mätare', nf(num(C.odometer), 0), 'km')}
        ${kv('Uppdaterad', ago(sv(C.updated)))}
      </div>
      ${soc != null ? `<div class="soc-wide"><div class="socbar"><span style="width:${soc}%"></span>${ac != null ? `<i style="left:${ac}%"></i>` : ''}</div>
        <div class="soc-l"><span>${Math.round(soc)} % · ${nf(num(C.range), 0)} km</span><span>AC-gräns ${nf(ac, 0)} % · ${nf(num(C.target_range_ac), 0)} km</span></div></div>` : ''}`;
  }

  // ---------- Styrning ----------
  function renderControl() {
    const lock = sv(C.lock), lp = pend('lock', C.lock);
    const lockBtns = `<button class="cbtn ${lock === 'locked' ? 'act' : ''} ${lp && lp.value === 'lock' ? 'pending' : ''}" data-act="lock" data-ent="${C.lock}" data-val="lock" ${dis(C.lock)}>Lås</button>
      ${C.allow_unlock ? `<button class="cbtn ${lock === 'unlocked' ? 'act warn' : ''} ${lp && lp.value === 'unlock' ? 'pending' : ''}" data-act="lock" data-ent="${C.lock}" data-val="unlock" ${dis(C.lock)}>Lås upp</button>` : '<span class="hint">Upplåsning är avstängd härifrån</span>'}`;
    $('control').innerHTML = `<div class="wh"><div><div class="eyebrow">Styrning</div><h3>Klimat, lås och laddning</h3></div>
        ${C.controls ? '<span class="chip">Varje kommando väcker bilen</span>' : '<span class="chip">Styrning avstängd i config</span>'}</div>
      <div class="car-ctl">
        <div class="cgroup">
          <div class="eyebrow">Värme</div>
          <div class="crow"><span class="hint">Temperatur</span>${stepper(C.heat_temp, '°C', 1)}</div>
          <div class="crow"><span class="hint">Tid</span>${stepper(C.heat_duration, 'min')}</div>
          ${sbtn(C.script_heat, 'Starta värme', 'heat')}
        </div>
        <div class="cgroup">
          <div class="eyebrow">Kyla</div>
          <div class="crow"><span class="hint">Temperatur</span>${stepper(C.cool_temp, '°C', 1)}</div>
          <div class="crow"><span class="hint">Tid</span>${stepper(C.cool_duration, 'min')}</div>
          ${sbtn(C.script_cool, 'Starta kyla', 'cool')}
        </div>
        <div class="cgroup">
          <div class="eyebrow">Tillval vid värme</div>
          <div class="tgls">${tgl(C.opt_defrost, 'Avfrostning')}${tgl(C.opt_wheel, 'Rattvärme')}${tgl(C.opt_seat_driver, 'Stolvärme förare')}${tgl(C.opt_seat_passenger, 'Stolvärme passagerare')}</div>
          <div class="eyebrow" style="margin-top:14px">Lås</div>
          <div class="btns">${lockBtns}</div>
        </div>
        <div class="cgroup">
          <div class="eyebrow">Laddning</div>
          <div class="btns">${sbtn(C.script_charge_start, 'Starta')}${sbtn(C.script_charge_stop, 'Stoppa', '', 'Stoppa laddningen i bilen?')}${sbtn(C.script_port, 'Öppna laddlucka')}</div>
          <span class="hint">AC-gräns (hemma)</span>${numSeg(C.ac_limit, [50, 60, 70, 80, 90, 100])}
          <span class="hint">DC-gräns (snabbladdning)</span>${numSeg(C.dc_limit, [50, 60, 70, 80, 90, 100])}
        </div>
        <div class="cgroup">
          <div class="eyebrow">Uppdatera</div>
          <div class="btns">${sbtn(C.script_update, 'Hämta senaste')}${sbtn(C.script_force, 'Väck bilen', '', 'Väcka bilen och hämta färska värden? Det drar lite från 12 V-batteriet. Skriptet hoppar över om 12 V är under 80 % eller om bilen uppdaterades för mindre än 5 min sedan.')}</div>
          <p class="so-note">"Hämta senaste" läser Kias moln utan att väcka bilen.</p>
        </div>
      </div>`;
  }

  // ---------- Karossen ----------
  function renderBody() {
    const D = C.doors || {}, W = C.windows || {}, T = C.tires || {};
    const o = id => on(id) ? 'open' : '', t = id => on(id) ? 'warn' : '';
    const svg = `<svg viewBox="0 0 160 250" class="topsvg" aria-hidden="true">
      <rect class="tire ${t(T.fl)}" x="16" y="48" width="14" height="34" rx="5"/><rect class="tire ${t(T.fr)}" x="130" y="48" width="14" height="34" rx="5"/>
      <rect class="tire ${t(T.rl)}" x="16" y="168" width="14" height="34" rx="5"/><rect class="tire ${t(T.rr)}" x="130" y="168" width="14" height="34" rx="5"/>
      <path class="shell" d="M38 34 C38 16, 56 8, 80 8 C104 8, 122 16, 122 34 L126 210 C126 232, 108 242, 80 242 C52 242, 34 232, 34 210 Z"/>
      <path class="lid ${o(D.hood)}" d="M44 36 C44 22, 60 16, 80 16 C100 16, 116 22, 116 36 L114 64 L46 64 Z"/>
      <path class="glassT" d="M48 70 L112 70 L106 92 L54 92 Z"/>
      <rect class="door ${o(D.fl)}" x="34" y="96" width="10" height="48" rx="3"/><rect class="door ${o(D.fr)}" x="116" y="96" width="10" height="48" rx="3"/>
      <rect class="door ${o(D.rl)}" x="34" y="148" width="10" height="44" rx="3"/><rect class="door ${o(D.rr)}" x="116" y="148" width="10" height="44" rx="3"/>
      <rect class="win ${o(W.fl)}" x="46" y="100" width="4" height="38" rx="2"/><rect class="win ${o(W.fr)}" x="110" y="100" width="4" height="38" rx="2"/>
      <rect class="win ${o(W.rl)}" x="46" y="152" width="4" height="34" rx="2"/><rect class="win ${o(W.rr)}" x="110" y="152" width="4" height="34" rx="2"/>
      <path class="glassT" d="M56 196 L104 196 L108 210 L52 210 Z"/>
      <path class="lid ${o(D.trunk)}" d="M48 214 L112 214 C112 228, 100 236, 80 236 C60 236, 48 228, 48 214 Z"/>
    </svg>`;
    const list = [['Dörrar', ['fl', 'fr', 'rl', 'rr'].some(k => on(D[k])) ? 'Öppen' : 'Stängda'], ['Fönster', ['fl', 'fr', 'rl', 'rr'].some(k => on(W[k])) ? 'Öppet' : 'Stängda'],
      ['Baklucka', on(D.trunk) ? 'Öppen' : 'Stängd'], ['Motorhuv', on(D.hood) ? 'Öppen' : 'Stängd'], ['Laddlucka', on(C.port) ? 'Öppen' : 'Stängd'], ['Däcktryck', on(T.all) ? 'Kontrollera' : 'OK']];
    $('body').innerHTML = `<div class="eyebrow">Karossen</div><h3>${sv(C.lock) === 'locked' ? 'Låst' : sv(C.lock) === 'unlocked' ? 'Olåst' : '–'}${on(C.engine) ? ' · motorn på' : ''}</h3>
      <div class="bodyw">${svg}<div class="bodyl">${list.map(([k, v]) => srow(k, /Öppe|Kontroll/.test(v) ? `<span class="warnc">${v}</span>` : v)).join('')}</div></div>`;
  }

  // ---------- Batteri ----------
  function renderBattery() {
    const soc = num(C.soc), soh = num(C.soh), cap = +C.battery_kwh || 77.4;
    $('battery').innerHTML = `<div class="eyebrow">Batteriet</div><h3>${soc == null ? '–' : Math.round(soc)} % · ${nf(num(C.range), 0)} km</h3>
      ${srow('Laddnivå Tibber / Kia', `${soc == null ? '–' : Math.round(soc)} / ${num(C.soc_kia) == null ? '–' : Math.round(num(C.soc_kia))}`, '%')}
      ${srow('Energi i batteriet', soc == null ? '–' : nf(soc / 100 * cap, 1), `av ${nf(cap, 1)} kWh`)}
      ${srow('Räckvidd nu', nf(num(C.range), 0), 'km')}
      ${srow('Räckvidd vid AC-gräns', nf(num(C.target_range_ac), 0), `km · ${nf(num(C.ac_limit), 0)} %`)}
      ${srow('Räckvidd vid DC-gräns', nf(num(C.target_range_dc), 0), `km · ${nf(num(C.dc_limit), 0)} %`)}
      ${srow('Batteriets hälsa (SoH)', soh == null || soh === 0 ? 'Rapporteras inte' : nf(soh, 0), soh ? '%' : '')}
      ${srow('12 V-batteri', nf(num(C.battery_12v), 0), '%')}
      <p class="so-note">Tibber ger laddnivån direkt från bilen. Kias värde uppdateras bara när bilen väcks och släpar ofta.</p>`;
  }
  function renderCharge() {
    const live = on(C.charging) || sv(C.charger_state) === 'Charging';
    const w = num(C.charger_power);
    $('charge').innerHTML = `<div class="eyebrow">Laddning</div><h3>${live ? `Laddar ${w != null ? nf(w / 1000, 1) + ' kW' : ''}` : on(C.plug) ? 'Inkopplad, laddar inte' : 'Inte inkopplad'}</h3>
      ${srow('Kabel i bilen', yes(C.plug))}${srow('Bilen säger att den laddar', yes(C.charging))}${srow('Laddlucka öppen', yes(C.port))}
      ${srow('Laddeffekt enligt bilen', nf(num(C.charging_power), 1), 'kW')}
      ${srow('Tid till full, hemmaladdare', dur(num(C.charge_time)))}
      ${srow('Tid till full, snabbladdare', dur(num(C.charge_time_dc)))}
      ${srow('Tid till full, portabel laddare', dur(num(C.charge_time_portable)))}
      ${srow('Schemalagd laddning i bilen', yes(C.scheduled_charging))}
      <a class="btn primary-link" href="laddbox.html" style="margin-top:12px">Öppna laddboxsidan →</a>`;
  }

  // ---------- Körning ----------
  const DAYKEYS = ['engine_consumption', 'climate_consumption', 'onboard_electronics_consumption', 'battery_care_consumption'];
  const DAYLBL = { engine_consumption: 'Drivlina', climate_consumption: 'Klimat', onboard_electronics_consumption: 'Elektronik', battery_care_consumption: 'Batterivård' };
  const DAYCOL = { engine_consumption: TC('sage'), climate_consumption: TC('orange'), onboard_electronics_consumption: TC('blue'), battery_care_consumption: TC('gold') };
  function dailyRows() {
    const a = attrs(C.daily_stats);
    return Object.keys(a).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().map(k => ({ day: k, ...a[k] }));
  }
  function split(rows) {
    const tot = rows.reduce((s, r) => s + (r.total_consumed || 0), 0) || 1;
    return `<div class="splitbar">${DAYKEYS.map(k => { const v = rows.reduce((s, r) => s + (r[k] || 0), 0); return v ? `<span style="width:${v / tot * 100}%;background:${DAYCOL[k]}" title="${DAYLBL[k]} ${nf(v / 1000, 1)} kWh"></span>` : ''; }).join('')}</div>
      <div class="legend">${DAYKEYS.map(k => { const v = rows.reduce((s, r) => s + (r[k] || 0), 0); return v ? `<span><i style="background:${DAYCOL[k]}"></i>${DAYLBL[k]} ${Math.round(v / tot * 100)} %</span>` : ''; }).join('')}</div>`;
  }
  function renderToday() {
    const a = attrs(C.today_stats), km = a.distance, kwh = a.total_consumed != null ? a.total_consumed / 1000 : null;
    $('today').innerHTML = `<div class="eyebrow">Idag</div><h3>${km == null ? '–' : nf(km, 0)} km körda</h3>
      <div class="kvs">${kv('Förbrukat', nf(kwh, 1), 'kWh')}${kv('Återvunnet', a.regenerated_energy != null ? nf(a.regenerated_energy / 1000, 1) : '–', 'kWh')}
        ${kv('Per 100 km', km > 0 && kwh != null ? nf(kwh / km * 100, 1) : '–', 'kWh')}${kv('Datum', esc(a.today_date || '–'))}</div>
      ${a.total_consumed ? split([a]) : ''}`;
  }
  function renderDriving() {
    const rows = dailyRows(), el = $('driving');
    if (!rows.length) { el.innerHTML = '<div class="eyebrow">Körning per dag</div><div class="empty">Ingen körstatistik från Kia.</div>'; return; }
    // fyll ut dagar utan körning så att staplarna blir en jämn tidslinje
    const map = new Map(rows.map(r => [r.day, r])), first = new Date(rows[0].day + 'T12:00'), all = [];
    for (let d = new Date(first); d <= new Date(); d.setDate(d.getDate() + 1)) { const k = d.toLocaleDateString('sv-SE'); all.push(map.get(k) || { day: k, distance: 0, total_consumed: 0 }); }
    const Wd = 760, Hh = 220, pl = 34, pr = 8, pt = 12, pb = 22, n = all.length, bw = (Wd - pl - pr) / n;
    const hi = Math.max(10, ...all.map(r => r.distance || 0)) * 1.1, y = v => pt + (hi - v) / hi * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = hi * i / 4; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`; }
    all.forEach((r, i) => { const xx = pl + i * bw + bw * .14, w = bw * .72, d = new Date(r.day + 'T12:00'), km = r.distance || 0, kwh = (r.total_consumed || 0) / 1000;
      g += `<rect class="b-km" x="${xx}" y="${y(km)}" width="${w}" height="${Math.max(0, y(0) - y(km))}"><title>${d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}: ${nf(km, 0)} km · ${nf(kwh, 1)} kWh${km > 0 ? ` · ${nf(kwh / km * 100, 1)} kWh/100 km` : ''}</title></rect>`;
      if (i % 3 === 0 || i === n - 1) g += `<text class="ax" x="${xx + w / 2}" y="${Hh - 7}" text-anchor="middle">${d.getDate()}/${d.getMonth() + 1}</text>`; });
    const km = rows.reduce((s, r) => s + (r.distance || 0), 0), kwh = rows.reduce((s, r) => s + (r.total_consumed || 0), 0) / 1000, reg = rows.reduce((s, r) => s + (r.regenerated_energy || 0), 0) / 1000;
    el.innerHTML = `<div class="wh"><div><div class="eyebrow">Körning per dag · ${n} dagar</div><h3>${nf(km, 0)} km · ${nf(kwh, 0)} kWh</h3></div>
        <span class="chip">${km ? nf(kwh / km * 100, 1) : '–'} kWh/100 km · ${rows.length} dagar med körning</span></div>
      <div class="dchart flat"><svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}</svg></div>
      <div class="eyebrow" style="margin-top:10px">Vart energin gick · återvunnet ${nf(reg, 0)} kWh (${kwh ? Math.round(reg / kwh * 100) : '–'} % av förbrukningen)</div>
      ${split(rows)}`;
  }
  function renderEnergy() {
    const c90 = num(C.consumption_90), r90 = num(C.regen_90), k = kwh100();
    $('energy').innerHTML = `<div class="eyebrow">Förbrukning</div><h3>${nf(k, 1)} kWh/100 km</h3>
      ${srow('Snitt senaste 30 dagarna', nf(k, 1), 'kWh/100 km')}
      ${srow('Förbrukat 90 dagar', c90 == null ? '–' : nf(c90 / 1000, 0), 'kWh')}
      ${srow('Återvunnet 90 dagar', r90 == null ? '–' : nf(r90 / 1000, 0), 'kWh')}
      ${srow('Andel återvunnet', c90 && r90 != null ? Math.round(r90 / c90 * 100) : '–', '%')}
      ${srow('Räckvidd med fullt batteri', k ? nf((+C.battery_kwh || 77.4) / k * 100, 0) : '–', 'km')}
      ${srow('Mätarställning', nf(num(C.odometer), 0), 'km')}`;
  }
  let months = [], socPts = [], kiaPts = [];
  function renderMonths() {
    const el = $('months'), rows = months.slice(-13).map(([t, v]) => [t, Math.max(0, v || 0)]);
    if (!rows.length) { el.innerHTML = '<div class="eyebrow">Körsträcka per månad</div><div class="empty">Ingen historik.</div>'; return; }
    const hi = Math.max(1, ...rows.map(r => r[1])), k = kwh100();
    const now = new Date();
    const year = rows.filter(([t]) => new Date(t).getFullYear() === now.getFullYear()).reduce((s, r) => s + r[1], 0);
    el.innerHTML = `<div class="wh"><div><div class="eyebrow">Körsträcka per månad</div><h3>${nf(year, 0)} km i år</h3></div>${k ? `<span class="chip">ca ${nf(year * k / 100, 0)} kWh i år</span>` : ''}</div>
      <div class="so-days mbars">${rows.map(([t, v]) => { const d = new Date(t), cur = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        return `<div class="so-day ${cur ? 'cur' : ''}"><div class="so-dbar"><span style="height:${Math.max(2, v / hi * 100)}%"></span></div><b>${nf(v, 0)}</b><span>${d.toLocaleDateString('sv-SE', { month: 'short' }).replace('.', '')}${d.getMonth() === 0 ? ` ${String(d.getFullYear()).slice(2)}` : ''}</span></div>`; }).join('')}</div>
      <p class="so-note">Räknas från vägmätaren. Innevarande månad är inte klar än.</p>`;
  }
  function renderLocation() {
    const s = st(C.location), a = attrs(C.location), lat = +a.latitude, lon = +a.longitude, home = s && s.state === 'home';
    const link = Number.isFinite(lat) && Number.isFinite(lon) ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}` : null;
    $('location').innerHTML = `<div class="eyebrow">Plats</div><h3>${!s ? '–' : home ? 'Hemma' : s.state === 'not_home' ? 'Borta' : esc(s.state)}</h3>
      ${srow('Position', link ? `${nf(lat, 4)}, ${nf(lon, 4)}` : '–')}
      ${srow('Platsen uppdaterad', ago(sv(C.location_updated)))}
      ${srow('Motor', on(C.engine) ? 'På' : 'Av')}
      ${link ? `<a class="btn primary-link" href="${link}" target="_blank" rel="noopener noreferrer" style="margin-top:12px">Visa på kartan →</a>` : ''}`;
  }
  function renderWarnings() {
    const T = C.tires || {}, lamps = (C.lamps || []).filter(([id]) => on(id)), fl = (C.warnings || []);
    const tire = k => `<span class="tchip ${on(T[k]) ? 'warn' : ''}">${{ fl: 'VF', fr: 'HF', rl: 'VB', rr: 'HB' }[k]}</span>`;
    $('warnings').innerHTML = `<div class="eyebrow">Varningar</div><h3>${lamps.length + fl.filter(([id]) => on(id)).length + (on(T.all) ? 1 : 0) ? 'Något behöver kollas' : 'Allt ser bra ut'}</h3>
      ${srow('Däcktryck', `<span class="tchips">${['fl', 'fr', 'rl', 'rr'].map(tire).join('')}</span>`)}
      ${fl.map(([id, l]) => srow(l, on(id) ? '<span class="warnc">Varning</span>' : on(id) == null ? '–' : 'OK')).join('')}
      ${srow('Lampor', lamps.length ? `<span class="warnc">${lamps.map(l => esc(l[1])).join(', ')}</span>` : `Alla ${(C.lamps || []).length} OK`)}
      ${srow('12 V-batteri', nf(num(C.battery_12v), 0), '%')}`;
  }
  const DAYN = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
  function days(v) {
    if (v == null) return '–';
    const parts = String(v).split(/[,\s]+/).map(Number).filter(n => n >= 0 && n <= 6);
    return parts.length ? parts.map(n => DAYN[n]).join(', ') : 'Inga dagar';
  }
  const hhmm = v => v ? String(v).slice(0, 5) : '–';
  function renderSchedule() {
    const dep = (C.departures || []).map((d, i) => `<div class="sgroup"><div class="eyebrow">Avgång ${i + 1} · ${on(d.on) ? 'på' : 'av'}</div>
      ${srow('Tid', hhmm(sv(d.time)))}${srow('Dagar', days(sv(d.days)))}${srow('Klimat', `${on(d.climate) ? 'På' : 'Av'} · ${nf(num(d.temp), 0)} °C`)}${srow('Avfrostning', on(d.defrost) ? 'På' : 'Av')}</div>`).join('');
    $('schedule').innerHTML = `<div class="eyebrow">Schema i bilen</div><h3>${(C.departures || []).some(d => on(d.on)) ? 'Avgång inställd' : 'Ingen avgång inställd'}</h3>
      ${dep}${srow('Schemalagd laddning', on(C.scheduled_charging) ? 'På' : 'Av')}${srow('Lågpris', `${hhmm(sv(C.offpeak_start))}–${hhmm(sv(C.offpeak_end))}`)}
      <p class="so-note">Ställs in i Kia-appen. Smart laddning hemma sköts av laddboxen.</p>`;
  }
  function renderUpdates() {
    const by = st(C.updated_by), autos = (C.automations || []).map(id => st(id)).filter(Boolean)
      .sort((a, b) => Date.parse(b.attributes.last_triggered || 0) - Date.parse(a.attributes.last_triggered || 0));
    $('updates').innerHTML = `<div class="eyebrow">Uppdateringar</div><h3>Senast ${ago(sv(C.updated))}</h3>
      ${srow('Bilen rapporterade', when(sv(C.updated)))}
      ${srow('Senaste väckning av', by ? esc(String(by.state).replace(/_/g, ' ')) : '–')}
      ${autos.slice(0, 6).map(a => srow(esc((a.attributes.friendly_name || a.entity_id).replace(/^ev6\s*-\s*/i, '')), ago(a.attributes.last_triggered), '', a.state === 'off' ? 'dim' : '')).join('')}`;
  }

  // ---------- Historik ----------
  async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); }
  function lineChart(series, hours) {
    const all = series.flatMap(s => s.points);
    if (!all.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 760, Hh = 220, pl = 34, pr = 8, pt = 10, pb = 22, t1 = Date.now(), t0 = t1 - hours * 3600e3;
    const x = t => pl + (t - t0) / (t1 - t0) * (Wd - pl - pr), y = v => pt + (100 - v) / 100 * (Hh - pt - pb);
    let g = '';
    for (let v = 0; v <= 100; v += 25) g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    const d0 = new Date(t0); d0.setHours(24, 0, 0, 0);
    for (let t = d0.getTime(); t < t1; t += 864e5) { g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${Hh - pb}"/><text class="ax" x="${x(t + 432e5)}" y="${Hh - 6}" text-anchor="middle">${new Date(t).toLocaleDateString('sv-SE', { weekday: 'short' })}</text>`; }
    const paths = series.map(s => { const p = s.points.filter(q => q[0] >= t0); if (!p.length) return '';
      let d = '', prev = null; for (const [t, v] of p) { const yy = y(v).toFixed(1); d += prev == null ? `M${x(t).toFixed(1)},${yy}` : `L${x(t).toFixed(1)},${prev}L${x(t).toFixed(1)},${yy}`; prev = yy; }
      d += `L${x(t1)},${prev}`;
      return `<path class="ln${s.dash ? ' dash' : ''}" stroke="${s.color}" d="${d}"/>`; }).join('');
    return `<svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}${paths}</svg>
      <div class="legend">${series.map(s => `<span><i style="background:${s.color};height:3px"></i>${esc(s.label)}</span>`).join('')}</div>`;
  }
  async function loadCharts() {
    const sc = $('soc-chart');
    if (!sc.innerHTML) sc.innerHTML = '<div class="eyebrow">Laddnivå · 7 dygn <span style="float:right">%</span></div><div class="body"><div class="empty">Hämtar …</div></div>';
    const hp = id => getJSON(`api/history?entity=${encodeURIComponent(id)}&hours=168`).then(h => h.points.map(([t, v]) => [tsOf(t), v]).filter(p => Number.isFinite(p[1])));
    try { [socPts, kiaPts] = await Promise.all([hp(C.soc).catch(() => []), hp(C.soc_kia).catch(() => [])]);
      sc.querySelector('.body').innerHTML = lineChart([{ label: 'Tibber (direkt från bilen)', color: TC('sage'), points: socPts }, { label: 'Kia-molnet', color: TC('blue'), dash: true, points: kiaPts }], 168);
    } catch (e) { sc.querySelector('.body').innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; }
    try { const m = await getJSON(`api/monthly?entity=${encodeURIComponent(C.odometer)}&months=13`); months = m.points.map(([t, v]) => [tsOf(t), v]); } catch (e) { console.error(e); }
    try { renderMonths(); } catch (e) { console.error(e); }
  }

  // ---------- Rendering ----------
  let queued = false;
  function render() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false; clearPending();
      const live = connected && !bad(states[C.soc] || states[C.lock]);
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      for (const f of [renderHero, renderControl, renderBody, renderBattery, renderCharge, renderToday, renderDriving, renderEnergy, renderLocation, renderWarnings, renderSchedule, renderUpdates]) { try { f(); } catch (e) { console.error(f.name, e); } }
    });
  }
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();
  setInterval(render, 60000);

  async function start() {
    C = await getJSON('api/car');
    if (C.title) $('title').textContent = C.title;
    if (C.subtitle) $('subtitle').textContent = C.subtitle;
    const es = new EventSource('api/stream');
    let loaded = false;
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; render(); if (!loaded) { loaded = true; loadCharts(); } });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; render(); });
    es.onerror = () => { connected = false; render(); };
    setInterval(loadCharts, 10 * 60 * 1000);
  }
  start().catch(e => { $('subtitle').textContent = 'Kunde inte starta: ' + e.message; });
  console.info('observatory car view', VERSION);
})();
