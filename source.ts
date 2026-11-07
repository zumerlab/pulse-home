// What the UI needs from Home Assistant, and the WebSocket implementation of
// it. The object (@zumer/pulse) never sees this: `model.ts` turns a source's
// states into readings. A second implementation over the `hass` object a
// custom card receives would let the same app run inside a dashboard.

import {
  Auth, ERR_CANNOT_CONNECT, ERR_HASS_HOST_REQUIRED, ERR_INVALID_AUTH, ERR_INVALID_AUTH_CALLBACK,
  ERR_INVALID_HTTPS_TO_HTTP, callService, createConnection, createLongLivedTokenAuth, getAuth,
  subscribeConfig, subscribeEntities, type AuthData, type Connection, type HassEntity,
} from 'home-assistant-js-websocket';
import { changesOf, hourly, type HistoryRow, type StateChange, type CodeFormat } from '@zumer/pulse';
import { t } from './strings.ts';

export type HassState = HassEntity;
export type States = Map<string, HassState>;
// A service call: the core's Action (`ids`: the entities it touches) plus what Home Assistant needs.
// `asks`/`code`: the core's (an action that waits for a code on the keypad, and the code once entered).
export type Call = { ids: string[]; domain: string; service: string; data: Record<string, unknown>; asks?: CodeFormat; code?: string };
// signed-out: no credentials; the login is shown. The rest follow the socket.
export type Status = 'signed-out' | 'connecting' | 'live' | 'offline' | 'error';

// What Home Assistant knows about the home besides states: where each entity
// is (areas, floors, devices), which ones are hidden or diagnostic, and the
// repairs it raised. The model reads it next to the states.
export type RegistryEntity = {
  entity_id: string; name?: string; area_id?: string; device_id?: string; platform?: string;
  hidden?: boolean; category?: 'config' | 'diagnostic';
};
export type RegistryArea = { area_id: string; name: string; floor_id?: string | null; icon?: string | null };
export type RegistryDevice = { id: string; name: string; area_id?: string | null };
export type RegistryFloor = { floor_id: string; name: string; level?: number | null };
export type Issue = {
  issue_id: string; domain: string; severity: 'critical' | 'error' | 'warning' | null;
  is_fixable: boolean | null; translation_key?: string | null; learn_more_url?: string | null; created: string; ignored: boolean;
};
// A notice Home Assistant raised for whoever is signed in (the bell at the top
// of its own pages): a failed login, a message from an integration.
export type Notice = { id: string; title?: string; message: string; at: number };
export type Registry = {
  areas: Map<string, RegistryArea>;
  devices: Map<string, RegistryDevice>;
  entities: Map<string, RegistryEntity>;
  floors: Map<string, RegistryFloor>;
  issues: Issue[];
  notices: Notice[];
};
export const emptyRegistry = (): Registry => ({ areas: new Map(), devices: new Map(), entities: new Map(), floors: new Map(), issues: [], notices: [] });

// What the home said back when asked (Assist): the words sent, its answer,
// whether it did something, answered a question or did not understand, the
// entities it touched, and when.
export type Answer = { text: string; speech: string; kind: 'done' | 'answer' | 'error'; targets: string[]; at: number };
// The thing an answer is about, for the board: it beats while the home thinks.
export const ASSIST = 'assist';
export const KEPT_ANSWERS = 12;
// A service call that is a question to the home (Assist) rather than a service.
export const isAsk = (c: Call) => c.domain === 'conversation' && c.service === 'process';

