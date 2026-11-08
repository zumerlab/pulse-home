import 'zumly/style.css';
import '@zumer/orbit/style';
import '@zumer/orbit';
import '@zumer/pulse/style.css';
import '../style.css';
import { BOARD_MODES, esc, mountBoard, type BoardMode } from '@zumer/pulse';
import { DemoSource } from './demo/source.ts';
import { hostOf } from './host.ts';
import { previewHouse } from './preview.ts';
import { lastServer, lastToken, PROXY, rememberServer, rememberToken, RestSource, type HouseSource } from './source.ts';
import { t } from './strings.ts';

// Pulse for openHAB: the object over an openHAB server, with the connect
// panel in front while nothing answers. Where the page runs decides where it
// looks by default: served by openHAB itself (the build in conf/html, same
// origin as the REST API) it reads that openHAB; in development or on any
// other host, the demo house through this page's server. `?server=` names
// another openHAB, read directly (CORS on there); `?token=` goes along, for a
// kiosk's link (one pasted in the panel stays in the browser instead); `?demo`
// opens the house as recorded.

const HERE = __OPENHAB_SAME_ORIGIN__;
const TARGET = HERE ? location.origin : __OPENHAB_TARGET__;
const shell = document.querySelector<HTMLElement>('.shell')!;
const canvas = document.querySelector<HTMLElement>('#canvas')!;
const loginSlot = document.querySelector<HTMLElement>('#login')!;
const query = new URLSearchParams(location.search);
const demo = new DemoSource();
const restSource = (server: string, token: string) =>
  server ? new RestSource(server, token) : HERE ? new RestSource('', token, location.origin) : new RestSource(PROXY, token, TARGET);
let source: HouseSource = query.has('demo') ? demo : restSource(query.get('server') ?? (HERE ? '' : lastServer()), query.get('token') ?? lastToken());

function status() {
  return `<span class="conn conn-${source.status}"><span class="conn-dot"></span>${esc(source.label)} · ${t.status[source.status]}
    <button class="plain" data-action="disconnect">${source === demo ? t.leaveDemo : t.disconnect}</button></span>`;
}

// `?systems=lights,climate&mode=orbit&start=climate&axis=groups` fixes what the page shows; the gear chooses within that.
const listParam = (name: string) => { const v = query.get(name)?.split(',').map((s) => s.trim()).filter(Boolean); return v?.length ? v : undefined; };
const modeParam = query.get('mode') as BoardMode | null;
const axisParam = query.get('axis');

const board = mountBoard(canvas, {
  host: hostOf(source),
  systems: listParam('systems'),
  mode: modeParam && BOARD_MODES.includes(modeParam) ? modeParam : undefined,
  axis: axisParam === 'groups' || axisParam === 'systems' ? axisParam : undefined,
  start: query.get('start') ?? undefined,
  settings: 'pulse-openhab-settings',
  status,
  strings: { connecting: t.connecting, things: t.things, hostError: t.hostError, noGroup: t.noRoom },
  onAction: (action) => { if (action === 'disconnect') disconnect(); },
  // Nothing answers yet: the connect panel covers the canvas; something does: the object.
  onStatus: (s) => {
    const out = s === 'signed-out' || (s === 'error' && !source.items.size);
    shell.classList.toggle('signed-out', out);
    loginSlot.hidden = !out;
    if (out) paintConnect();
  },
});

function use(src: HouseSource) {
  if (src !== source) { source.stop(); source = src; board.setHost(hostOf(src)); }
  src.start();
}
function disconnect() {
  const q = new URLSearchParams(location.search);
  q.delete('demo'); q.delete('server'); q.delete('token');
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  rememberToken('');
  source.stop();
  shell.classList.add('signed-out');
  loginSlot.hidden = false;
  paintConnect();
}

// The connect panel: which openHAB, or the demo house; beside the form, on a
// wide screen, the demo house as the object it would be.
let previewing = 0;
function paintConnect() {
  const url = source instanceof RestSource && source.direct ? source.base : HERE ? location.origin : lastServer();
  loginSlot.innerHTML = `<form class="login" novalidate>
    <div class="login-main">
      <h1>Pulse</h1>
      <p class="login-lead">${t.connectLead}</p>
      <label>${t.serverField}<input name="url" type="url" inputmode="url" autocomplete="url" value="${esc(url)}" placeholder="${esc(HERE ? location.origin : 'http://openhab.local:8080')}"></label>
      <p class="login-hint">${HERE ? t.serverHintHere : t.serverHintAway(TARGET.replace(/^https?:\/\//, ''))}</p>
      <label>${t.tokenField}<input name="token" type="password" autocomplete="off" spellcheck="false" value="${esc(lastToken())}"></label>
      <p class="login-hint">${t.tokenHint}</p>
      <button type="submit" class="primary">${t.connect}</button>
      ${source.status === 'error' && source.error ? `<p class="error">${esc(source.error)}</p>` : ''}
      <div class="login-demo">
        <p class="login-hint">${t.demoLead}</p>
        <div class="login-actions">
          <button type="button" class="plain" data-demo>${t.exploreDemo}</button>
          ${HERE ? '' : `<a class="login-link" href="../gallery.html">${t.browseHomes}</a>`}
        </div>
      </div>
      ${HERE ? '' : `<p class="login-hint login-other"><a class="login-link" href="../index.html">${t.otherPlatform}</a></p>`}
    </div>
    <aside class="login-side" data-preview aria-live="polite"></aside>
  </form>`;
  const side = loginSlot.querySelector<HTMLElement>('[data-preview]')!, turn = ++previewing;
  void previewHouse('data-home-system').then(({ tiles, items }) => {
    if (turn !== previewing || loginSlot.hidden || !side.isConnected) return;
    side.innerHTML = `<span class="tiles">${tiles.join('')}</span><p class="login-preview-foot">${esc(t.houseFoot(items, tiles.length))}</p>`;
  });
}
loginSlot.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(e.target as HTMLFormElement);
  const url = String(data.get('url') ?? '').trim().replace(/\/+$/, ''), token = String(data.get('token') ?? '');
  // The server this page came from is the default here: nothing to remember or to put in the address.
  // The token stays in the browser, never in the address.
  const away = HERE && url === location.origin ? '' : url;
  rememberServer(away);
  rememberToken(token);
  const q = new URLSearchParams(location.search);
  if (away) q.set('server', away); else q.delete('server');
  q.delete('token');
  q.delete('demo');
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  use(restSource(away, token));
});
loginSlot.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('[data-demo]')) return;
  const q = new URLSearchParams(location.search);
  q.set('demo', '1'); q.delete('server');
  history.replaceState(null, '', `${location.pathname}?${q}`);
  use(demo);
});

await board.ready;
use(source);

Object.assign(window, { pulseOpenHAB: { app: board.app, get source() { return source; }, demo, ui: board.ui, readings: board.readings } });
