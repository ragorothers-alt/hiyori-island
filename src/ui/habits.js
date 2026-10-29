import './habits.css'
import { $, $$, esc, ICON, armConfirm, dateLabel, WEEK_ZH } from './dom.js'
import { EVENT_COLORS } from '../theme.js'
import {
  HABIT_ICONS, HABIT_TEMPLATES, QUIT_MILESTONES, startOf, applies, countOn, doneOn, streak, bestStreak, rate,
  cleanDays, bestClean, slippedOn, nextMilestone, heat, todayProgress,
} from '../habits.js'
import { addDays, parseDate, daysBetween, dateStr } from '../store.js'

// 習慣分頁：上方摘要、養成／戒除兩區、封存區；點卡片展開熱度圖、統計與編輯。
// 打卡只記在今天（補打卡在熱度圖），和面板上方選的日期無關。

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const RING = 2 * Math.PI * 21 // 打卡鈕外圈周長
const SUM_RING = 2 * Math.PI * 16 // 摘要環周長
const colorOf = (i) => EVENT_COLORS[(i || 0) % EVENT_COLORS.length]
const md = (date) => `${+date.slice(5, 7)}/${+date.slice(8)}（${WEEK_ZH[parseDate(date).getDay()]}）`
const hhmm = (ts) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0)

// 頻率：每天／平日／週末／週一三五
function freqLabel(days) {
  if (!days?.length || days.length === 7) return '每天'
  const s = WEEK_ORDER.filter((d) => days.includes(d))
  const key = s.join('')
  if (key === '12345') return '平日'
  if (key === '60') return '週末'
  return '週' + s.map((d) => WEEK_ZH[d]).join('')
}

// 依 key 重用子節點：內容沒變就不碰，正在輸入的表單與焦點不會被打斷。
// item：{ k, html } 或 { k, kids }，可加 tag、cls、style
function patch(box, items) {
  const old = new Map()
  for (const el of box.children) old.set(el.dataset.k, el)
  let ref = box.firstChild
  for (const it of items) {
    let el = old.get(it.k)
    if (el) old.delete(it.k)
    else {
      el = document.createElement(it.tag || 'div')
      el.dataset.k = it.k
    }
    const cls = it.cls || ''
    if (el.className !== cls) el.className = cls
    const style = it.style || ''
    if ((el.getAttribute('style') || '') !== style) el.setAttribute('style', style)
    if (it.kids) patch(el, it.kids)
    else if (el._html !== it.html) {
      el.innerHTML = it.html
      el._html = it.html
    }
    if (el === ref) ref = ref.nextSibling
    else box.insertBefore(el, ref)
  }
  for (const el of old.values()) el.remove()
}

export class HabitsView {
  constructor(root, store, hooks) {
    this.root = root
    this.store = store
    this.hooks = hooks
    this.openId = null // 展開詳情的那張（一次一張）
    this.editId = null // 詳情裡正在編輯的
    this.slipId = null // 正在確認「破戒了」的
    this.formOpen = false
    this.newKind = 'build'
    this.newColor = 0
    this.archOpen = false
    this.bump = null // 剛按下的按鈕，下一次渲染加上彈跳
    this.ringFrom = null // 摘要環上一次的進度，用來做過場
    root.addEventListener('click', (e) => this._click(e))
    root.addEventListener('submit', (e) => this._submit(e))
    root.addEventListener('input', (e) => this._input(e))
    root.addEventListener('keydown', (e) => this._key(e))
    // toggle 不會冒泡，用捕捉
    root.addEventListener('toggle', (e) => {
      if (e.target.classList?.contains('hb-arch')) this.archOpen = e.target.open
    }, true)
  }

