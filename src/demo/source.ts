// A PulseSource with no Home Assistant behind it: the homes of
// demo.home-assistant.io, with entities that answer service calls the way the
// frontend's demo does. Same object, same model, same data path as the
// WebSocket: `states` in, `call` out.

import type { HassEntity } from 'home-assistant-js-websocket';
import type { StateChange } from '@zumer/pulse';
import { ASSIST, KEPT_ANSWERS, emptyRegistry, isAsk, type Answer, type Call, type HassState, type Notice, type PulseSource, type Registry, type States, type Status } from '../source.ts';
import { t } from '../strings.ts';
import { getEntity, type Area, type Floor, type MockEntity } from './entities.ts';
import { energy } from './homes/energy.ts';
import { DEFAULT_HOME, homeById, type Home } from './homes/index.ts';

// The same numbers every time for the same entity: a hash of its id seeds them.
function seeded(key: string) {
  let seed = 0;
  for (const c of key) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
// What a state flips to in a made-up history.
const OTHER_STATE: Record<string, string> = {
  on: 'off', off: 'on', open: 'closed', closed: 'open', locked: 'unlocked', unlocked: 'locked',
  playing: 'paused', paused: 'playing', idle: 'playing', heat: 'off', cool: 'off', heat_cool: 'off', auto: 'off', dry: 'off', fan_only: 'off',
};

// A command takes a moment to come back, as it would from a real Home
// Assistant: the UI shows "sending" meanwhile.
const ROUND_TRIP_MS = 120;

// The sun's `next_*` moments, each moved to the next time it comes round
// (today at that time of day, or tomorrow if that has passed).
function freshSun(attributes: Record<string, unknown>) {
  const out = { ...attributes }, now = Date.now();
  for (const [k, v] of Object.entries(attributes)) {
    if (!k.startsWith('next_') || typeof v !== 'string') continue;
    const was = new Date(v);
    if (Number.isNaN(was.getTime())) continue;
    const next = new Date(now);
    next.setUTCHours(was.getUTCHours(), was.getUTCMinutes(), was.getUTCSeconds(), 0);
    if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
    out[k] = next.toISOString();
  }
  return out;
}

export class DemoSource implements PulseSource {
  readonly states: States = new Map();
  registry: Registry = emptyRegistry();
  status: Status = 'signed-out';
  error = '';
  version = '';
  unit = '°C';
  language = 'en-US';
  home: Home | null = null;
  areas: Area[] = [];
  floors: Floor[] = [];
  assist: Answer[] = [];
  private notices: Notice[] = [];
  private entities = new Map<string, MockEntity>();
  private changed = new Map<string, HassState>();
  private flushing = false;
  private listeners = new Set<(changed: HassState[]) => void>();
  private registryListeners = new Set<() => void>();
  private statusListeners = new Set<() => void>();
  private messageListeners = new Set<(ids: string[]) => void>();

  onChange(fn: (changed: HassState[]) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onRegistry(fn: () => void) { this.registryListeners.add(fn); return () => this.registryListeners.delete(fn); }
  onStatus(fn: () => void) { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn); }
  onMessage(fn: (ids: string[]) => void) { this.messageListeners.add(fn); return () => this.messageListeners.delete(fn); }
  // The demos' pictures (cameras, people) are served by demo.home-assistant.io.
  url(path: string) { return /^https?:/.test(path) ? path : `https://demo.home-assistant.io${path}`; }

  private setStatus(status: Status) {
    this.status = status;
    this.statusListeners.forEach((fn) => fn());
  }

  async start(id = DEFAULT_HOME) {
    this.stop(false);
    const home = homeById(id) ?? homeById(DEFAULT_HOME)!;
    this.home = home;
    this.setStatus('connecting');
    const data = await home.load();
    if (this.home !== home) return;      // another start() won meanwhile
    this.areas = data.areas ?? [];
    this.floors = data.floors ?? [];
    const sink = { updateState: (s: HassEntity) => this.queue(s) };
    // The home's own entities win over the shared energy sensors.
    const registry = emptyRegistry();
    for (const input of [...energy, ...data.entities]) {
      const e = getEntity(input);
      e.sink = sink;
      this.entities.get(e.entityId)?.dispose();
      this.entities.set(e.entityId, e);
      this.states.set(e.entityId, e.toState());
      registry.entities.set(e.entityId, { entity_id: e.entityId, area_id: input.area_id, device_id: input.device_id, platform: input.platform });
    }
    // The sun was recorded on a day in 2024: its next rising and setting are
    // moved to the next time of day they name, so it reads as today's.
    const sun = this.states.get('sun.sun');
    if (sun) this.states.set('sun.sun', { ...sun, attributes: freshSun(sun.attributes) });
    // What the demo config says about the home: areas and floors (only `home` has them).
    for (const a of this.areas) registry.areas.set(a.area_id, a);
    for (const f of this.floors) registry.floors.set(f.floor_id, f);
    // One notice under the bell, as a real home would have: dismissing it is the demo of that too.
    this.notices = [{ id: 'demo', title: 'About this demo', at: Date.now() - 3_600_000,
      message: `${home.name} answers in your browser: nothing here is real, and every change is forgotten when you leave. Tap a notice to dismiss it.` }];
    registry.notices = this.notices;
    this.registry = registry;
    this.version = `${t.demo} · ${home.name}`;
    this.setStatus('live');
    this.registryListeners.forEach((fn) => fn());
    this.listeners.forEach((fn) => fn([...this.states.values()]));
  }

  stop(notify = true) {
    for (const e of this.entities.values()) e.dispose();
    this.entities.clear();
    this.states.clear();
    this.changed.clear();
    this.registry = emptyRegistry();
    this.assist = [];
    this.notices = [];
    this.home = null;
    this.version = '';
    if (notify) this.setStatus('signed-out');
  }

  // Entities report one change at a time; the UI gets them batched per tick,
  // like the WebSocket's diffs.
  private queue(s: HassState) {
    this.states.set(s.entity_id, s);
    this.changed.set(s.entity_id, s);
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => {
      this.flushing = false;
      const list = [...this.changed.values()];
      this.changed.clear();
      this.listeners.forEach((fn) => fn(list));
    });
  }

  // The demo has no recorder: a day is made up around the current value, the
  // same one every time for the same entity (a hash of its id seeds it).
  async history(entity: string, hours: number) {
    const e = this.states.get(entity), v = Number(e?.state);
    if (!e || !Number.isFinite(v)) return Array.from({ length: hours }, () => null);
    const rand = seeded(entity);
    const phase = rand() * Math.PI * 2, swing = 0.1 + rand() * 0.2, noise = rand() * 0.06;
    const base = v || 1;
    return Array.from({ length: hours }, (_, i) => {
      const x = (i + 1) / hours;                // 1 at the current hour
      const wave = Math.sin(x * Math.PI * 2 + phase) - Math.sin(Math.PI * 2 + phase);
      const value = base * (1 + swing * wave * (1 - x) + (rand() - 0.5) * noise);
      return Math.round((i === hours - 1 ? v : value) * 100) / 100;
    });
  }

  // A day of changes made up the same way: a few flips between the current
  // state and its opposite, ending in the current one.
  async changes(entities: string[], hours: number) {
    const out: Record<string, StateChange[]> = {};
    for (const id of entities) {
      const e = this.states.get(id);
      if (!e) { out[id] = []; continue; }
      const rand = seeded(`${id}/changes`);
      const other = OTHER_STATE[e.state] ?? (id.startsWith('climate.') ? 'heat' : 'off');
      const flips = Math.floor(rand() * 5);
      const times = Array.from({ length: flips }, () => 0.3 + rand() * (hours - 1)).sort((a, b) => b - a);
      let state = flips % 2 === 0 ? e.state : other;
      const list: StateChange[] = [{ state, ago: hours }];
      for (const ago of times) { state = state === e.state ? other : e.state; list.push({ state, ago }); }
      out[id] = list;
    }
    return out;
  }

  // A month of days made up around a daily figure: the entity's value is a
  // running total, so the day is a slice of it, weekdays heavier than weekends.
  async statistics(entity: string, days?: number) {
    const e = this.states.get(entity), v = Number(e?.state);
    const now = new Date(), today = now.getDate();
    const length = days ?? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (!e || !Number.isFinite(v)) return Array.from({ length }, () => null);
    const rand = seeded(`${entity}/month`);
    const perDay = Math.max(0.5, v / 30);
    // The date of slot i: the days of this month, or the last `days` days ending today.
    const dateOf = (i: number) => days ? new Date(now.getFullYear(), now.getMonth(), today - (days - 1 - i)) : new Date(now.getFullYear(), now.getMonth(), i + 1);
    return Array.from({ length }, (_, i) => {
      const d = dateOf(i);
      if (d > now) return null;
      const dow = d.getDay(), isToday = d.toDateString() === now.toDateString();
      const weekend = dow === 0 || dow === 6 ? 0.7 : 1;
      const value = perDay * weekend * (0.7 + rand() * 0.6) * (isToday ? now.getHours() / 24 + 0.05 : 1);
      return Math.round(value * 100) / 100;
    });
  }

  async call(c: Call) {
    if (this.status !== 'live') throw new Error(t.errNoConnection);
    if (isAsk(c)) return this.ask(String(c.data.text ?? ''));
    const { domain, service, data } = c;
    if (domain === 'persistent_notification') {
      await new Promise((r) => setTimeout(r, ROUND_TRIP_MS));
      this.notices = service === 'dismiss_all' ? [] : this.notices.filter((n) => n.id !== data.notification_id);
      this.registry = { ...this.registry, notices: this.notices };
      this.registryListeners.forEach((fn) => fn());
      return;
    }
    const { entity_id, ...rest } = data;
    const ids = Array.isArray(entity_id) ? (entity_id as string[]) : entity_id ? [entity_id as string] : [];
    await new Promise((r) => setTimeout(r, ROUND_TRIP_MS));
    for (const id of ids) await this.entities.get(id)?.handleService(domain, service, rest);
  }

  // The demo's Assist: a few of the built-in agent's questions and orders (who
  // is home, which lights are on, turn something on or off, the windows, the
  // locks, the temperature, the weather, the time), answered from the home's
  // states in the agent's own words. Anything else, it does not understand.
  async ask(text: string): Promise<Answer> {
    if (this.status !== 'live') throw new Error(t.errNoConnection);
    await new Promise((r) => setTimeout(r, 450));
    const q = text.trim().toLowerCase().replace(/[?.!\s]+$/, '');
    const all = [...this.states.values()];
    const of = (...domains: string[]) => all.filter((e) => domains.includes(e.entity_id.split('.')[0]));
    const name = (e: HassState) => String(e.attributes.friendly_name ?? e.entity_id);
    const sentence = (es: HassState[]) => { const n = es.map(name); return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0] ?? ''; };
    const answer = (speech: string, kind: Answer['kind'] = 'answer', targets: string[] = []): Answer => {
      const a: Answer = { text, speech, kind, targets, at: Date.now() };
      this.assist = [a, ...this.assist].slice(0, KEPT_ANSWERS);
      this.messageListeners.forEach((fn) => fn([ASSIST]));
      return a;
    };
    const sorry = () => answer("Sorry, I couldn't understand that", 'error');
    const done = async (es: HassState[], service: string, speech: string) => {
      for (const e of es) await this.entities.get(e.entity_id)?.handleService(e.entity_id.split('.')[0], service, {});
      return answer(speech, 'done', es.map((e) => e.entity_id));
    };
    const howMany = /how many/.test(q), any = /^(are|is) (there )?any/.test(q);
    let m: RegExpExecArray | null;
    if (/who('s| is| are)? (at )?home|people (are )?(at )?home/.test(q)) {
      const home = of('person', 'device_tracker').filter((e) => e.state === 'home');
      return answer(howMany ? String(home.length) : home.length ? sentence(home) : 'Not any');
    }
    if ((m = /lights? (are |is )?(on|off)\b/.exec(q)) && !/^turn/.test(q)) {
      const lights = of('light').filter((e) => e.state === m![2]);
      return answer(howMany ? String(lights.length) : any ? (lights.length ? 'Yes' : 'No') : lights.length ? sentence(lights) : `No lights are ${m[2]}`);
    }
    if ((m = /^(?:please )?turn (on|off) (?:all )?(?:of )?(?:the )?lights$/.exec(q))) {
      return done(of('light').filter((e) => e.state !== m![1]), `turn_${m[1]}`, `Turned ${m[1]} all of the lights`);
    }
    if ((m = /^(?:please )?turn (on|off) (?:the )?(.+)$/.exec(q))) {
      const what = m[2].trim();
      const hit = of('light', 'switch', 'fan', 'media_player', 'siren', 'humidifier').filter((e) => name(e).toLowerCase().includes(what));
      if (!hit.length) return answer(`Sorry, I am not aware of any device called ${what}`, 'error');
      return done(hit, `turn_${m[1]}`, `Turned ${m[1]} ${hit.length > 1 ? `${hit.length} devices` : `the ${hit[0].entity_id.split('.')[0].replace('_', ' ')}`}`);
    }
    if (/windows? (are |is )?open|open windows/.test(q)) {
      const open = of('cover', 'binary_sensor').filter((e) => e.attributes.device_class === 'window' && ['open', 'on'].includes(e.state));
      return answer(howMany ? String(open.length) : open.length ? (any ? 'Yes' : sentence(open)) : 'No');
    }
    if ((m = /(doors?|locks?) (are |is )?(un)?locked/.exec(q))) {
      const locks = of('lock').filter((e) => e.state === (m![3] ? 'unlocked' : 'locked'));
      return answer(howMany ? String(locks.length) : locks.length ? (any ? 'Yes' : sentence(locks)) : 'No');
    }
    if (/temperature/.test(q)) {
      const c = of('climate').find((e) => e.attributes.current_temperature != null);
      return c ? answer(`${String(c.attributes.current_temperature)}${this.unit}`) : sorry();
    }
    if (/weather/.test(q)) {
      const w = of('weather')[0];
      return w ? answer(`It is ${w.state.replace(/-/g, ' ')} and ${String(w.attributes.temperature)}${String(w.attributes.temperature_unit ?? '°')}`) : answer('Sorry, no weather is exposed', 'error');
    }
    if (/what time/.test(q)) return answer(new Date().toLocaleTimeString(this.language, { hour: 'numeric', minute: '2-digit' }), 'done');
    return sorry();
  }
}
