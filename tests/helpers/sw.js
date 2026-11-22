// 跑 Service Worker（public/sw.js）用的假環境：假的 caches、照建置時的樣子載入 sw.js、拿到它註冊的事件
import { readFileSync } from 'node:fs'

export const SCOPE = 'https://hiyori.test/app/'

export class FakeCache {
  constructor(fetcher) {
    this.map = new Map()
    this.fetcher = fetcher
  }
  // 跟真的一樣：每次讀到的是一份新的（讀過一次還能再讀）
  async match(req) {
    return this.map.get(typeof req === 'string' ? new URL(req, SCOPE).href : req.url)?.clone()
  }
  async put(req, res) {
    this.map.set(typeof req === 'string' ? new URL(req, SCOPE).href : req.url, res)
  }
  async delete(req) {
    return this.map.delete(typeof req === 'string' ? new URL(req, SCOPE).href : req.url)
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
export class FakeCaches {
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
  async has(name) {
    return this.all.has(name)
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
export function loadSW({ version = 'hiyori-new', build = [], entry = '', caches, fetch = async () => new Response('ok'), clients = {}, registration = {} }) {
  const src = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
    .replace("const VERSION = 'hiyori-v1'", `const VERSION = '${version}'`)
    .replace('const BUILD = []', `const BUILD = ${JSON.stringify(build)}`)
    .replace("const ENTRY = ''", `const ENTRY = ${JSON.stringify(entry)}`)
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
export const run = async (handler, event) => {
  let wait
  handler({ ...event, waitUntil: (p) => (wait = p), respondWith: (p) => (wait = p) })
  return wait
}
