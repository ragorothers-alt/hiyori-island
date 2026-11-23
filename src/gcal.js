// Google 日曆同步（雙向）：App 在 Google 開一個「ひより日和」日曆，日程、排了時段的任務、截止日寫進去；
// 在 Google 上改了這個日曆（時間、日子、名稱、說明、刪掉、新增），App 跟著改（可以撤銷）。換格式、比對在 src/gcalMap.js。
//
// 授權：OAuth 授權碼＋PKCE。授權畫面回到 App 後，用 Worker 換 token（client secret 在 Worker，見 worker/src/gcal.js）。
// 權限只有 calendar.app.created（只能動 App 自己開的日曆，看不到其他日曆）。
// refresh token 存在這台（localStorage），開著線上同步時放在加密的那一包裡帶到別台（cloud.js 的 extras，跟ふじ的通行碼一樣），
// 不會出現在匯出、資料夾同步的檔案裡。access token 只在這台，過期前用 Worker 換新的。
// 同步本身是這台直接跟 Google 做的：日程的內容不經過 Worker。
//
// 每台各自記著 Google 上每一筆的樣子和上次兩邊對好的樣子（CACHE_KEY），用 syncToken 只拿變動的；跟 App 比完照 gcalMap.plan 做。
// 同一台開好幾個分頁時只有一個在做（navigator.locks）。
import { SYNC_API } from './cloud.js'
import { native } from './native.js'
import { CAL_NAME, GCAL_PAST, appItems, fromGoogle, plan, sigOf, toGoogle } from './gcalMap.js'
import { addDays } from './store/util.js'

const TOKEN_KEY = 'hiyori-gcal-token'
const ACCESS_KEY = 'hiyori-gcal-access'
const CACHE_KEY = 'hiyori-gcal-cache'
const PENDING_KEY = 'hiyori-gcal-pending'
const SHARED_KEY = 'hiyori-gcal-shared'
const API = 'https://www.googleapis.com/calendar/v3'
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
// 授權畫面回來的網址上，這些參數處理完就拿掉
const AUTH_PARAMS = ['code', 'state', 'scope', 'authuser', 'prompt', 'iss', 'hd', 'error', 'error_description', 'error_uri']
const PENDING_MAX = 30 * 60000
// 刪掉的那幾筆記多久
const GONE_KEEP = 45 * 86400000
// 一次同時寫幾筆
const PARALLEL = 4

// 錯誤代碼 → 給人看的話
export const GCAL_TEXT = {
  offline: '連不上網路，等一下會自己再試',
  expired: 'Google 的授權過期或被收回了，重新連接一次',
  gone: 'Google 上的「ひより日和」日曆不見了（被刪掉了？）',
  scope: '授權時沒有勾「管理 App 建立的日曆」，重新連接一次',
  denied: '授權畫面按了取消，沒有連上',
  stale: '授權等太久了，再連接一次',
  webview: 'Android 的 App 裡 Google 不讓登入：請在瀏覽器（電腦、手機的 Chrome）連接一次，開著線上同步的話這台會跟著連上',
  'gcal off': 'Worker 還沒設定 Google 的用戶端（README 的「Google 日曆同步」）',
  'gcal client': 'Worker 裡的 Google 用戶端 ID 或密鑰不對',
  'gcal no refresh': 'Google 沒給長期的授權，再連接一次',
  save: 'App 的資料存不進去（瀏覽器空間滿了），Google 上改的先不帶進來：清出一點空間後會自己再試',
  'too many requests': 'Google 說太頻繁了，等一下會自己再試',
  storage: '這台的瀏覽器空間滿了，授權存不進去：先清出一點空間再連接',
  busy: 'Google 日曆暫時連不上，等一下會自己再試',
  error: 'Google 日曆暫時連不上，等一下會自己再試',
}
export const gcalText = (code) => GCAL_TEXT[code] || GCAL_TEXT.error
const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra })

const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null')
  } catch {
    return null
  }
}
const write = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k)
    else localStorage.setItem(k, JSON.stringify(v))
    return true
  } catch {
    return false
  }
}
// 這台的授權：{ refresh, at }（at：什麼時候連上／中斷的，別台同步過來的照它原本的時間）
export function gcalToken() {
  const t = read(TOKEN_KEY)
  return { refresh: typeof t?.refresh === 'string' ? t.refresh : '', at: Number.isFinite(t?.at) && t.at > 0 ? t.at : 0 }
}
const setToken = (refresh, at) => write(TOKEN_KEY, { refresh, at })

