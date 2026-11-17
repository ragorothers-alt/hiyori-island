import { awake, toM } from '../src/planner.js'

const verdict = (id, errors, pass) => ({ id, ok: errors.length === 0, detail: errors.length ? errors.join('；') : pass })
const changes = (ctx) => (ctx.entry?.changes || []).map((c) => c.u).filter(Boolean)
const taskOf = (ctx, id) => ctx.store.state.tasks.find((t) => t.id === id)
const overlap = (a, b, c, d) => a < d && c < b
const label = (t) => `「${t.title}」${t.date} ${t.at || '未排時段'}`
const duration = (t) => t.dur || 30
const scheduled = (ctx) => [...new Set(changes(ctx).filter((u) => u.k === 'add' || (u.k === 'task' && u.after?.at)).map((u) => u.id))].map((id) => taskOf(ctx, id)).filter((t) => t?.at)
const automatic = (ctx) => (ctx.result.run || ctx.data.run) !== 'chat'

export function slot(ctx) {
  const errors = []
  const { store } = ctx
  for (const t of scheduled(ctx)) {
    const start = toM(t.at)
    const end = start + duration(t)
    for (const e of store.eventsOn(t.date).filter((e) => !e.allDay)) {
      if (overlap(start, end, toM(e.start), toM(e.end))) errors.push(`${label(t)} 與日程「${e.title}」${e.start}-${e.end} 重疊`)
    }
    for (const other of store.state.tasks.filter((x) => x.id !== t.id && x.date === t.date && !x.done && x.at)) {
      if (overlap(start, end, toM(other.at), toM(other.at) + duration(other))) errors.push(`${label(t)} 與任務${label(other)} 重疊`)
    }
    if (automatic(ctx)) {
      const rhythm = store.state.rhythm
      const [wake, bed] = awake(rhythm)
      if (start < wake || end > bed) errors.push(`${label(t)}（${duration(t)} 分鐘）超出起床 ${rhythm.wake} 到就寢 ${rhythm.sleep}`)
      for (const meal of rhythm.meals || []) {
        if (overlap(start, end, toM(meal.start), toM(meal.end))) errors.push(`${label(t)} 壓到${meal.label || '用餐'} ${meal.start}-${meal.end}`)
      }
    }
  }
  return verdict('slot', errors, '這次排入的時段沒有衝突，自己整理也避開睡眠與三餐')
}

export function fill(ctx) {
  const errors = []
  if (automatic(ctx)) {
    const fresh = new Set(changes(ctx).filter((u) => u.k === 'add' || (u.k === 'task' && !u.before?.at)).map((u) => u.id))
    const totals = new Map()
    for (const t of scheduled(ctx).filter((t) => fresh.has(t.id) && !t.star && t.priority !== 3)) {
      const day = totals.get(t.date) || { minutes: 0, titles: [] }
      day.minutes += duration(t)
      day.titles.push(t.title)
      totals.set(t.date, day)
    }
    for (const [date, day] of totals) {
      const free = (ctx.data.days.find((d) => d.date === date)?.free || []).reduce((n, range) => {
        const [a, b] = range.split('-').map(toM)
        return n + b - a
      }, 0)
      const limit = free * 0.7 + 15
      if (day.minutes > limit) errors.push(`${date}「${day.titles.join('、')}」新排 ${day.minutes} 分鐘，超過空檔 ${free} 分鐘的七成加 15（${limit.toFixed(1)} 分鐘）`)
    }
  }
  return verdict('fill', errors, automatic(ctx) ? '新排的普通任務沒有超過每日留白上限' : '對話不檢查留白上限')
}

export function due(ctx) {
  const errors = []
  if (automatic(ctx)) {
    const touched = new Set(changes(ctx).flatMap((u) => [u.id, ...(u.k === 'split' ? (u.made || []).map((m) => m.id) : [])]))
    for (const t of ctx.store.state.tasks.filter((t) => touched.has(t.id) && t.due && t.date > t.due)) errors.push(`${label(t)} 超過截止日 ${t.due}`)
  }
  return verdict('due', errors, automatic(ctx) ? '動過或新增的任務沒有排過截止日' : '對話不檢查截止日限制')
}

