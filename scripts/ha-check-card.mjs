// Development: open the local Home Assistant's own frontend with the tokens of
// ha-tokens.mjs (seeded as `hassTokens`; nothing is typed), look at the two
// dashboards ha-install-card.mjs creates, exercise the gear and the card's
// visual editor, and save screenshots cropped to the card (no sidebar, no
// user). Prints what it found; exits 1 on a console error or a missing card.
// node ha-check-card.mjs <tokens.json> [out-dir] [ha-url]
/* global document, localStorage */
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const tok = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3] ?? 'ha-check';
const HA_URL = (process.argv[4] ?? tok.hassUrl ?? 'http://127.0.0.1:8123').replace(/\/$/, '');
mkdirSync(out, { recursive: true });
const hassTokens = { access_token: tok.access_token, refresh_token: tok.refresh_token, expires_in: tok.expires_in, expires: Date.now() + tok.expires_in * 1000, hassUrl: HA_URL, clientId: tok.clientId ?? `${HA_URL}/`, token_type: 'Bearer' };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
// The root redirects to the login before `evaluate` could run: seed on init.
await ctx.addInitScript((t) => { localStorage.setItem('hassTokens', JSON.stringify(t)); localStorage.setItem('selectedTheme', JSON.stringify({ dark: true })); }, hassTokens);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

// Elements through every shadow root, as boxes (Playwright locators pierce
// shadow DOM, but the clicks here go by coordinates to stay generic).
const deep = (sel) => page.evaluate((sel) => {
  const found = [];
  const walk = (n) => { for (const el of n.querySelectorAll('*')) { if (el.matches(sel)) found.push(el.getBoundingClientRect().toJSON()); if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(document);
  return found;
}, sel);
const cards = () => page.evaluate(() => {
  const found = [];
  const walk = (n) => { for (const el of n.querySelectorAll('*')) { if (el.localName === 'zumer-pulse') found.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(document);
  return found.map((c) => {
    const r = c.getBoundingClientRect(), sr = c.shadowRoot;
    return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, tiles: sr.querySelectorAll('.tile[data-system]').length,
      board: sr.querySelector('.board')?.className ?? '', inside: !!sr.querySelector('.z-view.is-current-view .system'),
      headline: sr.querySelector('.board h1')?.textContent?.trim() ?? '', arcs: sr.querySelectorAll('o-arc').length, compact: !!sr.querySelector('.zumly-canvas.compact') };
  });
});
const center = (b) => [b.x + b.width / 2, b.y + b.height / 2];
const shot = (name, box) => page.screenshot({ path: `${out}/${name}.png`, clip: box });
const report = [];

// 1. The dashboard strategy: the board, its three views, one system.
await page.goto(`${HA_URL}/pulse-demo/pulse`, { waitUntil: 'load' });
await page.waitForTimeout(6000);
let found = await cards();
report.push(['pulse-demo', found]);
if (found.length) {
  const box = found[0].box;
  await shot('dashboard-grid', box);
  // The switch between views waits in the gear (the board shows it only when asked): each view is chosen there.
  const view = async (mode) => {
    const [gearBtn] = await deep('.gear');
    if (!gearBtn) return false;
    await page.mouse.click(...center(gearBtn));
    await page.waitForTimeout(600);
    const [tab] = await deep('.settings [data-tab="board"]');
    if (tab) { await page.mouse.click(...center(tab)); await page.waitForTimeout(300); }
    const [radio] = await deep(`.settings input[name="mode"][value="${mode}"]`);
    if (radio) await page.mouse.click(...center(radio));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);
    return !!radio;
  };
  for (const mode of ['orbit', 'layers']) if (await view(mode)) await shot(`dashboard-${mode}`, box);
  await view('grid');
  const [gear] = await deep('.gear');
  if (gear) {
    await page.mouse.click(...center(gear));
    await page.waitForTimeout(800);
    await shot('dashboard-gear', box);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  const [tile] = await deep('.tile[data-system]');
  if (tile) {
    await page.mouse.click(...center(tile));
    await page.waitForTimeout(3000);
    await shot('dashboard-system', box);
  }
}

// 2. The sections dashboard: the strategy's section and the hand-placed card.
await page.goto(`${HA_URL}/pulse-sections/0`, { waitUntil: 'load' });
await page.waitForTimeout(6000);
found = await cards();
report.push(['pulse-sections', found]);
if (found.length) {
  const x0 = Math.min(...found.map((c) => c.box.x)) - 16, y0 = Math.min(...found.map((c) => c.box.y)) - 40;
  const x1 = Math.max(...found.map((c) => c.box.x + c.box.width)) + 16, y1 = Math.max(...found.map((c) => c.box.y + c.box.height)) + 16;
  await shot('sections', { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
}

// 3. The visual editor of the hand-placed card (edit mode, click the card).
await page.goto(`${HA_URL}/pulse-sections/0?edit=1`, { waitUntil: 'load' });
await page.waitForTimeout(4000);
found = await cards();
if (found.length) {
  const b = found[found.length - 1].box;
  await page.mouse.click(b.x + b.width / 2, b.y + 30);
  await page.waitForTimeout(3500);
  const form = page.locator('hui-dialog-edit-card ha-form');
  const fields = await form.locator('ha-selector').count();
  report.push(['editor', { fields, preview: (await cards()).length }]);
  await shot('editor', { x: 128, y: 40, width: 1024, height: 728 });
}

for (const [name, info] of report) console.log(name, JSON.stringify(info));
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
console.log(`screenshots in ${out}/`);
await browser.close();
const missing = report.filter(([, info]) => Array.isArray(info) && !info.length).map(([n]) => n);
if (errors.length || missing.length) { console.error('FAILED', missing.length ? `no card in ${missing.join(', ')}` : ''); process.exitCode = 1; }
