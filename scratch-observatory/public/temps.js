// Temperatursidan: alla rum, uterum och byggnader. Temperatur, fukt, daggpunkt, batterier och historik.
(() => {
  'use strict';
  // Temafärg från CSS-variabel (temat sätts av theme.js)
  const TC = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const VERSION = '0.12.0';
  const $ = id => document.getElementById(id);
  let C = {}, states = {}, connected = false;

  // ---------- Hjälpare ----------
  const st = id => (id && connected) ? states[id] : undefined;
  const bad = s => !s || ['unknown', 'unavailable', ''].includes(s.state);
  function num(id) { const s = st(id); if (bad(s)) return null; const v = parseFloat(s.state); return Number.isFinite(v) ? v : null; }
  const nf = (v, d = 1) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kv = (k, v, u = '', cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}${u ? `<small>${u}</small>` : ''}</b></div>`;
  const tsOf = t => typeof t === 'string' ? Date.parse(t) : t;
  function ago(t) {
    if (!t) return '–';
    const m = Math.round((Date.now() - Date.parse(t)) / 60000);
    if (m < 1) return 'nyss'; if (m < 60) return `${m} min`;
    const h = Math.round(m / 60); return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
  }
  // Daggpunkt enligt Magnus formel
  function dew(t, rh) {
    if (t == null || rh == null || rh <= 0) return null;
    const a = 17.62, b = 243.12, g = Math.log(rh / 100) + a * t / (b + t);
    return b * g / (a - g);
  }
  // färgskala från kallt (blått) till varmt (orange)
  function tcol(t) {
    if (t == null) return '#4c5a46';
    const stops = [[-15, [110, 150, 200]], [0, [143, 183, 186]], [12, [174, 191, 145]], [20, [216, 187, 114]], [26, [224, 137, 90]], [32, [200, 80, 63]]];
    if (t <= stops[0][0]) return `rgb(${stops[0][1]})`;
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], f = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * f)).join(',')})`;
    }
    return `rgb(${stops[stops.length - 1][1]})`;
  }
  const all = () => (C.groups || []).flatMap(g => g.sensors.map(s => ({ ...s, group: g.id })));
  const humWarn = s => s.hum_warn || 999;

  // ---------- Hero ----------
  function renderHero() {
    const inne = (C.groups || []).find(g => g.avg) || { sensors: [] };
    const vals = inne.sensors.map(s => num(s.temp)).filter(v => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const out = num(C.outdoor), live = inne.sensors.map(s => ({ s, t: num(s.temp) })).filter(x => x.t != null).sort((a, b) => b.t - a.t);
    const hums = inne.sensors.map(s => num(s.hum)).filter(v => v != null), havg = hums.length ? hums.reduce((a, b) => a + b, 0) / hums.length : null;
    const sensors = all(), off = sensors.filter(s => num(s.temp) == null), low = sensors.filter(s => s.battery && num(s.battery) != null && num(s.battery) < (C.battery_low || 20));
    const wet = sensors.filter(s => num(s.hum) != null && num(s.hum) >= humWarn(s));
    $('hero').innerHTML = `
      <div class="hmain">
        <div class="eyebrow">Inne · snitt av ${vals.length} rum</div>
        <div class="hbig" style="color:${tcol(avg)}">${nf(avg)}<small>°C</small></div>
        <div class="hsub">Ute ${nf(out)} °C · skillnad ${avg != null && out != null ? nf(avg - out) : '–'} °C · fukt inne ${nf(havg, 0)} %</div>
        <div class="hchips">
          ${off.length ? `<span class="chip alarm">${off.length} sensor${off.length > 1 ? 'er' : ''} svarar inte</span>` : '<span class="chip on">Alla sensorer svarar</span>'}
          ${low.length ? `<span class="chip warn">${low.length} lågt batteri</span>` : ''}
          ${wet.length ? `<span class="chip info">${wet.length} med hög fukt</span>` : ''}
        </div>
      </div>
      <div class="hside">
        ${kv('Varmast inne', live.length ? `${esc(live[0].s.name)} ${nf(live[0].t)}` : '–', '°C', 'heat')}
        ${kv('Kallast inne', live.length ? `${esc(live[live.length - 1].s.name)} ${nf(live[live.length - 1].t)}` : '–', '°C')}
        ${kv('Spridning inne', live.length > 1 ? nf(live[0].t - live[live.length - 1].t) : '–', '°C')}
        ${kv('Sensorer', `${sensors.length - off.length}/${sensors.length}`, 'svarar')}
      </div>`;
  }

  // ---------- Rutor ----------
  const spark = {};
  function sparkSvg(pts, color) {
    if (!pts || pts.length < 2) return '';
    const W = 120, H = 30, t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
    if (hi - lo < 1) { const m = (hi + lo) / 2; lo = m - .5; hi = m + .5; }
    const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${((t - t0) / (t1 - t0 || 1) * W).toFixed(1)},${(H - 2 - (v - lo) / (hi - lo) * (H - 4)).toFixed(1)}`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="tspark"><path d="${d}" stroke="${color}"/></svg>`;
  }
  function tile(s) {
    const t = num(s.temp), h = num(s.hum), b = s.battery ? num(s.battery) : null, dp = dew(t, h), sst = st(s.temp);
    const pts = spark[s.temp], lo = pts && pts.length ? Math.min(...pts.map(p => p[1])) : null, hi = pts && pts.length ? Math.max(...pts.map(p => p[1])) : null;
    const wet = h != null && h >= humWarn(s), lowb = b != null && b < (C.battery_low || 20);
    return `<button class="ttile ${t == null ? 'off' : ''} ${sel === s.temp ? 'sel' : ''}" data-ent="${s.temp}" style="--tc:${tcol(t)}">
      <div class="tt-h"><span>${esc(s.name)}</span>${lowb ? `<em class="bat">${nf(b, 0)} %</em>` : ''}</div>
      <div class="tt-v">${t == null ? 'Ingen data' : nf(t)}${t == null ? '' : '<small>°C</small>'}</div>
      <div class="tt-s"><span class="${wet ? 'wet' : ''}">${h == null ? '–' : nf(h, 0) + ' %'}</span><span>dp ${nf(dp)}°</span></div>
      ${t == null ? '' : sparkSvg(pts, tcol(t))}
      <div class="tt-f"><span>${t == null ? (sst ? `borta ${ago(sst.last_updated)}` : '') : lo == null ? '' : `${nf(lo)}–${nf(hi)}° · 24 h`}</span></div>
    </button>`;
  }
  function renderGroups() {
    $('groups').innerHTML = (C.groups || []).map(g => {
      const v = g.sensors.map(s => num(s.temp)).filter(x => x != null);
      return `<section class="wcard full tgroup"><div class="wh"><div><div class="eyebrow">${esc(g.title)}</div>
        <h3>${v.length ? `${nf(Math.min(...v))} – ${nf(Math.max(...v))} °C` : '–'}</h3></div><span class="chip">${g.sensors.length} sensorer</span></div>
        <div class="tgrid">${g.sensors.map(tile).join('')}</div></section>`;
    }).join('');
  }

  // ---------- Tabell ----------
  let sortKey = 'group', sortDir = 1;
  function renderTable() {
    const gi = Object.fromEntries((C.groups || []).map((g, i) => [g.id, i]));
    const rows = all().map((s, i) => { const t = num(s.temp), h = num(s.hum); return { s, i, t, h, dp: dew(t, h), b: s.battery ? num(s.battery) : null, lu: (st(s.temp) || {}).last_updated }; });
    const key = { group: r => gi[r.s.group] * 100 + r.i, name: r => r.s.name, t: r => r.t ?? -99, h: r => r.h ?? -1, dp: r => r.dp ?? -99, b: r => r.b ?? 999 }[sortKey];
    rows.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    const th = (k, l) => `<th><button data-sort="${k}" class="${sortKey === k ? 'on' : ''}">${l}${sortKey === k ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
    $('table').innerHTML = `<div class="eyebrow">Alla sensorer</div><h3>Temperatur, fukt och daggpunkt</h3>
      <div class="ttable-w"><table class="ttable"><thead><tr>${th('name', 'Plats')}${th('t', 'Temp')}${th('h', 'Fukt')}${th('dp', 'Daggpunkt')}${th('b', 'Batteri')}<th>Uppdaterad</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.t == null ? 'off' : ''}"><td><i style="background:${tcol(r.t)}"></i>${esc(r.s.name)}</td><td>${nf(r.t)} °C</td>
        <td class="${r.h != null && r.h >= humWarn(r.s) ? 'wet' : ''}">${r.h == null ? '–' : nf(r.h, 0) + ' %'}</td><td>${nf(r.dp)} °C</td>
        <td class="${r.b != null && r.b < (C.battery_low || 20) ? 'warnc' : ''}">${r.b == null ? '–' : nf(r.b, 0) + ' %'}</td><td>${ago(r.lu)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="so-note">Daggpunkten är temperaturen där luften blir mättad. Ligger en yta (t.ex. en kall vägg i krypgrunden) under den blir det kondens. Fuktvarning från ${[...new Set(all().map(s => s.hum_warn).filter(Boolean))].join('/')} % som på dashboarden.</p>`;
  }

  // ---------- Diagram ----------
  async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); }
  const PALETTE = [TC('orange'), TC('gold'), TC('sage'), TC('blue'), '#c9a0dc', '#e6a3a3', '#7fb08a', '#b9b1a0', '#6e9ec9', '#d6d06a'];
  let chartGroup = 'inne', chartHours = 24, sel = null;
  const thin = (pts, n = 360) => { if (pts.length <= n) return pts; const k = Math.ceil(pts.length / n); return pts.filter((_, i) => i % k === 0 || i === pts.length - 1); };
  const hist = async (id, hours) => (await getJSON(`api/history?entity=${encodeURIComponent(id)}&hours=${hours}`)).points.map(([t, v]) => [tsOf(t), +v]).filter(p => Number.isFinite(p[1]));
  function lines(series, hours) {
    const pts = series.flatMap(s => s.points);
    if (!pts.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 760, Hh = 260, pl = 34, pr = 8, pt = 10, pb = 22, t1 = Date.now(), t0 = t1 - hours * 3600e3;
    let lo = Math.floor(Math.min(...pts.map(p => p[1])) - .5), hi = Math.ceil(Math.max(...pts.map(p => p[1])) + .5); if (hi <= lo) hi = lo + 1;
    const x = t => pl + (t - t0) / (t1 - t0) * (Wd - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, hi - lo < 6 ? 1 : 0)}</text>`; }
    if (hours <= 48) { const f = new Date(t0); f.setMinutes(0, 0, 0);
      for (let t = f.getTime() + 3600e3; t <= t1; t += 3600e3) { const h = new Date(t).getHours(); if (h === 0) g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${Hh - pb}"/>`; if (h % 3) continue; g += `<text class="ax" x="${x(t)}" y="${Hh - 6}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`; } }
    else { const d0 = new Date(t0); d0.setHours(24, 0, 0, 0);
      for (let t = d0.getTime(); t < t1; t += 864e5) g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${Hh - pb}"/><text class="ax" x="${x(t + 432e5)}" y="${Hh - 6}" text-anchor="middle">${new Date(t).toLocaleDateString('sv-SE', { weekday: 'short' })}</text>`; }
    const paths = series.map(s => { const p = thin(s.points.filter(q => q[0] >= t0)); if (!p.length) return '';
      return `<path class="ln ${s.dim ? 'dim' : ''}" stroke="${s.color}" d="${p.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('')}"/>`; }).join('');
    return `<svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}${paths}</svg>
      <div class="legend">${series.map(s => `<span class="${s.dim ? 'dim' : ''}"><i style="background:${s.color};height:3px"></i>${esc(s.label)} ${s.points.length ? nf(s.points[s.points.length - 1][1]) + '°' : ''}</span>`).join('')}</div>`;
  }
  async function loadChart() {
    const el = $('chart'), g = (C.groups || []).find(x => x.id === chartGroup) || C.groups[0];
    el.innerHTML = `<div class="wh"><div><div class="eyebrow">Historik</div><h3>${esc(g.title)} · ${chartHours > 48 ? `${chartHours / 24} dygn` : `${chartHours} h`}</h3></div>
      <div class="ctlrow"><div class="ctl-seg mini">${C.groups.map(x => `<button data-group="${x.id}" aria-pressed="${x.id === chartGroup}">${esc(x.title)}</button>`).join('')}</div>
      <div class="ctl-seg mini">${[[24, '24 h'], [72, '3 dygn'], [168, '7 dygn']].map(([h, l]) => `<button data-hours="${h}" aria-pressed="${h === chartHours}">${l}</button>`).join('')}</div></div></div>
      <div class="dchart flat body"><div class="empty">Hämtar …</div></div>`;
    try {
      const res = await Promise.all(g.sensors.map(s => hist(s.temp, chartHours).catch(() => [])));
      const series = g.sensors.map((s, i) => ({ label: s.name, color: PALETTE[i % PALETTE.length], points: res[i], dim: sel && sel !== s.temp }));
      el.querySelector('.body').innerHTML = lines(series, chartHours);
      if (chartHours === 24) g.sensors.forEach((s, i) => { spark[s.temp] = res[i]; });
    } catch (e) { el.querySelector('.body').innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; }
  }
  async function loadSparks() {
    const ids = all().map(s => s.temp).filter(id => !spark[id]);
    for (let i = 0; i < ids.length; i += 6) {
      const part = ids.slice(i, i + 6), res = await Promise.all(part.map(id => hist(id, 24).catch(() => [])));
      part.forEach((id, k) => { spark[id] = res[k]; });
      render();
    }
  }
  let daily = { out: [], inn: [] };
  async function loadDaily() {
    try {
      const [o, n] = await Promise.all([getJSON(`api/daily?entity=${encodeURIComponent(C.outdoor)}&days=30&stat=mean`), getJSON(`api/daily?entity=${encodeURIComponent(C.indoor_ref)}&days=30&stat=mean`)]);
      daily = { out: o.points.map(([t, v]) => [tsOf(t), v]), inn: n.points.map(([t, v]) => [tsOf(t), v]) };
    } catch (e) { console.error(e); }
    renderDaily();
  }
  function renderDaily() {
    const el = $('daily'), o = daily.out, n = daily.inn;
    if (!o.length) { el.innerHTML = '<div class="eyebrow">Senaste 30 dygnen</div><div class="empty">Ingen historik.</div>'; return; }
    const Wd = 760, Hh = 220, pl = 34, pr = 8, pt = 10, pb = 22, N = o.length, bw = (Wd - pl - pr) / N;
    const vals = [...o, ...n].map(p => p[1]).filter(v => v != null);
    const lo = Math.floor(Math.min(0, ...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1), y = v => pt + (hi - v) / (hi - lo) * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`; }
    g += `<line class="zero" x1="${pl}" x2="${Wd - pr}" y1="${y(0)}" y2="${y(0)}"/>`;
    const nm = new Map(n.map(([t, v]) => [new Date(t).toDateString(), v]));
    o.forEach(([t, v], i) => { const xx = pl + i * bw + bw * .18, w = bw * .64, d = new Date(t), iv = nm.get(d.toDateString());
      g += `<rect x="${xx}" y="${Math.min(y(v), y(0))}" width="${w}" height="${Math.abs(y(v) - y(0))}" fill="${tcol(v)}" opacity=".8"><title>${d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}: ute ${nf(v)} °C${iv != null ? ` · inne ${nf(iv)} °C` : ''}</title></rect>`;
      if (i % 3 === 0 || i === N - 1) g += `<text class="ax" x="${xx + w / 2}" y="${Hh - 6}" text-anchor="middle">${d.getDate()}/${d.getMonth() + 1}</text>`; });
    if (n.length) g += `<path class="ln" stroke="${TC('gold')}" d="${n.map(([t, v], i) => { const k = o.findIndex(p => new Date(p[0]).toDateString() === new Date(t).toDateString()); return k < 0 ? '' : `${i ? 'L' : 'M'}${pl + k * bw + bw / 2},${y(v)}`; }).join('')}"/>`;
    const ov = o.map(p => p[1]).filter(v => v != null), mean = ov.reduce((a, b) => a + b, 0) / (ov.length || 1);
    el.innerHTML = `<div class="wh"><div><div class="eyebrow">Senaste 30 dygnen · dygnsmedel</div><h3>Ute i snitt ${nf(mean)} °C</h3></div><span class="chip">kallast ${nf(Math.min(...ov))} · varmast ${nf(Math.max(...ov))} °C</span></div>
      <div class="dchart flat"><svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}</svg>
      <div class="legend"><span><i style="background:${TC('blue')}"></i>Ute, dygnsmedel</span><span><i style="background:${TC('gold')};height:3px"></i>Vardagsrum, dygnsmedel</span></div></div>`;
  }
  function renderBatteries() {
    const rows = all().filter(s => s.battery).map(s => ({ s, b: num(s.battery) })).sort((a, b) => (a.b ?? -1) - (b.b ?? -1));
    $('batteries').innerHTML = `<div class="eyebrow">Batterier</div><h3>${rows.filter(r => r.b != null && r.b < (C.battery_low || 20)).length ? 'Byt snart' : 'Alla ser bra ut'}</h3>
      ${rows.map(r => `<div class="bat-r"><span>${esc(r.s.name)}</span><div class="so-bar ${r.b != null && r.b < (C.battery_low || 20) ? 'orange' : ''}"><span style="width:${r.b ?? 0}%"></span></div><b>${r.b == null ? '–' : nf(r.b, 0) + ' %'}</b></div>`).join('')}
      <p class="so-note">Gränsen för lågt batteri är ${C.battery_low || 20} %. Netatmo- och MQTT-sensorer rapporterar inget batteri hit.</p>`;
  }

  document.addEventListener('click', e => {
    const gb = e.target.closest('button[data-group]'); if (gb) { chartGroup = gb.dataset.group; sel = null; return loadChart(); }
    const hb = e.target.closest('button[data-hours]'); if (hb) { chartHours = +hb.dataset.hours; return loadChart(); }
    const sb = e.target.closest('button[data-sort]'); if (sb) { if (sortKey === sb.dataset.sort) sortDir = -sortDir; else { sortKey = sb.dataset.sort; sortDir = sb.dataset.sort === 'name' ? 1 : -1; } return render(); }
    const tb = e.target.closest('.ttile'); if (tb) {
      const s = all().find(x => x.temp === tb.dataset.ent); if (!s) return;
      sel = sel === s.temp ? null : s.temp; chartGroup = s.group; render(); loadChart();
      if (sel) $('chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // ---------- Rendering ----------
  let queued = false;
  function render() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const live = connected && all().some(s => num(s.temp) != null);
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      for (const f of [renderHero, renderGroups, renderTable, renderBatteries]) { try { f(); } catch (e) { console.error(f.name, e); } }
    });
  }
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();
  setInterval(render, 60000);

  async function start() {
    C = await getJSON('api/temps');
    if (C.title) $('title').textContent = C.title;
    if (C.subtitle) $('subtitle').textContent = C.subtitle;
    const es = new EventSource('api/stream');
    let loaded = false;
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; render();
      if (!loaded) { loaded = true; loadChart().then(loadSparks); loadDaily(); } });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; render(); });
    es.onerror = () => { connected = false; render(); };
    setInterval(() => { for (const k of Object.keys(spark)) delete spark[k]; loadChart().then(loadSparks); }, 15 * 60 * 1000);
  }
  start().catch(e => { $('subtitle').textContent = 'Kunde inte starta: ' + e.message; });
  console.info('observatory temps view', VERSION);
})();
