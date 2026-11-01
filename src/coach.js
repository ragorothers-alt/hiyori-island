// ふじ的排程教練：依問卷的回答，把主攻項目排進接下來幾天的空檔。純函式，方便測試。
//
// 換成 AI 的接點是 askCoach：現在直接用本機規則 planRules；之後要接 Claude，只要讓 askCoach 把同一份 req
// 送到 Worker、拿回同樣格式的 res，畫面和套用的流程都不用改。
//
// req = {
//   dates: ['YYYY-MM-DD', …]                   要排的日子（scopeDates 算好的）
//   focus: [{ label, tag, milestone? }]          主攻項目；專案帶著下一個還沒完成的里程碑
//   slots: ['wdEve', …]                         有空的時段（SLOTS 的 id）
//   exam: { title, date, only? } | null         考試或截止日；only：只跟這個主攻項目有關（專案的截止日），沒有就是學習和工作的項目都有關
//   days: 3 | 5 | 7                             一週想做到幾天
//   len: 25 | 50 | 90                           每段幾分鐘
//   total: 分鐘 | null                           一行輸入寫了總時數（例如「3小時」）時，照總時數切段
//   seed: 0                                     「換個排法」就換一個數字
//   ctx: { today, nowMin, rhythm, events, tasks } events／tasks：這幾天已經有的日程、排了時段的任務
// }
// res = { days: [{ date, items: [{ title, label, tag, dur, at, priority }] }], unplaced, totalMin, picked, notes: [] }
import { awake, busyOf, gaps, toM, toHHMM } from './planner.js'
import { PHASES, EXAM_PHASES } from './data/coachLines.js'
import { TAGS, WEEK_ZH } from './theme.js'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (date) => new Date(date + 'T00:00:00')
export const addDays = (date, n) => {
  const d = parse(date)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
const weekday = (date) => parse(date).getDay()
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000)
const round5 = (m) => Math.round(m / 5) * 5
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const dayLabel = (date) => `${+date.slice(5, 7)}/${+date.slice(8)}（${WEEK_ZH[weekday(date)]}）`

// 一段最短 20 分鐘；放不下原本的長度時，試試縮成一半
const MIN_SESSION = 20

// ── 時段：照作息換算成那天的分鐘區間 ──
// 三餐用時間認：10:30 前是早餐、14:30 前是午餐、16:00 後是晚餐
function meal(r, kind) {
  const want = { lunch: [630, 870], dinner: [960, 1260] }[kind]
  for (const m of r.meals || []) {
    const a = toM(m.start)
    if (a >= want[0] && a < want[1]) return [a, toM(m.end)]
  }
  return null
}
const sleepAt = (r) => awake(r)[1]
const workStart = (r) => (r.work ? toM(r.work.start) : 720)
const workEnd = (r) => (r.work ? toM(r.work.end) : 1020)
const lunchOf = (r) => meal(r, 'lunch') || [720, 780]
const dinnerOf = (r) => meal(r, 'dinner') || [1110, 1170]

// days：wd＝平日（一到五）、we＝週末、all＝每天
export const SLOTS = [
  { id: 'wdMorning', label: '平日早上', days: 'wd', range: (r) => [toM(r.wake) + 30, workStart(r)] },
  { id: 'wdNoon', label: '午休／空堂', days: 'wd', range: (r) => [lunchOf(r)[0] - 30, lunchOf(r)[1] + 60] },
  { id: 'wdAfter', label: '下班／放學後', days: 'wd', range: (r) => [workEnd(r), workEnd(r) + 120] },
  { id: 'wdEve', label: '平日晚上', days: 'wd', range: (r) => [dinnerOf(r)[1], sleepAt(r) - 60] },
  { id: 'beforeBed', label: '睡前一小時', days: 'all', range: (r) => [sleepAt(r) - 60, sleepAt(r)] },
  { id: 'weMorning', label: '週末上午', days: 'we', range: (r) => [toM(r.wake) + 60, lunchOf(r)[0]] },
  { id: 'weAfternoon', label: '週末下午', days: 'we', range: (r) => [lunchOf(r)[1], dinnerOf(r)[0]] },
  { id: 'weEve', label: '週末晚上', days: 'we', range: (r) => [dinnerOf(r)[1], sleepAt(r) - 60] },
]
const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]))
const onDay = (slot, date) => {
  const wd = weekday(date)
  return slot.days === 'all' || (slot.days === 'we') === (wd === 0 || wd === 6)
}
// 介面上的說明：「19:30–22:30」
export function slotText(id, rhythm) {
  const s = SLOT_BY_ID[id]
  if (!s) return ''
  const [a, b] = s.range(rhythm)
  return b > a ? `${toHHMM(a)}–${toHHMM(b)}` : ''
}
// 預設勾選：平日晚上和週末白天，作息裡沒有上班時段的話加上平日早上
export function defaultSlots(rhythm) {
  return rhythm.work ? ['wdEve', 'weMorning', 'weAfternoon'] : ['wdMorning', 'wdEve', 'weMorning', 'weAfternoon']
}

