// 打開 App 時貓咪說的今日摘要：資料 → 幾句話和清單（src/brief.js）
import { describe, expect, it } from 'vitest'
import { buildBrief } from '../src/brief.js'

const at = (h, m = 0) => new Date(2026, 10, 11, h, m)
const task = (title, o = {}) => ({ id: title, title, done: false, star: false, priority: 2, at: null, ...o })
const ev = (title, start, end) => ({ id: title, title, start, end })
const base = (o = {}) => ({ now: at(8, 20), tasks: [], overdue: 0, events: [], allDay: [], habits: { total: 0, done: 0 }, dates: [], subs: [], stuck: null, idle: null, streak: 0, ...o })

describe('今日摘要', () => {
  it('問候照時段，日期寫星期幾', () => {
    expect(buildBrief(base())).toMatchObject({ hello: 'にゃ、早安。', date: '11 月 11 日 星期三' })
    expect(buildBrief(base({ now: at(13) })).hello).toBe('にゃ、午安。')
    expect(buildBrief(base({ now: at(19) })).hello).toBe('にゃ、晚上好。')
    expect(buildBrief(base({ now: at(1, 30) })).hello).toBe('にゃ…這麼晚了。')
  })

  it('什麼都沒排：說一聲，提醒是空的，沒有「專注第一件」', () => {
    const b = buildBrief(base())
    expect(b.lead).toBe('今天還沒排任何事。想到什麼，先記一件就好。')
    expect(b.today).toEqual([])
    expect(b.alerts).toEqual([])
    expect(b.first).toBeNull()
    expect(b.bye).toBe('今天也慢慢來。')
  })

  it('第一句：幾件任務、幾個日程；做了一些、日程過了一些時照實說', () => {
    const tasks = [task('寫報告'), task('買菜'), task('回信')]
    const events = [ev('設計週會', '10:00', '11:00'), ev('牙醫', '15:30', '16:00')]
    expect(buildBrief(base({ tasks, events })).lead).toBe('今天有 3 件任務、2 個日程。')
    expect(buildBrief(base({ now: at(12), tasks: [task('寫報告', { done: true }), ...tasks.slice(1)], events })).lead).toBe('今天任務做完 1／3 件、還有 1 個日程。')
    expect(buildBrief(base({ now: at(20), tasks, events })).lead).toBe('今天有 3 件任務、日程都結束了。')
    expect(buildBrief(base({ now: at(20), tasks: tasks.map((t) => ({ ...t, done: true })), events })).lead).toBe('今天的 3 件任務都做完了，了不起。')
    expect(buildBrief(base({ allDay: [{ title: '朋友來玩' }] })).lead).toBe('今天有整天的日程「朋友來玩」。')
  })

  it('今天：下一個日程還有多久、整天的日程、先做的三件任務（本命、重要、時間早的在前）、還沒打卡的習慣', () => {
    const tasks = [task('普通的事'), task('重要的事', { priority: 3 }), task('本命', { star: true, priority: 1 }), task('早上的事', { at: '09:00' }), task('做完的', { done: true, star: true }), task('最後')]
    const b = buildBrief(base({ tasks, events: [ev('晨會', '07:30', '08:00'), ev('設計週會', '10:00', '11:00'), ev('牙醫', '15:30', '16:00')], allDay: [{ title: '出差' }], habits: { total: 4, done: 1 } }))
    expect(b.today.map((x) => `${x.icon}|${x.text}|${x.sub}`)).toEqual([
      '時|10:00 設計週會|還有 1 小時 40 分・之後還有 1 個',
      '日|出差|整天',
      '命|本命|本命',
      '花|重要的事|',
      '花|早上的事|09:00',
      '…|還有 2 件任務|',
      '習|3 個習慣還沒打卡|做了 1／4',
    ])
    expect(b.first).toEqual({ id: '本命', title: '本命' })
    expect(b.today[0].go).toEqual(['tab', 'schedule'])
    expect(b.today[2].go).toEqual(['tab', 'tasks'])
    expect(b.today.at(-1).go).toEqual(['tab', 'habits'])
    // 正在進行的日程
    expect(buildBrief(base({ now: at(10, 30), events: [ev('設計週會', '10:00', '11:00')] })).today[0].sub).toBe('進行中，到 11:00')
    expect(buildBrief(base({ now: at(9, 35), events: [ev('設計週會', '10:00', '11:00')] })).today[0].sub).toBe('還有 25 分鐘')
  })

  it('提醒：逾期、三天內的重要日子和期限、扣款、一直往後挪的、好久沒碰的', () => {
    const b = buildBrief(
      base({
        overdue: 2,
        dates: [
          { id: 'd1', title: '期中考', days: 0, kind: 'exam', date: '2026-11-11' },
          { id: 'm1', title: '初稿', days: 1, kind: 'milestone', pid: 'p1', projectName: '論文' },
          { id: 'p2', title: '作品集', days: 3, kind: 'deadline', project: true },
          { id: 'd9', title: '太遠的', days: 9, kind: 'day' },
        ],
        subs: [{ name: 'Netflix', days: 2, price: 'NT$390', trial: false }, { name: 'iCloud', days: 0, price: 'NT$90', trial: true }],
        stuck: { title: '寫報告', moved: 3, late: 0 },
        idle: { id: 't9', title: '蕭邦練習曲 Op.10 No.4', idle: 12, pid: 'p3', projectName: '練習鋼琴' },
      }),
    )
    expect(b.alerts.map((x) => `${x.icon}|${x.text}|${x.sub}`)).toEqual([
      '遲|2 件任務逾期了|挑一件今天做，或改個日子',
      '考|今天：期中考|考試',
      '期|明天：初稿|里程碑・論文',
      '期|3 天後：作品集|專案截止',
      '払|後天扣款：Netflix|NT$390',
      '払|今天扣款：iCloud|NT$90・免費試用結束',
      '卡|「寫報告」往後挪了 3 次|要不要拆小一點',
      '久|「蕭邦練習曲 Op.10 No.4」12 天沒碰|練習鋼琴',
    ])
    expect(b.alerts.map((x) => x.go)).toEqual([['tab', 'tasks'], ['tab', 'schedule', '2026-11-11'], ['project', 'p1'], ['project', 'p2'], ['tab', 'records'], ['tab', 'records'], ['tab', 'tasks'], ['task', 'p3', 't9']])
    // 只是逾期（沒有一直往後挪）的不重複說
    expect(buildBrief(base({ overdue: 1, stuck: { title: '寫報告', moved: 0, late: 5 } })).alerts).toHaveLength(1)
  })

  it('日期照 App 認定的今天寫（開著過了午夜、App 還沒換日時，不會標成別天）', () => {
    expect(buildBrief(base({ now: at(0, 0), today: '2026-11-10' })).date).toBe('11 月 10 日 星期二')
    expect(buildBrief(base({ today: '2027-01-01' })).date).toBe('1 月 1 日 星期五')
    expect(buildBrief(base({ today: 'oops' })).date).toBe('11 月 11 日 星期三')
  })

  it('連續好幾天了：結尾說一聲', () => {
    expect(buildBrief(base({ streak: 12 })).bye).toBe('已經連續 12 天了，今天也慢慢來。')
    expect(buildBrief(base({ streak: 1 })).bye).toBe('今天也慢慢來。')
  })
})
