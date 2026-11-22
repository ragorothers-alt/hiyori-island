// UI 的方法（從 ui.js 搬過來，掛回 UI.prototype）：收集和回顧：好感度、ひより町、花の図鑑、週報、上週的回顧卡、晚上的回顧
import { WEEK_JP, WEEK_ZH, TOWER_SLOTS, MOODS, moodOf, pullOf } from '../theme.js'
import { addDays, parseDate, weekKey } from '../store.js'
import { FLOWERS, RARITIES, RARITY_ORDER, flowerOf } from '../data/flowers.js'
import { BOND_LEVELS, BOND_ACTS, OUTFITS, outfitLevel, outfitOf } from '../data/bond.js'
import { LINES, FUJI_LINES } from '../data/lines.js'
import { BUILDINGS, RESIDENTS, MAX_STAGE, MOVE_IN } from '../data/town.js'
import { MAX_TOWN_LEVEL, TOWN_POINTS, lotsAt, islandRadius } from '../data/projectTown.js'
import { $, $$, esc, setHTML, pickOne, scrollMode } from './dom.js'
import { BLANK } from './shared.js'

// 回顧改到一半的草稿（沒記下來就關掉了）：{ 日子: { mood, text, at, ds } }，留最近 7 份。跟記下來的那一份一樣就不留。
// ds：是哪一份小島的（store.state.tallyGen；重置、匯入、還原備份就換一個）：別的小島寫到一半的不會跑到這一份來
const DRAFT_KEY = 'hiyori-review-draft'
export const reviewDraft = {
  all() {
    try {
      const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    } catch {
      return {}
    }
  },
  // 存不進去（瀏覽器空間滿了、不讓存）回傳 false
  save(all) {
    try {
      const keep = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 7)
      if (keep.length) localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(keep)))
      else localStorage.removeItem(DRAFT_KEY)
      return true
    } catch {
      return false
    }
  },
  same(a, b) {
    return (a?.mood || null) === (b?.mood || null) && String(a?.text || '').trim() === String(b?.text || '').trim()
  },
  // 那一天的草稿（跟記下來的一樣、或沒寫什麼就沒有）
  get(date, saved, ds = '') {
    const d = this.all()[date]
    if (!d || typeof d !== 'object' || (d.ds || '') !== ds || this.same(d, saved) || (!d.mood && !String(d.text || '').trim())) return null
    // 留草稿之後又在別的地方記下來了（總覽的今日反思、另一台同步過來的）：記下來的比較新，草稿不要了
    if (saved?.at && !(d.at > saved.at)) return null
    return { mood: typeof d.mood === 'string' ? d.mood : null, text: String(d.text || '').slice(0, 500) }
  },
  // 回傳有沒有存好（沒東西要留、拿掉了也算存好）
  put(date, v, saved, ds = '') {
    const all = this.all()
    if (this.same(v, saved) || (!v.mood && !String(v.text || '').trim())) {
      if (!(date in all)) return true
      delete all[date]
    } else all[date] = { mood: v.mood || null, text: String(v.text || '').slice(0, 500), at: Date.now(), ds }
    return this.save(all)
  },
  drop(date) {
    const all = this.all()
    if (!(date in all)) return
    delete all[date]
    this.save(all)
  },
}

