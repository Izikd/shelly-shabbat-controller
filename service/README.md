# Schedule service

Public, read-only pages with the upcoming Shabbat & Yom Tov on times of a Shabbat controller.
A Cloudflare Worker (`src/index.js`, pages in `src/page.js`) with a D1 database
(`schema.sql`). The project's instance: `https://shabbat-schedule.izikdd.workers.dev`
(`PUB_URL` in `src/ui.js`).

## How it fits together

1. The settings page (browser) calls `POST /api/register {name}` and gets `{id, key, url}`,
   then hands `id` and `key` to the device (`Script.ShabbatPub`).
2. The device sends `PUT /api/s/<id>` with `Authorization: Bearer <key>` and the next 6
   windows and their ON times (schedule `v: 1`; `v: 2` from devices with repeating timers adds
   each window's repeats in short, `rp: [[first start, last end, every, duration]]`, shown as
   one line; see `service/src/index.js`): once a day (23-25 h apart, so devices spread out), ~30 s after
   every settings change and after a restart; failures retry after 5, 20, 45... min (max 6 h).
   The reply is 204 with no body, so it costs the script almost no memory.
3. Anyone with the link opens `GET /s/<id>`: plain HTML, no script, Hebrew or English
   (browser language, or `?lang=he|en`), in the device's time zone (the `tz` it sends;
   Israel if none), refreshes itself every 15 minutes.
   Also `GET /s/<id>.json`.
4. Rename: `PUT /api/s/<id>/name {name}`; stop: `DELETE /api/s/<id>` (both with the key,
   from the settings page).

## Limits (no accounts, so the service protects itself)

- New pages: 20 per client address per day, 3000 per day in total.
- Writes to one page: at least 20 s apart, at most 200 per day; body at most 4 KB.
- Only a schedule in the exact expected shape is stored (titles, numbers, ranges checked,
  other fields dropped); the name is at most 60 characters and always escaped.
- The database keeps the SHA-256 of each key, not the key, and a hash of client addresses,
  not the addresses.
- Daily cleanup (cron 03:17 UTC): pages not updated for 120 days, pages never updated after
  7 days, old registration counters.

## Deploy

Needs a Cloudflare API token with Workers Scripts: Edit and D1: Edit on the account
(the "Edit Cloudflare Workers" template plus D1; no zone access is needed for `workers.dev`).

```
export CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=...
npm run service:schema   # once, and after schema.sql changes (safe to re-run)
npm run service:deploy
```

Test locally first: `node --no-warnings test/service_test.mjs` (and `npm test`, whose browser
test runs the service next to the mock device).

## Running your own copy

Create a D1 database (`npx wrangler d1 create <name>`), put its id and your worker name in
`wrangler.toml`, deploy as above, and set `PUB_URL` in `src/ui.js` to your worker's address
before building the scripts. Pages created before keep the service they were created with
(the address is stored on each device).
