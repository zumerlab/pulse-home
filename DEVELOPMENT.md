# Pulse for the home: development

How the apps and the card are put together, the demo homes, the scripts and
the tests. What Pulse is, how to install it on each platform, its options,
what each system reads, the alerts and the troubleshooting:
[README.md](README.md).

## Run it locally

With Node.js 22.18+ or 24+ and npm installed:

```sh
npm ci
npm run dev
```

One development server, on port 5174, serves both apps and the gallery:

| Page | What it is |
|---|---|
| [`/`](http://127.0.0.1:5174/) | Pulse for Home Assistant: enter your Home Assistant URL and sign in, or pick a demo home |
| [`/openhab/`](http://127.0.0.1:5174/openhab/) | Pulse for openHAB: enter your openHAB address, or open the demo house |
| [`/gallery.html`](http://127.0.0.1:5174/gallery.html) | The index of demo homes, every one previewed with the rings it fills |
| `/card.html` | The card's bench (development only) |

The browser talks to Home Assistant directly, over its WebSocket. It talks to
openHAB directly when that openHAB allows it (CORS on, or the page served by
openHAB itself); otherwise the development server fetches for it under
`/oh`: `OPENHAB_URL=http://openhab.local:8080 npm run dev` points that proxy
at your server, and with nothing set it points at `demo.openhab.org`, the
openHAB project's public demo house, live. Pulse needs no backend and
nothing installed on either server.

Without a server at hand, each panel offers a demo:
[a Home Assistant demo home](http://127.0.0.1:5174/?demo=home) or
[the openHAB demo house](http://127.0.0.1:5174/openhab/?demo).

## How it works

Each app converts what its platform reports into the systems, readings and
actions of `@zumer/pulse`, the core, which handles the board, the layers, the
controls, the details and the settings panel. The core lives in its own
repository, [zumerlab/pulse](https://github.com/zumerlab/pulse), and comes in
as a dependency. When a checkout of it sits beside this one (`../pulse`),
`vite.shared.ts` and the `paths` in `tsconfig.json` read it live from
`../pulse/src`, so a change there shows here at once; otherwise the npm
package is used.

`src/` is Vite's root. The Home Assistant app and the card live at its top,
the openHAB app in `src/openhab/`, and what both share in
[shared.ts](src/shared.ts): hours told in the home's time zone, distances and
map zooms, the preview tiles of a home. Neither app imports the other.

### Home Assistant

| File or directory | Responsibility |
|---|---|
| [main.ts](src/main.ts) | Starts the standalone app, reads URL options and switches between live and demo sources |
| [login.ts](src/login.ts) | Sign-in panel and demo selection; [preview.ts](src/preview.ts) draws the chosen home's rings beside it |
| [app.ts](src/app.ts) | `mountPulse`: mounts the core board with Home Assistant options and labels |
| [host.ts](src/host.ts) | Adapts a `PulseSource` to the core's `PulseHost` interface |
| [model.ts](src/model.ts) | Entity selection, systems, channels, alert rules, room grouping, the objects of cameras and people, Assist |
| [source.ts](src/source.ts) | Source interface, WebSocket connection, authentication, registry loading, notices, `ask` |
| [strings.ts](src/strings.ts) | The app's text, and the gallery's |
| [demo/](src/demo/) | Simulated source, entity behavior and generated home data |
| [card/](src/card/) | Custom card, dashboard and section strategies, and the `hass` source |
| [card-bench.ts](src/card-bench.ts) | Runs the real card with demo data for local development |
| [scripts/](scripts/) | Helpers for testing against a local Home Assistant |
| [hls-none.ts](src/hls-none.ts) | What every build here aliases `hls.js` to: the cameras are stills or MJPEG, so the video stack stays out of the bundle |

### openHAB

| File or directory | Responsibility |
|---|---|
| [openhab/main.ts](src/openhab/main.ts) | Starts the app, reads URL options, draws the connect panel and switches between live and demo sources; [openhab/preview.ts](src/openhab/preview.ts) draws the demo house's rings beside the panel |
| [openhab/host.ts](src/openhab/host.ts) | Adapts a `HouseSource` to the core's `PulseHost`: floors as groups, rooms as the second axis, people as objects, history and changes from persistence |
| [openhab/model.ts](src/openhab/model.ts) | The house read from the semantic model (Locations, Equipment, Points and their properties), the systems and channels, the alert rules, the rooms |
| [openhab/source.ts](src/openhab/source.ts) | `HouseSource` and its REST implementation: the items with their semantics, the event stream, commands, persistence; the proxy and the remembered server |
| [openhab/strings.ts](src/openhab/strings.ts) | The app's text |
| [openhab/demo/](src/openhab/demo/) | The recorded demo house (`recording.json`), its drawn covers, the source that plays it, and the recorder |
| [openhab/index.html](src/openhab/index.html) | The page: `/openhab/` in development, the `index.html` of the folder openHAB serves |
| [gallery.ts](src/gallery.ts) | The index of the demo homes of both platforms, `gallery.html` |

To add a channel or change how things are selected, start in that platform's
`model.ts`. To change shared rendering or interactions, work in the core,
[zumerlab/pulse](https://github.com/zumerlab/pulse).

### Alerts and command feedback

Alerts come from rules in each `model.ts`. Some use one thing, such as a low
battery or a jammed lock. Others combine states: heating with a window open,
a garage or a door open at night, motion while the alarm is armed.

An alert can offer an action, such as locking a door or turning a heating
off, or an acknowledgement. Muting an alert removes its wave and moves it
behind the active layer. It can return if its text changes. A new critical
alert opens its system when you are on the board.

A control pulses while a command is pending. Pulse waits for the home to
report the new state, with an eight-second limit on the pending indicator.
If the command fails, it shows the error and a Retry option. Dial commands
are sent on release; keyboard and wheel changes are sent after a short pause.
Actions that require a code open a keypad before sending the command; Assist
opens the same keypad in its words format.

## Connection

### Home Assistant

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

### openHAB

The app reads the REST API: every item with its semantic metadata at start
and whenever the structure changes, the state changes over the event stream
(`/rest/events`, read with `fetch` so the token travels with it, batched into
one repaint every 300 ms, reconnected with a growing wait), commands as
`POST /rest/items/<name>`, and a day of a point from `/rest/persistence`.
The home's time zone and the server's version come from `/rest/`. A token
goes with every request as a Bearer header: one pasted in the panel is kept
in the browser under `pulse-openhab-token` (prefilled next time; disconnecting
forgets it) and never put in the address; `?token=` in a link is used as it
is.

Four ways to reach a server, decided by the build and the URL:

- **Served by openHAB** (`npm run build:openhab`): the page reads
  `location.origin`, the openHAB that serves it, with no CORS involved. The
  panel's address field is prefilled with it; another address typed there is
  read directly and needs CORS on that server.
- **Direct** (`?server=http://openhab.local:8080`, or the address typed in
  the panel in development): the browser talks to that openHAB; it needs
  `org.openhab.cors:enable=true` in its `services/runtime.cfg`.
- **Through the development server** (the address left empty in
  development): requests go to `/oh`, which Vite proxies to `OPENHAB_URL` or
  to `demo.openhab.org`.
- **On a plain host** (`npm run build:pages`, what zumerlab.com/pulse-home/
  serves): no openHAB behind the page and no proxy. The house as recorded
  opens by itself; an address typed in the panel (required there) is read
  directly, with CORS on that server and over HTTPS when the page is. The
  board opens as the orbit by group with the switch between views on it
  (`__PAGES__`, a preset in each app's entry); the address and the gear
  still decide.

If Pulse is served over HTTPS, the server's address must also use HTTPS.
Browsers block a connection from an HTTPS page to an HTTP server. The
address must be reachable from the device running Pulse.

Pulse's interface text is English. On Home Assistant, numbers and times
follow your profile's language and entity states use Home Assistant's
translated labels; Assist answers in the language of your Home Assistant,
and the questions on its ring are asked in English, which every installation
understands. On openHAB, numbers and times follow the browser's language,
times are told in the home's time zone, and a state uses the words of its
state description.

## Settings for each screen

The gear button opens four tabs:

- **Content:** systems, rooms, channels and the thing a channel follows.
- **Board:** view, grouping by system or room, starting system, time display
  and visible layer counts.
- **Look:** theme or custom colors; the background (flat, a glow, one of the
  three abstract grounds or a photo) and the faces over it; dial style and
  other visual options.
- **Tuning:** distances and sizes for the rings and layers.

Changes apply immediately and stay in that browser, under
`pulse-ha-settings` and `pulse-openhab-settings` in local storage, so a wall
tablet and a phone can show different parts of the same home. **Back to
defaults** restores the app's configured defaults.

### Open a specific view from a link

Both apps read these URL parameters:

| Parameter | Values | Purpose |
|---|---|---|
| `systems` | Comma-separated system ids | Limit the available systems |
| `mode` | `grid`, `orbit`, `layers`, `list` | Set the initial board view |
| `axis` | `systems`, and `rooms` on Home Assistant or `groups` on openHAB | Group by system or by room |
| `start` | A system id | Open inside that system |

Pulse for Home Assistant (`/`) adds:

| Parameter | Values | Purpose |
|---|---|---|
| `areas` | Comma-separated Home Assistant area ids | Limit entities to those areas |
| `layers` | A positive integer | Set the number of systems stacked in Layers view |
| `demo` | A demo home id | Use a demo home instead of a live connection |
| `lang` | A locale tag, such as `es-AR` | Try number and time formatting in the demo |

Its system ids: `lights`, `climate`, `security`, `people`, `openings`,
`media`, `energy`, `scenes`, `maintenance`, `assist`.

Pulse for openHAB (`/openhab/`) adds:

| Parameter | Values | Purpose |
|---|---|---|
| `server` | An openHAB address | Read that openHAB directly (CORS on there) instead of the one serving the page or the proxy |
| `token` | An API token | Sent with every request; for a kiosk's link. A token pasted in the panel is kept in the browser instead |
| `demo` | | The recorded demo house instead of a server |

Its system ids: `lights`, `climate`, `openings`, `security`, `media`,
`energy`, `weather`, `people`.

For example:

```text
http://127.0.0.1:5174/?systems=lights,climate&mode=orbit&start=climate&areas=kitchen,living_room
http://127.0.0.1:5174/openhab/?demo&axis=groups&mode=grid
```

Use your own area ids. The systems and areas in the URL limit what settings
can offer; saved browser preferences can override defaults such as the view.
When embedding the Home Assistant app through `mountPulse`, `settings: false`
hides the settings panel.

## Demo homes

### The six of demo.home-assistant.io

The Home Assistant app includes six homes from demo.home-assistant.io:
`home`, `sections`, `arsaboo`, `teachingbirds`, `kernehed` and `jimpower`.
The `home` and `sections` demos have the widest range of controls; the
others are mostly sensors.

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

### openHAB's demo house

The openHAB app includes the openHAB project's demo house, recorded from
demo.openhab.org one evening: 233 items with their semantics, a day of
history for 38 of them, the home's time zone. Played back, the recording is
moved to now, breathes every three seconds and echoes commands after 400 ms
by item type: a light turns on, a heating turns off, a speaker pauses. The
Playwright tests use it to exercise the app without a running openHAB.

The house is recorded again with:

```sh
node src/openhab/demo/scripts/record.mjs [server]
```

It writes `src/openhab/demo/recording.json` and the covers of what the
speakers play as drawn SVGs in `src/openhab/demo/covers/` (the album art is
copyrighted; the drawing names the album and the artist). Rerun the recorder
rather than editing the recording by hand.

## Build and check

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:card
npm run build:openhab
npm run pack:openhab
npm run build:pages
```

The app build writes `dist/`: both apps and the gallery, for a web server of
your own. The card build writes `dist-card/zumer-pulse.js`, with the core,
Orbit and Zumly bundled and `hls.js` left out (about 810 kB, 190 kB
compressed). The openHAB build writes `dist-openhab/`: the openHAB app alone,
with relative paths and the same-origin flag on, so that it runs from any
folder a server exposes; `pack:openhab` zips it as `pulse-openhab.zip` at the
root, the asset a release attaches next to `zumer-pulse.js`. The pages build
writes `dist-pages/`: both apps and the gallery with relative paths, no
openHAB target and no proxy, for a plain static host. It is what
[the Pages workflow](.github/workflows/pages.yml) publishes at
zumerlab.com/pulse-home/ on every push to `main`, and each night when this
repo or the core moved (the page keeps the two commits it was built from in
`version.txt`): it checks out `zumerlab/pulse` beside this one, so
`vite.shared.ts` reads the core live, as on a desk. None of `dist-openhab/`,
the zip and `dist-pages/` is committed.

To try that build as openHAB would serve it, any static server over
`dist-openhab/` will do. The page then takes that server's origin for its
openHAB, so expect the connect panel with a "No openHAB answered" line, and
the demo house behind it.

For card development, open [the card bench](http://127.0.0.1:5174/card.html)
while `npm run dev` is running. It accepts `home`, `config` (JSON),
`size=panel|section`, `width` and `height` as query parameters. The bench is
available in development and is excluded from the app build.

```text
/card.html?home=sections&size=section&config={"systems":["climate"],"start":"climate"}
```

The tests run over the demos, one development server for all:
[tests/ha.spec.ts](tests/ha.spec.ts) covers the Home Assistant app, the card
and the gallery; [tests/openhab.spec.ts](tests/openhab.spec.ts) the openHAB
app. Live Home Assistant tests are in
[tests/ha-live.spec.ts](tests/ha-live.spec.ts) and are skipped unless
`PULSE_HA_TOKENS` points to a tokens file.

For local integration work, `scripts/ha-tokens.mjs` creates a tokens file from
`.env.local`. `scripts/ha-install-card.mjs` registers a dashboard resource and
creates or updates two test dashboards in Home Assistant;
`scripts/ha-check-card.mjs` checks them with Playwright and saves screenshots.
`scripts/record-tour.mjs <dir> [ffmpeg]` records two short videos of the
Home Assistant app over a demo home with Playwright, for a post or a page:
the board (views, rooms, themes, backgrounds) and the inside of a system (a
dial, a detail, a choice, the switches, the month of a meter). With an ffmpeg
given (or `FFMPEG` set) each comes out as an mp4, otherwise as webm.

## Troubleshooting

- **The app cannot connect:** check that the server's address is reachable
  from this browser. For an HTTPS Pulse page, use an HTTPS address. An
  openHAB at another address than the page's needs CORS on.
- **Only some systems or channels appear:** check for matching entities or
  items, area filters and hidden channels in settings. Try **Back to
  defaults** to clear saved display choices. On openHAB, an item is read only
  through the semantic model.
- **A command fails or a dial returns to its old value:** read the error below
  the object and check the device's state on the server.
- **The rings do not render correctly:** try an up-to-date browser or WebView.
  Pulse relies on modern CSS features.

For resource-loading errors, card configuration, the folder openHAB serves
and dashboard layout issues, see the README's troubleshooting for
[Home Assistant](README.md#troubleshooting) and
[openHAB](README.md#troubleshooting-1).
