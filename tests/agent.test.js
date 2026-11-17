import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, addDays } from '../src/store.js'
import { migrate } from '../src/store/migrate.js'
import { agentContext, cleanOut, dueRun, fitSlot, hasActions, lateTasks, clashTasks, eveningAt, morningAt, weekOf, describe as describeActs, freeOn } from '../src/agent.js'
import { MAX_STARS } from '../src/theme.js'

// 自主的ふじ：整理給 Claude 的資料、檢查回來的動作、套用和整批撤銷、什麼時候該自己動
const TODAY = '2026-11-16' // 星期一
let store
const at = (hour, min = 0) => {
  const [y, m, d] = TODAY.split('-').map(Number)
  vi.setSystemTime(new Date(y, m - 1, d, hour, min))
}
const blank = () => ({ say: '', schedule: [], add: [], steps: [], edit: [], star: [], first: '', msteps: [], next: '', remember: [], forget: [], done: [], drop: [], events: [], dates: [], ask: [] })
// 整理一次資料、把假的回應清成動作（代號照 agentContext 給的）
const actOf = (run, fill, extra = {}) => {
  const { data, ids } = agentContext(store, run, extra, new Date())
  const out = blank()
  fill(out, data)
  return cleanOut(out, ids, run)
}
const idOf = (data, title) => [...data.days.flatMap((d) => d.tasks), ...data.overdue].find((t) => t.title === title)?.id

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

describe('整理給 Claude 的資料', () => {
  it('七天、短代號、今天的空檔只算現在以後，扣掉三餐、日程和排好的任務', () => {
    const a = store.addTask({ title: '寫報告', date: TODAY, priority: 3, tag: 'work' })
    store.addTask({ title: '排好的事', date: TODAY, at: '10:00', dur: 60 })
    store.addEvent({ title: '週會', date: TODAY, start: '15:00', end: '16:00' })
    const { data, ids } = agentContext(store, 'morning', {}, new Date())
    expect(data.days).toHaveLength(7)
    expect(data.days[0].date).toBe(TODAY)
    expect(data.days[0].weekday).toBe('一')
    expect(data.now).toBe(`${TODAY} 09:00`)
    const t = data.days[0].tasks.find((x) => x.title === '寫報告')
    expect(t.id).toMatch(/^t\d+$/)
    expect(ids.real(t.id, 't').id).toBe(a.id)
    expect(t).toMatchObject({ pri: 3, tag: 'work' })
    expect(data.days[0].events).toEqual(['15:00-16:00 週會'])
    const free = data.days[0].free
    // 現在 09:00 → 從 09:05 起；10:00 的任務前後各留 10 分鐘緩衝
    expect(free[0]).toBe('09:05-09:50')
    expect(free).toContain('11:10-12:00')
    // 午餐 12:00-13:00、週會 15:00-16:00（含緩衝）都不在空檔裡
    expect(free).toContain('13:00-14:50')
    expect(free.some((f) => f.startsWith('16:10-'))).toBe(true)
    // 明天從起床算起
    expect(data.days[1].free[0].startsWith('07:00-')).toBe(true)
  })

  it('逾期、專案的下一步、記得的事、最近做過的都帶著；對話才有 message 和 history', () => {
    store.addTask({ title: '拖了很久', date: addDays(TODAY, -4) })
    const p = store.addProject({ name: '畢業專題', deadline: addDays(TODAY, 5), milestones: ['訪談整理', '寫初稿'] })
    store.agentRemember('週三晚上要上課')
    const { data, ids } = agentContext(store, 'chat', { message: '幫我排一下', history: [{ who: 'me', text: '嗨' }, { who: 'fuji', text: '在。' }] }, new Date())
    expect(data.overdue).toHaveLength(1)
    expect(data.overdue[0]).toMatchObject({ title: '拖了很久', late: 4 })
    expect(data.memory).toEqual(['週三晚上要上課'])
    const proj = data.projects[0]
    expect(proj).toMatchObject({ name: '畢業專題', daysLeft: 5, ms: '0/2', open: 0 })
    expect(proj.next.title).toBe('訪談整理')
    expect(ids.real(proj.next.id, 'm')).toEqual({ id: p.milestones[0].id, pid: p.id })
    expect(data.message).toBe('幫我排一下')
    expect(data.history).toEqual([{ who: 'user', text: '嗨' }, { who: 'fuji', text: '在。' }])
    expect(agentContext(store, 'morning', {}, new Date()).data).not.toHaveProperty('message')
  })

  it('剛加的任務標 new，並列在 new 裡', () => {
    const t = store.addTask({ title: '買牛奶', date: TODAY })
    const { data } = agentContext(store, 'capture', { fresh: [t.id] }, new Date())
    expect(data.days[0].tasks[0].new).toBe(true)
    expect(data.new).toEqual([data.days[0].tasks[0].id])
  })
})

