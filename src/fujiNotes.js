// ふじ在 App 關著時的通知（一天最多 3 則）：
//   早上：起床後 30 分鐘，今天的安排（那之前已經打開過 App 就不送）
//   風險：照現在的安排，截止日會在哪個時候變得很緊、來不及（跟 App 開著時一樣，比上一次差了才說），一天最多一則
//   睡前：就寢前 30 分鐘，明天先做哪一件
// 照現在的資料在這台裝置上先寫好（不問 Claude，也不把資料交給伺服器），交給推播排時間：
// 網頁跟警語同一串交給伺服器（伺服器只知道幾點），Android 殼交給手機的鬧鐘（native.js 的 sendFujiNotes）。
// 開會（有時段的日程）、專注中的那段挪到結束後再送，挪到睡覺時間就不送。
// 只從一台送（settings.fujiNotify 是那一台的代號、'off' 是不送；還沒決定的話手機先送）
import { dueRisks, worse } from './risk.js'
import { addDays, dateStr, daysBetween, parseDate } from './store/util.js'
import { toM, bedAt, fmtDur } from './planner.js'
import { order } from './brief.js'
import { dayWord } from './agent.js'
import { short } from './voice.js'

// 排幾天：今天起三天（App 一直沒打開的話，第四天起就不送了；內容是排的時候的樣子，太久就不準了）
export const NOTE_DAYS = 3
export const MORNING_AFTER = 30
export const BED_BEFORE = 30
// 起床前兩小時以後打開過 App：今天看過了，早上那則不送
export const OPENED_WITHIN = 120
// 跟警語錯開幾秒：警語排在整分，同一刻到點的話一則推播只顯示得出其中一則
export const NOTE_OFFSET = 17000
// 日程、專注結束後隔幾分鐘再送
const GAP = 5
// 風險每半小時看一次
const STEP = 30
// 早上那則最晚挪到起床後幾分鐘（再晚就不算早上了）；風險那則最早幾點
const MORNING_UNTIL = 180
const RISK_FROM = 8 * 60
// 兩則至少隔多久
const SPACE = 120000
// 最遠排到多久以後：伺服器只收 48 小時內的（worker/src/push.js 的 MOTTO_AFTER），留一小時給排好到交出去之間
export const NOTE_AHEAD = 47 * 3600000

const DEVICE_KEY = 'hiyori-device'
let memId = ''
// 這台裝置的代號（存在這台，不同步）：設定裡「這台接收ふじ的通知」認得出是哪一台
export function deviceId() {
  try {
    const id = localStorage.getItem(DEVICE_KEY)
    if (/^[a-z0-9]{8,24}$/.test(id || '')) return id
    const made = Math.random().toString(36).slice(2, 12).padEnd(10, '0')
    localStorage.setItem(DEVICE_KEY, made)
    return made
  } catch {
    return (memId ||= `m${Math.random().toString(36).slice(2, 11)}`)
  }
}
// 這台要不要送：選了這台；還沒選過的話，手機（Android 殼、手機的瀏覽器）先送
export const notesHere = (value, id, phone) => value === id || (!value && !!phone)

// 某個時間是 date 那天 0 點起的第幾分鐘（照牆上的時鐘算、不用毫秒差，日光節約時間那天也對；有秒數就進到下一分鐘）
const minOf = (date, ms) => {
  const d = new Date(ms)
  return daysBetween(date, dateStr(d)) * 1440 + d.getHours() * 60 + d.getMinutes() + (d.getSeconds() || d.getMilliseconds() ? 1 : 0)
}
// 那天 0 點起第幾分鐘 → 時間（超過 1440 是隔天凌晨，就寢在午夜後的那一則）
const atOf = (date, min) => {
  const d = parseDate(date)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min).getTime() + NOTE_OFFSET
}
const endOf = (e) => {
  const s = toM(e.start)
  const t = e.end ? toM(e.end) : s + 60
  return t > s ? t : 1440
}

