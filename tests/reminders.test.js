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
