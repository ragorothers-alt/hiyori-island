// Service Worker（public/sw.js）：用假的 caches 跑它的事件，檢查更新時的快取搬移和離線首頁
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const SCOPE = 'https://hiyori.test/app/'

class FakeCache {
  constructor(fetcher) {
    this.map = new Map()
    this.fetcher = fetcher
  }
  async match(req) {
    return this.map.get(typeof req === 'string' ? new URL(req, SCOPE).href : req.url) || undefined
  }
  async put(req, res) {
    this.map.set(typeof req === 'string' ? new URL(req, SCOPE).href : req.url, res)
  }
  async keys() {
    return [...this.map.keys()].map((url) => ({ url }))
  }
  // 跟真的一樣：有一個抓不到就整批失敗
  async addAll(urls) {
    if (!this.fetcher) return
    const got = []
    for (const u of urls) {
      const res = await this.fetcher(u)
      if (!res.ok) throw new TypeError(`${u} ${res.status}`)
      got.push([u, res])
    }
    for (const [u, res] of got) await this.put(u, res)
  }
}
class FakeCaches {
  constructor(fetcher = null) {
    this.all = new Map()
    this.fetcher = fetcher
  }
  async open(name) {
    if (!this.all.has(name)) this.all.set(name, new FakeCache(this.fetcher))
    return this.all.get(name)
  }
  async keys() {
    return [...this.all.keys()]
  }
  async delete(name) {
    return this.all.delete(name)
  }
  async match(req) {
    for (const c of this.all.values()) {
      const hit = await c.match(req)
      if (hit) return hit
    }
  }
}

// 跟建置時一樣把版本和檔案清單填進去，再跑一次 sw.js，拿到它註冊的事件
function loadSW({ version = 'hiyori-new', build = [], caches, fetch = async () => new Response('ok'), clients = {}, registration = {} }) {
  const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .replace("const VERSION = 'hiyori-v1'", `const VERSION = '${version}'`)
    .replace('const BUILD = []', `const BUILD = ${JSON.stringify(build)}`)
  const on = {}
  const self = {
    addEventListener: (type, fn) => (on[type] = fn),
    registration: { scope: SCOPE, ...registration },
    location: new URL('sw.js', SCOPE),
    clients: { claim: async () => {}, ...clients },
    skipWaiting() {},
  }
  new Function('self', 'caches', 'fetch', src)(self, caches, fetch)
  return on
}
const run = async (handler, event) => {
  let wait
  handler({ ...event, waitUntil: (p) => (wait = p), respondWith: (p) => (wait = p) })
  return wait
}

