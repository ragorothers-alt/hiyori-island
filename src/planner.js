// 時段安排、最佳化時程與作息：純函式，方便測試。時間一律用「當天第幾分鐘」計算。

export const toM = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}
export const toHHMM = (m) => {
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

// ── 大任務分段 ──
// 預估這麼長（分鐘）以上的任務可以分成幾段、分到幾天做；最多分幾段
export const SPLIT_MIN = 90
export const SPLIT_MAX = 8
// 一段大約多長：專注一輪 25 分的人一段兩輪（50 分），長的一輪就一段
export const sessionLen = (focusMin) => {
  const f = Number.isFinite(+focusMin) && +focusMin >= 10 ? +focusMin : 25
  return f <= 30 ? f * 2 : f
}

// ── 預估準不準 ──
// 最近做完、有填預估、又用專注計時做過的任務：實際專注的分鐘 ÷ 預估，取中位數（一兩件特別久的不會帶偏）。
// 至少 5 件才算；回傳 { ratio, n }，資料不夠是 null。ratio 1.4＝平常實際花的時間是預估的 1.4 倍
export const ESTIMATE_MIN = 5
export function estimateRatio(tasks, now = Date.now(), days = 60) {
  const since = now - days * 86400000
  const r = []
  for (const t of tasks || []) {
    if (!t?.done || !(t.doneAt >= since) || !(t.dur >= 10) || !(t.spent >= 5)) continue
    const x = t.spent / t.dur
    // 只專注了一小段、其他時間沒計時（或忘了停）的不算
    if (x >= 0.25 && x <= 4) r.push(x)
  }
  if (r.length < ESTIMATE_MIN) return null
  r.sort((a, b) => a - b)
  const mid = r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2
  return { ratio: Math.round(mid * 20) / 20, n: r.length }
}
// 排時間時替一件任務留多久：平常會超時的人照比例多留（最多兩倍），平常提早做完的不縮
export const stretchDur = (dur, stretch = 1) => (stretch > 1.05 ? Math.min(dur * 2, Math.round((dur * stretch) / 5) * 5) : dur)
// 自動排程最多用掉空檔的幾成：留白給休息和突發的事（跟ふじ的說明一樣是七成）
export const FILL = 0.7

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
// 照日曆的一天切出醒著的時段：就寢在午夜後時，這天的 0 點到就寢也還醒著（前一晚熬夜的那段）
export function awakeRanges(r) {
  const w = toM(r.wake)
  const s = toM(r.sleep)
  if (s > w) return [[w, s]]
  return s > 0 ? [[0, s], [w, 1440]] : [[w, 1440]]
}
// 就寢時間接在當天後面算：午夜後就寢是 1440 以後（01:00 → 1500）
export function bedAt(r) {
  const w = toM(r.wake)
  const s = toM(r.sleep)
  return s > w ? s : s + 1440
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

// 已佔用的時間：三餐、日程、已排的任務；日程與任務前後各留緩衝。
// 已經做完的不佔（提早結束的會議、做完的任務），跟時間軸上的衝突判斷一樣
export function busyOf({ rhythm, date, events, tasks, skip }) {
  const buf = rhythm.buffer || 0
  const busy = []
  for (const b of rhythmBlocks(rhythm, date)) if (b.kind === 'meal') busy.push([b.start, b.end])
  for (const b of itemBlocks(events, tasks.filter((t) => !skip?.has(t.id)))) {
    if (b.done) continue
    busy.push([b.start - buf, b.end + buf])
  }
  return busy
}

// 排序：本命 → 截止日快到的 → 高優先 → 逾期越久越前 → 長的先排（大石頭先放）→ 建立順序
export function planOrder(tasks, date) {
  const score = (t) => (t.star ? 1000 : 0) + dueUrgency(t, date) + t.priority * 100 + Math.min(30, Math.max(0, daysBefore(t.date, date))) * 10
  return [...tasks].sort((a, b) => score(b) - score(a) || taskDur(b) - taskDur(a) || (a.createdAt || 0) - (b.createdAt || 0))
}
// 截止日越近越前面：當天或過了 +500、剩一天 +350、三天內 +200、一週內 +80
function dueUrgency(t, date) {
  if (!t.due) return 0
  const left = daysBefore(date, t.due)
  return left <= 0 ? 500 : left === 1 ? 350 : left <= 3 ? 200 : left <= 7 ? 80 : 0
}
const daysBefore = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)

// 午後容易沒精神的時段（13–15 點）：要動腦的避開，輕鬆的小事放這裡
export const DIP = [13 * 60, 15 * 60]
// 偏好：重要的放在精神最好的時段、低優先避開它；工作與學習在工作日盡量放進工作時段；
// 午後低潮放低優先的小事、重的避開。數字越小越好
function preference(t, start, rhythm, date) {
  let p = 0
  const peak = PEAKS[rhythm.peak]?.range
  const heavy = t.star || t.priority === 3
  if (peak) {
    const inPeak = start >= peak[0] && start < peak[1]
    if (heavy) p += inPeak ? 0 : 1
    else if (t.priority === 1) p += inPeak ? 1 : 0
  }
  // 精神最好的時段本來就在午後的不算（那個人下午最有精神）
  const inDip = start >= DIP[0] && start < DIP[1] && !(peak && peak[0] < DIP[1] && peak[1] > DIP[0])
  if (inDip && (heavy || taskDur(t) >= 50)) p += 1
  else if (!inDip && t.priority === 1 && taskDur(t) <= 30 && !(peak && peak[0] < DIP[1] && peak[1] > DIP[0])) p += 0.5
  const work = rhythm.work
  if (work && work.days?.includes(weekday(date)) && (t.tag === 'work' || t.tag === 'study')) {
    const inWork = start >= toM(work.start) && start < toM(work.end)
    p += inWork ? 0 : t.tag === 'work' ? 2 : 1
  }
  return p
}

// 在空檔裡找一個位置：候選起點是每段空檔的開頭、精神時段與工作時段的開頭
function bestStart(t, dur, free, rhythm, date) {
  const marks = [PEAKS[rhythm.peak]?.range[0], rhythm.work ? toM(rhythm.work.start) : null, DIP[0], DIP[1]].filter((v) => v != null)
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
// stretch：平常實際花的時間是預估的幾倍（estimateRatio）：會超時的人每件後面多留一點（任務的長度不改，多的是空白）。
// fill：最多用掉空檔的幾成（本命、高優先的不受限），超過的留到別天。
// 回傳 plan：[{ id, at, dur }]、left：放不下的任務、full：其中因為不想排太滿而沒排的、big：其中比哪一段空檔都長、可以分段做的、
// load：當天已排的總分鐘、free：剩下的空檔分鐘、endAt：最後一件結束的時間
export function optimizeDay({ tasks, events, rhythm, date, today, nowMin = null, replan = false, stretch = 1, fill = FILL }) {
  const [from, to] = windowOf({ rhythm, date, today, nowMin })
  const movable = (t) => !t.done && (!t.at || (replan && toM(t.at) >= from))
  const pending = planOrder(tasks.filter(movable), date)
  const skip = new Set(pending.map((t) => t.id))
  const busy = busyOf({ rhythm, date, events, tasks, skip })
  const buf = rhythm.buffer || 0
  const room = gaps(from, to, busy).reduce((a, [x, y]) => a + (y - x), 0)
  const budget = fill >= 1 ? Infinity : room * fill
  let used = 0
  const plan = []
  const left = []
  const full = []
  const big = []
  for (const t of pending) {
    const dur = taskDur(t)
    const need = stretchDur(dur, stretch)
    // 一般的任務：再排下去就太滿了，留到別天（本命、高優先的一定排）
    if (used + need > budget && !(t.star || t.priority === 3)) {
      left.push(t.id)
      full.push(t.id)
      continue
    }
    const free = gaps(from, to, busy)
    const s = bestStart(t, need, free, rhythm, date)
    if (s == null) {
      left.push(t.id)
      if (dur >= SPLIT_MIN && !free.some(([a, b]) => b - a >= need)) big.push(t.id)
      continue
    }
    plan.push({ id: t.id, at: toHHMM(s), dur })
    busy.push([s - buf, s + need + buf])
    used += need + buf
  }
  const placed = tasks.filter((t) => !t.done && t.at && !skip.has(t.id))
  const load = [...placed.map(taskDur), ...plan.map((p) => p.dur)].reduce((a, b) => a + b, 0)
  const freeLeft = gaps(from, to, busy).reduce((a, [x, y]) => a + (y - x), 0)
  const ends = [...placed.map((t) => toM(t.at) + taskDur(t)), ...plan.map((p) => toM(p.at) + p.dur)]
  return { plan, left, full, big, load, free: freeLeft, endAt: ends.length ? toHHMM(Math.max(...ends)) : null, from: toHHMM(from), to: toHHMM(to) }
}

// 單一任務：找最近的空檔（使用者自己要排的，不管排得滿不滿）
export function nearestSlot({ task, tasks, events, rhythm, date, today, nowMin = null }) {
  const r = optimizeDay({ tasks: [...tasks.filter((t) => t.id !== task.id), { ...task, at: null }], events, rhythm, date, today, nowMin, fill: 1 })
  return r.plan.find((p) => p.id === task.id) || null
}

// ── 今日總覽的「現在」 ──
// 現在在作息的哪一段（phase）、到就寢還有多久、扣掉三餐／日程／已排的任務（含緩衝）後還剩多少空檔、
// 現在正在做的（日程、三餐、排了時段的任務）、眼前這段空檔、這段空檔放得下哪幾件還沒排的任務。
// phase：early 起床前、peak 精神最好的時段、dip 午後（13–15 點）、normal 其他醒著的時間、windDown 睡前一小時、over 過了就寢時間
// tasks、events：今天的；nowMin：現在是當天第幾分鐘
export function nowGuide({ rhythm, date, nowMin, events = [], tasks = [] }) {
  const wake = toM(rhythm.wake)
  const bed = bedAt(rhythm)
  // 就寢在午夜後、現在是午夜到就寢之間：還是前一晚醒著的那段
  const late = bed > 1440 && nowMin < bed - 1440
  const end = late ? bed - 1440 : bed
  const toBed = end - nowMin
  const peak = PEAKS[rhythm.peak]?.range
  let phase
  if (!late && nowMin < wake) phase = bed <= 1440 && nowMin < 4 * 60 ? 'over' : 'early'
  else if (toBed <= 0) phase = 'over'
  else if (toBed <= 60) phase = 'windDown'
  else if (peak && nowMin >= peak[0] && nowMin < peak[1]) phase = 'peak'
  else if (nowMin >= 13 * 60 && nowMin < 15 * 60) phase = 'dip'
  else phase = 'normal'
  const awakeNow = phase !== 'early' && phase !== 'over'
  const busy = busyOf({ rhythm, date, events, tasks })
  const free = awakeNow ? gaps(nowMin, end, busy) : []
  const freeMin = free.reduce((a, [x, y]) => a + (y - x), 0)
  // 現在正在做的：日程、三餐、排了時段還沒做完的任務（不算緩衝）
  const cover = (a, b) => a <= nowMin && nowMin < b
  let current = null
  for (const e of events) if (!e.done && cover(toM(e.start), toM(e.end))) current = { kind: 'event', title: e.title, end: toM(e.end) }
  for (const t of tasks) if (!current && !t.done && t.at && cover(toM(t.at), toM(t.at) + taskDur(t))) current = { kind: 'task', title: t.title, end: toM(t.at) + taskDur(t), id: t.id }
  for (const b of rhythmBlocks(rhythm, date)) if (!current && b.kind === 'meal' && cover(b.start, b.end)) current = { kind: 'meal', title: b.label, end: b.end }
  // 眼前這段空檔：現在就在空檔裡，或下一段
  const next = free[0] ? { start: Math.max(free[0][0], nowMin), end: free[0][1] } : null
  const room = next ? next.end - next.start : 0
  const later = tasks.filter((t) => !t.done && t.at && toM(t.at) + taskDur(t) > nowMin)
  const open = tasks.filter((t) => !t.done && !t.at)
  // 放得下眼前這段的還沒排的任務：精神好的時候重要的先，午後和其他時間短的、輕的先
  let fits = []
  if (awakeNow && phase !== 'windDown' && room >= 10) {
    const order = phase === 'peak' ? planOrder(open, date) : [...planOrder(open, date)].sort((a, b) => (phase === 'dip' ? a.priority - b.priority : 0) || taskDur(a) - taskDur(b))
    fits = order.filter((t) => taskDur(t) <= room).slice(0, 3)
  }
  return {
    phase, nowMin, bed: end, toBed, free, freeMin, current, next,
    scheduled: { count: later.length, min: later.reduce((a, t) => a + taskDur(t), 0) },
    open: { count: open.length, min: open.reduce((a, t) => a + taskDur(t), 0) },
    fits,
  }
}

// ── 明天先做哪一件 ──
// 晚上挑好下一次起床後先做的那一件（今日總覽的卡片、晚間回顧記下之後、就寢提醒）：就寢前 4 小時起、
// 晚上 9 點以後、過了就寢時間都算。回傳要挑的是幾天後的那天：下一次起床的那天，過了午夜、還沒到起床時間時是 0（今天這個日期），
// 平常是 1；不是晚上（起床前的清晨也不算）是 null
export const FIRST_EVE = 240
export function firstPickIn(rhythm, date, nowMin) {
  const g = nowGuide({ rhythm, date, nowMin })
  const wake = toM(rhythm.wake)
  const bed = bedAt(rhythm)
  // 就寢在午夜後、現在是午夜到就寢之間：還是前一晚（晚上 9 點起一路接著算，不會過了午夜就斷掉）
  const late = bed > 1440 && nowMin < bed - 1440
  // 過了就寢還沒睡：就寢後 4 小時內、還沒到起床時間（就寢在午夜後的，nowGuide 把就寢之後當成起床前）
  const past = g.phase === 'over' || ((nowMin - bed + 2880) % 1440 < 240 && nowMin < wake)
  if (!late && !past && (g.phase === 'early' || (g.toBed > FIRST_EVE && nowMin < 21 * 60))) return null
  return nowMin < wake ? 0 : 1
}

// ── 專注頁上的「接下來」（時間感：專心時很容易忘了等一下要開會）──
// events：今天有時段的日程（照開始時間排好）；nowMin：現在幾分；roundEnd：這一輪專注幾點結束（分鐘，可以超過 1440；
// 不知道、往上數的是 null）。回傳下一個還沒結束、還沒標成做完的日程：
//   { event, now: 正在進行, until: 還有幾分鐘開始（進行中是還有幾分鐘結束）, clash: 會在這一輪結束前開始 }
// 進行中的、會撞到這一輪的一定給；其他的 within 分鐘內才給，太遠的是 null
export const NEXT_WITHIN = 120
const TIME_OK = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
export function nextEvent(events, nowMin, roundEnd = null, within = NEXT_WITHIN) {
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.done || !TIME_OK(e.start) || !TIME_OK(e.end)) continue
    const s = toM(e.start)
    const end = toM(e.end)
    if (end <= nowMin) continue
    if (s <= nowMin) return { event: e, now: true, until: end - nowMin, clash: false }
    const clash = roundEnd != null && s < roundEnd
    return clash || s - nowMin <= within ? { event: e, now: false, until: s - nowMin, clash } : null
  }
  return null
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
