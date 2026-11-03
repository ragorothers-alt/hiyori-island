// 專案的細節（進度日誌、筆記、里程碑細項）用到的純函式：進度怎麼算、時間軸、統計、筆記排版、匯出成 Markdown。
// store 和介面共用；不碰 DOM，方便測試

// 上限抓寬一點：一般使用碰不到，只防匯入的檔案把存檔撐爆
export const PROJECT_LIMITS = {
  goal: 300, logText: 1000, logs: 1000, logMins: 1440, noteTitle: 60, noteBody: 10000, notes: 100, msNote: 500, steps: 30, stepTitle: 80, focusDays: 400,
}

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const plus = (date, n) => {
  const [y, m, d] = date.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + n))
}
// 時間戳記是哪一天（本地時間）
export const dayOf = (ts) => ymd(new Date(ts))

// 一個里程碑完成了多少：打勾＝1；還沒打勾時，細項和歸在它底下的任務各算一步，看做完了幾步。
// 里程碑本身的勾算最後一步，所以細項全做完、里程碑卻沒勾（被取消了）時不會到 100%
export function msProgress(m, tasks = []) {
  if (m.done) return 1
  const { done, total } = msSteps(m, tasks)
  return total ? done / (total + 1) : 0
}
// 里程碑底下做了幾步（細項＋任務）
export function msSteps(m, tasks = []) {
  const steps = m.steps || []
  return { done: steps.filter((s) => s.done).length + tasks.filter((t) => t.done).length, total: steps.length + tasks.length }
}
export function projectProgress(p, tasks = []) {
  const n = p.milestones.length
  if (!n) return 0
  const by = msTasks(p, tasks)
  return p.milestones.reduce((a, m) => a + msProgress(m, by.get(m.id)), 0) / n
}

const linkedTo = (p, tasks) => tasks.filter((t) => t.project === p.id)

// 任務算在哪個里程碑：編輯時選了就照選的；沒選的自動歸——
// 還沒完成的算「下一個還沒完成的里程碑」，已完成的算「它完成的那時候，還沒完成的第一個里程碑」
// （之後里程碑一個個勾掉，以前做完的任務也不會跑到下一個去）
export function taskMilestone(p, t) {
  const picked = t.ms && p.milestones.find((m) => m.id === t.ms)
  if (picked) return picked
  const at = t.done && t.doneAt ? t.doneAt : Infinity
  return p.milestones.find((m) => !(m.done && (m.doneAt || 0) <= at)) || null
}
// 每個里程碑底下的任務：Map(里程碑 id → [任務])
export function msTasks(p, tasks = []) {
  const by = new Map(p.milestones.map((m) => [m.id, []]))
  for (const t of linkedTo(p, tasks)) {
    const m = taskMilestone(p, t)
    if (m) by.get(m.id).push(t)
  }
  return by
}

