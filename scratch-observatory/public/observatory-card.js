/* observatory-card 0.1.0 – "Hemmet, i överblick"
 * Inspirerad av prmgr-observatory-starter (MIT): dämpade gröna paneler, varma accenter,
 * tecknat hus och mätvärden med sammanhang. Live-data från Home Assistant via hass.
 */
const OBS_VERSION = '0.1.0';

const OBS_DEFAULTS = {
  title: 'Hemmet, i överblick.',
  subtitle: 'Ett ställe att förstå huset.',
  solar: 'sensor.growatt_tl_x_xh_tl3_xh_pv_power',
  load: 'sensor.growatt_tl_x_xh_tl3_xh_load_power',
  grid: 'sensor.growatt_tl_x_xh_tl3_xh_grid_power',
  garage: 'sensor.go_echarger_404702_power_total',
  garage_label: 'Laddbox',
  ev_soc: 'sensor.ev6_laddningsniva_soc',
  ev_label: 'EV6',
  hot_water: 'sensor.varmvattenberedare_status',
  outdoor: 'weather.smhi_home',
  indoor: 'sensor.daikinap97060_climatecontrol_rumstemperatur',
  heatpump: 'sensor.shellypmminig3_48f6eeb4a5d4_effekt',
  price: 'sensor.nordpool_kwh_se3_sek_3_10_025',
  pv_today: 'sensor.growatt_tl_x_xh_tl3_xh_pv_energy_today',
  load_today: 'sensor.growatt_tl_x_xh_tl3_xh_load_energy_today',
  grid_in_today: 'sensor.growatt_tl_x_xh_tl3_xh_grid_energy_in_today',
  grid_out_today: 'sensor.growatt_tl_x_xh_tl3_xh_grid_energy_out_today',
  hours: 24,
  price_high: 1.75,
  price_low: 1.0,
};

const HW_STATUS = {
  waiting_cheap: 'Väntar på billig el',
  heating: 'Värmer',
  heating_cheap: 'Värmer på billig el',
  idle: 'Klar',
  done: 'Klar',
  boost: 'Boost',
  off: 'Av',
};

class ObservatoryCard extends HTMLElement {
  static getStubConfig() { return {}; }
  setConfig(config) {
    this._config = { ...OBS_DEFAULTS, ...(config || {}) };
    this._stats = null;
    this._statsAt = 0;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._render();
  }
  getCardSize() { return 9; }
  getGridOptions() { return { columns: 'full', rows: 'auto' }; }

  set hass(hass) {
    this._hass = hass;
    if (Date.now() - this._statsAt > 5 * 60 * 1000) this._loadStats();
    this._render();
  }

  connectedCallback() {
    this._clock = setInterval(() => this._tick(), 30000);
  }
  disconnectedCallback() { clearInterval(this._clock); }

  _tick() {
    const el = this.shadowRoot && this.shadowRoot.getElementById('clock');
    if (el) el.textContent = this._clockText();
  }

