// 番茄鐘的計時規則：倒數、往上數、暫停、多輪、放太久
import { describe, expect, it } from 'vitest'
import { FLOW_MAX, FREE_MAX, LATE, MAX_ROUNDS, breakStart, canAddRound, canExtend, counting, due, elapsedMs, extMax, extendStart, finalEnd, flowStart, flowing, focusStart, isStale, leftMs, nextEnd, pauseToggle, restoreState, stopMinutes, partialMinutes } from '../src/focusClock.js'

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

describe('到點自動延長（還在心流裡就不打斷）', () => {
  const END = T0 + 25 * MIN
  const flowOn = (o = {}) => start({ flow: 30, ...o })

  it('設了自動延長的倒數：到點時不休息，原定的分鐘數照樣給；只做 5 分鐘、正向計時、加時中、沒設的不延長', () => {
    const s = flowOn()
    expect(flowing(s)).toBe(true)
    expect(due(s, END - 1)).toBeNull()
    expect(due(s, END)).toEqual({ do: 'flow', minutes: 25 })
    expect(flowing(start())).toBe(false)
    expect(flowing(flowOn({ small: true }))).toBe(false)
    expect(flowing(flowOn({ up: true }))).toBe(false)
    expect(due(flowOn({ small: true, focusMin: 5 }), T0 + 5 * MIN)).toEqual({ do: 'finishFocus', minutes: 5 })
    // 休息中、待機不算
    expect(flowing({ ...s, ...breakStart(s, END) })).toBe(false)
    expect(flowing(idle({ flow: 30 }))).toBe(false)
  })

  it('延長：從到點那時往上數，做滿上限自己結束（記延長的分鐘數）；自己按「做完了」記實際多做的', () => {
    const s = flowOn()
    const ext = { ...s, ...flowStart(s, END, 30) }
    expect(ext).toMatchObject({ mode: 'focus', up: true, ext: true, cap: 30, endAt: END, paused: null, doneAt: null })
    expect(counting(ext)).toBe(true)
    expect(extMax(ext)).toBe(30)
    expect(nextEnd(ext)).toBe(END + 30 * MIN)
    expect(due(ext, END + 29 * MIN)).toBeNull()
    expect(due(ext, END + 30 * MIN)).toEqual({ do: 'finishFocus', minutes: 30 })
    expect(stopMinutes(ext, END + 12.5 * MIN)).toBe(12)
    // 頁面睡著時超過了：最多記到上限
    expect(stopMinutes(ext, END + 50 * MIN)).toBe(30)
    // 自己按延長的（cap 是 0）最長還是 3 小時
    expect(extMax({ ...ext, cap: 0 })).toBe(FREE_MAX)
    // 延長做完：回到倒數，下一輪照樣會自動延長
    const brk = { ...ext, ...breakStart(ext, END + 10 * MIN) }
    expect(brk).toMatchObject({ mode: 'break', up: false, ext: false, cap: 0, flow: 30 })
    expect(flowing({ ...brk, round: 2, ...focusStart(brk, END + 15 * MIN) })).toBe(true)
  })

  it('到點的通知排在延長做滿的時間；放太久的判斷也從那時算起', () => {
    const s = flowOn()
    expect(nextEnd(s)).toBe(END)
    expect(finalEnd(s)).toBe(END + 30 * MIN)
    // 之後有日程、延長得比較短
    expect(finalEnd(s, 10)).toBe(END + 10 * MIN)
    expect(finalEnd(start())).toBe(END)
    expect(isStale(s, END + 30 * MIN + LATE)).toBe(false)
    expect(isStale(s, END + 30 * MIN + LATE + 1)).toBe(true)
    // 暫停中：沒有到點的時間
    expect(finalEnd({ ...s, ...pauseToggle(s, T0 + MIN) })).toBeNull()
  })

  it('重新整理後接得回來：設了幾分、延長中最多再幾分；壞掉的、不是延長中的 cap 不算', () => {
    const saved = { mode: 'focus', endAt: END, paused: null, up: true, ext: true, flow: 30, cap: 20, focusMin: 25, breakMin: 5, round: 1, rounds: 2, sid: 'abc-x' }
    expect(restoreState(saved)).toMatchObject({ ext: true, flow: 30, cap: 20, sid: 'abc-x' })
    expect(restoreState({ ...saved, up: false, ext: false })).toMatchObject({ ext: false, flow: 30, cap: 0 })
    expect(restoreState({ ...saved, flow: 'x', cap: -3 })).toMatchObject({ flow: 0, cap: 0 })
    expect(restoreState({ ...saved, flow: 999, cap: 999 })).toMatchObject({ flow: FLOW_MAX, cap: FLOW_MAX })
    expect(restoreState({ ...saved, mode: 'break', doneAt: END }).cap).toBe(0)
  })
})

