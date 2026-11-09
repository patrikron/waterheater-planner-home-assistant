// Kioskläge: helskärm vid första tryck, döljer muspekaren, stänger detaljpanelen efter en stund
// och laddar om sidan en gång per natt så att nya versioner och minne rensas.
(() => {
  'use strict';
  const VERSION = '0.15.0';
  const IDLE_CLOSE = 90 * 1000;     // detaljpanelen stängs efter 1,5 min utan tryck
  const RELOAD_HOUR = 3;            // omladdning kl 03 varje natt
  const body = document.body;

  // Helskärm kräver ett tryck från användaren; misslyckas tyst där det inte stöds
  function fullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const f = el.requestFullscreen || el.webkitRequestFullscreen;
    if (f) try { const p = f.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  document.addEventListener('pointerdown', fullscreen, { once: true });

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

  console.info('observatory kiosk', VERSION);
})();
