# Shabbat Elevator (Shelly Pro 1)

Drives the Shabbat-elevator contactor from a Shelly Pro 1 (firmware 2.0+), using an
embedded table of Shabbat & Yom Tov windows (candle lighting to havdalah, Israel, 2025-2030). No internet needed
once the clock is synced. Settings are edited on a web page served by the Shelly itself.

## Install (two scripts)
1. **Controller** - Scripts -> Create script, any name (e.g. `shabbat_elevator`),
   paste `dist/shabbat_elevator.js`, Save, enable **Run on startup**, **Start**.
2. **Settings page** - Scripts -> Create script named exactly **`shabbat_ui`**,
   paste `dist/shabbat_ui.js`, Save. **Do not start it and do not enable Run on startup.**
   It only stores the page code (the browser reads it with `Script.GetCode`).
3. Switch settings -> power-on default: **Off** (fail-safe if the controller is ever stopped).
4. Open `http://<shelly-ip>/script/<controller id>/ui` (the console prints the exact URL).

### Upgrading from a computer
`tools/deploy.py` uploads `dist/` to the device over its RPC API (Python 3, standard library only):
```
python3 tools/deploy.py 192.168.1.50                    # LAN IP
python3 tools/deploy.py shelly.example.com --dry-run    # domain; only show what would change
python3 tools/deploy.py 192.168.1.50 --build            # rebuild dist/ first
```
It finds the controller (name starting `shabbat_elevator`) and `shabbat_ui` scripts, creating
them if missing, uploads only scripts whose code differs, verifies each upload by reading it back,
restarts the controller, keeps `shabbat_ui` stopped, and prints memory use and the next window.
Re-running is harmless. Options: `--password` (or `SHELLY_PASSWORD`), `--diag` (install the
diagnostic build), `--no-ui`, `--restart`.

The controller deletes any virtual components left on the device by older versions.

## Settings page
- **Status**: Shabbat / Yom Tov now, next window, next relay ON, automation on/off,
  skip next window (one-off), test time (simulated clock, RAM only).
- **Timers** (up to 12): start point candle lighting (+min) / fixed time / havdalah (-min),
  duration, applies to Shabbat & Yom Tov / Shabbat only / Yom Tov only, and for fixed-time
  timers every day / first day / last day of the window. All clipped to the window.
- **Safety**: every switch-on also arms the firmware's own auto-off (`toggle_after`), so the
  relay drops at the end of the interval even if the script stops. Manual switching (app,
  button, web) is respected until the next timer event ("return to automatic" button).
- **Relay log**: last 15 on/off events with cause (automatic / manual / firmware auto-off /
  fail-safe / test), kept on the device. **Diagnostics**: firmware, uptime, clock sync,
  script memory and errors (read by the browser from firmware RPCs).
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

## Layout
- `src/main.js` controller, `src/ui.js` settings page, `src/table.js` generated table
- `tools/gen_table.py` table generator (hdate; adds DST periods). Writes `src/table.js` and
  `test/windows.json` (the simulator's reference). To extend or move the table:
  `pip install -r tools/requirements.txt`, `python3 tools/gen_table.py --years 2025 ... 2035`
  (`--lat/--lon` for another city), then `python3 tools/build.py`
- `tools/build.py` -> `dist/shabbat_elevator.js`, `dist/shabbat_elevator_diag.js`, `dist/shabbat_ui.js`
- `tools/deploy.py` uploads `dist/` to a device (see "Upgrading from a computer")
- `test/sim.js` device simulator (minute-by-minute relay sweep vs an independent reference)
- `test/mockdevice.js` + `test/ui_test.js` fake Shelly + Playwright browser test of the page

## Shelly engine constraints learned on the device (fw 2.0.3)
- `@meta` virtual-component declarations crashed the device -> not used.
- Small JS stack: keep call depth <= 5 and expressions flat; start work from timer callbacks.
- RPC handlers (`Script.addRpcHandler`) run with even less stack: they only queue the call;
  the work runs from a timer callback and answers the request from there.
- No `Array.prototype.sort`; no `\u` escapes in strings (use UTF-8).
- Max 5 event subscriptions / timers / RPC handlers per script; ~25 KB JS memory pool.
