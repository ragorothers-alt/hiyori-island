// 時段安排、最佳化時程與作息：純函式，方便測試。時間一律用「當天第幾分鐘」計算。

const toM = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}
const toHHMM = (m) => {
  const v = Math.max(0, Math.min(1439, Math.round(m)))
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}
const weekday = (date) => new Date(date + 'T00:00:00').getDay()

// 作息預設：起床、就寢、三餐、工作時段（週一～五）、精神最好的時段、行程之間的緩衝
export const DEFAULT_RHYTHM = {
  wake: '07:00',
  sleep: '23:30',
  meals: [
    { label: '早餐', start: '07:30', end: '08:00' },
    { label: '午餐', start: '12:00', end: '13:00' },
    { label: '晚餐', start: '18:30', end: '19:30' },
  ],
  work: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  peak: 'morning',
  buffer: 10,
  bedRemind: true,
}
export const PEAKS = {
  morning: { label: '上午', range: [9 * 60, 12 * 60] },
  afternoon: { label: '下午', range: [14 * 60, 17 * 60] },
  evening: { label: '晚上', range: [19 * 60, 22 * 60] },
}
// 沒填預估時間的任務：依優先度估
export const TASK_DUR = { 1: 15, 2: 30, 3: 50 }
export const taskDur = (t) => t.dur || TASK_DUR[t.priority] || 30

export function fmtDur(min) {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? (r ? `${h}h${r}m` : `${h}h`) : `${r}m`
}

// 醒著的範圍：起床到就寢（就寢在午夜後就算到 24:00）
export function awake(r) {
  const w = toM(r.wake)
  const s = toM(r.sleep)
  return [w, s > w ? s : 1440]
}

// 作息色帶：睡眠、三餐（會佔用時間）、工作時段（只是背景）
export function rhythmBlocks(r, date) {
  const w = toM(r.wake)
  const s = toM(r.sleep)
  const out = []
  if (s > w) {
    if (w > 0) out.push({ kind: 'sleep', label: '睡眠', start: 0, end: w })
    if (s < 1440) out.push({ kind: 'sleep', label: '睡眠', start: s, end: 1440 })
  } else if (s < w) out.push({ kind: 'sleep', label: '睡眠', start: s, end: w })
  for (const meal of r.meals || []) {
    const a = toM(meal.start)
    const b = toM(meal.end)
    if (b > a) out.push({ kind: 'meal', label: meal.label, start: a, end: b })
  }
  if (r.work && r.work.days?.includes(weekday(date))) {
    const a = toM(r.work.start)
    const b = toM(r.work.end)
    if (b > a) out.push({ kind: 'work', label: '工作時段', start: a, end: b })
  }
  return out.sort((x, y) => x.start - y.start)
}

// 日程與排進時段的任務 → 時間區塊
export function itemBlocks(events, tasks) {
  const out = []
  for (const e of events) out.push({ id: e.id, kind: 'event', start: toM(e.start), end: toM(e.end), done: !!e.done })
  for (const t of tasks) {
    if (!t.at) continue
    const a = toM(t.at)
    out.push({ id: t.id, kind: 'task', start: a, end: Math.min(1440, a + taskDur(t)), done: !!t.done })
  }
  return out.sort((x, y) => x.start - y.start || x.end - y.end)
}

// 互相重疊的區塊：id → 和它重疊的 id 們（已完成的不算）
export function findConflicts(blocks) {
  const out = new Map()
  const live = blocks.filter((b) => !b.done)
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      if (b.start >= a.end) continue
      if (a.start < b.end && b.start < a.end) {
        if (!out.has(a.id)) out.set(a.id, [])
        if (!out.has(b.id)) out.set(b.id, [])
        out.get(a.id).push(b.id)
        out.get(b.id).push(a.id)
      }
    }
  }
  return out
}

// 合併區間
function merge(list) {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const out = []
  for (const [a, b] of s) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

// [from, to] 之間扣掉忙碌區間後的空檔（至少 5 分鐘）
export function gaps(from, to, busy) {
  const out = []
  let cur = from
  for (const [a, b] of merge(busy)) {
    if (b <= cur) continue
    if (a >= to) break
    if (a > cur) out.push([cur, Math.min(a, to)])
    cur = Math.max(cur, b)
  }
  if (to > cur) out.push([cur, to])
  return out.filter(([a, b]) => b - a >= 5)
}

const roundUp = (m, step = 5) => Math.ceil(m / step) * step

// 排程的起點：今天從現在（取整後再留 5 分鐘）開始，其他天從起床開始
function windowOf({ rhythm, date, today, nowMin }) {
  const [w, s] = awake(rhythm)
  let from = w
  if (date === today && nowMin != null) from = Math.max(w, roundUp(nowMin + 5))
  if (date < today) from = s
  return [from, s]
}

// 已佔用的時間：三餐、日程、已排的任務；日程與任務前後各留緩衝
function busyOf({ rhythm, date, events, tasks, skip }) {
  const buf = rhythm.buffer || 0
  const busy = []
  for (const b of rhythmBlocks(rhythm, date)) if (b.kind === 'meal') busy.push([b.start, b.end])
  for (const b of itemBlocks(events, tasks.filter((t) => !skip?.has(t.id)))) {
    if (b.kind === 'task' && b.done) continue
    busy.push([b.start - buf, b.end + buf])
  }
  return busy
}

// 排序：本命 → 高優先 → 逾期越久越前 → 長的先排（大石頭先放）→ 建立順序
export function planOrder(tasks, date) {
  const score = (t) => (t.star ? 1000 : 0) + t.priority * 100 + Math.min(30, Math.max(0, daysBefore(t.date, date))) * 10
  return [...tasks].sort((a, b) => score(b) - score(a) || taskDur(b) - taskDur(a) || (a.createdAt || 0) - (b.createdAt || 0))
}
const daysBefore = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)

