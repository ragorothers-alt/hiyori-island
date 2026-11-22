// 資料正確性的回歸測試：多分頁、拆任務、睡眠獎勵、教練的回答、跨日、提醒與壞掉的數字
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, addDays, dateStr, readBackup, DATA_VERSION } from '../src/store.js'
// 比這一版新的存檔格式
const NEXT = DATA_VERSION + 1
import { Reminders } from '../src/reminders.js'
import { planRules } from '../src/coach.js'
import { FileSync } from '../src/sync.js'
import { TALLY_KEEP } from '../src/store/extras.js'
import { MOTTO_LOG_KEEP } from '../src/push.js'
// 這裡測的是兩邊都改過時讓使用者選邊（沒有上次同步好的那一份時）：自動合併在 merge.test.js
const PICK = { autoMerge: false }

const KEY = 'hiyori-daily-v1'
let store

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 2, 10))
  localStorage.clear()
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0, coins: 0 } }))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('回神紀錄：多分頁、匯入、存不進去、時鐘被往回調', () => {
  const TALLY = 'hiyori-motto-tally'
  const SHOWN = 'hiyori-motto-counted'
  const day = (s) => s.peekDay(s.today)
  const disk = () => JSON.parse(localStorage.getItem(KEY)).history[store.today]

  it('另一個分頁自動記的提醒（不換 rev）：收到存檔事件就併過來，在這邊按回應不會把提醒次數蓋掉；事件還沒到時記之前先讀存檔', async () => {
    store.saveNow()
    const b = new Store()
    const at = Date.now()
    store.mottoNudged(at)
    await Promise.resolve()
    b._otherTabSaved({ key: KEY })
    expect(day(b).nudges).toBe(1)
    b.mottoAnswered('back', at)
    await Promise.resolve()
    expect(day(b)).toMatchObject({ nudges: 1, backs: 1 })
    expect(disk()).toMatchObject({ nudges: 1, backs: 1 })
    // A 跟上 B 的那一版後又念了一則；B 還沒收到事件（剛從凍住醒來）就按了回應
    store._otherTabSaved({ key: KEY })
    const at2 = at + 60000
    store.mottoNudged(at2)
    await Promise.resolve()
    b.mottoAnswered('on', at2)
    await Promise.resolve()
    expect(day(b)).toMatchObject({ nudges: 2, backs: 1, onTask: 1 })
    expect(disk()).toMatchObject({ nudges: 2, backs: 1, onTask: 1 })
  })

  it('另一個分頁同一版自動記了次數、這邊還沒收到事件就改了資料：寫出去之前先把那邊的併進來；換成這一版的那邊也還在', async () => {
    store.saveNow()
    const b = new Store()
    b.mottoNudged(Date.now())
    await Promise.resolve()
    store.addTask({ title: 'A 的任務' })
    await Promise.resolve()
    expect(disk().nudges).toBe(1)
    expect(day(store).nudges).toBe(1)
    b._otherTabSaved({ key: KEY })
    await Promise.resolve()
    expect(b.state.tasks.map((t) => t.title)).toContain('A 的任務')
    expect(b.state.rev).toBe(store.state.rev)
    expect(day(b).nudges).toBe(1)
  })

  it('換成另一個分頁的那一版時，這邊多記的次數寫回存檔（同一版、不算改了資料）', async () => {
    store.saveNow()
    const b = new Store()
    // A 改了資料寫出去；B 在收到事件之前自動記了一則（只在記憶體裡，存檔還沒寫）
    store.addTask({ title: 'A 的任務' })
    await Promise.resolve()
    b._refreshToday()
    b.day(b.today).nudges++
    b._otherTabSaved({ key: KEY })
    await Promise.resolve()
    expect(b.state.tasks.map((t) => t.title)).toContain('A 的任務')
    expect(b.state.rev).toBe(store.state.rev)
    expect(disk().nudges).toBe(1)
    store._otherTabSaved({ key: KEY })
    expect(day(store).nudges).toBe(1)
  })

  it('匯入、還原備份（整份換掉）：另一個分頁不會用取比較大的把舊的次數加回來；去重表也跟著換一份', async () => {
    const at = Date.now()
    store.mottoNudged(at)
    store.mottoAnswered('back', at)
    await Promise.resolve()
    const b = new Store()
    expect(day(b)).toMatchObject({ nudges: 1, backs: 1 })
    store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0, coins: 0 } }))
    b._otherTabSaved({ key: KEY })
    expect(day(b)).toMatchObject({ nudges: 0, backs: 0 })
    b.addTask({ title: 'B 加的' })
    await Promise.resolve()
    expect(new Store().peekDay(store.today)).toMatchObject({ nudges: 0, backs: 0 })
    // 匯入的那一份沒有這一則：再按同一則通知上的按鈕，照匯入的那一份重新算
    store._otherTabSaved({ key: KEY })
    expect(store.mottoAnswered('back', at)).toBe(true)
    expect(day(store)).toMatchObject({ nudges: 1, backs: 1 })
  })

  it('兩個分頁輪流記很多則：這邊記憶體裡舊的那幾則不會又排到最後面，把另一個分頁剛記的擠掉', () => {
    store.saveNow()
    const b = new Store()
    const base = Date.now()
    for (let i = 0; i < 40; i++) store.mottoNudged(base + i * 60000)
    for (let i = 0; i < 40; i++) b.mottoNudged(base + (100 + i) * 60000)
    store.mottoNudged(base + 500 * 60000)
    // B 最近記的那幾則還認得（重新打開也是）
    expect(new Store().mottoNudged(base + 139 * 60000)).toBe(false)
    expect(new Store().mottoNudged(base + 110 * 60000)).toBe(false)
  })

  it('存檔大到改成停手才寫：兩個分頁幾乎同時記不同的兩則，兩次都算到（記了就馬上寫出去）', async () => {
    store.saveNow()
    const b = new Store()
    store._slowSave = b._slowSave = true
    const at = Date.now()
    store.mottoNudged(at)
    b.mottoNudged(at + 60000)
    expect(day(b).nudges).toBe(2)
    expect(disk().nudges).toBe(2)
    store._otherTabSaved({ key: KEY })
    expect(day(store).nudges).toBe(2)
  })

  it('存檔改成停手才寫、另一個分頁剛改了資料：這邊記的那一則換成那一版時馬上寫出去，那邊緊接著記的也讀得到', () => {
    store.saveNow()
    const b = new Store()
    store._slowSave = b._slowSave = true
    store.addTask({ title: 'A 的任務' })
    store.flushSave()
    // B 還沒收到 A 的事件就記了一則：存的時候換成 A 那一版、數字帶過去，馬上寫
    b.mottoNudged(Date.now())
    expect(disk()).toMatchObject({ nudges: 1 })
    expect(b.state.tasks.map((t) => t.title)).toContain('A 的任務')
    store.mottoNudged(Date.now() + 60000)
    expect(disk()).toMatchObject({ nudges: 2 })
    b.focusLeft()
    expect(disk()).toMatchObject({ nudges: 2, leaves: 1 })
  })

  it('localStorage 寫不進去：同一則在這個分頁也只算一次', () => {
    const real = localStorage.setItem
    localStorage.setItem = function (k, v) {
      if (k === TALLY) throw new Error('QuotaExceededError')
      return real.call(this, k, v)
    }
    try {
      const at = Date.now()
      expect(store.mottoNudged(at)).toBe(true)
      expect(store.mottoAnswered('back', at)).toBe(true)
      expect(store.mottoAnswered('on', at)).toBe(false)
      expect(store.mottoNudged(at)).toBe(false)
      expect(day(store)).toMatchObject({ nudges: 1, backs: 1, onTask: 0 })
    } finally {
      delete localStorage.setItem
    }
  })

  it('頁面不在時手機、推播發過的那幾則：回到 App 時一次算進去（重複的、怪怪的時間不算）；頁面念過、按了通知按鈕的不重算', async () => {
    const at = Date.now() - 3600000
    store.mottoNudged(at)
    const at2 = at + 1800000
    const at3 = at + 2700000
    const n = (x, id = String(x)) => ({ id, at: x })
    expect(store.mottosShown('app', [n(at), n(at2), n(at2, 'again'), n(0, 'zero'), { id: 'x', at: 'x' }, n(-5, 'neg'), n(at3), null, { at: at3 }])).toBe(2)
    expect(day(store).nudges).toBe(3)
    expect(store.mottosShown('app', [n(at2), n(at3)])).toBe(0)
    // 另一個來源（推播）送到同一則：照那一則的時間認，不重算
    expect(store.mottosShown('sw', [n(at3, `9:${at3}`)])).toBe(0)
    // 按了 at3 那一則通知上的按鈕：只記回應，不再算一次提醒
    expect(store.mottoAnswered('back', at3)).toBe(true)
    expect(day(store)).toMatchObject({ nudges: 3, backs: 1 })
    expect(disk()).toMatchObject({ nudges: 3, backs: 1 })
    expect(store.mottosShown('app', [])).toBe(0)
    expect(store.mottosShown('app', null)).toBe(0)
    // 一週以前的：不知道算哪一天，不算（也不記在今天）
    expect(store.mottosShown('sw', [n(Date.now() - 9 * 86400000, 'old')])).toBe(0)
    expect(day(store).nudges).toBe(3)
  })

  it('算過的那幾筆記著（來源不清掉）：去重表只留最近 TALLY_KEEP 則，還在來源裡的舊通知也不會重算', () => {
    const base = Date.now() - 6 * 3600000
    const first = { id: 'sw-1', at: base }
    expect(store.mottosShown('sw', [first])).toBe(1)
    // 之後頁面又念了 TALLY_KEEP + 5 則：去重表上已經沒有 first 那一則了
    for (let i = 1; i <= TALLY_KEEP + 5; i++) store.mottoNudged(base + i * 60000)
    expect(JSON.parse(localStorage.getItem(TALLY)).keys.map((x) => x[0])).not.toContain(String(base))
    // 推播那邊還留著 first：不重算
    expect(store.mottosShown('sw', [first, { id: 'sw-2', at: base + (TALLY_KEEP + 10) * 60000 }])).toBe(1)
    expect(day(store).nudges).toBe(TALLY_KEEP + 7)
    expect(new Store().mottosShown('sw', [first])).toBe(0)
  })

  it('推播留下的一整批（MOTTO_LOG_KEEP 則）一口氣算進來、「看過哪幾筆」卻寫不進去（空間滿了）：同一批不會重算，重新打開也一樣', () => {
    expect(TALLY_KEEP).toBeGreaterThan(MOTTO_LOG_KEEP)
    const base = Date.now() - 3 * 3600000
    const list = Array.from({ length: MOTTO_LOG_KEEP }, (_, i) => ({ id: `${base + i * 60000}:${base + i * 60000}`, at: base + i * 60000 }))
    const real = localStorage.setItem
    localStorage.setItem = function (k, v) {
      if (k === SHOWN) throw new Error('QuotaExceededError')
      return real.call(this, k, v)
    }
    try {
      expect(store.mottosShown('sw', list)).toBe(MOTTO_LOG_KEEP)
      expect(store.mottosShown('sw', list)).toBe(0)
      expect(new Store().mottosShown('sw', list)).toBe(0)
    } finally {
      localStorage.setItem = real
    }
    expect(day(store).nudges).toBe(MOTTO_LOG_KEEP)
  })

  it('時鐘被往回調過：送到的時間比上一筆早的新通知照樣算得到（照代號認，不照時間）', () => {
    const at = Date.now() - 3600000
    expect(store.mottosShown('sw', [{ id: `2000:${at}`, at }])).toBe(1)
    expect(store.mottosShown('sw', [{ id: `2000:${at}`, at }, { id: `1500:${at + 60000}`, at: at + 60000 }])).toBe(1)
    expect(day(store).nudges).toBe(2)
  })

  it('拿到通知紀錄、主存檔卻寫不進去：重新打開後還拿得到、照樣算得到（寫進去了才記成看過了）', () => {
    store.saveNow()
    const real = localStorage.setItem
    localStorage.setItem = function (k, v) {
      if (k === KEY) throw new Error('QuotaExceededError')
      return real.call(this, k, v)
    }
    const at = Date.now() - 1800000
    const list = [{ id: `1:${at}`, at }]
    try {
      expect(store.mottosShown('sw', list)).toBe(1)
      // 這個分頁裡不重算
      expect(store.mottosShown('sw', list)).toBe(0)
      expect(day(store).nudges).toBe(1)
      expect(localStorage.getItem(SHOWN)).toBeNull()
    } finally {
      delete localStorage.setItem
    }
    // 重新打開（數字沒寫進去）：來源還留著那一筆，照樣算得到，算了才記成看過了
    const b = new Store()
    expect(b.peekDay(b.today).nudges || 0).toBe(0)
    expect(b.mottosShown('sw', list)).toBe(1)
    expect(disk()).toMatchObject({ nudges: 1 })
    expect(JSON.parse(localStorage.getItem(SHOWN)).sw).toEqual([`1:${at}`])
    expect(new Store().mottosShown('sw', list)).toBe(0)
  })

  it('主存檔、去重表都寫不進去，之後去重表先恢復：下一則寫去重表時不會連上一則（數字還沒寫進去）一起寫出去', () => {
    store.saveNow()
    const real = localStorage.setItem
    let tallyFull = true
    localStorage.setItem = function (k, v) {
      if (k === KEY || (tallyFull && k === TALLY)) throw new Error('QuotaExceededError')
      return real.call(this, k, v)
    }
    const at = Date.now() - 1800000
    try {
      expect(store.mottoNudged(at)).toBe(true)
      tallyFull = false
      expect(store.mottoNudged(at + 60000)).toBe(true)
      expect(store.mottoNudged(at)).toBe(false)
      const keys = JSON.parse(localStorage.getItem(TALLY) || '{"keys":[]}').keys.map((x) => x[0])
      expect(keys).not.toContain(String(at))
      expect(keys).not.toContain(String(at + 60000))
    } finally {
      delete localStorage.setItem
    }
    // 重新打開：兩則都沒寫進去，同一則還算得進去
    expect(new Store().mottoNudged(at)).toBe(true)
  })

  it('主存檔寫不進去、去重表寫得進去（空間快滿）：重新打開後同一則還算得進去；之後又寫得進去時補回去，不會重算', () => {
    store.saveNow()
    const real = localStorage.setItem
    let full = true
    localStorage.setItem = function (k, v) {
      if (full && k === KEY) throw new Error('QuotaExceededError')
      return real.call(this, k, v)
    }
    try {
      const at = Date.now()
      const at2 = at + 60000
      expect(store.mottoNudged(at)).toBe(true)
      // 這個分頁裡同一則不重算
      expect(store.mottoNudged(at)).toBe(false)
      expect(day(store).nudges).toBe(1)
      // 數字沒寫進去，去重表上也沒有這一則：重新打開（數字是 0）後同一則還算得進去
      expect(JSON.parse(localStorage.getItem(TALLY) || '{"keys":[]}').keys.map((x) => x[0])).not.toContain(String(at))
      expect(new Store().mottoNudged(at)).toBe(true)
      // 回應也一樣：去重表上留著原本存著的那個樣子
      store.mottoNudged(at2)
      full = false
      store.saveNow()
      full = true
      expect(JSON.parse(localStorage.getItem(TALLY)).keys).toContainEqual([String(at2), 'n'])
      expect(store.mottoAnswered('back', at2)).toBe(true)
      expect(JSON.parse(localStorage.getItem(TALLY)).keys).toContainEqual([String(at2), 'n'])
      expect(store.mottoAnswered('on', at2)).toBe(false)
      // 又寫得進去了：記憶體裡的數字跟著寫進去，等著的那幾則補回去去重表；之後再按同一則不會重算
      full = false
      store.addTask({ title: '寫得進去了' })
      store.flushSave()
      expect(JSON.parse(localStorage.getItem(TALLY)).keys).toEqual(expect.arrayContaining([[String(at), 'n'], [String(at2), 'a']]))
      expect(new Store().peekDay(store.today)).toMatchObject({ backs: 1 })
      expect(new Store().mottoAnswered('back', at2)).toBe(false)
      expect(new Store().mottoNudged(at)).toBe(false)
    } finally {
      delete localStorage.setItem
    }
  })

  it('時鐘被往回調過：剛記的那一則不會被當成最舊的丟掉（照記下的先後留最近 TALLY_KEEP 則）；舊格式的去重表還認得', () => {
    const base = Date.now()
    for (let i = 0; i < TALLY_KEEP; i++) store.mottoNudged(base + 86400000 + i * 60000)
    const at = base - 3600000
    expect(store.mottoNudged(at)).toBe(true)
    expect(store.mottoAnswered('back', at)).toBe(true)
    expect(store.mottoNudged(at)).toBe(false)
    expect(store.mottoAnswered('on', at)).toBe(false)
    expect(JSON.parse(localStorage.getItem(TALLY)).keys).toHaveLength(TALLY_KEEP)
    // 重新打開也認得
    expect(new Store().mottoAnswered('on', at)).toBe(false)
    // 上一版存的格式（{ 時間: 'n' }）：跟著還沒有 gen 的資料
    const old = { ...JSON.parse(localStorage.getItem(KEY)) }
    delete old.tallyGen
    localStorage.setItem(KEY, JSON.stringify(old))
    localStorage.setItem(TALLY, JSON.stringify({ [String(at)]: 'a' }))
    const c = new Store()
    expect(c.state.tallyGen).toBe('')
    expect(c.mottoAnswered('back', at)).toBe(false)
    expect(c.mottoNudged(at + 1)).toBe(true)
  })
})

