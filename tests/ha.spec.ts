import { expect, test, type Page } from '@playwright/test';
import { HA } from '../playwright.config.ts';

// The Home Assistant app without a Home Assistant: the sign-in, and the demo
// homes of demo.home-assistant.io (entities that answer service calls in the
// browser). Connecting to a real one needs saved tokens and is not part of
// the suite.

const current = (page: Page) => page.locator('.z-view.is-current-view');
// The gear open on one of its tabs.
const gearTo = async (page: Page, tab: 'content' | 'board' | 'look' | 'tune') => {
  if (await page.locator('.gear').getAttribute('aria-expanded') !== 'true') await page.locator('.gear').click();
  await page.locator(`.settings [data-tab="${tab}"]`).click();
};

test.beforeEach(async ({ page }) => {
  // While something calls, the board folds the calm systems away; most tests
  // reach into a calm one, so they start with the calm open (as a viewer who
  // opened it once). The tests of the fold start from empty settings.
  await page.addInitScript(() => { if (!localStorage.getItem('pulse-ha-settings')) localStorage.setItem('pulse-ha-settings', '{"calm":"open"}'); });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as Page & { errors?: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { errors?: string[] }).errors).toEqual([]);
});

test('with no saved tokens, the app asks to sign in and offers the demo homes', async ({ page }) => {
  await page.goto(HA);
  await expect(page.locator('.login h1')).toHaveText('Pulse');
  await expect(page.locator('.login [data-login="oauth"]')).toHaveText('Sign in with Home Assistant');
  await expect(page.locator('.login input[name="url"]')).toHaveValue(/^http/);
  await expect(page.locator('.zumly-canvas')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // The six homes of demo.home-assistant.io, the frontend's default first.
  await expect(page.locator('.login select[name="home"] option')).toHaveCount(6);
  await expect(page.locator('.login select[name="home"]')).toHaveValue('home');
  await expect(page.locator('[data-home-description]')).toContainText('two floors');
  // The token path needs both fields.
  await page.locator('.login summary').click();
  await page.locator('[data-login="token"]').click();
  await expect(page.locator('.login input[name="token"]')).toBeFocused();
});

test('a demo home opens from the sign-in panel and its entities answer the ring', async ({ page }) => {
  await page.goto(HA);
  await page.locator('.login select[name="home"]').selectOption('sections');
  await page.locator('[data-login="demo"]').click();
  await expect(page).toHaveURL(/\?demo=sections$/);
  await expect(page.locator('.login')).toBeHidden();
  await expect(page.locator('.conn')).toContainText('Home Assistant demo · Home Demo · live');
  // The way out is an icon next to the gear.
  await expect(page.locator('.exit')).toHaveAttribute('aria-label', 'Leave the demo');
  // That home fills every system: its motion sensors make Security, its updates Maintenance.
  await expect(page.locator('.tile[data-system]')).toHaveCount(9);
  await expect(page.locator('.tile[data-system="maintenance"] .tile-big')).toHaveText('Up to date');
  await expect(page.locator('.board h1')).not.toHaveText(/Connecting/);

  // A light segment toggles through the demo entity, confirmed a moment later like a real round trip.
  await page.locator('.tile[data-system="lights"]').click();
  await expect(current(page).locator('.system')).toBeVisible();
  const front = current(page).locator('.layer-front');
  await expect(front.locator('.face-big')).toHaveText('4 of 8');
  const seg = front.locator('o-arc[data-seg="0"]');
  await expect(seg).toHaveAttribute('aria-label', 'Bar lamp');
  const was = await seg.getAttribute('aria-checked');
  await seg.dispatchEvent('click');
  await expect(current(page).locator('.layer-front o-arc[data-seg="0"]')).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
  await expect(current(page).locator('.layer-front .face-big')).toHaveText(was === 'true' ? '3 of 8' : '5 of 8');
});

test('the index previews every demo home with the rings it fills, and opens one', async ({ page }) => {
  await page.goto(`${HA}/gallery.html`);
  // The two platforms side by side, each in its own words.
  await expect(page.locator('.home-card-live').first()).toContainText('Your Home Assistant');
  await expect(page.locator('.home-card-live').nth(1)).toContainText('Your openHAB');
  const cards = page.locator('[data-homes] .home-card');
  await expect(cards).toHaveCount(7);
  await expect(cards.first()).toContainText('Home page');
  await expect(cards.first().locator('.tile')).toHaveCount(7);
  await expect(cards.first().locator('.tile[data-system="climate"] .tile-big')).toHaveText('21.5°C');
  await expect(cards.nth(1).locator('.tile')).toHaveCount(8);
  await expect(cards.first()).toContainText(/\d+ entities in 7 systems/);
  // openHAB's demo house, previewed from its own model, among them.
  await expect(cards.last()).toContainText('Demo house');
  await expect(cards.last().locator('.home-tag')).toHaveText('openHAB');
  await expect(cards.last().locator('.tile')).toHaveCount(8);
  await expect(cards.last()).toContainText(/233 items in 8 systems/);
  await expect(cards.last()).toHaveAttribute('href', './openhab/index.html?demo');
  // No timers left running from the previews: the page stays quiet.
  await cards.nth(1).click();
  await expect(page).toHaveURL(/\?demo=sections$/);
  await expect(page.locator('.conn')).toContainText('Home Demo · live');
});

test('a shared link opens a demo home directly and leaving it returns to the sign-in', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await expect(page.locator('.conn')).toContainText('Home Assistant demo · Home page · live');
  // No updates or vacuums in that home, but two battery sensors, one at 15%:
  // Maintenance shows the low one.
  await expect(page.locator('.tile[data-system]')).toHaveCount(8);
  await expect(page.locator('.tile[data-system="maintenance"] .tile-big')).toHaveText('15%');
  // The alert says where: the sensor's area from the registry.
  await page.locator('.tile[data-system="maintenance"]').click();
  await expect(page.locator('.layer-front .face-label')).toContainText('bedroom');
  await page.locator('.z-nav-back').click();
  await expect(page.locator('.tile[data-system]')).toHaveCount(8);
  await page.locator('.exit').click();
  await expect(page.locator('.login h1')).toHaveText('Pulse');
  await expect(page).toHaveURL(`${HA}/`);
});

// The card (src/card/zumer-pulse.ts) on its bench, card.html: a `hass` object built
// from a demo home, the object inside the card's shadow root.
const card = (page: Page) => page.locator('zumer-pulse');

test('the card renders a demo home inside its shadow root and toggles a light through hass.callService', async ({ page }) => {
  await page.goto(`${HA}/card.html?home=sections`);
  const c = card(page);
  await expect(c.locator('.tile[data-system]')).toHaveCount(9);
  await expect(c.locator('.board h1')).toHaveText('All calm.');
  // Orbit's rings draw inside the shadow root: the registered properties reach it.
  await expect(c.locator('.tile[data-system="lights"] o-arc').first()).toBeVisible();
  await c.locator('.tile[data-system="lights"]').click();
  const front = c.locator('.z-view.is-current-view .layer-front');
  await expect(front.locator('.face-big')).toHaveText('4 of 8');
  const seg = front.locator('o-arc[data-seg="0"]');
  const was = await seg.getAttribute('aria-checked');
  await seg.dispatchEvent('click');
  await expect(c.locator('.z-view.is-current-view .layer-front .face-big')).toHaveText(was === 'true' ? '3 of 8' : '5 of 8');
});

test('the card takes its options: which systems, the board view, and the system to open inside', async ({ page }) => {
  const config = encodeURIComponent(JSON.stringify({ systems: ['lights', 'climate', 'security'], mode: 'layers' }));
  await page.goto(`${HA}/card.html?home=home&config=${config}`);
  const c = card(page);
  await expect(c.locator('.board')).toHaveClass(/mode-layers/);
  await expect(c.locator('.board .modes [aria-pressed="true"]')).toHaveText('Layers');
  await expect(c.locator('.board .layer[data-depth]')).toHaveCount(3);

  const start = encodeURIComponent(JSON.stringify({ systems: ['climate'], start: 'climate' }));
  await page.goto(`${HA}/card.html?home=sections&size=section&config=${start}`);
  await expect(card(page).locator('.z-view.is-current-view .system')).toBeVisible();
  await expect(card(page).locator('.z-view.is-current-view .layer-front .face-big')).toHaveText('21.7°C');
  // The board is one step back, with the one system.
  await expect(card(page).locator('.z-view.is-previous-view .tile[data-system]')).toHaveCount(1);
  await expect(card(page).locator('.gear')).toHaveCount(1);

  const locked = encodeURIComponent(JSON.stringify({ settings: false }));
  await page.goto(`${HA}/card.html?home=sections&config=${locked}`);
  await expect(card(page).locator('.tile[data-system]')).toHaveCount(9);
  await expect(card(page).locator('.gear')).toHaveCount(0);
});

