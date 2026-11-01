import './coach.css'
import { $, esc, ICON, armConfirm } from './dom.js'
import { DATE_KINDS } from '../theme.js'

// 任務頁最上面的「だいじな日」：考試、截止日、紀念日的倒數小卡；專案的截止日也一起列（唯讀）
export class DatesView {
  constructor(root, store, hooks) {
    this.root = root
    this.store = store
    this.hooks = hooks
    this.adding = false
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
      const d = this.store.addDate({ title: f.elements.title.value, date: f.elements.date.value, kind: this.kind })
      if (!d) return
      this.adding = false
      document.activeElement?.blur()
      this.render()
    })
  }

  _click(e) {
    const b = e.target.closest('[data-act]')
    if (!b) return
    const act = b.dataset.act
    if (act === 'add') {
      this.adding = !this.adding
      this.render()
      if (this.adding) $('input[name="title"]', this.root)?.focus()
    } else if (act === 'cancel') {
      this.adding = false
      this.render()
    } else if (act === 'kind') {
      this.kind = b.dataset.v
      for (const x of this.root.querySelectorAll('[data-act="kind"]')) x.classList.toggle('on', x === b)
    } else if (act === 'del') armConfirm(b, ICON.check, () => this.store.deleteDate(b.dataset.id))
    else if (act === 'project') this.hooks.setTab?.('projects')
  }

  // store 一變就會呼叫：正在填新增表單時先不重畫
  refresh() {
    if (this.root.contains(document.activeElement) && document.activeElement.matches('input')) return
    this.render()
  }

  render() {
    const s = this.store
    const list = s.upcomingDates(8)
    const when = (n) => (n === 0 ? '就是今天' : n === 1 ? '明天' : `還有 ${n} 天`)
    const chips = list
      .map((d) => {
        const k = DATE_KINDS[d.kind]
        const cls = `dt-chip k-${d.kind}${d.days <= 3 ? ' soon' : ''}`
        const del = d.project ? '' : `<button type="button" class="dt-del" data-act="del" data-id="${esc(d.id)}" title="刪除">${ICON.del}</button>`
        return `<div class="${cls}"${d.project ? ' data-act="project" role="button" tabindex="0"' : ''} title="${esc(d.title)}・${d.date}${d.project ? '（專案截止日）' : ''}">
          <span class="dt-k">${d.project ? '案' : k.kanji}</span><span class="dt-t"><b>${esc(d.title)}</b><small>${when(d.days)}</small></span>${del}</div>`
      })
      .join('')
    const form = this.adding
      ? `<form class="dt-form" autocomplete="off">
          <input name="title" maxlength="30" placeholder="名稱，例如：期中考" required />
          <input name="date" type="date" min="${s.today}" required />
          <div class="seg">${Object.entries(DATE_KINDS)
            .map(([id, k]) => `<button type="button" data-act="kind" data-v="${id}" class="${this.kind === id ? 'on' : ''}">${k.label}</button>`)
            .join('')}</div>
          <button type="button" class="btn-ghost" data-act="cancel">取消</button><button class="btn-primary" type="submit">加入</button>
        </form>`
      : ''
    this.root.innerHTML = `<div class="dt-row">${chips}<button type="button" class="dt-add${list.length ? '' : ' wide'}" data-act="add">${list.length ? '＋' : '＋ 重要日子（考試、截止日…）'}</button></div>${form}`
  }
}
