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
- **More than about 8 timers ran the controller out of memory** (*observed*, 2026-11-14,
  fw 2.0.3, main 4eecb84): saving 12 clock timers stopped the script with
  `errors: ["out_of_memory"]`, and because they were saved it stopped again at every start.
  Boot peak with N clock timers (each on every day: 3 blocks per window): 4 -> 21,616,
  6 -> 22,848, 8 -> 24,066, 10 and 12 out of memory, ~610 bytes a timer; 12 anchored timers
  booted at 24,542 but their forecast ran out. The cause was the list of blocks (an array per
  timer per day, ~110 bytes each). Fixed (*measured*, same day): the blocks are walked one at
  a time into globals (`nextBlk`), and 12 clock timers boot at 22,386-22,512, ~200 bytes a
  timer (the timers themselves, ~116 bytes each, stay in memory).
- **The engine frees nothing within one computation that it can still reach later, and a
  value made per step adds up** (*observed*, 2026-11-14): a label string made for every block
  on every pass of `segAt` (up to 100 passes) ran 8 timers with repeats out of memory at the
  first tick, so the stretch's timers are bits (`sM`) and the text is made once
  (`maskLabel`).
- **A string that is appended to is copied whole each time** (*observed*, 2026-11-14): the
  publish body (~1.8 KB) built by appending every field ran the script out of memory with 6
  repeating timers; it is built a window at a time now (each window's part on its own, added
  once), and the publish stops adding windows when free memory is short.
- **Serving the page loader cost ~1.6 KB at the peak** (*measured*, 2026-11-14): assembling
  the page per request with the two script ids took the peak from 20,958 to 22,540. The
  loader is one fixed string now (`UI_PAGE`): it reads its own id from its address and the
  page script's id from `ShabbatGet` (`ui`), and a page load does not raise the peak.
- **The boot copy of the settings was kept** (*measured*): after a save, the old timers
  stayed in memory too (+1,360 bytes with 12); `bootLoaded` is released after boot.
- **The script sees its own free memory**: `Shelly.getComponentStatus("script", id).mem_free`
  (*observed*: ~4,800 with 12 timers after boot; `mem_used` + `mem_free` came to ~24.4 KB, so
  the room is less than the 25,200 a stopped script shows). The forecast uses it: it stops
  adding windows unless 3 times the cost of the windows so far plus 800 bytes are free
  (`pvRoom`), and says `more`. A forecast window costs ~340 bytes with 12 clock timers,
  ~650 with 4 plain ones and ~1,900 with 6 repeating ones; 3 of the last ran out of memory on
  main and on this build without the guard. The page keeps asking while `more`.
- **Page use with 12 timers peaks at ~24.2 KB** (*measured*, 2026-11-14): load, the Timers
  tab's forecast (6 requests of 1 window, each carrying the 12 draft timers), an edit and a
  save peaked at 24,220, about what main reached with 4 timers (24,164 on 2026-11-08). The
  draft timers in each forecast request are ~1.4 KB of it. Little room is left: keep new
  work off these paths, or measure it.
