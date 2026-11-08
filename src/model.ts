import { ASSIST, emptyRegistry, type Answer, type Call, type HassState, type Notice, type Registry, type States } from './source.ts';
import { listOf, num, type Alert, type CodeFormat, type GeoPlot, type Reading, type Seg, type TrackSpec } from '@zumer/pulse';
import { distanceKm, forText, hourText, zoomFor } from './shared.ts';

// Every channel is read from Home Assistant's live state: there are no
// hand-written "ok" and "alert" states. An alert comes out of a rule over the
// data and its action is a real service call. If the entity is missing, the
// channel does not appear (another Home Assistant installation builds its own
// object). Next to the states goes the registry: where each entity is, which
// ones are hidden or diagnostic (they stay out, as in Home Assistant's own
// summaries), and the repairs Home Assistant raised.

// The readings are the core's (`Reading`, `Seg`, `Dial`, `Alert`…): every thing
// is a Home Assistant entity id, every action a service call (`Call`).
export type Channel = { key: string; name: string; glyph: string; read: (s: States, ctx: Context) => Reading | null };
// `whole`: about the home as a whole (Assist), read regardless of the areas chosen and not a room's.
export type PulseSystem = { id: string; title: string; channels: Channel[]; whole?: boolean };
export type Context = {
  temp: string;
  reg: Registry;
  areas?: string[] | null;          // only entities in these areas (by id); null or absent: everywhere
  picks?: Record<string, string>;   // 'system/channel' → the entity the viewer chose for it
  assist?: { answers: Answer[]; language?: string };   // the home's answers so far, when the source can ask (Assist)
};

// The registry and the context of the channel being read. The helpers below
// are plain functions over the states; `systems` (at the end) sets these
// before each channel reads, so they can ask where an entity is, whether it is
// hidden, whether it is in the chosen areas, and which entity the viewer picked.
let reg: Registry = emptyRegistry();
let areaSet: Set<string> | null = null;
let current = { key: '', picks: {} as Record<string, string>, claimed: false, choice: undefined as string | undefined, choices: undefined as string[] | undefined };
// The first scan a channel makes is the one that decides what it follows; the
// later ones (a dehumidifier next to the humidity, the alarm behind the locks)
// are lookups.
const claim = () => { if (current.claimed) return false; current.claimed = true; return true; };

// Whether an entity asks for a code (`code_format`: 'number' or 'text'; the
// older frontends' regex, digits or anything) and so its actions wait on the keypad.
const codeFormat = (e: HassState): CodeFormat | undefined => {
  const f = e.attributes.code_format;
  if (!f) return undefined;
  return f === 'number' || /^\^?(\\d|\[0-9\])/.test(String(f)) ? 'number' : 'text';
};

// The channels name the entities of Home Assistant's demo integration (the
// local test installation) and fall back to the first entity of the kind, so
// another installation, or one of the demo homes, builds its own object.

const g = {
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  plug: 'M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v4',
  thermo: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z',
  flame: 'M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5 1-2 1-5 0-9z',
  fan: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M12 10c0-4 1-7 4-7 2 0 2 3 0 5 M14 12c4 0 7 1 7 4 0 2-3 2-5 0 M12 14c0 4-1 7-4 7-2 0-2-3 0-5 M10 12c-4 0-7-1-7-4 0-2 3-2 5 0',
  drop: 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6 M5 21h14v-3H5z M12 3v2 M4 7l1.5 1 M20 7l-1.5 1',
  lock: 'M6 11h12v10H6z M8 11V8a4 4 0 0 1 8 0v3 M12 15v2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  window: 'M4 4h16v16H4z M12 4v16 M4 12h16',
  garage: 'M3 10l9-6 9 6v10H3z M7 20v-8h10v8 M7 15h10',
  sprout: 'M12 21v-9 M12 12C12 7 8 5 4 5c0 5 3 7 8 7z M12 14c0-4 3-6 8-6 0 4-3 6-8 6z',
  play: 'M7 4l13 8-13 8z',
  volume: 'M4 9h4l5-4v14l-5-4H4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  air: 'M3 8h11a3 3 0 1 0-3-3 M3 12h16a3 3 0 1 1-3 3 M3 16h7',
  tap: 'M4 10h10a4 4 0 0 1 4 4v2 M8 10V6h4v4 M6 6h8 M18 19v.01',
  box: 'M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10',
  robot: 'M5 12a7 7 0 0 1 14 0v4H5z M9 12h.01 M15 12h.01 M3 19h18',
  battery: 'M3 8h15v8H3z M18 10h2v4h-2z M6 11v2',
  warn: 'M10.3 4.5L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
  wrench: 'M14.5 5.5a4 4 0 0 1 5 4.6L12 17.6l-3.5-3.5 7.5-7.5a4 4 0 0 1-1.5-1.1z M8.5 14.1L3 19.6 4.4 21l5.5-5.5',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  pin: 'M12 21s-7-6.3-7-11.5a7 7 0 0 1 14 0C19 14.7 12 21 12 21z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  cloud: 'M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .5 9z',
  chat: 'M4 5h16v10h-9l-5 4v-4H4z M8 10h8',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',
};

// Short names for the demo's entities; otherwise Home Assistant's friendly name.
const short: Record<string, string> = {
  'light.bed_light': 'Bedroom', 'light.ceiling_lights': 'Ceiling', 'light.kitchen_lights': 'Kitchen',
  'light.office_rgbw_lights': 'Office', 'light.living_room_rgbww_lights': 'Living room',
  'light.entrance_color_white_lights': 'Entrance',
  'switch.decorative_lights': 'Fairy lights', 'switch.ac': 'AC',
  'lock.front_door': 'Front door', 'lock.kitchen_door': 'Kitchen door',
  'lock.poorly_installed_door': 'Poorly installed door', 'lock.openable_lock': 'Lock',
  'binary_sensor.movement_backyard': 'Backyard motion', 'binary_sensor.basement_floor_wet': 'Basement water',
  'cover.living_room_window': 'Living room window', 'cover.hall_window': 'Hall window',
  'cover.kitchen_window': 'Kitchen window', 'cover.garage_door': 'Garage door', 'cover.pergola_roof': 'Pergola',
  'valve.front_garden': 'Front garden', 'valve.back_garden': 'Back garden', 'valve.orchard': 'Orchard',
  'valve.trees': 'Trees', 'media_player.bedroom': 'Bedroom', 'media_player.kitchen': 'Kitchen',
  'media_player.living_room': 'Living room', 'media_player.lounge_room': 'TV', 'media_player.walkman': 'Walkman',
  'siren.siren': 'Siren', 'siren.siren_with_all_features': 'Siren 2',
};

export const nameOf = (s: States, id: string) => {
  const floor = /^vacuum\.demo_vacuum_(\d+)_/.exec(id)?.[1];
  return short[id] ?? (floor ? `Floor ${floor} vacuum` : s.get(id)?.attributes.friendly_name ?? humanize(id));
};
// An entity with no name reads as its id made into words: "sensor.power_grid" → "Power grid".
const humanize = (id: string) => cap(id.slice(id.indexOf('.') + 1).replace(/_/g, ' '));
// The names of a group, each told apart by its place when two share a name
// ("Ceiling light · Kitchen", "Ceiling light · Hall").
const labelsOf = (s: States, ids: string[]) => {
  const names = ids.map((id) => nameOf(s, id));
  return ids.map((id, i) => names.indexOf(names[i]) !== names.lastIndexOf(names[i]) ? whereIs(s, id) : names[i]);
};
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const attr = (e: HassState, k: string) => e.attributes[k] as number | undefined;
// Hidden entities stay out of the scans, and so do config/diagnostic ones
// unless the scan asks for them (Maintenance does: batteries are diagnostic).
// An entity named by id is taken as it is.
const visible = (id: string, diagnostic = false) => {
  const e = reg.entities.get(id);
  return !e?.hidden && (!e?.category || (diagnostic && e.category === 'diagnostic'));
};
// The area an entity is in: its own, or its device's.
export const areaOf = (id: string) => {
  const e = reg.entities.get(id);
  return e?.area_id ?? (e?.device_id ? reg.devices.get(e.device_id)?.area_id : undefined) ?? undefined;
};
export const placeOf = (id: string) => { const a = areaOf(id); return a ? reg.areas.get(a)?.name : undefined; };
// With areas chosen, only what is in them counts; an entity with no area stays
// out (as in Home Assistant's area views), unless the empty id is among them
// (NO_AREA: the room of what has no area, on the rooms axis).
export const NO_AREA = '';
const inAreas = (id: string) => { if (!areaSet) return true; const a = areaOf(id); return a ? areaSet.has(a) : areaSet.has(NO_AREA); };
const scan = (s: States, domain: string, diagnostic: boolean) =>
  [...s.keys()].filter((id) => id.startsWith(`${domain}.`) && visible(id, diagnostic) && inAreas(id)).sort();
