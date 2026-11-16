// 警語的推播（網頁版）：頁面看得到時頁面自己念，離開頁面時把接下來的時間交給伺服器、Service Worker 照推播顯示。
// 前半段：src/push.js 的 MottoPush 什麼時候交、什麼時候取消、怎麼跟 Service Worker 分「念到哪一則」。
// 後半段：真的 Worker（PushHub）、真的 Service Worker（public/sw.js）、頁面的提醒（reminders.js）接在一起模擬一天半
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/src/index.js'
import { MOTTO_DONE, MOTTO_FILE, MOTTO_LOG, MOTTO_GRACE, MOTTO_NEAR, MOTTO_PUSH_MAX, MottoPush, PLAN_CACHE, TimerPush, takeNoticeAct } from '../src/push.js'
import { MOTTO_LATE, nextMotto, planKey } from '../src/mottos.js'
import { Store } from '../src/store.js'
import { Reminders } from '../src/reminders.js'
import { FakeCaches, SCOPE, loadSW, run } from './helpers/sw.js'
import { fakeEnv } from './helpers/push.js'

const NOW = new Date(2026, 10, 10, 9).getTime()
const MIN = 60000
const API = 'https://hiyori-sync.example.workers.dev'
const ENDPOINT = 'https://web.push.apple.com/QOabc123'
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const KEY1 = b64u(new TextEncoder().encode('server-key-1'))
const KEY2 = b64u(new TextEncoder().encode('server-key-2'))
const keyBytes = (k) => Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const flush = () => new Promise((r) => setImmediate(r))

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: {} }, configurable: true, writable: true })
  globalThis.PushManager = class {}
  globalThis.Notification = class {
    static permission = 'granted'
  }
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('警語的推播：頁面什麼時候交給伺服器、什麼時候取消', () => {
  let now
  let calls
  let sub
  let subscribed
  let caches
  let on
  let down
  let serverKey
  // 退訂的是現在這個訂閱才算（退訂一個早就換掉的舊訂閱不影響新的）
  const mkSub = (key, n) => {
    const s = {
      endpoint: `${ENDPOINT}-${n}`,
      options: { applicationServerKey: keyBytes(key).buffer },
      unsubscribe: async () => {
        if (sub === s) sub = null
        return true
      },
    }
    return s
  }
  const make = (extra = {}) =>
    new MottoPush({
      enabled: () => on,
      now: () => now,
      api: async (path, body, opts) => {
        if (down) throw new Error('offline')
        calls.push({ path, body, opts })
        return { ok: true, key: serverKey }
      },
      registration: async () => ({
        scope: SCOPE,
        pushManager: {
          getSubscription: async () => sub,
          subscribe: async (o) => {
            subscribed.push(b64u(o.applicationServerKey))
            sub = mkSub(b64u(o.applicationServerKey), subscribed.length + 1)
            return sub
          },
        },
      }),
      storage: caches,
      ...extra,
    })
  const items = (...mins) => mins.map((m) => ({ at: NOW + m * MIN, title: 'ひより · 給自己的警語', body: `第 ${m} 分` }))
  const file = async (name) => (await (await caches.open(PLAN_CACHE)).match(SCOPE + name))?.json()
  const mottoCalls = () => calls.filter((c) => c.path === '/v1/push/mottos')
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})
  // 開機（查訂閱、讀念到哪）
  const boot = async (p = make()) => {
    await p.init({ addEventListener() {} })
    return p
  }

  beforeEach(() => {
    now = NOW
    calls = []
    subscribed = []
    caches = new FakeCaches()
    on = true
    down = false
    serverKey = KEY1
    sub = mkSub(KEY1, 1)
  })

  it('沒開通知、沒訂閱推播：不交給伺服器，也不會建出推播的快取（開機時讀念到哪、存空的那一串都不建）', async () => {
    on = false
    const p = await boot()
    expect(p.ready()).toBe(false)
    p.sync(items(15, 30), true, now)
    await flush()
    expect(calls).toEqual([])
    expect(await caches.has(PLAN_CACHE)).toBe(false)
    // 之前存過的（那時開著通知）：關掉後清成空的，晚到的推播不會照舊的字顯示
    await (await caches.open(PLAN_CACHE)).put(SCOPE + MOTTO_FILE, new Response(JSON.stringify(items(15))))
    const q = await boot()
    q.sync(items(15, 30), false, now)
    await flush()
    expect(await file(MOTTO_FILE)).toEqual([])
    on = true
    sub = null
    await p.check()
    expect(p.ready()).toBe(false)
    p.sync(items(15, 30), true, now)
    await flush()
    expect(calls).toEqual([])
  })

  it('推播送到、顯示出來的警語：回到頁面時讀出來（算進回神紀錄；算過哪幾筆 store 記著），不清掉；又放一次的、提醒時間剛改過的不算', async () => {
    const p = await boot()
    const log = async (list) => (await caches.open(PLAN_CACHE)).put(SCOPE + MOTTO_LOG, new Response(JSON.stringify(list)))
    await log([
      { got: NOW + 1000, at: NOW, closed: false },
      { got: NOW + 2000, at: NOW, closed: false, again: true },
      { got: NOW + 3000, at: NOW + 30 * MIN, closed: false, quiet: true },
      // 晚到、過了就寢才送到的（不出聲地放）：不算
      { got: NOW + 4000, at: NOW + 45 * MIN, closed: false, asleep: true },
      { got: NOW + 60 * MIN, at: NOW + 60 * MIN, closed: true },
      { got: NOW + 61 * MIN, at: 0 },
      null,
    ])
    const first = [{ id: `${NOW + 1000}:${NOW}`, at: NOW }, { id: `${NOW + 60 * MIN}:${NOW + 60 * MIN}`, at: NOW + 60 * MIN }]
    expect(await p.shown()).toEqual(first)
    // 不清掉：再讀還是一樣（另一個分頁也讀得到）
    expect(await (await boot()).shown()).toEqual(first)
    // 時鐘被往回調過：新的那一筆送到的時間比較早，照樣讀得到
    await log([{ got: NOW + 60 * MIN, at: NOW + 60 * MIN }, { got: NOW - 5 * MIN, at: NOW + 90 * MIN }])
    expect(await p.shown()).toEqual([{ id: `${NOW + 60 * MIN}:${NOW + 60 * MIN}`, at: NOW + 60 * MIN }, { id: `${NOW - 5 * MIN}:${NOW + 90 * MIN}`, at: NOW + 90 * MIN }])
  })
  it('時鐘被往回調了（念到的那一則在十分鐘以後）：念到哪改回現在（快取裡的也照寫），頁面又念得到；推播早幾秒到的不算', async () => {
    const p = await boot()
    expect(p.claim(NOW + 120 * MIN)).toBe(true)
    await flush()
    expect(await file(MOTTO_DONE)).toEqual({ at: NOW + 120 * MIN })
    expect(p.rewind(NOW + 120 * MIN - 5000)).toBe(false)
    expect(p.done).toBe(NOW + 120 * MIN)
    // 調回兩個小時前
    expect(p.claim(NOW + 15 * MIN)).toBe(false)
    expect(p.rewind(NOW)).toBe(true)
    await flush()
    expect(p.done).toBe(NOW)
    expect(await file(MOTTO_DONE)).toEqual({ at: NOW })
    expect(p.rewind(NOW)).toBe(false)
    expect(p.claim(NOW + 15 * MIN)).toBe(true)
    await flush()
    // 另一個分頁重新讀快取：讀到的是改回來之後的
    const q = await boot()
    expect(q.done).toBe(NOW + 15 * MIN)
  })

  it('自己關掉提醒、按了先停：念到哪推到現在（快取裡的也是），已經到點、推播還在路上的那幾則晚到時當成念過了；已經比較後面就不動', async () => {
    const p = await boot()
    p.hush(NOW + 20 * MIN)
    await flush()
    expect(p.done).toBe(NOW + 20 * MIN)
    expect(await file(MOTTO_DONE)).toEqual({ at: NOW + 20 * MIN })
    expect(p.claim(NOW + 10 * MIN)).toBe(false)
    p.hush(NOW + 10 * MIN)
    await flush()
    expect(p.done).toBe(NOW + 20 * MIN)
    expect(await file(MOTTO_DONE)).toEqual({ at: NOW + 20 * MIN })
    // 之後重新打開提醒：接下來的那幾則照常念
    expect(p.claim(NOW + 35 * MIN)).toBe(true)
  })

  it('看著頁面時只把字存進快取；離開頁面時才交（keepalive，幾毫秒後），沒變就不再交', async () => {
    const p = await boot()
    const list = items(15, 30, 45)
    p.sync(list, false, now)
    await flush()
    expect(calls).toEqual([])
    expect(await file(MOTTO_FILE)).toEqual(list)
    now += 5000
    await p.sync(list, true, now)
    expect(mottoCalls()).toHaveLength(1)
    const [c] = mottoCalls()
    expect(c.body).toMatchObject({ endpoint: `${ENDPOINT}-1`, after: [15 * MIN - 5000, 30 * MIN - 5000, 45 * MIN - 5000] })
    expect(c.body.seq).toBeGreaterThan(0)
    expect(c.opts).toEqual({ keepalive: true })
    expect(p.covers(NOW + 15 * MIN)).toBe(true)
    expect(p.covers(NOW + 16 * MIN)).toBe(false)
    // 又離開一次、下一秒的檢查：同一串，不再交
    p.sync(list, true, now + 1000)
    await flush()
    expect(mottoCalls()).toHaveLength(1)
  })

  it('回到頁面：下一則還久就先不取消（很快又離開也不用再交）；快到了（1 分鐘內）才取消，由頁面自己念', async () => {
    const p = await boot()
    const list = items(15, 30)
    await p.sync(list, true, now)
    now = NOW + 5 * MIN
    p.sync(list, false, now)
    await flush()
    expect(mottoCalls()).toHaveLength(1)
    // 又離開：伺服器上還是同一串
    p.sync(list, true, now + 1000)
    await flush()
    expect(mottoCalls()).toHaveLength(1)
    now = NOW + 15 * MIN - MOTTO_NEAR
    await p.sync(list, false, now)
    expect(mottoCalls()).toHaveLength(2)
    expect(mottoCalls()[1].body).toMatchObject({ after: null })
    expect(mottoCalls()[1].body.seq).toBeGreaterThan(mottoCalls()[0].body.seq)
    expect(p.covers(NOW + 15 * MIN)).toBe(false)
    // 取消過了：之後的每一秒不再打
    p.sync(list, false, now + 1000)
    await flush()
    expect(mottoCalls()).toHaveLength(2)
  })

  it('排法變了：看著頁面時取消，在背景時重交；不用提醒了就取消', async () => {
    const p = await boot()
    await p.sync(items(15, 30), true, now)
    await p.sync(items(20, 40), false, now)
    expect(mottoCalls().map((c) => c.body.after)).toEqual([[15 * MIN, 30 * MIN], null])
    await p.sync(items(20, 40), true, now)
    await p.sync(items(20, 45), true, now)
    expect(mottoCalls().map((c) => c.body.after).slice(2)).toEqual([[20 * MIN, 40 * MIN], [20 * MIN, 45 * MIN]])
    await p.sync([], true, now)
    expect(mottoCalls().at(-1).body.after).toBeNull()
    expect(mottoCalls()).toHaveLength(5)
  })

  it('交出去的：已經到點還沒人念的那一則 1 秒後推；念過的、晚太久的不交；最多 200 則', async () => {
    const p = await boot()
    p.claim(NOW - 15 * MIN)
    now = NOW + 2 * MIN
    await p.sync(items(-15, 0, 15), true, now)
    expect(mottoCalls()[0].body.after).toEqual([1000, 13 * MIN])
    now = NOW + 12 * MIN
    await p.sync(items(0, 15, 30), true, now)
    expect(mottoCalls()[1].body.after).toEqual([3 * MIN, 18 * MIN])
    const lots = Array.from({ length: 250 }, (_, i) => ({ at: now + (i + 1) * MIN, title: 't', body: String(i) }))
    await p.sync(lots, true, now)
    await flush()
    expect(mottoCalls()[2].body.after).toHaveLength(MOTTO_PUSH_MAX)
    expect(await file(MOTTO_FILE)).toHaveLength(MOTTO_PUSH_MAX)
  })

  it('沒送到伺服器：算沒排上（頁面在背景也自己念），30 秒後、或連上線時再送', async () => {
    const p = await boot()
    const warn = quiet()
    down = true
    await p.sync(items(15), true, now)
    expect(warn).toHaveBeenCalled()
    expect(p.covers(NOW + 15 * MIN)).toBe(false)
    expect(p.defer(NOW + 15 * MIN, true, now)).toBe(false)
    down = false
    now = NOW + 10000
    p.sync(items(15), true, now)
    await flush()
    expect(mottoCalls()).toEqual([])
    now = NOW + 31000
    await p.sync(items(15), true, now)
    expect(mottoCalls()).toHaveLength(1)
    expect(p.covers(NOW + 15 * MIN)).toBe(true)
    // 取消沒送到：等一下再取消；連上線時馬上再取消
    down = true
    now = NOW + 40000
    await p.sync([], false, now)
    down = false
    now = NOW + 41000
    p.sync([], false, now)
    await flush()
    expect(mottoCalls()).toHaveLength(1)
    p.retry()
    await p.sync([], false, now)
    expect(mottoCalls()).toHaveLength(2)
    expect(mottoCalls().at(-1).body.after).toBeNull()
  })

  it('送出去沒回音（送的那個分頁剛好被關掉）：過 15 秒就不算排上了，下次離開頁面時重送；剛送出的還算', async () => {
    // 上一個分頁送到一半就被關掉：紀錄停在「還在送」，送的其實沒到
    localStorage.setItem('hiyori-push-mottos', JSON.stringify({ endpoint: `${ENDPOINT}-1`, times: [NOW + 15 * MIN, NOW + 30 * MIN], seq: 5, ok: null, sent: NOW - 20000 }))
    const p = await boot()
    expect(p.covers(NOW + 15 * MIN)).toBe(false)
    expect(p.defer(NOW + 15 * MIN, true, NOW)).toBe(false)
    // 同一串：還是重送一次
    await p.sync(items(15, 30), true, now)
    expect(mottoCalls()).toHaveLength(1)
    expect(p.covers(NOW + 15 * MIN)).toBe(true)
    // 剛送出、還沒回音：算排上了（頁面在背景時不念），下一秒也不重送
    let answer
    const q = await boot(make({ api: (path, body) => (calls.push({ path, body }), new Promise((r) => (answer = r))) }))
    q.sync(items(15, 45), true, now)
    await flush()
    expect(mottoCalls()).toHaveLength(2)
    expect(q.covers(NOW + 45 * MIN, now + 10000)).toBe(true)
    q.sync(items(15, 45), true, now + 10000)
    await flush()
    expect(mottoCalls()).toHaveLength(2)
    answer({ ok: true, key: KEY1 })
    await flush()
    expect(q.covers(NOW + 45 * MIN, now + 60000)).toBe(true)
  })

  it('兩個分頁：看著的那個念，背景的那個不交給伺服器、也不念（不會一邊取消一邊重排）；看著的離開或不見了，才交給伺服器', async () => {
    const a = await boot()
    const b = await boot()
    const list = items(15, 30)
    a.sync(list, false, now)
    await b.sync(list, true, now)
    expect(mottoCalls()).toEqual([])
    expect(b.defer(NOW + 15 * MIN, true, now)).toBe(true)
    // 下一則快到了：前後來回好幾秒也不會打伺服器
    for (let i = 0; i < 5; i++) {
      now = NOW + 14 * MIN + i * 1000
      a.sync(list, false, now)
      await b.sync(list, true, now)
    }
    expect(mottoCalls()).toEqual([])
    // 看著的那個離開頁面：它自己交；背景的那個看到伺服器排著了，不再交
    await a.sync(list, true, now)
    await b.sync(list, true, now + 1000)
    expect(mottoCalls()).toHaveLength(1)
    // 回到 A、取消；A 沒說一聲就不見了（當掉）：30 秒後背景的 B 接手交出去
    now = NOW + 14.5 * MIN
    await a.sync(list, false, now)
    expect(mottoCalls().at(-1).body.after).toBeNull()
    await b.sync(list, true, now + 20000)
    expect(mottoCalls()).toHaveLength(2)
    expect(b.defer(NOW + 15 * MIN, true, now + 20000)).toBe(true)
    await b.sync(list, true, now + 31000)
    expect(mottoCalls()).toHaveLength(3)
    expect(mottoCalls().at(-1).body.after).toEqual([30000, 15 * MIN + 30000])
  })

  it('字沒存進快取（暫時出錯）：存不進去就不交給伺服器（不然到點時只能顯示一般的字），等一下再存、再交', async () => {
    let broken = true
    const real = caches
    const storage = {
      has: (n) => real.has(n),
      open: async (n) => {
        const c = await real.open(n)
        return { match: (u) => c.match(u), put: async (u, r) => (broken ? Promise.reject(new Error('quota')) : c.put(u, r)) }
      },
    }
    const p = await boot(make({ storage }))
    quiet()
    await p.sync(items(15), true, now)
    expect(mottoCalls()).toEqual([])
    expect(p.covers(NOW + 15 * MIN)).toBe(false)
    // 頁面在背景、JavaScript 還在跑：自己念
    expect(p.defer(NOW + 15 * MIN, true, now)).toBe(false)
    broken = false
    now = NOW + 31000
    await p.sync(items(15), true, now)
    expect(mottoCalls()).toHaveLength(1)
    expect(await file(MOTTO_FILE)).toEqual(items(15))
  })

  it('字被另一個分頁用它那一串蓋掉了：交出去之前讀回來看一次，對不上就照這邊的再存', async () => {
    const p = await boot()
    const list = items(15, 30)
    p.sync(list, false, now)
    await flush()
    await (await caches.open(PLAN_CACHE)).put(SCOPE + MOTTO_FILE, new Response(JSON.stringify(items(20))))
    await p.sync(list, true, now)
    expect(mottoCalls()).toHaveLength(1)
    expect((await file(MOTTO_FILE)).map((x) => x.at)).toEqual([NOW + 15 * MIN, NOW + 30 * MIN])
  })

  it('伺服器換過金鑰、但等回音的時候已經取消了：不會用新的訂閱把舊的那一串排回去', async () => {
    const p = await boot()
    let answer = null
    p.api = (path, body) => {
      calls.push({ path, body })
      if (body.after && !answer) return new Promise((r) => (answer = r))
      return Promise.resolve({ ok: true, key: KEY2 })
    }
    // 離開頁面時交出去，回音一直沒來
    p.sync(items(15), true, now)
    await flush()
    // 回到頁面、排法變了：取消。這次的回音說金鑰換了：重新訂閱，用新的訂閱再取消一次
    await p.sync(items(20), false, now)
    expect(subscribed).toEqual([KEY2])
    // 舊的那一串的回音終於來了：不能再排回去
    answer({ ok: true, key: KEY2 })
    await flush()
    expect(mottoCalls().map((c) => [c.body.endpoint, c.body.after])).toEqual([
      [`${ENDPOINT}-1`, [15 * MIN]],
      [`${ENDPOINT}-1`, null],
      [`${ENDPOINT}-2`, null],
    ])
    expect(p.covers(NOW + 15 * MIN)).toBe(false)
  })

  it('剛到點的那幾則（10 分鐘內）留在快取裡：頁面念過、重排之後那一則不在新的那一串裡，晚到的推播還認得出來', async () => {
    const p = await boot()
    p.sync(items(0, 15), false, now)
    await flush()
    now = NOW + 2 * MIN
    p.sync(items(15, 30), false, now)
    await flush()
    expect((await file(MOTTO_FILE)).map((x) => x.at)).toEqual([NOW, NOW + 15 * MIN, NOW + 30 * MIN])
    now = NOW + 11 * MIN
    p.sync(items(15, 30, 45), false, now)
    await flush()
    expect((await file(MOTTO_FILE)).map((x) => x.at)).toEqual([NOW + 15 * MIN, NOW + 30 * MIN, NOW + 45 * MIN])
  })

  it('頁面要不要先不念：在背景時伺服器排著就不念；回到頁面先讀念到哪；剛到點的那一則等推播幾秒', async () => {
    const p = await boot()
    const t = NOW + 15 * MIN
    await p.sync(items(15, 30), true, now)
    expect(p.defer(t, true, t)).toBe(true)
    expect(p.defer(NOW + 16 * MIN, true, t)).toBe(false)
    // 鎖著的時候 Service Worker 顯示了 15 分那一則
    await (await caches.open(PLAN_CACHE)).put(SCOPE + MOTTO_DONE, new Response(JSON.stringify({ at: t })))
    // 回到頁面：還沒讀到之前先不念；讀到了就知道念過了
    expect(p.defer(t, false, t + 2000)).toBe(true)
    await flush()
    expect(p.done).toBe(t)
    expect(p.claim(t)).toBe(false)
    // 30 分那一則剛到點、推播還在路上：等它幾秒，太久沒來頁面自己念
    const u = NOW + 30 * MIN
    expect(p.defer(u, false, u + 1000)).toBe(true)
    expect(p.defer(u, false, u + MOTTO_GRACE)).toBe(false)
    expect(p.claim(u)).toBe(true)
    await flush()
    expect(await file(MOTTO_DONE)).toEqual({ at: u })
    expect(p.claim(u)).toBe(false)
  })

  it('離開頁面之前開始讀、回到頁面才讀完的不算數：回來後重新讀一次', async () => {
    const p = make()
    const read = p.refresh()
    p.defer(NOW, true, NOW)
    await read
    expect(p.fresh).toBe(false)
    expect(p.defer(NOW, false, NOW)).toBe(true)
    await flush()
    expect(p.fresh).toBe(true)
  })

  it('Service Worker 說顯示了一則（頁面在背景、JavaScript 還在跑）：念到哪往後', async () => {
    const listeners = []
    const p = make()
    await p.init({ addEventListener: (type, fn) => type === 'message' && listeners.push(fn) })
    listeners.forEach((fn) => fn({ data: { type: 'hiyori-motto-shown', at: NOW + 15 * MIN } }))
    listeners.forEach((fn) => fn({ data: { type: 'keep', at: NOW + 99 * MIN } }))
    expect(p.done).toBe(NOW + 15 * MIN)
  })

  it('關掉通知：退訂之前取消伺服器上排著的、拿掉快取裡的字', async () => {
    const p = await boot()
    await p.sync(items(15, 30), true, now)
    const timer = new TimerPush({ enabled: () => on, now: () => now, api: async (path, body) => (calls.push({ path, body }), { ok: true, key: serverKey }), registration: async () => ({ scope: SCOPE, pushManager: { getSubscription: async () => sub } }), storage: caches, beforeOff: (s) => p.off(s) })
    await timer.off()
    await flush()
    expect(mottoCalls().at(-1).body).toMatchObject({ endpoint: `${ENDPOINT}-1`, after: null })
    expect(sub).toBeNull()
    expect(await file(MOTTO_FILE)).toEqual([])
    expect(p.ready()).toBe(false)
    expect(p.covers(NOW + 15 * MIN)).toBe(false)
  })

  it('伺服器換過金鑰：重新訂閱，用新的訂閱再交一次', async () => {
    const p = await boot()
    serverKey = KEY2
    await p.sync(items(15), true, now)
    expect(subscribed).toEqual([KEY2])
    expect(mottoCalls().map((c) => c.body.endpoint)).toEqual([`${ENDPOINT}-1`, `${ENDPOINT}-2`])
    expect(p.covers(NOW + 15 * MIN)).toBe(true)
  })
})

