// A HouseSource as the PulseHost the board reads: the systems of `model.ts`
// bound to the source, every item as a thing, every command as an action, the
// rooms as the board's other axis (floor by floor), and the words for an item
// (its name, its state) as openHAB says them.

import { changesOf, hourly, type Action, type Changed, type Group, type PulseHost, type ReadContext, type System } from '@zumer/pulse';
import { floorOf, floors, houseOf, nameOf, personObject, placeOf, roomSystems, rooms, ROOM, stateText, systems, unitOf, type Context, type House, type System as HouseSystem } from './model.ts';
import { numOf, type Act, type HouseSource } from './source.ts';
import { t } from './strings.ts';

// Items whose change is worth a line in the ticker: a switch, a contact, a
// player, a mode; not a number moving every second.
const LOGGED = /^(Switch|Contact|Player|String|Rollershutter|Dimmer|Color)$/;

export function hostOf(src: HouseSource): PulseHost {
  // The model's indexes over the items, rebuilt when the set of items changes.
  let house: House = houseOf(src.items, src.timezone), built = src.structure;
  const h = () => { if (src.structure !== built) { house = houseOf(src.items, src.timezone); built = src.structure; } return house; };
  const bind = (sys: HouseSystem): System => ({
    id: sys.id, title: sys.title,
    channels: sys.channels.map((ch) => ({ key: ch.key, name: ch.name, glyph: ch.glyph, read: (ctx: ReadContext) => { const c: Context = { rooms: ctx.groups, picks: ctx.picks }; return ch.read(h(), c); } })),
  });
  const roomName = (id: string) => (id === ROOM ? t.noRoom : nameOf(h(), id.slice(ROOM.length)));
  return {
    get status() { return src.status; },
    get error() { return src.error; },
    get hasData() { return src.items.size > 0; },
    systems: systems.map(bind),
    onChange: (fn: (changed: Changed[]) => void) => src.onChange((names) => fn(names.map((id) => ({ id, logged: LOGGED.test(src.items.get(id)?.type ?? '') })))),
    onStatus: (fn) => src.onStatus(fn),
    onStructure: (fn) => src.onStructure(fn),
    act: (a: Action) => src.act(a as Act),
    nameOf: (id) => (id.startsWith(ROOM) ? roomName(id) : nameOf(h(), id)),
    whereIs: (id) => placeOf(h(), id),
    stateOf: (id) => stateText(h(), id),
    changedAt: (id) => src.items.get(id)?.changedAt,
    unitOf: (id) => { const i = src.items.get(id); return i ? unitOf(i) : ''; },
    url: (path) => path,
    // A day of a point from the server's persistence: hourly means for the ring, the moments it changed for the timeline.
    history: async (id, hours) => hourly(((await src.history([id], hours))[id] ?? []).map((r) => ({ s: String(numOf(r.s) ?? ''), lu: r.lu })), hours),
    changes: async (ids, hours) => {
      const rows = await src.history(ids, hours);
      return Object.fromEntries(ids.map((id) => [id, changesOf(rows[id] ?? [], hours)]));
    },
    // The rooms by floor; the ones on no floor (the garden, the garage) last.
    groups: (): Group[] => {
      const hh = h(), all = rooms(hh), item = (r: { name: string }) => ({ id: r.name, name: nameOf(hh, r.name) });
      const groups: Group[] = floors(hh).map((f) => ({ title: nameOf(hh, f.name), items: all.filter((r) => floorOf(hh, r.name) === f.name).map(item) }));
      const loose = all.filter((r) => !floorOf(hh, r.name)).map(item);
      if (loose.length) groups.push({ title: groups.length ? t.noFloor : '', items: loose });
      return groups.filter((gr) => gr.items.length);
    },
    byGroup: (chosen, hidden, noGroup) => roomSystems(h(), chosen, hidden, noGroup).map(bind),
    // Someone named on a row: their own object.
    objectOf: (id) => { const sys = personObject(h(), id); return sys ? bind(sys) : null; },
  };
}
