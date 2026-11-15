// 到點的推播：番茄鐘到點（TimerPush）、警語的定時提醒（MottoPush），手機鎖著、App 被系統暫停（iPhone 一鎖螢幕就是）、
// 頁面整個關掉也收得到通知。
// 頁面醒著時自己就能發系統通知（reminders.js 的 systemNotify）；睡著了就得靠伺服器到點推一則過來（worker/src/push.js）。
// 交給伺服器的只有這台裝置的推播網址和「幾毫秒後」：要顯示的字存在這台的快取裡，Service Worker 收到推播時自己讀
// （public/sw.js 的 push），任務名稱、警語的字都不會離開裝置。
// 需要：開了系統通知、瀏覽器支援推播、而且是正式版（開發時沒有 Service Worker）。iPhone／iPad 要先「加入主畫面」。
import { SYNC_API } from './cloud.js'
import { MOTTO_LATE } from './mottos.js'

// Service Worker 讀寫這幾個名字（public/sw.js 裡也寫了一份，要一起改）
export const PLAN_CACHE = 'hiyoripush'
// 最近排過的幾則 [{ at, title, body }]：推播沒有內容，Service Worker 照「剛到點的是哪一則」找字
export const PLAN_FILE = '__timer-plan'
// Service Worker 最近一次照推播顯示的是哪一則 { at }：頁面看了就知道不用自己再發一次
export const SHOWN_FILE = '__timer-shown'
// 最近幾則推播送到這台的時間 [{ got, at, closed }]（Service Worker 寫，設定裡顯示上一則）
export const LOG_FILE = '__push-log'
// 警語：接下來的那一串 [{ at, title, body }]（頁面排的，跟交給 Android 殼的一樣）
export const MOTTO_FILE = '__motto-plan'
// 警語念到哪一則了 { at }：頁面念之前寫、Service Worker 照推播顯示之後寫。誰先寫就是誰念，另一邊跳過
export const MOTTO_DONE = '__motto-done'
// 最近幾則警語的推播送到這台的時間 [{ got, at }]（警語卡上顯示上一則）
export const MOTTO_LOG = '__motto-log'
// 警語一次最多交給伺服器幾則（伺服器的上限也是 200）
export const MOTTO_PUSH_MAX = 200
// 看著頁面時，伺服器排著的下一則再過這麼久就到了：先取消，由頁面自己念（不然畫面上念一次、系統通知又跳一次）
export const MOTTO_NEAR = 60000
// 回到頁面時剛到點的那一則：推播可能正在路上，等它這麼久再自己念
export const MOTTO_GRACE = 8000

// Service Worker 收到推播時問「正看著 App 嗎」（正看著的話，通知幾秒後自己收掉，畫面上已經有提示）。
// 頁面醒著才回得了話：手機鎖著、頁面被凍住時等不到回答，通知就會留著
export function answerLooking(sw = globalThis.navigator?.serviceWorker, now = () => document.visibilityState === 'visible' && document.hasFocus()) {
  if (typeof sw?.addEventListener !== 'function') return
  sw.addEventListener('message', (e) => {
    if (e.data?.type !== 'hiyori-looking?') return
    const to = e.source || sw.controller
    try {
      to?.postMessage({ type: 'hiyori-looking', id: e.data.id, looking: !!now() })
    } catch {}
  })
}
// 按了警語通知上的哪一顆按鈕 { id, act, at, slot }：Service Worker 打開 App 之前留下，頁面開好了拿走（public/sw.js 的 notificationclick）。
// at 是按的時間，slot 是那一則提醒排在幾點（回神紀錄認同一則用；不知道是 0）
export const ACT_FILE = '__act'
const ACTS = ['focus', 'pause']
// 按了多久以內的才算（打開 App 慢一點也沒關係；很久以前的就不做了）
const ACT_FRESH = 2 * 60000

