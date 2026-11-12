// 計時器的推播（/v1/push/*）：番茄鐘到點時，手機鎖著、App 被系統暫停也收得到通知。
// 前端只交兩樣東西：這台裝置的推播網址（endpoint，瀏覽器廠商的推播服務給的）和「幾毫秒後到點」。
// 推播不帶內容：不用加密，任務名稱也不會離開裝置；要顯示的字留在裝置上，Service Worker 收到推播時自己讀。
// PushHub（Durable Object）有兩種：
//   名字是 'vapid' 的那一個：保管這個 Worker 的 VAPID 金鑰（第一次用到時自己產生，不用另外設 secret），幫忙簽名
//   其他的：一台裝置一個（名字是 endpoint 的 SHA-256），記著 endpoint，用 alarm 到點送出；一台裝置同時只排一則
import { HttpError, bump } from './http.js'

// 只送到瀏覽器廠商的推播服務（Chrome／Edge／Firefox／Safari）：不然這裡會變成「幫人在指定時間打任意網址」
const HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/]
// 最久排到多久以後：正向計時最長 3 小時，留一點餘裕
export const MAX_AFTER = 6 * 3600_000
// 到點時裝置離線：這麼久以內連上線還是送到，再晚就不送了（過時的「時間到」沒有用）
const TTL = 600
// 一天最多排幾則（整個伺服器；可以用 [vars] PUSH_DAILY 改）：有人拿亂編的網址一直排時的保護。取消不算，隨時都收
export const PUSH_DAILY = 5000
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

// 排一則（after：幾毫秒後）、或取消（after 是 null）。contact：推播服務要的聯絡網址（VAPID 的 sub），用這個 Worker 自己的網址
export async function pushTimer(env, body, now, contact) {
  const endpoint = checkEndpoint(body.endpoint)
  const { after = null } = body
  if (after !== null && !(Number.isSafeInteger(after) && after >= 1000 && after <= MAX_AFTER)) throw new HttpError(400, 'bad time')
  if (!env.PUSH) throw new HttpError(503, 'no push')
  if (after !== null) {
    const max = Number.isSafeInteger(Number(env.PUSH_DAILY)) && Number(env.PUSH_DAILY) > 0 ? Number(env.PUSH_DAILY) : PUSH_DAILY
    if ((await bump(env.DB, 'push:day', DAY, now)) > max) throw new HttpError(429, 'busy')
  }
  const [{ key }] = await Promise.all([
    pushKey(env),
    call(hub(env, await sha256(endpoint)), '/set', after === null ? {} : { endpoint, at: now + after, contact: env.PUSH_CONTACT || contact }),
  ])
  // 順便回公鑰：裝置上的訂閱如果是用別把金鑰建的（金鑰換過），前端會重新訂閱
  return { ok: true, key }
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
      // 一台裝置同時只有一個計時器：新的蓋掉舊的，沒帶時間就是取消（整個清空，不留空的物件）
      if (body.endpoint && body.at) {
        // id：這一次排的。到點送出時用它認「還是不是我這一則」，送到一半被換成新的就不會把新的清掉
        await storage.put('timer', { endpoint: body.endpoint, contact: body.contact, at: body.at, id: crypto.randomUUID() })
        await storage.setAlarm(body.at)
        log({ ev: 'set', dev: this._dev(), host: hostOf(body.endpoint), in: body.at - now, was })
      } else {
        await storage.deleteAlarm()
        await storage.deleteAll()
        log({ ev: 'cancel', dev: this._dev(), was })
      }
      return reply({ ok: true })
    }
    return reply({ error: 'not found' }, 404)
  }

  // 到點：送一則沒有內容的推播。
  // 簽名或推播服務暫時出狀況：丟出例外，Cloudflare 會過幾秒再叫一次 alarm（紀錄還留著）；
  // 超過 TTL 還沒送出去就放棄（晚到的「時間到」沒有用）
  async alarm() {
    const storage = this.state.storage
    const t = await storage.get('timer')
    if (!t) return
    // 送完、放棄時清掉；中間被換成新的一則（id 不一樣）就不動它
    const finish = async () => {
      const cur = await storage.get('timer')
      if (cur?.id === t.id) await storage.deleteAll()
    }
    const dev = this._dev()
    const host = hostOf(t.endpoint)
    if (Date.now() - t.at > TTL * 1000) {
      log({ ev: 'expired', dev, host, late: Date.now() - t.at })
      return finish()
    }
    const { auth } = await call(hub(this.env, 'vapid'), '/sign', { aud: new URL(t.endpoint).origin, sub: t.contact })
    let sent = false
    for (let i = 0; i < 2 && !sent; i++) {
      try {
        // 不跟著轉址：只打檢查過的那個網址
        const res = await fetch(t.endpoint, { method: 'POST', redirect: 'manual', headers: { TTL: String(TTL), Urgency: 'high', Authorization: auth } })
        // 4xx：訂閱失效了（解除安裝、關掉通知）或這邊送錯了，再試也一樣
        sent = res.status < 500
        const why = res.ok ? undefined : (await res.text().catch(() => '')).slice(0, 160)
        log({ ev: 'send', dev, host, late: Date.now() - t.at, status: res.status, why })
      } catch (e) {
        log({ ev: 'send-error', dev, host, late: Date.now() - t.at, err: String(e).slice(0, 120) })
      }
    }
    if (!sent) throw new Error('push service unavailable')
    await finish()
  }
}
