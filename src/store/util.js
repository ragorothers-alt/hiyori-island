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
// 7：每天的紀錄多了回神紀錄（history 的 nudges／backs／onTask）：6 版讀每天的紀錄時只留認得的欄位，存回去就整個洗掉。
//    從這一版開始，每天的紀錄裡不認得的欄位也原樣留著
export const DATA_VERSION = 7
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
// 第一次打開時放的範例（任務、日程、專案和它的進度、筆記）id 開頭是 ex-
export const isSampleId = (id) => typeof id === 'string' && id.startsWith('ex-')
export const uid = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7)
const REV_RE = /^[\w-]{1,40}$/

// ── 例行公事（重複任務／日程） ──
// monthly：每月幾號（rep.day，1–31）。那個月沒有那一天（31 號、2 月的 30 號）就在月底那天
export const REPEAT_TYPES = ['daily', 'weekdays', 'weekly', 'monthly']
export function repeatMatches(rep, date) {
  const p = parseDate(date)
  const d = p.getDay()
  if (rep.type === 'daily') return true
  if (rep.type === 'weekdays') return d >= 1 && d <= 5
  if (rep.type === 'monthly') return p.getDate() === Math.min(rep.day || 1, new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate())
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
// mottoEvery：醒著的時候每隔幾分鐘提醒一句警語（0 = 不提醒）；mottoBar：面板上方輪流放一句；
// mottoPause：警語的提醒先停到幾點（毫秒，0 = 沒停；跟著同步，在手機上按了電腦也一起停）；mottoPauseFrom：從幾點開始停
// （之前到點的照常算，例如手機已經通知過、從通知上按了先停的那一則）；
// mottoPauseCut：自己按了「現在就恢復」（停到的時間改成按下去的那一刻，停完不補那一則）
// focusCat：App 模式的專注頁上有一隻貓咪散步；brief：每天第一次打開時貓咪出來說今日摘要；
// awayNudge：專注中切去用別的 App 太久時，用通知叫你回來（Android 的 App 才有：分得出鎖著手機和切走）；
// tabNudge：桌機的網頁，專注中切到別的分頁太久時用通知叫你回來（預設關：工作本身就在別的分頁的人會被吵）；
// backNudge：離開 App 一陣子（20 分鐘以上）回來、沒在計時的時候，提示卡寫現在該做的那一件；
// nextNudge：沒在計時的時候勾掉了現在該做的那一件，提示卡寫下一件；
// mottoEvents：日程中（開會、上課這些排了時段的）先不提醒警語；
// focusNoise：專注時的背景聲（off／rain 雨聲／brown 褐噪音／pink 粉紅噪音，休息、暫停時不放）；noiseVol：背景聲的音量（5～100）
// flowMax：倒數到點時自動延長最多幾分鐘（theme.js 的 FLOW_MAXES；0 是到點就休息）；
// catMotto：專注中貓咪每隔幾分鐘念一句警語（theme.js 的 CAT_MOTTOS；0 是不念）
export const DEFAULT_SETTINGS = {
  sound: true, remindLead: 10, notify: false, powerSave: true, theme: 'auto', quality: 'auto',
  focusUp: false, focusMin: FOCUS_MIN, breakMin: BREAK_MIN, focusRounds: 1, fontScale: 1, stuckNudge: true, glass: 50,
  mottoEvery: 60, mottoPause: 0, mottoPauseFrom: 0, mottoPauseCut: false, mottoBar: true, focusCat: true, brief: true, awayNudge: true, tabNudge: false, backNudge: true, nextNudge: true,
  mottoEvents: true, focusNoise: 'off', noiseVol: 50, flowMax: 30, catMotto: 15, agentMode: 'auto',
  // 照週報洞察的建議調整過的那天（YYYY-MM-DD，沒有是空字串）：pull＝縮短一輪、motto＝拉長警語的間隔
  pullActed: '', mottoActed: '',
  // 每天的專注目標（分鐘，theme.js 的 FOCUS_GOALS；0 是不設）
  focusGoal: 0,
  // ふじ在 App 關著時的通知從哪一台送（那一台的代號，fujiNotes.js 的 deviceId）；'off' 是不送，'' 是還沒選（手機先送）
  fujiNotify: '',
  // 範例收起來時按過撤銷：之後不再自動收（設定裡的「清除範例資料」照常能清）
  keepSamples: false,
  // 四個總開關（設定的「通知與提醒」）：remindOn 時間到的提醒（日程、排了時段的任務、就寢、截止日、重要日子、習慣、訂閱）；
  // nudgeOn 建議和鼓勵（回來了、下一件、卡關、截止日的風險、晚上回顧、上週的回顧卡、今日摘要；底下各自的開關留著）；
  // chatOn 小島上的閒聊和招呼（打開時打招呼、偶爾閒聊；做完事情的那一句照常）
  remindOn: true, nudgeOn: true, chatOn: true,
  // 警語的總開關關掉時，記下原本的間隔、貓咪念的間隔、面板上方那一條（打開時放回去；-1／0 是沒記）
  mottoWasEvery: 0, mottoWasCat: -1, mottoWasBar: false,
}
export const FONT_SCALES = [0.9, 1, 1.12, 1.25]
export const NOISES = ['off', 'rain', 'brown', 'pink']
// 畫質：auto＝桌機高、觸控手機標準
export const QUALITIES = ['auto', 'high', 'standard']

// 舊版固定的三個每日任務（舊存檔沿用）
const LEGACY_QUESTS = ['tasks3', 'focus2', 'step1']

export function minToHHMM(m) {
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export { HABIT_PAID_DAYS, townStages, POMO_SIDS, LEGACY_QUESTS, REV_RE }
