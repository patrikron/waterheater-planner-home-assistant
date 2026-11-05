// Solcellssidan: allt från solpanelsrutan plus historik, rekord och månadsjämförelser.
(() => {
  'use strict';
  const VERSION = '0.8.0';
  const $ = id => document.getElementById(id);
  let cfg = {}, S = {}, states = {}, connected = false, money = null;

  // ---------- Hjälpare ----------
  const st = id => (id && connected) ? states[id] : undefined;
  const bad = s => !s || ['unknown', 'unavailable', ''].includes(s.state);
  function num(id, attr) {
    const s = st(id); if (!s) return null;
    const v = parseFloat(attr ? s.attributes[attr] : s.state);
    return Number.isFinite(v) ? v : null;
  }
  const nf = (v, d = 1) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const kw = w => w == null ? '–' : nf(Math.abs(w) / 1000, 2);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hm = t => t ? new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '–';
  const bar = (pct, cls = '') => `<div class="so-bar ${cls}"><span style="width:${Math.max(0, Math.min(100, pct || 0))}%"></span></div>`;
  const kv = (k, v, u = '', cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}${u ? `<small>${u}</small>` : ''}</b></div>`;
  const tsOf = t => typeof t === 'string' ? Date.parse(t) : t;
  const DAYS = { Monday: 'Mån', Tuesday: 'Tis', Wednesday: 'Ons', Thursday: 'Tor', Friday: 'Fre', Saturday: 'Lör', Sunday: 'Sön' };
  const MON = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  let peakToday = null, hist = { days: [], out: [], months: [] };

  // ---------- Nu ----------
  function sunGauge(w) {
    const max = (S.inverter_kw || 12) * 1000, f = w == null ? 0 : Math.max(0, Math.min(1, w / max));
    const R = 62, cx = 75, cy = 76, a0 = Math.PI, a1 = Math.PI * (1 - f);
    const p = a => [cx + R * Math.cos(a), cy - R * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1), [xe, ye] = p(0);
    const elev = num(cfg.sun, 'elevation');
    return `<svg viewBox="0 0 150 92" class="sogauge" aria-label="${Math.round(f * 100)} % av växelriktarens max">
      <path d="M${x0},${y0} A${R},${R} 0 0 1 ${xe},${ye}" class="trk"/>
      ${f > 0.001 ? `<path d="M${x0},${y0} A${R},${R} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}" class="val"/>` : ''}
      <circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="6" class="${f > 0.01 ? 'sun on' : 'sun'}"/>
      <text x="${cx}" y="${cy - 14}" text-anchor="middle" class="gp">${Math.round(f * 100)} %</text>
      <text x="${cx}" y="${cy}" text-anchor="middle" class="gl2">av ${nf(max / 1000, 0)} kW</text>
      ${elev != null ? `<text x="${cx}" y="${cy + 14}" text-anchor="middle" class="gl2">sol ${nf(elev, 0)}° över horisonten</text>` : ''}
    </svg>`;
  }
  function renderHero() {
    const w = num(cfg.solar), pred = num(cfg.pv_predicted), today = num(cfg.pv_today), rem = num(cfg.pv_remaining_today);
    const out = num(cfg.grid_out_today), selfK = num(S.self_consumed_today) ?? (today != null && out != null ? Math.max(0, today - out) : null);
    const selfPct = today > 0 && selfK != null ? Math.min(100, selfK / today * 100) : null;
    const ofPred = pred > 50 && w != null ? w / pred * 100 : null;
    const cloud = num(cfg.cloud_cover);
    const status = w == null ? 'Ingen data' : w < 20 ? 'Ingen produktion just nu' : ofPred == null ? 'Producerar' :
      ofPred >= 90 ? 'Producerar som väntat' : ofPred >= 60 ? 'Lite under prognosen' : 'Klart under prognosen';
    const load = num(cfg.load), grid = num(cfg.grid);
    $('hero').innerHTML = `
      <div class="sogw">${sunGauge(w)}</div>
      <div class="hmain">
        <div class="eyebrow">Produktion nu</div>
        <div class="hbig">${kw(w)}<small>kW</small></div>
        <div class="hsub">Prognos just nu ${kw(pred)} kW${ofPred != null ? ` · ${Math.round(ofPred)} % av prognosen` : ''}${cloud != null ? ` · molnighet ${Math.round(cloud)} %` : ''}</div>
        <div class="hstatus ${w > 20 ? 'heat sol' : ''}"><i></i>${status}</div>
        <div class="hchips">
          ${load != null ? `<span class="chip">Huset drar ${kw(load)} kW</span>` : ''}
          ${grid != null ? `<span class="chip ${grid < 0 ? 'on' : 'info'}">${grid < 0 ? `Säljer ${kw(grid)} kW` : `Köper ${kw(grid)} kW`}</span>` : ''}
          ${num(S.solar_earned_rate) != null ? `<span class="chip on">Sparar ${nf(num(S.solar_earned_rate) + (num(S.solar_sold_rate) || 0), 2)} kr/h</span>` : ''}
        </div>
      </div>
      <div class="hside">
        ${kv('Idag', nf(today), 'kWh', 'sun')}
        ${kv('Kvar idag', nf(rem), 'kWh')}
        ${kv('Dagens topp', peakToday ? nf(peakToday.v / 1000, 2) : '–', peakToday ? 'kW ' + hm(peakToday.t) : 'kW')}
        ${kv('Använt själv', selfPct == null ? '–' : Math.round(selfPct), '%')}
        ${kv('Sålt idag', nf(out), 'kWh')}
        ${kv('Solupp / ned', `${hm(st(cfg.sun) && st(cfg.sun).attributes.next_rising)} / ${hm(st(cfg.sun) && st(cfg.sun).attributes.next_setting)}`)}
      </div>`;
  }

  // ---------- Prognos ----------
  function renderForecast() {
    const today = num(cfg.pv_today), fc = num(cfg.fc_today), rem = num(cfg.fc_remaining), tom = num(cfg.fc_tomorrow), peak = st(cfg.fc_peak_tomorrow);
    const sc = num(cfg.solcast_today), scRem = num(cfg.solcast_remaining), scTom = num(cfg.solcast_tomorrow);
    const reached = fc > 0 && today != null ? today / fc * 100 : null;
    const days = [{ k: 'Imorgon', v: scTom }];
    for (let i = 3; i <= 7; i++) { const s = st(cfg['solcast_day_' + i]); days.push({ k: s ? (DAYS[s.attributes.dayname] || s.attributes.dayname || 'Dag ' + i) : 'Dag ' + i, v: num(cfg['solcast_day_' + i]) }); }
    const max = Math.max(1, ...days.map(d => d.v || 0));
    $('forecast').innerHTML = `<div class="eyebrow">Prognos</div><h3>${nf(tom)} kWh imorgon</h3>
      <div class="kvs">
        ${kv('Väntat idag', nf(fc), 'kWh')}${kv('Kvar idag', nf(rem), 'kWh')}
        ${kv('Imorgon', nf(tom), 'kWh')}${kv('Topp imorgon', peak && !bad(peak) ? hm(peak.state) : '–')}
      </div>
      ${reached != null ? `<div class="so-pb"><span>Producerat av dagens prognos</span><b>${Math.round(reached)} %</b></div>${bar(reached, 'gold')}` : ''}
      <p class="so-note">Forecast.Solar. Solcast (med dämpning) säger ${nf(sc)} kWh idag, ${nf(scRem)} kvar och ${nf(scTom)} imorgon.</p>
      <div class="so-days">${days.map(d => `<div class="so-day"><div class="so-dbar"><span style="height:${Math.max(3, (d.v || 0) / max * 100)}%"></span></div><b>${nf(d.v, 0)}</b><span>${esc(d.k)}</span></div>`).join('')}</div>
      <p class="so-note">Kommande dagar enligt Solcast, kWh</p>`;
  }

  // ---------- Strängar / växelriktare ----------
  function renderStrings() {
    const strings = [1, 2].map(i => ({ i, w: num(cfg['solar_' + i]), v: num(cfg['pv_voltage_' + i]), a: num(cfg['pv_current_' + i]) }));
    const sum = strings.reduce((a, x) => a + (x.w || 0), 0);
    const diff = strings[0].w != null && strings[1].w != null && sum > 300 ? Math.abs(strings[0].w - strings[1].w) / (sum / 2) * 100 : null;
    $('strings').innerHTML = `<div class="eyebrow">Strängar</div><h3>${kw(sum)} kW in från panelerna</h3>
      ${strings.map(x => `<div class="so-str">
        <div class="so-strh"><span>Sträng ${x.i}</span><b>${kw(x.w)}<small>kW</small></b></div>
        ${bar(sum > 0 ? (x.w || 0) / sum * 100 : 0, x.i === 1 ? 'orange' : 'sage')}
        <div class="so-strv"><span>${x.v == null ? '–' : nf(x.v, 0)} V</span><span>${x.a == null ? '–' : nf(x.a, 1)} A</span><span>${sum > 0 ? Math.round((x.w || 0) / sum * 100) : 0} % av effekten</span></div>
      </div>`).join('')}
      <p class="so-note">${diff == null ? 'Skillnaden mellan strängarna visas när det är sol.' : diff < 15 ? `Strängarna går jämnt (${Math.round(diff)} % skillnad).` : `Strängarna skiljer ${Math.round(diff)} %. Det är normalt vid skugga eller olika riktning, men håll koll om det håller i sig i fullt solljus.`}</p>`;
  }
  function renderInverter() {
    const w = num(cfg.solar), ac = num(cfg.ac_power), eff = w > 100 && ac != null ? Math.min(100, ac / w * 100) : null;
    const mode = st(cfg.device_mode), lim = st(S.export_limiter), rate = num(S.export_rate), serial = st(S.serial);
    $('inverter').innerHTML = `<div class="eyebrow">Växelriktare · Growatt</div><h3>${kw(ac)} kW ut till huset</h3>
      <div class="kvs">
        ${kv('Verkningsgrad', eff == null ? '–' : nf(eff, 0), '%')}${kv('Belastning', nf(num(cfg.inverter_load), 0), '%')}
        ${kv('Temperatur', nf(num(cfg.inverter_temp)), '°C')}${kv('DC-buss', nf(num(cfg.bus_voltage), 0), 'V')}
        ${kv('Nät', `${nf(num(cfg.grid_voltage), 0)} V`, `${nf(num(cfg.grid_frequency), 2)} Hz`)}${kv('Läge', mode ? esc(mode.state) : '–')}
      </div>
      <div class="srow"><span>Exportbegränsning</span><b>${lim && !bad(lim) ? esc(lim.state) : '–'}</b></div>
      <div class="srow"><span>Exportgräns</span><b>${rate == null ? '–' : nf(rate, 0)}<small>%</small></b></div>
      <div class="srow"><span>Serienummer</span><b class="mono">${serial && !bad(serial) ? esc(serial.state) : '–'}</b></div>`;
  }

  // ---------- Ekonomi ----------
  function renderEconomy() {
    const base = money && money.base || {}, y = money && money.year;
    const save = num(cfg.solar_saving), sb = base[cfg.solar_saving], sold = num(cfg.solar_sold), slb = base[cfg.solar_sold];
    const savedToday = save != null && sb != null ? Math.max(0, save - sb) : null, soldToday = sold != null && slb != null ? Math.max(0, sold - slb) : null;
    const paid = num(cfg.solar_paid_pct), paidDate = st(cfg.solar_paid_date), earned = num(cfg.solar_earned_total), inv = num(cfg.solar_investment);
    const price = num(S.growatt_price), rank = num(S.hour_rank);
    $('economy').innerHTML = `<div class="eyebrow">Ekonomi</div><h3>${nf((savedToday || 0) + (soldToday || 0), 2)} kr idag</h3>
      <div class="kvs">
        ${kv('Sparat idag', nf(savedToday, 2), 'kr')}${kv('Sålt idag', nf(soldToday, 2), 'kr')}
        ${kv('Solen i år', y ? nf(y.total_kr, 0) : '–', 'kr')}${kv('Sparar just nu', nf((num(S.solar_earned_rate) || 0) + (num(S.solar_sold_rate) || 0), 2), 'kr/h')}
      </div>
      <div class="so-pb"><span>Återbetalt</span><b>${nf(paid, 1)} %</b></div>${bar(paid, 'sage')}
      <p class="so-note">${earned != null ? `${nf(earned, 0)} kr av ${inv != null ? nf(inv, 0) : '–'} kr` : ''}${paidDate && !bad(paidDate) ? ` · betald ungefär ${new Date(paidDate.state).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' })}` : ''}</p>
      <div class="srow"><span>Elpris nu (Growatt)</span><b>${nf(price, 0)}<small>öre/kWh</small></b></div>
      <div class="srow"><span>Timmens prisrang idag</span><b>${rank == null ? '–' : `${nf(rank, 0)} av 24`}</b></div>
      <div class="srow"><span>Dagens spann</span><b>${nf(num(S.day_ahead_low), 0)}–${nf(num(S.day_ahead_high), 0)}<small>öre/kWh</small></b></div>`;
  }

  // ---------- Grafer ----------
  async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); }
  const histPts = async (id, h) => (await getJSON(`api/history?entity=${encodeURIComponent(id)}&hours=${h}`)).points.map(([t, v]) => [tsOf(t), v]);
  function multiLine(series, opt = {}) {
    const all = series.flatMap(s => s.points);
    if (!all.length) return '<div class="empty">Ingen historik.</div>';
    const Wd = 760, Hh = 240, pl = 36, pr = 8, pt = 10, pb = 22, div = opt.div || 1;
    const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(Date.now(), ...all.map(p => p[0]));
    let lo = 0, hi = Math.max(...all.map(p => p[1] / div));
    if (opt.floor) { const mn = Math.min(...all.map(p => p[1] / div)); lo = Math.floor(mn - 2); hi = Math.ceil(hi + 2); } else { if (hi <= lo) hi = lo + 1; hi *= 1.08; }
    const x = t => pl + (t - t0) / (t1 - t0 || 1) * (Wd - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, hi < 5 ? 1 : 0)}</text>`; }
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600e3; t <= t1; t += 3600e3) { const h = new Date(t).getHours();
      if (h === 0) g += `<line class="midn" x1="${x(t)}" x2="${x(t)}" y1="${pt}" y2="${Hh - pb}"/>`;
      if (h % 3) continue; g += `<text class="ax" x="${x(t)}" y="${Hh - 6}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`; }
    const paths = series.map(s => {
      const p = s.points.map(([t, v]) => [t, v / div]); if (!p.length) return '';
      const d = p.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
      return (s.fill ? `<path class="ar" fill="${s.color}" d="${d}L${x(p[p.length - 1][0])},${y(lo)}L${x(p[0][0])},${y(lo)}Z" style="opacity:.2"/>` : '') + `<path class="ln${s.dash ? ' dash' : ''}" stroke="${s.color}" d="${d}"/>`;
    }).join('');
    const now = Date.now();
    return `<svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="${opt.small ? 'so-sm' : 'so-big'}">${g}${paths}<line class="now" x1="${x(now)}" x2="${x(now)}" y1="${pt}" y2="${Hh - pb}"/></svg>
      <div class="legend">${series.map(s => `<span><i style="background:${s.color};height:3px"></i>${esc(s.label)}</span>`).join('')}</div>`;
  }
  async function loadToday() {
    const el = $('today-chart');
    el.innerHTML = '<div class="eyebrow">Idag · produktion, prognos och förbrukning <span style="float:right">kW</span></div><div class="dchart flat"><div class="empty">Hämtar …</div></div>';
    try {
      const [p, f, l] = await Promise.all([histPts(cfg.solar, 24), histPts(cfg.pv_predicted, 24).catch(() => []), histPts(cfg.load, 24).catch(() => [])]);
      const mid = new Date(); mid.setHours(0, 0, 0, 0);
      const tp = p.filter(q => q[0] >= mid.getTime());
      if (tp.length) { const m = tp.reduce((a, q) => q[1] > a[1] ? q : a); peakToday = { t: m[0], v: m[1] }; renderHero(); }
      el.querySelector('.dchart').innerHTML = multiLine([
        { label: 'Produktion', color: '#d8bb72', points: p, fill: true },
        { label: 'Prognos (Growatt)', color: '#9fb4c8', points: f, dash: true },
        { label: 'Husets förbrukning', color: '#e0895a', points: l },
      ], { div: 1000 });
    } catch (e) { el.querySelector('.dchart').innerHTML = `<div class="empty">Kunde inte hämta (${esc(e.message)}).</div>`; }
    try {
      const [a, b, t] = await Promise.all([histPts(cfg.solar_1, 24), histPts(cfg.solar_2, 24), histPts(cfg.inverter_temp, 24).catch(() => [])]);
      $('strings-chart').innerHTML = '<div class="eyebrow">Sträng 1 mot sträng 2, 24 h <span style="float:right">kW</span></div>' +
        multiLine([{ label: 'Sträng 1', color: '#e0895a', points: a }, { label: 'Sträng 2', color: '#aebf91', points: b }], { div: 1000, small: true });
      $('inverter-chart').innerHTML = '<div class="eyebrow">Temperatur, 24 h <span style="float:right">°C</span></div>' +
        multiLine([{ label: 'Växelriktarens temperatur', color: '#c98f6a', points: t }], { floor: true, small: true });
    } catch (e) { $('strings-chart').innerHTML = `<div class="empty">Kunde inte hämta strängdata (${esc(e.message)}).</div>`; }
  }
  function renderDays() {
    const el = $('days30'), days = hist.days;
    if (!days.length) { el.innerHTML = '<div class="eyebrow">Senaste 30 dagarna</div><div class="empty">Ingen historik.</div>'; return; }
    const outBy = new Map(hist.out.map(([t, v]) => [new Date(t).toDateString(), v]));
    const rows = days.map(([t, v]) => { const o = Math.min(v || 0, Math.max(0, outBy.get(new Date(t).toDateString()) || 0)); return { t, v: v || 0, out: o, self: Math.max(0, (v || 0) - o) }; });
    const Wd = 760, Hh = 220, pl = 34, pr = 8, pt = 12, pb = 22;
    const hi = Math.max(...rows.map(r => r.v)) * 1.1 || 1, n = rows.length, bw = (Wd - pl - pr) / n;
    const y = v => pt + (hi - v) / hi * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = hi * i / 4; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`; }
    rows.forEach((r, i) => {
      const xx = pl + i * bw + bw * .14, w = bw * .72, d = new Date(r.t);
      const tip = `${d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}: ${nf(r.v, 1)} kWh, varav sålt ${nf(r.out, 1)}`;
      g += `<g><title>${tip}</title><rect class="b-self" x="${xx}" y="${y(r.self)}" width="${w}" height="${Math.max(0, y(0) - y(r.self))}"/><rect class="b-out" x="${xx}" y="${y(r.v)}" width="${w}" height="${Math.max(0, y(r.self) - y(r.v))}"/></g>`;
      if (n <= 16 || i % 3 === 0 || i === n - 1) g += `<text class="ax" x="${xx + w / 2}" y="${Hh - 7}" text-anchor="middle">${d.getDate()}/${d.getMonth() + 1}</text>`;
    });
    const avg = rows.reduce((a, r) => a + r.v, 0) / n;
    g += `<line class="mk" x1="${pl}" x2="${Wd - pr}" y1="${y(avg)}" y2="${y(avg)}"/><text class="ax mkt" x="${Wd - pr - 2}" y="${y(avg) - 4}" text-anchor="end">snitt ${nf(avg, 1)} kWh</text>`;
    const tot = rows.reduce((a, r) => a + r.v, 0), totOut = rows.reduce((a, r) => a + r.out, 0);
    el.innerHTML = `<div class="wh"><div><div class="eyebrow">Senaste 30 dagarna</div><h3>${nf(tot, 0)} kWh producerat</h3></div><span class="chip">${tot > 0 ? Math.round((tot - totOut) / tot * 100) : 0} % använt själv</span></div>
      <div class="dchart flat"><svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}</svg>
      <div class="legend"><span><i class="l-self"></i>Använt själv</span><span><i class="l-out"></i>Sålt</span></div></div>`;
  }
  function renderMonths() {
    const el = $('months'), pts = hist.months;
    if (!pts.length) { el.innerHTML = '<div class="eyebrow">Per månad</div><div class="empty">Ingen historik.</div>'; return; }
    const byYear = {};
    for (const [t, v] of pts) { const d = new Date(t); (byYear[d.getFullYear()] = byYear[d.getFullYear()] || Array(12).fill(null))[d.getMonth()] = v; }
    const years = Object.keys(byYear).map(Number).sort().slice(-3);
    const colors = ['#5f6f57', '#9fb4c8', '#d8bb72'].slice(-years.length);
    const Wd = 1100, Hh = 250, pl = 40, pr = 8, pt = 12, pb = 24;
    const hi = Math.max(...years.flatMap(yr => byYear[yr].map(v => v || 0))) * 1.1 || 1, gw = (Wd - pl - pr) / 12, bw = gw * .78 / years.length;
    const y = v => pt + (hi - v) / hi * (Hh - pt - pb);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = hi * i / 4; g += `<line class="gl" x1="${pl}" x2="${Wd - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${nf(v, 0)}</text>`; }
    for (let m = 0; m < 12; m++) {
      years.forEach((yr, k) => { const v = byYear[yr][m]; if (v == null) return;
        const xx = pl + m * gw + gw * .11 + k * bw;
        g += `<rect fill="${colors[k]}" x="${xx}" y="${y(v)}" width="${bw - 1.5}" height="${Math.max(0, y(0) - y(v))}" rx="1.5"><title>${MON[m]} ${yr}: ${nf(v, 0)} kWh</title></rect>`; });
      g += `<text class="ax" x="${pl + m * gw + gw / 2}" y="${Hh - 7}" text-anchor="middle">${MON[m]}</text>`;
    }
    const totals = years.map(yr => byYear[yr].reduce((a, v) => a + (v || 0), 0));
    const now = new Date(), cy = now.getFullYear(), cm = now.getMonth();
    const sameTime = yr => byYear[yr] ? byYear[yr].slice(0, cm).reduce((a, v) => a + (v || 0), 0) : null;
    const prev = sameTime(cy - 1), cur = sameTime(cy);
    el.innerHTML = `<div class="wh"><div><div class="eyebrow">Per månad</div><h3>${nf(totals[totals.length - 1], 0)} kWh hittills i år</h3></div>
        ${prev && cm > 0 ? `<span class="chip ${cur >= prev ? 'on' : 'warn'}">${cur >= prev ? '+' : '−'}${nf(Math.abs(cur - prev) / prev * 100, 0)} % mot jan–${MON[Math.max(0, cm - 1)]} ${cy - 1}</span>` : ''}</div>
      <div class="dchart flat"><svg viewBox="0 0 ${Wd} ${Hh}" preserveAspectRatio="none" class="so-big">${g}</svg>
      <div class="legend">${years.map((yr, k) => `<span><i style="background:${colors[k]}"></i>${yr} · ${nf(totals[k], 0)} kWh</span>`).join('')}</div></div>`;
  }
  function renderRecords() {
    const el = $('records'), days = hist.days, pts = hist.months;
    const best = days.length ? days.reduce((a, p) => (p[1] || 0) > (a[1] || 0) ? p : a) : null;
    const worst = days.length ? days.slice(0, -1).reduce((a, p) => (p[1] ?? 1e9) < (a[1] ?? 1e9) ? p : a, [0, 1e9]) : null;
    const bestM = pts.length ? pts.reduce((a, p) => (p[1] || 0) > (a[1] || 0) ? p : a) : null;
    const total = pts.reduce((a, p) => a + (p[1] || 0), 0);
    const first = pts.length ? new Date(pts[0][0]) : null;
    const yearsRun = first ? (Date.now() - first.getTime()) / (365.25 * 864e5) : null;
    const d = t => new Date(t).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
    const kwp = S.kwp || 14;
    $('records').innerHTML = `<div class="eyebrow">Rekord och totalt</div><h3>${nf(total / 1000, 1)} MWh totalt</h3>
      <div class="srow"><span>Bästa dagen, 30 dagar</span><b>${best ? `${nf(best[1], 1)}<small>kWh · ${d(best[0])}</small>` : '–'}</b></div>
      <div class="srow"><span>Sämsta dagen, 30 dagar</span><b>${worst && worst[1] < 1e9 ? `${nf(worst[1], 1)}<small>kWh · ${d(worst[0])}</small>` : '–'}</b></div>
      <div class="srow"><span>Bästa månaden</span><b>${bestM ? `${nf(bestM[1], 0)}<small>kWh · ${MON[new Date(bestM[0]).getMonth()]} ${new Date(bestM[0]).getFullYear()}</small>` : '–'}</b></div>
      <div class="srow"><span>Sedan start</span><b>${first ? `${MON[first.getMonth()]} ${first.getFullYear()}` : '–'}</b></div>
      <div class="srow"><span>Snitt per år</span><b>${yearsRun > 0.5 ? nf(total / yearsRun, 0) : '–'}<small>kWh</small></b></div>
      <div class="srow"><span>Specifik produktion</span><b>${yearsRun > 0.5 ? nf(total / yearsRun / kwp, 0) : '–'}<small>kWh per kWp och år</small></b></div>
      <div class="srow"><span>Anläggning</span><b>${nf(kwp, 0)} kWp · växelriktare ${nf(S.inverter_kw || 12, 0)} kW</b></div>`;
  }
  async function loadHistory() {
    try {
      const [d, o, m] = await Promise.all([
        getJSON(`api/daily?entity=${encodeURIComponent(cfg.year_stats.pv)}&days=30`),
        getJSON(`api/daily?entity=${encodeURIComponent(cfg.year_stats.grid_out)}&days=30`).catch(() => ({ points: [] })),
        getJSON(`api/monthly?entity=${encodeURIComponent(cfg.year_stats.pv)}&months=36`).catch(() => ({ points: [] })),
      ]);
      hist = { days: d.points.map(([t, v]) => [tsOf(t), v]), out: o.points.map(([t, v]) => [tsOf(t), v]), months: m.points.map(([t, v]) => [tsOf(t), v]) };
    } catch (e) { console.error(e); }
    for (const f of [renderDays, renderMonths, renderRecords]) { try { f(); } catch (e) { console.error(f.name, e); } }
  }
  async function loadMoney() { try { money = await getJSON('api/money'); render(); } catch {} }

  // ---------- Rendering ----------
  let queued = false;
  function render() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const live = connected && !bad(states[cfg.solar]);
      $('badge').className = 'badge ' + (live ? 'live' : 'stale');
      $('badge').lastElementChild.textContent = live ? 'Live · Home Assistant' : 'Väntar på data';
      for (const f of [renderHero, renderForecast, renderStrings, renderInverter, renderEconomy]) { try { f(); } catch (e) { console.error(f.name, e); } }
    });
  }
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();

  async function start() {
    [cfg, S] = await Promise.all([getJSON('api/house'), getJSON('api/solar')]);
    if (S.title) $('title').textContent = S.title;
    if (S.subtitle) $('subtitle').textContent = S.subtitle;
    const es = new EventSource('api/stream');
    let loaded = false;
    es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; render();
      if (!loaded) { loaded = true; loadToday(); loadHistory(); loadMoney(); } });
    es.addEventListener('state', e => { const s = JSON.parse(e.data); states[s.entity_id] = s; render(); });
    es.onerror = () => { connected = false; render(); };
    setInterval(loadToday, 5 * 60 * 1000);
    setInterval(loadHistory, 30 * 60 * 1000);
    setInterval(loadMoney, 10 * 60 * 1000);
  }
  start().catch(e => { $('subtitle').textContent = 'Kunde inte starta: ' + e.message; });
  console.info('observatory solar view', VERSION);
})();
