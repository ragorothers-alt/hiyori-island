// 打開 App 時的今日摘要：貓咪從旁邊小跑步進來、坐下，用一張對話卡告訴你今天有什麼、該留意什麼。
// 內容在 ../brief.js 整理；貓是專注頁那一隻（focusCat.js），今天的毛色一樣。
// 系統開了「減少動態效果」：貓直接坐在那裡，字也不用一個一個打出來。
import { FocusCat } from './focusCat.js'
import { esc } from './dom.js'
import { buildBrief } from '../brief.js'
import './brief.css'

// 每個字隔多久出來（毫秒）；貓走太久（視窗很寬、分頁在背景）就不等了
const TYPE_MS = 26
const ARRIVE_MAX = 2400
// 貓坐下看著你、說話時的狀態（照專注頁「暫停中」的樣子：坐著、臉朝你）
const CTX = { mode: 'focus', paused: true, focusMs: 0 }

const item = (it, i, n) =>
  `<li style="--i:${n}"><button type="button" data-go="${i}"><i class="bf-ic" aria-hidden="true">${esc(it.icon)}</i><span><b>${esc(it.text)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button></li>`

export class BriefView {
  // root：整個摘要（底色＋卡片）；layer：貓走動的那一層（關掉卡片後貓還要走出去，所以分開）
  // hooks：data() 今天的資料、coat() 今天的毛色、go(去哪)、focus(任務 id)、onPoke(kind)、
  //   onClose(acted)：關掉了；acted 是 true 表示使用者點了某一項或按了專注（接下來他要做那件事）
  constructor(root, layer, hooks) {
    this.root = root
    this.hooks = hooks
    this.open = false
    this.card = root.querySelector('.bf-card')
    this.card.tabIndex = -1
    this.cat = new FocusCat(layer, { card: this.card, onPoke: (kind) => hooks.onPoke?.(kind) })
    this._timers = []
    root.addEventListener('click', (e) => this._click(e))
  }

  _later(fn, ms) {
    const id = setTimeout(fn, ms)
    this._timers.push(id)
    return id
  }
  _clear() {
    this._timers.forEach(clearTimeout)
    this._timers = []
    clearInterval(this._typing)
    clearInterval(this._waiting)
    this._typing = this._waiting = 0
  }

  // 打開：回傳 true。已經開著就不重來
  show() {
    if (this.open) return true
    this.open = true
    this._clear()
    const b = (this.brief = buildBrief(this.hooks.data()))
    this.goes = [...b.today, ...b.alerts].map((x) => x.go)
    const list = (items, from) => items.map((it, i) => item(it, from + i, from + i)).join('')
    this.card.innerHTML = `
      <header class="bf-head"><b class="bf-hello">${esc(b.hello)}</b><time>${esc(b.date)}</time><button type="button" class="icon-btn bf-x" data-act="ok" aria-label="關閉今日摘要" title="關閉 (Esc)">×</button></header>
      <p class="bf-lead"><span class="bf-typed" aria-hidden="true"></span><span class="sr-only">${esc(b.lead)}</span></p>
      <div class="bf-body" hidden>
        ${b.today.length ? `<h4>今天</h4><ul class="bf-list">${list(b.today, 0)}</ul>` : ''}
        <h4>提醒</h4>
        ${b.alerts.length ? `<ul class="bf-list">${list(b.alerts, b.today.length)}</ul>` : '<p class="bf-none">沒有要特別留意的事。</p>'}
        <p class="bf-bye" style="--i:${this.goes.length}">${esc(b.bye)}</p>
      </div>
      <footer class="bf-foot">
        ${b.first ? `<button type="button" class="btn-ghost" data-act="focus" title="${esc(b.first.title)}">▶ 專注第一件</button>` : ''}
        <button type="button" class="btn-primary" data-act="ok">知道了</button>
      </footer>
      <i class="bf-tail" aria-hidden="true"></i>`
    this.card.scrollTop = 0
    this.card.classList.remove('in')
    this.root.classList.remove('out')
    this.root.hidden = false
    this._before = document.activeElement
    // 叫貓過來：卡片先佔好位置（還看不到），貓才知道地板在哪、要坐在卡片左下角
    this.cat.show(CTX, this.hooks.coat())
    const C = this.card.getBoundingClientRect()
    this.cat.callTo(C.left + Math.min(54, C.width * 0.16))
    const still = !!this.cat.cat?.still
    const start = performance.now()
    const reveal = () => {
      clearInterval(this._waiting)
      this._waiting = 0
      this.card.classList.add('in')
      // 鍵盤從卡片裡開始走（不直接停在按鈕上：還沒按過鍵盤就亮一圈外框不好看）
      this.card.focus({ preventScroll: true })
      this._type(still)
    }
    if (still || !this.cat.fits) reveal()
    else this._waiting = setInterval(() => (this.cat.arrived || performance.now() - start > ARRIVE_MAX) && reveal(), 80)
    return true
  }

  // 第一句一個字一個字出來（貓的嘴巴跟著動），說完下面的清單才一項一項出現
  _type(instant) {
    const el = this.card.querySelector('.bf-typed')
    const text = [...this.brief.lead]
    const finish = () => {
      clearInterval(this._typing)
      this._typing = 0
      el.textContent = this.brief.lead
      this.cat.talk(false)
      this.cat.smile()
      this.card.querySelector('.bf-body').hidden = false
    }
    this._finish = finish
    if (instant) return finish()
    let n = 0
    this.cat.talk(true)
    this._typing = setInterval(() => {
      el.textContent = text.slice(0, ++n).join('')
      if (n >= text.length) finish()
    }, TYPE_MS)
  }

  _click(e) {
    const go = e.target.closest('[data-go]')
    const act = e.target.closest('[data-act]')?.dataset.act
    if (go) {
      const target = this.goes[+go.dataset.go]
      this.close(true)
      return this.hooks.go(target)
    }
    if (act === 'focus') {
      const id = this.brief.first?.id
      this.close(true)
      return this.hooks.focus(id)
    }
    // 點卡片外面、「知道了」、×：關掉
    if (act === 'ok' || !e.target.closest('.bf-card')) return this.close()
    // 字還在打：點一下卡片直接說完
    if (this._typing) this._finish()
  }

  // 關掉：卡片收起來，貓自己小跑步離開（那一層不擋畫面，可以馬上開始用）
  close(acted = false) {
    if (!this.open) return
    this.open = false
    this._clear()
    this.cat.talk(false)
    this.cat.leave()
    this.root.classList.add('out')
    this._later(() => {
      this.root.hidden = true
      this.root.classList.remove('out')
    }, 180)
    if (this._before?.isConnected && this.root.contains(document.activeElement)) this._before.focus?.({ preventScroll: true })
    this.hooks.onClose?.(acted)
  }
}