export interface PulseSource {
  readonly states: States;
  readonly registry: Registry;
  readonly status: Status;
  readonly error: string;        // why, when status is 'error'
  readonly version: string;      // Home Assistant's version
  readonly unit: string;         // temperature unit of the installation
  // The user's language as Home Assistant knows it (a BCP 47 tag); the object
  // formats numbers and times with it. Nothing known: English.
  readonly language?: string;
  // A state in the user's words, as Home Assistant's own frontend shows it
  // ("Heat", "Armed away"); nothing: the app's English words.
  stateText?(e: HassState): string | undefined;
  onChange(fn: (changed: HassState[]) => void): () => void;
  onRegistry(fn: () => void): () => void;
  onStatus(fn: () => void): () => void;
  call(c: Call): Promise<unknown>;
  // Resolves an entity's relative URL (a camera image) against the source.
  url(path: string): string;
  // A camera's live MJPEG stream, when the source can serve one.
  stream?(entity: string): string | undefined;
  // A numeric entity's last `hours` hours as one value per hour, oldest
  // first, the current hour last; null where nothing is known.
  history?(entity: string, hours: number): Promise<(number | null)[]>;
  // The last `hours` hours of these entities as the moments their state
  // changed (see StateChange), one list per entity.
  changes?(entities: string[], hours: number): Promise<Record<string, StateChange[]>>;
  // A total-increasing entity (energy, kWh) as one value per day of this
  // month, the first day first, up to today; null where nothing is known.
  // With `days`, the last `days` days instead, the oldest first, today last.
  statistics?(entity: string, days?: number): Promise<(number | null)[]>;
  // The home's conversation agent (Assist), when the source reaches one: the
  // words go in (`call` with a `conversation.process` call does the same), the
  // answer comes back and stays in `assist`, the latest first; `onMessage`
  // tells when the answers changed, naming what did (ASSIST).
  readonly assist?: Answer[];
  ask?(text: string, language?: string): Promise<Answer>;
  onMessage?(fn: (ids: string[]) => void): () => void;
}

// `conversation/process` answers with the agent's words and what it did.
export type ConversationResult = { response: { response_type: string; speech?: { plain?: { speech?: string } }; data?: { success?: { id?: string }[] } } };
export const answerOf = (text: string, r: ConversationResult): Answer => ({
  text, speech: r.response.speech?.plain?.speech ?? '', at: Date.now(),
  kind: r.response.response_type === 'action_done' ? 'done' : r.response.response_type === 'query_answer' ? 'answer' : 'error',
  targets: (r.response.data?.success ?? []).map((x) => x.id).filter((x): x is string => !!x),
});
// `persistent_notification/subscribe` sends the notices there are, then each one added, updated or removed.
export type NoticeEvent = { type: 'current' | 'added' | 'updated' | 'removed'; notifications: Record<string, { notification_id: string; title?: string | null; message: string; created_at: string }> };
export function noticesAfter(list: Notice[], ev: NoticeEvent): Notice[] {
  const rows: Notice[] = Object.values(ev.notifications).map((n) => ({ id: n.notification_id, title: n.title ?? undefined, message: n.message, at: Date.parse(n.created_at) || Date.now() }));
  if (ev.type === 'current') return rows;
  const ids = new Set(rows.map((n) => n.id));
  const rest = list.filter((n) => !ids.has(n.id));
  return ev.type === 'removed' ? rest : [...rest, ...rows];
}

// What `recorder/statistics_during_period` returns per entity with period
// 'day': one row per day, `start` in ms and the day's `change`.
export type StatRow = { start: number; change?: number | null };
// The days of this month from the recorder's rows: a value where a day has one.
export function dailyOf(rows: StatRow[], now = new Date()): (number | null)[] {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const out: (number | null)[] = Array.from({ length: days }, () => null);
  for (const r of rows) {
    const d = new Date(r.start);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && r.change != null) out[d.getDate() - 1] = Math.round(r.change * 100) / 100;
  }
  return out;
}
export const monthStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);
// The last `days` days, the oldest first and today last: a value where a day has one.
export function dailyBack(rows: StatRow[], days: number, now = new Date()): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: days }, () => null);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const r of rows) {
    const d = new Date(r.start), day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const ago = Math.round((today - day) / 86_400_000);
    if (ago >= 0 && ago < days && r.change != null) out[days - 1 - ago] = Math.round(r.change * 100) / 100;
  }
  return out;
}
export const daysBack = (days: number, now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);

// `history/history_during_period` with minimal_response and no_attributes
// returns, per entity, the state and when it was last updated (seconds): the
// core's HistoryRow, which it turns into hourly means and state changes.
export const cameraStream = (e: HassState | undefined) =>
  e && e.attributes.access_token ? `/api/camera_proxy_stream/${e.entity_id}?token=${String(e.attributes.access_token)}` : undefined;

