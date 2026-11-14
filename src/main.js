// SPDX-License-Identifier: MIT
// =============================================================================
// Shabbat controller for Shelly (Gen2+ with a relay, firmware 2.0+; developed on a Pro 1)
//
// Turns switch:0 on during configured timers inside Shabbat & Yom Tov windows
// (Shabbat + Yom Tov). Windows come from the never-started script "shabbat_dates", which the
// settings page computes with hebcal for the chosen place and writes (src/tablegen.js). The
// controller reads it at boot and on ShabbatSet {reload}; it needs no internet. Without it
// there are no windows and the relay stays off.
//
// Settings UI:  http://<ip>/script/<this id>/ui
//   The page is a tiny loader; the UI code itself is stored as the code of a
//   second, never-started script named "shabbat_ui" and read by the browser
//   via the firmware's Script.GetCode (costs this script no memory).
//
// RPC API (Script.<name>, routed by "id" = this script's id):
//   ShabbatGet                 -> {cfg, st}
//   ShabbatSet {timers?, reps?, auto?, skip?, test?, reload?}  -> {cfg, st}   (validated,
//     saved; reload: read shabbat_dates again, answered once it is read)
//   ShabbatPreview {timers?, reps?, n?}
//     -> {w: [{t, k, s, e, skip, on: [[s, e, "1+3"]], rp: [[s, e, "2", every, dur]]}]}
//   ShabbatPub {u?, i?, k?, off?, send?} -> {on, u, i, k, ok, err, due, busy}
//     publishing to the schedule service (service/): set it up / stop / send now / state
//
// Timer: [anchor, value, duration, applies, days, enabled]
//   anchor   0 = candle lighting (value = minutes after window start, 0..180)
//            1 = clock time      (value = minutes of local day, 0..1439)
//            2 = havdalah        (value = minutes before window end, -180..0)
//   duration 0..240 min
//   applies  0 = Shabbat & Yom Tov, 1 = Shabbat only, 2 = Yom Tov only
//   days     (clock timers) 0 = every day, 1 = first day, 2 = last day
//   enabled  0/1
// Repeat (reps[i], for timer i; 0 = none): [every, length, enabled]
//   the timer turns on for its duration every `every` minutes (5..720, more than the
//   duration), from its start for `length` minutes (1..1440). The timer itself is stored
//   disabled, so older releases, which do not know repeats, leave it off; `enabled` is here.
// Everything is clipped to the window.
// =============================================================================

let CFG = {
  switchId: 0,
  tickMs: 15000,
  failState: false, // relay state when the clock is not synced
  kvsKey: "shabbat_elev_cfg", // KVS key names kept from the first version: renaming
  // them would drop the saved timers and log
  logKey: "shabbat_elev_log",
  logMax: 15,
  logTicks: 120, // ticks (30 min) between saves of the log: flash wear, see saveLog
  pubKey: "shabbat_pub", // publishing settings {u, i, k} (absent = not published)
  pubN: 6, // windows sent to the schedule service
  tag: "shabbat", // Switch.Set tag: tells our commands from manual ones
  maxTimers: 12,
  debug: false,
  diag: false // staged boot (1 s per step) + memory logs: set true in a local build to debug
  // a crash during boot. CFG.debug can be switched at runtime instead (docs/device/engine.md).
};

let DEFAULT_TIMERS = [
  [0, 15, 30, 0, 0, 1],
  [1, 720, 60, 0, 0, 1],
  [2, -40, 40, 0, 0, 1]
];

// ---------------- Window table (from the shabbat_dates script) ----------------
// Window: 8 characters - start in minutes since TBL_BASE (4 base-64 digits), length in minutes
// (3), title index (1); see src/tablegen.js. Empty until read: no windows, relay off.
let TBL_BASE = 1735689600; // 2025-01-01 UTC; also the base of the event log's times
let TBL = "";
let TBL_T = [];
let TBL_N = 0;
let TBL_STD = 7200; // standard UTC offset of the place (s)
let TBL_DST = []; // DST periods [start, end, ...] (UTC s)
let TBL_TO = 0; // end of the DST data; outside it the device's utc_offset is used
let TBL_TZ = ""; // time zone name, for the page
let TBL_NAME = ""; // place name, for the page
let datesId = -1; // id of the shabbat_dates script

// ---------------- Globals ----------------
let ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";

let cfg = null; // {t: timers, a: auto 0/1, s: skipped window start (0 = none), r: repeats}
let testTime = 0; // test clock (UTC s), RAM only
let saving = false,
  saveDirty = false;
let lastWanted = null;
let lastWindowIdx = -2;
let status = {}; // last computed status (served by ShabbatGet)
let manualHold = null; // desired state when a manual switch was detected (null = none)
let lastOut = null; // last known relay output
let lastUntil = 0; // end of the ON interval the firmware auto-off timer was set for
let logArr = []; // relay events: "<minutes since TBL_BASE><1|0><cause>"
let logSaving = false,
  logDirty = false;

function dbg(a, b) {
  if (CFG.debug) console.log("[dbg]", a, b === undefined ? "" : b);
}

// ---------------- Local time ----------------
// Kept flat on purpose: the Shelly JS engine has a small stack, and every
// nested call / nested parenthesis costs stack.
// DST periods come from the table (TBL_DST = [start, end, ...] in UTC seconds, from the
// browser's time zone data). Outside the table: device utc_offset.
let sysOffset = 7200;
function tzOffset(t) {
  if (t < TBL_BASE || t >= TBL_TO) return sysOffset;
  for (let i = 0; i < TBL_DST.length; i += 2) {
    if (t >= TBL_DST[i] && t < TBL_DST[i + 1]) return TBL_STD + 3600;
  }
  return TBL_STD;
}

