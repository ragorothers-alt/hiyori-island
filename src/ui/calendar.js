import './calendar.css'
import { $, $$, esc, ICON } from './dom.js'
import { EVENT_COLORS, moodOf, tagOf, WEEK_JP } from '../theme.js'
import { addDays, dateStr, daysBetween, minToHHMM, parseDate, repeatMatches, toMin, weekKey } from '../store.js'
import { applies, countOn, doneOn } from '../habits.js'
import { awake, DEFAULT_RHYTHM, fmtDur, sleepMinutes, taskDur } from '../planner.js'
import { ENERGY, lifeKindOf } from '../data/life.js'

// 日曆：全畫面浮層。月檢視（6×7、週一開頭）／週檢視（時間格），右側（手機在下方）是那天的詳情

const MONTH_JP = ['睦月', '如月', '弥生', '卯月', '皐月', '水無月', '文月', '葉月', '長月', '神無月', '霜月', '師走']
const DOW = ['一', '二', '三', '四', '五', '六', '日']
const MODE_KEY = 'hiyori-cal-mode'
// 日曆開著時不讓這些快捷鍵傳到底下（它們會動到被蓋住的面板）
const SWALLOW = /^[1-5nNsSfFvVeE]$/

const colorOf = (i) => EVENT_COLORS[(+i || 0) % EVENT_COLORS.length]
const md = (date) => {
  const d = parseDate(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
const addMonths = (date, n) => {
  const d = parseDate(date)
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
  t.setDate(Math.min(d.getDate(), last))
  return dateStr(t)
}
const relLabel = (date, today) => {
  const n = daysBetween(today, date)
  if (n === 0) return '今天'
  if (n === 1) return '明天'
  if (n === 2) return '後天'
  if (n === -1) return '昨天'
  return n > 0 ? `${n} 天後` : `${-n} 天前`
}
const nowMin = () => {
  const n = new Date()
  return n.getHours() * 60 + n.getMinutes()
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// 任務完成度小環
function ring(done, total) {
  const c = 2 * Math.PI * 6
  const p = total ? done / total : 0
  return `<svg class="cc-ring${total && done === total ? ' full' : ''}" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle class="fg" cx="8" cy="8" r="6" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}"/></svg>`
}

// 互相重疊的區塊分成並排的欄：每塊加上 lane（第幾欄）與 lanes（這一群共幾欄）
function layLanes(blocks) {
  const list = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end)
  let group = []
  let groupEnd = -1
  let ends = []
  const flush = () => {
    const n = Math.max(1, ...group.map((b) => b.lane + 1))
    for (const b of group) b.lanes = n
    group = []
    ends = []
  }
  for (const b of list) {
    // 太短的區塊畫出來至少有 20 分鐘高，排欄時也照這個算
    const vEnd = Math.max(b.end, b.start + 20)
    if (group.length && b.start >= groupEnd) flush()
    let i = ends.findIndex((e) => e <= b.start)
    if (i < 0) i = ends.length
    ends[i] = vEnd
    b.lane = i
    group.push(b)
    groupEnd = Math.max(groupEnd, vEnd)
  }
  if (group.length) flush()
  return list
}

export class CalendarView {
  constructor(root, store, hooks) {
    this.root = root
    this.store = store
    this.hooks = hooks
    this.date = store.selectedDate
    this.mode = 'month'
    try {
      if (localStorage.getItem(MODE_KEY) === 'week') this.mode = 'week'
    } catch {}
    this._period = ''
    this._bars = 3
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', '日曆')
    root.innerHTML = `
      <div class="cal-card glass">
        <header class="cal-head">
          <h2 class="cal-title"></h2>
          <div class="cal-nav">
            <button class="icon-btn" data-act="prev" title="上一月／週" aria-label="上一月／週">${ICON.prev}</button>
            <button class="chip-toggle cal-today" data-act="today" title="回到今天（Home）">今天</button>
            <button class="icon-btn" data-act="next" title="下一月／週" aria-label="下一月／週">${ICON.next}</button>
          </div>
          <div class="seg cal-mode" role="group" aria-label="檢視方式">
            <button type="button" data-mode="month" title="月檢視（M）">月</button>
            <button type="button" data-mode="week" title="週檢視（W）">週</button>
          </div>
          <button class="icon-btn cal-close" data-act="close" title="關閉（Esc）" aria-label="關閉日曆">${ICON.close}</button>
        </header>
        <div class="cal-main"></div>
        <aside class="cal-side" aria-label="這一天的詳情"></aside>
      </div>`
    this.el = { title: $('.cal-title', root), main: $('.cal-main', root), side: $('.cal-side', root), today: $('.cal-today', root) }
    root.addEventListener('click', (e) => this._onClick(e))
    root.addEventListener('dblclick', (e) => this._onDbl(e))
    // 用捕獲階段攔截，按鍵才不會傳到 ui.js（←／→ 會切換面板日期、數字鍵切分頁）
    addEventListener('keydown', (e) => this._onKey(e), true)
    addEventListener('resize', () => {
      if (this.isOpen && this.mode === 'month' && this._fitBars()) this.render()
    })
  }

  get isOpen() {
    return !this.root.hidden && !this._closing
  }
  open(date = this.store.selectedDate) {
    clearTimeout(this._closeTimer)
    this._closing = false
    this.root.classList.remove('is-closing')
    if (this.root.hidden) this._back = document.activeElement
    this.date = date || this.store.selectedDate
    this.root.hidden = false
    this._period = ''
    this.render()
    this._focusCell()
    clearInterval(this._tick)
    this._tick = setInterval(() => this._nowTick(), 60000)
  }
  close() {
    if (this.root.hidden || this._closing) return
    clearInterval(this._tick)
    this._closing = true
    this.root.classList.add('is-closing')
    const done = () => {
      this._closing = false
      this.root.hidden = true
      this.root.classList.remove('is-closing')
      const back = this._back
      this._back = null
      if (back?.isConnected && back !== document.body && !this.root.contains(back)) back.focus({ preventScroll: true })
    }
    if (reduced()) done()
    else this._closeTimer = setTimeout(done, 200)
  }
  toggle(date) {
    if (this.isOpen) this.close()
    else this.open(date)
  }

  // ── 動作 ──
  moveTo(date) {
    if (!date) return
    this.date = date
    this.render()
  }
  flip(dir) {
    this.moveTo(this.mode === 'month' ? addMonths(this.date, dir) : addDays(this.date, dir * 7))
  }
  setMode(mode) {
    if (mode === this.mode) return
    this.mode = mode
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {}
    this.render()
  }
  // 到這一天：面板切到那天的日程
  goTo(date) {
    this.close()
    this.hooks.selectDate(date)
    this.hooks.setTab('schedule')
  }

  _onClick(e) {
    if (!this.isOpen) return
    if (e.target === this.root) return this.close()
    const btn = e.target.closest('[data-act], [data-mode], [data-open], [data-day]')
    if (!btn || !this.root.contains(btn) || btn.disabled) return
    if (btn.dataset.mode) return this.setMode(btn.dataset.mode)
    const act = btn.dataset.act
    if (act === 'close') return this.close()
    if (act === 'prev' || act === 'next') return this.flip(act === 'prev' ? -1 : 1)
    if (act === 'today') return this.moveTo(this.store.today)
    if (act === 'go') return this.goTo(this.date)
    if (act === 'review') return this.hooks.openReview(this.date)
    if (btn.dataset.open) {
      const day = btn.closest('[data-day]')?.dataset.day
      if (day && day !== this.date) this.moveTo(day)
      return this.hooks.openEdit(btn.dataset.open, btn.dataset.id)
    }
    const day = btn.dataset.day
    // 格子與週標頭：再點一次＝到這一天
    if (day === this.date && btn.matches('.cal-cell, .cw-day')) return this.goTo(day)
    this.moveTo(day)
  }
  _onDbl(e) {
    if (!this.isOpen || e.target.closest('[data-open], [data-act], [data-mode]')) return
    const col = e.target.closest('.cw-col, .cw-allcell')
    if (col) this.goTo(col.dataset.day)
  }
  _onKey(e) {
    if (!this.isOpen) return
    const k = e.key
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[k]
    // 日曆上面還有對話框（編輯、回顧…）：Esc 交給 ui.js 關對話框（日曆留著），其他快捷鍵不讓底下的面板跟著動
    const modal = [...document.querySelectorAll('.modal')].some((m) => !m.hidden)
    if (modal && k === 'Escape') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const a = document.activeElement
    if (/INPUT|TEXTAREA|SELECT/.test(a?.tagName) || a?.isContentEditable) return
    if (modal) {
      if (step || k === 'PageUp' || k === 'PageDown' || SWALLOW.test(k)) e.stopPropagation()
      return
    }
    if (step) this.moveTo(addDays(this.date, step))
    else if (k === 'PageUp' || k === 'PageDown') this.moveTo(addMonths(this.date, k === 'PageUp' ? -1 : 1))
    else if (k === 'Home') this.moveTo(this.store.today)
    else if (k === 'm' || k === 'M') this.setMode('month')
    else if (k === 'w' || k === 'W') this.setMode('week')
    else if (k === 'Enter' && !a?.closest?.('button')) this.goTo(this.date)
    else if (!SWALLOW.test(k)) return
    e.preventDefault()
    e.stopPropagation()
    if (step || k.startsWith('Page') || k === 'Home') this._focusCell()
  }
  _focusCell() {
    if (this.root.hidden) return
    $('.cal-cell.is-cur, .cw-day.is-cur', this.root)?.focus({ preventScroll: true })
  }

  // ── 渲染 ──
  render() {
    if (this.root.hidden) return
    // 重畫後把焦點放回原來的位置（鍵盤操作時不會掉焦點）
    const a = document.activeElement
    let refocus = null
    if (a && this.root.contains(a)) {
      if (a.matches('.cal-cell, .cw-day')) refocus = 'cell'
      else if (a.dataset.open) refocus = `[data-open="${a.dataset.open}"][data-id="${CSS.escape(a.dataset.id)}"]`
      else if (a.dataset.act && this.el.side.contains(a)) refocus = `.cal-side [data-act="${a.dataset.act}"]`
    }
    this._renderHead()
    this._renderMain()
    this._renderSide()
    if (refocus === 'cell') this._focusCell()
    else if (refocus) $(refocus, this.root)?.focus({ preventScroll: true })
  }

  _renderHead() {
    const d = parseDate(this.date)
    let title
    let sub
    if (this.mode === 'month') {
      title = `<b>${d.getFullYear()}</b> 年 <b>${d.getMonth() + 1}</b> 月`
      sub = MONTH_JP[d.getMonth()]
    } else {
      const mon = weekKey(this.date)
      const sun = addDays(mon, 6)
      const a = parseDate(mon)
      const b = parseDate(sun)
      title =
        a.getFullYear() !== b.getFullYear()
          ? `<b>${a.getFullYear()}</b> 年 <b>${a.getMonth() + 1}</b> 月 – <b>${b.getFullYear()}</b> 年 <b>${b.getMonth() + 1}</b> 月`
          : a.getMonth() !== b.getMonth()
            ? `<b>${a.getFullYear()}</b> 年 <b>${a.getMonth() + 1}</b>–<b>${b.getMonth() + 1}</b> 月`
            : `<b>${a.getFullYear()}</b> 年 <b>${a.getMonth() + 1}</b> 月`
      const t = this.store.today
      sub = `${md(mon)} – ${md(sun)}${t >= mon && t <= sun ? '・今週' : ''}`
    }
    this.el.title.innerHTML = `<span>${title}</span><small>${sub}</small>`
    this.el.today.disabled = this.date === this.store.today
    for (const b of this.root.querySelectorAll('[data-mode]')) {
      b.classList.toggle('on', b.dataset.mode === this.mode)
      b.setAttribute('aria-pressed', b.dataset.mode === this.mode)
    }
  }

  _renderMain() {
    const main = this.el.main
    const key = this.mode === 'month' ? 'm' + this.date.slice(0, 7) : 'w' + weekKey(this.date)
    const same = key === this._period
    const scroll = $('.cw-body', main)?.scrollTop
    main.dataset.mode = this.mode
    main.innerHTML = this.mode === 'month' ? this._month() : this._week()
    if (this.mode === 'month' && this._fitBars()) main.innerHTML = this._month()
    const body = $('.cw-body', main)
    if (body) body.scrollTop = same && scroll != null ? scroll : this._autoScroll(body)
    // 換月／換週：內容輕輕滑進來
    if (this._period && !same && !reduced()) {
      const dx = key > this._period ? 14 : -14
      main.firstElementChild?.animate?.(
        [{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' },
      )
    }
    this._period = key
  }

  // 依格子實際高度決定放幾條日程色條（上列 22、底列 16、每條 19）；堆疊版面的格子會長高，放 3 條
  _fitBars() {
    const cell = $('.cal-cell', this.el.main)
    if (!cell) return false
    const n = matchMedia('(max-width: 900px)').matches ? 3 : Math.max(1, Math.min(3, Math.floor((cell.offsetHeight - 56) / 19)))
    if (n === this._bars) return false
    this._bars = n
    return true
  }

  // 未來的例行公事要到那天被選到時才會生成；先用規則推算出來，只顯示、不能編輯
  _ghosts(start, n) {
    const s = this.store
    const out = new Map()
    const routines = s.state.routines || []
    if (!routines.length) return out
    for (let i = 0; i < n; i++) {
      const date = addDays(start, i)
      if (date <= s.today) continue
      const list = routines
        .filter((r) => r.startDate <= date && !r.made?.[date] && repeatMatches(r.repeat, date))
        .map((r) => ({ ...r, id: 'r-' + r.id, ghost: true, done: false }))
      if (list.length) out.set(date, list)
    }
    return out
  }

  _dayCls(date, base) {
    const s = this.store
    const wd = parseDate(date).getDay()
    return [
      base,
      date === s.today && 'is-today',
      date === s.selectedDate && 'is-panel',
      date === this.date && 'is-cur',
      date < s.today && 'is-past',
      wd === 0 && 'is-sun',
      wd === 6 && 'is-sat',
    ]
      .filter(Boolean)
      .join(' ')
  }

  _moodStamp(sum, cls = 'cc-mood') {
    const m = sum.mood && moodOf(sum.mood.mood)
    return m ? `<i class="${cls}" style="--mc:${m.color}" title="心情：${m.name}">${m.kanji}</i>` : ''
  }

  // ── 月檢視 ──
  _month() {
    const d = parseDate(this.date)
    const month = d.getMonth()
    const start = weekKey(dateStr(new Date(d.getFullYear(), month, 1)))
    const bars = this._bars
    const ghosts = this._ghosts(start, 42)
    let cells = ''
    let anyGhost = false
    for (let i = 0; i < 42; i++) {
      const date = addDays(start, i)
      const g = ghosts.get(date)?.filter((r) => r.kind !== 'task') || []
      if (g.length) anyGhost = true
      cells += this._cell(date, parseDate(date).getMonth() !== month, bars, g)
    }
    const dow = DOW.map((w, i) => `<span class="${i === 5 ? 'is-sat' : i === 6 ? 'is-sun' : ''}">${w}</span>`).join('')
    return `
      <div class="cal-month">
        <div class="cal-dow" aria-hidden="true">${dow}</div>
        <div class="cal-grid">${cells}</div>
        <div class="cal-legend" aria-hidden="true">
          <span><i class="cl-today"></i>今天</span>
          <span><i class="cl-panel"></i>面板上的日期</span>
          <span><i class="cl-cur"></i>正在看</span>
          <span>${ring(2, 3)}任務完成</span>
          <span><i class="cl-hb"></i>習慣</span>
          <span><i class="cc-mk mk-sleep">眠</i>睡眠</span>
          <span><i class="cc-mk mk-life">記</i>生活記錄</span>
          <span><i class="cc-mk mk-slip">再</i>重新開始</span>
          ${anyGhost ? '<span><i class="cl-ghost"></i>例行公事預覽</span>' : ''}
          <span class="cl-tip cl-desk">再點日期前往・方向鍵移動・PgUp／PgDn 換月</span>
          <span class="cl-tip cl-touch">再點一次到那一天</span>
        </div>
      </div>`
  }

  _cell(date, out, bars, ghosts) {
    const s = this.store
    const sum = s.daySummary(date)
    const d = parseDate(date)
    const evs = [...sum.events, ...ghosts]
    const total = sum.tasks.length
    const done = sum.tasksDone
    const past = date <= s.today
    const num = d.getDate() === 1 ? `${d.getMonth() + 1}/1` : d.getDate()

    const evHtml = evs
      .slice(0, bars)
      .map((e) => `<span class="cc-ev${e.done ? ' done' : ''}${e.ghost ? ' ghost' : ''}" style="--c:${colorOf(e.color)}">${esc(e.title)}</span>`)
      .join('')
    const more = evs.length > bars ? `<span class="cc-more">+${evs.length - bars}</span>` : ''
    const marks = [
      sum.sleep && '<i class="cc-mk mk-sleep" title="有睡眠記錄">眠</i>',
      sum.life.items.length && `<i class="cc-mk mk-life" title="${sum.life.items.length} 筆生活記錄">記</i>`,
      sum.slips && `<i class="cc-mk mk-slip" title="重新開始 ${sum.slips} 次">再</i>`,
    ]
      .filter(Boolean)
      .join('')

    const hb = sum.habits
    let habits = ''
    if (past && hb.total) {
      const inner =
        hb.total <= 5
          ? Array.from({ length: hb.total }, (_, i) => `<i${i < hb.done ? ' class="on"' : ''}></i>`).join('')
          : `<em>習</em>${hb.done}/${hb.total}`
      habits = `<span class="cc-hb${hb.done === hb.total ? ' all' : ''}" title="習慣 ${hb.done}/${hb.total}">${inner}</span>`
    }
    const task = total ? `<span class="cc-task" title="任務 ${done}/${total}">${ring(done, total)}<b>${done}/${total}</b></span>` : ''
    // 手機：小點與細條
    const dots = evs
      .slice(0, 3)
      .map((e) => `<i class="${e.ghost ? 'ghost' : ''}" style="--c:${colorOf(e.color)}"></i>`)
      .join('')
    const bar = total ? `<span class="cc-bar${done === total ? ' full' : ''}" style="--p:${done / total}"></span>` : ''

    const label = [
      `${d.getMonth() + 1} 月 ${d.getDate()} 日（${DOW[(d.getDay() + 6) % 7]}）`,
      date === s.today && '今天',
      evs.length && `${evs.length} 個日程`,
      total && `任務 ${done}/${total}`,
      past && hb.total && `習慣 ${hb.done}/${hb.total}`,
      sum.mood && `心情 ${moodOf(sum.mood.mood)?.name || ''}`,
    ]
      .filter(Boolean)
      .join('，')

    return `<button type="button" class="${this._dayCls(date, 'cal-cell')}${out ? ' is-out' : ''}" data-day="${date}" tabindex="${date === this.date ? 0 : -1}" aria-label="${label}" aria-pressed="${date === this.date}"${date === s.today ? ' aria-current="date"' : ''}>
      <span class="cc-top"><b class="cc-num">${num}</b><span class="cc-marks">${marks}</span>${this._moodStamp(sum)}</span>
      <span class="cc-evs">${evHtml}</span>
      <span class="cc-dots">${dots}${evs.length > 3 ? '<i class="more"></i>' : ''}</span>
      ${bar}
      <span class="cc-foot">${task}${habits}${more}</span>
    </button>`
  }

  // ── 週檢視 ──
  _weekData() {
    const s = this.store
    const mon = weekKey(this.date)
    const ghosts = this._ghosts(mon, 7)
    const r = s.state.rhythm || DEFAULT_RHYTHM
    let [from, to] = awake(r)
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(mon, i)
      const sum = s.daySummary(date)
      const g = ghosts.get(date) || []
      const blocks = [
        ...sum.events.map((e) => ({ kind: 'event', item: e, start: toMin(e.start), end: Math.max(toMin(e.end), toMin(e.start) + 5) })),
        ...g.filter((x) => x.kind !== 'task').map((e) => ({ kind: 'event', item: e, start: toMin(e.start), end: Math.max(toMin(e.end), toMin(e.start) + 5) })),
        ...sum.tasks.filter((t) => t.at).map((t) => ({ kind: 'task', item: t, start: toMin(t.at), end: Math.min(1440, toMin(t.at) + taskDur(t)) })),
      ]
      for (const b of blocks) {
        from = Math.min(from, b.start)
        to = Math.max(to, b.end)
      }
      return { date, sum, blocks, ghostTasks: g.filter((x) => x.kind === 'task').length }
    })
    from = Math.floor(from / 60) * 60
    to = Math.min(1440, Math.max(from + 60, Math.ceil(to / 60) * 60))
    return { days, from, to }
  }

  _week() {
    const s = this.store
    const { days, from, to } = this._weekData()
    const span = to - from
    const starts = days.flatMap((x) => x.blocks.map((b) => b.start))
    this._range = [from, span, starts.length ? Math.min(...starts) : null]
    const pct = (m) => `${(((m - from) / span) * 100).toFixed(3)}%`
    let anyGhost = false

    const head = days
      .map(({ date, sum }, i) => {
        const d = parseDate(date)
        return `<button type="button" class="${this._dayCls(date, 'cw-day')}" data-day="${date}" tabindex="${date === this.date ? 0 : -1}" aria-pressed="${date === this.date}"${date === s.today ? ' aria-current="date"' : ''} aria-label="${d.getMonth() + 1} 月 ${d.getDate()} 日（${DOW[i]}）">
          <small>${DOW[i]}</small><b>${d.getDate()}</b>${this._moodStamp(sum, 'cc-mood cw-mood')}
        </button>`
      })
      .join('')

    const all = days
      .map(({ date, sum, ghostTasks }) => {
        const untimed = sum.tasks.filter((t) => !t.at)
        const left = untimed.filter((t) => !t.done).length
        const hb = sum.habits
        const chips = [
          untimed.length &&
            `<span class="cw-chip t${left ? '' : ' ok'}" title="沒排時段的任務：還有 ${left} 件／共 ${untimed.length} 件"><em>未排</em>${left ? left : '✓'}</span>`,
          ghostTasks && `<span class="cw-chip g" title="例行任務 ${ghostTasks} 件（到那天會自動出現）"><em>例行</em>${ghostTasks}</span>`,
          date <= s.today && hb.total && `<span class="cw-chip h${hb.done === hb.total ? ' ok' : ''}" title="習慣 ${hb.done}/${hb.total}"><em>習</em>${hb.done}/${hb.total}</span>`,
        ]
          .filter(Boolean)
          .join('')
        return `<div class="${this._dayCls(date, 'cw-allcell')}" data-day="${date}">${chips}</div>`
      })
      .join('')

    const now = nowMin()
    const showNow = days.some((x) => x.date === s.today) && now >= from && now <= to
    const hours = []
    // 離「現在」太近的整點標籤先藏起來，免得兩個時間疊在一起
    for (let m = from; m <= to; m += 60) hours.push(`<span data-m="${m}"${showNow && Math.abs(m - now) < 18 ? ' class="near"' : ''} style="top:${pct(m)}">${minToHHMM(m)}</span>`)
    if (showNow) hours.push(`<span class="now" style="top:${pct(now)}">${minToHHMM(now)}</span>`)

    const cols = days
      .map(({ date, blocks }) => {
        const html = layLanes(blocks)
          .map((b) => {
            const it = b.item
            const ghost = !!it.ghost
            if (ghost) anyGhost = true
            const c = b.kind === 'event' ? colorOf(it.color) : tagOf(it.tag).color
            const time = `${minToHHMM(b.start)}–${minToHHMM(Math.min(b.end, 1439))}`
            const style = `top:${pct(b.start)};height:${(((b.end - b.start) / span) * 100).toFixed(3)}%;left:calc(${b.lane} * 100% / ${b.lanes});width:calc(100% / ${b.lanes} - 2px);--c:${c}`
            const cls = `cw-blk ${b.kind}${it.done ? ' done' : ''}${ghost ? ' ghost' : ''}${b.end - b.start < 45 ? ' short' : ''}`
            const ck = b.kind === 'task' ? '<i class="ck"></i>' : ''
            const title = `${it.title}・${time}${b.kind === 'task' ? `（${fmtDur(taskDur(it))}）` : ''}${ghost ? '・例行公事，到那天會自動排上' : ''}`
            return ghost
              ? `<span class="${cls}" style="${style}" title="${esc(title)}"><b>${esc(it.title)}</b><small>${time}</small></span>`
              : `<button type="button" class="${cls}" style="${style}" data-open="${b.kind}" data-id="${esc(it.id)}" title="${esc(title)}">${ck}<b>${esc(it.title)}</b><small>${time}</small></button>`
          })
          .join('')
        const line = showNow && date === s.today ? `<i class="cw-now" style="top:${pct(now)}"></i>` : ''
        return `<div class="${this._dayCls(date, 'cw-col')}" data-day="${date}">${html}${line}</div>`
      })
      .join('')

    return `
      <div class="cw" style="--hours:${span / 60}">
        <div class="cw-head"><span class="cw-gut"></span>${head}</div>
        <div class="cw-all"><span class="cw-gut">摘要</span>${all}</div>
        <div class="cw-body"><div class="cw-hours" aria-hidden="true">${hours.join('')}</div>${cols}</div>
        <div class="cal-legend" aria-hidden="true">
          <span><i class="cl-ev"></i>日程</span>
          <span><i class="cl-task"></i>排進時段的任務</span>
          ${anyGhost ? '<span><i class="cl-ghost"></i>例行公事預覽</span>' : ''}
          <span><i class="cl-now"></i>現在</span>
          <span class="cl-tip cl-desk">點區塊編輯・點兩下空白處前往・方向鍵移動</span>
          <span class="cl-tip cl-touch">點區塊編輯・再點一次日期到那一天</span>
        </div>
      </div>`
  }

  // 週檢視第一次出現時捲到「現在」或第一個區塊附近
  _autoScroll(body) {
    const col = $('.cw-col', body)
    if (!col || !this._range) return 0
    const [from, span, first] = this._range
    const s = this.store
    const mon = weekKey(this.date)
    let target = from
    if (s.today >= mon && s.today <= addDays(mon, 6)) target = nowMin() - 90
    else if (first != null) target = first - 30
    return Math.max(0, ((target - from) / span) * col.offsetHeight)
  }

  _nowTick() {
    if (!this.isOpen || this.mode !== 'week' || !this._range) return
    const [from, span] = this._range
    const now = nowMin()
    const top = `${(((now - from) / span) * 100).toFixed(3)}%`
    const line = $('.cw-now', this.root)
    const lab = $('.cw-hours .now', this.root)
    if (line) line.style.top = top
    if (lab) {
      lab.style.top = top
      lab.textContent = minToHHMM(now)
      for (const h of $$('.cw-hours span[data-m]', this.root)) h.classList.toggle('near', Math.abs(h.dataset.m - now) < 18)
    }
  }

  // ── 日詳情 ──
  _renderSide() {
    const s = this.store
    const date = this.date
    const today = s.today
    const sum = s.daySummary(date)
    const d = parseDate(date)
    const past = date <= today
    const ghosts = this._ghosts(date, 1).get(date) || []
    const gEvents = ghosts.filter((r) => r.kind !== 'task')
    const gTasks = ghosts.filter((r) => r.kind === 'task')
    const mood = sum.mood && moodOf(sum.mood.mood)
    const secs = []

    // 日程
    const evs = [...sum.events, ...gEvents].sort((a, b) => toMin(a.start) - toMin(b.start))
    if (evs.length) {
      const rows = evs
        .map((e) => {
          const inner = `<span class="cd-time">${e.start}<small>${e.end}</small></span><span class="cd-t">${esc(e.title)}${e.ghost ? '<small>例行公事・到那天會自動排上</small>' : ''}</span>${e.done ? `<i class="cd-ck">${ICON.check}</i>` : ''}`
          return e.ghost
            ? `<li class="cd-row ev ghost" style="--c:${colorOf(e.color)}">${inner}</li>`
            : `<li><button type="button" class="cd-row ev${e.done ? ' done' : ''}" style="--c:${colorOf(e.color)}" data-open="event" data-id="${esc(e.id)}" title="編輯日程">${inner}</button></li>`
        })
        .join('')
      secs.push(this._sec('日程', 'よてい', sum.events.length ? `${sum.events.filter((e) => e.done).length}/${sum.events.length}` : '', rows))
    }

    // 任務：有時段的照時間，沒時段的排後面
    const tasks = [...sum.tasks].sort((a, b) => (a.at ? toMin(a.at) : 1e4) - (b.at ? toMin(b.at) : 1e4))
    if (tasks.length || gTasks.length) {
      const rows =
        tasks
          .map((t) => {
            const tag = tagOf(t.tag)
            const when = t.at ? `${t.at}–${minToHHMM(Math.min(1439, toMin(t.at) + taskDur(t)))}` : '未排時段'
            const meta = [tag.label, when, fmtDur(taskDur(t)), t.star && '<em class="cd-star">本命</em>', t.priority === 3 && '<em class="cd-hi">高優先</em>']
              .filter(Boolean)
              .join('・')
            return `<li><button type="button" class="cd-row tk${t.done ? ' done' : ''}" style="--c:${tag.color}" data-open="task" data-id="${esc(t.id)}" title="編輯任務">
              <i class="cd-ck">${ICON.check}</i><span class="cd-t">${esc(t.title)}<small>${meta}</small></span></button></li>`
          })
          .join('') +
        gTasks
          .map((r) => `<li class="cd-row tk ghost" style="--c:${tagOf(r.tag).color}"><i class="cd-ck"></i><span class="cd-t">${esc(r.title)}<small>例行公事・到那天會自動出現</small></span></li>`)
          .join('')
      secs.push(this._sec('任務', 'タスク', tasks.length ? `${sum.tasksDone}/${tasks.length}` : '', rows))
    }

    // 習慣（只看今天以前）：養成的打卡、戒除的破戒與忍住
    if (past) {
      const hs = s.state.habits
      const build = hs.filter((h) => !h.archived && h.kind === 'build' && applies(h, date))
      const slips = hs
        .filter((h) => h.kind === 'quit')
        .flatMap((h) => h.slips.filter((x) => dateStr(new Date(x.at)) === date).map((x) => ({ h, x })))
      const urges = hs.filter((h) => h.kind === 'quit' && h.urges?.[date])
      if (build.length || slips.length || urges.length) {
        const rows = [
          ...build.map((h) => {
            const ok = doneOn(h, date)
            return `<li class="cd-row hb${ok ? ' ok' : ''}" style="--c:${colorOf(h.color)}"><i class="cd-k">${esc(h.icon)}</i><span class="cd-t">${esc(h.name)}</span><small class="cd-n">${countOn(h, date)}/${h.target || 1} ${esc(h.unit || '次')}</small></li>`
          }),
          ...urges.map(
            (h) => `<li class="cd-row hb quit" style="--c:${colorOf(h.color)}"><i class="cd-k">${esc(h.icon)}</i><span class="cd-t">${esc(h.name)}<small>忍住了 ${h.urges[date]} 次</small></span></li>`,
          ),
          ...slips.map(
            ({ h, x }) =>
              `<li class="cd-row hb slip"><i class="cd-k">再</i><span class="cd-t">${esc(h.name)}<small>${minToHHMM(new Date(x.at).getHours() * 60 + new Date(x.at).getMinutes())} 重新開始${x.note ? `・${esc(x.note)}` : ''}</small></span></li>`,
          ),
        ].join('')
        secs.push(this._sec('習慣', 'しゅうかん', sum.habits.total ? `${sum.habits.done}/${sum.habits.total}` : '', rows))
      }
    }

    // 心情與日記
    if (mood) {
      secs.push(
        this._sec(
          '心情',
          'きもち',
          '',
          `<li class="cd-mood" style="--mc:${mood.color}"><span class="stamp-k">${mood.kanji}</span><div><b>${mood.name}</b><small>${mood.desc}</small>${sum.mood.text ? `<p>${esc(sum.mood.text)}</p>` : ''}</div></li>`,
        ),
      )
    } else if (date === today) {
      secs.push(this._sec('心情', 'きもち', '', '<li class="cd-hint">今天還沒寫回顧，想聊聊心情時再來也可以</li>'))
    }

    // 睡眠
    if (sum.sleep) {
      const sl = sum.sleep
      const q = sl.q ? `<span class="cd-q" title="睡眠品質 ${sl.q}/5">${Array.from({ length: 5 }, (_, i) => `<i${i < sl.q ? ' class="on"' : ''}></i>`).join('')}</span>` : ''
      secs.push(
        this._sec(
          '睡眠',
          'すいみん',
          fmtDur(sleepMinutes(sl)),
          `<li class="cd-row sl"><i class="cd-k">眠</i><span class="cd-t">${sl.bed} → ${sl.wake}<small>記在醒來那天</small></span>${q}</li>`,
        ),
      )
    }

    // 生活記錄與花費
    const life = sum.life
    if (life.items.length || life.energy) {
      const energy = life.energy ? `<li class="cd-energy">精神<b>${ENERGY[life.energy] || ''}</b><span class="cd-q">${Array.from({ length: 5 }, (_, i) => `<i${i < life.energy ? ' class="on"' : ''}></i>`).join('')}</span></li>` : ''
      const rows = life.items
        .map((x) => {
          const k = lifeKindOf(x.kind)
          return `<li class="cd-row lf" style="--c:${k.color}"><i class="cd-k" title="${k.label}">${k.kanji}</i><span class="cd-time">${esc(x.t)}</span><span class="cd-t">${esc(x.text || k.label)}</span>${x.amount ? `<small class="cd-amt">${x.amount.toLocaleString()} 元</small>` : ''}</li>`
        })
        .join('')
      secs.push(this._sec('生活記錄', 'くらし', sum.spend ? `花費 ${sum.spend.toLocaleString()} 元` : '', energy + rows))
    }

    const chips = [
      sum.tasks.length && `<span>任務<b>${sum.tasksDone}/${sum.tasks.length}</b></span>`,
      sum.events.length && `<span>日程<b>${sum.events.length}</b></span>`,
      past && sum.habits.total && `<span>習慣<b>${sum.habits.done}/${sum.habits.total}</b></span>`,
      sum.focus && `<span>專注<b>${sum.focus}</b>分</span>`,
      sum.spend && `<span>花費<b>${sum.spend.toLocaleString()}</b>元</span>`,
    ]
      .filter(Boolean)
      .join('')

    const rel = relLabel(date, today)
    const empty = !secs.length
      ? `<div class="empty cd-empty"><span class="em">${date > today ? '還是一張白紙' : '靜悄悄的一天'}</span>${date > today ? '想先安排日程時，可以按「到這一天」' : '這天沒有留下記錄'}</div>`
      : ''
    this.el.side.innerHTML = `
      <div class="cd-head">
        <div class="cd-date"><b>${d.getMonth() + 1} 月 ${d.getDate()} 日</b><small>${WEEK_JP[d.getDay()]}・<em>${rel}</em></small></div>
        ${mood ? `<span class="stamp-k cd-moodk" style="--mc:${mood.color}" title="心情：${mood.name}">${mood.kanji}</span>` : ''}
      </div>
      <div class="cd-acts">
        <button type="button" class="btn-primary" data-act="go" title="到這一天（Enter）">到這一天</button>
        <button type="button" class="btn-ghost" data-act="review"${date > today ? ' disabled title="還沒到這一天"' : ''}>${sum.mood ? '編輯回顧' : '寫回顧'}</button>
      </div>
      ${chips ? `<div class="cd-chips">${chips}</div>` : ''}
      ${secs.join('')}${empty}`
  }

  _sec(title, jp, count, rows) {
    return `<section class="cd-sec"><h4>${title}<small>${jp}</small>${count ? `<span>${count}</span>` : ''}</h4><ul class="cd-list">${rows}</ul></section>`
  }
}
