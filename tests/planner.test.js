import { describe, it, expect } from 'vitest'
import { DEFAULT_RHYTHM, rhythmBlocks, itemBlocks, findConflicts, gaps, optimizeDay, nearestSlot, sleepStats, sleepMinutes, fmtDur, planOrder, nowGuide, busyOf, firstPickIn, nextEvent } from '../src/planner.js'

const R = { ...DEFAULT_RHYTHM, buffer: 0 }
const MON = '2026-10-26'
const SAT = '2026-10-31'
const task = (id, o = {}) => ({ id, title: id, priority: 2, tag: 'life', done: false, date: MON, createdAt: 1, ...o })
const ev = (id, start, end) => ({ id, title: id, start, end, done: false })
const m = (s) => +s.slice(0, 2) * 60 + +s.slice(3)

describe('作息色帶', () => {
  it('睡眠跨午夜拆成早晚兩段、三餐、工作日才有工作時段', () => {
    const b = rhythmBlocks(R, MON)
    expect(b.filter((x) => x.kind === 'sleep').map((x) => [x.start, x.end])).toEqual([[0, 420], [1410, 1440]])
    expect(b.filter((x) => x.kind === 'meal')).toHaveLength(3)
    expect(b.some((x) => x.kind === 'work')).toBe(true)
    expect(rhythmBlocks(R, SAT).some((x) => x.kind === 'work')).toBe(false)
  })
  it('午夜後才睡：睡眠是一段', () => {
    const b = rhythmBlocks({ ...R, sleep: '01:00', wake: '08:00' }, MON).filter((x) => x.kind === 'sleep')
    expect(b.map((x) => [x.start, x.end])).toEqual([[60, 480]])
  })
})

describe('區塊與衝突', () => {
  it('任務依預估時間成為區塊，重疊會被找出', () => {
    const blocks = itemBlocks([ev('a', '10:00', '11:00'), ev('b', '13:00', '14:00')], [task('t', { at: '10:30', dur: 45 }), task('u')])
    expect(blocks.map((x) => x.id)).toEqual(['a', 't', 'b'])
    const c = findConflicts(blocks)
    expect(c.get('a')).toEqual(['t'])
    expect(c.has('b')).toBe(false)
  })
  it('空檔扣掉忙碌時間、太短的不算', () => {
    expect(gaps(600, 720, [[630, 660], [662, 690]])).toEqual([[600, 630], [690, 720]])
  })
})

describe('最佳化時程', () => {
  it('避開三餐與日程，重要的放進上午精神時段', () => {
    const tasks = [task('low', { priority: 1, dur: 30 }), task('high', { priority: 3, dur: 60, createdAt: 2 }), task('mid', { dur: 30 })]
    const r = optimizeDay({ tasks, events: [ev('meet', '09:00', '10:00')], rhythm: R, date: MON, today: MON, nowMin: 7 * 60 })
    const at = Object.fromEntries(r.plan.map((p) => [p.id, m(p.at)]))
    expect(at.high).toBeGreaterThanOrEqual(600)
    expect(at.high).toBeLessThan(720)
    // 都不和早餐（7:30–8:00）、會議（9–10）重疊
    for (const p of r.plan) {
      const a = m(p.at)
      const b = a + p.dur
      expect(a < 480 && b > 450).toBe(false)
      expect(a < 600 && b > 540).toBe(false)
    }
    // 低優先避開精神時段
    expect(at.low < 540 || at.low >= 720).toBe(true)
    expect(r.left).toEqual([])
  })

  it('本命最先排，今天從現在之後開始', () => {
    const tasks = [task('a', { dur: 30 }), task('star', { dur: 30, star: true, priority: 1 })]
    expect(planOrder(tasks, MON)[0].id).toBe('star')
    const r = optimizeDay({ tasks, events: [], rhythm: R, date: MON, today: MON, nowMin: 15 * 60 + 2 })
    expect(Math.min(...r.plan.map((p) => m(p.at)))).toBeGreaterThanOrEqual(15 * 60 + 10)
  })

  it('塞不下的回傳 left，已經排好的不動', () => {
    const tasks = [task('fixed', { at: '20:00', dur: 30 }), task('big', { dur: 300 })]
    const r = optimizeDay({ tasks, events: [], rhythm: R, date: MON, today: MON, nowMin: 21 * 60 })
    expect(r.plan).toEqual([])
    expect(r.left).toEqual(['big'])
    expect(r.endAt).toBe('20:30')
  })

  it('replan 會重排還沒開始的任務；工作任務在工作日放進工作時段', () => {
    const tasks = [task('w', { tag: 'work', at: '20:00', dur: 30 })]
    const r = optimizeDay({ tasks, events: [], rhythm: R, date: MON, today: MON, nowMin: 7 * 60, replan: true })
    const a = m(r.plan[0].at)
    expect(a).toBeGreaterThanOrEqual(540)
    expect(a).toBeLessThan(1080)
  })

  it('單一任務找最近空檔', () => {
    const s = nearestSlot({ task: task('x', { dur: 30 }), tasks: [], events: [ev('e', '13:00', '15:00')], rhythm: R, date: SAT, today: SAT, nowMin: 13 * 60 })
    expect(s.at).toBe('15:00')
  })

  it('過去的日子不排', () => {
    const r = optimizeDay({ tasks: [task('a')], events: [], rhythm: R, date: '2026-10-20', today: MON, nowMin: 600 })
    expect(r.plan).toEqual([])
  })
})

