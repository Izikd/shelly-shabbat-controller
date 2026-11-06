# Minifying the controller

Device: Shelly Pro 1, firmware 2.0.3, reached through a reverse-proxy tunnel (0.4-1.3 s
per round trip). Entries are dated, newest last; keep the method so a test can be repeated.

## 2026-11-04 - Minifying the controller
- **Method**: terser with mangling only (`compress: false`), deploy, read `Script.GetStatus`.
- **Result**: code 15,716 -> 14,437 chars (-8%, the table and text dominate); `mem_used`
  14.5 -> 14.4 KB, peak 21.3 -> 20.5 KB during a forecast. All tests and a forecast on the
  device correct.
- **Conclusion**: minification is about upload size, not memory. Kept conservative (no
  compress) because restructured code risks the engine's stack limits.
