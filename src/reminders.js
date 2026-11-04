// 提醒：日程與排進時段的任務開始前 N 分鐘提醒一次、就寢前 30 分鐘提醒準備睡覺（App 內 + 系統通知）。
// 已提醒過的記錄在 localStorage，重新整理不會重複提醒；改了開始時間會再提醒一次。
import { addDays, dateStr, toMin } from './store.js'

const KEY = 'hiyori-reminded'
// 兩次檢查隔了這麼久，代表電腦睡著、手機鎖著時錯過了：剛開始不久的（LATE 分鐘內）還是補提醒
const GAP = 2 * 60000
const LATE = 15

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export const notifySupported = () => 'Notification' in window

export class Reminders {
  constructor(store, onRemind) {
    this.store = store
    this.onRemind = onRemind
    this.sent = load()
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.sent))
    } catch {}
  }

  // 那天有時間的日程和任務：[項目, 開始時間, 種類, 日期, 分鐘數要加多少（明天的 +1440）]
  _items(date, offset) {
    return [
      ...this.store.eventsOn(date).map((e) => [e, e.start, 'event', date, offset]),
      ...this.store.tasksOn(date).filter((t) => t.at).map((t) => [t, t.at, 'task', date, offset]),
    ]
  }

  // 另一個分頁可能剛提醒過：先把存著的併進來，同一件事兩個分頁只提醒一次
  _merge() {
    for (const [d, keys] of Object.entries(load())) {
      if (!Array.isArray(keys)) continue
      const mine = (this.sent[d] ||= [])
      for (const k of keys) if (!mine.includes(k)) mine.push(k)
    }
  }

  check(now = new Date()) {
    this._merge()
    const lead = this.store.state.settings.remindLead
    const today = dateStr(now)
    const tomorrow = addDays(today, 1)
    const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
    const sent = (this.sent[today] ||= [])
    let changed = false
    // 明天一早的項目，提前提醒的時間落在今天晚上：也要跨過午夜提醒（記在明天那份，過了午夜不會再提醒一次）。
    // 明天的例行日程平常要到明天才生成，這時先生成出來，才提醒得到
    const early = lead >= 0 && mins + lead >= 1440
    if (early) this.store.prepareRoutines?.(tomorrow)
    const items = lead < 0 ? [] : [...this._items(today, 0), ...(early ? this._items(tomorrow, 1440) : [])]
    // 開始後 1 分鐘內打開 App 仍會補提醒；再晚就不吵了。
    // 不過上次檢查是很久以前（電腦睡著時開始了）：剛開始 15 分鐘內的照樣補提醒
    const slept = this.lastCheck != null && now - this.lastCheck > GAP
    this.lastCheck = +now
    const late = slept ? LATE : 1
    for (const [item, at, kind, date, offset] of items) {
      const key = `${item.id}@${at}`
      const done = (this.sent[date] ||= [])
      if (item.done || done.includes(key)) continue
      const start = toMin(at) + offset
      if (mins >= start - lead && mins < start + late) {
        done.push(key)
        changed = true
        this.onRemind(kind === 'task' ? { ...item, start: at } : item, Math.max(0, Math.ceil(start - mins)), kind)
      }
    }
    // 就寢前 30 分鐘（之後 10 分鐘內打開 App 也會補提醒）。照「過了幾分鐘」算，跨過午夜也對得上
    // （就寢 00:25 → 23:55 起的 10 分鐘）；記在這段開始的那一天，過了午夜不會再提醒一次
    const r = this.store.state.rhythm
    const bedKey = `bed@${r.sleep}`
    const at = (toMin(r.sleep) - 30 + 1440) % 1440
    const since = (mins - at + 1440) % 1440
    if (r.bedRemind && since < 10) {
      const night = (this.sent[mins - since >= 0 ? today : addDays(today, -1)] ||= [])
      if (!night.includes(bedKey)) {
        night.push(bedKey)
        changed = true
        this.onRemind({ id: 'bedtime', title: '就寢', start: r.sleep }, 30, 'bed')
      }
    }
    // 重要日子和里程碑期限：前一天和當天，早上 8 點後第一次打開時提醒一次（專案的截止日另外有提醒）
    if (mins >= 480) {
      // 不限筆數：同一天有很多個期限也要一個一個提醒到（畫面上的倒數才有筆數上限）
      for (const d of this.store.upcomingDates(Infinity, 1)) {
        const key = `date-${d.id}@${d.date}`
        if (d.project || sent.includes(key)) continue
        sent.push(key)
        changed = true
        this.onRemind(d, d.days, 'date')
      }
    }
    // 留昨天、今天、明天（跨過午夜的就寢提醒記在昨天那份）
    const yesterday = addDays(today, -1)
    for (const d of Object.keys(this.sent)) {
      if (d !== yesterday && d !== today && d !== tomorrow) {
        delete this.sent[d]
        changed = true
      }
    }
    if (changed) this._save()
  }
}

// 系統通知：有 Service Worker 時用 showNotification（手機必需），否則用 Notification
export async function systemNotify(title, body, tag) {
  if (!notifySupported() || Notification.permission !== 'granted') return false
  const icon = new URL('icons/icon-192.png', document.baseURI).href
  const opts = { body, tag, icon, badge: icon, renotify: true }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, opts)
      return true
    }
    const n = new Notification(title, opts)
    n.onclick = () => {
      window.focus()
      n.close()
    }
    return true
  } catch {
    return false
  }
}
