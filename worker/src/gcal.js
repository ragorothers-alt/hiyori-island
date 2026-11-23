// Google 日曆同步的授權（/v1/gcal/*）。同步本身是 App 直接跟 Google Calendar API 做的（日程內容不經過這裡），
// 這裡只做需要 client secret 的那幾步：拿用戶端 ID、用授權碼換 token、用 refresh token 換 access token、撤銷授權。
// 不存任何 token、不記錄內容。用戶端 ID 和密鑰是 Worker 的設定（見 wrangler.toml 的說明）：
//   GOOGLE_CLIENT_ID（[vars] 或 secret）、GOOGLE_CLIENT_SECRET（secret）
// 權限只要 calendar.app.created：只能建立、管理 App 自己開的那個日曆，看不到使用者其他的日曆。
import { HttpError } from './http.js'

export const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const GCAL_TIMEOUT = 10_000

const text = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)
// 授權後回到的網址：只收 https，或本機開發用的 http://localhost、127.0.0.1（Google 也只認登記過的）；不帶參數、#
export function redirectOk(v) {
  const s = text(v, 300)
  if (!s) return false
  try {
    const u = new URL(s)
    if (u.hash || u.search || u.username || u.password) return false
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))
  } catch {
    return false
  }
}

function conf(env) {
  const id = typeof env.GOOGLE_CLIENT_ID === 'string' ? env.GOOGLE_CLIENT_ID.trim() : ''
  const secret = typeof env.GOOGLE_CLIENT_SECRET === 'string' ? env.GOOGLE_CLIENT_SECRET.trim() : ''
  if (!id || !secret) throw new HttpError(503, 'gcal off')
  return { id, secret }
}

// 前端組授權網址要用的用戶端 ID（公開的，不是祕密）和權限
export function gcalConfig(env) {
  const { id } = conf(env)
  return { ok: true, clientId: id, scope: GCAL_SCOPE }
}

async function google(fetcher, url, form) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), GCAL_TIMEOUT)
  try {
    let res
    try {
      res = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(form).toString(),
        signal: ctrl.signal,
      })
    } catch {
      throw new HttpError(502, 'google unreachable')
    }
    let body = null
    try {
      body = await res.json()
    } catch {}
    return { res, body: body && typeof body === 'object' ? body : {} }
  } finally {
    clearTimeout(timer)
  }
}

// Google 回的 token 錯誤：invalid_grant＝授權碼用過、過期，或 refresh token 被撤銷、過期（測試中的專案 7 天就過期）
function tokenError(res, body) {
  if (body.error === 'invalid_grant') return new HttpError(401, 'gcal expired')
  if (body.error === 'invalid_client' || body.error === 'unauthorized_client') return new HttpError(503, 'gcal client')
  if (res.status === 429) return new HttpError(429, 'too many requests')
  return new HttpError(502, 'gcal failed', { status: res.status })
}

const expiresIn = (v) => (Number.isFinite(+v) && +v > 0 ? Math.min(+v, 86400) : 3600)

// 授權碼 → refresh token 和 access token（PKCE：verifier 是前端自己產生的，Google 會對它跟授權時的 challenge）
export async function gcalToken(env, body, fetcher = fetch) {
  const { id, secret } = conf(env)
  const code = text(body?.code, 2000)
  const verifier = text(body?.verifier, 200)
  if (!code || !verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !redirectOk(body?.redirect)) throw new HttpError(400, 'bad request')
  const { res, body: r } = await google(fetcher, TOKEN_URL, {
    code, code_verifier: verifier, redirect_uri: body.redirect, client_id: id, client_secret: secret, grant_type: 'authorization_code',
  })
  if (!res.ok) throw tokenError(res, r)
  if (typeof r.access_token !== 'string' || !r.access_token) throw new HttpError(502, 'gcal failed', { status: res.status })
  // 授權畫面上可以只勾一部分：沒給管理日曆的權限就不算連上
  const scopes = typeof r.scope === 'string' ? r.scope.split(/\s+/) : []
  if (!scopes.includes(GCAL_SCOPE)) throw new HttpError(403, 'gcal scope')
  if (typeof r.refresh_token !== 'string' || !r.refresh_token) throw new HttpError(502, 'gcal no refresh')
  return { ok: true, access: r.access_token, expires: expiresIn(r.expires_in), refresh: r.refresh_token }
}

// refresh token → 新的 access token（大約一小時有效）
export async function gcalRefresh(env, body, fetcher = fetch) {
  const { id, secret } = conf(env)
  const refresh = text(body?.refresh, 2000)
  if (!refresh) throw new HttpError(400, 'bad request')
  const { res, body: r } = await google(fetcher, TOKEN_URL, { refresh_token: refresh, client_id: id, client_secret: secret, grant_type: 'refresh_token' })
  if (!res.ok) throw tokenError(res, r)
  if (typeof r.access_token !== 'string' || !r.access_token) throw new HttpError(502, 'gcal failed', { status: res.status })
  return { ok: true, access: r.access_token, expires: expiresIn(r.expires_in) }
}

// 中斷連線：請 Google 撤銷這把 refresh token（已經失效的也算撤銷好了）
export async function gcalRevoke(env, body, fetcher = fetch) {
  conf(env)
  const token = text(body?.token, 2000)
  if (!token) throw new HttpError(400, 'bad request')
  const { res } = await google(fetcher, REVOKE_URL, { token })
  if (!res.ok && res.status !== 400) throw new HttpError(502, 'gcal failed', { status: res.status })
  return { ok: true }
}
