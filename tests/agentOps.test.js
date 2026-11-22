import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, addDays } from '../src/store.js'
import { migrate } from '../src/store/migrate.js'
import { agentContext, cleanOut, fitData, DATA_MAX } from '../src/agent.js'
import { FIELDS, CREATE_KINDS, GO_KINDS, cleanOps, daysOf, worldOf } from '../src/agentOps.js'
import * as worker from '../worker/src/ai.js'

// 跟ふじ說一句話，App 裡什麼都能改：日程、專案、習慣、作息、設定…（src/agentOps.js、src/store/agentOps.js）
const TODAY = '2026-11-16' // 星期一
let store
const at = (hour, min = 0) => {
  const [y, m, d] = TODAY.split('-').map(Number)
  vi.setSystemTime(new Date(y, m - 1, d, hour, min))
}
const blank = () => ({
  say: '', schedule: [], add: [], steps: [], edit: [], star: [], first: '', msteps: [], next: '', remember: [], forget: [], done: [], drop: [], events: [], dates: [], ask: [],
  set: [], create: [], go: { do: '', id: '' },
})
// 整理一次對話的資料，把假的回應（fill 照資料裡的代號填）清成動作、套用。回傳 { entry, act, data }
function chat(fill, here = null) {
  const { data, ids } = agentContext(store, 'chat', { message: '幫我改一下', here }, new Date())
  const out = blank()
  fill(out, data.world, data)
  const act = cleanOut(out, ids, 'chat')
  return { entry: store.agentApply(act, { run: 'chat' }), act, data }
}
const aliasOf = (list, pred) => list.find(pred)?.id
const undo = (entry) => store.agentUndo(entry.id)

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

describe('前端和 Worker 的格式一樣', () => {
  it('新增的種類、go 的種類兩邊是同一份（欄位名稱 Worker 不限定，提示詞裡要寫到：tests/ai.test.js）', () => {
    expect(worker).not.toHaveProperty('FIELDS')
    expect(FIELDS.length).toBeGreaterThan(50)
    expect(worker.CREATE_KINDS).toEqual(CREATE_KINDS)
    expect(worker.GO_KINDS).toEqual(GO_KINDS)
  })
})

describe('對話時多帶的資料', () => {
  it('日程、專案（里程碑、細項）、習慣、例行公事、警語、訂閱、設定都有代號；看著哪一頁也帶著', () => {
    const e = store.addEvent({ title: '週會', date: addDays(TODAY, 20), start: '15:00', end: '16:00' })
    const p = store.addProject({ name: '畢業專題', milestones: ['訪談整理'] })
    store.addStep(p.id, p.milestones[0].id, '列問題')
    store.addHabit({ name: '喝水', target: 8, unit: '杯' })
    store.addRoutine({ kind: 'event', title: '健身', repeat: { type: 'weekly', days: [2, 4] }, start: '20:00', end: '21:00', date: TODAY })
    store.addMotto('手機放遠一點')
    store.addSubscription({ name: '影音', price: 390, start: TODAY })
    const { data, ids } = agentContext(store, 'chat', { message: '嗨', here: { page: 'projects', project: p.id, date: TODAY } }, new Date())
    const w = data.world
    expect(w.events.find((x) => x.title === '週會')).toMatchObject({ date: addDays(TODAY, 20), start: '15:00', end: '16:00' })
    expect(ids.real(aliasOf(w.events, (x) => x.title === '週會'), 'e').id).toBe(e.id)
    const proj = w.projects.find((x) => x.name === '畢業專題')
    expect(proj.status).toBe('active')
    expect(proj.milestones[0].title).toBe('訪談整理')
    expect(proj.milestones[0].steps[0]).toMatchObject({ title: '列問題' })
    expect(proj.milestones[0].steps[0].id).toMatch(/^s\d+$/)
    expect(w.habits[0]).toMatchObject({ title: '喝水', target: 8, unit: '杯', days: '每天', today: 0 })
    expect(w.routines[0]).toMatchObject({ kind: 'event', title: '健身', repeat: '每週二四', start: '20:00' })
    expect(w.mottos[0].text).toBe('手機放遠一點')
    expect(w.subscriptions[0]).toMatchObject({ title: '影音', price: 390, status: 'active' })
    expect(w.settings).toMatchObject({ focusMin: 25, theme: 'auto' })
    expect(w.history).toHaveLength(14)
    // 正在看的那個專案用同一組代號
    expect(w.here).toEqual({ page: 'projects', date: TODAY, project: proj.id })
    // 自己整理時不帶
    expect(agentContext(store, 'morning', {}, new Date()).data).not.toHaveProperty('world')
  })

  it('別的種類的代號、看不懂的欄位和值都丟掉', () => {
    const e = store.addEvent({ title: '週會', date: TODAY, start: '15:00', end: '16:00' })
    const { data, ids } = agentContext(store, 'chat', { message: '嗨' }, new Date())
    const eid = aliasOf(data.world.events, (x) => x.title === '週會')
    const ops = cleanOps(
      {
        set: [
          { id: eid, field: 'start', value: '16：00' },
          { id: eid, field: 'target', value: '3' },
          { id: 'e99', field: 'title', value: '編的' },
          { id: eid, field: 'date', value: '2026-02-30' },
          { id: 'settings', field: 'focusMin', value: '47 分' },
          { id: 'settings', field: 'fontScale', value: '大' },
          { id: 'settings', field: 'theme', value: '夜晚' },
          { id: 'settings', field: 'breakMin', value: '7' },
          { id: 'settings', field: 'sound', value: '關' },
          { id: 'settings', field: 'sound', value: 'maybe' },
          { id: 'rhythm', field: 'work', value: '10:00-19:00 一二三四五' },
          { id: 'rhythm', field: 'meals', value: '早餐 07:30-08:00、午餐 12:30-13:30' },
          { id: 'rhythm', field: 'wake', value: '7:30' },
        ],
        create: [
          { kind: 'project', ref: 'n1', parent: '', title: '搬家', date: '', start: '', end: '', fields: [] },
          { kind: 'milestone', ref: '', parent: 'n1', title: '打包', date: '', start: '', end: '', fields: [] },
          { kind: 'milestone', ref: '', parent: 'n9', title: '沒有上層', date: '', start: '', end: '', fields: [] },
          { kind: 'subscription', ref: '', parent: '', title: '沒寫金額', date: '', start: '', end: '', fields: [] },
          { kind: 'task', ref: '', parent: '', title: '任務用 add', date: '', start: '', end: '', fields: [] },
        ],
        done: [eid, 'h77'],
        go: { do: 'open', id: 'settings' },
      },
      ids,
    )
    expect(ops.set.map((x) => [x.kind, x.field, x.value])).toEqual([
      ['event', 'start', '16:00'],
      ['settings', 'focusMin', 45],
      ['settings', 'fontScale', 1.12],
      ['settings', 'theme', 'night'],
      ['settings', 'breakMin', 5],
      ['settings', 'sound', false],
      ['rhythm', 'work', { start: '10:00', end: '19:00', days: [1, 2, 3, 4, 5] }],
      ['rhythm', 'meals', [{ label: '早餐', start: '07:30', end: '08:00' }, { label: '午餐', start: '12:30', end: '13:30' }]],
      ['rhythm', 'wake', '07:30'],
    ])
    expect(ops.set[0].id).toBe(e.id)
    expect(ops.create.map((c) => [c.kind, c.title, c.parent])).toEqual([['project', '搬家', null], ['milestone', '打包', { ref: 'n1' }]])
    expect(ops.done).toEqual([{ kind: 'event', id: e.id }])
    expect(ops.go).toEqual({ do: 'open', page: 'settings' })
  })

  it('資料太多時先拿掉不要緊的（最近的紀錄、遠的日程、專案的細節），不超過 Worker 收的上限', () => {
    for (let i = 0; i < 40; i++) store.addEvent({ title: `日程${i}`, date: addDays(TODAY, i), start: '10:00', end: '11:00' })
    const p = store.addProject({ name: '大專案', milestones: ['一', '二'] })
    store.addStep(p.id, p.milestones[0].id, '細項')
    const { data } = agentContext(store, 'chat', { message: '嗨' }, new Date())
    const full = new TextEncoder().encode(JSON.stringify(data)).length
    expect(full).toBeLessThan(DATA_MAX)
    // 上限很小：每一步都要拿掉
    const small = fitData(JSON.parse(JSON.stringify(data)), 1000)
    expect(small.world.history).toEqual([])
    expect(small.world.events.every((e) => e.date <= addDays(TODAY, 14))).toBe(true)
    expect(small.world.projects.every((x) => !x.milestones)).toBe(true)
    // 對話本身和代號留著
    expect(small.message).toBe('嗨')
    expect(small.world.settings).toBeTruthy()
  })

  it('星期幾的寫法', () => {
    expect(daysOf('每天')).toEqual([])
    expect(daysOf('平日')).toEqual([1, 2, 3, 4, 5])
    expect(daysOf('一三五')).toEqual([1, 3, 5])
    expect(daysOf('週二、週四')).toEqual([2, 4])
    expect(daysOf('日')).toEqual([0])
    expect(daysOf('7')).toEqual([0])
    expect(daysOf('明天')).toBeUndefined()
  })
})

