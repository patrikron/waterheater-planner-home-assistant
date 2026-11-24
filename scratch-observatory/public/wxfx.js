// Väder på husbilden (0.62.0): regn, snö, moln, dimma, sol och åska ritas över fotot efter weather-entiteten i HA.
// Lager: #wxveil (grå himmel/dis, CSS) + #wxfx (canvas med partiklar och moln). Inställning weather_fx (standard på).
// Testa ett väder: lägg till ?wx=rainy (eller snowy, pouring, cloudy, partlycloudy, fog, lightning-rainy, sunny, snowy-rainy, hail) i adressen.
(() => {
  const stage = document.getElementById('stage'); if (!stage) return;
  const q = new URLSearchParams(location.search), FORCE = q.get('wx');
  const veil = document.createElement('div'); veil.id = 'wxveil'; veil.className = 'wxveil'; veil.setAttribute('aria-hidden', 'true');
  const cv = document.createElement('canvas'); cv.id = 'wxfx'; cv.className = 'wxfx'; cv.setAttribute('aria-hidden', 'true');
  const ref = stage.querySelector('.glows') || stage.querySelector('#hot');
  stage.insertBefore(veil, ref); stage.insertBefore(cv, ref);
  const ctx = cv.getContext('2d');

  // Vad varje HA-tillstånd ger: moln (0–1), regn/snö/hagel (partiklar per 1000 px bredd), blixt, dimma, sol
  const KIND = {
    'sunny': { sun: 1 },
    'clear-night': { stars: 1 },
    'partlycloudy': { clouds: 0.45, sun: 0.5 },
    'cloudy': { clouds: 1, veil: 'cloud' },
    'fog': { fog: 1, veil: 'fog', clouds: 0.3 },
    'rainy': { rain: 170, clouds: 0.9, veil: 'rain' },
    'pouring': { rain: 420, clouds: 1, veil: 'pour' },
    'lightning': { clouds: 1, veil: 'rain', bolt: 1 },
    'lightning-rainy': { rain: 300, clouds: 1, veil: 'pour', bolt: 1 },
    'snowy': { snow: 230, clouds: 0.9, veil: 'snow' },
    'snowy-rainy': { snow: 80, rain: 100, clouds: 0.95, veil: 'rain' },
    'hail': { hail: 140, rain: 120, clouds: 1, veil: 'pour' },
    'windy': { clouds: 0.5, wind: 1 },
    'windy-variant': { clouds: 0.85, wind: 1, veil: 'cloud' },
  };
  let cond = '', K = {}, windMs = 3, night = false, on = false, W = 0, H = 0, dpr = 1, parts = [], clouds = [], raf = 0, fc = 0, last = 0, flash = 0, nextBolt = 0;
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enabled = () => { const H0 = window.ObsHouse, s = H0 && H0.set && H0.set(); return !(s && s.weather_fx === false); };
  const lite = () => document.body.classList.contains('lite');

  function size() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, lite() ? 1 : 1.5);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function seed() {
    parts = [];
    const f = W / 1000, mul = lite() ? 0.45 : 1;
    const add = (type, n) => { for (let i = 0; i < Math.round(n * f * mul); i++) parts.push(newPart(type, true)); };
    if (K.rain) add('rain', K.rain); if (K.snow) add('snow', K.snow); if (K.hail) add('hail', K.hail);
    clouds = [];
    const nc = Math.round((K.clouds || 0) * 9);
    for (let i = 0; i < nc; i++) clouds.push({ x: rnd(-0.2, 1.1) * W, y: rnd(0, 0.3) * H, s: rnd(0.2, 0.4) * W, a: Math.min(0.9, rnd(0.5, 0.9) * Math.min(1, (K.clouds || 0) + 0.35)), v: rnd(4, 9) });
  }
  function newPart(type, anywhere) {
    const y = anywhere ? rnd(-0.1, 1) * H : rnd(-0.15, -0.02) * H, x = rnd(-0.15, 1.1) * W;
    if (type === 'rain') return { t: type, x, y, l: rnd(14, 28) * (W / 1400), v: rnd(0.9, 1.3) * H * 1.25, a: rnd(0.35, 0.7) };
    if (type === 'hail') return { t: type, x, y, r: rnd(1.2, 2.4) * (W / 1400), v: rnd(1.1, 1.5) * H * 1.1, a: rnd(0.6, 0.9) };
    return { t: 'snow', x, y, r: rnd(1.6, 4.2) * (W / 1400), v: rnd(0.05, 0.12) * H, a: rnd(0.55, 0.95), ph: rnd(0, 6.28), sw: rnd(8, 22) * (W / 1400) };
  }
  // Mjuka moln: några överlappande rundade fläckar
  function cloud(c) {
    const g = night ? [70, 78, 92] : (K.veil === 'pour' || K.veil === 'rain' || K.bolt ? [150, 156, 166] : [236, 238, 242]);
    for (let i = 0; i < 5; i++) {
      const ox = (i - 2) * c.s * 0.22, oy = Math.sin(i * 1.7) * c.s * 0.05, r = c.s * (i === 2 ? 0.34 : 0.24);
      const gr = ctx.createRadialGradient(c.x + ox, c.y + oy, 0, c.x + ox, c.y + oy, r);
      gr.addColorStop(0, `rgba(${g},${c.a})`); gr.addColorStop(0.6, `rgba(${g},${c.a * 0.55})`); gr.addColorStop(1, `rgba(${g},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(c.x + ox, c.y + oy, r, 0, 6.283); ctx.fill();
    }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (lite() && (++fc & 1)) return; // lite: halva bildfrekvensen
    const dt = Math.min(0.08, (now - (last || now)) / 1000); last = now;
    ctx.clearRect(0, 0, W, H);
    const wind = Math.max(-1, Math.min(1, (windMs - 2) / 12)) * (K.wind ? 1.6 : 1);
    // sol: varmt sken uppe till vänster (där solen står på fotot)
    if (K.sun && !night) {
      const t = now / 1000, x = W * 0.16, y = -H * 0.06, r = W * (0.42 + 0.02 * Math.sin(t * 0.6));
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,236,190,${0.6 * K.sun})`); gr.addColorStop(0.35, `rgba(255,214,150,${0.24 * K.sun})`); gr.addColorStop(1, 'rgba(255,210,140,0)');
      ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(x, y);
      for (let i = 0; i < 7; i++) {
        const ang = 0.35 + i * 0.16 + Math.sin(t * 0.25 + i) * 0.02, len = W * 0.7, wdt = 0.025 + (i % 3) * 0.012;
        const lg = ctx.createLinearGradient(0, 0, Math.cos(ang) * len, Math.sin(ang) * len);
        lg.addColorStop(0, `rgba(255,240,205,${0.16 * K.sun})`); lg.addColorStop(1, 'rgba(255,240,205,0)');
        ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang - wdt) * len, Math.sin(ang - wdt) * len); ctx.lineTo(Math.cos(ang + wdt) * len, Math.sin(ang + wdt) * len); ctx.fill();
      }
      ctx.restore(); ctx.globalCompositeOperation = 'source-over';
    }
    if (K.stars && night) {
      for (let i = 0; i < 40; i++) {
        const x = ((i * 977) % 1000) / 1000 * W, y = ((i * 613) % 1000) / 1000 * H * 0.2, tw = 0.35 + 0.35 * Math.sin(now / 900 + i * 2.1);
        ctx.fillStyle = `rgba(240,244,255,${tw})`; ctx.fillRect(x, y, 1.4, 1.4);
      }
    }
    for (const c of clouds) {
      c.x += (c.v + wind * 30) * dt * (W / 1400);
      if (c.x - c.s > W) { c.x = -c.s * 0.8; c.y = rnd(0, 0.3) * H; } else if (c.x + c.s < -c.s) c.x = W + c.s * 0.5;
      cloud(c);
    }
    // nederbörd
    const slant = wind * 0.35;
    ctx.lineCap = 'round';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.t === 'snow') {
        p.ph += dt * 1.3; p.y += p.v * dt; p.x += (Math.sin(p.ph) * p.sw * 0.6 + wind * 60 * (W / 1400)) * dt;
        ctx.fillStyle = `rgba(250,252,255,${p.a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      } else if (p.t === 'hail') {
        p.y += p.v * dt; p.x += slant * p.v * dt;
        ctx.fillStyle = `rgba(235,242,250,${p.a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      } else {
        p.y += p.v * dt; p.x += slant * p.v * dt;
        ctx.strokeStyle = night ? `rgba(190,205,230,${p.a * 0.8})` : `rgba(215,225,240,${p.a})`; ctx.lineWidth = Math.max(1, W / 1200);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - slant * p.l, p.y - p.l); ctx.stroke();
      }
      if (p.y > H + 10 || p.x > W + 40 || p.x < -60) parts[i] = newPart(p.t, false);
    }
    // åska: korta vita blixtar med några sekunders mellanrum
    if (K.bolt) {
      if (!nextBolt) nextBolt = now + rnd(4000, 11000);
      if (now > nextBolt) { flash = 1; nextBolt = now + rnd(5000, 14000); }
      if (flash > 0) { ctx.fillStyle = `rgba(235,240,255,${flash * 0.45})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * (flash > 0.6 ? 2.5 : 4)); if (flash > 0.55 && flash < 0.62) flash = 0.95; }
    }
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; ctx.clearRect(0, 0, W, H); }
  function start() { if (!raf && on && !document.hidden) raf = requestAnimationFrame(frame); }

  function update() {
    const H0 = window.ObsHouse, w = H0 && H0.weather ? H0.weather() : null;
    const c = FORCE || (w && w.cond) || '';
    const n = stage.classList.contains('night');
    if (w && w.wind != null) windMs = w.wind;
    const want = enabled() && !!KIND[c];
    const changed = c !== cond || n !== night || want !== on;
    if (!changed) return;
    cond = c; night = n; on = want; K = on ? KIND[c] : {};
    for (const k of [...stage.classList]) if (k.startsWith('wx-')) stage.classList.remove(k);
    if (on && K.veil) stage.classList.add('wx-' + K.veil);
    if (on && K.snow) stage.classList.add('wx-snowfall');
    stage.classList.toggle('wx-fx', on);
    stop();
    if (!on) return;
    size();
    if (reduced()) { frame(performance.now()); cancelAnimationFrame(raf); raf = 0; return; } // en stillbild
    start();
  }
  window.addEventListener('obs-render', update);
  window.addEventListener('resize', () => { if (on) { size(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else start(); });
  setInterval(update, 30000);
  setTimeout(update, 1500);
})();