// 一天半的模擬：真的 Worker（PushHub）、真的 Service Worker（public/sw.js）、頁面的提醒（reminders.js + MottoPush）接在一起。
// 分頁 A 在看得到、在背景（JavaScript 還在跑）、凍住、整個關掉之間切來切去；second：另外開著一個一直在背景的分頁 B。
// slow：多少比例的請求和推播晚 8～25 秒才到（比回到頁面時等推播的 8 秒還久）；dup：多少比例的推播同時送到兩次
async function simulate({ seed: s0, second = false, slow = 0, dup = 0 }) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  // 固定的亂數（mulberry32）：每次跑都一樣
  let seed = s0
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const lag = () => (rand() < slow ? 8000 + Math.floor(rand() * 17000) : 100 + Math.floor(rand() * 2900))
  const END = new Date(2026, 10, 11, 21).getTime()

  const store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], player: {} }))
  for (const t of ['一', '二', '三']) store.addMotto(t)
  store.setSetting('mottoEvery', 15)

  // ── 伺服器 ──
  const ctx = fakeEnv()
  const device = () => [...ctx.objs.entries()].find(([name]) => name !== 'vapid')?.[1]
  // 排著的事：{ at, kind: 'page' | 'req' | 'push', … }
  const events = []
  globalThis.fetch = async () => {
    const at = Date.now() + lag()
    events.push({ at, kind: 'push' })
    if (rand() < dup) events.push({ at, kind: 'push' })
    return new Response(null, { status: 201 })
  }
  const api = (path, body) => new Promise((resolve, reject) => events.push({ at: Date.now() + lag(), kind: 'req', path, body, resolve, reject }))

  // ── Service Worker ──
  const caches = new FakeCaches()
  const tabs = []
  const notes = []
  const sw = loadSW({
    caches,
    registration: { showNotification: async (title, opts) => void notes.push({ title, ...opts }), getNotifications: async () => [] },
    // 凍住的頁面收不到訊息（回到頁面時要自己讀念到哪）
    clients: { matchAll: async () => tabs.filter((t) => t.page && t.mode !== 'frozen').map((t) => t.win) },
  })
  const sub = { endpoint: ENDPOINT, options: {} }
  const registration = async () => ({ scope: SCOPE, pushManager: { getSubscription: async () => sub } })

  // ── 頁面（main.js 的 syncMottos 和提醒的分工） ──
  const spoken = []
  const swShown = []
  const makeTab = (name, mode) => {
    const tab = { name, mode, page: null, listeners: [] }
    tab.win = {
      postMessage(msg) {
        if (msg?.type === 'hiyori-motto-shown') for (const fn of tab.listeners) fn({ data: msg })
        if (msg?.type === 'hiyori-looking?') queueMicrotask(() => sw.message({ data: { type: 'hiyori-looking', id: msg.id, looking: false } }))
      },
    }
    tabs.push(tab)
    return tab
  }
  const open = async (tab) => {
    tab.listeners = []
    const mp = new MottoPush({ enabled: () => true, api, registration, storage: caches })
    const r = new Reminders(store, (m, min, kind) => kind === 'motto' && spoken.push({ at: r.mottoState().at, mode: tab.mode, tab: tab.name, a: tabs[0].mode }), {
      external: () => mp.ready(),
      hidden: (t) => mp.defer(t, tab.mode !== 'visible'),
      handled: () => mp.done,
      claim: (at) => mp.claim(at),
    })
    tab.page = { mp, r, sig: '', items: [] }
    await mp.init({ addEventListener: (type, fn) => type === 'message' && tab.listeners.push(fn) })
  }
  const sync = (tab, leaving = false) => {
    const { mp, r } = tab.page
    const now = Date.now()
    const on = mp.ready()
    if (on) r.startMotto(now)
    const s = store.state
    const sig = on ? planKey({ every: s.settings.mottoEvery, rhythm: s.rhythm, mottos: s.mottos, last: r.mottoState(), quietUntil: 0, task: '', now }) : 'off'
    if (sig !== tab.page.sig) {
      tab.page.sig = sig
      tab.page.items = on ? r.mottoPlan(now, { since: Math.max(now - MOTTO_LATE, mp.done), max: MOTTO_PUSH_MAX }).map((p) => ({ at: p.at, title: 'ひより · 給自己的警語', body: p.text })) : []
    }
    mp.sync(tab.page.items, tab.mode !== 'visible' || leaving, now)
  }
  const tick = (tab) => {
    tab.page.r.check(new Date(Date.now()))
    sync(tab)
  }

  const a = makeTab('A', 'visible')
  await open(a)
  tick(a)
  const start = a.page.r.mottoState().at
  const expected = []
  for (let t = nextMotto(start, 15, store.state.rhythm); t < END - 60000; t = nextMotto(t, 15, store.state.rhythm)) expected.push(t)
  if (second) {
    const b = makeTab('B', 'hidden')
    await open(b)
    // B 的檢查跟 A 錯開 7 秒
    events.push({ at: NOW + 7000, kind: 'page', tab: b })
  }

  // 換狀態：看得到 ↔ 背景、看得到 ↔ 凍住（手機切走）、背景 → 凍住、整個關掉、關掉後再打開
  const NEXT = { visible: ['hidden', 'frozen', 'closed'], hidden: ['visible', 'frozen', 'closed'], frozen: ['visible', 'closed'], closed: ['visible'] }
  const seen = new Set()
  events.push({ at: NOW + 20000, kind: 'page', tab: a })
  for (let guard = 0; guard < 200000; guard++) {
    const alarm = device()?.state.alarm
    let e = null
    for (const x of events) if (!e || x.at < e.at) e = x
    if (alarm != null && (!e || alarm <= e.at)) e = { at: alarm, kind: 'alarm' }
    else if (e) events.splice(events.indexOf(e), 1)
    if (!e || e.at > END) break
    vi.setSystemTime(Math.max(e.at, Date.now()))
    if (e.kind === 'page') {
      const tab = e.tab
      events.push({ at: Date.now() + 20000, kind: 'page', tab })
      if (tab === a && rand() < 0.03) {
        const from = tab.mode
        tab.mode = NEXT[from][Math.floor(rand() * NEXT[from].length)]
        seen.add(`${from}>${tab.mode}`)
        // 離開頁面的那一刻（visibilitychange、pagehide）頁面還醒著
        if (from === 'visible' || (from === 'hidden' && tab.mode === 'closed')) sync(tab, tab.mode === 'closed')
        if (tab.mode === 'closed') tab.page = null
        if (from === 'closed') await open(tab)
        else if (tab.mode === 'visible') await tab.page.mp.check()
      }
      if (tab.page && (tab.mode === 'visible' || tab.mode === 'hidden')) tick(tab)
    } else if (e.kind === 'req') {
      const res = await worker.fetch(new Request(API + e.path, { method: 'POST', body: JSON.stringify(e.body) }), ctx.env)
      const data = await res.json()
      if (res.ok) e.resolve(data)
      else e.reject(new Error(`push ${res.status}`))
    } else if (e.kind === 'alarm') {
      await device().hub.alarm()
    } else if (e.kind === 'push') {
      // 同一刻送到的推播一起跑（Service Worker 裡排隊處理）
      const batch = [e, ...events.filter((x) => x.kind === 'push' && x.at === e.at)]
      for (const x of batch.slice(1)) events.splice(events.indexOf(x), 1)
      const before = notes.length
      await Promise.all(batch.map(() => run(sw.push, { data: null })))
      for (const n of notes.slice(before)) {
        if (n.tag === 'motto' && !n.silent) swShown.push({ at: (await (await (await caches.open(PLAN_CACHE)).match(SCOPE + MOTTO_DONE)).json()).at, mode: a.mode })
      }
    }
    await flush()
  }
  vi.useRealTimers()
  return { expected, spoken, swShown, notes, seen, until: END - 60000 }
}

