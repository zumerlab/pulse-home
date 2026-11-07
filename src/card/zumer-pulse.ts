// Pulse inside a Home Assistant dashboard: the `zumer-pulse` custom card, the
// `zumer-pulse` dashboard strategy (one panel view with the card) and the `zumer-pulse`
// section strategy (one section with the card), in one file. Orbit's and
// Zumly's CSS travel inside the card (adopted by its shadow root); Orbit's
// registered properties go once at document level, where @property works (see
// docs/home-assistant-integration.md).

import '@zumer/orbit';
import orbitCss from '@zumer/orbit/style?inline';
import zumlyCss from 'zumly/style.css?inline';
import pulseCss from '@zumer/pulse/style.css?inline';
import appCss from '../style.css?inline';
import { mountPulse, AXES, BOARD_MODES, DAYS, DIALS, ENDS, MONTHS, TIMES, type Axis, type BoardMode, type PulseHandle } from '../app.ts';
import { systems } from '../model.ts';
import { ARTS, THEME_NAMES, type Art, type Look, type ThemeName } from '@zumer/pulse';
import { HassSource } from './hass-source.ts';
import type { CardConfig, ConfigForm, FormSchema, HomeAssistant, LovelaceCard } from './hass.ts';

const DOCS = 'https://github.com/zumerlab/pulse-home';

// The card's options (all optional), also accepted by the two strategies.
export type PulseCardConfig = CardConfig & {
  // Which systems the board shows; by default all eight.
  systems?: string[];
  // Only the entities in these areas (area ids); by default the whole home.
  areas?: string[];
  // The board's view to start with: grid, orbit or layers. Without it, the
  // last one the person chose, remembered by the browser.
  mode?: BoardMode;
  // The board grouped by `systems` (default) or by `rooms` (the areas of the home).
  axis?: Axis;
  // Open inside this system; the board stays one step out.
  start?: string;
  // How many systems the Layers view stacks; by default all of them.
  layers?: number;
  // How many channels a system stacks as layers; by default three.
  stack?: number;
  // The gear on the board, where whoever looks at the card chooses its systems
  // and view for their browser (default true). `false` hides it: the config rules.
  settings?: boolean;
  // How the object draws: the dial `full` (a ring) or `open` (three quarters,
  // open at the bottom, with its ends); the day ring `plain` or with `marks`.
  dial?: 'full' | 'open';
  day?: 'plain' | 'marks';
  // The ends of a band and of each segment: `flat` (square) or `rounded`.
  ends?: 'flat' | 'rounded';
  // The colors: graphite (the default), paper, deep, or the blue-grey ones that tell an alert by tone, not by hue: slate, mist, fog (light) and night (dark).
  theme?: ThemeName;
  // Time in the orbit's center: off, the changes of the last 12 hours, the clock while all is calm, or both.
  time?: 'off' | 'changes' | 'clock' | 'both';
  // The energy month: a calendar (the 1st at the top) or the last 30 days (today at the top).
  month?: 'calendar' | 'rolling';
  // The switch between grid, orbit, layers and list on the board (default false: the gear has it).
  modes?: boolean;
  // What is behind the board: `flat` (the theme's color), `glow`, one of the three abstract grounds
  // (`aurora`, `contours`, `grain`), or the address of a photo (`/local/room.jpg`).
  background?: string;
};

// The named backgrounds; anything else is a photo's address.
const BACKGROUNDS = ['flat', 'glow', ...ARTS] as const;
// The background option as the look's ground.
function groundOf(background?: string): Pick<Look, 'ground' | 'art' | 'photo'> {
  if (!background) return {};
  if (background === 'flat' || background === 'glow') return { ground: background };
  if ((ARTS as readonly string[]).includes(background)) return { ground: 'art', art: background as Art };
  return { ground: 'photo', photo: background };
}

