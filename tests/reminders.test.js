import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/store.js'
import { Reminders } from '../src/reminders.js'

const TODAY = '2026-10-25'
let store
let event
let callback
let reminders

function at(hour, minute, second = 0) {
  return new Date(2026, 9, 25, hour, minute, second)
}

// 不是這個分頁剛加的（同步拉回來、另一個分頁存的、開機時就在）：在另一個 Store 加好，再整份換進來
function boot(fn) {
  const other = new Store()
  const made = fn(other)
  store.importJSON(other.exportJSON())
  return made
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(at(8, 0))
  localStorage.clear()
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], player: {}, settings: { remindLead: 10 } }))
  event = store.addEvent({ title: '晨間會議', date: TODAY, start: '09:00', end: '10:00' })
  callback = vi.fn()
  reminders = new Reminders(store, callback)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('日程提醒', () => {
  it('以傳入的時間判斷，開始前十分鐘提醒一次並傳入剩餘分鐘', () => {
    // 系統鐘固定在八點，check 的傳入時間才是這次判斷的依據。
    reminders.check(at(8, 49, 59))
    expect(callback).not.toHaveBeenCalled()
    reminders.check(at(8, 50))
    expect(callback).toHaveBeenCalledExactlyOnceWith(event, 10, 'event')
    reminders.check(at(8, 55))
    reminders.check(at(9, 0))
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('提前時間窗內首次開啟時將剩餘秒數向上取整為分鐘', () => {
    reminders.check(at(8, 54, 30))
    expect(callback).toHaveBeenCalledExactlyOnceWith(event, 6, 'event')
  })

  it('修改同一日程的開始時間後，可以在新時間窗再次提醒', () => {
    reminders.check(at(8, 50))
    store.updateEvent(event.id, { start: '09:30', end: '10:30' })
    reminders.check(at(9, 19, 59))
    expect(callback).toHaveBeenCalledTimes(1)
    reminders.check(at(9, 20))
    reminders.check(at(9, 25))
    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenNthCalledWith(2, event, 10, 'event')
  })

  it('提前提醒設定為負一時不提醒', () => {
    store.setSetting('remindLead', -1)
    reminders.check(at(8, 55))
    reminders.check(at(9, 0))
    expect(callback).not.toHaveBeenCalled()
  })

  it('已完成的日程不會提醒', () => {
    store.toggleEvent(event.id)
    reminders.check(at(8, 55))
    expect(callback).not.toHaveBeenCalled()
  })

  it.each([[9, 1, 0], [9, 1, 1], [9, 30, 0]])('開始後 %i 點 %i 分 %i 秒才開啟不會補提醒', (hour, minute, second) => {
    reminders.check(at(hour, minute, second))
    expect(callback).not.toHaveBeenCalled()
  })

  it('開始後未滿一分鐘仍補提醒，剩餘分鐘不會為負數', () => {
    reminders.check(at(9, 0, 59))
    expect(callback).toHaveBeenCalledExactlyOnceWith(event, 0, 'event')
  })

  it('提前分鐘設為零時只在開始後的一分鐘內提醒', () => {
    store.setSetting('remindLead', 0)
    reminders.check(at(8, 59, 59))
    expect(callback).not.toHaveBeenCalled()
    reminders.check(at(9, 0))
    expect(callback).toHaveBeenCalledExactlyOnceWith(event, 0, 'event')
  })

  it('未傳入時間時使用被固定的系統時間', () => {
    vi.setSystemTime(at(8, 53))
    reminders.check()
    expect(callback).toHaveBeenCalledExactlyOnceWith(event, 7, 'event')
  })

  it('提醒紀錄會持久保存，重新建立提醒器後也不重複提醒', () => {
    reminders.check(at(8, 50))
    expect(JSON.parse(localStorage.getItem('hiyori-reminded'))).toEqual({
      [TODAY]: [`${event.id}@09:00`],
    })
    const afterReload = vi.fn()
    new Reminders(store, afterReload).check(at(8, 55))
    expect(afterReload).not.toHaveBeenCalled()
  })

  it('只提醒傳入日期的日程，不會提醒明天的同時段日程', () => {
    const tomorrow = store.addEvent({ title: '明日會議', date: '2026-10-26', start: '09:00', end: '10:00' })
    reminders.check(at(8, 50))
    expect(callback).toHaveBeenCalledExactlyOnceWith(event, 10, 'event')
    reminders.check(new Date(2026, 9, 26, 8, 50))
    expect(callback).toHaveBeenNthCalledWith(2, tomorrow, 10, 'event')
    expect(callback).toHaveBeenCalledTimes(2)
    // 留昨天、今天、明天（跨過午夜的就寢提醒記在昨天那份）
    expect(JSON.parse(localStorage.getItem('hiyori-reminded'))).toEqual({
      '2026-10-25': [`${event.id}@09:00`],
      '2026-10-26': [`${tomorrow.id}@09:00`],
    })
  })

  it('提醒紀錄不是合法 JSON 時仍能正常提醒', () => {
    localStorage.setItem('hiyori-reminded', '損壞的資料')
    const recovered = new Reminders(store, callback)
    expect(() => recovered.check(at(8, 50))).not.toThrow()
    expect(callback).toHaveBeenCalledExactlyOnceWith(event, 10, 'event')
  })
})

describe('里程碑期限', () => {
  function project(due) {
    const p = store.addProject({ name: '畢業專題', milestones: ['訪談整理', '寫初稿'] })
    const [m, other] = p.milestones
    store.updateMilestone(p.id, m.id, { due })
    store.addStep(p.id, m.id, '逐字稿')
    store.addStep(p.id, m.id, '歸納重點')
    store.toggleStep(p.id, m.id, m.steps[0].id)
    return { p, m, other }
  }

  it('前一天和當天早上八點後各提醒一次，帶著專案和細項進度', () => {
    const { p, m } = project('2026-10-26')
    reminders.check(at(7, 59))
    expect(callback).not.toHaveBeenCalled()
    reminders.check(at(8, 0))
    reminders.check(at(12, 0))
    const calls = callback.mock.calls.filter((c) => c[2] === 'date')
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toMatchObject({ id: m.id, title: '訪談整理', pid: p.id, projectName: '畢業專題', kind: 'milestone', steps: 2, stepsDone: 1 })
    expect(calls[0][1]).toBe(1)
    vi.setSystemTime(new Date(2026, 9, 26, 9, 0))
    store._refreshToday()
    reminders.check(new Date(2026, 9, 26, 9, 0))
    const today = callback.mock.calls.filter((c) => c[2] === 'date')
    expect(today).toHaveLength(2)
    expect(today[1][1]).toBe(0)
  })

  it('做完的、暫停專案裡的、沒設期限的都不提醒；改了期限會照新日子再提醒', () => {
    const { p, m, other } = project('2026-10-25')
    store.toggleMilestone(p.id, m.id)
    reminders.check(at(9, 0))
    expect(callback.mock.calls.filter((c) => c[2] === 'date')).toHaveLength(0)
    store.updateMilestone(p.id, other.id, { due: '2026-10-25' })
    store.pauseProject(p.id)
    reminders.check(at(9, 1))
    expect(callback.mock.calls.filter((c) => c[2] === 'date')).toHaveLength(0)
    store.pauseProject(p.id, false)
    reminders.check(at(9, 2))
    expect(callback.mock.calls.filter((c) => c[2] === 'date')).toHaveLength(1)
    store.updateMilestone(p.id, other.id, { due: '2026-10-26' })
    reminders.check(at(9, 3))
    expect(callback.mock.calls.filter((c) => c[2] === 'date')).toHaveLength(2)
  })

  it('同一天很多個期限也一個一個提醒到，不被倒數的筆數上限截掉', () => {
    const p = store.addProject({ name: '大專案', milestones: Array.from({ length: 25 }, (_, i) => `階段 ${i + 1}`) })
    for (const m of p.milestones) store.updateMilestone(p.id, m.id, { due: '2026-10-26' })
    reminders.check(at(9, 0))
    reminders.check(at(9, 1))
    expect(callback.mock.calls.filter((c) => c[2] === 'date')).toHaveLength(25)
  })

  it('倒數和日曆都看得到里程碑期限；同一天排在自己記的重要日子後面、專案截止日前面', () => {
    const { p, m } = project('2026-10-30')
    store.setDeadline(p.id, '2026-10-30')
    const exam = store.addDate({ title: '期中考', date: '2026-10-30', kind: 'exam' })
    expect(store.upcomingDates(8).map((d) => d.id)).toEqual([exam.id, m.id, p.id])
    expect(store.milestoneDues('2026-10-30').map((d) => d.id)).toEqual([m.id])
    expect(store.milestoneDues('2026-10-29')).toEqual([])
  })
})

describe('任務與就寢提醒', () => {
  it('排進時段的任務也會提醒；完成了就不提醒', () => {
    const task = store.addTask({ title: '寫報告', date: TODAY, at: '14:00', dur: 60 })
    const done = store.addTask({ title: '已完成', date: TODAY, at: '14:00' })
    store.toggleTask(done.id)
    reminders.check(at(13, 50))
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].id).toBe(task.id)
    expect(callback.mock.calls[0][0].start).toBe('14:00')
    expect(callback.mock.calls[0].slice(1)).toEqual([10, 'task'])
  })

  it('排定的任務到了開始的那一刻再說一次（taskStart）；提前提醒是 0 分鐘、錯過了提前的那一次時只說一次；日程沒有這一次', () => {
    const task = store.addTask({ title: '寫報告', date: TODAY, at: '14:00', dur: 60 })
    const kinds = () => callback.mock.calls.filter((c) => c[0].id === task.id).map((c) => [c[1], c[2]])
    reminders.check(at(13, 50))
    reminders.check(at(13, 59, 59))
    reminders.check(at(14, 0))
    reminders.check(at(14, 0, 30))
    expect(kinds()).toEqual([[10, 'task'], [0, 'taskStart']])
    // 日程（09:00 的會議）：只有提前的那一次
    reminders.check(at(9, 0))
    expect(callback.mock.calls.filter((c) => c[0].id === event.id).map((c) => c[2])).toEqual(['event'])
    // 提前提醒是 0 分鐘：開始的那一刻說一次
    localStorage.clear()
    callback.mockClear()
    store.setSetting('remindLead', 0)
    const r0 = new Reminders(store, callback)
    r0.check(at(13, 59, 30))
    r0.check(at(14, 0))
    r0.check(at(14, 0, 30))
    expect(kinds()).toEqual([[0, 'taskStart']])
    // 電腦睡著、錯過了提前的那一次：醒來時已經開始了，說一次「開始了」
    localStorage.clear()
    callback.mockClear()
    store.setSetting('remindLead', 10)
    const slept = new Reminders(store, callback)
    slept.check(at(13, 0))
    slept.check(at(14, 3))
    slept.check(at(14, 3, 30))
    expect(kinds()).toEqual([[0, 'taskStart']])
    // 做完了：不說
    localStorage.clear()
    callback.mockClear()
    store.toggleTask(task.id)
    const after = new Reminders(store, callback)
    after.check(at(14, 0))
    expect(kinds()).toEqual([])
  })

  it('排定的任務排的時間到了還沒做完（taskEnd）：到了開始 + 預估分鐘數時問一次；延長了到新的時間再問；做完了、沒有預估的不問', () => {
    const task = store.addTask({ title: '寫報告', date: TODAY, at: '14:00', dur: 30 })
    const noDur = store.addTask({ title: '回信', date: TODAY, at: '14:00' })
    const ends = () => callback.mock.calls.filter((c) => c[2] === 'taskEnd').map((c) => [c[0].id, c[0].start, c[0].dur])
    reminders.check(at(14, 0))
    reminders.check(at(14, 29, 59))
    expect(ends()).toEqual([])
    reminders.check(at(14, 30))
    reminders.check(at(14, 30, 40))
    expect(ends()).toEqual([[task.id, '14:00', 30]])
    // 「再 15 分鐘」：14:45 再問一次
    store.updateTask(task.id, { dur: 45 })
    reminders.check(at(14, 40))
    reminders.check(at(14, 45))
    expect(ends()).toEqual([[task.id, '14:00', 30], [task.id, '14:00', 45]])
    // 晚了一會兒才打開（1 分鐘後）就不吵；電腦睡著醒來時 15 分鐘內照樣問
    callback.mockClear()
    localStorage.clear()
    const late = new Reminders(store, callback)
    late.check(at(14, 47))
    expect(ends()).toEqual([])
    const slept = new Reminders(store, callback)
    localStorage.clear()
    slept.check(at(13, 0))
    slept.check(at(14, 55))
    expect(ends()).toEqual([[task.id, '14:00', 45]])
    // 做完了：不問
    callback.mockClear()
    localStorage.clear()
    store.toggleTask(task.id)
    new Reminders(store, callback).check(at(14, 45))
    expect(ends()).toEqual([])
    expect(noDur.dur ?? null).toBeNull()
  })

  it('taskEnd 跨過午夜：昨天 23:30 開始 60 分鐘的，今天 00:30 問一次（開著過午夜、沒睡著也問；記在昨天那份）；不會多說一次開始', () => {
    const night = store.addTask({ title: '趕作業', date: TODAY, at: '23:30', dur: 60 })
    const late = store.addTask({ title: '收尾', date: TODAY, at: '23:45', dur: 15 })
    const done = store.addTask({ title: '已經做完', date: TODAY, at: '23:30', dur: 60 })
    store.toggleTask(done.id)
    const next = (h, m) => new Date(2026, 9, 26, h, m)
    const ends = () => callback.mock.calls.filter((c) => c[2] === 'taskEnd').map((c) => c[0].id)
    reminders.check(at(23, 50))
    reminders.check(at(23, 59, 30))
    callback.mockClear()
    reminders.check(next(0, 0))
    expect(ends()).toEqual([late.id])
    reminders.check(next(0, 10))
    reminders.check(next(0, 29, 59))
    expect(ends()).toEqual([late.id])
    reminders.check(next(0, 30))
    reminders.check(next(0, 30, 30))
    expect(ends()).toEqual([late.id, night.id])
    // 結束以外的提醒（開始、提前）都沒有再說一次
    expect(callback.mock.calls.filter((c) => c[2] !== 'taskEnd')).toEqual([])
    // 記在昨天那份：另一個分頁不會再問一次
    const other = vi.fn()
    new Reminders(store, other).check(next(0, 30, 40))
    expect(other.mock.calls.filter((c) => c[2] === 'taskEnd')).toEqual([])
    expect(JSON.parse(localStorage.getItem('hiyori-reminded'))[TODAY]).toEqual(expect.arrayContaining([`${night.id}@23:30~60`, `${late.id}@23:45~15`]))
  })

  it('兩個分頁同時遇到剛開始的任務：開始的那一次只有一邊說（搶到提前那一次、沒搶到開始那一次的分頁不說）', () => {
    store.setSetting('remindLead', 0)
    const task = store.addTask({ title: '寫報告', date: TODAY, at: '14:00', dur: 60 })
    const a = vi.fn()
    const b = vi.fn()
    const tabA = new Reminders(store, a)
    const tabB = new Reminders(store, b)
    const claim = tabA._claim.bind(tabA)
    // A 剛搶到第一個、還沒搶第二個的時候，B 剛好檢查了一輪
    tabA._claim = (date, key) => {
      const ok = claim(date, key)
      if (ok && key === `${task.id}@14:00`) tabB.check(at(14, 0, 10))
      return ok
    }
    tabA.check(at(14, 0, 10))
    const starts = (fn) => fn.mock.calls.filter((c) => c[0].id === task.id && c[2] === 'taskStart').length
    expect(starts(a) + starts(b)).toBe(1)
    expect(a.mock.calls.length + b.mock.calls.filter((c) => c[0].id === task.id).length).toBe(1)
  })

  it('電腦睡著、過了午夜才醒來：昨天快午夜時開始的任務還在補提醒的 15 分鐘裡，照樣說開始了（記在昨天那份，不會再說一次）', () => {
    const task = store.addTask({ title: '寫日記', date: TODAY, at: '23:58', dur: 15 })
    const kinds = () => callback.mock.calls.filter((c) => c[0].id === task.id).map((c) => [c[1], c[2]])
    reminders.check(at(23, 48))
    reminders.check(at(23, 55))
    // 23:55 之後睡著，隔天 00:03 醒來
    reminders.check(new Date(2026, 9, 26, 0, 3))
    reminders.check(new Date(2026, 9, 26, 0, 3, 30))
    expect(kinds()).toEqual([[10, 'task'], [0, 'taskStart']])
    // 又睡著，00:20 醒來：排的時間（到 00:13）也過了，問一聲做完了沒（不會再說一次開始）
    reminders.check(new Date(2026, 9, 26, 0, 20))
    expect(kinds()).toEqual([[10, 'task'], [0, 'taskStart'], [0, 'taskEnd']])
    // 一直醒著過了午夜：23:58 那時就說過了，不會補第二次
    localStorage.clear()
    callback.mockClear()
    const awake = new Reminders(store, callback)
    awake.check(at(23, 57, 30))
    awake.check(at(23, 58))
    awake.check(new Date(2026, 9, 26, 0, 0, 30))
    expect(kinds()).toEqual([[1, 'task'], [0, 'taskStart']])
  })

  it('兩個分頁幾乎同時檢查：另一邊在這邊讀完紀錄之後才記下的，這邊提醒前再看一次就不響', () => {
    const a = vi.fn()
    const tabA = new Reminders(store, a)
    // 模擬 A 讀紀錄（_merge）的時候 B 還沒寫；B 在那之後提醒並記下
    tabA._merge = () => {}
    reminders.check(at(8, 50))
    tabA.check(at(8, 50))
    expect(callback).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
  })

  it('電腦睡著時開始了：醒來後 15 分鐘內補提醒；平常打開 App 只補開始後 1 分鐘內的', () => {
    const task = store.addTask({ title: '線上課', date: TODAY, at: '14:00', dur: 60 })
    // 一直開著、每 30 秒檢查：開始 2 分鐘後就不吵了
    const openCb = vi.fn()
    const open = new Reminders(store, openCb)
    open.check(at(14, 1, 30))
    open.check(at(14, 2))
    expect(openCb.mock.calls.map((c) => c[0].id)).not.toContain(task.id)
    localStorage.clear()
    // 睡著：13:00 檢查過，下一次是 14:05
    reminders.check(at(13, 0))
    reminders.check(at(14, 5))
    expect(callback.mock.calls.map((c) => c[0].id)).toContain(task.id)
    // 剛打開的 App（沒有上一次）在 14:05：不補
    localStorage.clear()
    const fresh = vi.fn()
    new Reminders(store, fresh).check(at(14, 5))
    expect(fresh.mock.calls.map((c) => c[0].id)).not.toContain(task.id)
  })

  it('就寢在午夜後（00:25）：23:55 起的提醒跨過午夜也對得上，只提醒一次', () => {
    store.setRhythm({ sleep: '00:25' })
    reminders.check(at(23, 54))
    expect(callback).not.toHaveBeenCalled()
    // 23:55 沒開著，過了午夜才打開
    reminders.check(new Date(2026, 9, 26, 0, 2))
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][2]).toBe('bed')
    reminders.check(new Date(2026, 9, 26, 0, 4))
    expect(callback).toHaveBeenCalledTimes(1)
    // 午夜前提醒過了，過了午夜也不再提醒
    const other = vi.fn()
    localStorage.clear()
    const r2 = new Reminders(store, other)
    r2.check(at(23, 58))
    r2.check(new Date(2026, 9, 26, 0, 1))
    expect(other.mock.calls.filter((c) => c[2] === 'bed')).toHaveLength(1)
  })

  it('就寢前 30 分鐘提醒一次，可以關掉；不受日程提醒設定影響', () => {
    store.setSetting('remindLead', -1)
    reminders.check(at(22, 59))
    expect(callback).not.toHaveBeenCalled()
    reminders.check(at(23, 0))
    reminders.check(at(23, 5))
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].start).toBe('23:30')
    expect(callback.mock.calls[0][2]).toBe('bed')
    store.setRhythm({ bedRemind: false, sleep: '23:45' })
    reminders.check(at(23, 16))
    expect(callback).toHaveBeenCalledTimes(1)
  })
})

