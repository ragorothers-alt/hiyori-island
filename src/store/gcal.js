// Google 日曆同步在 App 這邊的資料（src/gcal.js 呼叫）：
// state.gcal：要同步的日曆（Google 的日曆 id）、開著沒有、用哪個時區換算。授權（refresh token）不在這裡：存在這台裝置，
// 開著線上同步時放在加密的那一包裡帶到別台（跟ふじ的通行碼一樣），不會出現在匯出、資料夾同步的檔案裡。
// gcalApply：把在 Google 上改的帶進 App（改、刪、加），只改 Google 那邊跟 App 不一樣的欄位；回傳撤銷用的紀錄。
// gcalUndo：撤銷（只還原之後沒被改過的；還原了的那幾筆，下一次同步會照 App 的樣子寫回 Google）。
import { cleanGcal, floating } from './migrate.js'
import { toMin, overnight } from './util.js'

const TASK_KEYS = ['title', 'date', 'at', 'dur', 'due', 'note']
const taskOf = (t) => Object.fromEntries(TASK_KEYS.map((k) => [k, t[k] ?? null]))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// 一段時間有幾分鐘（結束在 23:59 的算到午夜）
const lenOf = (start, end) => (end === '23:59' ? 1440 : toMin(end)) - toMin(start)
// 時段的長度（分鐘，5 分鐘一格，5～600）
const durOf = (start, end) => Math.max(5, Math.min(600, Math.round(lenOf(start, end) / 5) * 5 || 5))
const TIME_KEYS = ['date', 'start', 'end', 'allDay', 'endDate']
// 往後挪的次數、本命、先做這件（在 Google 改了日子，updateTask 會跟著記／拿掉：撤銷時照 undoPostpone 還原）
const marksOf = (t) => ({ moved: t.moved || 0, star: !!t.star, first: !!t.first })

