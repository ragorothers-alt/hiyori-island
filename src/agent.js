// 自主的ふじ：不用按按鈕，自己看現在該幫什麼忙（純函式；資料的讀寫在 store/agent.js，什麼時候叫在 agentRunner.js）。
//   agentContext(store, run, extra)：把今天起 7 天的狀況整理成一份給 Claude 的資料（Worker 的 agent 工作，見 worker/src/ai.js）。
//     任務、專案、里程碑的 id 換成短代號（t1、p1、m1）：省字，也認得出 Claude 編出來的 id。
//   cleanOut(out, ids)：Claude 回的那批動作換回真正的 id，格式不對的丟掉。真的動資料之前 store.agentApply 會再檢查一次。
//   dueRun(...)：現在該不該自己整理一次（早上、晚上、進度落後）。
import { toM, toHHMM, gaps, busyOf, awake, bedAt, taskDur, PEAKS } from './planner.js'
import { addDays, parseDate, daysBetween } from './store/util.js'
import { projectStats } from './projects.js'
import { worldOf, cleanOps, saneOps, hasOps } from './agentOps.js'

export const AGENT_RUNS = ['morning', 'replan', 'capture', 'evening', 'chat']
// 自己整理（不是使用者開口）時不能做的事：勾完成、刪任務、加日程、加重要日子
export const CHAT_ONLY = ['done', 'drop', 'events', 'dates']
export const AGENT_DAYS = 7
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const TAG_IDS = ['work', 'study', 'life', 'health', 'idea']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const pad = (n) => String(n).padStart(2, '0')
const roundUp = (m, step = 5) => Math.ceil(m / step) * step
// 那一週的星期一
export const weekOf = (date) => addDays(date, -((parseDate(date).getDay() + 6) % 7))

// 短代號 ↔ 真正的 id
class Alias {
  constructor() {
    this.to = new Map()
    this.from = new Map()
    this.n = {}
  }
  of(kind, id, extra = null) {
    // 子任務、細項、進度這些的 id 只在上層裡面不重複：上層的 id 也算進去（兩件任務各有一個 id 一樣的子任務時是兩個代號）
    const key = extra ? `${kind}:${id}:${JSON.stringify(extra)}` : `${kind}:${id}`
    if (!this.to.has(key)) {
      const a = `${kind}${(this.n[kind] = (this.n[kind] || 0) + 1)}`
      this.to.set(key, a)
      this.from.set(a, extra ? { id, ...extra } : { id })
    }
    return this.to.get(key)
  }
  // 代號對不上（Claude 編的、打錯的）是 null
  real(alias, kind) {
    const a = String(alias ?? '').trim()
    return a.startsWith(kind) ? this.from.get(a) || null : null
  }
}

// 那天還能排的空檔（分鐘區間）：醒著的時間扣掉三餐、日程、排好的任務（含緩衝）；今天只算現在以後
export function freeOn(store, date, nowMin = null) {
  const r = store.state.rhythm
  const [w, s] = awake(r)
  let from = w
  if (date === store.today && nowMin != null) from = Math.max(w, roundUp(nowMin + 5))
  if (date < store.today) return []
  const busy = busyOf({ rhythm: r, date, events: store.timedEventsOn(date), tasks: store.tasksOn(date).filter((t) => t.at && !t.done) })
  return gaps(from, s, busy).filter(([a, b]) => b - a >= 15)
}

const mineOf = (t) => typeof t.coach === 'string' && t.coach.startsWith('a-')
function taskOf(t, ids, fresh) {
  const o = { id: ids.of('t', t.id), title: clip(t.title, 40) }
  if (t.at) o.at = t.at
  if (t.dur) o.dur = t.dur
  o.pri = t.priority
  o.tag = t.tag
  if (t.star) o.star = true
  if (t.first) o.first = true
  if (t.moved) o.moved = t.moved
  if (t.subs?.length) o.steps = `${t.subs.filter((x) => x.done).length}/${t.subs.length}`
  if (t.note) o.note = clip(t.note, 50)
  if (fresh.has(t.id)) o.new = true
  if (mineOf(t)) o.mine = true
  return o
}

