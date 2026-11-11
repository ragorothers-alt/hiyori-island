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

  describe('你不在的時候', () => {
    const NOW = at(8, 20).getTime()
    const H = 3600000
    const events = [
      { title: '牙醫', date: '2026-11-10', start: '15:30', end: '16:00' },
      { title: '晚餐', date: '2026-11-10', start: '19:00', end: '20:00' },
      { title: '晨會', date: '2026-11-11', start: '07:30', end: '08:00' },
      { title: '設計週會', date: '2026-11-11', start: '10:00', end: '11:00' },
      { title: '上週的事', date: '2026-11-06', start: '10:00', end: '11:00' },
    ]
    const away = (o = {}) => ({ since: NOW - 18 * H, events, charges: [], habits: { total: 0, done: 0 }, ...o })

    it('上次看 App 之後開始、現在已經結束的日程（新的在前）；還沒開始的留在「今天」', () => {
      const b = buildBrief(base({ today: '2026-11-11', events: events.filter((e) => e.date === '2026-11-11'), away: away() }))
      expect(b.away.label).toBe('離開了 18 小時')
      expect(b.away.items.map((x) => `${x.icon}|${x.text}|${x.sub}`)).toEqual(['時|今天 07:30 晨會|那時沒提醒到', '時|昨天 19:00 晚餐|那時沒提醒到', '時|昨天 15:30 牙醫|那時沒提醒到'])
      expect(b.away.items.map((x) => x.go)).toEqual([['tab', 'schedule', '2026-11-11'], ['tab', 'schedule', '2026-11-10'], ['tab', 'schedule', '2026-11-10']])
      expect(b.today[0].text).toBe('10:00 設計週會')
      // 昨天下午四點半才離開：牙醫那時候還在看，不算錯過
      expect(buildBrief(base({ today: '2026-11-11', away: away({ since: at(8, 20).getTime() - 15.8 * H }) })).away.items.map((x) => x.text)).toEqual(['今天 07:30 晨會', '昨天 19:00 晚餐'])
    })

    it('離開不到半小時、沒有上次的時間、沒錯過什麼：沒有這一段', () => {
      expect(buildBrief(base({ away: away({ since: NOW - 20 * 60000 }) })).away).toBeNull()
      expect(buildBrief(base({ away: away({ since: 0 }) })).away).toBeNull()
      expect(buildBrief(base({ away: null })).away).toBeNull()
      expect(buildBrief(base()).away).toBeNull()
      expect(buildBrief(base({ away: away({ events: [] }) })).away).toBeNull()
    })

    it('離開很多天：最多回頭看三天，超過三個日程收成一項；離開多久照實寫', () => {
      const many = ['09:00', '11:00', '13:00', '15:00', '17:00'].map((start, i) => ({ title: `會議 ${i + 1}`, date: '2026-11-09', start, end: start.replace(':00', ':30') }))
      const b = buildBrief(base({ today: '2026-11-11', away: away({ since: NOW - 9 * 86400000, events: [...events, ...many] }) }))
      expect(b.away.label).toBe('離開了 9 天')
      expect(b.away.items.map((x) => x.text)).toEqual(['今天 07:30 晨會', '昨天 19:00 晚餐', '昨天 15:30 牙醫', '還有 5 個日程'])
      expect(b.away.items.at(-1).go).toEqual(['tab', 'schedule', '2026-11-09'])
      expect(JSON.stringify(b.away)).not.toContain('上週的事')
      expect(buildBrief(base({ away: away({ since: NOW - 45 * 60000, events: [{ title: 'x', date: '2026-11-11', start: '07:50', end: '08:10' }] }) })).away.label).toBe('離開了 45 分鐘')
    })

    it('這段時間扣的款（離開那天之後到昨天）、昨天沒打卡的習慣（昨天傍晚前就離開才說）', () => {
      const charges = [
        { name: 'Netflix', date: '2026-11-10', price: 'NT$390' },
        { name: '今天的', date: '2026-11-11', price: 'NT$1' },
        { name: '離開那天的', date: '2026-11-08', price: 'NT$2' },
        { name: 'iCloud', date: '2026-11-09', price: 'NT$90' },
      ]
      const b = buildBrief(base({ today: '2026-11-11', away: away({ since: new Date(2026, 10, 8, 22).getTime(), events: [], charges, habits: { total: 4, done: 1 } }) }))
      expect(b.away.items.map((x) => `${x.icon}|${x.text}|${x.sub}`)).toEqual(['払|昨天扣款了：Netflix|NT$390', '払|11/9扣款了：iCloud|NT$90', '習|昨天有 3 個習慣沒打卡|做了 1／4'])
      expect(b.away.items.at(-1).go).toEqual(['tab', 'habits', '2026-11-10'])
      // 昨天晚上還在看：習慣那時看得到，不算
      expect(buildBrief(base({ today: '2026-11-11', away: away({ since: new Date(2026, 10, 10, 21).getTime(), events: [], habits: { total: 4, done: 1 } }) })).away).toBeNull()
    })
  })

  it('連續好幾天了：結尾說一聲', () => {
    expect(buildBrief(base({ streak: 12 })).bye).toBe('已經連續 12 天了，今天也慢慢來。')
    expect(buildBrief(base({ streak: 1 })).bye).toBe('今天也慢慢來。')
  })
})
