// 往前看：截止日和專案會不會來不及（App 自己照規則算，不問 Claude；Claude 只負責怎麼說、給什麼辦法）。
// 截止日：截止日前所有沒做完的任務，剩下的工作量 × 平常的超時倍率，跟這段時間空檔的七成比
//   ok 來得及（用不到六成）、tight 很緊（六成到全部）、late 來不及（超過）。
// 專案：最近 4 週完成里程碑的速度，推算照這樣下去哪天做完，跟期限比；最近都沒推進的是 stalled（停住了）。
// 等級變了（變差）才說一次，由 riskWatch 記著上一次的等級
import { awake, busyOf, gaps, taskDur, FILL } from './planner.js'
import { addDays, daysBetween } from './store/util.js'
import { floating } from './store/migrate.js'
import { projectStats } from './projects.js'

export const RISK_TIGHT = 0.6
// 看多遠以內的截止日
export const RISK_DAYS = 60
// 專案停了幾天算停住
export const STALL_DAYS = 7
const DAY = 86400000
const RANK = { ok: 0, tight: 1, stalled: 1, late: 2 }
// 比上一次差了嗎（沒有上一次算 ok）
export const worse = (now, before = 'ok') => (RANK[now] ?? 0) > (RANK[before] ?? 0)

// 那天還能用來做事的分鐘：醒著的時間扣掉三餐、日程（任務不扣：任務本身就是要放進來的工作）。今天從現在算起
export function roomOn({ rhythm, date, today, nowMin = null, events = [] }) {
  if (date < today) return 0
  const [w, s] = awake(rhythm)
  const from = date === today && nowMin != null ? Math.max(w, nowMin) : w
  return gaps(from, s, busyOf({ rhythm, date, events, tasks: [] })).reduce((a, [x, y]) => a + (y - x), 0)
}

// 還要做多久：預估扣掉已經專注過的；超過預估還沒做完的，至少算 15 分鐘（多半還差一點收尾）
const leftOf = (t) => Math.max(Math.min(15, taskDur(t)), taskDur(t) - (t.spent || 0))

// 每一個截止日：[{ date, level, need, room, ids }]，照日期排。
// need 是那天以前截止、還沒做完的全部工作（分鐘，乘過超時倍率）；room 是從現在到那天的空檔七成；ids 是那天截止的任務
export function dueRisks({ tasks, eventsOn = () => [], rhythm, today, nowMin = null, ratio = 1, days = RISK_DAYS }) {
  const until = addDays(today, days)
  const open = (tasks || []).filter((t) => !t.done && t.due && t.due >= today && t.due <= until && !floating(t))
  const dates = [...new Set(open.map((t) => t.due))].sort()
  // 平常提早做完的不縮（寧可說得保守）
  const k = Math.max(1, Number(ratio) || 1)
  const out = []
  let room = 0
  let day = today
  for (const d of dates) {
    for (; day <= d; day = addDays(day, 1)) room += roomOn({ rhythm, date: day, today, nowMin, events: eventsOn(day) })
    const need = Math.round(open.filter((t) => t.due <= d).reduce((a, t) => a + leftOf(t), 0) * k)
    const cap = Math.round(room * FILL)
    const level = need <= cap * RISK_TIGHT ? 'ok' : need <= cap ? 'tight' : 'late'
    out.push({ date: d, level, need, room: cap, ids: open.filter((t) => t.due === d).map((t) => t.id) })
  }
  return out
}

// 每一個有期限、還在進行的專案：[{ id, level, left, deadline, eta?, pace?, late?, idle? }]。
// App 附的範例專案（還沒寫進自己的東西）不算；還沒開始、已經過了期限的也不算（過期的畫面上本來就標著）
export function projectRisks({ projects, tasks = [], today, now = Date.now() }) {
  const out = []
  for (const p of projects || []) {
    if (p.archived || p.completedAt || p.pausedAt || !p.deadline || p.deadline < today) continue
    if (String(p.id).startsWith('ex-') && !p.mine) continue
    const left = p.milestones.filter((m) => !m.done).length
    if (!left) continue
    const since = now - 28 * DAY
    const done = p.milestones.filter((m) => m.done && m.doneAt >= since).length
    const last = projectStats(p, tasks).last || p.createdAt || now
    const idle = Math.max(0, Math.floor((now - last) / DAY))
    if (!done) {
      // 最近 4 週一個里程碑都沒完成：停了一陣子才說（剛建好、剛開始的不算）
      if (idle >= STALL_DAYS) out.push({ id: p.id, level: 'stalled', left, deadline: p.deadline, idle })
      continue
    }
    // 開始不到 4 週的專案：用開始到現在的時間算速度（至少算一週，免得剛完成一個就算成飛快）
    const weeks = Math.min(4, Math.max(1, (now - (p.createdAt || since)) / (7 * DAY)))
    const pace = done / weeks
    const eta = addDays(today, Math.ceil((left / pace) * 7))
    out.push({ id: p.id, level: eta <= p.deadline ? 'ok' : 'late', left, deadline: p.deadline, eta, pace: Math.round(pace * 10) / 10, late: Math.max(0, daysBetween(p.deadline, eta)) })
  }
  return out
}
