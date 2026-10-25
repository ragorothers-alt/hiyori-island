import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeQuick, parseQuick } from '../src/parse.js'

const TODAY = '2026-10-25'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 25, 12))
  localStorage.clear()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('快速輸入解析', () => {
  const cases = [
    {
      name: '解析明天的下午區間、工作標籤與高優先度',
      input: '明天下午3點到5點 設計週會 #工作 !高',
      expected: { title: '設計週會', kind: 'event', date: '2026-10-26', start: '15:00', end: '17:00', tag: 'work', priority: 3 },
    },
    {
      name: '解析二十四小時制的時間區間',
      input: '14:00-15:30 牙醫',
      expected: { title: '牙醫', kind: 'event', start: '14:00', end: '15:30' },
    },
    {
      name: '解析晚上半點開始與三十分鐘長度',
      input: '晚上8點半 跑步 30分鐘',
      expected: { title: '跑步', kind: 'event', start: '20:30', end: '21:00' },
    },
    {
      name: '解析每週一三五的早上例行日程',
      input: '每週一三五 早上7點 晨跑',
      expected: { title: '晨跑', kind: 'event', start: '07:00', end: '08:00', repeat: { type: 'weekly', days: [1, 3, 5] } },
    },
    {
      name: '從週日解析下週三與三個驚嘆號的高優先任務',
      input: '下週三 交報告 !!!',
      expected: { title: '交報告', date: '2026-10-28', priority: 3 },
    },
    {
      name: '月日日期仍在未來時使用今年',
      input: '11/3 繳電費',
      expected: { title: '繳電費', date: '2026-11-03' },
    },
    {
      name: '月日日期已過一個月以上時使用明年',
      input: '1/5 回診',
      expected: { title: '回診', date: '2027-01-05' },
    },
    {
      name: '今晚會將未標時段的九點視為晚上並套用兩小時長度',
      input: '今晚 9點 看電影 2小時',
      expected: { title: '看電影', kind: 'event', date: TODAY, start: '21:00', end: '23:00' },
    },
    {
      name: '未標時段的一至六點視為下午並保留分鐘',
      input: '3點15分 開會',
      expected: { title: '開會', kind: 'event', start: '15:15', end: '16:15' },
    },
    {
      name: '中午十二點不會被換算成凌晨',
      input: '中午12點 午餐',
      expected: { title: '午餐', kind: 'event', start: '12:00', end: '13:00' },
    },
    {
      name: '沒有時間的平日輸入保留為生活類例行任務',
      input: '平日 寫日記 #生活',
      expected: { title: '寫日記', tag: 'life', repeat: { type: 'weekdays' } },
    },
    {
      name: '解析英文上午時間並預設一小時',
      input: '9am standup',
      expected: { title: 'standup', kind: 'event', start: '09:00', end: '10:00' },
    },
    {
      name: '閱讀頁數不當成時間，保留學習任務',
      input: '讀 20 頁書 #學習',
      expected: { title: '讀 20 頁書', tag: 'study' },
    },
    {
      name: '解析後天的中文數字時間與每日重複',
      input: '後天 每天 下午三點 散步',
      expected: { title: '散步', kind: 'event', date: '2026-10-27', start: '15:00', end: '16:00', repeat: { type: 'daily' } },
    },
    {
      name: '解析大後天與低優先度',
      input: '大後天 買花 !低',
      expected: { title: '買花', date: '2026-10-28', priority: 1 },
    },
    {
      name: '解析指定天數之後與兩個驚嘆號的中優先度',
      input: '5天後 整理相簿 !!',
      expected: { title: '整理相簿', date: '2026-10-30', priority: 2 },
    },
    {
      name: '完整日期保留指定年份',
      input: '2027-02-03 出遊',
      expected: { title: '出遊', date: '2027-02-03' },
    },
    {
      name: '解析英文下午時間、小數小時與不分大小寫的標籤',
      input: '2PM planning 1.5hr #WORK',
      expected: { title: 'planning', kind: 'event', start: '14:00', end: '15:30', tag: 'work' },
    },
    {
      name: '凌晨十二點會換算為零點',
      input: '12am 備份',
      expected: { title: '備份', kind: 'event', start: '00:00', end: '01:00' },
    },
    {
      name: '有前導零的時間維持早上而不推測為下午',
      input: '03:15 系統維護',
      expected: { title: '系統維護', kind: 'event', start: '03:15', end: '04:15' },
    },
    {
      name: '過短日程長度至少為五分鐘',
      input: '早上7點 伸展 1分鐘',
      expected: { title: '伸展', kind: 'event', start: '07:00', end: '07:05' },
    },
    {
      name: '結束時間超過午夜時限制在當天二十三點五十九分',
      input: '晚上11點50分 整理 30分鐘',
      expected: { title: '整理', kind: 'event', start: '23:50', end: '23:59' },
    },
    {
      name: '不認識的標籤保留在標題中',
      input: '買禮物 #生日',
      expected: { title: '買禮物 #生日' },
    },
    {
      name: '空白輸入回傳空任務且不產生日期或時間',
      input: '   ',
      expected: { title: '' },
    },
  ]

  it.each(cases)('$name', ({ input, expected }) => {
    expect(parseQuick(input, { today: TODAY })).toEqual({
      title: '', kind: 'task', date: null, start: null, end: null,
      priority: null, tag: null, repeat: null, chips: [], ...expected,
    })
  })
})

describe('快速輸入預覽', () => {
  it('日程顯示種類、日期星期及時間，但不顯示任務優先度', () => {
    const parsed = parseQuick('明天下午3點到5點 設計週會 #工作 !高', { today: TODAY })
    expect(describeQuick(parsed, TODAY)).toEqual(['日程', '10/26（一）', '15:00–17:00'])
  })

  it('今天與高優先任務會各自顯示提示', () => {
    const parsed = parseQuick('今天 交報告 !!!', { today: TODAY })
    expect(describeQuick(parsed, TODAY)).toEqual(['今天', '高優先'])
  })

  it.each([
    ['每天 澆花', '↻ 每天'],
    ['平日 寫日記', '↻ 平日'],
    ['每週一三五 晨跑', '↻ 每週一、三、五'],
  ])('重複任務「%s」顯示對應重複規則', (input, chip) => {
    expect(describeQuick(parseQuick(input, { today: TODAY }), TODAY)).toEqual([chip])
  })

  it('沒有日期時間與其他設定的任務不顯示多餘提示', () => {
    expect(describeQuick(parseQuick('讀 20 頁書 #學習', { today: TODAY }), TODAY)).toEqual([])
  })
})
