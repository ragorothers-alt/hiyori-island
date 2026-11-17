import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 往前看：截止日、專案會不會來不及（src/risk.js）、變差了才說一次（src/riskWatch.js）、很緊時交給ふじ（agentRunner 的 risk）
const ai = vi.hoisted(() => ({ ask: null }))
vi.mock('../src/ai.js', async (orig) => ({ ...(await orig()), aiReady: () => true, askAI: (...a) => ai.ask(...a) }))

const { Store, addDays } = await import('../src/store.js')
const { dueRisks, projectRisks, roomOn, worse } = await import('../src/risk.js')
const { createRiskWatch } = await import('../src/riskWatch.js')
const { agentContext } = await import('../src/agent.js')
const { createAgent } = await import('../src/agentRunner.js')
const { DEFAULT_RHYTHM } = await import('../src/planner.js')

const TODAY = '2026-11-16' // 星期一
const DAY = 86400000
const at = (hour, min = 0) => vi.setSystemTime(new Date(2026, 10, 16, hour, min))
const blank = (o = {}) => ({ say: '', schedule: [], add: [], steps: [], split: [], edit: [], star: [], first: '', msteps: [], next: '', remember: [], forget: [], done: [], drop: [], events: [], dates: [], ask: [], ...o })
let store

beforeEach(() => {
  vi.useFakeTimers()
  at(9)
  localStorage.clear()
  ai.ask = vi.fn(async () => blank())
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], events: [], projects: [], player: { xp: 0, coins: 0 } }))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

const risks = (tasks, o = {}) => dueRisks({ tasks, rhythm: DEFAULT_RHYTHM, today: TODAY, nowMin: 9 * 60, ...o })
const task = (o) => ({ id: o.id || 't', title: 'T', date: TODAY, priority: 2, done: false, spent: 0, ...o })

describe('截止日的風險', () => {
  it('空檔：醒著扣掉三餐和日程；今天從現在算起；過去的日子是 0', () => {
    // 07:00–23:30 扣三餐 150 分＝840
    expect(roomOn({ rhythm: DEFAULT_RHYTHM, date: addDays(TODAY, 1), today: TODAY })).toBe(840)
    expect(roomOn({ rhythm: DEFAULT_RHYTHM, date: addDays(TODAY, 1), today: TODAY, events: [{ start: '14:00', end: '16:00' }] })).toBe(720 - (DEFAULT_RHYTHM.buffer || 0) * 2)
    // 今天 9:00 起：870 扣午餐、晚餐 120
    expect(roomOn({ rhythm: DEFAULT_RHYTHM, date: TODAY, today: TODAY, nowMin: 540 })).toBe(750)
    expect(roomOn({ rhythm: DEFAULT_RHYTHM, date: addDays(TODAY, -1), today: TODAY })).toBe(0)
  })

  it('來得及／很緊／來不及：剩下的工作 × 超時倍率，跟空檔的七成比', () => {
    const room = risks([task({ dur: 30, due: addDays(TODAY, 1) })])[0].room
    expect(room).toBe(Math.round((750 + 840) * 0.7))
    expect(risks([task({ dur: Math.round(room * 0.5), due: addDays(TODAY, 1) })])[0].level).toBe('ok')
    expect(risks([task({ dur: Math.round(room * 0.8), due: addDays(TODAY, 1) })])[0].level).toBe('tight')
    expect(risks([task({ dur: room + 60, due: addDays(TODAY, 1) })])[0].level).toBe('late')
    // 平常超時 1.5 倍：本來來得及的變很緊；平常提早做完的不縮
    const half = task({ dur: Math.round(room * 0.5), due: addDays(TODAY, 1) })
    expect(risks([half], { ratio: 1.5 })[0]).toMatchObject({ level: 'tight', need: Math.round(Math.round(room * 0.5) * 1.5) })
    expect(risks([half], { ratio: 0.5 })[0].level).toBe('ok')
    // 已經專注過的扣掉；超過預估還沒做完的至少算 15 分
    expect(risks([task({ dur: room, spent: room - 100, due: addDays(TODAY, 1) })])[0]).toMatchObject({ level: 'ok', need: 100 })
    expect(risks([task({ dur: 60, spent: 90, due: addDays(TODAY, 1) })])[0].need).toBe(15)
  })

  it('越晚截止的把前面截止的也算進去；做完的、長期的、過了的、太遠的不算', () => {
    const room1 = risks([task({ dur: 30, due: addDays(TODAY, 1) })])[0].room
    const list = risks([
      task({ id: 'a', dur: Math.round(room1 * 0.9), due: addDays(TODAY, 1) }),
      task({ id: 'b', dur: 600, due: addDays(TODAY, 2) }),
      task({ id: 'done', dur: 5000, due: addDays(TODAY, 1), done: true }),
      task({ id: 'ongoing', dur: 5000, due: addDays(TODAY, 1), ongoing: true, project: 'p' }),
      task({ id: 'past', dur: 5000, due: addDays(TODAY, -1) }),
      task({ id: 'far', dur: 5000, due: addDays(TODAY, 90) }),
    ])
    expect(list.map((r) => [r.date, r.ids])).toEqual([[addDays(TODAY, 1), ['a']], [addDays(TODAY, 2), ['b']]])
    expect(list[0].level).toBe('tight')
    expect(list[1].need).toBe(Math.round(room1 * 0.9) + 600)
  })

  it('變差的才算：沒有上一次算來得及', () => {
    expect(worse('tight')).toBe(true)
    expect(worse('late', 'tight')).toBe(true)
    expect(worse('tight', 'late')).toBe(false)
    expect(worse('ok', 'tight')).toBe(false)
    expect(worse('stalled', 'ok')).toBe(true)
  })
})

