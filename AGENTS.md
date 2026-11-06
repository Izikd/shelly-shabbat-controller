# Notes for AI agents (and humans)

A Shabbat & Yom Tov relay controller that runs as a script on a Shelly (Gen2+, firmware 2.0+),
with a settings page served by the device. See `README.md` for what it does and how users
install it. This file is how to work on it. Before changing device-facing code, read
`docs/device/` (limits of the Shelly engine, learned on hardware) and skim
`docs/experiments/` (what was measured, and why the code looks the way it does); the index
is `docs/README.md`. Keeping these notes current is part of every change: see
"Done means" below.

## Layout
- `src/main.js` controller (runs on the Shelly), `src/table.js` its generated window table
- `src/ui.js` settings page (runs in the browser), `src/unpack.js` unpacks it in the browser
- `tools/build.mjs` src -> `dist/` (not committed), `tools/deploy.py` uploads to a device,
  `tools/gen_table.py` regenerates the table with hdate, `tools/check_docs.mjs` checks the
  docs index, links and paths
- `test/` simulator (`sim.js`), fallback decoder (`inflate_test.js`), Playwright test of the
  page against a mock device (`ui_test.js` + `mockdevice.js`)
- `.github/workflows/` CI on push/PR, releases on `v*` tags

## Workflow
- Commit directly to `main`; no pull requests (the owner's preference). Push when done.
- Before pushing: `npm run format` and `npm test` (builds, checks the docs' links and
  index, then all three test suites). CI runs the same checks plus `npm run check:table`.
- Releases are not in use yet. Never push a `v*` tag unless asked. Everything works without
  tags: builds are stamped `version dev - commit <sha> - built <ISO time>`.
- Commit messages: a short subject, then why, and what was measured or tested on hardware.

## Done means: code, tests and notes together
A change is not finished until the notes match it. In the same commit:
- **You measured something on hardware** (timings, memory, sizes) -> a dated entry in the
  matching `docs/experiments/` file: Question / Method / Result / Decision, with numbers.
- **The device did something unexpected** (an error, a crash, a limit, a format) -> the
  matching `docs/device/` file, marked *observed* and with the firmware version, **and** teach
  the mock (`test/mockdevice.js` / `test/sim.js`) to behave the same way.
- **A rule, command, workflow step or file layout changed** -> update this file.
- **Your change makes an existing note wrong** (a read size, a limit, a number, a file name)
  -> fix that note; do not leave it for later.
- **You added a file under `docs/`** -> add it to the index in `docs/README.md`.
  `npm test` fails if a docs file is missing from the index, or if a link or a repository
  path in backticks in the docs points to nothing.
- **When reporting back, say which notes you updated**, or that none needed changes and why.

## Commands
```
npm install                     # once
npm run format                  # prettier on src/ test/ tools/
npm test                        # build + docs check + inflate_test + sim + ui_test
npm run check:docs              # docs index complete, links and paths resolve
npm run build                   # dist/ only
uv run tools/deploy.py <host> --build   # build and install on a device
uv run tools/deploy.py <host> --dry-run # what would change
npm run check:table             # table still matches hdate (needs uv)
```
The browser test needs Chromium for Playwright (`npx playwright install chromium`). If a
Playwright browser is preinstalled (`PLAYWRIGHT_BROWSERS_PATH`), keep the pinned `playwright`
version matching it instead of installing another.

## Rules that must not be broken
Each has a reason in `docs/device/` and `docs/experiments/`.
- **Built files are pure ASCII.** `build.mjs` fails otherwise. The page is escaped and
  compressed; the controller cannot be escaped (the engine rejects `\u` escapes), so no
  non-ASCII text in `src/main.js` code paths that reach the device.
- **Read script code in small pieces**: `Script.GetCode` with `len=4096`, several in
  parallel. A large read costs the device about twice its size in RAM and has rebooted it.
- **Controller code style**: call depth <= 5, flat expressions, named top-level callbacks,
  no `Array.prototype.sort`, at most 5 timers / handlers / concurrent `Shelly.call`s.
  RPC handlers only queue work; a timer callback does it (`enqueue`/`runQueue`).
- **Controller minification stays conservative** (terser `compress: false`): no inlining or
  statement merging. Top-level names must survive; `test/sim.js` calls them.
- **Script memory is tight** (~25 KB pool shared by running scripts; peak ~16-20 KB).
  Do not keep large strings around (assemble per request); check `mem_peak` after a deploy.
- **KVS keys `shabbat_elev_cfg` / `shabbat_elev_log` keep their names** (old project name):
  renaming them loses users' timers and log.
- **`shabbat_ui` never runs on the device**; it only stores the page code. deploy.py keeps it
  stopped and disabled.
- **Mocks must behave like the device** (`test/mockdevice.js`, `test/sim.js`): byte-range
  `GetCode` that garbles split UTF-8, refuses reads without a small `len`, errors past the end;
  `Script.List` available from the script. When the real device surprises you, teach the mock.
- **Do not commit device addresses, hostnames or passwords.** The repo may become public and
  test devices may have no password.

## Working with a real device
- `deploy.py` uploads only what changed (ignoring the build time), verifies by reading back,
  uploads the page before stopping the controller, retries dropped requests and resumes
  uploads safely. A changed commit restarts the controller; avoid deploying during an active
  window on a device that drives something real.
- Prefer `--dry-run` first on an unfamiliar device. `deploy.py` prints the installed version
  (`<sha>` or `v1.0.0 (<sha>)`, plus build time); the page shows it under Technical info.
- The device the project is developed on is a Shelly Pro 1 used only for experiments
  (owner's statement): rebooting it and trying read patterns on it is fine. Ask before
  experimenting on any other device.
- Useful RPCs: `Sys.GetStatus` (uptime, `ram_free`, `ram_min_free` - lowest since boot, reset
  by `Shelly.Reboot`), `Script.GetStatus?id=<n>` (`mem_used`, `mem_peak`, `errors`),
  `Script.ShabbatGet` (controller state), `Shelly.GetDeviceInfo`.
- Some reverse proxies block Python's default user agent; deploy.py sends its own.
