// 週報的習慣洞察：從任務的完成時間、每天的專注紀錄、習慣打卡看出你的步調。純函式，方便測試。
// 資料不夠（最近四週有在用的日子少於 5 天）時，改成依作息推測，並標上 guess。
import { rate, streak } from './habits.js'
import { PEAKS } from './planner.js'
import { WEEK_ZH, pullOf } from './theme.js'
import { MOTTO_EVERY } from './mottos.js'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (date, n) => {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return ymd(d)
}
const pct = (v) => Math.round(v * 100)
// 照建議調整過（acted：調整的那天）：只有之後的紀錄算新的證據。回傳要往回看幾天（今天算一天、調整那天不算），最多 days。
// 不然同一批紀錄會在按下去之後馬上又建議下一格（25 → 20 → 15 分），一路調下去
const freshDays = (today, acted, days) => {
  if (!acted) return days
  const n = Math.round((new Date(today + 'T00:00:00') - new Date(acted + 'T00:00:00')) / 864e5)
  return Math.max(0, Math.min(days, n))
}

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

// 最近 days 天的回神紀錄：警語提醒了幾次、之後回到正事幾次、本來就在做正事幾次
export function mottoStats(history, today, days = 14) {
  const out = { nudges: 0, backs: 0, onTask: 0 }
  for (let i = 0; i < days; i++) {
    const h = history[addDays(today, -i)]
    if (h) for (const k of Object.keys(out)) out[k] += h[k] || 0
  }
  return out
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

// 回傳 [{ id, kanji, title, text, guess?, action? }]；action：{ kind: 'peak', value, label } 一鍵把作息的精神時段改掉、
// { kind: 'mottoEvery', value, label } 一鍵把警語的提醒間隔拉長、{ kind: 'focusMin', value, label } 一鍵把專注一輪縮短。
// mottoEvery：現在幾分鐘提醒一次（0 是不提醒）；focusMin：倒數計時一輪幾分鐘（正向計時是 0）；
// acted：{ pull, motto } 上次照建議縮短一輪、拉長間隔的那天（設定的 pullActed、mottoActed）
export function buildInsights({ tasks, history, habits, rhythm, today, mottoEvery = 0, focusMin = 0, acted = {} }) {
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
  // 長期任務本來就沒排在哪一天，以前挪過的次數不算
  const stuck = tasks.filter((t) => !t.done && !t.ongoing && (t.moved || 0) >= 2).sort((a, b) => b.moved - a.moved)
  if (stuck.length) {
    out.push({ id: 'moved', kanji: '挪', title: `有 ${stuck.length} 件任務常被往後挪`, text: `像「${stuck[0].title}」已經挪了 ${stuck[0].moved} 次。拆成小一點的步驟，會比較好開始。` })
  }

  // 6. 警語的回神紀錄（最近兩週提醒了 8 次以上才說）：多半本來就在做正事 → 間隔可以拉長；常常沒接住 → 試試只做 5 分鐘
  const m = mottoStats(history, today)
  if (m.nudges >= MOTTO_ENOUGH) {
    const back = Math.min(m.nudges, m.backs + m.onTask)
    // 照這裡拉長過間隔：之後又提醒了夠多次才再建議拉長
    const since = freshDays(today, acted.motto, 14)
    const again = since >= 14 || mottoStats(history, today, since).nudges >= MOTTO_ENOUGH
    const longer = mottoEvery > 0 && again ? MOTTO_EVERY.find((v) => v > mottoEvery) : null
    const longerAction = longer ? { kind: 'mottoEvery', value: longer, label: `改成${everyText(longer)}提醒一次` } : null
    if (m.onTask / m.nudges >= 0.6) {
      out.push({
        id: 'motto', kanji: '戒', title: '提醒的時候，你多半已經在做正事了',
        text: `最近兩週提醒了 ${m.nudges} 次，有 ${m.onTask} 次你本來就在做。${longerAction ? '間隔可以拉長一點，少被打斷。' : '照這個節奏就好。'}`,
        action: longerAction,
      })
    } else if (back / m.nudges < 0.3) {
      out.push({
        id: 'motto', kanji: '戒', title: '提醒常常沒接住',
        text: `最近兩週提醒了 ${m.nudges} 次，回神 ${back} 次。下次提醒時試試「只做 5 分鐘」，先開個頭就好；覺得太吵的話，間隔拉長一點也沒關係。`,
        action: longerAction,
      })
    } else {
      out.push({
        id: 'motto', kanji: '戒', title: `警語幫你回神了 ${back} 次`,
        text: `最近兩週提醒了 ${m.nudges} 次，${pct(back / m.nudges)}% 的時候你回到了正事${m.onTask ? `（其中 ${m.onTask} 次本來就在做）` : ''}。照這個節奏就好。`,
      })
    }
  }

  // 7. 想分心時最常想去做什麼（最近兩週，「先等一分鐘」上點的；3 次以上才說）：給對應的小建議。
  // 最常是「休息一下」、而且是倒數計時：一鍵把一輪縮短 5 分鐘（最短 15 分）
  const pulls = pullStats(history, today)
  const most = top(pulls)
  if (most && most[1] >= PULL_ENOUGH) {
    const p = pullOf(most[0])
    // 照這裡縮短過一輪：之後又記了夠多次「休息一下」才再建議縮短
    const since = freshDays(today, acted.pull, 14)
    const again = since >= 14 || (pullStats(history, today, since).rest || 0) >= PULL_ENOUGH
    const shorter = p.id === 'rest' && focusMin >= 20 && again ? focusMin - 5 : 0
    const wait = p.id === 'rest' && focusMin >= 20 && !again
    out.push({
      id: 'pull', kanji: '念', title: `想分心時，最常想去${p.label}`,
      text: `最近兩週有 ${most[1]} 次。${p.tip}${wait ? '一輪的長度前陣子調整過了，先照這樣再看幾天。' : ''}`,
      action: shorter ? { kind: 'focusMin', value: shorter, label: `一輪改成 ${shorter} 分鐘` } : null,
    })
  }
  return out
}

// 回神紀錄要多少次提醒才看得出傾向
export const MOTTO_ENOUGH = 8
// 想分心時想去做的事要記幾次才說
export const PULL_ENOUGH = 3

// 最近 days 天想分心時想去做什麼（每天的 pulls 加起來）：{ PULLS 的 id: 次數 }
export function pullStats(history, today, days = 14) {
  const out = {}
  for (let i = 0; i < days; i++) {
    const h = history[addDays(today, -i)]
    for (const [k, n] of Object.entries(h?.pulls || {})) if (pullOf(k)) out[k] = (out[k] || 0) + n
  }
  return out
}
const everyText = (v) => (v >= 60 ? `每 ${v / 60} 小時` : `每 ${v} 分鐘`)

