// 跟ふじ說一句話，App 裡什麼都能改（像 Notion AI 那樣）：任務以外的東西——日程、重要日子、專案和里程碑、細項、子任務、
// 習慣、例行公事、警語、訂閱、先記下來的事、生活記錄、睡眠、專案的進度和筆記、作息、設定。只在對話（run 是 chat）時用。
// 這裡是純函式：
//   worldOf(store, ids, here)：對話時多帶給 Claude 的資料（每一筆都有短代號，跟 agent.js 的任務、專案共用同一組 ids）
//   cleanOps(out, ids)：Claude 回的 set／create／done／drop／go 清成固定的樣子：代號換回真正的 id、值照欄位清好，看不懂的丟掉
// 真的動資料（和撤銷）在 store/agentOps.js；Worker 那邊的格式（FIELDS、CREATE_KINDS 要一樣）在 worker/src/ai.js。
import { addDays, daysBetween, parseDate, FONT_SCALES, NOISES } from './store/util.js'
import { TAGS, DATE_KINDS, FOCUS_GOALS, FLOW_MAXES, CAT_MOTTOS, AGENT_MODES, WEEK_ZH } from './theme.js'
import { MOTTO_EVERY } from './mottos.js'
import { PEAKS } from './planner.js'
import { LIFE_KINDS } from './data/life.js'
import { SUB_UNITS, CURRENCIES, nextCharge } from './subs.js'
import { countOn, streak as habitStreak, cleanDays } from './habits.js'

// 代號的第一個字 → 種類
export const KIND_OF = {
  t: 'task', e: 'event', d: 'date', p: 'project', m: 'milestone', s: 'step', u: 'subtask', h: 'habit', r: 'routine',
  w: 'motto', b: 'subscription', k: 'park', l: 'log', n: 'note', f: 'life',
}
// 設定裡ふじ能改的（要權限的通知、畫質這些不給她改）
export const SETTING_KEYS = [
  'focusMin', 'breakMin', 'focusRounds', 'focusUp', 'flowMax', 'catMotto', 'focusGoal', 'focusNoise', 'noiseVol', 'mottoEvery', 'mottoBar',
  'mottoEvents', 'sound', 'remindLead', 'theme', 'fontScale', 'stuckNudge', 'brief', 'backNudge', 'nextNudge', 'focusCat', 'agentMode',
]
export const RHYTHM_KEYS = ['wake', 'sleep', 'peak', 'buffer', 'work', 'meals']
// set、create 的 fields 能寫的欄位名稱（Worker 的格式不限定名稱，寫在提示詞裡；tests/ai.test.js 檢查每一個都有寫到）
export const FIELDS = [
  'title', 'date', 'at', 'dur', 'priority', 'tag', 'note', 'project', 'star', 'first', 'done', 'start', 'end', 'allDay', 'endDate', 'kind',
  'deadline', 'goal', 'status', 'due', 'target', 'unit', 'days', 'text', 'on', 'price', 'cur', 'every', 'amount',
  ...RHYTHM_KEYS, ...SETTING_KEYS,
]
// create 能建的（任務、日程、重要日子用 agent.js 的 add、events、dates）
export const CREATE_KINDS = ['project', 'milestone', 'step', 'habit', 'routine', 'motto', 'subscription', 'log', 'note', 'life', 'sleep']
// 能勾完成的、能刪掉的（任務的勾完成、刪除在 agent.js）
export const DONE_KINDS = ['event', 'milestone', 'step', 'subtask', 'habit']
export const DROP_KINDS = ['event', 'date', 'project', 'milestone', 'step', 'subtask', 'habit', 'routine', 'motto', 'subscription', 'park', 'log', 'note', 'life']
// go：做完之後打開的畫面
export const PAGES = ['today', 'tasks', 'schedule', 'habits', 'coach', 'projects', 'records', 'calendar', 'settings']
export const GO_KINDS = ['', 'focus', 'open']

const DATE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n) => String(n).padStart(2, '0')
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : [])
const txt = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, n) : '')
// 留著換行的長字（筆記內文、進度）
const body = (v, n) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, n) : '')

