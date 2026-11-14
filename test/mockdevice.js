// SPDX-License-Identifier: MIT
// Fake Shelly for UI testing: runs dist/shabbat_controller.js in a VM with mocked
// script APIs and serves the endpoints the browser uses:
//   GET  /script/1/ui            loader page (from the script's HTTPServer endpoint)
//   GET  /rpc/Script.List        -> script 1 + "shabbat_ui" (id 2) + "shabbat_dates" (id 3,
//                                   test/dates/pt.txt; MOCK_DATES=none starts without it)
//   GET  /rpc/Script.GetCode     -> byte ranges of a script's code (also from the script)
//   POST /rpc/Script.Create      -> a new stopped script, like the device
//   POST /rpc/Script.Shabbat*    -> the script's RPC handlers
//   Script.PutCode / Stop / Start / GetStatus, like the device: a running script's code cannot
//   be replaced, and Start runs the uploaded code in a fresh VM (KVS kept)
// Params come from the query string or a JSON body, as on the device.
// It also runs the schedule service (service/src, in-memory database) on port + 1, and the
// script's HTTP.Request calls to the real service address (PUB_URL in src/ui.js) go there.
// Connections: like a busy device (other pages, apps and tabs hold most of its few
// connections, docs/device/network.md), it serves at most MOCK_FREE_CONN requests at once
// (default 3), each taking MOCK_LATENCY_MS (default 40); a request beyond that is refused,
// alternately by dropping the connection (a browser on the LAN: "Failed to fetch") and with
// a proxy's HTML 502 page (through a tunnel). GET /mock/stats -> {refused, maxInFlight};
// GET /mock/refuse?n=3 refuses the next 3 RPC requests whatever the load.
// Usage: node test/mockdevice.js [port] [unix-time] [version stamped into the controller]
"use strict";
const fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  http = require("http");
const { restamp } = require("./stamp");
const ROOT = path.join(__dirname, "..");
if (!fs.existsSync(path.join(ROOT, "dist/shabbat_ui.js")))
  throw new Error("dist/ missing - run `npm run build` (or `npm test`)");
let CODE = fs.readFileSync(path.join(ROOT, "dist/shabbat_controller.js"), "utf8");
// pretend an installed release, e.g. v0.1.0 (the update test)
let UI = fs.readFileSync(path.join(ROOT, "dist/shabbat_ui.js"), "utf8");
if (process.argv[4]) {
  CODE = restamp(CODE, process.argv[4]);
  UI = restamp(UI, process.argv[4]);
}
const port = +process.argv[2] || 8099;
let now = +process.argv[3] || Math.floor(Date.now() / 1000);
const PUB_URL = fs
  .readFileSync(path.join(ROOT, "src/ui.js"), "utf8")
  .match(/PUB_URL = "([^"]+)"/)[1];
const SVC = "http://localhost:" + (port + 1);
const dev = { relay: false, kvs: {}, rpc: {}, endpoints: {}, pending: [], timers: [] };
// saved timers, as on a device in use (the controller has none of its own); MOCK_TIMERS=none
// is a new device
if (process.env.MOCK_TIMERS !== "none")
  dev.kvs.shabbat_elev_cfg = JSON.stringify({
    t: [
      [0, 15, 30, 0, 0, 1],
      [1, 720, 60, 0, 0, 1],
      [2, -40, 40, 0, 0, 1]
    ],
    a: 1,
    s: 0
  });
// stored script code (bytes) and state; script 1 is the controller
const scripts = {
  1: { name: "shabbat_controller", code: Buffer.from(CODE, "utf8"), running: true, enable: true },
  2: { name: "shabbat_ui", code: Buffer.from(UI, "utf8"), running: false, enable: false }
};
if (process.env.MOCK_DATES !== "none")
  scripts[3] = {
    name: "shabbat_dates",
    code: fs.readFileSync(path.join(ROOT, "test/dates", (process.env.MOCK_DATES || "pt") + ".txt")),
    running: false,
    enable: false
  };
const scriptList = () =>
  Object.keys(scripts).map((id) => ({
    id: +id,
    name: scripts[id].name,
    enable: scripts[id].enable,
    running: scripts[id].running
  }));
