// 狀態管理 + 遊戲規則（經驗值、連續天數、成就、每日任務）。
// 所有變更都經過 action → _finish(fx)：先存檔、發出 'change' 讓 UI/場景同步，再依序發出特效事件。

import { ACHIEVEMENTS } from './data/achievements.js'
import { SHOP_ITEMS } from './data/shop.js'
import { COMMON_BY_TAG, flowerOf, rollFlower } from './data/flowers.js'
import { DAILY_QUESTS, QUEST_TIERS, WEEKLY_QUESTS, questOf, weeklyOf } from './data/quests.js'
import { BOND_POINTS, actLevel, bondLevel, outfitLevel, outfitOf } from './data/bond.js'
import { PRIORITIES, XP, levelFromXp, MAX_PROJECTS, TAGS, WEEK_ZH, MOODS, MAX_STARS, SOFT_CAP, CHARM } from './theme.js'

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

// ── 例行公事（重複任務／日程） ──
export const REPEAT_TYPES = ['daily', 'weekdays', 'weekly']
export function repeatMatches(rep, date) {
  const d = parseDate(date).getDay()
  if (rep.type === 'daily') return true
  if (rep.type === 'weekdays') return d >= 1 && d <= 5
  return rep.days.includes(d)
}
// 季節（與 scene/season.js 的 seasonOf 相同規則；store 不依賴場景模組）
export function seasonKey(date) {
  const m = parseDate(date).getMonth() + 1
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'
}
export const SEASON_ZH = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)

export function repeatLabel(rep) {
  if (rep.type === 'daily') return '每天'
  if (rep.type === 'weekdays') return '平日'
  return '每週' + [...rep.days].sort().map((d) => WEEK_ZH[d]).join('、')
}

// remindLead：日程開始前幾分鐘提醒（-1 = 不提醒）
export const DEFAULT_SETTINGS = { sound: true, remindLead: 10, notify: false, powerSave: true }

// 舊版固定的三個每日任務（舊存檔沿用）
const LEGACY_QUESTS = ['tasks3', 'focus2', 'step1']
const hash01 = (str) => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000003) / 1000003
}
// 一週從星期一開始；回傳那週星期一的日期
export function weekKey(date) {
  const d = parseDate(date)
  return addDays(date, -((d.getDay() + 6) % 7))
}

const emptyStats = () => ({
  tasksDone: 0, highTasksDone: 0, eventsDone: 0, milestonesDone: 0, projectsDone: 0, projectsCreated: 0,
  pomodoros: 0, focusMinutes: 0, bestStreak: 0, perfectDays: 0, earlyTasks: 0, nightTasks: 0,
  questsClaimed: 0, pets: 0, bestDayTasks: 0, itemsBought: 0, reviews: 0,
  starsDone: 0, starDays: 0, weeklyClaimed: 0, charmsUsed: 0, projectsOnTime: 0,
})
// 每日紀錄。stars／high／early（中午前）／routines：完成數；tagMask：完成過的分類（位元）；
// plan：中午前選好 3 件本命；starAll：本命全清；review：寫了回顧；pets：摸摸次數
const DAY_NUMS = ['tasks', 'events', 'milestones', 'pomodoros', 'focus', 'xp', 'stars', 'high', 'early', 'tagMask', 'routines', 'plan', 'review', 'pets', 'rare']
const DAY_FLAGS = ['perfect', 'starAll']
const emptyDay = () => {
  const d = {}
  for (const k of DAY_NUMS) d[k] = 0
  for (const k of DAY_FLAGS) d[k] = false
  return d
}