describe('Service Worker', () => {
  it('更新時：舊快取裡新版還用得到的檔案搬過來，其他的丟掉；別的網站的快取不動', async () => {
    const caches = new FakeCaches()
    const old = await caches.open('hiyori-v1')
    await old.put('assets/three-abc.js', new Response('three'))
    await old.put('assets/islandScene-old.js', new Response('old'))
    await (await caches.open('someone-else')).put('x.js', new Response('x'))
    const on = loadSW({ caches, build: ['assets/three-abc.js', 'assets/index-new.js', 'index.html'] })
    await run(on.activate, {})
    expect(await caches.keys()).toEqual(['someone-else', 'hiyori-new'])
    const cur = await caches.open('hiyori-new')
    expect(await (await cur.match('assets/three-abc.js')).text()).toBe('three')
    expect(await cur.match('assets/islandScene-old.js')).toBeUndefined()
  })

  it('頁面：網路回 404／500 時不存成離線首頁，照樣把回應交給頁面', async () => {
    const caches = new FakeCaches()
    const on = loadSW({ caches, fetch: async () => new Response('not found', { status: 404 }) })
    const req = { method: 'GET', mode: 'navigate', url: SCOPE + 'nope' }
    const res = await run(on.fetch, { request: req })
    expect(res.status).toBe(404)
    await new Promise((r) => setTimeout(r))
    expect(await caches.match('./index.html')).toBeUndefined()
    const ok = loadSW({ caches, fetch: async () => new Response('<html>') })
    await run(ok.fetch, { request: req })
    await new Promise((r) => setTimeout(r))
    expect(await (await caches.match('./index.html')).text()).toBe('<html>')
  })

  const HTML = '<script type="module" src="./assets/index-new.js"></script><link rel="stylesheet" href="./assets/index-new.css">'
  const fetcher = (fail = null) => async (u) => {
    const url = String(u)
    if (fail && url.includes(fail)) return new Response('', { status: 404 })
    return new Response(url === './' ? HTML : `file ${url}`)
  }

  it('安裝：首頁和它用到的入口 JS／CSS 都存進新快取', async () => {
    const f = fetcher()
    const caches = new FakeCaches(f)
    const on = loadSW({ caches, fetch: f })
    await run(on.install, {})
    const cur = await caches.open('hiyori-new')
    expect(await (await cur.match('./index.html')).text()).toBe(HTML)
    expect(await (await cur.match('./assets/index-new.js')).text()).toBe('file ./assets/index-new.js')
    expect(await cur.match('./assets/index-new.css')).toBeTruthy()
  })

  it('安裝：入口 JS 抓不到就讓安裝失敗，舊版和舊快取留著', async () => {
    const f = fetcher('index-new.js')
    const caches = new FakeCaches(f)
    await (await caches.open('hiyori-old')).put('./assets/index-old.js', new Response('old'))
    const on = loadSW({ caches, fetch: f })
    await expect(run(on.install, {})).rejects.toThrow()
    expect(await caches.keys()).toEqual(['hiyori-old'])
  })

  it('點通知：只叫出這個 App 範圍裡的視窗，沒有就打開 App', async () => {
    const focused = []
    const opened = []
    const win = (url) => ({ url, focus: async () => focused.push(url) })
    let list = [win('https://hiyori.test/other-site/'), win(SCOPE + '#tasks')]
    const clients = { matchAll: async () => list, openWindow: async (u) => opened.push(u) }
    const on = loadSW({ caches: new FakeCaches(), clients })
    const event = { notification: { close() {} } }
    await run(on.notificationclick, event)
    expect(focused).toEqual([SCOPE + '#tasks'])
    list = [win('https://hiyori.test/other-site/')]
    await run(on.notificationclick, event)
    expect(opened).toEqual([SCOPE])
  })
})

