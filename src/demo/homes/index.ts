// The six homes of demo.home-assistant.io, loaded on demand (the biggest is
// 130 entities). Names and authors are the ones the frontend shows.
import type { Area, EntityInput, Floor } from '../entities.ts';

export type HomeData = { entities: EntityInput[]; areas?: Area[]; floors?: Floor[] };
export type Home = {
  id: string; name: string; author: string; url: string;
  description: string;
  load: () => Promise<HomeData>;
};

export const homes: Home[] = [
  { id: 'home', name: 'Home page', author: 'Home Assistant', url: 'https://www.home-assistant.io',
    description: 'The home behind Home Assistant\'s own overview: two floors with areas, lights, a thermostat, blinds, speakers and an alarm.',
    load: () => import('./home.ts') },
  { id: 'sections', name: 'Home Demo', author: 'Home Assistant', url: 'https://github.com/home-assistant/frontend/',
    description: 'The sections dashboard demo: shutters, two thermostats, Nest speakers, energy sensors and pending updates.',
    load: () => import('./sections.ts') },
  { id: 'arsaboo', name: 'ARS Home', author: 'Arsaboo', url: 'https://github.com/arsaboo/homeassistant-config/',
    description: 'A family home with an Abode alarm, Harmony remote, cameras, people and commute sensors.',
    load: () => import('./arsaboo.ts') },
  { id: 'teachingbirds', name: 'Isa\'s mobile friendly LL', author: 'Isabella Gross Alström', url: 'https://github.com/isabellaalstrom/',
    description: 'The largest one: twenty lights, dozens of sensors, scripts and scenes.',
    load: () => import('./teachingbirds.ts') },
  { id: 'kernehed', name: 'Hem', author: 'Kernehed', url: 'https://github.com/kernehed',
    description: 'A Swedish home watched by motion and connectivity sensors, with an alarm and a lock.',
    load: () => import('./kernehed.ts') },
  { id: 'jimpower', name: 'Kingia Castle', author: 'Jimpower', url: 'https://github.com/JamesMcCarthy79/Home-Assistant-Config',
    description: 'Doors, windows, smoke and moisture sensors all over the house, and an alarm.',
    load: () => import('./jimpower.ts') },
];

export const DEFAULT_HOME = homes[0].id;
export const homeById = (id: string) => homes.find((h) => h.id === id);
