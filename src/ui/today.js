import './today.css'
import { $, esc, ICON } from './dom.js'
import { tagOf, EVENT_COLORS, XP, WEEK_ZH, MOODS } from '../theme.js'
import { TODAY_QUOTES, TODAY_LEADS } from '../data/todayLines.js'
import { addDays, parseDate, toMin, weekKey, REVIEW_TEXT } from '../store.js'
import { applies, countOn, doneOn, streak } from '../habits.js'
import { taskDur, nowGuide, toHHMM } from '../planner.js'
import heroDay from '../assets/today/hero-day.webp'
import heroNight from '../assets/today/hero-night.webp'

// App 模式的首頁「今日總覽」：今天的進度、一句話、今日行程、前三要務（本命）、每日任務、這週的習慣、今日反思。
// 只看今天（不跟著上方選的日期走）；資料一變就整頁重畫，焦點用 data-fk 接回去；每分鐘重畫一次讓「現在」的紅線往下走。
// 今日反思就是晚間回顧那一篇（store.saveReview）：重畫時把打到一半的字和游標接回去，中文組字中先不重畫

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
  pen: svg('<path d="M5 19l1.2-4.2L15.6 5.4a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9l-9.4 9.4z"/><path d="M14 7l3 3M4.5 19.5h7"/>'),
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
// 「3 小時 20 分」「45 分」
const hm = (m) => {
  const h = Math.floor(m / 60)
  return h ? `${h} 小時${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`
}
// 「現在」卡片：作息的哪一段、適合做什麼
const PHASE = {
  peak: ['精神最好的時段', '先做最重要、最需要專注的那件事'],
  dip: ['午後容易累', '做輕一點、短一點的事，或起來走走、喝杯水'],
  windDown: ['睡前一小時', '收尾的時間：寫今日反思、看一下明天，別再開新的大事'],
  over: ['過了就寢時間', '今天就到這裡，早點睡，明天再繼續'],
}
const phaseOf = (g, wake) => {
  if (PHASE[g.phase]) return PHASE[g.phase]
  if (g.phase === 'early') return ['還沒到起床時間', `起床是 ${wake}；早起的話先喝水、伸展，看一下今天的行程`]
  if (g.nowMin < 12 * 60) return ['上午', '頭腦還清楚：推進一件重要的事']
  if (g.nowMin < 18 * 60) return ['下午', '適合處理溝通、整理和例行的事']
  return ['晚上', '適合學習、閱讀，或做自己想做的事']
}

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
    // 對齊到整分：「現在」的時鐘跟手機上的時間同一刻跳
    setTimeout(() => {
      this._tick()
      setInterval(() => this._tick(), 60000)
    }, 60000 - (Date.now() % 60000) + 50)
    // 今日反思：選了天氣還沒記下（refMood）、Ctrl／⌘＋Enter 記下；中文組字中先不重畫，組完再補
    this.refMood = null
    this.refDate = null
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches?.('.td-ref-text') && !e.isComposing) {
        e.preventDefault()
        this._saveRef()
      }
    })
    root.addEventListener('input', (e) => {
      if (e.target.matches?.('.td-ref-text')) this._syncRefBtn()
    })
    root.addEventListener('compositionstart', () => (this._composing = true))
    root.addEventListener('compositionend', () => {
      this._composing = false
      if (this._held) {
        this._held = false
        this.render()
      }
    })
  }

  _tick() {
    this._late = this._down
    // 正在寫反思：只換時鐘的數字，其他的晚一點再重畫，不打斷打字
    if (document.activeElement?.matches?.('.td-ref-text')) {
      const t = $('.tn-time', this.root)
      const n = new Date()
      if (t) t.textContent = hhmm(n.getHours() * 60 + n.getMinutes())
      return
    }
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
      case 'focus':
        // 已經在專注這件了：不用重來
        if (id === this.hooks.focusTaskId?.()) return
        return this.hooks.startFocus(id)
      case 'more':
        this.moreOpen = !this.moreOpen
        return this.render()
      case 'claim': return b.dataset.weekly ? s.claimWeekly() : s.claimQuest(id)
      case 'claimAll':
        for (const q of s.quests()) if (q.ready && !q.claimed) s.claimQuest(q.id)
        if (s.weekly().ready && !s.weekly().claimed) s.claimWeekly()
        return
      case 'habit': return s.checkHabit(id)
      case 'slot': return s.updateTask(id, { at: b.dataset.v })
      case 'mood':
        this.refMood = b.dataset.v
        this.refDate = s.today
        return this.render()
      case 'refSave': return this._saveRef()
    }
  }

  // 記下今日反思：天氣用剛選的、沒選就沿用已經記下的那個。
  // 記在框子畫出來的那一天：23:58 開始寫、過了午夜才按，記在昨天，不會跑到今天
  _saveRef() {
    const s = this.store
    const ta = $('.td-ref-text', this.root)
    const day = ta?.dataset.day || s.today
    const mood = this._refMood(day) || s.state.journal[day]?.mood
    if (!mood || !ta) return
    this.refMood = null
    // 存完會重畫：框裡的字就是剛記下的，不用當成打到一半的接回去
    this._clean = true
    s.saveReview(day, mood, ta.value)
  }
  // 選了但還沒記下的天氣（只算選的那一天）
  _refMood(day = this.store.today) {
    return this.refDate === day ? this.refMood : null
  }
  // 框裡的字跟記下的不一樣：標出「還沒記下」
  _syncRefBtn() {
    const ta = $('.td-ref-text', this.root)
    const box = ta?.closest('.td-ref')
    if (box) box.classList.toggle('dirty', ta.value.trim() !== ta.defaultValue.trim() || !!this._refMood())
  }

  render() {
    // 中文組字中：整頁換掉會打斷組字，組完再畫
    if (this._composing) {
      this._held = true
      return
    }
    // 焦點在某個按鈕上（例如剛勾完一件）：重畫後接回同一個；那個按鈕不見了（☆ 選成本命、推薦的那件做完了），
    // 就接到同一件的勾選或專注鈕，再不然是同一張卡片裡的第一個按鈕
    const a = document.activeElement
    const fk = this.root.contains(a) ? a.dataset.fk : null
    const card = fk && [...(a.closest('.td-card')?.classList || [])].find((c) => c !== 'td-card')
    // 行程、習慣卡片裡捲到的位置也留著
    const scroll = ['.td-tl', '.td-hg'].map((sel) => [sel, $(sel, this.root)?.scrollTop, $(sel, this.root)?.scrollLeft])
    // 今日反思打到一半的字（跟記下的不一樣才算）和游標
    const ta = $('.td-ref-text', this.root)
    let draft = !this._clean && ta && ta.value !== ta.defaultValue ? ta.value : null
    const caret = ta && ta === a ? [ta.selectionStart, ta.selectionEnd] : null
    this._clean = false
    const s = this.store
    const today = s.today
    // 過了午夜：昨天打到一半的反思不搬進今天的框。那天選好了天氣（或早就記過）就幫它記在那天；
    // 還沒選天氣的才留在今天的框裡（字不會不見）
    const day = ta?.dataset.day
    if (draft != null && day && day !== today) {
      const mood = this._refMood(day) || s.state.journal[day]?.mood
      if (mood) {
        const text = draft
        draft = null
        queueMicrotask(() => s.saveReview(day, mood, text))
      }
    }
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const tasks = s.tasksOn(today)
    this.root.innerHTML = `<div class="td${this._drawn ? '' : ' td-enter'}">
      ${this._heroHTML(today, tasks, now)}
      <div class="td-grid">
        ${this._nowHTML(today, tasks, nowMin)}
        ${this._progHTML(tasks, nowMin)}
        ${this._quoteHTML(today)}
        ${this._schedHTML(today, tasks, nowMin)}
        ${this._topHTML(today, tasks)}
        ${this._questHTML()}
        ${this._habitHTML(today)}
        ${this._refHTML(today)}
      </div>
    </div>`
    this._drawn = true
    for (const [sel, top, left] of scroll) {
      const el = $(sel, this.root)
      if (el && top != null) Object.assign(el, { scrollTop: top, scrollLeft: left })
    }
    const nt = $('.td-ref-text', this.root)
    if (nt && draft != null) {
      nt.value = draft
      this._syncRefBtn()
    }
    if (!fk) return
    const id = fk.replace(/^[a-z]+-/, '')
    const by = (k) => $(`[data-fk="${CSS.escape(k)}"]:not(:disabled)`, this.root)
    const to = by(fk) || by(`tg-${id}`) || by(`fc-${id}`) || (card && ($(`.${card} :is(li, .td-hr) button:not(:disabled)`, this.root) || $(`.${card} button:not(:disabled)`, this.root)))
    to?.focus({ preventScroll: true })
    if (to === nt && caret) nt.setSelectionRange(...caret)
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

  // ── 現在：幾點、到就寢還有多久、扣掉三餐／行程／已排的任務還剩多少空檔、眼前這段空檔適合做什麼 ──
  _nowHTML(today, tasks, nowMin) {
    const s = this.store
    const r = s.state.rhythm
    const g = nowGuide({ rhythm: r, date: today, nowMin, events: s.eventsOn(today), tasks })
    const [label, tip] = phaseOf(g, r.wake)
    const awake = g.phase !== 'early' && g.phase !== 'over'
    const num = (k, v, sub = '') => `<div><dt>${k}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ''}</dd></div>`
    const nums = awake
      ? num('距離就寢', hm(g.toBed), hhmm(g.bed)) + num('還能做事的空檔', hm(g.freeMin), '扣掉三餐、行程和已排的任務')
        + num('還沒排時段的任務', `${g.open.count} 件`, g.open.count ? `約 ${hm(g.open.min)}${g.open.min > g.freeMin ? '・放不下全部' : ''}` : '')
      : num('就寢', r.sleep) + num('起床', r.wake)
    // 從現在到就寢：空檔畫成亮的
    const bar = awake && g.toBed > 0
      ? `<div class="tn-bar" role="img" aria-label="從現在到就寢 ${hm(g.toBed)}，空檔共 ${hm(g.freeMin)}">${g.free.map(([a, b]) => `<i style="left:${((a - nowMin) / g.toBed) * 100}%;width:${((b - a) / g.toBed) * 100}%"></i>`).join('')}</div>
        <div class="tn-axis"><span>現在</span><span>${hhmm(g.bed)} 就寢</span></div>`
      : ''
    // 現在正在做的、眼前這段空檔
    let line = ''
    if (g.current) line = `<b>${g.current.kind === 'task' ? '正在做' : '正在'}</b>${esc(g.current.title)}（到 ${hhmm(g.current.end)}）`
    // 排在現在這段的任務：一鍵開始專注
    const cur = g.current?.kind === 'task' && g.current.id
    if (cur) {
      line += cur === this.hooks.focusTaskId?.()
        ? ' <em class="td-focusing">專注中</em>'
        : ` <button type="button" class="tn-go" data-act="focus" data-id="${esc(cur)}" data-fk="cur-${esc(cur)}" aria-label="專注在「${esc(g.current.title)}」">${IC.play}專注</button>`
    }
    if (awake && g.next) {
      const room = g.next.end - g.next.start
      line += `${line ? '<span>・</span>' : ''}${g.next.start <= nowMin + 1 ? `現在到 ${hhmm(g.next.end)} 有 <b>${hm(room)}</b> 空檔` : `下一段空檔 ${hhmm(g.next.start)}–${hhmm(g.next.end)}（<b>${hm(room)}</b>）`}`
    } else if (awake && g.phase !== 'windDown') line += `${line ? '<span>・</span>' : ''}今天剩下的時間都排滿了`
    // 放得下眼前這段的任務：專注、或直接排進這段
    const slotAt = g.next && toHHMM(Math.min(Math.ceil(g.next.start / 5) * 5, g.next.end))
    const fit = (t) => {
      const k = esc(t.id)
      const d = taskDur(t)
      const at = Math.ceil(g.next.start / 5) * 5 + d <= g.next.end ? slotAt : toHHMM(g.next.start)
      return `<li><i style="--c:${tagOf(t.tag).color}"></i>${this._focusName(t, `${t.star ? '★ ' : ''}${esc(t.title)}`, 'tn-name', `nf-${k}`)}<small>${dur(d)}</small>
        <button type="button" class="td-mini" data-act="focus" data-id="${k}" tabindex="-1" aria-hidden="true" title="專注在這件事上">${IC.play}</button>
        <button type="button" class="tn-slot" data-act="slot" data-id="${k}" data-v="${at}" data-fk="ns-${k}" title="排進這段空檔">排進 ${at}</button></li>`
    }
    let sug = ''
    if (g.fits.length) sug = `<p class="tn-k">適合現在做</p><ul class="tn-fits">${g.fits.map(fit).join('')}</ul>`
    else if (awake && g.phase !== 'windDown' && g.next) {
      const room = g.next.end - g.next.start
      sug = `<p class="tn-none">${room < 10 ? '空檔很短：喝口水、伸展一下就好'
        : g.open.count ? '還沒排的任務都比這段空檔長：先做其中一小段，或到日程排進後面的空檔'
          : g.scheduled.count ? '今天的任務都排好時段了，照著走就好' : '今天沒有還沒做的任務：可以加一件，或好好休息'}</p>`
    }
    const habits = awake ? s.state.habits.filter((h) => h.kind === 'build' && !h.archived && applies(h, today) && !doneOn(h, today)) : []
    const hb = habits.length ? `<p class="tn-hb">還沒打卡的習慣：${habits.slice(0, 4).map((h) => esc(h.name)).join('、')}${habits.length > 4 ? '…' : ''}</p>` : ''
    return `<section class="td-card td-nowc tn-${g.phase}" aria-label="現在">
      <header class="td-h">${IC.clock}<h3>現在<small>いま</small></h3><button type="button" class="td-more" data-act="tab" data-v="schedule" data-fk="to-plan">到日程排一下<i>›</i></button></header>
      <div class="tn-top">
        <div class="tn-clock"><b class="tn-time">${hhmm(nowMin)}</b><span>${label}</span></div>
        <dl class="tn-nums">${nums}</dl>
      </div>
      ${bar}
      ${line ? `<p class="tn-line">${line}</p>` : ''}
      <p class="tn-tip">${esc(tip)}</p>
      ${sug}${hb}
    </section>`
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
      // 做完的任務不留在行程裡（日程做完了照樣留著，跟日程分頁的時間軸一樣）
      ...tasks.filter((t) => t.at && !t.done).map((t) => ({ kind: 'task', id: t.id, title: t.title, at: toMin(t.at), len: taskDur(t), done: t.done, color: tagOf(t.tag).color })),
    ].sort((a, b) => a.at - b.at || (a.kind === 'event' ? -1 : 1))
    // 整天的日程（朋友來玩、旅行）排在最上面，不在時間線上
    const all = this.store.allDayOn(today)
    const allHTML = all.length
      ? `<div class="td-allday">${all
        .map((e) => {
          const multi = e.endDate && e.endDate !== e.date
          const nth = multi ? `<small>第 ${Math.round((parseDate(today) - parseDate(e.date)) / 864e5) + 1}／${Math.round((parseDate(e.endDate) - parseDate(e.date)) / 864e5) + 1} 天</small>` : ''
          return `<button type="button" class="td-adc" data-act="edit" data-type="event" data-id="${esc(e.id)}" data-fk="ad-${esc(e.id)}" style="--c:${EVENT_COLORS[e.color % EVENT_COLORS.length]}"><em>整天</em><span>${esc(e.title)}</span>${nth}</button>`
        })
        .join('')}</div>`
      : ''
    const head = `<header class="td-h">${IC.cal}<h3>今日行程<small>きょうのよてい</small></h3><button type="button" class="td-more" data-act="cal" data-fk="cal">月曆<i>›</i></button></header>${allHTML}`
    if (!items.length) {
      return `<section class="td-card td-sched">${head}<div class="td-empty"><p>今天還沒有排時段的行程</p><button type="button" class="btn-ghost" data-act="tab" data-v="schedule" data-fk="to-sched">到日程排一下</button></div></section>`
    }
    // 任務旁邊多一顆 ▶：直接開始專注（點色塊本身照舊是編輯）
    const focusId = this.hooks.focusTaskId?.()
    const go = (it) => {
      if (it.kind !== 'task' || it.done) return ''
      const k = esc(it.id)
      return it.id === focusId
        ? '<span class="td-focusing" title="正在專注這件事">專注中</span>'
        : `<button type="button" class="td-mini" data-act="focus" data-id="${k}" data-fk="eg-${k}" title="專注在這件事上" aria-label="專注在「${esc(it.title)}」">${IC.play}</button>`
    }
    const row = (it) => `<li class="td-ev${it.done ? ' done' : ''}${it.at + Math.max(it.len, 0) <= nowMin && !it.done ? ' past' : ''}${it.kind === 'task' && !it.done ? ' has-go' : ''}" style="--c:${it.color}">
        <time>${hhmm(it.at)}</time><i class="td-dot"></i>
        <button type="button" class="td-evc" data-act="edit" data-type="${it.kind}" data-id="${esc(it.id)}" data-fk="ev-${esc(it.id)}">
          ${it.done ? IC.check : iconOf(it.title, it.kind)}<span>${esc(it.title)}</span>${it.len > 0 ? `<small>${dur(it.len)}</small>` : ''}
        </button>${go(it)}</li>`
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
    const focusId = this.hooks.focusTaskId?.()
    const row = (t, i) => {
      const k = esc(t.id)
      const tag = tagOf(t.tag)
      const sug = !t.star
      const subs = t.subs || []
      const sub = subs.length ? `・子任務 ${subs.filter((x) => x.done).length}/${subs.length}` : ''
      const on = t.id === focusId
      const meta = `<span>${esc(t.title)}</span><small><i style="--c:${tag.color}"></i>${tag.label}・${KANA_TAG[tag.id] || ''}${sub}${on ? '<em class="td-focusing">專注中</em>' : sug ? '<em>還不是本命</em>' : ''}</small>`
      return `<li class="td-t n${i + 1}${t.done ? ' done' : ''}${sug ? ' sug' : ''}${on ? ' on' : ''}">
        <b class="td-n">${i + 1}</b>
        <button type="button" class="td-check" data-act="toggle" data-id="${k}" data-fk="tg-${k}" aria-label="完成「${esc(t.title)}」" aria-pressed="${!!t.done}">${ICON.check}</button>
        ${this._focusName(t, meta, 'td-tm', `fc-${k}`)}
        ${t.dur ? `<span class="td-dur">${IC.timer}${dur(t.dur)}</span>` : ''}
        ${sug ? `<button type="button" class="td-mini" data-act="star" data-id="${k}" data-fk="st-${k}" title="選為今天的本命（完成時雙倍 XP）" aria-label="把「${esc(t.title)}」選為本命">${IC.star}</button>` : ''}
        ${t.done || on ? '' : `<button type="button" class="td-mini" data-act="focus" data-id="${k}" tabindex="-1" aria-hidden="true" title="專注在這件事上">${IC.play}</button>`}
      </li>`
    }
    const hint = stars.length < 3 && list.some((t) => !t.star) ? '<p class="td-hint">按 ☆ 把它選成本命：今天最重要的三件，完成時雙倍 XP</p>' : ''
    return `<section class="td-card td-top">${head}<ol class="td-tops">${list.map(row).join('')}</ol>${hint}${this._moreHTML(tasks, list, focusId)}</section>`
  }

  // 任務名稱：還沒做完的是一顆按鈕，點了就開始專注（旁邊的 ▶ 只是給滑鼠的捷徑，鍵盤走名稱這顆）
  _focusName(t, inner, cls, fk) {
    if (t.done) return `<div class="${cls}">${inner}</div>`
    const k = esc(t.id)
    const label = t.id === this.hooks.focusTaskId?.() ? `正在專注「${esc(t.title)}」` : `專注在「${esc(t.title)}」`
    return `<button type="button" class="${cls} td-go" data-act="focus" data-id="${k}" data-fk="${fk}" title="點一下選怎麼專注（倒數、正向、長度、輪數）" aria-label="${label}">${inner}</button>`
  }

  // 前三件以外、今天還沒做的任務：收在「其他任務」裡，展開後一樣點名稱就開始專注
  _moreHTML(tasks, shown, focusId) {
    const ids = new Set(shown.map((t) => t.id))
    const order = (a, b) => b.priority - a.priority || (a.at ? toMin(a.at) : 1e4) - (b.at ? toMin(b.at) : 1e4) || a.createdAt - b.createdAt
    const rest = tasks.filter((t) => !t.done && !ids.has(t.id)).sort(order)
    if (!rest.length) return ''
    const open = this.moreOpen
    const row = (t) => {
      const k = esc(t.id)
      const on = t.id === focusId
      const inner = `<i style="--c:${tagOf(t.tag).color}"></i><span>${esc(t.title)}</span>${on ? '<em class="td-focusing">專注中</em>' : ''}${t.at ? `<small>${t.at}</small>` : ''}<small>${dur(taskDur(t))}</small>`
      return `<li>
        <button type="button" class="td-check" data-act="toggle" data-id="${k}" data-fk="tg-${k}" aria-label="完成「${esc(t.title)}」" aria-pressed="false">${ICON.check}</button>
        ${this._focusName(t, inner, 'td-mo', `mo-${k}`)}
        ${on ? '' : `<button type="button" class="td-mini" data-act="focus" data-id="${k}" tabindex="-1" aria-hidden="true" title="專注在這件事上">${IC.play}</button>`}</li>`
    }
    return `<button type="button" class="td-more-btn" data-act="more" data-fk="more" aria-expanded="${open}">${open ? '收起' : `其他今天的任務 ${rest.length} 件`}<i>${open ? '▴' : '▾'}</i></button>
      ${open ? `<ul class="td-mos">${rest.map(row).join('')}</ul>` : ''}`
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

  // ── 今日反思：選今天的天氣、寫幾句話（就是晚間回顧那一篇，第一次記下有經驗值） ──
  _refHTML(today) {
    const s = this.store
    const saved = s.state.journal[today]
    const mood = this._refMood() || saved?.mood || null
    const pending = this._refMood() && this._refMood() !== saved?.mood
    const at = saved ? new Date(saved.at) : null
    const stamp = at ? `<small class="td-ref-at">${pending ? '天氣還沒記下' : `已記下・${pad(at.getHours())}:${pad(at.getMinutes())}`}</small>` : ''
    const moods = MOODS.map((m) => `<button type="button" class="td-mood${m.key === mood ? ' on' : ''}" data-act="mood" data-v="${m.key}" data-fk="md-${m.key}" style="--mc:${m.color}" aria-pressed="${m.key === mood}" title="${m.desc}"><b>${m.kanji}</b><span>${m.name}</span></button>`).join('')
    const hint = !mood
      ? '先選今天的天氣，再記下來'
      : saved
        ? '晚上的回顧也是這一篇；紀錄頁的小日記和日曆上看得到'
        : `第一次記下 +${XP.review} XP・Ctrl＋Enter 也可以記下`
    return `<section class="td-card td-ref${pending ? ' dirty' : ''}" aria-label="今日反思">
      <header class="td-h">${IC.pen}<h3>今日反思<small>きょうのふりかえり</small></h3>${stamp}</header>
      <div class="td-moods" role="group" aria-label="今天的天氣（心情）">${moods}</div>
      <textarea class="td-ref-text" data-fk="ref-text" data-day="${today}" rows="3" maxlength="${REVIEW_TEXT}" aria-label="今日反思"
        placeholder="今天過得怎麼樣？做得好的、想改進的、明天想試試的">${esc(saved?.text || '')}</textarea>
      <div class="td-ref-row"><small class="td-ref-hint">${hint}</small><em class="td-ref-dirty">還沒記下</em>
        <button type="button" class="btn-primary td-ref-save" data-act="refSave" data-fk="ref-save"${mood ? '' : ' disabled'}>${saved ? '更新' : '記下來'}</button></div>
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
