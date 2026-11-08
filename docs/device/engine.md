# Script engine

Learned on a **Shelly Pro 1, firmware 2.0.3** (Nov 2026) unless noted. Each note says how it
is known: *doc* (Shelly API docs), *measured* (see `../experiments/`), *observed* (happened on
the device) or *design* (a rule we chose). Recheck on new firmware or other models.

- **Minimum firmware 2.0.0** for `Script.addRpcHandler` (*doc*: changelog 2.0.0). The page and
  `Script.Shabbat*` API depend on it.
- **Small JS stack.** Deeper call chains or nested expressions crash the script or the
  device. The controller keeps call depth <= 5 (`test/sim.js` measures it) and starts work
  from timer callbacks (*observed* during the first version).
- **Call depth alone does not measure the stack** (*observed*, 2026-11-08, fw 2.0.3): the
  first repeating-timers build (138e6a5) stopped with "Uncaught Error: Too much recursion -
  the stack is about to overflow" in `tickFromTimer > tick > segAt > repScan > localToUtc`,
  depth 5 like paths that work: `repScan` had ~15 locals and nested `for` / `let` blocks.
  A later build overflowed in `pubSend > pubBody > onTimes > segAt > pulseAt`. Big frames
  count too: keep functions on deep paths small, with few locals. `test/sim.js` weighs each
  path (variables + 15 per frame, at most 104: the crashed paths weighed 118 and 106, paths
  that work up to 104).
- **Nested groups in a condition rebooted the whole device** (*observed*, 2026-11-08, fw
  2.0.3): `if (v[0] === 1 && ((v[4] === 1 && d - d0 > 1) || (v[4] === 2 && d !== d1)))` in a
  function called from `tick` took the device down (`reset_reason` 4, no script error) on the
  first tick, every start; written as two flat `if`s it ran. `test/sim.js` allows at most 2
  levels of parentheses in an `if` / `while` condition.
- **A ternary with a sum or a call in a branch is a syntax error** (*observed*, 2026-11-08, fw
  2.0.3): `s = k[2] ? k[0] + Math.floor((y - k[0]) / k[2]) * k[2] : k[0]` gave "Uncaught
  SyntaxError: Got ']' expected ':'". The engine parses a function when it is first called, so
  the script started and stopped at the first tick. Use ternaries only between plain values;
  write the rest as `if`s.
- **The device's log** (the script's `console.log` lines and the firmware's) streams on the
  websocket `/debug/log` when `debug.websocket.enable` is on (`Sys.GetConfig`; it was on on the
  test device). With `diag: true` it shows the boot step a crash happens in (*observed*).
- **RPC handlers have even less stack**: they only queue the call; a timer callback does the
  work and answers (*observed*).
- **No `Array.prototype.sort`** (*observed*); the simulator deletes it to catch use.
- **No `\u` escapes in string literals**; UTF-8 text works (*doc*: Language Reference).
- **`@meta` virtual-component declarations crashed the device** (*observed*); not used.
- **Limits per script**: 5 timers, 5 event / status subscriptions, 5 concurrent `Shelly.call`s,
  5 HTTP endpoints, 5 RPC handlers (*doc*).
- **Up to 3 scripts run at once**; the JS memory pool (~25 KB on the Pro 1) is shared by the
  running scripts: `mem_free` in `Script.GetStatus` is the pool's free part (*doc*, *measured*).
- **`Script.Eval` reads and sets globals of a running script** (*observed*): `CFG.debug=true`
  switches the controller's debug log on without a restart or a special build; it lasts until
  the script restarts. This replaced a separate "diag" build (Nov 2026). For a crash during
  boot, set `diag: true` in `src/main.js` (1 s between boot steps, memory logged after each)
  and deploy a local build.
- **A script that crashes the device is disabled at the next boot** (*doc*). Nothing in this
  project restarts it yet; watch for it after risky changes.
