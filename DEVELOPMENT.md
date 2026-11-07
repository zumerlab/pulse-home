# Pulse for Home Assistant: development

How the app and the card are put together, the demo homes, the scripts and the
tests. What Pulse is, how to install it, its options, the entities each system
reads, the alerts and the troubleshooting: [README.md](README.md).

## Run it locally

With Node.js 22.18+ or 24+ and npm installed:

```sh
npm ci
npm run dev
```

Open [the app](http://127.0.0.1:5174), enter your Home Assistant URL and sign
in. The browser connects directly to Home Assistant; Pulse needs no backend
and no integration installed on the server.

Without a Home Assistant instance, choose a home in the sign-in panel and
select **Explore the demo**, start from the
[demo gallery](http://127.0.0.1:5174/gallery.html), or open
[a demo home directly](http://127.0.0.1:5174/?demo=home).

## How it works

The app converts Home Assistant's entity states into the systems, readings and
actions of `@zumer/pulse`, the core, which handles the board, the layers, the
controls, the details and the settings panel. The core lives in its own
repository, [zumerlab/pulse](https://github.com/zumerlab/pulse), and comes in
as a dependency. When a checkout of it sits beside this one (`../pulse`),
`vite.shared.ts` and the `paths` in `tsconfig.json` read it live from
`../pulse/src`, so a change there shows here at once; otherwise the npm
package is used. Until the core is on npm the dependency is
`"@zumer/pulse": "file:../pulse"`.

`src/` is Vite's root: the pages live there (`index.html` the app,
`gallery.html` the index of demo homes, `card.html` the card's bench) with
the code.

| File or directory | Responsibility |
|---|---|
| [main.ts](src/main.ts) | Starts the standalone app, reads URL options and switches between live and demo sources |
| [login.ts](src/login.ts) | Sign-in panel and demo selection; [preview.ts](src/preview.ts) draws the chosen home's rings beside it |
| [gallery.ts](src/gallery.ts) | The index of demo homes, `gallery.html`: every home previewed with the rings its entities fill |
| [app.ts](src/app.ts) | `mountPulse`: mounts the core board with Home Assistant options and labels |
| [host.ts](src/host.ts) | Adapts a `PulseSource` to the core's `PulseHost` interface |
| [model.ts](src/model.ts) | Entity selection, systems, channels, alert rules, room grouping, the objects of cameras and people, Assist |
| [source.ts](src/source.ts) | Source interface, WebSocket connection, authentication, registry loading, notices, `ask` |
| [strings.ts](src/strings.ts) | The app's text |
| [demo/](src/demo/) | Simulated source, entity behavior and generated home data |
| [card/](src/card/) | Custom card, dashboard and section strategies, and the `hass` source |
| [card-bench.ts](src/card-bench.ts) | Runs the real card with demo data for local development |
| [scripts/](scripts/) | Helpers for testing against a local Home Assistant |
| [hls-none.ts](src/hls-none.ts) | What the HA builds alias `hls.js` to: Home Assistant's cameras are stills or MJPEG, so the video stack stays out of the bundle |

To add a channel or change how entities are selected, start in `src/model.ts`.
To change shared rendering or interactions, work in the core,
[zumerlab/pulse](https://github.com/zumerlab/pulse).

### Alerts and command feedback

Alerts come from rules in [model.ts](src/model.ts). Some use one entity, such as
a low battery or a jammed lock. Others combine states: heating with a window
open, a garage door open at night, or motion while the alarm is armed.

An alert can offer a service call, such as locking a door, or an
acknowledgement. Muting an alert removes its wave and moves it behind the
active layer. It can return if its text changes. A new critical alert opens
its system when you are on the board.

A control pulses while a command is pending. Pulse waits for Home Assistant
to report the new state, with an eight-second limit on the pending indicator.
If the call fails, it shows the error and a Retry option. Dial commands are
sent on release; keyboard and wheel changes are sent after a short pause.
Actions that require a code open a keypad before sending the command; Assist
opens the same keypad in its words format.

## Sign-in and connection

The standalone app uses Home Assistant's login flow. You sign in on Home
Assistant and return to Pulse; Pulse does not receive your password. Access
and refresh tokens are stored in the browser under `pulse-ha-auth`. Signing
out clears the saved session and attempts to revoke the refresh token.

For a kiosk or wall panel, you can instead paste a long-lived access token
into the sign-in panel. Create one in your Home Assistant profile under
Security.

The WebSocket connection uses `home-assistant-js-websocket`. It subscribes to
entity updates, loads the registries, subscribes to the persistent
notifications and reconnects when the connection drops. The card uses the
dashboard's existing `hass` object instead of opening its own connection.

If Pulse is served over HTTPS, your Home Assistant URL must also use HTTPS.
Browsers block a connection from an HTTPS page to an HTTP Home Assistant.
The Home Assistant address must be reachable from the device running Pulse.

Pulse's interface text is currently English. Numbers and times follow your
Home Assistant profile's language, and entity states use Home Assistant's
translated labels where available. Assist answers in the language of your
Home Assistant; the questions on its ring are asked in English, which every
installation understands.

## Settings for each screen

The gear button opens four tabs:

- **Content:** systems, areas, channels and the entity a channel follows.
- **Board:** view, grouping by system or room, starting system, time display
  and visible layer counts.
- **Look:** theme or custom colors; the background (flat, a glow, one of the
  three abstract grounds or a photo) and the faces over it; dial style and
  other visual options.
- **Tuning:** distances and sizes for the rings and layers.

Changes apply immediately and stay in that browser. The standalone app uses
`pulse-ha-settings` in local storage, so a wall tablet and a phone can show
different parts of the same home. **Back to defaults** restores the app's
configured defaults.

### Open a specific view from a link

The standalone app reads these URL parameters:

| Parameter | Values | Purpose |
|---|---|---|
| `systems` | Comma-separated system ids (`lights`, `climate`, `security`, `people`, `openings`, `media`, `energy`, `scenes`, `maintenance`, `assist`) | Limit the available systems |
| `areas` | Comma-separated Home Assistant area ids | Limit entities to those areas |
| `mode` | `grid`, `orbit`, `layers`, `list` | Set the initial board view |
| `axis` | `systems`, `rooms` | Group by system or room |
| `start` | A system id | Open inside that system |
| `layers` | A positive integer | Set the number of systems stacked in Layers view |
| `demo` | A demo home id | Use a demo home instead of a live connection |
| `lang` | A locale tag, such as `es-AR` | Try number and time formatting in the demo |

For example:

```text
http://127.0.0.1:5174/?systems=lights,climate&mode=orbit&start=climate&areas=kitchen,living_room
```

Use your own area ids. The systems and areas in the URL limit what settings
can offer; saved browser preferences can override defaults such as the view.
When embedding the app through `mountPulse`, `settings: false` hides the
settings panel.

## Demo homes

The app includes six homes from demo.home-assistant.io: `home`, `sections`,
`arsaboo`, `teachingbirds`, `kernehed` and `jimpower`. The `home` and `sections`
demos have the widest range of controls; the others are mostly sensors.

The demos simulate service calls in the browser. Lights toggle, covers move,
locks change state, scenes activate, notices can be dismissed and Assist
answers on its own (who is home, which lights are on, the windows, the locks,
the temperature, the weather, the time). The Playwright tests use these homes
to exercise the app without a running Home Assistant.

Kernehed's alarm code is `1234`. Some demo devices deliberately show failures,
such as the lock named “Poorly Installed Door,” which jams when locked.
These are useful for trying alerts and error handling. The demo's sun is
re-dated to today, so its next rising and setting are always ahead.

The home data is generated from a Home Assistant frontend checkout:

```sh
python3 src/demo/scripts/import-homes.py /path/to/frontend
```

Add `--check` to compare without writing. Update the source checkout and rerun
the importer rather than editing files in `src/demo/homes/` by hand. Source
attribution and the Apache 2.0 license are recorded in [src/demo/NOTICE.md](src/demo/NOTICE.md).

## Build and check

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:card
```

The app build writes `dist/`, including the app and the demo gallery. The
card build writes `dist-card/zumer-pulse.js`, with the core, Orbit and Zumly
bundled and `hls.js` left out (about 810 kB, 190 kB compressed).

For card development, open [the card bench](http://127.0.0.1:5174/card.html)
while `npm run dev` is running. It accepts `home`, `config` (JSON),
`size=panel|section`, `width` and `height` as query parameters. The bench is
available in development and is excluded from the app build.

```text
/card.html?home=sections&size=section&config={"systems":["climate"],"start":"climate"}
```

The card tests are in [tests/ha.spec.ts](tests/ha.spec.ts). Live app tests
are in [tests/ha-live.spec.ts](tests/ha-live.spec.ts) and are skipped
unless `PULSE_HA_TOKENS` points to a tokens file.

For local integration work, `scripts/ha-tokens.mjs` creates a tokens file from
`.env.local`. `scripts/ha-install-card.mjs` registers a dashboard resource and
creates or updates two test dashboards in Home Assistant;
`scripts/ha-check-card.mjs` checks them with Playwright and saves screenshots.

## Troubleshooting

- **The app cannot connect:** check that the Home Assistant URL is reachable
  from this browser. For an HTTPS Pulse page, use an HTTPS Home Assistant URL.
- **Only some systems or channels appear:** check for matching entities, area
  filters and hidden channels in settings. Try **Back to defaults** to clear
  saved display choices.
- **A command fails or a dial returns to its old value:** read the error below
  the object and check the device's state in Home Assistant.
- **The rings do not render correctly:** try an up-to-date browser or WebView.
  Pulse relies on modern CSS features.

For resource-loading errors, card configuration and dashboard layout issues,
see the [README's troubleshooting](README.md#troubleshooting).
