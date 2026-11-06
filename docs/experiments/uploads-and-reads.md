# Uploading and reading script code

Device: Shelly Pro 1, firmware 2.0.3, reached through a reverse-proxy tunnel (0.4-1.3 s
per round trip). Entries are dated, newest last; keep the method so a test can be repeated.

## 2026-11-04 - Uploading Hebrew code
- **Observed**: `Script.PutCode` with JSON `\u` escapes (Python's default `ensure_ascii`) fails
  with `-103 Missing or bad argument 'code'`, leaving a half-written script.
- **Decision**: send raw UTF-8. Later builds are ASCII anyway.

## 2026-11-05 - Reboot from one large read
- **Observed**: after adding English the page was 28 KB; `deploy.py` verified it with one
  `GetCode` of `len=65536`. The device rebooted (`reset_reason` 4, uptime 47 s). The
  controller came back on its own (run on startup) with its settings.
- **Also found**: a byte range that splits a UTF-8 character returns U+FFFD, so small reads
  of UTF-8 text are corrupted.
- **Decision**: all readers use `len=4096`; builds are pure ASCII (page escaped with terser
  `ascii_only`); the build fails on non-ASCII output; mocks refuse large reads and split bytes
  like the device.

## 2026-11-05 - Dropped requests through the tunnel
- **Observed**: a deploy failed mid-upload on a dropped request and left the controller
  stopped for ~2 minutes.
- **Decision**: `deploy.py` retries idempotent calls, resumes `PutCode` from the length the
  device reports (never re-sends an append blindly), uploads the page before stopping the
  controller and restarts the controller if its upload fails. Tested against a fake device
  dropping every 7th request, both before and after applying it.

## 2026-11-06 - Read size and parallelism: speed and memory
- **Method**: read the 17.8 KB page with each pattern 3 times; for memory, `Shelly.Reboot`
  before each pattern (resets `ram_min_free`), wait for the controller, then compare
  `ram_min_free` before and after. No reboots or errors in any pattern.
| Pattern | Time (median) | Extra RAM at peak |
|---|---|---|
| 4 KB x1 (sequential) | 3.0 s | 1 KB |
| 8 KB x1 | 2.2 s | 13 KB |
| 16 KB x1 | 1.2 s | 35 KB |
| 32 KB x1 (whole page) | 0.7 s | 39 KB |
| 4 KB, 3 parallel | 1.3 s | 10 KB |
| 4 KB, 5 parallel | 0.8 s | 6 KB |
| 8 KB, 3 parallel | 0.7 s | 24 KB |
- **Decision**: 4 KB pieces in parallel (fast and gentle); never large reads.

## 2026-11-06 - Installing an update from the settings page
- **Question**: does the page's Check for updates -> Install work on the device, and what
  does `Script.Start` answer for a controller that does not parse?
- **Method**: Playwright against the Pro 1 (fw 2.0.3, through the tunnel), the `library`
  branch served by the test script with builds re-stamped `v0.1.1-hwtest.1`
  (`test/stamp.js`); the device ran a development build of 1cc0db5. One run with a
  controller file that does not parse, one with the real build. Afterwards `deploy.py`
  put the plain build back.
- **Result**:
  - Broken controller: page uploaded and verified (37 `PutCode` calls for both scripts),
    `Script.Stop` ok, `Script.Start` -> HTTP 500 `{code: -2, message: "syntax_error"}`; the
    page put the old code back and started it ("previous version was restored and is
    running"). Controller stopped 10.6 s (most of it re-uploading the backup); whole
    install 30.5 s.
  - Good build: both scripts became `v0.1.1-hwtest.1`, controller stopped 8.2 s, then
    `ShabbatGet` answered 404 `No handler` until its boot finished; saved timers
    (`shabbat_elev_cfg`) byte-for-byte unchanged; `mem_used` 14,238, `mem_peak` 16,184
    afterwards. No reboots.
- **Not tested**: a lost reply in the middle of an upload (resume path), and installing an
  actual published release (no release with this feature exists yet).
- **Decision**: works as designed; the mock now answers `syntax_error` and `No handler`
  like the device.

## 2026-11-06 - Installing published beta releases from the page (owner's test)
- **Method**: the owner, on the Pro 1 (fw 2.0.3) with "Beta versions" on, used Check for
  updates -> Install against the real `library-beta` branch: a development build of 4f250e2
  -> `v0.2.0-beta.1` (13f7a5d), -> `v0.2.0-beta.2` (same commit), -> `v0.2.0-beta.3`
  (cc48cfd, adds the version link and leaving beta).
- **Result**: all three installs worked (owner's report); no timings were taken.
- **Not tested**: a connection drop mid-install; going back to stable with "Install stable"
  (it would reach `v0.1.0`, which has no update card, so only `deploy.py` could return).

