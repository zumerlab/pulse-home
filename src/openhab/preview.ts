// openHAB's demo house previewed as the mini rings its items fill, from the
// same model the board uses (`tilesOf` in ../shared.ts): for the index and
// the connect panel. The recording loads only when asked for.

import { tilesOf } from '../shared.ts';
import { houseOf, systems } from './model.ts';

export async function previewHouse(attr?: string) {
  const { DemoSource } = await import('./demo/source.ts');
  const source = new DemoSource();
  source.start();
  const house = houseOf(source.items, source.timezone);
  const tiles = tilesOf(systems, (ch) => ch.read(house, {}), attr), items = source.items.size;
  source.stop();
  return { tiles, items };
}
