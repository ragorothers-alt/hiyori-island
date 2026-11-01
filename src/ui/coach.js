import './coach.css'
import { $, esc, ICON } from './dom.js'
import { TAGS, tagOf, PROJECT_COLORS, DATE_KINDS, moodOf } from '../theme.js'
import { FUJI_LINES } from '../data/lines.js'
import { SLOTS, scopeDates, slotText, defaultSlots, parseCoachText, guessTag, askCoach, dayLabel, addDays } from '../coach.js'
import { buildInsights } from '../insights.js'
import { PEAKS } from '../planner.js'

// 「教練 · ふじ」分頁，分成兩頁：
// 排程：ふじ打招呼 → 問卷（全部點選標籤）→ 你的回答 → ふじ排好的預覽 → 套用／換個排法／改答案。
//   對話只放在記憶體；套用後的任務記得是哪一次排程，可以整批撤銷。
// 週報：本週到目前、表現分析（跟上週同一段比）、習慣洞察、記憶圖鑑（每週一張卡）。

const pick = (a) => a[Math.floor(Math.random() * a.length)]
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')
// ふじ的台詞（lines.js 的 FUJI_LINES，含 coachLines.js 合併進來的）
const say = (key, vars = {}, fallback = '') => {
  const list = key.split('.').reduce((o, k) => o?.[k], FUJI_LINES)
  return list?.length ? fill(pick(list), vars) : fallback
}
const hours = (min) => {
  const h = min / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)} 小時`
}
const span = (a, b) => (a === b ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`)
const greetKey = () => {
  const h = new Date().getHours()
  return h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'noon' : h >= 17 && h < 21 ? 'evening' : 'night'
}
const LENS = [25, 50, 90]
const DAYS = [
  { v: 3, label: '輕量', sub: '3 天' },
  { v: 5, label: '穩定', sub: '5 天' },
  { v: 7, label: '全力', sub: '7 天' },
]
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}<small>時</small>${m % 60 ? `${m % 60}<small>分</small>` : ''}` : `${m}<small>分</small>`)
// 跟上週比：↑ 多了、↓ 少了（數字一樣或上週沒有就不標）
const delta = (now, before, unit = '') => {
  if (before == null || now === before) return ''
  const d = now - before
  return `<i class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '↑' : '↓'}${Math.abs(Math.round(d))}${unit}</i>`
}
const CLOCK = '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4.5v3.2h3.2"/><path d="M12 8v4.2l2.8 1.8"/></svg>'

export class CoachView {
  constructor(root, store, hooks) {
    this.root = root
    this.store = store
    this.hooks = hooks
    this.view = 'plan' // plan：排程 | report：週報
    this.step = 'ask' // ask：填問卷 | preview：看預覽 | done：已套用
    this.res = null
    this.planId = null
    this.seed = 0
    this.flash = '' // ふじ剛說的一句（撤銷之後）
    this.history = false
    this.otherOpen = false
    this.examForm = false
    this.draft = ''
    this.a = this._defaults()
    root.addEventListener('click', (e) => this._click(e))
    root.addEventListener('submit', (e) => this._submit(e))
    root.addEventListener('input', (e) => {
      if (e.target.name === 'say') this.draft = e.target.value
    })
    // 問卷裡的小輸入框（自訂項目、新增考試）按 Enter 是加入，不是送出整份問卷
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return
      const box = e.target.closest('[data-r="other"], [data-r="examNew"]')
      if (!box) return
      e.preventDefault()
      box.dataset.r === 'other' ? this._addOther() : this._addExam()
    })
  }

  // ── 回答 ──
  _defaults() {
    const s = this.store
    const last = s.state.coach.last
    const wd = new Date(s.today + 'T00:00:00').getDay()
    const fm = s.state.settings.focusMin
    const a = {
      // 星期天這週只剩今天：傍晚以前排今天，之後排下週
      scope: wd === 0 ? (new Date().getHours() < 18 ? 'today' : 'next') : 'rest',
      date: null,
      focus: new Set(),
      custom: [],
      slots: new Set(last?.slots?.length ? last.slots : defaultSlots(s.state.rhythm)),
      exam: false,
      examId: null,
      days: last?.days || 5,
      len: last?.len || (LENS.includes(fm) ? fm : 50),
      total: null,
    }
    for (const label of last?.focus || []) {
      const key = this._keyOf(label)
      if (key) a.focus.add(key)
    }
    return a
  }
  // 主攻項目的 key：tag:study、proj:<id>、item:<名稱>
  _keyOf(label) {
    const t = TAGS.find((x) => x.label === label)
    if (t) return 'tag:' + t.id
    const p = this._projects().find((x) => x.name === label)
    if (p) return 'proj:' + p.id
    if (this.store.state.coach.items.some((x) => x.label === label)) return 'item:' + label
    return null
  }
  _projects() {
    return this.store.state.projects.filter((p) => !p.archived && !p.completedAt && !p.pausedAt)
  }
  _items() {
    const seen = new Set()
    return [...this.a.custom, ...this.store.state.coach.items].filter((x) => !seen.has(x.label) && seen.add(x.label))
  }
  _focusList() {
    const out = []
    for (const key of this.a.focus) {
      const [kind, v] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
      if (kind === 'tag') out.push({ label: tagOf(v).label, tag: v })
      else if (kind === 'proj') {
        const p = this._projects().find((x) => x.id === v)
        if (p) out.push({ label: p.name, tag: 'work', milestone: p.milestones.find((m) => !m.done)?.title || null })
      } else {
        const it = this._items().find((x) => x.label === v)
        if (it) out.push({ label: it.label, tag: it.tag })
      }
    }
    return out
  }
  _isSunday() {
    return new Date(this.store.today + 'T00:00:00').getDay() === 0
  }
  _dates() {
    const a = this.a
    return scopeDates(a.scope, this.store.today, a.date || this.store.today)
  }
  _exam() {
    if (!this.a.exam) return null
    return this.store.upcomingDates(20, 120).find((d) => d.id === this.a.examId) || null
  }
  _ready() {
    return this.a.focus.size > 0 && this.a.slots.size > 0
  }

  // 任務頁「讓ふじ排這天」
  preset({ scope, date = null }) {
    this.a.scope = scope
    this.a.date = date
    this.step = 'ask'
    this.res = null
    this.history = false
    this.render()
    this.root.closest('.panel-body')?.scrollTo({ top: 0 })
  }

  async _run() {
    if (!this._ready()) return
    const a = this.a
    const dates = this._dates()
    const exam = this._exam()
    this.res = await askCoach({
      dates, focus: this._focusList(), slots: [...a.slots], exam: exam ? { title: exam.title, date: exam.date, only: exam.project ? exam.title : null } : null,
      days: a.days, len: a.len, total: a.total, seed: this.seed, ctx: this.store.coachContext(dates),
    })
    this.step = 'preview'
    this.flash = ''
    this.reply = this._replyText()
    this.render()
    requestAnimationFrame(() => $('[data-r="reply"]', this.root)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  _replyText() {
    const r = this.res
    if (!r.days.length) return [say('coachEmpty', {}, '選的時段裡沒有空檔，換幾個時段試試吧。')]
    const count = r.days.reduce((n, d) => n + d.items.length, 0)
    const out = [say('coachPlan', { days: r.picked, count, hours: hours(r.totalMin) }, `排了 ${r.picked} 天、${count} 段，先看看。`)]
    const exam = this._exam()
    if (exam) out.push(say('coachExam', { title: exam.title, n: exam.days }))
    if (r.unplaced) out.push(say('coachFull', { left: r.unplaced }))
    return out.filter(Boolean)
  }

  _apply() {
    const r = this.res
    if (!r?.days.length) return
    const a = this.a
    const focus = this._focusList()
    const id = this.store.applyCoachPlan(r, {
      title: focus.map((f) => f.label).join('、'),
      answers: { focus: focus.map((f) => f.label), slots: [...a.slots], days: a.days, len: a.len },
      custom: a.custom.filter((c) => a.focus.has('item:' + c.label)),
    })
    if (!id) return
    this.planId = id
    this.step = 'done'
    const count = r.days.reduce((n, d) => n + d.items.length, 0)
    this.doneText = say('coachApplied', { count, days: r.days.length }, '排好了，照自己的步調來。')
    this.render()
    // 捲到最下面，讓「撤銷／到日程看看」露出來（不被下方的輸入框蓋住）
    requestAnimationFrame(() => this.root.closest('.panel-body')?.scrollTo({ top: 1e6, behavior: 'smooth' }))
  }
  _undo(id) {
    const n = this.store.undoCoachPlan(id)
    this.hooks.toast?.({ icon: '戻', title: `撤銷了 ${n} 件ふじ排的任務`, sub: '已經完成的留著' })
    if (id === this.planId) {
      this.planId = null
      this.step = 'ask'
      this.res = null
      this.flash = say('coachUndo', { count: n }, '撤銷了，想換個排法再告訴我。')
    }
    this.render()
  }

  // 一行輸入：「這週的數學複習 3小時」→ 填進問卷，齊了就直接排
  _fromText(text) {
    const p = parseCoachText(text, this.store.today)
    const a = this.a
    if (p.scope === 'day') {
      a.scope = 'day'
      a.date = p.date
    } else if (p.scope) {
      // 星期天說「這週」：傍晚以前就是今天，之後當作下週
      a.scope = p.scope === 'rest' && this._isSunday() ? (new Date().getHours() < 18 ? 'today' : 'next') : p.scope
      a.date = null
    }
    a.total = p.total
    if (p.len) a.len = p.len
    if (p.focus.length) {
      a.focus.clear()
      for (const label of p.focus) {
        const key = this._keyOf(label)
        if (key) {
          a.focus.add(key)
          continue
        }
        a.custom = [{ label, tag: p.tag || guessTag(label) }, ...a.custom.filter((x) => x.label !== label)]
        a.focus.add('item:' + label)
      }
    }
    this.draft = ''
    if (this._ready()) this._run()
    else {
      this.step = 'ask'
      this.render()
    }
  }

  _click(e) {
    const b = e.target.closest('button[data-act], [data-q] button, button[data-key]')
    if (!b) return
    const a = this.a
    const q = b.closest('[data-q]')?.dataset.q
    const act = b.dataset.act
    if (q === 'scope') {
      a.scope = b.dataset.v
      if (a.scope !== 'day') a.date = null
    } else if (q === 'focus' && b.dataset.key) {
      const k = b.dataset.key
      a.focus.has(k) ? a.focus.delete(k) : a.focus.add(k)
    } else if (q === 'slots') {
      const k = b.dataset.v
      a.slots.has(k) ? a.slots.delete(k) : a.slots.add(k)
    } else if (q === 'exam' && b.dataset.v) a.examId = b.dataset.v
    else if (q === 'days') a.days = +b.dataset.v
    else if (q === 'len') {
      a.len = +b.dataset.v
      a.total = null
    } else if (act === 'other') {
      this.otherOpen = !this.otherOpen
      this.render()
      if (this.otherOpen) $('input[name="other"]', this.root)?.focus()
      return
    } else if (act === 'addOther') return this._addOther()
    else if (act === 'examSave') return this._addExam()
    else if (act === 'examToggle') {
      a.exam = !a.exam
      // 預設選最近的考試（沒有考試再選截止日）
      const ch = this._examChoices()
      if (a.exam && !a.examId) a.examId = (ch.find((d) => d.kind === 'exam') || ch[0])?.id || null
      this.examForm = a.exam && !this._examChoices().length
    } else if (act === 'examAdd') this.examForm = !this.examForm
    else if (act === 'clearTotal') a.total = null
    else if (act === 'edit') this.step = 'ask'
    else if (act === 'reroll') {
      this.seed++
      this._run()
      return
    } else if (act === 'apply') return this._apply()
    else if (act === 'undo') return this._undo(b.dataset.id || this.planId)
    else if (act === 'again') {
      this.step = 'ask'
      this.res = null
      this.planId = null
    } else if (act === 'goto') {
      this.hooks.selectDate?.(b.dataset.date)
      this.hooks.setTab?.('schedule')
      return
    } else if (act === 'history') this.history = !this.history
    else if (act === 'view') {
      this.view = b.dataset.v
      this.history = false
      this.root.closest('.panel-body')?.scrollTo({ top: 0 })
    } else if (act === 'week') return this.hooks.openWeekCard?.(b.dataset.wk)
    else if (act === 'peak') {
      this.store.setRhythm({ peak: b.dataset.v })
      this.hooks.toast?.({ icon: '時', title: `精神最好的時段改成${PEAKS[b.dataset.v].label}`, sub: '之後排程會把重要的事放在這時候' })
    } else return
    this.render()
  }

  _submit(e) {
    e.preventDefault()
    const f = e.target
    if (f.dataset.r === 'ask') return this._run()
    if (f.dataset.r === 'say') {
      const text = f.elements.say.value.trim()
      if (text) this._fromText(text)
      return
    }
  }
  _addOther() {
    const input = $('input[name="other"]', this.root)
    const label = input?.value.trim().slice(0, 16)
    if (!label) return
    const key = this._keyOf(label)
    if (key) this.a.focus.add(key)
    else {
      this.a.custom = [{ label, tag: guessTag(label) }, ...this.a.custom.filter((x) => x.label !== label)]
      this.a.focus.add('item:' + label)
    }
    this.otherOpen = false
    input.blur()
    this.render()
  }
  _addExam() {
    const title = $('input[name="examTitle"]', this.root)
    const date = $('input[name="examDate"]', this.root)
    if (!title?.value.trim()) return title?.focus()
    if (!date?.value) return date?.focus()
    const d = this.store.addDate({ title: title.value, date: date.value, kind: 'exam' })
    if (!d) return
    this.a.examId = d.id
    this.examForm = false
    document.activeElement?.blur()
    this.render()
  }

  _examChoices() {
    return this.store.upcomingDates(12, 120).filter((d) => d.kind !== 'day')
  }

  // ── 畫面 ──
  // store 一變就會呼叫：正在這一頁打字時先不重畫
  refresh() {
    if (this.root.contains(document.activeElement) && document.activeElement.matches('input')) return
    this.render()
  }

  render() {
    if (this.view === 'report') {
      this.root.innerHTML = `<div class="coach">${this._head()}${this._reportHTML()}</div>`
      return
    }
    this.hello ||= say(`coachHello.${greetKey()}`, {}, '想排些什麼？用下面的標籤告訴我吧。')
    const parts = [this._head(), this.history ? this._historyHTML() : '', this._msg('fuji', this.hello)]
    if (this.flash) parts.push(this._msg('fuji', this.flash))
    if (this.step === 'ask') parts.push(this._askHTML())
    else {
      parts.push(this._msg('me', esc(this._summary()), `<button class="cm-link" data-act="edit">改答案</button>`))
      parts.push(`<div data-r="reply">${this.reply.map((t) => this._msg('fuji', esc(t))).join('')}</div>`)
      if (this.res.days.length) parts.push(this._planHTML())
      else parts.push(`<div class="cp-btns solo"><button class="btn-ghost" data-act="edit">改答案</button></div>`)
      if (this.step === 'done') {
        const r = this.res
        parts.push(
          this._msg('fuji', esc(this.doneText)),
          `<div class="cp-btns solo">
            <button class="btn-ghost" data-act="undo">撤銷這次排程</button>
            <button class="btn-ghost" data-act="goto" data-date="${r.days[0].date}">到日程看看</button>
            <button class="btn-primary" data-act="again">再排一次</button>
          </div>`,
        )
      }
    }
    parts.push(
      `<form class="coach-say" data-r="say" autocomplete="off">
        <input name="say" maxlength="60" value="${esc(this.draft)}" placeholder="想排什麼？例如：這週的數學複習 3小時" />
        <button class="btn-primary" type="submit">送出</button>
      </form>`,
    )
    this.root.innerHTML = `<div class="coach">${parts.join('')}</div>`
  }

  _head() {
    const n = this.store.state.coach.plans.length
    const seg = [
      ['plan', '排程', 'けいかく'],
      ['report', '週報', 'しゅうほう'],
    ]
      .map(([v, label, kana]) => `<button type="button" data-act="view" data-v="${v}" class="${this.view === v ? 'on' : ''}">${label}<small>${kana}</small></button>`)
      .join('')
    const hist = this.view === 'plan' ? `<button class="icon-btn small${this.history ? ' on' : ''}" data-act="history" title="最近的排程">${CLOCK}${n ? `<i class="ch-n">${n}</i>` : ''}</button>` : ''
    return `<div class="coach-head"><div class="seg coach-seg">${seg}</div>${hist}</div>`
  }
  _msg(who, html, extra = '') {
    return `<div class="cmsg ${who}">${who === 'fuji' ? '<span class="stamp-k coach-k">藤</span>' : ''}<p>${html}${extra ? ` ${extra}` : ''}</p></div>`
  }

  _historyHTML() {
    const s = this.store
    const plans = [...s.state.coach.plans].reverse()
    const rows = plans.map((p) => {
      const left = s.coachLeft(p.id)
      return `<li><div><b>${esc(p.title || 'ふじ排的計畫')}</b><small>${p.from ? span(p.from, p.to) : ''}・${p.count} 段${left < p.count ? `・做完 ${p.count - left} 段` : ''}</small></div>
        ${left ? `<button class="btn-ghost" data-act="undo" data-id="${esc(p.id)}">撤銷 ${left} 件</button>` : '<span class="ch-done">都做完了</span>'}</li>`
    })
    return `<div class="coach-hist"><h5>最近的排程<small>撤銷只刪還沒完成的</small></h5>${rows.length ? `<ul>${rows.join('')}</ul>` : '<p class="hint">還沒有排過，從下面的問卷開始吧。</p>'}</div>`
  }

  _summary() {
    const a = this.a
    const dates = this._dates()
    const scope = { today: '排今天', rest: '這週剩下的天', next: '下週一整週', day: `只排 ${dayLabel(a.date || this.store.today)}` }[a.scope]
    const focus = this._focusList().map((f) => f.label).join('、')
    const slots = SLOTS.filter((x) => a.slots.has(x.id)).map((x) => x.label).join('、')
    const days = DAYS.find((d) => d.v === a.days)
    const exam = this._exam()
    return [
      dates.length > 1 ? `${scope}（${span(dates[0], dates[dates.length - 1])}）` : scope,
      `主攻 ${focus}`,
      slots,
      a.total ? `總共 ${hours(a.total)}` : `${days.label} ${days.sub}・每次 ${a.len} 分`,
      exam ? `${exam.title}（還有 ${exam.days} 天）` : '',
    ]
      .filter(Boolean)
      .join('・')
  }

  _askHTML() {
    const s = this.store
    const a = this.a
    const today = s.today
    const sunday = this._isSunday()
    const restDates = scopeDates('rest', today)
    const nextDates = scopeDates('next', today)
    const opt = (v, label, sub) => `<button type="button" data-v="${v}" class="${a.scope === v ? 'on' : ''}"><b>${label}</b><small>${sub}</small></button>`
    const scope = [
      a.scope === 'day' && a.date && a.date !== today ? opt('day', '只排這一天', dayLabel(a.date)) : '',
      opt('today', '排今天就好', dayLabel(today)),
      sunday ? '' : opt('rest', '這週剩下的天', span(restDates[0], restDates[restDates.length - 1])),
      opt('next', '從下週開始排一整週', span(nextDates[0], nextDates[6])),
    ].join('')

    const chip = (key, label, color, on, extra = '') =>
      `<button type="button" data-key="${esc(key)}" class="${on ? 'on' : ''}" style="--c:${color}">${esc(label)}${extra}</button>`
    const focus = [
      ...TAGS.map((t) => chip('tag:' + t.id, t.label, t.color, a.focus.has('tag:' + t.id))),
      ...this._projects().slice(0, 8).map((p) => chip('proj:' + p.id, p.name, PROJECT_COLORS[p.color] || '#f2a8bf', a.focus.has('proj:' + p.id), '<small>專案</small>')),
      ...this._items().map((it) => chip('item:' + it.label, it.label, tagOf(it.tag).color, a.focus.has('item:' + it.label))),
    ].join('')
    const other = this.otherOpen
      ? `<div class="coach-other" data-r="other"><input name="other" maxlength="16" autocomplete="off" placeholder="例如：數學、英文單字、健身" /><button class="btn-primary" type="button" data-act="addOther">加入</button></div>`
      : ''

    const r = s.state.rhythm
    const slots = SLOTS.map(
      (x) => `<button type="button" data-v="${x.id}" class="${a.slots.has(x.id) ? 'on' : ''}" style="--c:#b9a7e6">${x.label}<small>${slotText(x.id, r)}</small></button>`,
    ).join('')

    const choices = this._examChoices()
    const exam = a.exam
      ? `<div class="cchips" data-q="exam">${choices
          .map((d) => `<button type="button" data-v="${esc(d.id)}" class="${a.examId === d.id ? 'on' : ''}" style="--c:#e8899f">${DATE_KINDS[d.kind].kanji}・${esc(d.title)}<small>${d.days ? `還有 ${d.days} 天` : '今天'}</small></button>`)
          .join('')}<button type="button" data-act="examAdd" class="add">＋ 新增</button></div>
        ${this.examForm ? `<div class="coach-other" data-r="examNew"><input name="examTitle" maxlength="30" autocomplete="off" placeholder="例如：期中考" /><input name="examDate" type="date" min="${today}" /><button class="btn-primary" type="button" data-act="examSave">加入</button></div>` : ''}`
      : ''

    return `<form class="ccard" data-r="ask">
      <section class="cq"><h5>${sunday ? '這週只剩今天了' : '要排哪段？'}</h5>${sunday ? '<p class="hint">要排今天就好，還是從下週開始排一整週？</p>' : ''}<div class="copts" data-q="scope">${scope}</div></section>
      <section class="cq"><h5>想主攻哪些？<small>可多選</small></h5><div class="cchips" data-q="focus">${focus}<button type="button" data-act="other" class="add">＋ 其他</button></div>${other}</section>
      <section class="cq"><h5>什麼時候比較有空？<small>可多選・照你的作息換算</small></h5><div class="cchips" data-q="slots">${slots}</div></section>
      <section class="cq"><div class="cq-row"><h5>最近有考試或截止日？</h5><button type="button" class="chip-toggle${a.exam ? ' on' : ''}" data-act="examToggle">${a.exam ? '有' : '沒有'}</button></div>${exam}</section>
      <section class="cq"><h5>這週想做到幾天？</h5><div class="cdays" data-q="days">${DAYS.map((d) => `<button type="button" data-v="${d.v}" class="${a.days === d.v ? 'on' : ''}"><b>${d.label}</b><small>${d.sub}</small></button>`).join('')}</div><p class="hint">做到一天＝那天排的都完成。</p></section>
      <section class="cq"><div class="cq-row"><h5>每次多久？</h5><div class="seg" data-q="len">${LENS.map((v) => `<button type="button" data-v="${v}" class="${!a.total && a.len === v ? 'on' : ''}">${v} 分</button>`).join('')}</div></div>
        ${a.total ? `<p class="hint">照你說的總共 ${hours(a.total)}，切成差不多長的幾段 <button type="button" class="cm-link" data-act="clearTotal">改成每次固定長度</button></p>` : ''}</section>
      <div class="cq-send"><button class="btn-primary" type="submit"${this._ready() ? '' : ' disabled'}>送出回答</button>${this._ready() ? '' : '<small>至少選一個主攻項目和一個時段</small>'}</div>
    </form>`
  }

  _planHTML() {
    const r = this.res
    const today = this.store.today
    const count = r.days.reduce((n, d) => n + d.items.length, 0)
    const days = r.days
      .map(
        (d) => `<div class="cp-day"><h6>${dayLabel(d.date)}${d.date === today ? '<em>今天</em>' : ''}</h6><ul>${d.items
          .map((it) => `<li style="--c:${tagOf(it.tag).color}"><time>${it.at}</time><i></i><span>${esc(it.title)}</span><small>${it.dur} 分</small></li>`)
          .join('')}</ul></div>`,
      )
      .join('')
    const notes = r.notes.map((n) => `<p class="cp-note">✿ ${esc(n)}</p>`).join('')
    const btns =
      this.step === 'preview'
        ? `<div class="cp-btns"><button class="btn-ghost" data-act="edit">改答案</button><button class="btn-ghost" data-act="reroll">換個排法</button><button class="btn-primary" data-act="apply">套用</button></div>`
        : ''
    return `<div class="cplan${this.step === 'done' ? ' applied' : ''}">
      <div class="cp-sum"><span><b>${r.picked}</b> 天</span><span><b>${count}</b> 段</span><span><b>${hours(r.totalMin).replace(' 小時', '')}</b> 小時</span>${this.step === 'done' ? `<em>${ICON.check}已套用</em>` : ''}</div>
      ${days}${notes}${btns}
    </div>`
  }

  // ── 週報 ──
  _reportHTML() {
    const s = this.store
    const today = s.today
    const w = s.weekReport()
    // 跟上週同一段（星期一到同一個星期幾）比
    const prevWk = addDays(w.week, -7)
    const p = s.weekReport(prevWk, addDays(prevWk, w.days - 1))
    const used = s.usedDays()
    const tier = w.active >= 5 || w.done >= 20 ? 'great' : w.active >= 3 ? 'good' : 'gentle'
    const parts = []
    parts.push(this._msg('fuji', esc(used < 3 ? say('weekFirst', { days: 3 - used }, '再累積幾天，就有第一份週報。') : say(`weekReport.${tier}`, {}, '這週也辛苦了。'))))

    // 本週到目前
    const range = `${md(w.week)}–${md(w.end)}`
    parts.push(`<section class="wr-card wr-now">
      <h5>本週到目前<small>${range}</small></h5>
      <div class="wr-stats">
        <div><b>${Math.round(w.rate * 100)}<small>%</small></b><span>完成率</span></div>
        <div><b>${fmtMin(w.focus)}</b><span>投入時數</span></div>
        <div><b>${w.pomodoros}</b><span>完成番茄</span></div>
        <div><b>${s.streak}</b><span>連續天數</span></div>
      </div>
    </section>`)
    if (used < 3) {
      parts.push(`<section class="wr-card wr-wait"><span class="stamp-k coach-k">✦</span><div><b>第一份週報準備中</b><p>累積三天的任務和專注，就能生出你的第一份週報。上面的本週數字現在就在跑了。</p></div></section>`)
    }

    // 本週表現分析
    const pctNow = Math.round(w.rate * 100)
    const C = 2 * Math.PI * 34
    const rows = [
      ['完成任務', `${w.done}<small> 件</small>`, delta(w.done, p.total || p.done ? p.done : null)],
      ['還沒完成', `${w.total - w.done}<small> 件</small>`, ''],
      ['本命完成', `${w.stars}<small> / ${w.starTotal}</small>`, ''],
      ['專注', `${w.focus}<small> 分</small>`, delta(w.focus, p.focus || null, ' 分')],
      ['習慣達成', w.habitRate == null ? '<small>—</small>' : `${Math.round(w.habitRate * 100)}<small>%</small>`, ''],
    ]
    parts.push(`<section class="wr-card">
      <h5>本週表現分析<small>跟上週同一段比</small></h5>
      <div class="wr-perf">
        <div class="wr-ring"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34"/><circle cx="40" cy="40" r="34" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - w.rate)}"/></svg><b>${pctNow}<small>%</small></b><span>總體完成度</span></div>
        <ul>${rows.map(([k, v, d]) => `<li><span>${k}</span><b>${v}</b>${d}</li>`).join('')}</ul>
      </div>
    </section>`)

    // 習慣洞察
    const list = buildInsights({ tasks: s.state.tasks, history: s.state.history, habits: s.state.habits, rhythm: s.state.rhythm, today })
    const guess = list.some((x) => x.guess)
    parts.push(`<section class="wr-card">
      <h5>習慣洞察${guess ? '<em class="wr-badge">部分依作息推測</em>' : ''}</h5>
      <ul class="wr-ins">${list
        .map(
          (x) => `<li class="${x.guess ? 'guess' : ''}"><span class="wr-k">${x.kanji}</span><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p>${
            x.action ? `<button class="btn-ghost" data-act="peak" data-v="${x.action.value}">${esc(x.action.label)}</button>` : ''
          }</div></li>`,
        )
        .join('')}</ul>
      ${list.some((x) => !x.guess) ? `<p class="wr-tip">ふじ：「${esc(say('insightTip', {}, '先試一小次，感覺合適再留下來。'))}」</p>` : ''}
    </section>`)

    // 記憶圖鑑：這週＋往回 12 週
    const album = [w, ...s.weekAlbum(12)]
    const cards = album
      .map((r) => {
        const cur = r.week === w.week
        const moods = r.moods.map((m) => `<i style="--mc:${moodOf(m)?.color || 'transparent'}"></i>`).join('')
        return `<button type="button" class="wr-album-card${cur ? ' cur' : ''}" data-act="week" data-wk="${r.week}">
          <small>${cur ? '這週' : '週'}</small><span class="wr-ar">${md(r.week)} - ${md(addDays(r.week, 6))}</span>
          <b>${Math.round(r.rate * 100)}<small>%</small></b><span class="wr-ap">${r.pomodoros} 個番茄・${r.done} 朵花</span><span class="wr-am">${moods}</span>
        </button>`
      })
      .join('')
    parts.push(`<section class="wr-card">
      <h5>記憶圖鑑<small>像相簿一樣收藏每週的努力軌跡</small></h5>
      <div class="wr-album">${cards}</div>
    </section>`)
    return parts.join('')
  }
}
