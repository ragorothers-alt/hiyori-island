// 習慣養成與戒除：純函式，方便測試。
// 養成（build）：每天打卡次數 log[日期]，達到 target 算完成；days 是要做的星期（空的＝每天）。
// 戒除（quit）：slips 記錄破戒 [{ at, note }]，從最後一次破戒（或開始那天）起算乾淨的天數；urges[日期] 是忍住的次數。

const DAY = 86400000
const ds = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const pd = (s) => new Date(s + 'T00:00:00')
const shift = (s, n) => {
  const d = pd(s)
  d.setDate(d.getDate() + n)
  return ds(d)
}
const between = (a, b) => Math.round((pd(b) - pd(a)) / DAY)

export const HABIT_ICONS = ['水', '走', '書', '眠', '瑜', '菜', '筆', '靜', '早', '歌', '掃', '茶', '禁', '酒', '菸', '糖', '機', '夜', '飲', '錢']
export const QUIT_MILESTONES = [1, 3, 7, 14, 21, 30, 60, 90, 100, 180, 365]

// 常見的習慣，一鍵加入
export const HABIT_TEMPLATES = [
  { kind: 'build', name: '喝水', icon: '水', target: 8, unit: '杯', color: 0 },
  { kind: 'build', name: '散步或運動 30 分鐘', icon: '走', target: 1, unit: '次', color: 3 },
  { kind: 'build', name: '閱讀 20 頁', icon: '書', target: 1, unit: '次', color: 1 },
  { kind: 'build', name: '早起', icon: '早', target: 1, unit: '次', color: 4 },
  { kind: 'build', name: '冥想 5 分鐘', icon: '靜', target: 1, unit: '次', color: 5 },
  { kind: 'build', name: '寫日記', icon: '筆', target: 1, unit: '次', color: 2 },
  { kind: 'quit', name: '熬夜', icon: '夜', color: 3 },
  { kind: 'quit', name: '手搖飲', icon: '飲', color: 1 },
  { kind: 'quit', name: '睡前滑手機', icon: '機', color: 0 },
  { kind: 'quit', name: '吃宵夜', icon: '糖', color: 4 },
  { kind: 'quit', name: '衝動購物', icon: '錢', color: 2 },
  { kind: 'quit', name: '抽菸', icon: '菸', color: 5 },
]

export const startOf = (h) => h.start || ds(new Date(h.createdAt || Date.now()))
export const applies = (h, date) => date >= startOf(h) && (!h.days?.length || h.days.includes(pd(date).getDay()))
export const countOn = (h, date) => h.log?.[date] || 0
export const doneOn = (h, date) => countOn(h, date) >= (h.target || 1)

// 養成：連續天數。今天還沒打卡不算中斷（從昨天往回數）；不用做的星期跳過
export function streak(h, today) {
  let n = 0
  let d = doneOn(h, today) ? today : shift(today, -1)
  const start = startOf(h)
  for (let i = 0; i < 3700 && d >= start; i++, d = shift(d, -1)) {
    if (!applies(h, d)) continue
    if (!doneOn(h, d)) break
    n++
  }
  return n
}

export function bestStreak(h, today) {
  let best = 0
  let cur = 0
  const start = startOf(h)
  for (let d = start, i = 0; d <= today && i < 3700; d = shift(d, 1), i++) {
    if (!applies(h, d)) continue
    if (doneOn(h, d)) best = Math.max(best, ++cur)
    else if (d !== today) cur = 0
  }
  return best
}

// 最近 days 天（從開始那天起算）的達成率
export function rate(h, today, days = 30) {
  let need = 0
  let got = 0
  for (let i = 0; i < days; i++) {
    const d = shift(today, -i)
    if (!applies(h, d)) continue
    // 今天還沒結束：做到了才算進去
    if (d === today && !doneOn(h, d)) continue
    need++
    if (doneOn(h, d)) got++
  }
  return need ? got / need : 0
}

// 戒除：破戒的時間戳（舊資料可能直接是數字）
const slipTimes = (h) => (h.slips || []).map((x) => (typeof x === 'number' ? x : x.at))
// 最後一次破戒（沒有就是開始那天）
export const lastSlip = (h) => (h.slips?.length ? ds(new Date(Math.max(...slipTimes(h)))) : startOf(h))
export const slippedOn = (h, date) => slipTimes(h).some((t) => ds(new Date(t)) === date)
// 乾淨的天數：破戒那天算 0
export const cleanDays = (h, today) => Math.max(0, between(lastSlip(h), today))

export function bestClean(h, today) {
  const marks = [startOf(h), ...slipTimes(h).map((t) => ds(new Date(t))).sort(), today]
  let best = 0
  for (let i = 1; i < marks.length; i++) best = Math.max(best, between(marks[i - 1], marks[i]))
  return best
}

// 下一個里程碑
export const nextMilestone = (days) => QUIT_MILESTONES.find((m) => m > days) ?? null

// 熱度圖：最近 weeks 週，以星期一為列首；每格 { date, v }，v：null 未開始／不用做，0～1 完成度；
// 戒除時 v 為 'slip' 破戒、'urge' 忍住了、1 乾淨
export function heat(h, today, weeks = 12) {
  const end = pd(today)
  const back = (end.getDay() + 6) % 7
  const first = shift(today, -back - (weeks - 1) * 7)
  const cells = []
  for (let i = 0; i < weeks * 7; i++) {
    const date = shift(first, i)
    let v = null
    if (date > today || date < startOf(h)) v = null
    else if (h.kind === 'quit') v = slippedOn(h, date) ? 'slip' : h.urges?.[date] ? 'urge' : 1
    else if (applies(h, date)) v = Math.min(1, countOn(h, date) / (h.target || 1))
    cells.push({ date, v })
  }
  return cells
}

// 今天要做的養成習慣與完成數
export function todayProgress(habits, today) {
  const list = habits.filter((h) => !h.archived && h.kind === 'build' && applies(h, today))
  return { total: list.length, done: list.filter((h) => doneOn(h, today)).length }
}
