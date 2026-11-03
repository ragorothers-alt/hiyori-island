import './today.css'
import { $, esc, ICON } from './dom.js'
import { tagOf, EVENT_COLORS, XP, WEEK_ZH } from '../theme.js'
import { TODAY_QUOTES, TODAY_LEADS } from '../data/todayLines.js'
import { addDays, parseDate, toMin, weekKey } from '../store.js'
import { applies, countOn, doneOn, streak } from '../habits.js'
import { taskDur } from '../planner.js'
import heroDay from '../assets/today/hero-day.webp'
import heroNight from '../assets/today/hero-night.webp'

// App 模式的首頁「今日總覽」：今天的進度、一句話、今日行程、前三要務（本命）、每日任務、這週的習慣。
// 只看今天（不跟著上方選的日期走）；資料一變就整頁重畫，焦點用 data-fk 接回去；每分鐘重畫一次讓「現在」的紅線往下走

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
// 依日期挑一則（同一天固定）
const pickOf = (list, key) => {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return list[h % list.length]
}
const KANA_TAG = { work: 'しごと', study: 'まなび', life: 'せいかつ', health: 'けんこう', idea: 'ひらめき' }
// 和風月名、星期的平假名
const MONTH_KANA = ['むつき', 'きさらぎ', 'やよい', 'うづき', 'さつき', 'みなづき', 'ふみづき', 'はづき', 'ながつき', 'かんなづき', 'しもつき', 'しわす']
const WEEK_KANA = ['にちようび', 'げつようび', 'かようび', 'すいようび', 'もくようび', 'きんようび', 'どようび']

