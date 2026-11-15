// 到點的推播（/v1/push/*）：番茄鐘到點、警語的定時提醒，手機鎖著、App 被系統暫停、頁面關掉也收得到通知。
// 前端只交兩樣東西：這台裝置的推播網址（endpoint，瀏覽器廠商的推播服務給的）和「幾毫秒後到點」。
// 推播不帶內容：不用加密，任務名稱、警語的字也不會離開裝置；要顯示的字留在裝置上，Service Worker 收到推播時自己讀。
// PushHub（Durable Object）有兩種：
//   名字是 'vapid' 的那一個：保管這個 Worker 的 VAPID 金鑰（第一次用到時自己產生，不用另外設 secret），幫忙簽名
//   其他的：一台裝置一個（名字是 endpoint 的 SHA-256），記著 endpoint，用 alarm 到點送出。
//   一台裝置同時排一個計時器（'timer'，新的蓋掉舊的）和一串警語的時間（'mottos'，離開頁面時交來、回到頁面時取消）
import { HttpError, bump } from './http.js'

// 只送到瀏覽器廠商的推播服務（Chrome／Edge／Firefox／Safari）：不然這裡會變成「幫人在指定時間打任意網址」
const HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/]
// 最久排到多久以後：正向計時最長 3 小時，留一點餘裕
export const MAX_AFTER = 6 * 3600_000
// 到點時裝置離線：這麼久以內連上線還是送到，再晚就不送了（過時的「時間到」沒有用）
const TTL = 600
// 一天最多排幾次（整個伺服器；可以用 [vars] PUSH_DAILY 改）：有人拿亂編的網址一直排時的保護。
// 一串警語算一次（亂編的網址第一則就送不到，整串跟著清掉）；取消不算，隨時都收
export const PUSH_DAILY = 5000
// 警語一次最多交幾則、最晚排到多久以後（排到明天就寢，每 10 分鐘一則也夠）
export const MOTTO_MAX = 200
export const MOTTO_AFTER = 48 * 3600_000
// 推播服務回這幾個：訂閱失效了（解除安裝、關掉通知、換過金鑰），之後的也送不到，整台的都清掉
const GONE = [403, 404, 410]
// 警語的序號紀錄留多久：比上一次收到的舊、而且在這段時間裡到的請求不理（同時送出的兩個請求先後到的順序不一定）
const SEQ_KEEP = 60_000
const DAY = 86_400_000

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const enc = (s) => new TextEncoder().encode(s)

// 回傳整理過的網址：# 後面的不會送出去，留著的話同一個網址加上不同的 # 就能排好幾則
export function checkEndpoint(v) {
  let url = null
  try {
    url = typeof v === 'string' && v.length <= 2000 ? new URL(v) : null
  } catch {}
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || !HOSTS.some((re) => re.test(url.hostname))) {
    throw new HttpError(400, 'bad endpoint')
  }
  url.hash = ''
  return url.href
}

