import './agent.css'
import { esc } from './dom.js'
import { AGENT_MODES } from '../theme.js'

// 自主的ふじ的畫面（什麼時候動在 agentRunner.js）：
//   AgentCard：今日總覽上的那一張。ふじ最近做了什麼（撤銷、開始專注那一件）、等你決定的安排（套用／不用）、下面一行直接跟她說。
//   AgentView：教練分頁的「ふじ」那一頁。完整的對話和她自己整理的紀錄、常用的幾句、自己整理的方式（自動／先問我／關）、她記得的事。
// 兩個都是一直留著的節點（輸入框不跟著重畫，打到一半的字不會不見），只換裡面的內容。

const RUN_NAME = { morning: '整理今天', replan: '重排了今天', capture: '安排新任務', evening: '準備明天', chat: '' }
const MODE_LABEL = { auto: ['自動', '直接安排，可以撤銷'], ask: ['先問我', '看過再套用'], off: ['關', '我開口才動'] }
const HINTS = ['重排今天剩下的', '明天排鬆一點', '把最卡的那件拆小', '這週先顧哪幾件']
const pad = (n) => String(n).padStart(2, '0')
const clock = (at) => {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const when = (at, today) => {
  const d = new Date(at)
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return day === today ? clock(at) : `${d.getMonth() + 1}/${d.getDate()} ${clock(at)}`
}
const short = (s, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const DOTS = '<span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span>'

// 對話和紀錄排成一條：這台的對話，加上不是從這台對話來的紀錄（她自己整理的、別台做的）
export function agentFeed(agent, store, limit = 40) {
  const log = store.state.agent.log
  const byId = new Map(log.map((e) => [e.id, e]))
  const linked = new Set(agent.chat.map((m) => m.entry).filter(Boolean))
  const items = [
    ...agent.chat.map((m) => ({ ...m, e: m.entry ? byId.get(m.entry) || null : null })),
    ...log.filter((e) => !linked.has(e.id) && (e.say || e.changes.length)).map((e) => ({ who: 'fuji', text: e.say, at: e.at, e, auto: e.run !== 'chat' })),
  ]
  return items.sort((a, b) => a.at - b.at).slice(-limit)
}

// ふじ的一則：說的話、做了哪些事、能按的（開始專注、撤銷）、可以直接點的回答
function fujiHTML(m, store, { open = false, max = 4, last = false } = {}) {
  const e = m.e
  const all = e?.changes || []
  const show = open ? all : all.slice(0, max)
  const more = all.length - show.length
  const next = last && e?.next && !e.undone ? store.state.tasks.find((t) => t.id === e.next && !t.done) : null
  const acts = []
  if (next) acts.push(`<button type="button" class="btn-primary ag-go" data-ag="focus" data-id="${esc(next.id)}">專注「${esc(short(next.title, 12))}」</button>`)
  if (e && !e.undone && all.some((c) => c.u)) acts.push(`<button type="button" class="btn-ghost" data-ag="undo" data-id="${esc(e.id)}">撤銷${all.length > 1 ? `這 ${all.length} 項` : ''}</button>`)
  const head = m.auto ? `<small class="ag-when">${RUN_NAME[e.run] || 'ふじ'}・${when(m.at, store.today)}</small>` : ''
  const text = m.text || (all.length ? '整理好了。' : '')
  return `${head}${text ? `<p class="ag-say${m.failed ? ' err' : ''}">${esc(text)}</p>` : ''}
    ${show.length ? `<ul class="ag-did${e.undone ? ' undone' : ''}">${show.map((c) => `<li>${esc(c.t)}</li>`).join('')}${more > 0 ? `<li class="more"><button type="button" class="cm-link" data-ag="more" data-id="${esc(e.id)}">還有 ${more} 項</button></li>` : ''}</ul>` : ''}
    ${e?.undone ? '<small class="ag-undone">已經撤銷</small>' : ''}
    ${acts.length ? `<div class="ag-acts">${acts.join('')}</div>` : ''}
    ${last && m.ask?.length ? `<div class="ag-ask">${m.ask.map((a) => `<button type="button" class="chip-toggle" data-ag="ask" data-v="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : ''}`
}
// 等使用者決定的那一份（mode 是 ask）
function pendingHTML(p, store) {
  return `<small class="ag-when">想${RUN_NAME[p.run]?.replace('了', '') || '調整一下'}・${when(p.at, store.today)}</small>
    ${p.say ? `<p class="ag-say">${esc(p.say)}</p>` : ''}
    <ul class="ag-did plan">${p.lines.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <div class="ag-acts"><button type="button" class="btn-primary ag-go" data-ag="accept">套用</button><button type="button" class="btn-ghost" data-ag="dismiss">不用</button></div>`
}

// 兩個畫面共用的按鈕
function act(view, b) {
  const { agent, store, hooks } = view
  const id = b.dataset.id
  switch (b.dataset.ag) {
    case 'undo': {
      const n = store.agentUndo(id)
      return hooks.toast?.({ icon: '戻', title: n ? `撤銷了 ${n} 項` : '沒有可以撤銷的了', sub: n ? '之後改過的、做完的留著' : '那幾件之後都改過了' })
    }
    case 'focus': return hooks.startFocus?.(id)
    case 'more':
      view.opened.add(id)
      return view.render()
    case 'accept': {
      const e = agent.accept()
      return hooks.toast?.({ icon: '藤', stamp: true, title: e?.changes.length ? `套用了 ${e.changes.length} 項` : '這次沒有可以套用的', sub: e?.changes.length ? '想改回來可以撤銷' : '那幾件之後都改過了' })
    }
    case 'dismiss': return agent.dismiss()
    case 'ask': return view.send(b.dataset.v)
    case 'now': return agent.now(b.dataset.v || 'morning')
    case 'chat': return hooks.openChat?.()
    case 'setup': return hooks.openSetup?.()
    case 'stop': return agent.stop()
  }
}

class Base {
  constructor(agent, store, hooks) {
    this.agent = agent
    this.store = store
    this.hooks = hooks
    // 展開看全部的那幾則
    this.opened = new Set()
    this.el = document.createElement('section')
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ag]')
      if (b && this.el.contains(b) && !b.disabled) act(this, b)
    })
    this.el.addEventListener('submit', (e) => {
      if (!e.target.matches('.ag-form')) return
      e.preventDefault()
      const input = e.target.elements.fuji
      const text = input.value.trim()
      if (!text) return input.focus()
      input.value = ''
      this.send(text)
    })
    let queued = false
    const later = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        if (this.el.isConnected) this.render()
      })
    }
    agent.subscribe(later)
    store.on('change', later)
  }
  send(text) {
    this.sent?.()
    return this.agent.say(text)
  }
  // 整個節點被搬到新畫好的頁面裡時（今日總覽、教練頁每次重畫），原本在輸入框裡的游標接回去
  static keep(el, fn) {
    const a = document.activeElement
    const had = el.contains(a) ? a : null
    const caret = had?.matches?.('input, textarea') ? [had.selectionStart, had.selectionEnd] : null
    fn()
    if (had && had.isConnected && document.activeElement !== had) {
      had.focus({ preventScroll: true })
      if (caret) had.setSelectionRange(...caret)
    }
  }
}