const ofDomain = (s: States, domain: string, only?: string[], diagnostic = false) => {
  claim();
  return (only ?? scan(s, domain, diagnostic)).filter((id) => s.has(id) && inAreas(id));
};
// A name with its place when the place adds something ("Motion · Garden").
const whereIs = (s: States, id: string) => {
  const n = nameOf(s, id), p = placeOf(id);
  return p && !n.toLowerCase().includes(p.toLowerCase()) ? `${n} · ${p}` : n;
};
// The known entities that are there, or every entity of the domain that fits.
const known = (s: States, domain: string, ids: string[], fits: (e: HassState) => boolean = () => true, diagnostic = false) => {
  claim();
  const there = ids.filter((id) => s.has(id) && inAreas(id));
  return there.length ? there : scan(s, domain, diagnostic).filter((id) => fits(s.get(id)!));
};
// One entity: the n-th known one, else the n-th of the domain that fits. When
// it is the channel's own (first) scan, every fitting entity is a choice and
// the viewer's pick, if it is one of them, wins.
const nth = (s: States, domain: string, ids: string[], fits: (e: HassState) => boolean = () => true, n = 0) => {
  const primary = claim();
  const there = ids.filter((id) => s.has(id) && inAreas(id));
  const fitting = scan(s, domain, false).filter((id) => fits(s.get(id)!));
  const id = (there.length ? there : fitting)[n] as string | undefined;
  if (!primary) return id;
  current.choices = [...new Set([...there, ...fitting])];
  const pick = current.picks[current.key];
  current.choice = pick && current.choices.includes(pick) ? pick : id;
  return current.choice;
};
const first = (s: States, domain: string, ids: string[], fits?: (e: HassState) => boolean) => nth(s, domain, ids, fits, 0);
// The home's energy meter: the first kWh sensor, the grid's consumption when one is named so.
export function meterOf(s: States) {
  const all = [...s.values()].filter((e) => e.entity_id.startsWith('sensor.') && e.attributes.unit_of_measurement === 'kWh' && Number.isFinite(Number(e.state)) && inAreas(e.entity_id));
  const pick = (f: (e: HassState) => boolean) => all.find(f)?.entity_id;
  return pick((e) => e.attributes.device_class === 'energy' && /consum|grid|import|house|home|total/i.test(e.entity_id))
    ?? pick((e) => e.attributes.device_class === 'energy') ?? pick((e) => /consum|grid/i.test(e.entity_id)) ?? all[0]?.entity_id;
}
// A channel that fell back to another installation's entity takes its name;
// for the demo integration's the channel's own name is better ("Heating", not "HeatPump").
const ownName = (s: States, id: string) => id in short || /^(climate\.(heatpump|hvac|ecobee)|water_heater\.demo_water_heater)$/.test(id) ? undefined : nameOf(s, id);
const isClass = (cls: string) => (e: HassState) => e.attributes.device_class === cls;
const list = (names: string[]) => listOf(names.map((n) => n.toLowerCase()));
const call = (domain: string, service: string, entity_id: string | string[], data = {}, asks?: CodeFormat): Call =>
  ({ ids: ([] as string[]).concat(entity_id), domain, service, data: { entity_id, ...data }, ...(asks ? { asks } : {}) });
const busy = (state: string) => /ing$/.test(state) && state !== 'playing';
const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
const strs = (e: HassState, k: string) => ((e.attributes[k] as unknown[] | undefined) ?? []).map(String);
// A light's color as CSS, when it is on and colored: Home Assistant's rgb_color
// (warm white comes out warm, as in its own light card), or the hue and
// saturation at full value when that is all there is.
const lightTint = (e: HassState) => {
  if (e.state !== 'on') return undefined;
  const rgb = e.attributes.rgb_color as number[] | null | undefined, hs = e.attributes.hs_color as number[] | null | undefined;
  if (rgb?.length === 3) return `rgb(${rgb.join(',')})`;
  return hs?.length === 2 ? `hsl(${Math.round(hs[0])} 100% ${Math.round(100 - hs[1] / 2)}%)` : undefined;
};
const COLOR_MODES = ['hs', 'rgb', 'xy', 'rgbw', 'rgbww'];
const picture = (e: HassState | undefined) => (e?.attributes.entity_picture as string | undefined) || undefined;

// Temperature dial of a thermostat or water heater. It shows the measurement;
// the ring is the target, which is what changes.
function thermostat(pick: (s: States) => string | undefined, domain: 'climate' | 'water_heater', label: (e: HassState) => string,
  alert?: (s: States, e: HassState) => Alert | undefined, more?: (s: States) => Pick<Reading, 'tracks' | 'events'>) {
  return (s: States, u: Context): Reading | null => {
    const id = pick(s), e = id ? s.get(id) : undefined;
    if (!id || !e || attr(e, 'temperature') == null) return null;
    const min = attr(e, 'min_temp') ?? 7, max = attr(e, 'max_temp') ?? 35, t = attr(e, 'temperature')!;
    const cur = attr(e, 'current_temperature');
    const extra = more?.(s);
    return {
      kind: 'p', v: clamp((t - min) / (max - min)), ids: [id],
      dial: { min, max, step: attr(e, 'target_temp_step') ?? 1, unit: '°', label: 'target', value: t, id,
        set: (x) => call(domain, 'set_temperature', id, { temperature: x }) },
      now: cur ?? undefined, big: cur != null ? `${num(cur)}${u.temp}` : `${num(t)}°`, label: label(e), alert: alert?.(s, e),
      name: ownName(s, id),
      // Its day: when it was running (its mode, not off), then whatever the channel adds.
      tracks: [{ id, on: running, now: running(e.state) }, ...(extra?.tracks ?? [])],
      events: extra?.events,
    };
  };
}

const running = (st: string) => !['off', 'unavailable', 'unknown'].includes(st);
const hvacAction: Record<string, string> = {
  heating: 'heating', cooling: 'cooling', idle: 'idle', off: 'off', drying: 'drying', fan: 'fan',
};
const hvacMode: Record<string, string> = {
  off: 'off', heat: 'heat', cool: 'cool', heat_cool: 'auto', auto: 'auto', dry: 'dry', fan_only: 'fan only',
};
const cameraState: Record<string, string> = { streaming: 'Live', recording: 'Recording', idle: 'Idle', unavailable: 'Unavailable' };
const coverState: Record<string, string> = { open: 'open', closed: 'closed', opening: 'opening…', closing: 'closing…' };
const alarmState: Record<string, string> = {
  disarmed: 'Disarmed', armed_home: 'Home', armed_away: 'Away', armed_night: 'Night',
  armed_vacation: 'Vacation', armed_custom_bypass: 'Custom', arming: 'Arming…', pending: 'About to sound',
  triggered: 'Triggered', disarming: 'Disarming…',
};
const alarmId = (s: States) => first(s, 'alarm_control_panel', ['alarm_control_panel.security']);
const armed = (s: States) => { const id = alarmId(s); return !!id && /^armed_/.test(s.get(id)!.state); };
// Thermostats with a single target, the demo's heat pump and AC first; the
// ones with a range (the Ecobee) have their own channel.
const thermostat_ = (s: States, n: number) => nth(s, 'climate', ['climate.heatpump', 'climate.hvac'], (e) => attr(e, 'temperature') != null, n);
const thermoLabel = (e: HassState) =>
  `target ${num(attr(e, 'temperature')!)}° · ${hvacAction[String(e.attributes.hvac_action)] ?? hvacMode[e.state] ?? e.state}`;

// The day of each switched entity, for the detail's rings: on is on.
const isOn = (state: string) => state === 'on';
const tracksOf = (segs: Seg[]): TrackSpec[] => segs.map((x) => ({ id: x.id, on: isOn, now: x.on, act: x.act }));

// Segments of entities switched on and off with a tap.
function switches(ids: string[], s: States, isOn: (e: HassState) => boolean, act: (e: HassState) => Call | undefined): Seg[] {
  const labels = labelsOf(s, ids);
  return ids.map((id, i) => { const e = s.get(id)!; return { label: labels[i], on: isOn(e), id, act: act(e) }; });
}

const windows = (s: States) => ofDomain(s, 'cover')
  .filter((id) => s.get(id)!.attributes.device_class !== 'garage' && id !== 'cover.pergola_roof');
const isOpen = (st: string) => ['open', 'opening', 'closing'].includes(st);
const openWindows = (s: States) => windows(s).filter((id) => isOpen(s.get(id)!.state));

// Covers with a position that are not the garage: the demo's two windows first.
const positional = (s: States, n: number) => nth(s, 'cover', ['cover.living_room_window', 'cover.hall_window'],
  (e) => attr(e, 'current_position') != null && e.attributes.device_class !== 'garage', n);