describe('清理 Claude 回的動作', () => {
  it('對不上的 id、看不懂的時間丟掉；時間取到 5 分鐘', () => {
    store.addTask({ title: '甲', date: TODAY })
    const act = actOf('morning', (o, d) => {
      o.schedule = [{ id: idOf(d, '甲'), date: TODAY, at: '10:03', dur: 47 }, { id: 't99', date: TODAY, at: '11:00', dur: 30 }, { id: 'constructor', date: TODAY, at: '11:00', dur: 30 }]
      o.star = [{ id: 'x1', on: true }]
      o.first = 't404'
    })
    expect(act.schedule).toHaveLength(1)
    expect(act.schedule[0]).toMatchObject({ at: '10:05', dur: 45, date: TODAY })
    expect(act.star).toEqual([])
    expect(act.first).toBeNull()
  })

  it('自己整理時：勾完成、刪除、加日程、加重要日子一律拿掉；也不改標題和優先度，新增最多 3 件', () => {
    const t = store.addTask({ title: '甲', date: TODAY })
    const fill = (o, d) => {
      const id = idOf(d, '甲')
      o.done = [id]
      o.drop = [id]
      o.events = [{ title: '會議', date: TODAY, start: '10:00', end: '11:00' }]
      o.dates = [{ title: '考試', date: TODAY, kind: 'exam' }]
      o.edit = [{ id, title: '改名', tag: 'work', pri: 3, project: '' }]
      o.add = [1, 2, 3, 4, 5].map((n) => ({ title: `新 ${n}`, date: TODAY, at: '', dur: 30, tag: 'life', project: '', steps: [], star: false }))
      o.ask = ['好']
    }
    const auto = actOf('morning', fill)
    expect([auto.done, auto.drop, auto.events, auto.dates, auto.ask]).toEqual([[], [], [], [], []])
    expect(auto.edit).toEqual([{ id: t.id, tag: 'work' }])
    expect(auto.add).toHaveLength(3)
    const chat = actOf('chat', fill, { message: '做吧' })
    expect(chat.done).toEqual([t.id])
    expect(chat.drop).toEqual([t.id])
    expect(chat.events).toHaveLength(1)
    expect(chat.edit[0]).toMatchObject({ title: '改名', priority: 3 })
    expect(chat.add).toHaveLength(5)
    expect(hasActions(chat)).toBe(true)
    expect(hasActions(cleanOut({ say: '嗨' }, { real: () => null }, 'chat'))).toBe(false)
  })

  it('壞掉的回應（不是物件、欄位不是陣列）也不會出錯', () => {
    const { ids } = agentContext(store, 'chat', { message: 'x' }, new Date())
    for (const out of [null, 'x', { schedule: 'no', add: [null, 3], steps: [{}], say: 5 }]) {
      const act = cleanOut(out, ids, 'chat')
      expect(act.schedule).toEqual([])
      expect(act.add).toEqual([])
      expect(act.say).toBe('')
    }
  })
})

describe('找位置', () => {
  it('想放的地方空著就用它；撞到了挪到最近的空檔；放不下是 null', () => {
    const busy = [[600, 660]]
    expect(fitSlot(540, 30, busy, 480, 1200)).toBe(540)
    // 10:00-11:00 有事：想放 10:10 → 往前塞不下 30 分鐘的話往後
    expect(fitSlot(610, 30, busy, 590, 1200)).toBe(660)
    expect(fitSlot(610, 30, busy, 480, 1200)).toBe(570)
    expect(fitSlot(610, 120, [[600, 660]], 590, 700)).toBeNull()
  })
})

