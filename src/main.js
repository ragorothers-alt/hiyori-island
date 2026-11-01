import './styles.css'
import * as THREE from 'three'
import { Store, toMin, minToHHMM, repeatLabel, daysBetween } from './store.js'
import { UI, sheetLayout } from './ui.js'
import { World } from './scene/world.js'
import { Sky } from './scene/sky.js'
import { Island, LAYOUT } from './scene/island.js'
import { SEASONS, seasonOf } from './scene/season.js'
import { Decor } from './scene/decor.js'
import { Garden } from './scene/garden.js'
import { ProjectHouses } from './scene/projectHouses.js'
import { ProjectTown } from './scene/projectTown.js'
import { PLAN, inLot, inTown, lotsAt, islandRadius } from './data/projectTown.js'
import { TimeRing } from './scene/timeRing.js'
import { Character } from './scene/character.js'
import { Duo } from './scene/duo.js'
import { preloadCats, buildCat } from './scene/models/cats.js'
import { Particles } from './scene/particles.js'
import { Labels } from './scene/labels.js'
import { Placed, spotFree, radiusOf } from './scene/placed.js'
import { Cabin } from './scene/cabin.js'
import { Room } from './scene/room.js'
import { Town, islandPath } from './scene/town.js'
import { SHOP_ITEMS } from './data/shop.js'
import { sfx } from './audio.js'
import { Reminders, systemNotify } from './reminders.js'
import { FileSync } from './sync.js'
import { CloudSync, codeFromHash } from './cloud.js'
import { LINES, FUJI_LINES, DUETS } from './data/lines.js'
import { UNLOCKS, tagOf, PRIORITIES, PROJECT_COLORS, EVENT_COLORS, XP, MAX_STARS, SOFT_CAP } from './theme.js'
import { RARITIES } from './data/flowers.js'
import { lifeKindOf } from './data/life.js'
import { taskDur } from './planner.js'
import { BOND_ACTS, actLevel, outfitOf } from './data/bond.js'
import { lookHour, nightAt, realHour, systemDark } from './daylight.js'
import { RESIDENTS, MOVE_IN, buildingOf, buildingStage } from './data/town.js'
import { RESIDENT_LINES, VISITS, TOWN_LINES, TOWN_DUETS } from './data/townLines.js'

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const short = (s, n = 9) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
// 描寫天色的字眼：外觀設定讓天空和真實時間不同時（例如白天開夜間模式），問候避開這些句子
const SKY_WORDS = /陽光|晨光|太陽|曬|樹蔭|晚霞|夕陽|星星|月亮|夜色|天色|天黑|螢火蟲/
// who：'mochi' 或 'fuji'，各自用自己的台詞；avoid：不要挑到符合的句子
function line(key, vars = {}, who = 'mochi', avoid = null) {
  const src = who === 'fuji' ? FUJI_LINES : LINES
  // 'greet.morning'、'season.spring' 這種有點的鍵，往下一層找
  let list = key.split('.').reduce((o, k) => o?.[k], src)
  if (!list?.length) return ''
  const ok = avoid ? list.filter((s) => !avoid.test(s)) : list
  if (ok.length) list = ok
  return fill(pick(list), vars)
}
function greetKey() {
  const h = new Date().getHours()
  return h >= 5 && h < 11 ? 'greet.morning' : h >= 11 && h < 17 ? 'greet.noon' : h >= 17 && h < 21 ? 'greet.evening' : 'greet.night'
}

