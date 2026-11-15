import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/store.js'
import { Reminders } from '../src/reminders.js'
import { MOTTO_MAX, MOTTO_LEN, MOTTO_ROTATE, MOTTO_EVERY, MOTTO_LATE, PLAN_MAX, PAUSE_MAX, activeMottos, awake, mottoAt, nextMotto, windowEnd, planMottos, planUntil, planKey, pauseText, pauseUntil, pausedUntil } from '../src/mottos.js'
import { nativeMottos, sendMottos, nativeMottoHandled, nativeMottoClaim, nativeMottoSeen, nativeTakeAct, nativeAway, nativeBack, nativeAwayLocked } from '../src/native.js'

const at = (h, m = 0, d = 25) => new Date(2026, 9, d, h, m)
let store

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(at(9))
  localStorage.clear()
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], player: {} }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('警語：寫、改、收著、刪', () => {
  it('加進去：前後空白和換行整理掉、太長的截斷；空的、一樣的、到上限的不加', () => {
    const m = store.addMotto('  先做最重要的\n那一件  ')
    expect(m).toMatchObject({ text: '先做最重要的 那一件', on: true })
    expect(store.addMotto('先做最重要的 那一件')).toBeNull()
    expect(store.addMotto('   ')).toBeNull()
    expect(store.addMotto('字'.repeat(100)).text).toHaveLength(MOTTO_LEN)
    for (let i = store.state.mottos.length; i < MOTTO_MAX; i++) store.addMotto(`第 ${i} 句`)
    expect(store.state.mottos).toHaveLength(MOTTO_MAX)
    expect(store.addMotto('再一句')).toBeNull()
  })

  it('改字、先收著再拿出來、刪掉；新增時發 mottoAdded', () => {
    const added = vi.fn()
    store.on('mottoAdded', added)
    const m = store.addMotto('完成比完美重要')
    expect(added).toHaveBeenCalledWith(expect.objectContaining({ text: '完成比完美重要' }))
    expect(store.updateMotto(m.id, '完成比完美更重要')).toBe(true)
    expect(store.updateMotto(m.id, '  ')).toBe(false)
    store.toggleMotto(m.id)
    expect(store.state.mottos[0]).toMatchObject({ text: '完成比完美更重要', on: false })
    expect(activeMottos(store.state.mottos)).toEqual([])
    store.toggleMotto(m.id)
    store.deleteMotto(m.id)
    expect(store.state.mottos).toEqual([])
  })

  it('匯出匯入後都在；壞掉的資料清掉；提醒間隔不合法的用預設', () => {
    store.addMotto('手機放遠一點')
    store.toggleMotto(store.addMotto('別跟別人比').id)
    store.setSetting('mottoEvery', 120)
    store.importJSON(store.exportJSON())
    expect(store.state.mottos.map((m) => [m.text, m.on])).toEqual([['手機放遠一點', true], ['別跟別人比', false]])
    expect(store.state.settings.mottoEvery).toBe(120)
    store.importJSON(JSON.stringify({ tasks: [], player: {}, mottos: [null, 3, { text: '' }, { text: '<b>好</b>' }, { id: 'x', text: 'ok', on: 'no' }], settings: { mottoEvery: 7 } }))
    expect(store.state.mottos.map((m) => [m.text, m.on])).toEqual([['<b>好</b>', true], ['ok', true]])
    expect(store.state.settings.mottoEvery).toBe(60)
  })

  it('很容易分心的話可以 10／15／20 分鐘提醒一次，匯出匯入後還在', () => {
    expect(MOTTO_EVERY).toEqual(expect.arrayContaining([10, 15, 20, 30, 60, 120, 180]))
    store.setSetting('mottoEvery', 15)
    store.importJSON(store.exportJSON())
    expect(store.state.settings.mottoEvery).toBe(15)
  })
})

