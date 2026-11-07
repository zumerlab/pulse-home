import { mountBoard, type BoardHandle, type BoardMode, type BoardSettings, type Look } from '@zumer/pulse';
import type { PulseSource, Status } from './source.ts';
import { hostOf } from './host.ts';
import { t } from './strings.ts';

// The radial object over a PulseSource, mounted on an element: the core's
// board (`mountBoard`) over the source as a PulseHost (`host.ts`), with Home
// Assistant's words. The standalone app (`main.ts`) mounts it on the page with
// the WebSocket or a demo home; the card (`card/`) in its shadow root with the
// `hass` object. Both speak of areas, entities and rooms; the board, of
// groups, picks and the groups axis: this is where the two are translated.

export { BOARD_MODES, DAYS, DIALS, ENDS, MONTHS, TIMES, type BoardMode, type Look } from '@zumer/pulse';

// The axis the board groups the home by: its systems (lights, climate…) or its
// rooms (the registry's areas, floor by floor; what has no area, in its own room).
export type Axis = 'systems' | 'rooms';
export const AXES: Axis[] = ['systems', 'rooms'];

// What a screen shows: the viewer's choices (the gear on the board), kept in
// the browser. The host's `PulseOptions` are the frame they are made within.
export type PulseSettings = {
  systems?: string[];
  mode?: BoardMode;
  // The board grouped by system or by room.
  axis?: Axis;
  start?: string;
  // Only the entities in these areas (registry ids); nothing set: everywhere.
  areas?: string[];
  // Channels each system does not show: { lights: ['plugs'] }.
  channels?: Record<string, string[]>;
  // The entity a channel follows instead of the first of its kind: { 'lights/brightness': 'light.kitchen' }.
  entities?: Record<string, string>;
  // How the object draws: see Look.
  look?: Look;
  // How many systems the Layers view stacks (the rest are named under the object); nothing set: all of them.
  layers?: number;
  // How many channels a system stacks as layers (the rest are named under the object); nothing set: three (two on a phone).
  stack?: number;
  // The calm systems shown even while something calls (folded by default).
  calm?: 'open';
};

export type PulseOptions = {
  source: PulseSource;
  // Which systems the object may show (default: all of model.ts); unknown ids are ignored.
  systems?: string[];
  // The board's view when it opens, until the viewer picks another on this browser.
  mode?: BoardMode;
  // The board grouped by system (default) or by room, until the viewer picks the other.
  axis?: Axis;
  // Start inside this system (the board stays behind, one step out).
  start?: string;
  // Only what is in these areas (registry ids); the gear chooses among them.
  areas?: string[];
  // How the object draws (the gear's defaults): see Look.
  look?: Look;
  // How many systems the Layers view stacks by default; nothing set: all of them.
  layers?: number;
  // How many channels a system stacks as layers by default; nothing set: three (two on a phone).
  stack?: number;
  // Where the viewer's choices are kept: a localStorage key (default
  // 'pulse-ha-settings'); `false` hides the gear and keeps nothing.
  settings?: string | false;
  // The connection line of the board (HTML); the shell decides what it says.
  status?: (source: PulseSource) => string;
  // A button with `data-action` in that line was pressed.
  onAction?: (action: string) => void;
  // A way out of the source (sign out, leave the demo): an icon next to the gear, `data-action="signout"`.
  exit?: (source: PulseSource) => string | null;
  onStatus?: (status: Status) => void;
};

export type PulseHandle = {
  app: BoardHandle['app'];
  readonly source: PulseSource;
  setSource(src: PulseSource): void;
  settings(): PulseSettings;
  setSettings(patch: PulseSettings): void;
  repaint(): void;
  ready: Promise<unknown>;
  destroy(): void;
  ui: unknown;
  readings(): unknown;
};

// The home's words and the board's: areas are groups, the entity a channel
// follows is its pick, and the rooms axis is the groups axis.
const toBoard = (s: PulseSettings): BoardSettings => {
  const { areas, entities, axis, ...rest } = s;
  const out: BoardSettings = rest;
  if ('areas' in s) out.groups = areas;
  if ('entities' in s) out.picks = entities;
  if ('axis' in s) out.axis = axis === 'rooms' ? 'groups' : axis;
  return out;
};
const fromBoard = (s: BoardSettings): PulseSettings => {
  const { groups, picks, axis, ...rest } = s;
  const out: PulseSettings = rest;
  if ('groups' in s) out.areas = groups;
  if ('picks' in s) out.entities = picks;
  if ('axis' in s) out.axis = axis === 'groups' ? 'rooms' : axis;
  return out;
};
// What a browser kept before the board spoke of groups: said again in its words, once.
function migrate(store: string) {
  try {
    const raw = localStorage.getItem(store);
    if (!raw) return;
    const old = JSON.parse(raw) as PulseSettings;
    if (!('areas' in old) && !('entities' in old) && old.axis !== 'rooms') return;
    localStorage.setItem(store, JSON.stringify(toBoard(old)));
  } catch { /* no storage, or not ours: the board starts from the frame */ }
}

export function mountPulse(canvas: HTMLElement, options: PulseOptions): PulseHandle {
  let source = options.source;
  const store = options.settings === false ? false : options.settings ?? 'pulse-ha-settings';
  if (store) migrate(store);
  const board = mountBoard(canvas, {
    host: hostOf(source),
    systems: options.systems,
    mode: options.mode,
    axis: options.axis === 'rooms' ? 'groups' : options.axis,
    start: options.start,
    groups: options.areas,
    look: options.look,
    layers: options.layers,
    stack: options.stack,
    settings: store,
    status: options.status ? () => options.status!(source) : undefined,
    onAction: options.onAction,
    exit: options.exit ? () => options.exit!(source) : undefined,
    onStatus: options.onStatus,
    strings: t,
  });
  return {
    app: board.app,
    get source() { return source; },
    setSource(src) {
      if (src === source) return;
      source = src;
      board.setHost(hostOf(src));
    },
    settings: () => fromBoard(board.settings()),
    setSettings: (patch) => board.setSettings(toBoard(patch)),
    repaint: board.repaint,
    ready: board.ready,
    destroy: board.destroy,
    ui: board.ui,
    readings: board.readings,
  };
}
