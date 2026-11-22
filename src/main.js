import './styles.css'
import { Store, toMin, minToHHMM, repeatLabel, daysBetween, addDays, dateStr, weekKey, newRev, rememberLook, SAVE_KEY } from './store.js'
import { UI, savedAppMode, FEEDBACK_URL } from './ui.js'
import { watchErrors, bootFailed } from './errors.js'
import { LATEST } from './data/latest.js'
import { SEASONS, seasonOf } from './scene/season.js'
import { lotsAt } from './data/projectTown.js'
import { sfx, noise } from './audio.js'
import { Reminders, systemNotify, closeNotify, notifyPermission } from './reminders.js'
import { TimerPush, MottoPush, MOTTO_PUSH_MAX, timerNotice, timerTag, answerLooking, takeNoticeAct, pushSupported } from './push.js'
import { native, deskWeb, showLiveTimer, nativeMottos, sendMottos, nativeMottoHandled, nativeMottoClaim, nativeMottoSeen, nativeTakeAct, nativeActAt, nativeShown, nativeAway, nativeBack, nativeAwayLocked, nativeFujiNotes, sendFujiNotes, nativeFujiNow, nativeReminders, sendReminders, nativeRemindPosted } from './native.js'
import { remindPlan } from './remindPlan.js'
import { planKey, pauseOf, pauseText, pauseUntil, pausedUntil, planUntil, MOTTO_LATE, eventQuiet, inQuiet, awakeAt, activeMottos, windowEnd } from './mottos.js'
import { order as doFirst, nextStep } from './brief.js'
import { SUB_CATS, cycleLabel, fmtMoney } from './subs.js'
import { FileSync } from './sync.js'
import { CloudSync, codeFromHash } from './cloud.js'
import { DUETS } from './data/lines.js'
import { UNLOCKS, XP, MAX_STARS, SOFT_CAP, DATE_KINDS, DUE_KINDS, tagOf, pullOf, goalText, minText } from './theme.js'
import { burst, floatText, petalRain, tapPoint, trackTaps, calmMotion } from './ui/motion.js'
import { haptic } from './ui/haptics.js'
import { RARITIES } from './data/flowers.js'
import { lifeKindOf } from './data/life.js'
import { taskDur, fmtDur, bedAt } from './planner.js'
import { BOND_ACTS, outfitOf } from './data/bond.js'
import { lookHour, nightAt, realHour, systemDark, daypart } from './daylight.js'
import { RESIDENTS, buildingOf } from './data/town.js'
import { pick, short, fill, line } from './voice.js'
import { createAgent } from './agentRunner.js'
import { dayWord } from './agent.js'
import { createRiskWatch } from './riskWatch.js'
import { planNotes, deviceId, notesHere } from './fujiNotes.js'
import { createCalendars } from './calendars.js'
import { AI_MODELS, aiModel, aiExtras, aiUnshared } from './ai.js'

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
  // 選了夜晚的話，載入畫面就先用深色，不要先閃一下白（index.html 開機時已經照 LOOK_KEY 先算過一次；這裡照存檔再算一次，順便記下來給下次開機）
  const theme = store.state.settings.theme
  rememberLook(theme)
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
  // 小島模式開機、小島還在背景建（islandWait 是陣列）：兩人頭上的話先留著（最後三句），建好再一句一句說（heldLines）；
  // 留太久（超過 20 秒）的就不說了，招呼、閒聊在這段時間被關掉的也不說
  let islandWait = null
  // 正在一句一句說留著的話（replay 是還沒說的那幾句）：這時新來的話排在後面，不插隊
  let replay = null
  const onScene = (key, fn) => {
    if (scene && !replay) return fn(scene)
    const line = { key, fn, at: Date.now() }
    if (replay) replay.push(line)
    else if (islandWait && !quiet(key)) islandWait = [...islandWait, line].slice(-5)
  }
  const CHAT_KEYS = /^(greet|morning)/
  // 說之前再看一次：換成 App 模式了（下方的對話框已經說過）、留太久了、招呼和閒聊被關掉了，就不說
  const stillSay = (x) =>
    !!scene && !document.body.classList.contains('app-mode') && Date.now() - x.at < 20000 && !(store.state.settings.chatOn === false && CHAT_KEYS.test(x.key))
  const playNext = () => {
    while (replay?.length && !stillSay(replay[0])) replay.shift()
    const x = replay?.shift()
    if (!x) return void (replay = null)
    x.fn(scene)
    setTimeout(playNext, 2800)
  }
  const heldLines = () => {
    replay = islandWait || []
    islandWait = null
    playNext()
  }
  // 直接說一句話（不挑台詞）
  const say = (who, text, ms) => {
    onScene('say', (s) => s.say(who, text, ms))
    chatter?.(who, text, ms)
  }
  // who：'mochi' 或 'fuji'；回傳說話的是誰
  const talk = (key, vars = {}, ms, fallback = '', who = voice(key), avoid = null) => {
    const text = line(key, vars, who, avoid) || fallback
    onScene(key, (s) => s.say(who, text, ms))
    if (!quiet(key)) chatter?.(who, text, ms)
    return who
  }
  // 兩人你一句我一句；pet 的對話用 self／other 代表被摸的那位和另一位
  const duet = (key, vars = {}, self = 'mochi') => {
    const list = DUETS?.[key]
    if (!list?.length) return false
    const other = self === 'mochi' ? 'fuji' : 'mochi'
    const lines = pick(list).map(([who, text]) => [who === 'self' ? self : who === 'other' ? other : who, fill(text, vars)])
    // 小島還在建、或正在一句一句說留著的話：拆成一句一句排進去（每一句說之前都再看一次，中途換成 App、關掉閒聊就停）
    if (scene && !replay) scene.duet(lines)
    else for (const [who, text] of lines) onScene(key, (s) => s.say(who, text, 3500))
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
  // 換日了：昨天晚上的回顧、上週的回顧卡那兩張提示卡收起來（按下去會記到新的一天）
  store.on('dateChanged', () => ['review', 'week'].forEach((tag) => ui.dropToasts(tag)))
  store.on('dateChanged', () =>
    setTimeout(() => {
      ui.maybeShowBrief()
      ui.afterBrief(() => askWeek())
    }, 3000),
  )
  // 在背景打開的、鎖著過了一天的：回到 App 時才說
  // shown：這個分頁現在看得到嗎（關掉時用：背景的分頁關掉不寫「還在看」）
  let shown = !document.hidden
  document.addEventListener('visibilitychange', () => {
    // 離開時記下時間、回來時抄下來：摘要的「你不在的時候」、回來時提醒現在該做從那裡算起
    if (document.hidden) {
      if (shown) ui.markSeen(true)
      shown = false
      return
    }
    shown = true
    ui.returned()
    setTimeout(() => ui.maybeShowBrief(), 400)
  })
  // 關掉分頁：看得到的才記（變成看不到時已經記過了；早就在背景的分頁關掉時不記，不會把其他分頁真正離開的時間洗掉）
  addEventListener('pagehide', () => shown && ui.markSeen(true))

  // ── 計時器到點的通知 ──
  // 頁面睡著時（手機鎖著、切到別的 App）靠伺服器到點推一則（push.js）；頁面醒著但沒在看時自己發。
  // 同一次到點只響一次：伺服器排上了就交給它，等幾秒還沒來（伺服器或網路出狀況）頁面才自己發
  const notifyOn = () => store.state.settings.notify && notifyPermission() === 'granted'
  // 警語的推播（網頁版）：離開頁面時把接下來的時間交給伺服器，頁面關掉、手機鎖著也照時間通知（Android 殼用手機的鬧鐘）
  const mottoPush = native ? null : new MottoPush({ enabled: notifyOn })
  // 警語交給別人排了嗎（頁面在背景時不用自己發）：新版的 Android 殼、開了系統通知；網頁開了通知、訂閱了推播
  const mottoExternal = () => (mottoPush ? mottoPush.ready() : nativeMottos() && notifyOn())
  // 現在該做的那一件：今天還沒做完的任務裡，本命、重要的、排了時間早的在前（跟今日摘要一樣）
  // 現在該做哪一件（範例不算：回來了、做完一件、警語上的「現在該做」都照這個）
  const nowTask = () => doFirst(store.tasksOn(store.today).filter((t) => !store.isSample(t)))[0] || null
  // 拆成了小步驟的話，下一步也寫上去（通知上一眼就知道從哪裡開始）
  const mottoBody = (text, task) => {
    const step = task && nextStep(task)
    return task ? `${text}\n現在該做：${task.title}${step ? `\n下一步：${step.title}` : ''}` : text
  }
  // 日程中先不提醒（開會、上課）：從今天到交給手機的那一串排到的那天（就寢在午夜後的話是後天凌晨），
  // 有時段的日程變成那幾段時間。設定裡可以關
  const eventsQuiet = (now = Date.now()) => {
    if (store.state.settings.mottoEvents === false) return []
    const to = dateStr(new Date(planUntil(store.state.rhythm, now)))
    const out = []
    // 明天以後還沒生成的例行日程（每天的晨會）也算：timedEventsOn
    for (let d = dateStr(new Date(now)), k = 0; d <= to && k < 4; d = addDays(d, 1), k++) out.push(...eventQuiet(store.timedEventsOn(d).filter((e) => !store.isSample(e)), d))
    return out
  }
  // ── 建議類的提示：回來了、下一件、卡關、好久沒碰、截止日的風險、晚上回顧、上週的回顧卡、要不要通知 ──
  // 時間到的提醒（日程、就寢、截止日當天…）、警語照自己的規則；ふじ做了什麼的提示卡、按了按鈕之後的回應不算。
  // 打字中、專注中不跳（wait 給了的話等停下來再說，等太久就算了）；兩則之間至少隔 SUGGEST_GAP，一天最多 SUGGEST_MAX 則；
  // 設定裡「建議和鼓勵」關掉就都不說。記在這台裝置（每台各自算）；瀏覽器空間滿了存不進去時記在記憶體
  const SUGGEST_GAP = 20 * 60000
  const SUGGEST_MAX = 6
  const SUGGEST_KEY = 'hiyori-suggest'
  let suggestMem = { day: '', n: 0, at: 0 }
  const suggestLog = () => {
    try {
      const v = JSON.parse(localStorage.getItem(SUGGEST_KEY) || 'null')
      // 兩邊取比較新的（記憶體裡的可能是存不進去的那幾次）
      if (v && typeof v.day === 'string' && Number.isFinite(v.n) && Number.isFinite(v.at)) return v.at >= suggestMem.at ? v : suggestMem
    } catch {}
    return suggestMem
  }
  // 最後一次在輸入框裡按鍵的時間；正在組字（注音、日文）；打過字的那幾格（本來就填好的、點進去沒改的不算在打字）
  let lastKey = 0
  let composing = false
  const typed = new WeakSet()
  addEventListener('keydown', (e) => e.target?.closest?.('input, textarea, [contenteditable]') && (lastKey = Date.now()), { capture: true })
  addEventListener('input', (e) => {
    lastKey = Date.now()
    if (e.target) typed.add(e.target)
  }, { capture: true })
  addEventListener('compositionstart', () => (composing = true), { capture: true })
  addEventListener('compositionend', () => {
    composing = false
    lastKey = Date.now()
  }, { capture: true })
  // 正在打字：焦點在輸入框裡，而且正在組字、幾秒內才按過鍵，或這一格打過字、還留著字（點進空的框就走開了、本來就填好的不算）
  const typing = () => {
    const a = document.activeElement
    if (!a?.closest?.('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]), textarea, [contenteditable]')) return false
    return composing || Date.now() - lastKey < 8000 || (typed.has(a) && !!String(a.value ?? a.textContent ?? '').trim())
  }
  const suggestBusy = () => typing() || ui.focus.mode === 'focus'
  // 開場好了、看得到頁面（Android 的 App 在前面）才說：在背景、載入畫面還蓋著時說了也沒人看到，還會用掉今天的則數
  let suggestReady = false
  const suggestSeen = () => suggestReady && !document.hidden && !(native && nativeAway())
  // 現在能說一則嗎（不管打字、專注；只看開關、間隔、今天的則數）
  const suggestRoom = (now = Date.now()) => {
    if (!store.nudge()) return false
    const m = suggestLog()
    const n = m.day === store.today ? m.n : 0
    return n < SUGGEST_MAX && Math.abs(now - m.at) >= SUGGEST_GAP
  }
  // 等著的那一則（一次只等一則，新的換掉舊的）
  let suggestHeld = null
  // show() 回傳 false 是說不出來了（那一件做完了、條件不成立）：不算一則。回傳有沒有說
  const suggest = (kind, show, wait = 0) => {
    if (!store.nudge() || !suggestSeen()) return false
    const now = Date.now()
    if (suggestBusy()) {
      if (wait) suggestHeld = { kind, show, until: now + wait }
      return false
    }
    if (!suggestRoom(now)) return false
    if (show() === false) return false
    if (suggestHeld?.kind === kind) suggestHeld = null
    const m = suggestLog()
    suggestMem = { day: store.today, n: (m.day === store.today ? m.n : 0) + 1, at: now }
    try {
      localStorage.setItem(SUGGEST_KEY, JSON.stringify(suggestMem))
    } catch {}
    return true
  }
  // 每秒看一次：停下來了（不在打字、沒在專注）就說等著的那一則；等太久的算了
  const suggestRetry = () => {
    const h = suggestHeld
    if (!h) return
    if (Date.now() > h.until) return (suggestHeld = null)
    if (suggestBusy()) return
    suggestHeld = null
    suggest(h.kind, h.show)
  }
  // 卡關、好久沒碰的那一句只是那張小卡的旁白：能說的時候才說，不佔間隔、不算則數
  const aside = (fn) => (store.nudge() && suggestSeen() && !suggestBusy() && suggestRoom() ? fn() : false)
  // 晚上回顧、上週的回顧卡：不再自己跳成對話框。總覽上放一張卡（晚上把今日反思移到最上面、新的一週放上週的回顧卡），
  // 再說一則提示（建議類的一則；回顧一天一次、回顧卡一週一次，說不出來的話之後每分鐘再看）
  const REVIEW_ASKED_KEY = 'hiyori-review-asked'
  const WEEK_ASKED_KEY = 'hiyori-week-asked'
  const askedOn = (key, v) => {
    try {
      return localStorage.getItem(key) === v
    } catch {
      return false
    }
  }
  const markAsked = (key, v) => {
    try {
      localStorage.setItem(key, v)
    } catch {}
  }
  const askReview = () => {
    const day = store.today
    if (askedOn(REVIEW_ASKED_KEY, day) || !ui.reviewDue()) return false
    return suggest('review', () => {
      if (ui._topLayer() || !ui.reviewDue()) return false
      markAsked(REVIEW_ASKED_KEY, store.today)
      ui.toast({
        icon: '筆', title: '今天過得怎麼樣？', sub: ui.appMode ? '在總覽的今日反思選個天氣、寫兩句就好' : '選個天氣、寫兩句就好', ms: 12000, tag: 'review',
        actions: [{ label: '寫回顧', run: () => ui.goReview() }, { label: '之後再說', soft: true, run: () => ui.reviewLater(day) }],
      })
    })
  }
  const askWeek = () => {
    const wk = weekKey(store.today)
    if (askedOn(WEEK_ASKED_KEY, wk) || !ui.weekDue()) return false
    return suggest('week', () => {
      if (ui._topLayer() || ui.brief.open || !ui.weekDue()) return false
      markAsked(WEEK_ASKED_KEY, wk)
      ui.toast({ icon: '週', title: '上週的回顧卡好了', sub: '做了多少、哪天最充實，總覽上也看得到', ms: 12000, tag: 'week', actions: [{ label: '看看', run: () => ui.openWeekCard() }] })
    })
  }
  // 寫著「現在該做」的提示卡（回來了、下一件、警語）同時只留一張：新的出來時收掉其他兩種。
  // 焦點在被收掉的那一張上：交給新的那一張的第一顆按鈕（不會掉到頁首）
  const NOW_TAGS = ['back', 'next', 'motto']
  const nowToast = (opts) => {
    const held = document.activeElement?.closest?.('.toast')
    const move = !!held && NOW_TAGS.includes(held.dataset.tag) && held.dataset.tag !== opts.tag
    for (const tag of NOW_TAGS) if (tag !== opts.tag) ui.dropToasts(tag)
    ui.toast(opts)
    if (move) ui.focusToast(opts.tag, held._from)
  }

  // ── 回來了，現在該做：離開 App 一陣子（BACK_MIN）才回來、沒在計時（專注、休息、暫停都不算）、醒著、不在日程中、警語沒先停：
  // 提示卡寫現在該做的那一件（和下一步），一鍵開始專注或只做 5 分鐘，ふじ說一聲。剛從別的事回來的那一刻最好接回正事。
  // 今天第一次打開有今日摘要（裡面就寫了），不再說；BACK_GAP 內只說一次（切來切去不會一直跳）；設定裡可以關 ──
  const BACK_MIN = 20 * 60000
  const BACK_GAP = 90 * 60000
  const BACK_KEY = 'hiyori-back-at'
  // 上次說的時間也記在記憶體：瀏覽器空間滿了、存不進去時，一個半小時只說一次照樣算數
  let backAt = 0
  // 開場好了沒（載入畫面還蓋著時不說；開場那一段自己會看）
  let backReady = false
  // 回傳有沒有說
  const welcomeBack = () => {
    const now = Date.now()
    const st = store.state.settings
    // 頁面又看不到了（剛回來又馬上切走、Android 的 App 已經在背景）：不說，也不算說過
    if (!backReady || document.hidden || (native && nativeAway())) return false
    if (ui.awayMs() < BACK_MIN || !backOk(st, now)) return false
    let last = backAt
    try {
      last = Math.max(last, Number(JSON.parse(localStorage.getItem(BACK_KEY) || '0')) || 0)
    } catch {}
    if (Math.abs(now - last) < BACK_GAP || !nowTask()) return false
    // 正在打字：打完再說（兩分鐘內）；說的時候再看一次（開始計時了、打開了別的視窗、切走了、這件做完了就不說）
    return suggest('back', () => {
      if (!backOk(store.state.settings, Date.now())) return false
      const t = nowTask()
      return t ? sayBack(t) : false
    }, 2 * 60000)
  }
  // 現在說得了「回來了」嗎（等著的那一則說的時候也再看一次：關掉了、開始計時了、進了會議、先停了警語、打開了別的視窗）
  const backOk = (st, now) => {
    if (!store.nudge('backNudge') || ui.focus.mode !== 'idle' || ui.brief.open || ui._topLayer()) return false
    const p = pauseOf(st)
    if (!awakeAt(store.state.rhythm, now) || (p.until > now && p.from <= now) || inQuiet(eventsQuiet(now), now)) return false
    // 警語的提示卡還在（上面就寫著現在該做）：不疊上去
    return !ui.hasToast('motto')
  }
  const sayBack = (t) => {
    const now = Date.now()
    backAt = now
    try {
      localStorage.setItem(BACK_KEY, JSON.stringify(now))
    } catch {}
    const step = nextStep(t)
    talk('welcomeBack', { task: short(t.title) }, 5200, `回來啦。接下來先做「${short(t.title)}」好嗎？`, 'fuji')
    // 按的時候已經在計時了（別的分頁開始了）就不動；那一件做完了、刪掉了、不是今天的了（過了午夜），換成現在排在最前面的那一件
    const go = (fn) => () => {
      if (ui.focus.mode !== 'idle') return
      store.tick()
      const cur = store.tasksOn(store.today).find((x) => x.id === t.id && !x.done) || nowTask()
      if (cur) fn(cur.id)
    }
    nowToast({
      icon: '回', title: '歡迎回來', sub: `現在該做：${t.title}${step ? `・下一步：${short(step.title, 16)}` : ''}`, ms: 12000, tag: 'back',
      actions: [
        { label: '▶ 開始專注', run: go((id) => ui.focus.startWith(id)) },
        { label: '只做 5 分鐘', soft: true, run: go((id) => ui.focus.startSmall(id)) },
      ],
    })
    return true
  }
  // 回到 App：今日摘要（400 毫秒時看要不要出來）出來了就不說
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(() => !ui.brief.open && welcomeBack(), 700)
  })

  // ── 做完一件，接著下一件 ──
  // 沒在計時的時候勾掉了現在該做的那一件（排在最前面的那一件）：提示卡寫下一件（拆了小步驟的話也寫下一步），
  // 「▶ 開始專注」「只做 5 分鐘」一鍵開始。做完一件到開始下一件之間，最容易被別的事拉走。
  // 一口氣勾掉好幾件（已經很順了）時不吵：NEXT_GAP 內只說一次；今天都做完了就不說（有自己的慶祝）。設定裡可以關
  const NEXT_GAP = 20 * 60000
  let nextAt = 0
  // 現在可以說嗎：沒關掉這個提醒、沒在計時、今日摘要沒開著
  const nextOk = () => store.nudge('nextNudge') && ui.focus.mode === 'idle' && !ui.brief.open
  store.on('taskDone', (t) => {
    // 長期任務（專案裡慢慢推進的事）勾掉之前不在今天的清單上：不是「現在該做的那一件」
    if (!nextOk() || t.ongoing) return
    if (Date.now() - nextAt < NEXT_GAP) return
    const day = store.today
    // 範例不算（勾掉範例不說下一件、下一件也不會是範例）
    const mine = () => store.tasksOn(day).filter((x) => !store.isSample(x))
    const list = mine()
    if (!list.some((x) => x.id === t.id)) return
    // 勾掉之前它是不是排在最前面的那一件（在原本的位置當成還沒做完再排一次：一樣重要的照原本的先後）
    if (doFirst(list.map((x) => (x.id === t.id ? { ...x, done: false } : x)))[0]?.id !== t.id) return
    if (!doFirst(list)[0]) return
    nextAt = Date.now()
    // 慶祝的那一句（もち）、花開的提示卡先出來。
    // 這一下子裡又取消了完成（之後再勾掉時照樣說）、關掉了這個提醒、打開了今日摘要、開始計時了、過了午夜：不說。
    // 下一件照現在的樣子重新挑（剛才排第二的那一件可能移到明天、做完了、刪掉了）
    setTimeout(() => {
      if (!store.state.tasks.some((x) => x.id === t.id && x.done)) return (nextAt = 0)
      if (!nextOk() || dateStr() !== day) return
      // 建議類的一則：剛說過別的（20 分鐘內）、今天說夠了、正在打字就不說（這次不算，之後再勾照樣看）
      if (!suggest('next', () => sayNext(day, mine))) nextAt = 0
    }, 2600)
  })
  // 下一件：照現在的樣子重新挑（剛才排第二的那一件可能移到明天、做完了、刪掉了）
  const sayNext = (day, mine) => {
    if (!nextOk() || dateStr() !== day) return false
    const cur = doFirst(mine())[0]
    if (!cur) return false
    const step = nextStep(cur)
    talk('nextTask', { task: short(cur.title) }, 5200, `接下來做「${short(cur.title)}」吧，趁手感還在。`, 'fuji')
    // 按的時候已經在計時了（別的分頁開始了）就不動；那一件做完了、刪掉了，換成現在排在最前面的那一件
    const go = (fn) => () => {
      if (ui.focus.mode !== 'idle') return
      store.tick()
      const now = store.tasksOn(store.today).find((x) => x.id === cur.id && !x.done) || nowTask()
      if (now) fn(now.id)
    }
    nowToast({
      icon: '次', title: `下一件：${cur.title}`, sub: step ? `下一步：${short(step.title, 16)}` : '趁手感還在，接著做', ms: 10000, tag: 'next',
      actions: [
        { label: '▶ 開始專注', run: go((id) => ui.focus.startWith(id)) },
        { label: '只做 5 分鐘', soft: true, run: go((id) => ui.focus.startSmall(id)) },
      ],
    })
  }
  // 警語通知上的按鈕（跟 public/sw.js 的 mottoActions、Android 殼的 MottoNotice 一樣）：有現在該做的那一件才有「開始專注」。
  // 按了打開 App，由下面的 doAct 去做
  const mottoActions = (task) => [...(task ? [{ action: 'focus', title: '▶ 開始專注' }] : []), { action: 'pause', title: '先停 1 小時' }]
  // 把警語的那一串交給手機／伺服器（下面「警語交給別人排」那一段接上）：改了設定、開始專注時馬上叫一次，
  // 不等下一秒的檢查（剛改完就離開 App 的話頁面會睡著，手機上留著的還是舊的那一串）
  let syncMottos = () => {}
  let syncReminds = () => {}
  // 這一則提醒（key：reminders.js 的那一個），交給別人發嗎（交出去的那一串 sentReminds 裡有這一則才算；
  // 匯入的行事曆、排不下的、ふじ睡前那則會說的就寢提醒都不在裡面，頁面自己發）：
  //   Android 殼：App 不在前面（頁面看不到，或分割畫面時另一邊在前面）就是手機發
  //   網頁：頁面看不到、伺服器排著這一則的推播（Service Worker 顯示）
  let sentReminds = []
  let webReminds = []
  const byOther = (kind, key) => {
    const now = Date.now()
    const r = sentReminds.filter((x) => x.key === key && Math.abs(x.at - now) < 20 * 60000).sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now))[0]
    if (!r) return false
    if (nativeReminders()) return document.hidden || nativeAway()
    return document.hidden && !!mottoPush?.covers(r.at)
  }
  // Service Worker 顯示過的提醒（推播送到時）：Reminders 下一次檢查時記成提醒過了
  const webShown = []
  navigator.serviceWorker?.addEventListener?.('message', (e) => {
    if (e.data?.type === 'hiyori-remind-shown' && Array.isArray(e.data.list)) webShown.push(...e.data.list)
  })
  // 這一輪到點時還在別的 App 裡（Android）：算一次中途離開，回傳有沒有算（下面「專注中離開 App」那一段接上）
  let awayAtEnd = () => false
  // 叫你回來的那一則（backItem）交給手機排在幾點（Android；沒排著是 0）：限時去到了、App 在背景時，排著的就讓手機叫
  let backSent = 0
  // 到點自動延長（接著往上數，換成延長那一段的 id）：中途離開的那一段跟著接著算（下面「專注中離開 App」那一段接上）
  let awayFlow = () => {}
  // 自動延長的那一輪，到點記下原定的那一段之前那天專注了幾分：跨過每天的目標的話，等延長做完再一起慶祝（不在心流裡吵你）。
  // 記在這個分頁的 sessionStorage：延長中重新整理也還記得
  const FLOW_WAS_KEY = 'hiyori-flow-was'
  let flowWas = (() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(FLOW_WAS_KEY) || 'null')
      return v && typeof v.day === 'string' && Number.isFinite(v.was) ? v : null
    } catch {
      return null
    }
  })()
  const setFlowWas = (v) => {
    flowWas = v
    try {
      if (v) sessionStorage.setItem(FLOW_WAS_KEY, JSON.stringify(v))
      else sessionStorage.removeItem(FLOW_WAS_KEY)
    } catch {}
  }
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
    countShown()
  })

  // ── 按了警語通知上的按鈕：打開 App，照著做 ──
  // focus：開始專注現在該做的那一件（通知上寫的那件已經做完的話，換成現在排在最前面的）；pause：先停 1 小時。
  // 手機的 App：殼記著按了哪一顆（takeAct）；瀏覽器：Service Worker 把按了哪一顆留在快取裡（takeNoticeAct），
  // 叫出開著的視窗時也直接傳過來。不認網址上的參數：別的網站連過來就能替你按，不行
  // at：那一則提醒排在幾點（回神紀錄用它認出同一則、記在那一天；舊版的手機 App〔殼 4 以前〕不知道是 0）
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
  // 開場決定好要不要出今日摘要了沒（決定之前要說的提示卡排在 bootQueue，決定之後才出來：摘要還開著就等它關掉）。
  // 開得慢的時候，固定等幾秒再說的話，提示卡可能先出來、被接著打開的摘要蓋住，等摘要關掉已經收掉了
  let greeted = false
  const bootQueue = []
  let bootAct = null
  const runAct = (act, at = 0) => {
    if (booted) doAct(act, at)
    else bootAct = { act, at }
  }
  const takeNativeAct = () => {
    const a = nativeTakeAct()
    if (a) runAct(a, nativeActAt())
  }
  // App 不在、頁面看不到時手機（Android 的 App）、推播（Service Worker）發過的警語：回到 App 時算進回神紀錄的「提醒了幾次」
  // （滑掉、只點通知本身的也算；頁面念過的、按了通知上按鈕的那一則同一個時間，不會重算）。
  // 兩邊都只是讀最近幾十則、不清掉：存檔寫不進去時重新打開還拿得到（算過哪幾筆 store 記著）
  const countShown = () => {
    store.mottosShown('app', nativeShown())
    mottoPush?.shown().then((list) => store.mottosShown('sw', list))
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

  // 那一刻（毫秒）是幾點幾分：「10:06」
  const clockOf = (t) => {
    const d = new Date(t)
    return minToHHMM(d.getHours() * 60 + d.getMinutes())
  }
  // 每天的專注目標：這一輪記進去之後剛好跨過去，慶祝一下。was：記之前那天專注了幾分、day：那是哪一天
  // （記的時候換日了：今天是從 0 開始的）。等到點的那一句和提示卡先出來再說
  const goalDone = (was, day) => {
    const goal = store.state.settings.focusGoal || 0
    const today = store.today
    const before = day === today ? was : 0
    const now = store.peekDay(today).focus || 0
    if (!goal || before >= goal || now < goal) return
    setTimeout(() => {
      // 等的這一下剛好過了午夜：已經是隔天了，不說「今天」達成（那天的已經記下了）
      if (dateStr() !== today) return
      sfx.fanfare()
      haptic('party')
      talk('focusGoalDone', { goal: goalText(goal) }, 6000, `今天的專注目標 ${goalText(goal)} 達成了！`)
      ui.toast({ icon: '標', title: '今天的專注目標達成了', sub: `已專注 ${minText(now)}・目標 ${goalText(goal)}`, ms: 6000 })
    }, 2600)
  }

  // 跨裝置的計時（下面同步那一段接上）：送給別台、到點時要不要先等別台
  let shareTimer = null
  let timerShared = null
  // ── UI 掛鉤 ──
  const hooks = {
    // 這台按了計時的按鈕、到點時接手了：送給別台（開了同步才送，見同步那一段）
    focusShare: (t) => shareTimer?.(t),
    // 到點時要不要先等別台：沒開同步是 null；mine：這一輪是不是這台的（最後按按鈕、接手的是這台）；sync()：同步一次
    shared: () => timerShared?.() ?? null,
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
    // 只動小島上的東西（擺放、標示、鏡頭）：還沒有小島就沒有東西可動（商店和「在島上查看」都會先切回小島）。
    // 小島模式開機、小島還在背景建的時候按的（擺放、看某件任務／建築）：建好再做最後按的那一件（onIsland）；滑過去的標示不等
    startPlacing: (key) => onIsland((s) => s.startPlacing(key)),
    hoverTask: (id) => scene?.hoverTask(id),
    hoverEvent: (id) => scene?.hoverEvent(id),
    hoverProject: (id) => scene?.hoverProject(id),
    focusTask: (id) => onIsland((s) => s.focusTask(id)),
    focusEvent: (id) => onIsland((s) => s.focusEvent(id)),
    focusProject: (id) => onIsland((s) => s.focusProject(id)),
    // ひより町的建築卡片：還沒開張的就看看它會浮出來的地方
    focusTown: (key) => onIsland((s) => s.focusTown(key)),
    focusProjectTown: () => onIsland((s) => s.focusProjectTown()),
    resetView: () => (ui.appMode ? ui.setAppMode(false) : scene?.resetView()),
    // 切換 App 模式：進 App 時先離開小木屋；回小島時正在專注、兩人已經在屋裡，就直接進屋陪讀
    appModeChanged: (on, opts) => scene?.appModeChanged(on, opts),
    // App 模式全螢幕計時上的「到小木屋」：切回小島，兩人會走進屋裡（已經在屋裡就直接進屋）
    goCabin: () => ui.setAppMode(false),
    // 專注頁的貓咪被摸了
    catPoke: () => sfx.squish(),
    // 專注頁上勾掉了一小步（還有下一步；最後一步勾完任務就完成了，照完成任務的慶祝）、寫下了下一小步
    stepDone: (step, next) => {
      sfx.pop()
      haptic('tick')
      talk('stepDone', { step: short(step, 14), next: short(next, 14) }, 4200, `接著是「${short(next, 14)}」。`)
    },
    // brk：休息時留給等等的自己的那一步
    stepSet: (step, brk) =>
      brk
        ? talk('stepLeft', { step: short(step, 16) }, 4600, `記下了，休息完從「${short(step, 16)}」開始。`)
        : talk('stepSet', { step: short(step, 16) }, 4200, `先從「${short(step, 16)}」開始就好。`),
    // 想分心了：打開「先等一分鐘」時陪一句；一分鐘到了輕輕響一聲；還是想去也不責備（專注照常計時）
    urgeOpen: () => talk('focusUrge', {}, 5200, '想分心很正常，我們一起等一分鐘。'),
    urgeAsk: () => sfx.chime(),
    // 等完還是想去：去 5 分鐘就回來（限時去），說好幾點叫你回來；點了想去做什麼的話說到那件事
    urgeGo: (pull, until) => {
      const p = pullOf(pull)
      const at = clockOf(until)
      if (p) talk('focusDetourPull', { what: p.label, at }, 5200, `好，去${p.label}吧。${at} 叫你回來。`)
      else talk('focusDetour', { at }, 5200, `好，去吧。${at} 叫你回來。`)
    },
    // 限時去的時間到了：叫你回來（提示卡上「我回來了」；網頁不在前面、Android 的 App 在背景時系統通知）。
    // Android 的 App 在背景、叫你回來的那一則已經交給手機排在這個時間（見 backItem）：讓手機叫，這邊先不叫
    // （回傳 false，回到 App 時再看），不會叫兩次；沒排到（舊版的殼、這一輪再一下就到點了）就這邊叫。
    // 剛回到 App（下一秒的檢查就會當成回來了）：不叫
    detourDue: () => {
      if (native && (nativeAway() ? backSent === ui.focus.detour : nativeOut)) return false
      const t = focusTarget()
      const task = t ? `「${short(t)}」` : ''
      sfx.chime()
      haptic('warn')
      talk('focusDetourDue', { task }, 6000, `說好的 5 分鐘到了，回來吧。${task}還在等你。`)
      ui.toast({ icon: '回', title: '說好的 5 分鐘到了，回來吧', sub: t ? `回到「${short(t, 12)}」` : '回到正事上', tag: 'detour', ms: 60000, actions: [{ label: '我回來了', run: () => ui.focus.detourBack() }] })
      if (store.state.settings.notify && (native ? nativeAway() : document.hidden || !document.hasFocus())) systemNotify('ひより · 回來吧', `說好的 5 分鐘到了${t ? `，回到「${short(t, 16)}」` : ''}`, 'detour')
      return true
    },
    reviewOpened: () => talk('reviewAsk', {}, 4200, '今天過得怎麼樣？'),
    modalClosed: () => scene?.modalClosed(),
    setSound: (on) => sfx.setEnabled(on),
    // 專注時的背景聲（雨聲、褐噪音、粉紅噪音）：專注那邊決定現在該放什麼、多大聲
    noise: (kind, vol) => noise.want(kind, vol),
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
      if (kind === 'nudge') return aside(() => talk('stuck', { task, n }, 6000, `「${task}」好像卡住了，拆小一點好嗎？`, 'fuji'))
      else if (kind === 'split') {
        talk('stuckSplit', { task }, 5000, '拆好了，先做第一步就好。', 'fuji')
        setTimeout(() => talk('stuckSplit', { task }, 4200, '', 'mochi'), 2200)
      } else if (kind === 'later') talk('stuckLater', { task }, 4600, '明天再看，現在先歇歇吧。', 'fuji')
      else if (kind === 'drop') talk('stuckDrop', { task }, 4600, '先放下了，鬆一口氣吧。', 'fuji')
    },
    // 好久沒碰的長期任務：第一次看到那張小卡時ふじ說一句（一天一次）
    idle: (t, n) => aside(() => talk('idleLong', { task: short(t.title), n }, 6000, `「${short(t.title)}」${n} 天沒碰了，今天碰一下就好。`, 'fuji')),
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
        // 拆成了小步驟：從下一步說起（專注頁上也寫著）
        else if (t && nextStep(t)) talk('focusStep', { task: short(t.title), step: short(nextStep(t).title, 16) }, undefined, `先從「${short(nextStep(t).title, 16)}」開始。`)
        else if (t || p) talk('focusTask', { task: short(t ? t.title : p.name) })
        else if (info.free) talk('focusFree', {}, undefined, '', 'fuji')
        else if (!duet('focusStart')) talk('focusStart')
        // 這一輪結束前就有日程要開始（開會、上課）：ふじ提醒一聲記得提早收尾（專注頁上也寫著）
        // 等開始的那句說完再說；到時候再看一次：還是同一輪、沒暫停、還會撞到才說（這中間停掉重來、日程改了、標成做完的就不說）
        if (ui.focus.nextUp()?.clash) {
          setTimeout(() => {
            const f = ui.focus
            const n = f.mode === 'focus' && f.sid === info.sid && f.paused == null ? f.nextUp() : null
            if (!n?.clash) return
            const e = n.event
            talk('focusClash', { event: short(e.title), at: e.start }, 6000, `${e.start} 有「${short(e.title)}」，記得提早收尾。`, 'fuji')
          }, 2600)
        }
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
      // 記進去之前今天專注了幾分（這一輪跨過每天的目標時慶祝）
      const day0 = store.today
      const was = store.peekDay(day0).focus || 0
      // 這一輪中途切去用別的 App 幾次（Android 的 App 才分得出來；到點時還在別的 App 裡的也算一次）
      const away = (info.away || 0) + (awayAtEnd(info.sid, info.at) ? 1 : 0)
      const awayNote = away ? `・中途離開 ${away} 次` : ''
      // 專注的那件還沒寫下一步：休息前留一步給等等的自己（打開專注頁、小島模式是計時設定的小視窗，直接寫；
      // 專注頁開著的話頁面上就有那一行）。記著是哪一件：之後換了目標、計時結束了，按了也不會寫到別件上
      const leave = () => {
        const tid = ui.focus.taskId
        return !ui.focus.bigOpen && ui.focus.canLeaveStep ? [{ label: '留一步給等等', soft: true, run: () => ui.focus.leaveStep(tid) }] : []
      }
      const more = () => [
        ...(ui.focus.bigOpen
          ? []
          : [
              ...(ui.focus.canExtend ? [{ label: '還沒做完，延長', run: () => ui.focus.extend() }] : []),
              ...(ui.focus.canAddRound ? [{ label: '再加一輪', soft: true, run: () => ui.focus.addRound() }] : []),
            ]),
        ...(parked ? [{ label: `看記下的 ${parked} 件`, soft: true, run: () => ui.openParked() }] : []),
        ...leave(),
      ]
      // 加時做完：多做的分鐘記進去（不多算一顆番茄）；不到 1 分鐘就不另外記。
      // 到點自動延長的（cap）：原定的那一段到點時已經悄悄記下了，天燈、跨過每天的目標的慶祝留到現在
      if (info.ext) {
        const auto = info.cap > 0
        const base = auto && flowWas?.day === day0 ? flowWas.was : was
        if (auto) setFlowWas(null)
        // 做滿了才結束的（不是自己按「做完了」）：at 是延長做滿的時間
        const full = auto && !!info.at
        if (minutes < 1 || store.completePomodoro(minutes, taskId, info.projectId, info.sid, { extra: true }) === false) {
          // 另一個分頁已經記過了（也已經慶祝過）：兩人出屋就好
          if (minutes >= 1 || !auto) {
            scene?.focusStopped()
            if (minutes < 1) ui.toast({ icon: '灯', title: '加時不到 1 分鐘', sub: '沒有另外記，接著休息一下吧', tag: 'focus', ms: 9000, actions: more() })
            return
          }
          // 自動延長了、馬上就按「做完了」：原定的那一段記下了，天燈照放
          sfx.temple()
          haptic('end')
          goalDone(base, day0)
          scene?.focusFinished(taskId, info.projectId)
          talk('focusEnd')
          ui.toast({ icon: '灯', title: `${Math.round(info.focusMin)} 分鐘的專注記下了`, sub: `延長不到 1 分鐘，沒有另外記・接著休息一下吧${awayNote}`, tag: 'focus', ms: 9000, actions: more() })
          return
        }
        sfx.temple()
        haptic('end')
        goalDone(base, day0)
        if (info.at) timerNotify({ at: info.at, mode: 'focus', up: true, focusMin: auto ? info.focusMin : minutes, breakMin: info.breakMin, round: info.round, rounds: info.rounds, target: info.target, ...(auto ? { flow: info.cap } : {}) })
        scene?.focusFinished(taskId, info.projectId)
        if (full) talk('focusFlowEnd', {}, undefined, '延長的時間也到了，起來動一動吧。')
        else talk('focusEnd')
        const next = info.rounds > 1 && !info.last ? `休息 ${info.breakMin} 分鐘後接著第 ${info.round + 1} 輪` : '接著休息一下吧'
        const title = full ? `自動延長的 ${minutes} 分鐘也做滿了` : auto ? `延長了 ${minutes} 分鐘，也記進去了` : `多做了 ${minutes} 分鐘，也記進去了`
        ui.toast({ icon: '灯', title, sub: next + awayNote, ms: 9000, actions: more(), tag: 'focus' })
        return
      }
      // 同一輪另一個分頁已經記過了：這邊不再記、也不再放天燈
      if (store.completePomodoro(minutes, taskId, info.projectId, info.sid) === false) return scene?.focusStopped()
      sfx.temple()
      haptic('end')
      goalDone(was, day0)
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
            ...leave(),
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
      // 接上 Claude 時：跟ふじ說一句做到哪，她記成專案的進度、勾掉做完的小步驟（前半句先替你寫好）
      const tell = t && !t.done && agent.ready() ? [{ label: '跟ふじ說做到哪', soft: true, run: () => ui.openFuji(`剛專注完「${short(t.title, 16)}」${minutes} 分鐘，做到：`) }] : []
      const actions = [...more(), ...tell, ...(log && !tell.length ? [{ label: '寫紀錄', soft: true, run: () => ui.openTaskLog(t.id) }] : [])]
      ui.toast({ icon: '灯', title, sub: `${sub}・${rest}${awayNote}`, ...(actions.length ? { ms: 12000, actions } : {}), tag: 'focus' })
    },
    // 倒數到點、設了自動延長（還在心流裡就不打斷）：原定的那一段照常記進去（番茄、經驗值、任務長大），
    // 但不響、不震、不跳通知、不放天燈、兩人留在小木屋裡，跨過每天的目標也等延長做完再一起慶祝；計時接著往上數。
    // 專注頁開著：貓咪已經說了一聲（catSaid，不出聲）；不然一張不響的提示卡（小島模式還有ふじ說一句），可以直接去休息。
    // late：頁面睡著，延長的時間也過了才醒來：只記下，接著就是延長做滿（那邊會說）
    focusFlowed: (minutes, taskId, info = {}) => {
      const day0 = store.today
      const was = store.peekDay(day0).focus || 0
      // 升級、成就、每日任務達成這些慶祝先留著，延長做完再放（每秒的檢查看到不在自動延長了就放）。
      // 同一輪另一個分頁已經記過了（也已經說過了）
      if (store.quietly(() => store.completePomodoro(minutes, taskId, info.projectId, info.sid)) === false) return
      setFlowWas({ day: day0, was })
      awayFlow(info.sid, ui.focus.sid)
      if (info.late) return
      const end = clockOf(info.at + info.flow * 60000)
      if (!ui.appMode) talk('focusFlow', { mins: minutes, end }, 5200, `${minutes} 分鐘到了。看你這麼專心，幫你延長到 ${end}。`, 'fuji')
      if (info.catSaid) return
      const t = info.target ? `「${short(info.target, 10)}」` : ''
      ui.toast({
        icon: '延', title: `${minutes} 分鐘到了，自動延長中`, sub: `${t}原定的記下了，還在狀態就接著做・最晚 ${end}`, ms: 9000, tag: 'focus',
        // 專注頁開著：「做完了」就在頁面上，提示卡只說一聲
        ...(ui.focus.bigOpen ? {} : { actions: [{ label: '現在休息', soft: true, run: () => ui.focus.mode === 'focus' && ui.focus.ext && ui.focus.stop() }] }),
      })
    },
    // 專注中貓咪念警語的時間到了、專注頁上的貓說不了：專注頁沒開著是もち或ふじ說（小島上頭上的泡泡，App 模式是畫面下方的對話框）；
    // 專注頁開著但貓不在（請牠離開了、畫面放不下）是一張不響的提示卡。都不出聲
    focusMotto: (text, big) => {
      if (big) return ui.toast({ icon: '戒', title: text, sub: '專注中・寫給自己的警語', ms: 7000, tag: 'motto' })
      say(pick(['mochi', 'fuji']), `「${short(text, 28)}」`, 7000)
    },
    // 看不到頁面（切到別的分頁、別的 App、鎖螢幕；Android 殼另外問手機 App 在不在前面）：貓咪先不念
    pageAway: () => document.hidden || (native && nativeAway()),
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
  // ── 自主的ふじ（接了 Claude 時）：自己排今天、安排新任務、進度落後時重排、晚上準備明天；什麼時候動見 agentRunner.js ──
  const AGENT_DID = { morning: '整理了今天', replan: '重排了今天', capture: '安排了新任務', evening: '準備好明天了', risk: '替截止日提早排好了', week: '排好下一週了' }
  const AGENT_WANT = { morning: '想整理今天', replan: '想重排今天', capture: '想安排新任務', evening: '想準備明天', risk: '想替截止日提早排', week: '想好下一週怎麼排了' }
  // ── 往前看：截止日、專案會不會來不及（src/risk.js 算、riskWatch 記著上一次的等級）──
  const risk = createRiskWatch(store)
  hooks.risk = risk
  // 很緊的截止日：交給ふじ整理一次（agentRunner 的 hooks.risk）。why 寫給她看：是哪幾件、還要多久、空檔多少
  const riskDue = () => {
    const tight = risk.current().due.filter((r) => r.level === 'tight')
    if (!tight.length) return null
    const name = (id) => short(store.state.tasks.find((t) => t.id === id)?.title || '', 16)
    const why = tight.slice(0, 3).map((r) => `${r.ids.slice(0, 3).map((id) => `「${name(id)}」`).join('')}${dayWord(r.date, store.today)}截止，連同之前截止的還要大約 ${fmtDur(r.need)}，到那天能用的空檔（七成）大約 ${fmtDur(r.room)}`).join('；')
    return { why: `${why}，很緊`, sig: tight.map((r) => `${r.date}:${[...r.ids].sort().join('+')}`).join(',') }
  }
  const agent = createAgent(store, {
    risk: riskDue,
    // 打到一半的字、開著的表單：先不動資料
    busy: () => ui.hasDraft(),
    // 開場還沒好、正在專注、正在擺裝飾：不打擾
    holding: () => !booted || ui.focus.mode === 'focus' || !!scene?.placing || cloudSync.state === 'conflict' || fileSync.state === 'conflict',
    focusing: () => (ui.focus.mode === 'focus' ? ui.focus.taskId : null),
    // 動手之前先把別台的變更拿回來；兩邊都改過、還沒選的時候不動
    settle: () => Promise.allSettled([cloudSync.sync(), fileSync.sync()]),
    // 對話時：使用者正在看哪一頁（「這個專案」「這天」）；她說完之後替使用者打開的畫面
    here: () => ui.here(),
    go: (g) => ui.agentGo(g),
    // 她自己整理完（entry），或想好了等你決定（pending，設定成「先問我」時）：說一聲，附上撤銷／套用
    notify: (entry, run, pending) => {
      const n = entry ? entry.changes.length : pending.lines.length
      const acts = []
      if (pending) acts.push({ label: '套用', run: () => agent.accept() }, { label: '看看', soft: true, run: () => ui.openAgent() })
      else {
        const next = entry.next && store.state.tasks.find((t) => t.id === entry.next && !t.done)
        if (next && ui.focus.mode === 'idle') acts.push({ label: '開始專注', run: () => ui.focus.ask(next.id) })
        else acts.push({ label: '看看', soft: true, run: () => ui.openAgent() })
        if (store.agentCanUndo(entry.id)) {
          acts.push({
            label: '撤銷', soft: true,
            run: () => {
              const k = store.agentUndo(entry.id)
              ui.toast({ icon: '戻', title: k ? `撤銷了 ${k} 項` : '沒有可以撤銷的了', sub: '之後改過的、做完的留著' })
            },
          })
        }
      }
      const say = (entry || pending).say
      // 今日摘要開著時等它關掉再說（不然提示卡蓋在摘要後面）
      ui.afterBrief(() => ui.toast({ icon: '藤', stamp: true, title: `ふじ${(pending ? AGENT_WANT : AGENT_DID)[run] || '整理了一下'}${n ? `（${n} 項）` : ''}`, sub: say || '', ms: 12000, tag: 'agent', actions: acts }))
    },
  })
  hooks.agent = agent
  // ── 範例（第一次打開時放的）：加了第一件自己的任務、日程、專案，或過了開島那天，就收起來，附撤銷（撤銷過就不再自動收） ──
  // 開場前排著的提示卡（範例收起來了，附撤銷）：等摘要關掉（點了摘要裡的哪一件也照樣說，撤銷不能不見）、
  // 看得到頁面了再說（開場後馬上切走的話，回來才說，不會在背景出來又收掉）
  const bootSay = (fn) => {
    if (ui.brief.open || document.hidden || (native && nativeAway())) return void setTimeout(() => bootSay(fn), 800)
    fn()
  }
  const tuckSamples = (why) => {
    const snap = store.tuckSamples()
    if (!snap) return
    const toast = () =>
      ui.toast({
        icon: '例', title: '範例收起來了', sub: why === 'day' ? '第一次打開時放的範例，過了那天就收起來' : '島上現在只有你自己的東西', ms: 9000, tag: 'samples',
        actions: [{ label: '撤銷', soft: true, run: () => store.restoreSamples(snap) && ui.toast({ icon: '例', title: '範例放回去了', sub: '之後不再自動收；「設定 → 資料與同步」裡可以清除', ms: 4200 }) }],
      })
    // 開場時（過了那天）等摘要說完再說
    if (greeted) bootSay(toast)
    else bootQueue.push(toast)
  }
  // 等這一次新增的事件都跑完再收（同一個事件的其他反應看到的還是收之前的樣子）
  for (const kind of ['taskAdded', 'eventAdded', 'projectAdded']) store.on(kind, (x) => !store.isSample(x) && store.sampleCount() && queueMicrotask(() => tuckSamples('own')))
  store.on('dateChanged', () => store.samplesStale() && tuckSamples('day'))
  // ── 匯入的行事曆：抓回來的日程（唯讀）放進 store.external；設定變了就重新套用、去抓（src/calendars.js）──
  const calendars = createCalendars(store)
  hooks.calendars = calendars
  calendars.sync()
  store.on('change', () => calendars.sync())
  // ── ふじ在 App 關著時的通知（src/fujiNotes.js）：只從一台送（settings.fujiNotify 是那一台的代號，'off' 是不送），
  // 還沒選過的話手機（Android 殼、手機的瀏覽器）先送 ──
  const myDevice = deviceId()
  const phoneLike = !!native || !deskWeb()
  const fujiNotes = {
    // 這台送得出去嗎：ok／notify 還沒開系統通知／push 連不上通知伺服器／old-app 舊版的 Android 殼／none 這個瀏覽器收不到推播
    reach: () => {
      if (native) return !nativeFujiNotes() ? 'old-app' : notifyOn() ? 'ok' : 'notify'
      if (!pushSupported()) return 'none'
      return !notifyOn() ? 'notify' : mottoPush?.ready() ? 'ok' : 'push'
    },
    here: () => notesHere(store.state.settings.fujiNotify, myDevice, phoneLike),
    // 'mine' 這台、'other' 別台、'off' 關著、'' 還沒選
    owner: () => {
      const v = store.state.settings.fujiNotify || ''
      return v === myDevice ? 'mine' : v === 'off' || !v ? v : 'other'
    },
    // 改成這台接收／不接收。打開時還沒開系統通知就先問，不允許就不改
    set: async (on) => {
      if (on && !notifyOn() && !(await ui.enableNotify())) return false
      store.setSetting('fujiNotify', on ? myDevice : 'off')
      syncMottos()
      return true
    },
  }
  hooks.fujiNotes = fujiNotes
  const ui = new UI(store, hooks)
  chatter = (who, text, ms) => ui.chatter(who, text, ms)
  // ふじ在對話裡改了設定（或撤銷了）：外觀、字的大小、音效、計時跟著換
  const touchedSettings = (entry) => !!entry?.changes.some((c) => c.u?.k === 'set' && c.u.kind === 'settings')
  store.on('agentApplied', ({ entry }) => touchedSettings(entry) && ui.syncSettings())
  store.on('agentUndone', ({ id }) => touchedSettings(store.state.agent.log.find((e) => e.id === id)) && ui.syncSettings())

  // ── 夜晚切換深色玻璃 ──
  // 有小島時跟著天空的顏色走（小島每幀呼叫），還沒有就照時間和外觀設定算；回傳這次有沒有換
  let isNight = null
  // fade：自己切換的（設定、Dock 的切換鈕）才淡淡地換過去
  const syncNight = (night, fade = false) => {
    // 第一次照 0.5 算（跟開機時 index.html、上面那一行一樣，天剛亮的那幾分鐘才不會先暗再亮）；之後留一點緩衝，不會來回閃
    const on = isNight === null ? night > 0.5 : isNight ? night > 0.45 : night > 0.55
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
    ui.dropToasts('review')
    sfx.chime()
    const who = talk('reviewDone', {}, 4200, '謝謝你告訴我今天的事。')
    if (first) scene?.headBurst(who, { colors: ['#ffffff', '#fff1b8', '#d9ccff'], count: 30, speed: 1.4 })
  })
  store.on('shopPoor', () => talk('shopPoor', {}, undefined, '金平糖還不太夠，慢慢來就好。'))
  store.on('taskAdded', (t) => {
    if (inGarden(t)) sfx.plant()
    // 剛加的任務：ふじ等一下自己替它估時間、排進空檔
    agent.added(t)
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
    // 直接在提示卡上領（以前叫你「到左下角」：手機、App 模式沒有左下角那張，要到今日總覽找）
    ui.toast({ icon: '週', title: `每週挑戰「${w.title}」達成`, sub: '限定擺飾可以領了（今日總覽的每日任務也領得到）', ms: 7000, actions: [{ label: '領取', run: () => store.claimWeekly() }] })
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
  // 存不進去（多半是瀏覽器空間滿了）：畫面上的資料還在，但重新整理就會不見。上方的警示列一直留著，直到又存得進去：
  // 可以馬上匯出一份、或清出空間後再試一次。關掉頁面前也會問一聲
  const saveFailedToast = () =>
    ui.alertBar('save', {
      icon: '存', title: '資料還沒存好', sub: '瀏覽器的儲存空間可能滿了。關掉或重新整理之前，先匯出一份',
      actions: [{ label: '匯出資料', run: () => ui.exportData() }, { label: '再試一次', soft: true, run: () => store.saveNow() || ui.toast({ icon: '存', title: '還是存不進去', sub: '先匯出一份；清出一些空間（例如刪掉不用的分頁資料）再試' }) }],
    })
  store.on('saveFailed', saveFailedToast)
  store.on('saveRecovered', () => {
    ui.alertBar('save', null)
    ui.toast({ icon: '存', title: '又存得進去了', sub: '剛才的變更都已經存好' })
  })
  // 另一個分頁已經更新成新版：這個分頁還是舊的程式，再存下去會洗掉新版的資料（之後的變更都不存，警示列一直留著）
  // 舊分頁裡已經改了東西（store.lostEdits）：說清楚那些沒存，重新整理前也會問一聲
  const newerToast = () =>
    ui.alertBar('newer', {
      icon: '新', title: '這個分頁的 App 比較舊',
      sub: store.lostEdits ? '剛才在這裡的變更沒有存（另一個分頁已經是新版）。重新整理後請再做一次' : '另一個分頁已經更新到新版。這裡的變更先不會存，重新整理這一頁再繼續',
      actions: [{ label: '重新整理', run: () => location.reload() }],
    })
  store.on('newerApp', newerToast)
  addEventListener('beforeunload', (e) => {
    // 存得慢時剛改的還排著：先寫（另一個分頁已經是新版的話，這時才知道沒存到）
    store.flushSave()
    if (!store.saveError && !store.lostEdits) return
    e.preventDefault()
    e.returnValue = ''
  })
  // 沒接住的錯誤（src/errors.js 記著）：這次開啟第一次遇到時說一聲，可以回報（附上記到的錯誤）
  tellError = () =>
    ui.toast({
      icon: '錯', title: '出了一點問題', sub: '剛才的動作可能沒做完。重新整理通常就好了；一直發生的話可以回報', ms: 9000, tag: 'error',
      actions: [{ label: '回報', soft: true, run: () => ui.openFeedback() }, ...(ui.hasDraft() ? [] : [{ label: '重新整理', run: () => location.reload() }])],
    })

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
  const achWait = new Map()
  store.on('achievement', (a) => {
    // 同一個成就還沒跳出來又拿到一次（剛套用就撤銷、又馬上套用）：只跳最新那次
    if (achWait.has(a.id)) {
      clearTimeout(achWait.get(a.id))
      achDelay = Math.max(0, achDelay - 700)
    }
    const at = store.state.player.achievements[a.id]
    achDelay += 700
    achWait.set(a.id, setTimeout(() => {
      achWait.delete(a.id)
      achDelay = Math.max(0, achDelay - 700)
      // 還沒跳出來就被收回了（剛套用就撤銷最佳化時程、同步換回沒拿到的那一版）：不慶祝
      if (!at || store.state.player.achievements[a.id] !== at) return
      sfx.chime()
      ui.toast({ icon: a.kanji, stamp: true, title: `${a.name}・${a.title}`, sub: a.desc, ms: 4200 })
    }, 1500 + achDelay))
  })
  store.on('questReady', (q) => ui.toast({ icon: '済', title: `每日任務「${q.title}」達成`, sub: `+${XP.quest} XP 可以領了（今日總覽也領得到）`, ms: 6000, actions: [{ label: '領取', run: () => store.claimQuest(q.id) }] }))
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
  // 限時去之後回來了（按了「我回來了」、切走之後回到 App）：叫了才回來的也一樣歡迎
  store.on('focusReturned', ({ late }) => {
    sfx.pop()
    haptic('tick')
    const t = focusTarget()
    const task = t ? `「${short(t)}」` : ''
    if (late) talk('focusDetourLate', { task }, 4600, `回來了就好。接著做${task}吧。`)
    else talk('focusDetourBack', { task }, 4600, `說到做到，回來了。接著做${task}吧。`)
  })
  // 專注中想分心時先等了一分鐘、回到正事（專注頁的「想分心了？」）
  store.on('focusHeld', ({ count, pull }) => {
    sfx.pop()
    haptic('tick')
    const p = pullOf(pull)
    if (p) talk('focusHeldPull', { count, what: p.label }, 4200, `先不${p.label}，很好。我們接著做。`)
    else talk('focusHeld', { count }, 4200, '忍住了，回來做正事吧。')
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
    // 設定裡「時間到的提醒」關著：警語以外的都不說（照樣記成提醒過了，打開時不會一口氣補一串）
    if (kind !== 'motto' && store.state.settings.remindOn === false) return
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
    // 任務的截止日：前一天、當天早上ふじ提醒（還沒做完的），可以直接開始專注
    if (kind === 'due') {
      const t = store.state.tasks.find((x) => x.id === e.id)
      if (!t || t.done) return
      const today = min === 0
      sfx.chime()
      say('fuji', today ? `「${short(t.title)}」今天截止，先把它顧好。` : `「${short(t.title)}」明天截止，今天留點時間給它。`, 6000)
      const title = `「${t.title}」${today ? '今天' : '明天'}截止`
      const left = t.dur && t.spent ? `已經做了 ${t.spent} 分鐘` : t.subs?.length ? `小步驟做了 ${t.subs.filter((x) => x.done).length}/${t.subs.length}` : '還沒開始的話，先做 5 分鐘也好'
      ui.toast({
        icon: '旗', title, sub: left, ms: 10000,
        actions: ui.focus.mode === 'idle' ? [{ label: '▶ 開始專注', run: () => ui.focus.startWith(t.id) }, { label: '只做 5 分鐘', soft: true, run: () => ui.focus.startSmall(t.id) }] : [],
      })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${title}`, left, `due-${t.id}`)
      return
    }
    // 習慣快斷掉：連續好幾天的習慣今天還沒打卡，睡前提醒一次（做了就直接打卡）
    if (kind === 'habit') {
      const h = store.state.habits.find((x) => x.id === e.id)
      if (!h || h.archived) return
      sfx.chime()
      say('mochi', `「${short(h.name)}」已經連續 ${e.streak} 天了，今天還差一次。`, 5200)
      const title = `「${h.name}」連續 ${e.streak} 天，今天還沒打卡`
      ui.toast({
        icon: '習', title, sub: '做一點點也算，別讓它斷掉', ms: 10000,
        actions: [{ label: '做了，打卡', run: () => store.checkHabit(h.id) }, { label: '看看', soft: true, run: () => ui.setTab('habits') }],
      })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${title}`, '做一點點也算', `habit-${h.id}`)
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
      nowToast({
        icon: '戒',
        title: e.text,
        sub: next ? `現在該做：${next.title}${nextStep(next) ? `・下一步：${short(nextStep(next).title, 16)}` : ''}` : '寫給自己的警語',
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
      // ふじ睡前那則是同一刻：只跳一則（bedNotice 決定誰說）。手機排著就寢提醒的話由手機發
      if (store.state.settings.notify && (document.hidden || !document.hasFocus()) && !byOther('bed', `bed@${store.state.rhythm.sleep}`)) {
        const out = bedNotice(Date.now(), { title: 'ひより · 就寢提醒', body: `預定 ${e.start} 就寢`, tag: 'bedtime' })
        if (out) systemNotify(out.title, out.body, out.tag)
      }
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
      // 拆成了小步驟：寫著從哪一步開始
      const step = nextStep(t)
      ui.toast({
        icon: '時', title: t.title, sub: `排在 ${e.start}・${busy ? '現在正在專注別件' : step ? `先做「${short(step.title, 16)}」` : '現在開始吧'}`, ms: 15000, tag: `start-${t.id}`,
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
      if (store.state.settings.notify && (document.hidden || !document.hasFocus()) && !byOther('taskStart', `${t.id}@${e.start}!`)) systemNotify(`ひより · ${t.title}`, `排在 ${e.start}，現在開始吧`, t.id)
      return
    }
    // 排定的任務排的時間到了還沒做完：問一聲做完了沒，寫著下一件是什麼（轉換最難：一不小心就做過頭）。
    // 正在專注這一件就不吵（到點時專注那邊會問）
    if (kind === 'taskEnd') {
      const t = store.state.tasks.find((x) => x.id === e.id)
      if (!t || t.done || (ui.focus.mode !== 'idle' && ui.focus.taskId === t.id)) return
      sfx.reminder()
      talk('taskEnd', { task: short(t.title) }, 6000, `「${short(t.title)}」排的時間到了，做完了嗎？`, 'fuji')
      // 下一件：今天接下來（剛開始 5 分鐘內的也算）有時段的日程、排了時段的任務裡最早的那個
      const n = new Date()
      const nowMin = n.getHours() * 60 + n.getMinutes()
      const next = [
        ...store.eventsOn(store.today).filter((x) => !x.done).map((x) => ({ at: x.start, title: x.title })),
        ...store.tasksOn(store.today).filter((x) => x.at && !x.done && x.id !== t.id).map((x) => ({ at: x.at, title: x.title })),
      ]
        .filter((x) => toMin(x.at) >= nowMin - 5)
        .sort((a, b) => toMin(a.at) - toMin(b.at))[0]
      // 時間在別處改過了（另一個分頁挪了、延長了）：不拿這張卡上的舊時間做事
      const cur = () => {
        const c = taskNow(e.id, e)
        if (c && c.dur !== e.dur) {
          ui.toast({ icon: '時', title: `「${short(c.title, 12)}」的時間已經改過了`, sub: `現在排到 ${minToHHMM(toMin(c.at) + (c.dur || 0))}`, ms: 4200 })
          return null
        }
        return c
      }
      // 預估最多 600 分鐘（10 小時，跟存檔的上限一樣）：快到了只加到 600，已經到了就不再加（加不上去的話之後也不會再問）
      const MAX_DUR = 600
      const more = () => {
        const c = cur()
        if (!c) return
        const add = Math.min(15, MAX_DUR - (c.dur || 0))
        if (add <= 0) return ui.toast({ icon: '時', title: '已經排到 10 小時了', sub: '先停下來休息，或明天再做吧', ms: 4200 })
        const dur = (c.dur || 0) + add
        store.updateTask(c.id, { dur })
        // 過了午夜才結束的照樣寫幾點（23:30 開始 75 分鐘 → 00:45）
        ui.toast({ icon: '時', title: `「${short(c.title, 12)}」再 ${add} 分鐘`, sub: `排到 ${minToHHMM((toMin(c.at) + dur) % 1440)}，到時候再問你`, ms: 4200 })
      }
      ui.toast({
        icon: '時', title: `「${t.title}」排的時間到了`, sub: next ? `做完了嗎？下一件：${next.at} ${short(next.title, 14)}` : '做完了嗎？', ms: 15000, tag: `end-${t.id}`,
        actions: [
          { label: '✓ 做完了', run: () => cur() && store.toggleTask(t.id) },
          ...((t.dur || 0) < MAX_DUR ? [{ label: '再 15 分鐘', soft: true, run: more }] : []),
          // 從今天算的明天（昨晚開始、過了午夜才結束的那件也是）
          { label: '明天再做', soft: true, run: () => cur() && ui._postpone(t.id, addDays(store.today, 1)) },
        ],
      })
      if (store.state.settings.notify && (document.hidden || !document.hasFocus())) systemNotify(`ひより · ${t.title}`, next ? `排的時間到了・下一件：${next.at} ${next.title}` : '排的時間到了，做完了嗎？', `end-${t.id}`)
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
    if (store.state.settings.notify && (document.hidden || !document.hasFocus()) && !byOther(kind, `${e.id}@${e.start}`)) systemNotify(`ひより · ${e.title}`, when, e.id)
  }, {
    // 警語交給手機、伺服器排時怎麼分工（見 reminders.js 的 _motto）
    external: () => mottoExternal(),
    hidden: (t) => (mottoPush ? mottoPush.defer(t, document.hidden) : document.hidden || nativeAway()),
    handled: () => (mottoPush ? mottoPush.done : nativeMottoHandled()),
    claim: (at) => (mottoPush ? mottoPush.claim(at) : nativeMottoClaim(at)),
    // App 關著、在背景時手機發過的日程、任務、就寢提醒：記成提醒過了（回到 App 不再跳一次提示卡）
    posted: () => [...nativeRemindPosted(), ...webShown.splice(0)],
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
  // until：算到幾點（到點時還在外面的那一次算到本來到點的時間：頁面晚一點才醒來的話，到點之後的那段不算）
  const leftApp = (since, until = Date.now()) => !!since && Math.min(until, Date.now()) - since >= AWAY_MIN && nativeAwayLocked() === false
  // 回到 App（頁面看得到了、重新打開）：離開 1 分鐘以上的說一聲還剩多久；切去用別的 App 的記一次中途離開。
  // quiet：剛從限時去回來（那邊已經說了「回來了」），這裡不再說還剩幾分鐘
  const cameBack = (quiet = false) => {
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
    if (quiet) return
    const t = focusTarget()
    const task = t ? `「${short(t)}」` : ''
    if (ui.focus.counting) {
      // 這一輪一共做了多久（延長的接著原定的長度算）
      const mins = Math.max(1, Math.floor(ui.focus.focusedMs / 60000))
      talk('focusBackUp', { task, mins }, 5200, `回來了。${task}已經做了 ${mins} 分鐘，接著做吧。`)
    } else {
      const left = Math.max(1, Math.ceil(ui.focus.left / 60000))
      talk('focusBack', { task, left }, 5200, `回來了。${task}還剩 ${left} 分鐘，接著做吧。`)
    }
  }
  // 離開：同一輪已經記著幾點離開的就不改（Android 的 App 在背景時先記下的那一刻比較準；關掉頁面時又會再收到一次）
  // 限時去（去 5 分鐘就回來）的時候切走又回來：就是回來了（記一次、說一聲，不另外說還剩幾分鐘）
  document.addEventListener('visibilitychange', () => (document.hidden ? trackAway(true) : cameBack(ui.focus.detourBack(true))))
  // 重新打開時（Android 在背景把 App 收掉了）：接著算剛才那一次。
  // 限時去的時候離開、App 被收掉之後又打開：也是回來了（離開不到 15 秒的是重新整理，不算）
  if (!document.hidden) {
    const left = !!awaySince && awaySid === ui.focus.sid && Date.now() - awaySince >= 15000
    cameBack(left && ui.focus.detourBack(true))
  }
  // 一輪專注結束（sid 是那一輪）：那時還在別的 App 裡的算一次中途離開，回傳有沒有算
  // until：這一輪本來到點的時間（自己按「做完了」的沒有，算到現在）。算了的話也記進這一輪的次數（延長、重新整理後接得回來）
  awayAtEnd = (sid, until) => {
    const since = awaySince
    const mine = !!since && awaySid === sid
    if (since) setAway(0)
    if (!mine || !leftApp(since, until || Date.now())) return false
    ui.focus.noteAway(sid)
    store.focusLeft()
    return true
  }
  // 到點自動延長了（同一輪接著做，換成延長那一段的 id）：還沒回來的那一段接著算，回來時、做完時照常記一次
  awayFlow = (from, to) => {
    if (awaySince && awaySid === from) setAway(awaySince, to)
  }
  // 離開了 AWAY_NUDGE 還沒回來：通知叫你回來（一則；那時這一輪已經快結束的不用，到點的通知會叫你）。設定裡可以關。
  // 限時去（說好「去 5 分鐘就回來」）：就在說好的時間叫（說好的前一下子才離開的也是）；是自己要的，設定關著也叫。
  // 已經在 App 裡叫過了（之後才離開的）：照一般的離開算
  const backItem = () => {
    const detour = ui.focus.detour && !ui.focus.detourRang ? ui.focus.detour : 0
    if (!awaySince || !focusing() || awaySid !== ui.focus.sid || !nativeBack() || (store.state.settings.awayNudge === false && !detour)) return null
    const at = detour || awaySince + AWAY_NUDGE
    // 這一輪最晚幾點結束（到點會自動延長的倒數是延長做滿的時間：到點那一刻不通知，所以照樣要叫你）
    const end = ui.focus.boundary?.at || 0
    if (!(end - at > 60000)) return null
    const t = focusTarget()
    const what = t ? `「${short(t, 16)}」` : ''
    // 還剩幾分鐘照原定到點的時間算；叫你的時候已經到點、在自動延長了的，就不寫還剩多久
    const left = Math.round((ui.focus.endAt - at) / 60000)
    const body = detour
      ? `說好的 5 分鐘到了，回來接著做${what || '正事'}吧`
      : ui.focus.counting || left < 1
        ? `${what}還在專注中，回來接著做吧`
        : `${what}還在專注中，還剩 ${left} 分鐘。回來吧`
    return { at, title: 'ひより · 專注中', body, back: true }
  }

  // ── 桌機的網頁：專注中切到別的分頁太久，叫你回來 ──
  // 切到別的分頁（縮小視窗）AWAY_NUDGE 還沒回來、這段時間也沒有別的分頁看著 App（看得到的分頁每分鐘記一次「還在看」）：
  // 系統通知叫你一次（同一段離開只叫一次，別的分頁叫過的也算：記在 TAB_NUDGE_KEY）。頁面在背景時計時器照樣每秒跑，叫得到。
  // 工作本身就在別的分頁的人會被吵，預設關著（設定裡打開）；手機的網頁分不出鎖螢幕和切走，不做。
  // 說好「去 5 分鐘就回來」的到說好的時間才叫（detourDue）；這一輪再一下就到點的不叫（到點的通知會叫你）
  const TAB_NUDGE_KEY = 'hiyori-tab-nudge'
  let tabMem = null
  // 正在等鎖（同一個分頁不疊好幾個要求）
  let tabBusy = false
  const tabLast = () => {
    try {
      return JSON.parse(localStorage.getItem(TAB_NUDGE_KEY) || 'null') || tabMem
    } catch {
      return tabMem
    }
  }
  const tabNudge = () => {
    if (store.state.settings.tabNudge !== true || !deskWeb() || !notifyOn()) return
    if (!document.hidden || !awaySince || !focusing() || awaySid !== ui.focus.sid) return
    const now = Date.now()
    const seen = ui.lastSeen()
    const since = Math.max(awaySince, seen)
    // 限時去：說好的時間還沒到（到時會叫），或是這一段離開的時候已經叫過「說好的 5 分鐘到了」：不再叫
    const d = ui.focus.detour
    if (d && (!ui.focus.detourRang || d >= since)) return
    if (now - since < AWAY_NUDGE) return
    const end = ui.focus.boundary?.at || 0
    if (!(end - now > 60000)) return
    const sid = ui.focus.sid
    // 這一段離開還沒叫過（別的分頁叫過的也算）：記下來、叫一次。回傳有沒有輪到這邊叫
    const claim = () => {
      const last = tabLast()
      if (last?.sid === sid && last.at >= ui.lastSeen()) return false
      tabMem = { sid, at: Date.now() }
      try {
        localStorage.setItem(TAB_NUDGE_KEY, JSON.stringify(tabMem))
      } catch {}
      return true
    }
    const send = () => {
      if (ui.focus.sid !== sid || !focusing()) return
      const t = focusTarget()
      const what = t ? `「${short(t, 16)}」` : ''
      // 還剩幾分鐘照原定到點的時間算（到點會自動延長的，最晚結束的時間更晚）
      const left = Math.round((ui.focus.endAt - Date.now()) / 60000)
      systemNotify('ひより · 專注中', ui.focus.counting || left < 1 ? `${what}還在專注中，回來接著做吧` : `${what}還在專注中，還剩 ${left} 分鐘。回來吧`, 'away')
    }
    // 背景的分頁計時器會對齊在整秒上，兩個分頁可能同一刻都看到「還沒叫過」：拿到鎖的那一邊在鎖裡再看一次才叫
    // （拿不到的這一秒先不看，下一秒會看到記錄）。沒有 Web Locks 的瀏覽器照舊直接看
    if (!navigator.locks?.request) return claim() && send()
    if (tabBusy) return
    tabBusy = true
    navigator.locks
      .request(TAB_NUDGE_KEY, { ifAvailable: true }, (lock) => {
        if (lock && claim()) send()
      })
      .catch(() => {})
      .finally(() => (tabBusy = false))
  }
  // 回到頁面：還留在通知中心的「回來吧」「說好的 5 分鐘到了」收掉
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || native) return
    closeNotify('away')
    closeNotify('detour')
  })

  // ── 警語交給別人排：App 關著、手機鎖著也照時間通知 ──
  // 排好接下來到明天就寢的每一則（幾點、念哪一句、現在該做哪一件）。專注中的那一段不排；剛到點、還沒人處理的那一則留著。
  //   Android 殼：整串交給手機，手機的鬧鐘一則一則發；App 在前面時手機不發，頁面自己念（離開 App 的那一刻還有到點沒念的，手機補發）
  //   網頁：字存在這台的快取裡，離開頁面時把時間交給伺服器（mottoPush.sync），伺服器到點推、Service Worker 顯示；看得到頁面時頁面自己念
  // 會影響排法的東西（planKey：設定、作息、警語、上次念到哪、專注、現在該做的那件、排到幾點）變了才重排。
  // 每秒看一次；改了資料、專注開始或結束、離開頁面時馬上看一次。leaving：頁面正要關掉（pagehide 時還不一定是 hidden）
  let mottoSig = ''
  let mottoItems = []
  // 上一次看的時候提醒是不是關著、停著（網頁版：剛關掉、剛按先停的那一刻叫 mottoPush.hush）。
  // 開機時是 null：開機那一刻本來就關著的不算「剛關掉」（沒開通知的裝置不用為此建推播的快取）
  let mottoHushed = null
  syncMottos = (leaving = false) => {
    if (!mottoPush && !nativeMottos()) return
    const now = Date.now()
    const s = store.state
    // 時鐘被往回調了：推播那邊念到哪改回現在，照新的起點重排
    if (mottoPush?.rewind(now)) mottoSig = ''
    // 網頁版：自己關掉了提醒（間隔改成不提醒、警語都收起來了）、按了先停的那一刻，已經到點、推播還在路上的那幾則晚到時不出聲
    const hushed = !(s.settings.mottoEvery > 0) || !activeMottos(s.mottos).length || pausedUntil(s.settings, now) > 0
    if (mottoPush && hushed && mottoHushed === false) mottoPush.hush(now)
    mottoHushed = hushed
    const on = mottoExternal()
    const quietUntil = ui.focus.mode === 'focus' ? ui.focus.boundary?.at || 0 : 0
    // 剛寫下第一句、剛打開提醒：先定好從什麼時候開始算（不等下一秒的檢查），才排得出那一串
    if (on) reminders.startMotto(now)
    const task = on ? nowTask() : null
    // 專注中離開了：叫你回來的那一則排在最前面（它在這一輪結束前，警語都排在這一輪之後；back：通知上不放警語的按鈕）
    trackAway(away() || leaving)
    const back = on ? backItem() : null
    const quiet = on ? eventsQuiet(now) : []
    const sig = (on ? planKey({ every: s.settings.mottoEvery, rhythm: s.rhythm, mottos: s.mottos, last: reminders.mottoState(), quietUntil, pause: pauseOf(s.settings), quiet, task: task ? `${task.title}\n${nextStep(task)?.title || ''}` : '', now }) : 'off') + (back ? `|back:${back.at}:${back.body}` : '')
    if (sig !== mottoSig) {
      const since = Math.max(now - MOTTO_LATE, mottoPush ? mottoPush.done : nativeMottoHandled())
      const max = mottoPush ? MOTTO_PUSH_MAX : undefined
      const items = on
        ? [
            ...(back ? [back] : []),
            // sleep：那一段醒著的時間到幾點（推播晚到、過了就寢才送到的話，Service Worker 不出聲地放）
            ...reminders
              .mottoPlan(now, { quietUntil, quiet, since, ...(max ? { max } : {}) })
              .map((p) => ({ at: p.at, title: 'ひより · 給自己的警語', body: mottoBody(p.text, task), ...(task ? { focus: true } : {}), ...(mottoPush ? { sleep: windowEnd(s.rhythm, p.at) } : {}) })),
          ].slice(0, max)
        : []
      if (mottoPush) {
        mottoItems = items
        mottoSig = sig
      } else if (sendMottos(items)) {
        mottoSig = sig
        backSent = back?.at || 0
      } // 沒送到（例如殼剛好出錯）：下一秒再試
    }
    const hidden = document.hidden || leaving
    // ふじ在 App 關著時的通知：網頁跟警語排在同一串交給伺服器（伺服器只知道幾點），Android 殼交給手機的鬧鐘
    const notes = planFuji(now, hidden)
    if (native) sendFujiNotes(notes)
    mottoPush?.sync(withNotes(mottoItems, notes, hidden, now), hidden, now)
  }
  // ── ふじ在 App 關著時的通知（src/fujiNotes.js）：照現在的資料先寫好。資料變了、每分鐘、看得到和看不到頁面之間換了時重寫 ──
  let fujiList = []
  let fujiAt = 0
  let fujiDirty = true
  let fujiHidden = null
  // 睡前那則（這台的，FUJI_BED_KEY）：就寢提醒（就寢前 30 分鐘起的 10 分鐘內）跟它是同一刻。{ beds: [{ at, title, body }], claimed: [at] }
  //   beds：排過的（到點的留著，重新整理後還認得出來；還沒到的照每次重算換掉：改了就寢時間、被挪走了）
  //   claimed：就寢提醒跳出來時那一則還沒送、由網頁說了的：之後不再交給伺服器和手機
  const FUJI_BED_KEY = 'hiyori-fuji-bed'
  const readBeds = () => {
    try {
      const v = JSON.parse(localStorage.getItem(FUJI_BED_KEY) || 'null')
      return { beds: Array.isArray(v?.beds) ? v.beds.filter((b) => Number.isFinite(b?.at) && typeof b.title === 'string') : [], claimed: Array.isArray(v?.claimed) ? v.claimed.filter(Number.isFinite) : [] }
    } catch {
      return { beds: [], claimed: [] }
    }
  }
  const writeBeds = (v) => {
    try {
      localStorage.setItem(FUJI_BED_KEY, JSON.stringify(v))
    } catch {}
  }
  // 就寢提醒要跳系統通知時，跟ふじ睡前那則只跳一則：回傳要跳的 { title, body, tag }，不用跳是 null
  //   沒排那一則（這台不收ふじ的通知、被開會或專注挪走、挪進睡覺時間）：照一般的就寢提醒
  //   Android：手機排著的話請手機現在用ふじ的通知類別發（發過了就不再發）；手機沒排這一則才由網頁用ふじ的字說
  //   網頁：頁面在背景、伺服器排著這一則就交給推播，到點一分鐘後 Service Worker 還沒顯示（推播掉了）頁面再補；
  //   不然頁面自己說。頁面說了的記下來，之後不再交出去；推播還是來了的話同一個 tag 換掉，只留一則
  const bedNotice = (now, generic) => {
    const r = readBeds()
    const dist = (b) => Math.abs(b.at - now)
    const n = fujiOn() ? r.beds.filter((b) => dist(b) < 15 * 60000).sort((a, b) => dist(a) - dist(b))[0] : null
    if (!n) return generic
    if (r.claimed.includes(n.at)) return null
    const say = { title: n.title, body: n.body, tag: 'fuji' }
    const claimed = () => {
      const cur = readBeds()
      if (!cur.claimed.includes(n.at)) writeBeds({ ...cur, claimed: [...cur.claimed, n.at].slice(-4) })
      fujiDirty = true
      return say
    }
    // 手機發了或網頁要說：都記下來，之後不再交給手機（不然重排時又排回去）
    if (native) {
      const sent = nativeFujiNow(n.at)
      claimed()
      return sent ? null : say
    }
    if (document.hidden && mottoPush?.covers(n.at, now)) {
      setTimeout(async () => {
        await mottoPush.refresh().catch(() => {})
        if (mottoPush.done >= n.at || readBeds().claimed.includes(n.at)) return
        claimed()
        systemNotify(say.title, say.body, say.tag)
      }, Math.max(0, n.at - Date.now()) + 60000)
      return null
    }
    return claimed()
  }
  // 最後一次正看著 App 的時間：那之前已經打開過 App，今天早上那則就不送
  let lookedAt = Date.now()
  store.on('dirty', () => (fujiDirty = true))
  // 排好的風險那則（RISK_NOTES_KEY，這台的）：到點了就當成說過了（推播、手機都是照時間送，不用等送到的回音），
  // 記進風險的紀錄（riskWatch.mark）：App 開著時、下一次重算時不再為同一件事說一次；那天也不再排第二則（days）
  const RISK_NOTES_KEY = 'hiyori-fuji-risk'
  const readRiskNotes = () => {
    try {
      const v = JSON.parse(localStorage.getItem(RISK_NOTES_KEY) || 'null')
      return { notes: Array.isArray(v?.notes) ? v.notes.filter((n) => Number.isFinite(n?.at)) : [], days: Array.isArray(v?.days) ? v.days : [] }
    } catch {
      return { notes: [], days: [] }
    }
  }
  const writeRiskNotes = (v) => {
    try {
      localStorage.setItem(RISK_NOTES_KEY, JSON.stringify(v))
    } catch {}
  }
  const settleRisk = (now) => {
    const r = readRiskNotes()
    const past = r.notes.filter((n) => n.at <= now)
    if (!past.length) return r.days
    for (const n of past) if (typeof n.due === 'string') risk.mark(n.due, n.level)
    const days = [...new Set([...r.days, ...past.map((n) => dateStr(new Date(n.at)))])].slice(-6)
    writeRiskNotes({ notes: r.notes.filter((n) => n.at > now), days })
    fujiDirty = true
    return days
  }
  const fujiOn = () => {
    const s = store.state.settings
    return agent.ready() && s.agentMode !== 'off' && fujiNotes.here() && fujiNotes.reach() === 'ok'
  }
  const own = (x) => !store.isSample(x)
  const planFuji = (now, hidden) => {
    if (!hidden && !(native && nativeAway())) lookedAt = now
    if (!fujiDirty && hidden === fujiHidden && now - fujiAt < 60000) return fujiList
    const riskDays = settleRisk(now)
    fujiDirty = false
    fujiHidden = hidden
    fujiAt = now
    const saveRisk = () => writeRiskNotes({ notes: fujiList.filter((n) => n.kind === 'risk').map(({ at, due, level }) => ({ at, due, level })), days: riskDays })
    const beds = readBeds()
    if (!fujiOn()) {
      fujiList = fujiList.length ? [] : fujiList
      saveRisk()
      if (beds.beds.length) writeBeds({ ...beds, beds: [] })
      return fujiList
    }
    let planned = fujiList
    try {
      planned = planNotes({
        riskDays,
        // 別的分頁看過的也算（ui.lastSeen：看得到的分頁每分鐘記一次）：在背景很久的分頁不會把今天早上那則又排回去
        // 範例不算
        today: store.today, now, seen: Math.max(lookedAt, ui.lastSeen()), rhythm: store.state.rhythm, tasks: store.state.tasks.filter(own),
        tasksOn: (d) => store.tasksOn(d).filter(own), eventsOn: (d) => store.timedEventsOn(d).filter(own), ratio: store.estimate()?.ratio || 1,
        memo: risk.memo(), quietUntil: ui.focus.mode === 'focus' ? ui.focus.boundary?.at || 0 : 0, auto: agent.auto(),
      })
    } catch (e) {
      console.warn('[hiyori] ふじ的通知沒排好', e)
    }
    // 網頁已經自己說了的那一則不再交出去
    const claimed = beds.claimed.filter((at) => now - at < 2 * 86400000)
    // 設定裡關了「建議和鼓勵」：不送截止日的風險；關了「時間到的提醒」：不送睡前那則
    planned = planned.filter((n) => (n.kind !== 'risk' || store.nudge()) && (n.kind !== 'bed' || store.state.settings.remindOn !== false))
    fujiList = planned.filter((n) => !claimed.includes(n.at))
    // 睡前那則：到點的留著（12 小時內），還沒到的照這次排的換掉
    const keepBeds = [...beds.beds.filter((b) => b.at <= now && now - b.at < 12 * 3600000).slice(-2), ...planned.filter((n) => n.kind === 'bed').map(({ at, title, body }) => ({ at, title, body }))]
    const nextBeds = { beds: keepBeds, claimed }
    if (JSON.stringify(nextBeds) !== JSON.stringify(beds)) writeBeds(nextBeds)
    saveRisk()
    return fujiList
  }
  // 跟警語併成一串（照時間排：伺服器照第一則排鬧鐘）。看得到頁面時，已經過了的那幾則拿掉（使用者正看著，不用再推；
  // 不然離開頁面時會被當成剛到點、還沒送的補推）。fuji：Service Worker 用ふじ自己的通知顯示
  // 日程、任務、就寢的提醒（webReminds，remind: true）也併進來
  let mixed = { m: null, n: null, r: null, k: -1, list: [] }
  const withNotes = (items, notes, hidden, now) => {
    const keep = hidden ? notes : notes.filter((n) => n.at > now)
    const reminds = webReminds
    if (mixed.m === items && mixed.n === notes && mixed.r === reminds && mixed.k === keep.length) return mixed.list
    const list = keep.length || reminds.length ? [...items, ...keep.map((n) => ({ at: n.at, title: n.title, body: n.body, fuji: true })), ...reminds].sort((a, b) => a.at - b.at) : items
    mixed = { m: items, n: notes, r: reminds, k: keep.length, list }
    return list
  }
  store.on('dirty', () => syncMottos())
  document.addEventListener('visibilitychange', () => document.hidden && syncMottos())
  addEventListener('pagehide', () => syncMottos(true))

  // ── 日程、排定的任務、就寢的提醒：App 關著、手機鎖著也照時間響（src/remindPlan.js 排好接下來 47 小時的每一則）──
  //   Android 殼：交給手機的鬧鐘（App 在前面時手機不發，頁面自己提醒）
  //   網頁：跟警語排在同一串（remind: true），離開頁面時把時間交給伺服器，推播到了 Service Worker 顯示（看得到頁面時頁面自己提醒）
  // 資料變了、每分鐘、離開 App 時重排（一樣的不重送）
  let remindDirty = true
  let remindAt = 0
  // 就寢提醒的字：ふじ那一晚有排睡前那則（同一刻）就不排，沒排的晚上（被開會、專注挪走了）照一般的就寢提醒
  const bedText = (at) =>
    fujiOn() && fujiList.some((n) => n.kind === 'bed' && Math.abs(n.at - at) < 15 * 60000) ? null : { title: 'ひより · 就寢提醒', body: `預定 ${store.state.rhythm.sleep} 就寢` }
  let webRemindsKey = '[]'
  syncReminds = (force = false) => {
    const phone = nativeReminders()
    if (!phone && !mottoPush) return
    const now = Date.now()
    if (!force && !remindDirty && now - remindAt < 60000) return
    remindDirty = false
    remindAt = now
    const items = remindPlan(store, now, { sent: reminders.sent, bed: bedText })
    if (phone) {
      if (sendReminders(items)) sentReminds = items
      return
    }
    // 一樣的就留著同一份（mottoPush.sync 照這一串有沒有換決定要不要重存、重送）
    const key = JSON.stringify(items)
    if (key === webRemindsKey) return
    webRemindsKey = key
    webReminds = items.map((x) => ({ ...x, remind: true }))
    sentReminds = items
    syncMottos()
  }
  // 回到頁面：鎖著、關著時 Service Worker 顯示過的提醒先讀進來，記成提醒過了（不再跳提示卡）
  const readShown = () => mottoPush?.remindShown().then((v) => webShown.push(...v)).catch(() => {})
  document.addEventListener('visibilitychange', () => !document.hidden && readShown())
  readShown()
  store.on('dirty', () => (remindDirty = true))
  document.addEventListener('visibilitychange', () => document.hidden && syncReminds(true))
  addEventListener('pagehide', () => syncReminds(true))

  // ── 同步：線上同步（同步碼，手機也能用）＋資料夾同步（資料寫進 OneDrive／Dropbox 裡的檔案）。兩種可以同時開 ──
  const onConflict = () => ui.toast({ icon: '雲', title: '兩邊都有新的變更', sub: '到「設定 → 資料與同步」選要保留哪一邊', ms: 7000 })
  // 剛說了別台的計時（那一張就夠了，「已同步別台裝置的變更」不再說）
  let timerSaid = 0
  const pulledToast = (o) => Date.now() - timerSaid > 3000 && ui.toast(o)
  // ふじ的 AI 通行碼和選的模型跟著同步碼走：放在加密的那一包裡帶到別台（伺服器看不到），別台輸入同步碼就能用，不用再填、再選一次。
  // 通行碼、模型各自用比較新設的那一個（src/ai.js 的 aiExtras）
  const cloudSync = new CloudSync(store, {
    extras: aiExtras(({ pass }) => {
      // 別台設的通行碼、選的模型到了：設定那一列跟著變、ふじ的卡片出現、之前連不上的再試
      ui.aiShared()
      if (pass) ui.toast({ icon: '藤', stamp: true, title: 'ふじ的 AI 通行碼同步過來了', sub: '別台設好的，這台不用再填一次', ms: 6000 })
      else ui.toast({ icon: '藤', stamp: true, title: aiModel() === 'auto' ? 'ふじ改成自動選模型了' : `ふじ改用 ${AI_MODELS.find((m) => m.id === aiModel())?.label || 'Claude'} 了`, sub: '別台選的模型，這台跟著換', ms: 5000 })
    }),
    onStatus: () => ui.renderSync(),
    onPulled: () => pulledToast({ icon: '雲', title: '已同步別台裝置的變更', sub: '線上同步' }),
    onConflict,
  })
  const fileSync = new FileSync(store, {
    onStatus: () => ui.renderSync(),
    onPulled: () => pulledToast({ icon: '雲', title: '已載入雲端的新資料', sub: '別台裝置的變更同步過來了' }),
    onConflict,
  })
  ui.attachCloud(cloudSync)
  ui.attachSync(fileSync)
  // 這台的通行碼、模型還沒跟著同步送上去過（剛設、剛換，或這個功能上線前就設好的）：送一次（同步接上後也看一次）
  const shareAi = () => {
    if (cloudSync.state !== 'off' && cloudSync.state !== 'unsupported' && aiUnshared()) store.save()
  }
  hooks.aiSet = shareAi
  // 開機時的第一次同步：做完之前，到點晚了的那一輪先等它（別台可能已經接手記好了）
  let syncBooted = false
  const syncBoot = Promise.allSettled([cloudSync.init().then(shareAi, () => {}), fileSync.init()]).then(() => (syncBooted = true))
  const syncLinked = () => cloudSync._canSync() || fileSync._canSync()
  const syncAll = () => Promise.allSettled([cloudSync.sync(), fileSync.sync()])

  // ── 跨裝置的計時：計時的樣子放在小島資料裡跟著同步走（store.state.timer，記著是哪一台、哪一次）。
  // 這台按了開始、暫停、延長、結束，或到點時接手了：馬上送（不等平常的 1.5 秒）；別台打開、切回來、定期同步時換成同一份，
  // 到點的通知、Android 的即時倒數跟著排，那一台也會響。到點時由這一輪的主人記（見 focus.js 的 _hold），每一輪只記一次 ──
  // 最後一次同步好是什麼時候（開著的同步裡最近的那一個）：開機還沒同步過是 0
  const lastSynced = () => Math.max(cloudSync._canSync() ? cloudSync.lastSync : 0, fileSync._canSync() ? fileSync.lastSync : 0)
  timerShared = () => {
    if (syncBooted && !syncLinked()) return null
    const t = store.state.timer
    return {
      mine: !t || t.by === deviceId(),
      // 剛同步過（看著的時候每 30 秒一次）：到點照做；不然先同步一次（見 focus.js 的 _hold）
      fresh: syncBooted && Date.now() - lastSynced() < 45000,
      sync: () => syncBoot.then(() => (syncLinked() ? syncAll() : null)),
    }
  }
  // 這台最後送出去的是哪一次：拉回來的是這台以前送的、比較舊的那一份（兩邊都改過、選了用雲端的）時，換回那一份
  const SENT_KEY = 'hiyori-focus-sent'
  let sentMem = ''
  const sentV = () => {
    try {
      return localStorage.getItem(SENT_KEY) ?? sentMem
    } catch {
      return sentMem
    }
  }
  shareTimer = (t) => {
    if (!syncLinked()) return
    const v = newRev().slice(0, 24)
    sentMem = v
    try {
      localStorage.setItem(SENT_KEY, v)
    } catch {}
    store.setTimer({ ...t, by: deviceId(), v })
    syncAll()
  }
  // 別台的計時換過來了：說一聲（開始、暫停、繼續、那一輪記下了、結束；只換了目標就不說）
  const timerToast = (r) => {
    const what = r.target ? `「${short(r.target, 12)}」` : ''
    let o = null
    if (r.mode === 'focus' && r.was.mode !== 'focus') o = r.paused ? { title: '另一台的專注暫停中', sub: `${what}按繼續就接著算` } : { title: '另一台開始專注了', sub: `${what}這台也跟著計時` }
    else if (r.mode === 'focus' && r.paused && !r.was.paused) o = { title: '另一台暫停了計時', sub: what || '按繼續就接著算' }
    else if (r.mode === 'focus' && !r.paused && r.was.paused) o = { title: '另一台繼續計時了', sub: what || '接著算' }
    else if (r.mode === 'break' && r.was.mode === 'focus') o = { title: '這一輪在另一台記下了', sub: r.rounds > 1 && r.round < r.rounds ? `休息一下，接著第 ${r.round + 1} 輪` : '這台也跟著休息' }
    else if (r.mode === 'idle' && r.was.mode !== 'idle') o = { title: '另一台結束了計時', sub: '這台也停下來了' }
    if (!o) return false
    ui.toast({ icon: '時', ms: 5000, tag: 'focus', ...o })
    return true
  }
  // 同步拉回來的那一份（soft）：不是這台最後送的那一次就換過來。同一台的另一個分頁有自己的通道（focus.js 的 storage 事件）；
  // 匯入、還原備份不算（store 那邊留著現在的計時）
  store.on('reload', ({ soft } = {}) => {
    const t = store.state.timer
    if (!soft || !t || (t.by === deviceId() && t.v === sentV())) return
    const r = ui.focus.fromSync(t)
    if (r && timerToast(r)) timerSaid = Date.now()
  })
  // 分享連結（#sync=同步碼）：先從網址拿掉，再到設定裡等使用者按「連線」
  const linkCode = codeFromHash()
  if (linkCode) {
    history.replaceState(null, '', location.pathname + location.search)
    ui.offerCloud(linkCode)
  }

  // ── 時間 ──
  let lastMin = -1
  // Android 的 App 現在在背景嗎（手機說的；上一秒的樣子）
  let nativeOut = false
  // 最後一次在這一頁點、按鍵的時間：手機說 App 在背景、手上卻還在操作（殼的訊號卡住了）的話，照樣記「還在看」
  let lastInput = 0
  const touched = () => (lastInput = Date.now())
  // 留著的慶祝等一下就放（見下面每秒的檢查）
  let cheerT = 0
  addEventListener('pointerdown', touched, { capture: true, passive: true })
  addEventListener('keydown', touched, { capture: true })
  // ── 截止日、專案的風險變差了：說一次（一分鐘最多看一次；開場好了、頁面在前面、沒在專注、早上 8 點到就寢前才看，
  // 沒看的那幾次等下次再比，不會漏掉）。很緊的截止日接著 Claude 時交給ふじ排（riskDue），這裡只在沒接時提醒；
  // 來不及、專案會晚的只提醒、給「跟ふじ商量」，不自己動別的事（要犧牲什麼是使用者的取捨）
  let riskAt = 0
  const riskTick = () => {
    if (!booted || document.hidden || ui.focus.mode === 'focus' || Date.now() - riskAt < 60000) return
    const n = new Date()
    const mins = n.getHours() * 60 + n.getMinutes()
    if (mins < 480 || mins >= Math.min(bedAt(store.state.rhythm), 1440)) return
    riskAt = Date.now()
    // 建議類的一則：打字中、剛說過別的、今天說夠了、關掉了建議就先不比（等下次再比，不會漏掉）
    if (!store.nudge() || suggestBusy() || !suggestRoom()) return
    suggest('risk', riskSay)
  }
  // 比一次、說變差的那一個；沒有要說的回傳 false（不算一則）
  const riskSay = () => {
    // App 關著時已經用通知說過的，先記成說過了（打開時不再說一次）
    settleRisk(riskAt)
    const got = risk.check()
    // 說過的等級變了：ふじ的通知照新的重排
    if (got.due.length || got.projects.length) fujiDirty = true
    const name = (id) => store.state.tasks.find((t) => t.id === id)?.title || ''
    const day = (d) => dayWord(d, store.today)
    const ask = (text) => (agent.ready() ? [{ label: '跟ふじ商量', run: () => ui.openFuji(text) }] : [])
    const late = got.due.filter((r) => r.level === 'late')
    const tight = agent.auto() ? [] : got.due.filter((r) => r.level === 'tight')
    const r = late[0] || tight[0]
    if (r) {
      const titles = r.ids.slice(0, 2).map((id) => `「${short(name(id), 14)}」`).join('') + (r.ids.length > 2 ? ` 等 ${r.ids.length} 件` : '')
      const more = late.length + tight.length > 1 ? `・還有 ${late.length + tight.length - 1} 個截止日也要注意` : ''
      sfx.chime()
      if (r.level === 'late') {
        say('fuji', `${titles}${day(r.date)}截止，照現在的空檔排不下，我們一起想個辦法吧。`, 7000)
        ui.toast({
          icon: '旗', title: `${titles}${day(r.date)}截止，照現在的空檔做不完`, sub: `還要大約 ${fmtDur(r.need)}，到那天能用的大約 ${fmtDur(r.room)}${more}`, ms: 12000,
          actions: [...ask(`${titles}${day(r.date)}要交，照現在的空檔做不完（還要大約 ${fmtDur(r.need)}，能用的大約 ${fmtDur(r.room)}），幫我想想辦法`), { label: '看看', soft: true, run: () => ui.setTab('tasks') }],
        })
      } else {
        say('fuji', `${titles}${day(r.date)}截止，時間有點緊，先把它分段排進前幾天吧。`, 6000)
        ui.toast({ icon: '旗', title: `${titles}${day(r.date)}截止，時間有點緊`, sub: `還要大約 ${fmtDur(r.need)}，到那天能用的大約 ${fmtDur(r.room)}${more}`, ms: 10000, actions: [{ label: '看看', soft: true, run: () => ui.setTab('tasks') }] })
      }
      return true
    }
    const p = got.projects[0]
    if (!p) return false
    const proj = store.state.projects.find((x) => x.id === p.id)
    if (!proj) return false
    const pname = `「${short(proj.name, 16)}」`
    sfx.chime()
    if (p.level === 'late') {
      say('fuji', `${pname}照最近的速度，會比期限晚 ${p.late} 天完成。`, 7000)
      ui.toast({
        icon: '町', title: `${pname}照最近的速度會晚 ${p.late} 天`, sub: `還有 ${p.left} 個里程碑，最近大約一週 ${p.pace} 個；期限 ${day(p.deadline)}`, ms: 12000,
        actions: [...ask(`${pname}照最近的速度會比期限晚 ${p.late} 天完成（還有 ${p.left} 個里程碑），幫我想想辦法`), { label: '看看', soft: true, run: () => ui.openProject(proj.id) }],
      })
    } else {
      say('fuji', `${pname}停了 ${p.idle} 天了，離期限還有一段，今天推一小步就好。`, 7000)
      ui.toast({
        icon: '町', title: `${pname}停了 ${p.idle} 天`, sub: `還有 ${p.left} 個里程碑；期限 ${day(p.deadline)}`, ms: 12000,
        actions: [...ask(`${pname}停了一陣子，幫我排一個今天做得到的下一步`), { label: '看看', soft: true, run: () => ui.openProject(proj.id) }],
      })
    }
  }
  // ── 第一次：問一聲要不要在 App 關著時通知（還沒選過、這台是手機、接著 Claude、ふじ會自己動、送得出去）。
  // 沒回答的話照預設送（手機先送），一天最多問一次；打開 App 半分鐘後才問（不跟開場的提示卡擠在一起）──
  const NOTES_ASK_KEY = 'hiyori-fuji-notes-asked'
  let notesFrom = Date.now() + 30000
  let notesAsked = false
  const askNotes = () => {
    if (notesAsked || !booted || document.hidden || ui.focus.mode === 'focus' || Date.now() < notesFrom) return
    const s = store.state.settings
    if (s.fujiNotify || !phoneLike || !agent.ready() || s.agentMode === 'off') return
    if (['old-app', 'none'].includes(fujiNotes.reach())) return
    try {
      if (localStorage.getItem(NOTES_ASK_KEY) === store.today) return
    } catch {}
    // 建議類的一則：打字中、剛說過別的、今天說夠了就晚一分鐘再看
    if (ui.brief.open || !suggestRoom() || suggestBusy()) return (notesFrom = Date.now() + 60000)
    notesAsked = true
    suggest('notes', () => {
      try {
        localStorage.setItem(NOTES_ASK_KEY, store.today)
      } catch {}
      ui.toast({
        icon: '藤', stamp: true, tag: 'fuji-notes', ms: 30000,
        title: 'App 關著的時候，要我通知你嗎？',
        sub: '一天最多 3 則：早上今天的安排、截止日有風險時、睡前明天先做哪件。開會、專注、睡覺時不吵你',
        actions: [
          { label: '好', run: async () => (await fujiNotes.set(true)) && ui.toast({ icon: '藤', stamp: true, title: '好，之後從這台通知你', sub: '想換一台或不要了，到ふじ的頁面改' }) },
          { label: '不用', soft: true, run: () => fujiNotes.set(false) },
        ],
      })
    })
  }
  setInterval(() => {
    ui.tickClock()
    // 先跨日再提醒：剛過午夜（或睡眠喚醒）時才不會拿昨天的日期算重要日子
    const rolled = store.tick()
    // 開場還沒好（小島模式要等小島建好，載入畫面還蓋著）時先不提醒：提示卡會被蓋在載入畫面後面、到時間就收掉，
    // 等於沒看到，警語還會被當成念過了（手機那邊也不再發）。開場一好，下一秒就照常檢查
    if (booted) reminders.check()
    riskTick()
    askNotes()
    suggestRetry()
    syncMottos()
    syncReminds()
    tabNudge()
    // 到點自動延長時留著的慶祝（升級、成就、任務達成）：延長做完了（休息、結束、另一個分頁結束了），
    // 等做完的那一句、提示卡先出來再放
    if (!cheerT && store.heldCheers && !(ui.focus.mode === 'focus' && ui.focus.ext && ui.focus.cap > 0)) {
      cheerT = setTimeout(() => {
        cheerT = 0
        store.releaseCheers()
      }, 2400)
    }
    // Android 的 App：切到別的 App 時頁面不一定馬上變成看不到（document.hidden），照手機說的算——
    // 在背景時記下離開的時間、不再每分鐘記「還在看」；回到前景時當成回來了（離開夠久就提醒現在該做）
    if (native) {
      const out = nativeAway()
      if (out && !nativeOut && !document.hidden) ui.markSeen(true)
      if (!out && nativeOut && !document.hidden) {
        ui.returned()
        // 限時去的時候切去用別的 App、又回來了
        ui.focus.detourBack(true)
        setTimeout(() => !ui.brief.open && welcomeBack(), 700)
      }
      nativeOut = out
    }
    // 還沒有小島：天色照時間算（傍晚自然換深色玻璃）
    if (!scene) syncNight(lookNight())
    if (rolled) return
    const minute = Math.floor(Date.now() / 60000)
    if (minute !== lastMin) {
      lastMin = minute
      // 日程頁沒在看就不重畫（切過去時會重畫）
      if (store.selectedDate === store.today && ui.tab === 'schedule') ui.renderSchedule(false)
      ui.tickEve()
      if (!scene?.placing && ui.focus.mode !== 'focus') askWeek() || askReview()
      if (!nativeOut || Date.now() - lastInput < 60000) ui.markSeen()
      // ふじ：該不該自己整理一次（早上、晚上、進度落後）
      if (!nativeOut) agent.tick()
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
        // 這台畫不出 3D（瀏覽器關了 WebGL、顯示卡不支援）：連上網路、重新整理都沒用，照實說
        // （建到一半才發現的話不重建：同一頁再建一次會重複綁事件，之後再按「小島」也是這句）
        if (/WebGL/i.test(String(err?.message || err))) {
          if (!started) {
            islandMod = null
            islandP = null
          }
          throw Object.assign(new Error('這台畫不出小島', { cause: err }), { webgl: true })
        }
        // 還沒開始建（多半是離線、下載失敗）：之後可以再按一次「小島」重試
        if (!started) {
          islandMod = null
          islandP = null
          throw err
        }
        // 建到一半才失敗（多半是程式或顯示卡的問題）：同一頁再建一次只會重複綁事件，請使用者重新整理
        throw Object.assign(new Error('小島建到一半失敗', { cause: err }), { reload: true })
      }))

  // 小島上的動作（擺放、看某件任務／建築）：小島在了就做；小島模式、小島還在建的話，建好再做最後按的那一件
  // （說一聲「小島準備中」）；App 模式、沒在建就沒有東西可動
  let islandLater = null
  function onIsland(fn) {
    if (scene) return fn(scene)
    if (ui.appMode || !islandP) return
    const mine = (islandLater = fn)
    ui._islandLoading(islandP, '好了就接著做')
    // 建好之後等一下再做：中途換成 App 又按回「小島」的話，先讓畫面換回小島（setAppMode 的那一段）；一直留在 App 模式就不做了
    islandP.then(
      () =>
        setTimeout(() => {
          if (islandLater !== mine) return
          islandLater = null
          if (scene && !ui.appMode) mine(scene)
        }, 0),
      () => (islandLater = null),
    )
  }

  // 方便除錯：在 console 用 hiyori.store；小島建好後還有 hiyori.sky.hourOverride = 20、hiyori.world…
  window.hiyori = { store, ui, fileSync, cloudSync, ensureIsland, noise, agent, reminders }

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
  // 小島模式：小島在背景建，不等它——面板、輸入、Dock 先能用（以前要等整座島建好才拿掉載入畫面，慢的手機要多等好幾秒），
  // 好了就出現在後面；一下子還沒好就說一聲。建不起來（離線又沒快取、瀏覽器不支援 WebGL）就先用 App 模式，之後還能再按「小島」
  let islandBoot = null
  if (!ui.appMode) {
    // 建好之前兩人說的話先留著（回來了、逾期、招呼…），建好再說
    islandWait = []
    islandBoot = ensureIsland()
    // （一下子就換成 App 模式的話不說：小島在背景照樣建好）
    const slow = setTimeout(() => !scene && !ui.appMode && ui._islandLoading(islandBoot, '可以先繼續用，好了就會出現'), 1500)
    islandBoot.then(
      () => {
        clearTimeout(slow)
        heldLines()
      },
      (err) => {
        clearTimeout(slow)
        // App 模式下方的對話框已經說過了，留著的不用再說
        islandWait = null
        ui.setAppMode(true, { save: false })
        // 照原因說：這台不支援 WebGL 的話，連上網路也沒用
        const sub = err.reload ? '先用 App 模式；重新整理頁面再試一次' : err.webgl ? '這個瀏覽器（或顯示卡）畫不出小島，先用 App 模式' : '先用 App 模式；連上網路再按「小島」試試'
        if (!err?.updating) ui.toast({ icon: '島', title: '小島沒有載入成功', sub, ms: 7000 })
      },
    )
  }
  store.flushPending()
  // 原本的存檔讀不進來，換成了範例島：原文另外留著（hiyori-rescue），有開同步的話會從雲端拉回來
  if (store.loadFailed) {
    const sub = store.loadFailed.rescued
      ? '原本的檔案另外留了一份，沒有刪掉（設定的「資料與同步」裡可以下載）。有開同步的話，會自動從雲端拉回來'
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
  // 範例過了開島那天還在（隔天才打開）：摘要出來前先收起來
  if (store.samplesStale()) tuckSamples('day')
  booted = true
  // ふじ：開場好了、線上同步拉完之後看一次該不該整理今天；之後每分鐘、回到 App 時再看
  setTimeout(() => agent.tick(), 6000)
  document.addEventListener('visibilitychange', () => !document.hidden && setTimeout(() => agent.tick(), 1500))
  // 匯入的行事曆：回到 App、每 10 分鐘看一次（超過 30 分鐘沒抓才真的去抓）
  document.addEventListener('visibilitychange', () => !document.hidden && calendars.refresh())
  setInterval(() => !document.hidden && calendars.refresh(), 10 * 60000)
  backReady = true
  suggestReady = true
  if (bootAct) {
    const { act, at } = bootAct
    bootAct = null
    doAct(act, at)
  }
  takeSwAct()
  countShown()
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
        // 今天第一次打開：貓咪走進來說今日摘要（牠在說的時候兩人先不搶話）。
        // 今天看過摘要、離開一陣子才又打開（App 被收掉了、關掉分頁）：提示卡寫現在該做的那一件，ふじ那一句代替打招呼
        const brief = ui.maybeShowBrief() || ui.brief.open
        // 開場前排著的提示卡：摘要開著就等它關掉；沒有摘要的話等打招呼說完
        greeted = true
        setTimeout(() => {
          for (const fn of bootQueue.splice(0)) bootSay(fn)
        }, brief ? 0 : 5600)
        // 設定裡關了「小島上的閒聊和招呼」：不打招呼（回來了的提示照常）
        const chat = store.state.settings.chatOn !== false
        const back = !brief && welcomeBack()
        // 小島還在建的話，這一句先留著（talk 的 onScene），建好再說；揮手等兩人出來
        if (!brief && !back && chat && !(g === 'greet.morning' && !avoid && Math.random() < 0.5 && duet('morning'))) talk(g, {}, 3800, '', undefined, avoid)
        if (islandBoot && !scene) islandBoot.then(() => scene?.greet(), () => {})
        else scene?.greet()
      }, 900)
      // 摘要還開著就等它關掉：回顧和提醒不要疊在上面
      setTimeout(() => ui.afterBrief(() => {
        if (askWeek() || askReview()) return
        if (store.state.settings.chatOn === false) return
        // 範例不算
        const overdue = store.overdue().filter(own).length
        const mineToday = store.tasksOn(store.today).filter(own)
        const todo = mineToday.filter((t) => !t.done).length
        const soon = store.deadlineSoon()[0]
        if (overdue) talk('wilt', { count: overdue }, 3800, line('overdue', { count: overdue }, 'fuji'))
        else if (soon) talk('deadlineNear', { project: short(soon.project.name), days: soon.days }, 4200, `「${short(soon.project.name)}」快到期囉。`)
        else if (new Date().getHours() < 12 && todo >= MAX_STARS && !store.starsOn(store.today).length) talk('planAsk', {}, 4200, '今天最重要的三件事是什麼？點 ☆ 選起來吧。')
        else if (!mineToday.length) talk('emptyDay', {}, 3800)
        else talk(`season.${season}`, {}, 3800)
      }), 5600)
    }),
  )
  // 開場忙完再把月曆、教練、專案詳情載好；載過的檔案（含之後才載的）都請 Service Worker 收進離線快取
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2000))
  idle(() => ui.preloadViews().then(keepOffline), { timeout: 8000 })
}

// 沒接住的錯誤：開場前就開始記（src/errors.js）；介面建好之後才說得出來（tellError）
let tellError = null
watchErrors({ version: LATEST.id, onNew: (d) => tellError?.(d) })
// 開場就壞掉：載入畫面換成「開不起來」（重新整理、另存存檔、回報）；介面已經出來了就交給上面的全域錯誤
boot().catch((err) => {
  if (!bootFailed(err, { version: LATEST.id, saveKey: SAVE_KEY, feedback: FEEDBACK_URL })) throw err
})