// ── 範圍：today 今天、day 指定那天、rest 這週剩下的天（到星期天）、next 下週一到下週日 ──
export function scopeDates(kind, today, date = today) {
  if (kind === 'day') return [date]
  if (kind === 'today') return [today]
  const mon = addDays(today, -((weekday(today) + 6) % 7))
  const [a, b] = kind === 'next' ? [addDays(mon, 7), addDays(mon, 13)] : [today, addDays(mon, 6)]
  const out = []
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d)
  return out
}

// ── 一行輸入：「這週的數學複習 3小時」→ 範圍、總時數、主攻項目 ──
const STUDY_RE = /讀|書|複習|預習|考|背|單字|作業|功課|數學|英文|國文|物理|化學|生物|地科|歷史|地理|公民|論文|課|練習題|閱讀/
const WORK_RE = /報告|會議|專案|簡報|客戶|企劃|提案|開發|程式|設計|工作|報表|文件/
const HEALTH_RE = /運動|跑|健身|瑜伽|伸展|游泳|散步|重訓|騎車|球/
const IDEA_RE = /靈感|點子|發想|創作|畫|寫作|小說|作曲/
const LIFE_RE = /整理|打掃|家事|採買|煮|洗|收納|繳/
export function guessTag(label) {
  if (STUDY_RE.test(label)) return 'study'
  if (WORK_RE.test(label)) return 'work'
  if (HEALTH_RE.test(label)) return 'health'
  if (IDEA_RE.test(label)) return 'idea'
  if (LIFE_RE.test(label)) return 'life'
  return 'study'
}

export function parseCoachText(text, today) {
  let s = ` ${String(text || '').trim()} `
  const out = { scope: null, date: null, total: null, len: null, tag: null, focus: [] }
  const take = (re, fn) => {
    const m = s.match(re)
    if (!m) return
    fn(m)
    s = s.replace(re, ' ')
  }
  take(/下(?:個)?(?:週|周|禮拜|星期)/, () => (out.scope = 'next'))
  take(/(?:這|本)(?:個)?(?:週|周|禮拜|星期)|週末|周末/, () => (out.scope ??= 'rest'))
  take(/今天|今日|今晚/, () => (out.scope ??= 'today'))
  take(/明天|明日/, () => {
    out.scope ??= 'day'
    out.date ??= addDays(today, 1)
  })
  take(/後天/, () => {
    out.scope ??= 'day'
    out.date ??= addDays(today, 2)
  })
  take(/(\d+(?:\.\d+)?)\s*(?:個)?\s*(?:小時|鐘頭|hrs?|h)(?![a-z])/i, (m) => (out.total = clamp(Math.round(+m[1] * 60), 15, 3000)))
  take(/(\d+)\s*(?:分鐘|分|mins?)(?![a-z])/i, (m) => (out.len = clamp(round5(+m[1]), 15, 120)))
  take(/[#＃](\S+)/, (m) => {
    const t = TAGS.find((x) => x.id === m[1].toLowerCase() || x.label === m[1])
    if (t) out.tag = t.id
  })
  // 剩下的字：去掉開頭的「我想、幫我排」和前後的「的」，用頓號、逗號、和、跟切成幾個項目
  out.focus = s
    .split(/[、，,;；/]|和|跟|與|及|\s+/)
    .map((x) => x.replace(/^(?:我想要|我想|想要|我要|幫我|請)?(?:排一下|安排|規劃|排)?的?/, '').replace(/的$/, '').trim())
    .filter((x) => x.length >= 1 && x.length <= 16)
    .slice(0, 6)
  return out
}