// 拿走 Service Worker 留下的那一次按鈕（刪掉，不會做兩次），回傳 { id, act, slot }；沒有、太舊、不認得的是 null。
// id：只拿走這一次的（Service Worker 也直接傳過來了的那一次：快取裡那一份刪掉，之後開機不會再做一次）
export async function takeNoticeAct(id = null, { now = Date.now(), storage = globalThis.caches, sw = globalThis.navigator?.serviceWorker } = {}) {
  try {
    const reg = await sw?.getRegistration()
    if (!reg || !storage || !(await storage.has(PLAN_CACHE))) return null
    const cache = await storage.open(PLAN_CACHE)
    const url = new URL(ACT_FILE, reg.scope).href
    const hit = await cache.match(url)
    if (!hit) return null
    const v = await hit.json().catch(() => null)
    if (id != null && v?.id !== id) return null
    // 拿了就刪（壞掉的、太舊的也刪，不留著）
    await cache.delete(url)
    const ok = !!v && ACTS.includes(v.act) && typeof v.id === 'string' && Number.isFinite(v.at) && now - v.at < ACT_FRESH && v.at <= now + 5000
    const slot = Number.isFinite(v?.slot) && v.slot > 0 ? v.slot : 0
    return ok ? { id: v.id, act: v.act, slot } : null
  } catch {
    return null
  }
}

// 到點多久以內的字還留著（推播最晚 10 分鐘後送到）
const KEEP = 15 * 60000
// 上次成功排到伺服器的那一則的時間（這台的時鐘）。所有分頁共用：別的分頁排的，這個分頁停掉時也知道要取消。
// 到點以後不清掉：頁面要靠它知道「這一次到點伺服器會推」
const ARMED_KEY = 'hiyori-push-armed'
// 警語：最後一次交給伺服器的那一串 { endpoint, times, seq, ok }（所有分頁共用）。
// ok：null 是還在送、true 是伺服器收到了、false 是沒送到（等一下再送）
const MOTTO_ARMED_KEY = 'hiyori-push-mottos'
// 交給伺服器時帶的序號，一次比一次大（伺服器照它認哪一個請求比較新）
const MOTTO_SEQ_KEY = 'hiyori-push-mottos-seq'
// 沒送到伺服器：過這麼久再試（連上線時馬上試）
const MOTTO_RETRY = 30000
// 送出去這麼久還沒回音（送的那個分頁被關掉、凍住了，回音不會來）：當成不知道伺服器上有沒有，要的時候再送一次
const MOTTO_SENDING = 15000
// 看著頁面的分頁每 5 秒記一下 { id, at }（所有分頁共用）：記過 30 秒內算「有分頁正看著」。
// 離開頁面時馬上拿掉；沒拿掉（那個分頁當掉、被系統關掉）的話，30 秒後背景的分頁才接手
const SEEN_KEY = 'hiyori-push-seen'
const SEEN_EVERY = 5000
const SEEN_FOR = 30000
const readSeen = () => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null')
    return v && typeof v.id === 'string' && Number.isFinite(v.at) ? v : null
  } catch {
    return null
  }
}

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
  } else if (b.mode === 'focus' && b.small) {
    // 只做 5 分鐘到點了：開了頭就不難了，要接著做的話回到 App 按「繼續做下去」
    const what = b.target ? `「${b.target.length > 16 ? `${b.target.slice(0, 15)}…` : b.target}」` : ''
    title = `${Math.max(1, Math.round(b.focusMin))} 分鐘到了`
    body = `${what}開了頭就不難了。想接著做就回來按「繼續做下去」，不然休息一下吧`
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

// keepalive：離開頁面（切走、鎖螢幕、關掉）的那一刻送的，頁面接著被暫停、關掉也會送完。
// 這種請求用 text/plain（不用先問伺服器收不收：有的瀏覽器的 keepalive 不能先問），伺服器照樣當 JSON 讀
async function post(path, body, { keepalive = false } = {}) {
  const res = await fetch(SYNC_API + path, {
    method: 'POST',
    headers: { 'Content-Type': keepalive ? 'text/plain;charset=UTF-8' : 'application/json' },
    body: JSON.stringify(body),
    ...(keepalive ? { keepalive: true } : {}),
  })
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

const readMottoArmed = () => {
  try {
    const v = JSON.parse(localStorage.getItem(MOTTO_ARMED_KEY) || 'null')
    return v && typeof v.endpoint === 'string' && Array.isArray(v.times) ? v : null
  } catch {
    return null
  }
}
const writeMottoArmed = (v) => {
  try {
    if (v) localStorage.setItem(MOTTO_ARMED_KEY, JSON.stringify(v))
    else localStorage.removeItem(MOTTO_ARMED_KEY)
  } catch {}
}
// 比上一次大：通常就是現在的時間（毫秒），同一毫秒、時鐘往回調過時也還是往上加
const nextSeq = (now) => {
  let last = 0
  try {
    last = Number(localStorage.getItem(MOTTO_SEQ_KEY)) || 0
  } catch {}
  const seq = Math.max(Math.round(now), last + 1)
  try {
    localStorage.setItem(MOTTO_SEQ_KEY, String(seq))
  } catch {}
  return seq
}
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const jsonRes = (v) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } })

// 兩種推播共用的：這台的 Service Worker、推播訂閱、快取裡的檔案。
// enabled()：現在要不要推播（開了系統通知而且瀏覽器允許）。其他參數是給測試換掉的
class PushBase {
  constructor({ enabled, api = post, registration = () => navigator.serviceWorker.getRegistration(), storage = globalThis.caches, now = Date.now, onState = () => {} }) {
    Object.assign(this, { enabled, api, registration, storage, now, onState })
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

  // 伺服器回的公鑰跟這個訂閱的不一樣（伺服器換過金鑰）：那個訂閱收不到，重新訂閱
  async _resub(sub, key) {
    const mine = sub?.options?.applicationServerKey
    if (!key || !mine || b64u(mine) === key) return null
    await sub.unsubscribe()
    return this._sub(true, key)
  }

  // 推播的快取還沒有（從沒排過）：讀的時候不要順手建出一個空的（caches.open 會建）
  async _cacheMissing() {
    return typeof this.storage?.has === 'function' && !(await this.storage.has(PLAN_CACHE))
  }

  async _read(name) {
    try {
      const reg = await this._reg()
      if (!reg || (await this._cacheMissing())) return null
      const hit = await (await this.storage.open(PLAN_CACHE)).match(new URL(name, reg.scope).href)
      return hit ? await hit.json() : null
    } catch {
      return null
    }
  }

  // 推播送到這台的紀錄裡最後一筆 { got, at, … }（沒有是 null）
  async _lastLog(name) {
    const list = await this._read(name)
    const e = Array.isArray(list) ? list.filter((x) => x && Number.isFinite(x.got)).pop() : null
    return e || null
  }
}

export class TimerPush extends PushBase {
  // beforeOff(sub)：關掉通知、退訂之前先叫（警語那一串跟著取消）
  constructor(opts) {
    super(opts)
    this.beforeOff = opts.beforeOff || null
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
    return (await this._read(SHOWN_FILE))?.at === at
  }

  // 上一則送到這台的推播 { got, at, closed }（沒有是 null）：設定裡寫「上一則到點通知幾點送到」
  last() {
    return this._lastLog(LOG_FILE)
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
      await this.beforeOff?.(sub || null)
      if (sub) {
        await this.api('/v1/push/timer', { endpoint: sub.endpoint, after: null }).catch(() => {})
        await sub.unsubscribe()
      }
    } catch {}
    writeArmed(null)
    this.did = ''
    this._set('idle')
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
    const again = await this._resub(sub, r.key)
    if (again) {
      sub = again
      await this.api('/v1/push/timer', { endpoint: sub.endpoint, after: after() })
    }
    writeArmed(p.at)
    this.did = keyOf(p)
    this._set('ready')
    return true
  }
}

// 警語的推播（網頁版；Android 殼用手機的鬧鐘，見 native.js）：頁面關掉、手機鎖著時，伺服器照時間推過來，Service Worker 顯示。
// 看得到頁面時頁面自己念、不推（不然畫面上念一次、系統通知又跳一次）：離開頁面（切走、鎖螢幕、關掉）時才把接下來的時間
// 交給伺服器，回到頁面、下一則快到了時取消。每一則由頁面或 Service Worker 其中一邊念，靠快取裡的「念到哪一則了」（MOTTO_DONE）分：
//   頁面念之前先寫，Service Worker 顯示之前寫（也跟開著的頁面說一聲）；已經寫到的那一則另一邊就跳過。
// 回到頁面時先讀一次念到哪（鎖著時可能推過了），讀到之前頁面先不念。
// 好幾個分頁：看著的那個分頁每 5 秒記一下（SEEN_KEY）；有別的分頁正看著時，在背景的分頁不交給伺服器、也不自己念（看著的那個會念），
// 不然背景的一直重交、前面的一直取消
export class MottoPush extends PushBase {
  constructor(opts) {
    super(opts)
    // 這個分頁（SEEN_KEY 認得出是不是自己記的）
    this.id = Math.random().toString(36).slice(2)
    // 念到哪一則了（記憶體裡的；快取裡的讀到、Service Worker 說了就往後）
    this.done = 0
    // 回到頁面後讀過快取裡的「念到哪」了嗎；gen：離開頁面一次加一（離開前開始讀、回來才讀完的不算數）
    this.fresh = false
    this.gen = 0
    this.reading = null
    // 這台的推播訂閱（PushSubscription）；null 是沒有或還沒查到
    this.sub = null
    // 現在的那一串和它的字（listKey），快取裡存好的是哪一份（savedKey；存失敗就不變，下一秒再存）
    this.list = []
    this.listKey = '[]'
    this.savedKey = null
    this.saving = null
    this.retryAt = 0
    this.beatAt = 0
  }

