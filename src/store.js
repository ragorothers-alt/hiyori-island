// 狀態管理 + 遊戲規則（經驗值、連續天數、成就、每日任務）。
// 所有變更都經過 action → _finish(fx)：先存檔、發出 'change' 讓 UI/場景同步，再依序發出特效事件。

import { ACHIEVEMENTS } from './data/achievements.js'
import { PRIORITIES, XP, levelFromXp, MAX_PROJECTS, TAGS } from './theme.js'

const KEY = 'hiyori-daily-v1'

export function dateStr(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function addDays(s, n) {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return dateStr(d)
}
export const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const uid = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7)

// remindLead：日程開始前幾分鐘提醒（-1 = 不提醒）
export const DEFAULT_SETTINGS = { sound: true, remindLead: 10, notify: false }

export const QUESTS = [
  { id: 'tasks3', title: '讓三朵花綻放', sub: '完成 3 個任務', goal: 3, val: (d) => d.tasks },
  { id: 'focus2', title: '靜心兩回', sub: '完成 2 個番茄鐘', goal: 2, val: (d) => d.pomodoros },
  { id: 'step1', title: '向前一步', sub: '完成 1 個日程或里程碑', goal: 1, val: (d) => d.events + d.milestones },
]

const emptyStats = () => ({
  tasksDone: 0, highTasksDone: 0, eventsDone: 0, milestonesDone: 0, projectsDone: 0, projectsCreated: 0,
  pomodoros: 0, focusMinutes: 0, bestStreak: 0, perfectDays: 0, earlyTasks: 0, nightTasks: 0,
  questsClaimed: 0, pets: 0, bestDayTasks: 0,
})
const emptyDay = () => ({ tasks: 0, events: 0, milestones: 0, pomodoros: 0, focus: 0, xp: 0, perfect: false })

const ms = (title, done = false) => ({ id: uid(), title, done, rewarded: done })

function seed() {
  const today = dateStr()
  const task = (title, priority, tag) => ({ id: uid(), title, date: today, priority, tag, done: false, rewarded: false, createdAt: Date.now() })
  const ev = (title, start, end, color) => ({ id: uid(), title, date: today, start, end, color, done: false, rewarded: false })
  return {
    version: 1,
    tasks: [
      task('寫下今天最重要的三件事', 3, 'work'),
      task('讀 20 頁書', 2, 'study'),
      task('喝一杯溫水', 1, 'health'),
      task('整理桌面', 1, 'life'),
      task('記下一個新點子', 2, 'idea'),
    ],
    events: [
      ev('晨間規劃', '09:00', '09:30', 0),
      ev('深度工作時段', '10:00', '12:00', 2),
      ev('午餐散步', '12:30', '13:30', 1),
      ev('設計週會', '15:00', '16:00', 3),
      ev('晚間閱讀', '21:00', '22:00', 4),
    ],
    projects: [
      {
        id: uid(), name: '作品集網站改版', color: 1, deadline: addDays(today, 14), slot: 0, createdAt: Date.now(),
        milestones: [ms('整理作品清單', true), ms('設計首頁版型', true), ms('撰寫案例文案'), ms('前端切版'), ms('上線發佈')],
        completedAt: null, archived: false,
      },
      {
        id: uid(), name: '認識ひより小島', color: 0, deadline: addDays(today, 3), slot: 1, createdAt: Date.now(),
        milestones: [ms('完成第一個任務'), ms('加入一個日程'), ms('完成一次番茄鐘'), ms('摸摸もち')],
        completedAt: null, archived: false,
      },
    ],
    player: { xp: 0, streak: 0, lastActive: null, stats: emptyStats(), achievements: {} },
    history: {},
    quests: {},
    settings: { ...DEFAULT_SETTINGS },
    createdAt: Date.now(),
  }
}

// ── 讀檔／匯入時把每個欄位都清洗成合法值（資料一律視為不可信） ──
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const ID_RE = /^[\w-]{1,40}$/
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const str = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v, min, max, dflt) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, Math.round(+v))) : dflt)
const ts = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null)
const ymd = (v, dflt) => (DATE_RE.test(v) ? v : dflt)

