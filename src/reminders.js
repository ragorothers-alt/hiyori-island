// 提醒：日程與排進時段的任務開始前 N 分鐘提醒一次、就寢前 30 分鐘提醒準備睡覺（App 內 + 系統通知）。
// 已提醒過的記錄在 localStorage，重新整理不會重複提醒；改了開始時間會再提醒一次。
import { addDays, dateStr, toMin } from './store.js'
import { activeMottos, awake } from './mottos.js'
import { native, nativeAskNotify, nativeCanNotify } from './native.js'

const KEY = 'hiyori-reminded'
// 訂閱：每個訂閱最近提醒過的那次扣款日 { 訂閱 id: 'YYYY-MM-DD' }
const SUB_KEY = 'hiyori-sub-reminded'
// 警語：上次提醒的時間和輪到第幾句 { at, i }
const MOTTO_KEY = 'hiyori-motto-at'
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

// 系統通知：瀏覽器的 Notification，Android 殼裡是原生通知（native.js）
export const notifySupported = () => !!native || 'Notification' in window
// 'granted'／'denied'／'default'（還沒問過）
export const notifyPermission = () => (native ? (nativeCanNotify() ? 'granted' : 'default') : notifySupported() ? Notification.permission : 'denied')
export const requestNotify = () => (native ? nativeAskNotify() : Notification.requestPermission())

export class Reminders {
  constructor(store, onRemind) {
    this.store = store
    this.onRemind = onRemind
    this.sent = load()
    // 訂閱這次扣款提醒過了（存不進 localStorage 時也記得，不會每秒響一次）
    this.subSent = {}
    // 在這個分頁剛新增、剛改的整天日程和訂閱：畫面上就看得到，當下就記成提醒過（不等下一輪檢查，
    // 另一個分頁讀到這筆之前就記好了）。同步、匯入、另一個分頁帶來的不算，照常提醒；
    // 日子還沒到提醒範圍的也不算，之後進到範圍時照常提醒
    store.on('eventAdded', (e) => this._quietAllDay(e))
    store.on('eventChanged', (e) => this._quietAllDay(e))
    store.on('subAdded', (s) => this._quietSub(s))
    store.on('subChanged', (s) => this._quietSub(s))
  }

