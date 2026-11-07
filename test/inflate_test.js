// SPDX-License-Identifier: MIT
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

// Z85 as tools/build.mjs writes it (test/stamp.js has a copy for the update test)
const { z85, unz85, Z85 } = require("./stamp.js");
// the build's encoder must be the same one
check(
  fs
    .readFileSync(path.join(__dirname, "..", "tools", "build.mjs"), "utf8")
    .includes(JSON.stringify(Z85)),
  "tools/build.mjs uses the same Z85 alphabet"
);

check(
  [0, 1, 2, 3, 4, 5, 300].every((n) => {
    const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 97 + 255) & 255));
    return unz85(z85(b)).equals(b);
  }),
  "Z85 round trip"
);
check(
  z85(Buffer.from([0x86, 0x4f, 0xd2, 0x6f, 0xb5, 0x59, 0xf7, 0x5b])) === "0HelloWorld",
  "Z85 spec example"
);

// Run the unpacker like a browser without DecompressionStream: the payload is a tiny program
// that records it ran, so this also covers the fallback start-up path and the Z85 decoding.
// Programs of every length mod 4 check that the padding is dropped.
let ran = [];
const mod = {};
const ctx = {
  document: {
    getElementById: () => ({
      set textContent(t) {
        ran.push("fail: " + t);
      }
    })
  },
  TextDecoder,
  Uint8Array,
  Uint16Array,
  Error,
  Function: function (code) {
    return () => ran.push(code);
  },
  module: mod
};
for (const prog of ["started()", "started(1)", "started(12)", "started(123)", "s()"]) {
  ran = [];
  const payload = z85(zlib.deflateSync(Buffer.from(prog)));
  check(!/["\\]/.test(payload), "Z85 text needs no escaping in a JS string");
  vm.runInNewContext(SRC.replace('"@@PAYLOAD@@"', JSON.stringify(payload)), ctx);
  check(ran.length === 1 && ran[0] === prog, "fallback start-up runs the payload: " + ran);
}
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
