import './styles.css'
import { Store, toMin, minToHHMM, repeatLabel, daysBetween } from './store.js'
import { UI, savedAppMode } from './ui.js'
import { SEASONS, seasonOf } from './scene/season.js'
import { lotsAt } from './data/projectTown.js'
import { sfx } from './audio.js'
import { Reminders, systemNotify } from './reminders.js'
import { SUB_CATS, cycleLabel, fmtMoney } from './subs.js'
import { FileSync } from './sync.js'
import { CloudSync, codeFromHash } from './cloud.js'
import { DUETS } from './data/lines.js'
import { UNLOCKS, XP, MAX_STARS, SOFT_CAP, DATE_KINDS, DUE_KINDS } from './theme.js'
import { RARITIES } from './data/flowers.js'
import { lifeKindOf } from './data/life.js'
import { taskDur } from './planner.js'
import { BOND_ACTS, outfitOf } from './data/bond.js'
import { lookHour, nightAt, realHour, systemDark, daypart } from './daylight.js'
import { RESIDENTS, buildingOf } from './data/town.js'
import { pick, short, fill, line } from './voice.js'

// 描寫天色的字眼：外觀設定讓天空和真實時間不同時（例如白天開夜間模式），問候避開這些句子
const SKY_WORDS = /陽光|晨光|太陽|曬|樹蔭|晚霞|夕陽|星星|月亮|夜色|天色|天黑|螢火蟲/
const greetKey = () => `greet.${daypart()}`
// 部署新版後自動重新整理過的時間（sessionStorage）：短時間內不重複整理
const RELOADED_KEY = 'hiyori-reloaded'
// 已經請過瀏覽器保留資料（不會跳出詢問的瀏覽器以外，只請一次）
const PERSIST_KEY = 'hiyori-persist-asked'

