import { addDays, ALLDAY_MAX, uid, dateStr, DATA_VERSION, DEFAULT_SETTINGS, parseDate, toMin, minToHHMM, REPEAT_TYPES, REVIEW_TEXT, LEGACY_QUESTS, FONT_SCALES, QUALITIES, HABIT_PAID_DAYS, townStages, newerData, POMO_SIDS, REV_RE } from './util.js'
import { TAGS, DATE_KINDS, TOWER_SLOTS, MAX_PROJECTS, CHARM, MOODS, FOCUS_MIN, BREAK_MIN } from '../theme.js'
import { PROJECT_LIMITS as PL, unitOf, bpmOf, lastTouched, taskMilestone } from '../projects.js'
import { CURRENCIES, SUB_UNITS, SUB_CATS, REMIND_DAYS, looksLikeCardNumber } from '../subs.js'
import { MOTTO_LEN, MOTTO_MAX, MOTTO_EVERY } from '../mottos.js'
import { flowerOf, COMMON_BY_TAG } from '../data/flowers.js'
import { outfitOf } from '../data/bond.js'
import { SHOP_ITEMS } from '../data/shop.js'
import { islandRadius } from '../data/projectTown.js'
import { questOf, weeklyOf } from '../data/quests.js'
import { THEMES } from '../daylight.js'
import { LIFE_KINDS } from '../data/life.js'
import { BUILDINGS, MAX_STAGE } from '../data/town.js'
import { DEFAULT_RHYTHM, PEAKS } from '../planner.js'

const allDayEnd = (end, date) => {
  const e = DATE_RE.test(end) && end > date ? end : date
  const last = addDays(date, ALLDAY_MAX - 1)
  return e > last ? last : e
}

const emptyStats = () => ({
  tasksDone: 0, highTasksDone: 0, eventsDone: 0, milestonesDone: 0, projectsDone: 0, projectsCreated: 0,
  pomodoros: 0, focusMinutes: 0, bestStreak: 0, perfectDays: 0, earlyTasks: 0, nightTasks: 0,
  questsClaimed: 0, pets: 0, bestDayTasks: 0, itemsBought: 0, reviews: 0,
  starsDone: 0, starDays: 0, weeklyClaimed: 0, charmsUsed: 0, projectsOnTime: 0,
  habitChecks: 0, urgesResisted: 0, lifeEntries: 0, sleepLogs: 0, plansApplied: 0, projectLogs: 0,
})
// 每日紀錄。stars／high／early（中午前）／routines：完成數；tagMask：完成過的分類（位元）；
// plan：中午前選好 3 件本命；starAll：本命全清；review：寫了回顧；pets：摸摸次數；
// habits：習慣完成數；life：生活記錄筆數；urges：忍住的衝動；timebox：排好了時段；habitAll：今天的習慣全做完；
// focusAm／Pm／Eve／Late：專注分鐘落在早上（5–12 點）、下午（12–18）、晚上（18–24）、深夜（0–5）；
// plogs：今天寫了進度的專案數（每個專案一天算一次）
const DAY_NUMS = [
  'tasks', 'events', 'milestones', 'pomodoros', 'focus', 'xp', 'stars', 'high', 'early', 'tagMask', 'routines', 'plan', 'review', 'pets', 'rare', 'habits', 'life', 'urges', 'timebox',
  'focusAm', 'focusPm', 'focusEve', 'focusLate', 'plogs',
]
// sleep：那天的睡眠已經給過獎勵
const DAY_FLAGS = ['perfect', 'starAll', 'habitAll', 'sleep']
const emptyDay = () => {
  const d = {}
  for (const k of DAY_NUMS) d[k] = 0
  for (const k of DAY_FLAGS) d[k] = false
  return d
}

// もち和ふじ共同的好感度：pts 累計點數、outfit／outfitFuji 兩人各自的衣裝、visit 最近一次來訪、petDay/petN 今天摸了幾次（有上限）、gift 最近一次收到禮物
const emptyBond = () => ({ pts: 0, outfit: 'none', outfitFuji: 'none', visit: '', petDay: '', petN: 0, gift: '' })