// 時間軸：自己寫的進度、完成的里程碑、綁在專案上的任務、專注的分鐘、開工和落成，依日期分組（新的在前）。
// 回傳 [{ date, items: [{ kind: 'log'|'ms'|'task'|'done'|'start', at, ... }], logMins, focus }]
export function projectTimeline(p, tasks = []) {
  const days = new Map()
  const dayEntry = (date) => {
    let d = days.get(date)
    if (!d) days.set(date, (d = { date, items: [], logMins: 0, focus: 0 }))
    return d
  }
  for (const log of p.logs || []) {
    const d = dayEntry(log.date)
    d.items.push({ kind: 'log', at: log.at, log })
    d.logMins += log.mins || 0
  }
  for (const m of p.milestones) if (m.done && m.doneAt) dayEntry(dayOf(m.doneAt)).items.push({ kind: 'ms', at: m.doneAt, milestone: m })
  for (const t of linkedTo(p, tasks)) if (t.done && t.doneAt) dayEntry(dayOf(t.doneAt)).items.push({ kind: 'task', at: t.doneAt, task: t })
  for (const [date, min] of Object.entries(p.focus || {})) if (min > 0) dayEntry(date).focus += min
  if (p.completedAt) dayEntry(dayOf(p.completedAt)).items.push({ kind: 'done', at: p.completedAt })
  if (p.createdAt) dayEntry(dayOf(p.createdAt)).items.push({ kind: 'start', at: p.createdAt })
  // 同一天裡新的在上面；開工永遠在那天最下面，落成排在同一刻完成的里程碑上面
  const rank = (it) => (it.kind === 'start' ? -1 : it.kind === 'done' ? it.at + 0.5 : it.at)
  return [...days.values()]
    .map((d) => ({ ...d, items: d.items.sort((a, b) => rank(b) - rank(a)) }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

// 最新的一則進度（日期新的優先，同一天看寫下的時間）
export function latestLog(p) {
  let best = null
  for (const l of p.logs || []) if (!best || l.date > best.date || (l.date === best.date && l.at > best.at)) best = l
  return best
}

export function projectStats(p, tasks = []) {
  const linked = linkedTo(p, tasks)
  const steps = p.milestones.flatMap((m) => m.steps || [])
  // 最近一次推進：寫進度、完成里程碑或任務（不算只是打開看看）
  let last = 0
  for (const l of p.logs || []) last = Math.max(last, l.at)
  for (const m of p.milestones) if (m.doneAt) last = Math.max(last, m.doneAt)
  for (const t of linked) if (t.done && t.doneAt) last = Math.max(last, t.doneAt)
  return {
    msDone: p.milestones.filter((m) => m.done).length, msTotal: p.milestones.length,
    stepsDone: steps.filter((s) => s.done).length, stepsTotal: steps.length,
    tasksDone: linked.filter((t) => t.done).length, tasksTotal: linked.length,
    focus: Object.values(p.focus || {}).reduce((a, b) => a + b, 0),
    logMins: (p.logs || []).reduce((a, l) => a + (l.mins || 0), 0),
    logs: (p.logs || []).length, notes: (p.notes || []).length,
    last: last || null,
  }
}

// 最近幾週每天推進了多少（熱度格用）：0 沒動、1 一點、2 不少、3 很多
export function activity(p, tasks, today, days = 84) {
  const score = {}
  const bump = (date, n) => (score[date] = (score[date] || 0) + n)
  for (const l of p.logs || []) bump(l.date, 1 + Math.min(2, (l.mins || 0) / 60))
  for (const m of p.milestones) if (m.doneAt) bump(dayOf(m.doneAt), 2)
  for (const t of linkedTo(p, tasks)) if (t.done && t.doneAt) bump(dayOf(t.doneAt), 1)
  for (const [date, min] of Object.entries(p.focus || {})) bump(date, min / 30)
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const date = plus(today, -i)
    const v = score[date] || 0
    out.push({ date, level: !v ? 0 : v < 1.5 ? 1 : v < 3 ? 2 : 3 })
  }
  return out
}

// 分鐘 → 「1 小時 20 分」「45 分」
export function fmtMins(min) {
  const m = Math.round(min)
  if (m < 60) return `${m} 分`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} 小時 ${m % 60} 分` : `${h} 小時`
}

// ── 筆記 ──
// 筆記用一點點 Markdown：# 標題、- 清單、1. 編號、- [ ] 待辦（可以直接打勾）、> 引言、---、**粗體**、`程式碼`、網址
const escHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
function inline(s) {
  return escHTML(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    // 只認 http(s)；先跳脫過了，引號已經變成實體，跑不出 href
    .replace(/https?:\/\/[^\s<>]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
}
// 一般的一段文字（進度日誌）：跳脫、網址變連結、保留換行
export const textHTML = (s) => String(s || '').split('\n').map(inline).join('<br>')
const TASK_RE = /^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/
export function noteHTML(body) {
  const out = []
  let list = null
  const open = (tag) => {
    if (list === tag) return
    close()
    out.push(`<${tag}>`)
    list = tag
  }
  const close = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }
  let gap = false
  String(body || '').split('\n').forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '')
    let m
    if (!line.trim()) {
      close()
      if (!gap && out.length) out.push('<div class="nb-gap"></div>')
      gap = true
      return
    }
    gap = false
    if ((m = line.match(TASK_RE))) {
      open('ul')
      const on = m[1] !== ' '
      out.push(`<li class="nb-task${on ? ' on' : ''}"><button type="button" class="nb-check" data-line="${i}" aria-pressed="${on}" aria-label="${on ? '標成還沒做' : '標成做完了'}"></button><span>${inline(m[2])}</span></li>`)
    } else if ((m = line.match(/^\s*[-*•・](?:\s+(.*))?$/))) {
      // 只有一個「-」（範本裡還沒填的那行）也當成清單的一項
      open('ul')
      out.push(`<li>${inline(m[1] || '')}</li>`)
    } else if ((m = line.match(/^\s*\d+[.)、]\s+(.*)$/))) {
      open('ol')
      out.push(`<li>${inline(m[1])}</li>`)
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      close()
      const h = m[1].length + 3
      out.push(`<h${h}>${inline(m[2])}</h${h}>`)
    } else if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      close()
      out.push('<hr>')
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      close()
      out.push(`<blockquote>${inline(m[1])}</blockquote>`)
    } else {
      close()
      out.push(`<p>${inline(line)}</p>`)
    }
  })
  close()
  return out.join('')
}
// 在預覽裡點待辦的勾：切換第 i 行的 [ ] ↔ [x]
export function toggleNoteLine(body, i) {
  const lines = String(body).split('\n')
  if (lines[i] == null || !TASK_RE.test(lines[i])) return body
  lines[i] = lines[i].replace(/^(\s*[-*]\s+\[)( |x|X)(\])/, (_, a, c, b) => a + (c === ' ' ? 'x' : ' ') + b)
  return lines.join('\n')
}
// 筆記的待辦做了幾項
export function noteTodos(body) {
  let done = 0
  let total = 0
  for (const line of String(body || '').split('\n')) {
    const m = line.match(TASK_RE)
    if (!m) continue
    total++
    if (m[1] !== ' ') done++
  }
  return { done, total }
}
// 列表上顯示的標題和摘要：沒寫標題就拿第一行
const plain = (line) => line.replace(/^\s*(#{1,3}|[-*•・]\s+\[( |x|X)\]|[-*•・]|\d+[.)、]|>)\s*/, '').replace(/\*\*|`/g, '').trim()
export function noteTitle(n) {
  if (n.title.trim()) return n.title.trim()
  const first = String(n.body || '').split('\n').map(plain).find(Boolean)
  return first ? first.slice(0, 40) : '未命名筆記'
}
export function noteSnippet(n, max = 80) {
  const lines = String(n.body || '').split('\n').map(plain).filter(Boolean)
  if (!n.title.trim()) lines.shift()
  return lines.join('　').slice(0, max)
}

// 新筆記的範本
export const NOTE_TEMPLATES = [
  { key: 'blank', label: '空白', title: '', body: '' },
  { key: 'meeting', label: '會議紀錄', title: '會議紀錄', body: '## 討論\n- \n\n## 決定\n- \n\n## 待辦\n- [ ] ' },
  { key: 'idea', label: '想法', title: '想法', body: '## 想做什麼\n\n\n## 為什麼\n\n\n## 下一步\n- [ ] ' },
  { key: 'review', label: '階段回顧', title: '階段回顧', body: '## 做到了\n- \n\n## 卡住的地方\n- \n\n## 接下來\n- [ ] ' },
  { key: 'list', label: '清單', title: '清單', body: '- [ ] \n- [ ] \n- [ ] ' },
]

// ── 匯出成 Markdown ──
const md = (date) => `${+date.slice(5, 7)}/${+date.slice(8)}`
export function projectMarkdown(p, tasks = []) {
  const L = []
  const pct = Math.round(projectProgress(p, tasks) * 100)
  L.push(`# ${p.name}`, '')
  const meta = [`進度 ${pct}%`]
  if (p.deadline) meta.push(`截止 ${p.deadline}`)
  if (p.createdAt) meta.push(`開始於 ${dayOf(p.createdAt)}`)
  if (p.completedAt) meta.push(`落成於 ${dayOf(p.completedAt)}`)
  L.push(meta.join('｜'), '')
  if (p.goal) L.push(...p.goal.split('\n').map((x) => `> ${x}`), '')
  if (p.milestones.length) {
    L.push('## 里程碑', '')
    for (const m of p.milestones) {
      const extra = [m.due && `期限 ${md(m.due)}`, m.done && m.doneAt && `完成於 ${md(dayOf(m.doneAt))}`].filter(Boolean)
      L.push(`- [${m.done ? 'x' : ' '}] ${m.title}${extra.length ? `（${extra.join('・')}）` : ''}`)
      for (const s of m.steps || []) L.push(`  - [${s.done ? 'x' : ' '}] ${s.title}`)
      if (m.note) L.push(...m.note.split('\n').map((x) => `  > ${x}`))
    }
    L.push('')
  }
  const linked = linkedTo(p, tasks).sort((a, b) => a.date.localeCompare(b.date))
  if (linked.length) {
    L.push('## 任務', '')
    for (const t of linked) {
      const m = taskMilestone(p, t)
      L.push(`- [${t.done ? 'x' : ' '}] ${t.title}（${md(t.date)}${m ? `・${m.title}` : ''}）`)
    }
    L.push('')
  }
  const notes = [...(p.notes || [])].sort((a, b) => !!b.pinned - !!a.pinned || b.updatedAt - a.updatedAt)
  if (notes.length) {
    L.push('## 筆記', '')
    for (const n of notes) L.push(`### ${noteTitle(n)}`, '', n.body.trim(), '')
  }
  const days = projectTimeline(p, tasks).filter((d) => d.items.some((it) => it.kind === 'log'))
  if (days.length) {
    L.push('## 進度日誌', '')
    for (const d of days) {
      L.push(`### ${d.date}`, '')
      for (const it of d.items) {
        if (it.kind !== 'log') continue
        const l = it.log
        const ms = l.ms && p.milestones.find((m) => m.id === l.ms)
        const extra = [l.mins && fmtMins(l.mins), ms && `里程碑「${ms.title}」`].filter(Boolean)
        L.push(`- ${l.text.replace(/\n/g, '\n  ')}${extra.length ? `（${extra.join('・')}）` : ''}`)
      }
      L.push('')
    }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
