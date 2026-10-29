import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, addDays } from '../src/store.js'
import { XP } from '../src/theme.js'

const TODAY = '2026-10-29'
let store

function setDate(day, hour = 12, minute = 0) {
  const [y, m, d] = day.split('-').map(Number)
  vi.setSystemTime(new Date(y, m - 1, d, hour, minute))
}
const events = []

beforeEach(() => {
  vi.useFakeTimers()
  setDate(TODAY)
  localStorage.clear()
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], events: [], player: { xp: 0, coins: 0 } }))
  events.length = 0
  for (const t of ['habitDone', 'habitAll', 'urgeResisted', 'habitSlip', 'quitMilestone', 'lifeLogged', 'sleepLogged', 'planApplied']) {
    store.on(t, (p) => events.push([t, p]))
  }
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('存檔清洗', () => {
  it('新欄位會補預設、不合法的值會被丟掉', () => {
    store.importJSON(JSON.stringify({
      player: { xp: 0 },
      tasks: [{ title: 'a', dur: 9999, at: '25:00' }, { title: 'b', dur: 45, at: '09:30' }],
      rhythm: { wake: '06:30', sleep: 'x', peak: 'night', work: null, meals: [{ label: '午餐', start: '12:00', end: '11:00' }] },
      sleep: { '2026-10-28': { bed: '23:10', wake: '07:00', q: 9 }, bad: {} },
      habits: [{ name: '喝水', target: 8, days: [1, 1, 9], log: { '2026-10-28': 3, x: 1 } }, { name: '', kind: 'quit' }, { name: '熬夜', kind: 'quit', slips: [1761700000000, { at: 'x' }] }],
      life: { '2026-10-28': { items: [{ text: '拉麵', kind: 'meal', t: '12:30' }, { text: '' }, { kind: 'spend', amount: 120 }], energy: 4 } },
    }))
    const s = store.state
    expect(s.tasks.map((t) => [t.dur, t.at])).toEqual([[600, null], [45, '09:30']])
    expect(s.rhythm.wake).toBe('06:30')
    expect(s.rhythm.sleep).toBe('23:30')
    expect(s.rhythm.peak).toBe('morning')
    expect(s.rhythm.work).toBe(null)
    expect(s.rhythm.meals).toEqual([])
    expect(s.sleep['2026-10-28']).toEqual({ bed: '23:10', wake: '07:00', q: 5 })
    expect(s.sleep.bad).toBeUndefined()
    expect(s.habits).toHaveLength(2)
    expect(s.habits[0].days).toEqual([1])
    expect(s.habits[0].log).toEqual({ '2026-10-28': 3 })
    expect(s.habits[1].slips).toHaveLength(1)
    expect(s.life['2026-10-28'].items.map((x) => x.kind)).toEqual(['spend', 'meal'])
    expect(s.life['2026-10-28'].energy).toBe(4)
  })
})

describe('時段安排', () => {
  it('套用排程會把逾期任務搬到今天、第一次給 XP', () => {
    setDate(TODAY, 8)
    const old = store.addTask({ title: '昨天的', date: addDays(TODAY, -1), priority: 3 })
    store.addTask({ title: '今天的', date: TODAY })
    const r = store.planDay(TODAY)
    expect(r.plan).toHaveLength(2)
    store.applyPlan(TODAY, r.plan)
    const t = store.state.tasks.find((x) => x.id === old.id)
    expect(t.date).toBe(TODAY)
    expect(t.at).toBeTruthy()
    expect(store.player.xp).toBe(XP.plan)
    expect(store.day().timebox).toBe(1)
    store.applyPlan(TODAY, store.planDay(TODAY, { replan: true }).plan)
    expect(store.player.xp).toBe(XP.plan)
    expect(store.stats.plansApplied).toBe(2)
    store.clearPlan(TODAY)
    expect(store.tasksOn(TODAY).every((x) => !x.at)).toBe(true)
  })
  it('手動排進時段與收回', () => {
    const t = store.addTask({ title: 'x', date: TODAY })
    store.scheduleTask(t.id, '14:00', 45)
    expect([t.at, t.dur]).toEqual(['14:00', 45])
    store.scheduleTask(t.id, null)
    expect(t.at).toBe(null)
    expect(t.dur).toBe(45)
  })
})

describe('作息與睡眠', () => {
  it('作息設定經過清洗；睡眠第一次記錄有獎勵', () => {
    store.setRhythm({ wake: '06:00', buffer: 999 })
    expect(store.state.rhythm.wake).toBe('06:00')
    expect(store.state.rhythm.buffer).toBe(60)
    store.logSleep(TODAY, { bed: '23:30', wake: '07:00', q: 4 })
    store.logSleep(TODAY, { bed: '23:00', wake: '07:00', q: 4 })
    expect(store.state.sleep[TODAY].bed).toBe('23:00')
    expect(store.player.xp).toBe(XP.sleep)
    expect(events.filter(([t]) => t === 'sleepLogged').map(([, p]) => p.min)).toEqual([450, 480])
    store.logSleep(addDays(TODAY, 1), { bed: '23:00', wake: '07:00' })
    expect(store.state.sleep[addDays(TODAY, 1)]).toBeUndefined()
  })
})

