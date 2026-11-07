// 資料正確性的回歸測試：多分頁、拆任務、睡眠獎勵、教練的回答、跨日、提醒與壞掉的數字
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, addDays, dateStr, readBackup, DATA_VERSION } from '../src/store.js'
// 比這一版新的存檔格式
const NEXT = DATA_VERSION + 1
import { Reminders } from '../src/reminders.js'
import { planRules } from '../src/coach.js'
import { FileSync } from '../src/sync.js'

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
    const sync = new FileSync(store)
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
    store.addTask({ title: '舊分頁加的' })
    expect(store.saveNow()).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ version: NEXT, future: v3.future })
  })

  it('這邊改了資料、存檔時才發現另一邊是新版：也不蓋掉', () => {
    store.saveNow()
    writeNewer()
    store.addTask({ title: '同時改的' })
    expect(store.saveNow()).toBe(false)
    expect(store.newerApp).toBe(true)
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
    const sync = new FileSync(store)
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