describe('同一個瀏覽器開兩個分頁', () => {
  it('另一個分頁存檔後，這邊換成那一版，下次存檔不會把它蓋掉', () => {
    store.saveNow()
    const other = new Store()
    other.addTask({ title: '另一個分頁加的' })
    other.saveNow()
    store._otherTabSaved({ key: KEY, newValue: localStorage.getItem(KEY) })
    store.addTask({ title: '這邊加的' })
    store.saveNow()
    const titles = new Store().state.tasks.map((t) => t.title)
    expect(titles).toContain('另一個分頁加的')
    expect(titles).toContain('這邊加的')
  })

  it('同一版、別的鍵或壞掉的內容都不理', () => {
    const rev = store.state.rev
    store._otherTabSaved({ key: KEY, newValue: JSON.stringify(store.state) })
    store._otherTabSaved({ key: 'hiyori-layout', newValue: '"app"' })
    store._otherTabSaved({ key: KEY, newValue: '{壞掉' })
    expect(store.state.rev).toBe(rev)
  })

  it('兩邊幾乎同時存檔：不會互相寫來寫去，被蓋掉的那一版留成備份', async () => {
    store.saveNow()
    const b = new Store()
    let writes = 0
    const real = localStorage.setItem
    localStorage.setItem = function (k, v) {
      if (k === KEY) writes++
      return real.call(this, k, v)
    }
    store.addTask({ title: 'A 的任務' })
    await Promise.resolve()
    // B 還沒收到 A 的事件就存了
    b.addTask({ title: 'B 的任務' })
    await Promise.resolve()
    // 事件現在才到，而且是過時的：送幾輪都不會再寫
    const before = writes
    for (let i = 0; i < 3; i++) {
      b._otherTabSaved({ key: KEY })
      store._otherTabSaved({ key: KEY })
      await Promise.resolve()
    }
    delete localStorage.setItem
    expect(writes).toBe(before)
    expect(store.state.rev).toBe(b.state.rev)
    expect(readBackup().from).toBe('tab')
    expect(readBackup().state.tasks.map((t) => t.title)).toContain('A 的任務')
  })

  it('這邊剛改、還沒寫出去時就收到事件：這邊的變更不會被丟掉', async () => {
    store.saveNow()
    const b = new Store()
    store.addTask({ title: 'A 的任務' })
    await Promise.resolve()
    b.addTask({ title: 'B 的任務' })
    b._otherTabSaved({ key: KEY })
    await Promise.resolve()
    expect(b.state.tasks.map((t) => t.title)).toContain('B 的任務')
    expect(JSON.parse(localStorage.getItem(KEY)).tasks.map((t) => t.title)).toContain('B 的任務')
    expect(readBackup().state.tasks.map((t) => t.title)).toContain('A 的任務')
  })

  it('這邊只有各自推導的變化（例行實例）時，直接換成另一邊那一版', async () => {
    store.saveNow()
    const b = new Store()
    store.addTask({ title: 'A 的任務' })
    await Promise.resolve()
    b.save(false)
    await Promise.resolve()
    expect(b.state.tasks.map((t) => t.title)).toContain('A 的任務')
    // 沒有把另一個分頁的版本當成「被取代的」留備份（beforeEach 的匯入留了一份匯入前的）
    expect(readBackup()?.from).not.toBe('tab')
  })

  it('例行公事的實例 id 固定：換成另一個分頁那一版後重新生成，還是同一個 id', () => {
    store.addRoutine({ title: '澆花', repeat: { type: 'daily' } })
    const tomorrow = addDays(store.today, 1)
    store.selectDate(tomorrow)
    const first = store.tasksOn(tomorrow).find((t) => t.routineId)
    const snap = JSON.parse(store.exportJSON())
    snap.tasks = snap.tasks.filter((t) => t.id !== first.id)
    for (const r of snap.routines) r.made = {}
    store.replaceState(snap, Date.now(), { soft: true, rev: 'peer-1', peer: true })
    expect(store.tasksOn(tomorrow).find((t) => t.routineId).id).toBe(first.id)
  })

  it('另一個分頁同步完改了 base，這邊的同步也跟著更新', () => {
    const handlers = []
    globalThis.window ??= globalThis
    globalThis.document ??= { hidden: true, addEventListener() {} }
    globalThis.addEventListener = (type, fn) => type === 'storage' && handlers.push(fn)
    const sync = new FileSync(store, PICK)
    delete globalThis.addEventListener
    localStorage.setItem('hiyori-sync-base', 'rev-from-other-tab')
    for (const fn of handlers) fn({ key: 'hiyori-sync-base' })
    expect(sync.base).toBe('rev-from-other-tab')
  })
})

