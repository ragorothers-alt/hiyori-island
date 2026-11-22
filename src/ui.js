import { FocusTimer } from './ui/focus.js'
import { BriefView } from './ui/brief.js'
import { CaptureView } from './ui/capture.js'
import { calmMotion } from './ui/motion.js'
import { lifeKindOf } from './data/life.js'
import { coatOfDay } from './catWalk.js'
import { fmtMoney, chargesBetween, subAtCharge } from './subs.js'
import { TAGS, tagOf, EVENT_COLORS, PROJECT_COLORS, WEEK_JP, WEEK_ZH, MAX_STARS, XP, CHARM } from './theme.js'
import { dateStr, addDays, parseDate, toMin, minToHHMM, repeatLabel, SEASON_ZH, floating, shiftEnd } from './store.js'
import { blockedHelp, notifySupported, notifyPermission, requestNotify } from './reminders.js'
import { native, nativeMottos } from './native.js'
import { needsHomeScreen, pushSupported } from './push.js'
import { parseQuick, parseSpend, timeRange } from './parse.js'
import { SHOP_ITEMS } from './data/shop.js'
import { $, $$, esc, ICON, setHTML, setOn, pickOne, scrollMode } from './ui/dom.js'
import { firstPickIn } from './planner.js'
import { lookHour, nightAt, realHour, systemDark, daypart, GREETING } from './daylight.js'
import { ScheduleView } from './ui/schedule.js'
import { HabitsView } from './ui/habits.js'
import { LifeView } from './ui/life.js'
import { SearchView } from './ui/search.js'
import { isExternal } from './calendars.js'
import { DatesView } from './ui/dates.js'
import { SubsView } from './ui/subs.js'
import { MottosView, MottoBar } from './ui/mottos.js'
import { CalendarRow } from './ui/calendars.js'
import { AiView } from './ui/ai.js'
import { AgentCard, AgentView, AgentDock } from './ui/agent.js'
import { TodayView } from './ui/today.js'
import { doneOn, todayProgress } from './habits.js'
import { layersMethods } from './ui/layers.js'
import { taskListMethods } from './ui/taskList.js'
import { projectListMethods } from './ui/projectList.js'
import { settingsMethods } from './ui/settingsPage.js'
import { reviewMethods } from './ui/review.js'
import { recordsMethods } from './ui/recordsPage.js'
import { toastMethods } from './ui/toasts.js'
import { TAB_ORDER, PAGE_OF, PAGE_NAME, lazy, SIDE_PHONE, sheetLayout, NEWS_KEY, STUCK_OFF_KEY, SWIPE_TIP_KEY, BRIEF_KEY, SEEN_KEY, newsVersion, readLocal, writeLocal, canSwap, asTimedTask, quickChips, swapBtn, touchUI, LAYOUT_KEY, savedAppMode, SIDE_KEY, BLANK, ISLAND_ICON, FEEDBACK_URL, levelTitle, daysBetween } from './ui/shared.js'
export { SIDE_PHONE, sheetLayout, savedAppMode, FEEDBACK_URL, levelTitle }

export class UI {
  constructor(store, hooks) {
    this.store = store
    this.hooks = hooks
    this.tab = 'tasks'
    // 先標上 App 模式：底下建番茄鐘時若正在專注，兩人不會先把畫面帶進小木屋
    document.body.classList.toggle('app-mode', savedAppMode())
    this.priority = 2
    this.tag = 'work'
    this.eventColor = 0
    this.projectColor = 0
    this.hlKey = null
    // 任務列表上自己展開／收起過子任務的那幾件（id → true／false）；沒碰過的：有還沒做完的子任務就展開
    this.subsView = new Map()
    // 新增任務時選的專案（跟分類、優先度一樣會留著，連續加同一個專案的任務比較快）
    this.taskProject = null
    this._initStatic()
    this._bindTasks()
    this._bindSchedule()
    this._bindProjects()
    this._bindRecords()
    this._bindChrome()
    this.focus = new FocusTimer(this, hooks)
    // 打開時的今日摘要（貓咪）
    this._afterBrief = []
    // 上次有人在看是什麼時候（這次打開以前）：之後每分鐘會記成現在，所以先抄下來
    this._left = { since: readLocal(SEEN_KEY, 0), at: Date.now() }
    this.brief = new BriefView($('#brief'), $('#briefCat'), {
      data: () => this._briefData(),
      coat: () => coatOfDay(store.today),
      go: (to) => {
        if (to[0] !== 'tab') return this.openProject(to[1], undefined, to[2] || null)
        // 說的是今天（或那個日子）的事：先把日期選過去，不然會停在之前在看的那一天
        if (to[1] !== 'records') store.selectDate(to[2] || store.today)
        this.setTab(to[1])
      },
      focus: (id) => id && this.focus.ask(id),
      onPoke: () => hooks.catPoke?.(),
      // 排在摘要後面的事（一週回顧、開場的話）：只是關掉就接著做；點了某一項、按了專注就不插進來擋他
      onClose: (acted) => {
        const queue = this._afterBrief.splice(0)
        if (!acted) queue.forEach((fn) => fn())
      },
    })
    // 快速記錄：加在今天（字裡寫了日期就照寫的），不跟著上面選的日期走
    // 找找看：任務（哪一天的都找）、日程、專案、生活記錄
    this.search = new SearchView($('#search'), {
      state: () => store.state,
      today: () => store.today,
      external: () => store.external || [],
      isExternal: (e) => isExternal(e),
      projectName: (id) => store.state.projects.find((p) => p.id === id)?.name || '',
      toggleTask: (id) => store.toggleTask(id),
      open: (r) => this._openFound(r),
    })
    // 開著時資料變了（別台同步過來、另一個分頁改了）：照現在的資料重找
    store.on('change', () => this.search.refresh())
    this.capture = new CaptureView($('#capture'), {
      preview: (text, asTask = false) => {
        const p = parseQuick(text, { today: store.today, projects: store.activeProjects(), span: true })
        if (!p.title) return []
        const task = asTask && canSwap(p)
        const chips = quickChips(p, store.today, task)
        if (!p.date) chips.splice(p.kind === 'event' || task ? 1 : 0, 0, '今天')
        if (p.kind === 'task' || task) chips.push(tagOf(p.tag || this.tag).label)
        return chips
      },
      // 這一行字可以在日程和有時段的任務之間換嗎
      canSwap: (text) => canSwap(parseQuick(text, { today: store.today, projects: store.activeProjects(), span: true })),
      // 剛過午夜、每秒的 tick 還沒跑到：先換日再記，不然會記到昨天
      add: (text, asTask = false) => {
        store.tick()
        return this.quickAdd(text, { base: store.today, asTask })
      },
      logPreview: (kind, text) => {
        const { amount } = this._logParts(kind, text)
        return amount ? [`${amount} 元`] : []
      },
      log: (kind, text) => {
        store.tick()
        return this.quickLog(kind, text)
      },
      tags: () => TAGS,
      tag: () => this.tag,
      setTag: (id) => {
        this.tag = id
        this._syncPickers()
      },
    })
    $('#captureBtn').onclick = () => (this.capture.isOpen ? this.capture.close() : this.openCapture())
    // 時段安排、習慣、生活記錄、日曆：各自是一個模組，透過 viewHooks 和外面溝通
    const viewHooks = {
      toast: (o) => this.toast(o),
      dropToasts: (tag) => this.dropToasts(tag),
      selectDate: (date) => this.store.selectDate(date),
      setTab: (tab) => this.setTab(tab),
      openEdit: (type, id) => this.schedule.openEdit(type, id),
      // 任務的編輯面板：到任務頁打開那一件的子任務、分成幾段；排進時段之後說排在哪裡
      openSubs: (id) => this.openSubs(id),
      split: (id) => this._split(id),
      scheduled: (id, prev) => this.scheduled(id, prev),
      coachDay: (date) => this.coachDay(date),
      // 正在計時（專注、休息）的那一件：撤銷排程時不搬走它
      timing: () => (this.focus && this.focus.mode !== 'idle' ? this.focus.taskId || null : null),
      openReview: (date) => this.openReview(date),
      openCalendar: (date) => this._use(this._calendar, (c) => c.open(date)),
      closeCalendar: () => this._calendar.view?.close(),
      focusEvent: (id) => hooks.focusEvent(id),
      hoverEvent: (id) => hooks.hoverEvent(id),
      openWeekCard: (wk) => this.openWeekCard(wk),
      openProject: (id, sec) => this.openProject(id, sec),
      // 日曆那天的詳情裡按了自己記的重要日子：到日程頁打開那一筆的編輯
      editDate: (id) => {
        this.setTab('schedule')
        this.dates.edit(id)
      },
      // 日曆上點了扣款的訂閱：到紀錄頁、打開那一張
      openSub: (id) => {
        this.setTab('records')
        this.subs.reveal(id)
      },
    }
    this.schedule = new ScheduleView(store, viewHooks)
    this.habits = new HabitsView($('#habitsRoot'), store, viewHooks)
    this.life = new LifeView($('#lifeRoot'), store, viewHooks)
    this.subs = new SubsView($('#subsRoot'), store, viewHooks)
    this.mottoBar = new MottoBar($('#mottoBar'), store)
    this.mottos = new MottosView($('#mottoRoot'), store, {
      ...viewHooks,
      mottoBar: () => this.mottoBar.render(),
      // 警語的間隔、貓咪、面板上方那一條改了：設定頁的總開關和摘要跟著
      changed: () => this.renderSettings(),
      mottoReach: () => this.mottoReach(),
      // 上一則警語的推播幾點送到這台（網頁交給伺服器推的時候）
      mottoLast: () => this.hooks.mottoPush?.last() ?? null,
      enableNotify: () => this.enableNotify(),
    })
    // 自主的ふじ（agentRunner.js）：今日總覽上的卡片、教練分頁的對話
    this.agent = hooks.agent || null
    if (this.agent) {
      const agentHooks = {
        toast: (o) => this.toast(o),
        // App 關著時的通知從哪一台送（main.js 的 fujiNotes）
        fujiNotes: hooks.fujiNotes,
        startFocus: (id) => {
          this.fuji?.close()
          this.focus.ask(id)
        },
        openChat: () => {
          this.fuji?.close()
          this.openAgent()
        },
        // 還沒接上 Claude 也能用的：教練的「計畫」（照主攻的事排一週）、日程頁的最佳化時程（今天的任務排進空檔）
        openPlan: () => {
          this.fuji?.close()
          this.setTab('coach')
          this._use(this._coach, (c) => c.show('plan'))
        },
        openOptimize: () => {
          this.fuji?.close()
          this.store.selectDate(this.store.today)
          this.setTab('schedule')
          // 有可以排的任務就直接出預覽（按鈕停用時就只是到日程頁）
          requestAnimationFrame(() => {
            const b = $('#planBar [data-plan="optimize"]')
            if (b && !b.disabled) b.click()
          })
        },
        // 還沒接上 Claude：到設定裡填通行碼
        openSetup: () => {
          this.fuji?.close()
          this.setTab('settings')
          requestAnimationFrame(() => {
            $('#aiRow').scrollIntoView({ block: 'center' })
            this.aiView._edit(true)
          })
        },
      }
      this.agentCard = new AgentCard(this.agent, store, agentHooks)
      this.agentView = new AgentView(this.agent, store, agentHooks)
      viewHooks.agentView = () => this.agentView
      // 隨叫隨到的ふじ：Dock 的「藤」、J 或 Ctrl＋J。看得到現在在哪一頁
      this.fuji = new AgentDock($('#fujiSheet'), this.agent, store, {
        ...agentHooks,
        here: () => this.here(),
        // 關掉時焦點回到叫出她的那顆按鈕（鍵盤操作的人不會掉到頁面最外面）
        closed: () => {
          const back = this._fujiFrom
          this._fujiFrom = null
          if (back?.isConnected && !document.activeElement?.closest?.('.modal:not([hidden])')) back.focus({ preventScroll: true })
        },
      })
      $('#fujiBtn').onclick = () => this.toggleFuji()
      $('#fujiBtn').hidden = !this.agent.ready()
      this._lookMode = store.state.settings.agentMode
    }
    this._calendar = lazy(() => import('./ui/calendar.js').then(({ CalendarView }) => new CalendarView($('#calendar'), store, viewHooks)))
    this._coach = lazy(() => import('./ui/coach.js').then(({ CoachView }) => new CoachView($('#coachRoot'), store, viewHooks)), $('#coachRoot'))
    this.dates = new DatesView($('#datesBox'), store, viewHooks)
    this.dates.render()
    this.today = new TodayView($('#todayRoot'), store, {
      ...viewHooks,
      // 「種下一件」：留在總覽，直接叫出快速記錄
      addTask: () => this.openCapture('todo'),
      // 「看週報」：教練分頁的週報那一頁
      openReport: () => this.openReport(),
      startFocus: (id) => this.focus.ask(id),
      focusTaskId: () => (this.focus.mode === 'focus' ? this.focus.taskId : null),
      idleTasks: () => this.idleTasks(),
      snoozeIdle: (id) => this.snoozeIdle(id),
      openTask: (pid, tid) => this.openProject(pid, undefined, tid),
      agentCard: () => this.agentCard || null,
      // 晚上還沒回顧：今日反思移到最上面；「之後再說」放回原位
      reviewEve: () => this.reviewEve(),
      reviewLater: () => this.reviewLater(),
      weekSeen: () => this.weekSeen(),
      // 在總覽寫好今天的回顧：跟回顧的視窗一樣，接著問明天先做哪一件
      askFirst: () => this.askFirst(),
      // 新的一週：上週的回顧卡（看過、收起來就不放）
      weekDue: () => this.store.weekCardDue(),
      openSettings: () => this.openSettings(),
      openSearch: () => this.openSearch(),
    })
    // 專案詳情：進度日誌、筆記、里程碑細項，蓋在專案分頁的列表上
    this._project = lazy(() =>
      import('./ui/project.js').then(
        ({ ProjectView }) =>
          new ProjectView($('#projectDetail'), store, {
            toast: (o) => this.toast(o),
            close: () => this.closeProject(),
            viewOnIsland: (id) => this._onIsland(() => hooks.focusProject(id)),
            startFocus: (id) => this.focus.ask(id),
            startFocusProject: (id) => this.focus.ask(null, id),
            openEdit: (type, id) => this.schedule.openEdit(type, id),
            appMode: () => !!this.appMode,
          }),
      ),
    )
    // 設定裡的「ふじ的 AI」（Claude 通行碼、模型）
    this.aiView = new AiView($('#aiRow'), {
      toast: (o) => this.toast(o),
      // 通行碼、模型改了：ふじ的卡片跟著出現或收起來，之前連不上的也再試
      changed: () => {
        this._aiChanged()
        // 開著線上同步的話，新的通行碼、剛選的模型跟著送到別台
        this.hooks.aiSet?.()
      },
    })
    // 設定裡的「匯入行事曆」
    if (hooks.calendars) this.icsView = new CalendarRow($('#icsRow'), store, hooks.calendars, { toast: (o) => this.toast(o) })
    // 另一個分頁（或同一個網站的另一個視窗）設了、換了通行碼或模型：這邊的設定列和ふじ的卡片跟著變
    addEventListener('storage', (e) => {
      if (e.key === null || e.key === 'hiyori-ai-pass' || e.key === 'hiyori-ai-model') this.aiShared()
    })
    this.applyFontScale()
    this.applyGlass()
    this.renderNewsDot()
    this.setAppMode(savedAppMode(), { save: false })
    // 開發與截圖用：?tab=habits、?calendar
    const q = new URLSearchParams(location.search)
    if (TAB_ORDER.includes(q.get('tab')) || PAGE_OF[q.get('tab')]) this.setTab(q.get('tab'))
    if (q.has('calendar')) this._use(this._calendar, (c) => c.open())
  }

