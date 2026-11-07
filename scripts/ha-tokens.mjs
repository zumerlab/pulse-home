// Gets OAuth tokens from the local Home Assistant with the credentials in the
// app's .env.local (what the removed server did), for a one-off live check.
import { readFileSync, writeFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(process.argv[2], 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const base = (env.HA_URL ?? 'http://127.0.0.1:8123').replace(/\/$/, '');
const clientId = 'http://127.0.0.1:5174/';
const post = async (path, body, form = false) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};
const flow = await post('/auth/login_flow', { client_id: clientId, handler: ['homeassistant', null], redirect_uri: clientId });
const done = await post(`/auth/login_flow/${flow.flow_id}`, { client_id: clientId, username: env.HA_USERNAME, password: env.HA_PASSWORD });
if (done.type !== 'create_entry') throw new Error('login rejected');
const tok = await post('/auth/token', { grant_type: 'authorization_code', code: done.result, client_id: clientId }, true);
writeFileSync(process.argv[3], JSON.stringify({ ...tok, hassUrl: base, clientId, expires: Date.now() + tok.expires_in * 1000 }));
console.log('tokens ok, expires_in', tok.expires_in);