export const reviewMethods = {
  // ── もち和ふじ共同的好感度 ──
  renderBond() {
    const s = this.store
    const b = s.bond
    const cur = BOND_LEVELS[b.level - 1]
    const pct = b.next ? ((b.pts - cur.need) / (b.next - cur.need)) * 100 : 100
    const nextLv = BOND_LEVELS[b.level]
    const r = nextLv?.reward
    const nextText = !nextLv ? '已經是最好的朋友了' : r?.outfit ? `Lv.${nextLv.level} 解鎖衣裝「${outfitOf(r.outfit).name}」` : `Lv.${nextLv.level} 解鎖「${BOND_ACTS[r.act].name}」`
    const acts = Object.entries(BOND_ACTS)
      .filter(([k]) => BOND_LEVELS.some((l) => l.reward?.act === k && l.level <= b.level))
      .map(([, a]) => `<span title="${esc(a.desc)}">${esc(a.name)}</span>`)
    const wardrobe = (who, current) => `<div class="outfit-row"><span class="outfit-who">${who === 'fuji' ? 'ふじ' : 'もち'}</span><div class="outfits" role="group" aria-label="${who === 'fuji' ? 'ふじ' : 'もち'}的衣裝">${OUTFITS.map((o) => {
      const lv = outfitLevel(o.key)
      const locked = lv > b.level
      return `<button class="outfit ${o.key === current ? 'on' : ''}" data-outfit="${o.key}" data-who="${who}" aria-pressed="${o.key === current}" ${locked ? `disabled aria-label="${esc(`Lv.${lv}，${o.name}（達到這個好感度就解鎖）`)}"` : ''} title="${esc(locked ? `好感度 Lv.${lv} 解鎖` : o.desc)}">${locked ? `<small>Lv.${lv}</small>` : esc(o.name)}</button>`
    }).join('')}</div></div>`
    $('#bondCount').textContent = `Lv.${b.level}`
    setHTML($('#bondBox'), `
      <div class="bond-head"><b>${esc(b.name)}</b><small>${b.next ? `${b.pts} / ${b.next}` : b.pts}</small></div>
      <div class="bond-bar"><i style="width:${pct}%"></i></div>
      <p class="bond-next">${nextText}${acts.length ? `・已學會 ${acts.join('、')}` : ''}</p>
      ${wardrobe('mochi', s.player.bond.outfit)}${wardrobe('fuji', s.player.bond.outfitFuji)}
      <p class="hint">${this.appMode ? '專注、寫回顧、清完本命、每天來看看她們，兩人都會和你更親近（回到小島還能摸摸她們）。' : '摸摸もち和ふじ、專注、寫回顧、清完本命、每天來看看她們，兩人都會和你更親近。'}</p>`)
  },

  // ── ひより町：每間店的階段、下一階還差多少、住在那裡的居民 ──
  renderTown() {
    const t = this.store.town
    $('#townCount').textContent = `${t.rank} / ${t.max}`
    const cards = BUILDINGS.map((b, i) => {
      const s = t.buildings[i]
      const res = RESIDENTS[b.resident]
      const pips = Array.from({ length: MAX_STAGE }, (_, k) => `<i class="${k < s.stage ? 'on' : ''}"></i>`).join('')
      const need = s.next == null ? 0 : s.next - s.value
      const next = s.next == null ? '已經長到最大了' : s.stage ? `再 ${need} ${b.unit} → ${b.stages[s.stage]}` : `再 ${need} ${b.unit}就會開張`
      const who = s.stage >= MOVE_IN ? `${res.name}（${res.animal}）住在這裡` : `長到 ${MOVE_IN} 階時，${res.animal}${res.name}會搬來`
      return `<button type="button" class="bld ${s.stage ? '' : 'locked'}" data-town="${b.key}" style="--bc:${res.color}" title="${esc(`${b.name}：${b.feature}越多，它長得越大`)}">
        <span class="bld-k">${b.icon}</span>
        <span class="bld-n"><b>${b.name}</b><small>${s.stage ? esc(b.stages[s.stage - 1]) : '還沒開張'}</small></span>
        <span class="bld-pips">${pips}</span>
        <span class="bld-bar"><i style="width:${Math.round(s.progress * 100)}%"></i></span>
        <small class="bld-next">${esc(next)}</small>
        <small class="bld-res">${esc(who)}</small>
      </button>`
    }).join('')
    // 專案町：等級、地的使用量、升下一級還差幾點
    const pt = this.store.projectTown
    const used = this.store.towerProjects().length
    const prev = TOWN_POINTS[pt.level - 1]
    const ptPct = pt.next == null ? 100 : Math.round(((pt.points - prev) / (pt.next - prev)) * 100)
    const ptPips = Array.from({ length: MAX_TOWN_LEVEL }, (_, k) => `<i class="${k < pt.level ? 'on' : ''}"></i>`).join('')
    const ptNext = pt.next == null ? '街道全部鋪好了' : `再 ${pt.next - pt.points} 點升到 Lv.${pt.level + 1}，多 ${lotsAt(pt.level + 1) - pt.lots} 塊地${islandRadius(pt.level + 1) > islandRadius(pt.level) ? '，小島也會變大' : ''}`
    const fly = this.appMode ? '點一下切回小島、飛過去看看' : '點一下飛過去看看'
    const ptCard = `<button type="button" class="bld ptown" data-ptown style="--bc:#e8a96f" title="每個專案在專案町蓋一棟房子；${fly}">
        <span class="bld-k">町</span>
        <span class="bld-n"><b>專案町 Lv.${pt.level}</b><small>地 ${used} / ${pt.lots}・最多 ${TOWER_SLOTS} 塊</small></span>
        <span class="bld-pips">${ptPips}</span>
        <span class="bld-bar"><i style="width:${ptPct}%"></i></span>
        <small class="bld-next">${ptNext}</small>
        <small class="bld-res">完成一個里程碑 +1 點、落成一個專案 +3 點；專案多到地不夠時，小鎮也會直接擴建</small>
      </button>`
    setHTML($('#townBox'), `
      <div class="town-head"><b>${esc(t.title)}</b><small>${t.residents.length} 位居民</small></div>
      <div class="town-grid">${ptCard}${cards}</div>
      <p class="hint">每間店綁著一個功能，用得越多就長得越大；${this.appMode ? '點卡片會切回小島、飛過去看看' : '點卡片飛過去看看'}。</p>`)
  },

  // ── 花の図鑑 ──
  renderDex() {
    const dex = this.store.state.dex
    const order = (f) => RARITY_ORDER.length - RARITY_ORDER.indexOf(f.rarity)
    const list = [...FLOWERS].sort((a, b) => order(a) - order(b))
    const thumbs = this._dexThumbs
    if (!thumbs) this._watchDex()
    const found = list.filter((f) => dex[f.key]).length
    $('#dexCount').textContent = `${found} / ${FLOWERS.length}`
    // 故事那一塊先搬回圖鑑下面（格子整個重畫時不會跟著被清掉），畫完再接回選的那一格下面
    const grid = $('#dexGrid')
    const detail = $('#dexDetail')
    if (detail.parentElement === grid) grid.after(detail)
    setHTML(grid, list
      .map((f) => {
        const got = dex[f.key]
        return `<button class="dex-cell ${got ? '' : 'unknown'} ${this.dexSel === f.key ? 'on' : ''}" aria-pressed="${this.dexSel === f.key}" data-k="${f.key}" style="--rc:${RARITIES[f.rarity].color}">
          <img src="${thumbs?.[f.key] || BLANK}" alt="" draggable="false" /><span>${got ? esc(f.name) : '？？？'}</span></button>`
      })
      .join(''))
    this._renderDexDetail()
  },
  // 花的縮圖要用 three.js 拍：捲到圖鑑時才載入（App 模式只是來改設定的話，不用下載小島的程式）
  _watchDex() {
    if (this._dexWatch) return
    const watch = (this._dexWatch = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      watch.disconnect()
      import('../scene/garden.js')
        .then(({ renderFlowerThumbs }) => {
          this._dexThumbs = renderFlowerThumbs(FLOWERS.map((f) => f.key))
          this.renderDex()
        })
        .catch((err) => {
          console.warn('[hiyori] 花的縮圖載入失敗', err)
          // 下次畫圖鑑時再試
          this._dexWatch = null
        })
    }))
    watch.observe($('#dexGrid'))
  },

  // 選了一朵花：故事接在那一格所在那一列的下面（獨佔一列，後面的花補滿那一列，見 life.css），
  // 不用捲到整個圖鑑的最下面才看得到
  _placeDexDetail() {
    const grid = $('#dexGrid')
    const detail = $('#dexDetail')
    const cell = this.dexSel && grid.querySelector(`.dex-cell[data-k="${CSS.escape(this.dexSel)}"]`)
    if (cell) {
      if (cell.nextElementSibling !== detail) cell.after(detail)
    } else if (detail.parentElement === grid) grid.after(detail)
    return cell ? detail : null
  },

  _renderDexDetail() {
    const f = flowerOf(this.dexSel)
    this._placeDexDetail()
    if (!f) return
    const got = this.store.state.dex[f.key]
    const r = RARITIES[f.rarity]
    const tag = `<i class="rarity" style="--rc:${r.color}">${r.label}</i>`
    if (!got) {
      $('#dexDetail').innerHTML = `<b>？？？</b>${tag}<p>線索：${esc(f.hint)}</p>`
      return
    }
    const d = parseDate(got.at)
    $('#dexDetail').innerHTML = `<b>${esc(f.name)}</b><small>${esc(f.jp)}</small>${tag}<p>${esc(f.desc)}</p><small>${d.getMonth() + 1}/${d.getDate()} 第一次開花・開過 ${got.n} 朵</small>`
  },

  _bindDex() {
    $('#dexGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]')
      if (!b) return
      this.dexSel = b.dataset.k
      pickOne($$('#dexGrid .dex-cell'), (x) => x === b)
      this._renderDexDetail()
      $('#dexDetail').scrollIntoView({ block: 'nearest', behavior: scrollMode() })
    })
  },

  // 週報（教練分頁的第二頁）：一週的事都從這裡看，上週的回顧卡、每週的記憶圖鑑也在裡面。總覽、紀錄頁的「看週報」都到這裡
  openReport() {
    this.setTab('coach')
    this._use(this._coach, (c) => c.show('report'))
  },
  // ── 上週回顧卡 ──
  // wk：哪一週（星期一）；不給就是上週。週報的記憶圖鑑點卡片時會帶週次
  openWeekCard(wk) {
    const s = this.store
    const lastWk = addDays(weekKey(s.today), -7)
    this.weekOpen = wk || lastWk
    const w = s.weekSummary(this.weekOpen)
    const cur = this.weekOpen === weekKey(s.today)
    $('#weekModal .modal-kicker').textContent = cur ? '今週のふりかえり' : this.weekOpen === lastWk ? '先週のふりかえり' : 'ふりかえり'
    $('#weekClose').textContent = this.weekOpen === lastWk ? '收下，開始新的一週' : '收好'
    const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`
    $('#weekRange').textContent = `${md(w.week)} – ${md(w.end)}`
    $('#weekMoods').innerHTML = w.days
      .map((d, i) => {
        const m = moodOf(w.moods[i])
        return `<div class="wm ${m ? '' : 'none'}" style="--mc:${m?.color || 'transparent'}"><span class="stamp-k">${m?.kanji || '・'}</span><small>${WEEK_ZH[parseDate(d).getDay()]}</small></div>`
      })
      .join('')
    const stats = [
      [w.tasks, '朵花綻放'],
      [w.focus, '分鐘專注'],
      [w.stars, '件本命完成'],
      [w.activeDays, '天有前進'],
    ]
    $('#weekStats').innerHTML = stats.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')
    const notes = []
    if (w.best) notes.push(`最充實的一天：${md(w.best.date)}（${WEEK_ZH[parseDate(w.best.date).getDay()]}），開了 ${w.best.tasks} 朵花`)
    if (w.perfectDays) notes.push(`完美的一天 ${w.perfectDays} 次`)
    if (w.flowers.length) notes.push(`圖鑑新朋友：${w.flowers.slice(0, 4).map((f) => esc(f.name)).join('、')}${w.flowers.length > 4 ? ` 等 ${w.flowers.length} 種` : ''}`)
    if (w.challenge) notes.push(`每週挑戰「${esc(w.challenge.title)}」：${w.challenge.value >= w.challenge.goal ? '達成 ✓' : `${w.challenge.value} / ${w.challenge.goal}`}`)
    // 這週把自己拉回來幾次：想分心時忍住的、限時去之後回來的、警語提醒之後回到正事的（本來就在做的不算「拉回來」，
    // 跟今日反思的「今天的回神」一樣）；最常想去做什麼
    const r = s.weekReport(this.weekOpen)
    const backs = Math.min(r.nudges, r.backs)
    const returns = r.returns || 0
    if (r.holds + returns + backs) {
      const top = Object.entries(r.pulls).sort((a, b) => b[1] - a[1])[0]
      const most = top && pullOf(top[0])
      const parts = [r.holds ? `忍住分心 ${r.holds} 次` : '', returns ? `去一下就回來 ${returns} 次` : '', backs ? `警語提醒時回到正事 ${backs} 次` : ''].filter(Boolean).join('、')
      notes.push(`把自己拉回來 ${r.holds + returns + backs} 次（${parts}）${most ? `・最常想去${esc(most.label)}` : ''}`)
    }
    $('#weekNotes').innerHTML = notes.map((n) => `<li>${n}</li>`).join('')
    // 回顧卡上的一句話，もち和ふじ輪流說
    const fuji = Math.random() < 0.5
    const pool = (fuji ? FUJI_LINES : LINES).weekCard?.[w.tier] || []
    $('#weekMochi').textContent = pool.length ? `${fuji ? 'ふじ' : 'もち'}：「${pool[Math.floor(Math.random() * pool.length)]}」` : ''
    $('#weekModal').hidden = false
  },

  closeWeekCard() {
    if ($('#weekModal').hidden) return
    $('#weekModal').hidden = true
    // 只有上週那張算「看過了」（每週一自動跳出的那張）
    if (this.weekOpen === addDays(weekKey(this.store.today), -7)) {
      this.store.seenWeekCard()
      // 總覽上那張上週的回顧卡跟著收起來
      this.dropToasts('week')
      if (this.tab === 'today') this.today.render()
    }
    this.hooks.modalClosed?.()
  },

  // 新的一週、上週有在用：總覽上放一張上週的回顧卡（不再自己跳成對話框），main.js 再說一則提示。
  // 現在能說嗎：別的視窗開著、正在快速記錄時先不說
  weekDue() {
    return this.store.weekCardDue() && $('#levelModal').hidden && $('#reviewModal').hidden && $('#weekModal').hidden && !this.capture?.isOpen
  },

  // ── 晚間回顧 ──
  _bindReview() {
    $('#moodPick').innerHTML = MOODS.map(
      (m) => `<button type="button" class="mood" data-mood="${m.key}" style="--mc:${m.color}" title="${m.desc}"><div class="stamp-k">${m.kanji}</div><span>${m.name}</span></button>`,
    ).join('')
    $('#moodPick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mood]')
      if (!b) return
      this.mood = b.dataset.mood
      pickOne($$('#moodPick .mood'), (x) => x === b)
      $('#reviewSave').disabled = false
    })
    $('#reviewForm').addEventListener('submit', (e) => {
      e.preventDefault()
      if (!this.mood) return
      this.store.saveReview(this.reviewDate, this.mood, $('#reviewText').value)
      reviewDraft.drop(this.reviewDate)
      this.closeReview({ keep: false })
      // 今天的回顧記下了：接著問明天先做哪一件（補記別天的不問）
      if (this.reviewDate === this.store.today) this.askFirst()
    })
    // 跟以前的一行輸入框一樣 Enter 就記下來；要換行按 Shift＋Enter
    $('#reviewText').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return
      e.preventDefault()
      $('#reviewForm').requestSubmit()
    })
    $('#reviewLater').onclick = () => {
      if (!this.closeReview()) return
      try {
        localStorage.setItem('hiyori-review-later', this.store.today)
      } catch {}
    }
    $('#reviewModal').addEventListener('click', (e) => {
      if (e.target.id === 'reviewModal') $('#reviewLater').click()
    })
    // 改到一半的：捨棄，換回記下來的那一份
    $('#reviewDiscard').onclick = () => {
      reviewDraft.drop(this.reviewDate)
      this._fillReview(this.store.state.journal[this.reviewDate] || null)
      this._reviewWas = this._reviewNow()
      $('#reviewText').focus()
    }
    $('#reviewBtn').onclick = () => this.openReview()
  },

  openReview(date = this.store.today) {
    const s = this.store
    this.reviewDate = date
    const prev = s.state.journal[date]
    const d = parseDate(date)
    $('#reviewDate').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日・${WEEK_JP[d.getDay()]}`
    const day = s.peekDay(date)
    const tasks = s.tasksOn(date)
    const ev = s.eventsOn(date)
    $('#reviewSum').innerHTML = `<span><b>${tasks.filter((t) => t.done).length}</b>/ ${tasks.length} 朵花綻放</span><span><b>${day.focus}</b>分鐘專注</span><span><b>${ev.filter((e) => e.done).length}</b>個日程完成</span>`
    $('#reviewSave').textContent = prev ? '更新' : '記下來'
    // 上次改到一半、沒記下來就關掉了（點外面、之後再說、Esc）：放回去，可以捨棄
    this._fillReview(prev || null, reviewDraft.get(date, prev, s.state.tallyGen))
    // 打開時的樣子：關掉時沒動過就不碰草稿（另一個分頁剛留的草稿不會被這邊的空白蓋掉）
    this._reviewWas = this._reviewNow()
    this._reviewWarned = false
    $('#reviewModal').hidden = false
    this.hooks.reviewOpened?.()
  },
  // 回顧的天氣和那幾句話：draft 是改到一半的（有的話蓋過記下來的那一份）
  _fillReview(prev, draft = null) {
    const v = draft || prev
    this.mood = v?.mood || null
    pickOne($$('#moodPick .mood'), (x) => x.dataset.mood === this.mood)
    $('#reviewText').value = v?.text || ''
    $('#reviewSave').disabled = !this.mood
    $('#reviewDraft').hidden = !draft
  },

  // keep：沒記下來就關掉的，改到一半的留成草稿（照日期分開；記下來、捨棄了才拿掉）
  // 存不下草稿（瀏覽器空間滿了）就先不關，說一聲（關掉了寫的字就不見了）
  closeReview({ keep = true } = {}) {
    if (keep && !$('#reviewModal').hidden && this.reviewDate) {
      const now = this._reviewNow()
      const s = this.store
      // 說過一次了（使用者已經知道、還是要關）：直接關，這次改的不留
      if (!this._reviewWarned && !reviewDraft.same(now, this._reviewWas) && !reviewDraft.put(this.reviewDate, now, s.state.journal[this.reviewDate], s.state.tallyGen)) {
        this._reviewWarned = true
        this.toast({ icon: '記', title: '改到一半的字存不下來', sub: '瀏覽器的空間可能滿了：先按「記下來」，或把字複製起來；再關一次就直接關（這次改的不留）', ms: 9000 })
        return false
      }
    }
    $('#reviewModal').hidden = true
    return true
  },
  _reviewNow() {
    return { mood: this.mood, text: $('#reviewText').value }
  },

  // 總覽上的「收起來」：這週不再放，提示卡一起收
  weekSeen() {
    this.store.seenWeekCard()
    this.dropToasts('week')
    if (this.tab === 'today') this.today.render()
  },
  // 晚上 9 點後、今天還沒寫、也沒按「之後再說」：總覽把今日反思移到最上面（不再自己跳成對話框），main.js 再說一則提示
  reviewEve() {
    const s = this.store
    if (new Date().getHours() < 21 || s.state.journal[s.today]) return false
    let later = null
    try {
      later = localStorage.getItem('hiyori-review-later')
    } catch {}
    return later !== s.today
  },
  // 現在能說嗎：回顧、升級的視窗開著、正在快速記錄時先不說；今日摘要先說（還開著、或今天還沒說過），下一分鐘再看
  reviewDue() {
    if (!this.reviewEve() || !$('#reviewModal').hidden || !$('#levelModal').hidden || this.capture?.isOpen) return false
    return !(this.brief.open || this.maybeShowBrief())
  },
  // 每分鐘：晚上回顧該不該排到最上面換了（過了 9 點、跨了日）就重畫總覽
  tickEve() {
    const eve = this.reviewEve()
    if (eve === this._eve) return
    this._eve = eve
    if (this.tab === 'today') this.today.render()
  },
  // day：問的是哪一天（提示卡留到過了午夜才按的，記在那一天，不會跳過新的一天）
  reviewLater(day = this.store.today) {
    try {
      localStorage.setItem('hiyori-review-later', day)
    } catch {}
    this.dropToasts('review')
    if (this.tab === 'today') this.today.render()
  },
  // 提示卡上的「寫回顧」：App 模式到總覽，焦點放在今日反思的天氣上；小島模式打開回顧的視窗
  goReview() {
    if (!this.appMode) return this.openReview()
    this.setTab('today')
    requestAnimationFrame(() => {
      const card = $('#todayRoot .td-ref')
      card?.scrollIntoView({ block: 'start', behavior: scrollMode() })
      ;($('.td-mood.on', card) || $('.td-mood', card))?.focus({ preventScroll: true })
    })
  },

}
