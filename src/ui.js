import { TAGS, tagOf, PRIORITIES, EVENT_COLORS, PROJECT_COLORS, UNLOCKS, WEEK_JP, WEEK_ZH, FOCUS_MIN, BREAK_MIN, MAX_PROJECTS } from './theme.js'
import { dateStr, addDays, parseDate, toMin, minToHHMM, repeatLabel } from './store.js'
import { notifySupported } from './reminders.js'
import { ACHIEVEMENTS } from './data/achievements.js'
import { LEVEL_TITLES } from './data/lines.js'

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4L19 7"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  today: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
}

export const levelTitle = (lv) => LEVEL_TITLES[Math.min(lv, LEVEL_TITLES.length) - 1] || LEVEL_TITLES[0]
const hhmm = (ts) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)

// 二段式確認：第一次點擊變成「確定？」，3 秒內再點才執行
function armConfirm(btn, label, fn) {
  if (btn.dataset.armed) {
    fn()
    return
  }
  const orig = btn.innerHTML
  btn.dataset.armed = '1'
  btn.innerHTML = label
  btn.classList.add('armed')
  setTimeout(() => {
    if (!btn.isConnected) return
    delete btn.dataset.armed
    btn.innerHTML = orig
    btn.classList.remove('armed')
  }, 3000)
}

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
    $('#viewBtn').onclick = () => this.hooks.resetView()
    $('#soundBtn').onclick = () => {
      const on = !this.store.state.settings.sound
      this.store.setSetting('sound', on)
      this.hooks.setSound(on)
      this.renderChrome()
    }
    $('#panelBtn').onclick = () => this.togglePanel()
    for (const el of [$('#questList'), $('#questMini')]) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]')
        if (b) this.store.claimQuest(b.dataset.q)
      })
    }
    $('#modalClose').onclick = () => this.closeModal()
    $('#levelModal').addEventListener('click', (e) => {
      if (e.target.id === 'levelModal') this.closeModal()
    })

    addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)
      if (e.key === 'Escape') {
        this.closeModal()
        if (typing) document.activeElement.blur()
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        this.setTab('tasks')
        $('#taskTitle').focus()
      } else if (e.key === 'v' || e.key === 'V') this.hooks.resetView()
      else if (e.key === 'f' || e.key === 'F') this.focus.toggle()
      else if (e.key === 'ArrowLeft') $('#prevDay').click()
      else if (e.key === 'ArrowRight') $('#nextDay').click()
      else if (['1', '2', '3', '4'].includes(e.key)) this.setTab(['tasks', 'schedule', 'projects', 'records'][+e.key - 1])
    })
  }

  setTab(tab) {
    this.tab = tab
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab))
    $$('.tab-page').forEach((p) => p.classList.toggle('active', p.dataset.page === tab))
    if ($('#panel').classList.contains('collapsed')) this.togglePanel(false)
    if (tab === 'records') this.renderRecords()
  }

  togglePanel(force) {
    const panel = $('#panel')
    const collapsed = force === undefined ? !panel.classList.contains('collapsed') : force
    panel.classList.toggle('collapsed', collapsed)
    document.body.classList.toggle('panel-collapsed', collapsed)
  }

  // ── 任務 ──
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
    $('#taskForm').addEventListener('submit', (e) => {
      e.preventDefault()
      const input = $('#taskTitle')
      if (!input.value.trim()) {
        input.focus()
        return
      }
      const repeat = this._repeatValue('#taskRepeat')
      if (repeat) this.store.addRoutine({ kind: 'task', title: input.value, priority: this.priority, tag: this.tag, repeat })
      else this.store.addTask({ title: input.value, priority: this.priority, tag: this.tag })
      $('#taskRepeat').value = 'none'
      $('#taskRepeat').classList.remove('on')
      input.value = ''
      input.focus()
    })

    const onList = (e) => {
      const li = e.target.closest('.item')
      if (!li) return
      const id = li.dataset.id
      const act = e.target.closest('[data-act]')?.dataset.act
      const s = this.store
      if (act === 'toggle') s.toggleTask(id)
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
    const rt = this.store.routineOf(t)
    if (rt) meta.push(`<span class="rep">↻ ${esc(repeatLabel(rt.repeat))}</span>`)
    if (t.done && t.doneAt) meta.push(`<span>${hhmm(t.doneAt)} 綻放</span>`)
    if (overdue) meta.push(`<span>${esc(t.date.slice(5).replace('-', '/'))}</span>`)
    return `<li class="item ${t.done ? 'done' : ''} ${this.hlKey === 'task:' + t.id ? 'hl' : ''}" data-id="${esc(t.id)}" style="--c:${tag.color}">
      <button class="check" data-act="toggle" aria-label="完成">${ICON.check}</button>
      <div class="item-main">
        <div class="item-title">${esc(t.title)}</div>
        <div class="item-meta">${meta.join('')}</div>
      </div>
      <div class="item-actions">
        ${overdue ? `<button class="mini" data-act="today" title="移到今天">${ICON.today}</button>` : ''}
        <button class="mini" data-act="edit" title="編輯">${ICON.edit}</button>
        <button class="mini" data-act="delete" title="刪除">${ICON.del}</button>
      </div>
    </li>`
  }

  renderTasks() {
    const s = this.store
    const tasks = s.tasksOn(s.selectedDate)
    const todo = tasks.filter((t) => !t.done).sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
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
    const hint = matchMedia('(pointer: fine)').matches ? '（按 N 快速輸入）' : ''
    $('#taskTitle').placeholder = isToday ? `種下一個任務…${hint}` : `為 ${s.selectedDate.slice(5).replace('-', '/')} 種下任務…`

    const overdue = isToday ? s.overdue() : []
    $('#overdueBox').innerHTML = overdue.length
      ? `<div class="overdue"><h4><span>還沒完成的昨日花苞 · ${overdue.length}</span><button data-act="allToday">全部移到今天</button></h4><ul class="list">${overdue.map((t) => this._taskItem(t, true)).join('')}</ul></div>`
      : ''

    $('#taskList').innerHTML = n
      ? [...todo, ...done].map((t) => this._taskItem(t)).join('')
      : `<li class="empty"><span class="em">ひとつめの種を</span>輸入任務並按 Enter，花圃就會長出一株花苞。<br>完成時它會綻放，もち也會跑來慶祝。</li>`
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
    const list = $('#eventList')
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.tl-item')
      if (!li) return
      const id = li.dataset.id
      const act = e.target.closest('[data-act]')?.dataset.act
      const s = this.store
      if (act === 'toggle') s.toggleEvent(id)
      else if (act === 'delete') armConfirm(e.target.closest('button'), ICON.check, () => s.deleteEvent(id))
      else if (act === 'edit') this._editEvent(li, id)
      else if (!act && !e.target.closest('input')) this.hooks.focusEvent(id)
    })
    list.addEventListener('mouseover', (e) => this.hooks.hoverEvent(e.target.closest('.tl-item')?.dataset.id || null))
    list.addEventListener('mouseleave', () => this.hooks.hoverEvent(null))
  }

  _editEvent(li, id) {
    const ev = this.store.state.events.find((x) => x.id === id)
    const box = $('.item', li)
    box.innerHTML = `<form class="event-edit">
      <input class="inline-input" name="title" value="${esc(ev.title)}" maxlength="60" />
      <div class="form-row"><label class="time-field"><input type="time" name="start" value="${ev.start}"></label><span class="tilde">〜</span>
      <label class="time-field"><input type="time" name="end" value="${ev.end}"></label>
      <button class="btn-primary" type="submit">儲存</button></div></form>`
    const form = $('form', box)
    form.title.focus()
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      let start = form.start.value || ev.start
      let end = form.end.value || ev.end
      if (toMin(end) <= toMin(start)) end = minToHHMM(Math.min(toMin(start) + 30, 1439))
      this.store.updateEvent(id, { title: form.title.value.trim() || ev.title, start, end })
    })
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.renderSchedule()
      e.stopPropagation()
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
    const s = this.store
    const events = s.eventsOn(s.selectedDate)
    // 背景的每分鐘刷新不要打斷正在編輯的日程
    const editing = $('#eventList .event-edit')?.closest('.tl-item')
    if (!force && editing && events.some((e) => e.id === editing.dataset.id)) return
    const isToday = s.selectedDate === s.today
    const now = new Date().getHours() * 60 + new Date().getMinutes()
    let html = ''
    let nowPlaced = !isToday
    const nowLine = `<li class="now-line"><span>現在 ${minToHHMM(now)}</span></li>`
    for (const e of events) {
      const m0 = toMin(e.start)
      const m1 = toMin(e.end)
      if (!nowPlaced && m0 > now) {
        html += nowLine
        nowPlaced = true
      }
      const c = EVENT_COLORS[e.color % EVENT_COLORS.length]
      const past = isToday ? m1 <= now : s.selectedDate < s.today
      const current = isToday && m0 <= now && now < m1
      const dur = m1 - m0
      html += `<li class="tl-item ${past ? 'past' : ''} ${current ? 'now' : ''} ${e.done ? 'done' : ''}" data-id="${esc(e.id)}" style="--c:${c}">
        <div class="item ${e.done ? 'done' : ''} ${this.hlKey === 'event:' + e.id ? 'hl' : ''}">
          <div class="tl-time">${esc(e.start)}<small>〜 ${esc(e.end)} · ${dur >= 60 ? (dur / 60).toFixed(dur % 60 ? 1 : 0) + 'h' : dur + 'm'}</small></div>
          <div class="item-main"><div class="item-title">${esc(e.title)} ${current ? '<span class="badge-now">進行中</span>' : ''}</div>${this.store.routineOf(e) ? `<div class="item-meta"><span class="rep">↻ ${esc(repeatLabel(this.store.routineOf(e).repeat))}</span></div>` : ''}</div>
          <div class="item-actions">
            <button class="mini" data-act="edit" title="編輯">${ICON.edit}</button>
            <button class="mini" data-act="delete" title="刪除">${ICON.del}</button>
          </div>
          <button class="check" data-act="toggle" aria-label="完成" style="--c:${c}">${ICON.check}</button>
        </div>
      </li>`
    }
    if (!nowPlaced && events.length) html += nowLine
    $('#eventList').innerHTML = events.length
      ? html
      : `<li class="empty"><span class="em">よていなし</span>這天還沒有日程。<br>加入後會在小島外圈的時之環上亮起一段光帶。</li>`
  }

  // ── 專案 ──
  _bindProjects() {
    const form = $('#projectForm')
    $('#newProjectBtn').onclick = () => {
      if (this.store.freeSlot() < 0) {
        this.toast({ icon: '塔', title: '島上的空地滿了', sub: `最多同時 ${MAX_PROJECTS} 座塔，先收藏已完成的專案吧` })
        return
      }
      form.hidden = false
      $('#newProjectBtn').hidden = true
      $('#projectDeadline').value = addDays(this.store.today, 14)
      $('#projectName').focus()
    }
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
      this.hooks.focusProject(p.id)
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
      else if (act === 'rename') inlineEdit($('.proj-name', card), p.name, (v) => (v ? s.updateProject(id, { name: v }) : this.renderProjects()))
      else if (act === 'color') s.updateProject(id, { color: (p.color + 1) % PROJECT_COLORS.length })
      else if (act === 'archive') s.archiveProject(id, true)
      else if (act === 'restore') {
        if (!s.archiveProject(id, false)) this.toast({ icon: '塔', title: '島上的空地滿了', sub: '先收藏其他專案再放回來吧' })
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
    $('#projectList').addEventListener('mouseover', (e) => this.hooks.hoverProject(e.target.closest('.proj')?.dataset.id || null))
    $('#projectList').addEventListener('mouseleave', () => this.hooks.hoverProject(null))
  }

  _deadlineText(p) {
    if (!p.deadline) return ''
    if (p.completedAt && this.store.progress(p) >= 1) return `<span>已於 ${new Date(p.completedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} 落成</span>`
    const d = daysBetween(this.store.today, p.deadline)
    const md = p.deadline.slice(5).replace('-', '/')
    if (d < 0) return `<span class="warn">已逾期 ${-d} 天（${md}）</span>`
    if (d === 0) return `<span class="warn">今天截止</span>`
    return `<span class="${d <= 2 ? 'warn' : ''}">截止 ${md} · 剩 ${d} 天</span>`
  }

  _projectCard(p, archived = false) {
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
    return `<div class="proj ${this.hlKey === 'project:' + p.id ? 'hl' : ''}" data-id="${esc(p.id)}" style="--c:${c}">
      <div class="proj-head"><div class="proj-name">${esc(p.name)}</div><div class="proj-pct">${pct}%</div></div>
      <div class="proj-meta">${this._deadlineText(p)}<span>${doneN} / ${p.milestones.length} 個里程碑</span></div>
      <div class="proj-bar">${p.milestones.map((m) => `<i class="${m.done ? 'on' : ''}"></i>`).join('') || '<i></i>'}</div>
      ${archived ? '' : `<ul class="ms-list">${ms}</ul>
      <form class="ms-add"><input placeholder="新增里程碑（塔會多一層）" maxlength="60" /><button class="mini" type="submit" title="新增">${ICON.plus}</button></form>`}
      <div class="proj-actions">
        ${archived
          ? `<button data-act="restore">放回島上</button><button data-act="delete">刪除</button>`
          : `<button data-act="view">在島上查看</button><button data-act="rename">改名</button><button data-act="color">換色</button><button data-act="archive">收藏</button><button data-act="delete">刪除</button>`}
      </div>
    </div>`
  }

  renderProjects() {
    const s = this.store
    const active = s.activeProjects().sort((a, b) => a.createdAt - b.createdAt)
    const archived = s.state.projects.filter((p) => p.archived)
    $('#projectList').innerHTML = active.length
      ? active.map((p) => this._projectCard(p)).join('')
      : `<div class="empty"><span class="em">まっさらな島</span>建立專案並寫下里程碑，<br>每完成一個，島上的塔就會蓋高一層。</div>`
    $('#archiveBox').hidden = !archived.length
    $('#archiveList').innerHTML = archived.map((p) => this._projectCard(p, true)).join('')
    if (this._keepMsFocus) {
      $(`.proj[data-id="${CSS.escape(this._keepMsFocus)}"] .ms-add input`)?.focus()
      this._keepMsFocus = null
    }
  }

  // ── 紀錄 ──
  _bindRecords() {
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
    $('#resetBtn').onclick = (e) => armConfirm(e.currentTarget, '再按一次，清空所有資料', () => this.store.reset())
  }

  renderRecords() {
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
        return `<div class="wk ${d === s.today ? 'today' : ''}" title="${d}：任務 ${v.tasks}、番茄鐘 ${v.pomodoros}、+${v.xp} XP">
          <span class="wk-n">${v.tasks || ''}</span><div class="wk-bar ${v.tasks ? '' : 'zero'}" style="height:${Math.max(3, h * 0.72)}%"></div><span class="wk-d">${WEEK_ZH[wd]}</span></div>`
      })
      .join('')

    const lv = s.level.level
    $('#unlockList').innerHTML = UNLOCKS.map(
      (u) => `<li class="${lv >= u.level ? 'got' : ''}"><b>Lv.${u.level}</b>${u.name}<small>${lv >= u.level ? u.jp : '未解鎖'}</small></li>`,
    ).join('')

    const got = s.player.achievements
    const n = ACHIEVEMENTS.filter((a) => got[a.id]).length
    $('#achCount').textContent = `${n} / ${ACHIEVEMENTS.length}`
    $('#achGrid').innerHTML = ACHIEVEMENTS.map((a) => {
      const ok = !!got[a.id]
      return `<div class="stamp ${ok ? '' : 'locked'}">
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

    const d = parseDate(s.selectedDate)
    $('#dateNum').textContent = `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`
    $('#dateWeek').textContent = WEEK_JP[d.getDay()]
    const diff = daysBetween(s.today, s.selectedDate)
    $('#dateRel').textContent = { 0: '今天', 1: '明天', [-1]: '昨天' }[diff] ?? (diff > 0 ? `${diff} 天後` : `${-diff} 天前`)
    $('#todayBtn').hidden = diff === 0

    const sound = s.state.settings.sound
    $('#soundBtn').classList.toggle('off', !sound)
    $('#soundBtn').title = sound ? '音效：開' : '音效：關'

    $('#questList').innerHTML = $('#questMini').innerHTML = s
      .quests()
      .map((q) => {
        const act = q.claimed
          ? `<span class="q-done">済</span>`
          : q.ready
            ? `<button class="q-claim" data-q="${q.id}">領取</button>`
            : `<span class="q-xp">+30 XP</span>`
        return `<li class="quest ${q.claimed ? 'claimed' : ''}" title="${q.sub}">
          <span>${q.title} <small style="color:var(--ink-faint)">${q.value}/${q.goal}</small></span>
          <div class="q-act">${act}</div>
          <div class="q-bar"><i style="width:${(q.value / q.goal) * 100}%"></i></div>
        </li>`
      })
      .join('')
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
  }

  tickClock() {
    const n = new Date()
    $('#clock').textContent = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
  }

  // ── 3D ↔ 列表聯動 ──
  highlight(type, id) {
    const key = id ? `${type}:${id}` : null
    if (key === this.hlKey) return
    this.hlKey = key
    $$('.item.hl, .proj.hl').forEach((el) => el.classList.remove('hl'))
    if (!id) return
    const el =
      type === 'task' ? $(`.item[data-id="${CSS.escape(id)}"]`) : type === 'event' ? $(`.tl-item[data-id="${CSS.escape(id)}"] .item`) : $(`.proj[data-id="${CSS.escape(id)}"]`)
    el?.classList.add('hl')
  }

  reveal(type, id) {
    this.setTab({ task: 'tasks', event: 'schedule', project: 'projects' }[type])
    this.highlight(type, id)
    const el =
      type === 'task' ? $(`.item[data-id="${CSS.escape(id)}"]`) : type === 'event' ? $(`.tl-item[data-id="${CSS.escape(id)}"]`) : $(`.proj[data-id="${CSS.escape(id)}"]`)
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
    try {
      const saved = JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null')
      if (saved && saved.mode !== 'idle') Object.assign(this, saved)
    } catch {}
    $('#focusBtn').onclick = () => this.toggle()
    $('#focusStop').onclick = () => this.stop()
    setInterval(() => this.tick(), 250)
    this.render()
    if (this.mode === 'focus' && this.paused == null && this.endAt > Date.now()) hooks.focusStarted(true)
  }

  _save() {
    localStorage.setItem(FOCUS_KEY, JSON.stringify({ mode: this.mode, endAt: this.endAt, paused: this.paused }))
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
      this.hooks.focusStarted()
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
        this.hooks.focusFinished(Math.max(1, Math.round(this.focusMin)))
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
    $('#focusLabel').textContent = this.paused != null ? '暫停中' : label
    $('#focusIcon').innerHTML = this.mode !== 'idle' && this.paused == null ? ICON.pause : ICON.play
    $('#focusStop').hidden = this.mode === 'idle'
    $('#focusBtn').title = this.mode === 'idle' ? '開始專注 (F)' : this.paused != null ? '繼續' : '暫停'
    const frac = this.mode === 'idle' ? 0 : 1 - left / this.total
    $('#focusArc').style.strokeDashoffset = 119.4 * (1 - frac)
    document.title = this.mode === 'idle' ? 'ひより日和 · 日程小島' : `${$('#focusTime').textContent} ${this.mode === 'focus' ? '專注中' : '休息中'} · ひより`
  }
}