  // 通行碼、模型變了：ふじ的卡片、教練分頁跟著出現或收起來，之前連不上的也再試
  _aiChanged() {
    this.agent?.reset()
    this.agentCard?.render()
    this.agentView?.render()
    this.fuji?.render()
    if (this.agent) $('#fujiBtn').hidden = !this.agent.ready()
    this._coach.view?.aiChanged?.()
  }

  // ── 隨叫隨到的ふじ（ui/agent.js 的 AgentDock）──
  // 打開（text：先填進輸入框的一句）；別的對話框開著時不疊上去
  openFuji(text = '') {
    if (!this.fuji) return false
    const top = this._topLayer()
    if (top && top.id !== 'fujiSheet') return false
    if (!this.fuji.isOpen) this._fujiFrom = document.activeElement
    this.fuji.open(text)
    return true
  }
  toggleFuji() {
    if (this.fuji?.isOpen) this.fuji.close()
    else this.openFuji()
  }
  // ふじ要知道使用者正在看哪裡：哪一頁、那一頁選的日子、打開著的專案（和裡面的任務）、正在編輯的日程或任務
  here() {
    // 開機時（日曆、專案詳情還沒建好）也會問一次
    const cal = this._calendar?.view?.isOpen
    const page = cal ? 'calendar' : this.tab
    // 看著哪一天：任務、日程、日曆是選的那天；其他頁（今日總覽、習慣…）一律是今天
    const out = { page, date: ['tasks', 'schedule', 'calendar'].includes(page) ? this.store.selectedDate : this.store.today }
    const pv = this._project?.view
    if (this.tab === 'projects' && pv?.id) {
      out.project = pv.id
      if (pv.taskId) out.task = pv.taskId
    }
    const ed = this.schedule?.editing
    if (ed?.id && $('#editSheet') && !$('#editSheet').hidden) out[ed.type === 'event' ? 'event' : 'task'] = ed.id
    return out
  }
  // ふじ說完之後替使用者打開的畫面（agentRunner 的 hooks.go）
  agentGo(g) {
    if (!g) return
    this.fuji?.close()
    if (g.do === 'focus') {
      if (this.store.state.tasks.some((t) => t.id === g.id && !t.done)) this.focus.startWith(g.id)
      return
    }
    if (g.page === 'calendar') return this._use(this._calendar, (c) => c.open())
    if (g.page === 'settings') return this.openSettings()
    if (g.page) return this.setTab(g.page)
    const s = this.store.state
    if (g.kind === 'project' || g.kind === 'milestone') return this.openProject(g.kind === 'project' ? g.id : g.pid)
    if (g.kind === 'task') {
      const t = s.tasks.find((x) => x.id === g.id)
      if (!t) return
      if (t.project && s.projects.some((p) => p.id === t.project)) return this.openProject(t.project, undefined, t.id)
      this.store.selectDate(t.date)
      return this.setTab('tasks')
    }
    if (g.kind === 'event') {
      const e = s.events.find((x) => x.id === g.id)
      if (!e) return
      this.store.selectDate(e.date)
      this.setTab('schedule')
    }
  }
  // 設定被ふじ改了（或撤銷了）：外觀、字的大小、音效、計時、背景聲跟著換
  syncSettings() {
    const st = this.store.state.settings
    // 外觀、音效：一樣的話這兩個什麼都不會變
    this.hooks.setTheme?.(st.theme)
    this.renderTheme()
    this.hooks.setSound?.(st.sound !== false)
    // 自己整理的方式換了：之前出的錯、還在路上的整理不算了（跟在「ふじ」那一頁換的時候一樣）
    if ((this._lookMode ?? st.agentMode) !== st.agentMode) this.agent?.reset()
    this._lookMode = st.agentMode
    this.applyFontScale()
    if (this.focus) {
      if (this.focus.mode === 'idle') this.focus._loadLengths()
      this.focus._renderSet?.()
      this.focus.render()
      this.focus._noiseSync()
    }
    this.renderChrome()
    this.renderSettings()
  }
  // 別台設的通行碼、選的模型同步過來了（main.js），或另一個分頁改了
  aiShared() {
    this.aiView.result = ''
    this.aiView.refresh()
    this._aiChanged()
  }

  // 設定頁（外觀、通知與提醒、專注、警語、ふじ、資料與同步）：小島模式收著面板的話先打開
  // 回到上次捲到的地方（跟其他分頁一樣）。按的那一顆跟著上一頁藏起來了（紀錄頁、總覽上的、Dock「⋯」裡的）：
  // 焦點放到設定頁上，鍵盤接著從這裡往下走（不會掉回頁首）
  openSettings() {
    this.setTab('settings')
    const a = document.activeElement
    if (!a || a === document.body || !a.getClientRects().length) {
      const page = $('#page-settings')
      page.tabIndex = -1
      page.focus({ preventScroll: true })
    }
  }

  // 教練分頁的「ふじ」那一頁（對話和她自己整理的紀錄）
  openAgent() {
    this.setTab('coach')
    this._use(this._coach, (c) => c.show('agent'))
  }

  // 載好了就直接做；還沒就先載再做（離線又沒快取時說一聲）。
  // 還在下載時只記最後一次想做的事：慢網路連點兩下日曆，載好後不會開了又關；
  // 等的時候切到別的分頁，就不再做（載好後不會突然跳出專案詳情搶畫面）
  _use(lz, fn) {
    if (lz.view) return fn(lz.view)
    const waiting = !!lz.want
    lz.want = { fn, tab: this.tab }
    if (waiting) return
    // 上次沒下載到、留著「再試一次」的那一格：換回正在準備的底
    if (lz.failed) {
      lz.failed = false
      lz.root.innerHTML = lz.skel
    }
    // 下載超過一下下還沒好（網路慢、剛打開就點）：在提示卡的位置說一聲正在打開，不然按了像沒反應
    let shown = false
    const slow = setTimeout(() => {
      shown = true
      this._busy(1)
    }, 350)
    const done = () => {
      clearTimeout(slow)
      if (shown) this._busy(-1)
    }
    lz.get().then((v) => {
      done()
      const want = lz.want
      lz.want = null
      if (want && want.tab === this.tab) want.fn(v)
    }, (err) => {
      done()
      const want = lz.want
      lz.want = null
      console.warn('[hiyori] 畫面載入失敗', err)
      // 是部署了新版（main.js 會重新整理）就不叫人連網路
      if (err?.updating) return
      // 頁面裡先放了閃著的底（教練）：換成沒下載到、按一下再試，不要一直看起來像還在下載
      if (lz.root) return this._lzFailed(lz, want?.fn || ((v) => v.render?.()))
      this._loadFailToast('！', '這個畫面還沒下載', err)
    })
  }
  _lzFailed(lz, fn) {
    lz.failed = true
    // 連著網路還是沒下載到：多半是換了新版、舊的檔案已經不在了，再試一次也一樣，給「重新載入」
    const online = navigator.onLine !== false
    lz.root.innerHTML = `<div class="lz-fail" role="alert"><b>這一頁還沒下載到</b><small>${online ? '可能剛換了新版，重新載入一下就好' : '連上網路後再試一次'}</small><div class="lz-acts">${online ? '<button type="button" class="btn-ghost" data-lz="reload">重新載入</button>' : ''}<button type="button" class="btn-ghost" data-lz="retry">再試一次</button></div></div>`
    lz.root.querySelector('[data-lz="retry"]').onclick = () => this._use(lz, fn)
    const re = lz.root.querySelector('[data-lz="reload"]')
    if (re) re.onclick = () => this._reloadApp()
  }
  // 分開下載的那幾塊（畫面、更新紀錄）載入失敗時怎麼說。err.updating：部署了新版、pwa.js 已經在換（不另外說）；
  // 連著網路還是失敗：多半是換了新版、舊的檔案已經不在了，給一顆「重新載入」；真的離線才叫人連網路
  _loadFailToast(icon, title, err, offSub = '連上網路再試一次') {
    if (err?.updating) return
    if (navigator.onLine === false) return this.toast({ icon, title, sub: offSub })
    this.toast({
      icon, title, ms: 12000,
      sub: this.hasDraft() ? '可能剛換了新版。手上還有沒打完的字，收好再按「重新載入」' : '可能剛換了新版，重新載入一下就好',
      // 有字的話上面已經說了「收好再按」：按了就載入（存不進去時照樣不載入）
      action: { label: '重新載入', run: () => this._reloadApp({ force: true }) },
    })
  }
  // 重新載入之前先存：存不進去（空間滿了）就先不載入，說一聲（載入了這次的變更就不見了）。
  // 手上還有沒打完的字（快速記錄、編輯到一半的表單）：重新載入會不見，先問一聲（force：問過了、還是要載入）
  _reloadApp({ force = false } = {}) {
    if (this.store.flushSave() === false) {
      return this.toast({ icon: '存', title: '先別重新載入', sub: '這次的變更沒能存進去（空間可能滿了），先到「紀錄」匯出備份', ms: 9000 })
    }
    if (!force && this.hasDraft()) {
      return this.toast({
        icon: '新', title: '手上還有沒打完的字', sub: '重新載入的話，打到一半的字會不見：先記下來、送出，或複製起來', ms: 12000,
        actions: [{ label: '還是重新載入', soft: true, run: () => this._reloadApp({ force: true }) }],
      })
    }
    location.reload()
  }
  // 延後載入的畫面正在下載：一張「正在打開…」的提示卡（好幾個一起下載時共用一張，都好了才收）
  _busy(d) {
    this._busyN = Math.max(0, (this._busyN || 0) + d)
    if (this._busyN && !this._busyEl) {
      const el = (this._busyEl = document.createElement('div'))
      el.className = 'toast busy'
      el.setAttribute('role', 'status')
      el.innerHTML = '<div class="t-icon">開</div><div><b>正在打開…</b><small>第一次打開要下載一下</small></div>'
      $('#toasts').append(el)
    } else if (!this._busyN && this._busyEl) {
      const el = this._busyEl
      this._busyEl = null
      el.classList.add('out')
      setTimeout(() => el.remove(), 500)
    }
  }
  // 開場後閒下來時把月曆、教練、專案詳情先載好（一個一個來，不搶開場的資源）
  preloadViews() {
    // 更新紀錄（「這一版的新功能」）也先載好：離線時打得開
    return [this._calendar, this._coach, this._project]
      .reduce((p, lz) => p.then(() => lz.get()).catch(() => {}), Promise.resolve())
      .then(() => import('./data/changelog.js'))
      .catch(() => {})
  }

