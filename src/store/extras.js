import { SUBS_MAX, cleanSub, DATE_RE, cleanRates, mottoText, str, DATES_MAX, PARK_MAX, parkText, calUrlOk, CALENDARS_MAX } from './migrate.js'
import { uid, addDays, daysBetween, dateStr } from './util.js'
import { nextCharge, paidCount, CURRENCIES, subsSummary, chargesBetween } from '../subs.js'
import { MOTTO_MAX, PAUSE_MAX } from '../mottos.js'
import { DATE_KINDS, XP, pullOf } from '../theme.js'

// 回神紀錄：這台算過哪幾則提醒（那一則的時間 → 'n' 算了提醒、'a' 也算了回應），照記下的先後只留最近的 TALLY_KEEP 則
// （不照提醒的時間排：時鐘被往回調過的話，剛記的那一則會被當成最舊的丟掉）。
// 存成 { gen, keys }，keys 的每一筆是「時間、'n' 或 'a'」兩個值的陣列；gen 是這份紀錄跟著哪一份資料
// （匯入、還原備份換了一份就不算數，見 store.js 的 sameGen）。
// 要比推播留的那幾則（push.js 的 MOTTO_LOG_KEEP，150）多：「看過哪幾筆」那張表（SHOWN_KEY）寫不進去時，
// 一口氣算進來的那一整批還認得出來，不會重算
export const TALLY_KEY = 'hiyori-motto-tally'
export const TALLY_KEEP = 200
const RANK = { n: 1, a: 2 }
const tallyKey = (at) => (Number.isFinite(at) && at > 0 ? String(Math.round(at)) : '')
// 記在那一則的那一天；時間不知道、或怪怪的（未來、一週以前）就記在今天
function tallyDate(at, today) {
  if (!tallyKey(at)) return today
  const d = dateStr(new Date(at))
  return d <= today && daysBetween(d, today) <= 7 ? d : today
}
// 回到 App 時算進「提醒了幾次」的通知（手機的 App 'app' 留 32 則、推播 'sw' 留 150 則〔push.js 的 MOTTO_LOG_KEEP〕）：來源那邊不清掉，
// 這台記著哪幾筆看過了（{ app: [代號], sw: [代號] }，各留最近 SHOWN_KEEP 筆，比來源留的多：還在來源裡的一定還記著）
export const SHOWN_KEY = 'hiyori-motto-counted'
export const SHOWN_KEEP = 200
function readShown() {
  try {
    const v = JSON.parse(localStorage.getItem(SHOWN_KEY) || 'null')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}
// 一週以前的通知：不知道是哪一天的數字了，不算（不能像頁面念的那樣記在今天）
const tooOld = (at, today) => {
  const d = dateStr(new Date(at))
  return d < today && daysBetween(d, today) > 7
}
function readTally(gen) {
  try {
    let v = JSON.parse(localStorage.getItem(TALLY_KEY) || 'null')
    // 舊的格式（{ 時間: 'n' }）：跟著還沒有 gen 的資料
    if (v && typeof v === 'object' && !Array.isArray(v) && !Array.isArray(v.keys)) v = { gen: '', keys: Object.entries(v) }
    if (!v || v.gen !== gen || !Array.isArray(v.keys)) return []
    return v.keys.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && RANK[x[1]])
  } catch {
    return []
  }
}

