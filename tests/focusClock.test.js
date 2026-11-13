// 番茄鐘的計時規則：倒數、往上數、暫停、多輪、放太久
import { describe, expect, it } from 'vitest'
import { FREE_MAX, LATE, MAX_ROUNDS, breakStart, canAddRound, canExtend, counting, due, elapsedMs, extendStart, focusStart, isStale, leftMs, nextEnd, pauseToggle, restoreState, stopMinutes } from '../src/focusClock.js'

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
    // 頁面睡著時超過 3 小時、回來在下一次檢查前就按「做完了」：最多記 3 小時
    expect(stopMinutes(s, T0 + (FREE_MAX + 1) * MIN)).toBe(FREE_MAX)
    expect(stopMinutes({ ...s, ext: true }, T0 + 300 * MIN)).toBe(FREE_MAX)
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

describe('時間到了還沒做完：加時；輪數做完了還想繼續：再加一輪', () => {
  const END = T0 + 25 * MIN
  const rest = (o = {}, now = END, doneAt = END) => {
    const s = start(o)
    return { ...s, ...breakStart(s, now, doneAt) }
  }

  it('休息中才能延長，從到點那時接著往上數；做完照實際多做的分鐘記，不到 1 分鐘是 0', () => {
    const brk = rest()
    expect(brk.doneAt).toBe(END)
    expect(canExtend(brk)).toBe(true)
    expect(canExtend(start())).toBe(false)
    expect(canExtend(idle())).toBe(false)
    // 到點後 3 分鐘才按：那 3 分鐘也算
    const ext = { ...brk, ...extendStart(brk, END + 3 * MIN) }
    expect(ext).toMatchObject({ mode: 'focus', up: true, ext: true, endAt: END, paused: null, doneAt: null })
    expect(counting(ext)).toBe(true)
    expect(elapsedMs(ext, END + 3 * MIN)).toBe(3 * MIN)
    expect(stopMinutes(ext, END + 3.5 * MIN)).toBe(3)
    expect(stopMinutes(ext, END + 12.9 * MIN)).toBe(12)
    // 一般的正向計時不滿 5 分鐘是取消；加時一律是做完了
    const now = { ...brk, ...extendStart(brk, END) }
    expect(stopMinutes(now, END + 20_000)).toBe(0)
    // 加時最長也是 3 小時，到點的通知排在那時
    expect(nextEnd(ext)).toBe(END + FREE_MAX * MIN)
    expect(due(ext, END + FREE_MAX * MIN)).toEqual({ do: 'finishFocus', minutes: FREE_MAX })
  })

  it('頁面睡了很久才回來（到點超過一小時）、doneAt 壞掉：從現在開始數，不把那段都算進去', () => {
    const late = rest({}, END + 2 * LATE, END)
    expect(extendStart(late, END + 2 * LATE).endAt).toBe(END + 2 * LATE)
    expect(extendStart({ ...rest(), doneAt: null }, END + MIN).endAt).toBe(END + MIN)
    expect(extendStart({ ...rest(), doneAt: END + 9 * MIN }, END + MIN).endAt).toBe(END + MIN)
    // 自己按「做完了」的沒有排好的時間：就是現在；給了未來的時間也當現在
    expect(breakStart(start(), END).doneAt).toBe(END)
    expect(breakStart(start(), END, END + MIN).doneAt).toBe(END)
  })

  it('加時做完：回到倒數，再休息，照原本的輪數接下去；暫停、繼續照往上數的算', () => {
    const brk = rest({ rounds: 3 })
    const ext = { ...brk, ...extendStart(brk, END) }
    const p = { ...ext, ...pauseToggle(ext, END + 4 * MIN) }
    expect(p.paused).toBe(4 * MIN)
    const r = { ...p, ...pauseToggle(p, END + 30 * MIN) }
    expect(elapsedMs(r, END + 32 * MIN)).toBe(6 * MIN)
    const again = { ...r, ...breakStart(r, END + 32 * MIN) }
    expect(again).toMatchObject({ mode: 'break', up: false, ext: false, round: 1, rounds: 3, doneAt: END + 32 * MIN })
    expect(canExtend(again)).toBe(true)
    expect(due(again, END + 37 * MIN)).toEqual({ do: 'nextRound' })
    // 下一輪是倒數
    const next = { ...again, round: 2, ...focusStart(again, END + 37 * MIN) }
    expect(counting(next)).toBe(false)
    expect(leftMs(next, END + 37 * MIN)).toBe(25 * MIN)
  })

  it('正向計時做完的休息不能延長（是自己按做完的），計時方式也不變', () => {
    const s = start({ up: true })
    const brk = { ...s, ...breakStart(s, T0 + 40 * MIN) }
    expect(brk.up).toBe(true)
    expect(canExtend(brk)).toBe(false)
  })

  it('再加一輪：只有最後一輪的休息中可以，加了之後休息完自動接下一輪；最多加到上限', () => {
    const last = rest({ rounds: 2, round: 2 })
    expect(canAddRound(last)).toBe(true)
    expect(due(last, END + 5 * MIN)).toEqual({ do: 'done' })
    const more = { ...last, rounds: last.round + 1 }
    expect(due(more, END + 5 * MIN)).toEqual({ do: 'nextRound' })
    expect(canAddRound(more)).toBe(false)
    // 還有下一輪、專注中、待機：不用加
    expect(canAddRound(rest({ rounds: 3 }))).toBe(false)
    expect(canAddRound(start())).toBe(false)
    expect(canAddRound(idle())).toBe(false)
    expect(canAddRound(rest({ rounds: MAX_ROUNDS, round: MAX_ROUNDS }))).toBe(false)
    // 一次做完的（1 輪）也能加
    expect(canAddRound(rest())).toBe(true)
  })
})

