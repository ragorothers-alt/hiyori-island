import { describe, expect, it } from 'vitest'
import { LifeView } from '../src/ui/life.js'

// 讀紀錄頁真的顯示的數字和柱子，順便確認沒有資料的日子沒算進平均。
function sleepView(beds, wakes) {
  const view = Object.create(LifeView.prototype)
  const sleep = Object.fromEntries(beds.map((bed, i) => [`2026-10-${10 + i}`, { bed, wake: wakes[i], q: 4 }]))
  view.store = { today: '2026-10-11', state: { sleep } }
  view.date = view.store.today
  view.el = { sleepCount: {}, chart: {}, stats: {} }
  view._renderSleep()
  return view.el
}

describe('睡眠時鐘', () => {
  it.each([
    [['11:50', '12:10'], ['19:50', '20:10'], '12:00', '20:00'],
    [['23:50', '00:10'], ['07:50', '08:10'], '00:00', '08:00'],
    [['15:50', '16:10'], ['23:50', '00:10'], '16:00', '00:00'],
  ])('%j 就寢的兩晚，作息只差二十分鐘', (beds, wakes, bed, wake) => {
    const { chart, stats } = sleepView(beds, wakes)
    expect(stats.innerHTML).toContain(`<b>${bed}</b><span>平均就寢`)
    expect(stats.innerHTML).toContain(`<b>${wake}</b><span>平均起床`)
    expect(stats.innerHTML).toContain('差 20 分鐘')
    expect(stats.innerHTML).toContain('規律度 5 / 5')
    const bars = [...chart.innerHTML.matchAll(/class="slp-bar" style="top:([\d.]+)%;height:([\d.]+)%/g)]
    expect(bars).toHaveLength(2)
    // 兩根柱子的高度都是八小時；上緣只差二十分鐘。
    expect(Math.abs(bars[1][1] - bars[0][1]) / Number(bars[0][2])).toBeCloseTo(20 / 480, 2)
  })
})
