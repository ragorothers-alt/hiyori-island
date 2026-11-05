import './project.css'
import { $, $$, esc, ICON, armConfirm, inlineEdit, patch, dateLabel } from './dom.js'
import { PROJECT_COLORS, tagOf } from '../theme.js'
import { addDays, daysBetween, parseDate } from '../store.js'
import {
  projectTimeline, taskTimeline, projectStats, activity, msProgress, msSteps, msTasks, taskMilestone, noteHTML, noteTitle, noteSnippet, noteTodos, toggleNoteLine, textHTML,
  projectMarkdown, NOTE_TEMPLATES, dayOf, PROJECT_LIMITS as PL,
} from '../projects.js'
import { aiReady, askAI } from '../ai.js'
import { FUJI_LINES } from '../data/lines.js'

// 專案詳情：目標與統計、進度日誌（自己寫的＋自動帶進來的里程碑、任務、專注）、筆記、里程碑的細項與備註、歸在專案的任務。
// 窄的時候四塊用分頁切換；寬的時候里程碑和任務固定在右欄。
// 點任務打開那件任務自己的頁面（說明、紀錄）：疊在專案詳情上面，專案那邊藏起來但不拆掉（打到一半的字、編輯中的筆記都還在）。
// 任務的紀錄就是專案的進度日誌、多記一個 task，所以也會出現在專案的進度裡、算進專案的統計。
// 任何資料變動都會重畫：輸入框標了 data-keep，重畫前後把打到一半的字和游標接回去；
// 筆記編輯中的內容不跟著重畫（打開時拍一張快照當 HTML），打字時隔一下子自動存