test('the gear lets the viewer choose what this screen shows, kept in the browser', async ({ page }) => {
  await page.goto(`${HA}?demo=sections`);
  await expect(page.locator('.tile[data-system]')).toHaveCount(9);
  const gear = page.locator('.gear');
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await gear.click();
  const panel = page.locator('.settings');
  await expect(panel).toBeVisible();
  await expect(panel.locator('input[name="systems"]')).toHaveCount(10);
  // Four tabs, the first open and focused.
  await expect(panel.locator('[role="tab"]')).toHaveText(['Content', 'Board', 'Look', 'Tuning']);
  await expect(panel.locator('[data-tab="content"]')).toBeFocused();
  await panel.locator('input[name="systems"][value="media"]').uncheck();
  await expect(page.locator('.tile[data-system]')).toHaveCount(8);
  await panel.locator('[data-tab="board"]').click();
  await panel.locator('input[name="mode"][value="layers"]').check();
  await expect(page.locator('.board')).toHaveClass(/mode-layers/);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(gear).toBeFocused();
  // Remembered by this browser.
  await page.reload();
  await expect(page.locator('.board')).toHaveClass(/mode-layers/);
  // Every system is a layer; capped at three, the other three are named under the object, each a button.
  await expect(page.locator('.board .layer[data-depth]')).toHaveCount(8);
  await expect(page.locator('.board-strip .more')).toHaveCount(0);
  await gearTo(page, 'board');
  await panel.locator('select[name="layers"]').selectOption('3');
  await expect(page.locator('.board .layer[data-depth]')).toHaveCount(3);
  await expect(page.locator('.board-strip .more')).toHaveCount(5);
  await panel.locator('[data-settings-reset]').click();
  await expect(page.locator('.board')).toHaveClass(/mode-grid/);
  await expect(page.locator('.tile[data-system]')).toHaveCount(9);
});

test('the gear goes one level down: areas by floor, the channels of each system, the entity a dial follows', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await expect(page.locator('.tile[data-system]')).toHaveCount(8);
  await page.locator('.gear').click();
  const panel = page.locator('.settings');
  // The home's six areas, grouped by its two floors (the garden has none).
  await expect(panel.locator('input[name="groups"]')).toHaveCount(6);
  await expect(panel.locator('.settings-groups-list .settings-group-title')).toHaveText(['Ground floor', 'Upstairs', 'No floor']);
  // Without the bedroom, its 15% battery is out: the other one is the lowest.
  await panel.locator('input[name="groups"][value="bedroom"]').uncheck();
  await expect(page.locator('.tile[data-system="maintenance"] .tile-big')).toHaveText('88% lowest');
  await panel.locator('input[name="groups"][value="bedroom"]').check();
  await expect(page.locator('.tile[data-system="maintenance"] .tile-big')).toHaveText('15%');
  // A channel can be hidden while another has something (the notice takes over); the last one with something cannot.
  await panel.locator('input[name="channel"][value="maintenance/batteries"]').uncheck();
  await expect(page.locator('.tile[data-system="maintenance"] .tile-big')).toHaveText('1 notice');
  await panel.locator('input[name="channel"][value="maintenance/notices"]').click();
  await expect(panel.locator('input[name="channel"][value="maintenance/notices"]')).toBeChecked();
  await panel.locator('input[name="channel"][value="maintenance/batteries"]').check();
  await expect(page.locator('.tile[data-system="maintenance"] .tile-big')).toHaveText('15%');
  await panel.locator('input[name="channel"][value="lights/plugs"]').uncheck();
  // The brightness dial follows another light.
  const select = panel.locator('select[name="pick"][data-key="lights/brightness"]');
  await expect(select).toHaveValue('light.bedroom_ceiling');
  await select.selectOption('light.bedside_lamp');
  await expect(panel.locator('input[name="channel"][value="lights/brightness"] + *, label:has(input[value="lights/brightness"])').first()).toContainText('Bedside lamp brightness');
  await page.keyboard.press('Escape');
  await page.locator('.tile[data-system="lights"]').click();
  const view = page.locator('.z-view.is-current-view');
  await expect(view.locator('.layer[data-ch]')).toHaveCount(2);
  await expect(view.locator('.layer[data-ch="brightness"]')).toContainText('Bedside lamp brightness');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('pulse-ha-settings')!))).toMatchObject({
    channels: { lights: ['plugs'] }, picks: { 'lights/brightness': 'light.bedside_lamp' } });
});

test('the card takes areas: only what is in them, and the gear offers no areas when one is left', async ({ page }) => {
  await page.goto(`${HA}/card.html?home=home&config=${encodeURIComponent(JSON.stringify({ areas: ['kitchen'] }))}`);
  const c = card(page);
  await expect(c.locator('.tile[data-system]')).toHaveCount(5);
  await expect(c.locator('.tile[data-system="lights"] .tile-big')).toHaveText(/of 2/);
  // Assist is the home as a whole: it stays whatever areas are chosen; the people, who have no area, do not.
  await expect(c.locator('.tile[data-system="assist"]')).toHaveCount(1);
  await expect(c.locator('.tile[data-system="people"]')).toHaveCount(0);
  await c.locator('.gear').click();
  await expect(c.locator('.settings-groups')).toBeHidden();
});

test('the URL fixes what the page shows and the gear chooses within it', async ({ page }) => {
  await page.goto(`${HA}?demo=sections&systems=lights,climate,security&mode=orbit`);
  await expect(page.locator('.board')).toHaveClass(/mode-orbit/);
  await expect(page.locator('.otile[data-system]')).toHaveCount(3);
  await page.locator('.gear').click();
  await expect(page.locator('.settings input[name="systems"]')).toHaveCount(3);
  await expect(page.locator('.settings select[name="start"] option')).toHaveCount(4);
});

// ─── The primitives beyond the dial and the switches ───

const bring = async (page: Page, key: string) => {
  const view = current(page);
  if (await view.locator(`.layer-front[data-ch="${key}"]`).count()) return;
  await view.locator(`[data-pick="${key}"]`).first().dispatchEvent('click');
  // (the layer itself is a zero-width gravity-spot: its disc is what shows)
  await expect(view.locator(`.layer-front[data-ch="${key}"] .disc`)).toBeVisible();
  await expect(view.locator('.stage')).not.toHaveClass(/is-locked/);
};

test('a camera fills the face of its layer, opens as an object of its own, and its detail shows it round or square', async ({ page }) => {
  await page.goto(`${HA}?demo=arsaboo`);
  await page.locator('.tile[data-system="security"]').click();
  await bring(page, 'cameras');
  const front = current(page).locator('.layer-front');
  await expect(front.locator('.disc.has-image .face-image')).toHaveAttribute('src', /camera\.backyard\.jpg\?t=\d+/);
  await expect(front.locator('.face-big')).toHaveText('Live');
  await expect(front.locator('.face-label')).toHaveText('4 cameras');
  // The face is the camera it shows: tapping it opens that camera as an object, its picture in front.
  await front.locator('.disc').click();
  await expect(current(page).locator('.sys-title')).toHaveText('Backyard');
  const view = current(page).locator('.layer-front[data-ch="view"]');
  await expect(view.locator('.disc.has-image .face-image')).toHaveAttribute('src', /camera\.backyard\.jpg/);
  await expect(view.locator('.face-big')).toHaveText('Live');
  // A segment of the ring opens another camera.
  await page.locator('.z-nav-back').click();
  await expect(page.locator('.z-view')).toHaveCount(2);   // (the zoom back over: a tap during it is lost)
  await front.locator('o-arc[data-seg][aria-label="Patio"]').dispatchEvent('click');
  await expect(current(page).locator('.sys-title')).toHaveText('Patio');
  // The camera's detail: the picture round like the face, or square.
  await current(page).locator('.layer-front [data-to="detail"]').click();
  const figure = current(page).locator('.detail-image');
  await expect(figure.locator('img')).toHaveAttribute('alt', 'Patio');
  await expect(figure).not.toHaveClass(/is-square/);
  await figure.locator('[data-shape]').click();
  await expect(figure).toHaveClass(/is-square/);
  await expect(figure.locator('[data-shape]')).toHaveText('Show round');
  // The demo cannot stream: no live button.
  await expect(figure.locator('[data-live]')).toHaveCount(0);
});

test('a choice on the ring: the thermostat mode is a radio group, and tapping an option sets it', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="climate"]').click();
  await bring(page, 'mode');
  const front = current(page).locator('.layer-front');
  await expect(front.locator('.face-name')).toHaveText('Thermostat mode');
  await expect(front.locator('.face-big')).toHaveText('Heat');
  const radios = front.locator('o-arc[role="radio"]');
  await expect(radios).toHaveCount(3);
  await expect(front.locator('o-arc[role="radio"][aria-checked="true"]')).toHaveAttribute('aria-label', 'Heat');
  // The names run along the inside of the ring; the chosen one is lit.
  expect(await front.locator('.choice-label').evaluateAll((l) => l.map((x) => x.getAttribute('data-label')))).toEqual(['Auto', 'Heat', 'Off']);
  await expect(front.locator('.choice-label.is-on')).toHaveAttribute('data-label', 'Heat');
  await front.locator('o-arc[role="radio"][aria-label="Auto"]').dispatchEvent('click');
  await expect(front.locator('.face-big')).toHaveText('Auto');
  await expect(front.locator('o-arc[role="radio"][aria-checked="true"]')).toHaveAttribute('aria-label', 'Auto');
  // One entity, chosen on the ring: there is no detail to open (it would repeat the face).
  await expect(front.locator('.disc')).not.toHaveClass(/zoom-me/);
});

test('a thermostat with a range has two knobs, and one end never crosses the other', async ({ page }) => {
  await page.goto(`${HA}?demo=arsaboo`);
  await page.locator('.tile[data-system="climate"]').click();
  await bring(page, 'ecobee');
  const front = current(page).locator('.layer-front');
  await expect(front.locator('.face-label')).toHaveText('between 20° and 24°');
  const lo = front.locator('.knob[data-handle="lo"]'), hi = front.locator('.knob[data-handle="hi"]');
  await expect(lo).toHaveAttribute('aria-valuetext', '20°');
  await expect(hi).toHaveAttribute('aria-valuetext', '24°');
  await hi.focus();
  await page.keyboard.press('ArrowRight');
  await expect(front.locator('.face-label')).toHaveText('between 20° and 25°');
  // The low end cannot go past the high one.
  await lo.focus();
  await page.keyboard.press('End');
  await expect(front.locator('.face-label')).toHaveText('between 25° and 25°');
  // The command went out and the demo took it.
  await expect(front.locator('.face-label')).toHaveText('between 25° and 25°');
  // The range is set on the face, of one entity: no detail (it would draw the same band again).
  await expect(front.locator('.disc')).not.toHaveClass(/zoom-me/);
});