// extra：{ why, fresh: 剛加的任務 id, message, history: [{ who: 'me'|'fuji', text }], focusing: 正在專注的任務 id, mode, weekStart }
export function agentContext(store, run, extra = {}, now = new Date()) {
  const s = store.state
  const today = store.today
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const ids = new Alias()
  const fresh = new Set(extra.fresh || [])
  const projName = new Map(s.projects.map((p) => [p.id, p.name]))
  const task = (t) => {
    const o = taskOf(t, ids, fresh)
    if (t.project && projName.has(t.project)) o.project = clip(projName.get(t.project), 20)
    return o
  }
  const r = s.rhythm
  const days = []
  for (let i = 0; i < AGENT_DAYS; i++) {
    const date = addDays(today, i)
    const list = store.tasksOn(date)
    // 一天最多帶 40 件；剛加的排前面（一定要帶到）
    const todo = list.filter((t) => !t.done).sort((a, b) => fresh.has(b.id) - fresh.has(a.id)).slice(0, 40)
    const done = list.filter((t) => t.done)
    const d = {
      date,
      weekday: WEEK[parseDate(date).getDay()],
      free: freeOn(store, date, nowMin).map(([a, b]) => `${toHHMM(a)}-${toHHMM(b)}`),
      events: store.timedEventsOn(date).filter((e) => !e.done).slice(0, 20).map((e) => `${e.start}-${e.end} ${clip(e.title, 30)}`),
      tasks: todo.map(task),
    }
    const allDay = store.allDayOn(date).map((e) => clip(e.title, 30))
    if (allDay.length) d.allDay = allDay.slice(0, 5)
    if (i === 0 && done.length) d.done = done.slice(0, 15).map((t) => clip(t.title, 30))
    days.push(d)
  }
  const overdue = store
    .overdue()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)
    .map((t) => ({ ...task(t), date: t.date, late: daysBetween(t.date, today) }))
  const projects = s.projects
    .filter((p) => !p.archived && !p.completedAt && !p.pausedAt)
    .slice(0, 12)
    .map((p) => {
      const st = projectStats(p, s.tasks)
      const o = { id: ids.of('p', p.id), name: clip(p.name, 30), ms: `${st.msDone}/${st.msTotal}` }
      if (p.goal) o.goal = clip(p.goal, 60)
      if (p.deadline) {
        o.deadline = p.deadline
        o.daysLeft = daysBetween(today, p.deadline)
      }
      const next = p.milestones.find((m) => !m.done)
      if (next) {
        o.next = { id: ids.of('m', next.id, { pid: p.id }), title: clip(next.title, 40), steps: `${(next.steps || []).filter((x) => x.done).length}/${(next.steps || []).length}` }
        if (next.due) o.next.due = next.due
        const todoSteps = (next.steps || []).filter((x) => !x.done).slice(0, 4).map((x) => clip(x.title, 24))
        if (todoSteps.length) o.next.todo = todoSteps
      }
      o.idle = Math.max(0, Math.round((now.getTime() - (st.last || p.createdAt || now.getTime())) / 86400000))
      o.open = s.tasks.filter((t) => t.project === p.id && !t.done).length
      return o
    })
  const y = addDays(today, -1)
  const yTasks = store.tasksOn(y)
  const week = store.weekReport()
  const habits = store.habitsDueToday?.() || []
  const data = {
    run,
    now: `${today} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    today,
    weekday: WEEK[parseDate(today).getDay()],
    mode: extra.mode === 'ask' ? 'ask' : 'auto',
    user: {
      wake: r.wake, sleep: r.sleep,
      meals: (r.meals || []).map((m) => `${m.label} ${m.start}-${m.end}`),
      work: r.work ? { start: r.work.start, end: r.work.end, days: (r.work.days || []).map((d) => WEEK[d]) } : null,
      peak: PEAKS[r.peak] ? `${PEAKS[r.peak].label} ${toHHMM(PEAKS[r.peak].range[0])}-${toHHMM(PEAKS[r.peak].range[1])}` : '',
      buffer: r.buffer || 0,
      focusMin: s.settings.focusMin || 25,
    },
    memory: [...(s.agent?.memory || [])],
    days,
    overdue,
    projects,
    dates: store.upcomingDates(8, 30).map((d) => ({ title: clip(d.title, 30), date: d.date, days: d.days, kind: d.kind })),
    habits: habits.slice(0, 12).map((h) => clip(h.name, 16)),
    stats: {
      streak: store.streak,
      yesterday: { done: yTasks.filter((t) => t.done).length, total: yTasks.length, focusMin: store.peekDay(y).focus || 0 },
      week: { done: week.done, total: week.total, focusMin: week.focus },
      todayFocusMin: store.peekDay(today).focus || 0,
    },
    recent: (s.agent?.log || []).filter((e) => !e.undone).slice(-3).map((e) => ({ at: stamp(e.at), run: e.run, did: e.changes.slice(0, 8).map((c) => c.t) })),
  }
  if (extra.weekStart) data.weekStart = true
  if (extra.why) data.why = clip(extra.why, 200)
  if (fresh.size) data.new = [...fresh].map((id) => ids.to.get(`t:${id}`)).filter(Boolean)
  const f = extra.focusing && s.tasks.find((t) => t.id === extra.focusing)
  if (f) data.focusing = { id: ids.of('t', f.id), title: clip(f.title, 40) }
  if (run === 'chat') {
    data.message = clip(extra.message, 600)
    data.history = (extra.history || []).slice(-10).map((m) => ({ who: m.who === 'me' ? 'user' : 'fuji', text: clip(m.text, 300) }))
    // 對話時什麼都能改：日程、專案、習慣、設定…都帶上（每一筆有代號），還有使用者正在看哪裡（here）
    data.world = worldOf(store, ids, extra.here || null)
    fitData(data)
  }
  return { data, ids }
}

// 送給 Worker 的資料有上限（worker/src/ai.js 的 AI_MAX，120 KB）：用了很久、專案很多時，先拿掉比較不要緊的，再縮短
export const DATA_MAX = 100_000
export function fitData(data, max = DATA_MAX) {
  const size = () => new TextEncoder().encode(JSON.stringify(data)).length
  if (size() <= max) return data
  const w = data.world
  const soon = addDays(data.today, 14)
  const cuts = [
    () => (w.history = []),
    () => (w.doneRecent = []),
    () => (w.later = w.later.slice(0, 10)),
    () => (w.subtasks = []),
    () => w.projects.forEach((p) => (delete p.logs, delete p.notes)),
    () => w.projects.forEach((p) => p.milestones?.forEach((m) => delete m.steps)),
    () => (w.events = w.events.filter((e) => e.date <= soon)),
    () => (w.projects = w.projects.map((p) => ({ id: p.id, name: p.name, status: p.status }))),
    () => data.days.forEach((d) => (d.tasks = d.tasks.slice(0, 15))),
    () => (data.overdue = data.overdue.slice(0, 10)),
  ]
  for (const cut of cuts) {
    cut()
    if (size() <= max) return data
  }
  // 還是太大（每一種都很多）：每一串一次砍一半，直到放得下。對話的前幾句、這一句話留到最後
  const WORLD = ['events', 'later', 'ongoing', 'subtasks', 'projects', 'habits', 'archivedHabits', 'routines', 'dates', 'mottos', 'subscriptions', 'parked', 'life', 'sleep']
  const lists = () => [
    ...WORLD.map((k) => [w, k]),
    [data, 'overdue'], [data, 'projects'], [data, 'recent'], [data, 'dates'], [data, 'habits'], [data, 'memory'],
    ...data.days.flatMap((d) => [[d, 'tasks'], [d, 'events'], [d, 'free'], [d, 'done'], [d, 'allDay']]),
  ]
  for (let i = 0; i < 12 && size() > max; i++) {
    for (const [o, k] of lists()) if (Array.isArray(o?.[k]) && o[k].length) o[k] = o[k].slice(0, Math.floor(o[k].length / 2))
  }
  if (size() > max) data.history = (data.history || []).slice(-2)
  return data
}
const stamp = (at) => {
  const d = new Date(at)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const arr = (v, max = 60) => (Array.isArray(v) ? v.slice(0, max) : [])
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const texts = (v, max, n) => arr(v, n).map((x) => text(x, max)).filter(Boolean)
const mins = (v) => (Number.isFinite(+v) && +v > 0 ? Math.max(5, Math.min(600, Math.round(+v / 5) * 5)) : 0)
const time = (v) => (TIME.test(v) ? toHHMM(Math.min(1435, Math.round(toM(v) / 5) * 5)) : '')

// Claude 回的動作 → 換回真正的 id、清成固定的樣子。對不上的 id、看不懂的日期時間就丟掉那一個動作。
// 自己整理（run 不是 chat）時，只有 chat 能做的事一律拿掉
export function cleanOut(out, ids, run = 'chat') {
  const o = out && typeof out === 'object' ? out : {}
  const chat = run === 'chat'
  const tid = (a) => ids.real(a, 't')?.id || null
  const act = {
    // 對話時可能是在回答問題（這週專注了多久…），可以說長一點
    say: text(o.say, chat ? 600 : 300),
    schedule: [], add: [], steps: [], edit: [], star: [], first: null, msteps: [], next: null,
    remember: texts(o.remember, 80, 5), forget: texts(o.forget, 80, 5),
    done: [], drop: [], events: [], dates: [],
    ask: chat ? texts(o.ask, 16, 3) : [],
    // 任務以外的（日程、專案、習慣、設定…）：只有對話時有
    ops: chat ? cleanOps(o, ids) : null,
  }
  const made = new Set((act.ops?.create || []).filter((c) => c.kind === 'project' && c.ref).map((c) => c.ref))
  const seen = new Set()
  for (const x of arr(o.schedule)) {
    const id = tid(x?.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    act.schedule.push({ id, date: DATE.test(x.date) ? x.date : '', at: time(x.at), dur: mins(x.dur) })
  }
  for (const x of arr(o.add, chat ? 20 : 3)) {
    const title = text(x?.title, 80)
    if (!title) continue
    const a = {
      title, date: DATE.test(x.date) ? x.date : '', at: time(x.at), dur: mins(x.dur), tag: TAG_IDS.includes(x.tag) ? x.tag : 'life',
      project: ids.real(x.project, 'p')?.id || null, steps: texts(x.steps, 80, 8), star: !!x.star,
    }
    // 歸進這一次剛建的專案（create 的 ref）
    if (!a.project && made.has(text(x.project, 16))) a.projectRef = text(x.project, 16)
    act.add.push(a)
  }
  for (const x of arr(o.steps)) {
    const id = tid(x?.id)
    const list = texts(x?.steps, 80, 8)
    if (id && list.length) act.steps.push({ id, steps: list })
  }
  for (const x of arr(o.edit)) {
    const id = tid(x?.id)
    if (!id) continue
    const e = { id }
    // 自己整理時只改分類和歸到哪個專案；標題和優先度是使用者的決定
    if (chat && text(x.title, 80)) e.title = text(x.title, 80)
    if (TAG_IDS.includes(x.tag)) e.tag = x.tag
    if (chat && [1, 2, 3].includes(x.pri)) e.priority = x.pri
    const p = ids.real(x.project, 'p')
    if (p) e.project = p.id
    if (Object.keys(e).length > 1) act.edit.push(e)
  }
  for (const x of arr(o.star)) {
    const id = tid(x?.id)
    if (id) act.star.push({ id, on: !!x.on })
  }
  act.first = tid(o.first)
  act.next = tid(o.next)
  for (const x of arr(o.msteps, 6)) {
    const m = ids.real(x?.ms, 'm')
    const list = texts(x?.steps, 80, 8)
    if (m && list.length) act.msteps.push({ pid: m.pid, mid: m.id, steps: list })
  }
  if (chat) {
    act.done = [...new Set(arr(o.done).map(tid).filter(Boolean))]
    act.drop = [...new Set(arr(o.drop, 20).map(tid).filter(Boolean))]
    for (const x of arr(o.events, 10)) {
      const title = text(x?.title, 80)
      if (title && DATE.test(x.date) && TIME.test(x.start)) act.events.push({ title, date: x.date, start: x.start, end: TIME.test(x.end) ? x.end : '' })
    }
    for (const x of arr(o.dates, 5)) {
      const title = text(x?.title, 30)
      if (title && DATE.test(x.date)) act.dates.push({ title, date: x.date, kind: ['exam', 'due', 'day'].includes(x.kind) ? x.kind : 'due' })
    }
  }
  return act
}
// 這批動作的樣子對不對（每一種都是該有的陣列、欄位是該有的型別）。cleanOut 清出來的一定對；
// 存在裝置上等使用者決定的那一份（重新整理後讀回來的）可能壞掉：不對就整份不要，不會做到一半
const isO = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
const isS = (x) => typeof x === 'string'
const every = (v, ok) => Array.isArray(v) && v.every(ok)
const hhmm = (x) => x === '' || TIME.test(x)
export function saneAct(a) {
  return (
    isO(a) &&
    every(a.schedule, (x) => isO(x) && isS(x.id) && isS(x.date) && hhmm(x.at) && Number.isFinite(x.dur)) &&
    every(a.add, (x) => isO(x) && isS(x.title) && !!x.title.trim() && isS(x.date) && hhmm(x.at) && Number.isFinite(x.dur) && isS(x.tag) && (x.project === null || isS(x.project)) && (x.projectRef === undefined || isS(x.projectRef)) && every(x.steps, isS)) &&
    every(a.steps, (x) => isO(x) && isS(x.id) && every(x.steps, isS)) &&
    every(a.edit, (x) => isO(x) && isS(x.id)) &&
    every(a.star, (x) => isO(x) && isS(x.id) && typeof x.on === 'boolean') &&
    (a.first === null || isS(a.first)) &&
    (a.next === null || isS(a.next)) &&
    every(a.msteps, (x) => isO(x) && isS(x.pid) && isS(x.mid) && every(x.steps, isS)) &&
    every(a.remember, isS) && every(a.forget, isS) && every(a.done, isS) && every(a.drop, isS) &&
    every(a.events, (x) => isO(x) && isS(x.title) && isS(x.date) && TIME.test(x.start) && hhmm(x.end)) &&
    every(a.dates, (x) => isO(x) && isS(x.title) && isS(x.date) && isS(x.kind)) &&
    saneOps(a.ops)
  )
}
// 這批動作裡有沒有要動資料的（只有一句話、建議先做哪一件不算）
export const hasActions = (a) =>
  (!!a && ['schedule', 'add', 'steps', 'edit', 'star', 'msteps', 'remember', 'forget', 'done', 'drop', 'events', 'dates'].some((k) => a[k]?.length)) || !!a?.first || hasOps(a?.ops)

// 在那天找一個放得下的位置：want 是想放的開始時間（分鐘）、dur 是長度、busy 是已經佔掉的區間、[lo, hi] 是可以排的範圍。
// 想放的位置可以就用它；不行就找最近的空檔。放不下回 null
export function fitSlot(want, dur, busy, lo, hi) {
  let best = null
  for (const [a, b] of gaps(lo, hi, busy)) {
    if (b - a < dur) continue
    const at = Math.min(Math.max(want, a), b - dur)
    let s = roundUp(at)
    if (s + dur > b) s = Math.floor(at / 5) * 5
    if (s < a || s + dur > b) continue
    const d = Math.abs(s - want)
    if (best == null || d < best.d) best = { s, d }
  }
  return best ? best.s : null
}

// 今天排了時間、已經過了卻還沒做完的任務（正在專注的那件不算）。late：超過結束時間幾分鐘才算
export function lateTasks(tasks, nowMin, { late = 15, focusing = null } = {}) {
  return tasks.filter((t) => !t.done && t.at && t.id !== focusing && toM(t.at) + taskDur(t) + late <= nowMin)
}
// 今天排了時間的任務裡，跟還沒結束的日程撞在一起的
export function clashTasks(tasks, events, nowMin) {
  const live = events.filter((e) => !e.done && toM(e.end) > nowMin)
  return tasks.filter((t) => {
    if (t.done || !t.at) return false
    const a = toM(t.at)
    const b = a + taskDur(t)
    return b > nowMin && live.some((e) => a < toM(e.end) && toM(e.start) < b)
  })
}

// 晚上替明天做準備的時間：就寢前兩個半小時起（最早 19:00）
export const eveningAt = (rhythm) => Math.max(19 * 60, Math.min(bedAt(rhythm), 1440) - 150)
// 早上的整理最早什麼時候做：起床前一個半小時（半夜還沒睡時打開 App，不算新的一天開始）
export const morningAt = (rhythm) => Math.max(0, toM(rhythm.wake) - 90)

// 現在該自己整理哪一種：回傳 { run, why, sig } 或 null。
// ran：{ morning, evening }（那一種上次做的日期，跟著資料同步）；seen：這台裝置已經為了哪些狀況重排過（sig）、上次重排的時間
export function dueRun({ today, nowMin, rhythm, ran = {}, tasks = [], events = [], tomorrow = [], overdue = 0, focusing = null, seen = {}, now = Date.now() }) {
  const eve = eveningAt(rhythm)
  if (nowMin >= morningAt(rhythm) && nowMin < eve && ran.morning !== today) {
    // 今天沒有任何要整理的東西（沒有任務、沒有逾期）也跑：專案的下一步、這一週的準備要看
    return { run: 'morning', why: '' }
  }
  if (nowMin >= eve && ran.evening !== today && (tomorrow.some((t) => !t.done) || tasks.some((t) => !t.done))) {
    return { run: 'evening', why: '' }
  }
  // 進度落後、撞到日程：同一個狀況只重排一次，兩次之間至少隔 40 分鐘
  if (nowMin < eve + 60 && now - (seen.at || 0) >= 40 * 60000) {
    const late = lateTasks(tasks, nowMin, { focusing })
    const clash = clashTasks(tasks, events, nowMin).filter((t) => !late.includes(t))
    if (late.length || clash.length) {
      const sig = [...late, ...clash].map((t) => `${t.id}@${t.at}`).sort().join(',')
      if (sig !== seen.sig) {
        const parts = []
        if (late.length) parts.push(`${late.slice(0, 3).map((t) => `「${clip(t.title, 20)}」排在 ${t.at}`).join('、')}，時間過了還沒做完`)
        if (clash.length) parts.push(`${clash.slice(0, 3).map((t) => `「${clip(t.title, 20)}」（${t.at}）`).join('、')}跟日程撞在一起`)
        return { run: 'replan', why: parts.join('；'), sig }
      }
    }
  }
  return null
}

// 日期的說法：今天、明天、後天、11/18（三）
export function dayWord(date, today) {
  const n = daysBetween(today, date)
  if (n === 0) return '今天'
  if (n === 1) return '明天'
  if (n === 2) return '後天'
  const d = parseDate(date)
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`
}

