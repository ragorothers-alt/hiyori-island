// 對話裡跟ふじ說的話，動到任務以外的東西（src/agentOps.js 清好的 set／create／done／drop）。
// 每一項都走 store 原本的方法（檢查、經驗值、事件都照平常），也都記下撤銷用的紀錄：
//   set  { kind, id…, before, after }：改了哪些欄位、改之前和之後的值（撤銷時只還原還停在「之後」的欄位）。
//        store 順便動到的欄位也記（日程改開始時間時跟著挪的結束時間、恢復訂閱時重算的開始日…）
//   new  { kind, id…, sig }：新增的那一筆剛建好時的樣子（還是那個樣子才刪）
//   gone { kind, id…, item, at }：刪掉的那一筆整筆存成 JSON（照讀存檔的規則清過再放回原本的位置）；專案、習慣不刪，改成收起來（set）
//   tick { kind, id…, date, n }：勾完成（還是勾著的才取消；習慣是那天的次數還一樣才收回一次）
// 撤銷紀錄的格式在 migrate.js 的 cleanUndo，兩邊要一起改。
import { DATE_RE, TIME_RE, isObj, cleanSub, migrate, cleanTask } from './migrate.js'
import { minToHHMM, toMin, DATA_VERSION, REPEAT_TYPES } from './util.js'
import { countOn } from '../habits.js'
import { DATE_KINDS } from '../theme.js'
import { fieldText, okVal, UNDO_GROUPS } from '../agentOps.js'
import { dayWord } from '../agent.js'
import { grantKey } from './grants.js'

const short = (s, n = 22) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)))
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const without = (o, ...ks) => Object.fromEntries(Object.entries(o).filter(([x]) => !ks.includes(x)))
// 撤銷紀錄裡指到那一筆的欄位
const REF_KEYS = ['id', 'pid', 'mid', 'tid', 'date']
// 跨過午夜的日程，ふじ指的是哪一段都換成第一段的 id（K.event.find 找到的那一段）
const headRef = (r, ent) => (r.kind === 'event' && ent.id !== r.id ? { ...r, id: ent.id } : r)
const refOf = (r) => Object.fromEntries(REF_KEYS.filter((k) => r[k] != null && r[k] !== '').map((k) => [k, r[k]]))
const proj = (s, pid) => s._find('projects', pid)
const ms = (s, r) => proj(s, r.pid)?.milestones.find((m) => m.id === (r.mid ?? r.id))
const done = (x) => !!x.done
// 跟 migrate.js 的 AGENT_DROP_MAX 一樣：刪掉的那一筆（和例行公事那幾天）存成的字串最長多少
const ITEM_MAX = 60000

