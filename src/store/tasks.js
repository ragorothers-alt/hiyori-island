import { blankTask, TIME_RE, newTempo, isObj, floating, cleanPatch, TASK_PATCH, DATE_RE, str, TEMPLATES_MAX, blank, taskSig } from './migrate.js'
import { PROJECT_LIMITS as PL, taskMilestone, unitOf, bpmOf } from '../projects.js'
import { uid, seasonKey, daysBetween, dateStr, addDays, isSampleId } from './util.js'
import { taskDur, sessionLen, SPLIT_MAX } from '../planner.js'
import { MAX_STARS, TAGS, PRIORITIES, SOFT_CAP, XP } from '../theme.js'
import { BOND_POINTS } from '../data/bond.js'
import { rollFlower, flowerOf } from '../data/flowers.js'
export const tasksMethods = {
  // ── 任務 ──
  // ongoing：長期任務（要歸在專案裡才算），日期記成今天、不排時段；subs：一起建好的子任務（標題）；
  // tempo：要記數字進度，先開好、還沒填。true＝節拍器速度（練習曲），{ unit } 是別的單位
  // due：截止日（一定要做完的那天，可以比 date 晚）
  addTask({ title, priority = 2, tag = 'life', date = this.selectedDate, dur = null, at = null, project = null, ms = null, ongoing = false, subs = [], tempo = false, due = null }) {
    const p = project ? this._find('projects', project) : null
    const long = !!ongoing && !!p
    const t = blankTask({
      title: String(title || '').trim(), date: long ? this.today : date, priority, tag, due: DATE_RE.test(due) ? due : null,
      dur: dur ? Math.max(5, Math.min(600, Math.round(dur))) : null, at: !long && TIME_RE.test(at) ? at : null,
      project: p ? project : null, ms: p?.milestones.some((m) => m.id === ms) ? ms : null, ongoing: long,
      subs: (Array.isArray(subs) ? subs : [])
        .map((x) => String(x || '').trim().slice(0, PL.subTitle))
        .filter(Boolean)
        .slice(0, PL.subs)
        .map((x) => ({ id: uid(), title: x, done: false })),
      tempo: tempo ? newTempo(isObj(tempo) ? tempo.unit : '') : null,
    })
    if (!t.title) return null
    this.state.tasks.push(t)
    this._editedTask(t)
    this._finish([['taskAdded', t]])
    return t
  },
  // 本命：每天最多 3 件；已完成的不能改，過去日期的不能新選
  starsOn(date) {
    return this.tasksOn(date).filter((t) => t.star)
  },
  // 本命搬到別天：那天已經有 MAX_STARS 件本命了，這件就不再是本命（不然一天變四件，「全清」永遠湊不齊）
  _fitStar(t) {
    if (t.star && !t.done && this.starsOn(t.date).filter((x) => x !== t).length >= MAX_STARS) t.star = false
    // 那天先做的那一件也只有一件：搬過去的那天已經挑好別件了，就留那天挑的
    if (t.first && this.tasksOn(t.date).some((x) => x !== t && x.first)) t.first = false
  },
  // 撤銷時把本命、那天先做的那一件放回去：原本有、之後沒被拿掉的才放。回到過去的日子也放（那天原本就是本命，
  // 跟「過去的日子不能新選」不衝突）；那天的名額之間已經滿了（另外選了別件），_fitStar 會拿掉
  _restoreMarks(t, was, after) {
    if (floating(t)) return
    if (was.star && !!t.star === !!after.star) t.star = true
    if (was.first && !!t.first === !!after.first) t.first = true
    this._fitStar(t)
  },
  // 那天先做的那一件（前一晚挑好，早上起來不用再想先做什麼）：一天一件，挑了別件就換過去；on=false 取消。
  // 做完的、還沒排在哪一天的長期任務、過去的日子都不能挑。回傳有沒有改
  setFirst(id, on = true) {
    const t = this._find('tasks', id)
    if (!t) return false
    this._refreshToday()
    if (!on) {
      if (!t.first) return false
      t.first = false
      this._finish()
      return true
    }
    if (t.done || floating(t) || t.date < this.today) return false
    // 那天別件也標著的話一起拿掉（匯入的舊資料可能有兩件）
    let others = false
    for (const x of this.tasksOn(t.date)) {
      if (x === t || !x.first) continue
      x.first = false
      others = true
    }
    if (t.first) {
      if (others) this._finish()
      return true
    }
    t.first = true
    this._finish([['firstPicked', t]])
    return true
  },
  // 那天挑好先做、還沒做完的那一件
  firstOn(date) {
    return this.tasksOn(date).find((t) => t.first && !t.done) || null
  },
  toggleStar(id) {
    const t = this._find('tasks', id)
    if (!t || t.done) return
    this._refreshToday()
    if (t.star) {
      t.star = false
      this._finish()
      return
    }
    // 本命是那一天的事：過去的日子、還沒排在哪一天的長期任務都不能選
    if (t.date < this.today || floating(t)) return
    const n = this.starsOn(t.date).length
    if (n >= MAX_STARS) {
      this.emit('starFull', t)
      return
    }
    t.star = true
    if (t.date === this.today && n + 1 === MAX_STARS && new Date().getHours() < 12) this.day().plan = 1
    this._finish([['starPicked', t]])
  },
  toggleTask(id) {
    const t = this._find('tasks', id)
    if (!t) return
    this._refreshToday()
    t.done = !t.done
    t.doneAt = t.done ? Date.now() : null
    // ふじ的計畫裡做完過一件：撤銷那次計畫時照舊算一次套用（之後刪掉這件也一樣）
    const plan = t.done && t.coach && this.state.coach.plans.find((p) => p.id === t.coach)
    if (plan) plan.used = true
    // 長期任務記在完成的那天：花開在今天的花圃、算進今天完成的件數（不算補做逾期的）
    if (t.done && t.ongoing) t.date = this.today
    // 取消完成又回到長期：不排在哪一天，以前排的時段和本命拿掉（跟改成長期、讀存檔時一樣）
    if (floating(t)) {
      t.at = null
      t.star = false
      t.first = false
    }
    // 沒自己選里程碑的專案任務：記下完成這一刻歸到哪個里程碑
    t.msAuto = null
    if (t.done && t.project && !t.ms) t.msAuto = taskMilestone(this._find('projects', t.project) || { milestones: [] }, t)?.id || null
    this._editedTask(t)
    const fx = []
    if (t.done) {
      fx.push(['taskDone', t])
      if (t.date < this.today) fx.push(['revive', t])
      if (!t.rewarded) {
        t.rewarded = true
        const s = this.stats
        s.tasksDone++
        if (t.priority === 3) s.highTasksDone++
        const h = new Date().getHours()
        if (h < 9) s.earlyTasks++
        if (h >= 22) s.nightTasks++
        const d = this.day()
        d.tasks++
        if (t.priority === 3) d.high++
        if (h < 12) d.early++
        d.tagMask |= 1 << Math.max(0, TAGS.findIndex((x) => x.id === t.tag))
        if (t.routineId) d.routines++
        s.bestDayTasks = Math.max(s.bestDayTasks, d.tasks)
        this._touchStreak()
        let xp = PRIORITIES[t.priority]?.xp ?? 10
        if (t.star) {
          xp *= 2
          d.stars++
          s.starsDone++
        }
        // 今天已經開了很多花：之後的任務 XP 減半
        const tired = d.tasks > SOFT_CAP
        if (tired) xp = Math.ceil(xp / 2)
        if (d.tasks === SOFT_CAP + 1) fx.push(['tired', { count: d.tasks }])
        this._gain(xp, fx, { kind: t.star ? 'star' : 'task', id: t.id, tired })
        this._bloom(t, d, fx)
        if (t.star) fx.push(['starDone', t])
      }
      // 本命全清：放在第一次完成的獎勵外面。完成過又取消、之後才選成本命的那件，再完成時也要算得到（每天只給一次）
      if (t.star && t.date === this.today) {
        const d = this.day()
        const stars = this.starsOn(this.today)
        if (!d.starAll && stars.length >= MAX_STARS && stars.every((x) => x.done)) {
          d.starAll = true
          this.stats.starDays++
          this._gain(XP.starAll, fx, { kind: 'starAll' })
          this._bondGain(BOND_POINTS.starAll, fx)
          fx.push(['starAll', stars])
        }
      }
      const list = this.tasksOn(t.date)
      if (t.date === this.today && list.every((x) => x.done)) {
        fx.push(['allDone', { count: list.length }])
        const d = this.day()
        if (list.length >= 3 && !d.perfect) {
          d.perfect = true
          this.stats.perfectDays++
          this._gain(XP.perfectDay, fx, { kind: 'perfect' })
        }
      }
    } else {
      fx.push(['taskUndone', t])
    }
    this._finish(fx)
  },
  // 決定這個任務開出的花，記進圖鑑
  _bloom(t, d, fx) {
    const list = this.tasksOn(t.date)
    const c = {
      tag: t.tag, priority: t.priority, star: !!t.star, pomos: t.pomos || 0, routine: !!t.routineId,
      hour: new Date().getHours(), season: seasonKey(this.today), streak: this.streak,
      late: t.date < this.today ? daysBetween(t.date, this.today) : 0,
      perfect: t.date === this.today && !d.perfect && list.length >= 3 && list.every((x) => x.done),
    }
    t.flower = rollFlower(c, t.id)
    const f = flowerOf(t.flower)
    const e = this.state.dex[f.key]
    const isNew = !e
    if (e) e.n++
    else this.state.dex[f.key] = { at: this.today, n: 1 }
    const rare = f.rarity === 'rare' || f.rarity === 'legend'
    if (rare) d.rare++
    if (isNew || rare) fx.push(['flower', { flower: f, task: t, isNew }])
  },
  updateTask(id, patch) {
    const t = this._find('tasks', id)
    if (!t) return
    patch = cleanPatch(t, patch, TASK_PATCH)
    // 歸到的專案要真的存在；null／空字串＝不歸任何專案
    if ('project' in patch && !(patch.project && this._find('projects', patch.project))) patch = { ...patch, project: null }
    const pid = 'project' in patch ? patch.project : t.project
    // 長期只有歸在專案裡的任務可以設：移出專案就變回一般任務。
    // 長期改回一般任務時，還沒做完的至少排在今天（沒指定日期、或指定的日子已經過去），一變回來就不會是逾期
    const long = !!pid && ('ongoing' in patch ? patch.ongoing : !!t.ongoing)
    if ('ongoing' in patch || long !== !!t.ongoing) {
      patch = { ...patch, ongoing: long }
      if (!long && t.ongoing && !t.done && !(patch.date >= this.today)) patch.date = this.today
    }
    // 還沒完成的任務往後挪：記一次（卡關提醒用）。長期任務的日期不算數
    if (patch.date && DATE_RE.test(t.date) && patch.date > t.date && !t.done && !t.ongoing && !long) t.moved = (t.moved || 0) + 1
    // 換了專案，里程碑就改回自動；選的里程碑要在（換過之後的）那個專案裡，null＝自動
    if ('ms' in patch || pid !== t.project) {
      const ms = 'ms' in patch ? patch.ms : null
      patch = { ...patch, ms: this._find('projects', pid)?.milestones.some((m) => m.id === ms) ? ms : null }
    }
    const moved = pid && pid !== t.project
    // 原本歸的專案和（換過去的）新專案都算動到了
    this._editedTask(t)
    Object.assign(t, patch)
    // 還沒完成的長期任務不排在哪一天：沒有時段、不當本命、不當那天先做的那一件
    if (floating(t)) {
      t.at = null
      t.star = false
      t.first = false
    }
    // 換了專案或改了里程碑：做完的任務照新的歸屬重新記一次自動里程碑
    if ('ms' in patch) t.msAuto = t.done && t.project && !t.ms ? taskMilestone(this._find('projects', t.project), t)?.id || null : null
    this._editedTask(t)
    if (patch.date) this._fitStar(t)
    if (moved) this._gatherTaskLogs(t)
    this._finish()
  },
  // 往後挪到某一天（手機上往左滑「明天再做」）：回傳復原用的紀錄（null＝沒挪）。
  // after 記下挪完的樣子，復原時用來認出「之後又被改過」
  postponeTask(id, to) {
    const t = this._find('tasks', id)
    if (!t || t.done || !DATE_RE.test(to || '') || !(to > t.date)) return null
    const undo = { id, date: t.date, at: t.at ?? null, moved: t.moved || 0, star: !!t.star, first: !!t.first, to }
    this.updateTask(id, { date: to, at: null })
    if (t.date !== to) return null
    undo.after = { at: t.at ?? null, moved: t.moved || 0, star: !!t.star, first: !!t.first }
    return undo
  },
  // 復原剛才的往後挪：日期、時段、往後挪的次數（卡關提醒用）、本命都回到原本的樣子。
  // 之後又被改過就不動：已經不在挪過去的那天、做完了、改成長期，或是在新的那天排了時段（自己排的、別的裝置同步過來的，
  // 那是為新的那天排的，不要蓋掉）。挪的次數只扣掉這一次加的；本命挪過去之後被拿掉的不再放回去；
  // 原本那天的本命已經滿了（之間另外選了別件）就不再當本命
  undoPostpone(u) {
    const t = u?.after && this._find('tasks', u.id)
    if (!t || t.done || floating(t) || t.date !== u.to || (t.at ?? null) !== u.after.at) return false
    this._editedTask(t)
    t.date = u.date
    t.at = u.at
    t.moved = Math.max(0, (t.moved || 0) - (u.after.moved - u.moved))
    this._restoreMarks(t, u, u.after)
    this._editedTask(t)
    this._finish()
    return true
  },
  // 排進某一天的某個時段（編輯面板、日程、今日總覽的「排進最近空檔」）：回傳撤銷用的紀錄（null＝沒排成）。
  // 跟往後挪一樣記下排完的樣子，撤銷時認得出之後又改過
  slotTask(id, date, at, dur) {
    const t = this._find('tasks', id)
    if (!t || t.done || floating(t) || !DATE_RE.test(date || '')) return null
    const snap = (x) => ({ date: x.date, at: x.at ?? null, dur: x.dur ?? null, moved: x.moved || 0, star: !!x.star, first: !!x.first })
    const undo = { id, ...snap(t) }
    if (t.date !== date) this.updateTask(id, { date })
    this.scheduleTask(id, at, dur)
    if (!t.at) return null
    undo.after = snap(t)
    return undo
  },
  // 撤銷剛才的排進時段：日期、時段、長度、往後挪的次數、本命、先做這件都回到原本的樣子。
  // 之後又改過（換了天、時段、長度，做完了、改成長期）就不動，回傳 false
  undoSlot(u) {
    const t = u?.after && this._find('tasks', u.id)
    if (!t || t.done || floating(t) || t.date !== u.after.date || (t.at ?? null) !== u.after.at || (t.dur ?? null) !== u.after.dur) return false
    this._editedTask(t)
    t.date = u.date
    t.at = u.at
    t.dur = u.dur
    t.moved = Math.max(0, (t.moved || 0) - (u.after.moved - u.moved))
    this._restoreMarks(t, u, u.after)
    this._editedTask(t)
    this._finish()
    return true
  },
  // 任務歸到（另一個）專案：在任務頁寫的紀錄跟著搬過去。只是移出專案時紀錄留在原本的專案，當成那個專案的進度
  // （之後放回來也還認得）。搬過去的紀錄不再指著原本專案的里程碑
  _gatherTaskLogs(t) {
    const to = this._find('projects', t.project)
    if (!to) return
    for (const p of this.state.projects) {
      if (p === to || !p.logs.some((l) => l.task === t.id)) continue
      for (const l of p.logs) if (l.task === t.id) to.logs.push({ ...l, ms: null })
      p.logs = p.logs.filter((l) => l.task !== t.id)
      this._authored(to)
    }
    // 搬過來的紀錄一則都不丟（就算超過上限，讀檔時也只擋異常大的匯入）
    to.logs.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)
  },
  // 任務不再歸在專案裡（專案刪掉、範例清掉）：長期任務變回一般任務，還沒做完的排在今天
  _leaveProject(t) {
    t.project = t.ms = null
    if (!t.ongoing) return
    t.ongoing = false
    if (!t.done) t.date = this.today
  },
  // 任務刪掉了：指著它的紀錄留在專案裡，只是不再算那件任務的
  _dropTaskRefs() {
    const ids = new Set(this.state.tasks.map((t) => t.id))
    for (const p of this.state.projects) for (const l of p.logs) if (l.task && !ids.has(l.task)) l.task = null
  },
  // 那件任務在任務頁寫的紀錄（日期舊的在前）
  taskLogs(t) {
    const p = t?.project && this._find('projects', t.project)
    return p ? p.logs.filter((l) => l.task === t.id) : []
  },
  // 歸在這個專案的任務：還沒完成的照日期，已完成的新的在前。
  // 長期任務當成「現在正在做的」：排在逾期和今天的後面、之後日子的前面，彼此照建立的順序
  projectTasks(pid) {
    const list = this.state.tasks.filter((t) => t.project === pid)
    const key = (t) => (t.ongoing ? this.today : t.date)
    const todo = list
      .filter((t) => !t.done)
      .sort((a, b) => key(a).localeCompare(key(b)) || !!a.ongoing - !!b.ongoing || a.createdAt - b.createdAt)
    const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
    return { todo, done }
  },
  deleteTask(id) {
    this._editedTask(this._find('tasks', id))
    this.state.tasks = this.state.tasks.filter((t) => t.id !== id)
    this._dropTaskRefs()
    this._finish([['taskDeleted', id]])
  },
  // ── 大任務分段：一次做不完、空檔放不下的（寫報告 3 小時），分成幾段、一天一段 ──
  // 原本那件變成第一段（子任務、說明、專注紀錄都留在它身上），其他段是新的任務（同一個專案、分類、優先度、截止日），
  // 標題加「（1/3）」。從原本那天（過去的話從今天）起一天一段；有截止日、天數不夠時幾段排在同一天。
  // parts：幾段（沒給就照專注長度算：一段大約一兩輪專注）。回傳撤銷用的紀錄 { k: 'split', id, before, after, made }，沒分是 null
  splitSessions(id, parts = null) {
    this._refreshToday()
    const t = this._find('tasks', id)
    if (!t || t.done || floating(t) || t.routineId) return null
    const total = taskDur(t)
    const n = Math.max(2, Math.min(SPLIT_MAX, Number.isFinite(+parts) && +parts >= 2 ? Math.round(+parts) : Math.ceil(total / sessionLen(this.state.settings.focusMin))))
    const each = Math.max(15, Math.round(total / n / 5) * 5)
    const base = t.title.replace(/\s*（\d+\/\d+）$/, '') || t.title
    const start = t.date < this.today ? this.today : t.date
    const room = t.due && t.due >= start ? daysBetween(start, t.due) + 1 : n
    const span = Math.max(1, Math.min(n, room))
    const dayOf = (i) => addDays(start, Math.floor((i * span) / n))
    const before = { title: t.title, date: t.date, at: t.at ?? null, dur: t.dur ?? null }
    this._editedTask(t)
    t.title = str(`${base}（1/${n}）`)
    t.dur = each
    t.at = null
    t.date = dayOf(0)
    this._fitStar(t)
    this._editedTask(t)
    const made = []
    for (let i = 1; i < n; i++) {
      // 範例分出來的那幾段還是範例（不會被當成自己記的第一件）
      const x = blankTask({ ...(isSampleId(t.id) ? { id: `ex-${uid()}` } : {}), title: str(`${base}（${i + 1}/${n}）`), date: dayOf(i), priority: t.priority, tag: t.tag, dur: each, project: t.project, ms: t.ms, due: t.due })
      this.state.tasks.push(x)
      this._editedTask(x)
      made.push({ id: x.id, sig: taskSig(x) })
    }
    this._finish()
    return { k: 'split', id: t.id, before, after: { title: t.title, date: t.date, at: null, dur: each }, made }
  },
  // 復原分段：還是剛分好樣子的那幾段拿掉；全部都拿掉了，原本那件才變回分段前的樣子（有一段做了、改過，就留著現在的分法）。回傳有沒有改
  undoSplit(u) {
    if (!u || u.k !== 'split' || !Array.isArray(u.made)) return false
    let gone = 0
    for (const m of u.made) {
      const x = this._find('tasks', m.id)
      if (!x || x.done || taskSig(x) !== m.sig) continue
      this._editedTask(x)
      this.state.tasks = this.state.tasks.filter((y) => y !== x)
      gone++
    }
    const t = this._find('tasks', u.id)
    let back = false
    if (gone === u.made.length && t && !t.done && t.title === u.after.title && (t.dur ?? null) === u.after.dur) {
      this._editedTask(t)
      t.title = u.before.title
      t.dur = u.before.dur
      // 日子、時段還是分完的樣子（還沒排時段）才放回原本的
      if (t.date === u.after.date && !t.at && DATE_RE.test(u.before.date)) {
        t.date = u.before.date
        t.at = TIME_RE.test(u.before.at) ? u.before.at : null
      }
      this._fitStar(t)
      this._editedTask(t)
      back = true
    }
    if (!gone && !back) return false
    if (gone) this._dropTaskRefs()
    this._finish()
    return true
  },
  moveToToday(ids) {
    for (const id of ids) {
      const t = this._find('tasks', id)
      if (!t) continue
      if (t.date < this.today && !t.done) t.moved = (t.moved || 0) + 1
      t.date = this.today
      this._fitStar(t)
    }
    this._finish()
  },
  // ── 卡關提醒 ──
  // 卡住的任務：往後挪了 2 次以上，或逾期 3 天以上（例行公事不算）。off：不再提醒的 id
  stuckTasks(off = new Set()) {
    const list = []
    for (const t of this.state.tasks) {
      if (t.done || t.ongoing || t.routineId || off.has(t.id) || t.date > this.today) continue
      const late = daysBetween(t.date, this.today)
      if ((t.moved || 0) >= 2 || late >= 3) list.push({ task: t, moved: t.moved || 0, late })
    }
    return list.sort((a, b) => b.moved - a.moved || b.late - a.late)
  },
  // 好久沒碰的長期任務：長期任務不會逾期、也不在每天的任務裡，放著就沒人提醒。
  // 進行中的專案（沒暫停、沒收藏、沒落成）裡，超過 days 天沒推進的列出來，最久的在前。
  // 推進＝勾子任務、寫紀錄、記數字、專注在它上面；都沒有就從建立那天算。off：不再提醒的 id
  idleLongTasks(days = 7, off = new Set()) {
    const live = new Map(this.state.projects.filter((p) => !p.archived && !p.pausedAt && !p.completedAt).map((p) => [p.id, p]))
    const lastLog = new Map()
    for (const p of live.values()) for (const l of p.logs) if (l.task && l.date > (lastLog.get(l.task) || '')) lastLog.set(l.task, l.date)
    const list = []
    for (const t of this.state.tasks) {
      const p = live.get(t.project)
      if (!p || !floating(t) || off.has(t.id)) continue
      const last = [dateStr(new Date(t.touched || t.createdAt)), lastLog.get(t.id) || '', t.tempo?.log.at(-1)?.date || ''].sort().at(-1)
      const idle = daysBetween(last > this.today ? this.today : last, this.today)
      if (idle >= days) list.push({ task: t, project: p, idle })
    }
    return list.sort((a, b) => b.idle - a.idle)
  },

  // ── 任務範本：常用的一組設定（長期、分類、子任務、要不要記數字），新增任務時選了就照著建 ──
  // 從一件現成的任務存：名稱自己取（例如「練習曲」），同名的蓋過去
  saveTemplate(name, taskId) {
    const t = this._find('tasks', taskId)
    name = str(name, 20).trim()
    if (!t || !name) return null
    const list = this.state.templates
    const old = list.find((x) => x.name === name)
    if (!old && list.length >= TEMPLATES_MAX) return null
    const tpl = {
      id: old?.id || uid(), name, tag: t.tag, ongoing: !!t.ongoing,
      subs: (t.subs || []).map((x) => x.title), tempo: t.tempo ? { unit: t.tempo.unit || '' } : null, createdAt: old?.createdAt || Date.now(),
    }
    this.state.templates = old ? list.map((x) => (x === old ? tpl : x)) : [...list, tpl]
    this._finish()
    return tpl
  },
  deleteTemplate(id) {
    const n = this.state.templates.length
    this.state.templates = this.state.templates.filter((x) => x.id !== id)
    if (this.state.templates.length !== n) this._finish()
  },
  // 拆成三小步：先開個頭、推進一半、收尾，時間照原本的預估分配；本命和專注過的輪數留在第一步。原本那件換掉（不給 XP）
  // 原本那件已經領過獎勵（完成後又取消）的話，三小步也算領過，免得拆開再領一次
  splitTask(id) {
    const t = this._find('tasks', id)
    if (!t || t.done) return null
    const total = Math.max(30, t.dur || [15, 30, 50][t.priority - 1] || 30)
    const steps = [['先開個頭', 0.25], ['推進一半', 0.45], ['收尾', 0.3]]
    const date = t.date < this.today ? this.today : t.date
    const fx = []
    const parts = steps.map(([name, share], i) => {
      // 第一步接手原本那件身上的東西（本命、專注過的輪數、說明、子任務、數字進度）
      const p = blankTask({
        ...(isSampleId(t.id) ? { id: `ex-${uid()}` } : {}),
        title: `${t.title}・${name}`.slice(0, 80), date, priority: t.priority, tag: t.tag, rewarded: !!t.rewarded, createdAt: Date.now() + i,
        dur: Math.max(10, Math.round((total * share) / 5) * 5), coach: t.coach || null, project: t.project || null, ms: t.ms || null,
        ...(i === 0 ? { star: !!t.star, first: !!t.first, pomos: t.pomos || 0, note: t.note || '', subs: t.subs || [], tempo: t.tempo || null } : {}),
      })
      fx.push(['taskAdded', p])
      return p
    })
    // 任務頁寫過的紀錄、說明和子任務交給第一步
    for (const p of this.state.projects) for (const l of p.logs) if (l.task === t.id) l.task = parts[0].id
    const at = this.state.tasks.indexOf(t)
    this.state.tasks.splice(at, 1, ...parts)
    // 逾期的本命搬到今天：今天的本命已經滿了就不再算本命
    this._fitStar(parts[0])
    this._editedTask(t)
    fx.push(['taskSplit', { task: t, parts }])
    this._finish(fx)
    return parts
  },

  // ── 子任務：跟里程碑的細項一樣，最後一個勾完時任務跟著完成（經驗值、開花照常），
  // 任務完成後又取消其中一個時任務回到未完成。子任務本身沒有經驗值 ──
  _sub(id, sid) {
    const t = this._find('tasks', id)
    return { t, x: t?.subs?.find((y) => y.id === sid) }
  },
  addSub(id, title) {
    const t = this._find('tasks', id)
    title = String(title || '').trim().slice(0, PL.subTitle)
    if (!t || !title) return null
    t.subs ??= []
    if (t.subs.length >= PL.subs) return null
    const x = { id: uid(), title, done: false }
    t.subs.push(x)
    this._touch(t)
    this._finish()
    return x
  },
  toggleSub(id, sid) {
    const { t, x } = this._sub(id, sid)
    if (!x) return
    x.done = !x.done
    this._touch(t)
    if (x.done ? !t.done && t.subs.every((y) => y.done) : t.done) return this.toggleTask(id)
    this._finish()
  },
  renameSub(id, sid, title) {
    const { t, x } = this._sub(id, sid)
    title = String(title || '').trim().slice(0, PL.subTitle)
    if (!x || !title) return
    x.title = title
    this._editedTask(t)
    this._finish()
  },
  deleteSub(id, sid) {
    const { t, x } = this._sub(id, sid)
    if (!x) return
    t.subs = t.subs.filter((y) => y !== x)
    this._editedTask(t)
    // 剩下的都做完了：任務也算完成
    if (!t.done && t.subs.length && t.subs.every((y) => y.done)) return this.toggleTask(id)
    this._finish()
  },

  // ── 數字進度（練習曲的節拍器速度，或頁數、公里這類自己取單位的數字）：
  // tempo = { unit, goal 目標, log: [{ date, bpm, at }] 每天做到多少, met 說過「到了」的目標 }，沒在記是 null。
  // 一天一筆：同一天再改就蓋過去，改回上一筆的數字＝今天沒變（那天的拿掉）。沒有經驗值（按 ＋／− 刷不到東西）──
  _tempoOf(t) {
    return (t.tempo ??= newTempo())
  },
  // on：開始記（先空著），unit 是單位（空字串＝節拍器速度）；false：不記了，記過的一起拿掉
  tempoOn(id, on = true, unit = '') {
    const t = this._find('tasks', id)
    if (!t || !!t.tempo === !!on) return
    t.tempo = on ? newTempo(unit) : null
    this._editedTask(t)
    this._finish()
  },
  // 換單位：還沒記過才能換（記過的數字換了單位就不是同一件事了）；目標在新單位的範圍外就清掉
  setTempoUnit(id, unit) {
    const t = this._find('tasks', id)
    const u = unitOf(unit)
    if (!t?.tempo || t.tempo.log.length || t.tempo.unit === u) return
    Object.assign(t.tempo, { unit: u, goal: bpmOf(t.tempo.goal, u), met: null })
    this._editedTask(t)
    this._finish()
  },
  // 目標；空白（或 null）＝不設，看不懂的數字不收
  setTempoGoal(id, bpm) {
    const t = this._find('tasks', id)
    const goal = bpmOf(bpm, t?.tempo?.unit)
    if (!t || (goal === null && !blank(bpm)) || (t.tempo && t.tempo.goal === goal)) return
    this._tempoOf(t).goal = goal
    this._editedTask(t)
    this._finish()
  },
  // 今天練到多快；空白（或 null）＝今天這筆不算（回到前一筆），看不懂的數字不收。
  // 只動今天那一筆：日期比今天晚的（時鐘往回調、換了時區）原樣留著，照日期排好
  setTempo(id, bpm) {
    const t = this._find('tasks', id)
    const v = bpmOf(bpm, t?.tempo?.unit)
    if (!t || (v === null && !blank(bpm))) return
    this._refreshToday()
    const today = this.today
    const tp = this._tempoOf(t)
    const log = tp.log
    // i：今天（或之後第一筆）的位置；cur：今天那筆；prev：今天以前最後一筆的速度
    let i = log.findIndex((e) => e.date >= today)
    if (i < 0) i = log.length
    const cur = log[i]?.date === today ? log[i] : null
    const prev = log[i - 1]?.bpm ?? null
    const was = cur ? cur.bpm : null
    if (v === null ? !cur : v === (cur ? was : prev)) return
    // up：記下了新的速度（不是拿掉今天那筆）
    const up = !(v === null || (cur && v === prev))
    if (!up) log.splice(i, 1)
    else if (cur) Object.assign(cur, { bpm: v, at: Date.now() })
    else log.splice(i, 0, { date: today, bpm: v, at: Date.now() })
    this._touch(t)
    // 第一次練到這個目標才說：說過的目標記在 met（同一天降下來又按上去不再說）；
    // 剛才就已經到了、以前的日子到過的也不算
    const goal = tp.goal
    const fx = []
    if (up && goal && v >= goal && tp.met !== goal && !(was >= goal) && !log.some((e) => e.date !== today && e.bpm >= goal)) {
      tp.met = goal
      fx.push(['tempoReached', { task: t, bpm: v }])
    }
    this._finish(fx)
  },

}
