// 番茄鐘的介面：Dock 上的計時器、專注頁、長度設定。計時規則在 ../focusClock.js。
import { $, $$, esc, ICON, pickOne, scrollMode } from './dom.js'
import { calmMotion } from './motion.js'
import { FocusCat } from './focusCat.js'
import * as clock from '../focusClock.js'
import { FREE_MIN, FREE_MAX, SMALL_MIN } from '../focusClock.js'
import { FOCUS_MIN, BREAK_MIN, FOCUS_GOALS, goalText, PROJECT_COLORS, PULLS, pullOf, tagOf } from '../theme.js'
import { floating, NOISES } from '../store.js'
import { nextStep, order as doFirst } from '../brief.js'
import { nextEvent } from '../planner.js'
import { PROJECT_LIMITS as PL } from '../projects.js'
import { coatOfDay } from '../catWalk.js'
import './focus.css'

// ── 番茄鐘 ──
const FOCUS_KEY = 'hiyori-focus'
const rawFocus = Number(new URLSearchParams(location.search).get('focus'))
const debugMin = import.meta.env.DEV && Number.isFinite(rawFocus) && rawFocus > 0 ? rawFocus : 0
// 倒數長度的刻度尺：10 分到 90 分每 5 分一格（正向計時是另外一個開關）
const RULER = Array.from({ length: 17 }, (_, i) => 10 + i * 5)
const RULER_TICK = 14
// 計時規則（正向計時的上下限、放太久的判斷、到點該做什麼）在 focusClock.js
const LOW = typeof matchMedia === 'function' ? matchMedia('(max-height: 520px) and (min-aspect-ratio: 4/3)') : { matches: false }
// 專注頁圓環的周長（半徑 86）
const ARC = 540.4
// 想分心了：先等多久、跟著圓圈呼吸的一個來回（吸氣、吐氣各一半；圓圈的大小也照它算，見 _renderUrge）
const URGE_MS = 60000
const BREATH_MS = 8000
// 背景聲的名字（按鈕的說明、選單下面那一行）
const NOISE_NAMES = { rain: '雨聲', brown: '褐噪音', pink: '粉紅噪音' }
// 還有多久：45 分鐘、1 小時 5 分
const span = (min) => (min >= 60 ? `${Math.floor(min / 60)} 小時${min % 60 ? ` ${min % 60} 分` : ''}` : `${min} 分鐘`)
// 照字數截（emoji 這種兩個字元組成的字不會被切成一半）
const clip = (s, n = 16) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s)
// 字有變才換（每 250 毫秒重畫一次）
const setText = (el, s) => {
  if (el.textContent !== s) el.textContent = s
}
const hhmm = (ts) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
// 有變才寫進畫面（專注頁每秒重畫一次，大部分的字沒變）
const put = (el, html) => {
  if (el._html === html) return
  el._html = html
  el.innerHTML = html
}
export const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
// 下一步那一行的按鈕：就做這件、×（這一輪不指定）、勾勾、寫下一步（重畫時焦點接回同一種）
const STEP_KEYS = ['data-pick', 'data-pick-x', 'data-step', 'data-step-open']

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
      if (e.key !== FOCUS_KEY) return
      // 照現在存著的最新狀態，不照事件帶來的那一份：兩個分頁幾乎同時按了不同的按鈕（一邊延長、一邊加一輪）時，
      // 事件是晚到的舊樣子，照它換的話兩邊會停在不一樣的狀態
      let now = e.newValue
      try {
        now = localStorage.getItem(FOCUS_KEY)
      } catch {}
      this._otherTab(now)
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
    for (const id of ['#ffExtend', '#fsExtend']) $(id).onclick = () => this.extend()
    for (const id of ['#ffAddRound', '#fsAddRound']) $(id).onclick = () => this.addRound()
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
    this._bindPark()
    this._bindStep()
    this._bindUrge()
    this._bindNoise()
    setInterval(() => this.tick(), 250)
    this.render()
    if (this.mode === 'focus' && this.paused == null && !this._stale() && (this.up || this.endAt > Date.now())) hooks.focusStarted(true, this.task?.id || null, this.info)
    // 重新整理前就在計時：到點的通知再排一次（已經排著的話伺服器那邊只是換成同一個時間）
    hooks.focusPlan?.(this.boundary)
    hooks.focusLive?.(this.live, this.boundary)
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
    this.ext = false
    this.doneAt = null
    this.small = false
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
    this._persist()
    // 計時的狀態變了（開始、暫停、換目標、結束）：到點的通知跟著重排，Android 殼裡的即時倒數跟著換
    this.hooks.focusPlan?.(this.boundary)
    this.hooks.focusLive?.(this.live, this.boundary)
  }
  // 只寫進 localStorage（重新整理、另一個分頁接得回來），不重排通知
  _persist() {
    const { mode, endAt, paused, taskId, projectId, up, ext, doneAt, focusMin, breakMin, round, rounds, sid, small, away } = this
    try {
      localStorage.setItem(FOCUS_KEY, JSON.stringify({ mode, endAt, paused, taskId, projectId, up, ext, doneAt, focusMin, breakMin, round, rounds, sid, small, away }))
    } catch {}
  }
  // 這一輪專注中切去用別的 App 一陣子（main.js 量的）：記一次，到點的提示卡上寫中途離開了幾次。
  // sid：哪一輪——到點時還在外面的那一次，記在剛結束、正在休息的那一輪（延長是同一輪，接著算；重新整理也接得回來）
  noteAway(sid = this.sid) {
    if (this.mode === 'idle' || !sid || sid !== this.sid) return
    this.away = (this.away || 0) + 1
    this._persist()
  }

  // 現在計時的樣子（Android 殼的即時倒數通知用）：沒在計時是 null。
  // at：自己到點的時間（暫停中沒有）；since：正向計時從幾點開始數；leftMs：暫停時還剩（正向計時是已經過了）多久
  get live() {
    if (this.mode === 'idle') return null
    const { mode, round, rounds } = this
    const paused = this.paused != null
    const counting = this.counting
    return { mode, paused, counting, ext: !!this.ext, at: clock.nextEnd(this), since: counting && !paused ? this.endAt : null, leftMs: counting ? this.elapsed : this.left, round, rounds, target: this.task?.title || this.project?.name || '' }
  }

  // 下一次自己到點的時間和那時的狀況（排通知用）：沒在計時、暫停中是 null
  get boundary() {
    const at = clock.nextEnd(this)
    if (at == null) return null
    const { mode, focusMin, breakMin, round, rounds } = this
    return { at, mode, up: this.counting, focusMin, breakMin, round, rounds, target: this.task?.title || this.project?.name || '', ...(this.small ? { small: true } : {}) }
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
  // small：這一組是「只做 5 分鐘」（加時的 ext 也是 true 時，是到點後接著做下去）；away：這一輪中途離開了幾次
  get info() {
    return { round: this.round, rounds: this.rounds, free: this.up, ext: !!this.ext, small: !!this.small, away: this.away || 0, breakMin: this.breakMin, projectId: this.task ? null : this.project?.id || null, sid: this.sid }
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
    $('#fsGoal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (b && FOCUS_GOALS.includes(+b.dataset.v)) this._setOption('focusGoal', +b.dataset.v)
    })
    // 倒數計時／正向計時
    $('#fsMode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (!b) return
      this._setOption('focusUp', b.dataset.v === 'up')
      if (b.dataset.v === 'down') this._syncRuler()
    })
    $('#fsTarget').addEventListener('change', (e) => this.setTarget(e.target.value))
    // 提不起勁：照現在選的目標先做 5 分鐘就好（休息中點了某件事要專注的，也結束休息）
    $('#fsSmall').onclick = () => {
      this.toggleSet(false)
      this.startSmall(this.taskId, this.projectId)
    }
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

  // ── 先記下來：專注時腦中冒出別的事，一行字記下、不離開專注（專注頁和計時設定的小視窗各一行）──
  _bindPark() {
    for (const [form, input] of [['#ffPark', '#ffParkText'], ['#fsPark', '#fsParkText']]) {
      const el = $(input)
      $(form).addEventListener('submit', (e) => {
        e.preventDefault()
        if (!el.value.trim()) return
        const item = this.ui.store.park(el.value)
        if (!item) return this.ui.toast({ icon: '記', title: '先記下的事已經滿了', sub: '先到今日總覽整理一下，再記新的' })
        el.value = ''
        this._renderPark()
      })
      // Esc：放開這一行就好（不要連專注頁、小視窗一起收起來）。輸入法選字中的 Esc 是取消選字，不放開
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return
        e.stopPropagation()
        el.blur()
      })
    }
  }
  // 專注中按 N（或自己點）：叫出記下的那一行。專注頁開著就用頁面上的，不然打開計時設定的小視窗
  parkFocus() {
    if (this.mode !== 'focus') return false
    if (this.bigOpen) {
      // 正在「先等一分鐘」：按 N 是想先寫下來（跟按「寫下來，等等再做」一樣）
      if (this._urgeLive()) {
        this._urgeDo('park')
        return true
      }
      this._renderPark()
      $('#ffParkText').focus()
      return true
    }
    this.toggleSet(true)
    $('#fsParkText').focus()
    return true
  }
  // 記了幾件：專注頁上寫一行（專注完在今日總覽看）
  _renderPark() {
    const n = this.ui.store.state.parked.length
    const on = this.mode === 'focus'
    $('#ffPark').hidden = !on
    $('#ffParkN').hidden = !n
    put($('#ffParkN'), n ? `先記下了 ${n} 件・專注完在今日總覽看` : '')
  }

  // ── 下一步：專注的那一件拆成了小步驟（子任務）時，專注頁上寫著第一個還沒勾的那一步，做完了直接勾、換下一步
  // （最後一步勾完，任務也跟著完成）。還沒拆的話可以寫下一小步。
  // 休息時寫著「等等從這裡開始」：還沒寫下一步的話，休息前留一步給等等的自己（停下來之前先想好回來要做什麼，
  // 回來時不用重新想、比較不會被剛才的念頭拉走）。
  // 專注頁（#ffStep）和計時設定的小視窗（#fsStep：小島模式點 Dock 上的時間）各一行，畫的是同一個東西，打到一半的字兩邊共用 ──
  _bindStep() {
    for (const el of [$('#ffStep'), $('#fsStep')]) {
      const input = () => el.querySelector('.ff-step-add input')
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-step]')
        // 連按兩下的第二下（detail 是連按的第幾下）落在換上來的勾勾上：不算。勾完要重畫，機器忙的時候兩下會隔得比較久，
        // 只看時間（_checkStep 的 600 毫秒）擋不住
        if (b) return e.detail > 1 ? undefined : this._checkStep(b.dataset.step, el)
        // 沒選目標時建議的那一件：選成這一輪的目標（焦點接到換上來的那一行）；× 是這一輪不用
        const pick = e.target.closest('[data-pick]')
        if (pick) {
          this.setTarget(`t:${pick.dataset.pick}`)
          return el.querySelector('[data-step], [data-step-open]')?.focus()
        }
        // ×：這一輪不用，目標的選單出來（焦點放上去，想選別件就直接選）
        if (e.target.closest('[data-pick-x]')) {
          this._noPick = this.sid
          this.render()
          return (el.id === 'fsStep' ? $('#fsTarget') : $('#ffTarget')).focus()
        }
        if (!e.target.closest('[data-step-open]')) return
        this._stepOpen = this.taskId
        this._renderStep()
        input()?.focus()
      })
      // 打到一半的字記著（是哪一件的）：這一行被換掉（到點進入休息、重新整理畫面）、換到另一邊再出來時還在
      el.addEventListener('input', (e) => {
        if (e.target === input()) this._stepDraft = { id: this.taskId, text: e.target.value }
      })
      el.addEventListener('submit', (e) => {
        e.preventDefault()
        const t = this.task
        const text = input()?.value || ''
        if (!t || !text.trim()) return
        const x = this.ui.store.addSub(t.id, text)
        if (!x) return this.ui.toast({ icon: '步', title: '這件的小步驟已經滿了', sub: '到任務清單整理一下，再寫新的' })
        this._stepOpen = null
        this._stepDraft = null
        this._renderStep()
        el.querySelector('[data-step]')?.focus()
        // 休息時留的：ふじ／もち說「休息完從這裡開始」
        this.hooks.stepSet?.(x.title, this.mode === 'break')
      })
      // Esc：收起這一行就好（不要連專注頁、小視窗一起收起來）。輸入法選字中的 Esc 是取消選字，不收
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || e.target !== input()) return
        e.stopPropagation()
        this._stepOpen = null
        this._stepDraft = null
        this._renderStep()
        el.querySelector('[data-step-open]')?.focus()
      })
    }
  }
  // 沒選目標就開始專注：建議現在該做的那一件（本命、重要的、排了時間早的在前，跟警語的「現在該做」一樣），
  // 一鍵選成這一輪的目標（專注的時間記進去、看得到下一步）。這一輪按了 × 就不再問。
  // 專注頁上這一行先取代目標的選單（按 × 選單再出來）：版面一樣高，貓咪的地板不會被擠掉
  _pickTask() {
    if (this.mode !== 'focus' || this.task || this.project || this._noPick === this.sid) return null
    return doFirst(this.ui.store.tasksOn(this.ui.store.today))[0] || null
  }
  // 這一輪的那件還沒寫下一步（到點的提示卡上給「留一步給等等」）：還在計時（休息中、下一輪）、任務還沒做完、小步驟還沒滿
  get canLeaveStep() {
    const t = this.mode === 'idle' ? null : this.task
    return !!t && !nextStep(t) && (t.subs?.length || 0) < PL.subs
  }
  // 從提示卡按的：直接開始寫（焦點在輸入框）。App 模式打開專注頁，小島模式打開計時設定的小視窗（點 Dock 上的時間也回得來）。
  // taskId：提示卡是哪一件的——之後換了目標（另一個分頁換的也算）、計時結束了就不動，不會寫到別件上。
  // 按之前別的分頁已經寫好了下一步：打開讓你看到那一步就好
  leaveStep(taskId = this.taskId) {
    if (this.mode === 'idle' || !taskId || taskId !== this.taskId || !this.task) return false
    const big = this.ui.appMode
    if (big) this.toggleBig(true)
    else this.toggleSet(true)
    if (this.canLeaveStep) this._stepOpen = this.taskId
    this._renderStep()
    $(big ? '#ffStep' : '#fsStep').querySelector('.ff-step-add input, [data-step]')?.focus()
    return true
  }
  _checkStep(sid, box = $('#ffStep')) {
    // 連按兩下：第一下勾完，同一個位置馬上換成下一步的勾勾——第二下不算，不會一口氣勾掉兩步
    if (Date.now() - (this._stepAt || 0) < 600) return
    const t = this.task
    const step = t?.subs?.find((x) => x.id === sid)
    if (!step || step.done) return
    this._stepAt = Date.now()
    this.ui.store.toggleSub(t.id, sid)
    // 最後一步：任務跟著完成（照完成任務的慶祝），這一輪的目標自動解除——焦點交給選目標的那一格
    // （專注頁休息時看不到那一格：交給專注頁本身）
    const next = this.task ? nextStep(this.task) : null
    this._renderStep()
    // 專注中目標解除了、這一行換成建議的下一件時：焦點放在「就做這件」上（選單那時讓位給它）
    if (!next) return (box.id === 'fsStep' ? $('#fsTarget') : this.mode === 'break' ? $('#focusFull') : box.querySelector('[data-pick]') || $('#ffTarget')).focus()
    box.querySelector('[data-step]')?.focus()
    this.hooks.stepDone?.(step.title, next.title)
  }
  _renderStep() {
    const brk = this.mode === 'break'
    const t = this.mode === 'focus' || brk ? this.task : null
    const subs = Array.isArray(t?.subs) ? t.subs : []
    const step = t ? nextStep(t) : null
    // 正在寫的那一行（這一件的）：別的分頁剛好加了一步也不收起來，寫完再看下一步
    const writing = !!t && this._stepOpen === t.id && subs.length < PL.subs
    const draft = writing && this._stepDraft?.id === t.id ? this._stepDraft.text : null
    // 專注和休息時的提示字不一樣，畫好之後另外換（打到一半時到點，輸入框不會被換掉）
    const [ph, label] = brk ? ['等等回來先做什麼？寫小一點、一坐下就做得到的', '留一步給等等的自己：休息完先做什麼'] : ['下一小步是什麼？寫小一點、馬上做得到的', '寫下這件的下一小步']
    const pick = this._pickTask()
    for (const el of [$('#ffStep'), $('#fsStep')]) {
      const big = el.id === 'ffStep'
      let html = ''
      // 小視窗：休息中點了某件事要專注（_asking：正在選下一輪的設定）時不放
      if (!big && this._asking) html = ''
      else if (pick) {
        html =
          `<div class="ff-step-t"><small>要專注這一件嗎？</small><b>${esc(pick.title)}</b></div>` +
          `<button type="button" class="btn-ghost ff-step-pick" data-pick="${esc(pick.id)}">就做這件</button>` +
          `<button type="button" class="ff-step-x" data-pick-x title="這一輪不指定" aria-label="這一輪不指定目標">×</button>`
      } else if (writing) {
        html = `<form class="ff-step-add" autocomplete="off"><input id="${el.id}Text" maxlength="${PL.subTitle}" enterkeyhint="done"><button type="submit" class="btn-ghost">寫下</button></form>`
      } else if (step) {
        const i = subs.indexOf(step) + 1
        html =
          `<div class="ff-step-t"><small>${brk ? '等等從這裡開始' : '下一步'}</small><b>${esc(step.title)}</b></div>` +
          `<span class="ff-step-n" aria-label="第 ${i} 步，共 ${subs.length} 步">${i}/${subs.length}</span>` +
          `<button type="button" class="ff-step-check" data-step="${esc(step.id)}" title="這一步做完了" aria-label="「${esc(step.title)}」做完了">${ICON.check}</button>`
      } else if (t && subs.length < PL.subs) {
        html = `<button type="button" class="ff-step-open" data-step-open>＋ ${brk ? '休息前留一步給等等的自己' : subs.length ? '寫下接下來的一小步' : '拆出第一小步'}</button>`
      }
      el.hidden = !html
      el.classList.toggle('add', !!html && !pick && (writing || !step))
      el.classList.toggle('resume', brk && !!html)
      // 每秒重畫時沒變就不動（put）：打到一半的字、焦點都留著
      if (el._html !== html) {
        const had = el.contains(document.activeElement)
        // 焦點在哪一種按鈕上（就做這件、×、勾勾、寫下一步）：換上來的那一行有同一種的話接回同一種
        // （例如別件做完了、建議的換成下一件，焦點還在「就做這件」上）
        const kind = had ? STEP_KEYS.find((k) => document.activeElement.hasAttribute?.(k)) : null
        put(el, html)
        const input = el.querySelector('.ff-step-add input')
        if (input && draft != null) input.value = draft
        // 焦點所在的那一顆被換掉、收起來了：接到這一行新的那一顆，沒有的話交給專注頁本身、小視窗的目標
        // （不會掉到看不見的地方，也不會落在暫停這類一按就動的按鈕上）
        if (had && !el.contains(document.activeElement)) {
          const same = kind && el.querySelector(`[${kind}]`)
          ;(input || same || el.querySelector('[data-step], [data-step-open], [data-pick]') || (big ? $('#focusFull') : $('#fsTarget'))).focus()
        }
      }
      const input = html && writing ? el.querySelector('.ff-step-add input') : null
      if (!input) continue
      // 在另一邊打的字：沒在這一邊打的時候跟上
      if (draft != null && document.activeElement !== input && input.value !== draft) input.value = draft
      if (input.placeholder !== ph) input.placeholder = ph
      if (input.getAttribute('aria-label') !== label) input.setAttribute('aria-label', label)
    }
  }

  // ── 想分心了：專注中想去做別的事（滑手機、看別的網頁），先等一分鐘、跟著圓圈呼吸，一分鐘後還想去再去。
  // 回到正事、或先寫下來等等再做：記一次忍住了（store 的 focusHold）。還是想去也沒關係，專注照常計時 ──
  _bindUrge() {
    $('#ffUrgeBtn').onclick = () => this.urge(true)
    for (const id of ['#ffUrgeBack', '#ffUrgeAlt']) $(id).onclick = (e) => this._urgeDo(e.currentTarget.dataset.urge)
    // 想去做什麼：點一下選起來（再點一下取消），回到正事、寫下來、還是想去的時候一起記下來
    $('#ffUrgePulls .ff-urge-chips').innerHTML = PULLS.map((p) => `<button type="button" class="chip-toggle" data-pull="${p.id}" aria-pressed="false">${esc(p.label)}</button>`).join('')
    $('#ffUrgePulls').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pull]')
      if (!b || !this._urgeLive()) return
      this.urgePull = this.urgePull === b.dataset.pull ? null : b.dataset.pull
      this._renderUrge()
    })
    // Esc：收起來就好（不算忍住、也不算去了；不要連專注頁一起收起來）
    $('#ffUrge').addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return
      e.stopPropagation()
      this.urge(false)
    })
  }
  // 專注中、沒暫停（「想分心了？」只在這時候有）
  _urgeCan() {
    return this.mode === 'focus' && this.paused == null
  }
  // 「先等一分鐘」還算數嗎：打開時的那一輪（sid）、還在專注、沒暫停。換了一輪（到點、另一個分頁開始了新的一輪）就不算了
  _urgeLive() {
    return !!this.urgeAt && this.urgeSid === this.sid && this._urgeCan()
  }
  // 打開、收起「先等一分鐘」；回傳有沒有變。剛收起來不到一下（連按 Enter、按著不放）不會馬上又打開、又記一次
  urge(on) {
    if (on ? !this._urgeCan() || Date.now() - (this._urgeShut || 0) < 800 : !this.urgeAt) return false
    this.urgeAt = on ? Date.now() : 0
    this.urgeSid = on ? this.sid : null
    if (!on) this._urgeShut = Date.now()
    this._urgeAsked = false
    this.urgePull = null
    this._renderUrge()
    if (on) {
      $('#ffUrgeBack').focus()
      this.hooks.urgeOpen?.()
    } else this._urgeFocus()
    return true
  }
  // back：回到正事；park：先寫下來等等再做（焦點到「先記下來」那一行）；go：還是想去。
  // 等的時候點了想去做什麼的話，一起記下來（忍住的、去了的都算）
  _urgeDo(act) {
    if (!this._urgeLive()) return
    const pull = this.urgePull
    this.urgeAt = 0
    this.urgePull = null
    this._urgeShut = Date.now()
    this._renderUrge()
    if (act === 'go') {
      if (pull) this.ui.store.focusWent(pull)
      this.hooks.urgeGo?.(pull)
      return this._urgeFocus()
    }
    this.ui.store.focusHold(pull)
    if (act !== 'park') return this._urgeFocus()
    this._renderPark()
    $('#ffParkText').focus()
  }
  // 收起來之後焦點回到「想分心了？」；沒有那一顆（休息中、暫停了）就交給專注頁本身
  _urgeFocus() {
    const b = $('#ffUrgeBtn')
    ;(b.hidden ? $('#focusFull') : b).focus()
  }
  // 不算數了（暫停、到點、換了一輪）就清掉：專注頁縮小著也要清，下一輪不會一開始就是打開的
  _urgeSweep() {
    if (!this.urgeAt || this._urgeLive()) return
    this.urgeAt = 0
    this.urgePull = null
    this._urgeShut = Date.now()
  }
  _renderUrge() {
    this._urgeSweep()
    const box = $('#ffUrge')
    const on = !!this.urgeAt
    // 自己收起來的（到點、暫停）時焦點在裡面：接到看得到的地方，不會掉到看不見的地方
    const had = !on && !box.hidden && box.contains(document.activeElement)
    $('#focusFull').classList.toggle('urging', on)
    $('#ffUrgeBtn').hidden = on || !this._urgeCan()
    box.hidden = !on
    if (had) this._urgeFocus()
    if (!on) return
    const gone = Date.now() - this.urgeAt
    // 圓圈跟「吸氣」「吐氣」照同一個時間縮放（縮小專注頁再打開也對得上）；減少動態效果時不動
    if (!calmMotion()) {
      const s = 0.81 - 0.19 * Math.cos((2 * Math.PI * (gone % BREATH_MS)) / BREATH_MS)
      const ring = box.querySelector('.ff-urge-breath i')
      ring.style.transform = `scale(${s.toFixed(3)})`
      ring.style.opacity = (0.7 + (0.3 * (s - 0.62)) / 0.38).toFixed(3)
    }
    const ask = gone >= URGE_MS
    // 一分鐘到了：輕輕響一聲，問還想不想去
    if (ask && !this._urgeAsked) {
      this._urgeAsked = true
      this.hooks.urgeAsk?.()
    }
    box.classList.toggle('ask', ask)
    setText($('#ffUrgeT'), ask ? '一分鐘過了' : '先等一分鐘')
    setText($('#ffUrgeP'), ask ? '還想去嗎？想去也沒關係，專注會繼續計時。' : '想去做別的事很正常。跟著圓圈呼吸，一分鐘後還想去，再去。')
    setText($('#ffUrgeLeft'), ask ? '' : `還有 ${Math.ceil((URGE_MS - gone) / 1000)} 秒`)
    setText($('#ffUrgeBreath'), ask ? '' : gone % BREATH_MS < BREATH_MS / 2 ? '吸氣' : '吐氣')
    setText($('#ffUrgeBack'), ask ? '回來做正事' : '算了，回來做')
    const alt = $('#ffUrgeAlt')
    setText(alt, ask ? '還是想去' : '寫下來，等等再做')
    alt.dataset.urge = ask ? 'go' : 'park'
    pickOne($$('#ffUrgePulls [data-pull]'), (b) => b.dataset.pull === this.urgePull)
    // 點了想去做什麼：寫一件現在就做得到的小事（把手機翻過來、先記下來…）
    const tip = pullOf(this.urgePull)?.now || ''
    setText($('#ffUrgeTip'), tip)
    $('#ffUrgeTip').hidden = !tip
  }

  // ── 背景聲：專注時放雨聲、褐噪音、粉紅噪音蓋掉周圍的聲音（src/audio.js 的 noise）。
  // 計時設定裡、專注頁右上的耳機都可以選；只在專注中、沒暫停、音效開著時放，休息、暫停、結束時淡出 ──
  _bindNoise() {
    for (const seg of $$('.noise-seg')) {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-noise]')
        if (b) this._setNoise('focusNoise', b.dataset.noise)
      })
    }
    for (const r of $$('[data-noise-vol]')) {
      // 拖的時候音量跟著變，放開才存（不用每一格都存一次）。沒等到放開就離開了（change 沒來）：離開時照拖到的存
      r.addEventListener('input', () => {
        this._volDraft = +r.value
        this._noiseSync()
      })
      r.addEventListener('change', () => {
        this._volDraft = null
        this._setNoise('noiseVol', +r.value)
      })
      r.addEventListener('blur', () => {
        if (this._volDraft == null) return
        this._volDraft = null
        this._setNoise('noiseVol', +r.value)
      })
    }
    $('#ffNoiseBtn').onclick = () => this.noisePanel()
    addEventListener('pointerdown', (e) => {
      if (!$('#ffNoise').hidden && !e.target.closest('#ffNoise, #ffNoiseBtn')) this.noisePanel(false)
    })
  }
  _setNoise(key, v) {
    if (this.ui.store.state.settings[key] !== v) this.ui.store.setSetting(key, v)
    this._noiseSync()
  }
  // 專注頁右上的背景聲選單。回傳有沒有收起來（Esc 先收它，再收專注頁）。
  // refocus：收起來時焦點在裡面的話交回耳機（專注頁整個收起來時不用）
  noisePanel(force, refocus = true) {
    const el = $('#ffNoise')
    const open = force ?? el.hidden
    if (!open && el.hidden) return false
    const had = el.contains(document.activeElement)
    el.hidden = !open
    $('#ffNoiseBtn').setAttribute('aria-expanded', String(open))
    if (open) {
      this._renderNoise()
      ;(el.querySelector('.noise-seg .on') || el.querySelector('[data-noise]')).focus()
    } else if (had && refocus) $('#ffNoiseBtn').focus()
    return true
  }
  _renderNoise() {
    const st = this.ui.store.state.settings
    const kind = NOISES.includes(st.focusNoise) ? st.focusNoise : 'off'
    const mute = st.sound === false
    pickOne($$('.noise-seg [data-noise]'), (b) => b.dataset.noise === kind)
    for (const r of $$('[data-noise-vol]')) {
      // 正在拖的時候不動它（放開時照拖到的存）；只是焦點停在上面的照樣跟著設定走（別的分頁改了音量，下一次按方向鍵才從新的接著調）
      if (this._volDraft == null) r.value = st.noiseVol
      r.closest('.noise-vol').hidden = kind === 'off'
    }
    const hint = mute ? '音效關著，聽不到背景聲：打開音效才會放' : kind === 'off' ? '專注時放一點聲音，蓋掉周圍的雜音' : `專注時放${NOISE_NAMES[kind]}，休息、暫停時會停`
    for (const p of $$('.noise-hint')) setText(p, hint)
    // 計時設定裡只在選了、音效卻關著時說一聲（平常不多佔一行）
    $('.fs-noise-hint').hidden = !mute || kind === 'off'
    const btn = $('#ffNoiseBtn')
    btn.classList.toggle('on', kind !== 'off' && !mute)
    const label = kind === 'off' ? '背景聲：關' : `背景聲：${NOISE_NAMES[kind]}${mute ? '（音效關著）' : ''}`
    btn.title = label
    btn.setAttribute('aria-label', label)
  }
  // 每次重畫都對一次：設定（另一個分頁改的也算）、計時的狀態變了才換。拖著音量時照拖到的大小
  _noiseSync() {
    const st = this.ui.store.state.settings
    const set = NOISES.includes(st.focusNoise) ? st.focusNoise : 'off'
    const look = `${set}:${st.noiseVol}:${st.sound !== false}`
    if (look !== this._noiseLook) {
      this._noiseLook = look
      this._renderNoise()
    }
    const kind = this.mode === 'focus' && this.paused == null && st.sound !== false ? set : 'off'
    const vol = this._volDraft ?? st.noiseVol
    const key = `${kind}:${vol}`
    if (key === this._noiseKey) return
    this._noiseKey = key
    this.hooks.noise?.(kind, vol)
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
    $('#focusSet h4').firstChild.textContent = !live ? '要怎麼專注？' : this.mode === 'break' ? '休息中' : '計時中・換個目標'
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
    $('#fsGoalRow').hidden = live
    $('#fsStart').hidden = live
    $('#fsSmall').hidden = live
    // 專注中：腦中冒出別的事，在這裡先記下來
    $('#fsPark').hidden = !(this.mode === 'focus' && !this._asking)
    // 這一件的下一步（休息時：等等從這裡開始、休息前留一步）：跟專注頁的那一行一樣
    this._renderStep()
    this._renderMore($('#fsExtend'), $('#fsAddRound'))
    if (!live) $('#fsMore').hidden = true
    this._noiseSync()
    pickOne($$('#fsRounds button'), (b) => +b.dataset.v === st.focusRounds)
    pickOne($$('#fsBreak button'), (b) => +b.dataset.v === st.breakMin)
    pickOne($$('#fsGoal button'), (b) => +b.dataset.v === (st.focusGoal || 0))
    const target = this.project ? `，時間記進「${this.project.name}」` : ''
    const small = this.small ? `只做 ${this.focusMin} 分鐘，到點時再決定要不要繼續。` : ''
    $('#fsSum').textContent = live
      ? this.mode === 'break'
        ? this.round < this.rounds
          ? `休息完接著第 ${this.round + 1}/${this.rounds} 輪`
          : this.small ? '開了頭就做到了。想接著做就按「繼續做下去」，不然就好好休息' : '休息完就結束了。還沒做完可以延長，想繼續可以再加一輪'
        : this.ext ? '加時中：做完按 ■，多做的分鐘會記進去' : `${small}換了目標，這一輪的時間就算在新的目標上${target}`
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

  // 只做 5 分鐘：提不起勁時最難的是開始。不照設定的長度和輪數，先倒數 5 分鐘（設定不動）；
  // 到點時問要不要接著做下去（加時：從到點那一刻往上數），不想就照常休息。已經在專注：只換目標
  startSmall(taskId = this.taskId, projectId = taskId ? null : this.projectId) {
    if (this.mode === 'focus') return this.startWith(taskId || null, projectId || null)
    this.taskId = taskId || null
    this.projectId = this.taskId ? null : projectId || null
    // 休息中：結束休息，現在開始
    this.mode = 'idle'
    this._loadLengths()
    Object.assign(this, { up: false, focusMin: debugMin || SMALL_MIN, rounds: 1, small: true })
    this.ui.toggleFull(false)
    this._startFocus()
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
    // 這一輪中途離開了幾次（新的一輪從 0 開始；延長是同一輪，接著算）
    this.away = 0
    if (!this.task) this.taskId = null
    if (this.taskId || !this.project) this.projectId = null
    this.togglePicker(false)
    this.toggleSet(false)
    this._save()
    this.render()
    this.ui.tuckDock?.(false)
    this.hooks.focusStarted(false, this.taskId, this.info)
    if (this.ui.appMode) this.toggleBig(true)
  }

  // App 模式：專注時整個畫面是一個大計時器（縮小後計時繼續，點右下的時間再打開）
  toggleBig(force) {
    const open = (force ?? $('#focusFull').hidden) && this.mode !== 'idle'
    $('#focusFull').hidden = !open
    // 縮小回來：手機上往下捲時讓開的 Dock 膠囊先回來（剛縮小就要按得到計時器）；右上的背景聲選單也收起來
    // （暫停中的計時不會重畫，不能等重畫時才收）
    if (!open) {
      this.noisePanel(false, false)
      this.ui.tuckDock?.(false)
      return this._catSync()
    }
    // 專注頁蓋住整個畫面：開著的計時設定、目標選單先收起來（不然它們在後面還接著鍵盤，Tab 會跑到看不到的地方）
    this.toggleSet(false)
    this.togglePicker(false)
    this._fillTargets($('#ffTarget'))
    this.render()
  }

  // 專注頁開著（到點的提示卡就不用再放一次「延長」「再加一輪」，頁面上有）
  get bigOpen() {
    return !$('#focusFull').hidden
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
    // 手機橫放、很矮的視窗（版面跟 focus.css 最後那一段同一個條件）：卡片下面沒有地板，貓先不出來
    if (!open || LOW.matches) return this.cat.hide()
    if (!on) return this.cat.leave()
    const focusMs = this.mode === 'focus' ? (this.counting ? this.elapsed : this.total - this.left) : 0
    this.cat.show({ mode: this.mode, paused: this.paused != null, focusMs }, coatOfDay(this.ui.store.today))
  }

  // 一輪專注結束：記下分鐘數，接著休息。at：本來排好到點的時間（自己按「做完了」的沒有）
  _finishFocus(minutes, at = null) {
    const info = { ...this.info, last: this.round >= this.rounds, at, target: this.task?.title || this.project?.name || '' }
    this.toggleSet(false)
    const now = Date.now()
    Object.assign(this, clock.breakStart(this, now, at ?? now))
    this._save()
    this.hooks.focusFinished(minutes, this.task?.id || null, info)
    this.render()
  }

  // 還沒做完：休息先不休了，從剛才到點的時間接著往上數（加時）。做完按「做完了」，多做的分鐘記進去，
  // 再休息、照原本的輪數接下去
  get canExtend() {
    return clock.canExtend(this)
  }
  extend() {
    if (!this.canExtend) return false
    const was = this.sid
    Object.assign(this, clock.extendStart(this, Date.now()))
    this.sid = `-${Math.random().toString(36).slice(2, 10)}`
    // 延長是同一輪接著做：這一輪按過 × 不指定目標的，延長時也不再問「要專注這一件嗎？」
    if (this._noPick != null && this._noPick === was) this._noPick = this.sid
    this._asking = false
    this.togglePicker(false)
    this.toggleSet(false)
    this._save()
    this.render()
    this.hooks.focusStarted(false, this.task?.id || null, this.info)
    if (this.ui.appMode) this.toggleBig(true)
    return true
  }

  // 設定的輪數都做完了還想繼續：最後一輪的休息中再加一輪（休息完自動開始）
  get canAddRound() {
    return clock.canAddRound(this)
  }
  addRound() {
    if (!this.canAddRound) return false
    this.rounds = this.round + 1
    this._save()
    this.render()
    if (!$('#focusSet').hidden) this._renderSet()
    this.hooks.roundAdded?.({ next: this.rounds, rounds: this.rounds })
    return true
  }

  // 全部做完、休息也結束了：照剛才的長度和目標再來一輪（就一輪，不照設定的輪數從頭跑）
  again() {
    if (this.mode !== 'idle') return false
    this._loadLengths()
    if (this._last) Object.assign(this, this._last)
    this.rounds = 1
    this.ui.toggleFull(false)
    this._startFocus()
    return true
  }

  stop() {
    // 放太久才回來（頁面睡著時早就過了該結束的時間一小時以上）：跟自動檢查一樣不記，不因為手快按了「做完了」就照全長記
    if (this.mode !== 'idle' && this._stale()) return this._expire()
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
    if (this.mode === 'idle') return
    // 背景聲：設定在別處改了（另一個分頁、音效開關）也馬上跟著換（沒變就什麼都不做）
    this._noiseSync()
    if (this.paused != null) {
      // 暫停中計時停著，時間照走：專注頁開著時每秒照真的時間重寫「接下來」（會議開始了、結束了、日程改了）
      const sec = Math.floor(Date.now() / 1000)
      if (sec !== this._pausedSec && !$('#focusFull').hidden) {
        this._pausedSec = sec
        this._renderNext()
      }
      return
    }
    const step = clock.due(this, Date.now())
    if (step?.do === 'expire') return this._expire()
    // 這一段本來排好到點的時間：通知用它認「同一次到點」
    const at = step ? clock.nextEnd(this) : null
    if (step?.do === 'finishFocus') this._finishFocus(step.minutes, at)
    else if (step?.do === 'nextRound') {
      // 還有下一輪：休息完自動接著開始
      this.round++
      this.hooks.breakFinished({ next: this.round, rounds: this.rounds }, at)
      this._startFocus()
    } else if (step?.do === 'done') {
      this.toggleSet(false)
      // 記著剛才這一組的樣子：提示卡上的「再來一輪」照它開始（中途改了設定也一樣；只做 5 分鐘的也是再 5 分鐘）
      this._last = { up: this.up, focusMin: this.focusMin, breakMin: this.breakMin, small: !!this.small }
      this.mode = 'idle'
      this._loadLengths()
      this._save()
      this.hooks.breakFinished(null, at)
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
    if (this.mode !== 'idle' && !$('#focusSet').hidden) {
      $('#fsTime').textContent = time
      if (!this._asking) this._renderMore($('#fsExtend'), $('#fsAddRound'))
      // 下一步那一行：到點進入休息、下一輪開始時跟著換說法
      this._renderStep()
    }
    $('#focusTime').textContent = time
    $('#focusTime').title = this.mode === 'idle' ? '倒數或正向計時、長度、目標' : this.ui.appMode ? '打開全螢幕計時' : '換專注的目標'
    const box = $('#focusBox')
    box.classList.toggle('running', this.mode === 'focus')
    box.classList.toggle('break', this.mode === 'break')
    box.classList.toggle('idle', this.mode === 'idle')
    const multi = this.rounds > 1
    const label = {
      idle: this.up ? '正向計時 · ↑' : multi ? `${this.focusMin} 分 × ${this.rounds} 輪` : '專注 · しゅうちゅう',
      focus: this.ext ? (multi ? `加時中 · ${this.round}/${this.rounds}` : this.small ? '接著做下去' : '加時中') : multi ? `專注中 · ${this.round}/${this.rounds}` : this.up ? '正向計時中' : this.small ? `只做 ${this.focusMin} 分鐘` : '專注中',
      break: multi && this.round < this.rounds ? `休息 · 下一輪 ${this.round + 1}/${this.rounds}` : '休息 · きゅうけい',
    }[this.mode]
    const t = this.targetText
    $('#focusLabel').textContent = this.paused != null ? '暫停中' : t && this.mode !== 'break' ? t : label
    $('#focusLabel').classList.toggle('set', !!t && this.mode !== 'break')
    $('#focusIcon').innerHTML = this.mode !== 'idle' && this.paused == null ? ICON.pause : ICON.play
    $('#focusStop').hidden = this.mode === 'idle'
    $('#focusStop').title = counting ? (this.ext ? '做完了（多做的分鐘會記下來）' : `做完了（滿 ${FREE_MIN} 分鐘會記下來）`) : '結束'
    $('#focusBtn').title = this.mode === 'idle' ? '開始專注 (F)' : this.paused != null ? '繼續' : '暫停'
    // 往上數時，圓環每一小時繞一圈
    const frac = this.mode === 'idle' ? 0 : counting ? (this.elapsed % 3600000) / 3600000 : 1 - this.left / this.total
    $('#focusArc').style.strokeDashoffset = 119.4 * (1 - frac)
    document.title = this.mode === 'idle' ? 'ひより日和 · 日程小島' : `${time} ${this.mode === 'focus' ? '專注中' : '休息中'} · ひより`
    this._renderBig(time, frac, label)
    this._noiseSync()
  }

  _renderBig(time, frac, label) {
    const el = $('#focusFull')
    this._urgeSweep()
    if (this.mode === 'idle') el.hidden = true
    this._catSync()
    if (el.hidden) {
      this._bigMode = null
      // 專注頁收起來了：右上的背景聲選單也收起來（下次打開時不會一開始就是打開的）
      if (!$('#ffNoise').hidden) this.noisePanel(false)
      return
    }
    const paused = this.paused != null
    const brk = this.mode === 'break'
    // 整頁的顏色跟著狀態：專注、休息、加時；暫停時靜下來
    el.classList.toggle('break', brk)
    el.classList.toggle('ext', !!this.ext && !brk)
    el.classList.toggle('paused', paused)
    // 一輪專注剛結束、進到休息的那一下：圓環往外散開一圈
    if (brk && this._bigMode === 'focus') {
      const ring = $('#ffRing')
      ring.classList.remove('ripple')
      void ring.offsetWidth
      ring.classList.add('ripple')
    }
    this._bigMode = this.mode
    $('#ffKicker').textContent = paused ? '暫停中' : label
    this._digits($('#ffTime'), time)
    $('#ffArc').style.strokeDashoffset = ARC * (1 - frac)
    $('#ffKnob').style.setProperty('--p', frac.toFixed(4))
    // 第幾輪：做完的實心、這一輪亮著、還沒到的空心（只有一輪就不畫）
    const dot = (i) => (i < this.round || (brk && i === this.round) ? 'done' : i === this.round ? 'now' : '')
    const dots = $('#ffRounds')
    put(dots, this.rounds > 1 ? Array.from({ length: this.rounds }, (_, i) => `<i class="${dot(i + 1)}"></i>`).join('') : '')
    dots.hidden = this.rounds <= 1
    put($('#ffSub'), this._subLine())
    // 今天已經專注了多久（一輪做完才會變）；設了每天的目標的話寫著目標和一條小進度條，達成了換一句。
    // 上面左右各有兩顆按鈕，手機上只剩一小段：寫短一點（很窄的畫面連「目標」兩個字也收起來）
    const mins = this.ui.store.peekDay(this.ui.store.today).focus || 0
    const goal = this.ui.store.state.settings.focusGoal || 0
    const h = Math.floor(mins / 60)
    const done = [h ? `<b>${h}</b> 小時` : '', mins % 60 ? `<b>${mins % 60}</b> 分` : ''].filter(Boolean).join(' ') || '<b>0</b> 分'
    const bar = `<i class="ff-goal" aria-hidden="true"><b style="width:${Math.min(100, Math.round((mins / (goal || 1)) * 100))}%"></b></i>`
    const today = $('#ffToday')
    put(
      today,
      !goal ? (mins ? `今天已專注 ${done}` : '') : mins >= goal ? `目標達成・今天 ${done}${bar}` : `今天 ${done}／<span class="ff-goal-w">目標 </span>${goalText(goal)}${bar}`,
    )
    today.hidden = !mins && !goal
    today.classList.toggle('has-goal', !!goal)
    today.classList.toggle('goal-done', !!goal && mins >= goal)
    // 專注中可以直接在這裡換目標；休息時寫一句話
    $('#ffTask').hidden = !brk
    $('#ffTask').textContent = this.round >= this.rounds && this.rounds > 1 ? '這一組做完了，起來動一動、喝口水' : '起來動一動、喝口水'
    const sel = $('#ffTarget')
    // 沒選目標、正在建議現在該做的那一件：選單先讓位給那一行（_pickTask）
    $('#ffTargetWrap').hidden = brk || !!this._pickTask()
    // 選單在打開全螢幕時填好；目標從別的地方換了才重填（正在選的時候不動它）
    if (!brk && document.activeElement !== sel && sel.value !== this._targetKey()) this._fillTargets(sel)
    // 目標前面的點：任務分類或專案的顏色（沒指定是灰的）
    const color = this.task ? tagOf(this.task.tag).color : this.project ? PROJECT_COLORS[this.project.color % PROJECT_COLORS.length] : ''
    if (color !== this._bigColor) {
      this._bigColor = color
      $('#ffTargetDot').style.cssText = color ? `--c:${color}` : ''
    }
    $('#ffToggleText').textContent = paused ? '繼續' : '暫停'
    put($('#ffToggleIcon'), paused ? ICON.play : ICON.pause)
    $('#ffStop').textContent = this.counting ? '做完了' : brk ? '跳過休息' : '結束'
    $('#ffCabin').hidden = this.mode !== 'focus'
    this._renderMore($('#ffExtend'), $('#ffAddRound'))
    this._renderPark()
    this._renderStep()
    this._renderUrge()
    this._renderNext()
  }

  // ── 接下來：今天下一個有時段的日程（專心時很容易忘了等一下要開會）──
  // 這一輪幾點結束（分鐘，跨午夜照樣往上加）：倒數中、沒暫停的專注才算；休息、往上數的是 null
  nextUp(now = Date.now()) {
    const s = this.ui.store
    const d = new Date(now)
    const nowMin = d.getHours() * 60 + d.getMinutes()
    // 結束時間帶著秒數算、不取整：10:00:30 開始的 25 分鐘結束在 10:25:30，會撞到 10:25 的會議（取整的話每過半分鐘就變一次）
    const end = this.mode === 'focus' && !this.counting && this.paused == null && this.endAt > now ? nowMin + (d.getSeconds() * 1000 + d.getMilliseconds() + this.endAt - now) / 60000 : null
    return nextEvent(s.eventsOn(s.today), nowMin, end)
  }
  // 進行中的、這一輪結束前就要開始的一定寫（會撞到的寫「記得提早收尾」），其他的 2 小時內才寫（planner.js 的 nextEvent）
  _renderNext() {
    const el = $('#ffNext')
    const n = this.mode === 'idle' ? null : this.nextUp()
    let html = ''
    if (n) {
      const e = n.event
      const name = esc(clip(String(e.title || '')))
      if (n.now) html = `<small>進行中</small><b>${name}</b><small>到 ${e.end}</small>`
      else if (n.clash) html = `<small>這一輪結束前</small><b>${e.start} ${name}</b><small>還有 ${span(n.until)}，記得提早收尾</small>`
      else html = `<small>接下來</small><b>${e.start} ${name}</b><small>還有 ${span(n.until)}</small>`
    }
    el.hidden = !html
    el.classList.toggle('clash', !!n?.clash)
    put(el, html)
  }

  // 時間下面的一行小字：幾點結束、休息完接著什麼
  _subLine() {
    if (this.paused != null) return '計時停在這裡'
    const at = clock.nextEnd(this)
    if (this.mode === 'break') return this.round < this.rounds ? `<b>${hhmm(at)}</b> 接著第 ${this.round + 1} 輪` : `休息到 <b>${hhmm(at)}</b>`
    if (this.ext) return this.small ? `${this.focusMin} 分鐘做到了，做完就按「做完了」` : `原定的 ${this.focusMin} 分做完了`
    // 正向計時：不寫「幾點開始」（暫停過的話，記著的起點會往後挪，不是真的開始的時間）
    if (this.counting) return this.elapsed < FREE_MIN * 60000 ? `滿 ${FREE_MIN} 分鐘就會記下來` : '做完了就按「做完了」'
    return this.small ? `<b>${hhmm(at)}</b> 結束，到時再決定要不要繼續` : `<b>${hhmm(at)}</b> 結束`
  }

  // 時間拆成一格一格（每格一樣寬，秒數跳動時整串不會左右晃）：只換有變的那幾格，換上來的輕輕浮現
  _digits(el, text) {
    if (el._text === text) return
    const old = el._text || ''
    el._text = text
    if (old.length !== text.length || el.children.length !== text.length) {
      el.innerHTML = [...text].map((ch) => `<span${ch === ':' ? ' class="c"' : ''}>${ch}</span>`).join('')
      el.classList.toggle('long', text.length > 5)
      return
    }
    ;[...text].forEach((ch, i) => {
      if (ch === old[i]) return
      const s = document.createElement('span')
      s.className = 'in'
      s.textContent = ch
      el.children[i].replaceWith(s)
    })
  }

  // 休息時的兩顆按鈕：「還沒做完，延長」和（最後一輪）「再加一輪」。全螢幕計時和點時間打開的小視窗各有一組
  _renderMore(ext, add) {
    const canExt = this.canExtend
    const canAdd = this.canAddRound
    ext.hidden = !canExt
    add.hidden = !canAdd
    ext.parentElement.hidden = !canExt && !canAdd
    if (canExt) {
      // 從到點那時接著算：寫出已經過了多久，按之前就知道會從哪裡開始
      const now = Date.now()
      const over = now - clock.extendStart(this, now).endAt
      // 只做 5 分鐘到點了：問的是要不要接著做下去
      const word = this.small ? '繼續做下去' : '還沒做完，延長'
      put(ext, over >= 60000 ? `${word}<small>已經多做 ${Math.floor(over / 60000)} 分</small>` : word)
      ext.title = '休息先不休了：從剛才到點的時間接著往上數，做完按「做完了」，多做的分鐘會記進去'
    }
    if (canAdd) add.title = `休息完再接一輪 ${this.focusMin} 分鐘`
  }
}
