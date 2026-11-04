// Fake Shelly for UI testing: runs dist/shabbat_controller.js in a VM with mocked
// script APIs and serves the endpoints the browser uses:
//   GET  /script/1/ui            loader page (from the script's HTTPServer endpoint)
//   GET  /rpc/Script.List        -> script 1 + "shabbat_ui" (id 2)
//   GET  /rpc/Script.GetCode     -> dist/shabbat_ui.js in 2000-byte chunks
//   POST /rpc/Script.Shabbat*    -> the script's RPC handlers
// Usage: node test/mockdevice.js [port] [unix-time]
"use strict";
const fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  http = require("http");
const ROOT = path.join(__dirname, "..");
const CODE = fs.readFileSync(path.join(ROOT, "dist/shabbat_controller.js"), "utf8");
const UI = Buffer.from(fs.readFileSync(path.join(ROOT, "dist/shabbat_ui.js"), "utf8"), "utf8");
const port = +process.argv[2] || 8099;
let now = +process.argv[3] || Math.floor(Date.now() / 1000);
const dev = { relay: false, kvs: {}, rpc: {}, endpoints: {}, pending: [], timers: [] };
const flush = () => {
  let n = 0;
  while (dev.pending.length && n++ < 5000) dev.pending.shift()();
};
const sb = {
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
};
vm.createContext(sb);
vm.runInContext("delete Array.prototype.sort;", sb);
vm.runInContext(CODE, sb);
flush();
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
      if (u.pathname === "/script/1/ui") {
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
          ram_free: 96996,
          unixtime: now
        });
      if (u.pathname === "/rpc/Script.GetStatus")
        return json(res, 200, {
          id: 1,
          running: true,
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
      if (u.pathname === "/rpc/Script.List")
        return json(res, 200, {
          scripts: [
            { id: 1, name: "shabbat_controller", enable: true, running: true },
            { id: 2, name: "shabbat_ui", enable: false, running: false }
          ]
        });
      if (u.pathname === "/rpc/Script.GetCode") {
        const src = u.searchParams.get("id") === "1" ? Buffer.from(CODE, "utf8") : UI;
        let off = +u.searchParams.get("offset") || 0,
          end = Math.min(src.length, off + 2000);
        while (end < src.length && (src[end] & 0xc0) === 0x80) end++; // don't split a UTF-8 character
        const chunk = src.subarray(off, end);
        return json(res, 200, { data: chunk.toString("utf8"), left: src.length - end });
      }
      const m = u.pathname.match(/^\/rpc\/Script\.(Shabbat\w+)$/);
      if (m && dev.rpc[m[1]]) {
        let params = {};
        try {
          params = body ? JSON.parse(body) : {};
        } catch (e) {}
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
      json(res, 404, { code: 404, message: "not found" });
    });
  })
  .listen(port, () =>
    console.log(
      "mock Shelly on http://localhost:" + port + "/script/1/ui  now=" + now + " relay=" + dev.relay
    )
  );
