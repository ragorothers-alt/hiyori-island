import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 星期天晚上排下一週（一定先給使用者看）、晚上準備明天時回顧今天
const ai = vi.hoisted(() => ({ ask: null }))
vi.mock('../src/ai.js', async (orig) => ({ ...(await orig()), aiReady: () => true, askAI: (...a) => ai.ask(...a) }))

const { Store, addDays } = await import('../src/store.js')
const { migrate } = await import('../src/store/migrate.js')
const { agentContext, cleanOut, dueRun } = await import('../src/agent.js')
const { createAgent } = await import('../src/agentRunner.js')
const { DEFAULT_RHYTHM } = await import('../src/planner.js')

const SUNDAY = '2026-11-22'
const MONDAY = '2026-11-23'
const blank = (o = {}) => ({ say: '', schedule: [], add: [], steps: [], split: [], edit: [], star: [], first: '', msteps: [], next: '', remember: [], forget: [], done: [], drop: [], events: [], dates: [], ask: [], ...o })
const sunday = (hour, min = 0) => vi.setSystemTime(new Date(2026, 10, 22, hour, min))
let store
let agent
let notes

beforeEach(() => {
  vi.useFakeTimers()
  sunday(21, 30)
  localStorage.clear()
  ai.ask = vi.fn(async () => blank())
  notes = []
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], events: [], projects: [], player: { xp: 0, coins: 0 } }))
  store.state.agent.ran.morning = SUNDAY
  agent = createAgent(store, { busy: () => false, holding: () => false, focusing: () => null, notify: (entry, run, pending) => notes.push({ entry, run, pending }) })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('星期天晚上排下一週', () => {
  it('星期天晚上才排；排過了、下一週已經整理過的不排；別天不排', () => {
    const base = { today: SUNDAY, nowMin: 21 * 60 + 30, rhythm: DEFAULT_RHYTHM, ran: { morning: SUNDAY } }
    expect(dueRun(base)).toMatchObject({ run: 'week' })
    expect(dueRun({ ...base, nowMin: 15 * 60 })?.run).not.toBe('week')
    expect(dueRun({ ...base, ran: { morning: SUNDAY, plan: SUNDAY } })?.run).not.toBe('week')
    expect(dueRun({ ...base, ran: { morning: SUNDAY, week: MONDAY } })?.run).not.toBe('week')
    expect(dueRun({ ...base, today: '2026-11-21', ran: { morning: '2026-11-21' } })?.run).not.toBe('week')
  })

  it('資料帶到下週日（8 天）；就算是「自動」也先列出來等套用；套用了星期一早上不再看這一週', async () => {
    const t = store.addTask({ title: '準備簡報', date: SUNDAY })
    ai.ask = vi.fn(async (task, data) => blank({ say: '下週重點是週三的簡報', schedule: [{ id: data.days[0].tasks[0].id, date: '2026-11-25', at: '', dur: 0 }] }))
    await agent.tick()
    const [, data] = ai.ask.mock.calls[0]
    expect(data.run).toBe('week')
    expect(data.days.map((d) => d.date)).toEqual(Array.from({ length: 8 }, (_, i) => addDays(SUNDAY, i)))
    expect(store.state.settings.agentMode || 'auto').toBe('auto')
    expect(agent.pending).toMatchObject({ run: 'week', say: '下週重點是週三的簡報' })
    expect(t.date).toBe(SUNDAY)
    expect(notes.at(-1)).toMatchObject({ run: 'week', entry: null })
    // 等使用者決定的這段時間不再提一次
    expect(store.state.agent.ran.plan).toBe(SUNDAY)
    agent.accept()
    expect(t.date).toBe('2026-11-25')
    expect(store.state.agent.ran.week).toBe(MONDAY)
    // 星期一早上：這一週已經排過，不帶 weekStart
    vi.setSystemTime(new Date(2026, 10, 23, 9))
    store.tick?.()
    ai.ask = vi.fn(async () => blank())
    store.addTask({ title: '星期一的事', date: MONDAY })
    await agent.tick()
    expect(ai.ask.mock.calls[0][1]).toMatchObject({ run: 'morning' })
    expect(ai.ask.mock.calls[0][1]).not.toHaveProperty('weekStart')
  })

  it('說不用了：這一週不再排（星期一早上也不看）；沒決定就過了午夜：星期一早上照常看這一週', async () => {
    store.addTask({ title: '準備簡報', date: SUNDAY })
    ai.ask = vi.fn(async (task, data) => blank({ say: '下週', schedule: [{ id: data.days[0].tasks[0].id, date: '2026-11-25', at: '', dur: 0 }] }))
    await agent.tick()
    agent.dismiss()
    expect(store.state.agent.ran.week).toBe(MONDAY)
    // 接著是平常的「晚上準備明天」，不會再提一次下一週
    await agent.tick()
    expect(ai.ask.mock.calls.at(-1)[1].run).toBe('evening')

    // 另一份：沒決定
    localStorage.clear()
    const s2 = new Store()
    s2.importJSON(JSON.stringify({ tasks: [], events: [], projects: [], player: { xp: 0, coins: 0 } }))
    s2.state.agent.ran.morning = SUNDAY
    const a2 = createAgent(s2, { busy: () => false, holding: () => false, focusing: () => null })
    s2.addTask({ title: '準備簡報', date: SUNDAY })
    await a2.tick()
    expect(a2.pending?.run).toBe('week')
    vi.setSystemTime(new Date(2026, 10, 23, 9))
    s2.tick?.()
    ai.ask = vi.fn(async () => blank())
    s2.addTask({ title: '星期一的事', date: MONDAY })
    await a2.tick()
    expect(ai.ask.mock.calls[0][1]).toMatchObject({ run: 'morning', weekStart: true })
  })

  it('沒有要動的（只有一句話）：直接記下，下一週算排過了', async () => {
    ai.ask = vi.fn(async () => blank({ say: '下週很鬆，照常就好' }))
    store.addTask({ title: '準備簡報', date: SUNDAY })
    await agent.tick()
    expect(agent.pending).toBeNull()
    expect(store.state.agent.ran).toMatchObject({ plan: SUNDAY, week: MONDAY })
  })

  it('排下一週一次可以加到 10 件（平常自己整理最多 3 件）', () => {
    const { ids } = agentContext(store, 'week', {}, new Date())
    const add = Array.from({ length: 12 }, (_, i) => ({ title: `第 ${i + 1} 件`, date: MONDAY }))
    expect(cleanOut({ add }, ids, 'week').add).toHaveLength(10)
    expect(cleanOut({ add }, ids, 'morning').add).toHaveLength(3)
  })

  it('讀檔時 ran.plan 照規則清', () => {
    expect(migrate({ ...JSON.parse(JSON.stringify(store.state)), agent: { ran: { plan: SUNDAY, week: 'x' } } }).agent.ran).toMatchObject({ plan: SUNDAY, week: '' })
  })
})

describe('晚上回顧今天', () => {
  it('資料帶著今天做完幾件、總共幾件、專注多久', () => {
    const a = store.addTask({ title: 'A', date: SUNDAY })
    store.addTask({ title: 'B', date: SUNDAY })
    store.toggleTask(a.id)
    store.completePomodoro(25, a.id)
    const { data } = agentContext(store, 'evening', {}, new Date())
    expect(data.stats.today).toEqual({ done: 1, total: 2, focusMin: 25 })
    expect(data.days).toHaveLength(7)
  })
})