// 每一種：find 找到那一筆、label 給人看的名字、read 讀一個欄位、write 寫一批欄位（走 store 的方法）
const K = {
  task: {
    find: (s, r) => s._find('tasks', r.id),
    label: (s, t) => `「${short(t.title)}」`,
    read: (s, t, f) => (f === 'done' ? done(t) : f === 'first' ? !!t.first : f === 'note' ? t.note || '' : t[f] ?? null),
    write: (s, t, p) => {
      if ('done' in p && done(t) !== p.done) {
        const was = t.date
        s.toggleTask(t.id)
        // 勾回去只有撤銷「取消完成」會走到：長期任務照原本完成的那天記（toggleTask 會記成今天）
        if (p.done && t.done && t.date !== was) {
          t.date = was
          s._finish()
        }
      }
      // 撤銷「取消完成」：完成的時間、自動歸到的里程碑放回原本的（toggleTask 照現在重算）
      if ('doneAt' in p && t.done && typeof p.doneAt === 'number') t.doneAt = p.doneAt
      if ('msAuto' in p && t.done && !t.ms && (p.msAuto === null || proj(s, t.project)?.milestones.some((m) => m.id === p.msAuto))) t.msAuto = p.msAuto
      if ('first' in p) {
        // 先做的那一件一天只有一件：撤銷時那天已經有別件（之後自己挑的）就不搶
        if (!p.first) s.setFirst(t.id, false)
        else if (!s.tasksOn(t.date).some((y) => y !== t && y.first)) s.setFirst(t.id, true)
      }
      const rest = without(p, 'done', 'first', 'doneAt', 'msAuto')
      if (Object.keys(rest).length) s.updateTask(t.id, rest)
    },
  },
  // 跨過午夜存成兩段的日程是一個：哪一段都找到第一段，讀寫的是整個日程（結束是隔天那段的結束；store 的 eventSpan）
  event: {
    find: (s, r) => {
      const e = s._find('events', r.id)
      return e ? s.eventSpan(e).head : null
    },
    label: (s, e) => `日程「${short(e.title)}」`,
    read: (s, e, f) => (f === 'end' ? s.eventSpan(e).end : f === 'done' || f === 'allDay' ? !!e[f] : f === 'note' || f === 'endDate' ? e[f] || '' : e[f]),
    write: (s, e, p) => {
      if ('done' in p && done(e) !== p.done) s.toggleEvent(e.id)
      const rest = without(p, 'done')
      if (Object.keys(rest).length) s.updateEvent(e.id, rest)
    },
  },
  date: {
    find: (s, r) => s._find('dates', r.id),
    label: (s, d) => `重要日子「${short(d.title)}」`,
    read: (s, d, f) => d[f],
    // 跟讀存檔時一樣的規則（名稱最多 30 字、要有字；日期、種類要認得）
    write: (s, d, p) => {
      if (typeof p.title === 'string' && p.title.trim()) d.title = p.title.trim().slice(0, 30)
      if (DATE_RE.test(p.date)) d.date = p.date
      if (DATE_KINDS[p.kind]) d.kind = p.kind
      s._finish()
    },
  },
  project: {
    find: (s, r) => proj(s, r.id),
    label: (s, p) => `專案「${short(p.name, 16)}」`,
    read: (s, p, f) => (f === 'title' ? p.name : f === 'status' ? (p.archived ? 'archived' : p.pausedAt ? 'paused' : 'active') : p[f] || ''),
    write: (s, p, x) => {
      if ('title' in x) s.updateProject(p.id, { name: x.title })
      if ('deadline' in x) s.setDeadline(p.id, x.deadline)
      if ('goal' in x) s.setProjectGoal(p.id, x.goal)
      if (x.status === 'archived' && !p.archived) s.archiveProject(p.id, true)
      else if (x.status === 'active' || x.status === 'paused') {
        // 拿回來：小鎮的地不夠、專案太多的話拿不回來（archiveProject 回傳 false）
        if (p.archived && !s.archiveProject(p.id, false)) return
        if (!p.completedAt) s.pauseProject(p.id, x.status === 'paused')
      }
    },
  },
  milestone: {
    find: (s, r) => ms(s, r),
    label: (s, m) => `里程碑「${short(m.title)}」`,
    read: (s, m, f) => (f === 'done' ? done(m) : m[f] || ''),
    write: (s, m, p, r) => {
      if ('done' in p && done(m) !== p.done) s.toggleMilestone(r.pid, m.id)
      const rest = without(p, 'done')
      if (Object.keys(rest).length) s.updateMilestone(r.pid, m.id, rest)
    },
  },
  step: {
    find: (s, r) => ms(s, r)?.steps.find((x) => x.id === r.id),
    label: (s, x) => `細項「${short(x.title)}」`,
    read: (s, x, f) => (f === 'done' ? done(x) : x[f]),
    write: (s, x, p, r) => {
      if ('title' in p) s.renameStep(r.pid, r.mid, x.id, p.title)
      if ('done' in p && done(x) !== p.done) s.toggleStep(r.pid, r.mid, x.id)
    },
  },
  subtask: {
    find: (s, r) => s._find('tasks', r.tid)?.subs?.find((x) => x.id === r.id),
    label: (s, x) => `子任務「${short(x.title)}」`,
    read: (s, x, f) => (f === 'done' ? done(x) : x[f]),
    write: (s, x, p, r) => {
      if ('title' in p) s.renameSub(r.tid, x.id, p.title)
      if ('done' in p && done(x) !== p.done) s.toggleSub(r.tid, x.id)
    },
  },
  habit: {
    find: (s, r) => s.habit(r.id),
    label: (s, h) => `習慣「${short(h.name, 16)}」`,
    read: (s, h, f) => (f === 'title' ? h.name : f === 'status' ? (h.archived ? 'archived' : 'active') : f === 'days' ? [...(h.days || [])] : h[f]),
    write: (s, h, p) => {
      const patch = {}
      for (const [f, v] of Object.entries(p)) {
        if (f === 'title') patch.name = v
        else if (f === 'status') patch.archived = v === 'archived'
        else patch[f] = v
      }
      s.updateHabit(h.id, patch)
    },
  },
  routine: { find: (s, r) => s._find('routines', r.id), label: (s, r) => `例行公事「${short(r.title)}」`, read: (s, r, f) => r[f], write: () => {} },
  motto: {
    find: (s, r) => s._find('mottos', r.id),
    label: (s, m) => `警語「${short(m.text)}」`,
    read: (s, m, f) => (f === 'on' ? m.on !== false : m.text),
    write: (s, m, p) => {
      if ('text' in p) s.updateMotto(m.id, p.text)
      if ('on' in p && (m.on !== false) !== p.on) s.toggleMotto(m.id)
    },
  },
  subscription: {
    find: (s, r) => s.subscription(r.id),
    label: (s, b) => `訂閱「${short(b.name, 16)}」`,
    read: (s, b, f) => (f === 'title' ? b.name : f === 'date' ? b.start : b[f]),
    write: (s, b, p) => {
      const name = (f) => (f === 'title' ? 'name' : f === 'date' ? 'start' : f)
      // 撤銷取消／恢復訂閱：狀態和一起變的（開始日、不再扣款的那天、之前付過的、試用）照原樣放回去
      if ('end' in p || 'paid0' in p || 'trial' in p) {
        const next = cleanSub({ ...b, ...Object.fromEntries(Object.entries(p).map(([f, v]) => [name(f), v])) }, s.today)
        if (next) {
          Object.assign(b, next)
          s._finish([['subChanged', b]])
        }
        return
      }
      const patch = {}
      for (const [f, v] of Object.entries(p)) if (f !== 'status') patch[name(f)] = v
      if (Object.keys(patch).length) s.updateSubscription(b.id, patch)
      if (p.status === 'cancelled' && b.status !== 'cancelled') s.cancelSubscription(b.id)
      else if (p.status === 'active' && b.status === 'cancelled') s.resumeSubscription(b.id)
    },
  },
  park: { find: (s, r) => s.state.parked.find((x) => x.id === r.id), label: (s, x) => `先記下來的「${short(x.text)}」`, read: (s, x, f) => x[f], write: () => {} },
  log: {
    find: (s, r) => proj(s, r.pid)?.logs.find((x) => x.id === r.id),
    label: (s, l, r) => `「${short(proj(s, r.pid)?.name || '', 14)}」的進度`,
    read: (s, l, f) => (f === 'dur' ? l.mins : l.text),
    write: (s, l, p, r) => s.updateProjectLog(r.pid, l.id, { ...('text' in p ? { text: p.text } : {}), ...('dur' in p ? { mins: p.dur } : {}) }),
  },
  note: {
    find: (s, r) => proj(s, r.pid)?.notes.find((x) => x.id === r.id),
    label: (s, n) => `筆記「${short(n.title || n.body, 16)}」`,
    read: (s, n, f) => (f === 'text' ? n.body : n.title),
    write: (s, n, p, r) => s.updateProjectNote(r.pid, n.id, { ...('title' in p ? { title: p.title } : {}), ...('text' in p ? { body: p.text } : {}) }),
  },
  life: {
    find: (s, r) => s.lifeOn(r.date).items.find((x) => x.id === r.id),
    label: (s, x) => `生活記錄「${short(x.text || `${x.amount}`, 16)}」`,
    read: (s, x, f) => (f === 'at' ? x.t : x[f]),
    write: (s, x, p, r) => {
      const patch = {}
      for (const [f, v] of Object.entries(p)) patch[f === 'at' ? 't' : f] = v
      s.updateLife(r.date, x.id, patch)
    },
  },
  settings: {
    find: (s) => s.state.settings,
    label: () => '',
    read: (s, st, f) => st[f],
    // setSetting 本身不檢查：值不合法（壞掉的撤銷紀錄）的那一項不寫
    write: (s, st, p) => {
      for (const [f, v] of Object.entries(p)) if (okVal('settings', f, v)) s.setSetting(f, v)
    },
  },
  rhythm: {
    find: (s) => s.state.rhythm,
    label: () => '作息的',
    read: (s, r, f) => clone(r[f]),
    write: (s, r, p) => s.setRhythm(p),
  },
}

