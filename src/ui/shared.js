// ui.js 和它拆出去的那幾個檔案共用的小函式、常數（從 ui.js 搬過來）
import { parseDate, toMin } from '../store.js'
import { native, deskWeb } from '../native.js'
import { parseQuick, describeQuick } from '../parse.js'
import { LEVEL_TITLES } from '../data/lines.js'
import { $ } from './dom.js'
import { TITLE_MAX } from '../store/util.js'
import { LATEST } from '../data/latest.js'

export const TAB_ORDER = ['today', 'tasks', 'schedule', 'coach', 'habits', 'projects', 'records']
// 設定頁：不在分頁列上，算在「紀錄」底下（分頁列亮著紀錄、左右鍵從紀錄算）
export const PAGE_OF = { settings: 'records' }
export const PAGE_NAME = { settings: ['設定', 'せってい'] }
// 不常用的畫面（月曆、教練、專案詳情）：開場不載，第一次用到才下載。開完閒下來時也會先在背景載好（preloadViews），
// 之後離線也打得開。view 是載好的那個（還沒載好是 null）。
// root：頁面裡先放了「正在準備」閃著的底的那一格（教練）；沒下載到時換成可以再試一次（_use）
export function lazy(load, root = null) {
  let p = null
  const lz = {
    view: null,
    root,
    skel: root?.innerHTML ?? '',
    get: () =>
      (p ||= load().then(
        (v) => (lz.view = v),
        (err) => {
          p = null
          throw err
        },
      )),
  }
  return lz
}
// 手機直式時面板是下半部的抽屜；橫向手機高度太矮，改回側邊面板（和 styles.css 的媒體查詢同步）
export const SIDE_PHONE = '(max-width: 860px) and (max-height: 500px) and (orientation: landscape)'
export const sheetLayout = () => matchMedia('(max-width: 860px)').matches && !matchMedia(SIDE_PHONE).matches
export const THEME_INFO = {
  auto: '跟著真實時間，傍晚會自然變成夜晚',
  system: '跟著電腦或手機的深色模式',
  day: '一直是白天，島上維持明亮',
  night: '一直是夜晚，星星、燈籠和螢火蟲都會出來',
}
// 「這一版的新功能」看過到哪一版（這台裝置自己記）；卡關提醒：不再提醒的任務、今天ふじ說過了沒
export const NEWS_KEY = 'hiyori-news'
export const STUCK_OFF_KEY = 'hiyori-stuck-off'
// 手機上第一次看到有任務的任務頁：說一聲可以左右滑（這台裝置說過就不再說）
export const SWIPE_TIP_KEY = 'hiyori-swipe-tip'
// 今日摘要：這台裝置哪一天看過了（一天只自己出來一次）
export const BRIEF_KEY = 'hiyori-brief-day'
// 這台裝置上次有人在看 App 的時間（毫秒）：摘要的「你不在的時候」從這裡算起
export const SEEN_KEY = 'hiyori-seen-at'
export const STUCK_SAID_KEY = 'hiyori-stuck-said'
// 好久沒碰的長期任務：按了「過一週再提醒」的 { 任務 id: 到哪一天 }、ふじ今天說過了沒
export const IDLE_OFF_KEY = 'hiyori-idle-off'
export const IDLE_SAID_KEY = 'hiyori-idle-said'
export const IDLE_DAYS = 7
export const newsVersion = () => `${LATEST.id}:${LATEST.n}`
export const readLocal = (k, dflt) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? dflt
  } catch {
    return dflt
  }
}
export const writeLocal = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {}
}
// 鍵盤可以停的地方（看得到的）
export const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
export const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length)
// 疊在畫面的第幾層：body 底下的那一個（對話框、提示卡、專注頁…都是）的 z-index
export const layerZ = (el) => {
  while (el.parentElement && el.parentElement !== document.body) el = el.parentElement
  return parseInt(getComputedStyle(el).zIndex, 10) || 0
}
// 寫了時間的一行字（「明天 15:00 牙醫」）預設是日程；預覽上點一下可以改成「有時段的任務」（整天的、會重複的不行）
export const canSwap = (p, repeat = null) => p?.kind === 'event' && !p.allDay && !p.repeat && !repeat
// 長度照原本想要的（「23:00 到 1:00」兩小時、沒寫結束一小時；parseQuick 的 span），最多 10 小時
export const asTimedTask = (p) => ({ ...p, kind: 'task', at: p.start, dur: Math.max(5, Math.min(600, p.span ?? toMin(p.end) - toMin(p.start))), start: null, end: null })
// 預覽的小標籤：有時段的任務寫成「任務・15:00」；可以換的時候後面多一顆換的按鈕
export const quickChips = (p, today, asTask) => {
  const q = asTask ? asTimedTask(p) : p
  const chips = describeQuick(q, today)
  if (asTask) chips.unshift(`任務・${q.at}`)
  if ((p.title || '').length > TITLE_MAX) chips.push(`標題 ${p.title.length} 字：超過 ${TITLE_MAX} 字的放進備註`)
  return chips
}
export const swapBtn = (asTask) => `<button type="button" class="qp-swap" data-swap aria-pressed="${asTask}" title="${asTask ? '改回日程（有開始和結束的行程）' : '改成有時段的任務（會開花、可以專注、做完打勾）'}">${asTask ? '改回日程' : '改成任務'}</button>`
// 觸控為主的螢幕（手機、平板）：任務列只留完成和專注兩顆大按鈕，點任務打開編輯面板（styles.css 的 (pointer: coarse)）
export const touchUI = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
// 第一次打開時放的範例：任務、日程、專案上標一個「範例」（不算進提醒，記下自己的第一件就收起來）
export const SAMPLE_TAG = '<span class="ex-tag" title="第一次打開時放的範例：不會提醒你，記下自己的第一件就收起來">範例</span>'
// 介面：小島（預設）或 App 模式，每台裝置自己記（手機想當一般 App 用、電腦想看小島）
export const LAYOUT_KEY = 'hiyori-layout'
// 這台裝置上次選的是 App 模式（開機時決定要不要先載入小島）。還沒選過的：手機（Android 的 App、手機和平板的瀏覽器）
// 先用 App 模式（打開就能記事情，不用先下載整座島），電腦先看小島；小島在分頁列的「島」隨時切得過去
export const savedAppMode = () => readLocal(LAYOUT_KEY, native || !deskWeb() ? 'app' : 'island') === 'app'
// App 模式寬螢幕的側欄收成圖示窄欄（也是每台裝置自己記）
export const SIDE_KEY = 'hiyori-side-mini'
// 商店和花の図鑑的縮圖是用 three.js 拍的，載入前先放透明的圖（版面不會跳）
export const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
export const ISLAND_ICON = '<svg viewBox="0 0 24 24"><path d="M3 16.5c3 0 4.5-1.8 9-1.8s6 1.8 9 1.8"/><path d="M6.5 16.5l1.8 3.5h7.4l1.8-3.5"/><path d="M12 14.7V7"/><path d="M12 7c-2.4-1.6-5-1.2-6.5.6 2-.2 3.6.3 4.6 1.4M12 7c2.4-1.6 5-1.2 6.5.6-2-.2-3.6.3-4.6 1.4M12 7c-.8-1.6-2.3-2.6-4-2.8"/></svg>'
// 回饋：到 GitHub 開一則 issue，先填好版本和裝置大小（不帶任何個人資料）
export const FEEDBACK_URL = 'https://github.com/ragorothers-alt/hiyori-island/issues/new'
export const QUALITY_INFO = {
  auto: '電腦用高畫質，手機用標準，比較省電',
  high: '反鋸齒、白天也有柔光，畫面最細緻',
  standard: '關掉反鋸齒和白天柔光，手機不容易發燙',
}

export const levelTitle = (lv) => LEVEL_TITLES[Math.min(lv, LEVEL_TITLES.length) - 1] || LEVEL_TITLES[0]
export const hhmm = (ts) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)
// 分鐘 → 「45 分」「1.5 小時」
export const fmtHours = (m) => (m < 60 ? `${m} 分` : `${+(m / 60).toFixed(1)} 小時`)
// 「今天」「昨天」「3 天前」，再久就寫日期
export const relDay = (date, today) => {
  const d = daysBetween(date, today)
  return d <= 0 ? '今天' : d === 1 ? '昨天' : d < 7 ? `${d} 天前` : `${+date.slice(5, 7)}/${+date.slice(8)}`
}