function coverDial(pick: (s: States) => string | undefined) {
  return (s: States): Reading | null => {
    const id = pick(s), e = id ? s.get(id) : undefined;
    if (!id || !e || attr(e, 'current_position') == null) return null;
    const p = attr(e, 'current_position')!;
    return {
      kind: 'p', v: p / 100, ids: [id],
      dial: { min: 0, max: 100, step: 10, unit: '%', label: 'open', value: p, id,
        set: (x) => call('cover', 'set_cover_position', id, { position: x }) },
      big: p === 0 ? 'Closed' : `${p}%`, label: busy(e.state) ? coverState[e.state] : p === 0 ? 'all the way' : 'open',
      name: ownName(s, id),
    };
  };
}

// Binary sensor classes, as Home Assistant's Security and Maintenance views group them.
const SAFETY = ['carbon_monoxide', 'gas', 'glass_break', 'moisture', 'safety', 'smoke', 'tamper'];
const OPENINGS = ['door', 'window', 'garage_door', 'opening', 'lock'];
const MOTION = ['motion', 'occupancy'];
const SAFETY_WORDS: Record<string, string> = {
  carbon_monoxide: 'Carbon monoxide', gas: 'Gas', glass_break: 'Glass broken', moisture: 'Water', safety: 'Unsafe', smoke: 'Smoke', tamper: 'Tampering',
};
const LOW_BATTERY = 20;

// ─── People, the weather and the sun ───
const AT_HOME = 'home';
const isHome = (st: string) => st === AT_HOME;
// Where someone is, in words: home, away, or the zone they are in.
const whereabouts = (e: HassState) => e.state === AT_HOME ? 'home' : e.state === 'not_home' ? 'away' : ['unknown', 'unavailable'].includes(e.state) ? 'unknown' : e.state;
const geo = (e: HassState | undefined) => { const lat = e && attr(e, 'latitude'), lon = e && attr(e, 'longitude'); return lat != null && lon != null ? { lat, lon } : null; };
const homeAt = (s: States) => geo(s.get('zone.home'));
const midpoint = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => ({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 });
// A tile zoom that holds `km` across the disc around a latitude: a street at 16, a region at 8.
const kmText = (d: number) => `${num(d, d < 10 ? 1 : 0)} km`;
// The people of the home: its persons, and the device trackers no person
// follows (a car, a phone with no person); a router's sightings only when
// there is nothing else.
const people = (s: States) => {
  const persons = ofDomain(s, 'person');
  const theirs = new Set(persons.flatMap((id) => strs(s.get(id)!, 'device_trackers')));
  const loose = scan(s, 'device_tracker', false).filter((id) => !theirs.has(id));
  const own = loose.filter((id) => s.get(id)!.attributes.source_type !== 'router');
  return [...persons, ...(own.length ? own : persons.length ? [] : loose)].filter(inAreas);
};
const personPlot = (s: States, id: string): GeoPlot => ({ ...geo(s.get(id))!, label: `${nameOf(s, id)} · ${whereabouts(s.get(id)!)}`, id, size: 0.7 });
// The zones of the home but home itself, as dim marks: where someone may be.
const zonePlots = (s: States): GeoPlot[] => [...s.values()].filter((e) => e.entity_id.startsWith('zone.') && e.entity_id !== 'zone.home' && geo(e))
  .map((e) => ({ ...geo(e)!, label: nameOf(s, e.entity_id), on: false, size: 0.25 }));
// Home Assistant's weather conditions, in words.
const CONDITIONS: Record<string, string> = {
  'clear-night': 'clear night', cloudy: 'cloudy', fog: 'fog', hail: 'hail', lightning: 'lightning', 'lightning-rainy': 'thunderstorm', partlycloudy: 'partly cloudy',
  pouring: 'pouring', rainy: 'rain', snowy: 'snow', 'snowy-rainy': 'sleet', sunny: 'sunny', windy: 'windy', 'windy-variant': 'windy', exceptional: 'exceptional',
};
const compass = (bearing: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((bearing % 360) + 360) % 360) / 45) % 8];

// ─── Notices and Assist ───
// A notice's text without its markdown, on one line.
const plain = (md: string) => md.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
const shorten = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const dismiss = (n?: Notice): Call => ({ ids: [], domain: 'persistent_notification', service: n ? 'dismiss' : 'dismiss_all', data: n ? { notification_id: n.id } : {} });
// A question or an order to the home: Assist's agent answers in its words.
const ask = (text: string, language?: string): Call => ({ ids: [ASSIST], domain: 'conversation', service: 'process', data: { text, ...(language ? { language } : {}) } });
// The questions every installation understands (the built-in intents, in
// English), each when the home has what it asks about; the first four that
// apply go on the ring (their names have to fit their arcs), "Ask…" after them.
const QUICK: { label: string; text: string; when: (s: States) => boolean }[] = [
  { label: "Who's home?", text: 'who is home?', when: (s) => people(s).length > 0 },
  { label: 'Lights on?', text: 'which lights are on?', when: (s) => scan(s, 'light', false).length > 0 },
  { label: 'Locked up?', text: 'are all the doors locked?', when: (s) => scan(s, 'lock', false).length > 0 },
  { label: 'All lights off', text: 'turn off all the lights', when: (s) => scan(s, 'light', false).length > 0 },
  { label: 'Windows open?', text: 'are any windows open?', when: (s) => [...s.values()].some((e) => e.attributes.device_class === 'window') },
];
const QUICK_ON_RING = 4;
// The answer in the face: a short one as it is; a long one by its kind. The
// words of an answer, less the apology the face already says.
const bigOf = (a: Answer) => (a.kind === 'done' ? 'Done' : a.kind === 'error' ? 'Sorry' : a.speech.length <= 14 ? a.speech : 'Answered');
const wordsOf = (a: Answer) => (a.kind === 'error' ? cap(a.speech.replace(/^sorry,?\s*/i, '')) : a.speech);