// The lists Home Assistant serves over the WebSocket, as the registry. None of
// them needs an admin user. `repairs/list_issues` fails when the repairs
// integration is not loaded (a minimal setup): no issues then.
type AreaRow = { area_id: string; name: string; floor_id: string | null; icon: string | null };
type DeviceRow = { id: string; name: string | null; name_by_user: string | null; area_id: string | null };
type EntityRow = {
  entity_id: string; name: string | null; area_id: string | null; device_id: string | null; platform: string;
  hidden_by: string | null; entity_category: 'config' | 'diagnostic' | null;
};
type FloorRow = { floor_id: string; name: string; level: number | null };
export async function fetchRegistry(conn: Connection): Promise<Registry> {
  const [areas, devices, entities, floors, issues] = await Promise.all([
    conn.sendMessagePromise<AreaRow[]>({ type: 'config/area_registry/list' }),
    conn.sendMessagePromise<DeviceRow[]>({ type: 'config/device_registry/list' }),
    conn.sendMessagePromise<EntityRow[]>({ type: 'config/entity_registry/list' }),
    conn.sendMessagePromise<FloorRow[]>({ type: 'config/floor_registry/list' }).catch(() => [] as FloorRow[]),
    conn.sendMessagePromise<{ issues: Issue[] }>({ type: 'repairs/list_issues' }).then((r) => r.issues, () => [] as Issue[]),
  ]);
  return {
    areas: new Map(areas.map((a) => [a.area_id, a])),
    devices: new Map(devices.map((d) => [d.id, { id: d.id, name: d.name_by_user ?? d.name ?? d.id, area_id: d.area_id }])),
    entities: new Map(entities.map((e) => [e.entity_id, {
      entity_id: e.entity_id, name: e.name ?? undefined, area_id: e.area_id ?? undefined, device_id: e.device_id ?? undefined,
      platform: e.platform, hidden: e.hidden_by != null || undefined, category: e.entity_category ?? undefined,
    }])),
    floors: new Map(floors.map((f) => [f.floor_id, f])),
    issues,
    notices: [],
  };
}
// The events that mean a list changed.
export const REGISTRY_EVENTS = ['area_registry_updated', 'device_registry_updated', 'entity_registry_updated', 'floor_registry_updated', 'repairs_issue_registry_updated'];

const TOKENS = 'pulse-ha-auth';
const LAST_URL = 'pulse-ha-url';

const loadTokens = async (): Promise<AuthData | null> => {
  try { return JSON.parse(localStorage.getItem(TOKENS) ?? 'null') as AuthData | null; } catch { return null; }
};
const saveTokens = (data: AuthData | null) => {
  try {
    if (data) localStorage.setItem(TOKENS, JSON.stringify(data));
    else localStorage.removeItem(TOKENS);
  } catch { /* no storage: the session lasts while the page does */ }
};

export const lastUrl = () => {
  try { return localStorage.getItem(LAST_URL) ?? ''; } catch { return ''; }
};
const trimUrl = (u: string) => u.trim().replace(/\/+$/, '');

function reason(error: unknown) {
  switch (error) {
    case ERR_CANNOT_CONNECT: return t.errCannotConnect;
    case ERR_INVALID_AUTH: return t.errInvalidAuth;
    case ERR_HASS_HOST_REQUIRED: return t.errHostRequired;
    case ERR_INVALID_HTTPS_TO_HTTP: return t.errHttpsToHttp;
    case ERR_INVALID_AUTH_CALLBACK: return t.errAuthCallback;
    default:
      if (error instanceof Error) return error.message;
      // A refused service call comes back as the socket's own result ({ code, message }).
      if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
      return String(error);
  }
}

// Home Assistant over its WebSocket, signed in with its own OAuth flow (the
// user signs in on Home Assistant's page and comes back with a code) or with
// a long-lived access token. Tokens stay in the browser; no server in between.
export class WebSocketSource implements PulseSource {
  readonly states: States = new Map();
  registry: Registry = emptyRegistry();
  status: Status = 'connecting';
  error = '';
  version = '';
  unit = '°';
  language?: string;
  assist: Answer[] = [];
  private notices: Notice[] = [];
  private auth: Auth | null = null;
  private conn: Connection | null = null;
  private listeners = new Set<(changed: HassState[]) => void>();
  private registryListeners = new Set<() => void>();
  private statusListeners = new Set<() => void>();
  private messageListeners = new Set<(ids: string[]) => void>();
  private registryTimer = 0;