describe('重新整理後接回計時', () => {
  it('好好的存檔照原樣接回來', () => {
    const saved = { mode: 'focus', endAt: 1_000_000, paused: null, taskId: 't1', projectId: 'p1', up: false, focusMin: 50, breakMin: 10, round: 2, rounds: 3, sid: 'abc-123' }
    expect(restoreState(saved)).toEqual({ ...saved, projectId: null, ext: false, doneAt: null })
    // 加時中、休息中記著上一段幾點結束的：也接得回來
    expect(restoreState({ ...saved, up: true, ext: true })).toMatchObject({ up: true, ext: true })
    expect(restoreState({ ...saved, mode: 'break', doneAt: 990_000 })).toMatchObject({ mode: 'break', doneAt: 990_000, ext: false })
    // 加了幾輪以後的輪數
    expect(restoreState({ ...saved, round: 6, rounds: 7 })).toMatchObject({ round: 6, rounds: 7 })
  })

  it('壞掉的欄位換成安全的值：長度用現在的、輪數夾在範圍裡、id 不是字串就不要', () => {
    const r = restoreState({ mode: 'break', endAt: 'x', paused: -5, taskId: 5, projectId: 'p2', up: 'yes', focusMin: NaN, breakMin: 999, round: 9, rounds: 7, sid: '<script>' }, { focusMin: 30, breakMin: 5 })
    expect(r).toEqual({ mode: 'break', endAt: 0, paused: 0, taskId: null, projectId: 'p2', up: false, ext: false, doneAt: null, focusMin: 30, breakMin: 60, round: 7, rounds: 7, sid: null })
    expect(restoreState({ rounds: 99, round: 50 })).toMatchObject({ rounds: MAX_ROUNDS, round: MAX_ROUNDS })
    // 加時的標記對不上（不是往上數、不是專注中）就不算；doneAt 壞掉也不要
    expect(restoreState({ mode: 'focus', up: false, ext: true }).ext).toBe(false)
    expect(restoreState({ mode: 'break', up: true, ext: true, doneAt: 'x' })).toMatchObject({ ext: false, doneAt: null })
    expect(restoreState({ focusMin: 9999 }).focusMin).toBe(FREE_MAX)
    expect(restoreState(null)).toMatchObject({ endAt: 0, paused: null, rounds: 1, round: 1, focusMin: 25, breakMin: 5 })
  })
})
