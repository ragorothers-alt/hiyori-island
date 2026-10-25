import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOWERS, RARITIES, flowerOf, rollFlower } from '../src/data/flowers.js'
import { Store } from '../src/store.js'

const base = { tag: 'work', priority: 2, star: false, pomos: 0, hour: 13, season: 'autumn', streak: 1, late: 0, perfect: false, routine: false }
const rate = (c, n = 4000) => {
  const count = { common: 0, uncommon: 0, rare: 0, legend: 0 }
  for (let i = 0; i < n; i++) count[flowerOf(rollFlower(c, 'seed' + i)).rarity]++
  for (const k in count) count[k] /= n
  return count
}

describe('花的抽選', () => {
  it('每種花都有完整資料，key 不重複', () => {
    expect(new Set(FLOWERS.map((f) => f.key)).size).toBe(FLOWERS.length)
    for (const f of FLOWERS) {
      expect(RARITIES[f.rarity]).toBeTruthy()
      expect(f.look.petals).toBeGreaterThan(0)
    }
  })

  it('同一個任務永遠開出同一朵花', () => {
    expect(rollFlower(base, 'task-1')).toBe(rollFlower(base, 'task-1'))
  })

  it('開出的花一定符合它的出現條件', () => {
    for (let i = 0; i < 500; i++) {
      const f = flowerOf(rollFlower(base, 'x' + i))
      expect(f.when(base)).toBe(true)
    }
  })

  it('稀有度機率大致是 傳說 1.5%、稀有 7%、少見 25%', () => {
    const r = rate(base)
    expect(r.legend).toBeGreaterThan(0.005)
    expect(r.legend).toBeLessThan(0.03)
    expect(r.rare).toBeGreaterThan(0.045)
    expect(r.rare).toBeLessThan(0.1)
    expect(r.uncommon).toBeGreaterThan(0.2)
    expect(r.uncommon).toBeLessThan(0.3)
  })

  it('本命任務的稀有以上機率約為兩倍', () => {
    const normal = rate(base)
    const star = rate({ ...base, star: true })
    expect(star.rare + star.legend).toBeGreaterThan((normal.rare + normal.legend) * 1.6)
  })

  it('常見花依分類決定', () => {
    const commons = new Set()
    for (let i = 0; i < 300; i++) {
      const f = flowerOf(rollFlower({ ...base, tag: 'study' }, 'c' + i))
      if (f.rarity === 'common') commons.add(f.key)
    }
    expect([...commons]).toEqual(['sumire'])
  })
})

describe('圖鑑紀錄', () => {
  let store
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 25, 12))
    localStorage.clear()
    store = new Store()
    store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0, coins: 0 } }))
  })

  it('完成任務會記下開出的花，第一次開出的品種會通知', () => {
    const onFlower = vi.fn()
    store.on('flower', onFlower)
    const t = store.addTask({ title: '寫報告', tag: 'work' })
    store.toggleTask(t.id)
    expect(flowerOf(t.flower)).toBeTruthy()
    expect(store.state.dex[t.flower]).toEqual({ at: '2026-10-25', n: 1 })
    expect(onFlower).toHaveBeenCalledWith(expect.objectContaining({ isNew: true, task: t }))
    expect(store.statsSnapshot().flowersFound).toBe(1)
  })

  it('取消再完成不會重抽，也不會重複計數', () => {
    const t = store.addTask({ title: '寫報告' })
    store.toggleTask(t.id)
    const first = t.flower
    store.toggleTask(t.id)
    store.toggleTask(t.id)
    expect(t.flower).toBe(first)
    expect(store.state.dex[first].n).toBe(1)
  })

  it('舊存檔沒有圖鑑時，用已完成任務的分類補上常見花', () => {
    store.importJSON(JSON.stringify({
      tasks: [
        { id: 'a', title: '甲', tag: 'work', done: true, date: '2026-10-20' },
        { id: 'b', title: '乙', tag: 'work', done: true, date: '2026-10-22' },
        { id: 'c', title: '丙', tag: 'idea', done: false },
      ],
      player: {},
    }))
    expect(store.state.dex).toEqual({ kikyo: { at: '2026-10-20', n: 2 } })
  })

  it('匯入的圖鑑會清掉不存在的花', () => {
    store.importJSON(JSON.stringify({ tasks: [], player: {}, dex: { kikyo: { at: '2026-10-01', n: 3 }, fake: { at: '2026-10-01', n: 1 } } }))
    expect(store.state.dex).toEqual({ kikyo: { at: '2026-10-01', n: 3 } })
  })
})
