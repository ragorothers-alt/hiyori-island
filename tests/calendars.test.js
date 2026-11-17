import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/src/index.js'
import { icsUrl, fetchICS, ICS_MAX } from '../worker/src/ics.js'
import { Store, addDays } from '../src/store.js'
import { migrate } from '../src/store/migrate.js'
import { createCalendars, toEvent, isExternal, icsText, ICS_EVERY } from '../src/calendars.js'
import { agentContext } from '../src/agent.js'

// 匯入行事曆：Worker 代抓 .ics（worker/src/ics.js）、前端抓回來變成唯讀的日程（src/calendars.js）
const TODAY = '2026-11-16'
const ymd = (d) => d.replaceAll('-', '')
const ics = (events, name = '學校課表') =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', `X-WR-CALNAME:${name}`, ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`, `SUMMARY:${e.title}`, ...e.lines, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n')
const sample = ics([
  { uid: 'math', title: '微積分', lines: [`DTSTART;TZID=Asia/Taipei:${ymd(TODAY)}T100000`, `DTEND;TZID=Asia/Taipei:${ymd(TODAY)}T120000`, 'RRULE:FREQ=WEEKLY;COUNT=4', 'LOCATION:理學院 201'] },
  { uid: 'trip', title: '畢業旅行', lines: [`DTSTART;VALUE=DATE:${ymd(addDays(TODAY, 3))}`, `DTEND;VALUE=DATE:${ymd(addDays(TODAY, 5))}`] },
])
const reply = (body, init = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init })