describe('套用', () => {
  it('排時間：撞到日程的挪到最近的空檔；今天已經過去的時間往後排；記下一筆、算今天整理過', () => {
    at(14)
    store.addEvent({ title: '週會', date: TODAY, start: '15:00', end: '16:00' })
    const a = store.addTask({ title: '甲', date: TODAY })
    const b = store.addTask({ title: '乙', date: TODAY })
    const act = actOf('morning', (o, d) => {
      o.schedule = [{ id: idOf(d, '甲'), date: TODAY, at: '15:10', dur: 30 }, { id: idOf(d, '乙'), date: TODAY, at: '09:00', dur: 30 }]
      o.say = '排好了'
      o.next = idOf(d, '乙')
    })
    const entry = store.agentApply(act, { run: 'morning', weekStart: true })
    // 甲：15:10 在週會裡 → 最近的空檔（會前 14:20 或會後 16:10）
    expect(['14:20', '16:10']).toContain(a.at)
    // 乙：09:00 已經過了 → 現在以後
    expect(b.at >= '14:00').toBe(true)
    expect(a.at).not.toBe(b.at)
    expect(entry).toMatchObject({ run: 'morning', say: '排好了', next: b.id, undone: false })
    expect(entry.changes).toHaveLength(2)
    expect(store.state.agent.ran).toEqual({ morning: TODAY, evening: '', week: weekOf(TODAY), plan: '' })
    expect(store.state.agent.log).toHaveLength(1)
  })

  it('逾期的拉到今天、不急的往後挪（各算挪了一次，卡關提醒用）；撤銷後跟原本一模一樣', () => {
    const late = store.addTask({ title: '逾期', date: addDays(TODAY, -2) })
    const push = store.addTask({ title: '不急', date: TODAY, at: '10:00', dur: 30 })
    store.toggleStar(push.id)
    const snap = () => JSON.stringify(store.state.tasks.map((t) => [t.id, t.date, t.at, t.dur, t.moved, t.star, t.first]))
    const before = snap()
    const act = actOf('morning', (o, d) => {
      o.schedule = [{ id: idOf(d, '逾期'), date: TODAY, at: '11:00', dur: 50 }, { id: idOf(d, '不急'), date: addDays(TODAY, 1), at: '', dur: 0 }]
    })
    const entry = store.agentApply(act, { run: 'morning' })
    // 逾期的搬到今天也算挪了一次（跟自己按「搬到今天」一樣）
    expect(late).toMatchObject({ date: TODAY, at: '11:00', dur: 50, moved: 1 })
    expect(push).toMatchObject({ date: addDays(TODAY, 1), at: null, moved: 1 })
    expect(store.agentCanUndo(entry.id)).toBe(true)
    expect(store.agentUndo(entry.id)).toBe(2)
    expect(snap()).toBe(before)
    expect(store.state.agent.log[0].undone).toBe(true)
    expect(store.agentUndo(entry.id)).toBe(0)
  })

  it('撤銷時，之後被改過或做完的不動', () => {
    const a = store.addTask({ title: '甲', date: TODAY })
    const b = store.addTask({ title: '乙', date: TODAY })
    const c = store.addTask({ title: '丙', date: TODAY })
    const entry = store.agentApply(
      actOf('morning', (o, d) => {
        o.schedule = [{ id: idOf(d, '甲'), date: TODAY, at: '10:00', dur: 30 }, { id: idOf(d, '乙'), date: TODAY, at: '11:00', dur: 30 }, { id: idOf(d, '丙'), date: TODAY, at: '13:30', dur: 30 }]
      }),
      { run: 'morning' },
    )
    store.updateTask(a.id, { at: '16:00' })
    store.toggleTask(b.id)
    expect(store.agentUndo(entry.id)).toBe(1)
    expect(a.at).toBe('16:00')
    expect(b.at).toBe('11:00')
    expect(c.at).toBeNull()
  })

  it('排不下的那一件不會疊在剛排好的別件上：照原本的長度在原本的時間附近再找，找不到就只留日子', () => {
    // 明天醒著的時間只有 09:00–10:00
    store.setRhythm({ wake: '09:00', sleep: '10:00', meals: [], buffer: 0 })
    const tmr = addDays(TODAY, 1)
    const a = store.addTask({ title: '甲', date: tmr, at: '09:00', dur: 30 })
    const b = store.addTask({ title: '乙', date: tmr, at: '09:30', dur: 30 })
    const act = actOf('evening', (o, d) => {
      o.schedule = [{ id: idOf(d, '甲'), date: tmr, at: '09:30', dur: 30 }, { id: idOf(d, '乙'), date: tmr, at: '09:30', dur: 60 }]
    })
    store.agentApply(act, { run: 'evening' })
    expect(a).toMatchObject({ at: '09:30', dur: 30 })
    // 乙要 60 分鐘放不下 → 照原本的 30 分鐘、挪到還空著的 09:00
    expect(b).toMatchObject({ at: '09:00', dur: 30 })
    const spans = [a, b].map((t) => [t.at, t.dur])
    expect(new Set(spans.map(([at]) => at)).size).toBe(2)
  })

  it('正在專注的那一件不動，它的時段也照樣佔著：別件不會排到它上面', () => {
    const a = store.addTask({ title: '正在做', date: TODAY, at: '10:00', dur: 60 })
    const b = store.addTask({ title: '另一件', date: TODAY })
    const act = actOf('replan', (o, d) => {
      o.schedule = [{ id: idOf(d, '正在做'), date: TODAY, at: '14:00', dur: 60 }, { id: idOf(d, '另一件'), date: TODAY, at: '10:00', dur: 30 }]
    })
    store.agentApply(act, { run: 'replan', focusing: a.id })
    expect(a).toMatchObject({ at: '10:00', dur: 60 })
    // 10:00–11:00 被佔著（前後各留 10 分鐘）：另一件挪到旁邊
    expect(b.at).not.toBeNull()
    expect(b.at < '09:25' || b.at >= '11:10').toBe(true)
  })

  it('樣子不對的一批動作整份不做：不會改了一半才出錯', () => {
    const t = store.addTask({ title: '甲', date: TODAY, tag: 'life' })
    const good = actOf('chat', (o, d) => (o.edit = [{ id: idOf(d, '甲'), title: '', tag: 'work', pri: 0, project: '' }]), { message: 'x' })
    for (const bad of [{ ...good, schedule: {} }, { ...good, add: [{ title: 5 }] }, { ...good, events: [{ title: 'x', date: TODAY, start: 'soon', end: '' }] }, { ...good, first: 3 }, null]) {
      expect(store.agentApply(bad, { run: 'chat' })).toBeNull()
    }
    expect(t.tag).toBe('life')
    expect(store.state.agent.log).toEqual([])
    expect(store.agentApply(good, { run: 'chat' }).changes).toHaveLength(1)
    expect(t.tag).toBe('work')
  })

  it('同一天有四十幾件任務：剛加的那一件一定帶得到', () => {
    for (let i = 0; i < 45; i++) store.addTask({ title: `舊 ${i}`, date: TODAY })
    const t = store.addTask({ title: '剛加的', date: TODAY })
    const { data } = agentContext(store, 'capture', { fresh: [t.id] }, new Date())
    expect(data.days[0].tasks).toHaveLength(40)
    expect(data.days[0].tasks[0]).toMatchObject({ title: '剛加的', new: true })
    expect(data.new).toEqual([data.days[0].tasks[0].id])
  })

  it('新增（帶子任務、本命、歸到專案）、拆小步驟、里程碑細項、本命上限、先做的那一件', () => {
    const p = store.addProject({ name: '專題', milestones: ['訪談'] })
    const big = store.addTask({ title: '準備報告', date: TODAY })
    for (let i = 0; i < MAX_STARS; i++) store.toggleStar(store.addTask({ title: `本命 ${i}`, date: TODAY }).id)
    const mine = store.addTask({ title: '自己挑的', date: addDays(TODAY, 1) })
    store.setFirst(mine.id)
    const other = store.addTask({ title: '別件', date: addDays(TODAY, 1) })
    const act = actOf('morning', (o, d) => {
      o.add = [{ title: '專題・列訪談問題', date: TODAY, at: '10:00', dur: 30, tag: 'study', project: d.projects[0].id, steps: ['找三個人', '寫問題'], star: true }]
      o.steps = [{ id: idOf(d, '準備報告'), steps: ['列大綱', '找資料', '列大綱'] }]
      o.msteps = [{ ms: d.projects[0].next.id, steps: ['約時間', '錄音'] }]
      o.star = [{ id: idOf(d, '準備報告'), on: true }]
      o.first = idOf(d, '別件')
    })
    const entry = store.agentApply(act, { run: 'morning' })
    const added = store.state.tasks.find((t) => t.title === '專題・列訪談問題')
    expect(added).toMatchObject({ date: TODAY, at: '10:00', dur: 30, tag: 'study', project: p.id, star: false })
    expect(added.coach).toBe(`a-${entry.id}`)
    expect(added.subs.map((s) => s.title)).toEqual(['找三個人', '寫問題'])
    // 重複的步驟只加一次
    expect(big.subs.map((s) => s.title)).toEqual(['列大綱', '找資料'])
    expect(p.milestones[0].steps.map((s) => s.title)).toEqual(['約時間', '錄音'])
    // 今天的本命已經滿了：不再加
    expect(big.star).toBe(false)
    // 使用者自己挑好的「先做」不換
    expect(mine.first).toBe(true)
    expect(other.first).toBe(false)
    // 整批撤銷：新增的任務、步驟、細項都拿掉
    store.agentUndo(entry.id)
    expect(store.state.tasks.some((t) => t.title === '專題・列訪談問題')).toBe(false)
    expect(big.subs).toEqual([])
    expect(p.milestones[0].steps).toEqual([])
    // ふじ加的任務下次整理時標成 mine
    store.agentApply(actOf('morning', (o) => (o.add = [{ title: '她加的', date: TODAY, at: '', dur: 25, tag: 'life', project: '', steps: [], star: false }])), { run: 'morning' })
    expect(agentContext(store, 'morning', {}, new Date()).data.days[0].tasks.find((t) => t.title === '她加的').mine).toBe(true)
  })

  it('同一天已經有同名、還沒做的任務：不重複加', () => {
    store.addTask({ title: '買牛奶', date: TODAY })
    const entry = store.agentApply(actOf('chat', (o) => (o.add = [{ title: '買牛奶', date: TODAY, at: '', dur: 10, tag: 'life', project: '', steps: [], star: false }]), { message: 'x' }), { run: 'chat' })
    expect(entry).toBeNull()
    expect(store.tasksOn(TODAY)).toHaveLength(1)
  })

  it('對話：指定的時間照說的排（不避三餐）；勾完成、刪掉、加日程和重要日子、記住和忘掉，都能撤銷', () => {
    const a = store.addTask({ title: '午餐前印講義', date: TODAY })
    const b = store.addTask({ title: '做完的', date: TODAY })
    const c = store.addTask({ title: '不要了', date: TODAY, priority: 3, at: '20:00', dur: 40 })
    store.agentRemember('舊的偏好')
    const act = actOf(
      'chat',
      (o, d) => {
        o.schedule = [{ id: idOf(d, '午餐前印講義'), date: TODAY, at: '12:10', dur: 20 }]
        o.done = [idOf(d, '做完的')]
        o.drop = [idOf(d, '不要了')]
        o.events = [{ title: '看牙醫', date: addDays(TODAY, 1), start: '15:00', end: '16:00' }]
        o.dates = [{ title: '期中考', date: addDays(TODAY, 10), kind: 'exam' }]
        o.remember = ['週三晚上要上課']
        o.forget = ['舊的偏好']
        o.say = '好了'
        o.ask = ['謝謝']
      },
      { message: '幫我處理' },
    )
    expect(act.ask).toEqual(['謝謝'])
    const entry = store.agentApply(act, { run: 'chat' })
    expect(a.at).toBe('12:10')
    expect(b.done).toBe(true)
    expect(store.state.tasks.some((t) => t.id === c.id)).toBe(false)
    expect(store.state.events.map((e) => e.title)).toEqual(['看牙醫'])
    expect(store.state.dates.map((d) => d.title)).toEqual(['期中考'])
    expect(store.state.agent.memory).toEqual(['週三晚上要上課'])
    // 對話不算早上、晚上的整理
    expect(store.state.agent.ran.morning).toBe('')
    expect(store.agentUndo(entry.id)).toBe(7)
    expect(a.at).toBeNull()
    expect(b.done).toBe(false)
    const back = store.state.tasks.find((t) => t.title === '不要了')
    expect(back).toMatchObject({ priority: 3, at: '20:00', dur: 40, date: TODAY })
    expect(store.state.events).toEqual([])
    expect(store.state.dates).toEqual([])
    expect(store.state.agent.memory).toEqual(['舊的偏好'])
  })

  it('沒有要改的、也沒說話：不記；只說了一句話：記下來（沒有可以撤銷的）', () => {
    expect(store.agentApply(actOf('morning', () => {}), { run: 'morning' })).toBeNull()
    expect(store.state.agent.ran.morning).toBe(TODAY)
    const e = store.agentApply(actOf('evening', (o) => (o.say = '明天沒有要排的')), { run: 'evening' })
    expect(e.changes).toEqual([])
    expect(store.agentCanUndo(e.id)).toBe(false)
    expect(store.state.agent.ran.evening).toBe(TODAY)
  })

  it('紀錄只留最近 30 筆；記得的事可以自己加、刪', () => {
    for (let i = 0; i < 35; i++) store.agentApply(actOf('chat', (o) => (o.say = `第 ${i} 句`), { message: 'x' }), { run: 'chat' })
    expect(store.state.agent.log).toHaveLength(30)
    expect(store.state.agent.log.at(-1).say).toBe('第 34 句')
    expect(store.agentRemember('  早上不排會議  ')).toBe(true)
    expect(store.agentRemember('早上不排會議')).toBe(false)
    store.agentForget(0)
    expect(store.state.agent.memory).toEqual([])
    store.agentClearLog()
    expect(store.state.agent.log).toEqual([])
  })

  it('先給使用者看的說法', () => {
    store.addTask({ title: '甲', date: TODAY })
    const act = actOf('morning', (o, d) => {
      o.schedule = [{ id: idOf(d, '甲'), date: addDays(TODAY, 1), at: '10:00', dur: 30 }]
      o.add = [{ title: '乙', date: TODAY, at: '', dur: 30, tag: 'life', project: '', steps: [], star: false }]
    })
    expect(describeActs(act, store)).toEqual(['「甲」排在明天 10:00', '新增「乙」（今天）'])
  })
})

