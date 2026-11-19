import { floating, TIME_RE, cleanRhythm, num, DATE_RE, str, blankTask } from './migrate.js'
import { optimizeDay, sleepMinutes, busyOf, estimateRatio, taskDur } from '../planner.js'
import { toMin, repeatMatches, uid } from './util.js'
import { XP, TAGS } from '../theme.js'
// 排進時段之前、之後的樣子（撤銷時用來放回去、認出之後又改過）
const snapSlot = (t) => ({ date: t.date, at: t.at ?? null, dur: t.dur ?? null, moved: t.moved || 0, star: !!t.star, first: !!t.first })
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
  // 平常會超時的人（實際花的時間比預估多），每件後面多留一點
  planDay(date = this.selectedDate, { replan = false } = {}) {
    const n = new Date()
    return optimizeDay({
      tasks: this.planTasks(date), events: this._busyEvents(date), rhythm: this.state.rhythm, date, today: this.today,
      nowMin: date === this.today ? n.getHours() * 60 + n.getMinutes() : null, replan, stretch: this.estimate()?.ratio || 1,
    })
  },
  // 預估準不準（planner.js 的 estimateRatio）：{ ratio, n }，資料不夠是 null
  estimate() {
    return estimateRatio(this.state.tasks)
  },
  // 套用排程：逾期任務會一起搬到這一天；left 是塞不下的件數。
  // unslot：重排時原本有時段、這次沒排進去的（位置被別件佔走了）：清掉時段，不然會跟新排的疊在一起。
  // 回傳撤銷用的紀錄 { date, count, items: [{ id, 原本的樣子, after: 排完的樣子 }] }（沒排成是 null），給 undoPlan
  applyPlan(date, plan, left = 0, unslot = []) {
    this._refreshToday()
    // 過去的日子不排；今天已經過去的時段也不排（預覽放太久時，介面會先重新預覽）
    if (date < this.today) return null
    const n0 = new Date()
    const nowMin = date === this.today ? n0.getHours() * 60 + n0.getMinutes() : -1
    const fx = []
    let n = 0
    const before = new Map()
    const mark = (t) => before.has(t.id) || before.set(t.id, snapSlot(t))
    // 先看哪些真的會排進去：一件都排不進去的話，什麼都不動（不然清掉的時段會留在記憶體裡，下次存檔才寫進去）
    const ok = (p, t) => t && !t.done && TIME_RE.test(p.at) && toMin(p.at) >= nowMin
    if (!plan.some((p) => ok(p, this._find('tasks', p.id)))) return null
    for (const id of unslot) {
      const t = this._find('tasks', id)
      if (!t || t.done || t.date !== date || !t.at || toMin(t.at) < nowMin) continue
      mark(t)
      t.at = null
    }
    for (const p of plan) {
      const t = this._find('tasks', p.id)
      if (!ok(p, t)) continue
      mark(t)
      if (t.date < date) t.moved = (t.moved || 0) + 1
      t.date = date
      this._fitStar(t)
      t.at = p.at
      t.dur ||= p.dur
      n++
    }
    this.stats.plansApplied++
    if (date === this.today && !this.day().timebox) {
      this.day().timebox = 1
      this._gain(XP.plan, fx, { kind: 'plan' })
    }
    fx.push(['planApplied', { date, count: n, left }])
    this._finish(fx)
    const items = [...before].map(([id, b]) => ({ id, ...b, after: snapSlot(this._find('tasks', id)) }))
    return { date, count: n, items }
  },
  // 撤銷剛才的最佳化時程：每一件回到原本的日子、時段、長度、往後挪的次數、本命、先做這件。
  // 之後又改過的那一件（換了天、時段、長度，做完了、刪掉了、改成長期）、正在專注的那一件（skip）就留著現在的樣子；
  // 原本的時段之後被別的日程、任務佔走了，就回到那天、不排時段（不疊在一起）。回傳 { back：回去幾件, kept：留著幾件 }
  undoPlan(u, { skip = [] } = {}) {
    if (!u?.items?.length) return { back: 0, kept: 0 }
    const same = (x, t) => {
      const a = x.after
      return t && !t.done && !floating(t) && !skip.includes(t.id) && t.date === a.date && (t.at ?? null) === a.at && (t.dur ?? null) === a.dur
    }
    const list = u.items.map((x) => [x, this._find('tasks', x.id)]).filter(([x, t]) => same(x, t))
    const mine = new Set(list.map(([, t]) => t.id))
    // 原本那個時段現在空著嗎：那天還沒做完的日程（含還沒生成的例行日程；做完的不佔時段，跟排程一樣）、這次沒有要搬回去的任務
    const free = (date, at, dur, self) => {
      const s0 = toMin(at)
      const e0 = s0 + dur
      if (this._busyEvents(date).some((e) => !e.done && toMin(e.start) < e0 && s0 < toMin(e.end))) return false
      return !this.tasksOn(date).some((o) => o !== self && !mine.has(o.id) && o.at && !o.done && toMin(o.at) < e0 && s0 < toMin(o.at) + taskDur(o))
    }
    let back = 0
    for (const [x, t] of list) {
      const a = x.after
      this._editedTask(t)
      t.date = x.date
      t.dur = x.dur
      t.at = x.at && free(x.date, x.at, taskDur(t), t) ? x.at : null
      t.moved = Math.max(0, (t.moved || 0) - (a.moved - x.moved))
      if (x.star && t.star === a.star && !floating(t) && t.date >= this.today) t.star = true
      if (x.first && t.first === a.first && !floating(t) && t.date >= this.today) t.first = true
      this._fitStar(t)
      this._editedTask(t)
      back++
    }
    // 撤銷了就不算一次（成就「累計套用 10 次」不能靠套用、撤銷刷出來）；今天的「替今天安排時段」照舊算完成
    if (back) {
      this.stats.plansApplied = Math.max(0, this.stats.plansApplied - 1)
      this._finish()
    }
    return { back, kept: u.items.length - back }
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
  // 那天有時段的日程，還沒生成的例行日程也算（警語交給手機排到明天時，明天一早的例行會議也要先避開）
  timedEventsOn(date) {
    return this._busyEvents(date)
  },
  coachContext(dates) {
    const set = new Set(dates)
    const n = new Date()
    // 匯入的行事曆（eventsOn 裡有）也要避開
    const events = dates.flatMap((date) => [...this.eventsOn(date), ...this._routineEventsOn(date)])
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
