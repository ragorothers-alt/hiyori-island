import { describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import worker from '../worker/src/index.js'
import { AI_FAILS, AI_FAILS_ALL, ipKey, CREATE_KINDS } from '../worker/src/ai.js'
import { FIELDS } from '../src/agentOps.js'
import { createD1 } from './helpers/d1.js'

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
async function call(env, body, pass = PASS, ip = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (ip) headers['cf-connecting-ip'] = ip
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

  it('每種工作的 max_tokens 照它要寫的量給', async () => {
    const c = fakeClient()
    await call(envOf(c), { task: 'coach', data: coachData })
    await call(envOf(c), { task: 'steps', data: {} })
    await call(envOf(c), { task: 'summary', data: {} })
    await call(envOf(c), { task: 'insight', data: {} })
    expect(c.create.mock.calls.map((x) => x[0].max_tokens)).toEqual([8000, 2000, 4000, 2000])
  })

  it('自主的ふじ（agent）：run 要是認得的；剛加任務時用 low、其他用 medium；輸出每一種動作都是必填的陣列或字串', async () => {
    const c = fakeClient({ out: { say: '排好了' } })
    const data = { run: 'morning', today: '2026-11-16', days: [], overdue: [], projects: [] }
    expect((await call(envOf(c), { task: 'agent', data: { ...data, run: 'poem' } })).body.error).toBe('bad data')
    expect((await call(envOf(c), { task: 'agent', data: { days: [] } })).body.error).toBe('bad data')
    const r = await call(envOf(c), { task: 'agent', data })
    expect(r.body).toEqual({ ok: true, model: 'claude-opus-5-5', out: { say: '排好了' } })
    await call(envOf(c), { task: 'agent', data: { ...data, run: 'capture' } })
    await call(envOf(c), { task: 'agent', data: { ...data, run: 'chat', message: '明天三點看牙醫' } })
    const [morning, capture, chat] = c.create.mock.calls.map((x) => x[0])
    expect([morning, capture, chat].map((p) => p.output_config.effort)).toEqual(['medium', 'low', 'medium'])
    expect(morning.max_tokens).toBe(10000)
    const schema = morning.output_config.format.schema
    expect(Object.keys(schema.properties)).toEqual(['say', 'schedule', 'add', 'steps', 'edit', 'star', 'first', 'msteps', 'next', 'remember', 'forget', 'done', 'drop', 'events', 'dates', 'ask'])
    const walk = (s) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false)
        expect(s.required).toEqual(Object.keys(s.properties))
        Object.values(s.properties).forEach(walk)
      }
      if (s.type === 'array') walk(s.items)
    }
    walk(schema)
    expect(schema.properties.add.items.properties.tag.enum).toEqual(['work', 'study', 'life', 'health', 'idea'])
    // 使用者說的話放在 <data> 裡（是資料，不是指令）；問句照 run 換
    expect(chat.messages[0].content).toContain('明天三點看牙醫')
    expect(chat.messages[0].content).toContain('回覆使用者的 message')
    expect(morning.messages[0].content).toContain('判斷現在該調整什麼')
    expect(morning.system).toContain('日程管家')
  })

  it('對話時什麼都能改：schema 多了 set、create、go（欄位名稱只寫在提示詞，不放 enum），max_tokens 給多一點；自己整理時沒有', async () => {
    const c = fakeClient({ out: { say: '好了' } })
    const data = { run: 'chat', today: '2026-11-16', days: [], overdue: [], projects: [], message: '專注改成 50 分鐘' }
    await call(envOf(c), { task: 'agent', data })
    await call(envOf(c), { task: 'agent', data: { ...data, run: 'evening' } })
    const [chat, evening] = c.create.mock.calls.map((x) => x[0])
    expect(chat.max_tokens).toBe(16000)
    expect(evening.max_tokens).toBe(10000)
    const schema = chat.output_config.format.schema
    expect(Object.keys(schema.properties).slice(-3)).toEqual(['set', 'create', 'go'])
    expect(evening.output_config.format.schema.properties).not.toHaveProperty('set')
    // 五十幾個欄位名稱寫成 enum（用兩次）時，Claude 回「compiled grammar is too large」整個拒絕
    expect(schema.properties.set.items.properties.field).toEqual({ type: 'string' })
    expect(schema.properties.create.items.properties.fields.items.properties.field).toEqual({ type: 'string' })
    expect(schema.properties.create.items.properties.kind.enum).toEqual(CREATE_KINDS)
    expect(schema.properties.go.properties.do.enum).toEqual(['', 'focus', 'open'])
    // 前端認得的每一個欄位名稱，提示詞裡都有寫到
    for (const f of FIELDS) expect(chat.system).toMatch(new RegExp(`(^|[^A-Za-z])${f}([^A-Za-z]|$)`))
    // 整份格式裡的 enum 都很短（大的 enum 會讓編出來的格式變得很大）
    const enums = []
    const collect = (s) => {
      if (s.enum) enums.push(s.enum.length)
      if (s.type === 'object') Object.values(s.properties).forEach(collect)
      if (s.type === 'array') collect(s.items)
    }
    collect(schema)
    expect(Math.max(...enums)).toBeLessThanOrEqual(CREATE_KINDS.length)
    // structured outputs 的限制：沒有 anyOf、沒有選填的欄位
    const walk = (s) => {
      expect(s).not.toHaveProperty('anyOf')
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false)
        expect(s.required).toEqual(Object.keys(s.properties))
        Object.values(s.properties).forEach(walk)
      }
      if (s.type === 'array') walk(s.items)
    }
    walk(schema)
    // 提示詞說明了每一種代號、設定和作息怎麼改
    for (const word of ['world.here', 'settings', 'rhythm', 'focusMin', 'create', 'go']) expect(chat.system).toContain(word)
  })
})

