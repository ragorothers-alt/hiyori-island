import { beforeEach, describe, expect, it } from 'vitest'
import { reviewDraft } from '../src/ui/review.js'

// 晚間回顧改到一半、沒記下來就關掉了（點外面、之後再說、Esc）：照日期留成草稿，再打開時放回去
describe('回顧的草稿', () => {
  beforeEach(() => localStorage.clear())
  const saved = { mood: 'sunny', text: '今天整理了訪談' }

  it('改了、沒記下來：留著，下次打開拿得回來；跟記下來的一樣、或什麼都沒寫的不留', () => {
    reviewDraft.put('2026-11-22', { mood: 'sunny', text: '今天整理了訪談，明天帶備用燈' }, saved)
    expect(reviewDraft.get('2026-11-22', saved)).toEqual({ mood: 'sunny', text: '今天整理了訪談，明天帶備用燈' })
    reviewDraft.put('2026-11-22', { ...saved, text: '今天整理了訪談 ' }, saved)
    expect(reviewDraft.get('2026-11-22', saved)).toBeNull()
    reviewDraft.put('2026-11-21', { mood: null, text: '  ' }, null)
    expect(reviewDraft.get('2026-11-21', null)).toBeNull()
  })

  it('照日期分開；記下來、捨棄了就拿掉；最多留 7 份（舊的先丟）', () => {
    reviewDraft.put('2026-11-22', { mood: 'rain', text: 'A' }, null)
    reviewDraft.put('2026-11-21', { mood: null, text: 'B' }, null)
    expect(reviewDraft.get('2026-11-21', null)).toEqual({ mood: null, text: 'B' })
    reviewDraft.drop('2026-11-22')
    expect(reviewDraft.get('2026-11-22', null)).toBeNull()
    for (let i = 1; i <= 9; i++) reviewDraft.put(`2026-10-0${i}`, { mood: null, text: `第 ${i} 份` }, null)
    expect(Object.keys(reviewDraft.all())).toHaveLength(7)
  })

  it('別的小島（重置、匯入之前那一份）寫到一半的不會拿到這一份；存不進去時回傳 false', () => {
    expect(reviewDraft.put('2026-11-22', { mood: 'rain', text: '舊島的私事' }, null, 'gen-a')).toBe(true)
    expect(reviewDraft.get('2026-11-22', null, 'gen-b')).toBeNull()
    expect(reviewDraft.get('2026-11-22', null, 'gen-a')).toEqual({ mood: 'rain', text: '舊島的私事' })
    const setItem = localStorage.setItem
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      expect(reviewDraft.put('2026-11-21', { mood: 'rain', text: '帶備用燈' }, null, 'gen-a')).toBe(false)
    } finally {
      localStorage.setItem = setItem
    }
  })

  it('存的東西壞掉了也不會讓回顧打不開', () => {
    localStorage.setItem('hiyori-review-draft', '{壞掉')
    expect(reviewDraft.get('2026-11-22', saved)).toBeNull()
    localStorage.setItem('hiyori-review-draft', JSON.stringify({ '2026-11-22': 'x' }))
    expect(reviewDraft.get('2026-11-22', saved)).toBeNull()
  })
})
