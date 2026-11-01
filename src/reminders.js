// 提醒：日程與排進時段的任務開始前 N 分鐘提醒一次、就寢前 30 分鐘提醒準備睡覺（App 內 + 系統通知）。
// 已提醒過的記錄在 localStorage，重新整理不會重複提醒；改了開始時間會再提醒一次。
import { dateStr, toMin } from './store.js'

const KEY = 'hiyori-reminded'

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

  check(now = new Date()) {
    const lead = this.store.state.settings.remindLead
    const today = dateStr(now)
    const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
    const sent = (this.sent[today] ||= [])
    let changed = false
    const items = lead < 0 ? [] : [
      ...this.store.eventsOn(today).map((e) => [e, e.start, 'event']),
      ...this.store.tasksOn(today).filter((t) => t.at).map((t) => [t, t.at, 'task']),
    ]
    for (const [item, at, kind] of items) {
      const key = `${item.id}@${at}`
      if (item.done || sent.includes(key)) continue
      const start = toMin(at)
      // 開始後 1 分鐘內打開 App 仍會補提醒；再晚就不吵了
      if (mins >= start - lead && mins < start + 1) {
        sent.push(key)
        changed = true
        this.onRemind(kind === 'task' ? { ...item, start: at } : item, Math.max(0, Math.ceil(start - mins)), kind)
      }
    }
    // 就寢前 30 分鐘（之後 10 分鐘內打開 App 也會補提醒）
    const r = this.store.state.rhythm
    const bedKey = `bed@${r.sleep}`
    const at = (toMin(r.sleep) - 30 + 1440) % 1440
    if (r.bedRemind && !sent.includes(bedKey) && mins >= at && mins < at + 10) {
      sent.push(bedKey)
      changed = true
      this.onRemind({ id: 'bedtime', title: '就寢', start: r.sleep }, 30, 'bed')
    }
    // 重要日子：前一天和當天，早上 8 點後第一次打開時提醒一次（專案的截止日另外有提醒）
    if (mins >= 480) {
      for (const d of this.store.upcomingDates(20, 1)) {
        const key = `date-${d.id}@${d.date}`
        if (d.project || sent.includes(key)) continue
        sent.push(key)
        changed = true
        this.onRemind(d, d.days, 'date')
      }
    }
    for (const d of Object.keys(this.sent)) {
      if (d !== today) {
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
