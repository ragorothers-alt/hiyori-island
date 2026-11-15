import './styles.css'
import { Store, toMin, minToHHMM, repeatLabel, daysBetween, addDays, dateStr } from './store.js'
import { UI, savedAppMode } from './ui.js'
import { SEASONS, seasonOf } from './scene/season.js'
import { lotsAt } from './data/projectTown.js'
import { sfx } from './audio.js'
import { Reminders, systemNotify, notifyPermission } from './reminders.js'
import { TimerPush, MottoPush, MOTTO_PUSH_MAX, timerNotice, timerTag, answerLooking, takeNoticeAct } from './push.js'
import { native, showLiveTimer, nativeMottos, sendMottos, nativeMottoHandled, nativeMottoClaim, nativeMottoSeen, nativeTakeAct, nativeAway, nativeBack, nativeAwayLocked } from './native.js'
import { planKey, pauseOf, pauseText, pauseUntil, planUntil, MOTTO_LATE, eventQuiet, inQuiet } from './mottos.js'
import { order as doFirst } from './brief.js'
import { SUB_CATS, cycleLabel, fmtMoney } from './subs.js'
import { FileSync } from './sync.js'
import { CloudSync, codeFromHash } from './cloud.js'
import { DUETS } from './data/lines.js'
import { UNLOCKS, XP, MAX_STARS, SOFT_CAP, DATE_KINDS, DUE_KINDS, tagOf } from './theme.js'
import { burst, floatText, petalRain, tapPoint, trackTaps, calmMotion } from './ui/motion.js'
import { haptic } from './ui/haptics.js'
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
  // 開著過了一天：貓咪說新的一天的摘要，一週回顧等摘要關掉再出來
  store.on('dateChanged', () =>
    setTimeout(() => {
      ui.maybeShowBrief()
      ui.afterBrief(() => ui.maybeShowWeekCard())
    }, 3000),
  )
  // 在背景打開的、鎖著過了一天的：回到 App 時才說
  document.addEventListener('visibilitychange', () => {
    // 離開時記下時間、回來時抄下來：摘要的「你不在的時候」從那裡算起
    if (document.hidden) return ui.markSeen(true)
    ui.returned()
    setTimeout(() => ui.maybeShowBrief(), 400)
  })
  addEventListener('pagehide', () => ui.markSeen(true))

  // ── 計時器到點的通知 ──
  // 頁面睡著時（手機鎖著、切到別的 App）靠伺服器到點推一則（push.js）；頁面醒著但沒在看時自己發。
  // 同一次到點只響一次：伺服器排上了就交給它，等幾秒還沒來（伺服器或網路出狀況）頁面才自己發
  const notifyOn = () => store.state.settings.notify && notifyPermission() === 'granted'
  // 警語的推播（網頁版）：離開頁面時把接下來的時間交給伺服器，頁面關掉、手機鎖著也照時間通知（Android 殼用手機的鬧鐘）
  const mottoPush = native ? null : new MottoPush({ enabled: notifyOn })
  // 警語交給別人排了嗎（頁面在背景時不用自己發）：新版的 Android 殼、開了系統通知；網頁開了通知、訂閱了推播
  const mottoExternal = () => (mottoPush ? mottoPush.ready() : nativeMottos() && notifyOn())
  // 現在該做的那一件：今天還沒做完的任務裡，本命、重要的、排了時間早的在前（跟今日摘要一樣）
  const nowTask = () => doFirst(store.tasksOn(store.today))[0] || null
  const mottoBody = (text, task) => (task ? `${text}\n現在該做：${task.title}` : text)
  // 日程中先不提醒（開會、上課）：從今天到交給手機的那一串排到的那天（就寢在午夜後的話是後天凌晨），
  // 有時段的日程變成那幾段時間。設定裡可以關
  const eventsQuiet = (now = Date.now()) => {
    if (store.state.settings.mottoEvents === false) return []
    const to = dateStr(new Date(planUntil(store.state.rhythm, now)))
    const out = []
    for (let d = dateStr(new Date(now)), k = 0; d <= to && k < 4; d = addDays(d, 1), k++) out.push(...eventQuiet(store.eventsOn(d), d))
    return out
  }
  // 警語通知上的按鈕（跟 public/sw.js 的 mottoActions、Android 殼的 MottoNotice 一樣）：有現在該做的那一件才有「開始專注」。
  // 按了打開 App，由下面的 doAct 去做
  const mottoActions = (task) => [...(task ? [{ action: 'focus', title: '▶ 開始專注' }] : []), { action: 'pause', title: '先停 1 小時' }]
  // 把警語的那一串交給手機／伺服器（下面「警語交給別人排」那一段接上）：改了設定、開始專注時馬上叫一次，
  // 不等下一秒的檢查（剛改完就離開 App 的話頁面會睡著，手機上留著的還是舊的那一串）
  let syncMottos = () => {}
  // 這一輪到點時還在別的 App 裡（Android）：算一次中途離開，回傳有沒有算（下面「專注中離開 App」那一段接上）
  let awayAtEnd = () => false
  const timerPush = new TimerPush({
    enabled: notifyOn,
    // 推播排得上了（剛訂閱）：警語那邊也重新看一次有沒有訂閱
    onState: () => {
      setTimeout(() => ui.renderRemind())
      mottoPush?.check().then(() => syncMottos())
    },
    // 關掉通知、退訂之前：伺服器上排著的警語跟著取消
    beforeOff: (sub) => mottoPush?.off(sub),
  })
  mottoPush?.init().then(() => syncMottos())
  const timerNotify = (b) => {
    // Android 殼：到點由手機的鬧鐘發（native.js），這邊不用再發一次
    if (native || !b.at || !notifyOn()) return
    const n = timerNotice(b)
    const show = () => {
      if (notifyOn() && (document.hidden || !document.hasFocus())) systemNotify(n.title, n.body, timerTag(b.at))
    }
    if (!timerPush.covers(b.at)) return show()
    setTimeout(async () => {
      if (!(await timerPush.shown(b.at))) show()
    }, 8000)
  }
  // 上次沒排上（開始計時時剛好沒網路）：連上線、回到 App 時再試
  addEventListener('online', () => {
    timerPush.retry()
    mottoPush?.retry()
  })
  // 推播送到時 Service Worker 會問「正看著 App 嗎」：醒著的頁面回答（凍住的回不了，通知就留著）
  answerLooking()
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    timerPush.retry()
    // 在別的地方（系統設定、另一個分頁）關掉了通知、退訂了：回來時重新看一次
    mottoPush?.check()
    // 設定裡「上一則到點通知」、警語卡上的「上一則推播」：剛剛鎖著時可能送來了幾則
    ui.renderRemind()
    // 是按了通知上的按鈕回來的（通常 hiyori-native-act、Service Worker 的訊息會先到，這裡是保險）
    takeNativeAct()
    takeSwAct()
  })

  // ── 按了警語通知上的按鈕：打開 App，照著做 ──
  // focus：開始專注現在該做的那一件（通知上寫的那件已經做完的話，換成現在排在最前面的）；pause：先停 1 小時。
  // 手機的 App：殼記著按了哪一顆（takeAct）；瀏覽器：Service Worker 把按了哪一顆留在快取裡（takeNoticeAct），
  // 叫出開著的視窗時也直接傳過來。不認網址上的參數：別的網站連過來就能替你按，不行
  // at：那一則提醒排在幾點（回神紀錄用它認出同一則、記在那一天；手機的 App 不知道是 0）
  const doAct = (act, at = 0) => {
    // 頁面凍住時過了午夜：先換到今天，才不會開始專注昨天的那一件
    store.tick()
    if (act !== 'pause' && act !== 'focus') return
    // 回神紀錄：按了通知上的按鈕，就是看到了這一則提醒（頁面的提示卡已經算過的那一則不再算）
    if (act === 'pause') {
      store.mottoNudged(at)
      if (store.state.settings.mottoEvery > 0) store.pauseMottos(pauseUntil('hour', store.state.rhythm, Date.now()))
      return
    }
    const t = ui.focus.mode === 'focus' ? null : nowTask()
    if (!t) store.mottoNudged(at)
    if (ui.focus.mode === 'focus') return ui.toast({ icon: '戒', title: '已經在專注了', sub: '這一輪結束再說' })
    if (!t) return ui.toast({ icon: '戒', title: '今天的任務都做完了', sub: '想做什麼的話，再加一件吧' })
    store.mottoAnswered('back', at)
    ui.focus.startWith(t.id)
  }
  // 開機還沒好之前按的先記著，開場時做
  let booted = false
  let bootAct = null
  const runAct = (act, at = 0) => {
    if (booted) doAct(act, at)
    else bootAct = { act, at }
  }
  const takeNativeAct = () => {
    const a = nativeTakeAct()
    if (a) runAct(a)
  }
  // Service Worker 留下的：同一次按的（id）只做一次（傳過來的和快取裡的可能都拿得到）
  const actsDone = new Set()
  // slot：那一則提醒排在幾點（通知帶著的；回神紀錄用）
  const swAct = (r) => {
    if (!r || actsDone.has(r.id)) return
    actsDone.add(r.id)
    runAct(r.act, r.slot)
  }
  const takeSwAct = () => takeNoticeAct().then(swAct)
  addEventListener('hiyori-native-act', takeNativeAct)
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type !== 'hiyori-act') return
    // 快取裡那一份也拿掉（之後開機不會再做一次）
    takeNoticeAct(e.data.id)
    swAct({ id: String(e.data.id || ''), act: String(e.data.act || ''), slot: Number(e.data.slot) > 0 ? Number(e.data.slot) : 0 })
  })

  // ── UI 掛鉤 ──
  const hooks = {
    // 計時的狀態變了：b 是下一次到點的時間和狀況（沒在計時、暫停中是 null），到點的推播跟著重排
    focusPlan: (b) => {
      timerPush.plan(b && timerNotice(b))
      // 專注中那一段不提醒：交給手機的那一串跟著重排
      syncMottos()
    },
    // Android 殼：專注、休息中在狀態列和鎖定畫面顯示即時倒數，到點由手機自己通知
    focusLive: (l, b) => showLiveTimer(l, b && timerNotice(b)),
    push: timerPush,
    // 警語交給伺服器推（網頁版）：警語卡上寫「頁面關掉也會通知」、上一則推播幾點送到
    mottoPush,
    // 設定裡的「試一則」：10 秒後由伺服器推過來。計時中不試（一台裝置同時只排一則，會把這一輪的蓋掉）
    pushTest: async () => {
      if (ui.focus.mode !== 'idle') return 'busy'
      await timerPush.plan({ at: Date.now() + 10000, title: 'ひより · 試一則通知', body: '收到了：專注到點時就會像這樣通知你' })
      return timerPush.state
    },
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
    // 自己切換白天／夜晚。小島模式跟著小島的天空慢慢轉過去；App 模式看不到小島，馬上淡淡地換過去
    // （小島載過的話天空在後面自己轉，轉完之前不被它拉回原本那一邊：skySync）
    setTheme: (t) => {
      scene?.setTheme(t)
      if (scene && !ui.appMode) return
      if (syncNight(lookNight(), true) && scene) skyLag = true
    },
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
    // 好久沒碰的長期任務：第一次看到那張小卡時ふじ說一句（一天一次）
    idle: (t, n) => talk('idleLong', { task: short(t.title), n }, 6000, `「${short(t.title)}」${n} 天沒碰了，今天碰一下就好。`, 'fuji'),
    // 專注以番茄鐘為準：小島只負責兩人進出小木屋、花圃標記；獎勵和台詞在這裡，沒有小島也照常
    // info：{ round, rounds, free, projectId }，連續幾輪的第幾輪、是不是正向計時、目標是不是直接選了專案
    focusStarted: (resumed, taskId, info = {}) => {
      scene?.focusStarted(resumed, taskId)
      if (!resumed) {
        // 上一段留下的提示卡（延長、再加一輪、再來一輪）：已經開始了，收掉。
        // （resumed 是開機時接回計時、另一個分頁開始的：開機那時畫面還沒建好，也沒有提示卡要收）
        // 休息完自動接下一輪的不收：「休息結束，第 N 輪開始了」那一張才剛放上去
        if (info.ext || !(info.round > 1)) ui.dropToasts('focus')
        sfx.chime()
        // 休息完自動接下一輪：剛剛「休息結束」已經震過了，這裡再震會把那一段截斷
        if (info.ext || !(info.round > 1)) haptic('tick')
        const t = taskId && store.state.tasks.find((x) => x.id === taskId)
        const p = !t && info.projectId && store.state.projects.find((x) => x.id === info.projectId)
        // 加時：倒數到點了還沒做完，接著做（只做 5 分鐘到點了、說要接著做下去的也是）
        if (info.ext) info.small ? talk('focusSmallMore', {}, undefined, '好，接著做下去！做完按「做完了」就好。') : say('mochi', '還差一點點對吧，我們陪你做完。')
        else if (info.round > 1) talk('focusRound', { round: info.round, rounds: info.rounds })
        // 只做 5 分鐘：開個頭就好
        else if (info.small) talk('focusSmall', { task: short(t ? t.title : p ? p.name : '這件事') }, undefined, '先做 5 分鐘就好，我陪你。')
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
      // 休息時可以按的：還沒做完就延長（從到點那時接著正計時）；設定的輪數都做完了，還想繼續就再加一輪
      // 專注頁開著的時候頁面上就有這兩顆，提示卡只說一聲，不再放一次（不然會蓋住計時）。
      // 專注時先記下了別的事：「看記下的 N 件」到今日總覽決定什麼時候做
      const parked = store.state.parked.length
      // 這一輪中途切去用別的 App 幾次（Android 的 App 才分得出來；到點時還在別的 App 裡的也算一次）
      const away = (info.away || 0) + (awayAtEnd(info.sid) ? 1 : 0)
      const awayNote = away ? `・中途離開 ${away} 次` : ''
      const more = () => [
        ...(ui.focus.bigOpen
          ? []
          : [
              ...(ui.focus.canExtend ? [{ label: '還沒做完，延長', run: () => ui.focus.extend() }] : []),
              ...(ui.focus.canAddRound ? [{ label: '再加一輪', soft: true, run: () => ui.focus.addRound() }] : []),
            ]),
        ...(parked ? [{ label: `看記下的 ${parked} 件`, soft: true, run: () => ui.openParked() }] : []),
      ]
      // 加時做完：多做的分鐘記進去（不多算一顆番茄）；不到 1 分鐘就不另外記
      if (info.ext) {
        if (minutes < 1 || store.completePomodoro(minutes, taskId, info.projectId, info.sid, { extra: true }) === false) {
          scene?.focusStopped()
          if (minutes < 1) ui.toast({ icon: '灯', title: '加時不到 1 分鐘', sub: '沒有另外記，接著休息一下吧', tag: 'focus', ms: 9000, actions: more() })
          return
        }
        sfx.temple()
        haptic('end')
        if (info.at) timerNotify({ at: info.at, mode: 'focus', up: true, focusMin: minutes, breakMin: info.breakMin, round: info.round, rounds: info.rounds, target: info.target })
        scene?.focusFinished(taskId, info.projectId)
        talk('focusEnd')
        const next = info.rounds > 1 && !info.last ? `休息 ${info.breakMin} 分鐘後接著第 ${info.round + 1} 輪` : '接著休息一下吧'
        ui.toast({ icon: '灯', title: `多做了 ${minutes} 分鐘，也記進去了`, sub: next + awayNote, ms: 9000, actions: more(), tag: 'focus' })
        return
      }
      // 同一輪另一個分頁已經記過了：這邊不再記、也不再放天燈
      if (store.completePomodoro(minutes, taskId, info.projectId, info.sid) === false) return scene?.focusStopped()
      sfx.temple()
      haptic('end')
      // 推播沒排上、沒送到時頁面自己補發：跟伺服器那邊同一套字（只做 5 分鐘的寫「5 分鐘到了」）
      timerNotify({ at: info.at, mode: 'focus', up: info.free, focusMin: minutes, breakMin: info.breakMin, round: info.round, rounds: info.rounds, target: info.target, small: !!info.small })
      // 兩人出屋、天燈從小木屋屋頂升起；目標是專案的話，那棟房子泛起一圈光
      scene?.focusFinished(taskId, info.projectId)
      const t = taskId && store.state.tasks.find((x) => x.id === taskId)
      const p = !t && info.projectId && store.state.projects.find((x) => x.id === info.projectId)
      // 只做 5 分鐘到點了：開了頭就不難了，問要不要接著做下去（從到點那一刻往上數），不想就照常休息
      if (info.small) {
        talk('focusSmallEnd', {}, 6000, '你看，開始了就做得到！要不要接著做？')
        const what = t ? `「${short(t.title, 10)}」` : p ? `「${short(p.name, 10)}」` : ''
        ui.toast({
          icon: '灯', title: `${minutes} 分鐘到了，開了頭就不難了`, sub: `${what}+${minutes} 分鐘・要接著做嗎？${awayNote}`, tag: 'focus', ms: 15000,
          actions: [
            ...(ui.focus.bigOpen ? [] : [...(ui.focus.canExtend ? [{ label: '繼續做下去', run: () => ui.focus.extend() }] : []), { label: '休息一下', soft: true, run: () => {} }]),
            ...(parked ? [{ label: `看記下的 ${parked} 件`, soft: true, run: () => ui.openParked() }] : []),
          ],
        })
        return
      }
      const multi = info.rounds > 1
      if (multi && info.last) talk('focusRoundsDone', { rounds: info.rounds })
      else if (!duet('focusEnd')) talk('focusEnd')
      const rest = multi && !info.last ? `休息 ${info.breakMin} 分鐘後接著第 ${info.round + 1} 輪` : '接著休息一下吧'
      const title = multi ? (info.last ? `${info.rounds} 輪都完成了，放一盞天燈` : `第 ${info.round}/${info.rounds} 輪完成`) : '專注完成，放一盞天燈'
      const sub = t ? `「${short(t.title, 10)}」長大了一點` : p ? `「${short(p.name, 10)}」+${minutes} 分鐘` : `+${minutes} 分鐘`
      // 專注的是專案裡的任務（例如一首練習曲）：趁還記得，直接接到那件的紀錄（練到哪、卡在哪、速度）
      const log = !!t?.project && store.state.projects.some((x) => x.id === t.project)
      const actions = [...more(), ...(log ? [{ label: '寫紀錄', soft: true, run: () => ui.openTaskLog(t.id) }] : [])]
      ui.toast({ icon: '灯', title, sub: `${sub}・${rest}${awayNote}`, ...(actions.length ? { ms: 12000, actions } : {}), tag: 'focus' })
    },
    // 最後一輪的休息中又加了一輪
    roundAdded: ({ next }) => {
      sfx.chime()
      ui.toast({ icon: '輪', title: '加了一輪', sub: `休息完接著第 ${next} 輪`, tag: 'focus' })
    },
    // next：還有下一輪時是 { next, rounds }，計時器接著會自己開始下一輪（台詞交給 focusStarted）
    breakFinished: (next, at = null) => {
      sfx.chime()
      haptic('end')
      timerNotify({ at, mode: 'break', round: next ? next.next - 1 : 1, rounds: next ? next.rounds : 1 })
      if (next) {
        ui.toast({ icon: '風', title: '休息結束', sub: `第 ${next.next}/${next.rounds} 輪開始了`, tag: 'focus' })
        return
      }
      talk('breakEnd')
      // 還想繼續：照剛才的長度和目標直接再來一輪
      ui.toast({ icon: '風', title: '休息結束', sub: '準備好了就再開始一輪吧', ms: 12000, tag: 'focus', actions: [{ label: '再來一輪', run: () => ui.focus.again() }] })
    },
    focusStopped: () => {
      ui.dropToasts('focus')
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
  // fade：自己切換的（設定、Dock 的切換鈕）才淡淡地換過去
  const syncNight = (night, fade = false) => {
    const on = isNight ? night > 0.45 : night > 0.55
    if (on === isNight) return false
    const first = isNight === null
    isNight = on
    const flip = () => {
      document.body.classList.toggle('night', on)
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', on ? '#283667' : '#cfe8f6')
      ui.renderTheme()
    }
    // App 模式看不到小島（小島的天空自己會慢慢變）：自己切換白天和夜晚時，整個畫面淡淡地換過去，不要一下子整片變色。
    // 轉場的那一下整頁點不到東西（View Transitions 的規定）：所以只在剛按了切換時用、而且很短；傍晚自動換的直接換，
    // 不會在使用者正在按別的東西時突然吃掉一下
    if (fade && !first && ui.appMode && document.visibilityState === 'visible' && document.startViewTransition && !calmMotion()) document.startViewTransition(flip)
    else flip()
    return true
  }
  syncNight(lookNight())
  // 小島推過來的天色（每一幀；App 模式蓋住小島時每半秒）。App 模式剛自己切換過、天空還在快轉時先不跟：
  // 天空要轉一兩秒才到另一邊，跟著它的話畫面會先被拉回原本那一邊、過一下又換過去。
  // 快轉途中回到小島模式就不再攔：看得到天空了，玻璃照天空現在的顏色走
  let skyLag = false
  const skySync = (night) => {
    if (skyLag && ui.appMode && scene?.skyShifting) return false
    skyLag = false
    return syncNight(night)
  }

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
  // 打勾的那一下：花瓣從剛按的那顆勾爆開（本命和高優先度大一點）。
  // App 模式看不到小島，經驗值也從剛按的地方冒出來（小島模式在島上冒，islandScene.js）
  trackTaps()
  // iPhone 的 Safari：頁面上要有 touchstart 的監聽，手指按著按鈕時 :active 的樣子（縮一下）才會出來
  document.addEventListener('touchstart', () => {}, { passive: true })
  // 這一下是手指還是滑鼠：按下去縮一下只給手指（styles.css 的 [data-input="touch"]）。
  // 滑鼠按著時按鈕縮小，在邊緣按下、原地放開會落在按鈕外面，那一下就不算按到
  addEventListener('pointerdown', (e) => (document.documentElement.dataset.input = e.pointerType), true)
  // 用鍵盤按的（空白鍵、Enter）也不縮：剛剛用手指點過、接著換成鍵盤時，不沿用上一下的手指
  addEventListener(
    'keydown',
    (e) => {
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) document.documentElement.dataset.input = 'key'
    },
    true,
  )
  store.on('taskDone', (t) => {
    haptic(t.star ? 'star' : 'done')
    const c = tagOf(t.tag).color
    burst(tapPoint(), t.star ? ['#ffd76e', '#fff3c4', c, '#ffffff'] : [c, '#ffe1ea', '#ffffff', c], { big: t.star || t.priority === 3 })
  })
  store.on('xp', ({ amount, kind }) => {
    if (!ui.appMode || !(amount > 0)) return
    floatText(tapPoint(), `+${amount} XP`, { gold: kind === 'star' || kind === 'starAll' || kind === 'perfect' })
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
    haptic('tick')
    talk('starPick', { task: short(t.title) }, undefined, `「${short(t.title)}」是今天的本命。`)
  })
  // 明天先做的那一件挑好了（今日總覽的卡片）：ふじ記下來
  store.on('firstPicked', (t) => {
    sfx.chime()
    haptic('tick')
    const when = t.date === store.today ? '起床後' : t.date === addDays(store.today, 1) ? '明天' : '那天'
    talk('firstPick', { task: short(t.title), when }, undefined, `記下了：${when}先從「${short(t.title)}」開始。`, 'fuji')
  })
  store.on('starFull', () => {
    haptic('warn')
    ui.toast({ icon: '★', title: `本命已經選滿 ${MAX_STARS} 件`, sub: '先取消其中一件，再選這件' })
    talk('starFull', {}, undefined, '三件就好，太多會累的。')
  })
  store.on('starAll', () => {
    setTimeout(() => {
      sfx.fanfare()
      haptic('party')
      if (ui.appMode) petalRain({ count: 22, colors: ['#ffd76e', '#fff3c4', '#f6c453', '#ffe9a8', '#ffffff'] })
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
    haptic('soft')
    // 長期任務取消完成：從那天的任務回到專案裡，說一聲它去哪了（在專案頁上看得到就不用說）
    if (t?.ongoing && ui.tab !== 'projects') {
      const p = store.state.projects.find((x) => x.id === t.project)
      ui.toast({ icon: '長', title: `回到${p ? `「${p.name}」` : '專案'}的長期任務`, sub: t.title })
    }
  })
  // 練習曲第一次練到目標速度
  store.on('tempoReached', ({ task, bpm }) => {
    sfx.chime()
    // 單位不是節拍器速度（頁、公里…）時換個說法
    const u = task.tempo?.unit || ''
    ui.toast({ icon: u ? '達' : '速', title: u ? '到目標了' : '練到目標速度了', sub: `${short(task.title, 16)}・${u ? `${bpm} ${u}` : `♩${bpm}`}` })
  })
  store.on('routineAdded', (r) => {
    talk('routine', {}, undefined, '以後我會記得幫你準備好。')
    ui.toast({ icon: '↻', title: `已設為例行${r.kind === 'task' ? '任務' : '日程'}`, sub: `「${short(r.title, 12)}」・${repeatLabel(r.repeat)}` })
  })
  store.on('allDone', () => {
    setTimeout(() => {
      sfx.fanfare()
      haptic('party')
      // 小島上兩人會出來慶祝；App 模式看不到小島，飄一陣花瓣
      if (ui.appMode) petalRain()
      if (!duet('allDone')) talk('allDone', {}, 4200)
    }, 900)
  })
  store.on('eventDone', () => {
    sfx.chime()
    haptic('done')
    talk('eventDone')
  })
  store.on('milestoneDone', ({ project }) => {
    sfx.build()
    haptic('done')
    talk('milestone', { project: short(project.name) })
  })
  store.on('projectDone', (p) => {
    setTimeout(() => {
      sfx.fanfare()
      haptic('party')
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
      haptic('party')
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
  // 警語先停一下／恢復：ふじ說一聲；提示卡上馬上可以恢復（按錯了也回得去）
  store.on('mottoPause', (until) => {
    const now = Date.now()
    // 下一句幾點（停的那段跳過了一則的話，就是停完的那一刻）
    const next = reminders.mottoPlan(now, { quiet: eventsQuiet(now) })[0]
    const when = next ? `下一句 ${pauseText(next.at, now)}` : ''
    if (until) {
      const time = pauseText(until, now)
      talk('mottoPause', { time }, 6000, `好，先停到 ${time}。`, 'fuji')
      ui.toast({
        icon: '戒',
        title: `警語先停到 ${time}`,
        sub: when ? `這段時間不提醒・${when}` : '這段時間不提醒',
        ms: 7000,
        tag: 'motto',
        actions: [{ label: '現在就恢復', soft: true, run: () => store.pauseMottos(0) }],
      })
      return
    }
    talk('mottoResume', {}, 5000, '好，提醒回來了。', 'fuji')
    ui.toast({ icon: '戒', title: '警語的提醒回來了', sub: when || '照原本的間隔提醒', tag: 'motto' })
  })
  // 專注時先記下了一件別的事：輕輕應一聲，回到正事
  store.on('parked', () => talk('parked', {}, 3200, '記下了，等一下再看。回到正事吧。'))
  store.on('dateAdded', (d) => talk('dateAdded', { title: short(d.title), n: d.days }, 4600, '記好了，我陪你留意。', 'fuji'))
  store.on('sleepLogged', ({ date, min, first }) => {
    if (date !== store.today || !first) return
    talk(min < 360 ? 'sleepShort' : 'sleepGood', { hours: Math.round(min / 6) / 10 }, 4200)
  })
  store.on('habitDone', ({ habit, streak }) => {
    sfx.bloom(2)
    haptic('done')
    talk('habitDone', { habit: short(habit.name), streak }, 3800)
  })
  store.on('habitAll', () => {
    setTimeout(() => {
      sfx.fanfare()
      haptic('party')
      ui.toast({ icon: '習', title: '今天的養成習慣全部完成', sub: `+${XP.habitAll} XP・一起收好今天的小累積` })
      if (!duet('habitAll')) talk('habitAll', {}, 4200)
    }, 900)
  })
  store.on('urgeResisted', ({ habit, days }) => {
    sfx.pop()
    haptic('tick')
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
  // 提示卡上的按鈕按下去時再找一次那件任務：卡片留著的時候可能做完了、刪掉了（不然會開始沒有目標的專注），
  // 或在別的分頁改了時間（at 給了的話，日期和時段要跟卡片上的一樣）。對不上就說一聲、什麼都不改
  const taskNow = (id, at = null) => {
    const cur = store.state.tasks.find((x) => x.id === id)
    if (!cur || cur.done) {
      ui.toast({ icon: '時', title: '這件已經做完，或不在了', ms: 3600 })
      return null
    }
    if (at && (cur.date !== at.date || cur.at !== at.start)) {
      ui.toast({ icon: '時', title: `「${short(cur.title, 12)}」的時間已經改過了`, sub: cur.at ? `現在排在 ${cur.at}` : '現在沒排時段', ms: 4200 })
      return null
    }
    return cur
  }
  const startTask = (id, fn) => () => {
    const cur = taskNow(id)
    if (cur) fn(cur.id)
  }
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
    // 警語：もち或ふじ念一句你寫給自己的話，提示卡上寫著現在該做的那一件（按一下就開始專注）。
    // 專注中不打擾（暫停中的不算；下一輪再說）
    if (kind === 'motto') {
      if (ui.focus.mode === 'focus' && ui.focus.paused == null) return
      // 日程中（開會、上課）到點的那一則：不念、不通知（交給手機、伺服器的那一串也沒排它）
      if (inQuiet(eventsQuiet(), e.at)) return
      const next = nowTask()
      sfx.chime()
      // 頭上的泡泡放不下太長的句子：念前面一段，完整的在提示卡上
      talk('motto', { text: short(e.text, 28) }, 7000, `「${short(e.text, 28)}」`, pick(['mochi', 'fuji']))
      // 按了提示卡上的按鈕就是看到了：Android 殼不用在離開 App 時再用通知發一次這一則
      const seen = (run) => () => {
        nativeMottoSeen()
        run()
      }
      // 回神紀錄：提醒了一次；按了哪一顆也記下來（週報的「警語回神」）。e.at 是這一則排在幾點：
      // 頁面自己發的系統通知也帶著它，按了通知上的按鈕時認得出是同一則，不會再算一次
      store.mottoNudged(e.at)
      const back = (run) => seen(() => {
        store.mottoAnswered('back', e.at)
        run()
      })
      ui.toast({
        icon: '戒',
        title: e.text,
        sub: next ? `現在該做：${next.title}` : '寫給自己的警語',
        ms: 12000,
        tag: 'motto',
        actions: [
          ...(next && ui.focus.mode !== 'focus'
            ? [
                { label: '▶ 開始專注', run: back(() => ui.focus.startWith(next.id)) },
                // 提不起勁：先做 5 分鐘就好，到點時再決定要不要繼續
                { label: '只做 5 分鐘', soft: true, run: back(() => ui.focus.startSmall(next.id)) },
              ]
            : []),
          // 本來就在做正事：記一筆、誇一句
          {
            label: '✓ 在做了', soft: true,
            run: seen(() => {
              store.mottoAnswered('on', e.at)
              talk('mottoOnTask', {}, 4200, '很好，就照這樣做下去。')
            }),
          },
          // 開會、吃飯時：先停一小時（停完那一刻再提醒一次）
          { label: '先停 1 小時', soft: true, run: seen(() => store.pauseMottos(pauseUntil('hour', store.state.rhythm, Date.now()))) },
        ],
      })
      // 交給手機排了（Android 殼）：App 不在前面時由手機發，這邊只在畫面上念。
      // 網頁交給伺服器推的時候，頁面會念的是看得到頁面時（沒看著這個視窗就跳通知）、或在背景卻沒交上伺服器時
      if (!(native && mottoExternal()) && store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify('ひより · 給自己的警語', mottoBody(e.text, next), 'motto', { actions: mottoActions(next), data: { at: e.at } })
      return
    }
    if (kind === 'bed') {
      sfx.chime()
      talk('bedtime', { time: e.start }, 6000, '就寢時間快到了，今天辛苦了。')
      // 明天先做的那一件：挑好了就提一下，還沒挑的話提示卡上可以去挑
      const day = ui.firstPickDay()
      const first = day && store.firstOn(day)
      const word = day === store.today ? '起床後' : '明天'
      ui.toast({
        icon: '眠', title: '就寢時間快到了', sub: first ? `預定 ${e.start} 就寢・${word}先做「${short(first.title, 10)}」` : `預定 ${e.start} 就寢・今天辛苦了`, ms: day && !first ? 12000 : 9000,
        ...(day && !first ? { actions: [{ label: `挑${word}的第一件`, soft: true, run: () => ui.openFirst() }] } : {}),
      })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify('ひより · 就寢提醒', `預定 ${e.start} 就寢`, 'bedtime')
      return
    }
    // 排定的任務到了開始的時間：提示卡上直接開始專注（提不起勁就只做 5 分鐘、還沒準備好就晚 15 分鐘再提醒）。
    // 已經在專注這一件就不吵；正在專注別件的話可以換成這件
    if (kind === 'taskStart') {
      const t = store.state.tasks.find((x) => x.id === e.id)
      if (!t || t.done || (ui.focus.mode === 'focus' && ui.focus.taskId === t.id)) return
      sfx.reminder()
      talk('taskStart', { task: short(t.title) }, 6000, `「${short(t.title)}」排在現在，開始吧。`, 'fuji')
      const busy = ui.focus.mode === 'focus'
      // 晚 15 分鐘：從排的時間、或（提示卡留了一陣子才按）從現在起再過 15 分鐘。過了今天就不挪，請你明天再排。
      // 提示卡留著的時候時間在別的分頁改過了：不拿這張卡上的舊時間蓋回去
      const later = () => {
        const cur = taskNow(e.id, e)
        if (!cur) return
        const now = new Date()
        const nowMin = dateStr(now) === cur.date ? now.getHours() * 60 + now.getMinutes() : 1440
        const to = Math.max(toMin(cur.at), nowMin) + 15
        if (to >= 1440) return ui.toast({ icon: '時', title: '今天已經很晚了', sub: '明天再排一次吧', ms: 4200 })
        store.updateTask(cur.id, { at: minToHHMM(to) })
        ui.toast({ icon: '時', title: `「${short(cur.title, 12)}」改到 ${minToHHMM(to)}`, sub: '到時候再提醒你', ms: 4200 })
      }
      ui.toast({
        icon: '時', title: t.title, sub: `排在 ${e.start}・${busy ? '現在正在專注別件' : '現在開始吧'}`, ms: 15000, tag: `start-${t.id}`,
        actions: [
          ...(busy
            ? [{ label: '換成這件', run: startTask(e.id, (id) => ui.focus.startWith(id)) }]
            : [
                { label: '▶ 開始專注', run: startTask(e.id, (id) => ui.focus.startWith(id)) },
                { label: '只做 5 分鐘', soft: true, run: startTask(e.id, (id) => ui.focus.startSmall(id)) },
              ]),
          { label: '晚 15 分鐘', soft: true, run: later },
        ],
      })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${t.title}`, `排在 ${e.start}，現在開始吧`, t.id)
      return
    }
    sfx.reminder()
    const when = min > 0 ? `${min} 分鐘後開始（${e.start}）` : `現在開始（${e.start}）`
    // 看時間的是ふじ
    const text = min > 0 ? line('reminder', { event: short(e.title), min }, 'fuji') : `「${short(e.title)}」開始囉。`
    say('fuji', text || `${short(e.title)}，${when}`, 6000)
    // 排定的任務還沒到時間：想先開始也可以
    const early = kind === 'task' && ui.focus.mode !== 'focus' ? [{ label: '▶ 現在就開始', soft: true, run: startTask(e.id, (id) => ui.focus.startWith(id)) }] : []
    ui.toast({ icon: kind === 'task' ? '時' : '鐘', title: e.title, sub: kind === 'task' ? `排定的任務・${when}` : when, ms: early.length ? 12000 : 9000, ...(early.length ? { actions: early } : {}) })
    if (kind === 'event' && store.selectedDate === store.today) scene?.pulseEvent(e.id)
    if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${e.title}`, when, e.id)
  }, {
    // 警語交給手機、伺服器排時怎麼分工（見 reminders.js 的 _motto）
    external: () => mottoExternal(),
    hidden: (t) => (mottoPush ? mottoPush.defer(t, document.hidden) : document.hidden || nativeAway()),
    handled: () => (mottoPush ? mottoPush.done : nativeMottoHandled()),
    claim: (at) => (mottoPush ? mottoPush.claim(at) : nativeMottoClaim(at)),
  })

  // ── 專注中離開 App ──
  // 回來時說一聲還剩多久（離開 1 分鐘以上的；看一眼訊息就回來的不吵）。
  // Android 的 App 分得出「鎖著手機專心做事」和「切去用別的 App」：只有後者算一次中途離開（週報、到點的提示卡），
  // 離開 3 分鐘還沒回來時用通知叫你回來（syncMottos 排一則；那時手機鎖著就不發，見 MottoNotice）。
  // 網頁分不出鎖螢幕和切走，只在回來時說一聲。
  // awaySince／awaySid：這一次是幾點離開的、那時在專注的是哪一輪（沒離開是 0）。存在這台（hiyori-away）：
  // Android 在背景把 App 收掉、重新打開時（計時接得回來）也接得回來
  const AWAY_MIN = 60000
  const AWAY_NUDGE = 3 * 60000
  const AWAY_KEY = 'hiyori-away'
  let awaySince = 0
  let awaySid = ''
  try {
    const v = JSON.parse(localStorage.getItem(AWAY_KEY) || 'null')
    if (Number.isFinite(v?.since) && v.since > 0 && v.since <= Date.now() && typeof v.sid === 'string') [awaySince, awaySid] = [v.since, v.sid]
  } catch {}
  const setAway = (since, sid = '') => {
    if (!since) sid = ''
    if (awaySince === since && awaySid === sid) return
    awaySince = since
    awaySid = sid
    try {
      if (since) localStorage.setItem(AWAY_KEY, JSON.stringify({ since, sid }))
      else localStorage.removeItem(AWAY_KEY)
    } catch {}
  }
  const focusing = () => ui.focus.mode === 'focus' && ui.focus.paused == null
  // 頁面看不到了（切到別的分頁、別的 App、鎖螢幕）；Android 殼另外問手機 App 在不在前面（App 在背景時網頁可能還沒變成 hidden）
  const away = () => document.hidden || (native && nativeAway())
  const focusTarget = () => ui.focus.task?.title || ui.focus.project?.name || ''
  // 每一秒（syncMottos）跟著看：專注中離開了就記著是幾點（離開時沒在專注、下一輪在背景自己開始了，從那一輪開始的那一刻算）。
  // 離開時這一輪結束了（到點時還在別的 App 裡）：留著，到點的那一刻（awayAtEnd）算一次
  const trackAway = (gone) => {
    // 回到 App 時，剛到點的那一輪（休息中，sid 還是那一輪的）留給 awayAtEnd 算：到點的那一刻會先重排通知、才叫 focusFinished
    if (!gone) return ui.focus.mode === 'break' && awaySid === ui.focus.sid ? undefined : setAway(0)
    if (focusing() && awaySid !== ui.focus.sid) setAway(Date.now(), ui.focus.sid)
  }
  // 這一輪中途切去用別的 App 了嗎（Android 的 App 才分得出來）
  const leftApp = (since) => !!since && Date.now() - since >= AWAY_MIN && nativeAwayLocked() === false
  // 回到 App（頁面看得到了、重新打開）：離開 1 分鐘以上的說一聲還剩多久；切去用別的 App 的記一次中途離開
  const cameBack = () => {
    const since = awaySince
    if (!since) return
    const same = focusing() && awaySid === ui.focus.sid
    // 這一輪已經到點了（頁面在背景睡著、還沒換到休息）：留給到點的那一刻算（awayAtEnd），到點的提示卡會說
    if (same && !ui.focus.counting && ui.focus.left <= 0) return
    setAway(0)
    if (!same || Date.now() - since < AWAY_MIN) return
    if (leftApp(since)) {
      ui.focus.noteAway()
      store.focusLeft()
    }
    const t = focusTarget()
    const task = t ? `「${short(t)}」` : ''
    if (ui.focus.counting) {
      const mins = Math.max(1, Math.floor(ui.focus.elapsed / 60000))
      talk('focusBackUp', { task, mins }, 5200, `回來了。${task}已經做了 ${mins} 分鐘，接著做吧。`)
    } else {
      const left = Math.max(1, Math.ceil(ui.focus.left / 60000))
      talk('focusBack', { task, left }, 5200, `回來了。${task}還剩 ${left} 分鐘，接著做吧。`)
    }
  }
  // 離開：同一輪已經記著幾點離開的就不改（Android 的 App 在背景時先記下的那一刻比較準；關掉頁面時又會再收到一次）
  document.addEventListener('visibilitychange', () => (document.hidden ? trackAway(true) : cameBack()))
  // 重新打開時（Android 在背景把 App 收掉了）：接著算剛才那一次
  if (!document.hidden) cameBack()
  // 一輪專注結束（sid 是那一輪）：那時還在別的 App 裡的算一次中途離開，回傳有沒有算
  awayAtEnd = (sid) => {
    const since = awaySince
    const mine = !!since && awaySid === sid
    if (since) setAway(0)
    if (!mine || !leftApp(since)) return false
    store.focusLeft()
    return true
  }
  // 離開了 AWAY_NUDGE 還沒回來：通知叫你回來（一則；那時這一輪已經快結束的不用，到點的通知會叫你）。設定裡可以關
  const backItem = () => {
    if (!awaySince || !focusing() || awaySid !== ui.focus.sid || !nativeBack() || store.state.settings.awayNudge === false) return null
    const at = awaySince + AWAY_NUDGE
    const end = ui.focus.boundary?.at || 0
    if (!(end - at > 60000)) return null
    const t = focusTarget()
    const what = t ? `「${short(t, 16)}」` : ''
    const body = ui.focus.counting ? `${what}還在專注中，回來接著做吧` : `${what}還在專注中，還剩 ${Math.round((end - at) / 60000)} 分鐘。回來吧`
    return { at, title: 'ひより · 專注中', body, back: true }
  }

  // ── 警語交給別人排：App 關著、手機鎖著也照時間通知 ──
  // 排好接下來到明天就寢的每一則（幾點、念哪一句、現在該做哪一件）。專注中的那一段不排；剛到點、還沒人處理的那一則留著。
  //   Android 殼：整串交給手機，手機的鬧鐘一則一則發；App 在前面時手機不發，頁面自己念（離開 App 的那一刻還有到點沒念的，手機補發）
  //   網頁：字存在這台的快取裡，離開頁面時把時間交給伺服器（mottoPush.sync），伺服器到點推、Service Worker 顯示；看得到頁面時頁面自己念
  // 會影響排法的東西（planKey：設定、作息、警語、上次念到哪、專注、現在該做的那件、排到幾點）變了才重排。
  // 每秒看一次；改了資料、專注開始或結束、離開頁面時馬上看一次。leaving：頁面正要關掉（pagehide 時還不一定是 hidden）
  let mottoSig = ''
  let mottoItems = []
  syncMottos = (leaving = false) => {
    if (!mottoPush && !nativeMottos()) return
    const now = Date.now()
    const s = store.state
    const on = mottoExternal()
    const quietUntil = ui.focus.mode === 'focus' ? ui.focus.boundary?.at || 0 : 0
    // 剛寫下第一句、剛打開提醒：先定好從什麼時候開始算（不等下一秒的檢查），才排得出那一串
    if (on) reminders.startMotto(now)
    const task = on ? nowTask() : null
    // 專注中離開了：叫你回來的那一則排在最前面（它在這一輪結束前，警語都排在這一輪之後；back：通知上不放警語的按鈕）
    trackAway(away() || leaving)
    const back = on ? backItem() : null
    const quiet = on ? eventsQuiet(now) : []
    const sig = (on ? planKey({ every: s.settings.mottoEvery, rhythm: s.rhythm, mottos: s.mottos, last: reminders.mottoState(), quietUntil, pause: pauseOf(s.settings), quiet, task: task?.title, now }) : 'off') + (back ? `|back:${back.at}:${back.body}` : '')
    if (sig !== mottoSig) {
      const since = Math.max(now - MOTTO_LATE, mottoPush ? mottoPush.done : nativeMottoHandled())
      const max = mottoPush ? MOTTO_PUSH_MAX : undefined
      const items = on
        ? [
            ...(back ? [back] : []),
            ...reminders.mottoPlan(now, { quietUntil, quiet, since, ...(max ? { max } : {}) }).map((p) => ({ at: p.at, title: 'ひより · 給自己的警語', body: mottoBody(p.text, task), ...(task ? { focus: true } : {}) })),
          ].slice(0, max)
        : []
      if (mottoPush) {
        mottoItems = items
        mottoSig = sig
      } else if (sendMottos(items)) mottoSig = sig // 沒送到（例如殼剛好出錯）：下一秒再試
    }
    mottoPush?.sync(mottoItems, document.hidden || leaving, now)
  }
  store.on('dirty', () => syncMottos())
  document.addEventListener('visibilitychange', () => document.hidden && syncMottos())
  addEventListener('pagehide', () => syncMottos(true))

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
    // 開場還沒好（小島模式要等小島建好，載入畫面還蓋著）時先不提醒：提示卡會被蓋在載入畫面後面、到時間就收掉，
    // 等於沒看到，警語還會被當成念過了（手機那邊也不再發）。開場一好，下一秒就照常檢查
    if (booted) reminders.check()
    syncMottos()
    // 還沒有小島：天色照時間算（傍晚自然換深色玻璃）
    if (!scene) syncNight(lookNight())
    if (rolled) return
    const minute = Math.floor(Date.now() / 60000)
    if (minute !== lastMin) {
      lastMin = minute
      // 日程頁沒在看就不重畫（切過去時會重畫）
      if (store.selectedDate === store.today && ui.tab === 'schedule') ui.renderSchedule(false)
      if (!scene?.placing && ui.focus.mode !== 'focus') ui.maybeAskReview()
      ui.markSeen()
      // 晚上要挑明天先做的那一件：明天的例行公事先生成出來，才挑得到（例行公事只能刪不能改，刪的時候還沒做的會一起拿掉）
      const pickDay = ui.firstPickDay()
      if (pickDay && pickDay > store.today) store.prepareRoutines(pickDay)
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
          store, ui, params, talk, duet, notice, syncNight: skySync,
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
  // 從主畫面圖示長按的捷徑「快速記錄」打開（網址帶 ?add）：參數先拿掉（重新整理不會再跳一次），
  // 直接叫出快速記錄；今日摘要、回顧這些等它關掉以後再說。
  // 不等開場畫面淡出（下面那兩個畫格在慢的機器上要等一下）：畫面一出來就能打字
  if (new URLSearchParams(location.search).has('add')) {
    history.replaceState(history.state, '', location.pathname + location.hash)
    // 上次的專注還在跑（重新打開時全螢幕計時會先蓋上來）：縮小它，計時照走
    ui.focus.toggleBig(false)
    ui.openCapture()
  }
  // 按了警語通知上的按鈕打開的（瀏覽器：Service Worker 留在快取裡；手機的 App：殼記著）、開機途中按的：現在照著做。
  // 開始專注的話今日摘要就不出來（專注中不打擾；摘要等一下才出來，快取一下就讀到了）。
  // 讀快取不擋開場：機器忙的時候不要讓載入畫面多停
  takeNativeAct()
  booted = true
  if (bootAct) {
    const { act, at } = bootAct
    bootAct = null
    doAct(act, at)
  }
  takeSwAct()
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
        // 今天第一次打開：貓咪走進來說今日摘要（牠在說的時候兩人先不搶話）
        if (!(ui.maybeShowBrief() || ui.brief.open) && !(g === 'greet.morning' && !avoid && Math.random() < 0.5 && duet('morning'))) talk(g, {}, 3800, '', undefined, avoid)
        scene?.greet()
      }, 900)
      // 摘要還開著就等它關掉：回顧和提醒不要疊在上面
      setTimeout(() => ui.afterBrief(() => {
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
      }), 5600)
    }),
  )
  // 開場忙完再把月曆、教練、專案詳情載好；載過的檔案（含之後才載的）都請 Service Worker 收進離線快取
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2000))
  idle(() => ui.preloadViews().then(keepOffline), { timeout: 8000 })
}

boot()
