import { townLevel, PLAN, inLot, lotsAt, islandRadius } from '../data/projectTown.js'
import { SHOP_ITEMS } from '../data/shop.js'
import { MAX_PROJECTS, XP } from '../theme.js'
import { uid } from './util.js'
import { DATE_RE, ms, projectDetails, cleanPatch, PROJECT_PATCH } from './migrate.js'
import { PROJECT_LIMITS as PL, taskMilestone } from '../projects.js'
export const projectsMethods = {
  // ── 專案町 ──
  // 努力和需求取大的：沒收藏的專案每個都有一塊地，小鎮長到放得下為止，而且不會縮回去
  // { level, effort, points, lots, next }
  get projectTown() {
    return townLevel(this.stats, this.activeProjects().length, this.state.town.plevel)
  },
  // 地塊被商店擺設壓到了就先跳過（擺設搬走後就能用）
  _lotBlocked(i) {
    const lot = PLAN.lots[i]
    return this.state.placed.some((p) => inLot(lot, p.x, p.z, SHOP_ITEMS.find((s) => s.key === p.key)?.r ?? 0.42))
  },
  // 讀檔或同步拉回後（或地上的擺設搬走後）：排好地塊，記下目前的等級（之後長大才慶祝）
  settleLots() {
    const t = this.state.town
    t.plevel = this.projectTown.level
    const before = this.state.projects.map((p) => p.slot).join()
    const open = this.projectTown.lots
    for (const p of this.state.projects) if (p.slot >= open) p.slot = -1
    this._fillSlots()
    if (this.state.projects.map((p) => p.slot).join() !== before) this.save(false)
  },
  // 點數夠了、或專案多到地不夠時，城鎮升級；新開的地馬上分給還沒有地的專案
  // demand：這次是因為專案變多才長的；island：島也跟著變大
  _projectTownCheck(fx) {
    const t = this.state.town
    const town = this.projectTown
    // 還沒記過（剛重置成空島）就安靜記下，不慶祝
    if (!t.plevel) t.plevel = town.level
    if (town.level > t.plevel) {
      const from = t.plevel
      t.plevel = town.level
      fx.push(['projectTownGrew', {
        level: town.level, from, added: lotsAt(town.level) - lotsAt(from),
        demand: town.level > town.effort, island: islandRadius(town.level) > islandRadius(from),
      }])
    }
    this._fillSlots()
  },

  // ── 專案 ──
  // 已開放的地裡第一塊空的
  freeSlot() {
    const used = new Set(this.towerProjects().map((p) => p.slot))
    const open = this.projectTown.lots
    for (let i = 0; i < open; i++) if (!used.has(i) && !this._lotBlocked(i)) return i
    return -1
  },
  canAddProject() {
    return this.activeProjects().length < MAX_PROJECTS
  },
  // 專案狀態：active 進行中、paused 暫停、done 已落成（收藏另外看 archived）
  projectStatus(p) {
    return p.completedAt ? 'done' : p.pausedAt ? 'paused' : 'active'
  },
  // 暫停／繼續：暫停的專案沒有到期提醒，房子的旗子降下來；已落成的不用暫停
  pauseProject(id, paused = true) {
    const p = this._find('projects', id)
    if (!p || p.completedAt || !!p.pausedAt === paused) return
    p.pausedAt = paused ? Date.now() : null
    this._edited(p)
    this._finish()
  },
  // 還沒有地的專案依序分到空地（進行中的優先、再來暫停的、已落成的最後，同狀態先建立的先）
  _fillSlots() {
    const rank = { active: 0, paused: 1, done: 2 }
    const waiting = this.activeProjects()
      .filter((p) => p.slot < 0)
      .sort((a, b) => rank[this.projectStatus(a)] - rank[this.projectStatus(b)] || a.createdAt - b.createdAt)
    for (const p of waiting) {
      const slot = this.freeSlot()
      if (slot < 0) break
      p.slot = slot
    }
  },
  // deadline 可以不設（空字串）：沒有截止日的專案就沒有到期提醒和準時落成獎勵
  // 開放的地用完了，城鎮會長到放得下（_finish 裡的 _projectTownCheck）
  addProject({ name, color = 0, deadline = '', milestones = [] }) {
    if (!this.canAddProject() || !name.trim()) return null
    const slot = this.freeSlot()
    const p = {
      id: uid(), name: name.trim(), color, deadline: DATE_RE.test(deadline) ? deadline : '', slot, createdAt: Date.now(), editedAt: Date.now(),
      milestones: milestones.map((t) => t.trim()).filter(Boolean).map((t) => ms(t)),
      completedAt: null, pausedAt: null, archived: false, ...projectDetails(),
    }
    this.state.projects.push(p)
    this.stats.projectsCreated++
    this._finish([['projectAdded', p]])
    return p
  },
  updateProject(id, patch) {
    const p = this._find('projects', id)
    if (!p) return
    patch = cleanPatch(p, patch, PROJECT_PATCH)
    if ('name' in patch) this._authored(p)
    Object.assign(p, patch)
    this._edited(p)
    this._finish()
  },
  // 範例專案裡寫進了自己的東西（名字、目標、里程碑、細項、進度、筆記）：從此算使用者的，清範例時留著。
  // 只是打勾不算（「認識ひより小島」本來就是要你勾著玩的）
  _authored(p) {
    if (p.id.startsWith('ex-')) p.mine = true
  },
  // 動到了這個專案（改名、里程碑、細項、進度、筆記、歸在它底下的任務、專注在它上面…）：專案列表把它排到前面
  _edited(p) {
    if (p) p.editedAt = Date.now()
  },
  _editedTask(t) {
    if (t?.project) this._edited(this._find('projects', t.project))
  },
  // 推進了這件任務（勾子任務、寫紀錄、記數字、專注在它上面）：記下時間（長期任務太久沒碰時提醒用），專案也算動到
  _touch(t) {
    if (!t) return
    t.touched = Date.now()
    this._editedTask(t)
  },
  // 改截止日；空字串 = 不設截止日
  setDeadline(id, date) {
    const p = this._find('projects', id)
    const d = DATE_RE.test(date) ? date : ''
    if (!p || p.deadline === d) return
    p.deadline = d
    this._edited(p)
    this._finish()
  },
  // 刪掉專案時，歸在它底下的任務留著，只是不再歸屬
  deleteProject(id) {
    const p = this._find('projects', id)
    if (!p) return
    // 跟刪掉一筆進度一樣：整個專案刪掉，它的進度也不算進累計筆數（不能建了寫、寫了刪來刷成就）
    this.stats.projectLogs = Math.max(0, this.stats.projectLogs - p.logs.length)
    this.state.projects = this.state.projects.filter((x) => x.id !== id)
    for (const t of this.state.tasks) if (t.project === id) this._leaveProject(t)
    this._fillSlots()
    this._finish()
  },
  // 收藏：房子拆掉，地空出來。放回：重新分一塊地（不夠的話城鎮長大）
  archiveProject(id, archived = true) {
    const p = this._find('projects', id)
    if (!p) return false
    if (!archived && !this.canAddProject()) return false
    p.archived = archived
    p.slot = -1
    this._edited(p)
    this._finish()
    return true
  },
  addMilestone(pid, title) {
    const p = this._find('projects', pid)
    if (!p || !title.trim()) return
    this._authored(p)
    p.milestones.push(ms(title.trim()))
    this._edited(p)
    this._finish()
  },
  deleteMilestone(pid, mid) {
    const p = this._find('projects', pid)
    if (!p) return
    p.milestones = p.milestones.filter((m) => m.id !== mid)
    // 進度日誌裡標著這個里程碑的，留著字、拿掉標記；選了它的任務改回自動
    for (const l of p.logs) if (l.ms === mid) l.ms = null
    for (const t of this.state.tasks) if (t.ms === mid) t.ms = null
    this._edited(p)
    const fx = []
    this._completeProject(p, fx)
    this._finish(fx)
  },
  _completeProject(p, fx) {
    if (!p.milestones.length || p.completedAt || !p.milestones.every((m) => m.done)) return
    p.completedAt = Date.now()
    p.pausedAt = null
    this.stats.projectsDone++
    this._gain(XP.project, fx, { kind: 'project', id: p.id })
    fx.push(['projectDone', p])
    // 在期限當天或之前落成：額外獎勵
    if (p.deadline && this.today <= p.deadline) {
      p.onTime = true
      this.stats.projectsOnTime++
      this._gain(XP.onTime, fx, { kind: 'onTime', id: p.id })
      fx.push(['projectOnTime', p])
    }
  },
  toggleMilestone(pid, mid) {
    const p = this._find('projects', pid)
    const m = p?.milestones.find((x) => x.id === mid)
    if (!m) return
    this._refreshToday()
    const fx = []
    this._setMilestone(p, m, !m.done, fx)
    this._edited(p)
    this._finish(fx)
  },
  // 完成／取消一個里程碑（經驗只給第一次）；全部完成時專案落成
  _setMilestone(p, m, done, fx) {
    m.done = done
    m.doneAt = done ? Date.now() : null
    if (done) {
      fx.push(['milestoneDone', { project: p, milestone: m }])
      if (!m.rewarded) {
        m.rewarded = true
        this.stats.milestonesDone++
        this.day().milestones++
        this._gain(XP.milestone, fx, { kind: 'milestone', id: p.id })
      }
      this._completeProject(p, fx)
    } else {
      fx.push(['milestoneUndone', { project: p, milestone: m }])
    }
  },
  _milestone(pid, mid) {
    const p = this._find('projects', pid)
    const m = p?.milestones.find((x) => x.id === mid)
    return m ? { p, m } : {}
  },
  // 改里程碑的名稱、備註、期限
  updateMilestone(pid, mid, patch) {
    const { p, m } = this._milestone(pid, mid)
    if (!m) return
    this._authored(p)
    if (typeof patch.title === 'string' && patch.title.trim()) m.title = patch.title.trim().slice(0, 120)
    if (typeof patch.note === 'string') m.note = patch.note.trim().slice(0, PL.msNote)
    if ('due' in patch) m.due = DATE_RE.test(patch.due) ? patch.due : ''
    this._edited(p)
    this._finish()
  },
  // 往上（-1）或往下（1）挪一格
  moveMilestone(pid, mid, dir) {
    const p = this._find('projects', pid)
    const i = p ? p.milestones.findIndex((m) => m.id === mid) : -1
    const j = i + dir
    if (i < 0 || j < 0 || j >= p.milestones.length) return
    const list = p.milestones
    ;[list[i], list[j]] = [list[j], list[i]]
    this._edited(p)
    this._finish()
  },
  // ── 里程碑的細項：最後一項打勾時里程碑跟著完成，取消任何一項時里程碑也回到未完成 ──
  addStep(pid, mid, title) {
    const { p, m } = this._milestone(pid, mid)
    title = String(title || '').trim().slice(0, PL.stepTitle)
    if (!m || !title || m.steps.length >= PL.steps) return null
    this._authored(p)
    const step = { id: uid(), title, done: false }
    m.steps.push(step)
    this._edited(p)
    this._finish()
    return step
  },
  toggleStep(pid, mid, sid) {
    const { p, m } = this._milestone(pid, mid)
    const step = m?.steps.find((x) => x.id === sid)
    if (!step) return
    this._refreshToday()
    step.done = !step.done
    const fx = []
    if (step.done && !m.done && m.steps.every((x) => x.done)) this._setMilestone(p, m, true, fx)
    else if (!step.done && m.done) this._setMilestone(p, m, false, fx)
    this._edited(p)
    this._finish(fx)
  },
  renameStep(pid, mid, sid, title) {
    const { p, m } = this._milestone(pid, mid)
    const step = m?.steps.find((x) => x.id === sid)
    title = String(title || '').trim().slice(0, PL.stepTitle)
    if (!step || !title) return
    this._authored(p)
    step.title = title
    this._edited(p)
    this._finish()
  },
  deleteStep(pid, mid, sid) {
    const { p, m } = this._milestone(pid, mid)
    if (!m) return
    m.steps = m.steps.filter((x) => x.id !== sid)
    this._refreshToday()
    const fx = []
    // 剩下的都做完了：里程碑也算完成
    if (!m.done && m.steps.length && m.steps.every((x) => x.done)) this._setMilestone(p, m, true, fx)
    this._edited(p)
    this._finish(fx)
  },

  // ── 專案的目標、進度日誌、筆記 ──
  setProjectGoal(id, text) {
    const p = this._find('projects', id)
    const goal = String(text || '').trim().slice(0, PL.goal)
    if (!p || p.goal === goal) return
    this._authored(p)
    p.goal = goal
    this._edited(p)
    this._finish()
  },
  // 寫一則進度。date：這則進度是哪天的事（可以補記以前，不能記未來）；mins：花了多久；ms：跟哪個里程碑有關；
  // task：在任務頁寫的（要是歸在這個專案的任務；沒指定里程碑時跟著那件任務算的里程碑）。
  // 每個專案每天第一則給一點經驗（一天最多算 3 個專案），之後照記但不再給
  addProjectLog(pid, { text = '', mins = 0, date = null, ms: mid = null, task: tid = null } = {}) {
    const p = this._find('projects', pid)
    text = String(text || '').trim().slice(0, PL.logText)
    mins = Math.max(0, Math.min(PL.logMins, Math.round(+mins || 0)))
    // 滿了就不再加（不刪舊的騰位置）
    if (!p || (!text && !mins) || p.logs.length >= PL.logs) return null
    this._refreshToday()
    this._authored(p)
    const day = DATE_RE.test(date) && date <= this.today ? date : this.today
    const t = tid ? this.state.tasks.find((x) => x.id === tid && x.project === p.id) : null
    if (t && !mid) mid = taskMilestone(p, t)?.id
    const log = { id: uid(), date: day, at: Date.now(), text, mins, ms: p.milestones.some((m) => m.id === mid) ? mid : null, task: t ? t.id : null }
    p.logs.push(log)
    p.logs.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)
    this.stats.projectLogs++
    this._edited(p)
    if (t) t.touched = Date.now()
    const fx = []
    const first = p.logDay !== this.today
    if (first) {
      p.logDay = this.today
      const d = this.day()
      d.plogs++
      if (d.plogs <= 3) this._gain(XP.projectLog, fx, { kind: 'projectLog', id: p.id })
    }
    fx.push(['projectLogged', { project: p, log, first }])
    this._finish(fx)
    return log
  },
  updateProjectLog(pid, lid, patch) {
    const p = this._find('projects', pid)
    const l = p?.logs.find((x) => x.id === lid)
    if (!l) return
    const text = typeof patch.text === 'string' ? patch.text.trim().slice(0, PL.logText) : l.text
    const mins = 'mins' in patch ? Math.max(0, Math.min(PL.logMins, Math.round(+patch.mins || 0))) : l.mins
    // 字和時間都清空了：當成刪掉
    if (!text && !mins) return this.deleteProjectLog(pid, lid)
    this._authored(p)
    Object.assign(l, { text, mins })
    if (DATE_RE.test(patch.date) && patch.date <= this.today) l.date = patch.date
    if ('ms' in patch) l.ms = p.milestones.some((m) => m.id === patch.ms) ? patch.ms : null
    p.logs.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)
    this._edited(p)
    this._finish()
  },
  deleteProjectLog(pid, lid) {
    const p = this._find('projects', pid)
    if (!p) return
    const n = p.logs.length
    p.logs = p.logs.filter((x) => x.id !== lid)
    if (p.logs.length === n) return
    // 跟生活記錄一樣：刪掉的進度不算進累計筆數
    this.stats.projectLogs = Math.max(0, this.stats.projectLogs - 1)
    this._edited(p)
    this._finish()
  },
  addProjectNote(pid, { title = '', body = '' } = {}) {
    const p = this._find('projects', pid)
    if (!p || p.notes.length >= PL.notes) return null
    this._authored(p)
    const now = Date.now()
    const note = { id: uid(), title: String(title).slice(0, PL.noteTitle), body: String(body).slice(0, PL.noteBody), pinned: false, createdAt: now, updatedAt: now }
    p.notes.push(note)
    this._edited(p)
    this._finish()
    return note
  },
  // quiet：打字時的自動儲存，只存檔、不重畫面板（不然正在打的字會被打斷）
  updateProjectNote(pid, nid, patch, { quiet = false } = {}) {
    const p = this._find('projects', pid)
    const n = p?.notes.find((x) => x.id === nid)
    if (!n) return
    if (typeof patch.title === 'string' || typeof patch.body === 'string') this._authored(p)
    if (typeof patch.title === 'string') n.title = patch.title.slice(0, PL.noteTitle)
    if (typeof patch.body === 'string') n.body = patch.body.slice(0, PL.noteBody)
    if ('pinned' in patch) n.pinned = !!patch.pinned
    else n.updatedAt = Date.now()
    this._edited(p)
    if (!quiet) return this._finish()
    this.save()
    this.emit('noteSaved', { project: p, note: n })
  },
  deleteProjectNote(pid, nid) {
    const p = this._find('projects', pid)
    if (!p) return
    p.notes = p.notes.filter((x) => x.id !== nid)
    this._edited(p)
    this._finish()
  },

}