// 番茄鐘到點的推播：推播本身沒有內容，要顯示的字是頁面先留在快取裡的（最近幾則）
describe('Service Worker：計時器到點的推播', () => {
  const NOW = Date.UTC(2026, 10, 10, 4)
  const MIN = 60000
  // 假的通知中心：同一個 tag 的新通知換掉舊的。broken：getNotifications 壞掉的瀏覽器
  function setup({ plans, windows = () => [], before = [], broken = null } = {}) {
    const caches = new FakeCaches()
    let list = before.map((tag) => ({ tag, title: 'old' }))
    const alerts = []
    const registration = {
      getNotifications: async ({ tag } = {}) => list.filter((n) => !tag || n.tag === tag).map((n) => ({ ...n, close: () => (list = list.filter((x) => x !== n)) })),
      showNotification: async (title, opts) => {
        list = [...list.filter((n) => n.tag !== opts.tag), { title, ...opts }]
        if (opts.renotify) alerts.push(title)
      },
    }
    if (broken === 'missing') delete registration.getNotifications
    if (broken === 'throws') registration.getNotifications = () => { throw new Error('nope') } // prettier-ignore
    const on = loadSW({ caches, registration, clients: { matchAll: async () => windows() } })
    const ready = plans === undefined ? Promise.resolve() : caches.open('hiyoripush').then((c) => c.put(SCOPE + '__timer-plan', new Response(JSON.stringify(plans))))
    const marker = async () => (await (await caches.open('hiyoripush')).match(SCOPE + '__timer-shown'))?.json()
    return { on, ready, shown: () => list, alerts, marker, caches }
  }
  const withClock = async (fn) => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    vi.setSystemTime(NOW)
    try {
      return await fn()
    } finally {
      vi.useRealTimers()
    }
  }
  const focus = { at: NOW - 800, title: 'ひより · 專注結束', body: '「練習曲」25 分鐘完成，休息一下吧' }

  it('顯示剛到點那一則的字，tag 帶著到點的時間，並記下「這一次通知過了」', () =>
    withClock(async () => {
      const s = setup({ plans: [focus] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown()).toEqual([expect.objectContaining({ title: focus.title, body: focus.body, tag: `hiyori-focus-${focus.at}`, renotify: true, icon: SCOPE + 'icons/icon-192.png' })])
      expect(s.alerts).toEqual([focus.title])
      expect(await s.marker()).toEqual({ at: focus.at })
    }))

  it('頁面醒著、已經排好下一段：晚幾秒到的推播還是顯示剛到點的那一則，不是還沒到的那一則', () =>
    withClock(async () => {
      const rest = { at: NOW + 5 * MIN, title: 'ひより · 休息結束', body: '' }
      const earlier = { at: NOW - 12 * MIN, title: 'ひより · 休息結束', body: '更早的一次' }
      const s = setup({ plans: [earlier, focus, rest] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => n.title)).toEqual([focus.title])
      // 休息結束那一則到的時候換它（假的快取回的是同一個 Response，讀過一次就空了：再放一次）
      await (await s.caches.open('hiyoripush')).put(SCOPE + '__timer-plan', new Response(JSON.stringify([earlier, focus, rest])))
      vi.setSystemTime(rest.at + 1500)
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => `${n.title}|${n.tag}`)).toEqual([`ひより · 休息結束|hiyori-focus-${rest.at}`])
      expect(await s.marker()).toEqual({ at: rest.at })
    }))

  it('找不到對得上的字（沒留、只有還沒到的、太久以前的、內容壞掉）：還是一定顯示一則通知', () =>
    withClock(async () => {
      for (const plans of [undefined, [], [{ at: NOW + 5 * MIN, title: '還沒到', body: '' }], [{ at: NOW - 40 * MIN, title: '舊的', body: '' }], [{ at: 'x', title: 5 }, null], 'oops', { at: NOW, title: '不是清單' }]) {
        const s = setup({ plans })
        await s.ready
        await run(s.on.push, { data: null })
        expect(s.shown(), JSON.stringify(plans)).toEqual([expect.objectContaining({ title: 'ひより · 計時到了', body: '', tag: 'hiyori-focus' })])
        expect(await s.marker()).toBeUndefined()
      }
    }))

  it('上一次到點的通知還留著就收掉，別的通知不動；查不到通知清單的瀏覽器照樣顯示', () =>
    withClock(async () => {
      const s = setup({ plans: [focus], before: [`hiyori-focus-${NOW - 30 * MIN}`, 'event-1'] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => n.tag).sort()).toEqual(['event-1', `hiyori-focus-${focus.at}`])

      for (const broken of ['missing', 'throws']) {
        const b = setup({ plans: [focus], broken, windows: () => [{ visibilityState: 'visible', focused: true }] })
        await b.ready
        const done = run(b.on.push, { data: null })
        await vi.advanceTimersByTimeAsync(5000)
        await done
        expect(b.alerts, broken).toEqual([focus.title])
      }
    }))

  it('正看著 App：通知幾秒後自己收掉（畫面上已經有提示）；沒在看、或這幾秒內切走了就留著', () =>
    withClock(async () => {
      let looking = true
      const s = setup({ plans: [focus], windows: () => [{ visibilityState: looking ? 'visible' : 'hidden', focused: looking }] })
      await s.ready
      let done = run(s.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(3000)
      expect(s.shown()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1500)
      await done
      expect(s.shown()).toEqual([])

      // 出來之後 2 秒切到別的 App：留著
      done = run(s.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(2000)
      looking = false
      await vi.advanceTimersByTimeAsync(3000)
      await done
      expect(s.shown()).toHaveLength(1)

      const bg = setup({ plans: [focus], windows: () => [{ visibilityState: 'hidden', focused: false }] })
      await bg.ready
      await run(bg.on.push, { data: null })
      expect(bg.shown()).toHaveLength(1)
    }))
})
