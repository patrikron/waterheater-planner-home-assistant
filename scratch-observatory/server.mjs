// Observatory-sajt: liten server utan beroenden (Node 22+).
// Håller HA-token på serversidan, prenumererar på HA:s WebSocket-API och
// skickar bara de entiteter som står i config.json vidare till webbläsaren.
import http from 'node:http';
import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const CONFIG = JSON.parse(readFileSync(process.env.CONFIG_FILE || join(ROOT, 'config.json'), 'utf8'));

const HA_URL = (process.env.HA_URL || '').replace(/\/+$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';
const PORT = Number(process.env.PORT || 8780);
const BIND = process.env.BIND || '0.0.0.0';
const BASIC_AUTH = process.env.BASIC_AUTH || ''; // "användare:lösenord", valfritt
const STATS_TTL = 5 * 60 * 1000;

if (!HA_URL || !HA_TOKEN) {
  console.error('Sätt HA_URL och HA_TOKEN (se .env.example).');
  process.exit(1);
}

// Allowlist: alla entitets-id i card-konfigurationen.
const ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;
// Alla strängvärden (även i nästlade objekt) som ser ut som entitets-id i card, house och water.
const collectIds = (o, out = []) => { for (const v of Object.values(o || {})) { if (typeof v === 'string') { if (ID_RE.test(v)) out.push(v); } else if (v && typeof v === 'object') collectIds(v, out); } return out; };
const ALLOWED = new Set([...collectIds(CONFIG.card), ...collectIds(CONFIG.house), ...collectIds(CONFIG.water), ...collectIds(CONFIG.heatpump), ...collectIds(CONFIG.solar), ...collectIds(CONFIG.ftx), ...collectIds(CONFIG.charger), ...collectIds(CONFIG.car), ...collectIds(CONFIG.temps), ...collectIds(CONFIG.spa)]);
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const LAYOUT_FILE = join(DATA_DIR, 'layout.json');
const THEME_DIR = join(DATA_DIR, 'themes'), THEME_DEFAULT = join(DATA_DIR, 'theme-default.json');
const STATS_IDS = new Set([CONFIG.card.solar, CONFIG.card.load, CONFIG.card.grid].filter(Boolean));
const ATTR_ALLOW = CONFIG.attributes || {};
const BASE_ATTRS = ['unit_of_measurement', 'friendly_name', 'device_class'];

const states = new Map();
let connected = false;
const clients = new Set();

function slim(s) {
  if (!s) return null;
  const keep = [...BASE_ATTRS, ...(ATTR_ALLOW[s.entity_id] || [])];
  const attributes = {};
  if (keep.includes('*')) Object.assign(attributes, s.attributes || {});
  else for (const k of keep) if (s.attributes && k in s.attributes) attributes[k] = s.attributes[k];
  return { entity_id: s.entity_id, state: s.state, attributes, last_updated: s.last_updated };
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- Home Assistant WebSocket ----------
let ws = null, nextId = 1, retry = 1000;
const pending = new Map();

function haCall(msg, timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (!ws || !connected) return reject(new Error('Inte ansluten till Home Assistant'));
    const id = nextId++;
    const t = setTimeout(() => { pending.delete(id); reject(new Error('Timeout mot Home Assistant')); }, timeout);
    pending.set(id, { resolve: r => { clearTimeout(t); resolve(r); }, reject: e => { clearTimeout(t); reject(e); } });
    ws.send(JSON.stringify({ id, ...msg }));
  });
}

