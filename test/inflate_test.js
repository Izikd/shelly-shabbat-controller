// Tests the fallback DEFLATE decoder in src/unpack.js against Node's zlib.
// Usage: node test/inflate_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "unpack.js"), "utf8");
let fails = 0;
function check(cond, msg) {
  if (!cond) {
    fails++;
    console.log("FAIL:", msg);
  }
}

// Run the unpacker like a browser without DecompressionStream: the payload is a tiny program
// that records it ran, so this also covers the fallback start-up path.
const ran = [];
const mod = {};
const ctx = {
  document: {
    getElementById: () => ({
      set textContent(t) {
        ran.push("fail: " + t);
      }
    })
  },
  atob: (b) => Buffer.from(b, "base64").toString("latin1"),
  TextDecoder,
  Uint8Array,
  Uint16Array,
  Error,
  Function: function (code) {
    return () => ran.push(code);
  },
  module: mod
};
const payload = zlib.deflateSync(Buffer.from("started()")).toString("base64");
vm.runInNewContext(SRC.replace('"@@PAYLOAD@@"', JSON.stringify(payload)), ctx);
check(ran.length === 1 && ran[0] === "started()", "fallback start-up runs the payload: " + ran);
const inflate = mod.exports;
check(typeof inflate === "function", "inflate exported for tests");

function roundTrip(name, buf, opts) {
  const z = zlib.deflateSync(buf, opts || {});
  let out;
  try {
    out = Buffer.from(inflate(new Uint8Array(z)));
  } catch (e) {
    return check(false, name + ": threw " + e.message);
  }
  check(out.equals(buf), name + ": " + out.length + " bytes, expected " + buf.length);
}

let seed = 12345;
const rand = (n) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16;
  return b;
};
const text = Buffer.from(
  "שבת שלום! Shabbat shalom. ".repeat(500) +
    fs.readFileSync(path.join(__dirname, "..", "src", "ui.js"), "utf8")
);

roundTrip("empty", Buffer.alloc(0));
roundTrip("one byte", Buffer.from("x"));
roundTrip("text, level 9 (dynamic Huffman)", text, { level: 9 });
roundTrip("text, level 1", text, { level: 1 });
roundTrip("text, fixed Huffman", text, { strategy: zlib.constants.Z_FIXED });
roundTrip("text, Huffman only", text, { strategy: zlib.constants.Z_HUFFMAN_ONLY });
roundTrip("text, run-length", text, { strategy: zlib.constants.Z_RLE });
roundTrip("random, level 0 (stored blocks)", rand(200000), { level: 0 });
roundTrip("random, level 9", rand(100000), { level: 9 });
roundTrip("long repeats (distance 1, max length)", Buffer.alloc(300000, 97), { level: 9 });
const page = path.join(__dirname, "..", "dist", "shabbat_ui.js");
if (fs.existsSync(page)) roundTrip("built page", fs.readFileSync(page), { level: 9 });

// corrupt input must throw, not hang or return garbage silently
const z = zlib.deflateSync(text, { level: 9 });
let threw = 0;
for (let i = 0; i < 40; i++) {
  const bad = new Uint8Array(z);
  bad[2 + ((i * 7919) % (bad.length - 6))] ^= 1 << (i % 8);
  try {
    const out = Buffer.from(inflate(bad));
    if (!out.equals(text)) threw++; // wrong output is caught later (the code will not run)
  } catch (e) {
    threw++;
  }
}
check(threw === 40, "corrupt streams detected: " + threw + "/40");
let truncated = false;
try {
  inflate(new Uint8Array(z.subarray(0, z.length >> 1)));
} catch (e) {
  truncated = /truncated/.test(e.message);
}
check(truncated, "truncated stream throws");
let notZlib = false;
try {
  inflate(new Uint8Array(zlib.deflateRawSync(text)));
} catch (e) {
  notZlib = /not a zlib/.test(e.message);
}
check(notZlib, "raw deflate without zlib header rejected");

console.log(fails ? fails + " INFLATE FAILURE(S)" : "INFLATE TESTS PASSED");
process.exitCode = fails ? 1 : 0;