// 里程碑：note 備註、due 自己的期限、steps 細項（全部做完時里程碑跟著完成）
const ms = (title, done = false) => ({ id: uid(), title, done, rewarded: done, doneAt: done ? Date.now() : null, note: '', due: '', steps: [] })
// 專案的細節：goal 目標、logs 進度日誌、notes 筆記、focus 綁定任務的專注分鐘（{ 日期: 分鐘 }）、logDay 上次寫進度領經驗的日子
const projectDetails = () => ({ goal: '', logs: [], notes: [], focus: {}, logDay: '' })

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
  const task = ([title, priority, tag]) => blankTask({ id: sampleId(), title, date: today, priority, tag })
  const ev = ([title, start, end, color]) => ({ id: sampleId(), title, date: today, start, end, color, done: false, rewarded: false })
  // 範例專案也放一點目標、進度和筆記，打開就知道這裡可以記什麼
  const folio = [ms('整理作品清單', true), ms('設計首頁版型', true), ms('撰寫案例文案'), ms('前端切版'), ms('上線發佈')]
  folio[2].steps = [{ id: uid(), title: '挑三個代表作', done: true }, { id: uid(), title: '每個案例寫一段背景', done: false }, { id: uid(), title: '請朋友讀一遍', done: false }]
  const now = Date.now()
  return {
    version: DATA_VERSION,
    tasks: samples ? SAMPLE_TASKS.map(task) : [],
    events: samples ? SAMPLE_EVENTS.map(ev) : [],
    projects: !samples ? [] : [
      {
        id: sampleId(), name: SAMPLE_PROJECTS[0], color: 1, deadline: addDays(today, 14), slot: 0, createdAt: now,
        milestones: folio, completedAt: null, pausedAt: null, archived: false,
        ...projectDetails(),
        goal: '把作品集整理成能直接拿去投履歷的樣子',
        // 範例的進度和筆記 id 也是 ex- 開頭：使用者另外寫了自己的，這個專案就不算範例（清範例時不會被清掉）
        logs: [{ id: sampleId(), date: today, at: now, text: '首頁版型定案了，主色改成柔和的藍綠，留白多一點。', mins: 90, ms: folio[1].id }],
        notes: [{ id: sampleId(), title: '想放進去的東西', body: '## 案例\n- [x] 品牌識別\n- [ ] App 介面改版\n- [ ] 插畫練習\n\n參考：留白多、字少、一頁看得完。', pinned: true, createdAt: now, updatedAt: now }],
      },
      {
        id: sampleId(), name: SAMPLE_PROJECTS[1], color: 0, deadline: addDays(today, 3), slot: 1, createdAt: now,
        milestones: [ms('完成第一個任務'), ms('加入一個日程'), ms('完成一次番茄鐘'), ms('摸摸もち')],
        completedAt: null, pausedAt: null, archived: false, ...projectDetails(),
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
    subscriptions: [],
    mottos: [],
    templates: [],
    subRates: cleanRates(),
    // 最近記過的專注（番茄鐘每一輪的 id）：兩個分頁同一輪到點時只記一次
    pomoSids: [],
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
// 只認字串：正規式會把 ['2026-11-02'] 這種陣列轉成字串後當成合法，存進去之後一排序就壞掉
const strict = (re) => ({ test: (v) => typeof v === 'string' && re.test(v) })
// 日期還要是日曆上真的有的那一天：2026-02-30 這種格式對、日子不存在的，各處換算的結果會不一樣
// （有的進位成 3/2、有的變成 Invalid Date），那筆資料就永遠對不上任何一天
const DATE_RE = { test: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dateStr(parseDate(v)) === v }
const TIME_RE = strict(/^([01]\d|2[0-3]):[0-5]\d$/)
const ID_RE = strict(/^[\w-]{1,40}$/)
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
// 長期任務（專案裡慢慢推進、沒排在哪一天的事，例如一首練習曲）還沒完成時不屬於任何一天：
// 不出現在每天的任務、花圃和排程裡，也不會逾期；完成的那天才記在那天
export const floating = (t) => !!t?.ongoing && !t.done
const str = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v, min, max, dflt) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, Math.round(+v))) : dflt)
const ts = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null)
const ymd = (v, dflt) => (DATE_RE.test(v) ? v : dflt)
// 欄位清空了（不是打了看不懂的東西）
const blank = (v) => v == null || (typeof v === 'string' && !v.trim())

