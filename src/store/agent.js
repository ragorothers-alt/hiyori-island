import { floating, DATE_RE, blankTask, str, cleanTask, taskSig as sigOf } from './migrate.js'
import { busyOf, awake, taskDur, toHHMM } from '../planner.js'
import { toMin, uid, addDays } from './util.js'
import { MAX_STARS, TAGS } from '../theme.js'
import { PROJECT_LIMITS as PL } from '../projects.js'
import { fitSlot, dayWord, weekOf, saneAct } from '../agent.js'

// 自主的ふじ動資料的地方。state.agent：
//   memory：ふじ記得的事（使用者的偏好、固定的安排），每次都帶給 Claude
//   ran：{ morning, evening, week }：早上、晚上的整理上次是哪一天做的、這一週整理過沒（跟著同步，別台做過就不再做）
//   log：最近做過的事 [{ id, at, run, say, next, changes: [{ t: 給人看的一句, u: 撤銷用的紀錄 }], undone }]
// 每個動作都再檢查一次才做：任務要還在、還沒做完；時間不能在現在以前、不能撞到日程和排好的任務（撞到就挪到最近的空檔）。
// 一次整理算一批，可以整批撤銷；撤銷時只還原之後沒被改過的（撤銷紀錄的格式在 migrate.js 的 cleanUndo，兩邊要一起改）。
export const AGENT_LOG_MAX = 30
export const AGENT_MEMORY_MAX = 30
const short = (s, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const roundUp = (m) => Math.ceil(m / 5) * 5
// ふじ剛加好的任務長什麼樣子（sigOf＝migrate.js 的 taskSig）：撤銷時還是這個樣子才刪
const slotOf = (t) => ({ date: t.date, at: t.at ?? null, dur: t.dur ?? null, moved: t.moved || 0, star: !!t.star, first: !!t.first })

export const agentMethods = {
  // act：cleanOut 清好的動作；run：哪一種整理。回傳記下的那一筆（什麼都沒做、也沒說話時是 null）
  // focusing：正在專注的那一件（自己整理時不動它的時間）
  agentApply(act, { run = 'chat', weekStart = false, focusing = null } = {}) {
    // 樣子不對的整份不做（不會做到一半才出錯）
    if (!saneAct(act)) return null
    this._refreshToday()
    const today = this.today
    const chat = run === 'chat'
    const n = new Date()
    const nowMin = n.getHours() * 60 + n.getMinutes()
    const last = addDays(today, 90)
    const runId = uid()
    const changes = []
    const fx = []
    const find = (id) => this._find('tasks', id)
    const day = (d) => dayWord(d, today)
    const note = (t, u) => changes.push({ t, u })
    // 對話裡說的：「改任務」的那幾項換成下面排時間、改標題、本命、完成的做法；任務以外的新增先做（後面的任務可以歸進剛建的專案）
    if (chat) act = this._agentTaskSets(act)
    const refs = chat ? this._agentCreate(act.ops, note) : new Map()
    const okDate = (d) => DATE_RE.test(d) && d >= today && d <= last
    if (chat) {
      // 會動到空檔的先做（新的日程、改時間或刪掉的日程、作息），還有取消完成的任務：後面排任務時避得開、改得到
      for (const x of act.events || []) {
        if (!okDate(x.date)) continue
        const e = this.addEvent({ title: x.title, date: x.date, start: x.start, end: x.end || x.start })
        if (e) note(`日程「${short(e.title)}」（${day(e.date)} ${e.start}）`, { k: 'event', id: e.id })
      }
      this._agentRest(act.ops, note, true)
    }
    const rhythm = this.state.rhythm

    // ── 改分類、標題、優先度、歸到哪個專案 ──
    for (const e of act.edit || []) {
      const t = find(e?.id)
      if (!t || t.done) continue
      const patch = {}
      for (const k of ['title', 'tag', 'priority', 'project']) if (k in e && e[k] !== t[k]) patch[k] = e[k]
      if (!Object.keys(patch).length) continue
      // 換專案時自己選的里程碑會跟著清掉；長期任務移出專案會變回一般任務、排在今天：一起記下來，撤銷時放回去
      const keys = 'project' in patch ? [...Object.keys(patch), 'ms', ...(t.ongoing ? ['ongoing', 'date'] : [])] : Object.keys(patch)
      const before = Object.fromEntries(keys.map((k) => [k, t[k] ?? null]))
      const was = t.title
      this.updateTask(t.id, patch)
      const after = Object.fromEntries(keys.map((k) => [k, t[k] ?? null]))
      const what = ['title' in patch ? `改名成「${short(t.title)}」` : '', 'tag' in patch ? `分類改成${TAGS.find((x) => x.id === t.tag)?.label || t.tag}` : '', 'priority' in patch ? `優先度改成${['', '低', '中', '高'][t.priority]}` : '', 'project' in patch ? (t.project ? `歸到「${short(this._find('projects', t.project)?.name || '', 14)}」` : '移出專案') : '']
      note(`「${short(was)}」${what.filter(Boolean).join('、')}`, { k: 'edit', id: t.id, before, after })
    }

    // ── 排時間、改日子、新增任務：先算好每天已經佔掉的時間，這一批要重排的任務先不算在裡面（排好一件算一件）──
    // 會被重排的那幾件（跟下面真的動手的條件一樣：做完的、長期的、正在專注的不動，它們的時段照樣佔著）
    const movable = (t) => !!t && !t.done && !floating(t) && (chat || t.id !== focusing)
    const moving = new Set((act.schedule || []).map((x) => x?.id).filter((id) => movable(find(id))))
    const busy = {}
    // 使用者開口指定的時間照他說的排（只避開日程和別的任務）；自己整理時三餐、緩衝都要避開
    const plain = chat ? { ...rhythm, meals: [], buffer: 0 } : rhythm
    const busyOn = (date) =>
      (busy[date] ??= busyOf({ rhythm: plain, date, events: this._busyEvents(date), tasks: this.tasksOn(date).filter((t) => t.at && !t.done && !moving.has(t.id)) }))
    const [wake, bed] = awake(rhythm)
    // 回傳排到的開始時間（HH:MM），那一段從此算佔著；放不下是 null
    const place = (date, at, dur) => {
      if (!at) return null
      let lo = chat ? 0 : wake
      const hi = chat ? 1440 : bed
      if (date === today) lo = Math.max(lo, roundUp(nowMin))
      const s = fitSlot(toMin(at), dur, busyOn(date), lo, hi)
      if (s == null) return null
      const buf = plain.buffer || 0
      const span = [s - buf, s + dur + buf]
      busyOn(date).push(span)
      return toHHMM(s)
    }
    for (const x of act.schedule || []) {
      const t = find(x?.id)
      if (!movable(t)) continue
      const date = okDate(x.date) ? x.date : t.date < today ? today : t.date
      // 自己整理時不把任務挪過它的截止日（使用者開口要的照做）
      if (!chat && t.due && t.due >= today && date > t.due) continue
      const before = slotOf(t)
      let at = null
      let dur = x.dur ? x.dur : t.dur ?? null
      if (x.at) {
        at = place(date, x.at, x.dur || taskDur(t))
        // 放不下：原本就排在這天的話，照原本的長度在原本的時間附近再找一次（別件可能剛排到它上面）；還是不行就只留日子
        if (!at && t.date === date && t.at) {
          dur = t.dur ?? null
          at = place(date, t.at, taskDur(t))
        }
      }
      if (before.date === date && before.at === at && before.dur === dur) continue
      this._editedTask(t)
      if (date > t.date && !t.ongoing) t.moved = (t.moved || 0) + 1
      t.date = date
      t.at = at
      t.dur = dur
      this._fitStar(t)
      this._editedTask(t)
      const text = t.at ? `「${short(t.title)}」${before.date !== date || before.at !== t.at ? `排在${day(date)} ${t.at}` : `估 ${t.dur} 分鐘`}` : `「${short(t.title)}」移到${day(date)}`
      note(text, { k: 'task', id: t.id, before, after: slotOf(t) })
    }

    for (const x of act.add || []) {
      if (!x || typeof x.title !== 'string' || !x.title.trim()) continue
      const date = okDate(x.date) ? x.date : today
      // 那天已經有同名、還沒做的任務：不重複加
      if (this.tasksOn(date).some((t) => !t.done && t.title === x.title)) continue
      const pid = x.project || (x.projectRef ? refs.get(x.projectRef)?.id : null)
      const p = pid ? this._find('projects', pid) : null
      const dur = x.dur || 30
      const t = blankTask({
        title: x.title, date, tag: x.tag, dur, at: x.at ? place(date, x.at, dur) : null, coach: `a-${runId}`, due: DATE_RE.test(x.due) ? x.due : null,
        project: p && !p.archived && !p.completedAt ? p.id : null,
        subs: (x.steps || []).slice(0, PL.subs).map((s) => ({ id: uid(), title: str(s, PL.subTitle), done: false })),
      })
      if (x.star && this.starsOn(date).length < MAX_STARS) t.star = true
      this.state.tasks.push(t)
      this._editedTask(t)
      fx.push(['taskAdded', t])
      note(`新增「${short(t.title)}」（${day(date)}${t.at ? ` ${t.at}` : ''}）`, { k: 'add', id: t.id, sig: sigOf(t) })
    }

    // ── 太大的任務分成幾段、分到幾天做（store/tasks.js 的 splitSessions）──
    for (const x of act.split || []) {
      const t = find(x?.id)
      if (!movable(t)) continue
      const was = t.title
      const u = this.splitSessions(t.id, x.parts || null)
      if (!u) continue
      const days = [...new Set([u.after.date, ...u.made.map((m) => find(m.id)?.date).filter(Boolean)])].map(day)
      note(`「${short(was)}」分成 ${u.made.length + 1} 段（${days.join('、')}）`, u)
    }

    // ── 拆小步驟 ──
    for (const x of act.steps || []) {
      const t = find(x?.id)
      if (!t || t.done || !Array.isArray(x.steps)) continue
      t.subs ??= []
      const have = new Set(t.subs.map((s) => s.title))
      const added = []
      for (const title of x.steps) {
        const name = str(title, PL.subTitle).trim()
        if (!name || have.has(name) || t.subs.length >= PL.subs) continue
        have.add(name)
        const sub = { id: uid(), title: name, done: false }
        t.subs.push(sub)
        added.push({ id: sub.id, title: name })
      }
      if (!added.length) continue
      this._editedTask(t)
      note(`「${short(t.title)}」拆成 ${added.length} 個小步驟`, { k: 'subs', id: t.id, subs: added })
    }
    for (const x of act.msteps || []) {
      const p = this._find('projects', x?.pid)
      const m = p?.milestones.find((y) => y.id === x.mid)
      if (!m || m.done || p.archived || !Array.isArray(x.steps)) continue
      m.steps ??= []
      const have = new Set(m.steps.map((s) => s.title))
      const added = []
      for (const title of x.steps) {
        const name = str(title, PL.stepTitle).trim()
        if (!name || have.has(name) || m.steps.length >= PL.steps) continue
        have.add(name)
        const step = { id: uid(), title: name, done: false }
        m.steps.push(step)
        added.push({ id: step.id, title: name })
      }
      if (!added.length) continue
      this._authored(p)
      this._edited(p)
      note(`「${short(p.name, 14)}」的「${short(m.title, 14)}」加了 ${added.length} 個細項`, { k: 'msteps', pid: p.id, mid: m.id, steps: added })
    }

    // ── 本命、先做的那一件 ──
    for (const x of act.star || []) {
      const t = find(x?.id)
      if (!t || t.done || !!t.star === x.on) continue
      if (x.on && (floating(t) || t.date < today || this.starsOn(t.date).length >= MAX_STARS)) continue
      t.star = x.on
      this._editedTask(t)
      note(`${x.on ? '本命' : '取消本命'}：「${short(t.title)}」`, { k: 'star', id: t.id, on: x.on })
    }
    if (act.first) {
      const t = find(act.first)
      if (t && !t.done && !floating(t) && t.date >= today && !t.first) {
        const was = this.tasksOn(t.date).find((y) => y.first && y !== t)
        // 使用者自己挑好的不換（自己整理時）
        if (!was || chat) {
          if (was) was.first = false
          t.first = true
          note(`${t.date === today ? '' : day(t.date)}先做「${short(t.title)}」`, { k: 'first', id: t.id, was: was?.id || null })
        }
      }
    }

    // ── 使用者開口才做的：勾完成、刪掉、日程、重要日子 ──
    if (chat) {
      for (const id of act.done || []) {
        const t = find(id)
        if (!t || t.done) continue
        this.toggleTask(id)
        if (t.done) note(`完成「${short(t.title)}」`, { k: 'done', id })
      }
      for (const id of act.drop || []) {
        const t = find(id)
        if (!t) continue
        // 整件留著（撤銷時照原樣放回去，id 也一樣），連同指著它的進度紀錄
        const logs = []
        for (const p of this.state.projects) {
          for (const l of p.logs) {
            const ref = [p.id, l.id]
            if (l.task === id) logs.push(ref)
          }
        }
        const u = { k: 'drop', task: JSON.stringify(t), logs }
        const title = t.title
        this.deleteTask(id)
        note(`刪掉「${short(title)}」`, u)
      }
      for (const x of act.dates || []) {
        if (!okDate(x.date)) continue
        const d = this.addDate({ title: x.title, date: x.date, kind: x.kind === 'day' ? 'day' : x.kind === 'exam' ? 'exam' : 'deadline' })
        if (d) note(`重要日子「${short(d.title)}」（${day(d.date)}）`, { k: 'date', id: d.id })
      }
      // 任務以外的：改欄位、勾完成、刪掉（專案、習慣、設定…，見 store/agentOps.js；日程、作息在最前面做過了）
      this._agentRest(act.ops, note, false)
    } else if (act.ops?.drop?.length) {
      // 自己整理時：變成任務的「先記下來的事」拿掉（cleanOut 只留這一種）
      this._agentRest({ set: [], create: [], done: [], drop: act.ops.drop.filter((x) => x?.kind === 'park'), go: null }, note, false)
    }

    // ── 記住、忘掉 ──
    const a = this.state.agent
    for (const m of act.forget || []) {
      const i = a.memory.findIndex((y) => y === m || y.includes(m) || m.includes(y))
      if (i < 0) continue
      const [gone] = a.memory.splice(i, 1)
      note(`忘掉：${short(gone, 30)}`, { k: 'forget', text: gone })
    }
    for (const m of act.remember || []) {
      if (a.memory.includes(m) || a.memory.length >= AGENT_MEMORY_MAX) continue
      a.memory.push(m)
      note(`記住：${short(m, 30)}`, { k: 'remember', text: m })
    }

    // 這一種整理做過了（就算什麼都不用改）：別台裝置、下次打開就不再做一次
    if (run === 'morning') {
      a.ran.morning = today
      if (weekStart) a.ran.week = weekOf(today)
    }
    if (run === 'evening') a.ran.evening = today
    const next = act.next && find(act.next) && !find(act.next).done ? act.next : null
    let entry = null
    if (changes.length || act.say) {
      // 時間一定比上一筆晚（同一毫秒做了兩次、時鐘被往回調時，畫面上的順序也不會亂）
      entry = { id: runId, at: Math.max(Date.now(), (a.log.at(-1)?.at || 0) + 1), run, say: act.say || '', next, changes, undone: false }
      a.log = [...a.log, entry].slice(-AGENT_LOG_MAX)
    }
    fx.push(['agentApplied', { entry, run, count: changes.length }])
    this._finish(fx)
    return entry
  },

  // 沒叫 Claude（離線、出錯、不用整理）也記下這一種今天做過了
  agentRan(run, weekStart = false) {
    const a = this.state.agent
    if (run === 'morning') {
      a.ran.morning = this.today
      if (weekStart) a.ran.week = weekOf(this.today)
    } else if (run === 'evening') a.ran.evening = this.today
    else return
    this.save()
  },

  // 整批撤銷：從最後一個動作往回，只還原之後沒被改過的。回傳還原了幾個
  agentUndo(id) {
    const a = this.state.agent
    const entry = a.log.find((e) => e.id === id)
    if (!entry || entry.undone) return 0
    this._refreshToday()
    const find = (tid) => this._find('tasks', tid)
    let n = 0
    for (const { u } of [...entry.changes].reverse()) {
      if (!u) continue
      const t = u.id ? find(u.id) : null
      if (u.k === 'task') {
        // 之後又被改過（換了日子、時間，或做完了）就不動
        if (!t || t.done || t.date !== u.after.date || (t.at ?? null) !== u.after.at) continue
        this._editedTask(t)
        t.date = u.before.date
        t.at = u.before.at
        // 長度、本命、先做的那一件：還停在ふじ排完的樣子才還原（之後自己改過的留著）
        if ((t.dur ?? null) === u.after.dur) t.dur = u.before.dur
        t.moved = Math.max(0, (t.moved || 0) - Math.max(0, u.after.moved - u.before.moved))
        if (u.before.star && !!t.star === u.after.star && !floating(t)) t.star = true
        if (u.before.first && !!t.first === u.after.first && !floating(t)) t.first = true
        this._fitStar(t)
        this._editedTask(t)
        n++
      } else if (u.k === 'add') {
        // 還是剛加好的樣子才刪：之後改過、開始做了的留著
        if (!t || t.done || sigOf(t) !== u.sig) continue
        this._editedTask(t)
        this.state.tasks = this.state.tasks.filter((x) => x !== t)
        this._dropTaskRefs()
        n++
      } else if (u.k === 'split') {
        if (this.undoSplit(u)) n++
      } else if (u.k === 'subs' || u.k === 'msteps') {
        const p = u.k === 'msteps' ? this._find('projects', u.pid) : null
        const owner = u.k === 'subs' ? t : p?.milestones.find((y) => y.id === u.mid)
        const key = u.k === 'subs' ? 'subs' : 'steps'
        const list = owner?.[key]
        if (!Array.isArray(list)) continue
        // 沒勾、也沒改過字的才拿掉
        const added = new Map(u[key].map((x) => [x.id, x.title]))
        const left = list.filter((s) => !(added.has(s.id) && !s.done && s.title === added.get(s.id)))
        if (left.length === list.length) continue
        owner[key] = left
        if (p) this._edited(p)
        else this._editedTask(t)
        n++
      } else if (u.k === 'star') {
        if (!t || t.done || !!t.star !== u.on) continue
        if (!u.on && (floating(t) || t.date < this.today || this.starsOn(t.date).length >= MAX_STARS)) continue
        t.star = !u.on
        this._editedTask(t)
        n++
      } else if (u.k === 'first') {
        if (!t || !t.first) continue
        t.first = false
        const was = u.was ? find(u.was) : null
        if (was && !was.done && was.date === t.date) was.first = true
        n++
      } else if (u.k === 'edit') {
        if (!t) continue
        // 只還原還停在ふじ改的樣子的欄位。換過專案的：專案和里程碑都還是她換完的樣子，才一起放回去（之後在新專案選了里程碑的留著）
        const patch = {}
        for (const k of ['title', 'tag', 'priority']) if (k in u.before && k in u.after && t[k] === u.after[k]) patch[k] = u.before[k]
        if ('project' in u.before && 'project' in u.after && (t.project ?? null) === u.after.project && (t.ms ?? null) === (u.after.ms ?? null)) {
          patch.project = u.before.project
          if (u.before.ms) patch.ms = u.before.ms
          // 原本是長期任務：還停在移出後的樣子（一般任務、那一天）才變回長期
          if (u.before.ongoing && !t.ongoing && !t.done && 'ongoing' in u.after && (!('date' in u.after) || t.date === u.after.date)) {
            patch.ongoing = true
            if (u.before.date) patch.date = u.before.date
          }
        }
        if (!Object.keys(patch).length) continue
        this.updateTask(t.id, patch)
        n++
      } else if (u.k === 'done') {
        if (!t || !t.done) continue
        this.toggleTask(t.id)
        n++
      } else if (u.k === 'drop') {
        let raw = null
        try {
          raw = JSON.parse(u.task)
        } catch {}
        const back = cleanTask(raw, this.today)
        // 同一個 id 已經在了（撤銷過、別台放回來了）就不再放
        if (!back || !back.id || find(back.id)) continue
        const p = back.project ? this._find('projects', back.project) : null
        if (!p) back.project = back.ms = back.msAuto = null
        else if (back.ms && !p.milestones.some((m) => m.id === back.ms)) back.ms = null
        if (!back.project) back.ongoing = false
        this.state.tasks.push(back)
        this._fitStar(back)
        // 原本指著它、刪掉時被解開的進度紀錄接回去
        for (const [pid, lid] of u.logs || []) {
          const l = this._find('projects', pid)?.logs.find((x) => x.id === lid)
          if (l && !l.task) l.task = back.id
        }
        n++
      } else if (u.k === 'event') {
        if (!this._find('events', u.id)) continue
        this.deleteEvent(u.id)
        n++
      } else if (u.k === 'date') {
        if (!this._find('dates', u.id)) continue
        this.deleteDate(u.id)
        n++
      } else if (u.k === 'remember') {
        const i = a.memory.indexOf(u.text)
        if (i < 0) continue
        a.memory.splice(i, 1)
        n++
      } else if (u.k === 'forget') {
        if (a.memory.includes(u.text) || a.memory.length >= AGENT_MEMORY_MAX) continue
        a.memory.push(u.text)
        n++
      } else if (this._agentUndoOp(u)) n++
    }
    entry.undone = true
    this._finish([['agentUndone', { id, count: n }]])
    return n
  },
  // 那一筆還有沒有可以撤銷的東西
  agentCanUndo(id) {
    const e = this.state.agent.log.find((x) => x.id === id)
    return !!e && !e.undone && e.changes.some((c) => c.u)
  },

  // ── ふじ記得的事（設定裡可以自己加、刪） ──
  agentRemember(text) {
    const a = this.state.agent
    const m = str(text, 80).replace(/\s+/g, ' ').trim()
    if (!m || a.memory.includes(m) || a.memory.length >= AGENT_MEMORY_MAX) return false
    a.memory.push(m)
    this._finish()
    return true
  },
  agentForget(i) {
    const a = this.state.agent
    if (!(i >= 0 && i < a.memory.length)) return
    a.memory.splice(i, 1)
    this._finish()
  },
  agentClearLog() {
    this.state.agent.log = []
    this._finish()
  },
}
