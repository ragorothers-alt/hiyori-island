import './mottos.css'
import { $, $$, esc, armConfirm, editing, inlineEdit, pickOne, setHTML } from './dom.js'
import { MOTTO_EVERY, MOTTO_EXAMPLES, MOTTO_LEN, MOTTO_MAX, activeMottos, mottoAt } from '../mottos.js'

// 警語：自己寫給自己的話。
// MottosView：紀錄頁的那一張卡（寫、改、先收著、刪，多久提醒一次、要不要放在面板上方）
// MottoBar：面板上方輪流放一句（每 15 分鐘換一句，點一下換下一句，× 今天先收起來）
// 醒著的時候定時提醒在 reminders.js，提醒時もち或ふじ念出來（main.js）

const HIDE_KEY = 'hiyori-motto-hide' // 今天先收起來：記今天的日期（只在這台裝置）
const EVERY_TEXT = { 0: '不提醒', 30: '30 分', 60: '1 小時', 120: '2 小時', 180: '3 小時' }

export class MottosView {
  constructor(root, store, hooks = {}) {
    this.root = root
    this.store = store
    this.hooks = hooks
    root.innerHTML = `<section class="mt-root" aria-labelledby="mtTitle">
      <h3 class="sec-title" id="mtTitle">警語<small>いましめ</small><span class="count" data-r="count"></span></h3>
      <p class="mt-lead">寫幾句提醒自己的話。會輪流放在面板最上面，醒著的時候也會定時提醒你一句</p>
      <form class="add-form mt-add" autocomplete="off">
        <input name="text" maxlength="${MOTTO_LEN}" placeholder="例如：先做最重要的那一件" aria-label="新的警語（Enter 加入）" />
        <button class="btn-primary" type="submit">加入</button>
      </form>
      <p class="mt-err" data-r="err" role="alert" hidden></p>
      <div data-r="examples"></div>
      <ul class="mt-list" data-r="list"></ul>
      <div class="mt-set" data-r="set"></div>
    </section>`
    this.el = {}
    for (const n of $$('[data-r]', root)) this.el[n.dataset.r] = n
    this.form = $('.mt-add', root)
    root.addEventListener('submit', (e) => {
      e.preventDefault()
      this._add($('input', this.form).value)
    })
    root.addEventListener('click', (e) => this._click(e))
    root.addEventListener('input', (e) => {
      if (e.target.closest('.mt-add')) this._err('')
    })
  }

  refresh() {
    this.render()
  }

  _err(text) {
    this.el.err.textContent = text
    this.el.err.hidden = !text
  }

  _add(raw) {
    const text = String(raw || '').trim()
    if (!text) return $('input', this.form).focus()
    const s = this.store
    if (s.state.mottos.length >= MOTTO_MAX) return this._err(`最多 ${MOTTO_MAX} 句：先刪掉幾句不需要的吧`)
    if (s.state.mottos.some((m) => m.text === text.replace(/\s+/g, ' ').slice(0, MOTTO_LEN))) return this._err('已經有這一句了')
    if (!s.addMotto(text)) return this._err('沒有加成功，再試一次')
    $('input', this.form).value = ''
    this._err('')
    $('input', this.form).focus()
  }

  _click(e) {
    const b = e.target.closest('[data-act]')
    if (!b || !this.root.contains(b)) return
    const s = this.store
    const id = b.closest('[data-id]')?.dataset.id
    switch (b.dataset.act) {
      case 'example':
        return this._add(b.dataset.v)
      case 'edit': {
        const m = s.state.mottos.find((x) => x.id === id)
        if (!m) return
        return inlineEdit(b, m.text, (v) => {
          if (!s.updateMotto(id, v)) this.render()
        }, MOTTO_LEN)
      }
      case 'toggle':
        return s.toggleMotto(id)
      case 'del':
        return armConfirm(b, '再按一次刪掉', () => s.deleteMotto(id))
      case 'every':
        s.setSetting('mottoEvery', +b.dataset.v)
        return this.render()
      case 'bar':
        s.setSetting('mottoBar', !s.state.settings.mottoBar)
        this.hooks.mottoBar?.()
        return this.render()
    }
  }

