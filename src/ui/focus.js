// 番茄鐘的介面：Dock 上的計時器、專注頁、長度設定。計時規則在 ../focusClock.js。
import { $, $$, esc, ICON, pickOne, scrollMode } from './dom.js'
import { FocusCat } from './focusCat.js'
import * as clock from '../focusClock.js'
import { FREE_MIN, FREE_MAX } from '../focusClock.js'
import { FOCUS_MIN, BREAK_MIN, PROJECT_COLORS, tagOf } from '../theme.js'
import { floating } from '../store.js'
import { coatOfDay } from '../catWalk.js'

// ── 番茄鐘 ──
const FOCUS_KEY = 'hiyori-focus'
const rawFocus = Number(new URLSearchParams(location.search).get('focus'))
const debugMin = import.meta.env.DEV && Number.isFinite(rawFocus) && rawFocus > 0 ? rawFocus : 0
// 倒數長度的刻度尺：10 分到 90 分每 5 分一格（正向計時是另外一個開關）
const RULER = Array.from({ length: 17 }, (_, i) => 10 + i * 5)
const RULER_TICK = 14
// 計時規則（正向計時的上下限、放太久的判斷、到點該做什麼）在 focusClock.js
export const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

export class FocusTimer {
  constructor(ui, hooks) {
    this.ui = ui
    this.hooks = hooks
    this.mode = 'idle' // idle | focus | break
    // 倒數：這一段結束的時間；往上數的專注：開始的時間（暫停過就往後挪）
    this.endAt = 0
    // 暫停時：倒數剩下的毫秒；往上數時是已經過的毫秒
    this.paused = null
    // 專注的目標：一件任務，或直接是一個專案（兩個只會有一個）
    this.taskId = null
    this.projectId = null
    this.sid = null // 這一輪專注的 id
    this._loadLengths()
    try {
      const saved = JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null')
      if (saved?.mode === 'focus' || saved?.mode === 'break') this._restore(saved)
      // 還沒開始、只先選好了目標：重新整理後也還記得
      else this._restoreTarget(saved)
    } catch {}
    // 另一個分頁開始、暫停、換目標或結束了計時：這邊跟著換成同一個。
    // 不然兩邊各自倒數，到點時各記一次專注（同一輪的 sid 一樣，store 那邊也只會記一次）
    addEventListener('storage', (e) => {
      if (e.key === FOCUS_KEY) this._otherTab(e.newValue)
    })
    $('#focusBtn').onclick = () => this.toggle()
    $('#focusStop').onclick = () => this.stop()
    $('#focusLabel').onclick = (e) => {
      e.stopPropagation()
      this.togglePicker()
    }
    // 點時間打開計時設定（手機上看不到任務標籤，選目標也是從這裡）；計時中只能換目標。App 模式計時中點時間打開全螢幕計時
    $('#focusTime').onclick = (e) => {
      e.stopPropagation()
      if (this.mode !== 'idle' && this.ui.appMode) this.toggleBig(true)
      else this.toggleSet()
    }
    $('#ffTarget').addEventListener('change', (e) => this.setTarget(e.target.value))
    $('#ffToggle').onclick = () => this.toggle()
    $('#ffStop').onclick = () => this.stop()
    $('#ffMin').onclick = () => this.toggleBig(false)
    $('#ffCabin').onclick = () => this.hooks.goCabin?.()
    // 專注頁上散步的貓咪：右上角的腳印請牠離開、再請牠回來（設定會記住）
    this.cat = new FocusCat($('#ffCat'), { card: $('#focusFull .ff-card'), onPoke: () => this.hooks.catPoke?.() })
    $('#ffCatBtn').onclick = () => {
      this.ui.store.setSetting('focusCat', this.ui.store.state.settings.focusCat === false)
      this._catSync()
    }
    $('#focusPickList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-target]')
      if (!b) return
      this.togglePicker(false)
      this.setTarget(b.dataset.target)
    })
    addEventListener('pointerdown', (e) => {
      if (!$('#focusPick').hidden && !e.target.closest('#focusPick, #focusLabel')) this.togglePicker(false)
      if (!$('#focusSet').hidden && !e.target.closest('#focusSet, #focusTime')) this.toggleSet(false)
    })
    this._bindSet()
    setInterval(() => this.tick(), 250)
    this.render()
    if (this.mode === 'focus' && this.paused == null && !this._stale() && (this.up || this.endAt > Date.now())) hooks.focusStarted(true, this.task?.id || null, this.info)
  }

  // 這一段（專注、休息）本來該結束的時間過了太久：例如晚上開始專注後關掉，兩天後才打開
  _stale() {
    return clock.isStale(this, Date.now())
  }
  // 不記專注、不接著開下一輪，回到待機，跟使用者說一聲
  _expire() {
    const wasFocus = this.mode === 'focus'
    this.toggleSet(false)
    this.toggleBig(false)
    this.mode = 'idle'
    this.paused = null
    this._loadLengths()
    this._save()
    this.render()
    this.hooks.focusExpired?.(wasFocus)
  }

  // 沒在計時時，長度和輪數跟著設定（開發時可用 ?focus= 縮短）；計時中用開始時記下的那一份
  _loadLengths() {
    const st = this.ui.store.state.settings
    this.up = !debugMin && st.focusUp
    this.focusMin = debugMin || st.focusMin || FOCUS_MIN
    this.breakMin = debugMin ? debugMin / 2 : st.breakMin || BREAK_MIN
    this.rounds = this.up ? 1 : st.focusRounds || 1
    this.round = 1
  }

  // 重新整理前的計時：每個欄位都檢查過才用（壞掉的數字會一路變成 NaN 分鐘）
  _restore(saved) {
    Object.assign(this, clock.restoreState(saved, this))
  }
  _restoreTarget(saved) {
    this.taskId = typeof saved?.taskId === 'string' ? saved.taskId : null
    this.projectId = !this.taskId && typeof saved?.projectId === 'string' ? saved.projectId : null
  }

  _save() {
    const { mode, endAt, paused, taskId, projectId, up, focusMin, breakMin, round, rounds, sid } = this
    try {
      localStorage.setItem(FOCUS_KEY, JSON.stringify({ mode, endAt, paused, taskId, projectId, up, focusMin, breakMin, round, rounds, sid }))
    } catch {}
  }

  // 另一個分頁存了計時狀態：換成那一份，小島上的兩人也跟著進出小木屋（不放台詞、不記專注）
  _otherTab(text) {
    let saved = null
    try {
      saved = JSON.parse(text || 'null')
    } catch {}
    const was = this.mode
    if (saved?.mode === 'focus' || saved?.mode === 'break') this._restore(saved)
    else {
      this.mode = 'idle'
      this.paused = null
      this._loadLengths()
      // 另一個分頁只是換了目標（還沒開始）：這邊也換成同一個
      this._restoreTarget(saved)
    }
    this._shown = null
    this.toggleSet(false)
    if (this.mode === 'idle') this.toggleBig(false)
    this.render()
    if (this.mode === 'focus' && was !== 'focus') this.hooks.focusStarted(true, this.task?.id || null, this.info)
    else if (this.mode !== 'focus' && was === 'focus') this.hooks.focusSynced?.()
  }

  // 綁定的任務若已完成或刪除就自動解除
  get task() {
    const t = this.taskId && this.ui.store.state.tasks.find((x) => x.id === this.taskId)
    return t && !t.done ? t : null
  }
  // 綁定的專案：落成、收藏或刪掉了就自動解除
  get project() {
    const p = this.projectId && this.ui.store.state.projects.find((x) => x.id === this.projectId)
    return p && !p.archived && !p.completedAt ? p : null
  }
  // 畫面上寫的目標
  get targetText() {
    return this.task ? `◷ ${this.task.title}` : this.project ? `◷ 專案・${this.project.name}` : ''
  }
  // 往上數中（休息一律倒數）
  get counting() {
    return clock.counting(this)
  }
  get info() {
    return { round: this.round, rounds: this.rounds, free: this.up, breakMin: this.breakMin, projectId: this.task ? null : this.project?.id || null, sid: this.sid }
  }
  // 可以選的目標：今天還沒做完的任務、專案裡的長期任務（收藏起來的專案不列）、進行中的專案（暫停的也可以）
  _targets() {
    const s = this.ui.store
    const projects = s.state.projects.filter((p) => !p.archived && !p.completedAt)
    const open = new Set(s.state.projects.filter((p) => !p.archived).map((p) => p.id))
    return {
      tasks: s.tasksOn(s.today).filter((t) => !t.done),
      long: s.state.tasks.filter((t) => floating(t) && open.has(t.project)),
      projects,
    }
  }
  _targetKey() {
    return this.task ? `t:${this.task.id}` : this.project ? `p:${this.project.id}` : ''
  }

  // key：'t:<任務 id>'、'p:<專案 id>' 或 ''（不指定）
  setTarget(key) {
    const [kind, id] = key ? [key.slice(0, 1), key.slice(2)] : ['', '']
    this.taskId = kind === 't' ? id : null
    this.projectId = kind === 'p' ? id : null
    this._save()
    this.render()
    if (!$('#focusSet').hidden) this._renderSet()
    this.hooks.focusTaskChanged?.(this.taskId, this.projectId)
  }

  togglePicker(force) {
    const open = force ?? $('#focusPick').hidden
    $('#focusPick').hidden = !open
    $('#focusLabel').setAttribute('aria-expanded', open)
    if (!open) return
    this.toggleSet(false)
    const { tasks, long, projects } = this._targets()
    const cur = this._targetKey()
    const item = (key, color, text, extra = '') => `<li><button data-target="${esc(key)}" class="${key === cur ? 'on' : ''}" aria-pressed="${key === cur}"><i style="--c:${color}"></i>${text}${extra}</button></li>`
    const task = (t) => item(`t:${t.id}`, tagOf(t.tag).color, esc(t.title), t.pomos ? `<small>◷ ${t.pomos}</small>` : '')
    $('#focusPickList').innerHTML = [
      item('', '#d8dee8', '不指定'),
      '<li class="fp-h">今天的任務</li>',
      ...tasks.map(task),
      tasks.length ? '' : '<li class="empty">今天沒有待辦的任務</li>',
      long.length ? '<li class="fp-h">長期任務<small>專案裡慢慢推進的事</small></li>' : '',
      ...long.map(task),
      projects.length ? '<li class="fp-h">專案<small>專注的時間記進專案</small></li>' : '',
      ...projects.map((p) => item(`p:${p.id}`, PROJECT_COLORS[p.color % PROJECT_COLORS.length], esc(p.name), p.pausedAt ? '<small>暫停中</small>' : '')),
    ].join('')
  }

  // ── 計時設定：倒數／正向、刻度尺、目標、輪數、休息（計時中只能換目標）──
  toggleSet(force) {
    const el = $('#focusSet')
    const open = force ?? el.hidden
    el.hidden = !open
    $('#focusTime').setAttribute('aria-expanded', open)
    if (!open) {
      this._asking = false
      return
    }
    this.togglePicker(false)
    this._renderSet()
    this._syncRuler()
    this._fit(el)
  }
  // 視窗放不下（手機的小島模式只剩上半部、手機橫放）：頂到畫面外就改成從最上面排、裡面捲動
  _fit(el) {
    el.style.top = el.style.bottom = el.style.maxHeight = ''
    if (el.offsetTop >= 8) return
    el.style.top = '8px'
    el.style.bottom = 'auto'
    el.style.maxHeight = 'calc(100dvh - 16px)'
  }
  // 刻度尺轉到設定的長度（藏著的時候量不到寬度，切回倒數時再轉一次）
  _syncRuler() {
    const v = this.ui.store.state.settings.focusMin
    let i = RULER.indexOf(v)
    if (i < 0) i = RULER.reduce((best, x, k) => (Math.abs(x - v) < Math.abs(RULER[best] - v) ? k : best), 0)
    $('#fsRuler').scrollLeft = i * RULER_TICK
  }

  _bindSet() {
    const ruler = $('#fsRuler')
    $('#fsTrack').innerHTML = RULER.map(
      (v, i) => `<i class="${v % 30 === 0 ? 'major' : v % 10 === 0 ? 'mid' : ''}" data-i="${i}">${v % 30 === 0 || i === 0 ? `<b>${v}</b>` : ''}</i>`,
    ).join('')
    const nearest = () => Math.max(0, Math.min(RULER.length - 1, Math.round(ruler.scrollLeft / RULER_TICK)))
    let raf = 0
    ruler.addEventListener('scroll', () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        // 藏起來（正向計時、關掉視窗）時捲動位置會歸零：那不是使用者選的長度
        if (!ruler.offsetParent || this.ui.store.state.settings.focusUp) return
        this._setLength(RULER[nearest()])
      })
    })
    ruler.addEventListener('click', (e) => {
      const t = e.target.closest('[data-i]')
      if (t) ruler.scrollTo({ left: +t.dataset.i * RULER_TICK, behavior: scrollMode() })
    })
    // 桌機：滾輪上下也能左右轉、左右鍵一格一格調、滑鼠可以直接拖
    ruler.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
        e.preventDefault()
        ruler.scrollTo({ left: (nearest() + Math.sign(e.deltaY)) * RULER_TICK, behavior: scrollMode() })
      },
      { passive: false },
    )
    // 鍵盤：跟一般的滑桿一樣，左右（上下）一格、Home／End 到最短和最長
    const STEP = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }
    ruler.addEventListener('keydown', (e) => {
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? RULER.length - 1 : e.key in STEP ? nearest() + STEP[e.key] : null
      if (to == null) return
      // 不要讓全域的左右鍵切換日期
      e.stopPropagation()
      e.preventDefault()
      ruler.scrollTo({ left: to * RULER_TICK, behavior: scrollMode() })
    })
    let drag = null
    ruler.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return
      drag = { x: e.clientX, left: ruler.scrollLeft, moved: false }
      ruler.classList.add('dragging')
      ruler.setPointerCapture(e.pointerId)
    })
    ruler.addEventListener('pointermove', (e) => {
      if (!drag) return
      if (Math.abs(e.clientX - drag.x) > 3) drag.moved = true
      ruler.scrollLeft = drag.left - (e.clientX - drag.x)
    })
    const end = () => {
      if (!drag) return
      ruler.classList.remove('dragging')
      if (drag.moved) ruler.scrollTo({ left: nearest() * RULER_TICK, behavior: scrollMode() })
      drag = null
    }
    ruler.addEventListener('pointerup', end)
    ruler.addEventListener('pointercancel', end)
    $('#fsRounds').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]:not(:disabled)')
      if (b) this._setOption('focusRounds', +b.dataset.v)
    })
    $('#fsBreak').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (b) this._setOption('breakMin', +b.dataset.v)
    })
    // 倒數計時／正向計時
    $('#fsMode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (!b) return
      this._setOption('focusUp', b.dataset.v === 'up')
      if (b.dataset.v === 'down') this._syncRuler()
    })
    $('#fsTarget').addEventListener('change', (e) => this.setTarget(e.target.value))
    $('#fsStart').onclick = () => {
      // 休息中按了某件事要專注（ask）：結束休息，照剛選的開始
      const fromBreak = this.mode === 'break' && this._asking
      this.toggleSet(false)
      if (fromBreak) {
        this.mode = 'idle'
        this._loadLengths()
      }
      if (this.mode === 'idle') this.toggle()
    }
  }

  _setLength(v) {
    if (this.ui.store.state.settings.focusMin === v) return
    this._setOption('focusMin', v)
  }
  _setOption(key, v) {
    this.ui.store.setSetting(key, v)
    this._renderSet()
    this.render()
  }

  _renderSet() {
    const st = this.ui.store.state.settings
    // 計時中：計時方式、長度、輪數、休息都照開始時的，只能換目標（休息中點了某件事要專注的不算）
    const live = this.mode === 'focus' || (this.mode === 'break' && !this._asking)
    const up = live ? this.up : st.focusUp
    const v = st.focusMin
    $('#focusSet h4').firstChild.textContent = live ? '計時中・換個目標' : '要怎麼專注？'
    $('#fsMode').hidden = live
    pickOne($$('#fsMode button'), (b) => (b.dataset.v === 'up') === up)
    $('#fsTime').textContent = live ? $('#focusTime').textContent : up ? '00:00' : `${v}:00`
    // 刻度尺是滑桿：讀螢幕軟體要知道現在是幾分鐘
    $('#fsRuler').setAttribute('aria-valuenow', v)
    $('#fsRuler').setAttribute('aria-valuetext', `${v} 分鐘`)
    $('#fsTime').classList.toggle('up', up && this.mode !== 'break')
    // 正向計時不用選長度和輪數
    $('#fsRwrap').hidden = up || live
    $('#fsRoundsRow').hidden = up || live
    $('#fsBreakRow').hidden = live
    $('#fsStart').hidden = live
    pickOne($$('#fsRounds button'), (b) => +b.dataset.v === st.focusRounds)
    pickOne($$('#fsBreak button'), (b) => +b.dataset.v === st.breakMin)
    const target = this.project ? `，時間記進「${this.project.name}」` : ''
    $('#fsSum').textContent = live
      ? `換了目標，這一輪的時間就算在新的目標上${target}`
      : up
        ? `從 0 開始往上數，做完按 ■；滿 ${FREE_MIN} 分鐘就記下來（最長 ${FREE_MAX / 60} 小時）${target}`
        : `${v} 分${st.focusRounds > 1 ? ` × ${st.focusRounds} 輪，中間休息 ${st.breakMin} 分` : `，做完休息 ${st.breakMin} 分`}${target}`
    this._fillTargets($('#fsTarget'))
  }
  // 目標的下拉：今天的任務、長期任務和專案（手機上看不到任務標籤，從這裡選）
  _fillTargets(sel) {
    const { tasks, long, projects } = this._targets()
    const opt = (key, text) => `<option value="${esc(key)}">${esc(text)}</option>`
    sel.innerHTML = [
      opt('', '不指定'),
      tasks.length ? `<optgroup label="今天的任務">${tasks.map((t) => opt(`t:${t.id}`, t.title)).join('')}</optgroup>` : '',
      long.length ? `<optgroup label="長期任務">${long.map((t) => opt(`t:${t.id}`, t.title)).join('')}</optgroup>` : '',
      projects.length ? `<optgroup label="專案">${projects.map((p) => opt(`p:${p.id}`, p.name)).join('')}</optgroup>` : '',
    ].join('')
    sel.value = this._targetKey()
  }

  // 從任務列表或專案頁按「專注」：計時中就換目標，沒在計時就開始
  // 從總覽、任務列表、專案點了某件事：先打開設定視窗（倒數／正向、長度、輪數、休息），目標已經選好，
  // 按「開始專注」才開始。已經在專注：直接換目標。休息中：可以照樣設定，開始時結束休息
  ask(taskId, projectId = null) {
    if (this.mode === 'focus') return this.startWith(taskId, projectId)
    this.taskId = taskId
    this.projectId = taskId ? null : projectId
    this._save()
    this.render()
    this.hooks.focusTaskChanged?.(this.taskId, this.projectId)
    this._asking = this.mode === 'break'
    if (this._asking) this.toggleBig?.(false)
    this.toggleSet(true)
    $('#fsStart').focus({ preventScroll: true })
  }

  startWith(taskId, projectId = null) {
    this.taskId = taskId
    this.projectId = taskId ? null : projectId
    if (this.mode === 'focus') {
      this._save()
      this.render()
      this.hooks.focusTaskChanged?.(this.taskId, this.projectId)
      return
    }
    if (this.mode === 'break') {
      this.mode = 'idle'
      this._loadLengths()
    }
    this.toggle()
  }

  get total() {
    return (this.mode === 'break' ? this.breakMin : this.focusMin) * 60000
  }
  get left() {
    return clock.leftMs(this, Date.now())
  }
  get elapsed() {
    return clock.elapsedMs(this, Date.now())
  }

  toggle() {
    if (this.mode === 'idle') {
      this._loadLengths()
      // 專注時兩人會走進小木屋、計時器在 Dock 上，全螢幕會把它們蓋住
      this.ui.toggleFull(false)
      this._startFocus()
      return
    }
    Object.assign(this, clock.pauseToggle(this, Date.now()))
    this._save()
    this.render()
  }

  _startFocus() {
    Object.assign(this, clock.focusStart(this, Date.now()))
    // 這一輪的 id：記專注時用來認出「同一輪」（兩個分頁同時到點只記一次）
    this.sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    if (!this.task) this.taskId = null
    if (this.taskId || !this.project) this.projectId = null
    this.togglePicker(false)
    this.toggleSet(false)
    this._save()
    this.render()
    this.hooks.focusStarted(false, this.taskId, this.info)
    if (this.ui.appMode) this.toggleBig(true)
  }

  // App 模式：專注時整個畫面是一個大計時器（縮小後計時繼續，點右下的時間再打開）
  toggleBig(force) {
    const open = (force ?? $('#focusFull').hidden) && this.mode !== 'idle'
    $('#focusFull').hidden = !open
    if (!open) return this._catSync()
    this._fillTargets($('#ffTarget'))
    this.render()
  }

  // 專注頁的貓咪：專注頁開著、設定沒關才出來。每秒帶最新的狀態過去（暫停、休息、這一輪專注了多久）
  _catSync() {
    const open = !$('#focusFull').hidden && this.mode !== 'idle'
    const on = this.ui.store.state.settings.focusCat !== false
    if (on !== this._catOn) {
      this._catOn = on
      const btn = $('#ffCatBtn')
      btn.setAttribute('aria-pressed', String(on))
      btn.title = on ? '散步的貓咪：點一下請牠先離開' : '散步的貓咪：點一下請牠回來'
    }
    if (!open) return this.cat.hide()
    if (!on) return this.cat.leave()
    const focusMs = this.mode === 'focus' ? (this.counting ? this.elapsed : this.total - this.left) : 0
    this.cat.show({ mode: this.mode, paused: this.paused != null, focusMs }, coatOfDay(this.ui.store.today))
  }

  // 一輪專注結束：記下分鐘數，接著休息
  _finishFocus(minutes) {
    const info = { ...this.info, last: this.round >= this.rounds }
    this.toggleSet(false)
    Object.assign(this, clock.breakStart(this, Date.now()))
    this._save()
    this.hooks.focusFinished(minutes, this.task?.id || null, info)
    this.render()
  }

  stop() {
    // 往上數的專注按 ■ 是「做完了」：滿 5 分鐘就照實際分鐘數記下來
    const done = clock.stopMinutes(this, Date.now())
    if (done != null) return this._finishFocus(done)
    const wasFocus = this.mode === 'focus'
    this.toggleSet(false)
    this.mode = 'idle'
    this.paused = null
    this._loadLengths()
    this._save()
    this.render()
    if (wasFocus) this.hooks.focusStopped()
  }

  tick() {
    if (this.mode === 'idle' || this.paused != null) return
    const step = clock.due(this, Date.now())
    if (step?.do === 'expire') return this._expire()
    if (step?.do === 'finishFocus') this._finishFocus(step.minutes)
    else if (step?.do === 'nextRound') {
      // 還有下一輪：休息完自動接著開始
      this.round++
      this.hooks.breakFinished({ next: this.round, rounds: this.rounds })
      this._startFocus()
    } else if (step?.do === 'done') {
      this.toggleSet(false)
      this.mode = 'idle'
      this._loadLengths()
      this._save()
      this.hooks.breakFinished(null)
    }
    // 每 0.25 秒檢查一次是為了準時結束；畫面上的數字一秒才變一次，沒變就不重寫
    const sec = this.mode === 'idle' ? -1 : Math.floor((this.counting ? this.elapsed : this.left) / 1000)
    if (sec === this._shown && this.mode === this._shownMode) return
    this._shown = sec
    this._shownMode = this.mode
    this.render()
  }

  render() {
    if (this.mode === 'idle') this._loadLengths()
    // 目標失效了（任務做完或刪掉、專案落成、收藏或刪掉）：真的解除，之後放回來也不會自己綁回去
    if ((this.taskId && !this.task) || (this.projectId && !this.project)) {
      if (!this.task) this.taskId = null
      if (!this.project) this.projectId = null
      this._save()
    }
    // 今日總覽的「進行中」算正在專注的那一件：開始、結束或換了一件就重畫
    const fk = this.mode === 'focus' ? this.taskId : null
    if (fk !== this._todayKey) {
      this._todayKey = fk
      if (this.ui.tab === 'today') this.ui.today?.render()
    }
    const counting = this.counting
    const time = this.mode === 'idle' && this.up ? '00:00' : mmss(counting ? this.elapsed : this.left)
    if (this.mode !== 'idle' && !$('#focusSet').hidden) $('#fsTime').textContent = time
    $('#focusTime').textContent = time
    $('#focusTime').title = this.mode === 'idle' ? '倒數或正向計時、長度、目標' : this.ui.appMode ? '打開全螢幕計時' : '換專注的目標'
    const box = $('#focusBox')
    box.classList.toggle('running', this.mode === 'focus')
    box.classList.toggle('break', this.mode === 'break')
    box.classList.toggle('idle', this.mode === 'idle')
    const multi = this.rounds > 1
    const label = {
      idle: this.up ? '正向計時 · ↑' : multi ? `${this.focusMin} 分 × ${this.rounds} 輪` : '專注 · しゅうちゅう',
      focus: multi ? `專注中 · ${this.round}/${this.rounds}` : this.up ? '正向計時中' : '專注中',
      break: multi && this.round < this.rounds ? `休息 · 下一輪 ${this.round + 1}/${this.rounds}` : '休息 · きゅうけい',
    }[this.mode]
    const t = this.targetText
    $('#focusLabel').textContent = this.paused != null ? '暫停中' : t && this.mode !== 'break' ? t : label
    $('#focusLabel').classList.toggle('set', !!t && this.mode !== 'break')
    $('#focusIcon').innerHTML = this.mode !== 'idle' && this.paused == null ? ICON.pause : ICON.play
    $('#focusStop').hidden = this.mode === 'idle'
    $('#focusStop').title = counting ? `做完了（滿 ${FREE_MIN} 分鐘會記下來）` : '結束'
    $('#focusBtn').title = this.mode === 'idle' ? '開始專注 (F)' : this.paused != null ? '繼續' : '暫停'
    // 往上數時，圓環每一小時繞一圈
    const frac = this.mode === 'idle' ? 0 : counting ? (this.elapsed % 3600000) / 3600000 : 1 - this.left / this.total
    $('#focusArc').style.strokeDashoffset = 119.4 * (1 - frac)
    document.title = this.mode === 'idle' ? 'ひより日和 · 日程小島' : `${time} ${this.mode === 'focus' ? '專注中' : '休息中'} · ひより`
    this._renderBig(time, frac, label)
  }

  _renderBig(time, frac, label) {
    const el = $('#focusFull')
    if (this.mode === 'idle') el.hidden = true
    this._catSync()
    if (el.hidden) return
    el.classList.toggle('break', this.mode === 'break')
    $('#ffKicker').textContent = this.paused != null ? '暫停中' : label
    $('#ffTime').textContent = time
    $('#ffArc').style.strokeDashoffset = 552.9 * (1 - frac)
    // 專注中可以直接在這裡換目標；休息時寫一句話
    const brk = this.mode === 'break'
    $('#ffTask').hidden = !brk
    $('#ffTask').textContent = '起來動一動、喝口水'
    const sel = $('#ffTarget')
    sel.hidden = brk
    // 選單在打開全螢幕時填好；目標從別的地方換了才重填（正在選的時候不動它）
    if (!brk && document.activeElement !== sel && sel.value !== this._targetKey()) this._fillTargets(sel)
    $('#ffToggle').textContent = this.paused != null ? '繼續' : '暫停'
    $('#ffStop').textContent = this.counting ? '做完了' : this.mode === 'break' ? '跳過休息' : '結束'
    $('#ffCabin').hidden = this.mode !== 'focus'
  }
}