function connect() {
  const url = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
  ws = new WebSocket(url);
  ws.addEventListener('message', async ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
    else if (m.type === 'auth_invalid') { console.error('HA nekade token:', m.message); ws.close(); }
    else if (m.type === 'auth_ok') {
      connected = true; retry = 1000;
      console.log(`Ansluten till Home Assistant ${m.ha_version || ''}`);
      try {
        const all = await haCall({ type: 'get_states' });
        for (const s of all) if (ALLOWED.has(s.entity_id)) states.set(s.entity_id, slim(s));
        await haCall({ type: 'subscribe_events', event_type: 'state_changed' });
        broadcast('snapshot', snapshot());
      } catch (e) { console.error('Startfel:', e.message); }
    } else if (m.type === 'result') {
      const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
      m.success ? p.resolve(m.result) : p.reject(new Error(m.error && m.error.message || 'HA-fel'));
    } else if (m.type === 'event' && m.event && m.event.event_type === 'state_changed') {
      const d = m.event.data;
      if (!ALLOWED.has(d.entity_id)) return;
      const s = slim(d.new_state);
      if (s) states.set(d.entity_id, s); else states.delete(d.entity_id);
      broadcast('state', s || { entity_id: d.entity_id, state: 'unavailable', attributes: {} });
    }
  });
  const sock = ws;
  let done = false;
  const lost = () => {
    if (done) return; done = true;
    const was = connected; connected = false;
    for (const p of pending.values()) p.reject(new Error('Anslutningen bröts'));
    pending.clear();
    if (was) { console.warn('Tappade HA, försöker igen …'); broadcast('snapshot', snapshot()); }
    try { sock.close(); } catch {}
    setTimeout(connect, retry); retry = Math.min(retry * 2, 60000);
  };
  ws.addEventListener('close', lost);
  ws.addEventListener('error', e => { console.warn('WebSocket-fel:', e.message || e.type); lost(); });
}

function snapshot() {
  return { connected, states: Object.fromEntries(states) };
}

// ---------- Statistik (cachad) ----------
const statsCache = new Map();
async function stats(hours) {
  const h = Math.max(1, Math.min(168, Math.round(hours) || 24));
  const hit = statsCache.get(h);
  if (hit && Date.now() - hit.at < STATS_TTL) return hit.data;
  const start = new Date(Date.now() - h * 3600 * 1000); start.setMinutes(0, 0, 0);
  const data = await haCall({
    type: 'recorder/statistics_during_period', start_time: start.toISOString(),
    statistic_ids: [...STATS_IDS], period: 'hour', types: ['mean'],
  });
  statsCache.set(h, { at: Date.now(), data });
  return data;
}

// ---------- Historik för en entitet (detaljpanelen) ----------
const histCache = new Map();
const HIST_ATTRS = Object.assign({}, ...[CONFIG.spa].filter(Boolean).map(x => x.history_attrs || {}));
async function history(id, hours, attr) {
  if (!ALLOWED.has(id)) throw Object.assign(new Error('Entiteten är inte tillåten'), { code: 403 });
  if (attr) return attrHistory(id, hours, attr);
  const h = Math.max(1, Math.min(168, Math.round(hours) || 24));
  const key = id + '|' + h;
  const hit = histCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.data;
  const start = new Date(Date.now() - h * 3600 * 1000).toISOString();
  let points = [];
  try {
    const st = await haCall({ type: 'recorder/statistics_during_period', start_time: start,
      statistic_ids: [id], period: h > 48 ? 'hour' : '5minute', types: ['mean'] });
    points = (st[id] || []).filter(r => r.mean != null).map(r => [r.start, r.mean]);
  } catch {}
  if (!points.length) {
    const hs = await haCall({ type: 'history/history_during_period', start_time: start, entity_ids: [id],
      minimal_response: true, no_attributes: true, significant_changes_only: false });
    const rows = hs[id] || [];
    let lastT = 0;
    for (const r of rows) {
      const v = parseFloat(r.s); const t = (r.lu || r.lc || 0) * 1000;
      if (!Number.isFinite(v)) continue;
      if (rows.length > 600 && t - lastT < 120000) continue; // gles ut täta sensorer
      points.push([t, v]); lastT = t;
    }
  }
  const data = { entity_id: id, hours: h, points };
  histCache.set(key, { at: Date.now(), data });
  return data;
}