// 改了這些欄位時 store 會順便動到的（日程改開始時間時結束時間跟著挪、改成整天時時段變成 00:00–23:59；
// 恢復訂閱時重算開始日、記下之前付過的）：改之前也記下來，撤銷時一起放回去
const EVENT_TIME = ['date', 'start', 'end', 'allDay', 'endDate']
// 一起變的那幾欄（src/agentOps.js 的 UNDO_GROUPS）：日程改了時段的欄位、訂閱改了狀態、任務改了完成時，整組記下來
const depsOf = (kind, fields) => {
  const g = UNDO_GROUPS[kind] || []
  const lead = kind === 'event' ? g : kind === 'subscription' ? ['status'] : kind === 'task' ? ['done'] : []
  return fields.some((f) => lead.includes(f)) ? g : []
}
// 進度的字和時間、生活記錄的字和金額都變空的話，store 會直接刪掉那一筆（沒有撤銷紀錄）：這種改法不做（要刪用 drop）
const emptied = (kind, ent, p) =>
  kind === 'log'
    ? !String('text' in p ? p.text : ent.text).trim() && !('dur' in p ? p.dur : ent.mins)
    : kind === 'life' && !String('text' in p ? p.text : ent.text).trim() && !('amount' in p ? p.amount : ent.amount)

// 例行公事長出來的那幾天：自己動過的有幾件（做完、改名、寫備註、排了時間、拆子任務、專注過、挪到別天、改了時段…）
const born = (r, x) => r.id.length > 29 || x.id === `${r.id}-${x.date}`
const usedTask = (r, t) =>
  t.done || t.title !== r.title || (t.note || '') !== (r.note || '') || !!t.subs?.length || !!t.at || !!t.dur || !!t.star || !!t.first || !!t.pomos || !!t.project ||
  !!t.tempo || !!t.touched || !!t.moved || t.priority !== r.priority || t.tag !== r.tag || !born(r, t)
const usedEvent = (r, e) => e.done || e.title !== r.title || (e.note || '') !== (r.note || '') || e.start !== r.start || e.end !== r.end || e.color !== r.color || !born(r, e)
const usedDays = (s, r) => s.state.tasks.filter((t) => t.routineId === r.id && usedTask(r, t)).length + s.state.events.filter((e) => e.routineId === r.id && usedEvent(r, e)).length
// 新增的那一筆現在的樣子（撤銷時還是這個樣子才刪：之後改過、用過的留著）。能改的欄位全部算進去
const SIG = {
  project: (s, p) => [
    p.name, p.color, p.deadline, p.goal, !!p.archived, !!p.pausedAt, !!p.completedAt, p.milestones.map((m) => [m.id, m.title, done(m)]),
    p.logs.length, p.notes.length, Object.keys(p.focus || {}).length, s.state.tasks.filter((t) => t.project === p.id).length,
  ],
  milestone: (s, m) => [
    m.title, done(m), m.due, m.note, (m.steps || []).map((x) => [x.id, x.title, done(x)]), s.state.tasks.filter((t) => t.ms === m.id || t.msAuto === m.id).length,
    s.state.projects.reduce((n, p) => n + p.logs.filter((l) => l.ms === m.id).length, 0),
  ],
  step: (s, x) => [x.title, done(x)],
  habit: (s, h) => [h.name, h.kind, h.icon, h.color, h.target, h.unit, h.days, !!h.archived, h.start, h.log || {}, h.urges || {}, (h.slips || []).length],
  routine: (s, r) => [r.title, r.kind, r.start, r.end, r.repeat, r.tag, r.priority, r.color, r.startDate, usedDays(s, r)],
  motto: (s, m) => [m.text, m.on !== false],
  subscription: (s, b) => [b.name, b.price, b.cur, b.every, b.unit, b.start, !!b.trial, b.cat, b.remind, b.pay, b.url, b.note, b.status, b.end, b.paid0],
  log: (s, l) => [l.text, l.mins, l.date, l.ms ?? null, l.task ?? null],
  note: (s, n) => [n.title, n.body, !!n.pinned],
  life: (s, x) => [x.text, x.amount, x.kind, x.t],
  sleep: (s, e) => [e.bed, e.wake, e.q || 0],
}
const sigOf = (s, kind, ent) => JSON.stringify(SIG[kind](s, ent))
// 新增的那一筆在哪（撤銷時找它）
const findNew = (s, u) => (u.kind === 'sleep' ? s.state.sleep?.[u.date] : K[u.kind]?.find(s, u))

