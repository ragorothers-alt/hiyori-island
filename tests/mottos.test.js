import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/store.js'
import { Reminders } from '../src/reminders.js'
import { MOTTO_MAX, MOTTO_LEN, MOTTO_ROTATE, MOTTO_EVERY, MOTTO_LATE, PLAN_MAX, activeMottos, awake, mottoAt, nextMotto, windowEnd, planMottos, planUntil, planKey } from '../src/mottos.js'
import { nativeMottos, sendMottos, nativeMottoHandled, nativeMottoClaim, nativeAway } from '../src/native.js'

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
})
