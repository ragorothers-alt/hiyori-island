import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { MAX_DATA } from '../worker/src/index.js'
import { Store } from '../src/store.js'
import { CloudSync, codeFromHash, deriveKeys, newCode, normalizeCode, seal, shareLink, unseal } from '../src/cloud.js'
import { FileSync } from '../src/sync.js'
import { createD1 } from './helpers/d1.js'

// 每台裝置各自一份 localStorage；fetch 直接交給真正的 Worker 程式，資料庫是記憶體裡的 SQLite
class Mem {
  constructor() {
    this.map = new Map()
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null
  }
  setItem(k, v) {
    this.map.set(k, String(v))
  }
  removeItem(k) {
    this.map.delete(k)
  }
}

let env
let calls
let offline
let gate // 設成一個 Promise 時，請求會卡在這裡等它（模擬網路很慢）
beforeAll(() => {
  globalThis.window ??= globalThis
  globalThis.addEventListener ??= () => {}
  globalThis.document ??= { hidden: true, addEventListener() {} }
})
beforeEach(() => {
  // 只換計時器和時鐘：加密、壓縮用到的串流要照常跑
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(2026, 9, 31, 12))
  env = { DB: createD1() }
  calls = []
  offline = false
  gate = null
  globalThis.fetch = async (url, init) => {
    if (gate) await gate
    if (offline) throw new TypeError('fetch failed')
    const res = await worker.fetch(new Request(url, init), env)
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body), keepalive: init.keepalive, status: res.status, size: Number(res.headers.get('content-length')) || (await res.clone().text()).length })
    return res
  }
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

function device() {
  const mem = new Mem()
  const prev = globalThis.localStorage
  globalThis.localStorage = mem
  const store = new Store()
  const sync = new CloudSync(store)
  globalThis.localStorage = prev
  const run = async (fn) => {
    globalThis.localStorage = mem
    return fn(store, sync)
  }
  return { store, sync, mem, run }
}

const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms)
const titles = (x) => (x.state ?? x).tasks.map((t) => t.title)
const vaults = () => env.DB.raw.prepare('SELECT * FROM vaults').all()

async function pair() {
  const a = device()
  await a.run((s) => s.addTask({ title: 'A 的任務' }))
  const code = await a.run((_s, sync) => sync.start())
  later()
  const b = device()
  await b.run((_s, sync) => sync.join(code))
  later()
  return { a, b, code }
}

describe('同步碼與加密', () => {
  it('同步碼是 16 碼 Crockford Base32，輸入時容錯', () => {
    const code = newCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
    expect(normalizeCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code)
    expect(normalizeCode('o1il-0000-0000-0000')).toBe('0111-0000-0000-0000')
    expect(normalizeCode('ABCD-1234')).toBeNull()
    expect(normalizeCode('UUUU-0000-0000-0000')).toBeNull()
  })

  it('分享連結把同步碼放在 # 後面，讀得回來', () => {
    const link = shareLink('ABCD-EFGH-JKMN-PQRS', 'https://x.github.io/hiyori/?tab=records#old')
    expect(link).toBe('https://x.github.io/hiyori/?tab=records#sync=ABCD-EFGH-JKMN-PQRS')
    expect(codeFromHash('#sync=abcd-efgh-jkmn-pqrs')).toBe('ABCD-EFGH-JKMN-PQRS')
    expect(codeFromHash('#tab=1')).toBeNull()
    // % 編碼壞掉的連結不能讓 App 啟動失敗
    expect(codeFromHash('#sync=%E0%A4%A')).toBeNull()
    expect(codeFromHash('#sync=%')).toBeNull()
  })

  it('同一組同步碼推導出同樣的 id，加密後解得回來；別組同步碼解不開', async () => {
    const code = newCode()
    const k1 = await deriveKeys(code)
    const k2 = await deriveKeys(code)
    expect(k1.id).toMatch(/^[0-9a-f]{64}$/)
    expect(k2.id).toBe(k1.id)
    const text = JSON.stringify({ hello: '小島'.repeat(500) })
    const box = await seal(k1.key, text)
    expect(box.length).toBeLessThan(text.length) // 有壓縮
    expect(await unseal(k2.key, box)).toBe(text)
    const other = await deriveKeys(newCode())
    expect(other.id).not.toBe(k1.id)
    await expect(unseal(other.key, box)).rejects.toThrow('解不開')
  })
})

