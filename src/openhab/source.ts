// What the UI needs from an openHAB server, and the implementation over its
// REST API: every item with its semantics once, without its state (a thousand
// items are a few hundred kilobytes that way; with their states, each Image
// item inlines its picture, a camera's snapshot megabytes, and a big home is
// tens of megabytes at every load); then the states over openHAB's state
// stream (server-sent events, the one Main UI reads): all of them at once,
// then each change; an Image's picture only when it is looked at; a command
// POSTed to an item for what the home can be told; persistence for a day of a
// point. The object (@zumer/pulse) never sees this: `model.ts` turns the items
// into readings and `host.ts` wraps it as the board's host.

import type { Action, HistoryRow, Status } from '@zumer/pulse';
import { t } from './strings.ts';

// An item's semantics, as openHAB's own classes: 'Location_Indoor_Room_Kitchen',
// 'Equipment_HVAC', 'Point_Measurement' with the property it relates to and the
// equipment it is a point of (or the location an equipment is in).
export type Semantics = { value: string; config?: { relatesTo?: string; isPointOf?: string; hasLocation?: string; isPartOf?: string } };
export type Option = { value: string; label: string };
// An item as the model reads it. The state is text as openHAB gives it: 'ON',
// '21.2 °C', '257,91,0' (a color's hue, saturation, brightness), 'NULL'. An
// Image's is its picture (a data URI) once read; before that, 'NULL' or the
// stream's line about its bytes, which is not a picture.
export type Item = {
  name: string; type: string; label: string; state: string; unit?: string;
  tags: string[]; groups: string[]; semantics?: Semantics;
  options?: Option[];                 // the states it takes, with their words (a lock's locked and unlocked, a receiver's inputs)
  pattern?: string; readOnly?: boolean;
  changedAt?: number; updatedAt?: number;   // ms since the epoch
};
export type Items = Map<string, Item>;
// An action for the server: the core's Action (`ids`: the items it touches) and a command to an item
// (`POST /rest/items/<name>`, text/plain: ON, OFF, 42, UP, PLAY, '120,80,100'); or a way out to a page.
export type Command = Action & { kind: 'command'; item: string; command: string };
export type Act = Command | (Action & { kind: 'open'; url: string });

export interface HouseSource {
  readonly items: Items;
  readonly structure: number;       // grows when the set of items changes (the model's indexes follow it)
  readonly status: Status;
  readonly error: string;
  readonly label: string;           // where the data comes from, for the connection line
  readonly timezone?: string;       // the home's, as the server says it; times are told in it
  onChange(fn: (names: string[]) => void): () => void;
  onStatus(fn: () => void): () => void;
  onStructure(fn: () => void): () => void;   // the set of items changed (the board re-reads its systems and rooms)
  act(a: Act): Promise<unknown>;
  // Rows of (state, when) for the last `hours` hours of these items, where the server persists them.
  history(names: string[], hours: number): Promise<Record<string, HistoryRow[]>>;
  // The viewer is looking at this item: what the first load left out (an Image's picture) is read now.
  want?(name: string): void;
  start(): void;
  stop(): void;
}

// The REST API's item (`/rest/items?metadata=semantics`), the fields read. The state is among them only
// when asked for (the recorder asks; the app leaves it to the stream).
export type ItemDto = {
  name: string; type: string; label?: string; state?: string; unitSymbol?: string; tags?: string[]; groupNames?: string[];
  lastStateChange?: number; lastStateUpdate?: number;
  metadata?: { semantics?: Semantics };
  stateDescription?: { pattern?: string; readOnly?: boolean; options?: Option[] };
  commandDescription?: { commandOptions?: { command: string; label?: string }[] };
};
// The fields the app asks the list for, by name (`fields=`), so that the states stay out of it.
export const FIELDS = 'name,type,label,tags,groupNames,unitSymbol,metadata,stateDescription,commandDescription,lastStateChange,lastStateUpdate';
export function itemOf(d: ItemDto): Item {
  const options = d.stateDescription?.options?.length ? d.stateDescription.options
    : d.commandDescription?.commandOptions?.map((o) => ({ value: o.command, label: o.label ?? o.command }));
  return {
    name: d.name, type: d.type, label: d.label ?? '', state: d.state ?? 'NULL', unit: d.unitSymbol || undefined, tags: d.tags ?? [], groups: d.groupNames ?? [],
    semantics: d.metadata?.semantics, options: options?.length ? options : undefined, pattern: d.stateDescription?.pattern, readOnly: d.stateDescription?.readOnly,
    changedAt: d.lastStateChange, updatedAt: d.lastStateUpdate,
  };
}