export function sample(ctx) {
  const errors = []
  if (automatic(ctx)) {
    const samples = ctx.sampleProjects || ctx.store.state.projects.filter((p) => p.id.startsWith('ex-') && p.mine !== true && ctx.data.projects.some((x) => x.sample && x.name === (p.name.length > 30 ? `${p.name.slice(0, 29)}…` : p.name)))
    const ids = new Set(samples.map((p) => p.id))
    for (const u of changes(ctx)) {
      const t = taskOf(ctx, u.id)
      if (u.k === 'add' && t && ids.has(t.project)) errors.push(`${label(t)} 新增到範例專案`)
      if (u.k === 'msteps' && ids.has(u.pid)) {
        const project = samples.find((p) => p.id === u.pid)
        const milestone = project.milestones?.find((m) => m.id === u.mid)
        errors.push(`範例專案「${project.name}」的里程碑「${milestone?.title || u.mid}」被加細項`)
      }
      if (t && ids.has(t.project) && ((u.k === 'star' && u.on) || (u.k === 'add' && t.star) || (u.k === 'task' && !u.before?.star && u.after?.star))) errors.push(`${label(t)} 被設成範例專案的本命`)
    }
  }
  return verdict('sample', errors, automatic(ctx) ? '沒有替範例專案新增任務、細項或本命' : '對話可依使用者要求操作範例專案')
}

const sayOf = (ctx) => ctx.result.response?.out?.say ?? ctx.act.say ?? ''
// 用 UTC 的日曆日期推星期，避免時區與日光節約時間干擾；年份以 today 附近的有效日期決定。
function nearestDate(today, month, day) {
  const anchor = new Date(`${today}T00:00:00Z`)
  const year = anchor.getUTCFullYear()
  const lo = new Date(anchor)
  const hi = new Date(anchor)
  lo.setUTCMonth(lo.getUTCMonth() - 6)
  hi.setUTCMonth(hi.getUTCMonth() + 6)
  return [year - 1, year, year + 1].map((y) => new Date(Date.UTC(y, month - 1, day)))
    .filter((d) => d.getUTCMonth() === month - 1 && d.getUTCDate() === day && d >= lo && d <= hi)
    .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0]
}

export function weekday(ctx) {
  const errors = []
  const text = sayOf(ctx)
  const today = ctx.store.today
  for (const match of text.matchAll(/(\d{1,2})\/(\d{1,2})\s*(?:[（(]\s*(?:星期|週)?([日天一二三四五六])\s*[）)]|(?:星期|週)([日天一二三四五六]))/g)) {
    const date = nearestDate(today, +match[1], +match[2])
    const word = (match[3] || match[4]).replace('天', '日')
    if (!date || '日一二三四五六'[date.getUTCDay()] !== word) errors.push(`「${match[0]}」星期不符${date ? `，${date.toISOString().slice(0, 10)} 是週${'日一二三四五六'[date.getUTCDay()]}` : '或日期不在前後半年內'}`)
  }
  for (const match of text.matchAll(/(今天|明天)\s*[（(]\s*(\d{1,2})\/(\d{1,2})\s*[）)]/g)) {
    const date = new Date(`${today}T00:00:00Z`)
    if (match[1] === '明天') date.setUTCDate(date.getUTCDate() + 1)
    if (+match[2] !== date.getUTCMonth() + 1 || +match[3] !== date.getUTCDate()) errors.push(`「${match[0]}」日期不符，應為 ${date.toISOString().slice(0, 10)}`)
  }
  return verdict('weekday', errors, '回話中的日期、星期與今天／明天相符')
}

export function say(ctx) {
  const errors = []
  const text = sayOf(ctx)
  // 說明寫的是 90、200 字；多一兩個字不算錯（看的是有沒有長篇大論）
  const limit = automatic(ctx) ? 100 : 210
  if ([...text].length > limit) errors.push(`回話共 ${[...text].length} 字，超過 ${limit} 字`)
  const alias = text.match(/(?<![A-Za-z0-9_])[A-Za-z]\d+(?![A-Za-z0-9_])/)
  if (alias) errors.push(`回話含代號「${alias[0]}」`)
  if (/```\s*json\b|[\[{]\s*(?:"[^"\n]+"\s*:|[\[{]|"[^"\n]*"\s*[,\]])|\{\s*\}|\[\s*(?:\]|-?\d|true\b|false\b|null\b)/i.test(text)) errors.push('回話含 JSON 格式內容')
  return verdict('say', errors, text ? `回話在 ${limit} 字內，沒有 JSON 或代號` : '沒有回話，略過文字檢查')
}

export const dropped = ({ result }) => ({ id: 'dropped', ok: result.droppedCount === 0, detail: result.droppedCount === 0 ? '清洗沒有丟掉動作' : `清洗丟掉 ${result.droppedCount} 個動作` })
export const undo = ({ result }) => ({ id: 'undo', ok: result.undoEqual === true, detail: result.undoEqual === true ? '撤銷後已回到原狀' : `撤銷後仍有差異：${(result.undoDiff || []).map((d) => d.path).join('、') || '未確認還原'}` })

export const runChecks = (ctx) => [slot, fill, due, sample, weekday, say, dropped].map((check) => check(ctx))
