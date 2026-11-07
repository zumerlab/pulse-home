// The card outside Home Assistant: `zumer-pulse` fed with a `hass` object built
// from a demo home, so the card (shadow root, adopted styles, `hass` diffs,
// `callService`) is tested and tuned without a Home Assistant. Query string:
// `home` (a demo home id), `config` (the card's config as JSON), `width` and
// `height` of the box (px), `size=panel|section` for the two usual sizes.

import '@zumer/pulse/style.css';
import './style.css';
import './card/zumer-pulse.ts';
import type { PulseCardConfig } from './card/zumer-pulse.ts';
import type { HomeAssistant } from './card/hass.ts';
import { DemoSource } from './demo/source.ts';
import { DEFAULT_HOME } from './demo/homes/index.ts';
import { esc } from '@zumer/pulse';

type Card = HTMLElement & { hass: HomeAssistant; setConfig(c: PulseCardConfig): void };

const q = new URLSearchParams(location.search);
const home = q.get('home') ?? DEFAULT_HOME;
const config: PulseCardConfig = { type: 'custom:zumer-pulse', ...JSON.parse(q.get('config') ?? '{}') };
const size = q.get('size') === 'section' ? [500, 448] : [1100, 720];
const width = Number(q.get('width')) || size[0], height = Number(q.get('height')) || size[1];

const bench = document.querySelector<HTMLElement>('#bench')!;
bench.innerHTML = `<p class="bench-lead">zumer-pulse · ${esc(home)} · ${esc(JSON.stringify(config))} · ${width}×${height}</p>
  <div class="bench-box" style="width:${width}px;height:${height}px"></div>`;
const box = bench.querySelector<HTMLElement>('.bench-box')!;

const demo = new DemoSource();
await demo.start(home);

// What Home Assistant hands a card: a fresh object per change, with the
// unchanged entities kept by reference, and the registries as records (the
// same objects until they change).
const registry = {
  areas: Object.fromEntries(demo.registry.areas),
  floors: Object.fromEntries(demo.registry.floors),
  devices: {},
  entities: Object.fromEntries([...demo.registry.entities].map(([id, e]) => [id, { ...e, entity_category: e.category }])),
};
const hass = (): HomeAssistant => ({
  states: Object.fromEntries(demo.states),
  ...registry,
  connected: true,
  connection: null as unknown as HomeAssistant['connection'],
  config: { version: `bench · ${home}`, unit_system: { temperature: demo.unit } },
  callService: (domain, service, data = {}, target) =>
    demo.call({ ids: ([] as string[]).concat(target?.entity_id ?? []), domain, service, data: { ...data, ...(target?.entity_id ? { entity_id: target.entity_id } : {}) } }),
  hassUrl: (path = '') => demo.url(path),
});

const card = document.createElement('zumer-pulse') as Card;
card.setConfig(config);
card.hass = hass();
box.append(card);
demo.onChange(() => { card.hass = hass(); });

Object.assign(window, { bench: { card, demo, config } });
