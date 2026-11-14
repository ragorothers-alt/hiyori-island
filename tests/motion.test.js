import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { countUp } from '../src/ui/motion.js'

// 假的時鐘和畫面更新：frame(ms) 讓時間往前走 ms、跑一格畫面
let now
let id
let cbs
const frame = (ms) => {
  now += ms
  const run = [...cbs.values()]
  cbs.clear()
  run.forEach((cb) => cb(now))
}
const el = () => ({ innerHTML: '' })
let calm = false

beforeEach(() => {
  now = 1000
  id = 0
  cbs = new Map()
  calm = false
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb) => (cbs.set(++id, cb), id))
  vi.stubGlobal('cancelAnimationFrame', (i) => cbs.delete(i))
  vi.stubGlobal('matchMedia', () => ({ matches: calm }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('數字從原本的走到新的（countUp）', () => {
  it('照真的時間走：先快後慢，時間到就是新的數字', () => {
    const a = el()
    countUp(a, 0, 50, { dur: 900 })
    expect(a.innerHTML).toBe('0')
    frame(300)
    const mid = Number(a.innerHTML)
    expect(mid).toBeGreaterThan(25) // 先快
    expect(mid).toBeLessThan(50)
    frame(600)
    expect(a.innerHTML).toBe('50')
    expect(cbs.size).toBe(0)
  })

  it('走到一半整塊重畫、目標沒變：照原本的時間走完，寫進新的元素（不重新計時）', () => {
    const state = {}
    const a = el()
    countUp(a, 0, 50, { dur: 900, state })
    frame(450)
    const mid = a.innerHTML
    const b = el()
    countUp(b, 50, 50, { dur: 900, state })
    expect(b.innerHTML).toBe(mid)
    frame(450)
    expect(b.innerHTML).toBe('50')
    // 換掉的舊元素不再寫
    expect(a.innerHTML).toBe(mid)
  })

  it('一直重畫也走得完（以前每重畫一次就從頭計時，畫面忙的時候永遠走不到）', () => {
    const state = {}
    countUp(el(), 0, 50, { dur: 900, state })
    let last
    for (let i = 0; i < 10; i++) {
      frame(100)
      last = el()
      countUp(last, 50, 50, { dur: 900, state })
    }
    expect(last.innerHTML).toBe('50')
  })

  it('走到一半目標變了：從畫面上現在的數字接著走到新的，不先跳到上一次的終點', () => {
    const state = {}
    const a = el()
    countUp(a, 0, 50, { dur: 900, state })
    frame(300)
    const cur = a.innerHTML
    const b = el()
    countUp(b, 50, 75, { dur: 900, state, fmt: (n) => `${n}%` })
    expect(b.innerHTML).toBe(`${cur}%`)
    frame(450)
    const mid = parseInt(b.innerHTML, 10)
    expect(mid).toBeGreaterThan(Number(cur))
    expect(mid).toBeLessThan(75)
    frame(450)
    expect(b.innerHTML).toBe('75%')
  })

  it('走到一半系統改成減少動態效果：重畫時直接放結果，不再接著走', () => {
    const state = {}
    countUp(el(), 0, 100, { dur: 900, state })
    frame(300)
    calm = true
    const b = el()
    countUp(b, 100, 100, { dur: 900, state })
    expect(b.innerHTML).toBe('100')
    expect(cbs.size).toBe(0)
  })

  it('數字沒變、還沒有上一次的數字、減少動態效果：直接放結果', () => {
    const a = el()
    countUp(a, 40, 40)
    expect(a.innerHTML).toBe('40')
    const b = el()
    countUp(b, null, 30)
    expect(b.innerHTML).toBe('30')
    calm = true
    const c = el()
    countUp(c, 0, 80)
    expect(c.innerHTML).toBe('80')
    expect(cbs.size).toBe(0)
  })
})
