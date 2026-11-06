// =============================================================================
// Shabbat controller for Shelly (Gen2+ with a relay, firmware 2.0+; developed on a Pro 1)
//
// Turns switch:0 on during configured timers inside Shabbat & Yom Tov windows
// (Shabbat + Yom Tov). Windows come from the embedded table (no internet).
//
// Settings UI:  http://<ip>/script/<this id>/ui
//   The page is a tiny loader; the UI code itself is stored as the code of a
//   second, never-started script named "shabbat_ui" and read by the browser
//   via the firmware's Script.GetCode (costs this script no memory).
//
// RPC API (Script.<name>, routed by "id" = this script's id):
//   ShabbatGet                 -> {cfg, st}
//   ShabbatSet {timers?, auto?, skip?, test?}  -> {cfg, st}   (validated, saved)
//   ShabbatPreview {timers?, n?} -> {w: [{t, k, s, e, skip, on: [[s, e, "1+3"]]}]}
//
// Timer: [anchor, value, duration, applies, days, enabled]
//   anchor   0 = candle lighting (value = minutes after window start, 0..180)
//            1 = clock time      (value = minutes of local day, 0..1439)
//            2 = havdalah        (value = minutes before window end, -180..0)
//   duration 0..240 min
//   applies  0 = Shabbat & Yom Tov, 1 = Shabbat only, 2 = Yom Tov only
//   days     (clock timers) 0 = every day, 1 = first day, 2 = last day
//   enabled  0/1
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

//@@TABLE@@

// ---------------- Globals ----------------
let ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";
let TBL_N = TBL.length / 8;

let cfg = null; // {t: timers, a: auto 0/1, s: skipped window start (0 = none)}
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
// DST periods come from the generated table (TBL_DST = [start, end, ...] in
// UTC seconds, from the tz database). Outside the table: device utc_offset.
let sysOffset = 7200;
function tzOffset(t) {
  if (t < TBL_BASE || t >= TBL_DST[TBL_DST.length - 1] + 86400 * 150) return sysOffset;
  for (let i = 0; i < TBL_DST.length; i += 2) {
    if (t >= TBL_DST[i] && t < TBL_DST[i + 1]) return TBL_STD + 3600;
  }
  return TBL_STD;
}