// ── 值的清法：看不懂就是 undefined（那一項不做）──
const okDate = (v) => {
  const s = txt(v, 10)
  if (!DATE.test(s)) return undefined
  const d = parseDate(s)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === s ? s : undefined
}
const dateOrNone = (v) => (txt(v, 10) === '' ? '' : okDate(v))
const time = (v) => {
  const m = /^(\d{1,2})[:：](\d{2})$/.exec(txt(v, 6))
  if (!m || +m[1] > 23 || +m[2] > 59) return undefined
  return `${pad(+m[1])}:${pad(+m[2])}`
}
const timeOrNone = (v) => (txt(v, 6) === '' ? null : time(v))
const ON = ['true', 'on', '1', 'yes', '是', '開', '打開', '要', '開啟']
const OFF = ['false', 'off', '0', 'no', '否', '關', '關掉', '不要', '關閉']
const bool = (v) => {
  // 照提示詞寫格式時（Worker 的備援）可能直接寫 true／false
  const s = typeof v === 'boolean' ? String(v) : txt(v, 8).toLowerCase()
  return ON.includes(s) ? true : OFF.includes(s) ? false : undefined
}
// 數字（允許「50 分」「1.5 小時」這種寫法；小時換成分鐘只在 hours 時）
const numOf = (v, { hours = false } = {}) => {
  const s = txt(v, 20)
  // 沒有數字的（「banana」「off」）不是 0，是看不懂
  if (!/\d/.test(s)) return undefined
  const n = Number(s.replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(n)) return undefined
  return hours && /小時|hr|h$/i.test(s) ? n * 60 : n
}
const int = (lo, hi, opts) => (v) => {
  const n = numOf(v, opts)
  return n === undefined ? undefined : Math.min(hi, Math.max(lo, Math.round(n)))
}
// 只能是那幾個值：取最接近的
const snap = (list, opts) => (v) => {
  const n = numOf(v, opts)
  return n === undefined ? undefined : list.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a))
}
const pick = (map) => (v) => {
  const s = txt(v, 20).toLowerCase()
  return Object.hasOwn(map, s) ? map[s] : undefined
}
const words = (list, extra = {}) => pick({ ...Object.fromEntries(list.map((x) => [String(x).toLowerCase(), x])), ...extra })
const str = (n, need = true) => (v) => {
  const s = txt(v, n)
  return s || !need ? s : undefined
}
const longStr = (n) => (v) => body(v, n)
const mins = (lo, hi) => (v) => {
  const n = numOf(v, { hours: true })
  return n === undefined ? undefined : Math.min(hi, Math.max(lo, Math.round(n / 5) * 5))
}
const DAY_WORDS = { 每天: [], 天天: [], 每日: [], 平日: [1, 2, 3, 4, 5], 工作日: [1, 2, 3, 4, 5], 週末: [0, 6], 假日: [0, 6], 周末: [0, 6] }
// 星期幾：「每天」「平日」「一三五」「週二、週四」「1,3,5」都可以（日＝0）。[] 是每天
export function daysOf(v) {
  const s = txt(v, 40)
  if (!s) return undefined
  if (Object.hasOwn(DAY_WORDS, s)) return DAY_WORDS[s]
  const out = new Set()
  for (const ch of s.replace(/週|周|星期|禮拜|、|,|，|\s/g, '')) {
    const i = '日一二三四五六'.indexOf(ch)
    if (i >= 0) out.add(i)
    else if (ch === '天') out.add(0)
    else if (/[0-7]/.test(ch)) out.add(+ch % 7)
    else return undefined
  }
  return out.size ? [...out].sort((a, b) => a - b) : undefined
}
const dayText = (days) => (!days?.length || days.length === 7 ? '每天' : days.join() === '1,2,3,4,5' ? '平日' : days.join() === '0,6' ? '週末' : days.map((d) => WEEK_ZH[d]).join(''))
const range = (v) => {
  const m = /(\d{1,2}[:：]\d{2})\s*[-~～到至]\s*(\d{1,2}[:：]\d{2})/.exec(txt(v, 40))
  if (!m) return null
  const a = time(m[1])
  const b = time(m[2])
  return a && b && a < b ? [a, b] : null
}
// 工作或上課的固定時段：「09:00-18:00 一二三四五」；""、「沒有」是不設
const work = (v) => {
  const s = txt(v, 60)
  if (!s || /^(無|沒有|不設|none|null)$/i.test(s)) return null
  const r = range(s)
  if (!r) return undefined
  const rest = s.replace(/\d{1,2}[:：]\d{2}\s*[-~～到至]\s*\d{1,2}[:：]\d{2}/, '').trim()
  const days = rest ? daysOf(rest) : [1, 2, 3, 4, 5]
  if (!days) return undefined
  return { start: r[0], end: r[1], days: days.length ? days : [0, 1, 2, 3, 4, 5, 6] }
}
// 三餐：「早餐 07:30-08:00、午餐 12:00-13:00」
const meals = (v) => {
  const s = txt(v, 200)
  if (!s) return []
  const out = []
  for (const part of s.split(/[、,，;；\n]/)) {
    const r = range(part)
    if (!r) continue
    const label = part.replace(/\d{1,2}[:：]\d{2}\s*[-~～到至]\s*\d{1,2}[:：]\d{2}/, '').trim().slice(0, 12) || '用餐'
    out.push({ label, start: r[0], end: r[1] })
  }
  return out.length ? out.slice(0, 6) : undefined
}
const TAG_IDS = TAGS.map((t) => t.id)
const tag = words(TAG_IDS, Object.fromEntries(TAGS.map((t) => [t.label, t.id])))
const priority = (v) => {
  const s = txt(v, 4)
  const n = { 高: 3, 中: 2, 低: 1 }[s] ?? Math.round(Number(s))
  return [1, 2, 3].includes(n) ? n : undefined
}
const money = (v) => {
  const n = numOf(v)
  return n === undefined || n < 0 ? undefined : Math.min(1e7, Math.round(n * 100) / 100)
}

