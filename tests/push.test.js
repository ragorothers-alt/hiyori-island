// 計時器到點的推播：伺服器（worker/src/push.js）排程和簽章、前端（src/push.js）什麼時候排、什麼時候取消
import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { PushHub } from '../worker/src/index.js'
import { MAX_AFTER, checkEndpoint } from '../worker/src/push.js'
import { LOG_FILE, PLAN_CACHE, PLAN_FILE, SHOWN_FILE, TimerPush, answerLooking, timerNotice, timerTag } from '../src/push.js'
import { FREE_MAX, focusStart, breakStart, nextEnd, pauseToggle } from '../src/focusClock.js'
import { createD1 } from './helpers/d1.js'

const NOW = Date.UTC(2026, 10, 10, 4)
const MIN = 60000
const API = 'https://hiyori-sync.example.workers.dev'
const ENDPOINT = 'https://web.push.apple.com/QOabc123'
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

// 假的 Durable Object：每個名字一個 PushHub，各自的儲存和 alarm
function fakeEnv(extra = {}) {
  const objs = new Map()
  const env = {
    ...extra,
    PUSH: {
      idFromName: (name) => name,
      get(name) {
        if (!objs.has(name)) {
          const map = new Map()
          const state = {
            alarm: null,
            storage: {
              get: async (k) => map.get(k),
              put: async (k, v) => void map.set(k, v),
              delete: async (k) => map.delete(k),
              deleteAll: async () => map.clear(),
              setAlarm: async (at) => void (state.alarm = at),
              deleteAlarm: async () => void (state.alarm = null),
            },
          }
          objs.set(name, { state, map, hub: new PushHub(state, env) })
        }
        return { fetch: (url, init) => objs.get(name).hub.fetch(new Request(url, init)) }
      },
    },
  }
  // 排著的計時器（不含保管金鑰的那一個）
  const timers = () => [...objs.entries()].filter(([name, o]) => name !== 'vapid' && o.map.has('timer')).map(([, o]) => o)
  return { env, objs, timers }
}
const post = async (env, path, body) => {
  const res = await worker.fetch(new Request(API + path, { method: 'POST', body: JSON.stringify(body) }), env)
  return { status: res.status, ...(await res.json()) }
}