describe('通知上的按鈕：Service Worker 留在快取裡的那一次', () => {
  it('拿走就刪掉（不會做兩次）；太舊的、不認得的、壞掉的不算；只拿某一次時別次的留著；沒有快取時不建一個', async () => {
    const caches = new FakeCaches()
    const sw = { getRegistration: async () => ({ scope: SCOPE }) }
    const T = 1_800_000_000_000
    const take = (id = null, now = T, s = sw) => takeNoticeAct(id, { now, storage: caches, sw: s })
    const put = (v) => caches.open(PLAN_CACHE).then((c) => c.put(SCOPE + '__act', new Response(JSON.stringify(v))))
    expect(await take()).toBeNull()
    expect(await caches.has(PLAN_CACHE)).toBe(false)
    await put({ id: 'a', act: 'pause', at: T - 1000 })
    expect(await take()).toEqual({ id: 'a', act: 'pause', slot: 0 })
    expect(await take()).toBeNull()
    // slot：那一則提醒排在幾點（回神紀錄用）；壞掉的當成不知道
    await put({ id: 'a2', act: 'focus', at: T - 1000, slot: T - 60000 })
    expect(await take()).toEqual({ id: 'a2', act: 'focus', slot: T - 60000 })
    await put({ id: 'a3', act: 'focus', at: T - 1000, slot: 'x' })
    expect(await take()).toEqual({ id: 'a3', act: 'focus', slot: 0 })
    for (const v of [{ id: 'b', act: 'pause', at: T - 3 * 60000 }, { id: 'c', act: 'rm', at: T }, { id: 5, act: 'focus', at: T }, 'oops', { id: 'd', act: 'focus', at: T + 60000 }]) {
      await put(v)
      expect(await take(), JSON.stringify(v)).toBeNull()
      expect(await (await caches.open(PLAN_CACHE)).match(SCOPE + '__act'), JSON.stringify(v)).toBeUndefined()
    }
    await put({ id: 'e', act: 'focus', at: T })
    expect(await take('x')).toBeNull()
    expect(await take('e')).toEqual({ id: 'e', act: 'focus', slot: 0 })
    expect(await take()).toBeNull()
    // 沒有 Service Worker（開發時、不支援的瀏覽器）
    await put({ id: 'f', act: 'focus', at: T })
    expect(await take(null, T, null)).toBeNull()
  })
})

