import { expect, test, type Page } from '@playwright/test';
import { HA } from '../playwright.config.ts';

const OPENHAB = `${HA}/openhab/`;

// Pulse for openHAB without a server: the connect panel, and the recorded house
// (openHAB's demo house one evening: the heating on in the living room with
// its window open, the garage door open and both locks unlocked at night, the
// office speaker playing), answering the commands in the browser. A real
// server is not part of the suite.

const current = (page: Page) => page.locator('.z-view.is-current-view');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('pulse-openhab-settings')) localStorage.setItem('pulse-openhab-settings', '{"calm":"open"}'); });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  (page as Page & { errors?: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { errors?: string[] }).errors).toEqual([]);
});

test('with no server answering, the app says so and offers the demo', async ({ page }) => {
  await page.goto(`${OPENHAB}?server=http://127.0.0.1:5999`);
  await expect(page.locator('.login h1')).toHaveText('Pulse');
  await expect(page.locator('.login .error')).toContainText('No openHAB answered at http://127.0.0.1:5999');
  await expect(page.locator('.login input[name="url"]')).toHaveValue('http://127.0.0.1:5999');
  await expect(page.locator('.zumly-canvas')).toBeHidden();
  await page.locator('[data-demo]').click();
  await expect(page).toHaveURL(/demo=1/);
  await expect(page.locator('.login')).toBeHidden();
  await expect(page.locator('.conn')).toContainText('Demo house · openHAB · live');
});

test('the recorded house fills eight systems, three things calling', async ({ page }) => {
  await page.goto(`${OPENHAB}?demo`);
  await expect(page.locator('.tile[data-system]')).toHaveCount(8);
  await expect(page.locator('.board h1')).toContainText('3 things calling');
  await expect(page.locator('.tile[data-system="lights"] .tile-big')).toHaveText('8 of 23');
  await expect(page.locator('.tile[data-system="media"] .tile-big')).toHaveText('1 of 3');
  await expect(page.locator('.tile[data-system="weather"] .tile-big')).toHaveText('1.6°');
  await expect(page.locator('.tile[data-system="energy"] .tile-big')).toHaveText(/^\d+ W$/);
});

test('the heating calls for the living room window; turned off there, the thermostat comes to the front with the room temperature behind it', async ({ page }) => {
  await page.goto(`${OPENHAB}?demo`);
  await page.locator('.tile[data-system="climate"]').click();
  const front = current(page).locator('.layer-front');
  await expect(front.locator('.face-name')).toHaveText('Heating');
  // While it calls, the face says what: the alert's words over the count.
  await expect(front.locator('.face-big')).toHaveText('Window open');
  await expect(front.locator('.face-label')).toHaveText('Living Room');
  await expect(current(page).locator('.strip')).toContainText('Heating in the living room with the window open');
  await current(page).locator('.strip [data-resolve]').click();
  // The demo takes the command, the alert goes, the first channel comes to the front: the thermostat of a room still
  // heating (the first by name), its face named after the room, its setpoint the dial.
  await expect(current(page).locator('.layer-front .face-name')).toHaveText('First Floor Corridor');
  await expect(current(page).locator('.layer-front .face-label')).toHaveText('target 20.5° · heating');
  await expect(current(page).locator('.layer-front o-progress[data-dial="thermostat"]')).toHaveAttribute('aria-valuenow', '20.5');
  await expect(current(page).locator('.strip')).not.toContainText('window open');
  // The temperature of the coldest room, with the day the server kept.
  await page.waitForTimeout(900);
  await current(page).locator('[data-pick="temperature"]').first().dispatchEvent('click');
  // The living room, the coldest, named on the face.
  await expect(current(page).locator('.layer-front .face-name')).toHaveText('Living Room');
  await expect(current(page).locator('.layer-front .face-big')).toHaveText(/^1[89](\.\d)?°$/);
  await current(page).locator('.layer-front .disc').click();
  // The detail is named after the room too, and shows the day the server kept.
  await expect(current(page).locator('.detail h1')).toContainText('Living Room');
  await expect(current(page).locator('.time-ring')).toBeVisible();
});