const SECS = [['log', '進度'], ['notes', '筆記'], ['ms', '里程碑'], ['tasks', '任務']]
const HEAT_KEY = 'hiyori-pd-heat'
const MINS = [0, 15, 30, 45, 60, 90, 120, 180]
const colorOf = (p) => PROJECT_COLORS[p.color % PROJECT_COLORS.length]
const md = (date) => `${+date.slice(5, 7)}/${+date.slice(8)}`
const pad = (n) => String(n).padStart(2, '0')
const hhmm = (ts) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const dur = (m) => (m < 60 ? `${m} 分` : m % 60 ? `${+(m / 60).toFixed(1)} 小時` : `${m / 60} 小時`)
const hrs = (m) => (m < 60 ? `${m}<i>分</i>` : `${+(m / 60).toFixed(1)}<i>小時</i>`)
// 「今天」「昨天」「3 天前」，再久就寫日期
function ago(date, today) {
  const d = daysBetween(date, today)
  if (d <= 0) return '今天'
  if (d === 1) return '昨天'
  if (d < 7) return `${d} 天前`
  return md(date)
}
// 任務的日期：做完的寫什麼時候完成，還沒做的寫哪天（過了就標逾期）
function taskWhen(t, today) {
  if (t.done) return t.doneAt ? `${ago(dayOf(t.doneAt), today)}完成` : md(t.date)
  return t.date === today ? '今天' : t.date < today ? `逾期・${md(t.date)}` : md(t.date)
}
function dayTitle(date, today) {
  const d = daysBetween(date, today)
  if (d === 0) return '今天'
  if (d === 1) return '昨天'
  return `${date.slice(0, 4) === today.slice(0, 4) ? '' : `${date.slice(0, 4)} 年 `}${dateLabel(date)}`
}
const stamp = (ts) => {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(ts)}`
}
// ふじ的一句話（lines.js 的 FUJI_LINES）
const fuji = (key, vars, fallback) => {
  const list = FUJI_LINES[key]
  return list?.length ? list[Math.floor(Math.random() * list.length)].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : fallback
}
// Claude 回的文字：只留字串、去掉前後空白、截短
const clip = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
const clips = (v, n, max) => [...new Set((Array.isArray(v) ? v : []).map((x) => clip(x, n)).filter(Boolean))].slice(0, max)
// 使用者改過、還沒存的欄位（重畫時要把它接回去）
const dirty = (el) =>
  el.tagName === 'SELECT' ? el.value !== ([...el.options].find((o) => o.defaultSelected) || el.options[0])?.value : el.value !== el.defaultValue

export class ProjectView {
  constructor(root, store, hooks) {
    this.root = root
    this.store = store
    this.hooks = hooks
    this.id = null
    this._reset()
    // 熱度格展開著（這台裝置記住，換專案也一樣）
    try {
      this.heat = localStorage.getItem(HEAT_KEY) === '1'
    } catch {
      this.heat = false
    }
    root.addEventListener('click', (e) => this._click(e))
    root.addEventListener('submit', (e) => this._submit(e))
    root.addEventListener('input', (e) => this._input(e))
    root.addEventListener('change', (e) => this._change(e))
    root.addEventListener('keydown', (e) => this._key(e))
    root.addEventListener('compositionend', (e) => {
      if (e.target.matches?.('[data-noteq]')) this._query(e.target.value)
    })
    // toggle 不會冒泡，用捕捉
    root.addEventListener('toggle', (e) => {
      if (e.target.classList?.contains('pt-done')) this.doneOpen = e.target.open
    }, true)
    // 關掉分頁或重新整理：還沒存的字先存起來
    addEventListener('pagehide', () => {
      this._flushAll()
      // 存檔很大時存檔會排隊等一下才寫：頁面要關了，現在就寫
      this.store.flushSave()
    })
    // 按著滑鼠或手指的時候先不重畫：欄位失焦時存檔會觸發重畫，正要點的按鈕被換掉，那一下就點空了。
    // 等 click 跑完再補畫（拖出去沒有 click 的話，過一下子也會補）
    const flush = () => {
      clearTimeout(this._laterT)
      if (!this._later) return
      this._later = false
      this.render()
    }
    root.addEventListener('pointerdown', () => (this._pressing = true), true)
    const release = () => {
      if (!this._pressing) return
      this._pressing = false
      this._laterT = setTimeout(flush, 400)
    }
    addEventListener('pointerup', release, true)
    addEventListener('pointercancel', release, true)
    // 在視窗外放開（收不到 pointerup）也不要一直卡著不重畫
    addEventListener('blur', release)
    addEventListener('click', () => setTimeout(flush), true)
  }

  _reset() {
    this.sec = 'log' // 窄的時候看哪一塊
    this.more = false // 「更多」展開了
    this.dlEdit = false // 正在改截止日
    this.openMs = new Set() // 展開細項和備註的里程碑
    this.noteId = null // 打開的筆記
    this.noteEdit = false
    this.noteSnap = this.noteBase = null
    this.noteQuery = ''
    this.tplOpen = false // 「新筆記」的範本選單
    this.logDays = 14 // 時間軸先顯示幾天
    this.editLog = null // 正在改的那則進度
    this.mins = 0 // 寫進度時選的「花了多久」
    this.doneOpen = false
    this.taskId = null // 打開的任務頁
    this.tmins = 0 // 任務頁寫紀錄時選的「花了多久」
    // ふじ（Claude）正在做或做好的事：{ kind: 'steps', mid, … } 拆細項、{ kind: 'summary', … } 整理進度
    // 換專案或關掉時清掉；回來的結果對不上這個物件就丟掉
    this.ai = null
  }

  get project() {
    return (this.id && this.store.state.projects.find((p) => p.id === this.id)) || null
  }
  // 打開的任務（要還歸在這個專案裡）
  get task() {
    return (this.taskId && this.store.state.tasks.find((t) => t.id === this.taskId && t.project === this.id)) || null
  }

  // taskId：直接打開那件任務的頁面
  open(id, sec = 'log', taskId = null) {
    this._flushAll()
    this.id = id
    this._reset()
    if (SECS.some(([k]) => k === sec)) this.sec = sec
    this.taskId = taskId
    this.root.replaceChildren()
  }

  // 任務頁：記下專案這邊捲到哪裡，回來時接回去
  openTask(tid) {
    if (!this.store.state.tasks.some((t) => t.id === tid && t.project === this.id)) return
    this._flushAll()
    if (!this.taskId) this._scrollY = this._scroller()?.scrollTop ?? 0
    this.taskId = tid
    this.tmins = 0
    this.editLog = null
    this.render()
    this._scroller()?.scrollTo({ top: 0 })
    this.focusBack()
  }
  closeTask() {
    const tid = this.taskId
    if (!tid) return false
    this._flushAll()
    this.taskId = null
    this.editLog = null
    this.render()
    this._grow()
    this._scroller()?.scrollTo({ top: this._scrollY || 0 })
    // 回到列表上剛剛那件任務
    const open = $$(`[data-act="task-open"][data-id="${CSS.escape(tid)}"]`, this.root).find((b) => b.offsetParent)
    ;(open || $('.pd-back', this.root))?.focus({ preventScroll: true })
    return true
  }
  // 看得到的那顆「返回」
  focusBack() {
    $(this.taskId ? '.pd-task .pd-back' : '.pd-back', this.root)?.focus({ preventScroll: true })
  }
  _scroller() {
    return this.root.closest('.panel-body')
  }

  close() {
    this._flushAll()
    this._dropEmptyNote()
    this.id = null
    this._reset()
    this.root.replaceChildren()
  }

  // 回傳 false：專案已經不在了（被刪掉、或同步拉回的資料裡沒有）
  render() {
    const p = this.project
    if (!p) return false
    if (this._pressing && this.root.childElementCount) {
      this._later = true
      return true
    }
    const s = this.store
    const today = s.today
    const tasks = s.state.tasks
    if (this.noteId && !p.notes.some((n) => n.id === this.noteId)) this.noteId = this.noteSnap = this.noteBase = null
    if (this.editLog && !p.logs.some((l) => l.id === this.editLog)) this.editLog = null
    for (const id of this.openMs) if (!p.milestones.some((m) => m.id === id)) this.openMs.delete(id)
    // 任務頁的任務不在了（刪掉、移出專案）：回到專案
    const task = this.task
    if (this.taskId && !task) this.taskId = null
    this.root.style.setProperty('--c', colorOf(p))
    this.root.dataset.sec = this.sec
    this.root.toggleAttribute('data-task', !!task)
    const st = projectStats(p, tasks)
    const note = this.noteId && p.notes.find((n) => n.id === this.noteId)
    if (note && this.noteEdit) this._syncNote(p, note)
    const items = [
      { k: 'top', cls: 'pd-top', html: this._topHTML(p) },
      ...(this.more ? [{ k: 'more', cls: 'pd-more', html: this._moreHTML(p) }] : []),
      // 標題、進度、目標、統計收成一張小卡，畫面主要留給進度日誌和筆記
      {
        k: 'sum', cls: 'pd-sum', kids: [
          { k: 'head', cls: 'pd-head', html: this._headHTML(p, today) },
          { k: 'goal', cls: 'pd-goal-box', html: this._goalHTML(p) },
          { k: 'stats', cls: 'pd-stats', html: this._statsHTML(p, st, today) },
        ],
      },
      ...(this.ai?.kind === 'summary' ? [{ k: 'ai', cls: 'pd-ai', html: this._aiSummaryHTML(p) }] : []),
      {
        k: 'body', cls: 'pd-body', kids: [
          {
            k: 'main', cls: 'pd-main', kids: [
              { k: 'tabs', cls: 'seg pd-tabs', html: this._tabsHTML(p) },
              {
                k: 'log', cls: 'pd-sec pd-log', kids: [
                  { k: 'compose', cls: 'pd-compose-box', html: this._composeHTML(p, today) },
                  { k: 'tl', cls: 'pd-tl', html: this._timelineHTML(p, tasks, today) },
                ],
              },
              {
                k: 'notes', cls: 'pd-sec pd-notes', kids: note
                  ? [{ k: `note-${note.id}-${this.noteEdit ? 'e' : 'v'}`, cls: 'pd-note', html: this._noteHTML(note) }]
                  : [
                    { k: 'nbar', cls: 'pn-top', html: this._noteBarHTML(p) },
                    { k: 'nlist', cls: 'pn-box', html: this._noteListHTML(p, today) },
                  ],
              },
            ],
          },
          {
            k: 'side', cls: 'pd-side', kids: [
              { k: 'ms', cls: 'pd-sec pd-ms', html: this._msHTML(p, today) },
              { k: 'tasks', cls: 'pd-sec pd-tasks', html: this._tasksHTML(p, today) },
            ],
          },
        ],
      },
      // 任務頁放在最後：專案那幾塊不用搬動位置（搬動會讓焦點掉出去）
      ...(task
        ? [{
          k: `task-${task.id}`, cls: 'pd-task', kids: [
            { k: 'ttop', cls: 'pd-top', html: this._taskTopHTML(p, task, today) },
            { k: 'tsum', cls: 'pd-sum pk-sum', html: this._taskHeadHTML(p, task, today) },
            { k: 'tcompose', cls: 'pd-compose-box', html: this._taskComposeHTML(today) },
            { k: 'ttl', cls: 'pk-tl', html: this._taskTimelineHTML(p, task, today) },
          ],
        }]
        : []),
    ]
    const kept = this._capture()
    patch(this.root, items)
    this._restore(kept)
    // 搜尋框不放值（打字時才不會被重畫打斷）：從筆記回到列表時，把還在用的關鍵字填回去
    const q = $('[data-noteq]', this.root)
    if (q && q !== document.activeElement && q.value !== this.noteQuery) q.value = this.noteQuery
    this._grow()
    return true
  }

  // ── 區塊 ──
  _topHTML(p) {
    const island = this.hooks.appMode() ? '切到小島看看' : '在島上查看'
    return `<button type="button" class="pd-back" data-act="back">${ICON.prev}<span>所有專案</span></button>
      <span class="sp"></span>
      ${p.archived || p.completedAt ? '' : '<button type="button" class="pd-tbtn" data-act="focus" title="用番茄鐘專注在這個專案上，時間會記進專案（計時中按就是換成這個專案）">◷ 專注</button>'}
      ${aiReady() ? `<button type="button" class="pd-tbtn pd-ai-btn ${this.ai?.kind === 'summary' ? 'on' : ''}" data-act="ai-summary" aria-expanded="${this.ai?.kind === 'summary'}" title="讓ふじ讀進度日誌、里程碑和筆記，整理目前走到哪裡">✦ 整理進度</button>` : ''}
      ${p.archived ? '' : `<button type="button" class="pd-tbtn" data-act="island">${island}</button>`}
      <button type="button" class="pd-tbtn" data-act="export" title="把目標、里程碑、任務、筆記和進度日誌存成 Markdown 檔">匯出</button>
      <button type="button" class="pd-tbtn ${this.more ? 'on' : ''}" data-act="more" aria-expanded="${this.more}">更多</button>`
  }

  _moreHTML(p) {
    const b = (act, label) => `<button type="button" data-act="${act}">${label}</button>`
    if (p.archived) return b('restore', '放回進行中') + b('delete', '刪除')
    const st = this.store.projectStatus(p)
    return [
      b('rename', '改名'), b('color', '換色'),
      st === 'done' ? '' : b('deadline', p.deadline ? '改截止日' : '設截止日'),
      st === 'done' ? '' : st === 'paused' ? b('resume', '繼續') : b('pause', '暫停'),
      b('archive', '收藏'), b('delete', '刪除'),
    ].join('')
  }

  _headHTML(p, today) {
    const s = this.store
    const pct = Math.round(s.progress(p) * 100)
    const st = p.archived ? 'archived' : s.projectStatus(p)
    const meta = []
    if (st === 'paused') meta.push('<span class="pd-chip">暫停中</span>')
    if (st === 'archived') meta.push('<span class="pd-chip">已收藏</span>')
    if (st === 'done') meta.push(`<span class="pd-chip done">${p.onTime ? '✦ 準時落成' : '已落成'}${p.completedAt ? `・${md(dayOf(p.completedAt))}` : ''}</span>`)
    if (st === 'active' && p.deadline) {
      const d = daysBetween(today, p.deadline)
      const txt = d < 0 ? `已逾期 ${-d} 天（${md(p.deadline)}）` : d === 0 ? '今天截止' : `截止 ${md(p.deadline)}・剩 ${d} 天`
      meta.push(`<span class="${d <= 2 ? 'warn' : ''}">${txt}</span>`)
    }
    const born = dayOf(p.createdAt)
    meta.push(`<span>${md(born)} 開始・第 ${Math.max(1, daysBetween(born, today) + 1)} 天</span>`)
    const dl = this.dlEdit
      ? `<form class="pd-dl" data-form="deadline"><input type="date" name="date" data-keep="dl" value="${p.deadline || addDays(today, 14)}" aria-label="截止日">
          <button class="btn-primary" type="submit">好</button>${p.deadline ? '<button type="button" class="btn-ghost" data-act="dl-clear">不設截止</button>' : ''}
          <button type="button" class="btn-ghost" data-act="dl-cancel">取消</button></form>`
      : ''
    const by = msTasks(p, s.state.tasks)
    const bar = p.milestones.length ? p.milestones.map((m) => `<i style="--f:${msProgress(m, by.get(m.id)).toFixed(3)}"></i>`).join('') : '<i style="--f:0"></i>'
    return `<div class="pd-title"><div class="pd-tl"><h2 class="pd-name">${esc(p.name)}</h2><div class="pd-meta">${meta.join('')}</div></div><div class="pd-pct">${pct}<small>%</small></div></div>
      ${dl}<div class="proj-bar" aria-hidden="true">${bar}</div>`
  }

  _goalHTML(p) {
    return `<label class="pd-goal"><span class="pd-k">目標</span><textarea data-keep="goal" data-goal data-grow rows="1" maxlength="300"
      placeholder="做完時是什麼樣子？卡住時回來看看">${esc(p.goal)}</textarea></label>`
  }

  // 統計排成一行小字；熱度格平常收著，按「最近一次推進」那顆展開（這台裝置會記住）
  _statsHTML(p, st, today) {
    const n = (v, k, title = '') => `<span${title ? ` title="${title}"` : ''}><b>${v}</b>${k}</span>`
    const nums = [
      n(`${st.msDone}<i>/${st.msTotal}</i>`, '里程碑'),
      st.stepsTotal ? n(`${st.stepsDone}<i>/${st.stepsTotal}</i>`, '細項') : '',
      n(`${st.tasksDone}<i>/${st.tasksTotal}</i>`, '任務'),
      n(hrs(st.focus), '專注', '歸在這個專案的任務，用番茄鐘專注的時間'),
      n(hrs(st.logMins), '投入', '寫進度時記下的時間'),
      n(st.logs, '則進度'),
    ]
    const last = st.last ? `最近推進：${ago(dayOf(st.last), today)}` : '還沒有推進的紀錄'
    let heat = ''
    if (this.heat) {
      // 一欄是一週（一到日），最右邊是這週
      const wd = (parseDate(today).getDay() + 6) % 7
      const cells = activity(p, this.store.state.tasks, today, 77 + wd + 1).map((d) => `<i class="h${d.level}" title="${md(d.date)}"></i>`).join('')
      heat = `<div class="pd-heat-box"><div class="pd-heat" role="img" aria-label="最近 12 週每天的推進">${cells}</div><small>最近 12 週，顏色越深那天推進得越多</small></div>`
    }
    return `<div class="pd-nums">${nums.join('')}<button type="button" class="pd-last" data-act="heat" aria-expanded="${this.heat}" title="${this.heat ? '收起熱度格' : '看最近 12 週每天的推進'}">${last}<i class="pm-chev">${ICON.next}</i></button></div>${heat}`
  }

  _tabsHTML(p) {
    const todo = this.store.state.tasks.filter((t) => t.project === p.id && !t.done).length
    const n = { log: p.logs.length, notes: p.notes.length, ms: p.milestones.filter((m) => !m.done).length, tasks: todo }
    return SECS.map(([k, label]) => `<button type="button" class="pd-tab-${k} ${this.sec === k ? 'on' : ''}" data-act="sec" data-v="${k}" aria-pressed="${this.sec === k}">${label}${n[k] ? `<small>${n[k]}</small>` : ''}</button>`).join('')
  }

  _composeHTML(p, today) {
    const open = p.milestones.filter((m) => !m.done)
    const ms = open.length
      ? `<label class="pc-sel"><span class="pc-k">里程碑</span><select name="ms" data-keep="log-ms"><option value="">不指定</option>${open.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')}</select></label>`
      : ''
    return `<form class="pd-compose" data-form="log" autocomplete="off">
      <textarea name="text" data-keep="log-text" data-grow rows="2" maxlength="1000" aria-label="寫下進度"
        placeholder="今天推進了什麼？做了哪些、卡在哪裡、下一步是什麼"></textarea>
      <div class="pc-row pc-mins" role="group" aria-label="花了多久"><span class="pc-k">花了</span>${MINS.map((m) => `<button type="button" data-act="mins" data-v="${m}" class="${this.mins === m ? 'on' : ''}" aria-pressed="${this.mins === m}">${m ? dur(m) : '不記'}</button>`).join('')}</div>
      <div class="pc-row">${ms}
        <label class="pc-sel"><span class="pc-k">哪天</span><input type="date" name="date" data-keep="log-date" value="${today}" max="${today}"></label>
        <span class="sp"></span>
        <button class="btn-primary" type="submit" title="Ctrl＋Enter 也可以送出">記下來</button>
      </div>
    </form>`
  }

  // 一則進度。inTask：畫在任務頁上（不標任務名；同一則只在看得到的那一頁打開修改）
  _logHTML(p, l, today, inTask = false) {
    if (this.editLog === l.id && !!this.task === inTask) return this._logEditHTML(p, l, today)
    const m = !inTask && l.ms && p.milestones.find((x) => x.id === l.ms)
    // 在任務頁寫的：標出是哪件任務，還歸在這個專案的話點了打開它的頁面
    const t = !inTask && l.task && this.store.state.tasks.find((x) => x.id === l.task)
    const tag = !t ? '' : t.project === p.id
      ? `<button type="button" class="tl-task" data-act="task-open" data-id="${esc(t.id)}" title="打開這件任務的頁面">${esc(t.title)}</button>`
      : `<span class="tl-task">${esc(t.title)}</span>`
    const meta = [
      dayOf(l.at) === l.date ? hhmm(l.at) : `${md(dayOf(l.at))} 補記`,
      l.mins ? `<span class="tl-mins">${dur(l.mins)}</span>` : '',
      tag,
      m ? `<span class="tl-ms">${esc(m.title)}</span>` : '',
    ].filter(Boolean).join('')
    return `<li class="tl-log"><i class="tl-dot"></i><div class="tl-main">${l.text ? `<p class="tl-text">${textHTML(l.text)}</p>` : ''}<div class="tl-meta">${meta}</div></div>
      <div class="tl-acts"><button type="button" class="mini" data-act="log-edit" data-id="${esc(l.id)}" title="修改">${ICON.edit}</button><button type="button" class="mini" data-act="log-del" data-id="${esc(l.id)}" title="刪除">${ICON.del}</button></div></li>`
  }

  _timelineHTML(p, tasks, today) {
    const days = projectTimeline(p, tasks)
    const shown = days.slice(0, this.logDays)
    const item = (it) => {
      if (it.kind === 'log') return this._logHTML(p, it.log, today)
      if (it.kind === 'ms') return `<li class="tl-ev tl-msdone"><i class="tl-dot">${ICON.check}</i><span>完成里程碑「${esc(it.milestone.title)}」</span><small>${hhmm(it.at)}</small></li>`
      if (it.kind === 'task') return `<li class="tl-ev"><i class="tl-dot"></i><span>完成任務「${esc(it.task.title)}」</span><small>${hhmm(it.at)}</small></li>`
      if (it.kind === 'done') return `<li class="tl-ev tl-built"><i class="tl-dot">${ICON.spark}</i><span>${p.onTime ? '準時落成' : '落成'}！所有里程碑都完成了</span></li>`
      return '<li class="tl-ev tl-start"><i class="tl-dot"></i><span>開始這個專案</span></li>'
    }
    const hint = p.logs.length
      ? ''
      : `<div class="pd-hint"><b>把每次推進的事記下來</b>做了什麼、卡在哪裡、下一步是什麼。完成的里程碑、歸在這個專案的任務和專注時間，也會自動出現在這裡。</div>`
    const list = shown.map((d) => {
      const sum = d.logMins ? `<small>投入 ${dur(d.logMins)}</small>` : ''
      const focus = d.focus ? `<li class="tl-ev tl-focus"><i class="tl-dot">◷</i><span>專注 ${dur(d.focus)}</span></li>` : ''
      return `<section class="tl-day"><h4 class="tl-date"><b>${dayTitle(d.date, today)}</b>${sum}</h4><ul>${focus}${d.items.map(item).join('')}</ul></section>`
    })
    const more = days.length > shown.length ? `<button type="button" class="btn-ghost wide" data-act="log-more">看更早的紀錄（還有 ${days.length - shown.length} 天）</button>` : ''
    return hint + list.join('') + more
  }

  _logEditHTML(p, l, today) {
    const k = esc(l.id)
    const mins = [...new Set([...MINS, l.mins])].sort((a, b) => a - b)
    const ms = p.milestones.length
      ? `<label class="pc-sel"><span class="pc-k">里程碑</span><select name="ms" data-keep="le-ms-${k}"><option value="">不指定</option>${p.milestones.map((m) => `<option value="${esc(m.id)}" ${l.ms === m.id ? 'selected' : ''}>${esc(m.title)}</option>`).join('')}</select></label>`
      : ''
    return `<li class="tl-log editing"><form class="tl-edit" data-form="log-edit" data-id="${k}" autocomplete="off">
      <textarea name="text" data-keep="le-${k}" data-grow rows="2" maxlength="1000" aria-label="進度內容">${esc(l.text)}</textarea>
      <div class="pc-row">
        <label class="pc-sel"><span class="pc-k">花了</span><select name="mins" data-keep="le-mins-${k}">${mins.map((m) => `<option value="${m}" ${m === l.mins ? 'selected' : ''}>${m ? dur(m) : '不記'}</option>`).join('')}</select></label>
        ${ms}
        <label class="pc-sel"><span class="pc-k">哪天</span><input type="date" name="date" data-keep="le-date-${k}" value="${l.date}" max="${today}"></label>
        <span class="sp"></span>
        <button type="button" class="btn-ghost" data-act="log-cancel">取消</button>
        <button class="btn-primary" type="submit">儲存</button>
      </div></form></li>`
  }

  // 筆記列表上面那一條（搜尋框不放值，打字時不會被重畫打斷）
  _noteBarHTML(p) {
    const tpl = this.tplOpen
      ? `<div class="pn-tpl" role="group" aria-label="從範本開始">${NOTE_TEMPLATES.map((t) => `<button type="button" data-act="note-tpl" data-v="${t.key}">${t.label}</button>`).join('')}</div>`
      : ''
    const search = p.notes.length >= 5 ? '<input type="search" class="pn-q" data-keep="note-q" data-noteq placeholder="搜尋筆記" aria-label="搜尋筆記">' : ''
    return `<div class="pn-head"><button type="button" class="btn-ghost ${this.tplOpen ? 'on' : ''}" data-act="note-new" aria-expanded="${this.tplOpen}">＋ 新筆記</button>${search}</div>${tpl}`
  }

  _noteListHTML(p, today) {
    if (!p.notes.length) {
      return `<div class="pd-hint"><b>把想法、資料和決定收在這裡</b>會議紀錄、參考連結、待辦清單都可以。支援簡單的格式：# 標題、- 清單、- [ ] 待辦。</div>`
    }
    const q = this.noteQuery.trim().toLowerCase()
    const list = [...p.notes]
      .sort((a, b) => !!b.pinned - !!a.pinned || b.updatedAt - a.updatedAt)
      .filter((n) => !q || `${n.title}\n${n.body}`.toLowerCase().includes(q))
    if (!list.length) return `<p class="pd-none">找不到「${esc(this.noteQuery.trim())}」</p>`
    return `<ul class="pn-list">${list.map((n) => {
      const td = noteTodos(n.body)
      const snip = noteSnippet(n)
      return `<li><button type="button" class="pn-item" data-act="note-open" data-id="${esc(n.id)}">
        <b>${n.pinned ? '<i class="pn-pin">釘</i>' : ''}${esc(noteTitle(n))}</b>${snip ? `<span>${esc(snip)}</span>` : ''}
        <small>${ago(dayOf(n.updatedAt), today)}${td.total ? `・待辦 ${td.done}/${td.total}` : ''}</small></button></li>`
    }).join('')}</ul>`
  }

  _noteHTML(n) {
    const back = `<button type="button" class="pn-back" data-act="note-back">${ICON.prev}所有筆記</button>`
    if (this.noteEdit) {
      const snap = this.noteSnap || n
      return `<div class="pn-bar">${back}<span class="sp"></span><span class="pn-saved" aria-live="polite"></span><button type="button" class="btn-primary" data-act="note-view">完成</button></div>
        <input class="pn-title" data-keep="note-title" maxlength="60" placeholder="標題（可以不寫）" value="${esc(snap.title)}" aria-label="筆記標題">
        <textarea class="pn-body" data-keep="note-body" data-grow maxlength="10000" placeholder="寫點什麼…" aria-label="筆記內容">${esc(snap.body)}</textarea>
        <p class="pn-help"># 標題　- 清單　1. 編號　- [ ] 待辦　**粗體**　網址會變成連結</p>`
    }
    return `<div class="pn-bar">${back}<span class="sp"></span>
        <button type="button" class="btn-ghost" data-act="note-pin" aria-pressed="${n.pinned}">${n.pinned ? '取消釘選' : '釘選'}</button>
        <button type="button" class="btn-ghost" data-act="note-del">刪除</button>
        <button type="button" class="btn-primary" data-act="note-edit">編輯</button></div>
      <h3 class="pn-h">${esc(noteTitle(n))}</h3>
      <div class="pn-view">${n.body.trim() ? noteHTML(n.body) : '<p class="pd-none">還沒有內容，按「編輯」開始寫</p>'}</div>
      <small class="pn-time">建立 ${stamp(n.createdAt)}・更新 ${stamp(n.updatedAt)}</small>`
  }

  _msHTML(p, today) {
    const c = colorOf(p)
    const doneN = p.milestones.filter((m) => m.done).length
    const by = msTasks(p, this.store.state.tasks)
    const rows = p.milestones.map((m, i) => {
      const k = esc(m.id)
      const open = this.openMs.has(m.id)
      const sd = m.steps.filter((x) => x.done).length
      // 細項和歸在這裡的任務一起算：做完一件，里程碑就推進一點
      const mt = by.get(m.id)
      const n = msSteps(m, mt)
      const nTip = [m.steps.length && `細項 ${sd}/${m.steps.length}`, mt.length && `任務 ${n.done - sd}/${mt.length}`].filter(Boolean).join('・')
      const late = m.due && !m.done && m.due < today
      // 今天、明天到期的也標出來（前一天和當天會提醒）
      const near = m.due && !m.done && !late && daysBetween(today, m.due) <= 1
      const dueText = near ? (m.due === today ? '今天到期' : '明天到期') : `${late ? '逾期・' : ''}${md(m.due)}`
      const tags = [
        n.total ? `<small class="pm-n" title="${nTip}">${n.done}/${n.total}</small>` : '',
        m.due ? `<small class="pm-due ${late || near ? 'late' : ''}" title="期限 ${m.due}">${dueText}</small>` : '',
        m.note ? '<small class="pm-has">註</small>' : '',
      ].join('')
      const steps = m.steps.map((x) => `<li class="${x.done ? 'done' : ''}">
          <button type="button" class="check" data-act="step-toggle" data-id="${k}" data-sid="${esc(x.id)}" aria-label="${x.done ? '取消完成' : '完成'}「${esc(x.title)}」" style="--c:${c}">${ICON.check}</button>
          <span class="pm-st" role="button" tabindex="0" data-act="step-rename" data-id="${k}" data-sid="${esc(x.id)}" title="點一下改名" aria-label="改名「${esc(x.title)}」">${esc(x.title)}</span>
          <button type="button" class="mini" data-act="step-del" data-id="${k}" data-sid="${esc(x.id)}" title="刪除細項">${ICON.del}</button></li>`).join('')
      const detail = open
        ? `<div class="pm-detail">
          ${steps ? `<ul class="pm-steps">${steps}</ul>` : ''}
          <form class="pm-add" data-form="step" data-id="${k}"><input data-keep="step-${k}" maxlength="80" placeholder="${m.steps.length ? '再加一個細項' : '拆成細項：做完一步勾一步'}" aria-label="新增細項"><button class="mini" type="submit" title="新增細項">${ICON.plus}</button></form>
          ${this._aiStepsHTML(m)}
          ${this._msTasksHTML(mt, today)}
          <label class="pm-note"><span class="pc-k">備註</span><textarea data-keep="msnote-${k}" data-msnote="${k}" data-grow rows="1" maxlength="500" placeholder="完成的標準、要注意的事…">${esc(m.note)}</textarea></label>
          <div class="pm-tools">
            <label class="pc-sel"><span class="pc-k">期限</span><input type="date" data-msdue="${k}" value="${m.due}" aria-label="「${esc(m.title)}」的期限"></label>
            <span class="sp"></span>
            <button type="button" data-act="ms-up" data-id="${k}" ${i === 0 ? 'disabled' : ''} title="往上移" aria-label="往上移">↑</button>
            <button type="button" data-act="ms-down" data-id="${k}" ${i === p.milestones.length - 1 ? 'disabled' : ''} title="往下移" aria-label="往下移">↓</button>
            <button type="button" data-act="ms-rename" data-id="${k}">改名</button>
            <button type="button" data-act="ms-del" data-id="${k}">刪除</button>
          </div></div>`
        : ''
      const bar = !m.done && n.total && !open ? `<div class="pm-bar"><i style="width:${Math.round((n.done / n.total) * 100)}%"></i></div>` : ''
      return `<li class="pm ${m.done ? 'done' : ''} ${open ? 'open' : ''}">
        <div class="pm-row">
          <button type="button" class="check" data-act="ms-toggle" data-id="${k}" aria-label="${m.done ? '取消完成' : '完成'}「${esc(m.title)}」" style="--c:${c}">${ICON.check}</button>
          <button type="button" class="pm-title" data-act="ms-open" data-id="${k}" aria-expanded="${open}"><span class="pm-t">${esc(m.title)}</span>${tags}<i class="pm-chev">${ICON.next}</i></button>
        </div>${bar}${detail}</li>`
    }).join('')
    return `<h3 class="sec-title">里程碑<small>みちしるべ</small><span class="count">${doneN} / ${p.milestones.length}</span></h3>
      ${rows ? `<ul class="pm-list">${rows}</ul>` : '<p class="pd-hint">把專案切成幾個看得到終點的階段。每完成一個，專案町的房子就會再蓋一段。</p>'}
      <form class="ms-add" data-form="ms"><input data-keep="ms-new" maxlength="60" placeholder="新增里程碑" aria-label="新增里程碑"><button class="mini" type="submit" title="新增">${ICON.plus}</button></form>`
  }

  // 展開的里程碑裡：歸在這裡的任務（還沒做的照日期，做完的新的在前），在這裡也能直接打勾
  _msTasksHTML(list, today) {
    if (!list.length) return ''
    const todo = list.filter((t) => !t.done).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
    const row = (t) => {
      const k = esc(t.id)
      return `<li class="${t.done ? 'done' : ''}">
        <button type="button" class="check" data-act="task-toggle" data-id="${k}" aria-label="${t.done ? '取消完成' : '完成'}「${esc(t.title)}」" style="--c:${tagOf(t.tag).color}">${ICON.check}</button>
        <button type="button" class="pm-st pm-tk" data-act="task-open" data-id="${k}" title="打開這件任務的頁面：說明和紀錄"><span>${esc(t.title)}</span><small>${taskWhen(t, today)}</small></button>
        <button type="button" class="mini" data-act="task-edit" data-id="${k}" title="編輯（也可以換到別的里程碑）">${ICON.edit}</button></li>`
    }
    return `<div class="pm-tasks"><span class="pc-k">任務</span><ul class="pm-steps">${[...todo, ...done].map(row).join('')}</ul></div>`
  }

  _tasksHTML(p, today) {
    const { todo, done } = this.store.projectTasks(p.id)
    // 每件任務寫了幾則紀錄
    const logs = new Map()
    for (const l of p.logs) if (l.task) logs.set(l.task, (logs.get(l.task) || 0) + 1)
    const row = (t) => {
      const k = esc(t.id)
      const late = !t.done && t.date < today
      const m = taskMilestone(p, t)
      const n = logs.get(t.id)
      return `<li class="pt ${t.done ? 'done' : ''}">
        <button type="button" class="check" data-act="task-toggle" data-id="${k}" aria-label="${t.done ? '取消完成' : '完成'}「${esc(t.title)}」" style="--c:${tagOf(t.tag).color}">${ICON.check}</button>
        <button type="button" class="pt-main" data-act="task-open" data-id="${k}" title="打開這件任務的頁面：說明和紀錄"><span class="pt-t">${t.star ? '<i class="pt-star">★</i>' : ''}${esc(t.title)}</span><small class="${late ? 'late' : ''}">${taskWhen(t, today)}${t.pomos ? `・◷ ${t.pomos}` : ''}${n ? `・紀錄 ${n}` : ''}${t.note ? '・<i class="pt-has">註</i>' : ''}${m ? `<span class="pt-ms" title="完成時推進這個里程碑">${esc(m.title)}</span>` : ''}</small></button>
        ${!t.done && t.date === today ? `<button type="button" class="mini" data-act="task-focus" data-id="${k}" title="專注在這件事上">${ICON.play}</button>` : ''}
        <button type="button" class="mini" data-act="task-edit" data-id="${k}" title="編輯日期、時間和優先度">${ICON.edit}</button>
        <button type="button" class="mini" data-act="task-unlink" data-id="${k}" title="移出這個專案（任務本身還在）">${ICON.minus}</button>
      </li>`
    }
    const name = p.name.replace(/\s+/g, '').slice(0, 6)
    return `<h3 class="sec-title">任務<small>タスク</small><span class="count">${todo.length ? `還有 ${todo.length} 件` : done.length ? '都完成了' : ''}</span></h3>
      <form class="pt-add" data-form="task" autocomplete="off">
        <input name="title" data-keep="task-new" maxlength="80" placeholder="新增一件這個專案的任務" aria-label="新增任務">
        <input type="date" name="date" data-keep="task-date" value="${today}" aria-label="日期">
        <button class="mini" type="submit" title="新增">${ICON.plus}</button></form>
      ${todo.length ? `<ul class="pt-list">${todo.map(row).join('')}</ul>` : ''}
      ${done.length ? `<details class="pt-done" ${this.doneOpen ? 'open' : ''}><summary>已完成 ${done.length}</summary><ul class="pt-list">${done.map(row).join('')}</ul></details>` : ''}
      ${todo.length || done.length ? '' : `<p class="pd-hint">任務頁的輸入框打「@${esc(name)}」，或編輯任務時選專案，也會歸到這裡。做完的任務會推進里程碑，專注在這些任務上的時間會記進這個專案。點一件任務可以打開它自己的頁面，寫說明和紀錄。</p>`}`
  }

  // ── 任務頁 ──
  _taskTopHTML(p, t, today) {
    const k = esc(t.id)
    return `<button type="button" class="pd-back" data-act="task-back">${ICON.prev}<span>${esc(p.name)}</span></button>
      <span class="sp"></span>
      ${!t.done && t.date === today ? `<button type="button" class="pd-tbtn" data-act="task-focus" data-id="${k}" title="用番茄鐘專注在這件事上">◷ 專注</button>` : ''}
      <button type="button" class="pd-tbtn" data-act="task-edit" data-id="${k}" title="改名稱、日期、時間、優先度、里程碑">編輯</button>
      <button type="button" class="pd-tbtn" data-act="task-unlink" data-id="${k}" title="移出這個專案（任務本身還在；寫過的紀錄留在專案的進度裡）">移出專案</button>`
  }

  _taskHeadHTML(p, t, today) {
    const k = esc(t.id)
    const tag = tagOf(t.tag)
    const m = taskMilestone(p, t)
    const late = !t.done && t.date < today
    const meta = [
      `<span class="${late ? 'warn' : ''}">${taskWhen(t, today)}</span>`,
      t.at ? `<span>${t.at} 開始</span>` : '',
      t.dur ? `<span>預估 ${dur(t.dur)}</span>` : '',
      `<span class="pd-chip pk-tag" style="--tc:${tag.color}">${tag.label}</span>`,
      m ? `<span class="pk-ms" title="完成時推進這個里程碑">${esc(m.title)}</span>` : '',
      `<span>${md(dayOf(t.createdAt))} 建立</span>`,
    ].filter(Boolean).join('')
    // 這件任務的紀錄：幾則、記了多少時間、最近一次
    const logs = this.store.taskLogs(t)
    const mins = logs.reduce((a, l) => a + l.mins, 0)
    const last = logs.reduce((a, l) => (l.date > a ? l.date : a), '')
    const n = (v, label) => `<span><b>${v}</b>${label}</span>`
    const nums = [
      n(logs.length, '則紀錄'),
      mins ? n(hrs(mins), '投入') : '',
      t.pomos ? n(t.pomos, '輪專注') : '',
      `<span class="pk-last">${last ? `最近紀錄：${ago(last, today)}` : '還沒有紀錄'}</span>`,
    ].filter(Boolean).join('')
    return `<div class="pd-title">
        <button type="button" class="check ${t.done ? 'on' : ''}" data-act="task-toggle" data-id="${k}" aria-label="${t.done ? '取消完成' : '完成'}「${esc(t.title)}」" style="--c:${tag.color}">${ICON.check}</button>
        <div class="pd-tl"><h2 class="pd-name ${t.done ? 'pk-done' : ''}">${t.star ? '<i class="pt-star" title="今日の本命">★</i>' : ''}${esc(t.title)}</h2><div class="pd-meta">${meta}</div></div>
      </div>
      <label class="pd-goal"><span class="pd-k">說明</span><textarea data-keep="tnote" data-tnote="${k}" data-grow rows="1" maxlength="${PL.taskNote}"
        placeholder="要做到什麼程度？需要的資料、要注意的事">${esc(t.note || '')}</textarea></label>
      <div class="pd-nums">${nums}</div>`
  }

  _taskComposeHTML(today) {
    return `<form class="pd-compose" data-form="tlog" autocomplete="off">
      <textarea name="text" data-keep="tlog-text" data-grow rows="2" maxlength="1000" aria-label="寫下這件任務的紀錄"
        placeholder="這次做了什麼？卡在哪裡、下一步是什麼"></textarea>
      <div class="pc-row pc-mins" role="group" aria-label="花了多久"><span class="pc-k">花了</span>${MINS.map((m) => `<button type="button" data-act="tmins" data-v="${m}" class="${this.tmins === m ? 'on' : ''}" aria-pressed="${this.tmins === m}">${m ? dur(m) : '不記'}</button>`).join('')}</div>
      <div class="pc-row">
        <label class="pc-sel"><span class="pc-k">哪天</span><input type="date" name="date" data-keep="tlog-date" value="${today}" max="${today}"></label>
        <span class="sp"></span>
        <button class="btn-primary" type="submit" title="Ctrl＋Enter 也可以送出">記下來</button>
      </div>
    </form>`
  }

  _taskTimelineHTML(p, t, today) {
    const days = taskTimeline(p, t)
    const item = (it) => {
      if (it.kind === 'log') return this._logHTML(p, it.log, today, true)
      if (it.kind === 'task') return `<li class="tl-ev tl-msdone"><i class="tl-dot">${ICON.check}</i><span>完成這件任務</span><small>${hhmm(it.at)}</small></li>`
      return '<li class="tl-ev tl-start"><i class="tl-dot"></i><span>建立這件任務</span></li>'
    }
    const hint = days.some((d) => d.logMins || d.items.some((it) => it.kind === 'log'))
      ? ''
      : `<div class="pd-hint"><b>把這件事的每一步記下來</b>做了什麼、卡在哪裡、下一步是什麼。這裡寫的紀錄也會出現在「${esc(p.name)}」的進度裡。</div>`
    const list = days.map((d) => {
      const sum = d.logMins ? `<small>投入 ${dur(d.logMins)}</small>` : ''
      return `<section class="tl-day"><h4 class="tl-date"><b>${dayTitle(d.date, today)}</b>${sum}</h4><ul>${d.items.map(item).join('')}</ul></section>`
    })
    return hint + list.join('')
  }

  // ── ふじ（Claude）──
  // 里程碑展開後的「ふじ幫你拆細項」：想好之後列出來，勾選要的再加進去
  _aiStepsHTML(m) {
    if (!aiReady() || m.done) return ''
    const k = esc(m.id)
    const a = this.ai?.kind === 'steps' && this.ai.mid === m.id ? this.ai : null
    if (!a) return `<button type="button" class="pm-ai-btn" data-act="ai-steps" data-id="${k}">✦ ふじ幫你拆細項</button>`
    if (a.busy) return `<div class="pm-ai" aria-live="polite"><p class="pm-ai-say">ふじ想想怎麼拆<span class="cm-dots"><i></i><i></i><i></i></span></p></div>`
    const again = `<button type="button" class="btn-ghost" data-act="ai-steps" data-id="${k}">${a.err ? '再試一次' : '再想一次'}</button>`
    if (a.err) return `<div class="pm-ai"><p class="pm-ai-err" role="alert">${esc(a.err)}</p><div class="pm-ai-acts"><button type="button" class="btn-ghost" data-act="ai-close">關掉</button>${again}</div></div>`
    const list = a.steps.map((t, i) => `<li><label><input type="checkbox" data-aipick="${i}" ${a.pick.has(i) ? 'checked' : ''}><span>${esc(t)}</span></label></li>`).join('')
    return `<div class="pm-ai"><p class="pm-ai-say">${esc(a.line)}</p><ul class="pm-ai-list">${list}</ul>${a.tip ? `<p class="pm-ai-tip">✿ ${esc(a.tip)}</p>` : ''}
      <div class="pm-ai-acts"><button type="button" class="btn-ghost" data-act="ai-close">算了</button>${again}
        <button type="button" class="btn-primary" data-act="ai-steps-add" data-id="${k}" ${a.pick.size ? '' : 'disabled'}>加入 ${a.pick.size} 個</button></div></div>`
  }

  // 「整理進度」：目標、統計下面的一張卡，可以存成筆記
  _aiSummaryHTML(p) {
    const a = this.ai
    const close = `<button type="button" class="mini" data-act="ai-close" title="關掉" aria-label="關掉">${ICON.close}</button>`
    const head = `<div class="pd-ai-head"><b>✦ ふじ整理的進度</b><span class="sp"></span>${close}</div>`
    if (a.busy) return `${head}<p class="pd-ai-say" aria-live="polite">ふじ正在讀日誌和筆記<span class="cm-dots"><i></i><i></i><i></i></span></p>`
    if (a.err) return `${head}<p class="pm-ai-err" role="alert">${esc(a.err)}</p><div class="pm-ai-acts"><button type="button" class="btn-ghost" data-act="ai-summary">再試一次</button></div>`
    const o = a.out
    const block = (title, list, cls = '') => (list.length ? `<div><h4>${title}</h4><ul class="${cls}">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '')
    return `${head}<p class="pd-ai-say">${esc(a.line)}</p>
      <p class="pd-ai-sum">${esc(o.summary)}</p>
      <div class="pd-ai-cols">${block('最近完成', o.done)}${block('卡住的地方', o.blockers, 'warn')}${block('接下來', o.next, 'next')}</div>
      <div class="pm-ai-acts">${a.saved ? '<span class="pd-ai-ok">已存成筆記</span>' : '<button type="button" class="btn-ghost" data-act="ai-save">存成筆記</button>'}<button type="button" class="btn-ghost" data-act="ai-summary">重新整理</button></div>`
  }

  async _aiSteps(p, mid) {
    const m = p.milestones.find((x) => x.id === mid)
    if (!m) return
    const a = (this.ai = { kind: 'steps', mid, busy: true })
    this.openMs.add(mid)
    this.render()
    const data = {
      project: p.name,
      goal: p.goal,
      milestone: { title: m.title, note: m.note, due: m.due || null },
      existing: m.steps.map((x) => x.title),
      milestones: p.milestones.map((x) => ({ title: x.title, done: x.done })),
      recentLogs: [...p.logs].sort((x, y) => y.at - x.at).slice(0, 6).map((l) => ({ date: l.date, text: l.text.slice(0, 300) })),
    }
    try {
      const out = await askAI('steps', data)
      const have = new Set(m.steps.map((x) => x.title))
      const steps = clips(out?.steps, PL.stepTitle, 10).filter((t) => !have.has(t))
      if (!steps.length) throw new Error('這次沒有拆出新的細項，再試一次看看')
      Object.assign(a, { steps, tip: clip(out.tip, 80), pick: new Set(steps.map((_, i) => i)), line: fuji('aiSteps', { title: m.title }, `「${m.title}」拆好了，挑想加的吧。`) })
    } catch (err) {
      a.err = err.message
    }
    a.busy = false
    if (this.ai === a) this.render()
  }
  _aiStepsAdd(p, mid) {
    const a = this.ai
    if (a?.kind !== 'steps' || a.mid !== mid || !a.steps) return
    const pick = a.steps.filter((_, i) => a.pick.has(i))
    this.ai = null
    let n = 0
    for (const t of pick) if (this.store.addStep(p.id, mid, t)) n++
    if (n < pick.length) this.hooks.toast({ icon: '細', title: `細項滿了，只加了 ${n} 個`, sub: '試著把這個里程碑拆成兩個' })
    this.render()
  }

  async _aiSummary(p) {
    const s = this.store
    const a = (this.ai = { kind: 'summary', busy: true })
    this.render()
    const { todo, done } = s.projectTasks(p.id)
    const st = projectStats(p, s.state.tasks)
    const by = msTasks(p, s.state.tasks)
    const msTitle = (id) => p.milestones.find((m) => m.id === id)?.title
    const data = {
      today: s.today,
      project: p.name,
      goal: p.goal,
      deadline: p.deadline || null,
      started: dayOf(p.createdAt),
      status: p.archived ? 'archived' : s.projectStatus(p),
      milestones: p.milestones.map((m) => ({
        title: m.title, done: m.done, doneOn: m.doneAt ? dayOf(m.doneAt) : null, due: m.due || null,
        steps: m.steps.length ? `${m.steps.filter((x) => x.done).length}/${m.steps.length}` : null,
        tasks: by.get(m.id).length ? `${by.get(m.id).filter((t) => t.done).length}/${by.get(m.id).length}` : null, note: m.note.slice(0, 200),
      })),
      logs: [...p.logs].sort((x, y) => y.at - x.at).slice(0, 15).map((l) => ({ date: l.date, text: l.text.slice(0, 400), mins: l.mins, milestone: (l.ms && msTitle(l.ms)) || null })),
      notes: [...p.notes].sort((x, y) => !!y.pinned - !!x.pinned || y.updatedAt - x.updatedAt).slice(0, 3).map((n) => ({ title: noteTitle(n), body: n.body.slice(0, 600) })),
      tasks: { todo: todo.slice(0, 12).map((t) => ({ title: t.title, date: t.date })), done: done.slice(0, 12).map((t) => t.title) },
      totals: { focusMinutes: st.focus, loggedMinutes: st.logMins, logs: st.logs },
    }
    try {
      const out = await askAI('summary', data)
      const o = { summary: clip(out?.summary, 400), done: clips(out?.done, 80, 5), blockers: clips(out?.blockers, 80, 3), next: clips(out?.next, 80, 3) }
      if (!o.summary) throw new Error('回答是空的，再試一次')
      Object.assign(a, { out: o, line: fuji('aiSummary', { project: p.name }, `「${p.name}」的進度整理好了。`) })
    } catch (err) {
      a.err = err.message
    }
    a.busy = false
    if (this.ai === a) this.render()
  }
  // 整理好的進度存成一篇筆記：接下來要做的事變成可以打勾的待辦
  _aiSave(p) {
    const a = this.ai
    if (a?.kind !== 'summary' || !a.out || a.saved) return
    const o = a.out
    const list = (title, items, todo = false) => (items.length ? ['', `## ${title}`, ...items.map((x) => `- ${todo ? '[ ] ' : ''}${x}`)] : [])
    const body = [o.summary, ...list('最近完成', o.done), ...list('卡住的地方', o.blockers), ...list('接下來', o.next, true)].join('\n')
    const n = this.store.addProjectNote(p.id, { title: `進度整理 ${md(this.store.today)}`, body })
    if (!n) return this.hooks.toast({ icon: '筆', title: '這個專案的筆記已經滿了', sub: '整理一下舊的筆記再存吧' })
    a.saved = true
    this.render()
    this.hooks.toast({ icon: '筆', title: '存成筆記了', sub: `在「筆記」裡：進度整理 ${md(this.store.today)}` })
  }

  // ── 事件 ──
  _click(e) {
    const p = this.project
    // 改名中的輸入框（點進去移游標）：不算點到外面那層的按鈕
    if (!p || e.target.closest('.inline-input')) return
    const s = this.store
    // 筆記預覽裡的待辦：直接打勾
    const chk = e.target.closest('.nb-check')
    if (chk) {
      const n = p.notes.find((x) => x.id === this.noteId)
      if (n) s.updateProjectNote(p.id, n.id, { body: toggleNoteLine(n.body, +chk.dataset.line) })
      return
    }
    const b = e.target.closest('[data-act]')
    if (!b || !this.root.contains(b) || b.disabled) return
    const act = b.dataset.act
    const id = b.dataset.id
    const note = p.notes.find((x) => x.id === this.noteId)
    switch (act) {
      case 'back': return this.hooks.close()
      case 'island': return this.hooks.viewOnIsland(p.id)
      case 'export': return this._export()
      case 'focus': return this.hooks.startFocusProject(p.id)
      case 'more':
        this.more = !this.more
        return this.render()
      case 'heat':
        this.heat = !this.heat
        try {
          localStorage.setItem(HEAT_KEY, this.heat ? '1' : '0')
        } catch {}
        return this.render()
      case 'rename':
        this.more = false
        this.render()
        return inlineEdit($('.pd-name', this.root), p.name, (v) => (v ? s.updateProject(p.id, { name: v }) : this._redraw('head')), 40)
      case 'color': return s.updateProject(p.id, { color: (p.color + 1) % PROJECT_COLORS.length })
      case 'deadline':
        this.dlEdit = true
        this.more = false
        this.render()
        return $('[data-keep="dl"]', this.root)?.focus()
      case 'dl-clear':
        this.dlEdit = false
        return p.deadline ? s.setDeadline(p.id, '') : this.render()
      case 'dl-cancel':
        this.dlEdit = false
        return this.render()
      case 'pause':
      case 'resume':
        this.more = false
        return s.pauseProject(p.id, act === 'pause')
      case 'archive':
        this.more = false
        return s.archiveProject(p.id, true)
      case 'restore':
        this.more = false
        if (!s.archiveProject(p.id, false)) this.hooks.toast({ icon: '町', title: '進行中的專案已經滿了', sub: '先收藏其他專案再放回來吧' })
        return
      case 'delete': return armConfirm(b, '確定刪除？', () => s.deleteProject(p.id))
      case 'sec':
        this.sec = b.dataset.v
        this.render()
        return this.root.querySelector('.pd-tabs')?.scrollIntoView({ block: 'nearest' })
      case 'mins': {
        this.mins = +b.dataset.v
        for (const x of $$('[data-act="mins"]', this.root)) {
          x.classList.toggle('on', +x.dataset.v === this.mins)
          x.setAttribute('aria-pressed', String(+x.dataset.v === this.mins))
        }
        // 下次重畫要照新的選擇重寫
        const box = $('[data-k="compose"]', this.root)
        if (box) box._html = null
        return
      }
      case 'log-edit':
        this.editLog = id
        this.render()
        return $(`[data-keep="le-${CSS.escape(id)}"]`, this.root)?.focus()
      case 'log-cancel':
        this.editLog = null
        return this.render()
      case 'log-del': return armConfirm(b, ICON.check, () => s.deleteProjectLog(p.id, id))
      case 'log-more':
        this.logDays += 30
        return this.render()
      case 'note-new':
        this.tplOpen = !this.tplOpen
        return this.render()
      case 'note-tpl': {
        const t = NOTE_TEMPLATES.find((x) => x.key === b.dataset.v) || NOTE_TEMPLATES[0]
        this.tplOpen = false
        const n = s.addProjectNote(p.id, { title: t.title, body: t.body })
        if (!n) return this.hooks.toast({ icon: '筆', title: '這個專案的筆記已經滿了', sub: '整理一下舊的筆記再新增吧' })
        return this._openNote(n.id, true)
      }
      case 'note-open': return this._openNote(id, false)
      case 'note-edit': return this._openNote(this.noteId, true)
      case 'note-view': return this._viewNote()
      case 'note-back': return this._closeNote()
      case 'note-pin': return note && s.updateProjectNote(p.id, note.id, { pinned: !note.pinned })
      case 'note-del': return note && armConfirm(b, '確定刪除？', () => s.deleteProjectNote(p.id, note.id))
      case 'ms-toggle': return s.toggleMilestone(p.id, id)
      case 'ms-open':
        if (this.openMs.has(id)) this.openMs.delete(id)
        else this.openMs.add(id)
        return this.render()
      case 'ms-up':
      case 'ms-down': return s.moveMilestone(p.id, id, act === 'ms-up' ? -1 : 1)
      case 'ms-rename': {
        const m = p.milestones.find((x) => x.id === id)
        const btn = $(`.pm-title[data-id="${CSS.escape(id)}"]`, this.root)
        if (!m || !btn) return
        // 標題本身是按鈕，輸入框不能放在按鈕裡：先換成一般的格子
        const box = document.createElement('span')
        box.className = 'pm-title pm-renaming'
        btn.replaceWith(box)
        return inlineEdit(box, m.title, (v) => (v ? s.updateMilestone(p.id, id, { title: v }) : this._redraw('ms')), 60)
      }
      case 'ms-del': return armConfirm(b, '確定刪除？', () => s.deleteMilestone(p.id, id))
      case 'step-toggle': return s.toggleStep(p.id, id, b.dataset.sid)
      case 'step-del': return s.deleteStep(p.id, id, b.dataset.sid)
      case 'step-rename': {
        const m = p.milestones.find((x) => x.id === id)
        const step = m?.steps.find((x) => x.id === b.dataset.sid)
        if (!step) return
        return inlineEdit(b, step.title, (v) => (v ? s.renameStep(p.id, id, step.id, v) : this._redraw('ms')), 80)
      }
      case 'ai-steps':
        if (this.ai?.kind === 'steps' && this.ai.mid === id && this.ai.busy) return
        return this._aiSteps(p, id)
      case 'ai-steps-add': return this._aiStepsAdd(p, id)
      case 'ai-summary':
        if (this.ai?.kind === 'summary' && this.ai.busy) return
        // 上面那顆鈕：卡片開著時再按一次是收起來
        if (b.classList.contains('pd-tbtn') && this.ai?.kind === 'summary') {
          this.ai = null
          return this.render()
        }
        return this._aiSummary(p)
      case 'ai-save': return this._aiSave(p)
      case 'ai-close':
        this.ai = null
        return this.render()
      case 'task-toggle': return s.toggleTask(id)
      case 'task-focus': return this.hooks.startFocus(id)
      case 'task-edit': return this.hooks.openEdit('task', id)
      case 'task-unlink':
        // 任務頁上的那顆要按兩下（移出去頁面就關了）
        if (b.closest('.pd-task')) return armConfirm(b, '確定移出？', () => s.updateTask(id, { project: null }))
        return s.updateTask(id, { project: null })
      case 'task-open': return this.openTask(id)
      case 'task-back': return this.closeTask()
      case 'tmins': {
        this.tmins = +b.dataset.v
        for (const x of $$('[data-act="tmins"]', this.root)) {
          x.classList.toggle('on', +x.dataset.v === this.tmins)
          x.setAttribute('aria-pressed', String(+x.dataset.v === this.tmins))
        }
        const box = $('[data-k="tcompose"]', this.root)
        if (box) box._html = null
        return
      }
    }
  }

  _submit(e) {
    const f = e.target.closest('form[data-form]')
    const p = this.project
    if (!f || !p) return
    e.preventDefault()
    const s = this.store
    const el = f.elements
    switch (f.dataset.form) {
      case 'log': {
        const text = el.text.value.trim()
        if (!text && !this.mins) return el.text.focus()
        const entry = { text, mins: this.mins, date: el.date.value, ms: el.ms?.value || null }
        // 先清空再存：存完會重畫，清空的欄位不會被當成「打到一半的字」接回去
        el.text.value = ''
        el.date.value = s.today
        if (el.ms) el.ms.value = ''
        this.mins = 0
        const box = $('[data-k="compose"]', this.root)
        if (box) box._html = null
        s.addProjectLog(p.id, entry)
        return
      }
      case 'tlog': {
        const t = this.task
        const text = el.text.value.trim()
        if (!t) return
        if (!text && !this.tmins) return el.text.focus()
        const entry = { text, mins: this.tmins, date: el.date.value, task: t.id }
        el.text.value = ''
        el.date.value = s.today
        this.tmins = 0
        const box = $('[data-k="tcompose"]', this.root)
        if (box) box._html = null
        s.addProjectLog(p.id, entry)
        return
      }
      case 'log-edit': {
        this.editLog = null
        // 專案沒有里程碑（表單裡沒有選單）：不動它
        const patch = { text: el.text.value, mins: +el.mins.value, date: el.date.value }
        if (el.ms) patch.ms = el.ms.value || null
        s.updateProjectLog(p.id, f.dataset.id, patch)
        return
      }
      case 'deadline':
        this.dlEdit = false
        if (el.date.value === p.deadline) return this.render()
        return s.setDeadline(p.id, el.date.value)
      case 'ms': {
        const input = f.querySelector('input')
        const v = input.value.trim()
        if (!v) return
        input.value = ''
        return s.addMilestone(p.id, v)
      }
      case 'step': {
        const input = f.querySelector('input')
        const v = input.value.trim()
        if (!v) return
        input.value = ''
        if (!s.addStep(p.id, f.dataset.id, v)) this.hooks.toast({ icon: '細', title: '細項已經滿了', sub: '試著把這個里程碑拆成兩個' })
        return
      }
      case 'task': {
        const title = el.title.value.trim()
        if (!title) return el.title.focus()
        const date = el.date.value || s.today
        el.title.value = ''
        s.addTask({ title, date, tag: 'work', project: p.id })
        if (date !== s.today) this.hooks.toast({ icon: '種', title: `已種在 ${md(date)}`, sub: title })
      }
    }
  }

  _input(e) {
    const el = e.target
    if (el.matches('[data-grow]')) this._growOne(el)
    if (el.matches('.pn-title, .pn-body')) this._queueNoteSave()
    if (el.matches('[data-noteq]') && !e.isComposing) this._query(el.value)
  }

  _query(v) {
    if (v === this.noteQuery) return
    this.noteQuery = v
    this.render()
  }

  _change(e) {
    const el = e.target
    const p = this.project
    if (!p) return
    if (el.matches('[data-goal]')) return this.store.setProjectGoal(p.id, el.value)
    if (el.dataset.tnote) return this.store.updateTask(el.dataset.tnote, { note: el.value })
    if (el.dataset.msnote) return this.store.updateMilestone(p.id, el.dataset.msnote, { note: el.value })
    if (el.dataset.msdue) return this.store.updateMilestone(p.id, el.dataset.msdue, { due: el.value })
    // 拆細項的勾選：只改按鈕上的數字，不整塊重畫（焦點留在勾選框上）
    if (el.dataset.aipick != null && this.ai?.pick) {
      const i = +el.dataset.aipick
      if (el.checked) this.ai.pick.add(i)
      else this.ai.pick.delete(i)
      const btn = $('[data-act="ai-steps-add"]', this.root)
      if (btn) {
        btn.textContent = `加入 ${this.ai.pick.size} 個`
        btn.disabled = !this.ai.pick.size
      }
      const box = $('[data-k="ms"]', this.root)
      if (box) box._html = null
    }
  }

  _key(e) {
    if (e.isComposing || e.keyCode === 229) return
    const el = e.target
    // Ctrl／⌘＋Enter 送出進度
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && el.form?.matches('[data-form="log"], [data-form="tlog"], [data-form="log-edit"]')) {
      e.preventDefault()
      return el.form.requestSubmit()
    }
    // 細項名稱是可以點的字（點了換成輸入框）：鍵盤用 Enter／空白鍵也能改
    if ((e.key === 'Enter' || e.key === ' ') && el.matches('span[role="button"][data-act]')) {
      e.preventDefault()
      return el.click()
    }
    // 目標只是一兩句話：Enter 就存（Shift＋Enter 換行）
    if (e.key === 'Enter' && !e.shiftKey && el.matches('[data-goal]')) {
      e.preventDefault()
      return el.blur()
    }
    if (e.key !== 'Escape') return
    // Esc 先收掉正在編輯的那一塊（處理了就不再往外傳，面板不會跟著關）
    if (el.closest('[data-form="log-edit"]')) this.editLog = null
    else if (el.closest('[data-form="deadline"]')) this.dlEdit = false
    else if (this.noteEdit && el.closest('.pd-note')) return (e.preventDefault(), this._viewNote())
    else return
    e.preventDefault()
    this.render()
  }

  // ── 筆記 ──
  _openNote(nid, edit) {
    const p = this.project
    const n = p?.notes.find((x) => x.id === nid)
    if (!n) return
    this._flushNote()
    if (this.noteId && this.noteId !== nid) this._dropEmptyNote()
    this.noteId = nid
    this.noteEdit = edit
    this.noteSnap = edit ? { title: n.title, body: n.body } : null
    // 編輯器裡的字是從哪一版開始改的（判斷別的地方有沒有動過這篇）
    this.noteBase = this.noteSnap && { ...this.noteSnap }
    this.sec = 'notes'
    this.render()
    $('.pd-notes', this.root)?.scrollIntoView({ block: 'nearest' })
    if (!edit) return $('.pn-back', this.root)?.focus({ preventScroll: true })
    const el = $(n.title || n.body ? '.pn-body' : '.pn-title', this.root)
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange?.(el.value.length, el.value.length)
  }
  _viewNote() {
    this._flushNote()
    if (this._dropEmptyNote()) return this._closeNote()
    this.noteEdit = false
    this.noteSnap = this.noteBase = null
    this.render()
    $('.pd-note [data-act="note-edit"]', this.root)?.focus({ preventScroll: true })
  }
  _closeNote() {
    this._flushNote()
    this._dropEmptyNote()
    this.noteId = this.noteSnap = this.noteBase = null
    this.noteEdit = false
    this.render()
    $('[data-act="note-new"]', this.root)?.focus({ preventScroll: true })
  }
  // 標題和內容都空著的筆記（按了新筆記又沒寫）不留
  _dropEmptyNote() {
    const p = this.project
    const n = p?.notes.find((x) => x.id === this.noteId)
    if (!n || n.title.trim() || n.body.trim()) return false
    this.noteId = this.noteSnap = this.noteBase = null
    this.noteEdit = false
    this.store.deleteProjectNote(p.id, n.id)
    return true
  }
  _queueNoteSave() {
    clearTimeout(this._noteT)
    this._noteT = setTimeout(() => this._saveNote(), 600)
    this._saved('')
  }
  _flushNote() {
    if (this._noteT) this._saveNote()
  }
  // 打字時的自動儲存：只存檔不重畫
  _saveNote() {
    clearTimeout(this._noteT)
    this._noteT = null
    const p = this.project
    const n = p?.notes.find((x) => x.id === this.noteId)
    const title = $('.pn-title', this.root)
    const body = $('.pn-body', this.root)
    if (!n || !title || !body) return
    this.noteBase = { title: title.value, body: body.value }
    if (n.title === title.value && n.body === body.value) return
    this.store.updateProjectNote(p.id, n.id, { title: title.value, body: body.value }, { quiet: true })
    this._saved('已自動儲存')
  }
  // 編輯中的筆記被別的地方改了（另一個分頁、同步拉回）：這邊沒打新的字就換成新的內容；
  // 兩邊都改了就把那一版另存成一篇「（另一個版本）」，不會被這邊接下來的自動儲存蓋掉
  _syncNote(p, n) {
    const base = this.noteBase
    if (!base || (n.title === base.title && n.body === base.body)) return
    this.noteBase = { title: n.title, body: n.body }
    const title = $('.pn-title', this.root)
    const body = $('.pn-body', this.root)
    if (!title || !body) return
    if (title.value === base.title && body.value === base.body) {
      title.value = n.title
      body.value = n.body
      this._growOne(body)
      return
    }
    const copy = { title: `${noteTitle(n)}（另一個版本）`.slice(0, 60), body: n.body }
    queueMicrotask(() => this.store.addProjectNote(p.id, copy))
  }
  _saved(text) {
    const el = $('.pn-saved', this.root)
    if (el) el.textContent = text
  }

  // 還沒存的字一次存起來（關掉詳情、離開頁面時）
  _flushAll() {
    this._flushNote()
    const p = this.project
    if (!p) return
    const goal = $('[data-goal]', this.root)
    if (goal && dirty(goal)) this.store.setProjectGoal(p.id, goal.value)
    for (const el of $$('[data-msnote]', this.root)) if (dirty(el)) this.store.updateMilestone(p.id, el.dataset.msnote, { note: el.value })
    const tnote = $('[data-tnote]', this.root)
    if (tnote && dirty(tnote)) this.store.updateTask(tnote.dataset.tnote, { note: tnote.value })
  }

  _export() {
    // 還在自動儲存倒數的筆記、還沒失焦的目標，先存進去再匯出
    this._flushAll()
    const p = this.project
    if (!p) return
    const blob = new Blob([projectMarkdown(p, this.store.state.tasks)], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${p.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'project'}.md`
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    this.hooks.toast({ icon: '書', title: '已匯出成 Markdown', sub: a.download })
  }

  // ── 重畫的小工具 ──
  // inlineEdit 直接改了 DOM：取消時要整塊重寫一次
  _redraw(k) {
    const el = $(`[data-k="${k}"]`, this.root)
    if (el) el._html = null
    this.render()
  }
  _capture() {
    const keep = new Map()
    for (const el of $$('[data-keep]', this.root)) if (dirty(el)) keep.set(el.dataset.keep, el.value)
    const a = document.activeElement
    let focus = null
    if (a && this.root.contains(a)) {
      // 正在改名的輸入框在可以點的字裡面（細項名稱）：重畫後焦點回到那個字上
      const t = a.dataset.act || a.dataset.keep ? a : a.closest('[data-act]')
      if (a.dataset.keep) focus = { keep: a.dataset.keep, start: a.selectionStart, end: a.selectionEnd }
      else if (t) focus = { act: t.dataset.act, id: t.dataset.id, sid: t.dataset.sid, v: t.dataset.v }
    }
    return { keep, focus }
  }
  _restore({ keep, focus }) {
    for (const el of $$('[data-keep]', this.root)) {
      const v = keep.get(el.dataset.keep)
      if (v !== undefined && el.value !== v) el.value = v
    }
    // 焦點所在的元素被換掉了：找新的那個接回去
    if (!focus || this.root.contains(document.activeElement)) return
    let sel
    if (focus.keep) sel = `[data-keep="${CSS.escape(focus.keep)}"]`
    else {
      sel = `[data-act="${CSS.escape(focus.act)}"]`
      for (const k of ['id', 'sid', 'v']) if (focus[k]) sel += `[data-${k}="${CSS.escape(focus[k])}"]`
    }
    // 任務頁開著時專案那邊藏起來了：先找任務頁裡的
    const el = (this.taskId && $(sel, $('.pd-task', this.root) || this.root)) || $(sel, this.root)
    if (!el) return
    el.focus({ preventScroll: true })
    if (focus.keep && focus.start != null) {
      try {
        el.setSelectionRange(focus.start, focus.end)
      } catch {}
    }
  }
  _grow() {
    for (const el of $$('[data-grow]', this.root)) this._growOne(el)
  }
  // 文字框跟著內容長高（藏起來的那幾塊量不到，等看得到時再量）
  _growOne(el) {
    if (!el.offsetParent) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }
}
