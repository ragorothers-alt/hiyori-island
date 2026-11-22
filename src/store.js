// 狀態管理 + 遊戲規則（經驗值、連續天數、成就、每日任務）。
// 所有變更都經過 action → _finish(fx)：先存檔、發出 'change' 讓 UI/場景同步，再依序發出特效事件。
// store/migrate.js：範例資料、讀檔與匯入清洗；store/util.js：共用工具與常數。
// store/tasks.js、projects.js、habits.js、extras.js、coach.js：各領域的方法。
// 這裡保留 Store 核心與其餘區段，並轉出原本的公開名稱。

import { uid, isSampleId, parseDate, addDays, dateStr, newerData, toMin, daysBetween, townStages, REVIEW_TEXT, seasonKey, repeatMatches, REPEAT_TYPES, minToHHMM, POMO_SIDS, DEFAULT_SETTINGS, overnight, spanLen, OVERNIGHT_MAX } from './store/util.js'
import { WEEK_ZH, levelFromXp, XP, MOODS, CHARM, CAT_MOTTOS } from './theme.js'
import { MOTTO_EVERY } from './mottos.js'
import { isEvent, CHEERS } from './events.js'
import { migrate, seed, emptyDay, floating, blankTask, allDayEnd, cleanPatch, EVENT_PATCH, ID_RE, isObj, DATE_RE } from './store/migrate.js'
import { projectProgress, progressAll } from './projects.js'
import { bondLevel, BOND_POINTS, actLevel, outfitOf, outfitLevel } from './data/bond.js'
import { townOf, townChanges } from './data/town.js'
import { flowerOf, COMMON_BY_TAG } from './data/flowers.js'
import { bestStreak, bestClean, todayProgress, applies, doneOn } from './habits.js'
import { questOf, QUEST_TIERS, DAILY_QUESTS, weeklyOf, WEEKLY_QUESTS } from './data/quests.js'
import { SHOP_ITEMS } from './data/shop.js'
import { ACHIEVEMENTS } from './data/achievements.js'
import { tasksMethods } from './store/tasks.js'
import { projectsMethods } from './store/projects.js'
import { habitsMethods } from './store/habits.js'
import { extrasMethods } from './store/extras.js'
import { coachMethods } from './store/coach.js'
import { agentMethods } from './store/agent.js'
import { agentOpsMethods } from './store/agentOps.js'


const KEY = 'hiyori-daily-v1'
// 開場就壞掉時另存存檔原文用（src/errors.js）
export const SAVE_KEY = KEY
// 存檔的版本號另外存一份小的：寫之前先看一眼，就知道另一個分頁是不是剛寫過（不用每次讀整份）
const REV_KEY = 'hiyori-daily-rev'
// 每寫一次存檔換一個：同一版（自動記的回神紀錄不換 rev）另一個分頁剛寫過，也看得出來
const SEQ_KEY = 'hiyori-daily-seq'
const readSeq = () => {
  try {
    return localStorage.getItem(SEQ_KEY) || ''
  } catch {
    return ''
  }
}
const BACKUP_KEY = 'hiyori-backup'
// 外觀設定（settings.theme）另外記一份小的：index.html 開機時還沒載入程式、讀存檔之前，先照它決定載入畫面要不要用深色。
// 記成「存檔版本|外觀」：版本跟 REV_KEY 對得上才用（存檔沒寫進去、另一個分頁換了存檔、只有這個沒寫進去，都對不上，開機時改讀存檔）
export const LOOK_KEY = 'hiyori-look'
export const rememberLook = (theme) => {
  try {
    const v = `${localStorage.getItem(REV_KEY) || ''}|${theme}`
    if (localStorage.getItem(LOOK_KEY) !== v) localStorage.setItem(LOOK_KEY, v)
  } catch {}
}
// 讀不進來的存檔原文（壞掉了、或清洗時出錯）：另外留一份，不會被接下來的存檔蓋掉
export const RESCUE_KEY = 'hiyori-rescue'
export const NEWER_MSG = '這份資料是新版 App 存的，重新整理頁面更新到最新版再試一次'
export const NEWER_TAB_MSG = '另一個分頁已經是新版 App，這邊先不換資料：重新整理頁面之後再試一次'
export const NO_SAVE_MSG = '瀏覽器的儲存空間不夠，存不進去，所以先不換：現在的小島沒有動。請先清出一些空間再試一次'
// 到點自動延長時先留著的慶祝（store.quietly）：這個分頁重新整理也放得出來
const HELD_KEY = 'hiyori-held-cheers'
// 寫一次存檔超過這麼多毫秒，就改成停手後再寫（SAVE_WAIT）
const SLOW_SAVE = 8
const SAVE_WAIT = 400
// 例行公事「哪幾天生成過」記最近幾天（日期倒退回前一兩天時不會再生一次）
const MADE_KEEP = 3

// ── 被取代的資料：留最近 BACKUPS 份，新的在前（雲端、資料夾同步、兩個分頁同時改了資料、匯入和重置前都共用）──
// 只留一份的話，同步取代了一次、接著又匯入，第一次被取代的那份就不見了
const BACKUPS = 3
export function readBackups() {
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null')
    // 舊版只存一份（一個物件）
    return (Array.isArray(b) ? b : b ? [b] : []).filter((x) => x?.state)
  } catch {
    return []
  }
}
export const readBackup = (i = 0) => readBackups()[i] || null
// from：'local'（這台）、'file'、'cloud'、'tab'（另一個分頁）、'import'（匯入前）、'reset'（重置前）、'restore'（還原前）。
// 空間不夠時先少留幾份舊的；連這一份都存不進去才回傳 false
export function keepBackup(state, from, at) {
  let list = [{ from, at, savedAt: Date.now(), state }, ...readBackups()].slice(0, BACKUPS)
  for (; list.length; list = list.slice(0, -1)) {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(list))
      return true
    } catch {}
  }
  return false
}
const isQuota = (e) => /quota/i.test(`${e?.name} ${e?.message}`) || e?.code === 22 || e?.code === 1014
// 主存檔寫不進去（瀏覽器空間滿了）：從最舊的開始一份一份丟掉備份再試，被取代的舊資料不該把現在的小島擠掉。
// 丟光了還是寫不進去（主存檔本身就太大）就把備份放回去，不白白丟掉。keep：至少要留下的份數
function writeMain(json, keep = 0) {
  let raw = null
  try {
    raw = localStorage.getItem(BACKUP_KEY)
  } catch {}
  for (;;) {
    try {
      localStorage.setItem(KEY, json)
      return
    } catch (e) {
      const list = readBackups()
      if (!isQuota(e) || list.length <= keep) {
        try {
          if (raw !== null && localStorage.getItem(BACKUP_KEY) !== raw) localStorage.setItem(BACKUP_KEY, raw)
        } catch {}
        throw e
      }
      const rest = list.slice(0, -1)
      try {
        if (rest.length) localStorage.setItem(BACKUP_KEY, JSON.stringify(rest))
        else localStorage.removeItem(BACKUP_KEY)
      } catch {
        localStorage.removeItem(BACKUP_KEY)
      }
    }
  }
}
export function dropBackup(i = 0) {
  const list = readBackups()
  list.splice(i, 1)
  try {
    if (list.length) localStorage.setItem(BACKUP_KEY, JSON.stringify(list))
    else localStorage.removeItem(BACKUP_KEY)
  } catch {}
}
// 開場時讀不進來的原始存檔（_load 另外留的）：{ at, error, raw }，沒有就是 null
export function readRescue() {
  try {
    const v = JSON.parse(localStorage.getItem(RESCUE_KEY) || 'null')
    return v && typeof v.raw === 'string' ? { at: Number(v.at) || 0, error: String(v.error || ''), raw: v.raw } : null
  } catch {
    return null
  }
}
export function dropRescue() {
  try {
    localStorage.removeItem(RESCUE_KEY)
  } catch {}
}
// 例行公事某一天的實例：id 固定是「例行公事-日期」（id 最長 40 字，匯入的長 id 才退回隨機）
const instanceId = (r, date) => (r.id.length <= 29 ? `${r.id}-${date}` : uid())
// 同步用的版本識別：每次使用者改了資料就換一個。比對「是不是同一版」用它，不比時間大小（各台時鐘可能不準）
export const newRev = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
export const SEASON_ZH = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }

export function repeatLabel(rep) {
  if (rep.type === 'daily') return '每天'
  if (rep.type === 'weekdays') return '平日'
  if (rep.type === 'monthly') return `每月 ${rep.day} 日`
  return '每週' + [...rep.days].sort().map((d) => WEEK_ZH[d]).join('、')
}
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
// 回神紀錄的幾個數字（自動記的、只會往上加）：from 那邊比較大的抄到 to（換成另一版時用，見 replaceState）。
// from 可能是還沒清洗過的存檔（另一個分頁剛寫的）：日期、數字不對的不抄。回傳 to 有沒有哪個數字變大
const TALLIES = ['nudges', 'backs', 'onTask', 'leaves']
function keepTallies(from, to) {
  if (!isObj(from) || !isObj(to)) return false
  let raised = false
  for (const [date, h] of Object.entries(from)) {
    if (!DATE_RE.test(date) || !isObj(h)) continue
    for (const k of TALLIES) {
      const v = Math.min(1e7, Math.floor(h[k]))
      if (!(v > (to[date]?.[k] || 0))) continue
      ;(to[date] ||= emptyDay())[k] = v
      raised = true
    }
  }
  return raised
}
// 回神紀錄跟著哪一份資料（gen）：匯入、還原備份、重置換了一整份資料時換一個，
// 之後別的分頁、別台裝置拿到這一份時，舊的數字不會再被取比較大的加回來
const sameGen = (a, b) => (a?.tallyGen || '') === (b?.tallyGen || '')

export class Store {
  constructor() {
    this.handlers = {}
    // 匯入的行事曆抓回來的日程（唯讀，不存進小島的資料；src/calendars.js 放進來）
    this.external = []
    this.state = this._load()
    // 存檔裡現在是哪一版（這邊讀進來、寫出去或換成另一個分頁的那一版）；_seq：這邊最後讀到、寫出去的是哪一次存檔
    this._diskRev = this.state.rev || ''
    this._seq = readSeq()
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
    globalThis.addEventListener?.('storage', (e) => this._otherTabSaved(e))
    // 排隊中的存檔：切走或關掉前寫好
    globalThis.addEventListener?.('pagehide', () => this.flushSave())
    globalThis.document?.addEventListener('visibilitychange', () => document.hidden && this.flushSave())
  }

  // 同一個瀏覽器開著兩個分頁：另一邊存檔時，這邊換成那一版（跟同步拉回一樣就地更新）。
  // 不然這邊下一次存檔會拿舊資料把整份蓋掉，那邊剛加的東西就不見了
  _otherTabSaved(e) {
    if (e.key !== KEY) return
    // 這邊有還沒寫出去的變更（存檔失敗過）：不換，下次存檔時會先把那一版留成備份
    if ((this.state.rev || '') !== this._diskRev) return
    this._adoptDisk()
  }
  // 換成存檔裡現在那一版。讀的是「現在存著的」，不是事件帶來的舊內容（兩邊同時存時事件可能過時了）；
  // 只換記憶體裡的：不寫回去（不然兩個分頁會互相寫來寫去），也不算這邊改了資料
  _adoptDisk() {
    let obj
    try {
      obj = JSON.parse(localStorage.getItem(KEY) || 'null')
    } catch {
      return false
    }
    if (!obj?.rev) return false
    if (newerData(obj)) {
      this._newer()
      return false
    }
    const seq = readSeq()
    if (obj.rev === this.state.rev) {
      this._diskRev = obj.rev
      this._seq = seq
      // 同一版，但另一個分頁自動記了回神紀錄（不換 rev）：數字併過來，這邊之後存檔時才不會用舊的數字蓋掉
      if (sameGen(obj, this.state) && keepTallies(obj.history, this.state.history)) this.emit('change')
      return false
    }
    try {
      this._seq = seq
      this.replaceState(obj, obj.updatedAt, { soft: true, rev: obj.rev, peer: true })
      return true
    } catch (err) {
      console.warn('[hiyori] 讀取另一個分頁的存檔失敗', err)
      return false
    }
  }
  // 記回神紀錄之前：存檔裡另一個分頁剛記的先併進來（存檔事件還在路上、這個分頁剛從凍住醒來的時候）
  _diskTallies() {
    try {
      const obj = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (isObj(obj) && sameGen(obj, this.state)) keepTallies(obj.history, this.state.history)
    } catch {}
  }
  // 存檔是新版 App 寫的（另一個分頁已經更新了）：這邊不讀它、也不再寫，請使用者重新整理
  _newer() {
    if (this.newerApp) return
    this.newerApp = true
    this.emit('newerApp')
  }

  // ── 事件 ──
  // 事件名稱都在 events.js：拼錯的名字先在主控台說一聲（測試會擋下來，這裡是開發時的提醒）
  on(type, fn) {
    if (!isEvent(type)) console.warn(`[hiyori] 沒有這個事件：${type}`)
    ;(this.handlers[type] ||= []).push(fn)
    return () => (this.handlers[type] = this.handlers[type].filter((f) => f !== fn))
  }
  emit(type, payload) {
    if (!isEvent(type)) console.warn(`[hiyori] 沒有這個事件：${type}`)
    if (this._holding && CHEERS.has(type)) {
      this._heldList().push({ type, payload })
      return this._keepHeld()
    }
    for (const fn of this.handlers[type] || []) fn(payload)
  }
  // 先不慶祝：fn 裡冒出來的升級、成就、任務達成、經驗值這些先留著（資料照常記、畫面照常重畫、照常存檔），
  // 之後 releaseCheers 再照原本的順序放。到點自動延長時用：原定的那一段記下了，但你還在心流裡，不跳視窗、不響。
  // 留著的也記在這個分頁的 sessionStorage：延長中重新整理也放得出來（成就已經記成拿到了，不會再發一次）
  quietly(fn) {
    const was = this._holding
    this._holding = true
    try {
      return fn()
    } finally {
      this._holding = was
    }
  }
  _heldList() {
    if (!this._held) {
      try {
        const v = JSON.parse(sessionStorage.getItem(HELD_KEY) || '[]')
        this._held = Array.isArray(v) ? v.filter((x) => x && typeof x.type === 'string' && CHEERS.has(x.type)) : []
      } catch {
        this._held = []
      }
    }
    return this._held
  }
  _keepHeld() {
    try {
      if (this._held?.length) sessionStorage.setItem(HELD_KEY, JSON.stringify(this._held))
      else sessionStorage.removeItem(HELD_KEY)
    } catch {}
  }
  get heldCheers() {
    return this._heldList().length
  }
  releaseCheers() {
    const list = this._heldList()
    this._held = []
    this._keepHeld()
    for (const { type, payload } of list) this.emit(type, payload)
  }

