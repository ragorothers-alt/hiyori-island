import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 自主的ふじ什麼時候動（agentRunner.js）：Claude 換成假的（src/ai.js 的 askAI）
const ai = vi.hoisted(() => ({ ready: true, ask: null }))
vi.mock('../src/ai.js', () => ({ aiReady: () => ai.ready, askAI: (...a) => ai.ask(...a) }))

const { Store, addDays } = await import('../src/store.js')
const { createAgent, CAPTURE_WAIT, CAPTURE_RETRY } = await import('../src/agentRunner.js')

const TODAY = '2026-11-16'
let store
let agent
let notes
const at = (hour, min = 0) => vi.setSystemTime(new Date(2026, 10, 16, hour, min))
const blank = (o = {}) => ({ say: '', schedule: [], add: [], steps: [], edit: [], star: [], first: '', msteps: [], next: '', remember: [], forget: [], done: [], drop: [], events: [], dates: [], ask: [], ...o })
const hooks = () => ({ notify: (entry, run, pending) => notes.push({ entry, run, pending }), busy: () => false, holding: () => false, focusing: () => null })
class AiError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  at(9)
  localStorage.clear()
  ai.ready = true
  ai.ask = vi.fn(async () => blank())
  notes = []
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], events: [], projects: [], player: { xp: 0, coins: 0 } }))
  agent = createAgent(store, hooks())
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('自己整理', () => {
  it('早上第一次：把今天排好、說一聲；同一天不再做；這一週第一次帶 weekStart', async () => {
    const t = store.addTask({ title: '寫報告', date: TODAY })
    ai.ask = vi.fn(async (task, data) => blank({ say: '排好了', schedule: [{ id: data.days[0].tasks[0].id, date: TODAY, at: '10:00', dur: 50 }], next: data.days[0].tasks[0].id }))
    await agent.tick()
    expect(ai.ask).toHaveBeenCalledTimes(1)
    expect(ai.ask.mock.calls[0][0]).toBe('agent')
    expect(ai.ask.mock.calls[0][1]).toMatchObject({ run: 'morning', mode: 'auto', weekStart: true })
    expect(t).toMatchObject({ at: '10:00', dur: 50 })
    expect(notes).toHaveLength(1)
    expect(notes[0].entry).toMatchObject({ run: 'morning', say: '排好了', next: t.id })
    expect(store.state.agent.ran).toMatchObject({ morning: TODAY, week: TODAY })
    expect(agent.tick()).toBeNull()
    expect(ai.ask).toHaveBeenCalledTimes(1)
  })

  it('自己整理沒做成：記下原因（畫面上看得到），下一次做成了就清掉；對話出錯不算', async () => {
    store.addTask({ title: '寫報告', date: TODAY })
    ai.ask = vi.fn(async () => {
      throw Object.assign(new AiError('claude rejected'), { message: 'Claude 沒有接受這次的請求：too large' })
    })
    await agent.tick()
    expect(agent.failed).toMatchObject({ run: 'morning', text: 'Claude 沒有接受這次的請求：too large', code: 'claude rejected' })
    await agent.say('嗨')
    expect(agent.failed.run).toBe('morning')
    ai.ask = vi.fn(async () => blank({ say: '排好了' }))
    await agent.now('morning')
    expect(agent.failed).toBeNull()
  })

  it('她排好之後自己又改掉的、撤銷了的，下一次都告訴她（看出偏好）', async () => {
    const a = store.addTask({ title: '寫報告', date: TODAY })
    const b = store.addTask({ title: '回信', date: TODAY })
    const c = store.addTask({ title: '採買', date: TODAY })
    ai.ask = vi.fn(async (task, data) => {
      const id = (title) => data.days[0].tasks.find((t) => t.title === title).id
      return blank({ schedule: [['寫報告', '10:00'], ['回信', '11:00'], ['採買', '14:00']].map(([title, at]) => ({ id: id(title), date: TODAY, at, dur: 30 })), add: [{ title: '整理桌面', date: TODAY, at: '', dur: 15, tag: 'life', project: '', steps: [], star: false }] })
    })
    await agent.now('morning')
    expect([a.at, b.at, c.at]).toEqual(['10:00', '11:00', '14:00'])
    store.updateTask(a.id, { at: '20:00' })
    store.toggleTask(b.id)
    store.deleteTask(store.state.tasks.find((t) => t.title === '整理桌面').id)
    ai.ask = vi.fn(async () => blank())
    await agent.now('replan')
    const data = ai.ask.mock.calls[0][1]
    expect(data.adjusted).toEqual([
      { title: '寫報告', fuji: `${TODAY} 10:00`, now: `${TODAY} 20:00` },
      { title: '整理桌面', fuji: `${TODAY} 沒排時段`, now: '刪掉了' },
    ])
    expect(data.recent.at(-1)).not.toHaveProperty('undone')
    // 整批撤銷：帶著 undone，那一批排的不再算「被改掉的」
    store.agentUndo(store.state.agent.log.at(-1).id)
    await agent.now('replan')
    const again = ai.ask.mock.calls[1][1]
    expect(again.recent.some((e) => e.undone)).toBe(true)
    expect(again).not.toHaveProperty('adjusted')
  })

  it('早上沒有任何東西可以排：不問 Claude，記下今天看過了', () => {
    expect(agent.tick()).toBeNull()
    expect(ai.ask).not.toHaveBeenCalled()
    expect(store.state.agent.ran).toMatchObject({ morning: TODAY, week: TODAY })
  })

  it('沒接 Claude、關掉自己整理、正在打字、專注中：都不動', async () => {
    store.addTask({ title: '寫報告', date: TODAY })
    ai.ready = false
    expect(agent.tick()).toBeNull()
    ai.ready = true
    store.setSetting('agentMode', 'off')
    expect(agent.tick()).toBeNull()
    store.setSetting('agentMode', 'auto')
    const busy = createAgent(store, { ...hooks(), busy: () => true })
    expect(busy.tick()).toBeNull()
    const held = createAgent(store, { ...hooks(), holding: () => true })
    expect(held.tick()).toBeNull()
    expect(ai.ask).not.toHaveBeenCalled()
  })

  it('先問我：有要動資料的先放著等；套用才生效，不用就丟掉；等的時候不再整理', async () => {
    store.setSetting('agentMode', 'ask')
    const t = store.addTask({ title: '寫報告', date: TODAY })
    ai.ask = vi.fn(async (task, data) => blank({ say: '想這樣排', schedule: [{ id: data.days[0].tasks[0].id, date: TODAY, at: '10:00', dur: 50 }] }))
    await agent.tick()
    expect(t.at).toBeNull()
    expect(agent.pending).toMatchObject({ run: 'morning', say: '想這樣排', lines: ['「寫報告」排在今天 10:00'] })
    expect(notes[0].pending).toBe(agent.pending)
    // 這一種今天算做過了：不會每分鐘再問一次
    expect(store.state.agent.ran.morning).toBe(TODAY)
    at(22)
    store.addTask({ title: '明天的事', date: addDays(TODAY, 1) })
    expect(agent.tick()).toBeNull()
    at(9, 30)
    const entry = agent.accept()
    expect(t.at).toBe('10:00')
    expect(entry.changes).toHaveLength(1)
    expect(agent.pending).toBeNull()
    // 不用：資料不動
    at(9)
    store.state.agent.ran.morning = ''
    t.at = null
    await agent.tick()
    agent.dismiss()
    expect(t.at).toBeNull()
    expect(agent.pending).toBeNull()
  })

  it('動手之前先等同步：別台已經整理過就不再做；還在等的時候不重複開始', async () => {
    store.addTask({ title: '寫報告', date: TODAY })
    let pulled
    const synced = createAgent(store, { ...hooks(), settle: () => new Promise((ok) => (pulled = ok)) })
    const first = synced.tick()
    expect(synced.tick()).toBeNull()
    expect(ai.ask).not.toHaveBeenCalled()
    // 同步拉回來的資料裡，別台今天已經整理過了
    store.state.agent.ran.morning = TODAY
    await Promise.resolve()
    pulled()
    expect(await first).toBeNull()
    expect(ai.ask).not.toHaveBeenCalled()
    // 沒有別台做過：同步完照常整理；同步失敗也照常
    store.state.agent.ran.morning = ''
    const failing = createAgent(store, { ...hooks(), settle: () => Promise.reject(new Error('offline')) })
    await failing.tick()
    expect(ai.ask).toHaveBeenCalledTimes(1)
  })

  it('正在專注的那一件不動它的時間', async () => {
    const a = store.addTask({ title: '正在做', date: TODAY, at: '09:00', dur: 30 })
    const b = store.addTask({ title: '另一件', date: TODAY })
    ai.ask = vi.fn(async (task, data) => blank({ schedule: data.days[0].tasks.map((t, i) => ({ id: t.id, date: TODAY, at: `1${i + 3}:00`, dur: 30 })) }))
    const focused = createAgent(store, { ...hooks(), focusing: () => a.id })
    await focused.tick()
    expect(ai.ask.mock.calls[0][1].focusing).toMatchObject({ title: '正在做' })
    expect(a.at).toBe('09:00')
    expect(b.at).toBe('14:00')
  })

  it('進度落後：重排一次，同一個狀況不再叫', async () => {
    store.state.agent.ran.morning = TODAY
    const t = store.addTask({ title: '寫報告', date: TODAY, at: '09:00', dur: 30 })
    vi.advanceTimersByTime(CAPTURE_WAIT + 10)
    await vi.waitFor(() => expect(agent.thinking).toBeNull())
    ai.ask.mockClear()
    at(10)
    ai.ask = vi.fn(async () => blank({ say: '' }))
    await agent.tick()
    expect(ai.ask.mock.calls[0][1]).toMatchObject({ run: 'replan' })
    expect(ai.ask.mock.calls[0][1].why).toContain('寫報告')
    at(10, 50)
    expect(agent.tick()).toBeNull()
    // 這台裝置記著：重新整理頁面後也不會為了同一件事再叫
    const again = createAgent(store, hooks())
    expect(again.tick()).toBeNull()
    expect(t.at).toBe('09:00')
  })

  it('連不上：隔十分鐘再試；通行碼不對這類的當天不再試，改了設定（reset）才再試', async () => {
    store.addTask({ title: '寫報告', date: TODAY })
    ai.ask = vi.fn(async () => {
      throw new AiError('offline')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await agent.tick()
    expect(agent.error).toBe('offline')
    expect(agent.tick()).toBeNull()
    vi.advanceTimersByTime(10 * 60000 + 1000)
    ai.ask = vi.fn(async () => {
      throw new AiError('bad pass')
    })
    await agent.tick()
    vi.advanceTimersByTime(3 * 3600000)
    expect(agent.tick()).toBeNull()
    agent.reset()
    ai.ask = vi.fn(async () => blank())
    await agent.tick()
    expect(ai.ask).toHaveBeenCalledTimes(1)
    expect(store.state.agent.ran.morning).toBe(TODAY)
    warn.mockRestore()
  })
})

describe('途中出狀況', () => {
  it('重排的請求沒連上：等退避過了再試同一個狀況（做完才記成處理過）', async () => {
    store.state.agent.ran.morning = TODAY
    store.addTask({ title: '寫報告', date: TODAY, at: '09:00', dur: 30 })
    at(10)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ai.ask = vi.fn(async () => {
      throw new AiError('offline')
    })
    await agent.tick()
    expect(ai.ask).toHaveBeenCalledTimes(1)
    at(10, 50)
    ai.ask = vi.fn(async () => blank({ say: '往後排了' }))
    await agent.tick()
    expect(ai.ask).toHaveBeenCalledTimes(1)
    expect(ai.ask.mock.calls[0][1].run).toBe('replan')
    // 這次做完了：同一個狀況不再叫
    at(11, 40)
    expect(agent.tick()).toBeNull()
    warn.mockRestore()
  })

  it('等回應的時候關掉了自己整理、或過了午夜：回來的安排不套用', async () => {
    const t = store.addTask({ title: '寫報告', date: TODAY })
    let reply
    const hang = () => new Promise((ok) => (reply = () => ok(blank({ say: '排好了', schedule: [{ id: 't1', date: TODAY, at: '10:00', dur: 30 }], add: [{ title: '多的', date: TODAY, at: '', dur: 30, tag: 'life', project: '', steps: [], star: false }] }))))
    ai.ask = vi.fn(hang)
    const p = agent.tick()
    store.setSetting('agentMode', 'off')
    agent.reset()
    reply()
    expect(await p).toBeNull()
    expect(t.at).toBeNull()
    expect(store.state.tasks).toHaveLength(1)
    expect(store.state.agent.ran.morning).toBe('')
    expect(notes).toEqual([])
    // 過了午夜才回來（store 還沒跨日的那一下也一樣）：不套用，也不算新的一天整理過了
    store.setSetting('agentMode', 'auto')
    at(22)
    store.addTask({ title: '明天的', date: addDays(TODAY, 1) })
    const q = agent.tick()
    expect(ai.ask.mock.calls[1][1].run).toBe('evening')
    vi.setSystemTime(new Date(2026, 10, 17, 0, 5))
    expect(store.today).toBe(TODAY)
    reply()
    expect(await q).toBeNull()
    expect(store.state.agent.ran.evening).toBe('')
    expect(store.state.tasks.map((x) => x.title)).toEqual(['寫報告', '明天的'])
  })

  it('別的分頁（或別台）在等回應的時候已經做完同一種整理：這邊的不再套用一次', async () => {
    const t = store.addTask({ title: '寫報告', date: TODAY })
    let reply
    ai.ask = vi.fn(() => new Promise((ok) => (reply = () => ok(blank({ add: [{ title: '重複加的', date: TODAY, at: '', dur: 30, tag: 'life', project: '', steps: [], star: false }] })))))
    const p = agent.tick()
    store.state.agent.ran.morning = TODAY
    reply()
    expect(await p).toBeNull()
    expect(store.state.tasks).toEqual([t])
  })

  it('先問我：等你決定的那一份重新整理後還在（只留今天的）', async () => {
    store.setSetting('agentMode', 'ask')
    const t = store.addTask({ title: '寫報告', date: TODAY })
    ai.ask = vi.fn(async (task, data) => blank({ say: '想這樣排', schedule: [{ id: data.days[0].tasks[0].id, date: TODAY, at: '10:00', dur: 50 }] }))
    await agent.tick()
    const again = createAgent(store, hooks())
    expect(again.pending).toMatchObject({ run: 'morning', say: '想這樣排', lines: ['「寫報告」排在今天 10:00'] })
    again.accept()
    expect(t.at).toBe('10:00')
    expect(createAgent(store, hooks()).pending).toBeNull()
    // 隔天：昨天沒決定的不留
    agent.dismiss()
    store.state.agent.ran.morning = ''
    t.at = null
    await agent.tick()
    expect(agent.pending).not.toBeNull()
    vi.setSystemTime(new Date(2026, 10, 17, 9))
    expect(createAgent(store, hooks()).pending).toBeNull()
    // 存著的那一份壞掉了：整份不要（裡面看起來正常的那一部分也不做）
    const saved = JSON.parse(localStorage.getItem('hiyori-agent')).pending
    const tag = t.tag
    saved.at = Date.now()
    saved.act.edit = [{ id: t.id, tag: 'work' }]
    saved.act.schedule = {}
    localStorage.setItem('hiyori-agent', JSON.stringify({ pending: saved }))
    const broken = createAgent(store, hooks())
    expect(broken.pending).toBeNull()
    const logged = store.state.agent.log.length
    expect(broken.accept()).toBeNull()
    expect(t.tag).toBe(tag)
    expect(store.state.agent.log).toHaveLength(logged)
  })

  it('先問我：開著沒決定就跨日了，昨天那一份自己收掉，不擋今天的整理，也不會套到今天', async () => {
    store.setSetting('agentMode', 'ask')
    const t = store.addTask({ title: '寫報告', date: TODAY })
    ai.ask = vi.fn(async (task, data) => blank({ say: '想這樣排', schedule: [{ id: (data.days[0].tasks[0] || data.overdue[0]).id, date: data.today, at: '10:00', dur: 50 }] }))
    await agent.tick()
    expect(agent.pending).not.toBeNull()
    vi.setSystemTime(new Date(2026, 10, 17, 9))
    store.tick()
    await agent.tick()
    // 昨天的收掉了，今天重新問了一次
    expect(ai.ask).toHaveBeenCalledTimes(2)
    expect(agent.pending.lines).toEqual(['「寫報告」排在今天 10:00'])
    vi.setSystemTime(new Date(2026, 10, 18, 9))
    expect(agent.accept()).toBeNull()
    expect(t.at).toBeNull()
  })
})

describe('剛加的任務', () => {
  beforeEach(() => {
    store.state.agent.ran.morning = TODAY
  })

  it('連續加的幾件等一下一起處理；ふじ自己加的、例行公事、太遠的日子不算', async () => {
    ai.ask = vi.fn(async (task, data) => blank({ say: '排進去了', schedule: data.new.map((id, i) => ({ id, date: TODAY, at: `1${i}:00`, dur: 30 })) }))
    const a = store.addTask({ title: '甲', date: TODAY })
    agent.added(a)
    vi.advanceTimersByTime(CAPTURE_WAIT - 1000)
    const b = store.addTask({ title: '乙', date: TODAY })
    agent.added(b)
    agent.added({ ...store.addTask({ title: '她加的', date: TODAY }), coach: 'a-x1' })
    agent.added({ ...store.addTask({ title: '例行', date: TODAY }), routineId: 'r1' })
    agent.added(store.addTask({ title: '下個月', date: addDays(TODAY, 30) }))
    vi.advanceTimersByTime(CAPTURE_WAIT - 1000)
    expect(ai.ask).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500)
    await vi.waitFor(() => expect(notes).toHaveLength(1))
    expect(ai.ask).toHaveBeenCalledTimes(1)
    const data = ai.ask.mock.calls[0][1]
    expect(data.run).toBe('capture')
    expect(data.new).toHaveLength(2)
    expect([a.at, b.at]).toEqual(['10:00', '11:00'])
    expect(notes[0].run).toBe('capture')
  })

  it('離線時加的任務留著，連上之後才處理；請求失敗的也放回去再試', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const a = store.addTask({ title: '甲', date: TODAY })
    agent.added(a)
    vi.advanceTimersByTime(CAPTURE_WAIT + CAPTURE_RETRY * 2)
    expect(ai.ask).not.toHaveBeenCalled()
    vi.stubGlobal('navigator', { onLine: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ai.ask = vi.fn(async () => {
      throw new AiError('offline')
    })
    vi.advanceTimersByTime(CAPTURE_RETRY + 100)
    await vi.waitFor(() => expect(ai.ask).toHaveBeenCalledTimes(1))
    // 退避的十分鐘過了再試，這次成功
    ai.ask = vi.fn(async (task, data) => blank({ schedule: [{ id: data.new[0], date: TODAY, at: '11:00', dur: 30 }] }))
    await vi.advanceTimersByTimeAsync(11 * 60000)
    expect(ai.ask).toHaveBeenCalledTimes(1)
    expect(ai.ask.mock.calls[0][1].new).toHaveLength(1)
    expect(a.at).toBe('11:00')
    warn.mockRestore()
  })

  it('跟自己整理走同一條路：先等同步；別的分頁正在整理（拿不到鎖）就放回去等一下再試', async () => {
    let held = true
    const request = vi.fn((name, opts, fn) => Promise.resolve(fn(held ? null : {})))
    vi.stubGlobal('navigator', { onLine: true, locks: { request } })
    const settle = vi.fn(async () => {})
    agent = createAgent(store, { ...hooks(), settle })
    const a = store.addTask({ title: '甲', date: TODAY })
    agent.added(a)
    await vi.advanceTimersByTimeAsync(CAPTURE_WAIT + 100)
    expect(settle).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('hiyori-agent', { ifAvailable: true }, expect.any(Function))
    expect(ai.ask).not.toHaveBeenCalled()
    held = false
    await vi.advanceTimersByTimeAsync(CAPTURE_RETRY + 100)
    expect(ai.ask).toHaveBeenCalledTimes(1)
    expect(ai.ask.mock.calls[0][1].new).toHaveLength(1)
  })

  it('還在打字就先等；等的時候做完或刪掉的不送', async () => {
    let typing = true
    agent = createAgent(store, { ...hooks(), busy: () => typing })
    const a = store.addTask({ title: '甲', date: TODAY })
    const b = store.addTask({ title: '乙', date: TODAY })
    agent.added(a)
    agent.added(b)
    vi.advanceTimersByTime(CAPTURE_WAIT * 2)
    expect(ai.ask).not.toHaveBeenCalled()
    store.toggleTask(a.id)
    typing = false
    vi.advanceTimersByTime(CAPTURE_WAIT + 100)
    await vi.waitFor(() => expect(ai.ask).toHaveBeenCalledTimes(1))
    expect(ai.ask.mock.calls[0][1].new).toHaveLength(1)
  })
})

describe('對話', () => {
  it('說一句：帶著前面的對話送出去，回的話和做的事記下來；對話留在這台裝置', async () => {
    ai.ask = vi.fn(async (task, data) => (data.message === '嗨' ? blank({ say: '在。要排今天還是這週？', ask: ['排今天', '排這週'] }) : blank({ say: '記好了', events: [{ title: '看牙醫', date: addDays(TODAY, 1), start: '15:00', end: '16:00' }] })))
    const first = await agent.say('嗨')
    expect(first).toMatchObject({ who: 'fuji', text: '在。要排今天還是這週？', ask: ['排今天', '排這週'] })
    const r = await agent.say('明天三點看牙醫')
    expect(ai.ask.mock.calls[1][1]).toMatchObject({ run: 'chat', message: '明天三點看牙醫' })
    expect(ai.ask.mock.calls[1][1].history).toEqual([{ who: 'user', text: '嗨' }, { who: 'fuji', text: '在。要排今天還是這週？' }])
    expect(store.state.events.map((e) => e.title)).toEqual(['看牙醫'])
    expect(r.entry).toBe(store.state.agent.log.at(-1).id)
    // 對話的結果不另外跳提示（畫面上就看得到）
    expect(notes).toEqual([])
    expect(createAgent(store, hooks()).chat.map((m) => m.text)).toEqual(['嗨', '在。要排今天還是這週？', '明天三點看牙醫', '記好了'])
    agent.clearChat()
    expect(createAgent(store, hooks()).chat).toEqual([])
  })

  it('關掉自己整理也能對話；出錯時回一句原因', async () => {
    store.setSetting('agentMode', 'off')
    ai.ask = vi.fn(async () => {
      throw new AiError('Claude 現在很忙')
    })
    const r = await agent.say('排今天')
    expect(r).toMatchObject({ who: 'fuji', failed: true, text: 'Claude 現在很忙' })
    expect(agent.chat).toHaveLength(2)
    expect(await agent.say('   ')).toBeNull()
  })

  it('正在自己整理時說話：等它做完才送', async () => {
    store.addTask({ title: '寫報告', date: TODAY })
    let done
    ai.ask = vi.fn(() => new Promise((ok) => (done = () => ok(blank({ say: '早上排好了' })))))
    const t = agent.tick()
    expect(agent.thinking).toBe('morning')
    const said = agent.say('嗨')
    await Promise.resolve()
    expect(ai.ask).toHaveBeenCalledTimes(1)
    ai.ask = vi.fn(async () => blank({ say: '在' }))
    done()
    await t
    expect((await said).text).toBe('在')
  })
})
