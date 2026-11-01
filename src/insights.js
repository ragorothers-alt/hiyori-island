// 週報的習慣洞察：從任務的完成時間、每天的專注紀錄、習慣打卡看出你的步調。純函式，方便測試。
// 資料不夠（最近四週有在用的日子少於 5 天）時，改成依作息推測，並標上 guess。
import { rate, streak } from './habits.js'
import { PEAKS } from './planner.js'
import { WEEK_ZH } from './theme.js'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (date, n) => {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return ymd(d)
}
const pct = (v) => Math.round(v * 100)

// 一天分四段：早上 5–12、下午 12–18、晚上 18–24、深夜 0–5；peak 對到作息裡「精神最好的時段」
export const BUCKETS = [
  { id: 'am', label: '早上', range: '5–12 點', peak: 'morning', day: 'focusAm' },
  { id: 'pm', label: '下午', range: '12–18 點', peak: 'afternoon', day: 'focusPm' },
  { id: 'eve', label: '晚上', range: '18–24 點', peak: 'evening', day: 'focusEve' },
  { id: 'late', label: '深夜', range: '0–5 點', peak: null, day: 'focusLate' },
]
const bucketOf = (hour) => (hour < 5 ? 'late' : hour < 12 ? 'am' : hour < 18 ? 'pm' : 'eve')
const top = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]

// 最近 days 天完成的任務，依完成的時間分到四段
export function taskHours(tasks, today, days = 28) {
  const from = addDays(today, -(days - 1))
  const out = { am: 0, pm: 0, eve: 0, late: 0 }
  for (const t of tasks) {
    if (!t.done || !t.doneAt) continue
    const d = new Date(t.doneAt)
    const date = ymd(d)
    if (date >= from && date <= today) out[bucketOf(d.getHours())]++
  }
  return out
}

// 最近 days 天的專注分鐘，依時段加總（每天的 focusAm／Pm／Eve／Late）
export function focusBuckets(history, today, days = 28) {
  const out = { am: 0, pm: 0, eve: 0, late: 0 }
  for (let i = 0; i < days; i++) {
    const h = history[addDays(today, -i)]
    if (h) for (const b of BUCKETS) out[b.id] += h[b.day] || 0
  }
  return out
}

// 最近 weeks 週（不含今天）每個星期幾平均完成幾件任務；index 0 是星期日
export function weekdayRate(history, today, weeks = 4) {
  const sum = Array(7).fill(0)
  const n = Array(7).fill(0)
  for (let i = 1; i <= weeks * 7; i++) {
    const d = addDays(today, -i)
    const wd = new Date(d + 'T00:00:00').getDay()
    sum[wd] += history[d]?.tasks || 0
    n[wd]++
  }
  return sum.map((s, i) => (n[i] ? s / n[i] : 0))
}

// 最近 days 天有在用（完成任務、專注或打卡）的日子
export function activeDays(history, today, days = 28) {
  let n = 0
  for (let i = 0; i < days; i++) {
    const h = history[addDays(today, -i)]
    if (h && (h.tasks || h.focus || h.habits)) n++
  }
  return n
}

