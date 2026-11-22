// Android 殼（android/）：畫面是同一個網站，多了原生通知。在殼裡 window.HiyoriNative 存在，網頁透過它：
//   timer(json)：專注、休息中的即時倒數（Android 16 的 Live Updates，三星手機上是 Now Bar）和到點的鬧鐘
//   notify(title, body, tag)：一般的提醒；canNotify()／askNotify()：通知權限
//   mottos(json)：警語的定時提醒，排好接下來的每一則交給手機的鬧鐘（App 關著、鎖著也照時間通知；新版的殼才有）；
//   mottoHandled()／mottoClaim(at)：手機記的「念到哪一則了」、頁面要念某一則時先說一聲；foreground()：App 在前面嗎；
//   awayLocked()：上一次離開 App 時手機是不是鎖著
// 不在殼裡（瀏覽器、PWA）native 是 null，這個檔案什麼都不做。
export const native = typeof window !== 'undefined' && window.HiyoriNative ? window.HiyoriNative : null
// 桌機的瀏覽器（有滑鼠、游標停得住，不在 Android 殼裡）：切到別的分頁、縮小視窗就是 document.hidden，
// 不會是鎖著手機在專心（手機的網頁分不出這兩種）
export const deskWeb = () => !native && typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches

const hhmm = (ms) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const clip = (s, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// 即時倒數那一則通知的樣子。
// l：FocusTimer 的 live（{ mode, paused, at, since, leftMs, round, rounds, target, flow, start, flowAt }），沒在計時是 null；
// flow：到點會自動延長（倒數中）、正在自動延長（往上數）的話是延長幾分鐘，start 是這一輪開始的時間（暫停過就往後挪）、
// flowAt 是延長做滿的時間；
// done：到點時要發的那一則（push.js 的 timerNotice），沒有就不排
export function liveTimer(l, done = null) {
  if (!l) return null
  const what = l.target ? ` · ${clip(l.target)}` : ''
  const multi = l.rounds > 1
  if (l.paused) {
    const min = Math.floor(l.leftMs / 60000)
    const sec = Math.floor((l.leftMs % 60000) / 1000)
    const t = `${min}:${String(sec).padStart(2, '0')}`
    return { title: `暫停中${what}`, text: l.counting ? `已經 ${t}，回到 App 繼續` : `還剩 ${t}，回到 App 繼續`, chip: '暫停' }
  }
  const out = { done: done ? { title: done.title, body: done.body } : null }
  if (l.mode === 'break') {
    return { ...out, at: l.at, title: '休息中', text: `${hhmm(l.at)} 結束${multi && l.round < l.rounds ? `・接著第 ${l.round + 1}/${l.rounds} 輪` : ''}` }
  }
  // 會自動延長的這一輪（倒數中、延長中）：從這一輪開始的時間往上數（到點那一刻不跳、不響），鬧鐘排在延長做滿的時間（flowAt）。
  // 手機的鬧鐘在倒數（at）時只會在到點那一刻響，那一刻正是不該吵你的時候；改成往上數，舊版的殼也排得到延長做滿的那一則，
  // 頁面在背景睡著了也照樣叫你休息
  if (l.flow) {
    const tail = l.counting ? '告一段落回到 App 按「做完了」' : `${hhmm(l.at)} 到點後自動延長`
    return { ...out, since: l.start, doneAt: l.flowAt, title: `${l.counting ? '自動延長中' : '專注中'}${what}`, text: `${tail}・最晚 ${hhmm(l.flowAt)}${multi ? `・第 ${l.round}/${l.rounds} 輪` : ''}` }
  }
  // 正向計時：從開始的時間往上數，滿 3 小時（at）自動結束
  if (l.counting) return { ...out, since: l.since, doneAt: l.at, title: `${l.ext ? '加時中' : '正向計時中'}${what}`, text: '做完回到 App 按「做完了」' }
  return { ...out, at: l.at, title: `專注中${what}`, text: `${hhmm(l.at)} 結束${multi ? `・第 ${l.round}/${l.rounds} 輪` : ''}` }
}

// 交給原生顯示（沒在計時就收掉）。樣子沒變就不重送（畫面重畫時計時器會一直存檔）
let lastLive = null
export function showLiveTimer(l, done) {
  if (!native) return
  try {
    const p = liveTimer(l, done)
    const json = p ? JSON.stringify(p) : ''
    if (json === lastLive) return
    lastLive = json
    native.timer(json)
  } catch (e) {
    console.warn('[hiyori] 即時倒數沒送到原生', e)
  }
}

// 警語的定時提醒交給手機排：舊版的殼沒有這個（要重新安裝），那時照舊只在 App 開著時提醒
export const nativeMottos = (bridge = native) => typeof bridge?.mottos === 'function'
// items：[{ at, title, body }]（照時間排好），空的是不提醒了（手機上排著的取消）。內容沒變就不重送。回傳送到了沒
let lastMottos = null
export function sendMottos(items, bridge = native) {
  if (!nativeMottos(bridge)) return false
  const json = items?.length ? JSON.stringify({ items }) : ''
  if (json === lastMottos) return true
  try {
    bridge.mottos(json)
    lastMottos = json
    return true
  } catch (e) {
    console.warn('[hiyori] 警語提醒沒送到原生', e)
    return false
  }
}

// 手機記著的「念到哪一則了」（手機通知過、或頁面念過的最後一則的時間）；問不到是 0
export function nativeMottoHandled(bridge = native) {
  try {
    return Number(bridge?.mottoHandled?.()) || 0
  } catch {
    return 0
  }
}
// 頁面要念這一則：先跟手機說，手機就不發。手機剛好搶先通知了的話回 false（頁面就不念）；問不到時頁面照念
export function nativeMottoClaim(at, bridge = native) {
  try {
    return typeof bridge?.mottoClaim === 'function' ? !!bridge.mottoClaim(at) : true
  } catch {
    return true
  }
}
// 使用者按了頁面念的那一則提示卡上的按鈕（先停、開始專注）：看到了，手機不用在離開 App 時再發一次。
// 舊版的殼沒有這個（剛念完 2 秒內就離開 App 的話，手機照舊再發一次）
export function nativeMottoSeen(bridge = native) {
  try {
    if (typeof bridge?.mottoSeen === 'function') bridge.mottoSeen()
  } catch {}
}
// 按了手機上警語通知的哪一顆按鈕：'focus'（開始專注）、'pause'（先停 1 小時），沒有是 ''。拿走就清掉（不會做兩次）。
// 舊版的殼沒有按鈕，也沒有這個
export function nativeTakeAct(bridge = native) {
  try {
    const a = typeof bridge?.takeAct === 'function' ? String(bridge.takeAct() || '') : ''
    return a === 'focus' || a === 'pause' ? a : ''
  } catch {
    return ''
  }
}
// 剛拿走的那一顆按鈕，是哪一則警語通知上的（那一則排在幾點；回神紀錄用它認出同一則、記在那一天）。
// 舊版的殼（4 以前）不知道，是 0
export function nativeActAt(bridge = native) {
  try {
    const at = typeof bridge?.actAt === 'function' ? Number(bridge.actAt()) : 0
    return Number.isFinite(at) && at > 0 ? at : 0
  } catch {
    return 0
  }
}
// App 不在前面時手機發過的警語通知（殼留著最近 32 則，不會清掉）：[{ id, at }]（at 是那一則排在幾點，也當代號）。
// 回到 App 時算進回神紀錄的「提醒了幾次」（滑掉、只點通知本身的也算；按了按鈕的那一則同一個時間，不會重算；
// 算過哪幾筆記在 store 那邊，見 mottosShown）。舊版的殼（4 以前）沒有這個，是空的
export function nativeShown(bridge = native) {
  try {
    if (typeof bridge?.shown !== 'function') return []
    const list = JSON.parse(String(bridge.shown() || '[]'))
    return Array.isArray(list) ? list.map(Number).filter((x) => Number.isFinite(x) && x > 0).map((at) => ({ id: String(at), at })) : []
  } catch {
    return []
  }
}
// App 不在前面嗎：App 在背景時，頁面的 JavaScript 可能還在跑，看頁面自己的 document.hidden 不一定準
export function nativeAway(bridge = native) {
  try {
    return typeof bridge?.foreground === 'function' && !bridge.foreground()
  } catch {
    return false
  }
}

// 專注中離開太久叫你回來：新版的殼（4 起）分得出「鎖著手機」和「切去用別的 App」，警語的那一串收得下這一則（back）。
// 舊版的殼沒有：不排這一則（舊版會把它當成一般的警語、手機鎖著也發）
export const nativeBack = (bridge = native) => typeof bridge?.awayLocked === 'function'
// 上一次離開 App 時手機是不是鎖著（螢幕關了、停在鎖定畫面）：鎖著手機專心做事不算中途離開。問不到是 null
export function nativeAwayLocked(bridge = native) {
  try {
    return nativeBack(bridge) ? !!bridge.awayLocked() : null
  } catch {
    return null
  }
}

// ふじ在 App 關著時的通知（fujiNotes.js 排的）交給手機的鬧鐘：舊版的殼（6 以前）沒有這個，那時只在 App 開著時說。
// 要有 fujiNow（就寢提醒跟睡前那則同一刻時由手機發）才算：沒有的殼排了的話，網頁在背景還在跑時會兩邊都發
export const nativeFujiNotes = (bridge = native) => typeof bridge?.fujiNotes === 'function' && typeof bridge?.fujiNow === 'function'
// items：[{ at, title, body }]（照時間排好），空的是不送了。內容沒變就不重送。回傳送到了沒
let lastFuji = null
export function sendFujiNotes(items, bridge = native) {
  if (!nativeFujiNotes(bridge)) return false
  const json = items?.length ? JSON.stringify({ items: items.map(({ at, title, body }) => ({ at, title, body })) }) : ''
  if (json === lastFuji) return true
  try {
    bridge.fujiNotes(json)
    lastFuji = json
    return true
  } catch (e) {
    console.warn('[hiyori] ふじ的通知沒送到原生', e)
    return false
  }
}

// 網頁到點要說排在 at 的那一則（App 在背景、網頁還在跑時的就寢提醒，跟ふじ睡前那則同一刻）：
// 手機排著的話由手機現在用ふじ的通知類別發（發過了就不再發），回 true；手機沒排這一則、殼沒有這個、出錯，回 false（網頁自己說）
export function nativeFujiNow(at, bridge = native) {
  if (typeof bridge?.fujiNow !== 'function') return false
  try {
    return !!bridge.fujiNow(String(at))
  } catch {
    return false
  }
}

// 通知權限：殼裡沒有瀏覽器的 Notification，問原生
// 日程、排定的任務、就寢的提醒交給手機的鬧鐘（第 7 版的殼才有；舊的殼只有 App 開著時的提醒）
export const nativeReminders = (bridge = native) => typeof bridge?.reminders === 'function' && typeof bridge?.remindPosted === 'function'
// items：remindPlan.js 排的 [{ at, key, date, title, body, tag }]，空的是都不提醒了。一樣的就不重送
let lastReminds = null
export function sendReminders(items, bridge = native) {
  if (!nativeReminders(bridge)) return false
  const json = items.length ? JSON.stringify({ items }) : ''
  if (json === lastReminds) return true
  try {
    bridge.reminders(json)
    lastReminds = json
    return true
  } catch {
    return false
  }
}
// App 不在前面時手機發過的提醒：[{ key, date }]（拿走就清掉了）
export function nativeRemindPosted(bridge = native) {
  if (!nativeReminders(bridge)) return []
  try {
    const v = JSON.parse(bridge.remindPosted() || '[]')
    return Array.isArray(v) ? v.filter((x) => x && typeof x.key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date)) : []
  } catch {
    return []
  }
}

export const nativeCanNotify = () => {
  try {
    return !!native?.canNotify()
  } catch {
    return false
  }
}
// 問權限，回傳 'granted' 或 'denied'（被拒絕過、系統不再跳視窗時原生會打開設定頁，回來後再按一次就好）
export function nativeAskNotify() {
  if (nativeCanNotify()) return Promise.resolve('granted')
  return new Promise((resolve) => {
    const done = (ok) => {
      removeEventListener('hiyori-native-perm', onPerm)
      clearTimeout(timer)
      resolve(ok ? 'granted' : 'denied')
    }
    const onPerm = (e) => done(!!e.detail)
    // 打開設定頁的情況不會有事件：過一陣子自己看一次結果
    const timer = setTimeout(() => done(nativeCanNotify()), 60000)
    addEventListener('hiyori-native-perm', onPerm)
    native.askNotify()
  })
}
