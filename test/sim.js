// Node simulator for dist/shabbat_controller.js - mocks the Shelly script APIs.
// Usage: node test/sim.js   (BUILD=shabbat_controller_diag.js for the diag build, QUICK=1 to skip the long sweep)
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CODE = fs.readFileSync(
  path.join(ROOT, "dist", process.env.BUILD || "shabbat_controller.js"),
  "utf8"
);
// Reference windows written by tools/gen_table.py: [start, end, kind 1=Shabbat 2=Yom Tov 3=both]
const WINDOWS = JSON.parse(fs.readFileSync(path.join(ROOT, "test/windows.json"), "utf8"));

let fails = 0;
function check(cond, msg) {
  if (!cond) {
    fails++;
    console.log("FAIL:", msg);
  }
}

// ---------- Mock device ----------
function makeDevice(opts) {
  opts = opts || {};
  const dev = {
    now: opts.now === undefined ? 1762525200 : opts.now,
    relay: false,
    relaySets: 0,
    kvs: opts.kvs || {},
    vcs: opts.vcs || {},
    timers: [],
    endpoints: {},
    rpc: {},
    pending: [],
    log: [],
    subs: 0,
    dels: 0
  };
  dev.src = "init";
  dev.tag = null;
  dev.manual = (on) => {
    dev.relay = on;
    dev.src = "WS_in";
    dev.tag = null;
  };
  dev.flush = () => {
    let n = 0;
    while (dev.pending.length && n++ < 5000) dev.pending.shift()();
  };
  const sandbox = {
    console: { log: (...a) => dev.log.push(a.join(" ")) },
    Shelly: {
      getComponentStatus(type, id) {
        if (type === "sys") return { unixtime: dev.now, utc_offset: 7200, uptime: 100 };
        if (type === "switch") return { id: 0, output: dev.relay, source: dev.src, tag: dev.tag };
        if (type === "script") return { id: 1, mem_used: 1, mem_peak: 1, mem_free: 1 };
        return null;
      },
      getComponentConfig(type, id) {
        return dev.vcs[type + ":" + id] || null;
      },
      call(method, params, cb) {
        let res = null,
          err = 0;
        if (method === "KVS.Get") {
          if (params.key in dev.kvs) res = { value: dev.kvs[params.key] };
          else err = -105;
        } else if (method === "KVS.Set") {
          if (String(params.value).length > 253) err = -1;
          else {
            dev.kvs[params.key] = params.value;
            res = {};
          }
        } else if (method === "Switch.Set") {
          dev.relay = params.on;
          dev.src = "loopback";
          dev.tag = params.tag || null;
          dev.toggleAfter = params.toggle_after;
          dev.relaySets++;
          res = {};
        } else if (method === "Virtual.Delete") {
          if (dev.vcs[params.key]) {
            delete dev.vcs[params.key];
            dev.dels++;
          } else err = -1;
        } else throw new Error("unexpected call " + method);
        if (cb) dev.pending.push(() => cb(res, err, err ? "err" : ""));
      },
      getCurrentScriptId: () => 1
    },
    Timer: {
      set(ms, rep, cb) {
        if (rep) dev.timers.push(cb);
        else dev.pending.push(cb);
        return 1;
      }
    },
    Script: {
      addRpcHandler(name, cb) {
        dev.rpc[name] = cb;
        return Object.keys(dev.rpc).length;
      }
    },
    HTTPServer: {
      registerEndpoint(name, cb) {
        dev.endpoints[name] = cb;
        return "/script/1/" + name;
      }
    }
  };
  vm.createContext(sandbox);
  // Built-ins missing on the Shelly engine (found on device) -> remove them here too
  vm.runInContext("delete Array.prototype.sort; delete String.prototype.replace;", sandbox);
  vm.runInContext(CODE, sandbox);
  dev.flush();
  dev.tick = () => {
    dev.timers[0]();
    dev.flush();
  };
  dev.call = (name, params) => {
    let out = null;
    dev.rpc[name](
      {
        result(d) {
          out = { ok: true, d: JSON.parse(JSON.stringify(d)) };
          return true;
        },
        error(c, m) {
          out = { ok: false, code: c, msg: m };
          return true;
        }
      },
      params
    );
    dev.flush();
    return out;
  };
  dev.http = (name) => {
    let out;
    dev.endpoints[name](
      { method: "GET" },
      {
        send() {
          out = this;
        }
      }
    );
    return out;
  };
  dev.sb = sandbox;
  return dev;
}

