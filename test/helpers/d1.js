// Minimal Cloudflare D1 emulation on top of node:sqlite for integration tests.
import { DatabaseSync } from "node:sqlite";

function check(params) {
  for (const p of params) {
    if (p === undefined) throw new Error("D1_TYPE_ERROR: undefined bound parameter");
    if (typeof p === "boolean") throw new Error("D1_TYPE_ERROR: boolean bound parameter");
  }
  return params;
}

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }
  prep() {
    return this.db.prepare(this.sql);
  }
  async first(col) {
    const row = this.prep().get(...check(this.params));
    if (!row) return null;
    return col ? row[col] : { ...row };
  }
  async all() {
    return { results: this.prep().all(...check(this.params)).map((r) => ({ ...r })), success: true, meta: {} };
  }
  async run() {
    const st = this.prep();
    if (/\breturning\b/i.test(this.sql)) {
      const rows = st.all(...check(this.params));
      return { success: true, results: rows, meta: { changes: rows.length } };
    }
    const r = st.run(...check(this.params));
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function createD1(schemaSql = "") {
  const db = new DatabaseSync(":memory:");
  if (schemaSql) db.exec(schemaSql);
  return {
    _db: db,
    prepare: (sql) => new Statement(db, sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 1 };
    },
  };
}
