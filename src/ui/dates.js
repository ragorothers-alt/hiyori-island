import './coach.css'
import { $, esc, ICON, armConfirm, pickOne } from './dom.js'
import { DATE_KINDS, DUE_KINDS } from '../theme.js'

// 日程頁的「だいじな日」（新增日程表單下面）：考試、截止日、紀念日的倒數小卡；專案的截止日和里程碑期限也一起列（唯讀，點了打開那個專案）
export class DatesView {
  constructor(root, store, hooks) {
    this.root = root
    this.store = store
    this.hooks = hooks
    this.adding = false
    // 正在改的那一筆（自己記的重要日子；表單跟新增同一個）
    this.editing = null
    this.kind = 'exam'
    root.addEventListener('click', (e) => this._click(e))
    // 專案截止日的小卡是 role="button" 的 div：Enter、空白鍵也要能按
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) {
        e.preventDefault()
        this._click(e)
      }
    })
    root.addEventListener('submit', (e) => {
      e.preventDefault()
      const f = e.target
      const v = { title: f.elements.title.value, date: f.elements.date.value, kind: this.kind }
      const id = this.editing
      const ok = id ? this.store.updateDate(id, v) : this.store.addDate(v)
      if (!ok) return
      this.adding = false
      this.editing = null
      document.activeElement?.blur()
      this.render()
      // 改好了：焦點回到那一張（不在最近 8 個裡的話展開全部）
      if (id) this._focusChip(id)
    })
  }

  // 改某一筆（日曆那天的詳情裡按「改」也走這裡）
  edit(id) {
    const d = this.store.state.dates.find((x) => x.id === id)
    if (!d) return false
    this.adding = true
    this.editing = id
    this.kind = d.kind
    this.render()
    const f = $('form.dt-form', this.root)
    f.elements.title.value = d.title
    f.elements.date.value = d.date
    f.scrollIntoView({ block: 'nearest' })
    f.elements.title.focus()
    return true
  }
  _focusChip(id) {
    let el = this.root.querySelector(`.dt-chip[data-id="${CSS.escape(id)}"]`)
    if (!el && !this.all && this.store.state.dates.some((x) => x.id === id && x.date >= this.store.today)) {
      this.all = true
      this.render()
      el = this.root.querySelector(`.dt-chip[data-id="${CSS.escape(id)}"]`)
    }
    ;(el || $('.dt-add[data-act="add"]', this.root))?.focus({ preventScroll: true })
  }

  _click(e) {
    const b = e.target.closest('[data-act]')
    if (!b) return
    const act = b.dataset.act
    if (act === 'add') {
      // 正在改某一筆時按「＋ 新增」：換成新增的空白表單
      this.adding = this.editing ? true : !this.adding
      this.editing = null
      this.render()
      if (this.adding) $('input[name="title"]', this.root)?.focus()
    } else if (act === 'edit') this.edit(b.dataset.id)
    else if (act === 'cancel') {
      const id = this.editing
      this.adding = false
      this.editing = null
      this.render()
      if (id) this._focusChip(id)
    } else if (act === 'kind') {
      this.kind = b.dataset.v
      pickOne(this.root.querySelectorAll('[data-act="kind"]'), (x) => x === b)
    } else if (act === 'del') armConfirm(b, ICON.check, () => this.store.deleteDate(b.dataset.id))
    else if (act === 'project') this.hooks.openProject?.(b.dataset.id, b.dataset.sec)
    else if (act === 'all') {
      this.all = !this.all
      this.render()
      $('[data-act="all"]', this.root)?.focus()
    }
  }

  // store 一變就會呼叫：正在填新增表單時先不重畫
  refresh() {
    if (this.root.contains(document.activeElement) && document.activeElement.matches('input')) return
    this.render()
  }

  render() {
    const s = this.store
    // 平常只列最近 8 個；更多的「全部」展開（一年以後的也列）
    const every = s.upcomingDates(Infinity, Infinity)
    const list = this.all ? every : every.slice(0, 8)
    const when = (n) => (n === 0 ? '就是今天' : n === 1 ? '明天' : `還有 ${n} 天`)
    const chips = list
      .map((d) => {
        const k = DUE_KINDS[d.kind]
        const cls = `dt-chip k-${d.kind}${d.days <= 3 ? ' soon' : ''}`
        const ro = d.project || d.pid
        const del = ro ? '' : `<button type="button" class="dt-del" data-act="del" data-id="${esc(d.id)}" title="刪除">${ICON.del}</button>`
        // 專案的截止日、里程碑：點了打開那個專案；自己記的：點了改
        const open = d.project
          ? ` data-act="project" data-id="${esc(d.id)}" role="button" tabindex="0"`
          : d.pid ? ` data-act="project" data-id="${esc(d.pid)}" data-sec="ms" role="button" tabindex="0"` : ` data-act="edit" data-id="${esc(d.id)}" role="button" tabindex="0" aria-label="改「${esc(d.title)}」，${when(d.days)}"`
        const note = d.project ? '（專案截止日）' : d.pid ? `（「${d.projectName}」的里程碑）` : '・點一下可以改'
        return `<div class="${cls}"${open} title="${esc(d.title)}・${d.date}${esc(note)}">
          <span class="dt-k">${d.project ? '案' : k.kanji}</span><span class="dt-t"><b>${esc(d.title)}</b><small>${when(d.days)}</small></span>${del}</div>`
      })
      .join('')
    const editing = this.editing && s.state.dates.find((x) => x.id === this.editing)
    if (this.editing && !editing) {
      this.editing = null
      this.adding = false
    }
    // 新增的從今天起；改的時候不限（記錯了，改到更早的日子也行）
    const min = editing ? '' : s.today
    const form = this.adding
      ? `<form class="dt-form" autocomplete="off"${editing ? ` data-edit="${esc(editing.id)}"` : ''}>
          ${editing ? '<b class="dt-f-h">改重要日子</b>' : ''}
          <input name="title" maxlength="30" placeholder="名稱，例如：期中考" aria-label="重要日子的名稱" required />
          <input name="date" type="date"${min ? ` min="${min}"` : ''} required />
          <div class="seg">${Object.entries(DATE_KINDS)
            .map(([id, k]) => `<button type="button" data-act="kind" data-v="${id}" class="${this.kind === id ? 'on' : ''}" aria-pressed="${this.kind === id}">${k.label}</button>`)
            .join('')}</div>
          <button type="button" class="btn-ghost" data-act="cancel">取消</button><button class="btn-primary" type="submit">${editing ? '存好' : '加入'}</button>
        </form>`
      : ''
    // 標題一行（新增鈕固定在右邊，小卡再多也看得到），小卡在下一行
    const more = every.length > 8 ? `<button type="button" class="dt-add dt-all" data-act="all" aria-expanded="${!!this.all}">${this.all ? '收起來' : `全部 ${every.length} 個`}</button>` : ''
    // 表單開著時重畫（按「全部」、資料剛變）：同一張表單打到一半的字留著
    const was = $('form.dt-form', this.root)
    const keep = was && (was.dataset.edit || '') === (editing?.id || '') ? { title: was.elements.title.value, date: was.elements.date.value } : null
    this.root.innerHTML = `<div class="dt-h"><span class="dt-lb">重要日子</span>${list.length ? '' : '<small>考試、截止日、紀念日的倒數</small>'}${more}<button type="button" class="dt-add" data-act="add" aria-expanded="${this.adding && !editing}">＋ 新增</button></div>${list.length ? `<div class="dt-row${this.all ? ' all' : ''}">${chips}</div>` : ''}${form}`
    const f = keep && $('form.dt-form', this.root)
    if (f) {
      f.elements.title.value = keep.title
      f.elements.date.value = keep.date
    }
  }
}
