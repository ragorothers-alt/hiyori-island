import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_MODELS, aiPass, aiPassAt, setAiPass, aiShare, aiAdopt, aiReady, aiModel, aiModelAt, setAiModel, aiAdoptModel, modelFor, askAI } from '../src/ai.js'

// ふじ的 AI 通行碼和選的模型跟著線上同步帶到別台：各台用比較新設的那一個
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

describe('選的模型跟著同步走', () => {
  const [AUTO, OPUS, SONNET, HAIKU] = AI_MODELS.map((m) => m.id)

  it('沒選過模型（用預設的）不帶；選了就跟通行碼一起帶，沒設通行碼整包都不帶', () => {
    setAiPass('通行碼')
    expect(aiModel()).toBe(AUTO)
    expect(aiModelAt()).toBe(0)
    expect(aiShare()).toEqual({ aiPass: '通行碼', aiPassAt: Date.now() })
    setAiModel(SONNET)
    expect(aiShare()).toEqual({ aiPass: '通行碼', aiPassAt: Date.now(), aiModel: SONNET, aiModelAt: Date.now() })
    setAiPass('')
    expect(aiShare()).toBeNull()
    // 停用後模型的選擇還留著，重新設通行碼就接著用
    expect(aiModel()).toBe(SONNET)
  })

  it('這台沒選過：別台選的直接用；各台用比較新選的那一個，跟通行碼分開比', () => {
    setAiPass('通行碼')
    const passAt = aiPassAt()
    // 通行碼是舊的那一組（不換），模型是別台新選的（換）
    expect(aiAdopt({ aiPass: '舊的', aiPassAt: 5, aiModel: HAIKU, aiModelAt: 1000 })).toBe(false)
    expect(aiAdoptModel({ aiPass: '舊的', aiPassAt: 5, aiModel: HAIKU, aiModelAt: 1000 })).toBe(true)
    expect(aiPass()).toBe('通行碼')
    expect(aiPassAt()).toBe(passAt)
    expect(aiModel()).toBe(HAIKU)
    expect(aiModelAt()).toBe(1000)
    // 同一份再來一次、比較舊的：都不換
    expect(aiAdoptModel({ aiModel: HAIKU, aiModelAt: 1000 })).toBe(false)
    expect(aiAdoptModel({ aiModel: OPUS, aiModelAt: 999 })).toBe(false)
    expect(aiModel()).toBe(HAIKU)
    // 這台自己換了：比之前新，別台舊的蓋不回來；別台之後再換的才會
    setAiModel(SONNET)
    expect(aiModelAt()).toBe(Date.now())
    expect(aiAdoptModel({ aiModel: HAIKU, aiModelAt: 1000 })).toBe(false)
    expect(aiAdoptModel({ aiModel: OPUS, aiModelAt: Date.now() + 5 })).toBe(true)
    expect(aiModel()).toBe(OPUS)
  })

  it('別台選的剛好跟這台一樣：記下它的時間，但不算換了（不用說一聲）', () => {
    expect(aiAdoptModel({ aiModel: AUTO, aiModelAt: 700 })).toBe(false)
    expect(aiModelAt()).toBe(700)
    expect(aiAdoptModel({ aiModel: SONNET, aiModelAt: 600 })).toBe(false)
    expect(aiModel()).toBe(AUTO)
  })

  it('自動：在等著看的（對話、剛加的任務、拆細項、摘要）用 Sonnet，自己整理和週報用 Opus；選了某一種就都用它', () => {
    expect(aiModel()).toBe(AUTO)
    for (const run of ['chat', 'capture']) expect(modelFor('agent', { run })).toBe(SONNET)
    for (const run of ['morning', 'evening', 'replan', 'week']) expect(modelFor('agent', { run })).toBe(OPUS)
    expect(modelFor('steps', {})).toBe(SONNET)
    expect(modelFor('summary', {})).toBe(SONNET)
    expect(modelFor('insight', {})).toBe(OPUS)
    expect(modelFor('ping')).toBe(OPUS)
    setAiModel(HAIKU)
    expect(modelFor('agent', { run: 'morning' })).toBe(HAIKU)
    expect(modelFor('agent', { run: 'chat' })).toBe(HAIKU)
    // 以前就特地選了 Opus 的：照舊
    localStorage.setItem('hiyori-ai-model', OPUS)
    expect(modelFor('agent', { run: 'chat' })).toBe(OPUS)
  })

  it('送出去的是換好的真的模型，不是 auto', async () => {
    setAiPass('通行碼一二三四')
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, out: { say: '' } })))
    vi.stubGlobal('fetch', f)
    await askAI('agent', { run: 'chat' })
    await askAI('agent', { run: 'morning' })
    expect(f.mock.calls.map((c) => JSON.parse(c[1].body).model)).toEqual([SONNET, OPUS])
    vi.unstubAllGlobals()
  })

  it('以前選的模型沒記時間：算最舊，別台有記時間的會換過來；自己再選一次的時間一定比之前新（時鐘被調慢也一樣）', () => {
    localStorage.setItem('hiyori-ai-model', SONNET)
    expect(aiModelAt()).toBe(1)
    expect(aiAdoptModel({ aiModel: HAIKU, aiModelAt: Date.now() + 3600000 })).toBe(true)
    const at = aiModelAt()
    setAiModel(OPUS)
    expect(aiModelAt()).toBe(at + 1)
  })

  it('這一版不認得的模型、壞掉的資料不收', () => {
    setAiModel(SONNET)
    const at = aiModelAt()
    for (const x of [null, {}, { aiModel: 'claude-next-9', aiModelAt: at + 9 }, { aiModel: 7, aiModelAt: at + 9 }, { aiModel: HAIKU }, { aiModel: HAIKU, aiModelAt: 'soon' }, { aiModel: HAIKU, aiModelAt: -1 }]) {
      expect(aiAdoptModel(x)).toBe(false)
    }
    expect(aiModel()).toBe(SONNET)
    expect(aiModelAt()).toBe(at)
  })
})