describe('提醒排在什麼時候', () => {
  const r = { wake: '07:00', sleep: '23:30' }
  const late = { wake: '09:00', sleep: '01:00' }
  it('上一則過一個間隔；碰到睡覺的時間就等起床後一個間隔（不會一起床就響）', () => {
    expect(nextMotto(+at(10), 15, r)).toBe(+at(10, 15))
    expect(nextMotto(+at(23, 20), 15, r)).toBe(+at(7, 15, 26))
    expect(nextMotto(+at(22), 180, r)).toBe(+at(10, 0, 26))
    // 就寢在午夜後：午夜到 01:00 還醒著
    expect(nextMotto(+at(0, 30, 26), 15, late)).toBe(+at(0, 45, 26))
    expect(nextMotto(+at(0, 50, 26), 15, late)).toBe(+at(9, 15, 26))
    // 第一次記在睡覺的時間（半夜剛寫下第一句）：起床後一個間隔
    expect(nextMotto(+at(2), 30, r)).toBe(+at(7, 30))
  })

  it('排到明天就寢：過了就寢還沒睡時打開，明天是日曆上的下一天；快起床時打開，是今天和明天', () => {
    const r3 = { wake: '07:00', sleep: '23:00' }
    expect(planUntil(r3, +at(10))).toBe(+at(23, 0, 26))
    expect(planUntil(r3, +at(23, 45))).toBe(+at(23, 0, 26))
    expect(planUntil(r3, +at(2, 0, 26))).toBe(+at(23, 0, 26))
    expect(planUntil(r3, +at(6, 0, 26))).toBe(+at(23, 0, 27))
    // 每小時一則，23:45 打開：最後一則是明天 22:00（不會多排一天）
    const plan = planMottos([{ id: 'a', text: 'A', on: true }], 60, r3, { at: +at(22), i: 0 }, +at(23, 45))
    expect(plan[0].at).toBe(+at(8, 0, 26))
    expect(plan.at(-1).at).toBe(+at(22, 0, 26))
  })

  it('交給手機的那一串什麼時候重排：排到幾點變了也算（過了睡覺時間的一半，「明天」換成下一天）', () => {
    const r3 = { wake: '07:00', sleep: '23:00' }
    const base = { every: 60, rhythm: r3, mottos: [{ id: 'a', text: 'A', on: true }], last: { at: +at(22), i: 0 } }
    expect(planKey({ ...base, now: +at(23, 45) })).toBe(planKey({ ...base, now: +at(2, 0, 26) }))
    expect(planKey({ ...base, now: +at(23, 45) })).not.toBe(planKey({ ...base, now: +at(6, 0, 26) }))
    expect(planKey({ ...base, now: +at(10) })).not.toBe(planKey({ ...base, now: +at(10), mottos: [{ id: 'a', text: 'A', on: false }] }))
    expect(planKey({ ...base, now: +at(10) })).not.toBe(planKey({ ...base, now: +at(10), quietUntil: +at(10, 25) }))
    expect(planKey({ ...base, now: +at(10) })).not.toBe(planKey({ ...base, now: +at(10), task: '寫報告' }))
  })

  it('作息幾乎整天醒著、每 10 分鐘：一直排到明天就寢，不會被上限截掉', () => {
    const r4 = { wake: '00:00', sleep: '23:59' }
    const plan = planMottos([{ id: 'a', text: 'A', on: true }], 10, r4, { at: +at(0, 0), i: 0 }, +at(0, 0))
    expect(plan.length).toBeLessThanOrEqual(PLAN_MAX)
    expect(plan.at(-1).at).toBe(+at(23, 50, 26))
  })

  it('剛到點、還沒處理的那一則可以留在交給手機的那一串裡（since 比現在早），太久以前的不留', () => {
    const plan = planMottos([{ id: 'a', text: 'A', on: true }], 30, r, { at: +at(9), i: 0 }, +at(10, 5), { since: +at(10, 5) - MOTTO_LATE })
    expect(plan[0].at).toBe(+at(10))
    expect(planMottos([{ id: 'a', text: 'A', on: true }], 30, r, { at: +at(9), i: 0 }, +at(10, 5))[0].at).toBe(+at(10, 30))
  })

  it('夏令時間回撥那天（同一個鐘點有兩次）：第二次的還沒到就是那一次，不會跳到隔天', () => {
    const tz = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      const late = { wake: '07:00', sleep: '01:30' }
      // 2026/11/1 凌晨 2 點撥回 1 點：第二次的 01:00（EST）還醒著，這一段到第二次的 01:30 結束
      expect(windowEnd(late, Date.parse('2026-11-01T01:00:00-05:00'))).toBe(Date.parse('2026-11-01T01:30:00-05:00'))
      // 第一次的 01:00（EDT）：照樣是第一次的 01:30
      expect(windowEnd(late, Date.parse('2026-11-01T01:00:00-04:00'))).toBe(Date.parse('2026-11-01T01:30:00-04:00'))
      // 只撥回半小時的地方（澳洲豪勳爵島，2026/4/5 凌晨 2 點撥回 1:30）
      process.env.TZ = 'Australia/Lord_Howe'
      const howe = { wake: '07:00', sleep: '01:45' }
      expect(windowEnd(howe, Date.parse('2026-04-05T01:35:00+10:30'))).toBe(Date.parse('2026-04-05T01:45:00+10:30'))
      // 沒有夏令時間的地方照舊
      process.env.TZ = 'Asia/Taipei'
      expect(windowEnd(howe, Date.parse('2026-04-05T01:35:00+08:00'))).toBe(Date.parse('2026-04-05T01:45:00+08:00'))
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })

  it('醒著的這一段幾點結束：睡覺時看接下來那一段；就寢在午夜後算到隔天', () => {
    expect(windowEnd(r, +at(10))).toBe(+at(23, 30))
    expect(windowEnd(r, +at(2))).toBe(+at(23, 30))
    expect(windowEnd(r, +at(23, 45))).toBe(+at(23, 30, 26))
    expect(windowEnd(late, +at(23))).toBe(+at(1, 0, 26))
    expect(windowEnd(late, +at(0, 30, 26))).toBe(+at(1, 0, 26))
    expect(windowEnd(late, +at(3, 0, 26))).toBe(+at(1, 0, 27))
  })

  it('交給手機的那一串：排到明天就寢，一句一句輪流，已經過去的和專注中的不排（那一句照樣輪過去）', () => {
    const list = [{ id: 'a', text: 'A', on: true }, { id: 'b', text: 'B', on: false }, { id: 'c', text: 'C', on: true }]
    const plan = planMottos(list, 60, r, { at: +at(9), i: 0 }, +at(9, 30))
    expect(plan[0]).toEqual({ at: +at(10), text: 'A' })
    expect(plan[1]).toEqual({ at: +at(11), text: 'C' })
    // 今天 10:00～23:00 共 14 則，明天 08:00～23:00 共 16 則；後天的不排
    expect(plan).toHaveLength(30)
    expect(plan.at(-1).at).toBe(+at(23, 0, 26))
    expect(plan.find((p) => p.at === +at(8, 0, 26))).toBeTruthy()
    expect(plan.every((p) => awake(r, new Date(p.at).getHours() * 60 + new Date(p.at).getMinutes()))).toBe(true)
    // 專注到 11:30：10:00、11:00 不排，12:00 輪到的還是第三句（A）
    const quiet = planMottos(list, 60, r, { at: +at(9), i: 0 }, +at(9, 30), { quietUntil: +at(11, 30) })
    expect(quiet[0]).toEqual({ at: +at(12), text: 'A' })
    // 上一則是很久以前（App 關著時手機一則一則通知過了）：從現在以後的排起，輪到的句子接得上
    const back = planMottos(list, 60, r, { at: +at(9), i: 0 }, +at(13, 10))
    expect(back.slice(0, 2)).toEqual([{ at: +at(14), text: 'A' }, { at: +at(15), text: 'C' }])
    expect(planMottos(list, 0, r, { at: +at(9), i: 0 }, +at(9))).toEqual([])
    expect(planMottos([], 60, r, { at: +at(9), i: 0 }, +at(9))).toEqual([])
    expect(planMottos(list, 60, r, null, +at(9))).toEqual([])
  })

  it('頁面一直開著時念的時間、念的句子，跟一開始交給手機的那一串一模一樣', () => {
    store.addMotto('一')
    store.addMotto('二')
    store.addMotto('三')
    store.setSetting('mottoEvery', 20)
    const got = []
    const rem = new Reminders(store, (m, min, kind) => kind === 'motto' && got.push({ at: Date.now(), text: m.text }))
    rem.check(new Date())
    const plan = rem.mottoPlan(Date.now())
    // 每分鐘檢查一次，跑到明天就寢
    for (let t = Date.now() + 60000; t <= +at(23, 30, 26); t += 60000) {
      vi.setSystemTime(t)
      rem.check(new Date(t))
    }
    expect(got.length).toBeGreaterThan(80)
    expect(got).toEqual(plan)
  })
})

