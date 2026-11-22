import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/src/index.js'
import { icsUrl, fetchICS, ICS_MAX } from '../worker/src/ics.js'
import { Store, addDays } from '../src/store.js'
import { migrate } from '../src/store/migrate.js'
import { createCalendars, toEvent, isExternal, icsText, ICS_EVERY, replaceCalendarUrl, calendarLabel, icsComplete } from '../src/calendars.js'
import { agentContext } from '../src/agent.js'

// 匯入行事曆：Worker 代抓 .ics（worker/src/ics.js）、前端抓回來變成唯讀的日程（src/calendars.js）
const TODAY = '2026-11-16'
const ymd = (d) => d.replaceAll('-', '')
const ics = (events, name = '學校課表') =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', `X-WR-CALNAME:${name}`, ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`, `SUMMARY:${e.title}`, ...e.lines, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n')
const sample = ics([
  // 不帶時區＝照這台機器的時間（CI 在 UTC 跑；時區換算在 tests/ics.test.js 測）
  { uid: 'math', title: '微積分', lines: [`DTSTART:${ymd(TODAY)}T100000`, `DTEND:${ymd(TODAY)}T120000`,'RRULE:FREQ=WEEKLY;COUNT=4', 'LOCATION:理學院 201'] },
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

  it('轉址每一跳先檢查再抓：轉到 http、IP、本機的不去抓；跳太多次不收', async () => {
    const hop = (to) => new Response(null, { status: 302, headers: { Location: to } })
    for (const bad of ['http://example.com/a.ics', 'https://127.0.0.1/a.ics', 'https://[::1]/a.ics', 'https://localhost/a.ics', 'https://2130706433/a.ics']) {
      const f = vi.fn(async (u) => (u === 'https://example.com/a.ics' ? hop(bad) : reply(sample)))
      await expect(fetchICS({ url: 'https://example.com/a.ics' }, f), bad).rejects.toMatchObject({ status: 400 })
      expect(f, bad).toHaveBeenCalledTimes(1)
      expect(f.mock.calls[0][1].redirect).toBe('manual')
    }
    // 相對路徑、合規則的 https 照跟
    const f = vi.fn(async (u) => (u === 'https://example.com/a.ics' ? hop('/b.ics') : u === 'https://example.com/b.ics' ? hop('https://cdn.example.org/c.ics') : reply(sample)))
    expect(await fetchICS({ url: 'https://example.com/a.ics' }, f)).toEqual({ ok: true, text: sample })
    expect(f.mock.calls.map((c) => c[0])).toEqual(['https://example.com/a.ics', 'https://example.com/b.ics', 'https://cdn.example.org/c.ics'])
    const loop = vi.fn(async () => hop('https://example.com/a.ics'))
    await expect(fetchICS({ url: 'https://example.com/a.ics' }, loop)).rejects.toMatchObject({ status: 502 })
    expect(loop).toHaveBeenCalledTimes(6)
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

  it('同站的課表看得出路徑，長網址留頭尾，不顯示查詢參數', () => {
    expect(calendarLabel('webcal://school.example/class-a.ics')).toBe('school.example/class-a.ics')
    expect(calendarLabel('https://school.example/class-b.ics?token=abc')).toBe('school.example/class-b.ics')
    const label = calendarLabel('https://school.example/' + 'fall/'.repeat(20) + 'class-b.ics')
    expect(label).toMatch(/^school\.example\/.*….*class-b\.ics$/)
    expect(label.length).toBeLessThanOrEqual(48)
    const common = 'https://school.example/' + 'fall/'.repeat(10)
    const paths = ['music', 'math'].map((subject) => common + subject + '/semester/subscription/basic.ics')
    expect(calendarLabel(paths[0], paths)).toContain('music')
    expect(calendarLabel(paths[1], paths)).toContain('math')
  })

  it('滿十個也能改網址，改錯或重複時保留舊的；同一筆（id、顏色、名稱、開關不變）', () => {
    const original = store.addCalendar({ url: 'https://school.example/old.ics', color: 4, name: '課表' })
    const oldUrl = original.url
    store.updateCalendar(original.id, { on: false })
    for (let i = 1; i < 10; i++) store.addCalendar({ url: `https://school.example/${i}.ics` })
    for (const url of ['http://school.example/a.ics', 'https://school.example/1.ics']) {
      expect(replaceCalendarUrl(store, original.id, url).error).toBeTruthy()
      expect(store.state.calendars).toContain(original)
    }
    const url = 'https://school.example/new.ics'
    expect(replaceCalendarUrl(store, original.id, url).error).toBeFalsy()
    expect(store.state.calendars.find((c) => c.url === url)).toMatchObject({ id: original.id, color: 4, name: '課表', on: false })
    expect(store.state.calendars).toHaveLength(10)
    expect(store.state.calendars.some((c) => c.url === oldUrl)).toBe(false)
    // store 那一層也檢查：不對的網址、跟別筆重複的不改
    expect(store.updateCalendar(original.id, { url: 'javascript:alert(1)' })).toBe(false)
    expect(store.updateCalendar(original.id, { url: 'https://school.example/1.ics' })).toBe(false)
    expect(original.url).toBe(url)
  })

  it('兩個訂閱連路徑都一樣時，看得到用來分辨課表的參數', () => {
    const feeds = ['choir', 'art'].map((group) => `https://school.example/subscribe?group=${group}&token=private`)
    expect(calendarLabel(feeds[0], feeds)).toContain('group=choir')
    expect(calendarLabel(feeds[1], feeds)).toContain('group=art')
    expect(calendarLabel(feeds[0], feeds)).not.toContain('private')
    // 私密網址裡的金鑰只露出開頭；兩個只差金鑰的照樣分得出來
    const g = (k) => `https://calendar.google.com/calendar/ical/me%40example.com/private-${k}/basic.ics`
    const keys = [g('0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d'), g('9f8e7d6c5b4a39281706f5e4d3c2b1a0')]
    for (const k of keys) expect(calendarLabel(k, keys)).not.toMatch(/[0-9a-f]{8}/)
    expect(calendarLabel(keys[0], keys)).not.toBe(calendarLabel(keys[1], keys))
    // 沒有數字的私密代號也收起來；參數的值像代號的不秀
    const opaque = 'https://cal.example/feed/abcdefgh-ijkl-mnop-qrst.ics'
    expect(calendarLabel(opaque)).not.toContain('ijkl')
    const byCal = ['k1x9q2w8e7r6t5y4', 'z0p9o8i7u6y5t4r3'].map((v) => `https://cal.example/sub?calendar=${v}`)
    for (const u of byCal) expect(calendarLabel(u, byCal)).not.toMatch(/k1x9q2w8|z0p9o8i7/)
    expect(calendarLabel(byCal[0], byCal)).not.toBe(calendarLabel(byCal[1], byCal))
    // 遮好、截短之後還一樣的：加上來源代號分得出來
    const long = ['piano', 'viola'].map((x) => `https://school.example/subscribe?group=2026-autumn-${x}-performance-and-rehearsals`)
    expect(calendarLabel(long[0], long)).not.toBe(calendarLabel(long[1], long))
  })

  it('抓回來的行事曆中途斷掉（沒有結尾、日程開了沒關）：不收，留著上一次的', () => {
    const ics = (...lines) => lines.join(String.fromCharCode(13, 10))
    expect(icsComplete(ics('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Trip', 'END:VEVENT', 'END:VCALENDAR', ''))).toBe(true)
    expect(icsComplete(ics('BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'SUMMARY:Trip'))).toBe(false)
    expect(icsComplete(ics('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Trip', 'END:VCALENDAR'))).toBe(false)
  })

  it.each([[404, 'ics missing'], [410, 'ics missing'], [403, 'ics denied'], [503, 'ics unavailable']])('依對方回的 %s 顯示原因及處理方式', async (status, error) => {
    const c = store.addCalendar({ url: 'https://school.example/test.ics' })
    const cals = createCalendars(store, { fetcher: async () => reply({ error: 'ics failed', status }, { status: 502 }) })
    await cals.refresh()
    expect(cals.status(c.id).error).toBe(error)
    expect(icsText(error)).toMatch(/更新|再試|換|確認|複製/)
  })

  it.each([{ ok: true }, { ok: true, text: '<html>登入頁面</html>' }, '<!doctype html>'])('連線成功卻拿不到行事曆時，要提醒換 iCal 網址', async (body) => {
    const c = store.addCalendar({ url: 'https://school.example/test.ics' })
    const cals = createCalendars(store, { fetcher: async () => reply(body) })
    await cals.refresh()
    expect(cals.status(c.id).error).toBe('not ics')
    expect(icsText('http 200')).toBe(icsText('not ics'))
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
    expect(cals.status(c.id)).toMatchObject({ error: 'ics denied' })
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

  it('刪掉最後一個行事曆、換了網址：這台裝置存著的私密網址和日程馬上清掉', async () => {
    const cals = createCalendars(store, { fetcher, now: () => Date.now() + t })
    const c = store.addCalendar({ url: 'https://example.com/private-abc.ics' })
    await cals.refresh()
    expect(localStorage.getItem('hiyori-ics')).toContain('private-abc')
    // 別台裝置換了網址、這裡同步過來（關著不抓）：舊網址那份也不留
    store.state.calendars[0] = { ...c, url: 'https://example.com/private-new.ics', on: false }
    await cals.refresh()
    expect(localStorage.getItem('hiyori-ics') || '').not.toContain('private-abc')
    store.removeCalendar(c.id)
    await cals.refresh()
    expect(localStorage.getItem('hiyori-ics') || '').not.toContain('private')
    expect(localStorage.getItem('hiyori-ics') || '').not.toContain('微積分')
  })

  it('同一筆日程每次抓回來 id 都一樣（不同行事曆、不同那一次就不一樣）', () => {
    const cal = { id: 'c1', color: 0 }
    const x = { uid: 'math::1', title: 'A', date: TODAY, start: '10:00', end: '11:00', allDay: false, endDate: '', location: '' }
    expect(toEvent(cal, x).id).toBe(toEvent(cal, { ...x, title: 'B' }).id)
    expect(toEvent(cal, x).id).not.toBe(toEvent({ id: 'c2' }, x).id)
    expect(toEvent(cal, x).id).not.toBe(toEvent(cal, { ...x, uid: 'math::2' }).id)
  })
})
