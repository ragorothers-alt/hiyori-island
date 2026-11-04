// Service Worker（public/sw.js）：用假的 caches 跑它的事件，檢查更新時的快取搬移和離線首頁
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SCOPE = 'https://hiyori.test/app/'

class FakeCache {
  constructor() {
    this.map = new Map()
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
  async addAll() {}
}
class FakeCaches {
  constructor() {
    this.all = new Map()
  }
  async open(name) {
    if (!this.all.has(name)) this.all.set(name, new FakeCache())
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
function loadSW({ version = 'hiyori-new', build = [], caches, fetch = async () => new Response('ok') }) {
  const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .replace("const VERSION = 'hiyori-v1'", `const VERSION = '${version}'`)
    .replace('const BUILD = []', `const BUILD = ${JSON.stringify(build)}`)
  const on = {}
  const self = {
    addEventListener: (type, fn) => (on[type] = fn),
    registration: { scope: SCOPE },
    location: new URL('sw.js', SCOPE),
    clients: { claim: async () => {} },
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
})
