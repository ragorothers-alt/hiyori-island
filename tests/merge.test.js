import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { merge3 } from '../src/merge.js'
import { giftCoins } from '../src/data/bond.js'
import { XP } from '../src/theme.js'
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
    // 兩台各買了一個：兩個都在
    expect(merge3(base, bought, bought).state.player.charms).toBe(4)
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

  it('跨午夜的日程（兩段）整組看：一台改了時間、一台整組刪掉 → 留改過的那一整組；兩台各自延到隔天 → 只留比較晚改的那一組', () => {
    const P = (id, date, start, end, o = {}) => ({ id, title: '夜班', date, start, end, link: 'L1', ...o })
    const base = S({ events: [P('e1', '2026-11-22', '23:00', '23:59'), P('e2', '2026-11-23', '00:00', '01:00')] })
    const edited = S({ events: [P('e1', '2026-11-22', '22:00', '23:59'), P('e2', '2026-11-23', '00:00', '02:00')], updatedAt: 2 })
    const r = merge3(base, edited, S({ events: [], updatedAt: 3 }))
    expect(r.state.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(r.state.events[1].end).toBe('02:00')
    // 單段延到隔天：兩台各生出自己的第二段（id、link 都不一樣）
    const one = S({ events: [{ id: 'e1', title: '夜班', date: '2026-11-22', start: '22:00', end: '23:00' }] })
    const a = S({ events: [P('e1', '2026-11-22', '22:00', '23:59', { link: 'LA' }), P('ea', '2026-11-23', '00:00', '01:00', { link: 'LA' })], updatedAt: 2 })
    const b = S({ events: [P('e1', '2026-11-22', '22:00', '23:59', { link: 'LB' }), P('eb', '2026-11-23', '00:00', '02:00', { link: 'LB' })], updatedAt: 3 })
    expect(merge3(one, a, b).state.events.map((e) => e.id)).toEqual(['e1', 'eb'])
  })

  it('同一件任務兩台都打勾了：經驗值、金平糖、統計、那天的紀錄只算一次（完成時記下的 xpGot）', () => {
    const doneAt = new Date(2026, 10, 22, 14).getTime()
    const day = (tasks, xp) => ({ '2026-11-22': { tasks, xp, high: 0, early: 0, stars: 0, routines: 0 } })
    const base = S({ tasks: [T('a')], history: day(0, 0) })
    const done = (o = {}) => T('a', { done: true, rewarded: true, xpGot: 15, doneAt, priority: 2, ...o })
    const mine = S({ tasks: [done()], player: { ...S().player, xp: 115, coins: 13, stats: { tasksDone: 6, bestStreak: 4 } }, history: day(1, 15), updatedAt: 3 })
    const theirs = S({ tasks: [done({ doneAt: doneAt + 60000 })], player: { ...S().player, xp: 115, coins: 13, stats: { tasksDone: 6, bestStreak: 4 } }, history: day(1, 15), updatedAt: 2 })
    const r = merge3(base, mine, theirs).state
    expect(r.player.xp).toBe(115)
    expect(r.player.coins).toBe(13)
    expect(r.player.stats.tasksDone).toBe(6)
    expect(r.history['2026-11-22']).toMatchObject({ tasks: 1, xp: 15 })
  })

  it('一天只給一次的：習慣打卡的獎勵同一天兩台都領了只算一次；本命全清、全部做完的獎勵也是', () => {
    const H = (paidDays, log) => ({ id: 'h', name: '喝水', kind: 'build', paidDays, log })
    const day = (o) => ({ '2026-11-22': { habits: 0, perfect: false, ...o } })
    const P = (xp, coins, habitChecks, perfectDays) => ({ ...S().player, xp, coins, stats: { tasksDone: 5, bestStreak: 4, habitChecks, perfectDays } })
    const base = S({ habits: [H([], {})], history: day({}), player: P(100, 10, 3, 1) })
    // 兩台都打了卡、也都拿到全部做完（經驗值、金平糖各加了一份）
    const coin = (xp) => Math.max(1, Math.round(xp / 5))
    const xp = 100 + XP.habit + XP.perfectDay
    const coins = 10 + coin(XP.habit) + coin(XP.perfectDay)
    const side = (u) => S({ habits: [H(['2026-11-22'], { '2026-11-22': 1 })], history: day({ habits: 1, perfect: true }), player: P(xp, coins, 4, 2), updatedAt: u })
    const r = merge3(base, side(2), side(3)).state
    expect(r.player.xp).toBe(xp)
    expect(r.player.coins).toBe(coins)
    expect(r.player.stats).toMatchObject({ habitChecks: 4, perfectDays: 2 })
    expect(r.history['2026-11-22'].habits).toBe(1)
  })

  it('同一輪番茄鐘兩台都記了：只算一次（分鐘、顆數、經驗值、那一天、任務、專案）；兩台各做了一輪：任務上兩輪都算', () => {
    const day = (o) => ({ '2026-11-22': { pomodoros: 0, focus: 0, focusPm: 0, xp: 0, ...o } })
    const P = (xp, coins, pomodoros, focusMinutes, pts) => ({ ...S().player, xp, coins, bond: { pts }, stats: { tasksDone: 5, bestStreak: 4, pomodoros, focusMinutes } })
    const task = (pomos, spent) => T('a', { pomos, spent, project: 'p1' })
    const proj = (focus) => ({ id: 'p1', name: '專案', focus })
    const base = S({ tasks: [task(0, 0)], projects: [proj({})], history: day({}), player: P(100, 10, 2, 50, 20), pomoSids: [], pomoGot: {} })
    const coin = Math.max(1, Math.round(XP.pomodoro / 5))
    const one = (sid, u) =>
      S({
        tasks: [task(1, 25)], projects: [proj({ '2026-11-22': 25 })],
        history: day({ pomodoros: 1, focus: 25, focusPm: 25, xp: XP.pomodoro }),
        player: P(100 + XP.pomodoro, 10 + coin, 3, 75, 23),
        pomoSids: [sid], pomoGot: { [sid]: { m: 25, xp: XP.pomodoro, x: 0, d: '2026-11-22', t: 'a', p: 'p1', s: 'focusPm' } },
        updatedAt: u,
      })
    const r = merge3(base, one('r1', 2), one('r1', 3)).state
    expect(r.player).toMatchObject({ xp: 100 + XP.pomodoro, coins: 10 + coin, bond: { pts: 23 } })
    expect(r.player.stats).toMatchObject({ pomodoros: 3, focusMinutes: 75 })
    expect(r.history['2026-11-22']).toMatchObject({ pomodoros: 1, focus: 25, focusPm: 25, xp: XP.pomodoro })
    expect(r.tasks[0]).toMatchObject({ pomos: 1, spent: 25 })
    expect(r.projects[0].focus).toEqual({ '2026-11-22': 25 })
    // 各做了一輪（不同的 id）：兩輪都算
    const two = merge3(base, one('r1', 2), one('r2', 3)).state
    expect(two.tasks[0]).toMatchObject({ pomos: 2, spent: 50 })
    expect(two.player.stats).toMatchObject({ pomodoros: 4, focusMinutes: 100 })
    expect(two.projects[0].focus).toEqual({ '2026-11-22': 50 })
  })

  it('那一天整個不見了（刪掉最後一則生活記錄）、另一台新增了：逐筆比，刪掉的不會復活；計數撤到 0（鍵不見了）當成 0 照加減', () => {
    const item = (id) => ({ id, t: '12:00', kind: 'note', text: id, amount: 0 })
    const base = S({ life: { '2026-11-22': { items: [item('old')], energy: 0 } } })
    const r = merge3(base, S({ life: {} }), S({ life: { '2026-11-22': { items: [item('old'), item('new')], energy: 0 } } }))
    expect(r.state.life['2026-11-22'].items.map((x) => x.id)).toEqual(['new'])
    const H = (log) => ({ id: 'h', name: '喝水', log })
    const r2 = merge3(S({ habits: [H({ '2026-11-22': 1 })] }), S({ habits: [H({})] }), S({ habits: [H({ '2026-11-22': 2 })] }))
    expect(r2.state.habits[0].log).toEqual({ '2026-11-22': 1 })
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

  it('合好的那一份記著包含了兩邊的哪幾版（lineage）', () => {
    const r = merge3(S(), S({ rev: 'm1', lineage: ['m0'] }), S({ rev: 't1', lineage: ['t0'] }))
    expect(r.state.lineage).toEqual(['t0', 't1', 'm0', 'm1'])
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
  const sync = new FileSync(store, { bases, onMerged: merged, locks: null, ...opts })
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

  it('推上去了但沒收到回應（斷線），別台接著改：回來時不會拿舊的那一份再合一次（經驗值不重複算）', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    const xp0 = a.store.state.player.xp
    await a.run(async (s, sync) => {
      s.toggleTask(s.addTask({ title: 'A 的' }).id)
      const push = sync._push.bind(sync)
      sync._push = async (...args) => {
        await push(...args)
        sync._push = push
        throw new Error('response lost')
      }
      await sync.sync()
    })
    const gain = a.store.state.player.xp - xp0
    later()
    await b.run(async (s, sync) => {
      await sync.sync()
      s.toggleTask(s.addTask({ title: 'B 的' }).id)
      await sync.sync()
    })
    later()
    await a.run((_s, sync) => sync.sync())
    expect(a.sync.state).toBe('linked')
    expect(titles(a.store)).toEqual(expect.arrayContaining(['A 的', 'B 的']))
    expect(a.store.state.player.xp).toBe(xp0 + 2 * gain)
    // 這台這一版包含在雲端那一版裡：直接拿回來，沒有合併
    expect(a.merged).not.toHaveBeenCalled()
  })

  it('合好的那一份存不進去（空間滿了）：記憶體換回原本那一份，之後再合也不會重複算', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    const xp0 = b.store.state.player.xp
    await a.run(async (s, sync) => (s.toggleTask(s.addTask({ title: 'A 的' }).id), sync.sync()))
    const gain = a.store.state.player.xp - xp0
    later()
    let full = false
    const set = b.mem.setItem.bind(b.mem)
    b.mem.setItem = (k, v) => {
      if (full && k === 'hiyori-daily-v1') throw new Error('quota')
      return set(k, v)
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await b.run(async (s, sync) => {
      s.toggleTask(s.addTask({ title: 'B 的' }).id)
      await sync.flush?.()
      s.flushSave()
      full = true
      await sync.sync()
    })
    expect(b.sync.state).toBe('error')
    expect(titles(b.store)).not.toContain('A 的')
    expect(b.store.state.player.xp).toBe(xp0 + gain)
    full = false
    await b.run((_s, sync) => sync.sync())
    warn.mockRestore()
    expect(b.sync.state).toBe('linked')
    expect(titles(b.store)).toEqual(expect.arrayContaining(['A 的', 'B 的']))
    expect(b.store.state.player.xp).toBe(xp0 + 2 * gain)
  })

  it('一輪裡連著被別台搶先好幾次（合了好幾次）：只說一次、換回去的是最原本那一份', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    await link(b, file)
    later()
    await a.run(async (s, sync) => (s.addTask({ title: 'A0' }), sync.sync()))
    later()
    await b.run(async (s, sync) => {
      s.addTask({ title: 'B 的' })
      const push = sync._push.bind(sync)
      let n = 0
      sync._push = async (...args) => {
        if (n++ < 2) {
          await a.run(async (sa, sy) => (sa.addTask({ title: `A${n}` }), sy.sync()))
          globalThis.localStorage = b.mem
        }
        return push(...args)
      }
      await sync.sync()
    })
    expect(b.sync.state).toBe('linked')
    expect(titles(b.store)).toEqual(expect.arrayContaining(['A0', 'A1', 'A2', 'B 的']))
    const revs = new Set(b.merged.mock.calls.map((c) => c[0].rev))
    expect(revs.size).toBe(1)
    await b.run((_s, sync) => expect(sync.undoMerge([...revs][0])).toBe(true))
    expect(titles(b.store).filter((t) => /^A\d$|^B/.test(t)).sort()).toEqual(['B 的'])
  })

  it('兩台各勾了最後的里程碑：合起來全勾了，專案跟著落成', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    const pid = await a.run(async (s, sync) => {
      const p = s.addProject({ name: '兩台一起', milestones: ['一', '二'] })
      await sync.sync()
      return p.id
    })
    later()
    await link(b, file)
    later()
    const ms = (s) => s.state.projects.find((p) => p.id === pid).milestones
    await a.run(async (s, sync) => (s.toggleMilestone(pid, ms(s)[0].id), sync.sync()))
    later()
    await b.run(async (s, sync) => (s.toggleMilestone(pid, ms(s)[1].id), sync.sync()))
    const p = b.store.state.projects.find((x) => x.id === pid)
    expect(p.milestones.every((m) => m.done)).toBe(true)
    expect(p.completedAt).toBeTruthy()
  })

  it('合起來超過上限（兩台各寫了專案的第 100 則筆記）：不自動合，讓使用者選邊', async () => {
    const a = device()
    const b = device()
    await link(a, file)
    later()
    const pid = await a.run(async (s, sync) => {
      const p = s.addProject({ name: '筆記很多', milestones: ['一'] })
      for (let i = 0; i < 99; i++) p.notes.push({ id: `n${i}`, title: `第 ${i} 則`, body: '', pinned: false, createdAt: 1, updatedAt: 1 })
      s.save()
      await sync.sync()
      return p.id
    })
    later()
    await link(b, file)
    later()
    const note = (id) => ({ id, title: id, body: '', pinned: false, createdAt: 2, updatedAt: 2 })
    await a.run(async (s, sync) => {
      s.state.projects.find((x) => x.id === pid).notes.push(note('a100'))
      s.save()
      await sync.sync()
    })
    later()
    await b.run(async (s, sync) => {
      s.state.projects.find((x) => x.id === pid).notes.push(note('b100'))
      s.save()
      await sync.sync()
    })
    expect(b.sync.state).toBe('conflict')
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