test('twenty-three lights are a swarm; a light picked in the detail\'s list is told ON and echoed', async ({ page }) => {
  await page.goto(`${OPENHAB}?demo`);
  await page.locator('.tile[data-system="lights"]').click();
  const front = current(page).locator('.layer-front');
  await expect(front.locator('.face-name')).toHaveText('Lights');
  await expect(front.locator('.face-big')).toHaveText('8 of 23');
  await expect(front.locator('.swarm-ring')).toHaveAttribute('data-count', '23');
  await expect(front.locator('o-arc[data-seg]')).toHaveCount(0);
  await front.locator('.disc').click();
  await expect(current(page).locator('.detail h1')).toContainText('Lights');
  // The detail names each light as a switch, over the day of all of them.
  const cellar = current(page).locator('.switches label', { hasText: 'Cellar Light' }).locator('input');
  await expect(cellar).not.toBeChecked();
  await cellar.check();
  await expect(current(page).locator('.switches label', { hasText: 'Cellar Light' }).locator('input')).toBeChecked();
  await expect(current(page).locator('.detail')).toContainText('9 of 23');
});

test('both locks unlocked at night call; Lock sends ON to each', async ({ page }) => {
  await page.goto(`${OPENHAB}?demo`);
  await page.locator('.tile[data-system="security"]').click();
  const front = current(page).locator('.layer-front');
  await expect(front.locator('.face-name')).toHaveText('Locks');
  await expect(front.locator('.face-big')).toHaveText('Unlocked');
  await expect(front.locator('.face-label')).toHaveText('Front Door Lock and Garage Door Lock');
  await expect(current(page).locator('.strip')).toContainText('Front Door Lock and Garage Door Lock unlocked at night');
  await current(page).locator('.strip [data-resolve]').click();
  await expect(current(page).locator('.layer-front .face-big')).toHaveText('2 of 2');
  await expect(current(page).locator('.strip')).not.toContainText('unlocked at night');
});

test('the office speaker plays with a drawn cover; paused from the ring, the house falls silent', async ({ page }) => {
  await page.goto(`${OPENHAB}?demo`);
  await page.locator('.tile[data-system="media"]').click();
  const front = current(page).locator('.layer-front');
  await expect(front.locator('.face-name')).toHaveText('Playing');
  await expect(front.locator('.face-big')).toHaveText('1 of 3');
  await expect(front.locator('.face-label')).toHaveText('Heavy Is The Crown · Linking Park');
  // The cover is the recorder's drawing, bundled with the app (inlined as a data URI when small).
  await expect(front.locator('.face-image')).toHaveAttribute('src', /^data:image\/svg\+xml|Office_Speaker_Cover.*\.svg$/);
  await expect(front.locator('.face-image')).toHaveAttribute('alt', 'Heavy Is The Crown · Linking Park');
  await front.locator('o-arc[data-seg][aria-label="Office Speaker"]').dispatchEvent('click');
  await expect(current(page).locator('.layer-front .face-big')).toHaveText('Silence');
});

test('on the rooms axis the eighteen rooms climb to their floors, each floor an object of its rooms', async ({ page }) => {
  await page.goto(`${OPENHAB}?demo&axis=groups`);
  // Four floors, the garden and the garage on none, and what is in no room at all (the energy system, the weather, the people).
  const tiles = page.locator('.tile[data-system]');
  await expect(tiles).toHaveCount(6);
  for (const title of ['Basement', 'Ground Floor', 'First Floor', 'Second Floor', 'Outside and elsewhere', 'The rest of the house']) await expect(tiles.filter({ hasText: title })).toHaveCount(1);
  await tiles.filter({ hasText: 'Ground Floor' }).click();
  await expect(current(page).locator('.sys-title')).toHaveText('Ground Floor');
  // The living room's heating calls on its floor too, so Heating is in front; the floor's seven lights are a ring of arcs.
  await expect(current(page).locator('.layer-front .face-name')).toHaveText('Heating');
  await expect(current(page).locator('.layer-front .face-big')).toHaveText('Window open');
  await page.waitForTimeout(900);
  await current(page).locator('[data-pick="lights/lights"]').first().dispatchEvent('click');
  await expect(current(page).locator('.layer-front .face-name')).toHaveText('Lights');
  await expect(current(page).locator('.layer-front .face-big')).toHaveText('5 of 7');
  await expect(current(page).locator('.layer-front o-arc[data-seg]')).toHaveCount(7);
});
