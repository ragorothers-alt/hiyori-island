import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TodayView } from '../src/ui/today.js'

// 今日總覽的進度圈和這週長條（_animateProg）：不建整個畫面，給它一個假的 root，記下每一段 WAAPI 動畫
let now
let made
const node = (name) => ({
  name,
  innerHTML: '',
  animate(kf, opt) {
    const a = { name, kf, opt, currentTime: null }
    made.push(a)
    return a
  },
})
// 每次重畫都是新的元素（整塊 innerHTML 換掉）
const draw = (view) => {
  const fg = node('fg')
  const pct = node('pct')
  const bar = node('bar')
  const ring = { querySelector: (s) => (s === '.fg' ? fg : s === 'b' ? pct : null) }
  view.root = {
    querySelector: (s) => (s === '.td-ring' ? ring : null),
    querySelectorAll: (s) => (s === '.td-pw-d b' ? [bar] : []),
  }
}
const at = (view, t, prog, live) => {
  now = t
  draw(view)
  view._progNow = prog
  view._animateProg(live)
}
const last = (name) => made.filter((a) => a.name === name).pop()

beforeEach(() => {
  now = 0
  made = []
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('今日總覽的進度圈和長條', () => {
  it('走到一半重畫、目標沒變：在新的元素上照原本的時間軸接著播', () => {
    const v = Object.create(TodayView.prototype)
    at(v, 0, { pct: 50, week: [100] }, null)
    const ring = last('fg')
    const bar = last('bar')
    expect(ring.currentTime).toBe(null)
    expect(bar.opt.delay).toBe(120)
    at(v, 300, { pct: 50, week: [100] }, { pct: 30, bars: [20] })
    expect(last('fg')).not.toBe(ring)
    expect(last('fg').kf).toBe(ring.kf)
    expect(last('fg').currentTime).toBe(300)
    expect(last('bar').kf).toBe(bar.kf)
    expect(last('bar').currentTime).toBe(300)
  })

  it('目標改了（差太少這次沒動）又改回原本的值：從畫面上現在的樣子重新走，不會接到舊動畫的半途', () => {
    const v = Object.create(TodayView.prototype)
    // 第一次畫：長條從 0 長到 100（先等 120ms）
    at(v, 0, { pct: 0, week: [100] }, null)
    // 還在等的時候目標變成 0：畫面上也是 0，不用動
    const n = made.length
    at(v, 50, { pct: 0, week: [0] }, { pct: 0, bars: [0] })
    expect(made.length).toBe(n)
    // 又變回 100：從現在的 0 重新長上去，不是跳到舊動畫播了 500ms 的地方
    at(v, 500, { pct: 0, week: [100] }, { pct: 0, bars: [0] })
    const bar = last('bar')
    expect(bar.currentTime).toBe(null)
    expect(bar.kf[0].height).toBe('0%')
    expect(bar.kf[1].height).toBe('100%')
  })

  it('進度圈也一樣：目標改了又改回來，從畫面上的位置重新轉', () => {
    const v = Object.create(TodayView.prototype)
    at(v, 0, { pct: 50, week: [] }, null)
    // 轉到一半目標變成 50.2（差太少不用動）
    at(v, 100, { pct: 50.2, week: [] }, { pct: 50, bars: [] })
    at(v, 400, { pct: 50, week: [] }, { pct: 50.1, bars: [] })
    // 差不到 0.3：不開新的，也不接舊的半途
    expect(made.filter((a) => a.name === 'fg').length).toBe(1)
  })
})