async function sha256(s) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const hub = (env, name) => {
  if (!env.PUSH) throw new HttpError(503, 'no push')
  return env.PUSH.get(env.PUSH.idFromName(name))
}
async function call(stub, path, body = {}) {
  const res = await stub.fetch(`https://push${path}`, { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new HttpError(502, 'push failed')
  return res.json()
}

// 這個 Worker 的 VAPID 公鑰：前端訂閱推播時要帶
export const pushKey = (env) => call(hub(env, 'vapid'), '/key')

const daily = async (env, now) => {
  const max = Number.isSafeInteger(Number(env.PUSH_DAILY)) && Number(env.PUSH_DAILY) > 0 ? Number(env.PUSH_DAILY) : PUSH_DAILY
  if ((await bump(env.DB, 'push:day', DAY, now)) > max) throw new HttpError(429, 'busy')
}

// 排一則（after：幾毫秒後）、或取消（after 是 null）。contact：推播服務要的聯絡網址（VAPID 的 sub），用這個 Worker 自己的網址
export async function pushTimer(env, body, now, contact) {
  const endpoint = checkEndpoint(body.endpoint)
  const { after = null } = body
  if (after !== null && !(Number.isSafeInteger(after) && after >= 1000 && after <= MAX_AFTER)) throw new HttpError(400, 'bad time')
  if (!env.PUSH) throw new HttpError(503, 'no push')
  if (after !== null) await daily(env, now)
  const [{ key }] = await Promise.all([
    pushKey(env),
    call(hub(env, await sha256(endpoint)), '/set', after === null ? {} : { endpoint, at: now + after, contact: env.PUSH_CONTACT || contact }),
  ])
  // 順便回公鑰：裝置上的訂閱如果是用別把金鑰建的（金鑰換過），前端會重新訂閱
  return { ok: true, key }
}

// 警語：交一串時間（after：每一則是幾毫秒後），換掉這台之前交的那一串；after 是 null 或空的是取消。
// seq：前端每次交的時候都比上一次大。同時送出的兩個請求（剛離開頁面又馬上回來）先後到的順序不一定，
// 舊的晚到就不理它（不然剛取消的又被排回去，或剛交的被晚到的取消清掉）
export async function pushMottos(env, body, now, contact) {
  const endpoint = checkEndpoint(body.endpoint)
  const { after = null, seq } = body
  const list = after === null ? [] : after
  if (!Array.isArray(list) || list.length > MOTTO_MAX || !list.every((a) => Number.isSafeInteger(a) && a >= 1000 && a <= MOTTO_AFTER)) throw new HttpError(400, 'bad time')
  if (!(Number.isSafeInteger(seq) && seq > 0)) throw new HttpError(400, 'bad seq')
  if (!env.PUSH) throw new HttpError(503, 'no push')
  if (list.length) await daily(env, now)
  const times = [...new Set(list.map((a) => now + a))].sort((a, b) => a - b)
  const [{ key }, r] = await Promise.all([
    pushKey(env),
    call(hub(env, await sha256(endpoint)), '/mottos', { endpoint, times, seq, contact: env.PUSH_CONTACT || contact }),
  ])
  // stale：這個請求比伺服器上已經收到的舊，沒有照它改
  return { ok: true, key, ...(r.stale ? { stale: true } : {}) }
}

// VAPID（RFC 8292）：用 ES256 簽一張短期的 JWT，推播服務拿公鑰驗「這則是訂閱時那個伺服器送的」
export async function vapidAuth(keys, aud, sub, now) {
  const head = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(enc(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 3600, sub })))
  const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(`${head}.${claims}`))
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.pub}`
}

const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

// 紀錄（npx wrangler@4 tail 看得到）：哪台裝置（物件 id 的前 8 碼）、推播服務的網域、時間差、推播服務回什麼。
// 不記網址後面那段：那是這台裝置的推播鑰匙
const log = (o) => console.log(JSON.stringify({ push: o.ev, ...o }))
const hostOf = (endpoint) => {
  try {
    return new URL(endpoint).host
  } catch {
    return '?'
  }
}

export class PushHub {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  // 紀錄上認裝置用：這個物件 id 的前 8 碼（物件的名字是推播網址的 SHA-256，看不出網址）
  _dev() {
    try {
      return String(this.state.id?.toString?.() ?? '?').slice(0, 8)
    } catch {
      return '?'
    }
  }

  // 金鑰只產生一次：同一個物件裡同時來好幾個請求也共用同一次
  _keys() {
    return (this.keys ||= (async () => {
      const storage = this.state.storage
      let k = await storage.get('vapid')
      if (!k) {
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        k = { jwk: await crypto.subtle.exportKey('jwk', pair.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)) }
        await storage.put('vapid', k)
      }
      return k
    })().catch((e) => {
      this.keys = null
      throw e
    }))
  }

  async fetch(req) {
    const { pathname } = new URL(req.url)
    const body = await req.json().catch(() => ({}))
    const storage = this.state.storage
    if (pathname === '/key') return reply({ key: (await this._keys()).pub })
    if (pathname === '/sign') return reply({ auth: await vapidAuth(await this._keys(), body.aud, body.sub, Date.now()) })
    if (pathname === '/set') {
      const old = await storage.get('timer')
      const now = Date.now()
      // 換掉的那一則還有多久到點（負的是已經過了還沒送出）
      const was = old ? old.at - now : null
      // 一台裝置同時只有一個計時器：新的蓋掉舊的，沒帶時間就是取消
      if (body.endpoint && body.at) {
        // id：這一次排的。到點送出時用它認「還是不是我這一則」，送到一半被換成新的就不會把新的清掉
        await storage.put('timer', { endpoint: body.endpoint, contact: body.contact, at: body.at, id: crypto.randomUUID() })
        log({ ev: 'set', dev: this._dev(), host: hostOf(body.endpoint), in: body.at - now, was })
      } else {
        await storage.delete('timer')
        log({ ev: 'cancel', dev: this._dev(), was })
      }
      await this._arm()
      return reply({ ok: true })
    }
    if (pathname === '/mottos') {
      const old = await storage.get('mottos')
      const now = Date.now()
      // 比上一次收到的舊：不理（一分鐘以前收到的就不比了，前端的紀錄被清掉、時鐘往回調過時才不會一直卡住）
      if (old && body.seq <= old.seq && now - old.got < SEQ_KEEP) return reply({ ok: true, stale: true })
      const times = Array.isArray(body.times) ? body.times : []
      // 取消也留著 seq（很小的一筆）：晚到的舊請求才認得出來
      await storage.put('mottos', { endpoint: body.endpoint, contact: body.contact, times, seq: body.seq, got: now, id: crypto.randomUUID() })
      log({ ev: times.length ? 'mottos' : 'mottos-cancel', dev: this._dev(), host: hostOf(body.endpoint), n: times.length, in: times.length ? times[0] - now : undefined })
      await this._arm()
      return reply({ ok: true })
    }
    return reply({ error: 'not found' }, 404)
  }

  // 鬧鐘排在計時器和警語裡最早到點的那一個；都沒有就取消。什麼都沒留（沒有計時器、也沒交過警語）就整個清空，不留空的物件。
  // 警語的那一串空了（取消、都送完了）：紀錄留到收到後 1 分鐘（認得出晚到的舊請求就夠了），到時候清掉
  async _arm() {
    const storage = this.state.storage
    const t = await storage.get('timer')
    const m = await storage.get('mottos')
    const next = Math.min(t ? t.at : Infinity, m ? (m.times?.length ? m.times[0] : m.got + SEQ_KEEP) : Infinity)
    if (next !== Infinity) return storage.setAlarm(next)
    await storage.deleteAlarm()
    if (!t && !m) await storage.deleteAll()
  }

  // 到點：送一則沒有內容的推播（計時器和警語剛好同時到點也只送一則：Service Worker 會把到點的都顯示出來）。
  // 簽名或推播服務暫時出狀況：丟出例外，Cloudflare 會過幾秒再叫一次 alarm（紀錄還留著）；
  // 超過 TTL 還沒送出去就放棄（晚到的「時間到」沒有用）
  async alarm() {
    const storage = this.state.storage
    const now = Date.now()
    const t = await storage.get('timer')
    const m = await storage.get('mottos')
    // 到點的：計時器、警語裡已經到的那幾則（鬧鐘可能早一點點響）
    const tDue = t && t.at <= now + 1000 ? t : null
    const due = m?.times ? m.times.filter((x) => x <= now + 1000) : []
    if (!tDue && !due.length) {
      // 空了的警語紀錄放滿 1 分鐘：清掉
      if (m && !m.times?.length && now - m.got >= SEQ_KEEP) await storage.delete('mottos')
      return this._arm()
    }
    // 送完、放棄時清掉到點的這幾則；中間被換成新的（id 不一樣）就不動它
    const finish = async () => {
      if (tDue && (await storage.get('timer'))?.id === t.id) await storage.delete('timer')
      const cur = await storage.get('mottos')
      if (due.length && cur?.id === m.id) await storage.put('mottos', { ...cur, times: cur.times.filter((x) => x > due[due.length - 1]) })
      await this._arm()
    }
    // 每一則各自看晚了多久：只有晚太久的那幾則就不送（不會因為剛到點的一句警語，把晚了很久的計時器也一起推過去）
    const late = (x) => now - x > TTL * 1000
    const fresh = [...(tDue && !late(tDue.at) ? [tDue.at] : []), ...due.filter((x) => !late(x))]
    const { endpoint, contact } = tDue || m
    const dev = this._dev()
    const host = hostOf(endpoint)
    const kind = tDue && due.length ? 'both' : tDue ? 'timer' : 'motto'
    if (!fresh.length) {
      log({ ev: 'expired', dev, host, kind, late: now - Math.max(tDue ? tDue.at : -Infinity, ...due) })
      return finish()
    }
    const at = Math.max(...fresh)
    const { auth } = await call(hub(this.env, 'vapid'), '/sign', { aud: new URL(endpoint).origin, sub: contact })
    let sent = false
    let gone = false
    for (let i = 0; i < 2 && !sent; i++) {
      try {
        // 不跟著轉址：只打檢查過的那個網址
        const res = await fetch(endpoint, { method: 'POST', redirect: 'manual', headers: { TTL: String(TTL), Urgency: 'high', Authorization: auth } })
        // 4xx：訂閱失效了（解除安裝、關掉通知）或這邊送錯了，再試也一樣
        sent = res.status < 500
        gone = GONE.includes(res.status)
        const why = res.ok ? undefined : (await res.text().catch(() => '')).slice(0, 160)
        log({ ev: 'send', dev, host, kind, late: Date.now() - at, status: res.status, why })
      } catch (e) {
        log({ ev: 'send-error', dev, host, kind, late: Date.now() - at, err: String(e).slice(0, 120) })
      }
    }
    if (!sent) throw new Error('push service unavailable')
    if (!gone) return finish()
    // 訂閱失效：接下來的警語、計時器也送不到了（亂編的網址第一則就會停在這裡）
    await storage.deleteAlarm()
    await storage.deleteAll()
  }
}
