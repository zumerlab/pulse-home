// Records the demo house for the demo: every item with its semantics as the
// REST API gives it, trimmed to the fields the source reads, a drawn cover per
// Image item (see below), and a day of persistence for the numeric points and
// the heating switches, thinned to ten minutes. Writes demo/recording.json and
// demo/covers/<item>.svg beside itself. From the repository root:
//   node src/openhab/demo/scripts/record.mjs [server]
// The server is demo.openhab.org unless named (or OPENHAB_URL).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = (process.argv[2] ?? process.env.OPENHAB_URL ?? 'https://demo.openhab.org').replace(/\/+$/, '');
const here = dirname(fileURLToPath(import.meta.url)), demo = join(here, '..');
const get = async (path) => { const r = await fetch(`${server}${path}`, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); };
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const now = Date.now();
const [root, raw] = await Promise.all([get('/rest/'), get('/rest/items?metadata=semantics&recursive=false')]);
// The fields the source reads, nothing else (no links, no editability, no icons).
const items = raw.map((i) => ({
  ...pick(i, ['name', 'type', 'label', 'state', 'unitSymbol', 'tags', 'groupNames', 'lastState', 'lastStateUpdate', 'lastStateChange']),
  ...(i.metadata?.semantics ? { metadata: { semantics: pick(i.metadata.semantics, ['value', 'config']) } } : {}),
  ...(i.stateDescription ? { stateDescription: pick(i.stateDescription, ['pattern', 'readOnly', 'options']) } : {}),
  ...(i.commandDescription ? { commandDescription: pick(i.commandDescription, ['commandOptions']) } : {}),
})).map((i) => (i.type === 'String' && i.state.length > 240 ? { ...i, state: 'NULL' } : i));

// The covers: an Image item's state is the album's art, which is not ours to
// keep. The demo gets a drawn cover instead, a disc in a color of its own with
// the album and the artist named (the sibling points), as a file the state names.
const dir = join(demo, 'covers');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const drawn = (album, artist) => {
  const hue = [...`${album}${artist}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><radialGradient id="g" cx="35%" cy="30%" r="85%"><stop offset="0" stop-color="hsl(${hue} 70% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 60% 20%)"/></radialGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="138" r="74" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="10"/><circle cx="150" cy="138" r="13" fill="rgba(0,0,0,.45)"/><text x="150" y="252" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="600" fill="#fff">${esc(album)}</text><text x="150" y="278" text-anchor="middle" font-family="system-ui, sans-serif" font-size="15" fill="rgba(255,255,255,.8)">${esc(artist)}</text></svg>\n`;
};
let covers = 0;
for (const i of items) {
  if (i.type !== 'Image') continue;
  if (!/^data:image\//.test(i.state)) { i.state = 'NULL'; continue; }
  const eq = i.metadata?.semantics?.config?.isPointOf;
  const sibling = (re) => items.find((o) => o.metadata?.semantics?.config?.isPointOf === eq && o.type === 'String' && re.test(`${o.name} ${o.label}`))?.state ?? '';
  const file = `${i.name}.svg`;
  writeFileSync(join(dir, file), drawn(sibling(/album/i), sibling(/artist/i)));
  i.state = `covers/${file}`;
  covers++;
}

// A day of persistence, where the server keeps one: every measurement and setpoint, the heating and
// air-conditioning switches, the battery, thinned to one point per ten minutes (a switch keeps its changes).
const sem = (i) => i.metadata?.semantics?.value ?? '';
const kept = items.filter((i) => /^Point_(Measurement|Setpoint|Status|Control)/.test(sem(i)) && (i.type.startsWith('Number') || i.type === 'Switch' || i.type === 'Contact'));
const start = new Date(now - 24 * 3_600_000).toISOString();
const history = {};
await Promise.all(kept.map(async (i) => {
  const r = await get(`/rest/persistence/items/${encodeURIComponent(i.name)}?starttime=${start}`).catch(() => null);
  if (!r?.data?.length) return;
  const rows = [];
  let lastBin = -1, lastState;
  for (const d of r.data) {
    const bin = Math.floor(d.time / 600_000);
    const state = /^-?\d/.test(d.state) ? String(Math.round(Number(d.state) * 100) / 100) : d.state;
    if (i.type === 'Switch' || i.type === 'Contact' ? state !== lastState : bin !== lastBin) { rows.push([d.time, state]); lastBin = bin; lastState = state; }
  }
  history[i.name] = rows;
}));

const recording = { at: now, server, version: root.runtimeInfo?.version ?? '', timezone: root.timezone ?? '', items, history };
writeFileSync(join(demo, 'recording.json'), `${JSON.stringify(recording)}\n`);
const points = Object.values(history).reduce((a, r) => a + r.length, 0);
console.log(`${server}: ${items.length} items, ${covers} covers, ${Object.keys(history).length} items with a day of history (${points} points)`);
