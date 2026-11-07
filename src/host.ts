// A PulseSource (Home Assistant's states, registry and service calls) as the
// PulseHost the board reads: the systems of `model.ts` bound to the source,
// every entity id as a thing, every service call as an action, the rooms as
// the board's other axis, and the words for an entity (its name, its state)
// as Home Assistant says them.

import type { Action, Changed, Group, PulseHost, ReadContext, System } from '@zumer/pulse';
import { nameOf, objectOf, placeOf, roomSystems, systems, type Context, type PulseSystem } from './model.ts';
import { ASSIST, isAsk, type Call, type HassState, type PulseSource } from './source.ts';
import { t } from './strings.ts';

// A notice under Home Assistant's bell, as a thing: `notice:<its id>`.
const NOTICE = 'notice:';

// Home Assistant states as words; anything else is shown as it comes.
const stateWords: Record<string, string> = {
  on: 'on', off: 'off', open: 'open', closed: 'closed', opening: 'opening', closing: 'closing',
  locked: 'locked', unlocked: 'unlocked', jammed: 'jammed', playing: 'playing', paused: 'paused',
  cleaning: 'cleaning', docked: 'docked', returning: 'returning', disarmed: 'disarmed', armed_home: 'armed (home)',
  armed_away: 'armed (away)', arming: 'arming', triggered: 'triggered', unavailable: 'unavailable',
};
export function stateText(e: HassState) {
  const u = e.attributes.unit_of_measurement;
  return `${stateWords[e.state] ?? e.state}${u ? ` ${String(u)}` : ''}`;
}

export function hostOf(src: PulseSource): PulseHost {
  // A system of the model, its channels reading the source's states.
  const bind = (sys: PulseSystem): System => ({
    id: sys.id, title: sys.title,
    channels: sys.channels.map((ch) => ({
      key: ch.key, name: ch.name, glyph: ch.glyph,
      read: (ctx: ReadContext) => {
        const c: Context = { temp: src.unit, reg: src.registry, areas: ctx.groups, picks: ctx.picks,
          assist: src.ask ? { answers: src.assist ?? [], language: src.language } : undefined };
        return ch.read(src.states, c);
      },
    })),
  });
  const noticeOf = (id: string) => (id.startsWith(NOTICE) ? src.registry.notices.find((n) => NOTICE + n.id === id) : undefined);
  return {
    get status() { return src.status; },
    get error() { return src.error; },
    get hasData() { return src.states.size > 0; },
    get language() { return src.language; },
    systems: systems.map(bind),
    // A state change is worth a line in the ticker; a change of attributes only
    // is not. The home's answers (Assist) are: they come beside the states.
    onChange: (fn: (changed: Changed[]) => void) => {
      const states = src.onChange((changed) => fn(changed.map((s) => ({ id: s.entity_id, logged: s.last_changed === s.last_updated }))));
      const messages = src.onMessage?.((ids) => fn(ids.map((id) => ({ id, logged: id === ASSIST }))));
      return () => { states(); messages?.(); };
    },
    onStatus: (fn) => src.onStatus(fn),
    onStructure: (fn) => src.onRegistry(fn),
    // The code entered on the keypad goes in the service data; the words of a question are its text.
    act: (a: Action) => {
      const c = a as Call;
      return src.call(!c.code ? c : isAsk(c) ? { ...c, data: { ...c.data, text: c.code } } : { ...c, data: { ...c.data, code: c.code } });
    },
    nameOf: (id) => id === ASSIST ? t.assist : noticeOf(id)?.title ?? (id.startsWith(NOTICE) ? t.notice : nameOf(src.states, id)),
    whereIs: (id) => placeOf(id),
    // Home Assistant's own words when the source has them (the user's language).
    stateOf: (id) => {
      if (id === ASSIST) return src.assist?.[0]?.speech ?? '';
      const n = noticeOf(id);
      if (n) return n.message;
      const e = src.states.get(id);
      return e ? src.stateText?.(e) ?? stateText(e) : '';
    },
    changedAt: (id) => {
      if (id === ASSIST) return src.assist?.[0]?.at;
      const n = noticeOf(id);
      if (n) return n.at;
      const at = Date.parse(src.states.get(id)?.last_changed ?? '');
      return Number.isFinite(at) ? at : undefined;
    },
    unitOf: (id) => String(src.states.get(id)?.attributes.unit_of_measurement ?? ''),
    url: (path) => src.url(path),
    stream: (id) => src.stream?.(id),
    history: src.history ? (id, hours) => src.history!(id, hours) : undefined,
    changes: src.changes ? (ids, hours) => src.changes!(ids, hours) : undefined,
    statistics: src.statistics ? (id, days) => src.statistics!(id, days) : undefined,
    // Areas grouped by floor; the ones with no floor last.
    groups: (): Group[] => {
      const reg = src.registry;
      const floors = [...reg.floors.values()].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
      const areas = [...reg.areas.values()];
      const item = (a: { area_id: string; name: string }) => ({ id: a.area_id, name: a.name });
      const groups: Group[] = floors.map((f) => ({ title: f.name, items: areas.filter((a) => a.floor_id === f.floor_id).map(item) }));
      const loose = areas.filter((a) => !floors.some((f) => a.floor_id === f.floor_id)).map(item);
      if (loose.length) groups.push({ title: floors.length ? t.noFloor : '', items: loose });
      return groups.filter((g) => g.items.length);
    },
    // The rooms: the registry's areas, floor by floor, each with the systems' channels read within it.
    byGroup: (chosen, hidden, noGroup) => roomSystems(src.registry, chosen, hidden, noGroup).map(bind),
    // A person or a camera named on a ring: their own object.
    objectOf: (id) => { const sys = objectOf(src.states, id); return sys ? bind(sys) : null; },
  };
}