describe('推播的伺服器', () => {
  let ctx
  let sent
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    ctx = fakeEnv()
    sent = []
    globalThis.fetch = async (url, init) => {
      sent.push({ url, ...init })
      return new Response(null, { status: 201 })
    }
    return () => vi.useRealTimers()
  })

  it('公鑰第一次用到時自己產生，之後一直是同一把（同時來好幾個請求也是）', async () => {
    const [a, b, c] = await Promise.all([post(ctx.env, '/v1/push/key', {}), post(ctx.env, '/v1/push/key', {}), post(ctx.env, '/v1/push/key', {})])
    expect(a.status).toBe(200)
    // 沒壓縮的 P-256 公鑰：65 個位元組，0x04 開頭
    expect(unb64u(a.key)).toHaveLength(65)
    expect(unb64u(a.key)[0]).toBe(4)
    expect([b.key, c.key]).toEqual([a.key, a.key])
    // 物件被收掉重建（記憶體裡的沒了）：讀存著的那一把
    const o = ctx.objs.get('vapid')
    expect((await (await new PushHub(o.state, ctx.env).fetch(new Request('https://push/key', { method: 'POST', body: '{}' }))).json()).key).toBe(a.key)
  })

  it('排一則：到點送出沒有內容的推播，帶著驗得過的 VAPID 簽章；送完就清掉', async () => {
    const r = await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: 25 * MIN })
    expect(r).toMatchObject({ status: 200, ok: true })
    const [t] = ctx.timers()
    expect(t.state.alarm).toBe(NOW + 25 * MIN)
    expect(sent).toEqual([])

    vi.setSystemTime(t.state.alarm)
    await t.hub.alarm()
    expect(sent).toHaveLength(1)
    const [req] = sent
    expect(req.url).toBe(ENDPOINT)
    expect(req.method).toBe('POST')
    expect(req.body).toBeUndefined()
    // 不跟著轉址：只打檢查過的那個網址
    expect(req.redirect).toBe('manual')
    expect(req.headers.TTL).toBe('600')
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(req.headers.Authorization)
    expect(m).toBeTruthy()
    const [, head, claims, sig, k] = m
    expect(k).toBe(r.key)
    expect(JSON.parse(new TextDecoder().decode(unb64u(head)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    // aud 是推播服務的網址、sub 是這個 Worker 自己的網址，一小時後過期
    expect(JSON.parse(new TextDecoder().decode(unb64u(claims)))).toEqual({ aud: 'https://web.push.apple.com', exp: Math.floor(Date.now() / 1000) + 3600, sub: API })
    const pub = await crypto.subtle.importKey('raw', unb64u(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(sig), new TextEncoder().encode(`${head}.${claims}`))).toBe(true)

    // 送完整個清空；同一個 alarm 再響一次不會再送
    expect(t.map.size).toBe(0)
    await t.hub.alarm()
    expect(sent).toHaveLength(1)
  })

  it('一台裝置同時只排一則：再排一次換成新的時間，取消後到點什麼都不送', async () => {
    await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: 25 * MIN })
    await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: 5 * MIN })
    expect(ctx.timers().map((t) => t.state.alarm)).toEqual([NOW + 5 * MIN])
    const [t] = ctx.timers()
    expect((await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: null })).ok).toBe(true)
    expect(ctx.timers()).toEqual([])
    expect(t.state.alarm).toBeNull()
    expect(t.map.size).toBe(0)
    await t.hub.alarm()
    expect(sent).toEqual([])
    // 另一台裝置有自己的一則
    await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: MIN })
    await post(ctx.env, '/v1/push/timer', { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', after: 2 * MIN })
    expect(ctx.timers().map((x) => x.state.alarm).sort()).toEqual([NOW + MIN, NOW + 2 * MIN])
  })

  it('網址加上不同的 # 還是同一台裝置：不能多排，也取消得掉', async () => {
    for (const hash of ['#one', '#two', '']) await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT + hash, after: MIN })
    expect(ctx.timers()).toHaveLength(1)
    expect(ctx.timers()[0].map.get('timer').endpoint).toBe(ENDPOINT)
    await post(ctx.env, '/v1/push/timer', { endpoint: `${ENDPOINT}#three`, after: null })
    expect(ctx.timers()).toEqual([])
  })

  it('只送到瀏覽器廠商的推播服務，時間也有範圍', async () => {
    for (const ok of [ENDPOINT, 'https://fcm.googleapis.com/fcm/send/a:b', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-sg2p.notify.windows.com/w/?token=x']) {
      expect(checkEndpoint(ok)).toBe(ok)
    }
    const bad = [
      'http://web.push.apple.com/x',
      'https://example.com/x',
      'https://web.push.apple.com.evil.test/x',
      'https://evilpush.apple.com.test/',
      'https://user:pw@web.push.apple.com/x',
      'https://web.push.apple.com:8443/x',
      'https://web.push.apple.com./x',
      'https://fcm.googleapis.com.evil.test/x',
      'https://[::1]/x',
      'https://127.0.0.1/x',
      `https://web.push.apple.com/${'x'.repeat(2100)}`,
      '',
      null,
      42,
    ]
    for (const endpoint of bad) expect((await post(ctx.env, '/v1/push/timer', { endpoint, after: MIN })).status, String(endpoint).slice(0, 60)).toBe(400)
    for (const after of [0, 999, -5, 1.5, '60000', MAX_AFTER + 1, true]) {
      expect((await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after })).status, String(after)).toBe(400)
    }
    expect(ctx.timers()).toEqual([])
    expect((await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: MAX_AFTER })).status).toBe(200)
  })

  it('一天排的則數有上限（取消不算，隨時都收）；隔天重新算', async () => {
    ctx = fakeEnv({ DB: createD1(), PUSH_DAILY: '3' })
    for (let i = 0; i < 3; i++) expect((await post(ctx.env, '/v1/push/timer', { endpoint: `${ENDPOINT}${i}`, after: MIN })).status).toBe(200)
    expect((await post(ctx.env, '/v1/push/timer', { endpoint: `${ENDPOINT}x`, after: MIN })).status).toBe(429)
    expect(ctx.timers()).toHaveLength(3)
    expect((await post(ctx.env, '/v1/push/timer', { endpoint: `${ENDPOINT}0`, after: null })).status).toBe(200)
    expect(ctx.timers()).toHaveLength(2)
    vi.setSystemTime(NOW + 25 * 3600_000)
    expect((await post(ctx.env, '/v1/push/timer', { endpoint: `${ENDPOINT}x`, after: MIN })).status).toBe(200)
  })

  it('推播服務暫時出錯：馬上多試一次，還是不行就留著紀錄等 alarm 重試；訂閱失效（410）不再試', async () => {
    await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: MIN })
    const [t] = ctx.timers()
    vi.setSystemTime(NOW + MIN)
    let n = 0
    globalThis.fetch = async () => new Response(null, { status: (++n, 503) })
    await expect(t.hub.alarm()).rejects.toThrow()
    expect(n).toBe(2)
    expect(t.map.has('timer')).toBe(true)
    // 幾秒後 Cloudflare 再叫一次 alarm：這次送到了
    globalThis.fetch = async () => new Response(null, { status: (++n, 201) })
    await t.hub.alarm()
    expect(n).toBe(3)
    expect(t.map.size).toBe(0)

    await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: MIN })
    n = 0
    globalThis.fetch = async () => new Response(null, { status: (++n, 410) })
    await t.hub.alarm()
    expect(n).toBe(1)
    expect(t.map.size).toBe(0)
  })

  it('簽名那邊暫時出錯：紀錄留著，重試時照樣送出；拖過 10 分鐘就放棄', async () => {
    await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: MIN })
    const [t] = ctx.timers()
    vi.setSystemTime(NOW + MIN)
    const vapid = ctx.objs.get('vapid').hub
    const real = vapid.fetch.bind(vapid)
    vapid.fetch = async () => new Response('boom', { status: 500 })
    await expect(t.hub.alarm()).rejects.toThrow()
    expect(sent).toEqual([])
    expect(t.map.has('timer')).toBe(true)
    vapid.fetch = real
    await t.hub.alarm()
    expect(sent).toHaveLength(1)

    await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: MIN })
    vi.setSystemTime(Date.now() + 12 * MIN)
    await t.hub.alarm()
    expect(sent).toHaveLength(1)
    expect(t.map.size).toBe(0)
  })

  it('送到一半換成新的一則：送完不會把新的清掉', async () => {
    await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: MIN })
    const [t] = ctx.timers()
    vi.setSystemTime(NOW + MIN)
    globalThis.fetch = async () => {
      await post(ctx.env, '/v1/push/timer', { endpoint: ENDPOINT, after: 5 * MIN })
      return new Response(null, { status: 201 })
    }
    await t.hub.alarm()
    expect(t.map.get('timer').at).toBe(NOW + 6 * MIN)
    expect(t.state.alarm).toBe(NOW + 6 * MIN)
  })

  it('沒有設定 Durable Object 的部署：回 503，其他功能不受影響', async () => {
    expect((await post({}, '/v1/push/key', {})).status).toBe(503)
    expect((await post({}, '/v1/push/timer', { endpoint: ENDPOINT, after: MIN })).status).toBe(503)
  })
})

