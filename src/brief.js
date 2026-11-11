// 打開 App 時貓咪說的今日摘要：把今天的任務、日程、習慣和該留意的事整理成幾句話（純函式，畫面在 ui/brief.js）。
// d：{
//   now: Date（現在幾點）, today: 'YYYY-MM-DD'（App 認定的今天；沒給就照 now）,
//   tasks: 今天的任務 [{ id, title, done, star, priority, at }]（priority 3 最高）,
//   overdue: 逾期還沒做的件數,
//   events: 今天有時段的日程 [{ id, title, start, end }]（照開始時間排好）, allDay: 整天的日程 [{ title }],
//   habits: { total, done }（今天要做的習慣）,
//   dates: 快到的重要日子、里程碑、專案截止 [{ title, days, kind, pid, project, projectName }],
//   subs: 快扣款的訂閱 [{ name, days, price, trial }],
//   stuck: 卡住的任務 { title, moved, late } 或 null, idle: 好久沒碰的長期任務 { id, title, idle, pid, projectName } 或 null,
//   streak: 連續天數,
// }
// 回傳 { hello, date, lead, today: [項目], alerts: [項目], bye, first }
//   項目：{ icon, text, sub, go }；go 是點了去哪：['tab', 分頁, 要看的日期（沒寫是今天）]、['project', 專案 id]、['task', 專案 id, 任務 id]
//   first：最該先做的那一件（給「專注這一件」的按鈕），沒有是 null
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const HELLO = { morning: 'にゃ、早安。', noon: 'にゃ、午安。', evening: 'にゃ、晚上好。', night: 'にゃ…這麼晚了。' }
const partOf = (h) => (h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'noon' : h >= 17 && h < 22 ? 'evening' : 'night')
const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}
const clip = (s, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const inDays = (n) => (n <= 0 ? '今天' : n === 1 ? '明天' : n === 2 ? '後天' : `${n} 天後`)
const span = (min) => (min >= 60 ? `${Math.floor(min / 60)} 小時${min % 60 ? ` ${min % 60} 分` : ''}` : `${min} 分鐘`)

// 還沒做的任務照「先做哪一件」排：本命、重要的、排了時間早的
function order(tasks) {
  return tasks
    .filter((t) => !t.done)
    .sort((a, b) => !!b.star - !!a.star || (b.priority || 0) - (a.priority || 0) || (a.at || '99:99').localeCompare(b.at || '99:99'))
}

export function buildBrief(d) {
  const now = d.now
  const mins = now.getHours() * 60 + now.getMinutes()
  const tasks = d.tasks || []
  const todo = order(tasks)
  const done = tasks.length - todo.length
  const events = d.events || []
  // 還沒結束的日程（正在進行的也算）
  const ahead = events.filter((e) => toMin(e.end) > mins)
  const allDay = d.allDay || []

  // ── 第一句 ──
  let lead
  if (!tasks.length && !events.length && !allDay.length) lead = '今天還沒排任何事。想到什麼，先記一件就好。'
  else if (tasks.length && !todo.length && !ahead.length) lead = `今天的 ${tasks.length} 件任務都做完了，了不起。`
  else {
    const parts = []
    if (tasks.length) parts.push(done ? `任務做完 ${done}／${tasks.length} 件` : `有 ${tasks.length} 件任務`)
    if (events.length) parts.push(ahead.length === events.length ? `${events.length} 個日程` : ahead.length ? `還有 ${ahead.length} 個日程` : '日程都結束了')
    if (!parts.length) parts.push(`有整天的日程「${clip(allDay[0].title, 12)}」`)
    lead = `今天${parts.join('、')}。`
  }

  // ── 今天 ──
  const today = []
  if (ahead.length) {
    const e = ahead[0]
    const until = toMin(e.start) - mins
    const more = ahead.length > 1 ? `・之後還有 ${ahead.length - 1} 個` : ''
    today.push({ icon: '時', text: `${e.start} ${e.title}`, sub: (until > 0 ? `還有 ${span(until)}` : `進行中，到 ${e.end}`) + more, go: ['tab', 'schedule'] })
  }
  if (allDay.length) {
    today.push({ icon: '日', text: allDay.slice(0, 2).map((e) => e.title).join('、'), sub: allDay.length > 2 ? `整天・還有 ${allDay.length - 2} 個` : '整天', go: ['tab', 'schedule'] })
  }
  for (const t of todo.slice(0, 3)) {
    today.push({ icon: t.star ? '命' : '花', text: t.title, sub: [t.star ? '本命' : '', t.at || ''].filter(Boolean).join('・'), go: ['tab', 'tasks'] })
  }
  if (todo.length > 3) today.push({ icon: '…', text: `還有 ${todo.length - 3} 件任務`, sub: '', go: ['tab', 'tasks'] })
  const habits = d.habits || { total: 0, done: 0 }
  if (habits.total > habits.done) today.push({ icon: '習', text: `${habits.total - habits.done} 個習慣還沒打卡`, sub: habits.done ? `做了 ${habits.done}／${habits.total}` : '', go: ['tab', 'habits'] })

  // ── 提醒 ──
  const alerts = []
  if (d.overdue > 0) alerts.push({ icon: '遲', text: `${d.overdue} 件任務逾期了`, sub: '挑一件今天做，或改個日子', go: ['tab', 'tasks'] })
  for (const x of (d.dates || []).filter((x) => x.days <= 3).slice(0, 3)) {
    const what = x.pid ? '里程碑' : x.project ? '專案截止' : x.kind === 'exam' ? '考試' : x.kind === 'day' ? '紀念' : '截止'
    alerts.push({
      icon: x.kind === 'exam' ? '考' : x.kind === 'day' ? '祝' : '期',
      text: `${inDays(x.days)}：${x.title}`,
      sub: x.projectName ? `${what}・${x.projectName}` : what,
      go: x.pid ? ['project', x.pid] : x.project ? ['project', x.id] : x.date ? ['tab', 'schedule', x.date] : ['tab', 'schedule'],
    })
  }
  for (const s of (d.subs || []).slice(0, 2)) {
    alerts.push({ icon: '払', text: `${inDays(s.days)}扣款：${s.name}`, sub: [s.price, s.trial ? '免費試用結束' : ''].filter(Boolean).join('・'), go: ['tab', 'records'] })
  }
  // 只是逾期的上面說過了：這裡說一直往後挪的
  if (d.stuck && d.stuck.moved >= 2) alerts.push({ icon: '卡', text: `「${clip(d.stuck.title)}」往後挪了 ${d.stuck.moved} 次`, sub: '要不要拆小一點', go: ['tab', 'tasks'] })
  if (d.idle) alerts.push({ icon: '久', text: `「${clip(d.idle.title)}」${d.idle.idle} 天沒碰`, sub: d.idle.projectName || '', go: ['task', d.idle.pid, d.idle.id] })

  // 日期照 App 認定的今天寫：跟清單裡的內容是同一天
  const [y, mo, da] = /^\d{4}-\d{2}-\d{2}$/.test(d.today || '') ? d.today.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1, now.getDate()]
  return {
    hello: HELLO[partOf(now.getHours())],
    date: `${mo} 月 ${da} 日 星期${WEEK[new Date(y, mo - 1, da).getDay()]}`,
    lead,
    today,
    alerts,
    bye: d.streak >= 2 ? `已經連續 ${d.streak} 天了，今天也慢慢來。` : '今天也慢慢來。',
    first: todo[0] ? { id: todo[0].id, title: todo[0].title } : null,
  }
}
