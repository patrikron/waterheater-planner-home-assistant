// Planritning: öppnas när man klickar på huset. Ritningen är omritad i sajtens stil, och lampor och
// sensorer från config (house.lights, house.info, temperatursidan och elementen) placeras ut i
// redigeringsläget. Placeringen sparas på servern (data/plan.json) och delas av alla skärmar.
(() => {
  'use strict';
  const VERSION = '0.32.0';
  const H = () => window.ObsHouse || {};
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = (v, d = 1) => v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const st = id => H().st ? H().st(id) : undefined;
  const bad = s => !s || ['unknown', 'unavailable', ''].includes(s.state);
  const num = id => { const s = st(id); if (bad(s)) return null; const v = parseFloat(s.state); return Number.isFinite(v) ? v : null; };

  // ---------- Ritningen (koordinater från originalritningen, px) ----------
  const VB = [330, 85, 920, 840]; // x, y, bredd, höjd
  const ROOMS = [
    { id: 'tvatt', name: 'Förråd / tvätt', r: [343, 112, 512, 272], l: [430, 190] },
    { id: 'uterum_n', name: 'Uterum', r: [512, 112, 720, 312], l: [622, 175] },
    { id: 'kontor', name: 'Kontor', r: [343, 272, 512, 360], l: [427, 318] },
    { id: 'sovrum_v', name: 'Sovrum', r: [343, 360, 512, 472], l: [427, 414] },
    { id: 'uterum_s', name: 'Uterum', sub: '17,5 m²', r: [343, 472, 512, 662], l: [427, 548] },
    { id: 'kok', name: 'Kök', r: [512, 312, 838, 472], l: [622, 383], poly: [[512, 312], [838, 312], [838, 472], [650, 472], [650, 472], [512, 472]] },
    { id: 'matplats', name: 'Matplats', label: true, l: [766, 383] },
    { id: 'hall', name: 'Hall', r: [512, 472, 650, 672], l: [584, 522] },
    { id: 'bad', name: 'Bad', sub: '4,5 m²', r: [512, 558, 582, 668], l: [547, 612] },
    { id: 'vardagsrum', name: 'Vardagsrum', r: [650, 472, 838, 672], l: [755, 588] },
    { id: 'sovrum_n', name: 'Sovrum', sub: '16,4 m²', r: [838, 312, 995, 472], l: [918, 380] },
    { id: 'klad', name: 'Klädkammare', small: true, r: [872, 478, 995, 518], l: [933, 498] },
    { id: 'sovrum_s', name: 'Sovrum', sub: '15,6 m²', r: [838, 518, 995, 672], l: [918, 600] },
    { id: 'entre_g', name: '', r: [995, 678, 1100, 725], l: [1048, 700] },
    { id: 'forrad', name: 'Förråd', r: [1100, 678, 1230, 725], l: [1165, 702] },
    { id: 'garage', name: 'Garage', big: true, r: [995, 725, 1230, 902], l: [1112, 815] },
    { id: 'verkstad', name: 'Verkstad', label: true, l: [1095, 757] },
    { id: 'pumprum', name: 'Pumprum', small: true, r: [1150, 735, 1228, 778], l: [1189, 757] },
  ];
  const OUTLINE = [[343, 112], [720, 112], [720, 312], [995, 312], [995, 672], [512, 672], [512, 662], [343, 662]];
  // Fönster: [x1, y1, x2, y2] på ytterväggarna
  const WINDOWS = [[362, 112, 445, 112], [470, 112, 500, 112], [590, 112, 690, 112], [720, 130, 720, 190], [720, 215, 720, 285],
    [565, 312, 615, 312], [745, 312, 795, 312], [882, 312, 935, 312], [995, 570, 995, 615], [690, 672, 800, 672],
    [343, 498, 343, 560], [343, 585, 343, 640], [360, 662, 500, 662], [1020, 902, 1205, 902]];
  // Dörrar: [x1, y1, x2, y2] öppningar i väggen
  const DOORS = [[590, 672, 640, 672], [532, 112, 562, 112], [1010, 678, 1040, 678]];
  const P = (x, y) => [((x - VB[0]) / VB[2] * 100), ((y - VB[1]) / VB[3] * 100)];
  const roomCenter = id => { const r = ROOMS.find(q => q.id === id); return r ? P(...r.l) : [50, 50]; };

  function planSvg() {
    const rect = r => `x="${r[0]}" y="${r[1]}" width="${r[2] - r[0]}" height="${r[3] - r[1]}"`;
    const rooms = ROOMS.filter(r => r.r).map(r => `<rect class="room${r.id === 'garage' || r.id === 'entre_g' || r.id === 'forrad' || r.id === 'pumprum' ? ' cold' : ''}" data-room="${r.id}" ${rect(r.r)}/>`).join('');
    const labels = ROOMS.filter(r => r.name).map(r => `<text class="rl${r.small ? ' sm' : ''}${r.big ? ' big' : ''}" x="${r.l[0]}" y="${r.l[1]}" text-anchor="middle">${esc(r.name.toUpperCase())}</text>${r.sub ? `<text class="rs" x="${r.l[0]}" y="${r.l[1] + 16}" text-anchor="middle">${r.sub}</text>` : ''}`).join('');
    const out = `<polygon class="outline" points="${OUTLINE.map(p => p.join(',')).join(' ')}"/><rect class="outline" x="995" y="678" width="235" height="224"/>`;
    const win = WINDOWS.map(w => `<line class="winbg" x1="${w[0]}" y1="${w[1]}" x2="${w[2]}" y2="${w[3]}"/><line class="win" x1="${w[0]}" y1="${w[1]}" x2="${w[2]}" y2="${w[3]}"/>`).join('');
    const doors = DOORS.map(w => `<line class="door" x1="${w[0]}" y1="${w[1]}" x2="${w[2]}" y2="${w[3]}"/>`).join('');
    const steps = `<rect class="steps" x="586" y="676" width="58" height="56"/><line class="stepl" x1="586" y1="694" x2="644" y2="694"/><line class="stepl" x1="586" y1="712" x2="644" y2="712"/>`;
    // Inredning som hjälper till att känna igen rummen
    const furn = `<rect class="fx" x="540" y="444" width="48" height="26" rx="2"/><circle class="fx" cx="552" cy="457" r="4"/><circle class="fx" cx="568" cy="457" r="4"/>
      <rect class="fx" x="700" y="438" width="36" height="32" rx="2"/><circle class="fx" cx="718" cy="454" r="7"/>
      <rect class="fx" x="652" y="548" width="24" height="116" rx="2"/><rect class="fx" x="840" y="560" width="22" height="106" rx="2"/>
      <path class="fx" d="M518 566 a26 26 0 0 1 26 26 h-26z"/><rect class="fx" x="522" y="640" width="18" height="22" rx="8"/>
      <rect class="fx" x="530" y="242" width="74" height="62"/><line class="fx" x1="530" y1="262" x2="604" y2="262"/><line class="fx" x1="530" y1="282" x2="604" y2="282"/>`;
    return `<svg class="plansvg" viewBox="${VB.join(' ')}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${rooms}${furn}${out}${win}${doors}${steps}${labels}</svg>`;
  }

  // ---------- Vad som går att placera ----------
  let catalog = null, TEMPS = null, RAD = null;
  const KIND_L = { light: 'Lampor', temp: 'Temperatur', door: 'Dörrar', motion: 'Rörelse', leak: 'Vattenläckage', smoke: 'Brandvarnare', air: 'Luft', rad: 'Element' };
  function buildCatalog() {
    const cfg = H().cfg ? H().cfg() : {}, I = cfg.info || {}, list = [];
    for (const g of ((cfg.lights || {}).groups || [])) for (const l of g.lights) list.push({ kind: 'light', entity: l.entity, name: l.name, group: g.name });
    for (const g of ((TEMPS || {}).groups || [])) for (const t of g.sensors) list.push({ kind: 'temp', entity: t.temp, name: t.name, hum: t.hum, group: g.title });
    for (const [k, kind] of [['doors', 'door'], ['motion', 'motion'], ['leaks', 'leak'], ['smoke', 'smoke'], ['air', 'air']]) for (const x of (I[k] || [])) list.push({ kind, entity: x.entity, name: x.name, unit: x.unit, t: x.t });
    for (const r of ((RAD || {}).radiators || [])) list.push({ kind: 'rad', entity: r.climate, name: r.name, power: r.power, heating: r.heating });
    const seen = new Set();
    catalog = list.filter(x => x.entity && !seen.has(x.entity) && seen.add(x.entity));
  }
  const item = id => (catalog || []).find(x => x.entity === id);

  // Förslag innan något har sparats: bara rum som är entydiga
  const GROUP_ROOM = { 'Kök': 'kok', 'Vardagsrum': 'vardagsrum', 'Hall': 'hall', 'Kontor': 'kontor', 'Garage': 'garage' };
  const NAME_ROOM = { smoke: { 'Kök': 'kok', 'Kontor': 'kontor' }, leak: { 'Badrum': 'bad', 'Pumprum': 'pumprum', 'Tvättstuga': 'tvatt' }, motion: { 'Hall': 'hall' }, door: { 'Ytterdörr': 'hall' }, temp: { 'Vardagsrum': 'vardagsrum', 'Badrum': 'bad', 'Garage': 'garage', 'Verkstad': 'garage', 'Pumprum': 'pumprum' } };
  function defaults() {
    const out = {}, perRoom = {};
    for (const x of catalog || []) {
      const room = x.kind === 'light' ? GROUP_ROOM[x.group] : (NAME_ROOM[x.kind] || {})[x.name];
      if (!room) continue;
      // i rader om tre under rumsnamnet
      const n = perRoom[room] = (perRoom[room] || 0) + 1, [cx, cy] = roomCenter(room), i = n - 1;
      out[x.entity] = [+(cx + ((i % 3) - 1) * 4.4).toFixed(2), +(cy + 4.2 + Math.floor(i / 3) * 4.6).toFixed(2)];
    }
    if (out['binary_sensor.0x00158d0001b7b7d2_contact']) out['binary_sensor.0x00158d0001b7b7d2_contact'] = P(615, 666);
    return out;
  }

  // ---------- Status per markör ----------
  const IC = {
    light: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    temp: '<path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z"/>',
    door: '<path d="M6 21V4h10v17M16 21h3M13 12h.01"/>',
    motion: '<circle cx="12" cy="5" r="2"/><path d="M10 22l2-7 3 3v4M8 12l3-4 3 2 3 1M12 15l-2-4"/>',
    leak: '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/>',
    smoke: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>',
    air: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
    rad: '<path d="M6 6v12M10 6v12M14 6v12M18 6v12M4 9h16M4 15h16"/>',
  };
  function status(x) {
    const s = st(x.entity), na = bad(s);
    switch (x.kind) {
      case 'light': return { cls: na ? 'na' : s.state === 'on' ? 'on' : '', val: '', tip: na ? 'ej nåbar' : s.state === 'on' ? 'tänd' : 'släckt', glow: !na && s.state === 'on' };
      case 'temp': { const v = num(x.entity), h = x.hum ? num(x.hum) : null; return { cls: v == null ? 'na' : v < 12 ? 'cold' : v > 24 ? 'warm' : 'ok', val: v == null ? '–' : nf(v) + '°', tip: (v == null ? 'okänt' : nf(v) + ' °C') + (h != null ? ` · ${Math.round(h)} %` : '') }; }
      case 'door': return { cls: na ? 'na' : s.state === 'on' ? 'alert' : '', val: '', tip: na ? 'ej nåbar' : s.state === 'on' ? 'öppen' : 'stängd' };
      case 'motion': return { cls: na ? 'na' : s.state === 'on' ? 'pulse' : '', val: '', tip: na ? 'ej nåbar' : s.state === 'on' ? 'rörelse nu' : 'ingen rörelse' };
      case 'leak': case 'smoke': return { cls: na ? 'na' : s.state === 'on' ? 'alarm' : '', val: '', tip: na ? 'ej nåbar' : s.state === 'on' ? (x.kind === 'leak' ? 'LÄCKAGE' : 'BRANDLARM') : 'ok' };
      case 'air': { const v = num(x.entity), t = x.t || []; return { cls: v == null ? 'na' : v >= (t[2] ?? Infinity) ? 'alert' : v >= (t[1] ?? Infinity) ? 'warm' : 'ok', val: v == null ? '–' : nf(v, 0), tip: `${v == null ? '–' : nf(v, 0)} ${x.unit || ''}` }; }
      case 'rad': {
        const heat = x.heating && st(x.heating) ? st(x.heating).state === 'on' : (num(x.power) || 0) > 20;
        const sp = s && s.attributes ? s.attributes.temperature : null;
        return { cls: na ? 'na' : heat ? 'heat' : s.state === 'heat' ? 'onm' : '', val: '', tip: na ? 'ej nåbar' : heat ? `värmer${num(x.power) != null ? ' · ' + Math.round(num(x.power)) + ' W' : ''}` : s.state === 'heat' ? `på, ${nf(sp)} °C` : 'av' };
      }
    }
    return { cls: '', val: '', tip: '' };
  }

  // ---------- Overlay ----------
  let root, marks = {}, saved = null, editing = false, placing = null, showNames = false, filter = 'all';
  try { showNames = localStorage.getItem('obs-plan-names') === '1'; } catch {}
  function build() {
    root = document.createElement('div');
    root.id = 'plan'; root.className = 'plan'; root.hidden = true;
    root.innerHTML = `<div class="plan-panel" role="dialog" aria-modal="true" aria-label="Planritning">
      <header class="plan-head"><div><div class="eyebrow">Huset / planritning</div><h2>Planritning</h2></div>
        <div class="plan-acts"><div class="seg plan-filter" role="group" aria-label="Visa">${[['all', 'Allt'], ['light', 'Lampor'], ['sensor', 'Sensorer']].map(([k, l]) => `<button data-pf="${k}" aria-pressed="${k === filter}">${l}</button>`).join('')}</div>
        <button class="pbtn" data-pa="names" aria-pressed="${showNames}">Namn</button>
        <button class="pbtn" data-pa="edit">Placera</button><button class="pbtn" data-pa="house">El i huset</button>
        <button class="pclose" data-pa="close" aria-label="Stäng">×</button></div></header>
      <div class="plan-body"><div class="plan-wrap"><div class="plan-stage">${planSvg()}<div class="plan-marks"></div></div></div>
        <aside class="plan-side" hidden></aside></div>
      <footer class="plan-foot"></footer></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.querySelector('.plan-stage').addEventListener('click', onStageClick);
    root.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });
    window.addEventListener('obs-render', () => { if (!root.hidden) render(); });
    setInterval(() => { if (!root.hidden) render(); }, 2000);
  }
  async function load() {
    const get = u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const [t, r, p] = await Promise.all([TEMPS ? TEMPS : get('api/temps'), RAD ? RAD : get('api/radiators'), get('api/plan')]);
    TEMPS = t || { groups: [] }; RAD = r || {};
    buildCatalog();
    saved = p && p.markers ? p : null;
    marks = saved ? { ...saved.markers } : defaults();
  }
  async function open() {
    if (!root) build();
    root.hidden = false; document.body.classList.add('plan-open');
    if (!catalog) { root.querySelector('.plan-foot').textContent = 'Hämtar …'; await load(); }
    render();
  }
  function close() {
    if (editing) cancelEdit();
    root.hidden = true; document.body.classList.remove('plan-open');
  }
  const isSensor = k => k !== 'light';
  let lastSig = '', dragging = false;
  function render(force) {
    if (dragging) return;
    // Rita bara om när något som syns har ändrats, så att knapparna inte byts ut under fingret
    const sig = JSON.stringify([editing, placing, filter, showNames, marks, Object.keys(marks).map(id => { const it = item(id); return it ? status(it) : null; })]);
    if (!force && sig === lastSig) return; lastSig = sig;
    const box = root.querySelector('.plan-marks');
    root.classList.toggle('editing', editing); root.classList.toggle('names', showNames);
    const glows = [], pins = [];
    for (const [id, [x, y]] of Object.entries(marks)) {
      const it = item(id); if (!it) continue;
      if (!editing && filter !== 'all' && (filter === 'light') === isSensor(it.kind)) continue;
      const s = status(it);
      if (s.glow) glows.push(`<i class="pglow" style="left:${x}%;top:${y}%"></i>`);
      pins.push(`<button class="pm k-${it.kind} ${s.cls}${placing === id ? ' sel' : ''}" data-pm="${esc(id)}" style="left:${x}%;top:${y}%" title="${esc(it.name)}: ${esc(s.tip)}" aria-label="${esc(it.name)}: ${esc(s.tip)}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${IC[it.kind]}</svg>${s.val ? `<b>${esc(s.val)}</b>` : ''}<span class="pn">${esc(it.name)}</span>${editing ? '<em class="px" data-rm="1" aria-label="Ta bort">×</em>' : ''}</button>`);
    }
    box.innerHTML = glows.join('') + pins.join('');
    // Sammanfattning
    const placed = Object.keys(marks).map(item).filter(Boolean);
    const lightsOn = placed.filter(x => x.kind === 'light' && (st(x.entity) || {}).state === 'on').length;
    const open = placed.filter(x => x.kind === 'door' && (st(x.entity) || {}).state === 'on').map(x => x.name);
    const motion = placed.filter(x => x.kind === 'motion' && (st(x.entity) || {}).state === 'on').map(x => x.name);
    const alarms = placed.filter(x => (x.kind === 'leak' || x.kind === 'smoke') && (st(x.entity) || {}).state === 'on').map(x => x.name);
    root.querySelector('.plan-foot').innerHTML = editing
      ? `<span>${placing && !marks[placing] ? `Tryck på ritningen där <b>${esc(item(placing).name)}</b> ska sitta.` : 'Dra symbolerna dit de ska. Välj i listan för att lägga till, × tar bort.'}</span><span class="pf-btns"><button class="pbtn" data-pa="cancel">Avbryt</button><button class="pbtn pri" data-pa="save">Spara</button></span>`
      : placed.length
        ? `<span><b>${lightsOn}</b> lampor tända</span>${open.length ? `<span class="alert">Öppen: ${esc(open.join(', '))}</span>` : '<span>Alla dörrar stängda</span>'}${motion.length ? `<span>Rörelse: ${esc(motion.join(', '))}</span>` : ''}${alarms.length ? `<span class="alarm">Larm: ${esc(alarms.join(', '))}</span>` : ''}<span class="dim">Tryck på en lampa för att tända eller släcka</span>`
        : '<span>Inget är placerat än. Tryck på <b>Placera</b> för att lägga ut lampor och sensorer.</span>';
    if (editing) renderSide();
  }
  function renderSide() {
    const side = root.querySelector('.plan-side');
    const groups = {};
    for (const x of catalog) (groups[x.kind] = groups[x.kind] || []).push(x);
    side.innerHTML = `<div class="eyebrow">Lägg till eller ta bort</div>` + Object.entries(KIND_L).filter(([k]) => groups[k]).map(([k, l]) =>
      `<details ${k === 'light' || k === 'temp' ? 'open' : ''}><summary><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>${l}<small>${groups[k].filter(x => marks[x.entity]).length}/${groups[k].length}</small></summary>
        ${groups[k].map(x => `<button class="pc${marks[x.entity] ? ' on' : ''}${placing === x.entity ? ' sel' : ''}" data-pc="${esc(x.entity)}"><span>${esc(x.name)}</span><small>${esc(x.group || '')}</small><i>${marks[x.entity] ? '✓' : '+'}</i></button>`).join('')}</details>`).join('');
  }
  // ---------- Redigering ----------
  let backup = null;
  function startEdit() { editing = true; backup = { ...marks }; placing = null; root.querySelector('.plan-side').hidden = false; root.querySelector('[data-pa="edit"]').hidden = true; render(); }
  function cancelEdit() { marks = backup || marks; endEdit(); }
  function endEdit() { editing = false; placing = null; root.querySelector('.plan-side').hidden = true; root.querySelector('[data-pa="edit"]').hidden = false; render(); }
  async function save() {
    try {
      const r = await fetch('api/plan', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markers: marks }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      saved = { markers: { ...marks } }; endEdit(); toast('Planritningen är sparad.');
    } catch (e) { toast('Kunde inte spara: ' + e.message); }
  }
  function toast(m) { const t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
  function onClick(e) {
    const a = e.target.closest('[data-pa]'), f = e.target.closest('[data-pf]'), c = e.target.closest('[data-pc]'), m = e.target.closest('[data-pm]');
    if (a) {
      const k = a.dataset.pa;
      if (k === 'close') return close();
      if (k === 'edit') return startEdit();
      if (k === 'cancel') return cancelEdit();
      if (k === 'save') return save();
      if (k === 'names') { showNames = !showNames; a.setAttribute('aria-pressed', showNames); try { localStorage.setItem('obs-plan-names', showNames ? '1' : '0'); } catch {} return render(); }
      if (k === 'house') { close(); return H().open && H().open('house'); }
    }
    if (f) { filter = f.dataset.pf; root.querySelectorAll('[data-pf]').forEach(b => b.setAttribute('aria-pressed', b === f)); return render(); }
    if (c) {
      const id = c.dataset.pc;
      if (marks[id]) { placing = id; render(); const el = root.querySelector(`[data-pm="${CSS.escape(id)}"]`); if (el) el.animate([{ transform: 'translate(-50%,-50%) scale(1.6)' }, { transform: 'translate(-50%,-50%) scale(1)' }], 500); return; }
      placing = id; return render();
    }
    if (m && editing && e.target.closest('[data-rm]')) { delete marks[m.dataset.pm]; if (placing === m.dataset.pm) placing = null; return render(); }
    if (m && !editing) {
      const it = item(m.dataset.pm);
      if (it && it.kind === 'light') {
        const on = (st(it.entity) || {}).state === 'on';
        m.classList.add('pending');
        fetch('api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', entity: it.entity, value: !on }) })
          .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); }).catch(er => { m.classList.remove('pending'); toast('Gick inte: ' + er.message); });
      } else if (it) { m.classList.toggle('peek'); }
    }
  }
  function stagePos(e) { const r = root.querySelector('.plan-stage').getBoundingClientRect(); return [Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)), Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100))]; }
  function onStageClick(e) {
    if (!editing || !placing || marks[placing] || e.target.closest('[data-pm]')) return;
    const [x, y] = stagePos(e); marks[placing] = [+x.toFixed(2), +y.toFixed(2)]; placing = null; render();
  }
  function onDown(e) {
    if (!editing) return;
    const m = e.target.closest('[data-pm]'); if (!m || e.target.closest('[data-rm]')) return;
    e.preventDefault(); const id = m.dataset.pm; placing = id; dragging = true; m.setPointerCapture(e.pointerId); m.classList.add('drag');
    const move = ev => { const [x, y] = stagePos(ev); marks[id] = [+x.toFixed(2), +y.toFixed(2)]; m.style.left = x + '%'; m.style.top = y + '%'; };
    const up = () => { dragging = false; m.removeEventListener('pointermove', move); m.removeEventListener('pointerup', up); m.removeEventListener('pointercancel', up); render(); };
    m.addEventListener('pointermove', move); m.addEventListener('pointerup', up); m.addEventListener('pointercancel', up);
  }
  window.ObsPlan = { open, close };
  console.info('observatory plan', VERSION);
})();