// 回傳 [{ id, kanji, title, text, guess?, action? }]；action：{ kind: 'peak', value, label } 一鍵把作息的精神時段改掉
export function buildInsights({ tasks, history, habits, rhythm, today }) {
  const out = []
  const guess = activeDays(history, today) < 5
  const peak = PEAKS[rhythm.peak]

  // 1. 最常完成任務的時段
  const th = taskHours(tasks, today)
  const nTasks = Object.values(th).reduce((a, b) => a + b, 0)
  if (!guess && nTasks >= 5) {
    const [id, n] = top(th)
    const b = BUCKETS.find((x) => x.id === id)
    const action = b.peak && b.peak !== rhythm.peak ? { kind: 'peak', value: b.peak, label: `把精神最好的時段改成${PEAKS[b.peak].label}` } : null
    out.push({
      id: 'taskHour', kanji: '時', title: `你最常在${b.label}完成任務`,
      text: `最近四週完成的 ${nTasks} 件裡，有 ${pct(n / nTasks)}% 在${b.label}（${b.range}）。${
        action ? `作息裡寫的精神時段是${peak?.label || '未設定'}，要不要換成${b.label}？` : b.peak ? '和你設定的精神時段一致，重要的事放這裡剛好。' : '深夜做事很拚，也記得早點睡。'
      }`,
      action,
    })
  } else {
    out.push({
      id: 'taskHour', kanji: '時', guess: true, title: `你說精神最好的是${peak?.label || '上午'}`,
      text: '先照這個時段排重要的事；再完成幾件任務，我就看得出你真正順手的時候。',
    })
  }

  // 2. 最常專注的時段
  const fb = focusBuckets(history, today)
  const nFocus = Object.values(fb).reduce((a, b) => a + b, 0)
  if (nFocus >= 60) {
    const [id, n] = top(fb)
    const b = BUCKETS.find((x) => x.id === id)
    const h = Math.round((nFocus / 60) * 10) / 10
    out.push({ id: 'focusHour', kanji: '灯', title: `專注最多的是${b.label}`, text: `最近四週專注了 ${h} 小時，${pct(n / nFocus)}% 落在${b.label}。${id === 'late' ? '深夜的專注很珍貴，也記得早點睡。' : '番茄鐘可以優先排在這時候。'}` })
  } else {
    out.push({ id: 'focusHour', kanji: '灯', guess: true, title: '還在認識你的專注時段', text: '用番茄鐘專注幾次之後，這裡會畫出你最能專心的時候。' })
  }

  // 3. 哪一天最有效率
  const wr = weekdayRate(history, today)
  if (!guess && Math.max(...wr) > 0) {
    const best = wr.indexOf(Math.max(...wr))
    const low = wr.indexOf(Math.min(...wr))
    out.push({
      id: 'weekday', kanji: '曜', title: `星期${WEEK_ZH[best]}最有效率`,
      text: `平均完成 ${wr[best].toFixed(1)} 件；最輕鬆的是星期${WEEK_ZH[low]}（${wr[low].toFixed(1)} 件）。重要的事可以放在星期${WEEK_ZH[best]}，星期${WEEK_ZH[low]}留點餘裕。`,
    })
  }

  // 4. 習慣：最穩的和常漏掉的
  const builds = habits.filter((h) => h.kind === 'build' && !h.archived)
  if (builds.length) {
    const rated = builds.map((h) => ({ h, r: rate(h, today, 30) })).sort((a, b) => b.r - a.r)
    const best = rated[0]
    const worst = rated[rated.length - 1]
    if (best.r >= 0.5) {
      const tail = rated.length > 1 && worst.r < 0.4 ? `「${worst.h.name}」比較常漏掉（${pct(worst.r)}%），把目標調小一點試試。` : '照這個節奏就很好。'
      const run = streak(best.h, today)
      out.push({ id: 'habit', kanji: '習', title: `最穩的習慣：${best.h.name}`, text: `最近 30 天達成 ${pct(best.r)}%${run > 1 ? `，已經連續 ${run} 天` : ''}。${tail}` })
    } else {
      out.push({ id: 'habit', kanji: '習', title: '習慣還在暖身', text: `最近 30 天最穩的是「${best.h.name}」（${pct(best.r)}%）。先挑一個最小的版本，每天做到就好。` })
    }
  }

  // 5. 常被往後挪的任務
  const stuck = tasks.filter((t) => !t.done && (t.moved || 0) >= 2).sort((a, b) => b.moved - a.moved)
  if (stuck.length) {
    out.push({ id: 'moved', kanji: '挪', title: `有 ${stuck.length} 件任務常被往後挪`, text: `像「${stuck[0].title}」已經挪了 ${stuck[0].moved} 次。拆成小一點的步驟，會比較好開始。` })
  }
  return out
}