describe('輪流與醒著的時間', () => {
  const list = [{ id: 'a', text: 'A', on: true }, { id: 'b', text: 'B', on: false }, { id: 'c', text: 'C', on: true }]
  it('每 15 分鐘換一句，只輪拿出來的；按下一句往後一句', () => {
    const t0 = new Date(2026, 9, 25, 9, 0).getTime()
    const a = mottoAt(list, t0)
    const b = mottoAt(list, t0 + MOTTO_ROTATE * 60000)
    expect(a).not.toBe(b)
    expect([a.text, b.text].sort()).toEqual(['A', 'C'])
    expect(mottoAt(list, t0, 1)).toBe(b)
    expect(mottoAt([], t0)).toBeNull()
    expect(mottoAt([{ id: 'x', text: 'X', on: false }], t0)).toBeNull()
  })
  it('醒著：起床到就寢；就寢在午夜後也算得對', () => {
    const r = { wake: '07:00', sleep: '23:30' }
    expect(awake(r, 6 * 60 + 59)).toBe(false)
    expect(awake(r, 7 * 60)).toBe(true)
    expect(awake(r, 23 * 60 + 30)).toBe(false)
    const late = { wake: '09:00', sleep: '01:00' }
    expect(awake(late, 30)).toBe(true)
    expect(awake(late, 2 * 60)).toBe(false)
    expect(awake(late, 23 * 60)).toBe(true)
  })
})

describe('定時提醒', () => {
  const mottoCalls = (cb) => cb.mock.calls.filter((c) => c[2] === 'motto')
  it('第一次從現在開始算；每隔設定的時間提醒一句，一句一句輪流', () => {
    store.addMotto('一')
    store.addMotto('二')
    const cb = vi.fn()
    const r = new Reminders(store, cb)
    r.check(at(9))
    r.check(at(9, 59))
    expect(mottoCalls(cb)).toHaveLength(0)
    r.check(at(10))
    r.check(at(10, 30))
    r.check(at(11))
    expect(mottoCalls(cb).map((c) => c[0].text)).toEqual(['一', '二'])
  })

  it('重新整理、另一個分頁接著算，不會一打開就響；睡覺的時間不響', () => {
    store.addMotto('一')
    const cb = vi.fn()
    new Reminders(store, cb).check(at(9))
    new Reminders(store, cb).check(at(9, 30))
    expect(mottoCalls(cb)).toHaveLength(0)
    new Reminders(store, cb).check(at(10, 1))
    expect(mottoCalls(cb)).toHaveLength(1)
    // 半夜（作息預設 23:30 就寢）：再久也不響；起床後第一次檢查接著提醒
    const r = new Reminders(store, cb)
    r.check(at(2, 0, 26))
    expect(mottoCalls(cb)).toHaveLength(1)
    r.check(at(8, 0, 26))
    expect(mottoCalls(cb)).toHaveLength(2)
  })

  it('關掉、全部收著、一句都沒有時不響；存不進去時也不會每秒響', () => {
    const cb = vi.fn()
    const r = new Reminders(store, cb)
    r.check(at(9))
    r.check(at(12))
    expect(mottoCalls(cb)).toHaveLength(0)
    const m = store.addMotto('一')
    store.setSetting('mottoEvery', 0)
    r.check(at(13))
    r.check(at(15))
    store.setSetting('mottoEvery', 30)
    store.toggleMotto(m.id)
    r.check(at(16))
    expect(mottoCalls(cb)).toHaveLength(0)
    store.toggleMotto(m.id)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const s = new Reminders(store, cb)
    s.check(at(17))
    for (let i = 0; i < 5; i++) s.check(new Date(2026, 9, 25, 17, 31, i))
    expect(mottoCalls(cb)).toHaveLength(1)
  })

  it('頁面睡著時錯過好幾則：醒來只念最近的那一則，之後照原本的時間接下去', () => {
    store.addMotto('一')
    store.addMotto('二')
    store.addMotto('三')
    store.setSetting('mottoEvery', 30)
    const cb = vi.fn()
    const r = new Reminders(store, cb)
    r.check(at(9))
    // 9:30、10:00、10:30 都錯過了，10:40 醒來：念 10:30 那一則（第三句）
    r.check(at(10, 40))
    expect(mottoCalls(cb).map((c) => c[0].text)).toEqual(['三'])
    expect(r.mottoState()).toEqual({ at: +at(10, 30), i: 3 })
    r.check(at(10, 59))
    r.check(at(11))
    expect(mottoCalls(cb).map((c) => c[0].text)).toEqual(['三', '一'])
  })

  it('改成不提醒（或警語全部收著）一陣子後再打開：從打開的時候開始算，不會接著以前的時間、一打開就響', () => {
    const m = store.addMotto('一')
    store.setSetting('mottoEvery', 60)
    const cb = vi.fn()
    const r = new Reminders(store, cb)
    r.check(at(9))
    r.check(at(10))
    expect(mottoCalls(cb)).toHaveLength(1)
    // 10:05 改成不提醒，15:20 再打開：不補 15:00 那一則，16:20 才提醒
    store.setSetting('mottoEvery', 0)
    r.check(at(10, 5))
    expect(r.mottoState().off).toBe(true)
    store.setSetting('mottoEvery', 60)
    r.check(at(15, 20))
    r.check(at(16, 19))
    expect(mottoCalls(cb)).toHaveLength(1)
    r.check(at(16, 20))
    expect(mottoCalls(cb)).toHaveLength(2)
    // 全部收著再拿出來（另一個分頁重新整理也一樣）
    store.toggleMotto(m.id)
    new Reminders(store, cb).check(at(16, 30))
    store.toggleMotto(m.id)
    const again = new Reminders(store, cb)
    again.check(at(18, 45))
    expect(mottoCalls(cb)).toHaveLength(2)
    again.check(at(19, 45))
    expect(mottoCalls(cb)).toHaveLength(3)
  })

  it('好幾天沒打開：從現在重新算，不一打開就響', () => {
    store.addMotto('一')
    const cb = vi.fn()
    new Reminders(store, cb).check(at(9))
    const r = new Reminders(store, cb)
    r.check(at(9, 0, 29))
    expect(mottoCalls(cb)).toHaveLength(0)
    expect(r.mottoState().at).toBe(+at(9, 0, 29))
  })
})