// ---------- Independent reference (Node Intl for TZ) ----------
// ranges: [start, end, (unused), kind]
const ranges = WINDOWS.map((w) => [w[0], w[1], "", w[2]]).sort((a, b) => a[0] - b[0]);

const fmtParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});
function localParts(t) {
  const o = {};
  for (const p of fmtParts.formatToParts(new Date(t * 1000))) o[p.type] = p.value;
  return o;
}
function localDayNum(t) {
  const p = localParts(t);
  return Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000;
}
function wallToUtc(dayNum, minutes) {
  // local wall clock -> UTC via search around +2/+3
  for (const off of [7200, 10800]) {
    const t = dayNum * 86400 + minutes * 60 - off;
    const p = localParts(t);
    if (localDayNum(t) === dayNum && +p.hour * 60 + +p.minute === minutes) return t;
  }
  return dayNum * 86400 + minutes * 60 - 7200;
}
function refOn(t, timers, skipStart) {
  const r = ranges.find((x) => x[0] <= t && t < x[1]);
  if (!r || r[0] === skipStart) return false;
  const [S, E, , K] = r;
  const inI = (s, e) => t >= Math.max(s, S) && t < Math.min(e, E);
  const d0 = localDayNum(S),
    d1 = localDayNum(E),
    n = d1 - d0;
  for (const [a, v, d, p, y, en] of timers) {
    if (!en || !d) continue;
    if (p === 1 && K === 2) continue;
    if (p === 2 && K === 1) continue;
    if (a === 0 && inI(S + v * 60, S + (v + d) * 60)) return true;
    if (a === 2 && inI(E + v * 60, E + (v + d) * 60)) return true;
    if (a === 1)
      for (let day = d0 - 1; day <= d1; day++) {
        const k = day - d0;
        if (y === 1 && k > 1) continue;
        if (y === 2 && k !== n) continue;
        const st = wallToUtc(day, v);
        if (inI(st, st + d * 60)) return true;
      }
  }
  return false;
}

// ---------- T0: limits, call depth ----------
{
  const d = makeDevice();
  check(Object.keys(d.rpc).length <= 5, "rpc handlers " + Object.keys(d.rpc).length);
  check(d.timers.length === 1, "one repeating timer");
  check(d.endpoints.ui, "ui endpoint");
  let depth = 0,
    maxDepth = 0,
    maxPath = [],
    st = [];
  const names = vm
    .runInContext("Object.keys(this)", d.sb)
    .filter(
      (n) =>
        typeof d.sb[n] === "function" &&
        !["console", "Shelly", "Timer", "HTTPServer", "Script"].includes(n)
    );
  for (const n of names) {
    const f = d.sb[n];
    d.sb[n] = function () {
      depth++;
      st.push(n);
      if (depth > maxDepth) {
        maxDepth = depth;
        maxPath = st.slice();
      }
      try {
        return f.apply(this, arguments);
      } finally {
        depth--;
        st.pop();
      }
    };
  }
  for (let t = 1762525200; t < 1762525200 + 2 * 86400; t += 600) {
    d.now = t;
    d.tick();
  }
  d.call("ShabbatSet", {
    timers: [
      [1, 600, 30, 0, 0, 1],
      [0, 0, 60, 0, 0, 1]
    ]
  });
  d.call("ShabbatPreview", { n: 8 });
  d.call("ShabbatGet", {});
  check(maxDepth <= 5, "max JS call depth " + maxDepth + ": " + maxPath.join(" > "));
  console.log(
    "T0 limits: rpc",
    Object.keys(d.rpc).join(","),
    "| max JS call depth",
    maxDepth,
    "(" + maxPath.join(" > ") + ")"
  );
}