const SYSTEMS: PulseSystem[] = [
  { id: 'lights', title: 'Lights', channels: [
    { key: 'lights', name: 'Lights', glyph: g.bulb, read: (s) => {
      const ids = ofDomain(s, 'light');
      if (!ids.length) return null;
      const segs = switches(ids, s, (e) => e.state === 'on', (e) => call('light', 'toggle', e.entity_id));
      const on = segs.filter((x) => x.on);
      return { kind: 's', segs, ids: ids, big: `${on.length} of ${segs.length}`,
        label: on.length ? list(on.map((x) => x.label)) : 'all off', tracks: tracksOf(segs) };
    } },
    { key: 'brightness', name: 'Living room brightness', glyph: g.sun, read: (s) => {
      const id = first(s, 'light', ['light.living_room_rgbww_lights'],
        (e) => ((e.attributes.supported_color_modes as string[] | undefined) ?? []).some((m) => m !== 'onoff'));
      const e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const pct = e.state === 'on' ? Math.round((attr(e, 'brightness') ?? 255) / 2.55) : 0;
      const colored = strs(e, 'supported_color_modes').some((m) => COLOR_MODES.includes(m));
      const hs = e.attributes.hs_color as [number, number] | null | undefined;
      return { kind: 'p', v: pct / 100, ids: [id], big: pct ? `${pct}%` : 'Off', label: nameOf(s, id).toLowerCase(),
        name: ownName(s, id) && `${nameOf(s, id)} brightness`, tint: lightTint(e),
        dial: { min: 0, max: 100, step: 5, unit: '%', label: 'brightness', value: pct, id,
          set: (x) => x ? call('light', 'turn_on', id, { brightness_pct: x }) : call('light', 'turn_off', id) },
        color: colored ? { hs: e.state === 'on' && hs?.length === 2 && e.attributes.color_mode !== 'color_temp' ? [Math.round(hs[0]), Math.round(hs[1])] : null, id,
          set: (h, sat) => call('light', 'turn_on', id, { hs_color: [h, sat] }) } : undefined };
    } },
    { key: 'plugs', name: 'Plugs', glyph: g.plug, read: (s) => {
      const ids = ofDomain(s, 'switch');
      if (!ids.length) return null;
      const segs = switches(ids, s, (e) => e.state === 'on', (e) => call('switch', 'toggle', e.entity_id));
      const on = segs.filter((x) => x.on);
      return { kind: 's', segs, ids: ids, big: `${on.length} of ${segs.length}`,
        label: on.length ? list(on.map((x) => x.label)) : 'all off', tracks: tracksOf(segs) };
    } },
  ] },

  { id: 'climate', title: 'Climate', channels: [
    { key: 'heating', name: 'Heating', glyph: g.flame,
      read: thermostat((s) => thermostat_(s, 0), 'climate', thermoLabel,
        // Rule across ids: heating with the windows open.
        (s, e) => {
          const open = openWindows(s);
          if (e.attributes.hvac_action !== 'heating' || !open.length) return undefined;
          if (open.every((id) => s.get(id)!.state === 'closing')) {
            return { level: 1, big: 'Closing', label: `${open.length} windows`, why: 'The windows are closing',
              verb: '', acts: [], busy: true };
          }
          return { level: 1, big: 'Windows', label: `${open.length} open`,
            why: `Heating with ${list(open.map((id) => nameOf(s, id)))} open`, verb: 'Close windows',
            acts: [call('cover', 'close_cover', open)] };
        },
        // The windows under the heating: each a ring of when it was open; the
        // ones open now are named at the moment they opened.
        (s) => {
          const ws = windows(s), open = openWindows(s);
          return {
            tracks: ws.map((id) => ({ id, on: isOpen, now: open.includes(id), tone: 'warn' as const })),
            events: open.map((id) => ({ id, text: `${nameOf(s, id)} open`, tone: 'warn' as const })),
          };
        }) },
    { key: 'mode', name: 'Mode', glyph: g.thermo, read: (s) => {
      // The thermostat's mode: one of its hvac_modes, chosen on the ring.
      const id = first(s, 'climate', ['climate.heatpump', 'climate.hvac'], (e) => strs(e, 'hvac_modes').length > 1);
      const e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const modes = strs(e, 'hvac_modes').slice(0, 8);
      if (modes.length < 2) return null;
      const segs = modes.map((m) => ({ label: cap(hvacMode[m] ?? m), on: e.state === m, id,
        act: e.state === m ? undefined : call('climate', 'set_hvac_mode', id, { hvac_mode: m }) }));
      const action = hvacAction[String(e.attributes.hvac_action)];
      return { kind: 'c', segs, ids: [id], big: cap(hvacMode[e.state] ?? e.state), name: ownName(s, id) && `${nameOf(s, id)} mode`,
        label: action && action !== hvacMode[e.state] ? action : nameOf(s, id).toLowerCase() };
    } },
    { key: 'preset', name: 'Preset', glyph: g.sprout, read: (s) => {
      // The thermostat's preset (eco, away, comfort, sleep…): one of its preset_modes, chosen on the ring.
      const id = first(s, 'climate', ['climate.ecobee', 'climate.hvac'], (e) => strs(e, 'preset_modes').length > 1);
      const e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const modes = strs(e, 'preset_modes').slice(0, 8);
      if (modes.length < 2) return null;
      const cur = String(e.attributes.preset_mode ?? '');
      const segs = modes.map((m) => ({ label: cap(m.replace(/_/g, ' ')), on: m === cur, id,
        act: m === cur ? undefined : call('climate', 'set_preset_mode', id, { preset_mode: m }) }));
      return { kind: 'c', segs, ids: [id], big: cur ? cap(cur.replace(/_/g, ' ')) : 'None', label: nameOf(s, id).toLowerCase(),
        name: ownName(s, id) && `${nameOf(s, id)} preset` };
    } },
    { key: 'ac', name: 'Air conditioning', glyph: g.fan, read: thermostat((s) => thermostat_(s, 1), 'climate', thermoLabel) },
    { key: 'fan', name: 'Fan', glyph: g.fan, read: (s) => {
      const id = first(s, 'fan', [], (e) => attr(e, 'percentage') != null || e.state === 'off');
      const e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const pct = e.state === 'on' ? attr(e, 'percentage') ?? 100 : 0, step = attr(e, 'percentage_step') ?? 25;
      return { kind: 'p', v: pct / 100, ids: [id], big: pct ? `${num(pct, 0)}%` : 'Off', label: nameOf(s, id).toLowerCase(), name: nameOf(s, id),
        dial: { min: 0, max: 100, step: Math.max(1, Math.round(step)), unit: '%', label: 'speed', value: pct, id,
          set: (x) => x ? call('fan', 'set_percentage', id, { percentage: x }) : call('fan', 'turn_off', id) } };
    } },
    { key: 'ecobee', name: 'Ecobee', glyph: g.thermo, read: (s, u) => {
      // A thermostat with a comfort range: the band goes from the low target to the high one.
      const id = first(s, 'climate', ['climate.ecobee'], (e) => attr(e, 'target_temp_low') != null);
      const e = id ? s.get(id) : undefined;
      if (!id || !e || attr(e, 'current_temperature') == null) return null;
      const min = attr(e, 'min_temp') ?? 7, max = attr(e, 'max_temp') ?? 35, cur = attr(e, 'current_temperature')!;
      const lo = attr(e, 'target_temp_low'), hi = attr(e, 'target_temp_high');
      const step = attr(e, 'target_temp_step') ?? 1;
      const set = (l: number, h: number) => call('climate', 'set_temperature', id, { target_temp_low: l, target_temp_high: h });
      return { kind: 'p', v: clamp((cur - min) / (max - min)), ids: [id], big: `${num(cur)}${u.temp}`, name: ownName(s, id),
        label: lo != null && hi != null ? `between ${num(lo)}° and ${num(hi)}°` : hvacMode[e.state] ?? e.state,
        ...(lo != null && hi != null ? {
          dial: { min, max, step, unit: '°', label: 'range', value: lo, id, set: (x) => set(x, Math.max(x, hi)) },
          range: { lo, hi, set } } : {}) };
    } },
    { key: 'humidity', name: 'Humidity', glyph: g.drop, read: (s) => {
      // The first id is a simulated sensor of the local test installation.
      const id = first(s, 'sensor', ['sensor.humedad_simulada', 'sensor.outside_humidity'], isClass('humidity'));
      if (!id) return null;
      const h = Number(s.get(id)!.state), dry = first(s, 'humidifier', ['humidifier.dehumidifier'], isClass('dehumidifier'));
      const dryOff = dry != null && s.get(dry)!.state === 'off';
      return { kind: 'p', v: clamp(h / 100), ids: [id], big: `${num(h, 0)}%`, label: nameOf(s, id).toLowerCase(), history: id,
        alert: h >= 70 ? { level: 1, big: `${num(h, 0)}%`, label: 'high humidity', why: 'Humidity went past 70%',
          verb: dryOff ? 'Turn on dehumidifier' : 'Got it', acts: dryOff ? [call('humidifier', 'turn_on', dry!)] : [] }
          : undefined };
    } },
    { key: 'weather', name: 'Weather', glyph: g.cloud, read: (s) => {
      // Outside: the weather entity's temperature on the band, the wind as the arrow (where it comes from), the condition in words.
      const id = first(s, 'weather', ['weather.forecast_home', 'weather.home']), e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const temp = attr(e, 'temperature'), unit = String(e.attributes.temperature_unit ?? '°'), celsius = temp == null ? null : /F/.test(unit) ? (temp - 32) / 1.8 : temp;
      const wind = attr(e, 'wind_speed'), bearing = attr(e, 'wind_bearing'), humidity = attr(e, 'humidity');
      const windUnit = e.attributes.wind_speed_unit ? String(e.attributes.wind_speed_unit) : '';
      const words = [CONDITIONS[e.state] ?? e.state.replace(/-/g, ' '),
        wind != null && windUnit ? `wind ${num(wind, 0)} ${windUnit}${bearing != null ? ` ${compass(bearing)}` : ''}` : bearing != null ? `wind from the ${compass(bearing)}` : '',
        humidity != null ? `${num(humidity, 0)}% humidity` : ''].filter(Boolean);
      return { kind: 'p', v: celsius == null ? 0 : clamp((celsius + 10) / 50), ids: [id], big: temp != null ? `${num(temp)}${unit}` : cap(words[0]),
        label: words.slice(temp != null ? 0 : 1).join(' · '), bearing: bearing ?? undefined };
    } },
    { key: 'sun', name: 'Sun', glyph: g.sun, read: (s) => {
      // The sun: how high on the band, where in the sky as the arrow, and when it next sets or rises.
      const id = 'sun.sun', e = s.get(id);
      if (!e || !visible(id) || !inAreas(id)) return null;
      const up = e.state === 'above_horizon', elevation = attr(e, 'elevation') ?? 0, azimuth = attr(e, 'azimuth');
      const next = Date.parse(String(up ? e.attributes.next_setting : e.attributes.next_rising));
      const when = Number.isNaN(next) ? '' : ` in ${forText(next - Date.now())}`;
      return { kind: 'p', v: clamp(elevation / 65), ids: [id], big: Number.isNaN(next) ? (up ? 'Up' : 'Down') : hourText(next),
        label: `${up ? 'sets' : 'rises'}${when} · ${up ? `${num(elevation, 0)}° high` : 'below the horizon'}`, bearing: azimuth ?? undefined };
    } },
  ] },

  { id: 'security', title: 'Security', channels: [
    { key: 'alarm', name: 'Alarm', glyph: g.shield, read: (s) => {
      const id = alarmId(s), e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const modes: [string, string, string][] = [
        ['disarmed', 'Disarmed', 'alarm_disarm'], ['armed_home', 'Home', 'alarm_arm_home'], ['armed_away', 'Away', 'alarm_arm_away']];
      const next = String(e.attributes.next_state ?? '');
      // The code: always to disarm when the panel has one, to arm unless it says it is not required.
      const format = codeFormat(e), armAsks = e.attributes.code_arm_required === false ? undefined : format;
      const segs = modes.map(([st, label, service]) => ({ label, id,
        on: e.state === st || (e.state === 'arming' && next === st),
        act: e.state === st ? undefined : call('alarm_control_panel', service, id, {}, st === 'disarmed' ? format : armAsks) }));
      const fired = e.state === 'triggered' || e.state === 'pending';
      return { kind: 'c', segs, ids: [id], big: alarmState[e.state] ?? e.state,
        label: e.state === 'arming' ? `switching to ${alarmState[next]?.toLowerCase() ?? 'armed'}` : nameOf(s, id).toLowerCase(),
        alert: fired ? { level: 2, big: alarmState[e.state], label: 'alarm', fail: [0, 1, 2],
          why: e.state === 'triggered' ? 'The alarm went off' : 'The alarm is about to sound', verb: 'Disarm',
          acts: [call('alarm_control_panel', 'alarm_disarm', id, {}, format)] } : undefined };
    } },
    { key: 'cameras', name: 'Cameras', glyph: g.eye, read: (s) => {
      // One camera in the face (the gear picks another); the ring names them
      // all, and each one, the face included, opens the camera's own object.
      const id = first(s, 'camera', ['camera.demo_camera']);
      const e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const all = ofDomain(s, 'camera').slice(0, 8);
      const names = labelsOf(s, all);
      const segs = all.map((c, i) => ({ label: names[i], on: c === id, id: c, to: c }));
      const src = picture(e), state = cameraState[e.state] ?? cap(e.state);
      return { kind: 's', segs, ids: all.includes(id) ? all : [id, ...all], big: state, name: ownName(s, id) && nameOf(s, id), to: id,
        label: placeOf(id)?.toLowerCase() ?? (all.length > 1 ? `${all.length} cameras` : 'camera'),
        image: src ? { src, alt: nameOf(s, id), id, live: true } : undefined };
    } },
    { key: 'sirens', name: 'Sirens', glyph: g.siren, read: (s) => {
      const ids = ofDomain(s, 'siren');
      if (!ids.length) return null;
      const segs = switches(ids, s, (e) => e.state === 'on', (e) => call('siren', e.state === 'on' ? 'turn_off' : 'turn_on', e.entity_id));
      const on = segs.filter((x) => x.on);
      return { kind: 's', segs, ids: ids, big: on.length ? 'Sounding' : 'Silent', label: on.length ? list(on.map((x) => x.label)) : `${ids.length} sirens`,
        alert: on.length ? { level: 2, big: 'Sounding', label: list(on.map((x) => x.label)), fail: on.map((x) => segs.indexOf(x)),
          why: on.length > 1 ? 'Sirens are sounding' : 'A siren is sounding', verb: 'Turn off',
          acts: [call('siren', 'turn_off', on.map((x) => x.id))] } : undefined };
    } },
    { key: 'locks', name: 'Locks', glyph: g.lock, read: (s) => {
      const ids = ofDomain(s, 'lock');
      if (!ids.length) return null;
      // A lock with a code format waits for the code on the keypad, as the alarm does.
      const segs = switches(ids, s, (e) => ['locked', 'locking'].includes(e.state),
        (e) => busy(e.state) ? undefined : call('lock', e.state === 'locked' ? 'unlock' : 'lock', e.entity_id, {}, codeFormat(e)));
      const shut = segs.filter((x) => x.on).length;
      const jammed = ids.findIndex((id) => s.get(id)!.state === 'jammed');
      const open = segs.filter((x) => !x.on);
      let alert: Alert | undefined;
      if (jammed >= 0) {
        alert = { level: 2, big: 'Jammed', label: segs[jammed].label.toLowerCase(), fail: [jammed],
          why: `${segs[jammed].label} did not finish locking`, verb: 'Retry', acts: [call('lock', 'lock', ids[jammed], {}, codeFormat(s.get(ids[jammed])!))] };
      } else if (armed(s) && open.length) {
        alert = { level: 1, big: 'Unlocked', label: list(open.map((x) => x.label)), fail: open.map((x) => segs.indexOf(x)),
          why: 'Alarm armed with doors unlocked', verb: 'Lock', acts: [call('lock', 'lock', open.map((x) => x.id), {}, codeFormat(s.get(open[0].id)!))] };
      }
      return { kind: 's', segs, ids: ids, big: `${shut} of ${segs.length}`, label: 'locked', alert };
    } },
    { key: 'sensors', name: 'Sensors', glyph: g.eye, read: (s) => {
      // The binary sensors Home Assistant's own Security view watches (openings
      // and safety) plus motion and occupancy; the demo's two first. Up to
      // eight segments, the ones detecting something first.
      const all = known(s, 'binary_sensor', ['binary_sensor.movement_backyard', 'binary_sensor.basement_floor_wet'],
        (e) => [...SAFETY, ...OPENINGS, ...MOTION].includes(String(e.attributes.device_class)), true)
        .filter((id) => visible(id) || isClass('tamper')(s.get(id)!));
      if (!all.length) return null;
      const on = (id: string) => s.get(id)!.state === 'on';
      const cls = (id: string) => String(s.get(id)!.attributes.device_class);
      const ids = [...all.filter(on), ...all.filter((id) => !on(id))].slice(0, 8);
      // On = the sensor works; the one that detects something is the one painted.
      const names = labelsOf(s, ids);
      const segs = ids.map((id, i) => ({ label: names[i], on: s.get(id)!.state !== 'unavailable', id }));
      const detecting = (classes: string[]) => all.filter((id) => on(id) && classes.includes(cls(id)));
      const where = (found: string[]) => list(found.map((id) => whereIs(s, id)));
      const fail = (found: string[]) => found.map((id) => ids.indexOf(id)).filter((i) => i >= 0);
      const danger = detecting(SAFETY), moving = detecting(MOTION), opened = detecting(OPENINGS);
      let alert: Alert | undefined;
      if (danger.length) {
        const big = SAFETY_WORDS[cls(danger[0])];
        alert = { level: cls(danger[0]) === 'tamper' ? 1 : 2, big, label: where(danger), fail: fail(danger),
          why: `${big} detected: ${where(danger)}`, verb: 'Got it', acts: [] };
      } else if (armed(s) && (moving.length || opened.length)) {
        const found = [...moving, ...opened];
        alert = { level: 2, big: moving.length ? 'Motion' : 'Open', label: where(found), fail: fail(found),
          why: `${moving.length ? 'Motion' : 'Something open'} (${where(found)}) with the alarm armed`, verb: 'Got it', acts: [] };
      }
      const active = [...danger, ...moving, ...opened];
      return { kind: 's', segs, ids: all,
        big: danger.length ? SAFETY_WORDS[cls(danger[0])] : moving.length ? 'Motion' : opened.length ? `${opened.length} open` : 'Still',
        label: active.length ? where(active.slice(0, 3)) : `${all.length} sensors`, alert,
        // Each sensor's day: when it detected something.
        tracks: ids.map((id) => ({ id, on: isOn, now: on(id), tone: SAFETY.includes(cls(id)) ? 'critical' as const : 'warn' as const })) };
    } },
  ] },

  { id: 'people', title: 'People', channels: [
    { key: 'home', name: 'At home', glyph: g.person, read: (s) => {
      // Who is home: a segment per person (or tracked device), on when home; each opens their own object.
      const ids = people(s);
      if (!ids.length) return null;
      const labels = labelsOf(s, ids);
      const segs: Seg[] = ids.map((id, i) => ({ label: labels[i], on: isHome(s.get(id)!.state), id, to: id, detail: cap(whereabouts(s.get(id)!)) }));
      const home = segs.filter((x) => x.on), away = ids.filter((id) => !isHome(s.get(id)!.state));
      const one = ids.length === 1 ? s.get(ids[0])! : null;
      return { kind: 's', segs, ids, big: one ? cap(whereabouts(one)) : `${home.length} of ${ids.length}`,
        label: one ? `${labels[0]} · for ${forText(Date.now() - Date.parse(one.last_changed))}` : away.length ? listOf(away.map((id) => `${nameOf(s, id)} ${whereabouts(s.get(id)!)}`)) : 'all home',
        tracks: ids.map((id) => ({ id, on: isHome, now: isHome(s.get(id)!.state) })) };
    } },
    { key: 'where', name: 'Where', glyph: g.pin, read: (s) => {
      // Where they are: the map around home, everyone with a position on it, the zones dim; the band is how many are home.
      const ids = people(s).filter((id) => geo(s.get(id)));
      const home = homeAt(s) ?? geo(s.get(ids[0]));
      if (!ids.length || !home) return null;
      const far = ids.map((id) => ({ id, km: distanceKm(home, geo(s.get(id))!) })).sort((a, b) => b.km - a.km);
      const away = ids.filter((id) => !isHome(s.get(id)!.state));
      return { kind: 'p', v: (ids.length - away.length) / ids.length, ids, big: away.length ? `${away.length} away` : ids.length === 1 ? 'At home' : 'All home',
        label: away.length ? `${nameOf(s, far[0].id)} · ${kmText(far[0].km)} from home` : listOf(ids.map((id) => nameOf(s, id))),
        map: { center: home, zoom: zoomFor(home.lat, far[0].km * 2.6 + 0.4), plots: [{ ...home, label: 'Home', size: 0.3 }, ...zonePlots(s), ...ids.map((id) => personPlot(s, id))] } };
    } },
  ] },

  { id: 'openings', title: 'Openings', channels: [
    { key: 'living', name: 'Living room window', glyph: g.window, read: coverDial((s) => positional(s, 0)) },
    { key: 'hall', name: 'Hall window', glyph: g.window, read: coverDial((s) => positional(s, 1)) },
    { key: 'garage', name: 'Garage door', glyph: g.garage, read: (s) => {
      const id = first(s, 'cover', ['cover.garage_door'], isClass('garage')), e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const open = e.state !== 'closed';
      const night = s.get('sun.sun')?.state === 'below_horizon';
      return { kind: 's', ids: [id], big: coverState[e.state] ? cap(coverState[e.state]) : e.state,
        label: night ? 'it is night' : 'it is daytime',
        segs: [{ label: nameOf(s, id), on: !open, id, act: busy(e.state) ? undefined : call('cover', open ? 'close_cover' : 'open_cover', id) }],
        alert: open && night ? { level: 1, big: busy(e.state) ? cap(coverState[e.state]) : 'Open', label: 'at night', fail: [0],
          why: e.state === 'closing' ? 'The garage door is closing' : 'The garage door was left open at night', busy: busy(e.state),
          verb: 'Close', acts: [call('cover', 'close_cover', id)] } : undefined };
    } },
    { key: 'irrigation', name: 'Irrigation', glyph: g.sprout, read: (s) => {
      const ids = ofDomain(s, 'valve');
      if (!ids.length) return null;
      const segs = switches(ids, s, (e) => ['open', 'opening'].includes(e.state),
        (e) => busy(e.state) ? undefined : call('valve', e.state === 'open' ? 'close_valve' : 'open_valve', e.entity_id));
      const on = segs.filter((x) => x.on);
      return { kind: 's', segs, ids: ids, big: on.length ? `${on.length} watering` : 'Closed',
        label: on.length ? list(on.map((x) => x.label)) : `${ids.length} valves` };
    } },
  ] },

  { id: 'media', title: 'Media', channels: [
    { key: 'playing', name: 'Playing', glyph: g.play, read: (s) => {
      const ids = known(s, 'media_player',
        ['media_player.living_room', 'media_player.kitchen', 'media_player.bedroom', 'media_player.lounge_room', 'media_player.walkman']).slice(0, 8);
      if (!ids.length) return null;
      const segs = switches(ids, s, (e) => e.state === 'playing',
        (e) => ['playing', 'paused'].includes(e.state) ? call('media_player', 'media_play_pause', e.entity_id) : undefined);
      const on = segs.filter((x) => x.on);
      const lead = on.length ? s.get(on[0].id)! : undefined;
      const title = String(lead?.attributes.media_title ?? '');
      const art = picture(lead);
      return { kind: 's', segs, ids: ids, big: on.length ? `${on.length} of ${segs.length}` : 'Silence',
        label: on.length ? (title.length > 26 ? `${title.slice(0, 25)}…` : title || list(on.map((x) => x.label))) : 'all paused',
        image: art && lead ? { src: art, alt: title || nameOf(s, lead.entity_id), id: lead.entity_id } : undefined };
    } },
    { key: 'source', name: 'Source', glyph: g.box, read: (s) => {
      // What a player plays from (TV inputs, a receiver's sources): one of its source_list.
      const id = first(s, 'media_player', ['media_player.lounge_room'], (e) => strs(e, 'source_list').length > 1);
      const e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const all = strs(e, 'source_list'), current = String(e.attributes.source ?? '');
      if (all.length < 2) return null;
      const options = all.map((src) => ({ label: src, on: src === current, id,
        act: src === current ? undefined : call('media_player', 'select_source', id, { source: src }) }));
      // The ring takes eight names; the detail scrolls through all of them.
      return { kind: 'c', segs: options.slice(0, 8), list: options, ids: [id], big: current || 'None', label: nameOf(s, id).toLowerCase(), name: `${nameOf(s, id)} source` };
    } },
    { key: 'volume', name: 'Living room volume', glyph: g.volume, read: (s) => {
      const id = first(s, 'media_player', ['media_player.living_room'], (e) => attr(e, 'volume_level') != null);
      const e = id ? s.get(id) : undefined;
      if (!id || !e || attr(e, 'volume_level') == null) return null;
      const pct = Math.round(attr(e, 'volume_level')! * 100), where = nameOf(s, id).toLowerCase();
      return { kind: 'p', v: pct / 100, ids: [id], big: `${pct}%`, label: e.state === 'playing' ? `${where}, playing` : where,
        name: ownName(s, id) && `${nameOf(s, id)} volume`,
        dial: { min: 0, max: 100, step: 5, unit: '%', label: 'volume', value: pct, id,
          set: (x) => call('media_player', 'volume_set', id, { volume_level: x / 100 }) } };
    } },
  ] },

  { id: 'energy', title: 'Energy', channels: [
    { key: 'power', name: 'Power', glyph: g.bolt, read: (s) => {
      // The first id is a simulated sensor of the local test installation.
      const id = first(s, 'sensor', ['sensor.consumo_simulado', 'sensor.power_consumption', 'sensor.power_grid'],
        (e) => e.attributes.unit_of_measurement === 'W');
      if (!id) return null;
      const w = Number(s.get(id)!.state), capW = 3000;
      return { kind: 'p', v: clamp(w / capW), ids: [id], big: `${num(w, 0)} W`, label: `of ${num(capW)} W`, history: id, month: meterOf(s),
        alert: w > 2000 ? { level: 1, big: `${num(w, 0)} W`, label: 'high consumption', why: 'Consumption went past 2000 W',
          verb: 'Got it', acts: [] } : undefined };
    } },
    { key: 'co', name: 'Carbon monoxide', glyph: g.air, read: (s) => {
      const id = first(s, 'sensor', ['sensor.carbon_monoxide'], isClass('carbon_monoxide')), e = id ? s.get(id) : undefined;
      if (!id || !e) return null;
      const ppm = Number(e.state);
      // 35 ppm: the EPA's one-hour limit; 100 ppm is already dangerous.
      const level = ppm >= 100 ? 2 : ppm >= 35 ? 1 : 0;
      return { kind: 'p', v: clamp(ppm / 150), ids: [id], big: `${num(ppm, 0)} ppm`, label: 'carbon monoxide', history: id,
        alert: level ? { level: level as 1 | 2, big: `${num(ppm, 0)} ppm`, label: 'carbon monoxide',
          why: level === 2 ? 'Dangerous carbon monoxide: ventilate and leave' : 'Carbon monoxide above 35 ppm', verb: 'Got it', acts: [] }
          : undefined };
    } },
    { key: 'water', name: 'Hot water', glyph: g.tap,
      read: thermostat((s) => first(s, 'water_heater', ['water_heater.demo_water_heater']), 'water_heater',
        (e) => `target ${num(attr(e, 'temperature')!)}° · ${String(e.attributes.operation_mode ?? e.state)}`) },
  ] },

  { id: 'scenes', title: 'Scenes', channels: [
    { key: 'scenes', name: 'Scenes', glyph: g.spark, read: (s) => {
      // A scene is a preset of several entities at once (the lights for a movie,
      // the morning): activating one sets them all. Its state is when it was
      // last activated, so the latest is the one on. In a room, a scene counts
      // when it, or something it sets, is in the area.
      const own = ofDomain(s, 'scene');
      const sets = (id: string) => strs(s.get(id)!, 'entity_id');
      const ids = areaSet ? [...new Set([...own, ...[...s.keys()].filter((id) => id.startsWith('scene.') && visible(id) && sets(id).some(inAreas))])].sort() : own;
      if (!ids.length) return null;
      const at = (id: string) => Date.parse(s.get(id)!.state);
      const latest = ids.filter((id) => !Number.isNaN(at(id))).sort((a, b) => at(b) - at(a))[0];
      const options = ids.map((id) => ({ label: nameOf(s, id), on: id === latest, id, act: call('scene', 'turn_on', id) }));
      // The ring takes eight names; the detail scrolls through all of them.
      return { kind: 'c', segs: options.slice(0, 8), list: options, ids: ids, big: latest ? nameOf(s, latest) : 'None',
        label: latest ? `last of ${ids.length}` : `${ids.length} ${ids.length === 1 ? 'scene' : 'scenes'}`,
        events: latest ? [{ id: latest, text: `${nameOf(s, latest)} activated` }] : undefined };
    } },
  ] },
  { id: 'maintenance', title: 'Maintenance', channels: [
    { key: 'updates', name: 'Updates', glyph: g.box, read: (s) => {
      const ids = ofDomain(s, 'update');
      if (!ids.length) return null;
      // On = up to date; the pending one is the one painted.
      const segs = ids.map((id) => ({ label: String(s.get(id)!.attributes.title ?? nameOf(s, id)), on: true, id }));
      const pending = ids.filter((id) => s.get(id)!.state === 'on');
      const running = ids.find((id) => s.get(id)!.attributes.in_progress);
      if (running) {
        const p = s.get(running)!.attributes.update_percentage as number | null;
        return { kind: 'p', v: (p ?? 0) / 100, ids: ids, big: p != null ? `${num(p, 0)}%` : 'Installing',
          label: String(s.get(running)!.attributes.title ?? nameOf(s, running)) };
      }
      const installable = pending.filter((id) => (Number(s.get(id)!.attributes.supported_features) & 1) === 1);
      return { kind: 's', segs, ids: ids, big: pending.length ? `${pending.length} pending` : 'Up to date',
        label: `${ids.length - pending.length} of ${ids.length} up to date`,
        alert: pending.length ? { level: 1, big: `${pending.length} new`, label: 'updates', fail: pending.map((id) => ids.indexOf(id)),
          why: installable.length ? `${segs[ids.indexOf(installable[0])].label} has a new version` : 'There are new versions',
          verb: installable.length ? 'Install' : 'Got it',
          acts: installable.length ? [call('update', 'install', installable[0])] : [] } : undefined };
    } },
    { key: 'vacuums', name: 'Vacuums', glyph: g.robot, read: (s) => {
      const ids = ofDomain(s, 'vacuum');
      if (!ids.length) return null;
      const segs = ids.map((id, i) => {
        const e = s.get(id)!, f = Number(e.attributes.supported_features);
        const cleaning = e.state === 'cleaning';
        const act = cleaning ? (f & 16 ? call('vacuum', 'return_to_base', id) : f & 8 ? call('vacuum', 'stop', id) : undefined)
          : f & 8192 ? call('vacuum', 'start', id) : undefined;
        return { label: `Floor ${i}`, on: cleaning, id, act };
      });
      const on = segs.filter((x) => x.on);
      return { kind: 's', segs, ids: ids, big: on.length ? `${on.length} cleaning` : 'Docked',
        label: on.length ? list(on.map((x) => x.label)) : `${ids.length} vacuums` };
    } },
    { key: 'batteries', name: 'Batteries', glyph: g.battery, read: (s) => {
      // Battery sensors in %, as Home Assistant's Maintenance view: low under 20.
      const all = ofDomain(s, 'sensor', undefined, true).filter((id) => isClass('battery')(s.get(id)!) && !Number.isNaN(Number(s.get(id)!.state)));
      if (!all.length) return null;
      const pct = (id: string) => Number(s.get(id)!.state);
      const byLevel = [...all].sort((a, b) => pct(a) - pct(b));
      const low = byLevel.filter((id) => pct(id) < LOW_BATTERY);
      const ids = [...low, ...all.filter((id) => !low.includes(id))].slice(0, 8);
      const segs = ids.map((id) => ({ label: `${nameOf(s, id)} ${num(pct(id), 0)}%`, on: pct(id) >= LOW_BATTERY, id }));
      return { kind: 's', segs, ids: all, big: low.length ? `${low.length} low` : `${num(pct(byLevel[0]), 0)}% lowest`,
        label: low.length ? list(low.map((id) => whereIs(s, id))) : `${all.length} batteries`,
        alert: low.length ? { level: 1, big: `${num(pct(low[0]), 0)}%`, label: whereIs(s, low[0]).toLowerCase(),
          fail: low.map((id) => ids.indexOf(id)).filter((i) => i >= 0),
          why: low.length > 1 ? `${low.length} batteries under ${LOW_BATTERY}%: ${list(low.map((id) => nameOf(s, id)))}`
            : `${nameOf(s, low[0])}${/battery/i.test(nameOf(s, low[0])) ? '' : ' battery'} at ${num(pct(low[0]), 0)}%`, verb: 'Got it', acts: [] } : undefined };
    } },
    { key: 'problems', name: 'Problems', glyph: g.warn, read: (s) => {
      // Devices that report a problem (binary sensors of class problem or battery).
      const all = ofDomain(s, 'binary_sensor', undefined, true).filter((id) => ['problem', 'battery'].includes(String(s.get(id)!.attributes.device_class)));
      if (!all.length) return null;
      const on = all.filter((id) => s.get(id)!.state === 'on');
      const ids = [...on, ...all.filter((id) => !on.includes(id))].slice(0, 8);
      const segs = ids.map((id) => ({ label: nameOf(s, id), on: s.get(id)!.state !== 'on', id }));
      return { kind: 's', segs, ids: all, big: on.length ? `${on.length} ${on.length === 1 ? 'problem' : 'problems'}` : 'No problems',
        label: on.length ? list(on.map((id) => whereIs(s, id))) : `${all.length} watched`,
        alert: on.length ? { level: 1, big: 'Problem', label: list(on.map((id) => nameOf(s, id))),
          fail: on.map((id) => ids.indexOf(id)).filter((i) => i >= 0),
          why: `${list(on.map((id) => whereIs(s, id)))} ${on.length === 1 ? 'reports' : 'report'} a problem`, verb: 'Got it', acts: [] } : undefined };
    } },
    { key: 'repairs', name: 'Repairs', glyph: g.wrench, read: () => {
      // What Home Assistant itself asks to look at (Settings › Repairs), by integration.
      const issues = reg.issues.filter((i) => !i.ignored);
      if (!issues.length) return null;
      const rank: Record<string, 1 | 2> = { critical: 2, error: 1, warning: 1 };
      const level = Math.max(...issues.map((i) => rank[i.severity ?? 'warning'] ?? 1)) as 1 | 2;
      const domains = [...new Set(issues.map((i) => i.domain))];
      const segs = domains.slice(0, 8).map((d) => ({ label: d, on: true, id: '' }));
      const n = issues.length, word = n === 1 ? 'repair' : 'repairs';
      return { kind: 's', segs, ids: [], big: `${n} ${word}`, label: list(domains),
        alert: { level, big: `${n} ${word}`, label: list(domains), fail: segs.map((_, i) => i),
          why: `Home Assistant has ${n} ${word} waiting: ${list(domains)}`, verb: 'Got it', acts: [] } };
    } },
    { key: 'notices', name: 'Notices', glyph: g.bell, read: () => {
      // What Home Assistant left under its bell: a line each, the latest first; tapping one dismisses it.
      const notices = [...reg.notices].sort((a, b) => b.at - a.at);
      if (!notices.length) return null;
      const rows: Seg[] = notices.map((n) => ({ label: n.title || 'Notice', detail: plain(n.message), on: true, id: `notice:${n.id}`, act: dismiss(n) }));
      const n = notices.length;
      return { kind: 's', segs: rows.slice(0, 8), list: rows, ids: [], big: `${n} ${n === 1 ? 'notice' : 'notices'}`,
        label: notices.slice(0, 3).map((x) => x.title || plain(x.message)).join(' · ') };
    } },
  ] },

  { id: 'assist', title: 'Assist', whole: true, channels: [
    { key: 'ask', name: 'Assist', glyph: g.chat, read: (s, u) => {
      // A question or an order to the home, answered by Assist's agent: the
      // questions every installation understands on the ring, "Ask…" for the
      // viewer's own words in their language, the latest answer in the face;
      // the detail keeps the last ones.
      if (!u.assist) return null;
      const quick = QUICK.filter((q) => q.when(s)).slice(0, QUICK_ON_RING);
      const last = u.assist.answers[0];
      const segs: Seg[] = [...quick.map((q) => ({ label: q.label, on: last?.text === q.text, id: ASSIST, act: ask(q.text, 'en') })),
        { label: 'Ask…', on: !!last && !quick.some((q) => q.text === last.text), id: ASSIST, act: { ...ask('', u.assist.language), asks: 'words' as const, hint: 'Ask anything about your home' } }];
      // The transcript: each question with its answer under it, an order carried out with a check.
      const rows: Seg[] = u.assist.answers.map((a) => ({ label: a.text, detail: wordsOf(a), on: a.kind === 'done', id: ASSIST }));
      // The face: the answer big when it is short, with the question under it; otherwise its kind, with the words under.
      const big = last ? bigOf(last) : 'Ask';
      return { kind: 'c', segs, ids: [ASSIST], big, label: !last ? 'tap a question, or ask in your words' : big === wordsOf(last) ? last.text : shorten(wordsOf(last), 64),
        list: rows.length ? rows : undefined };
    } },
  ] },
];

