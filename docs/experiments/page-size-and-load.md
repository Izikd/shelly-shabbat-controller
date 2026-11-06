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

## Ideas not tried yet
- Inline the first status into the HTML (saves one round trip; costs controller work per
  request).
- Cache the page code in the browser (e.g. keyed by the version stamp) to skip the code reads
  on repeat visits.
