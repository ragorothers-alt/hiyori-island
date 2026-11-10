// Android 殼（android/）：畫面是同一個網站，多了原生通知。在殼裡 window.HiyoriNative 存在，網頁透過它：
//   timer(json)：專注、休息中的即時倒數（Android 16 的 Live Updates，三星手機上是 Now Bar）和到點的鬧鐘
//   notify(title, body, tag)：一般的提醒；canNotify()／askNotify()：通知權限
// 不在殼裡（瀏覽器、PWA）native 是 null，這個檔案什麼都不做。
export const native = typeof window !== 'undefined' && window.HiyoriNative ? window.HiyoriNative : null

const hhmm = (ms) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const clip = (s, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// 即時倒數那一則通知的樣子。
// l：FocusTimer 的 live（{ mode, paused, at, since, leftMs, round, rounds, target }），沒在計時是 null；
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
  // 正向計時：從開始的時間往上數，滿 3 小時（at）自動結束
  if (l.counting) return { ...out, since: l.since, doneAt: l.at, title: `正向計時中${what}`, text: '做完回到 App 按「做完了」' }
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

// 通知權限：殼裡沒有瀏覽器的 Notification，問原生
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
