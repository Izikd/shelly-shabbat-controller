// SPDX-License-Identifier: MIT
// Node simulator for dist/shabbat_controller.js - mocks the Shelly script APIs.
// Usage: node test/sim.js   (FLAGS=1 turns CFG.debug and CFG.diag on, QUICK=1 skips the long sweep)
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const BUILT = path.join(ROOT, "dist", "shabbat_controller.js");
if (!fs.existsSync(BUILT))
  throw new Error(BUILT + " missing - run `npm run build` (or `npm test`)");
let CODE = fs.readFileSync(BUILT, "utf8");
if (process.env.FLAGS) {
  // the debug/diag code paths ship in every build, switched off; exercise them too
  const on = CODE.replace("debug:false", "debug:true").replace("diag:false", "diag:true");
  if (on === CODE || !/debug:true/.test(on) || !/diag:true/.test(on))
    throw new Error("CFG.debug / CFG.diag not found in the built controller");
  CODE = on;
}
// Reference tables written by tools/gen_ref.mjs (hebcal, through src/tablegen.js):
// test/dates/<place>.txt is the shabbat_dates script code, test/windows.json the same windows
// as {<place>: {tz, w: [[start, end, kind 1=Shabbat 2=Yom Tov 3=both], ...]}}
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, "test/windows.json"), "utf8"));
const DATES = {};
for (const k of Object.keys(REF))
  DATES[k] = fs.readFileSync(path.join(ROOT, "test/dates", k + ".txt"), "utf8");

let fails = 0;
function check(cond, msg) {
  if (!cond) {
    fails++;
    console.log("FAIL:", msg);
  }
}

// ---------- Mock device ----------
// opts.dates: shabbat_dates code (default: Petah Tikva), null = no such script
function makeDevice(opts) {
  opts = opts || {};
  const scripts = [
    { id: 1, name: "shabbat_controller" },
    { id: 2, name: "shabbat_ui" }
  ];
  const dates = opts.dates === undefined ? DATES.pt : opts.dates;
  if (dates !== null) scripts.push({ id: 3, name: "shabbat_dates", code: Buffer.from(dates) });
  const dev = {
    scripts,
    getCodes: 0,
    getLens: [], // len of each Script.GetCode
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
    dels: 0,
    reqs: [], // HTTP.Request calls
    httpReply: { code: 204, message: "No Content", headers: {}, body: "" },
    httpErr: 0
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
        } else if (method === "KVS.Delete") {
          if (params.key in dev.kvs) {
            delete dev.kvs[params.key];
            res = {};
          } else err = -105;
        } else if (method === "HTTP.Request") {
          // like the firmware: total request <= 8 KB, PUT/POST need a body
          dev.reqs.push(JSON.parse(JSON.stringify(params)));
          const size = params.url.length + (params.body || "").length + 200;
          if (size > 8192 || (params.method === "PUT" && !params.body)) err = -103;
          else if (dev.httpErr) err = dev.httpErr;
          else res = JSON.parse(JSON.stringify(dev.httpReply));
        } else if (method === "KVS.Set") {
          if (String(params.value).length > 253) err = -1;
          else {
            if (params.key === "shabbat_elev_log") dev.logSets = (dev.logSets || 0) + 1;
            dev.kvs[params.key] = params.value;
            res = {};
          }
        } else if (method === "Switch.Set" && dev.swErr) {
          err = -1; // refused: the relay is not switched
        } else if (method === "Switch.Set") {
          dev.relay = params.on;
          dev.src = "loopback";
          dev.tag = params.tag || null;
          dev.toggleAfter = params.toggle_after;
          dev.relaySets++;
          res = {};
        } else if (method === "Script.List") {
          res = { scripts: dev.scripts.map((x) => ({ id: x.id, name: x.name })) };
        } else if (method === "Script.GetCode") {
          // like the device: byte ranges, small reads only, an error past the end
          dev.getCodes++;
          dev.getLens.push(params.len);
          const sc = dev.scripts.find((x) => x.id === params.id);
          const off = params.offset || 0;
          if (!sc || !sc.code) err = -105;
          else if (!params.len || params.len > 8192) err = -103;
          else if (off > sc.code.length) err = -103;
          else {
            const end = Math.min(sc.code.length, off + params.len);
            res = { data: sc.code.subarray(off, end).toString("utf8"), left: sc.code.length - end };
          }
        } else if (method === "Virtual.Delete") {
          if (dev.vcs[params.key]) {
            delete dev.vcs[params.key];
            dev.dels++;
          } else err = -1;
        } else throw new Error("unexpected call " + method);
        // dev.httpHold: the reply of an HTTP.Request waits until the test calls dev.held()
        if (cb && method === "HTTP.Request" && dev.httpHold)
          dev.held = () => cb(res, err, err ? "err" : "");
        else if (cb) dev.pending.push(() => cb(res, err, err ? "err" : ""));
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
// ranges: [start, end, (unused), kind] of the place the reference uses (useRef)
let ranges, fmtParts;
function useRef(place) {
  ranges = REF[place].w.map((w) => [w[0], w[1], "", w[2]]).sort((a, b) => a[0] - b[0]);
  fmtParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REF[place].tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
}
useRef("pt");
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
  // local wall clock -> UTC via search over the offsets the zone has around that day
  const offs = [-1, 0, 1].map((k) => {
    const t = dayNum * 86400 + k * 43200;
    const p = localParts(t);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000 - t;
  });
  for (const off of offs) {
    const t = dayNum * 86400 + minutes * 60 - off;
    const p = localParts(t);
    if (localDayNum(t) === dayNum && +p.hour * 60 + +p.minute === minutes) return t;
  }
  return dayNum * 86400 + minutes * 60 - offs[1];
}
// reps: repeats per timer (0 or [every, length, enabled]); a repeating timer is on for its
// duration every `every` minutes from its start, for `length` minutes
function refOn(t, timers, skipStart, reps) {
  const r = ranges.find((x) => x[0] <= t && t < x[1]);
  if (!r || r[0] === skipStart) return false;
  const [S, E, , K] = r;
  const inI = (s, e) => t >= Math.max(s, S) && t < Math.min(e, E);
  const d0 = localDayNum(S),
    d1 = localDayNum(E),
    n = d1 - d0;
  const on = (st, d, r) => {
    if (!r) return inI(st, st + d * 60);
    for (let ps = st; ps < st + r[1] * 60; ps += r[0] * 60)
      if (inI(ps, Math.min(ps + d * 60, st + r[1] * 60))) return true;
    return false;
  };
  for (let i = 0; i < timers.length; i++) {
    const [a, v, d, p, y] = timers[i];
    const r = reps && reps[i];
    const en = r ? r[2] : timers[i][5];
    if (!en || !d) continue;
    if (p === 1 && K === 2) continue;
    if (p === 2 && K === 1) continue;
    if (a === 0 && on(S + v * 60, d, r)) return true;
    if (a === 2 && on(E + v * 60, d, r)) return true;
    if (a === 1)
      for (let day = d0 - 1; day <= d1; day++) {
        const k = day - d0;
        if (y === 1 && k > 1) continue;
        if (y === 2 && k !== n) continue;
        if (on(wallToUtc(day, v), d, r)) return true;
      }
  }
  return false;
}

