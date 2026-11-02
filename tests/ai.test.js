import { describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import worker from '../worker/src/index.js'

// Worker 的 /v1/ai：Claude 的用戶端換成假的（env.AI_CLIENT），只檢查送出去的參數和回應的處理
const PASS = '春天的通行碼 2026'

function fakeClient(reply = {}) {
  const res = (out) => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }], ...reply })
  const create = vi.fn(async () => res(reply.out ?? {}))
  return {
    messages: { create },
    beta: { messages: { create } },
    models: { retrieve: vi.fn(async (id) => ({ id, display_name: 'Claude Opus 5.5' })) },
    create,
  }
}
const envOf = (client, extra = {}) => ({ ANTHROPIC_API_KEY: 'sk-test', AI_PASS: PASS, AI_CLIENT: client, ...extra })
async function call(env, body, pass = PASS) {
  const headers = { 'Content-Type': 'application/json' }
  if (pass != null) headers.Authorization = `Bearer ${encodeURIComponent(pass)}`
  const res = await worker.fetch(new Request('https://hiyori.test/v1/ai', { method: 'POST', headers, body: JSON.stringify(body) }), env)
  return { status: res.status, body: await res.json() }
}
const coachData = {
  days: [{ date: '2026-11-02', free: ['19:00-22:00'], busy: [] }, { date: '2026-11-03', free: ['19:00-22:00'], busy: [] }],
  focus: [{ label: '數學', tag: 'study' }, { label: '畢業專題', tag: 'work', milestone: '訪談整理' }],
  targetDays: 2, len: 50, total: null, buffer: 10, exam: null, variation: 0,
}

describe('通行碼和設定', () => {
  it('Worker 沒設金鑰或通行碼：503', async () => {
    expect((await call({ AI_PASS: PASS }, { task: 'ping' })).status).toBe(503)
    expect((await call({ ANTHROPIC_API_KEY: 'sk' }, { task: 'ping' })).status).toBe(503)
  })

  it('通行碼不對、沒帶、編碼壞掉都是 401，不會呼叫 Claude', async () => {
    const c = fakeClient()
    for (const auth of ['錯的', null]) expect((await call(envOf(c), { task: 'ping' }, auth)).body.error).toBe('bad pass')
    const res = await worker.fetch(new Request('https://hiyori.test/v1/ai', { method: 'POST', headers: { Authorization: 'Bearer %E0%A4%A' }, body: '{}' }), envOf(c))
    expect(res.status).toBe(401)
    expect(c.models.retrieve).not.toHaveBeenCalled()
  })

  it('跨網域預檢允許 Authorization 標頭', async () => {
    const res = await worker.fetch(new Request('https://hiyori.test/v1/ai', { method: 'OPTIONS' }), {})
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })

  it('測試連線只查模型，不產生文字', async () => {
    const c = fakeClient()
    const r = await call(envOf(c), { task: 'ping' })
    expect(r.body).toEqual({ ok: true, model: 'claude-opus-5-5', name: 'Claude Opus 5.5' })
    expect(c.create).not.toHaveBeenCalled()
  })

  it('沒有這種工作、資料格式不對：400', async () => {
    const c = fakeClient()
    expect((await call(envOf(c), { task: 'poem', data: {} })).body.error).toBe('bad task')
    for (const task of ['constructor', 'toString', '__proto__', ['steps'], 3]) expect((await call(envOf(c), { task, data: {} })).body.error).toBe('bad task')
    expect((await call(envOf(c), { task: 'steps', data: [1] })).body.error).toBe('bad data')
    expect((await call(envOf(c), { task: 'coach', data: { days: [], focus: [] } })).body.error).toBe('bad data')
    expect((await call(envOf(c), { task: 'coach', data: { ...coachData, focus: [{ label: 3 }] } })).body.error).toBe('bad data')
  })

  it('請求太大：413；通行碼不對時不讀內容，直接 401', async () => {
    const big = { task: 'summary', data: { text: 'あ'.repeat(50000) } }
    expect((await call(envOf(fakeClient()), big)).status).toBe(413)
    expect((await call(envOf(fakeClient()), big, '錯的')).status).toBe(401)
  })

  it('沒帶 Content-Length 的串流也會在超過上限時停下來', async () => {
    let pulled = 0
    const chunk = new Uint8Array(16384).fill(65)
    const body = new ReadableStream({
      pull(ctrl) {
        pulled++
        if (pulled > 100) ctrl.close()
        else ctrl.enqueue(chunk)
      },
    })
    const req = new Request('https://hiyori.test/v1/ai', { method: 'POST', headers: { Authorization: `Bearer ${encodeURIComponent(PASS)}` }, body, duplex: 'half' })
    const res = await worker.fetch(req, envOf(fakeClient()))
    expect(res.status).toBe(413)
    // 120 KB 上限：讀到第 8 塊（16 KB 一塊）就停了，沒有把 1.6 MB 全部讀完
    expect(pulled).toBeLessThan(12)
  })
})