  onChange(fn: (changed: HassState[]) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onRegistry(fn: () => void) { this.registryListeners.add(fn); return () => this.registryListeners.delete(fn); }
  onStatus(fn: () => void) { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn); }
  onMessage(fn: (ids: string[]) => void) { this.messageListeners.add(fn); return () => this.messageListeners.delete(fn); }
  url(path: string) { return /^https?:/.test(path) ? path : `${this.auth?.data.hassUrl ?? ''}${path}`; }
  get hassUrl() { return this.auth?.data.hassUrl ?? ''; }

  private setStatus(status: Status, error = '') {
    this.status = status;
    this.error = error;
    this.statusListeners.forEach((fn) => fn());
  }

  // Saved tokens, or the code Home Assistant sent us back with. Without
  // either, the login is shown.
  async resume() {
    this.setStatus('connecting');
    try {
      this.auth = await getAuth({ loadTokens, saveTokens });
    } catch (error) {
      if (error === ERR_HASS_HOST_REQUIRED) { this.setStatus('signed-out'); return; }
      this.setStatus('signed-out', reason(error));
      return;
    }
    if (location.search.includes('auth_callback=1')) history.replaceState(null, '', location.pathname);
    await this.open();
  }

  // Sends the browser to Home Assistant's login page; it comes back to this URL.
  async signIn(hassUrl: string) {
    hassUrl = trimUrl(hassUrl);
    try { localStorage.setItem(LAST_URL, hassUrl); } catch { /* only to remember */ }
    this.setStatus('connecting');
    try {
      await getAuth({ hassUrl, loadTokens: async () => null, saveTokens });
    } catch (error) {
      this.setStatus('signed-out', reason(error));
    }
  }

  async signInWithToken(hassUrl: string, token: string) {
    hassUrl = trimUrl(hassUrl);
    try { localStorage.setItem(LAST_URL, hassUrl); } catch { /* only to remember */ }
    this.auth = createLongLivedTokenAuth(hassUrl, token.trim());
    saveTokens(this.auth.data);
    await this.open();
  }

  async signOut() {
    const auth = this.auth;
    this.conn?.close();
    this.conn = null;
    this.auth = null;
    this.states.clear();
    this.registry = emptyRegistry();
    this.assist = [];
    this.notices = [];
    saveTokens(null);
    if (auth?.data.refresh_token) { try { await auth.revoke(); } catch { /* already gone */ } }
    this.setStatus('signed-out');
  }

  private async open() {
    if (!this.auth) return;
    this.setStatus('connecting');
    let conn: Connection;
    try {
      conn = await createConnection({ auth: this.auth });
    } catch (error) {
      if (error === ERR_INVALID_AUTH) { saveTokens(null); this.auth = null; this.setStatus('signed-out', t.errInvalidAuth); return; }
      this.setStatus('error', reason(error));
      return;
    }
    this.conn = conn;
    this.version = conn.haVersion;
    conn.addEventListener('ready', () => { this.version = conn.haVersion; this.setStatus('live'); });
    conn.addEventListener('disconnected', () => this.setStatus('offline'));
    conn.addEventListener('reconnect-error', (_c, error) => {
      if (error === ERR_INVALID_AUTH) void this.signOut();
      else this.setStatus('error', reason(error));
    });
    subscribeConfig(conn, (config) => {
      this.unit = config.unit_system?.temperature ?? '°';
      // The server's language, until the user's own (their profile) is known.
      if (!this.language && config.language) { this.language = config.language; this.statusListeners.forEach((fn) => fn()); }
    });
    conn.sendMessagePromise<{ value: { language?: string } | null }>({ type: 'frontend/get_user_data', key: 'language' })
      .then((data) => { if (this.conn === conn && data?.value?.language) { this.language = data.value.language; this.statusListeners.forEach((fn) => fn()); } }, () => { /* no profile data: the server's language */ });
    // The registries once, and again (a moment after) whenever one changes.
    const loadRegistry = () => fetchRegistry(conn).then((registry) => {
      if (this.conn !== conn) return;
      this.registry = { ...registry, notices: this.notices };
      this.registryListeners.forEach((fn) => fn());
    }, () => { /* no registries: the model works from the states alone */ });
    void loadRegistry();
    // The notices under Home Assistant's bell, and every change to them.
    void conn.subscribeMessage<NoticeEvent>((ev) => {
      if (this.conn !== conn) return;
      this.notices = noticesAfter(this.notices, ev);
      this.registry = { ...this.registry, notices: this.notices };
      this.registryListeners.forEach((fn) => fn());
    }, { type: 'persistent_notification/subscribe' }).catch(() => { /* no notices on this installation */ });
    for (const event of REGISTRY_EVENTS) {
      void conn.subscribeEvents(() => {
        clearTimeout(this.registryTimer);
        this.registryTimer = window.setTimeout(loadRegistry, 500);
      }, event).catch(() => { /* not available: the first load stands */ });
    }
    // One subscription gives the initial states and compressed diffs after.
    let first = true;
    subscribeEntities(conn, (entities) => {
      const changed: HassState[] = [];
      for (const [id, e] of Object.entries(entities)) {
        if (this.states.get(id) !== e) { this.states.set(id, e); changed.push(e); }
      }
      for (const id of [...this.states.keys()]) if (!(id in entities)) this.states.delete(id);
      if (first) { first = false; this.setStatus('live'); }
      this.listeners.forEach((fn) => fn(changed));
    });
  }