export class AgentCard extends Base {
  constructor(agent, store, hooks) {
    super(agent, store, hooks)
    this.el.className = 'td-card ag-card'
    this.el.setAttribute('aria-label', 'ふじ')
    this.el.innerHTML = `<header class="ag-head"><span class="stamp-k coach-k">藤</span><h3>ふじ<small></small></h3><button type="button" class="cm-link ag-open" data-ag="chat">對話和紀錄</button></header>
      <div class="ag-body" aria-live="polite"></div>
      <form class="ag-form" autocomplete="off"><input name="fuji" maxlength="300" enterkeyhint="send" placeholder="跟ふじ說：明天三點看牙醫…" aria-label="跟ふじ說一句" /><button class="btn-primary" type="submit">送出</button></form>`
    this.render()
  }
  render() {
    const { agent, store } = this
    const on = agent.ready()
    this.el.hidden = !on
    if (!on) return
    const today0 = new Date(`${store.today}T00:00:00`).getTime()
    // 今天最新的一則ふじ（她自己整理的，或回你的話）
    const last = agentFeed(agent, store).filter((m) => m.who === 'fuji' && m.at >= today0).pop()
    const mode = store.state.settings.agentMode
    this.el.querySelector('h3 small').textContent = mode === 'off' ? '我開口才動' : mode === 'ask' ? '整理前先問我' : '會自己整理'
    let html
    if (agent.thinking) html = `<p class="ag-say think">${agent.thinking === 'chat' ? '我想一下' : `正在${RUN_NAME[agent.thinking]?.replace('了', '') || '整理'}`}${DOTS}</p>`
    else if (agent.pending) html = pendingHTML(agent.pending, store)
    else if (last) html = fujiHTML(last, store, { open: this.opened.has(last.e?.id), max: 3, last: true })
    else html = `<p class="ag-say hint">${mode === 'off' ? '想調整什麼就跟我說一聲。' : '我會自己把今天排好、盯著進度；有新的事也會替你安排。想改什麼直接跟我說。'}</p>${mode === 'off' ? '' : '<div class="ag-acts"><button type="button" class="btn-ghost" data-ag="now">現在整理今天</button></div>'}`
    this.el.querySelector('.ag-body').innerHTML = html
    this.el.querySelector('.ag-form button').disabled = !!agent.thinking
  }
}