// ---------- T0: limits, call depth, stack weight ----------
// The device's JS stack is small, and call depth alone does not measure it (fw 2.0.3,
// docs/device/engine.md). A path's weight is its variables (parameters and let-declared names
// of each function) + 15 per frame. On the device these overflowed: tickFromTimer > tick >
// segAt > repScan > localToUtc (118) and pubSend > pubBody > onTimes > segAt > pulseAt (106);
// these worked: runQueue > doPreview > repScan > pulseAt (104) and the 5-deep paths of main
// such as pubSend > pubBody > findWin > getWin > dec (~104). The limit is 104.
const STACK_LIMIT = 104;
// Nested groups in a condition crashed the whole device (a reboot, not a script error), so
// if / while conditions keep at most 2 levels of parentheses.
const COND_NEST = 2;
function condNesting(code) {
  const src = code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const re = /\b(if|while)\s*\(/g;
  let m,
    worst = 0,
    at = "";
  while ((m = re.exec(src))) {
    let i = re.lastIndex,
      d = 1,
      max = 1;
    while (d && i < src.length) {
      const c = src[i++];
      if (c === "(") max = Math.max(max, ++d);
      else if (c === ")") d--;
    }
    if (max > worst) {
      worst = max;
      at = src.slice(m.index, i).slice(0, 80);
    }
  }
  return [worst, at];
}
function stackWeights(code) {
  const out = {};
  const re = /function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(code))) {
    let i = re.lastIndex,
      d = 1;
    while (d && i < code.length) {
      const c = code[i++];
      if (c === "{") d++;
      else if (c === "}") d--;
    }
    const body = code.slice(re.lastIndex, i);
    let n = m[2].trim() ? m[2].split(",").length : 0;
    const lr = /\blet\s+([^;]*?)(;|\)|$)/gm;
    let x;
    while ((x = lr.exec(body))) {
      let dep = 0;
      n++;
      for (const c of x[1]) {
        if ("([{".includes(c)) dep++;
        else if (")]}".includes(c)) dep--;
        else if (c === "," && !dep) n++;
      }
    }
    out[m[1]] = n;
  }
  return out;
}
{
  const d = makeDevice();
  check(Object.keys(d.rpc).length <= 5, "rpc handlers " + Object.keys(d.rpc).length);
  check(d.timers.length === 1, "one repeating timer");
  check(d.endpoints.ui, "ui endpoint");
  const W = stackWeights(CODE);
  let depth = 0,
    maxDepth = 0,
    maxPath = [],
    weight = 0,
    maxW = 0,
    maxWPath = [],
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
      weight += 15 + (W[n] || 0);
      st.push(n);
      if (depth > maxDepth) {
        maxDepth = depth;
        maxPath = st.slice();
      }
      if (weight > maxW) {
        maxW = weight;
        maxWPath = st.slice();
      }
      try {
        return f.apply(this, arguments);
      } finally {
        depth--;
        weight -= 15 + (W[n] || 0);
        st.pop();
      }
    };
  }
  d.call("ShabbatPub", { u: "https://svc.example", i: "abcdefghjk", k: "k".repeat(24) });
  for (let t = 1762525200; t < 1762525200 + 2 * 86400; t += 600) {
    d.now = t;
    d.tick();
  }
  check(d.reqs.length >= 1, "T0 publishing exercised");
  d.call("ShabbatSet", {
    timers: [
      [1, 600, 30, 0, 0, 1],
      [0, 0, 60, 0, 0, 1],
      [1, 540, 5, 0, 0, 0]
    ],
    reps: [0, 0, [20, 600, 1]]
  });
  for (let t = 1762525200; t < 1762525200 + 2 * 86400; t += 600) {
    d.now = t;
    d.tick();
  }
  d.call("ShabbatPub", { send: true });
  d.flush();
  d.call("ShabbatPreview", { n: 8 });
  d.call("ShabbatPreview", { n: 3, timers: [[2, -60, 5, 0, 0, 0]], reps: [[20, 180, 1]] });
  d.call("ShabbatSet", { test: 1762597800 });
  d.call("ShabbatSet", { reload: true });
  d.call("ShabbatGet", {});
  check(maxDepth <= 5, "max JS call depth " + maxDepth + ": " + maxPath.join(" > "));
  check(maxW <= STACK_LIMIT, "stack weight " + maxW + ": " + maxWPath.join(" > "));
  const nest = condNesting(CODE);
  check(nest[0] <= COND_NEST, "condition nesting " + nest[0] + ": " + nest[1]);
  console.log(
    "T0 limits: rpc",
    Object.keys(d.rpc).join(","),
    "| max JS call depth",
    maxDepth,
    "(" + maxPath.join(" > ") + ")",
    "| stack weight",
    maxW,
    "(" + maxWPath.join(" > ") + ")"
  );
}

