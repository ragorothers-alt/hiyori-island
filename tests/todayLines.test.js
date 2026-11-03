// 今日總覽的一句話和問候：格式、長度、只用平假名、不重複
import { describe, expect, it } from 'vitest'
import { TODAY_QUOTES, TODAY_LEADS } from '../src/data/todayLines.js'

const KANA = /^[぀-ゟ、。ー\s]+$/
const len = (s) => [...s].length

describe('今日總覽的文案', () => {
  it('一句話 40 則，中文長度合理、日文只用平假名', () => {
    expect(TODAY_QUOTES).toHaveLength(40)
    for (const q of TODAY_QUOTES) {
      expect(len(q.zh)).toBeGreaterThanOrEqual(10)
      expect(len(q.zh)).toBeLessThanOrEqual(26)
      expect(q.ja).toMatch(KANA)
      expect(q.zh + q.ja).not.toMatch(/[!！"「」]/)
    }
  })

  it('問候依今天的狀態分五組、每組 6 則', () => {
    expect(Object.keys(TODAY_LEADS).sort()).toEqual(['done', 'empty', 'going', 'night', 'start'])
    for (const list of Object.values(TODAY_LEADS)) {
      expect(list).toHaveLength(6)
      for (const l of list) {
        expect(len(l.zh)).toBeLessThanOrEqual(24)
        expect(l.ja).toMatch(KANA)
      }
    }
  })

  it('整份沒有重複的句子', () => {
    const all = [...TODAY_QUOTES, ...Object.values(TODAY_LEADS).flat()]
    expect(new Set(all.map((x) => x.zh)).size).toBe(all.length)
    expect(new Set(all.map((x) => x.ja)).size).toBe(all.length)
  })
})
