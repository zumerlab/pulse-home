// A stand-in for an openHAB server over the recorded demo house, for the tests
// of the app's live path: what `RestSource` asks a real openHAB for, answered
// as openHAB 5 answers it. The items with their semantics at /rest/items, the
// `fields` asked for honored (the state among them only when asked); the state
// stream at /rest/events/states (the connection named first, the states of the
// items posted to it at once, then each change, a heartbeat; an Image's state
// as a line about its bytes, never the picture); an item's state alone at
// /rest/items/<name>/state (an Image's picture: the cover drawn for the demo,
// as a data URI); a command echoed as openHAB would; a day of persistence.
// /_asked tells what was asked, so a test can check what the app read; a POST
// to /_reset puts the house back as recorded. Playwright starts it
// (playwright.config.ts); by hand:
//   node tests/openhab-server.mjs [port]      (5175 unless named)

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? process.env.PULSE_OPENHAB_PORT ?? 5175);
const demo = join(dirname(fileURLToPath(import.meta.url)), '../src/openhab/demo');
const rec = JSON.parse(readFileSync(join(demo, 'recording.json'), 'utf8'));
const shift = Date.now() - rec.at;

// The items as openHAB lists them: the recording's, each cover as the picture it stands for (a data URI,
// as an Image item's state is), the times moved to now.
const items = new Map();
const asked = { items: [], states: [], tracked: 0, commands: [] };
function reset() {
  items.clear();
  for (const d of rec.items) {
    const i = { ...d };
    if (i.type === 'Image') i.state = /^covers\//.test(i.state) ? `data:image/svg+xml;base64,${readFileSync(join(demo, i.state)).toString('base64')}` : 'NULL';
    if (i.lastStateChange) i.lastStateChange += shift;
    if (i.lastStateUpdate) i.lastStateUpdate += shift;
    items.set(i.name, i);
  }
  asked.items = []; asked.states = []; asked.tracked = 0; asked.commands = [];
}
reset();

