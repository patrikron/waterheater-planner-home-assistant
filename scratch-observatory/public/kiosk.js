// Kioskläge: helskärm vid första tryck, döljer muspekaren, stänger detaljpanelen efter en stund
// och laddar om sidan en gång per natt så att nya versioner och minne rensas.
(() => {
  'use strict';
  const VERSION = '0.31.0';
  const IDLE_CLOSE = 90 * 1000;     // detaljpanelen stängs efter 1,5 min utan tryck
  const RELOAD_HOUR = 3;            // omladdning kl 03 varje natt
  const body = document.body;

  // Allt i det här blocket gäller bara kiosk.html. Översikten (index.html) använder bara kalendern och menyn nedan.
  if (body.classList.contains('kiosk')) {
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
    clearTimeout(idle); idle = setTimeout(function close() {
      const d = document.getElementById('drawer');
      if (!d || !d.classList.contains('open')) return;
      // kamerapanelen får stå öppen 5 min utan tryck, sedan stängs den (och liveströmmarna)
      if (d.classList.contains('cams') && !close.x) { close.x = 1; idle = setTimeout(close, 300000 - IDLE_CLOSE); return; }
      document.getElementById('drawer-close').click();
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

  }

  // Översikten: knappar för att visa/dölja menyn och kalendern (valet sparas i webbläsaren)
  if (!body.classList.contains('kiosk')) {
    const btns = document.querySelector('.top .btns'), edit = document.getElementById('edit-btn');
    const opt = (key, label, cls, def) => {
      let on = def; try { const v = localStorage.getItem(key); if (v != null) on = v === '1'; } catch (e) {}
      const b = document.createElement('button'); b.textContent = label; b.className = 'ovtog';
      const set = v => { on = v; body.classList.toggle(cls, on); b.setAttribute('aria-pressed', String(on)); try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) {} window.dispatchEvent(new Event('resize')); };
      b.addEventListener('click', () => set(!on)); set(on);
      if (btns) btns.insertBefore(b, edit);
    };
    opt('obs-ov-menu', 'Meny', 'ov-menu', false);
    opt('obs-ov-cal', 'Kalender', 'ov-cal', false);
  }

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
  // Regn idag från regnmätaren (nollställs vid midnatt), visas bara om det regnat
  const RAIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>';
  function rainHtml() {
    const w = window.ObsHouse && window.ObsHouse.weather(), r = w && w.rain;
    if (r == null || !Number.isFinite(r) || r < 0.1) return '';
    return `${RAIN_SVG}<b>${r.toFixed(1).replace('.', ',')}<small> mm</small></b><span>idag</span>`;
  }
  let lastWx = '', lastWxd = '', lastRain = '';
  window.addEventListener('obs-render', () => {
    const el = document.getElementById('know'), h = nowWx(); if (el && h !== lastWx) { el.innerHTML = h; lastWx = h; }
    const ed = document.getElementById('kwxd'), d = wxDetails(); if (ed && d !== lastWxd) { ed.innerHTML = d; lastWxd = d; }
    const er = document.getElementById('krain'), r = rainHtml(); if (er && r !== lastRain) { er.innerHTML = r; lastRain = r; }
  });
  // tryck på vädret eller regnet öppnar väderpanelen
  document.addEventListener('click', e => { if (e.target.closest('#know,#krain') && window.ObsHouse) window.ObsHouse.open('weather'); });
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
  // Hälsning efter tid på dygnet (Patrik 2026-11-20)
  function greeting(d) {
    const h = d.getHours();
    return h < 5 ? 'God natt' : h < 10 ? 'God morgon' : h < 12 ? 'God förmiddag' : h < 18 ? 'God eftermiddag' : h < 23 ? 'God kväll' : 'God natt';
  }
  // Post: nästa utdelning (PostNord) och hur många gånger brevlådan öppnats idag (Patrik 2026-11-20)
  const POST_SVG = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6.5L20.5 7"/></svg>';
  const BOX_SVG = '<svg viewBox="0 0 24 24"><path d="M6 9a4 4 0 0 1 8 0v9H3V12a3 3 0 0 1 3-3zM14 9h4a3 3 0 0 1 3 3v6h-7M7 13h3M17 4v6M17 4h3v2h-3"/></svg>';
  // Vilka som är hemma (Patrik 2026-11-20): rund bild med statusring, namn och sedan när.
  // Hemma = grön ring + "hemma sedan 17:42", borta = streckad ring, nedtonad bild + "borta 2 h" eller zonen.
  function since(t) {
    const d = t ? new Date(t) : null; if (!d || isNaN(d)) return '';
    const min = Math.round((Date.now() - d) / 6e4), today = new Date().toDateString() === d.toDateString();
    return { min, at: today ? d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('sv-SE', { weekday: 'short' }).replace(/\.$/, '') + ' ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) };
  }
  const dur = m => m < 60 ? m + ' min' : m < 48 * 60 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' dagar';
  function peopleHtml() {
    const H = window.ObsHouse, C = H && H.cfg && H.cfg(), P = C && C.people; if (!P || !P.length || (H.set && H.set().kiosk_people === false)) return '';
    return `<div class="kpeople">${P.map(p => {
      const s = H.st(p.entity), st = s ? s.state : 'unknown';
      const home = st === 'home', known = st && st !== 'unknown' && st !== 'unavailable';
      const t = since(s && (s.last_changed || s.last_updated));
      const where = home ? `hemma${t ? ` <small>${t.at}</small>` : ''}` : st === 'not_home' ? `borta${t && t.min >= 1 ? ` <small>${dur(t.min)}</small>` : ''}` : known ? `${esc(st)}${t && t.min >= 1 ? ` <small>${dur(t.min)}</small>` : ''}` : 'okänt';
      return `<span class="kperson ${home ? 'home' : 'away'}"><span class="kpic"><i>${esc((p.name || '?').slice(0, 1))}</i><img src="/api/person_img?entity=${encodeURIComponent(p.entity)}" alt=""></span><span class="kpn"><b>${esc(p.name)}</b><span title="${esc(home ? 'Hemma' : st === 'not_home' ? 'Borta' : st)}">${where}</span></span></span>`;
    }).join('')}</div>`;
  }
  function postHtml() { return postRow(); }
  function postRow() {
    const H = window.ObsHouse, C = H && H.cfg && H.cfg(), M = C && C.mail; if (!M) return binsHtml();
    const d = H.st(M.delivery), o = H.st(M.opened);
    let post = '';
    if (d && d.attributes && d.attributes.next_delivery) {
      const t = new Date(d.attributes.next_delivery + 'T12:00:00'), now = new Date(); now.setHours(12, 0, 0, 0);
      const days = Math.round((t - now) / 864e5);
      const when = days <= 0 ? 'idag' : days === 1 ? 'imorgon' : t.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' }).replace(/\.$/, '');
      post = `<span class="kp${days <= 0 ? ' due' : ''}">${POST_SVG}<span>Post <b>${esc(when)}</b>${days > 1 ? ` <small>om ${days} dagar</small>` : ''}</span></span>`;
    }
    // Brevlådan: bara ikon och antal öppningar idag, längst till höger på samma rad
    const n = o ? parseInt(o.state, 10) : NaN;
    const box = Number.isFinite(n) ? `<span class="kbox${n > 0 ? ' opened' : ''}" title="Brevlådan öppnad ${n} ${n === 1 ? 'gång' : 'gånger'} idag">${BOX_SVG}<b>${n}</b></span>` : '';
    return (post || box ? `<div class="kprow">${post || '<span></span>'}${box}</div>` : '') + binsHtml();
  }
  // Soptunnor: dagar kvar till nästa tömning, på en rad under posten (från kalendern)
  const BIN_SVG = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
  function binsHtml() {
    const B = cal && cal.bins; if (!B || !B.length) return '';
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const items = B.filter(b => b.next).map(b => {
      const t = new Date(b.next.length <= 10 ? b.next + 'T00:00:00' : b.next); t.setHours(0, 0, 0, 0);
      const n = Math.round((t - d0) / 864e5);
      return `<span class="kbin${n <= 1 ? ' soon' : ''}">${BIN_SVG}<span>${esc(b.name)} <b>${n <= 0 ? 'idag' : n === 1 ? 'imorgon' : n + ' dagar'}</b></span></span>`;
    });
    return items.length ? `<div class="kbins">${items.join('')}</div>` : '';
  }
  let lastPost = '';
  window.addEventListener('obs-render', () => { const el = document.getElementById('kpost'), h = postHtml(); if (el && h !== lastPost) { el.innerHTML = h; lastPost = h; } });
  let lastPeople = '';
  window.addEventListener('obs-render', () => { const el = document.getElementById('kfoot'), h = peopleHtml(); if (el && h !== lastPeople) { el.innerHTML = h; lastPeople = h; } });
  // Matcher (Team Tracker): hemmalagets logga före och bortalagets efter rubriken
  function matchTitle(e) {
    const L = Array.isArray(e.logos) && e.logos.length === 2 && e.logos.every(u => typeof u === 'string' && u.startsWith('/api/sport_img?')) ? e.logos : null;
    if (!L) return esc(e.title);
    return `<span class="kmatch"><img src="${esc(L[0])}" alt="">${esc(e.title)}<img src="${esc(L[1])}" alt=""></span>`;
  }
  function renderCal() {
    if (!kcal) return;
    const now = new Date();
    let html = `<div><div class="kgreet">${greeting(now)}</div><div class="khead"><div class="kclock">${hm(now)}</div><div class="know" id="know">${nowWx()}</div></div><div class="kdrow"><div class="kdl"><div class="kdate">${now.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>`;
    const evs = (cal && cal.events) || [];
    const name = evs.find(e => e.cal === (cal && cal.namedays) && dayKey(startOf(e)) === dayKey(now));
    if (name) html += `<div class="kname">Namnsdag: <b>${esc(name.title.replace(/\s+[–-]\s+\d.*$/, ''))}</b></div>`;
    // Vind/fukt/sol (wxDetails) är bortplockat tills vidare (Patrik 2026-11-09)
    html += `</div><div class="krain" id="krain" data-open="weather">${rainHtml()}</div></div></div><div class="kpost" id="kpost">${postHtml()}</div><div class="kdays">`;
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
          html += `<div class="kev${past ? ' past' : ''}" style="border-left-color:${colors[e.cal] || 'var(--blue)'}"><div class="kt">${t}</div><div class="kx">${matchTitle(e)}${e.location ? `<small>${esc(e.location)}</small>` : ''}</div></div>`;
        }
        html += '</div>';
      }
    }
    kcal.innerHTML = html + `</div><div class="kfoot" id="kfoot">${(lastPeople = peopleHtml())}</div>`;
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

  // ---------- Månadskalender (Patrik 2026-11-20) ----------
  // Tryck i kalenderkolumnen: stor ruta med hela månaden, alla kalendrar och matcher. Tryck på en dag för detaljer.
  const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const WD = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'];
  let mon = null, monY = 0, monM = 0, monSel = null, monData = null, monErr = null, monIdle = null, monReq = 0;
  const isoWeek = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 864e5 + 1) / 7); };
  function monEvents(day) {
    if (!monData) return [];
    const next = new Date(day); next.setDate(day.getDate() + 1);
    return (monData.events || []).filter(e => e.cal !== monData.namedays && startOf(e) < next && endOf(e) > day);
  }
  function monName(day) {
    if (!monData) return '';
    const e = (monData.events || []).find(e => e.cal === monData.namedays && dayKey(startOf(e)) === dayKey(day));
    return e ? e.title : '';
  }
  function monTime(e, day) {
    const next = new Date(day); next.setDate(day.getDate() + 1);
    const s = startOf(e), en = endOf(e);
    return e.all_day || (s <= day && en >= next) ? 'Heldag' : s < day ? 'till ' + hm(en) : hm(s);
  }
  function renderMonth() {
    if (!mon) return;
    const colors = Object.fromEntries(((monData && monData.calendars) || []).map(c => [c.entity, COL[c.color] || c.color]));
    const first = new Date(monY, monM - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const todayK = dayKey(new Date());
    const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(monY, monM, 0).getDate()) / 7);
    let grid = `<div class="kmw"></div>` + WD.map(w => `<div class="kmwd">${w}</div>`).join('');
    for (let w = 0; w < weeks; w++) {
      const wk = new Date(start); wk.setDate(start.getDate() + w * 7);
      grid += `<div class="kmw">${isoWeek(wk)}</div>`;
      for (let i = 0; i < 7; i++) {
        const day = new Date(start); day.setDate(start.getDate() + w * 7 + i);
        const k = dayKey(day), evs = monEvents(day), out = day.getMonth() !== monM - 1;
        const items = evs.slice(0, 4).map(e => `<div class="kme" style="--c:${colors[e.cal] || 'var(--blue)'}"><i>${esc(monTime(e, day) === 'Heldag' ? '' : monTime(e, day))}</i>${esc(e.title)}</div>`).join('');
        grid += `<button type="button" class="kmd${out ? ' out' : ''}${k === todayK ? ' today' : ''}${k === monSel ? ' sel' : ''}${i > 4 ? ' we' : ''}" data-mday="${k}"><span class="kmn">${day.getDate()}</span>${items}${evs.length > 4 ? `<div class="kmmore">+${evs.length - 4} till</div>` : ''}</button>`;
      }
    }
    const selD = monSel ? new Date(monSel + 'T00:00:00') : null, selE = selD ? monEvents(selD) : [];
    const side = selD ? `<div class="kmsh">${esc(selD.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>${monName(selD) ? `<div class="kmname">Namnsdag: <b>${esc(monName(selD))}</b></div>` : ''}` +
      (selE.length ? selE.map(e => `<div class="kev" style="border-left-color:${colors[e.cal] || 'var(--blue)'}"><div class="kt">${esc(monTime(e, selD))}</div><div class="kx">${matchTitle(e)}${e.location ? `<small>${esc(e.location)}</small>` : ''}</div></div>`).join('') : '<div class="knone">Inget inplanerat</div>')
      : '<div class="knone">Tryck på en dag för att se allt den dagen.</div>';
    const legend = ((monData && monData.calendars) || []).map(c => `<span style="--c:${COL[c.color] || c.color}">${esc(c.name)}</span>`).join('');
    mon.innerHTML = `<div class="kmbox" role="dialog" aria-modal="true" aria-label="Månadskalender">
      <div class="kmhead"><div><div class="eyebrow">Kalender</div><h2>${MONTHS[monM - 1]} ${monY}</h2></div>
        <div class="kmleg">${legend}</div>
        <div class="kmnav"><button type="button" data-mnav="-1" aria-label="Föregående månad">‹</button><button type="button" data-mnav="0">Idag</button><button type="button" data-mnav="1" aria-label="Nästa månad">›</button><button type="button" class="kmx" data-mclose aria-label="Stäng">×</button></div></div>
      ${monErr ? `<div class="kerr">Kunde inte hämta kalendern (${esc(monErr)}).</div>` : ''}
      <div class="kmbody"><div class="kmgrid${monData ? '' : ' loading'}" style="--weeks:${weeks}">${grid}</div><aside class="kmside">${side}</aside></div></div>`;
  }
  async function loadMonth() {
    const req = ++monReq; monData = null; monErr = null; renderMonth();
    try { const r = await fetch(`api/calendar/month?y=${monY}&m=${monM}`, { cache: 'no-store' }); if (!r.ok) throw new Error(r.statusText); const d = await r.json(); if (req === monReq) monData = d; }
    catch (e) { if (req === monReq) monErr = e.message; }
    if (req === monReq) renderMonth();
  }
  function monPoke() { clearTimeout(monIdle); if (body.classList.contains('kiosk')) monIdle = setTimeout(closeMonth, 180000); }
  function openMonth() {
    const now = new Date(); monY = now.getFullYear(); monM = now.getMonth() + 1; monSel = dayKey(now);
    if (!mon) { mon = document.createElement('div'); mon.id = 'kmonth'; mon.className = 'kmonth'; body.appendChild(mon); }
    mon.hidden = false; requestAnimationFrame(() => mon.classList.add('open')); monPoke(); loadMonth();
  }
  function closeMonth() { if (!mon) return; clearTimeout(monIdle); mon.classList.remove('open'); setTimeout(() => { if (!mon.classList.contains('open')) mon.hidden = true; }, 250); }
  document.addEventListener('click', e => {
    if (mon && !mon.hidden) {
      monPoke();
      const nav = e.target.closest('[data-mnav]'), day = e.target.closest('[data-mday]');
      if (e.target.closest('[data-mclose]') || e.target === mon) return closeMonth();
      if (nav) { const n = +nav.dataset.mnav; if (!n) { const t = new Date(); monY = t.getFullYear(); monM = t.getMonth() + 1; monSel = dayKey(t); } else { monM += n; if (monM < 1) { monM = 12; monY--; } if (monM > 12) { monM = 1; monY++; } monSel = null; } return loadMonth(); }
      if (day) { monSel = day.dataset.mday; return renderMonth(); }
      return;
    }
    if (kcal && e.target.closest('#kcal .kdays')) openMonth();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && mon && !mon.hidden) closeMonth(); });

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
      const mb = document.getElementById('kmenu-media');
      if (mb && H && H.mediaPlaying) { const n = H.mediaPlaying(); mb.textContent = n ? String(n) : ''; mb.hidden = !n; }
      const rb = document.getElementById('kmenu-rads');
      if (rb && H && H.rads) { const n = H.rads(); rb.textContent = n ? String(n) : ''; rb.hidden = !n; }
      const inf = document.getElementById('kmenu-info');
      if (inf && H && H.alerts) { const a = H.alerts(); inf.textContent = a ? String(a) : ''; inf.hidden = !a; }
      const al = H && H.alarm ? H.alarm() : null, ab = document.getElementById('kmenu-alarmbtn'), ai = document.getElementById('kmenu-alarm'), ban = document.getElementById('kalarm');
      if (ab) {
        ab.hidden = !al;
        if (al) {
          const short = { disarmed: '', armed_home: 'Hemma', armed_away: 'Borta', armed_night: 'Natt', armed_vacation: 'Semester', arming: '…', disarming: '…', pending: '!', triggered: 'LARM' }[al.state] ?? '?';
          ai.textContent = short; ai.className = 'al-' + al.cls; ab.className = 'al-' + al.cls; ab.title = 'Larm: ' + al.label; ab.setAttribute('aria-label', 'Larm, ' + al.label);
        }
      }
      if (ban) { const on = !!al && (al.state === 'triggered' || al.state === 'pending'); ban.hidden = !on; if (on) ban.textContent = al.label + ' – tryck för att avlarma'; }
      const km = document.getElementById('kmedia');
      if (km && H && H.media) { const h = H.media(); km.hidden = !h; if (h !== km._h) { km.innerHTML = h; km._h = h; fitMedia(); } }
      const sk = schoolText(); if (sk !== lastSchool) { lastSchool = sk; renderCal(); }
    });
  }
})();
