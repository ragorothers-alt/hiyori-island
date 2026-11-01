import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/store.js'
import { BUILDINGS, RESIDENTS, TOWN_TITLES, buildingOf, buildingStage, townChanges, townOf, townTitle } from '../src/data/town.js'
import { RESIDENT_LINES, VISITS, TOWN_LINES, TOWN_DUETS } from '../src/data/townLines.js'

const TODAY = '2026-10-30'
let store
const events = []

function setDate(day, hour = 12) {
  const [y, m, d] = day.split('-').map(Number)
  vi.setSystemTime(new Date(y, m - 1, d, hour))
}
const doTask = (title = 't') => store.toggleTask(store.addTask({ title, date: TODAY }).id)

beforeEach(() => {
  vi.useFakeTimers()
  setDate(TODAY)
  localStorage.clear()
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0, coins: 0 } }))
  events.length = 0
  for (const t of ['townGrow', 'townMoveIn', 'townWelcome']) store.on(t, (p) => events.push([t, p]))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('建築階段', () => {
  it('依累積量和門檻算出 0–5 階與下一階的進度', () => {
    const florist = buildingOf('florist')
    expect(buildingStage(florist, {}).stage).toBe(0)
    expect(buildingStage(florist, { tasksDone: 1 })).toMatchObject({ stage: 1, next: 15, prev: 1 })
    expect(buildingStage(florist, { tasksDone: 14 }).stage).toBe(1)
    expect(buildingStage(florist, { tasksDone: 15 }).stage).toBe(2)
    const top = buildingStage(florist, { tasksDone: 9999 })
    expect(top).toMatchObject({ stage: 5, next: null, progress: 1 })
    expect(buildingStage(florist, { tasksDone: 37.5 }).progress).toBeCloseTo((37 - 15) / (60 - 15))
  })
  it('合併兩個統計的建築，壞掉的數值當 0', () => {
    expect(buildingStage(buildingOf('clock'), { eventsDone: 6, plansApplied: 4 }).stage).toBe(2)
    expect(buildingStage(buildingOf('bathhouse'), { habitChecks: NaN, urgesResisted: 1 }).stage).toBe(1)
  })
  it('小鎮等級、稱號、居民', () => {
    const t = townOf({ tasksDone: 60, focusMinutes: 300, reviews: 1 })
    expect(t.buildings.map((b) => b.stage)).toEqual([3, 2, 0, 0, 0, 1])
    expect(t.rank).toBe(6)
    expect(t.title).toBe('小村子')
    expect(t.residents).toEqual(['poko', 'hosuke'])
    expect(townTitle(0)).toBe('還是一片雲')
    expect(townTitle(30)).toBe('ひより町')
    expect(townOf({}).max).toBe(BUILDINGS.length * 5)
  })
  it('比對出長大的建築，跨過 2 階時店長搬進來', () => {
    expect(townChanges({ florist: 1 }, { florist: 3, post: 1 })).toEqual({
      grew: [{ key: 'florist', from: 1, stage: 3 }, { key: 'post', from: 0, stage: 1 }],
      movedIn: [{ key: 'poko', home: 'florist' }],
    })
    expect(townChanges({ florist: 2 }, { florist: 2 }).grew).toEqual([])
  })
})

