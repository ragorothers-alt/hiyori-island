import { sleepMinutes, toHHMM, toM } from './planner.js'
import { addDays } from './store/util.js'

const DAY = 1440
const TURN = 2 * Math.PI / DAY

function clockMean(minutes) {
  const x = minutes.reduce((sum, m) => sum + Math.cos(m * TURN), 0)
  const y = minutes.reduce((sum, m) => sum + Math.sin(m * TURN), 0)
  // 剛好落在時鐘的相反兩端時，沒有一個有代表性的平均時刻。
  if (Math.hypot(x, y) < 1e-10) return null
  return toHHMM((Math.round(Math.atan2(y, x) / TURN) + DAY) % DAY)
}

// 從時鐘上最長的空白切開，剩下的弧剛好包住這幾晚的就寢時間。
function bedArc(minutes) {
  const sorted = [...minutes].sort((a, b) => a - b)
  let gap = 0
  let start = 0
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1] ?? sorted[0] + DAY
    if (next - sorted[i] > gap) {
      gap = next - sorted[i]
      start = next % DAY
    }
  }
  return { start, spread: sorted.length ? DAY - gap : 0 }
}

// 把時刻放到最靠近基準的那一天，作息設定和實際紀錄才會畫在同一條時間軸上。
export const nearClock = (minute, center) => minute + DAY * Math.round((center - minute) / DAY)

export function sleepStats(log, end, days = 7) {
  const list = Array.from({ length: days }, (_, i) => {
    const date = addDays(end, i + 1 - days)
    const e = log[date]
    return e ? { ...e, date, dur: sleepMinutes(e) } : { date, dur: 0 }
  })
  const nights = list.filter((x) => x.dur)
  const beds = nights.map((x) => toM(x.bed))
  const { start, spread } = bedArc(beds)
  const ratings = nights.filter((x) => x.q)
  return {
    list, n: nights.length, spread, center: nights.length ? start + spread / 2 : null,
    bed: clockMean(beds), wake: clockMean(nights.map((x) => toM(x.wake))),
    avg: nights.length ? Math.round(nights.reduce((sum, x) => sum + x.dur, 0) / nights.length) : 0,
    q: ratings.length ? +(ratings.reduce((sum, x) => sum + x.q, 0) / ratings.length).toFixed(1) : 0,
  }
}
