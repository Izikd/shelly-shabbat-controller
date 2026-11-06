// Fake Shelly for UI testing: runs dist/shabbat_controller.js in a VM with mocked
// script APIs and serves the endpoints the browser uses:
//   GET  /script/1/ui            loader page (from the script's HTTPServer endpoint)
//   GET  /rpc/Script.List        -> script 1 + "shabbat_ui" (id 2)
//   GET  /rpc/Script.GetCode     -> dist/shabbat_ui.js in 2000-byte chunks
//   POST /rpc/Script.Shabbat*    -> the script's RPC handlers
//   Script.PutCode / Stop / Start / GetStatus, like the device: a running script's code cannot
//   be replaced, and Start runs the uploaded code in a fresh VM (KVS kept)
// Params come from the query string or a JSON body, as on the device.
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
const dev = { relay: false, kvs: {}, rpc: {}, endpoints: {}, pending: [], timers: [] };
// stored script code (bytes) and state; script 1 is the controller
const scripts = {
  1: { name: "shabbat_controller", code: Buffer.from(CODE, "utf8"), running: true, enable: true },
  2: { name: "shabbat_ui", code: Buffer.from(UI, "utf8"), running: false, enable: false }
};
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
      else if (m === "Script.List")
        res = {
          scripts: [
            { id: 1, name: "shabbat_controller" },
            { id: 2, name: "shabbat_ui" }
          ]
        };
      else if (m === "Switch.Set") {
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
http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
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
      if (u.pathname === "/rpc/Script.List")
        return json(res, 200, {
          scripts: Object.keys(scripts).map((id) => ({
            id: +id,
            name: scripts[id].name,
            enable: scripts[id].enable,
            running: scripts[id].running
          }))
        });
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
        const src = sc.code;
        // like the device: byte ranges, a UTF-8 character split across ranges comes back as
        // U+FFFD. Large reads rebooted a real Pro 1, so refuse any read without a small len.
        const len = +params.len;
        if (!len || len > 8192) return json(res, 400, { code: -103, message: "read too large" });
        let off = +params.offset || 0,
          end = Math.min(src.length, off + len);
        if (off > src.length)
          return json(res, 200, {
            code: -103,
            message: "Invalid argument 'offset': Exceeds file size!"
          });
        const chunk = src.subarray(off, end);
        return json(res, 200, { data: chunk.toString("utf8"), left: src.length - end });
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
  })
  .listen(port, () =>
    console.log(
      "mock Shelly on http://localhost:" + port + "/script/1/ui  now=" + now + " relay=" + dev.relay
    )
  );