export class AgentView extends Base {
  constructor(agent, store, hooks) {
    super(agent, store, hooks)
    this.el.className = 'ag'
    this.panel = false
    this.el.innerHTML = `<div class="ag-top"></div><div class="ag-panel" hidden></div><div class="ag-feed" role="log"></div><div class="ag-hints"></div>
      <form class="coach-say ag-form" autocomplete="off"><input name="fuji" maxlength="300" enterkeyhint="send" placeholder="想改什麼直接說：任務、日程、專案、習慣、設定都行" aria-label="跟ふじ說" /><button class="btn-primary" type="submit">送出</button></form>`
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-av]')
      if (!b) return
      const v = b.dataset.av
      if (v === 'panel') this.panel = !this.panel
      else if (v === 'mode') {
        this.store.setSetting('agentMode', b.dataset.v)
        this.agent.reset()
      } else if (v === 'forget') this.store.agentForget(+b.dataset.i)
      else if (v === 'clear') {
        this.agent.clearChat()
        this.store.agentClearLog()
      } else if (v === 'hint') return this.send(b.dataset.v)
      this.render()
    })
    this.el.addEventListener('submit', (e) => {
      if (!e.target.matches('.ag-mem-add')) return
      e.preventDefault()
      const input = e.target.elements.mem
      if (this.store.agentRemember(input.value)) input.value = ''
      this.render()
    })
    this.render()
  }
  sent() {
    this._stick = true
  }
  render() {
    const { agent, store } = this
    const $ = (s) => this.el.querySelector(s)
    const on = agent.ready()
    $('.ag-form').hidden = !on
    $('.ag-hints').hidden = !on
    if (!on) {
      $('.ag-top').innerHTML = ''
      $('.ag-panel').hidden = true
      $('.ag-feed').innerHTML = `<div class="ag-intro"><span class="stamp-k coach-k">藤</span><div><b>讓ふじ自己幫你排</b>
        <p>接上 Claude 之後，ふじ不用你按按鈕：早上打開就把今天排好、挑出先做的那一件；加了新任務會自己估時間、排進空檔、太大的拆成小步驟；進度落後時重排；晚上替明天做準備。每一次都可以整批撤銷。也可以直接用一句話請她做事。</p>
        <button type="button" class="btn-primary" data-ag="setup">去設定 Claude 通行碼</button></div></div>`
      return
    }
    const mode = store.state.settings.agentMode
    const mem = store.state.agent.memory
    $('.ag-top').innerHTML = `<div class="seg ag-mode" role="group" aria-label="ふじ自己整理的方式">${AGENT_MODES.map(
      (m) => `<button type="button" data-av="mode" data-v="${m}" class="${m === mode ? 'on' : ''}" aria-pressed="${m === mode}" title="${MODE_LABEL[m][1]}">${MODE_LABEL[m][0]}</button>`,
    ).join('')}</div><small class="ag-mode-sub">${MODE_LABEL[mode][1]}</small>
      <button type="button" class="chip-toggle${this.panel ? ' on' : ''}" data-av="panel" aria-expanded="${this.panel}">記得的事${mem.length ? ` ${mem.length}` : ''}</button>`
    const panel = $('.ag-panel')
    panel.hidden = !this.panel
    // 記得的事那一塊：開著的時候只在內容變了才重畫（裡面有輸入框）
    const key = this.panel ? JSON.stringify(mem) : ''
    if (this.panel && key !== this._panelKey) {
      // 打到一半、還沒按「記住」的那一句留著
      const draft = panel.querySelector('input[name="mem"]')?.value || ''
      queueMicrotask(() => {
        const input = panel.querySelector('input[name="mem"]')
        if (input && draft) input.value = draft
      })
      panel.innerHTML = `<h3>ふじ記得的事<small>每次安排都會照著；對話裡說「以後…」她也會自己記</small></h3>
        ${mem.length ? `<ul>${mem.map((m, i) => `<li><span>${esc(m)}</span><button type="button" class="ag-x" data-av="forget" data-i="${i}" aria-label="忘掉：${esc(m)}" title="忘掉">×</button></li>`).join('')}</ul>` : '<p class="hint">還沒有。例如：週三晚上要上課、早上不排會議、一次專注不要超過 50 分鐘。</p>'}
        <form class="ag-mem-add coach-other" autocomplete="off"><input name="mem" maxlength="80" placeholder="要她記住的一句話" aria-label="要ふじ記住的事" /><button class="btn-primary" type="submit">記住</button></form>
        <button type="button" class="cm-link" data-av="clear">清掉對話和紀錄</button>`
    }
    this._panelKey = key
    const items = agentFeed(agent, store)
    const lastFuji = [...items].reverse().find((m) => m.who === 'fuji')
    const rows = items.map((m) =>
      m.who === 'me'
        ? `<div class="cmsg me"><p>${esc(m.text)}</p></div>`
        : `<div class="cmsg fuji ag-msg"><span class="stamp-k coach-k">藤</span><div class="ag-bubble">${fujiHTML(m, store, { open: this.opened.has(m.e?.id), max: 6, last: m === lastFuji && !agent.thinking })}</div></div>`,
    )
    if (agent.pending) rows.push(`<div class="cmsg fuji ag-msg"><span class="stamp-k coach-k">藤</span><div class="ag-bubble">${pendingHTML(agent.pending, store)}</div></div>`)
    if (agent.thinking) rows.push(`<div class="cmsg fuji ag-msg"><span class="stamp-k coach-k">藤</span><div class="ag-bubble"><p class="ag-say think">${agent.thinking === 'chat' ? '我想一下' : `正在${RUN_NAME[agent.thinking]?.replace('了', '') || '整理'}`}${DOTS}${agent.thinking === 'chat' ? ' <button type="button" class="cm-link" data-ag="stop">停</button>' : ''}</p></div></div>`)
    if (!rows.length) rows.push(`<div class="cmsg fuji ag-msg"><span class="stamp-k coach-k">藤</span><div class="ag-bubble"><p class="ag-say">${mode === 'off' ? '想調整什麼就跟我說一聲。' : '我會自己把今天排好、盯著進度。想加什麼、改什麼，直接跟我說就好。'}</p>${mode === 'off' ? '' : '<div class="ag-acts"><button type="button" class="btn-ghost" data-ag="now">現在整理今天</button></div>'}</div></div>`)
    const feed = $('.ag-feed')
    const sig = `${items.length}:${items.at(-1)?.at || 0}:${agent.thinking || ''}:${agent.pending?.id || ''}`
    feed.innerHTML = rows.join('')
    $('.ag-hints').innerHTML = HINTS.map((h) => `<button type="button" class="chip-toggle" data-av="hint" data-v="${esc(h)}"${agent.thinking ? ' disabled' : ''}>${h}</button>`).join('')
    $('.ag-form button').disabled = !!agent.thinking
    // 有新的一則（或剛送出）：捲到最下面
    if (sig !== this._sig || this._stick) {
      this._sig = sig
      this._stick = false
      // 輸入框在最下面：捲到底，最新的一則就在它上面
      requestAnimationFrame(() => this.el.closest('.panel-body')?.scrollTo({ top: 1e6 }))
    }
  }
}
export const keepFocus = Base.keep