// Each channel reads with its source's registry, the chosen areas and the
// viewer's picks at hand (see `reg`, `areaSet`, `current`); what it ended up
// following, and what else it could, comes back on the reading.
const inContext = (sys: PulseSystem): PulseSystem => ({
  ...sys,
  channels: sys.channels.map((ch) => ({ ...ch, read: (s: States, ctx: Context) => {
    reg = ctx.reg;
    areaSet = !sys.whole && ctx.areas?.length ? new Set(ctx.areas) : null;
    current = { key: `${sys.id}/${ch.key}`, picks: ctx.picks ?? {}, claimed: false, choice: undefined, choices: undefined };
    const r = ch.read(s, ctx);
    if (r && current.choice) { r.choice = current.choice; if (current.choices && current.choices.length > 1) r.choices = current.choices; }
    return r;
  } })),
});
export const systems: PulseSystem[] = SYSTEMS.map(inContext);

// ─── Rooms: the other axis of the home ──────────────────────────────
// A room is a system too: its channels are the channels of the systems, read
// within that area only. What has no area is the room NO_AREA. A room's
// channel keeps the key `system/channel`, so the viewer's picks and hidden
// channels (kept by system) hold on both axes. Floors order the rooms.
export const ROOM = 'room:';
export const isRoom = (id: string) => id.startsWith(ROOM);
export const roomArea = (id: string) => id.slice(ROOM.length);
export function roomSystems(registry: Registry, within: string[], hidden: (system: string, channel: string) => boolean, noAreaTitle: string): PulseSystem[] {
  const level = (a: { floor_id?: string | null }): number => (a.floor_id ? registry.floors.get(a.floor_id)?.level : null) ?? Number.MAX_SAFE_INTEGER;
  const areas = [...registry.areas.values()].sort((a, b) => level(a) - level(b) || a.name.localeCompare(b.name));
  const rooms = [...areas.map((a) => ({ area: a.area_id, title: a.name })), { area: NO_AREA, title: noAreaTitle }];
  const chosen = systems.filter((sys) => within.includes(sys.id) && !sys.whole);
  return rooms.map((room) => ({
    id: ROOM + room.area, title: room.title,
    channels: chosen.flatMap((sys) => sys.channels.filter((ch) => !hidden(sys.id, ch.key)).map((ch) => ({
      key: `${sys.id}/${ch.key}`, name: ch.name, glyph: ch.glyph,
      read: (s: States, ctx: Context) => {
        const r = ch.read(s, { ...ctx, areas: [room.area] });
        // What is not about entities (the repairs) is the home's, not a room's.
        return r && r.ids.length ? r : null;
      },
    }))),
  }));
}