// Script.GetCode as on the device: byte ranges; a UTF-8 character split across ranges comes
// back as U+FFFD; large reads rebooted a real Pro 1, so a read without a small len is refused
function getCode(params) {
  const sc = scripts[params.id];
  if (!sc) return { err: -105, message: "Argument 'id', value " + params.id + " not found!" };
  const len = +params.len;
  if (!len || len > 8192) return { err: -103, message: "read too large" };
  const src = sc.code,
    off = +params.offset || 0,
    end = Math.min(src.length, off + len);
  if (off > src.length)
    return { err: -103, message: "Invalid argument 'offset': Exceeds file size!" };
  return { res: { data: src.subarray(off, end).toString("utf8"), left: src.length - end } };
}
const flush = () => {
  let n = 0;
  while (dev.pending.length && n++ < 5000) dev.pending.shift()();
};
const makeSandbox = () => ({
  console: { log: (...a) => console.log("[script]", ...a) },
  Shelly: {
    getComponentStatus(t) {
      if (t === "sys") return { unixtime: now, utc_offset: 7200 };
      if (t === "switch")
        return { output: dev.relay, source: dev.src || "init", tag: dev.tag || null };
      return { mem_used: 1, mem_peak: 1, mem_free: 1 };
    },
    getComponentConfig() {
      return null;
    },
    call(m, p, cb) {
      let res = {},
        err = 0;
      if (m === "KVS.Get") {
        if (p.key in dev.kvs) res = { value: dev.kvs[p.key] };
        else err = -105;
      } else if (m === "KVS.Set") dev.kvs[p.key] = p.value;
      else if (m === "KVS.Delete") delete dev.kvs[p.key];
      else if (m === "HTTP.Request") {
        const url = p.url.indexOf(PUB_URL) === 0 ? SVC + p.url.slice(PUB_URL.length) : p.url;
        fetch(url, { method: p.method, headers: p.headers, body: p.body })
          .then((r) => r.text().then((body) => ({ code: r.status, message: r.statusText, body })))
          .then(
            (r) => cb && cb(r, 0, ""),
            (e) => cb && cb(null, -114, "" + e)
          )
          .then(flush);
        return;
      } else if (m === "Script.List") res = { scripts: scriptList() };
      else if (m === "Script.GetCode") {
        const r = getCode(p);
        res = r.res || null;
        err = r.err || 0;
      } else if (m === "Switch.Set") {
        dev.relay = p.on;
        dev.src = "loopback";
        dev.tag = p.tag;
      }
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
    addRpcHandler(n, cb) {
      dev.rpc[n] = cb;
      return 1;
    }
  },
  HTTPServer: {
    registerEndpoint(n, cb) {
      dev.endpoints[n] = cb;
    }
  }
});
// (re)start the controller: a fresh VM, like Script.Start on the device
function startController() {
  Object.assign(dev, { rpc: {}, endpoints: {}, pending: [], timers: [] });
  const sb = makeSandbox();
  vm.createContext(sb);
  vm.runInContext("delete Array.prototype.sort;", sb);
  try {
    vm.runInContext(scripts[1].code.toString("utf8"), sb);
  } catch (e) {
    console.log("[mock] controller failed to start:", e.message);
    return false;
  }
  scripts[1].running = true;
  flush();
  return true;
}
startController();
setInterval(() => {
  now += 15;
  dev.timers.forEach((f) => f());
  flush();
}, 15000);

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
// the schedule service, as on Cloudflare (service/src) with an in-memory D1
Promise.all([import("../service/src/index.js"), import("./fake_d1.mjs")]).then(([svc, d1]) => {
  const env = { DB: d1.fakeD1() };
  http
    .createServer((req, res) => {
      let body = [];
      req.on("data", (c) => body.push(c));
      req.on("end", async () => {
        const hasBody = req.method !== "GET" && req.method !== "HEAD";
        const r = await svc.route(
          new Request(SVC + req.url, {
            method: req.method,
            headers: req.headers,
            body: hasBody ? Buffer.concat(body) : undefined
          }),
          env,
          now
        );
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
      });
    })
    .listen(port + 1);
});

const FREE_CONN = +(process.env.MOCK_FREE_CONN || 3);
const LATENCY = +(process.env.MOCK_LATENCY_MS || 40);
const conn = { inFlight: 0, maxInFlight: 0, refused: 0, refuseNext: 0 };
function refuse(req, res) {
  conn.refused++;
  if (conn.refused % 2) return req.socket.destroy();
  res.writeHead(502, { "Content-Type": "text/html; charset=UTF-8" });
  res.end(
    "<!DOCTYPE html><html><head><title>502 Bad gateway</title></head><body>error code: 502</body></html>"
  );
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/mock/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ refused: conn.refused, maxInFlight: conn.maxInFlight }));
    }
    if (u.pathname === "/mock/refuse") {
      conn.refuseNext = +u.searchParams.get("n") || 0;
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("{}");
    }
    if (conn.refuseNext > 0 && u.pathname.startsWith("/rpc/")) {
      conn.refuseNext--;
      return refuse(req, res);
    }
    if (conn.inFlight >= FREE_CONN) return refuse(req, res);
    conn.inFlight++;
    if (conn.inFlight > conn.maxInFlight) conn.maxInFlight = conn.inFlight;
    res.on("close", () => conn.inFlight--);
    setTimeout(() => serve(req, res, u), LATENCY);
  })
  .listen(port, () =>
    console.log(
      "mock Shelly on http://localhost:" + port + "/script/1/ui  now=" + now + " relay=" + dev.relay
    )
  );

