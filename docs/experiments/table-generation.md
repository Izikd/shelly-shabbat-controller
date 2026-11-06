# Window table generation

Device: Shelly Pro 1, firmware 2.0.3, reached through a reverse-proxy tunnel (0.4-1.3 s
per round trip). Entries are dated, newest last; keep the method so a test can be repeated.

## 2026-11-04 - Table: hdate reproduces the ESPHome header
- **Question**: can `tools/gen_table.py` (hdate) replace the hand-carried
  `isur_melacha_ranges.h` from the owner's ESPHome config?
- **Method**: generate 2025-2030 for the header's coordinates; compare window by window.
- **Result**: 336/336 windows identical to the minute, same titles, **only** with hdate's own
  sun model. With the optional `astral` package installed, hdate switches models and times
  move 2-8 minutes (11/336 matched). Altitude (hdate defaults to Jerusalem's 754 m) has no
  effect with hdate's own model.
- **Decision**: generate from hdate, force `_USE_ASTRAL = False`, pin `hdate==1.2.2`; CI
  regenerates and fails on any difference.