describe('新版 App 存的資料（這邊是還沒更新的舊分頁）', () => {
  // 假裝另一個分頁已經是第 3 版的 App：多了這一版看不懂的欄位
  const writeNewer = (extra = {}) => {
    const v3 = { ...JSON.parse(store.exportJSON()), version: NEXT, rev: 'newer-rev', future: { keep: 'me' }, ...extra }
    localStorage.setItem(KEY, JSON.stringify(v3))
    localStorage.setItem('hiyori-daily-rev', 'newer-rev')
    return v3
  }

  it('另一個分頁存了新版的：不換過來、說一聲，之後也不拿舊格式蓋掉它', () => {
    store.saveNow()
    const newer = vi.fn()
    store.on('newerApp', newer)
    const v3 = writeNewer()
    store._otherTabSaved({ key: KEY })
    expect(newer).toHaveBeenCalledTimes(1)
    expect(store.newerApp).toBe(true)
    expect(store.lostEdits).toBeFalsy()
    store.addTask({ title: '舊分頁加的' })
    expect(store.saveNow()).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ version: NEXT, future: v3.future })
    // 舊分頁裡改了沒存：再說一次（警示列換成「剛才的變更沒有存」），關掉、重新整理前也會問
    expect([store.lostEdits, newer.mock.calls.length]).toEqual([true, 2])
  })

  it('這邊改了資料、存檔時才發現另一邊是新版：也不蓋掉', () => {
    store.saveNow()
    writeNewer()
    store.addTask({ title: '同時改的' })
    expect(store.saveNow()).toBe(false)
    expect(store.newerApp).toBe(true)
    expect(store.lostEdits).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY)).version).toBe(NEXT)
  })

  it('開機就讀到新版的存檔：照樣顯示，看不懂的欄位和版本號原樣留著，但不寫回去', () => {
    writeNewer()
    const old = new Store()
    expect(old.newerApp).toBe(true)
    expect(old.state).toMatchObject({ version: NEXT, future: { keep: 'me' } })
    old.addTask({ title: '舊程式加的' })
    expect(old.saveNow()).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY)).tasks.map((t) => t.title)).not.toContain('舊程式加的')
  })

  it('舊分頁按重置：不刪新版的存檔', () => {
    store.saveNow()
    writeNewer()
    store._otherTabSaved({ key: KEY })
    expect(() => store.reset()).toThrow('新版 App')
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ version: NEXT, future: { keep: 'me' } })
  })

  it('匯入新版匯出的檔案：先擋下來，現在的小島和備份都不動', () => {
    const before = store.exportJSON()
    const backup = localStorage.getItem('hiyori-backup')
    const v3 = { ...JSON.parse(before), version: NEXT }
    expect(() => store.importJSON(JSON.stringify(v3))).toThrow('新版 App')
    expect(store.exportJSON()).toBe(before)
    expect(localStorage.getItem('hiyori-backup')).toBe(backup)
  })

  it('同步拉到新版 App 存的資料：不拉也不推，停在錯誤等使用者更新', async () => {
    globalThis.window ??= globalThis
    globalThis.document ??= { hidden: true, addEventListener() {} }
    globalThis.addEventListener ??= () => {}
    const sync = new FileSync(store, PICK)
    sync.state = 'linked'
    const v3 = { ...JSON.parse(store.exportJSON()), version: NEXT, rev: 'cloud-v3' }
    const pushed = vi.fn()
    sync._ready = () => true
    sync._pull = async () => ({ rev: 'cloud-v3', savedAt: Date.now(), state: v3 })
    sync._push = pushed
    const rev = store.state.rev
    await sync.sync()
    expect(sync.state).toBe('error')
    expect(sync.message).toContain('新版 App')
    expect(store.state.rev).toBe(rev)
    expect(pushed).not.toHaveBeenCalled()
  })
})