describe('整天的日程', () => {
  it('前一天和第一天早上八點後各提醒一次；跨好幾天的中間不再提醒', () => {
    // 開機時就在的（這個分頁剛加的當下就記成提醒過，見下面）
    const e = boot((s) => s.addEvent({ title: '朋友來玩', date: '2026-10-26', allDay: true, endDate: '2026-10-28' }))
    const allday = () => callback.mock.calls.filter((c) => c[2] === 'allday')
    reminders.check(at(7, 59))
    expect(allday()).toHaveLength(0)
    reminders.check(at(8, 0))
    reminders.check(at(12, 0))
    expect(allday()).toHaveLength(1)
    expect(allday()[0][0].id).toBe(e.id)
    expect(allday()[0][1]).toBe(1)
    for (const [d, n] of [[26, 2], [27, 2], [28, 2]]) {
      vi.setSystemTime(new Date(2026, 9, d, 9, 0))
      store._refreshToday()
      reminders.check(new Date(2026, 9, d, 9, 0))
      expect(allday()).toHaveLength(n)
    }
    expect(allday()[1][1]).toBe(0)
  })

  it('不會被當成 00:00 開始的日程提醒；關掉日程提醒就不提醒', () => {
    store.addEvent({ title: '研習', date: TODAY, allDay: true })
    reminders.check(at(0, 0))
    expect(callback).not.toHaveBeenCalled()
    store.setSetting('remindLead', -1)
    reminders.check(at(9, 0))
    expect(callback.mock.calls.filter((c) => c[2] === 'allday')).toHaveLength(0)
  })

  it('剛加上的（上一輪檢查還沒有）不馬上提醒；重新打開 App 時已經在的照常提醒', () => {
    reminders.check(at(9, 0))
    const e = store.addEvent({ title: '朋友來玩', date: TODAY, allDay: true })
    reminders.check(at(9, 1))
    reminders.check(at(9, 2))
    expect(callback.mock.calls.filter((c) => c[2] === 'allday')).toHaveLength(0)
    // 明天的也一樣；到了當天早上才提醒
    const t = store.addEvent({ title: '旅行', date: '2026-10-26', allDay: true })
    reminders.check(at(9, 3))
    expect(callback.mock.calls.filter((c) => c[2] === 'allday')).toHaveLength(0)
    localStorage.clear()
    const fresh = vi.fn()
    new Reminders(store, fresh).check(at(9, 5))
    expect(fresh.mock.calls.filter((c) => c[2] === 'allday').map((c) => c[0].id)).toEqual([e.id, t.id])
  })

  it('剛改成整天的也不馬上提醒', () => {
    reminders.check(at(9, 0))
    const e = store.addEvent({ title: '研習', date: TODAY, start: '13:00', end: '14:00' })
    store.updateEvent(e.id, { allDay: true })
    reminders.check(at(9, 1))
    expect(callback.mock.calls.filter((c) => c[2] === 'allday')).toHaveLength(0)
  })

  it('App 一直開著過了午夜：後天的整天日程隔天早上照樣提醒「明天」', () => {
    const e = store.addEvent({ title: '旅行', date: '2026-10-27', allDay: true })
    const allday = () => callback.mock.calls.filter((c) => c[2] === 'allday')
    reminders.check(at(9, 0))
    reminders.check(at(23, 59))
    expect(allday()).toHaveLength(0)
    vi.setSystemTime(new Date(2026, 9, 26, 0, 0, 30))
    store._refreshToday()
    reminders.check(new Date(2026, 9, 26, 0, 0, 30))
    expect(allday()).toHaveLength(0)
    vi.setSystemTime(new Date(2026, 9, 26, 8, 0))
    reminders.check(new Date(2026, 9, 26, 8, 0))
    expect(allday().map((c) => [c[0].id, c[1]])).toEqual([[e.id, 1]])
  })

  it('開著 App 時從同步帶進來的整天日程照常提醒', () => {
    reminders.check(at(9, 0))
    boot((s) => s.addEvent({ title: '朋友來玩', date: '2026-10-26', allDay: true }))
    reminders.check(at(9, 1))
    expect(callback.mock.calls.filter((c) => c[2] === 'allday').map((c) => c[0].title)).toEqual(['朋友來玩'])
  })
})
describe('訂閱扣款提醒', () => {
  const subCalls = () => callback.mock.calls.filter((c) => c[2] === 'sub')
  const day = (d, h = 9) => new Date(2026, 9, d, h, 0)

  it('照提前天數，早上 8 點後第一次打開時提醒一次；同一次扣款隔天打開不會再響', () => {
    // 開機時已經在的訂閱（不是這個分頁開著時剛加的）照常提醒
    boot((s) => s.addSubscription({ name: 'Netflix', price: 390, start: '2026-10-28', remind: 3 }))
    const fresh = new Reminders(store, callback)
    vi.setSystemTime(day(25, 7))
    fresh.check(day(25, 7))
    expect(subCalls()).toHaveLength(0)
    vi.setSystemTime(day(25))
    fresh.check(day(25))
    expect(subCalls()).toHaveLength(1)
    expect(subCalls()[0][0]).toMatchObject({ date: '2026-10-28', days: 3, trial: false })
    expect(subCalls()[0][1]).toBe(3)
    fresh.check(day(25, 10))
    // 隔天、扣款當天再打開：同一次扣款不再提醒（另一個分頁也一樣）
    vi.setSystemTime(day(26))
    fresh.check(day(26))
    vi.setSystemTime(day(28))
    new Reminders(store, callback).check(day(28))
    expect(subCalls()).toHaveLength(1)
    // 下一次扣款（11/28）進到提醒天數內時再提醒
    vi.setSystemTime(new Date(2026, 10, 25, 9))
    fresh.check(new Date(2026, 10, 25, 9))
    expect(subCalls()).toHaveLength(2)
    expect(subCalls()[1][0].date).toBe('2026-11-28')
  })

  it('開著 App 時剛新增的訂閱不馬上響（畫面上已經看得到）；不提醒、取消的都不響', () => {
    vi.setSystemTime(day(25))
    reminders.check(day(25))
    store.addSubscription({ name: 'Spotify', price: 149, start: '2026-10-26', remind: 1 })
    store.addSubscription({ name: '安靜', price: 1, start: '2026-10-25', remind: -1 })
    reminders.check(day(25, 10))
    reminders.check(day(25, 11))
    expect(subCalls()).toHaveLength(0)
    const s = store.addSubscription({ name: 'KKBOX', price: 149, start: '2026-11-20', remind: 1 })
    store.cancelSubscription(s.id)
    reminders.check(day(25, 12))
    expect(subCalls()).toHaveLength(0)
  })

  it('開著 App 時從同步、另一個分頁帶進來的訂閱照常提醒（不是這邊剛加的）', () => {
    vi.setSystemTime(day(25))
    reminders.check(day(25))
    boot((s) => s.addSubscription({ name: 'Disney+', price: 270, start: '2026-10-27', remind: 3 }))
    reminders.check(day(25, 10))
    reminders.check(day(25, 11))
    expect(subCalls().map((c) => c[0].sub.name)).toEqual(['Disney+'])
  })

  it('開著過了午夜才進到提醒天數內的照常提醒，剛加的那天不響', () => {
    vi.setSystemTime(day(25))
    reminders.check(day(25))
    store.addSubscription({ name: 'YouTube', price: 199, start: '2026-10-27', remind: 1 })
    reminders.check(day(25, 10))
    expect(subCalls()).toHaveLength(0)
    vi.setSystemTime(day(26))
    reminders.check(day(26))
    expect(subCalls()).toHaveLength(1)
    expect(subCalls()[0][1]).toBe(1)
  })

  it('瀏覽器存不進去時：同一次扣款也只響一次，不會每秒響', () => {
    boot((s) => s.addSubscription({ name: 'Netflix', price: 390, start: '2026-10-26', remind: 1 }))
    const r = new Reminders(store, callback)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.setSystemTime(day(25))
    for (let i = 0; i < 5; i++) r.check(new Date(2026, 9, 25, 9, 0, i))
    expect(subCalls()).toHaveLength(1)
  })
})
