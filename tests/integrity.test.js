// 資料正確性的回歸測試：多分頁、拆任務、睡眠獎勵、教練的回答、跨日、提醒與壞掉的數字
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, addDays, dateStr, readBackup } from '../src/store.js'
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
    expect(readBackup()).toBeNull()
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
