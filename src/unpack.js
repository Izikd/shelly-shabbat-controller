// SPDX-License-Identifier: MIT
// Unpacker for the compressed settings page. tools/build.mjs minifies src/ui.js, compresses it
// (zlib / RFC 1950), base64-encodes it into PAYLOAD below and stores this file as the
// shabbat_ui script. The controller's loader runs it with new Function(), in the browser.
//
// Modern browsers decompress with the built-in DecompressionStream("deflate"); older ones
// (Safari < 16.4, Firefox < 113, Chrome < 80) fall back to the small decoder below.
// Plain ES5 + guard, like src/ui.js: starting this script on the Shelly by mistake does nothing.
if (typeof document !== "undefined")
  (function () {
    var PAYLOAD = "@@PAYLOAD@@";

    function run(code) {
      new Function(code)();
    }
    function fail(e) {
      document.getElementById("app").textContent = "UI load failed: " + (e && e.message);
    }

    // ---------- DEFLATE decoder (RFC 1951) for a zlib stream (RFC 1950) ----------
    // Follows zlib's reference decoder "puff": canonical Huffman codes decoded bit by bit.
    // Small rather than fast; the page is ~30 KB. The Adler-32 trailer is not checked: a
    // corrupt stream fails on a bad code or length instead, or later when the code runs.
    var LBASE = [
      3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
      163, 195, 227, 258
    ];
    var LEXT = [
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
    ];
    var DBASE = [
      1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
      2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
    ];
    var DEXT = [
      0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
      13
    ];
    var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    function inflate(src) {
      if ((src[0] & 15) !== 8 || ((src[0] << 8) | src[1]) % 31 || src[1] & 32) {
        throw new Error("inflate: not a zlib stream");
      }
      var p = 2, // past the zlib header
        bitbuf = 0,
        bitcnt = 0,
        out = new Uint8Array(65536),
        len = 0;

      function put(b) {
        if (len === out.length) {
          var bigger = new Uint8Array(len * 2);
          bigger.set(out);
          out = bigger;
        }
        out[len++] = b;
      }
      function bits(n) {
        while (bitcnt < n) {
          if (p >= src.length) throw new Error("inflate: truncated");
          bitbuf |= src[p++] << bitcnt;
          bitcnt += 8;
        }
        var v = bitbuf & ((1 << n) - 1);
        bitbuf >>>= n;
        bitcnt -= n;
        return v;
      }
      // Huffman table from code lengths: count of codes per length + symbols in code order
      function table(lengths, n) {
        var count = new Uint16Array(16),
          offs = new Uint16Array(16),
          sym = new Uint16Array(n),
          i;
        for (i = 0; i < n; i++) count[lengths[i]]++;
        count[0] = 0;
        for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
        for (i = 0; i < n; i++) if (lengths[i]) sym[offs[lengths[i]]++] = i;
        return { count: count, sym: sym };
      }
      function decode(h) {
        var code = 0,
          first = 0,
          index = 0;
        for (var l = 1; l < 16; l++) {
          code |= bits(1);
          var c = h.count[l];
          if (code - c < first) return h.sym[index + code - first];
          index += c;
          first = (first + c) << 1;
          code <<= 1;
        }
        throw new Error("inflate: bad code");
      }
      function codes(lc, dc) {
        for (;;) {
          var s = decode(lc);
          if (s < 256) put(s);
          else if (s === 256) return;
          else {
            s -= 257;
            if (s >= 29) throw new Error("inflate: bad length");
            var n = LBASE[s] + bits(LEXT[s]),
              d = decode(dc);
            if (d >= 30) throw new Error("inflate: bad distance");
            var dist = DBASE[d] + bits(DEXT[d]);
            if (dist > len) throw new Error("inflate: distance too far");
            while (n--) put(out[len - dist]);
          }
        }
      }
      function stored() {
        bitbuf = 0;
        bitcnt = 0; // to the byte boundary
        if (p + 4 > src.length) throw new Error("inflate: truncated");
        var n = src[p] | (src[p + 1] << 8);
        if ((n ^ 0xffff) !== (src[p + 2] | (src[p + 3] << 8)))
          throw new Error("inflate: bad stored");
        p += 4;
        if (p + n > src.length) throw new Error("inflate: truncated");
        while (n--) put(src[p++]);
      }
      var fixedL = null,
        fixedD = null;
      function fixed() {
        if (!fixedL) {
          var l = new Uint8Array(288),
            i;
          for (i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
          fixedL = table(l, 288);
          for (i = 0; i < 30; i++) l[i] = 5;
          fixedD = table(l, 30);
        }
        codes(fixedL, fixedD);
      }
      function dynamic() {
        var nlen = bits(5) + 257,
          ndist = bits(5) + 1,
          ncode = bits(4) + 4,
          lens = new Uint8Array(320),
          i;
        if (nlen > 286 || ndist > 30) throw new Error("inflate: bad counts");
        for (i = 0; i < ncode; i++) lens[ORDER[i]] = bits(3);
        var lencode = table(lens, 19);
        lens = new Uint8Array(320);
        for (i = 0; i < nlen + ndist;) {
          var sym = decode(lencode);
          if (sym < 16) lens[i++] = sym;
          else {
            var val = 0,
              rep;
            if (sym === 16) {
              if (!i) throw new Error("inflate: repeat with no length");
              val = lens[i - 1];
              rep = 3 + bits(2);
            } else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > nlen + ndist) throw new Error("inflate: too many lengths");
            while (rep--) lens[i++] = val;
          }
        }
        codes(table(lens, nlen), table(lens.subarray(nlen), ndist));
      }

      var last;
      do {
        last = bits(1);
        var type = bits(2);
        if (type === 0) stored();
        else if (type === 1) fixed();
        else if (type === 2) dynamic();
        else throw new Error("inflate: bad block type");
      } while (!last);
      return out.subarray(0, len);
    }

    if (typeof module !== "undefined") module.exports = inflate; // for test/inflate_test.js

    // start (last, so the tables above are set before inflate() can run)
    var bin = atob(PAYLOAD),
      data = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);

    if (typeof DecompressionStream === "function" && typeof Blob.prototype.stream === "function") {
      new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate")))
        .text()
        .then(run)
        .catch(fail);
    } else {
      try {
        run(new TextDecoder().decode(inflate(data)));
      } catch (e) {
        fail(e);
      }
    }
  })();