describe('睡眠', () => {
  it('跨午夜的睡眠長度與平均', () => {
    expect(sleepMinutes({ bed: '23:30', wake: '07:00' })).toBe(450)
    expect(sleepMinutes({ bed: '01:00', wake: '08:30' })).toBe(450)
    const s = sleepStats({ '2026-10-25': { bed: '23:00', wake: '07:00', q: 4 }, '2026-10-26': { bed: '01:00', wake: '08:00', q: 2 } }, MON, 7)
    expect(s.n).toBe(2)
    expect(s.avg).toBe(450)
    expect(s.bed).toBe('00:00')
    expect(s.spread).toBe(120)
    expect(s.q).toBe(3)
    expect(s.list).toHaveLength(7)
  })
  it('時間格式', () => {
    expect(fmtDur(45)).toBe('45m')
    expect(fmtDur(120)).toBe('2h')
    expect(fmtDur(95)).toBe('1h35m')
  })
})

describe('今日總覽的「現在」（nowGuide）', () => {
  const at = (nowMin, o = {}) => nowGuide({ rhythm: R, date: MON, nowMin, events: [], tasks: [], ...o })

  it('精神時段：扣掉三餐和已排的任務算剩下的空檔；眼前這段放得下的任務', () => {
    const tasks = [task('排好的', { at: '11:00', dur: 30 }), task('報告', { priority: 3, dur: 30 }), task('長的', { dur: 120 })]
    const g = at(m('10:00'), { tasks })
    expect(g.phase).toBe('peak')
    expect(g.toBed).toBe(m('23:30') - m('10:00'))
    // 10:00–11:00、11:30–12:00、13:00–18:30、19:30–23:30
    expect(g.free).toEqual([[600, 660], [690, 720], [780, 1110], [1170, 1410]])
    expect(g.freeMin).toBe(60 + 30 + 330 + 240)
    expect(g.next).toEqual({ start: 600, end: 660 })
    expect(g.fits.map((t) => t.id)).toEqual(['報告'])
    expect(g.scheduled).toEqual({ count: 1, min: 30 })
    expect(g.open).toEqual({ count: 2, min: 150 })
  })

  it('正在吃飯、開會或做排好的任務：current；空檔從結束後算', () => {
    expect(at(m('12:15')).current).toMatchObject({ kind: 'meal', title: '午餐', end: m('13:00') })
    expect(at(m('12:15')).next.start).toBe(m('13:00'))
    expect(at(m('15:10'), { events: [ev('週會', '15:00', '16:00')] }).current).toMatchObject({ kind: 'event', title: '週會' })
    expect(at(m('10:05'), { tasks: [task('寫', { at: '10:00', dur: 30 })] }).current).toMatchObject({ kind: 'task', id: '寫' })
  })

  it('午後輕的、短的先；睡前一小時和過了就寢不推任務', () => {
    const tasks = [task('重', { priority: 3, dur: 50 }), task('輕', { priority: 1, dur: 15 })]
    const dip = at(m('14:00'), { tasks })
    expect(dip.phase).toBe('dip')
    expect(dip.fits.map((t) => t.id)).toEqual(['輕', '重'])
    const wind = at(m('23:00'), { tasks })
    expect(wind.phase).toBe('windDown')
    expect(wind.fits).toEqual([])
    expect(at(m('23:45')).phase).toBe('over')
    expect(at(m('00:30')).phase).toBe('over')
    expect(at(m('06:00')).phase).toBe('early')
    expect(at(m('06:00')).freeMin).toBe(0)
  })

  it('就寢在午夜後：午夜到就寢還算前一晚', () => {
    const r = { ...R, sleep: '01:00' }
    const g = nowGuide({ rhythm: r, date: MON, nowMin: m('00:30'), events: [], tasks: [] })
    expect(g.phase).toBe('windDown')
    expect(g.bed).toBe(60)
    expect(g.toBed).toBe(30)
    expect(nowGuide({ rhythm: r, date: MON, nowMin: m('23:00'), events: [], tasks: [] }).toBed).toBe(120)
  })

  it('明天先做哪一件（firstPickIn）：就寢前 4 小時起、晚上 9 點以後、過了就寢都算；過了午夜還沒到起床時間挑的是今天這個日期', () => {
    const pick = (r, s) => firstPickIn(r, MON, m(s))
    // 23:30 就寢、07:00 起床
    expect(['18:00', '19:30', '21:00', '23:45', '00:30', '06:00'].map((s) => pick(R, s))).toEqual([null, 1, 1, 1, 0, null])
    // 02:00 才睡：晚上 9 點以後就算，午夜到就寢那段還是前一晚（挑的是今天這個日期）
    const owl = { ...R, sleep: '02:00' }
    expect(['20:30', '21:30', '01:00', '03:00', '08:00'].map((s) => pick(owl, s))).toEqual([null, 1, 0, 0, null])
    // 05:00 才睡、12:00 起床：晚上 9 點起一路到就寢都問，過了午夜不會斷掉；就寢後 4 小時內還沒睡也問，再晚就當成早起
    const late = { ...R, sleep: '05:00', wake: '12:00' }
    expect(['20:00', '21:00', '23:30', '00:00', '00:30', '01:00', '06:00', '10:00', '13:00'].map((s) => pick(late, s))).toEqual([null, 1, 1, 0, 0, 0, 0, null, null])
  })

  it('專注頁的「接下來」（nextEvent）：下一個還沒結束的日程；進行中的、會撞到這一輪的一定給，其他的 2 小時內才給', () => {
    const ev = (id, start, end, o = {}) => ({ id, title: id, start, end, ...o })
    const events = [ev('晨會', '09:00', '09:30'), ev('做完了', '10:00', '10:30', { done: true }), ev('設計週會', '10:30', '11:30'), ev('牙醫', '15:00', '15:30')]
    const at = (s, end = null) => {
      const r = nextEvent(events, m(s), end == null ? null : m(end))
      return r && `${r.event.id}|${r.now ? 'now' : 'next'}|${r.until}|${r.clash}`
    }
    // 進行中：還有幾分鐘結束
    expect(at('09:10')).toBe('晨會|now|20|false')
    // 下一個（做完的跳過）：還有幾分鐘開始；這一輪 10:55 才結束，會撞到
    expect(at('10:05')).toBe('設計週會|next|25|false')
    expect(at('10:05', '10:55')).toBe('設計週會|next|25|true')
    expect(at('10:05', '10:30')).toBe('設計週會|next|25|false')
    // 太遠的不給（2 小時剛好算）；這一輪會撞到的話再遠也給
    expect(at('12:50')).toBeNull()
    expect(at('12:50', '15:10')).toBe('牙醫|next|130|true')
    expect(at('13:00')).toBe('牙醫|next|120|false')
    // 都結束了、怪怪的資料
    expect(at('16:00')).toBeNull()
    expect(nextEvent([null, ev('x', '25:00', '26:00'), ev('壞的', 'x', '10:00')], m('09:00'))).toBeNull()
    expect(nextEvent(null, m('09:00'))).toBeNull()
  })
})

describe('已佔用的時間', () => {
  it('做完的日程和任務不佔時間（提早結束的會議、做完的任務）', () => {
    const rhythm = { ...DEFAULT_RHYTHM, buffer: 0 }
    const events = [
      { id: 'e1', start: '14:00', end: '15:00', done: false },
      { id: 'e2', start: '16:00', end: '17:00', done: true },
    ]
    const tasks = [{ id: 't1', at: '18:00', dur: 30, done: true }]
    const busy = busyOf({ rhythm, date: '2026-10-28', events, tasks })
    expect(busy).toContainEqual([840, 900])
    expect(busy).not.toContainEqual([960, 1020])
    expect(busy).not.toContainEqual([1080, 1110])
  })
})
