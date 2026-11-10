import { floating, TIME_RE, cleanRhythm, num, DATE_RE, str, blankTask } from './migrate.js'
import { optimizeDay, sleepMinutes, busyOf } from '../planner.js'
import { toMin, repeatMatches, uid } from './util.js'
import { XP, TAGS } from '../theme.js'
export const coachMethods = {
  // ── 時段安排 ──
  // 把任務排進時間軸（at 為 null 就收回未排區）；dur 是預估分鐘數
  scheduleTask(id, at, dur) {
    const t = this._find('tasks', id)
    // 還沒完成的長期任務不排在哪一天，也就沒有時段
    if (!t || floating(t)) return
    t.at = TIME_RE.test(at) ? at : null
    if (dur !== undefined) t.dur = dur ? Math.max(5, Math.min(600, Math.round(dur))) : null
    this._finish([['taskScheduled', t]])
  },
  // 排程要考慮的任務：那天的任務；看今天時再加上還沒完成的逾期任務
  planTasks(date = this.selectedDate) {
    const list = this.tasksOn(date)
    return date === this.today ? [...list, ...this.overdue()] : list
  },
  // 最佳化時程的預覽（不會改資料）
  planDay(date = this.selectedDate, { replan = false } = {}) {
    const n = new Date()
    return optimizeDay({
      tasks: this.planTasks(date), events: this._busyEvents(date), rhythm: this.state.rhythm, date, today: this.today,
      nowMin: date === this.today ? n.getHours() * 60 + n.getMinutes() : null, replan,
    })
  },
  // 套用排程：逾期任務會一起搬到這一天；left 是塞不下的件數
  applyPlan(date, plan, left = 0) {
    this._refreshToday()
    // 過去的日子不排；今天已經過去的時段也不排（預覽放太久時，介面會先重新預覽）
    if (date < this.today) return
    const n0 = new Date()
    const nowMin = date === this.today ? n0.getHours() * 60 + n0.getMinutes() : -1
    const fx = []
    let n = 0
    for (const p of plan) {
      const t = this._find('tasks', p.id)
      if (!t || t.done || !TIME_RE.test(p.at) || toMin(p.at) < nowMin) continue
      if (t.date < date) t.moved = (t.moved || 0) + 1
      t.date = date
      this._fitStar(t)
      t.at = p.at
      t.dur ||= p.dur
      n++
    }
    if (!n) return
    this.stats.plansApplied++
    if (date === this.today && !this.day().timebox) {
      this.day().timebox = 1
      this._gain(XP.plan, fx, { kind: 'plan' })
    }
    fx.push(['planApplied', { date, count: n, left }])
    this._finish(fx)
  },
  // 清空這天任務的時段（已完成的保留）
  clearPlan(date = this.selectedDate) {
    for (const t of this.tasksOn(date)) if (!t.done) t.at = null
    this._finish()
  },

  // ── 作息 ──
  setRhythm(patch) {
    this.state.rhythm = cleanRhythm({ ...this.state.rhythm, ...patch })
    this._finish([['rhythmChanged', this.state.rhythm]])
  },
  // 睡眠記在醒來那天
  // 回傳有沒有記下來。就寢和起床同一個時間（多半是還沒改到）不記：不然會被當成睡了 24 小時
  logSleep(date, { bed, wake, q = 0 }) {
    this._refreshToday()
    if (!TIME_RE.test(bed) || !TIME_RE.test(wake) || bed === wake || date > this.today) return false
    const first = !this.state.sleep[date]
    const entry = { bed, wake, q: num(q, 0, 5, 0) }
    this.state.sleep[date] = entry
    const fx = [['sleepLogged', { date, first, min: sleepMinutes(entry) }]]
    // 獎勵記在那天的紀錄上：刪掉再記一次不會再給
    const d = this.day(date)
    if (first && !d.sleep) {
      d.sleep = true
      this.stats.sleepLogs++
      if (date === this.today) this._gain(XP.sleep, fx, { kind: 'sleep' })
    }
    this._finish(fx)
    return true
  },
  deleteSleep(date) {
    delete this.state.sleep[date]
    this._finish()
  },

  // ── ふじ的排程教練 ──
  // 排程要避開的東西：這幾天的日程（未來的例行公事日程也算）、排了時段的任務
  // 未來那天會由例行公事生成、但還沒生成的日程：排程要先避開
  _routineEventsOn(date) {
    if (date <= this.today) return []
    return this.state.routines
      .filter((r) => r.kind === 'event' && r.startDate <= date && !r.made?.[date] && repeatMatches(r.repeat, date))
      .map((r) => ({ id: 'r-' + r.id, date, title: r.title, start: r.start, end: r.end, done: false }))
  },
  // 排程要避開的日程：有時段的日程，加上還沒生成的例行日程
  _busyEvents(date) {
    return [...this.eventsOn(date).filter((e) => !e.allDay), ...this._routineEventsOn(date)]
  },
  coachContext(dates) {
    const set = new Set(dates)
    const n = new Date()
    const events = this.state.events.filter((e) => set.has(e.date) && !e.allDay)
    for (const date of dates) events.push(...this._routineEventsOn(date))
    return {
      today: this.today, nowMin: n.getHours() * 60 + n.getMinutes(), rhythm: this.state.rhythm,
      events, tasks: this.state.tasks.filter((t) => set.has(t.date) && t.at && !t.done && !t.ongoing),
    }
  },
  // 套用ふじ排的計畫：一次建好所有任務（有時段、有預估時間）。meta：{ title, answers（下次的預設）, custom（自己加的主攻項目） }
  // 回傳 { id, count：建了幾件, skipped：已經過去或撞到行程、沒建的段數 }；一件都沒建時 id 是 null
  applyCoachPlan(res, { title = '', answers = null, custom = [] } = {}) {
    this._refreshToday()
    const id = uid()
    const tags = new Set(TAGS.map((t) => t.id))
    const fx = []
    const dates = []
    // 預覽到套用之間可能隔了一陣子（上午預覽、下午才按；中間又加了日程、跨過了午夜）：照現在再檢查一次。
    // 已經過去的、跟現在的日程或已排任務撞在一起的不建，算放不下（skipped）
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const busy = {}
    // 預覽之後才加的例行日程（未來的日子還沒生成）也要算進去
    const busyOn = (date) => (busy[date] ??= busyOf({ rhythm: this.state.rhythm, date, events: this._busyEvents(date), tasks: this.tasksOn(date).filter((t) => t.at && !t.done) }))
    let skipped = 0
    for (const d of res?.days || []) {
      if (!DATE_RE.test(d.date)) continue
      if (d.date < this.today) {
        skipped += (d.items || []).length
        continue
      }
      for (const it of d.items || []) {
        const name = str(it.title, 80).trim()
        if (!name) continue
        const dur = num(it.dur, 5, 600, 30)
        const at = TIME_RE.test(it.at) ? it.at : null
        if (at) {
          const a = toMin(at)
          if ((d.date === this.today && a < nowMin) || busyOn(d.date).some(([p, q]) => a < q && p < a + dur)) {
            skipped++
            continue
          }
        }
        const t = blankTask({ title: name, date: d.date, priority: num(it.priority, 1, 3, 2), tag: tags.has(it.tag) ? it.tag : 'study', dur, at, coach: id })
        this.state.tasks.push(t)
        fx.push(['taskAdded', t])
        if (!dates.includes(d.date)) dates.push(d.date)
      }
    }
    if (!fx.length) return { id: null, count: 0, skipped }
    const c = this.state.coach
    c.plans = [...c.plans, { id, createdAt: Date.now(), title: str(title, 40), from: dates[0], to: dates[dates.length - 1], count: fx.length }].slice(-10)
    if (answers) c.last = { focus: answers.focus || [], slots: answers.slots || [], days: answers.days || 5, len: answers.len || 50 }
    for (const it of custom) {
      const label = str(it.label, 16).trim()
      if (!label) continue
      c.items = [{ label, tag: tags.has(it.tag) ? it.tag : 'study' }, ...c.items.filter((x) => x.label !== label)].slice(0, 12)
    }
    this.stats.plansApplied++
    if (dates.includes(this.today) && !this.day().timebox) {
      this.day().timebox = 1
      this._gain(XP.plan, fx, { kind: 'plan' })
    }
    const count = fx.filter(([k]) => k === 'taskAdded').length
    fx.push(['coachApplied', { id, count, days: dates.length, skipped }])
    this._finish(fx)
    return { id, count, skipped }
  },
  // 那次排程還沒完成、可以撤銷的任務數
  coachLeft(id) {
    return this.state.tasks.filter((t) => t.coach === id && !t.done).length
  },
  // 撤銷一次排程：刪掉還沒完成的那幾件，做完的留著
  undoCoachPlan(id) {
    const before = this.state.tasks.length
    this.state.tasks = this.state.tasks.filter((t) => t.coach !== id || t.done)
    this._dropTaskRefs()
    const count = before - this.state.tasks.length
    this.state.coach.plans = this.state.coach.plans.filter((p) => p.id !== id)
    this._finish([['coachUndone', { id, count }]])
    return count
  },
  forgetFocus(label) {
    this.state.coach.items = this.state.coach.items.filter((x) => x.label !== label)
    this._finish()
  },

}