// local wall-clock seconds -> UTC seconds (inlined offset lookup: no nested calls)
function localToUtc(localSecs) {
  let u = localSecs - TBL_STD;
  if (u < TBL_BASE || u >= TBL_DST[TBL_DST.length - 1] + 86400 * 150) return localSecs - sysOffset;
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
function pushClipped(list, s, e, w, label) {
  if (s < w.s) s = w.s;
  if (e > w.e) e = w.e;
  if (e <= s) return;
  // sorted insert by start (Array.sort is not available on Shelly)
  let i = list.length;
  list.push(null);
  while (i > 0 && list[i - 1].s > s) {
    list[i] = list[i - 1];
    i--;
  }
  list[i] = { s: s, e: e, l: label };
}

// All ON intervals of window w for timers tl, merged & sorted: [{s,e,l}]
// (l = 1-based timer numbers, e.g. "1+3")
function windowPlan(w, tl) {
  let list = [];
  let ls = w.s + tzOffset(w.s);
  let le = w.e + tzOffset(w.e);
  let d0 = Math.floor(ls / 86400);
  let d1 = Math.floor(le / 86400);
  let nDays = d1 - d0;
  for (let i = 0; i < tl.length; i++) {
    let v = tl[i];
    if (!v[5] || v[2] <= 0) continue;
    if (v[3] === 1 && w.k === 2) continue;
    if (v[3] === 2 && w.k === 1) continue;
    let lab = "" + (i + 1);
    let a = w.s;
    if (v[0] === 0) {
      a = w.s + v[1] * 60;
      pushClipped(list, a, a + v[2] * 60, w, lab);
      continue;
    }
    if (v[0] === 2) {
      a = w.e + v[1] * 60;
      pushClipped(list, a, a + v[2] * 60, w, lab);
      continue;
    }
    for (let d = d0 - 1; d <= d1; d++) {
      let k = d - d0;
      if (v[4] === 1 && k > 1) continue;
      if (v[4] === 2 && k !== nDays) continue;
      a = localToUtc(d * 86400 + v[1] * 60);
      pushClipped(list, a, a + v[2] * 60, w, lab);
    }
  }
  let out = [];
  for (let j = 0; j < list.length; j++) {
    let x = list[j];
    let last = out.length ? out[out.length - 1] : null;
    if (last && x.s <= last.e) {
      if (x.e > last.e) last.e = x.e;
      if (("+" + last.l + "+").indexOf("+" + x.l + "+") < 0) last.l += "+" + x.l;
    } else {
      out.push({ s: x.s, e: x.e, l: x.l });
    }
  }
  return out;
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
  Shelly.call("KVS.Set", { key: CFG.kvsKey, value: JSON.stringify(cfg) }, onKvsSaved);
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

function onSwitchSet(res, err, msg) {
  if (err) {
    console.log("Switch.Set failed:", err, msg);
    lastWanted = null;
  }
}

// ---- event log (KVS, survives reboot) ----
function onLogSaved(res, err) {
  logSaving = false;
  if (logDirty) saveLog();
}
function saveLog() {
  if (logSaving) {
    logDirty = true;
    return;
  }
  logSaving = true;
  logDirty = false;
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
  if (!st) return;
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
  if (st.output !== on) {
    addLog(on, cause);
    lastOut = on;
  }
  Shelly.call("Switch.Set", p, onSwitchSet);
}

function winInfo(w) {
  return w ? { t: w.title, k: w.k, s: w.s, e: w.e } : null;
}

function tick() {
  if (!cfg) return;
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
    end: getWin(TBL_N - 1).e
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
    let plan = windowPlan(pw[k], cfg.t);
    for (let i = 0; i < plan.length; i++) {
      let p = plan[i];
      if (p.s <= t && t < p.e) {
        on = p;
        break;
      }
      if (p.s > t) {
        upcoming = p;
        break;
      }
    }
  }
  if (on) status.on = [on.s, on.e, on.l];
  if (upcoming) status.nextOn = [upcoming.s, upcoming.e, upcoming.l];

  dbg("tick " + fmtTime(t), !!on);
  if (auto) {
    applyRelay(!!on, on ? on.e : 0, testTime ? "x" : "a");
    status.relay = manualHold !== null ? lastOut : !!on; // report the state just commanded
  } else lastWanted = null;
  status.manual = manualHold !== null;
}

// ---------------- RPC API ----------------
function snapshot() {
  let lg = "";
  for (let i = 0; i < logArr.length; i++) lg += (i ? "," : "") + logArr[i];
  return {
    cfg: { timers: cfg.t, auto: cfg.a !== 0, skip: cfg.s },
    st: status,
    log: lg,
    base: TBL_BASE
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
  let changed = false;
  if (params.timers !== undefined) {
    if (!validTimers(params.timers)) {
      req.error(-1, "invalid timers");
      return;
    }
    cfg.t = params.timers;
    changed = true;
  }
  if (params.auto !== undefined) {
    cfg.a = params.auto ? 1 : 0;
    changed = true;
  }
  if (params.skip !== undefined) {
    // true -> skip the current/next window; false -> no skip
    let w = getWin(findWin(getNow() || TBL_BASE));
    cfg.s = params.skip && w ? w.s : 0;
    changed = true;
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
    let js = JSON.stringify(cfg);
    if (js.length > 250) {
      req.error(-1, "too many timers");
      return;
    }
    saveCfg();
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
  if (params.timers !== undefined) {
    if (!validTimers(params.timers)) {
      req.error(-1, "invalid timers");
      return;
    }
    tl = params.timers;
  }
  let n = Math.floor(params.n || 6);
  if (n < 1) n = 1;
  if (n > 8) n = 8;
  let t = getNow() || TBL_BASE;
  let from = params.from ? Math.floor(params.from) : t;
  let idx = findWin(from);
  let out = [];
  for (let k = 0; k < n; k++) {
    let w = getWin(idx + k);
    if (!w) break;
    let skip = w.s === cfg.s;
    let on = [];
    if (!skip) {
      let plan = windowPlan(w, tl);
      for (let i = 0; i < plan.length; i++) on.push([plan[i].s, plan[i].e, plan[i].l]);
    }
    out.push({ t: w.title, k: w.k, s: w.s, e: w.e, skip: skip, on: on });
  }
  req.result({ w: out, now: t });
}

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

// ---------------- UI loader page ----------------
// The browser fetches the UI code from the stopped script named "shabbat_ui" (or a name
// starting with it: the script library may name it "shabbat_ui.js") in 4 KB pieces,
// up to 4 at a time. Measured on a Pro 1 (fw 2.0.3): a read costs the device about twice its
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
// To shorten the chain of round trips through a slow link, the loader starts the status
// request (window.SE_FIRST, used by the page's first refresh) together with the code, and
// reads the first 5 pieces (20 KB) in one parallel round, the rest (if any) in a second round;
// reads past the end
// return no data. With no known id, or code that is not shabbat_ui, it looks the id up.
let UI_B =
  ";(async function(){try{let id=window.SE_ID,ui=window.SE_UI;" +
  'window.SE_FIRST=fetch("/rpc/Script.ShabbatGet",{method:"POST",body:JSON.stringify({id:id})}).then(function(r){return r.json()});' +
  'let g=function(u,o){return fetch("/rpc/Script.GetCode?id="+u+"&len=4096&offset="+o).then(function(r){return r.json()})};' +
  "let R=async function(u){let p=[];for(let i=0;i<5;i++)p.push(g(u,i*4096));let r=await Promise.all(p);" +
  'if(!r[0].data||r[0].data.indexOf("// shabbat_ui")!==0)return null;' +
  'let n=r[0].data.length+r[0].left,c="";for(let x of r)c+=x.data||"";' +
  "let o=c.length;while(o<n){let b=[];for(let i=0;i<4&&o<n;i++,o+=4096)b.push(g(u,o));for(let x of await Promise.all(b))c+=x.data;}" +
  'if(c.length!==n)throw new Error("incomplete code");return c};' +
  "let c=ui>=0?await R(ui):null;" +
  'if(!c){let l=await (await fetch("/rpc/Script.List")).json(),u=l.scripts.find(function(s){return s.name.indexOf("shabbat_ui")===0});' +
  'if(!u)throw new Error("script shabbat_ui not found");c=await R(u.id);if(!c)throw new Error("shabbat_ui unreadable");}' +
  'new Function(c)();}catch(e){document.getElementById("app").textContent="UI load failed: "+e.message;}})();' +
  "</script></body></html>";
let uiId = -1;
// looked up once at boot; the loader falls back to Script.List if it is wrong
function onUiList(res, err) {
  if (!err && res && res.scripts) {
    for (let i = 0; i < res.scripts.length; i++) {
      if (res.scripts[i].name.indexOf("shabbat_ui") === 0) uiId = res.scripts[i].id;
    }
  }
}

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
    if (c && validTimers(c.t)) cfg = { t: c.t, a: c.a === 0 ? 0 : 1, s: c.s || 0 };
    else {
      cfg = { t: DEFAULT_TIMERS, a: 1, s: 0 };
      console.log("Using default timers");
    }
  },
  function () {
    Shelly.call("Script.List", {}, onUiList);
    HTTPServer.registerEndpoint("ui", onUi);
    Script.addRpcHandler("ShabbatGet", onRpcGet);
    Script.addRpcHandler("ShabbatSet", onRpcSet);
    Script.addRpcHandler("ShabbatPreview", onRpcPreview);
  },
  tick,
  function () {
    Timer.set(CFG.tickMs, true, tick);
    console.log(
      "Shabbat controller started. Windows:",
      TBL_N,
      "UI: /script/" + Shelly.getCurrentScriptId() + "/ui"
    );
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
  Timer.set(50, false, bootNext);
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