describe('重新整理後接回計時', () => {
  it('好好的存檔照原樣接回來', () => {
    const saved = { mode: 'focus', endAt: 1_000_000, paused: null, taskId: 't1', projectId: 'p1', up: false, focusMin: 50, breakMin: 10, round: 2, rounds: 3, sid: 'abc-123' }
    expect(restoreState(saved)).toEqual({ ...saved, projectId: null, ext: false, doneAt: null, small: false, away: 0, detour: 0, detourRang: false, flow: 0, cap: 0 })
    // 中途離開了幾次：接著算（壞掉的是 0，取整數、最多 999）
    expect(restoreState({ ...saved, away: 2 }).away).toBe(2)
    expect(restoreState({ ...saved, away: 'x' }).away).toBe(0)
    expect(restoreState({ ...saved, away: 1.6 }).away).toBe(2)
    expect(restoreState({ ...saved, away: 5000 }).away).toBe(999)
    // 加時中、休息中記著上一段幾點結束的：也接得回來
    expect(restoreState({ ...saved, up: true, ext: true })).toMatchObject({ up: true, ext: true })
    expect(restoreState({ ...saved, mode: 'break', doneAt: 990_000 })).toMatchObject({ mode: 'break', doneAt: 990_000, ext: false })
    // 加了幾輪以後的輪數
    expect(restoreState({ ...saved, round: 6, rounds: 7 })).toMatchObject({ round: 6, rounds: 7 })
  })

  it('壞掉的欄位換成安全的值：長度用現在的、輪數夾在範圍裡、id 不是字串就不要', () => {
    const r = restoreState({ mode: 'break', endAt: 'x', paused: -5, taskId: 5, projectId: 'p2', up: 'yes', focusMin: NaN, breakMin: 999, round: 9, rounds: 7, sid: '<script>' }, { focusMin: 30, breakMin: 5 })
    expect(r).toEqual({ mode: 'break', endAt: 0, paused: 0, taskId: null, projectId: 'p2', up: false, ext: false, small: false, away: 0, detour: 0, detourRang: false, doneAt: null, focusMin: 30, breakMin: 60, round: 7, rounds: 7, sid: null, flow: 0, cap: 0 })
    expect(restoreState({ rounds: 99, round: 50 })).toMatchObject({ rounds: MAX_ROUNDS, round: MAX_ROUNDS })
    // 加時的標記對不上（不是往上數、不是專注中）就不算；doneAt 壞掉也不要
    expect(restoreState({ mode: 'focus', up: false, ext: true }).ext).toBe(false)
    expect(restoreState({ mode: 'break', up: true, ext: true, doneAt: 'x' })).toMatchObject({ ext: false, doneAt: null })
    expect(restoreState({ focusMin: 9999 }).focusMin).toBe(FREE_MAX)
    expect(restoreState(null)).toMatchObject({ endAt: 0, paused: null, rounds: 1, round: 1, focusMin: 25, breakMin: 5 })
  })

  it('限時去（去 5 分鐘就回來）：專注中記著幾點叫你回來、叫過了沒；休息中、壞掉的時間、不是 true 的不算', () => {
    const saved = { mode: 'focus', endAt: 1_000_000, paused: null, focusMin: 25, breakMin: 5, round: 1, rounds: 1, sid: 's1', detour: 1_300_000, detourRang: true }
    expect(restoreState(saved)).toMatchObject({ detour: 1_300_000, detourRang: true })
    expect(restoreState({ ...saved, detourRang: 'yes' })).toMatchObject({ detour: 1_300_000, detourRang: false })
    expect(restoreState({ ...saved, mode: 'break' })).toMatchObject({ detour: 0, detourRang: false })
    for (const bad of ['x', -5, 0, null]) expect(restoreState({ ...saved, detour: bad })).toMatchObject({ detour: 0, detourRang: false })
  })

  it('只做 5 分鐘：倒數中、休息中、到點後接著做下去（加時）都還記著；正向計時的、不是 true 的不算', () => {
    const saved = { mode: 'focus', endAt: 1_000_000, paused: null, taskId: 't1', up: false, focusMin: 5, breakMin: 5, round: 1, rounds: 1, sid: 's1', small: true }
    expect(restoreState(saved)).toMatchObject({ small: true, focusMin: 5, up: false })
    expect(restoreState({ ...saved, mode: 'break', doneAt: 990_000 }).small).toBe(true)
    expect(restoreState({ ...saved, up: true, ext: true })).toMatchObject({ small: true, ext: true })
    expect(restoreState({ ...saved, up: true }).small).toBe(false)
    expect(restoreState({ ...saved, small: 'yes' }).small).toBe(false)
    // 5 分鐘到點：照一般的倒數記 5 分鐘、接著休息（休息中可以接著做下去）
    expect(due({ ...saved, endAt: 1_000_000 }, 1_000_000)).toEqual({ do: 'finishFocus', minutes: 5 })
    expect(canExtend({ ...saved, ...breakStart(saved, 1_000_000) })).toBe(true)
  })
})

describe('倒數提早結束：已經做了幾分鐘', () => {
  const now = 1_000_000_000
  it('倒數 10 分鐘剩 1 分鐘按結束是 9 分鐘；暫停中照暫停時剩的算；往上數、加時、休息、待機是 0', () => {
    const s = { mode: 'focus', focusMin: 10, endAt: now + 60000, paused: null, up: false, ext: false }
    expect(partialMinutes(s, now)).toBe(9)
    expect(partialMinutes({ ...s, paused: 4.5 * 60000 }, now)).toBe(5)
    expect(partialMinutes({ ...s, endAt: now + 10 * 60000 - 30000 }, now)).toBe(0)
    expect(partialMinutes({ ...s, up: true }, now)).toBe(0)
    expect(partialMinutes({ ...s, ext: true }, now)).toBe(0)
    expect(partialMinutes({ ...s, mode: 'break' }, now)).toBe(0)
    expect(partialMinutes({ ...s, mode: 'idle' }, now)).toBe(0)
  })
})