// 開機：資料、介面、提醒、同步。小島（three.js 場景、兩人的模型）在 islandScene.js，
// App 模式開機時不載入：介面先出來，第一次切回小島才下載、建好（只建一次）；小島模式一開始就載入
async function boot() {
  // 小島的模型和貼圖很多：預設只記 250 筆載入紀錄，滿了之後的檔案就收不進離線快取（keepOffline）
  performance.setResourceTimingBufferSize?.(2000)
  const params = new URLSearchParams(location.search)
  // 小島模式：先開始下載小島，和下面建介面同時進行
  let islandMod = null
  const loadIsland = () => (islandMod ??= import('./islandScene.js'))
  if (!savedAppMode()) loadIsland()
  const store = new Store()
  // 選了夜晚的話，載入畫面就先用深色，不要先閃一下白
  const theme = store.state.settings.theme
  // 現在幾點（網址帶 ?hour= 時用那個）；還沒有小島時天色照時間和外觀設定算（有小島就跟著天空）
  const clockHour = () => (params.has('hour') ? parseFloat(params.get('hour')) : realHour())
  const lookNight = () => nightAt(lookHour(((clockHour() % 24) + 24) % 24, store.state.settings.theme, systemDark()))
  document.body.classList.toggle('night', nightAt(lookHour(clockHour(), theme, systemDark())) > 0.5)
  // 小島建好後才有（App 模式開機時一直是 null，直到第一次切回小島）
  let scene = null

  // ── もち和ふじ說話 ──
  // 誰來說：花圃與慶祝交給もち，時間、日程、提醒與照顧步調交給ふじ，其他兩人輪流
  const FUJI_KEYS = new Set(['reviewAsk', 'reviewDone', 'reschedule', 'reminder', 'eventDone', 'deadlineNear', 'onTime', 'routine', 'overdue', 'wilt', 'planAsk', 'starPick', 'starFull', 'questDone', 'weeklyReady', 'weeklyClaimed', 'charmBuy', 'charmUsed', 'breakEnd', 'tired', 'gift', 'planApplied', 'planFull', 'sleepGood', 'sleepShort', 'bedtime', 'habitSlip', 'quitMilestone'])
  const MOCHI_KEYS = new Set(['shopBuy', 'shopPlace', 'shopPoor', 'taskDone', 'highTaskDone', 'starDone', 'starAll', 'newFlower', 'rareFlower', 'water', 'revive', 'milestone', 'habitDone', 'habitAll', 'urgeResisted', 'lifeLogged'])
  const voice = (key) => (FUJI_KEYS.has(key) ? 'fuji' : MOCHI_KEYS.has(key) ? 'mochi' : pick(['mochi', 'fuji']))
  // 小島上說的話是頭上的泡泡；App 模式看不到小島，也送到畫面下方的小對話框（ui 建好後才接上）。
  // 閒聊和摸摸不送，免得太吵
  let chatter = null
  const QUIET = new Set(['idle', 'pat', 'pet', 'water', 'season'])
  const quiet = (key) => QUIET.has(key.split('.')[0])
  // 直接說一句話（不挑台詞）
  const say = (who, text, ms) => {
    scene?.say(who, text, ms)
    chatter?.(who, text, ms)
  }
  // who：'mochi' 或 'fuji'；回傳說話的是誰
  const talk = (key, vars = {}, ms, fallback = '', who = voice(key), avoid = null) => {
    const text = line(key, vars, who, avoid) || fallback
    scene?.say(who, text, ms)
    if (!quiet(key)) chatter?.(who, text, ms)
    return who
  }
  // 兩人你一句我一句；pet 的對話用 self／other 代表被摸的那位和另一位
  const duet = (key, vars = {}, self = 'mochi') => {
    const list = DUETS?.[key]
    if (!list?.length) return false
    const other = self === 'mochi' ? 'fuji' : 'mochi'
    const lines = pick(list).map(([who, text]) => [who === 'self' ? self : who === 'other' ? other : who, fill(text, vars)])
    scene?.duet(lines)
    if (!quiet(key)) chatter?.(...lines[0])
    return true
  }
  sfx.setEnabled(store.state.settings.sound)

  // ── 四季 ──
  let season = null
  const applySeason = () => {
    const next = SEASONS[params.get('season')] ? params.get('season') : seasonOf(store.today)
    if (next === season) return
    season = next
    scene?.setSeason(season)
    const el = document.getElementById('dateSeason')
    el.textContent = `${SEASONS[season].name} · ${SEASONS[season].jp}`
    el.dataset.season = season
  }
  applySeason()
  store.on('dateChanged', applySeason)
  // App 開著跨到新的一週：等一下再給回顧卡
  store.on('dateChanged', () => setTimeout(() => ui.maybeShowWeekCard(), 3000))

  // ── UI 掛鉤 ──
  const hooks = {
    // 小島：App 模式開機時還沒建，ui.setAppMode(false) 會先等 ensureIsland() 建好再換畫面
    islandReady: () => !!scene,
    ensureIsland: () => ensureIsland(),
    // 只動小島上的東西（擺放、標示、鏡頭）：還沒有小島就沒有東西可動（商店和「在島上查看」都會先切回小島）
    startPlacing: (key) => scene?.startPlacing(key),
    hoverTask: (id) => scene?.hoverTask(id),
    hoverEvent: (id) => scene?.hoverEvent(id),
    hoverProject: (id) => scene?.hoverProject(id),
    focusTask: (id) => scene?.focusTask(id),
    focusEvent: (id) => scene?.focusEvent(id),
    focusProject: (id) => scene?.focusProject(id),
    // ひより町的建築卡片：還沒開張的就看看它會浮出來的地方
    focusTown: (key) => scene?.focusTown(key),
    focusProjectTown: () => scene?.focusProjectTown(),
    resetView: () => (ui.appMode ? ui.setAppMode(false) : scene?.resetView()),
    // 切換 App 模式：進 App 時先離開小木屋；回小島時正在專注、兩人已經在屋裡，就直接進屋陪讀
    appModeChanged: (on, opts) => scene?.appModeChanged(on, opts),
    // App 模式全螢幕計時上的「到小木屋」：切回小島，兩人會走進屋裡（已經在屋裡就直接進屋）
    goCabin: () => ui.setAppMode(false),
    // 專注頁的貓咪被摸了
    catPoke: () => sfx.squish(),
    reviewOpened: () => talk('reviewAsk', {}, 4200, '今天過得怎麼樣？'),
    modalClosed: () => scene?.modalClosed(),
    setSound: (on) => sfx.setEnabled(on),
    // 省電和畫質只跟小島有關：小島建好時會照設定套上
    setPowerSave: (on) => scene?.setPowerSave(on),
    setQuality: (q) => scene?.setQuality(q),
    setTheme: (t) => (scene ? scene.setTheme(t) : syncNight(lookNight())),
    // 現在幾點（網址帶 ?hour= 時用那個）
    hourNow: () => (scene ? scene.hour() : clockHour()),
    // 卡關提醒：nudge 是第一次看到卡關小卡（n：挪了幾次或逾期幾天），其他是按了哪個選項
    stuck: (kind, t, n) => {
      const task = short(t.title)
      if (kind === 'nudge') talk('stuck', { task, n }, 6000, `「${task}」好像卡住了，拆小一點好嗎？`, 'fuji')
      else if (kind === 'split') {
        talk('stuckSplit', { task }, 5000, '拆好了，先做第一步就好。', 'fuji')
        setTimeout(() => talk('stuckSplit', { task }, 4200, '', 'mochi'), 2200)
      } else if (kind === 'later') talk('stuckLater', { task }, 4600, '明天再看，現在先歇歇吧。', 'fuji')
      else if (kind === 'drop') talk('stuckDrop', { task }, 4600, '先放下了，鬆一口氣吧。', 'fuji')
    },
    // 專注以番茄鐘為準：小島只負責兩人進出小木屋、花圃標記；獎勵和台詞在這裡，沒有小島也照常
    // info：{ round, rounds, free, projectId }，連續幾輪的第幾輪、是不是正向計時、目標是不是直接選了專案
    focusStarted: (resumed, taskId, info = {}) => {
      scene?.focusStarted(resumed, taskId)
      if (!resumed) {
        sfx.chime()
        const t = taskId && store.state.tasks.find((x) => x.id === taskId)
        const p = !t && info.projectId && store.state.projects.find((x) => x.id === info.projectId)
        if (info.round > 1) talk('focusRound', { round: info.round, rounds: info.rounds })
        else if (t || p) talk('focusTask', { task: short(t ? t.title : p.name) })
        else if (info.free) talk('focusFree', {}, undefined, '', 'fuji')
        else if (!duet('focusStart')) talk('focusStart')
      }
    },
    focusTaskChanged: (taskId, projectId = null) => {
      scene?.focusTaskChanged(taskId)
      const t = taskId && store.state.tasks.find((x) => x.id === taskId)
      const p = !t && projectId && store.state.projects.find((x) => x.id === projectId)
      if ((t || p) && ui.focus.mode === 'focus') talk('focusTask', { task: short(t ? t.title : p.name) })
    },
    focusFinished: (minutes, taskId, info = {}) => {
      // 同一輪另一個分頁已經記過了：這邊不再記、也不再放天燈
      if (store.completePomodoro(minutes, taskId, info.projectId, info.sid) === false) return scene?.focusStopped()
      sfx.temple()
      // 兩人出屋、天燈從小木屋屋頂升起；目標是專案的話，那棟房子泛起一圈光
      scene?.focusFinished(taskId, info.projectId)
      const multi = info.rounds > 1
      if (multi && info.last) talk('focusRoundsDone', { rounds: info.rounds })
      else if (!duet('focusEnd')) talk('focusEnd')
      const t = taskId && store.state.tasks.find((x) => x.id === taskId)
      const p = !t && info.projectId && store.state.projects.find((x) => x.id === info.projectId)
      const rest = multi && !info.last ? `休息 ${info.breakMin} 分鐘後接著第 ${info.round + 1} 輪` : '接著休息一下吧'
      const title = multi ? (info.last ? `${info.rounds} 輪都完成了，放一盞天燈` : `第 ${info.round}/${info.rounds} 輪完成`) : '專注完成，放一盞天燈'
      const sub = t ? `「${short(t.title, 10)}」長大了一點` : p ? `「${short(p.name, 10)}」+${minutes} 分鐘` : `+${minutes} 分鐘`
      ui.toast({ icon: '灯', title, sub: `${sub}・${rest}` })
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
      scene?.focusStopped()
      say('fuji', '沒關係，下次再一起專注。')
    },
    // 計時結束很久以後才回來（關掉頁面、手機鎖著）：不照全長記進今天
    focusExpired: (wasFocus) => {
      scene?.focusStopped()
      ui.toast(
        wasFocus
          ? { icon: '時', title: '上一輪專注沒有記進去', sub: '計時結束一個多小時後才回來，不確定那段時間在不在專注。下次結束時回來看一下就會記好' }
          : { icon: '風', title: '休息早就結束了', sub: '準備好了就再開始一輪吧' },
      )
    },
    // 另一個分頁結束或停掉了計時：兩人走出小木屋就好（台詞、天燈那一邊已經放過了）
    focusSynced: () => scene?.focusStopped(),
  }
  const ui = new UI(store, hooks)
  chatter = (who, text, ms) => ui.chatter(who, text, ms)

  // ── 夜晚切換深色玻璃 ──
  // 有小島時跟著天空的顏色走（小島每幀呼叫），還沒有就照時間和外觀設定算；回傳這次有沒有換
  let isNight = null
  const syncNight = (night) => {
    const on = isNight ? night > 0.45 : night > 0.55
    if (on === isNight) return false
    isNight = on
    document.body.classList.toggle('night', on)
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', on ? '#283667' : '#cfe8f6')
    ui.renderTheme()
    return true
  }
  syncNight(lookNight())

  // ── 遊戲事件 → 音效、通知、台詞（島上的演出在 islandScene.js）──
  // 花圃上有這朵花（看的那天的花圃）：完成任務時才有慶祝
  const inGarden = (t) => store.gardenTasks(store.selectedDate).some((x) => x.id === t.id)
  // 一個操作可能連發好幾次 change（一口氣領好幾個獎勵、同步拉回後補算）：同一輪只重畫一次
  let renderQueued = false
  store.on('change', () => {
    if (renderQueued) return
    renderQueued = true
    queueMicrotask(() => {
      renderQueued = false
      ui.render()
    })
  })
  store.on('itemPlaced', ({ item }) => {
    sfx.plant()
    talk('shopPlace', { item: item.name }, undefined, `${item.name}擺好了！`)
  })
  store.on('itemMoved', () => sfx.pop())
  store.on('itemStored', ({ item, refund }) => {
    sfx.undo()
    ui.toast({ icon: '糖', title: `收起了${item?.name || '裝飾'}`, sub: `退還 ${refund} 顆金平糖` })
  })
  store.on('reviewSaved', ({ first }) => {
    sfx.chime()
    const who = talk('reviewDone', {}, 4200, '謝謝你告訴我今天的事。')
    if (first) scene?.headBurst(who, { colors: ['#ffffff', '#fff1b8', '#d9ccff'], count: 30, speed: 1.4 })
  })
  store.on('shopPoor', () => talk('shopPoor', {}, undefined, '金平糖還不太夠，慢慢來就好。'))
  store.on('taskAdded', (t) => {
    if (inGarden(t)) sfx.plant()
  })
  store.on('taskDone', (t) => {
    if (!inGarden(t)) return
    sfx.bloom(t.priority)
    talk(t.star ? 'starDone' : t.priority === 3 ? 'highTaskDone' : 'taskDone', { task: short(t.title) })
  })

  // ── 花の図鑑：新品種或稀有的花 ──
  store.on('flower', ({ flower, isNew }) => {
    const r = RARITIES[flower.rarity]
    const rare = flower.rarity === 'rare' || flower.rarity === 'legend'
    setTimeout(() => {
      if (rare) sfx.chime()
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
    if (item) {
      ui.toast({ icon: '週', title: `拿到每週限定「${item.name}」`, sub: '到商店可以免費擺一件', ms: 5600 })
      talk('weeklyClaimed', { item: item.name }, 4200, `${item.name}，這週的小紀念。`)
    } else ui.toast({ icon: '週', title: '每週挑戰完成', sub: '限定擺飾都收齊了，改送 40 顆金平糖' })
  })

  // ── もち和ふじ共同的好感度 ──
  store.on('bondUp', (lv) => {
    const r = lv.reward
    const sub = r?.outfit ? `解鎖衣裝「${outfitOf(r.outfit)?.name}」，到紀錄頁換上吧` : r?.act ? `新動作「${BOND_ACTS[r.act]?.name}」：${BOND_ACTS[r.act]?.desc}` : ''
    setTimeout(() => {
      sfx.chime()
      ui.toast({ icon: '絆', title: `もちとふじの絆 Lv.${lv.level}「${lv.name}」`, sub, ms: 6000 })
      if (!duet('bondUp', { level: lv.level })) talk('bondUp', { level: lv.level }, 4000, '我們更熟了一點。')
    }, 1800)
  })
  store.on('gift', ({ coins }) => {
    setTimeout(() => {
      sfx.chime()
      ui.toast({ icon: '糖', title: `ふじ送你 ${coins} 顆金平糖`, sub: '每天第一次來看她們都有' })
      talk('gift', { coins }, 3800, `${coins} 顆金平糖，給你。`)
    }, 7000)
  })
  store.on('outfit', ({ who } = {}) => talk('outfit', {}, 3200, '好看嗎？', who === 'fuji' ? 'fuji' : 'mochi'))

  // ── 專案期限 ──
  store.on('projectOnTime', (p) => {
    setTimeout(() => {
      sfx.chime()
      ui.toast({ icon: '町', title: `「${short(p.name, 12)}」準時落成`, sub: `在期限前完成・額外 +${XP.onTime} XP` })
      talk('onTime', { project: short(p.name) }, 4200, '在期限前落成了。')
    }, 2600)
  })

  // ── 逾期的花、お守り ──
  store.on('revive', () => setTimeout(() => talk('revive', {}, 3800, '晚一點也沒關係，花開了。'), 1200))
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

  // ── 存檔 ──
  // 存不進去（多半是瀏覽器空間滿了）：畫面上的資料還在，但重新整理就會不見，要讓使用者知道
  const saveFailedToast = () =>
    ui.toast({ icon: '存', title: '資料存不進去', sub: '瀏覽器的儲存空間可能滿了。先別關掉頁面，到「紀錄」的設定裡「匯出資料」存一份', ms: 15000 })
  store.on('saveFailed', saveFailedToast)
  store.on('saveRecovered', () => ui.toast({ icon: '存', title: '又存得進去了', sub: '剛才的變更都已經存好' }))
  // 另一個分頁已經更新成新版：這個分頁還是舊的程式，再存下去會洗掉新版的資料
  const newerToast = () =>
    ui.toast({ icon: '新', title: '這個分頁的 App 比較舊', sub: '另一個分頁已經更新到新版。重新整理這一頁再繼續，這裡的變更先不會存', ms: 15000 })
  store.on('newerApp', newerToast)

  // ── 本命 ──
  store.on('starPicked', (t) => {
    sfx.chime()
    talk('starPick', { task: short(t.title) }, undefined, `「${short(t.title)}」是今天的本命。`)
  })
  store.on('starFull', () => {
    ui.toast({ icon: '★', title: `本命已經選滿 ${MAX_STARS} 件`, sub: '先取消其中一件，再選這件' })
    talk('starFull', {}, undefined, '三件就好，太多會累的。')
  })
  store.on('starAll', () => {
    setTimeout(() => {
      sfx.fanfare()
      ui.toast({ icon: '★', title: '本命全清', sub: `最重要的三件事都完成了・+${XP.starAll} XP` })
      talk('starAll', {}, 4200, '最重要的三件，全部完成了。')
    }, 1100)
  })
  store.on('tired', ({ count }) => {
    ui.toast({ icon: '茶', title: `今天已經完成 ${count} 件了`, sub: `超過 ${SOFT_CAP} 件後任務 XP 減半，記得休息一下`, ms: 5200 })
    setTimeout(() => talk('tired', {}, 4200, '今天開了好多花，剩下的慢慢來。'), 1600)
  })
  store.on('taskUndone', (t) => {
    sfx.undo()
    // 長期任務取消完成：從那天的任務回到專案裡，說一聲它去哪了（在專案頁上看得到就不用說）
    if (t?.ongoing && ui.tab !== 'projects') {
      const p = store.state.projects.find((x) => x.id === t.project)
      ui.toast({ icon: '長', title: `回到${p ? `「${p.name}」` : '專案'}的長期任務`, sub: t.title })
    }
  })
  store.on('routineAdded', (r) => {
    talk('routine', {}, undefined, '以後我會記得幫你準備好。')
    ui.toast({ icon: '↻', title: `已設為例行${r.kind === 'task' ? '任務' : '日程'}`, sub: `「${short(r.title, 12)}」・${repeatLabel(r.repeat)}` })
  })
  store.on('allDone', () => {
    setTimeout(() => {
      sfx.fanfare()
      if (!duet('allDone')) talk('allDone', {}, 4200)
    }, 900)
  })
  store.on('eventDone', () => {
    sfx.chime()
    talk('eventDone')
  })
  store.on('milestoneDone', ({ project }) => {
    sfx.build()
    talk('milestone', { project: short(project.name) })
  })
  store.on('projectDone', (p) => {
    setTimeout(() => {
      sfx.fanfare()
      talk('projectDone', { project: short(p.name) }, 4500)
      // 小島還沒建的話看資料：分到已開放的地，就有房子
      const house = scene ? scene.hasHouse(p.id) : p.slot >= 0 && p.slot < lotsAt(store.state.town.plevel)
      ui.toast({ icon: '町', title: `「${short(p.name, 12)}」落成！`, sub: `${house ? '專案町的房子蓋好了' : '所有里程碑都完成了'}，+${XP.project} XP` })
    }, 1100)
  })
  store.on('levelUp', ({ level }) => {
    const unlock = UNLOCKS.find((u) => u.level === level)
    setTimeout(() => {
      sfx.levelUp()
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
    const who = talk('questDone')
    scene?.headBurst(who, { colors: ['#fff1b8', '#ffd1dc', '#ffffff'], count: 30, speed: 1.4 })
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
  })
  // ふじ排好了計畫：ふじ說明、もち在旁邊加油
  store.on('coachApplied', ({ count, days }) => {
    sfx.chime()
    talk('coachApplied', { count, days }, 4600, '排好了，照自己的步調來。', 'fuji')
    setTimeout(() => talk('coachApplied', { count }, 4200, '', 'mochi'), 2400)
  })
  store.on('coachUndone', ({ count }) => talk('coachUndo', { count }, 4200, '撤銷了，想換個排法再告訴我。', 'fuji'))
  store.on('mottoAdded', (m) => talk('mottoAdded', { text: short(m.text, 24) }, 4600, '記下了，我會時不時提醒你。', 'fuji'))
  store.on('dateAdded', (d) => talk('dateAdded', { title: short(d.title), n: d.days }, 4600, '記好了，我陪你留意。', 'fuji'))
  store.on('sleepLogged', ({ date, min, first }) => {
    if (date !== store.today || !first) return
    talk(min < 360 ? 'sleepShort' : 'sleepGood', { hours: Math.round(min / 6) / 10 }, 4200)
  })
  store.on('habitDone', ({ habit, streak }) => {
    sfx.bloom(2)
    talk('habitDone', { habit: short(habit.name), streak }, 3800)
  })
  store.on('habitAll', () => {
    setTimeout(() => {
      sfx.fanfare()
      ui.toast({ icon: '習', title: '今天的養成習慣全部完成', sub: `+${XP.habitAll} XP・一起收好今天的小累積` })
      if (!duet('habitAll')) talk('habitAll', {}, 4200)
    }, 900)
  })
  store.on('urgeResisted', ({ habit, days }) => {
    sfx.pop()
    talk('urgeResisted', { habit: short(habit.name), days }, 3800)
  })
  store.on('habitSlip', ({ habit, days }) => talk('habitSlip', { habit: short(habit.name), days }, 5200, '沒關係，我會陪你慢慢來。'))
  store.on('quitMilestone', ({ habit, days, xp }) => {
    setTimeout(() => {
      sfx.fanfare()
      ui.toast({ icon: '断', title: `「${short(habit.name, 10)}」戒除滿 ${days} 天`, sub: xp ? `走到一個里程碑了・+${XP.quitMilestone} XP` : '又走回這個里程碑了，慢慢來', ms: 5200 })
      if (!duet('quitMilestone', { habit: short(habit.name), days })) talk('quitMilestone', { habit: short(habit.name), days }, 4800)
    }, 1200)
  })
  store.on('lifeLogged', ({ item, count }) => {
    sfx.pop()
    // 不要每筆都說話：第一筆之後每 3 筆說一次
    if (count === 1 || count % 3 === 0) talk('lifeLogged', { kind: lifeKindOf(item.kind).label }, 3400)
  })
  // 專案進度：每個專案每天第一則說一句，之後安靜記下
  store.on('projectLogged', ({ project, first }) => {
    sfx.pop()
    if (first) talk('projectLog', { project: short(project.name) }, 3800)
  })

  // ── ひより町、專案町長大 ──
  // 有小島時由小島排隊演出（鏡頭飛過去、蓋起來，演到那裡才通知）；還沒有小島就直接通知，之後建小島時照最新的樣子蓋
  const notice = {
    townGrow: ({ key, stage, found }) => {
      const b = buildingOf(key)
      ui.toast({
        icon: b.icon,
        title: found ? `ひより町：${b.name}開張了` : `${b.name}長成了「${b.stages[stage - 1]}」`,
        sub: found ? `${b.stages[0]}・${b.feature}越多，它會一路長大` : `${stage} / 5 階・${b.feature}讓它一路長大`,
        ms: 5600,
      })
      ui.renderTown()
    },
    townMoveIn: ({ key }) => {
      const info = RESIDENTS[key]
      ui.toast({ icon: '居', title: `${info.name}搬進了ひより町`, sub: `${info.animal}・${info.role}`, ms: 5600 })
      ui.renderTown()
    },
    islandGrew: () => ui.toast({ icon: '島', title: '小島變大了', sub: '外圈多出一圈地，時之環和ひより町也跟著往外移', ms: 5600 }),
    projectTownGrew: ({ level, added, demand }) => {
      const town = store.projectTown
      ui.toast({
        icon: '町',
        title: demand ? `專案町擴建到 Lv.${level}` : `專案町長到 Lv.${level}`,
        sub: demand
          ? `專案變多了，多開 ${added} 塊地，每個專案都有房子`
          : `多了 ${added} 塊地${town.next == null ? '・街道全部鋪好了' : `・再 ${town.next - town.points} 點升下一級`}`,
        ms: 5600,
      })
      ui.render()
    },
  }
  store.on('townGrow', (g) => !scene && notice.townGrow({ ...g, found: !g.from }))
  store.on('townMoveIn', (m) => !scene && notice.townMoveIn(m))
  store.on('projectTownGrew', (g) => {
    if (scene) return
    if (g.island) notice.islandGrew()
    notice.projectTownGrew(g)
  })
  // 舊存檔第一次打開：小島已經照累積的紀錄長成小鎮了（兩人的招呼在小島上）
  store.on('townWelcome', (t) => {
    setTimeout(() => {
      sfx.chime()
      ui.toast({ icon: '町', title: `小島長成了「${t.title}」`, sub: `ひより町 ${t.rank} / ${t.max}・到紀錄頁看看每一間店`, ms: 6400 })
    }, 8200)
  })

  // ── 提醒：日程、排進時段的任務、就寢 ──
  const reminders = new Reminders(store, (e, min, kind = 'event') => {
    // 重要日子：前一天ふじ提醒，當天もち也來打氣
    // 里程碑期限：一樣前一天ふじ提醒、當天もち打氣；說得出還差幾個細項
    if (kind === 'date' && e.pid) {
      const today = min === 0
      const v = { title: short(e.title), project: short(e.projectName) }
      sfx.chime()
      talk(today ? 'msToday' : 'msDue', v, 6000, '', 'fuji')
      if (today) setTimeout(() => talk('msToday', v, 5000, '', 'mochi'), 2600)
      const title = `里程碑「${e.title}」${today ? '今天' : '明天'}到期`
      const left = e.steps ? `細項還差 ${e.steps - e.stepsDone} 個` : today ? '做到哪裡都好，也可以改期限' : '今天先推一小步吧'
      ui.toast({ icon: DUE_KINDS.milestone.kanji, title, sub: `${e.projectName}・${left}`, ms: 9000 })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${title}`, e.projectName, e.id)
      return
    }
    if (kind === 'date') {
      const today = min === 0
      sfx.chime()
      talk(today ? 'dateToday' : 'dateSoon', { title: short(e.title) }, 6000, '', 'fuji')
      if (today) setTimeout(() => talk('dateToday', { title: short(e.title) }, 5000, '', 'mochi'), 2600)
      const title = today ? `今天是「${e.title}」` : `明天就是「${e.title}」`
      ui.toast({ icon: DATE_KINDS[e.kind]?.kanji || '旗', title, sub: today ? '照自己的步調來就好' : '今天先留點時間準備吧', ms: 9000 })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${title}`, '', e.id)
      return
    }
    // 整天的日程：前一天、當天早上ふじ提醒
    if (kind === 'allday') {
      const today = min === 0
      sfx.chime()
      talk(today ? 'allDayToday' : 'allDaySoon', { title: short(e.title) }, 6000, '', 'fuji')
      const title = `${today ? '今天' : '明天'}整天：${e.title}`
      const multi = e.endDate && e.endDate !== e.date
      const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`
      const sub = multi ? `${md(e.date)}–${md(e.endDate)}・共 ${daysBetween(e.date, e.endDate) + 1} 天` : today ? '其他事少排一點也沒關係' : '記得先準備一下'
      ui.toast({ icon: '日', title, sub, ms: 9000 })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${title}`, multi ? sub : '', e.id)
      return
    }
    // 訂閱扣款：照訂閱設的天數提前，ふじ提醒；免費試用要結束時問一聲還要不要繼續
    if (kind === 'sub') {
      const s = e.sub
      const when = min === 0 ? '今天' : min === 1 ? '明天' : `${min} 天後`
      const price = fmtMoney(s.price, s.cur)
      sfx.chime()
      talk(e.trial ? 'trialEnd' : min === 0 ? 'subToday' : 'subSoon', { title: short(s.name), when, price }, 6000, '', 'fuji')
      const title = e.trial ? `「${s.name}」的免費試用${when}結束` : `「${s.name}」${when}扣款`
      const sub = e.trial ? `之後${cycleLabel(s)} ${price}・不想繼續的話記得先取消` : `${price}・${cycleLabel(s)}${s.pay ? `・${s.pay}` : ''}`
      ui.toast({ icon: SUB_CATS[s.cat]?.kanji || '訂', title, sub, ms: 9000 })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${title}`, sub, `sub-${s.id}`)
      return
    }
    // 警語：もち或ふじ念一句你寫給自己的話。專注中不打擾（下一輪再說）
    if (kind === 'motto') {
      if (ui.focus.mode === 'focus') return
      sfx.chime()
      // 頭上的泡泡放不下太長的句子：念前面一段，完整的在提示卡上
      talk('motto', { text: short(e.text, 28) }, 7000, `「${short(e.text, 28)}」`, pick(['mochi', 'fuji']))
      ui.toast({ icon: '戒', title: e.text, sub: '寫給自己的警語', ms: 9000 })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify('ひより · 給自己的警語', e.text, 'motto')
      return
    }
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
    const text = min > 0 ? line('reminder', { event: short(e.title), min }, 'fuji') : `「${short(e.title)}」開始囉。`
    say('fuji', text || `${short(e.title)}，${when}`, 6000)
    ui.toast({ icon: kind === 'task' ? '時' : '鐘', title: e.title, sub: kind === 'task' ? `排定的任務・${when}` : when, ms: 9000 })
    if (kind === 'event' && store.selectedDate === store.today) scene?.pulseEvent(e.id)
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
    // 先跨日再提醒：剛過午夜（或睡眠喚醒）時才不會拿昨天的日期算重要日子
    const rolled = store.tick()
    reminders.check()
    // 還沒有小島：天色照時間算（傍晚自然換深色玻璃）
    if (!scene) syncNight(lookNight())
    if (rolled) return
    const minute = Math.floor(Date.now() / 60000)
    if (minute !== lastMin) {
      lastMin = minute
      // 日程頁沒在看就不重畫（切過去時會重畫）
      if (store.selectedDate === store.today && ui.tab === 'schedule') ui.renderSchedule(false)
      if (!scene?.placing && ui.focus.mode !== 'focus') ui.maybeAskReview()
    }
  }, 1000)
  ui.tickClock()

  // ── 小島 ──
  // 第一次要看小島時才下載、建立，之後一直用同一個。照最新的資料建：建好之前發生的事
  // 小島不補演（例如ひより町長大已經直接通知過了），蓋出來的就是現在的樣子
  let islandP = null
  let started = false
  // 小島用到的檔案（three.js、場景、模型、貼圖）請 Service Worker 收進快取：第一次打開 App 時它可能還沒接手，
  // 這些檔案沒經過它，不說的話下次離線就打不開小島。已經載完的先送，之後才載完的（慢的模型、貼圖）載完一個送一個
  let keeping = false
  const keepOffline = () => {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD || keeping) return
    keeping = true
    const dir = new URL('assets/', location.href).href
    const send = (entries) => {
      const urls = entries.map((e) => e.name).filter((u) => u.startsWith(dir))
      if (urls.length) navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'keep', urls }))
    }
    send(performance.getEntriesByType('resource'))
    try {
      new PerformanceObserver((list) => send(list.getEntries())).observe({ type: 'resource' })
    } catch {}
  }
  const ensureIsland = () =>
    (islandP ??= loadIsland()
      .then((m) =>
        m.createIsland({
          store, ui, params, talk, duet, notice, syncNight,
          season: () => season,
          started: () => (started = true),
          attach: (s) => {
            scene = s
            Object.assign(window.hiyori, s.debug)
          },
        }),
      )
      .then((s) => {
        keepOffline()
        return s
      })
      .catch((err) => {
        console.warn('[hiyori] 小島載入失敗', err)
        // 還沒開始建（多半是離線、下載失敗）：之後可以再按一次「小島」重試
        if (!started) {
          islandMod = null
          islandP = null
          throw err
        }
        // 建到一半才失敗（多半是程式或顯示卡的問題）：同一頁再建一次只會重複綁事件，請使用者重新整理
        throw Object.assign(new Error('小島建到一半失敗', { cause: err }), { reload: true })
      }))

  // 方便除錯：在 console 用 hiyori.store；小島建好後還有 hiyori.sky.hourOverride = 20、hiyori.world…
  window.hiyori = { store, ui, fileSync, cloudSync, ensureIsland }

  // ── PWA：正式版註冊 Service Worker（開發時不註冊，避免快取干擾） ──
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[hiyori] SW 註冊失敗', e))
  }
  // 開著的時候部署了新版：新的 Service Worker 接手後清掉了舊版的檔案，伺服器上也換成新的了，
  // 這個舊頁面第一次要載入的畫面（切回小島、日曆…）會找不到。重新整理一次換成新版；
  // 離線時不試（那是真的連不上），30 秒內也只試一次，免得一直重新整理
  // 存檔沒寫進去（空間滿了）或手上有打到一半的字時不自動重新整理：留一顆按鈕，讓使用者收好再按
  let updateAsked = false
  const askUpdate = (saved) => {
    if (updateAsked) return
    updateAsked = true
    ui.toast({
      icon: '新', title: '有新版本了', ms: 30000,
      sub: saved ? '手上還有沒打完的字，收好再按「重新整理」' : '這次的變更沒能存進去（空間可能滿了），先到「紀錄」匯出備份再重新整理',
      action: { label: '重新整理', run: () => { store.flushSave(); location.reload() } },
    })
  }
  addEventListener('vite:preloadError', (e) => {
    if (!navigator.onLine) return
    let last = 0
    try {
      last = Number(sessionStorage.getItem(RELOADED_KEY)) || 0
    } catch {}
    if (Date.now() - last < 30000) return
    // 載入失敗的那幾處看到這個就不再叫人「連上網路」
    if (e.payload) e.payload.updating = true
    const safe = () => store.flushSave() !== false && !ui.hasDraft()
    if (updateAsked || !safe()) return askUpdate(store.flushSave() !== false)
    try {
      sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
    } catch {}
    ui.toast({ icon: '新', title: '有新版本了', sub: '重新整理一下，換上新版…' })
    // 等的這一下又開始打字：改成問
    setTimeout(() => (safe() ? location.reload() : askUpdate(store.flushSave() !== false)), 1200)
  })
  // 請瀏覽器在空間吃緊時不要清掉這個網站的資料（iPhone 沒加到主畫面時，Safari 也可能把太久沒開的網站資料清掉）。
  // Chrome 系和安裝成 App 時不會跳出詢問，開機就請；其他瀏覽器（Safari 一般分頁、Firefox 會跳出權限詢問）
  // 等到第一次動手加了自己的東西（不只範例）時才請，只請一次：那時正在操作，詢問也看得懂是為了什麼
  if (navigator.storage?.persist) {
    const ask = () => navigator.storage.persisted().then((on) => on || navigator.storage.persist()).catch(() => {})
    let asked = false
    try {
      asked = !!localStorage.getItem(PERSIST_KEY)
    } catch {}
    if (navigator.userAgentData || matchMedia('(display-mode: standalone)').matches) ask()
    else if (!asked) {
      const mine = () => {
        const s = store.state
        return s.tasks.length + s.events.length + s.projects.length + s.habits.length > store.sampleCount()
      }
      const off = store.on('dirty', () => {
        if (!mine()) return
        off()
        try {
          localStorage.setItem(PERSIST_KEY, '1')
        } catch {}
        ask()
      })
    }
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

  // ── 開場 ──
  ui.render()
  // 小島模式：小島建好才拿掉載入畫面；建不起來（離線又沒快取、瀏覽器不支援 WebGL）就先用 App 模式，之後還能再按「小島」
  if (!ui.appMode) {
    try {
      await ensureIsland()
    } catch (err) {
      ui.setAppMode(true, { save: false })
      if (!err?.updating) ui.toast({ icon: '島', title: '小島沒有載入成功', sub: err.reload ? '先用 App 模式；重新整理頁面再試一次' : '先用 App 模式；連上網路再按「小島」試試', ms: 7000 })
    }
  }
  store.flushPending()
  // 原本的存檔讀不進來，換成了範例島：原文另外留著（hiyori-rescue），有開同步的話會從雲端拉回來
  if (store.loadFailed) {
    const sub = store.loadFailed.rescued
      ? '原本的檔案另外留了一份，沒有刪掉（紀錄頁的設定裡可以下載）。有開同步的話，會自動從雲端拉回來'
      : '有開同步的話，會自動從雲端拉回來；沒有的話先別在這台新增資料'
    ui.toast({ icon: '！', title: '原本的存檔讀不進來', sub, ms: 15000 })
  }
  // 開場前就存不進去、讀到新版 App 存的資料（事件那時還沒人聽）
  else if (store.newerApp) newerToast()
  else if (store.saveError) saveFailedToast()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const loader = document.getElementById('loader')
      loader.classList.add('done')
      // 淡出後整個拿掉：只藏起來的話，もち跳跳的無限動畫會在背後一直跑
      setTimeout(() => loader.remove(), 1000)
      setTimeout(() => {
        const g = greetKey()
        const h = hooks.hourNow()
        const night = scene ? scene.night() : lookNight()
        const skyDiffers = night > 0.5 !== nightAt(((h % 24) + 24) % 24) > 0.5
        const avoid = skyDiffers ? SKY_WORDS : null
        if (!(g === 'greet.morning' && !avoid && Math.random() < 0.5 && duet('morning'))) talk(g, {}, 3800, '', undefined, avoid)
        scene?.greet()
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
  // 開場忙完再把月曆、教練、專案詳情載好；載過的檔案（含之後才載的）都請 Service Worker 收進離線快取
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2000))
  idle(() => ui.preloadViews().then(keepOffline), { timeout: 8000 })
}

boot()
