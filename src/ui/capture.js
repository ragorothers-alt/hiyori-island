// 快速記錄：在任何分頁都叫得出來的一張小卡（Dock 的＋、鍵盤 N、主畫面圖示長按的捷徑）。
// 一行字、Enter 記下，輸入框留著接著記下一件；剛記的幾筆列在下面，記錯了可以復原。
// 兩種：「待辦」照任務頁那一行的寫法（「明天 15:00 開會」會變成日程）、「生活記錄」記在今天的生活記錄。
// 卡片靠上放：手機的鍵盤從下面出來，不會蓋到。
import { $, esc } from './dom.js'
import { LIFE_KINDS, lifeKindOf } from '../data/life.js'
import './capture.css'

const KEEP = 5

export class CaptureView {
  // hooks：
  //   preview(text) → 預覽的小標籤 [字串]（第一個是「日程」時會上色）
  //   add(text) → { icon, title, sub, undo } 或 null（沒有標題）
  //   log(kind, text) → 同上（生活記錄）；logPreview(kind, text) → [字串]
  //   tags() → [{ id, label, color }]、tag() 現在選的分類、setTag(id)
  constructor(root, hooks) {
    this.root = root
    this.hooks = hooks
    this.mode = 'todo'
    this.kind = 'note'
    this.items = [] // 這次打開後記下的（新的在前面）
    this.el = {
      form: $('#capForm', root), input: $('#capInput', root), preview: $('#capPreview', root), tags: $('#capTags', root),
      kinds: $('#capKinds', root), done: $('#capDone', root), tip: $('#capTip', root), mode: $('#capMode', root),
    }
    const el = this.el
    el.kinds.innerHTML = LIFE_KINDS.map((k) => `<button type="button" data-kind="${k.key}" style="--c:${k.color}" aria-pressed="false"><b>${k.kanji}</b>${k.label}</button>`).join('')
    el.form.addEventListener('submit', (e) => {
      e.preventDefault()
      this._submit()
    })
    el.input.addEventListener('input', () => this._preview())
    el.mode.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]')
      if (b) this.setMode(b.dataset.v)
    })
    el.kinds.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-kind]')
      if (!b) return
      this.kind = b.dataset.kind
      this._paint()
      el.input.focus()
    })
    el.tags.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tag]')
      if (!b) return
      hooks.setTag(b.dataset.tag)
      this._paint()
      el.input.focus()
    })
    el.done.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-undo]')
      if (b) this._undo(+b.dataset.undo)
    })
    root.addEventListener('click', (e) => {
      // 點卡片外面、×：關掉（打到一半的字留著，下次打開還在）
      if (e.target === root || e.target.closest('#capClose')) this.close()
    })
  }

  get isOpen() {
    return !this.root.hidden
  }

  // mode：'todo'／'log'。沒給：每次打開都從「待辦」開始（按 N 就打字的手感不會被上次的選擇改掉）
  open(mode) {
    if (!this.isOpen) {
      this.mode = mode === 'log' ? 'log' : 'todo'
      this.items = []
      this.root.hidden = false
    }
    this._paint()
    this._renderDone()
    // 同一下點擊裡就把焦點放進去：手機的鍵盤才會跟著出來
    this.el.input.focus({ preventScroll: true })
  }
  close() {
    this.root.hidden = true
  }
  toggle() {
    this.isOpen ? this.close() : this.open()
  }

  setMode(mode) {
    this.mode = mode === 'log' ? 'log' : 'todo'
    this._paint()
    this.el.input.focus({ preventScroll: true })
  }

  _paint() {
    const el = this.el
    const log = this.mode === 'log'
    for (const b of el.mode.querySelectorAll('button')) {
      const on = b.dataset.v === this.mode
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', on)
    }
    el.kinds.hidden = !log
    el.tags.hidden = log
    for (const b of el.kinds.querySelectorAll('button')) {
      const on = b.dataset.kind === this.kind
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', on)
    }
    if (!log) {
      const cur = this.hooks.tag()
      el.tags.innerHTML = this.hooks.tags().map((t) => `<button type="button" data-tag="${esc(t.id)}" style="--c:${t.color}" class="${t.id === cur ? 'on' : ''}" aria-pressed="${t.id === cur}"><i></i>${esc(t.label)}</button>`).join('')
    }
    el.input.placeholder = log ? `${lifeKindOf(this.kind).hint}（記在今天）` : '想到什麼就記下來，例如：明天 15:00 開會'
    el.input.setAttribute('aria-label', log ? '記一筆生活記錄' : '記一件待辦')
    el.tip.textContent = log
      ? this.kind === 'spend' ? '寫上金額會一起記：「午餐 120」' : 'Enter 記下，可以接著記下一筆'
      : '寫了時間就是日程；也可以寫「每天」「!高」「#生活」「@專案」。Enter 記下，接著記下一件'
    this._preview()
  }

  _preview() {
    const v = this.el.input.value
    const chips = v.trim() ? (this.mode === 'log' ? this.hooks.logPreview(this.kind, v) : this.hooks.preview(v)) : []
    this.el.preview.hidden = !chips.length
    this.el.preview.innerHTML = chips.map((c, i) => `<span class="${i === 0 && c.endsWith('日程') ? 'kind' : ''}">${esc(c)}</span>`).join('')
  }

  _submit() {
    const el = this.el
    const text = el.input.value
    const r = text.trim() ? (this.mode === 'log' ? this.hooks.log(this.kind, text) : this.hooks.add(text)) : null
    if (!r) {
      // 沒有可以記的（空的、只有日期沒有標題）：晃一下輸入框
      el.form.classList.remove('nudge')
      void el.form.offsetWidth
      el.form.classList.add('nudge')
      el.input.focus()
      return
    }
    el.input.value = ''
    this.items.unshift({ ...r, gone: false })
    this.items = this.items.slice(0, KEEP)
    this._preview()
    this._renderDone(true)
    el.input.focus()
  }

  _undo(i) {
    const it = this.items[i]
    if (!it || it.gone) return
    it.undo?.()
    it.gone = true
    this._renderDone()
    this.el.input.focus()
  }

  _renderDone(fresh = false) {
    this.el.done.hidden = !this.items.length
    this.el.done.innerHTML = this.items
      .map((it, i) => `<li class="${it.gone ? 'gone' : ''}${fresh && i === 0 ? ' fresh' : ''}"><i class="t-icon" aria-hidden="true">${esc(it.icon)}</i><span><b>${esc(it.title)}</b><small>${esc(it.gone ? '已復原' : it.sub)}</small></span>${it.gone || !it.undo ? '' : `<button type="button" class="cap-undo" data-undo="${i}" aria-label="復原：${esc(it.title)}">復原</button>`}</li>`)
      .join('')
  }
}