describe('撤銷不會動到之後自己改過的', () => {
  it('ふじ加的任務之後改了標題、寫了說明：撤銷時留著；她加的子任務改過字、勾過的也留著', () => {
    const big = store.addTask({ title: '準備報告', date: TODAY })
    const entry = store.agentApply(
      actOf('morning', (o, d) => {
        o.add = [{ title: '她加的甲', date: TODAY, at: '', dur: 30, tag: 'life', project: '', steps: [], star: false }, { title: '她加的乙', date: TODAY, at: '', dur: 30, tag: 'life', project: '', steps: [], star: false }]
        o.steps = [{ id: idOf(d, '準備報告'), steps: ['列大綱', '找資料', '寫初稿'] }]
      }),
      { run: 'morning' },
    )
    const a = store.state.tasks.find((t) => t.title === '她加的甲')
    store.updateTask(a.id, { title: '我改過的', note: '要交給老師' })
    store.renameSub(big.id, big.subs[0].id, '列三段大綱')
    store.toggleSub(big.id, big.subs[1].id)
    expect(store.agentUndo(entry.id)).toBe(2)
    expect(store.state.tasks.map((t) => t.title)).toEqual(['準備報告', '我改過的'])
    expect(big.subs.map((s) => s.title)).toEqual(['列三段大綱', '找資料'])
  })

  it('ふじ加的任務之後只改了分類、優先度、或在上面專注過：撤銷時也留著', () => {
    const add = (title) => ({ title, date: TODAY, at: '', dur: 30, tag: 'life', project: '', steps: [], star: false })
    const entry = store.agentApply(actOf('chat', (o) => (o.add = ['改分類', '改優先度', '專注過', '沒動過'].map(add)), { message: 'x' }), { run: 'chat' })
    const by = (title) => store.state.tasks.find((t) => t.title === title)
    store.updateTask(by('改分類').id, { tag: 'work' })
    store.updateTask(by('改優先度').id, { priority: 3 })
    by('專注過').pomos = 1
    expect(store.agentUndo(entry.id)).toBe(1)
    expect(store.state.tasks.map((t) => t.title)).toEqual(['改分類', '改優先度', '專注過'])
  })

  it('換了專案之後自己在新專案選了里程碑：撤銷時不搬回去', () => {
    const p = store.addProject({ name: '甲案', milestones: ['一'] })
    const q = store.addProject({ name: '乙案', milestones: ['三'] })
    const t = store.addTask({ title: '任務', date: TODAY, project: p.id })
    const entry = store.agentApply(actOf('chat', (o, d) => (o.edit = [{ id: idOf(d, '任務'), title: '', tag: '', pri: 0, project: d.projects.find((x) => x.name === '乙案').id }]), { message: 'x' }), { run: 'chat' })
    store.updateTask(t.id, { ms: q.milestones[0].id })
    expect(store.agentUndo(entry.id)).toBe(0)
    expect(t).toMatchObject({ project: q.id, ms: q.milestones[0].id })
  })

  it('排完之後自己改了長度、取消了本命：撤銷只把時間放回去', () => {
    const t = store.addTask({ title: '甲', date: TODAY, at: '09:30', dur: 30 })
    store.toggleStar(t.id)
    const entry = store.agentApply(actOf('morning', (o, d) => (o.schedule = [{ id: idOf(d, '甲'), date: TODAY, at: '14:00', dur: 45 }])), { run: 'morning' })
    expect(t).toMatchObject({ at: '14:00', dur: 45, star: true })
    store.updateTask(t.id, { dur: 90 })
    store.toggleStar(t.id)
    store.agentUndo(entry.id)
    expect(t).toMatchObject({ at: '09:30', dur: 90, star: false })
  })

  it('換了專案再撤銷：原本自己選的里程碑也放回去', () => {
    const p = store.addProject({ name: '甲案', milestones: ['一', '二'] })
    const q = store.addProject({ name: '乙案', milestones: ['三'] })
    const t = store.addTask({ title: '任務', date: TODAY, project: p.id, ms: p.milestones[1].id })
    const act = actOf('chat', (o, d) => (o.edit = [{ id: idOf(d, '任務'), title: '', tag: '', pri: 0, project: d.projects.find((x) => x.name === '乙案').id }]), { message: 'x' })
    const entry = store.agentApply(act, { run: 'chat' })
    expect(t).toMatchObject({ project: q.id, ms: null })
    store.agentUndo(entry.id)
    expect(t).toMatchObject({ project: p.id, ms: p.milestones[1].id })
  })

  it('刪掉的任務撤銷後整件回來：同一個 id、勾過的子任務、里程碑、挪過幾次、指著它的進度紀錄；重新讀檔後再撤銷也一樣', () => {
    const p = store.addProject({ name: '甲案', milestones: ['一'] })
    const t = store.addTask({ title: '要刪的', date: TODAY, priority: 3, project: p.id, ms: p.milestones[0].id, subs: ['第一步', '第二步'] })
    store.toggleSub(t.id, t.subs[0].id)
    store.updateTask(t.id, { date: addDays(TODAY, 1) })
    store.setFirst(t.id)
    store.addProjectLog(p.id, { text: '做了一點', task: t.id })
    const want = JSON.parse(JSON.stringify(t))
    const drop = () => store.agentApply(actOf('chat', (o, d) => (o.drop = [idOf(d, '要刪的')]), { message: '刪掉' }), { run: 'chat' })
    const check = (s) => {
      expect(JSON.parse(JSON.stringify(s.state.tasks.find((x) => x.id === want.id)))).toEqual(want)
      expect(s.state.projects[0].logs[0].task).toBe(want.id)
    }
    const first = drop()
    expect(store.state.tasks).toEqual([])
    expect(store.state.projects[0].logs[0].task).toBeNull()
    expect(store.agentUndo(first.id)).toBe(1)
    check(store)
    // 重新讀檔（撤銷紀錄經過清洗）之後才撤銷
    const second = drop()
    const other = new Store()
    other.importJSON(store.exportJSON())
    expect(other.agentUndo(second.id)).toBe(1)
    check(other)
    // 已經放回來了：同一筆再撤銷一次（另一台也撤銷了）不會多一件
    other.state.agent.log.at(-1).undone = false
    expect(other.agentUndo(second.id)).toBe(0)
    expect(other.state.tasks).toHaveLength(1)
  })
})

