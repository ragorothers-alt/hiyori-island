import { describe, it, expect } from 'vitest'
import { streak, bestStreak, rate, cleanDays, bestClean, heat, applies, nextMilestone, todayProgress } from '../src/habits.js'

const T = '2026-10-29' // 星期四
const ts = (date, h = 12) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00`).getTime()

describe('養成習慣', () => {
  const water = { kind: 'build', target: 2, start: '2026-10-20', days: [], log: { '2026-10-26': 2, '2026-10-27': 3, '2026-10-28': 2, '2026-10-29': 1, '2026-10-22': 2 } }
  it('今天還沒做完不算中斷', () => {
    expect(streak(water, T)).toBe(3)
    expect(streak({ ...water, log: { ...water.log, [T]: 2 } }, T)).toBe(4)
  })
  it('最長連續與達成率', () => {
    expect(bestStreak(water, T)).toBe(3)
    // 10/20–10/28 共 9 天做到 4 天（今天沒做完不算）
    expect(rate(water, T, 30)).toBeCloseTo(4 / 9)
  })
  it('只在指定星期要做：中間不用做的日子不會中斷', () => {
    // 一、三、五
    const gym = { kind: 'build', target: 1, start: '2026-10-19', days: [1, 3, 5], log: { '2026-10-23': 1, '2026-10-26': 1, '2026-10-28': 1 } }
    expect(applies(gym, '2026-10-27')).toBe(false)
    expect(streak(gym, T)).toBe(3)
  })
  it('今天的進度只算要做的養成習慣', () => {
    const habits = [
      { kind: 'build', target: 1, start: '2026-10-01', days: [], log: { [T]: 1 } },
      { kind: 'build', target: 1, start: '2026-10-01', days: [1], log: {} },
      { kind: 'quit', start: '2026-10-01' },
      { kind: 'build', target: 1, start: '2026-10-01', days: [], log: {}, archived: true },
    ]
    expect(todayProgress(habits, T)).toEqual({ total: 1, done: 1 })
  })
})

describe('戒除習慣', () => {
  it('從開始或最後一次破戒起算乾淨天數', () => {
    const h = { kind: 'quit', start: '2026-10-01', slips: [] }
    expect(cleanDays(h, T)).toBe(28)
    const s = { ...h, slips: [ts('2026-10-10'), ts('2026-10-25', 23)] }
    expect(cleanDays(s, T)).toBe(4)
    expect(bestClean(s, T)).toBe(15)
    expect(cleanDays({ ...h, slips: [ts(T, 8)] }, T)).toBe(0)
  })
  it('里程碑', () => {
    expect(nextMilestone(0)).toBe(1)
    expect(nextMilestone(7)).toBe(14)
    expect(nextMilestone(400)).toBe(null)
  })
  it('熱度圖從星期一開始、標出破戒與忍住', () => {
    const h = { kind: 'quit', start: '2026-10-20', slips: [ts('2026-10-22')], urges: { '2026-10-27': 2 } }
    const cells = heat(h, T, 2)
    expect(cells).toHaveLength(14)
    expect(cells[0].date).toBe('2026-10-19')
    const at = Object.fromEntries(cells.map((c) => [c.date, c.v]))
    expect(at['2026-10-19']).toBe(null)
    expect(at['2026-10-22']).toBe('slip')
    expect(at['2026-10-27']).toBe('urge')
    expect(at['2026-10-28']).toBe(1)
    expect(at['2026-10-30']).toBe(null)
  })
})
