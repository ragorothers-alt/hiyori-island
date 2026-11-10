import { BUILDINGS, buildingStage } from '../data/town.js'
import { FOCUS_MIN, BREAK_MIN } from '../theme.js'


// 各建築現在的階段（只列 1 階以上），存成「已經慶祝過」的比對基準
const townStages = (stats) => {
  const out = {}
  for (const b of BUILDINGS) {
    const st = buildingStage(b, stats).stage
    if (st) out[b.key] = st
  }
  return out
}
// 記住最近幾輪專注的 id（兩個分頁同一輪只記一次）
const POMO_SIDS = 20
// 存檔格式的版本。比這個新的資料是新版 App 寫的：這一版看不懂新的欄位，不能讀進來再用舊的格式寫回去
// （舊的 PWA 分頁還開著、另一個分頁已經更新了的時候會遇到）。加了新的欄位就往上加一：
// 3：訂閱（subscriptions、subRates）和警語（mottos）
// 4：專案裡的長期任務（task.ongoing）：舊版讀進來會把它當成排在建立那天的任務，隔天就變逾期
// 5：練習曲的速度（task.tempo）：舊版讀進來會把它拿掉
// 6：數字進度可以換單位（task.tempo.unit）、任務範本（templates）：5 版會把單位拿掉、把速度範圍外的數字洗掉。
//    從這一版開始，不認得的欄位讀進來原樣留著（keepExtra）：之後單純多一個欄位、舊版不看也不會出錯的，不必再往上加；
//    舊版照舊的意思去用會出錯的（像 4 的長期任務）才加
export const DATA_VERSION = 6
// 每個習慣記住最近幾天給過獎勵（日期倒退時不重領；再久以前的日子不會倒退回去）
const HABIT_PAID_DAYS = 120
export const newerData = (s) => !!s && typeof s === 'object' && Number(s.version) > DATA_VERSION
// 每天的回顧（今日反思）最多幾個字：總覽上可以多寫幾句
export const REVIEW_TEXT = 500
// 整天的日程（朋友來玩、旅行）：從 date 到 endDate（含），最多連續這麼多天
export const ALLDAY_MAX = 31

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
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)

// remindLead：日程開始前幾分鐘提醒（-1 = 不提醒）
// focusUp：正向計時（不設長度、往上數）；focusMin：倒數時一輪幾分鐘；breakMin：休息幾分鐘；focusRounds：連續幾輪（1 = 一次做完）
// fontScale：面板和對話框的字放大倍率；stuckNudge：任務卡住時ふじ提醒
// glass：App 模式 Liquid Glass 的透明度（0 清透～100 著色）
// mottoEvery：醒著的時候每隔幾分鐘提醒一句警語（0 = 不提醒）；mottoBar：面板上方輪流放一句
// focusCat：App 模式的專注頁上有一隻貓咪散步
export const DEFAULT_SETTINGS = {
  sound: true, remindLead: 10, notify: false, powerSave: true, theme: 'auto', quality: 'auto',
  focusUp: false, focusMin: FOCUS_MIN, breakMin: BREAK_MIN, focusRounds: 1, fontScale: 1, stuckNudge: true, glass: 50,
  mottoEvery: 60, mottoBar: true, focusCat: true,
}
export const FONT_SCALES = [0.9, 1, 1.12, 1.25]
// 畫質：auto＝桌機高、觸控手機標準
export const QUALITIES = ['auto', 'high', 'standard']

// 舊版固定的三個每日任務（舊存檔沿用）
const LEGACY_QUESTS = ['tasks3', 'focus2', 'step1']

export function minToHHMM(m) {
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export { HABIT_PAID_DAYS, townStages, POMO_SIDS, LEGACY_QUESTS, REV_RE }