describe('讀存檔', () => {
  it('舊存檔沒有 agent：補上空的；設定的 agentMode 留著，看不懂的回到自動', () => {
    const s = migrate({ tasks: [], settings: { agentMode: 'ask' } })
    expect(s.agent).toEqual({ memory: [], ran: { morning: '', evening: '', week: '', plan: '' }, log: [] })
    expect(s.settings.agentMode).toBe('ask')
    expect(migrate({ tasks: [], settings: { agentMode: 'off' } }).settings.agentMode).toBe('off')
    expect(migrate({ tasks: [], settings: { agentMode: 'wild' } }).settings.agentMode).toBe('auto')
    expect(migrate({ tasks: [] }).settings.agentMode).toBe('auto')
  })

  it('紀錄裡壞掉的撤銷資料當成不能撤銷，讀檔和撤銷都不會出錯', () => {
    const s = migrate({
      tasks: [],
      agent: {
        memory: ['  好  ', 3, '好', 'x'.repeat(200)],
        ran: { morning: '2026-11-16', evening: 'bad', week: 5 },
        log: [
          { id: 'a1', at: 5, run: 'morning', say: '嗨', next: { x: 1 }, changes: [{ t: '甲', u: { k: 'task', id: 't1' } }, { t: '乙', u: { k: 'wild' } }, { t: '丙', u: { k: 'add', id: 'ok-1', sig: '[]' } }, 'x', { u: {} }] },
          { id: '壞 id', changes: [] },
          'x',
        ],
      },
    })
    expect(s.agent.memory).toEqual(['好', 'x'.repeat(80)])
    expect(s.agent.ran).toEqual({ morning: '2026-11-16', evening: '', week: '', plan: '' })
    expect(s.agent.log).toHaveLength(1)
    expect(s.agent.log[0].next).toBeNull()
    expect(s.agent.log[0].changes).toEqual([{ t: '甲', u: null }, { t: '乙', u: null }, { t: '丙', u: { k: 'add', id: 'ok-1', sig: '[]' } }])
    store.importJSON(JSON.stringify(s))
    expect(store.agentUndo('a1')).toBe(0)
  })

  it('每一種壞掉的撤銷紀錄都清成不能撤銷：型別不對、缺欄位、塞了一堆多餘的欄位', () => {
    const junk = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`x${i}`, i]))
    const bad = [
      { k: 'drop', task: { title: '壞資料', subs: 7 } },
      { k: 'drop', task: 5 },
      { k: 'task', id: 't1', before: {}, after: { date: '2026-11-16', at: '10:00' } },
      { k: 'task', id: 't1', before: { date: '2026-02-30' }, after: { date: '2026-11-16' } },
      { ...junk, k: 'add', id: 't1' },
      { k: 'subs', id: 't1', subs: 'x' },
      { k: 'msteps', pid: 'p', mid: 'm', steps: [] },
      { k: 'edit', id: 't1', before: { tag: 'nope' }, after: {} },
      { k: 'star', id: 't1', on: 'yes' },
      { k: 'remember', text: 9 },
      { k: '__proto__', id: 't1' },
      { k: ['task'], id: 't1' },
    ]
    const s = migrate({ tasks: [{ id: 't1', title: '甲', date: TODAY, at: '10:00' }], agent: { log: [{ id: 'a1', at: 1, run: 'chat', changes: bad.map((u) => ({ t: '壞', u })) }] } })
    expect(s.agent.log[0].changes.map((c) => c.u)).toEqual(bad.map(() => null))
    // 多餘的欄位丟掉、型別照規則收：合格的留著
    const ok = migrate({ tasks: [], agent: { log: [{ id: 'a2', at: 1, run: 'chat', changes: [{ t: '好', u: { ...junk, k: 'task', id: 't1', before: { date: TODAY, at: 'x', dur: '45', moved: 2, star: 1 }, after: { date: TODAY, at: '10:00' } } }] }] } })
    expect(ok.agent.log[0].changes[0].u).toEqual({
      k: 'task', id: 't1',
      before: { date: TODAY, at: null, dur: 45, moved: 2, star: true, first: false },
      after: { date: TODAY, at: '10:00', dur: null, moved: 0, star: false, first: false },
    })
    store.importJSON(JSON.stringify(s))
    expect(() => store.agentUndo('a1')).not.toThrow()
    expect(store.state.tasks[0]).toMatchObject({ date: TODAY, at: '10:00' })
  })

  it('匯出再匯入：記得的事、紀錄、撤銷都還在', () => {
    const t = store.addTask({ title: '甲', date: TODAY })
    store.agentRemember('早上不排會議')
    const entry = store.agentApply(actOf('morning', (o, d) => (o.schedule = [{ id: idOf(d, '甲'), date: TODAY, at: '10:00', dur: 30 }])), { run: 'morning' })
    const other = new Store()
    other.importJSON(store.exportJSON())
    expect(other.state.agent.memory).toEqual(['早上不排會議'])
    expect(other.state.agent.ran.morning).toBe(TODAY)
    expect(other.agentUndo(entry.id)).toBe(1)
    expect(other.state.tasks.find((x) => x.id === t.id).at).toBeNull()
  })
})