// ── 隨叫隨到的ふじ（Dock 上的「藤」、J 或 Ctrl＋J）：任何一頁都能叫出來，一句話請她改 App 裡任何東西。
// 她看得到你現在在哪一頁（hooks.here()），「這個專案」「這天」指的就是它；下面的建議也跟著那一頁換 ──
const PAGE_NAME = { today: '今日總覽', tasks: '任務', schedule: '日程', coach: '教練', habits: '習慣', projects: '專案', records: '紀錄', calendar: '日曆' }
const PAGE_HINTS = {
  today: ['重排今天剩下的', '把最卡的那件拆小', '今天先做哪一件？'],
  tasks: ['把這天沒排的排進空檔', '這天排鬆一點', '逾期的分到之後幾天'],
  schedule: ['明天早上空出來', '這週有哪些日程？', '每週二四晚上八點健身'],
  coach: ['這週表現怎麼樣？', '下週先顧哪幾件', '專注改成 50 分鐘'],
  habits: ['加一個每天喝水 8 杯的習慣', '我今天運動了', '哪個習慣最穩？'],
  projects: ['替這個專案拆下一步', '這個專案進度怎麼樣？', '截止日往後一週'],
  records: ['換成夜間模式', '字大一點', '專注時放雨聲'],
  calendar: ['這個月有哪些重要日子？', '下週五要交報告', '明天有什麼？'],
}
export class AgentDock extends Base {
  // root：#fujiSheet（.modal）；hooks 多了 here()、close()
  constructor(root, agent, store, hooks) {
    super(agent, store, hooks)
    this.root = root
    this.el.className = 'agd-card'
    this.el.innerHTML = `<header class="agd-head"><span class="stamp-k coach-k">藤</span><div class="agd-title"><b>跟ふじ說</b><small class="agd-here"></small></div>
        <button type="button" class="cm-link" data-ag="chat">完整對話</button><button type="button" class="icon-btn small agd-x" data-agd="close" aria-label="關閉" title="關閉 (Esc)">×</button></header>
      <div class="agd-feed" role="log" aria-live="polite"></div>
      <div class="agd-hints"></div>
      <form class="ag-form agd-form" autocomplete="off"><input name="fuji" maxlength="600" enterkeyhint="send" placeholder="想改什麼？直接說" aria-label="跟ふじ說要改什麼" /><button class="btn-primary" type="submit">送出</button></form>
      <p class="agd-tip">日程、專案、習慣、作息、設定都能改；做了什麼會列出來，可以整批撤銷。</p>`
    root.appendChild(this.el)
    root.addEventListener('click', (e) => {
      if (e.target === root || e.target.closest('[data-agd="close"]')) this.close()
      else if (e.target.closest('[data-agd="hint"]')) this.send(e.target.closest('[data-agd="hint"]').dataset.v)
    })
    // 開著的時候她回話了：捲到最下面
    this.render()
  }
  get isOpen() {
    return !this.root.hidden
  }
  open(text = '') {
    if (!this.isOpen) {
      this.root.hidden = false
      this._since = Date.now()
    }
    this.render()
    const input = this.el.querySelector('input[name="fuji"]')
    if (text) input.value = text
    // 同一下點擊裡就放焦點：手機的鍵盤才會跟著出來
    if (!input.disabled) input.focus({ preventScroll: true })
  }
  close() {
    this.root.hidden = true
    this.hooks.closed?.()
  }
  sent() {
    this._stick = true
  }
  render() {
    const { agent, store } = this
    const $ = (s) => this.el.querySelector(s)
    const on = agent.ready()
    const here = this.hooks.here?.() || {}
    const page = here.page || 'today'
    const date = here.date && page !== 'today' && page !== 'records' && page !== 'habits' ? `・${dayLabel(here.date, store.today)}` : ''
    const project = here.project ? store.state.projects.find((p) => p.id === here.project) : null
    $('.agd-here').textContent = on ? `看著：${project ? `專案「${short(project.name, 14)}」` : `${PAGE_NAME[page] || '今日總覽'}${date}`}` : ''
    $('.agd-form').hidden = !on
    $('.agd-tip').hidden = !on
    const feed = $('.agd-feed')
    if (!on) {
      feed.innerHTML = `<div class="ag-intro"><span class="stamp-k coach-k">藤</span><div><b>一句話，ふじ幫你改</b>
        <p>接上 Claude 之後，在任何一頁按這顆（或 J 鍵）跟ふじ說一句話：「把明天的會議改到四點」「加一個每天喝水的習慣」「專注改成 50 分鐘」「這週專注了多久？」她直接改好、回答你，每一次都可以撤銷。</p>
        <button type="button" class="btn-primary" data-ag="setup">去設定 Claude 通行碼</button></div></div>`
      $('.agd-hints').innerHTML = ''
      return
    }
    // 這次打開之後的對話（沒有的話放最近的一則，知道上次說到哪）
    const items = agentFeed(agent, store, 30).filter((m) => !m.auto || m.at >= (this._since || 0))
    const recent = items.filter((m) => m.at >= (this._since || 0))
    const show = recent.length ? recent.slice(-8) : items.slice(-1)
    const lastFuji = [...show].reverse().find((m) => m.who === 'fuji')
    const rows = show.map((m) =>
      m.who === 'me'
        ? `<div class="cmsg me"><p>${esc(m.text)}</p></div>`
        : `<div class="cmsg fuji ag-msg"><span class="stamp-k coach-k">藤</span><div class="ag-bubble">${fujiHTML(m, store, { open: this.opened.has(m.e?.id), max: 6, last: m === lastFuji && !agent.thinking })}</div></div>`,
    )
    if (agent.thinking) rows.push(`<div class="cmsg fuji ag-msg"><span class="stamp-k coach-k">藤</span><div class="ag-bubble"><p class="ag-say think">${agent.thinking === 'chat' ? '我想一下' : `正在${RUN_NAME[agent.thinking]?.replace('了', '') || '整理'}`}${DOTS}${agent.thinking === 'chat' ? ' <button type="button" class="cm-link" data-ag="stop">停</button>' : ''}</p></div></div>`)
    if (!rows.length) rows.push(`<div class="cmsg fuji ag-msg"><span class="stamp-k coach-k">藤</span><div class="ag-bubble"><p class="ag-say">想改什麼？任務、日程、專案、習慣、作息、設定都可以，直接說就好。</p></div></div>`)
    const sig = `${show.length}:${show.at(-1)?.at || 0}:${agent.thinking || ''}`
    feed.innerHTML = rows.join('')
    $('.agd-hints').innerHTML = (PAGE_HINTS[page] || PAGE_HINTS.today)
      .map((h) => `<button type="button" class="chip-toggle" data-agd="hint" data-v="${esc(h)}"${agent.thinking ? ' disabled' : ''}>${esc(h)}</button>`)
      .join('')
    $('.agd-form button').disabled = !!agent.thinking
    if (sig !== this._sig || this._stick) {
      this._sig = sig
      this._stick = false
      requestAnimationFrame(() => feed.scrollTo({ top: 1e6 }))
    }
  }
}
const dayLabel = (date, today) => {
  if (date === today) return '今天'
  const d = new Date(`${date}T00:00:00`)
  const t = new Date(`${today}T00:00:00`)
  const n = Math.round((d - t) / 86400000)
  if (n === 1) return '明天'
  if (n === -1) return '昨天'
  return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`
}