describe('先停一下', () => {
  const mottoCalls = (cb) => cb.mock.calls.filter((c) => c[2] === 'motto')
  const r = { wake: '07:00', sleep: '23:30' }
  const sec = (h, m, s, d = 25) => +new Date(2026, 9, d, h, m, s)
  const list = [{ id: 'a', text: 'A', on: true }, { id: 'b', text: 'B', on: true }, { id: 'c', text: 'C', on: true }]

  it('先停 1 小時、今天先停（停到就寢）各停到幾點；睡覺的時間裡沒有「今天先停」', () => {
    expect(pauseUntil('hour', r, +at(10))).toBe(+at(11))
    expect(pauseUntil('today', r, +at(10))).toBe(+at(23, 30))
    expect(pauseUntil('today', r, +at(2))).toBeNull()
    expect(pauseUntil('week', r, +at(10))).toBeNull()
    expect(pausedUntil({ mottoPause: +at(11) }, +at(10))).toBe(+at(11))
    expect(pausedUntil({ mottoPause: +at(11) }, +at(11))).toBe(0)
    expect(pausedUntil({}, +at(10))).toBe(0)
    expect(pauseText(+at(11, 5), +at(10))).toBe('11:05')
    expect(pauseText(+at(1, 0, 26), +at(23))).toBe('明天 01:00')
  })

  it('停著的時候到點的不排；停的那段跳過了一則，停完那一刻補一則，之後從那裡照間隔接下去', () => {
    // 9:30 念完 A，9:30:05 按「先停 1 小時」：10:00（B）、10:30（C）跳過，10:30:05 補一則（輪到 A），之後 11:00:05…
    const from = sec(9, 30, 5)
    const until = sec(10, 30, 5)
    const pause = { from, until }
    const plan = planMottos(list, 30, r, { at: +at(9, 30), i: 1 }, from, { pause })
    expect(plan.slice(0, 3)).toEqual([{ at: until, text: 'A' }, { at: sec(11, 0, 5), text: 'B' }, { at: sec(11, 30, 5), text: 'C' }])
    // 每 3 小時：停的那一小時本來就沒有要提醒的，照原本的 12:30（不會因為停了反而提早）
    expect(planMottos(list, 180, r, { at: +at(9, 30), i: 1 }, from, { pause })[0]).toEqual({ at: +at(12, 30), text: 'B' })
    // 停到就寢（今天先停）：停完的那一刻在睡覺，不補，明天起床後一個間隔照常
    expect(planMottos(list, 30, r, { at: +at(9, 30), i: 1 }, from, { pause: { from, until: +at(23, 30) } })[0].at).toBe(+at(7, 30, 26))
    // 停到的那一刻剛好就是到點的時間：那一則照常，不重複補
    expect(planMottos(list, 30, r, { at: +at(9, 30), i: 1 }, from, { pause: { from, until: +at(10, 30) } }).slice(0, 2).map((p) => p.at)).toEqual([+at(10, 30), +at(11)])
    // 上一則就是停著時跳過的（頁面記著 skip）：從那裡接著算，補的還是同一個時間
    expect(planMottos(list, 30, r, { at: +at(10, 30), i: 3, skip: true }, sec(10, 30, 1), { pause })[0]).toEqual({ at: until, text: 'A' })
    // 開始停之前到點的照常（還沒跟上的那幾則不算跳過）：從 7:00 那一則算起，9:00 開始停到 10:00 → 8:00 照常、9:30 跳過、10:00 補
    const early = planMottos([list[0]], 30, r, { at: +at(7), i: 0 }, +at(7, 40), { pause: { from: +at(9), until: +at(10) }, since: +at(7) })
    expect(early.slice(0, 5).map((p) => p.at)).toEqual([+at(7, 30), +at(8), +at(8, 30), +at(10), +at(10, 30)])
    // 剛加這個功能時存的（沒記從幾點開始停）：當成一直停著到 until
    expect(planMottos(list, 30, r, { at: +at(9, 30), i: 1 }, from, { pause: { until } })[0]).toEqual({ at: until, text: 'A' })
    // 重排的時機也看從幾點開始停、停到幾點、是不是提早恢復的
    const key = (p) => planKey({ every: 30, rhythm: r, mottos: list, last: { at: +at(9, 30), i: 1 }, pause: p, now: +at(9, 31) })
    expect(key(pause)).not.toBe(key(null))
    expect(key({ ...pause, cut: true })).not.toBe(key(pause))
    expect(key({ ...pause, from: from + 1 })).not.toBe(key(pause))
  })

  it('頁面一直開著：停著的時候不念，停完那一刻念一則；念的時間、句子跟按下去那時交出去的那一串一樣（中途重新整理也一樣）', () => {
    store.addMotto('一')
    store.addMotto('二')
    store.addMotto('三')
    store.setSetting('mottoEvery', 20)
    const got = []
    const say = (m, min, kind) => kind === 'motto' && got.push({ at: Date.now(), text: m.text })
    let rem = new Reminders(store, say)
    rem.check(new Date())
    vi.setSystemTime(at(9, 20))
    rem.check(new Date())
    expect(got.map((g) => g.text)).toEqual(['一'])
    // 9:20:30 先停 1 小時：停到 10:20:30（9:40、10:00、10:20 跳過）
    vi.setSystemTime(sec(9, 20, 30))
    expect(store.pauseMottos(pauseUntil('hour', store.state.rhythm, Date.now()))).toBe(true)
    const plan = rem.mottoPlan(Date.now())
    expect(plan[0]).toEqual({ at: sec(10, 20, 30), text: '二' })
    for (let t = Date.now() + 30000; t <= +at(23, 30, 26); t += 30000) {
      vi.setSystemTime(t)
      // 10:05 重新整理：記著的那一則是停著時跳過的，接著算
      if (t === +at(10, 5)) {
        expect(rem.mottoState()).toEqual({ at: +at(10), i: 3, skip: true })
        rem = new Reminders(store, say)
      }
      rem.check(new Date(t))
    }
    expect(got.slice(1)).toEqual(plan)
  })

  it('按了「現在就恢復」：照原本的間隔提醒（不補）；沒在停又按恢復不用存', () => {
    store.addMotto('一')
    store.setSetting('mottoEvery', 30)
    const cb = vi.fn()
    const rem = new Reminders(store, cb)
    rem.check(at(9))
    vi.setSystemTime(at(9, 10))
    store.pauseMottos(+at(10, 10))
    vi.setSystemTime(at(9, 30))
    rem.check(at(9, 30))
    expect(mottoCalls(cb)).toHaveLength(0)
    expect(store.pauseMottos(0)).toBe(true)
    // 停到的時間改成按下去的那一刻，記著是提早恢復的
    expect(store.state.settings).toMatchObject({ mottoPause: +at(9, 30), mottoPauseCut: true })
    vi.setSystemTime(at(10))
    rem.check(at(10))
    expect(mottoCalls(cb)).toHaveLength(1)
    expect(store.pauseMottos(0)).toBe(false)
    // 再停一次：不再算提早恢復的
    store.pauseMottos(+at(11))
    expect(store.state.settings).toMatchObject({ mottoPause: +at(11), mottoPauseCut: false })
  })

  it('停著的時候頁面睡著、醒來先按恢復：停著時到點的那幾則不會補念，也不會交給手機', () => {
    store.addMotto('一')
    store.addMotto('二')
    store.setSetting('mottoEvery', 30)
    const cb = vi.fn()
    const rem = new Reminders(store, cb)
    rem.check(at(9))
    // 9:10 停到 11:10；頁面睡到 10:05，醒來還沒檢查就先按了恢復
    vi.setSystemTime(at(9, 10))
    store.pauseMottos(+at(11, 10))
    vi.setSystemTime(at(10, 5))
    store.pauseMottos(0)
    // 交給手機的那一串（剛到點的 10 分鐘內那一則也會留著）：9:30、10:00 不在裡面，10:30 起照常，句子照樣輪過去
    const plan = rem.mottoPlan(Date.now(), { since: Date.now() - MOTTO_LATE })
    expect(plan.slice(0, 2)).toEqual([{ at: +at(10, 30), text: '一' }, { at: +at(11), text: '二' }])
    rem.check(at(10, 5))
    vi.setSystemTime(at(10, 10))
    rem.check(at(10, 10))
    expect(mottoCalls(cb)).toHaveLength(0)
    vi.setSystemTime(at(10, 30))
    rem.check(at(10, 30))
    expect(mottoCalls(cb).map((c) => c[0].text)).toEqual(['一'])
    // 提早恢復的也照這樣排（同步到別台時也一樣）：停的那段跳過了也不補
    const list2 = [{ id: 'a', text: 'A', on: true }]
    const stop = { from: +at(9, 10), until: +at(10, 5) }
    expect(planMottos(list2, 30, r, { at: +at(9), i: 0 }, +at(10, 5), { pause: { ...stop, cut: true }, since: +at(10, 5) - MOTTO_LATE })[0].at).toBe(+at(10, 30))
    expect(planMottos(list2, 30, r, { at: +at(9), i: 0 }, +at(10, 5), { pause: stop, since: +at(10, 5) - MOTTO_LATE })[0].at).toBe(+at(10, 5))
    expect(store.state.settings.mottoPauseFrom).toBe(+at(9, 10))
  })

  it('跟著存檔：發 mottoPause、太遠的截到一天多；匯出匯入後還在；壞掉的、遠在以後的當成沒停，已經過了的留著', () => {
    const got = vi.fn()
    store.on('mottoPause', got)
    expect(store.pauseMottos(+at(10))).toBe(true)
    expect(got).toHaveBeenLastCalledWith(+at(10))
    expect(store.pauseMottos(+at(10))).toBe(false)
    store.importJSON(store.exportJSON())
    expect(store.state.settings.mottoPause).toBe(+at(10))
    store.pauseMottos(Date.now() + 5 * 86400000)
    expect(store.state.settings.mottoPause).toBe(Date.now() + PAUSE_MAX)
    const load = (mottoPause) => {
      store.importJSON(JSON.stringify({ tasks: [], player: {}, settings: { mottoPause } }))
      return store.state.settings.mottoPause
    }
    expect(load(Date.now() + 9 * 86400000)).toBe(0)
    expect(load('x')).toBe(0)
    expect(load(-5)).toBe(0)
    expect(load(+at(8))).toBe(+at(8))
    // 從幾點開始停：跟著存檔；比停到的時間還晚的（壞掉的）當成沒記
    store.importJSON(JSON.stringify({ tasks: [], player: {}, settings: { mottoPause: +at(11), mottoPauseFrom: +at(9, 30) } }))
    expect(store.state.settings).toMatchObject({ mottoPause: +at(11), mottoPauseFrom: +at(9, 30) })
    store.importJSON(store.exportJSON())
    expect(store.state.settings.mottoPauseFrom).toBe(+at(9, 30))
    store.importJSON(JSON.stringify({ tasks: [], player: {}, settings: { mottoPause: +at(11), mottoPauseFrom: +at(12) } }))
    expect(store.state.settings.mottoPauseFrom).toBe(0)
    store.importJSON(JSON.stringify({ tasks: [], player: {}, settings: { mottoPause: +at(8) } }))
    // 停到的時間已經過了：恢復不用存、也不發
    got.mockClear()
    expect(store.pauseMottos(0)).toBe(false)
    expect(got).not.toHaveBeenCalled()
  })
})

