// 狀態管理 + 遊戲規則（經驗值、連續天數、成就、每日任務）。
// 所有變更都經過 action → _finish(fx)：先存檔、發出 'change' 讓 UI/場景同步，再依序發出特效事件。

import { ACHIEVEMENTS } from './data/achievements.js'
import { SHOP_ITEMS } from './data/shop.js'
import { COMMON_BY_TAG, flowerOf, rollFlower } from './data/flowers.js'
import { DAILY_QUESTS, QUEST_TIERS, WEEKLY_QUESTS, questOf, weeklyOf } from './data/quests.js'
import { BOND_POINTS, actLevel, bondLevel, outfitLevel, outfitOf } from './data/bond.js'
import { PRIORITIES, XP, levelFromXp, MAX_PROJECTS, TOWER_SLOTS, TAGS, WEEK_ZH, MOODS, MAX_STARS, SOFT_CAP, CHARM, FOCUS_MIN, BREAK_MIN, DATE_KINDS } from './theme.js'
import { DEFAULT_RHYTHM, PEAKS, optimizeDay, sleepMinutes } from './planner.js'
import { applies, bestClean, bestStreak, cleanDays, countOn, doneOn, QUIT_MILESTONES, streak as habitStreak, todayProgress } from './habits.js'
import { LIFE_KINDS } from './data/life.js'
import { THEMES } from './daylight.js'
import { BUILDINGS, MAX_STAGE, buildingStage, townOf, townChanges } from './data/town.js'
import { PLAN, inLot, lotsAt, townLevel, islandRadius } from './data/projectTown.js'

// 各建築現在的階段（只列 1 階以上），存成「已經慶祝過」的比對基準
const townStages = (stats) => {
  const out = {}
  for (const b of BUILDINGS) {
    const st = buildingStage(b, stats).stage
    if (st) out[b.key] = st
  }
  return out
}

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
// 同步用的版本識別：每次使用者改了資料就換一個。比對「是不是同一版」用它，不比時間大小（各台時鐘可能不準）
export const newRev = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
const REV_RE = /^[\w-]{1,40}$/

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
// focusMin：一輪專注幾分鐘（0 = 不設長度、往上數）；breakMin：休息幾分鐘；focusRounds：連續幾輪（1 = 一次做完）
export const DEFAULT_SETTINGS = {
  sound: true, remindLead: 10, notify: false, powerSave: true, theme: 'auto', quality: 'auto',
  focusMin: FOCUS_MIN, breakMin: BREAK_MIN, focusRounds: 1,
}
// 畫質：auto＝桌機高、觸控手機標準
export const QUALITIES = ['auto', 'high', 'standard']

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
  habitChecks: 0, urgesResisted: 0, lifeEntries: 0, sleepLogs: 0, plansApplied: 0,
})
// 每日紀錄。stars／high／early（中午前）／routines：完成數；tagMask：完成過的分類（位元）；
// plan：中午前選好 3 件本命；starAll：本命全清；review：寫了回顧；pets：摸摸次數；
// habits：習慣完成數；life：生活記錄筆數；urges：忍住的衝動；timebox：排好了時段；habitAll：今天的習慣全做完；
// focusAm／Pm／Eve／Late：專注分鐘落在早上（5–12 點）、下午（12–18）、晚上（18–24）、深夜（0–5）
const DAY_NUMS = [
  'tasks', 'events', 'milestones', 'pomodoros', 'focus', 'xp', 'stars', 'high', 'early', 'tagMask', 'routines', 'plan', 'review', 'pets', 'rare', 'habits', 'life', 'urges', 'timebox',
  'focusAm', 'focusPm', 'focusEve', 'focusLate',
]
const DAY_FLAGS = ['perfect', 'starAll', 'habitAll']
const emptyDay = () => {
  const d = {}
  for (const k of DAY_NUMS) d[k] = 0
  for (const k of DAY_FLAGS) d[k] = false
  return d
}

// もち和ふじ共同的好感度：pts 累計點數、outfit／outfitFuji 兩人各自的衣裝、visit 最近一次來訪、petDay/petN 今天摸了幾次（有上限）、gift 最近一次收到禮物
const emptyBond = () => ({ pts: 0, outfit: 'none', outfitFuji: 'none', visit: '', petDay: '', petN: 0, gift: '' })

const ms = (title, done = false) => ({ id: uid(), title, done, rewarded: done })

// 第一次打開時放的範例：讓空島一開始就有花、時之環和塔可以看。id 開頭是 ex-，之後可以一鍵清掉
const SAMPLE_TASKS = [['寫下今天最重要的三件事', 3, 'work'], ['讀 20 頁書', 2, 'study'], ['喝一杯溫水', 1, 'health'], ['整理桌面', 1, 'life'], ['記下一個新點子', 2, 'idea']]
const SAMPLE_EVENTS = [['晨間規劃', '09:00', '09:30', 0], ['深度工作時段', '10:00', '12:00', 2], ['午餐散步', '12:30', '13:30', 1], ['設計週會', '15:00', '16:00', 3], ['晚間閱讀', '21:00', '22:00', 4]]
const SAMPLE_PROJECTS = ['作品集網站改版', '認識ひより小島']
const sampleId = () => `ex-${uid()}`
// 存檔格式 2 起範例才有 ex- 記號。更舊的存檔載入時認一次：標題一樣、而且是開島那天放的，換成 ex- 開頭的 id
function markLegacySamples({ tasks, events, projects }, createdAt) {
  const born = dateStr(new Date(createdAt))
  const near = (t) => Math.abs((t || 0) - createdAt) < 60000
  const mark = (x) => (x.id = `ex-${x.id}`.slice(0, 40))
  for (const t of tasks) if (SAMPLE_TASKS.some(([title]) => title === t.title) && (t.date === born || near(t.createdAt))) mark(t)
  for (const e of events) if (e.date === born && SAMPLE_EVENTS.some(([title, start, end]) => title === e.title && start === e.start && end === e.end)) mark(e)
  for (const p of projects) if (SAMPLE_PROJECTS.includes(p.name) && near(p.createdAt)) mark(p)
}