{
  // RPC handlers must only enqueue (the firmware calls them with little stack left)
  const d = makeDevice();
  let calls = 0;
  const wp = d.sb.segAt;
  d.sb.segAt = function () {
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

// ---------- T1: table decode & kinds; T2: local time (each reference place) ----------
for (const place of Object.keys(REF)) {
  useRef(place);
  const d = makeDevice({ dates: DATES[place] });
  const N = vm.runInContext("TBL_N", d.sb);
  check(N === ranges.length, `${place}: window count ${N} vs ${ranges.length}`);
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const w = vm.runInContext(`getWin(${i})`, d.sb);
    if (w.s !== ranges[i][0] || w.e !== ranges[i][1] || w.k !== ranges[i][3]) bad++;
  }
  check(bad === 0, place + ": window mismatches " + bad);
  check(d.getCodes === 2, place + ": header + windows, one read each: " + d.getCodes);
  const reads = d.getLens.slice(0, 2).join(",");
  check(/^1024,2\d{3}$/.test(reads), place + ": read sizes " + reads);
  let badT = 0;
  for (let t = 1735689600; t < 1924992000; t += 3 * 3600 + 17) {
    const p = localParts(t);
    if (vm.runInContext(`fmtTime(${t})`, d.sb) !== `${p.hour}:${p.minute}`) badT++;
  }
  check(badT === 0, `${place}: local time mismatches: ${badT}`);
  const g = d.call("ShabbatGet", {}).d;
  check(
    g.st.tz === REF[place].tz && g.st.loc.length > 0 && g.did === 3,
    place + ": place reported"
  );
  console.log(`T1/T2 ${place} (${REF[place].tz}): ${N} windows, kinds and local time 2025-2030 OK`);
}
useRef("pt");

// ---------- T1b: no table, a broken table, reading it again ----------
{
  const d = makeDevice({ dates: null, now: 1762597800 }); // Sat 08/11/2025 12:30
  d.tick();
  let g = d.call("ShabbatGet", {}).d;
  check(
    vm.runInContext("TBL_N", d.sb) === 0 && g.st.cur === null && g.st.next === null && !g.st.loc,
    "no shabbat_dates: no windows"
  );
  check(d.relay === false && g.st.end === 0 && g.did === -1, "no table -> relay off");
  check(d.call("ShabbatPreview", { n: 3 }).d.w.length === 0, "no table -> empty forecast");
  // the page writes the table, then asks the controller to read it again
  d.scripts.push({ id: 3, name: "shabbat_dates", code: Buffer.from(DATES.pt) });
  let answered = null;
  d.rpc.ShabbatSet(
    {
      result(x) {
        answered = JSON.parse(JSON.stringify(x));
      },
      error(c, m) {
        answered = { err: m };
      }
    },
    { reload: true }
  );
  check(answered === null, "reload: answered only after the read");
  d.flush();
  check(answered && answered.st && answered.st.cur && answered.did === 3, "reload: window now");
  check(d.relay === true, "reload: relay follows the new table (Sat 12:30 ON)");
  // a broken table is ignored: no windows
  d.scripts[2].code = Buffer.from("// shabbat_dates v1\n//N x\n//W ABC\n");
  d.call("ShabbatSet", { reload: true });
  g = d.call("ShabbatGet", {}).d;
  check(g.st.cur === null && vm.runInContext("TBL_N", d.sb) === 0, "broken table -> no windows");
  d.scripts[2].code = Buffer.from("console.log(1)");
  d.call("ShabbatSet", { reload: true });
  check(vm.runInContext("TBL_N", d.sb) === 0, "not a table -> no windows");
  // a header longer than one read, windows longer than one read
  const w = DATES.pt.match(/\n\/\/W (\S+)/)[1];
  const big = DATES.pt.replace("//W ", "//X " + "a".repeat(1500) + "\n//W ").replace(w, w + w);
  d.scripts[2].code = Buffer.from(big);
  d.getCodes = 0;
  d.getLens = [];
  d.call("ShabbatSet", { reload: true });
  check(
    vm.runInContext("TBL_N", d.sb) === 2 * ranges.length && d.getCodes === 5,
    "read in pieces: " + d.getLens.join(",")
  );
  // no trailing newline, or windows cut short: not a table
  d.scripts[2].code = Buffer.from(DATES.pt.trimEnd());
  d.call("ShabbatSet", { reload: true });
  check(vm.runInContext("TBL_N", d.sb) === 0, "no trailing newline -> no windows");
  // a skipped window stays skipped when the place changes (it is known by its start time)
  d.scripts[2].code = Buffer.from(DATES.pt);
  d.call("ShabbatSet", { reload: true });
  g = d.call("ShabbatSet", { skip: true }).d;
  const ptS = g.cfg.skip;
  check(ptS === g.st.cur.s && d.relay === false, "skipped the current window");
  d.scripts[2].code = Buffer.from(DATES.ny);
  g = d.call("ShabbatSet", { reload: true }).d;
  const nyS = REF.ny.w.find((x) => x[1] > ptS)[0];
  check(nyS !== ptS && g.cfg.skip === nyS, "the skip moved to New York's window: " + g.cfg.skip);
  check(JSON.parse(d.kvs.shabbat_elev_cfg).s === nyS, "and was saved");
  // a skip asked for while the table is read is refused (there are no windows to skip then)
  let busy = null;
  d.rpc.ShabbatSet({ result() {}, error() {} }, { reload: true });
  d.rpc.ShabbatSet({ result() {}, error: (c, m) => (busy = m) }, { skip: false });
  d.flush();
  check(/^busy/.test(busy || ""), "skip during the read: " + busy);
  check(d.call("ShabbatGet", {}).d.cfg.skip === nyS, "the skip is kept");
  d.call("ShabbatSet", { skip: false });
  // the relay is left alone while the table is read (no tick acts meanwhile)
  d.scripts[2].code = Buffer.from(DATES.pt);
  d.call("ShabbatSet", { reload: true });
  check(d.relay === true, "back to the table: ON");
  const sets = d.relaySets;
  d.rpc.ShabbatSet({ result() {}, error() {} }, { reload: true });
  d.timers[0]();
  check(d.relaySets === sets && d.relay === true, "tick during the read keeps the relay");
  d.flush();
  console.log("T1b no table / broken table / reload: OK");
}

// ---------- T3: relay sweep vs reference ----------
// reps: repeats saved with the timers; nWin: only the first nWin windows (repeats are slower)
function sweep(timers, label, skipIdx, place, reps, nWin) {
  useRef(place || "pt");
  const kvs = timers
    ? {
        shabbat_elev_cfg: JSON.stringify(
          Object.assign({ t: timers, a: 1, s: 0 }, reps && { r: reps })
        )
      }
    : {};
  const dev = makeDevice({ kvs, now: ranges[0][0] - 86400, dates: DATES[place || "pt"] });
  timers = timers || vm.runInContext("DEFAULT_TIMERS", dev.sb);
  let skip = 0;
  let mism = 0,
    onMin = 0,
    transitions = 0,
    prev = false;
  const t1 = ranges[Math.min(nWin || ranges.length, ranges.length) - 1][1] + 86400;
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
    const exp = refOn(t, timers, skip, reps);
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
  sweep(
    [
      [0, 30, 60, 0, 0, 1],
      [1, 600, 120, 0, 1, 1],
      [1, 540, 60, 2, 2, 1],
      [2, -30, 30, 0, 0, 1]
    ],
    "New York: two-day Yom Tov",
    undefined,
    "ny"
  );
  sweep(null, "Sydney: southern DST", undefined, "syd");
  useRef("pt");
}
// repeating timers: every anchor, clipped by the window and the length, overlapping a plain
// timer and touching it, Shabbat only, a disabled repeat, two-day Yom Tov and DST
const REP_T = [
  [0, 10, 3, 0, 0, 0],
  [1, 600, 5, 0, 0, 0],
  [1, 660, 30, 0, 0, 1],
  [2, -90, 10, 0, 0, 0],
  [1, 1320, 7, 1, 1, 0],
  [1, 900, 10, 0, 0, 0],
  [0, 60, 4, 0, 0, 0]
];
const REP_R = [
  [20, 240, 1],
  [15, 120, 1],
  0,
  [30, 180, 1],
  [25, 300, 1],
  [20, 60, 0],
  [17, 1440, 1]
];
sweep(REP_T, "repeats", 3, "pt", REP_R, process.env.QUICK ? 6 : 40);
if (!process.env.QUICK) sweep(REP_T, "repeats: New York", undefined, "ny", REP_R, 40);
useRef("pt");

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
  check(r.d.cfg.skip === 1762525500 || r.d.cfg.skip > 0, "skip set to next window");
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

// ---------- T8: repeating timers ----------
{
  const SAT = 1762596000; // Sat 08/11/2025 12:00 Israel (window 16:22 Fri -> 17:22 Sat)
  const dev = makeDevice({ now: SAT - 3600 });
  const T = [
    [1, 720, 30, 0, 0, 1],
    [1, 750, 5, 0, 0, 0]
  ];
  for (const bad of [
    [[20, 120, 1]], // reps one per timer
    [
      [20, 120, 1],
      [20, 120, 1]
    ], // the repeating timer must be stored disabled
    [0, [5, 120, 1]], // every must be longer than the duration
    [0, [4, 120, 1]],
    [0, [721, 120, 1]],
    [0, [20, 1441, 1]],
    [0, [20, 0, 1]],
    [0, [20, 120, 2]],
    [0, [20, 120]],
    [0, [20.5, 120, 1]],
    "x"
  ]) {
    const r = dev.call("ShabbatSet", { timers: T, reps: bad });
    check(!r.ok, "rejects reps " + JSON.stringify(bad));
  }
  check(
    !dev.call("ShabbatSet", { timers: [[1, 750, 0, 0, 0, 0]], reps: [[20, 120, 1]] }).ok,
    "rejects a repeat of duration 0"
  );
  let r = dev.call("ShabbatSet", { timers: T, reps: [0, [20, 120, 1]] });
  const saved = JSON.parse(dev.kvs.shabbat_elev_cfg);
  check(r.ok && JSON.stringify(r.d.cfg.reps) === "[0,[20,120,1]]", "reps returned");
  check(saved.t[1][5] === 0 && JSON.stringify(saved.r) === "[0,[20,120,1]]", "saved: t + r");
  // what an older release reads: the timer is disabled, so it never turns on
  check(
    saved.t.every((v) => v.length === 6 && v.every(Number.isInteger)),
    "older releases still accept the timers"
  );
  // 12:00-12:30 plain; pulses 12:30-12:35 (touches), 12:50, 13:10 ... 14:10 (5 min each)
  dev.now = SAT + 600;
  dev.tick();
  let g = dev.call("ShabbatGet", {}).d;
  check(
    dev.relay && g.st.on[1] === SAT + 2100 && g.st.on[2] === "1+2",
    "touching pulse extends the ON stretch: " + JSON.stringify(g.st.on)
  );
  check(dev.toggleAfter === 1500 + 5, "auto-off at the end of the stretch: " + dev.toggleAfter);
  dev.now = SAT + 2200; // 12:36:40
  dev.tick();
  g = dev.call("ShabbatGet", {}).d;
  check(
    !dev.relay && JSON.stringify(g.st.nextOn) === JSON.stringify([SAT + 3000, SAT + 3300, "2"]),
    "between pulses: OFF, next pulse 12:50"
  );
  dev.now = SAT + 3060;
  dev.tick();
  check(dev.relay && dev.toggleAfter === 240 + 5, "pulse ON with auto-off");
  // preview: one line per repeat
  const pv = dev.call("ShabbatPreview", { n: 1, from: SAT - 3600 }).d.w[0];
  check(
    JSON.stringify(pv.rp) === JSON.stringify([[SAT + 1800, SAT + 8100, "2", 20, 5]]) &&
      pv.on.length === 1,
    "preview repeat block: " + JSON.stringify(pv.rp)
  );
  // a draft without reps clears them; the stored copy has no r
  dev.call("ShabbatSet", { timers: T.slice(0, 1) });
  check(!("r" in JSON.parse(dev.kvs.shabbat_elev_cfg)), "no repeats: no r saved");
  // survives a reboot; an invalid r alone is dropped, the timers kept
  dev.call("ShabbatSet", { timers: T, reps: [0, [20, 120, 1]] });
  const dev2 = makeDevice({ kvs: dev.kvs, now: SAT + 3060 });
  dev2.tick();
  check(dev2.relay && dev2.call("ShabbatGet", {}).d.cfg.reps.length === 2, "reps survive reboot");
  const kv = JSON.parse(dev.kvs.shabbat_elev_cfg);
  kv.r = [0, [3, 120, 1]];
  const dev3 = makeDevice({ kvs: { shabbat_elev_cfg: JSON.stringify(kv) }, now: SAT + 3060 });
  g = dev3.call("ShabbatGet", {}).d;
  check(g.cfg.timers.length === 2 && g.cfg.reps.length === 0, "bad r dropped, timers kept");
  // KVS space: a typical set with repeats fits, too many is refused
  const T4 = [
    [0, 15, 3, 0, 0, 0],
    [1, 600, 5, 0, 0, 0],
    [2, -40, 10, 0, 0, 0],
    [1, 720, 60, 0, 0, 1]
  ];
  r = dev.call("ShabbatSet", {
    timers: T4,
    reps: [[20, 1440, 1], [15, 240, 1], [30, 180, 1], 0]
  });
  check(r.ok && dev.kvs.shabbat_elev_cfg.length <= 253, "4 timers with repeats fit KVS");
  const T12 = Array.from({ length: 12 }, () => [1, 600, 5, 0, 0, 0]);
  r = dev.call("ShabbatSet", { timers: T12, reps: T12.map(() => [20, 1440, 1]) });
  check(!r.ok && r.msg === "too many timers", "12 repeating timers: too long for KVS");
  // refused settings are not used either (they used to stay in RAM until the restart)
  g = dev.call("ShabbatGet", {}).d;
  check(
    g.cfg.timers.length === 4 && g.cfg.reps.length === 4 && g.cfg.auto === true,
    "refused timers are not in use: " + JSON.stringify(g.cfg)
  );
  r = dev.call("ShabbatSet", { timers: T12, reps: T12.map(() => [20, 1440, 1]), auto: false });
  g = dev.call("ShabbatGet", {}).d;
  check(!r.ok && g.cfg.auto === true && g.cfg.timers.length === 4, "refused whole, auto too");
  // 12 long timers fit, but not with a skipped window as well: the skip is refused, not half set
  const T12b = Array.from({ length: 12 }, (x, i) => [1, 1200 + i, 120, 0, 0, 1]);
  r = dev.call("ShabbatSet", { timers: T12b });
  check(r.ok && r.d.cfg.timers.length === 12, "12 long timers fit");
  r = dev.call("ShabbatSet", { skip: true });
  g = dev.call("ShabbatGet", {}).d;
  check(!r.ok && g.cfg.skip === 0, "skip that does not fit is refused: " + g.cfg.skip);
  console.log("T8 repeating timers: validation, relay, auto-off, preview, save, reboot: OK");
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
  // the log is saved at most every 30 minutes (flash wear); the page gets it from memory
  check(dev.kvs.shabbat_elev_log !== g.log, "the last events are not saved yet");
  for (let i = 0; i < 120; i++) dev.tick();
  check(dev.kvs.shabbat_elev_log === g.log, "log saved to KVS");
  {
    // a timer that repeats every 5 minutes for a day: ~250 switches, few saves
    const d = makeDevice({ now: 1762700000 });
    d.call("ShabbatSet", { timers: [[0, 0, 2, 0, 0, 0]], reps: [[5, 1440, 1]] });
    d.logSets = 0;
    const n0 = d.relaySets;
    for (let t = 1763130000; t < 1763130000 + 86400; t += 15) {
      d.now = t; // Fri 14/11/2025 16:20 Israel, a day on
      d.tick();
    }
    check(d.relaySets - n0 > 400, "the repeat switched: " + (d.relaySets - n0));
    check(d.logSets > 10 && d.logSets <= 49, "log saves in a day of repeats: " + d.logSets);
  }
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
  // a Switch.Set that fails is tried again; it is not a manual switch, and not in the log
  {
    const d = makeDevice({ now: 1762700000 }); // Sunday: OFF
    d.swErr = true;
    d.now = SAT1200 + 60;
    d.tick();
    let s = d.call("ShabbatGet", {}).d;
    check(
      d.relay === false && s.st.manual === false && s.log === "",
      "failed Switch.Set: " + s.log
    );
    d.now += 15;
    d.tick();
    check(d.call("ShabbatGet", {}).d.st.manual === false, "still not a manual hold");
    d.swErr = false;
    d.now += 15;
    d.tick();
    s = d.call("ShabbatGet", {}).d;
    check(d.relay === true && /^\d+1a$/.test(s.log), "tried again, ON, logged once: " + s.log);
    check(d.toggleAfter === SAT1300 - d.now + 5, "with the firmware auto-off");
    // a tick before the Switch.Set is answered leaves the relay alone
    const d2 = makeDevice({ now: 1762700000 }); // Sunday: OFF
    d2.now = SAT1200 + 60;
    d2.timers[0](); // asks for ON; not answered yet
    const sets = d2.pending.length;
    d2.timers[0]();
    check(d2.pending.length === sets, "no second Switch.Set while one is on its way");
    d2.flush();
    d2.tick();
    s = d2.call("ShabbatGet", {}).d;
    check(d2.relay === true && s.st.manual === false, "ON, no manual hold");
  }
  // test time: no firmware auto-off (simulated clock does not advance)
  dev.call("ShabbatSet", { test: SAT1200 + 60 });
  check(dev.relay === true && dev.toggleAfter === undefined, "no toggle_after in test mode");
  console.log("T6 auto-off, manual hold, log: OK");
}

// ---------- T7: publishing to the schedule service ----------
{
  const FRI = 1793961000; // Fri 06/11/2026 12:30 Israel
  const dev = makeDevice({ now: FRI });
  dev.tick();
  check(dev.reqs.length === 0, "nothing sent before publishing is set up");
  let r = dev.call("ShabbatPub", {});
  check(r.ok && r.d.on === false, "pub state off");
  for (const bad of [
    { u: "ftp://x.example", i: "abcdefghij", k: "k".repeat(24) },
    { u: "http://x.example", i: "abcdefghij", k: "k".repeat(24) }, // the key would go in clear
    { u: "https://x.example", i: "ab", k: "k".repeat(24) },
    { u: "https://x.example", i: "abcdefghij", k: "short" },
    { u: 'https://x.example/"', i: "abcdefghij", k: "k".repeat(24) },
    { u: "https://x.example", i: "abc defghij", k: "k".repeat(24) }
  ]) {
    r = dev.call("ShabbatPub", bad);
    check(!r.ok, "rejects pub settings " + JSON.stringify(bad));
  }
  const P = { u: "https://svc.example", i: "abcdefghjk", k: "Key_-0123456789abcdefghij" };
  r = dev.call("ShabbatPub", P);
  check(r.ok && r.d.on && r.d.i === P.i && r.d.k === P.k, "pub set up");
  check(JSON.parse(dev.kvs.shabbat_pub).i === P.i, "pub saved to KVS");
  dev.flush();
  check(dev.reqs.length === 1, "sent right away: " + dev.reqs.length);
  let q = dev.reqs[0];
  check(
    q.method === "PUT" &&
      q.url === "https://svc.example/api/s/abcdefghjk" &&
      q.headers.Authorization === "Bearer " + P.k,
    "request: " + q.method + " " + q.url
  );
  let b = JSON.parse(q.body);
  const pv = dev.call("ShabbatPreview", { n: 6 }).d.w;
  check(
    b.v === 1 && b.now === FRI && b.auto === 1 && b.tz === "Asia/Jerusalem" && b.w.length === 6,
    "body header"
  );
  check(
    b.w.every(
      (w, i) =>
        w.s === pv[i].s &&
        w.e === pv[i].e &&
        w.t === pv[i].t &&
        w.k === pv[i].k &&
        w.x === 0 &&
        JSON.stringify(w.on) === JSON.stringify(pv[i].on.map((o) => [o[0], o[1]]))
    ),
    "body windows match the forecast"
  );
  check(b.w[0].s === 1793975160 && b.w[0].on.length === 3, "next Shabbat with 3 ON times");
  check(q.body.length < 2000, "body size " + q.body.length);
  r = dev.call("ShabbatPub", {});
  check(r.d.ok === FRI && r.d.err === "" && r.d.due >= FRI + 82800, "ok, next send in ~a day");
  // nothing more until a change or the next day
  for (let t = FRI; t < FRI + 3600; t += 15) {
    dev.now = t;
    dev.tick();
  }
  check(dev.reqs.length === 1, "no resend within the hour");
  // a settings change is sent ~30 s later; test time does not change what is sent
  dev.call("ShabbatSet", { skip: true, test: 1794045600 });
  dev.tick();
  check(dev.reqs.length === 1, "change not sent at once");
  dev.now += 45;
  dev.tick();
  check(dev.reqs.length === 2, "change sent after ~30 s");
  b = JSON.parse(dev.reqs[1].body);
  check(b.w[0].x === 1 && b.w[0].on.length === 0 && b.now === dev.now, "skip sent, real time");
  dev.call("ShabbatSet", { skip: false, test: 0 });
  // failures back off
  dev.httpReply = { code: 503, message: "Service Unavailable", body: "" };
  const t0 = dev.now + 45;
  dev.now = t0;
  dev.tick();
  check(dev.reqs.length === 3, "sent after unskip");
  r = dev.call("ShabbatPub", {});
  check(r.d.err === "HTTP 503" && r.d.due === t0 + 300 && r.d.ok < t0, "503 -> retry in 5 min");
  dev.httpReply = null;
  dev.httpErr = -104;
  dev.now = t0 + 301;
  dev.tick();
  r = dev.call("ShabbatPub", {});
  check(dev.reqs.length === 4 && r.d.due === t0 + 301 + 1200, "timeout -> retry in 20 min");
  dev.httpErr = 0;
  dev.httpReply = { code: 204, message: "No Content", body: "" };
  dev.call("ShabbatPub", { send: true });
  r = dev.call("ShabbatPub", {});
  check(dev.reqs.length === 5 && r.d.err === "" && r.d.ok === t0 + 301, "send now");
  // a change while a send is on its way is sent after it, not a day later
  dev.httpHold = true;
  dev.call("ShabbatPub", { send: true });
  check(dev.reqs.length === 6 && dev.call("ShabbatPub", {}).d.busy, "a send on its way");
  dev.call("ShabbatSet", { skip: true });
  dev.httpHold = false;
  dev.held();
  dev.flush();
  r = dev.call("ShabbatPub", {});
  check(r.d.due === dev.now + 30, "change during a send: sent again in 30 s, due " + r.d.due);
  dev.now += 45;
  dev.tick();
  check(dev.reqs.length === 7 && JSON.parse(dev.reqs[6].body).w[0].x === 1, "the change was sent");
  check(dev.call("ShabbatPub", {}).d.due >= dev.now + 82800, "then daily again");
  dev.call("ShabbatSet", { skip: false });
  dev.now += 45;
  dev.tick();
  // reboot keeps the settings and sends once the clock is synced
  const dev2 = makeDevice({ kvs: dev.kvs, now: 0 });
  dev2.tick();
  check(dev2.reqs.length === 0, "not sent before clock sync");
  dev2.now = FRI;
  dev2.tick();
  check(dev2.reqs.length === 1 && dev2.reqs[0].url === q.url, "sent after reboot");
  // stop
  r = dev.call("ShabbatPub", { off: true });
  check(r.ok && !r.d.on && !("shabbat_pub" in dev.kvs), "stopped, KVS key removed");
  dev.now += 2 * 86400;
  dev.tick();
  check(dev.reqs.length === 8, "nothing sent after stop");
  // 12 worst-case timers still fit one request
  const tl = Array.from({ length: 12 }, (_, i) => [1, i * 120, 30, 0, 0, 1]);
  const dev3 = makeDevice({
    kvs: {
      shabbat_elev_cfg: JSON.stringify({ t: tl, a: 1, s: 0 }),
      shabbat_pub: JSON.stringify(P)
    },
    now: FRI
  });
  dev3.tick();
  check(dev3.reqs.length === 1, "12 timers: sent");
  // 12 timers on every day of the three-day Yom Tov windows of Tishrei 5787 abroad: more
  // than 24 ON times in a window (the service takes 48, test/service_test.mjs), and the body
  // stays within the service's 4 KB by sending fewer windows
  {
    const many = Array.from({ length: 12 }, (_, i) => [1, i * 115, 5, 0, 0, 1]);
    const d = makeDevice({
      kvs: {
        shabbat_elev_cfg: JSON.stringify({ t: many, a: 1, s: 0 }),
        shabbat_pub: JSON.stringify(P)
      },
      now: 1789000000, // Thu 10/09/2026, before Rosh Hashana
      dates: DATES.ny
    });
    d.tick();
    const body = d.reqs[0].body,
      bb = JSON.parse(body);
    const most = Math.max(...bb.w.map((w) => w.on.length));
    check(most > 24 && most <= 48, "ON times in the longest window: " + most);
    check(body.length <= 4096 && bb.w.length >= 3 && bb.w.length < 6, "body " + body.length);
    console.log("   many ON times:", bb.w.map((w) => w.on.length).join(" "), body.length);
  }
  // repeating timers: v 2, the repeats in short
  const dev4 = makeDevice({
    kvs: {
      shabbat_elev_cfg: JSON.stringify({
        t: [
          [1, 720, 60, 0, 0, 1],
          [1, 600, 5, 0, 0, 0]
        ],
        a: 1,
        s: 0,
        r: [0, [20, 240, 1]]
      }),
      shabbat_pub: JSON.stringify(P)
    },
    now: FRI
  });
  dev4.tick();
  const b4 = JSON.parse(dev4.reqs[0].body);
  const pv4 = dev4.call("ShabbatPreview", { n: 6 }).d.w;
  check(
    b4.v === 2 &&
      b4.w.every(
        (w, i) =>
          JSON.stringify(w.rp) === JSON.stringify(pv4[i].rp.map((o) => [o[0], o[1], o[3], o[4]]))
      ) &&
      b4.w[0].rp.length === 1 &&
      b4.w[0].on.length === 1,
    "v 2 body: repeats in short " + JSON.stringify(b4.w[0].rp)
  );
  console.log(
    "T7 publishing: OK (body " +
      q.body.length +
      " bytes, 12 timers " +
      dev3.reqs[0].body.length +
      ")"
  );
}

// ---------- T5: UI loader page ----------
{
  const dev = makeDevice();
  const r = dev.http("ui");
  check(
    r.code === 200 && /window\.SE_ID=1;/.test(r.body) && /shabbat_ui/.test(r.body),
    "ui loader page"
  );
  check(/window\.SE_UI=2;/.test(r.body), "page script id looked up at boot (SE_UI=2)");
  console.log("T5 UI loader:", r.body.length, "bytes");
}

// ---------- T7: debug / diag flags (FLAGS=1) ----------
if (process.env.FLAGS) {
  const dev = makeDevice();
  check(vm.runInContext("CFG.debug && CFG.diag", dev.sb) === true, "flags on");
  const logs = dev.log.join("\n");
  check(
    /\[diag\] boot step/.test(logs) && /\[diag\].*mem_used=/.test(logs),
    "diag boot + memory logs"
  );
  dev.tick();
  check(/\[dbg\] tick/.test(dev.log.join("\n")), "debug tick log");
  console.log("T7 flags on: debug + diag logs OK");
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL TESTS PASSED");
process.exit(fails ? 1 : 0);
