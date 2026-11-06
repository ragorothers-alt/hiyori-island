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
  it('新的同步碼是 28 碼 Crockford Base32（140 bits），輸入時容錯；以前的 16 碼照樣認得', () => {
    const code = newCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/)
    expect(normalizeCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code)
    expect(normalizeCode('o1il-0000-0000-0000')).toBe('0111-0000-0000-0000')
    expect(normalizeCode('ABCD-1234')).toBeNull()
    expect(normalizeCode('UUUU-0000-0000-0000')).toBeNull()
    // 長度不對（20、24 碼）不認
    expect(normalizeCode('0000-0000-0000-0000-0000')).toBeNull()
    expect(normalizeCode('0000-0000-0000-0000-0000-0000')).toBeNull()
  })

  it('以前的 16 碼和新的 28 碼推出不同的 vault，各自解得開自己的資料', async () => {
    const old = await deriveKeys('ABCD-EFGH-JKMN-PQRS')
    const neu = await deriveKeys(newCode())
    expect(old.id).toMatch(/^[0-9a-f]{64}$/)
    expect(neu.id).not.toBe(old.id)
    expect(await unseal(old.key, await seal(old.key, '舊的'))).toBe('舊的')
    expect(await unseal(neu.key, await seal(neu.key, '新的'))).toBe('新的')
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

  it('舊分頁（另一個分頁已經是新版 App）改了資料再切走：不把舊格式送上去', async () => {
    const { a } = await pair()
    const cloud = vaults()[0].data
    await a.run(async (s, sync) => {
      s.newerApp = true
      s.addTask({ title: '舊分頁加的' })
      calls = []
      sync.flush()
      await vi.waitFor(() => expect(sync.state).toBe('error'))
    })
    expect(a.sync.message).toContain('新版 App')
    expect(calls).toEqual([])
    expect(vaults()[0].data).toBe(cloud)
  })

  it('存檔讀不進來（換成範例島）時切走、或雲端沒有資料：都不把範例島推上去', async () => {
    const { a } = await pair()
    const cloud = vaults()[0].data
    await a.run(async (s, sync) => {
      s.loadFailed = { rescued: true }
      s.addTask({ title: '範例島上加的' })
      calls = []
      sync.flush()
      await vi.waitFor(() => expect(sync.state).toBe('error'))
      expect(calls).toEqual([])
      // 雲端那份不見了（被刪掉）：也不拿範例島補上
      sync._pull = async () => null
      sync.state = 'linked'
      await sync.sync()
      expect(sync.state).toBe('error')
    })
    expect(calls.map((c) => c.path)).not.toContain('/v1/push')
    expect(vaults()[0].data).toBe(cloud)
  })

  it('存檔壞掉讀不進來、雲端也沒變：重新打開時整份拿雲端的回來', async () => {
    const { a } = await pair()
    a.mem.setItem('hiyori-daily-v1', '{壞掉的')
    const prev = globalThis.localStorage
    globalThis.localStorage = a.mem
    try {
      const store = new Store()
      expect(store.loadFailed).toBeTruthy()
      const sync = new CloudSync(store)
      await sync.init()
      expect(titles(store)).toContain('A 的任務')
      expect(sync.state).toBe('linked')
    } finally {
      globalThis.localStorage = prev
    }
  })

  it('同一個瀏覽器的另一個分頁停止同步：這個分頁也停下來，不再往那組同步碼送資料', async () => {
    const { a, b } = await pair()
    // 同一台的第二個分頁：同一份 localStorage、同一組同步碼
    const tab2 = new CloudSync(a.store)
    await a.run(() => tab2.init())
    expect(tab2.state).toBe('linked')
    await a.run((_s, sync) => sync.stop())
    await a.run(() => tab2._codeChanged())
    expect(tab2.state).toBe('off')
    expect(tab2.keys).toBeNull()
    calls = []
    await a.run(async (s) => {
      s.addTask({ title: '停了之後寫的' })
      tab2.flush()
      await tab2.sync()
    })
    expect(calls).toEqual([])
    // 另一個分頁開了一組新的同步碼：跟著換
    const fresh = await a.run((_s, sync) => sync.start())
    expect(fresh).not.toBe(b.sync.code)
    await a.run(() => tab2._codeChanged())
    expect(tab2.state).toBe('linked')
    expect(tab2.code).toBe(fresh)
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

  it('寫入和刪除要帶對的 auth：只知道 id 的人讀得到密文，但不能寫、不能刪', async () => {
    const auth = 'c'.repeat(64)
    const wrong = 'd'.repeat(64)
    expect((await post('/v1/create', { id, auth: 'short' })).status).toBe(400)
    expect((await post('/v1/create', { id, auth })).status).toBe(200)
    expect(vaults()[0].auth).toMatch(/^[0-9a-f]{64}$/)
    expect(vaults()[0].auth).not.toBe(auth)
    const push = (extra) => post('/v1/push', { id, base: null, rev: 'r1', savedAt: 5, data: 'AA==', ...extra })
    expect((await push({})).status).toBe(403)
    expect((await push({ auth: wrong })).status).toBe(403)
    expect((await push({ auth })).status).toBe(200)
    // 版本對不上時：auth 錯的先擋（403），對的才告訴它雲端是哪一版（409）
    expect((await push({ auth: wrong, rev: 'r9' })).status).toBe(403)
    expect((await push({ auth, rev: 'r9' })).status).toBe(409)
    expect((await post('/v1/pull', { id })).status).toBe(200)
    expect((await post('/v1/delete', { id })).status).toBe(403)
    expect((await post('/v1/delete', { id, auth: wrong })).status).toBe(403)
    expect(vaults()).toHaveLength(1)
    expect((await post('/v1/delete', { id, auth })).status).toBe(200)
    expect(vaults()).toHaveLength(0)
    // 本來就沒有的 vault 也算刪好了
    expect((await post('/v1/delete', { id, auth })).status).toBe(200)
  })

  it('舊的 vault（沒有 auth）：舊版前端照常寫；第一次帶 auth 寫入就記下來，之後不帶的寫不進去', async () => {
    const auth = 'e'.repeat(64)
    await post('/v1/create', { id })
    expect((await post('/v1/push', { id, base: null, rev: 'r1', savedAt: 5, data: 'AA==' })).status).toBe(200)
    expect((await post('/v1/push', { id, auth, base: 'r1', rev: 'r2', savedAt: 6, data: 'AA==' })).status).toBe(200)
    expect((await post('/v1/push', { id, base: 'r2', rev: 'r3', savedAt: 7, data: 'AA==' })).status).toBe(403)
    expect((await post('/v1/push', { id, auth, base: 'r2', rev: 'r3', savedAt: 7, data: 'AA==' })).status).toBe(200)
  })

  it('線上同步會帶 auth：伺服器記下了，只拿到 id 的人寫不進去', async () => {
    const { a } = await pair()
    expect(vaults()[0].auth).toBeTruthy()
    const before = vaults()[0].rev
    const res = await post('/v1/push', { id: a.sync.keys.id, base: before, rev: 'evil1', savedAt: 1, data: 'AA==' })
    expect(res.status).toBe(403)
    expect(vaults()[0].rev).toBe(before)
  })

  it('一天能建立的 vault 有上限；建了一天以上還沒放資料的會清掉；資料庫滿了不能再建', async () => {
    env.CREATE_DAILY = 2
    const ids = ['1', '2', '3'].map((c) => c.repeat(64))
    expect((await post('/v1/create', { id: ids[0] })).status).toBe(200)
    expect((await post('/v1/create', { id: ids[1] })).status).toBe(200)
    const busy = await post('/v1/create', { id: ids[2] })
    expect(busy.status).toBe(429)
    expect(await busy.json()).toEqual({ error: 'busy' })
    // 隔天：前兩個一直沒放資料，被清掉，又能建
    later(86_400_000 + 1000)
    expect((await post('/v1/create', { id: ids[2] })).status).toBe(200)
    expect(vaults().map((v) => v.created_at)).toHaveLength(1)
    await post('/v1/push', { id: ids[2], base: null, rev: 'r1', savedAt: 5, data: 'AAAA' })
    env.MAX_TOTAL = 3
    later(86_400_000 + 1000)
    expect((await post('/v1/create', { id: ids[0] })).status).toBe(507)
  })

  it('資料庫的總量上限也管寫入：變大的寫入擋下，變小的照常寫', async () => {
    const ids = ['1', '2'].map((c) => c.repeat(64))
    for (const i of ids) await post('/v1/create', { id: i })
    await post('/v1/push', { id: ids[0], base: null, rev: 'r1', savedAt: 5, data: 'A'.repeat(40) })
    env.MAX_TOTAL = 60
    const grow = await post('/v1/push', { id: ids[1], base: null, rev: 'r1', savedAt: 5, data: 'A'.repeat(40) })
    expect(grow.status).toBe(507)
    expect((await post('/v1/push', { id: ids[1], base: null, rev: 'r1', savedAt: 5, data: 'A'.repeat(20) })).status).toBe(200)
    expect((await post('/v1/push', { id: ids[0], base: 'r1', rev: 'r2', savedAt: 6, data: 'A'.repeat(8) })).status).toBe(200)
    expect((await post('/v1/push', { id: ids[0], base: 'r2', rev: 'r3', savedAt: 7, data: 'A'.repeat(40) })).status).toBe(200)
    expect((await post('/v1/push', { id: ids[0], base: 'r3', rev: 'r4', savedAt: 8, data: 'A'.repeat(44) })).status).toBe(507)
  })

  it('同時來的好幾個寫入不會一起把總量撐過上限；版本不對照樣回衝突', async () => {
    const ids = ['1', '2'].map((c) => c.repeat(64))
    for (const i of ids) await post('/v1/create', { id: i })
    env.MAX_TOTAL = 60
    const res = await Promise.all(ids.map((i) => post('/v1/push', { id: i, base: null, rev: 'r1', savedAt: 5, data: 'A'.repeat(40) })))
    expect(res.map((r) => r.status).sort()).toEqual([200, 507])
    expect(vaults().reduce((a, v) => a + v.size, 0)).toBeLessThanOrEqual(60)
    const stale = await post('/v1/push', { id: ids[0], base: 'nope1', rev: 'r9', savedAt: 9, data: 'A'.repeat(4) })
    expect(stale.status).toBe(409)
  })

  it('還沒記下 auth 的舊 vault：只憑 id 刪不掉；期限過了也不能再搶先登記', async () => {
    const auth = 'e'.repeat(64)
    await post('/v1/create', { id })
    expect((await post('/v1/push', { id, base: null, rev: 'r1', savedAt: 5, data: 'AA==' })).status).toBe(200)
    expect((await post('/v1/delete', { id })).status).toBe(403)
    const unclaimed = await post('/v1/delete', { id, auth })
    expect(unclaimed.status).toBe(409)
    expect(await unclaimed.json()).toEqual({ error: 'unclaimed', rev: 'r1' })
    expect(vaults()).toHaveLength(1)
    env.LEGACY_UNTIL = Date.now() - 1
    const late = await post('/v1/push', { id, auth, base: 'r1', rev: 'r2', savedAt: 6, data: 'AA==' })
    expect(late.status).toBe(403)
    expect(await late.json()).toEqual({ error: 'legacy' })
    expect(vaults()[0].auth).toBeNull()
  })

  it('刪除還沒記下 auth 的舊 vault：前端先寫一次記下 auth 再刪', async () => {
    const { a } = await pair()
    // 假裝是加上 auth 以前建的 vault
    env.DB.raw.prepare('UPDATE vaults SET auth = NULL').run()
    await a.run((_s, sync) => sync.destroy())
    expect(vaults()).toHaveLength(0)
    expect(a.sync.state).toBe('off')
  })

  it('沒料到的錯誤也回 JSON 和 CORS 標頭', async () => {
    const res = await worker.fetch(new Request('https://sync.test/v1/pull', { method: 'POST', body: JSON.stringify({ id }) }), {})
    expect(res.status).toBe(500)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual({ error: 'server error' })
  })
})
