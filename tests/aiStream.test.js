import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import worker from '../worker/src/index.js'
import { askAI, setAiPass } from '../src/ai.js'
import { partialSay } from '../src/agent.js'

// 對話時邊寫邊送：Worker 的 askAIStream（NDJSON）→ 前端 askAI 的 onText → ふじ說的話先出來
const PASS = '春天的通行碼 2026'
const env = (client) => ({ ANTHROPIC_API_KEY: 'sk-test', AI_PASS: PASS, AI_CLIENT: client })
const msg = (text, extra = []) => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [...extra, { type: 'text', text }] })

// 假的串流：照順序送事件，finalMessage 回整份
function fakeStream(events, final, { fail = null } = {}) {
  const on = {}
  let aborted = false
  return {
    on(type, fn) {
      ;(on[type] ||= []).push(fn)
      return this
    },
    abort() {
      aborted = true
    },
    get aborted() {
      return aborted
    },
    async finalMessage() {
      for (const ev of events) {
        if (aborted) throw new Anthropic.APIUserAbortError()
        for (const fn of on.streamEvent || []) fn(ev)
        await Promise.resolve()
      }
      if (fail) throw fail
      return final
    },
  }
}
const delta = (text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
async function call(client, body) {
  const res = await worker.fetch(
    new Request('https://hiyori.test/v1/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${encodeURIComponent(PASS)}` }, body: JSON.stringify(body) }),
    env(client),
  )
  return { res, lines: (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
}

describe('Worker：邊寫邊送', () => {
  it('一小段一小段送，最後一行是整份；換成備援模型時先送 reset', async () => {
    const out = { say: '好了', schedule: [] }
    const text = JSON.stringify(out)
    const stream = vi.fn(() => fakeStream([delta('{"say":"半'), { type: 'content_block_start', index: 1, content_block: { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } } }, delta(text.slice(0, 8)), delta(text.slice(8))], msg(text, [{ type: 'text', text: '{"say":"半' }, { type: 'fallback' }])))
    const client = { messages: { create: vi.fn(), stream }, beta: { messages: { create: vi.fn(), stream } } }
    const { res, lines } = await call(client, { task: 'agent', stream: true, data: { run: 'chat', message: '嗨', days: [] } })
    expect(res.headers.get('Content-Type')).toContain('ndjson')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(lines.map((l) => l.t)).toEqual(['d', 'reset', 'd', 'd', 'end'])
    expect(lines.at(-1)).toEqual({ t: 'end', ok: true, model: 'claude-opus-5-5', out })
    // Opus 用 beta（伺服器端備援）
    expect(stream.mock.calls[0][0]).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    expect(client.messages.create).not.toHaveBeenCalled()
  })

  it('出錯寫在最後一行（已經開始送了，HTTP 狀態是 200）；通行碼不對還是一般的 401', async () => {
    const bad = Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }, undefined, new Headers())
    const client = { messages: { stream: () => fakeStream([], null, { fail: bad }) }, beta: { messages: { stream: () => fakeStream([], null, { fail: bad }) } } }
    const { lines } = await call(client, { task: 'insight', stream: true, data: {} })
    expect(lines).toEqual([{ t: 'error', error: 'claude rejected', detail: 'Your credit balance is too low' }])
    const res = await worker.fetch(new Request('https://hiyori.test/v1/ai', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' }), env(client))
    expect(res.status).toBe(401)
  })
})

describe('前端：onText', () => {
  beforeEach(() => {
    localStorage.clear()
    setAiPass('通行碼一二三四')
  })
  afterEach(() => vi.unstubAllGlobals())
  const ndjson = (lines, { cut = false } = {}) =>
    new Response(
      new ReadableStream({
        start(c) {
          const s = lines.map((l) => JSON.stringify(l)).join('\n') + (cut ? '' : '\n')
          // 故意切在奇怪的地方
          for (let i = 0; i < s.length; i += 7) c.enqueue(new TextEncoder().encode(s.slice(i, i + 7)))
          c.close()
        },
      }),
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    )

  it('照順序交出目前寫到的整段；reset 從頭；最後回整份', async () => {
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([{ t: 'd', s: '{"say":"半' }, { t: 'reset' }, { t: 'd', s: '{"say":"排好' }, { t: 'd', s: '了"}' }, { t: 'end', ok: true, model: 'm', out: { say: '排好了' } }])))
    const out = await askAI('agent', { run: 'chat' }, { onText: (t) => seen.push(t) })
    expect(out).toEqual({ say: '排好了' })
    expect(seen).toEqual(['{"say":"半', '', '{"say":"排好', '{"say":"排好了"}'])
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ task: 'agent', stream: true })
  })

  it('出錯、寫到一半斷了：丟出看得懂的錯誤；沒開始寫就擋下的照一般的錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([{ t: 'd', s: '{"say":"' }, { t: 'error', error: 'claude busy' }])))
    await expect(askAI('agent', {}, { onText: () => {} })).rejects.toMatchObject({ code: 'claude busy' })
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([{ t: 'd', s: '{"say":"' }], { cut: true })))
    await expect(askAI('agent', {}, { onText: () => {} })).rejects.toMatchObject({ code: 'cut' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'bad pass' }), { status: 401 })))
    await expect(askAI('agent', {}, { onText: () => {} })).rejects.toMatchObject({ code: 'bad pass' })
    // 沒給 onText：不要求邊寫邊送
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, out: { a: 1 } }))))
    expect(await askAI('insight', {})).toEqual({ a: 1 })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('stream')
  })
})

describe('寫到一半的 say', () => {
  it('取出目前寫到的字，跳脫字元照 JSON；還沒寫到是空的', () => {
    expect(partialSay('')).toBe('')
    expect(partialSay('{"sa')).toBe('')
    expect(partialSay('{"say":"今天')).toBe('今天')
    expect(partialSay('{ "say" : "先做\\n「寫報告」\\"')).toBe('先做\n「寫報告」"')
    expect(partialSay('{"say":"A\\u00e9B')).toBe('AéB')
    expect(partialSay('{"say":"A\\u00')).toBe('A')
    expect(partialSay('{"say":"好了","schedule":[')).toBe('好了')
    expect(partialSay('{"schedule":[],"say":"x"')).toBe('')
  })
})