  call(c: Call) {
    if (!this.conn) return Promise.reject(new Error(t.errNoConnection));
    if (isAsk(c)) return this.ask(String(c.data.text ?? ''), c.data.language as string | undefined);
    const { entity_id, ...rest } = c.data;
    return callService(this.conn, c.domain, c.service, rest, entity_id ? { entity_id: entity_id as string | string[] } : undefined)
      .catch((error: unknown) => { throw new Error(reason(error)); });
  }

  // A question or an order to the home, in the user's language: Assist's
  // agent answers in its words (the built-in one, or whatever the user set up).
  async ask(text: string, language = this.language) {
    if (!this.conn) throw new Error(t.errNoConnection);
    const r = await this.conn.sendMessagePromise<ConversationResult>({ type: 'conversation/process', text, ...(language ? { language } : {}) })
      .catch((error: unknown) => { throw new Error(reason(error)); });
    const a = answerOf(text, r);
    this.assist = [a, ...this.assist].slice(0, KEPT_ANSWERS);
    this.messageListeners.forEach((fn) => fn([ASSIST]));
    return a;
  }

  stream(entity: string) {
    const path = cameraStream(this.states.get(entity));
    return path ? this.url(path) : undefined;
  }

  async history(entity: string, hours: number) {
    if (!this.conn) throw new Error(t.errNoConnection);
    const now = Date.now();
    const rows = await this.conn.sendMessagePromise<Record<string, HistoryRow[]>>({
      type: 'history/history_during_period', entity_ids: [entity], minimal_response: true, no_attributes: true,
      start_time: new Date(now - hours * 3600_000).toISOString(), end_time: new Date(now).toISOString(),
    });
    return hourly(rows[entity] ?? [], hours, now);
  }

  async changes(entities: string[], hours: number) {
    if (!this.conn) throw new Error(t.errNoConnection);
    const now = Date.now();
    const rows = await this.conn.sendMessagePromise<Record<string, HistoryRow[]>>({
      type: 'history/history_during_period', entity_ids: entities, minimal_response: true, no_attributes: true,
      start_time: new Date(now - hours * 3600_000).toISOString(), end_time: new Date(now).toISOString(),
    });
    return Object.fromEntries(entities.map((e) => [e, changesOf(rows[e] ?? [], hours, now)]));
  }

  async statistics(entity: string, days?: number) {
    if (!this.conn) throw new Error(t.errNoConnection);
    const rows = await this.conn.sendMessagePromise<Record<string, StatRow[]>>({
      type: 'recorder/statistics_during_period', statistic_ids: [entity], period: 'day', types: ['change'],
      start_time: (days ? daysBack(days) : monthStart()).toISOString(), end_time: new Date().toISOString(),
    });
    return days ? dailyBack(rows[entity] ?? [], days) : dailyOf(rows[entity] ?? []);
  }
}
