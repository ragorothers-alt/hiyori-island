import { SUBS_MAX, cleanSub, DATE_RE, cleanRates, mottoText, str, DATES_MAX } from './migrate.js'
import { uid, addDays, daysBetween } from './util.js'
import { nextCharge, paidCount, CURRENCIES, subsSummary, chargesBetween } from '../subs.js'
import { MOTTO_MAX } from '../mottos.js'
import { DATE_KINDS } from '../theme.js'
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

  // ── 重要日子 ──
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
