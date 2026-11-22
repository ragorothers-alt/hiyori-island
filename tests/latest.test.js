import { describe, expect, it } from 'vitest'
import { LATEST } from '../src/data/latest.js'
import { CHANGELOG } from '../src/data/changelog.js'

// 開場只載 latest.js：要跟 changelog.js 最上面那一筆一樣，不然「有新功能」的小紅點、設定裡的那一行會對不上
describe('最新一版的摘要', () => {
  it('跟更新紀錄最上面那一筆一樣（代號、日期、標題、幾項）', () => {
    const c = CHANGELOG[0]
    expect(LATEST).toEqual({ id: c.id, date: c.date, title: c.title, n: c.items.length })
  })
})
