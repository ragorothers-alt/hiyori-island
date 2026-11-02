// 小島：three.js 的世界、もち和ふじ、ひより町，以及把資料事件接到 3D 演出（音效、通知和台詞在 main.js）。
// App 模式開機時不載入；小島模式開機、或第一次切回小島時，由 main.js 動態載入這個檔案，只建一次
import * as THREE from 'three'
import { toMin, minToHHMM, daysBetween } from './store.js'
import { sheetLayout } from './ui.js'
import { World } from './scene/world.js'
import { Sky } from './scene/sky.js'
import { Island, LAYOUT } from './scene/island.js'
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
import { UNLOCKS, tagOf, PRIORITIES, PROJECT_COLORS, EVENT_COLORS } from './theme.js'
import { RARITIES } from './data/flowers.js'
import { actLevel } from './data/bond.js'
import { RESIDENTS, MOVE_IN, buildingOf, buildingStage } from './data/town.js'
import { RESIDENT_LINES, VISITS, TOWN_LINES, TOWN_DUETS } from './data/townLines.js'
import { esc } from './ui/dom.js'
import { pick, short, fill, line } from './voice.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ctx 由 main.js 給：store、ui、params；talk／duet 挑台詞（App 模式也送到小對話框）；season() 現在的季節；
// syncNight(night) 換深色玻璃；notice 是ひより町長大的通知；started() 開始建了（之後失敗就不重試，免得事件綁兩次）；
// attach(小島) 建好了，main.js 從這時起把演出交給小島
export async function createIsland(ctx) {
  const { store, ui, params, talk, duet } = ctx
  // 兩位主角的模型和字型一起載
  const catsReady = preloadCats()
  // 等字型載入，3D 刻度文字才會用對字體（最多等 2.5 秒）
  await Promise.race([document.fonts?.ready, sleep(2500)])

  const world = new World(document.getElementById('scene'))
  ctx.started()
  const sky = new Sky(world)
  if (params.has('hour')) sky.hourOverride = parseFloat(params.get('hour'))
  sky.theme = store.state.settings.theme
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
  // 從這裡到最後都不再等待：等模型的時候資料可能變了（App 模式切回小島時可以一邊用），
  // 上面先蓋的部分照最新的資料補齊，底下的都照最新的資料建，事件接上之前不會漏掉變更
  sky.theme = store.state.settings.theme
  const R0 = islandRadius(store.state.town.plevel)
  if (island.setRadius(R0)) {
    world.setIslandRadius(R0)
    decor.relayout(store.level.level)
    ring.relayout()
  }
  ptown.setLevel(store.state.town.plevel)
  const mochi = new Character(world, labels, sky, { id: 'mochi', name: 'もち', build: () => buildCat('mochi'), home: homeAt(LAYOUT.home), seat: 0, study: 'read' })
  const fuji = new Character(world, labels, sky, { id: 'fuji', name: 'ふじ', build: () => buildCat('fuji'), home: homeAt(LAYOUT.home2), seat: 1, study: 'write' })
  const cast = { mochi, fuji }
  const duo = new Duo(world, labels, { list: [mochi, fuji], cabin, room })
  const fx = new Particles(world, sky)
  const placed = new Placed(world, sky)
  const town = new Town(world, labels, island, sky)
  world.powerSave = store.state.settings.powerSave
  // 畫質：auto 時觸控手機用標準（不做 MSAA、白天不開泛光），其他用高
  const applyQuality = (q) =>
    world.setQuality(q === 'auto' ? (matchMedia('(hover: none) and (pointer: coarse)').matches ? 'standard' : 'high') : q)
  applyQuality(store.state.settings.quality)
  decor.sync(store.level.level)

  // ── 四季（換季由 main.js 通知）──
  const applySeason = (season) => {
    island.setSeason(season)
    decor.setSeason(season)
    fx.setSeason(season)
    for (const c of duo.list) c.setSeason(season)
  }
  applySeason(ctx.season())

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
  // 每分鐘換一次「下一個」日程
  let lastMin = -1
  setInterval(() => {
    const minute = Math.floor(Date.now() / 60000)
    if (minute === lastMin) return
    lastMin = minute
    if (store.selectedDate === store.today) syncNextEvent()
  }, 1000)

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

  // ── 鏡頭飛去看 ──
  const focusProject = (id) => {
    const p = houses.anchor(id, false)
    if (p) world.flyTo(p.add(new THREE.Vector3(0, 1.4, 0)), 10)
  }
  const flyToDistrict = (key) => {
    const v = town.view(key)
    world.flyTo(v.target, world.fitDistance(v.radius) + 2, { dir: v.dir, elevation: 0.72, duration: 1.5 })
  }
  // App 模式時不進小木屋（看 body 上的標記）
  room.blocked = () => document.body.classList.contains('app-mode')

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
    world.hidden = document.body.classList.contains('app-mode')
    if (full()) return
    const { x, y } = panelShift(panel.classList.contains('collapsed'))
    world.setViewShift(x, y)
  }
  // 預設視角的構圖：寬螢幕以面板展開時的版面去解，收起時只是左右平移。
  // 手機直式的抽屜佔掉下半部，上半部塞不下天空加整座島：以抽屜收起（全螢幕）去解，
  // 抽屜打開時把島往上推到上半部可見區域的中間，天空暫時被推出畫面
  // 全螢幕（含 App 模式）時量不到平常的面板大小：先記著，離開全螢幕再算
  let viewStale = false
  const composeView = () => {
    viewStale = full()
    if (viewStale) return
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
  // 小島在 App 模式（全螢幕面板後面）建好的話，第一次露出來時才量得到構圖：鏡頭直接擺到預設視角
  let shown = false
  const reveal = () => {
    if (shown || full()) return
    shown = true
    if (viewStale) composeView()
    if (skyStale) placeSky()
    updateShift()
    world.controls.target.copy(world.homeTarget)
    world.camera.position.copy(world._homePos())
    world.shift = { ...world.shiftTarget }
    world._applyShift()
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
  new MutationObserver(() => {
    if (viewStale) composeView()
    updateShift()
    if (skyStale) placeSky()
    placeRoom()
    reveal()
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
  town.sync(store.state.town.seen)
  townView()
  world.controls.target.copy(world.homeTarget)
  world.camera.position.copy(world._homePos())
  // 建好時就看得到（小島模式開機）的話構圖已經對了
  shown = !full()

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
      ctx.notice.townGrow({ key, stage, found })
      // 店長已經住在這裡的話，說說自己的店
      const r = town.residents[b.resident]
      if (!found && stage > MOVE_IN && r && !r.away) setTimeout(() => r.say(resLine(r.key, 'grow', vars), 3800), 1500)
      react(found ? 2 : 1, () => {
        if (found && Math.random() < 0.5 && townDuet('townFound', vars)) return
        const who = pick([mochi, fuji])
        who.say(townLine(who, found ? 'townFound' : 'townGrow', vars), 4200)
      })
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
      ctx.notice.townMoveIn({ key })
      const vars = { resident: info.name, animal: info.animal }
      react(3, () => {
        if (Math.random() < 0.5 && townDuet('townMoveIn', vars)) return
        const who = pick([mochi, fuji])
        who.say(townLine(who, 'townMoveIn', vars), 4200)
      })
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
        ctx.notice.islandGrew()
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
      react(2, () => {
        const who = pick([mochi, fuji])
        who.say(townLine(who, 'projectTownGrow', { level }), 4200)
      })
      ctx.notice.projectTownGrew({ level, added, demand })
      await sleep(2600)
    }),
  )
  // 舊存檔第一次打開：小島已經照累積的紀錄長成小鎮了（通知在 main.js）
  store.on('townWelcome', (t) => {
    setTimeout(() => {
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
      if (Math.random() < 0.25 && duet('pet', {}, c.id)) return
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
    if (p.type === 'project') focusProject(p.id)
  }

  // ── 遊戲事件 → 島上的演出（音效、通知、台詞在 main.js）──
  // もち和ふじ共同的好感度（各自穿自己的衣裝）
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
  store.on('change', () => {
    syncScene()
    if (!placing) placed.sync(store.state.placed)
    syncBond()
  })
  store.on('itemPlaced', ({ placed: p }) => {
    const pos = new THREE.Vector3(p.x, 0.3, p.z)
    fx.burst(pos, { colors: ['#ffffff', '#ffd1dc', '#fff1b8'], count: 30, speed: 1.6 })
    fx.ripple(pos.clone().setY(0.05), '#ffd1dc', 1.6)
  })
  store.on('reviewSaved', () => resWork('post'))
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
    setTimeout(() => {
      const pos = garden.anchor(t.id)
      if (pos) fx.ripple(pos.clone().setY(0.1), tagOf(t.tag).color, 1.2)
    }, 50)
  })
  store.on('taskDone', (t) => {
    const pos = garden.anchor(t.id)
    if (!pos) return
    const color = tagOf(t.tag).color
    fx.burst(pos, { colors: t.star ? ['#fff3c4', '#ffd76e', color] : ['#ffffff', color, '#ffe1ea'], count: t.priority === 3 || t.star ? 60 : 40 })
    fx.ripple(pos.clone().setY(0.1), color, 1.4)
    // もち跑去花旁慶祝，ふじ在原地替她加油
    mochi.visit(pos, () => fx.burst(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), { colors: ['#fff6d6', '#ffffff'], count: 16, speed: 1.2, size: 0.16 }))
    fuji.cheer(pos)
    resWork('florist')
  })
  // 花の図鑑：稀有的花在花圃上多爆一點
  store.on('flower', ({ flower, task }) => {
    if (flower.rarity !== 'rare' && flower.rarity !== 'legend') return
    setTimeout(() => {
      const r = RARITIES[flower.rarity]
      const pos = task.date === store.selectedDate && garden.anchor(task.id)
      if (!pos) return
      fx.burst(pos, { colors: ['#fff6d6', r.color, '#ffffff'], count: flower.rarity === 'legend' ? 90 : 60, speed: 1.8 })
      fx.ripple(pos.clone().setY(0.1), r.color, 2)
    }, 1500)
  })
  store.on('weeklyClaimed', () => fx.fireworks(new THREE.Vector3(0, 0, 0), 3))
  store.on('bondUp', () => setTimeout(() => {
    for (const c of duo.list) fx.hearts(c.headAnchor())
  }, 1800))
  store.on('gift', () => setTimeout(() => fx.burst(fuji.headAnchor(), { colors: ['#ffd1dc', '#fff1b8', '#bfe3ff'], count: 20, speed: 1, size: 0.16 }), 7000))
  store.on('outfit', ({ who } = {}) => (cast[who] || mochi).celebrate())
  store.on('projectOnTime', (p) => setTimeout(() => {
    const pos = houses.anchor(p.id)
    if (pos) fx.burst(pos, { colors: ['#ffe08a', '#fff6d6', '#ffffff'], count: 50, speed: 1.6 })
  }, 2600))
  store.on('revive', (t) => {
    const pos = garden.anchor(t.id)
    if (pos) setTimeout(() => fx.burst(pos, { colors: ['#d9f5c8', '#ffffff', '#a8e0b0'], count: 30, speed: 1.2, up: 1.4 }), 300)
  })
  store.on('starPicked', (t) => {
    if (t.date === store.selectedDate) garden.bounce(t.id)
  })
  store.on('starAll', () => setTimeout(() => {
    fx.fireworks(new THREE.Vector3(3.4, 0, 3.2), 2)
    fuji.cheer(mochi.position)
  }, 1100))
  store.on('allDone', () => setTimeout(() => {
    fx.fireworks(new THREE.Vector3(3.4, 0, 3.2), 3)
    for (const c of duo.list) c.celebrate()
  }, 900))
  store.on('eventDone', (e) => {
    ring.pulse(e.id)
    const pos = ring.anchor(e.id)
    if (pos) fx.burst(pos, { colors: ['#ffffff', EVENT_COLORS[e.color % EVENT_COLORS.length]], count: 36, speed: 1.6, up: 1.6 })
    resWork('clock')
  })
  store.on('projectDone', (p) => setTimeout(() => fx.fireworks(houses.anchor(p.id, false) || new THREE.Vector3(), 6), 1100))
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
    }, 1200)
  })
  // 時段安排、作息與睡眠、習慣、生活記錄：店長偶爾說一句
  store.on('planApplied', () => resWork('clock'))
  store.on('coachApplied', () => resWork('clock'))
  store.on('sleepLogged', ({ date, first }) => date === store.today && first && resWork('cafe'))
  store.on('habitDone', () => {
    mochi.cheer(fuji.position)
    resWork('bathhouse')
  })
  store.on('habitAll', () => setTimeout(() => {
    for (const c of duo.list) c.celebrate()
  }, 900))
  store.on('urgeResisted', () => resWork('bathhouse'))
  store.on('quitMilestone', () => setTimeout(() => {
    for (const c of duo.list) c.celebrate()
  }, 1200))
  store.on('lifeLogged', () => resWork('cafe'))

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
      talk('water', {}, 2800, '喝口水吧。', 'mochi')
    },
  }

  // 夜晚切換深色玻璃（跟著天色）
  world.add(() => ctx.syncNight(sky.night))
  // 全螢幕面板蓋住場景時整個場景停住，只推天色：入夜或在全螢幕裡切換外觀，玻璃照樣換深色；
  // 天色快轉中或剛換了日夜就補畫一幀，面板四周露出的天空才跟玻璃一致
  world.coveredTick = (dt) => {
    const shifting = sky.shifting
    sky.update(dt, world.timer.getElapsed())
    if (ctx.syncNight(sky.night) || shifting) world.redraw()
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

  // 小木屋和ふじ的家之前擺在那兩塊地上的裝飾，挪到附近的空地（要用到升級景觀的佔地，所以第一次建小島時才做）
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
  const slots = () => store.state.projects.map((p) => p.slot).join()
  const slotsBefore = slots()
  store.settleLots()
  // 有專案因此分到地：清單上的狀態也跟著換
  if (slots() !== slotsBefore) ui.render()

  // ── 開場 ──
  syncScene(false)
  placed.sync(store.state.placed)
  world.start()
  // 專注以番茄鐘為準：正在專注（含暫停中）的話兩人直接在屋裡；已經結束的不重播，獎勵也只在 main.js 給一次
  if (ui.focus.mode === 'focus') {
    duo.setFocus(true, true)
    garden.setFocus(ui.focus.task?.id || null)
  }

  const scene = {
    // ── 說話與小特效（main.js 挑好台詞、決定誰說）──
    say: (who, text, ms) => cast[who]?.say(text, ms),
    duet: (lines) => duo.duet(lines),
    headBurst: (who, opts) => fx.burst(cast[who].headAnchor(), opts),
    greet() {
      mochi.celebrate()
      fuji.cheer(mochi.position)
    },
    pulseEvent: (id) => ring.pulse(id),
    setSeason: applySeason,
    hasHouse: (id) => !!houses.anchor(id, false),
    hour: () => sky.hour(),
    night: () => sky.night,
    get placing() {
      return !!placing
    },
    // ── UI 掛鉤裡跟小島有關的部分 ──
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
    focusProject,
    // ひより町的建築卡片：還沒開張的就看看它會浮出來的地方
    focusTown: (key) => flyToDistrict(key),
    focusProjectTown: () => {
      const v = ptown.view(ptown.level, 0)
      world.flyTo(v.target, world.fitDistance(v.radius) + 1, { elevation: 0.9, duration: 1.5 })
    },
    resetView: () => (room.active ? room.exit() : world.home()),
    // 切換 App 模式：進 App 時先離開小木屋；回小島時正在專注、兩人已經在屋裡，就直接進屋陪讀
    // （cabin: false 是要飛去看別的地方）
    appModeChanged(on, opts = {}) {
      updateShift()
      if (!on) reveal()
      if (on && room.active) room.exit()
      if (!on && opts.cabin !== false && duo.focusing && duo.inside) room.enter()
    },
    modalClosed: () => !room.active && world.home(1.6),
    setPowerSave: (on) => (world.powerSave = on),
    setQuality: (q) => applyQuality(q),
    setTheme: (t) => sky.setTheme(t),
    // ── 專注 ──
    focusStarted(resumed, taskId) {
      duo.setFocus(true, resumed)
      garden.setFocus(taskId)
    },
    focusTaskChanged(taskId) {
      if (duo.focusing) garden.setFocus(taskId)
      if (taskId) garden.bounce(taskId)
    },
    // 一輪結束（獎勵在 main.js 已經記好）：兩人出屋、放天燈、綁著的任務的花彈一下
    focusFinished(taskId) {
      duo.setFocus(false)
      garden.setFocus(null)
      // 天燈從小木屋屋頂升起（兩人還在屋裡）；出來後兩人會擊掌慶祝
      fx.skyLantern(duo.inside ? cabin.point('roofTop') : mochi.position.clone().add(new THREE.Vector3(0, 1.6, 0)))
      resWork('library')
      const pos = taskId && garden.anchor(taskId)
      if (pos) fx.burst(pos, { colors: ['#fff1b8', '#ffd98a', '#ffffff'], count: 36, speed: 1.4 })
      if (taskId) garden.bounce(taskId)
    },
    focusStopped() {
      duo.setFocus(false)
      garden.setFocus(null)
    },
    // 方便除錯：在 console 用 hiyori.sky.hourOverride = 20
    debug: { world, sky, mochi, fuji, duo, cabin, room, fx, decor, placed, town, ptown, houses, resizeIsland, visit: startVisit },
  }
  ctx.attach(scene)
  // 在 App 模式後面建好的（要切回小島）：先在背景把著色器編好再換畫面，切過去的第一幀才不會卡住
  if (world.hidden) await Promise.race([world.precompile(), sleep(4000)])
  return scene
}