test("a numeric channel's detail draws its last 24 hours as a ring", async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="climate"]').click();
  await bring(page, 'humidity');
  await current(page).locator('.layer-front .disc').click();
  const ring = current(page).locator('.time-ring');
  // Sectors from a baseline, the current hour at the top; the center says now and the day's range.
  await expect(ring).toHaveAttribute('aria-label', /^last 24 hours: 5\d–6\d%$/);
  // Two sectors an hour, the half hours interpolated; the current one is the last, at the top.
  await expect(ring.locator('.time-bar')).toHaveCount(47);
  await expect(ring.locator('.time-bar.is-now')).toHaveAttribute('title', /^now: 52%/);
  await expect(ring.locator('.time-bar[title]')).toHaveCount(24);
  await expect(ring.locator('.time-big')).toHaveText('52%');
  await expect(ring.locator('.time-range')).toHaveText(/^5\d–6\d%$/);
  // Bare by default; the gear can add the hour marks.
  await expect(ring.locator('.time-tick')).toHaveCount(0);
});

test("a switched channel's detail draws a day per entity as rings, outside in, named on themselves with the hours around, and a tap on a ring toggles it", async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="lights"]').click();
  await current(page).locator('.layer-front .disc').click();
  const rings = current(page).locator('.timeline');
  await expect(rings).toHaveAttribute('aria-label', 'The last 24 hours of Lights');
  // The home has nine lights: eight rings (the outermost is the first light), each on its own orbit.
  await expect(rings.locator('.track')).toHaveCount(8);
  await expect(rings.locator('.track').first()).toHaveClass(/orbit-12/);
  await expect(rings.locator('.track').last()).toHaveClass(/orbit-5/);
  // Each ring says which light it is, and the hours go around.
  await expect(rings.locator('.track-name')).toHaveCount(8);
  await expect(rings.locator('.track-name').first()).toContainText('Ceiling light');
  await expect(rings.locator('.time-tick')).toHaveCount(24);
  await expect(rings.locator('.time-hour')).toHaveCount(4);
  await expect(rings.locator('.time-hour.is-now')).toContainText('now');
  const spans = await rings.locator('.track-span').count();
  expect(spans).toBeGreaterThan(0);
  // What is now sits in the center; the header's big number moved there.
  await expect(rings.locator('.time-big')).toHaveText('4 of 9');
  await expect(current(page).locator('.detail-big')).toHaveCount(0);
  await expect(current(page).locator('.rings-order')).toHaveText('The rings, outside in (the first 8):');
  // The rings that are on now reach the top; three of the eight (the ninth light is on too).
  await expect(rings.locator('.track.is-on')).toHaveCount(3);
  // A tap on a ring (its faint track or a span) toggles that light.
  const first = rings.locator('.track.is-on').first();
  const entity = await first.locator('.track-back').getAttribute('data-track');
  await first.locator('.track-back').evaluate((e) => (e as HTMLElement).click());
  await expect(rings.locator('.track.is-on')).toHaveCount(2);
  await expect(rings.locator('.time-big')).toHaveText('3 of 9');
  await expect(current(page).locator(`.switches input[data-seg]`).nth(await rings.locator('.track').evaluateAll((l, id) => l.findIndex((x) => x.querySelector('[data-track]')?.getAttribute('data-track') === id), entity))).not.toBeChecked();
});

test("the heating's detail puts the windows under the thermostat's ring and names the open ones at their hour", async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="climate"]').click();
  await current(page).locator('.layer-front .disc').click();
  const rings = current(page).locator('.timeline');
  // The thermostat, then the two windows in the alert's color.
  await expect(rings.locator('.track')).toHaveCount(3);
  await expect(rings.locator('.track.warn')).toHaveCount(2);
  await expect(rings.locator('.time-big')).toHaveText('21.5°C');
  // The two open windows are named at their hour (the demo gives each a random
  // one): two words, or one for both when they fall within the same half hour.
  await expect(rings.locator('.time-event').first()).toHaveText(/open$/);
  expect(await rings.locator('.time-event').count()).toBeLessThanOrEqual(2);
  await expect(rings.locator('.time-event.warn')).toHaveCount(await rings.locator('.time-event').count());
  // The dial stays under the rings: the band itself, with its knob, the target in its center.
  const dial = current(page).locator('.detail-ring');
  await expect(dial.locator('o-progress[data-dial="heating"]')).toHaveCount(1);
  await expect(dial.locator('.ring-big')).toHaveText('21°');
  await expect(dial.locator('.ring-label')).toHaveText('target');
  // The keyboard moves it there too, and the command goes out after a pause.
  await dial.locator('[data-dial="heating"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dial.locator('.ring-big')).toHaveText('20°');
  await expect(dial.locator('o-progress[data-dial="heating"]')).toHaveAttribute('aria-valuenow', '20');
});

test('the gear can open the dial at the bottom and put hour marks on the day ring', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await gearTo(page, 'look');
  await page.locator('.settings input[name="dial"][value="open"]').check();
  await page.locator('.settings input[name="day"][value="marks"]').check();
  await page.keyboard.press('Escape');
  await page.locator('.tile[data-system="climate"]').click();
  const front = current(page).locator('.layer-front');
  // The thermostat's band runs from 225° through the top to 135°, its ends named, a mark at the measurement.
  await expect(front.locator('.orbit-12').first()).toHaveAttribute('style', /--o-from: ?225deg; --o-range: ?270deg/);
  await expect(front.locator('.dial-end')).toHaveText(['7°', '35°']);
  await expect(front.locator('.now-mark')).toHaveCount(1);
  // The keyboard still moves the target by its step (down: up would heat with the windows open and raise the alert).
  const dial = front.locator('[data-dial]');
  await expect(dial).toHaveAttribute('aria-valuenow', '21');
  await dial.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dial).toHaveAttribute('aria-valuenow', '20');
  // The day ring, in a detail, carries its marks.
  await bring(page, 'humidity');
  await current(page).locator('.layer-front .disc').click();
  const ring = current(page).locator('.time-ring.has-marks');
  await expect(ring.locator('.time-tick')).toHaveCount(24);
  await expect(ring.locator('.time-hour')).toHaveCount(4);
});

test('a color light takes its hue and saturation from two curved sliders inside its brightness dial', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.gear').click();
  await page.locator('select[name="pick"][data-key="lights/brightness"]').selectOption('light.living_room_floor_lamp');
  await page.keyboard.press('Escape');
  await page.locator('.tile[data-system="lights"]').click();
  await bring(page, 'brightness');
  await current(page).locator('.layer-front .disc').click();
  const ring = current(page).locator('.detail-ring');
  // The brightness dial, the hue around inside it, the saturation inside that: three sliders, one object.
  await expect(ring.locator('o-progress[data-dial="brightness"]')).toHaveCount(1);
  await expect(ring.locator('.hue-ring o-arc')).toHaveCount(36);
  const hue = ring.locator('.ring-grab[data-dial="brightness:hue"]'), sat = ring.locator('.ring-grab[data-dial="brightness:sat"]');
  await expect(hue).toHaveAttribute('aria-label', 'Hue of Floor lamp brightness');
  // White light: no hue yet.
  await expect(ring.locator('.hue-ring')).toHaveClass(/is-unset/);
  await hue.focus();
  await page.keyboard.press('ArrowRight');
  await expect(hue).toHaveAttribute('aria-valuenow', '5');
  await expect(sat).toHaveAttribute('aria-valuenow', '100');
  await expect(ring.locator('.hue-ring')).not.toHaveClass(/is-unset/);
  await expect(ring.locator('.ring-center')).toHaveClass(/has-color/);
  // After the pause the light gets the color, and the reading keeps it.
  await page.waitForTimeout(900);
  await page.keyboard.press('Tab');
  await expect(current(page).locator('.ring-grab[data-dial="brightness:hue"]')).toHaveAttribute('aria-valuenow', '5');
  await expect(current(page).locator('.hue-ring')).not.toHaveClass(/is-unset/);
  // Back on the ring, the dial takes the light's color.
  await page.locator('.z-nav-back').click();
  await expect(current(page).locator('.layer-front .dial')).toHaveAttribute('style', /--o-fill:\s*(hsl\(5 100% 50%\)|rgb\(255,\s*21,\s*0\))/);
});

test('the hue and the saturation rings are dragged with the pointer, like the brightness dial around them', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.gear').click();
  await page.locator('select[name="pick"][data-key="lights/brightness"]').selectOption('light.living_room_floor_lamp');
  await page.keyboard.press('Escape');
  await page.locator('.tile[data-system="lights"]').click();
  await bring(page, 'brightness');
  await current(page).locator('.layer-front .disc').click();
  const ring = current(page).locator('.detail-ring');
  await expect(ring.locator('.ring-grab[data-dial="brightness:sat"]')).toBeVisible();
  const box = (await ring.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, R = box.width / 2;
  // A point on the ring at orbit n (of 12), at `a` radians clockwise from the top.
  const at = (n: number, a: number): [number, number] => [cx + R * n / 12 * Math.sin(a), cy - R * n / 12 * Math.cos(a)];
  const drag = async (n: number) => {
    const [x0, y0] = at(n, 1), [x1, y1] = at(n, 2.4);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
    await page.mouse.up();
  };
  // The hue ring (orbit 10): from white, a drag to ~137° gives that hue.
  await drag(10);
  const hue = ring.locator('.ring-grab[data-dial="brightness:hue"]');
  await expect(hue).toHaveAttribute('aria-valuenow', /^13\d$/);
  await expect(ring.locator('.hue-ring')).not.toHaveClass(/is-unset/);
  // The saturation ring (orbit 8): the same drag leaves it near 38 %.
  await drag(8);
  await expect(ring.locator('.ring-grab[data-dial="brightness:sat"]')).toHaveAttribute('aria-valuenow', /^3\d$/);
  // The drags were drags: the detail is still open, no zoom in or out happened.
  await page.waitForTimeout(600);
  await expect(ring).toBeVisible();
});