function serve(req, res, u) {
  {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // RPC params: query string or JSON body (both work on the device)
      let params = Object.fromEntries(u.searchParams);
      try {
        if (body) params = Object.assign(params, JSON.parse(body));
      } catch (e) {}
      if (u.pathname === "/script/1/ui") {
        if (!scripts[1].running || !dev.endpoints.ui) return json(res, 404, { code: 404 });
        let out;
        dev.endpoints.ui(
          { method: "GET" },
          {
            send() {
              out = this;
            }
          }
        );
        res.writeHead(out.code, Object.fromEntries(out.headers));
        res.end(out.body);
        return;
      }
      if (u.pathname === "/rpc/Shelly.GetDeviceInfo")
        return json(res, 200, { id: "shellypro1-mock", model: "SPSW-201XE15UL", ver: "2.0.3" });
      if (u.pathname === "/rpc/Sys.GetStatus")
        return json(res, 200, {
          uptime: 98765,
          last_sync_ts: now - 300,
          ram_size: 266592, // values from a real Pro 1
          ram_free: 96996,
          fs_size: 524288,
          fs_free: 94208,
          unixtime: now
        });
      if (u.pathname === "/rpc/Script.GetStatus")
        return json(res, 200, {
          id: +params.id,
          running: !!(scripts[params.id] && scripts[params.id].running),
          mem_used: 15890,
          mem_peak: 21800,
          mem_free: 8400
        });
      if (u.pathname === "/rpc/Switch.GetStatus")
        return json(res, 200, {
          id: 0,
          output: dev.relay,
          source: dev.src || "init",
          tag: dev.tag || null,
          temperature: { tC: 33.1 }
        });
      if (u.pathname === "/rpc/Switch.Set") {
        dev.relay = u.searchParams.get("on") === "true";
        dev.src = "WS_in";
        dev.tag = null;
        return json(res, 200, { was_on: !dev.relay });
      }
      // firmware KVS, shared with the script (the page keeps its beta choice there)
      if (u.pathname === "/rpc/KVS.Get")
        return params.key in dev.kvs
          ? json(res, 200, { value: dev.kvs[params.key] })
          : json(res, 500, { code: -105, message: "Argument 'key', value not found!" });
      if (u.pathname === "/rpc/KVS.GetMany") {
        // the list form of the docs' example; `match` taken literally (no wildcards here)
        const keys = Object.keys(dev.kvs).filter((k) => !params.match || k === params.match);
        return json(res, 200, {
          items: keys.map((k) => ({ key: k, etag: "x", value: dev.kvs[k] })),
          offset: 0,
          total: keys.length
        });
      }
      if (u.pathname === "/rpc/KVS.Set") {
        dev.kvs[params.key] = String(params.value);
        return json(res, 200, {});
      }
      if (u.pathname === "/rpc/Script.List") return json(res, 200, { scripts: scriptList() });
      if (u.pathname === "/rpc/Script.Create") {
        const id = Math.max(...Object.keys(scripts).map(Number)) + 1;
        scripts[id] = {
          name: params.name || "script_" + id,
          code: Buffer.alloc(0),
          running: false,
          enable: false
        };
        return json(res, 200, { id });
      }
      const sc = scripts[params.id];
      if (/^\/rpc\/Script\.(GetCode|PutCode|Stop|Start)$/.test(u.pathname) && !sc)
        return json(res, 500, {
          code: -105,
          message: "Argument 'id', value " + params.id + " not found!"
        });
      if (u.pathname === "/rpc/Script.PutCode") {
        // the code of a running script cannot be replaced (Shelly docs)
        if (sc.running) return json(res, 500, { code: -103, message: "Script is running" });
        if (typeof params.code !== "string")
          return json(res, 500, { code: -103, message: "Missing or bad argument 'code'!" });
        const piece = Buffer.from(params.code, "utf8");
        sc.code = params.append ? Buffer.concat([sc.code, piece]) : piece;
        return json(res, 200, { len: sc.code.length });
      }
      if (u.pathname === "/rpc/Script.Stop") {
        const was = sc.running;
        sc.running = false;
        if (+params.id === 1)
          Object.assign(dev, { rpc: {}, endpoints: {}, pending: [], timers: [] });
        return json(res, 200, { was_running: was });
      }
      if (u.pathname === "/rpc/Script.Start") {
        if (+params.id !== 1) return json(res, 500, { code: -103, message: "not in the mock" });
        if (sc.running) return json(res, 200, { was_running: true });
        // what a Pro 1 (fw 2.0.3) answers for code that does not parse
        if (!startController()) return json(res, 500, { code: -2, message: "syntax_error" });
        return json(res, 200, { was_running: false });
      }
      if (u.pathname === "/rpc/Script.GetCode") {
        const r = getCode(params);
        if (r.res) return json(res, 200, r.res);
        // what the device answers: HTTP 400 for a bad len, 200 with an error past the end
        return json(res, r.err === -103 && /large/.test(r.message) ? 400 : 200, {
          code: r.err,
          message: r.message
        });
      }
      const m = u.pathname.match(/^\/rpc\/Script\.(Shabbat\w+)$/);
      if (m && scripts[1].running && dev.rpc[m[1]]) {
        dev.rpc[m[1]](
          {
            result(d) {
              json(res, 200, d);
            },
            error(c, msg) {
              json(res, 500, { code: c, message: msg });
            }
          },
          params
        );
        flush();
        return;
      }
      // like the device: a stopped script's RPC methods are gone
      if (m) return json(res, 404, { code: 404, message: "No handler for Script." + m[1] });
      json(res, 404, { code: 404, message: "not found" });
    });
  }
}