const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`
const repeatOf = (days) => (!days?.length || days.length === 7 ? { type: 'daily' } : days.join() === '1,2,3,4,5' ? { type: 'weekdays' } : { type: 'weekly', days })
const repeatWord = (rep) => (rep.type === 'daily' ? '每天' : rep.type === 'weekdays' ? '平日' : rep.type === 'monthly' ? `每月 ${rep.day} 日` : `每週${rep.days.map((d) => '日一二三四五六'[d]).join('')}`)

// 新增：回傳 { ref, ent, text }（新的那一筆在哪、它本身、給人看的一句）；做不到是 null
const CREATE = {
  project: (s, c) => {
    const p = s.addProject({ name: c.title.slice(0, 60), deadline: c.date, milestones: [] })
    if (!p) return null
    if (c.fields.goal) s.setProjectGoal(p.id, c.fields.goal)
    return { ref: { kind: 'project', id: p.id }, ent: p, text: `新增專案「${short(p.name, 16)}」${p.deadline ? `（截止 ${md(p.deadline)}）` : ''}` }
  },
  milestone: (s, c, par) => {
    const p = proj(s, par.id)
    if (!p || p.archived) return null
    const n = p.milestones.length
    s.addMilestone(p.id, c.title)
    if (p.milestones.length === n) return null
    const m = p.milestones.at(-1)
    if (c.date || c.fields.note) s.updateMilestone(p.id, m.id, { ...(c.date ? { due: c.date } : {}), ...(c.fields.note ? { note: c.fields.note } : {}) })
    return { ref: { kind: 'milestone', id: m.id, pid: p.id }, ent: m, text: `「${short(p.name, 14)}」加了里程碑「${short(m.title)}」${m.due ? `（${md(m.due)}）` : ''}` }
  },
  step: (s, c, par) => {
    const st = s.addStep(par.pid, par.id, c.title)
    return st ? { ref: { kind: 'step', id: st.id, pid: par.pid, mid: par.id }, ent: st, text: `「${short(ms(s, par)?.title || '', 14)}」加了細項「${short(st.title)}」` } : null
  },
  habit: (s, c) => {
    const f = c.fields
    const h = s.addHabit({ name: c.title, kind: f.kind || 'build', target: f.target || 1, unit: f.unit || '次', days: f.days || [] })
    if (!h) return null
    const how = h.kind === 'quit' ? '戒除' : `${repeatWord(repeatOf(h.days))} ${h.target} ${h.unit}`
    return { ref: { kind: 'habit', id: h.id }, ent: h, text: `新增習慣「${short(h.name, 16)}」（${how}）` }
  },
  routine: (s, c) => {
    const ev = !!c.start
    // days：清好的頻率（agentOps.js 的 routineRepeat）；舊的格式是星期幾的陣列
    const d = c.fields.days
    const repeat = isObj(d) && REPEAT_TYPES.includes(d.type) ? d : repeatOf(Array.isArray(d) ? d : [])
    const start = c.start || '09:00'
    // 結束比開始早（跨過午夜）交給 addRoutine（每一次都是兩段，快速記錄、日程頁也是）；沒給的補一小時
    const end = c.end || minToHHMM(Math.min(toMin(start) + 60, 1439))
    const r = s.addRoutine({ kind: ev ? 'event' : 'task', title: c.title, repeat, tag: c.fields.tag || 'life', priority: c.fields.priority || 2, start, end, date: c.date && c.date >= s.today ? c.date : s.today })
    if (!r) return null
    return { ref: { kind: 'routine', id: r.id }, ent: r, text: `新增例行${ev ? '日程' : '任務'}「${short(r.title)}」（${repeatWord(r.repeat)}${ev ? ` ${r.start}` : ''}）` }
  },
  motto: (s, c) => {
    const m = s.addMotto(c.title)
    return m ? { ref: { kind: 'motto', id: m.id }, ent: m, text: `新增警語「${short(m.text)}」` } : null
  },
  subscription: (s, c) => {
    const f = c.fields
    const b = s.addSubscription({ name: c.title, price: f.price, cur: f.cur || 'TWD', every: f.every || 1, unit: f.unit || 'month', start: c.date || s.today })
    return b ? { ref: { kind: 'subscription', id: b.id }, ent: b, text: `新增訂閱「${short(b.name, 16)}」` } : null
  },
  log: (s, c, par) => {
    const l = s.addProjectLog(par.id, { text: c.title, mins: c.fields.dur || 0, date: c.date || null })
    return l ? { ref: { kind: 'log', id: l.id, pid: par.id }, ent: l, text: `「${short(proj(s, par.id)?.name || '', 14)}」記了一則進度${l.mins ? `（${l.mins} 分鐘）` : ''}` } : null
  },
  note: (s, c, par) => {
    const n = s.addProjectNote(par.id, { title: c.title, body: c.fields.text || '' })
    return n ? { ref: { kind: 'note', id: n.id, pid: par.id }, ent: n, text: `「${short(proj(s, par.id)?.name || '', 14)}」加了筆記「${short(n.title || n.body, 16)}」` } : null
  },
  life: (s, c) => {
    const date = c.date || s.today
    const x = s.addLife(date, { kind: c.fields.kind || 'note', text: c.title, amount: c.fields.amount || 0, ...(c.start ? { t: c.start } : {}) })
    return x ? { ref: { kind: 'life', id: x.id, date }, ent: x, text: `生活記錄「${short(x.text || `${x.amount}`, 16)}」` } : null
  },
  sleep: (s, c) => {
    const was = s.state.sleep?.[c.date] ? JSON.stringify(s.state.sleep[c.date]) : ''
    if (!s.logSleep(c.date, { bed: c.start, wake: c.end })) return null
    return { ref: { kind: 'sleep', date: c.date }, ent: s.state.sleep[c.date], was, text: `記下睡眠：${c.start} 睡、${c.end} 起` }
  },
}

// 刪掉那一筆：list 是它待的那一串、del 走 store 的刪除。專案、習慣不刪（改成收起來，走 set）
const DROP = {
  event: (s, e) => ({ list: () => s.state.events, del: () => s.deleteEvent(e.id) }),
  date: (s, d) => ({ list: () => s.state.dates, del: () => s.deleteDate(d.id) }),
  motto: (s, m) => ({ list: () => s.state.mottos, del: () => s.deleteMotto(m.id) }),
  subscription: (s, b) => ({ list: () => s.state.subscriptions, del: () => s.deleteSubscription(b.id) }),
  park: (s, x) => ({ list: () => s.state.parked, del: () => s.unpark(x.id) }),
  routine: (s, r) => ({ list: () => s.state.routines, del: () => s.deleteRoutine(r.id) }),
  milestone: (s, m, r) => ({ list: () => proj(s, r.pid).milestones, del: () => s.deleteMilestone(r.pid, m.id) }),
  step: (s, x, r) => ({ list: () => ms(s, r).steps, del: () => s.deleteStep(r.pid, r.mid, x.id) }),
  subtask: (s, x, r) => ({ list: () => s._find('tasks', r.tid).subs, del: () => s.deleteSub(r.tid, x.id) }),
  log: (s, l, r) => ({ list: () => proj(s, r.pid).logs, del: () => s.deleteProjectLog(r.pid, l.id) }),
  note: (s, n, r) => ({ list: () => proj(s, r.pid).notes, del: () => s.deleteProjectNote(r.pid, n.id) }),
  life: (s, x, r) => ({ list: () => s.lifeOn(r.date).items, del: () => s.deleteLife(r.date, x.id) }),
}

// 讀存檔的規則整份清一次（撤銷紀錄跟著同步、匯入，存著的那一筆可能壞掉或被改過）：
// 把那一筆包成一份最小的存檔丟給 migrate，再拿出來。清不出來就是 null
const viaMigrate = (save, get) => {
  try {
    return get(migrate({ version: DATA_VERSION, player: {}, ...save })) || null
  } catch {
    return null
  }
}
// 刪掉的那一筆放回去之前的樣子：清好、id 也還是原本那一個才放
// 刪掉的日程跨過午夜的話，另一段記在 more（撤銷時一起放回去）
const pieces = (u) => {
  const v = parse(u.more)
  return Array.isArray(v) ? v.filter(isObj).slice(0, 3) : []
}
function cleanBack(s, u, x) {
  if (!isObj(x)) return null
  const P = (more) => ({ id: u.pid, name: 'p', milestones: [], ...more })
  const wrap = {
    // 跨過午夜的另一段一起清（兩段的 link 要對得上才留著）
    event: () => [{ events: [x, ...pieces(u)] }, (o) => o.events[0]],
    date: () => [{ dates: [x] }, (o) => o.dates[0]],
    motto: () => [{ mottos: [x] }, (o) => o.mottos[0]],
    subscription: () => [{ subscriptions: [x] }, (o) => o.subscriptions[0]],
    park: () => [{ parked: [x] }, (o) => o.parked[0]],
    routine: () => [{ routines: [x] }, (o) => o.routines[0]],
    milestone: () => [{ projects: [P({ milestones: [x] })] }, (o) => o.projects[0]?.milestones[0]],
    step: () => [{ projects: [P({ milestones: [{ id: u.mid, title: 'm', steps: [x] }] })] }, (o) => o.projects[0]?.milestones[0]?.steps[0]],
    subtask: () => [{ tasks: [{ id: u.tid, title: 't', subs: [x] }] }, (o) => o.tasks[0]?.subs[0]],
    // 標著的里程碑、任務照現在的資料對：還在的才留著
    log: () => {
      const p = proj(s, u.pid)
      const mss = (p?.milestones || []).filter((m) => m.id === x.ms).map((m) => ({ id: m.id, title: 'm' }))
      const tasks = s.state.tasks.filter((t) => t.id === x.task).map((t) => ({ id: t.id, title: 't' }))
      return [{ tasks, projects: [P({ milestones: mss, logs: [x] })] }, (o) => o.projects[0]?.logs[0]]
    },
    note: () => [{ projects: [P({ notes: [x] })] }, (o) => o.projects[0]?.notes[0]],
    life: () => [{ life: { [u.date]: { items: [x] } } }, (o) => o.life[u.date]?.items[0]],
  }[u.kind]
  if (!wrap) return null
  const out = viaMigrate(...wrap())
  return out && out.id === u.id ? out : null
}
const parse = (v) => {
  try {
    return typeof v === 'string' && v ? JSON.parse(v) : null
  } catch {
    return null
  }
}

export const agentOpsMethods = {
  // 對話裡說的「改任務」：時間和日子走 agent.js 的 schedule（避開日程、別的任務），標題這些走 edit、本命走 star、完成走 done；
  // 其他（備註、取消完成、只改長度、不再是先做的那一件）留在 set 照一般的欄位改。回傳換好的那一份 act（不動原本的）
  _agentTaskSets(act) {
    const ops = act.ops
    if (!ops?.set?.some((x) => x.kind === 'task')) return act
    const out = { ...act, schedule: [...act.schedule], edit: [...act.edit], star: [...act.star], done: [...act.done], ops: { ...ops, set: ops.set.filter((x) => x.kind !== 'task') } }
    const by = new Map()
    for (const x of ops.set) if (x.kind === 'task') (by.get(x.id) || by.set(x.id, {}).get(x.id))[x.field] = x.value
    for (const [id, f] of by) {
      const t = this._find('tasks', id)
      if (!t) continue
      const rest = {}
      if ('date' in f || 'at' in f) {
        const i = out.schedule.findIndex((x) => x.id === id)
        const s = { id, date: f.date || t.date, at: 'at' in f ? f.at || '' : t.at || '', dur: f.dur || 0 }
        if (i >= 0) out.schedule[i] = s
        else out.schedule.push(s)
        // 一起說了「不估時間」（dur 清掉）：排好之後再把長度清掉（schedule 的 0 是「照原本的」）
        if ('dur' in f && f.dur === null) rest.dur = null
      } else if ('dur' in f) rest.dur = f.dur
      const e = {}
      for (const k of ['title', 'tag', 'priority', 'project']) if (k in f) e[k] = f[k]
      if (Object.keys(e).length) out.edit.push({ id, ...e })
      if ('star' in f) out.star.push({ id, on: f.star })
      if (f.first === true) out.first = id
      else if (f.first === false) rest.first = false
      if (f.done === true) out.done.push(id)
      else if (f.done === false) rest.done = false
      if ('note' in f) rest.note = f.note
      if ('due' in f) rest.due = f.due
      for (const [field, value] of Object.entries(rest)) out.ops.set.push({ kind: 'task', id, field, value })
    }
    return out
  },

  // 新增（在任務那些之前做：這一批後面的 add 可以把任務歸進剛建的專案）。回傳 ref → 新的那一筆在哪
  _agentCreate(ops, note) {
    const refs = new Map()
    for (const c of ops?.create || []) {
      const par = c.parent ? (c.parent.ref ? refs.get(c.parent.ref) : c.parent) : null
      if (c.parent && !par) continue
      const make = CREATE[c.kind]
      const got = make ? make(this, c, par) : null
      if (!got) continue
      if (c.ref) refs.set(c.ref, got.ref)
      const u = { k: 'new', kind: c.kind, ...refOf(got.ref), sig: sigOf(this, c.kind, got.ent) }
      if (c.kind === 'sleep') u.was = got.was
      note(got.text, u)
    }
    return refs
  },

  // 改欄位、勾完成、刪掉。early：true 只做會動到空檔的（日程、作息）和取消完成的任務（agent.js 在排任務、改任務之前先做，
  // 排時間才避得開剛挪過的日程、取消完成的任務才改得到）；false 是其他的；null 是全部
  _agentRest(ops, note, early = null) {
    const today = this.today
    const fmt = (d) => dayWord(d, today)
    const first = (x) => x.kind === 'event' || x.kind === 'rhythm' || (x.kind === 'task' && x.field === 'done' && x.value === false)
    const pick = (list) => (list || []).filter((x) => early === null || first(x) === early)
    // 同一筆的幾個欄位一起改（日程的開始和結束一起檢查），記成一項
    const groups = new Map()
    for (const x of pick(ops?.set)) {
      const key = `${x.kind}:${x.id || ''}:${x.pid || ''}:${x.mid || ''}:${x.tid || ''}:${x.date || ''}`
      ;(groups.get(key) || groups.set(key, []).get(key)).push(x)
    }
    for (const list of groups.values()) {
      const k = K[list[0].kind]
      let ent = k?.find(this, list[0])
      if (!ent) continue
      const r = headRef(list[0], ent)
      const fields = list.map((x) => x.field)
      const watch = [...new Set([...fields, ...depsOf(r.kind, fields)])]
      const before = Object.fromEntries(watch.map((f) => [f, clone(k.read(this, ent, f))]))
      const patch = Object.fromEntries(list.filter((x) => !eq(before[x.field], x.value)).map((x) => [x.field, x.value]))
      if (!Object.keys(patch).length || emptied(r.kind, ent, patch)) continue
      const name = k.label(this, ent, r)
      k.write(this, ent, patch, r)
      ent = k.find(this, r)
      if (!ent) continue
      const changed = watch.filter((f) => !eq(before[f], k.read(this, ent, f)))
      if (!changed.some((f) => f in patch)) continue
      // 一起變的那幾欄有一欄變了：沒變的也記下來（撤銷前整組比對，之後自己改過其中一欄就整組不動）
      const group = UNDO_GROUPS[r.kind] || []
      const keep = changed.some((f) => group.includes(f)) ? [...new Set([...changed, ...group.filter((f) => watch.includes(f))])] : changed
      const after = Object.fromEntries(keep.map((f) => [f, clone(k.read(this, ent, f))]))
      const what = changed.filter((f) => f in patch).map((f) => fieldText(r.kind, f, after[f], fmt)).filter(Boolean)
      note(`${name}${what.join('、')}`, { k: 'set', kind: r.kind, ...refOf(r), before: Object.fromEntries(keep.map((f) => [f, before[f]])), after })
    }
    for (const x of pick(ops?.done)) {
      const ent = K[x.kind]?.find(this, x)
      if (!ent) continue
      const r = headRef(x, ent)
      if (r.kind === 'habit') {
        if (ent.kind !== 'build' || ent.archived) continue
        const was = countOn(ent, today)
        this.checkHabit(ent.id)
        const n = countOn(ent, today)
        // 已經到上限（99 次）打不上去：沒打到就不記（撤銷時不會多收回一次）
        if (n <= was) continue
        note(`習慣「${short(ent.name, 16)}」打了卡（今天第 ${n} 次）`, { k: 'tick', kind: 'habit', id: ent.id, date: today, n })
        continue
      }
      if (done(ent)) continue
      const name = K[r.kind].label(this, ent, r)
      K[r.kind].write(this, ent, { done: true }, r)
      if (done(K[r.kind].find(this, r) || {})) note(`完成${name}`, { k: 'tick', kind: r.kind, ...refOf(r) })
    }
    for (const x of pick(ops?.drop)) {
      const k = K[x.kind]
      const ent = k?.find(this, x)
      if (!ent) continue
      const r = headRef(x, ent)
      const name = k.label(this, ent, r)
      // 專案、習慣：收起來（之後可以拿回來）
      if (r.kind === 'project' || r.kind === 'habit') {
        const was = k.read(this, ent, 'status')
        if (was === 'archived') continue
        k.write(this, ent, { status: 'archived' }, r)
        if (k.read(this, k.find(this, r), 'status') === 'archived') note(`${name}收起來了（之後可以拿回來）`, { k: 'set', kind: r.kind, ...refOf(r), before: { status: was }, after: { status: 'archived' } })
        continue
      }
      const how = DROP[r.kind]?.(this, ent, r)
      if (!how) continue
      const at = how.list().indexOf(ent)
      const item = JSON.stringify(ent)
      if (item.length > ITEM_MAX) continue
      const u = { k: 'gone', kind: r.kind, ...refOf(r), item, at }
      if (r.kind === 'event') {
        const more = this.eventGroup(ent).filter((y) => y !== ent)
        if (more.length) u.more = JSON.stringify(more)
        if ((u.more || '').length > ITEM_MAX) continue
      }
      // 里程碑：指著它的任務、進度紀錄刪掉時會被解開，記下來撤銷時接回去
      if (r.kind === 'milestone') {
        u.tasks = this.state.tasks.filter((t) => t.ms === ent.id).map((t) => t.id)
        u.logs = proj(this, r.pid).logs.filter((l) => l.ms === ent.id).map((l) => l.id)
      }
      // 例行公事：今天以後還沒做的那幾天會一起被拿掉（可能自己改過名字、寫了備註），整份記下來；太大存不下就不刪（不然撤銷放不回去）
      if (r.kind === 'routine') {
        const mine = (x) => x.routineId === ent.id && !x.done && x.date >= today
        const inst = JSON.stringify({ tasks: this.state.tasks.filter(mine), events: this.state.events.filter(mine) })
        if (inst.length > ITEM_MAX) continue
        u.inst = inst
      }
      // 細項、子任務、里程碑：刪掉後剩下的都做完時，上一層（里程碑、任務、專案）會跟著完成。記下是不是這次造成的、那一刻的時間，
      // 撤銷時還是那個時間（之後沒自己再勾過）才一起退回去
      const parent = r.kind === 'step' ? () => ms(this, r) : r.kind === 'subtask' ? () => this._find('tasks', r.tid) : null
      const wasDone = !!parent?.()?.done
      const p0 = r.kind === 'milestone' ? proj(this, r.pid) : null
      const pWas = p0 && { completedAt: p0.completedAt, pausedAt: p0.pausedAt, onTime: !!p0.onTime }
      how.del()
      if (K[r.kind].find(this, r)) continue
      const par = parent?.()
      if (par && !wasDone && par.done && par.doneAt) u.auto = par.doneAt
      if (pWas && !pWas.completedAt && p0.completedAt) Object.assign(u, { pat: p0.completedAt, ppause: pWas.pausedAt || null, ponTime: !!p0.onTime && !pWas.onTime })
      note(`刪掉${name}`, u)
    }
  },

  // 撤銷一項（agentUndo 從最後一項往回叫）：回傳有沒有還原
  _agentUndoOp(u) {
    if (u.k === 'set') {
      const k = K[u.kind]
      const ent = k?.find(this, u)
      if (!ent || !isObj(u.before) || !isObj(u.after)) return false
      const patch = {}
      for (const [f, v] of Object.entries(u.after)) if (Object.hasOwn(u.before, f) && okVal(u.kind, f, u.before[f]) && eq(k.read(this, ent, f), v)) patch[f] = u.before[f]
      const mine = (UNDO_GROUPS[u.kind] || []).filter((f) => Object.hasOwn(u.after, f))
      if (mine.some((f) => !(f in patch))) for (const f of mine) delete patch[f]
      if (!Object.keys(patch).length || emptied(u.kind, ent, patch)) return false
      k.write(this, ent, patch, u)
      return true
    }
    if (u.k === 'new') {
      const ent = findNew(this, u)
      if (!ent || sigOf(this, u.kind, ent) !== u.sig) return false
      const del = {
        project: () => this.deleteProject(u.id),
        milestone: () => this.deleteMilestone(u.pid, u.id),
        step: () => this.deleteStep(u.pid, u.mid, u.id),
        habit: () => this.deleteHabit(u.id),
        routine: () => this.deleteRoutine(u.id),
        motto: () => this.deleteMotto(u.id),
        subscription: () => this.deleteSubscription(u.id),
        log: () => this.deleteProjectLog(u.pid, u.id),
        note: () => this.deleteProjectNote(u.pid, u.id),
        life: () => this.deleteLife(u.date, u.id),
        sleep: () => {
          const was = parse(u.was)
          if (isObj(was) && TIME_RE.test(was.bed) && TIME_RE.test(was.wake) && was.bed !== was.wake) {
            this.state.sleep[u.date] = { bed: was.bed, wake: was.wake, q: Number.isInteger(was.q) && was.q >= 0 && was.q <= 5 ? was.q : 0 }
            this._finish()
          } else this.deleteSleep(u.date)
        },
      }[u.kind]
      if (!del) return false
      del()
      return true
    }
    if (u.k === 'tick') {
      const ent = K[u.kind]?.find(this, u)
      if (!ent) return false
      if (u.kind === 'habit') {
        if (!DATE_RE.test(u.date) || !u.n || countOn(ent, u.date) !== u.n) return false
        this.checkHabit(ent.id, u.date, -1)
        return true
      }
      if (!done(ent)) return false
      K[u.kind].write(this, ent, { done: false }, u)
      return true
    }
    if (u.k === 'gone') return this._agentRestore(u)
    return false
  },

  // 刪掉的那一筆放回原本的位置（同一個 id 已經在了就不放）
  _agentRestore(u) {
    const x = cleanBack(this, u, parse(u.item))
    if (!x || K[u.kind].find(this, u)) return false
    let list
    if (u.kind === 'milestone' || u.kind === 'log' || u.kind === 'note') list = proj(this, u.pid)?.[{ milestone: 'milestones', log: 'logs', note: 'notes' }[u.kind]]
    else if (u.kind === 'step') list = ms(this, u)?.steps
    else if (u.kind === 'subtask') list = this._find('tasks', u.tid)?.subs
    else if (u.kind === 'life') list = (this.state.life[u.date] ||= { items: [], energy: 0 }).items
    else list = { event: this.state.events, date: this.state.dates, motto: this.state.mottos, subscription: this.state.subscriptions, park: this.state.parked, routine: this.state.routines }[u.kind]
    if (!Array.isArray(list)) return false
    if (u.kind === 'routine') this._restoreDays(x, u)
    list.splice(Math.max(0, Math.min(list.length, Number.isInteger(u.at) ? u.at : list.length)), 0, x)
    // 跨過午夜的日程：另一段也放回去（id 被佔走了就不放，這一段自己一個）
    if (u.kind === 'event' && x.link) {
      const all = viaMigrate({ events: [parse(u.item), ...pieces(u)] }, (o) => o.events) || []
      const rest = all.slice(1).filter((y) => y.link === x.link && !this._find('events', y.id))
      if (rest.length) this.state.events.push(...rest)
      else delete x.link
    }
    if (u.kind === 'life') list.sort((a, b) => toMin(a.t) - toMin(b.t))
    if (u.kind === 'log') list.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)
    // 刪掉時扣掉的累計筆數加回來（成就、小鎮照這個算）
    if (u.kind === 'log') this.stats.projectLogs++
    if (u.kind === 'life') this.stats.lifeEntries++
    if (u.kind === 'milestone') {
      for (const id of u.tasks || []) {
        const t = this._find('tasks', id)
        if (t && !t.ms && t.project === u.pid) t.ms = x.id
      }
      for (const id of u.logs || []) {
        const l = proj(this, u.pid)?.logs.find((y) => y.id === id)
        if (l && !l.ms) l.ms = x.id
      }
    }
    if (u.kind === 'routine') this._ensureRoutines(this.today)
    // 刪掉它才讓上一層跟著完成的（剩下的都做完了）：放回一件還沒做完的，上一層也退回沒做完（之後自己又勾過的不動）
    if (u.auto && !x.done) {
      const m = u.kind === 'step' ? ms(this, u) : null
      const t = u.kind === 'subtask' ? this._find('tasks', u.tid) : null
      if (m?.done && m.doneAt === u.auto) this.toggleMilestone(u.pid, u.mid)
      if (t?.done && t.doneAt === u.auto) this.toggleTask(u.tid)
    }
    // 刪掉最後一個沒做完的里程碑讓專案落成的：專案退回進行中（暫停的回到暫停），落成、準時的次數扣回來
    if (u.kind === 'milestone' && u.pat && !x.done) {
      const p = proj(this, u.pid)
      if (p && p.completedAt === u.pat) {
        p.completedAt = null
        p.pausedAt = u.ppause || null
        // 落成的獎勵照帳收回（之後真的再落成時照常給）；舊的、帳上沒有的只扣次數
        p.paid = false
        if (!this.revokeGrant(grantKey('p', p.id))) this.stats.projectsDone = Math.max(0, this.stats.projectsDone - 1)
        if (u.ponTime) {
          p.onTime = false
          if (!this.revokeGrant(grantKey('po', p.id))) this.stats.projectsOnTime = Math.max(0, this.stats.projectsOnTime - 1)
        }
        this._edited(p)
      }
    }
    this._finish()
    return true
  },
  // 例行公事放回去時，刪掉時一起拿掉的那幾天也放回去（自己改過的名字、備註、子任務都在）；那幾天已經生過（made），不會再長一份。
  // 沒記到那幾天（太大、舊的紀錄）：今天以後的讓它照常再長出來
  _restoreDays(r, u) {
    const inst = parse(u.inst)
    if (!isObj(inst)) {
      for (const d of Object.keys(r.made)) if (d >= this.today) delete r.made[d]
      return
    }
    const have = new Set([...this.state.tasks, ...this.state.events].map((x) => x.id))
    const ok = (x) => x && x.routineId === r.id && !have.has(x.id)
    // 放不回去的那一天（壞掉、id 被佔走）：今天以後的讓它照常再長一份
    const regrow = (x) => {
      if (isObj(x) && DATE_RE.test(x.date) && x.date >= this.today) delete r.made[x.date]
    }
    for (const raw of Array.isArray(inst.tasks) ? inst.tasks : []) {
      const t = isObj(raw) ? cleanTask(raw, this.today) : null
      if (!ok(t) || t.id !== raw.id) {
        regrow(raw)
        continue
      }
      const p = t.project ? this._find('projects', t.project) : null
      if (!p) t.project = t.ms = t.msAuto = null
      else if (t.ms && !p.milestones.some((m) => m.id === t.ms)) t.ms = null
      if (!t.project) t.ongoing = false
      have.add(t.id)
      this.state.tasks.push(t)
      this._fitStar(t)
    }
    const raws = Array.isArray(inst.events) ? inst.events : []
    const events = viaMigrate({ events: raws }, (o) => o.events) || []
    const back = new Set()
    for (const e of events) {
      if (!ok(e) || !raws.some((x) => isObj(x) && x.id === e.id)) continue
      have.add(e.id)
      back.add(e.id)
      this.state.events.push(e)
    }
    for (const x of raws) if (!isObj(x) || !back.has(x.id)) regrow(x)
  },
}