  render() {
    const s = this.store
    const today = s.today
    const all = s.state.habits
    const active = all.filter((h) => !h.archived)
    const archived = all.filter((h) => h.archived)
    // 今天要做的排前面，其餘照建立順序
    const builds = active.filter((h) => h.kind === 'build').sort((a, b) => applies(b, today) - applies(a, today))
    const quits = active.filter((h) => h.kind === 'quit')
    if (!active.some((h) => h.id === this.openId)) this.openId = this.editId = null
    if (!quits.some((h) => h.id === this.slipId)) this.slipId = null

    const items = []
    if (s.selectedDate !== today) items.push({ k: 'note', cls: 'hb-note', html: this._noteHTML(today) })
    if (active.length) items.push({ k: 'sum', cls: 'hb-sum', html: this._sumHTML(builds, quits, today) })
    else items.push({ k: 'empty', cls: 'hb-empty', html: this._emptyHTML() })

    if (this.formOpen) {
      items.push({ k: 'form', cls: 'hb-newform', html: this._formHTML(null) })
      const tpl = active.length ? this._tplHTML(this.newKind) : ''
      if (tpl) items.push({ k: 'tpl', cls: 'hb-tpl-box', html: `<h4 class="hb-sub">也可以從常見習慣挑選<small>テンプレート</small></h4>${tpl}` })
    } else {
      items.push({ k: 'newbtn', html: `<button class="btn-ghost wide hb-newbtn" data-act="new">${active.length ? '＋ 新增習慣' : '＋ 自訂習慣'}</button>` })
    }

    if (builds.length) {
      const p = todayProgress(all, today)
      items.push({
        k: 'build', tag: 'section', cls: 'hb-sec',
        kids: [{ k: 't', html: `<h3 class="sec-title">養成<small>そだてる</small>${p.total ? `<span class="count">今天 ${p.done} / ${p.total}</span>` : ''}</h3>` }, ...builds.map((h) => this._card(h, today))],
      })
    }
    if (quits.length) {
      items.push({
        k: 'quit', tag: 'section', cls: 'hb-sec',
        kids: [{ k: 't', html: `<h3 class="sec-title">戒除<small>やめる</small><span class="count">${quits.length} 個</span></h3>` }, ...quits.map((h) => this._card(h, today))],
      })
    }
    if (archived.length) items.push({ k: 'arch', html: this._archHTML(archived, today) })

    const fk = this._focusKey()
    patch(this.root, items)
    this._syncNewForm()
    this._animateRing()
    this._restoreFocus(fk)
  }

  // ── 區塊 ──
  _noteHTML(today) {
    return `${ICON.cal}<span><b>打卡都記在今天</b>（${dateLabel(today, false)}）。想補打卡時，可以展開養成習慣，在熱度圖上補記。</span><button type="button" data-act="today">回到今天</button>`
  }

  _sumHTML(builds, quits, today) {
    const p = todayProgress(this.store.state.habits, today)
    const best = quits.length ? Math.max(...quits.map((h) => cleanDays(h, today))) : 0
    let ring = ''
    let title
    let sub
    if (builds.length) {
      const pct = p.total ? p.done / p.total : 0
      this.ringTo = pct
      const from = this.ringFrom ?? pct
      ring = `<div class="hb-ring-big${p.total && p.done === p.total ? ' full' : ''}"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16" style="stroke-dashoffset:${(SUM_RING * (1 - from)).toFixed(2)}" data-to="${(SUM_RING * (1 - pct)).toFixed(2)}"/></svg><b>${p.total ? `${p.done}<small>/${p.total}</small>` : '休'}</b></div>`
      if (!p.total) [title, sub] = ['今天沒有養成安排', '沒有排到今天的養成習慣，放鬆一下']
      else if (p.done === p.total) [title, sub] = ['養成習慣都完成了','做得很好，今天又累積了一格']
      else if (!p.done) [title, sub] = [`今天有 ${p.total} 個習慣`, '想從哪一個開始呢？']
      else [title, sub] = [`今天完成 ${p.done} / ${p.total}`, `還有 ${p.total - p.done} 個，照自己的步調來`]
    } else {
      this.ringTo = null
      title = `戒除中 ${quits.length} 個`
      sub = best ? `目前最長已維持 ${best} 天` : '從今天開始數日子'
    }
    const quit = builds.length && quits.length
      ? `<div class="hb-sum-quit"><span>戒除中 <b>${quits.length}</b> 個</span><span>最久 <b>${best}</b> 天</span></div>`
      : ''
    return `${ring}<div class="hb-sum-text"><div class="hb-sum-title">${title}</div><div class="hb-sum-sub">${sub}</div></div>${quit}`
  }