describe('模擬一天半：真的 Worker、Service Worker 和頁面接在一起', () => {
  // 最後一分鐘內到點的不比（模擬剛好停在那一刻，可能還在路上）
  const check = ({ expected, spoken, swShown, until }) => {
    const got = [...spoken.map((x) => x.at), ...swShown.map((x) => x.at)].sort((x, y) => x - y)
    expect(new Set(got).size).toBe(got.length)
    expect(got.filter((t) => t < until)).toEqual(expected)
  }

  it('頁面看得到、在背景（JavaScript 還在跑）、凍住、整個關掉之間切來切去，請求和推播都會晚到、順序會亂：每一則警語都剛好出現一次', async () => {
    const r = await simulate({ seed: 11 })
    check(r)
    // 頁面看得到時念的、Service Worker 在頁面看不到時顯示的都有不少；各種切換都碰到過
    expect(r.spoken.filter((x) => x.mode === 'visible').length).toBeGreaterThan(10)
    expect(r.swShown.filter((x) => x.mode !== 'visible').length).toBeGreaterThan(10)
    // 看著頁面時推播幾乎不來（下一則快到了就先取消）；頁面念過、推播又來的（不出聲地再放一次）也幾乎沒有
    expect(r.swShown.filter((x) => x.mode === 'visible').length).toBeLessThanOrEqual(2)
    expect(r.notes.filter((n) => n.silent).length).toBeLessThanOrEqual(2)
    for (const k of ['visible>hidden', 'visible>frozen', 'hidden>visible', 'frozen>visible', 'closed>visible']) expect(r.seen.has(k), k).toBe(true)
  }, 60000)

  it('再開著一個一直在背景的分頁、有些請求和推播晚了 8～25 秒、有些推播同時送到兩次：還是每一則剛好響一次', async () => {
    for (const seed of [3, 29]) {
      const r = await simulate({ seed, second: true, slow: 0.15, dup: 0.1 })
      check(r)
      // 背景的分頁 B 在 A 看著時從來不念（A 會念）；A 不在、伺服器那邊一直沒回音時才輪到它
      expect(r.spoken.filter((x) => x.tab === 'B' && x.a === 'visible')).toEqual([])
      expect(r.spoken.filter((x) => x.tab === 'A').length).toBeGreaterThan(10)
      expect(r.swShown.length).toBeGreaterThan(10)
      // 晚到、重複送到的推播：不出聲地再放一次，不會又響
      expect(r.notes.filter((n) => n.silent).length).toBeGreaterThan(0)
    }
  }, 120000)
})