describe('送給 Claude 的參數', () => {
  it('排程：日期和項目寫進 JSON schema 的 enum；Opus 開伺服器端備援', async () => {
    const out = { days: [], unplaced: 0, notes: ['先排兩天'] }
    const c = fakeClient({ out })
    const r = await call(envOf(c), { task: 'coach', data: coachData })
    expect(r.body).toEqual({ ok: true, model: 'claude-opus-5-5', out })
    const p = c.create.mock.calls[0][0]
    expect(p.model).toBe('claude-opus-5-5')
    expect(p.fallbacks).toBe('default')
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(p.output_config.effort).toBe('medium')
    const schema = p.output_config.format.schema
    expect(p.output_config.format.type).toBe('json_schema')
    expect(schema.properties.days.items.properties.date.enum).toEqual(['2026-11-02', '2026-11-03'])
    expect(schema.properties.days.items.properties.items.items.properties.label.enum).toEqual(['數學', '畢業專題'])
    // 每一層物件都要 additionalProperties: false
    const walk = (s) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false)
        expect(s.required).toEqual(Object.keys(s.properties))
        Object.values(s.properties).forEach(walk)
      }
      if (s.type === 'array') walk(s.items)
    }
    walk(schema)
    expect(p.system).toContain('ふじ')
    expect(p.messages[0].content).toContain('<data>')
    expect(p.messages[0].content).toContain('訪談整理')
  })

  it('Haiku 不帶備援；前端選的模型不在名單裡就用預設（可以用 AI_MODEL 改）', async () => {
    const c = fakeClient({ out: { steps: ['列出問題'], tip: '' } })
    await call(envOf(c), { task: 'steps', model: 'claude-haiku-5-5', data: { milestone: { title: '訪談' } } })
    expect(c.create.mock.calls[0][0]).not.toHaveProperty('fallbacks')
    expect(c.create.mock.calls[0][0]).not.toHaveProperty('betas')
    expect(c.create.mock.calls[0][0].output_config.effort).toBe('low')
    await call(envOf(c, { AI_MODEL: 'claude-sonnet-5-5' }), { task: 'steps', model: 'gpt-x', data: {} })
    expect(c.create.mock.calls[1][0].model).toBe('claude-sonnet-5-5')
    expect(c.create.mock.calls[1][0].fallbacks).toBe('default')
  })
})

describe('Claude 的回應', () => {
  it('換過備援模型：只讀最後一段文字', async () => {
    const c = fakeClient({
      content: [{ type: 'text', text: '{"steps":["半' }, { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } }, { type: 'thinking', thinking: '' }, { type: 'text', text: '{"steps":["列出問題"],"tip":"先從第一步"}' }],
    })
    const r = await call(envOf(c), { task: 'steps', data: {} })
    expect(r.body.out).toEqual({ steps: ['列出問題'], tip: '先從第一步' })
  })

  it.each([
    [{ stop_reason: 'refusal' }, 422, 'refused'],
    [{ stop_reason: 'max_tokens' }, 502, 'too long'],
    [{ content: [{ type: 'text', text: '不是 JSON' }] }, 502, 'bad output'],
  ])('%o → %i', async (reply, status, error) => {
    const r = await call(envOf(fakeClient(reply)), { task: 'insight', data: {} })
    expect(r.status).toBe(status)
    expect(r.body.error).toBe(error)
  })

  it('SDK 的錯誤換成前端看得懂的代碼', async () => {
    const err = (status, type, message) => Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers())
    const cases = [
      [err(401, 'authentication_error', 'invalid x-api-key'), 502, 'bad key'],
      [err(404, 'not_found_error', 'model'), 502, 'no model'],
      [err(429, 'rate_limit_error', 'slow down'), 429, 'claude busy'],
      [err(529, 'overloaded_error', 'busy'), 503, 'claude error'],
      [new Anthropic.APIConnectionTimeoutError(), 504, 'claude unreachable'],
    ]
    for (const [e, status, error] of cases) {
      const c = fakeClient()
      c.create.mockRejectedValueOnce(e)
      const r = await call(envOf(c), { task: 'summary', data: {} })
      expect([r.status, r.body.error]).toEqual([status, error])
    }
    const c = fakeClient()
    c.create.mockRejectedValueOnce(err(400, 'invalid_request_error', 'Your credit balance is too low'))
    const r = await call(envOf(c), { task: 'summary', data: {} })
    expect(r.body).toEqual({ error: 'claude rejected', detail: 'Your credit balance is too low' })
  })
})