// もち的好感度：pts 累計點數、outfit 目前衣裝、visit 最近一次來訪、petDay/petN 今天摸了幾次（有上限）、gift 最近一次收到禮物
const emptyBond = () => ({ pts: 0, outfit: 'none', visit: '', petDay: '', petN: 0, gift: '' })

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
    player: { xp: 0, coins: 0, streak: 0, lastActive: null, stats: emptyStats(), achievements: {}, unlocked: {}, freebies: {}, charms: 0, bond: emptyBond() },
    placed: [],
    routines: [],
    journal: {},
    dex: {},
    weekly: {},
    history: {},
    quests: {},
    settings: { ...DEFAULT_SETTINGS },
    createdAt: Date.now(),
    updatedAt: 0,
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
      routineId: ID_RE.test(t.routineId) ? t.routineId : null,
      pomos: num(t.pomos, 0, 99, 0),
      star: !!t.star,
      flower: flowerOf(t.flower) ? t.flower : null,
    }
  })
  const events = cleanList(s.events, (e) => {
    const title = str(e.title).trim()
    if (!title) return null
    const start = TIME_RE.test(e.start) ? e.start : '09:00'
    let end = TIME_RE.test(e.end) ? e.end : '10:00'
    if (toMin(end) <= toMin(start)) end = minToHHMM(Math.min(toMin(start) + 60, 1439))
    const done = !!e.done
    return {
      id: str(e.id), title, date: ymd(e.date, today), start, end, color: num(e.color, 0, 99, 0), done, rewarded: !!e.rewarded || done,
      routineId: ID_RE.test(e.routineId) ? e.routineId : null,
    }
  })
  const routines = cleanList(s.routines, (r) => {
    const title = str(r.title).trim()
    if (!title) return null
    const rep = isObj(r.repeat) ? r.repeat : {}
    const type = REPEAT_TYPES.includes(rep.type) ? rep.type : 'daily'
    const days = Array.isArray(rep.days) ? [...new Set(rep.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : []
    if (type === 'weekly' && !days.length) return null
    const start = TIME_RE.test(r.start) ? r.start : '09:00'
    let end = TIME_RE.test(r.end) ? r.end : '10:00'
    if (toMin(end) <= toMin(start)) end = minToHHMM(Math.min(toMin(start) + 60, 1439))
    const made = {}
    if (isObj(r.made)) for (const d of Object.keys(r.made)) if (DATE_RE.test(d)) made[d] = true
    return {
      id: str(r.id), kind: r.kind === 'event' ? 'event' : 'task', title, repeat: { type, days },
      priority: num(r.priority, 1, 3, 2), tag: tags.has(r.tag) ? r.tag : 'life', start, end, color: num(r.color, 0, 99, 0),
      startDate: ymd(r.startDate, today), made, createdAt: ts(r.createdAt) || Date.now(),
    }
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
      milestones, completedAt: ts(p.completedAt), archived: !!p.archived, slot: num(p.slot, 0, MAX_PROJECTS - 1, 0), onTime: !!p.onTime,
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
  const xp = num(ps.xp, 0, 1e9, 0)
  const player = {
    // 舊存檔沒有金平糖：依現有經驗值換算一筆起始金額
    xp, coins: ps.coins === undefined ? Math.round(xp / 5) : num(ps.coins, 0, 1e9, 0), streak: num(ps.streak, 0, 1e6, 0),
    lastActive: DATE_RE.test(ps.lastActive) ? ps.lastActive : null, stats, achievements,
    unlocked: {}, freebies: {}, charms: num(ps.charms, 0, CHARM.max, 0), bond: emptyBond(),
  }
  if (isObj(ps.bond)) {
    const b = ps.bond
    Object.assign(player.bond, {
      pts: num(b.pts, 0, 1e7, 0), outfit: outfitOf(b.outfit) ? b.outfit : 'none',
      visit: ymd(b.visit, ''), petDay: ymd(b.petDay, ''), petN: num(b.petN, 0, 99, 0), gift: ymd(b.gift, ''),
    })
  }

  const shopKeys = new Set(SHOP_ITEMS.map((i) => i.key))
  for (const k of ['unlocked', 'freebies']) {
    if (!isObj(ps[k])) continue
    for (const [key, v] of Object.entries(ps[k])) if (shopKeys.has(key)) player[k][key] = k === 'unlocked' ? !!v : num(v, 0, 99, 0)
  }
  const placed = cleanList(s.placed, (p) => {
    if (!shopKeys.has(p.key) || !Number.isFinite(+p.x) || !Number.isFinite(+p.z)) return null
    return { id: str(p.id), key: p.key, x: Math.max(-9, Math.min(9, +p.x)), z: Math.max(-9, Math.min(9, +p.z)), rot: Number.isFinite(+p.rot) ? +p.rot : 0, free: !!p.free }
  })

  const history = {}
  if (isObj(s.history)) {
    for (const [d, v] of Object.entries(s.history)) {
      if (!DATE_RE.test(d) || !isObj(v)) continue
      const h = emptyDay()
      for (const k of DAY_NUMS) h[k] = num(v[k], 0, 1e7, 0)
      for (const k of DAY_FLAGS) h[k] = !!v[k]
      history[d] = h
    }
  }
  // 花の圖鑑：{ 花的 key: { at: 第一次開出的日期, n: 開過幾朵 } }
  const dex = {}
  if (isObj(s.dex)) {
    for (const [k, v] of Object.entries(s.dex)) if (flowerOf(k) && isObj(v)) dex[k] = { at: ymd(v.at, today), n: num(v.n, 1, 1e6, 1) }
  } else {
    // 舊存檔：已完成的任務算作開過該分類的常見花
    for (const t of tasks) {
      if (!t.done) continue
      const k = t.flower || COMMON_BY_TAG[t.tag]
      dex[k] ||= { at: t.date, n: 0 }
      dex[k].n++
      if (t.date < dex[k].at) dex[k].at = t.date
    }
  }
  const moodKeys = new Set(MOODS.map((m) => m.key))
  const journal = {}
  if (isObj(s.journal)) {
    for (const [d, v] of Object.entries(s.journal)) {
      if (!DATE_RE.test(d) || !isObj(v) || !moodKeys.has(v.mood)) continue
      journal[d] = { mood: v.mood, text: str(v.text, 140), at: ts(v.at) || Date.now() }
    }
  }
  const quests = {}
  if (isObj(s.quests)) {
    for (const [d, v] of Object.entries(s.quests)) {
      if (!DATE_RE.test(d) || !isObj(v)) continue
      const legacy = !Array.isArray(v.ids)
      const ids = (legacy ? LEGACY_QUESTS : v.ids.filter((id) => questOf(id))).slice(0, 3)
      const src = legacy ? v : isObj(v.claimed) ? v.claimed : {}
      const claimed = {}
      for (const id of ids) if (src[id]) claimed[id] = true
      if (ids.length) quests[d] = { ids, claimed }
    }
  }
  const weekly = {}
  if (isObj(s.weekly)) {
    for (const [w, v] of Object.entries(s.weekly)) if (DATE_RE.test(w) && isObj(v) && weeklyOf(v.id)) weekly[w] = { id: v.id, claimed: !!v.claimed }
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
  return { version: 1, tasks, events, projects, routines, placed, journal, dex, player, history, quests, weekly, settings, createdAt: ts(s.createdAt) || Date.now(), updatedAt: ts(s.updatedAt) || 0 }
}

export class Store {
  constructor() {
    this.handlers = {}
    this.state = this._load()
    this.today = dateStr()
    this.selectedDate = this.today
    this._pending = []
    this._applyCharms()
    this._visit()
    const made = this._ensureRoutines(this.today).length
    if (this._ensureQuests() || made) this.save(false)
    this._readyQuests = new Set(this.quests().filter((q) => q.ready).map((q) => q.id))
    this._weeklyReady = this.weekly()?.ready
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
  // touch：這次存檔是否算「使用者改了資料」。同步靠 updatedAt 判斷哪一邊比較新，
  // 例行實例生成、跨日這類每台裝置各自推導的變化不算，避免剛打開的裝置蓋掉雲端的新資料
  save(touch = true) {
    if (touch) {
      this.state.updatedAt = this._nextVersion()
      this.emit('dirty')
    }
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => this.saveNow(), 120)
  }
  // 版本號一定比上一版大：就算這台電腦的時鐘比別台慢，新的變更也不會被當成舊的
  _nextVersion() {
    return Math.max(Date.now(), (this.state.updatedAt || 0) + 1)
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
  // 花圃要種的任務：那天的任務；看今天時，再加上最近 7 天還沒完成的（花會垂下）與今天才補完成的逾期任務
  gardenTasks(date) {
    const list = this.tasksOn(date)
    if (date !== this.today) return list
    const since = addDays(this.today, -7)
    const late = this.state.tasks.filter(
      (t) => t.date < this.today && t.date >= since && (!t.done || (t.doneAt && dateStr(new Date(t.doneAt)) === this.today)),
    )
    return [...list, ...late]
  }
  eventsOn(date) {
    return this.state.events.filter((e) => e.date === date).sort((a, b) => toMin(a.start) - toMin(b.start))
  }
  activeProjects() {
    return this.state.projects.filter((p) => !p.archived)
  }
  // 期限在兩天內（含今天）還沒落成的專案，最急的在前
  deadlineSoon() {
    return this.activeProjects()
      .filter((p) => p.deadline && !p.completedAt && p.milestones.length)
      .map((p) => ({ project: p, days: daysBetween(this.today, p.deadline) }))
      .filter((x) => x.days >= 0 && x.days <= 2)
      .sort((a, b) => a.days - b.days)
  }
  progress(p) {
    const n = p.milestones.length
    return n ? p.milestones.filter((m) => m.done).length / n : 0
  }
  get bond() {
    return bondLevel(this.state.player.bond.pts)
  }
  statsSnapshot() {
    const found = Object.keys(this.state.dex)
    return {
      ...this.stats, level: this.level.level, streak: this.streak, bondLevel: this.bond.level,
      flowersFound: found.length, legendFound: found.filter((k) => flowerOf(k)?.rarity === 'legend').length,
    }
  }
  // 任務開的花（舊任務沒有記錄時，用該分類的常見花）
  flowerOfTask(t) {
    return flowerOf(t.flower) || flowerOf(COMMON_BY_TAG[t.tag])
  }
  quests() {
    const d = this.peekDay(this.today)
    const entry = this.state.quests[this.today]
    if (!entry) return []
    return entry.ids.map((id) => {
      const q = questOf(id)
      const v = Math.min(q.goal, q.val(d))
      return { ...q, value: v, ready: v >= q.goal, claimed: !!entry.claimed[id] }
    })
  }
  // 依日期抽今天的三個每日任務（簡單／普通／挑戰各一，避開昨天同一格抽過的），抽過就固定
  _ensureQuests() {
    const date = this.today
    if (this.state.quests[date]) return false
    const ctx = {
      hour: new Date().getHours(),
      events: this.eventsOn(date).length,
      routineTasks: this.tasksOn(date).filter((t) => t.routineId).length,
      projects: this.activeProjects().filter((p) => !p.completedAt).length,
    }
    const yesterday = this.state.quests[addDays(date, -1)]?.ids || []
    const ids = QUEST_TIERS.map((tier) => {
      let pool = DAILY_QUESTS.filter((q) => q.tier === tier && (!q.need || q.need(ctx)))
      if (pool.length > 1) pool = pool.filter((q) => !yesterday.includes(q.id))
      return pool[Math.floor(hash01(date + tier) * pool.length)].id
    })
    this.state.quests[date] = { ids, claimed: {} }
    return true
  }

  // ── 每週挑戰 ──
  // 這週（星期一到今天）的累計
  weekStats(wk = weekKey(this.today)) {
    const w = { activeDays: 0, tasks: 0, focus: 0, starAllDays: 0, reviews: 0, perfectDays: 0, questsClaimed: 0, rare: 0 }
    for (let i = 0; i < 7; i++) {
      const date = addDays(wk, i)
      if (date > this.today) break
      const h = this.peekDay(date)
      if (h.tasks) w.activeDays++
      w.tasks += h.tasks
      w.focus += h.focus
      w.rare += h.rare
      if (h.starAll) w.starAllDays++
      if (h.perfect) w.perfectDays++
      if (this.state.journal[date]) w.reviews++
      w.questsClaimed += Object.keys(this.state.quests[date]?.claimed || {}).length
    }
    return w
  }
  weekly() {
    const wk = weekKey(this.today)
    let entry = this.state.weekly[wk]
    if (!entry) {
      // 依週次抽一個，避開上週同一個
      const last = this.state.weekly[addDays(wk, -7)]?.id
      const pool = WEEKLY_QUESTS.filter((q) => q.id !== last)
      entry = this.state.weekly[wk] = { id: pool[Math.floor(hash01(wk) * pool.length)].id, claimed: false }
    }
    const q = weeklyOf(entry.id)
    const value = Math.min(q.goal, q.val(this.weekStats(wk)))
    return { ...q, week: wk, value, ready: value >= q.goal, claimed: entry.claimed, daysLeft: 6 - daysBetween(wk, this.today) }
  }
  // 下一件還沒拿到的每週限定擺飾
  nextExclusive() {
    return SHOP_ITEMS.find((i) => i.exclusive && !this.state.player.unlocked[i.key]) || null
  }
  claimWeekly() {
    this._refreshToday()
    const q = this.weekly()
    if (!q.ready || q.claimed) return
    this.state.weekly[q.week].claimed = true
    this.stats.weeklyClaimed++
    const item = this.nextExclusive()
    const p = this.state.player
    const fx = [['weeklyClaimed', { quest: q, item }]]
    if (item) {
      p.unlocked[item.key] = true
      p.freebies[item.key] = (p.freebies[item.key] || 0) + 1
    } else p.coins += 40 // 限定品都拿過了：改送金平糖
    this._gain(XP.weekly, fx, { kind: 'weekly' })
    this._finish(fx)
  }

  // ── 內部 ──
  _gain(amount, fx, meta = {}) {
    const before = this.level.level
    const coins = Math.max(1, Math.round(amount / 5))
    this.state.player.xp += amount
    this.state.player.coins += coins
    this.day().xp += amount
    fx.push(['xp', { amount, coins, ...meta }])
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
    const wq = this.weekly()
    if (wq.ready && !wq.claimed && !this._weeklyReady) fx.push(['weeklyReady', wq])
    this._weeklyReady = wq.ready
    this.save()
    this.emit('change')
    if (this._dayChanged) {
      this._dayChanged = false
      this.emit('dateChanged', this.selectedDate)
    }
    for (const [type, payload] of fx) this.emit(type, payload)
    this.flushPending()
  }
  // 換日時發生、但當下還沒人聽的事件（例如お守り生效），等介面接好再送
  flushPending() {
    const list = this._pending.splice(0)
    for (const [type, payload] of list) this.emit(type, payload)
  }
  _find(list, id) {
    return this.state[list].find((x) => x.id === id)
  }

  // ── 日期 ──
  selectDate(date) {
    this.selectedDate = date
    if (this._ensureRoutines(date).length) this.save(false)
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
    this._ensureRoutines(now)
    if (this.selectedDate !== now) this._ensureRoutines(this.selectedDate)
    this._ensureQuests()
    this._applyCharms()
    this._visit()
    this._weeklyReady = this.weekly()?.ready
    return true
  }
  tick() {
    if (!this._refreshToday()) return false
    this._dayChanged = false
    this.save(false)
    this.emit('change')
    this.emit('dateChanged', this.selectedDate)
    this.flushPending()
    return true
  }

  // ── 晚間回顧 ──
  saveReview(date, mood, text) {
    this._refreshToday()
    if (!MOODS.some((m) => m.key === mood)) return
    const first = !this.state.journal[date]
    this.state.journal[date] = { mood, text: String(text || '').trim().slice(0, 140), at: Date.now() }
    if (date === this.today) this.day().review = 1
    const fx = [['reviewSaved', { date, mood, first }]]
    if (first) {
      this.stats.reviews++
      this._gain(XP.review, fx, { kind: 'review' })
      this._bondGain(BOND_POINTS.review, fx)
    }
    this._finish(fx)
  }
  journalList(n = 14) {
    return Object.entries(this.state.journal)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, n)
  }

  // ── もち的好感度 ──
  _bondGain(n, fx) {
    const b = this.state.player.bond
    const before = bondLevel(b.pts).level
    b.pts += n
    const after = bondLevel(b.pts)
    if (after.level > before) fx.push(['bondUp', after])
  }
  // 每天第一次打開：好感度 +2；好感度夠高時もち會送幾顆金平糖
  _visit() {
    const b = this.state.player.bond
    if (b.visit === this.today) return
    b.visit = this.today
    this._bondGain(BOND_POINTS.visit, this._pending)
    if (this.bond.level >= actLevel('gift') && b.gift !== this.today) {
      b.gift = this.today
      const coins = 3 + Math.floor(hash01(this.today + ':gift') * 4)
      this.state.player.coins += coins
      this._pending.push(['gift', { coins }])
    }
    this.save(false)
  }
  outfitUnlocked(key) {
    return !!outfitOf(key) && this.bond.level >= outfitLevel(key)
  }
  setOutfit(key) {
    if (!this.outfitUnlocked(key) || this.state.player.bond.outfit === key) return
    this.state.player.bond.outfit = key
    this._finish([['outfit', key]])
  }

  // ── お守り ──
  // 換日時：如果昨天（或更早）漏掉了，而お守り夠用，就替漏掉的每一天用掉一個，連續天數保住
  _applyCharms() {
    const p = this.state.player
    if (!p.lastActive || !p.streak || !p.charms) return
    const missed = daysBetween(p.lastActive, this.today) - 1
    if (missed < 1 || missed > p.charms) return
    p.charms -= missed
    p.stats.charmsUsed += missed
    p.lastActive = addDays(this.today, -1)
    this._pending.push(['charmUsed', { used: missed, streak: p.streak, left: p.charms }])
    this.save(false)
  }
  buyCharm() {
    const p = this.state.player
    if (p.charms >= CHARM.max) return
    if (p.coins < CHARM.price) {
      this.emit('shopPoor', { name: 'お守り', price: CHARM.price })
      return
    }
    p.coins -= CHARM.price
    p.charms++
    this._finish([['charmBought', { charms: p.charms }]])
  }

  // ── 金平糖商店 ──
  get coins() {
    return this.state.player.coins
  }
  // 商品現在能不能買：等級、季節、每週限定（還沒拿到就不顯示）；有免費券時價格為 0
  shopStatus(item) {
    const pl = this.state.player
    const free = (pl.freebies[item.key] || 0) > 0
    if (item.exclusive && !pl.unlocked[item.key]) return { hidden: true, ok: false, price: item.price }
    if ((item.level || 1) > this.level.level) return { ok: false, price: item.price, lock: `Lv.${item.level} 上架` }
    if (item.season && item.season !== seasonKey(this.today) && !free) return { ok: false, price: item.price, lock: `${SEASON_ZH[item.season]}天限定` }
    const price = free ? 0 : item.price
    return { ok: this.coins >= price, price, free }
  }
  placeItem(key, x, z, rot = 0) {
    const item = SHOP_ITEMS.find((i) => i.key === key)
    if (!item) return null
    const st = this.shopStatus(item)
    if (st.hidden || st.lock) return null
    if (this.coins < st.price) {
      this.emit('shopPoor', item)
      return null
    }
    if (st.free) this.state.player.freebies[key]--
    else this.state.player.coins -= item.price
    const p = { id: uid(), key, x, z, rot, free: !!st.free }
    this.state.placed.push(p)
    this.stats.itemsBought++
    this._finish([['itemPlaced', { item, placed: p }]])
    return p
  }
  moveItem(id, x, z, rot) {
    const p = this._find('placed', id)
    if (!p) return
    Object.assign(p, { x, z, rot })
    this._finish([['itemMoved', p]])
  }
  storeItem(id) {
    const p = this._find('placed', id)
    if (!p) return
    const item = SHOP_ITEMS.find((i) => i.key === p.key)
    // 用免費券擺的：收起來就把券還回去
    const refund = p.free ? 0 : Math.floor((item?.price || 0) / 2)
    if (p.free) this.state.player.freebies[p.key] = (this.state.player.freebies[p.key] || 0) + 1
    this.state.placed = this.state.placed.filter((x) => x.id !== id)
    this.state.player.coins += refund
    this._finish([['itemStored', { item, refund }]])
  }

  // ── 例行公事 ──
  // 只為「今天或之後」且尚未生成過的日期建立實例；使用者刪掉的實例不會再長回來
  _ensureRoutines(date) {
    const created = []
    if (date < this.today) return created
    for (const r of this.state.routines) {
      if (r.startDate > date || r.made[date] || !repeatMatches(r.repeat, date)) continue
      r.made[date] = true
      if (r.kind === 'task') {
        const t = { id: uid(), title: r.title, date, priority: r.priority, tag: r.tag, done: false, rewarded: false, createdAt: Date.now(), routineId: r.id }
        this.state.tasks.push(t)
        created.push(t)
      } else {
        const e = { id: uid(), title: r.title, date, start: r.start, end: r.end, color: r.color, done: false, rewarded: false, routineId: r.id }
        this.state.events.push(e)
        created.push(e)
      }
    }
    for (const r of this.state.routines) for (const d of Object.keys(r.made)) if (d < this.today) delete r.made[d]
    return created
  }
  routineOf(item) {
    return item?.routineId ? this.state.routines.find((r) => r.id === item.routineId) : null
  }
  addRoutine({ kind = 'task', title, repeat, priority = 2, tag = 'life', start = '09:00', end = '10:00', color = 0, date = this.selectedDate }) {
    title = title.trim()
    if (!title || !REPEAT_TYPES.includes(repeat?.type)) return null
    const days = repeat.type === 'weekly' ? (repeat.days?.length ? repeat.days : [parseDate(date).getDay()]) : []
    if (toMin(end) <= toMin(start)) end = minToHHMM(Math.min(toMin(start) + 60, 1439))
    const r = {
      id: uid(), kind, title, repeat: { type: repeat.type, days }, priority, tag, start, end, color,
      startDate: date < this.today ? this.today : date, made: {}, createdAt: Date.now(),
    }
    this.state.routines.push(r)
    const fx = [['routineAdded', r]]
    for (const item of this._ensureRoutines(r.startDate)) fx.push([kind === 'task' ? 'taskAdded' : 'eventAdded', item])
    this._finish(fx)
    return r
  }
  deleteRoutine(id) {
    this.state.routines = this.state.routines.filter((r) => r.id !== id)
    // 已完成的保留當紀錄，未來還沒做的一併移除
    const keep = (x) => x.routineId !== id || x.done || x.date < this.today
    this.state.tasks = this.state.tasks.filter(keep)
    this.state.events = this.state.events.filter(keep)
    this._finish()
  }

  // ── 任務 ──
  addTask({ title, priority = 2, tag = 'life', date = this.selectedDate }) {
    const t = { id: uid(), title: title.trim(), date, priority, tag, done: false, rewarded: false, createdAt: Date.now() }
    if (!t.title) return null
    this.state.tasks.push(t)
    this._finish([['taskAdded', t]])
    return t
  }
  // 本命：每天最多 3 件；已完成的不能改，過去日期的不能新選
  starsOn(date) {
    return this.tasksOn(date).filter((t) => t.star)
  }
  toggleStar(id) {
    const t = this._find('tasks', id)
    if (!t || t.done) return
    this._refreshToday()
    if (t.star) {
      t.star = false
      this._finish()
      return
    }
    if (t.date < this.today) return
    const n = this.starsOn(t.date).length
    if (n >= MAX_STARS) {
      this.emit('starFull', t)
      return
    }
    t.star = true
    if (t.date === this.today && n + 1 === MAX_STARS && new Date().getHours() < 12) this.day().plan = 1
    this._finish([['starPicked', t]])
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
      if (t.date < this.today) fx.push(['revive', t])
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
        if (t.priority === 3) d.high++
        if (h < 12) d.early++
        d.tagMask |= 1 << Math.max(0, TAGS.findIndex((x) => x.id === t.tag))
        if (t.routineId) d.routines++
        s.bestDayTasks = Math.max(s.bestDayTasks, d.tasks)
        this._touchStreak()
        let xp = PRIORITIES[t.priority]?.xp ?? 10
        if (t.star) {
          xp *= 2
          d.stars++
          s.starsDone++
        }
        // 今天已經開了很多花：之後的任務 XP 減半
        const tired = d.tasks > SOFT_CAP
        if (tired) xp = Math.ceil(xp / 2)
        if (d.tasks === SOFT_CAP + 1) fx.push(['tired', { count: d.tasks }])
        this._gain(xp, fx, { kind: t.star ? 'star' : 'task', id: t.id, tired })
        this._bloom(t, d, fx)
        if (t.star) {
          fx.push(['starDone', t])
          const stars = this.starsOn(this.today)
          if (t.date === this.today && !d.starAll && stars.length === MAX_STARS && stars.every((x) => x.done)) {
            d.starAll = true
            s.starDays++
            this._gain(XP.starAll, fx, { kind: 'starAll' })
            this._bondGain(BOND_POINTS.starAll, fx)
            fx.push(['starAll', stars])
          }
        }
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
  // 決定這個任務開出的花，記進圖鑑
  _bloom(t, d, fx) {
    const list = this.tasksOn(t.date)
    const c = {
      tag: t.tag, priority: t.priority, star: !!t.star, pomos: t.pomos || 0, routine: !!t.routineId,
      hour: new Date().getHours(), season: seasonKey(this.today), streak: this.streak,
      late: t.date < this.today ? daysBetween(t.date, this.today) : 0,
      perfect: t.date === this.today && !d.perfect && list.length >= 3 && list.every((x) => x.done),
    }
    t.flower = rollFlower(c, t.id)
    const f = flowerOf(t.flower)
    const e = this.state.dex[f.key]
    const isNew = !e
    if (e) e.n++
    else this.state.dex[f.key] = { at: this.today, n: 1 }
    const rare = f.rarity === 'rare' || f.rarity === 'legend'
    if (rare) d.rare++
    if (isNew || rare) fx.push(['flower', { flower: f, task: t, isNew }])
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
    // 在期限當天或之前落成：額外獎勵
    if (p.deadline && this.today <= p.deadline) {
      p.onTime = true
      this.stats.projectsOnTime++
      this._gain(XP.onTime, fx, { kind: 'onTime', id: p.id })
      fx.push(['projectOnTime', p])
    }
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
  completePomodoro(minutes, taskId = null) {
    this._refreshToday()
    const task = taskId ? this._find('tasks', taskId) : null
    if (task) task.pomos = (task.pomos || 0) + 1
    const fx = [['pomodoro', { minutes, task }]]
    this.stats.pomodoros++
    this.stats.focusMinutes += minutes
    const d = this.day()
    d.pomodoros++
    d.focus += minutes
    this._gain(XP.pomodoro, fx, { kind: 'focus' })
    this._bondGain(BOND_POINTS.pomodoro, fx)
    this._finish(fx)
  }
  pet() {
    this._refreshToday()
    this.stats.pets++
    this.day().pets++
    const b = this.state.player.bond
    if (b.petDay !== this.today) {
      b.petDay = this.today
      b.petN = 0
    }
    const fx = []
    if (b.petN < BOND_POINTS.petDailyMax) {
      b.petN++
      this._bondGain(BOND_POINTS.pet, fx)
    }
    if (fx.length) return this._finish(fx)
    // 摸摸不需要重繪面板（避免打斷正在輸入的欄位），除非剛好解鎖成就或達成每日任務
    const snap = this.statsSnapshot()
    const unlocked = ACHIEVEMENTS.some((a) => !this.state.player.achievements[a.id] && (snap[a.cond.stat] ?? 0) >= a.cond.gte)
    const quest = this.quests().some((q) => q.ready && !this._readyQuests.has(q.id))
    if (unlocked || quest) this._finish()
    else {
      this.save()
      this.emit('questProgress')
    }
  }
  claimQuest(qid) {
    this._refreshToday()
    const q = this.quests().find((x) => x.id === qid)
    if (!q || !q.ready || q.claimed) return
    this.state.quests[this.today].claimed[qid] = true
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
    this.replaceState(obj)
  }
  // 整份替換（匯入、同步拉回）：先完整清洗成功，才替換現有狀態
  replaceState(obj, updatedAt = this._nextVersion()) {
    if (!isObj(obj) || !Array.isArray(obj.tasks) || !isObj(obj.player)) throw new Error('不是有效的ひより存檔')
    const next = migrate(obj)
    next.updatedAt = updatedAt
    this.state = next
    this.today = dateStr()
    this._ensureRoutines(this.today)
    if (this.selectedDate !== this.today) this._ensureRoutines(this.selectedDate)
    this._ensureQuests()
    this.saveNow()
    this._readyQuests = new Set(this.quests().filter((q) => q.ready).map((q) => q.id))
    this._weeklyReady = this.weekly()?.ready
    this.emit('dirty')
    this.emit('change')
    this.emit('reload')
  }
  reset() {
    localStorage.removeItem(KEY)
    const version = this._nextVersion()
    this.state = seed()
    this.state.updatedAt = version
    this._readyQuests = new Set()
    this.saveNow()
    this.emit('dirty')
    this.emit('change')
    this.emit('reload')
  }
}

export function minToHHMM(m) {
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
