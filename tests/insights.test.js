import { describe, it, expect } from 'vitest'
import { DEFAULT_RHYTHM } from '../src/planner.js'
import { taskHours, focusBuckets, weekdayRate, activeDays, buildInsights } from '../src/insights.js'

const TODAY = '2026-11-01'
const at = (date, h) => new Date(`${date}T${String(h).padStart(2, '0')}:10:00`).getTime()
const done = (date, h, o = {}) => ({ id: date + h, title: 't', date, done: true, doneAt: at(date, h), ...o })
const day = (o = {}) => ({ tasks: 0, focus: 0, habits: 0, focusAm: 0, focusPm: 0, focusEve: 0, focusLate: 0, ...o })
const R = { ...DEFAULT_RHYTHM, peak: 'morning' }

describe('時段分桶', () => {
  it('任務依完成時間分到早上／下午／晚上／深夜，只算最近四週、沒完成的不算', () => {
    const tasks = [done('2026-10-30', 9), done('2026-10-30', 13), done('2026-10-31', 20), done('2026-10-31', 21), done('2026-11-01', 2), done('2026-09-01', 20), { id: 'x', done: false, date: TODAY }]
    expect(taskHours(tasks, TODAY)).toEqual({ am: 1, pm: 1, eve: 2, late: 1 })
  })
  it('專注分鐘照每天的時段欄位加總', () => {
    const history = { '2026-10-31': day({ focusEve: 50, focusAm: 25 }), '2026-11-01': day({ focusEve: 25 }), '2026-09-01': day({ focusEve: 999 }) }
    expect(focusBuckets(history, TODAY)).toEqual({ am: 25, pm: 0, eve: 75, late: 0 })
  })
  it('星期幾平均完成幾件（不含今天）、有在用的日子', () => {
    const history = { '2026-10-25': day({ tasks: 4 }), '2026-10-18': day({ tasks: 2 }), '2026-10-27': day({ focus: 30 }) }
    const wr = weekdayRate(history, TODAY)
    expect(wr[0]).toBe(1.5)
    expect(wr[2]).toBe(0)
    expect(activeDays(history, TODAY)).toBe(3)
  })
})

describe('洞察', () => {
  it('資料不夠時標成推測，依作息說話', () => {
    const list = buildInsights({ tasks: [], history: {}, habits: [], rhythm: R, today: TODAY })
    expect(list.every((x) => x.guess)).toBe(true)
    expect(list[0].title).toMatch(/上午/)
  })

  it('任務多半在晚上完成、作息寫上午：建議把精神時段改成晚上；專注、星期、卡住的任務也有', () => {
    const history = {}
    const tasks = []
    for (let i = 1; i <= 10; i++) {
      const d = new Date(2026, 9, 31 - i)
      const date = `2026-10-${String(d.getDate()).padStart(2, '0')}`
      history[date] = day({ tasks: d.getDay() === 3 ? 4 : 1, focus: 50, focusEve: 50 })
      tasks.push(done(date, 20), done(date, 21))
    }
    tasks.push({ id: 'm', title: '寫期末報告', date: TODAY, done: false, moved: 3 })
    const list = buildInsights({ tasks, history, habits: [], rhythm: R, today: TODAY })
    const byId = Object.fromEntries(list.map((x) => [x.id, x]))
    expect(byId.taskHour.title).toBe('你最常在晚上完成任務')
    expect(byId.taskHour.action).toEqual({ kind: 'peak', value: 'evening', label: '把精神最好的時段改成晚上' })
    expect(byId.focusHour.title).toBe('專注最多的是晚上')
    expect(byId.weekday.title).toBe('星期三最有效率')
    expect(byId.moved.text).toMatch(/寫期末報告.*3 次/)
    expect(list.some((x) => x.guess)).toBe(false)
    // 已經是晚上就不再建議
    expect(buildInsights({ tasks, history, habits: [], rhythm: { ...R, peak: 'evening' }, today: TODAY })[0].action).toBeNull()
  })

  it('習慣：最穩的和常漏掉的', () => {
    const log = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-10-${String(31 - i).padStart(2, '0')}`, 1]))
    const habits = [
      { id: 'a', kind: 'build', name: '喝水', target: 1, start: '2026-10-02', log: log(28) },
      { id: 'b', kind: 'build', name: '伸展', target: 1, start: '2026-10-02', log: log(3) },
    ]
    const h = buildInsights({ tasks: [], history: {}, habits, rhythm: R, today: TODAY }).find((x) => x.id === 'habit')
    expect(h.title).toBe('最穩的習慣：喝水')
    expect(h.text).toMatch(/伸展/)
  })
})