// Historik för ett attribut (t.ex. termostatens vattentemperatur); bara attribut som står i config history_attrs
async function attrHistory(id, hours, attr) {
  if (!(HIST_ATTRS[id] || []).includes(attr)) throw Object.assign(new Error('Attributet är inte tillåtet'), { code: 403 });
  const h = Math.max(1, Math.min(168, Math.round(hours) || 24));
  const key = id + '|' + attr + '|' + h, hit = histCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.data;
  const start = new Date(Date.now() - h * 3600 * 1000).toISOString();
  const hs = await haCall({ type: 'history/history_during_period', start_time: start, entity_ids: [id],
    minimal_response: false, no_attributes: false, significant_changes_only: false });
  const points = []; let last = null;
  for (const r of hs[id] || []) {
    const a = r.a || {}; const v = parseFloat(a[attr]); const t = (r.lu || r.lc || 0) * 1000;
    if (!Number.isFinite(v) || !t) continue;
    if (v === last && points.length && t - points[points.length - 1][0] < 1800e3) continue;
    points.push([t, v]); last = v;
  }
  const heat = (hs[id] || []).map(r => [(r.lu || r.lc || 0) * 1000, (r.a || {}).hvac_action === 'heating' ? 1 : 0]);
  const data = { entity_id: id, attr, hours: h, points, heating: heat };
  histCache.set(key, { at: Date.now(), data });
  return data;
}

// ---------- Dygnsvis förändring (staplar per dag) ----------
const dailyCache = new Map();
async function daily(id, days, stat = 'change') {
  if (!['change', 'mean'].includes(stat)) stat = 'change';
  if (!ALLOWED.has(id)) throw Object.assign(new Error('Entiteten är inte tillåten'), { code: 403 });
  const n = Math.max(1, Math.min(60, Math.round(days) || 14));
  const key = id + '|' + n + '|' + stat, hit = dailyCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const start = new Date(localStart('day').t - (n - 1) * 86400000).toISOString();
  const st = await haCall({ type: 'recorder/statistics_during_period', start_time: start, statistic_ids: [id], period: 'day', types: [stat] });
  const data = { entity_id: id, days: n, stat, points: (st[id] || []).filter(r => r[stat] != null).map(r => [r.start, r[stat]]) };
  dailyCache.set(key, { at: Date.now(), data });
  return data;
}

// Månadsvis förändring (för års- och månadsjämförelser), n månader bakåt inklusive innevarande
async function monthly(id, months, stat = 'change') {
  if (!['change', 'mean'].includes(stat)) stat = 'change';
  if (!ALLOWED.has(id)) throw Object.assign(new Error('Entiteten är inte tillåten'), { code: 403 });
  const n = Math.max(1, Math.min(48, Math.round(months) || 24));
  const key = 'm|' + id + '|' + n + '|' + stat, hit = dailyCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.data;
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(Date.now()).split('-').map(Number);
  const guess = Date.UTC(d[0], d[1] - 1 - (n - 1), 1);
  const start = new Date(guess - tzOffset(guess)).toISOString();
  const st = await haCall({ type: 'recorder/statistics_during_period', start_time: start, statistic_ids: [id], period: 'month', types: [stat] });
  const data = { entity_id: id, months: n, stat, points: (st[id] || []).filter(r => r[stat] != null).map(r => [r.start, r[stat]]) };
  dailyCache.set(key, { at: Date.now(), data });
  return data;
}