// The number in a state ('21.2 °C' → 21.2; 'ON', 'NULL' → null).
export const numOf = (state: string): number | null => { const m = /^-?\d+(\.\d+)?(e[-+]?\d+)?/i.exec(state.trim()); return m ? Number(m[0]) : null; };
// A color's hue, saturation and brightness ('257,91,0').
export const hsbOf = (state: string): [number, number, number] | null => {
  const parts = state.split(',').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? [parts[0], parts[1], parts[2]] : null;
};
// A location's latitude and longitude ('52.32,13.30' or '52.32,13.30,35').
export const geoOf = (state: string): { lat: number; lon: number } | null => {
  const parts = state.split(',').map(Number);
  return parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) ? { lat: parts[0], lon: parts[1] } : null;
};
// A moment as openHAB writes it: '2026-11-07T21:22:45.118418636+01:00[Europe/Berlin]', '2026-11-07T16:24:29.510+0100'.
export const whenOf = (s?: string): number | undefined => {
  if (!s) return undefined;
  const ms = Date.parse(s.replace(/\[.*$/, '').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
  return Number.isNaN(ms) ? undefined : ms;
};

const SERVER = 'pulse-openhab-server', TOKEN = 'pulse-openhab-token';
const kept = (key: string) => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };
const keep = (key: string, value: string) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* only to remember */ } };
// The dev server's way to the demo house (or to OPENHAB_URL): see vite.config.ts.
export const PROXY = '/oh';
export const lastServer = () => kept(SERVER);
export const rememberServer = (url: string) => keep(SERVER, url);
// The token pasted in the panel stays in this browser, so that it is not asked again, and never in the address; disconnecting forgets it.
export const lastToken = () => kept(TOKEN);
export const rememberToken = (token: string) => keep(TOKEN, token);

// A state as the stream tells it (`/rest/events/states`): the state, and openHAB's own words for it
// (not read: the model has the item's pattern). An Image's is a line about its bytes, never the picture.
type Tracked = { state?: string; displayState?: string };

// The server over its REST API: every item once, then the stream of their
// states; a lost stream is opened again, later each time. The changes of a
// moment are told together, so the board paints once for them.
export class RestSource implements HouseSource {
  readonly items: Items = new Map();
  structure = 0;
  status: Status = 'signed-out';
  error = '';
  version = '';
  timezone = '';
  private abort: AbortController | null = null;
  private retry = 0;
  private timer = 0;
  private flushTimer = 0;
  private changed = new Set<string>();
  private stopped = true;
  private snapshot = false;          // the stream's first block, every tracked state at once, has come
  // The Images read because they were looked at: being read, as read, or changed since (the stream said so).
  private pictures = new Map<string, 'loading' | 'fresh' | 'stale'>();
  private listeners = new Set<(names: string[]) => void>();
  private statusListeners = new Set<() => void>();
  private structureListeners = new Set<() => void>();

  readonly base: string;         // where the requests go: an address, this page's proxy, or '' for the origin the page came from
  readonly via: string;          // the server behind the base when the base is not its address (the proxy, the same origin)
  private token: string;
  constructor(base: string, token = '', via = '') { this.base = base.replace(/\/+$/, ''); this.token = token; this.via = via; }

  // Read directly at an address, or through this page's server.
  get direct() { return !this.via; }
  get shown() { return this.via || this.base; }
  get label() { return `${this.shown.replace(/^https?:\/\//, '')}${this.version ? ` · openHAB ${this.version}` : ''}`; }
  onChange(fn: (names: string[]) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onStatus(fn: () => void) { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn); }
  onStructure(fn: () => void) { this.structureListeners.add(fn); return () => this.structureListeners.delete(fn); }
  private setStatus(status: Status, error = '') {
    if (status === this.status && error === this.error) return;
    this.status = status;
    this.error = error;
    this.statusListeners.forEach((fn) => fn());
  }
  private headers(): Record<string, string> { return this.token ? { Authorization: `Bearer ${this.token}` } : {}; }

