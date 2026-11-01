import { TAGS, tagOf, PRIORITIES, EVENT_COLORS, PROJECT_COLORS, UNLOCKS, WEEK_JP, WEEK_ZH, FOCUS_MIN, BREAK_MIN, MAX_PROJECTS, TOWER_SLOTS, MOODS, moodOf, MAX_STARS, XP, CHARM } from './theme.js'
import { dateStr, addDays, parseDate, toMin, minToHHMM, repeatLabel, SEASON_ZH } from './store.js'
import { notifySupported } from './reminders.js'
import { parseQuick, describeQuick } from './parse.js'
import { SHOP_ITEMS } from './data/shop.js'
import { renderThumbnails } from './scene/placed.js'
import { renderFlowerThumbs } from './scene/garden.js'
import { FLOWERS, RARITIES, RARITY_ORDER, flowerOf } from './data/flowers.js'
import { BOND_LEVELS, BOND_ACTS, OUTFITS, outfitLevel, outfitOf } from './data/bond.js'
import { LINES, FUJI_LINES } from './data/lines.js'
import { ACHIEVEMENTS } from './data/achievements.js'
import { BUILDINGS, RESIDENTS, MAX_STAGE, MOVE_IN } from './data/town.js'
import { MAX_TOWN_LEVEL, TOWN_POINTS, lotsAt } from './data/projectTown.js'
import { LEVEL_TITLES } from './data/lines.js'
import { $, $$, esc, ICON, armConfirm } from './ui/dom.js'
import { lookHour, nightAt, realHour, systemDark } from './daylight.js'
import { ScheduleView } from './ui/schedule.js'
import { HabitsView } from './ui/habits.js'
import { LifeView } from './ui/life.js'
import { CalendarView } from './ui/calendar.js'
import { CloudView } from './ui/cloud.js'
import { readBackup, restoreBackup } from './sync.js'

const TAB_ORDER = ['tasks', 'schedule', 'habits', 'projects', 'records']
// 手機直式時面板是下半部的抽屜；橫向手機高度太矮，改回側邊面板（和 styles.css 的媒體查詢同步）
export const SIDE_PHONE = '(max-width: 860px) and (max-height: 500px) and (orientation: landscape)'
export const sheetLayout = () => matchMedia('(max-width: 860px)').matches && !matchMedia(SIDE_PHONE).matches
const THEME_INFO = {
  auto: '跟著真實時間，傍晚會自然變成夜晚',
  system: '跟著電腦或手機的深色模式',
  day: '一直是白天，島上維持明亮',
  night: '一直是夜晚，星星、燈籠和螢火蟲都會出來',
}
const QUALITY_INFO = {
  auto: '電腦用高畫質，手機用標準，比較省電',
  high: '反鋸齒、白天也有柔光，畫面最細緻',
  standard: '關掉反鋸齒和白天柔光，手機不容易發燙',
}

export const levelTitle = (lv) => LEVEL_TITLES[Math.min(lv, LEVEL_TITLES.length) - 1] || LEVEL_TITLES[0]
const hhmm = (ts) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)

// 把元素就地換成輸入框
function inlineEdit(el, value, onSave) {
  const input = document.createElement('input')
  input.className = 'inline-input'
  input.value = value
  input.maxLength = 60
  el.replaceChildren(input)
  input.focus()
  input.select()
  let done = false
  const finish = (save) => {
    if (done) return
    done = true
    if (save && input.value.trim() && input.value.trim() !== value) onSave(input.value.trim())
    else onSave(null)
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    if (e.key === 'Escape') finish(false)
    e.stopPropagation()
  })
  input.addEventListener('blur', () => finish(true))
}

export class UI {
  constructor(store, hooks) {
    this.store = store
    this.hooks = hooks
    this.tab = 'tasks'
    this.priority = 2
    this.tag = 'work'
    this.eventColor = 0
    this.projectColor = 0
    this.hlKey = null
    this._initStatic()
    this._bindTasks()
    this._bindSchedule()
    this._bindProjects()
    this._bindRecords()
    this._bindChrome()
    this.focus = new FocusTimer(this, hooks)
    // 時段安排、習慣、生活記錄、日曆：各自是一個模組，透過 viewHooks 和外面溝通
    const viewHooks = {
      toast: (o) => this.toast(o),
      selectDate: (date) => this.store.selectDate(date),
      setTab: (tab) => this.setTab(tab),
      openEdit: (type, id) => this.schedule.openEdit(type, id),
      openReview: (date) => this.openReview(date),
      openCalendar: (date) => this.calendar.open(date),
      closeCalendar: () => this.calendar.close(),
      focusEvent: (id) => hooks.focusEvent(id),
      hoverEvent: (id) => hooks.hoverEvent(id),
    }
    this.schedule = new ScheduleView(store, viewHooks)
    this.habits = new HabitsView($('#habitsRoot'), store, viewHooks)
    this.life = new LifeView($('#lifeRoot'), store, viewHooks)
    this.calendar = new CalendarView($('#calendar'), store, viewHooks)
    // 開發與截圖用：?tab=habits、?calendar
    const q = new URLSearchParams(location.search)
    if (TAB_ORDER.includes(q.get('tab'))) this.setTab(q.get('tab'))
    if (q.has('calendar')) this.calendar.open()
  }

  // ── 靜態元件 ──
  _initStatic() {
    $('#taskTag').innerHTML = TAGS.map((t) => `<button type="button" data-tag="${t.id}" style="--c:${t.color}"><i></i>${t.label}</button>`).join('')
    $('#eventColor').innerHTML = EVENT_COLORS.map((c, i) => `<button type="button" data-i="${i}" style="--c:${c}" aria-label="顏色 ${i + 1}"></button>`).join('')
    $('#projectColor').innerHTML = PROJECT_COLORS.map((c, i) => `<button type="button" data-i="${i}" style="--c:${c}" aria-label="顏色 ${i + 1}"></button>`).join('')
    this._syncPickers()
  }

  _syncPickers() {
    $$('#taskPriority button').forEach((b) => b.classList.toggle('on', +b.dataset.v === this.priority))
    $$('#taskTag button').forEach((b) => b.classList.toggle('on', b.dataset.tag === this.tag))
    $$('#eventColor button').forEach((b) => b.classList.toggle('on', +b.dataset.i === this.eventColor))
    $$('#projectColor button').forEach((b) => b.classList.toggle('on', +b.dataset.i === this.projectColor))
  }

