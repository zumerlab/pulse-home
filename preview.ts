// A demo home previewed as the mini rings its entities fill, one per system,
// computed from the same model the board uses: the channel calling the most,
// or the first. The index shows every home this way; the sign-in, the one
// chosen.

import { MINI_LANES, esc, icon, ring, type Reading } from '@zumer/pulse';
import { DemoSource } from './demo/source.ts';
import { systems } from './model.ts';

// `attr` names the tile's system: the index keeps `data-system`; the sign-in,
// which stays in the page behind the board, uses one of its own so nothing
// mistakes its tiles for the board's.
export function previewTiles(source: DemoSource, attr = 'data-system') {
  const tiles: string[] = [];
  for (const sys of systems) {
    const read = sys.channels.map((ch) => ({ ch, r: ch.read(source.states, { temp: source.unit, reg: source.registry }) }))
      .filter((x): x is { ch: typeof x.ch; r: Reading } => !!x.r)
      .sort((a, b) => (b.r.alert?.level ?? 0) - (a.r.alert?.level ?? 0));
    if (!read.length) continue;
    const { ch, r } = read[0], level = r.alert?.level ?? 0;
    tiles.push(`<span class="tile${level ? ` has-alert level-${level}` : ''}" ${attr}="${sys.id}">
      <span class="bigbang mini-ring"><span class="gravity-spot">${ring(ch.key, r, MINI_LANES, { muted: !r.alert })}</span></span>
      <span class="mini-glyph">${icon(ch.glyph, 26)}</span>
      <span class="tile-title">${sys.title}</span>
      <span class="tile-big">${esc(r.alert ? r.alert.big : r.big)}</span>
    </span>`);
  }
  return tiles;
}

// A home started, read and stopped: its tiles and how many entities it has.
export async function previewHome(id: string, attr?: string) {
  const source = new DemoSource();
  await source.start(id);
  const tiles = previewTiles(source, attr), entities = source.states.size;
  source.stop(false);
  return { tiles, entities };
}
