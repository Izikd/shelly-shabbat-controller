# Shabbat Controller for Shelly

A Shabbat clock (שעון שבת) that runs on the Shelly itself: it switches the relay on during
timers you set inside Shabbat & Yom Tov windows (candle lighting to havdalah, Israel,
2025-2030, from an embedded table). Use it for anything on a relay - a Shabbat elevator,
lights, a hot plate, air conditioning. No internet or cloud needed once the clock is synced.
Settings are edited on a web page served by the Shelly.

Developed and tested on a **Shelly Pro 1** (firmware 2.0.3), where it drives a Shabbat elevator.

## Supported devices
Any Shelly that meets all of these should work; only the Pro 1 has been tested on hardware.

| Requirement | Why |
|---|---|
| Gen2 or newer (Plus, Pro, Gen3, Gen4) with scripting | the controller is a Shelly script. Gen1 devices have no scripting |
| **Firmware 2.0.0 or newer** | the settings page and API use `Script.addRpcHandler`, added in 2.0.0 |
| A relay output (`Switch` component) as `switch:0` | the controller switches `switch:0` only. Two-channel devices must be in switch mode, not cover mode. Dimmers / RGBW (`Light` component) are not supported |
| 2 free script slots, about 25 KB of free script memory | one running script (peak ~17-21 KB on the Pro 1) plus `shabbat_ui`, which is stored but never started. Script memory is shared, so other running scripts count too |
| Clock sync (SNTP) after every power-up | the device needs the time to know where it is in the table; until it is synced the relay stays off |

Devices that fit (from the Shelly API docs; untested unless marked):
- **Pro**: Pro 1 (tested), Pro 1PM, Pro 2, Pro 2PM (switch mode), Pro 3, Pro 4PM
- **Plus (Gen2)**: Plus 1, Plus 1PM, Plus 1 Mini, Plus 1PM Mini, Plus 2PM (switch mode),
  Plus Plug S / IT / UK / US, Plus Uni
- **Gen3**: 1, 1PM, 1L, 2L, 2PM (switch mode), 1 Mini, 1PM Mini, Plug S, Plug M, Outdoor Plug S
- **Gen4**: 1, 1PM, 1L, 2L, 2PM (switch mode), 1 Mini, 1PM Mini, Plug US, PowerStrip

Not supported: Gen1 devices, Shelly AZ Plug (no scripting), dimmers and RGBW controllers,
battery-powered sensors. Firmware 2.0 availability for a given model is set by Shelly - check
the device's firmware page. Before relying on a new model, run `tools/deploy.py` and check the
memory it prints, then use **test time** on the settings page to step through a window.

