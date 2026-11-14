# Window table generation

Device: Shelly Pro 1, firmware 2.0.3, reached through a reverse-proxy tunnel (0.4-1.3 s
per round trip). Entries are dated, newest last; keep the method so a test can be repeated.
Since 2026-11-07 the times come from hebcal in the browser (last entry); the hdate generator
of the first entry (tools/gen_table.py) and its table (src/table.js) were removed.

## 2026-11-04 - Table: hdate reproduces the ESPHome header
- **Question**: can tools/gen_table.py (hdate) replace the hand-carried
  `isur_melacha_ranges.h` from the owner's ESPHome config?
- **Method**: generate 2025-2030 for the header's coordinates; compare window by window.
- **Result**: 336/336 windows identical to the minute, same titles, **only** with hdate's own
  sun model. With the optional `astral` package installed, hdate switches models and times
  move 2-8 minutes (11/336 matched). Altitude (hdate defaults to Jerusalem's 754 m) has no
  effect with hdate's own model.
- **Decision**: generate from hdate, force `_USE_ASTRAL = False`, pin `hdate==1.2.2`; CI
  regenerates and fails on any difference.

## 2026-11-07 - hebcal (JavaScript) vs the hdate table
- **Question**: for any location, the table has to be computed where the location is chosen:
  in the browser. Does `@hebcal/core` give the same windows as the hdate table, and if not,
  which is right?
- **Method**: `@hebcal/core` 6.15.0 (browser bundle, run in Node) for Petah Tikva
  (32.0877639, 34.8859985), 2025-2030: a window = the first candle lighting to the next
  havdalah. Compared with the hdate table (hdate 1.2.2, own sun model), with hdate using
  `astral` at its default altitude (754 m), and with hdate + `astral` at 0 m. Also, for the
  plan, hdate's own model for 8 Israeli cities against Petah Tikva.
- **Result**: the same 336 windows on the same dates and holidays. Times, hebcal minus hdate,
  in minutes:
| hdate variant | Candle lighting | Havdalah |
|---|---|---|
| own sun model (the old table) | -6 .. +1, seasonal (Aug-Oct about -5) | -3 .. +3, seasonal |
| `astral`, 754 m | -6 .. -5, the same all year | -6 .. -4, the same all year |
| `astral`, 0 m | -3 .. -2 | 0 .. -1 (270 of 336 equal) |
  hdate's own model uses NOAA's low-accuracy equations (sunset at 90.833 degrees, havdalah
  at 98.5, truncated to the minute); its seasonal error disappears with `astral`, and the
  remaining steady gap is the altitude. So hebcal is the more accurate of the two. Between
  Israeli cities (hdate's model) the windows differ by up to 9 minutes (Eilat), Jerusalem by
  0-3 minutes before hebcal's 40-minute custom.
- **Decision** (owner): drop hdate and the built-in table. The settings page loads hebcal
  (`@hebcal/core` 6.14.6 and `@hebcal/cities` 6.2.2, pinned with integrity hashes) from
  jsDelivr / unpkg only when the user sets a location, computes 5 years with hebcal's
  defaults (candle lighting 18 minutes before sunset, 40 in Jerusalem, 30 in Haifa and
  Zikhron Ya'akov; havdalah at 8.5 degrees; no elevation; two-day Yom Tov abroad) and stores
  them in the never-started script `shabbat_dates` (`src/tablegen.js`). Petah Tikva's times
  move by up to 6 minutes compared with the old table (candle lighting up to 6 minutes
  earlier, havdalah up to 3 minutes earlier or later). Tests compare against tables generated
  with the same code (`tools/gen_ref.mjs`), not against hdate any more.
- **Sizes** (`tools/gen_ref.mjs`, 2025-2030): Petah Tikva 336 windows, 3,363 bytes; New York
  331 windows, 3,324 bytes; Sydney 331, 3,342 bytes - one 4 KB `GetCode` read each. The 5
  years the page writes are ~2.9 KB.
- **On hardware**: see the next entry.

## 2026-11-07 - The location table on the Pro 1: memory and reload
- **Question**: can the controller read `shabbat_dates` itself (`Script.GetCode` through
  `Shelly.call`), within its memory, at boot and on reload while running?
- **Method**: Pro 1, fw 2.0.3, through the tunnel, during a Shabbat window (test device).
  Installed the build with `tools/deploy.py`; created `shabbat_dates` with `Script.Create`
  and wrote 5 years for Petah Tikva (2,915 bytes, computed with `src/tablegen.js` as the page
  does); `ShabbatSet {reload}` five times; `Script.GetStatus` after each step; test time
  16:50 on the havdalah timer, then cleared.
- **Result** (`mem_used` / `mem_peak`, bytes; pool 25,200):
| Build | No table | Table read at boot | `reload` while running |
|---|---|---|---|
| v0.3.0-beta.1 (table in the code) | 16,198 / 22,792 | - | - |
| read whole (a1063dc) | 12,180 / 15,064 | 16,604 / 24,640 | out of memory, script stopped |
| header, then the windows line alone | - | 16,870 / 20,230 | 16,982 / 20,230 (5 times, ~3 s each) |
  `GetCode` works from the script. Current and next window, the havdalah timer and the relay
  (test time) were right. An 8-window `ShabbatPreview` raised the peak to 23,618, as forecasts
  did before.
- **Decision**: read the header in 1 KB pieces, then the windows line at its offset so the
  reply's string is the table; drop the old table before a reload and skip ticks meanwhile
  (the relay is left as it is for the ~1 s read). `test/sim.js` checks the read sizes.

## 2026-11-14 - Far north: no havdalah in summer
- **Question**: what does the table hold where the sun does not get 8.5 degrees below the
  horizon in summer (above ~58 degrees north)?
- **Method**: `sdWindows` in Node with the pinned hebcal, 2027, by coordinates. Not on
  hardware (the table is computed in the browser).
- **Result**: hebcal gives no Havdalah event for those weeks, and the window stayed open
  until the next one: Stockholm one window of 43 days from 4 June, Helsinki 50 days, Tromso
  129 days. Clock timers "every day" would have fired daily for weeks, and the schedule
  service refuses windows over 4 days. With `havdalahMins: 72` Stockholm, Helsinki and
  Reykjavik have a window every week (the longest ~74 hours, a three-day Yom Tov); Tromso
  has no sunset either, so weeks have no window at all.
- **Decision**: `sdBuild` checks the windows (`sdSane`: none longer than 4 days, none more
  than a week after the last one ended). If they fail, the whole table is computed with
  havdalah 72 minutes after sunset (`SD_HM`, `"hm":72` in the `//L` line, and the page says
  so when saving); if that fails too, the place is refused. `tools/gen_ref.mjs` checks
  Stockholm, Glasgow (by degrees) and Tromso (refused).
