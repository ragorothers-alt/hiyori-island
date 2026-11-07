import './subs.css'
import { $, $$, esc, armConfirm, pickOne, setHTML, WEEK_ZH } from './dom.js'
import { CURRENCIES, REMIND_DAYS, SUB_CATS, SUB_UNITS, cycleLabel, fmtMoney, fmtTWD, looksLikeCardNumber, monthlyOf, nextCharge, paidCount, paidSoFar, toTWD } from '../subs.js'
import { KNOWN_SUBS, guessCat } from '../data/subs.js'
import { daysBetween, parseDate, httpUrl } from '../store.js'

// 「紀錄」分頁的訂閱：每個月一共花多少、接下來要扣的款、每個訂閱的細節（付了多少、付款方式、管理網址）、
// 新增和編輯、取消和重新訂閱、外幣匯率。扣款前的提醒在 reminders.js，日曆上的標記在 calendar.js

const UPCOMING_SHOWN = 6

const thisYear = () => new Date().getFullYear()
// 11/12（四）；不是今年的加上年份
function md(date) {
  const d = parseDate(date)
  const y = d.getFullYear() === thisYear() ? '' : `${d.getFullYear()}/`
  return `${y}${d.getMonth() + 1}/${d.getDate()}（${WEEK_ZH[d.getDay()]}）`
}
const ymd = (date) => date.replaceAll('-', '/')
const when = (n) => (n === 0 ? '今天' : n === 1 ? '明天' : n === 2 ? '後天' : `${n} 天後`)
const remindText = (n) => (n < 0 ? '不提醒' : n === 0 ? '扣款當天提醒' : `扣款前 ${n} 天提醒`)