// 落在有時段的日程裡、專注中的：挪到結束後。挪過 limit（分鐘）就不送（null）
function settle(date, min, limit, { eventsOn, quietUntil }) {
  let m = min
  for (let i = 0; i < 10; i++) {
    if (quietUntil && atOf(date, m) < quietUntil) {
      m = minOf(date, quietUntil) + GAP
      continue
    }
    // 午夜後的那段（就寢在午夜後）看隔天凌晨的日程
    const day = m >= 1440 ? addDays(date, 1) : date
    const off = m >= 1440 ? 1440 : 0
    const hit = eventsOn(day).find((e) => !e.allDay && toM(e.start) + off <= m && m < endOf(e) + off)
    if (!hit) break
    m = endOf(hit) + off + GAP
  }
  return m < limit ? m : null
}

const quote = (t, n = 14) => `「${short(t.title || '', n)}」`

function morningBody(date, c) {
  const todo = order(c.tasksOn(date))
  const evs = c.eventsOn(date).filter((e) => !e.allDay)
  const due = c.tasks.filter((t) => !t.done && t.due === date)
  if (!todo.length && !evs.length) return c.auto ? '今天還沒排事情。打開 App，我先幫你排好。' : '今天還沒排事情，打開 App 看看要做什麼吧。'
  const parts = []
  const count = [todo.length ? `${todo.length} 件事` : '', evs.length ? `${evs.length} 個日程` : ''].filter(Boolean).join('、')
  const first = todo[0]
  parts.push(first ? `今天 ${count}，先做${quote(first)}${first.at ? `（${first.at}）` : ''}。` : `今天 ${count}，第一個是 ${evs[0].start}${quote(evs[0])}。`)
  if (due.length) parts.push(`${quote(due[0])}${due.length > 1 ? ` 等 ${due.length} 件` : ''}今天截止。`)
  return parts.join('')
}

function bedBody(date, c) {
  const next = order(c.tasksOn(addDays(date, 1)))[0]
  const parts = [next ? `明天先做${quote(next)}${next.at ? `（${next.at}）` : ''}。` : c.auto ? '明天還沒排事情，早上我再幫你排。' : '明天還沒排事情。']
  // 今天還沒做完的：只有排的就是今天時才說（之後幾天的照排的時候算，不準）
  if (date === c.today) {
    const left = order(c.tasksOn(date)).length
    if (left) parts.push(`今天還有 ${left} 件沒做完，${c.auto ? '明早我會重新排過' : '明天再看看'}。`)
  }
  parts.push('早點休息。')
  return parts.join('')
}

function riskText(r, date, c) {
  const name = (id) => c.tasks.find((t) => t.id === id) || { title: '' }
  const titles = r.ids.slice(0, 2).map((id) => quote(name(id), 12)).join('') + (r.ids.length > 2 ? ` 等 ${r.ids.length} 件` : '')
  const when = dayWord(r.date, date)
  if (r.level === 'late') return { title: 'ふじ · 截止日來不及了', body: `${titles}${when}截止，照現在的空檔做不完（還要約 ${fmtDur(r.need)}，能用約 ${fmtDur(r.room)}）。打開 App 跟我商量。` }
  return { title: 'ふじ · 截止日有點緊', body: `${titles}${when}截止，時間有點緊。${c.auto ? '打開 App，我幫你提早分段排好。' : '先把它分段排進前幾天吧。'}` }
}

