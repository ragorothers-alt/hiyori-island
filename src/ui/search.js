// 找找看：在任何分頁都叫得出來（Ctrl／⌘＋K、/、日期列和 Dock 上的放大鏡）。
// 一行字找任務（哪一天的都找）、日程、專案、生活記錄；任務可以直接打勾，點一下打開（任務、日程是編輯面板，專案是詳情）。
// ↑↓ 選、Enter 打開選到的那一筆（報讀軟體念出選到的是哪一筆：#findLive）。找的規則在 src/search.js。
// 開著時資料變了（打勾、別台同步過來）就重找一次：選到的、焦點所在的那一筆照 id 留著
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
  ['setting', '設定'],
]
const WEEK = '日一二三四五六'

// 從設定頁拿現在用的列名。「更多」裡面也找，這台裝置用不到、已經藏起來的項目就略過。
function settingsEntries() {
  const entries = []
  for (const row of document.querySelectorAll('#page-settings .settings .set-row, #page-settings .data-tools button, #backupList')) {
    if (row.closest('[hidden]') || row.parentElement.closest('#backupList')) continue
    const id = row.id || row.querySelector('[id]')?.id
    const title = row.id === 'backupList' ? '備份還原' : (row.querySelector('b') || row).textContent.trim()
    if (id && title) entries.push({ id, title })
  }
  return entries
}

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
    this.page = 1
    this.el = { input: $('#findInput', root), list: $('#findList', root), tip: $('#findTip', root), live: $('#findLive', root) }
    this.el.input.placeholder = '找任務、日程、專案、生活記錄、設定'
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'chip-toggle fd-more'
    more.textContent = '再多看一些'
    more.hidden = true
    this.el.list.after(more)
    this.el.more = more
    more.addEventListener('click', () => {
      const seen = new Set(this.flat.map(keyOf))
      this.page++
      this.render()
      const next = this.flat.findIndex((x) => !seen.has(keyOf(x)))
      if (next >= 0) {
        this.sel = next
        this._mark(true)
        // 焦點回到輸入框（選到新列出來的第一筆）：↑↓ 接著選、Enter 打開，跟平常一樣
        this.el.input.focus({ preventScroll: true })
        this._say(this._label(this.flat[next], next))
      }
    })
    this.el.input.addEventListener('input', () => {
      this.q = this.el.input.value
      this.page = 1
      this.sel = 0
      this.render({ fresh: true })
    })
    this.el.input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!this.flat.length) return
        this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.flat.length) % this.flat.length
        this._mark(true)
        this._say(this._label(this.flat[this.sel], this.sel))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        // 照現在的資料再找一次（別台剛同步過來、改了日子）：打開的是現在的那一筆
        this.render()
        const r = this.flat[this.sel]
        if (r) this._open(r)
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
      const key = keyOf(r)
      if (b.dataset.act === 'toggle') {
        this.sel = +row.dataset.i
        this.hooks.toggleTask(r.item.id)
        this.render()
        // 打勾之後焦點留在同一件的勾勾上（重畫換了新的按鈕，做完的那件也可能換了位置）；
        // 做完的那件排到後面、超出列得下的筆數了：焦點回到輸入框
        const btn = this._row$(key)?.querySelector('[data-act="toggle"]')
        if (btn) btn.focus({ preventScroll: true })
        else this.el.input.focus({ preventScroll: true })
        const t = this.hooks.state().tasks?.find((x) => x.id === r.item.id)
        if (t) this._say(`「${t.title}」${t.done ? '完成了' : '改回未完成'}${btn ? '' : '（排到後面了）'}`)
      } else {
        this.render()
        const now = this.flat.find((x) => keyOf(x) === key)
        if (now) this._open(now)
      }
    })
  }

  _open(result) {
    if (result.kind !== 'setting') return this.hooks.open(result)
    this.close()
    window.hiyori.ui.openSettings()
    const anchor = document.getElementById(result.item.id)
    const row = anchor?.closest('.set-row') || anchor
    if (!row) return
    const more = row.closest('details')
    if (more) more.open = true
    if (!row.matches('button')) row.tabIndex = -1
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'center' })
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
      this.page = 1
      this.sel = 0
    }
    this.render()
    this.el.input.focus({ preventScroll: true })
    this.el.input.select()
  }
  close() {
    this.root.hidden = true
  }
  // 資料變了（store 的 change）：開著的話照現在的資料重找，焦點、選到的那一筆不動
  refresh() {
    if (!this.isOpen) return
    const a = document.activeElement
    const key = this.el.list.contains(a) ? a.closest('[data-key]')?.dataset.key : null
    const act = a?.dataset?.act
    this.render()
    if (!key) return
    // 那一筆不在列表裡了（做完排到後面、被刪掉）：焦點回到輸入框，不掉到頁面最上面
    const el = this._row$(key)?.querySelector(`[data-act="${act}"]`)
    if (el) el.focus({ preventScroll: true })
    else this.el.input.focus({ preventScroll: true })
  }

  // fresh：剛打了字（選第一筆、說找到幾筆）；不然照 id 留著選到的那一筆
  render({ fresh = false } = {}) {
    const { list, tip, more } = this.el
    const today = this.hooks.today()
    const was = fresh ? null : this.flat[this.sel] && keyOf(this.flat[this.sel])
    const r = searchAll(this.hooks.state(), this.q, { today, external: this.hooks.external(), settings: settingsEntries(), page: this.page })
    this.flat = []
    if (!r) {
      list.innerHTML = ''
      more.hidden = true
      tip.textContent = '空白隔開幾個字，或加日期縮小範圍（像「書店 9/23」）。↑↓ 選、Enter 打開'
      if (fresh) this._say('')
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
    if (fresh) list.scrollTop = 0
    const shown = this.flat.length
    if (was) this.sel = Math.max(0, this.flat.findIndex((x) => keyOf(x) === was))
    if (this.sel >= shown) this.sel = 0
    more.hidden = shown >= r.total
    tip.textContent = !shown ? `找不到「${this.q.trim()}」。換個說法，或少打幾個字試試` : !more.hidden ? `找到 ${r.total} 筆，已列出 ${shown} 筆。加日期可以縮小範圍（像 9/23）` : ''
    this._mark(false)
    if (fresh) this._say(shown ? `找到 ${r.total} 筆。${this._label(this.flat[0], 0)}` : tip.textContent)
  }
  // 報讀軟體念的那一句（選到哪一筆、找到幾筆）
  _say(text) {
    if (!this.el.live) return
    this.el.live.textContent = ''
    if (text) requestAnimationFrame(() => (this.el.live.textContent = text))
  }
  _label(x, i) {
    const row = this.el.list.querySelector(`[data-i="${i}"]`)
    const what = { task: '任務', event: '日程', project: '專案', life: '生活記錄', setting: '設定' }[x.kind]
    const main = row?.querySelector('.fd-main')
    const text = [main?.querySelector('.fd-t')?.textContent, main?.querySelector('.fd-m')?.textContent].filter(Boolean).join('，')
    return `第 ${i + 1} 筆，共 ${this.flat.length} 筆：${what}，${text}${x.item.done ? '，已完成' : ''}`
  }
  _row$(key) {
    return this.el.list.querySelector(`[data-key="${CSS.escape(key)}"]`)
  }

  _row(x, i, terms, today) {
    const mk = (t) => markHTML(t, terms)
    const hit = x.hit ? `<small class="fd-hit"><b>${esc(x.hit.kind)}</b>${mk(x.hit.text)}</small>` : ''
    if (x.kind === 'setting') {
      return `<div class="fd-row" data-i="${i}" data-key="${esc(keyOf(x))}"><span class="fd-dot" aria-hidden="true">設</span>
        <button type="button" class="fd-main" data-act="open"><span class="fd-t">${mk(x.item.title)}</span><small class="fd-m">前往設定</small></button></div>`
    }
    if (x.kind === 'task') {
      const t = x.item
      const c = tagOf(t.tag).color
      const meta = [this._when(t, today), t.at && !t.done ? t.at : '', t.project ? this.hooks.projectName(t.project) : '', t.star && !t.done ? '★ 本命' : ''].filter(Boolean)
      return `<div class="fd-row${t.done ? ' done' : ''}" data-i="${i}" data-key="${esc(keyOf(x))}">
        <button type="button" class="check" data-act="toggle" aria-label="${t.done ? '改回未完成' : '完成'}「${esc(t.title)}」" aria-pressed="${!!t.done}" style="--c:${c}">${ICON.check}</button>
        <button type="button" class="fd-main" data-act="open"><span class="fd-t">${mk(t.title)}</span><small class="fd-m">${meta.map(esc).join('・')}</small>${hit}</button>
      </div>`
    }
    if (x.kind === 'event') {
      const e = x.item
      const when = `${this._day(e.date, today)}${e.allDay ? '・整天' : ` ${timeRange(e.start, e.link ? this._lastEnd(e) : e.end)}`}`
      return `<div class="fd-row" data-i="${i}" data-key="${esc(keyOf(x))}"><span class="fd-dot" aria-hidden="true">環</span>
        <button type="button" class="fd-main" data-act="open"><span class="fd-t">${mk(e.title)}</span><small class="fd-m">${esc(when)}${this.hooks.isExternal(e) ? '・匯入的行事曆' : ''}</small>${hit}</button></div>`
    }
    if (x.kind === 'project') {
      const p = x.item
      return `<div class="fd-row" data-i="${i}" data-key="${esc(keyOf(x))}"><span class="fd-dot" aria-hidden="true">案</span>
        <button type="button" class="fd-main" data-act="open"><span class="fd-t">${mk(p.name)}</span><small class="fd-m">${p.archived ? '落成的專案' : '專案'}</small>${hit}</button></div>`
    }
    const k = lifeKindOf(x.item.kind)
    return `<div class="fd-row" data-i="${i}" data-key="${esc(keyOf(x))}"><span class="fd-dot" aria-hidden="true" style="--c:${k.color}">${esc(k.kanji)}</span>
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
    rows.forEach((row, i) => {
      row.classList.toggle('sel', i === this.sel)
      row.querySelector('.fd-main')?.toggleAttribute('aria-current', i === this.sel)
    })
    if (scroll) rows[this.sel]?.scrollIntoView({ block: 'nearest' })
  }
}

// 一筆結果是哪一筆：種類和 id（重找之後照這個認回來）
const keyOf = (x) => `${x.kind}:${x.item?.id ?? ''}`

const dateOf = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