export class SubsView {
  constructor(root, store, hooks) {
    this.root = root
    this.store = store
    this.hooks = hooks
    // 正在新增或編輯：{ id（新增是 null）, cat, unit, trial, catTouched（自己選過分類就不再照名稱猜） }
    this.form = null
    this.open = new Set() // 展開細節的訂閱
    this.oldOpen = false // 「已取消」那一區有沒有打開
    this.ratesOpen = false
    root.innerHTML = `<section class="sb-root">
      <h3 class="sec-title sb-title">訂閱<small>サブスク</small><span class="count" data-r="count"></span><button type="button" class="dt-add" data-act="add" aria-expanded="false">＋ 新增</button></h3>
      <div data-r="form"></div>
      <div data-r="sum"></div>
      <div data-r="up"></div>
      <ul class="sb-list" data-r="list"></ul>
      <div data-r="old"></div>
      <div data-r="rates"></div>
    </section>`
    this.el = {}
    for (const n of $$('[data-r]', root)) this.el[n.dataset.r] = n
    this.addBtn = $('[data-act="add"]', root)
    root.addEventListener('click', (e) => this._click(e))
    root.addEventListener('submit', (e) => {
      e.preventDefault()
      this._submit(e.target)
    })
    root.addEventListener('input', (e) => this._input(e))
    root.addEventListener('change', (e) => {
      const cur = e.target.dataset.rate
      if (cur) this.store.setSubRate(cur, e.target.value)
    })
    // <details> 打開或收起：記著，重畫後照舊
    root.addEventListener(
      'toggle',
      (e) => {
        if (e.target.matches('.sb-old')) this.oldOpen = e.target.open
        if (e.target.matches('.sb-rates')) this.ratesOpen = e.target.open
      },
      true,
    )
    // 表單裡按 Esc：收起表單（注音選字時的 Esc 不算）
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || !this.form || !this.el.form.contains(e.target)) return
      e.stopPropagation()
      this._closeForm()
    })
  }

  // store 一變就會呼叫：表單是另外畫的，打到一半的字不會被洗掉
  refresh() {
    this.render()
  }

  // 打開某個訂閱的細節，捲到看得到的地方（從日曆點過來）
  reveal(id) {
    const sub = this.store.subscription(id)
    if (!sub) return
    this.open.add(id)
    if (sub.status === 'cancelled') this.oldOpen = true
    this.render()
    const btn = $(`.sb-card[data-id="${CSS.escape(id)}"] .sb-main`, this.root)
    btn?.scrollIntoView({ block: 'center' })
    btn?.focus({ preventScroll: true })
  }

  render() {
    const s = this.store
    const list = s.state.subscriptions
    const sum = s.subsSummary(30)
    this.el.count.textContent = sum.count ? `${sum.count} 個訂閱中` : ''
    setHTML(this.el.sum, list.length ? this._sumHTML(sum) : this.form ? '' : this._emptyHTML())
    setHTML(this.el.up, this._upHTML(sum.upcoming))
    const active = list
      .filter((x) => x.status === 'active')
      .map((x) => ({ x, next: nextCharge(x, s.today) || '9999' }))
      .sort((a, b) => a.next.localeCompare(b.next) || a.x.name.localeCompare(b.x.name))
    setHTML(this.el.list, active.map(({ x }) => this._card(x)).join(''))
    setHTML(this.el.old, this._oldHTML(list.filter((x) => x.status === 'cancelled'), sum))
    // 正在改匯率時不重畫那一區（游標會跑掉）
    if (!this.el.rates.contains(document.activeElement)) setHTML(this.el.rates, this._ratesHTML(list))
  }

  _emptyHTML() {
    return `<div class="empty sb-empty"><span class="em">還沒有訂閱</span>把 Netflix、Spotify、雲端空間這些記下來，<br>扣款前ふじ會提醒你，也看得到每個月一共花多少。</div>`
  }

  // ── 合計 ──
  _sumHTML(sum) {
    if (!sum.count) {
      return `<div class="sb-sum none"><p>目前沒有訂閱中的服務${sum.saved ? `・取消的那些每月省下約 <b>${fmtTWD(sum.saved)}</b>` : ''}</p></div>`
    }
    const cats = Object.entries(sum.byCat)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
    const pct = (v) => (sum.monthly ? (v / sum.monthly) * 100 : 0)
    const bar = cats.map(([k, v]) => `<i style="--c:${SUB_CATS[k].color};flex-grow:${v.toFixed(2)}" title="${SUB_CATS[k].label}・每月約 ${fmtTWD(v)}"></i>`).join('')
    const label = cats.map(([k, v]) => `${SUB_CATS[k].label} ${fmtTWD(v)}`).join('、')
    const legend = cats.map(([k, v]) => `<li style="--c:${SUB_CATS[k].color}"><i></i>${SUB_CATS[k].label}<b>${Math.round(pct(v))}%</b></li>`).join('')
    const foreign = this.store.state.subscriptions.some((x) => x.status === 'active' && x.cur !== 'TWD')
    return `<div class="sb-sum">
      <div class="sb-big"><small>每月大約</small><b>${fmtTWD(sum.monthly)}</b><span>一年大約 ${fmtTWD(sum.yearly)}${foreign ? '・外幣照下面的匯率換算' : ''}</span></div>
      <div class="sb-side"><small>這個月還要付</small><b>${fmtTWD(sum.monthLeft)}</b></div>
      ${cats.length > 1 ? `<div class="sb-bar" role="img" aria-label="各分類每月：${esc(label)}">${bar}</div><ul class="sb-legend">${legend}</ul>` : ''}
    </div>`
  }

  // ── 接下來 30 天的扣款 ──
  _upHTML(up) {
    if (!up.length) return ''
    const rates = this.store.state.subRates
    const rows = up
      .slice(0, UPCOMING_SHOWN)
      .map(({ sub, date, days }) => {
        const d = parseDate(date)
        const trial = sub.trial && date === sub.start
        const twd = sub.cur === 'TWD' ? '' : `<small>約 ${fmtTWD(toTWD(sub.price, sub.cur, rates))}</small>`
        return `<li class="${days <= 3 ? 'soon' : ''}" style="--c:${SUB_CATS[sub.cat].color}">
          <span class="sb-ud"><b>${d.getMonth() + 1}/${d.getDate()}</b><small>${WEEK_ZH[d.getDay()]}</small></span>
          <span class="sb-un"><b>${esc(sub.name)}</b><small>${when(days)}${trial ? '・試用結束，開始收費' : ''}</small></span>
          <span class="sb-ua"><b>${fmtMoney(sub.price, sub.cur)}</b>${twd}</span></li>`
      })
      .join('')
    const more = up.length > UPCOMING_SHOWN ? `<p class="sb-more-n">還有 ${up.length - UPCOMING_SHOWN} 筆</p>` : ''
    return `<h4 class="sb-h">接下來 30 天的扣款</h4><ol class="sb-up">${rows}</ol>${more}`
  }

  // ── 一個訂閱 ──
  _card(sub) {
    const s = this.store
    const today = s.today
    const rates = s.state.subRates
    const c = SUB_CATS[sub.cat]
    const cancelled = sub.status === 'cancelled'
    const next = nextCharge(sub, today)
    const days = next ? daysBetween(today, next) : null
    const trial = !cancelled && sub.trial && next === sub.start
    const open = this.open.has(sub.id)
    let line
    if (cancelled) line = sub.end > today ? `已取消・用到 ${md(sub.end)}` : sub.end ? `已取消・${ymd(sub.end)} 起不再扣款` : '已取消'
    else line = `${cycleLabel(sub)}・${trial ? '試用到' : '下次'} ${md(next)}・${when(days)}`
    const per = sub.unit === 'month' && sub.every === 1 ? '' : `<small>每月約 ${fmtTWD(toTWD(monthlyOf(sub), sub.cur, rates))}</small>`
    const twd = sub.cur !== 'TWD' && !per ? `<small>約 ${fmtTWD(toTWD(sub.price, sub.cur, rates))}</small>` : ''
    const badge = trial ? '<em class="sb-badge">試用中</em>' : ''
    const n = paidCount(sub, today)
    const paid = paidSoFar(sub, today)
    const facts = [
      n || sub.paid0 ? `從 ${ymd(sub.start)} 開始${n ? `・扣過 ${n} 次` : ''}・大約付了 ${fmtMoney(paid, sub.cur)}${sub.cur === 'TWD' ? '' : `（約 ${fmtTWD(toTWD(paid, sub.cur, rates))}）`}` : `${trial ? '試用結束後' : ''}第一次扣款 ${md(sub.start)}`,
      cancelled ? '' : remindText(sub.remind),
      sub.pay ? `付款方式：${esc(sub.pay)}` : '',
      sub.note ? esc(sub.note) : '',
    ].filter(Boolean)
    const link = sub.url ? `<a class="sb-link" href="${esc(sub.url)}" target="_blank" rel="noopener noreferrer">管理訂閱 ↗</a>` : ''
    const acts = cancelled
      ? `<button type="button" class="btn-ghost" data-act="resume">重新訂閱</button>`
      : `<button type="button" class="btn-ghost" data-act="edit">編輯</button><button type="button" class="btn-ghost" data-act="cancel">取消訂閱</button>`
    const more = open
      ? `<div class="sb-more" id="sbm-${esc(sub.id)}"><ul class="sb-facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul>
          <div class="sb-acts">${link}${acts}<button type="button" class="btn-ghost danger" data-act="del">刪除</button></div></div>`
      : ''
    return `<li class="sb-card${open ? ' open' : ''}${cancelled ? ' off' : ''}${!cancelled && days <= 3 ? ' soon' : ''}" data-id="${esc(sub.id)}" style="--c:${c.color}">
      <button type="button" class="sb-main" data-act="toggle" aria-expanded="${open}"${open ? ` aria-controls="sbm-${esc(sub.id)}"` : ''}>
        <span class="sb-k" title="${c.label}">${c.kanji}</span>
        <span class="sb-t"><b>${esc(sub.name)}${badge}</b><small>${line}</small></span>
        <span class="sb-p"><b>${fmtMoney(sub.price, sub.cur)}</b>${per || twd}</span>
      </button>${more}</li>`
  }

  // ── 已取消 ──
  _oldHTML(list, sum) {
    if (!list.length) return ''
    const cards = list
      .slice()
      .sort((a, b) => (b.end || '').localeCompare(a.end || ''))
      .map((x) => this._card(x))
      .join('')
    return `<details class="sb-old"${this.oldOpen ? ' open' : ''}><summary>已取消 ${list.length} 個<small>每月省下約 ${fmtTWD(sum.saved)}</small></summary><ul class="sb-list">${cards}</ul></details>`
  }

  // ── 匯率：只列有用到的外幣 ──
  _ratesHTML(list) {
    const used = [...new Set(list.map((x) => x.cur))].filter((k) => k !== 'TWD')
    if (!used.length) return ''
    const rates = this.store.state.subRates
    const rows = used
      .map((k) => `<label><span>1 ${CURRENCIES[k].sign}（${CURRENCIES[k].label}）＝ NT$</span><input type="number" min="0" step="0.0001" inputmode="decimal" data-rate="${k}" value="${rates[k]}" aria-label="1 ${CURRENCIES[k].label}換多少新台幣"></label>`)
      .join('')
    return `<details class="sb-rates"${this.ratesOpen ? ' open' : ''}><summary>匯率<small>只用來換算合計，可以改成最新的</small></summary><div class="sb-rate-rows">${rows}</div></details>`
  }

  // ── 新增／編輯表單 ──
  _openForm(sub = null) {
    this.form = { id: sub?.id || null, cat: sub?.cat || 'video', unit: sub?.unit || 'month', trial: !!sub?.trial, catTouched: !!sub }
    this.el.form.innerHTML = this._formHTML(sub)
    this.addBtn.setAttribute('aria-expanded', 'true')
    this.render()
    $('input[name="name"]', this.el.form)?.focus()
  }
  _closeForm() {
    const id = this.form?.id
    this.form = null
    this.el.form.innerHTML = ''
    this.addBtn.setAttribute('aria-expanded', 'false')
    this.render()
    // 焦點放回原本的地方：編輯的那張卡，或「＋ 新增」
    const back = id && $(`.sb-card[data-id="${CSS.escape(id)}"] .sb-main`, this.root)
    ;(back || this.addBtn).focus({ preventScroll: true })
  }
  _startHint() {
    return this.form.trial ? '免費試用結束、開始收費的那天' : '第一次扣款的日子；不記得的話填下一次扣款日也可以（「付了多少」會從那天算起）'
  }
  _formHTML(sub) {
    const f = this.form
    const s = this.store
    // 新增時一律從新台幣開始（記住上一次的幣別，下一個台幣訂閱很容易沒注意到就記成外幣）
    const cur = sub?.cur || 'TWD'
    const remind = sub ? sub.remind : 1
    const units = Object.entries(SUB_UNITS)
      .map(([k, u]) => `<button type="button" data-act="unit" data-v="${k}" class="${f.unit === k ? 'on' : ''}" aria-pressed="${f.unit === k}">${u.label}</button>`)
      .join('')
    const cats = Object.entries(SUB_CATS)
      .map(([k, c]) => `<button type="button" class="sb-cat${f.cat === k ? ' on' : ''}" data-act="cat" data-v="${k}" style="--c:${c.color}" aria-pressed="${f.cat === k}"><b>${c.kanji}</b>${c.label}</button>`)
      .join('')
    const reminds = [...REMIND_DAYS, -1].map((n) => `<option value="${n}"${n === remind ? ' selected' : ''}>${n < 0 ? '不提醒' : n === 0 ? '扣款當天' : `前 ${n} 天`}</option>`).join('')
    const curs = Object.entries(CURRENCIES).map(([k, c]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${c.sign} ${c.label}</option>`).join('')
    return `<form class="add-form sb-form" autocomplete="off" novalidate>
      <div class="sb-f-title">${sub ? `編輯「${esc(sub.name)}」` : '新增訂閱'}</div>
      <input name="name" maxlength="40" placeholder="服務名稱，例如：Netflix" aria-label="服務名稱" list="sbKnown" value="${esc(sub?.name || '')}" />
      <datalist id="sbKnown">${KNOWN_SUBS.map((k) => `<option value="${esc(k.name)}"></option>`).join('')}</datalist>
      <div class="form-row sb-f-price">
        <select name="cur" class="repeat-pick" aria-label="幣別">${curs}</select>
        <input name="price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="每次扣多少" aria-label="每次扣多少" value="${sub ? sub.price : ''}" />
      </div>
      <div class="form-row sb-f-cycle">
        <span class="sb-f-k">每</span>
        <input name="every" type="number" min="1" max="36" step="1" inputmode="numeric" value="${sub?.every || 1}" aria-label="隔多久扣一次" />
        <div class="seg" role="group" aria-label="週期">${units}</div>
        <button type="button" class="chip-toggle${f.trial ? ' on' : ''}" data-act="trial" aria-pressed="${f.trial}">免費試用中</button>
      </div>
      <div class="form-row">
        <label class="time-field sb-f-date"><span data-f="startLabel">${f.trial ? '試用到' : '扣款日'}</span><input name="start" type="date" value="${sub?.start || s.today}" /></label>
        <label class="sb-f-remind"><span>提醒</span><select name="remind" class="repeat-pick" aria-label="扣款前多久提醒">${reminds}</select></label>
      </div>
      <small class="sb-f-hint" data-f="startHint">${this._startHint()}</small>
      <div class="sb-cats" role="group" aria-label="分類">${cats}</div>
      <input name="pay" maxlength="20" placeholder="付款方式，例如：信用卡、Apple ID（不用填卡號）" aria-label="付款方式" value="${esc(sub?.pay || '')}" />
      <input name="url" type="url" maxlength="300" placeholder="取消或改方案的網址（可以不填）" aria-label="管理訂閱的網址" value="${esc(sub?.url || '')}" />
      <input name="note" maxlength="200" placeholder="備註（可以不填）" aria-label="備註" value="${esc(sub?.note || '')}" />
      <p class="sb-err" data-f="err" role="alert" hidden></p>
      <div class="form-row end"><button type="button" class="btn-ghost" data-act="close">取消</button><button class="btn-primary" type="submit">${sub ? '儲存' : '加入'}</button></div>
    </form>`
  }
  _err(text, field) {
    const p = $('[data-f="err"]', this.el.form)
    p.textContent = text
    p.hidden = !text
    if (field) $(`[name="${field}"]`, this.el.form)?.focus()
  }

  _input(e) {
    // 打服務名稱時順便猜分類（還沒自己選過的話）。猜不到就回到預設的影音：
    // 不然打「Apple TV+」打到一半猜成音樂，打完了還停在音樂
    if (e.target.name !== 'name' || !this.form || this.form.catTouched) return
    const cat = guessCat(e.target.value) || 'video'
    if (cat === this.form.cat) return
    this.form.cat = cat
    pickOne($$('[data-act="cat"]', this.el.form), (b) => b.dataset.v === cat)
  }

  _submit(form) {
    if (!this.form) return
    const v = (k) => form.elements[k].value
    const name = v('name').trim()
    const price = v('price').trim()
    const pay = v('pay').trim()
    const url = v('url').trim()
    const every = Number(v('every'))
    if (!name) return this._err('服務名稱要填', 'name')
    if (price === '' || !(Number(price) >= 0)) return this._err('金額要填（免費的話填 0）', 'price')
    if (!Number.isInteger(every) || every < 1 || every > 36) return this._err('週期是 1～36 之間的整數', 'every')
    if (!v('start')) return this._err(this.form.trial ? '試用到哪一天要填' : '扣款日要填', 'start')
    if (looksLikeCardNumber(pay)) return this._err('付款方式寫「信用卡」「Apple ID」這樣就好，不用填卡號', 'pay')
    // 跟存檔時同一套檢查：「https://」這種畫面上看起來存好、其實存成空白的，這裡就先說
    if (url && !httpUrl(url)) return this._err('網址看起來不完整：要是 http:// 或 https:// 開頭的完整網址', 'url')
    const data = {
      name, price, cur: v('cur'), every, unit: this.form.unit, start: v('start'), trial: this.form.trial, cat: this.form.cat,
      remind: Number(v('remind')), pay, url, note: v('note').trim(),
    }
    const s = this.store
    const id = this.form.id
    const ok = id ? s.updateSubscription(id, data) : s.addSubscription(data)
    if (!ok) return this._err(id ? '沒有存成功，看看日期和金額' : '沒有加成功：訂閱數量可能到上限了')
    const sub = id ? s.subscription(id) : ok
    const next = nextCharge(sub, s.today)
    this.form = null
    this.el.form.innerHTML = ''
    this.addBtn.setAttribute('aria-expanded', 'false')
    this.open.add(sub.id)
    this.render()
    $(`.sb-card[data-id="${CSS.escape(sub.id)}"] .sb-main`, this.root)?.focus({ preventScroll: true })
    this.hooks.toast?.({ icon: SUB_CATS[sub.cat].kanji, title: id ? `改好了「${sub.name}」` : `記下「${sub.name}」`, sub: next ? `${sub.trial && next === sub.start ? '試用到' : '下次扣款'} ${md(next)}・${fmtMoney(sub.price, sub.cur)}` : '' })
  }

  _click(e) {
    const b = e.target.closest('[data-act]')
    if (!b) return
    const act = b.dataset.act
    const s = this.store
    const id = b.closest('.sb-card')?.dataset.id
    const sub = id && s.subscription(id)
    if (act === 'add') {
      if (this.form && !this.form.id) this._closeForm()
      else this._openForm()
    } else if (act === 'close') this._closeForm()
    else if (act === 'unit') {
      this.form.unit = b.dataset.v
      pickOne($$('[data-act="unit"]', this.el.form), (x) => x === b)
    } else if (act === 'cat') {
      this.form.cat = b.dataset.v
      this.form.catTouched = true
      pickOne($$('[data-act="cat"]', this.el.form), (x) => x === b)
    } else if (act === 'trial') {
      this.form.trial = !this.form.trial
      b.classList.toggle('on', this.form.trial)
      b.setAttribute('aria-pressed', String(this.form.trial))
      $('[data-f="startLabel"]', this.el.form).textContent = this.form.trial ? '試用到' : '扣款日'
      $('[data-f="startHint"]', this.el.form).textContent = this._startHint()
    } else if (act === 'toggle' && sub) {
      if (this.open.has(id)) this.open.delete(id)
      else this.open.add(id)
      this.render()
      $(`.sb-card[data-id="${CSS.escape(id)}"] .sb-main`, this.root)?.focus({ preventScroll: true })
    } else if (act === 'edit' && sub) {
      this._openForm(sub)
      this.el.form.scrollIntoView?.({ block: 'nearest' })
    } else if (act === 'cancel' && sub) {
      armConfirm(b, '確定取消？', () => {
        if (!s.cancelSubscription(id)) return
        const x = s.subscription(id)
        const saved = toTWD(monthlyOf(x), x.cur, s.state.subRates)
        this.hooks.toast?.({ icon: '省', title: `取消了「${x.name}」`, sub: `${x.end && x.end > s.today ? `用到 ${md(x.end)}・` : ''}每月省下約 ${fmtTWD(saved)}` })
      })
    } else if (act === 'resume' && sub) {
      // 還沒到期：照原本的扣款日繼續。已經停了：從今天重新開始，接著打開編輯，可以改成實際的扣款日和新的價格
      const how = s.resumeSubscription(id)
      if (how === 'restart') this._openForm(s.subscription(id))
      else if (how === 'kept') {
        this.hooks.toast?.({ icon: '払', title: `「${sub.name}」繼續訂閱`, sub: `下次 ${md(nextCharge(s.subscription(id), s.today))} 照常扣款` })
        this.reveal(id)
      }
    } else if (act === 'del' && sub) {
      armConfirm(b, '確定刪除？', () => {
        this.open.delete(id)
        if (this.form?.id === id) this._closeForm()
        s.deleteSubscription(id)
      })
    }
  }
}