// 照現在的安排、什麼都不做下去，哪一刻第一次有截止日比 memo（上一次說過的等級）差：一天最多一則。
// 空檔只會越用越少，等級只會越來越差：每天用二分法找那一刻（不用每半小時算一次）
function riskNotes(c, wake, bed, nowMin) {
  const out = []
  const seen = { ...c.memo }
  const cache = new Map()
  const eventsOn = (d) => {
    if (!cache.has(d)) cache.set(d, c.eventsOn(d))
    return cache.get(d)
  }
  for (let k = 0; k < NOTE_DAYS; k++) {
    const date = addDays(c.today, k)
    let lo = Math.max(wake + 60, RISK_FROM)
    const hi = Math.min(bed, 1440) - 60
    if (c.riskDays?.includes(date)) continue
    // 今天從還沒到的那一格算起（這一格的時間還沒到就算這一格：重算時不會把剛好要到的那一則往後挪）
    if (k === 0) {
      let s = Math.ceil(nowMin / STEP) * STEP
      if (atOf(date, s) <= c.now) s += STEP
      lo = Math.max(lo, s)
    }
    if (lo > hi) continue
    const steps = Math.floor((hi - lo) / STEP)
    const at = (s) => dueRisks({ tasks: c.tasks, eventsOn, rhythm: c.rhythm, today: date, nowMin: lo + s * STEP, ratio: c.ratio })
    const bad = (list) => list.filter((r) => worse(r.level, seen[r.date]))
    const last = at(steps)
    if (!bad(last).length) continue
    let a = 0
    let b = steps
    while (a < b) {
      const mid = (a + b) >> 1
      if (bad(at(mid)).length) b = mid
      else a = mid + 1
    }
    const list = at(a)
    const hit = bad(list).sort((x, y) => (y.level === 'late') - (x.level === 'late') || x.date.localeCompare(y.date))[0]
    for (const r of list) seen[r.date] = r.level
    const m = settle(date, lo + a * STEP, hi + 60, c)
    if (m == null) continue
    const when = atOf(date, m)
    // due、level：送出去之後記成說過了（main.js 的 settleRisk），重算時不再為同一件事說一次
    if (when > c.now) out.push({ at: when, until: atOf(date, hi + 60), kind: 'risk', due: hit.date, level: hit.level, ...riskText(hit, date, c) })
  }
  return out
}

// c：{ today, now（毫秒）, seen（最後一次正看著 App 的時間）, rhythm, tasks, tasksOn(date), eventsOn(date)（有時段的日程，含匯入的、還沒生成的例行日程）,
//      ratio（超時倍率）, memo（每個截止日上一次說過的等級）, riskDays（已經送過風險那則的日子）,
//      quietUntil（專注到幾點，沒在專注是 0）, auto（ふじ會自己整理） }
// 回傳 [{ at, kind, title, body }]（風險那則多了 due、level），照時間排；最遠 NOTE_AHEAD 以內
export function planNotes(c) {
  const wake = toM(c.rhythm.wake)
  const bed = bedAt(c.rhythm)
  const n = new Date(c.now)
  // 現在是今天的第幾分鐘（就寢在午夜後、還沒睡的那段也照日曆算）
  const nowMin = n.getHours() * 60 + n.getMinutes()
  // 今天最後一次看 App 是第幾分鐘（今天還沒看過是 -Infinity）
  const s = new Date(c.seen ?? c.now)
  const seenMin = dateStr(s) === c.today ? s.getHours() * 60 + s.getMinutes() : -Infinity
  const out = []
  for (let k = -1; k < NOTE_DAYS; k++) {
    const date = addDays(c.today, k)
    if (k >= 0 && !(k === 0 && seenMin >= wake - OPENED_WITHIN)) {
      const m = settle(date, wake + MORNING_AFTER, Math.min(wake + MORNING_UNTIL, bed - 60), c)
      if (m != null && atOf(date, m) > c.now) out.push({ at: atOf(date, m), until: atOf(date, Math.min(wake + MORNING_UNTIL, bed - 60)), kind: 'morning', title: 'ふじ · 今天的安排', body: morningBody(date, c) })
    }
    // 昨天的睡前那則只有就寢在午夜後時才可能還沒到
    if (k < 0 && bed < 1440) continue
    const m = settle(date, bed - BED_BEFORE, bed, c)
    if (m != null && atOf(date, m) > c.now) out.push({ at: atOf(date, m), until: atOf(date, bed), kind: 'bed', title: 'ふじ · 差不多該睡了', body: bedBody(date, c) })
  }
  out.push(...riskNotes(c, wake, bed, nowMin))
  out.sort((a, b) => a.at - b.at)
  // 兩則挪到同一刻（例如都等同一個會議結束）：後面那則晚兩分鐘（同一刻到點的話只顯示得出一則）；晚到睡覺時間、不算早上了就不送
  const kept = []
  for (const n of out) {
    const prev = kept.at(-1)
    if (prev && n.at - prev.at < SPACE) n.at = prev.at + SPACE
    if (n.at < n.until && n.at <= c.now + NOTE_AHEAD) kept.push(n)
  }
  return kept.map(({ until, ...n }) => n)
}
