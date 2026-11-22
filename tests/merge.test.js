import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { merge3 } from '../src/merge.js'
import { giftCoins } from '../src/data/bond.js'
import { Store } from '../src/store.js'
import { FileSync, readBackups } from '../src/sync.js'

const T = (id, o = {}) => ({ id, title: id, date: '2026-11-22', at: null, dur: null, done: false, ...o })
const S = (o = {}) => ({ tallyGen: 'g1', updatedAt: 1, tasks: [], events: [], player: { xp: 100, coins: 10, streak: 3, charms: 1, stats: { tasksDone: 5, bestStreak: 4 } }, history: {}, ...o })
const ids = (s) => s.tasks.map((t) => t.id)

describe('三方合併（merge3）', () => {
  it('只有一邊改的地方照那一邊；兩邊改了不同的任務，兩邊的都留著', () => {
    const base = S({ tasks: [T('a'), T('b')] })
    const mine = S({ tasks: [T('a', { title: 'A 改了' }), T('b')], updatedAt: 3 })
    const theirs = S({ tasks: [T('a'), T('b', { done: true })], updatedAt: 2 })
    const r = merge3(base, mine, theirs)
    expect(r.clashes).toEqual([])
    expect(r.state.tasks).toEqual([T('a', { title: 'A 改了' }), T('b', { done: true })])
  })

  it('兩邊新增的都留著：這台的照原本的順序，雲端新增的接在雲端那邊它前面那一筆後面', () => {
    const base = S({ tasks: [T('a'), T('b')] })
    const mine = S({ tasks: [T('a'), T('b'), T('m')] })
    const theirs = S({ tasks: [T('t0'), T('a'), T('t1'), T('b')] })
    expect(ids(merge3(base, mine, theirs).state)).toEqual(['t0', 'a', 't1', 'b', 'm'])
  })

  it('一邊刪掉、另一邊沒動：刪掉；一邊刪掉、另一邊改過：留著改過的（算一處兩邊都改了）', () => {
    const base = S({ tasks: [T('a'), T('b')] })
    const mine = S({ tasks: [T('b', { title: 'B 改了' })] })
    const theirs = S({ tasks: [T('a')] })
    const r = merge3(base, mine, theirs)
    expect(r.state.tasks).toEqual([T('b', { title: 'B 改了' })])
    expect(r.clashes).toEqual(['tasks'])
  })

  it('兩邊改了同一個欄位：用比較晚改的那一邊（整份的 updatedAt）', () => {
    const base = S({ tasks: [T('a')] })
    const mine = S({ tasks: [T('a', { title: '這台的' })], updatedAt: 5 })
    const theirs = S({ tasks: [T('a', { title: '雲端的' })], updatedAt: 9 })
    const r = merge3(base, mine, theirs)
    expect(r.state.tasks[0].title).toBe('雲端的')
    expect(r.clashes).toEqual(['tasks.title'])
    expect(r.state.updatedAt).toBe(9)
    expect(merge3(base, { ...mine, updatedAt: 10 }, theirs).state.tasks[0].title).toBe('這台的')
  })

  it('累計的數字兩邊加的都算：經驗值、金平糖、統計、每天的紀錄（兩邊剛好加一樣多也是各算一次）；最高紀錄、連續天數、回神紀錄取比較大的', () => {
    const day = (o) => ({ tasks: 0, xp: 0, nudges: 0, tagMask: 0, ...o })
    const base = S({ history: { '2026-11-22': day({ tasks: 1, nudges: 2, tagMask: 1 }) } })
    const mine = S({
      player: { xp: 110, coins: 12, streak: 4, charms: 1, stats: { tasksDone: 6, bestStreak: 5 } },
      history: { '2026-11-22': day({ tasks: 2, nudges: 3, tagMask: 3 }), '2026-11-23': day({ tasks: 1 }) },
    })
    const theirs = S({
      player: { xp: 110, coins: 7, streak: 3, charms: 1, stats: { tasksDone: 6, bestStreak: 4 } },
      history: { '2026-11-22': day({ tasks: 2, nudges: 3, tagMask: 5 }), '2026-11-23': day({ tasks: 1 }) },
    })
    const r = merge3(base, mine, theirs).state
    expect(r.player).toEqual({ xp: 120, coins: 9, streak: 4, charms: 1, stats: { tasksDone: 7, bestStreak: 5 } })
    expect(r.history['2026-11-22']).toEqual(day({ tasks: 3, nudges: 3, tagMask: 7 }))
    // 兩邊都新增了同一天的紀錄：各做了一件
    expect(r.history['2026-11-23'].tasks).toBe(2)
  })

  it('お守り：跨日時兩台各自用掉同一個（兩邊變得一樣）只算一次；一邊買、一邊用照加減', () => {
    const base = S({ player: { ...S().player, charms: 2 } })
    const used = S({ player: { ...S().player, charms: 1 } })
    expect(merge3(base, used, used).state.player.charms).toBe(1)
    const bought = S({ player: { ...S().player, charms: 3 } })
    expect(merge3(base, bought, used).state.player.charms).toBe(2)
  })

  it('跨日時兩台各自做的只算一次：每天第一次打開的好感度、もち送的金平糖、戒除里程碑的經驗值', () => {
    const P = (o = {}) => ({ ...S().player, ...o, bond: { pts: 10, visit: '2026-11-21', gift: '2026-11-20', ...o.bond } })
    const H = (msPaid) => ({ id: 'h', name: '戒菸', kind: 'quit', ms: msPaid, msPaid })
    const base = S({ player: P(), habits: [H(3)] })
    // 兩台都在 11/22 打開（好感度 +2、收到金平糖、走到 7 天的里程碑 +20 經驗）；A 另外做完一件 +10
    const gift = giftCoins('2026-11-22')
    const day = (extra) => P({ xp: 100 + 20 + extra, coins: 10 + gift + 4 + Math.round(extra / 5), bond: { pts: 12, visit: '2026-11-22', gift: '2026-11-22' } })
    const r = merge3(base, S({ player: day(10), habits: [H(7)] }), S({ player: day(0), habits: [H(7)] })).state
    expect(r.player.bond.pts).toBe(12)
    expect(r.player.xp).toBe(130)
    expect(r.player.coins).toBe(10 + gift + 4 + 2)
    expect(r.habits[0].msPaid).toBe(7)
  })

  it('日程的日期和時段一起看：兩邊都挪了，整組用比較晚改的那一邊，不會拼出結束比開始早的', () => {
    const E = (o) => ({ id: 'e', title: '會', date: '2026-11-22', start: '10:00', end: '11:00', ...o })
    const base = S({ events: [E()] })
    const mine = S({ events: [E({ start: '14:00', end: '15:00' })], updatedAt: 2 })
    const theirs = S({ events: [E({ end: '12:00', title: '開會' })], updatedAt: 3 })
    const r = merge3(base, mine, theirs)
    expect(r.state.events).toEqual([E({ end: '12:00', title: '開會' })])
    expect(r.clashes).toEqual(['events.date'])
    // 只有一邊挪了時段，另一邊改標題：兩邊的都留著
    const r2 = merge3(base, mine, S({ events: [E({ title: '開會' })] }))
    expect(r2.state.events).toEqual([E({ start: '14:00', end: '15:00', title: '開會' })])
    expect(r2.clashes).toEqual([])
  })

  it('沒有 id 的清單當成集合：兩邊加的都留、刪的刪掉', () => {
    const H = (paidDays) => ({ id: 'h', name: '喝水', paidDays })
    const base = S({ habits: [H(['2026-11-20', '2026-11-21'])] })
    const r = merge3(base, S({ habits: [H(['2026-11-20', '2026-11-21', '2026-11-22'])] }), S({ habits: [H(['2026-11-21'])] }))
    expect(r.state.habits[0].paidDays).toEqual(['2026-11-21', '2026-11-22'])
  })

  it('欄位的順序不一樣不算改過（一邊刪掉、另一邊只是順序不同：照樣刪掉）', () => {
    const base = S({ tasks: [{ id: 'a', title: 'A', date: '2026-11-22' }] })
    const mine = S({ tasks: [{ date: '2026-11-22', title: 'A', id: 'a' }] })
    const r = merge3(base, mine, S({ tasks: [] }))
    expect(r.state.tasks).toEqual([])
    expect(r.clashes).toEqual([])
  })

  it('計時是一整個狀態：兩邊都改了就整個用比較晚改的那一邊', () => {
    const base = S({ timer: { mode: 'focus', by: 'a', v: 1, endAt: 100 } })
    const mine = S({ timer: { mode: 'break', by: 'a', v: 2, endAt: 200 }, updatedAt: 2 })
    const theirs = S({ timer: { mode: 'focus', by: 'b', v: 3, endAt: 100 }, updatedAt: 3 })
    expect(merge3(base, mine, theirs).state.timer).toEqual(theirs.timer)
  })

  it('其中一邊整份換過（匯入、還原備份：tallyGen 不一樣）、沒有 base：合不了', () => {
    const base = S()
    expect(merge3(base, S({ tallyGen: 'g2' }), S())).toBeNull()
    expect(merge3(null, S(), S())).toBeNull()
  })
})

