import { listOf, num, type Alert, type GeoPlot, type Reading, type Seg, type TrackSpec } from '@zumer/pulse';
import { distanceKm, forText, hourText, zoomFor } from '../shared.ts';
import { geoOf, hsbOf, numOf, whenOf, type Command, type Item, type Items } from './source.ts';
import { t } from './strings.ts';

// Every channel is read from the items' live states through openHAB's own
// semantic model: a Location (a floor, a room, the garden), an Equipment in it
// (a light, the HVAC of a room, a window, a lock, a speaker, the inverter), the
// Points of an equipment (a measurement, a setpoint, a switch, a status, an
// alarm) and the property each point is about (temperature, power, opening…).
// No item is named and there are no hand-written states: a home with no
// speakers has no Media, one with a smoke detector gets its alarm. An alert is
// a rule over the data; its action a command to an item. Floors and rooms are
// the board's other axis.

export type Context = {
  rooms?: string[] | null;          // only what is in these locations counts; null or absent: the whole home
  picks?: Record<string, string>;   // 'system/channel' → the item the viewer chose for it
};
export type Channel = { key: string; name: string; glyph: string; read: (h: House, ctx: Context) => Reading | null };
export type System = { id: string; title: string; channels: Channel[] };

const g = {
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  thermo: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z',
  flame: 'M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5 1-2 1-5 0-9z',
  fan: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M12 10c0-4 1-7 4-7 2 0 2 3 0 5 M14 12c4 0 7 1 7 4 0 2-3 2-5 0 M12 14c0 4-1 7-4 7-2 0-2-3 0-5 M10 12c-4 0-7-1-7-4 0-2 3-2 5 0',
  window: 'M4 4h16v16H4z M12 4v16 M4 12h16',
  door: 'M6 3h12v18H6z M15 12h.01 M6 21h12',
  blinds: 'M3 4h18 M5 4v12h14V4 M5 8h14 M5 12h14 M12 16v5',
  lock: 'M6 11h12v10H6z M8 11V8a4 4 0 0 1 8 0v3 M12 15v2',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6 M5 21h14v-3H5z M12 3v2 M4 7l1.5 1 M20 7l-1.5 1',
  play: 'M7 4l13 8-13 8z',
  volume: 'M4 9h4l5-4v14l-5-4H4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11',
  box: 'M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  battery: 'M3 8h15v8H3z M18 10h2v4h-2z M6 11v2',
  meter: 'M12 3a9 9 0 0 0-9 9c0 2.5 1 4.7 2.6 6.4h12.8A9 9 0 0 0 12 3z M12 12l4-5',
  cloud: 'M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .5 9z',
  warn: 'M10.3 4.5L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  pin: 'M12 21s-7-6.3-7-11.5a7 7 0 0 1 14 0C19 14.7 12 21 12 21z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  home: 'M3 11l9-8 9 8 M5 10v10h14V10 M10 20v-6h4v6',
};

// ─── openHAB's semantic model, as the items carry it ───
export const sem = (i: Item) => i.semantics?.value ?? '';
const cfg = (i: Item) => i.semantics?.config ?? {};
// Of a class, or of one under it ('Equipment_LightSource' takes a Downlight).
export const is = (i: Item | undefined, cls: string) => !!i && (sem(i) === cls || sem(i).startsWith(`${cls}_`));
const about = (i: Item, prop: string) => { const p = cfg(i).relatesTo ?? ''; return p === prop || p.startsWith(`${prop}_`); };

// The home as the model reads it: the items, and the model's indexes over them.
// The items are read live from the map (the source replaces an item when its
// state changes), so the indexes hold names, never items.
export type House = {
  items: Items;
  timezone?: string;                // the home's, for the hours it tells
  readonly all: Item[];             // every item as it is now
  location: Map<string, string>;    // an item → the location it is in (a room, a floor, the garden)
  parent: Map<string, string>;      // a location → the location it is part of (a room → its floor)
  equipment: Map<string, string>;   // a point → its equipment
  points: Map<string, string[]>;    // an equipment → its points
  want?: (name: string) => void;    // tells the source the viewer is looking at an item (an Image's picture is read then)
};
// The room of what is in no location (the inverter, the weather, the people).
export const NO_ROOM = '';
export function houseOf(items: Items, timezone?: string, want?: (name: string) => void): House {
  const all = [...items.values()];
  const location = new Map<string, string>(), parent = new Map<string, string>(), equipment = new Map<string, string>(), points = new Map<string, string[]>();
  const firstGroup = (i: Item, cls: string) => i.groups.find((gr) => is(items.get(gr), cls));
  for (const i of all) {
    if (is(i, 'Location')) { const up = cfg(i).isPartOf ?? firstGroup(i, 'Location'); if (up) parent.set(i.name, up); }
    else if (is(i, 'Point')) { const eq = cfg(i).isPointOf ?? firstGroup(i, 'Equipment'); if (eq) { equipment.set(i.name, eq); points.set(eq, [...(points.get(eq) ?? []), i.name]); } }
  }
  // Where something is: where it says, or where what it is part of (or a point of) is, or the location among its groups.
  const place = (i: Item, seen = new Set<string>()): string | undefined => {
    if (location.has(i.name)) return location.get(i.name);
    if (seen.has(i.name)) return undefined;
    seen.add(i.name);
    const c = cfg(i);
    let at = c.hasLocation ?? firstGroup(i, 'Location');
    const up = !at ? (c.isPartOf ?? c.isPointOf ?? equipment.get(i.name)) : undefined;
    if (!at && up) { const u = items.get(up); at = u ? place(u, seen) : undefined; }
    if (at) location.set(i.name, at);
    return at;
  };
  for (const i of all) if (!is(i, 'Location')) place(i);
  return { items, timezone, want, get all() { return [...items.values()]; }, location, parent, equipment, points };
}

