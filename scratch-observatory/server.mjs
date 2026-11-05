// Observatory-sajt: liten server utan beroenden (Node 22+).
// Håller HA-token på serversidan, prenumererar på HA:s WebSocket-API och
// skickar bara de entiteter som står i config.json vidare till webbläsaren.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
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
const ENTITY_KEYS = Object.entries(CONFIG.card).filter(([, v]) => typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v));
const ALLOWED = new Set(ENTITY_KEYS.map(([, v]) => v));
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

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" };

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
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const url = new URL(req.url, 'http://x');
  try {
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
    json(res, 502, { error: e.message });
  }
});

server.listen(PORT, BIND, () => console.log(`Observatory på http://${BIND}:${PORT}  (HA: ${HA_URL}, ${ALLOWED.size} entiteter)`));
connect();
