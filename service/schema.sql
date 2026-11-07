-- SPDX-License-Identifier: MIT
-- Schedule service database (Cloudflare D1, SQLite). Apply with:
--   npx wrangler d1 execute shabbat-schedule --remote --file service/schema.sql -c service/wrangler.toml
-- Safe to re-run.

-- One row per published page (one per device).
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,           -- public page id, in the link: /s/<id>
  key_hash TEXT NOT NULL,        -- SHA-256 (hex) of the device's write key; the key is not kept
  name TEXT NOT NULL DEFAULT '', -- page title chosen by the owner
  created INTEGER NOT NULL,      -- unix seconds
  updated INTEGER NOT NULL DEFAULT 0, -- last schedule upload (0 = never)
  data TEXT,                     -- last schedule, validated and normalized JSON
  put_day INTEGER NOT NULL DEFAULT 0, -- day number (unix days) of put_n
  put_n INTEGER NOT NULL DEFAULT 0    -- writes on put_day (rate limit)
);

-- Registrations per client per day (rate limit). ip = truncated SHA-256, not the address.
CREATE TABLE IF NOT EXISTS regs (
  ip TEXT NOT NULL,
  day INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (ip, day)
);
