# Settings page: size and load time

Device: Shelly Pro 1, firmware 2.0.3, reached through a reverse-proxy tunnel (0.4-1.3 s
per round trip). Entries are dated, newest last; keep the method so a test can be repeated.

## 2026-11-06 - Page size: ASCII escapes vs UTF-8 vs compression
| Page build | Size |
|---|---|
| Hebrew only (before i18n) | 21.7 KB |
| Hebrew + English, UTF-8 | 28.4 KB |
| same, ASCII-escaped (`\uXXXX`) | 34.6-35.6 KB |
| deflate + base64 + unpacker | 17.6-17.9 KB |
- **Decision**: compress (`src/unpack.js`): `DecompressionStream("deflate")` where available,
  else a ~2 KB decoder after zlib's "puff", tested against Node's zlib. Browser floor stays
  Chrome 86 / Safari 14 / Firefox 78 (set by the page itself, not the compression).

## 2026-11-06 - Load time before and after compression
- **Method**: swap only the `shabbat_ui` script between builds; 10 cold loads each (fresh
  browser context), alternating two rounds; time to the first rendered status (`.kv`), code
  fetch time from resource timings, and a direct Python fetch without a browser.
| Median | Before (35.6 KB, 9 reads) | After (17.8 KB, 5 reads) |
|---|---|---|
| Page ready | 5.94 s | 4.36 s |
| Code fetch (browser) | 3.86 s | 2.01 s |
| Code fetch (direct) | 3.98 s | 2.08 s |
- **Conclusion**: time scales with the number of sequential requests (~0.4 s each here).

## 2026-11-06 - Shortening the page-load chain
- **Method**: browser resource timings per request. The chain was HTML (0.8 s) ->
  `Script.List` (0.7 s) -> first code piece -> remaining pieces -> `ShabbatGet` (0.65 s).