// ─── Objects: a person, a camera ──────────────────────────────────────
// A person (or a tracked device) as an object of their own: where they are
// and for how long, their picture in the face, the map, their phone's battery.
export function personObject(s: States, id: string): PulseSystem | null {
  if (!/^(person|device_tracker)\./.test(id) || !s.has(id)) return null;
  const read = (fn: (e: HassState, s: States) => Reading | null) => (s: States) => { const e = s.get(id); return e ? fn(e, s) : null; };
  const name = nameOf(s, id);
  return { id, title: name, whole: true, channels: [
    { key: 'status', name: 'Status', glyph: g.person, read: read((e) => {
      const pic = picture(e);
      return { kind: 'p', v: isHome(e.state) ? 1 : 0, ids: [id], big: cap(whereabouts(e)), label: `for ${forText(Date.now() - Date.parse(e.last_changed))}`,
        image: pic ? { src: pic, alt: name, id } : undefined, tracks: [{ id, on: isHome, now: isHome(e.state) }] };
    }) },
    { key: 'where', name: 'Where', glyph: g.pin, read: read((e, s) => {
      // On the map: around them when home, between home and them when away, with the home's zones dim.
      const at = geo(e), home = homeAt(s);
      if (!at) return null;
      const d = home ? distanceKm(home, at) : null, away = d != null && d >= 0.2;
      return { kind: 'p', v: d == null ? 1 : clamp(1 - d / 50), ids: [id], big: d == null ? cap(whereabouts(e)) : away ? kmText(d) : 'At home',
        label: away ? `from home · ${whereabouts(e)}` : whereabouts(e),
        map: { center: away ? midpoint(home!, at) : at, zoom: away ? zoomFor(midpoint(home!, at).lat, d! * 1.5) : 15,
          plots: [...(home ? [{ ...home, label: 'Home', size: 0.3 }] : []), ...zonePlots(s), { ...at, label: `${name} · ${whereabouts(e)}`, id, size: 0.8 }] } };
    }) },
    { key: 'phone', name: 'Phone', glyph: g.battery, read: read((e, s) => {
      // The battery of what tracks them: the tracker's own, or the best among the person's trackers.
      const levels = [e, ...strs(e, 'device_trackers').map((tr) => s.get(tr))].flatMap((tr) => { const b = tr && (attr(tr, 'battery_level') ?? attr(tr, 'battery')); return b == null ? [] : [b]; });
      if (!levels.length) return null;
      const b = Math.max(...levels);
      return { kind: 'p', v: clamp(b / 100), ids: [id], big: `${num(b, 0)}%`, label: 'phone battery',
        alert: b < LOW_BATTERY ? { level: 1, big: `${num(b, 0)}%`, label: 'phone battery', key: `${id}/battery`, why: `${name}'s phone is at ${num(b, 0)}%`, verb: 'Got it', acts: [] } : undefined };
    }) },
  ] };
}