// update 類的動作只收認得的欄位，值照讀存檔時的規則清洗。完成狀態、經驗值、花這些只能透過各自的動作改
// （不然傳錯一個欄位就能跳過給經驗的邏輯，或把 id 改掉）
function cleanPatch(rec, patch, fields) {
  const out = {}
  if (!isObj(patch)) return out
  for (const [k, clean] of Object.entries(fields)) if (k in patch) out[k] = clean(patch[k], rec)
  return out
}
const TASK_PATCH = {
  title: (v, t) => str(v).trim() || t.title,
  date: (v, t) => ymd(v, t.date),
  priority: (v, t) => num(v, 1, 3, t.priority),
  tag: (v, t) => (TAGS.some((x) => x.id === v) ? v : t.tag),
  at: (v) => (TIME_RE.test(v) ? v : null),
  dur: (v, t) => (v ? num(v, 5, 600, t.dur || 30) : null),
  project: (v) => (ID_RE.test(v) ? v : null),
  ms: (v) => (ID_RE.test(v) ? v : null),
  note: (v) => str(v, PL.taskNote).trim(),
  ongoing: (v) => !!v,
}
const EVENT_PATCH = {
  title: (v, e) => str(v).trim() || e.title,
  date: (v, e) => ymd(v, e.date),
  start: (v, e) => (TIME_RE.test(v) ? v : e.start),
  end: (v, e) => (TIME_RE.test(v) ? v : e.end),
  color: (v, e) => num(v, 0, 99, e.color),
  note: (v) => str(v, 200),
  allDay: (v) => !!v,
  endDate: (v) => (DATE_RE.test(v) ? v : ''),
}
const PROJECT_PATCH = {
  name: (v, p) => str(v, 60).trim() || p.name,
  color: (v, p) => num(v, 0, 99, p.color),
}

// ふじ的排程教練：自己加過的主攻項目、上次的回答（下次預設）、最近 10 次排程（撤銷用）
const emptyCoach = () => ({ items: [], last: null, plans: [] })
const COACH_DAYS = [3, 5, 7]
function cleanCoach(c) {
  if (!isObj(c)) return emptyCoach()
  const tags = new Set(TAGS.map((t) => t.id))
  const labels = (v, max = 16, n = 12) => (Array.isArray(v) ? v.map((x) => str(x, max).trim()).filter(Boolean).slice(0, n) : [])
  const items = (Array.isArray(c.items) ? c.items : [])
    .map((x) => (isObj(x) && str(x.label, 16).trim() ? { label: str(x.label, 16).trim(), tag: tags.has(x.tag) ? x.tag : 'study' } : null))
    .filter(Boolean)
    .slice(0, 12)
  const l = c.last
  // 主攻項目可能是專案名稱（最長 60 字），要整個留著，下次問卷才認得出來
  const last = isObj(l)
    ? { focus: labels(l.focus, 60, 50), slots: labels(l.slots), days: COACH_DAYS.includes(l.days) ? l.days : 5, len: num(l.len, 15, 120, 50) }
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
  }).slice(-DATES_MAX)
}
// 重要日子的上限：只防異常大的匯入；新增時到了就不再加，讀檔不會刪掉合法的紀錄
export const DATES_MAX = 1000

