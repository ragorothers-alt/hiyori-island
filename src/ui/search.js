// 找找看：在任何分頁都叫得出來（Ctrl／⌘＋K、/、日期列和 Dock 上的放大鏡）。
// 一行字找任務（哪一天的都找）、日程、專案、生活記錄；任務可以直接打勾，點一下打開（任務、日程是編輯面板，專案是詳情）。
// ↑↓ 選、Enter 打開選到的那一筆。找的規則在 src/search.js
import { $, esc, ICON } from './dom.js'
import { searchAll } from '../search.js'
import { queryTerms, markHTML } from '../projectSearch.js'
import { tagOf } from '../theme.js'
import { parseDate, floating } from '../store.js'
import { timeRange } from '../parse.js'
import { lifeKindOf } from '../data/life.js'
import './search.css'

const GROUPS = [
  ['task', '任務'],
  ['event', '日程'],
  ['project', '專案'],
  ['life', '生活記錄'],
]
const WEEK = '日一二三四五六'

export class SearchView {
  // hooks：
  //   state() → store.state；today() → 今天；external() → 匯入的行事曆日程（唯讀）
  //   toggleTask(id)、open(result)（打開那一筆；會先把這張收掉）
  //   projectName(id)、isExternal(event)
  constructor(root, hooks) {
    this.root = root
    this.hooks = hooks
    this.q = ''
    this.sel = 0
    this.flat = []
    this.el = { input: $('#findInput', root), list: $('#findList', root), tip: $('#findTip', root) }
    this.el.input.addEventListener('input', () => {
      this.q = this.el.input.value
      this.sel = 0
      this.render()
    })
    this.el.input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!this.flat.length) return
        this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.flat.length) % this.flat.length
        this._mark(true)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const r = this.flat[this.sel]
        if (r) this.hooks.open(r)
      }
    })
    $('#findClose', root).addEventListener('click', () => this.close())
    // 點卡片外面（灰色的地方）收起來
    root.addEventListener('click', (e) => {
      if (e.target === root) this.close()
    })
    this.el.list.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]')
      const row = b?.closest('[data-i]')
      if (!row) return
      const r = this.flat[+row.dataset.i]
      if (!r) return
      if (b.dataset.act === 'toggle') {
        this.hooks.toggleTask(r.item.id)
        this.render()
        // 打勾之後焦點留在同一件的勾勾上（重畫換了新的按鈕）
        this.el.list.querySelector(`[data-i="${row.dataset.i}"] [data-act="toggle"]`)?.focus({ preventScroll: true })
      } else this.hooks.open(r)
    })
  }

  get isOpen() {
    return !this.root.hidden
  }
  // text：一打開就填好的字（從專案頁的搜尋框帶過來）
  open(text) {
    if (!this.isOpen) {
      this.root.hidden = false
      if (text != null) this.el.input.value = text
      this.q = this.el.input.value
      this.sel = 0
    }
    this.render()
    this.el.input.focus({ preventScroll: true })
    this.el.input.select()
  }
  close() {
    this.root.hidden = true
  }

  render() {
    const { list, tip } = this.el
    const today = this.hooks.today()
    const r = searchAll(this.hooks.state(), this.q, { today, external: this.hooks.external() })
    this.flat = []
    if (!r) {
      list.innerHTML = ''
      tip.textContent = '任務（哪一天的都找）、日程、專案、生活記錄。空白隔開幾個字可以縮小範圍；↑↓ 選、Enter 打開'
      return
    }
    const terms = queryTerms(this.q)
    let html = ''
    for (const [k, label] of GROUPS) {
      if (!r[k].length) continue
      html += `<div class="fd-h">${label}</div>`
      for (const x of r[k]) {
        const i = this.flat.push(x) - 1
        html += this._row(x, i, terms, today)
      }
    }
    list.innerHTML = html
    const shown = this.flat.length
    tip.textContent = !shown ? `找不到「${this.q.trim()}」。換個說法，或少打幾個字試試` : r.total > shown ? `找到 ${r.total} 筆，先列最相關的 ${shown} 筆：多打幾個字縮小範圍` : ''
    this._mark(false)
  }

  _row(x, i, terms, today) {
    const mk = (t) => markHTML(t, terms)
    const hit = x.hit ? `<small class="fd-hit"><b>${esc(x.hit.kind)}</b>${mk(x.hit.text)}</small>` : ''
    if (x.kind === 'task') {
      const t = x.item
      const c = tagOf(t.tag).color
      const meta = [this._when(t, today), t.at && !t.done ? t.at : '', t.project ? this.hooks.projectName(t.project) : '', t.star && !t.done ? '★ 本命' : ''].filter(Boolean)
      return `<div class="fd-row${t.done ? ' done' : ''}" data-i="${i}">
        <button type="button" class="check" data-act="toggle" aria-label="${t.done ? '改回未完成' : '完成'}「${esc(t.title)}」" aria-pressed="${!!t.done}" style="--c:${c}">${ICON.check}</button>
        <button type="button" class="fd-main" data-act="open"><span class="fd-t">${mk(t.title)}</span><small class="fd-m">${meta.map(esc).join('・')}</small>${hit}</button>
      </div>`
    }
    if (x.kind === 'event') {
      const e = x.item
      const when = `${this._day(e.date, today)}${e.allDay ? '・整天' : ` ${timeRange(e.start, e.link ? this._lastEnd(e) : e.end)}`}`
      return `<div class="fd-row" data-i="${i}"><span class="fd-dot" aria-hidden="true">環</span>
        <button type="button" class="fd-main" data-act="open"><span class="fd-t">${mk(e.title)}</span><small class="fd-m">${esc(when)}${this.hooks.isExternal(e) ? '・匯入的行事曆' : ''}</small>${hit}</button></div>`
    }
    if (x.kind === 'project') {
      const p = x.item
      return `<div class="fd-row" data-i="${i}"><span class="fd-dot" aria-hidden="true">案</span>
        <button type="button" class="fd-main" data-act="open"><span class="fd-t">${mk(p.name)}</span><small class="fd-m">${p.archived ? '落成的專案' : '專案'}</small>${hit}</button></div>`
    }
    const k = lifeKindOf(x.item.kind)
    return `<div class="fd-row" data-i="${i}"><span class="fd-dot" aria-hidden="true" style="--c:${k.color}">${esc(k.kanji)}</span>
      <button type="button" class="fd-main" data-act="open"><span class="fd-t">${mk(x.item.text || String(x.item.amount || ''))}</span><small class="fd-m">${esc(`${this._day(x.date, today)} ${x.item.t || ''}・${k.label}`)}</small></button></div>`
  }
  // 跨過午夜的日程：列的是第一段，結束寫隔天那段的時間
  _lastEnd(e) {
    const last = this.hooks.state().events.filter((x) => x.link === e.link).sort((a, b) => b.date.localeCompare(a.date))[0]
    return last && last !== e ? last.end : e.end
  }
  _day(date, today) {
    if (date === today) return '今天'
    const d = parseDate(date)
    const diff = Math.round((d - parseDate(today)) / 864e5)
    if (diff === 1) return '明天'
    if (diff === -1) return '昨天'
    const y = d.getFullYear() !== parseDate(today).getFullYear() ? `${d.getFullYear()}/` : ''
    return `${y}${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`
  }
  _when(t, today) {
    if (t.done) return `完成於 ${t.doneAt ? this._day(dateOf(t.doneAt), today) : this._day(t.date, today)}`
    if (floating(t)) return '長期'
    return t.date < today ? `逾期・${this._day(t.date, today)}` : this._day(t.date, today)
  }
  // 選到的那一筆：框起來；用方向鍵移的才捲過去
  _mark(scroll) {
    const rows = this.el.list.querySelectorAll('.fd-row')
    rows.forEach((row, i) => row.classList.toggle('sel', i === this.sel))
    if (scroll) rows[this.sel]?.scrollIntoView({ block: 'nearest' })
  }
}

const dateOf = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
