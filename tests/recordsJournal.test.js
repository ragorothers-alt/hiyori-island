import { afterEach, expect, it, vi } from 'vitest'
import { recordsMethods } from '../src/ui/recordsPage.js'
import { reviewMethods } from '../src/ui/review.js'

afterEach(() => vi.unstubAllGlobals())

it('故事和第一次開花的日子接在點到的那朵花後面；圖鑑重畫前先搬出來，沒選的時候放回圖鑑下面', () => {
  const grid = { querySelector: vi.fn(), after: vi.fn() }
  const detail = { parentElement: null }
  const flower = { nextElementSibling: null, after: vi.fn() }
  vi.stubGlobal('document', { querySelector: (k) => ({ '#dexGrid': grid, '#dexDetail': detail })[k] })
  vi.stubGlobal('CSS', { escape: (x) => x })
  grid.querySelector.mockReturnValue(flower)
  expect(reviewMethods._placeDexDetail.call({ dexSel: 'kikyo' })).toBe(detail)
  expect(grid.querySelector).toHaveBeenCalledWith('.dex-cell[data-k="kikyo"]')
  expect(flower.after).toHaveBeenCalledWith(detail)
  // 已經接在後面了：不再搬
  flower.nextElementSibling = detail
  reviewMethods._placeDexDetail.call({ dexSel: 'kikyo' })
  expect(flower.after).toHaveBeenCalledTimes(1)
  // 選的那朵不在了（或沒選）：放回圖鑑下面
  detail.parentElement = grid
  grid.querySelector.mockReturnValue(null)
  expect(reviewMethods._placeDexDetail.call({ dexSel: 'kikyo' })).toBeNull()
  expect(grid.after).toHaveBeenCalledWith(detail)
})

it('小日記先看最近十四篇，再接著看更早的，最後一頁收起按鈕', () => {
  const entries = Array.from({ length: 29 }, (_, i) => {
    const d = 29 - i
    return [`2026-10-${String(d).padStart(2, '0')}`, { mood: 'sunny', text: `日記第 ${d} 天` }]
  })
  const list = { children: [] }
  const elements = { '#journalList': list, '#journalTitle': {} }
  vi.stubGlobal('document', { querySelector: (key) => elements[key] })
  const ui = { ...recordsMethods, store: {
    journalList: (n) => entries.slice(0, n),
    lifeOn: () => ({ items: [] }),
  } }
  ui._renderJournal()
  expect(list.innerHTML).toContain('日記第 16 天')
  expect(list.innerHTML).not.toContain('日記第 15 天')
  expect(list.innerHTML).toContain('看更早的')
  ui._moreJournal()
  expect(list.innerHTML).toContain('日記第 2 天')
  expect(list.innerHTML).toContain('看更早的')
  ui._moreJournal()
  ui._renderJournal()
  expect(list.innerHTML.match(/日記第 \d+ 天/g)).toEqual(entries.map(([, j]) => j.text))
  expect(list.innerHTML).not.toContain('看更早的')
})
