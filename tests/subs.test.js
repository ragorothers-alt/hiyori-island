// 訂閱：扣款日、月費換算、付了多少、整體合計（src/subs.js），以及 store 的新增、取消、重新訂閱、清洗
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chargeAt, chargesBetween, cycleLabel, fmtMoney, fmtTWD, looksLikeCardNumber, monthlyOf, nextCharge, paidCount, paidSoFar, subsSummary, toTWD,
} from '../src/subs.js'
import { guessCat } from '../src/data/subs.js'
import { Store } from '../src/store.js'

const sub = (o = {}) => ({ id: 's1', name: 'Netflix', price: 390, cur: 'TWD', every: 1, unit: 'month', start: '2026-01-15', trial: false, cat: 'video', remind: 1, status: 'active', end: '', paid0: 0, ...o })

describe('扣款日', () => {
  it('每月：照開始那天的日期；那個月沒有那一天就在月底', () => {
    const s = sub({ start: '2026-01-31' })
    expect([0, 1, 2, 3, 13].map((k) => chargeAt(s, k))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2027-02-28'])
    // 閏年的 2/29 每年扣：平年在 2/28
    const y = sub({ start: '2024-02-29', unit: 'year' })
    expect([1, 4].map((k) => chargeAt(y, k))).toEqual(['2025-02-28', '2028-02-29'])
    // 每 2 週、每 3 個月
    expect(chargeAt(sub({ start: '2026-11-06', unit: 'week', every: 2 }), 3)).toBe('2026-12-18')
    expect(chargeAt(sub({ start: '2026-11-30', every: 3 }), 1)).toBe('2027-02-28')
  })

  it('下次扣款：今天剛好扣款就是今天；還沒開始就是開始那天；取消了之後不再扣', () => {
    const s = sub()
    expect(nextCharge(s, '2026-01-01')).toBe('2026-01-15')
    expect(nextCharge(s, '2026-11-15')).toBe('2026-11-15')
    expect(nextCharge(s, '2026-11-16')).toBe('2026-12-15')
    const off = sub({ status: 'cancelled', end: '2026-12-15' })
    expect(nextCharge(off, '2026-11-16')).toBeNull()
    expect(nextCharge(off, '2026-11-14')).toBe('2026-11-15')
    expect(nextCharge(sub({ status: 'cancelled', end: '' }), '2026-11-14')).toBeNull()
  })

  it('一段期間裡的扣款日、到今天扣過幾次、付了多少', () => {
    const s = sub()
    expect(chargesBetween(s, '2026-11-01', '2027-01-31')).toEqual(['2026-11-15', '2026-12-15', '2027-01-15'])
    expect(chargesBetween(s, '2025-01-01', '2026-02-01')).toEqual(['2026-01-15'])
    expect(paidCount(s, '2026-01-14')).toBe(0)
    expect(paidCount(s, '2026-01-15')).toBe(1)
    expect(paidCount(s, '2026-11-06')).toBe(10)
    expect(paidSoFar({ ...s, paid0: 780 }, '2026-11-06')).toBe(390 * 10 + 780)
    // 取消了：end（不再扣款的那天）以後不算
    const off = sub({ status: 'cancelled', end: '2026-06-15' })
    expect(paidCount(off, '2026-11-06')).toBe(5)
    expect(chargesBetween(off, '2026-05-01', '2026-12-31')).toEqual(['2026-05-15'])
  })
})

describe('金額', () => {
  it('換算成每月、換成新台幣、寫法', () => {
    expect(monthlyOf(sub({ price: 1200, unit: 'year' }))).toBe(100)
    expect(monthlyOf(sub({ price: 300, every: 3 }))).toBe(100)
    expect(monthlyOf(sub({ price: 120, unit: 'week' }))).toBeCloseTo(520)
    expect(toTWD(20, 'USD', { USD: 32 })).toBe(640)
    expect(toTWD(20, 'USD', {})).toBe(620)
    expect(toTWD(100, 'TWD', { USD: 32 })).toBe(100)
    expect(fmtMoney(390)).toBe('NT$ 390')
    expect(fmtMoney(9.99, 'USD')).toBe('US$ 9.99')
    expect(fmtMoney(20, 'USD')).toBe('US$ 20')
    expect(fmtMoney(1200, 'JPY')).toBe('¥ 1,200')
    expect(fmtTWD(1234.6)).toBe('NT$ 1,235')
    expect(cycleLabel(sub())).toBe('每月')
    expect(cycleLabel(sub({ unit: 'week', every: 2 }))).toBe('每 2 週')
    expect(cycleLabel(sub({ unit: 'year' }))).toBe('每年')
  })

  it('付款方式看起來像卡號就不收；名稱對得上就猜分類', () => {
    expect(looksLikeCardNumber('4111 1111 1111 1111')).toBe(true)
    expect(looksLikeCardNumber('卡號 1234-5678-9012')).toBe(true)
    expect(looksLikeCardNumber('信用卡末四碼 1234')).toBe(false)
    expect(looksLikeCardNumber('Apple ID')).toBe(false)
    expect(guessCat('netflix')).toBe('video')
    expect(guessCat('Spot')).toBe('music')
    expect(guessCat('x')).toBeNull()
    expect(guessCat('我的服務')).toBeNull()
  })

  it('整體：每月／每年合計、這個月還要付、接下來的扣款、分類、取消了省下多少', () => {
    const list = [
      sub({ id: 'a', price: 390, start: '2026-01-15' }),
      sub({ id: 'b', name: 'ChatGPT', price: 20, cur: 'USD', cat: 'ai', start: '2026-03-08' }),
      sub({ id: 'c', name: 'iCloud', price: 1200, unit: 'year', cat: 'cloud', start: '2025-11-20' }),
      sub({ id: 'd', name: 'Disney+', price: 270, status: 'cancelled', end: '2026-10-01' }),
    ]
    const sum = subsSummary(list, '2026-11-06', { USD: 30 })
    expect(sum.count).toBe(3)
    expect(sum.monthly).toBeCloseTo(390 + 600 + 100)
    expect(sum.yearly).toBeCloseTo((390 + 600 + 100) * 12)
    // 這個月（11/6～11/30）：ChatGPT 11/8（US$20 × 30）、Netflix 11/15、iCloud 11/20；取消的 Disney+ 不算
    expect(sum.monthLeft).toBe(600 + 390 + 1200)
    // 30 天內：ChatGPT 下一次 12/8 是 32 天後，不列
    expect(sum.upcoming.map((u) => [u.sub.id, u.date, u.days])).toEqual([['b', '2026-11-08', 2], ['a', '2026-11-15', 9], ['c', '2026-11-20', 14]])
    expect(Object.keys(sum.byCat).sort()).toEqual(['ai', 'cloud', 'video'])
    expect(sum.saved).toBe(270)
    expect(sum.cancelled).toBe(1)
  })
})

describe('store：訂閱', () => {
  let store
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 6, 12))
    localStorage.clear()
    store = new Store()
    store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0, coins: 0 } }))
  })
  afterEach(() => vi.useRealTimers())

  it('新增：名稱和金額要有；欄位照規則清洗（卡號、不是 http 的網址不存）', () => {
    const onAdd = vi.fn()
    store.on('subAdded', onAdd)
    expect(store.addSubscription({ name: '', price: 100 })).toBeNull()
    expect(store.addSubscription({ name: 'X', price: '' })).toBeNull()
    expect(store.addSubscription({ name: 'X', price: -5 })).toBeNull()
    const s = store.addSubscription({
      name: '  Spotify  ', price: '149.004', cur: 'XXX', every: 99, unit: 'day', start: 'nope', cat: 'music', remind: 5,
      pay: '4111111111111111', url: 'javascript:alert(1)', note: 'n'.repeat(500),
    })
    expect(s).toMatchObject({ name: 'Spotify', price: 149, cur: 'TWD', every: 36, unit: 'month', start: '2026-11-06', cat: 'music', remind: 1, pay: '', url: '', status: 'active' })
    expect(s.note).toHaveLength(200)
    expect(onAdd).toHaveBeenCalledWith(s)
    const ok = store.addSubscription({ name: 'ChatGPT Plus', price: 20, cur: 'USD', pay: 'Apple ID', url: 'https://example.com/account', remind: -1 })
    expect(ok).toMatchObject({ pay: 'Apple ID', url: 'https://example.com/account', remind: -1, cur: 'USD' })
  })

  it('修改不能動狀態和付過的金額；取消後到下次扣款日前照樣算，重新訂閱時把之前付的記下來', () => {
    const s = store.addSubscription({ name: 'Netflix', price: 390, start: '2026-01-15' })
    expect(store.updateSubscription(s.id, { price: 420, status: 'cancelled', paid0: 99999, name: '' })).toBe(false)
    expect(store.updateSubscription(s.id, { price: 420, status: 'cancelled', paid0: 99999 })).toBe(true)
    expect(s).toMatchObject({ price: 420, status: 'active', paid0: 0 })
    const onCancel = vi.fn()
    store.on('subCancelled', onCancel)
    expect(store.cancelSubscription(s.id)).toBe(true)
    expect(s).toMatchObject({ status: 'cancelled', end: '2026-11-15' })
    expect(onCancel).toHaveBeenCalled()
    expect(store.cancelSubscription(s.id)).toBe(false)
    expect(store.subsSummary().count).toBe(0)
    expect(store.subsSummary().saved).toBe(420)
    // 還沒到期就反悔：照原本的扣款日繼續，什麼都不重算
    expect(store.resumeSubscription(s.id)).toBe('kept')
    expect(s).toMatchObject({ status: 'active', end: '', start: '2026-01-15', paid0: 0 })
    expect(store.cancelSubscription(s.id)).toBe(true)
    // 一個月後重新訂閱：之前那段（1/15～10/15 共 10 次，照現在的價格）記進 paid0，從今天重新算
    vi.setSystemTime(new Date(2026, 11, 20, 12))
    expect(store.resumeSubscription(s.id)).toBe('restart')
    expect(s).toMatchObject({ status: 'active', end: '', start: '2026-12-20', paid0: 4200 })
    expect(paidSoFar(s, '2026-12-20')).toBe(4200 + 420)
  })

  it('匯出匯入後都在；壞掉的資料讀進來時清掉；匯率可以改，不合理的用預設', () => {
    store.addSubscription({ name: 'iCloud+', price: 90, cat: 'cloud', pay: 'Apple ID' })
    store.addSubscription({ name: 'ChatGPT', price: 20, cur: 'USD' })
    expect(store.setSubRate('USD', '32.5')).toBe(true)
    expect(store.setSubRate('TWD', 2)).toBe(false)
    store.importJSON(store.exportJSON())
    expect(store.state.subscriptions.map((x) => x.name)).toEqual(['iCloud+', 'ChatGPT'])
    expect(store.state.subRates.USD).toBe(32.5)
    store.setSubRate('USD', -1)
    expect(store.state.subRates.USD).toBe(31)
    store.importJSON(JSON.stringify({ tasks: [], player: {}, subscriptions: [null, 5, { name: 'ok', price: 1 }, { name: '', price: 1 }, { name: 'bad', price: 'x' }], subRates: { USD: 'x', JPY: 0.2 } }))
    expect(store.state.subscriptions.map((x) => x.name)).toEqual(['ok'])
    expect(store.state.subRates).toMatchObject({ USD: 31, JPY: 0.2 })
  })

  it('哪天要扣款（日曆用）；該提醒的扣款：照提前天數，免費試用的第一次至少前 3 天', () => {
    const a = store.addSubscription({ name: 'A', price: 100, start: '2026-11-07', remind: 1 })
    store.addSubscription({ name: 'B', price: 100, start: '2026-11-09', remind: 1 })
    const t = store.addSubscription({ name: 'T', price: 100, start: '2026-11-09', remind: 1, trial: true })
    store.addSubscription({ name: 'Off', price: 100, start: '2026-11-07', remind: -1 })
    expect(store.subChargesOn('2026-11-07').map((x) => x.name)).toEqual(['A', 'Off'])
    expect(store.subChargesOn('2026-12-07').map((x) => x.name)).toEqual(['A', 'Off'])
    const r = store.subReminders()
    expect(r.map((x) => [x.sub.name, x.days, x.trial])).toEqual([['A', 1, false], ['T', 3, true]])
    // 取消 A：明天那筆本來就是下一次扣款，就此不再扣，也不再提醒
    store.cancelSubscription(a.id)
    expect(store.subscription(a.id).end).toBe('2026-11-07')
    expect(store.subReminders().map((x) => x.sub.name)).toEqual(['T'])
    expect(store.subChargesOn('2026-11-07').map((x) => x.name)).toEqual(['Off'])
    expect(t.trial).toBe(true)
  })
})
