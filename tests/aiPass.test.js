import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiPass, aiPassAt, setAiPass, aiShare, aiAdopt, aiReady } from '../src/ai.js'

// ふじ的 AI 通行碼跟著線上同步帶到別台：各台用比較新設的那一組
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 16, 12))
  localStorage.clear()
})

describe('AI 通行碼跟著同步走', () => {
  it('沒設通行碼不帶；設了就帶著是什麼時候設的', () => {
    expect(aiShare()).toBeNull()
    expect(aiPassAt()).toBe(0)
    setAiPass('  春天的通行碼  ')
    expect(aiShare()).toEqual({ aiPass: '春天的通行碼', aiPassAt: Date.now() })
  })

  it('這台沒設：別台的直接用；這台比較新：不換；別台比較新：換過去', () => {
    expect(aiAdopt({ aiPass: '別台的', aiPassAt: 1000 })).toBe(true)
    expect(aiPass()).toBe('別台的')
    expect(aiPassAt()).toBe(1000)
    expect(aiReady()).toBe(true)
    // 同一組再來一次、比較舊的：都不換
    expect(aiAdopt({ aiPass: '別台的', aiPassAt: 1000 })).toBe(false)
    expect(aiAdopt({ aiPass: '更舊的', aiPassAt: 500 })).toBe(false)
    expect(aiPass()).toBe('別台的')
    // 這台自己改了：比之前新，別台舊的那一組蓋不回來
    setAiPass('這台改的')
    expect(aiPassAt()).toBe(Date.now())
    expect(aiAdopt({ aiPass: '別台的', aiPassAt: 1000 })).toBe(false)
    expect(aiAdopt({ aiPass: '別台又改了', aiPassAt: Date.now() + 5 })).toBe(true)
    expect(aiPass()).toBe('別台又改了')
  })

  it('這台停用了：別台舊的那一組不會把它開回來，別台之後重設的才會', () => {
    setAiPass('原本的')
    const before = aiShare()
    vi.advanceTimersByTime(60000)
    setAiPass('')
    expect(aiReady()).toBe(false)
    expect(aiShare()).toBeNull()
    expect(aiAdopt(before)).toBe(false)
    expect(aiReady()).toBe(false)
    expect(aiAdopt({ aiPass: '重設的', aiPassAt: Date.now() + 1 })).toBe(true)
    expect(aiPass()).toBe('重設的')
  })

  it('以前設的通行碼沒記時間：算最舊，別台有記時間的會換過來；自己再設一次的時間一定比之前新（時鐘被調慢也一樣）', () => {
    localStorage.setItem('hiyori-ai-pass', '很久以前設的')
    expect(aiPassAt()).toBe(1)
    expect(aiShare()).toEqual({ aiPass: '很久以前設的', aiPassAt: 1 })
    expect(aiAdopt({ aiPass: '別台的', aiPassAt: Date.now() + 3600000 })).toBe(true)
    const at = aiPassAt()
    setAiPass('這台再設')
    expect(aiPassAt()).toBe(at + 1)
  })

  it('壞掉的資料不收', () => {
    for (const x of [null, {}, { aiPass: 5, aiPassAt: 9 }, { aiPass: '  ', aiPassAt: 9 }, { aiPass: 'x', aiPassAt: 'soon' }, { aiPass: 'x', aiPassAt: -1 }, { aiPass: 'x'.repeat(201), aiPassAt: 9 }]) {
      expect(aiAdopt(x)).toBe(false)
    }
    expect(aiPass()).toBe('')
  })
})