test('a control of one entity resolved on the face has no detail; a channel with more to show opens one', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="security"]').click();
  // The alarm: one entity, its modes chosen on the ring. The disc is the face, nothing to open.
  const disc = current(page).locator('.layer-front .disc');
  await expect(disc).toContainText('Alarm');
  await expect(disc).not.toHaveClass(/zoom-me/);
  await expect(disc).not.toHaveAttribute('role', 'button');
  // The sensors: several entities to name, and a day of them. The disc opens the detail.
  await bring(page, 'sensors');
  await expect(current(page).locator('.layer-front .disc')).toHaveClass(/zoom-me/);
  await current(page).locator('.layer-front .disc').click();
  await expect(current(page).locator('.detail h1')).toContainText('Sensors');
});

test('an alarm that asks for a code opens the keypad over the object: a wrong code is refused, the right one arms, Escape cancels', async ({ page }) => {
  // Kernehed's panel has a code_format (anything): a text code, with the digits on the keys too.
  await page.goto(`${HA}?demo=kernehed`);
  await page.locator('.tile[data-system="security"]').click();
  await bring(page, 'alarm');
  const view = current(page), layer = view.locator('.layer-front[data-ch="alarm"]'), pad = view.locator('.keypad');
  await layer.locator('o-arc[data-seg][aria-label="Away"]').dispatchEvent('click');
  // A phone's keypad over the object (dimmed behind); the strip says what the code is for.
  await expect(pad).toBeVisible();
  await expect(pad.locator('button[data-key]')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
  await expect(pad.locator('.keypad-title')).toContainText('Alarm · Away');
  await expect(view.locator('.obj')).toHaveClass(/is-waiting/);
  await expect(view.locator('.strip')).toContainText('Alarm: the code for Away.');
  const input = pad.locator('.code-input'), send = pad.locator('[data-code="enter"]');
  await expect(send).toBeDisabled();
  await expect(send).toHaveText('Away');
  for (const d of ['1', '1']) await pad.locator(`[data-key="${d}"]`).click();
  await expect(input).toHaveValue('11');
  await send.click();
  // Refused: the keypad says so, the code is gone, the keypad stays.
  await expect(pad).toHaveClass(/is-wrong/);
  await expect(pad.locator('.keypad-hint')).toContainText('not accepted');
  await expect(view.locator('.strip')).toContainText('Invalid alarm code');
  await expect(input).toHaveValue('');
  for (const d of ['1', '2', '3', '3']) await pad.locator(`[data-key="${d}"]`).click();
  await expect(pad).not.toHaveClass(/is-wrong/);
  await pad.locator('[data-code="delete"]').click();
  await expect(input).toHaveValue('123');
  await pad.locator('[data-key="4"]').click();
  await send.click();
  // Accepted: the keypad goes, the object arms (an alert of the armed home may then take the front).
  await expect(pad).toHaveCount(0);
  await expect(view.locator('.obj')).not.toHaveClass(/is-waiting/);
  await expect(view.locator('.layer-item[data-pick="alarm"]')).toContainText('Away', { timeout: 5000 });
  // Disarming asks too; the keyboard types the code and Escape closes the keypad without sending.
  await bring(page, 'alarm');
  await layer.locator('o-arc[data-seg][aria-label="Disarmed"]').dispatchEvent('click');
  await expect(pad).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pad).toHaveCount(0);
  await expect(layer.locator('.disc')).toContainText('Away');
});

test('an alarm that arms without a code still does it in one tap', async ({ page }) => {
  // The main demo home's panel: no code_format, code_arm_required false.
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="security"]').click();
  await bring(page, 'alarm');
  const layer = current(page).locator('.layer-front[data-ch="alarm"]');
  await layer.locator('o-arc[data-seg][aria-label="Home"]').dispatchEvent('click');
  await expect(current(page).locator('.keypad')).toHaveCount(0);
  await expect(layer.locator('.disc')).toContainText(/Arming|Home/);
});

test('the board groups by room too: each area one object, what has no area in its own room, and the gear switches the axis', async ({ page }) => {
  await page.goto(`${HA}?demo=home&axis=rooms`);
  const tiles = page.locator('.tile[data-system]');
  await expect(tiles).toHaveCount(7);
  const ids = await tiles.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.system));
  expect(ids.every((id) => id!.startsWith('room:'))).toBe(true);
  // What calls first, by urgency; within a level, floor by floor (the ground floor first), then the room of what has no area.
  const levels = await tiles.evaluateAll((els) => els.map((e) => Number(/level-(\d)/.exec(e.className)?.[1] ?? 0)));
  expect(levels).toEqual([...levels].sort((a, b) => b - a));
  const calm = ids.filter((_, i) => !levels[i]);
  expect(calm[calm.length - 1]).toBe('room:');
  expect(ids).toContain('room:entrance');
  await expect(page.locator('.tile[data-system="room:"] .tile-title')).toHaveText('No area');
  // A room is an object like a system: its channels are the systems' channels, read within the area.
  await page.locator('.tile[data-system="room:kitchen"]').click();
  await expect(current(page).locator('.sys-title')).toHaveText('Kitchen');
  const items = current(page).locator('.layer-index .layer-item');
  await expect(items.first()).toContainText('Lights');
  await expect(items).toHaveCount(7);
  await expect(current(page).locator('.layer-index')).toContainText('Humidity');
  await page.locator('.z-nav-back').click();
  // The gear switches back to the systems; and the choice is kept for this browser.
  await gearTo(page, 'board');
  await page.locator('input[name="axis"][value="systems"]').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tile[data-system="lights"]')).toBeVisible();
  await expect(tiles).toHaveCount(8);
  await page.reload();
  await expect(page.locator('.tile[data-system="lights"]')).toBeVisible();
});

test('on the rooms axis the areas chosen are the rooms shown', async ({ page }) => {
  await page.goto(`${HA}?demo=home&axis=rooms&areas=kitchen,bedroom`);
  const tiles = page.locator('.tile[data-system]');
  await expect(tiles).toHaveCount(2);
  // The bedroom calls: it comes first.
  await expect(tiles.first()).toHaveAttribute('data-system', 'room:bedroom');
  await expect(tiles.last()).toHaveAttribute('data-system', 'room:kitchen');
});

test('the scenes of the home are a choice on a ring: tapping one activates it and it comes out as the one on', async ({ page }) => {
  await page.goto(`${HA}?demo=teachingbirds`);
  const tile = page.locator('.tile[data-system="scenes"]');
  await expect(tile).toBeVisible();
  await expect(tile.locator('.tile-big')).toHaveText('None');
  await tile.click();
  const front = current(page).locator('.layer-front');
  await expect(front.locator('o-arc.choice-label')).toHaveCount(2);
  await expect(front.locator('o-arc.choice-label[data-label="Movie Time"]')).toBeAttached();
  await front.locator('o-arc[role="radio"][aria-label="Movie Time"]').dispatchEvent('click');
  await expect(front.locator('o-arc[role="radio"][aria-label="Movie Time"]')).toHaveAttribute('aria-checked', 'true');
  await expect(front.locator('.face-big')).toHaveText('Movie Time');
});

test("the thermostat's presets are a choice too", async ({ page }) => {
  await page.goto(`${HA}?demo=arsaboo`);
  await page.locator('.tile[data-system="climate"]').click();
  const items = current(page).locator('.layer-index .layer-item');
  await expect(items.filter({ hasText: 'Preset' })).toHaveCount(1);
  await items.filter({ hasText: 'Preset' }).click();
  const front = current(page).locator('.layer-front');
  await expect(front.locator('o-arc.choice-label[data-label="Eco"]')).toBeAttached();
  // Bringing a layer to the front locks the order for a moment; the ring is operated after that.
  await page.waitForTimeout(1200);
  await front.locator('o-arc[role="radio"][aria-label="Eco"]').dispatchEvent('click');
  await expect(front.locator('.face-big')).toHaveText('Eco');
});

test('numbers and times follow the language the source tells', async ({ page }) => {
  await page.goto(`${HA}?demo=home&lang=de-DE`);
  await expect(page.locator('.tile[data-system="climate"] .tile-big')).toHaveText('21,5°C');
  await page.goto(`${HA}?demo=home`);
  await expect(page.locator('.tile[data-system="climate"] .tile-big')).toHaveText('21.5°C');
});