describe('線上同步', () => {
  it('開始同步會建立雲端資料並上傳；伺服器只存密文和 id 的雜湊', async () => {
    const a = device()
    await a.run((s) => s.addTask({ title: '秘密的任務' }))
    const code = await a.run((_s, sync) => sync.start())
    expect(a.sync.state).toBe('linked')
    expect(a.mem.getItem('hiyori-cloud-code')).toBe(code)
    const [row] = vaults()
    expect(row.saved_at).toBe(a.store.state.updatedAt)
    expect(row.rev).toBe(a.store.state.rev)
    expect(row.data).not.toContain('秘密')
    expect(atob(row.data)).not.toContain('task')
    const { id } = await deriveKeys(code)
    expect(row.hash).not.toBe(id)
    // 請求裡也沒有同步碼本身
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain(code.replace(/-/g, ''))
  })

  it('全新裝置輸入同步碼直接載入，不會問衝突', async () => {
    const { b } = await pair()
    expect(b.sync.state).toBe('linked')
    expect(titles(b.store)).toContain('A 的任務')
  })

  it('已經有資料的裝置輸入同步碼時先問要用哪一邊', async () => {
    const a = device()
    await a.run((s) => s.addTask({ title: 'A 的任務' }))
    const code = await a.run((_s, sync) => sync.start())
    later()
    const b = device()
    await b.run((s) => s.addTask({ title: 'B 自己的' }))
    await b.run((_s, sync) => sync.join(code))
    expect(b.sync.state).toBe('conflict')
    expect(b.sync.conflict.first).toBe(true)
    await b.run((_s, sync) => sync.resolve('local'))
    await a.run((_s, sync) => sync.sync())
    expect(titles(a.store)).toContain('B 自己的')
    expect(a.sync.backup.from).toBe('local')
  })

  it('一邊改了，另一台下次同步拉回；沒有新資料時只回傳版本號', async () => {
    const { a, b } = await pair()
    await a.run(async (s, sync) => {
      s.addTask({ title: '在 A 加的' })
      await sync.sync()
    })
    const pulled = vi.fn()
    b.sync.onPulled = pulled
    await b.run((_s, sync) => sync.sync())
    expect(titles(b.store)).toContain('在 A 加的')
    expect(pulled).toHaveBeenCalledTimes(1)
    expect(b.sync.backup.from).toBe('local')

    calls = []
    await b.run((_s, sync) => sync.sync())
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe('/v1/pull')
    expect(calls[0].size).toBeLessThan(100)
  })

  it('兩邊都改過時進入衝突，選「用雲端的」後這台的版本留在備份裡', async () => {
    const { a, b } = await pair()
    await a.run(async (s, sync) => (s.addTask({ title: 'A 改的' }), sync.sync()))
    later()
    await b.run(async (s, sync) => (s.addTask({ title: 'B 改的' }), sync.sync()))
    expect(b.sync.state).toBe('conflict')
    expect(b.sync.conflict.remoteAt).toBe(a.store.state.updatedAt)
    expect(b.sync.conflict.first).toBe(false)
    await b.run((_s, sync) => sync.resolve('remote'))
    expect(titles(b.store)).toContain('A 改的')
    expect(titles(b.store)).not.toContain('B 改的')
    expect(b.sync.backup.from).toBe('local')
    expect(titles(b.sync.backup.state)).toContain('B 改的')
  })

  it('衝突選「用這台的」會上傳，雲端原本的版本留在備份裡，另一台下次拉到', async () => {
    const { a, b } = await pair()
    await a.run(async (s, sync) => (s.addTask({ title: 'A 改的' }), sync.sync()))
    later()
    await b.run(async (s, sync) => (s.addTask({ title: 'B 改的' }), sync.sync()))
    await b.run((_s, sync) => sync.resolve('local'))
    expect(b.sync.state).toBe('linked')
    expect(b.sync.backup.from).toBe('cloud')
    expect(titles(b.sync.backup.state)).toContain('A 改的')
    await a.run((_s, sync) => sync.sync())
    expect(titles(a.store)).toContain('B 改的')
    expect(titles(a.store)).not.toContain('A 改的')
  })

  it('兩台在同一毫秒（或時鐘都比較慢）各改一筆，版本時間一樣也會問衝突', async () => {
    const { a, b } = await pair()
    await a.run((s) => s.addTask({ title: 'A 同時改' }))
    await b.run((s) => s.addTask({ title: 'B 同時改' }))
    expect(b.store.state.updatedAt).toBe(a.store.state.updatedAt)
    await a.run((_s, sync) => sync.sync())
    await b.run((_s, sync) => sync.sync())
    expect(b.sync.state).toBe('conflict')
    expect(titles(b.store)).toContain('B 同時改')
  })

  it('同步途中停止或換同步碼，還在路上的請求回來後不會改狀態', async () => {
    const { a } = await pair()
    await a.run((s) => s.addTask({ title: '慢慢送' }))
    let release
    gate = new Promise((r) => (release = r))
    const pending = a.run((_s, sync) => sync.sync())
    a.sync.stop()
    release()
    await pending
    expect(a.sync.state).toBe('off')
    expect(a.sync.keys).toBeNull()
    expect(a.sync.base).toBe('')
  })

  it('瀏覽器空間不夠、沒辦法備份時，選邊不會替換任何一邊', async () => {
    const { a, b } = await pair()
    await a.run(async (s, sync) => (s.addTask({ title: 'A 改的' }), sync.sync()))
    later()
    await b.run(async (s, sync) => (s.addTask({ title: 'B 改的' }), sync.sync()))
    const pushes = calls.filter((c) => c.path === '/v1/push').length
    const setItem = b.mem.setItem.bind(b.mem)
    b.mem.setItem = (k, v) => {
      if (k === 'hiyori-backup') throw new DOMException('full', 'QuotaExceededError')
      setItem(k, v)
    }
    await b.run((_s, sync) => sync.resolve('remote'))
    expect(b.sync.state).toBe('error')
    expect(b.sync.message).toContain('空間不夠')
    expect(titles(b.store)).toContain('B 改的')
    expect(titles(b.store)).not.toContain('A 改的')
    await b.run((_s, sync) => ((sync.conflict = { ...a.store.state, rev: a.store.state.rev, savedAt: 1, state: a.store.state }), (sync.state = 'conflict'), sync.resolve('local')))
    expect(calls.filter((c) => c.path === '/v1/push').length).toBe(pushes)
  })

  it('同一台同時開線上同步和資料夾同步：選了比較舊的雲端版本，資料夾也會跟上', async () => {
    const { a, b } = await pair()
    // B 另外連一個同步檔，寫進比較新的版本
    const file = { content: '', name: 'f.json', getFile: async () => ({ text: async () => file.content }), createWritable: async () => ({ write: async (d) => (file.content = d), close: async () => {} }), isSameEntry: async () => false }
    const fs = await b.run(async (s) => {
      const f = new FileSync(s)
      f.state = 'off'
      await f._link(file)
      return f
    })
    await a.run(async (s, sync) => (s.addTask({ title: 'A 先改（比較舊）' }), sync.sync()))
    later()
    await b.run(async (s, sync) => (s.addTask({ title: 'B 後改（比較新）' }), Promise.all([sync.sync(), fs.sync()])))
    expect(titles(JSON.parse(file.content).state)).toContain('B 後改（比較新）')
    expect(b.sync.state).toBe('conflict')
    await b.run((_s, sync) => sync.resolve('remote'))
    await b.run(() => fs.sync())
    expect(titles(JSON.parse(file.content).state)).toContain('A 先改（比較舊）')
    expect(titles(JSON.parse(file.content).state)).not.toContain('B 後改（比較新）')
  })

  it('別台在拉和寫之間搶先寫入時，伺服器拒絕舊版本，這台改成問衝突', async () => {
    const { a, b } = await pair()
    await a.run(async (s, sync) => (s.addTask({ title: 'A 搶先' }), sync.sync()))
    later()
    await b.run(async (s, sync) => {
      s.addTask({ title: 'B 慢一步' })
      // 跳過拉取，直接用舊的 base 寫：模擬兩台同時寫
      await sync._run(() => sync._write(sync.base))
    })
    expect(calls.some((c) => c.path === '/v1/push' && c.status === 409)).toBe(true)
    expect(b.sync.state).toBe('conflict')
    expect(titles(b.sync.conflict.state)).toContain('A 搶先')
    expect(titles(b.store)).toContain('B 慢一步')
  })

  it('這台時鐘比別台慢時，拉回資料後的新變更仍會上傳', async () => {
    const a = device()
    const code = await a.run((_s, sync) => sync.start())
    later(10 * 60000) // A 的時鐘快十分鐘
    await a.run(async (s, sync) => (s.addTask({ title: 'A 改的' }), sync.sync()))
    vi.setSystemTime(Date.now() - 10 * 60000)
    const b = device()
    await b.run((_s, sync) => sync.join(code))
    await b.run(async (s, sync) => (s.addTask({ title: 'B 接著改' }), sync.sync()))
    expect(b.sync.state).toBe('linked')
    await a.run((_s, sync) => sync.sync())
    expect(titles(a.store)).toContain('B 接著改')
  })

  it('同步碼打錯或格式不對時不會連上', async () => {
    const a = device()
    await expect(a.run((_s, sync) => sync.join('1234'))).rejects.toThrow('16 個')
    await expect(a.run((_s, sync) => sync.join(newCode()))).rejects.toThrow('找不到這組同步碼')
    expect(a.sync.state).toBe('off')
    expect(a.mem.getItem('hiyori-cloud-code')).toBeNull()
  })

  it('離線時進入離線狀態，恢復連線後補上傳', async () => {
    const { a, b } = await pair()
    offline = true
    await a.run(async (s, sync) => (s.addTask({ title: '離線時加的' }), sync.sync()))
    expect(a.sync.state).toBe('offline')
    offline = false
    await a.run((_s, sync) => sync.sync())
    expect(a.sync.state).toBe('linked')
    await b.run((_s, sync) => sync.sync())
    expect(titles(b.store)).toContain('離線時加的')
  })

  it('切到背景時直接送出還沒同步的變更（keepalive）', async () => {
    const { a, b } = await pair()
    await a.run((s) => s.addTask({ title: '馬上切走' }))
    calls = []
    await a.run(async (_s, sync) => {
      sync.flush()
      await vi.waitFor(() => expect(sync.base).toBe(a.store.state.rev))
    })
    expect(calls.map((c) => [c.path, c.keepalive])).toEqual([['/v1/push', true]])
    await b.run((_s, sync) => sync.sync())
    expect(titles(b.store)).toContain('馬上切走')
  })

  it('重新開啟 App 時用記住的同步碼繼續同步', async () => {
    const { a, code } = await pair()
    const again = new CloudSync(a.store)
    await a.run(() => again.init())
    expect(again.state).toBe('linked')
    expect(again.code).toBe(code)
  })

  it('停止同步只忘記同步碼；刪除雲端資料後別台會看到錯誤', async () => {
    const { a, b } = await pair()
    await b.run((_s, sync) => sync.stop())
    expect(b.sync.state).toBe('off')
    expect(b.mem.getItem('hiyori-cloud-code')).toBeNull()
    expect(vaults()).toHaveLength(1)
    await b.run((_s, sync) => sync.join(a.sync.code))
    await a.run((_s, sync) => sync.destroy())
    expect(vaults()).toHaveLength(0)
    await b.run((_s, sync) => sync.sync())
    expect(b.sync.state).toBe('error')
    expect(b.sync.message).toContain('找不到這組同步碼')
  })
})