// 先給使用者看的說法（mode 是 ask 時：還沒套用，只列出打算做什麼）
export function describe(act, store) {
  const title = (id) => clip(store.state.tasks.find((t) => t.id === id)?.title || '', 22)
  const today = store.today
  const out = []
  for (const x of act.schedule) {
    const t = store.state.tasks.find((y) => y.id === x.id)
    if (!t) continue
    const date = x.date || (t.date < today ? today : t.date)
    out.push(`「${title(x.id)}」${x.at ? `排在${dayWord(date, today)} ${x.at}` : `移到${dayWord(date, today)}`}`)
  }
  for (const x of act.add) out.push(`新增「${clip(x.title, 22)}」${x.date ? `（${dayWord(x.date, today)}${x.at ? ` ${x.at}` : ''}）` : ''}`)
  for (const x of act.steps) out.push(`「${title(x.id)}」拆成 ${x.steps.length} 個小步驟`)
  for (const x of act.edit) out.push(`調整「${title(x.id)}」`)
  for (const x of act.star) out.push(`${x.on ? '本命' : '取消本命'}：「${title(x.id)}」`)
  if (act.first) out.push(`先做「${title(act.first)}」`)
  for (const x of act.msteps) out.push(`里程碑加 ${x.steps.length} 個細項`)
  for (const id of act.done) out.push(`完成「${title(id)}」`)
  for (const id of act.drop) out.push(`刪掉「${title(id)}」`)
  for (const x of act.events) out.push(`日程「${clip(x.title, 22)}」（${dayWord(x.date, today)} ${x.start}）`)
  for (const x of act.dates) out.push(`重要日子「${clip(x.title, 22)}」（${dayWord(x.date, today)}）`)
  for (const x of act.remember) out.push(`記住：${clip(x, 30)}`)
  for (const x of act.forget) out.push(`忘掉：${clip(x, 30)}`)
  return out
}
