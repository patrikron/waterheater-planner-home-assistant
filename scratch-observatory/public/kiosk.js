// Kioskläge: helskärm vid första tryck, döljer muspekaren, stänger detaljpanelen efter en stund
// och laddar om sidan en gång per natt så att nya versioner och minne rensas.
(() => {
  'use strict';
  const VERSION = '0.29.0';
  const IDLE_CLOSE = 90 * 1000;     // detaljpanelen stängs efter 1,5 min utan tryck
  const RELOAD_HOUR = 3;            // omladdning kl 03 varje natt
  const body = document.body;

  // Lätt läge för svagare plattor: kiosk.html?lite (sparas på enheten), kiosk.html?lite=0 stänger av.
  // Tar bort suddig bakgrund, glöd och rörliga prickar på linjerna.
  (() => {
    const q = new URLSearchParams(location.search);
    try {
      if (q.has('lite')) { if (q.get('lite') === '0') localStorage.removeItem('obs-lite'); else localStorage.setItem('obs-lite', '1'); }
      if (localStorage.getItem('obs-lite') === '1' || (q.has('lite') && q.get('lite') !== '0')) body.classList.add('lite');
    } catch (e) { if (q.has('lite') && q.get('lite') !== '0') body.classList.add('lite'); }
  })();

  // Helskärm kräver ett tryck från användaren; misslyckas tyst där det inte stöds
  function fullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const f = el.requestFullscreen || el.webkitRequestFullscreen;
    if (f) try { const p = f.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  document.addEventListener('pointerdown', fullscreen, { once: true });

  // Format för mindre/fyrkantigare skärmar: kiosk.html?10 beskär bilden 10 % på var sida (passar 10" 16:10),
  // kiosk.html?crop=15 väljer egen procent, kiosk.html?crop=0 tillbaka till hela bilden. Valet sparas på enheten.
  (() => {
    const q = new URLSearchParams(location.search);
    let pct = null;
    if (q.has('10')) pct = 10; else if (q.has('crop')) pct = Math.max(0, Math.min(25, parseFloat(q.get('crop')) || 0));
    try {
      if (pct != null) { if (pct > 0) localStorage.setItem('obs-crop', String(pct)); else localStorage.removeItem('obs-crop'); }
      else pct = parseFloat(localStorage.getItem('obs-crop')) || 0;
    } catch (e) { pct = pct || 0; }
    if (!(pct > 0)) return;
    const c = pct / 100, ar = 2400 * (1 - 2 * c) / 1169, stage = document.getElementById('stage');
    if (!stage) return;
    stage.classList.add('crop'); stage.style.setProperty('--crop', String(c)); stage.style.aspectRatio = `${(2400 * (1 - 2 * c)).toFixed(1)} / 1169`;
    body.style.setProperty('--ar', String(ar));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  })();

  // Muspekaren och panelen
  let idle = null, cursor = null;
  function activity() {
    body.classList.remove('hide-cursor');
    clearTimeout(cursor); cursor = setTimeout(() => body.classList.add('hide-cursor'), 4000);
    clearTimeout(idle); idle = setTimeout(() => {
      const d = document.getElementById('drawer');
      if (d && d.classList.contains('open')) document.getElementById('drawer-close').click();
    }, IDLE_CLOSE);
  }
  ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(e => document.addEventListener(e, activity, { passive: true }));
  activity();
  window.addEventListener('message', e => { if (e.origin === location.origin && e.data === 'obs-activity') activity(); });

  // Visa en liten markering när översikten väntar på data
  const badge = document.getElementById('badge');
  const dot = document.createElement('div');
  dot.className = 'kiosk-dot'; dot.hidden = true; dot.innerHTML = '<i></i><span>Väntar på data</span>';
  body.appendChild(dot);
  let staleT = null;
  function watch() {
    const stale = !badge.classList.contains('live');
    clearTimeout(staleT);
    // Vänta lite innan markeringen visas, så att den inte blinkar till vid start eller kort avbrott
    if (stale) staleT = setTimeout(() => { dot.hidden = false; }, 8000); else dot.hidden = true;
  }
  if (badge) { new MutationObserver(watch).observe(badge, { attributes: true, attributeFilter: ['class'] }); watch(); }

  // Nattlig omladdning, bara om servern svarar så att skärmen inte blir tom
  function scheduleReload() {
    const now = new Date(), next = new Date(now);
    next.setHours(RELOAD_HOUR, Math.floor(Math.random() * 20), 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(async () => {
      try { const r = await fetch('healthz', { cache: 'no-store' }); if (r.ok || r.status === 503) location.reload(); else scheduleReload(); }
      catch (e) { scheduleReload(); }
    }, next - now);
  }
  scheduleReload();

  // Skärmen hålls vaken där webbläsaren tillåter det (kräver oftast https)
  async function wake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch (e) {} }
  document.addEventListener('visibilitychange', wake); wake();

  // ---------- Kalenderkolumnen ----------
  const kcal = document.getElementById('kcal');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const COL = { blue: 'var(--blue)', gold: 'var(--gold)', orange: 'var(--orange)', sage: 'var(--sage)', red: 'var(--red)', green: 'var(--sage)' };
  let cal = null, calErr = null;
  const dayKey = d => d.toLocaleDateString('sv-SE');
  // Heldagshändelser har bara datum ("2026-11-14"), övriga har klockslag
  const startOf = e => e.all_day ? new Date(e.start + 'T00:00:00') : new Date(e.start);
  const endOf = e => e.all_day ? new Date(e.end + 'T00:00:00') : new Date(e.end);
  const hm = d => d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  // Dagens väder bredvid klockan, från samma livedata som väderrutan
  function nowWx() {
    const w = window.ObsHouse && window.ObsHouse.weather(), I = window.ObsIcons;
    if (!w || !I) return '';
    return `${I.wx(w.cond, 'knowi')}<div><b>${w.temp != null && Number.isFinite(w.temp) ? Math.round(w.temp) + '°' : '–'}</b><span>${esc(I.label(w.cond))}</span></div>`;
  }
  // Vind, fukt och sol upp/ned som små ikoner till höger om datum och namnsdag
  const KI = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const KICON = {
    wind: KI('<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>'),
    hum: KI('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
    rise: KI('<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 4v6M9 7l3-3 3 3"/>'),
    set: KI('<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 4v6M9 7l3 3 3-3"/>'),
  };
  function wxDetails() {
    const w = window.ObsHouse && window.ObsHouse.weather();
    if (!w) return '';
    const n1 = v => v == null || !Number.isFinite(+v) ? '–' : (+v).toFixed(1).replace('.', ',');
    const it = (ic, cls, v, t) => `<span class="${cls}" title="${t}">${KICON[ic]}<b>${v}</b></span>`;
    return it('wind', 'kx-w', `${n1(w.wind)}<small> m/s</small>`, 'Vind') + it('hum', 'kx-h', `${w.humidity != null ? Math.round(w.humidity) : '–'}<small> %</small>`, 'Luftfuktighet')
      + it('rise', 'kx-r', esc(w.rise || '–'), 'Sol upp') + it('set', 'kx-s', esc(w.set || '–'), 'Sol ned');
  }
  let lastWx = '', lastWxd = '';
  window.addEventListener('obs-render', () => {
    const el = document.getElementById('know'), h = nowWx(); if (el && h !== lastWx) { el.innerHTML = h; lastWx = h; }
    const ed = document.getElementById('kwxd'), d = wxDetails(); if (ed && d !== lastWxd) { ed.innerHTML = d; lastWxd = d; }
  });
  let lastSchool = '';
  // Skolmat idag och imorgon (input_text i HA), bara vardagar
  function schoolText() {
    const H = window.ObsHouse, t = H && H.st && H.st('input_text.skolmat_idag'), m = H && H.st && H.st('input_text.skolmat_imorgon');
    const ok = x => x && x.state && !['unknown', 'unavailable', ''].includes(x.state) ? x.state : '';
    return JSON.stringify([ok(t), ok(m)]);
  }
  const SCHOOL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v8a2 2 0 0 0 2 2v8M9 3v8a2 2 0 0 1-2 2M7 3v6M17 21V3c-2 1-3 3.5-3 7s1 4 3 4"/></svg>';
  function schoolHtml(i, day) {
    const wd = day.getDay(); if (wd === 0 || wd === 6) return '';
    const txt = JSON.parse(lastSchool || '["",""]')[i]; if (!txt) return '';
    return `<div class="kschool">${SCHOOL_SVG}<div><span>Skolmat</span>${txt.split(/\s*•\s*/).map(x => `<b>${esc(x)}</b>`).join('')}</div></div>`;
  }
  function renderCal() {
    if (!kcal) return;
    const now = new Date();
    let html = `<div><div class="khead"><div class="kclock">${hm(now)}</div><div class="know" id="know">${nowWx()}</div></div><div class="kdrow"><div class="kdl"><div class="kdate">${now.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>`;
    const evs = (cal && cal.events) || [];
    const name = evs.find(e => e.cal === (cal && cal.namedays) && dayKey(startOf(e)) === dayKey(now));
    if (name) html += `<div class="kname">Namnsdag: <b>${esc(name.title.replace(/\s+[–-]\s+\d.*$/, ''))}</b></div>`;
    // Vind/fukt/sol (wxDetails) är bortplockat tills vidare (Patrik 2026-11-09)
    html += `</div></div></div><div class="kdays">`;
    if (!cal) html += `<div class="kerr">${calErr ? 'Kunde inte hämta kalendern (' + esc(calErr) + ').' : 'Hämtar kalendern …'}</div>`;
    else {
      const colors = Object.fromEntries((cal.calendars || []).map(c => [c.entity, COL[c.color] || c.color]));
      const wx = Object.fromEntries((cal.forecast || []).map(f => [dayKey(new Date(f.t)), f]));
      const list = evs.filter(e => e.cal !== cal.namedays);
      const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
      for (let i = 0; i < cal.days; i++) {
        const day = new Date(d0); day.setDate(d0.getDate() + i);
        const next = new Date(day); next.setDate(day.getDate() + 1);
        const today = list.filter(e => startOf(e) < next && endOf(e) > day);
        if (!today.length && i > 1) continue; // dagar utan händelser visas inte, utom idag och imorgon
        const label = i === 0 ? 'Idag' : i === 1 ? 'Imorgon' : day.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
        const f = wx[dayKey(day)];
        html += `<div class="kday${i === 0 ? ' today' : ''}"><div class="kday-h"><div class="eyebrow">${esc(label)}</div>${f ? `<div class="kwx">${window.ObsIcons ? window.ObsIcons.wx(f.cond, 'kwxi') : ''}<b>${Math.round(f.hi)}°</b>${f.lo != null ? ' / ' + Math.round(f.lo) + '°' : ''}</div>` : ''}</div>`;
        if (i < 2) html += schoolHtml(i, day);
        if (!today.length) html += '<div class="knone">Inget inplanerat</div>';
        for (const e of today) {
          const s = startOf(e), en = endOf(e);
          const t = e.all_day || (s <= day && en >= next) ? 'Heldag' : s < day ? 'till ' + hm(en) : hm(s);
          const past = !e.all_day && en < now;
          html += `<div class="kev${past ? ' past' : ''}" style="border-left-color:${colors[e.cal] || 'var(--blue)'}"><div class="kt">${t}</div><div class="kx">${esc(e.title)}${e.location ? `<small>${esc(e.location)}</small>` : ''}</div></div>`;
        }
        html += '</div>';
      }
    }
    kcal.innerHTML = html + '</div>';
  }
  async function loadCal() {
    try { const r = await fetch('api/calendar', { cache: 'no-store' }); if (!r.ok) throw new Error(r.statusText); cal = await r.json(); calErr = null; }
    catch (e) { calErr = e.message; }
    renderCal();
  }
  if (kcal) {
    renderCal(); loadCal();
    setInterval(loadCal, 5 * 60 * 1000);
    // Klockan uppdateras på hela minuten
    const tickCal = () => { renderCal(); setTimeout(tickCal, 60000 - Date.now() % 60000 + 50); };
    setTimeout(tickCal, 60000 - Date.now() % 60000 + 50);
  }

  console.info('observatory kiosk', VERSION);
  // Media överst: alltid en rad. Får inte alla plats döljs de sista och en "+N"-knapp öppnar panelen med alla.
  function fitMedia() {
    const km = document.getElementById('kmedia'); if (!km || km.hidden) return;
    const old = km.querySelector('.kmmore'); if (old) old.remove();
    const items = [...km.querySelectorAll('.kmp')]; items.forEach(x => { x.hidden = false; });
    if (km.scrollWidth <= km.clientWidth + 1) return;
    const more = document.createElement('button'); more.className = 'kmmore'; km.appendChild(more);
    let hid = 0;
    for (let i = items.length - 1; i > 0 && km.scrollWidth > km.clientWidth + 1; i--) { items[i].hidden = true; hid++; more.textContent = '+' + hid; }
    if (!hid) more.remove();
  }
  window.addEventListener('resize', fitMedia);
  document.addEventListener('click', e => { if (e.target.closest('.kmmore') && window.ObsHouse) window.ObsHouse.open('media'); if (e.target.closest('#kalarm') && window.ObsHouse) window.ObsHouse.open('alarm'); });
  // Meny längst ner: Lampor och barnens poäng öppnas i panelen från höger
  const kmenu = document.getElementById('kmenu');
  if (kmenu) {
    kmenu.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b && window.ObsHouse && window.ObsHouse.open) window.ObsHouse.open(b.dataset.open); });
    const cnt = document.getElementById('kmenu-lights');
    window.addEventListener('obs-render', () => {
      const n = window.ObsHouse && window.ObsHouse.lightsOn ? window.ObsHouse.lightsOn() : 0;
      cnt.textContent = n ? String(n) : ''; cnt.hidden = !n;
      const H = window.ObsHouse;
      const vac = document.getElementById('kmenu-vac'), vs = H && H.st && H.st('vacuum.l20_ultra');
      if (vac) { const t = vs && vs.state === 'cleaning' ? 'städar' : vs && vs.state === 'error' ? 'fel' : ''; vac.textContent = t; vac.hidden = !t; }
      const inf = document.getElementById('kmenu-info');
      if (inf && H && H.alerts) { const a = H.alerts(); inf.textContent = a ? String(a) : ''; inf.hidden = !a; }
      const al = H && H.alarm ? H.alarm() : null, ab = document.getElementById('kmenu-alarmbtn'), ai = document.getElementById('kmenu-alarm'), ban = document.getElementById('kalarm');
      if (ab) {
        ab.hidden = !al;
        if (al) {
          const short = { disarmed: 'Av', armed_home: 'Hemma', armed_away: 'Borta', armed_night: 'Natt', armed_vacation: 'Semester', arming: '…', disarming: '…', pending: '!', triggered: 'LARM' }[al.state] || '?';
          ai.textContent = short; ai.className = 'al-' + al.cls; ab.className = 'al-' + al.cls;
        }
      }
      if (ban) { const on = !!al && (al.state === 'triggered' || al.state === 'pending'); ban.hidden = !on; if (on) ban.textContent = al.label + ' – tryck för att avlarma'; }
      const km = document.getElementById('kmedia');
      if (km && H && H.media) { const h = H.media(); km.hidden = !h; if (h !== km._h) { km.innerHTML = h; km._h = h; fitMedia(); } }
      const sk = schoolText(); if (sk !== lastSchool) { lastSchool = sk; renderCal(); }
    });
  }
})();