// A camera as an object of its own: what it sees, live, and what the sensors
// in its area noticed today.
export function cameraObject(s: States, id: string): PulseSystem | null {
  if (!id.startsWith('camera.') || !s.has(id)) return null;
  const read = (fn: (e: HassState, s: States) => Reading | null) => (s: States) => { const e = s.get(id); return e ? fn(e, s) : null; };
  const name = nameOf(s, id);
  return { id, title: name, whole: true, channels: [
    { key: 'view', name: 'View', glyph: g.eye, read: read((e) => {
      const src = picture(e);
      return { kind: 'p', v: ['streaming', 'recording'].includes(e.state) ? 1 : 0, ids: [id], big: cameraState[e.state] ?? cap(e.state), label: placeOf(id)?.toLowerCase() ?? 'camera',
        image: src ? { src, alt: name, id, live: true } : undefined };
    }) },
    { key: 'around', name: 'Around it', glyph: g.eye, read: read((_e, s) => {
      const area = areaOf(id);
      if (!area) return null;
      const ids = scan(s, 'binary_sensor', true).filter((b) => areaOf(b) === area && [...SAFETY, ...OPENINGS, ...MOTION].includes(String(s.get(b)!.attributes.device_class)));
      if (!ids.length) return null;
      const on = (b: string) => s.get(b)!.state === 'on', names = labelsOf(s, ids), active = ids.filter(on);
      const cls = (b: string) => String(s.get(b)!.attributes.device_class);
      return { kind: 's', segs: ids.map((b, i) => ({ label: names[i], on: on(b), id: b })), ids,
        big: active.length ? (SAFETY.includes(cls(active[0])) ? SAFETY_WORDS[cls(active[0])] : MOTION.includes(cls(active[0])) ? 'Motion' : 'Open') : 'Still',
        label: active.length ? list(active.map((b) => nameOf(s, b))) : `${ids.length} sensors`,
        tracks: ids.map((b) => ({ id: b, on: isOn, now: on(b), tone: SAFETY.includes(cls(b)) ? 'critical' as const : 'warn' as const })) };
    }) },
  ] };
}

// The object of a thing named on a ring or in a list, read in the context the systems are.
export const objectOf = (s: States, id: string): PulseSystem | null => {
  const sys = personObject(s, id) ?? cameraObject(s, id);
  return sys && inContext(sys);
};
