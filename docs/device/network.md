# Network path (reverse proxy / tunnel)

Learned on a **Shelly Pro 1, firmware 2.0.3** (Nov 2026) unless noted. Each note says how it
is known: *doc* (Shelly API docs), *measured* (see `../experiments/`), *observed* (happened on
the device) or *design* (a rule we chose). Recheck on new firmware or other models.

- Through a reverse proxy / tunnel, each RPC round trip took 0.4-1.3 s, so load time depends
  on the number of sequential requests far more than on bytes (*measured*).
- Some proxies (e.g. a WAF in front of a tunnel) reject Python's default `Python-urllib`
  user agent with 403 (*observed*); `deploy.py` sends its own.

## Connections: few, shared by every client
- **The device serves only a few HTTP connections at once, shared by everything talking to
  it** (its own web UI, the Shelly app, every open tab of our page), and refuses requests
  beyond that (*observed*, fw 2.0.3, 2026-11-06). With several windows open, our page's load
  burst of 7 requests failed on every browser: through the Cloudflare tunnel as HTTP 502
  (`error code: 502`, HTML, `server: cloudflare`), on the LAN as "Failed to fetch". Closing
  most windows let the page load again (owner). Earlier the same day, with fewer clients, 6
  parallel reads worked with no errors (`../experiments/page-size-and-load.md`).
- The device's own error, e.g. a `GetCode` read past the end, is HTTP 500 with its JSON
  (`{"code":-103,...}`), so "not JSON" means the request did not reach the device (*observed*).
- So the loader and the page keep at most 2 requests in flight and retry refused ones
  (*design*); `test/mockdevice.js` refuses beyond 3 at once, alternately by dropping the
  connection and with a 502 page.

## Outgoing HTTP (publishing to the schedule service)
- `HTTP.Request` supports GET, POST, PUT, HEAD and DELETE only - no PATCH (*doc*). The whole
  request (URL, headers, body) is limited to 8 KB, 15 headers of up to 1 KB (*doc*). The
  reply body is handed to the script as a string, so the schedule service answers 204 with
  no body (*design*).
- HTTPS uses the firmware's built-in CA bundle by default (*doc*).
- **Not yet measured on hardware**: the script-memory peak of one publishing request (body
  ~0.9 KB with the default timers, ~2.3 KB with 12 timers) and whether the Pro 1's CA bundle
  accepts the `workers.dev` certificate. Check `mem_peak` and the publish status on the
  settings page after the first deploy, and record the numbers here.