// samples：要不要放範例（重置小島時不放）
function seed(samples = true) {
  const today = dateStr()
  const task = ([title, priority, tag]) => ({ id: sampleId(), title, date: today, priority, tag, done: false, rewarded: false, createdAt: Date.now() })
  const ev = ([title, start, end, color]) => ({ id: sampleId(), title, date: today, start, end, color, done: false, rewarded: false })
  return {
    version: 2,
    tasks: samples ? SAMPLE_TASKS.map(task) : [],
    events: samples ? SAMPLE_EVENTS.map(ev) : [],
    projects: !samples ? [] : [
      {
        id: sampleId(), name: SAMPLE_PROJECTS[0], color: 1, deadline: addDays(today, 14), slot: 0, createdAt: Date.now(),
        milestones: [ms('整理作品清單', true), ms('設計首頁版型', true), ms('撰寫案例文案'), ms('前端切版'), ms('上線發佈')],
        completedAt: null, archived: false,
      },
      {
        id: sampleId(), name: SAMPLE_PROJECTS[1], color: 0, deadline: addDays(today, 3), slot: 1, createdAt: Date.now(),
        milestones: [ms('完成第一個任務'), ms('加入一個日程'), ms('完成一次番茄鐘'), ms('摸摸もち')],
        completedAt: null, archived: false,
      },
    ],
    player: { xp: 0, coins: 0, streak: 0, lastActive: null, stats: emptyStats(), achievements: {}, unlocked: {}, freebies: {}, charms: 0, bond: emptyBond() },
    placed: [],
    routines: [],
    rhythm: cleanRhythm(),
    sleep: {},
    habits: [],
    life: {},
    town: { seen: {}, since: '', plevel: 0 },
    coach: emptyCoach(),
    dates: [],
    lotsPlan: 1,
    journal: {},
    dex: {},
    weekly: {},
    weekCard: '',
    history: {},
    quests: {},
    settings: { ...DEFAULT_SETTINGS },
    createdAt: Date.now(),
    updatedAt: 0,
    rev: '',
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

// ふじ的排程教練：自己加過的主攻項目、上次的回答（下次預設）、最近 10 次排程（撤銷用）
const emptyCoach = () => ({ items: [], last: null, plans: [] })
const COACH_DAYS = [3, 5, 7]
function cleanCoach(c) {
  if (!isObj(c)) return emptyCoach()
  const tags = new Set(TAGS.map((t) => t.id))
  const labels = (v) => (Array.isArray(v) ? v.map((x) => str(x, 16).trim()).filter(Boolean).slice(0, 12) : [])
  const items = (Array.isArray(c.items) ? c.items : [])
    .map((x) => (isObj(x) && str(x.label, 16).trim() ? { label: str(x.label, 16).trim(), tag: tags.has(x.tag) ? x.tag : 'study' } : null))
    .filter(Boolean)
    .slice(0, 12)
  const l = c.last
  const last = isObj(l)
    ? { focus: labels(l.focus), slots: labels(l.slots), days: COACH_DAYS.includes(l.days) ? l.days : 5, len: num(l.len, 15, 120, 50) }
    : null
  const plans = cleanList(c.plans, (p) => ({
    id: str(p.id), createdAt: ts(p.createdAt) || Date.now(), title: str(p.title, 40), from: ymd(p.from, ''), to: ymd(p.to, ''), count: num(p.count, 0, 99, 0),
  })).slice(-10)
  return { items, last, plans }
}
// 重要日子：考試、截止日、紀念日
function cleanDates(list) {
  return cleanList(list, (d) => {
    const title = str(d.title, 30).trim()
    if (!title || !DATE_RE.test(d.date)) return null
    return { id: str(d.id), title, date: d.date, kind: DATE_KINDS[d.kind] ? d.kind : 'exam', createdAt: ts(d.createdAt) || Date.now() }
  }).slice(-60)
}

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
      // 時段安排：預估分鐘數、排進時間軸的開始時間
      dur: t.dur ? num(t.dur, 5, 600, 30) : null,
      at: TIME_RE.test(t.at) ? t.at : null,
      // coach：ふじ排的（那次排程的 id，撤銷用）；moved：被往後挪了幾次（卡關提醒用）
      coach: ID_RE.test(t.coach) ? t.coach : null,
      moved: num(t.moved, 0, 99, 0),
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
      routineId: ID_RE.test(e.routineId) ? e.routineId : null, note: str(e.note, 200),
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
      milestones, completedAt: ts(p.completedAt), archived: !!p.archived, onTime: !!p.onTime,
      // 暫停的時間；null = 進行中（已落成的不會暫停）
      pausedAt: ts(p.completedAt) ? null : ts(p.pausedAt),
      // slot：專案町的第幾塊地，-1 = 還沒分到地（讀進來後馬上會補上）
      slot: num(p.slot, -1, TOWER_SLOTS - 1, 0),
    }
  })
  // 重新分配塔位：重複的換到空地，空地不夠就先不上島；進行中的專案超過上限的改為收藏
  const used = new Set()
  let active = 0
  for (const p of projects) {
    if (p.archived) continue
    if (++active > MAX_PROJECTS) {
      p.archived = true
      continue
    }
    if (p.slot < 0) continue
    if (used.has(p.slot)) {
      let free = 0
      while (used.has(free)) free++
      p.slot = free < TOWER_SLOTS ? free : -1
    }
    if (p.slot >= 0) used.add(p.slot)
  }

  if (s.lotsPlan !== 1) for (const p of projects) p.slot = -1

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
      pts: num(b.pts, 0, 1e7, 0), outfit: outfitOf(b.outfit) ? b.outfit : 'none', outfitFuji: outfitOf(b.outfitFuji) ? b.outfitFuji : 'none',
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
  settings.focusMin = settings.focusMin === 0 ? 0 : num(settings.focusMin, 5, 180, FOCUS_MIN)
  settings.breakMin = num(settings.breakMin, 1, 30, BREAK_MIN)
  settings.focusRounds = num(settings.focusRounds, 1, 4, 1)
  if (THEMES.includes(s.settings?.theme)) settings.theme = s.settings.theme
  if (QUALITIES.includes(s.settings?.quality)) settings.quality = s.settings.quality

  // 睡眠：{ 醒來那天: { bed, wake, q } }
  const sleep = {}
  if (isObj(s.sleep)) {
    for (const [d, v] of Object.entries(s.sleep)) {
      if (DATE_RE.test(d) && isObj(v) && TIME_RE.test(v.bed) && TIME_RE.test(v.wake)) sleep[d] = { bed: v.bed, wake: v.wake, q: num(v.q, 0, 5, 0) }
    }
  }
  const counts = (o) => {
    const out = {}
    if (isObj(o)) for (const [d, v] of Object.entries(o)) if (DATE_RE.test(d) && num(v, 0, 999, 0) > 0) out[d] = num(v, 0, 999, 0)
    return out
  }
  const habits = cleanList(s.habits, (h) => {
    const name = str(h.name, 30).trim()
    if (!name) return null
    const kind = h.kind === 'quit' ? 'quit' : 'build'
    const slips = (Array.isArray(h.slips) ? h.slips : [])
      .map((x) => (isObj(x) ? { at: ts(x.at), note: str(x.note, 80) } : { at: ts(x), note: '' }))
      .filter((x) => x.at)
      .sort((a, b) => a.at - b.at)
      .slice(-500)
    return {
      id: str(h.id), name, kind, icon: str(h.icon, 2) || (kind === 'quit' ? '禁' : '習'), color: num(h.color, 0, 99, 0),
      target: num(h.target, 1, 99, 1), unit: str(h.unit, 6).trim() || '次', days: weekdays(h.days),
      start: ymd(h.start, today), createdAt: ts(h.createdAt) || Date.now(), archived: !!h.archived,
      log: counts(h.log), urges: counts(h.urges), slips, ms: num(h.ms, 0, 9999, 0), paid: ymd(h.paid, ''),
    }
  })
  // 生活記錄：{ 日期: { items: [{ id, t, kind, text, amount }], energy } }
  const kinds = new Set(LIFE_KINDS.map((k) => k.key))
  const life = {}
  if (isObj(s.life)) {
    for (const [d, v] of Object.entries(s.life)) {
      if (!DATE_RE.test(d) || !isObj(v)) continue
      const items = cleanList(v.items, (x) => {
        const text = str(x.text, 120).trim()
        const amount = num(x.amount, 0, 1e7, 0)
        if (!text && !amount) return null
        return { id: str(x.id), t: TIME_RE.test(x.t) ? x.t : '12:00', kind: kinds.has(x.kind) ? x.kind : 'note', text, amount }
      }).sort((a, b) => toMin(a.t) - toMin(b.t))
      const energy = num(v.energy, 0, 5, 0)
      if (items.length || energy) life[d] = { items, energy }
    }
  }

  // ひより町：各建築已經慶祝到第幾階。舊存檔沒有這欄時照現在的統計安靜補上，只打一次招呼
  let town
  if (isObj(s.town)) {
    const seen = {}
    const raw = isObj(s.town.seen) ? s.town.seen : {}
    for (const b of BUILDINGS) {
      const v = num(raw[b.key], 0, MAX_STAGE, 0)
      if (v) seen[b.key] = v
    }
    town = { seen, since: ymd(s.town.since, ''), plevel: num(s.town.plevel, 0, 9, 0) }
  } else {
    town = { seen: townStages(stats), since: '', welcome: true, plevel: 0 }
  }
  const createdAt = ts(s.createdAt) || Date.now()
  if (!(s.version >= 2)) markLegacySamples({ tasks, events, projects }, createdAt)
  return {
    // lotsPlan：專案町的地塊編號版本。舊的塔位（散在島上的 16 個點）對不上新的地，全部先收回，讀進來後再依序排進去
    lotsPlan: 1,
    version: 2, tasks, events, projects, routines, placed, journal, dex, player, history, quests, weekly, weekCard: ymd(s.weekCard, ''), settings,
    rhythm: cleanRhythm(s.rhythm), sleep, habits, life, town, coach: cleanCoach(s.coach), dates: cleanDates(s.dates), createdAt, updatedAt: ts(s.updatedAt) || 0,
    // 舊存檔沒有 rev：用 updatedAt 當版本識別，跟舊的同步檔對得起來
    rev: typeof s.rev === 'string' && REV_RE.test(s.rev) ? s.rev : ts(s.updatedAt) ? String(ts(s.updatedAt)) : '',
  }
}