// 跟著線上同步帶到別台（接在 CloudSync 的 extras 上，見 joinExtras）：比較新的那一次連接／中斷為準
export function gcalExtras(onAdopt = () => {}) {
  const sig = (x) => (x?.gcal?.at ? String(x.gcal.at) : '')
  const get = () => {
    const t = gcalToken()
    return t.at ? { gcal: { refresh: t.refresh, at: t.at } } : null
  }
  return {
    get,
    sent: (x) => {
      if (sig(x)) write(SHARED_KEY, sig(x))
    },
    set(x) {
      const g = x?.gcal
      if (!g || !Number.isFinite(g.at) || g.at <= gcalToken().at) return
      const refresh = typeof g.refresh === 'string' && g.refresh.length <= 2000 ? g.refresh : ''
      setToken(refresh, g.at)
      write(ACCESS_KEY, null)
      write(SHARED_KEY, sig(x))
      onAdopt(!!refresh)
    },
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)))
async function challengeOf(verifier) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(d))
}
// 授權完回到的網址：App 現在的網址（不含檔名、參數）。要在 Google 的用戶端設定裡登記
export const redirectUri = (loc = location) => `${loc.origin}${loc.pathname.replace(/index\.html$/, '')}`

const tagOf = (refresh) => sigOf(refresh)
// 這台記著的：cal、syncToken、Google 上每一筆的樣子（items）、上次兩邊對好的樣子（base：gid → [App 的指紋, Google 的指紋]，null＝那一邊沒有）
const emptyCache = (cal) => ({ cal, sync: '', items: {}, base: {}, t: {} })
// Google 上的一筆記成短的樣子（可能有上千筆）。內容 c 兩邊對好之後就拿掉（只在要帶進 App 時用）
const pack = (r, prev) => {
  const o = { k: r.k, i: r.hid || '', b: r.b || prev?.b || '', h: r.h || '', d: r.date || prev?.d || '', u: r.updated || 0, e: r.etag || '' }
  if (r.cancelled) {
    o.x = 1
    // 刪掉的活動 Google 不一定還留著自己的屬性：照記著的
    if (!r.hid && prev?.i) Object.assign(o, { k: prev.k, i: prev.i })
  }
  if (r.foreign && !(r.cancelled && prev?.i)) o.f = 1
  if (r.rec) o.r = 1
  if (r.bad) o.z = 1
  if (r.c) o.c = r.c
  return o
}
const unpack = (gid, o) => ({
  gid, k: o.k, hid: o.i || null, b: o.b || '', h: o.h || '', date: o.d || '', updated: o.u || 0, etag: o.e || '', c: o.c || null,
  cancelled: !!o.x, foreign: !!o.f, rec: !!o.r, bad: !!o.z,
})
// 這幾種出錯要使用者動手（重新連接、到 Worker 設定）：自己就不再一直試
const TERMINAL = new Set(['expired', 'scope', 'gone', 'gcal off', 'gcal client'])
// 這台的授權還沒跟著線上同步送出去過（剛連上、或連上之後才開線上同步）
export const gcalUnshared = () => {
  const t = gcalToken()
  return !!t.at && read(SHARED_KEY) !== String(t.at)
}
// 授權畫面那一來一回的暫存（state、PKCE 的 verifier）：只放在這個分頁（兩個分頁同時按連接也不會互相蓋掉）
const pending = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null')
    } catch {
      return null
    }
  },
  set(v) {
    try {
      if (v == null) sessionStorage.removeItem(PENDING_KEY)
      else sessionStorage.setItem(PENDING_KEY, JSON.stringify(v))
      return true
    } catch {
      return false
    }
  },
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// onApplied(rec)：在 Google 上改的帶進 App 了（rec 給 store.gcalUndo）。
// ready()：可以開始同步了沒（開機時線上同步先拉完：這台的資料可能是舊的，先同步會把舊的寫上 Google，蓋掉別台剛寫的）。
// settle()：授權回來、要決定用哪個日曆之前等它（線上同步拉完，才知道別台是不是已經開好日曆了）
export function createGcal(store, {
  fetcher = (...a) => fetch(...a), now = () => Date.now(), tz: here = Intl.DateTimeFormat().resolvedOptions().timeZone, api = SYNC_API,
  nav = typeof location === 'undefined' ? null : location, onApplied = () => {}, ready = () => true, settle = () => null, timeout = 20000,
} = {}) {
  // 每台都用連上時記下的時區換算（各台在不同時區也不會以為改過）
  const zone = () => store.state.gcal?.tz || here
  let status = { phase: 'off', error: '', at: 0, done: 0, total: 0, count: 0 }
  const listeners = new Set()
  const setStatus = (patch) => {
    status = { ...status, ...patch }
    listeners.forEach((fn) => fn(status))
  }
  let running = null
  let again = false
  let timer = 0
  let refreshing = null
  // 同步的世代：中斷、重新連上、整份資料換掉就換一個。還沒回來的舊請求回來時，不再動 App 的資料、不再記任何東西
  let gen = 0
  // 連接的世代：按了中斷、另一次連接好了就換一個（授權畫面回來、還在弄日曆時按了中斷，就不再接著連上）
  let conn = 0

  // 回傳 { ok, status, j }。逾時連回應的內容也算（標頭到了、內容卡住也會停）
  async function request(url, opts) {
    const ctrl = typeof AbortController === 'undefined' ? null : new AbortController()
    const t = ctrl && setTimeout(() => ctrl.abort(), timeout)
    try {
      let res
      try {
        res = await fetcher(url, ctrl ? { ...opts, signal: ctrl.signal } : opts)
      } catch {
        throw fail('offline')
      }
      if (res.status === 204) return { ok: true, status: 204, j: null }
      let j = null
      try {
        j = await res.json()
      } catch {
        // 讀到一半斷了、逾時：連不上。說成功卻讀不懂內容的不當成「什麼都沒有」（不然會以為 Google 上的全刪了）
        if (ctrl?.signal.aborted) throw fail('offline')
        if (res.ok) throw fail('error', { status: res.status })
      }
      return { ok: res.ok, status: res.status, j }
    } finally {
      clearTimeout(t)
    }
  }

  // ── Worker（換 token）──
  const WORKER_CODES = { 'gcal expired': 'expired', 'gcal scope': 'scope' }
  async function worker(path, body) {
    const { ok, status, j } = await request(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!ok || !j?.ok) throw fail(WORKER_CODES[j?.error] || j?.error || (status >= 500 ? 'busy' : 'error'), { status })
    return j
  }
  async function access() {
    const t = gcalToken()
    if (!t.refresh) throw fail('expired')
    const a = read(ACCESS_KEY)
    if (a?.of === tagOf(t.refresh) && a.exp > now() + 60000 && typeof a.access === 'string') return a.access
    refreshing ??= worker('/v1/gcal/refresh', { refresh: t.refresh })
      .then((r) => {
        write(ACCESS_KEY, { access: r.access, exp: now() + r.expires * 1000, of: tagOf(t.refresh) })
        return r.access
      })
      .finally(() => (refreshing = null))
    return refreshing
  }

  // ── Google Calendar API ──
  // match：活動的 etag（If-Match）：Google 那邊在這之後又被改過的話回 412，不蓋掉。retry：太頻繁、伺服器出錯時要不要等一下再試。
  // live：每一次送出（含等一下再試）之前看還能不能做（中斷了就不送）。token：用這一把（授權剛回來、還沒存起來的）
  async function google(method, path, body, { match = '', retry = true, tries = 0, fresh = false, live = null, token: given = '' } = {}) {
    live?.()
    const token = given || (await access())
    live?.()
    const res = await request(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(match ? { 'If-Match': match } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const j = res.j
    if (res.ok) return j
    const reason = j?.error?.errors?.[0]?.reason || ''
    const more = { match, retry, live, token: given }
    // access token 過期（或被別台撤銷）：換一把再試一次
    if (res.status === 401 && !fresh && !given) {
      write(ACCESS_KEY, null)
      return google(method, path, body, { ...more, tries, fresh: true })
    }
    if (res.status === 401) throw fail('expired', { status: 401 })
    const busy = res.status === 429 || (res.status === 403 && /rate|quota/i.test(reason))
    if (retry && (busy || res.status >= 500) && tries < 3) {
      await wait(1000 * 2 ** tries + Math.random() * 500)
      return google(method, path, body, { ...more, tries: tries + 1, fresh })
    }
    const code = busy ? 'too many requests' : res.status === 403 && /insufficient|forbidden/i.test(reason) ? 'scope' : res.status >= 500 ? 'busy' : 'error'
    throw fail(code, { status: res.status, reason })
  }
  const calPath = (cal) => `/calendars/${encodeURIComponent(cal)}`

  // ── 連接、中斷 ──
  // 打開 Google 的授權畫面（整頁換過去，授權完回到 App，開機時 finish 接著做）
  async function connect() {
    if (native) throw fail('webview')
    const cfg = await worker('/v1/gcal/config', {})
    const verifier = random(48)
    const st = random(18)
    const redirect = redirectUri(nav)
    if (!pending.set({ st, verifier, redirect, at: now() })) throw fail('error')
    const q = new URLSearchParams({
      client_id: cfg.clientId, redirect_uri: redirect, response_type: 'code', scope: cfg.scope, access_type: 'offline', prompt: 'consent',
      state: st, code_challenge: await challengeOf(verifier), code_challenge_method: 'S256',
    })
    nav.assign(`${AUTH}?${q}`)
  }
  // 網址上授權用的參數拿掉（授權碼不留在網址列、瀏覽紀錄）
  function cleanUrl() {
    if (!nav?.href || typeof history === 'undefined') return
    const u = new URL(nav.href)
    for (const k of AUTH_PARAMS) u.searchParams.delete(k)
    history.replaceState(history.state, '', u.pathname + u.search + u.hash)
  }
  // 開機時：網址上是 Google 授權畫面回來的就先把參數拿掉；是這個分頁剛才發出去的（state 對得上）就換 token、開好日曆。
  // 不是的回傳 null；連上了回傳 { created }
  async function finish(search = nav?.search || '') {
    const q = new URLSearchParams(search)
    const st = q.get('state')
    // 授權畫面回來的（有授權碼、或帶著 state 的錯誤）：先把參數拿掉，再看是不是這個分頁剛才發出去的
    if (!q.has('code') && !(st && q.has('error'))) return null
    cleanUrl()
    const p = pending.get()
    pending.set(null)
    // 重新整理、從瀏覽紀錄打開了授權回來的網址：清掉就好
    if (!st || !p || p.st !== st) return null
    if (q.get('error')) throw fail(q.get('error') === 'access_denied' ? 'denied' : 'error')
    if (now() - p.at > PENDING_MAX) throw fail('stale')
    const c0 = conn
    const t = await worker('/v1/gcal/token', { code: q.get('code'), verifier: p.verifier, redirect: p.redirect })
    // 線上同步先拉完：別台可能已經開好日曆了（不要再開一個）
    await Promise.race([settle(), wait(30000)])
    // 換到的授權沒用上（等的時候按了中斷）：在 Google 那邊也撤銷掉
    const drop = () => worker('/v1/gcal/revoke', { token: t.refresh }).catch(() => {})
    // 等的時候按了中斷：不接著連上
    if (conn !== c0) {
      drop()
      return null
    }
    const mine = ++conn
    const was0 = gen
    const live = () => {
      if (mine !== conn || was0 !== gen) throw fail('stopped')
    }
    // 日曆弄好之前先不存這把授權（線上同步不會把還沒確定的帶到別台）：直接用剛換到的
    const use = { token: t.access, live }
    try {
      // 之前連過（中斷了、或別台開的）：那個日曆還在就接著用，不另外開一個
      let cal = store.state.gcal?.cal || ''
      if (cal) {
        try {
          await google('GET', calPath(cal), null, use)
        } catch (e) {
          // 不在了、不是這個 App 開的（換了 Google 帳號）：另外開一個。太頻繁、連不上：先不連，不要多開一個
          if (!(e.status === 404 || (e.status === 403 && e.code === 'scope'))) throw e
          cal = ''
        }
      }
      const created = !cal
      if (created) {
        // 開日曆不重試：伺服器其實開好了只是回應出錯的話，再送一次會多開一個
        const c = await google('POST', '/calendars', { summary: CAL_NAME, description: 'ひより日和 App 的日程、排了時段的任務和截止日。在這裡改，App 也會跟著改。', timeZone: zone() }, { retry: false, ...use })
        cal = c?.id
        if (!cal) throw fail('error')
      }
      live()
      const was = gcalToken()
      if (!setToken(t.refresh, Math.max(now(), was.at + 1))) throw fail('storage')
      write(ACCESS_KEY, { access: t.access, exp: now() + t.expires * 1000, of: tagOf(t.refresh) })
      gen++
      const tz = !created && store.state.gcal?.tz ? store.state.gcal.tz : here
      write(CACHE_KEY, emptyCache(cal))
      store.setGcal({ cal, on: true, tz })
      setStatus({ phase: 'off', error: '', done: 0, total: 0 })
      kick(0)
      return { created }
    } catch (e) {
      // 日曆沒弄好：授權沒存（這台本來沒連上就還是沒連上），換到的那把撤銷掉。按了中斷的不用說
      drop()
      if (e?.code === 'stopped') return null
      throw e
    }
  }
  // 中斷連線：每台都停（state.gcal.on），授權撤銷掉。Google 上的「ひより日和」日曆留著（要刪自己在 Google 刪）。
  // 回傳 { revoked }：Google 那邊的授權有沒有撤銷成功（連不上的話要自己到 Google 帳戶移除）
  async function disconnect() {
    gen++
    conn++
    clearTimeout(timer)
    const t = gcalToken()
    setToken('', Math.max(now(), t.at + 1))
    write(ACCESS_KEY, null)
    write(CACHE_KEY, null)
    store.setGcal({ on: false })
    setStatus({ phase: 'off', error: '', done: 0, total: 0 })
    if (!t.refresh) return { revoked: true }
    try {
      await worker('/v1/gcal/revoke', { token: t.refresh })
      return { revoked: true }
    } catch {
      return { revoked: false }
    }
  }

  // ── 同步 ──
  // Google 上變動的那幾筆（第一次是全部）。全部頁都拿完才換上去：中途出錯的話下次從同一個 syncToken 再拿
  async function pull(cache, live) {
    const base = `${calPath(cache.cal)}/events`
    const prev = cache.items
    for (let full = 0; ; full++) {
      const token = cache.sync
      const got = {}
      let page = ''
      try {
        for (;;) {
          // 每一頁都帶著同一個 syncToken（翻頁時查詢條件要一樣）
          const q = new URLSearchParams({ maxResults: '2500', showDeleted: 'true', singleEvents: 'false' })
          if (token) q.set('syncToken', token)
          if (page) q.set('pageToken', page)
          const r = await google('GET', `${base}?${q}`, null, { live })
          live()
          // 說成功卻不是清單：不當成「Google 上什麼都沒有」
          if (!r || typeof r !== 'object' || !(Array.isArray(r.items) || (r.items === undefined && (r.nextPageToken || r.nextSyncToken)))) throw fail('error')
          for (const ev of r?.items || []) if (typeof ev?.id === 'string') got[ev.id] = pack(fromGoogle(ev, zone()), prev[ev.id])
          if (r?.nextPageToken) {
            page = r.nextPageToken
            continue
          }
          cache.items = token ? { ...prev, ...got } : got
          cache.sync = r?.nextSyncToken || ''
          return
        }
      } catch (e) {
        // syncToken 太舊了（410）：從頭拿一次（記著的還留著：刪掉的那幾筆 Google 不一定還有自己的屬性）
        if (e.status === 410 && full < 1) {
          cache.sync = ''
          continue
        }
        if (e.status === 404) throw fail('gone', { status: 404 })
        throw e
      }
    }
  }
  // 一次同時做幾筆；有一筆出錯就不再拿新的，等已經送出去的都回來才結束（不會在下一輪開始後才寫到舊的）
  async function each(list, fn, live) {
    let i = 0
    let err = null
    const work = async () => {
      while (i < list.length && !err) {
        const x = list[i++]
        try {
          live()
          await fn(x)
        } catch (e) {
          // 中斷了的那個優先（不會被同時出的「連不上」蓋掉，之後就不再記任何東西）
          if (e?.code === 'stopped') err = e
          else err ??= e
        }
        try {
          live()
          setStatus({ done: status.done + 1 })
        } catch {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, work))
    if (err) throw err
  }
  // 已經有的用 PATCH：只動 App 管的欄位，在 Google 上加的地點、顏色、邀請的人留著（PUT 會整個換掉）。
  // 整天和有時段互換時，另一種寫法要明白清掉；刪掉的活動 PATCH 成 confirmed 就回來了（同一個 id 不能再 insert）
  const patchOf = (body) => ({
    ...body,
    start: { date: null, dateTime: null, timeZone: null, ...body.start },
    end: { date: null, dateTime: null, timeZone: null, ...body.end },
  })
  async function act(cache, acts, live) {
    const base = `${calPath(cache.cal)}/events`
    const B = cache.base
    const T = cache.t
    let stale = false
    const g = (m, path, b, o = {}) => google(m, path, b, { ...o, live })
    setStatus({ done: 0, total: acts.push.length + acts.del.length + acts.mark.length })
    const keep = (gid, ev) => {
      if (ev?.id) cache.items[gid] = pack(fromGoogle(ev, zone()), cache.items[gid])
    }
    // Google 那邊剛被改過（412）、別台剛加了同一筆（409）：讀回來，下一輪照最新的樣子再比
    const reread = async (gid) => {
      stale = true
      try {
        const ev = await g('GET', `${base}/${gid}`)
        live()
        keep(gid, ev)
      } catch (e) {
        if (e.status === 404) delete cache.items[gid]
        else throw e
      }
    }
    await each(acts.push, async (x) => {
      const body = toGoogle(x.c, { id: x.id, sig: x.sig, tz: zone() })
      // 同一個 id 已經用過（409）：刪掉了的就 PATCH 回來（同一個 id 不能再 insert）；是別台剛加的就讀回來，下一輪再比
      const insert = async () => {
        try {
          return await g('POST', base, { id: x.gid, ...body })
        } catch (e) {
          if (e.status !== 409) throw e
          const cur = await g('GET', `${base}/${x.gid}`)
          live()
          if (cur?.status !== 'cancelled') {
            keep(x.gid, cur)
            stale = true
            return null
          }
          return g('PATCH', `${base}/${x.gid}`, patchOf(body), { match: cur.etag || '' })
        }
      }
      let ev
      try {
        ev = x.exists ? await g('PATCH', `${base}/${x.gid}`, patchOf(body), { match: x.etag }) : await insert()
      } catch (e) {
        if (e.status === 409 || e.status === 412) return reread(x.gid)
        // Google 上真的沒有了（永久刪掉）：重新加
        if (!(e.status === 404 && x.exists)) throw e
        try {
          ev = await insert()
        } catch (e2) {
          if (e2.status === 409 || e2.status === 412) return reread(x.gid)
          throw e2
        }
      }
      if (!ev) return
      live()
      keep(x.gid, ev)
      const r = cache.items[x.gid]
      B[x.gid] = [x.sig, r && !r.x ? r.h : x.sig]
      delete T[x.gid]
    }, live)
    await each(acts.del, async (x) => {
      try {
        await g('DELETE', `${base}/${x.gid}`, null, { match: x.etag })
      } catch (e) {
        if (e.status === 412) return reread(x.gid)
        if (e.status !== 404 && e.status !== 410) throw e
      }
      live()
      const r = { ...(cache.items[x.gid] || {}), x: 1, u: now() }
      delete r.c
      cache.items[x.gid] = r
      B[x.gid] = [null, null]
      delete T[x.gid]
    }, live)
    await each(acts.mark, async (x) => {
      const priv = { hiyori: x.k, hid: x.id, sig: x.sig, ...(x.k === 'e' ? {} : { done: x.done ? '1' : '0' }) }
      try {
        keep(x.gid, await g('PATCH', `${base}/${x.gid}`, { extendedProperties: { private: priv } }, { match: x.etag }))
      } catch (e) {
        if (e.status === 412 || e.status === 404 || e.status === 410) return reread(x.gid)
        throw e
      }
      live()
      B[x.gid] = [x.sig, x.sig]
      delete T[x.gid]
    }, live)
    return stale
  }
  async function once() {
    const g = store.state.gcal
    if (!g?.on || !g.cal) return setStatus({ phase: 'off', error: '', done: 0, total: 0 })
    if (!gcalToken().refresh) return setStatus({ phase: 'nokey', error: '', done: 0, total: 0 })
    if (!ready()) return
    const my = gen
    const live = () => {
      const now = store.state.gcal
      if (my !== gen || !now?.on || now.cal !== g.cal) throw fail('stopped')
    }
    setStatus({ phase: 'syncing', error: '', done: 0, total: 0 })
    let cache = read(CACHE_KEY)
    if (!cache || cache.cal !== g.cal || typeof cache.items !== 'object') cache = emptyCache(g.cal)
    if (typeof cache.base !== 'object' || !cache.base) cache.base = {}
    if (typeof cache.t !== 'object' || !cache.t) cache.t = {}
    const today = store.today
    // App 這邊每一筆是什麼時候改的（兩邊都改了同一筆時比這個，不是整份資料最後改的時間：改了別的不算）：
    // cache.t[gid] = [App 那時的指紋（null＝刪了）, 時間]。同步之前就記（改完就會排一次同步，斷線、Google 連不上時也記得到）；
    // 又改了一次就換成新的時間，改回對好的樣子就拿掉。時間不晚於整份資料最後改的時間（改完馬上關掉、隔一陣子才打開也不會變晚）
    const seen = () => {
      const { items } = appItems(store.state, { today })
      const t = Math.min(now(), store.state.updatedAt || now())
      const note = (gid, sig) => {
        const s0 = cache.base[gid]?.[0] ?? null
        if (s0 === sig) delete cache.t[gid]
        else if (!Array.isArray(cache.t[gid]) || cache.t[gid][0] !== sig) cache.t[gid] = [sig, t]
      }
      for (const [gid, a] of items) if (!a.old && cache.base[gid]) note(gid, a.sig)
      for (const gid of Object.keys(cache.base)) if (!items.has(gid)) note(gid, null)
    }
    seen()
    try {
      await pull(cache, live)
      live()
      const cut = addDays(today, -GCAL_PAST)
      let applied = false
      let stale = false
      for (let pass = 0; pass < 2; pass++) {
        const { items, has } = appItems(store.state, { today })
        const remote = new Map(Object.entries(cache.items).map(([gid, o]) => [gid, unpack(gid, o)]))
        const base = new Map(Object.entries(cache.base).map(([gid, [s, gg]]) => [gid, { s, g: gg }]))
        const acts = plan({ app: items, has, remote, base, appAt: (gid) => (Array.isArray(cache.t[gid]) && cache.t[gid][1]) || store.state.updatedAt || 0, cut })
        // 先把 Google 上的改動帶進 App，再照帶進來之後的樣子重新比一次（第二次只寫 Google，不再帶）
        if (!applied && acts.apply.length) {
          applied = true
          // 比較早改的先帶（同一件任務的時段、截止日都在 Google 改了名稱：比較晚改的那個留下來）。
          // 別台的 App 改的（quiet：活動上記著的指紋就是現在的內容）：這台的 App 跟著改就好，不用說；在 Google 上改的才說一聲、可以撤銷
          acts.apply.sort((p, q) => p.u - q.u)
          const rec = store.gcalApply(acts.apply)
          // App 的資料真的存進去了才說、才記成對好了（存不進去的話，重新打開時 App 還是舊的：下一次再帶一次，不會當成 App 改回去了）
          if (rec.changed && store.flushSave() === false) throw fail('save')
          if (rec.n) onApplied(rec)
          // 帶進來之後，基準當成 Google 那邊的樣子：App 跟它不一樣的（另一筆帶進來時連帶改到的名稱、App 表示不了要整理過的分鐘）
          // 下一輪照 App 的寫回 Google，寫一次就對好了。App 已經沒有這一筆的（在 Google 把時段改成整天）：記成「App 沒有、Google 有」，
          // 不去刪 Google 上的那一筆。做完了沒是 App 管的（Google 上的不帶進來）：這台還沒拿到別台勾的完成時，不把 Google 上的 ✓ 改回去
          const after = appItems(store.state, { today }).items
          for (const x of acts.apply) {
            const now = after.get(x.gid)
            const s = !now ? null : x.c && 'done' in x.c && now.c.done !== x.c.done ? sigOf({ ...x.c, done: now.c.done }) : x.g
            cache.base[x.gid] = [s, x.g]
            delete cache.t[x.gid]
          }
          continue
        }
        for (const x of acts.agree) {
          cache.base[x.gid] = [x.s, x.g]
          delete cache.t[x.gid]
        }
        stale = await act(cache, acts, live)
        live()
        break
      }
      // 太久以前刪掉的不用再記；對好了的不用留內容
      const appGids = new Set(appItems(store.state, { today }).items.keys())
      for (const [gid, o] of Object.entries(cache.items)) {
        // App 還有這一筆的不忘（同一個 id 在 Google 上不能再 insert，要記得它是刪掉的那一筆）
        if (o.x && o.u && now() - o.u > GONE_KEEP && !appGids.has(gid)) delete cache.items[gid]
        else if (o.c && cache.base[gid]?.[1] === o.h) delete o.c
      }
      for (const gid of Object.keys(cache.base)) if (!cache.items[gid] && !appGids.has(gid)) delete cache.base[gid]
      for (const gid of Object.keys(cache.t)) if (!cache.items[gid] && !appGids.has(gid) && !cache.base[gid]) delete cache.t[gid]
      if (store.flushSave() === false) throw fail('save')
      write(CACHE_KEY, cache)
      const count = Object.values(cache.items).filter((o) => !o.x && !o.f && o.i).length
      setStatus({ phase: 'ready', error: '', at: now(), count, done: 0, total: 0 })
      if (stale) kick(3000)
    } catch (e) {
      // 中斷了（或換了日曆、整份資料換掉了）：什麼都不記
      if (e?.code === 'stopped' || my !== gen) return
      const code = e?.code || 'error'
      // 做到一半出錯（斷線、太頻繁）：做完的那幾筆照樣記著，下次接著做。App 的資料存不進去：什麼都不記（照上一次的再比）
      if (code !== 'save') write(CACHE_KEY, code === 'gone' ? null : cache)
      setStatus({ phase: 'error', error: code })
    }
  }
  // 跑一次同步（正在跑的話，跑完再跑一次）。同一台別的分頁正在跑就讓它跑。
  // auto：自己排的（改了資料、回到 App、每 2 分鐘）。要使用者動手的錯（授權過期、日曆不見了）就不再自己試
  function run({ auto = false } = {}) {
    if (auto && status.phase === 'error' && TERMINAL.has(status.error)) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        const locks = typeof navigator !== 'undefined' ? navigator.locks : null
        if (locks?.request) await locks.request('hiyori-gcal', { ifAvailable: true }, (lock) => (lock ? once() : null))
        else await once()
      } while (again)
    })().finally(() => (running = null))
    return running
  }
  // App 改了資料：等一下再同步（連續改的一起寫）
  function kick(ms = 2500) {
    clearTimeout(timer)
    timer = setTimeout(() => run({ auto: true }), ms)
  }
  // 整份資料換掉了（匯入、還原備份、重置）：這台跟 Google 對好的樣子不算數了。
  // 換掉之後 App 沒有的不會被當成「刪掉了」而從 Google 刪掉（照著活動上記著的指紋重新比）
  store.on('reload', (p) => {
    if (p?.soft && !p.whole) return
    gen++
    const cache = read(CACHE_KEY)
    if (cache?.cal) write(CACHE_KEY, emptyCache(cache.cal))
    if (store.state.gcal?.on) kick()
  })

  return {
    connect,
    finish,
    disconnect,
    run,
    kick,
    status: () => ({ ...status, on: !!store.state.gcal?.on, mine: !!gcalToken().refresh }),
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

// 好幾份跟著線上同步走的東西（ふじ的通行碼、Google 日曆的授權）接在同一個 extras 上
export function joinExtras(...list) {
  return {
    get() {
      let out = null
      for (const x of list) {
        const v = x.get?.()
        if (v) out = { ...(out || {}), ...v }
      }
      return out
    },
    sent: (v) => list.forEach((x) => x.sent?.(v)),
    set: (v) => list.forEach((x) => x.set?.(v)),
  }
}