  _quietAllDay(e, now = new Date()) {
    if (!e?.allDay || this.store.state.settings.remindLead < 0) return
    const today = dateStr(now)
    if (e.date === today || e.date === addDays(today, 1)) this._claim(today, `allday-${e.id}@${e.date}`)
  }
  _quietSub(s) {
    const r = this.store.subReminders?.().find((x) => x.id === s?.id)
    if (r) this._claimSub(r.id, r.date)
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

  // 要提醒之前：再讀一次存檔（另一個分頁可能剛好也在檢查），還沒人提醒過就先記下來、寫出去，回傳 true 才提醒。
  // localStorage 沒有原子操作，但這樣兩個分頁同時響的空檔從一整輪檢查縮到幾乎沒有
  _claim(date, key) {
    const mine = (this.sent[date] ||= [])
    const theirs = load()[date]
    const taken = Array.isArray(theirs) && theirs.includes(key)
    if (!mine.includes(key)) mine.push(key)
    if (taken) return false
    this._save()
    return true
  }

  // 訂閱這一次的扣款（date）提醒過了沒：每個訂閱只記最近提醒的那次扣款日。
  // 每次都重讀存著的（另一個分頁可能剛提醒過），寫回去時拿掉已經刪掉的訂閱
  _claimSub(id, date) {
    if (this.subSent[id] === date) return false
    let map = {}
    try {
      map = JSON.parse(localStorage.getItem(SUB_KEY) || '{}')
    } catch {}
    if (!map || typeof map !== 'object' || Array.isArray(map)) map = {}
    this.subSent[id] = date
    if (map[id] === date) return false
    const ids = new Set(this.store.state.subscriptions?.map((s) => s.id) || [])
    for (const k of Object.keys(map)) if (!ids.has(k)) delete map[k]
    map[id] = date
    try {
      localStorage.setItem(SUB_KEY, JSON.stringify(map))
    } catch {}
    return true
  }

  // 警語：醒著的時候每隔 mottoEvery 分鐘提醒一句，一句一句輪流。上次提醒的時間記在 MOTTO_KEY，
  // 重新整理、另一個分頁都接著算（記憶體也留一份：存不進去時不會每秒響）。
  // 第一次（剛寫下第一句、剛打開提醒）從現在開始算，不馬上響；睡覺的時間不響，起床後第一次打開時接著提醒
  _motto(now, mins) {
    const every = this.store.state.settings.mottoEvery
    const on = activeMottos(this.store.state.mottos)
    if (!(every > 0) || !on.length || !awake(this.store.state.rhythm, mins)) return
    let last = null
    try {
      last = JSON.parse(localStorage.getItem(MOTTO_KEY) || 'null')
    } catch {}
    if (this.mottoLast && !(last?.at >= this.mottoLast.at)) last = this.mottoLast
    // 沒記過、或記的時間在未來（時鐘被往回調）：從現在開始算
    if (!(last?.at > 0) || last.at > +now + 60000) return this._saveMotto({ at: +now, i: Number(last?.i) || 0 })
    if (now - last.at < every * 60000) return
    const i = (Number(last.i) || 0) % on.length
    this._saveMotto({ at: +now, i: i + 1 })
    this.onRemind(on[i], 0, 'motto')
  }
  _saveMotto(v) {
    this.mottoLast = v
    try {
      localStorage.setItem(MOTTO_KEY, JSON.stringify(v))
    } catch {}
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
        if (!this._claim(date, key)) continue
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
      const night = mins - since >= 0 ? today : addDays(today, -1)
      if (!(this.sent[night] || []).includes(bedKey) && this._claim(night, bedKey)) {
        this.onRemind({ id: 'bedtime', title: '就寢', start: r.sleep }, 30, 'bed')
      }
    }
    // 重要日子和里程碑期限：前一天和當天，早上 8 點後第一次打開時提醒一次（專案的截止日另外有提醒）
    if (mins >= 480) {
      // 不限筆數：同一天有很多個期限也要一個一個提醒到（畫面上的倒數才有筆數上限）
      for (const d of this.store.upcomingDates(Infinity, 1)) {
        const key = `date-${d.id}@${d.date}`
        if (d.project || sent.includes(key) || !this._claim(today, key)) continue
        this.onRemind(d, d.days, 'date')
      }
    }
    // 整天的日程：前一天和第一天，早上 8 點後提醒一次（跨好幾天的只在開始時提醒）。關掉日程提醒就不提醒。
    // 這個分頁剛加上、剛改的在當下就記成提醒過了（_quietAllDay）；開著過了午夜才進到「明天」的照常提醒
    if (lead >= 0 && mins >= 480) {
      for (const [date, days] of [[today, 0], [tomorrow, 1]]) {
        for (const e of this.store.allDayOn(date)) {
          const key = `allday-${e.id}@${e.date}`
          if (e.date !== date || sent.includes(key)) continue
          if (this._claim(today, key)) this.onRemind(e, days, 'allday')
        }
      }
    }
    // 訂閱扣款：照每個訂閱設的提前天數（免費試用結束至少前 3 天），早上 8 點後第一次打開時提醒。
    // 同一次扣款只提醒一次：提前好幾天時，隔天再打開不會又響（記在 SUB_KEY，不跟著上面三天一輪的紀錄清掉）。
    // 這個分頁剛新增、剛改的在當下就記成提醒過了（_quietSub）；同步帶來的、開著過了午夜才進到提醒天數內的照常提醒
    if (mins >= 480) {
      for (const r of this.store.subReminders?.() || []) {
        if (this._claimSub(r.id, r.date)) this.onRemind(r, r.days, 'sub')
      }
    }
    this._motto(now, mins)
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
  if (notifyPermission() !== 'granted') return false
  if (native) {
    try {
      native.notify(String(title), String(body || ''), String(tag || ''))
      return true
    } catch {
      return false
    }
  }
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
