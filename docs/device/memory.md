# Memory

Learned on a **Shelly Pro 1, firmware 2.0.3** (Nov 2026) unless noted. Each note says how it
is known: *doc* (Shelly API docs), *measured* (see `../experiments/`), *observed* (happened on
the device) or *design* (a rule we chose). Recheck on new firmware or other models.

- The controller uses ~14-17 KB, peaking at ~20-24 KB of the ~25 KB pool depending on activity
  (page loads and forecasts raise the peak) (*measured*; 17.0 KB with a 5-year table loaded,
  2026-11-07). With the controller stopped, `mem_free` shows the whole pool: 25,200 bytes.
- **Strings held in globals cost their full size for the whole uptime**; a string assembled
  from parts and kept is a second copy (*measured*: keeping the assembled loader HTML cost
  ~1.4 KB). Assemble per request.
- Shrinking the controller's code by minification (15.7 -> 14.4 KB) barely changed
  `mem_used` (*measured*), so the engine does not keep all source text resident; strings and
  live objects are what count. But new functions do cost: the first repeating-timers build
  added 2.5 KB of code (17,642 -> 20,110 bytes, 7 functions) and `mem_used` after boot went
  from 16,898 to 17,906; the reworked one (19,855 bytes) boots at 17,850 (*measured*,
  2026-11-08).
- **A 5-window forecast with repeats ran out of memory** (*observed*, 2026-11-08, fw 2.0.3,
  build 138e6a5): `ShabbatPreview` with draft timers and repeats peaked at 24,430 bytes for 4
  windows, and 5 or 6 windows (the page asks for 6) stopped the script with
  `errors: ["out_of_memory"]`; without repeats 6 windows peaked at 23,436. The reply's objects
  (one per window, with its `on` and `rp` arrays) and the draft in the request are all held
  at once. The reworked build peaks at 23,926 for 3 windows with repeats and 24,850 for 4; 5
  still run out. So the page asks for the forecast 3 windows at a time
  (`../experiments/page-size-and-load.md`).
- **Reading a ~3 KB script whole and parsing it ran out of memory** (*observed*, 2026-11-07):
  `Script.GetCode` of the 2.9 KB `shabbat_dates` in one piece, kept as one string, then sliced
  into fields, took the boot peak from 15.1 to 24.6 KB; the same read on `ShabbatSet {reload}`,
  with the old table still held, stopped the script with `errors: ["out_of_memory"]`. A reply's
  data counts about twice (the reply and its string), and every `+=` or `slice` of it is
  another copy. Reading the header first (1 KB) and then the windows line alone, at its
  offset, keeping the reply's string as the table, peaks at 20.2 KB at boot and does not raise
  the peak on reload (`../experiments/table-generation.md`). The simulator cannot measure
  memory; it checks the read sizes instead.
- **More than about 8 timers run the controller out of memory** (*observed*, 2026-11-14,
  fw 2.0.3, on main 4eecb84 and on the review-fixes build alike): saving 12 clock timers
  stopped the script with `errors: ["out_of_memory"]`, and because they were already saved
  it stopped again at every start. Boot peak with N clock timers (each on every day: 3 blocks
  per window): 4 -> 21,616, 6 -> 22,848, 8 -> 24,066, 10 and 12 out of memory, about 610
  bytes a timer. Timers anchored to candle lighting or havdalah (1 block a window): 8 boot at
  22,974, 12 at 24,542, but a 3-window forecast with 12 runs out. The page allows 12, so a
  user can stop the controller by adding timers (`../experiments/page-size-and-load.md`).
- **Serving the page loader costs ~1.6 KB at the peak** (*measured*, 2026-11-14): the
  first `/script/<id>/ui` request after a start took the peak from 20,958 to 22,540 (the
  page is 3,223 bytes); later requests, even 3 at once, did not raise it further. With the
  page's first status request and forecast, a page load peaked at ~24 KB, close to the pool.
  One page load with a fresh skip (so a publish followed) ran out of memory once and could
  not be repeated.
