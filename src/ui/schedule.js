import './schedule.css'
import { $, esc, ICON, armConfirm, WEEK_ZH } from './dom.js'
import { EVENT_COLORS, TAGS, tagOf, PRIORITIES } from '../theme.js'
import { addDays, parseDate, toMin, minToHHMM, weekKey } from '../store.js'
import { rhythmBlocks, itemBlocks, findConflicts, taskDur, fmtDur, nearestSlot, optimizeDay, awake, PEAKS, sleepMinutes } from '../planner.js'

// 日程分頁：週條、早晨的睡眠小卡、排程列、還沒排時段的任務、可拖曳的一日時間軸、作息設定與編輯面板

const PX = 1.1 // 時間軸每分鐘幾像素
const MIN_H = 22 // 區塊最矮的高度
const hm = (m) => minToHHMM(Math.max(0, Math.min(1439, Math.round(m))))
const snap = (m) => Math.round(m / 5) * 5
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const nowMin = () => {
  const n = new Date()
  return n.getHours() * 60 + n.getMinutes()
}
const QUALITY = ['', '沒睡好', '不太好', '普通', '不錯', '很好']
const DURS = [15, 30, 45, 60, 90, 120, 180]
const SKIP_KEY = 'hiyori-sleep-skip'

// 重疊的區塊並排：同一群互相重疊的區塊平分寬度
function lanes(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const minLen = MIN_H / PX
  let group = []
  let ends = []
  let groupEnd = -1
  const flush = () => {
    const n = Math.max(1, ...group.map((x) => x.lane + 1))
    for (const x of group) x.lanes = n
    group = []
    ends = []
  }
  for (const it of sorted) {
    const end = Math.max(it.end, it.start + minLen)
    if (group.length && it.start >= groupEnd) flush()
    let lane = ends.findIndex((e) => e <= it.start)
    if (lane < 0) lane = ends.length
    ends[lane] = end
    it.lane = lane
    group.push(it)
    groupEnd = Math.max(groupEnd, end)
  }
  flush()
  return sorted
}

export class ScheduleView {
  constructor(store, hooks) {
    this.store = store
    this.hooks = hooks
    this.preview = null // 最佳化時程的預覽 { date, result }
    this.drag = null
    this.scrolledFor = ''
    this.editing = null
    this.range = [0, 1440]
    this._bind()
  }

  // ── 渲染 ──
  render(force = true) {
    // 拖曳中不要重畫（每分鐘的刷新也一樣）
    if (this.drag?.moved) return
    const s = this.store
    if (this.preview && (this.preview.date !== s.selectedDate || s.selectedDate < s.today)) this.preview = null
    this._week()
    this._sleepCard()
    this._planBar()
    this._tray()
    this._dayline()
    if (force) this._rhythm()
  }