function cleanList(list, fn) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (!isObj(raw)) continue
    const item = fn(raw)
    if (!item) continue
    if (!ID_RE.test(item.id) || seen.has(item.id)) item.id = uid()
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function migrate(s) {
  if (!isObj(s)) throw new Error('不是有效的ひより存檔')
  const today = dateStr()
  const tags = new Set(TAGS.map((t) => t.id))
  const tasks = cleanList(s.tasks, (t) => {
    const title = str(t.title).trim()
    if (!title) return null
    const done = !!t.done
    return {
      id: str(t.id), title, date: ymd(t.date, today), priority: num(t.priority, 1, 3, 2),
      tag: tags.has(t.tag) ? t.tag : 'life', done, rewarded: !!t.rewarded || done,
      createdAt: ts(t.createdAt) || Date.now(), doneAt: done ? ts(t.doneAt) : null,
    }
  })
  const events = cleanList(s.events, (e) => {
    const title = str(e.title).trim()
    if (!title) return null
    const start = TIME_RE.test(e.start) ? e.start : '09:00'
    let end = TIME_RE.test(e.end) ? e.end : '10:00'
    if (toMin(end) <= toMin(start)) end = minToHHMM(Math.min(toMin(start) + 60, 1439))
    const done = !!e.done
    return { id: str(e.id), title, date: ymd(e.date, today), start, end, color: num(e.color, 0, 99, 0), done, rewarded: !!e.rewarded || done }
  })
  const projects = cleanList(s.projects, (p) => {
    const name = str(p.name, 60).trim()
    if (!name) return null
    const milestones = cleanList(p.milestones, (m) => {
      const title = str(m.title).trim()
      if (!title) return null
      const done = !!m.done
      return { id: str(m.id), title, done, rewarded: !!m.rewarded || done }
    })
    return {
      id: str(p.id), name, color: num(p.color, 0, 99, 0), deadline: ymd(p.deadline, ''), createdAt: ts(p.createdAt) || Date.now(),
      milestones, completedAt: ts(p.completedAt), archived: !!p.archived, slot: num(p.slot, 0, MAX_PROJECTS - 1, 0),
    }
  })
  // 重新分配塔位：重複的換到空地，空地不夠就改為收藏
  const used = new Set()
  for (const p of projects) {
    if (p.archived) continue
    if (used.has(p.slot)) {
      let free = 0
      while (used.has(free) && free < MAX_PROJECTS) free++
      if (free >= MAX_PROJECTS) p.archived = true
      else p.slot = free
    }
    if (!p.archived) used.add(p.slot)
  }

  const ps = isObj(s.player) ? s.player : {}
  const rawStats = isObj(ps.stats) ? ps.stats : {}
  const stats = emptyStats()
  for (const k of Object.keys(stats)) stats[k] = num(rawStats[k], 0, 1e9, 0)
  const achievements = {}
  if (isObj(ps.achievements)) for (const [k, v] of Object.entries(ps.achievements)) if (ID_RE.test(k) && ts(v)) achievements[k] = +v
  const player = {
    xp: num(ps.xp, 0, 1e9, 0), streak: num(ps.streak, 0, 1e6, 0),
    lastActive: DATE_RE.test(ps.lastActive) ? ps.lastActive : null, stats, achievements,
  }

  const history = {}
  if (isObj(s.history)) {
    for (const [d, v] of Object.entries(s.history)) {
      if (!DATE_RE.test(d) || !isObj(v)) continue
      const h = emptyDay()
      for (const k of ['tasks', 'events', 'milestones', 'pomodoros', 'focus', 'xp']) h[k] = num(v[k], 0, 1e7, 0)
      h.perfect = !!v.perfect
      history[d] = h
    }
  }
  const quests = {}
  if (isObj(s.quests)) {
    for (const [d, v] of Object.entries(s.quests)) {
      if (!DATE_RE.test(d) || !isObj(v)) continue
      quests[d] = {}
      for (const q of QUESTS) if (v[q.id]) quests[d][q.id] = true
    }
  }
  const settings = { ...DEFAULT_SETTINGS }
  if (isObj(s.settings)) {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      const raw = s.settings[k]
      if (typeof v === 'boolean' && typeof raw === 'boolean') settings[k] = raw
      if (typeof v === 'number' && Number.isFinite(+raw)) settings[k] = +raw
    }
  }
  settings.remindLead = num(settings.remindLead, -1, 120, DEFAULT_SETTINGS.remindLead)
  return { version: 1, tasks, events, projects, player, history, quests, settings, createdAt: ts(s.createdAt) || Date.now() }
}