describe('養成習慣', () => {
  it('達標才算完成、今天只獎勵一次、全部完成有額外獎勵', () => {
    const water = store.addHabit({ name: '喝水', target: 2, unit: '杯' })
    const walk = store.addHabit({ name: '散步' })
    store.checkHabit(water.id)
    expect(events.some(([t]) => t === 'habitDone')).toBe(false)
    store.checkHabit(water.id)
    expect(events.filter(([t]) => t === 'habitDone')).toHaveLength(1)
    expect(store.player.xp).toBe(XP.habit)
    store.checkHabit(water.id, TODAY, -1)
    store.checkHabit(water.id)
    expect(store.player.xp).toBe(XP.habit)
    store.checkHabit(walk.id)
    expect(events.filter(([t]) => t === 'habitAll')).toHaveLength(1)
    expect(store.player.xp).toBe(XP.habit * 2 + XP.habitAll)
    expect(store.day().habits).toBe(2)
    expect(store.streak).toBe(1)
    expect(store.daySummary(TODAY).habits).toEqual({ total: 2, done: 2 })
  })
  it('休息日多做也能記，但沒有完成獎勵', () => {
    const h = store.addHabit({ name: '游泳', days: [1] })
    store.checkHabit(h.id)
    expect(h.log[TODAY]).toBe(1)
    expect(store.player.xp).toBe(0)
    expect(events.some(([t]) => t === 'habitDone')).toBe(false)
  })
  it('不能替未來打卡；開始前的日子補卡會把開始日往前移（最多 12 週）；封存後不能打卡', () => {
    const h = store.addHabit({ name: '閱讀' })
    store.checkHabit(h.id, addDays(TODAY, 1))
    expect(h.log).toEqual({})
    store.checkHabit(h.id, addDays(TODAY, -100))
    store.checkHabit(h.id, addDays(TODAY, -2), -1)
    expect(h.start).toBe(TODAY)
    store.checkHabit(h.id, addDays(TODAY, -2))
    expect(h.start).toBe(addDays(TODAY, -2))
    expect(h.log).toEqual({ [addDays(TODAY, -2)]: 1 })
    expect(store.player.xp).toBe(0)
    h.log = {}
    store.updateHabit(h.id, { archived: true })
    store.checkHabit(h.id)
    expect(h.log).toEqual({})
  })
})

describe('戒除習慣', () => {
  it('忍住有小獎勵（每天前 3 次），破戒重新起算、可以撤銷', () => {
    const h = store.addHabit({ name: '手搖飲', kind: 'quit' })
    for (let i = 0; i < 4; i++) store.resistUrge(h.id)
    expect(h.urges[TODAY]).toBe(4)
    expect(store.player.xp).toBe(XP.urge * 3)
    expect(store.stats.urgesResisted).toBe(4)
    store.slipHabit(h.id, '朋友請客')
    expect(h.slips[0].note).toBe('朋友請客')
    expect(events.find(([t]) => t === 'habitSlip')[1].days).toBe(0)
    store.undoSlip(h.id)
    expect(h.slips).toEqual([])
  })
  it('跨日時發里程碑，每段乾淨期只發一次', () => {
    const h = store.addHabit({ name: '熬夜', kind: 'quit' })
    setDate(addDays(TODAY, 3))
    store.tick()
    const ms = events.filter(([t]) => t === 'quitMilestone').map(([, p]) => p.days)
    expect(ms).toEqual([3])
    expect(h.ms).toBe(3)
    store.tick()
    expect(events.filter(([t]) => t === 'quitMilestone')).toHaveLength(1)
    expect(store.statsSnapshot().bestClean).toBe(3)
  })
})

describe('生活記錄', () => {
  it('每天前 3 筆有 XP、依時間排序、刪光就移除那天', () => {
    setDate(TODAY, 9, 5)
    const a = store.addLife(TODAY, { kind: 'meal', text: '飯糰' })
    expect(a.t).toBe('09:05')
    store.addLife(TODAY, { kind: 'move', text: '散步', t: '07:00' })
    store.addLife(TODAY, { kind: 'spend', amount: 85 })
    store.addLife(TODAY, { kind: 'note', text: '第四筆' })
    expect(store.addLife(TODAY, { kind: 'note', text: '  ' })).toBe(null)
    expect(store.player.xp).toBe(XP.life * 3)
    expect(store.lifeOn(TODAY).items.map((x) => x.t)).toEqual(['07:00', '09:05', '09:05', '09:05'])
    expect(store.daySummary(TODAY).spend).toBe(85)
    store.setEnergy(TODAY, 4)
    for (const x of [...store.lifeOn(TODAY).items]) store.deleteLife(TODAY, x.id)
    expect(store.state.life[TODAY]).toEqual({ items: [], energy: 4 })
    store.setEnergy(TODAY, 0)
    expect(store.state.life[TODAY]).toBeUndefined()
    expect(store.addLife(addDays(TODAY, 1), { text: '未來' })).toBe(null)
  })
})
