import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/store.js'
import { Reminders } from '../src/reminders.js'
import { MOTTO_MAX, MOTTO_LEN, MOTTO_ROTATE, activeMottos, awake, mottoAt } from '../src/mottos.js'

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
})
