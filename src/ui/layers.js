// UI 的方法（從 ui.js 搬過來，掛回 UI.prototype）：最上面那一層、Esc、返回鍵（瀏覽紀錄跟著開著幾層）、Tab 只在最上面那一層轉
import { $, $$ } from './dom.js'
import { focusables, layerZ } from './shared.js'

export const layersMethods = {
  // ── 蓋在面板上的幾層：對話框（DOM 裡越後面越上層）→ 今日摘要 → 番茄鐘的小視窗 → App 模式的全螢幕計時 → 商店 → 日曆 ──
  _topLayer() {
    const modal = $$('.modal').filter((m) => !m.hidden).pop()
    if (modal) return modal
    if (this.brief?.open) return $('#brief')
    // 擺放裝飾時：方向鍵是挪裝飾，不是換日期；Tab 在擺放列的按鈕裡轉
    return [$('#placeBar'), $('#focusSet'), $('#focusPick'), $('#focusFull'), $('#shop')].find((el) => !el.hidden) || (this._calendar.view?.isOpen ? $('#calendar') : null)
  },
  // Esc 一次只關最上面那一層；什麼都沒開時才放開打字的欄位、離開全螢幕
  _escape(typing) {
    if (this._closeTop()) return
    if (this._shopWait) this.toggleShop(false)
    else if (typing) document.activeElement.blur()
    else if (this.tab === 'projects' && this._project.view?.id) this._project.view.closeTask() || this.closeProject()
    else this.toggleFull(false)
  },
  // 關掉最上面那一層（Esc、返回鍵）：回傳有沒有一層可以關
  _closeTop() {
    const top = this._topLayer()
    if (top) {
      const close = {
        editSheet: () => this.schedule.closeEdit(),
        reviewModal: () => $('#reviewLater').click(),
        newsModal: () => this.closeNews(),
        weekModal: () => this.closeWeekCard(),
        brief: () => this.brief.close(),
        capture: () => this.capture.close(),
        search: () => this.search.close(),
        fujiSheet: () => this.fuji?.close(),
        levelModal: () => this.closeModal(),
        focusSet: () => this.focus.toggleSet(false),
        focusPick: () => this.focus.togglePicker(false),
        // 正在「先等一分鐘」：先只收起那一塊（焦點用 Tab 移到別顆上了也一樣），不縮小專注頁
        focusFull: () => this.focus.noisePanel(false) || this.focus.urge(false) || this.focus.toggleBig(false),
        shop: () => this.toggleShop(false),
        placeBar: () => $('#placeCancel').click(),
        calendar: () => this._calendar.view?.close(),
      }[top.id]
      close?.()
      return true
    }
    return false
  },

  // ── 返回鍵（瀏覽器的上一頁、Android 的返回鍵、滑鼠的上一頁鍵）：先關最上面那一層（對話框、找找看、快速記錄、
  // 編輯面板、今日摘要、專注頁、商店、日曆），再從專案的任務頁回到專案、從專案回到列表；都沒有了才真的離開 App。
  // 開著幾層（_backDepth）就記著幾筆瀏覽紀錄，每一筆的 state 寫著它是第幾層、排在第幾筆（{ hb: n, pos }），現在退到第幾層直接讀 history.state，
  // 不靠自己數（連續開關好幾層、退的那一下還在路上時數會錯，退過頭就離開 App 了）。
  // 開了一層：補到一樣多；自己按 × 或 Esc 關掉的：退回一樣多（一次退完，收到 popstate 之前不再補）；
  // 按了返回鍵（popstate、不是自己退的）：多出來的那幾層一層一層關，關不掉的（擋著）把紀錄補回去
  _bindBack() {
    this._going = false
    this._skipping = 0
    // 紀錄上寫的是第幾層（hb：這一套寫的；別的格式、不合理的數字都當成最底下那一層）、排在第幾筆（pos：分得出按的是返回還是前進）
    const stateDepth = () => {
      const n = history.state?.hb
      return Number.isInteger(n) && n > 0 && n <= 50 ? n : 0
    }
    const posOf = () => (Number.isInteger(history.state?.pos) ? history.state.pos : null)
    // 不算一層的紀錄：前進鍵走到、那一層已經關掉了的（改寫成 skip），舊版留下的（{ hiyori: 時間 }）
    const stale = () => {
      const st = history.state
      return !!st && typeof st === 'object' && (st.skip === 1 || ('hiyori' in st && !('hb' in st)))
    }
    this._stateDepth = stateDepth
    this._staleEntry = stale
    // 開場的這一筆還沒記過位置：記成最底下那一層。舊版留下的那一筆（重新整理、更新後還停在上面）不算一層：記成跳過、退回它前面那一筆
    this._pos = posOf() ?? 0
    const oldAtBoot = stale()
    if (posOf() == null || oldAtBoot) {
      try {
        history.replaceState({ hb: oldAtBoot ? 0 : stateDepth(), pos: this._pos, ...(oldAtBoot ? { skip: 1 } : {}) }, '')
      } catch {}
    }
    addEventListener('popstate', () => {
      const pos = posOf()
      const dir = pos == null || pos <= this._pos ? -1 : 1
      this._pos = pos ?? this._pos - 1
      // 走到還沒記過位置的那一筆（App 一打開的那一筆）：記上，之後分得出返回、前進
      if (pos == null && !stale()) {
        try {
          history.replaceState({ ...(history.state || {}), hb: stateDepth(), pos: this._pos }, '')
        } catch {}
      }
      if (this._going) {
        // 正在跳過不算一層的紀錄：還是那種的話照原本的方向接著走
        if (this._skipping && stale()) return void history.go(this._skipping)
        this._going = false
        this._skipping = 0
        clearTimeout(this._goingT)
        return this._syncBack()
      }
      const have = stateDepth()
      // 按了返回鍵：多出來的那幾層一層一層關，關不掉的（擋著）之後把紀錄補回去
      if (dir < 0) {
        for (let n = this._backDepth(); n > have; ) {
          this._backOne()
          const m = this._backDepth()
          if (m >= n) break
          n = m
        }
      }
      const want = this._backDepth()
      // 走到不算一層的那一筆：接著往同一個方向走（返回鍵按一次退一層、不用多按；前進鍵走得到後面的頁面）
      if (stale() && want <= have) return this._skip(dir)
      // 前進鍵走到的是已經關掉的那一層（打不回來）：這一筆改寫成不算一層，接著往前走（不把人拉回去，也不會留下一筆要多退的）
      if (dir > 0 && want < have) {
        try {
          history.replaceState({ hb: want, pos: this._pos, skip: 1 }, '')
        } catch {}
        return this._skip(1)
      }
      this._syncBack()
    })
    // 重新整理之前開著的那幾層已經不在了：退回最底下那一筆（同一頁裡的切換，不會重新載入），返回鍵按一次就離開
    if (oldAtBoot) this._skip(-1)
    else this._syncBack()
    // 哪一層打開、關掉（hidden 換了）、按了什麼（專案、任務頁開關）之後：對一下紀錄跟開著的層數
    new MutationObserver(() => this._syncBackSoon()).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true })
    // 小島模式收起、打開面板（滑一下、點地圖）：專案算不算一層跟著變
    const panel = $('#panel')
    if (panel) new MutationObserver(() => this._syncBackSoon()).observe(panel, { attributes: true, attributeFilter: ['class'] })
    // （點了、按了之後：等這一下的處理都跑完再對，不然對到的是打開之前的樣子）
    for (const ev of ['click', 'keyup']) document.addEventListener(ev, () => setTimeout(() => this._syncBack()), true)
  },
  // 往 dir 的方向再走一筆（跳過不算一層的紀錄）；那個方向沒有了就停在這一筆（瀏覽器說得出來的先問：不用等）。
  // 收不到 popstate（沒有了、瀏覽器擋了）也不會卡住：一下子之後照現在的再對一次
  // 往前走、前面沒有了：退回原本那一筆（前進鍵等於沒按），不留下一筆要多退的
  _skip(dir) {
    const nav = globalThis.navigation
    const can = nav && typeof nav.canGoForward === 'boolean' ? (dir > 0 ? nav.canGoForward : nav.canGoBack) : null
    if (can === false) return dir > 0 ? this._skip(-1) : this._syncBack()
    this._going = true
    this._skipping = dir
    clearTimeout(this._goingT)
    this._goingT = setTimeout(() => {
      this._going = false
      this._skipping = 0
      if (dir > 0 && this._staleEntry?.()) return this._skip(-1)
      this._syncBack()
    }, 600)
    try {
      history.go(dir)
    } catch {
      this._going = false
      this._skipping = 0
    }
  },
  // 現在開著幾層（跟 _topLayer 看的一樣），加上專案（看著專案頁時：專案 1 層、任務頁再 1 層）
  _backDepth() {
    const layers = [...$$('.modal').filter((m) => !m.hidden), ...[$('#placeBar'), $('#focusSet'), $('#focusPick'), $('#focusFull'), $('#shop')].filter((el) => el && !el.hidden)]
    let n = layers.length + (this.brief?.open ? 1 : 0) + (this._calendar?.view?.isOpen ? 1 : 0)
    // 專案：看得到專案頁時才算（小島模式把面板收起來了就不算）
    const pv = this._project?.view
    if (this.tab === 'projects' && pv?.id && !$('#panel')?.classList.contains('collapsed')) n += pv.taskId ? 2 : 1
    return n
  },
  _syncBackSoon() {
    if (this._backQueued) return
    this._backQueued = true
    queueMicrotask(() => {
      this._backQueued = false
      this._syncBack()
    })
  },
  _syncBack() {
    if (this._going || !this._stateDepth) return
    const want = this._backDepth()
    const have = this._stateDepth()
    try {
      if (want > have) for (let n = have + 1; n <= want; n++) history.pushState({ hb: n, pos: ++this._pos }, '')
      else if (want < have) {
        this._going = true
        this._skipping = 0
        // 一直沒收到 popstate（瀏覽器擋了）：不要卡住，之後照現在的再對一次
        clearTimeout(this._goingT)
        this._goingT = setTimeout(() => {
          this._going = false
          this._syncBack()
        }, 1500)
        history.go(want - have)
      }
    } catch {
      this._going = false
    }
  },
  // 按了返回鍵：關最上面那一層；都沒有的話，專案的任務頁回到專案、專案回到列表
  _backOne() {
    if (this._topLayer()) return void this._closeTop()
    const pv = this._project.view
    if (this.tab === 'projects' && pv?.id && !pv.closeTask()) this.closeProject()
  },
  // Tab 只在最上面那一層裡轉，不會跑到後面看不到的按鈕上（capture：編輯表單自己會擋掉往外傳的按鍵）。
  // 浮在最上面的提示卡（例如限時去的「我回來了」）也轉得到：排在這一層的後面（在第一顆按 Shift+Tab 就到）
  _trapTab(e) {
    if (e.key !== 'Tab') return
    const top = this._topLayer()
    if (!top) return
    const own = focusables(top)
    const list = [...own, ...this._toastButtons(top)]
    if (!list.length) return e.preventDefault()
    const a = document.activeElement
    const i = own.indexOf(a)
    // 在這一層的中間：交給瀏覽器（同一組的單選鈕之類照瀏覽器的規矩）
    if (i >= 0 && !(e.shiftKey ? i === 0 : i === own.length - 1)) return
    e.preventDefault()
    const k = list.indexOf(a)
    const step = e.shiftKey ? -1 : 1
    ;(k < 0 ? (e.shiftKey ? list.at(-1) : list[0]) : list[(k + step + list.length) % list.length]).focus()
  },
  // 提示卡上按得到的按鈕（正在收起來的不算）。最上面那一層疊得比提示卡高（對話框、今日摘要）時，
  // 提示卡在它的遮罩後面，一顆都不算
  _toastButtons(top) {
    // 常駐的警示列（存不進去時的「匯出資料」）也轉得到
    const alerts = top && layerZ(top) > layerZ($('#alerts')) ? [] : focusables($('#alerts'))
    if (top && layerZ(top) > layerZ($('#toasts'))) return alerts
    return [...focusables($('#toasts')).filter((b) => !b.closest('.toast.out')), ...alerts]
  },
  // 提示卡收掉時焦點要去的地方：進來之前的地方（還在、看得到、在最上面那一層裡），不然是最上面那一層的第一顆
  _toastHome(el) {
    const from = el?._from
    const top = this._topLayer()
    if (from?.isConnected && from.getClientRects().length && !from.closest('.toast') && (!top || top.contains(from))) return from
    return top ? focusables(top)[0] || top : null
  },
  // 對話框打開時把焦點移進去，關掉時還給打開前的地方（日曆自己會做）
  _bindLayers() {
    addEventListener('keydown', (e) => this._trapTab(e), true)
    let last = null
    let prev = null
    document.addEventListener('focusin', (e) => {
      if (e.target === last) return
      prev = last
      last = e.target
    })
    const back = new Map()
    const watch = new MutationObserver((list) => {
      for (const { target: el } of list) {
        if (!el.hidden && !back.has(el)) {
          back.set(el, el.contains(last) ? prev : last)
          requestAnimationFrame(() => {
            // 不是最上面那一層（快速記錄開著時，番茄鐘自動進下一輪打開了全螢幕計時）：焦點留在上面，不搶到後面去
            if (!el.hidden && !el.contains(document.activeElement) && this._topLayer() === el) focusables(el)[0]?.focus({ preventScroll: true })
          })
        } else if (el.hidden && back.has(el)) {
          const to = back.get(el)
          back.delete(el)
          // 焦點還在這層裡（或掉到 body）才還回去：關掉的同時打開了別層就不搶
          const a = document.activeElement
          if (to?.isConnected && (!a || a === document.body || el.contains(a))) to.focus({ preventScroll: true })
        }
      }
    })
    for (const el of [...$$('.modal'), $('#focusFull'), $('#shop'), $('#focusPick'), $('#focusSet')]) watch.observe(el, { attributes: true, attributeFilter: ['hidden'] })
  },

}