// ── 訂閱服務（扣款日、月費怎麼算在 src/subs.js）──
// 上限只防異常大的匯入；新增時到了就不再加
export const SUBS_MAX = 300
const money = (v) => (v !== '' && v != null && Number.isFinite(+v) && +v >= 0 ? Math.min(1e7, Math.round(+v * 100) / 100) : null)
// 管理（取消）訂閱的網址：只收 http／https（訂閱表單也用這個先檢查）
export const httpUrl = (v) => {
  const s = str(v, 300).trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''
  } catch {
    return ''
  }
}
function cleanSub(x, today) {
  const name = str(x.name, 40).trim()
  const price = money(x.price)
  if (!name || price == null) return null
  const pay = str(x.pay, 20).trim()
  const status = x.status === 'cancelled' ? 'cancelled' : 'active'
  return {
    id: str(x.id), name, price, cur: CURRENCIES[x.cur] ? x.cur : 'TWD',
    every: num(x.every, 1, 36, 1), unit: SUB_UNITS[x.unit] ? x.unit : 'month',
    start: ymd(x.start, today), trial: !!x.trial, cat: SUB_CATS[x.cat] ? x.cat : 'other',
    remind: x.remind === -1 || REMIND_DAYS.includes(x.remind) ? x.remind : 1,
    // 付款方式只是個名字（信用卡、Apple ID）：看起來像卡號的不存
    pay: looksLikeCardNumber(pay) ? '' : pay, url: httpUrl(x.url), note: str(x.note, 200).trim(),
    status, end: status === 'cancelled' ? ymd(x.end, '') : '', paid0: money(x.paid0) || 0,
    createdAt: ts(x.createdAt) || Date.now(),
  }
}
// 訂閱不留不認得的欄位：付款的東西只存這裡列出來的（看起來像卡號的不存），匯入的檔案不能多帶別的進來
const cleanSubs = (list, today) => cleanList(list, (x) => cleanSub(x, today), false).slice(0, SUBS_MAX)
// ── 警語（輪播、提醒怎麼排在 src/mottos.js）──
const mottoText = (v) => str(v, MOTTO_LEN * 2).replace(/\s+/g, ' ').trim().slice(0, MOTTO_LEN)
function cleanMotto(x) {
  const text = mottoText(x.text)
  if (!text) return null
  return { id: str(x.id), text, on: x.on !== false, createdAt: ts(x.createdAt) || Date.now() }
}
const cleanMottos = (list) => cleanList(list, cleanMotto).slice(0, MOTTO_MAX)
// 外幣匯率（1 單位外幣大約多少新台幣）：沒設或不合理的用預設
function cleanRates(obj) {
  const out = {}
  for (const k of Object.keys(CURRENCIES)) {
    if (k === 'TWD') continue
    const v = isObj(obj) ? +obj[k] : NaN
    // 小數第 4 位以下會四捨五入成 0（畫面寫 0、算的時候卻用預設匯率）：太小的當成沒填
    out[k] = Number.isFinite(v) && v >= 0.0001 && v <= 10000 ? Math.round(v * 10000) / 10000 : CURRENCIES[k].rate
  }
  return out
}

// 不認得的欄位原樣留著：之後的版本多加一個欄位時，還沒更新的裝置（舊的 PWA 分頁、另一台）讀進來再存回去也不會把它洗掉，
// 所以單純「多一個欄位」不必再升 DATA_VERSION、叫每台裝置重新整理。只留能存成 JSON 而且不大的（擋匯入的檔案塞垃圾）；
// 這一版認得的欄位照常清洗，不受影響
const EXTRA_MAX = 256 * 1024
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
function keepExtra(raw, out) {
  if (!isObj(raw) || !isObj(out)) return out
  for (const k of Object.keys(raw)) {
    if (k in out || BAD_KEYS.has(k) || k.length > 40) continue
    const v = raw[k]
    if (v === undefined || typeof v === 'function') continue
    let size = 0
    try {
      size = JSON.stringify(v)?.length ?? Infinity
    } catch {
      size = Infinity
    }
    if (size <= EXTRA_MAX) out[k] = v
  }
  return out
}

