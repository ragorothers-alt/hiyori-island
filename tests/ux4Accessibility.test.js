import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { BriefView } from '../src/ui/brief.js'
import { CalendarView } from '../src/ui/calendar.js'
import { LifeView } from '../src/ui/life.js'
import { reviewMethods } from '../src/ui/review.js'
import { ScheduleView } from '../src/ui/schedule.js'
import { TodayView } from '../src/ui/today.js'

const date = '2026-11-23'
afterEach(() => vi.unstubAllGlobals())

it('日程的七格先報畫面上的星期和日期，有排事情再接件數', () => {
  const strip = {}
  vi.stubGlobal('document', { querySelector: (s) => s === '#weekStrip' ? strip : null })
  const view = Object.create(ScheduleView.prototype)
  view.store = {
    today: date, selectedDate: date,
    eventsOn: (d) => d === date ? [{}] : [], allDayOn: () => [],
    tasksOn: () => [{ done: false }, { done: true }],
  }
  view._week()
  const names = [...strip.innerHTML.matchAll(/class="ws-day [^"]*"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1])
  expect(names.map((name) => name.split('，')[0])).toEqual(['一 23', '二 24', '三 25', '四 26', '五 27', '六 28', '日 29'])
  expect(names[0]).toContain('1 個日程')
  expect(names[0]).toContain('1 件待辦')
})

it.each([['2026-11-01', '11/1'], [date, '23'], ['2026-12-01', '12/1']])('月曆 %s 從顯示的日期開始報，再補充完整日期和日程', (day, num) => {
  const view = Object.create(CalendarView.prototype)
  view.date = date
  view.store = {
    today: date, selectedDate: date,
    daySummary: () => ({ allDay: [], events: [{ title: '讀書會', color: 0 }], tasks: [], life: { items: [] }, habits: { total: 0 } }),
    datesOn: () => [], milestoneDues: () => [], subChargesOn: () => [],
  }
  const html = view._cell(day, day === '2026-12-01', 3, [])
  expect(html).toContain(`<span class="cc-top"><b class="cc-num">${num}</b>`)
  expect(html).toContain('>讀書會</span>')
  expect(html).not.toMatch(/<button[^>]*aria-label(?:ledby)?=/)
  const desc = html.match(/aria-describedby="([^"]+)"/)?.[1]
  expect(desc).toBeTruthy()
  expect(html).toContain(`id="${desc}" hidden>${+day.slice(5, 7)} 月 ${+day.slice(8)} 日`)
  expect(html).toContain('1 個日程')
})

it('沒解鎖的衣裝從顯示的等級開始報，再接衣裝名字和解鎖條件', () => {
  const box = {}
  vi.stubGlobal('document', { querySelector: (s) => s === '#bondBox' ? box : {} })
  reviewMethods.renderBond.call({ store: { bond: { level: 1, pts: 0, next: 8 }, player: { bond: {} } } })
  const locked = [...box.innerHTML.matchAll(/disabled aria-label="([^"]+)"[^>]*><small>(Lv\.\d+)<\/small>/g)]
  expect(locked).toHaveLength(12)
  for (const [, name, visible] of locked) expect(name.startsWith(`${visible}，`)).toBe(true)
  expect(locked[0][1]).toContain('花冠')
  expect(locked[0][1]).toContain('解鎖')
})

it('前三要務的編輯鈕用畫面上的任務名稱和附註報讀', () => {
  const view = Object.create(TodayView.prototype)
  view.store = { isSample: () => true }
  view.hooks = {}
  const html = view._topHTML(date, [{ id: 't1', title: '貓咪 & 讀書會', tag: 'life' }])
  const button = html.match(/<button[^>]*data-type="task"[\s\S]*?<\/button>/)?.[0]
  expect(button).toContain('<span><em class="ex-tag">範例</em>貓咪 &amp; 讀書會</span>')
  expect(button).toContain('還不是本命')
  expect(button).not.toMatch(/aria-label(?:ledby)?=/)
})

it('月曆從 h2 接到 h3，窗內的表頭用一般容器', () => {
  const element = { addEventListener() {} }
  const root = { ...element, setAttribute() {}, querySelector: () => element }
  vi.stubGlobal('addEventListener', () => {})
  const view = new CalendarView(root, { selectedDate: date }, {})
  expect(root.innerHTML).toContain('<div class="cal-head">')
  expect(root.innerHTML).toContain('<h2 class="cal-title"></h2>')
  expect(view._sec('日程', 'よてい', '0/1', '')).toContain('<h3>日程<small>よてい</small><span>0/1</span></h3>')
})

