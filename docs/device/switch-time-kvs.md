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
  log are sized to fit (`test/sim.js` checks).
- `Sys.GetStatus`: `ram_size`, `ram_free`, `ram_min_free` (lowest since boot, reset only by a
  reboot), `fs_size`, `fs_free`, `uptime`, `reset_reason` (4 seen after a crash).
