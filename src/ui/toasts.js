// UI 的方法（從 ui.js 搬過來，掛回 UI.prototype）：提示卡（倒數、停住、滑掉、焦點）、最上面的警示列、匯出資料、意見回饋
import { calmMotion } from './motion.js'
import { errorDigest } from '../errors.js'
import { $, $$, esc } from './dom.js'
import { LATEST } from '../data/latest.js'
import { FEEDBACK_URL } from './shared.js'

export const toastMethods = {
  // 收掉某一類的提示卡
  // 畫面上有沒有這一類（tag）的提示卡
  hasToast(tag) {
    return $$('#toasts .toast:not(.out)').some((el) => el.dataset.tag === tag)
  },
  // 把焦點放到某一類提示卡的第一顆按鈕（from：收掉時要交回的地方）
  focusToast(tag, from = null) {
    const el = $$('#toasts .toast:not(.out)').find((x) => x.dataset.tag === tag)
    const b = el?.querySelector('button')
    if (!b) return
    if (from) el._from = from
    b.focus({ preventScroll: true })
  },
  dropToasts(tag) {
    for (const el of $$('#toasts .toast')) if (el.dataset.tag === tag) this._dropToast(el, true)
  },
  // 收一張提示卡：先淡出，再把高度收起來（後面的提示卡慢慢靠上去，不會一下子跳上去）
  _dropToast(el, fast = false) {
    if (!el?.isConnected || el.classList.contains('out')) return
    clearTimeout(el._life)
    // 焦點在這一張的按鈕上：先交回進來之前的地方（不然收掉時掉到 body，下一次 Tab 又從頭來）
    if (el.contains(document.activeElement)) {
      const home = this._toastHome(el)
      if (home) home.focus({ preventScroll: true })
      else document.activeElement.blur()
    }
    // 淡出的這一下按不到了（按 Enter 不會再算一次）
    el.inert = true
    el.classList.add('out')
    const done = () => el.remove()
    if (calmMotion()) return done()
    setTimeout(
      () => {
        if (!el.isConnected) return
        el.style.overflow = 'hidden'
        el.animate([{ height: `${el.offsetHeight}px` }, { height: '0px', marginBottom: '-8px', paddingTop: '0px', paddingBottom: '0px', borderWidth: '0px' }], {
          duration: 200,
          easing: 'ease-in-out',
          fill: 'forwards',
        }).finished.then(done, done)
      },
      fast ? 160 : 380,
    )
  },
  // 有按鈕的提示卡：游標停在上面、手指按著（按在按鈕上也算）、鍵盤焦點在裡面時先不倒數（看清楚再按），
  // 這些都沒有了才接著倒數（剩下的至少 1.2 秒）。手機上可以往左右滑掉
  _holdToast(el, ms) {
    // left：還剩多久收掉；frac：倒數細線在 at 那時還剩幾成（停過之後從停住的地方，照真的剩下的時間縮到 0）
    let left = ms
    let at = 0
    let frac = 1
    // 現在為什麼停著：hover／touch／focus，空的就在倒數
    const why = new Set()
    const sync = () => {
      if (!el.isConnected || el.classList.contains('out')) return
      const held = el.classList.contains('held')
      if (why.size && !held) {
        clearTimeout(el._life)
        // 還沒開始倒數就先停住（換掉同一類的上一張時，焦點一開始就在這一張上）：一點都還沒過
        const gone = at ? performance.now() - at : 0
        frac *= Math.max(0, 1 - gone / left)
        left = Math.max(1200, left - gone)
        el.classList.add('held')
      } else if (!why.size && (held || !at)) {
        // 剩下不到 1.2 秒時停過：細線也照多給的時間慢慢縮，不會先縮完、卡片還在
        if (held && el.classList.contains('timed')) {
          el.style.setProperty('--from', frac.toFixed(3))
          el.style.setProperty('--life', `${Math.round(left)}ms`)
          el.classList.remove('timed')
          void el.offsetWidth
          el.classList.add('timed')
        }
        at = performance.now()
        el._life = setTimeout(() => this._dropToast(el), left)
        el.classList.remove('held')
      }
    }
    const hold = (k, on) => {
      if (on) why.add(k)
      else why.delete(k)
      sync()
    }
    // 手機沒有「停在上面」：手指另外算（放開時 :hover 還會黏著，不能拿來判斷）
    el.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && hold('hover', true))
    el.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && hold('hover', false))
    // 焦點在裡面、而且是用鍵盤移進來的才算：滑鼠點過按鈕留下的焦點不算（不然游標移開了也一直不收）。
    // 每次焦點換了都重新看一次（先用 Tab 移進來、再用滑鼠按另一顆，就不再算）
    const focusCheck = () => {
      const a = document.activeElement
      hold('focus', !!a && el.contains(a) && !!a.matches?.(':focus-visible'))
    }
    el.addEventListener('focusin', focusCheck)
    el.addEventListener('focusout', () => setTimeout(focusCheck, 0))
    // 手指：按著的時候不倒數，放開、或被瀏覽器拿去捲動（pointercancel）就接著倒數。
    // 從字上（不是按鈕）開始往左右滑：跟著走，放開時滑夠遠就收掉，不夠就彈回來；被取消的不算滑掉。
    // 放開的事件在 document 上接：手指滑出提示卡外、按下去的那個元素不見了，也收得到
    const fingers = new Set()
    let drag = null
    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return
      drag.dx = e.clientX - drag.x
      el.style.translate = `${drag.dx}px 0`
      el.style.opacity = String(1 - Math.min(0.8, Math.abs(drag.dx) / 260))
    }
    const end = (e) => {
      if (!fingers.delete(e.pointerId)) return
      if (drag?.id === e.pointerId) {
        const { dx } = drag
        drag = null
        if (e.type === 'pointerup' && Math.abs(dx) > 70 && el.isConnected && !el.classList.contains('out')) {
          el.style.transition = 'translate .2s ease-in, opacity .2s'
          el.style.translate = `${Math.sign(dx) * innerWidth * 0.6}px 0`
          el.style.opacity = '0'
          clearTimeout(el._life)
          el.classList.add('out')
          setTimeout(() => el.remove(), 210)
        } else if (dx) {
          el.style.transition = 'translate .25s cubic-bezier(.2, .8, .2, 1), opacity .25s'
          el.style.translate = ''
          el.style.opacity = ''
          setTimeout(() => (el.style.transition = ''), 260)
        }
      }
      if (fingers.size) return
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', end, true)
      document.removeEventListener('pointercancel', end, true)
      hold('touch', false)
    }
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return
      if (!fingers.size) {
        document.addEventListener('pointermove', move, true)
        document.addEventListener('pointerup', end, true)
        document.addEventListener('pointercancel', end, true)
      }
      fingers.add(e.pointerId)
      if (!drag && !e.target.closest('button')) drag = { id: e.pointerId, x: e.clientX, dx: 0 }
      hold('touch', true)
    })
    // 開始倒數（換掉同一類的上一張時，焦點已經先交到這一張的按鈕上了：那就先停著）
    focusCheck()
  },

  // 匯出資料：整份小島存成一個 JSON 檔（設定裡的「匯出資料」、存不進去時的警示列）
  exportData() {
    const blob = new Blob([this.store.exportJSON()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `hiyori-${this.store.today}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  },
  // 意見回饋：開 GitHub 的新議題，先填好版本、畫面、這台最近記到的錯誤（只有訊息和位置，不含任務內容；送出前看得到、可以刪）
  openFeedback() {
    const errs = errorDigest()
    const body = `## 想說的話\n\n\n\n---\n版本：${LATEST.id}\n畫面：${innerWidth}×${innerHeight}・${matchMedia('(pointer: coarse)').matches ? '觸控' : '滑鼠'}・${this.appMode ? 'App 模式' : '小島模式'}${errs ? `\n最近的錯誤：\n${errs}` : ''}`
    window.open(`${FEEDBACK_URL}?title=${encodeURIComponent('意見回饋：')}&body=${encodeURIComponent(body)}`, '_blank', 'noopener')
  },
  // 常駐的警示列（存不進去、這個分頁的 App 比較舊）：問題解決之前一直留著，不會自己消失。
  // key 一樣的換掉；content 是 null 就收起來。content：{ icon, title, sub, actions: [{ label, run, soft }] }
  alertBar(key, content) {
    const box = $('#alerts')
    const old = box.querySelector(`[data-key="${key}"]`)
    if (!content) return void old?.remove()
    const el = document.createElement('div')
    el.className = 'alert-bar glass'
    el.dataset.key = key
    el.innerHTML = `<div class="t-icon">${esc(content.icon || '!')}</div><div class="ab-text"><b>${esc(content.title)}</b><small>${esc(content.sub || '')}</small></div><div class="ab-acts"></div>`
    for (const a of content.actions || []) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `toast-act${a.soft ? ' soft' : ''}`
      b.textContent = a.label
      b.addEventListener('click', () => a.run())
      el.querySelector('.ab-acts').append(b)
    }
    if (old) old.replaceWith(el)
    else box.append(el)
    // 警示列有多高（--alerts-h）：快速記錄這種靠上放的卡片往下讓，右上的 × 不會被蓋住
    if (!this._alertsRO && typeof ResizeObserver === 'function') {
      this._alertsRO = new ResizeObserver(() => document.documentElement.style.setProperty('--alerts-h', box.children.length ? `${Math.ceil(box.getBoundingClientRect().height) + 8}px` : '0px'))
      this._alertsRO.observe(box)
    }
  },

  // ── 通知 ──
  // action：{ label, run }，toast 右邊多一顆按鈕（例如「重新整理」）
  // actions：好幾顆按鈕 [{ label, run, soft }]（排在下面一列；soft 是次要的樣子）。按了就把這張收掉
  // tag：同一類的提示只留最新的一張（番茄鐘的：上一張的按鈕在狀態變了以後就不能按了）
  toast({ icon = '花', title, sub = '', stamp = false, ms = 3400, action = null, actions = null, tag = '' }) {
    // 同一類的上一張：新的直接換在它的位置上（不會先空一格再從最下面冒出來）
    const old = tag ? $$('#toasts .toast:not(.out)').find((x) => x.dataset.tag === tag) : null
    if (tag) for (const x of $$('#toasts .toast')) if (x.dataset.tag === tag && x !== old) x.remove()
    const el = document.createElement('div')
    el.className = 'toast'
    if (tag) el.dataset.tag = tag
    el.innerHTML = `${stamp ? `<div class="stamp-k">${esc(icon)}</div>` : `<div class="t-icon">${esc(icon)}</div>`}<div><b>${esc(title)}</b><small>${esc(sub)}</small></div>`
    if (action) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'toast-act'
      b.textContent = action.label
      b.addEventListener('click', () => action.run())
      el.append(b)
      el.classList.add('has-act')
    }
    if (actions?.length) {
      const row = document.createElement('div')
      row.className = 'toast-acts'
      for (const a of actions) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = `toast-act${a.soft ? ' soft' : ''}`
        b.textContent = a.label
        b.addEventListener('click', () => {
          const home = el.contains(document.activeElement) ? this._toastHome(el) : null
          el.remove()
          a.run()
          // 按下去的那顆跟著提示卡不見了、做的事也沒有把焦點移到別處（還掉在 body）：交回進來之前的地方
          const f = document.activeElement
          if (home?.isConnected && (!f || f === document.body)) home.focus({ preventScroll: true })
        })
        row.append(b)
      }
      el.append(row)
      el.classList.add('has-act', 'acts')
    }
    // 記下焦點是從哪裡移進這一張的（從另一張移過來的，接那一張記的）：收掉時交回那裡
    if (el.classList.contains('has-act')) {
      el.addEventListener('focusin', (e) => {
        const r = e.relatedTarget
        if (!r || el.contains(r)) return
        el._from = r.closest?.('.toast') ? r.closest('.toast')._from : r
      })
    }
    // 正在某個新增表單裡打字（任務、日程那一行）：提示放到表單下面，不要蓋住正在打的字
    const box = $('#toasts')
    box.style.top = ''
    const r = document.activeElement?.closest?.('.add-form')?.getBoundingClientRect()
    if (r?.height) {
      const top = parseFloat(getComputedStyle(box).top) || 0
      const mid = innerWidth / 2
      if (r.top < top + 64 && r.bottom > top && r.left < mid + 170 && r.right > mid - 170) box.style.top = `${Math.round(r.bottom + 8)}px`
    }
    if (old?.isConnected) {
      clearTimeout(old._life)
      // 焦點在舊的那一張的按鈕上：交給新的那一張同一個位置的按鈕（沒有按鈕就交回進來之前的地方）
      const at = [...old.querySelectorAll('button')].indexOf(document.activeElement)
      el._from = old._from
      old.replaceWith(el)
      if (at >= 0) (el.querySelectorAll('button')[at] || el.querySelector('button') || this._toastHome(el))?.focus({ preventScroll: true })
    } else box.append(el)
    // 同時最多三張：一口氣來很多（升級、成就、新的花、每日任務…）時從最舊的開始收，不要疊滿半個畫面。
    // 有按鈕的（就寢提醒的「挑明天的第一件」、到點的「▶ 開始專注」）先不收：不會被一串慶祝擠掉、來不及按——
    // 都是有按鈕的時候最多多留一張，再多才從最舊的收。正停在上面、手指按著、焦點在裡面的（held）不收，但照樣算一張
    const shown = $$('#toasts .toast:not(.out):not(.busy)').filter((x) => x !== el)
    const free = shown.filter((x) => !x.classList.contains('held'))
    let extra = shown.length + 1 - 3
    for (const x of free.filter((x) => !x.classList.contains('has-act')).slice(0, Math.max(0, extra))) {
      this._dropToast(x, true)
      extra--
    }
    for (const x of free.filter((x) => x.classList.contains('has-act')).slice(0, Math.max(0, extra - 1))) this._dropToast(x, true)
    if (el.classList.contains('has-act')) {
      // 正在用鍵盤操作（焦點畫著外框、不是在打字）：留久一點，來得及用 Tab 移過去（移進來之後就不會收）
      const a = document.activeElement
      if (a?.matches?.(':focus-visible') && !a.matches('input, textarea, select, [contenteditable]')) ms = Math.max(ms * 2, 20000)
      // 有按鈕、留得比較久的：下面一條細線慢慢縮短，看得出還剩多久
      if (ms >= 6000) {
        el.classList.add('timed')
        el.style.setProperty('--life', `${ms}ms`)
      }
      this._holdToast(el, ms)
    } else el._life = setTimeout(() => this._dropToast(el), ms)
  },

}
