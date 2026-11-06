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

## Ideas not tried yet
- Inline the first status into the HTML (saves one round trip; costs controller work per
  request).
- Cache the page code in the browser (e.g. keyed by the version stamp) to skip the code reads
  on repeat visits.
