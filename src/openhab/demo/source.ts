// The demo house as recorded: openHAB's own demo home (demo.openhab.org) one
// evening in November 2026 (`recording.json`, made by `scripts/record.mjs`),
// every item through the same reader as the live ones, moved to now. As
// recorded, the heating is on in the living room with its window open, the
// garage door is open and both locks are unlocked at night, the office speaker
// plays. Then the house breathes: the temperatures drift, the power moves,
// the battery drains, the sun goes on; a command is answered as openHAB would
// echo it. The covers are drawn, not the albums' art.

import type { HistoryRow, Status } from '@zumer/pulse';
import { hsbOf, itemOf, numOf, type Act, type HouseSource, type Item, type ItemDto, type Items } from '../source.ts';
import { t } from '../strings.ts';
import recording from './recording.json';

type Recording = { at: number; server: string; version: string; timezone?: string; items: ItemDto[]; history: Record<string, [number, string][]> };
const rec = recording as unknown as Recording;

// The covers the recorder drew, bundled with the app wherever it is served from, by file name.
const covers = import.meta.glob('./covers/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const jitter = (v: number, step: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v + (Math.random() - 0.5) * 2 * step));
const withUnit = (i: Item, v: number) => { const u = i.unit ?? /\S\s+(\S+)$/.exec(i.state)?.[1]; return u ? `${v} ${u}` : String(v); };

export class DemoSource implements HouseSource {
  readonly items: Items = new Map();
  structure = 0;
  status: Status = 'signed-out';
  error = '';
  private shift = 0;                 // from the recording's moment to now
  private timer = 0;
  private base = new Map<string, number>();   // the recorded value of what drifts
  private listeners = new Set<(names: string[]) => void>();
  private statusListeners = new Set<() => void>();
  private structureListeners = new Set<() => void>();

  get label() { return t.demoLabel; }
  get timezone() { return rec.timezone; }
  onChange(fn: (names: string[]) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onStatus(fn: () => void) { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn); }
  onStructure(fn: () => void) { this.structureListeners.add(fn); return () => this.structureListeners.delete(fn); }
  private setStatus(status: Status) { this.status = status; this.statusListeners.forEach((fn) => fn()); }

  start() {
    this.stop();
    const now = Date.now();
    this.shift = now - rec.at;
    for (const d of rec.items) {
      const i = itemOf(d);
      if (i.type === 'Image' && /covers\//.test(i.state)) i.state = covers[`./covers/${i.state.split('/').pop()}`] ?? 'NULL';
      if (i.changedAt) i.changedAt += this.shift;
      if (i.updatedAt) i.updatedAt += this.shift;
      this.items.set(i.name, i);
      const v = numOf(i.state);
      if (v != null && i.type.startsWith('Number')) this.base.set(i.name, v);
    }
    this.structure++;
    this.setStatus('live');
    this.structureListeners.forEach((fn) => fn());
    this.listeners.forEach((fn) => fn([...this.items.keys()]));
    this.timer = window.setInterval(() => this.tick(), 3000);
  }
  stop() { clearInterval(this.timer); this.items.clear(); this.base.clear(); this.setStatus('signed-out'); }

  private set(i: Item, state: string) { this.items.set(i.name, { ...i, state, changedAt: Date.now(), updatedAt: Date.now() }); }

  // The house breathes: room temperatures drift around what they were, the
  // battery's flow and the house's draw move, the charge drains, the sun goes on.
  private tick() {
    const changed: string[] = [];
    const move = (i: Item | undefined, step: number, spread: number, digits = 2) => {
      if (!i) return;
      const was = numOf(i.state), from = this.base.get(i.name);
      if (was == null || from == null) return;
      const v = Math.round(jitter(was, step, from - spread, from + spread) * 10 ** digits) / 10 ** digits;
      this.set(i, withUnit(i, v));
      changed.push(i.name);
    };
    for (const i of this.items.values()) {
      if (i.type === 'Number:Temperature' && i.semantics?.value === 'Point_Measurement' && i.semantics.config?.relatesTo === 'Property_Temperature') move(i, 0.04, 0.5);
      else if (i.type === 'Number:Power' && /battery|load/i.test(i.name) && i.semantics?.value === 'Point_Measurement') move(i, 0.03, 0.4, 3);
    }
    const soc = this.items.get('EMS_Battery_SoC'), v = soc && numOf(soc.state);
    if (soc && v != null) { this.set(soc, withUnit(soc, Math.round((v - 0.01) * 100) / 100)); changed.push(soc.name); }
    const az = this.items.get('Sun_Azimuth'), a = az && numOf(az.state);
    if (az && a != null) { this.set(az, withUnit(az, Math.round(((a + 0.0125) % 360) * 1000) / 1000)); changed.push(az.name); }
    if (changed.length) this.listeners.forEach((fn) => fn(changed));
  }

  // A command answered a moment later as openHAB would echo it.
  async act(a: Act) {
    if (a.kind === 'open') { window.open(a.url, '_blank', 'noopener'); return; }
    await new Promise((r) => setTimeout(r, 400));
    const i = this.items.get(a.item);
    if (!i) throw new Error(`${a.item} is not an item`);
    const next = applied(i, a.command);
    if (next == null) throw new Error(`${a.item} does not take ${a.command}`);
    this.set(i, next);
    this.listeners.forEach((fn) => fn([a.item]));
  }

  // The day as recorded (the room temperatures, the flows, the charge), moved to now; nothing for the rest.
  async history(names: string[], hours: number) {
    const since = Date.now() - hours * 3_600_000, out: Record<string, HistoryRow[]> = {};
    for (const name of names) out[name] = (rec.history[name] ?? []).map(([at, s]) => ({ s, lu: (at + this.shift) / 1000 })).filter((r) => r.lu * 1000 >= since);
    return out;
  }
}

// What an item's state becomes after a command, as openHAB would echo it; null when the item does not take it.
export function applied(i: Item, command: string): string | null {
  const n = numOf(command), pct = (v: number) => String(Math.max(0, Math.min(100, Math.round(v))));
  switch (i.type) {
    case 'Switch': return command === 'ON' || command === 'OFF' ? command : null;
    case 'Dimmer': return command === 'ON' ? '100' : command === 'OFF' ? '0' : n != null ? pct(n) : null;
    case 'Color': {
      const hsb = hsbOf(i.state) ?? [0, 0, 0];
      if (command === 'ON') return `${hsb[0]},${hsb[1]},100`;
      if (command === 'OFF') return `${hsb[0]},${hsb[1]},0`;
      if (hsbOf(command)) return command;
      return n != null ? `${hsb[0]},${hsb[1]},${pct(n)}` : null;
    }
    case 'Rollershutter': return command === 'UP' ? '0' : command === 'DOWN' ? '100' : command === 'STOP' ? i.state : n != null ? pct(n) : null;
    case 'Player': return command === 'PLAY' || command === 'PAUSE' ? command : /^(NEXT|PREVIOUS|REWIND|FASTFORWARD)$/.test(command) ? i.state : null;
    case 'String': return command;
    case 'Contact': case 'Image': case 'Location': case 'DateTime': case 'Group': return null;
  }
  return i.type.startsWith('Number') && n != null ? withUnit(i, n) : null;
}