## Install (two scripts)
Download `shabbat_controller.js` and `shabbat_ui.js` from the latest
[release](https://github.com/Izikd/shelly-shabbat-controller/releases), then:
1. **Controller** - Scripts -> Create script, any name (e.g. `shabbat_controller`),
   paste `shabbat_controller.js`, Save, enable **Run on startup**, **Start**.
2. **Settings page** - Scripts -> Create script named exactly **`shabbat_ui`**,
   paste `shabbat_ui.js`, Save. **Do not start it and do not enable Run on startup.**
   It only stores the page code (the browser reads it with `Script.GetCode`).
   (Or let `tools/deploy.py` below do steps 1-2.)
3. Switch settings -> power-on default: **Off** (fail-safe if the controller is ever stopped).
4. Open `http://<shelly-ip>/script/<controller id>/ui` (the console prints the exact URL).

### Upgrading from a computer
`tools/deploy.py` uploads the scripts to the device over its RPC API (Python, no
dependencies; `python3 tools/deploy.py ...` works too):
```
uv run tools/deploy.py 192.168.1.50 --release latest   # the latest GitHub release
uv run tools/deploy.py 192.168.1.50 --release v1.0.0   # a specific release
uv run tools/deploy.py 192.168.1.50 --build            # build this checkout and install it
uv run tools/deploy.py shelly.example.com --dry-run    # domain; only show what would change
```
Without `--release` it installs `dist/` of this checkout (`npm run build`). While the
repository is private, `--release` needs a GitHub token: `GITHUB_TOKEN` / `GH_TOKEN`, or a
logged-in `gh` CLI. It prints the version on the device and the one being installed.
It finds the controller (name starting `shabbat_controller`, or the old `shabbat_elevator`,
which it renames) and `shabbat_ui` scripts, creating them if missing, uploads only scripts whose code differs, verifies each upload by reading it back,
restarts the controller, keeps `shabbat_ui` stopped, and prints memory use and the next window.
Re-running is harmless. Options: `--password` (or `SHELLY_PASSWORD`), `--diag` (install the
diagnostic build), `--no-ui`, `--restart`.

The controller deletes any virtual components left on the device by older versions.

## Settings page
Hebrew and English. A browser set to Hebrew gets Hebrew on the first visit, any other browser
gets English; the button in the header switches language and the browser remembers the choice
(it is not stored on the device). All page text is in the `I18N` table at the top of
`src/ui.js` - add a language by adding an entry there.
- **Status**: Shabbat / Yom Tov now, next window, next relay ON, automation on/off,
  skip next window (one-off), test time (simulated clock, RAM only).
- **Timers** (up to 12): start point candle lighting (+min) / fixed time / havdalah (-min),
  duration, applies to Shabbat & Yom Tov / Shabbat only / Yom Tov only, and for fixed-time
  timers every day / first day / last day of the window. All clipped to the window.
- **Safety**: every switch-on also arms the firmware's own auto-off (`toggle_after`), so the
  relay drops at the end of the interval even if the script stops. Manual switching (app,
  button, web) is respected until the next timer event ("return to automatic" button).
- **Relay log**: last 15 on/off events with cause (automatic / manual / firmware auto-off /
  fail-safe / test), kept on the device. **Technical info**: version, firmware, uptime, clock
  sync, device memory and storage, script memory and errors (read by the browser from firmware
  RPCs, so it costs the controller no memory).
- **Hebrew dates** on windows (browser's built-in Hebrew calendar).
- **Schedule**: every window in the table, by year, holidays-only filter, past windows.
- **Forecast**: next 6 windows with merged ON times, computed by the device for the
  unsaved draft. Changes are applied only with "Save to device".

## Device API (Script.<method>, params include `id` = controller script id)
- `ShabbatGet` -> `{cfg:{timers, auto, skip}, st:{now, test, synced, auto, relay, on, cur, next, nextOn, end}}`
- `ShabbatSet {timers?, auto?, skip?, test?, resume?}` -> same as Get (validated, saved to KVS)
- Get/Set also return `log` ("<minutes since base><1|0><cause>,...") and `base`
- `ShabbatPreview {timers?, n?}` -> `{w:[{t, k, s, e, skip, on:[[s, e, "1+3"]]}], now}`
- Timer = `[anchor 0/1/2, value, duration, applies 0/1/2, days 0/1/2, enabled 0/1]`

## Development
Edit `src/`; `dist/` is build output and is not committed. Sources are formatted with Prettier.
```
npm install            # prettier, terser, playwright
npm run format         # format src/, test/, tools/ (npm run format:check to verify)
npm run build          # src/ -> dist/
npm test               # build, then the simulator and a browser test of the settings page
npm run check:table    # regenerate the table with hdate and fail if it changed (needs uv)
```
The browser test needs Chromium for Playwright: `npx playwright install chromium` once.

Every push to `main` and every pull request runs the same checks in GitHub Actions
(`.github/workflows/ci.yml`); the build and the page screenshots are attached to the run.

## Releasing
Push a version tag; `.github/workflows/release.yml` builds with that version stamped into
every file, runs the tests and publishes a GitHub release with the three scripts:
```
git tag v1.0.0
git push origin v1.0.0
```
The version is the first line of each file (`... - version v1.0.0 - ...`). Local builds use
`git describe` (`v1.0.0-3-gabc1234`, or `dev-abc1234` before the first tag); the settings page
(Technical info) and `deploy.py` show it.

## Layout
- `src/main.js` controller, `src/ui.js` settings page, `src/table.js` generated table
- `tools/gen_table.py` table generator (hdate; adds DST periods). Writes `src/table.js` and
  `test/windows.json` (the simulator's reference). To extend or move the table:
  `uv run tools/gen_table.py --years 2025 ... 2035` (`--lat/--lon` for another city), then
  `npm run build`. The Python tools declare their dependencies in a PEP 723 header, so uv
  installs hdate on the fly; without uv, `pip install hdate==1.2.2` and run them with
  `python3`. hdate is pinned: a new version may move times, so bump it on purpose
- `tools/build.mjs` (`npm run build`) -> `dist/shabbat_controller.js`, `dist/shabbat_controller_diag.js`,
  `dist/shabbat_ui.js`. Minifies with terser: the page fully; the controller only by renaming
  local variables and dropping whitespace (no code restructuring, which could break the engine
  limits below). Top-level names are kept for `test/sim.js`
- `tools/deploy.py` uploads a build or a release to a device (see "Upgrading from a computer")
- `.github/workflows/` CI (format, build, tests, table check) and releases
- `test/sim.js` device simulator (minute-by-minute relay sweep vs an independent reference)
- `test/mockdevice.js` + `test/ui_test.js` fake Shelly + Playwright browser test of the page

## Shelly engine constraints learned on the device (fw 2.0.3)
- `@meta` virtual-component declarations crashed the device -> not used.
- Small JS stack: keep call depth <= 5 and expressions flat; start work from timer callbacks.
- RPC handlers (`Script.addRpcHandler`) run with even less stack: they only queue the call;
  the work runs from a timer callback and answers the request from there.
- No `Array.prototype.sort`; no `\u` escapes in strings (use UTF-8).
- Max 5 event subscriptions / timers / RPC handlers per script; ~25 KB JS memory pool.
