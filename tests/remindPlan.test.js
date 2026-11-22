import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, addDays } from '../src/store.js'
import { remindPlan, REMIND_MAX } from '../src/remindPlan.js'

// App 關著時交給手機排的提醒（src/remindPlan.js）：跟頁面開著時同一套規則、同一個 key
const TODAY = '2026-10-25'
const at = (date, hhmm) => {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mm] = hhmm.split(':').map(Number)
  return new Date(y, m - 1, d, h, mm).getTime()
}
let store
const plan = (opts) => remindPlan(store, Date.now(), opts)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 25, 8, 0))
  localStorage.clear()
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], events: [], player: {}, settings: { remindLead: 10, notify: true } }))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('App 關著時的提醒', () => {
  it('日程：開始前 remindLead 分鐘；排定的任務：提前一次、開始時一次；字跟頁面開著時一樣', () => {
    const e = store.addEvent({ title: '晨間會議', date: TODAY, start: '09:00', end: '10:00' })
    const t = store.addTask({ title: '寫報告', date: TODAY, at: '13:00', dur: 60 })
    expect(plan()).toEqual([
      { at: at(TODAY, '08:50'), key: `${e.id}@09:00`, date: TODAY, title: 'ひより · 晨間會議', body: '10 分鐘後開始（09:00）', tag: e.id },
      { at: at(TODAY, '12:50'), key: `${t.id}@13:00`, date: TODAY, title: 'ひより · 寫報告', body: '排定的任務・10 分鐘後開始（13:00）', tag: t.id },
      { at: at(TODAY, '13:00'), key: `${t.id}@13:00!`, date: TODAY, title: 'ひより · 寫報告', body: '排在 13:00，現在開始吧', tag: t.id },
    ])
  })

  it('不排：已經過了的、做完的、範例、匯入的行事曆、接在前一天後面的那一段、頁面提醒過的；47 小時以後的', () => {
    store.addEvent({ title: '早就過了', date: TODAY, start: '07:00', end: '07:30' })
    const done = store.addEvent({ title: '做完了', date: TODAY, start: '11:00', end: '12:00' })
    store.toggleEvent(done.id)
    const night = store.addEvent({ title: '夜車', date: TODAY, start: '23:30', end: '00:30' })
    const told = store.addEvent({ title: '提醒過了', date: TODAY, start: '15:00', end: '16:00' })
    store.addEvent({ title: '太遠', date: addDays(TODAY, 2), start: '09:00', end: '10:00' })
    store.external = [{ id: 'x-1', title: '匯入的', date: TODAY, start: '17:00', end: '18:00' }]
    const list = plan({ sent: { [TODAY]: [`${told.id}@15:00`] } })
    expect(list.map((x) => x.title)).toEqual(['ひより · 夜車'])
    expect(list[0].key).toBe(`${night.id}@23:30`)
  })

  it('例行日程：明天、後天還沒長出來的也排（id 跟之後長出來的一樣）', () => {
    const r = store.addRoutine({ kind: 'event', title: '晨跑', repeat: { type: 'daily' }, start: '06:30', end: '07:00', date: TODAY })
    const list = plan()
    const d1 = addDays(TODAY, 1)
    const d2 = addDays(TODAY, 2)
    // 今天的 06:30 已經過了；後天 06:20 還在 47 小時內
    expect(list.map((x) => [x.date, x.key])).toEqual([[d1, `${r.id}-${d1}@06:30`], [d2, `${r.id}-${d2}@06:30`]])
    // 之後長出來的那一筆是同一個 key
    store.prepareRoutines(addDays(TODAY, 1))
    expect(plan().map((x) => x.key)).toEqual(list.map((x) => x.key))
  })

  it('就寢前 30 分鐘（字由 main.js 給；沒給是不排）；關掉提醒、沒開通知、日程提醒設成不提醒就不排日程', () => {
    store.state.rhythm.bedRemind = true
    store.state.rhythm.sleep = '23:30'
    const bed = { title: 'ひより · 就寢提醒', body: '預定 23:30 就寢' }
    expect(plan({ bed }).map((x) => [x.date, x.at])).toEqual([[TODAY, at(TODAY, '23:00')], [addDays(TODAY, 1), at(addDays(TODAY, 1), '23:00')]])
    expect(plan()).toEqual([])
    store.addEvent({ title: '會', date: TODAY, start: '09:00', end: '10:00' })
    store.state.settings.remindLead = -1
    expect(plan({ bed }).map((x) => x.tag)).toEqual(['bedtime', 'bedtime'])
    store.state.settings.notify = false
    expect(plan({ bed })).toEqual([])
    store.state.settings.notify = true
    store.state.settings.remindOn = false
    expect(plan({ bed })).toEqual([])
  })

  it(`最多 ${REMIND_MAX} 則，先到的先排`, () => {
    for (let i = 0; i < 80; i++) store.addEvent({ title: `會 ${i}`, date: TODAY, start: `${String(9 + Math.floor(i / 10)).padStart(2, '0')}:${String((i % 10) * 5).padStart(2, '0')}`, end: '22:00' })
    const list = plan()
    expect(list).toHaveLength(REMIND_MAX)
    expect(list[0].title).toBe('ひより · 會 0')
  })
})
