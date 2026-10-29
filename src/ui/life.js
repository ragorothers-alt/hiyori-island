import './life.css'
import { $, $$, esc, ICON, armConfirm, dateLabel, WEEK_ZH } from './dom.js'
import { LIFE_KINDS, lifeKindOf, ENERGY } from '../data/life.js'
import { moodOf } from '../theme.js'
import { sleepStats, fmtDur } from '../planner.js'
import { addDays, parseDate, toMin, minToHHMM } from '../store.js'

// 生活記錄＋睡眠統計：放在「紀錄」分頁最上方，內容跟著面板上方選的日期走

// 精神 1–5 的顏色：好累（灰藍）→ 元氣滿滿（櫻色）
const ENERGY_COLORS = ['', '#a9b8d6', '#98cbe0', '#9fd6b8', '#f1c97c', '#f3a0b8']
const SLEEP_Q = ['', '沒睡好', '不太好', '普通', '不錯', '很好']
const SHORT = 360 // 睡不到 6 小時

const money = (n) => `NT$ ${Math.round(n).toLocaleString('zh-TW')}`
const shortMoney = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n))
const nowHHMM = () => {
  const d = new Date()
  return minToHHMM(d.getHours() * 60 + d.getMinutes())
}
// 就寢時間以午夜為中心（22:00 → -120），畫圖才不會被午夜切開
const aroundMidnight = (m) => (m >= 720 ? m - 1440 : m)
const hours = (min) => `${(min / 60).toFixed(1).replace(/\.0$/, '')}h`
const zhDur = (m) => {
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? (r ? `${h} 小時 ${r} 分` : `${h} 小時`) : `${r} 分鐘`
}
const spendOf = (life) => life.items.reduce((a, x) => a + (x.kind === 'spend' ? x.amount : 0), 0)
const weekOf = (date) => WEEK_ZH[parseDate(date).getDay()]
// 內容沒變就不動 DOM：避免重播動畫、保留 hover
const setHTML = (el, html) => {
  if (el._html === html) return false
  el._html = html
  el.innerHTML = html
  return true
}

// 規律度：就寢時間最早與最晚差幾分鐘 → 五格與一句話
function regularity(spread, n) {
  if (n < 2) return { lv: 0, say: '多記幾天，就看得出睡眠的節奏了' }
  if (spread <= 30) return { lv: 5, say: '每天差不多同一時間睡，很穩定呢' }
  if (spread <= 60) return { lv: 4, say: '滿規律的，這個節奏很不錯' }
  if (spread <= 120) return { lv: 3, say: '就寢時間有些變動，想調整時可以慢慢來' }
  if (spread <= 180) return { lv: 2, say: '這幾天的就寢時間不同，步調可以慢慢調整' }
  return { lv: 1, say: '就寢時間變動較大，照自己的步調調整也好' }
}

export class LifeView {
  constructor(root, store, hooks) {
    this.root = root
    this.store = store
    this.hooks = hooks
    this.kind = 'meal'
    this.date = null // 上次渲染的日期：換日期時重設表單
    this.editing = null // 正在就地編輯的記錄 id
    this.timeTouched = false // 使用者改過時間欄，就不再自動填「現在」
    this.sleepQ = 0
    this.sleepDirty = false // 睡眠表單有沒填完的修改：資料變動時先不覆蓋
    this.shown = new Set() // 已經出現過的記錄：只有新的一筆才播淡入動畫
    this._build()
    this._bind()
  }