export class Store {
  constructor() {
    this.handlers = {}
    this.state = this._load()
    this.today = dateStr()
    this.selectedDate = this.today
    this._readyQuests = new Set(this.quests().filter((q) => q.ready).map((q) => q.id))
  }

  // ── 事件 ──
  on(type, fn) {
    ;(this.handlers[type] ||= []).push(fn)
    return () => (this.handlers[type] = this.handlers[type].filter((f) => f !== fn))
  }
  emit(type, payload) {
    for (const fn of this.handlers[type] || []) fn(payload)
  }

  // ── 存取 ──
  _load() {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return migrate(JSON.parse(raw))
    } catch (e) {
      console.warn('[hiyori] 讀取存檔失敗，使用預設資料', e)
    }
    return seed()
  }
  save() {
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => this.saveNow(), 120)
  }
  saveNow() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state))
    } catch (e) {
      console.warn('[hiyori] 存檔失敗', e)
    }
  }

  // ── 推導資料 ──
  get player() { return this.state.player }
  get stats() { return this.state.player.stats }
  get level() { return levelFromXp(this.state.player.xp) }
  get streak() {
    const p = this.state.player
    if (!p.lastActive) return 0
    return p.lastActive === this.today || p.lastActive === addDays(this.today, -1) ? p.streak : 0
  }
  day(date = this.today) {
    return (this.state.history[date] ||= emptyDay())
  }
  peekDay(date) {
    return this.state.history[date] || emptyDay()
  }
  tasksOn(date) {
    return this.state.tasks.filter((t) => t.date === date)
  }
  overdue() {
    return this.state.tasks.filter((t) => !t.done && t.date < this.today)
  }
  eventsOn(date) {
    return this.state.events.filter((e) => e.date === date).sort((a, b) => toMin(a.start) - toMin(b.start))
  }
  activeProjects() {
    return this.state.projects.filter((p) => !p.archived)
  }
  progress(p) {
    const n = p.milestones.length
    return n ? p.milestones.filter((m) => m.done).length / n : 0
  }
  statsSnapshot() {
    return { ...this.stats, level: this.level.level, streak: this.streak }
  }
  quests() {
    const d = this.peekDay(this.today)
    const claimed = this.state.quests[this.today] || {}
    return QUESTS.map((q) => {
      const v = Math.min(q.goal, q.val(d))
      return { ...q, value: v, ready: v >= q.goal, claimed: !!claimed[q.id] }
    })
  }

  // ── 內部 ──
  _gain(amount, fx, meta = {}) {
    const before = this.level.level
    this.state.player.xp += amount
    this.day().xp += amount
    fx.push(['xp', { amount, ...meta }])
    const after = this.level.level
    if (after > before) fx.push(['levelUp', { level: after, from: before }])
  }
  _touchStreak() {
    const p = this.state.player
    if (p.lastActive === this.today) return
    p.streak = p.lastActive === addDays(this.today, -1) ? p.streak + 1 : 1
    p.lastActive = this.today
    p.stats.bestStreak = Math.max(p.stats.bestStreak, p.streak)
  }
  _finish(fx = []) {
    const got = this.state.player.achievements
    const snap = this.statsSnapshot()
    for (const a of ACHIEVEMENTS) {
      if (!got[a.id] && (snap[a.cond.stat] ?? 0) >= a.cond.gte) {
        got[a.id] = Date.now()
        fx.push(['achievement', a])
      }
    }
    for (const q of this.quests()) {
      if (q.ready && !q.claimed && !this._readyQuests.has(q.id)) fx.push(['questReady', q])
      if (q.ready) this._readyQuests.add(q.id)
    }
    this.save()
    this.emit('change')
    if (this._dayChanged) {
      this._dayChanged = false
      this.emit('dateChanged', this.selectedDate)
    }
    for (const [type, payload] of fx) this.emit(type, payload)
  }
  _find(list, id) {
    return this.state[list].find((x) => x.id === id)
  }

  // ── 日期 ──
  selectDate(date) {
    this.selectedDate = date
    this.emit('change')
    this.emit('dateChanged', date)
  }
  // 只更新日期、不發事件；回傳是否跨日。會寫入每日統計的動作都要先呼叫
  _refreshToday() {
    const now = dateStr()
    if (now === this.today) return false
    const wasToday = this.selectedDate === this.today
    this.today = now
    this._readyQuests = new Set()
    if (wasToday) this.selectedDate = now
    this._dayChanged = true
    return true
  }
  tick() {
    if (!this._refreshToday()) return false
    this._dayChanged = false
    this.emit('change')
    this.emit('dateChanged', this.selectedDate)
    return true
  }

  // ── 任務 ──
  addTask({ title, priority = 2, tag = 'life', date = this.selectedDate }) {
    const t = { id: uid(), title: title.trim(), date, priority, tag, done: false, rewarded: false, createdAt: Date.now() }
    if (!t.title) return null
    this.state.tasks.push(t)
    this._finish([['taskAdded', t]])
    return t
  }
  toggleTask(id) {
    const t = this._find('tasks', id)
    if (!t) return
    this._refreshToday()
    t.done = !t.done
    t.doneAt = t.done ? Date.now() : null
    const fx = []
    if (t.done) {
      fx.push(['taskDone', t])
      if (!t.rewarded) {
        t.rewarded = true
        const s = this.stats
        s.tasksDone++
        if (t.priority === 3) s.highTasksDone++
        const h = new Date().getHours()
        if (h < 9) s.earlyTasks++
        if (h >= 22) s.nightTasks++
        const d = this.day()
        d.tasks++
        s.bestDayTasks = Math.max(s.bestDayTasks, d.tasks)
        this._touchStreak()
        this._gain(PRIORITIES[t.priority]?.xp ?? 10, fx, { kind: 'task', id: t.id })
      }
      const list = this.tasksOn(t.date)
      if (t.date === this.today && list.every((x) => x.done)) {
        fx.push(['allDone', { count: list.length }])
        const d = this.day()
        if (list.length >= 3 && !d.perfect) {
          d.perfect = true
          this.stats.perfectDays++
          this._gain(XP.perfectDay, fx, { kind: 'perfect' })
        }
      }
    } else {
      fx.push(['taskUndone', t])
    }
    this._finish(fx)
  }
  updateTask(id, patch) {
    const t = this._find('tasks', id)
    if (!t) return
    Object.assign(t, patch)
    this._finish()
  }
  deleteTask(id) {
    this.state.tasks = this.state.tasks.filter((t) => t.id !== id)
    this._finish([['taskDeleted', id]])
  }
  moveToToday(ids) {
    for (const id of ids) {
      const t = this._find('tasks', id)
      if (t) t.date = this.today
    }
    this._finish()
  }

  // ── 日程 ──
  addEvent({ title, start, end, color = 0, date = this.selectedDate }) {
    if (!title.trim()) return null
    if (toMin(end) <= toMin(start)) end = start === '23:30' ? '23:59' : minToHHMM(Math.min(toMin(start) + 60, 1439))
    const e = { id: uid(), title: title.trim(), date, start, end, color, done: false, rewarded: false }
    this.state.events.push(e)
    this._finish([['eventAdded', e]])
    return e
  }
  toggleEvent(id) {
    const e = this._find('events', id)
    if (!e) return
    this._refreshToday()
    e.done = !e.done
    const fx = []
    if (e.done) {
      fx.push(['eventDone', e])
      if (!e.rewarded) {
        e.rewarded = true
        this.stats.eventsDone++
        this.day().events++
        this._gain(XP.event, fx, { kind: 'event', id: e.id })
      }
    }
    this._finish(fx)
  }
  updateEvent(id, patch) {
    const e = this._find('events', id)
    if (!e) return
    Object.assign(e, patch)
    this._finish()
  }
  deleteEvent(id) {
    this.state.events = this.state.events.filter((e) => e.id !== id)
    this._finish()
  }

  // ── 專案 ──
  freeSlot() {
    const used = new Set(this.activeProjects().map((p) => p.slot))
    for (let i = 0; i < MAX_PROJECTS; i++) if (!used.has(i)) return i
    return -1
  }
  addProject({ name, color = 0, deadline = '', milestones = [] }) {
    const slot = this.freeSlot()
    if (slot < 0 || !name.trim()) return null
    const p = {
      id: uid(), name: name.trim(), color, deadline, slot, createdAt: Date.now(),
      milestones: milestones.map((t) => t.trim()).filter(Boolean).map((t) => ms(t)),
      completedAt: null, archived: false,
    }
    this.state.projects.push(p)
    this.stats.projectsCreated++
    this._finish([['projectAdded', p]])
    return p
  }
  updateProject(id, patch) {
    const p = this._find('projects', id)
    if (!p) return
    Object.assign(p, patch)
    this._finish()
  }
  deleteProject(id) {
    this.state.projects = this.state.projects.filter((p) => p.id !== id)
    this._finish()
  }
  archiveProject(id, archived = true) {
    const p = this._find('projects', id)
    if (!p) return false
    if (!archived) {
      const slot = this.freeSlot()
      if (slot < 0) return false
      p.slot = slot
    }
    p.archived = archived
    this._finish()
    return true
  }
  addMilestone(pid, title) {
    const p = this._find('projects', pid)
    if (!p || !title.trim()) return
    p.milestones.push(ms(title.trim()))
    this._finish()
  }
  deleteMilestone(pid, mid) {
    const p = this._find('projects', pid)
    if (!p) return
    p.milestones = p.milestones.filter((m) => m.id !== mid)
    const fx = []
    this._completeProject(p, fx)
    this._finish(fx)
  }
  _completeProject(p, fx) {
    if (!p.milestones.length || p.completedAt || !p.milestones.every((m) => m.done)) return
    p.completedAt = Date.now()
    this.stats.projectsDone++
    this._gain(XP.project, fx, { kind: 'project', id: p.id })
    fx.push(['projectDone', p])
  }
  toggleMilestone(pid, mid) {
    const p = this._find('projects', pid)
    const m = p?.milestones.find((x) => x.id === mid)
    if (!m) return
    this._refreshToday()
    m.done = !m.done
    const fx = []
    if (m.done) {
      fx.push(['milestoneDone', { project: p, milestone: m }])
      if (!m.rewarded) {
        m.rewarded = true
        this.stats.milestonesDone++
        this.day().milestones++
        this._gain(XP.milestone, fx, { kind: 'milestone', id: p.id })
      }
      this._completeProject(p, fx)
    } else {
      fx.push(['milestoneUndone', { project: p, milestone: m }])
    }
    this._finish(fx)
  }

  // ── 專注 / 互動 / 每日任務 ──
  completePomodoro(minutes) {
    this._refreshToday()
    const fx = [['pomodoro', { minutes }]]
    this.stats.pomodoros++
    this.stats.focusMinutes += minutes
    const d = this.day()
    d.pomodoros++
    d.focus += minutes
    this._gain(XP.pomodoro, fx, { kind: 'focus' })
    this._finish(fx)
  }
  pet() {
    this.stats.pets++
    // 摸摸不需要重繪面板（避免打斷正在輸入的欄位），除非剛好解鎖成就
    const snap = this.statsSnapshot()
    const unlocked = ACHIEVEMENTS.some((a) => !this.state.player.achievements[a.id] && (snap[a.cond.stat] ?? 0) >= a.cond.gte)
    if (unlocked) this._finish()
    else this.save()
  }
  claimQuest(qid) {
    this._refreshToday()
    const q = this.quests().find((x) => x.id === qid)
    if (!q || !q.ready || q.claimed) return
    ;(this.state.quests[this.today] ||= {})[qid] = true
    this.stats.questsClaimed++
    const fx = [['questClaimed', q]]
    this._gain(XP.quest, fx, { kind: 'quest', id: qid })
    this._finish(fx)
  }
  setSetting(key, value) {
    this.state.settings[key] = value
    this.save()
  }

  // ── 資料 ──
  exportJSON() {
    return JSON.stringify(this.state, null, 2)
  }
  importJSON(text) {
    let obj
    try {
      obj = JSON.parse(text)
    } catch {
      throw new Error('檔案不是 JSON 格式')
    }
    if (!isObj(obj) || !Array.isArray(obj.tasks) || !isObj(obj.player)) throw new Error('不是有效的ひより存檔')
    // 先完整清洗成功，才替換現有狀態
    const next = migrate(obj)
    this.state = next
    this.saveNow()
    this._readyQuests = new Set(this.quests().filter((q) => q.ready).map((q) => q.id))
    this.emit('change')
    this.emit('reload')
  }
  reset() {
    localStorage.removeItem(KEY)
    this.state = seed()
    this._readyQuests = new Set()
    this.saveNow()
    this.emit('change')
    this.emit('reload')
  }
}

export function minToHHMM(m) {
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
