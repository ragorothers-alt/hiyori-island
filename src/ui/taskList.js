// UI 的方法（從 ui.js 搬過來，掛回 UI.prototype）：任務頁：列表、勾選、滑動、改期、逾期、子任務、卡關和好久沒碰的提示
import { flipItems, noteTap, calmMotion, countUp } from './motion.js'
import { bindSwipe } from './swipe.js'
import { TAGS, tagOf, PRIORITIES, PROJECT_COLORS, MAX_STARS, XP } from '../theme.js'
import { addDays, parseDate, repeatLabel, floating } from '../store.js'
import { $, $$, esc, ICON, armConfirm, inlineEdit, editing, scrollMode } from './dom.js'
import { taskDur, SPLIT_MIN, fmtDur } from '../planner.js'
import { COACH_LABEL, COACH_TIP } from './schedule.js'
import { PROJECT_LIMITS as PL } from '../projects.js'
import { STUCK_OFF_KEY, STUCK_SAID_KEY, IDLE_OFF_KEY, IDLE_SAID_KEY, IDLE_DAYS, readLocal, writeLocal, touchUI, SAMPLE_TAG, hhmm } from './shared.js'

export const taskListMethods = {
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
    $('#taskProject').addEventListener('change', (e) => {
      this.taskProject = e.target.value || null
      this._renderProjectPick()
      this._renderQuickPreview()
    })
    $('#taskRepeat').addEventListener('change', () => this._renderQuickPreview())
    $('#taskForm').addEventListener('submit', (e) => {
      e.preventDefault()
      const input = $('#taskTitle')
      const before = new Set(this.store.state.tasks.map((t) => t.id))
      const r = this.quickAdd(input.value, { repeat: this._repeatValue('#taskRepeat'), project: this._taskProject(), asTask: !!this.quickAsTask })
      if (!r) {
        input.focus()
        return
      }
      // 重畫完（下一個 task）再找剛加的那件
      setTimeout(() => this._showAdded(before), 0)
      r.toasts.forEach((t) => this.toast(t))
      // 記下了：說一聲記在哪天，可以直接排進空檔、撤銷（種到別天的上面已經說了）。
      // ふじ會自己替它排的話（接上 Claude、自己整理開著）：不放「排進空檔」，說一聲她等一下會排（兩邊一起排會打架）
      if (r.task && !r.toasts.length) {
        const id = r.task
        const t = this.store.state.tasks.find((x) => x.id === id)
        const fuji = !t?.at && this.agent?.takes?.(t)
        this.toast({
          icon: '種', title: `記下了「${r.title.length > 14 ? `${r.title.slice(0, 13)}…` : r.title}」`,
          sub: fuji ? `${r.sub}・${this.store.state.settings.agentMode === 'ask' ? 'ふじ等一下想好時段先問你' : 'ふじ等一下替它排時段'}` : r.sub, ms: 4200, tag: 'added',
          actions: [
            ...(t?.at || fuji ? [] : [{ label: '排進空檔', soft: true, run: () => this.schedule._slot(id) }]),
            ...(r.undo ? [{ label: '撤銷', soft: true, run: r.undo }] : []),
          ],
        })
      }
      $('#taskRepeat').value = 'none'
      $('#taskRepeat').classList.remove('on')
      input.value = ''
      this.quickAsTask = false
      this._renderQuickPreview()
      input.focus()
    })
    // 預覽上的「改成任務／改回日程」
    $('#quickPreview').addEventListener('click', (e) => {
      if (!e.target.closest('[data-swap]')) return
      this.quickAsTask = !this.quickAsTask
      this._renderQuickPreview()
      $('#taskTitle').focus()
    })

    const onList = (e) => {
      // 空白時的兩個按鈕：快速加一個、讓ふじ排主攻時段
      const ea = e.target.closest('[data-act="quickAdd"], [data-act="coachDay"]')
      if (ea) {
        if (ea.dataset.act === 'quickAdd') $('#taskTitle').focus()
        else this.coachDay(this.store.selectedDate)
        return
      }
      const li = e.target.closest('.item')
      // 點在正在改名的輸入框裡（它在可以按的字裡面）：不要再觸發一次
      if (!li || e.target.closest('.inline-input')) return
      const id = li.dataset.id
      const act = e.target.closest('[data-act]')?.dataset.act
      const s = this.store
      if (act === 'toggle') s.toggleTask(id)
      else if (act === 'star') s.toggleStar(id)
      // 那天挑好先做的那一件：再按一下就不挑了
      else if (act === 'first') s.setFirst(id, false)
      else if (act === 'delete') armConfirm(e.target.closest('button'), ICON.check, () => s.deleteTask(id))
      // 編輯：打開編輯面板（名稱、日期、時間、長度、截止日、本命、子任務、分段…都在裡面）
      else if (act === 'edit') this.schedule.openEdit('task', id)
      else if (act === 'pri') {
        const t = s.state.tasks.find((x) => x.id === id)
        s.updateTask(id, { priority: (t.priority % 3) + 1 })
      } else if (act === 'tag') {
        const t = s.state.tasks.find((x) => x.id === id)
        const i = TAGS.findIndex((x) => x.id === t.tag)
        s.updateTask(id, { tag: TAGS[(i + 1) % TAGS.length].id })
      } else if (act === 'today') s.moveToToday([id])
      else if (act === 'due') this._pickDue(id, e.target.closest('button'))
      else if (act === 'split') this._split(id)
      else if (act === 'proj') this.openProject(s.state.tasks.find((x) => x.id === id)?.project, undefined, id)
      else if (act === 'focus') this.focus.ask(id)
      else if (act === 'subs') {
        const t = s.state.tasks.find((x) => x.id === id)
        if (!t) return
        const open = !this._subsOpen(t)
        this.subsView.set(id, open)
        this.renderTasks()
        // 還沒有子任務：打開就直接打字
        if (open && !(t.subs || []).length) $(`.item[data-id="${CSS.escape(id)}"] .sub-add input`)?.focus()
      } else if (act === 'sub-toggle' || act === 'sub-del' || act === 'sub-rename') {
        const sid = e.target.closest('[data-sid]').dataset.sid
        if (act === 'sub-toggle') s.toggleSub(id, sid)
        else if (act === 'sub-del') s.deleteSub(id, sid)
        else {
          const x = s.state.tasks.find((t) => t.id === id)?.subs?.find((y) => y.id === sid)
          if (x) inlineEdit(e.target.closest('.sub-t'), x.title, (v) => (v ? s.renameSub(id, sid, v) : this.renderTasks()), PL.subTitle)
        }
      } else if (!act && !e.target.closest('input, .subs')) {
        // 手機（觸控）：任務列上只留完成和專注，點任務本身打開編輯面板；電腦照舊（島上那朵花亮一下）
        if (touchUI()) this.schedule.openEdit('task', id)
        else this.hooks.focusTask(id)
      }
    }
    // 子任務：Enter 加一個，輸入框留著接著打下一個
    const onSubAdd = (e) => {
      const f = e.target.closest('.sub-add')
      if (!f) return
      e.preventDefault()
      const input = $('input', f)
      const v = input.value.trim()
      if (!v) return
      input.value = ''
      this.subsView.set(f.dataset.id, true)
      if (!this.store.addSub(f.dataset.id, v)) this.toast({ icon: '細', title: '子任務已經滿了', sub: `一件任務最多 ${PL.subs} 個` })
    }
    // 子任務的名稱是可以按的字：Enter、空白鍵也能改名
    const onSubKey = (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.sub-t[data-act]')) {
        e.preventDefault()
        e.target.click()
      }
    }
    for (const el of [$('#taskList'), $('#overdueBox')]) {
      el.addEventListener('submit', onSubAdd)
      el.addEventListener('keydown', onSubKey)
    }
    $('#taskList').addEventListener('click', onList)
    $('#stuckBox').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]')
      if (!b) return
      const s = this.store
      const id = b.dataset.id
      const t = s.state.tasks.find((x) => x.id === id)
      if (!t) return
      const act = b.dataset.act
      // 好久沒碰的長期任務
      if (act === 'idle-open') return this.openProject(t.project, undefined, id)
      if (act === 'idle-focus') return this.focus.ask(id)
      // 只做 5 分鐘：卡住的、好久沒碰的，先開個頭（ふじ不另外說：計時開始時會說）
      if (act === 'small') return this.focus.startSmall(id)
      if (act === 'idle-snooze') {
        this.snoozeIdle(id)
        return this.renderTasks()
      }
      if (act === 'split') s.splitTask(id)
      else if (act === 'later') s.updateTask(id, { date: addDays(s.today, 1), at: null })
      else if (act === 'drop') return armConfirm(b, '確定放下', () => {
        s.deleteTask(id)
        this.hooks.stuck?.('drop', t)
      })
      else if (act === 'mute') {
        writeLocal(STUCK_OFF_KEY, [...readLocal(STUCK_OFF_KEY, []), id].slice(-200))
        this.renderTasks()
        return
      }
      this.hooks.stuck?.(act, t)
    })
    $('#overdueBox').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]')
      const act = b?.dataset.act
      const s = this.store
      if (act === 'allToday') return this._moveOverdue(s.overdue().map((t) => t.id), s.today)
      if (act === 'odMore') {
        this._odOpen = !this._odOpen
        this.renderTasks()
        // 重畫換了新的按鈕：焦點留在「還有幾件／收起來」上
        return $('#overdueBox [data-act="odMore"]')?.focus({ preventScroll: true })
      }
      // 挑幾件：勾起來，再一起移到今天或明天（記著勾的時候是哪一天：之後別處改過日子的不算）
      if (act === 'odPick') {
        this._odPick = new Map()
        this.renderTasks()
        return $('#overdueBox [data-pick]')?.focus({ preventScroll: true })
      }
      if (act === 'odCancel') {
        this._odPick = null
        return this.renderTasks()
      }
      if (act === 'odToday' || act === 'odTomorrow') {
        // 勾好之後別的分頁、別台已經改過的（不再逾期了、改到另一天了）不算
        const still = new Map(s.overdue().map((t) => [t.id, t.date]))
        const ids = [...(this._odPick || [])].filter(([id, date]) => still.get(id) === date).map(([id]) => id)
        this._odPick = null
        if (!ids.length) return this.renderTasks()
        return this._moveOverdue(ids, act === 'odToday' ? s.today : addDays(s.today, 1))
      }
      if (this._odPick) return
      onList(e)
    })
    $('#overdueBox').addEventListener('change', (e) => {
      const c = e.target.closest('[data-pick]')
      if (!c || !this._odPick) return
      const t = this.store.state.tasks.find((x) => x.id === c.dataset.pick)
      if (c.checked && t) this._odPick.set(t.id, t.date)
      else this._odPick.delete(c.dataset.pick)
      const n = this._odPick.size
      for (const btn of $$('#overdueBox .od-acts [data-n]')) {
        btn.disabled = !n
        btn.querySelector('b').textContent = n ? `（${n}）` : ''
      }
    })
    for (const el of [$('#taskList'), $('#overdueBox')]) {
      el.addEventListener('mouseover', (e) => {
        const li = e.target.closest('.item')
        this.hooks.hoverTask(li ? li.dataset.id : null)
      })
      el.addEventListener('mouseleave', () => this.hooks.hoverTask(null))
      // 手機上左右滑：往右完成、往左明天再做（逾期的移到今天）
      bindSwipe(el, (id) => this._swipeActions(id))
    }
  },

  // 任務列左右滑可以做的事（swipe.js）：right 是往右滑、left 是往左滑；沒有的方向是 null
  _swipeActions(id) {
    const s = this.store
    const t = s.state.tasks.find((x) => x.id === id)
    if (!t) return null
    const right = t.done
      ? { label: '↺ 還沒做完', color: '#b4c2d8', run: () => s.toggleTask(id) }
      : {
          label: '✓ 完成',
          color: tagOf(t.tag).color,
          run: (li) => {
            // 花瓣從這一列的勾爆開（不是用按的，motion.js 量不到剛按的地方）
            noteTap(li.querySelector('.check'))
            s.toggleTask(id)
          },
        }
    let left = null
    if (!t.done && t.date) {
      if (t.date < s.today) left = { label: '移到今天', color: '#9fcdec', run: () => s.moveToToday([id]) }
      else left = { label: t.date === s.today ? '明天再做' : '延後一天', color: '#f3cd7d', run: () => this._postpone(id) }
    }
    return { right, left }
  },
  // 剛用上面的輸入框加的那件：看得到就亮一下；排在看不到的地方（清單很長、加到下面去了），輸入框下面浮一顆
  // 「剛加的在下面」，點了捲過去再亮。不自動捲：還要接著打下一件，輸入框不能被捲走
  _showAdded(before) {
    this._hideAdded()
    const li = $$('#taskList .item[data-id], #overdueBox .item[data-id]').find((el) => !before.has(el.dataset.id))
    if (!li) return
    const id = li.dataset.id
    if (this._inView(li)) return this._glow(li)
    const hint = $('#addedHint')
    const title = li.querySelector('.item-title')?.textContent.trim() || ''
    hint.innerHTML = `<span>剛加的「${esc(title)}」在下面</span><i aria-hidden="true">↓</i>`
    hint.hidden = false
    this._addedId = id
    hint.onclick = () => {
      this._hideAdded()
      const el = $(`#taskList .item[data-id="${CSS.escape(id)}"], #overdueBox .item[data-id="${CSS.escape(id)}"]`)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: scrollMode() })
      setTimeout(() => this._glow(el), calmMotion() ? 0 : 380)
    }
    this._addedT = setTimeout(() => this._hideAdded(), 6000)
    // 自己捲下去看到了：膠囊收起來，那件亮一下
    if (!this._addedScroll) {
      this._addedScroll = true
      $('.panel-body').addEventListener(
        'scroll',
        () => {
          if (!this._addedId) return
          const el = $(`.item[data-id="${CSS.escape(this._addedId)}"]`)
          if (!el || !this._inView(el)) return
          this._hideAdded()
          this._glow(el)
        },
        { passive: true },
      )
    }
  },
  _hideAdded() {
    clearTimeout(this._addedT)
    this._addedId = null
    const hint = $('#addedHint')
    if (hint) hint.hidden = true
  },
  // 這一列在面板裡看得到嗎（手機 App 模式下面被番茄鐘膠囊和分頁列蓋住的那段不算）
  _inView(el) {
    const body = el.closest('.panel-body')
    if (!body || !el.getClientRects().length) return false
    const r = el.getBoundingClientRect()
    const v = body.getBoundingClientRect()
    const dock = $('.dock')?.getBoundingClientRect()
    const bottom = this.appMode && matchMedia('(max-width: 860px)').matches && dock?.height ? Math.min(v.bottom, dock.top) : v.bottom
    return r.top >= v.top - 2 && r.bottom <= bottom + 2
  },
  _glow(el) {
    if (calmMotion() || !el?.isConnected) return
    el.animate([{ offset: 0, backgroundColor: 'rgba(241, 155, 178, .32)' }], { duration: 1600, easing: 'ease-out' })
  },

  // 往後挪一天，說一聲，可以復原（復原回到原本的日子和時段）
  // to：挪到哪一天（預設是那件的隔天；排的時間到了的提示卡是從今天算的明天，昨晚開始、過了午夜才結束的那件也挪到明天）
  _postpone(id, to = null) {
    const s = this.store
    const t = s.state.tasks.find((x) => x.id === id)
    if (!t) return
    to ||= addDays(t.date, 1)
    // 復原交給 store：日期、時段、往後挪的次數（卡關提醒用）、被擠掉的本命都放回去
    const undo = s.postponeTask(id, to)
    if (!undo) return
    this.toast({
      icon: '延',
      title: to === addDays(s.today, 1) ? '移到明天了' : `移到 ${to.slice(5).replace('-', '/')} 了`,
      sub: t.title,
      ms: 5200,
      tag: 'swipe',
      actions: [
        {
          label: '復原',
          // 挪過去之後又排了時段、做完了、換了日子：不搬回去，說一聲
          run: () => s.undoPostpone(undo) || this.toast({ icon: '延', title: '這件挪過去之後又改過了', sub: '就留在現在的樣子', ms: 3400 }),
        },
      ],
    })
  },

  // 截止日：用瀏覽器自己的日期選擇器（一個藏起來的 <input type="date">，放在按鈕旁邊）。清掉＝不設
  _pickDue(id, btn) {
    const s = this.store
    const t = s.state.tasks.find((x) => x.id === id)
    if (!t) return
    let input = this._dueInput
    if (!input) {
      input = this._dueInput = document.createElement('input')
      input.type = 'date'
      input.className = 'due-pick'
      input.setAttribute('aria-label', '截止日')
      input.tabIndex = -1
      document.body.appendChild(input)
      input.addEventListener('change', () => {
        const tid = input.dataset.id
        const v = input.value || null
        const was = s.state.tasks.find((x) => x.id === tid)
        if (!was || (was.due ?? null) === v) return
        s.updateTask(tid, { due: v })
        this.toast({ icon: '旗', title: v ? `截止日 ${+v.slice(5, 7)}/${+v.slice(8)}` : '不設截止日了', sub: was.title, ms: 2800 })
      })
    }
    input.dataset.id = id
    input.value = t.due || ''
    const r = btn?.getBoundingClientRect()
    input.style.left = `${Math.round(r?.left ?? innerWidth / 2)}px`
    input.style.top = `${Math.round(r?.bottom ?? innerHeight / 2)}px`
    try {
      input.showPicker()
    } catch {
      input.focus()
      input.click()
    }
  },
  // 大任務分成幾段、分到幾天做（一天一段，有截止日的分在截止日前）；可以復原
  // 到任務頁打開那一件的子任務（還沒有子任務就直接打字）
  openSubs(id) {
    const s = this.store
    const t = s.state.tasks.find((x) => x.id === id)
    if (!t) return
    this._calendar.view?.close()
    // 長期的不在每天的清單上：打開專案裡的那一件
    if (floating(t) && t.project) return this.openProject(t.project, undefined, t.id)
    // 還沒做完的過去任務在今天的「逾期」裡；做完的在那一天
    const day = !t.done && t.date < s.today ? s.today : t.date
    if (day !== s.selectedDate) s.selectDate(day)
    this.setTab('tasks')
    this.subsView.set(id, true)
    this.renderTasks()
    requestAnimationFrame(() => {
      const li = $(`#taskList .item[data-id="${CSS.escape(id)}"], #overdueBox .item[data-id="${CSS.escape(id)}"]`)
      li?.scrollIntoView({ block: 'center', behavior: scrollMode() })
      li?.querySelector('.sub-add input')?.focus({ preventScroll: true })
    })
  },
  // 教練的「計畫」那一頁，要排的就是這一天（任務頁、日程頁空著的那天按「讓ふじ排主攻時段」）
  coachDay(date) {
    this.setTab('coach')
    this._use(this._coach, (c) => c.preset({ scope: date === this.store.today ? 'today' : 'day', date }))
  },
  // 排進時段之後：說排在哪裡，可以看位置、撤銷（回到原本的日子和時段）
  scheduled(id, undo) {
    const s = this.store
    const t = s.state.tasks.find((x) => x.id === id)
    if (!t?.at) return
    const day = t.date === s.today ? '今天' : t.date === addDays(s.today, 1) ? '明天' : `${+t.date.slice(5, 7)}/${+t.date.slice(8)}`
    this.toast({
      icon: '時', title: `排在${day} ${t.at}`, sub: `${t.title}・${fmtDur(taskDur(t))}`, ms: 6000, tag: 'scheduled',
      actions: [
        { label: '看位置', soft: true, run: () => this.showOnTimeline(id) },
        { label: '撤銷', soft: true, run: () => s.undoSlot(undo) || this.toast({ icon: '時', title: '排好之後又改過了', sub: '就留著現在的樣子', ms: 3400 }) },
      ],
    })
  },
  // 到日程頁那一天，捲到那一件、亮一下
  showOnTimeline(id) {
    const t = this.store.state.tasks.find((x) => x.id === id)
    if (!t) return
    // 月曆蓋在上面的話先收起來
    this._calendar.view?.close()
    this.store.selectDate(t.date)
    this.setTab('schedule')
    requestAnimationFrame(() => {
      const b = $(`.blk[data-id="${CSS.escape(id)}"]`)
      if (!b) return
      b.scrollIntoView({ block: 'center', behavior: scrollMode() })
      setTimeout(() => this._glow(b), calmMotion() ? 0 : 380)
    })
  },
  _split(id) {
    const s = this.store
    const t = s.state.tasks.find((x) => x.id === id)
    const u = t && s.splitSessions(id)
    if (!u) return
    const days = [u.after.date, ...u.made.map((m) => s.state.tasks.find((x) => x.id === m.id)?.date)].filter(Boolean)
    const md = (d) => (d === s.today ? '今天' : `${+d.slice(5, 7)}/${+d.slice(8)}`)
    this.toast({
      icon: '分', title: `分成 ${u.made.length + 1} 段，每段 ${u.after.dur} 分鐘`, sub: [...new Set(days)].map(md).join('、'), ms: 6000,
      actions: [{ label: '復原', run: () => s.undoSplit(u) || this.toast({ icon: '分', title: '分出來的那幾段之後改過了', sub: '就留著現在的樣子', ms: 3400 }) }],
    })
  },

  // 逾期的先看哪幾件：本命、先做這件、截止日近的、優先度高的，再來是比較近的日子
  _overdueOrder(list) {
    const due = (t) => t.due || '9999-12-31'
    return [...list].sort((a, b) => !!b.star - !!a.star || !!b.first - !!a.first || due(a).localeCompare(due(b)) || b.priority - a.priority || b.date.localeCompare(a.date))
  },
  // 逾期的那一塊：超過 3 件時先收起來，只列最要緊的 3 件（越堆越多也不會把今天的任務擠到好幾頁之後）；
  // 「挑幾件」時每一件前面有勾選框，勾好一起移到今天或明天
  _overdueHTML(overdue) {
    const pick = this._odPick
    const head = `<h4><span>還沒完成的昨日花苞 · ${overdue.length}</span><span class="od-btns">${
      pick ? '' : `${overdue.length > 1 ? '<button data-act="odPick">挑幾件</button>' : ''}<button data-act="allToday">全部移到今天</button>`
    }</span></h4>`
    if (pick) {
      const n = pick.size
      const rows = overdue
        .map((t) => `<li class="od-row"><label><input type="checkbox" data-pick="${esc(t.id)}" ${pick.has(t.id) ? 'checked' : ''}><span class="od-t">${esc(t.title)}</span><small>${esc(t.date.slice(5).replace('-', '/'))}</small></label></li>`)
        .join('')
      return `<div class="overdue picking">${head}<ul class="od-list">${rows}</ul>
        <div class="od-acts"><button class="btn-primary" data-act="odToday" data-n ${n ? '' : 'disabled'}>移到今天<b>${n ? `（${n}）` : ''}</b></button><button class="btn-ghost" data-act="odTomorrow" data-n ${n ? '' : 'disabled'}>移到明天<b>${n ? `（${n}）` : ''}</b></button><button class="btn-ghost" data-act="odCancel">取消</button></div></div>`
    }
    const SHOW = 3
    const open = this._odOpen || overdue.length <= SHOW + 1
    const shown = open ? overdue : overdue.slice(0, SHOW)
    const more = overdue.length > SHOW + 1 ? `<button class="od-more" data-act="odMore" aria-expanded="${open}">${open ? '收起來 ▴' : `還有 ${overdue.length - SHOW} 件 ▾`}</button>` : ''
    return `<div class="overdue">${head}<ul class="list">${shown.map((t) => this._taskItem(t, true)).join('')}</ul>${more}</div>`
  },
  // 整批移動逾期的任務（全部、挑的那幾件）：提示卡上可以撤銷，每一件回到各自原本的那天
  _moveOverdue(ids, to) {
    const s = this.store
    const u = s.moveToToday(ids, to)
    this.renderTasks()
    if (!u) return
    const n = u.items.length
    const day = to === s.today ? '今天' : to === addDays(s.today, 1) ? '明天' : to.slice(5).replace('-', '/')
    this.toast({
      icon: '今', title: `${n} 件移到${day}了`, sub: n > 1 ? '撤銷的話，每一件回到原本那天' : '撤銷的話回到原本那天', ms: 8000,
      actions: [{ label: '撤銷', run: () => s.undoMove(u) }],
    })
  },
  _taskItem(t, overdue = false) {
    const tag = tagOf(t.tag)
    const pri = PRIORITIES[t.priority] || PRIORITIES[2]
    const meta = [
      `<button class="pri pri-${t.priority}" data-act="pri" title="點一下切換優先度">${'◆'.repeat(t.priority)}${'◇'.repeat(3 - t.priority)} ${pri.label}</button>`,
      `<button data-act="tag" title="點一下切換分類">${tag.label}</button>`,
    ]
    if (t.star) meta.unshift(`<button class="star on" data-act="star" ${t.done ? 'disabled title="本命・已完成"' : 'title="取消本命"'}>★ 本命</button>`)
    else if (!t.done && t.date >= this.store.today) meta.unshift(`<button class="star" data-act="star" title="設為本命：完成給雙倍 XP（每天最多 ${MAX_STARS} 件）">☆</button>`)
    // 前一晚挑好、那天先做的那一件
    if (t.first && !t.done) meta.unshift(`<button class="first-tag" data-act="first" title="那天先做這件（晚上在今日總覽挑的）。按一下就不挑了">先做這件</button>`)
    if (t.pomos) meta.push(`<span class="pomo" title="已專注 ${t.pomos} 輪">◷ ${t.pomos}</span>`)
    const proj = t.project && this.store.state.projects.find((p) => p.id === t.project)
    if (proj) {
      const name = proj.name.length > 8 ? `${proj.name.slice(0, 8)}…` : proj.name
      meta.push(`<button class="proj-tag" data-act="proj" style="--pc:${PROJECT_COLORS[proj.color % PROJECT_COLORS.length]}" title="打開這件任務在專案「${esc(proj.name)}」裡的頁面（說明和紀錄）">${esc(name)}</button>`)
    }
    const rt = this.store.routineOf(t)
    if (rt) meta.push(`<span class="rep">↻ ${esc(repeatLabel(rt.repeat))}</span>`)
    if (t.done && t.doneAt) meta.push(`<span>${hhmm(t.doneAt)} 綻放</span>`)
    if (overdue) meta.push(`<span>${esc(t.date.slice(5).replace('-', '/'))}</span>`)
    // 截止日（跟打算哪天做分開）：快到了、過了、排在截止日之後都標出來
    if (t.due && !t.done) {
      const left = Math.round((parseDate(t.due) - parseDate(this.store.today)) / 86400000)
      const md = `${+t.due.slice(5, 7)}/${+t.due.slice(8)}`
      const after = !floating(t) && t.date > t.due
      const word = left < 0 ? `過了 ${-left} 天` : left === 0 ? '今天截止' : left === 1 ? '明天截止' : `還有 ${left} 天`
      const cls = left < 0 || after ? ' late' : left <= 2 ? ' soon' : ''
      meta.push(`<button class="due-tag${cls}" data-act="due" title="截止日 ${md}${after ? '（排在截止日之後了）' : ''}。點一下改">⚑ ${md}・${word}</button>`)
    }
    if (t.spent && t.dur) meta.push(`<span class="spent" title="用專注計時做了 ${t.spent} 分鐘（預估 ${t.dur} 分鐘）">做了 ${t.spent}／估 ${t.dur} 分</span>`)
    const subs = t.subs || []
    const open = this._subsOpen(t)
    const sd = subs.filter((x) => x.done).length
    if (subs.length) {
      meta.push(`<button class="subs-tag${sd === subs.length ? ' ok' : ''}" data-act="subs" aria-expanded="${open}" title="${open ? '收起' : '展開'}子任務">${ICON.subs}${sd}/${subs.length}</button>`)
    }
    if (this.store.isSample(t)) meta.unshift(SAMPLE_TAG)
    return `<li class="item ${t.done ? 'done' : ''} ${t.star ? 'starred' : ''} ${open ? 'subs-open' : ''} ${this.hlKey === 'task:' + t.id ? 'hl' : ''}" data-id="${esc(t.id)}" style="--c:${tag.color}">
      <button class="check" data-act="toggle" aria-label="完成「${esc(t.title)}」" aria-pressed="${!!t.done}">${ICON.check}</button>
      <div class="item-main">
        <div class="item-title">${esc(t.title)}</div>
        <div class="item-meta">${meta.join('')}</div>
        ${open ? this._subsHTML(t) : ''}
      </div>
      <div class="item-actions">
        ${overdue ? `<button class="mini" data-act="today" title="移到今天">${ICON.today}</button>` : ''}
        ${!t.done && !overdue && t.date === this.store.today ? `<button class="mini" data-act="focus" title="專注在這件事上">${ICON.play}</button>` : ''}
        ${subs.length ? '' : `<button class="mini" data-act="subs" aria-expanded="${open}" title="${open ? '收起子任務' : '拆成子任務'}">${ICON.subs}</button>`}
        ${!t.done && !t.due ? `<button class="mini" data-act="due" title="設截止日（一定要做完的那天）">${ICON.flag}</button>` : ''}
        ${!t.done && !t.routineId && !floating(t) && taskDur(t) >= SPLIT_MIN ? `<button class="mini" data-act="split" title="分成幾段，分到幾天做">${ICON.split}</button>` : ''}
        <button class="mini" data-act="edit" title="編輯">${ICON.edit}</button>
        <button class="mini" data-act="delete" title="刪除">${ICON.del}</button>
      </div>
    </li>`
  },

  // 子任務展開了沒：自己按過就照按的；沒按過的，還有沒做完的子任務就展開
  _subsOpen(t) {
    return this.subsView.get(t.id) ?? (!t.done && (t.subs || []).some((x) => !x.done))
  },
  _subsHTML(t) {
    const id = esc(t.id)
    const subs = t.subs || []
    const rows = subs
      .map((x) => `<li class="${x.done ? 'done' : ''}">
        <button class="check" data-act="sub-toggle" data-sid="${esc(x.id)}" aria-label="完成「${esc(x.title)}」" aria-pressed="${!!x.done}">${ICON.check}</button>
        <span class="sub-t" role="button" tabindex="0" data-act="sub-rename" data-sid="${esc(x.id)}" title="點一下改名">${esc(x.title)}</span>
        <button class="mini" data-act="sub-del" data-sid="${esc(x.id)}" title="刪除子任務" aria-label="刪除子任務「${esc(x.title)}」">${ICON.del}</button></li>`)
      .join('')
    const full = subs.length >= PL.subs
    return `<div class="subs">${rows ? `<ul>${rows}</ul>` : ''}${full ? '' : `<form class="sub-add" data-id="${id}" autocomplete="off">
      <input data-act="sub-input" maxlength="${PL.subTitle}" placeholder="${subs.length ? '再加一個子任務' : '拆成子任務：做完一個勾一個'}" aria-label="新增子任務（Enter 加入）">
      <button class="mini" type="submit" title="加入">${ICON.plus}</button></form>`}</div>`
  },

  renderTasks() {
    const s = this.store
    const tasks = s.tasksOn(s.selectedDate)
    const todo = tasks.filter((t) => !t.done).sort((a, b) => b.star - a.star || b.priority - a.priority || a.createdAt - b.createdAt)
    const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
    const n = tasks.length
    const k = done.length
    const pct = n ? Math.round((k / n) * 100) : 0
    // 百分比從上一次的數字走過去（圓環本身有 CSS 的轉場）
    const pe = $('#bloomPct')
    countUp(pe, pe._n, pct, { fmt: (v) => `${v}%` })
    pe._n = pct
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
    this._renderProjectPick()
    $('#taskTitle').placeholder = isToday ? '種下任務，或打「明天 15:00 開會 #工作」' : `為 ${s.selectedDate.slice(5).replace('-', '/')} 種下任務…`

    this._renderStuck(isToday)
    // 正在就地改名、或正在打新的子任務：先不重畫（同步拉回資料時會把正在選字的中文吃掉），改完或送出時會再畫一次
    const a = document.activeElement
    if (editing($('#taskList')) || editing($('#overdueBox')) || (a?.matches('.sub-add input') && a.value)) return
    const fk = this._listFocus()
    // 打到一半的子任務（焦點已經不在框裡，例如先去勾了別件）：重畫後填回同一件的框
    const subDrafts = $$('#taskList .sub-add input, #overdueBox .sub-add input')
      .filter((i) => i.value)
      .map((i) => [i.closest('#overdueBox') ? '#overdueBox' : '#taskList', i.closest('.sub-add').dataset.id, i.value])
    const overdue = isToday ? this._overdueOrder(s.overdue()) : []
    if (!overdue.length) this._odPick = null
    // 挑著的那幾件被別的分頁、別台改過（移到別天、做完了）：不再逾期、日子換了的從勾選拿掉，按鈕上的件數才對
    else if (this._odPick) for (const [id, date] of [...this._odPick]) if (!overdue.some((t) => t.id === id && t.date === date)) this._odPick.delete(id)
    // 整串重畫：原本就在的那幾件不重播淡入，位置變了的滑過去（做完的排到後面、從逾期移到今天）
    flipItems([$('#overdueBox'), $('#taskList')], () => {
      $('#overdueBox').innerHTML = overdue.length ? this._overdueHTML(overdue) : ''
      $('#taskList').innerHTML = n
        ? [...todo, ...done].map((t) => this._taskItem(t)).join('')
        : `<li class="empty"><span class="em">ひとつめの種を</span>${this.appMode ? '輸入任務並按 Enter，就種下一株花苞。<br>完成時它會綻放，回到小島就看得到。' : '輸入任務並按 Enter，花圃就會長出一株花苞。<br>完成時它會綻放，もち和ふじ也會跑來慶祝。'}
          <div class="empty-acts"><button class="btn-ghost" data-act="quickAdd">＋ 快速加一個</button>${s.selectedDate >= s.today ? `<button class="btn-primary" data-act="coachDay" title="${COACH_TIP}">${COACH_LABEL}</button>` : ''}</div></li>`
    })
    for (const [box, id, v] of subDrafts) {
      const input = $(`${box} .sub-add[data-id="${CSS.escape(id)}"] input`)
      if (input) input.value = v
    }
    this._restoreListFocus(fk)
  },

  // 任務列表整個重畫：先記下焦點在哪一件的哪一顆按鈕，畫完還回去（鍵盤一路勾下去不會掉回頁首）。
  // 那一件不見了（刪掉、移走）就落在同一個位置的那一件
  _listFocus() {
    const a = document.activeElement
    const li = a?.closest?.('#taskList .item, #overdueBox .item')
    if (!li) return null
    // 剛改完名（焦點還在輸入框裡）：還給那一件的編輯鈕
    // 子任務的改名框在子任務名稱裡：還給那個名稱
    const sub = a.closest('[data-sid]')
    const act = a.dataset.act || (sub ? sub.dataset.act : a.classList.contains('inline-input') ? 'edit' : null)
    return { id: li.dataset.id, act, sid: sub?.dataset.sid, i: $$('#taskList .item, #overdueBox .item').indexOf(li) }
  },
  _restoreListFocus(k) {
    // 焦點已經在別的地方（不是被重畫弄丟的）就不搶
    if (!k || (document.activeElement && document.activeElement !== document.body)) return
    const items = $$('#taskList .item, #overdueBox .item')
    const li = items.find((x) => x.dataset.id === k.id)
    const at = li || items[Math.min(k.i, items.length - 1)]
    const sid = k.sid ? `[data-sid="${CSS.escape(k.sid)}"]` : ''
    // 子任務刪掉了：落在同一件任務的新增子任務框
    const el = (li && k.act && ($(`[data-act="${k.act}"]${sid}:not(:disabled)`, li) || (sid && $('.sub-add input', li)))) || (at && $('.check', at)) || $('#taskTitle')
    el.focus({ preventScroll: true })
  },

  // 卡關小卡：一次一件。挪了好幾次或逾期很久的任務，ふじ問要不要拆小（每天開口一次）
  _renderStuck(isToday) {
    const s = this.store
    const box = $('#stuckBox')
    const st = isToday && s.nudge('stuckNudge') ? s.stuckTasks(new Set(readLocal(STUCK_OFF_KEY, [])))[0] : null
    if (!st) return this._renderIdle(box, isToday)
    const t = st.task
    const why = st.moved >= 2 ? `已經往後挪了 ${st.moved} 次` : `已經逾期 ${st.late} 天`
    box.innerHTML = `<div class="stuck-card"><span class="stamp-k coach-k">藤</span><div>
      <b>「${esc(t.title)}」好像卡住了</b><p>${why}。拆成小一點的步驟，會比較好開始。</p>
      <div class="stuck-btns">
        <button class="btn-primary" data-act="split" data-id="${esc(t.id)}">拆成三小步</button>
        <button class="btn-ghost" data-act="small" data-id="${esc(t.id)}" title="先倒數 5 分鐘，到點時再決定要不要繼續">只做 5 分鐘</button>
        <button class="btn-ghost" data-act="later" data-id="${esc(t.id)}">排進明天</button>
        <button class="btn-ghost" data-act="drop" data-id="${esc(t.id)}">先放下</button>
        <button class="cm-link" data-act="mute" data-id="${esc(t.id)}">不再提醒這件</button>
      </div></div></div>`
    if (readLocal(STUCK_SAID_KEY, '') !== s.today && this._tasksShown() && this.hooks.stuck?.('nudge', t, st.moved || st.late)) writeLocal(STUCK_SAID_KEY, s.today)
  },

  // 任務頁現在看得到嗎（面板沒收起來、分頁是任務）：卡關的那一句旁白只在看得到那張小卡時說
  _tasksShown() {
    return this.tab === 'tasks' && !$('#panel').classList.contains('collapsed') && !document.hidden
  },
  // 好久沒碰的長期任務：長期任務不會逾期、也不在每天的任務裡，放久了沒人提醒。沒有卡關的任務時，同一個位置提一件（最久的那件），
  // ふじ每天開口一次。跟卡關提醒共用設定裡的開關
  idleTasks() {
    const s = this.store
    if (!s.nudge('stuckNudge')) return []
    const off = readLocal(IDLE_OFF_KEY, {})
    return s.idleLongTasks(IDLE_DAYS, new Set(Object.keys(off).filter((id) => off[id] > s.today)))
  },
  // 過一週再提醒這件（到期的順手清掉）
  snoozeIdle(id) {
    const today = this.store.today
    const off = Object.fromEntries(Object.entries(readLocal(IDLE_OFF_KEY, {})).filter(([, d]) => d > today).slice(-200))
    off[id] = addDays(today, 7)
    writeLocal(IDLE_OFF_KEY, off)
  },
  _renderIdle(box, isToday) {
    const it = isToday ? this.idleTasks()[0] : null
    if (!it) {
      box.innerHTML = ''
      return
    }
    const t = it.task
    const k = esc(t.id)
    box.innerHTML = `<div class="stuck-card idle-card"><span class="stamp-k coach-k">藤</span><div>
      <b>「${esc(t.title)}」${it.idle} 天沒碰了</b><p>在「${esc(it.project.name)}」裡。長期的事不會逾期，放久了卻容易忘：今天碰一下就好。</p>
      <div class="stuck-btns">
        <button class="btn-primary" data-act="idle-open" data-id="${k}">打開它</button>
        <button class="btn-ghost" data-act="small" data-id="${k}" title="先倒數 5 分鐘，到點時再決定要不要繼續">碰 5 分鐘就好</button>
        <button class="btn-ghost" data-act="idle-focus" data-id="${k}">專注一輪</button>
        <button class="cm-link" data-act="idle-snooze" data-id="${k}">過一週再提醒</button>
      </div></div></div>`
    if (readLocal(IDLE_SAID_KEY, '') !== this.store.today && this._tasksShown() && this.hooks.idle?.(t, it.idle)) writeLocal(IDLE_SAID_KEY, this.store.today)
  },

}
