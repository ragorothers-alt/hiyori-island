// 番茄鐘的計時規則（純函式，不碰 DOM、不讀時鐘）：ui.js 的 FocusTimer 照這裡算下一步，測試直接測這裡。
// s：{ mode: 'idle'|'focus'|'break', endAt, paused, up, focusMin, breakMin, round, rounds }
//   endAt：倒數時是這一段結束的時間；往上數的專注是開始的時間（暫停過就往後挪）
//   paused：暫停中時，倒數剩下的毫秒、往上數已經過的毫秒；沒暫停是 null

// 正向計時（往上數）：滿 5 分鐘才記成一次專注，最長 3 小時自動結束
export const FREE_MIN = 5
export const FREE_MAX = 180
// 計時在關掉頁面、手機鎖著時早就結束了：結束後一小時內回來照常記，再晚就不照全長記進今天
export const LATE = 60 * 60000

// 往上數中（休息一律倒數）
export const counting = (s) => !!s.up && s.mode === 'focus'
// 倒數還剩幾毫秒（待機時是一整段的長度）
export const leftMs = (s, now) => (s.mode === 'idle' ? s.focusMin * 60000 : s.paused ?? Math.max(0, s.endAt - now))
// 往上數已經過了幾毫秒
export const elapsedMs = (s, now) => s.paused ?? Math.max(0, now - s.endAt)

// 下一次自己到點的時間（專注倒數完、正向計時滿 3 小時、休息結束）：沒在計時、暫停中是 null。到點的通知照這個排
export const nextEnd = (s) => (s.mode === 'idle' || s.paused != null ? null : counting(s) ? s.endAt + FREE_MAX * 60000 : s.endAt)

// 這一段本來該結束的時間過了太久（例如晚上開始專注後關掉，兩天後才打開）
export function isStale(s, now) {
  if (s.mode === 'idle' || s.paused != null) return false
  const end = counting(s) ? s.endAt + FREE_MAX * 60000 : s.endAt
  return now - end > LATE
}

// 每次檢查時該做什麼：
//   null：繼續計時
//   { do: 'expire' }：放太久了，不記、回到待機
//   { do: 'finishFocus', minutes }：一輪專注結束，記下分鐘數、接著休息
//   { do: 'nextRound' }：休息完還有下一輪，自動開始
//   { do: 'done' }：最後一輪的休息也結束了，回到待機
export function due(s, now) {
  if (s.mode === 'idle' || s.paused != null) return null
  if (isStale(s, now)) return { do: 'expire' }
  if (counting(s)) return elapsedMs(s, now) >= FREE_MAX * 60000 ? { do: 'finishFocus', minutes: FREE_MAX } : null
  if (now < s.endAt) return null
  if (s.mode === 'focus') return { do: 'finishFocus', minutes: Math.max(1, Math.round(s.focusMin)) }
  return s.round < s.rounds ? { do: 'nextRound' } : { do: 'done' }
}

// 暫停／繼續：回傳新的 { endAt, paused }
export function pauseToggle(s, now) {
  if (s.paused != null) return { endAt: counting(s) ? now - s.paused : now + s.paused, paused: null }
  return { endAt: s.endAt, paused: counting(s) ? elapsedMs(s, now) : Math.max(0, s.endAt - now) }
}

// 按 ■：往上數滿 5 分鐘算「做完了」，回傳要記的分鐘數；其他情況是取消，回傳 null
export function stopMinutes(s, now) {
  if (!counting(s)) return null
  const ms = elapsedMs(s, now)
  return ms >= FREE_MIN * 60000 ? Math.floor(ms / 60000) : null
}

// 開始一輪專注：回傳新的 { mode, endAt, paused }
export const focusStart = (s, now) => ({ mode: 'focus', paused: null, endAt: s.up ? now : now + s.focusMin * 60000 })
// 專注結束、開始休息
export const breakStart = (s, now) => ({ mode: 'break', paused: null, endAt: now + s.breakMin * 60000 })

// 重新整理前存的計時（localStorage、另一個分頁）：每個欄位都檢查過才用，壞掉的數字不會一路變成 NaN 分鐘。
// dflt 是現在的長度（存的長度壞掉時用）；回傳整理好的欄位，mode 由呼叫的一方先確認是 focus 或 break
export function restoreState(saved, dflt = {}) {
  const n = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  const taskId = typeof saved?.taskId === 'string' ? saved.taskId : null
  const rounds = Math.round(n(saved?.rounds, 1, 4, 1))
  return {
    mode: saved?.mode,
    endAt: n(saved?.endAt, 0, 8.64e15, 0),
    paused: Number.isFinite(saved?.paused) ? Math.max(0, saved.paused) : null,
    taskId,
    projectId: !taskId && typeof saved?.projectId === 'string' ? saved.projectId : null,
    up: saved?.up === true,
    focusMin: n(saved?.focusMin, 0.05, FREE_MAX, dflt.focusMin ?? 25),
    breakMin: n(saved?.breakMin, 0.05, 60, dflt.breakMin ?? 5),
    rounds,
    round: Math.round(n(saved?.round, 1, rounds, 1)),
    sid: typeof saved?.sid === 'string' && /^[\w-]{1,40}$/.test(saved.sid) ? saved.sid : null,
  }
}