  _emptyHTML() {
    return `<div class="hb-empty-head"><span class="em">一點一點就好</span>想多做的事、想少做的事，都可以交給這裡</div>
      <div class="hb-kinds">
        <div class="hb-kind hb-c" style="--mc:${colorOf(2)}"><header><span class="stamp-k">育</span><b>養成<small>そだてる</small></b></header>
          <p>想多做的事。照選好的日子打卡，達到當日目標就完成；休息日不計入連續天數。</p></div>
        <div class="hb-kind hb-c" style="--mc:${colorOf(1)}"><header><span class="stamp-k">止</span><b>戒除<small>やめる</small></b></header>
          <p>想少做的事。不用打卡，只要數著沒碰它的日子；想做卻忍住了，就按一下「忍住了」。</p></div>
      </div>
      <h4 class="hb-sub">常見習慣<small>ひとつえらんで</small></h4>
      ${this._tplHTML('build')}<div class="hb-tpl-gap"></div>${this._tplHTML('quit')}`
  }

  // 一鍵加入的小卡；已經有同名的（含封存）就不顯示
  _tplHTML(kind) {
    const names = new Set(this.store.state.habits.map((h) => h.name))
    const list = HABIT_TEMPLATES.map((t, i) => [t, i]).filter(([t]) => t.kind === kind && !names.has(t.name))
    if (!list.length) return ''
    return `<div class="hb-tpls">${list.map(([t, i]) => `<button type="button" class="hb-tpl hb-c" data-act="tpl" data-i="${i}" style="--mc:${colorOf(t.color)}">
      <span class="stamp-k">${esc(t.icon)}</span><span class="hb-tpl-t"><b>${esc(t.name)}</b><small>${t.kind === 'build' ? `每天 ${t.target} ${esc(t.unit)}` : '數日子'}</small></span>${ICON.plus}</button>`).join('')}</div>`
  }

  _card(h, today) {
    const open = this.openId === h.id
    const build = h.kind === 'build'
    const done = build && doneOn(h, today)
    const rest = build && !applies(h, today)
    const kids = [{ k: 'm', html: build ? this._buildHTML(h, today, open) : this._quitHTML(h, today, open) }]
    if (!build && this.slipId === h.id) kids.push({ k: 's', html: this._slipHTML(h) })
    if (open) {
      const d = [{ k: 'i', html: this._detailHTML(h, today) }]
      if (this.editId === h.id) d.push({ k: 'e', html: this._formHTML(h) })
      kids.push({ k: 'd', cls: 'hb-detail', kids: d })
    }
    return {
      k: h.id, tag: 'article', kids, style: `--mc:${colorOf(h.color)}`,
      cls: `hb-card hb-c ${h.kind}${done ? ' done' : ''}${rest ? ' rest' : ''}${open ? ' open' : ''}`,
    }
  }