describe('日期倒退（搭飛機往西飛、改了時區）', () => {
  it('回到前一天：例行公事不多生同 id 的一份、刪掉的不再冒出來，連續天數和來訪獎勵不重算', () => {
    store.addRoutine({ title: '澆花', repeat: { type: 'daily' } })
    const first = store.tasksOn(store.today).find((t) => t.routineId)
    store.deleteTask(first.id)
    store.toggleTask(store.addTask({ title: '11/2 的' }).id)
    vi.setSystemTime(new Date(2026, 10, 3, 9))
    store.tick()
    store.toggleTask(store.addTask({ title: '11/3 的' }).id)
    expect(store.streak).toBe(2)
    const visit = store.state.player.bond.visit
    vi.setSystemTime(new Date(2026, 10, 2, 22))
    store.tick()
    expect(store.today).toBe('2026-11-02')
    const ids = store.state.tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(store.tasksOn('2026-11-02').some((t) => t.routineId)).toBe(false)
    expect(store.streak).toBe(2)
    store.toggleTask(store.addTask({ title: '倒退後的' }).id)
    expect(store.streak).toBe(2)
    expect(store.state.player.bond.visit).toBe(visit)
  })
})

describe('拆成三小步', () => {
  it('專注過的輪數留在第一步', () => {
    const t = store.addTask({ title: '寫報告' })
    store.completePomodoro(25, t.id)
    const parts = store.splitTask(t.id)
    expect(parts.map((p) => p.pomos)).toEqual([1, 0, 0])
  })

  it('領過獎勵又取消的任務，拆開後完成不會再領一次', () => {
    const t = store.addTask({ title: '寫報告' })
    store.toggleTask(t.id)
    store.toggleTask(t.id)
    const done = store.stats.tasksDone
    const xp = store.player.xp
    const [first] = store.splitTask(t.id)
    store.toggleTask(first.id)
    expect(store.stats.tasksDone).toBe(done)
    expect(store.player.xp).toBe(xp)
  })

  it('沒領過的任務拆開後照常給獎勵', () => {
    const t = store.addTask({ title: '寫報告' })
    const [first] = store.splitTask(t.id)
    store.toggleTask(first.id)
    expect(store.stats.tasksDone).toBe(1)
  })
})