  _week() {
    const s = this.store
    const mon = weekKey(s.selectedDate)
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i))
    $('#weekStrip').innerHTML =
      `<button class="ws-nav" data-week="-7" aria-label="上一週">${ICON.prev}</button>` +
      days
        .map((d) => {
          const dd = parseDate(d)
          const ev = s.eventsOn(d).length
          const left = s.tasksOn(d).filter((t) => !t.done).length
          return `<button class="ws-day ${d === s.selectedDate ? 'on' : ''} ${d === s.today ? 'today' : ''} ${dd.getDay() % 6 === 0 ? 'weekend' : ''}" data-date="${d}">
            <small>${WEEK_ZH[dd.getDay()]}</small><b>${dd.getDate()}</b><i>${ev ? '<em class="e"></em>' : ''}${left ? '<em class="t"></em>' : ''}</i></button>`
        })
        .join('') +
      `<button class="ws-nav" data-week="7" aria-label="下一週">${ICON.next}</button>` +
      `<button class="ws-nav ws-cal" data-cal title="打開日曆（C）" aria-label="打開日曆">${ICON.cal}</button>`
  }

  // 早上還沒記睡眠時，邀請記一下
  _sleepCard() {
    const s = this.store
    const el = $('#sleepCard')
    if (el.contains(document.activeElement)) return
    const h = new Date().getHours()
    let skip = ''
    try {
      skip = localStorage.getItem(SKIP_KEY) || ''
    } catch {}
    if (s.selectedDate !== s.today || s.state.sleep[s.today] || h < 4 || h >= 14 || skip === s.today) {
      el.innerHTML = ''
      return
    }
    const r = s.state.rhythm
    el.innerHTML = `<form class="sleep-card">
      <div class="sc-head"><span class="stamp-k" style="--mc:#a9a3e6">眠</span>
        <div><b>昨晚睡得好嗎？</b><small>記下來，ふじ會幫你留意作息</small></div>
        <button type="button" class="mini" data-skip title="今天先不記" aria-label="今天先不記">${ICON.close}</button></div>
      <div class="form-row">
        <label class="time-field">就寢 <input type="time" name="bed" value="${r.sleep}"></label><span class="tilde">→</span>
        <label class="time-field">起床 <input type="time" name="wake" value="${r.wake}"></label>
      </div>
      <div class="form-row sc-foot"><div class="seg" data-q>${[1, 2, 3, 4, 5].map((q) => `<button type="button" data-v="${q}" class="${q === 3 ? 'on' : ''}">${QUALITY[q]}</button>`).join('')}</div>
        <button class="btn-primary" type="submit">記下</button></div>
    </form>`
  }

  // 目前已排的狀況（不含還沒排的任務）
  _current(date) {
    const s = this.store
    return optimizeDay({
      tasks: s.tasksOn(date).filter((t) => t.at), events: s.eventsOn(date), rhythm: s.state.rhythm, date, today: s.today,
      nowMin: date === s.today ? nowMin() : null,
    })
  }

  _planBar() {
    const s = this.store
    const date = s.selectedDate
    const past = date < s.today
    const tasks = s.planTasks(date)
    const placed = s.tasksOn(date).filter((t) => t.at && !t.done)
    const unplaced = tasks.filter((t) => !t.at && !t.done)
    const p = this.preview?.result
    let html
    if (p) {
      html = `<div class="pb-preview">
        <div class="pb-msg">${ICON.spark}<div><b>${p.plan.length ? `預覽：排入 ${p.plan.length} 件` : '暫時沒有可排入的任務'}</b>${p.endAt ? `<small>預計 ${p.endAt} 任務結束・虛線是預覽</small>` : ''}
          ${p.left.length ? `<small class="warn">還有 ${p.left.length} 件未排入，改天安排也可以</small>` : ''}</div></div>
        <div class="pb-btns"><button class="btn-ghost" data-plan="cancel">取消</button>
          ${placed.length && !this.preview.replan ? '<button class="btn-ghost" data-plan="replan">重排未開始的任務</button>' : ''}
          <button class="btn-primary" data-plan="apply" ${p.plan.length ? '' : 'disabled'}>套用</button></div></div>`
    } else {
      const cur = this._current(date)
      const sl = s.state.sleep[date]
      html = `<div class="pb-stats">
          <span><b>${fmtDur(cur.load)}</b>任務已排</span>
          <span><b>${past ? '—' : fmtDur(cur.free)}</b>空檔</span>
          <span><b>${cur.endAt || '—'}</b>任務結束</span>
          ${sl ? `<span title="${sl.bed} → ${sl.wake}"><b>${fmtDur(sleepMinutes(sl))}</b>睡眠</span>` : ''}
        </div>
        <div class="pb-btns">
          ${placed.length ? '<button class="btn-ghost" data-plan="clear">清除任務時段</button>' : ''}
          <button class="btn-primary pb-opt" data-plan="optimize" ${past || (!unplaced.length && !placed.length) ? 'disabled' : ''} title="${past ? '只能替今天和之後的日子排時段' :'把還沒排的任務放進空檔'}">${ICON.spark}最佳化時程</button>
        </div>`
    }
    $('#planBar').innerHTML = html
    $('#planBar').classList.toggle('previewing', !!p)
  }

  _tray() {
    const s = this.store
    const date = s.selectedDate
    const list = s.planTasks(date).filter((t) => !t.at && !t.done)
    const planned = new Set(this.preview?.result.plan.map((p) => p.id) || [])
    $('#planTray').innerHTML = list.length
      ? `<div class="tray-head">還沒排時段<small>點一下放進最近的空檔，或拖到時間軸上</small></div>
        <div class="tray-list">${list
          .map(
            (t) => `<div class="chip-task ${planned.has(t.id) ? 'planned' : ''} ${t.date < date ? 'late' : ''}" data-id="${esc(t.id)}" style="--c:${tagOf(t.tag).color}" role="button" tabindex="0">
              <i class="pri p${t.priority}" title="${PRIORITIES[t.priority].label}優先"></i>${t.star ? '<em class="star" title="本命">★</em>' : ''}${t.date < date ? '<em class="late-tag">逾期</em>' : ''}
              <span>${esc(t.title)}</span><button type="button" class="dur" data-dur title="預估時間（點一下調整）">${fmtDur(taskDur(t))}</button></div>`,
          )
          .join('')}</div>`
      : ''
  }

  _dayline() {
    const s = this.store
    const date = s.selectedDate
    const r = s.state.rhythm
    const events = s.eventsOn(date)
    const tasks = s.tasksOn(date).filter((t) => t.at)
    const blocks = itemBlocks(events, tasks)
    const clash = findConflicts(blocks)
    const ghosts = (this.preview?.result.plan || []).map((p) => ({ id: p.id, kind: 'ghost', start: toMin(p.at), end: toMin(p.at) + p.dur }))
    const [wake, sleep] = awake(r)
    const all = [...blocks, ...ghosts]
    const from = clamp(Math.floor((Math.min(wake, ...all.map((b) => b.start)) - 30) / 60) * 60, 0, 1380)
    const to = clamp(Math.ceil((Math.max(sleep, ...all.map((b) => b.end)) + 15) / 60) * 60, from + 60, 1440)
    this.range = [from, to]
    const y = (m) => (m - from) * PX
    let grid = ''
    for (let m = from; m <= to; m += 60) grid += `<div class="dl-hour" style="top:${y(m)}px"><span>${String(m / 60).padStart(2, '0')}:00</span></div>`
    let bands = ''
    for (const b of rhythmBlocks(r, date)) {
      const a = Math.max(from, b.start)
      const z = Math.min(to, b.end)
      if (z <= a) continue
      const style = `top:${y(a)}px;height:${(z - a) * PX}px`
      if (b.kind === 'work') bands += `<div class="dl-work" style="${style}" title="${b.label} ${hm(b.start)}–${hm(b.end)}"></div>`
      else bands += `<div class="dl-band ${b.kind}" style="${style}"><span>${b.kind === 'sleep' ? '睡眠' : esc(b.label)}</span></div>`
    }
    const peak = PEAKS[r.peak]?.range
    if (peak) bands += `<div class="dl-peak" style="top:${y(Math.max(from, peak[0]))}px;height:${Math.max(0, (Math.min(to, peak[1]) - Math.max(from, peak[0])) * PX)}px" title="精神最好的時段"></div>`

    const byId = new Map([...events.map((e) => [e.id, e]), ...s.planTasks(date).map((t) => [t.id, t])])
    const isToday = date === s.today
    const now = nowMin()
    const html = lanes([...blocks, ...ghosts])
      .map((b) => {
        const item = byId.get(b.id)
        if (!item) return ''
        const h = Math.max(MIN_H, (b.end - b.start) * PX - 2)
        const pos = `top:${y(b.start)}px;height:${h}px;left:calc(${(b.lane / b.lanes) * 100}% + 2px);width:calc(${100 / b.lanes}% - 4px)`
        const short = h < 38 ? 'short' : ''
        const time = `${hm(b.start)}–${hm(Math.min(b.end, 1439))}`
        if (b.kind === 'ghost') {
          return `<div class="blk ghost ${short}" style="${pos};--c:${tagOf(item.tag).color}"><div class="blk-txt"><b>${esc(item.title)}</b><small>${time}</small></div></div>`
        }
        const ev = b.kind === 'event'
        const c = ev ? EVENT_COLORS[item.color % EVENT_COLORS.length] : tagOf(item.tag).color
        const others = clash.get(b.id)
        const past = isToday ? b.end <= now : date < s.today
        const meta = others ? `時間和 ${others.length} 件重疊` : ev ? (item.note ? esc(item.note) : '') : `${PRIORITIES[item.priority].label}優先${item.star ? '・本命' : ''}`
        return `<div class="blk ${ev ? 'ev' : 'tk'} ${item.done ? 'done' : ''} ${others ? 'clash' : ''} ${past && !item.done ? 'past' : ''} ${short}"
          data-type="${ev ? 'event' : 'task'}" data-id="${esc(b.id)}" data-start="${b.start}" data-end="${b.end}" style="${pos};--c:${c}">
          <button class="check" data-act="toggle" aria-label="切換完成狀態" style="--c:${c}">${ICON.check}</button>
          <div class="blk-txt"><b>${ev ? '' : item.star ? '<em class="star">★</em>' : ''}${esc(item.title)}</b><small><span class="blk-time">${time}</span>${meta ? `・${meta}` : ''}</small></div>
          <i class="blk-resize" data-resize title="拖曳調整長度"></i>
        </div>`
      })
      .join('')
    const nowLine = isToday && now >= from && now <= to ? `<div class="dl-now" style="top:${y(now)}px"><span>${hm(now)}</span></div>` : ''
    const empty = !blocks.length && !ghosts.length
    $('#dayline').innerHTML = `<div class="dl-body" style="height:${(to - from) * PX}px">
      ${grid}<div class="dl-lane">${bands}${html}${nowLine}<div class="dl-drop" hidden></div></div></div>
      ${empty ? `<p class="dl-empty">${date < s.today ? '這天沒有排時段。' : '可以點空白處新增日程，或用「最佳化時程」安排任務。'}</p>` : ''}`
    // 換日期時捲到現在（今天）或起床時間
    if (this.scrolledFor !== date) {
      this.scrolledFor = date
      const box = $('#dayline')
      box.scrollTop = Math.max(0, y(isToday ? now - 60 : wake - 30))
    }
  }

  // 作息設定（摺疊在最下面）
  _rhythm() {
    const el = $('#rhythmForm')
    if (el.contains(document.activeElement)) return
    const r = this.store.state.rhythm
    const time = (attr, v) => `<label class="time-field"><input type="time" ${attr} value="${v}"></label>`
    el.innerHTML = `
      <div class="rf-row"><span class="rf-k">起床</span>${time('data-r="wake"', r.wake)}<span class="rf-k">就寢</span>${time('data-r="sleep"', r.sleep)}</div>
      <div class="rf-sub">三餐與固定休息<small>排程會避開</small></div>
      <ul class="rf-meals">${r.meals
        .map(
          (m, i) => `<li data-i="${i}"><input class="rf-label" data-m="label" value="${esc(m.label)}" maxlength="12" aria-label="名稱">
            ${time('data-m="start"', m.start)}<span class="tilde">〜</span>${time('data-m="end"', m.end)}
            <button type="button" class="mini" data-meal-del title="移除" aria-label="移除">${ICON.del}</button></li>`,
        )
        .join('')}</ul>
      ${r.meals.length < 6 ? '<button type="button" class="btn-ghost rf-add" data-meal-add>＋ 新增時段</button>' : ''}
      <div class="rf-sub">工作／上課時段<small>工作、學習類的任務會優先排進來</small></div>
      <div class="rf-row"><button type="button" class="chip-toggle ${r.work ? 'on' : ''}" data-work-toggle>${r.work ? '有固定時段' : '沒有固定時段'}</button>
        ${r.work ? `${time('data-w="start"', r.work.start)}<span class="tilde">〜</span>${time('data-w="end"', r.work.end)}` : ''}</div>
      ${r.work ? `<div class="rf-days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-wd="${d}" class="${r.work.days.includes(d) ? 'on' : ''}">${WEEK_ZH[d]}</button>`).join('')}</div>` : ''}
      <div class="rf-sub">精神最好的時段<small>重要的任務會優先排在這裡</small></div>
      <div class="seg rf-peak" data-peak>${Object.entries(PEAKS).map(([k, p]) => `<button type="button" data-v="${k}" class="${r.peak === k ? 'on' : ''}">${p.label}</button>`).join('')}</div>
      <div class="rf-row"><span class="rf-k">時段之間留</span><select data-r="buffer" aria-label="緩衝時間">${[0, 5, 10, 15, 20, 30].map((v) => `<option value="${v}" ${r.buffer === v ? 'selected' : ''}>${v ? `${v} 分鐘` : '不留'}</option>`).join('')}</select></div>
      <div class="rf-row"><button type="button" class="chip-toggle ${r.bedRemind ? 'on' : ''}" data-bed>就寢前 30 分鐘，ふじ提醒你：${r.bedRemind ? '開' : '關'}</button></div>`
  }

  // ── 編輯面板 ──
  openEdit(type, id) {
    const s = this.store
    const item = type === 'event' ? s.state.events.find((e) => e.id === id) : s.state.tasks.find((t) => t.id === id)
    if (!item) return
    this.editing = { type, id, create: false, color: item.color ?? 0, priority: item.priority ?? 2, tag: item.tag ?? 'life' }
    this._sheet(item)
  }
  openCreate(minute) {
    const color = (this.lastColor ?? -1) + 1
    this.editing = { type: 'event', id: null, create: true, color: color % EVENT_COLORS.length }
    this._sheet({ title: '', date: this.store.selectedDate, start: hm(minute), end: hm(Math.min(1439, minute + 60)), note: '' })
  }
  closeEdit() {
    $('#editSheet').hidden = true
    this.editing = null
  }

  _sheet(item) {
    const ed = this.editing
    const ev = ed.type === 'event'
    const routine = this.store.routineOf(item)
    const swatches = EVENT_COLORS.map((c, i) => `<button type="button" data-color="${i}" style="--c:${c}" class="${i === ed.color ? 'on' : ''}" aria-label="顏色 ${i + 1}"></button>`).join('')
    const body = ev
      ? `<div class="ec-grid">
          <label>日期<input type="date" name="date" value="${item.date}" required></label>
          <label>開始<input type="time" name="start" value="${item.start}" required></label>
          <label>結束<input type="time" name="end" value="${item.end}" required></label>
        </div>
        <div class="swatches ec-colors">${swatches}</div>
        <textarea name="note" maxlength="200" rows="2" placeholder="備註：地點、要帶的東西…">${esc(item.note || '')}</textarea>`
      : `<div class="ec-grid">
          <label>日期<input type="date" name="date" value="${item.date}" required></label>
          <label>開始<input type="time" name="at" value="${item.at || ''}"></label>
          <label>預估時間<select name="dur">${[...new Set([...DURS, taskDur(item)])].sort((a, b) => a - b).map((d) => `<option value="${d}" ${d === taskDur(item) ? 'selected' : ''}>${fmtDur(d)}</option>`).join('')}</select></label>
        </div>
        <div class="form-row"><div class="seg" data-pri>${[1, 2, 3].map((p) => `<button type="button" data-v="${p}" class="${p === ed.priority ? 'on' : ''}">${PRIORITIES[p].label}</button>`).join('')}</div></div>
        <div class="tag-pick">${TAGS.map((t) => `<button type="button" data-tag="${t.id}" style="--c:${t.color}" class="${t.id === ed.tag ? 'on' : ''}"><i></i>${t.label}</button>`).join('')}</div>`
    $('#editSheet').innerHTML = `<form class="modal-card edit-card glass" autocomplete="off">
      <div class="modal-kicker">${ed.create ? 'あたらしいよてい' : ev ? 'よてい' : 'タスク'}</div>
      <input name="title" class="ec-title" maxlength="${ev ? 60 : 80}" placeholder="${ev ? '日程名稱，例如：牙醫' : '任務名稱'}" value="${esc(item.title)}" required>
      ${body}
      ${routine ? `<p class="hint ec-hint">這是例行${ev ? '日程' : '任務'}，這裡只改這一天</p>` : ''}
      <div class="ec-actions">
        ${ed.create ? '' : `<button type="button" class="btn-ghost danger" data-ec="delete">刪除</button>
          <button type="button" class="btn-ghost" data-ec="done">${item.done ? '改回未完成' : '完成'}</button>`}
        ${!ev && !item.done ? `<button type="button" class="btn-ghost" data-ec="slot">${item.at ? '移到最近空檔' : '排進最近空檔'}</button>` : ''}
        ${!ev && item.at ? '<button type="button" class="btn-ghost" data-ec="unplan">移回未排時段</button>' : ''}
        <span class="sp"></span>
        <button type="button" class="btn-ghost" data-ec="cancel">取消</button>
        <button class="btn-primary" type="submit">${ed.create ? '加入' : '儲存'}</button>
      </div>
    </form>`
    $('#editSheet').hidden = false
    const title = $('#editSheet [name="title"]')
    if (ed.create) title.focus()
  }

  _saveSheet(form) {
    const s = this.store
    const ed = this.editing
    const title = form.title.value.trim()
    if (!title) return form.title.focus()
    const date = form.date.value || s.selectedDate
    if (ed.type === 'event') {
      const start = form.start.value || '09:00'
      let end = form.end.value || '10:00'
      if (toMin(end) <= toMin(start)) end = hm(toMin(start) + 30)
      const note = form.note.value.trim().slice(0, 200)
      if (ed.create) {
        s.addEvent({ title, start, end, color: ed.color, date, note })
        this.lastColor = ed.color
      } else s.updateEvent(ed.id, { title, start, end, color: ed.color, date, note })
    } else {
      const at = form.at.value || null
      s.updateTask(ed.id, { title, date, priority: ed.priority, tag: ed.tag, at, dur: +form.dur.value })
    }
    this.closeEdit()
  }

  // 把任務放進最近的空檔
  _slot(id) {
    const s = this.store
    const t = s.state.tasks.find((x) => x.id === id)
    if (!t) return
    const date = s.selectedDate < s.today ? s.today : s.selectedDate
    const hit = nearestSlot({
      task: t, tasks: s.tasksOn(date).filter((x) => x.at), events: s.eventsOn(date), rhythm: s.state.rhythm, date, today: s.today,
      nowMin: date === s.today ? nowMin() : null,
    })
    if (!hit) return this.hooks.toast({ icon: '満', title: '可用空檔有點不足', sub: '換個日子安排也可以' })
    if (t.date !== date) s.updateTask(id, { date })
    s.scheduleTask(id, hit.at, t.dur || hit.dur)
  }

  // ── 事件 ──
  _bind() {
    const s = this.store
    $('#weekStrip').addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b) return
      if (b.dataset.date) s.selectDate(b.dataset.date)
      else if (b.dataset.week) s.selectDate(addDays(s.selectedDate, +b.dataset.week))
      else if (b.hasAttribute('data-cal')) this.hooks.openCalendar(s.selectedDate)
    })

    const card = $('#sleepCard')
    card.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q] button')
      if (q) q.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === q))
      if (e.target.closest('[data-skip]')) {
        try {
          localStorage.setItem(SKIP_KEY, s.today)
        } catch {}
        card.innerHTML = ''
      }
    })
    card.addEventListener('submit', (e) => {
      e.preventDefault()
      const f = e.target
      const q = +(f.querySelector('[data-q] .on')?.dataset.v || 0)
      card.innerHTML = ''
      s.logSleep(s.today, { bed: f.bed.value, wake: f.wake.value, q })
    })

    $('#planBar').addEventListener('click', (e) => {
      const act = e.target.closest('[data-plan]')?.dataset.plan
      if (!act) return
      const date = s.selectedDate
      if (act === 'optimize' || act === 'replan') {
        const unplaced = s.planTasks(date).some((t) => !t.at && !t.done)
        const replan = act === 'replan' || !unplaced
        this.preview = { date, replan, result: s.planDay(date, { replan }) }
        this.render(false)
      } else if (act === 'apply') {
        const p = this.preview
        this.preview = null
        if (p) s.applyPlan(p.date, p.result.plan, p.result.left.length)
        if (p?.result.left.length) this.hooks.toast({ icon: '満', title: `還有 ${p.result.left.length} 件未排入`, sub: '這天的空檔有點滿，改天安排也沒關係' })
      } else if (act === 'cancel') {
        this.preview = null
        this.render(false)
      } else if (act === 'clear') armConfirm(e.target.closest('button'), '清除未完成任務的時段？', () => s.clearPlan(date))
    })

    const tray = $('#planTray')
    tray.addEventListener('click', (e) => {
      const dur = e.target.closest('[data-dur]')
      if (!dur) return
      const id = dur.closest('.chip-task').dataset.id
      const t = s.state.tasks.find((x) => x.id === id)
      const cur = taskDur(t)
      s.updateTask(id, { dur: DURS.find((d) => d > cur) || DURS[0] })
    })
    tray.addEventListener('keydown', (e) => {
      const chip = e.target.closest('.chip-task')
      if (chip && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-dur]')) {
        e.preventDefault()
        this._slot(chip.dataset.id)
      }
    })
    tray.addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.chip-task')
      if (!chip || e.target.closest('[data-dur]') || e.button > 0) return
      this._startDrag(e, { kind: 'chip', id: chip.dataset.id, el: chip })
    })

    const line = $('#dayline')
    line.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('[data-act]')) return
      const blk = e.target.closest('.blk:not(.ghost)')
      if (blk) {
        this._startDrag(e, {
          kind: 'block', type: blk.dataset.type, id: blk.dataset.id, el: blk, resize: !!e.target.closest('[data-resize]'),
          start: +blk.dataset.start, end: +blk.dataset.end,
        })
      } else if (e.target.closest('.dl-lane')) this._startDrag(e, { kind: 'empty' })
    })
    line.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="toggle"]')
      if (!b) return
      const blk = b.closest('.blk')
      if (blk.dataset.type === 'event') s.toggleEvent(blk.dataset.id)
      else s.toggleTask(blk.dataset.id)
    })
    line.addEventListener('mouseover', (e) => {
      const blk = e.target.closest('.blk.ev')
      this.hooks.hoverEvent(blk?.dataset.id || null)
    })
    line.addEventListener('mouseleave', () => this.hooks.hoverEvent(null))
    // 觸控長按開始拖曳後，阻止面板跟著捲動
    line.addEventListener('touchmove', (e) => this.drag?.armed && e.preventDefault(), { passive: false })
    tray.addEventListener('touchmove', (e) => this.drag?.armed && e.preventDefault(), { passive: false })
    addEventListener('pointermove', (e) => this._moveDrag(e))
    addEventListener('pointerup', (e) => this._endDrag(e))
    addEventListener('pointercancel', () => this._cancelDrag())

    // 作息設定
    const rf = $('#rhythmForm')
    rf.addEventListener('change', (e) => {
      const r = s.state.rhythm
      const el = e.target
      if (el.dataset.r) s.setRhythm({ [el.dataset.r]: el.dataset.r === 'buffer' ? +el.value : el.value })
      else if (el.dataset.w && el.value) s.setRhythm({ work: { ...r.work, [el.dataset.w]: el.value } })
      else if (el.dataset.m) {
        const i = +el.closest('li').dataset.i
        const meals = r.meals.map((m, j) => (j === i ? { ...m, [el.dataset.m]: el.value || m[el.dataset.m] } : m))
        s.setRhythm({ meals })
      }
    })
    rf.addEventListener('click', (e) => {
      const r = s.state.rhythm
      const b = e.target.closest('button')
      if (!b) return
      if (b.hasAttribute('data-meal-add')) {
        const last = r.meals[r.meals.length - 1]
        const start = last ? Math.min(toMin(last.end) + 120, 1380) : 15 * 60
        s.setRhythm({ meals: [...r.meals, { label: '點心', start: hm(start), end: hm(start + 20) }] })
      } else if (b.hasAttribute('data-meal-del')) {
        const i = +b.closest('li').dataset.i
        s.setRhythm({ meals: r.meals.filter((_, j) => j !== i) })
      } else if (b.hasAttribute('data-work-toggle')) s.setRhythm({ work: r.work ? null : { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] } })
      else if (b.dataset.wd) {
        const d = +b.dataset.wd
        const days = r.work.days.includes(d) ? r.work.days.filter((x) => x !== d) : [...r.work.days, d]
        s.setRhythm({ work: { ...r.work, days } })
      } else if (b.closest('[data-peak]')) s.setRhythm({ peak: b.dataset.v })
      else if (b.hasAttribute('data-bed')) s.setRhythm({ bedRemind: !r.bedRemind })
      this._rhythm()
    })

    // 編輯面板
    const sheet = $('#editSheet')
    sheet.addEventListener('submit', (e) => {
      e.preventDefault()
      this._saveSheet(e.target)
    })
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) return this.closeEdit()
      const ed = this.editing
      if (!ed) return
      const color = e.target.closest('[data-color]')
      if (color) {
        ed.color = +color.dataset.color
        sheet.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === color))
      }
      const pri = e.target.closest('[data-pri] button')
      if (pri) {
        ed.priority = +pri.dataset.v
        pri.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === pri))
      }
      const tag = e.target.closest('[data-tag]')
      if (tag) {
        ed.tag = tag.dataset.tag
        sheet.querySelectorAll('[data-tag]').forEach((x) => x.classList.toggle('on', x === tag))
      }
      const act = e.target.closest('[data-ec]')?.dataset.ec
      if (!act) return
      const ev = ed.type === 'event'
      if (act === 'cancel') this.closeEdit()
      else if (act === 'delete') {
        armConfirm(e.target.closest('button'), '確定刪除？', () => {
          this.closeEdit()
          if (ev) s.deleteEvent(ed.id)
          else s.deleteTask(ed.id)
        })
      } else if (act === 'done') {
        this.closeEdit()
        if (ev) s.toggleEvent(ed.id)
        else s.toggleTask(ed.id)
      } else if (act === 'slot') {
        this.closeEdit()
        this._slot(ed.id)
      } else if (act === 'unplan') {
        this.closeEdit()
        s.scheduleTask(ed.id, null)
      }
    })
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeEdit()
      e.stopPropagation()
    })
  }

  // ── 拖曳：時間軸上的區塊（移動、調整長度）、從未排區拖任務進來、點空白處新增 ──
  // 滑鼠直接拖；觸控要長按一下才開始（不然會擋到捲動）
  _startDrag(e, d) {
    this._cancelDrag()
    this.drag = { ...d, x0: e.clientX, y0: e.clientY, moved: false, armed: e.pointerType !== 'touch', pointer: e.pointerId }
    if (e.pointerType === 'touch' && d.kind !== 'empty') {
      this.drag.timer = setTimeout(() => {
        if (!this.drag || this.drag.moved) return
        this.drag.armed = true
        d.el?.classList.add('lift')
        navigator.vibrate?.(8)
      }, 320)
    }
  }

  _cancelDrag() {
    const d = this.drag
    if (!d) return
    clearTimeout(d.timer)
    d.el?.classList.remove('lift', 'dragging')
    d.ghost?.remove()
    $('#dayline .dl-drop')?.setAttribute('hidden', '')
    this.drag = null
  }

  // 指標所在的時間軸分鐘（不在時間軸上回傳 null）
  _minuteAt(x, y) {
    const lane = $('#dayline .dl-lane')
    const box = $('#dayline')
    if (!lane) return null
    const r = lane.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) return null
    return clamp(snap(this.range[0] + (y - r.top) / PX), this.range[0], this.range[1] - 5)
  }

  // 拖到時間軸上下緣時自動捲動
  _edgeScroll(y) {
    const box = $('#dayline')
    const r = box.getBoundingClientRect()
    if (y < r.top + 36) box.scrollTop -= 14
    else if (y > r.bottom - 36) box.scrollTop += 14
  }

  _moveDrag(e) {
    const d = this.drag
    if (!d || e.pointerId !== d.pointer) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    const far = Math.hypot(dx, dy)
    if (!d.armed) {
      // 觸控還沒長按就移動＝在捲動，放棄拖曳
      if (far > 8) this._cancelDrag()
      return
    }
    if (d.kind === 'empty') {
      if (far > 8) this._cancelDrag()
      return
    }
    if (!d.moved && far < 4) return
    if (!d.moved) {
      d.moved = true
      d.el.classList.add('dragging')
      try {
        d.el.setPointerCapture?.(e.pointerId)
      } catch {}
    }
    e.preventDefault()
    if (d.kind === 'block') {
      this._edgeScroll(e.clientY)
      const box = $('#dayline')
      d.scroll0 ??= box.scrollTop
      const delta = snap((dy + box.scrollTop - d.scroll0) / PX)
      const len = d.end - d.start
      if (d.resize) {
        d.nStart = d.start
        d.nEnd = clamp(d.end + delta, d.start + 10, 1440)
      } else {
        d.nStart = clamp(d.start + delta, 0, 1440 - len)
        d.nEnd = d.nStart + len
      }
      d.el.style.top = `${(d.nStart - this.range[0]) * PX}px`
      d.el.style.height = `${Math.max(MIN_H, (d.nEnd - d.nStart) * PX - 2)}px`
      const t = d.el.querySelector('.blk-time')
      if (t) t.textContent = `${hm(d.nStart)}–${hm(Math.min(d.nEnd, 1439))}`
    } else {
      // 從未排區拖出來：跟著指標的小卡，時間軸上顯示會放在哪裡
      if (!d.ghost) {
        d.ghost = d.el.cloneNode(true)
        d.ghost.classList.add('chip-ghost')
        document.body.appendChild(d.ghost)
      }
      d.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY - 14}px)`
      const m = this._minuteAt(e.clientX, e.clientY)
      const drop = $('#dayline .dl-drop')
      if (m == null) drop?.setAttribute('hidden', '')
      else {
        this._edgeScroll(e.clientY)
        const t = this.store.state.tasks.find((x) => x.id === d.id)
        drop.removeAttribute('hidden')
        drop.style.top = `${(m - this.range[0]) * PX}px`
        drop.style.height = `${taskDur(t) * PX}px`
        drop.textContent = `${hm(m)} 開始`
      }
      d.drop = m
    }
  }

  _endDrag(e) {
    const d = this.drag
    if (!d || e.pointerId !== d.pointer) return
    const s = this.store
    clearTimeout(d.timer)
    const clicked = !d.moved && (d.armed || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8)
    this._cancelDrag()
    if (d.kind === 'empty') {
      if (clicked && !e.target.closest('.blk')) {
        const m = this._minuteAt(e.clientX, e.clientY)
        if (m != null) this.openCreate(Math.floor(m / 15) * 15)
      }
      return
    }
    if (!d.moved) {
      if (!clicked) return
      if (d.kind === 'chip') this._slot(d.id)
      else this.openEdit(d.type, d.id)
      return
    }
    if (d.kind === 'chip') {
      if (d.drop == null) return
      const t = s.state.tasks.find((x) => x.id === d.id)
      if (t && t.date !== s.selectedDate) s.updateTask(d.id, { date: s.selectedDate < s.today ? s.today : s.selectedDate })
      s.scheduleTask(d.id, hm(d.drop))
      return
    }
    if (d.nStart == null || (d.nStart === d.start && d.nEnd === d.end)) return this.render(false)
    if (d.type === 'task') s.scheduleTask(d.id, hm(d.nStart), d.resize ? d.nEnd - d.nStart : undefined)
    else s.updateEvent(d.id, { start: hm(d.nStart), end: hm(Math.min(1439, d.nEnd)) })
  }
}

