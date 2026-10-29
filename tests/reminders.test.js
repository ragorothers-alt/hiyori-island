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
    expect(JSON.parse(localStorage.getItem('hiyori-reminded'))).toEqual({
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
