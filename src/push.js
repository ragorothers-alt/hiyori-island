// 計時器的推播：番茄鐘到點時，手機鎖著、App 被系統暫停（iPhone 一鎖螢幕就是）也收得到通知。
// 頁面醒著時自己就能發系統通知（reminders.js 的 systemNotify）；睡著了就得靠伺服器到點推一則過來（worker/src/push.js）。
// 交給伺服器的只有這台裝置的推播網址和「幾毫秒後」：要顯示的字存在這台的快取裡，Service Worker 收到推播時自己讀
// （public/sw.js 的 push），任務名稱不會離開裝置。
// 需要：開了系統通知、瀏覽器支援推播、而且是正式版（開發時沒有 Service Worker）。iPhone／iPad 要先「加入主畫面」。
import { SYNC_API } from './cloud.js'

// Service Worker 讀寫這幾個名字（public/sw.js 裡也寫了一份，要一起改）
export const PLAN_CACHE = 'hiyoripush'
// 最近排過的幾則 [{ at, title, body }]：推播沒有內容，Service Worker 照「剛到點的是哪一則」找字
export const PLAN_FILE = '__timer-plan'
// Service Worker 最近一次照推播顯示的是哪一則 { at }：頁面看了就知道不用自己再發一次
export const SHOWN_FILE = '__timer-shown'
// 到點多久以內的字還留著（推播最晚 10 分鐘後送到）
const KEEP = 15 * 60000
// 上次成功排到伺服器的那一則的時間（這台的時鐘）。所有分頁共用：別的分頁排的，這個分頁停掉時也知道要取消。
// 到點以後不清掉：頁面要靠它知道「這一次到點伺服器會推」
const ARMED_KEY = 'hiyori-push-armed'

// 同一次到點，推播和頁面自己發的通知用同一個 tag
export const timerTag = (at) => `hiyori-focus-${at}`

export const pushSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis

// iPhone／iPad 的 Safari 分頁裡沒有通知功能，要先加入主畫面、從主畫面打開
export const needsHomeScreen = () => typeof navigator !== 'undefined' && 'standalone' in navigator && !navigator.standalone && !('PushManager' in globalThis)

// 到點時通知上寫什麼。b：{ at, mode, up, focusMin, breakMin, round, rounds, target }
// （mode 是到點前的狀態：'focus' 是專注結束、'break' 是休息結束；up 是正向計時滿 3 小時）
export function timerNotice(b) {
  const { round = 1, rounds = 1 } = b
  let title = '休息結束'
  let body = round < rounds ? `接著第 ${round + 1}/${rounds} 輪` : '準備好了就再開始一輪吧'
  if (b.mode === 'focus' && b.up) {
    title = '正向計時滿 3 小時了'
    body = '先停下來，休息一下吧'
  } else if (b.mode === 'focus') {
    const last = round >= rounds
    title = rounds > 1 ? (last ? `${rounds} 輪都完成了` : `第 ${round}/${rounds} 輪完成`) : '專注結束'
    const what = b.target ? `「${b.target.length > 16 ? `${b.target.slice(0, 15)}…` : b.target}」` : ''
    const mins = Math.max(1, Math.round(b.focusMin))
    body = `${what}${mins} 分鐘完成，${rounds > 1 && !last ? `休息 ${b.breakMin} 分鐘再接著第 ${round + 1} 輪` : '休息一下吧'}`
  }
  return { at: b.at, title: `ひより · ${title}`, body }
}

const bytes = (b64u) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function post(path, body) {
  const res = await fetch(SYNC_API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`push ${res.status}`)
  return res.json()
}

const readArmed = () => {
  try {
    return Number(localStorage.getItem(ARMED_KEY)) || null
  } catch {
    return null
  }
}
const writeArmed = (at) => {
  try {
    if (at) localStorage.setItem(ARMED_KEY, String(at))
    else localStorage.removeItem(ARMED_KEY)
  } catch {}
}
const keyOf = (p) => (p ? `${p.at}|${p.title}|${p.body}` : '')

// enabled()：現在要不要推播（開了系統通知而且瀏覽器允許）。其他參數是給測試換掉的
export class TimerPush {
  constructor({ enabled, api = post, registration = () => navigator.serviceWorker.getRegistration(), storage = globalThis.caches, now = Date.now, onState = () => {} }) {
    Object.assign(this, { enabled, api, registration, storage, now, onState })
    this.want = null
    // 這個分頁上次成功排上（或確認不用排）的那一則
    this.did = ''
    this.busy = null
    // 'idle'：還沒試過；'ready'：排得上；'unsupported'：這個瀏覽器不行；'error'：連不上或訂閱失敗
    this.state = 'idle'
  }

  _set(state) {
    if (state === this.state) return
    this.state = state
    this.onState(state)
  }

  // 排下一次到點的通知（{ at, title, body }），null 是取消。連續叫好幾次只照最後一次做
  plan(p) {
    this.want = p && Number.isFinite(p.at) ? { at: p.at, title: String(p.title || ''), body: String(p.body || '') } : null
    return this._run()
  }

  // 上次沒排上（連不上伺服器）：連上線、回到 App 時再試一次
  retry() {
    return this.state === 'error' ? this._run() : Promise.resolve()
  }