const SYSTEM_IDS = systems.map((s) => s.id);
const MODE_LABELS: Record<BoardMode, string> = { grid: 'Grid', orbit: 'Orbit', layers: 'Layers', list: 'List' };
const LABELS: Record<string, string> = { systems: 'Systems', areas: 'Areas', mode: 'Board view', axis: 'Group by', start: 'Open inside', layers: 'Layers', stack: 'Layers in a system', settings: 'Viewer settings (the gear)', dial: 'Dial', day: 'Day ring', ends: 'Ring ends', theme: 'Theme', time: 'Time in the orbit', month: 'Energy month', modes: 'View switch on the board', background: 'Background' };
const HELPERS: Record<string, string> = {
  systems: 'Leave empty for all of them.',
  areas: 'Only what is in these areas; leave empty for the whole home. An entity with no area stays out.',
  mode: 'The view when the card opens, until the viewer picks another in their browser.',
  axis: 'By system (lights, climate…) or by room: each area of the home as one object, with what calls the most in front.',
  start: 'The card opens zoomed into this system; the board is one step back.',
  layers: 'How many systems the Layers view stacks, the rest named under the object. Leave empty for all of them.',
  stack: 'How many channels a system stacks as layers, the rest named under the object. Leave empty for three.',
  settings: 'Whoever looks at the card can choose its systems and view, kept in their browser. Off, the options above rule.',
  dial: 'A full ring, or open at the bottom with its ends named and a mark at the measurement.',
  day: 'The last 24 hours in a detail: bars only, or with hour marks around.',
  ends: 'The ends of a band and of each segment of a ring: square, or rounded.',
  time: 'What the orbit\'s center shows of time: nothing, the changes of the last 12 hours on its ring (each with its system\'s icon; tap one to read it), the clock and the day while all is calm, or both.',
  month: 'The energy detail\'s month: a calendar with the 1st at the top, or the last 30 days with today at the top.',
  modes: 'Grid, Orbit, Layers and List as buttons above the board. Off, the view is chosen in the gear.',
  theme: 'The colors. Slate, Mist, Fog and Night keep to one blue-grey family and tell an alert by tone and weight instead of red and amber.',
  background: 'What is behind the board: flat, a glow, or one of three abstract grounds the browser draws from the theme\'s colors. In YAML, also the address of a photo, such as /local/room.jpg.',
};

const FORM: FormSchema[] = [
  { name: 'systems', selector: { select: { multiple: true, mode: 'list', options: systems.map((s) => ({ value: s.id, label: s.title })) } } },
  { name: 'areas', selector: { area: { multiple: true } } },
  { name: 'mode', selector: { select: { mode: 'dropdown', options: BOARD_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] })) } } },
  { name: 'axis', selector: { select: { mode: 'dropdown', options: [{ value: 'systems', label: 'Systems' }, { value: 'rooms', label: 'Rooms' }] } } },
  { name: 'start', selector: { select: { mode: 'dropdown', options: systems.map((s) => ({ value: s.id, label: s.title })) } } },
  { name: 'layers', selector: { number: { min: 1, max: systems.length, mode: 'box' } } },
  { name: 'stack', selector: { number: { min: 1, max: 5, mode: 'box' } } },
  { name: 'settings', default: true, selector: { boolean: {} } },
  { name: 'modes', default: false, selector: { boolean: {} } },
  { name: 'dial', selector: { select: { mode: 'dropdown', options: [{ value: 'full', label: 'Full ring' }, { value: 'open', label: 'Open at the bottom' }] } } },
  { name: 'day', selector: { select: { mode: 'dropdown', options: [{ value: 'plain', label: 'Bars only' }, { value: 'marks', label: 'With hour marks' }] } } },
  { name: 'ends', selector: { select: { mode: 'dropdown', options: [{ value: 'flat', label: 'Square' }, { value: 'rounded', label: 'Rounded' }] } } },
  { name: 'time', selector: { select: { mode: 'dropdown', options: [{ value: 'off', label: 'None' }, { value: 'changes', label: 'Changes, last 12 hours' }, { value: 'clock', label: 'Clock while all is calm' }, { value: 'both', label: 'Both' }] } } },
  { name: 'month', selector: { select: { mode: 'dropdown', options: [{ value: 'calendar', label: 'Calendar' }, { value: 'rolling', label: 'Last 30 days' }] } } },
  { name: 'theme', selector: { select: { mode: 'dropdown', options: THEME_NAMES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })) } } },
  { name: 'background', selector: { select: { mode: 'dropdown', options: BACKGROUNDS.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })) } } },
];

