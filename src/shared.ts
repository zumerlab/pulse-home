// What the two apps of this repo share: the words for a span of time and an
// hour, the geometry of a map, and the mini rings a demo home is previewed
// with (the sign-in panels and the index). Nothing here knows Home Assistant
// or openHAB.

import { MINI_LANES, esc, icon, localeOf, ring, type Reading } from '@zumer/pulse';

// How long something has been as it is: "40 min", "3 h", "2 days".
export const forText = (ms: number) => { const h = Math.max(0, ms) / 3_600_000; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`; };
// The hour of a moment, in a time zone when one is given (a home's clock, not the viewer's).
export const hourText = (at: number, zone?: string) => {
  try { return new Date(at).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) }); }
  catch { return new Date(at).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' }); }
};
// The distance between two points on the Earth, in km.
export const distanceKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const d = Math.PI / 180, h = Math.sin(((b.lat - a.lat) * d) / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(((b.lon - a.lon) * d) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
// A tile zoom that holds `km` across the disc around a latitude: a street at 16, a region at 8.
export const zoomFor = (lat: number, km: number) => Math.max(3, Math.min(16, Math.floor(Math.log2((140 * 156.543 * Math.cos((lat * Math.PI) / 180)) / Math.max(0.25, km)))));

// A home previewed as the mini rings its systems fill, one per system: the
// channel calling the most, or the first. `attr` names the tile's system: the
// index keeps `data-system`; a sign-in panel, which stays in the page behind
// the board, uses one of its own so nothing mistakes its tiles for the board's.
export type PreviewChannel = { key: string; glyph: string };
export type PreviewSystem<C extends PreviewChannel> = { id: string; title: string; channels: C[] };
export function tilesOf<C extends PreviewChannel>(systems: PreviewSystem<C>[], read: (ch: C) => Reading | null, attr = 'data-system') {
  const tiles: string[] = [];
  for (const sys of systems) {
    const got = sys.channels.map((ch) => ({ ch, r: read(ch) }))
      .filter((x): x is { ch: C; r: Reading } => !!x.r)
      .sort((a, b) => (b.r.alert?.level ?? 0) - (a.r.alert?.level ?? 0));
    if (!got.length) continue;
    const { ch, r } = got[0], level = r.alert?.level ?? 0;
    tiles.push(`<span class="tile${level ? ` has-alert level-${level}` : ''}" ${attr}="${sys.id}">
      <span class="bigbang mini-ring"><span class="gravity-spot">${ring(ch.key, r, MINI_LANES, { muted: !r.alert })}</span></span>
      <span class="mini-glyph">${icon(ch.glyph, 26)}</span>
      <span class="tile-title">${esc(sys.title)}</span>
      <span class="tile-big">${esc(r.alert ? r.alert.big : r.big)}</span>
    </span>`);
  }
  return tiles;
}
