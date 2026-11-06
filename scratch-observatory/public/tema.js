// Temasidan: välj tema för den här enheten, sätt standard för alla och skapa eller ändra egna teman.
(() => {
  'use strict';
  const VERSION = '0.14.0';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = window.ObsTheme;
  const LABEL = { bg: ['Bakgrund', 'Sidans bakgrund'], panel: ['Kort', 'Rutor och kort'], line: ['Linjer', 'Tunna linjer och kanter'], line2: ['Kanter', 'Knappar och tydligare kanter'],
    text: ['Text', 'Vanlig text'], muted: ['Grå text', 'Förklaringar'], dim: ['Svag text', 'Axlar och små etiketter'],
    sage: ['Grön', 'Sol, besparing, på'], orange: ['Orange', 'Värme, kostnad, effekt'], gold: ['Guld', 'Rubriker och solproduktion'], blue: ['Blå', 'Vatten, ute, kyla'], red: ['Röd', 'Varningar och högt pris'] };
  const KEYS = Object.keys(LABEL);
  let data = null, edit = null;

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
  async function post(body) {
    const r = await fetch('api/themes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  async function load() { data = await T.list(true); render(); }

  // Färg som #rrggbb för färgväljaren (tål rgba och korta hex)
  function hex(v) {
    if (!v) return '#000000';
    const m = /^#([0-9a-f]{3,8})$/i.exec(v.trim());
    if (m) { let h = m[1]; if (h.length <= 4) h = h.split('').map(c => c + c).join(''); return '#' + h.slice(0, 6).toLowerCase(); }
    const r = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    return r ? '#' + [r[1], r[2], r[3]].map(x => (+x).toString(16).padStart(2, '0')).join('') : '#000000';
  }
  function alphaOf(v) { const r = /rgba\([^)]*,\s*([\d.]+)\s*\)/i.exec(v || ''); return r ? +r[1] : 0.86; }
  const rgbaOf = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
  const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mitt-tema';

  function swatch(t) {
    const v = t.vars;
    return `<div class="tprev" style="background:${esc(v.bg)};border-color:${esc(v.line2)}">
      <div class="tp-card" style="background:${esc(v.panel)};border-color:${esc(v.line)}">
        <div class="tp-k" style="color:${esc(v.gold)}">IDAG / ELPRIS</div>
        <div class="tp-v" style="color:${esc(v.text)}">2,64 <small style="color:${esc(v.muted)}">kr/kWh</small></div>
        <div class="tp-dots">${['sage', 'orange', 'gold', 'blue', 'red'].map(k => `<i style="background:${esc(v[k])}"></i>`).join('')}</div>
      </div></div>`;
  }
  function render() {
    const chosen = T.chosen, cur = T.current;
    const def = data.themes.find(t => t.id === data.default);
    $('hero').innerHTML = `<div class="hmain">
        <div class="eyebrow">Tema på den här enheten</div>
        <div class="hbig">${esc((data.themes.find(t => t.id === cur) || {}).name || 'Standard')}</div>
        <div class="hsub">${chosen ? 'Valt på den här enheten.' : `Följer standardtemat för alla enheter, ${esc(def ? def.name : 'Standard')}.`} Temat sparas per webbläsare, så mobilen och datorn kan ha olika teman.</div>
        <div class="btns left">${chosen ? '<button data-act="follow">Följ standardtemat</button>' : ''}<button class="primary" data-act="new">Skapa nytt tema</button></div>
      </div>`;
    $('list').innerHTML = `<div class="eyebrow">Teman</div><h3>${data.themes.length} teman</h3><div class="tgrid">${data.themes.map(t => `
      <div class="tcard ${t.id === cur ? 'cur' : ''}">
        ${swatch(t)}
        <div class="tname"><b>${esc(t.name)}</b><span>${t.builtin ? 'inbyggt' : 'eget'} · ${t.scheme === 'light' ? 'ljust' : 'mörkt'}${t.id === data.default ? ' · standard för alla' : ''}</span></div>
        <div class="btns left">
          ${t.id === cur ? '<span class="chip on">Används</span>' : `<button data-act="use" data-id="${t.id}">Använd</button>`}
          <button data-act="${t.builtin ? 'copy' : 'edit'}" data-id="${t.id}">${t.builtin ? 'Kopiera' : 'Ändra'}</button>
          ${t.id === data.default ? '' : `<button data-act="default" data-id="${t.id}" title="Gäller enheter som inte har valt eget tema">Standard för alla</button>`}
          ${t.builtin ? '' : `<button data-act="delete" data-id="${t.id}">Ta bort</button>`}
        </div>
      </div>`).join('')}</div>`;
    renderEditor();
  }

  function renderEditor() {
    const el = $('editor');
    if (!edit) { el.hidden = true; return; }
    el.hidden = false;
    const v = edit.vars;
    el.innerHTML = `<div class="wh"><div><div class="eyebrow">${edit.existing ? 'Ändra tema' : 'Nytt tema'}</div><h3>${esc(edit.name || 'Namnlöst tema')}</h3></div>
        <div class="btns"><button data-act="cancel">Avbryt</button><button class="primary" data-act="save">Spara tema</button></div></div>
      <div class="ed-top">
        <label class="fld"><span>Namn</span><input id="ed-name" maxlength="40" value="${esc(edit.name)}" placeholder="t.ex. Höstkväll"></label>
        <label class="fld"><span>Id (filnamn)</span><input id="ed-id" maxlength="40" value="${esc(edit.id)}" ${edit.existing ? 'disabled' : ''}></label>
        <div class="fld"><span>Typ</span><div class="seg"><button data-act="scheme" data-v="dark" aria-pressed="${edit.scheme !== 'light'}">Mörkt</button><button data-act="scheme" data-v="light" aria-pressed="${edit.scheme === 'light'}">Ljust</button></div></div>
        <label class="fld"><span>Rutor över husfotot · ${Math.round(alphaOf(v.panel2) * 100)} % täckning</span><input type="range" id="ed-alpha" min="40" max="100" value="${Math.round(alphaOf(v.panel2) * 100)}"></label>
      </div>
      <div class="cgrid">${KEYS.map(k => `<label class="cfld"><input type="color" data-k="${k}" value="${hex(v[k])}"><span><b>${LABEL[k][0]}</b><small>${LABEL[k][1]}</small></span><code>${hex(v[k])}</code></label>`).join('')}</div>
      <p class="so-note">Ändringarna syns direkt på den här sidan medan du väljer. Övriga nyanser, till exempel tonade bakgrunder bakom statusrutor, räknas fram ur de här färgerna. Egna teman sparas på servern i data/themes och fungerar utan att bygga om containern.</p>`;
  }
  function preview() { T.apply({ id: edit.id || 'preview', scheme: edit.scheme, vars: edit.vars }); }
  function startEdit(t, copy) {
    const base = t || data.themes.find(x => x.id === T.current) || data.themes[0];
    edit = { existing: !copy && t && !t.builtin, id: copy ? slug(base.name + '-kopia') : base.id, name: copy ? base.name + ' (kopia)' : base.name, scheme: base.scheme, vars: { ...base.vars } };
    if (!edit.vars.panel2) edit.vars.panel2 = rgbaOf(hex(edit.vars.panel), 0.86);
    render(); preview();
    $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id, t = id && data.themes.find(x => x.id === id);
    try {
      if (act === 'use') { await T.choose(id, false); edit = null; render(); toast(`Temat ${t.name} används nu på den här enheten.`); }
      else if (act === 'follow') { await T.choose(null, false); render(); toast('Följer standardtemat igen.'); }
      else if (act === 'default') { await post({ action: 'default', id }); await load(); toast(`${t.name} är nu standard för enheter som inte valt eget tema.`); }
      else if (act === 'delete') { if (!confirm(`Ta bort temat ${t.name}?`)) return; await post({ action: 'delete', id }); if (T.chosen === id) await T.choose(null, false); await load(); toast('Temat är borttaget.'); }
      else if (act === 'copy') startEdit(t, true);
      else if (act === 'edit') startEdit(t, false);
      else if (act === 'new') startEdit(null, true);
      else if (act === 'scheme') { edit.scheme = b.dataset.v; renderEditor(); preview(); }
      else if (act === 'cancel') { edit = null; await T.choose(T.chosen, false); render(); }
      else if (act === 'save') {
        edit.name = $('ed-name').value.trim() || 'Mitt tema';
        if (!edit.existing) edit.id = slug($('ed-id').value || edit.name);
        await post({ action: 'save', id: edit.id, theme: { name: edit.name, scheme: edit.scheme, vars: edit.vars } });
        const sid = edit.id; edit = null;
        await T.choose(sid, false); await load();
        toast('Temat är sparat och används nu här.');
      }
    } catch (err) { toast('Gick inte: ' + err.message); }
  });
  document.addEventListener('input', e => {
    if (!edit) return;
    const k = e.target.dataset && e.target.dataset.k;
    if (k) { edit.vars[k] = e.target.value; e.target.parentElement.querySelector('code').textContent = e.target.value; if (k === 'panel') edit.vars.panel2 = rgbaOf(e.target.value, alphaOf(edit.vars.panel2)); preview(); }
    if (e.target.id === 'ed-alpha') { edit.vars.panel2 = rgbaOf(hex(edit.vars.panel), (+e.target.value / 100).toFixed(2)); e.target.previousElementSibling.textContent = `Rutor över husfotot · ${e.target.value} % täckning`; preview(); }
    if (e.target.id === 'ed-name') { edit.name = e.target.value; if (!edit.existing) { $('ed-id').value = slug(e.target.value); } }
  });

  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();
  load().catch(e => { $('list').innerHTML = `<div class="empty">Kunde inte hämta teman (${esc(e.message)}).</div>`; });
  console.info('observatory theme view', VERSION);
})();