const weekdays = (v) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [])

// 作息設定：缺的欄位用預設值補上；work 為 null 表示沒有固定的工作時段
export function cleanRhythm(r) {
  const d = DEFAULT_RHYTHM
  const time = (v, dflt) => (TIME_RE.test(v) ? v : dflt)
  if (!isObj(r)) r = {}
  const meals = Array.isArray(r.meals)
    ? r.meals
        .filter(isObj)
        .slice(0, 6)
        .map((m) => ({ label: str(m.label, 12).trim() || '用餐', start: time(m.start, '12:00'), end: time(m.end, '13:00') }))
        .filter((m) => toMin(m.end) > toMin(m.start))
    : d.meals.map((m) => ({ ...m }))
  const w = r.work === undefined ? d.work : r.work
  const work = isObj(w) ? { start: time(w.start, d.work.start), end: time(w.end, d.work.end), days: weekdays(w.days) } : null
  if (work && toMin(work.end) <= toMin(work.start)) work.end = minToHHMM(Math.min(toMin(work.start) + 60, 1439))
  return {
    wake: time(r.wake, d.wake), sleep: time(r.sleep, d.sleep), meals, work,
    peak: PEAKS[r.peak] ? r.peak : d.peak, buffer: num(r.buffer, 0, 60, d.buffer),
    bedRemind: typeof r.bedRemind === 'boolean' ? r.bedRemind : d.bedRemind,
  }
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
    this._quitMilestones(this._pending)
    this._townWelcome()
    this.settleLots()
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
  // touch：這次存檔是否算「使用者改了資料」。同步靠 rev 判斷哪一邊改過，
  // 例行實例生成、跨日這類每台裝置各自推導的變化不算，避免剛打開的裝置蓋掉雲端的新資料
  save(touch = true) {
    if (touch) {
      this.state.updatedAt = this._nextVersion()
      this.state.rev = newRev()
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
  // 島上有塔的專案
  towerProjects() {
    return this.activeProjects().filter((p) => p.slot >= 0)
  }
  activeProjects() {
    return this.state.projects.filter((p) => !p.archived)
  }
  // 期限在兩天內（含今天）還沒落成的專案，最急的在前
  deadlineSoon() {
    return this.activeProjects()
      .filter((p) => p.deadline && !p.completedAt && !p.pausedAt && p.milestones.length)
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
  // ひより町：各建築階段、等級、稱號、已搬來的居民（全由累積統計推算）
  get town() {
    return townOf(this.stats)
  }
  statsSnapshot() {
    const found = Object.keys(this.state.dex)
    const town = this.town
    return {
      ...this.stats, level: this.level.level, streak: this.streak, bondLevel: this.bond.level,
      townRank: town.rank, residents: town.residents.length,
      flowersFound: found.length, legendFound: found.filter((k) => flowerOf(k)?.rarity === 'legend').length,
      bestHabit: Math.max(0, ...this.state.habits.filter((h) => h.kind === 'build').map((h) => bestStreak(h, this.today))),
      bestClean: Math.max(0, ...this.state.habits.filter((h) => h.kind === 'quit').map((h) => bestClean(h, this.today))),
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
      projects: this.activeProjects().filter((p) => !p.completedAt && !p.pausedAt).length,
      habits: todayProgress(this.state.habits, date).total,
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
  // 上週回顧卡：那一週（星期一 wk 開始）的總結
  weekSummary(wk = addDays(weekKey(this.today), -7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i))
    const w = this.weekStats(wk)
    let best = null
    let stars = 0
    for (const d of days) {
      const h = this.peekDay(d)
      stars += h.stars
      if (h.tasks && (!best || h.tasks > best.tasks)) best = { date: d, tasks: h.tasks }
    }
    const end = days[6]
    const flowers = Object.entries(this.state.dex)
      .filter(([, v]) => v.at >= wk && v.at <= end)
      .map(([k]) => flowerOf(k))
    const entry = this.state.weekly[wk]
    const challenge = entry && weeklyOf(entry.id)
    return {
      week: wk, end, days, ...w, stars, best, flowers,
      moods: days.map((d) => this.state.journal[d]?.mood || null),
      challenge: challenge ? { ...challenge, value: Math.min(challenge.goal, challenge.val(w)), claimed: entry.claimed } : null,
      tier: w.activeDays >= 5 || w.tasks >= 20 ? 'great' : w.activeDays >= 3 ? 'good' : 'gentle',
    }
  }
  // 週報：wk 那週（星期一開始）到 upto 為止（預設到週日或今天）的數字。完成率用那幾天的任務算
  weekReport(wk = weekKey(this.today), upto = null) {
    const last = addDays(wk, 6)
    const end = upto || (last < this.today ? last : this.today)
    const days = []
    for (let d = wk; d <= end; d = addDays(d, 1)) days.push(d)
    const set = new Set(days)
    const tasks = this.state.tasks.filter((t) => set.has(t.date))
    const r = { week: wk, end, days: days.length, total: tasks.length, done: 0, rate: 0, focus: 0, pomodoros: 0, stars: 0, starTotal: 0, active: 0, habitRate: null }
    for (const t of tasks) {
      if (t.done) r.done++
      if (t.star) r.starTotal++
    }
    r.rate = r.total ? r.done / r.total : 0
    for (const d of days) {
      const h = this.peekDay(d)
      r.focus += h.focus
      r.pomodoros += h.pomodoros
      r.stars += h.stars
      if (h.tasks || h.focus || h.habits) r.active++
    }
    // 習慣：那幾天該做的次數裡做到了幾次（今天還沒做的不算進去）
    let need = 0
    let got = 0
    for (const h of this.state.habits) {
      if (h.kind !== 'build' || h.archived) continue
      for (const d of days) {
        if (!applies(h, d) || (d === this.today && !doneOn(h, d))) continue
        need++
        if (doneOn(h, d)) got++
      }
    }
    if (need) r.habitRate = got / need
    r.moods = days.map((d) => this.state.journal[d]?.mood || null)
    return r
  }
  // 記憶圖鑑：往回 n 週（不含這週）有在用的週，新的在前
  weekAlbum(n = 12) {
    const cur = weekKey(this.today)
    const out = []
    for (let i = 1; i <= n; i++) {
      const r = this.weekReport(addDays(cur, -7 * i))
      if (r.total || r.focus || r.moods.some(Boolean)) out.push(r)
    }
    return out
  }
  // 有用過的日子（完成任務、專注或打卡）；週報要累積 3 天才出第一份
  usedDays() {
    return Object.values(this.state.history).filter((h) => h.tasks || h.focus || h.habits).length
  }
  // 這週一還沒看過上週的回顧卡、上週也有在用 → 要顯示
  weekCardDue() {
    const last = addDays(weekKey(this.today), -7)
    if (this.state.weekCard >= last) return false
    const s = this.weekSummary(last)
    return s.activeDays > 0 || s.focus > 0 || s.moods.some(Boolean)
  }
  seenWeekCard() {
    this.state.weekCard = addDays(weekKey(this.today), -7)
    this.save(false)
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
    this._townCheck(fx)
    this._projectTownCheck(fx)
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
  // 小鎮：建築長到比上次慶祝時更高的階段就發事件（一次長好幾階也只發一次），2 階起店長搬進來
  _townCheck(fx) {
    const t = this.state.town
    const now = townStages(this.stats)
    const { grew, movedIn } = townChanges(t.seen, now)
    if (!grew.length) return
    t.seen = { ...t.seen, ...now }
    if (!t.since) t.since = this.today
    for (const g of grew) fx.push(['townGrow', g])
    for (const m of movedIn) fx.push(['townMoveIn', m])
  }
  // 舊存檔第一次看到小鎮：照現在的統計直接蓋好，打一聲招呼（等介面接好再送）
  _townWelcome() {
    const t = this.state.town
    if (!t.welcome) return
    delete t.welcome
    const town = this.town
    if (town.rank) {
      t.since = this.today
      this._pending.push(['townWelcome', town])
    }
    this.save(false)
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
    this._quitMilestones(this._pending)
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
  // who：'mochi' 或 'fuji'，兩人各自換衣裝
  setOutfit(key, who = 'mochi') {
    const field = who === 'fuji' ? 'outfitFuji' : 'outfit'
    if (!this.outfitUnlocked(key) || this.state.player.bond[field] === key) return
    this.state.player.bond[field] = key
    this._finish([['outfit', { key, who }]])
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
  addTask({ title, priority = 2, tag = 'life', date = this.selectedDate, dur = null, at = null }) {
    const t = {
      id: uid(), title: title.trim(), date, priority, tag, done: false, rewarded: false, createdAt: Date.now(),
      dur: dur ? Math.max(5, Math.min(600, Math.round(dur))) : null, at: TIME_RE.test(at) ? at : null,
    }
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
  addEvent({ title, start, end, color = 0, date = this.selectedDate, note = '' }) {
    if (!title.trim()) return null
    if (toMin(end) <= toMin(start)) end = start === '23:30' ? '23:59' : minToHHMM(Math.min(toMin(start) + 60, 1439))
    const e = { id: uid(), title: title.trim(), date, start, end, color, done: false, rewarded: false, note: String(note || '').trim().slice(0, 200) }
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

  // ── 時段安排 ──
  // 把任務排進時間軸（at 為 null 就收回未排區）；dur 是預估分鐘數
  scheduleTask(id, at, dur) {
    const t = this._find('tasks', id)
    if (!t) return
    t.at = TIME_RE.test(at) ? at : null
    if (dur !== undefined) t.dur = dur ? Math.max(5, Math.min(600, Math.round(dur))) : null
    this._finish([['taskScheduled', t]])
  }
  // 排程要考慮的任務：那天的任務；看今天時再加上還沒完成的逾期任務
  planTasks(date = this.selectedDate) {
    const list = this.tasksOn(date)
    return date === this.today ? [...list, ...this.overdue()] : list
  }
  // 最佳化時程的預覽（不會改資料）
  planDay(date = this.selectedDate, { replan = false } = {}) {
    const n = new Date()
    return optimizeDay({
      tasks: this.planTasks(date), events: this.eventsOn(date), rhythm: this.state.rhythm, date, today: this.today,
      nowMin: date === this.today ? n.getHours() * 60 + n.getMinutes() : null, replan,
    })
  }
  // 套用排程：逾期任務會一起搬到這一天；left 是塞不下的件數
  applyPlan(date, plan, left = 0) {
    this._refreshToday()
    const fx = []
    let n = 0
    for (const p of plan) {
      const t = this._find('tasks', p.id)
      if (!t || t.done || !TIME_RE.test(p.at)) continue
      t.date = date
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
  }
  // 清空這天任務的時段（已完成的保留）
  clearPlan(date = this.selectedDate) {
    for (const t of this.tasksOn(date)) if (!t.done) t.at = null
    this._finish()
  }

  // ── 作息 ──
  setRhythm(patch) {
    this.state.rhythm = cleanRhythm({ ...this.state.rhythm, ...patch })
    this._finish([['rhythmChanged', this.state.rhythm]])
  }
  // 睡眠記在醒來那天
  logSleep(date, { bed, wake, q = 0 }) {
    this._refreshToday()
    if (!TIME_RE.test(bed) || !TIME_RE.test(wake) || date > this.today) return
    const first = !this.state.sleep[date]
    const entry = { bed, wake, q: num(q, 0, 5, 0) }
    this.state.sleep[date] = entry
    const fx = [['sleepLogged', { date, first, min: sleepMinutes(entry) }]]
    if (first) {
      this.stats.sleepLogs++
      if (date === this.today) this._gain(XP.sleep, fx, { kind: 'sleep' })
    }
    this._finish(fx)
  }
  deleteSleep(date) {
    delete this.state.sleep[date]
    this._finish()
  }

  // ── 習慣 ──
  habit(id) {
    return this.state.habits.find((h) => h.id === id)
  }
  activeHabits() {
    return this.state.habits.filter((h) => !h.archived)
  }
  addHabit({ name, kind = 'build', icon = '', color = 0, target = 1, unit = '次', days = [] }) {
    name = String(name || '').trim().slice(0, 30)
    if (!name) return null
    const h = {
      id: uid(), name, kind: kind === 'quit' ? 'quit' : 'build', icon: String(icon || '').slice(0, 2) || (kind === 'quit' ? '禁' : '習'),
      color: num(color, 0, 99, 0), target: num(target, 1, 99, 1), unit: String(unit || '次').trim().slice(0, 6) || '次', days: weekdays(days),
      start: this.today, createdAt: Date.now(), archived: false, log: {}, urges: {}, slips: [], ms: 0, paid: '',
    }
    this.state.habits.push(h)
    this._finish([['habitAdded', h]])
    return h
  }
  updateHabit(id, patch) {
    const h = this.habit(id)
    if (!h) return
    if (patch.name !== undefined) h.name = String(patch.name).trim().slice(0, 30) || h.name
    if (patch.icon !== undefined) h.icon = String(patch.icon).slice(0, 2) || h.icon
    if (patch.color !== undefined) h.color = num(patch.color, 0, 99, h.color)
    if (patch.target !== undefined) h.target = num(patch.target, 1, 99, h.target)
    if (patch.unit !== undefined) h.unit = String(patch.unit).trim().slice(0, 6) || h.unit
    if (patch.days !== undefined) h.days = weekdays(patch.days)
    if (patch.archived !== undefined) h.archived = !!patch.archived
    this._finish()
  }
  deleteHabit(id) {
    this.state.habits = this.state.habits.filter((h) => h.id !== id)
    this._finish()
  }
  // 養成：打卡（delta 可以是 -1 收回一次）。過去的日子也能補打卡，但只有今天第一次完成有獎勵
  checkHabit(id, date = this.today, delta = 1) {
    const h = this.habit(id)
    if (!h || h.kind !== 'build' || h.archived) return
    this._refreshToday()
    if (date > this.today) return
    if (date < h.start) {
      // 補開始日以前的卡（剛開始記、但其實已經做了幾天）：開始日往前移，最多 12 週
      if (delta <= 0 || daysBetween(date, this.today) > 84) return
      h.start = date
    }
    const before = doneOn(h, date)
    const n = Math.max(0, Math.min(99, countOn(h, date) + delta))
    if (n) h.log[date] = n
    else delete h.log[date]
    const fx = [['habitCheck', { habit: h, date, count: n, delta }]]
    // 獎勵只給今天該做的習慣；休息日多做也能記，但不算進完成與連續天數
    if (!before && doneOn(h, date) && date === this.today && h.paid !== this.today && applies(h, date)) {
      h.paid = this.today
      const d = this.day()
      d.habits++
      this.stats.habitChecks++
      this._touchStreak()
      this._gain(XP.habit, fx, { kind: 'habit', id: h.id })
      fx.push(['habitDone', { habit: h, streak: habitStreak(h, this.today) }])
      const prog = todayProgress(this.state.habits, this.today)
      if (prog.total >= 2 && prog.done === prog.total && !d.habitAll) {
        d.habitAll = true
        this._gain(XP.habitAll, fx, { kind: 'habitAll' })
        this._bondGain(BOND_POINTS.habitAll, fx)
        fx.push(['habitAll', prog])
      }
    }
    this._finish(fx)
  }
  // 戒除：忍住了一次（每個習慣每天前 3 次有獎勵）
  resistUrge(id) {
    const h = this.habit(id)
    if (!h || h.kind !== 'quit' || h.archived) return
    this._refreshToday()
    const n = (h.urges[this.today] || 0) + 1
    h.urges[this.today] = n
    this.stats.urgesResisted++
    this.day().urges++
    const fx = [['urgeResisted', { habit: h, count: n, days: cleanDays(h, this.today) }]]
    if (n <= 3) this._gain(XP.urge, fx, { kind: 'urge', id: h.id })
    this._finish(fx)
  }
  // 戒除：破戒了。沒有懲罰，只是重新起算
  slipHabit(id, note = '') {
    const h = this.habit(id)
    if (!h || h.kind !== 'quit' || h.archived) return
    this._refreshToday()
    const days = cleanDays(h, this.today)
    h.slips.push({ at: Date.now(), note: String(note || '').trim().slice(0, 80) })
    h.slips = h.slips.slice(-500)
    h.ms = 0
    this._finish([['habitSlip', { habit: h, days }]])
  }
  // 撤銷最後一次破戒（按錯時用）
  undoSlip(id) {
    const h = this.habit(id)
    if (!h || h.kind !== 'quit' || !h.slips.length) return
    h.slips.pop()
    // 已經領過的里程碑不再重發
    const days = cleanDays(h, this.today)
    h.ms = Math.max(h.ms, ...QUIT_MILESTONES.filter((m) => m <= days))
    this._finish()
  }
  // 戒除里程碑（1、3、7、14…天）：跨日時檢查，每段乾淨期每個里程碑只發一次
  _quitMilestones(fx) {
    for (const h of this.state.habits) {
      if (h.kind !== 'quit' || h.archived) continue
      const days = cleanDays(h, this.today)
      const m = Math.max(0, ...QUIT_MILESTONES.filter((x) => x <= days))
      if (m > h.ms) {
        h.ms = m
        this._gain(XP.quitMilestone, fx, { kind: 'quit', id: h.id })
        fx.push(['quitMilestone', { habit: h, days: m }])
      }
    }
  }
  habitsDueToday() {
    return this.activeHabits().filter((h) => h.kind === 'build' && applies(h, this.today))
  }

  // ── 生活記錄 ──
  lifeOn(date) {
    return this.state.life[date] || { items: [], energy: 0 }
  }
  addLife(date, { kind = 'note', text = '', amount = 0, t } = {}) {
    this._refreshToday()
    if (date > this.today) return null
    text = String(text || '').trim().slice(0, 120)
    amount = num(amount, 0, 1e7, 0)
    if (!text && !amount) return null
    const now = new Date()
    const item = {
      id: uid(), kind: LIFE_KINDS.some((k) => k.key === kind) ? kind : 'note', text, amount,
      t: TIME_RE.test(t) ? t : date === this.today ? minToHHMM(now.getHours() * 60 + now.getMinutes()) : '12:00',
    }
    const day = (this.state.life[date] ||= { items: [], energy: 0 })
    day.items.push(item)
    day.items.sort((a, b) => toMin(a.t) - toMin(b.t))
    this.stats.lifeEntries++
    const fx = [['lifeLogged', { date, item, count: day.items.length }]]
    if (date === this.today) {
      const d = this.day()
      d.life++
      if (d.life <= 3) this._gain(XP.life, fx, { kind: 'life' })
    }
    this._finish(fx)
    return item
  }
  updateLife(date, id, patch) {
    const item = this.lifeOn(date).items.find((x) => x.id === id)
    if (!item) return
    if (patch.text !== undefined) item.text = String(patch.text).trim().slice(0, 120)
    if (patch.amount !== undefined) item.amount = num(patch.amount, 0, 1e7, 0)
    if (patch.t !== undefined && TIME_RE.test(patch.t)) item.t = patch.t
    if (patch.kind !== undefined && LIFE_KINDS.some((k) => k.key === patch.kind)) item.kind = patch.kind
    if (!item.text && !item.amount) return this.deleteLife(date, id)
    this.state.life[date].items.sort((a, b) => toMin(a.t) - toMin(b.t))
    this._finish()
  }
  deleteLife(date, id) {
    const day = this.state.life[date]
    if (!day) return
    day.items = day.items.filter((x) => x.id !== id)
    if (!day.items.length && !day.energy) delete this.state.life[date]
    this._finish()
  }
  setEnergy(date, energy) {
    this._refreshToday()
    if (date > this.today) return
    const day = (this.state.life[date] ||= { items: [], energy: 0 })
    day.energy = num(energy, 0, 5, 0)
    if (!day.items.length && !day.energy) delete this.state.life[date]
    this._finish()
  }

  // ── 日曆：一天的摘要 ──
  daySummary(date) {
    const tasks = this.tasksOn(date)
    const events = this.eventsOn(date)
    const habits = this.state.habits.filter((h) => !h.archived && h.kind === 'build' && applies(h, date))
    const life = this.lifeOn(date)
    return {
      date, tasks, events,
      tasksDone: tasks.filter((t) => t.done).length,
      habits: { total: habits.length, done: habits.filter((h) => doneOn(h, date)).length },
      slips: this.state.habits.filter((h) => h.kind === 'quit' && h.slips.some((x) => dateStr(new Date(x.at)) === date)).length,
      mood: this.state.journal[date] || null,
      sleep: this.state.sleep[date] || null,
      life,
      spend: life.items.reduce((a, x) => a + (x.kind === 'spend' ? x.amount : 0), 0),
      focus: this.peekDay(date).focus,
    }
  }

  // ── 專案町 ──
  // 努力和需求取大的：沒收藏的專案每個都有一塊地，小鎮長到放得下為止，而且不會縮回去
  // { level, effort, points, lots, next }
  get projectTown() {
    return townLevel(this.stats, this.activeProjects().length, this.state.town.plevel)
  }
  // 地塊被商店擺設壓到了就先跳過（擺設搬走後就能用）
  _lotBlocked(i) {
    const lot = PLAN.lots[i]
    return this.state.placed.some((p) => inLot(lot, p.x, p.z, SHOP_ITEMS.find((s) => s.key === p.key)?.r ?? 0.42))
  }
  // 讀檔或同步拉回後（或地上的擺設搬走後）：排好地塊，記下目前的等級（之後長大才慶祝）
  settleLots() {
    const t = this.state.town
    t.plevel = this.projectTown.level
    const before = this.state.projects.map((p) => p.slot).join()
    const open = this.projectTown.lots
    for (const p of this.state.projects) if (p.slot >= open) p.slot = -1
    this._fillSlots()
    if (this.state.projects.map((p) => p.slot).join() !== before) this.save(false)
  }
  // 點數夠了、或專案多到地不夠時，城鎮升級；新開的地馬上分給還沒有地的專案
  // demand：這次是因為專案變多才長的；island：島也跟著變大
  _projectTownCheck(fx) {
    const t = this.state.town
    const town = this.projectTown
    // 還沒記過（剛重置成空島）就安靜記下，不慶祝
    if (!t.plevel) t.plevel = town.level
    if (town.level > t.plevel) {
      const from = t.plevel
      t.plevel = town.level
      fx.push(['projectTownGrew', {
        level: town.level, from, added: lotsAt(town.level) - lotsAt(from),
        demand: town.level > town.effort, island: islandRadius(town.level) > islandRadius(from),
      }])
    }
    this._fillSlots()
  }

  // ── 專案 ──
  // 已開放的地裡第一塊空的
  freeSlot() {
    const used = new Set(this.towerProjects().map((p) => p.slot))
    const open = this.projectTown.lots
    for (let i = 0; i < open; i++) if (!used.has(i) && !this._lotBlocked(i)) return i
    return -1
  }
  canAddProject() {
    return this.activeProjects().length < MAX_PROJECTS
  }
  // 專案狀態：active 進行中、paused 暫停、done 已落成（收藏另外看 archived）
  projectStatus(p) {
    return p.completedAt ? 'done' : p.pausedAt ? 'paused' : 'active'
  }
  // 暫停／繼續：暫停的專案沒有到期提醒，房子的旗子降下來；已落成的不用暫停
  pauseProject(id, paused = true) {
    const p = this._find('projects', id)
    if (!p || p.completedAt || !!p.pausedAt === paused) return
    p.pausedAt = paused ? Date.now() : null
    this._finish()
  }
  // 還沒有地的專案依序分到空地（進行中的優先、再來暫停的、已落成的最後，同狀態先建立的先）
  _fillSlots() {
    const rank = { active: 0, paused: 1, done: 2 }
    const waiting = this.activeProjects()
      .filter((p) => p.slot < 0)
      .sort((a, b) => rank[this.projectStatus(a)] - rank[this.projectStatus(b)] || a.createdAt - b.createdAt)
    for (const p of waiting) {
      const slot = this.freeSlot()
      if (slot < 0) break
      p.slot = slot
    }
  }
  // deadline 可以不設（空字串）：沒有截止日的專案就沒有到期提醒和準時落成獎勵
  // 開放的地用完了，城鎮會長到放得下（_finish 裡的 _projectTownCheck）
  addProject({ name, color = 0, deadline = '', milestones = [] }) {
    if (!this.canAddProject() || !name.trim()) return null
    const slot = this.freeSlot()
    const p = {
      id: uid(), name: name.trim(), color, deadline: DATE_RE.test(deadline) ? deadline : '', slot, createdAt: Date.now(),
      milestones: milestones.map((t) => t.trim()).filter(Boolean).map((t) => ms(t)),
      completedAt: null, pausedAt: null, archived: false,
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
  // 改截止日；空字串 = 不設截止日
  setDeadline(id, date) {
    const p = this._find('projects', id)
    const d = DATE_RE.test(date) ? date : ''
    if (!p || p.deadline === d) return
    p.deadline = d
    this._finish()
  }
  deleteProject(id) {
    this.state.projects = this.state.projects.filter((p) => p.id !== id)
    this._fillSlots()
    this._finish()
  }
  // 收藏：房子拆掉，地空出來。放回：重新分一塊地（不夠的話城鎮長大）
  archiveProject(id, archived = true) {
    const p = this._find('projects', id)
    if (!p) return false
    if (!archived && !this.canAddProject()) return false
    p.archived = archived
    p.slot = -1
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
    p.pausedAt = null
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

  // ── ふじ的排程教練 ──
  // 排程要避開的東西：這幾天的日程（未來的例行公事日程也算）、排了時段的任務
  coachContext(dates) {
    const set = new Set(dates)
    const n = new Date()
    const events = this.state.events.filter((e) => set.has(e.date))
    for (const date of dates) {
      if (date <= this.today) continue
      for (const r of this.state.routines) {
        if (r.kind === 'event' && r.startDate <= date && !r.made?.[date] && repeatMatches(r.repeat, date)) events.push({ id: 'r-' + r.id, date, start: r.start, end: r.end, done: false })
      }
    }
    return {
      today: this.today, nowMin: n.getHours() * 60 + n.getMinutes(), rhythm: this.state.rhythm,
      events, tasks: this.state.tasks.filter((t) => set.has(t.date) && t.at && !t.done),
    }
  }
  // 套用ふじ排的計畫：一次建好所有任務（有時段、有預估時間）。meta：{ title, answers（下次的預設）, custom（自己加的主攻項目） }
  applyCoachPlan(res, { title = '', answers = null, custom = [] } = {}) {
    this._refreshToday()
    const id = uid()
    const tags = new Set(TAGS.map((t) => t.id))
    const fx = []
    const dates = []
    for (const d of res?.days || []) {
      if (!DATE_RE.test(d.date) || d.date < this.today) continue
      for (const it of d.items || []) {
        const name = str(it.title, 80).trim()
        if (!name) continue
        const t = {
          id: uid(), title: name, date: d.date, priority: num(it.priority, 1, 3, 2), tag: tags.has(it.tag) ? it.tag : 'study', done: false, rewarded: false,
          createdAt: Date.now(), dur: num(it.dur, 5, 600, 30), at: TIME_RE.test(it.at) ? it.at : null, coach: id, moved: 0,
        }
        this.state.tasks.push(t)
        fx.push(['taskAdded', t])
        if (!dates.includes(d.date)) dates.push(d.date)
      }
    }
    if (!fx.length) return null
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
    fx.push(['coachApplied', { id, count: fx.filter(([k]) => k === 'taskAdded').length, days: dates.length }])
    this._finish(fx)
    return id
  }
  // 那次排程還沒完成、可以撤銷的任務數
  coachLeft(id) {
    return this.state.tasks.filter((t) => t.coach === id && !t.done).length
  }
  // 撤銷一次排程：刪掉還沒完成的那幾件，做完的留著
  undoCoachPlan(id) {
    const before = this.state.tasks.length
    this.state.tasks = this.state.tasks.filter((t) => t.coach !== id || t.done)
    const count = before - this.state.tasks.length
    this.state.coach.plans = this.state.coach.plans.filter((p) => p.id !== id)
    this._finish([['coachUndone', { id, count }]])
    return count
  }
  forgetFocus(label) {
    this.state.coach.items = this.state.coach.items.filter((x) => x.label !== label)
    this._finish()
  }

  // ── 重要日子 ──
  addDate({ title, date, kind = 'exam' }) {
    title = str(title, 30).trim()
    if (!title || !DATE_RE.test(date)) return null
    const d = { id: uid(), title, date, kind: DATE_KINDS[kind] ? kind : 'exam', createdAt: Date.now() }
    this.state.dates.push(d)
    this._finish([['dateAdded', { ...d, days: daysBetween(this.today, date) }]])
    return d
  }
  deleteDate(id) {
    this.state.dates = this.state.dates.filter((d) => d.id !== id)
    this._finish()
  }
  datesOn(date) {
    return this.state.dates.filter((d) => d.date === date)
  }
  // 接下來的重要日子，連同進行中專案的截止日；近的在前，days：還有幾天
  upcomingDates(limit = 8, horizon = 366) {
    const out = this.state.dates.filter((d) => d.date >= this.today).map((d) => ({ ...d, days: daysBetween(this.today, d.date) }))
    for (const p of this.state.projects) {
      if (!p.deadline || p.completedAt || p.archived || p.pausedAt || p.deadline < this.today) continue
      out.push({ id: p.id, title: p.name, date: p.deadline, kind: 'deadline', project: true, days: daysBetween(this.today, p.deadline) })
    }
    return out
      .filter((d) => d.days <= horizon)
      .sort((a, b) => a.date.localeCompare(b.date) || !!a.project - !!b.project)
      .slice(0, limit)
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
    // 這次專注落在哪個時段：用中間的時間點算
    const mid = new Date(Date.now() - minutes * 30000).getHours()
    d[mid < 5 ? 'focusLate' : mid < 12 ? 'focusAm' : mid < 18 ? 'focusPm' : 'focusEve'] += minutes
    // XP 依長度：25 分＝原本的份量，短的少一點、長的最多兩倍
    this._gain(Math.round(XP.pomodoro * Math.min(2, Math.max(0.4, minutes / 25))), fx, { kind: 'focus' })
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
  // 同步拉回時帶著雲端那一版的 updatedAt 和 rev；匯入、還原備份則算一次新的變更
  // soft：同步拉回的新資料（畫面就地更新，不重蓋小鎮、不移動鏡頭）
  replaceState(obj, updatedAt = this._nextVersion(), { soft = false, rev = newRev() } = {}) {
    if (!isObj(obj) || !Array.isArray(obj.tasks) || !isObj(obj.player)) throw new Error('不是有效的ひより存檔')
    const next = migrate(obj)
    next.updatedAt = updatedAt
    next.rev = rev
    // 匯入的舊檔沒有小鎮紀錄：照統計直接蓋好就好，不另外打招呼
    delete next.town.welcome
    this.state = next
    this.settleLots()
    this.today = dateStr()
    this._ensureRoutines(this.today)
    if (this.selectedDate !== this.today) this._ensureRoutines(this.selectedDate)
    this._ensureQuests()
    this.saveNow()
    this._readyQuests = new Set(this.quests().filter((q) => q.ready).map((q) => q.id))
    this._weeklyReady = this.weekly()?.ready
    this.emit('dirty')
    this.emit('change')
    this.emit('reload', { soft })
  }
  // ── 範例資料（id 開頭是 ex-） ──
  samples() {
    const mark = (x) => x.id.startsWith('ex-')
    const s = this.state
    return { tasks: s.tasks.filter(mark), events: s.events.filter(mark), projects: s.projects.filter(mark) }
  }
  sampleCount() {
    const x = this.samples()
    return x.tasks.length + x.events.length + x.projects.length
  }
  // 清掉範例，自己加的資料、經驗值和統計都不動
  clearSamples() {
    const x = this.samples()
    const drop = (list, gone) => list.filter((item) => !gone.includes(item))
    this.state.tasks = drop(this.state.tasks, x.tasks)
    this.state.events = drop(this.state.events, x.events)
    this.state.projects = drop(this.state.projects, x.projects)
    const n = x.tasks.length + x.events.length + x.projects.length
    if (n) this._finish()
    return n
  }

  // 重置：清空成一座空島（不放範例）
  reset() {
    localStorage.removeItem(KEY)
    const version = this._nextVersion()
    this.state = seed(false)
    this.state.updatedAt = version
    this.state.rev = newRev()
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