// The open streams, by the connection's name, each with the items it follows.
const streams = new Map();
// A state as the stream tells it: an Image's as a line about its bytes, never the picture.
const tracked = (i) => (i.type === 'Image' ? { state: /^data:/.test(i.state) ? `raw type (${/^data:([^;]+)/.exec(i.state)[1]}): ${i.state.length} bytes` : i.state, type: 'Raw' } : { state: i.state });
const send = (res, event, data) => res.write(`${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
const tell = (names) => {
  for (const s of streams.values()) {
    const block = Object.fromEntries(names.filter((n) => s.names.has(n)).map((n) => [n, tracked(items.get(n))]));
    if (Object.keys(block).length) send(s.res, '', block);
  }
};

// What an item's state becomes after a command, as openHAB would echo it; null when the item does not take it.
function applied(i, c) {
  const n = /^-?\d+(\.\d+)?$/.test(c) ? Number(c) : null, pct = (v) => String(Math.max(0, Math.min(100, Math.round(v))));
  switch (i.type) {
    case 'Switch': return c === 'ON' || c === 'OFF' ? c : null;
    case 'Dimmer': return c === 'ON' ? '100' : c === 'OFF' ? '0' : n != null ? pct(n) : null;
    case 'Color': { const hsb = i.state.split(','); return c === 'ON' ? `${hsb[0]},${hsb[1]},100` : c === 'OFF' ? `${hsb[0]},${hsb[1]},0` : /^\d+,\d+,\d+$/.test(c) ? c : n != null ? `${hsb[0]},${hsb[1]},${pct(n)}` : null; }
    case 'Rollershutter': return c === 'UP' ? '0' : c === 'DOWN' ? '100' : c === 'STOP' ? i.state : n != null ? pct(n) : null;
    case 'Player': return c === 'PLAY' || c === 'PAUSE' ? c : /^(NEXT|PREVIOUS|REWIND|FASTFORWARD)$/.test(c) ? i.state : null;
    case 'String': return c;
  }
  if (i.type.startsWith('Number') && n != null) { const u = /\S\s+(\S+)$/.exec(i.state)?.[1]; return u ? `${c} ${u}` : c; }
  return null;
}

// The page reads this server from another origin (?server=), so every answer allows it.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type' };
const json = (res, status, body) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const text = (res, status, body) => { res.writeHead(status, { ...cors, 'Content-Type': 'text/plain' }); res.end(body); };
const bodyOf = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => resolve(s)); });
const pick = (o, fields) => (fields ? Object.fromEntries(Object.entries(o).filter(([k]) => fields.includes(k))) : o);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`), path = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (path === '/_asked') return json(res, 200, asked);
  if (path === '/_reset') { reset(); return json(res, 200, { items: items.size }); }
  if (path === '/rest') return json(res, 200, { version: '8', runtimeInfo: { version: rec.version, buildString: 'Release Build' }, timezone: rec.timezone, links: [] });
  if (path === '/rest/items') {
    const fields = url.searchParams.get('fields')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
    const out = JSON.stringify([...items.values()].map((i) => pick(i, fields)));
    asked.items.push({ fields, bytes: out.length });
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(out);
    return;
  }
  let m;
  if ((m = /^\/rest\/items\/([^/]+)\/state$/.exec(path))) {
    const i = items.get(decodeURIComponent(m[1]));
    if (!i) return text(res, 404, '');
    asked.states.push(i.name);
    return text(res, 200, i.state);
  }
  if ((m = /^\/rest\/items\/([^/]+)$/.exec(path))) {
    const i = items.get(decodeURIComponent(m[1]));
    if (!i) return json(res, 404, { error: { message: 'Item not found.', 'http-code': 404 } });
    if (req.method !== 'POST') return json(res, 200, i);
    const command = (await bodyOf(req)).trim();
    asked.commands.push({ item: i.name, command });
    const next = applied(i, command);
    if (next == null) return json(res, 400, { error: { message: `Item command ${command} is not valid for ${i.name}`, 'http-code': 400 } });
    res.writeHead(200, cors);
    res.end();
    // The binding answers a moment later; the stream tells it.
    setTimeout(() => { if (next !== i.state) { i.state = next; i.lastStateChange = i.lastStateUpdate = Date.now(); tell([i.name]); } }, 50);
    return;
  }
  if (path === '/rest/events/states' && req.method === 'GET') {
    const id = randomUUID();
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: ready\nid: 0\ndata: ${id}\n\n`);
    streams.set(id, { res, names: new Set() });
    const beat = setInterval(() => send(res, 'alive', { type: 'ALIVE', interval: 10 }), 10_000);
    req.on('close', () => { clearInterval(beat); streams.delete(id); });
    return;
  }
  if ((m = /^\/rest\/events\/states\/([^/]+)$/.exec(path)) && req.method === 'POST') {
    const s = streams.get(m[1]);
    if (!s) return json(res, 404, { error: { message: 'Unknown connection', 'http-code': 404 } });
    s.names = new Set(JSON.parse(await bodyOf(req)).filter((n) => items.has(n)));
    asked.tracked = s.names.size;
    res.writeHead(200, cors);
    res.end();
    // Every tracked state at once, then each change.
    send(s.res, '', Object.fromEntries([...s.names].map((n) => [n, tracked(items.get(n))])));
    return;
  }
  if ((m = /^\/rest\/persistence\/items\/([^/]+)$/.exec(path))) {
    const name = decodeURIComponent(m[1]), since = Date.parse(url.searchParams.get('starttime') ?? '') || 0;
    const data = (rec.history[name] ?? []).map(([at, state]) => ({ time: at + shift, state })).filter((r) => r.time >= since);
    return json(res, 200, { name, datapoints: String(data.length), data });
  }
  json(res, 404, { error: { message: 'Not found', 'http-code': 404 } });
}).listen(port, '127.0.0.1', () => console.log(`openHAB stand-in at http://127.0.0.1:${port}/rest/ (${items.size} items as recorded)`));