function assertConfig(config: PulseCardConfig) {
  if (config.systems !== undefined && !Array.isArray(config.systems)) throw new Error('systems must be a list of system ids');
  for (const id of config.systems ?? []) if (!SYSTEM_IDS.includes(id)) throw new Error(`Unknown system "${id}". One of: ${SYSTEM_IDS.join(', ')}`);
  if (config.areas !== undefined && (!Array.isArray(config.areas) || config.areas.some((a) => typeof a !== 'string'))) throw new Error('areas must be a list of area ids');
  if (config.mode !== undefined && !BOARD_MODES.includes(config.mode)) throw new Error(`mode must be one of ${BOARD_MODES.join(', ')}`);
  if (config.axis !== undefined && !AXES.includes(config.axis)) throw new Error(`axis must be one of ${AXES.join(', ')}`);
  if (config.start !== undefined && !SYSTEM_IDS.includes(config.start)) throw new Error(`Unknown system "${config.start}" in start`);
  if (config.start && config.systems?.length && !config.systems.includes(config.start)) throw new Error('start must be one of the systems shown');
  if (config.layers !== undefined && !(Number.isInteger(config.layers) && config.layers >= 1)) throw new Error('layers must be a whole number from 1 up');
  if (config.stack !== undefined && !(Number.isInteger(config.stack) && config.stack >= 1)) throw new Error('stack must be a whole number from 1 up');
  if (config.settings !== undefined && typeof config.settings !== 'boolean') throw new Error('settings must be true or false');
  if (config.modes !== undefined && typeof config.modes !== 'boolean') throw new Error('modes must be true or false');
  if (config.dial !== undefined && !DIALS.includes(config.dial)) throw new Error(`dial must be one of ${DIALS.join(', ')}`);
  if (config.day !== undefined && !DAYS.includes(config.day)) throw new Error(`day must be one of ${DAYS.join(', ')}`);
  if (config.ends !== undefined && !ENDS.includes(config.ends)) throw new Error(`ends must be one of ${ENDS.join(', ')}`);
  if (config.time !== undefined && !TIMES.includes(config.time)) throw new Error(`time must be one of ${TIMES.join(', ')}`);
  if (config.month !== undefined && !MONTHS.includes(config.month)) throw new Error(`month must be one of ${MONTHS.join(', ')}`);
  if (config.theme !== undefined && !THEME_NAMES.includes(config.theme)) throw new Error(`theme must be one of ${THEME_NAMES.join(', ')}`);
  if (config.background !== undefined && !(typeof config.background === 'string' && ((BACKGROUNDS as readonly string[]).includes(config.background) || /^(\/|https?:\/\/|data:)/.test(config.background)))) throw new Error(`background must be one of ${BACKGROUNDS.join(', ')}, or the address of a photo`);
}

// A strategy's `generate` receives its own `strategy:` object (`type` and the
// options next to it); the card's options go through to the card.
function cardConfig(strategy: Record<string, unknown> = {}): PulseCardConfig {
  const { systems, areas, mode, axis, start, layers, stack, settings, dial, day, ends, theme, time, month, modes, background } = strategy as PulseCardConfig;
  return { type: 'custom:zumer-pulse', ...(systems ? { systems } : {}), ...(areas?.length ? { areas } : {}), ...(mode ? { mode } : {}), ...(axis ? { axis } : {}), ...(start ? { start } : {}),
    ...(layers ? { layers } : {}), ...(stack ? { stack } : {}), ...(settings === false ? { settings } : {}), ...(dial ? { dial } : {}), ...(day ? { day } : {}), ...(ends ? { ends } : {}), ...(theme ? { theme } : {}), ...(time ? { time } : {}), ...(month ? { month } : {}), ...(modes !== undefined ? { modes } : {}), ...(background ? { background } : {}) };
}

