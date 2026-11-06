// In-memory stand-in for a Cloudflare D1 binding (the subset service/src uses), on Node's
// built-in SQLite, with the real schema from service/schema.sql.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../service/schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, args) => ({
    bind: (...a) => stmt(sql, a),
    async first() {
      const r = db.prepare(sql).get(...(args || []));
      return r ? { ...r } : null;
    },
    async run() {
      const r = db.prepare(sql).run(...(args || []));
      return { success: true, meta: { changes: Number(r.changes) } };
    },
    async all() {
      return {
        results: db
          .prepare(sql)
          .all(...(args || []))
          .map((r) => ({ ...r }))
      };
    }
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}