describe('改了、新增、刪掉，都能撤銷', () => {
  it('日程換時間（日期、開始、結束一起改，記成一項）；撤銷回到原本的時間；之後自己改過的留著', () => {
    const e = store.addEvent({ title: '牙醫', date: addDays(TODAY, 1), start: '15:00', end: '16:00' })
    const { entry } = chat((o, w) => {
      const id = aliasOf(w.events, (x) => x.title === '牙醫')
      o.set.push({ id, field: 'date', value: addDays(TODAY, 2) }, { id, field: 'start', value: '16:00' }, { id, field: 'end', value: '17:00' })
    })
    expect(store.state.events.find((x) => x.id === e.id)).toMatchObject({ date: addDays(TODAY, 2), start: '16:00', end: '17:00' })
    expect(entry.changes).toHaveLength(1)
    expect(entry.changes[0].t).toBe('日程「牙醫」日期改成後天、開始時間改成 16:00、結束時間改成 17:00')
    // 使用者自己又把標題改了：撤銷時標題留著，時間回去
    store.updateEvent(e.id, { title: '看牙醫' })
    expect(undo(entry)).toBe(1)
    expect(store.state.events.find((x) => x.id === e.id)).toMatchObject({ title: '看牙醫', date: addDays(TODAY, 1), start: '15:00', end: '16:00' })
  })

  it('設定和作息：改了馬上生效，撤銷回到原本的值', () => {
    const { entry } = chat((o) => {
      o.set.push(
        { id: 'settings', field: 'focusMin', value: '50' },
        { id: 'settings', field: 'focusNoise', value: '雨聲' },
        { id: 'rhythm', field: 'wake', value: '07:30' },
        { id: 'rhythm', field: 'work', value: '' },
      )
    })
    expect(store.state.settings).toMatchObject({ focusMin: 50, focusNoise: 'rain' })
    expect(store.state.rhythm.wake).toBe('07:30')
    expect(store.state.rhythm.work).toBeNull()
    // 作息會動到空檔：先做（後面排任務時才避得開）
    expect(entry.changes.map((c) => c.t)).toEqual(['作息的起床改成 07:30、固定的工作時段改成不設', '專注一輪改成 50 分鐘、背景聲改成雨聲'])
    // 經過讀存檔（同步、重新整理）之後撤銷紀錄還在
    store.replaceState(migrate(JSON.parse(JSON.stringify(store.state))))
    expect(undo(store.state.agent.log.at(-1))).toBe(2)
    expect(store.state.settings).toMatchObject({ focusMin: 25, focusNoise: 'off' })
    expect(store.state.rhythm.wake).toBe('07:00')
    expect(store.state.rhythm.work).toEqual({ start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] })
  })

  it('一次建好專案、里程碑、細項，任務也歸進去；撤銷全部拿掉（之後用過的留著）', () => {
    const { entry } = chat((o) => {
      o.create.push(
        { kind: 'project', ref: 'n1', parent: '', title: '搬家', date: addDays(TODAY, 30), start: '', end: '', fields: [{ field: 'goal', value: '月底前搬好' }] },
        { kind: 'milestone', ref: 'n2', parent: 'n1', title: '打包', date: addDays(TODAY, 10), start: '', end: '', fields: [] },
        { kind: 'step', ref: '', parent: 'n2', title: '買紙箱', date: '', start: '', end: '', fields: [] },
      )
      o.add.push({ title: '找搬家公司', date: TODAY, at: '', dur: 30, tag: 'life', project: 'n1', steps: [], star: false })
    })
    const p = store.state.projects.find((x) => x.name === '搬家')
    expect(p).toMatchObject({ deadline: addDays(TODAY, 30), goal: '月底前搬好' })
    expect(p.milestones[0]).toMatchObject({ title: '打包', due: addDays(TODAY, 10) })
    expect(p.milestones[0].steps.map((s) => s.title)).toEqual(['買紙箱'])
    expect(store.state.tasks.find((t) => t.title === '找搬家公司').project).toBe(p.id)
    expect(entry.changes.map((c) => c.t)).toEqual([
      '新增專案「搬家」（截止 12/16）', '「搬家」加了里程碑「打包」（11/26）', '「打包」加了細項「買紙箱」', '新增「找搬家公司」（今天）',
    ])
    expect(undo(entry)).toBe(4)
    expect(store.state.projects.some((x) => x.name === '搬家')).toBe(false)
    expect(store.state.tasks.some((t) => t.title === '找搬家公司')).toBe(false)
    // 再建一次，這次使用者在專案裡寫了一則進度：撤銷時專案留著
    const again = chat((o) => o.create.push({ kind: 'project', ref: '', parent: '', title: '搬家', date: '', start: '', end: '', fields: [] })).entry
    const q = store.state.projects.find((x) => x.name === '搬家')
    store.addProjectLog(q.id, { text: '看了三間' })
    expect(undo(again)).toBe(0)
    expect(store.state.projects.some((x) => x.id === q.id)).toBe(true)
  })

  it('習慣：新增、打卡、改目標、收起來；撤銷照順序退回去', () => {
    const first = chat((o) => o.create.push({ kind: 'habit', ref: '', parent: '', title: '喝水', date: '', start: '', end: '', fields: [{ field: 'target', value: '8' }, { field: 'unit', value: '杯' }, { field: 'days', value: '平日' }] })).entry
    const h = store.state.habits.find((x) => x.name === '喝水')
    expect(h).toMatchObject({ target: 8, unit: '杯', days: [1, 2, 3, 4, 5] })
    expect(first.changes[0].t).toBe('新增習慣「喝水」（平日 8 杯）')
    const second = chat((o, w) => {
      const id = aliasOf(w.habits, (x) => x.title === '喝水')
      o.done.push(id)
      o.set.push({ id, field: 'target', value: '6' })
    }).entry
    expect(h.log[TODAY]).toBe(1)
    expect(h.target).toBe(6)
    expect(second.changes.map((c) => c.t)).toEqual(['習慣「喝水」每天的次數改成 6', '習慣「喝水」打了卡（今天第 1 次）'])
    expect(undo(second)).toBe(2)
    expect(h.log[TODAY]).toBeUndefined()
    expect(h.target).toBe(8)
    const third = chat((o, w) => o.drop.push(aliasOf(w.habits, (x) => x.title === '喝水'))).entry
    expect(h.archived).toBe(true)
    expect(third.changes[0].t).toBe('習慣「喝水」收起來了（之後可以拿回來）')
    expect(undo(third)).toBe(1)
    expect(h.archived).toBe(false)
    // 打過卡的習慣，撤銷「新增」時不刪
    store.checkHabit(h.id)
    expect(undo(first)).toBe(0)
    expect(store.habit(h.id)).toBeTruthy()
  })

  it('跨過午夜的日程（兩段）：ふじ看到的是一個日程（結束在隔天）；改結束、撤銷時兩段都回來；刪掉兩段一起、撤銷一起放回', () => {
    const tomorrow = addDays(TODAY, 1)
    const e = store.addEvent({ title: '夜車', date: TODAY, start: '23:30', end: '00:30' })
    const view = (w) => w.events.filter((x) => x.title === '夜車')
    const pieces = () => store.state.events.filter((x) => x.title === '夜車').map((x) => `${x.date} ${x.start}–${x.end}`)
    // 縮短成那天 23:50 結束：隔天那段拿掉；撤銷時接回去
    const first = chat((o, w) => {
      expect(view(w)).toEqual([expect.objectContaining({ date: TODAY, start: '23:30', end: '00:30', endsNextDay: true })])
      o.set.push({ id: view(w)[0].id, field: 'end', value: '23:50' })
    }).entry
    expect(pieces()).toEqual([`${TODAY} 23:30–23:50`])
    expect(undo(first)).toBe(1)
    expect(pieces()).toEqual([`${TODAY} 23:30–23:59`, `${tomorrow} 00:00–00:30`])
    // 刪掉：兩段一起；撤銷：兩段一起放回去（還是連著的）
    const gone = chat((o, w) => o.drop.push(view(w)[0].id)).entry
    expect(pieces()).toEqual([])
    store.replaceState(migrate(JSON.parse(JSON.stringify(store.state))))
    expect(undo(store.state.agent.log.at(-1))).toBe(1)
    expect(pieces()).toEqual([`${TODAY} 23:30–23:59`, `${tomorrow} 00:00–00:30`])
    const [a, b] = store.state.events.filter((x) => x.title === '夜車')
    expect(a.link && a.link === b.link).toBe(true)
    expect(a.id).toBe(e.id)
    expect(gone.changes[0].t).toBe('刪掉日程「夜車」')
  })

  it('刪掉日程、重要日子、警語：撤銷放回原本的位置', () => {
    const a = store.addEvent({ title: 'A', date: TODAY, start: '10:00', end: '11:00' })
    const b = store.addEvent({ title: 'B', date: TODAY, start: '12:00', end: '13:00' })
    store.addEvent({ title: 'C', date: TODAY, start: '14:00', end: '15:00' })
    const d = store.addDate({ title: '期中考', date: addDays(TODAY, 9), kind: 'exam' })
    const m = store.addMotto('先做最重要的那一件')
    const { entry } = chat((o, w) => {
      o.drop.push(aliasOf(w.events, (x) => x.title === 'B'), aliasOf(w.dates, (x) => x.title === '期中考'), aliasOf(w.mottos, (x) => x.text === m.text))
    })
    expect(store.state.events.map((e) => e.title)).toEqual(['A', 'C'])
    expect(store.state.dates).toHaveLength(0)
    expect(store.state.mottos).toHaveLength(0)
    expect(entry.changes.map((c) => c.t)).toEqual(['刪掉日程「B」', '刪掉重要日子「期中考」', '刪掉警語「先做最重要的那一件」'])
    expect(undo(entry)).toBe(3)
    expect(store.state.events.map((e) => e.title)).toEqual(['A', 'B', 'C'])
    // 照讀存檔的規則清過再放回去（多了讀檔時會補的 routineId）
    expect(store.state.events[1]).toEqual({ ...b, routineId: null })
    expect(store.state.dates[0]).toEqual(d)
    expect(store.state.mottos[0]).toEqual(m)
    expect(a.id).not.toBe(b.id)
  })

  it('專案：改截止日、暫停、收起來；撤銷回到進行中', () => {
    const p = store.addProject({ name: '作品集', deadline: addDays(TODAY, 5), milestones: ['首頁'] })
    const { entry } = chat((o, w) => {
      const id = aliasOf(w.projects, (x) => x.name === '作品集')
      o.set.push({ id, field: 'deadline', value: addDays(TODAY, 12) }, { id, field: 'status', value: 'paused' })
    })
    expect(p.deadline).toBe(addDays(TODAY, 12))
    expect(p.pausedAt).toBeTruthy()
    expect(entry.changes[0].t).toBe('專案「作品集」截止日改成 11/28（六）、暫停')
    expect(undo(entry)).toBe(1)
    expect(p.deadline).toBe(addDays(TODAY, 5))
    expect(p.pausedAt).toBeNull()
    const gone = chat((o, w) => o.drop.push(aliasOf(w.projects, (x) => x.name === '作品集'))).entry
    expect(p.archived).toBe(true)
    expect(undo(gone)).toBe(1)
    expect(p.archived).toBe(false)
  })

  it('里程碑勾完成、刪掉（指著它的任務撤銷時接回去）', () => {
    const p = store.addProject({ name: '專題', milestones: ['訪談', '初稿'] })
    const [m1, m2] = p.milestones
    const t = store.addTask({ title: '整理逐字稿', date: TODAY, project: p.id, ms: m2.id })
    const { entry } = chat((o, w) => {
      const proj = w.projects.find((x) => x.name === '專題')
      o.done.push(proj.milestones[0].id)
      o.drop.push(proj.milestones[1].id)
    })
    expect(m1.done).toBe(true)
    expect(p.milestones.map((m) => m.title)).toEqual(['訪談'])
    expect(store.state.tasks.find((x) => x.id === t.id).ms).toBeNull()
    expect(entry.changes.map((c) => c.t)).toEqual(['完成里程碑「訪談」', '刪掉里程碑「初稿」'])
    expect(undo(entry)).toBe(2)
    expect(p.milestones.map((m) => [m.title, m.done])).toEqual([['訪談', false], ['初稿', false]])
    expect(store.state.tasks.find((x) => x.id === t.id).ms).toBe(m2.id)
  })

  it('任務的備註、取消完成、只改長度走一般欄位；時間走排程（避開日程）', () => {
    const t = store.addTask({ title: '寫報告', date: TODAY })
    const d = store.addTask({ title: '已做完', date: TODAY })
    store.toggleTask(d.id)
    store.addEvent({ title: '會議', date: TODAY, start: '14:00', end: '15:00' })
    const { entry } = chat((o, w, data) => {
      const tid = data.days[0].tasks.find((x) => x.title === '寫報告').id
      const did = w.doneRecent.find((x) => x.title === '已做完').id
      o.set.push({ id: tid, field: 'at', value: '14:30' }, { id: tid, field: 'note', value: '先寫結論' }, { id: did, field: 'done', value: 'false' })
    })
    // 14:30 撞到會議：挪到最近的空檔
    expect(t.at).toBe('15:00')
    expect(t.note).toBe('先寫結論')
    expect(store.state.tasks.find((x) => x.id === d.id).done).toBe(false)
    // 取消完成先做（後面改標題、排時間才改得到）
    expect(entry.changes.map((c) => c.t)).toEqual(['「已做完」取消完成', '「寫報告」排在今天 15:00', '「寫報告」備註改了'])
    expect(undo(entry)).toBe(3)
    expect(t.at).toBeNull()
    expect(t.note).toBe('')
    expect(store.state.tasks.find((x) => x.id === d.id).done).toBe(true)
  })

  it('例行公事：新增、刪掉（撤銷時再長出來）', () => {
    const first = chat((o) => o.create.push({ kind: 'routine', ref: '', parent: '', title: '健身', date: TODAY, start: '20:00', end: '21:00', fields: [{ field: 'days', value: '一三五' }] })).entry
    const r = store.state.routines.find((x) => x.title === '健身')
    expect(r).toMatchObject({ kind: 'event', start: '20:00', end: '21:00', repeat: { type: 'weekly', days: [1, 3, 5] } })
    expect(store.eventsOn(TODAY).some((e) => e.routineId === r.id)).toBe(true)
    expect(first.changes[0].t).toBe('新增例行日程「健身」（每週一三五 20:00）')
    const gone = chat((o, w) => o.drop.push(aliasOf(w.routines, (x) => x.title === '健身'))).entry
    expect(store.state.routines).toHaveLength(0)
    expect(store.eventsOn(TODAY).some((e) => e.routineId === r.id)).toBe(false)
    expect(undo(gone)).toBe(1)
    expect(store.state.routines[0].id).toBe(r.id)
    expect(store.eventsOn(TODAY).some((e) => e.routineId === r.id)).toBe(true)
  })

  it('ふじ新增的跨過午夜的日程：之後自己改過（哪一段都算）撤銷時留著；沒改過的兩段一起拿掉', () => {
    const tomorrow = addDays(TODAY, 1)
    const add = () => {
      const out = blank()
      out.say = '好'
      out.events = [{ title: '夜車', date: TODAY, start: '23:30', end: '00:30' }]
      return store.agentApply(cleanOut(out, agentContext(store, 'chat', { message: 'x' }, new Date()).ids, 'chat'), { run: 'chat' })
    }
    const night = () => store.state.events.filter((x) => x.title === '夜車')
    const a = add()
    expect(night()).toHaveLength(2)
    const next = night().find((x) => x.date === tomorrow)
    store.updateEvent(next.id, { end: '04:30' })
    expect(undo(a)).toBe(0)
    expect(night()).toHaveLength(2)
    store.deleteEvent(next.id)
    const b = add()
    expect(undo(b)).toBe(1)
    expect(night()).toEqual([])
  })

  it('ふじ新增跨過午夜的例行日程：照實存（每一次都是兩段，跟快速記錄、日程頁一樣），不是一小時', () => {
    chat((o) => o.create.push({ kind: 'routine', ref: '', parent: '', title: '夜班', date: TODAY, start: '20:00', end: '02:00', fields: [{ field: 'days', value: '每月 5 日' }] }))
    expect(store.state.routines.find((r) => r.title === '夜班')).toMatchObject({ start: '20:00', end: '02:00', repeat: { type: 'monthly', day: 5 } })
  })

  it('例行公事每月幾號：「每月 31 日」就是每月（沒有 31 號的月份在月底）；認不得的頻率不建（不會變成每天）', () => {
    const first = chat((o) =>
      o.create.push(
        { kind: 'routine', ref: '', parent: '', title: '繳房租', date: TODAY, start: '', end: '', fields: [{ field: 'days', value: '每月31日' }] },
        { kind: 'routine', ref: '', parent: '', title: '亂寫', date: TODAY, start: '', end: '', fields: [{ field: 'days', value: '每兩週' }] },
        { kind: 'routine', ref: '', parent: '', title: '太大', date: TODAY, start: '', end: '', fields: [{ field: 'days', value: '每月 32 號' }] },
      ),
    ).entry
    expect(store.state.routines.map((r) => [r.title, r.repeat])).toEqual([['繳房租', { type: 'monthly', days: [], day: 31 }]])
    expect(first.changes.map((c) => c.t)).toEqual(['新增例行任務「繳房租」（每月 31 日）'])
    const r = store.state.routines[0]
    // 11 月沒有 31 號：月底那天（11/30）才有；12/1 不會多一件
    store.selectDate('2026-11-30')
    expect(store.tasksOn('2026-11-30').some((t) => t.routineId === r.id)).toBe(true)
    store.selectDate('2026-12-01')
    expect(store.tasksOn('2026-12-01').some((t) => t.routineId === r.id)).toBe(false)
  })

  it('訂閱、生活記錄、睡眠、專案的進度和筆記', () => {
    const p = store.addProject({ name: '專題', milestones: [] })
    const b = store.addSubscription({ name: '音樂', price: 150, start: addDays(TODAY, -10) })
    const { entry } = chat((o, w) => {
      o.set.push({ id: aliasOf(w.subscriptions, (x) => x.title === '音樂'), field: 'status', value: '取消' })
      const pid = aliasOf(w.projects, (x) => x.name === '專題')
      o.create.push(
        { kind: 'life', ref: '', parent: '', title: '午餐便當', date: TODAY, start: '12:10', end: '', fields: [{ field: 'kind', value: 'spend' }, { field: 'amount', value: '120' }] },
        { kind: 'sleep', ref: '', parent: '', title: '', date: TODAY, start: '01:00', end: '08:00', fields: [] },
        { kind: 'log', ref: '', parent: pid, title: '訪談了兩個人', date: TODAY, start: '', end: '', fields: [{ field: 'dur', value: '1.5 小時' }] },
        { kind: 'note', ref: '', parent: pid, title: '訪談重點', date: '', start: '', end: '', fields: [{ field: 'text', value: '大家都覺得太貴' }] },
      )
    })
    expect(store.subscription(b.id).status).toBe('cancelled')
    expect(store.lifeOn(TODAY).items[0]).toMatchObject({ text: '午餐便當', kind: 'spend', amount: 120, t: '12:10' })
    expect(store.state.sleep[TODAY]).toMatchObject({ bed: '01:00', wake: '08:00' })
    expect(p.logs[0]).toMatchObject({ text: '訪談了兩個人', mins: 90 })
    expect(p.notes[0]).toMatchObject({ title: '訪談重點', body: '大家都覺得太貴' })
    expect(entry.changes).toHaveLength(5)
    expect(undo(entry)).toBe(5)
    expect(store.subscription(b.id).status).toBe('active')
    expect(store.lifeOn(TODAY).items).toHaveLength(0)
    expect(store.state.sleep[TODAY]).toBeUndefined()
    expect(p.logs).toHaveLength(0)
    expect(p.notes).toHaveLength(0)
  })

  it('問問題只回答、不動資料；go 交給畫面打開', () => {
    const t = store.addTask({ title: '寫報告', date: TODAY })
    const { entry, act } = chat((o, w, data) => {
      o.say = '這週專注了 0 分鐘，從「寫報告」開始吧。'
      o.go = { do: 'focus', id: data.days[0].tasks[0].id }
    })
    expect(entry.changes).toEqual([])
    expect(entry.say).toContain('這週專注了')
    expect(act.ops.go).toEqual({ do: 'focus', id: t.id })
  })

  it('看著的那一頁：here 裡的專案代號跟 projects 裡的是同一個', () => {
    const p = store.addProject({ name: '專題', milestones: [] })
    const { data, ids } = agentContext(store, 'chat', { message: '這個專案截止日往後一週', here: { page: 'projects', project: p.id } }, new Date())
    expect(ids.real(data.world.here.project, 'p').id).toBe(p.id)
    expect(worldOf(store, ids, { page: 'nowhere', project: 'missing' }).here).toEqual({ page: 'today' })
  })
})