  // 開機：查訂閱、讀念到哪；Service Worker 照推播顯示了一則時會說（頁面在背景、JavaScript 還在跑的時候收得到）。
  // 第一次打開時 Service Worker 還沒裝好、查不到：裝好接手時（controllerchange）再查一次
  init(sw = globalThis.navigator?.serviceWorker) {
    if (typeof sw?.addEventListener === 'function') {
      sw.addEventListener('message', (e) => {
        if (e.data?.type === 'hiyori-motto-shown') this._seen(Number(e.data.at))
      })
      sw.addEventListener('controllerchange', () => this.check())
    }
    return Promise.all([this.check(), this.refresh()])
  }

  // 這台有沒有推播訂閱（開通知時訂閱、關通知時退訂）：開機、回到頁面、計時器的推播狀態變了時再查一次
  async check() {
    try {
      this.sub = (await this._sub(false)) || null
    } catch {
      this.sub = null
    }
    return this.sub
  }

  // 交給伺服器排得了嗎：開了系統通知、瀏覽器有推播、這台訂閱過
  ready() {
    return !!this.enabled() && pushSupported() && !!this.sub
  }

  _seen(at) {
    if (Number.isFinite(at) && at > this.done) this.done = at
  }

  // 頁面在背景、正要關掉：回到頁面時要重新讀念到哪（這段時間 Service Worker 可能顯示過幾則）。
  // 離開的那一刻（sync）就記下，不等提醒的檢查：頁面接著被凍住的話，回來時先跑的可能是下一秒的檢查。
  // 「正看著」的記號是自己的就拿掉：在背景的分頁馬上知道沒人看著了
  _away() {
    this.fresh = false
    this.gen++
    this.beatAt = 0
    try {
      if (readSeen()?.id === this.id) localStorage.removeItem(SEEN_KEY)
    } catch {}
  }

