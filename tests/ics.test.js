import { describe, expect, it } from 'vitest'
import { parseICS } from '../src/ics.js'

const calendar = (...events) => `BEGIN:VCALENDAR\nVERSION:2.0\n${events.join('\n')}\nEND:VCALENDAR`
const event = (body, uid = 'test') => `BEGIN:VEVENT\nUID:${uid}\n${body}\nEND:VEVENT`
const parse = (body, options = {}) => parseICS(calendar(event(body)), { tz: 'Asia/Taipei', ...options }).events
const dates = (body, options) => parse(body, options).map((e) => e.date)

describe('ICS 匯入', () => {
  it('解析 Google 日曆、二四課程、排除和改期並保持識別穩定', () => {
    const text = calendar('X-WR-CALNAME:我的課表',
      event('DTSTART:20261117T010000Z\nDTEND:20261117T020000Z\nSUMMARY:課程\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6\nEXDATE:20261119T010000Z', 'class'),
      event('RECURRENCE-ID:20261124T010000Z\nDTSTART:20261124T030000Z\nDTEND:20261124T040000Z\nSUMMARY:補課', 'class'))
    const options = { tz: 'Asia/Taipei', from: '2026-11-17', to: '2026-12-03' }
    const result = parseICS(text, options)
    expect(result.name).toBe('我的課表')
    expect(result.events.map((e) => [e.date, e.start, e.title])).toEqual([
      ['2026-11-17', '09:00', '課程'], ['2026-11-24', '11:00', '補課'],
      ['2026-11-26', '09:00', '課程'], ['2026-12-01', '09:00', '課程'], ['2026-12-03', '09:00', '課程'],
    ])
    expect(result).toEqual(parseICS(text, options))
    expect(new Set(result.events.map((e) => e.uid)).size).toBe(5)
    const original = parse('DTSTART:20261124T010000Z')[0]
    expect(result.events[1].uid).toBe(original.uid.replace('test::', 'class::'))
  })

  it.each(['\n', '\r\n'])('解開折行、大小寫、參數和文字跳脫 %j', (newline) => {
    const text = calendar('x-wr-calname: 測試日曆 ', event('dtstart;tzid="Asia/Taipei":20261117T090000\nsummary:  A\\nB\\,C\\;D\\\\E\n 接上\n\ttab  \nlocation: 地點\\,一  ')).replaceAll('\n', newline)
    const result = parseICS(text, { tz: 'Asia/Taipei' })
    expect(result.name).toBe('測試日曆')
    expect(result.events[0]).toMatchObject({ title: 'A\nB,C;D\\E接上tab', location: '地點,一', start: '09:00', end: '10:00', allDay: false, endDate: '' })
  })

  it('空標題與欄位長度', () => {
    expect(parse('DTSTART:20261117T090000\nSUMMARY:  ')[0]).toMatchObject({ title: '（沒有標題）', location: '' })
    const e = parse(`DTSTART:20261117T090000\nSUMMARY:${'字'.repeat(90)}\nLOCATION:${'地'.repeat(90)}`)[0]
    expect(e.title).toHaveLength(80)
    expect(e.location).toHaveLength(80)
    expect(parseICS(calendar(`X-WR-CALNAME:${'名'.repeat(90)}`), { tz: 'Asia/Taipei' }).name).toHaveLength(90)
  })

  it.each(['', ';TZID=Taipei Standard Time', ';TZID=Custom/School'])('floating 與未知時區 %s', (param) => {
    expect(parse(`DTSTART${param}:20261117T090000`)[0]).toMatchObject({ date: '2026-11-17', start: '09:00', end: '10:00' })
  })

  it('UTC 換算後的日期才決定視窗與排序', () => {
    const text = calendar(event('DTSTART:20261116T180000Z', 'late'), event('DTSTART:20261117T010000Z', 'early'))
    expect(parseICS(text, { tz: 'Asia/Taipei', from: '2026-11-17', to: '2026-11-17' }).events.map((e) => e.start)).toEqual(['02:00', '09:00'])
  })

  it.each([
    ['20260307', ['14:00', '13:00', '13:00']],
    ['20261031', ['13:00', '14:00', '14:00']],
  ])('TZID 重複維持牆上時間，跨換時 %s', (day, expected) => {
    const body = `DTSTART;TZID=America/New_York:${day}T090000\nRRULE:FREQ=DAILY;COUNT=3`
    expect(parse(body, { tz: 'UTC' }).map((e) => e.start)).toEqual(expected)
    expect(parse(body, { tz: 'America/New_York' }).map((e) => e.start)).toEqual(['09:00', '09:00', '09:00'])
  })

  it.each([
    ['20260308T023000', '07:30'], ['20261101T013000', '05:30'],
  ])('夏令時間缺口與重疊採固定選擇 %s', (value, expected) => {
    expect(parse(`DTSTART;TZID=America/New_York:${value}`, { tz: 'UTC' })[0].start).toBe(expected)
  })

  it('VTIMEZONE 不會混入事件屬性', () => {
    const text = calendar('BEGIN:VTIMEZONE\nTZID:Custom\nBEGIN:STANDARD\nDTSTART:19700101T000000\nEND:STANDARD\nEND:VTIMEZONE', event('DTSTART;TZID=Custom:20261117T090000'))
    expect(parseICS(text, { tz: 'Asia/Taipei' }).events).toHaveLength(1)
  })

  it('三天整天事件以不含的 DTEND 換成最後一天並保留原始開始日', () => {
    const body = 'DTSTART;VALUE=DATE:20261117\nDTEND;VALUE=DATE:20261120'
    expect(parse(body, { from: '2026-11-19', to: '2026-11-19' })[0]).toMatchObject({ date: '2026-11-17', endDate: '2026-11-19', allDay: true, start: '', end: '' })
    expect(parse(body, { from: '2026-11-20' })).toEqual([])
    expect(parse(body, { to: '2026-11-16' })).toEqual([])
    expect(parse('DTSTART;VALUE=DATE:20261117')[0].endDate).toBe('')
  })

  it.each([
    ['DTSTART:20261117T230000\nDTEND:20261118T020000', '23:00', '23:59'],
    ['DTSTART:20261117T090000\nDTEND:20261117T090000', '09:00', '09:30'],
    ['DTSTART:20261117T090000\nDTEND:20261117T080000', '09:00', '09:30'],
    ['DTSTART:20261117T234500\nDURATION:PT0S', '23:45', '23:59'],
    ['DTSTART:20261117T090000\nDURATION:PT1H30M', '09:00', '10:30'],
    ['DTSTART:20261117T090000\nDURATION:P1D', '09:00', '23:59'],
    ['DTSTART:20261117T090000\nDTEND:20261117T110000\nDURATION:PT30M', '09:00', '11:00'],
  ])('時段長度與截斷 %s', (body, start, end) => {
    expect(parse(body)[0]).toMatchObject({ start, end, endDate: '', allDay: false })
  })

  it('23:59 起始：當天沒有正長度可表示，只留隔天那段', () => {
    expect(parse('DTSTART:20261117T235900').map((e) => [e.date, e.start, e.end])).toEqual([['2026-11-18', '00:00', '00:59']])
  })

  it('整天 DURATION 與預設一天', () => {
    expect(parse('DTSTART;VALUE=DATE:20261117\nDURATION:P3D')[0].endDate).toBe('2026-11-19')
    expect(parse('DTSTART;VALUE=DATE:20261117\nDURATION:P1D')[0].endDate).toBe('')
    expect(parse('DTSTART;VALUE=DATE:20261117\nDURATION:P1W')[0].endDate).toBe('2026-11-23')
  })

  it('COUNT 從第一次算起，排除日期不補次數', () => {
    const body = 'DTSTART:20261117T090000\nRRULE:FREQ=DAILY;INTERVAL=2;COUNT=5\nEXDATE:20261119T090000'
    expect(dates(body, { from: '2026-11-22' })).toEqual(['2026-11-23', '2026-11-25'])
  })

  it.each([
    ['20261119', 3], ['20261119T090000', 3], ['20261119T010000Z', 3], ['20261119T005959Z', 2],
  ])('UNTIL 包含邊界 %s', (until, count) => {
    expect(parse(`DTSTART:20261117T090000\nRRULE:FREQ=DAILY;UNTIL=${until}`)).toHaveLength(count)
  })

  it('每週省略 BYDAY、INTERVAL 和 COUNT', () => {
    expect(dates('DTSTART:20261117T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3')).toEqual(['2026-11-17', '2026-12-01', '2026-12-15'])
  })

  it('每週 COUNT 在視窗前的多天仍計數', () => {
    expect(dates('DTSTART:20261117T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10;WKST=SU', { from: '2026-12-01' })).toEqual(['2026-12-02', '2026-12-04', '2026-12-07'])
  })

  it('每隔幾週照 WKST 切週（沒寫是星期一）；認不得的 WKST 只留第一次', () => {
    expect(dates('DTSTART:20261115T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU;COUNT=4')).toEqual(['2026-11-15', '2026-11-16', '2026-11-29', '2026-11-30'])
    expect(dates('DTSTART:20261115T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;COUNT=4')).toEqual(['2026-11-15', '2026-11-23', '2026-11-29', '2026-12-07'])
    expect(dates('DTSTART:20261115T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU;COUNT=8', { from: '2026-12-10' })).toEqual(['2026-12-13', '2026-12-14', '2026-12-27', '2026-12-28'])
    expect(parse('DTSTART:20261115T090000\nRRULE:FREQ=WEEKLY;WKST=XX')).toHaveLength(1)
  })

  it('跨過午夜的切成每天一段：隔天那段也看得到、各有自己的 uid', () => {
    const span = (list) => list.map((e) => [e.date, e.start, e.end])
    const night = parse('DTSTART:20261117T220000\nDTEND:20261118T020000\nSUMMARY:夜班')
    expect(span(night)).toEqual([['2026-11-17', '22:00', '23:59'], ['2026-11-18', '00:00', '02:00']])
    expect(new Set(night.map((e) => e.uid)).size).toBe(2)
    expect(night[0].uid).toBe('test::' + night[0].uid.split('::')[1])
    // 只查隔天：前一晚開始的那段也在
    expect(span(parse('DTSTART:20261117T220000\nDTEND:20261118T020000', { from: '2026-11-18', to: '2026-11-18' }))).toEqual([['2026-11-18', '00:00', '02:00']])
    // 每天重複的夜班：查詢範圍前一天開始的那次也算進來
    expect(span(parse('DTSTART:20261110T220000\nDTEND:20261111T020000\nRRULE:FREQ=DAILY;COUNT=20', { from: '2026-11-18', to: '2026-11-18' }))).toEqual([['2026-11-18', '00:00', '02:00'], ['2026-11-18', '22:00', '23:59']])
    // 剛好到午夜的不多一段；跨好幾天的中間是整天，最多切 14 天
    expect(parse('DTSTART:20261117T220000\nDTEND:20261118T000000')).toHaveLength(1)
    expect(span(parse('DTSTART:20261117T090000\nDTEND:20261119T100000'))).toEqual([['2026-11-17', '09:00', '23:59'], ['2026-11-18', '00:00', '23:59'], ['2026-11-19', '00:00', '10:00']])
    expect(parse('DTSTART:20261101T090000\nDTEND:20261201T090000')).toHaveLength(14)
  })

  it.each([
    ['BYDAY=-1FR', ['2026-01-30', '2026-02-27', '2026-03-27']],
    ['BYDAY=2TU', ['2026-01-13', '2026-02-10', '2026-03-10']],
    ['BYMONTHDAY=-1', ['2026-01-31', '2026-02-28', '2026-03-31']],
    ['BYMONTHDAY=31', ['2026-01-31', '2026-03-31', '2026-05-31']],
  ])('每月規則 %s', (rule, expected) => {
    const first = expected[0].replaceAll('-', '')
    expect(dates(`DTSTART:${first}T090000\nRRULE:FREQ=MONTHLY;${rule};COUNT=3`)).toEqual(expected)
  })

  it('每月省略規則不把不存在的 31 日進位', () => {
    expect(dates('DTSTART:20260131T090000\nRRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=3')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
  })

  it('每年 BYMONTH 多月與閏年', () => {
    expect(dates('DTSTART:20260117T090000\nRRULE:FREQ=YEARLY;BYMONTH=1,7;INTERVAL=2;COUNT=4')).toEqual(['2026-01-17', '2026-07-17', '2028-01-17', '2028-07-17'])
    expect(dates('DTSTART:20240229T090000\nRRULE:FREQ=YEARLY;COUNT=2')).toEqual(['2024-02-29', '2028-02-29'])
  })

  it.each(['FREQ=HOURLY', 'FREQ=DAILY;BYHOUR=9', 'FREQ=MONTHLY;BYSETPOS=-1', 'FREQ=MONTHLY;BYDAY=FR', 'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;UNTIL=bad', 'FREQ=YEARLY;BYMONTH=13'])('不支援或壞規則只留第一次 %s', (rule) => {
    expect(parse(`DTSTART:20261117T090000\nRRULE:${rule}`)).toHaveLength(1)
  })

  it('多行、多值、DATE 的 EXDATE 和明確忽略 RDATE', () => {
    expect(dates('DTSTART;VALUE=DATE:20261117\nRRULE:FREQ=DAILY;COUNT=5\nEXDATE;VALUE=DATE:20261118,20261119\nEXDATE;VALUE=DATE:20261120\nRDATE;VALUE=DATE:20261201')).toEqual(['2026-11-17', '2026-11-21'])
  })

  it('EXDATE 可用不同時區描述同一瞬間', () => {
    expect(parse('DTSTART:20261117T010000Z\nRRULE:FREQ=DAILY;COUNT=2\nEXDATE;TZID=Asia/Taipei:20261118T090000')).toHaveLength(1)
    expect(dates('DTSTART:20261117T090000\nRRULE:FREQ=DAILY;COUNT=5\nEXDATE:20261118T090000,20261119T090000\nEXDATE;VALUE=DATE:20261120')).toEqual(['2026-11-17', '2026-11-21'])
  })

  it('整天重複與整天改期採原日期辨識', () => {
    const text = calendar(event('DTSTART;VALUE=DATE:20261117\nDTEND;VALUE=DATE:20261120\nRRULE:FREQ=WEEKLY;COUNT=2', 'trip'),
      event('RECURRENCE-ID;VALUE=DATE:20261124\nDTSTART;VALUE=DATE:20261125\nDURATION:P3D', 'trip'))
    const result = parseICS(text, { tz: 'Asia/Taipei', from: '2026-11-26', to: '2026-11-26' }).events
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ uid: 'trip::2026-11-24', date: '2026-11-25', endDate: '2026-11-27' })
  })

  it('母事件取消也取消已改期的例外', () => {
    const text = calendar(event('DTSTART:20261117T090000\nSTATUS:CANCELLED', 'a'), event('RECURRENCE-ID:20261117T090000\nDTSTART:20261118T090000', 'a'))
    expect(parseICS(text, { tz: 'Asia/Taipei' }).events).toEqual([])
  })

  it('取消整個事件或某一次', () => {
    const text = calendar(event('DTSTART:20261117T090000\nRRULE:FREQ=DAILY;COUNT=3', 'a'),
      event('RECURRENCE-ID:20261118T090000\nSTATUS:CANCELLED', 'a'),
      event('DTSTART:20261117T090000\nSTATUS:CANCELLED', 'b'))
    expect(parseICS(text, { tz: 'Asia/Taipei' }).events.map((e) => e.date)).toEqual(['2026-11-17', '2026-11-19'])
  })

  it('改期到視窗外不保留原時段，改期進視窗也會輸出', () => {
    const text = calendar(event('DTSTART:20261117T090000\nRRULE:FREQ=DAILY;COUNT=2', 'a'),
      event('RECURRENCE-ID:20261117T090000\nDTSTART:20261201T090000', 'a'),
      event('RECURRENCE-ID:20261118T090000\nDTSTART:20261117T110000', 'a'))
    const result = parseICS(text, { tz: 'Asia/Taipei', from: '2026-11-17', to: '2026-11-17' }).events
    expect(result).toHaveLength(1)
    expect(result[0].start).toBe('11:00')
  })

  it.each([null, undefined, 12, {}, '', 'garbage', 'BEGIN:VEVENT\nDTSTART:20261117T090000\nEND:VEVENT'])('壞檔不丟例外 %j', (input) => {
    expect(parseICS(input, { tz: 'Asia/Taipei' })).toEqual({ name: '', events: [] })
  })

  it.each(['', 'DTSTART:bad', 'DTSTART:20260230T090000', 'DTSTART:20261117T250000', 'DTSTART;VALUE=DATE:20261117T090000', 'DTSTART:20261117T090000\nDTEND:bad'])('壞事件不影響其他事件 %s', (body) => {
    const result = parseICS(calendar(event(body, 'bad'), event('DTSTART:20261117T090000', 'good')), { tz: 'Asia/Taipei' })
    expect(result.events).toHaveLength(1)
    expect(result.events[0].uid).toContain('good::')
  })

  it('缺 UID 與不完整事件跳過', () => {
    expect(parseICS(calendar('BEGIN:VEVENT\nDTSTART:20261117T090000\nEND:VEVENT', 'BEGIN:VEVENT\nUID:bad\nDTSTART:20261117T090000'), { tz: 'Asia/Taipei' }).events).toEqual([])
  })

  it.each(['P999999999999999D', 'P99999999D', 'broken'])('壞長度只跳過該事件 %s', (length) => {
    const text = calendar(event(`DTSTART:20261117T090000\nDURATION:${length}`, 'bad'), event('DTSTART:20261117T090000', 'good'))
    expect(parseICS(text, { tz: 'Asia/Taipei' }).events.map((e) => e.uid.split('::')[0])).toEqual(['good'])
  })

  it('無效選項也不丟例外', () => {
    expect(parse('DTSTART:20261117T090000', { from: '2026-02-30' })).toEqual([])
    expect(parse('DTSTART:20261117T090000', { from: '2026-12-01', to: '2026-11-01' })).toEqual([])
    expect(parse('DTSTART:20261117T090000', { tz: 'invalid' })).toHaveLength(1)
  })

  it('舊 DAILY 直接跳到視窗，有限 COUNT 不會重算', () => {
    const body = 'DTSTART:19000101T090000\nRRULE:FREQ=DAILY'
    expect(dates(body, { from: '2026-11-17', to: '2026-11-18' })).toEqual(['2026-11-17', '2026-11-18'])
    expect(parse(`${body};COUNT=5000`, { from: '2026-11-17' })).toEqual([])
  })

  it('舊 WEEKLY 多天也可直接跳到視窗且尊重 COUNT', () => {
    const body = 'DTSTART:19000101T090000\nRRULE:FREQ=WEEKLY;BYDAY=TU,TH'
    expect(dates(body, { from: '2026-11-17', to: '2026-11-19' })).toEqual(['2026-11-17', '2026-11-19'])
    expect(parse(`${body};COUNT=5000`, { from: '2026-11-17' })).toEqual([])
  })

  it('無限重複與跨多個事件合計最多 2000 筆', () => {
    expect(parse('DTSTART:20261117T090000\nRRULE:FREQ=DAILY')).toHaveLength(2000)
    const text = calendar(...Array.from({ length: 2010 }, (_, i) => event('DTSTART:20261117T090000', `id${i}`)))
    expect(parseICS(text, { tz: 'Asia/Taipei' }).events).toHaveLength(2000)
  })

  it('每個事件最多 5000 輪，不會卡在無法命中的規則', () => {
    expect(parse('DTSTART:00010101T090000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=31;BYDAY=5MO', { from: '2026-11-01', to: '2026-11-30' })).toEqual([])
  })

  it('只讀前 200 萬字元', () => {
    const prefix = 'BEGIN:VCALENDAR\n' + 'X'.repeat(2000000) + '\n'
    expect(parseICS(prefix + event('DTSTART:20261117T090000') + '\nEND:VCALENDAR', { tz: 'Asia/Taipei' }).events).toEqual([])
  })
})
