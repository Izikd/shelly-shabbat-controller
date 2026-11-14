# Switch, time and KVS

Learned on a **Shelly Pro 1, firmware 2.0.3** (Nov 2026) unless noted. Each note says how it
is known: *doc* (Shelly API docs), *measured* (see `../experiments/`), *observed* (happened on
the device) or *design* (a rule we chose). Recheck on new firmware or other models.

- `Switch.Set` takes `tag` (origin of a change) and `toggle_after` (firmware auto-off); the
  controller uses both, so the relay drops at the end of an interval even if the script stops.
- `Switch.GetStatus.source` is `"timer"` for the firmware auto-off, `"init"` right after boot.
- The device has no time until SNTP syncs after power-up; the controller keeps the relay off
  until then.
- KVS values are limited (~253 chars per value in practice); the timer config and the 15-entry
  log are sized to fit (`test/sim.js` checks). Repeats (`r`, ~12 characters each) share the
  timers' value: 12 plain timers or 4 timers with 3 repeats fit; 12 repeating timers do not,
  and `ShabbatSet` answers "too many timers".
- Every `KVS.Set` is a write to the device's flash. The relay log is therefore saved at most
  once in 30 minutes (`CFG.logTicks`; the first change after a quiet half hour at once, later
  ones by the tick that ends it): a timer repeating every 5 minutes switches ~580 times a
  day and saved the log each time. `ShabbatGet` serves the log from memory; a restart loses
  at most its last 30 minutes (*design*; `test/sim.js` counts the saves).
- The page keeps its beta-channel choice in KVS key `shabbat_upd_beta`, written by the
  browser with `KVS.Set` (no script memory). It reads it with `KVS.GetMany {match}`, not
  `KVS.Get`, because `KVS.Get` of a missing key is an RPC error (HTTP 500, which the browser
  logs as an error on every load): `KVS.Get` of a missing key answers HTTP 500
  `{code: -105, message: "Argument 'key', value '...' not found!"}` (*observed*, fw 2.0.3).
  `KVS.GetMany {match}` answers a list, `{items: [{key, etag, value}], offset, total}`, and
  `{items: [], ...}` for no match (*observed*; the docs also show `items` as an object, so the
  page accepts both). Oddly `total` was 1 for an empty match too (*observed*). The mock
  answers the list form.
- KVS limits: keys up to 42 characters, values up to 253, at most 50 keys (*doc*).
- `Sys.GetStatus`: `ram_size`, `ram_free`, `ram_min_free` (lowest since boot, reset only by a
  reboot), `fs_size`, `fs_free`, `uptime`, `reset_reason` (4 seen after a crash).