  _bindChrome() {
    $$('.tab').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.tab)))
    $('#prevDay').onclick = () => this.store.selectDate(addDays(this.store.selectedDate, -1))
    $('#nextDay').onclick = () => this.store.selectDate(addDays(this.store.selectedDate, 1))
    $('#todayBtn').onclick = () => this.store.selectDate(this.store.today)
    $('#viewBtn').onclick = () => {
      this.toggleFull(false)
      this.hooks.resetView()
    }
    $('#soundBtn').onclick = () => {
      const on = !this.store.state.settings.sound
      this.store.setSetting('sound', on)
      this.hooks.setSound(on)
      this.renderChrome()
    }
    $('#panelBtn').onclick = () => this.togglePanel()
    $('#fullBtn').onclick = () => this.toggleFull()
    this.toggleFull(false)
    $('#themeBtn').onclick = () => this.toggleTheme()
    this.renderTheme()
    $('#calBtn').onclick = () => this.calendar.toggle()
    $('#dateMain').onclick = () => this.calendar.open()
    $('#dateMain').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.calendar.open()
      }
    }
    $('#shopBtn').onclick = () => this.toggleShop()
    $('#shopClose').onclick = () => this.toggleShop(false)
    $('#shopGrid').addEventListener('click', (e) => {
      if (e.target.closest('[data-charm]:not(:disabled)')) return this.store.buyCharm()
      const b = e.target.closest('[data-key]')
      if (!b || b.disabled) return
      this.toggleShop(false)
      this.hooks.startPlacing(b.dataset.key)
    })
    for (const el of [$('#questList'), $('#questMini')]) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]')
        if (b) this.store.claimQuest(b.dataset.q)
        if (e.target.closest('[data-weekly]')) this.store.claimWeekly()
      })
    }
    $('#modalClose').onclick = () => this.closeModal()
    $('#levelModal').addEventListener('click', (e) => {
      if (e.target.id === 'levelModal') this.closeModal()
    })
    this._bindFold()
    this._bindSheet()

    addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)
      if (e.key === 'Escape') {
        // 一次關一層：日曆上面還開著對話框（編輯、回顧…）時，只關對話框
        const modal = $$('.modal').some((m) => !m.hidden)
        // 全螢幕面板在最底層：上面什麼都沒開、也不是在打字時才離開
        const covered = modal || typing || this.calendar.isOpen || !$('#shop').hidden
        this.toggleShop(false)
        this.closeModal()
        if (!modal) this.calendar.close()
        this.schedule.closeEdit()
        if (!$('#reviewModal').hidden) $('#reviewLater').click()
        this.closeWeekCard()
        if (typing) document.activeElement.blur()
        if (!covered) this.toggleFull(false)
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        this.setTab('tasks')
        $('#taskTitle').focus()
      } else if (e.key === 'e' || e.key === 'E') this.toggleFull()
      else if (e.key === 'd' || e.key === 'D') this.toggleTheme()
      // 回到全景是要看島，先離開全螢幕
      else if (e.key === 'v' || e.key === 'V') {
        this.toggleFull(false)
        this.hooks.resetView()
      } else if (e.key === 's' || e.key === 'S') this.toggleShop()
      else if (e.key === 'c' || e.key === 'C') this.calendar.toggle()
      else if (e.key === 'f' || e.key === 'F') this.focus.toggle()
      else if (e.key === 'ArrowLeft') $('#prevDay').click()
      else if (e.key === 'ArrowRight') $('#nextDay').click()
      else if (['1', '2', '3', '4', '5'].includes(e.key)) this.setTab(TAB_ORDER[+e.key - 1])
    })
  }

  setTab(tab) {
    this.tab = tab
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab))
    $$('.tab-page').forEach((p) => p.classList.toggle('active', p.dataset.page === tab))
    if ($('#panel').classList.contains('collapsed')) this.togglePanel(false)
    if (tab === 'records') this.renderRecords()
    if (tab === 'habits') this.habits.render()
    if (tab === 'schedule') this.schedule.render()
  }

  togglePanel(force) {
    const panel = $('#panel')
    const collapsed = force === undefined ? !panel.classList.contains('collapsed') : force
    if (collapsed) this.toggleFull(false)
    panel.classList.toggle('collapsed', collapsed)
    document.body.classList.toggle('panel-collapsed', collapsed)
  }

  // 手機直式：在分頁列上往上滑展開面板（收起 → 半開 → 全螢幕），往下滑收回
  _bindSheet() {
    const panel = $('#panel')
    const bar = $('#panel .tabs')
    let start = null
    let dragged = false
    bar.addEventListener('pointerdown', (e) => {
      if (!sheetLayout() || e.pointerType === 'mouse') return
      start = { x: e.clientX, y: e.clientY }
      dragged = false
    })
    bar.addEventListener('pointermove', (e) => {
      if (!start) return
      const dy = e.clientY - start.y
      if (!dragged && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(e.clientX - start.x)) {
        dragged = true
        panel.classList.add('dragging')
        bar.setPointerCapture(e.pointerId)
      }
      // 面板跟著手指動一點，放開時再決定停在哪一段
      if (dragged) panel.style.translate = `0 ${Math.max(-50, Math.min(80, dy * 0.6))}px`
    })
    const end = (e) => {
      if (!start) return
      const dy = e.clientY - start.y
      start = null
      if (!dragged) return
      panel.classList.remove('dragging')
      panel.style.translate = ''
      if (e.type === 'pointercancel' || Math.abs(dy) < 40) return
      const collapsed = panel.classList.contains('collapsed')
      const full = panel.classList.contains('full')
      if (dy < 0) collapsed ? this.togglePanel(false) : this.toggleFull(true)
      else full ? this.toggleFull(false) : this.togglePanel(true)
    }
    bar.addEventListener('pointerup', end)
    bar.addEventListener('pointercancel', end)
    // 滑完放開時，手指底下的分頁不算點到
    bar.addEventListener(
      'click',
      (e) => {
        if (!dragged) return
        dragged = false
        e.stopPropagation()
        e.preventDefault()
      },
      true,
    )
  }

  // 手機上新增表單平常只露出標題欄，點進去才展開優先度、重複、分類（styles.css 的 .add-form[data-fold]）
  _bindFold() {
    for (const form of $$('.add-form[data-fold]')) {
      const input = form.querySelector('input')
      const open = (on) => form.classList.toggle('open', on)
      form.addEventListener('focusin', () => open(true))
      form.addEventListener('pointerdown', () => open(true))
      // iOS 點按鈕不會拿到焦點，不能靠 focusout：點到表單以外、標題又是空的才收起
      document.addEventListener('pointerdown', (e) => {
        if (form.classList.contains('open') && !form.contains(e.target) && !input.value.trim()) open(false)
      })
    }
  }

  // 全螢幕編輯：面板蓋滿整個畫面，寬螢幕時內容排成左右兩欄
  toggleFull(force) {
    const panel = $('#panel')
    const full = force ?? !panel.classList.contains('full')
    if (full) {
      this.togglePanel(false)
      this.toggleShop(false)
    }
    panel.classList.toggle('full', full)
    document.body.classList.toggle('panel-full', full)
    const b = $('#fullBtn')
    b.innerHTML = full ? ICON.shrink : ICON.expand
    b.title = full ? '離開全螢幕 (E / Esc)' : '全螢幕編輯 (E)'
    b.setAttribute('aria-pressed', String(full))
  }

  // ── 白天／夜晚 ──
  // 這個外觀設定下，現在天空是不是夜晚
  _nightFor(theme) {
    const h = this.hooks.hourNow?.() ?? realHour()
    return nightAt(lookHour(((h % 24) + 24) % 24, theme, systemDark())) > 0.5
  }

  setTheme(theme) {
    this.store.setSetting('theme', theme)
    this.hooks.setTheme?.(theme)
    this.renderSettings()
    this.renderTheme()
  }

  // Dock 上的快速切換：換成和現在相反的；剛好等於依時間的結果，就回到依時間
  toggleTheme() {
    const night = !this._nightFor(this.store.state.settings.theme)
    const theme = this._nightFor('auto') === night ? 'auto' : night ? 'night' : 'day'
    this.setTheme(theme)
    const where = '想換回來，到「紀錄 → 設定 → 夜間模式」'
    if (theme === 'auto') this.toast({ icon: '時', title: '天色回到跟著時間走', sub: '傍晚會自然變成夜晚' })
    else this.toast({ icon: night ? '夜' : '晝', title: night ? '換成夜晚了' : '換成白天了', sub: where })
  }

  renderTheme() {
    const night = this._nightFor(this.store.state.settings.theme)
    const b = $('#themeBtn')
    b.classList.toggle('night', night)
    b.title = night ? '切換成白天 (D)' : '切換成夜晚 (D)'
  }

  // ── 任務 ──
  _renderQuickPreview() {
    const box = $('#quickPreview')
    const v = $('#taskTitle').value
    const p = v.trim() ? parseQuick(v, { today: this.store.today }) : null
    const chips = p ? describeQuick(p, this.store.today) : []
    if (p?.tag && p.kind === 'task') chips.push(tagOf(p.tag).label)
    box.hidden = !chips.length
    box.innerHTML = chips.map((c, i) => `<span class="${i === 0 && p.kind === 'event' ? 'kind' : ''}">${esc(c)}</span>`).join('')
  }

  _repeatValue(sel) {
    const v = $(sel).value
    if (v === 'none') return null
    if (v === 'weekly') return { type: 'weekly', days: [parseDate(this.store.selectedDate).getDay()] }
    return { type: v }
  }

  _renderRepeatOptions() {
    const wd = WEEK_ZH[parseDate(this.store.selectedDate).getDay()]
    for (const sel of [$('#taskRepeat'), $('#eventRepeat')]) {
      const v = sel.value || 'none'
      sel.innerHTML = `<option value="none">不重複</option><option value="daily">每天</option><option value="weekdays">平日</option><option value="weekly">每週${wd}</option>`
      sel.value = v
    }
  }

  renderRoutines() {
    const s = this.store
    for (const [kind, box] of [['task', $('#taskRoutines')], ['event', $('#eventRoutines')]]) {
      const list = s.state.routines.filter((r) => r.kind === kind)
      box.hidden = !list.length
      $('summary', box).textContent = `↻ 例行${kind === 'task' ? '任務' : '日程'} · ${list.length}`
      $('ul', box).innerHTML = list
        .map((r) => {
          const c = kind === 'task' ? tagOf(r.tag).color : EVENT_COLORS[r.color % EVENT_COLORS.length]
          const when = kind === 'event' ? ` ${esc(r.start)}–${esc(r.end)}` : ''
          return `<li data-rid="${esc(r.id)}" style="--rc:${c}"><span>${esc(r.title)}</span><small>${esc(repeatLabel(r.repeat))}${when}</small>
            <button class="mini" data-act="del-routine" title="停止這個例行公事">${ICON.del}</button></li>`
        })
        .join('')
    }
  }

  _bindTasks() {
    for (const sel of ['#taskRepeat', '#eventRepeat']) {
      $(sel).addEventListener('change', (e) => e.target.classList.toggle('on', e.target.value !== 'none'))
    }
    for (const box of ['#taskRoutines', '#eventRoutines']) {
      $(box).addEventListener('click', (e) => {
        const b = e.target.closest('[data-act="del-routine"]')
        if (!b) return
        const id = b.closest('li').dataset.rid
        armConfirm(b, ICON.check, () => {
          this.store.deleteRoutine(id)
          this.toast({ icon: '↻', title: '已停止這個例行公事', sub: '已完成的紀錄會保留' })
        })
      })
    }
    $('#taskPriority').addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b) return
      this.priority = +b.dataset.v
      this._syncPickers()
    })
    $('#taskTag').addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b) return
      this.tag = b.dataset.tag
      this._syncPickers()
    })
    $('#taskTitle').addEventListener('input', () => this._renderQuickPreview())
    $('#taskForm').addEventListener('submit', (e) => {
      e.preventDefault()
      const input = $('#taskTitle')
      const s = this.store
      const p = parseQuick(input.value, { today: s.today })
      if (!p.title) {
        input.focus()
        return
      }
      const date = p.date || s.selectedDate
      const repeat = p.repeat || this._repeatValue('#taskRepeat')
      const md = date.slice(5).replace('-', '/')
      if (p.kind === 'event') {
        const ev = { title: p.title, start: p.start, end: p.end, color: this.eventColor, date }
        if (repeat) s.addRoutine({ kind: 'event', ...ev, repeat })
        else s.addEvent(ev)
        this.eventColor = (this.eventColor + 1) % EVENT_COLORS.length
        this._syncPickers()
        this.toast({ icon: '環', title: '已加入日程', sub: `${p.title}・${md} ${p.start}–${p.end}` })
      } else {
        const t = { title: p.title, priority: p.priority || this.priority, tag: p.tag || this.tag, date, dur: p.dur }
        if (repeat) s.addRoutine({ kind: 'task', ...t, repeat })
        else {
          const added = s.addTask(t)
          if (added && p.star) s.toggleStar(added.id)
        }
        if (date !== s.selectedDate) this.toast({ icon: '種', title: `已種在 ${md}`, sub: p.title })
      }
      $('#taskRepeat').value = 'none'
      $('#taskRepeat').classList.remove('on')
      input.value = ''
      this._renderQuickPreview()
      input.focus()
    })

    const onList = (e) => {
      const li = e.target.closest('.item')
      if (!li) return
      const id = li.dataset.id
      const act = e.target.closest('[data-act]')?.dataset.act
      const s = this.store
      if (act === 'toggle') s.toggleTask(id)
      else if (act === 'star') s.toggleStar(id)
      else if (act === 'delete') armConfirm(e.target.closest('button'), ICON.check, () => s.deleteTask(id))
      else if (act === 'edit') {
        const t = s.state.tasks.find((x) => x.id === id)
        inlineEdit($('.item-title', li), t.title, (v) => (v ? s.updateTask(id, { title: v }) : this.renderTasks()))
      } else if (act === 'pri') {
        const t = s.state.tasks.find((x) => x.id === id)
        s.updateTask(id, { priority: (t.priority % 3) + 1 })
      } else if (act === 'tag') {
        const t = s.state.tasks.find((x) => x.id === id)
        const i = TAGS.findIndex((x) => x.id === t.tag)
        s.updateTask(id, { tag: TAGS[(i + 1) % TAGS.length].id })
      } else if (act === 'today') s.moveToToday([id])
      else if (act === 'focus') this.focus.startWith(id)
      else if (!act && !e.target.closest('input')) this.hooks.focusTask(id)
    }
    $('#taskList').addEventListener('click', onList)
    $('#overdueBox').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="allToday"]')) {
        this.store.moveToToday(this.store.overdue().map((t) => t.id))
        return
      }
      onList(e)
    })
    for (const el of [$('#taskList'), $('#overdueBox')]) {
      el.addEventListener('mouseover', (e) => {
        const li = e.target.closest('.item')
        this.hooks.hoverTask(li ? li.dataset.id : null)
      })
      el.addEventListener('mouseleave', () => this.hooks.hoverTask(null))
    }
  }

  _taskItem(t, overdue = false) {
    const tag = tagOf(t.tag)
    const pri = PRIORITIES[t.priority] || PRIORITIES[2]
    const meta = [
      `<button class="pri pri-${t.priority}" data-act="pri" title="點一下切換優先度">${'◆'.repeat(t.priority)}${'◇'.repeat(3 - t.priority)} ${pri.label}</button>`,
      `<button data-act="tag" title="點一下切換分類">${tag.label}</button>`,
    ]
    if (t.star) meta.unshift(`<button class="star on" data-act="star" ${t.done ? 'disabled title="本命・已完成"' : 'title="取消本命"'}>★ 本命</button>`)
    else if (!t.done && t.date >= this.store.today) meta.unshift(`<button class="star" data-act="star" title="設為本命：完成給雙倍 XP（每天最多 ${MAX_STARS} 件）">☆</button>`)
    if (t.pomos) meta.push(`<span class="pomo" title="已專注 ${t.pomos} 輪">◷ ${t.pomos}</span>`)
    const rt = this.store.routineOf(t)
    if (rt) meta.push(`<span class="rep">↻ ${esc(repeatLabel(rt.repeat))}</span>`)
    if (t.done && t.doneAt) meta.push(`<span>${hhmm(t.doneAt)} 綻放</span>`)
    if (overdue) meta.push(`<span>${esc(t.date.slice(5).replace('-', '/'))}</span>`)
    return `<li class="item ${t.done ? 'done' : ''} ${t.star ? 'starred' : ''} ${this.hlKey === 'task:' + t.id ? 'hl' : ''}" data-id="${esc(t.id)}" style="--c:${tag.color}">
      <button class="check" data-act="toggle" aria-label="完成">${ICON.check}</button>
      <div class="item-main">
        <div class="item-title">${esc(t.title)}</div>
        <div class="item-meta">${meta.join('')}</div>
      </div>
      <div class="item-actions">
        ${overdue ? `<button class="mini" data-act="today" title="移到今天">${ICON.today}</button>` : ''}
        ${!t.done && !overdue && t.date === this.store.today ? `<button class="mini" data-act="focus" title="專注在這件事上">${ICON.play}</button>` : ''}
        <button class="mini" data-act="edit" title="編輯">${ICON.edit}</button>
        <button class="mini" data-act="delete" title="刪除">${ICON.del}</button>
      </div>
    </li>`
  }

  renderTasks() {
    const s = this.store
    const tasks = s.tasksOn(s.selectedDate)
    const todo = tasks.filter((t) => !t.done).sort((a, b) => b.star - a.star || b.priority - a.priority || a.createdAt - b.createdAt)
    const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
    const n = tasks.length
    const k = done.length
    const pct = n ? Math.round((k / n) * 100) : 0
    $('#bloomPct').textContent = pct + '%'
    $('#bloomArc').style.strokeDashoffset = 100.5 * (1 - pct / 100)
    const isToday = s.selectedDate === s.today
    const label = isToday ? '今天' : s.selectedDate > s.today ? '這天' : '那天'
    if (!n) {
      $('#bloomTitle').textContent = `${label}還沒有花苞`
      $('#bloomSub').textContent = '種下第一個任務吧'
    } else if (k === n) {
      $('#bloomTitle').textContent = '全部綻放了！'
      $('#bloomSub').textContent = 'おつかれさま，辛苦了'
    } else {
      $('#bloomTitle').textContent = `${k} / ${n} 朵花已綻放`
      $('#bloomSub').textContent = `還有 ${n - k} 個花苞等著你`
    }
    this._renderStarBar(tasks)
    $('#taskTitle').placeholder = isToday ? '種下任務，或打「明天 15:00 開會 #工作」' : `為 ${s.selectedDate.slice(5).replace('-', '/')} 種下任務…`

    const overdue = isToday ? s.overdue() : []
    $('#overdueBox').innerHTML = overdue.length
      ? `<div class="overdue"><h4><span>還沒完成的昨日花苞 · ${overdue.length}</span><button data-act="allToday">全部移到今天</button></h4><ul class="list">${overdue.map((t) => this._taskItem(t, true)).join('')}</ul></div>`
      : ''

    $('#taskList').innerHTML = n
      ? [...todo, ...done].map((t) => this._taskItem(t)).join('')
      : `<li class="empty"><span class="em">ひとつめの種を</span>輸入任務並按 Enter，花圃就會長出一株花苞。<br>完成時它會綻放，もち和ふじ也會跑來慶祝。</li>`
  }

  // 本命狀態列：三個星位，選了是空心金星、完成是實心金星
  _renderStarBar(tasks) {
    const s = this.store
    const bar = $('#starBar')
    if (s.selectedDate < s.today || !tasks.length) {
      bar.hidden = true
      return
    }
    const stars = tasks.filter((t) => t.star)
    const done = stars.filter((t) => t.done).length
    const slots = Array.from({ length: MAX_STARS }, (_, i) => {
      const t = stars[i]
      const cls = !t ? 's-empty' : t.done ? 's-done' : 's-set'
      return `<i class="slot ${cls}" title="${t ? esc(t.title) : '還沒選'}">${t?.done ? '★' : t ? '★' : '☆'}</i>`
    }).join('')
    let msg
    if (s.selectedDate === s.today && s.peekDay(s.today).starAll) msg = '本命全清，今天很棒'
    else if (stars.length < MAX_STARS) msg = `按任務旁的 ☆ 選出最重要的 ${MAX_STARS} 件・完成雙倍 XP`
    else if (done < MAX_STARS) msg = `全部完成再 +${XP.starAll} XP`
    else msg = '本命全清'
    bar.hidden = false
    bar.innerHTML = `<b>今日の本命</b><span class="slots">${slots}</span><small>${msg}</small>`
  }

  // ── 日程 ──
  _bindSchedule() {
    $('#eventColor').addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b) return
      this.eventColor = +b.dataset.i
      this._syncPickers()
    })
    $('#eventStart').addEventListener('change', () => {
      const st = toMin($('#eventStart').value)
      if (toMin($('#eventEnd').value) <= st) $('#eventEnd').value = minToHHMM(Math.min(st + 60, 1439))
    })
    $('#eventForm').addEventListener('submit', (e) => {
      e.preventDefault()
      const title = $('#eventTitle').value
      if (!title.trim()) {
        $('#eventTitle').focus()
        return
      }
      const ev = { title, start: $('#eventStart').value || '09:00', end: $('#eventEnd').value || '10:00', color: this.eventColor }
      const repeat = this._repeatValue('#eventRepeat')
      if (repeat) this.store.addRoutine({ kind: 'event', ...ev, repeat })
      else this.store.addEvent(ev)
      $('#eventRepeat').value = 'none'
      $('#eventRepeat').classList.remove('on')
      $('#eventTitle').value = ''
      // 下一個預設時段接在後面
      const end = toMin($('#eventEnd').value)
      $('#eventStart').value = minToHHMM(Math.min(end, 1380))
      $('#eventEnd').value = minToHHMM(Math.min(end + 60, 1439))
      this.eventColor = (this.eventColor + 1) % EVENT_COLORS.length
      this._syncPickers()
    })
    $('#remindLead').addEventListener('change', (e) => {
      this.store.setSetting('remindLead', +e.target.value)
      this.renderRemind()
    })
    $('#notifyBtn').addEventListener('click', async () => {
      const st = this.store.state.settings
      if (st.notify && Notification.permission === 'granted') {
        this.store.setSetting('notify', false)
      } else {
        const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
        this.store.setSetting('notify', perm === 'granted')
        if (perm === 'granted') this.toast({ icon: '鐘', title: '系統通知已開啟', sub: '切到別的視窗時也會提醒你' })
      }
      this.renderRemind()
    })
  }

  renderRemind() {
    const st = this.store.state.settings
    $('#remindLead').value = String(st.remindLead)
    const btn = $('#notifyBtn')
    if (!notifySupported()) {
      btn.hidden = true
      return
    }
    const perm = Notification.permission
    btn.disabled = perm === 'denied' || st.remindLead < 0
    btn.classList.toggle('on', st.notify && perm === 'granted')
    btn.textContent = perm === 'denied' ? '通知已被瀏覽器封鎖' : st.notify && perm === 'granted' ? '系統通知：開' : '開啟系統通知'
  }

  renderSchedule(force = true) {
    this.schedule.render(force)
  }

  // ── 專案 ──
  _bindProjects() {
    const form = $('#projectForm')
    $('#newProjectBtn').onclick = () => {
      if (!this.store.canAddProject()) {
        this.toast({ icon: '塔', title: `已經有 ${MAX_PROJECTS} 個進行中的專案`, sub: '先收藏已完成的專案吧' })
        return
      }
      form.hidden = false
      $('#newProjectBtn').hidden = true
      showDeadline(false)
      $('#projectName').focus()
    }
    // 截止日可有可無：預設不設，按「＋ 截止日」才出現日期（先填兩週後）
    const showDeadline = (on) => {
      $('#projectDeadlineAdd').hidden = on
      $('#projectDeadlineField').hidden = !on
      $('#projectDeadline').value = on ? addDays(this.store.today, 14) : ''
    }
    $('#projectDeadlineAdd').onclick = () => {
      showDeadline(true)
      $('#projectDeadline').focus()
    }
    $('#projectDeadlineClear').onclick = () => showDeadline(false)
    $('#cancelProject').onclick = () => {
      form.hidden = true
      $('#newProjectBtn').hidden = false
    }
    $('#projectColor').addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b) return
      this.projectColor = +b.dataset.i
      this._syncPickers()
    })
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const p = this.store.addProject({
        name: $('#projectName').value,
        color: this.projectColor,
        deadline: $('#projectDeadline').value,
        milestones: $('#projectMilestones').value.split('\n'),
      })
      if (!p) return
      form.reset()
      form.hidden = true
      $('#newProjectBtn').hidden = false
      this.projectColor = (this.projectColor + 1) % PROJECT_COLORS.length
      this._syncPickers()
      if (p.slot >= 0) this.hooks.focusProject(p.id)
      else this.toast({ icon: '町', title: '專案町的地都有人用了', sub: '這個專案先放在清單裡；完成里程碑讓小鎮長大會多出地，也可以把別的專案「移下島」' })
    })

    const onClick = (e) => {
      const card = e.target.closest('.proj')
      if (!card) return
      const id = card.dataset.id
      const s = this.store
      const p = s.state.projects.find((x) => x.id === id)
      const act = e.target.closest('[data-act]')?.dataset.act
      const mid = e.target.closest('.ms')?.dataset.mid
      if (act === 'ms-toggle') s.toggleMilestone(id, mid)
      else if (act === 'ms-delete') armConfirm(e.target.closest('button'), ICON.check, () => s.deleteMilestone(id, mid))
      else if (act === 'view') this.hooks.focusProject(id)
      else if (act === 'pause' || act === 'resume') s.pauseProject(id, act === 'pause')
      else if (act === 'more') {
        this._moreOpen = this._moreOpen === id ? null : id
        this.renderProjects()
      }
      else if (act === 'rename') inlineEdit($('.proj-name', card), p.name, (v) => (v ? s.updateProject(id, { name: v }) : this.renderProjects()))
      else if (act === 'color') s.updateProject(id, { color: (p.color + 1) % PROJECT_COLORS.length })
      else if (act === 'deadline') {
        this._dlEdit = id
        this.renderProjects()
        $(`.proj[data-id="${CSS.escape(id)}"] .dl-input`)?.focus()
      } else if (act === 'dl-save' || act === 'dl-clear' || act === 'dl-cancel') {
        this._dlEdit = null
        if (act === 'dl-cancel') this.renderProjects()
        else s.setDeadline(id, act === 'dl-clear' ? '' : $('.dl-input', card).value)
      }
      else if (act === 'archive') {
        this._moreOpen = null
        s.archiveProject(id, true)
      }
      else if (act === 'place') {
        if (s.placeProject(id)) this.hooks.focusProject(id)
        else this.toast({ icon: '町', title: `專案町開放的 ${s.projectTown.lots} 塊地都蓋了`, sub: `完成里程碑讓小鎮長大會多出地（最多 ${TOWER_SLOTS} 塊）；或先把一個專案「移下島」` })
      } else if (act === 'unplace') s.unplaceProject(id)
      else if (act === 'restore') {
        if (!s.archiveProject(id, false)) this.toast({ icon: '塔', title: `已經有 ${MAX_PROJECTS} 個進行中的專案`, sub: '先收藏其他專案再放回來吧' })
      } else if (act === 'delete') armConfirm(e.target.closest('button'), '確定刪除？', () => s.deleteProject(id))
    }
    $('#projectList').addEventListener('click', onClick)
    $('#archiveList').addEventListener('click', onClick)
    $('#projectList').addEventListener('submit', (e) => {
      e.preventDefault()
      const card = e.target.closest('.proj')
      const input = $('input', e.target)
      if (input.value.trim()) {
        this._keepMsFocus = card.dataset.id
        this.store.addMilestone(card.dataset.id, input.value)
      }
    })
    $('#projectFilter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]')
      if (!b) return
      this.projFilter = b.dataset.f
      this.renderProjects()
    })
    $('#projectList').addEventListener('mouseover', (e) => this.hooks.hoverProject(e.target.closest('.proj')?.dataset.id || null))
    $('#projectList').addEventListener('mouseleave', () => this.hooks.hoverProject(null))
  }

  _deadlineText(p) {
    if (this._dlEdit === p.id) {
      return `<span class="dl-edit"><input type="date" class="dl-input" value="${p.deadline || addDays(this.store.today, 14)}" aria-label="截止日">`
        + `<button type="button" data-act="dl-save">好</button>${p.deadline ? '<button type="button" data-act="dl-clear">不設截止</button>' : ''}<button type="button" data-act="dl-cancel">取消</button></span>`
    }
    if (!p.deadline) return ''
    if (p.completedAt && this.store.progress(p) >= 1) {
      const day = new Date(p.completedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
      return p.onTime ? `<span class="ontime">✦ ${day} 準時落成</span>` : `<span>已於 ${day} 落成</span>`
    }
    const d = daysBetween(this.store.today, p.deadline)
    const md = p.deadline.slice(5).replace('-', '/')
    if (d < 0) return `<span class="warn">已逾期 ${-d} 天（${md}）</span>`
    if (d === 0) return `<span class="warn">今天截止</span>`
    return `<span class="${d <= 2 ? 'warn' : ''}">截止 ${md} · 剩 ${d} 天</span>`
  }

  // 常用的放外面，其他收進「更多」
  _projectActions(p, waiting) {
    const b = (act, label) => `<button data-act="${act}">${label}</button>`
    const main = [
      p.slot >= 0 ? b('view', '在島上查看') : b('place', '放上島'),
      p.completedAt ? '' : p.pausedAt ? b('resume', '繼續') : b('pause', '暫停'),
      p.completedAt || p.pausedAt ? '' : b('deadline', '截止日'),
    ]
    const more = this._moreOpen === p.id
      ? [b('rename', '改名'), b('color', '換色'), p.slot >= 0 && waiting ? b('unplace', '移下島') : '', b('archive', '收藏'), b('delete', '刪除'), b('more', '收起')]
      : [b('more', '更多')]
    return [...main, ...more].join('')
  }

  // waiting：清單裡有還沒上島的專案（才需要「移下島」讓位）
  _projectCard(p, archived = false, waiting = false) {
    const s = this.store
    const prog = s.progress(p)
    const pct = Math.round(prog * 100)
    const c = PROJECT_COLORS[p.color % PROJECT_COLORS.length]
    const doneN = p.milestones.filter((m) => m.done).length
    const ms = p.milestones
      .map(
        (m) => `<li class="ms ${m.done ? 'done' : ''}" data-mid="${esc(m.id)}">
          <button class="check" data-act="ms-toggle" aria-label="完成" style="--c:${c}">${ICON.check}</button>
          <span>${esc(m.title)}</span>
          <button class="mini" data-act="ms-delete" title="刪除">${ICON.del}</button>
        </li>`,
      )
      .join('')
    const paused = !archived && !!p.pausedAt
    const tags = archived ? '' : `${paused ? '<span class="paused">暫停中</span>' : ''}${p.slot >= 0 ? '' : '<span class="waiting">還沒上島</span>'}`
    return `<div class="proj ${paused ? 'is-paused' : ''} ${this.hlKey === 'project:' + p.id ? 'hl' : ''}" data-id="${esc(p.id)}" style="--c:${c}">
      <div class="proj-head"><div class="proj-name">${esc(p.name)}</div><div class="proj-pct">${pct}%</div></div>
      <div class="proj-meta">${tags}${paused ? '' : this._deadlineText(p)}<span>${doneN} / ${p.milestones.length} 個里程碑</span></div>
      <div class="proj-bar">${p.milestones.map((m) => `<i class="${m.done ? 'on' : ''}"></i>`).join('') || '<i></i>'}</div>
      ${archived ? '' : `<ul class="ms-list">${ms}</ul>
      <form class="ms-add"><input placeholder="新增里程碑（塔會多一層）" maxlength="60" /><button class="mini" type="submit" title="新增">${ICON.plus}</button></form>`}
      <div class="proj-actions">
        ${archived
          ? `<button data-act="restore">放回島上</button><button data-act="delete">刪除</button>`
          : this._projectActions(p, waiting)}
      </div>
    </div>`
  }

  renderProjects() {
    const s = this.store
    // 進行中的在前、暫停的在後；同狀態裡島上有塔的在前
    const all = s.activeProjects()
    const rank = { active: 0, paused: 1, done: 2 }
    const active = all.sort((a, b) => rank[s.projectStatus(a)] - rank[s.projectStatus(b)] || (a.slot < 0) - (b.slot < 0) || a.createdAt - b.createdAt)
    const waiting = active.some((p) => p.slot < 0)
    const archived = s.state.projects.filter((p) => p.archived)
    // 狀態篩選：有兩種以上狀態時才出現
    const count = { all: all.length, active: 0, paused: 0, done: 0 }
    for (const p of all) count[s.projectStatus(p)]++
    const kinds = ['active', 'paused', 'done'].filter((k) => count[k])
    if (!count[this.projFilter || 'all']) this.projFilter = 'all'
    const filter = kinds.length > 1 ? this.projFilter || 'all' : 'all'
    $('#projectFilter').hidden = kinds.length < 2
    $('#projectFilter').innerHTML = [['all', '全部'], ['active', '進行中'], ['paused', '暫停'], ['done', '已落成']]
      .filter(([k]) => count[k])
      .map(([k, label]) => `<button type="button" data-f="${k}" class="${k === filter ? 'on' : ''}">${label} ${count[k]}</button>`)
      .join('')
    const shown = filter === 'all' ? active : active.filter((p) => s.projectStatus(p) === filter)
    $('#projectList').innerHTML = active.length
      ? shown.map((p) => this._projectCard(p, false, waiting)).join('')
      : `<div class="empty"><span class="em">まっさらな島</span>建立專案並寫下里程碑，<br>每完成一個，島上的塔就會蓋高一層。</div>`
    $('#archiveBox').hidden = !archived.length
    $('#archiveList').innerHTML = archived.map((p) => this._projectCard(p, true)).join('')
    if (this._keepMsFocus) {
      $(`.proj[data-id="${CSS.escape(this._keepMsFocus)}"] .ms-add input`)?.focus()
      this._keepMsFocus = null
    }
  }

  // ── 紀錄 ──
  renderSettings() {
    const on = this.store.state.settings.powerSave
    $('#powerBtn').classList.toggle('on', on)
    $('#powerBtn').textContent = on ? '開' : '關'
    const theme = this.store.state.settings.theme
    $$('#themePick button').forEach((b) => b.classList.toggle('on', b.dataset.v === theme))
    $('#themeInfo').textContent = THEME_INFO[theme]
    const quality = this.store.state.settings.quality
    $$('#qualityPick button').forEach((b) => b.classList.toggle('on', b.dataset.v === quality))
    $('#qualityInfo').textContent = QUALITY_INFO[quality]
    // 第一次打開時放的範例還在才顯示
    const n = this.store.sampleCount()
    const btn = $('#sampleBtn')
    btn.hidden = !n
    if (n && !btn.dataset.armed) btn.textContent = `清除範例資料（${n} 筆）`
  }

  // ── 同步 ──
  // 線上同步（手機也能用）
  attachCloud(cloud) {
    this.cloud = cloud
    this.cloudView = new CloudView($('#cloudRow'), cloud, { toast: (o) => this.toast(o) })
    $('#backupBtn').addEventListener('click', (e) => {
      armConfirm(e.currentTarget, '再按一次還原', () => {
        if (restoreBackup(this.store)) this.toast({ icon: '戻', title: '已還原備份', sub: '小島回到被取代前的樣子' })
        this.renderSync()
      })
    })
    this.renderSync()
  }
  // 分享連結打開時：到設定裡填好同步碼
  offerCloud(code) {
    this.setTab('records')
    this.cloudView?.offer(code)
  }

  // 資料夾同步（電腦版 Chrome／Edge：資料寫進 OneDrive／Dropbox 裡的檔案）
  attachSync(sync) {
    this.sync = sync
    $('#syncBtns').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-sync]')
      if (!b) return
      const act = b.dataset.sync
      if (act === 'unlink') return armConfirm(b, '再按一次解除', () => sync.unlink())
      try {
        if (act === 'create') await sync.create()
        else if (act === 'choose') await sync.choose()
        else if (act === 'resume') await sync.resume()
        else if (act === 'now') await sync.sync()
        else if (act === 'file' || act === 'local') await sync.resolve(act)
      } catch (err) {
        // 使用者在檔案視窗按了取消
        if (err?.name !== 'AbortError') this.toast({ icon: '！', title: '同步檔沒有連上', sub: err.message })
      }
    })
    this.renderSync()
  }

  renderSync() {
    this.cloudView?.render()
    const when = (t) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()} ${hhmm(t)}`
    // 被同步取代的那一份（兩種同步共用）：還在選邊時先不顯示
    const bk = readBackup()
    const choosing = this.cloud?.state === 'conflict' || this.sync?.state === 'conflict'
    $('#backupRow').hidden = !bk || choosing
    if (bk) $('#backupInfo').textContent = `${when(bk.at)} 的${bk.from === 'local' ? '這台' : bk.from === 'file' ? '同步檔' : '雲端'}版本，同步時被比較新的資料取代，留著備用`
    const sy = this.sync
    if (!sy) return
    // 手機和 Firefox 不能直接存取檔案：有線上同步就夠了，整列藏起來
    $('#syncRow').hidden = sy.state === 'unsupported'
    const name = esc(sy.fileName)
    const view = {
      unsupported: ['', []],
      off: ['把資料自動存進 OneDrive、Dropbox 等雲端資料夾裡的一個檔案，其他電腦連結同一個檔案就能共用', [['create', '建立同步檔', 1], ['choose', '連結既有檔案']]],
      'needs-permission': [`已記住「${name}」，瀏覽器需要你同意一次才能繼續同步`, [['resume', '繼續同步', 1], ['unlink', '解除']]],
      linked: [`已連結「${name}」・${sy.lastSync ? `${hhmm(sy.lastSync)} 同步過` : '同步中…'}`, [['now', '立即同步'], ['unlink', '解除']]],
      conflict: [
        sy.conflict ? `這台和「${name}」都有新的變更（檔案 ${when(sy.conflict.remoteAt)}、這台 ${when(sy.conflict.localAt)}）。要保留哪一邊？另一邊會留一份備份` : '',
        [['file', '用檔案的', 1], ['local', '用這台的', 1]],
      ],
      error: [`同步失敗：${esc(sy.message)}`, [['now', '重試', 1], ['unlink', '解除']]],
    }[sy.state]
    const [info, btns] = view
    $('#syncInfo').innerHTML = info
    $('#syncBtns').innerHTML = btns
      .map(([act, label, on]) => `<button class="chip-toggle ${on ? 'on' : ''}" data-sync="${act}">${label}</button>`)
      .join('')
    $('#syncDot').dataset.state = sy.state
  }

  // ── もち和ふじ共同的好感度 ──
  renderBond() {
    const s = this.store
    const b = s.bond
    const cur = BOND_LEVELS[b.level - 1]
    const pct = b.next ? ((b.pts - cur.need) / (b.next - cur.need)) * 100 : 100
    const nextLv = BOND_LEVELS[b.level]
    const r = nextLv?.reward
    const nextText = !nextLv ? '已經是最好的朋友了' : r?.outfit ? `Lv.${nextLv.level} 解鎖衣裝「${outfitOf(r.outfit).name}」` : `Lv.${nextLv.level} 解鎖「${BOND_ACTS[r.act].name}」`
    const acts = Object.entries(BOND_ACTS)
      .filter(([k]) => BOND_LEVELS.some((l) => l.reward?.act === k && l.level <= b.level))
      .map(([, a]) => `<span title="${esc(a.desc)}">${esc(a.name)}</span>`)
    const wardrobe = (who, current) => `<div class="outfit-row"><span class="outfit-who">${who === 'fuji' ? 'ふじ' : 'もち'}</span><div class="outfits">${OUTFITS.map((o) => {
      const lv = outfitLevel(o.key)
      const locked = lv > b.level
      return `<button class="outfit ${o.key === current ? 'on' : ''}" data-outfit="${o.key}" data-who="${who}" ${locked ? 'disabled' : ''} title="${esc(locked ? `好感度 Lv.${lv} 解鎖` : o.desc)}">${locked ? `<small>Lv.${lv}</small>` : esc(o.name)}</button>`
    }).join('')}</div></div>`
    $('#bondCount').textContent = `Lv.${b.level}`
    $('#bondBox').innerHTML = `
      <div class="bond-head"><b>${esc(b.name)}</b><small>${b.next ? `${b.pts} / ${b.next}` : b.pts}</small></div>
      <div class="bond-bar"><i style="width:${pct}%"></i></div>
      <p class="bond-next">${nextText}${acts.length ? `・已學會 ${acts.join('、')}` : ''}</p>
      ${wardrobe('mochi', s.player.bond.outfit)}${wardrobe('fuji', s.player.bond.outfitFuji)}
      <p class="hint">摸摸もち和ふじ、專注、寫回顧、清完本命、每天來看看她們，兩人都會和你更親近。</p>`
  }

  // ── ひより町：每間店的階段、下一階還差多少、住在那裡的居民 ──
  renderTown() {
    const t = this.store.town
    $('#townCount').textContent = `${t.rank} / ${t.max}`
    const cards = BUILDINGS.map((b, i) => {
      const s = t.buildings[i]
      const res = RESIDENTS[b.resident]
      const pips = Array.from({ length: MAX_STAGE }, (_, k) => `<i class="${k < s.stage ? 'on' : ''}"></i>`).join('')
      const need = s.next == null ? 0 : s.next - s.value
      const next = s.next == null ? '已經長到最大了' : s.stage ? `再 ${need} ${b.unit} → ${b.stages[s.stage]}` : `再 ${need} ${b.unit}就會開張`
      const who = s.stage >= MOVE_IN ? `${res.name}（${res.animal}）住在這裡` : `長到 ${MOVE_IN} 階時，${res.animal}${res.name}會搬來`
      return `<button type="button" class="bld ${s.stage ? '' : 'locked'}" data-town="${b.key}" style="--bc:${res.color}" title="${esc(`${b.name}：${b.feature}越多，它長得越大`)}">
        <span class="bld-k">${b.icon}</span>
        <span class="bld-n"><b>${b.name}</b><small>${s.stage ? esc(b.stages[s.stage - 1]) : '還沒開張'}</small></span>
        <span class="bld-pips">${pips}</span>
        <span class="bld-bar"><i style="width:${Math.round(s.progress * 100)}%"></i></span>
        <small class="bld-next">${esc(next)}</small>
        <small class="bld-res">${esc(who)}</small>
      </button>`
    }).join('')
    // 專案町：等級、地的使用量、升下一級還差幾點
    const pt = this.store.projectTown
    const used = this.store.towerProjects().length
    const prev = TOWN_POINTS[pt.level - 1]
    const ptPct = pt.next == null ? 100 : Math.round(((pt.points - prev) / (pt.next - prev)) * 100)
    const ptPips = Array.from({ length: MAX_TOWN_LEVEL }, (_, k) => `<i class="${k < pt.level ? 'on' : ''}"></i>`).join('')
    const ptNext = pt.next == null ? '街道全部鋪好了' : `再 ${pt.next - pt.points} 點升到 Lv.${pt.level + 1}，多 ${lotsAt(pt.level + 1) - pt.lots} 塊地`
    const ptCard = `<button type="button" class="bld ptown" data-ptown style="--bc:#e8a96f" title="每個專案在專案町蓋一棟房子；點一下飛過去看看">
        <span class="bld-k">町</span>
        <span class="bld-n"><b>專案町 Lv.${pt.level}</b><small>地 ${used} / ${pt.lots}・最多 ${TOWER_SLOTS} 塊</small></span>
        <span class="bld-pips">${ptPips}</span>
        <span class="bld-bar"><i style="width:${ptPct}%"></i></span>
        <small class="bld-next">${ptNext}</small>
        <small class="bld-res">完成一個里程碑 +1 點、落成一個專案 +3 點</small>
      </button>`
    $('#townBox').innerHTML = `
      <div class="town-head"><b>${esc(t.title)}</b><small>${t.residents.length} 位居民</small></div>
      <div class="town-grid">${ptCard}${cards}</div>
      <p class="hint">每間店綁著一個功能，用得越多就長得越大；點卡片飛過去看看。</p>`
  }

  // ── 花の図鑑 ──
  renderDex() {
    const dex = this.store.state.dex
    const order = (f) => RARITY_ORDER.length - RARITY_ORDER.indexOf(f.rarity)
    const list = [...FLOWERS].sort((a, b) => order(a) - order(b))
    const thumbs = renderFlowerThumbs(FLOWERS.map((f) => f.key))
    const found = list.filter((f) => dex[f.key]).length
    $('#dexCount').textContent = `${found} / ${FLOWERS.length}`
    $('#dexGrid').innerHTML = list
      .map((f) => {
        const got = dex[f.key]
        return `<button class="dex-cell ${got ? '' : 'unknown'} ${this.dexSel === f.key ? 'on' : ''}" data-k="${f.key}" style="--rc:${RARITIES[f.rarity].color}">
          <img src="${thumbs[f.key]}" alt="" draggable="false" /><span>${got ? esc(f.name) : '？？？'}</span></button>`
      })
      .join('')
    this._renderDexDetail()
  }

  _renderDexDetail() {
    const f = flowerOf(this.dexSel)
    if (!f) return
    const got = this.store.state.dex[f.key]
    const r = RARITIES[f.rarity]
    const tag = `<i class="rarity" style="--rc:${r.color}">${r.label}</i>`
    if (!got) {
      $('#dexDetail').innerHTML = `<b>？？？</b>${tag}<p>線索：${esc(f.hint)}</p>`
      return
    }
    const d = parseDate(got.at)
    $('#dexDetail').innerHTML = `<b>${esc(f.name)}</b><small>${esc(f.jp)}</small>${tag}<p>${esc(f.desc)}</p><small>${d.getMonth() + 1}/${d.getDate()} 第一次開花・開過 ${got.n} 朵</small>`
  }

  _bindDex() {
    $('#dexGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]')
      if (!b) return
      this.dexSel = b.dataset.k
      $$('#dexGrid .dex-cell').forEach((x) => x.classList.toggle('on', x === b))
      this._renderDexDetail()
    })
  }

  // ── 上週回顧卡 ──
  openWeekCard() {
    const s = this.store
    const w = s.weekSummary()
    const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`
    $('#weekRange').textContent = `${md(w.week)} – ${md(w.end)}`
    $('#weekMoods').innerHTML = w.days
      .map((d, i) => {
        const m = moodOf(w.moods[i])
        return `<div class="wm ${m ? '' : 'none'}" style="--mc:${m?.color || 'transparent'}"><span class="stamp-k">${m?.kanji || '・'}</span><small>${WEEK_ZH[parseDate(d).getDay()]}</small></div>`
      })
      .join('')
    const stats = [
      [w.tasks, '朵花綻放'],
      [w.focus, '分鐘專注'],
      [w.stars, '件本命完成'],
      [w.activeDays, '天有前進'],
    ]
    $('#weekStats').innerHTML = stats.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')
    const notes = []
    if (w.best) notes.push(`最充實的一天：${md(w.best.date)}（${WEEK_ZH[parseDate(w.best.date).getDay()]}），開了 ${w.best.tasks} 朵花`)
    if (w.perfectDays) notes.push(`完美的一天 ${w.perfectDays} 次`)
    if (w.flowers.length) notes.push(`圖鑑新朋友：${w.flowers.slice(0, 4).map((f) => esc(f.name)).join('、')}${w.flowers.length > 4 ? ` 等 ${w.flowers.length} 種` : ''}`)
    if (w.challenge) notes.push(`每週挑戰「${esc(w.challenge.title)}」：${w.challenge.value >= w.challenge.goal ? '達成 ✓' : `${w.challenge.value} / ${w.challenge.goal}`}`)
    $('#weekNotes').innerHTML = notes.map((n) => `<li>${n}</li>`).join('')
    // 回顧卡上的一句話，もち和ふじ輪流說
    const fuji = Math.random() < 0.5
    const pool = (fuji ? FUJI_LINES : LINES).weekCard?.[w.tier] || []
    $('#weekMochi').textContent = pool.length ? `${fuji ? 'ふじ' : 'もち'}：「${pool[Math.floor(Math.random() * pool.length)]}」` : ''
    $('#weekModal').hidden = false
  }

  closeWeekCard() {
    if ($('#weekModal').hidden) return
    $('#weekModal').hidden = true
    this.store.seenWeekCard()
    this.hooks.modalClosed?.()
  }

  // 新的一週第一次打開：如果上週有在用，就給一張回顧卡（其他視窗開著時先不打擾）
  maybeShowWeekCard() {
    if (!this.store.weekCardDue() || !$('#levelModal').hidden || !$('#reviewModal').hidden) return false
    this.openWeekCard()
    return true
  }

  // ── 晚間回顧 ──
  _bindReview() {
    $('#moodPick').innerHTML = MOODS.map(
      (m) => `<button type="button" class="mood" data-mood="${m.key}" style="--mc:${m.color}" title="${m.desc}"><div class="stamp-k">${m.kanji}</div><span>${m.name}</span></button>`,
    ).join('')
    $('#moodPick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mood]')
      if (!b) return
      this.mood = b.dataset.mood
      $$('#moodPick .mood').forEach((x) => x.classList.toggle('on', x === b))
      $('#reviewSave').disabled = false
    })
    $('#reviewForm').addEventListener('submit', (e) => {
      e.preventDefault()
      if (!this.mood) return
      this.store.saveReview(this.reviewDate, this.mood, $('#reviewText').value)
      this.closeReview()
    })
    $('#reviewLater').onclick = () => {
      try {
        localStorage.setItem('hiyori-review-later', this.store.today)
      } catch {}
      this.closeReview()
    }
    $('#reviewModal').addEventListener('click', (e) => {
      if (e.target.id === 'reviewModal') $('#reviewLater').click()
    })
    $('#reviewBtn').onclick = () => this.openReview()
  }

  openReview(date = this.store.today) {
    const s = this.store
    this.reviewDate = date
    const prev = s.state.journal[date]
    this.mood = prev?.mood || null
    const d = parseDate(date)
    $('#reviewDate').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日・${WEEK_JP[d.getDay()]}`
    const day = s.peekDay(date)
    const tasks = s.tasksOn(date)
    const ev = s.eventsOn(date)
    $('#reviewSum').innerHTML = `<span><b>${tasks.filter((t) => t.done).length}</b>/ ${tasks.length} 朵花綻放</span><span><b>${day.focus}</b>分鐘專注</span><span><b>${ev.filter((e) => e.done).length}</b>個日程完成</span>`
    $$('#moodPick .mood').forEach((x) => x.classList.toggle('on', x.dataset.mood === this.mood))
    $('#reviewText').value = prev?.text || ''
    $('#reviewSave').disabled = !this.mood
    $('#reviewSave').textContent = prev ? '更新' : '記下來'
    $('#reviewModal').hidden = false
    this.hooks.reviewOpened?.()
  }

  closeReview() {
    $('#reviewModal').hidden = true
  }

  // 晚上 9 點後、今天還沒寫、也沒按「之後再說」時，邀請回顧
  maybeAskReview() {
    const s = this.store
    if (new Date().getHours() < 21 || s.state.journal[s.today]) return false
    let later = null
    try {
      later = localStorage.getItem('hiyori-review-later')
    } catch {}
    if (later === s.today || !$('#reviewModal').hidden || !$('#levelModal').hidden) return false
    this.openReview()
    return true
  }

  _bindRecords() {
    this._bindReview()
    this._bindDex()
    $('#weekBtn').onclick = () => this.openWeekCard()
    $('#weekClose').onclick = () => this.closeWeekCard()
    $('#weekModal').addEventListener('click', (e) => {
      if (e.target.id === 'weekModal') this.closeWeekCard()
    })
    $('#bondBox').addEventListener('click', (e) => {
      const b = e.target.closest('[data-outfit]:not(:disabled)')
      if (b) this.store.setOutfit(b.dataset.outfit, b.dataset.who)
    })
    $('#townBox').addEventListener('click', (e) => {
      const b = e.target.closest('[data-town], [data-ptown]')
      if (!b) return
      // 手機上面板蓋住下半部，收起來才看得到浮島
      if (innerWidth <= 860) this.togglePanel(true)
      if (b.dataset.town) this.hooks.focusTown?.(b.dataset.town)
      else this.hooks.focusProjectTown?.()
    })
    $('#themePick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (b) this.setTheme(b.dataset.v)
    })
    $('#qualityPick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (!b) return
      this.store.setSetting('quality', b.dataset.v)
      this.hooks.setQuality?.(b.dataset.v)
      this.renderSettings()
    })
    $('#powerBtn').onclick = () => {
      const on = !this.store.state.settings.powerSave
      this.store.setSetting('powerSave', on)
      this.hooks.setPowerSave?.(on)
      this.renderSettings()
    }
    $('#exportBtn').onclick = () => {
      const blob = new Blob([this.store.exportJSON()], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `hiyori-${this.store.today}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    $('#importInput').onchange = async (e) => {
      const f = e.target.files[0]
      if (!f) return
      try {
        this.store.importJSON(await f.text())
        this.toast({ icon: '入', title: '資料已匯入', sub: '小島回到了那時的樣子' })
      } catch (err) {
        this.toast({ icon: '！', title: '匯入失敗', sub: err.message })
      }
      e.target.value = ''
    }
    $('#sampleBtn').onclick = (e) =>
      armConfirm(e.currentTarget, '再按一次清除範例', () => {
        const n = this.store.clearSamples()
        this.toast({ icon: '掃', title: `清掉了 ${n} 筆範例`, sub: '自己加的資料、經驗值和統計都還在' })
        this.renderSettings()
      })
    $('#resetBtn').onclick = (e) => armConfirm(e.currentTarget, '再按一次，清空所有資料', () => this.store.reset())
  }

  renderRecords() {
    this.life.render()
    const s = this.store
    const st = s.stats
    const stats = [
      [st.tasksDone, '朵花綻放（累計任務）'],
      [st.focusMinutes, '分鐘專注'],
      [Math.max(st.bestStreak, s.streak), '天最長連續'],
      [st.projectsDone, '座塔落成'],
    ]
    $('#statsGrid').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('')

    const days = Array.from({ length: 7 }, (_, i) => addDays(s.today, i - 6))
    const vals = days.map((d) => s.peekDay(d))
    const max = Math.max(4, ...vals.map((v) => v.tasks))
    $('#weekChart').innerHTML = days
      .map((d, i) => {
        const v = vals[i]
        const h = (v.tasks / max) * 100
        const wd = parseDate(d).getDay()
        const mood = moodOf(s.state.journal[d]?.mood)
        return `<div class="wk ${d === s.today ? 'today' : ''}" title="${d}：任務 ${v.tasks}、番茄鐘 ${v.pomodoros}、+${v.xp} XP${mood ? '、心情 ' + mood.name : ''}">
          <span class="wk-m" style="--mc:${mood?.color || 'transparent'}">${mood?.kanji || ''}</span>
          <span class="wk-n">${v.tasks || ''}</span><div class="wk-bar ${v.tasks ? '' : 'zero'}" style="height:${Math.max(3, h * 0.72)}%"></div><span class="wk-d">${WEEK_ZH[wd]}</span></div>`
      })
      .join('')

    this.renderSettings()
    this.renderBond()
    this.renderTown()
    this.renderDex()
    const entries = s.journalList(14)
    $('#journalTitle').hidden = !entries.length
    $('#journalList').innerHTML = entries
      .map(([d, j]) => {
        const m = moodOf(j.mood)
        const dd = parseDate(d)
        return `<li><div class="stamp-k" style="--mc:${m.color}">${m.kanji}</div><div><small>${dd.getMonth() + 1}/${dd.getDate()}（${WEEK_ZH[dd.getDay()]}）・${m.name}</small><p>${esc(j.text) || '<span style="color:var(--ink-faint)">（沒有寫字，只留下天氣）</span>'}</p></div></li>`
      })
      .join('')
    $('#reviewBtn').textContent = s.state.journal[s.today] ? '修改今天的回顧' : '寫下今天的回顧'

    const lv = s.level.level
    $('#unlockList').innerHTML = UNLOCKS.map(
      (u) => `<li class="${lv >= u.level ? 'got' : ''}"><b>Lv.${u.level}</b>${u.name}<small>${lv >= u.level ? u.jp : '未解鎖'}</small></li>`,
    ).join('')

    const got = s.player.achievements
    const n = ACHIEVEMENTS.filter((a) => got[a.id]).length
    $('#achCount').textContent = `${n} / ${ACHIEVEMENTS.length}`
    $('#achGrid').innerHTML = ACHIEVEMENTS.map((a) => {
      const ok = !!got[a.id]
      return `<div class="stamp ${ok ? '' : 'locked'}" tabindex="0">
        <div class="stamp-k">${ok ? a.kanji : '？'}</div>
        <div class="stamp-n">${ok ? esc(a.title) : '？？？'}</div>
        <div class="tip"><b>${esc(a.name)}・${esc(a.title)}</b>${esc(a.desc)}${ok ? `<br><small>${new Date(got[a.id]).toLocaleDateString('zh-TW')} 取得</small>` : ''}</div>
      </div>`
    }).join('')
  }

  // ── HUD / 每日任務 / 日期 ──
  renderChrome() {
    const s = this.store
    const lv = s.level
    $('#lv').textContent = lv.level
    $('#lvTitle').textContent = levelTitle(lv.level)
    $('#xpFill').style.width = `${(lv.cur / lv.need) * 100}%`
    $('#xpText').textContent = `${lv.cur} / ${lv.need} XP`
    $('#streak').textContent = s.streak
    $('#charms').textContent = s.player.charms
    $('#charmPill').hidden = !s.player.charms
    $('#coins').textContent = s.coins
    if (!$('#shop').hidden) this.renderShop()

    const d = parseDate(s.selectedDate)
    $('#dateNum').textContent = `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`
    $('#dateWeek').textContent = WEEK_JP[d.getDay()]
    const diff = daysBetween(s.today, s.selectedDate)
    $('#dateRel').textContent = { 0: '今天', 1: '明天', [-1]: '昨天' }[diff] ?? (diff > 0 ? `${diff} 天後` : `${-diff} 天前`)
    $('#todayBtn').hidden = diff === 0

    const sound = s.state.settings.sound
    $('#soundBtn').classList.toggle('off', !sound)
    $('#soundBtn').title = sound ? '音效：開' : '音效：關'

    this.renderQuests()
  }

  // 每日任務（每天輪替三個）＋每週挑戰
  renderQuests() {
    const s = this.store
    const row = (q, act, cls = '', badge = '') => `<li class="quest ${cls} ${q.claimed ? 'claimed' : ''}">
          <span>${badge}${esc(q.title)} <small class="q-n">${q.value}/${q.goal}</small><em class="q-sub">${esc(q.sub)}</em></span>
          <div class="q-act">${act}</div>
          <div class="q-bar"><i style="width:${(q.value / q.goal) * 100}%"></i></div>
        </li>`
    const daily = s.quests().map((q) =>
      row(q, q.claimed ? `<span class="q-done">済</span>` : q.ready ? `<button class="q-claim" data-q="${q.id}">領取</button>` : `<span class="q-xp">+${XP.quest} XP</span>`),
    )
    const w = s.weekly()
    const item = s.nextExclusive()
    const prize = item ? `限定「${item.name}」` : '40 顆金平糖'
    const wAct = w.claimed
      ? `<span class="q-done">済</span>`
      : w.ready
        ? `<button class="q-claim" data-weekly="1">領取</button>`
        : `<span class="q-xp" title="獎勵：+${XP.weekly} XP＋${esc(prize)}">${w.daysLeft ? `剩 ${w.daysLeft} 天` : '今天截止'}</span>`
    const weekly = row({ ...w, sub: `${w.sub}・獎勵 ${prize}` }, wAct, 'weekly', '<i class="wk-badge">週</i>')
    $('#questList').innerHTML = $('#questMini').innerHTML = [...daily, weekly].join('')
  }

  render() {
    this.renderChrome()
    this._renderRepeatOptions()
    this.renderTasks()
    this.renderSchedule()
    this.renderRemind()
    this.renderRoutines()
    this.renderProjects()
    if (this.tab === 'records') this.renderRecords()
    if (this.tab === 'habits') this.habits.render()
    if (this.calendar.isOpen) this.calendar.render()
  }

  tickClock() {
    const n = new Date()
    $('#clock').textContent = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
  }

  // ── 金平糖商店 ──
  toggleShop(force) {
    const open = force ?? $('#shop').hidden
    // 商店要在島上擺東西，打開時先離開全螢幕
    if (open) this.toggleFull(false)
    $('#shop').hidden = !open
    $('#shopBtn').classList.toggle('on', open)
    if (open) this.renderShop()
  }

  renderShop() {
    const s = this.store
    $('#shopCoins').textContent = s.coins
    const thumbs = renderThumbnails(SHOP_ITEMS.map((i) => i.key))
    const owned = {}
    for (const p of s.state.placed) owned[p.key] = (owned[p.key] || 0) + 1
    // 買得到的排前面；還沒上架的（等級、季節）排後面
    const list = SHOP_ITEMS.map((i) => ({ i, st: s.shopStatus(i) }))
      .filter((x) => !x.st.hidden)
      .sort((a, b) => !!a.st.lock - !!b.st.lock || !!b.st.free - !!a.st.free)
    const charms = s.player.charms
    const charm = `<button class="shop-item charm" data-charm="1" title="漏掉一天沒完成任務時，自動用掉一個保住連續天數（最多帶 ${CHARM.max} 個）" ${charms >= CHARM.max || s.coins < CHARM.price ? 'disabled' : ''}>
        <i class="shop-badge charm-badge">守</i><div class="omamori"><span>御守</span></div>
        <b>お守り</b><small>保住連續天數</small>
        ${charms >= CHARM.max ? '<span class="price lock">已帶滿</span>' : `<span class="price"><i class="konpeito"></i>${CHARM.price}</span>`}
        <span class="owned">身上 ${charms}/${CHARM.max}</span>
      </button>`
    $('#shopGrid').innerHTML = charm + list
      .map(({ i, st }) => {
        const badge = i.exclusive ? '<i class="shop-badge wk">週限定</i>' : i.season ? `<i class="shop-badge s-${i.season}">${SEASON_ZH[i.season]}</i>` : ''
        const price = st.lock ? `<span class="price lock">${st.lock}</span>` : st.free ? '<span class="price free">免費</span>' : `<span class="price"><i class="konpeito"></i>${i.price}</span>`
        return `<button class="shop-item ${st.lock ? 'locked' : ''}" data-key="${i.key}" title="${esc(i.desc)}" ${st.ok ? '' : 'disabled'}>
        ${badge}<img src="${thumbs[i.key]}" alt="" />
        <b>${esc(i.name)}</b><small>${esc(i.jp)}</small>
        ${price}
        ${owned[i.key] ? `<span class="owned">已擺 ${owned[i.key]}</span>` : ''}
      </button>`
      })
      .join('')
  }

  // ── 3D ↔ 列表聯動 ──
  highlight(type, id) {
    const key = id ? `${type}:${id}` : null
    if (key === this.hlKey) return
    this.hlKey = key
    $$('.item.hl, .proj.hl, .blk.hl').forEach((el) => el.classList.remove('hl'))
    if (!id) return
    const el =
      type === 'task' ? $(`.item[data-id="${CSS.escape(id)}"]`) : type === 'event' ? $(`.blk[data-id="${CSS.escape(id)}"]`) : $(`.proj[data-id="${CSS.escape(id)}"]`)
    el?.classList.add('hl')
  }

  reveal(type, id) {
    this.setTab({ task: 'tasks', event: 'schedule', project: 'projects' }[type])
    this.highlight(type, id)
    const el =
      type === 'task' ? $(`.item[data-id="${CSS.escape(id)}"]`) : type === 'event' ? $(`.blk[data-id="${CSS.escape(id)}"]`) : $(`.proj[data-id="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => this.highlight(null), 2200)
  }

  // ── 通知 ──
  toast({ icon = '花', title, sub = '', stamp = false, ms = 3400 }) {
    const el = document.createElement('div')
    el.className = 'toast'
    el.innerHTML = `${stamp ? `<div class="stamp-k">${esc(icon)}</div>` : `<div class="t-icon">${esc(icon)}</div>`}<div><b>${esc(title)}</b><small>${esc(sub)}</small></div>`
    $('#toasts').append(el)
    setTimeout(() => {
      el.classList.add('out')
      setTimeout(() => el.remove(), 500)
    }, ms)
  }

  showLevelUp(level, unlock) {
    $('#modalLv').textContent = level
    $('#modalTitle').textContent = levelTitle(level)
    $('#modalUnlock').innerHTML = unlock
      ? `小島長出了新的風景：<br><b>${esc(unlock.name)}</b>（${esc(unlock.jp)}）`
      : '繼續照顧小島，下一個風景就在前方。'
    $('#levelModal').hidden = false
    $('#lv').parentElement.classList.remove('pop')
    void $('#lv').offsetWidth
    $('#lv').parentElement.classList.add('pop')
    setTimeout(() => $('#modalClose').focus(), 50)
  }

  closeModal() {
    if ($('#levelModal').hidden) return
    $('#levelModal').hidden = true
    this.hooks.modalClosed?.()
  }
}

// ── 番茄鐘 ──
const FOCUS_KEY = 'hiyori-focus'
const rawFocus = Number(new URLSearchParams(location.search).get('focus'))
const debugMin = import.meta.env.DEV && Number.isFinite(rawFocus) && rawFocus > 0 ? rawFocus : 0

class FocusTimer {
  constructor(ui, hooks) {
    this.ui = ui
    this.hooks = hooks
    this.focusMin = debugMin || FOCUS_MIN
    this.breakMin = debugMin ? debugMin / 2 : BREAK_MIN
    this.mode = 'idle' // idle | focus | break
    this.endAt = 0
    this.paused = null
    this.taskId = null
    try {
      const saved = JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null')
      if (saved && saved.mode !== 'idle') Object.assign(this, saved)
    } catch {}
    $('#focusBtn').onclick = () => this.toggle()
    $('#focusStop').onclick = () => this.stop()
    $('#focusLabel').onclick = (e) => {
      e.stopPropagation()
      this.togglePicker()
    }
    $('#focusPickList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tid]')
      if (!b) return
      this.taskId = b.dataset.tid || null
      this._save()
      this.togglePicker(false)
      this.render()
      this.hooks.focusTaskChanged?.(this.taskId)
    })
    addEventListener('pointerdown', (e) => {
      if (!$('#focusPick').hidden && !e.target.closest('#focusPick, #focusLabel')) this.togglePicker(false)
    })
    setInterval(() => this.tick(), 250)
    this.render()
    if (this.mode === 'focus' && this.paused == null && this.endAt > Date.now()) hooks.focusStarted(true, this.task?.id || null)
  }

  _save() {
    localStorage.setItem(FOCUS_KEY, JSON.stringify({ mode: this.mode, endAt: this.endAt, paused: this.paused, taskId: this.taskId }))
  }

  // 綁定的任務若已完成或刪除就自動解除
  get task() {
    const t = this.taskId && this.ui.store.state.tasks.find((x) => x.id === this.taskId)
    return t && !t.done ? t : null
  }

  togglePicker(force) {
    const open = force ?? $('#focusPick').hidden
    $('#focusPick').hidden = !open
    if (!open) return
    const s = this.ui.store
    const tasks = s.tasksOn(s.today).filter((t) => !t.done)
    const cur = this.task?.id
    $('#focusPickList').innerHTML =
      `<li><button data-tid="" class="${cur ? '' : 'on'}"><i style="--c:#d8dee8"></i>不指定任務</button></li>` +
      tasks
        .map((t) => `<li><button data-tid="${esc(t.id)}" class="${t.id === cur ? 'on' : ''}"><i style="--c:${tagOf(t.tag).color}"></i>${esc(t.title)}${t.pomos ? `<small>◷ ${t.pomos}</small>` : ''}</button></li>`)
        .join('') +
      (tasks.length ? '' : '<li class="empty" style="padding:10px">今天沒有待辦的任務</li>')
  }

  startWith(taskId) {
    this.taskId = taskId
    if (this.mode === 'focus') {
      this._save()
      this.render()
      this.hooks.focusTaskChanged?.(taskId)
      return
    }
    if (this.mode === 'break') this.mode = 'idle'
    this.toggle()
  }

  get total() {
    return (this.mode === 'break' ? this.breakMin : this.focusMin) * 60000
  }
  get left() {
    if (this.mode === 'idle') return this.focusMin * 60000
    return this.paused ?? Math.max(0, this.endAt - Date.now())
  }

  toggle() {
    if (this.mode === 'idle') {
      this.mode = 'focus'
      this.endAt = Date.now() + this.focusMin * 60000
      this.paused = null
      if (!this.task) this.taskId = null
      // 專注時兩人會走進小木屋、計時器在 Dock 上，全螢幕會把它們蓋住
      this.ui.toggleFull(false)
      this.hooks.focusStarted(false, this.taskId)
    } else if (this.paused != null) {
      this.endAt = Date.now() + this.paused
      this.paused = null
    } else {
      this.paused = Math.max(0, this.endAt - Date.now())
    }
    this._save()
    this.render()
  }

  stop() {
    const wasFocus = this.mode === 'focus'
    this.mode = 'idle'
    this.paused = null
    this._save()
    this.render()
    if (wasFocus) this.hooks.focusStopped()
  }

  tick() {
    if (this.mode === 'idle' || this.paused != null) return
    if (Date.now() >= this.endAt) {
      if (this.mode === 'focus') {
        this.mode = 'break'
        this.endAt = Date.now() + this.breakMin * 60000
        this._save()
        this.hooks.focusFinished(Math.max(1, Math.round(this.focusMin)), this.task?.id || null)
      } else {
        this.mode = 'idle'
        this._save()
        this.hooks.breakFinished()
      }
    }
    this.render()
  }

  render() {
    const left = this.left
    const m = Math.floor(left / 60000)
    const sec = Math.floor((left % 60000) / 1000)
    $('#focusTime').textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    const box = $('#focusBox')
    box.classList.toggle('running', this.mode === 'focus')
    box.classList.toggle('break', this.mode === 'break')
    const label = { idle: '專注 · しゅうちゅう', focus: '專注中', break: '休息 · きゅうけい' }[this.mode]
    const t = this.task
    $('#focusLabel').textContent = this.paused != null ? '暫停中' : t && this.mode !== 'break' ? `◷ ${t.title}` : label
    $('#focusLabel').classList.toggle('set', !!t && this.mode !== 'break')
    $('#focusIcon').innerHTML = this.mode !== 'idle' && this.paused == null ? ICON.pause : ICON.play
    $('#focusStop').hidden = this.mode === 'idle'
    $('#focusBtn').title = this.mode === 'idle' ? '開始專注 (F)' : this.paused != null ? '繼續' : '暫停'
    const frac = this.mode === 'idle' ? 0 : 1 - left / this.total
    $('#focusArc').style.strokeDashoffset = 119.4 * (1 - frac)
    document.title = this.mode === 'idle' ? 'ひより日和 · 日程小島' : `${$('#focusTime').textContent} ${this.mode === 'focus' ? '專注中' : '休息中'} · ひより`
  }
}
