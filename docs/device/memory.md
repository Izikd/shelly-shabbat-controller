# Memory

Learned on a **Shelly Pro 1, firmware 2.0.3** (Nov 2026) unless noted. Each note says how it
is known: *doc* (Shelly API docs), *measured* (see `../experiments/`), *observed* (happened on
the device) or *design* (a rule we chose). Recheck on new firmware or other models.

- The controller uses ~14 KB, peaking at ~16-21 KB of the ~25 KB pool depending on activity
  (page loads and forecasts raise the peak) (*measured*).
- **Strings held in globals cost their full size for the whole uptime**; a string assembled
  from parts and kept is a second copy (*measured*: keeping the assembled loader HTML cost
  ~1.4 KB). Assemble per request.
- Shrinking the controller's code by minification (15.7 -> 14.4 KB) barely changed
  `mem_used` (*measured*), so the engine does not keep all source text resident; strings and
  live objects are what count.