  _run() {
    this.busy ||= (async () => {
      // 最多做幾輪：連續改了很多次也夠用，又不會因為哪裡記不住（例如 localStorage 寫不進去）就一直打伺服器
      for (let i = 0; i < 6; i++) {
        const want = this.want
        // 沒開通知就當成「沒有要排的」（之後開了通知再排同一則，不會被當成做過了）
        const p = want && this.enabled() ? want : null
        if (this._settled(p)) break
        let ok = false
        try {
          ok = await this._apply(p)
        } catch (e) {
          console.warn('[hiyori] 計時器的推播沒排上', e)
          this._set('error')
        }
        // 沒排上就先停：等下一次計時的狀態變了、連上線、回到 App 再試（中間又改過的話現在就照新的做）
        if (!ok && this.want === want) break
      }
    })().finally(() => {
      this.busy = null
    })
    return this.busy
  }

  // 伺服器上還排著、還沒到點的那一則（別的分頁排的也算）
  _pending() {
    const armed = readArmed()
    return armed >= this.now() + 1000 ? armed : null
  }
  // 馬上就到了（或已經過了）：頁面醒著，自己會通知，不用交給伺服器
  _soon(p) {
    return p.at - this.now() < 1000
  }
  // 伺服器那邊已經是想要的樣子了嗎
  _settled(p) {
    const pending = this._pending()
    if (!p) return !pending
    if (this.did !== keyOf(p)) return false
    return this._soon(p) ? !pending : pending === p.at
  }

  // 這一次到點伺服器會推一則過來嗎（排上了才算）
  covers(at) {
    return !!at && readArmed() === at
  }
  // 那一則推播到了、Service Worker 顯示過了嗎
  async shown(at) {
    try {
      const reg = await this._reg()
      const hit = reg && (await (await this.storage.open(PLAN_CACHE)).match(new URL(SHOWN_FILE, reg.scope).href))
      return !!hit && (await hit.json())?.at === at
    } catch {
      return false
    }
  }

  // 開通知時先訂閱好（在按鈕的點擊裡做：有的瀏覽器要求使用者操作時才能訂閱），回傳排不排得上
  async setup() {
    try {
      const sub = await this._sub(true)
      this._set(sub ? 'ready' : 'unsupported')
      return !!sub
    } catch (e) {
      console.warn('[hiyori] 推播訂閱失敗', e)
      this._set('error')
      return false
    }
  }

  // 關掉通知：取消排著的、退訂
  async off() {
    await this.plan(null)
    try {
      const sub = await (await this._reg())?.pushManager.getSubscription()
      if (sub) {
        await this.api('/v1/push/timer', { endpoint: sub.endpoint, after: null }).catch(() => {})
        await sub.unsubscribe()
      }
    } catch {}
    writeArmed(null)
    this.did = ''
    this._set('idle')
  }

  async _reg() {
    const reg = pushSupported() ? await this.registration() : null
    return reg?.pushManager ? reg : null
  }

  // 這台裝置的推播訂閱；create：沒有的話現在訂閱
  async _sub(create, key = null) {
    const reg = await this._reg()
    if (!reg) return null
    const sub = await reg.pushManager.getSubscription()
    if (sub || !create) return sub
    key ||= (await this.api('/v1/push/key', {})).key
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) })
  }

  // 要顯示的字放進快取給 Service Worker 讀。留著剛到點的那幾則（推播可能晚幾秒到，那時頁面已經排了下一段）；
  // 還沒到點的是被取消、被換掉的，拿掉
  async _savePlans(reg, p) {
    const cache = await this.storage.open(PLAN_CACHE)
    const url = new URL(PLAN_FILE, reg.scope).href
    const now = this.now()
    let list = []
    try {
      const old = await (await cache.match(url))?.json()
      if (Array.isArray(old)) list = old.filter((x) => x && Number.isFinite(x.at) && x.at <= now && now - x.at < KEEP && x.at !== p?.at)
    } catch {}
    if (p) list.push(p)
    await cache.put(url, new Response(JSON.stringify(list.slice(-6)), { headers: { 'Content-Type': 'application/json' } }))
  }

  // 回傳 true：伺服器那邊已經照 p 的樣子了
  async _apply(p) {
    const reg = await this._reg()
    if (!reg) {
      this._set('unsupported')
      return false
    }
    await this._savePlans(reg, p)
    if (!p || this._soon(p)) {
      // 不用排：伺服器上還排著別的（暫停、停掉、改了時間）就取消。取消成功才把紀錄清掉，失敗的話下次還知道要取消
      if (this._pending()) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) await this.api('/v1/push/timer', { endpoint: sub.endpoint, after: null })
        writeArmed(null)
      }
      this.did = keyOf(p)
      return true
    }
    let sub = await this._sub(true)
    if (!sub) {
      this._set('unsupported')
      return false
    }
    const after = () => Math.max(1000, Math.round(p.at - this.now()))
    const r = await this.api('/v1/push/timer', { endpoint: sub.endpoint, after: after() })
    // 伺服器的金鑰跟訂閱時的不一樣（換過了）：那個訂閱收不到，重新訂閱再排一次
    const mine = sub.options?.applicationServerKey
    if (r.key && mine && b64u(mine) !== r.key) {
      await sub.unsubscribe()
      sub = await this._sub(true, r.key)
      await this.api('/v1/push/timer', { endpoint: sub.endpoint, after: after() })
    }
    writeArmed(p.at)
    this.did = keyOf(p)
    this._set('ready')
    return true
  }
}
