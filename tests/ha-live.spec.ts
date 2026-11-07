import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { HA } from '../playwright.config.ts';

// The Home Assistant app over a real Home Assistant: only when PULSE_HA_TOKENS
// points at the tokens of scripts/ha-tokens.mjs (whose client id is this app's
// URL). They are seeded into the app's own storage, so nothing is typed. Not
// part of the usual suite: without the variable, the test is skipped.
//
//   node scripts/ha-tokens.mjs .env.local /tmp/tokens.json
//   PULSE_HA_TOKENS=/tmp/tokens.json npx playwright test tests/ha-live.spec.ts

const tokensFile = process.env.PULSE_HA_TOKENS;

test.skip(!tokensFile, 'PULSE_HA_TOKENS not set: no live Home Assistant');

test('the app connects to the live Home Assistant with saved tokens and builds the board from its entities', async ({ page }) => {
  const tokens = JSON.parse(readFileSync(tokensFile!, 'utf8'));
  await page.addInitScript((t) => {
    localStorage.setItem('pulse-ha-auth', JSON.stringify(t));
    // The demo integration starts with its sirens on: the calm systems would fold into one tile.
    localStorage.setItem('pulse-ha-settings', '{"calm":"open"}');
  }, tokens);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(HA);
  await expect(page.locator('.login')).toBeHidden();
  await expect(page.locator('.conn')).toContainText(/Home Assistant \d{4}\.\d+.* · live/, { timeout: 20_000 });
  // The local installation runs the demo integration: every system fills, and Assist is there to ask.
  await expect(page.locator('.tile[data-system="assist"]')).toHaveCount(1);
  expect(await page.locator('.tile[data-system]').count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator('.board h1')).not.toHaveText(/Connecting/);
  await page.locator('.tile[data-system="lights"]').click();
  await expect(page.locator('.z-view.is-current-view .layer-front .face-big')).toHaveText(/\d of \d/);
  expect(errors).toEqual([]);
});