// local wall-clock seconds -> UTC seconds (inlined offset lookup: no nested calls)
function localToUtc(localSecs) {
  let u = localSecs - TBL_STD;
  if (u < TBL_BASE || u >= TBL_TO) return localSecs - sysOffset;
  for (let i = 0; i < TBL_DST.length; i += 2) {
    if (u - 3600 >= TBL_DST[i] && u - 3600 < TBL_DST[i + 1]) return u - 3600;
  }
  return u;
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function fmtTime(t) {
  let l = t + tzOffset(t);
  let mins = Math.floor((l % 86400) / 60);
  return pad2(Math.floor(mins / 60)) + ":" + pad2(mins % 60);
}

// ---------------- Window table ----------------
function dec(pos, width) {
  let n = 0;
  for (let i = 0; i < width; i++) n = n * 64 + ALPHA.indexOf(TBL.charAt(pos + i));
  return n;
}

// kind: 1 = Shabbat, 2 = Yom Tov, 3 = both
function getWin(i) {
  if (i < 0 || i >= TBL_N) return null;
  let p = i * 8;
  let s = TBL_BASE + dec(p, 4) * 60;
  let title = TBL_T[ALPHA.indexOf(TBL.charAt(p + 7))];
  let k = 2;
  if (title === "Shabbat") k = 1;
  else if (title.indexOf("Shabbat") >= 0) k = 3;
  return { i: i, s: s, e: s + dec(p + 4, 3) * 60, title: title, k: k };
}

// Index of first window whose end is after t (TBL_N if none)
function findWin(t) {
  let lo = 0,
    hi = TBL_N;
  while (lo < hi) {
    let mid = (lo + hi) >> 1;
    let w = getWin(mid);
    if (w.e <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------------- Timer intervals ----------------
// Each start of an enabled timer in window w is a block [a, b, P, D, label]: from a to b,
// on for D s every P s (P = 0: once, a timer that does not repeat; l = the 1-based timer
// number). The relay's ON times are worked out from the blocks on the fly, never listed:
// a repeat can have ~300 pulses a window (script memory). Kept small and flat: on the device
// a deep path with large functions overflowed the stack (docs/device/engine.md).
// Results in globals, so that no object is made per pulse.
let pS = 0,
  pE = 0; // pulseAt: the pulse (pE = 0: none)
let sS = 0,
  sE = 0,
  sL = ""; // segAt / take: the ON stretch (sE = 0: none)

// The blocks of window w for timers tl and repeats rl
function blocks(w, tl, rl) {
  let out = [];
  let d0 = Math.floor((w.s + tzOffset(w.s)) / 86400);
  let d1 = Math.floor((w.e + tzOffset(w.e)) / 86400);
  for (let i = 0; i < tl.length; i++) {
    let v = tl[i];
    // [enabled, length (min), period (min)]; no ternaries with sums or calls in them: the
    // device's parser rejected one (docs/device/engine.md)
    // flat conditions only: nested ones crashed the device (docs/device/engine.md)
    let r = [v[5], v[2], 0];
    if (rl.length > i && rl[i]) r = [rl[i][2], rl[i][1], rl[i][0]];
    if (!r[0]) continue;
    if (v[2] <= 0) continue;
    if (v[3] === 1 && w.k === 2) continue;
    if (v[3] === 2 && w.k === 1) continue;
    let lo = d1;
    if (v[0] === 1) lo = d0 - 1;
    for (let d = lo; d <= d1; d++) {
      if (v[0] === 1 && v[4] === 1 && d - d0 > 1) continue;
      if (v[0] === 1 && v[4] === 2 && d !== d1) continue;
      let a = w.s + v[1] * 60;
      if (v[0] === 2) a = w.e + v[1] * 60;
      if (v[0] === 1) a = localToUtc(d * 86400 + v[1] * 60);
      out.push([a, a + r[1] * 60, r[2] * 60, v[2] * 60, "" + (i + 1)]);
    }
  }
  return out;
}

// The pulse of block k, clipped to window w, that contains x or starts after it: pS..pE
function pulseAt(w, k, x) {
  pE = 0;
  let b = k[1];
  if (b > w.e) b = w.e;
  let y = x;
  if (y < k[0]) y = k[0];
  if (y < w.s) y = w.s;
  if (y >= b) return;
  let s = k[0];
  let q = 0;
  if (k[2]) q = Math.floor((y - k[0]) / k[2]);
  s += q * k[2];
  if (s + k[3] <= y) s += k[2];
  if (!k[2] && s + k[3] <= y) return;
  if (s >= b) return;
  pE = s + k[3];
  if (pE > b) pE = b;
  pS = s;
  if (pS < w.s) pS = w.s;
}

// Adds a candidate interval (e > x) to the stretch sS..sE: one that contains x wins over
// one that starts later; two that contain x, or start together, are merged
function take(s, e, l, x) {
  let a = s <= x;
  let b = sS <= x;
  let take1 = !sE;
  if (a && !b) take1 = true;
  if (!a && !b && s < sS) take1 = true;
  if (take1) {
    sS = s;
    sE = e;
    sL = l;
    return;
  }
  if (a !== b) return;
  if (!a && s > sS) return;
  if (s < sS) sS = s;
  if (e > sE) sE = e;
  if (("+" + sL + "+").indexOf("+" + l + "+") < 0) sL += "+" + l;
}

// The ON stretch of window w (blocks bl) that contains x, else the next one: sS..sE, labels
// sL (sE = 0: none), followed through every pulse that touches or overlaps its end
function segAt(w, bl, x) {
  sE = 0;
  for (let i = 0; i < bl.length; i++) {
    pulseAt(w, bl[i], x);
    if (pE) take(pS, pE, bl[i][4], x);
  }
  for (let n = 0; n < 100 && sE; n++) {
    let e = sE;
    for (let i = 0; i < bl.length; i++) {
      pulseAt(w, bl[i], e);
      if (pE) take(pS, pE, bl[i][4], e);
    }
    if (sE === e) return;
  }
}

// The merged ON times of the blocks that do not repeat, sorted, into out: [s, e, "1+3"]
// (the forecast and the public page: one pass, no call per block; segAt would cost ~3 times
// the calls, and the device is slow)
function onceTimes(w, bl, out) {
  for (let i = 0; i < bl.length; i++) {
    let s = bl[i][0];
    let e = bl[i][1];
    if (s < w.s) s = w.s;
    if (e > w.e) e = w.e;
    if (bl[i][2] || e <= s) continue;
    // sorted insert by start (Array.sort is not available on Shelly)
    let j = out.length;
    out.push(null);
    while (j > 0 && out[j - 1][0] > s) {
      out[j] = out[j - 1];
      j--;
    }
    out[j] = [s, e, bl[i][4]];
  }
  let n = 0;
  for (let i = 0; i < out.length; i++) {
    let x = out[i];
    let last = null;
    if (n) last = out[n - 1];
    if (last && x[0] <= last[1]) {
      if (x[1] > last[1]) last[1] = x[1];
      if (("+" + last[2] + "+").indexOf("+" + x[2] + "+") < 0) last[2] += "+" + x[2];
      continue;
    }
    out[n] = x;
    n++;
  }
  while (out.length > n) out.pop();
}

// A repeat in short (the forecast, the public page): its first pulse's start in pS and its
// last pulse's end in pE (pE = 0: no pulse in the window)
function span(w, k) {
  let b = k[1];
  if (b > w.e) b = w.e;
  let q = Math.floor((b - 1 - k[0]) / k[2]);
  pulseAt(w, k, k[0] + q * k[2]);
  let e = pE;
  pulseAt(w, k, k[0]);
  pE = e;
}

// ---------------- Config ----------------
function validTimer(v) {
  if (!v || v.length !== 6) return false;
  for (let i = 0; i < 6; i++)
    if (typeof v[i] !== "number" || v[i] !== Math.floor(v[i])) return false;
  if (
    v[0] < 0 ||
    v[0] > 2 ||
    v[2] < 0 ||
    v[2] > 240 ||
    v[3] < 0 ||
    v[3] > 2 ||
    v[4] < 0 ||
    v[4] > 2
  )
    return false;
  if (v[0] === 0 && (v[1] < 0 || v[1] > 180)) return false;
  if (v[0] === 1 && (v[1] < 0 || v[1] > 1439)) return false;
  if (v[0] === 2 && (v[1] < -180 || v[1] > 0)) return false;
  return v[5] === 0 || v[5] === 1;
}

function validTimers(tl) {
  if (!tl || typeof tl.length !== "number" || tl.length > CFG.maxTimers) return false;
  for (let i = 0; i < tl.length; i++) if (!validTimer(tl[i])) return false;
  return true;
}

// a repeat for timer v: 0, or [every, length, enabled]; the timer itself is stored disabled
function validRep(p, v) {
  if (p === 0) return true;
  if (!p || p.length !== 3) return false;
  for (let i = 0; i < 3; i++)
    if (typeof p[i] !== "number" || p[i] !== Math.floor(p[i])) return false;
  if (p[0] < 5 || p[0] > 720 || p[1] < 1 || p[1] > 1440) return false;
  if (v[5] !== 0 || v[2] < 1 || v[2] >= p[0]) return false;
  return p[2] === 0 || p[2] === 1;
}

// none ([]), or one per timer
function validReps(rl, tl) {
  if (!rl || typeof rl.length !== "number") return false;
  if (rl.length && rl.length !== tl.length) return false;
  for (let i = 0; i < rl.length; i++) if (!validRep(rl[i], tl[i])) return false;
  return true;
}

// the saved settings; r only when there are repeats (KVS values are short)
function cfgJson() {
  let o = { t: cfg.t, a: cfg.a, s: cfg.s };
  if (cfg.r.length) o.r = cfg.r;
  return JSON.stringify(o);
}

function onKvsSaved(res, err, msg) {
  saving = false;
  if (err) console.log("KVS save failed:", err, msg);
  if (saveDirty) saveCfg();
}

function saveCfg() {
  if (saving) {
    saveDirty = true;
    return;
  }
  saving = true;
  saveDirty = false;
  Shelly.call("KVS.Set", { key: CFG.kvsKey, value: cfgJson() }, onKvsSaved);
}

// ---------------- Main loop ----------------
// Ticks always start from a fresh timer callback (small JS stack on the device)
let tickQueued = false;
let replyQ = []; // Set requests answered after the next tick (fresh status)
function tickFromTimer() {
  tickQueued = false;
  tick();
  let q = replyQ;
  replyQ = [];
  for (let i = 0; i < q.length; i++) q[i].result(snapshot());
}
function kickTick() {
  if (tickQueued) return;
  tickQueued = true;
  Timer.set(50, false, tickFromTimer);
}

function getNow() {
  let sys = Shelly.getComponentStatus("sys");
  if (sys && typeof sys.utc_offset === "number") sysOffset = sys.utc_offset;
  if (testTime) return testTime;
  if (!sys || !sys.unixtime) return 0;
  return Math.floor(sys.unixtime);
}

// A Switch.Set on its way: ticks leave the relay alone until it is answered (the output
// read meanwhile is the old one, and a difference would be taken for a manual switch)
let swBusy = false;
let swOn = false; // the state it asked for
let swLog = ""; // its cause for the log ("" = the output does not change: nothing to log)
function onSwitchSet(res, err, msg) {
  swBusy = false;
  if (err) {
    // not switched: forget what we know, so the next tick tries again (and does not take
    // the unchanged output for a manual switch)
    console.log("Switch.Set failed:", err, msg);
    lastWanted = null;
    lastOut = null;
    lastUntil = 0;
    return;
  }
  lastOut = swOn;
  if (swLog) addLog(swOn, swLog);
}

// ---- event log (KVS, survives reboot) ----
function onLogSaved(res, err) {
  logSaving = false;
  if (logDirty) saveLog();
}
// Saved at once when nothing was saved in the last 30 minutes, otherwise by the tick that
// ends them: a timer that repeats every 5 minutes switches ~580 times a day, and every save
// is a write to the device's flash. ShabbatGet serves the log from memory, so the page
// misses nothing; a restart loses at most the last 30 minutes of it.
let logHold = 0; // ticks until the next save is allowed
function saveLog() {
  if (logSaving || logHold > 0) {
    logDirty = true;
    return;
  }
  logSaving = true;
  logDirty = false;
  logHold = CFG.logTicks;
  let str = "";
  for (let i = 0; i < logArr.length; i++) str += (i ? "," : "") + logArr[i];
  Shelly.call("KVS.Set", { key: CFG.logKey, value: str }, onLogSaved);
}
// cause: a = automatic, m = manual, t = firmware auto-off, f = fail-safe, x = test time
function addLog(on, cause) {
  let sys = Shelly.getComponentStatus("sys");
  let ts = sys && sys.unixtime ? Math.floor((sys.unixtime - TBL_BASE) / 60) : 0;
  logArr.push("" + ts + (on ? "1" : "0") + cause);
  if (logArr.length > CFG.logMax) logArr = logArr.slice(logArr.length - CFG.logMax);
  saveLog();
}

// on: wanted state; until: end of the current ON interval (UTC s) or 0; cause: log cause
function applyRelay(on, until, cause) {
  let st = Shelly.getComponentStatus("switch", CFG.switchId);
  if (!st || swBusy) return;
  // changes we did not command: manual (app, button, web) or the firmware auto-off
  if (lastOut !== null && st.output !== lastOut) {
    let byTimer = st.source === "timer";
    addLog(st.output, byTimer ? "t" : "m");
    if (!byTimer && st.output !== on && manualHold === null) {
      manualHold = on;
      console.log("Manual switch detected - holding until the next timer event");
    }
  }
  lastOut = st.output;
  // manual hold lasts until our wanted state changes (next timer event)
  if (manualHold !== null) {
    if (on === manualHold) return;
    manualHold = null;
  }
  let p = { id: CFG.switchId, on: on, tag: CFG.tag };
  // firmware auto-off: the relay drops at the end even if this script stops
  let auto = on && until > 0 && !testTime;
  if (auto) p.toggle_after = until - getNow() + 5;
  let needSet = st.output !== on || (auto && until !== lastUntil);
  if (lastWanted !== on) console.log("Relay ->", on ? "ON" : "OFF");
  lastWanted = on;
  lastUntil = auto ? until : 0;
  if (!needSet) return;
  swLog = "";
  if (st.output !== on) swLog = cause;
  swOn = on;
  swBusy = true;
  Shelly.call("Switch.Set", p, onSwitchSet);
}

function winInfo(w) {
  return w ? { t: w.title, k: w.k, s: w.s, e: w.e } : null;
}

function tick() {
  if (!cfg || datesBusy) return; // reading the table: keep the relay as it is
  if (logHold > 0) logHold--;
  if (logDirty && !logHold) saveLog();
  pubCheck();
  let t = getNow();
  let auto = cfg.a !== 0;
  let sw = Shelly.getComponentStatus("switch", CFG.switchId);
  status = {
    now: t,
    test: testTime,
    synced: t > 0,
    auto: auto,
    relay: sw ? sw.output : null,
    on: null,
    cur: null,
    next: null,
    nextOn: null,
    end: TBL_N ? getWin(TBL_N - 1).e : 0,
    loc: TBL_NAME,
    tz: TBL_TZ
  };

  if (!t) {
    if (auto) {
      applyRelay(CFG.failState, 0, "f");
      status.relay = CFG.failState;
    }
    return;
  }

  let idx = findWin(t);
  let w = getWin(idx);
  let cur = w && w.s <= t ? w : null;
  let nxt = cur ? getWin(idx + 1) : w;
  status.cur = winInfo(cur);
  status.next = winInfo(nxt);

  if ((cur ? cur.i : -1) !== lastWindowIdx) {
    lastWindowIdx = cur ? cur.i : -1;
    console.log(
      cur ? "Entered window: " + cur.title : "No Shabbat/Yom Tov window",
      testTime ? "[TEST TIME]" : ""
    );
  }

  // Relay: first interval containing t, else the next one
  let on = null,
    upcoming = null;
  let pw = [cur, nxt, getWin(idx + (cur ? 2 : 1))];
  for (let k = 0; k < 3 && !upcoming && !on; k++) {
    if (!pw[k] || pw[k].s === cfg.s) continue; // skipped window
    segAt(pw[k], blocks(pw[k], cfg.t, cfg.r), t);
    if (!sE) continue;
    if (sS <= t) on = [sS, sE, sL];
    else upcoming = [sS, sE, sL];
  }
  status.on = on;
  status.nextOn = upcoming;

  dbg("tick " + fmtTime(t), !!on);
  if (auto) {
    applyRelay(!!on, on ? on[1] : 0, testTime ? "x" : "a");
    status.relay = manualHold !== null ? lastOut : !!on; // report the state just commanded
  } else lastWanted = null;
  status.manual = manualHold !== null;
}

// ---------------- RPC API ----------------
function snapshot() {
  let lg = "";
  for (let i = 0; i < logArr.length; i++) lg += (i ? "," : "") + logArr[i];
  return {
    cfg: { timers: cfg.t, reps: cfg.r, auto: cfg.a !== 0, skip: cfg.s },
    st: status,
    log: lg,
    base: TBL_BASE,
    did: datesId
  };
}

function doGet(req, params) {
  params = params || {};
  if (!cfg) {
    req.error(-1, "starting");
    return;
  }
  req.result(snapshot());
}

function doSet(req, params) {
  params = params || {};
  if (!cfg) {
    req.error(-1, "starting");
    return;
  }
  // the changes go into a copy: settings that are refused must not stay in use
  let old = cfg;
  let changed = false;
  if (params.timers !== undefined) {
    // new timers replace the repeats too (the repeats belong to the timers by position)
    let rl = params.reps === undefined ? [] : params.reps;
    if (!validTimers(params.timers) || !validReps(rl, params.timers)) {
      req.error(-1, "invalid timers");
      return;
    }
    cfg = { t: old.t, a: old.a, s: old.s, r: old.r };
    cfg.t = params.timers;
    cfg.r = rl;
    changed = true;
  }
  if (params.auto !== undefined) {
    cfg = { t: cfg.t, a: params.auto ? 1 : 0, s: cfg.s, r: cfg.r };
    changed = true;
  }
  if (params.skip !== undefined) {
    // true -> skip the current/next window; false -> no skip
    let w = getWin(findWin(getNow() || TBL_BASE));
    cfg = { t: cfg.t, a: cfg.a, s: params.skip && w ? w.s : 0, r: cfg.r };
    changed = true;
  }
  // the KVS value is short; checked before anything else is changed
  if (changed && cfgJson().length > 250) {
    cfg = old;
    req.error(-1, "too many timers");
    return;
  }
  if (params.resume) {
    manualHold = null;
    lastWanted = null;
    lastOut = null;
  }
  if (params.test !== undefined) {
    let tt = Math.floor(params.test || 0);
    testTime = tt > 0 ? tt : 0;
    lastWanted = null;
  }
  if (changed) {
    saveCfg();
    pubSoon(30);
  }
  if (params.reload) {
    // answered once the table is read (datesDone)
    datesReq.push(req);
    if (!datesBusy) datesLoad();
    return;
  }
  replyQ.push(req);
  kickTick();
}

function doPreview(req, params) {
  params = params || {};
  if (!cfg) {
    req.error(-1, "starting");
    return;
  }
  let tl = cfg.t;
  let rl = cfg.r;
  if (params.timers !== undefined) {
    rl = params.reps === undefined ? [] : params.reps;
    if (!validTimers(params.timers) || !validReps(rl, params.timers)) {
      req.error(-1, "invalid timers");
      return;
    }
    tl = params.timers;
  }
  let n = Math.floor(params.n || 6);
  if (n < 1) n = 1;
  if (n > 8) n = 8;
  let t = getNow() || TBL_BASE;
  let idx = findWin(params.from ? Math.floor(params.from) : t);
  let out = [];
  for (let k = 0; k < n; k++) {
    let w = getWin(idx + k);
    if (!w) break;
    let o = { t: w.title, k: w.k, s: w.s, e: w.e, skip: w.s === cfg.s, on: [], rp: [] };
    let bl = [];
    if (!o.skip) bl = blocks(w, tl, rl);
    onceTimes(w, bl, o.on);
    for (let i = 0; i < bl.length; i++) {
      if (!bl[i][2]) continue;
      span(w, bl[i]);
      if (pE) o.rp.push([pS, pE, bl[i][4], bl[i][2] / 60, bl[i][3] / 60]);
    }
    out.push(o);
  }
  req.result({ w: out, now: t });
}

// The forecast and the public page list a window's ON times as on: the merged ON times of
// the timers that do not repeat [s, e, "1+3"], and rp: each repeat in short [first start,
// last end, "2", every, duration (min)]. doPreview and pubBody loop over the blocks
// themselves: one more frame on these paths overflowed the device's stack
// (docs/device/engine.md).
// RPC handlers are called deep inside the firmware's RPC machinery, where little
// JS stack is left (Preview crashed with "Too much recursion" on the device).
// So handlers only queue the call; the work runs from a fresh timer callback and
// answers the request from there (allowed: the deadline is 30 s).
let rq = [];
function runQueue() {
  let x = rq[0];
  rq = rq.slice(1);
  try {
    x[0](x[1], x[2]);
  } catch (e) {
    x[1].error(-1, "" + e);
  }
  if (rq.length) Timer.set(20, false, runQueue);
}
function enqueue(fn, req, params) {
  if (rq.length >= 4) {
    req.error(-1, "busy");
    return;
  }
  rq.push([fn, req, params || {}]);
  if (rq.length === 1) Timer.set(20, false, runQueue);
}
function onRpcGet(req, params) {
  enqueue(doGet, req, params);
}
function onRpcSet(req, params) {
  enqueue(doSet, req, params);
}
function onRpcPreview(req, params) {
  enqueue(doPreview, req, params);
}
function onRpcPub(req, params) {
  enqueue(doPub, req, params);
}

// ---------------- Publishing (optional) ----------------
// Set up from the settings page, which registers with the schedule service (service/) and
// passes its page id and write key here. The controller then sends the next windows and
// their ON times (pubBody) once a day, a few seconds after every settings change, and after
// a restart. The service shows them on a public read-only page. Nothing is sent without it;
// the relay never depends on it. One HTTP request at a time; the reply is empty (204).
let pub = null; // {u: service URL, i: page id, k: write key}
let pubBusy = false;
let pubDue = 0; // UTC s of the next send (0 = once the clock is synced)
let pubFails = 0;
let pubOk = 0; // UTC s of the last successful send
let pubErr = ""; // why the last send failed

// the device clock, ignoring test time (the public page shows the real schedule)
function realNow() {
  let sys = Shelly.getComponentStatus("sys");
  if (!sys || !sys.unixtime) return 0;
  return Math.floor(sys.unixtime);
}

// printable ASCII of length lo..hi, without quotes, backslashes or spaces
function okStr(s, lo, hi) {
  if (typeof s !== "string" || s.length < lo || s.length > hi) return false;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 33 || c > 126 || c === 34 || c === 92) return false;
  }
  return true;
}

function validPub(p) {
  if (!p || !okStr(p.u, 10, 100) || !okStr(p.i, 4, 32) || !okStr(p.k, 16, 64)) return false;
  return p.u.indexOf("https://") === 0 || p.u.indexOf("http://") === 0;
}

function pubSoon(sec) {
  let t = realNow();
  let d = t ? t + sec : 0;
  if (d < pubDue) pubDue = d;
}

function pubCheck() {
  if (!pub || pubBusy) return;
  let t = realNow();
  if (!t || t < pubDue) return;
  pubBusy = true;
  Timer.set(100, false, pubSend);
}

// The schedule, as the service expects it (see service/src/index.js):
// {v: 1, now, auto, tz, w: [{t, k, s, e, x: skipped 0/1, on: [[s, e], ...]}]} (tz: the place's
// time zone, for the page's times; left out with no table). With repeating timers v is 2 and
// each window also has rp: [[first pulse start, last pulse end, every, duration], ...]
// (minutes), the repeats in short; a service that knows only v 1 then refuses the schedule.
// Assembled as a string, without building the objects first (script memory).
function pubBody(t) {
  let idx = findWin(t);
  let v = 1;
  for (let i = 0; i < cfg.r.length; i++) if (cfg.r[i] && cfg.r[i][2]) v = 2;
  let out = '{"v":' + v + ',"now":' + t + ',"auto":' + (cfg.a !== 0 ? 1 : 0);
  if (okStr(TBL_TZ, 1, 64)) out += ',"tz":"' + TBL_TZ + '"';
  out += ',"w":[';
  for (let n = 0; n < CFG.pubN; n++) {
    let win = getWin(idx + n);
    if (!win) break;
    let x = win.s === cfg.s ? 1 : 0;
    out += n ? "," : "";
    out += '{"t":"' + win.title + '","k":' + win.k + ',"s":' + win.s + ',"e":' + win.e;
    out += ',"x":' + x + ',"on":[';
    let o = { on: [], rp: [] };
    let bl = [];
    if (!x) bl = blocks(win, cfg.t, cfg.r);
    onceTimes(win, bl, o.on);
    for (let i = 0; i < bl.length; i++) {
      if (!bl[i][2]) continue;
      span(win, bl[i]);
      if (pE) o.rp.push([pS, pE, bl[i][4], bl[i][2] / 60, bl[i][3] / 60]);
    }
    for (let i = 0; i < o.on.length; i++)
      out += (i ? "," : "") + "[" + o.on[i][0] + "," + o.on[i][1] + "]";
    out += "]";
    if (v === 2) out += ',"rp":[';
    for (let i = 0; v === 2 && i < o.rp.length; i++) {
      out +=
        (i ? "," : "") +
        "[" +
        o.rp[i][0] +
        "," +
        o.rp[i][1] +
        "," +
        o.rp[i][3] +
        "," +
        o.rp[i][4] +
        "]";
    }
    out += v === 2 ? "]}" : "}";
  }
  return out + "]}";
}

function pubSend() {
  let t = realNow();
  if (!pub || !t || !cfg) {
    pubBusy = false;
    return;
  }
  let p = {
    method: "PUT",
    url: pub.u + "/api/s/" + pub.i,
    headers: { Authorization: "Bearer " + pub.k },
    body: pubBody(t),
    timeout: 20
  };
  Shelly.call("HTTP.Request", p, onPubSent);
}

function onPubSent(res, err, msg) {
  pubBusy = false;
  let t = realNow();
  let code = res && res.code ? res.code : 0;
  if (!err && code >= 200 && code < 300) {
    pubOk = t;
    pubErr = "";
    pubFails = 0;
    // daily, at a time that differs between devices
    pubDue = t + 82800 + Math.floor(Math.random() * 7200);
    return;
  }
  pubErr = err ? "" + msg : "HTTP " + code;
  pubFails++;
  // retry after 5, 20, 45, 80 ... minutes, at most 6 hours
  let wait = 300 * pubFails * pubFails;
  if (wait > 21600) wait = 21600;
  pubDue = t + wait;
  console.log("Publish failed:", pubErr);
}

function onPubSaved(res, err, msg) {
  if (err) console.log("KVS save failed:", err, msg);
}

function pubState() {
  return {
    on: !!pub,
    u: pub ? pub.u : "",
    i: pub ? pub.i : "",
    k: pub ? pub.k : "",
    ok: pubOk,
    err: pubErr,
    due: pubDue,
    busy: pubBusy
  };
}

function doPub(req, params) {
  if (params.off) {
    pub = null;
    pubErr = "";
    pubOk = 0;
    Shelly.call("KVS.Delete", { key: CFG.pubKey }, onPubSaved);
  } else if (params.u !== undefined) {
    let p = { u: params.u, i: params.i, k: params.k };
    if (!validPub(p)) {
      req.error(-1, "invalid publishing settings");
      return;
    }
    pub = p;
    pubOk = 0;
    pubErr = "";
    Shelly.call("KVS.Set", { key: CFG.pubKey, value: JSON.stringify(p) }, onPubSaved);
  }
  if (pub && (params.send || params.u !== undefined)) {
    pubDue = 0;
    pubFails = 0;
    kickTick();
  }
  req.result(pubState());
}

// ---------------- UI loader page ----------------
// The browser fetches the UI code from the stopped script named "shabbat_ui" (or a name
// starting with it: the script library may name it "shabbat_ui.js") in 4 KB pieces,
// 2 at a time (see below). Measured on a Pro 1 (fw 2.0.3): a read costs the device about twice its
// size in RAM at the peak (16 KB read: +35 KB), and one ~28 KB read rebooted it; 4 KB pieces
// in parallel cost ~6-10 KB and load the 18 KB page in ~0.8 s instead of ~3 s one by one.
// The built scripts are ASCII, so byte offsets are character offsets.
let UI_A =
  // language-neutral: the page code sets lang, dir and title (Hebrew or English)
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Shabbat</title></head>' +
  '<body style="font-family:system-ui,sans-serif"><div id="app">...</div><script>window.SE_ID=';
// Page = UI_A + <this script id> + ";window.SE_UI=" + <shabbat_ui id, -1 if unknown> + UI_B,
// assembled per request: keeping the assembled copy too cost ~1.4 KB of script memory.
// The loader starts the status request (window.SE_FIRST, used by the page's first refresh)
// first, then asks for the first 7 pieces (28 KB, the whole page) and any rest; reads past
// the end return no data. With no known id, or code that is not shabbat_ui, it looks the
// id up.
// The device accepts only a few connections at a time, shared by every open page, app and
// tab: a burst of 7 requests failed with "Failed to fetch" (502 through a tunnel) while other
// windows were open (docs/device/network.md). So the loader keeps at most 2 requests in flight
// (J queues the rest) and retries a request up to 3 times when it fails or the answer is not
// the device's JSON.
let UI_B =
  ";(async function(){try{let id=window.SE_ID,ui=window.SE_UI,A=0,Q=[];" +
  "let N=function(){if(A<2&&Q.length){A++;Q.shift()()}};" +
  "let J=function(u,o){return new Promise(function(ok,no){Q.push(async function(){" +
  "for(let a=0;;a++){try{let r=await fetch(u,o),t=await r.text();" +
  'if(t.charAt(0)!=="{")throw new Error("HTTP "+r.status);ok(JSON.parse(t));break}' +
  "catch(e){if(a>2){no(e);break}await new Promise(function(s){setTimeout(s,300+500*a)})}}" +
  "A--;N()});N()})};" +
  'window.SE_FIRST=J("/rpc/Script.ShabbatGet",{method:"POST",body:JSON.stringify({id:id})});' +
  'let g=function(u,o){return J("/rpc/Script.GetCode?id="+u+"&len=4096&offset="+o)};' +
  "let R=async function(u){let p=[];for(let i=0;i<7;i++)p.push(g(u,i*4096));let r=await Promise.all(p);" +
  'if(!r[0].data||r[0].data.indexOf("// shabbat_ui")!==0)return null;' +
  'let n=r[0].data.length+r[0].left,c="";for(let x of r)c+=x.data||"";' +
  "let o=c.length;while(o<n){let b=[];for(let i=0;i<4&&o<n;i++,o+=4096)b.push(g(u,o));for(let x of await Promise.all(b))c+=x.data;}" +
  'if(c.length!==n)throw new Error("incomplete code");return c};' +
  "let c=ui>=0?await R(ui):null;" +
  'if(!c){let l=await J("/rpc/Script.List"),u=l.scripts.find(function(s){return s.name.indexOf("shabbat_ui")===0});' +
  'if(!u)throw new Error("script shabbat_ui not found");c=await R(u.id);if(!c)throw new Error("shabbat_ui unreadable");}' +
  'new Function(c)();}catch(e){document.getElementById("app").textContent="UI load failed: "+e.message+' +
  '" - if other pages of this device are open, close them and reload";}})();' +
  "</script></body></html>";
let uiId = -1;
// looked up at boot (with shabbat_dates); the loader falls back to Script.List if it is wrong

function onUi(req, res) {
  res.code = 200;
  res.headers = [
    ["Content-Type", "text/html; charset=utf-8"],
    ["Cache-Control", "no-store"]
  ];
  res.body = UI_A + Shelly.getCurrentScriptId() + ";window.SE_UI=" + uiId + UI_B;
  res.send();
}

// ---------------- Boot ----------------
function mem(stage) {
  if (!CFG.diag) return;
  let s = Shelly.getComponentStatus("script", Shelly.getCurrentScriptId());
  console.log(
    "[diag]",
    stage,
    s ? "mem_used=" + s.mem_used + " mem_peak=" + s.mem_peak + " mem_free=" + s.mem_free : ""
  );
}

let bootLoaded = null;
let bootStep = 0;
let BOOT = [
  function () {
    let c = bootLoaded;
    if (c && validTimers(c.t)) cfg = { t: c.t, a: c.a === 0 ? 0 : 1, s: c.s || 0, r: [] };
    else {
      cfg = { t: DEFAULT_TIMERS, a: 1, s: 0, r: [] };
      console.log("Using default timers");
    }
    if (c && c.r && validTimers(c.t) && validReps(c.r, c.t)) cfg.r = c.r;
  },
  function () {
    HTTPServer.registerEndpoint("ui", onUi);
    Script.addRpcHandler("ShabbatGet", onRpcGet);
    Script.addRpcHandler("ShabbatSet", onRpcSet);
    Script.addRpcHandler("ShabbatPreview", onRpcPreview);
    Script.addRpcHandler("ShabbatPub", onRpcPub);
  },
  tick,
  function () {
    Timer.set(CFG.tickMs, true, tick);
    console.log("Shabbat controller started. UI: /script/" + Shelly.getCurrentScriptId() + "/ui");
  }
];

function bootNext() {
  if (bootStep >= BOOT.length) {
    mem("boot done");
    return;
  }
  if (CFG.diag) console.log("[diag] boot step", bootStep);
  BOOT[bootStep]();
  bootStep++;
  mem("after step " + (bootStep - 1));
  Timer.set(CFG.diag ? 1000 : 50, false, bootNext); // fresh stack for every step
}

function onKvsLoaded(res, err, msg) {
  mem("kvs loaded");
  if (!err && res && typeof res.value === "string") {
    try {
      bootLoaded = JSON.parse(res.value);
    } catch (e) {
      console.log("Bad saved config, using defaults");
    }
  }
  Shelly.call("KVS.Get", { key: CFG.logKey }, onLogLoaded);
}

function onLogLoaded(res, err) {
  if (!err && res && typeof res.value === "string" && res.value.length)
    logArr = res.value.split(",");
  Shelly.call("KVS.Get", { key: CFG.pubKey }, onPubLoaded);
}

function onPubLoaded(res, err) {
  if (!err && res && typeof res.value === "string") {
    try {
      let p = JSON.parse(res.value);
      if (validPub(p)) pub = { u: p.u, i: p.i, k: p.k };
    } catch (e) {
      console.log("Bad publishing settings, ignored");
    }
  }
  datesLoad();
}

// ---------------- The table: read the shabbat_dates script ----------------
// At boot and on ShabbatSet {reload}: Script.List finds it (and shabbat_ui). Memory is tight
// (a whole-file read and parse ran out of memory on a Pro 1, docs/device/memory.md), so:
// first the header, 1 KB at a time until the "//W " line starts, parsed into small parts;
// then the windows line alone, from its exact offset, so the reply's data is the table
// string itself (no copies). The old table is dropped first, and ticks wait meanwhile.
let datesBusy = false;
let datesBooted = false;
let datesReq = []; // ShabbatSet {reload} requests waiting for the read
let datesCode = ""; // the header while it is read
let datesNl = ""; // the newline, taken from the code: no escapes in strings (engine.md)
let datesSize = 0; // the whole code (bytes)
let datesW = 0; // offset of the windows line's data
let datesOk = false;

function datesLoad() {
  datesBusy = true;
  datesOk = false;
  datesCode = "";
  TBL = "";
  TBL_N = 0;
  TBL_NAME = "";
  TBL_TZ = "";
  Shelly.call("Script.List", {}, onDatesList);
}

function onDatesList(res, err) {
  datesId = -1;
  if (!err && res && res.scripts) {
    for (let i = 0; i < res.scripts.length; i++) {
      let n = res.scripts[i].name;
      if (n.indexOf("shabbat_ui") === 0) uiId = res.scripts[i].id;
      if (n.indexOf("shabbat_dates") === 0) datesId = res.scripts[i].id;
    }
  }
  if (datesId < 0) {
    datesEnd();
    return;
  }
  Shelly.call("Script.GetCode", { id: datesId, offset: 0, len: 1024 }, onDatesHead);
}

// one tagged line ("//S ...") of the header, "" if missing
function datesField(tag) {
  let a = datesCode.indexOf(datesNl + "//" + tag + " ");
  if (a < 0) return "";
  let b = datesCode.indexOf(datesNl, a + 5);
  if (b < 0) b = datesCode.length;
  return datesCode.slice(a + 5, b);
}

function onDatesHead(res, err) {
  if (err || !res || typeof res.data !== "string") {
    datesEnd();
    return;
  }
  if (!datesCode.length) datesSize = res.data.length + res.left;
  datesCode += res.data;
  if (datesCode.indexOf("// shabbat_dates v1") !== 0) {
    datesEnd();
    return;
  }
  datesNl = datesCode.charAt(datesCode.indexOf("//N ") - 1);
  let a = datesCode.indexOf(datesNl + "//W ");
  if (a < 0) {
    if (res.left > 0 && datesCode.length < 4096) {
      let p = { id: datesId, offset: datesCode.length, len: 1024 };
      Shelly.call("Script.GetCode", p, onDatesHead);
    } else datesEnd();
    return;
  }
  datesW = a + 5;
  try {
    let s = JSON.parse("[" + datesField("S") + "]");
    let d = JSON.parse("[" + datesField("D") + "]");
    if (s.length === 2 && d.length % 2 === 0) {
      TBL_STD = s[0];
      TBL_TO = s[1];
      TBL_DST = d;
      TBL_T = datesField("T").split("|");
      TBL_TZ = datesField("Z");
      TBL_NAME = datesField("N");
      datesOk = true;
    }
  } catch (e) {
    datesOk = false;
  }
  datesCode = "";
  if (!datesOk) {
    datesEnd();
    return;
  }
  datesNext();
}

// the windows line: from datesW to the newline at the end of the code
function datesNext() {
  let left = datesSize - 1 - datesW - TBL.length;
  if (left <= 0) {
    datesEnd();
    return;
  }
  let p = { id: datesId, offset: datesW + TBL.length, len: left < 4096 ? left : 4096 };
  Shelly.call("Script.GetCode", p, onDatesW);
}

function onDatesW(res, err) {
  if (err || !res || typeof res.data !== "string" || !res.data.length) {
    datesOk = false;
    datesEnd();
    return;
  }
  if (TBL.length) TBL += res.data;
  else TBL = res.data;
  datesNext();
}

function datesEnd() {
  if (TBL.length === 0) datesOk = false;
  if (TBL.length % 8 !== 0) datesOk = false;
  if (TBL.indexOf(datesNl) >= 0) datesOk = false;
  if (!datesOk) {
    TBL = "";
    TBL_NAME = "";
    TBL_TZ = "";
    if (datesId >= 0) console.log("shabbat_dates is not a valid table");
  }
  TBL_N = TBL.length / 8;
  datesCode = "";
  datesBusy = false;
  lastWindowIdx = -2;
  console.log("Windows:", TBL_N, TBL_NAME);
  Timer.set(50, false, datesDone);
}

function datesDone() {
  if (!datesBooted) {
    datesBooted = true;
    bootNext();
    return;
  }
  for (let i = 0; i < datesReq.length; i++) replyQ.push(datesReq[i]);
  datesReq = [];
  pubSoon(30);
  kickTick();
}

// ---------------- Cleanup: remove virtual components of the old version ----------------
let VC_TYPES = ["enum", "number", "text", "boolean", "button", "group"];
let toDelete = [];

function scanComponents() {
  for (let t = 0; t < VC_TYPES.length; t++) {
    for (let id = 200; id < 230; id++) {
      if (Shelly.getComponentConfig(VC_TYPES[t], id)) toDelete.push(VC_TYPES[t] + ":" + id);
    }
  }
  if (toDelete.length) console.log("Removing virtual components:", toDelete.length);
  Timer.set(50, false, cleanNext);
}

function onVcDeleted(res, err, msg) {
  if (err) console.log("Virtual.Delete failed:", msg);
  Timer.set(50, false, cleanNext);
}

function cleanNext() {
  if (toDelete.length) {
    Shelly.call("Virtual.Delete", { key: toDelete.pop() }, onVcDeleted);
    return;
  }
  Shelly.call("KVS.Get", { key: CFG.kvsKey }, onKvsLoaded);
}

mem("parsed");
scanComponents();