async function boot() {
  const params = new URLSearchParams(location.search)
  const store = new Store()
  // 選了夜晚的話，載入畫面就先用深色，不要先閃一下白
  const theme = store.state.settings.theme
  const bootHour = params.has('hour') ? parseFloat(params.get('hour')) : realHour()
  document.body.classList.toggle('night', nightAt(lookHour(bootHour, theme, systemDark())) > 0.5)
  // 兩位主角的模型和字型一起載
  const catsReady = preloadCats()
  // 等字型載入，3D 刻度文字才會用對字體（最多等 2.5 秒）
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2500))])

  const world = new World(document.getElementById('scene'))
  const sky = new Sky(world)
  if (params.has('hour')) sky.hourOverride = parseFloat(params.get('hour'))
  sky.theme = theme
  // 島的大小跟著專案町：用到外圈的地時島比較大，先定好再蓋島和島外的東西
  const islandR = islandRadius(store.state.town.plevel)
  LAYOUT.radius = islandR
  LAYOUT.path.z0 = islandR - 0.7
  world.setIslandRadius(islandR)
  const island = new Island(world)
  const decor = new Decor(world, sky)
  const garden = new Garden(world, sky)
  const houses = new ProjectHouses(world, sky)
  // 專案町的街道與小物；房子只蓋在已經鋪好路的地上，城鎮升級的演出時才把新地上的房子蓋起來
  const ptown = new ProjectTown(world, sky)
  ptown.setLevel(store.state.town.plevel)
  const builtProjects = () => store.towerProjects().filter((p) => p.slot < lotsAt(ptown.level))
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
  const FUJI_KEYS = new Set(['reviewAsk', 'reviewDone', 'reschedule', 'reminder', 'eventDone', 'deadlineNear', 'onTime', 'routine', 'overdue', 'wilt', 'planAsk', 'starPick', 'starFull', 'questDone', 'weeklyReady', 'weeklyClaimed', 'charmBuy', 'charmUsed', 'breakEnd', 'tired', 'gift', 'planApplied', 'planFull', 'sleepGood', 'sleepShort', 'bedtime', 'habitSlip', 'quitMilestone'])
  const MOCHI_KEYS = new Set(['shopBuy', 'shopPlace', 'shopPoor', 'taskDone', 'highTaskDone', 'starDone', 'starAll', 'newFlower', 'rareFlower', 'water', 'revive', 'milestone', 'habitDone', 'habitAll', 'urgeResisted', 'lifeLogged'])
  const voice = (key) => (FUJI_KEYS.has(key) ? fuji : MOCHI_KEYS.has(key) ? mochi : pick([mochi, fuji]))
  const talk = (key, vars = {}, ms, fallback = '', who = voice(key), avoid = null) => {
    who.say(line(key, vars, who.id, avoid) || fallback, ms)
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
  const town = new Town(world, labels, island, sky)
  sfx.setEnabled(store.state.settings.sound)
  world.powerSave = store.state.settings.powerSave
  // 畫質：auto 時觸控手機用標準（不做 MSAA、白天不開泛光），其他用高
  const applyQuality = (q) =>
    world.setQuality(q === 'auto' ? (matchMedia('(hover: none) and (pointer: coarse)').matches ? 'standard' : 'high') : q)
  applyQuality(store.state.settings.quality)
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
    // 已落成的房子不掛名牌（整片名牌太擠），點房子可以看是哪個專案
    const active = builtProjects().filter((p) => store.projectStatus(p) !== 'done')
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
        c = labels.add(el, () => houses.labelAnchor(p.id), { declutter: true })
        chips.set(p.id, c)
      }
      const pct = Math.round(store.progress(p) * 100)
      c.el.style.setProperty('--c', PROJECT_COLORS[p.color % PROJECT_COLORS.length])
      const days = p.deadline && !p.completedAt && !p.pausedAt ? daysBetween(store.today, p.deadline) : null
      const due = days === null || days > 2 ? '' : days < 0 ? '<i class="due late">逾期</i>' : `<i class="due">${days ? `剩 ${days} 天` : '今天截止'}</i>`
      c.el.classList.toggle('paused', !!p.pausedAt)
      c.el.innerHTML = `${esc(short(p.name, 10))} <b>${pct === 100 ? (p.onTime ? '準時落成' : '落成') : p.pausedAt ? `暫停・${pct}%` : pct + '%'}</b>${due}`
      // 快到期的名牌優先留著，暫停的讓位
      c.priority = due ? 2 : p.pausedAt ? 0 : 1
      labels.resized(c)
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
    const onLots = builtProjects()
    const built = houses.sync(onLots, (p) => store.progress(p), animate, store.today)
    ptown.setLots(new Set(onLots.map((p) => p.slot)))
    for (const b of built) {
      const p = store.state.projects.find((x) => x.id === b.id)
      const color = PROJECT_COLORS[(p?.color ?? 0) % PROJECT_COLORS.length]
      b.positions.forEach((pos, i) =>
        setTimeout(() => {
          fx.burst(pos, { colors: ['#ffffff', color, '#fff2d6'], count: 34, speed: 1.8, up: 1.2, gravity: -2, size: 0.2 })
        }, 300 + i * 250),
      )
      const base = houses.anchor(b.id, false)
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
      const p = houses.anchor(id, false)
      if (p) world.flyTo(p.add(new THREE.Vector3(0, 1.4, 0)), 10)
    },
    // ひより町的建築卡片：還沒開張的就看看它會浮出來的地方
    focusTown: (key) => flyToDistrict(key),
    focusProjectTown: () => {
      const v = ptown.view(ptown.level, 0)
      world.flyTo(v.target, world.fitDistance(v.radius) + 1, { elevation: 0.9, duration: 1.5 })
    },
    resetView: () => (room.active ? room.exit() : world.home()),
    reviewOpened: () => talk('reviewAsk', {}, 4200, '今天過得怎麼樣？'),
    modalClosed: () => !room.active && world.home(1.6),
    setSound: (on) => sfx.setEnabled(on),
    setPowerSave: (on) => (world.powerSave = on),
    setQuality: (q) => applyQuality(q),
    setTheme: (t) => sky.setTheme(t),
    // 現在幾點（網址帶 ?hour= 時用那個）
    hourNow: () => sky.hour(),
    // info：{ round, rounds, free }，連續幾輪的第幾輪、是不是不設長度往上數
    focusStarted: (resumed, taskId, info = {}) => {
      duo.setFocus(true, resumed)
      garden.setFocus(taskId)
      if (!resumed) {
        sfx.chime()
        const t = taskId && store.state.tasks.find((x) => x.id === taskId)
        if (info.round > 1) talk('focusRound', { round: info.round, rounds: info.rounds })
        else if (t) talk('focusTask', { task: short(t.title) })
        else if (info.free) talk('focusFree', {}, undefined, '', fuji)
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
    focusFinished: (minutes, taskId, info = {}) => {
      duo.setFocus(false)
      garden.setFocus(null)
      sfx.temple()
      // 天燈從小木屋屋頂升起（兩人還在屋裡）；出來後兩人會擊掌慶祝
      fx.skyLantern(duo.inside ? cabin.point('roofTop') : mochi.position.clone().add(new THREE.Vector3(0, 1.6, 0)))
      store.completePomodoro(minutes, taskId)
      const multi = info.rounds > 1
      if (multi && info.last) talk('focusRoundsDone', { rounds: info.rounds })
      else if (!duet('focusEnd')) talk('focusEnd')
      resWork('library')
      const t = taskId && store.state.tasks.find((x) => x.id === taskId)
      if (t) {
        const pos = garden.anchor(t.id)
        if (pos) fx.burst(pos, { colors: ['#fff1b8', '#ffd98a', '#ffffff'], count: 36, speed: 1.4 })
        garden.bounce(t.id)
      }
      const rest = multi && !info.last ? `休息 ${info.breakMin} 分鐘後接著第 ${info.round + 1} 輪` : '接著休息一下吧'
      const title = multi ? (info.last ? `${info.rounds} 輪都完成了，放一盞天燈` : `第 ${info.round}/${info.rounds} 輪完成`) : '專注完成，放一盞天燈'
      ui.toast({ icon: '灯', title, sub: t ? `「${short(t.title, 10)}」長大了一點・${rest}` : `+${minutes} 分鐘・${rest}` })
    },
    // next：還有下一輪時是 { next, rounds }，計時器接著會自己開始下一輪（台詞交給 focusStarted）
    breakFinished: (next) => {
      sfx.chime()
      if (next) {
        ui.toast({ icon: '風', title: '休息結束', sub: `第 ${next.next}/${next.rounds} 輪開始了` })
        return
      }
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
  // 寬螢幕和橫向手機：面板在右側；手機直式：面板是下半部的抽屜
  const wide = () => !sheetLayout()
  // 手機直式抽屜打開時，畫面要往上推多少才讓島落在上半部（由 composeView 算）
  let phoneOpenY = innerHeight * 0.25
  const panelShift = (collapsed) => wide()
    ? { x: collapsed ? 0 : (panel.offsetWidth + 20) / 2, y: 0 }
    : { x: 0, y: collapsed ? 0 : phoneOpenY }
  // 全螢幕編輯時面板蓋住整個畫面：小島維持原本的取景，場景停止更新（world.covered）
  const full = () => panel.classList.contains('full')
  const updateShift = () => {
    world.covered = full()
    if (full()) return
    const { x, y } = panelShift(panel.classList.contains('collapsed'))
    world.setViewShift(x, y)
  }
  // 預設視角的構圖：寬螢幕以面板展開時的版面去解，收起時只是左右平移。
  // 手機直式的抽屜佔掉下半部，上半部塞不下天空加整座島：以抽屜收起（全螢幕）去解，
  // 抽屜打開時把島往上推到上半部可見區域的中間，天空暫時被推出畫面
  const composeView = () => {
    const dock = document.querySelector('.dock')
    if (wide()) {
      const right = innerWidth - panel.offsetWidth - 20
      world.compose({ shiftX: (panel.offsetWidth + 20) / 2, right, bottom: dock.getBoundingClientRect().top })
      return
    }
    world.compose({ bottom: innerHeight - 12 - dock.offsetHeight })
    const p = new THREE.Vector3(0, 0.5, 0).project(world.homeCamera({ x: 0, y: 0 }))
    const islandY = ((1 - p.y) / 2) * innerHeight
    const visible = innerHeight - panel.offsetHeight - 10 - dock.offsetHeight
    phoneOpenY = islandY - visible * 0.52
  }
  // 星之大樹放在預設視角（面板展開時）看得到的右上角：日期列下方、面板左側；
  // 雲鯨的弧線也依同一個可見範圍決定高度
  let skyStale = false
  const placeSky = () => {
    // 全螢幕時量不到平常的面板寬度，等離開全螢幕再算
    skyStale = full()
    if (skyStale) return
    const cam = world.homeCamera(panelShift(false))
    const right = (wide() ? innerWidth - panel.offsetWidth - 20 : innerWidth) - 14
    const top = document.querySelector('.datebar').getBoundingClientRect().bottom + 14
    decor.placeSky(cam, { right, top })
    const bottom = wide() ? innerHeight : innerHeight - panel.offsetHeight - 60
    decor.placeWhale(cam, { left: 0, right: right + 14, top, bottom })
  }
  // 小木屋室內的取景：整個畫面扣掉打開的面板和 Dock（進屋時其他資訊卡都會淡出）
  const dock = document.querySelector('.dock')
  const placeRoom = () => {
    const W = innerWidth
    const H = innerHeight
    const open = !panel.classList.contains('collapsed')
    if (wide()) {
      room.area = { left: 0, top: 0, right: open ? W - panel.offsetWidth - 30 : W, bottom: H - 18 - dock.offsetHeight - 6 }
    } else {
      // 手機：面板打開時是下半部的抽屜，Dock 浮在它上面；收起時 Dock 貼在最下面
      const dockBottom = open ? panel.offsetHeight + 10 : 12
      room.area = { left: 0, top: 0, right: W, bottom: H - dockBottom - dock.offsetHeight - 6 }
    }
  }
  // 進小木屋時把畫面整個交給屋裡：面板收起、等級卡和日期列淡出；出來時面板回到原本的樣子
  let panelBeforeRoom = null
  room.onToggle = (inside) => {
    document.body.classList.toggle('in-room', inside)
    if (inside) {
      panelBeforeRoom ??= !panel.classList.contains('collapsed')
      ui.togglePanel(true)
    } else if (panelBeforeRoom != null) {
      if (panelBeforeRoom) ui.togglePanel(false)
      panelBeforeRoom = null
    }
    placeRoom()
  }
  if (room.active) room.onToggle(true)
  new MutationObserver(() => {
    updateShift()
    if (skyStale) placeSky()
    placeRoom()
  }).observe(panel, { attributes: true, attributeFilter: ['class'] })
  addEventListener('resize', composeView)
  addEventListener('resize', updateShift)
  addEventListener('resize', placeSky)
  addEventListener('resize', placeRoom)
  composeView()
  updateShift()
  placeSky()
  placeRoom()
  world.shift = { ...world.shiftTarget }
  world._applyShift()

  // ── ひより町 ──
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const resLine = (key, kind, vars = {}) => {
    const list = RESIDENT_LINES[key]?.[kind]
    return list?.length ? fill(pick(list), vars) : ''
  }
  const townLine = (who, key, vars = {}) => {
    const list = TOWN_LINES[who.id]?.[key]
    return list?.length ? fill(pick(list), vars) : ''
  }
  const townDuet = (key, vars) => {
    const list = TOWN_DUETS[key]
    if (!list?.length) return false
    duo.duet(pick(list).map(([who, text]) => [who, fill(text, vars)]))
    return true
  }
  // 街區越多，預設視角往後拉一點，讓後方的浮島入鏡
  const townView = () => {
    const n = town.count
    world.setTownView(1, n * 0.3)
    composeView()
    placeSky()
  }
  // 島換大小：重蓋島、島緣景物、時之環和街區浮島，構圖拉遠；回傳有沒有變
  const resizeIsland = (R) => {
    if (!island.setRadius(R)) return false
    world.setIslandRadius(R)
    decor.relayout(store.level.level)
    ring.relayout()
    ring.sync(store.eventsOn(store.selectedDate), store.selectedDate === store.today)
    town.reset()
    town.sync(store.state.town.seen)
    townView()
    return true
  }
  const fader = document.createElement('div')
  fader.className = 'stage-fade'
  document.body.append(fader)
  const fadeTo = (v) => {
    fader.style.opacity = v
    return sleep(480)
  }
  const flyToDistrict = (key) => {
    const v = town.view(key)
    world.flyTo(v.target, world.fitDistance(v.radius) + 2, { dir: v.dir, elevation: 0.72, duration: 1.5 })
  }
  town.sync(store.state.town.seen)
  townView()
  world.controls.target.copy(world.homeTarget)
  world.camera.position.copy(world._homePos())

  // 開張、長大、搬家的演出排隊播：專注中、在小木屋裡、全螢幕面板、彈窗開著或擺放中都先等等
  const townQueue = []
  let townBusy = false
  // 鏡頭回到預設視角後，挑最重要的一則讓兩人說（搬家 > 開張 > 長大）
  let townReact = null
  const react = (rank, fn) => {
    if (!townReact || rank >= townReact.rank) townReact = { rank, fn }
  }
  const townQuiet = () =>
    !document.hidden && !duo.focusing && !room.active && !world.covered && !placing && ![...document.querySelectorAll('.modal')].some((m) => !m.hidden)
  const runTown = async () => {
    if (townBusy) return
    townBusy = true
    let mark = null
    try {
      while (townQueue.length) {
        if (!townQuiet()) {
          await sleep(2000)
          continue
        }
        const job = townQueue.shift()
        await job()
        mark = world.lastInteract
      }
      await sleep(1200)
      // 使用者沒動鏡頭的話就回到預設視角（街區變多時已經拉遠）
      if (mark !== null && world.lastInteract === mark) {
        world.home(1.8)
        await sleep(1900)
      }
      const r = townReact
      townReact = null
      r?.fn()
    } finally {
      townBusy = false
      if (townQueue.length) runTown()
    }
  }
  const queueTown = (job) => {
    townQueue.push(job)
    setTimeout(runTown, 2600)
  }
  // 搬家的居民走到店門口時
  const arrived = new Set()
  const arrivalWaits = new Map()
  town.onArrived = (key) => {
    arrived.add(key)
    arrivalWaits.get(key)?.()
  }
  const waitArrival = (key, ms) =>
    arrived.has(key) ? Promise.resolve() : new Promise((res) => (arrivalWaits.set(key, res), setTimeout(res, ms)))

  store.on('townGrow', ({ key, stage }) =>
    queueTown(async () => {
      const b = buildingOf(key)
      const found = !town.districts[key]
      const vars = { building: b.name, stage: b.stages[stage - 1] }
      flyToDistrict(key)
      await sleep(1600)
      const res = town.set(key, stage, true)
      if (!res) return
      if (found) townView()
      sfx.build()
      setTimeout(() => {
        sfx.chime()
        fx.burst(res.at, { colors: ['#ffffff', RESIDENTS[b.resident].color, '#fff1b8'], count: found ? 60 : 44, speed: 1.8, up: 1.4 })
        if (found) fx.ripple(town.districts[key].layout.center.clone().add(new THREE.Vector3(0, 0.05, 0)), '#fff1b8', 2.6)
      }, found ? 3300 : 900)
      ui.toast({
        icon: b.icon,
        title: found ? `ひより町：${b.name}開張了` : `${b.name}長成了「${vars.stage}」`,
        sub: found ? `${b.stages[0]}・${b.feature}越多，它會一路長大` : `${stage} / 5 階・${b.feature}讓它一路長大`,
        ms: 5600,
      })
      // 店長已經住在這裡的話，說說自己的店
      const r = town.residents[b.resident]
      if (!found && stage > MOVE_IN && r && !r.away) setTimeout(() => r.say(resLine(r.key, 'grow', vars), 3800), 1500)
      react(found ? 2 : 1, () => {
        if (found && Math.random() < 0.5 && townDuet('townFound', vars)) return
        const who = pick([mochi, fuji])
        who.say(townLine(who, found ? 'townFound' : 'townGrow', vars), 4200)
      })
      ui.renderTown()
      await sleep(found ? 5200 : 3400)
    }),
  )
  store.on('townMoveIn', ({ key, home }) =>
    queueTown(async () => {
      const info = RESIDENTS[key]
      const r = town.residents[key]
      if (!r) return
      flyToDistrict(home)
      // 搬家的居民在建築長出來的同時出發，等他走過橋到店門口
      await waitArrival(key, 18000)
      sfx.chime()
      fx.hearts(r.headAnchor())
      r.say(resLine(key, 'moveIn'), 4200)
      ui.toast({ icon: '居', title: `${info.name}搬進了ひより町`, sub: `${info.animal}・${info.role}`, ms: 5600 })
      const vars = { resident: info.name, animal: info.animal }
      react(3, () => {
        if (Math.random() < 0.5 && townDuet('townMoveIn', vars)) return
        const who = pick([mochi, fuji])
        who.say(townLine(who, 'townMoveIn', vars), 4200)
      })
      ui.renderTown()
      await sleep(4200)
    }),
  )
  // 專案町長大：鏡頭飛到新開的地，街道一段段鋪出來、小物冒出來，等著上島的專案在新地上開工
  // 專案多到地不夠（demand）時也會長；用到外圈的地時（island）島先變大
  store.on('projectTownGrew', ({ level, added, demand, island: bigger }) =>
    queueTown(async () => {
      if (level <= ptown.level) return
      if (bigger) {
        world.home(1.4)
        await sleep(1500)
        await fadeTo(1)
        resizeIsland(islandRadius(level))
        world.home(0.01)
        await sleep(120)
        await fadeTo(0)
        sfx.chime()
        ui.toast({ icon: '島', title: '小島變大了', sub: '外圈多出一圈地，時之環和ひより町也跟著往外移', ms: 5600 })
        await sleep(2600)
      }
      const v = ptown.view(level, ptown.level)
      world.flyTo(v.target, world.fitDistance(v.radius) + 2, { elevation: 0.9, duration: 1.5 })
      await sleep(1600)
      sfx.build()
      const dur = ptown.setLevel(level, true)
      await sleep(dur * 1000)
      syncScene(true)
      sfx.chime()
      fx.ripple(v.target.clone().setY(0.05), '#fff1b8', v.radius)
      const town = store.projectTown
      ui.toast({
        icon: '町',
        title: demand ? `專案町擴建到 Lv.${level}` : `專案町長到 Lv.${level}`,
        sub: demand
          ? `專案變多了，多開 ${added} 塊地，每個專案都有房子`
          : `多了 ${added} 塊地${town.next == null ? '・街道全部鋪好了' : `・再 ${town.next - town.points} 點升下一級`}`,
        ms: 5600,
      })
      react(2, () => {
        const who = pick([mochi, fuji])
        who.say(townLine(who, 'projectTownGrow', { level }), 4200)
      })
      ui.render()
      await sleep(2600)
    }),
  )
  // 舊存檔第一次打開：小島已經照累積的紀錄長成小鎮了
  store.on('townWelcome', (t) => {
    setTimeout(() => {
      sfx.chime()
      ui.toast({ icon: '町', title: `小島長成了「${t.title}」`, sub: `ひより町 ${t.rank} / ${t.max}・到紀錄頁看看每一間店`, ms: 6400 })
      const who = pick([mochi, fuji])
      who.say(townLine(who, 'townWelcome', { title: t.title }), 4600)
    }, 8200)
  })
  // 用了對應功能時，那間店的店長偶爾說一句
  const resWork = (home) => {
    const r = town.residents[buildingOf(home).resident]
    if (!r || r.away || Math.random() > 0.35) return
    setTimeout(() => r.say(resLine(r.key, 'work'), 3400), 2400)
  }

  // ── 居民偶爾走過橋，到主島找兩人聊天 ──
  // 主島上走不過去的地方：池塘、花圃、小木屋、專案町的房子與小物、升級景觀、擺設（每趟路線開始時拍一次快照）
  const walkBlocked = () => {
    const { pond, bed, cabin, decor: spots } = LAYOUT
    // 房子擋路（地的四周留給街道），街道和廣場可以走
    const houses = builtProjects().map((p) => PLAN.lots[p.slot])
    const prints = [...decor.footprints(), ...ptown.footprints()]
    const items = store.state.placed.map((p) => [p.x, p.z, radiusOf(p.key) + 0.15])
    return (x, z) => {
      if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 0.3) return true
      if (Math.hypot(x - bed.x, z - bed.z) < bed.r + 0.15) return true
      if (Math.hypot(x - cabin.x, z - cabin.z) < cabin.r + 0.3) return true
      for (const lot of houses) if (inLot(lot, x, z, -0.1)) return true
      for (const [dx, dz] of spots) if (Math.hypot(x - dx, z - dz) < 0.75) return true
      for (const [bx, bz, br] of prints) if (Math.hypot(x - bx, z - bz) < br) return true
      for (const [ix, iz, ir] of items) if (Math.hypot(x - ix, z - iz) < ir) return true
      return false
    }
  }
  // 兩人斜前方、靠居民走來那一側的空地（站在後面會被房子擋住，兩人也會背對鏡頭）
  const meetSpot = (r) => {
    if (duo.focusing || duo.inside) return null
    const blocked = walkBlocked()
    const mid = mochi.position.clone().add(fuji.position).multiplyScalar(0.5).setY(0)
    const a0 = Math.atan2(0.55, r.position.x < mid.x ? -1 : 1)
    for (let i = 0; i < 14; i++) {
      const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.32
      for (const d of [1.35, 1.8]) {
        const p = new THREE.Vector3(mid.x + Math.cos(a) * d, 0, mid.z + Math.sin(a) * d)
        if (Math.hypot(p.x, p.z) > LAYOUT.radius - 1 || blocked(p.x, p.z)) continue
        if (p.distanceTo(mochi.position) < 0.85 || p.distanceTo(fuji.position) < 0.85) continue
        return p
      }
    }
    return null
  }
  const faceEach = (r) => {
    for (const c of duo.list) {
      if (c.busy || c.inside) continue
      c.faceAngle = Math.atan2(r.position.x - c.position.x, r.position.z - c.position.z)
      c.wanderT = Math.max(c.wanderT, 9)
    }
  }
  const visitTalk = async (r) => {
    const mid = mochi.position.clone().add(fuji.position).multiplyScalar(0.5)
    r.faceTo(mid)
    faceEach(r)
    const seg = !duo.focusing && VISITS[r.key]?.length ? pick(VISITS[r.key]) : [['res', resLine(r.key, 'hello')]]
    for (const [who, text] of seg) {
      const sp = who === 'res' ? r : cast[who]
      for (const s of [r, mochi, fuji]) if (s !== sp) s.hush()
      sp.say(text, 3300)
      faceEach(r)
      await sleep(3400)
    }
    r.wave(1.2)
    await sleep(1300)
  }
  const startVisit = (key) =>
    town.visit(key, {
      meet: (r) => {
        const p = meetSpot(r)
        // 剛走下橋：兩人其中一位先打招呼
        if (p) {
          const who = pick([mochi, fuji])
          setTimeout(() => who.say(townLine(who, 'townVisit', { resident: r.info.name }), 3000), 400)
        }
        return p
      },
      path: (from, to) => islandPath(from, to, walkBlocked()),
      onArrive: visitTalk,
    })
  let lastVisit = performance.now()
  setInterval(() => {
    const keys = Object.keys(town.residents).filter((k) => !town.residents[k].busy)
    if (!keys.length || !townQuiet() || townBusy || town.visiting || duo.inside || mochi.busy || fuji.busy) return
    if (performance.now() - lastVisit < 150000 || Math.random() < 0.55) return
    lastVisit = performance.now()
    startVisit(pick(keys))
  }, 20000)

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
    } else if (p.type === 'town') {
      const b = buildingOf(p.id)
      const s = buildingStage(b, store.stats)
      const stage = town.districts[p.id]?.stage || s.stage
      html = `${b.name}・${b.stages[stage - 1]}<small>${s.next ? `${b.feature}・再 ${s.next - s.value} ${b.unit}長大` : '已經長到最大了'}</small>`
    } else if (p.type === 'resident') {
      const r = RESIDENTS[p.id]
      html = `${r.name}<small>${r.animal}・${r.role}・點一下打招呼</small>`
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
    if (p.type === 'town') {
      sfx.pop()
      flyToDistrict(p.id)
      const r = town.residents[buildingOf(p.id).resident]
      if (r && !r.away) setTimeout(() => r.say(resLine(r.key, sky.night > 0.5 ? 'night' : 'idle'), 3400), 900)
      return
    }
    if (p.type === 'resident') {
      const r = town.residents[p.id]
      if (!r) return
      sfx.squish()
      fx.hearts(r.headAnchor())
      if (!r.busy) r.faceCamera()
      r.wave(1.1)
      r.say(resLine(p.id, sky.night > 0.5 ? 'night' : 'hello'), 3200)
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
    resWork('post')
  })
  store.on('shopPoor', () => talk('shopPoor', {}, undefined, '金平糖還不太夠，慢慢來就好。'))
  store.on('reload', ({ soft } = {}) => {
    decor.sync(store.level.level)
    // 讀進來的存檔島的大小可能不一樣（匯入比較小的也照著縮回去）
    if (resizeIsland(islandRadius(store.state.town.plevel))) townQueue.length = 0
    ptown.setLevel(store.state.town.plevel)
    // 匯入的存檔小鎮可能比較小：整個重蓋。同步拉回的通常只是多了幾筆，小鎮沒變小就照常長，鏡頭也不動
    const seen = store.state.town.seen
    const count = town.count
    if (!soft || Object.entries(town.districts).some(([k, d]) => (seen[k] || 0) < d.stage)) {
      townQueue.length = 0
      town.reset()
    }
    town.sync(seen)
    if (soft && town.count === count) return
    townView()
    if (!soft) world.home()
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
    resWork('florist')
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
      const pos = houses.anchor(p.id)
      if (pos) fx.burst(pos, { colors: ['#ffe08a', '#fff6d6', '#ffffff'], count: 50, speed: 1.6 })
      ui.toast({ icon: '町', title: `「${short(p.name, 12)}」準時落成`, sub: `在期限前完成・額外 +${XP.onTime} XP` })
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
    resWork('clock')
  })
  store.on('milestoneDone', ({ project }) => {
    sfx.build()
    talk('milestone', { project: short(project.name) })
  })
  store.on('projectDone', (p) => {
    setTimeout(() => {
      sfx.fanfare()
      const house = houses.anchor(p.id, false)
      fx.fireworks(house || new THREE.Vector3(), 6)
      talk('projectDone', { project: short(p.name) }, 4500)
      ui.toast({ icon: '町', title: `「${short(p.name, 12)}」落成！`, sub: `${house ? '專案町的房子蓋好了' : '所有里程碑都完成了'}，+${XP.project} XP` })
    }, 1100)
  })
  store.on('xp', ({ amount, coins, kind, id }) => {
    let pos = null
    if (kind === 'task' || kind === 'star') pos = garden.anchor(id)
    else if (kind === 'event') pos = ring.anchor(id)
    else if (kind === 'milestone' || kind === 'project' || kind === 'onTime') pos = houses.anchor(id)
    // 時間、作息與戒除是ふじ在照顧，經驗值從她頭上冒出來
    else if (kind === 'plan' || kind === 'sleep' || kind === 'quit' || kind === 'urge') pos = fuji.headAnchor()
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

  // ── 時段安排、作息與睡眠、習慣、生活記錄 ──
  const planEnd = (date) => {
    const ends = store.tasksOn(date).filter((t) => t.at && !t.done).map((t) => toMin(t.at) + taskDur(t))
    return ends.length ? minToHHMM(Math.min(1439, Math.max(...ends))) : ''
  }
  store.on('planApplied', ({ date, count, left }) => {
    sfx.chime()
    if (left) talk('planFull', { count: left }, 4800, '空檔有點滿，改天安排也沒關係。')
    else talk('planApplied', { count, end: planEnd(date) }, 4200, '時段排好了，照自己的步調來。')
    resWork('clock')
  })
  store.on('sleepLogged', ({ date, min, first }) => {
    if (date !== store.today || !first) return
    talk(min < 360 ? 'sleepShort' : 'sleepGood', { hours: Math.round(min / 6) / 10 }, 4200)
    resWork('cafe')
  })
  store.on('habitDone', ({ habit, streak }) => {
    sfx.bloom(2)
    mochi.cheer(fuji.position)
    talk('habitDone', { habit: short(habit.name), streak }, 3800)
    resWork('bathhouse')
  })
  store.on('habitAll', () => {
    setTimeout(() => {
      sfx.fanfare()
      for (const c of duo.list) c.celebrate()
      ui.toast({ icon: '習', title: '今天的養成習慣全部完成', sub: `+${XP.habitAll} XP・一起收好今天的小累積` })
      if (!duet('habitAll')) talk('habitAll', {}, 4200)
    }, 900)
  })
  store.on('urgeResisted', ({ habit, days }) => {
    sfx.pop()
    talk('urgeResisted', { habit: short(habit.name), days }, 3800)
    resWork('bathhouse')
  })
  store.on('habitSlip', ({ habit, days }) => talk('habitSlip', { habit: short(habit.name), days }, 5200, '沒關係，我會陪你慢慢來。'))
  store.on('quitMilestone', ({ habit, days }) => {
    setTimeout(() => {
      sfx.fanfare()
      for (const c of duo.list) c.celebrate()
      ui.toast({ icon: '断', title: `「${short(habit.name, 10)}」戒除滿 ${days} 天`, sub: `走到一個里程碑了・+${XP.quitMilestone} XP`, ms: 5200 })
      if (!duet('quitMilestone', { habit: short(habit.name), days })) talk('quitMilestone', { habit: short(habit.name), days }, 4800)
    }, 1200)
  })
  store.on('lifeLogged', ({ item, count }) => {
    sfx.pop()
    // 不要每筆都說話：第一筆之後每 3 筆說一次
    if (count === 1 || count % 3 === 0) talk('lifeLogged', { kind: lifeKindOf(item.kind).label }, 3400)
    resWork('cafe')
  })

  // ── 提醒：日程、排進時段的任務、就寢 ──
  const reminders = new Reminders(store, (e, min, kind = 'event') => {
    if (kind === 'bed') {
      sfx.chime()
      talk('bedtime', { time: e.start }, 6000, '就寢時間快到了，今天辛苦了。')
      ui.toast({ icon: '眠', title: '就寢時間快到了', sub: `預定 ${e.start} 就寢・今天辛苦了`, ms: 9000 })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify('ひより · 就寢提醒', `預定 ${e.start} 就寢`, 'bedtime')
      return
    }
    sfx.reminder()
    const when = min > 0 ? `${min} 分鐘後開始（${e.start}）` : `現在開始（${e.start}）`
    // 看時間的是ふじ
    const say = min > 0 ? line('reminder', { event: short(e.title), min }, 'fuji') : `「${short(e.title)}」開始囉。`
    fuji.say(say || `${short(e.title)}，${when}`, 6000)
    ui.toast({ icon: kind === 'task' ? '時' : '鐘', title: e.title, sub: kind === 'task' ? `排定的任務・${when}` : when, ms: 9000 })
    if (kind === 'event' && store.selectedDate === store.today) ring.pulse(e.id)
    if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${e.title}`, when, e.id)
  })

  // ── 同步：線上同步（同步碼，手機也能用）＋資料夾同步（資料寫進 OneDrive／Dropbox 裡的檔案）。兩種可以同時開 ──
  const onConflict = () => ui.toast({ icon: '雲', title: '兩邊都有新的變更', sub: '到「紀錄 → 設定」選要保留哪一邊', ms: 7000 })
  const cloudSync = new CloudSync(store, {
    onStatus: () => ui.renderSync(),
    onPulled: () => ui.toast({ icon: '雲', title: '已同步別台裝置的變更', sub: '線上同步' }),
    onConflict,
  })
  const fileSync = new FileSync(store, {
    onStatus: () => ui.renderSync(),
    onPulled: () => ui.toast({ icon: '雲', title: '已載入雲端的新資料', sub: '別台裝置的變更同步過來了' }),
    onConflict,
  })
  ui.attachCloud(cloudSync)
  ui.attachSync(fileSync)
  cloudSync.init()
  fileSync.init()
  // 分享連結（#sync=同步碼）：先從網址拿掉，再到設定裡等使用者按「連線」
  const linkCode = codeFromHash()
  if (linkCode) {
    history.replaceState(null, '', location.pathname + location.search)
    ui.offerCloud(linkCode)
  }

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
  // 回傳這次有沒有換
  const syncNight = () => {
    const night = isNight ? sky.night > 0.45 : sky.night > 0.55
    if (night === isNight) return false
    isNight = night
    document.body.classList.toggle('night', night)
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', night ? '#283667' : '#cfe8f6')
    ui.renderTheme()
    return true
  }
  world.add(syncNight)
  // 全螢幕面板蓋住場景時整個場景停住，只推天色：入夜或在全螢幕裡切換外觀，玻璃照樣換深色；
  // 天色快轉中或剛換了日夜就補畫一幀，面板四周露出的天空才跟玻璃一致
  world.coveredTick = (dt) => {
    const shifting = sky.shifting
    sky.update(dt, world.timer.getElapsed())
    if (syncNight() || shifting) world.redraw()
  }

  // 兩人偶爾閒聊，有時你一句我一句
  let lastTalk = performance.now()
  addEventListener('pointerdown', () => (lastTalk = performance.now()))
  setInterval(() => {
    if (document.hidden || duo.focusing) return
    if (performance.now() - lastTalk > 70000 && Math.random() < 0.5) {
      lastTalk = performance.now()
      // 小鎮有居民的話，有時換店長在自己店門口說一句
      const idle = Object.values(town.residents).filter((r) => !r.away && !r.busy)
      if (idle.length && Math.random() < 0.3) {
        const r = pick(idle)
        r.say(resLine(r.key, 'idle'), 3600)
        return
      }
      if (Math.random() < 0.45 && duet('idle')) return
      talk('idle')
    }
  }, 15000)

  // 專注時才出現的「屋內／小島」切換鈕
  const roomBtn = document.getElementById('roomBtn')
  roomBtn.onclick = () => {
    ui.toggleFull(false)
    room.active ? room.exit() : room.enter()
  }
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

  // 專案町的地、街道和小物上原本擺的裝飾，挪到附近的空地，再讓等著的專案上島
  const prints = () => decor.footprints()
  for (const p of store.state.placed) {
    if (!inTown(p.x, p.z, radiusOf(p.key) * 0.8)) continue
    search: for (let d = 0.5; d < 6; d += 0.25) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        const x = p.x + Math.cos(a) * d
        const z = p.z + Math.sin(a) * d
        if (!spotFree(x, z, store.state.placed, p.id, p.key, prints())) continue
        store.moveItem(p.id, +x.toFixed(2), +z.toFixed(2), p.rot)
        break search
      }
    }
  }
  store.settleLots()

  // ── 開場 ──
  ui.render()
  syncScene(false)
  placed.sync(store.state.placed)
  world.start()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const loader = document.getElementById('loader')
      loader.classList.add('done')
      // 淡出後整個拿掉：只藏起來的話，もち跳跳的無限動畫會在背後一直跑
      setTimeout(() => loader.remove(), 1000)
      setTimeout(() => {
        const g = greetKey()
        const skyDiffers = sky.night > 0.5 !== nightAt(((sky.hour() % 24) + 24) % 24) > 0.5
        const avoid = skyDiffers ? SKY_WORDS : null
        if (!(g === 'greet.morning' && !avoid && Math.random() < 0.5 && duet('morning'))) talk(g, {}, 3800, '', undefined, avoid)
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
  window.hiyori = { store, world, sky, mochi, fuji, duo, cabin, room, fx, decor, ui, placed, fileSync, cloudSync, town, ptown, houses, resizeIsland, visit: startVisit }
}

boot()