// 每一筆紀錄不認得的欄位也留著（見 keepExtra）
function cleanList(list, fn, keep = true) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (!isObj(raw)) continue
    const item = fn(raw)
    if (!item) continue
    if (keep) keepExtra(raw, item)
    if (!ID_RE.test(item.id) || seen.has(item.id)) item.id = uid()
    seen.add(item.id)
    out.push(item)
  }
  return out
}

// 速度（練習曲的節拍器速度）：目標，和每天練到多快（一天一筆，舊的在前；同一天有好幾筆的留最後那筆），
// met 是說過「練到了」的那個目標。沒在記是 null；開了還沒填的是 { goal: null, log: [], met: null }
// unit：空字串＝節拍器速度，不然是自己取的單位（頁、公里…），數字的範圍跟著單位走
function cleanTempo(v) {
  if (!isObj(v)) return null
  const unit = unitOf(v.unit)
  const by = new Map()
  for (const e of Array.isArray(v.log) ? v.log : []) {
    const bpm = isObj(e) && DATE_RE.test(e.date) ? bpmOf(e.bpm, unit) : null
    if (bpm) by.set(e.date, keepExtra(e, { date: e.date, bpm, at: ts(e.at) || parseDate(e.date).getTime() + 12 * 3600e3 }))
  }
  const log = [...by.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-PL.tempoLog)
  return keepExtra(v, { unit, goal: bpmOf(v.goal, unit), log, met: bpmOf(v.met, unit) })
}
const newTempo = (unit = '') => ({ unit: unitOf(unit), goal: null, log: [], met: null })

// 一件任務的所有欄位和預設值。新增任務的地方（自己加、例行公事、ふじ排的、拆成三小步、範例）都從這裡出發，
// 讀存檔時（migrate）每個欄位也都要清洗到：加了新欄位只改這裡和 migrate，tests/store.test.js 會對兩邊的欄位是不是一樣
export const blankTask = (o = {}) => ({
  id: uid(), title: '', date: dateStr(), priority: 2, tag: 'life', done: false, rewarded: false, createdAt: Date.now(), doneAt: null,
  routineId: null, pomos: 0, star: false, flower: null, dur: null, at: null, coach: null, moved: 0,
  project: null, ms: null, ongoing: false, msAuto: null, note: '', subs: [], tempo: null, touched: null,
  ...o,
})