// 偏好：重要的放在精神最好的時段、低優先避開它；工作與學習在工作日盡量放進工作時段。數字越小越好
function preference(t, start, rhythm, date) {
  let p = 0
  const peak = PEAKS[rhythm.peak]?.range
  if (peak) {
    const inPeak = start >= peak[0] && start < peak[1]
    if (t.star || t.priority === 3) p += inPeak ? 0 : 1
    else if (t.priority === 1) p += inPeak ? 1 : 0
  }
  const work = rhythm.work
  if (work && work.days?.includes(weekday(date)) && (t.tag === 'work' || t.tag === 'study')) {
    const inWork = start >= toM(work.start) && start < toM(work.end)
    p += inWork ? 0 : t.tag === 'work' ? 2 : 1
  }
  return p
}

// 在空檔裡找一個位置：候選起點是每段空檔的開頭、精神時段與工作時段的開頭
function bestStart(t, dur, free, rhythm, date) {
  const marks = [PEAKS[rhythm.peak]?.range[0], rhythm.work ? toM(rhythm.work.start) : null].filter((v) => v != null)
  let best = null
  for (const [a, b] of free) {
    for (const s of [a, ...marks.filter((m) => m > a && m + dur <= b)]) {
      if (s + dur > b) continue
      const p = preference(t, s, rhythm, date)
      if (!best || p < best.p || (p === best.p && s < best.s)) best = { s, p }
    }
  }
  return best?.s ?? null
}

// 最佳化時程：把還沒排時段（replan 時連同還沒開始的）任務放進空檔。
// 回傳 plan：[{ id, at, dur }]、left：放不下的任務、load：當天已排的總分鐘、free：剩下的空檔分鐘、endAt：最後一件結束的時間
export function optimizeDay({ tasks, events, rhythm, date, today, nowMin = null, replan = false }) {
  const [from, to] = windowOf({ rhythm, date, today, nowMin })
  const movable = (t) => !t.done && (!t.at || (replan && toM(t.at) >= from))
  const pending = planOrder(tasks.filter(movable), date)
  const skip = new Set(pending.map((t) => t.id))
  const busy = busyOf({ rhythm, date, events, tasks, skip })
  const buf = rhythm.buffer || 0
  const plan = []
  const left = []
  for (const t of pending) {
    const dur = taskDur(t)
    const free = gaps(from, to, busy)
    const s = bestStart(t, dur, free, rhythm, date)
    if (s == null) {
      left.push(t.id)
      continue
    }
    plan.push({ id: t.id, at: toHHMM(s), dur })
    busy.push([s - buf, s + dur + buf])
  }
  const placed = tasks.filter((t) => !t.done && t.at && !skip.has(t.id))
  const load = [...placed.map(taskDur), ...plan.map((p) => p.dur)].reduce((a, b) => a + b, 0)
  const freeLeft = gaps(from, to, busy).reduce((a, [x, y]) => a + (y - x), 0)
  const ends = [...placed.map((t) => toM(t.at) + taskDur(t)), ...plan.map((p) => toM(p.at) + p.dur)]
  return { plan, left, load, free: freeLeft, endAt: ends.length ? toHHMM(Math.max(...ends)) : null, from: toHHMM(from), to: toHHMM(to) }
}

// 單一任務：找最近的空檔
export function nearestSlot({ task, tasks, events, rhythm, date, today, nowMin = null }) {
  const r = optimizeDay({ tasks: [...tasks.filter((t) => t.id !== task.id), { ...task, at: null }], events, rhythm, date, today, nowMin })
  return r.plan.find((p) => p.id === task.id) || null
}

// ── 睡眠 ──
// 一筆睡眠紀錄記在「醒來那天」：{ bed: '23:40', wake: '07:10', q: 1–5 }
export function sleepMinutes(e) {
  const b = toM(e.bed)
  const w = toM(e.wake)
  return w > b ? w - b : w + 1440 - b
}
// 就寢時間以午夜為中心換算（22:00 → -120、01:00 → 60），平均才不會被午夜切開
const aroundMidnight = (m) => (m >= 720 ? m - 1440 : m)

export function sleepStats(log, today, days = 7) {
  const list = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today + 'T00:00:00')
    d.setDate(d.getDate() - i)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const e = log[date]
    list.push(e ? { date, ...e, dur: sleepMinutes(e) } : { date, dur: 0 })
  }
  const got = list.filter((x) => x.dur)
  if (!got.length) return { n: 0, list, avg: 0, bed: null, wake: null, spread: 0, q: 0 }
  const avg = got.reduce((a, x) => a + x.dur, 0) / got.length
  const beds = got.map((x) => aroundMidnight(toM(x.bed)))
  const bed = beds.reduce((a, b) => a + b, 0) / got.length
  const wake = got.reduce((a, x) => a + toM(x.wake), 0) / got.length
  return {
    n: got.length,
    list,
    avg: Math.round(avg),
    bed: toHHMM((bed + 1440) % 1440),
    wake: toHHMM(wake),
    // 就寢時間最早與最晚差幾分鐘（越小越規律）
    spread: Math.round(Math.max(...beds) - Math.min(...beds)),
    q: got.some((x) => x.q) ? +(got.reduce((a, x) => a + (x.q || 0), 0) / got.filter((x) => x.q).length).toFixed(1) : 0,
  }
}
