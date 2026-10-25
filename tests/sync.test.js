import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/store.js'
import { FileSync } from '../src/sync.js'

// 模擬兩台裝置：各自一份 localStorage，共用同一個雲端檔案
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
  clear() {
    this.map.clear()
  }
}

function fakeFile() {
  const f = {
    name: 'hiyori-sync.json',
    content: '',
    getFile: async () => ({ text: async () => f.content }),
    createWritable: async () => {
      let buf = ''
      return { write: async (d) => (buf += d), close: async () => (f.content = buf) }
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    isSameEntry: async (o) => o === f,
  }
  return f
}

function device() {
  const mem = new Mem()
  const prev = globalThis.localStorage
  globalThis.localStorage = mem
  const store = new Store()
  const sync = new FileSync(store)
  globalThis.localStorage = prev
  // 每次操作這台裝置前，切換成它自己的 localStorage
  const run = async (fn) => {
    globalThis.localStorage = mem
    return fn(store, sync)
  }
  return { store, sync, mem, run }
}

async function link(dev, file) {
  await dev.run(async (_s, sync) => {
    sync.state = 'off'
    await sync._link(file)
  })
}

let file
beforeAll(() => {
  globalThis.window ??= globalThis
  globalThis.addEventListener ??= () => {}
  globalThis.document ??= { hidden: true, addEventListener() {} }
})
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 25, 12))
  file = fakeFile()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms)
const titles = (x) => (x.state ?? x).tasks.map((t) => t.title)

describe('雲端資料夾同步', () => {
  it('只有例行實例生成與跨日的存檔不算使用者變更', () => {
    globalThis.localStorage = new Mem()
    const fresh = new Store()
    expect(fresh.state.updatedAt).toBe(0)
    fresh.addRoutine({ title: '澆花', repeat: { type: 'daily' } })
    const at = fresh.state.updatedAt
    expect(at).toBe(Date.now())
    later()
    fresh.selectDate('2026-10-26')
    vi.setSystemTime(new Date(2026, 9, 26, 9))
    fresh.tick()
    expect(fresh.tasksOn('2026-10-26')).toHaveLength(1)
    expect(fresh.state.updatedAt).toBe(at)
  })

  it('連結空檔案時寫入目前的小島，之後的變更也會寫出去', async () => {
    const a = device()
    await link(a, file)
    const saved = JSON.parse(file.content)
    expect(saved).toMatchObject({ app: 'hiyori', savedAt: a.store.state.updatedAt })
    expect(a.sync.state).toBe('linked')

    later()
    await a.run(async (s, sync) => {
      s.addTask({ title: '新任務' })
      await sync.sync()
    })
    expect(titles(JSON.parse(file.content).state)).toContain('新任務')
  })

  it('全新裝置連結既有檔案會直接載入，不會問衝突', async () => {
    const a = device()
    await a.run((s) => s.addTask({ title: 'A 的任務' }))
    await link(a, file)
    later()
    const b = device()
    expect(b.store.state.updatedAt).toBe(0)
    await link(b, file)
    expect(b.sync.state).toBe('linked')
    expect(titles(b.store)).toContain('A 的任務')
  })

  it('只有一邊改過時，另一台下次同步會拉回新資料並備份舊的', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file) // b 全新 → 載入 a
    later()
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
  })

  it('兩邊都改過時進入衝突狀態，不會自動覆蓋任何一邊', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    await a.run(async (s, sync) => {
      s.addTask({ title: 'A 改的' })
      await sync.sync()
    })
    const before = file.content
    later()
    await b.run(async (s, sync) => {
      s.addTask({ title: 'B 改的' })
      await sync.sync()
    })
    expect(b.sync.state).toBe('conflict')
    expect(file.content).toBe(before)
    expect(titles(b.store)).toContain('B 改的')
    expect(titles(b.store)).not.toContain('A 改的')
  })

  it('衝突選「用雲端的」載入檔案，這台的版本留在備份裡可還原', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    await a.run(async (s, sync) => (s.addTask({ title: 'A 改的' }), sync.sync()))
    later()
    await b.run(async (s, sync) => (s.addTask({ title: 'B 改的' }), sync.sync()))
    await b.run((_s, sync) => sync.resolve('file'))
    expect(titles(b.store)).toContain('A 改的')
    expect(titles(b.store)).not.toContain('B 改的')
    expect(b.sync.backup.from).toBe('local')
    await b.run((_s, sync) => sync.restoreBackup())
    expect(titles(b.store)).toContain('B 改的')
  })

  it('衝突選「用這台的」寫進檔案，檔案原本的版本留在備份裡', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    await a.run(async (s, sync) => (s.addTask({ title: 'A 改的' }), sync.sync()))
    later()
    await b.run(async (s, sync) => (s.addTask({ title: 'B 改的' }), sync.sync()))
    await b.run((_s, sync) => sync.resolve('local'))
    const saved = JSON.parse(file.content)
    expect(titles(saved.state)).toContain('B 改的')
    expect(titles(saved.state)).not.toContain('A 改的')
    expect(b.sync.backup.from).toBe('file')
    expect(titles(b.sync.backup.state)).toContain('A 改的')
    // A 沒有再改，下次同步直接拿到 B 的版本
    await a.run((_s, sync) => sync.sync())
    expect(titles(a.store)).toContain('B 改的')
  })

  it('檔案不是ひより的同步檔時顯示錯誤，資料不動', async () => {
    file.content = '{"hello":1}'
    const a = device()
    await a.run((s) => s.addTask({ title: '保留' }))
    await link(a, file)
    expect(a.sync.state).toBe('error')
    expect(a.sync.message).toBe('這不是ひより的同步檔')
    expect(titles(a.store)).toContain('保留')
    expect(file.content).toBe('{"hello":1}')
  })

  it('沒有權限時改成等待授權，按「繼續同步」後恢復', async () => {
    const a = device()
    file.getFile = async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    }
    await link(a, file)
    expect(a.sync.state).toBe('needs-permission')
    file.getFile = async () => ({ text: async () => file.content })
    await a.run((_s, sync) => sync.resume())
    expect(a.sync.state).toBe('linked')
    expect(JSON.parse(file.content).app).toBe('hiyori')
  })
})
