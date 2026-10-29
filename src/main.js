import './styles.css'
import * as THREE from 'three'
import { Store, toMin, minToHHMM, repeatLabel, daysBetween } from './store.js'
import { UI } from './ui.js'
import { World } from './scene/world.js'
import { Sky } from './scene/sky.js'
import { Island, LAYOUT } from './scene/island.js'
import { SEASONS, seasonOf } from './scene/season.js'
import { Decor } from './scene/decor.js'
import { Garden } from './scene/garden.js'
import { Towers } from './scene/towers.js'
import { TimeRing } from './scene/timeRing.js'
import { Character } from './scene/character.js'
import { Duo } from './scene/duo.js'
import { preloadCats, buildCat } from './scene/models/cats.js'
import { Particles } from './scene/particles.js'
import { Labels } from './scene/labels.js'
import { Placed, spotFree, radiusOf } from './scene/placed.js'
import { Cabin } from './scene/cabin.js'
import { Room } from './scene/room.js'
import { SHOP_ITEMS } from './data/shop.js'
import { sfx } from './audio.js'
import { Reminders, systemNotify } from './reminders.js'
import { FileSync } from './sync.js'
import { LINES, FUJI_LINES, DUETS } from './data/lines.js'
import { UNLOCKS, tagOf, PRIORITIES, PROJECT_COLORS, EVENT_COLORS, XP, MAX_STARS, SOFT_CAP } from './theme.js'
import { RARITIES } from './data/flowers.js'
import { BOND_ACTS, actLevel, outfitOf } from './data/bond.js'

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const short = (s, n = 9) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
// who：'mochi' 或 'fuji'，各自用自己的台詞
function line(key, vars = {}, who = 'mochi') {
  const src = who === 'fuji' ? FUJI_LINES : LINES
  // 'greet.morning'、'season.spring' 這種有點的鍵，往下一層找
  const list = key.split('.').reduce((o, k) => o?.[k], src)
  if (!list?.length) return ''
  return fill(pick(list), vars)
}
function greetKey() {
  const h = new Date().getHours()
  return h >= 5 && h < 11 ? 'greet.morning' : h >= 11 && h < 17 ? 'greet.noon' : h >= 17 && h < 21 ? 'greet.evening' : 'greet.night'
}

