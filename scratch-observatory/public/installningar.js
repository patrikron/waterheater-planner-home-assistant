// Inställningssidan: funktioner som går att slå av och på, och gränser för färgerna i översiktens rutor.
// Sparas på servern (data/settings.json) och gäller alla skärmar; översikten och kiosken läser om dem varje minut.
(() => {
  'use strict';
  const VERSION = '0.36.0';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = v => (+v).toLocaleString('sv-SE', { maximumFractionDigits: 1 });
  let S = null, saved = null;

  const TOGGLES = [
    ['value_colors', 'Färgade värden', 'Solpaneler blir gul när de producerar. Huset och Import/Export färgas efter hur stor effekten är.'],
    ['solar_shimmer', 'Skimmer på solpanelerna', 'Ett svagt sken och en ljusstrimma över taket på bilden när panelerna producerar.'],
  ];
  const LIMITS = [
    { title: 'Huset (förbrukning)', keys: ['house_low_kw', 'house_high_kw', 'house_max_kw'],
      scale: s => [['c-low', `under ${nf(s.house_low_kw)} kW`, 'Låg'], ['', `${nf(s.house_low_kw)}–${nf(s.house_high_kw)} kW`, 'Normal'], ['c-warn', `${nf(s.house_high_kw)}–${nf(s.house_max_kw)} kW`, 'Hög'], ['c-high', `över ${nf(s.house_max_kw)} kW`, 'Mycket hög']],
      labels: ['Låg under', 'Hög från', 'Mycket hög från'] },
    { title: 'Import / Export', keys: ['import_high_kw', 'import_max_kw'],
      scale: s => [['c-low', 'export (säljer)', 'Export'], ['', `import under ${nf(s.import_high_kw)} kW`, 'Normal'], ['c-warn', `${nf(s.import_high_kw)}–${nf(s.import_max_kw)} kW`, 'Hög'], ['c-high', `över ${nf(s.import_max_kw)} kW`, 'Mycket hög']],
      labels: ['Hög import från', 'Mycket hög från'] },
  ];

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
  const dirty = () => JSON.stringify(S) !== JSON.stringify(saved);
  // Gränserna måste stiga, annars blir färgskalan fel
  function problem() {
    for (const g of LIMITS) for (let i = 1; i < g.keys.length; i++) if (!(S[g.keys[i]] > S[g.keys[i - 1]])) return `${g.title}: ${g.labels[i].toLowerCase()} måste vara större än ${g.labels[i - 1].toLowerCase()}.`;
    return '';
  }
  function render() {
    const err = problem();
    $('set').innerHTML = `<div class="wh"><div><div class="eyebrow">Översikten och kiosken</div><h3>Visning</h3></div>
        <div class="btns"><button data-act="reset" ${dirty() ? '' : 'disabled'}>Ångra</button><button class="primary" data-act="save" ${dirty() && !err ? '' : 'disabled'}>Spara</button></div></div>
      <div class="srows">${TOGGLES.map(([k, l, d]) => `<div class="srow"><div><b>${esc(l)}</b><small>${esc(d)}</small></div>
        <button class="tgl ${S[k] ? 'on' : ''}" data-tgl="${k}" aria-pressed="${!!S[k]}"><i></i>${S[k] ? 'På' : 'Av'}</button></div>`).join('')}</div>
      <div class="eyebrow sgap">Gränser för färgerna</div>
      <div class="lgrid${S.value_colors ? '' : ' off'}">${LIMITS.map(g => `<div class="lcard"><h4>${esc(g.title)}</h4>
        <div class="lfl">${g.keys.map((k, i) => `<label class="fld"><span>${esc(g.labels[i])}</span><span class="nin"><input type="number" inputmode="decimal" min="0" max="50" step="0.1" data-num="${k}" value="${S[k]}"><em>kW</em></span></label>`).join('')}</div>
        <div class="lscale">${g.scale(S).map(([c, t, n]) => `<div class="ls"><b class="v ${c}">${esc(n)}</b><small>${esc(t)}</small></div>`).join('')}</div></div>`).join('')}</div>
      ${err ? `<div class="serr">${esc(err)}</div>` : ''}
      <p class="snote">Sparade inställningar gäller alla skärmar. Översikten och kiosken hämtar dem inom en minut.</p>`;
  }
  async function load() {
    const r = await fetch('api/settings', { cache: 'no-store' }); if (!r.ok) throw new Error(r.statusText);
    saved = await r.json(); delete saved.saved; S = { ...saved }; render();
  }
  async function save() {
    const r = await fetch('api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast('Kunde inte spara: ' + (j.error || r.statusText));
    saved = { ...j }; S = { ...j }; render(); toast('Inställningarna är sparade.');
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tgl]'), a = e.target.closest('[data-act]');
    if (t) { S[t.dataset.tgl] = !S[t.dataset.tgl]; render(); }
    if (a && a.dataset.act === 'save') save();
    if (a && a.dataset.act === 'reset') { S = { ...saved }; render(); }
  });
  document.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.num; if (!k) return;
    const v = parseFloat(String(e.target.value).replace(',', '.'));
    if (Number.isFinite(v) && v >= 0 && v <= 50) S[k] = Math.round(v * 10) / 10;
    render();
  });
  window.addEventListener('beforeunload', e => { if (S && dirty()) e.preventDefault(); });
  function tick() {
    const d = new Date();
    $('clock').textContent = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tick, 20000); tick();
  load().catch(e => { $('set').innerHTML = `<div class="empty">Kunde inte hämta inställningarna (${esc(e.message)}).</div>`; });
  console.info('observatory settings view', VERSION);
})();