test('the gear chooses the ends of the rings: square by default, or rounded', async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=orbit`);
  await expect(page.locator('.board o-progress').first()).toBeVisible();
  await expect(page.locator('.board o-progress[shape="rounded"]')).toHaveCount(0);
  await gearTo(page, 'look');
  await page.locator('input[name="ends"][value="rounded"]').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.board o-progress[shape="rounded"]').first()).toBeVisible();
  // The orbit's center ring too (drawn apart), inside a system, and on the switches' segments.
  await expect(page.locator('.board .hub-ring .oh-seg.is-rounded').first()).toBeAttached();
  await page.locator('.otile[data-system="lights"], .tile[data-system="lights"]').first().click();
  await expect(current(page).locator('.layer-front o-arc[shape="rounded"]').first()).toBeAttached();
  // Kept for this browser; back to square from the gear.
  await page.reload();
  await expect(page.locator('.board o-progress[shape="rounded"]').first()).toBeVisible();
  await gearTo(page, 'look');
  await page.locator('input[name="ends"][value="flat"]').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.board o-progress[shape="rounded"]')).toHaveCount(0);
});

test('the layers view lists its layers beside the object, front to back, each bringing its system to the front', async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=layers`);
  const items = page.locator('.board .layer-index .layer-item');
  const layers = page.locator('.board .depth .layer');
  const n = await layers.count();
  expect(n).toBeGreaterThan(2);
  await expect(items).toHaveCount(n);
  // The same order as the layers, the front one marked.
  const ids = await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-bpick')));
  expect(ids).toEqual(await layers.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.system)));
  await expect(items.first()).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.board .layer-front')).toHaveAttribute('data-system', ids[0]!);
  const third = ids[2]!;
  await items.nth(2).click();
  await expect(page.locator('.board .layer-front')).toHaveAttribute('data-system', third);
  // The index keeps its order (by urgency); the one in front is marked.
  await expect(items.nth(2)).toHaveAttribute('data-bpick', third);
  await expect(items.nth(2)).toHaveAttribute('aria-current', 'true');
  // Capped from the gear: the ones past the cap stay listed, hollow.
  await gearTo(page, 'board');
  await page.locator('select[name="layers"]').selectOption('2');
  await page.keyboard.press('Escape');
  await expect(items).toHaveCount(n);
  await expect(page.locator('.board .layer-index .layer-item.is-off')).toHaveCount(n - 2);
  await expect(layers).toHaveCount(2);
});

test('a system lists its channels beside the object too, front to back, the ones past the stack hollow', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="climate"]').click();
  const items = current(page).locator('.layer-index .layer-item');
  await expect(items).toHaveCount(5);
  await expect(current(page).locator('.layer-index .layer-item.is-off')).toHaveCount(2);
  await expect(items.last()).toContainText('Weather');
  await expect(items.first()).toHaveAttribute('aria-current', 'true');
  const key = (await items.last().getAttribute('data-pick'))!;
  await items.last().click();
  await expect(current(page).locator('.layer-front')).toHaveAttribute('data-ch', key);
  await expect(items.first()).toContainText('Weather');
  await expect(items.first()).toHaveAttribute('aria-current', 'true');
});

test('the gear chooses how many channels a system stacks as layers', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="climate"]').click();
  const shown = () => current(page).locator('.layer:not([hidden])');
  await expect(shown()).toHaveCount(3);
  await expect(current(page).locator('.strip')).toContainText('+2 behind: Humidity, Weather');
  await page.locator('.z-nav-back').click();
  await gearTo(page, 'board');
  await page.locator('select[name="stack"]').selectOption('4');
  await page.keyboard.press('Escape');
  await page.locator('.tile[data-system="climate"]').click();
  await expect(shown()).toHaveCount(4);
  await expect(current(page).locator('.strip')).toContainText('+1 behind: Weather');
  // Kept for this browser; and fewer works too.
  await page.reload();
  await gearTo(page, 'board');
  await page.locator('select[name="stack"]').selectOption('2');
  await page.keyboard.press('Escape');
  await page.locator('.tile[data-system="climate"]').click();
  await expect(shown()).toHaveCount(2);
  await expect(current(page).locator('.strip')).toContainText('+3 behind');
});

test('in the orbit the pulse covers the rings of the systems that cross it', async ({ page }) => {
  // Big tiles on a close orbit (the tuning panel's values, kept per browser): the rings cross the pulse.
  await page.addInitScript(() => { localStorage.setItem('pulse-ha-tune', JSON.stringify({ tile: 5, hub: 13, orbit: 8 })); });
  await page.goto(`${HA}?demo=home&mode=orbit`);
  const hub = page.locator('.hub-face');
  await expect(hub).toBeVisible();
  const h = (await hub.boundingBox())!, cx = h.x + h.width / 2, cy = h.y + h.height / 2, R = h.width / 2;
  let probed = 0;
  for (const tile of await page.locator('.otile').all()) {
    const b = (await tile.boundingBox())!, tx = b.x + b.width / 2, ty = b.y + b.height / 2, tr = b.width / 2;
    const d = Math.hypot(tx - cx, ty - cy);
    // Just inside the pulse's edge, toward the tile: where its ring would cross the face.
    const px = cx + (tx - cx) / d * (R - 6), py = cy + (ty - cy) / d * (R - 6);
    if (Math.hypot(px - tx, py - ty) > tr) continue;
    probed++;
    const inHub = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.hub'), [px, py]);
    expect(inHub, `the pulse is above the ring at ${Math.round(px)},${Math.round(py)}`).toBe(true);
  }
  expect(probed).toBeGreaterThan(0);
});

test('the levels behind recede by opacity, never by a filter, and the pointer tilts the object without touching its style', async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=orbit`);
  const obj = page.locator('.board .obj');
  const b = (await obj.boundingBox())!;
  for (let i = 0; i < 8; i++) await page.mouse.move(b.x + b.width * (i + 1) / 10, b.y + b.height * (i + 1) / 10);
  await page.waitForTimeout(300);
  // The tilt is an animation of `rotate` (the compositor), not an inline style: a
  // style attribute on an ancestor of the rings makes Orbit measure and redraw them all.
  expect(await obj.evaluate((o) => getComputedStyle(o).rotate)).not.toBe('none');
  expect(await obj.evaluate((o) => o.getAttribute('style') ?? '')).not.toMatch(/--rx|rotate/);
  await page.locator('.otile[data-system="security"]').click();
  await page.waitForTimeout(1000);
  const behind = page.locator('.z-view.is-previous-view');
  expect(await behind.evaluate((v) => getComputedStyle(v).filter)).toBe('none');
  expect(Number(await behind.evaluate((v) => getComputedStyle(v).opacity))).toBeCloseTo(0.4, 1);
  await expect(page.locator('.z-view.has-effect')).toHaveCount(0);
});

test('the wheel over a view never moves the navigation: no zoom out, no scrub of the views behind', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="security"]').click();
  await bring(page, 'sensors');
  await current(page).locator('.layer-front .disc').click();
  const detail = current(page).locator('.detail');
  await expect(detail).toBeVisible();
  await page.waitForTimeout(1000);                  // the zoom in has ended: Zumly listens again
  const box = (await detail.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  // Small ticks like a trackpad's on an empty spot of the view: Zumly's wheel
  // scrub (gestures.follow) would animate the view toward the blurred board behind.
  const moved = () => page.locator('.z-view.is-current-view').evaluate((v) => v.getAnimations().length > 0 || getComputedStyle(v).transform !== 'matrix(1, 0, 0, 1, 0, 0)');
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 12);
    expect(await moved(), `scrub after tick ${i}`).toBe(false);
  }
  // A long tick would be a zoom out outright.
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(900);
  await expect(current(page).locator('.detail')).toHaveCount(1);
  expect(await moved()).toBe(false);
});

// Empty settings on the first load only: a reload keeps what the test chose.
const folded = (page: Page) => page.addInitScript(() => {
  if (!sessionStorage.getItem('folded')) { localStorage.setItem('pulse-ha-settings', '{}'); sessionStorage.setItem('folded', '1'); }
});

// The demo home's one alert is a notice (a low battery, level 1): the calm stay on the board. The fold, kept for
// what is critical, is tested in the core (the greenhouse's empty tank).
test('the list is a queue on two rings: what calls inside by urgency, the calm outside, the center on the most serious', async ({ page }) => {
  await folded(page);
  await page.goto(`${HA}?demo=home&mode=list`);
  const rings = page.locator('.queue-rings');
  const items = rings.locator('.queue-item');
  await expect(rings).toBeVisible();
  // Every system on the rings, all of one size: what calls first, and a notice folds nothing.
  await expect(items).toHaveCount(8);
  await expect(rings.locator('.queue-item.level-1, .queue-item.level-2')).toHaveCount(1);
  await expect(items.first()).toHaveClass(/level-1/);
  await expect(rings.locator('.queue-fold')).toHaveCount(0);
  await expect(page.locator('.queue-foot .calm-toggle')).toHaveCount(0);
  const sizes = await items.evaluateAll((els) => [...new Set(els.map((e) => (e.querySelector('.queue-hit') as HTMLElement).offsetWidth))]);
  expect(sizes).toHaveLength(1);
  // The center holds the first of the queue, the most serious.
  const first = await items.first().locator('.queue-title').textContent();
  await expect(rings.locator('.list-center .face-name')).toHaveText(first!);
  // A calm one in the center offers the way back to what matters.
  const calm = rings.locator('.queue-item:not(.level-1):not(.level-2)').first();
  const name = await calm.locator('.queue-title').textContent();
  await calm.locator('[data-qitem]').click();
  await expect(rings.locator('.list-center .face-name')).toHaveText(name!);
  await page.locator('.queue-back').click();
  await expect(rings.locator('.list-center .face-name')).toHaveText(first!);
  await rings.locator('.list-center').click();
  await expect(current(page).locator('.sys-title')).toHaveText(first!);
});

test('in the list the center faces the system it shows; tapped again, that system opens; its measures are tuned in the gear', async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=list`);
  const rings = page.locator('.queue-rings');
  const hand = rings.locator('.queue-hand');
  await expect(hand).toHaveCount(1);
  const first = await hand.evaluate((el) => (el as SVGGElement).style.rotate);
  // Another system: the center shows it and the hand swings to it.
  const name = await rings.locator('.queue-item:not(.is-focus) .queue-title').first().textContent();
  const other = rings.locator('.queue-item', { has: page.locator('.queue-title', { hasText: name! }) });
  await other.locator('[data-qitem]').click();
  await expect(rings.locator('.list-center .face-name')).toHaveText(name!);
  await expect(other).toHaveClass(/is-focus/);
  expect(await hand.evaluate((el) => (el as SVGGElement).style.rotate)).not.toBe(first);
  // The same system again: it opens.
  await other.locator('[data-qitem]').click();
  await expect(current(page).locator('.sys-title')).toHaveText(name!);
  // The list's measures are in the gear's tuning, like the orbit's and the layers'.
  await page.goto(`${HA}?demo=home&mode=list`);
  await gearTo(page, 'tune');
  const group = page.locator('.settings [data-tune-group="list"]');
  await expect(group.locator('h3')).toHaveText('List');
  await group.locator('input[data-key="listLink"]').fill('0');
  await expect(rings.locator('.queue-hand')).toHaveCount(0);
  await group.locator('[data-tune-reset="list"]').click();
  await expect(rings.locator('.queue-hand')).toHaveCount(1);
});