  // 養成卡片：印章、名稱、今天進度、最近 7 天、＋／－
  _buildHTML(h, today, open) {
    const c = countOn(h, today)
    const t = h.target || 1
    const done = c >= t
    const due = applies(h, today)
    const st = streak(h, today)
    const dots = []
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i)
      let cls
      let tip
      if (d < startOf(h) || !applies(h, d)) [cls, tip] = ['off', '不用做']
      else if (doneOn(h, d)) [cls, tip] = ['on', '做到了']
      else if (d === today) [cls, tip] = [countOn(h, d) ? 'part now' : 'now', '今天還在進行']
      else [cls, tip] = [countOn(h, d) ? 'part' : 'miss', countOn(h, d) ? `做了 ${countOn(h, d)} ${h.unit}` : '未達標']
      dots.push(`<i class="hb-dot ${cls}" title="${md(d)}・${esc(tip)}"></i>`)
    }
    const bump = this.bump === 'plus:' + h.id ? ' bump' : ''
    const lock = done && t === 1
    return `<div class="hb-main">
      <button type="button" class="hb-head" data-act="open" data-id="${h.id}" aria-expanded="${open}">
        <span class="stamp-k">${esc(h.icon)}</span>
        <span class="hb-info">
          <span class="hb-name">${esc(h.name)}</span>
          <span class="hb-meta"><span class="hb-count"><em>${c}</em> / ${t} ${esc(h.unit)}</span><span>${due ? freqLabel(h.days) : `今天休息・${freqLabel(h.days)}`}</span></span>
          <span class="hb-week">${dots.join('')}${st ? `<span class="hb-streak">連續 ${st} 天</span>` : ''}</span>
        </span>
      </button>
      <div class="hb-ctrl">
        <button type="button" class="hb-minus${c ? '' : ' off'}" data-act="minus" data-id="${h.id}" title="收回一次" aria-label="收回一次" ${c ? '' : 'tabindex="-1"'}>${ICON.minus}</button>
        <button type="button" class="hb-plus${bump}" data-act="plus" data-id="${h.id}" ${lock ? 'disabled' : ''} title="${lock ? '今天完成了' : `打卡（${c} / ${t}）`}" aria-label="${lock ? '今天完成了' : '打卡一次'}">
          <svg class="hb-ring" viewBox="0 0 48 48"><circle cx="24" cy="24" r="21"/><circle class="fg" cx="24" cy="24" r="21" style="stroke-dashoffset:${(RING * (1 - Math.min(1, c / t))).toFixed(2)}"/></svg>
          <span>${done ? ICON.check : ICON.plus}</span>
        </button>
      </div>
    </div>`
  }

  // 戒除卡片：已經 n 天、下一個里程碑、忍住了／破戒了
  _quitHTML(h, today, open) {
    const days = cleanDays(h, today)
    const slipped = slippedOn(h, today)
    const urges = h.urges?.[today] || 0
    const best = bestClean(h, today)
    const next = nextMilestone(days)
    const prev = Math.max(0, ...QUIT_MILESTONES.filter((m) => m <= days))
    const pct = next ? (days - prev) / (next - prev) : 1
    const cap = slipped ? '重新開始' : days ? '已經' : '從今天開始'
    const bump = this.bump === 'resist:' + h.id ? ' bump' : ''
    const mid = slipped
      ? `<div class="hb-restart"><span>天數重新起算，之前的努力也都在。</span><button type="button" data-act="undo" data-id="${h.id}">按錯了？復原</button></div>`
      : `<div class="hb-ms"><div class="hb-bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div><span>${next ? `下一站 ${next} 天・再 ${next - days} 天` : '已累積 365 天以上，這一段值得紀念'}</span></div>`
    return `<div class="hb-main">
      <button type="button" class="hb-head" data-act="open" data-id="${h.id}" aria-expanded="${open}">
        <span class="stamp-k">${esc(h.icon)}</span>
        <span class="hb-info">
          <span class="hb-name">${esc(h.name)}</span>
          <span class="hb-meta"><span>最長紀錄 ${best} 天</span></span>
        </span>
        <span class="hb-clean"><small>${cap}</small><b>${days}<small>天</small></b></span>
      </button>
    </div>
    ${mid}
    <div class="hb-acts">
      <button type="button" class="hb-resist${bump}" data-act="resist" data-id="${h.id}">忍住了${urges ? `<small>今天 ${urges} 次</small>` : ''}</button>
      <button type="button" class="hb-slipbtn${this.slipId === h.id ? ' on' : ''}" data-act="slip" data-id="${h.id}" aria-expanded="${this.slipId === h.id}">破戒了…</button>
    </div>`
  }

  _slipHTML(h) {
    return `<form class="hb-slip" data-form="slip" data-id="${h.id}" autocomplete="off">
      <p>沒關係，誰都會有這種時候。天數會重新開始，但你忍住過的每一次都還在。</p>
      <input class="hb-input" name="note" maxlength="80" placeholder="想記一下當時的狀況嗎？（可以不填）" />
      <div class="hb-f-btns"><button type="button" class="btn-ghost" data-act="slip-cancel" data-id="${h.id}">先不要</button><button type="submit" class="btn-primary">重新開始</button></div>
    </form>`
  }

  // 詳情：12 週熱度圖、統計、（戒除）重新開始的紀錄、工具列
  _detailHTML(h, today) {
    const build = h.kind === 'build'
    const since = startOf(h)
    const stats = build
      ? [[`${Math.round(rate(h, today, 30) * 100)}<small>%</small>`, '30 天達成率'], [`${bestStreak(h, today)}<small>天</small>`, '最長連續'], [`${sum(h.log)}<small>${esc(h.unit)}</small>`, '累計']]
      : [[`${bestClean(h, today)}<small>天</small>`, '最長紀錄'], [`${sum(h.urges)}<small>次</small>`, '忍住了'], [`${h.slips.length}<small>次</small>`, '重新開始']]
    return `<h4 class="hb-sub">最近 12 週<small>じゅうにしゅう</small></h4>
      ${this._heatHTML(h, today)}
      <div class="hb-stats">${stats.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
      <p class="hb-since">${dateLabel(since, false)}開始・第 ${daysBetween(since, today) + 1} 天${build ? `・${freqLabel(h.days)} ${h.target} ${esc(h.unit)}` : ''}</p>
      ${build ? '' : this._slipsHTML(h)}
      <div class="hb-tools">
        <button type="button" data-act="edit" data-id="${h.id}" class="${this.editId === h.id ? 'on' : ''}">${ICON.edit}編輯</button>
        <button type="button" data-act="archive" data-id="${h.id}">封存</button>
        <button type="button" data-act="delete" data-id="${h.id}">${ICON.del}刪除</button>
      </div>`
  }

  _heatHTML(h, today) {
    const cells = heat(h, today, 12)
    const start = startOf(h)
    const build = h.kind === 'build'
    const t = h.target || 1
    const out = ['<i class="hb-hm"></i>', ...['一', '', '三', '', '五', '', '日'].map((d) => `<i class="hb-wl">${d}</i>`)]
    // 月份標在每月 1 號那一欄；第一欄若附近沒有標籤也標一下
    const near = cells.slice(7, 21).some((c) => c.date.endsWith('-01'))
    for (let w = 0; w < 12; w++) {
      const col = cells.slice(w * 7, w * 7 + 7)
      const first = col.find((c) => c.date.endsWith('-01'))
      const label = first ? `${+first.date.slice(5, 7)}月` : w === 0 && !near ? `${+col[0].date.slice(5, 7)}月` : ''
      out.push(`<i class="hb-hm">${label}</i>`)
      for (const { date, v } of col) {
        const when = md(date)
        const tod = date === today ? ' today' : ''
        if (date > today) out.push('<i class="hb-cell fut"></i>')
        else if (date < start && build) {
          // 開始日以前也能補（開始日會跟著往前移）
          const tip = `${when}・還沒開始記，點一下補打卡`
          out.push(`<button type="button" class="hb-cell pre" data-act="cell" data-id="${h.id}" data-date="${date}" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`)
        } else if (date < start) out.push(`<i class="hb-cell pre" title="${when}・還沒開始"></i>`)
        else if (!build) {
          const [cls, tip] = v === 'slip' ? ['slip', '重新開始'] : v === 'urge' ? ['urge', `忍住了 ${h.urges[date]} 次`] : ['clean', '沒有碰']
          out.push(`<i class="hb-cell ${cls}${tod}" title="${when}・${tip}"></i>`)
        } else if (v === null) out.push(`<i class="hb-cell rest${tod}" title="${when}・不用做"></i>`)
        else {
          const n = countOn(h, date)
          const cls = v >= 1 ? 'full' : v > 0 ? 'part' : 'miss'
          const tip = `${when}・${n} / ${t} ${h.unit}，${v >= 1 ? '點一下清除' : '點一下補到目標'}`
          out.push(`<button type="button" class="hb-cell ${cls}${tod}" data-act="cell" data-id="${h.id}" data-date="${date}" style="--p:${Math.round(v * 100)}%" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`)
        }
      }
    }
    const legend = build
      ? '<span><i class="hb-cell miss"></i>未達標</span><span><i class="hb-cell part" style="--p:45%"></i>做了一些</span><span><i class="hb-cell full"></i>完成</span><span class="tip">點格子可以補打卡</span>'
      : '<span><i class="hb-cell clean"></i>沒有碰</span><span><i class="hb-cell urge"></i>忍住了</span><span><i class="hb-cell slip"></i>重新開始</span>'
    return `<div class="hb-heat">${out.join('')}</div><div class="hb-legend">${legend}</div>`
  }

  _slipsHTML(h) {
    const slips = [...h.slips].sort((a, b) => a.at - b.at)
    if (!slips.length) return `<h4 class="hb-sub">重新開始的紀錄<small>やりなおし</small></h4><p class="hb-none">目前沒有重新開始的紀錄。</p>`
    let prev = startOf(h)
    const rows = slips.map((x) => {
      const d = dateStr(new Date(x.at))
      const kept = Math.max(0, daysBetween(prev, d))
      prev = d
      return { d, x, kept }
    }).reverse()
    const shown = rows.slice(0, 8)
    return `<h4 class="hb-sub">重新開始的紀錄<small>やりなおし</small><span class="count">${slips.length} 次</span></h4>
      <ul class="hb-slips">${shown.map(({ d, x, kept }) => `<li><div><time>${dateLabel(d)} ${hhmm(x.at)}</time><span>累積 ${kept} 天</span></div>${x.note ? `<p>${esc(x.note)}</p>` : '<p class="none">沒有留下備註</p>'}</li>`).join('')}
      ${rows.length > shown.length ? `<li class="more">還有 ${rows.length - shown.length} 筆更早的紀錄</li>` : ''}</ul>`
  }

  // 新增與編輯共用的表單；HTML 只和習慣本身的資料有關，選擇器的狀態留在 DOM 上
  _formHTML(h) {
    const isNew = !h
    const icon = h?.icon || ''
    const color = h ? h.color % EVENT_COLORS.length : this.newColor
    const days = h?.days || []
    const icons = icon && !HABIT_ICONS.includes(icon) ? [icon, ...HABIT_ICONS] : HABIT_ICONS
    const kindSeg = isNew
      ? `<div class="hb-f-top"><div class="seg" role="tablist"><button type="button" data-kind="build">養成</button><button type="button" data-kind="quit">戒除</button></div><span class="hb-f-tip"></span></div>`
      : ''
    return `<form class="hb-form hb-c${h?.kind === 'quit' ? ' quit' : ''}" data-form="${isNew ? 'new' : 'edit'}"${h ? ` data-id="${h.id}"` : ''} autocomplete="off" style="--mc:${colorOf(color)}">
      ${kindSeg}
      <div class="hb-f-name"><span class="stamp-k" data-preview>${esc(icon || (h?.kind === 'quit' ? '禁' : '習'))}</span><input class="hb-input" name="hname" maxlength="30" value="${esc(h?.name || '')}" placeholder="習慣名稱，例如：喝水、熬夜" /></div>
      <div class="hb-f-row top"><span class="hb-f-label">圖示</span><div class="hb-icons">${icons.map((k) => `<button type="button" data-icon="${esc(k)}" class="${k === icon ? 'on' : ''}">${esc(k)}</button>`).join('')}</div></div>
      <div class="hb-f-row"><span class="hb-f-label">顏色</span><div class="swatches hb-swatches">${EVENT_COLORS.map((c, i) => `<button type="button" data-color="${i}" class="${i === color ? 'on' : ''}" style="--c:${c}" aria-label="顏色 ${i + 1}"></button>`).join('')}</div></div>
      <div class="hb-f-row only-build"><span class="hb-f-label">每日目標</span><input class="hb-input hb-num" type="number" name="htarget" min="1" max="99" value="${h?.target || 1}" inputmode="numeric" /><input class="hb-input hb-unit" name="hunit" maxlength="6" value="${esc(h?.unit || '次')}" placeholder="次" aria-label="單位" /></div>
      <div class="hb-f-row only-build top"><span class="hb-f-label">哪幾天<em class="hb-f-freq">${freqLabel(days)}</em></span><div class="hb-wd">${WEEK_ORDER.map((d) => `<button type="button" data-day="${d}" class="${days.includes(d) ? 'on' : ''}" aria-pressed="${days.includes(d)}">${WEEK_ZH[d]}</button>`).join('')}</div></div>
      <div class="hb-f-btns"><button type="button" class="btn-ghost" data-act="${isNew ? 'new-cancel' : 'edit-cancel'}"${h ? ` data-id="${h.id}"` : ''}>取消</button><button type="submit" class="btn-primary">${isNew ? '加入' : '儲存'}</button></div>
    </form>`
  }

  _archHTML(list, today) {
    const rows = list.map((h) => {
      const info = h.kind === 'build' ? `養成・最長連續 ${bestStreak(h, today)} 天` : `戒除・最長紀錄 ${bestClean(h, today)} 天`
      return `<li class="hb-c" style="--mc:${colorOf(h.color)}"><span class="stamp-k">${esc(h.icon)}</span><span class="hb-arch-n">${esc(h.name)}<small>${info}</small></span>
        <button type="button" data-act="unarchive" data-id="${h.id}">取消封存</button><button type="button" data-act="delete" data-id="${h.id}">刪除</button></li>`
    })
    return `<details class="hb-arch"${this.archOpen ? ' open' : ''}><summary>已封存的習慣<small>しまったもの</small><span class="count">${list.length}</span></summary><ul>${rows.join('')}</ul></details>`
  }

  // ── 互動 ──
  _click(e) {
    const b = e.target.closest('button')
    if (!b || !this.root.contains(b) || b.disabled) return
    const f = b.closest('form')
    if (f && b.dataset.icon !== undefined) return this._pickIcon(f, b)
    if (f && b.dataset.color !== undefined) {
      $$('[data-color]', f).forEach((x) => x.classList.toggle('on', x === b))
      f.style.setProperty('--mc', colorOf(+b.dataset.color))
      return
    }
    if (f && b.dataset.day !== undefined) {
      b.setAttribute('aria-pressed', b.classList.toggle('on'))
      $('.hb-f-freq', f).textContent = freqLabel($$('[data-day].on', f).map((x) => +x.dataset.day))
      return
    }
    if (b.dataset.kind) {
      this.newKind = b.dataset.kind
      return this.render()
    }
    const { act, id } = b.dataset
    if (!act) return
    const s = this.store
    const h = id ? s.habit(id) : null
    switch (act) {
      case 'open':
        this.openId = this.openId === id ? null : id
        this.editId = null
        this.render()
        if (this.openId) this._reveal(id)
        break
      case 'plus':
        this.bump = 'plus:' + id
        s.checkHabit(id)
        this.bump = null
        break
      case 'minus':
        s.checkHabit(id, s.today, -1)
        break
      case 'cell': {
        // 補打卡：沒做到就補到目標，做到了就清掉
        const date = b.dataset.date
        const c = countOn(h, date)
        s.checkHabit(id, date, doneOn(h, date) ? -c : (h.target || 1) - c)
        break
      }
      case 'resist':
        this.bump = 'resist:' + id
        s.resistUrge(id)
        this.bump = null
        break
      case 'slip':
        this.slipId = this.slipId === id ? null : id
        this.render()
        if (this.slipId) this._focusIn(`form[data-form="slip"][data-id="${id}"] input`)
        break
      case 'slip-cancel':
        this.slipId = null
        this.render()
        break
      case 'undo':
        s.undoSlip(id)
        break
      case 'edit':
        this.editId = this.editId === id ? null : id
        this.render()
        if (this.editId) this._focusIn(`form[data-form="edit"][data-id="${id}"] input[name="hname"]`)
        break
      case 'edit-cancel':
        this.editId = null
        this.render()
        break
      case 'archive':
        this.openId = this.editId = null
        s.updateHabit(id, { archived: true })
        this.hooks.toast?.({ icon: '封', title: `已封存「${h.name}」`, sub: '想再開始時，在最下面可以取消封存' })
        break
      case 'unarchive':
        s.updateHabit(id, { archived: false })
        this._reveal(id)
        break
      case 'delete':
        armConfirm(b, '確定刪除？', () => s.deleteHabit(id))
        break
      case 'new':
        this.formOpen = true
        this.newColor = s.state.habits.length % EVENT_COLORS.length
        this.render()
        this._focusIn('form[data-form="new"] input[name="hname"]')
        break
      case 'new-cancel':
        this.formOpen = false
        this.render()
        break
      case 'tpl': {
        const t = HABIT_TEMPLATES[+b.dataset.i]
        if (!t) break
        const nh = s.addHabit({ ...t, days: [] })
        this._reveal(nh?.id)
        break
      }
      case 'today':
        this.hooks.selectDate(s.today)
        break
    }
  }

  _submit(e) {
    const f = e.target.closest('form[data-form]')
    if (!f) return
    e.preventDefault()
    const s = this.store
    const type = f.dataset.form
    if (type === 'slip') {
      const id = f.dataset.id
      this.slipId = null
      s.slipHabit(id, f.elements.note.value)
      return
    }
    const v = this._readForm(f)
    if (!v.name) {
      const input = f.elements.hname
      input.classList.remove('shake')
      void input.offsetWidth
      input.classList.add('shake')
      input.focus()
      return
    }
    if (type === 'new') {
      const quit = this.newKind === 'quit'
      this.formOpen = false
      const h = s.addHabit(quit ? { name: v.name, icon: v.icon, color: v.color, kind: 'quit' } : { ...v, kind: 'build' })
      this._reveal(h?.id)
    } else {
      const h = s.habit(f.dataset.id)
      if (!h) return
      this.editId = null
      s.updateHabit(h.id, h.kind === 'quit' ? { name: v.name, icon: v.icon, color: v.color } : v)
    }
  }

  _input(e) {
    const f = e.target.closest('form.hb-form')
    if (f && e.target.name === 'hname') this._preview(f)
  }

  _key(e) {
    if (e.key !== 'Escape') return
    const f = e.target.closest?.('form[data-form]')
    if (!f) return
    const type = f.dataset.form
    if (type === 'slip') this.slipId = null
    else if (type === 'new') this.formOpen = false
    else if (type === 'edit') this.editId = null
    this.render()
  }

  _pickIcon(f, b) {
    const on = !b.classList.contains('on')
    $$('[data-icon]', f).forEach((x) => x.classList.toggle('on', on && x === b))
    this._preview(f)
  }

  // 預覽印章：選了圖示就用圖示，沒選就用名稱第一個字
  _preview(f) {
    const sel = $('[data-icon].on', f)
    const name = f.elements.hname.value.trim()
    const quit = f.dataset.form === 'new' ? this.newKind === 'quit' : f.classList.contains('quit')
    $('[data-preview]', f).textContent = sel?.dataset.icon || [...name][0] || (quit ? '禁' : '習')
  }

  _readForm(f) {
    const el = f.elements
    const name = el.hname.value.trim()
    const days = $$('[data-day].on', f).map((b) => +b.dataset.day)
    return {
      name,
      icon: $('[data-icon].on', f)?.dataset.icon || [...name][0] || '',
      color: +($('[data-color].on', f)?.dataset.color || 0),
      target: Math.max(1, Math.min(99, Math.round(+el.htarget.value) || 1)),
      unit: el.hunit.value.trim() || '次',
      days: days.length === 7 ? [] : days,
    }
  }

  // 新增表單的養成／戒除切換只改 class，不重畫表單（保留已輸入的內容）
  _syncNewForm() {
    const f = $('form[data-form="new"]', this.root)
    if (!f) return
    const quit = this.newKind === 'quit'
    f.classList.toggle('quit', quit)
    $$('[data-kind]', f).forEach((b) => b.classList.toggle('on', b.dataset.kind === this.newKind))
    f.elements.hname.placeholder = quit ? '想戒除什麼？例如：熬夜、喝手搖飲' : '想養成什麼？例如：喝水、伸展'
    $('.hb-f-tip', f).textContent = quit ? '不用打卡，數著沒碰它的日子' : '照選好的日子打卡，達標就完成'
    $('.btn-primary', f).textContent = quit ? '加入' : '加入'
    this._preview(f)
  }

  // 摘要環從上一次的進度滑到這一次
  _animateRing() {
    const fg = $('.hb-ring-big .fg', this.root)
    if (!fg) return (this.ringFrom = null)
    if (fg.style.strokeDashoffset !== fg.dataset.to) requestAnimationFrame(() => requestAnimationFrame(() => (fg.style.strokeDashoffset = fg.dataset.to)))
    this.ringFrom = this.ringTo
  }

  // 重畫後把焦點還給同一顆按鈕（鍵盤連按＋不會掉焦點）
  _focusKey() {
    const a = document.activeElement
    if (!a || !this.root.contains(a) || a.tagName !== 'BUTTON' || !a.dataset.act) return null
    return { act: a.dataset.act, id: a.dataset.id, date: a.dataset.date }
  }
  _restoreFocus(k) {
    if (!k || this.root.contains(document.activeElement)) return
    let sel = `[data-act="${k.act}"]`
    if (k.id) sel += `[data-id="${CSS.escape(k.id)}"]`
    if (k.date) sel += `[data-date="${k.date}"]`
    $(sel, this.root)?.focus({ preventScroll: true })
  }
  _focusIn(sel) {
    requestAnimationFrame(() => $(sel, this.root)?.focus({ preventScroll: false }))
  }
  _reveal(id) {
    if (!id) return
    requestAnimationFrame(() => $(`article[data-k="${CSS.escape(id)}"]`, this.root)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
}