describe('壞掉的資料、store 順便動到的、同一批的先後', () => {
  it('撤銷紀錄裡不合法的值（同步、匯入來的）讀檔時拿掉；沒經過讀檔的壞紀錄撤銷時也不寫', () => {
    const { entry } = chat((o) => o.set.push({ id: 'settings', field: 'focusMin', value: '50' }, { id: 'settings', field: 'noiseVol', value: '40' }))
    expect(entry.changes[0].u.before).toEqual({ focusMin: 25, noiseVol: 50 })
    const raw = JSON.parse(JSON.stringify(store.state))
    raw.agent.log.at(-1).changes[0].u.before = { focusMin: { evil: 1 }, noiseVol: 'off' }
    store.replaceState(migrate(raw))
    expect(store.state.agent.log.at(-1).changes[0].u).toBeNull()
    expect(store._agentUndoOp({ k: 'set', kind: 'settings', before: { focusMin: 'banana' }, after: { focusMin: 50 } })).toBe(false)
    expect(store.state.settings.focusMin).toBe(50)
    // 一欄壞、一欄好：好的那一欄照樣能撤銷
    const two = JSON.parse(JSON.stringify(store.state))
    two.agent.log.push({ id: 'x1', at: Date.now(), run: 'chat', changes: [{ t: '改了', u: { k: 'set', kind: 'settings', before: { focusMin: 25, noiseVol: [] }, after: { focusMin: 50, noiseVol: 40 } } }] })
    store.replaceState(migrate(two))
    expect(store.state.agent.log.at(-1).changes[0].u).toEqual({ k: 'set', kind: 'settings', before: { focusMin: 25 }, after: { focusMin: 50 } })
  })

  it('「banana」「off」這種看不懂的數字不做（不會變成最小值）', () => {
    const ops = cleanOps({ set: [{ id: 'settings', field: 'focusMin', value: 'banana' }, { id: 'settings', field: 'fontScale', value: 'default' }, { id: 'settings', field: 'noiseVol', value: 'off' }] }, { real: () => null })
    expect(ops.set).toEqual([])
  })

  it('欄位名稱是 Claude 自己寫的字（格式不限定）：認不得的、繼承來的名字都不做；照提示詞寫時的 true／false 也認', () => {
    const odd = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'Title', 'nope', 3, null]
    const ops = cleanOps(
      {
        set: [...odd.map((field) => ({ id: 'settings', field, value: '50' })), { id: 'settings', field: 'sound', value: false }],
        create: [{ kind: 'habit', ref: '', parent: '', title: '喝水', date: '', start: '', end: '', fields: [...odd.map((field) => ({ field, value: '8' })), { field: 'target', value: 8 }] }],
      },
      { real: () => null },
    )
    expect(ops.set.map((x) => [x.field, x.value])).toEqual([['sound', false]])
    expect(ops.create).toHaveLength(1)
    expect(Object.keys(ops.create[0].fields)).toEqual(['target'])
    expect(ops.create[0].fields.target).toBe(8)
    expect(Object.getPrototypeOf(ops.create[0].fields)).toBe(Object.prototype)
  })

  it('放回去的那一筆照讀存檔的規則清過（壞掉的細項不會讓之後出錯）；id 對不上不放', () => {
    const p = store.addProject({ name: '專題', milestones: ['訪談', '初稿'] })
    const m2 = p.milestones[1]
    const { entry } = chat((o, w) => o.drop.push(w.projects[0].milestones[1].id))
    const u = entry.changes[0].u
    u.item = JSON.stringify({ ...JSON.parse(u.item), title: '  初稿 ', steps: [null, { title: 7 }, { id: 'ok', title: '列問題', done: 'yes' }] })
    expect(undo(entry)).toBe(1)
    expect(p.milestones[1]).toMatchObject({ id: m2.id, title: '初稿', steps: [{ id: 'ok', title: '列問題', done: true }] })
    expect(() => agentContext(store, 'chat', { message: '嗨' }, new Date())).not.toThrow()
    const again = chat((o, w) => o.drop.push(w.projects[0].milestones[1].id)).entry
    again.changes[0].u.item = JSON.stringify({ ...JSON.parse(again.changes[0].u.item), id: 'other' })
    expect(undo(again)).toBe(0)
    expect(p.milestones).toHaveLength(1)
  })

  it('刪掉最後一個沒做完的里程碑讓專案落成，撤銷時落成的獎勵照帳收回；之後真的做完再給一次', () => {
    const p = store.addProject({ name: '專題', milestones: ['訪談', '初稿'] })
    store.toggleMilestone(p.id, p.milestones[0].id)
    const before = { xp: store.player.xp, coins: store.player.coins, done: store.stats.projectsDone }
    const { entry } = chat((o, w) => o.drop.push(w.projects[0].milestones[1].id))
    expect(p.completedAt).toBeTruthy()
    expect(store.stats.projectsDone).toBe(before.done + 1)
    expect(undo(entry)).toBe(1)
    expect(p.completedAt).toBe(null)
    expect(p.paid).toBe(false)
    expect([store.player.xp, store.player.coins, store.stats.projectsDone]).toEqual([before.xp, before.coins, before.done])
    expect(store.state.grants[`p:${p.id}`]).toBeUndefined()
    store.toggleMilestone(p.id, p.milestones[1].id)
    expect(p.completedAt).toBeTruthy()
    expect(store.stats.projectsDone).toBe(before.done + 1)
    expect(store.player.xp).toBeGreaterThan(before.xp)
  })

  it('新增的訂閱之後改過備註：撤銷「新增」不刪', () => {
    const { entry } = chat((o) => o.create.push({ kind: 'subscription', ref: '', parent: '', title: '雲端', date: TODAY, start: '', end: '', fields: [{ field: 'price', value: '90' }] }))
    const b = store.state.subscriptions[0]
    store.updateSubscription(b.id, { note: '家庭方案' })
    expect(undo(entry)).toBe(0)
    expect(store.subscription(b.id)).toBeTruthy()
  })

  it('刪掉例行公事再撤銷：今天那一份自己改過的名字和備註還在', () => {
    const r = store.addRoutine({ kind: 'task', title: '背單字', repeat: { type: 'daily' }, date: TODAY })
    const inst = store.state.tasks.find((t) => t.routineId === r.id && t.date === TODAY)
    store.updateTask(inst.id, { title: '背單字 50 個', note: '用卡片' })
    const { entry } = chat((o, w) => o.drop.push(aliasOf(w.routines, (x) => x.title === '背單字')))
    expect(store.state.tasks.some((t) => t.id === inst.id)).toBe(false)
    expect(undo(entry)).toBe(1)
    expect(store.state.tasks.filter((t) => t.routineId === r.id && t.date === TODAY)).toMatchObject([{ id: inst.id, title: '背單字 50 個', note: '用卡片' }])
  })

  it('進度的字清空（時間也是 0）不會變成悄悄刪掉', () => {
    const p = store.addProject({ name: '專題', milestones: [] })
    store.addProjectLog(p.id, { text: '訪談' })
    const { entry } = chat((o, w) => o.set.push({ id: w.projects[0].logs[0].id, field: 'text', value: '' }))
    expect(p.logs).toHaveLength(1)
    expect(entry?.changes || []).toEqual([])
  })

  it('日程改開始時間時跟著挪的結束時間、改成整天：撤銷一起放回去', () => {
    const e = store.addEvent({ title: '讀書會', date: TODAY, start: '15:00', end: '16:00' })
    const { entry } = chat((o, w) => o.set.push({ id: aliasOf(w.events, (x) => x.title === '讀書會'), field: 'start', value: '17:00' }))
    expect(e).toMatchObject({ start: '17:00', end: '18:00' })
    expect(entry.changes[0].t).toBe('日程「讀書會」開始時間改成 17:00')
    expect(undo(entry)).toBe(1)
    expect(e).toMatchObject({ start: '15:00', end: '16:00' })
    const whole = chat((o, w) => o.set.push({ id: aliasOf(w.events, (x) => x.title === '讀書會'), field: 'allDay', value: 'true' })).entry
    expect(e).toMatchObject({ allDay: true, start: '00:00', end: '23:59' })
    expect(undo(whole)).toBe(1)
    expect(e).toMatchObject({ allDay: false, start: '15:00', end: '16:00', endDate: '' })
  })

  it('停掉的訂閱重新訂閱：撤銷時開始日、付過的錢、停掉的那天都回去', () => {
    const b = store.addSubscription({ name: '健身房', price: 1000, start: addDays(TODAY, -60) })
    store.cancelSubscription(b.id, addDays(TODAY, -5))
    const was = JSON.parse(JSON.stringify(store.subscription(b.id)))
    const { entry } = chat((o, w) => o.set.push({ id: aliasOf(w.subscriptions, (x) => x.title === '健身房'), field: 'status', value: '恢復' }))
    expect(store.subscription(b.id)).toMatchObject({ status: 'active', start: TODAY, end: '' })
    expect(store.subscription(b.id).paid0).toBeGreaterThan(0)
    expect(entry.changes[0].t).toBe('訂閱「健身房」恢復訂閱')
    expect(undo(entry)).toBe(1)
    expect(store.subscription(b.id)).toEqual(was)
  })

  it('刪掉最後一個沒做完的細項讓里程碑跟著完成：撤銷時里程碑也退回沒做完', () => {
    const p = store.addProject({ name: '專題', milestones: ['訪談', '整理'] })
    const m = p.milestones[0]
    const s1 = store.addStep(p.id, m.id, '約時間')
    store.addStep(p.id, m.id, '寫問題')
    store.toggleStep(p.id, m.id, s1.id)
    const { entry } = chat((o, w) => o.drop.push(w.projects[0].milestones[0].steps.find((x) => x.title === '寫問題').id))
    expect(m.done).toBe(true)
    expect(undo(entry)).toBe(1)
    expect(m.steps.map((x) => x.title)).toEqual(['約時間', '寫問題'])
    expect(m.done).toBe(false)
  })

  it('同一批裡挪了日程又排任務：任務避開挪過去的日程', () => {
    const e = store.addEvent({ title: '會議', date: TODAY, start: '10:00', end: '11:00' })
    const t = store.addTask({ title: '寫報告', date: TODAY })
    chat((o, w, data) => {
      const eid = aliasOf(w.events, (x) => x.title === '會議')
      const tid = data.days[0].tasks.find((x) => x.title === '寫報告').id
      o.set.push({ id: eid, field: 'start', value: '14:00' }, { id: eid, field: 'end', value: '15:00' }, { id: tid, field: 'at', value: '14:00' }, { id: tid, field: 'dur', value: '30' })
    })
    expect(e).toMatchObject({ start: '14:00', end: '15:00' })
    const s = +t.at.slice(0, 2) * 60 + +t.at.slice(3)
    expect(s + 30 <= 14 * 60 || s >= 15 * 60).toBe(true)
  })

  it('生活記錄刪掉再撤銷：累計筆數也加回來', () => {
    store.addLife(TODAY, { text: '散步' })
    const n = store.stats.lifeEntries
    const { entry } = chat((o, w) => o.drop.push(w.life[0].id))
    expect(store.stats.lifeEntries).toBe(n - 1)
    expect(undo(entry)).toBe(1)
    expect(store.stats.lifeEntries).toBe(n)
    expect(store.lifeOn(TODAY).items[0].text).toBe('散步')
  })

  it('資料再多也不會超過 Worker 收的上限', () => {
    const { data } = agentContext(store, 'chat', { message: '嗨' }, new Date())
    const big = (n, f) => Array.from({ length: n }, (_, i) => f(i))
    data.world.mottos = big(3000, (i) => ({ id: `w${i}`, text: '一'.repeat(60) }))
    data.world.routines = big(2000, (i) => ({ id: `r${i}`, title: '二'.repeat(30), repeat: '每天' }))
    data.days.forEach((d) => (d.tasks = big(40, (i) => ({ id: `t${i}`, title: '三'.repeat(40) }))))
    data.overdue = big(30, (i) => ({ id: `t${i}`, title: '四'.repeat(40) }))
    const out = fitData(data)
    expect(new TextEncoder().encode(JSON.stringify(out)).length).toBeLessThanOrEqual(DATA_MAX)
    expect(out.message).toBe('嗨')
  })

  it('取消完成又改名：先取消完成，名字才改得到', () => {
    const t = store.addTask({ title: '寫報告', date: TODAY })
    store.toggleTask(t.id)
    chat((o, w) => {
      const id = w.doneRecent.find((x) => x.title === '寫報告').id
      o.set.push({ id, field: 'done', value: 'false' }, { id, field: 'title', value: '寫期末報告' })
    })
    expect(t).toMatchObject({ done: false, title: '寫期末報告' })
  })

  it('排到別天時一起說「不估時間」：長度清掉，撤銷時日子和長度都回來', () => {
    const t = store.addTask({ title: '寫報告', date: TODAY, dur: 60 })
    const { entry } = chat((o, w, data) => {
      const id = data.days[0].tasks.find((x) => x.title === '寫報告').id
      o.set.push({ id, field: 'date', value: addDays(TODAY, 1) }, { id, field: 'dur', value: '0' })
    })
    expect(t).toMatchObject({ date: addDays(TODAY, 1), dur: null })
    expect(undo(entry)).toBe(2)
    expect(t).toMatchObject({ date: TODAY, dur: 60 })
  })

  it('「不是先做的那一件」做得到，撤銷時那天沒有別件才拿回來', () => {
    const t = store.addTask({ title: '寫報告', date: TODAY })
    const u = store.addTask({ title: '回信', date: TODAY })
    store.setFirst(t.id)
    const id = (data) => data.days[0].tasks.find((x) => x.title === '寫報告').id
    const { entry } = chat((o, w, data) => o.set.push({ id: id(data), field: 'first', value: 'false' }))
    expect(t.first).toBe(false)
    expect(entry.changes[0].t).toBe('「寫報告」不再是先做的那一件')
    expect(undo(entry)).toBe(1)
    expect(t.first).toBe(true)
    const again = chat((o, w, data) => o.set.push({ id: id(data), field: 'first', value: 'false' })).entry
    store.setFirst(u.id)
    undo(again)
    expect([t.first, u.first]).toEqual([false, true])
  })

  it('習慣打到上限（99 次）：沒打上去就不記，撤銷不會少一次', () => {
    const h = store.addHabit({ name: '喝水', target: 99 })
    for (let i = 0; i < 99; i++) store.checkHabit(h.id)
    const { entry } = chat((o, w) => o.done.push(aliasOf(w.habits, (x) => x.title === '喝水')))
    expect(entry?.changes || []).toEqual([])
    expect(h.log[TODAY]).toBe(99)
  })

  it('兩件任務各有一個 id 一樣的子任務：代號不一樣，各自指到自己的那一件', () => {
    const a = store.addTask({ title: 'A', date: TODAY })
    const b = store.addTask({ title: 'B', date: TODAY })
    store.addSub(a.id, '一')
    store.addSub(a.id, '一之二')
    store.addSub(b.id, '二')
    b.subs[0].id = a.subs[0].id
    chat((o, w) => o.done.push(w.subtasks.find((x) => x.title === '二').id))
    expect(a.subs[0].done).toBe(false)
    expect(b.subs[0].done).toBe(true)
  })
})