describe('專案的速度', () => {
  const now = new Date(2026, 10, 16, 9).getTime()
  const ms = (done, ago = 3) => ({ id: `m${Math.random()}`, title: 'M', done, doneAt: done ? now - ago * DAY : null })
  const proj = (o) => ({ id: 'p1', name: '作品集', createdAt: now - 60 * DAY, deadline: addDays(TODAY, 30), milestones: [], logs: [], notes: [], ...o })

  it('照最近 4 週的速度推算哪天做完，跟期限比；停了一週以上的算停住', () => {
    const ok = projectRisks({ projects: [proj({ milestones: [ms(true), ms(true, 10), ms(false), ms(false)] })], today: TODAY, now })
    // 4 週做完 2 個＝一週 0.5 個，剩 2 個要 4 週
    expect(ok[0]).toMatchObject({ level: 'ok', left: 2, pace: 0.5, eta: addDays(TODAY, 28) })
    const late = projectRisks({ projects: [proj({ deadline: addDays(TODAY, 14), milestones: [ms(true), ms(false), ms(false), ms(false)] })], today: TODAY, now })
    expect(late[0]).toMatchObject({ level: 'late', left: 3, eta: addDays(TODAY, 84), late: 70 })
    const stalled = projectRisks({ projects: [proj({ milestones: [ms(true, 40), ms(false)], logs: [{ at: now - 10 * DAY, date: addDays(TODAY, -10) }] })], today: TODAY, now })
    expect(stalled[0]).toMatchObject({ level: 'stalled', idle: 10, left: 1 })
  })

  it('剛開始不到 4 週的用開始到現在算速度；範例、沒期限、過期、暫停、收起來、做完的不算', () => {
    const young = projectRisks({ projects: [proj({ createdAt: now - 7 * DAY, milestones: [ms(true), ms(false), ms(false)] })], today: TODAY, now })
    expect(young[0]).toMatchObject({ pace: 1, eta: addDays(TODAY, 14) })
    const skip = [
      proj({ id: 'ex-1', milestones: [ms(false)] }), proj({ id: 'a', deadline: null, milestones: [ms(false)] }), proj({ id: 'b', deadline: addDays(TODAY, -1), milestones: [ms(false)] }),
      proj({ id: 'c', pausedAt: now, milestones: [ms(false)] }), proj({ id: 'd', archived: true, milestones: [ms(false)] }), proj({ id: 'e', milestones: [ms(true)] }),
    ]
    expect(projectRisks({ projects: skip, today: TODAY, now })).toEqual([])
    // 範例專案寫進了自己的東西：算使用者的
    expect(projectRisks({ projects: [proj({ id: 'ex-2', mine: true, milestones: [ms(false)], createdAt: now - 30 * DAY })], today: TODAY, now })[0].level).toBe('stalled')
  })
})

