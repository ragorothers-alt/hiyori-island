import { expect, it } from 'vitest'
import { LifeView } from '../src/ui/life.js'

const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`
const plus = (d, n) => {
  const x = new Date(`${d}T12:00:00`)
  x.setDate(x.getDate() + n)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

it.each(['2026-10-10', '2026-10-11', '2026-10-16'])('選 %s 時，花費和睡眠都畫到那一天為止的七天、標出起迄日，最右邊就是選的那一天', (date) => {
  const view = Object.create(LifeView.prototype)
  view.date = date
  view.el = { spend: {}, chart: {}, stats: {}, sleepCount: {} }
  view.store = {
    today: '2026-11-22',
    lifeOn: (d) => ({ items: [{ kind: 'spend', amount: d === '2026-10-10' ? 45 : 0 }] }),
    state: { sleep: { '2026-10-10': { bed: '23:30', wake: '07:30' } } },
  }
  view._renderSpend()
  view._renderSleep()
  const days = [-6, -5, -4, -3, -2, -1, 0].map((n) => plus(date, n))
  for (const chart of [view.el.spend, view.el.chart]) {
    expect([...chart.innerHTML.matchAll(/data-day="([^"]+)"/g)].map((m) => m[1])).toEqual(days)
    expect(chart.innerHTML).toContain(` sel" data-day="${date}"`)
  }
  const label = `${md(days[0])} – ${md(date)}`
  expect(view.el.spend.innerHTML).toContain(label)
  expect(view.el.sleepCount.textContent).toContain(label)
  expect(view.el.spend.innerHTML).toContain('合計 NT$ 45')
  expect(view.el.stats.innerHTML).toContain('23:30')
})

it('看今天（或選了以後的日子）：近 7 天、到今天為止', () => {
  for (const date of ['2026-11-22', '2026-11-30']) {
    const view = Object.create(LifeView.prototype)
    view.date = date
    view.el = { spend: {}, chart: {}, stats: {}, sleepCount: {} }
    view.store = { today: '2026-11-22', lifeOn: () => ({ items: [{ kind: 'spend', amount: 10 }] }), state: { sleep: {} } }
    view._renderSpend()
    view._renderSleep()
    expect(view.el.spend.innerHTML).toContain('近 7 天的花費')
    expect(view.el.sleepCount.textContent).toContain('11/16 – 11/22')
    expect([...view.el.spend.innerHTML.matchAll(/data-day="([^"]+)"/g)].at(-1)[1]).toBe('2026-11-22')
  }
})