{
  // RPC handlers must only enqueue (the firmware calls them with little stack left)
  const d = makeDevice();
  let calls = 0;
  const wp = d.sb.windowPlan;
  d.sb.windowPlan = function () {
    calls++;
    return wp.apply(this, arguments);
  };
  const tk = d.sb.tick;
  d.sb.tick = function () {
    calls++;
    return tk.apply(this, arguments);
  };
  for (const m of ["ShabbatGet", "ShabbatSet", "ShabbatPreview"]) {
    let answered = false;
    d.rpc[m](
      {
        result() {
          answered = true;
        },
        error() {
          answered = true;
        }
      },
      { n: 2, auto: true }
    );
    check(!answered && calls === 0, m + " handler did work inline");
    d.flush();
    check(answered, m + " answered after deferral");
    calls = 0;
  }
  console.log("T0c RPC handlers defer work: OK");
}
// ---------- T0b: old virtual components removed ----------
{
  const d = makeDevice({ vcs: { "enum:200": {}, "text:201": {}, "number:203": {} } });
  check(d.dels === 3 && Object.keys(d.vcs).length === 0, "old virtual components deleted");
  console.log("T0b cleanup: deleted", d.dels);
}

// ---------- T1: table decode & kinds ----------
{
  const d = makeDevice();
  const N = vm.runInContext("TBL_N", d.sb);
  check(N === ranges.length, `window count ${N} vs ${ranges.length}`);
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const w = vm.runInContext(`getWin(${i})`, d.sb);
    if (w.s !== ranges[i][0] || w.e !== ranges[i][1] || w.k !== ranges[i][3]) bad++;
  }
  check(bad === 0, "window mismatches " + bad);
  console.log("T1 table decode:", N, "windows, kinds OK");
}

// ---------- T2: local time ----------
{
  const d = makeDevice();
  let bad = 0;
  for (let t = 1735689600; t < 1924992000; t += 3 * 3600 + 17) {
    const p = localParts(t);
    if (vm.runInContext(`fmtTime(${t})`, d.sb) !== `${p.hour}:${p.minute}`) bad++;
  }
  check(bad === 0, `local time mismatches: ${bad}`);
  console.log("T2 local time 2025-2030:", bad ? "FAIL" : "OK");
}

// ---------- T3: relay sweep vs reference ----------
function sweep(timers, label, skipIdx) {
  const kvs = timers ? { shabbat_elev_cfg: JSON.stringify({ t: timers, a: 1, s: 0 }) } : {};
  const dev = makeDevice({ kvs, now: ranges[0][0] - 86400 });
  timers = timers || vm.runInContext("DEFAULT_TIMERS", dev.sb);
  let skip = 0;
  let mism = 0,
    onMin = 0,
    transitions = 0,
    prev = false;
  const t1 = ranges[ranges.length - 1][1] + 86400;
  let t = ranges[0][0] - 7200,
    ri = 0;
  while (t < t1) {
    while (ri < ranges.length && ranges[ri][1] + 7200 < t) ri++;
    if (ri < ranges.length && t < ranges[ri][0] - 7200) t = ranges[ri][0] - 7200;
    if (t >= t1) break;
    if (skipIdx !== undefined && ri === skipIdx && !skip) {
      dev.now = ranges[ri][0] - 3600;
      dev.call("ShabbatSet", { skip: true });
      skip = ranges[ri][0];
    }
    dev.now = t;
    dev.tick();
    const exp = refOn(t, timers, skip);
    if (dev.relay !== exp) {
      if (mism++ < 5)
        console.log(
          `  [${label}] mismatch at ${new Date(t * 1000).toISOString()} relay=${dev.relay} expected=${exp}`
        );
    }
    if (dev.relay) onMin++;
    if (dev.relay !== prev) transitions++;
    prev = dev.relay;
    t += 60;
  }
  check(mism === 0, `${label}: ${mism} relay mismatches`);
  console.log(
    `T3 sweep [${label}]: ON ${Math.round(onMin / 60)}h, ${transitions} transitions, relay calls ${dev.relaySets}, mismatches ${mism}`
  );
}
if (!process.env.QUICK) {
  sweep(null, "defaults");
  sweep(
    [
      [0, 0, 60, 0, 0, 1],
      [0, 90, 30, 1, 0, 1],
      [1, 0, 30, 0, 0, 1],
      [1, 1410, 60, 0, 0, 1],
      [1, 480, 120, 2, 1, 1],
      [1, 735, 45, 0, 2, 1],
      [1, 960, 30, 1, 0, 0],
      [2, -60, 30, 0, 0, 1],
      [2, -15, 15, 2, 0, 1],
      [2, -120, 20, 0, 0, 1]
    ],
    "busy: applies/days/overnight/disabled",
    100
  );
}

