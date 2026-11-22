import { describe, expect, it } from 'vitest'
import { searchAll, LIMIT } from '../src/search.js'

const TODAY = '2026-11-22'
const task = (o) => ({ id: o.title, date: TODAY, done: false, subs: [], note: '', ...o })

describe('找找看（searchAll）', () => {
  it('再多看一頁可以找到被擠到後面的紀錄，加日期也能直接找到那天', () => {
    const life = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [
      `2026-10-${String(i + 1).padStart(2, '0')}`, { items: [{ id: String(i), text: '書店咖啡' }] },
    ]))
    life['2026-09-23'] = { items: [{ id: 'old', text: '書店咖啡' }] }
    life['2025-09-23'] = { items: [{ id: 'lastYear', text: '書店咖啡' }] }
    const find = (q, page = 1) => searchAll({ life }, q, { today: TODAY, page })
    expect(find('書店咖啡').life).toHaveLength(20)
    expect(find('書店咖啡', 2).life).toHaveLength(32)
    expect(find('書店咖啡 ９／２３').life.map((x) => x.item.id)).toEqual(['old', 'lastYear'])
    expect(find('2026-09-23').life.map((x) => x.item.id)).toEqual(['old'])
  })

  it('找設定列時也認得常用的說法，選到的是那一列的識別碼', () => {
    const settings = [
      { id: 'fontPick', title: '字體大小' },
      { id: 'syncRow', title: '資料夾同步' },
      { id: 'remindSetInfo', title: '日程提醒、系統通知' },
    ]
    for (const [q, id] of [['字級', 'fontPick'], ['資料夾同步', 'syncRow'], ['通知', 'remindSetInfo']]) {
      const r = searchAll({}, q, { today: TODAY, settings })
      expect(r.setting.map((x) => x.item.id)).toEqual([id])
      expect(r.total).toBe(1)
    }
  })

  it('哪一天的任務都找得到：還沒做的在前（逾期的、今天的、之後的照日期），做完的照完成時間新到舊；子任務、說明裡的也找，附上找到的那一段', () => {
    const state = {
      tasks: [
        task({ title: '報價單給陳小姐', date: '2026-11-10' }),
        task({ title: '整理報價單', date: '2026-12-01' }),
        task({ title: '舊的報價單', done: true, doneAt: 1, date: '2026-10-01' }),
        task({ title: '新的報價單', done: true, doneAt: 9, date: '2026-10-02' }),
        task({ title: '寄信', subs: [{ title: '附上報價單' }] }),
        task({ title: '開會', note: '帶報價單和名片' }),
        task({ title: '買牛奶' }),
      ],
    }
    const r = searchAll(state, '報價單', { today: TODAY })
    expect(r.task.map((x) => x.item.title)).toEqual(['報價單給陳小姐', '整理報價單', '寄信', '開會', '新的報價單', '舊的報價單'])
    expect(r.task.find((x) => x.item.title === '寄信').hit).toEqual({ kind: '子任務', text: '附上報價單' })
    expect(r.task.find((x) => x.item.title === '開會').hit.kind).toBe('說明')
    // 幾個字都要在同一件裡；不分全形半形、大小寫
    expect(searchAll(state, '報價 陳', { today: TODAY }).task.map((x) => x.item.title)).toEqual(['報價單給陳小姐'])
    expect(searchAll({ tasks: [task({ title: 'App 改版' })] }, 'ａｐｐ', { today: TODAY }).task).toHaveLength(1)
    expect(searchAll(state, '  ', { today: TODAY })).toBeNull()
  })

  it('日程：接下來的在前（越近越前），過去的新到舊；跨過午夜的兩段只列一次；匯入的行事曆也找', () => {
    const ev = (title, date, o = {}) => ({ id: `${title}${date}`, title, date, start: '10:00', end: '11:00', ...o })
    const state = {
      events: [
        ev('牙醫', '2026-11-01'),
        ev('牙醫', '2026-12-20'),
        ev('牙醫', '2026-11-25'),
        ev('牙醫', '2026-11-15'),
        ev('夜班', TODAY, { link: 'L' }),
        ev('夜班', '2026-11-23', { link: 'L', start: '00:00' }),
      ],
    }
    expect(searchAll(state, '牙醫', { today: TODAY }).event.map((x) => x.item.date)).toEqual(['2026-11-25', '2026-12-20', '2026-11-15', '2026-11-01'])
    expect(searchAll(state, '夜班', { today: TODAY }).event.map((x) => x.item.date)).toEqual([TODAY])
    // 存檔裡隔天那段排在前面（匯入、同步來的）：列的還是開始那天的那一段
    expect(searchAll({ events: [...state.events].reverse() }, '夜班', { today: TODAY }).event.map((x) => x.item.date)).toEqual([TODAY])
    const ext = [{ id: 'x', title: '牙醫（匯入）', date: '2026-11-30', start: '09:00', end: '10:00' }]
    expect(searchAll(state, '牙醫 匯入', { today: TODAY, external: ext }).event.map((x) => x.item.id)).toEqual(['x'])
  })

  it('專案（名稱、里程碑…）、生活記錄（新的在前）也找；每一類有上限，total 是全部找到的筆數', () => {
    const state = {
      projects: [{ id: 'p', name: '作品集', milestones: [{ id: 'm', title: '報價單範本', steps: [] }], notes: [], logs: [] }],
      life: {
        '2026-11-20': { items: [{ id: 'a', text: '報價單寄出', t: '09:00' }] },
        '2026-11-21': { items: [{ id: 'b', text: '報價單被退回', t: '10:00' }, { id: 'c', text: '報價單改好', t: '15:00' }] },
      },
      tasks: Array.from({ length: LIMIT.task + 5 }, (_, i) => task({ id: `t${i}`, title: `報價單 ${i}` })),
    }
    const r = searchAll(state, '報價單', { today: TODAY })
    expect(r.project.map((x) => [x.item.id, x.hit?.kind])).toEqual([['p', '里程碑']])
    expect(r.life.map((x) => x.item.id)).toEqual(['c', 'b', 'a'])
    expect(r.task).toHaveLength(LIMIT.task)
    expect(r.total).toBe(LIMIT.task + 5 + 1 + 3)
  })

  it('加日期找：好幾天的整天日程，中間和最後一天也算（寫不寫年份都行、跨年也行）', () => {
    const state = {
      events: [
        { id: 'trip', title: 'Trip', date: '2026-09-22', endDate: '2026-09-24', allDay: true, start: '00:00', end: '23:59' },
        { id: 'ny', title: 'Trip', date: '2026-12-30', endDate: '2027-01-02', allDay: true, start: '00:00', end: '23:59' },
      ],
    }
    const ids = (q) => searchAll(state, q, { today: TODAY }).event.map((x) => x.item.id)
    expect(ids('Trip 9/22')).toEqual(['trip'])
    expect(ids('Trip 9/23')).toEqual(['trip'])
    expect(ids('Trip 2026-09-24')).toEqual(['trip'])
    expect(ids('Trip 9/25')).toEqual([])
    expect(ids('Trip 1/1')).toEqual(['ny'])
    expect(ids('Trip 2027/1/2')).toEqual(['ny'])
    // 日曆上沒有的日子不當成日期（2/30、平年的 2/29）
    const feb = { events: [{ id: 'f', title: 'Camp', date: '2026-02-27', endDate: '2026-03-02', allDay: true, start: '00:00', end: '23:59' }] }
    expect(searchAll(feb, 'Camp 2/30', { today: TODAY }).event).toEqual([])
    expect(searchAll(feb, 'Camp 2026-02-29', { today: TODAY }).event).toEqual([])
    expect(searchAll(feb, 'Camp 2/28', { today: TODAY }).event.map((x) => x.item.id)).toEqual(['f'])
  })
})