export const gcalMethods = {
  // patch：{ cal, on, tz }
  setGcal(patch) {
    this.state.gcal = cleanGcal({ ...this.state.gcal, ...patch, at: Date.now() })
    this._finish()
  },
  // 整個日程現在的樣子（撤銷「改」時放回去）
  _gcalEventOf(e) {
    const s = this.eventSpan(e)
    const h = s.head
    return { title: h.title, date: s.date, start: s.start, end: s.end, allDay: !!h.allDay, endDate: h.endDate || '', note: h.note || '' }
  },
  // 任務：Google 那邊的 c 跟 App 現在的樣子 cur（同一批之前算的）比，只改不一樣的欄位。
  // 時段只挪了（長度一樣）就不改預估的長度：23:40 開始、預估 60 分鐘的，寫到 Google 只有到午夜的 20 分鐘
  _gcalTaskPatch(x) {
    const { c, cur } = x
    if (x.op === 'del') return x.k === 't' ? { at: null } : { due: null }
    const p = {}
    if (c.title !== cur?.title) p.title = c.title
    if (c.note !== cur?.note) p.note = c.note
    if (x.k === 'd') {
      if (c.date !== cur?.date) p.due = c.date
      return p
    }
    if (c.date !== cur?.date) p.date = c.date
    if (!c.start) {
      // 在 Google 改成整天：沒有時段了
      if (cur?.start !== '') p.at = null
    } else if (c.start !== cur?.start || c.end !== cur?.end) {
      p.at = c.start
      if (!cur?.start || lenOf(c.start, c.end) !== lenOf(cur.start, cur.end)) p.dur = durOf(c.start, c.end)
    }
    return p
  },
  // list：gcalMap.plan 的 apply（照順序帶）。回傳 { n：在 Google 上改的有幾筆（要說、可以撤銷）, undo, titles, dropped：刪了幾筆,
  // changed：App 改了幾筆（含別台的 App 寫上去、跟著改就好不用說的 quiet）}
  gcalApply(list) {
    const undo = []
    const titles = []
    let dropped = 0
    let changed = 0
    let direct = false
    for (const x of list || []) {
      const c = x.c
      const loud = !x.quiet
      if (x.k === 'e') {
        const e = this._find('events', x.id)
        if (x.op === 'add') {
          if (e || !c) continue
          const ne = {
            id: x.id, title: c.title, date: c.date, start: c.allDay ? '00:00' : c.start, end: c.allDay ? '23:59' : c.end,
            color: 0, done: false, rewarded: false, note: c.note, allDay: !!c.allDay, endDate: c.allDay ? c.endDate || c.date : '',
          }
          this.state.events.push(ne)
          if (!c.allDay && overnight(c.start, c.end)) this._place(ne, c.date, c.start, c.end)
          else if (!c.allDay && toMin(ne.end) <= toMin(ne.start)) ne.end = '23:59'
          direct = true
          changed++
          if (loud) titles.push(c.title)
        } else if (e && x.op === 'del') {
          const pieces = this.eventGroup(e).map((p) => ({ ...p }))
          const gone = new Set(pieces.map((p) => p.id))
          this.state.events = this.state.events.filter((p) => !gone.has(p.id))
          direct = true
          changed++
          if (!loud) continue
          undo.push({ k: 'e', op: 'del', id: x.id, pieces })
          titles.push(e.title)
          dropped++
        } else if (e && x.op === 'set' && c) {
          const cur = x.cur
          const patch = {}
          if (c.title !== cur?.title) patch.title = c.title
          if (c.note !== cur?.note) patch.note = c.note
          if (TIME_KEYS.some((k) => c[k] !== cur?.[k])) Object.assign(patch, { date: c.date, start: c.start, end: c.end, allDay: c.allDay, endDate: c.endDate })
          if (!Object.keys(patch).length) continue
          const before = this._gcalEventOf(e)
          this.updateEvent(e.id, patch)
          const now = this._find('events', x.id)
          changed++
          if (!now || !loud) continue
          undo.push({ k: 'e', op: 'set', id: x.id, before, sig: this._eventSig(now) })
          titles.push(now.title)
        }
        continue
      }
      const t = this._find('tasks', x.id)
      if (!t || (x.op !== 'del' && !c)) continue
      const patch = this._gcalTaskPatch(x)
      const before = taskOf(t)
      const was = marksOf(t)
      if (Object.keys(patch).length) this.updateTask(t.id, patch)
      const after = taskOf(t)
      if (same(before, after)) continue
      changed++
      if (!loud) continue
      undo.push({ k: 'task', id: t.id, before, after, was, now: marksOf(t), done: !!t.done })
      titles.push(t.title)
      if (x.op === 'del') dropped++
    }
    if (direct) this._finish()
    return { n: titles.length, undo, titles, dropped, changed }
  },
  // 撤銷 gcalApply 改的、刪的（在 Google 新增帶進來的不算：那是 Google 上本來就有的）。只還原之後沒被改過的；回傳還原了幾筆
  gcalUndo(rec) {
    let n = 0
    for (const u of [...(rec?.undo || [])].reverse()) {
      if (u.k === 'task') {
        const t = this._find('tasks', u.id)
        if (!t || !same(taskOf(t), u.after) || (u.done !== undefined && !!t.done !== u.done) || floating(t)) continue
        const m0 = t.moved || 0
        this.updateTask(u.id, u.before)
        if (u.was) {
          t.moved = Math.max(0, m0 - Math.max(0, u.now.moved - u.was.moved))
          this._restoreMarks(t, u.was, u.now)
          this._finish()
        }
        n++
        continue
      }
      const e = this._find('events', u.id)
      if (u.op === 'del') {
        if (e || u.pieces.some((p) => this._find('events', p.id))) continue
        this.state.events.push(...u.pieces.map((p) => ({ ...p })))
        this._finish()
      } else if (!e || this._eventSig(e) !== u.sig) continue
      else this.updateEvent(u.id, u.before)
      n++
    }
    return n
  },
}
