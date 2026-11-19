import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, addDays } from '../src/store.js'
import { migrate } from '../src/store/migrate.js'
import { parseQuick, describeQuick } from '../src/parse.js'
import { optimizeDay, estimateRatio, stretchDur, sessionLen, DEFAULT_RHYTHM, SPLIT_MIN } from '../src/planner.js'
import { agentContext, cleanOut, saneAct } from '../src/agent.js'
import { buildInsights } from '../src/insights.js'

// 排程的核心：截止日、預估準不準、不排太滿、大任務分段（ふじ也用得到）
const TODAY = '2026-11-16' // 星期一
let store
const at = (hour, min = 0) => vi.setSystemTime(new Date(2026, 10, 16, hour, min))
const blank = (o = {}) => ({ say: '', schedule: [], add: [], steps: [], split: [], edit: [], star: [], first: '', msteps: [], next: '', remember: [], forget: [], done: [], drop: [], events: [], dates: [], ask: [], ...o })

beforeEach(() => {
  vi.useFakeTimers()
  at(9)
  localStorage.clear()
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], events: [], projects: [], player: { xp: 0, coins: 0 } }))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('截止日', () => {
  it('一行輸入：「週五前」「11/20 之前」「截止 11/20」「明天到期」是截止日，剩下的日期才是哪天做', () => {
    expect(parseQuick('交報告 週五前', { today: TODAY })).toMatchObject({ title: '交報告', due: '2026-11-20', date: null })
    expect(parseQuick('明天 寫企劃 11/25 之前', { today: TODAY })).toMatchObject({ title: '寫企劃', due: '2026-11-25', date: '2026-11-17' })
    expect(parseQuick('截止 11/20 期末報告', { today: TODAY })).toMatchObject({ title: '期末報告', due: '2026-11-20' })
    expect(parseQuick('繳費 明天到期', { today: TODAY })).toMatchObject({ title: '繳費', due: '2026-11-17' })
    expect(parseQuick('下週三前 交作業', { today: TODAY }).due).toBe('2026-11-25')
    // 「前往」「前面」的前不是截止
    expect(parseQuick('明天前往台北', { today: TODAY })).toMatchObject({ date: '2026-11-17', title: '前往台北' })
    expect(parseQuick('明天前往台北', { today: TODAY })).not.toHaveProperty('due')
    // 日程沒有截止日
    expect(parseQuick('週五前 下午3點 開會', { today: TODAY })).not.toHaveProperty('due')
    expect(describeQuick(parseQuick('交報告 週五前', { today: TODAY }), TODAY)).toContain('截止 11/20（五）')
  })

  it('任務存得下截止日，讀檔、改、清掉都照規則', () => {
    const t = store.addTask({ title: '期末報告', date: TODAY, due: '2026-11-20' })
    expect(t.due).toBe('2026-11-20')
    store.updateTask(t.id, { due: 'banana' })
    expect(t.due).toBeNull()
    store.updateTask(t.id, { due: '2026-11-22' })
    const back = migrate(JSON.parse(JSON.stringify(store.state)))
    expect(back.tasks.find((x) => x.id === t.id)).toMatchObject({ due: '2026-11-22', spent: 0 })
    expect(migrate({ ...JSON.parse(JSON.stringify(store.state)), tasks: [{ id: 'x1', title: '壞的', date: TODAY, due: '11/20', spent: -5 }] }).tasks[0]).toMatchObject({ due: null, spent: 0 })
    expect(store.addTask({ title: '沒截止', date: TODAY }).due).toBeNull()
  })

  it('最佳化時程：截止日快到的排前面（比一般的高優先還前面）', () => {
    const tasks = [
      { id: 'a', title: '高優先', priority: 3, dur: 60, date: TODAY },
      { id: 'b', title: '明天截止', priority: 2, dur: 60, date: TODAY, due: addDays(TODAY, 1) },
    ]
    const r = optimizeDay({ tasks, events: [], rhythm: DEFAULT_RHYTHM, date: TODAY, today: TODAY, nowMin: 9 * 60 })
    expect(r.plan.map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('預估準不準', () => {
  const done = (dur, spent, i = 0) => ({ id: `t${i}`, done: true, doneAt: Date.now() - i * 3600e3, dur, spent })
  it('實際專注 ÷ 預估取中位數；少於 5 件、太久以前、只專注一小段的不算', () => {
    expect(estimateRatio([30, 30, 30, 30].map((d, i) => done(d, 45, i)))).toBeNull()
    const list = [done(30, 45, 1), done(30, 45, 2), done(60, 90, 3), done(20, 30, 4), done(40, 60, 5), done(30, 300, 6), done(60, 5, 7), { ...done(30, 90, 8), doneAt: Date.now() - 90 * 864e5 }]
    expect(estimateRatio(list)).toEqual({ ratio: 1.5, n: 5 })
    expect(stretchDur(40, 1.5)).toBe(60)
    expect(stretchDur(40, 0.7)).toBe(40)
    expect(stretchDur(200, 3)).toBe(400)
  })

  it('專注時記下實際做了幾分鐘；週報說一聲；ふじ拿得到', () => {
    const t = store.addTask({ title: '讀書', date: TODAY, dur: 30 })
    store.completePomodoro(25, t.id)
    store.completePomodoro(20, t.id, null, null, { extra: true })
    expect(t).toMatchObject({ pomos: 1, spent: 45 })
    for (let i = 0; i < 5; i++) {
      const x = store.addTask({ title: `寫 ${i}`, date: TODAY, dur: 40 })
      store.completePomodoro(60, x.id)
      store.toggleTask(x.id)
    }
    expect(store.estimate()).toEqual({ ratio: 1.5, n: 5 })
    const ins = buildInsights({ tasks: store.state.tasks, history: {}, habits: [], rhythm: DEFAULT_RHYTHM, today: TODAY })
    expect(ins.find((x) => x.id === 'estimate')).toMatchObject({ title: '實際花的時間大約是預估的 1.5 倍' })
    const { data } = agentContext(store, 'morning', {}, new Date())
    expect(data.user.estimate).toEqual({ ratio: 1.5, n: 5 })
    expect(data.days[0].tasks.find((x) => x.title === '讀書')).toMatchObject({ spent: 45 })
  })

  it('會超時的人：排的時候每件後面多留（任務的長度不改）', () => {
    const tasks = [{ id: 'a', title: 'A', priority: 2, dur: 40, date: TODAY }, { id: 'b', title: 'B', priority: 2, dur: 40, date: TODAY }]
    const rhythm = { ...DEFAULT_RHYTHM, buffer: 0, peak: 'evening', work: null }
    const r = optimizeDay({ tasks, events: [], rhythm, date: TODAY, today: TODAY, nowMin: 9 * 60, stretch: 1.5, fill: 1 })
    expect(r.plan).toEqual([{ id: 'a', at: '09:05', dur: 40 }, { id: 'b', at: '10:05', dur: 40 }])
  })
})

describe('不排太滿', () => {
  it('最多用掉空檔的七成：一般的任務超過就留到別天，本命、高優先的照排；使用者自己放的不受限', () => {
    // 從 19:00 到 23:30 扣掉…：只有晚上，空檔大約 270 分
    const now = 19 * 60
    const tasks = [1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, title: `T${i}`, priority: 2, dur: 50, date: TODAY }))
    tasks.push({ id: 'star', title: '本命', priority: 2, dur: 50, date: TODAY, star: true })
    const r = optimizeDay({ tasks, events: [], rhythm: DEFAULT_RHYTHM, date: TODAY, today: TODAY, nowMin: now })
    expect(r.plan.map((p) => p.id)).toContain('star')
    expect(r.full.length).toBeGreaterThan(0)
    expect(r.left).toEqual(expect.arrayContaining(r.full))
    const used = r.plan.reduce((a, p) => a + p.dur, 0)
    expect(used).toBeLessThanOrEqual(270 * 0.7 + 50)
    const all = optimizeDay({ tasks, events: [], rhythm: DEFAULT_RHYTHM, date: TODAY, today: TODAY, nowMin: now, fill: 1 })
    expect(all.plan.length).toBeGreaterThan(r.plan.length)
  })

  it('午後低潮：輕鬆的小事放這裡，重的避開', () => {
    const rhythm = { ...DEFAULT_RHYTHM, work: null, peak: 'morning' }
    const tasks = [{ id: 'light', title: '回信', priority: 1, dur: 15, date: TODAY }, { id: 'heavy', title: '寫報告', priority: 3, dur: 60, date: TODAY }]
    const r = optimizeDay({ tasks, events: [], rhythm, date: TODAY, today: TODAY, nowMin: 8 * 60 + 30, fill: 1 })
    const atOf = (id) => r.plan.find((p) => p.id === id).at
    expect(atOf('light') >= '13:00' && atOf('light') < '15:00').toBe(true)
    expect(atOf('heavy') >= '09:00' && atOf('heavy') < '12:00').toBe(true)
  })

  it('重排：原本就排了時段的不因為「太滿」被踢掉；真的被佔走位置的，套用時清掉時段（不會疊在一起）', () => {
    const tomorrow = addDays(TODAY, 1)
    const rhythm = { ...DEFAULT_RHYTHM, wake: '08:00', sleep: '12:00', meals: [], buffer: 0, work: null }
    const overlaps = (list) => list.some((a, i) => list.some((b, j) => i !== j && a.s < b.e && b.s < a.e))
    const span = (at, dur) => ({ s: +at.slice(0, 2) * 60 + +at.slice(3), e: +at.slice(0, 2) * 60 + +at.slice(3) + dur })
    // 08:00、09:00 各一件，再加一件 120 分鐘的：七成上限不會把原本那兩件擠掉
    const tasks = [
      { id: 'a', title: 'A', priority: 2, dur: 60, date: tomorrow, at: '08:00' },
      { id: 'b', title: 'B', priority: 2, dur: 60, date: tomorrow, at: '09:00' },
      { id: 'c', title: 'C', priority: 2, dur: 120, date: tomorrow },
    ]
    const r = optimizeDay({ tasks, events: [], rhythm, date: tomorrow, today: TODAY, replan: true })
    expect(r.plan.map((p) => p.id).sort()).toEqual(['a', 'b', 'c'])
    expect(overlaps(r.plan.map((p) => span(p.at, p.dur)))).toBe(false)
    expect(r.unslot).toEqual([])
    // 高優先的一件佔滿整個早上：原本 08:00 那件放不下，套用後時段清掉
    store.state.rhythm = rhythm
    const low = store.addTask({ title: '低', date: tomorrow, dur: 60, at: '08:00', priority: 1 })
    const high = store.addTask({ title: '高', date: tomorrow, dur: 240, priority: 3 })
    const p = store.planDay(tomorrow, { replan: true })
    expect(p.unslot).toEqual([low.id])
    store.applyPlan(tomorrow, p.plan, p.left.length, p.unslot)
    expect(high.at).toBe('08:00')
    expect(low.at).toBeNull()
  })

  it('套用之後可以整批撤銷：被清掉的時段放回去、逾期搬過來的回原本那天；之後又改過的那件留著', () => {
    const tomorrow = addDays(TODAY, 1)
    store.state.rhythm = { ...DEFAULT_RHYTHM, wake: '08:00', sleep: '12:00', meals: [], buffer: 0, work: null }
    const low = store.addTask({ title: '低', date: tomorrow, dur: 60, at: '08:00', priority: 1 })
    const high = store.addTask({ title: '高', date: tomorrow, dur: 240, priority: 3 })
    const plans = store.stats.plansApplied
    const p = store.planDay(tomorrow, { replan: true })
    const u = store.applyPlan(tomorrow, p.plan, p.left.length, p.unslot)
    expect(u.count).toBe(1)
    expect(store.stats.plansApplied).toBe(plans + 1)
    expect(store.undoPlan(u)).toEqual({ back: 2, kept: 0 })
    expect([high.at, low.at]).toEqual([null, '08:00'])
    // 撤銷了就不算一次（成就不能靠套用、撤銷刷）
    expect(store.stats.plansApplied).toBe(plans)
    // 再套用一次，之後自己把「高」挪到 09:00：它留著，「低」放回 08:00
    const p2 = store.planDay(tomorrow, { replan: true })
    const u2 = store.applyPlan(tomorrow, p2.plan, p2.left.length, p2.unslot)
    store.scheduleTask(high.id, '09:00')
    expect(store.undoPlan(u2)).toEqual({ back: 1, kept: 1 })
    expect([high.at, low.at]).toEqual(['09:00', '08:00'])
    // 逾期的搬到今天：撤銷後回到原本那天，往後挪的次數也扣回去
    const old = store.addTask({ title: '舊的', date: addDays(TODAY, -2), dur: 30 })
    const p3 = store.planDay(TODAY)
    const u3 = store.applyPlan(TODAY, p3.plan, p3.left.length, p3.unslot)
    expect([old.date, old.moved]).toEqual([TODAY, 1])
    expect(store.undoPlan(u3).back).toBe(1)
    expect([old.date, old.at, old.moved || 0]).toEqual([addDays(TODAY, -2), null, 0])
    // 一件都排不進去：什麼都不動，回傳 null
    expect(store.applyPlan(TODAY, [{ id: 'nope', at: '10:00', dur: 30 }])).toBeNull()
  })

  it('比哪一段空檔都長的大任務：標成 big（可以分段）', () => {
    // 最大的一段空檔是午餐後到晚餐前（13:00–18:30，330 分）
    const tasks = [{ id: 'big', title: '寫論文', priority: 2, dur: 400, date: TODAY }]
    const r = optimizeDay({ tasks, events: [], rhythm: DEFAULT_RHYTHM, date: TODAY, today: TODAY, nowMin: 9 * 60, fill: 1 })
    expect(r.big).toEqual(['big'])
    expect(store.planDay(TODAY)).toMatchObject({ big: [] })
  })
})

describe('大任務分段', () => {
  it('照專注長度分段、一天一段；有截止日的擠在截止日前；原本那件是第一段', () => {
    expect(sessionLen(25)).toBe(50)
    expect(sessionLen(50)).toBe(50)
    const t = store.addTask({ title: '期末報告', date: TODAY, dur: 180, priority: 3, tag: 'study', due: addDays(TODAY, 1) })
    t.subs = [{ id: 's1', title: '找資料', done: false }]
    const u = store.splitSessions(t.id)
    expect(u.made).toHaveLength(3)
    const parts = [t, ...u.made.map((m) => store.state.tasks.find((x) => x.id === m.id))]
    expect(parts.map((x) => [x.title, x.date, x.dur])).toEqual([
      ['期末報告（1/4）', TODAY, 45],
      ['期末報告（2/4）', TODAY, 45],
      ['期末報告（3/4）', addDays(TODAY, 1), 45],
      ['期末報告（4/4）', addDays(TODAY, 1), 45],
    ])
    expect(parts.every((x) => x.priority === 3 && x.tag === 'study' && x.due === addDays(TODAY, 1))).toBe(true)
    expect(t.subs).toHaveLength(1)
    expect(parts[1].subs).toEqual([])
    // 沒有截止日：一天一段
    const b = store.addTask({ title: '整理照片', date: TODAY, dur: 120 })
    const ub = store.splitSessions(b.id, 3)
    expect([b, ...ub.made.map((m) => store.state.tasks.find((x) => x.id === m.id))].map((x) => x.date)).toEqual([TODAY, addDays(TODAY, 1), addDays(TODAY, 2)])
    // 做完的、例行公事、長期任務不分
    store.toggleTask(b.id)
    expect(store.splitSessions(b.id)).toBeNull()
  })

  it('復原：分出來的都還沒動過才整個變回去；有一段做了、改過就留著現在的分法', () => {
    const t = store.addTask({ title: '寫論文', date: TODAY, dur: 200, at: '09:00' })
    const u = store.splitSessions(t.id, 4)
    expect(store.undoSplit(u)).toBe(true)
    expect(store.state.tasks).toHaveLength(1)
    expect(t).toMatchObject({ title: '寫論文', dur: 200, at: '09:00', date: TODAY })
    const u2 = store.splitSessions(t.id, 3)
    store.toggleTask(u2.made[0].id)
    expect(store.undoSplit(u2)).toBe(true)
    expect(store.state.tasks).toHaveLength(2)
    expect(t.title).toBe('寫論文（1/3）')
  })

  it('復原分段：之後改了截止日、專注過（就算沒滿一輪）的那一段留著', () => {
    const t = store.addTask({ title: '寫論文', date: TODAY, dur: 150 })
    const u = store.splitSessions(t.id, 4)
    store.updateTask(u.made[0].id, { due: addDays(TODAY, 5) })
    store.completePomodoro(20, u.made[1].id, null, null, { extra: true })
    expect(store.state.tasks.find((x) => x.id === u.made[1].id)).toMatchObject({ pomos: 0, spent: 20 })
    // 沒動過的第三段收掉；改過的兩段留著
    expect(store.undoSplit(u)).toBe(true)
    expect(store.state.tasks.map((x) => x.id).sort()).toEqual([t.id, u.made[0].id, u.made[1].id].sort())
  })

  it('ふじ也能分段（自己整理時也可以），撤銷記錄經過讀檔還在、撤銷得回來', () => {
    const t = store.addTask({ title: '準備簡報', date: TODAY, dur: 150 })
    const { ids, data } = agentContext(store, 'morning', {}, new Date())
    const alias = data.days[0].tasks.find((x) => x.title === '準備簡報').id
    const act = cleanOut(blank({ split: [{ id: alias, parts: 3 }, { id: alias, parts: 5 }, { id: 't999', parts: 2 }], add: [{ title: '交報告', date: TODAY, at: '', dur: 30, tag: 'work', project: '', steps: [], star: false, due: '2026-11-20' }] }), ids, 'morning')
    expect(act.split).toEqual([{ id: t.id, parts: 3 }])
    expect(saneAct(act)).toBe(true)
    // 之前存著、沒有 split 的那一份也還認得
    const { split, ...old } = act
    expect(saneAct(old)).toBe(true)
    const entry = store.agentApply(act, { run: 'morning' })
    expect(entry.changes.map((c) => c.t)).toContain('「準備簡報」分成 3 段（今天、明天、後天）')
    expect(store.state.tasks.find((x) => x.title === '交報告').due).toBe('2026-11-20')
    store.replaceState(migrate(JSON.parse(JSON.stringify(store.state))))
    const kept = store.state.agent.log.at(-1).changes.find((c) => c.u?.k === 'split').u
    expect(kept.made).toHaveLength(2)
    expect(store.agentUndo(entry.id)).toBe(2)
    expect(store.state.tasks.map((x) => x.title)).toEqual(['準備簡報'])
  })

  it('ふじ自己整理時不把任務挪過截止日（開口要的照做）', () => {
    const t = store.addTask({ title: '報名', date: TODAY, due: addDays(TODAY, 1) })
    const { ids, data } = agentContext(store, 'morning', {}, new Date())
    const alias = data.days[0].tasks[0].id
    expect(data.days[0].tasks[0].due).toBe(addDays(TODAY, 1))
    store.agentApply(cleanOut(blank({ schedule: [{ id: alias, date: addDays(TODAY, 3), at: '', dur: 0 }] }), ids, 'morning'), { run: 'morning' })
    expect(t.date).toBe(TODAY)
    const c = agentContext(store, 'chat', { message: '報名移到週四' }, new Date())
    store.agentApply(cleanOut(blank({ schedule: [{ id: c.data.days[0].tasks[0].id, date: addDays(TODAY, 3), at: '', dur: 0 }], set: [], create: [], go: { do: '', id: '' } }), c.ids, 'chat'), { run: 'chat' })
    expect(t.date).toBe(addDays(TODAY, 3))
  })

  it('不挪過截止日的那件，原本的時段照樣佔著（同一批別件不能排進去）', () => {
    const tomorrow = addDays(TODAY, 1)
    const a = store.addTask({ title: 'A', date: tomorrow, at: '09:00', dur: 60, due: addDays(TODAY, 2) })
    const b = store.addTask({ title: 'B', date: tomorrow, at: '10:30', dur: 60 })
    const { ids, data } = agentContext(store, 'evening', {}, new Date())
    const alias = (title) => data.days.flatMap((d) => d.tasks).find((x) => x.title === title).id
    store.agentApply(cleanOut(blank({ schedule: [{ id: alias('A'), date: addDays(TODAY, 3), at: '09:00', dur: 0 }, { id: alias('B'), date: tomorrow, at: '09:00', dur: 0 }] }), ids, 'evening'), { run: 'evening' })
    expect(a).toMatchObject({ date: tomorrow, at: '09:00' })
    expect(b.at === '09:00').toBe(false)
  })

  it('試跑看到的：星期幾有對照；範例專案標出來，她自己整理時加的細項不會把範例變成自己的', () => {
    localStorage.clear()
    const fresh = new Store()
    const ex = fresh.state.projects.find((p) => p.id.startsWith('ex-') && !(p.milestones.find((m) => !m.done)?.steps || []).length)
    expect(ex).toBeTruthy()
    const { ids, data } = agentContext(fresh, 'morning', {}, new Date())
    expect(data.mondays).toHaveLength(10)
    expect(data.mondays[0]).toBe(TODAY)
    expect(data.mondays.every((d) => new Date(`${d}T12:00`).getDay() === 1)).toBe(true)
    const p = data.projects.find((x) => x.name === ex.name)
    expect(p.sample).toBe(true)
    const m = ex.milestones.find((y) => !y.done)
    const act = cleanOut(blank({ msteps: [{ ms: p.next.id, steps: ['打開今天頁', '開一輪專注'] }] }), ids, 'morning')
    const entry = fresh.agentApply(act, { run: 'morning' })
    expect(m.steps.map((s) => s.title)).toEqual(['打開今天頁', '開一輪專注'])
    expect(!!ex.mine).toBe(false)
    expect(fresh.samples().projects).toContain(ex)
    fresh.agentUndo(entry.id)
    expect(m.steps).toEqual([])
    // 使用者開口要的：算他自己寫的（清範例時留著），也就不再標 sample
    const c = agentContext(fresh, 'chat', { message: '幫這個專案拆細項' }, new Date())
    const cp = c.data.projects.find((x) => x.name === ex.name)
    fresh.agentApply(cleanOut(blank({ msteps: [{ ms: cp.next.id, steps: ['讀說明'] }], set: [], create: [], go: { do: '', id: '' } }), c.ids, 'chat'), { run: 'chat' })
    expect(ex.mine).toBe(true)
    expect(agentContext(fresh, 'morning', {}, new Date()).data.projects.find((x) => x.name === ex.name)).not.toHaveProperty('sample')
  })

  it('對話裡改截止日、清掉截止日都會生效，撤銷回到原本的', () => {
    const t = store.addTask({ title: '期末報告', date: TODAY, due: '2026-11-20' })
    const run = (value) => {
      const c = agentContext(store, 'chat', { message: '期末報告改成 22 號交' }, new Date())
      const id = c.data.days[0].tasks.find((x) => x.title === '期末報告').id
      const act = cleanOut(blank({ set: [{ kind: 'task', id, field: 'due', value }], create: [], go: { do: '', id: '' } }), c.ids, 'chat')
      return store.agentApply(act, { run: 'chat' })
    }
    const e1 = run('2026-11-22')
    expect(t.due).toBe('2026-11-22')
    store.agentUndo(e1.id)
    expect(t.due).toBe('2026-11-20')
    run('')
    expect(t.due).toBeNull()
  })

  it('自己整理時把「先記下來的事」變成任務、收掉那一筆（只能收這一種），撤銷時放回去', () => {
    const k = store.park('買投影機轉接頭')
    const t = store.addTask({ title: '原本的任務', date: TODAY })
    const { ids, data } = agentContext(store, 'evening', {}, new Date())
    expect(data.parked).toEqual([{ id: expect.stringMatching(/^k/), text: '買投影機轉接頭' }])
    expect(agentContext(store, 'chat', { message: '嗨' }, new Date()).data).not.toHaveProperty('parked')
    const tid = data.days[0].tasks[0].id
    const act = cleanOut(blank({ add: [{ title: '買投影機轉接頭', date: addDays(TODAY, 1), at: '', dur: 15, tag: 'life', project: '', steps: [], star: false, due: '' }], drop: [data.parked[0].id, tid] }), ids, 'evening')
    expect(act.drop).toEqual([])
    expect(act.ops.drop).toEqual([expect.objectContaining({ kind: 'park', id: k.id })])
    const entry = store.agentApply(act, { run: 'evening' })
    expect(store.state.parked).toEqual([])
    expect(store.state.tasks.map((x) => x.title)).toEqual(['原本的任務', '買投影機轉接頭'])
    expect(t.done).toBe(false)
    store.agentUndo(entry.id)
    expect(store.state.parked.map((x) => x.text)).toEqual(['買投影機轉接頭'])
    expect(store.state.tasks.map((x) => x.title)).toEqual(['原本的任務'])
  })

  it('一行輸入也能分：90 分鐘以上才有分段的按鈕', () => {
    expect(SPLIT_MIN).toBe(90)
  })
})