  async _loadStats() {
    if (!this._hass || !this._hass.callWS) return;
    this._statsAt = Date.now();
    const c = this._config;
    const ids = [c.solar, c.load, c.grid].filter(Boolean);
    const start = new Date(Date.now() - c.hours * 3600 * 1000);
    start.setMinutes(0, 0, 0);
    try {
      const res = await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        statistic_ids: ids,
        period: 'hour',
        types: ['mean'],
      });
      this._stats = res;
      this._render();
    } catch (e) {
      this._stats = { _error: String(e && e.message || e) };
      this._render();
    }
  }

  _st(id) { return id && this._hass ? this._hass.states[id] : undefined; }
  _num(id, attr) {
    const s = this._st(id);
    if (!s) return null;
    const v = attr ? s.attributes[attr] : s.state;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  _outdoor() {
    const c = this._config;
    if (!c.outdoor) return null;
    return c.outdoor.startsWith('weather.') ? this._num(c.outdoor, 'temperature') : this._num(c.outdoor);
  }

  _clockText() {
    const d = new Date();
    return d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) +
      ' · ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  _w(v) {
    if (v == null) return { v: '–', u: '' };
    const a = Math.abs(v);
    if (a >= 1000) return { v: (a / 1000).toLocaleString('sv-SE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }), u: 'kW' };
    return { v: Math.round(a).toLocaleString('sv-SE'), u: 'W' };
  }
  _f(v, d = 1) { return v == null ? '–' : v.toLocaleString('sv-SE', { maximumFractionDigits: d, minimumFractionDigits: d }); }

  _insight(d) {
    const parts = [];
    if (d.solar == null || d.load == null) return 'Några mätvärden saknas just nu och visas som okända.';
    if (d.solar < 20) parts.push('Ingen sol just nu.');
    else parts.push(`Solen ger ${this._w(d.solar).v} ${this._w(d.solar).u}.`);
    if (d.grid != null) {
      if (d.grid > 30) {
        const share = d.load > 0 ? Math.min(100, Math.round(d.grid / d.load * 100)) : 0;
        parts.push(share >= 95 ? `Huset drar ${this._w(d.load).v} ${this._w(d.load).u}, allt från nätet.`
          : `Huset drar ${this._w(d.load).v} ${this._w(d.load).u}, ${share} % från nätet.`);
      } else if (d.grid < -30) parts.push(`Du säljer ${this._w(d.grid).v} ${this._w(d.grid).u} till nätet.`);
      else parts.push('Huset går jämnt upp med solen.');
    }
    if (d.price != null) {
      const c = this._config;
      const lvl = d.price >= c.price_high ? 'högt' : d.price <= c.price_low ? 'lågt' : 'normalt';
      parts.push(`Elpriset är ${lvl} (${this._f(d.price, 2)} kr/kWh).`);
    }
    return parts.join(' ');
  }

  _chart() {
    const c = this._config;
    if (!this._stats) return `<div class="chart-empty">Hämtar historik …</div>`;
    if (this._stats._error) return `<div class="chart-empty">Historiken kunde inte hämtas.</div>`;
    const series = [
      { id: c.solar, cls: 'sol', name: 'Sol' },
      { id: c.load, cls: 'load', name: 'Förbrukning' },
      { id: c.grid, cls: 'grid', name: 'Nät' },
    ].map(s => ({ ...s, rows: (this._stats[s.id] || []).map(r => ({ t: r.start, v: r.mean })) }));
    const all = series.flatMap(s => s.rows);
    if (!all.length) return `<div class="chart-empty">Ingen historik ännu.</div>`;
    const W = 720, H = 190, pl = 34, pr = 8, pt = 10, pb = 22;
    const t0 = Math.min(...all.map(r => r.t)), t1 = Math.max(...all.map(r => r.t));
    const vals = all.map(r => r.v).filter(v => v != null);
    let vmax = Math.max(1000, ...vals), vmin = Math.min(0, ...vals);
    vmax = Math.ceil(vmax / 1000) * 1000; vmin = Math.floor(vmin / 1000) * 1000;
    const x = t => pl + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - pl - pr);
    const y = v => pt + (vmax - v) / (vmax - vmin) * (H - pt - pb);
    const path = rows => {
      let d = '', prev = null;
      rows.forEach(r => {
        if (r.v == null) { prev = null; return; }
        const gap = prev && r.t - prev.t > 2 * 3600 * 1000;
        d += `${!prev || gap ? 'M' : 'L'}${x(r.t).toFixed(1)},${y(r.v).toFixed(1)} `;
        prev = r;
      });
      return d.trim();
    };
    const sol = series[0].rows.filter(r => r.v != null);
    const area = sol.length ? `M${x(sol[0].t)},${y(0)} ` + sol.map(r => `L${x(r.t).toFixed(1)},${y(r.v).toFixed(1)}`).join(' ') + ` L${x(sol[sol.length - 1].t)},${y(0)} Z` : '';
    let grid = '';
    for (let v = vmin; v <= vmax; v += 1000) {
      grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'zero' : 'gl'}"/>` +
        `<text x="${pl - 6}" y="${y(v) + 3}" class="ax" text-anchor="end">${v / 1000}</text>`;
    }
    let ticks = '';
    for (let t = t0; t <= t1; t += 3600 * 1000) {
      const h = new Date(t).getHours();
      if (h % 4 === 0) ticks += `<text x="${x(t)}" y="${H - 6}" class="ax" text-anchor="middle">${String(h).padStart(2, '0')}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart">
      ${grid}${ticks}
      <path d="${area}" class="area-sol"/>
      <path d="${path(series[0].rows)}" class="ln sol"/>
      <path d="${path(series[1].rows)}" class="ln load"/>
      <path d="${path(series[2].rows)}" class="ln grid"/>
      <text x="${pl + 4}" y="${pt + 9}" class="ax">kW</text>
    </svg>`;
  }

  _house(d) {
    // Generic line-art house + detached garage, drawn in code.
    const sunOn = d.solar != null && d.solar > 20;
    const sell = d.grid != null && d.grid < -30, buy = d.grid != null && d.grid > 30;
    const charging = d.garage != null && d.garage > 50;
    return `<svg viewBox="0 0 420 250" class="house" aria-hidden="true">
      <defs>
        <linearGradient id="obs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--obs-sky1)"/><stop offset="1" stop-color="var(--obs-sky2)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="420" height="250" rx="10" fill="url(#obs-sky)"/>
      ${sunOn ? `<g class="sun"><circle cx="356" cy="46" r="15"/>${[0,45,90,135,180,225,270,315].map(a => {
        const r1 = 21, r2 = 28, rad = a * Math.PI / 180;
        return `<line x1="${356 + r1 * Math.cos(rad)}" y1="${46 + r1 * Math.sin(rad)}" x2="${356 + r2 * Math.cos(rad)}" y2="${46 + r2 * Math.sin(rad)}"/>`;
      }).join('')}</g>` : `<g class="moon"><path d="M362 34a16 16 0 1 0 10 26a13 13 0 1 1 -10 -26z"/></g>
        <g class="stars"><circle cx="300" cy="30" r="1.3"/><circle cx="250" cy="52" r="1"/><circle cx="388" cy="78" r="1.1"/><circle cx="210" cy="24" r="1"/></g>`}
      <line x1="0" y1="212" x2="420" y2="212" class="ground"/>
      <!-- house -->
      <g class="bld">
        <path d="M44 212 V128 L132 70 L220 128 V212 Z" class="wall"/>
        <path d="M34 134 L132 64 L230 134" class="roofline"/>
        <g class="panels">${[0,1,2,3].map(i => { const yr = x => 134 - 0.714 * (x - 34); const a = 62 + i * 15, b = a + 12; return `<path d="M${a} ${(yr(a)+5).toFixed(1)} L${b} ${(yr(b)+5).toFixed(1)} L${b} ${(yr(b)+12).toFixed(1)} L${a} ${(yr(a)+12).toFixed(1)} Z"/>`; }).join('')}</g>
        <rect x="70" y="150" width="34" height="28" class="win"/>
        <rect x="160" y="150" width="34" height="28" class="win"/>
        <rect x="118" y="168" width="28" height="44" class="door"/>
      </g>
      <!-- garage -->
      <g class="bld">
        <path d="M262 212 V156 L311 124 L360 156 V212 Z" class="wall"/>
        <path d="M254 160 L311 120 L368 160" class="roofline"/>
        <rect x="282" y="168" width="58" height="44" class="gdoor"/>
        <line x1="282" y1="182" x2="340" y2="182" class="gline"/><line x1="282" y1="196" x2="340" y2="196" class="gline"/>
        <rect x="364" y="176" width="9" height="16" rx="2" class="charger ${charging ? 'on' : ''}"/>
      </g>
      <!-- grid pole -->
      <g class="pole"><line x1="16" y1="212" x2="16" y2="120"/><line x1="6" y1="128" x2="26" y2="128"/>
        <path d="M26 128 Q 36 140 44 150" class="wire ${buy ? 'buy' : sell ? 'sell' : ''}"/></g>
      <!-- pills -->
      ${this._pill(352, 92, 'Sol', d.solar, 'sol')}
      ${this._pill(132, 232, 'Hus', d.house, 'load')}
      ${this._pill(311, 232, this._config.garage_label, d.garage, 'garage')}
      ${this._pill(64, 34, buy ? 'Köper' : sell ? 'Säljer' : 'Nät', d.grid, 'grid')}
    </svg>`;
  }
  _pill(cx, cy, label, val, cls) {
    const w = this._w(val);
    const text = `${label} ${w.v}${w.u ? ' ' + w.u : ''}`;
    const width = Math.max(64, text.length * 6.6 + 18);
    return `<g class="pill ${cls}"><rect x="${cx - width / 2}" y="${cy - 11}" width="${width}" height="22" rx="11"/>
      <circle cx="${cx - width / 2 + 11}" cy="${cy}" r="3"/>
      <text x="${cx - width / 2 + 20}" y="${cy + 4}">${label} <tspan class="pv">${w.v}${w.u ? ' ' + w.u : ''}</tspan></text></g>`;
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const c = this._config;
    const d = {
      solar: this._num(c.solar), load: this._num(c.load), grid: this._num(c.grid),
      garage: this._num(c.garage), soc: this._num(c.ev_soc), price: this._num(c.price),
      hw: this._num(c.hot_water, 'temperature'), hwTarget: this._num(c.hot_water, 'target_temperature'),
      hwState: this._st(c.hot_water) ? this._st(c.hot_water).state : null,
      outdoor: this._outdoor(), indoor: this._num(c.indoor), hp: this._num(c.heatpump),
      pvToday: this._num(c.pv_today), loadToday: this._num(c.load_today),
      inToday: this._num(c.grid_in_today), outToday: this._num(c.grid_out_today),
    };
    d.house = d.load != null && d.garage != null && d.garage <= d.load ? d.load - d.garage : d.load;
    const live = this._hass && [c.solar, c.load, c.grid].every(id => {
      const s = this._st(id); return s && !['unknown', 'unavailable'].includes(s.state);
    });
    const tile = (label, val, cls, sub, entity) => {
      const w = val && typeof val === 'object' ? val : this._w(val);
      return `<button class="tile ${cls}" data-entity="${entity || ''}"><span class="lbl"><i></i>${label}</span>
        <span class="big">${w.v}<small>${w.u}</small></span><span class="sub">${sub || ''}</span></button>`;
    };
    const gridSub = d.grid == null ? 'okänt' : d.grid > 30 ? 'köper från nätet' : d.grid < -30 ? 'säljer till nätet' : 'i balans';
    const priceLvl = d.price == null ? '' : d.price >= c.price_high ? 'hi' : d.price <= c.price_low ? 'lo' : 'mid';
    const hwPct = d.hw != null && d.hwTarget ? Math.max(0, Math.min(100, d.hw / d.hwTarget * 100)) : 0;
    const selfUse = d.pvToday != null && d.outToday != null && d.pvToday > 0 ? Math.round((d.pvToday - d.outToday) / d.pvToday * 100) : null;

    this.shadowRoot.innerHTML = `<style>${ObservatoryCard.css}</style>
    <ha-card>
      <header>
        <div>
          <div class="eyebrow">OBSERVATORIET / HEMMA</div>
          <h1>${c.title}</h1>
          <p>${c.subtitle}</p>
        </div>
        <div class="mode">
          <span class="badge ${live ? 'live' : 'stale'}"><i></i>${live ? 'LIVE · HOME ASSISTANT' : 'VÄNTAR PÅ DATA'}</span>
          <span id="clock">${this._clockText()}</span>
        </div>
      </header>
      <div class="insight">${this._insight(d)}</div>

      <div class="grid-top">
        <section class="panel housep">${this._house(d)}</section>
        <section class="tiles">
          ${tile('Sol nu', d.solar, 'sol', d.pvToday != null ? `${this._f(d.pvToday)} kWh idag` : '', c.solar)}
          ${tile('Förbrukning', d.load, 'load', d.loadToday != null ? `${this._f(d.loadToday)} kWh idag` : '', c.load)}
          ${tile('Nät', d.grid, 'grid', gridSub, c.grid)}
          ${tile(c.ev_label, { v: d.soc == null ? '–' : Math.round(d.soc), u: '%' }, 'garage',
            d.garage != null && d.garage > 50 ? `laddar ${this._w(d.garage).v} ${this._w(d.garage).u}` : 'laddar inte', c.ev_soc)}
        </section>
      </div>

      <section class="panel chartp">
        <div class="ph"><span class="eyebrow">SENASTE ${c.hours} TIMMARNA</span>
          <span class="legend"><span class="sol"><i></i>Sol</span><span class="load"><i></i>Förbrukning</span><span class="grid"><i></i>Nät (+ köp / − sälj)</span></span></div>
        ${this._chart()}
      </section>

      <div class="grid-bottom">
        <section class="panel thermal">
          <div class="ph"><span class="eyebrow">VÄRME</span></div>
          <div class="hw" data-entity="${c.hot_water}">
            <div class="hwtop"><span class="lbl">Varmvatten</span><span class="chip"><i></i>${HW_STATUS[d.hwState] || d.hwState || 'okänt'}</span></div>
            <div class="big">${this._f(d.hw)}<small>°C</small><span class="tgt">mål ${d.hwTarget != null ? Math.round(d.hwTarget) : '–'} °C</span></div>
            <div class="bar"><span style="width:${hwPct}%"></span></div>
          </div>
          <div class="stats">
            <div class="stat" data-entity="${c.outdoor}"><span>Ute</span><b>${this._f(d.outdoor)} °C</b></div>
            <div class="stat" data-entity="${c.indoor}"><span>Inne</span><b>${this._f(d.indoor)} °C</b></div>
            <div class="stat" data-entity="${c.heatpump}"><span>Värmepump</span><b>${this._w(d.hp).v} ${this._w(d.hp).u}</b></div>
          </div>
        </section>
        <section class="panel today">
          <div class="ph"><span class="eyebrow">IDAG</span></div>
          <div class="stats four">
            <div class="stat sol"><span>Sol</span><b>${this._f(d.pvToday)} kWh</b></div>
            <div class="stat"><span>Förbrukat</span><b>${this._f(d.loadToday)} kWh</b></div>
            <div class="stat grid"><span>Köpt</span><b>${this._f(d.inToday)} kWh</b></div>
            <div class="stat"><span>Sålt</span><b>${this._f(d.outToday)} kWh</b></div>
          </div>
          <div class="pricebox ${priceLvl}" data-entity="${c.price}">
            <span class="lbl">Elpris nu</span><b>${this._f(d.price, 2)} <small>kr/kWh</small></b>
            <span class="sub">${selfUse != null ? `${selfUse} % av solen använd hemma idag` : ''}</span>
          </div>
        </section>
      </div>
      <footer><span>LOCAL FIRST · data stannar i Home Assistant</span><span>v${OBS_VERSION}</span></footer>
    </ha-card>`;

    this.shadowRoot.querySelectorAll('[data-entity]').forEach(el => {
      const id = el.getAttribute('data-entity');
      if (!id) return;
      el.addEventListener('click', () => {
        const ev = new Event('hass-more-info', { bubbles: true, composed: true });
        ev.detail = { entityId: id };
        this.dispatchEvent(ev);
      });
    });
  }
}

