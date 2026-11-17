import { describe, expect, it } from 'vitest'
import { slot, fill, due, sample, weekday, say, dropped, undo, runChecks } from '../live/checks.js'

function context({ run = 'morning', tasks = [], events = [], changes = [], text = '', projects = [] } = {}) {
  return {
    store: {
      today: '2026-12-31',
      state: { tasks, projects, rhythm: { wake: '07:00', sleep: '23:00', meals: [{ label: '午餐', start: '12:00', end: '13:00' }] } },
      eventsOn: (date) => events.filter((e) => e.date === date),
    },
    result: { run, droppedCount: 0, undoEqual: true },
    data: { run, days: [{ date: '2027-01-01', free: ['09:00-10:00'] }], projects: projects.map((p) => ({ name: p.name, sample: p.id.startsWith('ex-') && !p.mine })) },
    act: { say: text }, entry: { changes: changes.map((u) => ({ u })) },
  }
}
const task = (patch = {}) => ({ id: 'real-task', title: '寫報告', date: '2027-01-01', at: '09:00', dur: 30, priority: 2, ...patch })
const moved = (before = {}, after = { at: '09:00' }) => ({ k: 'task', id: 'real-task', before, after })
const added = { k: 'add', id: 'real-task' }

function verdict(check, ctx, ok) {
  const result = check(ctx)
  expect(result).toEqual({ id: expect.any(String), ok, detail: expect.any(String) })
  expect(result.detail.length).toBeGreaterThan(0)
  return result
}

describe('slot：只檢查這次真的排進去的任務', () => {
  it('相鄰、全天日程與已完成任務不衝突，且不改輸入', () => {
    const ctx = context({ tasks: [task(), task({ id: 'done', done: true }), task({ id: 'later', at: '09:30' })], events: [{ title: '全天', date: '2027-01-01', allDay: true, start: '00:00', end: '23:59' }], changes: [moved()] })
    const before = JSON.stringify(ctx)
    verdict(slot, ctx, true)
    expect(JSON.stringify(ctx)).toBe(before)
  })
  it.each(['event', 'external', 'task'])('抓出與 %s 的衝突並指出任務與時間', (kind) => {
    const ctx = context({ tasks: [task()], changes: [added] })
    if (kind === 'task') ctx.store.state.tasks.push(task({ id: 'other', title: '讀書', at: '09:15' }))
    else ctx.store.eventsOn = () => [{ id: kind === 'external' ? 'x-cal' : 'event', title: '上課', start: '09:15', end: '10:00' }]
    const result = verdict(slot, ctx, false)
    expect(result.detail).toContain('寫報告')
    expect(result.detail).toContain('09:15')
  })
  it.each(['06:50', '22:50', '12:15'])('自己整理不能排在 %s', (at) => {
    verdict(slot, context({ tasks: [task({ at })], changes: [moved({}, { at })] }), false)
  })
  it('chat 可以指定三餐與作息外的時間', () => {
    verdict(slot, context({ run: 'chat', tasks: [task({ at: '12:15' }), task({ id: 'early', at: '06:00' })], changes: [added, { k: 'add', id: 'early' }] }), true)
  })
  it('缺 dur 用 30，忽略沒有動過的舊衝突與取消時段', () => {
    verdict(slot, context({ tasks: [task({ dur: null }), task({ id: 'other', at: '09:25' })], changes: [added] }), false)
    verdict(slot, context({ tasks: [task(), task({ id: 'other' })], changes: [moved({ at: '09:00' }, { at: null })] }), true)
  })
})

describe('fill：新增時段的普通任務按日計算', () => {
  it.each([57, 58])('60 分空檔的上限為 57 分鐘：排 %i', (dur) => {
    verdict(fill, context({ tasks: [task({ dur })], changes: [moved(), added] }), dur === 57)
  })
  it.each([{ star: true }, { priority: 3 }])('本命或高優先不計入：%j', (patch) => {
    verdict(fill, context({ tasks: [task({ dur: 90, ...patch })], changes: [added] }), true)
  })
  it('重排已有時段不計入，chat 不限制', () => {
    verdict(fill, context({ tasks: [task({ dur: 90 })], changes: [moved({ at: '08:00' })] }), true)
    verdict(fill, context({ run: 'chat', tasks: [task({ dur: 90 })], changes: [added] }), true)
  })
  it('加總多個空檔、多件任務；不同天各算', () => {
    const ctx = context({ tasks: [task({ dur: 40 }), task({ id: 'second', dur: 40 })], changes: [added, { k: 'add', id: 'second' }] })
    ctx.data.days[0].free.push('14:00-15:00')
    verdict(fill, ctx, true)
    ctx.store.state.tasks[1].dur = 60
    verdict(fill, ctx, false)
    ctx.store.state.tasks[1].date = '2027-01-02'
    ctx.data.days.push({ date: '2027-01-02', free: ['09:00-11:00'] })
    verdict(fill, ctx, true)
  })
})