describe('睡眠紀錄', () => {
  it('刪掉再記一次不會再給經驗值', () => {
    const entry = { bed: '23:00', wake: '07:00' }
    store.logSleep(store.today, entry)
    const xp = store.player.xp
    const logs = store.stats.sleepLogs
    store.deleteSleep(store.today)
    store.logSleep(store.today, entry)
    expect(store.player.xp).toBe(xp)
    expect(store.stats.sleepLogs).toBe(logs)
    expect(store.state.sleep[store.today]).toBeTruthy()
  })

  it('給過獎勵的記號存檔後還在', () => {
    store.logSleep(store.today, { bed: '23:00', wake: '07:00' })
    store.importJSON(store.exportJSON())
    expect(store.state.history[store.today].sleep).toBe(true)
  })
})

describe('教練記得上次的回答', () => {
  it('很長的專案名稱存檔後還是完整的', () => {
    const name = '一個名字超過十六個字的長長長長長專案名稱'
    store.applyCoachPlan(
      { days: [{ date: store.today, items: [{ title: 'step', at: '11:00', dur: 30 }] }] },
      { answers: { focus: [name], slots: ['beforeBed'], days: 5, len: 50 } },
    )
    store.importJSON(store.exportJSON())
    expect(store.state.coach.last.focus).toEqual([name])
  })

  it('只能排考試當天、又寫了總時數時不會出錯，總時數算放不下', () => {
    const today = store.today
    const req = {
      dates: [today], focus: [{ label: '數學', tag: 'study' }], slots: ['beforeBed'], days: 5, len: 50, total: 120,
      exam: { title: '期中考', date: today }, ctx: store.coachContext([today]),
    }
    let res
    expect(() => (res = planRules(req))).not.toThrow()
    expect(res.unplaced).toBeGreaterThan(0)
  })
})