ObservatoryCard.css = `
:host{--obs-bg:#101610;--obs-panel:#192119;--obs-line:#354331;--obs-text:#e5e8d9;--obs-muted:#9fac93;
  --obs-sage:#aebf91;--obs-orange:#d79971;--obs-gold:#d3b877;--obs-blue:#8aaeb0;--obs-sky1:#152016;--obs-sky2:#1d2a1c}
ha-card{display:block;box-sizing:border-box;background:var(--obs-bg);color:var(--obs-text);border:1px solid var(--obs-line);border-radius:12px;padding:26px 28px 16px;
  font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden}
.eyebrow{font:10px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px;color:var(--obs-orange)}
header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}
h1{font-size:34px;letter-spacing:-.8px;line-height:1.15;margin:8px 0 6px;font-weight:700}
header p{margin:0;color:var(--obs-muted);font-size:13px}
.mode{display:flex;flex-direction:column;align-items:flex-end;gap:8px;font:10px/1.5 ui-monospace,monospace;color:var(--obs-muted);text-transform:capitalize;text-align:right}
.badge{display:inline-flex;align-items:center;gap:7px;border-radius:3px;padding:6px 10px;letter-spacing:1px;text-transform:none}
.badge i{width:6px;height:6px;border-radius:50%}
.badge.live{background:#24311f;color:#cfe0b4;border:1px solid #4f6440}.badge.live i{background:var(--obs-sage);box-shadow:0 0 0 0 rgba(174,191,145,.6);animation:pulse 2.4s infinite}
.badge.stale{background:#303426;color:#d2c893;border:1px solid #646044}.badge.stale i{background:var(--obs-gold)}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(174,191,145,.55)}70%{box-shadow:0 0 0 7px rgba(174,191,145,0)}100%{box-shadow:0 0 0 0 rgba(174,191,145,0)}}
.insight{margin:18px 0 18px;padding:11px 0;border-block:1px solid var(--obs-line);color:var(--obs-muted);font-size:13px}
.panel{background:var(--obs-panel);border:1px solid var(--obs-line);border-radius:8px;padding:18px;min-width:0}
.grid-top{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:14px}
.housep{padding:10px}
.house{width:100%;height:auto;display:block}
.house .ground{stroke:#3d4c37;stroke-width:1.5}
.house .wall{fill:#1b241a;stroke:var(--obs-sage);stroke-width:1.6;stroke-linejoin:round}
.house .roofline{fill:none;stroke:var(--obs-sage);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.house .panels path{fill:#26321f;stroke:var(--obs-gold);stroke-width:1}
.house .win{fill:#2a3423;stroke:#6f805d;stroke-width:1.2}
.house .door{fill:#151d14;stroke:#6f805d;stroke-width:1.2}
.house .gdoor{fill:#151d14;stroke:#6f805d;stroke-width:1.2}.house .gline{stroke:#3f4d38;stroke-width:1}
.house .charger{fill:#2a3423;stroke:var(--obs-orange);stroke-width:1.2}.house .charger.on{fill:var(--obs-orange)}
.house .sun circle{fill:var(--obs-gold)}.house .sun line{stroke:var(--obs-gold);stroke-width:2;stroke-linecap:round}
.house .moon path{fill:#c9cfb6}.house .stars circle{fill:#c9cfb6;opacity:.7}
.house .pole line{stroke:#6f805d;stroke-width:2}
.house .wire{fill:none;stroke:#6f805d;stroke-width:1.2}.house .wire.buy,.house .wire.sell{stroke:var(--obs-blue);stroke-dasharray:4 4;animation:flow 1s linear infinite}
.house .wire.sell{animation-direction:reverse}
@keyframes flow{to{stroke-dashoffset:-8}}
.pill rect{fill:#111811;stroke:var(--obs-line)}.pill text{font:600 11px -apple-system,'Segoe UI',sans-serif;fill:var(--obs-muted)}
.pill .pv{fill:var(--obs-text)}
.pill.sol circle{fill:var(--obs-gold)}.pill.load circle{fill:var(--obs-sage)}.pill.grid circle{fill:var(--obs-blue)}.pill.garage circle{fill:var(--obs-orange)}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.tile{all:unset;box-sizing:border-box;cursor:pointer;justify-content:space-between;background:var(--obs-panel);border:1px solid var(--obs-line);border-radius:8px;padding:16px 16px 14px;display:flex;flex-direction:column;gap:4px;min-width:0;min-height:120px}
.tile:hover{border-color:#5a6d4b}
.lbl{display:flex;align-items:center;gap:8px;font:10px/1.6 ui-monospace,monospace;letter-spacing:1.5px;text-transform:uppercase;color:var(--obs-muted)}
.lbl i{width:7px;height:7px;border-radius:50%;background:var(--obs-sage)}
.tile.sol .lbl i{background:var(--obs-gold)}.tile.grid .lbl i{background:var(--obs-blue)}.tile.garage .lbl i{background:var(--obs-orange)}
.big{font-size:38px;font-weight:300;letter-spacing:-1px;line-height:1.1;margin-top:6px}
.big small{font-size:14px;color:var(--obs-muted);margin-left:5px;letter-spacing:0;font-weight:400}
.sub{font-size:12px;color:var(--obs-muted)}
.chartp{margin-top:14px}
.ph{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.legend{display:flex;gap:14px;font-size:11px;color:var(--obs-muted);flex-wrap:wrap}
.legend span{display:flex;align-items:center;gap:6px}.legend i{width:12px;height:3px;border-radius:2px;background:var(--obs-sage)}
.legend .sol i{background:var(--obs-gold)}.legend .grid i{background:var(--obs-blue)}
.chart{width:100%;height:190px;display:block}
.chart .gl{stroke:#283325;stroke-width:1}.chart .zero{stroke:#4a5a42;stroke-width:1}
.chart .ax{font:9px ui-monospace,monospace;fill:#7d8a72}
.chart .ln{fill:none;stroke-width:2;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.chart .ln.sol{stroke:var(--obs-gold)}.chart .ln.load{stroke:var(--obs-sage)}.chart .ln.grid{stroke:var(--obs-blue);stroke-dasharray:5 4}
.chart .area-sol{fill:rgba(211,184,119,.14)}
.chart-empty{height:190px;display:grid;place-items:center;color:var(--obs-muted);font-size:13px}
.grid-bottom{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.hw{cursor:pointer}
.hwtop{display:flex;justify-content:space-between;align-items:center;gap:10px}
.chip{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#dfc395;background:#30291c;border:1px solid #6b5536;border-radius:999px;padding:3px 10px}
.chip i{width:6px;height:6px;border-radius:50%;background:var(--obs-orange)}
.tgt{font-size:12px;color:var(--obs-muted);margin-left:12px;letter-spacing:0;font-weight:400}
.bar{height:6px;border-radius:3px;background:#263022;margin:10px 0 14px;overflow:hidden}
.bar span{display:block;height:100%;background:linear-gradient(90deg,var(--obs-blue),var(--obs-orange));border-radius:3px}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.stats.four{grid-template-columns:repeat(4,minmax(0,1fr))}
.stat{background:rgba(174,191,145,.05);border:1px solid #2c3829;border-radius:8px;padding:9px 11px;cursor:pointer;min-width:0}
.stat span{display:block;font-size:11px;color:var(--obs-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stat b{font-size:17px;font-weight:500}
.stat.sol b{color:var(--obs-gold)}.stat.grid b{color:var(--obs-blue)}
.pricebox{margin-top:12px;display:grid;grid-template-columns:auto 1fr;align-items:baseline;gap:2px 14px;border-radius:8px;padding:12px 14px;border:1px solid #2c3829;cursor:pointer}
.pricebox b{font-size:26px;font-weight:300}.pricebox b small{font-size:12px;color:var(--obs-muted)}
.pricebox .sub{grid-column:1/-1}
.pricebox.hi{background:#30221c;border-color:#6b4536}.pricebox.hi b{color:#e3a07c}
.pricebox.mid{background:#2d2b1d;border-color:#5f5838}.pricebox.mid b{color:var(--obs-gold)}
.pricebox.lo{background:#1f2c1d;border-color:#4b6340}.pricebox.lo b{color:var(--obs-sage)}
footer{display:flex;justify-content:space-between;margin-top:14px;font:9px/1.6 ui-monospace,monospace;letter-spacing:1.5px;color:#76836b}
@media (max-width:820px){.grid-top,.grid-bottom{grid-template-columns:1fr}}
@media (max-width:520px){
  ha-card{padding:18px 14px 12px}
  header{flex-direction:column;gap:10px}.mode{align-items:flex-start;text-align:left}
  h1{font-size:27px}
  .big{font-size:30px}.tile{padding:13px}
  .stats.four{grid-template-columns:1fr 1fr}
  .chart{height:150px}
}
`;

customElements.define('observatory-card', ObservatoryCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'observatory-card', name: 'Observatory', description: 'Hemmet i överblick: sol, förbrukning, nät, värme och elpris.' });
console.info(`%c OBSERVATORY-CARD %c ${OBS_VERSION} `, 'background:#aebf91;color:#101610;font-weight:700', 'background:#192119;color:#e5e8d9');
