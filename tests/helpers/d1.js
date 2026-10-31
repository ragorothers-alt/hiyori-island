// 測試用的 D1：用 Node 內建的 SQLite 實作 Worker 用到的那幾個方法（prepare/bind/first/run/all）
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

class Statement {
  constructor(db, sql, params = []) {
    this.db = db
    this.sql = sql
    this.params = params
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params)
  }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params)
    if (!row) return null
    return column ? row[column] : row
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.params)
    return { results: [], meta: { changes: Number(info.changes) } }
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params) }
  }
}

// 建立一個套用了 worker/migrations 的記憶體資料庫
export function createD1() {
  const db = new DatabaseSync(':memory:')
  const dir = new URL('../../worker/migrations/', import.meta.url)
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'))
  return { raw: db, prepare: (sql) => new Statement(db, sql) }
}
