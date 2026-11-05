// Observatory-sajt: liten server utan beroenden (Node 22+).
// Håller HA-token på serversidan, prenumererar på HA:s WebSocket-API och
// skickar bara de entiteter som står i config.json vidare till webbläsaren.
import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
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
const ENTITY_KEYS = [...Object.entries(CONFIG.card), ...Object.entries(CONFIG.house || {})].filter(([, v]) => typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v));
const ALLOWED = new Set(ENTITY_KEYS.map(([, v]) => v));
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const LAYOUT_FILE = join(DATA_DIR, 'layout.json');
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
  for (const k of keep) if (s.attributes && k in s.attributes) attributes[k] = s.attributes[k];
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
async function history(id, hours) {
  if (!ALLOWED.has(id)) throw Object.assign(new Error('Entiteten är inte tillåten'), { code: 403 });
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
  return true;
}
async function readBody(req, max = 64 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('För stor'), { code: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
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
      await writeFile(tmp, JSON.stringify({ boxes: layout.boxes || {}, hotspots: layout.hotspots || {}, saved: new Date().toISOString() }, null, 1));
      await rename(tmp, LAYOUT_FILE);
      return json(res, 200, { ok: true });
    }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (url.pathname === '/api/layout') {
      try { return json(res, 200, JSON.parse(await readFile(LAYOUT_FILE, 'utf8'))); }
      catch { return json(res, 200, {}); }
    }
    if (url.pathname === '/api/house') return json(res, 200, CONFIG.house || {});
    if (url.pathname === '/api/history') return json(res, 200, await history(url.searchParams.get('entity') || '', Number(url.searchParams.get('hours'))));
    if (url.pathname === '/api/config') return json(res, 200, CONFIG.card);
    if (url.pathname === '/api/states') return json(res, 200, snapshot());
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
    if (e.code === 403 || e.code === 413) return json(res, e.code, { error: e.message });
    if (e instanceof SyntaxError) return json(res, 400, { error: 'Ogiltig JSON' });
    json(res, 502, { error: e.message });
  }
});

server.listen(PORT, BIND, () => console.log(`Observatory på http://${BIND}:${PORT}  (HA: ${HA_URL}, ${ALLOWED.size} entiteter)`));
connect();