// ---------- Kalender (kioskens kolumn) ----------
// Bara kalendrar som står i config.calendar läses. Händelserna hämtas via HA:s REST-API och sparas 5 min.
const CAL = CONFIG.calendar || {};
const CAL_IDS = new Set([...(CAL.calendars || []).map(c => c.entity), CAL.namedays].filter(id => id && ID_RE.test(id)));
let calCache = null;
async function calEvents(id, start, end) {
  const r = await fetch(`${HA_URL}/api/calendars/${encodeURIComponent(id)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    { headers: { Authorization: `Bearer ${HA_TOKEN}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Kalendern ${id} svarade ${r.status}`);
  return (await r.json()).map(e => {
    const s = e.start || {}, en = e.end || {};
    // Bara rubrik, tid och plats skickas vidare; beskrivningar stannar i HA
    return { cal: id, title: String(e.summary || '').slice(0, 200), all_day: !!s.date, start: s.dateTime || s.date, end: en.dateTime || en.date,
      location: e.location ? String(e.location).split(',')[0].slice(0, 80) : null };
  });
}
async function calendar() {
  if (calCache && Date.now() - calCache.at < 5 * 60 * 1000) return calCache.data;
  const days = Math.max(1, Math.min(31, Number(CAL.days) || 14));
  const t0 = localStart('day').t, start = new Date(t0).toISOString(), end = new Date(t0 + days * 864e5).toISOString();
  const events = [], errors = [];
  await Promise.all([...CAL_IDS].map(id => calEvents(id, start, end).then(ev => events.push(...ev)).catch(e => errors.push(e.message))));
  let forecast = [];
  if (CAL.weather && ID_RE.test(CAL.weather)) {
    try {
      const r = await haCall({ type: 'call_service', domain: 'weather', service: 'get_forecasts', service_data: { type: 'daily' },
        target: { entity_id: CAL.weather }, return_response: true });
      forecast = ((((r || {}).response || {})[CAL.weather] || {}).forecast || []).slice(0, days)
        .map(f => ({ t: f.datetime, cond: f.condition, hi: f.temperature, lo: f.templow, rain: f.precipitation }));
    } catch (e) { errors.push('Väder: ' + e.message); }
  }
  const data = { days, calendars: (CAL.calendars || []).filter(c => CAL_IDS.has(c.entity)).map(c => ({ entity: c.entity, name: c.name || c.entity, color: c.color || 'blue' })),
    namedays: CAL.namedays || null, events: events.sort((a, b) => String(a.start).localeCompare(String(b.start))), forecast, errors };
  if (!errors.length || events.length) calCache = { at: Date.now(), data };
  return data;
}

// ---------- Layout (husvyn) ----------
function validLayout(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return false;
  const num = v => typeof v === 'number' && Number.isFinite(v) && v >= -50 && v <= 150;
  const pt = p => Array.isArray(p) && p.length === 2 && p.every(num);
  for (const b of Object.values(l.boxes || {})) {
    if (!b || !num(b.x) || !num(b.y)) return false;
    if (b.anchor != null && !pt(b.anchor)) return false;
  }
  for (const h of Object.values(l.hotspots || {})) {
    if (!h || !Array.isArray(h.points) || h.points.length > 60 || !h.points.every(pt)) return false;
  }
  if (l.locks != null) {
    if (typeof l.locks !== 'object' || Array.isArray(l.locks) || Object.keys(l.locks).length > 20) return false;
    for (const [k, p] of Object.entries(l.locks)) if (!/^lock\.[a-z0-9_]+$/.test(k) || !pt(p)) return false;
  }
  return true;
}
async function readBody(req, max = 64 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('För stor'), { code: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------- Styrning (bara luftvärmepumpen, bara vitlistade åtgärder) ----------
const HP = CONFIG.heatpump || {};
const ctlLog = [];
async function control(body) {
  // Sidor med egen styrning (FTX, laddbox, bilen, spabad, varmvatten): bara entiteter som står i respektive vitlista
  const PAGES = [CONFIG.ftx, CONFIG.charger, CONFIG.car, CONFIG.spa, CONFIG.water, CONFIG.house && CONFIG.house.door].filter(x => x && x.controls);
  const allow = k => new Set(PAGES.flatMap(x => [...(x[k] || []), ...(k === 'numbers' && x.setpoint ? [x.setpoint] : [])]));
  const { action: act0, entity: ent0 } = body || {};
  const ftxOk = (act0 === 'toggle' && allow('toggles').has(ent0)) || (act0 === 'number' && allow('numbers').has(ent0)) || (act0 === 'select' && allow('selects').has(ent0))
    || (act0 === 'script' && allow('scripts').has(ent0)) || (act0 === 'lock' && allow('locks').has(ent0))
    || ((act0 === 'climate_mode' || act0 === 'climate_temp') && allow('climates').has(ent0));
  const hpOk = !!(HP.controls && HP.climate);
  if (!ftxOk && !hpOk) throw Object.assign(new Error('Styrning är avstängd'), { code: 403 });
  const now = Date.now();
  while (ctlLog.length && now - ctlLog[0] > 60000) ctlLog.shift();
  if (ctlLog.length >= 20) throw Object.assign(new Error('För många kommandon, vänta en minut'), { code: 429 });
  const { action, value, entity } = body || {};
  const cl = states.get(HP.climate), a = (cl && cl.attributes) || {};
  const inList = (list, v) => Array.isArray(list) && typeof v === 'string' && list.includes(v);
  let call;
  if (!hpOk && !ftxOk) call = null;
  else if (hpOk && action === 'hvac_mode' && inList(a.hvac_modes, value)) call = ['climate', 'set_hvac_mode', HP.climate, { hvac_mode: value }];
  else if (hpOk && action === 'fan_mode' && inList(a.fan_modes, value)) call = ['climate', 'set_fan_mode', HP.climate, { fan_mode: value }];
  else if (hpOk && action === 'swing_mode' && inList(a.swing_modes, value)) call = ['climate', 'set_swing_mode', HP.climate, { swing_mode: value }];
  else if (hpOk && action === 'preset_mode' && inList(a.preset_modes, value)) call = ['climate', 'set_preset_mode', HP.climate, { preset_mode: value }];
  else if (hpOk && action === 'temperature' && typeof value === 'number' && Number.isFinite(value)) {
    const lo = a.min_temp ?? 10, hi = a.max_temp ?? 30, step = a.target_temp_step || 0.5;
    if (value < lo || value > hi || Math.abs(value / step - Math.round(value / step)) > 1e-6) throw Object.assign(new Error('Ogiltig temperatur'), { code: 400 });
    call = ['climate', 'set_temperature', HP.climate, { temperature: value }];
  } else if (action === 'toggle' && (ftxOk || (HP.controls && (HP.toggles || []).includes(entity))) && typeof value === 'boolean') {
    call = [entity.split('.')[0], value ? 'turn_on' : 'turn_off', entity, {}];
  } else if (action === 'number' && ftxOk && typeof value === 'number' && Number.isFinite(value)) {
    const s = states.get(entity), at = (s && s.attributes) || {};
    const lo = Number(at.min), hi = Number(at.max), step = Number(at.step) || 1;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || value < lo || value > hi || Math.abs((value - lo) / step - Math.round((value - lo) / step)) > 1e-6)
      throw Object.assign(new Error('Ogiltigt värde'), { code: 400 });
    call = [entity.split('.')[0], 'set_value', entity, { value }];
  } else if (action === 'select' && (ftxOk || (HP.controls && (HP.selects || []).includes(entity)))) {
    const s = states.get(entity);
    if (!s || !inList(s.attributes.options, value)) throw Object.assign(new Error('Ogiltigt val'), { code: 400 });
    call = [entity.split('.')[0], 'select_option', entity, { option: value }];
  } else if (action === 'script' && ftxOk) {
    // skript körs via script.turn_on; ev. variabler kommer från config, aldrig från webbläsaren
    const page = PAGES.find(x => (x.scripts || []).includes(entity)), vars = (page && page.script_vars && page.script_vars[entity]) || null;
    call = ['script', 'turn_on', entity, vars ? { variables: vars } : {}];
  } else if (action === 'lock' && ftxOk && (value === 'lock' || value === 'unlock')) {
    const page = PAGES.find(x => (x.locks || []).includes(entity));
    if (value === 'unlock' && !(page && page.allow_unlock === true)) throw Object.assign(new Error('Upplåsning är avstängd i config'), { code: 403 });
    call = ['lock', value, entity, {}];
  }
  else if (ftxOk && (action === 'climate_mode' || action === 'climate_temp')) {
    // termostat på en sida (t.ex. spabadet): läge och temperatur kontrolleras mot entitetens egna gränser
    const s = states.get(entity), at = (s && s.attributes) || {};
    if (action === 'climate_mode') {
      if (!inList(at.hvac_modes, value)) throw Object.assign(new Error('Ogiltigt läge'), { code: 400 });
      call = ['climate', 'set_hvac_mode', entity, { hvac_mode: value }];
    } else {
      const lo = Number(at.min_temp), hi = Number(at.max_temp), step = Number(at.target_temp_step) || 1;
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(lo) || !Number.isFinite(hi) || value < lo || value > hi || Math.abs(value / step - Math.round(value / step)) > 1e-6)
        throw Object.assign(new Error('Ogiltig temperatur'), { code: 400 });
      call = ['climate', 'set_temperature', entity, { temperature: value }];
    }
  }
  if (!call) throw Object.assign(new Error('Åtgärden är inte tillåten'), { code: 400 });
  ctlLog.push(now);
  const [domain, service, entity_id, service_data] = call;
  await haCall({ type: 'call_service', domain, service, service_data, target: { entity_id } });
  console.log(`Styrning: ${domain}.${service} ${entity_id} ${JSON.stringify(service_data)}`);
  return { ok: true };
}

// ---------- Teman ----------
// Inbyggda teman ligger i public/themes/*.json, egna sparas i data/themes/*.json (inget bygge behövs).
// Ett tema är bara färger: vitlistade variabelnamn och färgvärden som kontrolleras strikt.
const THEME_VARS = ['bg', 'panel', 'panel2', 'line', 'line2', 'text', 'muted', 'dim', 'sage', 'orange', 'gold', 'blue', 'red'];
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
const THEME_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
function cleanTheme(t, id, builtin) {
  if (!t || typeof t !== 'object') return null;
  const vars = {};
  for (const k of THEME_VARS) if (typeof (t.vars || {})[k] === 'string' && COLOR_RE.test(t.vars[k].trim())) vars[k] = t.vars[k].trim();
  return { id, name: String(t.name || id).slice(0, 40), scheme: t.scheme === 'light' ? 'light' : 'dark', builtin, vars };
}
async function readThemes(dir, builtin) {
  let files = [];
  try { files = (await readdir(dir)).filter(f => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files.sort()) {
    const id = f.slice(0, -5); if (!THEME_ID_RE.test(id)) continue;
    try { const t = cleanTheme(JSON.parse(await readFile(join(dir, f), 'utf8')), id, builtin); if (t) out.push(t); } catch {}
  }
  return out;
}
async function listThemes() {
  const builtin = await readThemes(join(PUBLIC, 'themes'), true), own = await readThemes(THEME_DIR, false);
  const ids = new Set(builtin.map(t => t.id));
  let def = 'standard';
  try { const d = JSON.parse(await readFile(THEME_DEFAULT, 'utf8')).id; if (THEME_ID_RE.test(d)) def = d; } catch {}
  builtin.sort((a, b) => (a.id === 'standard' ? -1 : b.id === 'standard' ? 1 : 0));
  return { default: def, vars: THEME_VARS, themes: [...builtin, ...own.filter(t => !ids.has(t.id))] };
}
async function themePost(body) {
  const { action, id } = body || {};
  if (typeof id !== 'string' || !THEME_ID_RE.test(id)) throw Object.assign(new Error('Ogiltigt tema-id (a–z, 0–9 och -)'), { code: 400 });
  const builtin = (await readThemes(join(PUBLIC, 'themes'), true)).some(t => t.id === id);
  if (action === 'save') {
    if (builtin) throw Object.assign(new Error('Inbyggda teman kan inte skrivas över, välj ett annat namn'), { code: 400 });
    const t = cleanTheme(body.theme, id, false);
    if (!t || Object.keys(t.vars).length < 5) throw Object.assign(new Error('Temat saknar färger'), { code: 400 });
    if ((await readThemes(THEME_DIR, false)).length >= 50 && !(await readThemes(THEME_DIR, false)).some(x => x.id === id)) throw Object.assign(new Error('Max 50 egna teman'), { code: 400 });
    await mkdir(THEME_DIR, { recursive: true });
    const file = join(THEME_DIR, id + '.json'), tmp = file + '.tmp';
    await writeFile(tmp, JSON.stringify({ name: t.name, scheme: t.scheme, vars: t.vars, saved: new Date().toISOString() }, null, 1));
    await rename(tmp, file);
    return { ok: true };
  }
  if (action === 'delete') {
    if (builtin) throw Object.assign(new Error('Inbyggda teman kan inte tas bort'), { code: 400 });
    try { await unlink(join(THEME_DIR, id + '.json')); } catch {}
    return { ok: true };
  }
  if (action === 'default') {
    const all = await listThemes();
    if (!all.themes.some(t => t.id === id)) throw Object.assign(new Error('Temat finns inte'), { code: 404 });
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(THEME_DEFAULT, JSON.stringify({ id }));
    return { ok: true };
  }
  throw Object.assign(new Error('Okänd åtgärd'), { code: 400 });
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'" };

function authOk(req) {
  if (!BASIC_AUTH) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const a = Buffer.from(Buffer.from(h.slice(6), 'base64').toString()), b = Buffer.from(BASIC_AUTH);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, code, obj) {
  res.writeHead(code, { ...SEC, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---------- Pengar: besparing idag och solens intjäning i år ----------
const TZ = (CONFIG.house && CONFIG.house.time_zone) || 'Europe/Stockholm';
function tzOffset(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(t).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}
function localStart(kind) { // lokal midnatt idag eller 1 januari, som UTC-tid
  const now = Date.now();
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number);
  const guess = kind === 'year' ? Date.UTC(d[0], 0, 1) : Date.UTC(d[0], d[1] - 1, d[2]);
  return { t: guess - tzOffset(guess), day: d.join('-'), year: d[0] };
}
let moneyCache = null;
async function money() {
  const H = CONFIG.house || {};
  const today = localStart('day');
  if (moneyCache && moneyCache.day === today.day && Date.now() - moneyCache.at < 10 * 60 * 1000) return moneyCache.data;
  const data = { day: today.day, base: {}, year: null };
  // Värdet vid midnatt för de löpande sol-sensorerna
  const ids = [H.solar_saving, H.solar_sold].filter(Boolean);
  if (ids.length) {
    try {
      const hs = await haCall({ type: 'history/history_during_period', start_time: new Date(today.t).toISOString(),
        end_time: new Date(today.t + 1000).toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true,
        include_start_time_state: true, significant_changes_only: false });
      for (const id of ids) { const v = parseFloat(((hs[id] || [])[0] || {}).s); if (Number.isFinite(v)) data.base[id] = v; }
    } catch (e) { console.warn('Kunde inte läsa midnattsvärden:', e.message); }
  }
  // Solens intjäning i år: egen användning värderad till månadens snittpris för köpt el + såld el
  const Y = H.year_stats;
  if (Y && Y.pv && Y.grid_in && Y.grid_out && Y.cost && Y.compensation) {
    try {
      const yr = localStart('year');
      const r = await haCall({ type: 'recorder/statistics_during_period', start_time: new Date(yr.t).toISOString(),
        statistic_ids: [Y.pv, Y.grid_in, Y.grid_out, Y.cost, Y.compensation], period: 'month', types: ['change'] });
      const byStart = new Map();
      for (const [key, id] of Object.entries(Y)) for (const row of r[id] || []) {
        const m = byStart.get(row.start) || {}; m[key] = row.change || 0; byStart.set(row.start, m);
      }
      let selfKwh = 0, selfKr = 0, soldKr = 0;
      for (const m of byStart.values()) {
        const self = Math.max(0, (m.pv || 0) - (m.grid_out || 0));
        const price = m.grid_in > 0 ? (m.cost || 0) / m.grid_in : 0;
        selfKwh += self; selfKr += self * price; soldKr += m.compensation || 0;
      }
      data.year = { year: yr.year, self_kwh: selfKwh, self_kr: selfKr, sold_kr: soldKr, total_kr: selfKr + soldKr, months: byStart.size };
    } catch (e) { console.warn('Kunde inte räkna årets intjäning:', e.message); }
  }
  moneyCache = { at: Date.now(), day: today.day, data };
  return data;
}

const server = http.createServer(async (req, res) => {
  if (!authOk(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Observatory"' }); return res.end('Inloggning krävs'); }
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/layout' && req.method === 'PUT') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON krävs' });
      const layout = JSON.parse(await readBody(req));
      if (!validLayout(layout)) return json(res, 400, { error: 'Ogiltig layout' });
      await mkdir(DATA_DIR, { recursive: true });
      const tmp = LAYOUT_FILE + '.tmp';
      await writeFile(tmp, JSON.stringify({ boxes: layout.boxes || {}, hotspots: layout.hotspots || {}, locks: layout.locks || {}, saved: new Date().toISOString() }, null, 1));
      await rename(tmp, LAYOUT_FILE);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/themes' && req.method === 'POST') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON krävs' });
      const origin = req.headers.origin;
      let sameOrigin = true; if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
      if (!sameOrigin) return json(res, 403, { error: 'Fel ursprung' });
      return json(res, 200, await themePost(JSON.parse(await readBody(req, 8192))));
    }
    if (url.pathname === '/api/control' && req.method === 'POST') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON krävs' });
      const origin = req.headers.origin;
      let sameOrigin = true; if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
      if (!sameOrigin) return json(res, 403, { error: 'Fel ursprung' });
      return json(res, 200, await control(JSON.parse(await readBody(req, 4096))));
    }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (url.pathname === '/api/layout') {
      try { return json(res, 200, JSON.parse(await readFile(LAYOUT_FILE, 'utf8'))); }
      catch { return json(res, 200, {}); }
    }
    if (url.pathname === '/api/house') return json(res, 200, CONFIG.house || {});
    if (url.pathname === '/api/water') return json(res, 200, CONFIG.water || {});
    if (url.pathname === '/api/heatpump') return json(res, 200, CONFIG.heatpump || {});
    if (url.pathname === '/api/solar') return json(res, 200, CONFIG.solar || {});
    if (url.pathname === '/api/ftx') return json(res, 200, CONFIG.ftx || {});
    if (url.pathname === '/api/charger') return json(res, 200, CONFIG.charger || {});
    if (url.pathname === '/api/car') return json(res, 200, CONFIG.car || {});
    if (url.pathname === '/api/temps') return json(res, 200, CONFIG.temps || {});
    if (url.pathname === '/api/spa') return json(res, 200, CONFIG.spa || {});
    if (url.pathname === '/api/themes') return json(res, 200, await listThemes());
    if (url.pathname === '/api/calendar') return json(res, 200, await calendar());
    if (url.pathname === '/api/monthly') return json(res, 200, await monthly(url.searchParams.get('entity') || '', Number(url.searchParams.get('months')), url.searchParams.get('stat') || 'change'));
    if (url.pathname === '/api/daily') return json(res, 200, await daily(url.searchParams.get('entity') || '', Number(url.searchParams.get('days')), url.searchParams.get('stat') || 'change'));
    if (url.pathname === '/api/history') return json(res, 200, await history(url.searchParams.get('entity') || '', Number(url.searchParams.get('hours')), url.searchParams.get('attr') || ''));
    if (url.pathname === '/api/config') return json(res, 200, CONFIG.card);
    if (url.pathname === '/api/states') return json(res, 200, snapshot());
    if (url.pathname === '/api/money') return json(res, 200, await money());
    if (url.pathname === '/api/stats') return json(res, 200, await stats(Number(url.searchParams.get('hours'))));
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { ...SEC, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (url.pathname === '/healthz') return json(res, connected ? 200 : 503, { connected });
    // Statiska filer från public/
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + '/') || !MIME[extname(file)]) { res.writeHead(404); return res.end('Hittades inte'); }
    const body = await readFile(file);
    res.writeHead(200, { ...SEC, 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('Hittades inte'); }
    if ([400, 403, 404, 413, 429].includes(e.code)) return json(res, e.code, { error: e.message });
    if (e instanceof SyntaxError) return json(res, 400, { error: 'Ogiltig JSON' });
    json(res, 502, { error: e.message });
  }
});

server.listen(PORT, BIND, () => console.log(`Observatory på http://${BIND}:${PORT}  (HA: ${HA_URL}, ${ALLOWED.size} entiteter)`));
connect();
