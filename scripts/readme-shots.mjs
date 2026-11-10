// Development: the README's pictures that come from the demo homes, taken with
// Playwright into docs/images/ (the ones of the card inside Home Assistant's own
// frontend are ha-check-card.mjs's). Starts the dev server on 5174 unless it
// answers already. Each picture sets the viewer's choices in localStorage before
// the page loads, as the gear would have kept them.
//   board-aurora, bg-aurora, bg-contours, bg-grain   the board over each abstract ground
//   people-where                                     People, the map around home
//   assist                                           Assist after a question from its ring
// node scripts/readme-shots.mjs [only…]
/* global localStorage */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const out = 'docs/images';
const only = process.argv.slice(2);
const wanted = (name) => !only.length || only.some((o) => name.startsWith(o));
const PAGE = 'http://127.0.0.1:5174/';
const answers = async () => { try { return (await fetch(PAGE)).ok; } catch { return false; } };
let server;
if (!(await answers())) {
  server = spawn('npx', ['vite', '--port', '5174'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
  for (let i = 0; i < 80 && !(await answers()); i++) await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch();

// One picture: the saved choices, the address, the size it is kept at, what to do first.
const shot = async (name, query, settings = {}, scale = 1, act = async () => {}) => {
  if (!wanted(name)) return;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  await context.addInitScript((value) => { localStorage.setItem('pulse-ha-settings', JSON.stringify(value)); }, settings);
  const page = await context.newPage();
  await page.goto(`${PAGE}?${query}`);
  await page.locator('.board [data-system]').first().waitFor({ state: 'attached', timeout: 15_000 });
  await page.waitForTimeout(1200);
  const current = () => page.locator('.z-view.is-current-view');
  await act({ page, current,
    enter: async (id) => { await current().locator(`[data-system="${id}"]`).first().click(); await current().locator('.layer-front .disc').waitFor(); await page.waitForTimeout(1300); } });
  await page.mouse.move(1278, 798);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 });
  console.log(`${out}/${name}.jpg`);
  await context.close();
};

const ground = (art) => ({ look: { ground: 'art', art } });
await shot('board-aurora', 'demo=home&mode=orbit', ground('aurora'));
for (const art of ['aurora', 'contours', 'grain']) await shot(`bg-${art}`, 'demo=home&mode=orbit', ground(art), 0.5);
await shot('people-where', 'demo=arsaboo&mode=orbit', {}, 1, async (t) => {
  await t.enter('people');
  await t.current().locator('.layer-index [data-pick="where"]').click();
  await t.page.waitForTimeout(3000);   // the layer comes forward, the map's tiles load
});
await shot('assist', 'demo=home&mode=orbit', {}, 1, async (t) => {
  await t.enter('assist');
  // An arc's box is its whole ring, the face in the middle of it: the click goes to the arc itself.
  await t.current().locator('.layer-front o-arc[role="radio"][aria-label="Lights on?"]').evaluate((arc) => arc.click());
  await t.page.waitForTimeout(1800);
});

await browser.close();
server?.kill();