describe('第二輪：惡意的欄位名稱、自己後來動過的、一起變的那幾欄', () => {
  it('撤銷紀錄的欄位名稱是 hasOwnProperty 這種：讀檔不出錯，那一筆不能撤銷', () => {
    const raw = JSON.parse(JSON.stringify(store.state))
    raw.agent.log.push({ id: 'x1', at: Date.now(), run: 'chat', changes: [{ t: '改了', u: { k: 'set', kind: 'settings', before: { hasOwnProperty: 'x', toString: 1 }, after: { hasOwnProperty: 'y', toString: 2 } } }] })
    const out = migrate(raw)
    expect(out.agent.log.at(-1).changes[0].u).toBeNull()
    expect(store._agentUndoOp({ k: 'set', kind: 'settings', before: { hasOwnProperty: 'x' }, after: { hasOwnProperty: 'y' } })).toBe(false)
  })

  it('撤銷紀錄把名稱寫成空的：讀檔時那一欄拿掉', () => {
    const raw = JSON.parse(JSON.stringify(store.state))
    raw.agent.log.push({ id: 'x1', at: Date.now(), run: 'chat', changes: [{ t: '改了', u: { k: 'set', kind: 'date', id: 'd1', before: { title: '  ' }, after: { title: '期中考' } } }] })
    expect(migrate(raw).agent.log.at(-1).changes[0].u).toBeNull()
  })

  it('新增的例行公事：今天那一份被排了時間，撤銷「新增」不刪', () => {
    const { entry } = chat((o) => o.create.push({ kind: 'routine', ref: '', parent: '', title: '背單字', date: TODAY, start: '', end: '', fields: [] }))
    const r = store.state.routines[0]
    const inst = store.state.tasks.find((t) => t.routineId === r.id)
    store.updateTask(inst.id, { at: '15:30', dur: 60 })
    expect(undo(entry)).toBe(0)
    expect(store.state.routines).toHaveLength(1)
    expect(store.state.tasks.find((t) => t.id === inst.id)).toMatchObject({ at: '15:30', dur: 60 })
  })

  it('例行公事長出很多天：全部放得回去；太大存不下的就不刪', () => {
    const r = store.addRoutine({ kind: 'task', title: '背單字', repeat: { type: 'daily' }, date: TODAY })
    for (let i = 1; i < 70; i++) store._ensureRoutines(addDays(TODAY, i))
    const n = store.state.tasks.filter((t) => t.routineId === r.id).length
    expect(n).toBe(70)
    const { entry } = chat((o, w) => o.drop.push(aliasOf(w.routines, (x) => x.title === '背單字')))
    expect(store.state.tasks.filter((t) => t.routineId === r.id)).toHaveLength(0)
    expect(undo(entry)).toBe(1)
    expect(store.state.tasks.filter((t) => t.routineId === r.id)).toHaveLength(70)
    for (const t of store.state.tasks) if (t.routineId === r.id) store.updateTask(t.id, { note: '筆'.repeat(500) })
    const big = chat((o, w) => o.drop.push(aliasOf(w.routines, (x) => x.title === '背單字'))).entry
    expect(big?.changes || []).toEqual([])
    expect(store.state.routines).toHaveLength(1)
    expect(store.state.tasks.filter((t) => t.routineId === r.id)).toHaveLength(70)
  })

  it('新增的里程碑之後有進度標著它：撤銷「新增」不刪', () => {
    const p = store.addProject({ name: '專題', milestones: [] })
    const { entry } = chat((o, w) => o.create.push({ kind: 'milestone', ref: '', parent: aliasOf(w.projects, (x) => x.name === '專題'), title: '訪談', date: '', start: '', end: '', fields: [] }))
    const m = p.milestones[0]
    store.addProjectLog(p.id, { text: '約好了', ms: m.id })
    expect(undo(entry)).toBe(0)
    expect(p.logs[0].ms).toBe(m.id)
  })

  it('刪子任務沒讓任務完成、之後自己勾完成：撤銷時任務不會被取消完成', () => {
    const t = store.addTask({ title: '寫報告', date: TODAY })
    store.addSub(t.id, 'A')
    store.addSub(t.id, 'B')
    const { entry } = chat((o, w) => o.drop.push(w.subtasks.find((x) => x.title === 'A').id))
    expect(t.done).toBe(false)
    store.toggleTask(t.id)
    expect(undo(entry)).toBe(1)
    expect(t.done).toBe(true)
    expect(t.subs.map((x) => x.title)).toEqual(['A', 'B'])
  })

  it('刪掉最後一個沒做完的里程碑讓專案落成：撤銷時專案退回進行中，落成次數扣回來', () => {
    const p = store.addProject({ name: '專題', milestones: ['訪談', '初稿'] })
    store.toggleMilestone(p.id, p.milestones[0].id)
    const n = store.stats.projectsDone
    const { entry } = chat((o, w) => o.drop.push(w.projects[0].milestones[1].id))
    expect(p.completedAt).toBeTruthy()
    expect(store.stats.projectsDone).toBe(n + 1)
    const raw = JSON.parse(JSON.stringify(store.state))
    store.replaceState(migrate(raw))
    const q = store.state.projects[0]
    expect(undo(store.state.agent.log.at(-1))).toBe(1)
    expect(q.completedAt).toBeNull()
    expect(q.milestones.map((m) => m.title)).toEqual(['訪談', '初稿'])
    expect(store.stats.projectsDone).toBe(n)
    expect(entry.changes[0].t).toBe('刪掉里程碑「初稿」')
  })

  it('一起變的那幾欄有一欄之後被改過：整組不動', () => {
    const e = store.addEvent({ title: '讀書會', date: TODAY, start: '10:00', end: '11:00' })
    const { entry } = chat((o, w) => {
      const id = aliasOf(w.events, (x) => x.title === '讀書會')
      o.set.push({ id, field: 'start', value: '12:00' }, { id, field: 'end', value: '13:00' })
    })
    store.updateEvent(e.id, { start: '12:30' })
    expect(undo(entry)).toBe(0)
    expect(e).toMatchObject({ start: '12:30', end: '13:00' })
    const b = store.addSubscription({ name: '健身房', price: 1000, start: addDays(TODAY, -60) })
    store.cancelSubscription(b.id, addDays(TODAY, -5))
    const back = chat((o, w) => o.set.push({ id: aliasOf(w.subscriptions, (x) => x.title === '健身房'), field: 'status', value: '恢復' })).entry
    store.cancelSubscription(b.id)
    const now = JSON.parse(JSON.stringify(store.subscription(b.id)))
    expect(undo(back)).toBe(0)
    expect(store.subscription(b.id)).toEqual(now)
  })

  it('長期任務移出專案再撤銷：變回長期任務', () => {
    const p = store.addProject({ name: '練琴', milestones: [] })
    const t = store.addTask({ title: '練習曲', date: addDays(TODAY, -20), project: p.id, ongoing: true })
    const { entry } = chat((o, w) => o.set.push({ id: w.ongoing.find((x) => x.title === '練習曲').id, field: 'project', value: '' }))
    expect(t).toMatchObject({ project: null, ongoing: false, date: TODAY })
    store.replaceState(migrate(JSON.parse(JSON.stringify(store.state))))
    expect(undo(store.state.agent.log.at(-1))).toBe(1)
    expect(store.state.tasks.find((x) => x.id === t.id)).toMatchObject({ project: p.id, ongoing: true })
    expect(entry.changes[0].t).toBe('「練習曲」移出專案')
  })

  it('長期任務取消完成再撤銷：完成的那天和時間都回來', () => {
    const p = store.addProject({ name: '練琴', milestones: [] })
    const t = store.addTask({ title: '練習曲', date: TODAY, project: p.id, ongoing: true })
    vi.setSystemTime(new Date(2026, 10, 12, 10))
    store.toggleTask(t.id)
    const doneAt = t.doneAt
    expect(t.date).toBe('2026-11-12')
    at(9)
    const { entry } = chat((o, w) => o.set.push({ id: w.doneRecent.find((x) => x.title === '練習曲').id, field: 'done', value: 'false' }))
    expect(t.done).toBe(false)
    expect(undo(entry)).toBe(1)
    expect(t).toMatchObject({ done: true, date: '2026-11-12', doneAt })
  })

  it('同一批改兩件任務裡 id 一樣的子任務：兩個都改到', () => {
    const a = store.addTask({ title: 'A', date: TODAY })
    const b = store.addTask({ title: 'B', date: TODAY })
    store.addSub(a.id, '一')
    store.addSub(b.id, '二')
    b.subs[0].id = a.subs[0].id
    chat((o, w) => {
      o.set.push({ id: w.subtasks.find((x) => x.title === '一').id, field: 'title', value: '一改' }, { id: w.subtasks.find((x) => x.title === '二').id, field: 'title', value: '二改' })
    })
    expect([a.subs[0].title, b.subs[0].title]).toEqual(['一改', '二改'])
  })
})