describe('警語交給手機排（Android 殼）', () => {
  const mottoCalls = (cb) => cb.mock.calls.filter((c) => c[2] === 'motto')
  const LATE = MOTTO_LATE
  // 照 android/…/MottoNotice.java 的規則寫的假殼：記著「念到哪一則了」（handled），App 在前面時不發、
  // 頁面要念之前先 claim、離開 App 時（away）補發到點還沒處理的、晚 10 分鐘以上的不發
  const makeShell = () => ({
    items: [],
    handled: 0,
    posted: [],
    fg: true,
    // 念到哪一則了：記的時間遠在未來（時鐘被往回調過）就清掉
    get(now) {
      if (this.handled > now + LATE) this.handled = 0
      return this.handled
    },
    keep(cutoff) {
      this.items = this.items.filter((x) => x.at > cutoff)
    },
    plan(items, now) {
      this.items = items.map((x) => ({ ...x }))
      this.keep(Math.max(this.get(now), now - LATE))
    },
    // 鬧鐘：排在最早那一則（App 在前面時已經到點的不排）
    alarm(now) {
      const ats = this.items.filter((x) => !(x.at <= now && this.fg)).map((x) => x.at)
      return ats.length ? Math.min(...ats) : null
    },
    check(now) {
      const h = this.get(now)
      if (!this.fg) {
        const due = this.items.filter((x) => x.at > h && x.at <= now + 1000).at(-1)
        if (due) {
          this.handled = due.at
          if (now - due.at < LATE) this.posted.push(due.at)
        }
      }
      this.keep(Math.max(this.handled, now - LATE))
    },
    // App 剛好不在前面了（onPause 先拿到鎖）：改由手機現在發，回傳 false。
    // 記下頁面剛念的這一則：念完 2 秒內就離開 App 的話，離開時用通知再發一次
    claim(at, now) {
      if (at <= this.get(now)) return false
      if (!this.fg) {
        this.check(now)
        if (at <= this.handled) return false
      }
      this.handled = at
      this.claimed = this.items.some((x) => x.at === at) ? { at, wall: now } : null
      this.keep(Math.max(at, now - LATE))
      return true
    },
    // 離開 App（onPause）
    away(now) {
      this.check(now)
      const c = this.claimed
      this.claimed = null
      if (c && now - c.wall < 2000 && now - c.at < LATE) this.posted.push(c.at)
    },
    // 使用者按了頁面念的那一則提示卡上的按鈕（看到了）
    seen() {
      this.claimed = null
    },
  })
  const setup = (shell) => {
    store.addMotto('一')
    store.addMotto('二')
    store.setSetting('mottoEvery', 30)
    const cb = vi.fn()
    const r = new Reminders(store, cb, {
      external: () => true,
      hidden: () => !shell.fg,
      handled: () => shell.get(Date.now()),
      claim: (t) => shell.claim(t, Date.now()),
    })
    r.check(at(9))
    return { cb, r }
  }
  // 頁面把那一串交給手機（main.js 的 syncMottos：since 會問手機念到哪）
  const send = (r, shell, now) => shell.plan(r.mottoPlan(now, { since: Math.max(now - LATE, shell.get(now)) }), now)

  it('頁面在背景時到點：頁面不念、也不往後記（交給手機的那一串還留著那一則），手機通知過了才往後記', () => {
    const shell = makeShell()
    const { cb, r } = setup(shell)
    send(r, shell, +at(9))
    shell.fg = false
    vi.setSystemTime(at(9, 30))
    // 頁面（App 在背景、JavaScript 還在跑）比手機的鬧鐘先檢查到：不念，重送的那一串還留著 9:30
    r.check(at(9, 30))
    send(r, shell, +at(9, 30))
    expect(mottoCalls(cb)).toHaveLength(0)
    expect(shell.items[0].at).toBe(+at(9, 30))
    // 鬧鐘接著響：手機通知；頁面看到手機通知過了，往後記
    shell.check(+at(9, 30))
    expect(shell.posted).toEqual([+at(9, 30)])
    r.check(new Date(2026, 9, 25, 9, 30, 1))
    expect(r.mottoState()).toEqual({ at: +at(9, 30), i: 1 })
    expect(mottoCalls(cb)).toHaveLength(0)
  })

  it('看著 App 時到點：手機不發，頁面先 claim 再念；手機先通知了的，回到 App 時不再念', () => {
    const shell = makeShell()
    const { cb, r } = setup(shell)
    send(r, shell, +at(9))
    // 9:30 看著 App：手機的鬧鐘在前面不發，頁面念
    vi.setSystemTime(at(9, 30))
    shell.check(+at(9, 30))
    r.check(at(9, 30))
    expect(mottoCalls(cb).map((c) => c[0].text)).toEqual(['一'])
    expect(shell.posted).toEqual([])
    expect(shell.handled).toBe(+at(9, 30))
    // 10:00 時在背景：手機通知；10:00:05 回到 App，頁面不再念同一則
    send(r, shell, +at(9, 30))
    shell.fg = false
    vi.setSystemTime(at(10))
    shell.check(+at(10))
    shell.fg = true
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 5))
    r.check(new Date(2026, 9, 25, 10, 0, 5))
    expect(shell.posted).toEqual([+at(10)])
    expect(mottoCalls(cb)).toHaveLength(1)
    // 10:30 的鬧鐘晚了（省電），10:30:20 回到 App：手機還沒通知，頁面念；之後鬧鐘響了也不再發
    send(r, shell, +at(10))
    vi.setSystemTime(new Date(2026, 9, 25, 10, 30, 20))
    r.check(new Date(2026, 9, 25, 10, 30, 20))
    vi.setSystemTime(at(10, 31))
    shell.check(+at(10, 31))
    expect(mottoCalls(cb).map((c) => c[0].text)).toEqual(['一', '一'])
    expect(shell.posted).toEqual([+at(10)])
  })

  it('頁面念這一則的時候剛好離開 App：不管離開時手機先檢查、頁面先說一聲、還是說完的同時才離開，手機都會發這一則', () => {
    for (const order of ['awayFirst', 'claimFirst', 'claimThenLeave']) {
      localStorage.clear()
      store.importJSON(JSON.stringify({ tasks: [], player: {} }))
      const shell = makeShell()
      const { cb, r } = setup(shell)
      send(r, shell, +at(9))
      vi.setSystemTime(at(9, 30))
      shell.check(+at(9, 30))
      // 頁面看到 App 在前面之後，馬上離開 App（onPause 把 foreground 設成 false，再看要不要補發）
      r.hidden = () => {
        if (order !== 'claimThenLeave') shell.fg = false
        if (order === 'awayFirst') shell.away(+at(9, 30))
        return false
      }
      // 手機確認完「App 在前面」、頁面說完這一聲的同時才離開
      const claim = r.claim
      r.claim = (t) => {
        const ok = claim(t)
        if (order === 'claimThenLeave') shell.fg = false
        return ok
      }
      r.check(at(9, 30))
      if (order !== 'awayFirst') shell.away(+at(9, 30))
      expect(shell.posted).toEqual([+at(9, 30)])
      // 頁面念的那一次是在背景（使用者看不到），所以手機補發
      expect(mottoCalls(cb)).toHaveLength(order === 'claimThenLeave' ? 1 : 0)
      expect(r.mottoState()).toEqual({ at: +at(9, 30), i: 1 })
    }
  })

  it('看著 App 時念完、過了一會兒才離開：手機不再發同一則', () => {
    const shell = makeShell()
    const { cb, r } = setup(shell)
    send(r, shell, +at(9))
    vi.setSystemTime(at(9, 30))
    r.check(at(9, 30))
    expect(mottoCalls(cb)).toHaveLength(1)
    shell.fg = false
    shell.away(new Date(2026, 9, 25, 9, 30, 5).getTime())
    expect(shell.posted).toEqual([])
  })

  it('剛寫下第一句就離開 App：交給手機之前先定好從現在開始算，那一串不會是空的', () => {
    store.setSetting('mottoEvery', 15)
    const r = new Reminders(store, () => {}, { external: () => true })
    store.addMotto('一')
    expect(r.mottoPlan(+at(9))).toEqual([])
    expect(r.startMotto(+at(9))).toBe(true)
    expect(r.startMotto(+at(9))).toBe(false)
    expect(r.mottoPlan(+at(9))[0]).toEqual({ at: +at(9, 15), text: '一' })
  })

  it('時鐘被往回調很多：手機記的「念到哪」清掉、頁面從現在重新算，之後的照常提醒（不會走到原本的時間附近又被擋）', () => {
    const shell = makeShell()
    const { cb, r } = setup(shell)
    store.setSetting('mottoEvery', 10)
    // 13:00 看著 App：頁面念、手機記下念到 13:00
    vi.setSystemTime(at(13))
    r.check(at(13))
    expect(mottoCalls(cb)).toHaveLength(1)
    expect(shell.handled).toBe(+at(13))
    vi.setSystemTime(at(12, 40))
    r.check(at(12, 40))
    // 頁面重送那一串時問了手機念到哪：13:00 遠在未來，清掉
    send(r, shell, +at(12, 40))
    expect(shell.handled).toBe(0)
    vi.setSystemTime(at(12, 50))
    r.check(at(12, 50))
    expect(mottoCalls(cb)).toHaveLength(2)
  })

  it('看著 App、頁面還沒念就離開：離開的那一刻手機補發', () => {
    const shell = makeShell()
    const { cb, r } = setup(shell)
    send(r, shell, +at(9))
    // 9:30 的鬧鐘響時在前面（不發），頁面還沒檢查就離開了
    shell.check(+at(9, 30))
    shell.fg = false
    shell.check(new Date(2026, 9, 25, 9, 30, 0, 300).getTime())
    expect(shell.posted).toEqual([+at(9, 30)])
    r.check(new Date(2026, 9, 25, 9, 30, 1))
    expect(mottoCalls(cb)).toHaveLength(0)
  })

  it('頁面念完、馬上在提示卡上按「先停 1 小時」就離開 App：看到了，手機不再用通知發剛才那一則', () => {
    const shell = makeShell()
    const { cb, r } = setup(shell)
    send(r, shell, +at(9))
    vi.setSystemTime(at(9, 30))
    r.check(at(9, 30))
    expect(mottoCalls(cb)).toHaveLength(1)
    // 沒按任何東西、1 秒內就離開：手機用通知再發一次（多半沒看到提示卡）
    const other = makeShell()
    other.plan([{ at: +at(9, 30), title: 'ひより · 給自己的警語', body: '一' }], +at(9))
    other.claim(+at(9, 30), +at(9, 30))
    other.fg = false
    other.away(+at(9, 30) + 1000)
    expect(other.posted).toEqual([+at(9, 30)])
    // 按了提示卡上的「先停 1 小時」（main.js 先跟殼說看到了）：離開時不再發
    nativeMottoSeen({ mottoSeen: () => shell.seen() })
    vi.setSystemTime(+at(9, 30) + 500)
    store.pauseMottos(Date.now() + 3600000)
    send(r, shell, Date.now())
    shell.fg = false
    shell.away(+at(9, 30) + 1000)
    expect(shell.posted).toEqual([])
    // 舊版的殼沒有 mottoSeen：不會出錯
    expect(() => nativeMottoSeen({})).not.toThrow()
    expect(() => nativeMottoSeen({ mottoSeen: () => { throw new Error('x') } })).not.toThrow() // prettier-ignore
  })

  it('手機通知過了、頁面還沒跟上，從通知上按「先停 1 小時」：那一則不算跳過；停的那段沒有要提醒的，照原本的時間（不會提早補）', () => {
    store.addMotto('一')
    store.setSetting('mottoEvery', 180)
    const shell = makeShell()
    const cb = vi.fn()
    const r = new Reminders(store, cb, { external: () => true, hidden: () => !shell.fg, handled: () => shell.get(Date.now()), claim: (t) => shell.claim(t, Date.now()) })
    vi.setSystemTime(at(7))
    r.check(at(7))
    send(r, shell, +at(7))
    // App 不在前面（頁面睡著）：10:00 手機通知
    shell.fg = false
    shell.check(+at(10))
    expect(shell.posted).toEqual([+at(10)])
    // 10:01 從通知上按「先停 1 小時」：App 打開，頁面先停到 11:01，才跟上
    vi.setSystemTime(at(10, 1))
    shell.fg = true
    store.pauseMottos(Date.now() + 3600000)
    r.check(at(10, 1))
    expect(mottoCalls(cb)).toHaveLength(0)
    expect(r.mottoState()).toEqual({ at: +at(10), i: 1 })
    send(r, shell, Date.now())
    expect(shell.items.slice(0, 2).map((x) => x.at)).toEqual([+at(13), +at(16)])
  })

  it('先停一下：交給手機的那一串不排停著的時間，停完那一刻手機補一則；頁面在前面、在背景都不念停著時到點的', () => {
    const shell = makeShell()
    const { cb, r } = setup(shell)
    const sec = (h, m, s) => +new Date(2026, 9, 25, h, m, s)
    // 9:00:20 先停 1 小時（停到 10:00:20）：9:30、10:00 跳過，10:00:20 補一則
    vi.setSystemTime(sec(9, 0, 20))
    store.pauseMottos(Date.now() + 3600000)
    send(r, shell, Date.now())
    expect(shell.items[0].at).toBe(sec(10, 0, 20))
    expect(shell.items[1].at).toBe(sec(10, 30, 20))
    // App 在前面：9:30 到點不念
    vi.setSystemTime(at(9, 30))
    r.check(at(9, 30))
    expect(mottoCalls(cb)).toHaveLength(0)
    // 離開 App：10:00 手機不發，10:00:20 發
    shell.fg = false
    shell.away(+at(9, 31))
    vi.setSystemTime(at(10))
    shell.check(+at(10))
    r.check(at(10))
    expect(shell.posted).toEqual([])
    vi.setSystemTime(sec(10, 0, 20))
    shell.check(sec(10, 0, 20))
    expect(shell.posted).toEqual([sec(10, 0, 20)])
    // 回到 App：頁面不再念那一則；之後照 10:30:20 接下去
    shell.fg = true
    vi.setSystemTime(at(10, 1))
    r.check(at(10, 1))
    expect(mottoCalls(cb)).toHaveLength(0)
    vi.setSystemTime(sec(10, 30, 20))
    r.check(new Date(sec(10, 30, 20)))
    expect(mottoCalls(cb)).toHaveLength(1)
  })

  it('模擬一天半：App 在前面、在背景（JavaScript 還在跑）、整個睡著之間切來切去，每一則都剛好念一次', () => {
    store.addMotto('一')
    store.addMotto('二')
    store.addMotto('三')
    store.setSetting('mottoEvery', 15)
    const shell = makeShell()
    const spoken = []
    // 頁面念了、但那時 App 已經不在前面（使用者看不到）
    const unseen = []
    let mode = 'visible'
    // 頁面剛判斷「App 在前面」之後馬上離開 App：onPause 在頁面跟手機說之前（awayFirst）或之後才檢查
    let leaveNext = null
    let pendingAway = false
    const leave = () => {
      mode = 'hidden'
      shell.fg = false
      leaveNext = null
    }
    const r = new Reminders(store, (m, min, kind) => kind === 'motto' && (shell.fg ? spoken : unseen).push(Date.now()), {
      external: () => true,
      hidden: () => {
        const h = !shell.fg
        if (!h && (leaveNext === 'awayFirst' || leaveNext === 'claimFirst')) {
          const first = leaveNext === 'awayFirst'
          leave()
          if (first) shell.away(Date.now())
          else pendingAway = true
        }
        return h
      },
      handled: () => shell.get(Date.now()),
      claim: (t) => {
        const ok = shell.claim(t, Date.now())
        // 手機確認完「App 在前面」、頁面說完這一聲的同時才離開
        if (leaveNext === 'claimThenLeave') {
          leave()
          pendingAway = true
        }
        return ok
      },
    })
    // 固定的亂數（mulberry32）：每次跑都一樣
    let seed = 7
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    let sig = ''
    const pageRuns = () => mode !== 'frozen'
    const start = +at(9)
    r.check(new Date(start))
    const expected = []
    for (let t = nextMotto(start, 15, store.state.rhythm); t < +at(21, 0, 26); t = nextMotto(t, 15, store.state.rhythm)) expected.push(t)
    for (let now = start; now < +at(21, 0, 26); now += 20000) {
      vi.setSystemTime(now)
      // 偶爾換一種狀態；離開 App 的那一刻手機檢查一次（onPause）
      if (rand() < 0.02) {
        const next = ['visible', 'hidden', 'frozen'][Math.floor(rand() * 3)]
        const wasFg = shell.fg
        mode = next
        shell.fg = next === 'visible'
        if (wasFg && !shell.fg) shell.away(now)
      }
      if (rand() < 0.01) leaveNext = ['awayFirst', 'claimFirst', 'claimThenLeave'][Math.floor(rand() * 3)]
      const page = () => {
        if (!pageRuns()) return
        r.check(new Date(now))
        // 頁面先跟手機說了，onPause 的檢查才輪到
        if (pendingAway) {
          pendingAway = false
          shell.away(now)
        }
        const st = r.mottoState()
        const s2 = `${st?.at}:${st?.i}`
        if (s2 !== sig) {
          sig = s2
          send(r, shell, now)
        }
      }
      const alarm = () => {
        const a = shell.alarm(now)
        if (a != null && a <= now) shell.check(now)
      }
      if (rand() < 0.5) {
        page()
        alarm()
      } else {
        alarm()
        page()
      }
    }
    // 頁面念的時間是檢查到的那一刻（最晚晚 20 秒）：換成那一則排的時間再比
    const slotOf = (x) => expected.filter((t) => t <= x).at(-1)
    // 使用者看得到的：App 在前面時頁面念的、手機通知的。每一則剛好一次
    const got = [...spoken.map(slotOf), ...shell.posted].sort((a, b) => a - b)
    expect(new Set(got).size).toBe(got.length)
    expect(got).toEqual(expected)
    // 頁面在使用者看不到時念的（說完的同時離開 App），手機都另外通知了
    for (const x of unseen) expect(shell.posted).toContain(slotOf(x))
    // 兩邊都真的念過不少則（亂數讓三種狀態都出現過），三種離開的時機也都碰到過
    expect(spoken.length).toBeGreaterThan(5)
    expect(shell.posted.length).toBeGreaterThan(5)
    expect(unseen.length).toBeGreaterThan(0)
  })

  it('交給殼的內容：新版的殼才有、沒變就不重送、送失敗回 false', () => {
    expect(nativeMottos(null)).toBe(false)
    expect(nativeMottos({ notify() {} })).toBe(false)
    const bridge = { mottos: vi.fn() }
    expect(nativeMottos(bridge)).toBe(true)
    const items = [{ at: +at(10), title: 'ひより · 給自己的警語', body: '一' }]
    expect(sendMottos(items, bridge)).toBe(true)
    expect(sendMottos(items, bridge)).toBe(true)
    expect(bridge.mottos).toHaveBeenCalledTimes(1)
    expect(JSON.parse(bridge.mottos.mock.calls[0][0])).toEqual({ items })
    expect(sendMottos([], bridge)).toBe(true)
    expect(bridge.mottos).toHaveBeenLastCalledWith('')
    const broken = { mottos: () => { throw new Error('bridge gone') } }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(sendMottos(items, broken)).toBe(false)
    expect(sendMottos([], { mottos() {} })).toBe(true)
  })

  it('問殼念到哪一則、頁面要念時先說一聲、App 在不在前面：問不到時不擋頁面', () => {
    const fail = () => {
      throw new Error('bridge gone')
    }
    expect(nativeMottoHandled({ mottoHandled: () => 1234 })).toBe(1234)
    expect(nativeMottoHandled({ mottoHandled: fail })).toBe(0)
    expect(nativeMottoHandled(null)).toBe(0)
    expect(nativeMottoClaim(5, { mottoClaim: () => false })).toBe(false)
    expect(nativeMottoClaim(5, { mottoClaim: () => true })).toBe(true)
    expect(nativeMottoClaim(5, { mottoClaim: fail })).toBe(true)
    expect(nativeMottoClaim(5, null)).toBe(true)
    expect(nativeAway({ foreground: () => false })).toBe(true)
    expect(nativeAway({ foreground: () => true })).toBe(false)
    expect(nativeAway({ foreground: fail })).toBe(false)
    expect(nativeAway(null)).toBe(false)
  })

  it('按了手機通知上的哪一顆按鈕：只認開始專注、先停 1 小時；舊版的殼、問不到時是沒有', () => {
    expect(nativeTakeAct({ takeAct: () => 'pause' })).toBe('pause')
    expect(nativeTakeAct({ takeAct: () => 'focus' })).toBe('focus')
    expect(nativeTakeAct({ takeAct: () => '' })).toBe('')
    expect(nativeTakeAct({ takeAct: () => 'rm -rf' })).toBe('')
    expect(nativeTakeAct({ takeAct: () => null })).toBe('')
    expect(nativeTakeAct({ takeAct: () => { throw new Error('gone') } })).toBe('') // prettier-ignore
    expect(nativeTakeAct({})).toBe('')
    expect(nativeTakeAct(null)).toBe('')
  })

  it('上一次離開 App 時手機鎖著嗎：新版的殼（4 起）才分得出來；舊版的殼、問不到時是 null（不算中途離開、也不排叫你回來的那一則）', () => {
    expect(nativeBack({ awayLocked: () => false })).toBe(true)
    expect(nativeBack({ foreground: () => true })).toBe(false)
    expect(nativeBack(null)).toBe(false)
    expect(nativeAwayLocked({ awayLocked: () => true })).toBe(true)
    expect(nativeAwayLocked({ awayLocked: () => false })).toBe(false)
    expect(nativeAwayLocked({ awayLocked: () => { throw new Error('gone') } })).toBeNull() // prettier-ignore
    expect(nativeAwayLocked({})).toBeNull()
    expect(nativeAwayLocked(null)).toBeNull()
  })
})