describe('到點的時間和通知上的字', () => {
  const idle = (o = {}) => ({ mode: 'idle', endAt: 0, paused: null, up: false, focusMin: 25, breakMin: 5, round: 1, rounds: 1, ...o })
  it('下一次到點：倒數是結束的時間、正向計時是滿 3 小時、休息是休息結束；待機和暫停沒有', () => {
    const s = idle()
    expect(nextEnd(s)).toBeNull()
    const f = { ...s, ...focusStart(s, NOW) }
    expect(nextEnd(f)).toBe(NOW + 25 * MIN)
    const paused = { ...f, ...pauseToggle(f, NOW + MIN) }
    expect(nextEnd(paused)).toBeNull()
    // 暫停 10 分鐘再繼續：到點的時間跟著往後
    expect(nextEnd({ ...paused, ...pauseToggle(paused, NOW + 11 * MIN) })).toBe(NOW + 35 * MIN)
    expect(nextEnd({ ...f, ...breakStart(f, NOW + 25 * MIN) })).toBe(NOW + 30 * MIN)
    const up = idle({ up: true })
    expect(nextEnd({ ...up, ...focusStart(up, NOW) })).toBe(NOW + FREE_MAX * MIN)
  })

  it('通知上的字：專注結束、連續幾輪、正向計時、休息結束', () => {
    const b = { at: NOW, mode: 'focus', up: false, focusMin: 25, breakMin: 5, round: 1, rounds: 1, target: '' }
    expect(timerNotice(b)).toEqual({ at: NOW, title: 'ひより · 專注結束', body: '25 分鐘完成，休息一下吧' })
    expect(timerNotice({ ...b, target: '蕭邦練習曲 Op.10 No.4' }).body).toBe('「蕭邦練習曲 Op.10 No.4」25 分鐘完成，休息一下吧')
    expect(timerNotice({ ...b, target: '一個名字很長很長很長很長很長很長的任務' }).body).toBe('「一個名字很長很長很長很長很長很…」25 分鐘完成，休息一下吧')
    expect(timerNotice({ ...b, round: 2, rounds: 3 })).toMatchObject({ title: 'ひより · 第 2/3 輪完成', body: '25 分鐘完成，休息 5 分鐘再接著第 3 輪' })
    expect(timerNotice({ ...b, round: 3, rounds: 3 })).toMatchObject({ title: 'ひより · 3 輪都完成了', body: '25 分鐘完成，休息一下吧' })
    expect(timerNotice({ ...b, up: true })).toMatchObject({ title: 'ひより · 正向計時滿 3 小時了' })
    expect(timerNotice({ ...b, mode: 'break' })).toMatchObject({ title: 'ひより · 休息結束', body: '準備好了就再開始一輪吧' })
    expect(timerNotice({ ...b, mode: 'break', round: 1, rounds: 3 }).body).toBe('接著第 2/3 輪')
    expect(timerTag(NOW)).toBe(`hiyori-focus-${NOW}`)
  })
})

