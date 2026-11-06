// Service Worker（public/sw.js）：用假的 caches 跑它的事件，檢查更新時的快取搬移和離線首頁
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
function loadSW({ version = 'hiyori-new', build = [], caches, fetch = async () => new Response('ok'), clients = {} }) {
  const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .replace("const VERSION = 'hiyori-v1'", `const VERSION = '${version}'`)
    .replace('const BUILD = []', `const BUILD = ${JSON.stringify(build)}`)
  const on = {}
  const self = {
    addEventListener: (type, fn) => (on[type] = fn),
    registration: { scope: SCOPE },
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
