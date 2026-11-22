// UI 的方法（從 ui.js 搬過來，掛回 UI.prototype）：紀錄頁：章節導覽、各區塊
import { hapticsOn, setHaptics, haptic } from './haptics.js'
import { ENERGY, feelOf, clipText } from '../data/life.js'
import { UNLOCKS, WEEK_ZH, moodOf } from '../theme.js'
import { addDays, parseDate } from '../store.js'
import { notifyPermission } from '../reminders.js'
import { ACHIEVEMENTS } from '../data/achievements.js'
import { $, $$, esc, armConfirm, setHTML, scrollMode } from './dom.js'
import { readBackup } from '../sync.js'

export const recordsMethods = {
  _bindRecords() {
    this._bindReview()
    this._bindDex()
    $('#weekBtn').onclick = () => this.openWeekCard()
    $('#reportBtn').onclick = () => this.openReport()
    $('#weekClose').onclick = () => this.closeWeekCard()
    $('#weekModal').addEventListener('click', (e) => {
      if (e.target.id === 'weekModal') this.closeWeekCard()
    })
    $('#bondBox').addEventListener('click', (e) => {
      const b = e.target.closest('[data-outfit]:not(:disabled)')
      if (b) this.store.setOutfit(b.dataset.outfit, b.dataset.who)
    })
    $('#townBox').addEventListener('click', (e) => {
      const b = e.target.closest('[data-town], [data-ptown]')
      if (!b) return
      this._onIsland(() => {
        // 手機上面板蓋住下半部，收起來才看得到浮島
        if (innerWidth <= 860) this.togglePanel(true)
        if (b.dataset.town) this.hooks.focusTown?.(b.dataset.town)
        else this.hooks.focusProjectTown?.()
      })
    })
    $('#themePick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (b) this.setTheme(b.dataset.v)
    })
    $('#layoutPick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (b) this.setAppMode(b.dataset.v === 'app')
    })
    $('#fontPick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (!b) return
      this.store.setSetting('fontScale', +b.dataset.v)
      this.applyFontScale()
      this.renderSettings()
    })
    // 拖的時候只換畫面（轉場先關掉，玻璃才會馬上跟著變），放開（或用方向鍵調）才存
    $('#glassRange').addEventListener('input', (e) => {
      document.body.classList.add('glass-adjusting')
      this.applyGlass(+e.target.value)
    })
    $('#glassRange').addEventListener('change', (e) => {
      this.store.setSetting('glass', +e.target.value)
      requestAnimationFrame(() => document.body.classList.remove('glass-adjusting'))
    })
    $('#hapticBtn').onclick = () => {
      setHaptics(!hapticsOn())
      // 打開時馬上震一下：知道現在是什麼感覺
      haptic('done')
      this.renderSettings()
    }
    // 通知與提醒的四個總開關
    $('#remindOnBtn').onclick = () => {
      this.store.setSetting('remindOn', this.store.state.settings.remindOn === false)
      this.renderSettings()
    }
    $('#nudgeOnBtn').onclick = () => {
      const on = this.store.state.settings.nudgeOn === false
      this.store.setSetting('nudgeOn', on)
      // 關掉時已經在畫面上的建議收起來
      if (!on) for (const tag of ['back', 'next', 'review', 'week', 'fuji-notes']) this.dropToasts(tag)
      this.renderSettings()
      this.renderTasks()
      if (this.tab === 'today') this.today.render()
    }
    $('#chatOnBtn').onclick = () => {
      this.store.setSetting('chatOn', this.store.state.settings.chatOn === false)
      this.renderSettings()
    }
    $('#mottoOnBtn').onclick = () => {
      this.store.setMottoOn(!this.store.mottoOn())
      if (!this.store.mottoOn()) this.dropToasts('motto')
      this.mottoBar?.render()
      this.renderSettings()
    }
    $('#stuckBtn').onclick = () => {
      this.store.setSetting('stuckNudge', !this.store.state.settings.stuckNudge)
      this.renderSettings()
      this.renderTasks()
    }
    $('#awayBtn').onclick = () => {
      this.store.setSetting('awayNudge', this.store.state.settings.awayNudge === false)
      this.renderSettings()
    }
    // 打開時還沒開系統通知：先問權限（叫你回來靠的是通知）；不允許就先不打開
    $('#tabBtn').onclick = async () => {
      const on = this.store.state.settings.tabNudge !== true
      if (on && !(this.store.state.settings.notify && notifyPermission() === 'granted') && !(await this.enableNotify())) {
        this.toast({ icon: '鐘', title: '要先允許通知才叫得到你', sub: '瀏覽器擋下了通知的話，到網址列左邊的網站設定打開' })
        return this.renderSettings()
      }
      this.store.setSetting('tabNudge', on)
      this.renderSettings()
    }
    $('#backBtn').onclick = () => {
      this.store.setSetting('backNudge', this.store.state.settings.backNudge === false)
      this.renderSettings()
    }
    $('#nextBtn').onclick = () => {
      this.store.setSetting('nextNudge', this.store.state.settings.nextNudge === false)
      this.renderSettings()
    }
    $('#briefBtn').onclick = () => {
      this.store.setSetting('brief', this.store.state.settings.brief === false)
      this.renderSettings()
    }
    $('#briefNow').onclick = () => {
      this.store.tick()
      this.brief.show()
    }
    $('#newsBtn').onclick = () => this.openNews()
    $('#newsClose').onclick = () => this.closeNews()
    $('#newsModal').addEventListener('click', (e) => {
      if (e.target.id === 'newsModal') this.closeNews()
    })
    // 設定頁上的音效：跟 Dock 上的喇叭同一個開關
    $('#soundSetBtn').onclick = () => {
      $('#soundBtn').click()
      this.renderSettings()
    }
    // 日程提醒、系統通知：跟日程頁上方那一列同一個設定
    $('#remindLeadSet').addEventListener('change', (e) => {
      $('#remindLead').value = e.target.value
      $('#remindLead').dispatchEvent(new Event('change'))
    })
    $('#notifySetBtn').onclick = () => $('#notifyBtn').click()
    $('#focusSetBtn').onclick = () => this.focus.toggleSet(true)
    // 警語的句子和間隔：在紀錄頁的警語那一區
    $('#mottoSetBtn').onclick = () => {
      this.setTab('records')
      requestAnimationFrame(() => $('#mottoRoot').scrollIntoView({ block: 'start', behavior: scrollMode() }))
    }
    $('#agentSetBtn').onclick = () => this.openAgent()
    $('#feedbackBtn').onclick = () => this.openFeedback()
    $('#qualityPick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]')
      if (!b) return
      this.store.setSetting('quality', b.dataset.v)
      this.hooks.setQuality?.(b.dataset.v)
      this.renderSettings()
    })
    $('#powerBtn').onclick = () => {
      const on = !this.store.state.settings.powerSave
      this.store.setSetting('powerSave', on)
      this.hooks.setPowerSave?.(on)
      this.renderSettings()
    }
    $('#exportBtn').onclick = () => this.exportData()
    $('#importInput').onchange = async (e) => {
      const f = e.target.files[0]
      if (!f) return
      try {
        this.store.importJSON(await f.text())
        this.toast({ icon: '入', title: '資料已匯入', sub: '原本的小島留成備份，選錯檔案的話可以在設定裡還原' })
        this.renderSync()
      } catch (err) {
        this.toast({ icon: '！', title: '匯入失敗', sub: err.message })
      }
      e.target.value = ''
    }
    $('#sampleBtn').onclick = (e) =>
      armConfirm(e.currentTarget, '再按一次清除範例', () => {
        const n = this.store.clearSamples()
        this.toast({ icon: '掃', title: `清掉了 ${n} 筆範例`, sub: '自己加的資料、經驗值和統計都還在' })
        this.renderSettings()
      })
    $('#resetBtn').onclick = (e) =>
      armConfirm(e.currentTarget, '再按一次，清空所有資料', () => {
        // 剛被告知沒辦法留備份、30 秒內又按了一次：使用者知道了，照樣清
        const force = Date.now() - (this._resetNoBackup || 0) < 30000
        const t0 = Date.now()
        try {
          if (!this.store.reset({ force })) {
            this._resetNoBackup = Date.now()
            return this.toast({ icon: '！', title: '還沒有清空', sub: '瀏覽器空間不夠，原本的小島沒辦法先留成備份，清空後就找不回來。建議先「匯出資料」；確定要清空的話，30 秒內再按一次重置', ms: 9000 })
          }
        } catch (err) {
          return this.toast({ icon: '！', title: '沒有重置', sub: err.message })
        }
        this._resetNoBackup = 0
        this.renderSync()
        const b = readBackup()
        this.toast(
          b?.from === 'reset' && b.savedAt >= t0
            ? { icon: '戻', title: '小島清空了', sub: '原本的小島留成備份，後悔的話可以在設定裡還原' }
            : { icon: '掃', title: '小島清空了', sub: '空間不夠，這次沒有留備份' },
        )
      })
  },

  // 紀錄頁最上面那一排：照頁面上看得到的標題排出來，點了跳到那一段（設定在最下面，放第一個）
  _renderRecNav() {
    const nav = $('#recNav')
    const page = nav.closest('.tab-page')
    if (!nav.dataset.bound) {
      nav.dataset.bound = '1'
      nav.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-i]')
        // 設定那格：打開設定頁
        if (b?.classList.contains('set')) return this.openSettings()
        const el = b && this._recTargets?.[+b.dataset.i]
        if (!el) return
        // 捲動區上面留了這一排的高度（--rec-pad）：標題停在它下面，不會被它蓋住
        this._recPad()
        el.scrollIntoView({ behavior: scrollMode(), block: 'start' })
      })
      // 捲動時亮起現在看的那一段
      let raf = 0
      nav.closest('.panel-body')?.addEventListener(
        'scroll',
        () => {
          if (raf || this.tab !== 'records') return
          raf = requestAnimationFrame(() => {
            raf = 0
            this._spyRecNav()
          })
        },
        { passive: true },
      )
    }
    const label = (h) => h.dataset.nav || [...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
    const heads = $$('h3.sec-title', page).filter((h) => !h.hidden && h.getClientRects().length)
    const items = heads.map((h) => [label(h), h]).filter(([t]) => t)
    const stats = $('#statsGrid')
    const at = items.findIndex(([, h]) => stats.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)
    items.splice(at < 0 ? items.length : at, 0, ['統計', stats])
    const set = items.findIndex(([t]) => t === '設定')
    if (set > 0) items.unshift(...items.splice(set, 1))
    this._recTargets = items.map(([, el]) => el)
    // 設定那格前面放一個小圖示：它是打開設定頁的捷徑，不是「現在在這裡」
    const gear = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>'
    // 段落有增減才重建（比對段落的名字，不比 HTML：亮起的那格會改 class）；沒變就留著原本的按鈕，焦點和左右捲的位置都不動
    const key = items.map(([t]) => t).join('|')
    if (key !== this._recKey || !nav.children.length) {
      this._recKey = key
      nav.innerHTML = items.map(([t], i) => `<button type="button" data-i="${i}"${t === '設定' ? ' class="set"' : ''}>${t === '設定' ? gear : ''}${esc(t)}</button>`).join('')
      this._recCur = null
    }
    this._recPad()
    this._spyRecNav()
  },
  // 跳轉列黏住時蓋到哪裡（捲動區的上內距＋它的高度；字體放大、換行時會變）：捲動區上面留這麼多再加一點（styles.css 的 --rec-pad）
  _recPad() {
    const nav = $('#recNav')
    const body = nav.closest('.panel-body')
    const h = nav.getClientRects().length ? nav.getBoundingClientRect().height : 0
    if (h && body) body.style.setProperty('--rec-pad', `${Math.ceil((parseFloat(getComputedStyle(body).paddingTop) || 0) + h) + 10}px`)
  },
  // 現在看的是哪一段：照頁面上的位置找，標題已經捲到這一排下面的最後一段（捲到底就是最下面那段）。
  // 亮起那一格，換了的話把它捲到這一排的中間
  _spyRecNav() {
    const nav = $('#recNav')
    const els = this._recTargets || []
    if (!els.length || !nav.getClientRects().length) return
    const body = nav.closest('.panel-body')
    const line = nav.getBoundingClientRect().bottom + 16
    const end = body && body.scrollTop + body.clientHeight >= body.scrollHeight - 4
    const tops = els.map((el) => el.getBoundingClientRect().top)
    let cur = -1
    tops.forEach((top, i) => {
      if ((end || top <= line) && (cur < 0 || top > tops[cur])) cur = i
    })
    if (cur < 0) cur = tops.indexOf(Math.min(...tops))
    const btns = $$('button[data-i]', nav)
    btns.forEach((b, i) => {
      b.classList.toggle('on', i === cur)
      if (i === cur) b.setAttribute('aria-current', 'location')
      else b.removeAttribute('aria-current')
    })
    if (cur === this._recCur) return
    this._recCur = cur
    const b = btns[cur]
    if (b && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2, behavior: scrollMode() })
  },

  renderRecords() {
    // 各區都畫完（小日記有沒有、訂閱開了沒）再排最上面那一排
    queueMicrotask(() => this._renderRecNav())
    this.mottos.render()
    this.life.render()
    this.subs.render()
    const s = this.store
    const st = s.stats
    const stats = [
      [st.tasksDone, '朵花綻放（累計任務）'],
      [st.focusMinutes, '分鐘專注'],
      [Math.max(st.bestStreak, s.streak), '天最長連續'],
      [st.projectsDone, '棟房子落成'],
    ]
    // 紀錄頁每次變更都會重畫：各區內容沒變就不重建（成就印章五十幾枚、圖鑑還帶縮圖）
    setHTML($('#statsGrid'), stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join(''))

    const days = Array.from({ length: 7 }, (_, i) => addDays(s.today, i - 6))
    const vals = days.map((d) => s.peekDay(d))
    const max = Math.max(4, ...vals.map((v) => v.tasks))
    setHTML($('#weekChart'), days
      .map((d, i) => {
        const v = vals[i]
        const h = (v.tasks / max) * 100
        const wd = parseDate(d).getDay()
        const mood = moodOf(s.state.journal[d]?.mood)
        return `<div class="wk ${d === s.today ? 'today' : ''}" title="${d}：任務 ${v.tasks}、番茄鐘 ${v.pomodoros}、+${v.xp} XP${mood ? '、心情 ' + mood.name : ''}">
          <span class="wk-m" style="--mc:${mood?.color || 'transparent'}">${mood?.kanji || ''}</span>
          <span class="wk-n">${v.tasks || ''}</span><div class="wk-bar ${v.tasks ? '' : 'zero'}" style="height:${Math.max(3, h * 0.72)}%"></div><span class="wk-d">${WEEK_ZH[wd]}</span></div>`
      })
      .join(''))

    this.renderSettings()
    this.renderBond()
    this.renderTown()
    this.renderDex()
    const entries = s.journalList(14)
    $('#journalTitle').hidden = !entries.length
    setHTML($('#journalList'), entries
      .map(([d, j]) => {
        const m = moodOf(j.mood)
        const dd = parseDate(d)
        // 那天在生活記錄記下的精神和心情（「心」）：跟回顧放在一起看
        const f = feelOf(s.lifeOn(d))
        // 一天記了很多則時只列最後三則、每則截短（不讓小日記一天就佔掉一大塊）；完整的在紀錄頁上面的生活記錄
        const moods = f.moods.slice(-3).map((x) => `${x.t} ${clipText(x.text, 16)}`)
        const feel = [f.energy ? `精神 ${ENERGY[f.energy]}` : '', ...(f.moods.length > 3 ? [`還有 ${f.moods.length - 3} 則`] : []), ...moods].filter(Boolean)
        const feelLine = feel.length ? `<small class="jr-feel">${esc(feel.join('・'))}</small>` : ''
        return `<li><div class="stamp-k" style="--mc:${m.color}">${m.kanji}</div><div><small>${dd.getMonth() + 1}/${dd.getDate()}（${WEEK_ZH[dd.getDay()]}）・${m.name}</small><p>${esc(j.text) || '<span style="color:var(--ink-faint)">（沒有寫字，只留下天氣）</span>'}</p>${feelLine}</div></li>`
      })
      .join(''))
    $('#reviewBtn').textContent = s.state.journal[s.today] ? '修改今天的回顧' : '寫下今天的回顧'

    const lv = s.level.level
    setHTML($('#unlockList'), UNLOCKS.map(
      (u) => `<li class="${lv >= u.level ? 'got' : ''}"><b>Lv.${u.level}</b>${u.name}<small>${lv >= u.level ? u.jp : '未解鎖'}</small></li>`,
    ).join(''))

    const got = s.player.achievements
    const n = ACHIEVEMENTS.filter((a) => got[a.id]).length
    $('#achCount').textContent = `${n} / ${ACHIEVEMENTS.length}`
    setHTML($('#achGrid'), ACHIEVEMENTS.map((a) => {
      const ok = !!got[a.id]
      return `<div class="stamp ${ok ? '' : 'locked'}" tabindex="0">
        <div class="stamp-k">${ok ? a.kanji : '？'}</div>
        <div class="stamp-n">${ok ? esc(a.title) : '？？？'}</div>
        <div class="tip"><b>${esc(a.name)}・${esc(a.title)}</b>${esc(a.desc)}${ok ? `<br><small>${new Date(got[a.id]).toLocaleDateString('zh-TW')} 取得</small>` : ''}</div>
      </div>`
    }).join(''))
  },

}