describe('前端什麼時候排、什麼時候取消', () => {
  const SCOPE = 'https://hiyori.test/app/'
  const FILE = `${PLAN_CACHE}|${SCOPE}${PLAN_FILE}`
  let now
  let calls
  let sub
  let subscribed
  let files
  let on
  let serverKey
  let down // 伺服器連不上
  // 伺服器上這台裝置排著的那一則（照送出去的請求算）
  let remote
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const key = (s) => b64u(new TextEncoder().encode(s))
  const make = (extra = {}) =>
    new TimerPush({
      enabled: () => on,
      now: () => now,
      api: async (path, body) => {
        if (down) throw new Error('offline')
        calls.push([path, body])
        if (path === '/v1/push/timer') remote = body.after === null ? null : now + body.after
        return path === '/v1/push/key' ? { key: serverKey } : { ok: true, key: serverKey }
      },
      registration: async () => ({
        scope: SCOPE,
        pushManager: {
          getSubscription: async () => sub,
          subscribe: async (opts) => {
            subscribed.push(b64u(opts.applicationServerKey))
            sub = { endpoint: `${ENDPOINT}-${subscribed.length}`, options: { applicationServerKey: opts.applicationServerKey.buffer }, unsubscribe: async () => void (sub = null) }
            return sub
          },
        },
      }),
      storage: {
        open: async (name) => ({
          match: async (url) => (files.has(`${name}|${url}`) ? new Response(JSON.stringify(files.get(`${name}|${url}`))) : undefined),
          put: async (url, res) => void files.set(`${name}|${url}`, await res.json()),
          delete: async (url) => files.delete(`${name}|${url}`),
        }),
      },
      ...extra,
    })
  const plan = (at = now + 25 * MIN, title = 'ひより · 專注結束') => ({ at, title, body: '25 分鐘完成，休息一下吧' })
  const timerCalls = () => calls.filter((c) => c[0] === '/v1/push/timer').map((c) => c[1].after)
  const quiet = async (fn) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      return await fn()
    } finally {
      warn.mockRestore()
    }
  }

  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: {} }, configurable: true, writable: true })
    globalThis.PushManager = class {}
    globalThis.Notification = class {}
    localStorage.clear()
    now = NOW
    calls = []
    sub = null
    subscribed = []
    files = new Map()
    on = true
    down = false
    remote = null
    serverKey = key('server-key-1')
  })

  it('沒開通知：什麼都不排，也不會連到伺服器', async () => {
    on = false
    const p = make()
    await p.plan(plan())
    await p.plan(null)
    expect(calls).toEqual([])
    expect(files.size).toBe(0)
    // 之後開了通知，同一則照樣排得上
    on = true
    await p.plan(plan())
    expect(calls.map((c) => c[0])).toEqual(['/v1/push/key', '/v1/push/timer'])
  })

  it('開始計時：訂閱、把要顯示的字留在裝置上、只把「幾毫秒後」交給伺服器；停掉就取消', async () => {
    const p = make()
    await p.plan(plan())
    expect(subscribed).toEqual([serverKey])
    expect(calls).toEqual([
      ['/v1/push/key', {}],
      ['/v1/push/timer', { endpoint: `${ENDPOINT}-1`, after: 25 * MIN }],
    ])
    expect(files.get(FILE)).toEqual([plan()])
    expect(p.state).toBe('ready')
    expect(p.covers(NOW + 25 * MIN)).toBe(true)

    // 同一則再排一次（畫面重畫、換目標但字沒變）不會再打一次
    await p.plan(plan())
    expect(calls).toHaveLength(2)

    await p.plan(null)
    expect(calls[2]).toEqual(['/v1/push/timer', { endpoint: `${ENDPOINT}-1`, after: null }])
    // 還沒到點就取消的：字也拿掉，晚來的推播不會顯示它
    expect(files.get(FILE)).toEqual([])
    expect(p.covers(NOW + 25 * MIN)).toBe(false)
    // 已經取消了，再停一次不用再打
    await p.plan(null)
    expect(calls).toHaveLength(3)
  })

  it('到點以後接著排下一段：剛到點那一則的字留著（推播晚幾秒到也對得上），也不用去取消', async () => {
    const p = make()
    const focus = plan()
    await p.plan(focus)
    now = focus.at + 300
    // 頁面醒著：專注結束，馬上排休息結束
    const rest = plan(now + 5 * MIN, 'ひより · 休息結束')
    await p.plan(rest)
    expect(files.get(FILE)).toEqual([focus, rest])
    expect(timerCalls()).toEqual([25 * MIN, 5 * MIN])
    // 排上之後記的是下一則
    expect(p.covers(focus.at)).toBe(false)
    expect(p.covers(rest.at)).toBe(true)

    // 休息也結束了、回到待機：已經到點的不用取消，字留著；太久以前的清掉
    now = rest.at + 300
    await p.plan(null)
    expect(timerCalls()).toEqual([25 * MIN, 5 * MIN])
    expect(p.covers(rest.at)).toBe(true)
    now += 20 * MIN
    await p.plan(plan())
    expect(files.get(FILE)).toEqual([plan()])
  })

  it('推播到了沒有：看 Service Worker 留的紀錄', async () => {
    const p = make()
    expect(await p.shown(NOW)).toBe(false)
    files.set(`${PLAN_CACHE}|${SCOPE}${SHOWN_FILE}`, { at: NOW })
    expect(await p.shown(NOW)).toBe(true)
    expect(await p.shown(NOW + 1)).toBe(false)
  })

  it('上一則推播送到這台的時間：讀 Service Worker 的紀錄，沒有或壞掉是 null', async () => {
    const p = make()
    expect(await p.last()).toBeNull()
    files.set(`${PLAN_CACHE}|${SCOPE}${LOG_FILE}`, [{ got: NOW - MIN, at: NOW - MIN - 900, closed: false }, { got: NOW, at: null, closed: true }, { got: 'x' }])
    expect(await p.last()).toEqual({ got: NOW, at: null, closed: true })
    files.set(`${PLAN_CACHE}|${SCOPE}${LOG_FILE}`, 'oops')
    expect(await p.last()).toBeNull()
  })

  it('Service Worker 問「正看著 App 嗎」：醒著的頁面照現在的樣子回答，別的訊息不理', () => {
    const sent = []
    let handler = null
    const sw = { addEventListener: (type, fn) => type === 'message' && (handler = fn), controller: { postMessage: (m) => sent.push(['controller', m]) } }
    let looking = true
    answerLooking(sw, () => looking)
    handler({ data: { type: 'keep' } })
    handler({ data: null })
    handler({ data: { type: 'hiyori-looking?', id: 'a' } })
    looking = false
    handler({ data: { type: 'hiyori-looking?', id: 'b' }, source: { postMessage: (m) => sent.push(['source', m]) } })
    expect(sent).toEqual([
      ['controller', { type: 'hiyori-looking', id: 'a', looking: true }],
      ['source', { type: 'hiyori-looking', id: 'b', looking: false }],
    ])
    // 沒有 Service Worker 的瀏覽器：什麼都不做
    expect(() => answerLooking(undefined)).not.toThrow()
  })

  it('兩個分頁都開著：一個排的，另一個停掉時也會取消', async () => {
    // 兩個分頁都是待機時打開的（各自先確認過「沒有要排的」）
    const a = make()
    const b = make()
    await a.plan(null)
    await b.plan(null)
    await a.plan(plan())
    expect(remote).toBe(NOW + 25 * MIN)
    calls = []
    await b.plan(null)
    expect(calls).toEqual([['/v1/push/timer', { endpoint: `${ENDPOINT}-1`, after: null }]])
    expect(remote).toBeNull()
    // A 跟著同步成待機：已經取消了，不用再打
    await a.plan(null)
    expect(calls).toHaveLength(1)
    // 另一個分頁排了同一則：再送一次也只是換成同一個時間
    await a.plan(plan())
    await b.plan(plan())
    expect(remote).toBe(NOW + 25 * MIN)
  })

  it('連續改好幾次只照最後一次', async () => {
    const p = make()
    p.plan(plan(NOW + MIN))
    p.plan(null)
    await p.plan(plan(NOW + 2 * MIN))
    expect(remote).toBe(NOW + 2 * MIN)
  })

  it('馬上就到的不排；伺服器上還排著別的時間就取消掉', async () => {
    const p = make()
    await p.plan(plan(NOW + 500))
    expect(calls).toEqual([])
    await p.plan(plan(NOW + 2 * MIN))
    expect(remote).toBe(NOW + 2 * MIN)
    await p.plan(plan(NOW + 500))
    expect(remote).toBeNull()
    // 剛好 1 秒後：排得上，也不會一直重排
    calls = []
    await p.plan(plan(NOW + 1000))
    expect(timerCalls()).toEqual([1000])
  })

  it('伺服器換過金鑰：重新訂閱再排一次', async () => {
    const p = make()
    await p.plan(plan())
    serverKey = key('server-key-2')
    calls = []
    await p.plan(plan(NOW + 50 * MIN))
    expect(subscribed).toEqual([key('server-key-1'), serverKey])
    expect(calls.map((c) => c[1].endpoint)).toEqual([`${ENDPOINT}-1`, `${ENDPOINT}-2`])
  })

  it('開始時連不上伺服器：記成 error、不會一直重打；連上線再試就排上', async () => {
    const states = []
    const p = make({ onState: (s) => states.push(s) })
    down = true
    await quiet(() => p.plan(plan()))
    expect(states).toEqual(['error'])
    expect(p.covers(NOW + 25 * MIN)).toBe(false)
    // 畫面重畫再排同一則：還沒排上，會再試
    await quiet(() => p.plan(plan()))
    expect(calls).toEqual([])
    down = false
    await p.retry()
    expect(remote).toBe(NOW + 25 * MIN)
    expect(states).toEqual(['error', 'ready'])
    // 排上了：再叫 retry 不會多打
    calls = []
    await p.retry()
    expect(calls).toEqual([])
  })

  it('取消時連不上伺服器：記得還沒取消，連上線、或重新整理後補取消', async () => {
    const p = make()
    await p.plan(plan())
    down = true
    await quiet(() => p.plan(null))
    expect(remote).toBe(NOW + 25 * MIN)
    expect(p.state).toBe('error')
    // 字已經拿掉：就算那一則還是推過來了，也不會顯示成「專注結束」
    expect(files.get(FILE)).toEqual([])
    down = false
    // 重新整理後的新頁面（待機）
    await make().plan(null)
    expect(remote).toBeNull()
  })

  it('關掉通知會取消、退訂', async () => {
    const p = make()
    await p.plan(plan())
    await p.off()
    expect(remote).toBeNull()
    expect(sub).toBeNull()
    expect(p.state).toBe('idle')
  })

  it('瀏覽器沒有推播（開發時、沒有 Service Worker）：unsupported，不連伺服器，也不會一直重試', async () => {
    const p = make({ registration: async () => undefined })
    await p.plan(plan())
    expect(await p.setup()).toBe(false)
    expect(p.state).toBe('unsupported')
    expect(calls).toEqual([])
  })
})
