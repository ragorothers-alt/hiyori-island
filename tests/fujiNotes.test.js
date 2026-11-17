import { afterEach, describe, expect, it } from 'vitest'
import { planNotes, notesHere, deviceId, NOTE_OFFSET } from '../src/fujiNotes.js'
import { DEFAULT_RHYTHM } from '../src/planner.js'

// ふじ在 App 關著時的通知：早上（起床後 30 分）、截止日的風險變差時、睡前（就寢前 30 分）
const TODAY = '2026-11-18'
const TOMORROW = '2026-11-19'
const at = (date, hh, mm = 0) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hh, mm).getTime()
}
const rhythm = { ...DEFAULT_RHYTHM, wake: '07:00', sleep: '23:30' }
function ctx({ now = at(TODAY, 20), seen = now, tasks = [], events = [], memo = {}, riskDays = [], quietUntil = 0, auto = true, r = rhythm } = {}) {
  return {
    today: TODAY, now, seen, rhythm: r, tasks, memo, riskDays, quietUntil, auto, ratio: 1,
    tasksOn: (d) => tasks.filter((t) => t.date === d),
    eventsOn: (d) => events.filter((e) => e.date === d),
  }
}
const task = (o) => ({ id: o.id || o.title, title: o.title, date: o.date, at: o.at || '', dur: o.dur || 30, priority: 2, done: !!o.done, due: o.due || '', ...o })
const kinds = (list) => list.map((n) => `${n.kind}@${new Date(n.at).toLocaleString('sv').slice(5, 16)}`)

afterEach(() => localStorage.clear())

describe('早上和睡前', () => {
  it('晚上排的：今晚睡前、明天早上、明天睡前…（照時間排，都錯開整分）', () => {
    const list = planNotes(ctx({ tasks: [task({ title: '寫報告', date: TOMORROW, at: '09:00' })] }))
    expect(kinds(list).slice(0, 3)).toEqual(['bed@11-18 23:00', 'morning@11-19 07:30', 'bed@11-19 23:00'])
    expect(list.every((n) => n.at % 60000 === NOTE_OFFSET % 60000)).toBe(true)
    const morning = list.find((n) => n.kind === 'morning')
    expect(morning.title).toBe('ふじ · 今天的安排')
    expect(morning.body).toBe('今天 1 件事，先做「寫報告」（09:00）。')
    expect(list[0].body).toContain('明天先做「寫報告」（09:00）')
  })

  it('今天早上已經打開過 App（起床前兩小時以後）：今天早上那則不送；昨晚之後還沒看過就送', () => {
    const early = at(TODAY, 6, 10)
    expect(planNotes(ctx({ now: early, seen: early })).some((n) => n.kind === 'morning' && n.at < at(TOMORROW, 0))).toBe(false)
    const night = at(TODAY, 4, 30)
    expect(planNotes(ctx({ now: early, seen: night })).find((n) => n.kind === 'morning')?.at).toBe(at(TODAY, 7, 30) + NOTE_OFFSET)
  })

  it('睡前：明天先做哪件、今天還剩幾件', () => {
    const tasks = [task({ title: 'A', date: TODAY }), task({ title: 'B', date: TODAY, done: true }), task({ title: '明天的', date: TOMORROW, first: true })]
    const bed = planNotes(ctx({ tasks })).find((n) => n.kind === 'bed')
    expect(bed.body).toBe('明天先做「明天的」。今天還有 1 件沒做完，明早我會重新排過。早點休息。')
  })

  it('沒排事情：叫你打開 App 讓ふじ排（ふじ不自己整理時換個說法）', () => {
    expect(planNotes(ctx()).find((n) => n.kind === 'morning').body).toContain('我先幫你排好')
    expect(planNotes(ctx({ auto: false })).find((n) => n.kind === 'morning').body).not.toContain('我先幫你排好')
  })

  it('開會中挪到會議結束後；挪到太晚（起床三小時以後）就不送早上那則', () => {
    const meet = [{ title: '晨會', date: TOMORROW, start: '07:15', end: '08:10' }]
    expect(planNotes(ctx({ events: meet })).find((n) => n.kind === 'morning').at).toBe(at(TOMORROW, 8, 15) + NOTE_OFFSET)
    const long = [{ title: '考試', date: TOMORROW, start: '07:00', end: '10:30' }]
    expect(planNotes(ctx({ events: long })).some((n) => n.kind === 'morning' && n.at < at(TOMORROW, 23))).toBe(false)
    // 整天的日程不算開會
    expect(planNotes(ctx({ events: [{ title: '出差', date: TOMORROW, start: '00:00', allDay: true }] })).find((n) => n.kind === 'morning').at).toBe(at(TOMORROW, 7, 30) + NOTE_OFFSET)
  })

  it('專注中的那段不送：挪到專注結束後', () => {
    const now = at(TODAY, 22, 40)
    const list = planNotes(ctx({ now, quietUntil: at(TODAY, 23, 5) }))
    expect(list[0]).toMatchObject({ kind: 'bed', at: at(TODAY, 23, 10) + NOTE_OFFSET })
  })

  it('就寢在午夜後：凌晨那一則照前一天的睡前算', () => {
    const late = { ...rhythm, sleep: '01:00' }
    const now = at(TODAY, 0, 10)
    const list = planNotes(ctx({ now, seen: now, r: late }))
    expect(kinds(list)[0]).toBe('bed@11-18 00:30')
    expect(list.find((n) => n.kind === 'morning').at).toBe(at(TODAY, 7, 30) + NOTE_OFFSET)
  })
})