// ── 排程 ──
function mergeWins(list) {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const out = []
  for (const [a, b] of s) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

// 那天選的時段裡、扣掉三餐、日程、已排任務（含緩衝）之後的空檔
function dayInfo(date, req) {
  const { ctx, slots } = req
  const r = ctx.rhythm
  const events = ctx.events.filter((e) => e.date === date)
  const tasks = ctx.tasks.filter((t) => t.date === date && t.at && !t.done)
  const busy = busyOf({ rhythm: r, date, events, tasks })
  let from = 0
  if (date === ctx.today && ctx.nowMin != null) from = Math.ceil((ctx.nowMin + 5) / 5) * 5
  if (date < ctx.today) from = 1440
  const [w, sl] = awake(r)
  const wins = []
  for (const id of slots) {
    const slot = SLOT_BY_ID[id]
    if (!slot || !onDay(slot, date)) continue
    const [a, b] = slot.range(r)
    wins.push([Math.max(a, w, from), Math.min(b, sl)])
  }
  const merged = mergeWins(wins).filter(([a, b]) => b - a >= 15)
  const free = merged.reduce((sum, [a, b]) => sum + gaps(a, b, busy).reduce((x, [p, q]) => x + q - p, 0), 0)
  return { date, busy, wins: merged, free, events: events.length }
}

// 在那天的空檔裡從早到晚找第一個放得下的位置；放好就把它（含緩衝）記成忙碌
function place(day, dur, buf) {
  for (const [a, b] of day.wins) {
    for (const [p, q] of gaps(a, b, day.busy)) {
      const s = Math.ceil(p / 5) * 5
      if (s + dur <= q) {
        day.busy.push([s - buf, s + dur + buf])
        return s
      }
    }
  }
  return null
}

// 從 n 個候選裡挑 k 天：盡量平均錯開，同樣位置附近挑空檔多的；seed 讓整排往前或往後挪
function spread(cands, k, seed) {
  const n = cands.length
  if (k >= n) return cands.slice()
  const shift = (((seed * 0.618) % 1) - 0.5) * (n / k) * 0.6
  const picked = new Set()
  for (let i = 0; i < k; i++) {
    const ideal = ((i + 0.5) * n) / k - 0.5 + shift
    let best = -1
    let bestScore = Infinity
    for (let j = 0; j < n; j++) {
      if (picked.has(j)) continue
      const score = Math.abs(j - ideal) - Math.min(cands[j].free, 300) / 600
      if (score < bestScore) {
        best = j
        bestScore = score
      }
    }
    picked.add(best)
  }
  return [...picked].sort((a, b) => a - b).map((j) => cands[j])
}

// 總時數切成差不多長的幾段（每段接近 len，加起來剛好是總時數；以 5 分鐘為單位）
function splitTotal(total, len) {
  const n = Math.max(1, Math.round(total / len))
  const base = Math.max(MIN_SESSION, Math.floor(total / n / 5) * 5)
  let rest = Math.max(0, round5(total) - base * n)
  return Array.from({ length: n }, () => {
    const extra = Math.min(rest, 5 * Math.ceil(rest / 5 / n) || 0)
    rest -= extra
    return Math.min(180, base + extra)
  })
}

export function planRules(req) {
  const { dates, focus, days = 5, len = 50, total = null, seed = 0, ctx } = req
  // 考試或截止日只影響有關的主攻項目；一個有關的都沒有就當作沒有
  const related = (f) => !!req.exam && (req.exam.only ? f.label === req.exam.only : f.tag === 'study' || f.tag === 'work')
  const exam = req.exam && focus.some(related) ? req.exam : null
  const buf = ctx.rhythm.buffer || 0
  const notes = []
  const empty = { days: [], unplaced: 0, totalMin: 0, picked: 0, notes }
  if (!dates.length || !focus.length || !req.slots.length) return empty

  const info = dates.map((d) => dayInfo(d, req))
  const examDay = exam && dates.includes(exam.date) && exam.date >= ctx.today ? exam.date : null
  const cands = info.filter((d) => d.free >= MIN_SESSION && d.date !== examDay)
  if (!cands.length && !examDay) return empty

  // 要排幾天：一週想做幾天換算成這段範圍的天數；寫了總時數時不超過段數
  const chunks = total ? splitTotal(total, len) : null
  let want = dates.length === 1 ? 1 : clamp(Math.round((days * dates.length) / 7), 1, dates.length)
  if (chunks) want = Math.min(want, chunks.length)
  let chosen = spread(cands, Math.min(want, cands.length), seed)
  // 考試前一天一定要排總複習
  const eve = exam ? addDays(exam.date, -1) : null
  const eveDay = cands.find((d) => d.date === eve)
  if (eveDay && !chosen.includes(eveDay) && chosen.length) {
    const near = chosen.reduce((a, b) => (Math.abs(daysBetween(b.date, eve)) < Math.abs(daysBetween(a.date, eve)) ? b : a))
    chosen = chosen.map((d) => (d === near ? eveDay : d)).sort((a, b) => a.date.localeCompare(b.date))
  }
  if (cands.length && chosen.length < want) notes.push(`有空的日子只有 ${chosen.length} 天，先排這幾天`)
  const rest = info.filter((d) => !chosen.includes(d) && d.date !== examDay && d.events >= 2)
  if (rest.length) notes.push(`${dayLabel(rest[0].date)}已經有 ${rest[0].events} 個日程，我讓它休息`)

  // 每天幾段：輕量 1 段；穩定和全力 2 段（放得下的話）；只排一天又選全力時最多 3 段
  const perDay = (d) => {
    if (days <= 3) return 1
    let n = d.free >= 2 * len + buf ? 2 : 1
    if (days >= 7 && dates.length <= 2 && d.free >= 3 * len + 2 * buf) n = 3
    return n
  }
  const plan = new Map(chosen.map((d) => [d.date, []]))
  if (chunks) chunks.forEach((dur, i) => plan.get(chosen[i % chosen.length].date).push(dur))
  else for (const d of chosen) for (let i = 0; i < perDay(d); i++) plan.get(d.date).push(len)

  // 主攻項目輪流（平滑加權輪替）：考試、截止日前，學習和工作的項目多排一點；同一天盡量不重複
  const prep = (f, date) => exam && date < exam.date && related(f)
  // seed 決定從哪一項開始輪
  const n = focus.length
  const cur = focus.map((_, i) => -((((i - seed) % n) + n) % n) * 0.001)
  const count = focus.map(() => 0)
  const nextItem = (date, avoid) => {
    const w = focus.map((f) => (prep(f, date) ? 1.5 : 1))
    const sum = w.reduce((a, b) => a + b, 0)
    for (let i = 0; i < focus.length; i++) cur[i] += w[i]
    let best = -1
    for (let i = 0; i < focus.length; i++) {
      if (avoid.has(i) && avoid.size < focus.length) continue
      if (best < 0 || cur[i] > cur[best]) best = i
    }
    cur[best] -= sum
    return best
  }
  const titleOf = (i, date) => {
    const f = focus[i]
    const k = count[i]++
    const left = exam && related(f) ? daysBetween(date, exam.date) : 0
    const work = f.tag !== 'study'
    // 截止日前一天的專案：收尾確認比下一個里程碑重要
    if (f.milestone && left !== 1) return `${f.label}・${f.milestone}`
    const list =
      left === 1 ? (work ? EXAM_PHASES.finalWork : EXAM_PHASES.final)
      : left >= 2 && left <= 3 ? (work ? EXAM_PHASES.mockWork : EXAM_PHASES.mock)
      : PHASES[f.tag] || PHASES.life
    return `${f.label}・${list[(k + seed) % list.length]}`
  }

  const out = []
  let unplaced = 0
  for (const d of info) {
    const items = []
    for (const dur0 of plan.get(d.date) || []) {
      const used = new Set(items.map((x) => x.i))
      const i = nextItem(d.date, used)
      let dur = dur0
      let at = place(d, dur, buf)
      if (at == null && round5(dur / 2) >= MIN_SESSION) {
        dur = round5(dur / 2)
        at = place(d, dur, buf)
      }
      if (at == null) {
        unplaced++
        continue
      }
      const f = focus[i]
      items.push({ i, title: titleOf(i, d.date), label: f.label, tag: f.tag, dur, at: toHHMM(at), priority: prep(f, d.date) ? 3 : 2 })
    }
    // 考試當天：只排 15 分鐘看重點
    if (d.date === examDay) {
      const i = Math.max(0, focus.findIndex(related))
      const at = place(d, 15, buf)
      if (at != null) {
        const f = focus[i]
        const light = f.tag === 'study' ? EXAM_PHASES.light : EXAM_PHASES.lightWork
        items.push({ i, title: `${f.label}・${light[seed % light.length]}`, label: f.label, tag: f.tag, dur: 15, at: toHHMM(at), priority: 2 })
        notes.push(`「${exam.title}」當天只排 15 分鐘看重點`)
      }
    }
    if (items.length) out.push({ date: d.date, items: items.sort((a, b) => a.at.localeCompare(b.at)).map(({ i, ...x }) => x) })
  }
  if (eveDay && out.some((d) => d.date === eve)) notes.unshift(`「${exam.title}」前一天排了${exam.only ? '收尾確認' : '總複習'}`)
  const totalMin = out.reduce((a, d) => a + d.items.reduce((x, it) => x + it.dur, 0), 0)
  return { days: out, unplaced, totalMin, picked: out.length, notes }
}

// 換成 AI 的接點（見檔頭）
export async function askCoach(req) {
  return planRules(req)
}