// 任務範本：常用的一組設定（長期、分類、子任務、要不要記數字），新增任務時選了就照著建。例如「練習曲」
const TEMPLATES_MAX = 20
function cleanTemplates(list) {
  const tags = new Set(TAGS.map((t) => t.id))
  return cleanList(list, (x) => {
    const name = str(x.name, 20).trim()
    if (!name) return null
    return {
      id: str(x.id), name, tag: tags.has(x.tag) ? x.tag : 'work', ongoing: !!x.ongoing,
      subs: (Array.isArray(x.subs) ? x.subs : []).map((s) => str(s, PL.subTitle).trim()).filter(Boolean).slice(0, PL.subs),
      // tempo：null 不記數字；{ unit } 要記（空字串是節拍器速度）
      tempo: isObj(x.tempo) ? { unit: unitOf(x.tempo.unit) } : null,
      createdAt: ts(x.createdAt) || Date.now(),
    }
  }).slice(0, TEMPLATES_MAX)
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
      // project：歸在哪個專案；ms：自己選的里程碑，null＝自動（下面清完專案後，對不上的拿掉）
      project: ID_RE.test(t.project) ? t.project : null,
      ms: ID_RE.test(t.ms) ? t.ms : null,
      // ongoing：長期任務（只有歸在專案裡的可以是；下面清完專案後再檢查一次）
      ongoing: !!t.ongoing,
      // msAuto：沒自己選里程碑時，完成那一刻自動歸到的里程碑（之後里程碑取消又勾回來也不會換）
      msAuto: done && ID_RE.test(t.msAuto) ? t.msAuto : null,
      // 任務頁上的說明（要做到什麼程度、要注意的事）
      note: str(t.note, PL.taskNote),
      // 子任務：全部勾完時任務跟著完成（跟里程碑的細項一樣）
      subs: cleanList(t.subs, (x) => {
        const title = str(x.title, PL.subTitle).trim()
        return title ? { id: str(x.id), title, done: !!x.done } : null
      }).slice(0, PL.subs),
      // 數字進度（練習曲的速度、頁數…）：目標和每天做到多少
      tempo: cleanTempo(t.tempo),
      // touched：最後一次推進這件事的時間（勾子任務、寫紀錄、記數字、專注）；長期任務太久沒碰時提醒用
      touched: ts(t.touched),
    }
  })
  const taskIds = new Set(tasks.map((t) => t.id))
  const events = cleanList(s.events, (e) => {
    const title = str(e.title).trim()
    if (!title) return null
    const start = TIME_RE.test(e.start) ? e.start : '09:00'
    let end = TIME_RE.test(e.end) ? e.end : '10:00'
    if (toMin(end) <= toMin(start)) end = minToHHMM(Math.min(toMin(start) + 60, 1439))
    const done = !!e.done
    const date = ymd(e.date, today)
    // 整天的日程：沒有時段（開始、結束填成一整天，只是佔位），從 date 到 endDate
    const allDay = !!e.allDay && !ID_RE.test(e.routineId)
    return {
      id: str(e.id), title, date, start: allDay ? '00:00' : start, end: allDay ? '23:59' : end, color: num(e.color, 0, 99, 0), done, rewarded: !!e.rewarded || done,
      routineId: ID_RE.test(e.routineId) ? e.routineId : null, note: str(e.note, 200),
      allDay, endDate: allDay ? allDayEnd(e.endDate, date) : '',
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
      const steps = cleanList(m.steps, (x) => {
        const t = str(x.title, PL.stepTitle).trim()
        return t ? { id: str(x.id), title: t, done: !!x.done } : null
      }).slice(0, PL.steps)
      return { id: str(m.id), title, done, rewarded: !!m.rewarded || done, doneAt: done ? ts(m.doneAt) : null, note: str(m.note, PL.msNote), due: ymd(m.due, ''), steps }
    })
    const msIds = new Set(milestones.map((m) => m.id))
    // 進度日誌：日期舊的在前（同一天照寫下的時間）；只記了時間沒寫字也算一則。
    // task：在任務頁寫的（那件任務的紀錄）；任務不在了就只是專案的進度
    const logs = cleanList(p.logs, (l) => {
      const text = str(l.text, PL.logText).trim()
      const mins = num(l.mins, 0, PL.logMins, 0)
      if (!text && !mins) return null
      return { id: str(l.id), date: ymd(l.date, today), at: ts(l.at) || Date.now(), text, mins, ms: msIds.has(l.ms) ? l.ms : null, task: taskIds.has(l.task) ? l.task : null }
    })
      .sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)
      .slice(-PL.logs)
    // 筆記：空白的也留著（剛按「新筆記」還沒打字），介面關掉時會自己清掉
    const notes = cleanList(p.notes, (n) => {
      const createdAt = ts(n.createdAt) || Date.now()
      return { id: str(n.id), title: str(n.title, PL.noteTitle), body: str(n.body, PL.noteBody), pinned: !!n.pinned, createdAt, updatedAt: ts(n.updatedAt) || createdAt }
    }).slice(0, PL.notes)
    const focus = {}
    if (isObj(p.focus)) {
      for (const d of Object.keys(p.focus).filter((d) => DATE_RE.test(d)).sort().slice(-PL.focusDays)) {
        const v = num(p.focus[d], 0, 1440, 0)
        if (v) focus[d] = v
      }
    }
    const out = {
      id: str(p.id), name, color: num(p.color, 0, 99, 0), deadline: ymd(p.deadline, ''), createdAt: ts(p.createdAt) || Date.now(),
      milestones, completedAt: ts(p.completedAt), archived: !!p.archived, onTime: !!p.onTime,
      // 暫停的時間；null = 進行中（已落成的不會暫停）
      pausedAt: ts(p.completedAt) ? null : ts(p.pausedAt),
      // slot：專案町的第幾塊地，-1 = 還沒分到地（讀進來後馬上會補上）
      slot: num(p.slot, -1, TOWER_SLOTS - 1, 0),
      goal: str(p.goal, PL.goal), logs, notes, focus, logDay: ymd(p.logDay, ''),
      // 範例專案被寫進自己的東西了（清範例時留著）
      mine: !!p.mine,
    }
    // 最後一次動到這個專案的時間（專案列表照這個排，最近的在前）；舊存檔從留下來的時間推回去
    out.editedAt = ts(p.editedAt) || lastTouched(out, tasks)
    return out
  })
  // 任務歸屬的專案已經不在了（被刪掉、或匯入的檔案對不上）：拿掉歸屬，任務照留；
  // 選的里程碑不在那個專案裡：改回自動
  const msOf = new Map(projects.map((p) => [p.id, new Set(p.milestones.map((m) => m.id))]))
  const projById = new Map(projects.map((p) => [p.id, p]))
  for (const t of tasks) {
    if (t.project && !msOf.has(t.project)) t.project = null
    if (t.ms && !msOf.get(t.project)?.has(t.ms)) t.ms = null
    if (t.msAuto && !msOf.get(t.project)?.has(t.msAuto)) t.msAuto = null
    // 以前做完、還沒記下自動歸屬的：照現在的里程碑補上，之後就固定在那裡
    if (t.done && t.project && !t.ms && !t.msAuto) t.msAuto = taskMilestone(projById.get(t.project), t)?.id || null
    // 長期任務只能待在專案裡：專案不在了就變回一般任務，還沒做完的排在今天（建立那天很久以前也不會一下子變逾期）
    if (t.ongoing && !t.project) {
      t.ongoing = false
      if (!t.done) t.date = today
    }
    // 還沒完成的長期任務不排在哪一天：沒有時段、不當本命
    if (floating(t)) {
      t.at = null
      t.star = false
    }
  }
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
  // 擺飾的位置：島是圓的（半徑 12，專案町擴建後更大），照離中心的距離收進這座島能擺的範圍（離岸邊 0.8）。
  // 原本各軸夾在 ±9：島緣合法擺的燈會被往內搬，島外的 (9, 9) 反而留著
  const placeR = islandRadius(isObj(s.town) ? num(s.town.plevel, 0, 9, 0) : 0) - 0.8
  const placed = cleanList(s.placed, (p) => {
    if (!shopKeys.has(p.key) || !Number.isFinite(+p.x) || !Number.isFinite(+p.z)) return null
    const d = Math.hypot(+p.x, +p.z)
    const k = d > placeR ? placeR / d : 1
    return { id: str(p.id), key: p.key, x: +p.x * k, z: +p.z * k, rot: Number.isFinite(+p.rot) ? +p.rot : 0, free: !!p.free }
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
      journal[d] = { mood: v.mood, text: str(v.text, REVIEW_TEXT), at: ts(v.at) || Date.now() }
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
  // 舊版用長度 0 代表往上數：換成正向計時，倒數的長度回到預設
  if (settings.focusMin === 0) settings.focusUp = true
  // 跟計時設定的刻度尺同一個範圍（10～90 分、每 5 分一格）：匯入的 120 分不會在第一次捲動刻度尺時被悄悄改掉
  settings.focusMin = Math.round(num(settings.focusMin || FOCUS_MIN, 10, 90, FOCUS_MIN) / 5) * 5
  settings.breakMin = num(settings.breakMin, 1, 30, BREAK_MIN)
  settings.focusRounds = num(settings.focusRounds, 1, 4, 1)
  if (!FONT_SCALES.includes(settings.fontScale)) settings.fontScale = 1
  settings.glass = num(settings.glass, 0, 100, DEFAULT_SETTINGS.glass)
  if (!MOTTO_EVERY.includes(settings.mottoEvery)) settings.mottoEvery = DEFAULT_SETTINGS.mottoEvery
  if (THEMES.includes(s.settings?.theme)) settings.theme = s.settings.theme
  if (QUALITIES.includes(s.settings?.quality)) settings.quality = s.settings.quality

  // 睡眠：{ 醒來那天: { bed, wake, q } }
  const sleep = {}
  if (isObj(s.sleep)) {
    for (const [d, v] of Object.entries(s.sleep)) {
      // 就寢＝起床的舊紀錄（會被算成睡了 24 小時）不留
      if (DATE_RE.test(d) && isObj(v) && TIME_RE.test(v.bed) && TIME_RE.test(v.wake) && v.bed !== v.wake) sleep[d] = { bed: v.bed, wake: v.wake, q: num(v.q, 0, 5, 0) }
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
      // 給過獎勵的日子（照日期記，系統日期倒退再走回來也不會重領）；舊存檔只有 paid 那一天
      paidDays: [...new Set([...(Array.isArray(h.paidDays) ? h.paidDays : []), h.paid].filter((d) => DATE_RE.test(d)))].sort().slice(-HABIT_PAID_DAYS),
      // 戒除里程碑給過經驗的最高天數（舊存檔沒有：當成這段乾淨期走到的都給過了）
      msPaid: num(h.msPaid, 0, 9999, num(h.ms, 0, 9999, 0)),
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
  const newer = newerData(s)
  const out = {
    // lotsPlan：專案町的地塊編號版本。舊的塔位（散在島上的 16 個點）對不上新的地，全部先收回，讀進來後再依序排進去
    lotsPlan: 1,
    version: newer ? Number(s.version) : DATA_VERSION, tasks, events, projects, routines, placed, journal, dex, player, history, quests, weekly, weekCard: ymd(s.weekCard, ''), settings,
    rhythm: cleanRhythm(s.rhythm), sleep, habits, life, town, coach: cleanCoach(s.coach), dates: cleanDates(s.dates), createdAt, updatedAt: ts(s.updatedAt) || 0,
    subscriptions: cleanSubs(s.subscriptions, today), subRates: cleanRates(s.subRates), mottos: cleanMottos(s.mottos),
    templates: cleanTemplates(s.templates),
    pomoSids: Array.isArray(s.pomoSids) ? s.pomoSids.filter((x) => ID_RE.test(x)).slice(-POMO_SIDS) : [],
    // 舊存檔沒有 rev：用 updatedAt 當版本識別，跟舊的同步檔對得起來
    rev: typeof s.rev === 'string' && REV_RE.test(s.rev) ? s.rev : ts(s.updatedAt) ? String(ts(s.updatedAt)) : '',
  }
  // 新版 App 寫的資料（只會在開機時讀到，而且讀到了就不再寫回去，見 newerApp）：
  // 看不懂的頂層欄位原樣留著、版本號也不往回改，萬一寫出去也不會把新版的欄位洗掉。
  // 版本一樣、只是多了不認得的頂層欄位（之後的版本加的）也留著，見 keepExtra
  return newer ? { ...Object.fromEntries(Object.entries(s).filter(([k]) => !BAD_KEYS.has(k))), ...out } : keepExtra(s, out)
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

export { TIME_RE, newTempo, isObj, cleanPatch, TASK_PATCH, DATE_RE, str, TEMPLATES_MAX, blank, num, weekdays, ms, projectDetails, PROJECT_PATCH, cleanSub, cleanRates, mottoText, migrate, seed, emptyDay, allDayEnd, EVENT_PATCH, ID_RE }
