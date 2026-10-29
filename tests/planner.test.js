import { describe, it, expect } from 'vitest'
import { DEFAULT_RHYTHM, rhythmBlocks, itemBlocks, findConflicts, gaps, optimizeDay, nearestSlot, sleepStats, sleepMinutes, fmtDur, planOrder } from '../src/planner.js'

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
