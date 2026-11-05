// Matar observatory-card med data från den egna servern (som i sin tur läser HA).
(async () => {
  const card = document.getElementById('card');
  const config = await (await fetch('api/config', { cache: 'no-store' })).json();
  card.setConfig(config);

  let states = {};
  let connected = false;

  const view = () => {
    if (connected) return states;
    // Utan HA-anslutning visas allt som okänt i stället för gamla värden.
    const out = {};
    for (const [id, s] of Object.entries(states)) out[id] = { ...s, state: 'unavailable' };
    return out;
  };
  const hass = () => ({
    states: view(),
    callWS: async msg => {
      if (msg.type !== 'recorder/statistics_during_period') throw new Error('Stöds inte');
      const hours = Math.round((Date.now() - new Date(msg.start_time).getTime()) / 3600000);
      const r = await fetch(`api/stats?hours=${hours}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      return r.json();
    },
  });
  let queued = false;
  const push = () => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; card.hass = hass(); });
  };

  const es = new EventSource('api/stream');
  es.addEventListener('snapshot', e => { const d = JSON.parse(e.data); states = d.states; connected = d.connected; push(); });
  es.addEventListener('state', e => { const s = JSON.parse(e.data); states = { ...states, [s.entity_id]: s }; push(); });
  es.onerror = () => { connected = false; push(); };

  // Klick på ett värde: ingen more-info utanför HA, så vi ignorerar det.
  card.addEventListener('hass-more-info', e => e.stopPropagation());
})();
