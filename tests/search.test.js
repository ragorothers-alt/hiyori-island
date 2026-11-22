import { describe, expect, it } from 'vitest'
import { searchAll, LIMIT } from '../src/search.js'

const TODAY = '2026-11-22'
const task = (o) => ({ id: o.title, date: TODAY, done: false, subs: [], note: '', ...o })

describe('找找看（searchAll）', () => {
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
})
