// Luftvärmepumpssidan: mätvärden, energi, kostnad, smarta automationer och styrning.
// Styrningen går via servern, som bara släpper igenom vitlistade åtgärder.
(() => {
  'use strict';
  // Temafärg från CSS-variabel (temat sätts av theme.js)
  const TC = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const VERSION = '0.7.0';
  const $ = id => document.getElementById(id);
  let H = {}, states = {}, connected = false;

  // ---------- Hjälpare ----------
  const st = id => (id && connected) ? states[id] : undefined;
  const bad = s => !s || ['unknown', 'unavailable', ''].includes(s.state);
  function num(id, attr) {
    const s = st(id); if (!s) return null;
    const v = parseFloat(attr ? s.attributes[attr] : s.state);
    return Number.isFinite(v) ? v : null;
  }
  const C = k => { const s = st(H.climate); return s && s.attributes ? s.attributes[k] : undefined; };
  const nf = (v, d = 1) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const unit = id => { const s = st(id); return s && s.attributes.unit_of_measurement || ''; };
  const hm = t => t ? new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '–';
  const on = id => { const s = st(id); return bad(s) ? null : s.state === 'on'; };
  function when(t) {
    if (!t) return '–';
    const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 86400000);
    return `${diff === 0 ? 'idag' : diff === 1 ? 'imorgon' : d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric' })} ${hm(t)}`;
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }

  const MODE = { heat: 'Värme', cool: 'Kyla', fan_only: 'Fläkt', dry: 'Avfuktning', heat_cool: 'Auto', auto: 'Auto', off: 'Av' };
  const MODE_ICON = { heat: '☀', cool: '❄', fan_only: '≋', dry: '◌', heat_cool: '⇅', off: '⏻' };
  const FAN = { auto: 'Auto', quiet: 'Tyst', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' };
  const SWING = { stop: 'Stilla', swing: 'Svep', windnice: 'Komfortflöde' };
  const PRESET = { none: 'Normal', boost: 'Kraftfull', away: 'Borta', eco: 'Eco', comfort: 'Komfort' };
  const fanLbl = v => FAN[v] || v;

  // ---------- Styrning ----------
  const pending = {}; // action -> { value, until }
  async function send(action, value, entity) {
    if (!H.controls) return;
    pending[action + (entity || '')] = { value, until: Date.now() + 20000 };
    render();
    try {
      const r = await fetch('api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, value, entity }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
    } catch (e) {
      delete pending[action + (entity || '')]; render();
      toast('Gick inte: ' + e.message);
    }
  }
  const pend = (action, entity) => { const p = pending[action + (entity || '')]; return p && Date.now() < p.until ? p : null; };
  function clearPending() {
    // ta bort väntande när HA visar det nya värdet
    const map = { hvac_mode: () => st(H.climate) && st(H.climate).state, fan_mode: () => C('fan_mode'), swing_mode: () => C('swing_mode'), preset_mode: () => C('preset_mode'), temperature: () => C('temperature') };
    for (const [k, p] of Object.entries(pending)) {
      if (Date.now() > p.until) { delete pending[k]; continue; }
      if (map[k] && map[k]() === p.value) delete pending[k];
      const ent = k.replace(/^(toggle|select)/, '');
      if (k.startsWith('toggle') && on(ent) === p.value) delete pending[k];
      if (k.startsWith('select') && st(ent) && st(ent).state === p.value) delete pending[k];
    }
  }
  let tempTimer = null, tempDraft = null;
  function bumpTemp(dir) {
    const step = C('target_temp_step') || 0.5, lo = C('min_temp') ?? 10, hi = C('max_temp') ?? 30;
    const base = tempDraft ?? (pend('temperature') ? pend('temperature').value : C('temperature'));
    if (base == null) return;
    tempDraft = Math.max(lo, Math.min(hi, Math.round((base + dir * step) / step) * step));
    render();
    clearTimeout(tempTimer);
    tempTimer = setTimeout(() => { const v = tempDraft; tempDraft = null; send('temperature', v); }, 1300); // samla klick, Daikin har en anropsbudget
  }

  // ---------- Hero ----------
  function renderHero() {
    const s = st(H.climate), mode = s ? s.state : null;
    const room = num(H.room) ?? C('current_temperature'), out = num(H.outdoor), set = C('temperature');
    const w = num(H.power), running = w != null && w > 60;
    const peak = on(H.price_peak), lowered = on(H.peak && H.peak.lowered);
    $('hero').innerHTML = `
      <div class="hp-unit ${running && mode !== 'off' ? 'run' : ''} m-${mode || 'none'}">${unitSvg()}</div>
      <div class="hmain">
        <div class="eyebrow">Rumstemperatur · vardagsrum</div>
        <div class="hbig">${nf(room)}<small>°C</small></div>
        <div class="hsub">${mode === 'off' ? 'Avstängd' : `Inställd på ${nf(set, 1)} °C`} · ute ${nf(out)} °C</div>
        <div class="hstatus m-${mode || 'none'} ${running && mode !== 'off' ? 'heat' : ''}"><i></i>${esc(mode ? (MODE[mode] || mode) : 'Okänt läge')}${mode && mode !== 'off' ? (running ? ' · går' : ' · vilar') : ''}</div>
        <div class="hchips">
          ${C('fan_mode') ? `<span class="chip info">Fläkt: ${esc(fanLbl(C('fan_mode')))}</span>` : ''}
          ${C('swing_mode') ? `<span class="chip">Luftriktning: ${esc(SWING[C('swing_mode')] || C('swing_mode'))}</span>` : ''}
          ${C('preset_mode') && C('preset_mode') !== 'none' ? `<span class="chip heat">${esc(PRESET[C('preset_mode')] || C('preset_mode'))}</span>` : ''}
          ${peak ? '<span class="chip warn">Pristopp nu</span>' : ''}${lowered ? `<span class="chip warn">Sänkt ${nf(num(H.peak.drop), 0)} °C för pristopp</span>` : ''}
        </div>
      </div>
      <div class="hside">
        <div class="kv"><span>Effekt nu</span><b class="${running ? 'heat' : ''}">${w == null ? '–' : nf(w, 0)}<small>W</small></b></div>
        <div class="kv"><span>Kostar just nu</span><b>${nf(num(H.cost_rate), 2)}<small>kr/h</small></b></div>
        <div class="kv"><span>Inne − ute</span><b>${room != null && out != null ? nf(room - out, 1) : '–'}<small>°C</small></b></div>
        <div class="kv"><span>Värme idag</span><b>${nf(num(H.heat_day), 1)}<small>kWh</small></b></div>
        <div class="kv"><span>Kostnad idag</span><b>${nf(num(H.cost_today), 2)}<small>kr</small></b></div>
        <div class="kv"><span>Daikin-anrop kvar</span><b class="${num(H.api_calls) != null && num(H.api_calls) < 20 ? 'warnc' : ''}">${nf(num(H.api_calls), 0)}<small>idag</small></b></div>
      </div>`;
  }
  function unitSvg() {
    return `<svg viewBox="0 0 150 110" class="hpsvg" aria-hidden="true">
      <rect x="4" y="8" width="142" height="94" rx="8" class="cab"/>
      <g class="grill">${Array.from({ length: 9 }, (_, i) => `<line x1="${18 + i * 8}" y1="20" x2="${18 + i * 8}" y2="90"/>`).join('')}</g>
      <circle cx="54" cy="55" r="36" class="ring"/>
      <g class="fan"><path d="M54 55 C 50 35, 62 26, 66 33 C 70 41, 60 48, 54 55Z"/><path d="M54 55 C 74 51, 83 63, 76 67 C 68 71, 61 61, 54 55Z"/><path d="M54 55 C 58 75, 46 84, 42 77 C 38 69, 48 62, 54 55Z"/><path d="M54 55 C 34 59, 25 47, 32 43 C 40 39, 47 49, 54 55Z"/><circle cx="54" cy="55" r="5"/></g>
      <rect x="104" y="22" width="30" height="66" rx="4" class="side"/>
      <circle cx="119" cy="34" r="3" class="led"/>
    </svg>`;
  }

  // ---------- Kontroller ----------
  function seg(items, cur, action, cls = '') {
    const p = pend(action);
    return `<div class="ctl-seg ${cls}">${items.map(([v, lbl]) => {
      const active = (p ? p.value : cur) === v;
      return `<button data-act="${action}" data-val="${esc(v)}" aria-pressed="${active}" class="${p && p.value === v ? 'pending' : ''}" ${H.controls ? '' : 'disabled'}>${lbl}</button>`;
    }).join('')}</div>`;
  }
  function renderControl() {
    const s = st(H.climate);
    if (!s) { $('control').innerHTML = '<div class="eyebrow">Styrning</div><div class="empty">Luftvärmepumpen syns inte i Home Assistant.</div>'; return; }
    const mode = pend('hvac_mode') ? pend('hvac_mode').value : s.state;
    const modes = (C('hvac_modes') || []).filter(m => m !== 'off').map(m => [m, `<span class="mi">${MODE_ICON[m] || ''}</span>${MODE[m] || m}`]);
    const set = tempDraft ?? (pend('temperature') ? pend('temperature').value : C('temperature'));
    const isOn = mode !== 'off';
    $('control').innerHTML = `<div class="wh"><div><div class="eyebrow">Styrning</div><h3>${H.controls ? 'Styr luftvärmepumpen' : 'Styrning avstängd'}</h3></div>
        <span class="chip">${H.controls ? 'Varje ändring använder ett Daikin-anrop' : 'Slå på med "controls": true i config.json'}</span></div>
      <div class="ctl-grid">
        <div class="ctl-power">
          <button class="pwr ${isOn ? 'on' : ''} ${pend('hvac_mode') ? 'pending' : ''}" data-act="power" ${H.controls ? '' : 'disabled'} aria-pressed="${isOn}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M7 6.3a8 8 0 1 0 10 0"/></svg><span>${isOn ? 'På' : 'Av'}</span></button>
        </div>
        <div class="ctl-temp ${isOn ? '' : 'dim'}">
          <div class="eyebrow">Måltemperatur</div>
          <div class="tempbox">
            <button data-act="temp" data-dir="-1" ${H.controls ? '' : 'disabled'} aria-label="Sänk">−</button>
            <div class="tval ${tempDraft != null || pend('temperature') ? 'pending' : ''}">${nf(set, 1)}<small>°C</small></div>
            <button data-act="temp" data-dir="1" ${H.controls ? '' : 'disabled'} aria-label="Höj">+</button>
          </div>
          <div class="hint">${C('min_temp') ?? 10}–${C('max_temp') ?? 30} °C · steg ${nf(C('target_temp_step') || 0.5, 1)}</div>
        </div>
        <div class="ctl-rows">
          <div class="crow"><span class="eyebrow">Läge</span>${seg(modes, mode, 'hvac_mode', 'modes')}</div>
          <div class="crow"><span class="eyebrow">Fläkt</span>${seg((C('fan_modes') || []).map(f => [f, fanLbl(f)]), C('fan_mode'), 'fan_mode')}</div>
          <div class="crow"><span class="eyebrow">Luftriktning</span>${seg((C('swing_modes') || []).map(f => [f, SWING[f] || f]), C('swing_mode'), 'swing_mode')}</div>
          <div class="crow"><span class="eyebrow">Specialläge</span>${seg((C('preset_modes') || []).map(f => [f, PRESET[f] || f]), C('preset_mode'), 'preset_mode')}</div>
        </div>
      </div>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'temp') return bumpTemp(+b.dataset.dir);
    if (act === 'power') {
      const s = st(H.climate); if (!s) return;
      const isOn = (pend('hvac_mode') ? pend('hvac_mode').value : s.state) !== 'off';
      if (isOn && !confirm('Stänga av luftvärmepumpen?')) return;
      const back = (() => { try { return localStorage.getItem('obs-hp-last-mode'); } catch { return null; } })();
      return send('hvac_mode', isOn ? 'off' : ((C('hvac_modes') || []).includes(back) ? back : 'heat'));
    }
    if (act === 'toggle') return send('toggle', b.getAttribute('aria-pressed') !== 'true', b.dataset.ent);
    if (act === 'select') return send('select', b.dataset.val, b.dataset.ent);
    send(act, b.dataset.val);
  });

  // ---------- Energi, kostnad, smart styrning ----------
  function renderEnergy() {
    const row = (lbl, h, c) => `<div class="erow"><span class="ul">${lbl}</span><b>${nf(num(h), 1)}<small>kWh</small></b><b class="cool">${nf(num(c), 1)}<small>kWh</small></b></div>`;
    $('energy').innerHTML = `<div class="eyebrow">Energi enligt Daikin</div><h3>${nf(num(H.heat_year), 0)} kWh värme i år</h3>
      <div class="erow head"><span></span><span>Värme</span><span>Kyla</span></div>
      ${row('Idag', H.heat_day, H.cool_day)}${row('Veckan', H.heat_week, H.cool_week)}${row('Månaden', H.heat_month, H.cool_month)}${row('Året', H.heat_year, H.cool_year)}
      <div class="kvs two"><div class="kv"><span>Elmätare (Shelly) totalt</span><b>${nf(num(H.energy_total), 0)}<small>kWh</small></b></div>
      <div class="kv"><span>Ström nu</span><b>${nf(num(H.current), 2)}<small>A</small></b></div></div>`;
  }
  function renderCost() {
    const today = num(H.cost_today), month = num(H.cost_month), kwh = num(H.heat_day);
    const d = new Date(), dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const proj = month != null ? month / (d.getDate() - 1 + (d.getHours() * 60 + d.getMinutes()) / 1440) * dim : null;
    $('cost').innerHTML = `<div class="eyebrow">Kostnad</div><h3>${nf(today, 2)} kr idag</h3>
      <div class="kvs">
        <div class="kv"><span>Denna månad</span><b>${nf(month, 2)}<small>kr</small></b></div>
        <div class="kv"><span>Prognos månaden</span><b>${nf(proj, 0)}<small>kr</small></b></div>
        <div class="kv"><span>Kostar just nu</span><b>${nf(num(H.cost_rate), 2)}<small>kr/h</small></b></div>
        <div class="kv"><span>Snitt idag</span><b>${today != null && kwh ? nf(today / kwh * 100, 0) : '–'}<small>öre/kWh</small></b></div>
        <div class="kv"><span>Totalt sedan start</span><b>${nf(num(H.cost_total), 0)}<small>kr</small></b></div>
        <div class="kv"><span>Pristopp nu</span><b>${on(H.price_peak) == null ? '–' : on(H.price_peak) ? 'Ja' : 'Nej'}</b></div>
      </div>`;
  }
  function toggleBtn(id) {
    const p = pend('toggle', id), v = p ? p.value : on(id);
    return `<button class="tgl ${v ? 'on' : ''} ${p ? 'pending' : ''}" data-act="toggle" data-ent="${id}" aria-pressed="${!!v}" ${H.controls ? '' : 'disabled'}><i></i>${v ? 'På' : 'Av'}</button>`;
  }
  function selectRow(lbl, id, activeNow) {
    const s = st(id); if (!s) return '';
    const p = pend('select', id), cur = p ? p.value : s.state;
    return `<div class="srow sel ${activeNow ? 'now' : ''}"><span>${lbl}${activeNow ? ' <em>nu</em>' : ''}</span><div class="ctl-seg mini">${(s.attributes.options || []).map(o =>
      `<button data-act="select" data-ent="${id}" data-val="${esc(o)}" aria-pressed="${cur === o}" class="${p && p.value === o ? 'pending' : ''}" ${H.controls ? '' : 'disabled'}>${esc(fanLbl(o))}</button>`).join('')}</div></div>`;
  }
  function renderSmart() {
    const F = H.fan_schedule || {}, P = H.peak || {};
    const meal = on(F.meal_schedule), night = on(F.night_schedule);
    const period = meal ? 'meal' : night ? 'night' : 'day';
    const next = s => { const x = st(s); return x && x.attributes.next_event ? when(x.attributes.next_event) : '–'; };
    $('smart').innerHTML = `<div class="eyebrow">Smart styrning</div><h3>Schema och pristopp</h3>
      <div class="sline"><b>Fläktschema</b>${toggleBtn(F.active)}</div>
      ${selectRow('Dag', F.day, period === 'day')}${selectRow('Måltid', F.meal, period === 'meal')}${selectRow('Natt', F.night, period === 'night')}
      <div class="srow"><span>Måltider</span><b>${meal ? 'Pågår' : 'Nej'} · nästa ändring ${next(F.meal_schedule)}</b></div>
      <div class="srow"><span>Natt</span><b>${night ? 'Pågår' : 'Nej'} · nästa ändring ${next(F.night_schedule)}</b></div>
      <div class="sline"><b>Sänk vid pristopp</b>${toggleBtn(P.active)}</div>
      <div class="srow"><span>Pristopp nu</span><b>${on(H.price_peak) ? '<span class="chip warn">Ja</span>' : '<span class="chip">Nej</span>'}</b></div>
      <div class="srow"><span>Tröskel</span><b>${nf(num(P.threshold), 0)}<small>% över dagssnitt</small></b></div>
      <div class="srow"><span>Sänkning</span><b>${nf(num(P.drop), 1)}<small>°C</small></b></div>
      <div class="srow"><span>Sänkt just nu</span><b>${on(P.lowered) ? `Ja, från ${nf(num(P.ordinary), 1)} °C` : 'Nej'}</b></div>
      <div class="srow"><span>Daikins eget schema</span><b>${esc(st(H.daikin_schedule) ? (st(H.daikin_schedule).state === 'off' ? 'Av' : st(H.daikin_schedule).state) : '–')}</b></div>`;
  }
  function renderHealth() {
    const flags = Object.entries(H.health || {});
    const anyBad = flags.some(([, id]) => on(id));
    const codes = Object.entries(H.error_codes || {});
    const bin = (id, yes, no, warn) => { const v = on(id); return v == null ? '<span class="chip">okänt</span>' : `<span class="chip ${v ? (warn ? 'alarm' : 'on') : ''}">${v ? yes : no}</span>`; };
    const val = (id, d) => { const s = st(id); if (bad(s)) return '–'; const n = parseFloat(s.state); return Number.isFinite(n) ? `${nf(n, d)}<small>${esc(unit(id))}</small>` : esc(s.state); };
    $('health').innerHTML = `<div class="wh"><div><div class="eyebrow">Hälsa och diagnostik</div><h3>${anyBad ? 'Daikin rapporterar ett problem' : 'Inga fel rapporterade'}</h3></div>
        <span class="chip ${anyBad ? 'alarm' : 'on'}">${anyBad ? 'Kontrollera' : 'Allt ok'}</span></div>
      <div class="sgroups">
        <div class="sgroup"><div class="eyebrow">Daikin</div>
          ${codes.map(([l, id]) => `<div class="srow"><span>Felkod ${esc(l.toLowerCase())}</span><b>${st(id) && !bad(st(id)) ? esc(st(id).state) : '–'}</b></div>`).join('')}
          ${flags.map(([l, id]) => `<div class="srow"><span>${esc(l)}</span><b>${bin(id, 'Ja', 'Nej', true)}</b></div>`).join('')}</div>
        <div class="sgroup"><div class="eyebrow">Lägen och moln</div>
          <div class="srow"><span>Kraftfullt läge</span><b>${bin(H.powerful, 'På', 'Av')}</b></div>
          <div class="srow"><span>Semesterläge</span><b>${bin(H.holiday, 'På', 'Av')}</b></div>
          <div class="srow"><span>Daikin-anrop kvar idag</span><b>${val(H.api_calls, 0)}</b></div>
          <div class="srow"><span>Utetemperatur (Daikin)</span><b>${val(H.outdoor, 1)}</b></div></div>
        <div class="sgroup"><div class="eyebrow">Elmätare (Shelly)</div>
          <div class="srow"><span>Effekt</span><b>${val(H.power, 0)}</b></div>
          <div class="srow"><span>Ström</span><b>${val(H.current, 2)}</b></div>
          <div class="srow"><span>Nätfrekvens</span><b>${val(H.frequency, 2)}</b></div>
          <div class="srow"><span>Wifi-signal</span><b>${val(H.rssi, 0)}</b></div>
          <div class="srow"><span>Shelly-molnet</span><b>${bin(H.shelly_cloud, 'Ansluten', 'Frånkopplad')}</b></div></div>
      </div>`;
  }
  function renderTimers() {
    const rows = Object.entries(H.timers || {}).map(([lbl, id]) => {
      const s = st(id); if (!s) return '';
      const act = s.state === 'active', fin = s.attributes.finishes_at;
      const left = act && fin ? Math.max(0, Math.round((Date.parse(fin) - Date.now()) / 60000)) : null;
      return `<div class="srow"><span>${esc(lbl)}</span><b>${act ? `<span class="chip on">${left} min kvar</span>` : s.state === 'paused' ? '<span class="chip">Pausad</span>' : '<span class="chip">Vilar</span>'}</b></div>`;
    }).join('');
    const room = num(H.room) ?? C('current_temperature'), set = C('temperature');
    $('timers').innerHTML = `<div class="eyebrow">Timers och läge</div><h3>${room != null && set != null ? (room >= set ? `${nf(room - set, 1)} °C över målet` : `${nf(set - room, 1)} °C under målet`) : '–'}</h3>
      ${rows}
      <div class="srow"><span>Börvärde</span><b>${nf(set, 1)}<small>°C</small></b></div>
      <div class="srow"><span>Rumsgivare (Daikin)</span><b>${nf(room, 1)}<small>°C</small></b></div>
      <div class="srow"><span>Läge</span><b>${esc(MODE[st(H.climate) && st(H.climate).state] || '–')}</b></div>
      <div class="srow"><span>Fläkt</span><b>${esc(fanLbl(C('fan_mode') || '–'))}</b></div>`;
  }

  // ---------- Grafer ----------
  async function hist(id, hours) {
    const r = await fetch(`api/history?entity=${encodeURIComponent(id)}&hours=${hours}`, { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return (await r.json()).points.map(([t, v]) => [typeof t === 'string' ? Date.parse(t) : t, v]);
  }
  async function daily(id, stat) {
    const r = await fetch(`api/daily?entity=${encodeURIComponent(id)}&days=14&stat=${stat}`, { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return (await r.json()).points.map(([t, v]) => [typeof t === 'string' ? Date.parse(t) : t, v]);
  }
  function axes(Wd, Hh, pl, pr, pt, pb, lo, hi, x, y, t0, t1, stepH) {
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4;
      g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, hi - lo < 5 ? 1 : 0)}</text>`; }
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t <= t1; t += 3600e3) { const h = new Date(t).getHours();
      if (h === 0) g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${Hh - pb}"/>`;
      if (h % stepH) continue; g += `<text class="ax" x="${x(t)}" y="${Hh - 5}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`; }
    return g;
  }
  function multiLine(series, opt = {}) {
    const all = series.flatMap(s => s.points);
    if (!all.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 440, Hh = 170, pl = 34, pr = 6, pt = 8, pb = 20;
    const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(Date.now(), ...all.map(p => p[0]));
    const vals = all.map(p => p[1] / (opt.div || 1)).concat((opt.marks || []).map(m => m[0]));
    let lo = opt.zero ? 0 : Math.min(...vals), hi = Math.max(...vals);
    if (hi === lo) hi = lo + 1; const pad = (hi - lo) * .08; if (!opt.zero) lo -= pad; hi += pad;
    const x = t => pl + (t - t0) / (t1 - t0 || 1) * (Wd - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (Hh - pt - pb);
    let g = axes(Wd, Hh, pl, pr, pt, pb, lo, hi, x, y, t0, t1, 6);
    for (const [v, lbl] of opt.marks || []) g += `<line class="mk" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax mkt" x="${Wd - pr - 2}" y="${y(v) - 3}" text-anchor="end">${lbl}</text>`;
    const paths = series.map((s, k) => {
      const p = s.points.map(([t, v]) => [t, v / (opt.div || 1)]); if (!p.length) return '';
      let d = ''; p.forEach(([t, v], i) => { if (opt.step && i) d += `L${x(t).toFixed(1)},${y(p[i - 1][1]).toFixed(1)}`; d += `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`; });
      const base = y(Math.max(lo, 0));
      return (k === 0 ? `<path class="ar" fill="${s.color}" d="${d}L${x(p[p.length - 1][0])},${base}L${x(p[0][0])},${base}Z"/>` : '') + `<path class="ln${s.dash ? ' dash' : ''}" stroke="${s.color}" d="${d}"/>`;
    }).join('');
    const legend = series.length > 1 ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color};height:3px"></i>${esc(s.label)}</span>`).join('')}</div>` : '';
    return `<svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none">${g}${paths}</svg>${legend}`;
  }
  function barsWithLine(bars, line) {
    if (!bars.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 440, Hh = 170, pl = 30, pr = 30, pt = 14, pb = 20;
    const hi = Math.max(...bars.map(p => p[1] || 0)) * 1.12 || 1, n = bars.length, bw = (Wd - pl - pr) / n;
    const y = v => pt + (hi - v) / hi * (Hh - pt - pb);
    const lv = line.map(p => p[1]); const llo = Math.min(...lv, 0) - 2, lhi = Math.max(...lv, 10) + 2;
    const y2 = v => pt + (lhi - v) / (lhi - llo) * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 3; i++) { const v = hi * i / 3; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`;
      const v2 = llo + (lhi - llo) * i / 3; g += `<text class="ax t2" x="${Wd - pr + 5}" y="${y2(v2) + 3}">${nf(v2, 0)}°</text>`; }
    const day = t => new Date(t).toDateString();
    const cx = {};
    bars.forEach(([t, v], i) => {
      const xx = pl + i * bw + bw * .15, w = bw * .7; cx[day(t)] = xx + w / 2;
      g += `<rect class="bar${i === n - 1 ? ' cur' : ''}" fill="${TC('orange')}" x="${xx}" y="${y(v || 0)}" width="${w}" height="${Math.max(0, y(0) - y(v || 0))}"><title>${new Date(t).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}: ${nf(v, 1)} kWh</title></rect>`;
      g += `<text class="ax" x="${xx + w / 2}" y="${Hh - 6}" text-anchor="middle">${new Date(t).getDate()}</text>`;
    });
    const lp = line.filter(([t]) => cx[day(t)] != null).map(([t, v]) => [cx[day(t)], y2(v)]);
    if (lp.length) g += `<path class="ln" stroke="${TC('blue')}" d="${lp.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('')}"/>` + lp.map(([a, b]) => `<circle cx="${a}" cy="${b}" r="2.2" fill="${TC('blue')}"/>`).join('');
    return `<svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none">${g}</svg><div class="legend"><span><i style="background:${TC('orange')}"></i>kWh per dag</span><span><i style="background:${TC('blue')};height:3px"></i>Utetemperatur, dygnsmedel</span></div>`;
  }
  async function loadCharts() {
    const box = (id, title, u) => { $(id).innerHTML = `<div class="eyebrow">${title} <span style="float:right">${u}</span></div><div class="dchart flat"><div class="empty">Hämtar …</div></div>`; return $(id).querySelector('.dchart'); };
    const fail = (el, e) => { el.innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; };
    const t = box('temp-chart', 'Inne och ute · 48 h', '°C'), p = box('power-chart', 'Effekt · 48 h', 'W'), d = box('daily-chart', 'Energi och utetemperatur · 14 dagar', 'kWh');
    Promise.all([hist(H.room, 48), hist(H.outdoor, 48).catch(() => [])]).then(([r, o]) => {
      const set = C('temperature');
      t.innerHTML = multiLine([{ label: 'Inne', color: TC('orange'), points: r }, { label: 'Ute', color: TC('blue'), points: o }], { marks: set != null && st(H.climate).state !== 'off' ? [[set, 'börvärde']] : [] });
    }).catch(e => fail(t, e));
    hist(H.power, 48).then(pts => { p.innerHTML = multiLine([{ label: 'Effekt', color: TC('gold'), points: pts }], { zero: true }); }).catch(e => fail(p, e));
    Promise.all([daily(H.energy_total, 'change'), daily(H.outdoor, 'mean').catch(() => [])]).then(([b, l]) => { d.innerHTML = barsWithLine(b, l); }).catch(e => fail(d, e));
  }

  // ---------- Rendering ----------
  let queued = false;
  function render() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      clearPending();
      const live = connected && !bad(states[H.climate]);
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      const s = st(H.climate); if (s && s.state !== 'off') { try { localStorage.setItem('obs-hp-last-mode', s.state); } catch {} }
      for (const f of [renderHero, renderControl, renderEnergy, renderCost, renderSmart, renderHealth, renderTimers]) {
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
    H = await fetch('api/heatpump', { cache: 'no-store' }).then(r => r.json());
    if (H.title) $('title').textContent = H.title;
    if (H.subtitle) $('subtitle').textContent = H.subtitle;
    const es = new EventSource('api/stream');
    let charts = false;
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; render(); if (!charts) { charts = true; loadCharts(); } });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; render(); });
    es.onerror = () => { connected = false; render(); };
    setInterval(loadCharts, 5 * 60 * 1000);
    setInterval(render, 30000);
  }
  start().catch(e => { $('subtitle').textContent = 'Kunde inte starta: ' + e.message; });
  console.info('observatory heat pump view', VERSION);
})();