// An item's words: its label, or its name made into words ('LivingRoom_HVAC_Temperature' → 'Living Room HVAC Temperature').
export const humanize = (name: string) => name.replace(/^g(?=[A-Z])/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
export const nameOf = (h: House, name: string) => h.items.get(name)?.label || humanize(name);
export const placeOf = (h: House, name: string) => { const at = h.location.get(name); return at ? nameOf(h, at) : undefined; };
const FLOOR = 'Location_Indoor_Floor';
// The floor a location is on: itself when it is one, else the one it is part of, up the tree.
export const floorOf = (h: House, loc: string): string | undefined => {
  let at: string | undefined = loc;
  for (let n = 0; at && n < 8; n++) { if (is(h.items.get(at), FLOOR)) return at; at = h.parent.get(at); }
  return undefined;
};
const inRooms = (h: House, ctx: Context, name: string) => !ctx.rooms || ctx.rooms.includes(h.location.get(name) ?? NO_ROOM);
// The equipments of a class within the rooms in force, by name.
const equipments = (h: House, ctx: Context, cls: string) => h.all.filter((i) => is(i, cls) && inRooms(h, ctx, i.name)).sort((a, b) => nameOf(h, a.name).localeCompare(nameOf(h, b.name)));
const pointsOf = (h: House, eq: string) => (h.points.get(eq) ?? []).map((n) => h.items.get(n)).filter((p): p is Item => !!p);
const point = (h: House, eq: string, cls: string, prop?: string, type?: RegExp) => pointsOf(h, eq).find((p) => is(p, cls) && (!prop || about(p, prop)) && (!type || type.test(p.type)));
const named = (pts: Item[], what: RegExp, type?: RegExp) => pts.find((p) => (!type || type.test(p.type)) && what.test(`${p.name} ${p.label}`));
const val = (i?: Item) => (i ? numOf(i.state) : null);
export const unitOf = (i: Item) => i.unit ?? /\S\s+(\S+)$/.exec(i.state)?.[1] ?? '';
// Power in watts and energy in kWh, whatever the unit an item reports in.
const watts = (i?: Item) => { const v = val(i); if (v == null || !i) return null; const u = unitOf(i); return u === 'kW' ? v * 1000 : u === 'MW' ? v * 1e6 : v; };
const kwh = (i?: Item) => { const v = val(i); if (v == null || !i) return null; const u = unitOf(i); return u === 'Wh' ? v / 1000 : u === 'MWh' ? v * 1000 : v; };
const kW = (w: number) => (Math.abs(w) >= 1000 ? `${num(w / 1000, 1)} kW` : `${num(w, 0)} W`);
const on = (i?: Item) => i?.state === 'ON';
const isOn = (st: string) => st === 'ON';
const isOpen = (st: string) => st === 'OPEN';
const cmd = (item: string, command: string): Command => ({ ids: [item], kind: 'command', item, command });
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const lower = (s: string) => s.toLowerCase();
const got = (level: 1 | 2, big: string, label: string, why: string, key = label): Alert => ({ level, big, label, why, key, verb: t.gotIt, acts: [] });
// A channel that follows one thing (a thermostat, a light, a player): the
// viewer's pick when it is among the candidates, else the one preferred, else the first.
const follow = (ctx: Context, key: string, names: string[], prefer: (n: string) => boolean = () => false) => {
  const p = ctx.picks?.[key];
  return p && names.includes(p) ? p : names.find(prefer) ?? names[0];
};
const following = (r: Reading, chosen: string, names: string[]): Reading => ({ ...r, choice: chosen, ...(names.length > 1 ? { choices: names } : {}) });
// Night: the sun below the horizon, when the home computes it (an angle of the sun's); unknown is day.
const sunPoint = (h: House, what: RegExp) => h.all.find((i) => i.type === 'Number:Angle' && what.test(`${i.name} ${i.label}`) && /sun/i.test(`${i.name} ${h.equipment.get(i.name) ?? ''} ${i.groups.join(' ')}`));
const isNight = (h: House) => { const e = val(sunPoint(h, /elevation/i)); return e != null && e < 0; };

// ─── Lights ───
const LIGHT = /^(Switch|Dimmer|Color)$/;
const lightOn = (st: string) => st === 'ON' || (hsbOf(st)?.[2] ?? numOf(st) ?? 0) > 0;
const lit = (i: Item) => lightOn(i.state);
const lightTint = (i: Item) => { const hsb = i.type === 'Color' ? hsbOf(i.state) : null; return hsb && hsb[2] > 0 && hsb[1] > 0 ? `hsl(${Math.round(hsb[0])} 100% ${Math.round(100 - hsb[1] / 2)}%)` : undefined; };
// The lights: a light source that is an item itself (a Switch, a Dimmer, a Color), or the switch point of one that is a group.
const lights = (h: House, ctx: Context): Item[] => equipments(h, ctx, 'Equipment_LightSource')
  .flatMap((e) => (LIGHT.test(e.type) ? [e] : [point(h, e.name, 'Point_Control', undefined, LIGHT)].filter((p): p is Item => !!p)));
const tracksOf = (segs: Seg[], isOn: (st: string) => boolean): TrackSpec[] => segs.map((x) => ({ id: x.id, on: isOn, now: x.on, act: x.act }));

// ─── Climate: the HVAC of each room ───
type Hvac = { eq: Item; temp?: Item; set?: Item; heat?: Item; cool?: Item; room?: string };
const hvacs = (h: House, ctx: Context): Hvac[] => equipments(h, ctx, 'Equipment_HVAC').map((eq) => ({ eq,
  temp: point(h, eq.name, 'Point_Measurement', 'Property_Temperature'), set: point(h, eq.name, 'Point_Setpoint', 'Property_Temperature'),
  heat: point(h, eq.name, 'Point_Control', 'Property_Heating', /^Switch$/), cool: point(h, eq.name, 'Point_Control', 'Property_Airconditioning', /^Switch$/),
  room: h.location.get(eq.name) })).filter((x) => x.temp || x.set || x.heat || x.cool);
const roomOf = (h: House, x: { eq: Item; room?: string }) => (x.room ? nameOf(h, x.room) : nameOf(h, x.eq.name));
// The windows: a Window equipment's open state (a Contact among its points, or the equipment itself when it is one).
type Opening = { eq: Item; contact: Item };
const openings = (h: House, ctx: Context, cls: string): Opening[] => equipments(h, ctx, cls)
  .map((eq) => ({ eq, contact: eq.type === 'Contact' ? eq : point(h, eq.name, 'Point_Status', 'Property_Opening') ?? point(h, eq.name, 'Point_Status', undefined, /^Contact$/) }))
  .filter((w): w is Opening => !!w.contact);
const openWindowsIn = (h: House, room: string | undefined) => (room ? openings(h, {}, 'Equipment_Window').filter((w) => h.location.get(w.eq.name) === room && isOpen(w.contact.state)) : []);

// ─── Media: the speakers, receivers and televisions with a player ───
type Player = { eq: Item; play: Item; volume?: Item; input?: Item; title?: Item; artist?: Item; cover?: Item };
const players = (h: House, ctx: Context): Player[] => equipments(h, ctx, 'Equipment_AudioVisual').flatMap((eq) => {
  const pts = pointsOf(h, eq.name), play = pts.find((p) => p.type === 'Player');
  if (!play) return [];
  return [{ eq, play,
    volume: pts.find((p) => is(p, 'Point_Setpoint') && about(p, 'Property_SoundVolume')) ?? named(pts, /volume/i, /^(Dimmer|Number)/),
    input: pts.find((p) => is(p, 'Point_Control') && p.type === 'String' && p.options?.length),
    title: named(pts, /song|title|track/i, /^String$/), artist: named(pts, /artist/i, /^String$/), cover: pts.find((p) => p.type === 'Image') }];
});
const playing = (p: Player) => p.play.state === 'PLAY';
const isPicture = (st: string) => /^(data:image\/|https?:\/\/|\/|[\w-]+\/)/.test(st) && st !== 'NULL' && st !== 'UNDEF';

// ─── Energy: the energy management system and the inverter ───
const powersOf = (h: House, eq?: Item) => (eq ? pointsOf(h, eq.name).filter((p) => about(p, 'Property_Power') && val(p) != null) : []);
const energiesOf = (h: House, eq?: Item) => (eq ? pointsOf(h, eq.name).filter((p) => about(p, 'Property_Energy') && !is(p, 'Point_Forecast') && val(p) != null) : []);

// ─── People: whoever the home places on a map ───
const people = (h: House, ctx: Context) => h.all.filter((i) => i.type === 'Location' && geoOf(i.state) && inRooms(h, ctx, i.name));
const personName = (h: House, name: string) => nameOf(h, name).replace(/['’]s (position|location)$/i, '').replace(/\s+(position|location)$/i, '');

export const systems: System[] = [
  { id: 'lights', title: 'Lights', channels: [
    { key: 'lights', name: 'Lights', glyph: g.bulb, read: (h, ctx) => {
      const all = lights(h, ctx);
      if (!all.length) return null;
      const segs: Seg[] = all.map((l) => ({ label: nameOf(h, l.name), on: lit(l), id: l.name, act: cmd(l.name, lit(l) ? 'OFF' : 'ON') }));
      const onNow = segs.filter((x) => x.on);
      return { kind: 's', segs, ids: all.map((l) => l.name), big: `${onNow.length} of ${segs.length}`, tint: all.map(lightTint).find(Boolean),
        label: onNow.length ? listOf(onNow.slice(0, 3).map((x) => lower(x.label))) + (onNow.length > 3 ? ` and ${onNow.length - 3} more` : '') : 'all off', tracks: tracksOf(segs, lightOn) };
    } },
    { key: 'brightness', name: 'Brightness', glyph: g.sun, read: (h, ctx) => {
      // The dimmable light the viewer chose (a lit one first): its brightness as a dial, its color when it has one.
      const all = lights(h, ctx).filter((l) => /^(Dimmer|Color)$/.test(l.type)).map((l) => l.name);
      if (!all.length) return null;
      const name = follow(ctx, 'lights/brightness', all, (n) => lit(h.items.get(n)!));
      const l = h.items.get(name)!, hsb = hsbOf(l.state), pct = Math.round(l.type === 'Color' ? hsb?.[2] ?? 0 : val(l) ?? 0);
      const hue = Math.round(hsb?.[0] ?? 0), sat = Math.round(hsb?.[1] ?? 0);
      return following({ kind: 'p', v: pct / 100, ids: [name], big: pct ? `${pct}%` : 'Off', label: lower(nameOf(h, name)), name: nameOf(h, name), tint: lightTint(l),
        dial: { min: 0, max: 100, step: 5, unit: '%', label: 'brightness', value: pct, id: name, set: (x) => cmd(name, l.type === 'Color' ? `${hue},${sat},${x}` : String(x)) },
        color: l.type === 'Color' ? { hs: hsb && hsb[1] > 0 && hsb[2] > 0 ? [hue, sat] : null, id: name, set: (hh, s) => cmd(name, `${Math.round(hh)},${Math.round(s)},${pct || 100}`) } : undefined }, name, all);
    } },
  ] },

  { id: 'climate', title: 'Climate', channels: [
    { key: 'thermostat', name: 'Thermostat', glyph: g.thermo, read: (h, ctx) => {
      // The room the viewer chose (one heating first): its setpoint as the dial, its temperature as the mark, its window on the timeline.
      const all = hvacs(h, ctx).filter((x) => x.set && val(x.set) != null);
      if (!all.length) return null;
      const names = all.map((x) => x.eq.name);
      const chosen = follow(ctx, 'climate/thermostat', names, (n) => on(all.find((x) => x.eq.name === n)!.heat));
      const x = all.find((y) => y.eq.name === chosen)!, target = val(x.set)!, cur = val(x.temp), open = openWindowsIn(h, x.room);
      const mode = on(x.heat) ? 'heating' : on(x.cool) ? 'cooling' : 'idle';
      const windows = openings(h, {}, 'Equipment_Window').filter((w) => h.location.get(w.eq.name) === x.room);
      return following({ kind: 'p', v: clamp((target - 5) / 25), ids: [x.set!.name, ...[x.temp, x.heat].filter((p): p is Item => !!p).map((p) => p.name)], now: cur ?? undefined,
        big: cur != null ? `${num(cur)}°` : `${num(target)}°`, label: `target ${num(target)}° · ${mode}`, name: roomOf(h, x),
        dial: { min: 5, max: 30, step: 0.5, unit: '°', label: 'target', value: target, id: x.set!.name, set: (v) => cmd(x.set!.name, String(v)) },
        history: x.temp?.name,
        tracks: [...(x.heat ? [{ id: x.heat.name, on: isOn, now: on(x.heat) }] : []), ...windows.map((w) => ({ id: w.contact.name, on: isOpen, now: isOpen(w.contact.state), tone: 'warn' as const }))],
        events: open.map((w) => ({ id: w.contact.name, text: `${nameOf(h, w.eq.name)} open`, tone: 'warn' as const })) }, chosen, names);
    } },
    { key: 'heating', name: 'Heating', glyph: g.flame, read: (h, ctx) => {
      // A segment per room with heating, on while it heats. Rule across rooms: heating with the window open.
      const rooms = hvacs(h, ctx).filter((x) => x.heat);
      if (!rooms.length) return null;
      const segs: Seg[] = rooms.map((x) => ({ label: roomOf(h, x), on: on(x.heat), id: x.heat!.name, act: cmd(x.heat!.name, on(x.heat) ? 'OFF' : 'ON') }));
      const heating = rooms.filter((x) => on(x.heat)), wasted = heating.filter((x) => openWindowsIn(h, x.room).length);
      const alert: Alert | undefined = wasted.length ? { level: 1, big: 'Window open', label: listOf(wasted.map((x) => roomOf(h, x))), key: 'heating-window', fail: wasted.map((x) => rooms.indexOf(x)),
        why: t.heatingWindow(listOf(wasted.map((x) => lower(roomOf(h, x))))), verb: t.turnOffHeating, acts: wasted.map((x) => cmd(x.heat!.name, 'OFF')) } : undefined;
      return { kind: 's', segs, ids: rooms.map((x) => x.heat!.name), big: `${heating.length} of ${rooms.length}`,
        label: heating.length ? listOf(heating.slice(0, 3).map((x) => lower(roomOf(h, x)))) + (heating.length > 3 ? ` and ${heating.length - 3} more` : '') : 'all off', alert, tracks: tracksOf(segs, isOn) };
    } },
    { key: 'cooling', name: 'Cooling', glyph: g.fan, read: (h, ctx) => {
      const rooms = hvacs(h, ctx).filter((x) => x.cool);
      if (!rooms.length) return null;
      const segs: Seg[] = rooms.map((x) => ({ label: roomOf(h, x), on: on(x.cool), id: x.cool!.name, act: cmd(x.cool!.name, on(x.cool) ? 'OFF' : 'ON') }));
      const cooling = segs.filter((x) => x.on);
      return { kind: 's', segs, ids: rooms.map((x) => x.cool!.name), big: cooling.length ? `${cooling.length} of ${rooms.length}` : 'Off',
        label: cooling.length ? listOf(cooling.map((x) => lower(x.label))) : `${rooms.length} rooms`, tracks: tracksOf(segs, isOn) };
    } },
    { key: 'temperature', name: 'Temperature', glyph: g.thermo, read: (h, ctx) => {
      // The temperature of the room chosen (the coldest first), with its day; a room under 16° calls.
      const all = hvacs(h, ctx).filter((x) => x.temp && val(x.temp) != null);
      if (!all.length) return null;
      const names = all.map((x) => x.temp!.name), coldest = [...all].sort((a, b) => val(a.temp)! - val(b.temp)!)[0], cold = val(coldest.temp)!;
      const chosen = follow(ctx, 'climate/temperature', names, (n) => n === coldest.temp!.name);
      const x = all.find((y) => y.temp!.name === chosen)!, c = val(x.temp)!;
      return following({ kind: 'p', v: clamp((c - 10) / 20), ids: [chosen], big: `${num(c)}°`, name: roomOf(h, x), history: chosen,
        label: x === coldest ? (all.length > 1 ? 'the coldest room' : lower(roomOf(h, x))) : `coldest ${lower(roomOf(h, coldest))} at ${num(cold)}°`,
        alert: cold < 16 ? got(1, `${num(cold)}°`, 'cold', t.cold(roomOf(h, coldest), num(cold))) : undefined }, chosen, names);
    } },
  ] },

  { id: 'openings', title: 'Openings', channels: [
    { key: 'windows', name: 'Windows', glyph: g.window, read: (h, ctx) => {
      const all = openings(h, ctx, 'Equipment_Window');
      if (!all.length) return null;
      const segs: Seg[] = all.map((w) => ({ label: nameOf(h, w.eq.name), on: isOpen(w.contact.state), id: w.contact.name }));
      const open = segs.filter((x) => x.on);
      return { kind: 's', segs, ids: all.map((w) => w.contact.name), big: open.length ? `${open.length} open` : 'All closed',
        label: open.length ? listOf(open.slice(0, 3).map((x) => lower(x.label))) + (open.length > 3 ? ` and ${open.length - 3} more` : '') : `${all.length} windows`,
        tracks: all.map((w) => ({ id: w.contact.name, on: isOpen, now: isOpen(w.contact.state), tone: 'warn' as const })) };
    } },
    { key: 'doors', name: 'Doors', glyph: g.door, read: (h, ctx) => {
      // The doors with a contact; one open at night calls.
      const all = openings(h, ctx, 'Equipment_Door');
      if (!all.length) return null;
      const segs: Seg[] = all.map((d) => ({ label: nameOf(h, d.eq.name), on: isOpen(d.contact.state), id: d.contact.name }));
      const open = segs.filter((x) => x.on), night = isNight(h);
      return { kind: 's', segs, ids: all.map((d) => d.contact.name), big: open.length ? `${open.length} open` : 'All closed',
        label: open.length ? listOf(open.map((x) => lower(x.label))) : night ? 'it is night' : `${all.length} doors`,
        alert: open.length && night ? { level: 1, big: 'Open', label: listOf(open.map((x) => x.label)), key: 'door-night', fail: open.map((x) => segs.indexOf(x)),
          why: t.openAtNight(listOf(open.map((x) => x.label))), verb: t.gotIt, acts: [] } : undefined,
        tracks: all.map((d) => ({ id: d.contact.name, on: isOpen, now: isOpen(d.contact.state), tone: 'warn' as const })) };
    } },
    { key: 'shutters', name: 'Shutters', glyph: g.blinds, read: (h, ctx) => {
      // The blinds and shutters: on while lowered; a tap raises or lowers them.
      const all = equipments(h, ctx, 'Equipment_WindowCovering').flatMap((e) => (e.type === 'Rollershutter' ? [e] : [point(h, e.name, 'Point_Control', undefined, /^Rollershutter$/)].filter((p): p is Item => !!p)));
      if (!all.length) return null;
      const down = (i: Item) => (val(i) ?? 0) > 0;
      const segs: Seg[] = all.map((s) => ({ label: nameOf(h, s.name), on: down(s), id: s.name, act: cmd(s.name, down(s) ? 'UP' : 'DOWN') }));
      const lowered = segs.filter((x) => x.on);
      return { kind: 's', segs, ids: all.map((s) => s.name), big: lowered.length ? `${lowered.length} down` : 'All up',
        label: lowered.length ? listOf(lowered.slice(0, 3).map((x) => lower(x.label))) : `${all.length} shutters` };
    } },
    { key: 'shutter', name: 'Shutter', glyph: g.blinds, read: (h, ctx) => {
      const all = equipments(h, ctx, 'Equipment_WindowCovering').filter((e) => e.type === 'Rollershutter').map((e) => e.name);
      if (!all.length) return null;
      const name = follow(ctx, 'openings/shutter', all, (n) => (val(h.items.get(n)) ?? 0) > 0), pos = Math.round(val(h.items.get(name)!) ?? 0);
      return following({ kind: 'p', v: pos / 100, ids: [name], big: pos ? `${pos}%` : 'Up', label: pos ? 'down' : lower(nameOf(h, name)), name: nameOf(h, name),
        dial: { min: 0, max: 100, step: 10, unit: '%', label: 'down', value: pos, id: name, set: (x) => cmd(name, String(x)) } }, name, all);
    } },
  ] },

  { id: 'security', title: 'Security', channels: [
    { key: 'locks', name: 'Locks', glyph: g.lock, read: (h, ctx) => {
      // A lock is ON when locked (openHAB's convention, and what its own words say); unlocked at night calls.
      const all = equipments(h, ctx, 'Equipment_Lock').flatMap((e) => (e.type === 'Switch' ? [e] : [point(h, e.name, 'Point_Control', undefined, /^Switch$/)].filter((p): p is Item => !!p)));
      if (!all.length) return null;
      const segs: Seg[] = all.map((l) => ({ label: nameOf(h, l.name), on: on(l), id: l.name, act: cmd(l.name, on(l) ? 'OFF' : 'ON') }));
      const open = segs.filter((x) => !x.on), night = isNight(h);
      return { kind: 's', segs, ids: all.map((l) => l.name), big: `${segs.length - open.length} of ${segs.length}`, label: 'locked',
        alert: open.length && night ? { level: 1, big: 'Unlocked', label: listOf(open.map((x) => x.label)), key: 'unlocked-night', fail: open.map((x) => segs.indexOf(x)),
          why: t.unlockedAtNight(listOf(open.map((x) => x.label))), verb: t.lock, acts: open.map((x) => cmd(x.id, 'ON')) } : undefined,
        tracks: tracksOf(segs, isOn) };
    } },
    { key: 'alarms', name: 'Alarms', glyph: g.siren, read: (h, ctx) => {
      // What the home's detectors raise (smoke, water, gas, motion with the alarm set): the alarm points of its devices, not a weather service's.
      const all = h.all.filter((i) => is(i, 'Point_Alarm') && /^(Switch|Contact)$/.test(i.type) && inRooms(h, ctx, i.name) && !is(h.items.get(h.equipment.get(i.name) ?? ''), 'Equipment_WebService'));
      if (!all.length) return null;
      const raised = (i: Item) => i.state === 'ON' || i.state === 'OPEN';
      const what = (i: Item) => { const eq = h.equipment.get(i.name); return eq ? nameOf(h, eq) : nameOf(h, i.name); };
      const segs: Seg[] = all.map((i) => ({ label: what(i), on: !raised(i), id: i.name }));
      const active = all.filter(raised);
      return { kind: 's', segs, ids: all.map((i) => i.name), big: active.length ? cap(lower((cfg(active[0]).relatesTo ?? 'Alarm').replace(/^Property_/, '').replace(/_/g, ' '))) : 'Quiet',
        label: active.length ? listOf(active.map(what)) : `${all.length} detectors`,
        alert: active.length ? { level: 2, big: 'Alarm', label: listOf(active.map(what)), key: 'alarm', fail: active.map((i) => all.indexOf(i)), why: t.alarmOn(listOf(active.map(what))), verb: t.gotIt, acts: [] } : undefined,
        tracks: all.map((i) => ({ id: i.name, on: (st: string) => st === 'ON' || st === 'OPEN', now: raised(i), tone: 'critical' as const })) };
    } },
  ] },

  { id: 'media', title: 'Media', channels: [
    { key: 'playing', name: 'Playing', glyph: g.play, read: (h, ctx) => {
      const all = players(h, ctx);
      if (!all.length) return null;
      const segs: Seg[] = all.map((p) => ({ label: nameOf(h, p.eq.name), on: playing(p), id: p.play.name, act: cmd(p.play.name, playing(p) ? 'PAUSE' : 'PLAY') }));
      const live = all.filter(playing), lead = live[0];
      const title = lead ? [lead.title?.state, lead.artist?.state].filter((s) => s && s !== 'NULL' && s !== 'UNDEF').join(' · ') : '';
      // The cover's picture is read when it is looked at, not with the house: here it is.
      const cover = lead?.cover;
      if (cover) h.want?.(cover.name);
      const art = cover && isPicture(cover.state) ? cover : undefined;
      return { kind: 's', segs, ids: all.map((p) => p.play.name), big: live.length ? `${live.length} of ${all.length}` : 'Silence',
        label: live.length ? title || listOf(live.map((p) => lower(nameOf(h, p.eq.name)))) : 'all paused',
        image: art && lead ? { src: art.state, alt: title || nameOf(h, lead.eq.name), id: art.name } : undefined };
    } },
    { key: 'volume', name: 'Volume', glyph: g.volume, read: (h, ctx) => {
      const all = players(h, ctx).filter((p) => p.volume && val(p.volume) != null);
      if (!all.length) return null;
      const names = all.map((p) => p.eq.name), chosen = follow(ctx, 'media/volume', names, (n) => playing(all.find((p) => p.eq.name === n)!));
      const p = all.find((x) => x.eq.name === chosen)!, pct = Math.round(val(p.volume)!);
      return following({ kind: 'p', v: pct / 100, ids: [p.volume!.name], big: `${pct}%`, label: `${lower(nameOf(h, p.eq.name))}${playing(p) ? ', playing' : ''}`, name: `${nameOf(h, p.eq.name)} volume`,
        dial: { min: 0, max: 100, step: 5, unit: '%', label: 'volume', value: pct, id: p.volume!.name, set: (x) => cmd(p.volume!.name, String(x)) } }, chosen, names);
    } },
    { key: 'input', name: 'Input', glyph: g.box, read: (h, ctx) => {
      // What a player plays from (a receiver's inputs, a radio's bands): one of its options, chosen on the ring.
      const all = players(h, ctx).filter((p) => p.input);
      if (!all.length) return null;
      const names = all.map((p) => p.eq.name), chosen = follow(ctx, 'media/input', names, (n) => playing(all.find((p) => p.eq.name === n)!));
      const p = all.find((x) => x.eq.name === chosen)!, input = p.input!;
      const options: Seg[] = input.options!.map((o) => ({ label: o.label, on: o.value === input.state, id: input.name, act: o.value === input.state ? undefined : cmd(input.name, o.value) }));
      return following({ kind: 'c', segs: options.slice(0, 8), list: options.length > 8 ? options : undefined, ids: [input.name], big: options.find((o) => o.on)?.label ?? input.state,
        label: lower(nameOf(h, p.eq.name)), name: `${nameOf(h, p.eq.name)} input` }, chosen, names);
    } },
  ] },

  { id: 'energy', title: 'Energy', channels: [
    { key: 'power', name: 'Power', glyph: g.bolt, read: (h, ctx) => {
      // The flows the energy management system reports: what the house draws, what the grid gives, what the battery and the sun put in.
      const ems = equipments(h, ctx, 'Equipment_EnergyManagementSystem')[0], pts = powersOf(h, ems);
      const load = named(pts, /load|consumption|house|home/i), grid = named(pts, /grid/i), battery = named(pts, /battery/i);
      const solar = named(pts, /solar|pv|production/i) ?? named(powersOf(h, equipments(h, ctx, 'Equipment_PowerSupply')[0]), /total/i);
      const main = load ?? grid;
      if (!main) return null;
      const w = watts(main)!, gw = watts(grid), parts = [solar && `solar ${kW(watts(solar)!)}`, grid && grid !== main && `grid ${kW(Math.abs(gw!))}`, battery && `battery ${kW(Math.abs(watts(battery)!))}`].filter((s): s is string => !!s);
      return { kind: 'p', v: clamp(Math.abs(w) / 5000), ids: [main, grid, battery, solar].filter((p): p is Item => !!p).map((p) => p.name), big: kW(Math.abs(w)), history: main.name,
        label: parts.length ? parts.join(' · ') : main === load ? 'drawn by the house' : 'from the grid',
        alert: gw != null && gw > 4000 ? got(1, kW(gw), 'high draw', t.highDraw(kW(gw))) : undefined };
    } },
    { key: 'battery', name: 'Battery', glyph: g.battery, read: (h, ctx) => {
      // The home battery's charge (a status in percent), its flow in words; under 15% it calls.
      const ems = equipments(h, ctx, 'Equipment_EnergyManagementSystem')[0];
      const soc = ems ? pointsOf(h, ems.name).find((p) => is(p, 'Point_Status') && unitOf(p) === '%' && val(p) != null) ?? named(pointsOf(h, ems.name).filter((p) => unitOf(p) === '%' && val(p) != null), /soc|charge|battery/i) : undefined;
      if (!soc) return null;
      const pct = val(soc)!, flow = named(powersOf(h, ems), /battery/i), fw = watts(flow);
      return { kind: 'p', v: clamp(pct / 100), ids: [soc.name, ...(flow ? [flow.name] : [])], big: `${num(pct, 0)}%`, history: soc.name,
        label: fw != null && Math.abs(fw) > 20 ? `${kW(Math.abs(fw))} through the battery` : 'home battery',
        alert: pct < 15 ? got(1, `${num(pct, 0)}%`, 'battery low', t.batteryLow(num(pct, 0))) : undefined };
    } },
    { key: 'today', name: 'Today', glyph: g.meter, read: (h, ctx) => {
      // The day's energy: produced, used, from the grid, fed in; the band is the share of the day's use the house covered itself.
      const ems = equipments(h, ctx, 'Equipment_EnergyManagementSystem')[0], inverter = equipments(h, ctx, 'Equipment_PowerSupply')[0];
      const day = [...energiesOf(h, ems), ...energiesOf(h, inverter)].filter((p) => /day|today/i.test(`${p.name} ${p.label}`) && !/month|year/i.test(`${p.name} ${p.label}`));
      const produced = named(day, /production|solar|pv|yield/i), used = named(day.filter((p) => !/grid|self|feed/i.test(`${p.name} ${p.label}`)), /consumption|used|load|total/i);
      const grid = named(day, /grid/i), fed = named(day, /feed|export/i);
      const forecast = inverter || ems ? h.all.find((p) => is(p, 'Point_Forecast') && about(p, 'Property_Energy') && /today|day/i.test(`${p.name} ${p.label}`) && val(p) != null) : undefined;
      const main = produced ?? used;
      if (!main) return null;
      const u = kwh(used), gk = kwh(grid);
      const parts = [main === produced && u != null && `${num(u)} kWh used`, gk != null && `${num(gk)} kWh from the grid`, fed && `${num(kwh(fed)!)} kWh fed in`, forecast && `${num(kwh(forecast)!)} kWh forecast`].filter((s): s is string => !!s);
      return { kind: 'p', v: u != null && gk != null && u > 0 ? clamp(1 - gk / u) : 0, ids: [main, used, grid, fed, forecast].filter((p): p is Item => !!p).map((p) => p.name),
        big: `${num(kwh(main)!)} kWh`, label: `${main === produced ? 'produced' : 'used'}${parts.length ? ` · ${parts.join(' · ')}` : ''}` };
    } },
    { key: 'solar', name: 'Solar', glyph: g.sun, read: (h, ctx) => {
      // The inverter: its power now, by plane when it tells them apart.
      const inverter = equipments(h, ctx, 'Equipment_PowerSupply')[0], pts = powersOf(h, inverter);
      if (!pts.length) return null;
      const total = named(pts, /total/i) ?? pts.find((p) => p.type === 'Group'), planes = pts.filter((p) => p !== total);
      const w = total ? watts(total)! : planes.reduce((a, p) => a + watts(p)!, 0);
      return { kind: 'p', v: clamp(w / 10_000), ids: pts.map((p) => p.name), big: kW(w), history: total?.name,
        label: planes.length > 1 ? planes.map((p) => `${lower(nameOf(h, p.name).replace(/power|plane/gi, '').trim())} ${kW(watts(p)!)}`).join(' · ') : lower(nameOf(h, inverter.name)) };
    } },
  ] },

  { id: 'weather', title: 'Weather', channels: [
    { key: 'outside', name: 'Outside', glyph: g.cloud, read: (h, ctx) => {
      // The weather service's now: the temperature on the band, the condition, the humidity, the wind (where it comes from as the arrow).
      const services = equipments(h, ctx, 'Equipment_WebService_WeatherService');
      const svc = services.find((s) => point(h, s.name, 'Point_Measurement', 'Property_Temperature'));
      if (!svc) return null;
      const pts = pointsOf(h, svc.name), temp = point(h, svc.name, 'Point_Measurement', 'Property_Temperature')!, c = val(temp);
      if (c == null) return null;
      const humidity = val(point(h, svc.name, 'Point_Measurement', 'Property_Humidity')), wind = pts.find((p) => about(p, 'Property_Wind') && /Speed/.test(p.type)), dir = pts.find((p) => about(p, 'Property_Wind') && /Angle/.test(p.type));
      const condition = pts.find((p) => is(p, 'Point_Measurement') && p.type === 'String' && /condition|weather|summary/i.test(`${p.name} ${p.label}`));
      const words = [condition && condition.state !== 'NULL' && condition.state !== 'UNDEF' && lower(condition.state), humidity != null && `${num(humidity, 0)}% humidity`, wind && val(wind) != null && `wind ${num(val(wind)!, 0)} ${unitOf(wind)}`].filter((s): s is string => !!s);
      return { kind: 'p', v: clamp((c + 10) / 50), ids: [temp, humidity != null ? pts.find((p) => about(p, 'Property_Humidity')) : undefined, wind, condition].filter((p): p is Item => !!p).map((p) => p.name),
        big: `${num(c)}°`, label: words.join(' · ') || lower(nameOf(h, svc.name)), history: temp.name, bearing: val(dir) ?? undefined };
    } },
    { key: 'warnings', name: 'Warnings', glyph: g.warn, read: (h, ctx) => {
      // A weather service's warnings (the DWD's, Meteoalarm's): active, they call with their headline, by their severity.
      const services = equipments(h, ctx, 'Equipment_WebService_WeatherService').filter((s) => point(h, s.name, 'Point_Alarm', undefined, /^Switch$/));
      if (!services.length) return null;
      const active = services.filter((s) => on(point(h, s.name, 'Point_Alarm', undefined, /^Switch$/)));
      const headline = (s: Item) => { const p = named(pointsOf(h, s.name), /headline|title|event/i, /^String$/); return p && p.state !== 'UNDEF' && p.state !== 'NULL' ? p.state : nameOf(h, s.name); };
      const severe = active.some((s) => /extreme|severe/i.test(named(pointsOf(h, s.name), /severity|level/i, /^String$/)?.state ?? ''));
      return { kind: 'p', v: active.length ? 1 : 0, ids: services.map((s) => point(h, s.name, 'Point_Alarm', undefined, /^Switch$/)!.name),
        big: active.length ? 'Warning' : 'No warnings', label: active.length ? listOf(active.map(headline)) : lower(nameOf(h, services[0].name)),
        alert: active.length ? { level: severe ? 2 : 1, big: 'Warning', label: listOf(active.map(headline)), key: 'weather-warning', why: listOf(active.map(headline)), verb: t.gotIt, acts: [] } : undefined };
    } },
    { key: 'sun', name: 'Sun', glyph: g.sun, read: (h, ctx) => {
      // The sun: how high on the band, where in the sky as the arrow, and when it next sets or rises.
      const elevation = sunPoint(h, /elevation/i), azimuth = sunPoint(h, /azimuth/i);
      if (!elevation || val(elevation) == null || !inRooms(h, ctx, elevation.name)) return null;
      const e = val(elevation)!, up = e > 0;
      const times = h.all.filter((i) => i.type === 'DateTime' && /sun(rise|set)/i.test(`${i.name} ${i.label}`));
      const next = whenOf(times.find((i) => (up ? /set/i : /rise/i).test(`${i.name} ${i.label}`))?.state);
      return { kind: 'p', v: clamp(e / 65), ids: [elevation.name, ...(azimuth ? [azimuth.name] : [])], big: next ? hourText(next, h.timezone) : up ? 'Up' : 'Down',
        label: `${next ? (up ? 'sets' : 'rises') : up ? 'up' : 'down'} · ${up ? `${num(e, 0)}° high` : 'below the horizon'}`, bearing: val(azimuth) ?? undefined };
    } },
  ] },

  { id: 'people', title: 'People', channels: [
    { key: 'where', name: 'Where', glyph: g.pin, read: (h, ctx) => {
      // Whoever the home places: everyone on the map, around the one farthest from the others; each a row that opens them.
      const ids = people(h, ctx);
      if (!ids.length) return null;
      const at = ids.map((i) => ({ i, geo: geoOf(i.state)! }));
      const center = { lat: at.reduce((a, x) => a + x.geo.lat, 0) / at.length, lon: at.reduce((a, x) => a + x.geo.lon, 0) / at.length };
      const spread = Math.max(0.3, ...at.map((x) => distanceKm(center, x.geo)));
      const plots: GeoPlot[] = at.map((x) => ({ ...x.geo, label: personName(h, x.i.name), id: x.i.name, size: 0.7 }));
      const rows: Seg[] = at.map((x) => ({ label: personName(h, x.i.name), on: true, id: x.i.name, to: x.i.name, detail: x.i.changedAt ? `seen ${forText(Date.now() - x.i.changedAt)} ago` : undefined }));
      return { kind: 'p', v: 1, ids: ids.map((i) => i.name), big: `${ids.length} ${ids.length === 1 ? 'person' : 'people'}`, label: listOf(rows.map((r) => r.label)), list: rows,
        map: { center, zoom: zoomFor(center.lat, spread * 2.6 + 0.4), plots } };
    } },
    { key: 'presence', name: 'Presence', glyph: g.home, read: (h, ctx) => {
      // Whether someone is home, as the home tells it: a presence point, or a switch that says so.
      const p = h.all.find((i) => i.type === 'Switch' && (about(i, 'Property_Presence') || /presence|occupan|someone/i.test(`${i.name} ${i.label}`)) && !is(i, 'Equipment') && inRooms(h, ctx, i.name));
      if (!p) return null;
      return { kind: 'p', v: on(p) ? 1 : 0, ids: [p.name], big: on(p) ? 'Someone home' : 'Nobody home', label: p.changedAt ? `for ${forText(Date.now() - p.changedAt)}` : lower(nameOf(h, p.name)),
        tracks: [{ id: p.name, on: isOn, now: on(p) }] };
    } },
  ] },
];

// ─── Rooms: the other axis of the home ───
// A room is a system too: its channels are the channels of the systems, read
// within that location only. What is in no location is the room NO_ROOM. A
// room's channel keeps the key `system/channel`, so the viewer's picks and
// hidden channels (kept by system) hold on both axes. Floors order the rooms.
export const ROOM = 'room:';
const FLOORS = ['Basement', 'Cellar', 'GroundFloor', 'FirstFloor', 'SecondFloor', 'ThirdFloor', 'Attic'];
const floorRank = (h: House, loc: string | undefined) => { const f = loc && floorOf(h, loc); const at = f ? FLOORS.indexOf(sem(h.items.get(f)!).replace(`${FLOOR}_`, '')) : -1; return f ? (at >= 0 ? at : FLOORS.length) : FLOORS.length + 1; };
// The rooms: every location that is not a floor, by floor then name.
export const rooms = (h: House) => h.all.filter((i) => is(i, 'Location') && !is(i, FLOOR)).sort((a, b) => floorRank(h, a.name) - floorRank(h, b.name) || nameOf(h, a.name).localeCompare(nameOf(h, b.name)));
export const floors = (h: House) => h.all.filter((i) => is(i, FLOOR)).sort((a, b) => floorRank(h, a.name) - floorRank(h, b.name));
export function roomSystems(h: House, within: string[], hidden: (system: string, channel: string) => boolean, noRoomTitle: string): System[] {
  const list = [...rooms(h).map((r) => ({ loc: r.name, title: nameOf(h, r.name) })), { loc: NO_ROOM, title: noRoomTitle }];
  const chosen = systems.filter((sys) => within.includes(sys.id));
  return list.map((room) => ({
    id: ROOM + room.loc, title: room.title,
    channels: chosen.flatMap((sys) => sys.channels.filter((ch) => !hidden(sys.id, ch.key)).map((ch) => ({
      key: `${sys.id}/${ch.key}`, name: ch.name, glyph: ch.glyph,
      read: (hh: House, ctx: Context) => { const r = ch.read(hh, { ...ctx, rooms: [room.loc] }); return r && r.ids.length ? r : null; },
    }))),
  }));
}

// ─── Objects: a person ───
// Someone the home places, as an object of their own: where they are on the map, and since when.
export function personObject(h: House, name: string): System | null {
  const i = h.items.get(name);
  if (!i || i.type !== 'Location' || !geoOf(i.state)) return null;
  const title = personName(h, name);
  return { id: name, title, channels: [
    { key: 'where', name: 'Where', glyph: g.pin, read: (hh) => {
      const p = hh.items.get(name), at = p && geoOf(p.state);
      if (!p || !at) return null;
      return { kind: 'p', v: 1, ids: [name], big: p.changedAt ? hourText(p.changedAt, hh.timezone) : 'Placed', label: p.changedAt ? `last placed · ${num(at.lat, 3)}, ${num(at.lon, 3)}` : `${num(at.lat, 3)}, ${num(at.lon, 3)}`,
        map: { center: at, zoom: 14, plots: [{ ...at, label: title, id: name, size: 0.8 }] } };
    } },
  ] };
}

// ─── Words ───
// An item's state in words, for the log and the detail: its own options' words
// when it has them (a lock's locked and unlocked), else by its type.
export function stateText(h: House, name: string): string {
  const i = h.items.get(name);
  if (!i) return '';
  const st = i.state;
  if (st === 'NULL' || st === 'UNDEF') return 'unknown';
  const opt = i.options?.find((o) => o.value === st);
  if (opt) return lower(opt.label);
  switch (i.type) {
    case 'Switch': return st === 'ON' ? 'on' : 'off';
    case 'Contact': return st === 'OPEN' ? 'open' : 'closed';
    case 'Dimmer': return (numOf(st) ?? 0) > 0 ? `${num(numOf(st)!, 0)}%` : 'off';
    case 'Rollershutter': return (numOf(st) ?? 0) > 0 ? `${num(numOf(st)!, 0)}% down` : 'up';
    case 'Color': { const hsb = hsbOf(st); return hsb && hsb[2] > 0 ? `on, ${num(hsb[2], 0)}%` : 'off'; }
    case 'Player': return st === 'PLAY' ? 'playing' : st === 'PAUSE' ? 'paused' : lower(st);
    case 'Image': return 'a picture';
    case 'Location': { const geo = geoOf(st); return geo ? `${num(geo.lat, 3)}, ${num(geo.lon, 3)}` : st; }
    case 'DateTime': { const at = whenOf(st); return at ? hourText(at, h.timezone) : st; }
  }
  if (i.type.startsWith('Number')) {
    const v = numOf(st);
    if (v == null) return st;
    const digits = /%\.(\d)f/.exec(i.pattern ?? '')?.[1];
    return `${num(v, digits ? Number(digits) : 1)}${unitOf(i) ? ` ${unitOf(i)}` : ''}`;
  }
  return st.length > 80 ? `${st.slice(0, 79)}…` : st;
}
