import './mottos.css'
import { $, $$, esc, armConfirm, editing, inlineEdit, keepFocus, pickOne, setHTML } from './dom.js'
import { MOTTO_EVERY, MOTTO_EXAMPLES, MOTTO_LEN, MOTTO_MAX, activeMottos, awakeAt, mottoAt, pauseText, pauseUntil, pausedUntil, windowEnd, eventQuiet, inQuiet } from '../mottos.js'
import { dateStr } from '../store/util.js'
import { CAT_MOTTOS } from '../theme.js'

// 警語：自己寫給自己的話。
// MottosView：紀錄頁的那一張卡（寫、改、先收著、刪，多久提醒一次、要不要放在面板上方）
// MottoBar：面板上方輪流放一句（每 15 分鐘換一句，點一下換下一句，× 今天先收起來）
// 醒著的時候定時提醒在 reminders.js，提醒時もち或ふじ念出來（main.js）

const HIDE_KEY = 'hiyori-motto-hide' // 今天先收起來：記今天的日期（只在這台裝置）
const EVERY_TEXT = { 0: '不提醒', 10: '10 分', 15: '15 分', 20: '20 分', 30: '30 分', 60: '1 小時', 120: '2 小時', 180: '3 小時' }
// 提醒送得到哪裡（hooks.mottoReach() 回傳的）：App 不在前面時收不收得到，收不到的話怎麼辦
const REACH = {
  phone: ['App 關著、手機鎖著也會照時間通知', false],
  'phone-off': ['打開系統通知後，App 關著、手機鎖著也會通知', true],
  'old-app': ['現在要開著 App 才會提醒：重新安裝新版的 Android App，App 關著也會通知', false],
  push: ['頁面關掉、手機鎖著也會照時間通知（要連得上網路）', false],
  page: ['這個頁面開著就會提醒（切到別的分頁、視窗也會跳通知）；整個關掉就不會', false],
  home: ['iPhone／iPad 要收通知：先在 Safari 按「分享」→「加入主畫面」，從主畫面打開。現在只在看著這一頁時提醒', false],
  'page-off': ['現在只在看著這一頁時提醒。打開系統通知，切到別的分頁、視窗也會跳通知', true],
  'page-blocked': ['通知被瀏覽器封鎖了，只在看著這一頁時提醒（到瀏覽器的網站設定裡允許通知）', false],
  'page-only': ['這個瀏覽器只在看著這一頁時提醒', false],
}

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
      // 專注中貓咪多久念一句（計時設定裡也有同一組）
      case 'cat':
        if (!CAT_MOTTOS.includes(+b.dataset.v)) return
        s.setSetting('catMotto', +b.dataset.v)
        return keepFocus(this.el.set, () => this.render())
      // 先停一下／現在就恢復：按完焦點放在換上來的那一顆（鍵盤操作的人不會掉到頁面最上面）
      case 'pause': {
        const until = pauseUntil(b.dataset.v, s.state.rhythm, Date.now())
        if (until) s.pauseMottos(until)
        this.render()
        return $('[data-act="resume"]', this.el.set)?.focus()
      }
      case 'resume':
        s.pauseMottos(0)
        this.render()
        return $('[data-act="pause"]', this.el.set)?.focus()
      case 'notify':
        // 問權限的時候先不能再按；問完（就算被拒絕、畫面跟原本一樣）要按得回來
        b.disabled = true
        return Promise.resolve(this.hooks.enableNotify?.()).finally(() => {
          b.disabled = false
          this.render()
        })
      case 'bar':
        s.setSetting('mottoBar', !s.state.settings.mottoBar)
        this.hooks.mottoBar?.()
        return this.render()
      case 'events':
        s.setSetting('mottoEvents', s.state.settings.mottoEvents === false)
        return keepFocus(this.el.set, () => this.render())
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
    const kind = every && on ? this.hooks.mottoReach?.() : null
    const [reach, ask] = REACH[kind] || []
    const evOn = s.state.settings.mottoEvents !== false
    setHTML(this.el.set, list.length
      ? `<div class="set-row theme-row"><div><b>多久提醒一次</b><small>${every ? `醒著的時候（作息的起床到就寢）每 ${EVERY_TEXT[every]}，もち或ふじ念一句，提示卡上寫著現在該做的那一件；專注中${evOn ? '、日程中' : ''}不打擾` : '不定時提醒，只放在面板上方'}</small></div>
          <div class="seg mt-every" role="group" aria-label="警語多久提醒一次">${MOTTO_EVERY.map((v) => `<button type="button" data-act="every" data-v="${v}" aria-pressed="${v === every}" class="${v === every ? 'on' : ''}">${EVERY_TEXT[v]}</button>`).join('')}</div>
          ${reach ? `<div class="mt-reach"><small>${esc(reach)}<span class="mt-last" data-r="last" hidden></span></small>${ask ? '<button type="button" class="chip-toggle" data-act="notify">打開系統通知</button>' : ''}</div>` : ''}</div>
        ${every && on ? this._pauseRow() + this._eventsRow(evOn) : ''}
        ${this._catRow()}
        <div class="set-row"><div><b>放在面板上方</b><small>每 15 分鐘換一句，點一下換下一句</small></div><button type="button" class="chip-toggle${bar ? ' on' : ''}" data-act="bar" aria-pressed="${bar}">${bar ? '開' : '關'}</button></div>`
      : '')
    pickOne($$('[data-act="every"]', this.el.set), (x) => +x.dataset.v === every)
    if (kind === 'push') this._renderLast()
  }

  // 先停一下：開會、吃飯、跟朋友在一起時。停著的時候寫停到幾點、可以馬上恢復；停完自己換回來
  _pauseRow() {
    const s = this.store.state
    const now = Date.now()
    const until = pausedUntil(s.settings, now)
    clearTimeout(this._pauseT)
    if (until) {
      // 停完自己換回來：焦點在這一區的話留在同一顆（「現在就恢復」不見了就換到「先停 1 小時」），鍵盤操作的人不會掉到頁面最上面
      this._pauseT = setTimeout(() => {
        const was = document.activeElement
        const onResume = was?.dataset?.act === 'resume' && this.el.set.contains(was)
        keepFocus(this.el.set, () => this.render())
        if (onResume) $('[data-act="pause"]', this.el.set)?.focus({ preventScroll: true })
      }, until - now + 500)
      return `<div class="set-row mt-pause"><div><b>先停到 ${esc(pauseText(until, now))}</b><small>這段時間到點的不念、不通知，時間到了就回來提醒你</small></div>
        <button type="button" class="chip-toggle on" data-act="resume">現在就恢復</button></div>`
    }
    // 睡覺的時間裡本來就不提醒：只給「先停 1 小時」
    const today = awakeAt(s.rhythm, now) ? `<button type="button" class="chip-toggle" data-act="pause" data-v="today" title="停到今晚就寢（${esc(pauseText(windowEnd(s.rhythm, now), now))}）">今天先停</button>` : ''
    return `<div class="set-row mt-pause"><div><b>先停一下</b><small>開會、吃飯、跟朋友在一起時先不提醒，時間到了自己恢復</small></div>
      <div class="mt-pause-acts"><button type="button" class="chip-toggle" data-act="pause" data-v="hour">先停 1 小時</button>${today}</div></div>`
  }

  // 日程中先不提醒：開會、上課這些排了時段的日程進行中。現在就在其中一場的話寫是哪一場、到幾點
  _eventsRow(on) {
    const s = this.store
    const now = Date.now()
    const today = dateStr(new Date(now))
    const cur = on ? s.eventsOn(today).find((e) => inQuiet(eventQuiet([e], today), now)) : null
    const text = cur
      ? `現在是「${esc(cur.title)}」（到 ${esc(cur.end)}）：這段時間到點的不念、不通知`
      : '開會、上課這些排了時段的日程進行中，到點的不念、不通知（整天的日程、做完了的不算）'
    clearTimeout(this._eventT)
    // 那一場結束了：換回平常的說明
    if (cur) this._eventT = setTimeout(() => keepFocus(this.el.set, () => this.render()), Math.max(1000, eventQuiet([cur], today)[0][1] - now + 500))
    return `<div class="set-row mt-events"><div><b>日程中先不提醒</b><small>${text}</small></div>
      <button type="button" class="chip-toggle${on ? ' on' : ''}" data-act="events" aria-pressed="${on}">${on ? '開' : '關'}</button></div>`
  }

  // 專注中貓咪念一句：上面的定時提醒專注中不打擾，改由專注頁上的貓咪小聲念（不出聲、不跳通知）
  _catRow() {
    const v = this.store.state.settings.catMotto || 0
    const text = v ? `專注時每 ${v} 分鐘，專注頁上的貓咪走過來小聲念一句（不出聲、不跳通知）；專注頁沒開著是もち或ふじ說` : '專注中不念'
    return `<div class="set-row theme-row mt-cat"><div><b>專注中貓咪念一句</b><small>${text}</small></div>
      <div class="seg" role="group" aria-label="專注中貓咪多久念一句警語">${CAT_MOTTOS.map((m) => `<button type="button" data-act="cat" data-v="${m}" aria-pressed="${m === v}" class="${m === v ? 'on' : ''}">${m ? `${m} 分` : '關'}</button>`).join('')}</div></div>`
  }

  // 「上一則推播幾點送到這台」：頁面關著時有沒有收到，看這一行就知道
  async _renderLast() {
    const e = await this.hooks.mottoLast?.()
    const el = $('[data-r="last"]', this.el.set)
    if (!el || !e) return
    const d = new Date(e.got)
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const day = dateStr(d) === this.store.today ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`
    const late = Number.isFinite(e.at) && e.got - e.at >= 60000 ? `，比到點晚了 ${Math.round((e.got - e.at) / 60000)} 分鐘` : ''
    el.textContent = `・上一則推播：${day} ${hm} 送到這台${late}`
    el.hidden = false
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