// ── 同步時自動合併（兩台裝置，各自一份 localStorage 和 base 的那一份，共用同一個同步檔）──
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
    isSameEntry: async (o) => o === f,
  }
  return f
}
const memBases = () => {
  const m = new Map()
  return { read: async (k) => m.get(k) ?? null, write: async (k, rev, json) => (rev ? m.set(k, { rev, json }) : m.delete(k)), m }
}
function device(opts = {}) {
  const mem = new Mem()
  const prev = globalThis.localStorage
  globalThis.localStorage = mem
  const store = new Store()
  const bases = memBases()
  const merged = vi.fn()
  const sync = new FileSync(store, { bases, onMerged: merged, ...opts })
  globalThis.localStorage = prev
  const run = async (fn) => {
    globalThis.localStorage = mem
    return fn(store, sync)
  }
  return { store, sync, mem, run, bases, merged }
}
const link = (dev, file) =>
  dev.run(async (_s, sync) => {
    sync.state = 'off'
    await sync._link(file)
  })
const later = (ms = 60000) => vi.setSystemTime(Date.now() + ms)
const titles = (x) => (x.state ?? x).tasks.map((t) => t.title)

describe('同步時兩台都改過：自動合在一起', () => {
  let file
  beforeAll(() => {
    globalThis.window ??= globalThis
    globalThis.addEventListener ??= () => {}
    globalThis.document ??= { hidden: true, addEventListener() {} }
  })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 22, 12))
    file = fakeFile()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('兩台各加了任務、各做完一件：合成一份推上去，兩邊的任務和經驗值都在；另一台拿回來也一樣，不會再問', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    const xp0 = b.store.state.player.xp
    await a.run(async (s, sync) => {
      const t = s.addTask({ title: 'A 的任務' })
      s.toggleTask(t.id)
      await sync.sync()
    })
    const gainA = a.store.state.player.xp - xp0
    later()
    await b.run(async (s, sync) => {
      const t = s.addTask({ title: 'B 的任務' })
      s.toggleTask(t.id)
      await sync.sync()
    })
    const gainB = b.store.state.player.xp - xp0 - gainA
    expect(gainA).toBeGreaterThan(0)
    expect(b.sync.state).toBe('linked')
    expect(b.merged).toHaveBeenCalledTimes(1)
    expect(titles(b.store)).toEqual(expect.arrayContaining(['A 的任務', 'B 的任務']))
    expect(gainB).toBe(gainA)
    const cloud = JSON.parse(file.content).state
    expect(titles(cloud)).toEqual(expect.arrayContaining(['A 的任務', 'B 的任務']))
    expect(cloud.player.xp).toBe(b.store.state.player.xp)
    // 合併前 B 那一份留成備份
    expect(readBackupsOf(b)[0]).toMatchObject({ from: 'merge' })
    later()
    await a.run((_s, sync) => sync.sync())
    expect(a.sync.state).toBe('linked')
    expect(titles(a.store)).toEqual(expect.arrayContaining(['A 的任務', 'B 的任務']))
    expect(a.store.state.player.xp).toBe(b.store.state.player.xp)
  })

  it('換回合併前：回到這台原本那一份（合併好的那一份也留成備份）', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    await a.run(async (s, sync) => (s.addTask({ title: 'A 改的' }), sync.sync()))
    later()
    await b.run(async (s, sync) => (s.addTask({ title: 'B 改的' }), sync.sync()))
    const { rev } = b.merged.mock.calls[0][0]
    await b.run((_s, sync) => expect(sync.undoMerge(rev)).toBe(true))
    expect(titles(b.store)).toContain('B 改的')
    expect(titles(b.store)).not.toContain('A 改的')
    expect(readBackupsOf(b)[0]).toMatchObject({ from: 'restore' })
  })

  it('推上去之前又被別台寫過：再合一次，那一版的經驗值不會算兩次', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    const xp0 = a.store.state.player.xp
    await a.run(async (s, sync) => {
      s.toggleTask(s.addTask({ title: 'A 第一件' }).id)
      await sync.sync()
    })
    const gain = a.store.state.player.xp - xp0
    later()
    // B 合併時，推上去那一下 A 又寫了一次
    await b.run(async (s, sync) => {
      s.toggleTask(s.addTask({ title: 'B 的' }).id)
      const push = sync._push.bind(sync)
      let once = true
      sync._push = async (...args) => {
        if (once) {
          once = false
          await a.run(async (sa, sy) => {
            sa.toggleTask(sa.addTask({ title: 'A 第二件' }).id)
            await sy.sync()
          })
          globalThis.localStorage = b.mem
        }
        return push(...args)
      }
      await sync.sync()
    })
    expect(b.sync.state).toBe('linked')
    expect(titles(b.store)).toEqual(expect.arrayContaining(['A 第一件', 'A 第二件', 'B 的']))
    expect(b.store.state.player.xp).toBe(xp0 + gain * 3)
  })

  it('沒有上次那一份（剛連結、這個功能上線前同步的、存不進去）：照舊讓使用者選邊', async () => {
    const a = device()
    const b = device({ bases: { read: async () => null, write: async () => {} } })
    await link(a, file)
    later()
    await link(b, file)
    // 重新打開過（記憶體裡也沒有那一份）
    b.sync._snap = null
    later()
    await a.run(async (s, sync) => (s.addTask({ title: 'A 改的' }), sync.sync()))
    later()
    await b.run(async (s, sync) => (s.addTask({ title: 'B 改的' }), sync.sync()))
    expect(b.sync.state).toBe('conflict')
    expect(b.merged).not.toHaveBeenCalled()
  })

  it('其中一台匯入了另一份資料：合不了，讓使用者選邊', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    await a.run(async (s, sync) => {
      s.importJSON(JSON.stringify({ ...s.state, tasks: [] }))
      await sync.sync()
    })
    later()
    await b.run(async (s, sync) => (s.addTask({ title: 'B 改的' }), sync.sync()))
    expect(b.sync.state).toBe('conflict')
  })
})

function readBackupsOf(dev) {
  const prev = globalThis.localStorage
  globalThis.localStorage = dev.mem
  try {
    return readBackups()
  } finally {
    globalThis.localStorage = prev
  }
}