describe('Worker：代抓行事曆', () => {
  it('只收 https／webcal 的公開網址', () => {
    expect(icsUrl('webcal://calendar.google.com/calendar/ical/x/basic.ics').href).toBe('https://calendar.google.com/calendar/ical/x/basic.ics')
    for (const bad of ['http://example.com/a.ics', 'https://localhost/a.ics', 'https://127.0.0.1/a.ics', 'https://[::1]/a.ics', 'https://intranet/a.ics', 'https://user:pw@example.com/a.ics', 'https://example.com:8443/a.ics', 'ftp://example.com/a.ics', 'javascript:alert(1)', '', null]) {
      expect(() => icsUrl(bad), String(bad)).toThrow()
    }
  })

  it('回來的要是行事曆檔、不能太大、對方出錯照實說；轉址到 http 的不收', async () => {
    const ok = await fetchICS({ url: 'https://example.com/a.ics' }, async () => reply(sample))
    expect(ok).toEqual({ ok: true, text: sample })
    await expect(fetchICS({ url: 'https://example.com/a.ics' }, async () => reply('<html>登入</html>'))).rejects.toMatchObject({ status: 422, message: 'not ics' })
    await expect(fetchICS({ url: 'https://example.com/a.ics' }, async () => reply('x', { status: 404 }))).rejects.toMatchObject({ status: 502, message: 'ics failed' })
    await expect(fetchICS({ url: 'https://example.com/a.ics' }, async () => reply('BEGIN:VCALENDAR' + 'x'.repeat(ICS_MAX)))).rejects.toMatchObject({ status: 413 })
    await expect(fetchICS({ url: 'https://example.com/a.ics' }, async () => Object.defineProperty(reply(sample), 'url', { value: 'http://example.com/a.ics' }))).rejects.toMatchObject({ status: 400 })
    await expect(fetchICS({ url: 'https://example.com/a.ics' }, async () => { throw new TypeError('network') })).rejects.toMatchObject({ status: 502, message: 'ics unreachable' })
  })

  it('/v1/ics 有自己的流量上限', async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const res = await worker.fetch(new Request('https://hiyori.test/v1/ics', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/a.ics' }) }), { ICS_LIMIT: { limit }, SYNC_LIMIT: { limit: async () => ({ success: true }) } })
    expect(res.status).toBe(429)
    expect(limit).toHaveBeenCalled()
    const ok = await worker.fetch(new Request('https://hiyori.test/v1/ics', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/a.ics' }) }), { ICS_FETCH: async () => reply(sample) })
    expect(await ok.json()).toEqual({ ok: true, text: sample })
  })
})

describe('前端：抓回來變成唯讀的日程', () => {
  let store
  let fetcher
  let t
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 16, 8))
    localStorage.clear()
    store = new Store()
    store.importJSON(JSON.stringify({ tasks: [], events: [], projects: [], player: { xp: 0, coins: 0 } }))
    t = 0
    fetcher = vi.fn(async () => reply({ ok: true, text: sample }))
  })
  afterEach(() => vi.useRealTimers())

  it('設定只收合法的網址；讀檔照規則清', () => {
    expect(store.addCalendar({ url: 'http://example.com/a.ics' })).toBeNull()
    const c = store.addCalendar({ url: 'webcal://example.com/a.ics' })
    expect(c).toMatchObject({ url: 'webcal://example.com/a.ics', on: true })
    expect(store.addCalendar({ url: 'webcal://example.com/a.ics' })).toBeNull()
    const back = migrate({ ...JSON.parse(JSON.stringify(store.state)), calendars: [c, { id: 'z', url: 'javascript:alert(1)' }, ...Array.from({ length: 12 }, (_, i) => ({ url: `https://e${i}.com/a.ics` }))] })
    expect(back.calendars).toHaveLength(10)
    expect(back.calendars[0]).toMatchObject({ id: c.id, url: c.url })
    expect(migrate({ tasks: [], player: {} }).calendars).toEqual([])
  })

  it('抓回來：時間軸、排程、ふじ都看得到；名字沒取的用行事曆自己的；關掉就不見', async () => {
    const cals = createCalendars(store, { fetcher, now: () => Date.now() + t })
    const c = store.addCalendar({ url: 'https://example.com/a.ics', color: 4 })
    cals.sync()
    await cals.refresh()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ url: 'https://example.com/a.ics' })
    expect(store.state.calendars[0].name).toBe('學校課表')
    const math = store.eventsOn(TODAY)
    expect(math).toEqual([expect.objectContaining({ title: '微積分', start: '10:00', end: '12:00', note: '理學院 201', ext: c.id, color: 4 })])
    expect(isExternal(math[0])).toBe(true)
    expect(store.allDayOn(addDays(TODAY, 4)).map((e) => e.title)).toEqual(['畢業旅行'])
    // 不存進小島的資料
    expect(store.state.events).toEqual([])
    // 最佳化時程避開；ふじ看得到
    store.addTask({ title: '寫作業', date: TODAY, dur: 60, priority: 3 })
    expect(store.planDay(TODAY).plan[0].at >= '12:00' || store.planDay(TODAY).plan[0].at < '09:00').toBe(true)
    expect(agentContext(store, 'morning', {}, new Date()).data.days[0].events).toEqual(['10:00-12:00 微積分'])
    // 不能改：store 的方法找不到它
    store.updateEvent(math[0].id, { title: '改掉' })
    store.toggleEvent(math[0].id)
    expect(store.eventsOn(TODAY)[0]).toMatchObject({ title: '微積分', done: false })
    // 關掉：不顯示（不用再抓）
    store.updateCalendar(c.id, { on: false })
    cals.sync()
    expect(store.eventsOn(TODAY)).toEqual([])
    store.updateCalendar(c.id, { on: true })
    cals.sync()
    expect(store.eventsOn(TODAY)).toHaveLength(1)
  })

  it('30 分鐘內不重抓；抓不到時留著上次的、寫原因；換一台 App（重新打開）先用存著的', async () => {
    const cals = createCalendars(store, { fetcher, now: () => Date.now() + t })
    const c = store.addCalendar({ url: 'https://example.com/a.ics' })
    await cals.refresh()
    await cals.refresh()
    expect(fetcher).toHaveBeenCalledTimes(1)
    t = ICS_EVERY + 1
    fetcher.mockImplementationOnce(async () => reply({ error: 'ics failed', status: 403 }, { status: 502 }))
    await cals.refresh()
    expect(cals.status(c.id)).toMatchObject({ error: 'ics failed' })
    expect(icsText('ics failed')).toContain('拒絕')
    expect(store.eventsOn(TODAY)).toHaveLength(1)
    const again = createCalendars(store, { fetcher, now: () => Date.now() + t })
    store.setExternal([])
    again.sync()
    expect(store.eventsOn(TODAY)).toHaveLength(1)
    // 刪掉：日程跟著不見、快取也清掉
    store.removeCalendar(c.id)
    expect(store.eventsOn(TODAY)).toEqual([])
    await again.refresh({ force: true })
    expect(again.status(c.id)).toBeNull()
  })

  it('同一筆日程每次抓回來 id 都一樣（不同行事曆、不同那一次就不一樣）', () => {
    const cal = { id: 'c1', color: 0 }
    const x = { uid: 'math::1', title: 'A', date: TODAY, start: '10:00', end: '11:00', allDay: false, endDate: '', location: '' }
    expect(toEvent(cal, x).id).toBe(toEvent(cal, { ...x, title: 'B' }).id)
    expect(toEvent(cal, x).id).not.toBe(toEvent({ id: 'c2' }, x).id)
    expect(toEvent(cal, x).id).not.toBe(toEvent(cal, { ...x, uid: 'math::2' }).id)
  })
})