// 每一種東西能改的欄位：值怎麼清（Claude 寫的一律是字串）
const TITLE = str(80)
export const SPEC = {
  task: {
    title: TITLE, date: okDate, at: timeOrNone, dur: (v) => (txt(v, 8) === '' || txt(v, 8) === '0' ? null : mins(5, 600)(v)), priority, tag,
    note: str(500, false), project: null, star: bool, first: bool, done: bool,
    // 截止日（跟打算哪天做分開）；"" 是不設
    due: dateOrNone,
  },
  event: { title: TITLE, date: okDate, start: time, end: time, note: str(200, false), allDay: bool, endDate: dateOrNone, done: bool },
  date: { title: str(30), date: okDate, kind: words(Object.keys(DATE_KINDS), { due: 'deadline', 考試: 'exam', 截止: 'deadline', 紀念: 'day', 紀念日: 'day' }) },
  project: {
    title: str(60), deadline: dateOrNone, goal: longStr(300),
    status: words(['active', 'paused', 'archived'], { 進行中: 'active', 暫停: 'paused', 收起來: 'archived', 封存: 'archived', 收藏: 'archived', resume: 'active' }),
  },
  milestone: { title: str(120), due: dateOrNone, note: longStr(500), done: bool },
  step: { title: TITLE, done: bool },
  subtask: { title: TITLE, done: bool },
  habit: { title: str(30), target: int(1, 99), unit: str(6), days: daysOf, status: words(['active', 'archived'], { 收起來: 'archived', 拿回來: 'active', 恢復: 'active' }) },
  motto: { text: str(60), on: bool },
  subscription: {
    title: str(40), price: money, cur: words(Object.keys(CURRENCIES), { 台幣: 'TWD', 新台幣: 'TWD', 美元: 'USD', 日圓: 'JPY', 日幣: 'JPY', 歐元: 'EUR', 港幣: 'HKD', 人民幣: 'CNY', 英鎊: 'GBP' }),
    every: int(1, 36), unit: words(Object.keys(SUB_UNITS), { 週: 'week', 月: 'month', 年: 'year', weekly: 'week', monthly: 'month', yearly: 'year' }), date: okDate,
    status: words(['active', 'cancelled'], { canceled: 'cancelled', 取消: 'cancelled', 訂閱: 'active', 恢復: 'active' }),
  },
  life: { text: str(120), amount: int(0, 1e7), kind: words(LIFE_KINDS.map((k) => k.key), Object.fromEntries(LIFE_KINDS.map((k) => [k.label, k.key]))), at: time },
  log: { text: longStr(1000), dur: int(0, 1440, { hours: true }) },
  note: { title: str(60, false), text: longStr(10000) },
  rhythm: {
    wake: time, sleep: time, buffer: int(0, 60),
    peak: words(Object.keys(PEAKS), { 上午: 'morning', 早上: 'morning', 下午: 'afternoon', 晚上: 'evening' }),
    work, meals,
  },
  settings: {
    focusMin: (v) => {
      const n = numOf(v, { hours: true })
      return n === undefined ? undefined : Math.min(90, Math.max(10, Math.round(n / 5) * 5))
    },
    breakMin: snap([5, 10, 15]), focusRounds: int(1, 4), focusUp: bool, flowMax: snap(FLOW_MAXES), catMotto: snap(CAT_MOTTOS),
    focusGoal: snap(FOCUS_GOALS, { hours: true }),
    focusNoise: words(NOISES, { 雨聲: 'rain', 下雨: 'rain', 褐噪音: 'brown', 粉紅噪音: 'pink', 關: 'off', none: 'off' }),
    // 跟音量滑桿一樣每 5 一格
    noiseVol: (v) => {
      const n = int(5, 100)(v)
      return n === undefined ? undefined : Math.round(n / 5) * 5
    },
    mottoEvery: snap(MOTTO_EVERY, { hours: true }), mottoBar: bool, mottoEvents: bool, sound: bool,
    remindLead: snap([-1, 0, 5, 10, 15, 30]),
    theme: words(['auto', 'system', 'day', 'night'], { 白天: 'day', 晝: 'day', 夜晚: 'night', 夜間: 'night', 深色: 'night', dark: 'night', light: 'day', 跟著時間: 'auto', 跟著系統: 'system' }),
    fontScale: (v) => pick({ 小: 0.9, 標準: 1, 普通: 1, 大: 1.12, 特大: 1.25 })(v) ?? snap(FONT_SCALES)(v),
    stuckNudge: bool, brief: bool, backNudge: bool, nextNudge: bool, focusCat: bool,
    agentMode: words(AGENT_MODES, { 自動: 'auto', 先問我: 'ask', 關: 'off' }),
  },
}
// 撤銷時要寫回去的值（撤銷紀錄跟著同步、匯入，不可信）：照那個欄位的清法清一次，要清出一樣的值才算合法
// 字（名稱、備註、內容）：只看型別和長度（使用者自己打的可以有換行、連續空白，清法會把它們收掉）
const FREE_TEXT = new Set(['title', 'note', 'goal', 'text'])
const isTime = (v) => typeof v === 'string' && time(v) === v
const isDays = (v) => Array.isArray(v) && v.length <= 7 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
// 一起變的那幾欄（store 改其中一欄時會順便改別欄）：撤銷時要嘛整組放回去、要嘛整組不動，讀檔時有一欄不合法也整組拿掉
//   日程的時段（改開始時間時結束跟著挪、改成整天時變成 00:00–23:59）、訂閱的狀態和計費（恢復時重算開始日、記下之前付過的）、
//   任務的完成（長期任務記在完成的那天、完成的時間、自動歸到的里程碑）
export const UNDO_GROUPS = {
  event: ['date', 'start', 'end', 'allDay', 'endDate'],
  subscription: ['status', 'date', 'end', 'paid0', 'trial'],
  task: ['done', 'date', 'doneAt', 'msAuto'],
}
const isId = (v) => typeof v === 'string' && /^[\w-]{1,40}$/.test(v)
export function okVal(kind, field, v) {
  if (kind === 'task' && (field === 'project' || field === 'msAuto')) return v === null || isId(v)
  // 任務完成的時間（取消完成再撤銷時放回去）
  if (kind === 'task' && field === 'doneAt') return v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0)
  if (v === null) return (kind === 'task' && (field === 'at' || field === 'dur' || field === 'due')) || (kind === 'rhythm' && field === 'work')
  // 任務的長度存得下 5～600 的任何整數（不一定是 5 的倍數）
  if (kind === 'task' && field === 'dur') return Number.isInteger(v) && v >= 5 && v <= 600
  if (kind === 'rhythm' && field === 'work') return isO(v) && isTime(v.start) && isTime(v.end) && v.start < v.end && isDays(v.days)
  if (kind === 'rhythm' && field === 'meals') return Array.isArray(v) && v.length <= 6 && v.every((m) => isO(m) && typeof m.label === 'string' && m.label.length <= 12 && isTime(m.start) && isTime(m.end) && m.start < m.end)
  // 訂閱取消、恢復時一起變的（只有撤銷會寫）
  if (kind === 'subscription' && field === 'end') return v === '' || okDate(v) === v
  if (kind === 'subscription' && field === 'paid0') return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9
  if (kind === 'subscription' && field === 'trial') return typeof v === 'boolean'
  // 只認自己的欄位（hasOwnProperty、toString 這種繼承來的名字不算）
  const spec = Object.hasOwn(SPEC, kind) && Object.hasOwn(SPEC[kind], field) ? SPEC[kind][field] : null
  if (!spec) return false
  if (field === 'days') return isDays(v)
  if (FREE_TEXT.has(field) || (kind === 'habit' && field === 'unit')) {
    if (typeof v !== 'string' || v.length > 10000) return false
    // 一定要有字的：名稱（筆記的標題可以空著）、警語
    return (field === 'title' && kind !== 'note') || (field === 'text' && kind === 'motto') || (field === 'unit' && kind === 'habit') ? !!v.trim() : true
  }
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return false
  return JSON.stringify(spec(String(v))) === JSON.stringify(v)
}
// 主要的字寫在 text 的（警語、進度、生活記錄）：寫成 title 也認
const TEXT_KINDS = new Set(['motto', 'log', 'life'])
// 新增時 fields 能寫的
const CREATE_FIELDS = {
  project: { goal: longStr(300) },
  milestone: { note: longStr(500) },
  step: {},
  habit: { kind: words(['build', 'quit'], { 養成: 'build', 戒除: 'quit', 戒掉: 'quit' }), target: int(1, 99), unit: str(6), days: daysOf },
  routine: { days: daysOf, tag, priority },
  motto: {},
  subscription: { price: money, cur: SPEC.subscription.cur, every: int(1, 36), unit: SPEC.subscription.unit },
  log: { dur: int(0, 1440, { hours: true }) },
  note: { text: longStr(10000) },
  life: { kind: SPEC.life.kind, amount: int(0, 1e7) },
  sleep: {},
}