// ---------- T4: RPC API ----------
{
  const dev = makeDevice({ now: 1762525200 }); // Fri 07/11/2025 16:20
  let r = dev.call("ShabbatGet", {});
  check(r.ok && r.d.cfg.timers.length === 3 && r.d.cfg.auto === true, "get defaults");
  check(r.d.st.next && r.d.st.next.t === "Shabbat" && r.d.st.nextOn, "status next window + nextOn");
  for (const bad of [
    [[3, 0, 30, 0, 0, 1]],
    [[0, -5, 30, 0, 0, 1]],
    [[2, 5, 30, 0, 0, 1]],
    [[1, 1440, 30, 0, 0, 1]],
    [[1, 600, 300, 0, 0, 1]],
    [[1, 600, 30, 0, 0]],
    "x",
    Array.from({ length: 13 }, () => [1, 600, 30, 0, 0, 1])
  ]) {
    r = dev.call("ShabbatSet", { timers: bad });
    check(!r.ok, "rejects invalid " + JSON.stringify(bad).slice(0, 40));
  }
  const tl = Array.from({ length: 12 }, (_, i) => [
    i % 3,
    i % 3 === 0 ? 180 : i % 3 === 1 ? 1439 : -180,
    240,
    2,
    2,
    1
  ]);
  r = dev.call("ShabbatSet", { timers: tl });
  check(
    r.ok && dev.kvs.shabbat_elev_cfg.length <= 253,
    "12 worst-case timers fit KVS (" + (dev.kvs.shabbat_elev_cfg || "").length + " chars)"
  );
  r = dev.call("ShabbatSet", { timers: [[1, 720, 60, 0, 0, 1]], auto: false });
  check(
    r.ok && r.d.cfg.auto === false && JSON.parse(dev.kvs.shabbat_elev_cfg).a === 0,
    "auto off saved"
  );
  dev.now = 1762597800;
  dev.relay = false;
  dev.tick(); // Sat 12:30
  check(dev.relay === false, "auto off -> hands off");
  r = dev.call("ShabbatSet", { auto: true });
  check(dev.relay === true && r.d.st.on, "auto on -> ON at Sat 12:30");
  // test time
  dev.now = 1762525200;
  r = dev.call("ShabbatSet", { test: 1762597800 });
  check(dev.relay === true && r.d.st.test === 1762597800, "test time drives relay");
  r = dev.call("ShabbatSet", { test: 0 });
  dev.tick();
  check(dev.relay === false && !r.d.st.test, "test cleared");
  // skip
  r = dev.call("ShabbatSet", { skip: true });
  check(r.d.cfg.skip === 1762525740 || r.d.cfg.skip > 0, "skip set to next window");
  dev.now = 1762597800;
  dev.tick();
  check(dev.relay === false, "skipped window -> OFF");
  const pv = dev.call("ShabbatPreview", { n: 2 });
  check(
    pv.ok && pv.d.w[0].skip === true && pv.d.w[0].on.length === 0 && pv.d.w[1].on.length === 1,
    "preview shows skip"
  );
  r = dev.call("ShabbatSet", { skip: false });
  dev.tick();
  check(dev.relay === true, "unskip -> ON");
  // reboot keeps config
  const dev2 = makeDevice({ kvs: dev.kvs, now: 1762597800 });
  dev2.tick();
  r = dev2.call("ShabbatGet", {});
  check(
    JSON.stringify(r.d.cfg.timers) === "[[1,720,60,0,0,1]]" && dev2.relay === true,
    "config survives reboot"
  );
  // not synced
  dev2.now = 0;
  dev2.tick();
  check(
    dev2.relay === false && dev2.call("ShabbatGet", {}).d.st.synced === false,
    "not synced -> fail-safe OFF"
  );
  // preview with draft timers does not save
  const before = dev.kvs.shabbat_elev_cfg;
  const p2 = dev.call("ShabbatPreview", {
    timers: [
      [0, 0, 10, 0, 0, 1],
      [1, 720, 60, 0, 0, 1]
    ],
    n: 8
  });
  check(
    p2.ok && p2.d.w.length === 8 && dev.kvs.shabbat_elev_cfg === before,
    "draft preview not saved"
  );
  check(p2.d.w[0].on[0][2] === "1", "labels are timer numbers");
  console.log("T4 RPC API: validation, save, auto, test, skip, reboot, preview");
}

