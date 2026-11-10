// Element-sidan: alla element och badrummets golvvärme. Rumstemperatur, börvärde, effekt, energi,
// Node-RED-styrningen, säkringsgruppen och lastbalanseringen. Styrningen går via servern, som bara
// släpper igenom termostaterna, brytarna, talen och skripten som står i config (radiators).
(() => {
  'use strict';
  const TC = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const VERSION = '0.31.0';
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
  const nt = v => v == null ? '–' : nf(v, v % 1 ? 1 : 0);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kv = (k, v, u = '', cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}${u ? `<small>${u}</small>` : ''}</b></div>`;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
  const tsOf = t => typeof t === 'string' ? Date.parse(t) : t;
  const R = () => S.radiators || [];
  const byClimate = id => R().find(r => r.climate === id);

  // Värmer elementet just nu? Egen sensor först, sedan effekten, sist termostatens hvac_action
  function heating(r) {
    if (r.heating && on(r.heating) != null) return on(r.heating);
    const w = num(r.power); if (w != null) return w > 20;
    const c = st(r.climate); return !!(c && c.attributes.hvac_action === 'heating');
  }
  const room = r => num(r.room_temperature) ?? num(r.climate, 'current_temperature');
  const setp = r => num(r.climate, 'temperature');
  // Timer: sekunder kvar för aktiv eller pausad timer
  function timerLeft(id) {
    const s = st(id); if (!s || (s.state !== 'active' && s.state !== 'paused')) return null;
    if (s.state === 'active' && s.attributes.finishes_at) return Math.max(0, (Date.parse(s.attributes.finishes_at) - Date.now()) / 1000);
    const m = String(s.attributes.remaining || '').match(/(\d+):(\d+):(\d+)/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
  }
  const mmss = s => s == null ? '' : s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')} min` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

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
      if (action === 'script') { delete pending[action + '|' + entity]; toast('Skickat'); render(); }
    } catch (e) { delete pending[action + '|' + entity]; render(); toast('Gick inte: ' + e.message); }
  }
  const pend = (action, entity) => { const p = pending[action + '|' + entity]; return p && Date.now() < p.until ? p : null; };
  function clearPending() {
    for (const [k, p] of Object.entries(pending)) {
      if (Date.now() > p.until) { delete pending[k]; continue; }
      const [a, id] = k.split('|'), s = st(id);
      if (a === 'toggle' && on(id) === p.value) delete pending[k];
      if (a === 'number' && num(id) === p.value) delete pending[k];
      if (a === 'climate_mode' && s && s.state === p.value) delete pending[k];
      if (a === 'climate_temp' && num(id, 'temperature') === p.value) delete pending[k];
    }
  }
  const drafts = {}, timers = {};
  function bump(ent, dir) {
    const s = st(ent); if (!s) return;
    let lo, hi, step, cur, action;
    if (ent.startsWith('climate.')) {
      action = 'climate_temp'; lo = +s.attributes.min_temp; hi = +s.attributes.max_temp; step = +s.attributes.target_temp_step || 0.5; cur = num(ent, 'temperature');
    } else {
      action = 'number'; lo = +s.attributes.min; hi = +s.attributes.max; step = +s.attributes.step || 1; cur = num(ent);
    }
    const p = pend(action, ent), base = drafts[ent] ?? (p ? p.value : cur);
    if (base == null) return;
    drafts[ent] = Math.round(Math.max(lo, Math.min(hi, Math.round((base + dir * step) / step) * step)) * 100) / 100;
    render();
    clearTimeout(timers[ent]);
    timers[ent] = setTimeout(() => { const v = drafts[ent]; delete drafts[ent]; send(action, v, ent); }, 1200);
  }
  const tempVal = r => drafts[r.climate] ?? (pend('climate_temp', r.climate) || {}).value ?? setp(r);
  const modeVal = r => { const p = pend('climate_mode', r.climate), s = st(r.climate); return p ? p.value : s && !bad(s) ? s.state : null; };
  const tgVal = id => { const p = pend('toggle', id); return p ? p.value : on(id); };

  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act, ent = b.dataset.ent;
    if (act === 'bump') return bump(ent, +b.dataset.dir);
    if (act === 'mode') { const r = byClimate(ent); return send('climate_mode', modeVal(r) === 'heat' ? 'off' : 'heat', ent); }
    if (act === 'toggle') return send('toggle', b.getAttribute('aria-pressed') !== 'true', ent);
    if (act === 'script') { if (!confirm(`${b.dataset.name}?`)) return; return send('script', null, ent); }
    if (act === 'chart') { sel = ent; loadTempChart(); document.getElementById('temp-chart').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });

  // ---------- Hero ----------
  function lbOn() { return on(S.load_balancing); }
  function lbWho() {
    return (S.load_members || []).filter(id => on(id)).map(id => (st(id).attributes.friendly_name || id).replace(/^Element\s*/i, '').replace(/\s*balansering$/i, ''));
  }
  function renderHero() {
    const list = R(), hot = list.filter(heating), onCount = list.filter(r => modeVal(r) === 'heat').length;
    const W = list.reduce((a, r) => a + (num(r.power) || 0), 0);
    const today = list.reduce((a, r) => a + (num(r.energy_today) || 0), 0);
    const month = list.reduce((a, r) => a + (num(r.energy_month) || 0), 0);
    const price = num(S.price), lb = lbOn();
    const temps = list.map(room).filter(v => v != null), avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
    const tE = timerLeft((S.buttons || [])[0]?.timer), tA = timerLeft((S.buttons || [])[1]?.timer);
    const label = lb ? 'Lastbalansering spärrar alla element' : tA != null ? 'All värme är avstängd' : tE != null ? 'Elementen är avstängda' : hot.length ? `${hot.length} värmer just nu` : onCount ? 'På, men inget värmer' : 'Alla är av';
    $('hero').innerHTML = `
      <div class="el-ic ${hot.length ? 'isheat' : ''}">${radSvg(hot.length)}</div>
      <div class="hmain">
        <div class="eyebrow">Element och golvvärme</div>
        <div class="hbig">${hot.length}<small>av ${list.length} värmer</small></div>
        <div class="hsub">${onCount} står på värme · snitt ${nf(avg)} °C i rummen</div>
        <div class="hstatus ${lb ? 'err' : hot.length ? 'heat' : ''}"><i></i>${label}</div>
        <div class="hchips">
          ${tgVal(S.price_control) ? '<span class="chip on">Elprisstyrning på</span>' : '<span class="chip">Elprisstyrning av</span>'}
          ${tgVal(S.time_control) ? '<span class="chip on">Tidsstyrning på</span>' : ''}
          ${lb ? `<span class="chip warn">Lastbalansering${lbWho().length ? ': ' + esc(lbWho().join(', ')) : ''}</span>` : ''}
          ${tE != null ? `<span class="chip info">Element av <span data-tleft="${S.buttons[0].timer}">${mmss(tE)}</span></span>` : ''}
          ${tA != null ? `<span class="chip info">All värme av <span data-tleft="${S.buttons[1].timer}">${mmss(tA)}</span></span>` : ''}
          ${hot.map(r => `<span class="chip heat">${esc(r.short || r.name)}</span>`).join('')}
        </div>
      </div>
      <div class="hside">
        ${kv('Effekt nu', Math.round(W).toLocaleString('sv-SE'), 'W', 'heat')}
        ${kv('Idag', nf(today, 2), 'kWh')}
        ${kv('Månaden', nf(month, 1), 'kWh')}
        ${kv('Kostar nu', price == null ? '–' : nf(W / 1000 * price, 2), 'kr/h')}
        ${kv('Settemp Node-RED', nt(num(S.set_temp)), '°C')}
        ${kv('Elpris', nf(price, 2), 'kr/kWh')}
      </div>`;
  }
  function radSvg(hot) {
    const fins = [0, 1, 2, 3, 4, 5].map(i => `<rect x="${18 + i * 22}" y="30" width="16" height="78" rx="6" class="fin"/>`).join('');
    const waves = hot ? [40, 74, 108].map((x, i) => `<path class="wave" d="M${x},24 q-6,-8 0,-16 q6,-8 0,-16" style="animation-delay:-${i * 0.8}s"/>`).join('') : '';
    return `<svg viewBox="0 0 160 130" role="img" aria-label="Element">${waves}<rect x="12" y="40" width="136" height="8" rx="3" class="pipe"/><rect x="12" y="92" width="136" height="8" rx="3" class="pipe"/>${fins}<rect x="22" y="108" width="6" height="14" class="leg"/><rect x="132" y="108" width="6" height="14" class="leg"/></svg>`;
  }

  // ---------- Global styrning ----------
  function tgl(id, lbl, hint) {
    const p = pend('toggle', id), v = p ? p.value : on(id);
    return `<div class="ftg"><div><b>${lbl}</b><span>${hint}</span></div>
      <button class="tgl ${v ? 'on' : ''} ${p ? 'pending' : ''}" data-act="toggle" data-ent="${id}" aria-pressed="${!!v}" ${S.controls && st(id) ? '' : 'disabled'}><i></i>${v ? 'På' : 'Av'}</button></div>`;
  }
  function stepper(ent, val, unit, label, small = true) {
    const s = st(ent), ok = S.controls && s && !bad(s), pd = drafts[ent] != null || pend(ent.startsWith('climate.') ? 'climate_temp' : 'number', ent);
    return `<div class="ctl-temp ${small ? 'small' : ''}">${label ? `<div class="eyebrow">${label}</div>` : ''}<div class="tempbox">
      <button data-act="bump" data-ent="${ent}" data-dir="-1" ${ok ? '' : 'disabled'} aria-label="Sänk">−</button>
      <div class="tval ${pd ? 'pending' : ''}">${nt(val)}<small>${unit}</small></div>
      <button data-act="bump" data-ent="${ent}" data-dir="1" ${ok ? '' : 'disabled'} aria-label="Höj">+</button></div></div>`;
  }
  function renderControl() {
    const stv = drafts[S.set_temp] ?? (pend('number', S.set_temp) || {}).value ?? num(S.set_temp);
    const btns = (S.buttons || []).map(b => {
      const left = timerLeft(b.timer);
      return `<button class="offbtn ${left != null ? 'on' : ''}" data-act="script" data-ent="${b.entity}" data-name="${esc(b.name)}" ${S.controls && st(b.entity) ? '' : 'disabled'}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M7 6.3a8 8 0 1 0 10 0"/></svg><span><b>${esc(b.name)}</b><small>${left != null ? `<span data-tleft="${b.timer}">${mmss(left)}</span> kvar` : 'Timern står still'}</small></span></button>`;
    }).join('');
    $('control').innerHTML = `<div class="wh"><div><div class="eyebrow">Styrning · Node-RED</div><h3>${tgVal(S.price_control) ? 'Elpriset styr elementen' : tgVal(S.time_control) ? 'Tidsschemat styr elementen' : 'Ingen automatisk styrning'}</h3></div>
        ${S.controls ? '' : '<span class="chip">Styrning avstängd i config</span>'}</div>
      <div class="el-ctl">
        <div class="ftgs">
          ${tgl(S.price_control, 'Elprisstyrning', 'Node-RED sänker och höjer efter Nord Pool')}
          ${tgl(S.time_control, 'Tidsstyrning', 'Node-RED följer tidsschemat')}
        </div>
        ${stepper(S.set_temp, stv, '°C', 'Settemp Node-RED')}
        <div class="offbtns">${btns}</div>
      </div>
      ${lbOn() ? `<p class="so-note warnc">Lastbalansering är på${lbWho().length ? ` (${esc(lbWho().join(', '))})` : ''}, så alla element är spärrade tills den släpper.</p>` : ''}
      <p class="so-note">Ett element som inte står på Manuell styrs av Node-RED och kan få ett nytt börvärde vid nästa pris- eller tidsändring. Sätt Manuell om du vill att din ändring ska ligga kvar.</p>`;
  }

  // ---------- Elementkort ----------
  function nodeRed(r) {
    const s = st(r.node_red); if (bad(s)) return '';
    const parts = s.state.split(' - ').map(x => x.trim()), first = parseFloat(parts[0]);
    const head = Number.isFinite(first) ? `${nt(first)} °C` : parts[0] === 'off' ? 'av' : parts[0] === 'manual_mode' ? 'manuellt läge' : parts[0];
    return `Node-RED: ${[head, ...parts.slice(1, 3)].map(esc).join(' · ')}`;
  }
  function radCard(r) {
    const c = st(r.climate), ok = S.controls && c && !bad(c), mode = modeVal(r), hot = heating(r);
    const rt = room(r), sp = tempVal(r), w = num(r.power), man = tgVal(r.manual), manT = on(r.manual_temp), blk = on(r.fuse_block);
    const left = timerLeft(r.timer), pM = pend('climate_mode', r.climate);
    const diff = rt != null && sp != null && mode === 'heat' ? rt - sp : null;
    const status = bad(c) ? 'Ingen kontakt' : blk ? 'Säkringsspärr' : lbOn() && !man ? 'Spärrad' : hot ? 'Värmer' : mode === 'heat' ? (diff != null && diff >= 0 ? 'Varmt nog' : 'Väntar') : 'Av';
    const off = r.offset ? (drafts[r.offset] ?? (pend('number', r.offset) || {}).value ?? num(r.offset)) : null;
    return `<article class="rad ${hot ? 'isheat' : ''} ${mode === 'heat' ? 'onm' : ''} ${bad(c) ? 'na' : ''}">
      <header><div><b>${esc(r.name)}</b><span class="rst ${hot ? 'heat' : blk ? 'warnc' : ''}">${status}${r.floor ? ' · golvvärme' : ''}</span></div>
        <button class="chartbtn ${sel === r.climate ? 'on' : ''}" data-act="chart" data-ent="${r.climate}" title="Visa i grafen" aria-label="Visa ${esc(r.name)} i grafen"><svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 3 5-7 4 4"/></svg></button></header>
      <div class="rtemps">
        <div><span>Rummet</span><b>${nf(rt)}<small>°C</small></b></div>
        <div class="rsp">${stepper(r.climate, sp, '°C', 'Börvärde')}</div>
      </div>
      <div class="rbar"><i style="width:${w == null ? 0 : Math.min(100, w / (r.floor ? 1200 : 1000) * 100)}%"></i></div>
      <div class="rstats">
        <span><b>${w == null ? '–' : Math.round(w)}</b> W</span>
        <span><b>${nf(num(r.energy_today), 2)}</b> kWh idag</span>
        <span><b>${nf(num(r.energy_month), 1)}</b> kWh mån</span>
      </div>
      ${r.offset ? `<div class="roff"><span>Offset</span>${stepper(r.offset, off, '°C', '')}</div>` : ''}
      <div class="racts">
        <button class="heatbtn ${mode === 'heat' ? 'on' : ''} ${pM ? 'pending' : ''}" data-act="mode" data-ent="${r.climate}" aria-pressed="${mode === 'heat'}" ${ok ? '' : 'disabled'}>${mode === 'heat' ? 'Värme på' : 'Värme av'}</button>
        ${r.manual ? `<button class="mchip ${man ? 'on' : ''} ${pend('toggle', r.manual) ? 'pending' : ''}" data-act="toggle" data-ent="${r.manual}" aria-pressed="${!!man}" ${S.controls && st(r.manual) ? '' : 'disabled'}>Manuell</button>` : ''}
        ${manT ? '<span class="chip">Temp manuell</span>' : ''}
        ${blk ? '<span class="chip warn">Säkring</span>' : ''}
      </div>
      ${left != null ? `<div class="rtimer">Timer <span data-tleft="${r.timer}">${mmss(left)}</span> kvar</div>` : ''}
      ${r.node_red && nodeRed(r) ? `<div class="rnr">${nodeRed(r)}</div>` : ''}
    </article>`;
  }
  function renderRads() {
    $('rads').innerHTML = `<div class="wh"><div><div class="eyebrow">Alla element</div><h3>${R().length} värmekällor</h3></div></div>
      <div class="radgrid">${R().map(radCard).join('')}</div>`;
  }

  // ---------- Säkringsgruppen ----------
  function renderFuse() {
    const F = S.fuse; if (!F) { $('fuse').hidden = true; return; }
    const mem = F.members.map(byClimate).filter(Boolean), n = mem.filter(heating).length;
    $('fuse').innerHTML = `<div class="eyebrow">${esc(F.name || 'Säkring')}</div><h3>${n} av max ${F.max} värmer</h3>
      <div class="fusebar">${Array.from({ length: F.max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
      ${mem.map(r => `<div class="srow"><span>${esc(r.name)}</span><b class="${on(r.fuse_block) ? 'warnc' : heating(r) ? 'heat' : ''}">${on(r.fuse_block) ? 'spärrad' : heating(r) ? `värmer · ${Math.round(num(r.power) || 0)} W` : modeVal(r) === 'heat' ? 'väntar' : 'av'}</b></div>`).join('')}
      <p class="so-note">Kontoren och tvättstugan delar en säkring. Automationen låter högst ${F.max} värma samtidigt och turas om när någon blir kall.</p>`;
  }

  // ---------- Energi ----------
  function bars(key, d) {
    const rows = R().map(r => [r, num(r[key]) || 0]).sort((a, b) => b[1] - a[1]);
    const tot = rows.reduce((a, x) => a + x[1], 0), max = Math.max(0.001, ...rows.map(x => x[1]));
    return `<div class="ebars">${rows.map(([r, v]) => `<div class="ebar"><span>${esc(r.short || r.name)}</span><i><em style="width:${v / max * 100}%" class="${r.floor ? 'floor' : ''}"></em></i><b>${nf(v, d)}<small>kWh</small></b><s>${tot ? Math.round(v / tot * 100) : 0} %</s></div>`).join('')}</div>`;
  }
  function renderEnergy() {
    const tot = R().reduce((a, r) => a + (num(r.energy_today) || 0), 0), price = num(S.price);
    $('energy').innerHTML = `<div class="eyebrow">Energi idag per element</div><h3>${nf(tot, 2)} kWh${price != null ? ` · ungefär ${nf(tot * price, 0)} kr` : ''}</h3>${bars('energy_today', 2)}`;
  }
  function renderMonth() {
    const tot = R().reduce((a, r) => a + (num(r.energy_month) || 0), 0);
    $('month').innerHTML = `<div class="eyebrow">Den här månaden</div><h3>${nf(tot, 0)} kWh</h3>${bars('energy_month', 0)}`;
  }

  // ---------- Graf ----------
  async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); }
  let range = 48, sel = null;
  function lineChart(series, heat) {
    const all = series.flatMap(s => s.points).filter(p => Number.isFinite(p[1]));
    if (!all.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 760, Hh = 240, pl = 36, pr = 8, pt = 10, pb = 22;
    const t0 = Date.now() - range * 3600e3, t1 = Date.now();
    let lo = Math.floor(Math.min(...all.map(p => p[1])) - 1), hi = Math.ceil(Math.max(...all.map(p => p[1])) + 1);
    if (hi <= lo) hi = lo + 1;
    const x = t => pl + (Math.max(t0, t) - t0) / (t1 - t0) * (Wd - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i < heat.length; i++) if (heat[i][1]) { const a = heat[i][0], b = i + 1 < heat.length ? heat[i + 1][0] : t1; if (b > t0) g += `<rect class="hband" x="${x(a)}" y="${pt}" width="${Math.max(1, x(b) - x(a))}" height="${Hh - pt - pb}"/>`; }
    const stepV = hi - lo > 12 ? 5 : hi - lo > 6 ? 2 : 1;
    for (let v = Math.ceil(lo / stepV) * stepV; v <= hi; v += stepV) g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    const every = range > 72 ? 24 : range > 30 ? 6 : 3;
    for (let t = first.getTime() + 3600e3; t <= t1; t += 3600e3) { const d = new Date(t), h = d.getHours();
      if (h === 0) g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${Hh - pb}"/>`;
      if (h % every) continue; g += `<text class="ax" x="${x(t)}" y="${Hh - 6}" text-anchor="middle">${every === 24 ? d.toLocaleDateString('sv-SE', { weekday: 'short' }) : String(h).padStart(2, '0')}</text>`; }
    const paths = series.map(s => { if (!s.points.length) return '';
      let d = '', prev = null;
      for (const [t, v] of s.points) { if (t < t0 && prev == null) { prev = v; continue; } if (!d) d = `M${x(t0)},${y(prev ?? v)}`; if (prev != null && s.step) d += `L${x(t)},${y(prev)}`; d += `L${x(t)},${y(v)}`; prev = v; }
      if (!d && prev != null) d = `M${x(t0)},${y(prev)}`;
      if (prev != null) d += `L${x(t1)},${y(prev)}`;
      return `<path class="ln${s.dash ? ' dash' : ''}" stroke="${s.color}" d="${d}"/>`; }).join('');
    return `<svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}${paths}</svg>
      <div class="legend">${series.map(s => `<span><i style="background:${s.color};height:3px"></i>${esc(s.label)}</span>`).join('')}<span><i style="background:rgba(224,137,90,.35);height:8px"></i>Värmer</span></div>`;
  }
  async function loadTempChart() {
    const el = $('temp-chart'), r = byClimate(sel) || R()[0]; if (!r) return;
    sel = r.climate;
    el.innerHTML = `<div class="wh"><div class="eyebrow">${esc(r.name)} · rummet och börvärdet <span class="mutd">°C</span></div>
      <div class="seg">${[[24, '24 h'], [48, '2 d'], [168, '7 d']].map(([h, l]) => `<button data-range="${h}" aria-pressed="${h === range}">${l}</button>`).join('')}</div></div>
      <div class="seg elsel">${R().map(x => `<button data-sel="${x.climate}" aria-pressed="${x.climate === sel}">${esc(x.short || x.name)}</button>`).join('')}</div>
      <div class="body"><div class="empty">Hämtar …</div></div>`;
    renderRads();
    try {
      const [rt, sp] = await Promise.all([
        getJSON(`api/history?entity=${encodeURIComponent(r.room_temperature || r.climate)}&hours=${range}${r.room_temperature ? '' : '&attr=current_temperature'}`),
        getJSON(`api/history?entity=${encodeURIComponent(r.climate)}&hours=${range}&attr=temperature`).catch(() => ({ points: [], heating: [] }))]);
      let heat = sp.heating || [];
      if (r.power) { try { const pw = await getJSON(`api/history?entity=${encodeURIComponent(r.power)}&hours=${range}`); if (pw.points.length) heat = pw.points.map(([t, v]) => [tsOf(t), v > 20 ? 1 : 0]); } catch {} }
      el.querySelector('.body').innerHTML = lineChart([
        { label: 'Rummet', color: TC('blue'), points: rt.points.map(([t, v]) => [tsOf(t), v]) },
        { label: 'Börvärde', color: TC('orange'), points: sp.points.map(([t, v]) => [tsOf(t), v]), dash: true, step: true }], heat);
    } catch (e) { el.querySelector('.body').innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-range],button[data-sel]'); if (!b) return;
    if (b.dataset.range) range = +b.dataset.range; else sel = b.dataset.sel;
    loadTempChart();
  });

  // ---------- Rendering ----------
  let queued = false;
  function render() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false; clearPending();
      const live = connected && R().some(r => !bad(states[r.climate]));
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      for (const f of [renderHero, renderControl, renderRads, renderFuse, renderEnergy, renderMonth]) { try { f(); } catch (e) { console.error(f.name, e); } }
    });
  }
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();
  // timrarna räknar ner: bara siffrorna uppdateras varje sekund, så knapparna inte byts ut under fingret
  setInterval(() => { for (const el of document.querySelectorAll('[data-tleft]')) { const l = timerLeft(el.dataset.tleft); if (l == null) render(); else el.textContent = mmss(l); } }, 1000);
  setInterval(render, 60000);

  async function start() {
    S = await getJSON('api/radiators');
    if (S.title) $('title').textContent = S.title;
    if (S.subtitle) $('subtitle').textContent = S.subtitle;
    const hot = () => R().find(heating);
    const es = new EventSource('api/stream');
    let loaded = false;
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; render(); if (!loaded) { loaded = true; sel = (hot() || R()[0] || {}).climate; loadTempChart(); } });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; render(); });
    es.onerror = () => { connected = false; render(); };
    setInterval(loadTempChart, 10 * 60 * 1000);
  }
  start().catch(e => { $('subtitle').textContent = 'Kunde inte starta: ' + e.message; });
  console.info('observatory element view', VERSION);
})();