  render() {
    // 正在改某一句：先不重畫（改完會再畫）
    if (editing(this.el.list)) return
    const s = this.store
    const list = s.state.mottos
    const on = activeMottos(list).length
    this.el.count.textContent = list.length ? (on === list.length ? `${list.length}` : `${on} / ${list.length}`) : ''
    // 還沒寫過：給幾句範例，點一下就加
    const used = new Set(list.map((m) => m.text))
    const ex = MOTTO_EXAMPLES.filter((t) => !used.has(t))
    setHTML(this.el.examples, list.length < 3 && ex.length
      ? `<div class="mt-ex" role="group" aria-label="範例，點一下就加"><small>不知道寫什麼？</small>${ex.map((t) => `<button type="button" class="chip-toggle" data-act="example" data-v="${esc(t)}">＋ ${esc(t)}</button>`).join('')}</div>`
      : '')
    setHTML(this.el.list, list
      .map((m) => `<li class="mt-item${m.on ? '' : ' off'}" data-id="${esc(m.id)}">
        <i class="stamp-k mt-k" aria-hidden="true">戒</i>
        <button type="button" class="mt-text" data-act="edit" title="點一下改字">${esc(m.text)}</button>
        <button type="button" class="chip-toggle" data-act="toggle" aria-pressed="${!m.on}" title="${m.on ? '先收著：不輪播、不提醒' : '拿出來：照常輪播、提醒'}">${m.on ? '收著' : '拿出來'}</button>
        <button type="button" class="chip-toggle danger" data-act="del">刪除</button>
      </li>`)
      .join(''))
    const every = s.state.settings.mottoEvery
    const bar = s.state.settings.mottoBar
    setHTML(this.el.set, list.length
      ? `<div class="set-row theme-row"><div><b>多久提醒一次</b><small>${every ? `醒著的時候（作息的起床到就寢）每 ${EVERY_TEXT[every]}，もち或ふじ念一句；專注中不打擾` : '不定時提醒，只放在面板上方'}</small></div>
          <div class="seg" role="group" aria-label="警語多久提醒一次">${MOTTO_EVERY.map((v) => `<button type="button" data-act="every" data-v="${v}" aria-pressed="${v === every}" class="${v === every ? 'on' : ''}">${EVERY_TEXT[v]}</button>`).join('')}</div></div>
        <div class="set-row"><div><b>放在面板上方</b><small>每 15 分鐘換一句，點一下換下一句</small></div><button type="button" class="chip-toggle${bar ? ' on' : ''}" data-act="bar" aria-pressed="${bar}">${bar ? '開' : '關'}</button></div>`
      : '')
    pickOne($$('[data-act="every"]', this.el.set), (x) => +x.dataset.v === every)
  }
}

export class MottoBar {
  constructor(el, store) {
    this.el = el
    this.store = store
    this.shift = 0
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]')
      if (!b) return
      if (b.dataset.act === 'next') {
        this.shift++
        this.render()
      } else if (b.dataset.act === 'hide') {
        try {
          localStorage.setItem(HIDE_KEY, this.store.today)
        } catch {}
        this.render()
      }
    })
    // 每 15 分鐘換一句：每分鐘看一下輪到的是不是同一句
    setInterval(() => this.render(), 60000)
  }

  _hiddenToday() {
    try {
      return localStorage.getItem(HIDE_KEY) === this.store.today
    } catch {
      return false
    }
  }

  render() {
    const s = this.store
    const m = s.state.settings.mottoBar && !this._hiddenToday() ? mottoAt(s.state.mottos, Date.now(), this.shift) : null
    this.el.hidden = !m
    if (!m) return setHTML(this.el, '')
    const many = activeMottos(s.state.mottos).length > 1
    setHTML(this.el, `<i class="stamp-k mt-k" aria-hidden="true">戒</i>
      <p class="mb-text" title="寫給自己的警語">${esc(m.text)}</p>
      ${many ? '<button type="button" class="mb-btn" data-act="next" aria-label="換下一句警語" title="換下一句">›</button>' : ''}
      <button type="button" class="mb-btn" data-act="hide" aria-label="今天先把警語收起來" title="今天先收起來（明天再出現）">×</button>`)
  }
}