describe('濫用防護（有資料庫時）', () => {
  it('通行碼一小時內錯太多次：整個 AI 暫停，對的通行碼也先擋；過了一小時恢復', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 10))
    try {
      const c = fakeClient()
      const env = envOf(c, { DB: createD1() })
      for (let i = 0; i < AI_FAILS; i++) expect((await call(env, { task: 'ping' }, '猜猜看' + i)).status).toBe(401)
      const locked = await call(env, { task: 'ping' })
      expect(locked).toEqual({ status: 429, body: { error: 'locked' } })
      expect(c.models.retrieve).not.toHaveBeenCalled()
      vi.setSystemTime(new Date(2026, 10, 4, 11, 1))
      expect((await call(env, { task: 'ping' })).status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('照 IP 分開算：別人一直猜錯，自己的 AI 照常用；同一段 IPv6 算同一個；全部加起來太多才整個停', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 10))
    try {
      const env = envOf(fakeClient(), { DB: createD1() })
      for (let i = 0; i < AI_FAILS; i++) await call(env, { task: 'ping' }, '猜' + i, '2001:db8:1:2::' + (i + 1))
      expect((await call(env, { task: 'ping' }, PASS, '2001:db8:1:2:aaaa::9')).status).toBe(429)
      expect((await call(env, { task: 'ping' }, PASS, '203.0.113.7')).status).toBe(200)
      expect((await call(env, { task: 'ping' }, PASS, '2001:db8:1:3::1')).status).toBe(200)
      // 換很多 IP 來猜：加起來到上限就整個停
      for (let i = AI_FAILS; i < AI_FAILS_ALL; i++) await call(env, { task: 'ping' }, '猜' + i, '198.51.100.' + (i % 250))
      expect((await call(env, { task: 'ping' }, PASS, '203.0.113.7')).status).toBe(429)
    } finally {
      vi.useRealTimers()
    }
  })

  it('IPv6 只看前 64 位元，縮寫和補零都算同一段', () => {
    expect(ipKey('2001:db8:0:2::1')).toBe('2001:db8:0:2::/64')
    expect(ipKey('2001:0db8:0000:0002:ffff::')).toBe('2001:db8:0:2::/64')
    expect(ipKey('2001:db8::5')).toBe('2001:db8:0:0::/64')
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7')
    expect(ipKey(null)).toBe('unknown')
  })

  it('一天呼叫 Claude 的次數有上限；測試連線不算', async () => {
    const c = fakeClient({ out: { steps: [], tip: '' } })
    const env = envOf(c, { DB: createD1(), AI_DAILY: '2' })
    expect((await call(env, { task: 'steps', data: {} })).status).toBe(200)
    expect((await call(env, { task: 'ping' })).status).toBe(200)
    expect((await call(env, { task: 'steps', data: {} })).status).toBe(200)
    expect(await call(env, { task: 'steps', data: {} })).toEqual({ status: 429, body: { error: 'daily limit' } })
    expect(c.create).toHaveBeenCalledTimes(2)
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
    [{ content: [{ type: 'text', text: '[1, 2]' }] }, 502, 'bad output'],
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
    expect(c.create).toHaveBeenCalledTimes(1)
  })

  it('格式太大、Claude 編不出來：改成把格式寫進提示詞再問一次，之後同一份格式直接這樣問', async () => {
    const big = Anthropic.APIError.generate(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.' } },
      undefined,
      new Headers(),
    )
    // 照提示詞寫的可能前後多了字、包了 ```
    const c = fakeClient({ content: [{ type: 'text', text: '好的：\n```json\n{"steps":["列出問題"],"tip":"先從第一步"}\n```' }] })
    c.create.mockRejectedValueOnce(big)
    // 換一個模型：記著的「編不出來」照模型和格式分開，不會影響其他測試
    const body = { task: 'steps', model: 'claude-haiku-5-5', data: { milestone: '訪談' } }
    const r = await call(envOf(c), body)
    expect(r.body).toEqual({ ok: true, model: 'claude-opus-5-5', out: { steps: ['列出問題'], tip: '先從第一步' } })
    const [strict, retry] = c.create.mock.calls.map((x) => x[0])
    expect(strict.output_config.format.type).toBe('json_schema')
    expect(retry.output_config).toEqual({ effort: 'low' })
    expect(retry.system).toContain(JSON.stringify(strict.output_config.format.schema))
    expect(retry.messages).toEqual(strict.messages)
    expect(retry.max_tokens).toBe(strict.max_tokens)
    await call(envOf(c), body)
    expect(c.create).toHaveBeenCalledTimes(3)
    expect(c.create.mock.calls[2][0].output_config).toEqual({ effort: 'low' })
    // 別的模型還是先照格式問
    await call(envOf(c), { ...body, model: 'claude-sonnet-5-5' })
    expect(c.create.mock.calls[3][0].output_config.format.type).toBe('json_schema')
  })
})