  start() {
    this.stop();
    this.stopped = false;
    this.setStatus('connecting');
    void this.open();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.flushTimer);
    this.abort?.abort();
    this.abort = null;
  }

  // The root names the version; the items fill the house, without their states; the stream brings those.
  private async open() {
    try {
      const [root, list] = await Promise.all([
        fetch(`${this.base}/rest/`, { headers: { Accept: 'application/json', ...this.headers() }, signal: AbortSignal.timeout(15_000) }),
        fetch(`${this.base}/rest/items?metadata=semantics&recursive=false&fields=${FIELDS}`, { headers: { Accept: 'application/json', ...this.headers() }, signal: AbortSignal.timeout(20_000) }),
      ]);
      if (list.status === 401 || list.status === 403) { this.setStatus('error', t.errUnauthorized); return; }
      if (!list.ok) throw new Error(`${list.status}`);
      if (root.ok) { const info = (await root.json()) as { timezone?: string; runtimeInfo?: { version?: string } }; this.version = info.runtimeInfo?.version ?? ''; this.timezone = info.timezone ?? ''; }
      const dtos = (await list.json()) as ItemDto[];
      const names = new Set(dtos.map((d) => d.name));
      for (const name of [...this.items.keys()]) if (!names.has(name)) { this.items.delete(name); this.pictures.delete(name); }
      // An item read before keeps its state until the stream tells the current one: nothing goes blank on a reconnect.
      for (const d of dtos) { const was = this.items.get(d.name), fresh = itemOf(d); this.items.set(d.name, { ...fresh, state: d.state ?? was?.state ?? fresh.state }); }
      // A picture may have changed while the stream was down: read again when looked at.
      for (const [name, st] of this.pictures) if (st === 'fresh') this.pictures.set(name, 'stale');
    } catch (error) {
      if (this.stopped) return;
      if (!this.items.size) { this.setStatus('error', t.errNoServer(this.shown, error instanceof Error ? error.message : String(error))); this.later(); return; }
    }
    if (this.stopped) return;
    void this.listen();
  }

  // The stream of states, read as it comes (fetch, so a token can go along,
  // which EventSource cannot send): each event a block of lines. openHAB names
  // the connection first; the items to follow are posted to it by name; their
  // states come at once, then each one that changes, and a heartbeat.
  private async listen() {
    const ctl = new AbortController();
    this.abort?.abort();
    this.abort = ctl;
    this.snapshot = false;
    try {
      const res = await fetch(`${this.base}/rest/events/states`, { headers: { Accept: 'text/event-stream', ...this.headers() }, signal: ctl.signal });
      if (!res.ok || !res.body) throw new Error(`${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let at: number;
        while ((at = buffer.indexOf('\n\n')) >= 0) { this.event(buffer.slice(0, at), ctl); buffer = buffer.slice(at + 2); }
      }
    } catch { /* closed or failed: below */ }
    if (this.abort !== ctl || this.stopped) return;
    this.setStatus('offline');
    this.later();
  }
  private later() {
    clearTimeout(this.timer);
    const wait = Math.min(30_000, 2000 * 2 ** this.retry++);
    this.timer = window.setTimeout(() => { if (!this.stopped) void this.open(); }, wait);
  }

  // One event: the connection's name (`ready`), a block of states (unnamed), or the heartbeat (`alive`).
  private event(block: string, ctl: AbortController) {
    let name = '', data = '';
    for (const raw of block.split('\n')) {
      const line = raw.trimEnd();
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim();
    }
    if (name === 'ready') { void this.track(data, ctl); return; }
    if (name || !data) return;
    try { this.arrive(JSON.parse(data) as Record<string, Tracked>); } catch { /* not states */ }
  }

  // Which items the stream follows: every one (an Image too: the line about its bytes says when the
  // picture changed). Refused, there is no stream: it is opened again, later.
  private async track(id: string, ctl: AbortController) {
    const names = [...this.items.keys()];
    try {
      const res = await fetch(`${this.base}/rest/events/states/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...this.headers() }, body: JSON.stringify(names), signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      if (!names.length) this.arrive({});
    } catch { if (this.abort === ctl) ctl.abort(); }
  }

  // States from the stream. The first block is every tracked item at once: the
  // house is complete then (live, and the board reads it); the times of the
  // last change came with the list. Each later block is what changed, told
  // together a moment later. An Image read before keeps its picture and is
  // marked changed, to be read again when looked at.
  private arrive(states: Record<string, Tracked>) {
    const first = !this.snapshot, now = Date.now();
    this.snapshot = true;
    for (const [name, s] of Object.entries(states)) {
      const was = this.items.get(name);
      if (!was || s.state == null || s.state === was.state) continue;
      if (was.type === 'Image' && this.pictures.has(name)) this.pictures.set(name, 'stale');
      else this.items.set(name, first ? { ...was, state: s.state } : { ...was, state: s.state, changedAt: now, updatedAt: now });
      if (!first) this.changed.add(name);
    }
    if (!first) { this.flush(); return; }
    this.retry = 0;
    this.structure++;
    this.setStatus('live');
    this.structureListeners.forEach((fn) => fn());
    this.listeners.forEach((fn) => fn([...this.items.keys()]));
  }
  private flush() {
    if (this.flushTimer || !this.changed.size) return;
    this.flushTimer = window.setTimeout(() => { this.flushTimer = 0; const names = [...this.changed]; this.changed.clear(); this.listeners.forEach((fn) => fn(names)); }, 300);
  }

  // The viewer is looking at this item. An Image's state is its picture, left out of the list and of
  // the stream: it is read now, once, and again after the stream says it changed. Not read, it is
  // asked for again a while later.
  want(name: string) {
    const i = this.items.get(name), had = this.pictures.get(name);
    if (!i || i.type !== 'Image' || had === 'loading' || had === 'fresh' || this.stopped) return;
    this.pictures.set(name, 'loading');
    void this.picture(name);
  }
  private async picture(name: string) {
    try {
      const res = await fetch(`${this.base}/rest/items/${encodeURIComponent(name)}/state`, { headers: { Accept: 'text/plain', ...this.headers() }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`${res.status}`);
      const state = (await res.text()).trim(), was = this.items.get(name);
      if (!was) return;
      this.pictures.set(name, 'fresh');
      if (state === was.state) return;
      this.items.set(name, { ...was, state });
      this.changed.add(name);
      this.flush();
    } catch {
      window.setTimeout(() => { if (this.pictures.get(name) === 'loading') this.pictures.delete(name); }, 10_000);
    }
  }

  // A command to an item, answered by whatever binding owns it (the state comes back on the stream).
  async act(a: Act) {
    if (a.kind === 'open') { window.open(a.url, '_blank', 'noopener'); return; }
    const res = await fetch(`${this.base}/rest/items/${encodeURIComponent(a.item)}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', ...this.headers() }, body: a.command,
    });
    if (!res.ok) throw new Error(res.status === 400 ? `${a.item} does not take ${a.command}` : res.status === 404 ? `${a.item} is not an item` : `${res.status} ${res.statusText}`.trim());
  }

  // A day of an item from the persistence service (rrd4j by default keeps the
  // numbers, and the switches as 0 and 1 turned back into ON and OFF).
  async history(names: string[], hours: number) {
    const start = new Date(Date.now() - hours * 3_600_000).toISOString();
    const out: Record<string, HistoryRow[]> = {};
    await Promise.all(names.map(async (name) => {
      out[name] = [];
      try {
        const res = await fetch(`${this.base}/rest/persistence/items/${encodeURIComponent(name)}?starttime=${start}`, { headers: { Accept: 'application/json', ...this.headers() }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: { time: number; state: string }[] };
        out[name] = (body.data ?? []).map((d) => ({ s: d.state, lu: d.time / 1000 }));
      } catch { /* nothing kept for it */ }
    }));
    return out;
  }
}
