// Teman: läses in först i <head> så att färgerna sätts innan sidan ritas.
// Valt tema sparas per enhet (localStorage). Utan eget val gäller serverns standardtema.
(function () {
  'use strict';
  var KEY = 'obs-theme', CACHE = 'obs-theme-cache';
  var root = document.documentElement;

  // Inbäddad i översiktens panel (sida.html?embed=1): ingen meny eller rubrik, länkar öppnas i hela fönstret
  // och tryck räknas som aktivitet i kiosken så att panelen inte stängs mitt i.
  var EMBED = /[?&]embed(=|&|$)/.test(location.search) && window.parent !== window;
  if (EMBED) {
    root.classList.add('embed');
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target || a.getAttribute('href').charAt(0) === '#') return;
      e.preventDefault();
      // Länk till en annan sida som också finns som panel (t.ex. laddbox -> EV6) byter panel i stället
      var file = a.getAttribute('href').split(/[?#]/)[0];
      try { window.parent.postMessage({ obsOpen: file, href: a.href }, location.origin); } catch (x) { location.href = a.href; }
    }, true);
    ['pointerdown', 'wheel', 'keydown', 'touchmove'].forEach(function (t) {
      document.addEventListener(t, function () { try { window.parent.postMessage('obs-activity', location.origin); } catch (x) {} }, { passive: true });
    });
  }
  var VARS = ['bg', 'panel', 'panel2', 'line', 'line2', 'text', 'muted', 'dim', 'sage', 'orange', 'gold', 'blue', 'red'];
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  function apply(t) {
    for (var i = 0; i < VARS.length; i++) root.style.removeProperty('--' + VARS[i]);
    if (!t || t.id === 'standard') { root.setAttribute('data-theme', 'standard'); root.removeAttribute('data-scheme'); }
    else {
      root.setAttribute('data-theme', t.id);
      root.setAttribute('data-scheme', t.scheme === 'light' ? 'light' : 'dark');
      for (var k in (t.vars || {})) if (VARS.indexOf(k) >= 0) root.style.setProperty('--' + k, t.vars[k]);
    }
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', (t && t.vars && t.vars.bg) || '#0d100e');
    current = t ? t.id : 'standard';
  }
  var current = 'standard';
  try { var c = JSON.parse(get(CACHE) || 'null'); if (c) apply(c); } catch (e) {}

  var listP = null;
  function list(force) {
    if (!listP || force) listP = fetch('api/themes', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.statusText); return r.json(); });
    return listP;
  }
  // Byt tema: id = null betyder "följ serverns standard"
  function choose(id, reload) {
    set(KEY, id);
    return list(true).then(function (d) { sync(d, true); if (reload) location.reload(); });
  }
  function sync(d, quiet) {
    var want = get(KEY) || d.default || 'standard';
    var t = null;
    for (var i = 0; i < d.themes.length; i++) if (d.themes[i].id === want) t = d.themes[i];
    if (!t) for (var j = 0; j < d.themes.length; j++) if (d.themes[j].id === 'standard') t = d.themes[j];
    var before = current;
    apply(t);
    set(CACHE, t ? JSON.stringify(t) : null);
    // Diagrammen läser färgerna när de ritas; om temat ändrades vid första besöket laddas sidan om en gång
    if (!quiet && before !== current && document.readyState === 'complete' && !sessionStorage.getItem('obs-theme-reloaded')) {
      try { sessionStorage.setItem('obs-theme-reloaded', '1'); } catch (e) {}
      location.reload();
    }
  }
  list().then(sync).catch(function () {});

  window.ObsTheme = { list: list, choose: choose, apply: apply, vars: VARS, get current() { return current; }, get chosen() { return get(KEY); } };

  // Liveströmmen (EventSource) håller en anslutning öppen hela tiden. Webbläsaren tillåter bara
  // sex samtidiga anslutningar till samma adress, så flikar i bakgrunden och sidor i
  // bakåt-cachen kunde ta slut på dem och nästa sida hängde sig. Här stängs strömmen när sidan
  // döljs eller lämnas och öppnas igen (med ny ögonblicksbild) när den syns.
  var NativeES = window.EventSource;
  if (NativeES && !NativeES.__obs) {
    var streams = [];
    var ManagedES = function (url, opts) {
      this.url = url; this._opts = opts; this._l = []; this._es = null; this._closed = false;
      this.onopen = this.onmessage = this.onerror = null;
      streams.push(this);
      if (document.visibilityState !== 'hidden') this._open();
    };
    ManagedES.__obs = true;
    ManagedES.CONNECTING = 0; ManagedES.OPEN = 1; ManagedES.CLOSED = 2;
    ManagedES.prototype._open = function () {
      if (this._closed || this._es) return;
      var self = this, es = new NativeES(this.url, this._opts);
      this._es = es;
      for (var i = 0; i < this._l.length; i++) es.addEventListener(this._l[i][0], this._l[i][1], this._l[i][2]);
      es.onopen = function (e) { if (self.onopen) self.onopen(e); };
      es.onmessage = function (e) { if (self.onmessage) self.onmessage(e); };
      es.onerror = function (e) { if (self.onerror) self.onerror(e); };
    };
    ManagedES.prototype._pause = function () { if (this._es) { this._es.close(); this._es = null; } };
    ManagedES.prototype.addEventListener = function (t, f, o) { this._l.push([t, f, o]); if (this._es) this._es.addEventListener(t, f, o); };
    ManagedES.prototype.removeEventListener = function (t, f, o) {
      this._l = this._l.filter(function (x) { return !(x[0] === t && x[1] === f); });
      if (this._es) this._es.removeEventListener(t, f, o);
    };
    ManagedES.prototype.close = function () { this._closed = true; this._pause(); };
    Object.defineProperty(ManagedES.prototype, 'readyState', { get: function () { return this._es ? this._es.readyState : 2; } });
    var pauseAll = function () { for (var i = 0; i < streams.length; i++) streams[i]._pause(); };
    var resumeAll = function () { for (var i = 0; i < streams.length; i++) streams[i]._open(); };
    var hideTimer = null;
    document.addEventListener('visibilitychange', function () {
      clearTimeout(hideTimer);
      // En kort väntan så att ett snabbt flikbyte inte startar om strömmen i onödan
      if (document.visibilityState === 'hidden') hideTimer = setTimeout(pauseAll, 5000);
      else resumeAll();
    });
    window.addEventListener('pagehide', function () { clearTimeout(hideTimer); pauseAll(); });
    document.addEventListener('freeze', function () { clearTimeout(hideTimer); pauseAll(); });
    window.addEventListener('pageshow', function (e) { if (e.persisted && document.visibilityState !== 'hidden') resumeAll(); });
    document.addEventListener('resume', function () { if (document.visibilityState !== 'hidden') resumeAll(); });
    window.EventSource = ManagedES;
  }

  // Menyval "Teman" läggs in i sidomenyn på alla sidor
  document.addEventListener('DOMContentLoaded', function () {
    var side = document.querySelector('nav.side');
    if (!side || side.querySelector('[data-page=tema]')) return;
    var a = document.createElement('a');
    a.className = 'nav-item'; a.href = 'tema.html'; a.setAttribute('data-page', 'tema'); a.title = 'Teman';
    if (document.body.getAttribute('data-page') === 'tema') a.setAttribute('aria-current', 'page');
    a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/></svg><span>Teman</span>';
    var minor = side.querySelector('.nav-item.minor');
    side.insertBefore(a, minor || null);
  });
})();
