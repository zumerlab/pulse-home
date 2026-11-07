// Development: register zumer-pulse.js as a dashboard resource in the local Home
// Assistant and create two dashboards ("Pulse", the dashboard strategy;
// "Pulse sections", the card in a sections view) over the admin WebSocket,
// with the tokens of ha-tokens.mjs.
// node ha-install-card.mjs <tokens.json> [resource-url]
import { readFileSync } from 'node:fs';
const tok = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const resourceUrl = process.argv[3] ?? `/local/zumer-pulse.js?v=${Date.now()}`;
const ws = new WebSocket(`${tok.hassUrl.replace(/^http/, 'ws')}/api/websocket`);
let id = 1;
const pending = new Map();
const send = (msg) => new Promise((resolve, reject) => { const n = id++; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, ...msg })); });
ws.onmessage = async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: tok.access_token }));
  else if (m.type === 'auth_ok') {
    try {
      const resources = await send({ type: 'lovelace/resources' });
      for (const r of resources.filter((r) => /(zumer-pulse|pulse-card)\.js/.test(r.url))) await send({ type: 'lovelace/resources/delete', resource_id: r.id });
      const res = await send({ type: 'lovelace/resources/create', res_type: 'module', url: resourceUrl });
      console.log('resource', res.url);
      const dashboards = await send({ type: 'lovelace/dashboards/list' });
      if (!dashboards.some((d) => d.url_path === 'pulse-demo')) {
        await send({ type: 'lovelace/dashboards/create', url_path: 'pulse-demo', title: 'Pulse', icon: 'mdi:radar', show_in_sidebar: true, require_admin: false, mode: 'storage' });
        console.log('dashboard created');
      }
      await send({ type: 'lovelace/config/save', url_path: 'pulse-demo', config: { strategy: { type: 'custom:zumer-pulse' } } });
      console.log('dashboard config saved: strategy custom:zumer-pulse');
      // A second dashboard with the card in a sections view: one section from
      // the section strategy (one system) and one with the card placed by hand.
      if (!dashboards.some((d) => d.url_path === 'pulse-sections')) {
        await send({ type: 'lovelace/dashboards/create', url_path: 'pulse-sections', title: 'Pulse sections', icon: 'mdi:view-grid-outline', show_in_sidebar: true, require_admin: false, mode: 'storage' });
        console.log('dashboard pulse-sections created');
      }
      await send({ type: 'lovelace/config/save', url_path: 'pulse-sections', config: { views: [{ title: 'Home', type: 'sections', max_columns: 2, sections: [
        { strategy: { type: 'custom:zumer-pulse', systems: ['climate'], start: 'climate' } },
        { type: 'grid', cards: [{ type: 'heading', heading: 'Pulse, one card' }, { type: 'custom:zumer-pulse', mode: 'layers' }] },
      ] }] } });
      console.log('dashboard pulse-sections saved');
    } catch (e) { console.error('failed', e); process.exitCode = 1; }
    ws.close();
  } else if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.success) p.resolve(m.result); else p.reject(m.error);
  }
};
ws.onerror = (e) => { console.error('ws error', e.message); process.exitCode = 1; };