describe('什麼時候自己動', () => {
  const rhythm = { wake: '07:00', sleep: '23:30', meals: [], work: null, peak: 'morning', buffer: 10 }
  const base = { today: TODAY, rhythm, ran: {}, tasks: [], events: [], tomorrow: [] }
  const task = (o) => ({ id: 'a', title: '甲', done: false, at: null, dur: 30, priority: 2, ...o })

  it('早上（起床前一個半小時起、晚上的整理以前）還沒整理過：整理今天；一天一次', () => {
    expect(morningAt(rhythm)).toBe(330)
    expect(eveningAt(rhythm)).toBe(21 * 60)
    expect(dueRun({ ...base, nowMin: 5 * 60 })).toBeNull()
    expect(dueRun({ ...base, nowMin: 8 * 60 })).toMatchObject({ run: 'morning' })
    expect(dueRun({ ...base, nowMin: 8 * 60, ran: { morning: TODAY } })).toBeNull()
    // 昨天整理過不算
    expect(dueRun({ ...base, nowMin: 8 * 60, ran: { morning: addDays(TODAY, -1) } })).toMatchObject({ run: 'morning' })
  })

  it('晚上：今天或明天還有沒做的事才替明天做準備；半夜還沒睡時打開不算新的一天', () => {
    expect(dueRun({ ...base, nowMin: 22 * 60, ran: { morning: TODAY } })).toBeNull()
    expect(dueRun({ ...base, nowMin: 22 * 60, tomorrow: [task()] })).toMatchObject({ run: 'evening' })
    expect(dueRun({ ...base, nowMin: 22 * 60, tomorrow: [task()], ran: { evening: TODAY } })).toBeNull()
    // 就寢 01:00 的人：晚上的整理最晚 21:30 開始；凌晨 00:30 不算早上
    const owl = { ...rhythm, wake: '09:00', sleep: '01:00' }
    expect(eveningAt(owl)).toBe(1290)
    expect(dueRun({ ...base, rhythm: owl, nowMin: 30 })).toBeNull()
  })

  it('排好的任務時間過了還沒做完、或撞到日程：重排；同一個狀況只重排一次，兩次之間隔 40 分鐘', () => {
    const ran = { morning: TODAY }
    const late = task({ at: '10:00' })
    expect(lateTasks([late], 10 * 60 + 40)).toEqual([])
    expect(lateTasks([late], 10 * 60 + 45)).toEqual([late])
    expect(lateTasks([late], 11 * 60, { focusing: 'a' })).toEqual([])
    const due = dueRun({ ...base, ran, nowMin: 11 * 60, tasks: [late] })
    expect(due).toMatchObject({ run: 'replan', sig: 'a@10:00' })
    expect(due.why).toContain('甲')
    const now = Date.now()
    // 已經為這個狀況重排過
    expect(dueRun({ ...base, ran, nowMin: 12 * 60, tasks: [late], seen: { sig: 'a@10:00', at: now - 3600000 }, now })).toBeNull()
    // 剛重排過別的：先等
    expect(dueRun({ ...base, ran, nowMin: 12 * 60, tasks: [late], seen: { sig: 'x', at: now - 60000 }, now })).toBeNull()
    expect(dueRun({ ...base, ran, nowMin: 12 * 60, tasks: [late], seen: { sig: 'x', at: now - 41 * 60000 }, now })).toMatchObject({ run: 'replan' })
    const ev = { id: 'e', title: '會議', start: '14:00', end: '15:00', done: false }
    const hit = task({ id: 'b', at: '14:30' })
    expect(clashTasks([hit], [ev], 13 * 60)).toEqual([hit])
    expect(clashTasks([hit], [{ ...ev, done: true }], 13 * 60)).toEqual([])
    expect(dueRun({ ...base, ran, nowMin: 13 * 60, tasks: [hit], events: [ev] }).why).toContain('撞')
  })

  it('空檔：過去的日子沒有；今天過了就寢時間也沒有', () => {
    expect(freeOn(store, addDays(TODAY, -1))).toEqual([])
    expect(freeOn(store, TODAY, 23 * 60 + 40)).toEqual([])
    expect(freeOn(store, TODAY, 6 * 60)[0][0]).toBe(7 * 60)
  })
})