// ---------- T6: firmware auto-off, manual hold, event log ----------
{
  const SAT1200 = 1762596000,
    SAT1300 = 1762599600; // Sat 08/11/2025 12:00 / 13:00 Israel
  const dev = makeDevice({ now: SAT1200 + 60 });
  dev.tick();
  check(dev.relay === true && dev.tag === "shabbat", "ON with tag");
  check(
    dev.toggleAfter === SAT1300 - (SAT1200 + 60) + 5,
    "toggle_after = remaining + 5 s (" + dev.toggleAfter + ")"
  );
  // editing the timer while ON re-arms the firmware auto-off
  dev.call("ShabbatSet", {
    timers: [
      [0, 15, 30, 0, 0, 1],
      [1, 720, 90, 0, 0, 1],
      [2, -40, 40, 0, 0, 1]
    ]
  });
  check(
    dev.toggleAfter === SAT1300 + 1800 - (SAT1200 + 60) + 5,
    "auto-off re-armed after edit (" + dev.toggleAfter + ")"
  );
  // manual OFF at 12:10 is respected until the next event
  dev.now = SAT1200 + 600;
  dev.manual(false);
  dev.tick();
  let g = dev.call("ShabbatGet", {}).d;
  check(dev.relay === false && g.st.manual === true, "manual OFF respected");
  for (let t = SAT1200 + 615; t < SAT1300 + 1800; t += 15) {
    dev.now = t;
    dev.tick();
  }
  check(dev.relay === false, "still OFF until interval end");
  dev.now = SAT1300 + 1800 + 30;
  dev.tick();
  g = dev.call("ShabbatGet", {}).d;
  check(g.st.manual === false, "manual hold released at next event");
  // havdalah timer (16:44 Sat) turns ON again
  dev.now = 1762613400 + 120;
  dev.tick(); // 16:52 > 16:44
  check(dev.relay === true, "next timer turns ON again (" + dev.relay + ")");
  // manual ON outside a timer, then resume
  dev.now = 1762700000;
  dev.tick(); // Sunday, no window -> OFF
  dev.manual(true);
  dev.tick();
  check(dev.relay === true && dev.call("ShabbatGet", {}).d.st.manual, "manual ON held");
  dev.call("ShabbatSet", { resume: true });
  check(dev.relay === false, "resume -> back to automatic (OFF)");
  // log
  g = dev.call("ShabbatGet", {}).d;
  const ev = g.log.split(",");
  check(
    ev.length >= 6 &&
      /^\d+1a$/.test(ev[0]) &&
      ev.some((e) => /0m$/.test(e)) &&
      ev.some((e) => /1m$/.test(e)),
    "log entries: " + g.log
  );
  check(dev.kvs.shabbat_elev_log === g.log, "log saved to KVS");
  const dev2 = makeDevice({ kvs: dev.kvs, now: 1762700000 });
  check(dev2.call("ShabbatGet", {}).d.log === g.log, "log survives reboot");
  // log cap
  for (let i = 0; i < 20; i++) {
    dev.manual(i % 2 === 0);
    dev.tick();
    dev.call("ShabbatSet", { resume: true });
  }
  check(
    dev.call("ShabbatGet", {}).d.log.split(",").length === 15 &&
      dev.kvs.shabbat_elev_log.length < 253,
    "log capped at 15 entries"
  );
  // test time: no firmware auto-off (simulated clock does not advance)
  dev.call("ShabbatSet", { test: SAT1200 + 60 });
  check(dev.relay === true && dev.toggleAfter === undefined, "no toggle_after in test mode");
  console.log("T6 auto-off, manual hold, log: OK");
}

// ---------- T5: UI loader page ----------
{
  const dev = makeDevice();
  const r = dev.http("ui");
  check(
    r.code === 200 && /window\.SE_ID=1;/.test(r.body) && /shabbat_ui/.test(r.body),
    "ui loader page"
  );
  console.log("T5 UI loader:", r.body.length, "bytes");
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL TESTS PASSED");
process.exit(fails ? 1 : 0);