  // 骨架只建一次；表單節點一直保留，render 只換內容
  _build() {
    const kinds = LIFE_KINDS.map((k) => `<button type="button" class="life-kind" data-kind="${k.key}" style="--c:${k.color}" aria-pressed="false" title="${k.label}"><b>${k.kanji}</b><span>${k.label}</span></button>`).join('')
    const bars = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-energy="${n}" title="${ENERGY[n]}" aria-label="精神 ${n}：${ENERGY[n]}"><i></i></button>`).join('')
    const qs = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-q="${n}" title="${SLEEP_Q[n]}" aria-label="睡眠品質 ${n}：${SLEEP_Q[n]}">${n}</button>`).join('')
    this.root.innerHTML = `
      <section class="life">
        <h3 class="sec-title life-head">生活記錄<small>くらしのきろく</small><span class="count life-date" data-r="date"></span></h3>
        <div class="life-energy" data-r="energy">
          <span class="le-label" data-r="energyLabel">今天的精神</span>
          <div class="le-bars" role="group" aria-label="精神">${bars}</div>
          <span class="le-text" data-r="energyText"></span>
        </div>
        <form class="add-form life-add" data-r="add" autocomplete="off">
          <div class="life-kinds" role="group" aria-label="種類">${kinds}</div>
          <div class="life-line">
            <input type="text" name="text" maxlength="120" aria-label="內容" data-r="text" />
            <label class="life-amt" data-r="amtBox" hidden><span>NT$</span><input type="number" name="amount" min="0" max="9999999" step="1" inputmode="numeric" placeholder="金額" data-r="amt" /></label>
          </div>
          <div class="form-row">
            <label class="time-field life-time"><span>時間</span><input type="time" name="t" data-r="time" /></label>
            <small class="life-tip" data-r="tip"></small>
            <button class="btn-primary" type="submit">記下</button>
          </div>
        </form>
        <ol class="life-tl" data-r="list"></ol>
        <div class="empty life-empty" data-r="empty" hidden></div>
        <div class="life-sum" data-r="sum"></div>
        <div class="life-spend" data-r="spend"></div>

        <h3 class="sec-title">睡眠<small>すいみん</small><span class="count" data-r="sleepCount"></span></h3>
        <div class="slp-chart" data-r="chart"></div>
        <div class="slp-stats" data-r="stats"></div>
        <form class="add-form slp-form" data-r="sf" autocomplete="off">
          <div class="sf-head"><b data-r="sfTitle"></b><small data-r="sfSub"></small></div>
          <div class="form-row">
            <label class="time-field sf-time"><span>就寢</span><input type="time" name="bed" data-r="bed" /></label>
            <span class="tilde">→</span>
            <label class="time-field sf-time"><span>起床</span><input type="time" name="wake" data-r="wake" /></label>
            <span class="sf-dur" data-r="sfDur"></span>
          </div>
          <div class="form-row">
            <span class="sf-label">品質</span>
            <div class="sf-q" role="group" aria-label="睡眠品質">${qs}</div>
            <span class="sf-qtext" data-r="qText"></span>
          </div>
          <div class="form-row end">
            <button type="button" class="btn-ghost danger sf-del" data-act="sleep-del" data-r="sfDel">刪除</button>
            <button type="submit" class="btn-primary" data-r="sfSave">記下</button>
          </div>
        </form>
        <p class="hint sf-future" data-r="sfFuture" hidden>還沒到的日子，醒來之後再來記吧</p>
      </section>`
    this.el = {}
    for (const n of $$('[data-r]', this.root)) this.el[n.dataset.r] = n
    this.kindBtns = $$('[data-kind]', this.root)
    this.energyBtns = $$('[data-energy]', this.root)
    this.qBtns = $$('[data-q]', this.root)
  }

  _bind() {
    const s = this.store
    const el = this.el
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b || !this.root.contains(b) || b.disabled) return
      const date = this.date
      if (b.dataset.kind) return this._pickKind(b.dataset.kind)
      if (b.dataset.energy) {
        const n = +b.dataset.energy
        return s.setEnergy(date, s.lifeOn(date).energy === n ? 0 : n)
      }
      if (b.dataset.day) return this.hooks.selectDate(b.dataset.day)
      if (b.dataset.q) {
        const n = +b.dataset.q
        this.sleepQ = this.sleepQ === n ? 0 : n
        this.sleepDirty = true
        return this._paintQ()
      }
      const act = b.dataset.act
      const li = b.closest('.life-item')
      if (act === 'edit') this._startEdit(li.dataset.id)
      else if (act === 'save') this._commitEdit(li)
      else if (act === 'del') armConfirm(b, ICON.check, () => {
        this.editing = null
        s.deleteLife(date, li.dataset.id)
      })
      else if (act === 'review') this.hooks.openReview(date)
      else if (act === 'sleep-del') armConfirm(b, '再按一次刪除', () => {
        this.sleepDirty = false
        s.deleteSleep(date)
        this._fillSleep(true)
      })
    })

    // 快速新增：Enter 送出；中文輸入法選字時的 Enter 不算
    el.add.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault()
    })
    el.add.addEventListener('submit', (e) => {
      e.preventDefault()
      this._submit()
    })
    el.time.addEventListener('input', () => (this.timeTouched = true))

    // 就地編輯：Enter 儲存、Esc 取消、焦點離開這一列也儲存
    el.list.addEventListener('keydown', (e) => {
      const li = e.target.closest('.life-item.editing')
      if (!li) return
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault()
        this._commitEdit(li)
      } else if (e.key === 'Escape') {
        this.editing = null
        this._renderList(true)
      }
    })
    el.list.addEventListener('focusout', (e) => {
      const li = e.target.closest('.life-item.editing')
      if (li && !li.contains(e.relatedTarget)) this._commitEdit(li)
    })

    // 睡眠補記
    el.sf.addEventListener('input', () => {
      this.sleepDirty = true
      this._paintDur()
    })
    el.sf.addEventListener('submit', (e) => {
      e.preventDefault()
      const bed = el.bed.value
      const wake = el.wake.value
      if (!bed || !wake) return (bed ? el.wake : el.bed).focus()
      this.sleepDirty = false
      s.logSleep(this.date, { bed, wake, q: this.sleepQ })
      this._fillSleep(true)
    })
  }

  render() {
    const date = this.store.selectedDate
    const changed = date !== this.date
    if (changed) {
      this.date = date
      this.editing = null
      this.timeTouched = false
      this.sleepDirty = false
      this.shown.clear()
    }
    this._renderHead()
    this._fillAdd(changed)
    this._renderList()
    this._renderSum()
    this._renderSpend()
    this._renderSleep()
    this._fillSleep(changed)
  }

  get future() {
    return this.date > this.store.today
  }

  // ── 標題與精神 ──
  _renderHead() {
    const s = this.store
    const d = this.date
    this.el.date.textContent = d === s.today ? '今天' : d === addDays(s.today, -1) ? `昨天・${dateLabel(d)}` : dateLabel(d)
    const energy = s.lifeOn(d).energy
    const box = this.el.energy
    box.hidden = this.future
    box.style.setProperty('--ec', ENERGY_COLORS[energy] || 'transparent')
    this.el.energyLabel.textContent = d === s.today ? '今天的精神' : '那天的精神'
    this.energyBtns.forEach((b) => {
      const n = +b.dataset.energy
      b.classList.toggle('lit', n <= energy)
      b.setAttribute('aria-pressed', String(n === energy))
    })
    this.el.energyText.textContent = energy ? ENERGY[energy] : '點一下記錄'
    this.el.energyText.classList.toggle('none', !energy)
  }

  // ── 快速新增 ──
  _pickKind(key) {
    this.kind = key
    this._paintKind()
    this.el.text.focus()
  }
  _paintKind() {
    const k = lifeKindOf(this.kind)
    this.kindBtns.forEach((b) => {
      const on = b.dataset.kind === this.kind
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    })
    this.el.text.placeholder = k.hint
    this.el.amtBox.hidden = this.kind !== 'spend'
  }
  _fillAdd(reset) {
    const el = this.el
    const today = this.date === this.store.today
    el.add.hidden = this.future
    if (this.future) return
    this._paintKind()
    if (reset) {
      el.text.value = ''
      el.amt.value = ''
    }
    // 今天預設「現在」；使用者正在打字或改過時間就不動它
    const busy = el.add.contains(document.activeElement)
    if (reset || (!busy && !this.timeTouched)) el.time.value = today ? nowHHMM() : ''
    el.tip.textContent = today ? '' : '時間留白會記在 12:00'
  }
  _submit() {
    const s = this.store
    const el = this.el
    const date = this.date
    if (date > s.today) return
    const text = el.text.value.trim()
    const amount = this.kind === 'spend' ? Math.max(0, Math.round(+el.amt.value || 0)) : 0
    if (!text && !amount) {
      el.text.focus()
      el.add.classList.remove('nudge')
      void el.add.offsetWidth
      el.add.classList.add('nudge')
      return
    }
    // 今天沒改過時間 → 交給 store 用送出當下的時間
    const t = (this.timeTouched || date !== s.today) && el.time.value ? el.time.value : undefined
    const item = s.addLife(date, { kind: this.kind, text, amount, t })
    if (!item) return
    el.text.value = ''
    el.amt.value = ''
    this.timeTouched = false
    el.time.value = date === s.today ? nowHHMM() : ''
    el.text.focus()
    $(`.life-item[data-id="${item.id}"]`, el.list)?.classList.add('fresh')
  }

  // ── 時間軸 ──
  _renderList(force = false) {
    const el = this.el
    // 正在就地編輯時不重畫，免得打到一半被清掉
    if (!force && this.editing && el.list.contains(document.activeElement)) return
    const items = this.store.lifeOn(this.date).items
    el.list.hidden = !items.length
    el.empty.hidden = !!items.length
    if (!items.length) {
      setHTML(el.list, '')
      setHTML(el.empty, this._emptyHTML())
      return
    }
    if (!setHTML(el.list, items.map((x) => (x.id === this.editing ? this._editRow(x) : this._row(x))).join(''))) return
    for (const li of el.list.children) {
      if (!this.shown.has(li.dataset.id)) li.classList.add('enter')
      this.shown.add(li.dataset.id)
    }
  }
  _row(x) {
    const k = lifeKindOf(x.kind)
    return `<li class="life-item" data-id="${esc(x.id)}" style="--mc:${k.color}">
      <time class="li-t">${x.t}</time>
      <span class="stamp-k li-stamp" title="${k.label}">${k.kanji}</span>
      <button type="button" class="li-main" data-act="edit" title="點一下修改">
        <span class="li-text${x.text ? '' : ' faint'}">${x.text ? esc(x.text) : k.label}</span>
        ${x.amount ? `<b class="li-amt">${money(x.amount)}</b>` : ''}
      </button>
      <div class="item-actions"><button type="button" class="mini" data-act="del" aria-label="刪除" title="刪除">${ICON.del}</button></div>
    </li>`
  }
  _editRow(x) {
    const k = lifeKindOf(x.kind)
    return `<li class="life-item editing" data-id="${esc(x.id)}" style="--mc:${k.color}">
      <input type="time" class="li-tin" name="et" value="${x.t}" aria-label="時間" />
      <span class="stamp-k li-stamp" title="${k.label}">${k.kanji}</span>
      <div class="li-edit">
        <input class="inline-input" name="etext" maxlength="120" value="${esc(x.text)}" placeholder="${esc(k.hint)}" aria-label="內容" />
        ${x.kind === 'spend' ? `<label class="li-eamt"><span>NT$</span><input type="number" name="eamt" min="0" step="1" inputmode="numeric" value="${x.amount || ''}" aria-label="金額" /></label>` : ''}
      </div>
      <div class="li-acts">
        <button type="button" class="mini" data-act="save" aria-label="儲存" title="儲存（Enter）">${ICON.check}</button>
        <button type="button" class="mini" data-act="del" aria-label="刪除" title="刪除">${ICON.del}</button>
      </div>
    </li>`
  }
  _startEdit(id) {
    this.editing = id
    this._renderList(true)
    const input = $('.life-item.editing [name=etext]', this.el.list)
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }
  _commitEdit(li) {
    const id = li?.dataset.id
    if (!id || this.editing !== id) return
    this.editing = null
    const item = this.store.lifeOn(this.date).items.find((x) => x.id === id)
    const text = $('[name=etext]', li).value.trim()
    const t = $('[name=et]', li).value
    const amtEl = $('[name=eamt]', li)
    const amount = amtEl ? Math.max(0, Math.round(+amtEl.value || 0)) : item?.amount || 0
    const patch = {}
    // 清空成什麼都沒有就當作取消（要刪除請用刪除鈕）
    if (item && (text || amount)) {
      if (text !== item.text) patch.text = text
      if (t && t !== item.t) patch.t = t
      if (amtEl && amount !== item.amount) patch.amount = amount
    }
    if (Object.keys(patch).length) this.store.updateLife(this.date, id, patch)
    else this._renderList()
  }
  _emptyHTML() {
    const s = this.store
    if (this.future) return `<span class="em">還沒到的日子</span>等那天到了，再來記下生活的點點滴滴吧`
    const stamps = LIFE_KINDS.map((k) => `<span style="--mc:${k.color}"><i class="stamp-k li-stamp">${k.kanji}</i>${k.label}</span>`).join('')
    const head = this.date === s.today
      ? `<span class="em">今天還沒有記錄</span>吃了什麼、動了動身體、買了什麼、心情如何，<br>挑一個印章寫一句話，按 Enter 就記下來了`
      : `<span class="em">這天沒有留下記錄</span>想起來的話，現在補記也可以喔`
    return `${head}<div class="life-kinds-demo">${stamps}</div>`
  }

  // ── 當天小結 ──
  _renderSum() {
    const s = this.store
    const box = this.el.sum
    box.hidden = this.future
    if (this.future) return
    const life = s.lifeOn(this.date)
    const spend = spendOf(life)
    const j = s.state.journal[this.date]
    const m = j && moodOf(j.mood)
    const mood = m
      ? `<button type="button" class="ls-cell ls-mood" data-act="review" style="--mc:${m.color}" title="修改回顧">
          <span class="stamp-k">${m.kanji}</span>
          <span class="ls-mood-t"><b>${m.name}</b><small>${esc(j.text || m.desc)}</small></span>
        </button>`
      : `<button type="button" class="ls-cell ls-review" data-act="review">${ICON.edit}<span>寫下回顧</span></button>`
    setHTML(box, `
      <div class="ls-cell"><b>${life.items.length}</b><span>筆記錄</span></div>
      <div class="ls-cell"><b class="${spend ? 'gold' : ''}">${spend ? money(spend) : '—'}</b><span>花費</span></div>
      ${mood}`)
  }

  // ── 最近七天的花費 ──
  _renderSpend() {
    const s = this.store
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = addDays(s.today, -i)
      days.push({ d, v: spendOf(s.lifeOn(d)) })
    }
    const total = days.reduce((a, x) => a + x.v, 0)
    const max = Math.max(...days.map((x) => x.v))
    const head = `<div class="lsp-head"><b>七天的花費</b><small>${total ? `合計 ${money(total)}・每天約 ${money(total / 7)}` : ''}</small></div>`
    if (!total) {
      setHTML(this.el.spend, `${head}<p class="lsp-none">最近七天還沒有花費記錄，選「花費」就能順手記帳</p>`)
      return
    }
    const cols = days.map(({ d, v }) => {
      const cls = `${d === s.today ? ' today' : ''}${d === this.date ? ' sel' : ''}`
      const h = v ? Math.max(4, Math.round((v / max) * 38)) : 0
      return `<button type="button" class="lsp-col${cls}" data-day="${d}" title="${dateLabel(d)}　${v ? money(v) : '未記花費'}">
        <small>${v ? shortMoney(v) : ''}</small><i style="height:${h}px"></i><span>${d === s.today ? '今' : weekOf(d)}</span>
      </button>`
    })
    setHTML(this.el.spend, `${head}<div class="lsp-bars">${cols.join('')}</div>`)
  }

  // ── 睡眠：最近七天 ──
  _renderSleep() {
    const s = this.store
    const st = sleepStats(s.state.sleep, s.today, 7)
    this.el.sleepCount.textContent = st.n ? `近 7 天記了 ${st.n} 晚` : ''
    setHTML(this.el.chart, this._chartHTML(st))
    setHTML(this.el.stats, this._statsHTML(st))
  }
  _chartHTML(st) {
    const s = this.store
    const r = s.state.rhythm
    // 作息設定的睡眠時段（淡色帶）
    let band = null
    if (r?.sleep && r?.wake) {
      const a = aroundMidnight(toMin(r.sleep))
      let b = toMin(r.wake)
      if (b <= a) b += 1440
      if (b - a >= 180 && b - a <= 840) band = [a, b]
    }
    // 縱軸範圍：資料與作息帶各留一點邊，至少 8 小時，對齊整點
    const got = st.list.filter((x) => x.dur)
    const marks = got.flatMap((x) => {
      const bed = aroundMidnight(toMin(x.bed))
      return [bed, bed + x.dur]
    })
    if (band) marks.push(...band)
    let lo = marks.length ? Math.min(...marks) - 45 : -120
    let hi = marks.length ? Math.max(...marks) + 45 : 480
    if (hi - lo < 480) {
      const pad = (480 - (hi - lo)) / 2
      lo -= pad
      hi += pad
    }
    lo = Math.floor(lo / 60) * 60
    hi = Math.ceil(hi / 60) * 60
    const span = hi - lo
    const pct = (m) => (((m - lo) / span) * 100).toFixed(2)
    const step = span > 720 ? 180 : 120
    const grid = []
    for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) {
      if (m <= lo || m >= hi) continue
      grid.push({ m, label: String((((m / 60) % 24) + 24) % 24) })
    }
    const axis = grid.map((g) => `<small style="top:${pct(g.m)}%">${g.label}</small>`).join('')
    const lines = grid.map((g) => `<i class="slp-grid${g.m === 0 ? ' mid' : ''}" style="top:${pct(g.m)}%"></i>`).join('')
    const bandEl = band ? `<i class="slp-band" style="top:${pct(band[0])}%;height:${(((band[1] - band[0]) / span) * 100).toFixed(2)}%"></i>` : ''
    const mid = band ? pct((band[0] + band[1]) / 2) : 50
    const cols = st.list.map((x) => {
      const cls = `${x.date === s.today ? ' today' : ''}${x.date === this.date ? ' sel' : ''}`
      const wk = x.date === s.today ? '今' : weekOf(x.date)
      if (!x.dur) {
        return `<button type="button" class="slp-col none${cls}" data-day="${x.date}" title="${dateLabel(x.date)}　還沒記錄，點一下補記">
          <span class="slp-plot"><span class="slp-add" style="top:${mid}%">${ICON.plus}</span></span>
          <span class="slp-foot"><b>—</b><span>${wk}</span></span>
        </button>`
      }
      const bed = aroundMidnight(toMin(x.bed))
      const short = x.dur < SHORT
      const tip = `${dateLabel(x.date)}　${x.bed} → ${x.wake}・${fmtDur(x.dur)}${x.q ? `・${SLEEP_Q[x.q]}` : ''}`
      return `<button type="button" class="slp-col${short ? ' short' : ''}${cls}" data-day="${x.date}" title="${tip}">
        <span class="slp-plot"><span class="slp-bar" style="top:${pct(bed)}%;height:${((x.dur / span) * 100).toFixed(2)}%"><small class="b">${x.bed}</small><small class="w">${x.wake}</small></span></span>
        <span class="slp-foot"><b>${hours(x.dur)}</b><span>${wk}</span></span>
      </button>`
    })
    const legend = `<p class="slp-legend">${band ? `<span><i class="lg-band"></i>作息設定 ${r.sleep}–${r.wake}</span>` : ''}<span><i class="lg-ok"></i>睡眠</span><span><i class="lg-short"></i>不到 6 小時</span></p>`
    return `<div class="slp-body"><div class="slp-axis">${axis}</div><div class="slp-cols"><div class="slp-layer">${bandEl}${lines}</div>${cols.join('')}</div></div>${legend}`
  }
  _statsHTML(st) {
    const reg = regularity(st.spread, st.n)
    const cell = (v, label, cls = '') => `<div class="slp-stat${cls}"><b>${v}</b><span>${label}</span></div>`
    const cells = [
      cell(st.n ? fmtDur(st.avg) : '—', '平均睡眠', st.n && st.avg < SHORT ? ' short' : ''),
      cell(st.bed || '—', '平均就寢'),
      cell(st.wake || '—', '平均起床'),
      cell(st.q ? `${st.q}<small>/5</small>` : '—', '平均睡眠品質'),
    ].join('')
    const dots = [1, 2, 3, 4, 5].map((n) => `<i class="${n <= reg.lv ? 'on' : ''}"></i>`).join('')
    const detail = st.n >= 2 ? `就寢時間最早和最晚差 ${zhDur(st.spread)}` : st.n ? '目前記了 1 晚' : '還沒有睡眠紀錄'
    const extra = st.n && st.avg < SHORT ? '<small class="warn">平均睡不到 6 小時，覺得累時歇歇也好</small>' : ''
    const intro = st.n ? '' : '<small>早上醒來記一下昨晚幾點睡、幾點起，就能看到自己的節奏</small>'
    return `<div class="slp-grid4">${cells}</div>
      <div class="slp-reg">
        <div class="slp-reg-h"><b>規律度</b><span class="slp-dots" aria-label="規律度 ${reg.lv} / 5">${dots}</span><span class="slp-reg-d">${detail}</span></div>
        <p>${reg.say}</p>${extra}${intro}
      </div>`
  }

  // ── 睡眠補記表單 ──
  _fillSleep(reset) {
    const s = this.store
    const el = this.el
    const date = this.date
    el.sf.hidden = this.future
    el.sfFuture.hidden = !this.future
    if (this.future) return
    const e = s.state.sleep[date]
    el.sfTitle.textContent = date === s.today ? '昨晚睡得如何？' : `${dateLabel(addDays(date, -1), false)} 晚上的睡眠`
    el.sfSub.textContent = `記在醒來那天・${date === s.today ? '今天' : dateLabel(date)}`
    el.sfDel.hidden = !e
    el.sfSave.textContent = e ? '儲存' : '記下'
    // 有沒存的修改就不覆蓋
    if (!reset && this.sleepDirty) return
    const r = s.state.rhythm || {}
    el.bed.value = e?.bed || r.sleep || '23:30'
    el.wake.value = e?.wake || r.wake || '07:00'
    this.sleepQ = e?.q || 0
    this._paintQ()
    this._paintDur()
  }
  _paintQ() {
    this.qBtns.forEach((b) => {
      const n = +b.dataset.q
      b.classList.toggle('on', n <= this.sleepQ)
      b.setAttribute('aria-pressed', String(n === this.sleepQ))
    })
    this.el.qText.textContent = this.sleepQ ? SLEEP_Q[this.sleepQ] : '可以不填'
    this.el.qText.classList.toggle('none', !this.sleepQ)
  }
  _paintDur() {
    const { bed, wake, sfDur } = this.el
    if (!bed.value || !wake.value) {
      sfDur.textContent = ''
      return
    }
    const b = toMin(bed.value)
    const w = toMin(wake.value)
    const dur = w > b ? w - b : w + 1440 - b
    sfDur.textContent = `睡了 ${fmtDur(dur)}`
    sfDur.classList.toggle('short', dur < SHORT)
  }
}
