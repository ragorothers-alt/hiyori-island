import './styles.css'
import * as THREE from 'three'
import { Store, toMin, repeatLabel } from './store.js'
import { UI } from './ui.js'
import { World } from './scene/world.js'
import { Sky } from './scene/sky.js'
import { Island } from './scene/island.js'
import { SEASONS, seasonOf } from './scene/season.js'
import { Decor } from './scene/decor.js'
import { Garden } from './scene/garden.js'
import { Towers } from './scene/towers.js'
import { TimeRing } from './scene/timeRing.js'
import { Mochi } from './scene/mochi.js'
import { Particles } from './scene/particles.js'
import { Labels } from './scene/labels.js'
import { sfx } from './audio.js'
import { Reminders, systemNotify } from './reminders.js'
import { LINES } from './data/lines.js'
import { UNLOCKS, tagOf, PRIORITIES, PROJECT_COLORS, EVENT_COLORS } from './theme.js'

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const short = (s, n = 9) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
function line(key, vars = {}) {
  const list = key.startsWith('greet.') ? LINES.greet[key.slice(6)] : LINES[key]
  if (!list?.length) return ''
  return pick(list).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}
function greetKey() {
  const h = new Date().getHours()
  return h >= 5 && h < 11 ? 'greet.morning' : h >= 11 && h < 17 ? 'greet.noon' : h >= 17 && h < 21 ? 'greet.evening' : 'greet.night'
}

