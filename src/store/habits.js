import { uid, daysBetween, HABIT_PAID_DAYS, minToHHMM, toMin } from './util.js'
import { num, weekdays, TIME_RE } from './migrate.js'
import { doneOn, countOn, applies, streak as habitStreak, todayProgress, cleanDays, QUIT_MILESTONES } from '../habits.js'
import { XP } from '../theme.js'
import { BOND_POINTS } from '../data/bond.js'
import { LIFE_KINDS } from '../data/life.js'
export const habitsMethods = {
  // ── 習慣 ──
  habit(id) {
    return this.state.habits.find((h) => h.id === id)
  },
  activeHabits() {
    return this.state.habits.filter((h) => !h.archived)
  },
  addHabit({ name, kind = 'build', icon = '', color = 0, target = 1, unit = '次', days = [] }) {
    name = String(name || '').trim().slice(0, 30)
    if (!name) return null
    const h = {
      id: uid(), name, kind: kind === 'quit' ? 'quit' : 'build', icon: String(icon || '').slice(0, 2) || (kind === 'quit' ? '禁' : '習'),
      color: num(color, 0, 99, 0), target: num(target, 1, 99, 1), unit: String(unit || '次').trim().slice(0, 6) || '次', days: weekdays(days),
      start: this.today, createdAt: Date.now(), archived: false, log: {}, urges: {}, slips: [], ms: 0, paid: '', paidDays: [], msPaid: 0,
    }
    this.state.habits.push(h)
    this._finish([['habitAdded', h]])
    return h
  },
  updateHabit(id, patch) {
    const h = this.habit(id)
    if (!h) return
    if (patch.name !== undefined) h.name = String(patch.name).trim().slice(0, 30) || h.name
    if (patch.icon !== undefined) h.icon = String(patch.icon).slice(0, 2) || h.icon
    if (patch.color !== undefined) h.color = num(patch.color, 0, 99, h.color)
    if (patch.target !== undefined) h.target = num(patch.target, 1, 99, h.target)
    if (patch.unit !== undefined) h.unit = String(patch.unit).trim().slice(0, 6) || h.unit
    if (patch.days !== undefined) h.days = weekdays(patch.days)
    if (patch.archived !== undefined) h.archived = !!patch.archived
    this._finish()
  },
  deleteHabit(id) {
    this.state.habits = this.state.habits.filter((h) => h.id !== id)
    this._finish()
  },
  // 養成：打卡（delta 可以是 -1 收回一次）。過去的日子也能補打卡，但只有今天第一次完成有獎勵
  checkHabit(id, date = null, delta = 1) {
    const h = this.habit(id)
    if (!h || h.kind !== 'build' || h.archived) return
    // 先跨日再決定日期：開著過了午夜，第一次打卡要記在新的一天
    this._refreshToday()
    date ??= this.today
    if (date > this.today) return
    if (date < h.start) {
      // 補開始日以前的卡（剛開始記、但其實已經做了幾天）：開始日往前移，最多 12 週
      if (delta <= 0 || daysBetween(date, this.today) > 84) return
      h.start = date
    }
    const before = doneOn(h, date)
    const n = Math.max(0, Math.min(99, countOn(h, date) + delta))
    if (n) h.log[date] = n
    else delete h.log[date]
    const fx = [['habitCheck', { habit: h, date, count: n, delta }]]
    // 獎勵只給今天該做的習慣；休息日多做也能記，但不算進完成與連續天數
    if (!before && doneOn(h, date) && date === this.today && h.paid !== this.today && !h.paidDays?.includes(this.today) && applies(h, date)) {
      h.paid = this.today
      h.paidDays = [...(h.paidDays || []), this.today].sort().slice(-HABIT_PAID_DAYS)
      const d = this.day()
      d.habits++
      this.stats.habitChecks++
      this._touchStreak()
      this._gain(XP.habit, fx, { kind: 'habit', id: h.id })
      fx.push(['habitDone', { habit: h, streak: habitStreak(h, this.today) }])
      const prog = todayProgress(this.state.habits, this.today)
      if (prog.total >= 2 && prog.done === prog.total && !d.habitAll) {
        d.habitAll = true
        this._gain(XP.habitAll, fx, { kind: 'habitAll' })
        this._bondGain(BOND_POINTS.habitAll, fx)
        fx.push(['habitAll', prog])
      }
    }
    this._finish(fx)
  },
  // 戒除：忍住了一次（每個習慣每天前 3 次有獎勵）
  resistUrge(id) {
    const h = this.habit(id)
    if (!h || h.kind !== 'quit' || h.archived) return
    this._refreshToday()
    const n = (h.urges[this.today] || 0) + 1
    h.urges[this.today] = n
    this.stats.urgesResisted++
    this.day().urges++
    const fx = [['urgeResisted', { habit: h, count: n, days: cleanDays(h, this.today) }]]
    if (n <= 3) this._gain(XP.urge, fx, { kind: 'urge', id: h.id })
    this._finish(fx)
  },
  // 戒除：破戒了。沒有懲罰，只是重新起算
  slipHabit(id, note = '') {
    const h = this.habit(id)
    if (!h || h.kind !== 'quit' || h.archived) return
    this._refreshToday()
    const days = cleanDays(h, this.today)
    h.slips.push({ at: Date.now(), note: String(note || '').trim().slice(0, 80) })
    h.slips = h.slips.slice(-500)
    h.ms = 0
    this._finish([['habitSlip', { habit: h, days }]])
  },
  // 撤銷最後一次破戒（按錯時用）
  undoSlip(id) {
    const h = this.habit(id)
    if (!h || h.kind !== 'quit' || !h.slips.length) return
    h.slips.pop()
    // 已經領過的里程碑不再重發
    const days = cleanDays(h, this.today)
    h.ms = Math.max(h.ms, ...QUIT_MILESTONES.filter((m) => m <= days))
    this._finish()
  },
  // 戒除里程碑（1、3、7、14…天）：跨日時檢查。每段乾淨期走到都會慶祝一次，
  // 但經驗值每個里程碑只給一次（不然每天破戒一次，隔天就能再領一次「1 天」的經驗）
  _quitMilestones(fx) {
    for (const h of this.state.habits) {
      if (h.kind !== 'quit' || h.archived) continue
      const days = cleanDays(h, this.today)
      const m = Math.max(0, ...QUIT_MILESTONES.filter((x) => x <= days))
      if (m > h.ms) {
        h.ms = m
        const xp = m > (h.msPaid || 0)
        if (xp) {
          h.msPaid = m
          this._gain(XP.quitMilestone, fx, { kind: 'quit', id: h.id })
        }
        fx.push(['quitMilestone', { habit: h, days: m, xp }])
      }
    }
  },
  habitsDueToday() {
    return this.activeHabits().filter((h) => h.kind === 'build' && applies(h, this.today))
  },

  // ── 生活記錄 ──
  lifeOn(date) {
    return this.state.life[date] || { items: [], energy: 0 }
  },
  addLife(date, { kind = 'note', text = '', amount = 0, t } = {}) {
    this._refreshToday()
    if (date > this.today) return null
    text = String(text || '').trim().slice(0, 120)
    amount = num(amount, 0, 1e7, 0)
    if (!text && !amount) return null
    const now = new Date()
    const item = {
      id: uid(), kind: LIFE_KINDS.some((k) => k.key === kind) ? kind : 'note', text, amount,
      t: TIME_RE.test(t) ? t : date === this.today ? minToHHMM(now.getHours() * 60 + now.getMinutes()) : '12:00',
    }
    const day = (this.state.life[date] ||= { items: [], energy: 0 })
    day.items.push(item)
    day.items.sort((a, b) => toMin(a.t) - toMin(b.t))
    this.stats.lifeEntries++
    const fx = [['lifeLogged', { date, item, count: day.items.length }]]
    if (date === this.today) {
      const d = this.day()
      d.life++
      if (d.life <= 3) this._gain(XP.life, fx, { kind: 'life' })
    }
    this._finish(fx)
    return item
  },
  updateLife(date, id, patch) {
    const item = this.lifeOn(date).items.find((x) => x.id === id)
    if (!item) return
    if (patch.text !== undefined) item.text = String(patch.text).trim().slice(0, 120)
    if (patch.amount !== undefined) item.amount = num(patch.amount, 0, 1e7, 0)
    if (patch.t !== undefined && TIME_RE.test(patch.t)) item.t = patch.t
    if (patch.kind !== undefined && LIFE_KINDS.some((k) => k.key === patch.kind)) item.kind = patch.kind
    if (!item.text && !item.amount) return this.deleteLife(date, id)
    this.state.life[date].items.sort((a, b) => toMin(a.t) - toMin(b.t))
    this._finish()
  },
  deleteLife(date, id) {
    const day = this.state.life[date]
    if (!day) return
    const n = day.items.length
    day.items = day.items.filter((x) => x.id !== id)
    if (day.items.length === n) return
    // 刪掉的不算數：不然加了又刪就能一直灌累計筆數（成就、小鎮）。當天給經驗的次數照舊（刪掉再加不會再給）
    this.stats.lifeEntries = Math.max(0, this.stats.lifeEntries - 1)
    if (!day.items.length && !day.energy) delete this.state.life[date]
    this._finish()
  },
  setEnergy(date, energy) {
    this._refreshToday()
    if (date > this.today) return
    const day = (this.state.life[date] ||= { items: [], energy: 0 })
    day.energy = num(energy, 0, 5, 0)
    if (!day.items.length && !day.energy) delete this.state.life[date]
    this._finish()
  },

}
