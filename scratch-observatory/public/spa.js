// Spabad-sidan: vattentemperatur, värme, filter, bubblor, filterpass på billigaste elen, energi och styrning.
// Styrningen går via servern, som bara släpper igenom vitlistade brytare, termostaten och passlängden.
(() => {
  'use strict';
  // Temafärg från CSS-variabel (temat sätts av theme.js)
  const TC = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const VERSION = '0.13.0';
  const $ = id => document.getElementById(id);
  let S = {}, states = {}, connected = false;

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
  const hm = t => t == null ? '–' : new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  function ago(t) {
    if (!t) return '–';
    const m = Math.round((Date.now() - Date.parse(t)) / 60000);
    if (m < 1) return 'nyss'; if (m < 60) return `${m} min sedan`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h sedan`;
    const d = Math.round(h / 24); return d < 60 ? `${d} d sedan` : new Date(t).toLocaleDateString('sv-SE');
  }
  const dur = h => h == null ? '–' : h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;
  const kv = (k, v, u = '', cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}${u ? `<small>${u}</small>` : ''}</b></div>`;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
  const tsOf = t => typeof t === 'string' ? Date.parse(t) : t;
  const cl = () => st(S.climate);
  const water = () => num(S.climate, 'current_temperature');
  const target = () => num(S.climate, 'temperature');
  const heatOn = () => { const c = cl(); return c && !bad(c) ? c.state === 'heat' : null; };
  const heating = () => { const c = cl(); return !!(c && c.attributes.hvac_action === 'heating'); };
  function outdoor() { const id = S.outdoor; return id && id.startsWith('weather.') ? num(id, 'temperature') : num(id); }

  // ---------- Styrning ----------
  const pending = {};
  async function send(action, value, entity) {
    if (!S.controls) return;
    pending[action + '|' + entity] = { value, until: Date.now() + 20000 };
    render();
    try {
      const r = await fetch('api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, value, entity }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
    } catch (e) { delete pending[action + '|' + entity]; render(); toast('Gick inte: ' + e.message); }
  }
  const pend = (action, entity) => { const p = pending[action + '|' + entity]; return p && Date.now() < p.until ? p : null; };
  function clearPending() {
    for (const [k, p] of Object.entries(pending)) {
      if (Date.now() > p.until) { delete pending[k]; continue; }
      const [a, id] = k.split('|');
      if (a === 'toggle' && on(id) === p.value) delete pending[k];
      if (a === 'number' && num(id) === p.value) delete pending[k];
      if (a === 'climate_mode' && cl() && cl().state === p.value) delete pending[k];
      if (a === 'climate_temp' && target() === p.value) delete pending[k];
    }
  }
  // −/+ med fördröjning, så att flera tryck blir ett kommando
  const drafts = {}, timers = {};
  function bump(kind, dir) {
    let ent, lo, hi, step, cur, action;
    if (kind === 'temp') {
      const c = cl(); if (!c) return;
      ent = S.climate; action = 'climate_temp';
      lo = +c.attributes.min_temp; hi = +c.attributes.max_temp; step = +c.attributes.target_temp_step || 1; cur = target();
    } else {
      const s = st(S.pass_length); if (!s) return;
      ent = S.pass_length; action = 'number';
      lo = +s.attributes.min; hi = +s.attributes.max; step = +s.attributes.step || 15; cur = num(S.pass_length);
    }
    const p = pend(action, ent);
    const base = drafts[kind] ?? (p ? p.value : cur);
    if (base == null) return;
    drafts[kind] = Math.max(lo, Math.min(hi, Math.round((base + dir * step) / step) * step));
    render();
    clearTimeout(timers[kind]);
    timers[kind] = setTimeout(() => { const v = drafts[kind]; delete drafts[kind]; send(action, v, ent); }, 1200);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'bump') return bump(b.dataset.kind, +b.dataset.dir);
    if (act === 'heat') return send('climate_mode', b.getAttribute('aria-pressed') === 'true' ? 'off' : 'heat', S.climate);
    if (act === 'toggle') {
      const v = b.getAttribute('aria-pressed') !== 'true';
      if (b.dataset.ent === S.power_switch && !v && !confirm('Stänga av spabadet? Då stannar värme, filter och bubblor.')) return;
      return send('toggle', v, b.dataset.ent);
    }
  });
  const tgVal = id => { const p = pend('toggle', id); return p ? p.value : on(id); };

  // ---------- Uppvärmning: tid, energi och kostnad ----------
  function heatPlan() {
    const w = water(), t = target();
    if (w == null || t == null) return null;
    const dT = Math.max(0, t - w);
    const kwh = (S.volume_l || 937) * 4.186 * dT / 3600;           // vattnets värmekapacitet
    const rate = rateMeasured ?? (S.heat_rate || 2);                // °C per timme
    const hours = dT / rate;
    const price = num(S.price);
    const elec = Math.max(kwh, hours * (S.heater_kw || 2.2) * 0.98); // värmaren drar ungefär sin märkeffekt hela tiden
    return { dT, kwh, elec, hours, rate, eta: Date.now() + hours * 3600e3, cost: price != null ? elec * price : null };
  }

  // ---------- Hero ----------
  function tubSvg() {
    const w = water(), bub = tgVal(S.bubbles), filt = tgVal(S.filter), hot = heating();
    const tint = w == null ? '#3c5556' : w >= 35 ? '#5a8f9a' : w >= 25 ? '#4d7f8a' : w >= 12 ? '#3f6b78' : '#35586a';
    const bubbles = bub ? Array.from({ length: 14 }, (_, i) => {
      const x = 70 + (i * 37) % 160, d = (1.2 + (i % 5) * 0.35).toFixed(2), dl = ((i * 0.27) % 1.6).toFixed(2), r = 2 + (i % 3);
      return `<circle class="bub" cx="${x}" cy="104" r="${r}" style="animation-duration:${d}s;animation-delay:-${dl}s"/>`;
    }).join('') : '';
    const steam = hot || (w != null && w >= 30) ? [110, 150, 190].map((x, i) => `<path class="steam" d="M${x},62 q-8,-12 0,-24 q8,-12 0,-24" style="animation-delay:-${i * 0.9}s"/>`).join('') : '';
    return `<svg viewBox="0 0 300 170" class="tubsvg" role="img" aria-label="Spabadet">
      ${steam}
      <ellipse cx="150" cy="138" rx="128" ry="26" class="tubside"/>
      <rect x="22" y="86" width="256" height="52" class="tubside"/>
      <ellipse cx="150" cy="86" rx="128" ry="26" class="tubrim"/>
      <ellipse cx="150" cy="90" rx="112" ry="19" fill="${tint}" class="water ${filt ? 'flow' : ''}"/>
      <g clip-path="url(#wclip)">${bubbles}</g>
      <defs><clipPath id="wclip"><ellipse cx="150" cy="90" rx="112" ry="19"/></clipPath></defs>
      ${[50, 100, 150, 200, 250].map(x => `<line x1="${x}" y1="${x === 150 ? 112 : 108}" x2="${x}" y2="${x === 150 ? 164 : 160}" class="rib"/>`).join('')}
      <text x="150" y="96" text-anchor="middle" class="wt">${w == null ? '–' : nf(w, 0) + '°'}</text>
    </svg>`;
  }
  function renderHero() {
    const w = water(), t = target(), hOn = heatOn(), hot = heating(), power = on(S.power_switch);
    const conn = on(S.connected), errS = st(S.errors), errs = errS && Array.isArray(errS.attributes.errors) ? errS.attributes.errors : [];
    const plan = heatPlan();
    const label = conn === false ? 'Inte uppkopplad' : power === false ? 'Avstängt' : hot ? 'Värmer' : hOn && plan && plan.dT <= 0 ? 'Måltemperatur nådd' : hOn ? 'Värme på, väntar' : 'Värmen är av';
    $('hero').innerHTML = `
      <div class="tubw">${tubSvg()}</div>
      <div class="hmain">
        <div class="eyebrow">Vattentemperatur</div>
        <div class="hbig">${nf(w, 0)}<small>°C</small></div>
        <div class="hsub">${hOn ? `Mål ${nf(t, 0)} °C${plan && plan.dT > 0 ? ` · ${nf(plan.dT, 0)} grader kvar, klart ungefär ${hm(plan.eta)}` : ''}` : `Mål ${nf(t, 0)} °C när värmen slås på`}</div>
        <div class="hstatus ${hot ? 'heat' : hOn ? 'spaw' : ''}"><i></i>${label}</div>
        <div class="hchips">
          ${tgVal(S.filter) ? '<span class="chip on">Filter går</span>' : '<span class="chip">Filter vilar</span>'}
          ${tgVal(S.bubbles) ? '<span class="chip info">Bubblor på</span>' : ''}
          ${on(S.cheap) ? '<span class="chip on">Billig filtertid nu</span>' : ''}
          ${tgVal(S.locked) ? '<span class="chip">Panelen låst</span>' : ''}
          ${errs.length ? `<span class="chip warn">Fel: ${esc(errs.join(', '))}</span>` : on(S.errors) ? '<span class="chip warn">Fel rapporterat</span>' : ''}
          ${conn === false ? '<span class="chip warn">Wi-Fi nere</span>' : ''}
        </div>
      </div>
      <div class="hside">
        ${kv('Mål', nf(t, 0), '°C', 'heat')}
        ${kv('Ute', nf(outdoor()), '°C')}
        ${kv('Effekt', num(S.power) == null ? '–' : Math.round(num(S.power)), 'W')}
        ${kv('El idag', nf(num(S.energy_today), 2), 'kWh')}
        ${kv('Drifttid idag', dur(num(S.runtime_today)))}
        ${kv('Uttaget', on(S.plug) === false ? 'Av' : on(S.plug) ? 'På' : '–')}
      </div>`;
  }

  // ---------- Styrning ----------
  function tgl(id, lbl, hint) {
    const p = pend('toggle', id), v = p ? p.value : on(id);
    return `<div class="ftg"><div><b>${lbl}</b><span>${hint}</span></div>
      <button class="tgl ${v ? 'on' : ''} ${p ? 'pending' : ''}" data-act="toggle" data-ent="${id}" aria-pressed="${!!v}" ${S.controls && st(id) ? '' : 'disabled'}><i></i>${v ? 'På' : 'Av'}</button></div>`;
  }
  function renderControl() {
    const c = cl(), pT = pend('climate_temp', S.climate), pM = pend('climate_mode', S.climate);
    const tv = drafts.temp ?? (pT ? pT.value : target());
    const hOn = pM ? pM.value === 'heat' : heatOn();
    const pP = pend('toggle', S.power_switch), pOn = pP ? pP.value : on(S.power_switch);
    const ok = S.controls && c && !bad(c);
    $('control').innerHTML = `<div class="wh"><div><div class="eyebrow">Styrning</div><h3>${pOn === false ? 'Spabadet är avstängt' : hOn ? 'Värmen är på' : 'Värmen är av'}</h3></div>
        ${S.controls ? '' : '<span class="chip">Styrning avstängd i config</span>'}</div>
      <div class="spa-ctl">
        <button class="pwr ${pOn ? 'on' : ''} ${pP ? 'pending' : ''}" data-act="toggle" data-ent="${S.power_switch}" aria-pressed="${!!pOn}" ${S.controls && st(S.power_switch) ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M7 6.3a8 8 0 1 0 10 0"/></svg><span>${pOn ? 'På' : 'Av'}</span></button>
        <div class="ctl-temp ${c ? '' : 'dim'}">
          <div class="eyebrow" style="text-align:center">Måltemperatur</div>
          <div class="tempbox">
            <button data-act="bump" data-kind="temp" data-dir="-1" ${ok ? '' : 'disabled'} aria-label="Sänk">−</button>
            <div class="tval ${pT || drafts.temp != null ? 'pending' : ''}">${nf(tv, 0)}<small>°C</small></div>
            <button data-act="bump" data-kind="temp" data-dir="1" ${ok ? '' : 'disabled'} aria-label="Höj">+</button>
          </div>
          <div class="hint">${c ? `${nf(+c.attributes.min_temp, 0)}–${nf(+c.attributes.max_temp, 0)} °C` : ''}</div>
          <button class="heatbtn ${hOn ? 'on' : ''} ${pM ? 'pending' : ''}" data-act="heat" aria-pressed="${!!hOn}" ${ok ? '' : 'disabled'}>${hOn ? 'Värme på' : 'Värme av'}</button>
        </div>
        <div class="ftgs">
          ${tgl(S.filter, 'Filter', 'Styrs annars av automationen: billigaste passen, när värmen är på och efter bubblor')}
          ${tgl(S.bubbles, 'Bubblor', 'Luftbubblor i badet')}
          ${tgl(S.locked, 'Panellås', 'Låser knapparna på badets panel')}
        </div>
      </div>
      <p class="so-note">Automationen stänger av spabadets värme när kaffebryggaren startar, så att säkringen håller.</p>`;
  }

  // ---------- Uppvärmning ----------
  let rateMeasured = null;
  function renderHeat() {
    const p = heatPlan(), hOn = heatOn();
    if (!p) { $('heat').innerHTML = '<div class="eyebrow">Uppvärmning</div><div class="empty">Ingen temperatur från badet.</div>'; return; }
    $('heat').innerHTML = `<div class="eyebrow">Uppvärmning</div>
      <h3>${p.dT <= 0 ? 'Badet är varmt' : `${dur(p.hours)} till ${nf(target(), 0)} °C`}</h3>
      <div class="kvs">
        ${kv('Grader kvar', nf(p.dT, 0), '°C')}
        ${kv('Klart', p.dT <= 0 ? 'nu' : hOn ? hm(p.eta) : 'när värmen slås på')}
        ${kv('El som går åt', nf(p.elec, 1), 'kWh')}
        ${kv('Kostar ungefär', nf(p.cost, 0), 'kr')}
      </div>
      <p class="so-note">${nf(S.volume_l || 937, 0)} liter vatten och en värmare på ${nf(S.heater_kw || 2.2, 1)} kW. Räknat på ${nf(p.rate, 1)} °C i timmen${rateMeasured != null ? ', uppmätt från de senaste dygnens uppvärmning' : ''} och elpriset just nu, ${nf(num(S.price), 2)} kr/kWh.</p>`;
  }

  // ---------- Filterpass på billigaste elen ----------
  function passes() {
    const s = st(S.price), arr = s && Array.isArray(s.attributes.today) ? s.attributes.today.map(Number) : [];
    if (!arr.length) return { arr, slot: 60, picks: [] };
    const slot = 1440 / arr.length;
    const len = num(S.pass_length) ?? 90, n = Math.max(1, Math.round(len / slot));
    const half = Math.floor(arr.length / 2), picks = [];
    if (arr.length >= 2 * n) for (const [lo, hi] of [[0, half], [half, arr.length]]) {
      let bi = lo, bs = Infinity;
      for (let i = lo; i <= hi - n; i++) { let sum = 0; for (let k = 0; k < n; k++) sum += arr[i + k]; if (sum < bs) { bs = sum; bi = i; } }
      picks.push({ i: bi, n, avg: bs / n });
    }
    return { arr, slot, picks };
  }
  function renderFilter() {
    const { arr, slot, picks } = passes();
    const pl = st(S.pass_length), pP = pend('number', S.pass_length), len = drafts.pass ?? (pP ? pP.value : num(S.pass_length));
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const at = i => midnight.getTime() + i * slot * 60e3;
    let chart = '<div class="empty">Inga elpriser.</div>';
    if (arr.length) {
      const Wd = 760, Hh = 120, max = Math.max(...arr, 0.01), bw = Wd / arr.length;
      const inPick = i => picks.some(p => i >= p.i && i < p.i + p.n);
      const nowI = ((Date.now() - midnight.getTime()) / 60e3) / slot;
      chart = `<svg viewBox="0 0 ${Wd} ${Hh + 16}" preserveAspectRatio="none" class="passsvg">
        ${arr.map((v, i) => `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(Hh - v / max * (Hh - 6)).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${(v / max * (Hh - 6)).toFixed(1)}" class="${inPick(i) ? 'pk' : ''}"/>`).join('')}
        <line x1="${nowI * bw}" x2="${nowI * bw}" y1="0" y2="${Hh}" class="now"/>
        ${[0, 6, 12, 18, 24].map(h => `<text x="${Math.min(Wd - 8, Math.max(8, h / 24 * Wd))}" y="${Hh + 13}" text-anchor="middle" class="ax">${String(h).padStart(2, '0')}</text>`).join('')}
      </svg>`;
    }
    const list = picks.map(p => {
      const s = at(p.i), e = at(p.i + p.n), now = Date.now(), cur = now >= s && now < e;
      return `<div class="srow"><span>${hm(s)}–${hm(e)}${cur ? ' <em class="hum">pågår</em>' : now >= e ? ' <em class="mutd">klart</em>' : ''}</span><b>${nf(p.avg, 2)}<small>kr/kWh</small></b></div>`;
    }).join('');
    const auto = st((S.automations || [])[0]);
    $('filter').innerHTML = `<div class="wh"><div><div class="eyebrow">Filterpass på billigaste elen</div><h3>${on(S.cheap) ? 'Filtret har billig tid nu' : picks.length ? 'Två pass idag' : 'Reservtider 04:00 och 14:00'}</h3></div>
        <div class="ctl-temp small"><div class="eyebrow">Passlängd</div><div class="tempbox">
          <button data-act="bump" data-kind="pass" data-dir="-1" ${S.controls && pl ? '' : 'disabled'} aria-label="Kortare">−</button>
          <div class="tval ${pP || drafts.pass != null ? 'pending' : ''}">${nf(len, 0)}<small>min</small></div>
          <button data-act="bump" data-kind="pass" data-dir="1" ${S.controls && pl ? '' : 'disabled'} aria-label="Längre">+</button></div></div></div>
      ${chart}
      <div class="pass-list">${list}</div>
      <p class="so-note">Det billigaste sammanhängande passet före och efter klockan 12 enligt Nord Pool, samma räkning som Home Assistant gör. Filtret går också när värmen är på, en timme efter bubblor och om vattnet är under 6 °C.${auto ? ` Automationen kördes senast ${ago(auto.attributes.last_triggered)}.` : ''}</p>`;
  }

  // ---------- Energi ----------
  let daily = [], monthly = [];
  function renderEnergy() {
    const w = num(S.power);
    const avg = daily.length ? daily.reduce((a, p) => a + (p[1] || 0), 0) / daily.length : null;
    const max = Math.max(0.01, ...daily.map(p => p[1] || 0));
    const lastM = num(S.energy_month, 'last_period');
    $('energy').innerHTML = `<div class="eyebrow">El</div><h3>${w == null ? '–' : Math.round(w)} W just nu</h3>
      <div class="kvs">${kv('Idag', nf(num(S.energy_today), 2), 'kWh')}${kv('Veckan', nf(num(S.energy_week), 1), 'kWh')}${kv('Månaden', nf(num(S.energy_month), 1), 'kWh')}${kv('Förra månaden', nf(lastM, 1), 'kWh')}</div>
      ${daily.length ? `<div class="mini-bars" title="kWh per dag, 30 dagar">${daily.map(([t, v]) => `<span style="height:${Math.max(3, (v || 0) / max * 100)}%" title="${new Date(t).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}: ${nf(v, 2)} kWh"></span>`).join('')}</div>
      <p class="so-note">30 dagar, snitt ${nf(avg, 2)} kWh per dag. Med ett elpris på ${nf(num(S.price), 2)} kr blir det ungefär ${nf(avg * 30 * (num(S.price) || 0), 0)} kr i månaden.</p>` : ''}`;
  }
  function renderMonths() {
    if (!monthly.length) { $('months').innerHTML = '<div class="eyebrow">Per månad</div><div class="empty">Hämtar …</div>'; return; }
    const max = Math.max(0.01, ...monthly.map(p => p[1] || 0));
    $('months').innerHTML = `<div class="eyebrow">Per månad · kWh</div><h3>${nf(monthly.reduce((a, p) => a + (p[1] || 0), 0), 0)} kWh på ${monthly.length} månader</h3>
      <div class="spa-mbars">${monthly.map(([t, v]) => `<div><span style="height:${Math.max(2, (v || 0) / max * 100)}%" title="${nf(v, 1)} kWh"></span><b>${nf(v, 0)}</b><i>${new Date(t).toLocaleDateString('sv-SE', { month: 'short' }).replace('.', '')}</i></div>`).join('')}</div>`;
  }

  // ---------- Automationer och enheten ----------
  function renderAutos() {
    const rows = (S.automations || []).map(id => {
      const s = st(id); if (!s) return '';
      const name = (s.attributes.friendly_name || id).replace(/^Spabad - /, '');
      return `<div class="srow"><span class="${s.state === 'on' ? '' : 'off'}">${esc(name)}</span><b>${s.state === 'on' ? ago(s.attributes.last_triggered) : 'avstängd'}</b></div>`;
    }).join('');
    $('autos').innerHTML = `<div class="eyebrow">Automationer · senast körd</div><h3>Smart styrning</h3>${rows || '<div class="empty">Inga automationer i config.</div>'}
      <div class="srow"><span>Billig filtertid</span><b>${on(S.cheap) ? 'ja, nu' : 'nej'}</b></div>
      <div class="srow"><span>Spabadet används</span><b>${on(S.active) ? 'ja' : 'nej'}</b></div>`;
  }
  function renderDevice() {
    const errS = st(S.errors), errs = errS && Array.isArray(errS.attributes.errors) ? errS.attributes.errors : [];
    $('device').innerHTML = `<div class="eyebrow">Badet</div><h3>${esc(S.model || 'Spabad')}</h3>
      <div class="srow"><span>Wi-Fi</span><b>${on(S.connected) ? 'uppkopplad' : on(S.connected) === false ? 'nere' : '–'}</b></div>
      <div class="srow"><span>Felkoder</span><b class="${errs.length || on(S.errors) ? 'warnc' : ''}">${errs.length ? esc(errs.join(', ')) : on(S.errors) ? 'fel rapporterat' : 'inga'}</b></div>
      <div class="srow"><span>Volym</span><b>${nf(S.volume_l || 937, 0)}<small>liter</small></b></div>
      <div class="srow"><span>Värmare</span><b>${nf(S.heater_kw || 2.2, 1)}<small>kW</small></b></div>
      <div class="srow"><span>Uttaget</span><b>${on(S.plug) ? 'på' : on(S.plug) === false ? 'av' : '–'} · ${nf(num(S.voltage), 0)} V · ${nf(num(S.current), 2)} A</b></div>
      <div class="srow"><span>Mätare totalt</span><b>${nf(num(S.energy_total), 0)}<small>kWh</small></b></div>
      <p class="so-note">Uttaget går inte att styra härifrån, så att badet inte stängs av av misstag.</p>`;
  }

  // ---------- Graf: vattentemperatur ----------
  async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); }
  let range = 48;
  function lineChart(series, heat, opt = {}) {
    const all = series.flatMap(s => s.points);
    if (!all.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 760, Hh = opt.h || 240, pl = 36, pr = 8, pt = 10, pb = 22;
    const t0 = Date.now() - range * 3600e3, t1 = Date.now();
    let lo = Math.floor((Math.min(...all.map(p => p[1])) - 1) / 5) * 5, hi = Math.ceil((Math.max(...all.map(p => p[1])) + 1) / 5) * 5;
    if (hi <= lo) hi = lo + 1;
    const x = t => pl + (Math.max(t0, t) - t0) / (t1 - t0) * (Wd - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (Hh - pt - pb);
    let g = '';
    // värmeperioder som skuggade band
    for (let i = 0; i < heat.length; i++) if (heat[i][1]) { const a = heat[i][0], b = i + 1 < heat.length ? heat[i + 1][0] : t1; if (b > t0) g += `<rect class="hband" x="${x(a)}" y="${pt}" width="${Math.max(1, x(b) - x(a))}" height="${Hh - pt - pb}"/>`; }
    const stepV = hi - lo > 40 ? 10 : 5; hi = lo + Math.ceil((hi - lo) / stepV) * stepV; const nT = (hi - lo) / stepV;
    for (let i = 0; i <= nT; i++) { const v = lo + stepV * i; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`; }
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    const every = range > 72 ? 24 : range > 30 ? 6 : 3;
    for (let t = first.getTime() + 3600e3; t <= t1; t += 3600e3) { const d = new Date(t), h = d.getHours();
      if (h === 0) g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${Hh - pb}"/>`;
      if (h % every) continue; g += `<text class="ax" x="${x(t)}" y="${Hh - 6}" text-anchor="middle">${every === 24 ? d.toLocaleDateString('sv-SE', { weekday: 'short' }) : String(h).padStart(2, '0')}</text>`; }
    const paths = series.map(s => { if (!s.points.length) return '';
      // stegkurva: värdet gäller tills nästa ändring
      let d = '', prev = null;
      for (const [t, v] of s.points) { if (t < t0 && prev == null) { prev = v; continue; } if (!d) d = `M${x(t0)},${y(prev ?? v)}`; if (prev != null) d += `L${x(t)},${y(prev)}`; d += `L${x(t)},${y(v)}`; prev = v; }
      if (!d && prev != null) d = `M${x(t0)},${y(prev)}`;
      if (prev != null) d += `L${x(t1)},${y(prev)}`;
      return `<path class="ln${s.dash ? ' dash' : ''}" stroke="${s.color}" d="${d}"/>`; }).join('');
    return `<svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}${paths}</svg>
      <div class="legend">${series.map(s => `<span><i style="background:${s.color};height:3px"></i>${esc(s.label)}</span>`).join('')}<span><i style="background:rgba(224,137,90,.35);height:8px"></i>Värmer</span></div>`;
  }
  async function loadTempChart() {
    const el = $('temp-chart');
    el.innerHTML = `<div class="wh"><div class="eyebrow">Vattentemperatur och mål <span class="mutd">°C</span></div>
      <div class="seg">${[[24, '24 h'], [48, '2 d'], [168, '7 d']].map(([h, l]) => `<button data-range="${h}" aria-pressed="${h === range}">${l}</button>`).join('')}</div></div><div class="body"><div class="empty">Hämtar …</div></div>`;
    try {
      const [wt, tg] = await Promise.all([
        getJSON(`api/history?entity=${encodeURIComponent(S.climate)}&hours=${range}&attr=current_temperature`),
        getJSON(`api/history?entity=${encodeURIComponent(S.climate)}&hours=${range}&attr=temperature`).catch(() => ({ points: [] }))]);
      const wp = wt.points.map(([t, v]) => [tsOf(t), v]);
      el.querySelector('.body').innerHTML = lineChart([{ label: 'Vatten', color: TC('blue'), points: wp }, { label: 'Mål', color: TC('orange'), points: tg.points.map(([t, v]) => [tsOf(t), v]), dash: true }], wt.heating || []);
      if (range >= 48) measureRate(wp, wt.heating || []);
    } catch (e) { el.querySelector('.body').innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; }
  }
  // Uppvärmningstakt: temperaturökning under värmeperioder längre än en timme
  function measureRate(pts, heat) {
    let gain = 0, hrs = 0;
    for (let i = 0; i < heat.length; i++) {
      if (!heat[i][1]) continue;
      const a = heat[i][0], b = i + 1 < heat.length ? heat[i + 1][0] : Date.now();
      if (b - a < 3600e3) continue;
      const at = t => { let v = null; for (const [tt, vv] of pts) { if (tt > t) break; v = vv; } return v; };
      const va = at(a), vb = at(b);
      if (va != null && vb != null && vb > va) { gain += vb - va; hrs += (b - a) / 3600e3; }
    }
    if (hrs >= 2) { const r = gain / hrs; if (r > 0.3 && r < 5) { rateMeasured = r; render(); } }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-range]'); if (!b) return;
    range = +b.dataset.range; loadTempChart();
  });
  async function loadStats() {
    try { const d = await getJSON(`api/daily?entity=${encodeURIComponent(S.energy_total)}&days=30`); daily = d.points.map(([t, v]) => [tsOf(t), Math.max(0, v || 0)]); renderEnergy(); } catch {}
    try { const m = await getJSON(`api/monthly?entity=${encodeURIComponent(S.energy_total)}&months=12`); monthly = m.points.map(([t, v]) => [tsOf(t), Math.max(0, v || 0)]).slice(-12); renderMonths(); } catch {}
  }

  // ---------- Rendering ----------
  let queued = false;
  function render() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false; clearPending();
      const live = connected && !bad(states[S.climate]);
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      for (const f of [renderHero, renderControl, renderHeat, renderFilter, renderEnergy, renderMonths, renderAutos, renderDevice]) { try { f(); } catch (e) { console.error(f.name, e); } }
    });
  }
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();
  setInterval(render, 60000);

  async function start() {
    S = await getJSON('api/spa');
    if (S.title) $('title').textContent = S.title;
    if (S.subtitle) $('subtitle').textContent = S.subtitle;
    const es = new EventSource('api/stream');
    let loaded = false;
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; render(); if (!loaded) { loaded = true; loadTempChart(); loadStats(); } });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; render(); });
    es.onerror = () => { connected = false; render(); };
    setInterval(() => { loadTempChart(); loadStats(); }, 10 * 60 * 1000);
  }
  start().catch(e => { $('subtitle').textContent = 'Kunde inte starta: ' + e.message; });
  console.info('observatory spa view', VERSION);
})();
