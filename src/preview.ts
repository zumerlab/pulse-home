// A Home Assistant demo home previewed as the mini rings its entities fill,
// computed from the same model the board uses (`tilesOf` in shared.ts). The
// index shows every home this way; the sign-in, the one chosen.

import { DemoSource } from './demo/source.ts';
import { systems } from './model.ts';
import { tilesOf } from './shared.ts';

export function previewTiles(source: DemoSource, attr = 'data-system') {
  return tilesOf(systems, (ch) => ch.read(source.states, { temp: source.unit, reg: source.registry }), attr);
}

// A home started, read and stopped: its tiles and how many entities it has.
export async function previewHome(id: string, attr?: string) {
  const source = new DemoSource();
  await source.start(id);
  const tiles = previewTiles(source, attr), entities = source.states.size;
  source.stop(false);
  return { tiles, entities };
}