describe('小鎮台詞', () => {
  // 代入最長的店名、階段名、居民名、動物、稱號後，泡泡一句不超過 18 字
  const longest = (list) => list.reduce((a, b) => ([...b].length > [...a].length ? b : a), '')
  const vars = {
    building: longest(BUILDINGS.map((b) => b.name)),
    stage: longest(BUILDINGS.flatMap((b) => b.stages)),
    resident: longest(Object.values(RESIDENTS).map((r) => r.name)),
    animal: longest(Object.values(RESIDENTS).map((r) => r.animal)),
    title: longest(TOWN_TITLES.map(([, t]) => t)),
  }
  const len = (s) => [...s.replace(/\{(\w+)\}/g, (_, k) => vars[k])].length
  it('每位居民都有六種台詞，拜訪對話只用允許的說話者', () => {
    for (const key of Object.keys(RESIDENTS)) {
      for (const kind of ['hello', 'idle', 'night', 'moveIn', 'grow', 'work']) expect(RESIDENT_LINES[key][kind].length).toBeGreaterThan(0)
      expect(VISITS[key].length).toBeGreaterThan(0)
      for (const seg of VISITS[key]) for (const [who] of seg) expect(['res', 'mochi', 'fuji']).toContain(who)
    }
    for (const who of ['mochi', 'fuji']) for (const k of ['townFound', 'townGrow', 'townMoveIn', 'townWelcome', 'townVisit']) expect(TOWN_LINES[who][k].length).toBeGreaterThan(0)
    for (const seg of Object.values(TOWN_DUETS).flat()) for (const [who] of seg) expect(['mochi', 'fuji']).toContain(who)
  })
  it('每句代入最長的名稱後不超過 18 字', () => {
    const all = [
      ...Object.values(RESIDENT_LINES).flatMap((r) => Object.values(r).flat()),
      ...Object.values(VISITS).flat(2).map(([, t]) => t),
      ...Object.values(TOWN_LINES).flatMap((r) => Object.values(r).flat()),
      ...Object.values(TOWN_DUETS).flat(2).map(([, t]) => t),
    ]
    expect(all.filter((s) => len(s) > 18)).toEqual([])
  })
})

describe('store 的小鎮', () => {
  it('第一件任務完成時花屋開張，只發一次', () => {
    doTask()
    expect(events).toEqual([['townGrow', { key: 'florist', from: 0, stage: 1 }]])
    expect(store.state.town.seen).toEqual({ florist: 1 })
    expect(store.state.town.since).toBe(TODAY)
    doTask()
    expect(events).toHaveLength(1)
  })
  it('一次跨好幾階只發一次，跨過 2 階時搬來居民', () => {
    store.stats.focusMinutes = 1200
    doTask()
    expect(events).toContainEqual(['townGrow', { key: 'library', from: 0, stage: 3 }])
    expect(events).toContainEqual(['townMoveIn', { key: 'hosuke', home: 'library' }])
    expect(store.statsSnapshot().townRank).toBe(4)
    expect(store.statsSnapshot().residents).toBe(1)
  })
  it('匯出再匯入會保留慶祝紀錄，不會重播', () => {
    doTask()
    const json = store.exportJSON()
    events.length = 0
    store.importJSON(json)
    expect(store.state.town.seen).toEqual({ florist: 1 })
    doTask()
    expect(events).toEqual([])
  })
  it('舊存檔：開檔時照統計直接蓋好，打一次招呼，之後不重播', () => {
    localStorage.setItem('hiyori-daily-v1', JSON.stringify({ tasks: [], player: { xp: 500, stats: { tasksDone: 20, reviews: 3 } } }))
    const old = new Store()
    const got = []
    old.on('townWelcome', (p) => got.push(p))
    old.on('townGrow', (p) => got.push(p))
    old.flushPending()
    expect(old.state.town.seen).toEqual({ florist: 2, post: 1 })
    expect(got).toHaveLength(1)
    expect(got[0].rank).toBe(3)
    expect(old.state.town.welcome).toBeUndefined()
    old.toggleTask(old.addTask({ title: 'x', date: TODAY }).id)
    expect(got).toHaveLength(1)
  })
  it('匯入沒有小鎮紀錄的舊檔：安靜補上，不打招呼', () => {
    store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0, stats: { lifeEntries: 20 } } }))
    expect(store.state.town).toEqual({ seen: { cafe: 2 }, since: '', plevel: 1 })
    store.flushPending()
    expect(events).toEqual([])
  })
  it('壞掉的小鎮資料會被清洗', () => {
    store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0 }, town: { seen: { florist: 99, nope: 3, post: 'x' }, since: 'yesterday' } }))
    expect(store.state.town).toEqual({ seen: { florist: 5 }, since: '', plevel: 1 })
  })
})