test('a notice comes first and folds nothing in the grid, the orbit queues by urgency, and the view switch waits in the gear', async ({ page }) => {
  await folded(page);
  await page.goto(`${HA}?demo=home&mode=grid`);
  const tiles = page.locator('.tile[data-system]');
  // A low battery is a notice: its system leads, the rest of the home stays on the board.
  await expect(tiles).toHaveCount(8);
  await expect(tiles.first()).toHaveClass(/has-alert level-1/);
  await expect(page.locator('.tile[data-system].has-alert')).toHaveCount(1);
  await expect(page.locator('.tile.calm-fold')).toHaveCount(0);
  // What calls never grows: no transform on its ring, a wave leaves it instead.
  const ring = page.locator('.tile.has-alert .mini-ring').first();
  expect(await ring.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  expect(await ring.evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe('wave');
  // In the orbit the most serious comes first, clockwise from the top.
  await page.goto(`${HA}?demo=home&mode=orbit`);
  const levels = await page.locator('.otile').evaluateAll((els) => els.map((e) => Number(/level-(\d)/.exec(e.className)?.[1] ?? 0)));
  expect(levels).toEqual([...levels].sort((a, b) => b - a));
  expect(levels[0]).toBeGreaterThan(0);
  // The switch between views waits in the gear; the board shows it when asked.
  await expect(page.locator('.board .modes')).toBeHidden();
  await gearTo(page, 'board');
  await page.locator('.settings input[name="modes"]').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.board .modes')).toBeVisible();
  // The head is the same in every view: the switch, then the headline.
  // The headline: quiet in every view but the orbit, where the center says it (still there for screen readers).
  for (const mode of ['Grid', 'Orbit', 'Layers', 'List']) {
    await page.locator('.board .modes .mode', { hasText: mode }).click();
    if (mode === 'Orbit') expect(await page.locator('.board-head h1').boundingBox()).toMatchObject({ width: 1, height: 1 });
    else await expect(page.locator('.board-head h1')).toBeVisible();
    await expect(page.locator('.board-head h1')).not.toBeEmpty();
  }
});

test('time is optional: the news inside the orbit\'s ring, a line across the face, the clock while all is calm, the month as the last 30 days', async ({ page }) => {
  // Off by default: the center's ring is one segment per system, each pointing at its satellite, and the face is whole.
  await page.goto(`${HA}?demo=home&mode=orbit`);
  await expect(page.locator('.hub-ring .oh-seg')).toHaveCount(8);
  await expect(page.locator('.hub-ring .oh-ptr')).toHaveCount(8);
  await expect(page.locator('.hub-face.is-split')).toHaveCount(0);
  await gearTo(page, 'board');
  await page.locator('select[name="time"]').selectOption('both');
  await page.keyboard.press('Escape');
  // Something calls: inside the ring the last 12 hours, the open alert as a dot at the moment it began, with its wave.
  await expect(page.locator('.hub .oh-alert.is-current')).toHaveCount(1);
  await expect(page.locator('.hub .oh-wave.is-current')).toHaveCount(1);
  // No mark per change on the board: the changes wait under the line across the face.
  await expect(page.locator('.hub .tw-mark')).toHaveCount(0);
  await expect(page.locator('.hub-face.is-split .hub-slide .slide')).toHaveClass(/level-[12]/);
  await expect(page.locator('.hub-before .hub-changes')).toHaveText(/\d+ changes? ›/);
  // The count opens every change of the window, scrolled in a circle, the whole text of the focused one in the middle, and the way to its system.
  await page.locator('.hub-before .hub-changes').click();
  await expect(current(page).locator('.changes-view')).toBeVisible();
  await expect(current(page).locator('.scroll-item.level-1, .scroll-item.level-2').first()).toBeVisible();
  await expect(current(page).locator('.changes-center .changes-go')).toBeVisible();
  const before = await current(page).locator('.changes-center').textContent();
  await current(page).locator('.scroll-list').focus();
  await page.keyboard.press('ArrowDown');
  await expect(current(page).locator('.changes-view')).toBeVisible();
  await expect(current(page).locator('.changes-center')).not.toHaveText(before!);
  await page.locator('.z-nav-back').click();
  // All calm: the clock above the line, the day around, the same way in under it.
  await page.goto(`${HA}?demo=sections&mode=orbit`);
  await expect(page.locator('.hub-clock .clock-big')).toHaveText(/^\d\d:\d\d$/);
  await expect(page.locator('.hub .oh-bar')).toHaveCount(24);
  await page.locator('.hub-changes').click();
  await expect(current(page).locator('.changes-head')).toHaveText(/^The last 24 hours · \d+ changes?$/);
  await expect(current(page).locator('.scroll-item').first()).toBeVisible();
  await page.locator('.z-nav-back').click();
  // The month of the energy detail, as the last 30 days.
  await gearTo(page, 'look');
  await page.locator('select[name="month"]').selectOption('rolling');
  await page.keyboard.press('Escape');
  await page.goto(`${HA}?demo=home&mode=grid`);
  await page.locator('.tile[data-system="energy"]').click();
  await current(page).locator('.layer-front .disc').click();
  await expect(current(page).locator('.month-window .tw-bar')).toHaveCount(30);
});

test('with two alerts open, the dots to step through them sit above the line, and they answer', async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=grid`);
  await gearTo(page, 'board');
  await page.locator('select[name="time"]').selectOption('both');
  await page.keyboard.press('Escape');
  // Heating up with the windows open: a second alert next to the battery's.
  await page.locator('.tile[data-system="climate"]').click();
  const dial = current(page).locator('.layer-front [data-dial]').first();
  await dial.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.locator('.z-nav-back').click();
  await gearTo(page, 'board');
  await page.locator('.settings input[name="mode"][value="orbit"]').check();
  await page.keyboard.press('Escape');
  const dots = page.locator('.hub-face.is-split .hub-slide .hub-dot');
  await expect(dots).toHaveCount(2);
  const line = (await page.locator('.hub-before').boundingBox())!;
  for (const box of [await dots.nth(0).boundingBox(), await dots.nth(1).boundingBox()]) expect(box!.y + box!.height).toBeLessThanOrEqual(line.y);
  await dots.nth(1).click();
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.hub .oh-alert.is-current')).toHaveCount(1);
  // Both on the ring, each with its wave, apart even though they began at once.
  await expect(page.locator('.hub .oh-wave')).toHaveCount(2);
  const [a, b] = await page.locator('.hub .oh-alert').evaluateAll((l) => l.map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]));
  expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(14);
  // Only what and where above the line, only the way in under it; the whole alert opens its system.
  await expect(page.locator('.hub-face.is-split .slide-why')).toBeHidden();
  await expect(page.locator('.hub-face.is-split .hub-last')).toBeHidden();
  const big = (await page.locator('.hub-face.is-split .slide-big').boundingBox())!;
  await page.mouse.click(big.x + big.width / 2, big.y + big.height / 2);
  await expect(current(page)).not.toHaveAttribute('data-view', 'board');
  await expect(page.locator('.z-nav-back')).toBeVisible();
});

test('the gear picks a theme: the original three and the blue-grey ones that tell an alert by tone, or colors of one\'s own', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await gearTo(page, 'look');
  const tiles = page.locator('.settings .theme-tile');
  await expect(tiles).toHaveCount(8);
  await page.locator('[data-theme-tile="slate"]').click();
  const canvas = page.locator('[data-theme="slate"]');
  await expect(canvas).toHaveCount(1);
  expect(await canvas.evaluate((el) => getComputedStyle(el).getPropertyValue('--bg').trim())).toBe('#e4e9ef');
  expect(await canvas.evaluate((el) => getComputedStyle(el).getPropertyValue('--critical').trim())).toBe('#1d3654');
  // Your own colors start from the theme in force, and are kept.
  await expect(page.locator('.settings-colors')).toBeHidden();
  await page.locator('[data-theme-tile="custom"]').click();
  await expect(page.locator('.settings-colors')).toBeVisible();
  await expect(page.locator('input[name="color"][data-key="bg"]')).toHaveValue('#e4e9ef');
  await page.locator('input[name="color"][data-key="critical"]').fill('#7a1f5c');
  const custom = page.locator('[data-theme="custom"]');
  await expect(custom).toHaveCount(1);
  await expect.poll(() => custom.evaluate((el) => getComputedStyle(el).getPropertyValue('--critical').trim())).toBe('#7a1f5c');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('[data-theme="custom"]')).toHaveCount(1);
  expect(await page.locator('[data-theme="custom"]').evaluate((el) => getComputedStyle(el).getPropertyValue('--bg').trim())).toBe('#e4e9ef');
});

test('the ground can glow or be a photo, and the faces turn to glass over it', async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=list`);
  const canvas = page.locator('[data-ground]');
  await expect(canvas).toHaveAttribute('data-ground', 'flat');
  await gearTo(page, 'look');
  await expect(page.locator('.settings-faces')).toBeHidden();
  await page.locator('.settings input[name="ground"][value="glow"]').check();
  await expect(canvas).toHaveAttribute('data-ground', 'glow');
  await expect(canvas).toHaveAttribute('data-faces', 'glass');
  expect(await canvas.evaluate((el) => getComputedStyle(el).getPropertyValue('--backdrop'))).toContain('radial-gradient');
  // Glass: the center of the list blurs what is behind it.
  expect(await page.locator('.list-center').evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur');
  await page.locator('.settings input[name="faces"][value="solid"]').check();
  expect(await page.locator('.list-center').evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none');
  // The three abstract grounds: drawn by the browser from the theme's own colors, chosen on tiles painted with them.
  await page.locator('.settings input[name="ground"][value="art"]').check();
  await expect(canvas).toHaveAttribute('data-ground', 'art');
  await expect(canvas).toHaveAttribute('data-art', 'aurora');
  await expect(page.locator('.settings .art-tile')).toHaveCount(3);
  expect(await canvas.evaluate((el) => getComputedStyle(el).getPropertyValue('--backdrop'))).toContain('radial-gradient');
  await page.locator('.settings [data-art-tile="grain"]').click();
  await expect(canvas).toHaveAttribute('data-art', 'grain');
  expect(await canvas.evaluate((el) => getComputedStyle(el).getPropertyValue('--backdrop'))).toContain('svg');
  expect(await page.locator('.settings [data-art-tile="contours"] .art-swatch').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('repeating-radial-gradient');
  // A photo from this browser: kept apart from the settings, behind every view, under a veil.
  await page.locator('.settings input[name="ground"][value="photo"]').check();
  await expect(canvas).toHaveAttribute('data-ground', 'flat');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.settings input[name="photo-file"]').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: png });
  await expect(canvas).toHaveAttribute('data-ground', 'photo');
  await expect(page.locator('.photo-state')).toHaveText('Kept in this browser');
  expect(await canvas.evaluate((el) => getComputedStyle(el).getPropertyValue('--backdrop'))).toMatch(/url\("data:image\/jpeg/);
  expect(await page.evaluate(() => localStorage.getItem('pulse-ha-settings'))).not.toContain('data:image');
  await page.reload();
  await expect(page.locator('[data-ground]')).toHaveAttribute('data-ground', 'photo');
});

test('tuning lives in the gear: a slider moves the board as it is dragged, a reset per group, kept in the browser', async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=orbit`);
  await gearTo(page, 'tune');
  // Wide, the panel sits at the side and the board moves over to stay in view.
  await expect(page.locator('.settings-side')).toHaveCount(1);
  await expect(page.locator('.hub')).toBeInViewport();
  await expect(page.locator('[data-tune-reset="orbit"]')).toBeHidden();
  const before = (await page.locator('.otile').first().boundingBox())!;
  await page.locator('input[name="tune"][data-key="orbit"]').fill('7');
  await expect(page.locator('[data-tune-out="orbit"]')).toHaveText('7');
  await expect(page.locator('[data-tune-out="orbit"]')).toHaveClass(/changed/);
  await expect.poll(async () => JSON.stringify((await page.locator('.otile').first().boundingBox())!)).not.toBe(JSON.stringify(before));
  await page.reload();
  await gearTo(page, 'tune');
  await expect(page.locator('input[name="tune"][data-key="orbit"]')).toHaveValue('7');
  await page.locator('[data-tune-reset="orbit"]').click();
  await expect(page.locator('input[name="tune"][data-key="orbit"]')).toHaveValue('10');
  await expect(page.locator('[data-tune-reset="orbit"]')).toBeHidden();
});

test('Media carries its sound visual in its tile and in its face while something plays', async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=grid`);
  await expect(page.locator('.tile[data-system="media"] canvas.face-visual')).toHaveCount(1);
  await page.locator('.tile[data-system="media"]').click();
  await expect(current(page).locator('.layer-front .disc canvas.face-visual')).toHaveCount(1);
  await expect(current(page).locator('.layer-front .face-name')).toHaveText('Playing');
});

test("the orbit's center holds the most serious alert, or the home's pulse with the time", async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=orbit`);
  // A segment per system around the center, and no clock's rim inside it.
  await expect(page.locator('.hub-ring .oh-seg')).toHaveCount(8);
  await expect(page.locator('.hub-ring .clock-tick')).toHaveCount(0);
  // The center holds the most serious alert, with no dots to page through the rest.
  await expect(page.locator('.hub-slide .slide')).toHaveClass(/level-[12]/);
  await expect(page.locator('.hub-dot')).toHaveCount(0);
  // All calm, the center is the home's pulse, and it names the time.
  await page.goto(`${HA}?demo=sections&mode=orbit`);
  await expect(page.locator('.hub-slide .eyebrow')).toHaveText(/^Pulse · \d\d:\d\d$/);
});

test("a long choice scrolls in a circle: the sources as rows in the disc, a curved scrollbar, the wheel and the keys move it, a tap picks", async ({ page }) => {
  await page.goto(`${HA}?demo=arsaboo&mode=grid`);
  await page.locator('.tile[data-system="media"]').click();
  await current(page).locator('o-arc[data-pick="source"]').first().dispatchEvent('click');
  await current(page).locator('.layer-front .disc').click();
  const list = current(page).locator('.scroll-list');
  await expect(list).toHaveAttribute('role', 'listbox');
  await expect(list.locator('[role="option"]')).toHaveCount(11);
  const thumb = list.locator('.scroll-thumb');
  await expect(thumb).toHaveAttribute('aria-valuemax', '6');
  await expect(thumb).toHaveAttribute('aria-valuenow', '0');
  // Five fit, the next fades at the rim; the rest wait past the end.
  await expect(list.locator('.scroll-item:not(.is-hidden)')).toHaveCount(6);
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.mouse.wheel(0, 160);
  await expect(thumb).toHaveAttribute('aria-valuenow', '4');
  // The wheel stays in the list: Zumly does not read it as a zoom out.
  await page.waitForTimeout(1200);
  await expect(current(page).locator('.detail')).toBeVisible();
  await list.focus();
  // The arrows move the focus and stay in the list: Zumly does not read ArrowDown as a zoom out.
  await page.keyboard.press('ArrowDown');
  await expect(current(page).locator('.detail')).toBeVisible();
  await page.keyboard.press('End');
  await expect(list.locator('.scroll-item.is-focus .sl-text')).toHaveText('Retro 70s and 80s');
  await page.keyboard.press('Enter');
  await expect(list.locator('.scroll-item.is-on .sl-text')).toHaveText('Retro 70s and 80s');
  await expect(current(page).locator('.detail-big')).toHaveText('Retro 70s and 80s');
});

test("the Power detail puts this month under the day: a sector per day of the energy meter, today in the center", async ({ page }) => {
  await page.goto(`${HA}?demo=home&mode=grid`);
  await page.locator('.tile[data-system="energy"]').click();
  await current(page).locator('.layer-front .disc').click();
  const month = current(page).locator('.month-ring');
  const now = new Date(), days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  await expect(month.locator('.day')).toHaveCount(days);
  await expect(month.locator('.day.is-today')).toHaveText(String(now.getDate()));
  await expect(month.locator('.month-bar')).toHaveCount(now.getDate());
  await expect(month.locator('.time-big')).toHaveText(/kWh$/);
  await expect(month.locator('.time-range')).toHaveText(now.toLocaleDateString('en', { month: 'long', year: 'numeric' }));
});

test("the trackpad's pinch (a wheel with ctrl) zooms out of a system; pinching out does nothing", async ({ page }) => {
  await page.goto(`${HA}/?demo=home`);
  await page.locator('.tile[data-system="lights"]').click();
  await expect(current(page).locator('.system')).toBeVisible();
  const pinch = (deltaY: number) => current(page).locator('.layer-front .disc').first().dispatchEvent('wheel', { deltaY, ctrlKey: true, bubbles: true, cancelable: true });
  // Pinching out: still inside.
  await pinch(-80);
  await page.waitForTimeout(300);
  await expect(current(page).locator('.system')).toBeVisible();
  // Pinching in: back to the board.
  await pinch(30); await pinch(30);
  await expect(current(page).locator('.board')).toBeVisible();
});

test('the people of the home: who is home on a ring, where they are on a map around home, and each one an object of their own', async ({ page }) => {
  await page.goto(`${HA}?demo=arsaboo`);
  await expect(page.locator('.tile[data-system="people"] .tile-big')).toHaveText('0 of 2');
  await page.locator('.tile[data-system="people"]').click();
  const front = current(page).locator('.layer-front[data-ch="home"]');
  await expect(front.locator('.face-big')).toHaveText('0 of 2');
  await expect(front.locator('.face-label')).toContainText(/Arsaboo .* and Melody /);
  await expect(front.locator('o-arc[data-seg]')).toHaveCount(2);
  // The map: home in the center, the people as dots, the other zones dim.
  await bring(page, 'where');
  const where = current(page).locator('.layer-front[data-ch="where"]');
  await expect(where.locator('.face-big')).toHaveText('2 away');
  await expect(where.locator('.face-label')).toHaveText(/^Melody · 2\.\d km from home$/);
  await expect(where.locator('.face-map .map-dot')).toHaveCount(4);
  await expect(where.locator('.face-map .map-tile').first()).toHaveAttribute('href', /tile\.openstreetmap\.org/);
  // Its detail holds the map big, zoomable.
  await where.locator('[data-to="detail"]').click();
  await expect(current(page).locator('.detail-map .map-big')).toBeVisible();
  await page.locator('.z-nav-back').click();
  await expect(page.locator('.z-view')).toHaveCount(2);
  // A segment of the ring opens the person: their picture in the face, where they are, their phone.
  await bring(page, 'home');
  await front.locator('o-arc[data-seg][aria-label="Arsaboo"]').dispatchEvent('click');
  await expect(current(page).locator('.sys-title')).toHaveText('Arsaboo');
  const status = current(page).locator('.layer-front[data-ch="status"]');
  await expect(status.locator('.face-big')).toHaveText('Away');
  await expect(status.locator('.face-label')).toHaveText(/^for \d+ (min|h)$/);
  await expect(status.locator('.disc.has-image .face-image')).toHaveAttribute('src', /arsaboo/);
  await expect(current(page).locator('.layer-index')).toContainText('Where');
});

test('the weather and the sun: outside on a band, the wind and the sun as arrows on the ring', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="climate"]').click();
  await bring(page, 'weather');
  const weather = current(page).locator('.layer-front[data-ch="weather"]');
  await expect(weather.locator('.face-big')).toHaveText(/^-?\d+(\.\d+)?°C$/);
  await expect(weather.locator('.face-label')).toContainText(/wind \d+ km\/h/);
  // Kernehed's weather says where the wind comes from: an arrow on the ring, and the point of the compass in words.
  await page.goto(`${HA}?demo=kernehed`);
  await page.locator('.tile[data-system="climate"]').click();
  await bring(page, 'weather');
  const windy = current(page).locator('.layer-front[data-ch="weather"]');
  await expect(windy.locator('.face-label')).toHaveText('sunny · wind from the W · 75% humidity'); // (that recording has no wind unit: the direction alone)
  await expect(windy.locator('.bearing-orbit')).toHaveAttribute('aria-label', /^bearing \d+°$/);
  // The sections home has the sun: how high, where in the sky, and when it next sets.
  await page.goto(`${HA}?demo=sections`);
  await page.locator('.tile[data-system="climate"]').click();
  await bring(page, 'sun');
  const sun = current(page).locator('.layer-front[data-ch="sun"]');
  await expect(sun.locator('.face-big')).toHaveText(/^\d{1,2}:\d{2}( [AP]M)?$/);
  await expect(sun.locator('.face-label')).toHaveText(/^sets in .* · 30° high$/);
  await expect(sun.locator('.bearing-orbit')).toHaveAttribute('aria-label', /^bearing \d+°$/);
});

test('Assist answers on the ring: the built-in questions a tap away, the viewer\'s own words through the keypad, the transcript in the detail', async ({ page }) => {
  await page.goto(`${HA}?demo=arsaboo`);
  await expect(page.locator('.tile[data-system="assist"] .tile-big')).toHaveText('Ask');
  await page.locator('.tile[data-system="assist"]').click();
  const view = current(page), front = view.locator('.layer-front[data-ch="ask"]');
  await expect(front.locator('.face-big')).toHaveText('Ask');
  await expect(front.locator('.face-label')).toHaveText('tap a question, or ask in your words');
  // The questions this home can answer (no locks, no window sensors here), and the viewer's own.
  await expect(front.locator('.choice-label')).toHaveCount(4);
  expect(await front.locator('.choice-label').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.label))).toEqual(["Who's home?", 'Lights on?', 'All lights off', 'Ask…']);
  await front.locator('o-arc[data-seg][aria-label="Lights on?"]').dispatchEvent('click');
  await expect(front.locator('.face-big')).toHaveText('Answered');
  await expect(front.locator('.face-label')).toHaveText('Living Room Lights and Kitchen Lights');
  // Short answers are the face; the question goes under them.
  await front.locator('o-arc[data-seg][aria-label="Who\'s home?"]').dispatchEvent('click');
  await expect(front.locator('.face-big')).toHaveText('Not any');
  await expect(front.locator('.face-label')).toHaveText('who is home?');
  // "Ask…" opens an input in the open, focused, with the strip saying what it is for; Enter sends.
  await front.locator('o-arc[data-seg][aria-label="Ask…"]').dispatchEvent('click');
  const pad = view.locator('.keypad.is-words');
  await expect(pad).toBeVisible();
  await expect(pad.locator('.keypad-title')).toContainText('Assist · Ask…');
  await expect(pad.locator('.code-input')).toHaveAttribute('placeholder', 'Ask anything about your home');
  await expect(pad.locator('.code-input')).toBeFocused();
  await expect(pad.locator('[data-code="enter"]')).toBeDisabled();
  await expect(view.locator('.strip')).toContainText('Assist: ask anything about your home.');
  await page.keyboard.type('turn off the kitchen lights');
  await expect(pad.locator('[data-code="enter"]')).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(pad).toHaveCount(0);
  await expect(front.locator('.face-big')).toHaveText('Done');
  await expect(front.locator('.face-label')).toHaveText('Turned off the light');
  // A question it cannot answer: an apology, without repeating itself.
  await front.locator('o-arc[data-seg][aria-label="Ask…"]').dispatchEvent('click');
  await page.keyboard.type('what is the meaning of life?');
  await page.keyboard.press('Enter');
  await expect(front.locator('.face-big')).toHaveText('Sorry');
  await expect(front.locator('.face-label')).toHaveText("I couldn't understand that");
  // Escape closes the keypad without sending.
  await front.locator('o-arc[data-seg][aria-label="Ask…"]').dispatchEvent('click');
  await expect(pad).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pad).toHaveCount(0);
  // The transcript, latest first; an order carried out has a check.
  await front.locator('[data-to="detail"]').click();
  const rows = current(page).locator('.sl-rows .scroll-item');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator('.sl-text')).toHaveText('what is the meaning of life?');
  await expect(rows.nth(0).locator('.sl-detail')).toHaveText("I couldn't understand that");
  await expect(rows.nth(1).locator('.sl-text')).toHaveText('turn off the kitchen lights');
  await expect(rows.nth(1).locator('.sl-check')).toHaveCount(1);
  await expect(rows.nth(3).locator('.sl-detail')).toHaveText('Living Room Lights and Kitchen Lights');
  await expect(current(page).locator('.sl-check')).toHaveCount(1);
});

test('the notices under Home Assistant\'s bell: a line each under Maintenance, a tap dismisses one, and the detail closes when the last goes', async ({ page }) => {
  await page.goto(`${HA}?demo=home`);
  await page.locator('.tile[data-system="maintenance"]').click();
  await expect(current(page).locator('.layer-index')).toContainText('Notices');
  await bring(page, 'notices');
  const front = current(page).locator('.layer-front[data-ch="notices"]');
  await expect(front.locator('.face-big')).toHaveText('1 notice');
  await expect(front.locator('.face-label')).toHaveText('About this demo');
  await front.locator('[data-to="detail"]').click();
  const row = current(page).locator('.sl-rows .scroll-item[data-opt="0"]');
  await expect(row.locator('.sl-text')).toHaveText('About this demo');
  await expect(row.locator('.sl-detail')).toContainText('Home page answers in your browser');
  await row.click();
  // Dismissed: nothing left under the bell, so the detail closes to the object, which no longer lists it.
  await expect(current(page).locator('.system')).toBeVisible();
  await expect(current(page).locator('.layer-front')).toHaveAttribute('data-ch', 'batteries');
  await expect(current(page).locator('.layer-index')).not.toContainText('Notices');
});

test('an object whose last channel goes closes too: the one notice of a home with nothing else to maintain', async ({ page }) => {
  await page.goto(`${HA}?demo=arsaboo`);
  await expect(page.locator('.tile[data-system="maintenance"] .tile-big')).toHaveText('1 notice');
  await page.locator('.tile[data-system="maintenance"]').click();
  await current(page).locator('.layer-front[data-ch="notices"] [data-to="detail"]').click();
  const row = current(page).locator('.sl-rows .scroll-item[data-opt="0"]');
  await expect(row.locator('.sl-text')).toHaveText('About this demo');
  await row.click();
  await expect(page.locator('.z-view.is-current-view .board')).toBeVisible();
  await expect(page.locator('.tile[data-system="maintenance"]')).toHaveCount(0);
  await expect(page.locator('.tile[data-system]')).toHaveCount(7);
});

test('the card takes a background: one of the three abstract grounds by name, or a photo by its address', async ({ page }) => {
  await page.goto(`${HA}/card.html?home=home&config=${encodeURIComponent(JSON.stringify({ background: 'contours' }))}`);
  const canvas = card(page).locator('[data-ground]');
  await expect(canvas).toHaveAttribute('data-ground', 'art');
  await expect(canvas).toHaveAttribute('data-art', 'contours');
  await expect(canvas).toHaveAttribute('data-faces', 'glass');
  await page.goto(`${HA}/card.html?home=home&config=${encodeURIComponent(JSON.stringify({ background: '/local/room.jpg' }))}`);
  await expect(card(page).locator('[data-ground]')).toHaveAttribute('data-ground', 'photo');
  expect(await card(page).locator('[data-ground]').evaluate((el) => getComputedStyle(el).getPropertyValue('--backdrop'))).toContain('/local/room.jpg');
});