describe('開著過了午夜', () => {
  it('第一次打卡記在新的一天，也有今天的獎勵', () => {
    const h = store.addHabit({ name: '散步' })
    vi.setSystemTime(new Date(2026, 10, 3, 0, 0, 5))
    const xp = store.player.xp
    store.checkHabit(h.id)
    expect(h.log[dateStr()]).toBe(1)
    expect(h.log['2026-11-02']).toBeUndefined()
    expect(store.player.xp).toBeGreaterThan(xp)
  })

  it('重要日子：先跨日再提醒，不會把昨天的考試再提醒一次', () => {
    store.addDate({ title: '期中考', date: store.today })
    const remind = vi.fn()
    const r = new Reminders(store, remind)
    r.check(new Date(2026, 10, 2, 10))
    expect(remind).toHaveBeenCalledTimes(1)
    remind.mockClear()
    vi.setSystemTime(new Date(2026, 10, 3, 10))
    // main.js 的順序：先 tick 再提醒
    store.tick()
    r.check()
    expect(remind).not.toHaveBeenCalled()
  })
})

describe('跨過午夜的提前提醒', () => {
  it('明天 00:05 的日程，今天 23:55 就提醒，過了午夜不再提醒一次', () => {
    store.setSetting('remindLead', 10)
    const ev = store.addEvent({ title: '夜貓會議', date: '2026-11-03', start: '00:05', end: '00:30' })
    const remind = vi.fn()
    const r = new Reminders(store, remind)
    r.check(new Date(2026, 10, 2, 23, 54))
    expect(remind).not.toHaveBeenCalled()
    r.check(new Date(2026, 10, 2, 23, 55))
    expect(remind).toHaveBeenCalledExactlyOnceWith(ev, 10, 'event')
    vi.setSystemTime(new Date(2026, 10, 3, 0, 1))
    store.tick()
    r.check(new Date(2026, 10, 3, 0, 1))
    expect(remind).toHaveBeenCalledTimes(1)
  })

  it('明天一早的例行日程（明天才會生成）：今天晚上也提醒得到', () => {
    store.setSetting('remindLead', 10)
    store.addRoutine({ title: '晨跑', kind: 'event', start: '00:05', end: '00:40', repeat: { type: 'daily' } })
    expect(store.eventsOn('2026-11-03')).toHaveLength(0)
    const remind = vi.fn()
    new Reminders(store, remind).check(new Date(2026, 10, 2, 23, 55))
    expect(remind).toHaveBeenCalledOnce()
    expect(remind.mock.calls[0][0].title).toBe('晨跑')
  })

  it('兩個分頁各有一個提醒：另一個分頁剛提醒過的不會再響一次', () => {
    store.setSetting('remindLead', 10)
    store.addEvent({ title: '開會', date: '2026-11-02', start: '15:00', end: '16:00' })
    const a = vi.fn()
    const b = vi.fn()
    const tabA = new Reminders(store, a)
    const tabB = new Reminders(store, b)
    tabA.check(new Date(2026, 10, 2, 14, 51))
    tabB.check(new Date(2026, 10, 2, 14, 51))
    expect(a).toHaveBeenCalledOnce()
    expect(b).not.toHaveBeenCalled()
  })
})

