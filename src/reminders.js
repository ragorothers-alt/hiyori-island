// 提醒：日程與排進時段的任務開始前 N 分鐘提醒一次、就寢前 30 分鐘提醒準備睡覺（App 內 + 系統通知）。
// 已提醒過的記錄在 localStorage，重新整理不會重複提醒；改了開始時間會再提醒一次。
import { addDays, dateStr, toMin } from './store.js'
import { activeMottos, awake, mottoOf, nextMotto, planMottos } from './mottos.js'
import { native, nativeAskNotify, nativeCanNotify } from './native.js'

const KEY = 'hiyori-reminded'
// 訂閱：每個訂閱最近提醒過的那次扣款日 { 訂閱 id: 'YYYY-MM-DD' }
const SUB_KEY = 'hiyori-sub-reminded'
// 警語：上次提醒排在幾點（時間照 nextMotto 一則一則往後排）和下一則輪到第幾句 { at, i }
const MOTTO_KEY = 'hiyori-motto-at'
// 上次提醒是好幾天前（很久沒打開）：從現在重新算，不一打開就響
const MOTTO_STALE = 3 * 86400000
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
  // 警語交給手機排的時候（Android 殼排好鬧鐘、開了系統通知）怎麼跟手機分工：
  //   external()：現在交給手機排了嗎；hidden()：頁面在背景嗎（App 不在前面時頁面的 JavaScript 可能還在跑）
  //   handled()：手機記著的「念到哪一則了」（手機通知過、或頁面念過的最後一則）；
  //   claim(at)：頁面要念這一則，先跟手機說（手機剛好搶先通知了的話回 false）
  constructor(store, onRemind, { external = () => false, hidden = () => typeof document !== 'undefined' && !!document.hidden, handled = () => 0, claim = () => true } = {}) {
    this.store = store
    this.onRemind = onRemind
    Object.assign(this, { external, hidden, handled, claim })
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

  // 警語：醒著的時候每隔 mottoEvery 分鐘提醒一句，一句一句輪流（幾點提醒照 mottos.js 的 nextMotto：
  // 上一則過 every 分鐘，碰到睡覺的時間就等起床後 every 分鐘）。上次排到哪一則記在 MOTTO_KEY，
  // 重新整理、另一個分頁都接著算（記憶體也留一份：存不進去時不會每秒響）。
  // 第一次（剛寫下第一句、剛打開提醒）從現在開始算，不馬上響；睡覺的時間不響，起床後第一次打開時接著提醒。
  // 頁面睡著時錯過了好幾則：只念最近的那一則，其他的跳過（照樣輪過那幾句）。
  // 交給手機排的時候（external），每一則由手機或頁面其中一邊念，靠手機記的「念到哪一則」分：
  //   手機已經通知過的：只往後記；頁面在背景：不念也不往後記（還沒通知的那一則留在交給手機的那一串裡，手機會發）；
  //   看著 App：先跟手機說這一則頁面念（claim），手機就不發
  _motto(now, mins) {
    const s = this.store.state
    const every = s.settings.mottoEvery
    const on = activeMottos(s.mottos)
    if (!(every > 0) || !on.length) return
    if (this.startMotto(now)) return
    const last = this.mottoState()
    if (!awake(s.rhythm, mins)) return
    const ext = this.external()
    const handled = ext ? this.handled() : 0
    let t = last.at
    let i = Number(last.i) || 0
    let due = null
    // 手機已經通知到的最後一則（頁面在背景時先往後記到這裡）
    let seen = null
    for (let k = 0; k < 2000; k++) {
      const next = nextMotto(t, every, s.rhythm)
      if (next > +now) break
      t = next
      due = i++
      if (t <= handled) seen = { at: t, i }
    }
    if (due === null) return
    if (ext) {
      if (t <= handled) return this._saveMotto({ at: t, i })
      if (this.hidden()) {
        if (seen && seen.at > last.at) this._saveMotto(seen)
        return
      }
      if (!this.claim(t)) return this._saveMotto({ at: t, i })
    }
    this._saveMotto({ at: t, i })
    this.onRemind(mottoOf(on, due), 0, 'motto')
  }
  // 沒記過（剛寫下第一句、剛打開提醒）、記的時間在未來（時鐘被往回調）、或好幾天沒打開：從現在開始算，回傳 true。
  // 交給手機之前也先叫一次：剛寫下第一句就離開 App 的話，等不到下一秒的檢查
  startMotto(now = Date.now()) {
    const s = this.store.state
    if (!(s.settings.mottoEvery > 0) || !activeMottos(s.mottos).length) return false
    const last = this.mottoState()
    if (last?.at > 0 && last.at <= +now + 60000 && now - last.at <= MOTTO_STALE) return false
    this._saveMotto({ at: +now, i: Number(last?.i) || 0 })
    return true
  }
  // 上次排到哪一則 { at, i }（沒有是 null）：存著的和記憶體裡的取比較新的
  mottoState() {
    let last = null
    try {
      last = JSON.parse(localStorage.getItem(MOTTO_KEY) || 'null')
    } catch {}
    if (!last || typeof last !== 'object') last = null
    if (this.mottoLast && !(last?.at >= this.mottoLast.at)) last = this.mottoLast
    return last
  }
  // 接下來的提醒（交給手機排）：[{ at, text }]。quietUntil：這個時間以前不排（專注中）；
  // since：這個時間以前的不排（預設是現在；交給手機時留著剛到點、還沒處理的那一則）
  mottoPlan(now = Date.now(), opts) {
    const s = this.store.state
    return planMottos(s.mottos, s.settings.mottoEvery, s.rhythm, this.mottoState(), +now, opts)
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
