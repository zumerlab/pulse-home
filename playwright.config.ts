import { defineConfig, devices } from '@playwright/test';

// The tests run against the app over its demo homes (no Home Assistant
// needed), on the dev server. One run against a live Home Assistant is
// tests/ha-live.spec.ts, only with PULSE_HA_TOKENS set.
// PULSE_PORT runs the app and the tests on another port when 5174 is taken.
// The openHAB app's live path is tested against a stand-in server over the
// recorded house, tests/openhab-server.mjs, on PULSE_OPENHAB_PORT (5175).
const port = process.env.PULSE_PORT ?? '5174';
const openhabPort = process.env.PULSE_OPENHAB_PORT ?? '5175';
export const HA = `http://127.0.0.1:${port}`;
export const OPENHAB_SERVER = `http://127.0.0.1:${openhabPort}`;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: HA,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    { command: `npx vite --port ${port}`, url: HA, reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: `node tests/openhab-server.mjs ${openhabPort}`, url: `${OPENHAB_SERVER}/rest/`, reuseExistingServer: !process.env.CI, timeout: 15_000 },
  ],
});
