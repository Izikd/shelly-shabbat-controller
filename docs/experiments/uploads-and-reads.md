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
