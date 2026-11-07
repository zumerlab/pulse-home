// Development: record two short videos of the app over a demo home, for a post
// or a page: `board` (the four views, the home by room, the themes and the
// backgrounds) and `inside` (into a system: a dial, a detail, a choice, the
// switches of a ring, the month of a meter, what plays). Playwright drives
// Chromium with a drawn cursor and records the window; with an ffmpeg given,
// each recording becomes an mp4 (H.264), otherwise the webm stays. Starts the
// dev server on PULSE_PORT (5174) unless one answers already.
// node scripts/record-tour.mjs <out-dir> [ffmpeg]
/* global document, localStorage */
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, renameSync, unlinkSync } from 'node:fs';

const out = process.argv[2] ?? 'tour';
const ffmpeg = process.argv[3] ?? process.env.FFMPEG;
const PORT = process.env.PULSE_PORT ?? '5174';
const HA = `http://127.0.0.1:${PORT}`;
const VIEW = { width: 1280, height: 800 };
const VIDEO = { width: 1920, height: 1200 };
mkdirSync(out, { recursive: true });

const answers = async () => { try { return (await fetch(HA)).ok; } catch { return false; } };
let server;
if (!(await answers())) {
  server = spawn('npx', ['vite', '--port', PORT], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
  for (let i = 0; i < 80 && !(await answers()); i++) await new Promise((r) => setTimeout(r, 500));
}

// A cursor the recording can show: Chromium's screencast draws none.
const cursor = () => {
  try { if (!localStorage.getItem('pulse-ha-settings')) localStorage.setItem('pulse-ha-settings', '{"calm":"open"}'); } catch { /* no storage */ }
  const d = document.createElement('div');
  Object.assign(d.style, { position: 'fixed', left: '-11px', top: '-11px', width: '22px', height: '22px', borderRadius: '50%',
    border: '2px solid rgba(255,255,255,.95)', background: 'rgba(255,255,255,.28)', boxShadow: '0 0 0 1px rgba(0,0,0,.4), 0 2px 8px rgba(0,0,0,.45)',
    pointerEvents: 'none', zIndex: '2147483647', transition: 'scale .08s, background .08s', transform: 'translate(-100px,-100px)' });
  const at = (e) => { d.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; };
  document.addEventListener('pointermove', at, true);
  document.addEventListener('pointerdown', (e) => { at(e); d.style.background = 'rgba(255,255,255,.8)'; d.style.scale = '0.7'; }, true);
  document.addEventListener('pointerup', () => { d.style.background = 'rgba(255,255,255,.28)'; d.style.scale = '1'; }, true);
  const add = () => document.body.appendChild(d);
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
};

// Where to press an arc: its box is the whole ring, so the middle of the path
// that answers to it (Orbit's hit path) in the window's coordinates.
const arcPoint = (el) => {
  for (const path of el.shadowRoot?.querySelectorAll('path') ?? []) {
    const p = path.getPointAtLength(path.getTotalLength() / 2), m = path.getScreenCTM();
    if (!m) continue;
    const x = m.a * p.x + m.c * p.y + m.e, y = m.b * p.x + m.d * p.y + m.f;
    if (document.elementFromPoint(x, y) === el) return { x, y };
  }
  return null;
};

// Headless Chromium records the window at the screen's scale, not the emulated one: force it, for a sharp 1920×1200.
const SCALE = VIDEO.width / VIEW.width;
const browser = await chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`] });

const record = async (name, tour) => {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, recordVideo: { dir: out, size: VIDEO } });
  await context.addInitScript(cursor);
  const t0 = Date.now();
  const page = await context.newPage();
  const wait = (ms) => page.waitForTimeout(ms);
  const current = () => page.locator('.z-view.is-current-view');
  const front = () => current().locator('.layer-front');
  let pos = { x: VIEW.width / 2, y: VIEW.height / 2 };
  const glide = async (x, y, ms = 260) => { const n = 16; const from = pos; for (let i = 1; i <= n; i++) { await page.mouse.move(from.x + (x - from.x) * i / n, from.y + (y - from.y) * i / n); await wait(ms / n); } pos = { x, y }; };
  const press = async () => { await wait(120); await page.mouse.down(); await wait(80); await page.mouse.up(); };
  const centerOf = async (loc) => { const b = await loc.boundingBox({ timeout: 4000 }); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, b } : null; };
  const tap = async (loc) => { const c = await centerOf(loc.first()); if (!c) throw new Error('nothing to tap'); await glide(c.x, c.y); await press(); };
  const tapArc = async (loc) => { await loc.first().waitFor({ timeout: 4000 }); const c = await loc.first().evaluate(arcPoint); if (!c) throw new Error('no point on the arc'); await glide(c.x, c.y); await press(); };
  const gear = async (tab) => { if (await page.locator('.gear').getAttribute('aria-expanded') !== 'true') { await tap(page.locator('.gear')); await wait(400); } await tap(page.locator(`.settings [data-tab="${tab}"]`)); await wait(300); };
  const done = async () => { await tap(page.locator('.settings [data-settings-close]').last()); await wait(400); };
  const pick = async (sel, hold = 300) => { await tap(page.locator(`.settings ${sel}`)); await wait(hold); };
  const radio = (name, value) => `input[name="${name}"][value="${value}"] >> xpath=..`;
  const back = async () => {
    const views = await page.locator('.z-view').count();
    if (views < 2) return;
    const c = await centerOf(current()); await glide(c.x, c.y, 180);
    for (let i = 0; i < 2 && await page.locator('.z-view').count() === views; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 60); await page.keyboard.up('Control'); await wait(1300); }
  };
  const bring = async (key) => { await tap(current().locator(`.layer-index [data-pick="${key}"]`)); await wait(1200); };
  const enter = async (system) => { await tap(page.locator(`.tile[data-system="${system}"]`)); await front().locator('.disc').waitFor({ timeout: 5000 }); await wait(1100); };
  const detail = async (hold) => { await tap(front().locator('.disc')); await current().locator('.detail').waitFor({ timeout: 5000 }); await wait(hold); await back(); await wait(400); };
  const turnDial = async (deg) => {
    const knob = await centerOf(front().locator('.satellite.knob.at-value'));
    const disc = await centerOf(front().locator('.disc'));
    if (!knob || !disc) throw new Error('no dial');
    const r = Math.hypot(knob.x - disc.x, knob.y - disc.y), a0 = Math.atan2(knob.y - disc.y, knob.x - disc.x);
    await glide(knob.x, knob.y); await wait(200); await page.mouse.down();
    const n = 30; for (let i = 1; i <= n; i++) { const a = a0 + deg * Math.PI / 180 * i / n; await page.mouse.move(disc.x + r * Math.cos(a), disc.y + r * Math.sin(a)); await wait(22); }
    pos = { x: disc.x + r * Math.cos(a0 + deg * Math.PI / 180), y: disc.y + r * Math.sin(a0 + deg * Math.PI / 180) };
    await wait(200); await page.mouse.up();
  };
  const step = async (what, fn) => { try { await fn(); } catch (e) { console.log(`${name}: skipped ${what}: ${String(e.message).split('\n')[0]}`); } };
  let ready = t0;
  await tour({ page, wait, current, front, glide, tap, tapArc, gear, done, pick, radio, back, bring, enter, detail, turnDial, step, markReady: () => { ready = Date.now(); } });
  await wait(1500);
  const video = page.video();
  await context.close();
  const webm = await video.path();
  const file = `${out}/${name}.webm`;
  renameSync(webm, file);
  if (ffmpeg) {
    const ss = Math.max(0, (ready - t0) / 1000 - 0.1).toFixed(2);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', ss, '-i', file, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-movflags', '+faststart', '-an', `${out}/${name}.mp4`]);
    unlinkSync(file);
    console.log(`${name}.mp4 written (trimmed ${ss} s of start)`);
  } else console.log(`${name}.webm written`);
};

// 1. The board: the four views, the home by room, the themes and the grounds.
await record('board', async (t) => {
  const { page, wait, step, gear, done, pick, radio, markReady } = t;
  await page.goto(`${HA}/?demo=home&mode=grid`);
  await page.locator('.tile[data-system]').nth(5).waitFor();
  await wait(400); markReady(); await wait(1800);
  await step('views', async () => {
    await gear('board');
    for (const mode of ['orbit', 'layers', 'list']) await pick(radio('mode', mode), mode === 'orbit' ? 3200 : 2800);
    await pick(radio('mode', 'grid'), 1200);
    await pick(radio('axis', 'groups'), 3200);
    await pick(radio('axis', 'systems'), 800);
    await pick(radio('mode', 'orbit'), 600);
    await done(); await wait(2200);
  });
  await step('look', async () => {
    await gear('look');
    for (const theme of ['paper', 'deep', 'night', 'graphite']) await pick(`.theme-tile[data-theme-tile="${theme}"]`, theme === 'graphite' ? 1200 : 2600);
    await pick(radio('ground', 'art'), 600);
    for (const art of ['aurora', 'contours', 'grain']) await pick(`.art-tile[data-art-tile="${art}"]`, 2800);
    await pick(radio('ground', 'glow'), 600);
    await done(); await wait(2000);
  });
});

// 2. Inside: a system, its dial and its day, a choice, the switches of a ring, the month of a meter, what plays.
await record('inside', async (t) => {
  const { page, wait, step, tapArc, front, back, bring, enter, detail, turnDial, markReady } = t;
  await page.goto(`${HA}/?demo=home&mode=grid`);
  await page.locator('.tile[data-system]').nth(5).waitFor();
  await wait(400); markReady(); await wait(1400);
  await step('climate', async () => { await enter('climate'); await turnDial(40); await wait(1500); });
  await step('climate day', async () => { await detail(2200); });
  await step('mode', async () => { await bring('mode'); await tapArc(front().locator('o-arc[data-seg][aria-label="Auto"]')); await wait(1800); });
  await step('out of climate', async () => { await back(); await wait(700); });
  await step('lights', async () => { await enter('lights'); await tapArc(front().locator('o-arc[data-seg]').nth(1)); await wait(900); await tapArc(front().locator('o-arc[data-seg]').nth(4)); await wait(1300); });
  await step('brightness', async () => { await bring('brightness'); await turnDial(70); await wait(1400); });
  await step('lights day', async () => { await bring('lights'); await detail(2400); await back(); await wait(700); });
  await step('energy month', async () => { await enter('energy'); await detail(2400); await back(); await wait(700); });
  await step('media', async () => { await enter('media'); await detail(2200); await back(); await wait(500); });
});

await browser.close();
server?.kill();
console.log(`videos in ${out}/`);