- **Changes**: the controller looks up the `shabbat_ui` id at boot and puts it in the HTML
  (fallback to `Script.List`); the loader reads all 5 pieces in one parallel round and starts
  `ShabbatGet` alongside (the page's first refresh uses it).
| Median of 10 cold loads | Page ready | Fastest |
|---|---|---|
| Before compression | 5.94 s | 5.34 s |
| Compressed | 4.36 s | 3.85 s |
| + parallel 4 KB reads | 4.36 s | 3.05 s |
| + one round, prefetched status, no list | 2.73 s | 1.18 s |
- **Side effect found**: the bigger loader string, kept both as parts and assembled, raised
  `mem_used` 14.5 -> 16.1 KB. Assembling it per request brought it to 14.2 KB.
- **Remaining**: the HTML itself and tunnel variance (0.4-2 s per request).

## 2026-11-06 - Check for updates makes the page bigger than one read round
- **Measured** (local builds only, not on hardware): adding the Software update card took the
  stored page from 17,971 to 20,725 bytes (minified page 29,993 -> 35,947 bytes). Shortening
  its texts saved ~430 bytes; the rest is the upload / verify / restore logic.
- **Effect**: the loader reads 5 x 4 KB = 20,480 bytes in its first parallel round, so the
  last 245 bytes need a second round on every load (~0.4-1.3 s through the tunnel, a few ms
  on the LAN).
- **Settled** by the hardware entry below: the loader now reads 6 pieces in its first round.
- **Later the same day**: the beta channel switch took the page to 21,093 bytes (613 over the
  first round).

## 2026-11-06 - The 21 KB page on hardware: load time, and 5 vs 6 parallel reads
- **Method**: Pro 1, fw 2.0.3, through the tunnel. Load time: 7 cold loads each (fresh
  browser context), time to the first rendered status (`.kv`), before and after installing
  the bigger page. Memory: `Shelly.Reboot`, wait for the controller, then one round of N
  parallel 4 KB `GetCode` reads of `shabbat_ui`, comparing `ram_min_free` before and after;
  3 runs each, alternating.
- **Result**:
| | 17,968 B page, 5 reads | 21,076 B page, 6 reads |
|---|---|---|
| Load, median of 7 | 2.39 s | 2.54 s |
| Load, range | 1.78-3.79 s | 1.73-4.80 s |
| Extra RAM, one round of 5 parallel reads | 0, 9.2, 4.3 KB | |
| Extra RAM, one round of 6 parallel reads | | 6.7, 12.7, 10.6 KB |
  About 100 KB was free before the reads; no reboots or errors.
- **Reading**: the second read round costs ~0.15 s here, within the tunnel's noise. Six
  parallel reads cost about 5-6 KB more RAM than five; still well below the ~28 KB single
  read that rebooted the device.
- **Decision** (owner): the loader reads 6 pieces (24 KB) in its first round, so the 21 KB
  page loads in one round again; reads past the end return no data, as before.
- **Check after the change** (4f250e2 on the Pro 1): 6 reads in one round, page ready median
  1.86 s over 7 cold loads (range 1.73-3.88 s); controller `mem_used` 14,238 / `mem_peak`
  16,184 unchanged; no reboot.

## 2026-11-06 - Page fails to load with other windows open: 2 requests at a time
- **Question**: the owner's phone (and then desktop Chrome, and the LAN address) showed "UI
  load failed: Unexpected token '<', "<!DOCTYPE "... is not valid JSON" / "Failed to fetch".
  Why, and what should the loader do?
- **Method**: Pro 1, fw 2.0.3, controller v0.2.0, through the tunnel, while the owner had
  several windows of the device open. Playwright loads (Pixel 7, Galaxy S9+, desktop Chrome)
  logging every non-JSON answer; then rounds of N parallel 4 KB `GetCode` reads of
  `shabbat_ui` (7 reads = the page plus one, like a load), 5 loads per strategy.
- **Result**: loads failed 3 times in 4 on every browser; failed requests were Cloudflare
  502 pages (see `../device/network.md`).
| Requests at a time | Failed requests (of 35) | Load of 7 reads, median (range) |
|---|---|---|
| 1 | 0 | 2.45 s (2.27-3.35) |
| 2 | 0 | 2.08 s (1.67-3.03) |
| 3 | 7 | 2.81 s (1.95-3.69) |
| 4 | 13-16 | 2.77-2.96 s |
| 7 at once, failed ones retried | 21-24 | 2.16-2.53 s (1.39-4.58) |
  Closing most of the open windows made the page load again (owner).
- **Reading**: the device's few connections are shared with every other client; the earlier
  entry's 6 parallel reads worked only because few were in use. Two at a time never failed
  and was as fast as any other strategy here, because the tunnel's latency dominates.
- **Decision** (owner): supersedes "6 reads in the first round". The loader and the page
  keep at most 2 requests in flight (a queue) and retry a failed or non-JSON request up to 3
  times (300, 800, 1300 ms); code uploads are not retried blindly. Cost: the loader text in
  the controller grew by ~380 bytes (script memory); page 23,826 bytes. Not yet checked on
  hardware.

## 2026-11-07 - Locations (hebcal in the browser): the page grows to 28 KB, 7 pieces
- **Measured** (local builds only, not on hardware): the location card, loading hebcal from
  the CDN, the table code (`src/tablegen.js`) and its texts took the stored page from 23,816
  to 28,326 bytes (minified page 42,816 -> 51,689 bytes). The controller shrank from 18,323
  to 16,976 bytes (no table in its code).
- **Decision** (owner): the page budget is 28,672 bytes (7 x 4 KB); the loader asks for 7
  pieces, still 2 at a time.
- **On hardware** (Pro 1, through the tunnel, 7 cold loads of the 28,322-byte page, time to
  the first status): 2.28, 2.60, 2.73, 2.75, 3.22, 3.80, 9.02 s - median 2.75 s, 7 code
  reads. The last measurement with 6 reads was a 2.08 s median, so the 7th piece and the
  tunnel's noise cost ~0.7 s.

## 2026-11-07 - Z85 instead of base64, and fewer requests from the page
- **Measured** (local builds only, not on hardware): storing the compressed page as Z85
  (5 ASCII characters per 4 bytes, no `"` or `\`, so no escaping) instead of base64 (4 per 3)
  took the payload from 25,108 to 23,681 characters and the stored page from 28,312 to
  27,076 bytes, with the decoder and the changes below included: ~1.6 KB of room under the
  28,672-byte budget instead of 360 bytes. Still 7 code reads. The decoder reads the text up
  to its end rather than using `PAYLOAD.length`: terser turned that into a constant, which
  broke the update test's re-stamped page (`test/stamp.js`).
- **Requests**: the page no longer asks for a forecast (`ShabbatPreview`, computed on the
  device) on load, only when the Forecast tab is opened or the timers change. The 15 s status
  poll skips hidden tabs and minimised windows and catches up when the page is shown again,
  so pages left open in the background no longer take the device's few connections
  (`../device/network.md`). A status reply that matches the last one, apart from `st.now`,
  no longer rebuilds the page (the Schedule tab has hundreds of rows).
- **On hardware** (Pro 1, fw 2.0.3, through the tunnel, a441372, page 27,068 bytes; 7 cold
  loads, fresh browser context, time to the first status): 2.23, 2.25, 2.27, 2.28, 2.32,
  2.74, 3.38 s - median 2.28 s (2.75 s for the 28,322-byte page, same method). Still 7 code
  reads; 17 requests in all on load, no `ShabbatPreview`, no page errors. The Forecast tab
  still loads its forecast when opened. Controller after the loads and one forecast:
  `mem_used` 17,136, `mem_peak` 23,184 (the forecast's peak, as in
  `table-generation.md`), no errors; `ram_min_free` 61,184.

## 2026-11-07 - Tabs regrouped: Status / Timers / Schedule / Settings
- **Change**: Status keeps the day-to-day items; the forecast moved under the timers (it
  follows unsaved edits); Schedule lists the coming year with "Show all years"; location,
  test time, public page, updates and technical info moved to a Settings tab. The open tab
  is kept in the address (`#settings`), so the reload after an update comes back to it.
- **Measured** (local builds only): page 27,068 -> 27,421 bytes (+353 for the new tab, its
  texts and the year limit). Requests on load: only `ShabbatGet` besides the code reads;
  the beta choice (`KVS.GetMany`) and `ShabbatPub` are asked when Settings first opens, and
  the publishing status is polled only while Settings is open. Schedule tab: 56 rows for the
  coming year instead of 232.
- **On hardware** (Pro 1, fw 2.0.3, through the tunnel, 7c3e1ba, page 27,410 bytes; 7 cold
  loads, time to the first status): 2.22, 2.23, 2.24, 2.27, 3.03, 3.24, 4.27 s - median
  2.27 s (2.28 s before the regrouping). On load 13 requests in all (17 before); the only
  RPCs are the 7 code reads and `ShabbatGet`, no `KVS` or `ShabbatPub` until Settings
  opens. Timers showed the forecast (18 ON times), Schedule 55 rows, Settings and Technical
  info loaded, and a reload stayed on `#settings`. No page errors. Controller afterwards:
  `mem_used` 17,136, `mem_peak` 23,884 (after one forecast; the controller code did not
  change, forecasts have peaked at ~23.2-23.9 KB), no errors.

## 2026-11-07 - Repeating timers
- **Change**: a timer can repeat (on for its duration every N minutes, for a length); the
  editor gets a Repeat choice and two steppers, the forecast one line per repeat.
- **Measured** (local builds only, no hardware yet): page 27,421 -> 28,056 bytes (+635),
  still inside the 28,672-byte budget (616 bytes left). Controller 17,642 -> 20,116 bytes
  (+2,474: the pulses are worked out on the fly, never listed, so no object per pulse);
  `mem_peak` with repeats is still to be measured on the device.

## 2026-11-08 - Repeating timers on the device: out of memory and stack overflow
- **Question**: does the repeating-timers build (138e6a5) fit the script's memory and stack?
- **Method**: Pro 1, fw 2.0.3, through the tunnel, no window near (Sunday morning). Deployed
  with deploy.py; `Script.GetStatus` after each step. Forecasts (`ShabbatPreview`) with the
  saved plain timers and with draft timers with 3 repeats (5 timers); then the same timers
  put into the running script with `Script.Eval` (RAM only: nothing saved, nothing
  published) and the relay driven with test time.
- **Result**:
  - after boot: `mem_used` 17,906, peak 21,266 (main 924aaa0: 16,898 / 20,258);
  - forecast, plain timers: 1, 2, 4, 6 windows -> peak 21,266, 21,266, 21,910, 23,436;
  - forecast, draft with repeats: 1-3 windows below 23,436, 4 windows 24,430, 5 windows
    `out_of_memory` (the script stopped; the first try, 6 windows like the page, too);
  - relay with repeats (test time 16:36 on a Friday window): the first tick stopped the
    script with "Too much recursion" in `tick > segAt > repScan > localToUtc`;
  - each time the script was started again by hand, on the saved plain timers; the relay
    stayed off.
- **Decision**: the build is not usable on the device; the device is back on main 924aaa0
  (peak 20,258 after boot, publishing OK). The repeats need a leaner design before they go
  further (owner's decision on the plan).

## 2026-11-08 - Repeating timers reworked: fits, and as fast as before
- **Question**: after the rework (every timer start is a block; the tick walks the blocks
  with small functions; the forecast merges the plain timers in one pass; the page asks 3
  windows at a time), does it run on the device, and how fast is the forecast?
- **Method**: as above (Pro 1, fw 2.0.3, through the tunnel), local builds of the session
  branch. Three intermediate builds failed and taught the engine notes (a ternary syntax
  error, a nested condition that rebooted the device, a stack overflow on the publish path;
  `../device/engine.md`); the device log (`/debug/log`) with `diag: true` showed where. Then:
  forecasts timed with curl, the relay with repeats (RAM only, test time), a publish with
  repeats to a closed local port (the real body built, nothing sent), the real page in
  Chromium (Timers, a repeat switched on, not saved).
- **Result** (controller 19,855 bytes, page 28,119 of the 28,672 budget; main 924aaa0 for
  comparison):
  - after boot: `mem_used` 17,850, peak 21,252 (main 16,898-17,094 / 20,258-20,454);
  - forecast time, saved plain timers: 1 window ~1.0 s, 3 ~1.5-1.9 s, 6 ~2.2-3.3 s (main:
    1.0-1.2, 1.5-2.5, 2.2 s); 3 windows with repeats ~2.4 s. Each request includes ~0.7 s
    of tunnel. Before the one-pass merge the same 3 windows took ~3.5 s (260 calls of the
    controller's functions instead of 59; main 74, counted in the simulator);
  - forecast memory with repeats: 3 windows peak 23,926, 4 windows 24,850, 5 `out_of_memory`;
  - the relay followed the pulses at every test time (on 16:36-16:39, off, 16:51-16:59 where
    two timers' pulses touch, ...), the next pulse shown between them;
  - publish with repeats: body built and sent (connection refused as planned), no error,
    peak 23,436; then the real settings back, sent OK;
  - page: status 3.1-3.3 s, the forecast 2 x 2 requests of ~1.6-1.7 s (one after the other,
    so ~3.3 s for 6 windows; main asks once, ~2.2 s), 6 windows each with its repeat line, no
    page errors; peak 24,164 during the page's use (main ~23,900 after a forecast).
- **Decision**: keep the 3 + 3 forecast (5 windows still run out of memory with repeats).
  The device is back on main 924aaa0.

## Ideas not tried yet
- Inline the first status into the HTML (saves one round trip; costs controller work per
  request).
- Cache the page code in the browser (e.g. keyed by the version stamp) to skip the code reads
  on repeat visits (costs ~250 bytes of loader text in the controller's memory).
