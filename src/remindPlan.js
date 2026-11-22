// App 關著（或在背景、頁面被凍住）時的提醒：日程開始前、排定的任務開始時、就寢前。
// 照現在的資料先排好接下來 47 小時的每一則，交給手機的鬧鐘（Android 殼：native.js 的 sendReminders）。
// 規則、字跟頁面開著時的提醒一樣（reminders.js 的 check、main.js 的 onRemind），key 也一樣（`${id}@${開始時間}`，記在那一天）：
// 頁面已經提醒過的不排；手機發過的，回到 App 時記成提醒過（reminders.js 的 markSent），不會再跳一次提示卡。
// 例行公事還沒長出來的那幾天（明天、後天）照例行公事本身排，id 跟之後長出來的那一筆一樣
import { addDays, dateStr, repeatMatches, routineInstanceId, stampAt } from './store/util.js'

export const REMIND_AHEAD = 47 * 3600000
// 手機最多排幾則（一天十幾件排了時段的也排得下）
export const REMIND_MAX = 60
// 看今天起幾天（47 小時加上提前的分鐘數、換夏令時間少掉的那一小時，都還在裡面）
const DAYS = 4
// 晚到多久還發：開始後 15 分鐘內（跟頁面一樣，睡著時錯過的也補）；就寢的到就寢那一刻
const LATE = 15 * 60000

const stamp = stampAt

// 那一天有時段的日程、排了時段的任務（例行公事還沒長出來的也算）：[項目, 種類]
function itemsOn(store, date) {
  const s = store.state
  const own = (x) => !store.isSample?.(x) && !x.done
  const events = store.eventsOn(date).filter((e) => own(e) && !store.isCont?.(e) && !String(e.id).startsWith('x-'))
  const tasks = store.tasksOn(date).filter((t) => t.at && own(t))
  const have = new Set([...events, ...tasks].map((x) => x.id))
  const virtual = []
  for (const r of s.routines || []) {
    if (r.startDate > date || r.made?.[date] || !repeatMatches(r.repeat, date)) continue
    const id = routineInstanceId(r, date)
    if (have.has(id)) continue
    if (r.kind === 'task') continue // 例行任務長出來時沒有時段
    virtual.push([{ id, title: r.title, date, start: r.start, end: r.end }, 'event'])
  }
  return [...events.map((e) => [e, 'event']), ...tasks.map((t) => [t, 'task']), ...virtual]
}

// 接下來要響的那幾則：[{ at, until, key, date, title, body, tag }]（照時間排；until：晚到這個時間以後就不發了）。
// sent：頁面記著的「提醒過了」（reminders.js 的 sent：{ 日期: [key...] }）。
// bed(at)：排在 at 的那一則就寢提醒的字（main.js 決定：ふじ睡前那則同一刻的話只留一則，null 是那一天不排）；也可以直接給字
export function remindPlan(store, now = Date.now(), { sent = {}, bed = null, ahead = REMIND_AHEAD } = {}) {
  const st = store.state.settings
  if (st.remindOn === false || !st.notify) return []
  const lead = st.remindLead
  const today = dateStr(new Date(now))
  const until = now + ahead
  const done = (date, key) => Array.isArray(sent[date]) && sent[date].includes(key)
  const out = []
  const add = (x) => x.at > now && x.at <= until && !done(x.date, x.key) && out.push(x)
  if (lead >= 0) {
    for (let i = 0; i < DAYS; i++) {
      const date = addDays(today, i)
      for (const [x, kind] of itemsOn(store, date)) {
        const at = kind === 'task' ? x.at : x.start
        const start = stamp(date, at)
        const key = `${x.id}@${at}`
        const until = start + LATE
        if (kind === 'event') {
          add({ at: start - lead * 60000, until, key, date, title: `ひより · ${x.title}`, body: lead > 0 ? `${lead} 分鐘後開始（${at}）` : `現在開始（${at}）`, tag: x.id })
          continue
        }
        // 排定的任務：提前的那一次，和開始的那一刻（「現在開始吧」，頁面開著時是 taskStart）；提前 0 分鐘就只有開始那一次
        if (lead > 0) add({ at: start - lead * 60000, until: start, key, date, title: `ひより · ${x.title}`, body: `排定的任務・${lead} 分鐘後開始（${at}）`, tag: x.id })
        add({ at: start, until, key: `${key}!`, date, title: `ひより · ${x.title}`, body: `排在 ${at}，現在開始吧`, tag: x.id })
      }
    }
  }
  // 就寢前 30 分鐘：每一天的就寢那一刻往前 30 分鐘（換夏令時間那天也對），記在提醒響的那一天（跟 reminders.js 一樣）
  const r = store.state.rhythm
  if (r?.bedRemind && bed) {
    for (let i = 0; i < DAYS; i++) {
      const sleep = stamp(addDays(today, i), r.sleep)
      const at = sleep - 30 * 60000
      const text = typeof bed === 'function' ? bed(at) : bed
      if (text) add({ at, until: sleep, key: `bed@${r.sleep}`, date: dateStr(new Date(at)), title: text.title, body: text.body, tag: 'bedtime' })
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, REMIND_MAX)
}