describe('第三輪：一起變的那幾欄整組記、整組檢查', () => {
  it('只改了開始時間、使用者之後改了結束：撤銷整組不動', () => {
    const e = store.addEvent({ title: '讀書會', date: TODAY, start: '10:00', end: '13:00' })
    const { entry } = chat((o, w) => o.set.push({ id: aliasOf(w.events, (x) => x.title === '讀書會'), field: 'start', value: '11:00' }))
    expect(e).toMatchObject({ start: '11:00', end: '13:00' })
    store.updateEvent(e.id, { end: '14:00' })
    expect(undo(entry)).toBe(0)
    expect(e).toMatchObject({ start: '11:00', end: '14:00' })
  })

  it('匯入的撤銷紀錄裡同一組有一欄不合法：整組拿掉', () => {
    const raw = JSON.parse(JSON.stringify(store.state))
    raw.agent.log.push({ id: 'x1', at: Date.now(), run: 'chat', changes: [
      { t: '改了', u: { k: 'set', kind: 'event', id: 'e1', before: { start: '09:00', end: 'invalid', title: 'A' }, after: { start: '12:00', end: '13:00', title: 'B' } } },
    ] })
    expect(migrate(raw).agent.log.at(-1).changes[0].u).toEqual({ k: 'set', kind: 'event', id: 'e1', before: { title: 'A' }, after: { title: 'B' } })
  })

  it('取消完成、重新整理之後再撤銷：完成的時間和自動歸到的里程碑都是原本的', () => {
    const p = store.addProject({ name: '練琴', milestones: ['基本功', '曲子'] })
    const t = store.addTask({ title: '音階', date: TODAY, project: p.id })
    at(8)
    store.toggleTask(t.id)
    const { doneAt, msAuto } = t
    expect(msAuto).toBe(p.milestones[0].id)
    store.toggleMilestone(p.id, p.milestones[0].id)
    at(9)
    chat((o, w) => o.set.push({ id: w.doneRecent.find((x) => x.title === '音階').id, field: 'done', value: 'false' }))
    store.replaceState(migrate(JSON.parse(JSON.stringify(store.state))))
    at(10)
    expect(undo(store.state.agent.log.at(-1))).toBe(1)
    expect(store.state.tasks.find((x) => x.id === t.id)).toMatchObject({ done: true, doneAt, msAuto })
  })
})