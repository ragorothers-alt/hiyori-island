// 番茄鐘的計時規則：倒數、往上數、暫停、多輪、放太久
import { describe, expect, it } from 'vitest'
import { FREE_MAX, LATE, breakStart, counting, due, elapsedMs, focusStart, isStale, leftMs, pauseToggle, stopMinutes } from '../src/focusClock.js'

const MIN = 60000
const T0 = 1_800_000_000_000
const idle = (o = {}) => ({ mode: 'idle', endAt: 0, paused: null, up: false, focusMin: 25, breakMin: 5, round: 1, rounds: 1, ...o })
const start = (o = {}, now = T0) => {
  const s = idle(o)
  return { ...s, ...focusStart(s, now) }
}

describe('番茄鐘的計時規則', () => {
  it('倒數：時間到之前繼續，到點記下設定的分鐘數；待機時顯示一整段', () => {
    expect(leftMs(idle(), T0)).toBe(25 * MIN)
    const s = start()
    expect(leftMs(s, T0 + 10 * MIN)).toBe(15 * MIN)
    expect(due(s, T0 + 24 * MIN)).toBeNull()
    expect(due(s, T0 + 25 * MIN)).toEqual({ do: 'finishFocus', minutes: 25 })
    // 開發用的很短長度：至少記 1 分鐘
    expect(due(start({ focusMin: 0.1 }), T0 + MIN)).toEqual({ do: 'finishFocus', minutes: 1 })
  })

  it('休息結束：還有下一輪就自動開始，最後一輪回到待機', () => {
    const s = start({ rounds: 3 })
    const brk = { ...s, ...breakStart(s, T0 + 25 * MIN) }
    expect(brk.mode).toBe('break')
    expect(due(brk, T0 + 29 * MIN)).toBeNull()
    expect(due(brk, T0 + 30 * MIN)).toEqual({ do: 'nextRound' })
    expect(due({ ...brk, round: 3 }, T0 + 30 * MIN)).toEqual({ do: 'done' })
  })

  it('暫停：剩下的時間停住，繼續後從剩下的接著倒數', () => {
    const s = start()
    const p = { ...s, ...pauseToggle(s, T0 + 10 * MIN) }
    expect(p.paused).toBe(15 * MIN)
    // 暫停中不會到點，也不會因為放很久而作廢
    expect(due(p, T0 + 999 * MIN)).toBeNull()
    expect(isStale(p, T0 + 999 * MIN)).toBe(false)
    const r = { ...p, ...pauseToggle(p, T0 + 60 * MIN) }
    expect(r.paused).toBeNull()
    expect(leftMs(r, T0 + 60 * MIN)).toBe(15 * MIN)
    expect(due(r, T0 + 75 * MIN)).toEqual({ do: 'finishFocus', minutes: 25 })
  })

  it('往上數：按 ■ 不滿 5 分鐘是取消，滿了照實際分鐘記；暫停會停住；3 小時自動結束', () => {
    const s = start({ up: true })
    expect(counting(s)).toBe(true)
    expect(stopMinutes(s, T0 + 4 * MIN)).toBeNull()
    expect(stopMinutes(s, T0 + 47.5 * MIN)).toBe(47)
    const p = { ...s, ...pauseToggle(s, T0 + 20 * MIN) }
    expect(elapsedMs(p, T0 + 90 * MIN)).toBe(20 * MIN)
    const r = { ...p, ...pauseToggle(p, T0 + 90 * MIN) }
    expect(elapsedMs(r, T0 + 100 * MIN)).toBe(30 * MIN)
    expect(due(s, T0 + (FREE_MAX - 1) * MIN)).toBeNull()
    expect(due(s, T0 + FREE_MAX * MIN)).toEqual({ do: 'finishFocus', minutes: FREE_MAX })
    // 倒數的 ■ 一律是取消
    expect(stopMinutes(start(), T0 + 20 * MIN)).toBeNull()
  })

  it('關掉頁面很久才回來：結束後超過一小時就作廢，不記專注', () => {
    const s = start()
    const end = T0 + 25 * MIN
    expect(due(s, end + LATE)).toEqual({ do: 'finishFocus', minutes: 25 })
    expect(due(s, end + LATE + 1)).toEqual({ do: 'expire' })
    // 往上數：從 3 小時上限算起
    const up = start({ up: true })
    expect(isStale(up, T0 + FREE_MAX * MIN + LATE)).toBe(false)
    expect(isStale(up, T0 + FREE_MAX * MIN + LATE + 1)).toBe(true)
    expect(isStale(idle(), T0 * 2)).toBe(false)
  })
})