async function boot() {
  // 兩位主角的模型和字型一起載
  const catsReady = preloadCats()
  // 等字型載入，3D 刻度文字才會用對字體（最多等 2.5 秒）
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2500))])
  const params = new URLSearchParams(location.search)

  const store = new Store()
  const world = new World(document.getElementById('scene'))
  const sky = new Sky(world)
  if (params.has('hour')) sky.hourOverride = parseFloat(params.get('hour'))
  const island = new Island(world)
  const decor = new Decor(world, sky)
  const garden = new Garden(world, sky)
  const towers = new Towers(world, sky)
  const ring = new TimeRing(world, sky)
  const labels = new Labels(world)
  const cabin = new Cabin(world, sky)
  const room = new Room(world, sky)
  // ── もち和ふじ ──
  const homeAt = (p) => new THREE.Vector3(p.x, 0, p.z)
  await catsReady
  const mochi = new Character(world, labels, sky, { id: 'mochi', name: 'もち', build: () => buildCat('mochi'), home: homeAt(LAYOUT.home), seat: 0, study: 'read' })
  const fuji = new Character(world, labels, sky, { id: 'fuji', name: 'ふじ', build: () => buildCat('fuji'), home: homeAt(LAYOUT.home2), seat: 1, study: 'write' })
  const cast = { mochi, fuji }
  const duo = new Duo(world, labels, { list: [mochi, fuji], cabin, room })
  // 誰來說：花圃與慶祝交給もち，時間、日程、提醒與照顧步調交給ふじ，其他兩人輪流
  const FUJI_KEYS = new Set(['reviewAsk', 'reviewDone', 'reschedule', 'reminder', 'eventDone', 'deadlineNear', 'onTime', 'routine', 'overdue', 'wilt', 'planAsk', 'starPick', 'starFull', 'questDone', 'weeklyReady', 'weeklyClaimed', 'charmBuy', 'charmUsed', 'breakEnd', 'tired', 'gift'])
  const MOCHI_KEYS = new Set(['shopBuy', 'shopPlace', 'shopPoor', 'taskDone', 'highTaskDone', 'starDone', 'starAll', 'newFlower', 'rareFlower', 'water', 'revive', 'milestone'])
  const voice = (key) => (FUJI_KEYS.has(key) ? fuji : MOCHI_KEYS.has(key) ? mochi : pick([mochi, fuji]))
  const talk = (key, vars = {}, ms, fallback = '', who = voice(key)) => {
    who.say(line(key, vars, who.id) || fallback, ms)
    return who
  }
  // 兩人你一句我一句；pet 的對話用 self／other 代表被摸的那位和另一位
  const duet = (key, vars = {}, self = mochi) => {
    const list = DUETS?.[key]
    if (!list?.length) return false
    const other = self === mochi ? fuji : mochi
    duo.duet(pick(list).map(([who, text]) => [who === 'self' ? self.id : who === 'other' ? other.id : who, fill(text, vars)]))
    return true
  }
  const fx = new Particles(world, sky)
  const placed = new Placed(world, sky)
  sfx.setEnabled(store.state.settings.sound)
  world.powerSave = store.state.settings.powerSave
  decor.sync(store.level.level)

  // ── 四季 ──
  let season = null
  const applySeason = () => {
    const next = SEASONS[params.get('season')] ? params.get('season') : seasonOf(store.today)
    if (next === season) return
    season = next
    island.setSeason(season)
    decor.setSeason(season)
    fx.setSeason(season)
    for (const c of duo.list) c.setSeason(season)
    const el = document.getElementById('dateSeason')
    el.textContent = `${SEASONS[season].name} · ${SEASONS[season].jp}`
    el.dataset.season = season
  }
  applySeason()
  store.on('dateChanged', applySeason)
  // App 開著跨到新的一週：等一下再給回顧卡
  store.on('dateChanged', () => setTimeout(() => ui.maybeShowWeekCard(), 3000))

  // ── 浮動經驗值 ──
  const floatText = (pos, text, big = false, coins = 0) => {
    if (!pos) return
    const el = document.createElement('div')
    el.className = 'floaty' + (big ? ' big' : '')
    el.textContent = text
    if (coins) {
      const c = document.createElement('small')
      c.innerHTML = `<i class="konpeito"></i>+${coins}`
      el.append(c)
    }
    const p = pos.clone()
    labels.flash(el, () => p, 1700)
  }

  // ── 專案名牌 & 日程提示 ──
  const chips = new Map()
  function syncChips() {
    const active = store.activeProjects()
    const ids = new Set(active.map((p) => p.id))
    for (const [id, c] of chips) {
      if (!ids.has(id)) {
        labels.remove(c)
        chips.delete(id)
      }
    }
    for (const p of active) {
      let c = chips.get(p.id)
      if (!c) {
        const el = document.createElement('div')
        el.className = 'proj-chip'
        c = labels.add(el, () => towers.labelAnchor(p.id))
        chips.set(p.id, c)
      }
      const pct = Math.round(store.progress(p) * 100)
      c.el.style.setProperty('--c', PROJECT_COLORS[p.color % PROJECT_COLORS.length])
      const days = p.deadline && !p.completedAt ? daysBetween(store.today, p.deadline) : null
      const due = days === null || days > 2 ? '' : days < 0 ? '<i class="due late">逾期</i>' : `<i class="due">${days ? `剩 ${days} 天` : '今天截止'}</i>`
      c.el.innerHTML = `${esc(short(p.name, 10))} <b>${pct === 100 ? (p.onTime ? '準時落成' : '落成') : pct + '%'}</b>${due}`
    }
  }

  let nextChip = null
  function syncNextEvent() {
    if (nextChip) labels.remove(nextChip)
    nextChip = null
    if (store.selectedDate !== store.today) return
    const now = new Date().getHours() * 60 + new Date().getMinutes()
    const evs = store.eventsOn(store.today).filter((e) => !e.done && toMin(e.end) > now)
    const e = evs[0]
    if (!e) return
    const cur = toMin(e.start) <= now
    const el = document.createElement('div')
    el.className = 'proj-chip'
    el.style.setProperty('--c', EVENT_COLORS[e.color % EVENT_COLORS.length])
    el.innerHTML = `${cur ? '進行中' : '下一個'}・${esc(short(e.title, 10))} <b>${e.start}</b>`
    nextChip = labels.add(el, () => ring.anchor(e.id))
  }

  // ── 場景同步 ──
  function syncScene(animate = true) {
    garden.sync(store.gardenTasks(store.selectedDate), store.selectedDate, store.today)
    const built = towers.sync(store.activeProjects(), (p) => store.progress(p), animate, store.today)
    for (const b of built) {
      const p = store.state.projects.find((x) => x.id === b.id)
      const color = PROJECT_COLORS[(p?.color ?? 0) % PROJECT_COLORS.length]
      b.positions.forEach((pos, i) =>
        setTimeout(() => {
          fx.burst(pos, { colors: ['#ffffff', color, '#fff2d6'], count: 34, speed: 1.8, up: 1.2, gravity: -2, size: 0.2 })
        }, 300 + i * 250),
      )
      const base = towers.anchor(b.id, false)
      if (base) fx.ripple(base, color, 2.4)
    }
    ring.sync(store.eventsOn(store.selectedDate), store.selectedDate === store.today)
    syncChips()
    syncNextEvent()
  }

  // ── 擺放裝飾 ──
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const placeBar = document.getElementById('placeBar')
  let placing = null // { key, moveId?, rot, x, z, ok }
  let itemMenu = null
  const closeItemMenu = () => {
    if (itemMenu) labels.remove(itemMenu)
    itemMenu = null
  }
  const stopPlacing = () => {
    if (!placing) return
    placed.endGhost()
    placed.hiddenId = null
    placing = null
    placeBar.hidden = true
    placed.sync(store.state.placed)
  }
  const startPlacing = (key, moveId = null) => {
    stopPlacing()
    closeItemMenu()
    const item = SHOP_ITEMS.find((i) => i.key === key)
    if (!item) return
    const from = moveId && store.state.placed.find((p) => p.id === moveId)
    // 擺設要看著小島放
    if (room.active) world.setStage(null)
    placing = { key, moveId, rot: from?.rot ?? 0, ok: false }
    placed.startGhost(key, placing.rot)
    if (from) {
      placed.hiddenId = moveId
      placed.sync(store.state.placed)
    }
    document.getElementById('placeName').textContent = moveId ? `移動「${item.name}」：點島上的空地` : `擺放「${item.name}」：點島上的空地`
    placeBar.hidden = false
    if (!moveId) talk('shopBuy', { item: item.name }, undefined, `${item.name}，要放哪裡呢？`)
  }
  const aimAt = (ray) => {
    const p = ray.intersectPlane(ground, new THREE.Vector3())
    if (!p) return null
    const ok = spotFree(p.x, p.z, store.state.placed, placing.moveId, placing.key, decor.footprints())
    placing.x = p.x
    placing.z = p.z
    placing.ok = ok
    placed.moveGhost(p.x, p.z, ok)
    return p
  }
  world.onPointerMove = (ray) => {
    if (placing) aimAt(ray)
  }
  world.onClick = (ray) => {
    if (!placing) return false
    if (!aimAt(ray) || !placing.ok) {
      sfx.undo()
      return true
    }
    const { key, moveId, x, z, rot } = placing
    stopPlacing()
    if (moveId) store.moveItem(moveId, x, z, rot)
    else store.placeItem(key, x, z, rot)
    return true
  }
  document.getElementById('placeRotate').onclick = () => {
    if (placing) placing.rot = placed.rotateGhost()
  }
  document.getElementById('placeCancel').onclick = () => stopPlacing()
  addEventListener('keydown', (e) => {
    if (!placing || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return
    if (e.key === 'Escape') stopPlacing()
    if (e.key === 'r' || e.key === 'R') placing.rot = placed.rotateGhost()
  })
  const openItemMenu = (id) => {
    closeItemMenu()
    const p = store.state.placed.find((x) => x.id === id)
    const item = p && SHOP_ITEMS.find((i) => i.key === p.key)
    if (!item) return
    const el = document.createElement('div')
    el.className = 'item-menu'
    el.innerHTML = `<button data-a="move">移動</button><button data-a="store">收起 +${Math.floor(item.price / 2)}</button><button data-a="close">×</button>`
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a
      if (a === 'move') startPlacing(p.key, p.id)
      else if (a === 'store') {
        closeItemMenu()
        store.storeItem(p.id)
      } else closeItemMenu()
    })
    itemMenu = labels.add(el, () => placed.anchor(id))
  }

  // ── UI 掛鉤 ──
  const hooks = {
    startPlacing: (key) => startPlacing(key),
    hoverTask: (id) => garden.highlight(id),
    hoverEvent: (id) => ring.highlight(id),
    hoverProject: (id) => {
      for (const [pid, c] of chips) c.el.style.transform = pid === id ? 'translate(-50%, -100%) scale(1.15)' : ''
    },
    focusTask: (id) => {
      const p = garden.anchor(id)
      if (p) world.flyTo(p, 8.5)
      garden.bounce(id)
    },
    focusEvent: (id) => {
      const p = ring.anchor(id)
      if (p) world.flyTo(p, 12, { elevation: 0.5 })
      ring.pulse(id)
    },
    focusProject: (id) => {
      const p = towers.anchor(id, false)
      if (p) world.flyTo(p.add(new THREE.Vector3(0, 1.4, 0)), 10)
    },
    resetView: () => (room.active ? room.exit() : world.home()),
    reviewOpened: () => talk('reviewAsk', {}, 4200, '今天過得怎麼樣？'),
    modalClosed: () => !room.active && world.home(1.6),
    setSound: (on) => sfx.setEnabled(on),
    setPowerSave: (on) => (world.powerSave = on),
    focusStarted: (resumed, taskId) => {
      duo.setFocus(true, resumed)
      garden.setFocus(taskId)
      if (!resumed) {
        sfx.chime()
        const t = taskId && store.state.tasks.find((x) => x.id === taskId)
        if (t) talk('focusTask', { task: short(t.title) })
        else if (!duet('focusStart')) talk('focusStart')
      }
    },
    focusTaskChanged: (taskId) => {
      if (duo.focusing) garden.setFocus(taskId)
      const t = taskId && store.state.tasks.find((x) => x.id === taskId)
      if (t) {
        garden.bounce(t.id)
        if (duo.focusing) talk('focusTask', { task: short(t.title) })
      }
    },
    focusFinished: (minutes, taskId) => {
      duo.setFocus(false)
      garden.setFocus(null)
      sfx.temple()
      // 天燈從小木屋屋頂升起（兩人還在屋裡）；出來後兩人會擊掌慶祝
      fx.skyLantern(duo.inside ? cabin.point('roofTop') : mochi.position.clone().add(new THREE.Vector3(0, 1.6, 0)))
      store.completePomodoro(minutes, taskId)
      if (!duet('focusEnd')) talk('focusEnd')
      const t = taskId && store.state.tasks.find((x) => x.id === taskId)
      if (t) {
        const pos = garden.anchor(t.id)
        if (pos) fx.burst(pos, { colors: ['#fff1b8', '#ffd98a', '#ffffff'], count: 36, speed: 1.4 })
        garden.bounce(t.id)
      }
      ui.toast({ icon: '灯', title: '專注完成，放一盞天燈', sub: t ? `「${short(t.title, 10)}」長大了一點・休息一下吧` : `+${minutes} 分鐘・接著休息一下吧` })
    },
    breakFinished: () => {
      sfx.chime()
      talk('breakEnd')
      ui.toast({ icon: '風', title: '休息結束', sub: '準備好了就再開始一輪吧' })
    },
    focusStopped: () => {
      duo.setFocus(false)
      garden.setFocus(null)
      fuji.say('沒關係，下次再一起專注。')
    },
  }
  const ui = new UI(store, hooks)

  // 小島置中在面板以外的區域
  const panel = document.getElementById('panel')
  const wide = () => innerWidth > 860
  const panelShift = (collapsed) => wide()
    ? { x: collapsed ? 0 : (panel.offsetWidth + 20) / 2, y: 0 }
    : { x: 0, y: collapsed ? 30 : innerHeight * 0.25 - 36 }
  const updateShift = () => {
    const { x, y } = panelShift(panel.classList.contains('collapsed'))
    world.setViewShift(x, y)
  }
  // 星之大樹放在預設視角（面板展開時）看得到的右上角：日期列下方、面板左側；
  // 雲鯨的弧線也依同一個可見範圍決定高度
  const placeSky = () => {
    const cam = world.homeCamera(panelShift(false))
    const right = (wide() ? innerWidth - panel.offsetWidth - 20 : innerWidth) - 14
    const top = document.querySelector('.datebar').getBoundingClientRect().bottom + 14
    decor.placeSky(cam, { right, top })
    const bottom = wide() ? innerHeight : innerHeight - panel.offsetHeight - 60
    decor.placeWhale(cam, { left: 0, right: right + 14, top, bottom })
    // 小木屋室內的取景：可見範圍（手機扣掉上方日期列）佔整個畫面的比例，以及它的中心離畫面中心（含面板偏移）多遠
    const { x, y } = panelShift(false)
    const roomTop = wide() ? 0 : top - 8
    room.area = {
      w: (right + 14) / innerWidth,
      h: (bottom - roomTop) / innerHeight,
      dx: (right + 14) / 2 - (innerWidth / 2 - x),
      dy: (roomTop + bottom) / 2 - (innerHeight / 2 - y),
    }
  }
  new MutationObserver(updateShift).observe(panel, { attributes: true, attributeFilter: ['class'] })
  addEventListener('resize', updateShift)
  addEventListener('resize', placeSky)
  updateShift()
  placeSky()
  world.shift = { ...world.shiftTarget }
  world._applyShift()

  // ── 3D 互動 ──
  const tip = document.createElement('div')
  tip.className = 'tooltip3d'
  tip.style.position = 'fixed'
  tip.style.zIndex = 6
  tip.style.pointerEvents = 'none'
  tip.style.display = 'none'
  document.body.append(tip)

  world.onHover = (p, hit, ev) => {
    hoverCursor(p, hit)
    garden.highlight(p?.type === 'task' ? p.id : null)
    ring.highlight(p?.type === 'event' ? p.id : null)
    ui.highlight(p?.type, p?.id)
    if (!p || !ev) {
      tip.style.display = 'none'
      return
    }
    let html = ''
    if (p.type === 'task') {
      const t = store.state.tasks.find((x) => x.id === p.id)
      if (t) html = `${esc(t.title)}<small>${PRIORITIES[t.priority].label}優先・${tagOf(t.tag).label}・${t.done ? '已綻放' : '花苞'}</small>`
    } else if (p.type === 'event') {
      const e = store.state.events.find((x) => x.id === p.id)
      if (e) html = `${esc(e.title)}<small>${e.start} 〜 ${e.end}${e.done ? '・已完成' : ''}</small>`
    } else if (p.type === 'project') {
      const pr = store.state.projects.find((x) => x.id === p.id)
      if (pr) html = `${esc(pr.name)}<small>${Math.round(store.progress(pr) * 100)}%・${pr.milestones.filter((m) => m.done).length}/${pr.milestones.length} 層</small>`
    } else if (p.type === 'char') html = `${cast[p.id].name}<small>點一下摸摸她</small>`
    else if (p.type === 'cabin') html = `もち和ふじ的小木屋<small>${duo.inside ? '兩人正在屋裡陪你專注・點一下進屋看看' : '專注時兩人會回到這裡'}</small>`
    else if (p.type === 'placed') {
      const it = SHOP_ITEMS.find((i) => i.key === store.state.placed.find((x) => x.id === p.id)?.key)
      if (it) html = `${esc(it.name)}<small>點一下移動或收起</small>`
    }
    if (!html) return
    tip.innerHTML = html
    tip.style.display = ''
    tip.style.left = ev.clientX + 'px'
    tip.style.top = ev.clientY + 'px'
  }

  // ── 在時之環上拖曳日程 ──
  const dragTip = document.createElement('div')
  dragTip.className = 'tooltip3d drag-tip'
  Object.assign(dragTip.style, { position: 'fixed', zIndex: 7, pointerEvents: 'none', display: 'none' })
  document.body.append(dragTip)
  let drag = null
  const snapMin = (m, e) => {
    const step = e.shiftKey ? 5 : 15
    return Math.round(m / step) * step
  }
  world.dragHandler = {
    start(hit, e) {
      if (hit.pick.type !== 'event') return false
      const a = ring.arc(hit.pick.id)
      if (!a) return false
      const y = a.mesh.position.y + 0.1
      const m = ring.minutesOnRay(world.raycaster.ray, y)
      if (m == null) return false
      drag = { id: a.e.id, a, y, mode: ring.dragMode(a.e.id, m), from: m, last: m, acc: m, m0: a.m0, m1: a.m1, x: e.clientX, yPx: e.clientY, moved: false }
      ring.highlight(a.e.id)
      return true
    },
    move(ray, e) {
      if (!drag) return
      const m = ring.minutesOnRay(ray, drag.y)
      if (m == null) return
      // 跨過 0 點時用最短角度差累積，避免跳一整圈
      let d = m - drag.last
      if (d > 720) d -= 1440
      if (d < -720) d += 1440
      drag.last = m
      drag.acc += d
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.yPx) > 5) drag.moved = true
      if (!drag.moved) return
      const len = drag.a.m1 - drag.a.m0
      let m0 = drag.a.m0
      let m1 = drag.a.m1
      if (drag.mode === 'move') {
        m0 = Math.min(Math.max(0, snapMin(drag.a.m0 + drag.acc - drag.from, e)), 1440 - len)
        m1 = m0 + len
      } else if (drag.mode === 'start') {
        m0 = Math.min(Math.max(0, snapMin(drag.acc, e)), drag.a.m1 - 15)
      } else {
        m1 = Math.max(Math.min(1439, snapMin(drag.acc, e)), drag.a.m0 + 15)
      }
      if (m0 !== drag.m0 || m1 !== drag.m1) {
        drag.m0 = m0
        drag.m1 = m1
        ring.previewArc(drag.id, m0, m1)
        sfx.pop()
      }
      dragTip.style.display = ''
      dragTip.style.left = e.clientX + 'px'
      dragTip.style.top = e.clientY - 28 + 'px'
      dragTip.innerHTML = `${esc(short(drag.a.e.title, 12))}<small>${minToHHMM(m0)} – ${minToHHMM(Math.min(m1, 1439))}</small>`
    },
    end() {
      dragTip.style.display = 'none'
      if (!drag) return
      const d = drag
      drag = null
      ring.highlight(null)
      if (!d.moved) {
        world.onPick({ type: 'event', id: d.id })
        return
      }
      if (d.m0 === d.a.m0 && d.m1 === d.a.m1) return
      const ev = store.state.events.find((x) => x.id === d.id)
      store.updateEvent(d.id, { start: minToHHMM(d.m0), end: minToHHMM(Math.min(d.m1, 1439)) })
      if (ev) talk('reschedule', { event: short(ev.title) }, undefined, `${short(ev.title)} 改到 ${minToHHMM(d.m0)} 了。`)
      sfx.chime()
    },
  }
  // 懸停時提示可以拖曳
  const canvasEl = world.renderer.domElement
  const hoverCursor = (p, hit) => {
    if (p?.type !== 'event' || !hit) return
    const a = ring.arc(p.id)
    const m = a && ring.minutesOnRay(world.raycaster.ray, a.mesh.position.y + 0.1)
    const mode = ring.dragMode(p.id, m)
    canvasEl.style.cursor = mode === 'move' ? 'grab' : 'ew-resize'
  }

  world.onPick = (p) => {
    tip.style.display = 'none'
    if (p?.type !== 'placed') closeItemMenu()
    if (!p) return
    if (p.type === 'placed') {
      sfx.pop()
      openItemMenu(p.id)
      return
    }
    if (p.type === 'char') {
      const c = cast[p.id]
      store.pet()
      c.pet()
      sfx.squish()
      fx.hearts(c.headAnchor())
      // 偶爾另一位也想被摸
      if (Math.random() < 0.25 && duet('pet', {}, c)) return
      c.say(line('pat', {}, c.id), 2600)
      return
    }
    if (p.type === 'cabin') {
      sfx.pop()
      if (duo.inside) room.enter()
      talk(duo.inside ? 'cabinFocus' : 'cabin', {}, 3200)
      return
    }
    sfx.pop()
    ui.reveal(p.type, p.id)
    if (p.type === 'task') garden.bounce(p.id)
    if (p.type === 'event') ring.pulse(p.id)
    if (p.type === 'project') hooks.focusProject(p.id)
  }

  // ── 遊戲事件 → 演出 ──
  store.on('change', () => {
    ui.render()
    syncScene()
    if (!placing) placed.sync(store.state.placed)
  })
  store.on('itemPlaced', ({ item, placed: p }) => {
    sfx.plant()
    const pos = new THREE.Vector3(p.x, 0.3, p.z)
    fx.burst(pos, { colors: ['#ffffff', '#ffd1dc', '#fff1b8'], count: 30, speed: 1.6 })
    fx.ripple(pos.clone().setY(0.05), '#ffd1dc', 1.6)
    talk('shopPlace', { item: item.name }, undefined, `${item.name}擺好了！`)
  })
  store.on('itemMoved', () => sfx.pop())
  store.on('itemStored', ({ item, refund }) => {
    sfx.undo()
    ui.toast({ icon: '糖', title: `收起了${item?.name || '裝飾'}`, sub: `退還 ${refund} 顆金平糖` })
  })
  store.on('reviewSaved', ({ first }) => {
    sfx.chime()
    const c = talk('reviewDone', {}, 4200, '謝謝你告訴我今天的事。')
    if (first) fx.burst(c.headAnchor(), { colors: ['#ffffff', '#fff1b8', '#d9ccff'], count: 30, speed: 1.4 })
  })
  store.on('shopPoor', () => talk('shopPoor', {}, undefined, '金平糖還不太夠，慢慢來就好。'))
  store.on('reload', () => {
    decor.sync(store.level.level)
    world.home()
  })
  store.on('taskAdded', (t) => {
    if (t.date !== store.selectedDate) return
    sfx.plant()
    setTimeout(() => {
      const pos = garden.anchor(t.id)
      if (pos) fx.ripple(pos.clone().setY(0.1), tagOf(t.tag).color, 1.2)
    }, 50)
  })
  store.on('taskDone', (t) => {
    const pos = garden.anchor(t.id)
    if (!pos) return
    const color = tagOf(t.tag).color
    sfx.bloom(t.priority)
    if (pos) {
      fx.burst(pos, { colors: t.star ? ['#fff3c4', '#ffd76e', color] : ['#ffffff', color, '#ffe1ea'], count: t.priority === 3 || t.star ? 60 : 40 })
      fx.ripple(pos.clone().setY(0.1), color, 1.4)
      // もち跑去花旁慶祝，ふじ在原地替她加油
      mochi.visit(pos, () => fx.burst(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), { colors: ['#fff6d6', '#ffffff'], count: 16, speed: 1.2, size: 0.16 }))
      fuji.cheer(pos)
    }
    talk(t.star ? 'starDone' : t.priority === 3 ? 'highTaskDone' : 'taskDone', { task: short(t.title) })
  })

  // ── 花の図鑑：新品種或稀有的花 ──
  store.on('flower', ({ flower, task, isNew }) => {
    const r = RARITIES[flower.rarity]
    const rare = flower.rarity === 'rare' || flower.rarity === 'legend'
    setTimeout(() => {
      if (rare) {
        sfx.chime()
        const pos = task.date === store.selectedDate && garden.anchor(task.id)
        if (pos) {
          fx.burst(pos, { colors: ['#fff6d6', r.color, '#ffffff'], count: flower.rarity === 'legend' ? 90 : 60, speed: 1.8 })
          fx.ripple(pos.clone().setY(0.1), r.color, 2)
        }
      }
      ui.toast({ icon: '花', title: isNew ? `圖鑑新發現：${flower.name}` : `開出了${r.label}的${flower.name}`, sub: `${r.label}・${flower.desc}`, ms: 5200 })
      if (isNew || rare) talk(isNew ? 'newFlower' : 'rareFlower', { flower: flower.name }, 4000, `是${flower.name}呢。`)
    }, 1500)
  })

  // ── 每週挑戰 ──
  store.on('questProgress', () => ui.renderQuests())
  store.on('weeklyReady', (w) => {
    ui.toast({ icon: '週', title: `每週挑戰「${w.title}」達成`, sub: '到左下角領取限定擺飾吧', ms: 5200 })
    talk('weeklyReady', {}, undefined, '這週的挑戰完成了。')
  })
  store.on('weeklyClaimed', ({ item }) => {
    sfx.fanfare()
    fx.fireworks(new THREE.Vector3(0, 0, 0), 3)
    if (item) {
      ui.toast({ icon: '週', title: `拿到每週限定「${item.name}」`, sub: '到商店可以免費擺一件', ms: 5600 })
      talk('weeklyClaimed', { item: item.name }, 4200, `${item.name}，這週的小紀念。`)
    } else ui.toast({ icon: '週', title: '每週挑戰完成', sub: '限定擺飾都收齊了，改送 40 顆金平糖' })
  })

  // ── もち和ふじ共同的好感度（各自穿自己的衣裝） ──
  const syncBond = () => {
    const lv = store.bond.level
    for (const c of duo.list) {
      c.abilities.water = lv >= actLevel('water')
      c.abilities.sit = lv >= actLevel('sit')
    }
    mochi.setOutfit(store.player.bond.outfit)
    fuji.setOutfit(store.player.bond.outfitFuji)
  }
  syncBond()
  store.on('change', syncBond)
  // 澆花是もち的工作
  mochi.onWater = {
    // 找今天還沒開的花苞
    target: () => {
      if (store.selectedDate !== store.today) return null
      const buds = store.gardenTasks(store.today).filter((t) => !t.done)
      const t = buds[Math.floor(Math.random() * buds.length)]
      const pos = t && garden.anchor(t.id)
      return pos ? { id: t.id, pos } : null
    },
    sprinkle: ({ id, pos }) => {
      fx.burst(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), { colors: ['#bfe6ff', '#e6f6ff', '#9fd4f5'], count: 26, speed: 0.7, up: 0.6, gravity: -5, size: 0.14, life: 1 })
      garden.bounce(id)
      talk('water', {}, 2800, '喝口水吧。', mochi)
    },
  }
  store.on('bondUp', (lv) => {
    const r = lv.reward
    const sub = r?.outfit ? `解鎖衣裝「${outfitOf(r.outfit)?.name}」，到紀錄頁換上吧` : r?.act ? `新動作「${BOND_ACTS[r.act]?.name}」：${BOND_ACTS[r.act]?.desc}` : ''
    setTimeout(() => {
      sfx.chime()
      for (const c of duo.list) fx.hearts(c.headAnchor())
      ui.toast({ icon: '絆', title: `もちとふじの絆 Lv.${lv.level}「${lv.name}」`, sub, ms: 6000 })
      if (!duet('bondUp', { level: lv.level })) talk('bondUp', { level: lv.level }, 4000, '我們更熟了一點。')
    }, 1800)
  })
  store.on('gift', ({ coins }) => {
    setTimeout(() => {
      sfx.chime()
      fx.burst(fuji.headAnchor(), { colors: ['#ffd1dc', '#fff1b8', '#bfe3ff'], count: 20, speed: 1, size: 0.16 })
      ui.toast({ icon: '糖', title: `ふじ送你 ${coins} 顆金平糖`, sub: '每天第一次來看她們都有' })
      talk('gift', { coins }, 3800, `${coins} 顆金平糖，給你。`)
    }, 7000)
  })
  store.on('outfit', ({ who } = {}) => {
    const c = cast[who] || mochi
    c.celebrate()
    talk('outfit', {}, 3200, '好看嗎？', c)
  })

  // ── 專案期限 ──
  store.on('projectOnTime', (p) => {
    setTimeout(() => {
      sfx.chime()
      const pos = towers.anchor(p.id)
      if (pos) fx.burst(pos, { colors: ['#ffe08a', '#fff6d6', '#ffffff'], count: 50, speed: 1.6 })
      ui.toast({ icon: '塔', title: `「${short(p.name, 12)}」準時落成`, sub: `在期限前完成・額外 +${XP.onTime} XP` })
      talk('onTime', { project: short(p.name) }, 4200, '在期限前落成了。')
    }, 2600)
  })

  // ── 逾期的花、お守り ──
  store.on('revive', (t) => {
    const pos = garden.anchor(t.id)
    if (pos) setTimeout(() => fx.burst(pos, { colors: ['#d9f5c8', '#ffffff', '#a8e0b0'], count: 30, speed: 1.2, up: 1.4 }), 300)
    setTimeout(() => talk('revive', {}, 3800, '晚一點也沒關係，花開了。'), 1200)
  })
  store.on('charmBought', ({ charms }) => {
    sfx.chime()
    ui.toast({ icon: '守', title: '買了一個お守り', sub: `漏掉一天時會自動保住連續天數・身上 ${charms} 個` })
    talk('charmBuy', {}, undefined, 'お守り收好了。')
  })
  store.on('charmUsed', ({ used, streak, left }) => {
    setTimeout(() => {
      sfx.chime()
      ui.toast({ icon: '守', title: `お守り保住了連續 ${streak} 天`, sub: `漏掉的 ${used} 天用掉 ${used} 個・還剩 ${left} 個`, ms: 6000 })
      talk('charmUsed', { streak }, 4200, `連續 ${streak} 天，還在喔。`)
    }, 2600)
  })

  // ── 本命 ──
  store.on('starPicked', (t) => {
    sfx.chime()
    if (t.date === store.selectedDate) garden.bounce(t.id)
    talk('starPick', { task: short(t.title) }, undefined, `「${short(t.title)}」是今天的本命。`)
  })
  store.on('starFull', () => {
    ui.toast({ icon: '★', title: `本命已經選滿 ${MAX_STARS} 件`, sub: '先取消其中一件，再選這件' })
    talk('starFull', {}, undefined, '三件就好，太多會累的。')
  })
  store.on('starAll', () => {
    setTimeout(() => {
      sfx.fanfare()
      fx.fireworks(new THREE.Vector3(3.4, 0, 3.2), 2)
      ui.toast({ icon: '★', title: '本命全清', sub: `最重要的三件事都完成了・+${XP.starAll} XP` })
      talk('starAll', {}, 4200, '最重要的三件，全部完成了。')
      fuji.cheer(mochi.position)
    }, 1100)
  })
  store.on('tired', ({ count }) => {
    ui.toast({ icon: '茶', title: `今天已經完成 ${count} 件了`, sub: `超過 ${SOFT_CAP} 件後任務 XP 減半，記得休息一下`, ms: 5200 })
    setTimeout(() => talk('tired', {}, 4200, '今天開了好多花，剩下的慢慢來。'), 1600)
  })
  store.on('taskUndone', () => sfx.undo())
  store.on('routineAdded', (r) => {
    talk('routine', {}, undefined, '以後我會記得幫你準備好。')
    ui.toast({ icon: '↻', title: `已設為例行${r.kind === 'task' ? '任務' : '日程'}`, sub: `「${short(r.title, 12)}」・${repeatLabel(r.repeat)}` })
  })
  store.on('allDone', () => {
    setTimeout(() => {
      sfx.fanfare()
      fx.fireworks(new THREE.Vector3(3.4, 0, 3.2), 3)
      for (const c of duo.list) c.celebrate()
      if (!duet('allDone')) talk('allDone', {}, 4200)
    }, 900)
  })
  store.on('eventDone', (e) => {
    sfx.chime()
    ring.pulse(e.id)
    const pos = ring.anchor(e.id)
    if (pos) fx.burst(pos, { colors: ['#ffffff', EVENT_COLORS[e.color % EVENT_COLORS.length]], count: 36, speed: 1.6, up: 1.6 })
    talk('eventDone')
  })
  store.on('milestoneDone', ({ project }) => {
    sfx.build()
    talk('milestone', { project: short(project.name) })
  })
  store.on('projectDone', (p) => {
    setTimeout(() => {
      sfx.fanfare()
      const pos = towers.anchor(p.id, false) || new THREE.Vector3()
      fx.fireworks(pos, 6)
      talk('projectDone', { project: short(p.name) }, 4500)
      ui.toast({ icon: '塔', title: `「${short(p.name, 12)}」落成！`, sub: '整座塔都蓋好了，+120 XP' })
    }, 1100)
  })
  store.on('xp', ({ amount, coins, kind, id }) => {
    let pos = null
    if (kind === 'task' || kind === 'star') pos = garden.anchor(id)
    else if (kind === 'event') pos = ring.anchor(id)
    else if (kind === 'milestone' || kind === 'project' || kind === 'onTime') pos = towers.anchor(id)
    pos ||= mochi.headAnchor()
    const delay = kind === 'project' ? 900 : kind === 'onTime' ? 1800 : kind === 'perfect' || kind === 'starAll' ? 1300 : 150
    setTimeout(() => floatText(pos.clone().add(new THREE.Vector3(0, 0.4, 0)), `+${amount} XP`, amount >= 40, coins), delay)
  })
  store.on('levelUp', ({ level }) => {
    const unlock = UNLOCKS.find((u) => u.level === level)
    setTimeout(() => {
      sfx.levelUp()
      const spawned = decor.sync(level, true)
      for (const o of spawned) {
        const pos = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())
        setTimeout(() => fx.burst(pos, { colors: ['#ffffff', '#ffe3ec', '#d9efff'], count: 60, speed: 2.4 }), 500)
      }
      if (unlock) {
        // 鏡頭對準新景觀的實際位置，距離依大小調整（天空中的大型景觀要拉遠才看得到全貌）；
        // 星之大樹和雲鯨本來就擺在預設視角看得到的地方，回到預設視角最完整
        const b = decor.bounds(unlock.key)
        if (unlock.key === 'skytree' || unlock.key === 'whale') world.home()
        else if (b && unlock.key !== 'islet') world.flyTo(b.center, Math.min(46, Math.max(13, world.fitDistance(b.size / 2) * 0.85)))
      }
      fx.fireworks(new THREE.Vector3(0, 0, 0), 4)
      for (const c of duo.list) c.celebrate()
      if (!duet('levelUp', { level })) talk('levelUp', { level }, 4200)
      ui.showLevelUp(level, unlock)
    }, 1200)
  })
  let achDelay = 0
  store.on('achievement', (a) => {
    achDelay += 700
    setTimeout(() => {
      achDelay = Math.max(0, achDelay - 700)
      sfx.chime()
      ui.toast({ icon: a.kanji, stamp: true, title: `${a.name}・${a.title}`, sub: a.desc, ms: 4200 })
    }, 1500 + achDelay)
  })
  store.on('questReady', (q) => ui.toast({ icon: '済', title: `每日任務「${q.title}」達成`, sub: '到左下角領取 +30 XP 吧' }))
  store.on('questClaimed', () => {
    sfx.chime()
    const c = talk('questDone')
    fx.burst(c.headAnchor(), { colors: ['#fff1b8', '#ffd1dc', '#ffffff'], count: 30, speed: 1.4 })
  })

  // ── 日程提醒 ──
  const reminders = new Reminders(store, (e, min) => {
    sfx.reminder()
    const when = min > 0 ? `${min} 分鐘後開始（${e.start}）` : `現在開始（${e.start}）`
    // 看時間的是ふじ
    const say = min > 0 ? line('reminder', { event: short(e.title), min }, 'fuji') : `「${short(e.title)}」開始囉！`
    fuji.say(say || `${short(e.title)}，${when}`, 6000)
    ui.toast({ icon: '鐘', title: e.title, sub: when, ms: 9000 })
    if (store.selectedDate === store.today) ring.pulse(e.id)
    if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${e.title}`, when, e.id)
  })

  // ── 雲端同步（不需後端：資料寫進使用者選的檔案，放在雲端資料夾即可跨裝置） ──
  const fileSync = new FileSync(store, {
    onStatus: () => ui.renderSync(),
    onPulled: () => ui.toast({ icon: '雲', title: '已載入雲端的新資料', sub: '別台裝置的變更同步過來了' }),
    onConflict: () => ui.toast({ icon: '雲', title: '兩邊都有新的變更', sub: '到「紀錄 → 設定」選要保留哪一邊', ms: 7000 }),
  })
  ui.attachSync(fileSync)
  fileSync.init()

  // ── 時間 ──
  let lastMin = -1
  setInterval(() => {
    ui.tickClock()
    reminders.check()
    if (store.tick()) return
    const minute = Math.floor(Date.now() / 60000)
    if (minute !== lastMin) {
      lastMin = minute
      if (store.selectedDate === store.today) {
        ui.renderSchedule(false)
        syncNextEvent()
      }
      if (!placing && !duo.focusing) ui.maybeAskReview()
    }
  }, 1000)
  ui.tickClock()

  // 夜晚切換深色玻璃
  let isNight = null
  world.add(() => {
    const night = isNight ? sky.night > 0.45 : sky.night > 0.55
    if (night !== isNight) {
      isNight = night
      document.body.classList.toggle('night', night)
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', night ? '#283667' : '#cfe8f6')
    }
  })

  // 兩人偶爾閒聊，有時你一句我一句
  let lastTalk = performance.now()
  addEventListener('pointerdown', () => (lastTalk = performance.now()))
  setInterval(() => {
    if (document.hidden || duo.focusing) return
    if (performance.now() - lastTalk > 70000 && Math.random() < 0.5) {
      lastTalk = performance.now()
      if (Math.random() < 0.45 && duet('idle')) return
      talk('idle')
    }
  }, 15000)

  // 專注時才出現的「屋內／小島」切換鈕
  const roomBtn = document.getElementById('roomBtn')
  roomBtn.onclick = () => (room.active ? room.exit() : room.enter())
  world.add(() => {
    if (roomBtn.hidden === duo.inside) roomBtn.hidden = !duo.inside
    if (roomBtn.classList.contains('on') !== room.active) {
      roomBtn.classList.toggle('on', room.active)
      roomBtn.title = room.active ? '回到小島 (V)' : '看看小木屋裡'
    }
  })

  // 小木屋和ふじ的家之前擺在那兩塊地上的裝飾，挪到附近的空地
  for (const lot of [LAYOUT.cabin, { ...LAYOUT.home2, r: 1.1 }]) {
    for (const p of store.state.placed) {
      const a0 = Math.atan2(p.z - lot.z, p.x - lot.x)
      const r0 = lot.r + radiusOf(p.key)
      if (Math.hypot(p.x - lot.x, p.z - lot.z) >= r0) continue
      search: for (let d = r0 + 0.05; d < r0 + 6; d += 0.25) {
        for (let i = 0; i < 24; i++) {
          const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.26
          const x = lot.x + Math.cos(a) * d
          const z = lot.z + Math.sin(a) * d
          if (!spotFree(x, z, store.state.placed, p.id, p.key, decor.footprints())) continue
          store.moveItem(p.id, +x.toFixed(2), +z.toFixed(2), p.rot)
          break search
        }
      }
    }
  }

  // ── 開場 ──
  ui.render()
  syncScene(false)
  placed.sync(store.state.placed)
  world.start()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.getElementById('loader').classList.add('done')
      setTimeout(() => {
        const g = greetKey()
        if (!(g === 'greet.morning' && Math.random() < 0.5 && duet('morning'))) talk(g, {}, 3800)
        mochi.celebrate()
        fuji.cheer(mochi.position)
      }, 900)
      setTimeout(() => {
        if (ui.maybeShowWeekCard()) return
        if (ui.maybeAskReview()) return
        const overdue = store.overdue().length
        const todo = store.tasksOn(store.today).filter((t) => !t.done).length
        const soon = store.deadlineSoon()[0]
        if (overdue) talk('wilt', { count: overdue }, 3800, line('overdue', { count: overdue }, 'fuji'))
        else if (soon) talk('deadlineNear', { project: short(soon.project.name), days: soon.days }, 4200, `「${short(soon.project.name)}」快到期囉。`)
        else if (new Date().getHours() < 12 && todo >= MAX_STARS && !store.starsOn(store.today).length) talk('planAsk', {}, 4200, '今天最重要的三件事是什麼？點 ☆ 選起來吧。')
        else if (!store.tasksOn(store.today).length) talk('emptyDay', {}, 3800)
        else talk(`season.${season}`, {}, 3800)
      }, 5600)
    }),
  )

  // ── PWA：正式版註冊 Service Worker（開發時不註冊，避免快取干擾） ──
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[hiyori] SW 註冊失敗', e))
  }
  let installEvt = null
  const installRow = document.getElementById('installRow')
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installEvt = e
    installRow.hidden = false
  })
  addEventListener('appinstalled', () => {
    installRow.hidden = true
    ui.toast({ icon: '島', title: '已安裝到桌面', sub: '之後可以像 App 一樣直接打開小島' })
  })
  document.getElementById('installBtn').onclick = async () => {
    if (!installEvt) return
    installEvt.prompt()
    await installEvt.userChoice.catch(() => {})
    installEvt = null
    installRow.hidden = true
  }

  store.flushPending()

  // 方便除錯：在 console 用 hiyori.store / hiyori.sky.hourOverride = 20
  window.hiyori = { store, world, sky, mochi, fuji, duo, cabin, room, fx, decor, ui, placed, fileSync }
}

boot()