describe('灌不了的統計、改不了的欄位', () => {
  it('生活記錄、專案進度加了又刪：累計筆數跟著扣回來，當天的經驗也不會再給一次', () => {
    const xp0 = store.player.xp
    const a = store.addLife(store.today, { text: '午餐' })
    const xp1 = store.player.xp
    expect(store.stats.lifeEntries).toBe(1)
    store.deleteLife(store.today, a.id)
    expect(store.stats.lifeEntries).toBe(0)
    for (let i = 0; i < 5; i++) store.deleteLife(store.today, store.addLife(store.today, { text: `再一次 ${i}` }).id)
    expect(store.stats.lifeEntries).toBe(0)
    // 一天最多給 3 次經驗：刪掉不會把次數還回來
    expect(store.player.xp - xp0).toBeLessThanOrEqual((xp1 - xp0) * 3)
    store.deleteLife(store.today, 'nope')
    expect(store.stats.lifeEntries).toBe(0)

    const p = store.addProject({ name: '進度', milestones: ['一'] })
    const log = store.addProjectLog(p.id, { text: '做了一點' })
    expect(store.stats.projectLogs).toBe(1)
    store.deleteProjectLog(p.id, log.id)
    store.deleteProjectLog(p.id, log.id)
    expect(store.stats.projectLogs).toBe(0)
    // 整個專案刪掉：它的進度也扣回來
    const q = store.addProject({ name: '寫了就刪', milestones: ['一'] })
    for (let i = 0; i < 3; i++) store.addProjectLog(q.id, { text: `第 ${i} 筆` })
    expect(store.stats.projectLogs).toBe(3)
    store.deleteProject(q.id)
    store.deleteProject(q.id)
    expect(store.stats.projectLogs).toBe(0)
  })

  it('戒除里程碑：破戒後重新走到同一個里程碑照樣慶祝，但經驗只給第一次', () => {
    const h = store.addHabit({ kind: 'quit', name: '熬夜' })
    const seen = []
    store.on('quitMilestone', (e) => seen.push(e))
    const day = (n) => {
      vi.setSystemTime(new Date(2026, 10, 2 + n, 10))
      store.tick()
    }
    day(1)
    expect(seen.at(-1)).toMatchObject({ days: 1, xp: true })
    const xp = store.player.xp
    store.slipHabit(h.id)
    day(2)
    expect(seen.at(-1)).toMatchObject({ days: 1, xp: false })
    expect(store.player.xp).toBe(xp)
  })

  it('就寢和起床同一個時間不記（不會變成睡了 24 小時）；舊存檔裡這種紀錄讀進來時拿掉', () => {
    expect(store.logSleep(store.today, { bed: '23:00', wake: '23:00' })).toBe(false)
    expect(store.state.sleep[store.today]).toBeUndefined()
    expect(store.logSleep(store.today, { bed: '23:00', wake: '07:00' })).toBe(true)
    const snap = JSON.parse(store.exportJSON())
    snap.sleep['2026-11-01'] = { bed: '01:00', wake: '01:00', q: 3 }
    store.importJSON(JSON.stringify(snap))
    expect(store.state.sleep['2026-11-01']).toBeUndefined()
    expect(store.state.sleep[store.today]).toMatchObject({ bed: '23:00', wake: '07:00' })
  })

  it('update 類只改認得的欄位：完成狀態、id 這些改不了，值也照規則清洗', () => {
    const t = store.addTask({ title: '原本的', date: store.today })
    const xp = store.player.xp
    store.updateTask(t.id, { title: '  改名  ', done: true, rewarded: true, id: 'hack', priority: 9, tag: 'nope', at: '25:99', dur: 9999 })
    expect(t).toMatchObject({ id: expect.not.stringMatching('hack'), title: '改名', done: false, priority: 3, at: null, dur: 600 })
    expect(t.tag).not.toBe('nope')
    expect(store.player.xp).toBe(xp)
    const e = store.addEvent({ title: '會', date: store.today, start: '10:00', end: '11:00' })
    store.updateEvent(e.id, { start: '12:00', end: '11:00', done: true, color: 'x' })
    expect(e).toMatchObject({ start: '12:00', end: '13:00', done: false })
    expect(Number.isFinite(e.color)).toBe(true)
    const p = store.addProject({ name: '專案', milestones: ['一'] })
    store.updateProject(p.id, { name: '   ', milestones: [], completedAt: 1 })
    expect(p).toMatchObject({ name: '專案', completedAt: null })
    expect(p.milestones).toHaveLength(1)
  })
})

describe('壞掉的數字', () => {
  it('專注分鐘數是 NaN 或負的，經驗值和統計還是正常的數字', () => {
    store.completePomodoro(NaN)
    store.completePomodoro(-30)
    store.completePomodoro(Infinity)
    expect(Number.isFinite(store.player.xp)).toBe(true)
    expect(Number.isFinite(store.player.coins)).toBe(true)
    expect(store.stats.focusMinutes).toBe(0)
    expect(store.stats.pomodoros).toBe(3)
  })
})
