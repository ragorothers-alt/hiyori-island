import { describe, it, expect } from 'vitest'
import { DEFAULT_RHYTHM } from '../src/planner.js'
import { SLOTS, scopeDates, slotText, defaultSlots, parseCoachText, guessTag, planRules, askCoach } from '../src/coach.js'

const R = { ...DEFAULT_RHYTHM, buffer: 10 }
// 2026-10-26 是星期一
const MON = '2026-10-26'
const THU = '2026-10-29'
const SUN = '2026-11-01'
const m = (s) => +s.slice(0, 2) * 60 + +s.slice(3)
const week = scopeDates('rest', MON)
const req = (o = {}) => ({
  dates: week,
  focus: [{ label: '數學', tag: 'study' }, { label: '英文', tag: 'study' }],
  slots: ['wdEve', 'weMorning', 'weAfternoon'],
  exam: null,
  days: 5,
  len: 50,
  seed: 0,
  ...o,
  ctx: { today: MON, nowMin: null, rhythm: R, events: [], tasks: [], ...o.ctx },
})
const all = (res) => res.days.flatMap((d) => d.items.map((it) => ({ ...it, date: d.date })))

describe('範圍與時段', () => {
  it('這週剩下的天到星期天為止；星期天只剩今天；下週是一到日；指定那天就是那天', () => {
    expect(scopeDates('rest', THU)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(scopeDates('rest', SUN)).toEqual([SUN])
    expect(scopeDates('next', SUN)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
    expect(scopeDates('next', MON)[0]).toBe('2026-11-02')
    expect(scopeDates('day', MON, '2026-11-11')).toEqual(['2026-11-11'])
    expect(scopeDates('today', THU)).toEqual([THU])
  })

  it('時段照作息換算：平日晚上是晚餐後到睡前一小時，週末上午到午餐為止', () => {
    expect(slotText('wdEve', R)).toBe('19:30–22:30')
    expect(slotText('beforeBed', R)).toBe('22:30–23:30')
    expect(slotText('weMorning', R)).toBe('08:00–12:00')
    expect(slotText('wdMorning', R)).toBe('07:30–09:00')
    expect(slotText('weAfternoon', R)).toBe('13:00–18:30')
    expect(slotText('wdAfter', R)).toBe('18:00–20:00')
    expect(slotText('wdEve', { ...R, sleep: '01:00' })).toBe('19:30–23:00')
    expect(SLOTS).toHaveLength(8)
    expect(defaultSlots(R)).toContain('wdEve')
    expect(defaultSlots({ ...R, work: null })).toContain('wdMorning')
  })
})

describe('排程規則', () => {
  it('只排在選的時段裡，不壓到三餐、日程和已排的任務，前後留緩衝', () => {
    const events = [{ id: 'e', date: '2026-10-27', start: '19:30', end: '20:30', done: false }]
    const tasks = [{ id: 't', date: '2026-10-28', at: '19:30', dur: 60, priority: 2, done: false }]
    const res = planRules(req({ days: 7, ctx: { events, tasks } }))
    for (const it of all(res)) {
      const a = m(it.at)
      const b = a + it.dur
      const wd = new Date(it.date + 'T00:00:00').getDay()
      if (wd >= 1 && wd <= 5) expect(a >= m('19:30') && b <= m('22:30'), `${it.date} ${it.at}`).toBe(true)
      else expect((a >= m('08:00') && b <= m('12:00')) || (a >= m('13:00') && b <= m('18:30')), `${it.date} ${it.at}`).toBe(true)
      // 早餐 7:30–8:00
      expect(b <= m('07:30') || a >= m('08:00')).toBe(true)
      if (it.date === '2026-10-27') expect(a >= m('20:40')).toBe(true)
      if (it.date === '2026-10-28') expect(a >= m('20:40')).toBe(true)
    }
    // 同一天的兩段不重疊、中間留緩衝
    for (const d of res.days) {
      const s = d.items.map((it) => [m(it.at), m(it.at) + it.dur]).sort((x, y) => x[0] - y[0])
      for (let i = 1; i < s.length; i++) expect(s[i][0] - s[i - 1][1]).toBeGreaterThanOrEqual(10)
    }
  })

  it('今天從現在之後開始排，過去的時間不排', () => {
    const res = planRules(req({ dates: [MON], days: 7, ctx: { nowMin: m('20:12') } }))
    expect(all(res).length).toBeGreaterThan(0)
    for (const it of all(res)) expect(m(it.at)).toBeGreaterThanOrEqual(m('20:20'))
  })

  it('輕量 3 天、穩定 5 天、全力 7 天：一整週排的天數不同，輕量一天一段', () => {
    const next = scopeDates('next', MON)
    const r3 = planRules(req({ dates: next, days: 3 }))
    const r5 = planRules(req({ dates: next, days: 5 }))
    const r7 = planRules(req({ dates: next, days: 7 }))
    expect(r3.days).toHaveLength(3)
    expect(r5.days).toHaveLength(5)
    expect(r7.days).toHaveLength(7)
    expect(r3.days.every((d) => d.items.length === 1)).toBe(true)
    expect(r7.days.every((d) => d.items.length === 2)).toBe(true)
    // 輕量的 3 天要錯開，不擠在一起
    const idx = r3.days.map((d) => next.indexOf(d.date))
    expect(idx[1] - idx[0]).toBeGreaterThanOrEqual(2)
    expect(idx[2] - idx[1]).toBeGreaterThanOrEqual(2)
  })

  it('主攻項目輪流出現、同一天不重複，標題是「項目・階段」；專案用下一個里程碑', () => {
    const res = planRules(req({ dates: scopeDates('next', MON), days: 7, focus: [{ label: '數學', tag: 'study' }, { label: '官網改版', tag: 'work', milestone: '前端切版' }] }))
    const items = all(res)
    expect(items.filter((x) => x.label === '數學').length).toBe(7)
    expect(items.filter((x) => x.label === '官網改版').length).toBe(7)
    for (const d of res.days) expect(new Set(d.items.map((x) => x.label)).size).toBe(d.items.length)
    expect(items.find((x) => x.label === '數學').title).toMatch(/^數學・/)
    expect(items.find((x) => x.label === '官網改版').title).toBe('官網改版・前端切版')
  })

  it('考試：前一天一定排總複習，當天只排 15 分鐘，考前的學習項目優先度高', () => {
    const exam = { title: '期中考', date: '2026-11-05' }
    const res = planRules(req({ dates: scopeDates('next', MON), days: 3, exam }))
    const eve = res.days.find((d) => d.date === '2026-11-04')
    expect(eve).toBeTruthy()
    expect(eve.items.some((x) => /總複習|重點整理|最後確認|考前確認/.test(x.title))).toBe(true)
    const day = res.days.find((d) => d.date === exam.date)
    expect(day.items).toHaveLength(1)
    expect(day.items[0].dur).toBe(15)
    expect(all(res).filter((x) => x.date < exam.date).every((x) => x.priority === 3)).toBe(true)
    expect(res.notes.join()).toMatch(/期中考/)
  })

  it('專案的截止日只影響那個專案：前一天排收尾確認，其他項目照常', () => {
    const exam = { title: '官網改版', date: '2026-11-05', only: '官網改版' }
    const focus = [{ label: '數學', tag: 'study' }, { label: '官網改版', tag: 'work', milestone: '前端切版' }]
    const res = planRules(req({ dates: scopeDates('next', MON), days: 7, exam, focus }))
    const items = all(res)
    expect(items.filter((x) => x.label === '數學').every((x) => x.priority === 2 && !/總複習|模擬/.test(x.title))).toBe(true)
    const eve = items.find((x) => x.date === '2026-11-04' && x.label === '官網改版')
    expect(eve.title).toMatch(/最後確認|交付前檢查|收尾確認/)
    expect(items.find((x) => x.date === '2026-11-02' && x.label === '官網改版').title).toBe('官網改版・前端切版')
    // 沒有相關的主攻項目：當作沒有考試
    const none = planRules(req({ dates: scopeDates('next', MON), days: 3, exam }))
    expect(all(none).every((x) => x.priority === 2)).toBe(true)
    expect(none.notes.join()).not.toMatch(/官網改版/)
  })

  it('同一個 seed 結果相同，換 seed 會換排法', () => {
    const a = planRules(req({ dates: scopeDates('next', MON), days: 3 }))
    const b = planRules(req({ dates: scopeDates('next', MON), days: 3 }))
    expect(a).toEqual(b)
    const titles = (r) => all(r).map((x) => `${x.date} ${x.title}`).join('|')
    const others = [1, 2, 3, 4].map((seed) => titles(planRules(req({ dates: scopeDates('next', MON), days: 3, seed }))))
    expect(others.some((t) => t !== titles(a))).toBe(true)
  })

  it('寫了總時數：照總時數切成差不多長的幾段', () => {
    const res = planRules(req({ total: 180, len: 50, days: 7 }))
    const items = all(res)
    expect(items).toHaveLength(4)
    expect(items.reduce((a, x) => a + x.dur, 0)).toBe(180)
    const two = all(planRules(req({ dates: scopeDates('next', MON), total: 120, len: 25, days: 7 })))
    expect(two.map((x) => x.dur).sort()).toEqual([20, 25, 25, 25, 25])
  })

  it('時段塞不下：縮短成一半，還是不行就算進放不下的段數；完全沒空回傳空的', () => {
    // 睡前一小時只有 60 分鐘：要排三段 50 分，只放得下一段，其他縮成 25 也放不下（緩衝）
    const res = planRules(req({ dates: [MON], slots: ['beforeBed'], days: 7, len: 50, total: 150 }))
    expect(all(res)).toHaveLength(1)
    expect(res.unplaced).toBeGreaterThanOrEqual(1)
    const full = [{ id: 'e', date: MON, start: '19:00', end: '23:30', done: false }]
    const none = planRules(req({ dates: [MON], slots: ['wdEve'], ctx: { events: full } }))
    expect(none.days).toEqual([])
    expect(planRules(req({ focus: [] })).days).toEqual([])
  })

  it('askCoach 回傳和規則一樣的結果（之後換成 AI 的接點）', async () => {
    expect(await askCoach(req())).toEqual(planRules(req()))
  })
})

describe('一行輸入', () => {
  it('「這週的數學複習 3小時」：這週、總時數、主攻項目', () => {
    const p = parseCoachText('這週的數學複習 3小時', MON)
    expect(p).toMatchObject({ scope: 'rest', total: 180, focus: ['數學複習'] })
    expect(guessTag('數學複習')).toBe('study')
  })
  it('明天、下週、每段分鐘、#分類、好幾個項目', () => {
    expect(parseCoachText('明天排英文單字和物理 30分鐘', MON)).toMatchObject({ scope: 'day', date: '2026-10-27', len: 30, focus: ['英文單字', '物理'] })
    expect(parseCoachText('幫我排下週的簡報、報表 #工作', MON)).toMatchObject({ scope: 'next', tag: 'work', focus: ['簡報', '報表'] })
    expect(parseCoachText('', MON).focus).toEqual([])
    expect(guessTag('慢跑')).toBe('health')
    expect(guessTag('季報告')).toBe('work')
  })
})