  // ── 靜態元件 ──
  _initStatic() {
    $('#taskTag').innerHTML = TAGS.map((t) => `<button type="button" data-tag="${t.id}" style="--c:${t.color}"><i></i>${t.label}</button>`).join('')
    $('#eventColor').innerHTML = EVENT_COLORS.map((c, i) => `<button type="button" data-i="${i}" style="--c:${c}" aria-label="顏色 ${i + 1}"></button>`).join('')
    $('#projectColor').innerHTML = PROJECT_COLORS.map((c, i) => `<button type="button" data-i="${i}" style="--c:${c}" aria-label="顏色 ${i + 1}"></button>`).join('')
    this._syncPickers()
  }

  _syncPickers() {
    pickOne($$('#taskPriority button'), (b) => +b.dataset.v === this.priority)
    pickOne($$('#taskTag button'), (b) => b.dataset.tag === this.tag)
    pickOne($$('#eventColor button'), (b) => +b.dataset.i === this.eventColor)
    pickOne($$('#projectColor button'), (b) => +b.dataset.i === this.projectColor)
  }

  _bindChrome() {
    // 分頁和頁面互相標好（讀螢幕軟體才知道選了哪一頁、對到哪一塊）
    for (const b of $$('.tab')) {
      b.id = `tab-${b.dataset.tab}`
      b.setAttribute('aria-controls', `page-${b.dataset.tab}`)
      b.addEventListener('click', () => {
        // 再點一次目前的分頁：回到最上面
        if (b.dataset.tab === this.tab && !$('#panel').classList.contains('collapsed')) $('.panel-body').scrollTo({ top: 0, behavior: scrollMode() })
        this.setTab(b.dataset.tab)
      })
    }
    for (const p of $$('.tab-page')) {
      p.id = `page-${p.dataset.page}`
      // 設定頁不在分頁列上：自己有名字的一區
      if (PAGE_NAME[p.dataset.page]) {
        p.setAttribute('role', 'region')
        p.setAttribute('aria-label', PAGE_NAME[p.dataset.page][0])
        continue
      }
      p.setAttribute('role', 'tabpanel')
      p.setAttribute('aria-labelledby', `tab-${p.dataset.page}`)
    }
    this._markTabs(this.tab)
    // 焦點在分頁上時，方向鍵是換分頁（橫的分頁列用左右、側欄用上下），不是換日期
    $('.tabs').addEventListener('keydown', (e) => {
      if (!e.target.closest('.tab')) return
      const n = TAB_ORDER.length
      const i = TAB_ORDER.indexOf(PAGE_OF[this.tab] || this.tab)
      const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key]
      const to = step ? TAB_ORDER[(i + step + n) % n] : e.key === 'Home' ? TAB_ORDER[0] : e.key === 'End' ? TAB_ORDER[n - 1] : null
      if (!to) return
      e.preventDefault()
      e.stopPropagation()
      this.setTab(to)
      $(`.tab[data-tab="${to}"]`).focus()
    })
    $('#prevDay').onclick = () => this.store.selectDate(addDays(this.store.selectedDate, -1))
    $('#nextDay').onclick = () => this.store.selectDate(addDays(this.store.selectedDate, 1))
    $('#todayBtn').onclick = () => this.store.selectDate(this.store.today)
    for (const id of ['#gearBtn', '#setBtn', '#openSetBtn']) $(id).onclick = () => this.openSettings()
    for (const id of ['#findBtn', '#findDockBtn']) $(id).onclick = () => this.openSearch()
    $('#viewBtn').onclick = () => {
      this.toggleFull(false)
      this.hooks.resetView()
    }
    $('#soundBtn').onclick = () => {
      const on = !this.store.state.settings.sound
      this.store.setSetting('sound', on)
      this.hooks.setSound(on)
      this.renderChrome()
      if (this.tab === 'settings') this.renderSettings()
      // 專注時的背景聲跟著音效一起開、關
      this.focus?._noiseSync()
    }
    $('#panelBtn').onclick = () => this.togglePanel()
    // 窄螢幕 Dock 上的「⋯」：商店、視角、日夜、音效收在裡面。按了其中一顆、點旁邊、按 Esc 就收起來
    const pop = $('#dockPop')
    const more = $('#dockMore')
    const popOpen = (on) => {
      pop.classList.toggle('open', on)
      more.setAttribute('aria-expanded', String(on))
    }
    more.onclick = () => popOpen(!pop.classList.contains('open'))
    // 按了裡面的一顆：收起來，焦點交給「⋯」（那一顆收起來就看不到了，不然焦點會掉到頁首）
    pop.addEventListener('click', (e) => {
      if (!e.target.closest('button')) return
      const had = pop.contains(document.activeElement)
      popOpen(false)
      if (had && more.getClientRects().length) more.focus({ preventScroll: true })
    })
    document.addEventListener('pointerdown', (e) => pop.classList.contains('open') && !e.target.closest('#dockPop, #dockMore') && popOpen(false))
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !pop.classList.contains('open')) return
      popOpen(false)
      more.focus()
    })
    // 轉向、拉寬視窗時版面會換（手機的底部面板 ↔ 桌面的側邊面板）：收起的面板要不要 inert 跟著重算
    addEventListener('resize', () => this._syncPanelInert())
    this._bindDockFit()
    $('#fullBtn').onclick = () => (this.appMode ? this.setAppMode(false) : this.toggleFull())
    $('#appBtn').onclick = () => this.setAppMode(true)
    $('#sideBtn').onclick = () => this.toggleSide()
    this.toggleSide(readLocal(SIDE_KEY, false) === true, { save: false })
    this.toggleFull(false)
    $('#themeBtn').onclick = () => this.toggleTheme()
    this.renderTheme()
    $('#calBtn').onclick = () => this._use(this._calendar, (c) => c.toggle())
    $('#dateMain').onclick = () => this._use(this._calendar, (c) => c.open())
    $('#dateMain').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this._use(this._calendar, (c) => c.open())
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
    $('#questList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]')
      if (b) this.store.claimQuest(b.dataset.q)
      if (e.target.closest('[data-weekly]')) this.store.claimWeekly()
    })
    $('#modalClose').onclick = () => this.closeModal()
    $('#levelModal').addEventListener('click', (e) => {
      if (e.target.id === 'levelModal') this.closeModal()
    })
    this._bindFold()
    this._bindSheet()
    this._bindTuck()
    this._shownDate = this.store.selectedDate
    this.store.on('dateChanged', (d) => this._slideDay(d))

    this._bindLayers()
    this._bindBack()
    addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      const typing = !!document.activeElement?.closest?.('input, textarea, select, [contenteditable]')
      if (e.key === 'Escape') return this._escape(typing)
      // Ctrl／⌘＋K 找找看：在別的欄位打字時也能用；開著時再按一次收起來
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        const top = this._topLayer()
        if (top && top.id !== 'search') return
        e.preventDefault()
        return this.search.isOpen ? this.search.close() : this.openSearch()
      }
      // Ctrl／⌘＋J 叫ふじ（跟 Notion AI 一樣）：在別的欄位打字時也能用；開著時再按一次收起來
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j' && this.fuji && this.agent?.ready()) {
        const top = this._topLayer()
        if (top && top.id !== 'fujiSheet') return
        e.preventDefault()
        return this.toggleFuji()
      }
      // 專注中按 N：腦中冒出別的事，先記下來（不離開專注；專注頁、計時設定的小視窗開著時也可以）
      if ((e.key === 'n' || e.key === 'N') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && this.focus.mode === 'focus' && ['focusFull', 'focusSet', undefined].includes(this._topLayer()?.id)) {
        e.preventDefault()
        return this.focus.parkFocus()
      }
      // 專注頁開著、專注中按 U：想分心了，先等一分鐘（跟按「想分心了？」一樣；那一顆不在的時候不動）
      if ((e.key === 'u' || e.key === 'U') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && this._topLayer()?.id === 'focusFull' && this.focus.urge(true)) {
        e.preventDefault()
        return
      }
      // 對話框、全螢幕計時或日曆蓋在上面時，快捷鍵先不作用：不然會動到底下看不到的面板
      if (typing || e.ctrlKey || e.metaKey || e.altKey || this._topLayer()) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        // 在任務頁：直接到那一行輸入框（可以選優先度、重複、專案）；別的分頁：叫出快速記錄，不用換頁
        // （setTab 會把收起來的面板展開：小島模式收著面板時輸入框拿不到焦點）
        if (this.tab === 'tasks') {
          this.setTab('tasks')
          $('#taskTitle').focus()
        } else this.openCapture()
      } else if ((e.key === 'j' || e.key === 'J') && this.fuji && this.agent?.ready()) {
        e.preventDefault()
        this.openFuji()
      } else if (e.key === 'e' || e.key === 'E') this.toggleFull()
      else if (e.key === 'd' || e.key === 'D') this.toggleTheme()
      // 回到全景是要看島，先離開全螢幕
      else if (e.key === 'v' || e.key === 'V') {
        this.toggleFull(false)
        this.hooks.resetView()
      } else if (e.key === 's' || e.key === 'S') this.toggleShop()
      else if (e.key === 'c' || e.key === 'C') this._use(this._calendar, (c) => c.toggle())
      else if (e.key === 'f' || e.key === 'F') this.focus.toggle()
      else if (e.key === 'ArrowLeft') $('#prevDay').click()
      else if (e.key === 'ArrowRight') $('#nextDay').click()
      else if (e.key === '/') {
        e.preventDefault()
        this.openSearch(undefined, { here: true })
      } else if (/^[1-7]$/.test(e.key)) this.setTab(TAB_ORDER[+e.key - 1])
    })
  }

  // ── 打開時的今日摘要：貓咪走進來說今天有什麼、該留意什麼（ui/brief.js，內容在 brief.js 整理）──
  // 有人在看：記下現在（每分鐘、離開分頁時）。分頁在背景時不記，除非是剛要離開（leaving）
  markSeen(leaving = false) {
    if (leaving || !document.hidden) writeLocal(SEEN_KEY, Date.now())
  }
  // 上一次有人在看是什麼時候（看得到的分頁每分鐘記一次、離開時也記；別的分頁記的也算）
  lastSeen() {
    return readLocal(SEEN_KEY, 0)
  }
  // 回到 App：抄下離開的時間（還沒被下一次 markSeen 蓋掉）
  returned() {
    this._left = { since: readLocal(SEEN_KEY, 0), at: Date.now() }
  }
  // 剛回到 App、剛打開（這 3 分鐘內）的話，離開了多久（毫秒）；一直開著在看、沒有離開過的紀錄是 0
  awayMs() {
    const c = this._left
    return c.since > 0 && Date.now() - c.at < 3 * 60000 ? Math.max(0, c.at - c.since) : 0
  }
  // 「你不在的時候」從什麼時候算起：剛打開、剛回來那幾分鐘內的摘要才算（一直開著在看、過了午夜的那次沒有離開過）；
  // 同一天再按「現在看」沿用那一次的
  _awaySince() {
    const today = this.store.today
    const c = this._left
    if (c.since > 0 && Date.now() - c.at < 3 * 60000) this._awayFor = { day: today, since: c.since }
    return this._awayFor?.day === today ? this._awayFor.since : 0
  }
  _briefData() {
    const s = this.store
    const today = s.today
    const since = this._awaySince()
    const yesterday = addDays(today, -1)
    const days = [-3, -2, -1, 0].map((n) => addDays(today, n))
    const on = s.nudge('stuckNudge')
    const stuck = on ? s.stuckTasks(new Set(readLocal(STUCK_OFF_KEY, [])))[0] : null
    const idle = this.idleTasks()[0]
    // 範例不算進摘要（只在最上面說一聲島上的是範例）
    const own = (x) => !s.isSample(x)
    return {
      now: new Date(),
      today,
      tasks: s.tasksOn(today).filter(own),
      overdue: s.overdue().filter(own).length,
      events: s.eventsOn(today).filter(own),
      allDay: s.allDayOn(today),
      habits: todayProgress(s.state.habits, today),
      dates: s.upcomingDates(6, 3).filter((x) => !s.sampleProject(x.pid || (x.project ? x.id : ''))),
      samples: s.sampleCount(),
      subs: s.subReminders().map((r) => ({ name: r.sub.name, days: r.days, trial: r.trial, price: fmtMoney(r.sub.price, r.sub.cur) })),
      stuck: stuck ? { title: stuck.task.title, moved: stuck.moved, late: stuck.late } : null,
      idle: idle ? { id: idle.task.id, title: idle.task.title, idle: idle.idle, pid: idle.project.id, projectName: idle.project.name } : null,
      streak: s.streak,
      away: since
        ? {
            since,
            events: days.flatMap((date) => s.eventsOn(date).filter(own).map((e) => ({ title: e.title, date, start: e.start, end: e.end }))),
            charges: s.state.subscriptions.flatMap((sub) => chargesBetween(sub, days[0], yesterday).map((date) => ({ name: sub.name, date, price: fmtMoney(subAtCharge(sub, date).price, subAtCharge(sub, date).cur) }))),
            habits: todayProgress(s.state.habits, yesterday),
          }
        : null,
    }
  }
  // 每天第一次打開（或開著過了一天）：貓咪自己出來說。回傳有沒有出來。
  // 正在專注、有別的視窗開著、正在打字、分頁在背景時不出來（也不算看過），之後再回來時才說
  maybeShowBrief() {
    const s = this.store
    if (!s.nudge('brief') || this.brief.open || document.hidden) return false
    // 開著過了午夜：先換到新的一天，說的才是新的一天（日期和內容是同一天）
    s.tick()
    if (readLocal(BRIEF_KEY, '') === s.today) return false
    if (this.focus.mode !== 'idle' || this._topLayer()) return false
    // 打到一半的字、用同步連結加入的流程：不打斷
    if (document.activeElement?.closest?.('input, textarea, select, [contenteditable]') || /[#&]sync=/.test(location.hash)) return false
    writeLocal(BRIEF_KEY, s.today)
    return this.brief.show()
  }
  // 摘要關掉之後才做（沒開著就現在做）：一週回顧、晚間回顧這些不要疊在摘要上面
  afterBrief(fn) {
    if (this.brief.open) this._afterBrief.push(fn)
    else fn()
  }

  // 選中的分頁：active 樣式、aria-selected，Tab 鍵只停在選中的那一個（其他用方向鍵）
  // page：真的開著的那一頁（設定頁算在紀錄底下：亮著的「紀錄」指到設定頁）
  _markTabs(tab, page = tab) {
    for (const b of $$('.tab')) {
      const on = b.dataset.tab === tab
      b.classList.toggle('active', on)
      b.setAttribute('aria-selected', String(on))
      b.setAttribute('aria-controls', `page-${on ? page : b.dataset.tab}`)
      b.tabIndex = on ? 0 : -1
    }
    this._moveTabInk()
  }

  // App 模式的分頁列：選到的那一格墊的灰色膠囊從上一格滑過去，滑的途中先往前伸長、再把後面收過來（像一滴水）。
  // instant：剛打開、換版面、視窗大小變了，直接放到位置上
  _moveTabInk(instant = false) {
    const bar = $('#panel .tabs')
    if (!bar) return
    if (!this.appMode) {
      bar.classList.remove('has-ink')
      this._inkAt = null
      return
    }
    let ink = bar.querySelector(':scope > .tab-ink')
    if (!ink) {
      ink = document.createElement('i')
      ink.className = 'tab-ink'
      ink.setAttribute('aria-hidden', 'true')
      bar.prepend(ink)
      // 版面變了（轉向、側欄收起、字變大）：跟著換位置，不用滑
      if (typeof ResizeObserver === 'function') new ResizeObserver(() => this._moveTabInk(true)).observe(bar)
    }
    const tab = bar.querySelector('.tab.active')
    if (!tab?.offsetWidth) return
    bar.classList.add('has-ink')
    const to = { x: tab.offsetLeft, y: tab.offsetTop, w: tab.offsetWidth, h: tab.offsetHeight }
    const from = this._inkAt
    this._inkAt = to
    const frame = (r) => ({ transform: `translate(${r.x}px, ${r.y}px)`, width: `${r.w}px`, height: `${r.h}px` })
    Object.assign(ink.style, frame(to), { borderRadius: getComputedStyle(tab).borderRadius })
    if (instant || !from || calmMotion() || (from.x === to.x && from.y === to.y && from.w === to.w)) return
    // 往前的那一邊先到 85%，後面那一邊才走 20%：中間拉成一條，再收回來
    const lerp = (a, b, k) => a + (b - a) * k
    const mid = (a0, a1, b0, b1, fwd) => {
      const lead = fwd ? [lerp(a0, b0, 0.2), lerp(a1, b1, 0.85)] : [lerp(a0, b0, 0.85), lerp(a1, b1, 0.2)]
      return [Math.min(...lead), Math.max(...lead)]
    }
    const [l, r] = mid(from.x, from.x + from.w, to.x, to.x + to.w, to.x >= from.x)
    const [t, b] = mid(from.y, from.y + from.h, to.y, to.y + to.h, to.y >= from.y)
    ink.animate([frame(from), { ...frame({ x: l, y: t, w: r - l, h: b - t }), offset: 0.42 }, frame(to)], { duration: 440, easing: 'cubic-bezier(.3, .7, .3, 1)' })
  }

  // 換日期（前一天、後一天、點日曆）：任務和日程從那一邊滑進來，看得出是往前還是往後
  _slideDay(date) {
    const prev = this._shownDate
    this._shownDate = date
    this._hideAdded()
    if (!prev || prev === date || !['tasks', 'schedule'].includes(this.tab)) return
    const body = $('.panel-body')
    body.style.setProperty('--enter-x', `${date > prev ? 22 : -22}px`)
    body.style.setProperty('--enter-y', '0px')
    clearTimeout(this._dayT)
    this._dayT = setTimeout(() => {
      body.style.removeProperty('--enter-x')
      body.style.removeProperty('--enter-y')
    }, 700)
  }

  setTab(tab) {
    this._hideAdded?.()
    // 進到專案分頁：照最近動過的重新排一次
    if (tab === 'projects' && this.tab !== 'projects') {
      this._projRank = null
      this._stale?.add('projects')
    }
    // 每個分頁各自記住捲到哪裡（共用同一個捲動區：不記的話，在總覽往下捲再換到任務，會停在任務頁的半中間）
    const body = $('.panel-body')
    const from = this.tab
    if (from !== tab) (this._tabScroll ||= {})[from] = body.scrollTop
    // 離開日程頁：排好時段的那張提示卡收起來（撤銷留在日程頁的排程列上），不會蓋住別頁上的東西
    if (from === 'schedule' && tab !== 'schedule') this.dropToasts('scheduled')
    this.tab = tab
    // 今日總覽自己有日期和標題：App 模式藏起上方的頁名和日期列（styles.css）
    document.body.dataset.tab = tab
    this._markTabs(PAGE_OF[tab] || tab, tab)
    $$('.tab-page').forEach((p) => p.classList.toggle('active', p.dataset.page === tab))
    const tb = $(`.tab[data-tab="${tab}"]`)
    $('#ahTitle').textContent = tb ? tb.querySelector('span').textContent : PAGE_NAME[tab][0]
    $('#ahKana').textContent = tb ? tb.querySelector('small').textContent : PAGE_NAME[tab][1]
    if ($('#panel').classList.contains('collapsed')) this.togglePanel(false)
    // 日程的時間軸要在看得到時量高度：切過去時一定重畫
    if (tab === 'schedule') this._stale?.add('schedule')
    this._renderPage(tab)
    if (tab === 'records') this.renderRecords()
    if (tab === 'settings') {
      this.renderSettings()
      this.renderRemind()
    }
    if (tab === 'habits') this.habits.render()
    if (tab === 'coach') this._use(this._coach, (c) => c.render())
    if (tab === 'today') this.today.render()
    if (from !== tab) {
      // 還原這一頁捲到的位置：這一下的捲動不算使用者往下捲，Dock 不讓開
      body.scrollTop = this._tabScroll?.[tab] || 0
      this._tuckLast = body.scrollTop
    }
    this.tuckDock(false)
    if (tab === 'tasks') this._swipeTip()
  }
  // 用手指的裝置第一次在任務頁看到任務：提一下左右滑（一台裝置只說一次）
  _swipeTip() {
    if (readLocal(SWIPE_TIP_KEY, false) || typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches) return
    if (!$$('#taskList .item, #overdueBox .item').length) return
    writeLocal(SWIPE_TIP_KEY, true)
    setTimeout(() => this.toast({ icon: '指', title: '任務可以左右滑', sub: '往右滑完成、往左滑明天再做（逾期的是移到今天）', ms: 6000 }), 700)
  }

  // 小島模式（電腦寬度）：Dock 放在左下的每日任務和右邊面板中間那一塊的中間，不壓到面板下面的任務（點勾勾不會點到 Dock）；
  // 放不下的話收成「⋯」（商店、視角、日夜、音效收進去，跟窄螢幕一樣）
  _bindDockFit() {
    let raf = 0
    const fit = () => {
      raf = 0
      const body = document.body
      const dock = $('.dock')
      if (!dock || this.appMode || innerWidth <= 860) {
        body.classList.remove('dock-tight')
        body.style.removeProperty('--dock-l')
        body.style.removeProperty('--dock-r')
        return
      }
      const panel = $('#panel')
      const quests = $('#quests')
      const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0'
      const r = panel && !panel.classList.contains('collapsed') && !panel.classList.contains('full') ? innerWidth - panel.offsetLeft : 0
      const l = shown(quests) ? quests.offsetLeft + quests.offsetWidth : 0
      body.style.setProperty('--dock-l', `${l}px`)
      body.style.setProperty('--dock-r', `${r}px`)
      // 先照完整的樣子量寬度，放不下才收
      const tight = body.classList.contains('dock-tight')
      if (tight) body.classList.remove('dock-tight')
      const need = dock.offsetWidth
      body.classList.toggle('dock-tight', need > innerWidth - l - r - 24)
    }
    const soon = () => (raf ||= requestAnimationFrame(fit))
    addEventListener('resize', soon)
    // 只是自己換了 dock-tight 的那幾次不算（不然會一直重量）
    const strip = (v) => (v || '').split(/\s+/).filter((c) => c && c !== 'dock-tight').sort().join(' ')
    const mo = new MutationObserver((list) => {
      if (list.some((m) => !(m.target === document.body && m.attributeName === 'class' && strip(m.oldValue) === strip(m.target.getAttribute('class'))))) soon()
    })
    mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-tab'], attributeOldValue: true })
    const panel = $('#panel')
    if (panel) mo.observe(panel, { attributes: true, attributeFilter: ['class'] })
    const quests = $('#quests')
    if (quests) mo.observe(quests, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] })
    soon()
  }

  togglePanel(force) {
    const panel = $('#panel')
    const collapsed = force === undefined ? !panel.classList.contains('collapsed') : force
    // App 模式的面板就是整個畫面，不收起來
    if (collapsed && this.appMode) return
    if (collapsed) this.toggleFull(false)
    panel.classList.toggle('collapsed', collapsed)
    document.body.classList.toggle('panel-collapsed', collapsed)
    this._syncPanelInert()
  }
  // 桌面收起時整個面板移到畫面外：設成 inert，Tab 鍵和讀屏軟體不會跑進看不見的按鈕。
  // 手機收起時分頁列還露在下面（面板內容已經藏起來），照常可以按。
  // 看 pointer-events：收到畫面外的版面才是 none（它不跑動畫，切換當下就是最後的值）
  _syncPanelInert() {
    const panel = $('#panel')
    const off = panel.classList.contains('collapsed') && getComputedStyle(panel).pointerEvents === 'none'
    if (off && panel.contains(document.activeElement)) $('#panelBtn')?.focus({ preventScroll: true })
    panel.inert = off
  }

  // 手機的 App 模式：往下捲時右下角的番茄鐘膠囊和兩人的對話框先讓開（不擋住列表右邊的按鈕），
  // 往上捲一點、回到最上面、換分頁就回來。程式自己捲的（換分頁還原位置）不算
  _bindTuck() {
    const body = $('.panel-body')
    const narrow = typeof matchMedia === 'function' ? matchMedia('(max-width: 860px)') : { matches: false }
    // 上一次的位置；程式自己捲（換分頁還原位置）時直接改成新位置，那一下就不算往下捲
    this._tuckLast = body.scrollTop
    let acc = 0
    body.addEventListener(
      'scroll',
      () => {
        const top = body.scrollTop
        const d = top - this._tuckLast
        this._tuckLast = top
        if (!this.appMode || !narrow.matches) return this.tuckDock(false)
        // 同一個方向累積一段才算（手指放上去的小抖動、慣性快停下來的那一點點不算）
        acc = Math.sign(d) === Math.sign(acc) ? acc + d : d
        if (top < 48) this.tuckDock(false)
        else if (acc > 28) this.tuckDock(true)
        else if (acc < -18) this.tuckDock(false)
      },
      { passive: true },
    )
  }
  tuckDock(on) {
    // 鍵盤 Tab 進來（或讀屏軟體移進來）：先回來，不要讓焦點停在看不見的按鈕上
    if (!this._tuckFocus) {
      this._tuckFocus = true
      $('.dock')?.addEventListener('focusin', () => this.tuckDock(false))
    }
    // 正在用番茄鐘的小視窗、鍵盤的焦點在 Dock 裡：不藏。
    // 只認鍵盤的焦點（:focus-visible）：全螢幕計時縮小時焦點會被放回 Dock 的按鈕上，用手指的人不該因此一直藏不起來
    const kb = document.activeElement?.matches?.(':focus-visible') && $('.dock')?.contains(document.activeElement)
    if (on && (!$('#focusSet').hidden || !$('#focusPick').hidden || kb)) on = false
    if (on === !!this._tucked) return
    this._tucked = on
    document.body.classList.toggle('dock-tuck', on)
  }

  // 手機直式：在分頁列上往上滑展開面板（收起 → 半開 → 全螢幕），往下滑收回
  _bindSheet() {
    const panel = $('#panel')
    const bar = $('#panel .tabs')
    let start = null
    let dragged = false
    bar.addEventListener('pointerdown', (e) => {
      if (!sheetLayout() || e.pointerType === 'mouse' || this.appMode) return
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
    const full = force ?? !$('#panel').classList.contains('full')
    // App 模式時面板一直撐滿；回小島要用 setAppMode(false)
    if (this.appMode && !full) return
    this._setFull(full)
  }
  _setFull(full) {
    const panel = $('#panel')
    if (full) {
      this.togglePanel(false)
      this.toggleShop(false)
    }
    panel.classList.toggle('full', full)
    document.body.classList.toggle('panel-full', full)
    this.renderFullBtn()
  }
  // 分頁列最右邊的鈕：平常是全螢幕編輯，App 模式時是「小島」
  renderFullBtn() {
    const b = $('#fullBtn')
    const full = $('#panel').classList.contains('full')
    if (this.appMode) {
      b.innerHTML = `${ISLAND_ICON}<span class="full-label">小島</span>`
      b.title = '切換到小島'
      b.setAttribute('aria-pressed', 'false')
      return
    }
    b.innerHTML = full ? ICON.shrink : ICON.expand
    b.title = full ? '離開全螢幕 (E / Esc)' : '全螢幕編輯 (E)'
    b.setAttribute('aria-pressed', String(full))
  }

  // ── App 模式：像一般 App 一樣用。面板撐滿整個畫面，小島停住、藏起來；手機的分頁列移到底下 ──
  // cabin：回小島時，正在專注、兩人在屋裡的話要不要直接進屋（要飛去看別的地方時不要）。
  // App 模式開機時還沒有小島：第一次切回小島要先下載、建好，這段時間畫面維持 App 模式、可以照常用；
  // 等的時候又選了別的（例如又切回 App）就不切。回傳最後有沒有換過去
  setAppMode(on, opts = {}) {
    const ticket = (this._modeTicket = (this._modeTicket || 0) + 1)
    // 換成 App 模式：「小島準備中」那張收掉（小島照樣在背景建好，之後按「小島」就直接換過去）
    if (on) this._loadingDone?.()
    if (on || !this.appMode || this.hooks.islandReady()) {
      this._applyAppMode(on, opts)
      return Promise.resolve(true)
    }
    const ready = this.hooks.ensureIsland()
    this._islandLoading(ready)
    return ready.then(
      () => {
        if (ticket !== this._modeTicket || !this.appMode) return false
        this._applyAppMode(false, opts)
        return true
      },
      (err) => {
        const sub = err?.webgl ? '這個瀏覽器（或顯示卡）畫不出小島，先用 App 模式' : err?.reload ? '重新整理頁面再試一次' : '連上網路再按一次「小島」；還是不行就重新整理頁面'
        if (ticket === this._modeTicket && !err?.updating) this.toast({ icon: '島', title: '小島沒有載入成功', sub, ms: 6000 })
        return false
      },
    )
  }
  // 第一次載入小島時，在通知的位置顯示「準備中」，好了（或失敗）就收掉。sub：底下那一行（小島模式開機時小島在背景建）
  _islandLoading(ready, sub = '第一次打開要下載一下，可以先繼續用') {
    if (this._loadingToast) return
    const el = (this._loadingToast = document.createElement('div'))
    el.className = 'toast busy'
    el.innerHTML = `<div class="t-icon">島</div><div><b>小島準備中…</b><small>${esc(sub)}</small></div>`
    $('#toasts').append(el)
    $('#fullBtn').setAttribute('aria-busy', 'true')
    const done = () => {
      if (this._loadingToast !== el) return
      this._loadingToast = null
      this._loadingDone = null
      $('#fullBtn').removeAttribute('aria-busy')
      el.classList.add('out')
      setTimeout(() => el.remove(), 500)
    }
    this._loadingDone = done
    ready.then(done, done)
  }
  _applyAppMode(on, { save = true, cabin = true } = {}) {
    const was = !!this.appMode
    this.appMode = on
    document.body.classList.toggle('app-mode', on)
    if (save) writeLocal(LAYOUT_KEY, on ? 'app' : 'island')
    if (on) this.toggleShop(false)
    this._setFull(on)
    this._syncPanelInert()
    this._moveTabInk(true)
    if (!on) {
      this.focus.toggleBig(false)
      $('#appChat').hidden = true
    } else if (this.focus.mode !== 'idle') this.focus.toggleBig(true)
    // 進 App 模式先看今日總覽（小島模式照舊從任務開始，總覽在第一個分頁）
    if (on && !was) this.setTab('today')
    this.renderAppBar()
    this.renderSettings()
    // 有些說明和按鈕依模式不同（「在島上查看」→「切到小島看看」）：開場第一次畫之前不用
    if (this._stale) this.render()
    this.hooks.appModeChanged?.(on, { cabin })
  }
  // App 模式寬螢幕的側欄：展開（問候、分頁名稱、番茄鐘）或收成只有圖示的窄欄，內容區就變寬
  toggleSide(force, { save = true } = {}) {
    const mini = force ?? !document.body.classList.contains('side-mini')
    document.body.classList.toggle('side-mini', mini)
    if (save) writeLocal(SIDE_KEY, mini)
    const b = $('#sideBtn')
    b.title = mini ? '展開側欄' : '收起側欄'
    b.setAttribute('aria-label', b.title)
    b.setAttribute('aria-expanded', String(!mini))
    // 箭頭：收起時朝右（點了會展開），展開時朝左
    $('#sideArrow').setAttribute('d', mini ? 'M13.5 10l2 2-2 2' : 'M15.5 10l-2 2 2 2')
  }
  // 要飛到島上某處的按鈕：App 模式先切回小島（不自動進小木屋；第一次要等小島建好），等畫面換好再飛過去
  _onIsland(fn) {
    if (!this.appMode) return fn()
    this.setAppMode(false, { cabin: false }).then((ok) => ok && requestAnimationFrame(() => requestAnimationFrame(fn)))
  }
  renderAppBar() {
    if (!this.appMode) return
    const s = this.store
    const lv = s.level.level
    $('#abGreet').textContent = GREETING[daypart()]
    $('#abSub').textContent = `Lv.${lv} ${levelTitle(lv)}${s.streak ? `・連續 ${s.streak} 日` : ''}`
    const { cur, need } = s.level
    $('#abXp').style.width = `${(cur / need) * 100}%`
    $('#abXpBar').title = `${cur} / ${need} XP`
    // 電腦的側欄：今天還沒做完的任務、還沒打卡的習慣
    // 數字變了輕輕跳一下（剛出現的從小長出來；第一次畫、變成 0 藏起來時不跳）
    const badge = (el, n) => {
      const was = el.hidden ? 0 : +el.dataset.n || 0
      el.hidden = !n
      el.textContent = n > 99 ? '99+' : n
      el.dataset.n = n
      if (n && n !== was && el._drawn && !calmMotion()) el.animate([{ scale: was ? 1 : 0.4 }, { scale: 1.3 }, { scale: 1 }], { duration: 380, easing: 'cubic-bezier(.2, .8, .2, 1)' })
      el._drawn = true
    }
    badge($('#tnTasks'), s.tasksOn(s.today).filter((t) => !t.done).length)
    badge($('#tnHabits'), s.habitsDueToday().filter((h) => !doneOn(h, s.today)).length)
  }
  // App 模式看不到小島上的兩人：她們說的話改成畫面下方的小對話框（一次一句）
  chatter(who, text, ms = 3400) {
    if (!this.appMode || !text) return
    const el = $('#appChat')
    const fuji = who === 'fuji'
    el.innerHTML = `<span class="stamp-k ${fuji ? 'coach-k' : 'mochi-k'}">${fuji ? '藤' : 'も'}</span><p><b>${fuji ? 'ふじ' : 'もち'}</b>${esc(text)}</p>`
    el.hidden = false
    el.classList.remove('show', 'bye')
    void el.offsetWidth
    el.classList.add('show')
    const live = $('#chatLive')
    if (live) live.textContent = `${fuji ? 'ふじ' : 'もち'}：${text}`
    clearTimeout(this._chatT)
    // 時間到了先淡出，再藏起來（一下子消失看起來像當掉）
    this._chatT = setTimeout(() => {
      el.classList.add('bye')
      this._chatT = setTimeout(() => (el.hidden = true), 260)
    }, Math.max(3000, ms || 0) + 600)
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
    const where = '想換回來，到「設定 → 外觀 → 夜間模式」'
    if (theme === 'auto') this.toast({ icon: '時', title: '天色回到跟著時間走', sub: '傍晚會自然變成夜晚' })
    else this.toast({ icon: night ? '夜' : '晝', title: night ? '換成夜晚了' : '換成白天了', sub: where })
  }

  renderTheme() {
    const night = this._nightFor(this.store.state.settings.theme)
    const b = $('#themeBtn')
    b.classList.toggle('night', night)
    b.title = night ? '切換成白天 (D)' : '切換成夜晚 (D)'
  }

  // ── 一行字變成任務或日程：任務頁的輸入框和「快速記錄」共用 ──
  // base：沒寫日期時加在哪一天；repeat、project：表單下拉選的重複和專案（字裡寫了「每天」「@專案」的優先）。
  // 回傳 { icon, title, sub, undo, toasts }；沒有標題（空的、只寫了日期）是 null。
  //   sub：加到哪裡的一句話（快速記錄列出來用）；undo()：拿掉剛加的；toasts：任務頁要跳的提示
  quickAdd(raw, { base = this.store.selectedDate, repeat: picked = null, project: pickedProj = null, asTask = false } = {}) {
    const s = this.store
    let p = parseQuick(raw, { today: s.today, projects: s.activeProjects(), span: true })
    if (!p.title) return null
    // 預覽上點了「改成任務」：寫了時間的那一行記成有時段的任務
    if (asTask && canSwap(p, picked)) p = asTimedTask(p)
    const date = p.date || base
    const repeat = p.repeat || picked
    const md = date.slice(5).replace('-', '/')
    const day = date === s.today ? '今天' : md
    const toasts = []
    if (p.kind === 'event') {
      // 整天的日程不會重複（例行公事只有有時段的）
      const allDay = !!p.allDay
      const routine = !allDay && !!repeat
      const end = p.end
      const ev = allDay ? { title: p.title, color: this.eventColor, date, allDay: true, endDate: p.endDate } : { title: p.title, start: p.start, end, color: this.eventColor, date }
      const made = routine ? s.addRoutine({ kind: 'event', ...ev, repeat }) : s.addEvent(ev)
      this.eventColor = (this.eventColor + 1) % EVENT_COLORS.length
      this._syncPickers()
      const until = allDay && p.endDate && p.endDate !== date ? `–${p.endDate.slice(5).replace('-', '/')}` : ''
      if (allDay) toasts.push({ icon: '環', title: '已加入整天的日程', sub: `${p.title}・${md}${until}${repeat ? '（整天的日程不會重複）' : ''}` })
      else toasts.push({ icon: '環', title: '已加入日程', sub: `${p.title}・${md} ${timeRange(p.start, end)}` })
      return {
        icon: '環', title: p.title, toasts,
        sub: allDay ? `整天的日程・${day}${until}` : `${routine ? '例行日程' : '日程'}・${day} ${timeRange(p.start, end)}`,
        undo: made ? (routine ? () => this._undoRoutine(made.id) : this._undoAdd(made, 'event')) : null,
      }
    }
    const t = { title: p.title, priority: p.priority || this.priority, tag: p.tag || this.tag, date, dur: p.dur, due: p.due || null, ...(p.at ? { at: p.at } : {}) }
    // 「@專案」優先，沒打就用下拉選的專案（例行任務不歸專案）
    const proj = p.project ? { id: p.project, name: p.projectName } : pickedProj
    let made
    if (repeat) {
      made = s.addRoutine({ kind: 'task', ...t, repeat })
      if (proj) toasts.push({ icon: '↻', title: '已加入例行任務', sub: `例行任務不會歸到專案「${proj.name}」` })
    } else {
      made = s.addTask({ ...t, project: proj?.id || null })
      if (made && p.star) s.toggleStar(made.id)
    }
    if (date !== s.selectedDate) toasts.push({ icon: '種', title: `已種在 ${md}`, sub: proj && !repeat ? `${p.title}・${proj.name}` : p.title })
    return {
      // task：剛加的任務（不是例行公事）的 id，任務頁的輸入框加完說一聲時用
      task: !repeat && made ? made.id : null,
      icon: repeat ? '↻' : '種', title: p.title, toasts,
      sub: [repeat ? '例行任務' : '任務', p.at ? `${day} ${p.at}` : day, tagOf(t.tag).label, proj && !repeat ? proj.name : ''].filter(Boolean).join('・'),
      undo: made ? (repeat ? () => this._undoRoutine(made.id) : this._undoAdd(made)) : null,
    }
  }
  // 復原剛加的例行公事：連它已經產生、還沒做的那幾件一起拿掉。
  // （deleteRoutine 會把今天以前的留著當紀錄：加完跨了午夜才按復原，昨天那件會變成逾期）
  // 撤銷剛記下的任務、日程：之後改過（改名、做完、排了時間、加了子任務）就留著，說一聲
  _undoAdd(made, kind = 'task') {
    // 跨過午夜的日程是兩段：兩段都跟剛記下時一樣才拿掉（改過隔天那段也算改過）
    const snapOf = (x) => JSON.stringify(kind === 'event' ? this.store.eventGroup(x) : x)
    const snap = snapOf(made)
    const id = made.id
    return () => {
      const cur = this.store.state[kind === 'event' ? 'events' : 'tasks'].find((t) => t.id === id)
      if (!cur) return true
      if (snapOf(cur) !== snap) {
        this.toast({ icon: '種', title: '記下之後又改過了', sub: '就留著現在的樣子', ms: 3400 })
        return false
      }
      if (kind === 'event') this.store.deleteEvent(id)
      else this.store.deleteTask(id)
      return true
    }
  }
  _undoRoutine(id) {
    const s = this.store
    s.deleteRoutine(id)
    for (const t of s.state.tasks.filter((x) => x.routineId === id && !x.done)) s.deleteTask(t.id)
    for (const e of s.state.events.filter((x) => x.routineId === id && !x.done)) s.deleteEvent(e.id)
  }

  // ── 快速記錄（ui/capture.js）：不用先切到任務頁，Dock 的＋或 N 鍵叫出來 ──
  // 先記下的事（專注時記的）：到今日總覽那一張卡片，焦點放在第一顆按鈕上（專注頁開著先縮小，計時照走）
  openParked() {
    this.focus.toggleBig(false)
    this.setTab('today')
    requestAnimationFrame(() => {
      const card = $('#todayRoot .td-park')
      if (!card) return
      card.scrollIntoView({ block: 'start', behavior: scrollMode() })
      card.querySelector('button')?.focus({ preventScroll: true })
    })
  }
  // 明天先做哪一件（planner.js 的 firstPickIn）：晚上才問。要挑的那天（下一次起床的那天），不是晚上是 null
  firstPickDay(now = new Date()) {
    const s = this.store
    const ahead = firstPickIn(s.state.rhythm, s.today, now.getHours() * 60 + now.getMinutes())
    return ahead == null ? null : addDays(s.today, ahead)
  }
  // 到今日總覽「明天先做哪一件？」那一張卡片，焦點放在第一個可以挑的上面（專注頁開著先縮小）
  openFirst() {
    this.focus.toggleBig(false)
    this.setTab('today')
    requestAnimationFrame(() => {
      const card = $('#todayRoot .td-first')
      if (!card) return
      card.scrollIntoView({ block: 'start', behavior: scrollMode() })
      card.querySelector('.td-first-pick, .td-first-in, button')?.focus({ preventScroll: true })
    })
  }
  // 晚間回顧記下之後：那天先做的那一件還沒挑的話，問一聲
  askFirst() {
    const day = this.firstPickDay()
    if (!day || this.store.firstOn(day)) return false
    const word = day === this.store.today ? '起床後' : '明天'
    this.toast({ icon: '先', title: `${word}先做哪一件？`, sub: '現在挑好一件，起床後打開 App 就從它開始', ms: 9000, tag: 'first-ask', actions: [{ label: '挑一件', run: () => this.openFirst() }] })
    return true
  }
  // 找找看（src/ui/search.js）：別的對話框開著就不疊上去。text：先填好的字。
  // here：按的是 /（「在這一頁找」）：正看著專案列表時用那一頁自己的搜尋框；Ctrl+K、放大鏡一律是找找看
  openSearch(text, { here = false } = {}) {
    const top = this._topLayer()
    if (top && top.id !== 'search') return false
    // 正看著專案列表：用那一頁自己的搜尋框（篩選卡片、找不到時可以直接開新專案）
    if (here && !this.search.isOpen && text == null && this.tab === 'projects' && !this._project.view?.id && !$('#panel').classList.contains('collapsed')) {
      this.findProject()
      return true
    }
    this.search.open(text)
    return true
  }
  // 點了找到的那一筆：任務、日程打開編輯面板（先換到那一天）；長期任務、專案打開專案詳情；生活記錄到紀錄頁的那一天
  _openFound(r) {
    const s = this.store
    this.search.close()
    if (r.kind === 'project') return this.openProject(r.item.id)
    if (r.kind === 'task') {
      const t = s.state.tasks.find((x) => x.id === r.item.id)
      if (!t) return
      if (floating(t) && t.project) return this.openProject(t.project, undefined, t.id)
      s.selectDate(t.date)
      this.setTab('tasks')
      return this.schedule.openEdit('task', t.id)
    }
    if (r.kind === 'event') {
      const e = isExternal(r.item) ? r.item : s.state.events.find((x) => x.id === r.item.id)
      if (!e) return
      s.selectDate(e.date)
      this.setTab('schedule')
      if (!isExternal(e)) this.schedule.openEdit('event', e.id)
      return
    }
    s.selectDate(r.date)
    this.setTab('records')
    // 捲到找到的那一則、焦點也跟過去（不會回到打開找找看之前按的那一格）。紀錄頁慢一點才畫好的話多等一下（最多 3 秒）
    // 面板剛展開（手機上還是 inert）時 focus() 會悄悄沒作用：焦點真的到了那一則才停，沒到就再等一下（最多 3 秒）。
    // 聚焦好了一次就結束；這段時間使用者自己點了、按了鍵盤，也整個不做了（不搶走使用者的焦點）
    const id = r.item?.id
    const until = performance.now() + 3000
    let done = false
    let shown = false
    const stop = () => {
      done = true
      removeEventListener('pointerdown', stop, true)
      removeEventListener('keydown', stop, true)
    }
    addEventListener('pointerdown', stop, true)
    addEventListener('keydown', stop, true)
    setTimeout(stop, 3100)
    const go = () => {
      if (done) return
      const row = id ? [...document.querySelectorAll('#lifeRoot .life-item')].find((x) => x.dataset.id === id) : null
      const later = () => (performance.now() < until && this.tab === 'records' ? void setTimeout(go, 50) : stop())
      if (!row && id) return void later()
      if (!shown) (row || $('#lifeRoot'))?.scrollIntoView({ block: row ? 'center' : 'start', behavior: scrollMode() })
      const btn = row?.querySelector('.li-main')
      if (!btn) return stop()
      if (!shown) row.classList.add('fresh')
      shown = true
      btn.focus({ preventScroll: true })
      if (document.activeElement === btn) stop()
      else later()
    }
    // 等畫面畫好再找；畫面沒在重畫時（背景、無頭瀏覽器）requestAnimationFrame 可能一直不來：另外排一次（聚焦好了就不會再動）
    requestAnimationFrame(() => requestAnimationFrame(go))
    setTimeout(go, 150)
  }
  openCapture(mode) {
    // 別的對話框開著（回顧、編輯、今日摘要…）就不疊上去
    const top = this._topLayer()
    if (top && top.id !== 'capture') return false
    // 看著紀錄頁（生活記錄在那裡）叫出來：直接是「生活記錄」
    const onRecords = this.tab === 'records' && !$('#panel').classList.contains('collapsed')
    this.capture.open(mode ?? (onRecords ? 'log' : undefined))
    return true
  }
  // 生活記錄的一行字：花費把金額拿出來（parse.js 的 parseSpend），其他種類整句照記
  _logParts(kind, raw) {
    return kind === 'spend' ? parseSpend(raw) : { text: String(raw || '').trim(), amount: 0 }
  }
  quickLog(kind, raw) {
    const s = this.store
    const { text, amount } = this._logParts(kind, raw)
    const date = s.today
    const item = s.addLife(date, { kind, text, amount })
    if (!item) return null
    const k = lifeKindOf(item.kind)
    return {
      icon: k.kanji, title: item.text || `${amount} 元`,
      sub: ['生活記錄', k.label, item.t || '', item.text && amount ? `${amount} 元` : ''].filter(Boolean).join('・'),
      undo: () => s.deleteLife(date, item.id),
    }
  }

  // ── 任務 ──
  _renderQuickPreview() {
    const box = $('#quickPreview')
    const v = $('#taskTitle').value
    const p = v.trim() ? parseQuick(v, { today: this.store.today, projects: this.store.activeProjects(), span: true }) : null
    // 寫了時間的那一行：可以點一下改成有時段的任務（換成別的字、不能換了就回到預設）
    const swap = canSwap(p, this._repeatValue('#taskRepeat'))
    if (!swap) this.quickAsTask = false
    const task = swap && this.quickAsTask
    const chips = p ? quickChips(p, this.store.today, task) : []
    if (p?.tag && (p.kind === 'task' || task)) chips.push(tagOf(p.tag).label)
    // 沒打「@專案」時，歸到下拉選的專案（例行任務不歸專案）
    const proj = (p?.kind === 'task' || task) && !p.projectName && !p.repeat && $('#taskRepeat').value === 'none' && this._taskProject()
    if (proj) chips.push(`專案・${proj.name}`)
    box.hidden = !chips.length
    box.innerHTML = chips.map((c, i) => `<span class="${i === 0 && p.kind === 'event' && !task ? 'kind' : ''}">${esc(c)}</span>`).join('') + (swap ? swapBtn(task) : '')
  }

  _repeatValue(sel) {
    const v = $(sel).value
    if (v === 'none') return null
    if (v === 'weekly') return { type: 'weekly', days: [parseDate(this.store.selectedDate).getDay()] }
    if (v === 'monthly') return { type: 'monthly', day: parseDate(this.store.selectedDate).getDate() }
    return { type: v }
  }

  _renderRepeatOptions() {
    const d = parseDate(this.store.selectedDate)
    const wd = WEEK_ZH[d.getDay()]
    for (const sel of [$('#taskRepeat'), $('#eventRepeat')]) {
      const v = sel.value || 'none'
      sel.innerHTML = `<option value="none">不重複</option><option value="daily">每天</option><option value="weekdays">平日</option><option value="weekly">每週${wd}</option><option value="monthly">每月 ${d.getDate()} 日</option>`
      sel.value = v
    }
  }

  // 新增任務時選的專案：還在的才算（被收藏、刪掉了就回到不歸專案）
  _taskProject() {
    return (this.taskProject && this.store.activeProjects().find((p) => p.id === this.taskProject)) || null
  }
  // 專案下拉：最近動過的在前；選單內容沒變就不重建（開著選單時不會被關掉）
  _renderProjectPick() {
    const sel = $('#taskProject')
    const list = [...this.store.activeProjects()].sort((a, b) => (b.editedAt || 0) - (a.editedAt || 0))
    const cur = this._taskProject()
    this.taskProject = cur?.id || null
    sel.hidden = !list.length
    setHTML(sel, `<option value="">不歸專案</option>${list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`)
    sel.value = this.taskProject || ''
    sel.classList.toggle('on', !!this.taskProject)
    sel.title = cur ? `新任務會歸到「${cur.name}」` : '新任務要歸到哪個專案（也可以在輸入框打 @專案名）'
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

  // ── 字體大小、這一版的新功能 ──
  // Liquid Glass 的透明度（0 清透～100 著色）：所有玻璃的底色不透明度、模糊、飽和度都從這裡來（styles.css 的 --lg-*）。
  // 越清透底色越淡、模糊越少、顏色越鮮；50 時跟原本的樣子一樣。正在拖滑桿時照滑桿的值，不被重畫拉回存檔的值
  applyGlass(v = this.store.state.settings.glass) {
    const r = $('#glassRange')
    if (document.activeElement === r) v = +r.value
    else r.value = v
    const t = v / 100
    const st = document.body.style
    st.setProperty('--lg-a', (0.14 + t * 0.8).toFixed(3))
    st.setProperty('--lg-a-strong', Math.min(0.96, 0.4 + t * 0.84).toFixed(3))
    st.setProperty('--lg-a-solid', Math.min(0.97, 0.62 + t * 0.64).toFixed(3))
    st.setProperty('--lg-blur', `${(4 + t * 22).toFixed(1)}px`)
    st.setProperty('--lg-sat', `${Math.round(220 - t * 80)}%`)
    r.style.setProperty('--p', `${v}%`)
  }

  applyFontScale() {
    document.documentElement.style.setProperty('--ui-zoom', this.store.state.settings.fontScale)
  }
  // 有沒看過的新版本：設定列和「紀錄」分頁上的小紅點。第一次打開的新使用者不提示
  renderNewsDot() {
    let seen = readLocal(NEWS_KEY, null)
    if (seen == null && Date.now() - (this.store.state.createdAt || Date.now()) < 86400000) {
      seen = newsVersion()
      writeLocal(NEWS_KEY, seen)
    }
    const fresh = seen !== newsVersion()
    $('#newsDot').hidden = !fresh
    $('.tab[data-tab="records"]').classList.toggle('has-dot', fresh)
  }
  // 整份更新紀錄很大：打開這裡才載入（離線時沒有快取就說一聲）
  async openNews() {
    let CHANGELOG
    try {
      ;({ CHANGELOG } = await import('./data/changelog.js'))
    } catch (err) {
      return this._loadFailToast('新', '更新紀錄還沒下載', err, '連上網路再打開一次')
    }
    // 這一版先列前三項（其餘的點開），舊的版本收起來只留標題：一打開就看得出這次改了什麼。
    // 同一版後來又加了幾項（看過的是「這一版:37 項」）：先列看過之後新加的那幾項
    const li = (xs) => xs.map((x) => `<li>${esc(x)}</li>`).join('')
    const head = (e) => `${+e.date.slice(5, 7)}/${+e.date.slice(8)}<b>${esc(e.title)}</b>`
    const more = (xs, label) => (xs.length ? `<details class="news-more"><summary>${label}</summary><ul>${li(xs)}</ul></details>` : '')
    const [seenId, seenN] = String(readLocal(NEWS_KEY, '') || '').split(':')
    $('#newsList').innerHTML = CHANGELOG.slice(0, 8)
      .map((e, i) => {
        if (i) return `<details class="news-old"><summary><h4>${head(e)}</h4></summary><ul>${li(e.items)}</ul></details>`
        const n = +seenN
        if (seenId === e.id && n > 0 && n < e.items.length) {
          const fresh = e.items.slice(n)
          return `<section><h4>${head(e)}</h4><p class="news-fresh">上次看過之後，新加了 ${fresh.length} 項</p><ul>${li(fresh.slice(0, 3))}</ul>${more(fresh.slice(3), `新加的還有 ${fresh.length - 3} 項`)}${more(e.items.slice(0, n), `這一版之前的 ${n} 項`)}</section>`
        }
        return `<section><h4>${head(e)}</h4><ul>${li(e.items.slice(0, 3))}</ul>${more(e.items.slice(3), `這一版還有 ${e.items.length - 3} 項`)}</section>`
      })
      .join('')
    $('#newsModal').hidden = false
    writeLocal(NEWS_KEY, newsVersion())
    this.renderNewsDot()
  }
  closeNews() {
    if ($('#newsModal').hidden) return
    $('#newsModal').hidden = true
    this.hooks.modalClosed?.()
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
    else if (stars.length < MAX_STARS) msg = touchUI() ? `點任務、按「★ 本命」選出最重要的 ${MAX_STARS} 件・完成雙倍 XP` : `按任務旁的 ☆ 選出最重要的 ${MAX_STARS} 件・完成雙倍 XP`
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
    // 改開始時結束跟著挪（長度不變，像一般的行事曆）：挪過午夜就接到隔天（存的時候分成兩段，跟日程面板一樣）。
    // 原本就沒有長度（結束不在開始之後）的補成一小時。程式自己填的時段（加完一件後換成下一段、點時間軸）不會發 change：
    // 開始時間在點進去的那一刻記下來
    let evPrev = $('#eventStart').value
    $('#eventStart').addEventListener('focus', () => (evPrev = $('#eventStart').value))
    $('#eventStart').addEventListener('change', () => {
      const st = $('#eventStart').value
      // 原本的長度（結束已經接到隔天的 23:30–00:30 也算）照 store 的規則挪：跨過午夜太久的截到 23:59
      if (st && st !== evPrev) $('#eventEnd').value = evPrev ? shiftEnd(evPrev, $('#eventEnd').value, st) : minToHHMM(Math.min(toMin(st) + 60, 1439))
      evPrev = st
    })
    // 整天：藏起時段和重複（例行公事只有有時段的），換成「到哪天」
    const allDayMode = (on) => {
      setOn($('#eventAllDay'), on)
      for (const el of $$('#eventForm .ev-timed')) el.hidden = on
      $('#eventForm .ev-until').hidden = !on
      const until = $('#eventUntil')
      until.min = this.store.selectedDate
      if (on && (!until.value || until.value < this.store.selectedDate)) until.value = this.store.selectedDate
    }
    $('#eventAllDay').addEventListener('click', () => allDayMode(!$('#eventAllDay').classList.contains('on')))
    $('#eventForm').addEventListener('submit', (e) => {
      e.preventDefault()
      const title = $('#eventTitle').value
      if (!title.trim()) {
        $('#eventTitle').focus()
        return
      }
      if ($('#eventAllDay').classList.contains('on')) {
        const date = this.store.selectedDate
        const until = $('#eventUntil').value
        this.store.addEvent({ title, color: this.eventColor, date, allDay: true, endDate: until })
        $('#eventTitle').value = ''
        this.eventColor = (this.eventColor + 1) % EVENT_COLORS.length
        this._syncPickers()
        allDayMode(false)
        $('#eventUntil').value = ''
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
      if (this.store.state.settings.notify && notifyPermission() === 'granted') {
        this.store.setSetting('notify', false)
        // 排著的到點通知取消、推播退訂
        this.hooks.push?.off()
        this.renderRemind()
      } else await this.enableNotify()
    })
    $('#notifyTest').addEventListener('click', async () => {
      const btn = $('#notifyTest')
      btn.disabled = true
      const r = await this.hooks.pushTest?.()
      btn.disabled = false
      this.toast(
        r === 'ready'
          ? { icon: '鐘', title: '10 秒後傳一則通知', sub: '現在可以鎖上螢幕、或切到別的 App 等它' }
          : r === 'busy'
            ? { icon: '鐘', title: '計時中先不試', sub: '這一輪到點時就會通知你' }
            : { icon: '鐘', title: '這次沒排上', sub: r === 'unsupported' ? '這個瀏覽器只有頁面開著時才能通知' : '連不上通知伺服器，等一下再試' },
      )
      this.renderRemind()
    })
  }

  // 打開系統通知（日程頁提醒那一列的按鈕、警語卡上的「打開系統通知」）：問權限、順便訂閱推播
  async enableNotify() {
    const perm = notifyPermission() === 'default' ? await requestNotify() : notifyPermission()
    this.store.setSetting('notify', perm === 'granted')
    if (perm === 'granted') {
      // 順便訂閱推播：專注到點時，鎖著螢幕、切到別的 App 也收得到
      const ok = await this.hooks.push?.setup()
      this.toast({ icon: '鐘', title: '系統通知已開啟', sub: ok ? '提醒和專注到點都會通知，鎖著螢幕也收得到' : '切到別的視窗時也會提醒你' })
      // 已經在計時：這一輪到點的通知現在排上
      this.hooks.focusPlan?.(this.focus.boundary)
    }
    this.renderRemind()
    return perm === 'granted'
  }

  // 警語的定時提醒送得到哪裡（警語卡上的那一行說明）：
  // phone：手機照時間通知（App 關著也會）／phone-off：還沒開系統通知／old-app：舊版的 Android 殼，要開著 App 才提醒
  // push：伺服器照時間推（頁面關掉也會）／page：頁面開著時（切到別的分頁也會跳通知）／page-off：還沒開系統通知／
  // page-blocked：被瀏覽器封鎖／home：iPhone 要先加入主畫面／page-only：這個瀏覽器沒有通知
  mottoReach() {
    const on = this.store.state.settings.notify && notifyPermission() === 'granted'
    if (native) return nativeMottos() ? (on ? 'phone' : 'phone-off') : 'old-app'
    if (!notifySupported()) return needsHomeScreen() ? 'home' : 'page-only'
    if (!on) return notifyPermission() === 'denied' ? 'page-blocked' : 'page-off'
    return this.hooks.mottoPush?.ready() ? 'push' : 'page'
  }

  renderRemind() {
    const st = this.store.state.settings
    // 警語卡上「App 關著時收不收得到」那一行也跟著通知的開關、權限（回到 App 時可能在系統設定裡改過）
    this.mottos?.render()
    $('#remindLead').value = String(st.remindLead)
    $('#remindLeadSet').value = String(st.remindLead)
    // 設定頁的系統通知按鈕：照日程頁那一顆的樣子（下面改完再抄一次）
    queueMicrotask(() => {
      const a = $('#notifyBtn')
      const b = $('#notifySetBtn')
      b.hidden = a.hidden
      b.disabled = a.disabled
      b.textContent = a.textContent
      setOn(b, a.classList.contains('on'))
    })
    const btn = $('#notifyBtn')
    const test = $('#notifyTest')
    const hint = $('#notifyHint')
    if (!notifySupported()) {
      btn.hidden = test.hidden = true
      // iPhone／iPad 的 Safari 分頁裡沒有通知功能：加入主畫面、從主畫面打開才有
      hint.hidden = !needsHomeScreen()
      hint.textContent = 'iPhone／iPad 要收通知：先在 Safari 按「分享」→「加入主畫面」，從主畫面打開後再回來這裡開啟'
      return
    }
    const perm = notifyPermission()
    const on = st.notify && perm === 'granted'
    this._watchNotifyPerm()
    // 不提醒日程時也能開：就寢、重要日子、專注到點的通知都用這個開關
    btn.disabled = perm === 'denied'
    setOn(btn, on)
    btn.textContent = perm === 'denied' ? '通知已被瀏覽器封鎖' : on ? '系統通知：開' : '開啟系統通知'
    // 被封鎖了：網頁自己不能再問，寫出到哪裡改回允許（日程頁和設定頁那一列都寫）
    const info = $('#remindSetInfo')
    if (info) {
      info.dataset.base ??= info.textContent
      info.textContent = perm === 'denied' ? `通知被瀏覽器封鎖了，要收通知：${this._blockedHelp()}` : info.dataset.base
      info.classList.toggle('warn', perm === 'denied')
    }
    if (perm === 'denied') {
      test.hidden = true
      this._renderPushLast(true)
      hint.hidden = false
      hint.textContent = `被封鎖時只在看著 App 時提醒。要重新打開：${this._blockedHelp()}`
      return
    }
    // 專注到點的通知：鎖著螢幕也收得到的（推播）才有「試一則」
    const state = this.hooks.push?.state
    test.hidden = !on || !pushSupported() || state === 'unsupported'
    this._renderPushLast(test.hidden)
    // Android 殼：即時倒數和到點都由手機自己發，不看這個開關（這個開關管日程、就寢這些提醒）
    hint.hidden = !on && !native
    hint.textContent = native
      ? '專注時狀態列和鎖定畫面會有即時倒數，到點由手機通知（鎖著、沒網路也準時）。這個開關管日程、就寢這些提醒'
      : !pushSupported() || state === 'unsupported'
        ? '專注到點、休息結束也會通知（這個瀏覽器要頁面開著才收得到）'
        : state === 'error'
          ? '專注到點、休息結束也會通知。現在連不上通知伺服器：頁面開著時照常通知，鎖著螢幕時可能收不到'
          : '專注到點、休息結束也會通知，鎖著螢幕、切到別的 App 也收得到（鎖著時專注到點，休息要等你回到 App 才開始算）'
  }

  _blockedHelp() {
    const app = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
    return blockedHelp(navigator.userAgent, app)
  }

  // 在網站設定裡改了通知權限（不一定會切走頁面）：權限一變就重畫這兩列
  _watchNotifyPerm() {
    if (this._permWatch || native || !navigator.permissions?.query) return
    this._permWatch = navigator.permissions
      .query({ name: 'notifications' })
      .then((st) => st.addEventListener('change', () => this.renderRemind()))
      .catch(() => {})
  }

  // 「上一則到點通知幾點送到這台」：到點沒看到通知時，看這一行就知道是沒送到，還是送到了被收掉
  async _renderPushLast(off) {
    const el = $('#notifyLast')
    const e = off ? null : await this.hooks.push?.last()
    el.hidden = !e
    if (!e) return
    const d = new Date(e.got)
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const day = dateStr(d) === this.store.today ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`
    const late = Number.isFinite(e.at) && e.got - e.at >= 60000 ? `，比到點晚了 ${Math.round((e.got - e.at) / 60000)} 分鐘` : ''
    el.textContent = `上一則到點通知：${day} ${hm} 送到這台${late}${e.closed ? '（那時正看著 App，幾秒後自己收掉了）' : ''}`
  }

  renderSchedule(force = true) {
    this.schedule.render(force)
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
    this.renderAppBar()
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
    const html = [...daily, weekly].join('')
    setHTML($('#questList'), html)
  }

  render() {
    this.renderChrome()
    // 另一台裝置改了 Liquid Glass 的透明度，同步過來就跟著換
    this.applyGlass()
    // 番茄鐘的目標可能剛被做完、收藏或刪掉
    this.focus?.render()
    this.mottoBar?.render()
    // 任務、日程、專案只畫正在看的那一頁；其他頁記著，切過去時再畫（藏著的頁面不必每次都重建）
    this._stale = new Set(['tasks', 'schedule', 'projects'])
    this._renderPage(this.tab)
    if (this.tab === 'records') this.renderRecords()
    if (this.tab === 'habits') this.habits.render()
    if (this.tab === 'coach') this._coach.view?.refresh()
    if (this.tab === 'today') this.today.render()
    this.dates?.refresh()
    if (this._calendar.view?.isOpen) this._calendar.view.render()
  }

  _renderPage(tab) {
    if (!this._stale?.delete(tab)) return
    if (tab === 'projects') return this.renderProjects()
    if (tab !== 'tasks' && tab !== 'schedule') return
    this._renderRepeatOptions()
    this.renderRoutines()
    if (tab === 'tasks') return this.renderTasks()
    this.renderSchedule()
    this.renderRemind()
  }

  tickClock() {
    const n = new Date()
    const text = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
    if ($('#clock').textContent !== text) $('#clock').textContent = text
  }

  // ── 金平糖商店 ──
  toggleShop(force) {
    // 正在等小島建好要開商店：再按一次（或 Esc）就是不開了，也不切回小島
    const open = force ?? (this._shopWait ? false : $('#shop').hidden)
    if (!open && this._shopWait) {
      this._shopWait = null
      this._modeTicket++
    }
    // 商店要在島上擺東西，打開時先離開全螢幕；App 模式先切回小島（第一次要等小島建好），換過去再打開
    if (open && this.appMode) {
      const wait = (this._shopWait = {})
      this.setAppMode(false).then((ok) => {
        if (this._shopWait !== wait) return
        this._shopWait = null
        if (ok) this.toggleShop(true)
      })
      return
    }
    if (open) this.toggleFull(false)
    // 關掉時焦點在商店裡：交回商店的按鈕（收在「⋯」裡看不到時交給「⋯」），不掉到頁首
    const back = !open && $('#shop').contains(document.activeElement)
    $('#shop').hidden = !open
    if (back) ($('#shopBtn').getClientRects().length ? $('#shopBtn') : $('#dockMore')).focus({ preventScroll: true })
    $('#shopBtn').classList.toggle('on', open)
    $('#shopBtn').setAttribute('aria-expanded', open)
    if (open) this.renderShop()
  }

  renderShop() {
    const s = this.store
    $('#shopCoins').textContent = s.coins
    // 縮圖的模型跟小島在一起（商店只在小島上開，這時已經載好了）
    const thumbs = this._shopThumbs
    if (!thumbs && !this._shopThumbsP) {
      this._shopThumbsP = import('./scene/placed.js')
        .then(({ renderThumbnails }) => {
          this._shopThumbs = renderThumbnails(SHOP_ITEMS.map((i) => i.key))
          if (!$('#shop').hidden) this.renderShop()
        })
        .catch((err) => console.warn('[hiyori] 商店縮圖載入失敗', err))
        .finally(() => (this._shopThumbsP = null))
    }
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
        const badge = i.exclusive ? '<i class="shop-badge shop-wk">週限定</i>' : i.season ? `<i class="shop-badge s-${i.season}">${SEASON_ZH[i.season]}</i>` : ''
        const price = st.lock ? `<span class="price lock">${st.lock}</span>` : st.free ? '<span class="price free">免費</span>' : `<span class="price"><i class="konpeito"></i>${i.price}</span>`
        return `<button class="shop-item ${st.lock ? 'locked' : ''}" data-key="${i.key}" title="${esc(i.desc)}" ${st.ok ? '' : 'disabled'}>
        ${badge}<img src="${thumbs?.[i.key] || BLANK}" alt="" />
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
    // 點了島上另一棟房子：先回到專案列表，那張卡才看得到
    const pv = this._project.view
    if (type === 'project' && pv?.id && pv.id !== id) {
      pv.close()
      this._stale?.add('projects')
    }
    this.setTab({ task: 'tasks', event: 'schedule', project: 'projects' }[type])
    this.highlight(type, id)
    const el =
      type === 'task' ? $(`.item[data-id="${CSS.escape(id)}"]`) : type === 'event' ? $(`.blk[data-id="${CSS.escape(id)}"]`) : $(`.proj[data-id="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ behavior: scrollMode(), block: 'center' })
    setTimeout(() => this.highlight(null), 2200)
  }

  // 畫面上有沒有打到一半的字（自動換新版、重新整理之前檢查）。
  // 跟畫出來時的值不一樣就算：寧可多問一次，也不要把使用者打的字刷掉
  hasDraft() {
    // 編輯到一半的表單（日程、任務的編輯面板，新增或編輯訂閱）：只改了時間、下拉選單也算
    const open = (el) => !!el?.getClientRects().length
    if (open($('#editSheet')) || open($('form.sb-form'))) return true
    // 快速記錄關掉後字還留著（下次打開接著打）：看不到也算，重新整理會把它弄丟
    if ($('#capInput').value.trim()) return true
    // 清掉原本的字也算改了（跟畫出來時的值不一樣，前後空白不算）。data-nodraft：搜尋框這類，字不見了也沒關係
    return $$('input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], textarea, [contenteditable="true"]').some((el) => {
      if (!el.getClientRects().length || el.dataset.nodraft !== undefined) return false
      if (el.isContentEditable) return document.activeElement === el && !!el.textContent.trim()
      return el.value.trim() !== el.defaultValue.trim()
    })
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

// 拆出去的幾組方法掛回來（getter 也照搬，不會被 Object.assign 先算掉）
for (const m of [layersMethods, taskListMethods, projectListMethods, settingsMethods, reviewMethods, recordsMethods, toastMethods]) Object.defineProperties(UI.prototype, Object.getOwnPropertyDescriptors(m))
