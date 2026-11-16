import { describe, it, expect } from 'vitest'
import { DEFAULT_RHYTHM } from '../src/planner.js'
import { taskHours, focusBuckets, weekdayRate, activeDays, buildInsights, mottoStats, pullStats } from '../src/insights.js'

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
    // 長期任務（專案裡沒排日期的）以前挪過幾次都不算卡住
    tasks[tasks.length - 1].ongoing = true
    expect(buildInsights({ tasks, history, habits: [], rhythm: R, today: TODAY }).some((x) => x.id === 'moved')).toBe(false)
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

  it('警語的回神紀錄：最近兩週提醒 8 次以上才說；多半本來就在做 → 建議拉長間隔；常常沒接住 → 試試只做 5 分鐘；其他照實說', () => {
    const hist = (rows) => Object.fromEntries(rows.map(([date, o]) => [date, day(o)]))
    const motto = (history, mottoEvery = 15) => buildInsights({ tasks: [], history, habits: [], rhythm: R, today: TODAY, mottoEvery }).find((x) => x.id === 'motto')
    // 兩週以前的不算；不到 8 次不說
    expect(mottoStats(hist([['2026-10-18', { nudges: 9 }], ['2026-10-19', { nudges: 3, backs: 1 }]]), TODAY)).toEqual({ nudges: 3, backs: 1, onTask: 0 })
    expect(motto(hist([['2026-10-31', { nudges: 7, onTask: 7 }]]))).toBeUndefined()
    // 10 次裡 7 次本來就在做：間隔從 15 分拉長到 20 分（已經最長了就不給按鈕）
    const busy = hist([['2026-10-31', { nudges: 6, onTask: 4, backs: 1 }], ['2026-11-01', { nudges: 4, onTask: 3 }]])
    expect(motto(busy)).toMatchObject({ title: '提醒的時候，你多半已經在做正事了', action: { kind: 'mottoEvery', value: 20, label: '改成每 20 分鐘提醒一次' } })
    expect(motto(busy, 30).action.label).toBe('改成每 1 小時提醒一次')
    expect(motto(busy, 180).action).toBeNull()
    // 10 次只回神 2 次：建議只做 5 分鐘
    const missed = hist([['2026-11-01', { nudges: 10, backs: 1, onTask: 1 }]])
    expect(motto(missed).title).toBe('提醒常常沒接住')
    expect(motto(missed).text).toMatch(/只做 5 分鐘/)
    // 其他：照實說回神了幾次、幾成（回應比提醒多的時候不超過 100%）
    const fine = hist([['2026-11-01', { nudges: 10, backs: 4, onTask: 2 }]])
    expect(motto(fine)).toMatchObject({ title: '警語幫你回神了 6 次', text: expect.stringMatching(/60%.*其中 2 次本來就在做/) })
    expect(motto(hist([['2026-11-01', { nudges: 8, backs: 12 }]])).title).toBe('警語幫你回神了 8 次')
  })

  it('想分心時最常想去做什麼：最近兩週 3 次以上才說，給對應的建議；最常想休息、倒數計時的話一鍵把一輪縮短 5 分鐘', () => {
    const hist = (rows) => Object.fromEntries(rows.map(([date, o]) => [date, day(o)]))
    const pull = (history, focusMin = 25) => buildInsights({ tasks: [], history, habits: [], rhythm: R, today: TODAY, focusMin }).find((x) => x.id === 'pull')
    // 兩週以前的、不認得的不算；不到 3 次不說
    const old = hist([['2026-10-18', { pulls: { phone: 9 } }], ['2026-10-31', { pulls: { phone: 2, nope: 7 } }]])
    expect(pullStats(old, TODAY)).toEqual({ phone: 2 })
    expect(pull(old)).toBeUndefined()
    // 最多的那個：滑手機 3 次（加起來好幾天的）
    const phone = hist([['2026-10-30', { pulls: { phone: 2, msg: 1 } }], ['2026-11-01', { pulls: { phone: 1, video: 2 } }]])
    expect(pull(phone)).toMatchObject({ kanji: '念', title: '想分心時，最常想去滑手機', text: expect.stringMatching(/^最近兩週有 3 次。專注時把手機/), action: null })
    // 最常想休息：25 分 → 20 分；已經很短（15 分）、正向計時（0）就不給按鈕
    const rest = hist([['2026-11-01', { pulls: { rest: 4 } }]])
    expect(pull(rest)).toMatchObject({ title: '想分心時，最常想去休息一下', action: { kind: 'focusMin', value: 20, label: '一輪改成 20 分鐘' } })
    expect(pull(rest, 15).action).toBeNull()
    expect(pull(rest, 0).action).toBeNull()
  })
})
