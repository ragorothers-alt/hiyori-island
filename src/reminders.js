// 日程提醒：日程開始前 N 分鐘提醒一次（App 內 + 系統通知）。
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
    if (lead < 0) return
    const today = dateStr(now)
    const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
    const sent = (this.sent[today] ||= [])
    let changed = false
    for (const e of this.store.eventsOn(today)) {
      const key = `${e.id}@${e.start}`
      if (e.done || sent.includes(key)) continue
      const start = toMin(e.start)
      // 開始後 1 分鐘內打開 App 仍會補提醒；再晚就不吵了
      if (mins >= start - lead && mins < start + 1) {
        sent.push(key)
        changed = true
        this.onRemind(e, Math.max(0, Math.ceil(start - mins)))
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
  const opts = { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', renotify: true }
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
