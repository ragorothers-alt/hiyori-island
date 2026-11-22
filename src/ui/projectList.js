// UI 的方法（從 ui.js 搬過來，掛回 UI.prototype）：專案頁：列表、卡片、打開專案、找專案
import { flipItems } from './motion.js'
import { PROJECT_COLORS, MAX_PROJECTS } from '../theme.js'
import { addDays } from '../store.js'
import { $, $$, esc, ICON, armConfirm, inlineEdit, editing, scrollMode } from './dom.js'
import { latestLog, msProgress, msSteps, msTasks, projectStats } from '../projects.js'
import { markHTML, queryTerms, searchProjects } from '../projectSearch.js'
import { SAMPLE_TAG, daysBetween, fmtHours, relDay } from './shared.js'

export const projectListMethods = {
  // ── 專案 ──
  _bindProjects() {
    const form = $('#projectForm')
    $('#newProjectBtn').onclick = () => {
      if (!this.store.canAddProject()) {
        this.toast({ icon: '町', title: `已經有 ${MAX_PROJECTS} 個進行中的專案`, sub: '先收藏已完成的專案吧' })
        return
      }
      form.hidden = false
      $('#newProjectBtn').hidden = true
      showDeadline(false)
      $('#projectName').focus()
    }
    // 截止日可有可無：預設不設，按「＋ 截止日」才出現日期（先填兩週後）
    const showDeadline = (on) => {
      $('#projectDeadlineAdd').hidden = on
      $('#projectDeadlineField').hidden = !on
      $('#projectDeadline').value = on ? addDays(this.store.today, 14) : ''
    }
    $('#projectDeadlineAdd').onclick = () => {
      showDeadline(true)
      $('#projectDeadline').focus()
    }
    $('#projectDeadlineClear').onclick = () => showDeadline(false)
    $('#cancelProject').onclick = () => {
      form.hidden = true
      $('#newProjectBtn').hidden = false
    }
    $('#projectColor').addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b) return
      this.projectColor = +b.dataset.i
      this._syncPickers()
    })
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const p = this.store.addProject({
        name: $('#projectName').value,
        color: this.projectColor,
        deadline: $('#projectDeadline').value,
        milestones: $('#projectMilestones').value.split('\n'),
      })
      if (!p) return
      form.reset()
      form.hidden = true
      $('#newProjectBtn').hidden = false
      this.projectColor = (this.projectColor + 1) % PROJECT_COLORS.length
      this._syncPickers()
      this.hooks.focusProject(p.id)
    })

    const onClick = (e) => {
      const card = e.target.closest('.proj')
      if (!card) return
      const id = card.dataset.id
      const s = this.store
      const p = s.state.projects.find((x) => x.id === id)
      const act = e.target.closest('[data-act]')?.dataset.act
      const mid = e.target.closest('.ms')?.dataset.mid
      // 點標題或摘要也是打開（輸入框、按鈕除外）
      if (act === 'open' || (!act && e.target.closest('.proj-head, .proj-sum') && !e.target.closest('input'))) this._openProjHit(id)
      else if (act === 'ms-toggle') s.toggleMilestone(id, mid)
      else if (act === 'ms-delete') armConfirm(e.target.closest('button'), ICON.check, () => s.deleteMilestone(id, mid))
      else if (act === 'view') this._onIsland(() => this.hooks.focusProject(id))
      else if (act === 'pause' || act === 'resume') s.pauseProject(id, act === 'pause')
      else if (act === 'more') {
        this._moreOpen = this._moreOpen === id ? null : id
        this.renderProjects()
      }
      else if (act === 'rename') inlineEdit($('.proj-name', card), p.name, (v) => (v ? s.updateProject(id, { name: v }) : this.renderProjects()))
      else if (act === 'color') s.updateProject(id, { color: (p.color + 1) % PROJECT_COLORS.length })
      else if (act === 'deadline') {
        this._dlEdit = id
        this.renderProjects()
        $(`.proj[data-id="${CSS.escape(id)}"] .dl-input`)?.focus()
      } else if (act === 'dl-save' || act === 'dl-clear' || act === 'dl-cancel') {
        this._dlEdit = null
        if (act === 'dl-cancel') this.renderProjects()
        else s.setDeadline(id, act === 'dl-clear' ? '' : $('.dl-input', card).value)
      }
      else if (act === 'archive') {
        this._moreOpen = null
        s.archiveProject(id, true)
      }
      else if (act === 'restore') {
        if (!s.archiveProject(id, false)) this.toast({ icon: '町', title: `已經有 ${MAX_PROJECTS} 個進行中的專案`, sub: '先收藏其他專案再放回來吧' })
      } else if (act === 'delete') armConfirm(e.target.closest('button'), '確定刪除？', () => s.deleteProject(id))
    }
    $('#projectList').addEventListener('click', onClick)
    $('#archiveList').addEventListener('click', onClick)
    // 搜尋找不到：直接用打的字開一個新專案
    $('#projectList').addEventListener('click', (e) => {
      if (!e.target.closest('[data-act="new-from-q"]')) return
      $('#newProjectBtn').click()
      if (!form.hidden) $('#projectName').value = (this.projQuery || '').trim().slice(0, 40)
    })
    $('#projectList').addEventListener('submit', (e) => {
      e.preventDefault()
      const card = e.target.closest('.proj')
      const input = $('input', e.target)
      if (input.value.trim()) {
        this._keepMsFocus = card.dataset.id
        this.store.addMilestone(card.dataset.id, input.value)
      }
    })
    $('#projectFilter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]')
      if (!b) return
      this.projFilter = b.dataset.f
      this.renderProjects()
    })
    // 快捷搜尋：打字就篩（中文組字中先不找，選好字才找）；上下鍵選、Enter 打開、Esc 先清掉字
    const q = $('#projectQuery')
    const setQuery = (v) => {
      if (v === (this.projQuery || '')) return
      this.projQuery = v
      this._projSel = 0
      this.renderProjects()
    }
    q.addEventListener('input', (e) => {
      if (!e.isComposing) setQuery(q.value)
    })
    q.addEventListener('compositionend', () => setQuery(q.value))
    q.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return
      const ids = this._projHits || []
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!ids.length) return
        e.preventDefault()
        this._projSel = ((this._projSel || 0) + (e.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length
        this._markProjSel(true)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const id = ids[this._projSel || 0]
        if (id) this._openProjHit(id)
      } else if (e.key === 'Escape' && q.value) {
        e.preventDefault()
        q.value = ''
        setQuery('')
      }
    })
    q.addEventListener('focus', () => this._markProjSel(false))
    q.addEventListener('blur', () => {
      this.hooks.hoverProject(null)
      // 用快捷鍵叫出來、專案還不多：沒打字就離開的話，下次重畫時收起來
      // （不在這裡馬上收：滑鼠按下去時就會 blur，版面一跳，點的那顆按鈕就點不到了）
      if (!q.value) this._projSearchOn = false
    })
    $('#projectList').addEventListener('mouseover', (e) => this.hooks.hoverProject(e.target.closest('.proj')?.dataset.id || null))
    $('#projectList').addEventListener('mouseleave', () => this.hooks.hoverProject(null))
  },

  _deadlineText(p) {
    if (this._dlEdit === p.id) {
      return `<span class="dl-edit"><input type="date" class="dl-input" value="${p.deadline || addDays(this.store.today, 14)}" aria-label="截止日">`
        + `<button type="button" data-act="dl-save">好</button>${p.deadline ? '<button type="button" data-act="dl-clear">不設截止</button>' : ''}<button type="button" data-act="dl-cancel">取消</button></span>`
    }
    if (!p.deadline) return ''
    if (p.completedAt && this.store.progress(p) >= 1) {
      const day = new Date(p.completedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
      return p.onTime ? `<span class="ontime">✦ ${day} 準時落成</span>` : `<span>已於 ${day} 落成</span>`
    }
    const d = daysBetween(this.store.today, p.deadline)
    const md = p.deadline.slice(5).replace('-', '/')
    if (d < 0) return `<span class="warn">已逾期 ${-d} 天（${md}）</span>`
    if (d === 0) return `<span class="warn">今天截止</span>`
    return `<span class="${d <= 2 ? 'warn' : ''}">截止 ${md} · 剩 ${d} 天</span>`
  },

  // 常用的放外面，其他收進「更多」
  _projectActions(p) {
    const b = (act, label) => `<button data-act="${act}">${label}</button>`
    const main = [
      `<button data-act="open" class="proj-open">進度與筆記</button>`,
      b('view', this.appMode ? '切到小島看看' : '在島上查看'),
      p.completedAt ? '' : p.pausedAt ? b('resume', '繼續') : b('pause', '暫停'),
      p.completedAt || p.pausedAt ? '' : b('deadline', '截止日'),
    ]
    const more = this._moreOpen === p.id
      ? [b('rename', '改名'), b('color', '換色'), b('archive', '收藏'), b('delete', '刪除'), b('more', '收起')]
      : [b('more', '更多')]
    return [...main, ...more].join('')
  },

  // find：搜尋中（{ terms, hit }）：名稱和里程碑標出找到的字，再多一行寫在哪裡找到的
  _projectCard(p, archived = false, find = null) {
    const s = this.store
    const mk = (t) => (find ? markHTML(t, find.terms) : esc(t))
    const prog = s.progress(p)
    const pct = Math.round(prog * 100)
    const c = PROJECT_COLORS[p.color % PROJECT_COLORS.length]
    const doneN = p.milestones.filter((m) => m.done).length
    // 每個里程碑底下的任務：完成的任務和細項一樣推進里程碑
    const by = msTasks(p, s.state.tasks)
    const ms = p.milestones
      .map((m) => {
        const n = msSteps(m, by.get(m.id))
        return `<li class="ms ${m.done ? 'done' : ''}" data-mid="${esc(m.id)}">
          <button class="check" data-act="ms-toggle" aria-label="完成「${esc(m.title)}」" aria-pressed="${!!m.done}" style="--c:${c}">${ICON.check}</button>
          <span>${mk(m.title)}</span>${n.total && !m.done ? `<small class="ms-n" title="細項和歸在這裡的任務做了幾件">${n.done}/${n.total}</small>` : ''}
          <button class="mini" data-act="ms-delete" title="刪除">${ICON.del}</button>
        </li>`
      })
      .join('')
    const paused = !archived && !!p.pausedAt
    const tags = paused ? '<span class="paused">暫停中</span>' : ''
    // 最新一則進度和筆記、日誌、專注的數字：點一下打開詳情
    const last = latestLog(p)
    const st = projectStats(p, s.state.tasks)
    const nums = [st.notes && `筆記 ${st.notes}`, st.logs && `進度 ${st.logs} 則`, st.focus && `專注 ${fmtHours(st.focus)}`].filter(Boolean).join('・')
    const sum = last || nums
      ? `<div class="proj-sum">${last ? `<span class="ps-last">${esc(last.text || `投入 ${fmtHours(last.mins)}`)}<small>${relDay(last.date, s.today)}</small></span>` : ''}${nums ? `<span class="ps-n">${nums}</span>` : ''}</div>`
      : ''
    const bar = p.milestones.map((m) => `<i style="--f:${msProgress(m, by.get(m.id)).toFixed(3)}"></i>`).join('') || '<i style="--f:0"></i>'
    const hit = find?.hit ? `<div class="proj-hit"><b>${esc(find.hit.kind)}</b>${markHTML(find.hit.text, find.terms)}</div>` : ''
    return `<div class="proj ${paused ? 'is-paused' : ''} ${this.hlKey === 'project:' + p.id ? 'hl' : ''}" data-id="${esc(p.id)}" style="--c:${c}">
      <div class="proj-head"><div class="proj-name">${s.isSample(p) ? SAMPLE_TAG : ''}${mk(p.name)}</div><div class="proj-pct">${pct}%</div></div>
      <div class="proj-meta">${tags}${paused ? '' : this._deadlineText(p)}<span>${doneN} / ${p.milestones.length} 個里程碑</span></div>
      ${hit}
      <div class="proj-bar">${bar}</div>
      ${sum}
      ${archived ? '' : `<ul class="ms-list">${ms}</ul>
      <form class="ms-add"><input placeholder="新增里程碑" maxlength="60" aria-label="新增里程碑" /><button class="mini" type="submit" title="新增" aria-label="新增里程碑">${ICON.plus}</button></form>`}
      <div class="proj-actions">
        ${archived
          ? `<button data-act="open">打開</button><button data-act="restore" title="放回進行中的專案，房子也會回到島上">恢復</button><button data-act="delete">刪除</button>`
          : this._projectActions(p)}
      </div>
    </div>`
  },

  // ── 專案詳情 ──
  // taskId：直接打開那件任務在專案裡的頁面
  // taskId：直接打開那件任務的頁面；write：游標放在「寫紀錄」的框裡
  // 搜尋結果裡的專案：找到的是筆記就打開那一篇，是里程碑、進度就到那一塊（沒在搜尋就照平常打開）
  _openProjHit(id) {
    const ref = this._projHits?.includes(id) ? this._projRefs?.get(id) : null
    this.openProject(id, ref?.sec, null, false, ref?.note || null)
  },
  openProject(id, sec, taskId = null, write = false, noteId = null) {
    if (!this._project.view) return this._use(this._project, () => this.openProject(id, sec, taskId, write, noteId))
    // 返回鍵回到列表（記一筆瀏覽紀錄：_syncBack）
    this._project.view.open(id, sec, taskId, noteId)
    this._syncBackSoon()
    this._stale?.add('projects')
    if (this.tab === 'projects') this._renderPage('projects')
    else this.setTab('projects')
    $('#panel .panel-body')?.scrollTo({ top: 0 })
    requestAnimationFrame(() => (write ? this._project.view.focusLog() : this._project.view.focusBack()))
  },
  // 專注完一輪：打開那件任務的頁面寫紀錄（大計時器開著的話先收起來）
  openTaskLog(tid) {
    const t = this.store.state.tasks.find((x) => x.id === tid)
    if (!t?.project) return
    this.focus.toggleBig(false)
    this.openProject(t.project, undefined, tid, true)
  },
  closeProject() {
    const pv = this._project.view
    if (!pv) return
    const id = pv.id
    pv.close()
    this._syncBackSoon()
    // 回到列表：剛剛動過的專案排到前面
    this._projRank = null
    this._stale?.add('projects')
    this._renderPage('projects')
    // 回到列表上剛剛那張卡
    const card = id && $(`.proj[data-id="${CSS.escape(id)}"]`)
    if (!card) return
    card.scrollIntoView({ block: 'center' })
    $('[data-act="open"]', card)?.focus({ preventScroll: true })
  },

  // 快捷搜尋（`/` 或 Ctrl／⌘＋K）：從哪一頁、哪個專案的詳情都直接跳到專案列表上的搜尋框
  findProject() {
    if (this._project.view?.id) this.closeProject()
    this._projSearchOn = true
    if (this.tab !== 'projects') this.setTab('projects')
    else this.renderProjects()
    const q = $('#projectQuery')
    q.focus()
    q.select()
  },
  // 上下鍵選到的那個搜尋結果：框起來、捲到看得到，島上那棟房子的名牌也放大
  _markProjSel(scroll) {
    const ids = this._projHits || []
    if (!ids.length) return
    const i = Math.min(this._projSel || 0, ids.length - 1)
    this._projSel = i
    let el = null
    for (const c of $$('#projectList .proj')) {
      const on = c.dataset.id === ids[i]
      c.classList.toggle('sel', on)
      if (on) el = c
    }
    if (document.activeElement !== $('#projectQuery')) return
    const p = this.store.state.projects.find((x) => x.id === ids[i])
    this.hooks.hoverProject(p && !p.archived ? p.id : null)
    if (!scroll || !el) return
    el.scrollIntoView({ block: 'nearest', behavior: scrollMode() })
    if (p) $('#projectFound').textContent = `第 ${i + 1} 個，共 ${ids.length} 個：${p.name}`
  },

  renderProjects() {
    const s = this.store
    // 打開了某個專案：換成詳情（專案被刪掉、或同步後不見了就回到列表）
    const pv = this._project.view
    const open = !!pv?.id && s.state.projects.some((p) => p.id === pv.id)
    $('#projectHome').hidden = open
    $('#projectDetail').hidden = !open
    if (open) return pv.render()
    if (pv?.id) pv.close()
    // 正在就地改專案名稱：先不重畫列表（改完或取消時會再畫一次）
    if (editing($('#projectHome'))) return
    // 最近動過的專案在前（store 的 editedAt）。順序只在進到這一頁時重排（切到專案分頁、從詳情回來）：
    // 待在列表上勾里程碑、改名、暫停時，卡片不會在游標底下跳走；這段時間新建立或放回來的排在最前面
    const all = s.activeProjects()
    const recent = (a, b) => (b.editedAt || b.createdAt) - (a.editedAt || a.createdAt)
    if (!this._projRank) this._projRank = new Map([...all].sort(recent).map((p, i) => [p.id, i]))
    const rankOf = (p) => this._projRank.get(p.id) ?? -1
    const active = all.sort((a, b) => rankOf(a) - rankOf(b) || recent(a, b))
    const archived = s.state.projects.filter((p) => p.archived)
    // 狀態篩選：有兩種以上狀態時才出現
    const count = { all: all.length, active: 0, paused: 0, done: 0 }
    for (const p of all) count[s.projectStatus(p)]++
    const kinds = ['active', 'paused', 'done'].filter((k) => count[k])
    if (!count[this.projFilter || 'all']) this.projFilter = 'all'
    const filter = kinds.length > 1 ? this.projFilter || 'all' : 'all'
    // 快捷搜尋：專案多了才出現（打了字、或用快捷鍵叫出來的也留著）。搜尋時不管狀態篩選，收藏的也一起找
    const query = this.projQuery || ''
    const found = searchProjects([...active, ...archived], query)
    $('#projectSearch').hidden = !(s.state.projects.length >= 4 || query || this._projSearchOn)
    $('#projectFilter').hidden = kinds.length < 2 || !!found
    $('#projectFilter').innerHTML = [['all', '全部'], ['active', '進行中'], ['paused', '暫停'], ['done', '已落成']]
      .filter(([k]) => count[k])
      .map(([k, label]) => `<button type="button" data-f="${k}" class="${k === filter ? 'on' : ''}">${label} ${count[k]}</button>`)
      .join('')
    const shown = filter === 'all' ? active : active.filter((p) => s.projectStatus(p) === filter)
    // 「新增里程碑」打到一半的字：重畫（勾別的里程碑、其他分頁同步）時照專案留著，游標也放回去
    const drafts = new Map()
    let caret = null
    for (const inp of $$('#projectList .ms-add input')) {
      const id = inp.closest('.proj')?.dataset.id
      if (!id) continue
      if (inp.value) drafts.set(id, inp.value)
      if (inp === document.activeElement) caret = { id, a: inp.selectionStart, b: inp.selectionEnd }
    }
    // 剛送出的那張卡：字已經變成里程碑了，清空並留在輸入框繼續打
    if (this._keepMsFocus) {
      drafts.delete(this._keepMsFocus)
      caret = { id: this._keepMsFocus, a: 0, b: 0 }
      this._keepMsFocus = null
    }
    // 整串重畫：原本就在的卡片不重播淡入（勾一個里程碑整頁就閃一下），位置變了的滑過去
    flipItems(
      [$('#projectList'), $('#archiveList')],
      () => {
        if (found) {
          // 進行中的在前、收藏的另外一組；上下鍵照畫面上的順序走
          const terms = queryTerms(query)
          const on = found.filter((r) => !r.p.archived)
          const off = found.filter((r) => r.p.archived)
          this._projHits = [...on, ...off].map((r) => r.p.id)
          // 找到的是筆記、里程碑、進度：打開時直接到那裡
          this._projRefs = new Map([...on, ...off].map((r) => [r.p.id, r.hit?.ref || null]))
          const card = (r) => this._projectCard(r.p, r.p.archived, { terms, hit: r.hit })
          const q = esc(query.trim())
          $('#projectList').innerHTML = found.length
            ? on.map(card).join('') + (off.length ? `<h4 class="proj-group">已收藏的專案</h4>${off.map(card).join('')}` : '')
            : `<div class="empty"><span class="em">見つからない</span>名稱、里程碑、筆記和進度裡都沒有「${q}」。<br><button type="button" class="btn-ghost" data-act="new-from-q">＋ 開一個叫「${q}」的專案</button></div>`
          $('#projectFound').textContent = found.length ? `找到 ${found.length} 個專案，按 Enter 打開第一個` : `找不到「${query.trim()}」`
          $('#archiveBox').hidden = true
          this._markProjSel(false)
        } else {
          this._projHits = null
          $('#projectFound').textContent = ''
          $('#projectList').innerHTML = active.length
            ? shown.map((p) => this._projectCard(p)).join('')
            : `<div class="empty"><span class="em">まっさらな島</span>建立專案並寫下里程碑，<br>每完成一個，專案町的房子就會再蓋一段${this.appMode ? '（回到小島就看得到）' : ''}。</div>`
          $('#archiveBox').hidden = !archived.length
        }
        $('#archiveList').innerHTML = found ? '' : archived.map((p) => this._projectCard(p, true)).join('')
      },
      '.proj[data-id]',
    )
    const msInput = (id) => $(`#projectList .proj[data-id="${CSS.escape(id)}"] .ms-add input`)
    for (const [id, v] of drafts) {
      const inp = msInput(id)
      if (inp) inp.value = v
    }
    const inp = caret && msInput(caret.id)
    if (inp) {
      inp.focus({ preventScroll: true })
      try {
        inp.setSelectionRange(caret.a ?? inp.value.length, caret.b ?? inp.value.length)
      } catch {}
    }
  },

}