export const extrasMethods = {
  // ── 訂閱服務 ──
  // 回傳新的訂閱；名稱、金額不對或已經到上限是 null
  addSubscription(data = {}) {
    this._refreshToday()
    if (this.state.subscriptions.length >= SUBS_MAX) return null
    const sub = cleanSub({ ...data, id: uid(), status: 'active', end: '', paid0: 0, createdAt: Date.now() }, this.today)
    if (!sub) return null
    this.state.subscriptions.push(sub)
    this._finish([['subAdded', sub]])
    return sub
  },
  subscription(id) {
    return this.state.subscriptions.find((x) => x.id === id) || null
  },
  // 改名稱、金額、週期、提醒…；狀態（取消、重新訂閱）和付過的金額只能用下面的方法改
  updateSubscription(id, patch = {}) {
    const old = this.subscription(id)
    if (!old) return false
    const { id: _, status, end, paid0, createdAt, ...rest } = patch
    const next = cleanSub({ ...old, ...rest }, this.today)
    if (!next) return false
    Object.assign(old, next)
    this._finish([['subChanged', old]])
    return true
  },
  // 取消訂閱：end 是不再扣款的那一天（預設下一次扣款日，到那天之前照樣能用；今天剛好扣款的話今天這筆還是算）
  cancelSubscription(id, end = null) {
    this._refreshToday()
    const s = this.subscription(id)
    if (!s || s.status === 'cancelled') return false
    s.status = 'cancelled'
    s.end = DATE_RE.test(end) ? end : nextCharge({ ...s, status: 'active' }, addDays(this.today, 1))
    this._finish([['subCancelled', s]])
    return true
  },
  // 重新訂閱：
  // - 還沒用完就反悔（沒給 start）：照原本的週期繼續扣，回傳 'kept'
  // - 已經停掉了：之前那段付過的錢記進 paid0，從 start（預設今天）重新算扣款，回傳 'restart'
  resumeSubscription(id, start = null) {
    this._refreshToday()
    const s = this.subscription(id)
    if (!s || s.status !== 'cancelled') return false
    if (!start && s.end && s.end > this.today) {
      s.status = 'active'
      s.end = ''
      this._finish([['subChanged', s]])
      return 'kept'
    }
    s.paid0 = Math.round((s.paid0 + paidCount(s, this.today) * s.price) * 100) / 100
    s.status = 'active'
    s.end = ''
    s.trial = false
    s.start = DATE_RE.test(start) ? start : this.today
    this._finish([['subChanged', s]])
    return 'restart'
  },
  deleteSubscription(id) {
    const n = this.state.subscriptions.length
    this.state.subscriptions = this.state.subscriptions.filter((x) => x.id !== id)
    if (this.state.subscriptions.length !== n) this._finish()
  },
  setSubRate(cur, rate) {
    if (!CURRENCIES[cur] || cur === 'TWD') return false
    this.state.subRates = cleanRates({ ...this.state.subRates, [cur]: rate })
    this._finish()
    return true
  },
  // 合計、這個月還要付、接下來的扣款、分類比例（見 subs.js 的 subsSummary）
  subsSummary(days = 30) {
    this._refreshToday()
    return subsSummary(this.state.subscriptions, this.today, this.state.subRates, days)
  },
  // 那天要扣款的訂閱（日曆用）
  subChargesOn(date) {
    return this.state.subscriptions.filter((s) => chargesBetween(s, date, date).length)
  },
  // 現在該提醒的扣款：訂閱中、下次扣款在提醒天數內（免費試用的第一次扣款至少提前 3 天）。
  // days：還有幾天；trial：這次是試用結束後的第一次扣款
  subReminders() {
    this._refreshToday()
    const out = []
    for (const s of this.state.subscriptions) {
      if (s.status !== 'active' || s.remind < 0) continue
      const date = nextCharge(s, this.today)
      if (!date) continue
      const trial = s.trial && date === s.start
      const days = daysBetween(this.today, date)
      if (days <= (trial ? Math.max(3, s.remind) : s.remind)) out.push({ id: s.id, sub: s, date, days, trial })
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  },

  // ── 警語 ──
  // 回傳新的那一句；空的、已經有一樣的、到上限了是 null
  addMotto(text) {
    const t = mottoText(text)
    const list = this.state.mottos
    if (!t || list.length >= MOTTO_MAX || list.some((m) => m.text === t)) return null
    const m = { id: uid(), text: t, on: true, createdAt: Date.now() }
    list.push(m)
    this._finish([['mottoAdded', m]])
    return m
  },
  updateMotto(id, text) {
    const m = this._find('mottos', id)
    const t = mottoText(text)
    if (!m || !t) return false
    if (m.text !== t) {
      m.text = t
      this._finish()
    }
    return true
  },
  // 先收著（不輪播、不提醒）／拿出來
  toggleMotto(id) {
    const m = this._find('mottos', id)
    if (!m) return
    m.on = !m.on
    this._finish()
  },
  deleteMotto(id) {
    const n = this.state.mottos.length
    this.state.mottos = this.state.mottos.filter((m) => m.id !== id)
    if (this.state.mottos.length !== n) this._finish()
  },
  // 定時提醒先停到 until（毫秒；0、已經過了的是現在就恢復）。發 mottoPause（停到幾點，0 是恢復）：
  // ふじ說一聲、提示卡上可以馬上恢復。回傳有沒有變。
  // 恢復不是清成 0：停到的時間改成現在、記下是提早恢復的（mottoPauseCut）——停著時到點的照樣算跳過
  // （頁面睡著、還沒走過那幾則的話，恢復後不會補念出來；同步到別台也一樣），只是停完不補那一則
  pauseMottos(until) {
    const now = Date.now()
    const st = this.state.settings
    const old = Number(st.mottoPause) || 0
    if (Number.isFinite(until) && until > now) {
      const v = Math.round(Math.min(until, now + PAUSE_MAX))
      if (v === old && !st.mottoPauseCut) return false
      // 從現在開始停（之前到點的照常：手機已經通知過、頁面還沒跟上的那一則不算跳過）；
      // 停著時又按了一次（例如改成今天先停）：還是從原本開始停的那一刻算
      st.mottoPauseFrom = old > now && st.mottoPauseFrom ? st.mottoPauseFrom : now
      st.mottoPause = v
      st.mottoPauseCut = false
      this._finish([['mottoPause', v]])
      return true
    }
    // 本來就沒停（停到的時間已經過了）又按恢復：不用存
    if (!(old > now)) return false
    st.mottoPause = now
    st.mottoPauseCut = true
    this._finish([['mottoPause', 0]])
    return true
  },
  // 回神紀錄（週報看得到）：警語提醒了一次。at：那一則排在幾點（毫秒；不知道是 0）——
  // 記在那一則的那一天（跨午夜才按的回應也算在那天），同一則在這台只算一次（提示卡、頁面自己發的系統通知都按得到）。
  // 是自動發生的，不算使用者改了資料（剛打開、資料還舊的裝置念了一句，不會因此跟雲端比較新的那一版衝突）；
  // 換成別台、別的分頁的那一版時取比較大的數字（見 replaceState 的 _keepTallies），不會被蓋掉。回傳有沒有算
  // 記了就馬上寫出去（存檔大到改成停手才寫的時候也是）：另一個分頁緊接著記的那一則才讀得到這一則，不會兩邊都從同一個數字加一
  mottoNudged(at = 0) {
    const key = tallyKey(at)
    if (key && this._tallies().has(key)) return false
    this._diskTallies()
    const before = this._tallyOnDisk(key)
    this._nudged(at, key)
    this.save(false)
    this._tallyFlush(key, 'n', before)
    return true
  },
  _nudged(at, key) {
    this._refreshToday()
    this.day(tallyDate(at, this.today)).nudges++
    if (key) this._markTally(key, 'n')
  },
  // 提醒之後怎麼回應：'on' 本來就在做正事（按了「在做了」），其他是回到正事（開始專注、只做 5 分鐘）。
  // 還沒算過這一則提醒的（App 關著時手機、推播發的通知）一起算；同一則只算一次回應
  mottoAnswered(kind, at = 0) {
    const key = tallyKey(at)
    const was = key ? this._tallies().get(key) : null
    if (was === 'a') return false
    this._diskTallies()
    const before = this._tallyOnDisk(key)
    if (!was) this._nudged(at, key)
    const d = this.day(tallyDate(at, this.today))
    if (kind === 'on') d.onTask++
    else d.backs++
    if (key) this._markTally(key, 'a')
    this.save()
    this._tallyFlush(key, 'a', before)
    return true
  },
  // 去重表上這一則現在存的是什麼（'n'、'a'；沒有是 null）
  _tallyOnDisk(key) {
    return key ? new Map(readTally(this.state.tallyGen || '')).get(key) || null : null
  },
  // 記了就馬上寫出去。主存檔沒寫進去（空間滿了；去重表很小，常常還寫得進去）：數字只在記憶體裡，
  // 去重表上這一則先改回原本的樣子——不然重新打開後數字沒了、這一則卻再也算不進去。這個分頁記在 _tallyHold 裡，
  // 同一則照樣不重算；之後存檔又寫進去了（數字跟著寫進去）再補回去（store.js 的 saveNow 叫 _releaseTally）
  _tallyFlush(key, v, before) {
    if (this.flushSave() !== false || !key) return
    this._holdTally(key, v, before)
  },
  _holdTally(key, v, before) {
    ;(this._tallyHold ||= new Map()).set(key, v)
    // 去重表也寫不進去時記在 _tallyMem 的那一筆拿掉：不然去重表先恢復時，下一則會連這一則一起寫出去
    this._tallyMem?.delete(key)
    try {
      const keys = readTally(this._tallyGen).filter(([k]) => k !== key)
      const was = before && [key, before]
      if (was) keys.push(was)
      localStorage.setItem(TALLY_KEY, JSON.stringify({ gen: this._tallyGen, keys: keys.slice(-TALLY_KEEP) }))
    } catch {}
  },
  // 頁面不在時手機（Android 的 App，src 是 'app'）、推播（Service Worker，'sw'）發過的那幾則：回到 App 時一次記、一次寫出去。
  // list：[{ id, at }]（id 是那一筆通知的代號，at 是排在幾點）。來源那邊不清掉：這台記著哪幾筆看過了（SHOWN_KEY），
  // 數字真的寫進存檔了才記——寫不進去的話，重新打開還拿得到、照樣算得到（去重表上也先不留，見 _holdTally）。
  // 已經算過的（頁面念的、按了通知上按鈕的）不重算，一週以前的不算。回傳算了幾則
  mottosShown(src, list) {
    const all = readShown()
    // 存著的，加上寫不進去（空間滿了）時這個分頁記在記憶體裡的
    const seen = [...new Set([...(Array.isArray(all[src]) ? all[src] : []), ...(this._shownMem?.[src] || [])])].filter((x) => typeof x === 'string')
    const items = (Array.isArray(list) ? list : []).filter((x) => x && typeof x.id === 'string' && x.id && !seen.includes(x.id))
    if (!items.length) return 0
    this._refreshToday()
    const have = this._tallies()
    const fresh = [...new Set(items.map((x) => tallyKey(x.at)))].filter((k) => k && !have.has(k) && !tooOld(Number(k), this.today))
    if (fresh.length) {
      this._diskTallies()
      const before = new Map(fresh.map((k) => [k, this._tallyOnDisk(k)]))
      for (const k of fresh) this._nudged(Number(k), k)
      this.save(false)
      if (this.flushSave() === false) for (const k of fresh) this._holdTally(k, 'n', before.get(k))
    }
    // 之前寫不進去、還等著的那幾則（_tallyHold）也一樣：等數字寫進去了再記成看過了
    if (this.saved && !this.saveError && !this._tallyHold?.size) {
      all[src] = [...new Set([...seen, ...items.map((x) => x.id)])].slice(-SHOWN_KEEP)
      try {
        localStorage.setItem(SHOWN_KEY, JSON.stringify(all))
        if (this._shownMem) delete this._shownMem[src]
      } catch {
        // 寫不進去：這個分頁記在記憶體裡（同一批不會一直重算；去重表 TALLY_KEY 也認得這一批）
        ;(this._shownMem ||= {})[src] = all[src]
      }
    }
    return fresh.length
  },
  _releaseTally() {
    const hold = this._tallyHold
    if (!hold?.size) return
    this._tallyHold = null
    if (this._tallyGen !== (this.state.tallyGen || '')) return
    const disk = new Map(readTally(this._tallyGen))
    for (const [k, v] of hold) if (!(RANK[disk.get(k)] >= RANK[v])) this._markTally(k, v)
  },
  // 這台算過的那幾則：存著的，加上寫不進去（localStorage 滿了、被封鎖）時記在記憶體裡的——同一則也不會一直重算。
  // 寫進去了就只看存著的（記憶體裡舊的那幾則不會又排到最後面，把另一個分頁剛記的擠掉）。換了一份資料（gen 不一樣）就從頭記。
  // hold：主存檔還沒寫進去的那幾則也算（寫進去標記時不算：那幾則等數字寫進去了才寫）
  _tallies(hold = true) {
    const gen = this.state.tallyGen || ''
    if (this._tallyGen !== gen) {
      this._tallyGen = gen
      this._tallyMem = new Map()
      this._tallyHold = null
    }
    const m = new Map(readTally(gen))
    for (const src of [this._tallyMem, (hold && this._tallyHold) || []]) for (const [k, v] of src) if (!(RANK[m.get(k)] >= RANK[v])) m.set(k, v)
    return m
  },
  _markTally(key, v) {
    const m = this._tallies(false)
    m.delete(key)
    m.set(key, v)
    const keys = [...m].slice(-TALLY_KEEP)
    try {
      localStorage.setItem(TALLY_KEY, JSON.stringify({ gen: this._tallyGen, keys }))
      this._tallyMem = new Map()
    } catch {
      this._tallyMem = new Map(keys)
    }
  },

  // 專注中想分心了（專注頁的「想分心了？」）：先等一分鐘，之後（或還沒等完就決定）回到正事、或先記下來等等再做。
  // 記一次忍住了（週報的「想分心時忍住」；成就、小鎮的「忍住了」也算），每天前 3 次有一點經驗值。發 focusHeld（今天第幾次）。
  // pull：等的時候點了想去做什麼（theme.js 的 PULLS；沒點是 null），記在那天的 pulls
  focusHold(pull = null) {
    this._refreshToday()
    const d = this.day()
    d.holds = (d.holds || 0) + 1
    this.stats.urgesResisted++
    const fx = [['focusHeld', { count: d.holds, pull: this._notePull(d, pull) ? pull : null }]]
    if (d.holds <= 3) this._gain(XP.urge, fx, { kind: 'urge', id: null })
    this._finish(fx)
    return d.holds
  },
  // 專注中按了「想分心了？」：記下是在一天的哪一段（早上 5–12、下午 12–18、晚上 18–24、深夜 0–5，跟專注的時段一樣分），
  // 週報的習慣洞察看得出最常在什麼時段想分心
  focusUrged() {
    this._refreshToday()
    const d = this.day()
    const h = new Date().getHours()
    const k = h < 5 ? 'urgeLate' : h < 12 ? 'urgeAm' : h < 18 ? 'urgePm' : 'urgeEve'
    d[k] = (d[k] || 0) + 1
    this._finish()
  },
  // 限時去（等完還是想去時「去 5 分鐘就回來」）之後回來了：記一次（今天的回神、週報的「把自己拉回來」都算），
  // 每天前 3 次有一點經驗值。late：叫你回來之後才回來的；auto：切走之後回到 App 就算回來了。發 focusReturned
  focusReturned({ late = false, auto = false } = {}) {
    this._refreshToday()
    const d = this.day()
    d.returns = (d.returns || 0) + 1
    const fx = [['focusReturned', { count: d.returns, late: !!late, auto: !!auto }]]
    if (d.returns <= 3) this._gain(XP.urge, fx, { kind: 'urge', id: null })
    this._finish(fx)
    return d.returns
  },
  // 等了之後還是想去（不算忍住）：點了想去做什麼的話也記下來，週報看得出最常把你拉走的是什麼。回傳有沒有記
  focusWent(pull) {
    this._refreshToday()
    if (!this._notePull(this.day(), pull)) return false
    this._finish()
    return true
  },
  _notePull(d, pull) {
    if (!pullOf(pull)) return false
    d.pulls = { ...(d.pulls || {}), [pull]: ((d.pulls || {})[pull] || 0) + 1 }
    return true
  },

  // 專注中切去用別的 App 一陣子（週報看得到）。自動記的：不算使用者改了資料（跟 mottoNudged 一樣，換版時取比較大的）
  focusLeft() {
    this._diskTallies()
    this._refreshToday()
    this.day().leaves++
    this.save(false)
    this.flushSave()
  },

  // ── 先記下來 ──
  // 專注時腦中冒出別的事：一行字記下，不離開專注。發 parked（記下的那一筆）。滿了（PARK_MAX）回傳 null
  park(text) {
    const t = parkText(text)
    if (!t || this.state.parked.length >= PARK_MAX) return null
    const item = { id: uid(), text: t, at: Date.now() }
    this.state.parked.push(item)
    this._finish([['parked', item]])
    return item
  },
  unpark(id) {
    const n = this.state.parked.length
    this.state.parked = this.state.parked.filter((x) => x.id !== id)
    if (this.state.parked.length !== n) this._finish()
  },
  // 記下的那件變成 date 那天的任務（拿掉這一筆）；回傳新的任務
  parkToTask(id, date) {
    const item = this.state.parked.find((x) => x.id === id)
    if (!item || !DATE_RE.test(date)) return null
    this.state.parked = this.state.parked.filter((x) => x !== item)
    return this.addTask({ title: item.text, date })
  },

  // ── 重要日子 ──
  // ── 匯入的行事曆（抓回來的日程在 this.external，見 src/calendars.js）──
  // 回傳新的那一筆；網址不對、已經有同一個網址、到上限是 null
  addCalendar({ url, name = '', color = 0 }) {
    const u = String(url || '').trim()
    if (!calUrlOk(u) || this.state.calendars.length >= CALENDARS_MAX) return null
    if (this.state.calendars.some((c) => c.url === u)) return null
    const c = { id: uid(), url: u, name: str(name, 30).trim(), color: Math.max(0, Math.min(99, Math.round(+color) || 0)), on: true, createdAt: Date.now() }
    this.state.calendars.push(c)
    this._finish([['calendarsChanged', c]])
    return c
  },
  updateCalendar(id, patch = {}) {
    const c = this._find('calendars', id)
    if (!c) return
    if ('name' in patch) c.name = str(patch.name, 30).trim()
    if ('on' in patch) c.on = !!patch.on
    if ('color' in patch) c.color = Math.max(0, Math.min(99, Math.round(+patch.color) || 0))
    this._finish([['calendarsChanged', c]])
  },
  removeCalendar(id) {
    const before = this.state.calendars.length
    this.state.calendars = this.state.calendars.filter((c) => c.id !== id)
    if (this.state.calendars.length === before) return
    this.setExternal(this.external.filter((e) => e.ext !== id))
    this._finish([['calendarsChanged', null]])
  },
  // 換掉抓回來的日程（不存進小島的資料、不同步：每台自己抓）。關掉、刪掉的行事曆不算
  setExternal(list) {
    const on = new Set(this.state.calendars.filter((c) => c.on).map((c) => c.id))
    this.external = (Array.isArray(list) ? list : []).filter((e) => on.has(e.ext))
    this.emit('change')
  },

  addDate({ title, date, kind = 'exam' }) {
    title = str(title, 30).trim()
    if (!title || !DATE_RE.test(date) || this.state.dates.length >= DATES_MAX) return null
    const d = { id: uid(), title, date, kind: DATE_KINDS[kind] ? kind : 'exam', createdAt: Date.now() }
    this.state.dates.push(d)
    this._finish([['dateAdded', { ...d, days: daysBetween(this.today, date) }]])
    return d
  },
  deleteDate(id) {
    this.state.dates = this.state.dates.filter((d) => d.id !== id)
    this._finish()
  },
  datesOn(date) {
    return this.state.dates.filter((d) => d.date === date)
  },
  // 接下來的重要日子，連同進行中專案的截止日和里程碑期限；近的在前，days：還有幾天
  // 同一天：自己記的重要日子、里程碑、專案截止日
  upcomingDates(limit = 8, horizon = 366) {
    const out = this.state.dates.filter((d) => d.date >= this.today).map((d) => ({ ...d, days: daysBetween(this.today, d.date) }))
    for (const p of this.state.projects) {
      if (!p.deadline || p.completedAt || p.archived || p.pausedAt || p.deadline < this.today) continue
      out.push({ id: p.id, title: p.name, date: p.deadline, kind: 'deadline', project: true, days: daysBetween(this.today, p.deadline) })
    }
    out.push(...this.milestoneDues())
    const rank = (d) => (d.project ? 2 : d.pid ? 1 : 0)
    return out
      .filter((d) => d.days <= horizon)
      .sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b))
      .slice(0, limit)
  },
  // 進行中專案裡還沒完成、設了期限的里程碑（今天以後的）；date 有給就只看那一天
  milestoneDues(date = null) {
    const out = []
    for (const p of this.state.projects) {
      if (p.completedAt || p.archived || p.pausedAt) continue
      for (const m of p.milestones) {
        if (m.done || !m.due || m.due < this.today || (date && m.due !== date)) continue
        out.push({
          id: m.id, title: m.title, date: m.due, kind: 'milestone', pid: p.id, projectName: p.name,
          steps: m.steps.length, stepsDone: m.steps.filter((x) => x.done).length, days: daysBetween(this.today, m.due),
        })
      }
    }
    return out
  },

}