describe('截止日的風險', () => {
  // 明天截止、要 10 小時的報告：今晚 20:00 起（3.5 小時）加明天一整天的空檔七成剛好放得下，很緊；明早起就來不及了
  const big = task({ id: 't-big', title: '期末報告', date: TOMORROW, dur: 600, due: TOMORROW })

  it('照現在的安排什麼時候第一次變差：很緊的現在就說（這一格還沒到就這一格），來不及的在明早 8 點', () => {
    const list = planNotes(ctx({ tasks: [big] }))
    const risks = list.filter((n) => n.kind === 'risk')
    expect(kinds(risks)).toEqual(['risk@11-18 20:00', 'risk@11-19 08:00'])
    expect(risks.map((r) => [r.due, r.level])).toEqual([[TOMORROW, 'tight'], [TOMORROW, 'late']])
    expect(risks[0]).toMatchObject({ title: 'ふじ · 截止日有點緊' })
    expect(risks[0].body).toContain('「期末報告」明天截止')
    expect(risks[1]).toMatchObject({ title: 'ふじ · 截止日來不及了' })
    expect(risks[1].body).toContain('今天截止，照現在的空檔做不完')
  })

  it('快到點時重算不會把它往後挪（20:29 和 20:30:05 算的一樣）；今天已經送過風險那則就不再排今天的', () => {
    const tight = { [TOMORROW]: 'ok' }
    const a = planNotes(ctx({ tasks: [big], memo: tight, now: at(TODAY, 20, 29) })).find((n) => n.kind === 'risk')
    const b = planNotes(ctx({ tasks: [big], memo: tight, now: at(TODAY, 20, 30) + 5000 })).find((n) => n.kind === 'risk')
    expect(a.at).toBe(at(TODAY, 20, 30) + NOTE_OFFSET)
    expect(b.at).toBe(a.at)
    expect(kinds(planNotes(ctx({ tasks: [big], riskDays: [TODAY] })).filter((n) => n.kind === 'risk'))).toEqual(['risk@11-19 08:00'])
  })

  it('最遠排到 47 小時以內（伺服器只收 48 小時內的）', () => {
    const now = at(TODAY, 20)
    const list = planNotes(ctx({ now, tasks: [big] }))
    expect(list.every((n) => n.at <= now + 47 * 3600000)).toBe(true)
    // 後天早上那則（35 小時後）還在，後天睡前那則（51 小時後）不排
    expect(kinds(list).slice(-2)).toEqual(['bed@11-19 23:00', 'morning@11-20 07:30'])
  })

  it('兩則錯開兩分鐘後過了就寢時間：那一則不送', () => {
    const meet = [{ title: '晚上的課', date: TODAY, start: '22:00', end: '23:24' }]
    const list = planNotes(ctx({ now: at(TODAY, 21, 50), tasks: [big], events: meet }))
    const tonight = list.filter((n) => n.at < at(TOMORROW, 0))
    expect(tonight).toHaveLength(1)
    expect(tonight[0].at).toBe(at(TODAY, 23, 29) + NOTE_OFFSET)
  })

  it('上一次已經說過的等級不再說；已經是來不及就都不說', () => {
    expect(kinds(planNotes(ctx({ tasks: [big], memo: { [TOMORROW]: 'tight' } })).filter((n) => n.kind === 'risk'))).toEqual(['risk@11-19 08:00'])
    expect(planNotes(ctx({ tasks: [big], memo: { [TOMORROW]: 'late' } })).some((n) => n.kind === 'risk')).toBe(false)
  })

  it('一天最多 3 則；兩則挪到同一刻時錯開兩分鐘', () => {
    // 晨會也佔掉一點空檔：9 小時 40 分的報告今晚還放得下（很緊），明早 8 點起就來不及；8 點在開會，跟早上那則一起挪到 8:15
    const meet = [{ title: '晨會', date: TOMORROW, start: '07:15', end: '08:10' }]
    const list = planNotes(ctx({ tasks: [{ ...big, dur: 580 }], events: meet, memo: { [TOMORROW]: 'tight' } }))
    const byDay = {}
    for (const n of list) {
      const d = new Date(n.at).toLocaleDateString('sv')
      byDay[d] = (byDay[d] || 0) + 1
    }
    expect(Math.max(...Object.values(byDay))).toBeLessThanOrEqual(3)
    expect(kinds(list).filter((k) => k.includes('11-19 08'))).toEqual(['morning@11-19 08:15', 'risk@11-19 08:17'])
  })
})

describe('只從一台送', () => {
  it('選了這台才送；還沒選的話手機先送；關了都不送', () => {
    expect(notesHere('', 'abcdefgh12', true)).toBe(true)
    expect(notesHere('', 'abcdefgh12', false)).toBe(false)
    expect(notesHere('abcdefgh12', 'abcdefgh12', false)).toBe(true)
    expect(notesHere('zzzzzzzz99', 'abcdefgh12', true)).toBe(false)
    expect(notesHere('off', 'abcdefgh12', true)).toBe(false)
  })
  it('這台的代號存著、每次一樣', () => {
    const a = deviceId()
    expect(a).toMatch(/^[a-z0-9]{8,24}$/)
    expect(deviceId()).toBe(a)
  })
})