// 代號 → { kind, id, pid, mid, tid, date }（設定、作息是固定的名字）
export function resolve(ids, alias) {
  const a = txt(alias, 16)
  if (a === 'settings' || a === 'rhythm') return { kind: a }
  const kind = KIND_OF[a[0]]
  const real = kind ? ids.real(a, a[0]) : null
  return real ? { kind, ...real } : null
}

// 是不是同一筆：種類、id 和上一層（專案、里程碑、任務、日子）都一樣（不同任務裡 id 一樣的子任務是兩筆）
const sameOne = (a, b) => ['kind', 'id', 'pid', 'mid', 'tid', 'date'].every((k) => (a[k] ?? null) === (b[k] ?? null))
// Claude 回的 → 清好的。refs：這一批 create 取的代號（後面的 parent、agent.js 的 add 用）
export function cleanOps(out, ids) {
  const o = out && typeof out === 'object' ? out : {}
  const ops = { set: [], create: [], done: [], drop: [], go: null }
  for (const x of arr(o.set, 80)) {
    const target = resolve(ids, x?.id)
    if (!target) continue
    const field = TEXT_KINDS.has(target.kind) && x.field === 'title' ? 'text' : x.field
    const spec = SPEC[target.kind]
    if (!spec || !Object.hasOwn(spec, field)) continue
    let value
    // 任務歸到哪個專案：專案的代號，"" 是移出專案
    if (target.kind === 'task' && field === 'project') value = txt(x.value, 16) === '' ? null : ids.real(txt(x.value, 16), 'p')?.id
    else value = spec[field](x.value)
    if (value === undefined) continue
    // 同一筆的同一個欄位只留最後一次
    const same = ops.set.findIndex((y) => sameOne(y, target) && y.field === field)
    if (same >= 0) ops.set.splice(same, 1)
    ops.set.push({ ...target, field, value })
  }
  const made = new Map()
  for (const x of arr(o.create, 30)) {
    const kind = CREATE_KINDS.includes(x?.kind) ? x.kind : null
    if (!kind) continue
    const c = { kind, ref: '', title: '', date: '', start: '', end: '', fields: {}, parent: null }
    c.title = kind === 'note' ? txt(x.title, 60) : kind === 'log' ? body(x.title, 1000) : txt(x.title, kind === 'motto' ? 60 : 120)
    c.date = okDate(x.date) || ''
    c.start = time(x.start) || ''
    c.end = time(x.end) || ''
    for (const f of arr(x.fields, 12)) {
      // 欄位名稱是 Claude 寫的字（Worker 的格式沒有限定），只認自己的欄位（不要被 'constructor' 這類繼承來的騙過）
      const clean = Object.hasOwn(CREATE_FIELDS[kind], f?.field) ? CREATE_FIELDS[kind][f.field] : null
      const v = clean ? clean(f.value) : undefined
      if (v !== undefined) c.fields[f.field] = v
    }
    // 上層：專案（里程碑、進度、筆記）或里程碑（細項）。可以是這一批前面剛建的（ref）
    const want = kind === 'step' ? 'milestone' : ['milestone', 'log', 'note'].includes(kind) ? 'project' : null
    if (want) {
      const par = txt(x.parent, 16)
      const real = resolve(ids, par)
      if (real?.kind === want) c.parent = real
      else if (made.get(par) === want) c.parent = { ref: par }
      else continue
    }
    if (kind === 'sleep' ? !(c.date && c.start && c.end) : !c.title) continue
    if (kind === 'subscription' && c.fields.price === undefined) continue
    const ref = txt(x.ref, 16)
    if (ref && !made.has(ref) && !resolve(ids, ref)) {
      c.ref = ref
      made.set(ref, kind)
    }
    ops.create.push(c)
  }
  for (const [key, kinds] of [['done', DONE_KINDS], ['drop', DROP_KINDS]]) {
    for (const a of arr(o[key], 40)) {
      const t = resolve(ids, a)
      if (t && kinds.includes(t.kind) && !ops[key].some((y) => sameOne(y, t))) ops[key].push(t)
    }
  }
  const g = o.go
  if (g && typeof g === 'object' && g.do === 'focus') {
    const t = ids.real(txt(g.id, 16), 't')
    if (t) ops.go = { do: 'focus', id: t.id }
  } else if (g && typeof g === 'object' && g.do === 'open') {
    const page = txt(g.id, 16)
    const t = PAGES.includes(page) ? null : resolve(ids, page)
    if (PAGES.includes(page)) ops.go = { do: 'open', page }
    else if (t && ['task', 'project', 'event', 'milestone'].includes(t.kind)) ops.go = { do: 'open', kind: t.kind, id: t.id, pid: t.pid || null }
  }
  return ops
}
// cleanOps 清出來的（或存起來又讀回來的）樣子對不對
const isO = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
export function saneOps(ops) {
  if (ops == null) return true
  if (!isO(ops)) return false
  const ref = (x) => isO(x) && typeof x.kind === 'string'
  return (
    ['set', 'create', 'done', 'drop'].every((k) => Array.isArray(ops[k]) && ops[k].every(ref)) &&
    ops.set.every((x) => typeof x.field === 'string') &&
    ops.create.every((x) => typeof x.title === 'string' && isO(x.fields)) &&
    (ops.go === null || isO(ops.go))
  )
}
export const hasOps = (ops) => !!ops && ['set', 'create', 'done', 'drop'].some((k) => ops[k]?.length)

