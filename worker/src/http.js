// 回給前端的錯誤：status 和一個短的 error 代碼（前端照代碼換成看得懂的話），extra 會併進回應
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

// 計數器（counters 資料表）：key 在 reset_at 之前一直累加，過了就從 1 重新算；回傳累加後的次數。
// 沒有資料庫（只測 AI 的測試）時不算，回傳 0
export async function bump(db, key, windowMs, now) {
  if (!db) return 0
  const row = await db
    .prepare(
      `INSERT INTO counters (key, n, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT (key) DO UPDATE SET
         n = CASE WHEN reset_at <= ?3 THEN 1 ELSE n + 1 END,
         reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
       RETURNING n`,
    )
    .bind(key, now + windowMs, now)
    .first()
  return row?.n ?? 0
}
// 目前的次數（過期的算 0），不累加
export async function count(db, key, now) {
  if (!db) return 0
  const row = await db.prepare('SELECT n, reset_at FROM counters WHERE key = ?1').bind(key).first()
  return row && row.reset_at > now ? row.n : 0
}