it('今日摘要窗內的表頭用一般容器', () => {
  const view = Object.create(BriefView.prototype)
  const el = { classList: { add() {}, remove() {} } }
  view.card = { ...el, focus() {}, getBoundingClientRect: () => ({ left: 0, width: 300 }) }
  view.root = { ...el }
  view._timers = []
  view.hooks = { data: () => ({ now: new Date(`${date}T12:00:00`), today: date }), coat: () => '' }
  view.cat = { show() {}, callTo() {}, cat: { still: true } }
  view._type = () => {}
  vi.stubGlobal('document', { activeElement: null })
  view.show()
  expect(view.card.innerHTML).toContain('<div class="bf-head">')
})

it('花費柱有完整日期、台幣金額和選取狀態；沒花費的日子也能選', () => {
  const view = Object.create(LifeView.prototype)
  view.date = date
  view.el = { spend: {} }
  view.store = { today: date, lifeOn: (day) => ({ items: day === date ? [{ kind: 'spend', amount: 1234 }] : [] }) }
  view._renderSpend()
  const html = view.el.spend.innerHTML
  expect(html).toMatch(/data-day="2026-11-23"[^>]*aria-pressed="true"[^>]*aria-label="[^"]*11 月 23 日星期一[^"]*NT\$ 1,234/)
  expect(html).toMatch(/data-day="2026-11-22"[^>]*aria-pressed="false"[^>]*aria-label="[^"]*11 月 22 日星期日[^"]*未記花費/)
})

it('睡眠柱有完整日期、就寢和起床時間、睡多久、是否選取；空白日也有名字', () => {
  const view = Object.create(LifeView.prototype)
  view.date = date
  view.el = { chart: {}, stats: {}, sleepCount: {} }
  view.store = { today: date, state: { sleep: { [date]: { bed: '23:30', wake: '07:15' } } } }
  view._renderSleep()
  const html = view.el.chart.innerHTML
  expect(html).toMatch(/data-day="2026-11-23"[^>]*aria-pressed="true"[^>]*aria-label="[^"]*11 月 23 日星期一[^"]*23:30[^"]*07:15[^"]*7 小時 45 分/)
  expect(html).toMatch(/data-day="2026-11-22"[^>]*aria-pressed="false"[^>]*aria-label="[^"]*11 月 22 日星期日[^"]*還沒記錄/)
})

const css = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const styles = css('styles.css')
const sakura = styles.match(/--sakura:\s*(#[\da-f]+)/i)[1]
const color = (value) => value === 'var(--sakura)' ? sakura : value
function luminance(hex) {
  const digits = hex.slice(1)
  const rgb = (digits.length === 3 ? [...digits].map((x) => x + x) : digits.match(/../g)).map((x) => parseInt(x, 16) / 255)
  return rgb.reduce((sum, c, i) => sum + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4), 0)
}
function contrast(fg, bg) {
  const a = luminance(color(fg))
  const b = luminance(color(bg))
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

it('總覽的日文小標在日夜 App 卡片上都至少有 4.5:1', () => {
  const rules = css('ui/today.css')
  const day = rules.match(/^\.td-h h3 small \{[^}]*?\bcolor:\s*([^;]+);/m)[1]
  const night = rules.match(/^body\.night \.td-h h3 small \{[^}]*?\bcolor:\s*([^;]+);/m)?.[1] ?? day
  const card = (selector) => styles.match(new RegExp(`${selector} \\{[^}]*--card-bg:\\s*(#[\\da-f]+)`, 'i'))[1]
  expect(contrast(day, card('body\\.app-mode'))).toBeGreaterThanOrEqual(4.5)
  expect(contrast(night, card('body\\.app-mode\\.night'))).toBeGreaterThanOrEqual(4.5)
})

it('月曆今天的日期和粉底至少有 4.5:1', () => {
  const rule = css('ui/calendar.css').match(/\.cal-cell\.is-today \.cc-num \{([^}]+)\}/)[1]
  const fg = rule.match(/\bcolor:\s*([^;]+);/)[1]
  const bg = rule.match(/\bbackground:\s*([^;]+);/)[1]
  expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
})

it('月曆日間的星期日和花費金額都至少有 4.5:1', () => {
  const rules = css('ui/calendar.css')
  const sunday = rules.match(/^\.is-sun \.cc-num \{ color: (#[\da-f]+);/m)[1]
  const amount = rules.match(/^\.cd-amt \{[^}]*\bcolor: (#[\da-f]+);/m)[1]
  expect(contrast(sunday, '#feffff')).toBeGreaterThanOrEqual(4.5)
  expect(contrast(amount, '#feffff')).toBeGreaterThanOrEqual(4.5)
})