describe('due：動過或新增的任務不超過截止日', () => {
  it.each(['task', 'add', 'edit', 'subs', 'star', 'first'])('%s 有截止日都檢查', (k) => {
    const ctx = context({ tasks: [task({ due: '2027-01-01' })], changes: [{ k, id: 'real-task' }] })
    verdict(due, ctx, true)
    ctx.store.state.tasks[0].due = '2026-12-31'
    verdict(due, ctx, false)
    ctx.result.run = 'chat'
    verdict(due, ctx, true)
  })
  it('分段新增的任務也檢查，沒有動過的舊逾期不報錯', () => {
    const ctx = context({ tasks: [task({ due: '2026-12-31' })], changes: [] })
    verdict(due, ctx, true)
    ctx.entry.changes = [{ u: { k: 'split', id: 'original', made: [{ id: 'real-task' }] } }]
    verdict(due, ctx, false)
  })
})

describe('sample：保護範例專案', () => {
  it.each(['add', 'msteps', 'star'])('不能對範例做 %s；自己的專案及 chat 可做', (k) => {
    const project = { id: 'ex-demo', name: '範例' }
    const ctx = context({ projects: [project], tasks: [task({ project: project.id, star: true })], changes: [{ k, id: 'real-task', pid: project.id, mid: 'milestone', on: true }] })
    verdict(sample, ctx, false)
    project.mine = true
    verdict(sample, ctx, true)
    project.mine = false
    ctx.result.run = 'chat'
    verdict(sample, ctx, true)
  })
  it('套用前的範例快照不受 mine 被改動影響，細項錯誤顯示里程碑名稱', () => {
    const project = { id: 'ex-demo', name: '範例', milestones: [{ id: 'real-ms', title: '認識小島' }] }
    const ctx = context({ projects: [{ ...project, mine: true }], changes: [{ k: 'msteps', pid: project.id, mid: 'real-ms' }] })
    ctx.sampleProjects = [project]
    expect(verdict(sample, ctx, false).detail).toContain('認識小島')
  })
  it('取消本命可通過，非 ex 的專案不算範例', () => {
    verdict(sample, context({ projects: [{ id: 'own', name: '自己' }], tasks: [task({ project: 'own' })], changes: [added] }), true)
    verdict(sample, context({ projects: [{ id: 'ex-demo', name: '範例' }], tasks: [task({ project: 'ex-demo' })], changes: [{ k: 'star', id: 'real-task', on: false }] }), true)
  })
})

describe('weekday：日期文字', () => {
  it.each(['1/1（五）', '1/1（週五）', '1/1 週五', '1/1（星期五）', '01/01（五）', '今天（12/31），明天（1/1）', '12/31（四）'])('跨年正確：%s', (text) => verdict(weekday, context({ text }), true))
  it.each(['1/1（四）', '1/1（週四）', '1/1 週四', '1/1（星期四）', '01/01（四）', '今天（1/1）', '明天（12/31）', '2/30（五）'])('日期或星期錯誤：%s', (text) => verdict(weekday, context({ text }), false))
  it('閏日有效，去年跨年也能對上', () => {
    const ctx = context({ text: '2/29（週二）' })
    ctx.store.today = '2028-01-01'
    verdict(weekday, ctx, true)
    ctx.store.today = '2027-01-01'
    ctx.act.say = '12/31（四）'
    verdict(weekday, ctx, true)
  })
})

describe('say：字數、JSON 與代號', () => {
  it.each(['chat', 'morning'])('%s 字數邊界和空字串', (run) => {
    // 說明寫 200、90 字，檢查多留 10 字（多一兩個字不算錯）
    const limit = run === 'chat' ? 210 : 100
    verdict(say, context({ run, text: '' }), true)
    verdict(say, context({ run, text: '好'.repeat(limit) }), true)
    verdict(say, context({ run, text: '好'.repeat(limit + 1) }), false)
  })
  it.each(['看 t1', '「p2」', 'm3 已完成', '{"say":"好"}', '["寫報告"]', '{}', '[]', '[1, 2]', '[true, null]', '```json\n{}\n```'])('拒絕 %s', (text) => verdict(say, context({ text }), false))
  it('一般英文數字與自然句通過；原始回話不能被清洗截短掩蓋', () => {
    verdict(say, context({ text: '明天做完報告，2027 年一起加油。使用 MP3。' }), true)
    const ctx = context({ text: '好' })
    ctx.result.response = { out: { say: '長'.repeat(201) } }
    verdict(say, ctx, false)
  })
})

it('dropped 為零通過、有丟失不通過', () => {
  const ctx = context()
  verdict(dropped, ctx, true)
  ctx.result.droppedCount = 2
  expect(verdict(dropped, ctx, false).detail).toContain('2')
})
it('undo 還原通過、差異不通過並指出位置', () => {
  const ctx = context()
  verdict(undo, ctx, true)
  ctx.result.undoEqual = false
  ctx.result.undoDiff = [{ path: 'state.tasks.0.at' }]
  expect(verdict(undo, ctx, false).detail).toContain('state.tasks.0.at')
})
it('套用後的通用組不提前檢查 undo', () => {
  expect(runChecks(context()).map((c) => c.id)).toEqual(['slot', 'fill', 'due', 'sample', 'weekday', 'say', 'dropped'])
})