  // 看著這個分頁：每 5 秒記一次
  _beat(now) {
    if (now - this.beatAt < SEEN_EVERY) return
    this.beatAt = now
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify({ id: this.id, at: now }))
    } catch {}
  }

  // 有沒有別的分頁正看著（30 秒內記過；那個分頁當掉、被系統關掉時，過 30 秒就不算了）
  otherVisible(now = this.now()) {
    const v = readSeen()
    return !!v && v.id !== this.id && now - v.at < SEEN_FOR && v.at <= now + 1000
  }

  // 讀快取裡的「念到哪一則了」
  refresh() {
    const gen = this.gen
    return (this.reading ||= (async () => {
      this._seen(Number((await this._read(MOTTO_DONE))?.at))
      if (gen === this.gen) this.fresh = true
    })().finally(() => {
      this.reading = null
    }))
  }

  // 伺服器上排著的那一串（這台的訂閱的）；ok：true 收到了、'sending' 還在送（送出不到 15 秒）、false 沒送到或不知道
  _armed(now = this.now()) {
    const a = readMottoArmed()
    if (!a || !this.sub || a.endpoint !== this.sub.endpoint) return null
    const ok = a.ok === true ? true : a.ok === null && now - (Number(a.sent) || 0) < MOTTO_SENDING ? 'sending' : false
    return { ...a, ok }
  }

  // 伺服器上排著這一則嗎（還在送的也算；送不到、送出去很久都沒回音的不算，頁面就自己念）
  covers(t, now = this.now()) {
    const a = this._armed(now)
    return !!a && a.ok !== false && a.times.includes(t)
  }

  // 頁面要不要先不念到點的這一則（t），交給推播或另一個分頁：
  //   頁面在背景：伺服器排著這一則、或別的分頁正看著（那邊會念）就不念（都沒有就頁面自己念：切到別的分頁時 JavaScript 還在跑）
  //   回到頁面、還沒讀到念到哪：先等一下（鎖著的時候可能推過了）
  //   剛回到頁面，伺服器排著的這一則剛到點：推播可能正在路上，等它幾秒
  defer(t, hidden, now = this.now()) {
    if (hidden) {
      this._away()
      return this.covers(t, now) || this.otherVisible(now)
    }
    if (!this.fresh) {
      this.refresh()
      return true
    }
    return this.covers(t, now) && now - t < MOTTO_GRACE
  }

  // 頁面要念這一則：先記下來（推播晚到時 Service Worker 就不再顯示）；已經有一邊念過了回 false
  claim(at) {
    if (!(at > this.done)) return false
    this.done = at
    this._writeDone(at)
    return true
  }

  async _writeDone(at) {
    try {
      const reg = await this._reg()
      if (!reg) return
      const cache = await this.storage.open(PLAN_CACHE)
      const url = new URL(MOTTO_DONE, reg.scope).href
      const old = Number((await (await cache.match(url))?.json())?.at) || 0
      if (old >= at) return this._seen(old)
      await cache.put(url, jsonRes({ at }))
    } catch {}
  }

  // 把那一串的字存進快取，存好了回 true（失敗的話 savedKey 不變，下一秒再存）。
  // 剛到點的那幾則（10 分鐘內）留著：頁面念過、重排之後那一則不在新的那一串裡了，晚到的推播還認得出是哪一則（不出聲地放）。
  // 沒有要提醒的、快取也還沒有：不用建一個只放空清單的快取（沒開通知的裝置開機時都會走到這裡）。
  // keep：false 是整個清空（關掉通知、退訂了：不會再有推播來）
  _saveTexts(keep = true) {
    const items = this.list
    const key = this.listKey
    return (this.saving ||= (async () => {
      try {
        const reg = await this._reg()
        if (!reg || (!items.length && (await this._cacheMissing()))) {
          this.savedKey = key
          return true
        }
        const cache = await this.storage.open(PLAN_CACHE)
        const url = new URL(MOTTO_FILE, reg.scope).href
        const now = this.now()
        let recent = []
        try {
          const old = keep ? await (await cache.match(url))?.json() : null
          if (Array.isArray(old)) recent = old.filter((x) => x && Number.isFinite(x.at) && x.at <= now && now - x.at < MOTTO_LATE && !items.some((y) => y.at === x.at))
        } catch {}
        await cache.put(url, jsonRes([...recent, ...items]))
        // 存的時候那一串又換了：這次存的是舊的，下一秒照新的再存
        if (key === this.listKey) this.savedKey = key
        return key === this.listKey
      } catch {
        return false
      }
    })().finally(() => {
      this.saving = null
    }))
  }

  // 要交出去的這幾則，快取裡都有字嗎：沒存好就先存；存好了也讀回來看一次（另一個分頁可能剛用它那一串蓋掉），
  // 對不上就照這邊的再存一次
  async _textsCover(times) {
    for (let i = 0; i < 2; i++) {
      if (this.savedKey !== this.listKey || i > 0) {
        if (this.saving) await this.saving
        if (!(await this._saveTexts())) return false
      }
      const saved = await this._read(MOTTO_FILE)
      const have = new Set(Array.isArray(saved) ? saved.map((x) => x?.at) : [])
      if (times.every((t) => have.has(t))) return true
      this.savedKey = null
    }
    return false
  }

  // items：接下來的警語 [{ at, title, body }]（main.js 排的；空的是不用提醒），hidden：頁面在背景（或正要關掉）。
  // 字存進快取給 Service Worker 讀；頁面在背景時把時間交給伺服器（沒變就不再送），
  // 看得到頁面時，伺服器排著的下一則快到了、或排法變了就取消（由頁面自己念）。每秒叫一次也不會多打伺服器
  sync(items, hidden, now = this.now()) {
    if (hidden) this._away()
    // 「看著這一頁」的記號只在交給伺服器排時用得到：沒訂閱推播的不用每 5 秒寫一次
    else if (this.sub) this._beat(now)
    // 那一串換了（main.js 只在排法變了時換一份新的）才重新比對
    const ready = this.ready()
    if (items !== this._items || ready !== this._ready) {
      this._items = items
      this._ready = ready
      this.list = ready ? items.slice(0, MOTTO_PUSH_MAX) : []
      this.listKey = JSON.stringify(this.list)
    }
    // 別的分頁正看著時，在背景的分頁不寫（字以看著的那一邊排的為準，不會被背景分頁比較舊的那一串蓋掉）
    if (this.savedKey !== this.listKey && !this.saving && !(hidden && this.otherVisible(now))) this._saveTexts()
    if (!this.sub) return null
    const mine = this._armed(now)
    // 沒送到、或送出去很久都沒回音（送的那個分頁被關掉了）：伺服器上是什麼不確定，當成要重送。
    // 確定沒送到（這個分頁剛送失敗）的等一下再送；沒回音的馬上送
    const unsure = !!mine && mine.ok === false
    if (unsure && readMottoArmed()?.ok === false && now < this.retryAt) return null
    const live = (xs) => xs.filter((x) => x > now)
    const since = Math.max(this.done, now - MOTTO_LATE)
    const want = this.list.filter((x) => x.at > since).map((x) => x.at)
    const armed = mine ? mine.times : []
    const same = sameList(live(armed), live(want))
    if (hidden) {
      // 別的分頁正看著：那邊念，這邊不交（它離開頁面時自己會交）
      if (this.otherVisible(now)) return null
      if (want.length) return !mine || unsure || !same ? this._send(want, now) : null
      return armed.length || unsure ? this._send([], now) : null
    }
    if (!armed.length && !unsure) return null
    const next = live(armed)[0]
    return unsure || !same || (next != null && next <= now + MOTTO_NEAR) ? this._send([], now) : null
  }

  // 交一串時間給伺服器（空的是取消）。先記成「伺服器上是這一串」（其他分頁、下一秒的檢查就不會再送一次），
  // 沒送到改成 ok: false，等一下再送；送的時候又送了新的就不動它。要顯示的字還沒存好就先存（存不進去就不交：
  // 交了的話到點時 Service Worker 只能顯示一般的字）
  async _send(times, now) {
    let sub = this.sub
    const seq = nextSeq(now)
    writeMottoArmed({ endpoint: sub.endpoint, times, seq, ok: null, sent: now })
    const body = (s) => ({ endpoint: s.endpoint, after: times.length ? times.map((t) => Math.max(1000, Math.round(t - this.now()))) : null, seq })
    const mark = (ok) => {
      const cur = readMottoArmed()
      if (cur?.seq === seq) writeMottoArmed({ ...cur, endpoint: sub.endpoint, ok })
    }
    try {
      if (times.length && !(await this._textsCover(times))) throw new Error('警語的字沒存進快取')
      const r = await this.api('/v1/push/mottos', body(sub), { keepalive: true })
      const again = await this._resub(sub, r?.key)
      if (again) {
        sub = this.sub = again
        // 等回音的時候又送了新的（例如剛取消）：這一串已經不是現在要的，不要用新的訂閱把它排回去（下一秒的檢查照新的訂閱重送）
        if (readMottoArmed()?.seq !== seq) return false
        await this.api('/v1/push/mottos', { ...body(sub), seq: nextSeq(this.now()) }, { keepalive: true })
      }
      mark(true)
      this.retryAt = 0
      return true
    } catch (e) {
      console.warn('[hiyori] 警語的推播沒交給伺服器', e)
      mark(false)
      this.retryAt = this.now() + MOTTO_RETRY
      return false
    }
  }

  // 連上線了：沒送到的現在再送（下一秒的檢查就會送）
  retry() {
    this.retryAt = 0
  }

  // 關掉通知（退訂之前）：伺服器上排著的取消（排著一串、或不知道有沒有送到的；剛送出的取消不用再送一次）、快取裡的字拿掉
  async off(sub = this.sub) {
    const rec = readMottoArmed()
    const now = this.now()
    const unsure = rec && (rec.ok === false || (rec.ok === null && now - (Number(rec.sent) || 0) >= MOTTO_SENDING))
    if (sub && rec && rec.endpoint === sub.endpoint && (rec.times.length || unsure)) {
      await this.api('/v1/push/mottos', { endpoint: sub.endpoint, after: null, seq: nextSeq(now) }).catch(() => {})
    }
    writeMottoArmed(null)
    this.list = []
    this.listKey = '[]'
    this._items = null
    await this.saving
    await this._saveTexts(false)
    this.sub = null
  }

  // 上一則警語的推播 { got, at }（沒有是 null）：警語卡上寫「上一則推播幾點送到」
  last() {
    return this._lastLog(MOTTO_LOG)
  }
}