async function boot() {
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
  const mochi = new Mochi(world, labels, sky)
  const fx = new Particles(world, sky)
  sfx.setEnabled(store.state.settings.sound)
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
    mochi.setSeason(season)
    const el = document.getElementById('dateSeason')
    el.textContent = `${SEASONS[season].name} · ${SEASONS[season].jp}`
    el.dataset.season = season
  }
  applySeason()
  store.on('dateChanged', applySeason)

  // ── 浮動經驗值 ──
  const floatText = (pos, text, big = false) => {
    if (!pos) return
    const el = document.createElement('div')
    el.className = 'floaty' + (big ? ' big' : '')
    el.textContent = text
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
      c.el.innerHTML = `${esc(short(p.name, 10))} <b>${pct === 100 ? '落成' : pct + '%'}</b>`
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
    garden.sync(store.tasksOn(store.selectedDate), store.selectedDate)
    const built = towers.sync(store.activeProjects(), (p) => store.progress(p), animate)
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

  // ── UI 掛鉤 ──
  const hooks = {
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
    resetView: () => world.home(),
    modalClosed: () => world.home(1.6),
    setSound: (on) => sfx.setEnabled(on),
    focusStarted: (resumed) => {
      mochi.setFocus(true)
      if (!resumed) {
        sfx.chime()
        mochi.say(line('focusStart'))
      }
    },
    focusFinished: (minutes) => {
      mochi.setFocus(false)
      sfx.temple()
      fx.skyLantern(mochi.position.clone().add(new THREE.Vector3(0, 1.4, 0)))
      store.completePomodoro(minutes)
      mochi.celebrate()
      mochi.say(line('focusEnd'))
      ui.toast({ icon: '灯', title: '專注完成，放一盞天燈', sub: `+${minutes} 分鐘・接著休息一下吧` })
    },
    breakFinished: () => {
      sfx.chime()
      mochi.say(line('breakEnd'))
      ui.toast({ icon: '風', title: '休息結束', sub: '準備好了就再開始一輪吧' })
    },
    focusStopped: () => {
      mochi.setFocus(false)
      mochi.say('沒關係，下次再一起專注。')
    },
  }
  const ui = new UI(store, hooks)

  // 小島置中在面板以外的區域
  const panel = document.getElementById('panel')
  const updateShift = () => {
    const collapsed = panel.classList.contains('collapsed')
    if (innerWidth > 860) world.setViewShift(collapsed ? 0 : (panel.offsetWidth + 20) / 2, 0)
    else world.setViewShift(0, collapsed ? 30 : innerHeight * 0.25 - 36)
  }
  new MutationObserver(updateShift).observe(panel, { attributes: true, attributeFilter: ['class'] })
  addEventListener('resize', updateShift)
  updateShift()
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
    } else if (p.type === 'mochi') html = `もち<small>點一下摸摸牠</small>`
    if (!html) return
    tip.innerHTML = html
    tip.style.display = ''
    tip.style.left = ev.clientX + 'px'
    tip.style.top = ev.clientY + 'px'
  }

  world.onPick = (p) => {
    tip.style.display = 'none'
    if (!p) return
    if (p.type === 'mochi') {
      store.pet()
      mochi.pet()
      sfx.squish()
      fx.hearts(mochi.headAnchor())
      mochi.say(line('pat'), 2600)
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
  })
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
    if (t.date !== store.selectedDate) return
    const pos = garden.anchor(t.id)
    const color = tagOf(t.tag).color
    sfx.bloom(t.priority)
    if (pos) {
      fx.burst(pos, { colors: ['#ffffff', color, '#ffe1ea'], count: t.priority === 3 ? 60 : 40 })
      fx.ripple(pos.clone().setY(0.1), color, 1.4)
      mochi.visit(pos, () => fx.burst(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), { colors: ['#fff6d6', '#ffffff'], count: 16, speed: 1.2, size: 0.16 }))
    }
    mochi.say(line(t.priority === 3 ? 'highTaskDone' : 'taskDone', { task: short(t.title) }))
  })
  store.on('taskUndone', () => sfx.undo())
  store.on('routineAdded', (r) => {
    const msg = line('routine') || '以後我會記得幫你準備好。'
    mochi.say(msg)
    ui.toast({ icon: '↻', title: `已設為例行${r.kind === 'task' ? '任務' : '日程'}`, sub: `「${short(r.title, 12)}」・${repeatLabel(r.repeat)}` })
  })
  store.on('allDone', () => {
    setTimeout(() => {
      sfx.fanfare()
      fx.fireworks(new THREE.Vector3(3.4, 0, 3.2), 3)
      mochi.say(line('allDone'), 4200)
    }, 900)
  })
  store.on('eventDone', (e) => {
    sfx.chime()
    ring.pulse(e.id)
    const pos = ring.anchor(e.id)
    if (pos) fx.burst(pos, { colors: ['#ffffff', EVENT_COLORS[e.color % EVENT_COLORS.length]], count: 36, speed: 1.6, up: 1.6 })
    mochi.say(line('eventDone'))
  })
  store.on('milestoneDone', ({ project }) => {
    sfx.build()
    mochi.say(line('milestone', { project: short(project.name) }))
  })
  store.on('projectDone', (p) => {
    setTimeout(() => {
      sfx.fanfare()
      const pos = towers.anchor(p.id, false) || new THREE.Vector3()
      fx.fireworks(pos, 6)
      mochi.say(line('projectDone', { project: short(p.name) }), 4500)
      ui.toast({ icon: '塔', title: `「${short(p.name, 12)}」落成！`, sub: '整座塔都蓋好了，+120 XP' })
    }, 1100)
  })
  store.on('xp', ({ amount, kind, id }) => {
    let pos = null
    if (kind === 'task') pos = garden.anchor(id)
    else if (kind === 'event') pos = ring.anchor(id)
    else if (kind === 'milestone' || kind === 'project') pos = towers.anchor(id)
    pos ||= mochi.headAnchor()
    const delay = kind === 'project' ? 900 : kind === 'perfect' ? 1300 : 150
    setTimeout(() => floatText(pos.clone().add(new THREE.Vector3(0, 0.4, 0)), `+${amount} XP`, amount >= 40), delay)
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
        const target = decor.anchor(unlock.key)
        if (target && unlock.key !== 'islet') world.flyTo(target.clone().add(new THREE.Vector3(0, 1, 0)), 13)
      }
      fx.fireworks(new THREE.Vector3(0, 0, 0), 4)
      mochi.celebrate()
      mochi.say(line('levelUp', { level }), 4200)
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
    fx.burst(mochi.headAnchor(), { colors: ['#fff1b8', '#ffd1dc', '#ffffff'], count: 30, speed: 1.4 })
    mochi.say(line('questDone'))
  })

  // ── 日程提醒 ──
  const reminders = new Reminders(store, (e, min) => {
    sfx.reminder()
    const when = min > 0 ? `${min} 分鐘後開始（${e.start}）` : `現在開始（${e.start}）`
    mochi.say(line('reminder', { event: short(e.title), min }) || `${short(e.title)}，${when}`, 6000)
    ui.toast({ icon: '鐘', title: e.title, sub: when, ms: 9000 })
    if (store.selectedDate === store.today) ring.pulse(e.id)
    if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${e.title}`, when, e.id)
  })

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

  // もち偶爾閒聊
  let lastTalk = performance.now()
  addEventListener('pointerdown', () => (lastTalk = performance.now()))
  setInterval(() => {
    if (document.hidden || mochi.mode === 'focus') return
    if (performance.now() - lastTalk > 70000 && Math.random() < 0.5) {
      lastTalk = performance.now()
      mochi.say(line('idle'))
    }
  }, 15000)

  // ── 開場 ──
  ui.render()
  syncScene(false)
  world.start()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.getElementById('loader').classList.add('done')
      setTimeout(() => {
        mochi.say(line(greetKey()), 3800)
        mochi.celebrate()
      }, 900)
      setTimeout(() => {
        const overdue = store.overdue().length
        if (overdue) mochi.say(line('overdue', { count: overdue }), 3800)
        else if (!store.tasksOn(store.today).length) mochi.say(line('emptyDay'), 3800)
        else if (LINES.season?.[season]) mochi.say(pick(LINES.season[season]), 3800)
      }, 5600)
    }),
  )

  // 方便除錯：在 console 用 hiyori.store / hiyori.sky.hourOverride = 20
  window.hiyori = { store, world, sky, mochi, fx, decor }
}

boot()