// ── 對話時多帶的資料 ──
const repeatText = (rep) => (rep?.type === 'daily' ? '每天' : rep?.type === 'weekdays' ? '平日' : rep?.type === 'monthly' ? `每月 ${rep.day} 日` : `每週${(rep?.days || []).map((d) => WEEK_ZH[d]).join('')}`)
const statusOf = (p) => (p.archived ? 'archived' : p.completedAt ? 'done' : p.pausedAt ? 'paused' : 'active')
// here：{ page, date, project, task }（真正的 id）
export function worldOf(store, ids, here = null) {
  const s = store.state
  const today = store.today
  const W = {}
  const from = addDays(today, -3)
  const to = addDays(today, 45)
  W.events = s.events
    .filter((e) => (e.allDay ? (e.endDate || e.date) >= from && e.date <= to : e.date >= from && e.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .slice(0, 150)
    .map((e) => {
      const o = { id: ids.of('e', e.id), date: e.date, title: clip(e.title, 40) }
      if (e.allDay) {
        o.allDay = true
        if (e.endDate && e.endDate !== e.date) o.endDate = e.endDate
      } else Object.assign(o, { start: e.start, end: e.end })
      if (e.done) o.done = true
      if (e.routineId) o.routine = true
      if (e.note) o.note = clip(e.note, 40)
      return o
    })
  const brief = (t) => {
    const o = { id: ids.of('t', t.id), title: clip(t.title, 40), date: t.date }
    if (t.at) o.at = t.at
    if (t.project) o.project = ids.of('p', t.project)
    return o
  }
  const until = addDays(today, 7)
  W.later = s.tasks.filter((t) => !t.done && !t.ongoing && t.date >= until && t.date <= addDays(today, 90)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40).map(brief)
  W.ongoing = s.tasks.filter((t) => !t.done && t.ongoing).slice(0, 20).map(brief)
  W.doneRecent = s.tasks
    .filter((t) => t.done && t.date >= addDays(today, -7))
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
    .slice(0, 30)
    .map(brief)
  // 子任務：今天起 7 天、逾期的任務的子任務（勾、改名、刪用）
  const subs = []
  for (const t of s.tasks) {
    if (t.done || !t.subs?.length || (!t.ongoing && (t.date > until || t.date < addDays(today, -30)))) continue
    for (const x of t.subs) if (subs.length < 80) subs.push({ id: ids.of('u', x.id, { tid: t.id }), task: ids.of('t', t.id), title: clip(x.title, 30), done: !!x.done })
  }
  W.subtasks = subs
  W.projects = s.projects.slice(0, 40).map((p) => {
    const o = { id: ids.of('p', p.id), name: clip(p.name, 40), status: statusOf(p) }
    if (p.archived) return o
    if (p.deadline) o.deadline = p.deadline
    if (p.goal) o.goal = clip(p.goal, 80)
    o.milestones = p.milestones.slice(0, 30).map((m) => {
      const x = { id: ids.of('m', m.id, { pid: p.id }), title: clip(m.title, 40) }
      if (m.done) x.done = true
      if (m.due) x.due = m.due
      if (m.steps?.length && !m.done) x.steps = m.steps.slice(0, 15).map((st) => ({ id: ids.of('s', st.id, { pid: p.id, mid: m.id }), title: clip(st.title, 30), ...(st.done ? { done: true } : {}) }))
      return x
    })
    const logs = p.logs.slice(-3)
    if (logs.length) o.logs = logs.map((l) => ({ id: ids.of('l', l.id, { pid: p.id }), date: l.date, text: clip(l.text, 50), ...(l.mins ? { mins: l.mins } : {}) }))
    if (p.notes.length) o.notes = p.notes.slice(-10).map((n) => ({ id: ids.of('n', n.id, { pid: p.id }), title: clip(n.title || n.body, 30) }))
    return o
  })
  W.habits = s.habits
    .filter((h) => !h.archived)
    .slice(0, 30)
    .map((h) => {
      const o = { id: ids.of('h', h.id), title: clip(h.name, 20), kind: h.kind }
      if (h.kind === 'build') Object.assign(o, { target: h.target, unit: h.unit, days: dayText(h.days), today: countOn(h, today), streak: habitStreak(h, today) })
      else o.clean = cleanDays(h, today)
      return o
    })
  const archivedHabits = s.habits.filter((h) => h.archived).slice(0, 10)
  if (archivedHabits.length) W.archivedHabits = archivedHabits.map((h) => ({ id: ids.of('h', h.id), title: clip(h.name, 20) }))
  W.routines = s.routines.slice(0, 30).map((r) => {
    const o = { id: ids.of('r', r.id), kind: r.kind, title: clip(r.title, 30), repeat: repeatText(r.repeat) }
    if (r.kind === 'event') Object.assign(o, { start: r.start, end: r.end })
    else o.tag = r.tag
    return o
  })
  W.dates = s.dates
    .filter((d) => d.date >= addDays(today, -7))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 40)
    .map((d) => ({ id: ids.of('d', d.id), title: clip(d.title, 30), date: d.date, kind: d.kind, days: daysBetween(today, d.date) }))
  W.mottos = s.mottos.slice(0, 30).map((m) => ({ id: ids.of('w', m.id), text: clip(m.text, 60), ...(m.on ? {} : { on: false }) }))
  W.subscriptions = s.subscriptions.slice(0, 40).map((b) => {
    const o = { id: ids.of('b', b.id), title: clip(b.name, 30), price: b.price, cur: b.cur, every: b.every, unit: b.unit, status: b.status }
    const next = b.status === 'active' ? nextCharge(b, today) : null
    if (next) o.next = next
    if (b.status === 'cancelled' && b.end) o.end = b.end
    if (b.trial) o.trial = true
    return o
  })
  W.parked = s.parked.slice(-20).map((x) => ({ id: ids.of('k', x.id), text: clip(x.text, 60) }))
  W.life = []
  for (const date of [addDays(today, -1), today]) {
    for (const it of store.lifeOn(date).items.slice(-20)) W.life.push({ id: ids.of('f', it.id, { date }), date, at: it.t, kind: it.kind, text: clip(it.text, 40), ...(it.amount ? { amount: it.amount } : {}) })
  }
  const energy = store.lifeOn(today).energy
  if (energy) W.energy = energy
  W.sleep = Object.keys(s.sleep || {})
    .sort()
    .slice(-3)
    .map((date) => ({ date, bed: s.sleep[date].bed, wake: s.sleep[date].wake }))
  W.settings = Object.fromEntries(SETTING_KEYS.map((k) => [k, s.settings[k]]))
  W.history = []
  for (let i = 14; i >= 1; i--) {
    const date = addDays(today, -i)
    const list = store.tasksOn(date)
    W.history.push({ date, done: list.filter((t) => t.done).length, total: list.length, focus: store.peekDay(date).focus || 0 })
  }
  if (here && typeof here === 'object') {
    const h = { page: PAGES.includes(here.page) ? here.page : 'today' }
    if (DATE.test(here.date)) h.date = here.date
    if (here.project && s.projects.some((p) => p.id === here.project)) h.project = ids.of('p', here.project)
    if (here.task && s.tasks.some((t) => t.id === here.task)) h.task = ids.of('t', here.task)
    if (here.event && s.events.some((e) => e.id === here.event)) h.event = ids.of('e', here.event)
    W.here = h
  }
  return W
}

// ── 給人看的說法 ──
export const SETTING_LABEL = {
  focusMin: ['專注一輪', (v) => `${v} 分鐘`], breakMin: ['休息', (v) => `${v} 分鐘`], focusRounds: ['連續', (v) => (v > 1 ? `${v} 輪` : '一次做完')],
  focusUp: ['計時方式', (v) => (v ? '往上數' : '倒數')], flowMax: ['到點自動延長', (v) => (v ? `最多 ${v} 分` : '關')],
  catMotto: ['貓咪念警語', (v) => (v ? `每 ${v} 分鐘` : '關')], focusGoal: ['每天的專注目標', (v) => (v ? `${v >= 60 ? `${+(v / 60).toFixed(1)} 小時` : `${v} 分`}` : '不設')],
  focusNoise: ['背景聲', (v) => ({ off: '關', rain: '雨聲', brown: '褐噪音', pink: '粉紅噪音' })[v] || v], noiseVol: ['背景聲音量', (v) => `${v}`],
  mottoEvery: ['警語提醒', (v) => (v ? `每 ${v >= 60 ? `${v / 60} 小時` : `${v} 分鐘`}` : '關')], mottoBar: ['面板上方的警語', (v) => (v ? '開' : '關')],
  mottoEvents: ['日程中不提醒警語', (v) => (v ? '開' : '關')], sound: ['音效', (v) => (v ? '開' : '關')],
  remindLead: ['日程提醒', (v) => (v < 0 ? '不提醒' : v ? `提前 ${v} 分鐘` : '開始時')],
  theme: ['外觀', (v) => ({ auto: '跟著時間', system: '跟著系統', day: '白天', night: '夜晚' })[v] || v],
  fontScale: ['字的大小', (v) => ({ 0.9: '小', 1: '標準', 1.12: '大', 1.25: '特大' })[v] || `${v}`],
  stuckNudge: ['卡關提醒', (v) => (v ? '開' : '關')], brief: ['今日摘要', (v) => (v ? '開' : '關')], backNudge: ['回來時提醒現在該做的', (v) => (v ? '開' : '關')],
  nextNudge: ['做完提醒下一件', (v) => (v ? '開' : '關')], focusCat: ['專注頁的貓咪', (v) => (v ? '開' : '關')],
  agentMode: ['ふじ自己整理', (v) => ({ auto: '自動', ask: '先問我', off: '關' })[v] || v],
}
export const RHYTHM_LABEL = {
  wake: ['起床', (v) => v], sleep: ['就寢', (v) => v], peak: ['精神最好的時段', (v) => PEAKS[v]?.label || v], buffer: ['行程之間留', (v) => `${v} 分鐘`],
  work: ['固定的工作時段', (v) => (v ? `${v.start}-${v.end}（${dayText(v.days)}）` : '不設')],
  meals: ['三餐', (v) => (v.length ? v.map((m) => `${m.label} ${m.start}`).join('、') : '不設')],
}
const FIELD_WORD = {
  title: '名稱', date: '日期', start: '開始時間', end: '結束時間', note: '備註', allDay: '整天', endDate: '最後一天', kind: '種類', deadline: '截止日', goal: '目標',
  due: '期限', target: '每天的次數', unit: '單位', days: '星期', text: '內容', price: '金額', cur: '幣別', every: '週期', amount: '金額', dur: '時間', at: '時間',
}
// 「改成」後面接數字、英文時空一格（「改成 50 分鐘」「改成 16:00」），接中文時不空
const to = (v) => `改成${/^[\dA-Za-z]/.test(String(v)) ? ' ' : ''}${v}`
// fmtDate：日期怎麼寫（今天、明天、11/18（三））
export const fieldText = (kind, field, v, fmtDate = (d) => d) => {
  if (kind === 'settings') return SETTING_LABEL[field] ? `${SETTING_LABEL[field][0]}${to(SETTING_LABEL[field][1](v))}` : ''
  if (['date', 'due', 'deadline', 'endDate'].includes(field) && v) return `${FIELD_WORD[field]}${to(fmtDate(v))}`
  if (kind === 'rhythm') return RHYTHM_LABEL[field] ? `${RHYTHM_LABEL[field][0]}${to(RHYTHM_LABEL[field][1](v))}` : ''
  if (field === 'done') return v ? '勾完成' : '取消完成'
  if (field === 'first') return v ? '改成先做的那一件' : '不再是先做的那一件'
  if (field === 'on') return v ? '拿出來' : '先收著'
  if (field === 'status') return { active: kind === 'subscription' ? '恢復訂閱' : kind === 'habit' ? '拿回來' : '繼續進行', paused: '暫停', archived: '收起來', cancelled: '取消訂閱' }[v] || ''
  if (field === 'allDay') return v ? '改成整天' : '改成有時段'
  if (field === 'days') return to(dayText(v))
  const word = FIELD_WORD[field] || field
  if (v === '' || v == null) return `${word}清掉`
  if (field === 'note' || field === 'goal' || field === 'text') return `${word}改了`
  if (field === 'dur') return `時間${to(`${v} 分鐘`)}`
  if (field === 'price' || field === 'amount') return `${word}${to(v)}`
  if (field === 'unit' && kind === 'subscription') return `週期${to(`每${SUB_UNITS[v]?.per || v}`)}`
  if (field === 'kind' && kind === 'date') return to(DATE_KINDS[v]?.label || v)
  if (field === 'kind' && kind === 'life') return to(LIFE_KINDS.find((k) => k.key === v)?.label || v)
  return `${word}${to(clip(v, 20))}`
}