// 線條小圖示（stroke 跟著文字顏色）
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`
const IC = {
  cal: svg('<rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2"/>'),
  spark: svg('<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  leaf: svg('<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l8-8"/>'),
  check: svg('<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><path d="M8.5 12.2l2.4 2.3 4.6-5"/>'),
  clock: svg('<circle cx="12" cy="12" r="7.5"/><path d="M12 8v4.2l2.6 1.6"/>'),
  pending: svg('<circle cx="12" cy="12" r="7.5" stroke-dasharray="2.6 2.4"/>'),
  timer: svg('<circle cx="12" cy="13.5" r="6.5"/><path d="M12 10.5v3l2 1.4M10 4h4M12 4v3"/>'),
  people: svg('<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M15.5 14.6c2.5-.2 4.4 1.2 5 4.1"/>'),
  mail: svg('<rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="M4.5 7.5l7.5 5.5 7.5-5.5"/>'),
  move: svg('<path d="M6.5 8v8M17.5 8v8M4 10v4M20 10v4M6.5 12h11"/>'),
  book: svg('<path d="M12 7c-2-1.6-4.8-2-8-1.5v12c3.2-.5 6 0 8 1.5 2-1.5 4.8-2 8-1.5v-12c-3.2-.5-6-.1-8 1.5z"/><path d="M12 7v12"/>'),
  food: svg('<path d="M7 4v7a2 2 0 0 0 4 0V4M9 11v9M16 4c-1.7 1.3-2.5 3.3-2.5 6h2.5v10"/>'),
  play: svg('<path d="M8.5 6v12l9.5-6z"/>'),
  star: svg('<path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.7.9 5.1L12 16.4l-4.6 2.4.9-5.1-3.8-3.7 5.2-.8z"/>'),
  sakura: svg('<path d="M12 12c-1.2-2.8-1.7-5.2-.3-7.3.8.5 1.5.9 2.4.6.5 2.6-.4 4.6-2.1 6.7zM12 12c2.6-1.6 5-2.2 7.2-1.1-.4.9-.7 1.6-.3 2.5-2.5.9-4.6.2-6.9-1.4zM12 12c2.1 2.1 3.2 4.3 2.5 6.7-.9-.3-1.7-.4-2.4.2-1.7-2-1.8-4.3-.1-6.9zM12 12c-.3 3-1.3 5.2-3.6 6.3-.4-.9-.9-1.5-1.9-1.5.1-2.7 1.8-4.2 5.5-4.8zM12 12c-3 .6-5.4.3-7.1-1.5.7-.6 1.2-1.3 1.1-2.3 2.6-.3 4.4 1 6 3.8z"/><circle cx="12" cy="12" r="1"/>'),
}
// 行程的小圖示：照標題猜（會議、信件、運動、閱讀、休息、吃飯），猜不到就是日程／任務
const GUESS = [
  [/會議|開會|討論|週會|面談|聚會|約/, 'people'],
  [/信|郵件|mail|回覆|訊息/i, 'mail'],
  [/運動|健身|跑步|慢跑|伸展|瑜伽|游泳|重訓|騎車|球/, 'move'],
  [/讀|閱讀|書|複習|預習|單字/, 'book'],
  [/休息|散步|放鬆|冥想|午睡|喝茶/, 'leaf'],
  [/早餐|午餐|晚餐|吃|飯|咖啡/, 'food'],
]
const iconOf = (title, kind) => IC[GUESS.find(([re]) => re.test(title))?.[1] || (kind === 'task' ? 'check' : 'cal')]
const dur = (m) => `${m} 分`

export class TodayView {
  constructor(root, store, hooks) {
    this.root = root
    this.store = store
    this.hooks = hooks
    // 插畫掛在整頁上：設定裡 Liquid Glass 的預覽也用這張
    document.documentElement.style.setProperty('--td-hero-day', `url("${heroDay}")`)
    document.documentElement.style.setProperty('--td-hero-night', `url("${heroNight}")`)
    root.addEventListener('click', (e) => this._click(e))
    // 「現在」的紅線、進行中的件數跟著時間走：看得到的時候每分鐘重畫。
    // 正按著某個按鈕時先不重畫（不然放開時按鈕已經換掉，這一下就不算），放開再補
    root.addEventListener('pointerdown', () => (this._down = true))
    const up = () => {
      this._down = false
      if (this._late) requestAnimationFrame(() => this._tick())
    }
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
    setInterval(() => this._tick(), 60000)
  }

  _tick() {
    this._late = this._down
    if (!this._down && this.root.offsetParent) this.render()
  }

  _click(e) {
    const b = e.target.closest('[data-act]')
    if (!b || !this.root.contains(b) || b.disabled) return
    const s = this.store
    const id = b.dataset.id
    switch (b.dataset.act) {
      case 'tab': return this.hooks.setTab(b.dataset.v)
      case 'add': return this.hooks.addTask()
      case 'cal': return this.hooks.openCalendar(s.today)
      case 'edit': return this.hooks.openEdit(b.dataset.type, id)
      case 'toggle': return s.toggleTask(id)
      case 'star': return s.toggleStar(id)
      case 'focus': return this.hooks.startFocus(id)
      case 'claim': return b.dataset.weekly ? s.claimWeekly() : s.claimQuest(id)
      case 'claimAll':
        for (const q of s.quests()) if (q.ready && !q.claimed) s.claimQuest(q.id)
        if (s.weekly().ready && !s.weekly().claimed) s.claimWeekly()
        return
      case 'habit': return s.checkHabit(id)
    }
  }

  render() {
    // 焦點在某個按鈕上（例如剛勾完一件）：重畫後接回同一個；那個按鈕不見了（☆ 選成本命、推薦的那件做完了），
    // 就接到同一件的勾選或專注鈕，再不然是同一張卡片裡的第一個按鈕
    const a = document.activeElement
    const fk = this.root.contains(a) ? a.dataset.fk : null
    const card = fk && [...(a.closest('.td-card')?.classList || [])].find((c) => c !== 'td-card')
    // 行程、習慣卡片裡捲到的位置也留著
    const scroll = ['.td-tl', '.td-hg'].map((sel) => [sel, $(sel, this.root)?.scrollTop, $(sel, this.root)?.scrollLeft])
    const s = this.store
    const today = s.today
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const tasks = s.tasksOn(today)
    this.root.innerHTML = `<div class="td">
      ${this._heroHTML(today, tasks, now)}
      <div class="td-grid">
        ${this._progHTML(tasks, nowMin)}
        ${this._quoteHTML(today)}
        ${this._schedHTML(today, tasks, nowMin)}
        ${this._topHTML(today, tasks)}
        ${this._questHTML()}
        ${this._habitHTML(today)}
      </div>
    </div>`
    for (const [sel, top, left] of scroll) {
      const el = $(sel, this.root)
      if (el && top != null) Object.assign(el, { scrollTop: top, scrollLeft: left })
    }
    if (!fk) return
    const id = fk.replace(/^[a-z]+-/, '')
    const by = (k) => $(`[data-fk="${CSS.escape(k)}"]:not(:disabled)`, this.root)
    const to = by(fk) || by(`tg-${id}`) || by(`fc-${id}`) || (card && ($(`.${card} :is(li, .td-hr) button:not(:disabled)`, this.root) || $(`.${card} button:not(:disabled)`, this.root)))
    to?.focus({ preventScroll: true })
  }

  // ── 最上面：日期、標題、一句問候（依今天的狀態） ──
  _heroHTML(today, tasks, now) {
    const d = parseDate(today)
    const done = tasks.filter((t) => t.done).length
    const kind = !tasks.length ? 'empty' : done === tasks.length ? 'done' : now.getHours() >= 21 ? 'night' : done ? 'going' : 'start'
    const lead = pickOf(TODAY_LEADS[kind], today + kind)
    return `<header class="td-hero">
      <div class="td-date">${d.getMonth() + 1}月${d.getDate()}日 週${WEEK_ZH[d.getDay()]}<em>${MONTH_KANA[d.getMonth()]}・${WEEK_KANA[d.getDay()]}</em></div>
      <h2 class="td-title">今天的總覽<i class="td-sakura">${IC.sakura}</i></h2>
      <p class="td-lead">${esc(lead.zh)}<small>${esc(lead.ja)}</small></p>
    </header>`
  }

  // ── 今日進度：完成／進行中（開始專注過、或排的時間已經到了）／待完成 ──
  _progHTML(tasks, nowMin) {
    const focusId = this.hooks.focusTaskId?.()
    const done = tasks.filter((t) => t.done).length
    const going = tasks.filter((t) => !t.done && (t.pomos || t.id === focusId || (t.at && toMin(t.at) <= nowMin))).length
    const left = tasks.length - done - going
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0
    const C = 2 * Math.PI * 52
    const row = (icon, label, n, cls) => `<li class="${cls}">${icon}<span>${label}</span><b>${n}</b><small>件</small></li>`
    return `<section class="td-card td-prog" aria-label="今日進度">
      <div class="td-ring" role="img" aria-label="今天完成 ${pct}%">
        <svg viewBox="0 0 120 120"><defs><linearGradient id="tdRingG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4a7bd"/><stop offset=".55" stop-color="#d7b4ec"/><stop offset="1" stop-color="#9cc8ec"/></linearGradient></defs>
          <circle cx="60" cy="60" r="52"/><circle cx="60" cy="60" r="52" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct / 100)}"/></svg>
        <div><small>今日進度</small><em>きょうのしんちょく</em><b>${pct}<i>%</i></b></div>
      </div>
      <ul class="td-counts">${row(IC.check, '已完成', done, 'c-done')}${row(IC.clock, '進行中', going, 'c-going')}${row(IC.pending, '待完成', left, 'c-left')}</ul>
      ${tasks.length ? '' : '<button type="button" class="td-link td-prog-add" data-act="add" data-fk="add">種下今天的第一件 ›</button>'}
    </section>`
  }

  // ── 今天的一句話（同一天固定） ──
  _quoteHTML(today) {
    const q = pickOf(TODAY_QUOTES, today)
    return `<section class="td-card td-quote" aria-label="今天的一句話">
      <span class="td-qmark" aria-hidden="true">“</span>
      <p>${esc(q.zh)}</p><small lang="ja">${esc(q.ja)}</small>
      <i class="td-petal" aria-hidden="true"></i>
    </section>`
  }

  // ── 今日行程：今天的日程和排了時段的任務，照時間排；「現在」畫一條紅線 ──
  _schedHTML(today, tasks, nowMin) {
    const items = [
      ...this.store.eventsOn(today).map((e) => ({ kind: 'event', id: e.id, title: e.title, at: toMin(e.start), len: toMin(e.end) - toMin(e.start), done: e.done, color: EVENT_COLORS[e.color % EVENT_COLORS.length] })),
      ...tasks.filter((t) => t.at).map((t) => ({ kind: 'task', id: t.id, title: t.title, at: toMin(t.at), len: taskDur(t), done: t.done, color: tagOf(t.tag).color })),
    ].sort((a, b) => a.at - b.at || (a.kind === 'event' ? -1 : 1))
    const head = `<header class="td-h">${IC.cal}<h3>今日行程<small>きょうのよてい</small></h3><button type="button" class="td-more" data-act="cal" data-fk="cal">月曆<i>›</i></button></header>`
    if (!items.length) {
      return `<section class="td-card td-sched">${head}<div class="td-empty"><p>今天還沒有排時段的行程</p><button type="button" class="btn-ghost" data-act="tab" data-v="schedule" data-fk="to-sched">到日程排一下</button></div></section>`
    }
    const row = (it) => `<li class="td-ev${it.done ? ' done' : ''}${it.at + Math.max(it.len, 0) <= nowMin && !it.done ? ' past' : ''}" style="--c:${it.color}">
        <time>${hhmm(it.at)}</time><i class="td-dot"></i>
        <button type="button" class="td-evc" data-act="edit" data-type="${it.kind}" data-id="${esc(it.id)}" data-fk="ev-${esc(it.id)}">
          ${it.done ? IC.check : iconOf(it.title, it.kind)}<span>${esc(it.title)}</span>${it.len > 0 ? `<small>${dur(it.len)}</small>` : ''}
        </button></li>`
    const nowRow = `<li class="td-now" aria-label="現在 ${hhmm(nowMin)}"><time>${hhmm(nowMin)}</time><i></i></li>`
    const at = items.findIndex((it) => it.at > nowMin)
    const rows = items.map(row)
    rows.splice(at < 0 ? rows.length : at, 0, nowRow)
    return `<section class="td-card td-sched">${head}<ol class="td-tl">${rows.join('')}</ol></section>`
  }

  // ── 今日前三要務：今天的本命；不滿三件時，用還沒做的重要任務補位，按 ☆ 就選成本命 ──
  _topHTML(today, tasks) {
    // 做完的本命留在原位、劃掉就好，不會從手指底下跳走
    const order = (a, b) => b.priority - a.priority || (a.at ? toMin(a.at) : 1e4) - (b.at ? toMin(b.at) : 1e4) || a.createdAt - b.createdAt
    const stars = tasks.filter((t) => t.star).sort(order)
    const rest = tasks.filter((t) => !t.star && !t.done).sort(order)
    const list = [...stars, ...rest.slice(0, Math.max(0, 3 - stars.length))].slice(0, 3)
    const head = `<header class="td-h">${IC.target}<h3>今日前三要務<small>きょうのトップ3</small></h3><button type="button" class="td-more" data-act="tab" data-v="tasks" data-fk="to-tasks">查看全部任務<i>›</i></button></header>`
    if (!list.length) {
      return `<section class="td-card td-top">${head}<div class="td-empty"><p>${tasks.length ? '今天的任務都完成了，辛苦了' : '今天還沒有任務'}</p>${tasks.length ? '' : '<button type="button" class="btn-ghost" data-act="add" data-fk="add2">種下一件</button>'}</div></section>`
    }
    const row = (t, i) => {
      const k = esc(t.id)
      const tag = tagOf(t.tag)
      const sug = !t.star
      return `<li class="td-t n${i + 1}${t.done ? ' done' : ''}${sug ? ' sug' : ''}">
        <b class="td-n">${i + 1}</b>
        <button type="button" class="td-check" data-act="toggle" data-id="${k}" data-fk="tg-${k}" aria-label="${t.done ? '取消完成' : '完成'}「${esc(t.title)}」" aria-pressed="${!!t.done}">${ICON.check}</button>
        <div class="td-tm"><span>${esc(t.title)}</span><small><i style="--c:${tag.color}"></i>${tag.label}・${KANA_TAG[tag.id] || ''}${sug ? '<em>還不是本命</em>' : ''}</small></div>
        ${t.dur ? `<span class="td-dur">${IC.timer}${dur(t.dur)}</span>` : ''}
        ${sug ? `<button type="button" class="td-mini" data-act="star" data-id="${k}" data-fk="st-${k}" title="選為今天的本命（完成時雙倍 XP）" aria-label="把「${esc(t.title)}」選為本命">${IC.star}</button>` : ''}
        ${t.done ? '' : `<button type="button" class="td-mini" data-act="focus" data-id="${k}" data-fk="fc-${k}" title="專注在這件事上" aria-label="專注在「${esc(t.title)}」">${IC.play}</button>`}
      </li>`
    }
    const hint = stars.length < 3 && list.some((t) => !t.star) ? '<p class="td-hint">按 ☆ 把它選成本命：今天最重要的三件，完成時雙倍 XP</p>' : ''
    return `<section class="td-card td-top">${head}<ol class="td-tops">${list.map(row).join('')}</ol>${hint}</section>`
  }

  // ── 每日任務（三個）＋每週挑戰 ──
  _questHTML() {
    const s = this.store
    const w = s.weekly()
    const list = [...s.quests().map((q) => ({ ...q, xp: XP.quest })), { ...w, weekly: true, xp: XP.weekly }]
    const ready = list.some((q) => q.ready && !q.claimed)
    const row = (q) => {
      const st = q.claimed ? 'claimed' : q.ready ? 'ready' : ''
      const act = q.claimed
        ? '<span class="td-xp">已領取</span>'
        : q.ready
          ? `<button type="button" class="td-claim" data-act="claim" data-id="${esc(q.id)}"${q.weekly ? ' data-weekly="1"' : ''} data-fk="q-${esc(q.id)}">領取 +${q.xp} XP</button>`
          : `<span class="td-xp">+${q.xp} XP</span>`
      return `<li class="td-q ${st}${q.weekly ? ' td-weekly' : ''}">
        <span class="td-qc" aria-hidden="true">${q.claimed || q.ready ? ICON.check : ''}</span>
        <div class="td-qm"><b>${q.weekly ? '<i class="td-wk">週</i>' : ''}${esc(q.title)}<small>（${q.value}/${q.goal}）</small></b><div class="td-bar"><i style="width:${Math.round((q.value / q.goal) * 100)}%"></i></div></div>
        ${act}</li>`
    }
    return `<section class="td-card td-quest">
      <header class="td-h">${IC.spark}<h3>每日任務<small>デイリークエスト</small></h3>${ready ? '<button type="button" class="td-more" data-act="claimAll" data-fk="claimAll">全部領取<i>›</i></button>' : ''}</header>
      <ul class="td-qs">${list.map(row).join('')}</ul>
    </section>`
  }

  // ── 習慣養成：這週一到日，做到的打勾；今天那格點一下就打卡 ──
  _habitHTML(today) {
    const s = this.store
    const habits = s.state.habits.filter((h) => h.kind === 'build' && !h.archived)
    const head = `<header class="td-h">${IC.leaf}<h3>習慣養成<small>しゅうかん</small></h3><button type="button" class="td-more" data-act="tab" data-v="habits" data-fk="to-habits">管理習慣<i>›</i></button></header>`
    if (!habits.length) {
      return `<section class="td-card td-habit">${head}<div class="td-empty"><p>還沒有要養成的習慣</p><button type="button" class="btn-ghost" data-act="tab" data-v="habits" data-fk="to-habits2">從範本加一個</button></div></section>`
    }
    const mon = weekKey(today)
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i))
    const shown = habits.slice(0, 6)
    const cell = (h, d) => {
      const name = `${esc(h.name)} ${+d.slice(5, 7)}/${+d.slice(8)}`
      if (!applies(h, d)) return `<span class="td-dd off" title="${name}・休息日">·</span>`
      const ok = doneOn(h, d)
      if (d === today) {
        const n = countOn(h, d)
        const label = ok ? `今天的「${esc(h.name)}」已完成` : `「${esc(h.name)}」打卡${h.target > 1 ? `（${n}/${h.target}）` : ''}`
        return `<button type="button" class="td-dd today${ok ? ' ok' : ''}" data-act="habit" data-id="${esc(h.id)}" data-fk="hb-${esc(h.id)}" aria-label="${label}" title="${label}"${ok ? ' disabled' : ''}>${ok ? ICON.check : h.target > 1 && n ? `<b>${n}</b>` : ''}</button>`
      }
      if (d > today) return `<span class="td-dd future" title="${name}"></span>`
      return `<span class="td-dd${ok ? ' ok' : ' miss'}" title="${name}${ok ? '・完成' : ''}">${ok ? ICON.check : ''}</span>`
    }
    const rows = shown.map((h) => {
      const n = streak(h, today)
      return `<div class="td-hr" style="--c:${EVENT_COLORS[h.color % EVENT_COLORS.length]}">
        <span class="td-hic">${esc(h.icon)}</span><b class="td-hn">${esc(h.name)}${h.target > 1 ? `<small>${h.target} ${esc(h.unit)}</small>` : ''}</b>
        <small class="td-hs">${n ? `連續 ${n} 天` : '今天開始'}</small>
        ${days.map((d) => cell(h, d)).join('')}</div>`
    })
    const more = habits.length > shown.length ? `<button type="button" class="td-link" data-act="tab" data-v="habits">還有 ${habits.length - shown.length} 個習慣 ›</button>` : ''
    return `<section class="td-card td-habit">${head}
      <div class="td-hg"><div class="td-hr td-hw"><span></span><span></span><span></span>${days.map((d) => `<em class="${d === today ? 'on' : ''}">${WEEK_ZH[parseDate(d).getDay()]}</em>`).join('')}</div>${rows.join('')}</div>${more}
    </section>`
  }
}
