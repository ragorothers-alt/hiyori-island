import './schedule.css'
import { $, esc, ICON, armConfirm, WEEK_ZH, pickOne, setOn, keepFocus } from './dom.js'
import { EVENT_COLORS, TAGS, tagOf, PRIORITIES } from '../theme.js'
import { addDays, daysBetween, parseDate, toMin, minToHHMM, weekKey, floating, overnight, shiftEnd } from '../store.js'
import { rhythmBlocks, itemBlocks, findConflicts, taskDur, fmtDur, nearestSlot, optimizeDay, awake, PEAKS, sleepMinutes, SPLIT_MIN } from '../planner.js'
import { taskMilestone } from '../projects.js'
import { haptic } from './haptics.js'
import { isExternal } from '../calendars.js'

const clipTitle = (s, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
// 教練的「計畫」（ふじ照想主攻的事和有空的時段，排成一段一段新的任務）：任務頁、日程頁空著的那天都從這顆進去。
// 跟「最佳化時程」（把已經有的任務排進空檔）不一樣，名字也分開
export const COACH_LABEL = '讓ふじ排主攻時段'
export const COACH_TIP = '說想主攻什麼、什麼時候有空，ふじ排成一段一段的時間'

// 日程分頁：週條、早晨的睡眠小卡、排程列、還沒排時段的任務、可拖曳的一日時間軸、作息設定與編輯面板

const PX = 1.1 // 時間軸每分鐘幾像素
const MIN_H = 22 // 區塊最矮的高度
const hm = (m) => minToHHMM(Math.max(0, Math.min(1439, Math.round(m))))
const snap = (m) => Math.round(m / 5) * 5
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const nowMin = () => {
  const n = new Date()
  return n.getHours() * 60 + n.getMinutes()
}
const QUALITY = ['', '沒睡好', '不太好', '普通', '不錯', '很好']
const DURS = [15, 30, 45, 60, 90, 120, 180]
const SKIP_KEY = 'hiyori-sleep-skip'

// 重疊的區塊並排：同一群互相重疊的區塊平分寬度
function lanes(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const minLen = MIN_H / PX
  let group = []
  let ends = []
  let groupEnd = -1
  const flush = () => {
    const n = Math.max(1, ...group.map((x) => x.lane + 1))
    for (const x of group) x.lanes = n
    group = []
    ends = []
  }
  for (const it of sorted) {
    const end = Math.max(it.end, it.start + minLen)
    if (group.length && it.start >= groupEnd) flush()
    let lane = ends.findIndex((e) => e <= it.start)
    if (lane < 0) lane = ends.length
    ends[lane] = end
    it.lane = lane
    group.push(it)
    groupEnd = Math.max(groupEnd, end)
  }
  flush()
  return sorted
}

export class ScheduleView {
  constructor(store, hooks) {
    this.store = store
    this.hooks = hooks
    this.preview = null // 最佳化時程的預覽 { date, result }
    this.drag = null
    this.scrolledFor = ''
    this.editing = null
    this.range = [0, 1440]
    this._bind()
  }

  // ── 渲染 ──
  render(force = true) {
    // 拖曳中不要重畫（每分鐘的刷新也一樣）
    if (this.drag?.moved) return
    const s = this.store
    if (this.preview && (this.preview.date !== s.selectedDate || s.selectedDate < s.today)) this.preview = null
    // 每分鐘的刷新、資料一變的重畫：鍵盤停在哪一顆，畫完還在那一顆
    keepFocus($('[data-page="schedule"]'), () => {
      this._week()
      this._sleepCard()
      this._allDay()
      this._planBar()
      this._tray()
      this._dayline()
    })
    if (force) this._rhythm()
  }

  _week() {
    const s = this.store
    const mon = weekKey(s.selectedDate)
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i))
    $('#weekStrip').innerHTML =
      `<button class="ws-nav" data-week="-7" aria-label="上一週">${ICON.prev}</button>` +
      days
        .map((d) => {
          const dd = parseDate(d)
          const ev = s.eventsOn(d).length + s.allDayOn(d).length
          const left = s.tasksOn(d).filter((t) => !t.done).length
          const name = `${dd.getMonth() + 1}/${dd.getDate()}（${WEEK_ZH[dd.getDay()]}）${ev ? `・${ev} 個日程` : ''}${left ? `・${left} 件待辦` : ''}`
          return `<button class="ws-day ${d === s.selectedDate ? 'on' : ''} ${d === s.today ? 'today' : ''} ${dd.getDay() % 6 === 0 ? 'weekend' : ''}" data-date="${d}" aria-label="${name}" aria-pressed="${d === s.selectedDate}"${d === s.today ? ' aria-current="date"' : ''}>
            <small>${WEEK_ZH[dd.getDay()]}</small><b>${dd.getDate()}</b><i>${ev ? '<em class="e"></em>' : ''}${left ? '<em class="t"></em>' : ''}</i></button>`
        })
        .join('') +
      `<button class="ws-nav" data-week="7" aria-label="下一週">${ICON.next}</button>` +
      `<button class="ws-nav ws-cal" data-cal title="打開日曆（C）" aria-label="打開日曆">${ICON.cal}</button>`
  }

  // 早上還沒記睡眠時，邀請記一下
  _sleepCard() {
    const s = this.store
    const el = $('#sleepCard')
    if (el.contains(document.activeElement)) return
    const h = new Date().getHours()
    let skip = ''
    try {
      skip = localStorage.getItem(SKIP_KEY) || ''
    } catch {}
    if (s.selectedDate !== s.today || s.state.sleep[s.today] || h < 4 || h >= 14 || skip === s.today) {
      el.innerHTML = ''
      return
    }
    const r = s.state.rhythm
    el.innerHTML = `<form class="sleep-card">
      <div class="sc-head"><span class="stamp-k" style="--mc:#a9a3e6">眠</span>
        <div><b>昨晚睡得好嗎？</b><small>記下來，ふじ會幫你留意作息</small></div>
        <button type="button" class="mini" data-skip title="今天先不記" aria-label="今天先不記">${ICON.close}</button></div>
      <div class="form-row">
        <label class="time-field">就寢 <input type="time" name="bed" value="${r.sleep}"></label><span class="tilde">→</span>
        <label class="time-field">起床 <input type="time" name="wake" value="${r.wake}"></label>
      </div>
      <div class="form-row sc-foot"><div class="seg" data-q>${[1, 2, 3, 4, 5].map((q) => `<button type="button" data-v="${q}" class="${q === 3 ? 'on' : ''}" aria-pressed="${q === 3}">${QUALITY[q]}</button>`).join('')}</div>
        <button class="btn-primary" type="submit">記下</button></div>
    </form>`
  }

  // 這天的整天日程（朋友來玩、旅行…）：排在時間軸上面，不佔時段；點一下編輯
  _allDay() {
    const s = this.store
    const date = s.selectedDate
    const list = s.allDayOn(date)
    const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`
    $('#allDayBar').innerHTML = list.length
      ? `<span class="ad-k">整天</span>${list
        .map((e) => {
          const multi = e.endDate && e.endDate !== e.date
          const sub = multi ? `${md(e.date)}–${md(e.endDate)}・第 ${daysBetween(e.date, date) + 1}／${daysBetween(e.date, e.endDate) + 1} 天` : ''
          return `<button type="button" class="ad-chip" data-ad="${esc(e.id)}" style="--c:${EVENT_COLORS[e.color % EVENT_COLORS.length]}" title="編輯${multi ? `（${md(e.date)}–${md(e.endDate)}）` : ''}"><b>${esc(e.title)}</b>${sub ? `<small>${sub}</small>` : ''}</button>`
        })
        .join('')}`
      : ''
  }

  // 目前已排的狀況（不含還沒排的任務）
  _current(date) {
    const s = this.store
    return optimizeDay({
      tasks: s.tasksOn(date).filter((t) => t.at), events: s.eventsOn(date), rhythm: s.state.rhythm, date, today: s.today,
      nowMin: date === s.today ? nowMin() : null,
    })
  }

  _planBar() {
    const s = this.store
    const date = s.selectedDate
    const past = date < s.today
    const tasks = s.planTasks(date)
    const placed = s.tasksOn(date).filter((t) => t.at && !t.done)
    const unplaced = tasks.filter((t) => !t.at && !t.done)
    const p = this.preview?.result
    let html
    if (p) {
      // 排進去的那幾件直接列在這裡（幾點到幾點）：任務一多，時間軸在很下面，不用捲下去也核對得到
      const byId = new Map(s.state.tasks.map((t) => [t.id, t]))
      const rows = [...p.plan].sort((a, b) => toMin(a.at) - toMin(b.at))
      const SHOW = 8
      // 逾期的會從原本那天移過來：標出原本是哪一天
      const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`
      const from = (t) => (t && t.date < date ? `<em class="pb-from">原本 ${md(t.date)}</em>` : '')
      const moved = rows.filter((x) => byId.get(x.id)?.date < date).length
      const list = rows.length
        ? `<ol class="pb-list">${rows
            .slice(0, SHOW)
            .map((x) => `<li><time>${x.at}–${hm(toMin(x.at) + x.dur)}</time><span>${esc(clipTitle(byId.get(x.id)?.title || ''))}</span>${from(byId.get(x.id))}</li>`)
            .join('')}${rows.length > SHOW ? `<li class="more">還有 ${rows.length - SHOW} 件，見時間軸的虛線</li>` : ''}</ol>`
        : ''
      html = `<div class="pb-preview">
        <div class="pb-msg">${ICON.spark}<div><b>${p.plan.length ? `預覽：排入 ${p.plan.length} 件` : '暫時沒有可排入的任務'}</b>${p.endAt ? `<small>預計 ${p.endAt} 任務結束・虛線是預覽</small>` : ''}
          ${moved ? `<small class="warn">其中 ${moved} 件是逾期的，會從原本那天移到這天（套用後可以撤銷）</small>` : ''}
          ${p.left.length ? `<small class="warn">還有 ${p.left.length} 件未排入${p.full?.length ? `（其中 ${p.full.length} 件是為了留白、不排太滿）` : ''}${p.unslot?.length ? `，${p.unslot.length} 件原本的時段會空出來` : ''}，改天安排也可以</small>` : ''}
          ${p.big?.length ? `<small class="warn">${p.big.map((id) => `「${esc(clipTitle(s.state.tasks.find((t) => t.id === id)?.title || ''))}」`).join('')}比這天哪一段空檔都長 <button type="button" class="cm-link" data-plan="split">分成幾段、分到幾天做</button></small>` : ''}${list}</div></div>
        <div class="pb-btns"><button class="btn-ghost" data-plan="cancel">取消</button>
          ${placed.length && !this.preview.replan ? '<button class="btn-ghost" data-plan="replan">重排未開始的任務</button>' : ''}
          <button class="btn-primary" data-plan="apply" ${p.plan.length ? '' : 'disabled'}>套用</button></div></div>`
    } else {
      const cur = this._current(date)
      const sl = s.state.sleep[date]
      html = `<div class="pb-stats">
          <span><b>${fmtDur(cur.load)}</b>任務已排</span>
          <span><b>${past ? '—' : fmtDur(cur.free)}</b>空檔</span>
          <span><b>${cur.endAt || '—'}</b>任務結束</span>
          ${sl ? `<span title="${sl.bed} → ${sl.wake}"><b>${fmtDur(sleepMinutes(sl))}</b>睡眠</span>` : ''}
        </div>
        <div class="pb-btns">
          ${this._lastPlan?.date === date ? '<button class="btn-ghost" data-plan="undo-last">撤銷剛才的排程</button>' : ''}
          ${placed.length ? '<button class="btn-ghost" data-plan="clear">清除任務時段</button>' : ''}
          ${!past && !tasks.some((t) => !t.done) ? `<button class="btn-ghost" data-plan="coach" title="${COACH_TIP}">${COACH_LABEL}</button>` : ''}
          <button class="btn-primary pb-opt" data-plan="optimize" ${past || (!unplaced.length && !placed.length) ? 'disabled' : ''} title="${past ? '只能替今天和之後的日子排時段' :'把還沒排的任務放進空檔'}">${ICON.spark}最佳化時程</button>
        </div>`
    }
    $('#planBar').innerHTML = html
    $('#planBar').classList.toggle('previewing', !!p)
  }

  // 撤銷剛才的排程（提示卡上、排程列上的按鈕都是這個）：之後又改過的那幾件留著現在的樣子
  _undoLastPlan() {
    const last = this._lastPlan
    if (!last) return
    this._lastPlan = null
    const r = this.store.undoPlan(last.u, { skip: [this.hooks.timing?.()].filter(Boolean) })
    this.render(false)
    this.hooks.dropToasts?.('scheduled')
    if (!r.back) return this.hooks.toast({ icon: '時', title: '排好之後又改過了', sub: '就留著現在的樣子', ms: 3400 })
    if (r.kept) this.hooks.toast({ icon: '時', title: `放回 ${r.back} 件`, sub: `${r.kept} 件排好之後又改過，留著現在的樣子`, ms: 4200 })
    else this.hooks.toast({ icon: '時', title: `放回 ${r.back} 件`, sub: '回到排之前的樣子（逾期的回到原本那天）', ms: 4200 })
  }

  _tray() {
    const s = this.store
    const date = s.selectedDate
    const all = s.planTasks(date).filter((t) => !t.at && !t.done)
    const planned = new Set(this.preview?.result.plan.map((p) => p.id) || [])
    // 很多件的時候先收起來（預覽排進去的那幾件排前面、一定看得到）：不然時間軸被擠到好幾頁之後
    const SHOW = 12
    const sorted = planned.size ? [...all.filter((t) => planned.has(t.id)), ...all.filter((t) => !planned.has(t.id))] : all
    const open = this._trayOpen || all.length <= SHOW + 2
    const list = open ? sorted : sorted.slice(0, SHOW)
    const more = all.length > SHOW + 2 ? `<button type="button" class="tray-more" data-tray-more aria-expanded="${open}">${open ? '收起來 ▴' : `還有 ${all.length - SHOW} 件 ▾`}</button>` : ''
    $('#planTray').innerHTML = all.length
      ? `<div class="tray-head">還沒排時段 · ${all.length}<small>點一下排進最近的空檔，或拖到時間軸上</small></div>
        <div class="tray-list">${list
          .map(
            // 放進空檔的按鈕和調整時間的按鈕並排（不包在一起：讀螢幕軟體才分得出是兩個按鈕）
            (t) => `<div class="chip-task ${planned.has(t.id) ? 'planned' : ''} ${t.date < date ? 'late' : ''}" data-id="${esc(t.id)}" style="--c:${tagOf(t.tag).color}">
              <button type="button" class="chip-slot" data-slot title="排進最近的空檔"><i class="pri p${t.priority}" title="${PRIORITIES[t.priority].label}優先"></i>${t.star ? '<em class="star" title="本命">★</em>' : ''}${t.date < date ? '<em class="late-tag">逾期</em>' : ''}<span>${esc(t.title)}</span></button><button type="button" class="dur" data-dur title="預估時間（點一下調整）" aria-label="預估 ${fmtDur(taskDur(t))}，點一下調整">${fmtDur(taskDur(t))}</button></div>`,
          )
          .join('')}</div>${more}`
      : ''
  }

  _dayline() {
    const s = this.store
    const date = s.selectedDate
    const r = s.state.rhythm
    const events = s.eventsOn(date)
    // 做完的任務離開時間軸（那段時間空出來了，排程也不再算它）；取消完成就回到原本的時段。
    // 日程（會議、約會）做完了照樣留著：那段時間確實有那件事
    const tasks = s.tasksOn(date).filter((t) => t.at && !t.done)
    const blocks = itemBlocks(events, tasks)
    const clash = findConflicts(blocks)
    const ghosts = (this.preview?.result.plan || []).map((p) => ({ id: p.id, kind: 'ghost', start: toMin(p.at), end: toMin(p.at) + p.dur }))
    const [wake, sleep] = awake(r)
    const all = [...blocks, ...ghosts]
    const from = clamp(Math.floor((Math.min(wake, ...all.map((b) => b.start)) - 30) / 60) * 60, 0, 1380)
    const to = clamp(Math.ceil((Math.max(sleep, ...all.map((b) => b.end)) + 15) / 60) * 60, from + 60, 1440)
    this.range = [from, to]
    const y = (m) => (m - from) * PX
    let grid = ''
    for (let m = from; m <= to; m += 60) grid += `<div class="dl-hour" style="top:${y(m)}px"><span>${String(m / 60).padStart(2, '0')}:00</span></div>`
    let bands = ''
    for (const b of rhythmBlocks(r, date)) {
      const a = Math.max(from, b.start)
      const z = Math.min(to, b.end)
      if (z <= a) continue
      const style = `top:${y(a)}px;height:${(z - a) * PX}px`
      if (b.kind === 'work') bands += `<div class="dl-work" style="${style}" title="${b.label} ${hm(b.start)}–${hm(b.end)}"></div>`
      else bands += `<div class="dl-band ${b.kind}" style="${style}"><span>${b.kind === 'sleep' ? '睡眠' : esc(b.label)}</span></div>`
    }
    const peak = PEAKS[r.peak]?.range
    if (peak) bands += `<div class="dl-peak" style="top:${y(Math.max(from, peak[0]))}px;height:${Math.max(0, (Math.min(to, peak[1]) - Math.max(from, peak[0])) * PX)}px" title="精神最好的時段"></div>`

    const byId = new Map([...events.map((e) => [e.id, e]), ...s.planTasks(date).map((t) => [t.id, t])])
    const isToday = date === s.today
    const now = nowMin()
    const html = lanes([...blocks, ...ghosts])
      .map((b) => {
        const item = byId.get(b.id)
        if (!item) return ''
        const h = Math.max(MIN_H, (b.end - b.start) * PX - 2)
        const pos = `top:${y(b.start)}px;height:${h}px;left:calc(${(b.lane / b.lanes) * 100}% + 2px);width:calc(${100 / b.lanes}% - 4px)`
        const short = h < 38 ? 'short' : ''
        const time = `${hm(b.start)}–${hm(Math.min(b.end, 1439))}`
        if (b.kind === 'ghost') {
          return `<div class="blk ghost ${short}" style="${pos};--c:${tagOf(item.tag).color}"><div class="blk-txt"><b>${esc(item.title)}</b><small>${time}</small></div></div>`
        }
        const ev = b.kind === 'event'
        const c = ev ? EVENT_COLORS[item.color % EVENT_COLORS.length] : tagOf(item.tag).color
        const others = clash.get(b.id)
        const past = isToday ? b.end <= now : date < s.today
        // 匯入的行事曆：只看不改（不能勾、不能拖、不能改長度）
        const ext = ev && isExternal(item)
        const meta = others ? `時間和 ${others.length} 件重疊` : ext ? `匯入${item.note ? `・${esc(item.note)}` : ''}` : ev ? (item.note ? esc(item.note) : '') : `${PRIORITIES[item.priority].label}優先${item.star ? '・本命' : ''}`
        return `<div class="blk ${ev ? 'ev' : 'tk'} ${ext ? 'ext' : ''} ${item.done ? 'done' : ''} ${others ? 'clash' : ''} ${past && !item.done ? 'past' : ''} ${short}"
          data-type="${ev ? 'event' : 'task'}" data-id="${esc(b.id)}" data-start="${b.start}" data-end="${b.end}" style="${pos};--c:${c}">
          ${ext ? '' : `<button class="check" data-act="toggle" aria-label="完成「${esc(item.title)}」" aria-pressed="${!!item.done}" style="--c:${c}">${ICON.check}</button>`}
          <button type="button" class="blk-txt" data-edit><b>${s.isSample?.(item) ? '<em class="ex-tag">範例</em>' : ''}${ev ? '' : item.star ? '<em class="star">★</em>' : ''}${esc(item.title)}</b><small><span class="blk-time">${time}</span>${meta ? `・${meta}` : ''}</small></button>
          ${ext ? '' : '<i class="blk-resize" data-resize title="拖曳調整長度"></i>'}
        </div>`
      })
      .join('')
    const nowLine = isToday && now >= from && now <= to ? `<div class="dl-now" style="top:${y(now)}px"><span>${hm(now)}</span></div>` : ''
    const empty = !blocks.length && !ghosts.length
    $('#dayline').innerHTML = `<div class="dl-body" style="height:${(to - from) * PX}px">
      ${grid}<div class="dl-lane">${bands}${html}${nowLine}<div class="dl-drop" hidden></div></div></div>
      ${empty ? `<p class="dl-empty">${date < s.today ? '這天沒有排時段。' : '可以點空白處新增日程，或用「最佳化時程」安排任務。'}</p>` : ''}`
    // 換日期時捲到現在（今天）或起床時間；分頁還沒顯示時捲不動，等看得到再捲
    const box = $('#dayline')
    if (this.scrolledFor !== date && box.clientHeight) {
      this.scrolledFor = date
      box.scrollTop = Math.max(0, y(isToday ? now - 60 : wake - 30))
    }
  }

  // 作息設定（摺疊在最下面）
  _rhythm() {
    const el = $('#rhythmForm')
    const act = el.contains(document.activeElement) ? document.activeElement : null
    // 正在打字或選時間時不重畫（會打斷輸入）；按鈕按下去要馬上看到結果，重畫後焦點放回同一顆
    if (act?.matches('input, select, textarea')) return
    const key = act && this._rhythmKey(act)
    const r = this.store.state.rhythm
    const time = (attr, v, label) => `<label class="time-field"><input type="time" ${attr} value="${v}" aria-label="${esc(label)}"></label>`
    el.innerHTML = `
      <div class="rf-row"><span class="rf-k">起床</span>${time('data-r="wake"', r.wake, '起床時間')}<span class="rf-k">就寢</span>${time('data-r="sleep"', r.sleep, '就寢時間')}</div>
      <div class="rf-sub">三餐與固定休息<small>排程會避開</small></div>
      <ul class="rf-meals">${r.meals
        .map(
          (m, i) => `<li data-i="${i}"><input class="rf-label" data-m="label" value="${esc(m.label)}" maxlength="12" aria-label="名稱">
            ${time('data-m="start"', m.start, `${m.label}開始`)}<span class="tilde">〜</span>${time('data-m="end"', m.end, `${m.label}結束`)}
            <button type="button" class="mini" data-meal-del title="移除" aria-label="移除">${ICON.del}</button></li>`,
        )
        .join('')}</ul>
      ${r.meals.length < 6 ? '<button type="button" class="btn-ghost rf-add" data-meal-add>＋ 新增時段</button>' : ''}
      <div class="rf-sub">工作／上課時段<small>工作、學習類的任務會優先排進來</small></div>
      <div class="rf-row"><button type="button" class="chip-toggle ${r.work ? 'on' : ''}" data-work-toggle aria-pressed="${!!r.work}">${r.work ? '有固定時段' : '沒有固定時段'}</button>
        ${r.work ? `${time('data-w="start"', r.work.start, '工作／上課開始')}<span class="tilde">〜</span>${time('data-w="end"', r.work.end, '工作／上課結束')}` : ''}</div>
      ${r.work ? `<div class="rf-days" role="group" aria-label="工作／上課的日子">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-wd="${d}" class="${r.work.days.includes(d) ? 'on' : ''}" aria-pressed="${r.work.days.includes(d)}">${WEEK_ZH[d]}</button>`).join('')}</div>` : ''}
      <div class="rf-sub">精神最好的時段<small>重要的任務會優先排在這裡</small></div>
      <div class="seg rf-peak" data-peak role="group" aria-label="精神最好的時段">${Object.entries(PEAKS).map(([k, p]) => `<button type="button" data-v="${k}" class="${r.peak === k ? 'on' : ''}" aria-pressed="${r.peak === k}">${p.label}</button>`).join('')}</div>
      <div class="rf-row"><span class="rf-k">時段之間留</span><select data-r="buffer" aria-label="緩衝時間">${[0, 5, 10, 15, 20, 30].map((v) => `<option value="${v}" ${r.buffer === v ? 'selected' : ''}>${v ? `${v} 分鐘` : '不留'}</option>`).join('')}</select></div>
      <div class="rf-row"><button type="button" class="chip-toggle ${r.bedRemind ? 'on' : ''}" data-bed aria-pressed="${!!r.bedRemind}">就寢前 30 分鐘，ふじ提醒你：${r.bedRemind ? '開' : '關'}</button></div>`
    if (key) (el.querySelector(key) || el.querySelector('[data-meal-add], [data-work-toggle]'))?.focus({ preventScroll: true })
  }

  // 作息表單裡按鈕的選擇器：重畫後用來找回同一顆按鈕
  _rhythmKey(b) {
    if (b.dataset.wd != null) return `[data-wd="${b.dataset.wd}"]`
    if (b.closest('[data-peak]')) return `[data-peak] [data-v="${b.dataset.v}"]`
    for (const k of ['data-work-toggle', 'data-bed', 'data-meal-add']) if (b.hasAttribute(k)) return `[${k}]`
    // 刪掉的那一列已經不在了：交給下面的備用按鈕
    if (b.hasAttribute('data-meal-del')) return '[data-meal-add]'
    return null
  }

  // ── 編輯面板 ──
  openEdit(type, id) {
    const s = this.store
    // 匯入的行事曆：只看不改，說一聲是從哪裡來的
    const ext = type === 'event' ? s.external.find((e) => e.id === id) : null
    if (ext) {
      const cal = s.state.calendars.find((c) => c.id === ext.ext)
      return this.hooks.toast({ icon: '暦', title: ext.title, sub: `從「${cal?.name || '匯入的行事曆'}」帶進來的${ext.note ? `・${ext.note}` : ''}，要改請到原本的行事曆` })
    }
    let item = type === 'event' ? s.state.events.find((e) => e.id === id) : s.state.tasks.find((t) => t.id === id)
    if (!item) return
    // 跨過午夜存成兩段的日程：打開的是整個日程（從第一段那天的開始到隔天的結束），點哪一段都一樣
    if (type === 'event' && item.link) {
      const sp = s.eventSpan(item)
      item = { ...sp.head, end: sp.end }
    }
    this.editing = { type, id, create: false, color: item.color ?? 0, priority: item.priority ?? 2, tag: item.tag ?? 'life', allDay: !!item.allDay, ongoing: !!item.ongoing, star: !!item.star }
    this._sheet(item)
  }
  openCreate(minute) {
    const color = (this.lastColor ?? -1) + 1
    this.editing = { type: 'event', id: null, create: true, color: color % EVENT_COLORS.length }
    this._sheet({ title: '', date: this.store.selectedDate, start: hm(minute), end: hm(Math.min(1439, minute + 60)), note: '' })
  }
  closeEdit() {
    const id = this.editing?.id
    $('#editSheet').hidden = true
    this.editing = null
    // 存了之後時間軸重畫，原本的按鈕被換掉：焦點還到同一件的標題上（鍵盤才不會掉回頁首）
    if (id) {
      requestAnimationFrame(() => {
        const a = document.activeElement
        if (!a || a === document.body) $(`.blk[data-id="${CSS.escape(id)}"] [data-edit], .ad-chip[data-ad="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
      })
    }
  }

  _sheet(item) {
    const ed = this.editing
    const ev = ed.type === 'event'
    const routine = this.store.routineOf(item)
    const swatches = EVENT_COLORS.map((c, i) => `<button type="button" data-color="${i}" style="--c:${c}" class="${i === ed.color ? 'on' : ''}" aria-pressed="${i === ed.color}" aria-label="顏色 ${i + 1}"></button>`).join('')
    // 整天：藏起開始和結束，換成「到哪天」；例行公事長出來的那一天不能改成整天
    const ad = !!ed.allDay
    const body = ev
      ? `<div class="ec-grid">
          <label><span class="ec-dk">${ad ? '從' : '日期'}</span><input type="date" name="date" value="${item.date}" required></label>
          <label class="ec-timed"${ad ? ' hidden' : ''}>開始<input type="time" name="start" value="${ad ? '09:00' : item.start}"></label>
          <label class="ec-timed"${ad ? ' hidden' : ''}>結束<input type="time" name="end" value="${ad ? '10:00' : item.end}"></label>
          <label class="ec-until"${ad ? '' : ' hidden'}>到<input type="date" name="until" value="${item.endDate || item.date}" aria-label="最後一天（只有一天就跟開始同一天）"></label>
        </div>
        <small class="hint ec-over" aria-live="polite" hidden></small>
        ${routine ? '' : `<div class="form-row"><button type="button" class="chip-toggle${ad ? ' on' : ''}" data-allday aria-pressed="${ad}" title="沒有時段的日程，例如朋友來玩、旅行（可以好幾天）">整天</button></div>`}
        <div class="swatches ec-colors">${swatches}</div>
        <textarea name="note" maxlength="200" rows="2" placeholder="備註：地點、要帶的東西…" aria-label="備註">${esc(item.note || '')}</textarea>`
      : `<div class="form-row ec-long"${item.project ? '' : ' hidden'}><button type="button" class="chip-toggle${ed.ongoing ? ' on' : ''}" data-long aria-pressed="${ed.ongoing}" title="不排在哪一天：不會逾期、不出現在每天的任務裡，只待在專案；完成那天才開花">長期</button><small class="ec-long-tip">不排日期，只待在專案裡（例如一首練習曲）</small></div>
        <div class="ec-grid"${ed.ongoing ? ' hidden' : ''}>
          <label>日期<input type="date" name="date" value="${item.date}" required></label>
          <label>開始<input type="time" name="at" value="${item.at || ''}"></label>
          <label>預估時間<select name="dur">${[...new Set([...DURS, taskDur(item)])].sort((a, b) => a - b).map((d) => `<option value="${d}" ${d === taskDur(item) ? 'selected' : ''}>${fmtDur(d)}</option>`).join('')}</select></label>
        </div>
        <div class="ec-grid ec-due"><label>截止日<input type="date" name="due" value="${item.due || ''}" aria-label="截止日：一定要做完的那天（可以不填）"></label></div>
        <div class="form-row"><div class="seg" data-pri>${[1, 2, 3].map((p) => `<button type="button" data-v="${p}" class="${p === ed.priority ? 'on' : ''}" aria-pressed="${p === ed.priority}">${PRIORITIES[p].label}</button>`).join('')}</div>
          ${!item.done ? `<button type="button" class="chip-toggle${ed.star ? ' on' : ''}" data-star aria-pressed="${ed.star}" title="今天最重要的三件之一：完成給雙倍 XP">★ 本命</button>` : ''}</div>
        <div class="tag-pick">${TAGS.map((t) => `<button type="button" data-tag="${t.id}" style="--c:${t.color}" class="${t.id === ed.tag ? 'on' : ''}" aria-pressed="${t.id === ed.tag}"><i></i>${t.label}</button>`).join('')}</div>
        ${this._projectPick(item)}`
    $('#editSheet').innerHTML = `<form class="modal-card edit-card glass" autocomplete="off">
      <div class="modal-kicker">${ed.create ? 'あたらしいよてい' : ev ? 'よてい' : 'タスク'}</div>
      <input name="title" class="ec-title" maxlength="80" placeholder="${ev ? '日程名稱，例如：牙醫' : '任務名稱'}" aria-label="${ev ? '日程名稱' : '任務名稱'}" value="${esc(item.title)}" required>
      ${body}
      ${routine ? `<p class="hint ec-hint">這是例行${ev ? '日程' : '任務'}，這裡只改這一天</p>` : ''}
      ${ev || ed.create ? '' : this._taskTools(item)}
      <div class="ec-actions">
        ${ed.create ? '' : `<button type="button" class="btn-ghost danger" data-ec="delete">刪除</button>
          ${ev && ad ? '' : `<button type="button" class="btn-ghost" data-ec="done">${item.done ? '改回未完成' : '完成'}</button>`}`}
        <span class="sp"></span>
        <button type="button" class="btn-ghost" data-ec="cancel">取消</button>
        <button class="btn-primary" type="submit">${ed.create ? '加入' : '儲存'}</button>
      </div>
    </form>`
    $('#editSheet').hidden = false
    if (ev) this._overHint(item)
    const title = $('#editSheet [name="title"]')
    if (ed.create) title.focus()
    // 打開時的樣子：存的時候只送改過的欄位（面板開著時別的裝置、別的分頁改了其他欄位，不會被蓋回去）
    else {
      const form = $('#editSheet form')
      ed.base = ev ? this._eventVals(form) : this._taskVals(form)
      ed.baseStar = !!ed.star
    }
    this._syncTools()
  }
  // 面板上現在填的值（跟存的時候同一套規則）
  _taskVals(form) {
    const s = this.store
    const ed = this.editing
    const proj = form.elements.project
    const v = { title: form.title.value.trim(), date: form.date.value || s.selectedDate, priority: ed.priority, tag: ed.tag, at: form.at.value || null, dur: +form.dur.value }
    if (proj) Object.assign(v, { project: proj.value || null, ms: form.elements.ms?.value || null })
    // 長期只有歸在專案裡的任務可以設（store 也會再檢查一次）
    v.ongoing = !!ed.ongoing && !!(proj ? proj.value : s.state.tasks.find((t) => t.id === ed.id)?.project)
    if (form.elements.due) v.due = form.elements.due.value || null
    return v
  }
  _eventVals(form) {
    const ed = this.editing
    const title = form.title.value.trim()
    const date = form.date.value || this.store.selectedDate
    const note = form.note.value.trim().slice(0, 200)
    if (ed.allDay) return { title, color: ed.color, date, note, allDay: true, endDate: form.until.value }
    const start = form.start.value || '09:00'
    let end = form.end.value || '10:00'
    // 結束比開始早：跨過午夜，存成兩段（store 的 overnight）；一樣、或跨過去太久（多半填錯）：補成半小時
    if (!overnight(start, end) && toMin(end) <= toMin(start)) end = hm(toMin(start) + 30)
    return { title, start, end, color: ed.color, date, note, allDay: false }
  }
  // 日程面板的時段：改開始時結束跟著挪（長度不變，像一般的行事曆；規則跟 store 一樣，見 shiftEnd）；
  // 結束比開始早時說一聲會接到隔天
  _overHint(item = {}) {
    const form = $('#editSheet form')
    const hint = form.querySelector('.ec-over')
    const { start, end } = form.elements
    let prev = start.value
    const show = () => {
      const over = !this.editing?.allDay && overnight(start.value, end.value)
      hint.hidden = !over
      if (!over) return
      if (toMin(end.value) === 0) hint.textContent = '剛好在午夜結束：存到 23:59'
      else hint.textContent = `到隔天 ${end.value} 才結束：存成這天到 23:59、隔天 00:00 起兩段（改時間、名稱、刪除都是一整個）`
    }
    start.addEventListener('change', () => {
      if (start.value && end.value && prev && start.value !== prev) end.value = shiftEnd(prev, end.value, start.value)
      prev = start.value
      show()
    })
    end.addEventListener('change', show)
    show()
  }
  // 草稿改了日期、長度、長期：本命（過去的日子、長期的不行）、分成幾段（90 分鐘以上）、排進空檔（長期的不行）跟著出現或藏起來
  _syncTools() {
    const ed = this.editing
    const form = $('#editSheet form')
    if (!ed || ed.type !== 'task' || !form) return
    const hide = (sel, off) => {
      const b = form.querySelector(sel)
      if (b) b.hidden = off
    }
    const date = form.date?.value || ''
    hide('[data-star]', !!ed.ongoing || !date || date < this.store.today)
    hide('[data-ec="split"]', !!ed.ongoing || +form.dur.value < SPLIT_MIN)
    hide('[data-ec="slot"]', !!ed.ongoing)
  }

  // 任務的編輯面板上直接做的事：排進最近空檔、移回未排時段、子任務、分成幾段（任務列上原本的小按鈕，手機上收進這裡）
  _taskTools(t) {
    const subs = t.subs || []
    const tools = [
      !t.done ? `<button type="button" class="btn-ghost" data-ec="slot">${t.at ? '移到最近空檔' : '排進最近空檔'}</button>` : '',
      t.at ? '<button type="button" class="btn-ghost" data-ec="unplan">移回未排時段</button>' : '',
      `<button type="button" class="btn-ghost" data-ec="subs">${subs.length ? `子任務 ${subs.filter((x) => x.done).length}/${subs.length}` : '拆成子任務'}</button>`,
      !t.done && !t.routineId ? '<button type="button" class="btn-ghost" data-ec="split" title="分成幾段，分到幾天做">分成幾段</button>' : '',
    ].filter(Boolean)
    return `<div class="ec-tools">${tools.join('')}</div>`
  }

  // 編輯面板的「長期」：藏起日期、開始時間和預估時間；改回排在某一天時日期至少是今天（不會一改回來就逾期）
  _setLong(on) {
    const ed = this.editing
    const sheet = $('#editSheet')
    if (!ed) return
    ed.ongoing = on
    const btn = sheet.querySelector('[data-long]')
    if (btn) setOn(btn, on)
    const grid = sheet.querySelector('.ec-grid')
    if (grid) grid.hidden = on
    const date = sheet.querySelector('[name="date"]')
    if (!on && date && date.value < this.store.today) date.value = this.store.today
    this._syncTools()
  }

  // 任務歸在哪個專案、算在哪個里程碑（收藏起來的專案不列，除非這件本來就歸在那裡）
  _projectPick(item) {
    const list = this.store.state.projects.filter((p) => !p.archived || p.id === item.project)
    if (!list.length) return ''
    const ms = this._msOptions(item, item.project)
    return `<label class="ec-proj">專案<select name="project"><option value="">不歸任何專案</option>${list
      .map((p) => `<option value="${esc(p.id)}" ${p.id === item.project ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('')}</select></label>
      <label class="ec-proj ec-ms" ${ms ? '' : 'hidden'}>里程碑<select name="ms">${ms}</select></label>`
  }
  // 里程碑的選項：「自動」後面寫出現在會算在哪一個；那個專案沒有里程碑就是空字串
  _msOptions(item, pid) {
    const p = pid ? this.store.state.projects.find((x) => x.id === pid) : null
    if (!p?.milestones.length) return ''
    const auto = taskMilestone(p, { ...item, ms: null })
    const sel = pid === item.project ? item.ms : null
    return `<option value="">自動${auto ? `（${esc(auto.title)}）` : ''}</option>${p.milestones
      .map((m) => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${m.done ? '✓ ' : ''}${esc(m.title)}</option>`)
      .join('')}`
  }

  _saveSheet(form) {
    const s = this.store
    const ed = this.editing
    if (!form.title.value.trim()) {
      form.title.focus()
      return false
    }
    // 只送打開之後改過的欄位（新增的整個送）
    const changed = (v) => (ed.base ? Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== ed.base[k])) : v)
    if (ed.type === 'event') {
      const v = this._eventVals(form)
      if (ed.create) {
        const { allDay, ...rest } = v
        s.addEvent(allDay ? v : rest)
        this.lastColor = ed.color
      } else {
        // 只送改過的（改成整天、改回有時段時，開始、結束、到哪天跟著不一樣，自然會一起送；名稱、備註沒改就不送）
        const patch = changed(v)
        if (Object.keys(patch).length) s.updateEvent(ed.id, patch)
      }
    } else {
      const patch = changed(this._taskVals(form))
      if (Object.keys(patch).length) s.updateTask(ed.id, patch)
      // 本命：自己按過、這時候選得了（不是過去的日子、不是長期的）才動；照每天的上限（滿了的話 store 不收，提示卡會說）
      const t = s.state.tasks.find((x) => x.id === ed.id)
      if (t && form.querySelector('[data-star]:not([hidden])') && ed.star !== ed.baseStar && !!t.star !== ed.star) s.toggleStar(ed.id)
    }
    this.closeEdit()
    return true
  }

  // 把任務放進最近的空檔：day 沒給是日程頁正在看的那天（過去的日子換成今天）
  _slot(id, day = null) {
    const s = this.store
    const t = s.state.tasks.find((x) => x.id === id)
    if (!t) return
    const pick = day || s.selectedDate
    const date = pick < s.today ? s.today : pick
    const hit = nearestSlot({
      task: t, tasks: s.tasksOn(date).filter((x) => x.at), events: s.eventsOn(date), rhythm: s.state.rhythm, date, today: s.today,
      nowMin: date === s.today ? nowMin() : null,
    })
    if (!hit) return this.hooks.toast({ icon: '満', title: '可用空檔有點不足', sub: '換個日子安排也可以' })
    const u = s.slotTask(id, date, hit.at, t.dur || hit.dur)
    if (u) this.hooks.scheduled?.(id, u)
  }

  // ── 事件 ──
  _bind() {
    const s = this.store
    $('#weekStrip').addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b) return
      if (b.dataset.date) s.selectDate(b.dataset.date)
      else if (b.dataset.week) s.selectDate(addDays(s.selectedDate, +b.dataset.week))
      else if (b.hasAttribute('data-cal')) this.hooks.openCalendar(s.selectedDate)
    })

    $('#allDayBar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ad]')
      if (b) this.openEdit('event', b.dataset.ad)
    })

    const card = $('#sleepCard')
    card.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q] button')
      if (q) pickOne(q.parentElement.querySelectorAll('button'), (x) => x === q)
      if (e.target.closest('[data-skip]')) {
        try {
          localStorage.setItem(SKIP_KEY, s.today)
        } catch {}
        card.innerHTML = ''
      }
    })
    card.addEventListener('submit', (e) => {
      e.preventDefault()
      const f = e.target
      const q = +(f.querySelector('[data-q] .on')?.dataset.v || 0)
      // 就寢和起床同一個時間（多半是還沒改到）：先不記，卡片留著讓人改
      if (f.bed.value === f.wake.value) {
        this.hooks.toast({ icon: '眠', title: '就寢和起床是同一個時間', sub: '改一下起床時間再記' })
        return f.wake.focus()
      }
      card.innerHTML = ''
      s.logSleep(s.today, { bed: f.bed.value, wake: f.wake.value, q })
    })

    $('#planBar').addEventListener('click', (e) => {
      const act = e.target.closest('[data-plan]')?.dataset.plan
      if (!act) return
      const date = s.selectedDate
      if (act === 'optimize' || act === 'replan') {
        const unplaced = s.planTasks(date).some((t) => !t.at && !t.done)
        const replan = act === 'replan' || !unplaced
        this.preview = { date, replan, result: s.planDay(date, { replan }) }
        this.render(false)
      } else if (act === 'apply') {
        const p = this.preview
        if (!p) return
        // 預覽可能放了一陣子：照現在的時間、日程和任務再排一次，結果不一樣就換成新的預覽，請使用者再看一眼
        const fresh = p.date >= s.today ? s.planDay(p.date, { replan: p.replan }) : null
        const sig = (r) => `${r.plan.map((x) => `${x.id}@${x.at}+${x.dur}`).join()}|${r.left.length}|${(r.unslot || []).join()}`
        if (!fresh || sig(fresh) !== sig(p.result)) {
          this.preview = fresh ? { ...p, result: fresh } : null
          this.render(false)
          this.hooks.toast(fresh
            ? { icon: '改', title: '時間或日程有變，預覽已經更新', sub: '看一下新的排法，沒問題再按一次套用' }
            : { icon: '過', title: '這天已經過去了', sub: '只能替今天和之後的日子排時段' })
          return
        }
        this.preview = null
        const u = s.applyPlan(p.date, p.result.plan, p.result.left.length, p.result.unslot)
        if (!u) return this.render(false)
        // 排好了：說排了幾件、到幾點，可以整批撤銷（之後又改過的那幾件留著現在的樣子）。
        // 提示卡收起來之後，這天的排程列上也留著「撤銷剛才的排程」（換一天、再排一次、撤銷了就拿掉）
        const left = p.result.left.length
        const end = this._current(p.date).endAt
        this._lastPlan = { date: p.date, u }
        this.render(false)
        this.hooks.toast({
          icon: '時', title: `排好 ${u.count} 件${left ? `，還有 ${left} 件沒排入` : ''}`,
          sub: left ? '這天的空檔有點滿，改天安排也沒關係' : end ? `任務排到 ${end}` : '', ms: 12000, tag: 'scheduled',
          actions: [{ label: '撤銷', soft: true, run: () => this._undoLastPlan() }],
        })
      } else if (act === 'split') {
        // 放不下的大任務分段，再照新的樣子預覽一次
        const p = this.preview
        const undo = (p?.result.big || []).map((id) => s.splitSessions(id)).filter(Boolean)
        if (!undo.length) return
        this.preview = p.date >= s.today ? { ...p, result: s.planDay(p.date, { replan: p.replan }) } : null
        this.render(false)
        const days = [...new Set(undo.flatMap((u) => [u.after.date, ...u.made.map((m) => s.state.tasks.find((t) => t.id === m.id)?.date)]).filter(Boolean))].sort()
        const md = (d) => (d === s.today ? '今天' : `${+d.slice(5, 7)}/${+d.slice(8)}`)
        this.hooks.toast({
          icon: '分', title: `分成 ${undo.reduce((a, u) => a + u.made.length + 1, 0)} 段了`, sub: `排在 ${days.map(md).join('、')}，有截止日的都在截止日前`, ms: 5200,
          actions: [{ label: '復原', run: () => { undo.forEach((u) => s.undoSplit(u)); this.preview = null; this.render(false) } }],
        })
      } else if (act === 'coach') {
        this.hooks.coachDay?.(date)
      } else if (act === 'cancel') {
        this.preview = null
        this.render(false)
      } else if (act === 'undo-last') this._undoLastPlan()
      else if (act === 'clear') armConfirm(e.target.closest('button'), '清除未完成任務的時段？', () => s.clearPlan(date))
    })

    const tray = $('#planTray')
    tray.addEventListener('click', (e) => {
      if (e.target.closest('[data-tray-more]')) {
        this._trayOpen = !this._trayOpen
        this._tray()
        // 重畫換了新的按鈕：焦點留在「還有幾件／收起來」上
        return $('#planTray [data-tray-more]')?.focus({ preventScroll: true })
      }
      // 用鍵盤（Enter／空白鍵）按任務名稱：放進最近的空檔。滑鼠和手指的點擊交給拖曳那邊分辨是點還是拖
      const slot = e.target.closest('[data-slot]')
      if (slot && e.detail === 0) return this._slot(slot.closest('.chip-task').dataset.id)
      const dur = e.target.closest('[data-dur]')
      if (!dur) return
      const id = dur.closest('.chip-task').dataset.id
      const t = s.state.tasks.find((x) => x.id === id)
      const cur = taskDur(t)
      s.updateTask(id, { dur: DURS.find((d) => d > cur) || DURS[0] })
    })
    tray.addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.chip-task')
      if (!chip || e.target.closest('[data-dur]') || e.button > 0) return
      this._startDrag(e, { kind: 'chip', id: chip.dataset.id, el: chip })
    })

    const line = $('#dayline')
    line.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('[data-act]')) return
      const blk = e.target.closest('.blk:not(.ghost)')
      // 匯入的日程不能拖：點一下說明
      if (blk?.classList.contains('ext')) return
      if (blk) {
        this._startDrag(e, {
          kind: 'block', type: blk.dataset.type, id: blk.dataset.id, el: blk, resize: !!e.target.closest('[data-resize]'),
          start: +blk.dataset.start, end: +blk.dataset.end,
        })
      } else if (e.target.closest('.dl-lane')) this._startDrag(e, { kind: 'empty' })
    })
    line.addEventListener('click', (e) => {
      // 用鍵盤（Enter／空白鍵）按時段的標題：打開編輯。滑鼠和手指的點擊交給拖曳那邊分辨是點還是拖
      const ed = e.target.closest('[data-edit]')
      if (ed && (e.detail === 0 || ed.closest('.blk.ext'))) {
        const blk = ed.closest('.blk')
        return this.openEdit(blk.dataset.type, blk.dataset.id)
      }
      const b = e.target.closest('[data-act="toggle"]')
      if (!b) return
      const blk = b.closest('.blk')
      if (blk.dataset.type === 'event') s.toggleEvent(blk.dataset.id)
      else s.toggleTask(blk.dataset.id)
    })
    line.addEventListener('mouseover', (e) => {
      const blk = e.target.closest('.blk.ev')
      this.hooks.hoverEvent(blk?.dataset.id || null)
    })
    line.addEventListener('mouseleave', () => this.hooks.hoverEvent(null))
    // 觸控長按開始拖曳後，阻止面板跟著捲動
    line.addEventListener('touchmove', (e) => this.drag?.armed && e.preventDefault(), { passive: false })
    tray.addEventListener('touchmove', (e) => this.drag?.armed && e.preventDefault(), { passive: false })
    addEventListener('pointermove', (e) => this._moveDrag(e))
    addEventListener('pointerup', (e) => this._endDrag(e))
    addEventListener('pointercancel', () => this._cancelDrag())

    // 作息設定
    const rf = $('#rhythmForm')
    rf.addEventListener('change', (e) => {
      const r = s.state.rhythm
      const el = e.target
      if (el.dataset.r) s.setRhythm({ [el.dataset.r]: el.dataset.r === 'buffer' ? +el.value : el.value })
      else if (el.dataset.w && el.value) s.setRhythm({ work: { ...r.work, [el.dataset.w]: el.value } })
      else if (el.dataset.m) {
        const i = +el.closest('li').dataset.i
        const meals = r.meals.map((m, j) => (j === i ? { ...m, [el.dataset.m]: el.value || m[el.dataset.m] } : m))
        s.setRhythm({ meals })
      }
    })
    rf.addEventListener('click', (e) => {
      const r = s.state.rhythm
      const b = e.target.closest('button')
      if (!b) return
      if (b.hasAttribute('data-meal-add')) {
        const last = r.meals[r.meals.length - 1]
        const start = last ? Math.min(toMin(last.end) + 120, 1380) : 15 * 60
        s.setRhythm({ meals: [...r.meals, { label: '點心', start: hm(start), end: hm(start + 20) }] })
      } else if (b.hasAttribute('data-meal-del')) {
        const i = +b.closest('li').dataset.i
        s.setRhythm({ meals: r.meals.filter((_, j) => j !== i) })
      } else if (b.hasAttribute('data-work-toggle')) s.setRhythm({ work: r.work ? null : { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] } })
      else if (b.dataset.wd) {
        const d = +b.dataset.wd
        const days = r.work.days.includes(d) ? r.work.days.filter((x) => x !== d) : [...r.work.days, d]
        s.setRhythm({ work: { ...r.work, days } })
      } else if (b.closest('[data-peak]')) s.setRhythm({ peak: b.dataset.v })
      else if (b.hasAttribute('data-bed')) s.setRhythm({ bedRemind: !r.bedRemind })
      this._rhythm()
    })

    // 編輯面板
    const sheet = $('#editSheet')
    sheet.addEventListener('submit', (e) => {
      e.preventDefault()
      this._saveSheet(e.target)
    })
    // 換專案：里程碑的選項跟著換成那個專案的；不歸任何專案就不能是長期任務
    sheet.addEventListener('change', (e) => {
      if (e.target.name !== 'project' || this.editing?.type !== 'task') return
      const item = s.state.tasks.find((t) => t.id === this.editing.id)
      const long = sheet.querySelector('.ec-long')
      if (long) {
        long.hidden = !e.target.value
        if (!e.target.value && this.editing.ongoing) this._setLong(false)
      }
      const box = sheet.querySelector('.ec-ms')
      if (!item || !box) return
      const ms = this._msOptions(item, e.target.value)
      box.querySelector('select').innerHTML = ms
      box.hidden = !ms
    })
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) return this.closeEdit()
      const ed = this.editing
      if (!ed) return
      const color = e.target.closest('[data-color]')
      if (color) {
        ed.color = +color.dataset.color
        pickOne(sheet.querySelectorAll('[data-color]'), (x) => x === color)
      }
      const pri = e.target.closest('[data-pri] button')
      if (pri) {
        ed.priority = +pri.dataset.v
        pickOne(pri.parentElement.querySelectorAll('button'), (x) => x === pri)
      }
      const tag = e.target.closest('[data-tag]')
      if (tag) {
        ed.tag = tag.dataset.tag
        pickOne(sheet.querySelectorAll('[data-tag]'), (x) => x === tag)
      }
      // 長期／排在某一天：只換看得到的欄位
      if (e.target.closest('[data-long]')) return this._setLong(!ed.ongoing)
      const star = e.target.closest('[data-star]')
      if (star) {
        ed.star = !ed.star
        return setOn(star, ed.star)
      }
      // 整天／有時段：只換看得到的欄位，打到一半的名稱和備註都留著
      const adBtn = e.target.closest('[data-allday]')
      if (adBtn) {
        ed.allDay = !ed.allDay
        setOn(adBtn, ed.allDay)
        for (const el of sheet.querySelectorAll('.ec-timed')) el.hidden = ed.allDay
        sheet.querySelector('.ec-until').hidden = !ed.allDay
        sheet.querySelector('.ec-dk').textContent = ed.allDay ? '從' : '日期'
        const until = sheet.querySelector('[name="until"]')
        const from = sheet.querySelector('[name="date"]').value
        if (!until.value || until.value < from) until.value = from
        return
      }
      const act = e.target.closest('[data-ec]')?.dataset.ec
      if (!act) return
      const ev = ed.type === 'event'
      if (act === 'cancel') this.closeEdit()
      else if (act === 'delete') {
        armConfirm(e.target.closest('button'), '確定刪除？', () => {
          this.closeEdit()
          if (ev) s.deleteEvent(ed.id)
          else s.deleteTask(ed.id)
        })
      } else if (act === 'done') {
        this.closeEdit()
        if (ev) s.toggleEvent(ed.id)
        else s.toggleTask(ed.id)
      } else if (['slot', 'unplan', 'subs', 'split'].includes(act)) {
        // 先把面板上改到一半的存起來（名稱空著、日期不對就停在面板上），再照存好的樣子排進空檔（排在任務那天）、
        // 移回未排時段、到任務頁打開子任務、或分段
        const form = sheet.querySelector('form')
        const id = ed.id
        if (!form.reportValidity() || !this._saveSheet(form)) return
        const t = s.state.tasks.find((x) => x.id === id)
        if (!t) return
        if (act === 'slot') this._slot(id, t.date)
        else if (act === 'unplan') s.scheduleTask(id, null)
        else if (act === 'subs') this.hooks.openSubs?.(id)
        else this.hooks.split?.(id)
      }
    })
    // 草稿改了日期、長度：本命、分成幾段跟著出現或藏起來
    sheet.addEventListener('input', (e) => {
      if (e.target.matches('[name="date"], [name="dur"]')) this._syncTools()
    })
    sheet.addEventListener('keydown', (e) => {
      // 注音／日文輸入法選字時的 Esc 是取消選字，不是關掉面板
      if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) this.closeEdit()
      e.stopPropagation()
    })
  }

  // ── 拖曳：時間軸上的區塊（移動、調整長度）、從未排區拖任務進來、點空白處新增 ──
  // 滑鼠直接拖；觸控要長按一下才開始（不然會擋到捲動）
  _startDrag(e, d) {
    this._cancelDrag()
    this.drag = { ...d, x0: e.clientX, y0: e.clientY, moved: false, armed: e.pointerType !== 'touch', pointer: e.pointerId }
    if (e.pointerType === 'touch' && d.kind !== 'empty') {
      this.drag.timer = setTimeout(() => {
        if (!this.drag || this.drag.moved) return
        this.drag.armed = true
        d.el?.classList.add('lift')
        haptic('tick')
      }, 320)
    }
  }

  _cancelDrag() {
    const d = this.drag
    if (!d) return
    clearTimeout(d.timer)
    d.el?.classList.remove('lift', 'dragging')
    d.ghost?.remove()
    $('#dayline .dl-drop')?.setAttribute('hidden', '')
    this.drag = null
  }

  // 指標所在的時間軸分鐘（不在時間軸上回傳 null）
  _minuteAt(x, y) {
    const lane = $('#dayline .dl-lane')
    const box = $('#dayline')
    if (!lane) return null
    const r = lane.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) return null
    return clamp(snap(this.range[0] + (y - r.top) / PX), this.range[0], this.range[1] - 5)
  }

  // 拖到時間軸上下緣時自動捲動
  _edgeScroll(y) {
    const box = $('#dayline')
    const r = box.getBoundingClientRect()
    if (y < r.top + 36) box.scrollTop -= 14
    else if (y > r.bottom - 36) box.scrollTop += 14
  }

  _moveDrag(e) {
    const d = this.drag
    if (!d || e.pointerId !== d.pointer) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    const far = Math.hypot(dx, dy)
    if (!d.armed) {
      // 觸控還沒長按就移動＝在捲動，放棄拖曳
      if (far > 8) this._cancelDrag()
      return
    }
    if (d.kind === 'empty') {
      if (far > 8) this._cancelDrag()
      return
    }
    if (!d.moved && far < 4) return
    if (!d.moved) {
      d.moved = true
      d.el.classList.add('dragging')
      try {
        d.el.setPointerCapture?.(e.pointerId)
      } catch {}
    }
    e.preventDefault()
    if (d.kind === 'block') {
      this._edgeScroll(e.clientY)
      const box = $('#dayline')
      d.scroll0 ??= box.scrollTop
      const delta = snap((dy + box.scrollTop - d.scroll0) / PX)
      const len = d.end - d.start
      if (d.resize) {
        d.nStart = d.start
        d.nEnd = clamp(d.end + delta, d.start + 10, 1440)
      } else {
        d.nStart = clamp(d.start + delta, 0, 1440 - len)
        d.nEnd = d.nStart + len
      }
      d.el.style.top = `${(d.nStart - this.range[0]) * PX}px`
      d.el.style.height = `${Math.max(MIN_H, (d.nEnd - d.nStart) * PX - 2)}px`
      const t = d.el.querySelector('.blk-time')
      if (t) t.textContent = `${hm(d.nStart)}–${hm(Math.min(d.nEnd, 1439))}`
    } else {
      // 從未排區拖出來：跟著指標的小卡，時間軸上顯示會放在哪裡
      if (!d.ghost) {
        d.ghost = d.el.cloneNode(true)
        d.ghost.classList.add('chip-ghost')
        document.body.appendChild(d.ghost)
      }
      d.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY - 14}px)`
      const m = this._minuteAt(e.clientX, e.clientY)
      const drop = $('#dayline .dl-drop')
      if (m == null) drop?.setAttribute('hidden', '')
      else {
        this._edgeScroll(e.clientY)
        const t = this.store.state.tasks.find((x) => x.id === d.id)
        drop.removeAttribute('hidden')
        drop.style.top = `${(m - this.range[0]) * PX}px`
        drop.style.height = `${taskDur(t) * PX}px`
        drop.textContent = `${hm(m)} 開始`
      }
      d.drop = m
    }
  }

  _endDrag(e) {
    const d = this.drag
    if (!d || e.pointerId !== d.pointer) return
    const s = this.store
    clearTimeout(d.timer)
    const clicked = !d.moved && (d.armed || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8)
    this._cancelDrag()
    if (d.kind === 'empty') {
      if (clicked && !e.target.closest('.blk')) {
        const m = this._minuteAt(e.clientX, e.clientY)
        if (m != null) this.openCreate(Math.floor(m / 15) * 15)
      }
      return
    }
    if (!d.moved) {
      if (!clicked) return
      if (d.kind === 'chip') this._slot(d.id)
      else this.openEdit(d.type, d.id)
      return
    }
    if (d.kind === 'chip') {
      if (d.drop == null) return
      const t = s.state.tasks.find((x) => x.id === d.id)
      if (t && t.date !== s.selectedDate) s.updateTask(d.id, { date: s.selectedDate < s.today ? s.today : s.selectedDate })
      s.scheduleTask(d.id, hm(d.drop))
      return
    }
    if (d.nStart == null || (d.nStart === d.start && d.nEnd === d.end)) return this.render(false)
    if (d.type === 'task') s.scheduleTask(d.id, hm(d.nStart), d.resize ? d.nEnd - d.nStart : undefined)
    // 跨過午夜的日程拖的是那一天的那一段：整段拖是整個日程一起挪（store 的 dragEvent）
    else s.dragEvent(d.id, { start: hm(d.nStart), end: hm(Math.min(1439, d.nEnd)), edge: d.resize ? 'end' : null })
  }
}

