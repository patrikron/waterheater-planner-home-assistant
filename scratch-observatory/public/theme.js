// Teman: läses in först i <head> så att färgerna sätts innan sidan ritas.
// Valt tema sparas per enhet (localStorage). Utan eget val gäller serverns standardtema.
(function () {
  'use strict';
  var KEY = 'obs-theme', CACHE = 'obs-theme-cache';
  var root = document.documentElement;
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