// Orbit 2.2 registers its @property declarations itself (CSS.registerProperty
// on load, in every document it draws in), so the card no longer has to.
const cardCss = `
:host { display: block; position: relative; height: 100%; min-height: 420px; overflow: hidden; border-radius: inherit; background: var(--bg); color: var(--ink); }
.zumly-canvas { position: absolute; inset: 0; }
`;
const sheets = [orbitCss, zumlyCss, pulseCss, appCss, cardCss].map((css) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
});

class PulseCard extends HTMLElement implements LovelaceCard {
  private source = new HassSource();
  private pulse: PulseHandle | null = null;
  private config: PulseCardConfig = { type: 'custom:zumer-pulse' };

  static getStubConfig() { return {}; }

  // The visual editor: a form over the three options.
  static getConfigForm(): ConfigForm {
    return {
      schema: FORM,
      assertConfig,
      computeLabel: (schema) => LABELS[schema.name],
      computeHelper: (schema) => HELPERS[schema.name],
    };
  }

  setConfig(config: PulseCardConfig) {
    assertConfig(config);
    this.config = { ...config, type: 'custom:zumer-pulse' };
    // Options changed on a mounted card (the editor's live preview): mount again.
    if (this.pulse) { this.unmount(); this.mount(); }
  }

  set hass(hass: HomeAssistant) { this.source.setHass(hass); }

  connectedCallback() { if (!this.pulse) this.mount(); }

  disconnectedCallback() { this.unmount(); }

  private mount() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = sheets;
    root.innerHTML = '<div class="zumly-canvas" tabindex="0"></div>';
    const { systems, areas, mode, axis, start, layers, stack, settings, dial, day, ends, theme, time, month, modes, background } = this.config;
    // The viewer's choices are kept per card config: a card set up differently
    // starts afresh.
    const key = `zumer-pulse:${JSON.stringify({ systems, areas, mode, axis, start })}`;
    this.pulse = mountPulse(root.querySelector<HTMLElement>('.zumly-canvas')!, { source: this.source, systems, areas, mode, axis, start, layers, stack, settings: settings === false ? false : key,
      look: dial || day || ends || theme || time || month || modes !== undefined || background ? { dial, day, ends, theme, time, month, modes: modes === undefined ? undefined : modes ? 'shown' : 'hidden', ...groundOf(background) } : undefined });
  }

  private unmount() {
    this.pulse?.destroy();
    this.pulse = null;
  }

  // Masonry rows of 50 px; in sections, the full width and as many rows as it needs.
  getCardSize() { return 10; }
  getGridOptions() { return { columns: 'full' as const, rows: 'auto' as const, min_columns: 6, min_rows: 6 }; }
}

// "Pulse" as a dashboard type: the New dashboard dialog lists it under
// Community dashboards, and it generates one panel view with the card. The
// card's options go under `strategy:` next to `type`.
class PulseDashboardStrategy extends HTMLElement {
  static async generate(config: Record<string, unknown>) {
    return { title: 'Pulse', views: [{ title: 'Pulse', path: 'pulse', type: 'panel', cards: [cardConfig(config)] }] };
  }
}

// "Pulse" as a section of a sections view: one grid with the card, full
// width of the section. Same options.
class PulseSectionStrategy extends HTMLElement {
  static async generate(config: Record<string, unknown>) {
    return { type: 'grid', cards: [cardConfig(config)] };
  }
}

customElements.define('zumer-pulse', PulseCard);
customElements.define('ll-strategy-dashboard-zumer-pulse', PulseDashboardStrategy);
customElements.define('ll-strategy-section-zumer-pulse', PulseSectionStrategy);
window.customCards = window.customCards ?? [];
window.customCards.push({
  type: 'zumer-pulse', name: 'Pulse', preview: true, documentationURL: DOCS,
  description: 'Your home as one radial object per system, layered by urgency: the one calling the most in front, with its control on the ring.',
});
window.customStrategies = window.customStrategies ?? [];
window.customStrategies.push(
  { type: 'zumer-pulse', strategyType: 'dashboard', name: 'Pulse', documentationURL: DOCS, description: 'One full-screen Pulse: the board of your systems, each a radial object you zoom into.' },
  { type: 'zumer-pulse', strategyType: 'section', name: 'Pulse', documentationURL: DOCS, description: 'Pulse as a section: the board, or one system, inside a sections view.' },
);