  // ── 存取 ──
  _load() {
    let raw = null
    try {
      raw = localStorage.getItem(KEY)
      if (raw) {
        const obj = JSON.parse(raw)
        // 新版 App 存的（另一個分頁已經更新了，這邊還是舊的程式）：讀進來顯示，但不寫回去
        if (newerData(obj)) this.newerApp = true
        return migrate(obj)
      }
    } catch (e) {
      console.warn('[hiyori] 讀取存檔失敗，使用預設資料', e)
      // 原文另外留一份再換成範例島；留不下來（空間不夠）時，saveNow 在使用者自己改資料前不會蓋掉它。
      // 範例島的 rev 是空的：有開同步的話，同步會從雲端拉回來，不會把範例島推上去（sync.js）
      if (raw) {
        let rescued = false
        try {
          localStorage.setItem(RESCUE_KEY, JSON.stringify({ at: Date.now(), error: String(e?.message || e), raw }))
          rescued = true
        } catch {}
        this.loadFailed = { rescued }
      }
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
    // 同一個動作裡的幾次存檔併成一次，而且在這個動作結束前就寫好：另一個分頁的存檔事件插不進中間
    if (this._saveQueued) return
    this._saveQueued = true
    // 存檔已經大到寫一次會卡住畫面（用了好幾年）：連續的動作（一口氣勾好幾件）併成一次，停手後再寫。
    // 切走、關掉頁面和同步前一定先寫好（flushSave）；這段時間另一個分頁也存了的話，照兩邊都改了處理（那一版留成備份）
    if (this._slowSave) this._saveTimer = setTimeout(() => this.flushSave(), SAVE_WAIT)
    else queueMicrotask(() => this.flushSave())
  }
  // 還在排隊的存檔現在寫出去
  flushSave() {
    return this._saveQueued ? this.saveNow() : this.saved
  }
  // 版本號一定比上一版大：就算這台電腦的時鐘比別台慢，新的變更也不會被當成舊的
  _nextVersion() {
    return Math.max(Date.now(), (this.state.updatedAt || 0) + 1)
  }
  // 回傳有沒有寫進去。寫不進去（多半是瀏覽器空間滿了）時發一次 saveFailed，之後又寫得進去時發 saveRecovered
  saveNow() {
    this._saveQueued = false
    clearTimeout(this._saveTimer)
    // 存檔讀不進來、原文也沒能另外留下來：使用者自己改資料之前，不拿範例島蓋掉它
    if (this.loadFailed && !this.loadFailed.rescued && !this.state.rev) return false
    // 存檔是新版 App 寫的：用舊的格式寫回去會洗掉新的欄位。這之後改的都沒存（lostEdits：關掉、重新整理前要問一聲）
    if (this.newerApp) {
      if (this.state.rev !== this._diskRev && !this.lostEdits) {
        this.lostEdits = true
        this.emit('newerApp')
      }
      return false
    }
    // 這次存檔剛把另一個分頁的版本留成備份：空間不夠時也不丟它
    let keep = 0
    try {
      // 另一個分頁剛寫過、這邊還沒換成那一版（事件還在路上）
      const disk = localStorage.getItem(REV_KEY)
      if (disk && disk !== this._diskRev && disk !== this.state.rev) {
        // 這邊沒改過資料（只是例行實例、跨日這類各自推導的變化）：直接換成那一版
        if ((this.state.rev || '') === this._diskRev && this._adoptDisk()) return true
        // 兩邊都改了：那一版先留成備份（設定裡可以還原），不會被無聲蓋掉；備份存不進去就先不寫。
        // 存檔裡那份讀不懂（開場時就讀不進來、原文已經另外留了）：沒有可以備份的，照常寫
        let peer = null
        try {
          peer = JSON.parse(localStorage.getItem(KEY) || 'null')
        } catch {}
        if (newerData(peer)) {
          // 這邊改的那些沒存進去
          if ((this.state.rev || '') !== this._diskRev) this.lostEdits = true
          this._newer()
          return false
        }
        if (peer?.rev && !keepBackup(peer, 'tab', peer.updatedAt)) throw new Error('空間不夠，沒辦法先備份另一個分頁的版本')
        if (peer?.rev) keep = 1
        // 那一版留成備份，回神紀錄（自動記的數字）照樣取比較大的帶過來
        if (isObj(peer) && sameGen(peer, this.state)) keepTallies(peer.history, this.state.history)
      } else if (readSeq() !== this._seq) {
        // 同一版，但另一個分頁在這邊上次讀寫之後寫過（自動記的回神紀錄不換 rev）：那邊的數字先併進來，不會被這邊比較舊的蓋掉
        this._diskTallies()
      }
      const t0 = performance.now()
      writeMain(JSON.stringify(this.state), keep)
      this._slowSave = performance.now() - t0 > SLOW_SAVE
      localStorage.setItem(REV_KEY, this.state.rev || '')
      rememberLook(this.state.settings.theme)
      this._diskRev = this.state.rev || ''
      this._seq = uid()
      try {
        localStorage.setItem(SEQ_KEY, this._seq)
      } catch {}
    } catch (e) {
      console.warn('[hiyori] 存檔失敗', e)
      // 只在「從存得進去變成存不進去」時說一次，不要每個動作都跳出來
      if (!this.saveError) {
        this.saveError = e
        this.emit('saveFailed', e)
      }
      return false
    }
    // 回神紀錄：主存檔之前沒寫進去時先不留在去重表上的那幾則，數字現在跟著寫進去了，補回去
    this._releaseTally?.()
    if (this.saveError) {
      this.saveError = null
      this.emit('saveRecovered')
    }
    return true
  }
  // 記憶體裡這一版已經寫進存檔了（存不進去、還沒寫時是 false）。同步靠它判斷能不能把 base 往前推
  get saved() {
    return (this.state.rev || '') === this._diskRev
  }

  // ── 推導資料 ──
  get player() { return this.state.player }
  get stats() { return this.state.player.stats }
  get level() { return levelFromXp(this.state.player.xp) }
  get streak() {
    const p = this.state.player
    if (!p.lastActive) return 0
    // 最後活動的日子比今天還晚（日期倒退了）：也還在連續中
    return p.lastActive >= addDays(this.today, -1) ? p.streak : 0
  }
  day(date = this.today) {
    return (this.state.history[date] ||= emptyDay())
  }
  peekDay(date) {
    return this.state.history[date] || emptyDay()
  }
  // 那天的任務（還沒完成的長期任務不屬於任何一天）
  tasksOn(date) {
    return this.state.tasks.filter((t) => t.date === date && !floating(t))
  }
  overdue() {
    return this.state.tasks.filter((t) => !t.done && !t.ongoing && t.date < this.today)
  }
  // 花圃要種的任務：那天的任務；看今天時，再加上最近 7 天還沒完成的（花會垂下）與今天才補完成的逾期任務
  gardenTasks(date) {
    const list = this.tasksOn(date)
    if (date !== this.today) return list
    const since = addDays(this.today, -7)
    const late = this.state.tasks.filter(
      (t) => t.date < this.today && t.date >= since && !floating(t) && (!t.done || (t.doneAt && dateStr(new Date(t.doneAt)) === this.today)),
    )
    return [...list, ...late]
  }
  // 那天有時段的日程（時間軸、空檔、排程、時之環、提醒都只看這些）；整天的另外用 allDayOn
  // 匯入的行事曆抓回來的日程（this.external，唯讀、id 開頭是 x-）也算在裡面
  eventsOn(date) {
    return [...this.state.events, ...(this.external || [])].filter((e) => e.date === date && !e.allDay).sort((a, b) => toMin(a.start) - toMin(b.start))
  }
  // 那天落在裡面的整天日程（跨好幾天的每一天都算）：先開始的在前
  allDayOn(date) {
    return [...this.state.events, ...(this.external || [])]
      .filter((e) => e.allDay && e.date <= date && date <= (e.endDate || e.date))
      .sort((a, b) => a.date.localeCompare(b.date) || (b.endDate || b.date).localeCompare(a.endDate || a.date) || a.title.localeCompare(b.title))
  }
  // 島上有塔的專案
  towerProjects() {
    return this.activeProjects().filter((p) => p.slot >= 0)
  }
  activeProjects() {
    return this.state.projects.filter((p) => !p.archived)
  }
  // 期限在兩天內（含今天）還沒落成的專案，最急的在前（範例專案不算）
  deadlineSoon() {
    return this.activeProjects()
      .filter((p) => p.deadline && !p.completedAt && !p.pausedAt && p.milestones.length && !this.isSample(p))
      .map((p) => ({ project: p, days: daysBetween(this.today, p.deadline) }))
      .filter((x) => x.days >= 0 && x.days <= 2)
      .sort((a, b) => a.days - b.days)
  }
  // 里程碑完成的比例；還沒完成的里程碑，細項和歸在底下的任務做了幾成也算進去（房子跟著多蓋一點）
  progress(p) {
    return projectProgress(p, this.state.tasks)
  }
  // 好幾個專案一起算（場景同步每次都要全部的房子）：Map(id → 0..1)
  progressOf(projects) {
    return progressAll(projects, this.state.tasks)
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
    // 範例不算（記下自己的第一件時就收起來了，抽到「完成兩個日程」會做不到）
    const ctx = {
      hour: new Date().getHours(),
      events: this.eventsOn(date).filter((e) => !this.isSample(e)).length,
      routineTasks: this.tasksOn(date).filter((t) => t.routineId).length,
      projects: this.activeProjects().filter((p) => !p.completedAt && !p.pausedAt && !this.isSample(p)).length,
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
    const tasks = this.state.tasks.filter((t) => set.has(t.date) && !floating(t))
    // nudges／backs／onTask：警語提醒了幾次、之後回到正事幾次、本來就在做正事幾次（回神紀錄）；leaves：專注中切去用別的 App 幾次；
    // holds：專注中想分心時先等了一分鐘、回到正事幾次；returns：等完還是想去、限時去之後回來了幾次；
    // pulls：想分心時想去做什麼（PULLS 的 id → 次數，忍住和去了的都算）
    const r = { week: wk, end, days: days.length, total: tasks.length, done: 0, rate: 0, focus: 0, pomodoros: 0, stars: 0, starTotal: 0, active: 0, habitRate: null, nudges: 0, backs: 0, onTask: 0, leaves: 0, holds: 0, returns: 0, pulls: {} }
    // 本命：完成的和總數都從同一批任務算（以前完成數看每天的紀錄，刪掉或改日期的本命會算出「1 / 0」）
    for (const t of tasks) {
      if (t.done) r.done++
      if (t.star) {
        r.starTotal++
        if (t.done) r.stars++
      }
    }
    r.rate = r.total ? r.done / r.total : 0
    for (const d of days) {
      const h = this.peekDay(d)
      r.focus += h.focus
      r.pomodoros += h.pomodoros
      r.nudges += h.nudges || 0
      r.backs += h.backs || 0
      r.onTask += h.onTask || 0
      r.leaves += h.leaves || 0
      r.holds += h.holds || 0
      r.returns += h.returns || 0
      for (const [k, n] of Object.entries(h.pulls || {})) r.pulls[k] = (r.pulls[k] || 0) + n
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
    // 今天（或日期倒退前的那一天）已經算過了
    if (p.lastActive >= this.today) return
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
  // 先把某一天的例行公事生成出來（提醒要看明天一早的例行日程時用）。實例的 id 固定，兩個分頁各做一次也不會重複
  prepareRoutines(date) {
    if (!this._ensureRoutines(date).length) return
    this.save(false)
    this.emit('change')
  }
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

  // ── 晚間回顧（今日總覽的「今日反思」也是這一篇） ──
  saveReview(date, mood, text) {
    this._refreshToday()
    if (!MOODS.some((m) => m.key === mood)) return
    const first = !this.state.journal[date]
    this.state.journal[date] = { mood, text: String(text || '').trim().slice(0, REVIEW_TEXT), at: Date.now() }
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
    // 今天來過了；日期倒退（記的是比今天晚的日子）也不再給一次
    if (b.visit >= this.today) return
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
    if (!item || !Number.isFinite(x) || !Number.isFinite(z)) return null
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
    if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return
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
  // 只為「今天或之後」且尚未生成過的日期建立實例；使用者刪掉的實例不會再長回來。
  // 實例的 id 由例行公事和日期決定：兩個分頁各自生成、或換成另一個分頁那一版後重新生成，都是同一個 id（開著的編輯表單還對得上）
  _ensureRoutines(date) {
    const created = []
    if (date < this.today) return created
    let have = null
    for (const r of this.state.routines) {
      if (r.startDate > date || r.made[date] || !repeatMatches(r.repeat, date)) continue
      r.made[date] = true
      // 那一天的實例已經在了（日期倒退：搭飛機往西飛、改了時區）：不再生一份同 id 的
      have ??= new Set([...this.state.tasks, ...this.state.events].map((x) => x.id))
      if (have.has(instanceId(r, date))) continue
      if (r.kind === 'task') {
        const t = blankTask({ id: instanceId(r, date), title: r.title, date, priority: r.priority, tag: r.tag, routineId: r.id })
        this.state.tasks.push(t)
        created.push(t)
      } else {
        const e = { id: instanceId(r, date), title: r.title, date, start: r.start, end: r.end, color: r.color, done: false, rewarded: false, routineId: r.id }
        this.state.events.push(e)
        created.push(e)
      }
    }
    // 生成過的紀錄留最近幾天：日期倒退回前一兩天時，使用者刪掉的那天的實例也不會再冒出來
    const keep = addDays(this.today, -MADE_KEEP)
    for (const r of this.state.routines) for (const d of Object.keys(r.made)) if (d < keep) delete r.made[d]
    return created
  }
  routineOf(item) {
    return item?.routineId ? this.state.routines.find((r) => r.id === item.routineId) : null
  }
  addRoutine({ kind = 'task', title, repeat, priority = 2, tag = 'life', start = '09:00', end = '10:00', color = 0, date = this.selectedDate }) {
    title = title.trim()
    if (!title || !REPEAT_TYPES.includes(repeat?.type)) return null
    const days = repeat.type === 'weekly' ? (repeat.days?.length ? repeat.days : [parseDate(date).getDay()]) : []
    // 每月幾號：沒給就是開始那天的日期
    const day = repeat.type === 'monthly' ? Math.min(31, Math.max(1, Math.round(repeat.day) || parseDate(date).getDate())) : 0
    // 例行日程每天都在同一天裡：跨過午夜的截到 23:59（快速記錄、日程頁的輸入列都一樣）
    if (kind === 'event' && overnight(start, end)) end = '23:59'
    else if (toMin(end) <= toMin(start)) end = minToHHMM(Math.min(toMin(start) + 60, 1439))
    const r = {
      id: uid(), kind, title, repeat: day ? { type: repeat.type, days, day } : { type: repeat.type, days }, priority, tag, start, end, color,
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
    this._dropTaskRefs()
    this._finish()
  }

  // ── 日程 ──
  // allDay：整天的（沒有時段），endDate 是最後一天（不填就是一天）
  // 結束比開始早（23:30–00:30）：跨過午夜，到隔天才結束（overnight）。結束跟開始一樣、或「跨過午夜」要超過 16 小時（多半是填錯）：補成一小時
  addEvent({ title, start = '09:00', end = '10:00', color = 0, date = this.selectedDate, note = '', allDay = false, endDate = '' }) {
    if (!title.trim()) return null
    const over = !allDay && overnight(start, end)
    if (allDay) [start, end] = ['00:00', '23:59']
    else if (!over && toMin(end) <= toMin(start)) end = start === '23:30' ? '23:59' : minToHHMM(Math.min(toMin(start) + 60, 1439))
    const e = {
      id: uid(), title: title.trim(), date, start, end, color, done: false, rewarded: false, note: String(note || '').trim().slice(0, 200),
      allDay: !!allDay, endDate: allDay ? allDayEnd(endDate, date) : '',
    }
    this.state.events.push(e)
    if (over) this._place(e, date, start, end)
    this._finish([['eventAdded', e]])
    return e
  }
  // ── 跨過午夜的日程：存成連著的兩段（每一段都在同一天裡，時間軸、提醒、日曆照一天一天看）──
  // 23:30–00:30 是那天 23:30–23:59、隔天 00:00–00:30 兩段，link 一樣。兩段是同一個日程：名稱、顏色、備註、日子、時段、
  // 完成、刪除都照整個日程來（日程面板、ふじ看到的是整個日程；時間軸上拖其中一段，見 dragEvent）
  _pieces(e) {
    return e?.link ? this.state.events.filter((x) => x.link === e.link) : e ? [e] : []
  }
  // 照日子排好的那幾段（第一段是開始的那天）
  eventGroup(e) {
    return this._pieces(e).sort((a, b) => a.date.localeCompare(b.date))
  }
  // 整個日程：第一段（head）的日子、開始，到最後一段的結束（比開始早＝隔天才結束）。e 是哪一段都可以
  eventSpan(e) {
    const all = this.eventGroup(e)
    const head = all[0] || null
    return { head, all, date: head?.date, start: head?.start, end: all.length > 1 ? all.at(-1).end : head?.end }
  }
  // 整個日程（每一段的日子、時段、名稱、備註、完成）的樣子：撤銷新增時比對「之後有沒有改過」
  _eventSig(e) {
    return JSON.stringify(this.eventGroup(e).map((x) => [x.id, x.date, x.start, x.end, x.title, x.note || '', !!x.done, !!x.allDay, x.endDate || '']))
  }
  // 接在前一天後面的那一段（00:00 開始的）：提醒只在第一段開始前響
  isCont(e) {
    return !!e?.link && this.state.events.some((x) => x.link === e.link && x.date < e.date)
  }
  // 把整個日程（e 是第一段）排到 date 的 start–end：跨過午夜就接一段到隔天 00:00（已經有那一段就改它），
  // 剛好在午夜結束、沒跨過午夜的話後面那段拿掉
  _place(e, date, start, end) {
    const rest = this.eventGroup(e).filter((x) => x !== e)
    const over = overnight(start, end)
    Object.assign(e, { date, start, end: over ? '23:59' : end, allDay: false, endDate: '' })
    let next = null
    if (over && toMin(end) > 0) {
      const piece = { date: addDays(date, 1), start: '00:00', end, allDay: false, endDate: '' }
      next = rest[0] || null
      if (next) Object.assign(next, piece)
      else {
        e.link ||= uid()
        next = { ...e, id: uid(), ...piece }
        this.state.events.push(next)
      }
    }
    const gone = new Set(rest.filter((x) => x !== next).map((x) => x.id))
    if (gone.size) this.state.events = this.state.events.filter((x) => !gone.has(x.id))
    if (!next) delete e.link
  }
  toggleEvent(id) {
    const e = this._find('events', id)
    if (!e) return
    this._refreshToday()
    const done = !e.done
    const all = this._pieces(e)
    // 跨過午夜的那幾段一起勾、一起取消；XP 只給一次
    const paid = all.some((x) => x.rewarded)
    for (const x of all) x.done = done
    const fx = []
    if (done) {
      fx.push(['eventDone', e])
      if (!paid) {
        for (const x of all) x.rewarded = true
        this.stats.eventsDone++
        this.day().events++
        this._gain(XP.event, fx, { kind: 'event', id: e.id })
      }
    }
    this._finish(fx)
  }
  // id 是哪一段都可以：patch 的日子、開始、結束是整個日程的（eventSpan）。
  // 結束比開始早：跨過午夜。只改開始的不算（除非本來就跨過午夜：23:30–00:30 改成 23:00 開始，還是到隔天 00:30）；
  // 這時開始被挪到結束之後，結束照原本的長度跟著挪（不會因此跨到隔天：要跨過午夜得自己給結束），改了結束的補成一小時
  updateEvent(id, patch) {
    const hit = this._find('events', id)
    if (!hit) return
    const span = this.eventSpan(hit)
    const e = span.head
    const clean = cleanPatch({ ...e, end: span.end }, patch, EVENT_PATCH)
    const v = { ...e, end: span.end, ...clean }
    for (const x of span.all) for (const k of ['title', 'color', 'note']) if (k in clean) x[k] = v[k]
    // 例行公事長出來的那一天不能改成整天（例行公事本身有時段）
    if (e.routineId) v.allDay = false
    if (v.allDay) {
      this._place(e, v.date, '00:00', '23:59')
      Object.assign(e, { allDay: true, endDate: allDayEnd(v.endDate, v.date) })
    } else {
      let { start, end } = v
      // 本來就跨過午夜、只把開始往前挪：最早挪到整段 16 小時的地方（結束留著，不會因為長過頭變成那天就結束）
      if (span.all.length > 1 && !('end' in clean) && toMin(start) > toMin(end) && !overnight(start, end)) start = minToHHMM(toMin(end) + 1440 - OVERNIGHT_MAX)
      let over = overnight(start, end) && ('end' in clean || span.all.length > 1)
      if (!over && toMin(end) <= toMin(start)) {
        end = minToHHMM(Math.min(toMin(start) + ('end' in clean ? 60 : spanLen(span.start, span.end) || 60), 1439))
        over = overnight(start, end)
      }
      // 例行公事的那一天也在同一天裡：跨過午夜的截到 23:59
      if (over && e.routineId) end = '23:59'
      this._place(e, v.date, start, end)
    }
    this._finish([['eventChanged', e]])
  }
  // 整個日程挪 by 分鐘（長度不變，可以挪到前一天、隔天）
  moveEvent(id, by) {
    const hit = this._find('events', id)
    if (!hit || hit.allDay || !Number.isFinite(by) || !by) return
    const span = this.eventSpan(hit)
    const len = spanLen(span.start, span.end) || 60
    const from = toMin(span.start) + Math.round(by)
    const day = Math.floor(from / 1440)
    const start = from - day * 1440
    const to = start + len
    const end = to < 1440 ? minToHHMM(to) : to === 1440 || len > OVERNIGHT_MAX ? '23:59' : minToHHMM(to - 1440)
    this.updateEvent(span.head.id, { date: addDays(span.date, day), start: minToHHMM(start), end })
  }
  // 時間軸（日程頁、小島）上拖的是某一天的那一段：start、end 是那一段拖完的時段；edge：只拉了上緣（'start'）、下緣（'end'）。
  // 跨過午夜的日程：整段拖＝整個日程一起挪；拉第一段的下緣＝改成那天就結束；拉最後一段的下緣＝改結束（最長 16 小時）；
  // 拉上緣＝從那一段的那天、那個時間才開始
  dragEvent(id, { start, end, edge = null }) {
    const e = this._find('events', id)
    if (!e) return
    const span = this.eventSpan(e)
    if (span.all.length < 2) return this.updateEvent(id, { start, end })
    if (!edge) return this.moveEvent(id, toMin(start) - toMin(e.start))
    if (edge === 'start') return this.updateEvent(id, e === span.head ? { start } : { date: e.date, start, end: e.end })
    if (e === span.head) return end === '23:59' ? undefined : this.updateEvent(id, { end })
    const most = toMin(span.start) + OVERNIGHT_MAX - 1440
    this.updateEvent(id, { end: minToHHMM(Math.max(1, Math.min(toMin(end), most))) })
  }
  // only：只刪這一段（撤銷時放回的是那一筆），平常跨過午夜的幾段一起刪
  deleteEvent(id, { only = false } = {}) {
    const e = this._find('events', id)
    const gone = new Set(only || !e ? [id] : this._pieces(e).map((x) => x.id))
    this.state.events = this.state.events.filter((x) => !gone.has(x.id))
    this._finish()
  }

  // ── 日曆：一天的摘要 ──
  daySummary(date) {
    const tasks = this.tasksOn(date)
    const events = this.eventsOn(date)
    const habits = this.state.habits.filter((h) => !h.archived && h.kind === 'build' && applies(h, date))
    const life = this.lifeOn(date)
    return {
      date, tasks, events, allDay: this.allDayOn(date),
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

  // ── 專注 / 互動 / 每日任務 ──
  // projectId：專注的目標直接選了專案（沒綁任務時才看）
  // sid：這一輪專注的 id（番茄鐘開始時給的）。同一個 id 只記一次：兩個分頁開著同一個計時、同時到點時，
  // 另一邊已經記過了（換成了那一版）就回傳 false，不再加一次
  // extra：加時（倒數到點後接著做的那幾分鐘）。只加專注的分鐘，不多算一顆番茄，經驗值照分鐘給
  completePomodoro(minutes, taskId = null, projectId = null, sid = null, { extra = false } = {}) {
    if (sid && this.state.pomoSids.includes(sid)) return false
    // 分鐘數壞掉（NaN、負的）就當 0：一個 NaN 會讓經驗值、金平糖和統計整個變成 NaN，存檔後歸零
    minutes = Number.isFinite(+minutes) ? Math.min(600, Math.max(0, +minutes)) : 0
    if (ID_RE.test(sid)) this.state.pomoSids = [...this.state.pomoSids, sid].slice(-POMO_SIDS)
    this._refreshToday()
    const task = taskId ? this._find('tasks', taskId) : null
    if (task) {
      if (!extra) task.pomos = (task.pomos || 0) + 1
      // 實際做了幾分鐘（跟預估比，看得出平常估得準不準）
      task.spent = Math.min(99999, (task.spent || 0) + Math.round(minutes))
      task.touched = Date.now()
    }
    // 任務歸在某個專案、或目標就是專案：專注的分鐘記到專案上（專案的時間軸和統計用）
    const proj = this._find('projects', task ? task.project : projectId) || null
    if (proj && minutes) {
      proj.focus[this.today] = Math.min(1440, (proj.focus[this.today] || 0) + Math.round(minutes))
      this._edited(proj)
    }
    const fx = [['pomodoro', { minutes, task, project: proj, extra }]]
    if (!extra) this.stats.pomodoros++
    this.stats.focusMinutes += minutes
    const d = this.day()
    if (!extra) d.pomodoros++
    d.focus += minutes
    // 這次專注落在哪個時段：用中間的時間點算
    const mid = new Date(Date.now() - minutes * 30000).getHours()
    d[mid < 5 ? 'focusLate' : mid < 12 ? 'focusAm' : mid < 18 ? 'focusPm' : 'focusEve'] += minutes
    // XP 依長度：25 分＝原本的份量，短的少一點、長的最多兩倍
    if (extra) this._gain(Math.round(XP.pomodoro * Math.min(2, minutes / 25)), fx, { kind: 'focus' })
    else {
      this._gain(Math.round(XP.pomodoro * Math.min(2, Math.max(0.4, minutes / 25))), fx, { kind: 'focus' })
      this._bondGain(BOND_POINTS.pomodoro, fx)
    }
    this._finish(fx)
    return true
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
  // 跨裝置的計時：這台按了計時的按鈕、到點時接手了（main.js 的 shareTimer）。別台同步拉回時照它換
  setTimer(t) {
    this.state.timer = t
    this.save()
  }
  // 建議和鼓勵：總開關關著時底下的每一項都不說；key 是底下那一項自己的開關（backNudge、nextNudge、stuckNudge、brief）
  nudge(key) {
    const st = this.state.settings
    return st.nudgeOn !== false && (key == null || st[key] !== false)
  }
  // 警語的總開關：醒著時的提醒、面板上方那一條、專注時貓咪念的，有一樣開著就算開著
  mottoOn() {
    const st = this.state.settings
    return st.mottoEvery > 0 || st.catMotto > 0 || !!st.mottoBar
  }
  // 關掉：三樣都關，原本的樣子記下來；打開：放回記下的（沒記過、記的也是關著的，用預設）。
  // 改的是原本那三個設定，手機、伺服器排的警語和舊版的 App 都照著停
  setMottoOn(on) {
    const st = this.state.settings
    if (on === this.mottoOn()) return
    if (!on) {
      // 開著的記下現在的；本來就關著的（例如總開關關著時只打開了面板上方那一條）留著之前記的，不會被蓋成關
      const keep = st.mottoWasEvery > 0 || st.mottoWasCat > 0 || st.mottoWasBar
      Object.assign(st, {
        mottoWasEvery: st.mottoEvery > 0 || !keep ? st.mottoEvery : st.mottoWasEvery,
        mottoWasCat: st.catMotto > 0 || !keep ? st.catMotto : st.mottoWasCat,
        mottoWasBar: st.mottoBar || !keep ? !!st.mottoBar : st.mottoWasBar,
        mottoEvery: 0, catMotto: 0, mottoBar: false,
      })
    } else {
      const none = !(st.mottoWasEvery > 0) && !(st.mottoWasCat > 0) && !st.mottoWasBar
      const pick = (list, v, d) => (!none && list.includes(v) ? v : d)
      st.mottoEvery = pick(MOTTO_EVERY, st.mottoWasEvery, DEFAULT_SETTINGS.mottoEvery)
      st.catMotto = pick(CAT_MOTTOS, st.mottoWasCat, DEFAULT_SETTINGS.catMotto)
      st.mottoBar = none ? DEFAULT_SETTINGS.mottoBar : !!st.mottoWasBar
    }
    this.save()
  }

  // ── 資料 ──
  exportJSON() {
    return JSON.stringify(this.state, null, 2)
  }
  // 匯入前把現在的小島留成備份（設定裡可以還原）；備份存不進去就不匯入，免得選錯檔案就回不去
  importJSON(text) {
    let obj
    try {
      obj = JSON.parse(text)
    } catch {
      throw new Error('檔案不是 JSON 格式')
    }
    if (!isObj(obj) || !Array.isArray(obj.tasks) || !isObj(obj.player)) throw new Error('不是有效的ひより存檔')
    if (newerData(obj)) throw new Error(NEWER_MSG)
    if (this.newerApp) throw new Error(NEWER_TAB_MSG)
    if (!keepBackup(this.state, 'import', this.state.updatedAt)) throw new Error('瀏覽器空間不夠，沒辦法先備份現在的小島。請先「匯出資料」存一份')
    if (!this.replaceOrUndo(obj)) throw new Error(NO_SAVE_MSG)
  }
  // 整份換掉（匯入、還原備份）並存好；存不進去就換回原本那一份（存檔裡還是原本的），回傳有沒有換成。
  // 不然畫面上是新的那份、重新整理就不見了，還原備份時連那份備份都會先被刪掉
  replaceOrUndo(obj) {
    const cur = this.state
    const failed = this.loadFailed
    if (this.replaceState(obj)) return true
    this.replaceState(cur, cur.updatedAt, { rev: cur.rev, peer: true })
    // 原本是「存檔讀不進來」的範例島：換回去後也一樣不能蓋掉那份讀不懂的存檔
    this.loadFailed = failed
    return false
  }
  // 整份替換（匯入、同步拉回）：先完整清洗成功，才替換現有狀態
  // 同步拉回時帶著雲端那一版的 updatedAt 和 rev；匯入、還原備份則算一次新的變更
  // soft：同步拉回的新資料（畫面就地更新，不重蓋小鎮、不移動鏡頭）
  // peer：另一個分頁剛存的那一版。它已經在存檔裡了：不寫回去，也不算這邊改了資料（不觸發同步）
  // 回傳有沒有寫進存檔（peer 本來就在存檔裡，算有）
  replaceState(obj, updatedAt = this._nextVersion(), { soft = false, rev = newRev(), peer = false } = {}) {
    if (!isObj(obj) || !Array.isArray(obj.tasks) || !isObj(obj.player)) throw new Error('不是有效的ひより存檔')
    if (newerData(obj)) throw new Error(NEWER_MSG)
    const next = migrate(obj)
    next.updatedAt = updatedAt
    next.rev = rev
    // 匯入、還原備份：計時照現在的樣子（那份檔案裡的計時是當時的，換過去的話別台會把那一輪接回來重新倒數）
    if (!soft && !peer) next.timer = this.state?.timer ?? null
    // 同步拉回別台的、換成別的分頁的那一版：回神紀錄（自動記的、只會往上加）每天取比較大的那個，
    // 這台還沒同步出去的提醒次數不會被蓋掉。匯入、還原備份是整份換掉：換一個 gen，之後誰拿到這一份都照它的數字
    let raised = false
    if (soft && sameGen(this.state, next)) raised = keepTallies(this.state?.history, next.history)
    else if (!soft && !peer) next.tallyGen = uid()
    // 同步拉回的那一版數字比這台少：算成這台改過一次（換 rev），下一輪同步推上去，別台才拿得到這台多記的
    if (raised && !peer) {
      next.rev = newRev()
      next.updatedAt = Math.max(Date.now(), updatedAt + 1)
    }
    // 匯入的舊檔沒有小鎮紀錄：照統計直接蓋好就好，不另外打招呼
    delete next.town.welcome
    this.state = next
    // 換成了一份讀得進來的資料：不再是「存檔讀不進來」的狀態
    this.loadFailed = null
    this.settleLots()
    this.today = dateStr()
    this._ensureRoutines(this.today)
    if (this.selectedDate !== this.today) this._ensureRoutines(this.selectedDate)
    this._ensureQuests()
    // 換進來的這份可能停在好幾天前（匯入舊備份、很久沒開的裝置）：補做跨日結算，お守り才保得住連續天數、
    // 戒除里程碑才領得到（之後同一天的 tick 不會再做）。都只做一次；另一個分頁的那一版那邊已經做過了。
    // 每天來訪的好感度不補：拉回同步資料時跳出送金平糖會很突兀，明天打開就有
    if (!peer) {
      this._applyCharms()
      this._quitMilestones(this._pending)
    }
    let saved = true
    if (peer) {
      this._diskRev = rev
      // 這個分頁多記的回神紀錄：馬上寫回存檔（同一版、不算改了資料；那個分頁讀到同一版時會把數字併過去）。
      // 不排隊：另一個分頁緊接著記的那一則才讀得到
      if (raised) this.saveNow()
    } else saved = this.saveNow()
    this._readyQuests = new Set(this.quests().filter((q) => q.ready).map((q) => q.id))
    this._weeklyReady = this.weekly()?.ready
    if (!peer) this.emit('dirty')
    this.emit('change')
    this.emit('reload', { soft })
    this.flushPending()
    return saved
  }
  // ── 範例資料（id 開頭是 ex-） ──
  // 是不是範例：任務、日程看 id；範例專案裡寫了自己的東西（_authored 記下的，或匯入的檔案裡有自己的進度、筆記）就是使用者的了。
  // 範例只是讓島一開始有東西看：不算進任何會提醒你的地方（摘要、提醒、風險、ふじ的通知、「現在該做」）
  isSample(x) {
    if (!isSampleId(x?.id)) return false
    if (!Array.isArray(x.milestones)) return true
    return !(x.mine || x.logs.some((y) => !isSampleId(y.id)) || x.notes.some((y) => !isSampleId(y.id)))
  }
  // 那個專案是範例嗎（給 id；找不到的不算）
  sampleProject(id) {
    const p = id && this.state.projects.find((x) => x.id === id)
    return !!p && this.isSample(p)
  }
  samples() {
    const s = this.state
    const keep = (x) => this.isSample(x)
    return { tasks: s.tasks.filter(keep), events: s.events.filter(keep), projects: s.projects.filter(keep) }
  }
  sampleCount() {
    const x = this.samples()
    return x.tasks.length + x.events.length + x.projects.length
  }
  // 範例過了開島那天還留著（隔天就收起來，不然變成逾期、「那時沒提醒到」、快到期的專案）。
  // 範例任務、日程都刪掉了、只剩範例專案的：照專案建立的那天
  samplesStale() {
    const x = this.samples()
    return [...x.tasks, ...x.events].some((y) => y.date < this.today) || x.projects.some((p) => p.createdAt && dateStr(new Date(p.createdAt)) < this.today)
  }
  // 收起範例（加了第一件自己的東西，或過了開島那天）：跟 clearSamples 一樣，另外留一份放得回去的（撤銷用）。
  // 說過要留著（撤銷過一次）就不收。回傳那一份，沒有可收的是 null
  tuckSamples() {
    if (this.state.settings.keepSamples) return null
    const x = this.samples()
    if (!x.tasks.length && !x.events.length && !x.projects.length) return null
    const gone = new Set(x.projects.map((p) => p.id))
    const copy = (list) => list.map((y) => structuredClone(y))
    // 自己的任務歸在範例專案裡：收起來時拿掉歸屬，放回去時接回去
    const left = this.state.tasks.filter((t) => gone.has(t.project) && !x.tasks.includes(t)).map((t) => ({ id: t.id, project: t.project, ms: t.ms }))
    // gen：這一份資料（匯入、還原備份會換）。換了一份之後按撤銷不放回去（範例不會混進別份資料）
    const snap = { gen: this.state.tallyGen || '', tasks: copy(x.tasks), events: copy(x.events), projects: copy(x.projects), left }
    this.clearSamples()
    return snap
  }
  // 撤銷收起範例：放回去（已經有同一個 id 的不重複放），之後也不再自動收。
  // 範例專案原本的地被新專案用了：照空地重新分（不會兩間房子疊在一起）；自己的任務只接回專案和里程碑（之後改過的日期照改過的）
  restoreSamples(snap) {
    if (!snap || (snap.gen || '') !== (this.state.tallyGen || '')) return 0
    const s = this.state
    let n = 0
    for (const key of ['tasks', 'events', 'projects']) {
      for (const y of snap[key] || []) {
        if (s[key].some((z) => z.id === y.id)) continue
        const item = structuredClone(y)
        if (key === 'projects' && item.slot >= 0 && s.projects.some((p) => p.slot === item.slot)) item.slot = -1
        s[key].push(item)
        n++
      }
    }
    for (const l of snap.left || []) {
      const t = s.tasks.find((y) => y.id === l.id)
      if (t && !t.project && s.projects.some((p) => p.id === l.project)) Object.assign(t, { project: l.project, ms: l.ms })
    }
    s.settings.keepSamples = true
    this._finish()
    return n
  }
  // 清掉範例，自己加的資料、經驗值和統計都不動
  clearSamples() {
    const x = this.samples()
    const drop = (list, gone) => list.filter((item) => !gone.includes(item))
    this.state.tasks = drop(this.state.tasks, x.tasks)
    this.state.events = drop(this.state.events, x.events)
    this.state.projects = drop(this.state.projects, x.projects)
    // 自己加的任務歸在被清掉的範例專案：任務留著，只拿掉歸屬
    const gone = new Set(x.projects.map((p) => p.id))
    for (const t of this.state.tasks) if (gone.has(t.project)) this._leaveProject(t)
    this._dropTaskRefs()
    const n = x.tasks.length + x.events.length + x.projects.length
    if (n) this._finish()
    return n
  }

  // 重置：清空成一座空島（不放範例）。重置前的小島留成備份（設定裡可以還原）。
  // 備份存不進去時先不清，回傳 false 讓畫面問清楚；force：使用者知道沒有備份、還是要清（空間不夠時重置可能正是想清出空間）
  reset({ force = false } = {}) {
    // 存檔是新版 App 寫的：這一版刪了它就找不回來
    if (this.newerApp) throw new Error(NEWER_MSG)
    // 刪之前重讀一次存檔：另一個分頁（可能是新版）剛寫過、這邊還沒收到通知時，
    // 只備份記憶體裡這份舊的就刪掉，那一版就找不回來了
    let disk = null
    try {
      disk = JSON.parse(localStorage.getItem(KEY) || 'null')
    } catch {}
    if (newerData(disk)) {
      this._newer()
      throw new Error(NEWER_MSG)
    }
    if (disk?.rev && disk.rev !== this._diskRev && disk.rev !== this.state.rev) {
      this._adoptDisk()
      throw new Error('另一個分頁剛改過資料，這邊已經換成那一版。看一下，確定還要清空的話再按一次重置')
    }
    if (!keepBackup(this.state, 'reset', this.state.updatedAt) && !force) return false
    try {
      localStorage.removeItem(KEY)
    } catch {}
    const version = this._nextVersion()
    this.state = seed(false)
    this.state.updatedAt = version
    this.state.rev = newRev()
    // 空島也有今天的每日任務（不然要等到重新整理或明天才抽）
    this.today = dateStr()
    this._ensureQuests()
    this._readyQuests = new Set()
    this._weeklyReady = this.weekly()?.ready
    this.saveNow()
    this.emit('dirty')
    this.emit('change')
    this.emit('reload')
    return true
  }
}

export { DATA_VERSION, newerData, REVIEW_TEXT, ALLDAY_MAX, dateStr, parseDate, addDays, toMin, uid, REPEAT_TYPES, repeatMatches, seasonKey, daysBetween, DEFAULT_SETTINGS, FONT_SCALES, QUALITIES, NOISES, minToHHMM, overnight, spanLen, shiftEnd, OVERNIGHT_MAX } from './store/util.js'

export { floating, DATES_MAX, SUBS_MAX, httpUrl, blankTask, cleanRhythm } from './store/migrate.js'

// 各領域的方法掛回 Store：跟直接寫在 class 裡一樣（getter 照原樣、不可列舉）
for (const obj of [tasksMethods, projectsMethods, habitsMethods, extrasMethods, coachMethods, agentMethods, agentOpsMethods]) {
  const ds = Object.getOwnPropertyDescriptors(obj)
  for (const d of Object.values(ds)) d.enumerable = false
  Object.defineProperties(Store.prototype, ds)
}