describe('變差了才說一次', () => {
  it('截止日：第一次變緊說、再看不說；變好又變差再說一次；過了的不留', () => {
    const t = store.addTask({ title: '期末報告', date: TODAY, due: TODAY, dur: 600 })
    const w = createRiskWatch(store)
    expect(w.check().due.map((r) => r.level)).toEqual(['late'])
    expect(w.check().due).toEqual([])
    store.updateTask(t.id, { dur: 30 })
    expect(createRiskWatch(store).check().due).toEqual([])
    store.updateTask(t.id, { dur: 600 })
    // 另一個分頁（另一個 watch）也一樣：照存著的比
    expect(createRiskWatch(store).check().due.map((r) => r.level)).toEqual(['late'])
    expect(createRiskWatch(store).check().due).toEqual([])
  })

  it('專案一週看一次', () => {
    const p = store.addProject({ name: '自己的專案', deadline: addDays(TODAY, 30), milestones: ['一', '二'] })
    p.createdAt = Date.now() - 20 * DAY
    p.editedAt = Date.now() - 20 * DAY
    const w = createRiskWatch(store)
    expect(w.check().projects.map((r) => r.level)).toEqual(['stalled'])
    expect(w.check().projects).toEqual([])
    vi.setSystemTime(new Date(2026, 10, 23, 9))
    store.tick?.()
    // 新的一週：還是停住（沒變差）不再說
    expect(createRiskWatch(store).check().projects).toEqual([])
  })
})

describe('ふじ看得到風險；很緊時替它整理一次', () => {
  it('資料裡帶著很緊、來不及的截止日和會晚的專案（來得及的不帶）', () => {
    store.addTask({ title: '期末報告', date: TODAY, due: TODAY, dur: 600 })
    store.addTask({ title: '小事', date: TODAY, due: addDays(TODAY, 5), dur: 20 })
    const p = store.addProject({ name: '自己的專案', deadline: addDays(TODAY, 30), milestones: ['一'] })
    p.createdAt = Date.now() - 20 * DAY
    p.editedAt = Date.now() - 20 * DAY
    const { data } = agentContext(store, 'morning', {}, new Date())
    expect(data.risk).toEqual([expect.objectContaining({ date: TODAY, level: 'late', tasks: [{ id: expect.stringMatching(/^t/), title: '期末報告' }] })])
    expect(data.projects.find((x) => x.name === '自己的專案').pace).toEqual({ level: 'stalled', idle: 20 })
    store.state.tasks = store.state.tasks.filter((t) => t.title === '小事')
    expect(agentContext(store, 'morning', {}, new Date()).data).not.toHaveProperty('risk')
  })

  it('早上的整理先做；之後很緊的截止日自己整理一次（run 是 risk、why 寫著），同樣的狀況不再做；就寢前一小時後不做', async () => {
    let r = { why: '「期末報告」明天截止，很緊', sig: 'a' }
    const agent = createAgent(store, { busy: () => false, holding: () => false, focusing: () => null, risk: () => r })
    store.addTask({ title: '期末報告', date: TODAY })
    await agent.tick()
    expect(ai.ask.mock.calls.map((c) => c[1].run)).toEqual(['morning'])
    // 早上那次已經看過同一個風險：不再為它整理
    expect(agent.tick()).toBeNull()
    r = { why: '「期末報告」「簡報」明天截止，很緊', sig: 'b' }
    await agent.tick()
    expect(ai.ask.mock.calls.map((c) => c[1].run)).toEqual(['morning', 'risk'])
    expect(ai.ask.mock.calls[1][1].why).toBe('「期末報告」「簡報」明天截止，很緊')
    expect(agent.tick()).toBeNull()
    // 就寢（23:30）前一小時後：新的風險也等明天早上的整理
    r = { why: 'x', sig: 'c' }
    store.state.agent.ran.evening = TODAY
    at(22, 45)
    expect(agent.tick()).toBeNull()
    at(22, 15)
    await agent.tick()
    expect(ai.ask.mock.calls.at(-1)[1].run).toBe('risk')
  })
})