describe('同步伺服器', () => {
  const post = (path, body) => worker.fetch(new Request(`https://sync.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env)
  const id = 'a'.repeat(64)

  it('首頁與 CORS 預檢', async () => {
    expect(await (await worker.fetch(new Request('https://sync.test/'), env)).text()).toBe('hiyori-sync ok')
    const pre = await worker.fetch(new Request('https://sync.test/v1/push', { method: 'OPTIONS' }), env)
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('檢查 id、版本和資料格式', async () => {
    expect((await post('/v1/create', { id: 'nope' })).status).toBe(400)
    expect((await post('/v1/create', { id })).status).toBe(200)
    expect((await post('/v1/create', { id })).status).toBe(409)
    expect((await post('/v1/pull', { id: 'b'.repeat(64) })).status).toBe(404)
    expect(await (await post('/v1/pull', { id, have: null })).json()).toEqual({ rev: null, savedAt: 0, same: true })
    expect((await post('/v1/push', { id, base: null, rev: 'bad rev!', savedAt: 5, data: 'AA==' })).status).toBe(400)
    expect((await post('/v1/push', { id, base: 'r1', rev: 'r1', savedAt: 5, data: 'AA==' })).status).toBe(400)
    expect((await post('/v1/push', { id, base: null, rev: 'r1', savedAt: 5, data: '<script>' })).status).toBe(400)
    expect((await post('/v1/push', { id, base: null, rev: 'r1', savedAt: 5, data: 'A'.repeat(MAX_DATA + 4) })).status).toBe(413)
    expect((await post('/v1/push', { id, base: null, rev: 'r1', savedAt: 5, data: 'AA==' })).status).toBe(200)
    const stale = await post('/v1/push', { id, base: null, rev: 'r2', savedAt: 6, data: 'AA==' })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'conflict', rev: 'r1' })
    // 時間比較舊也寫得進去：只看是不是接在雲端那一版後面
    expect((await post('/v1/push', { id, base: 'r1', rev: 'r2', savedAt: 3, data: 'AQ==' })).status).toBe(200)
    expect(await (await post('/v1/pull', { id, have: 'r2' })).json()).toEqual({ rev: 'r2', savedAt: 3, same: true })
    expect(await (await post('/v1/pull', { id, have: 'r1' })).json()).toEqual({ rev: 'r2', savedAt: 3, data: 'AQ==' })
  })
})
