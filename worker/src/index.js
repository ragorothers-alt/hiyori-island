// ひより日和的線上同步後端：Cloudflare Worker + D1。
// 同步碼不會傳到這裡：前端用同步碼推導出 vault id（只拿來找資料）和加密金鑰（只留在裝置上），
// 上傳的是壓縮後加密的整份小島。資料庫只存 vault id 的 SHA-256、版本號和密文。
// 版本識別 rev 是前端每次修改都換一個的隨機字串（savedAt 只是那一版的修改時間，顯示用）。
// 上傳要帶 base（「我以為雲端現在是哪一版」，空的 vault 是 null），對不上代表別台剛寫過，
// 回 409 讓前端重新比對，不會蓋掉別台的變更。
// 寫入和刪除還要帶 auth（前端由同步碼另外推導，跟 vault id 互相推不出來）：只知道 id 的人不能寫。
// 舊版前端不帶 auth：vault 還沒記下 auth 時照舊讓它寫，記下之後就要對得上（見 migrations/0003）；
// 還沒記下的舊 vault 到 LEGACY_UNTIL 為止才收寫入，也不能只憑 id 刪除。
// /v1/ai：ふじ的 AI，經過這裡呼叫 Claude（見 ai.js；金鑰和通行碼都是 Worker 的 secret）。
// /v1/push/*：番茄鐘到點的推播（見 push.js；跟同步碼無關，沒開線上同步也能用）。
import { HttpError } from './http.js'
import { askAI, checkAI, aiGate, aiFailed, aiCount, AI_MAX } from './ai.js'
import { pushKey, pushTimer } from './push.js'

export { PushHub } from './push.js'

const ID = /^[0-9a-f]{64}$/
const AUTH = /^[0-9a-f]{64}$/
const REV = /^[\w-]{1,40}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
// base64 字元數；D1 每列上限 2 MB
export const MAX_DATA = 1_500_000
const DAY = 86_400_000
// 被大量亂建 vault 時的保護（可以用 [vars] 改）：一天最多建立幾個、整個資料庫最多放多少（base64 字元數）。
// 擋的是新建立，已經在用的 vault 照常同步
export const CREATE_DAILY = 300
export const MAX_TOTAL = 400_000_000
// 舊的 vault（加上 auth 以前建的）到這天以前，第一次帶 auth 寫入時記下那一把；之後還沒記的就不再收寫入
// （只知道 vault id 的人不能再趁還沒記下時搶先登記）。可以用 [vars] LEGACY_UNTIL（毫秒）改
export const LEGACY_UNTIL = Date.UTC(2027, 0, 1)
const cap = (v, d) => (Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : d)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const { pathname } = new URL(req.url)
    if (req.method === 'GET' && pathname === '/') return new Response('hiyori-sync ok', { headers: CORS })
    if (req.method !== 'POST') return json({ error: 'not found' }, 404)
    try {
      await limit(env, req, pathname)
      const ai = pathname === '/v1/ai'
      const now = Date.now()
      if (ai) {
        // 通行碼錯太多次時先整個停一陣子（擋猜通行碼）；通行碼不對就不讀內容
        const ip = req.headers.get('cf-connecting-ip')
        await aiGate(env, now, ip)
        try {
          await checkAI(env, req.headers.get('Authorization'))
        } catch (e) {
          if (e.status === 401) await aiFailed(env, now, ip)
          throw e
        }
      }
      // 推播的請求只有一個網址和一個數字
      const small = pathname.startsWith('/v1/push/')
      const text = await readBody(req, ai ? AI_MAX : small ? 4000 : MAX_DATA + 1000)
      let body
      try {
        body = JSON.parse(text || '{}')
      } catch {
        throw new HttpError(400, 'bad json')
      }
      if (!body || typeof body !== 'object') throw new HttpError(400, 'bad request')
      if (ai) {
        await aiCount(env, body, now)
        return json(await askAI(env, body))
      }
      if (pathname === '/v1/create') return json(await create(env, body, now))
      if (pathname === '/v1/pull') return json(await pull(env.DB, body))
      if (pathname === '/v1/push') return json(await push(env, body, now))
      if (pathname === '/v1/delete') return json(await remove(env.DB, body))
      if (pathname === '/v1/push/key') return json(await pushKey(env))
      if (pathname === '/v1/push/timer') return json(await pushTimer(env, body, now, new URL(req.url).origin))
      throw new HttpError(404, 'not found')
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status)
      // 沒料到的錯誤也回 JSON 和 CORS 標頭：不然瀏覽器只看到「連不上」，分不出是伺服器出錯
      console.error('[hiyori-sync]', e)
      return json({ error: 'server error' }, 500)
    }
  },
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// 讀請求內容，最多 max 個位元組：超過就停下來回 413，不會先把整份讀進記憶體
async function readBody(req, max) {
  if (Number(req.headers.get('Content-Length')) > max) throw new HttpError(413, 'too large')
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw new HttpError(413, 'too large')
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

// 每個 IP 每分鐘的請求上限（Cloudflare Rate Limiting binding；本機測試沒有就略過）
async function limit(env, req, pathname) {
  const limiter =
    pathname === '/v1/create' ? env.CREATE_LIMIT : pathname === '/v1/ai' ? env.AI_LIMIT : pathname.startsWith('/v1/push/') ? env.PUSH_LIMIT || env.SYNC_LIMIT : env.SYNC_LIMIT
  if (!limiter) return
  const { success } = await limiter.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' })
  if (!success) throw new HttpError(429, 'too many requests')
}

async function sha256(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function vaultHash(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new HttpError(400, 'bad id')
  return sha256(id)
}
// 寫入的驗證碼存成雜湊；沒帶（舊版前端）是 null
async function authHash(auth) {
  if (auth == null) return null
  if (typeof auth !== 'string' || !AUTH.test(auth)) throw new HttpError(400, 'bad auth')
  return sha256(auth)
}

const time = (v) => Number.isSafeInteger(v) && v >= 0

async function create(env, body, now) {
  const db = env.DB
  const hash = await vaultHash(body.id)
  const auth = await authHash(body.auth)
  // 建了一天以上卻一直沒放資料的 vault：裡面沒有東西，清掉
  await db.prepare('DELETE FROM vaults WHERE rev IS NULL AND created_at < ?1').bind(now - DAY).run()
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM vaults WHERE created_at > ?1').bind(now - DAY).first()
  if (recent.n >= cap(env.CREATE_DAILY, CREATE_DAILY)) throw new HttpError(429, 'busy')
  const total = await db.prepare('SELECT COALESCE(SUM(size), 0) AS s FROM vaults').first()
  if (total.s >= cap(env.MAX_TOTAL, MAX_TOTAL)) throw new HttpError(507, 'full')
  const r = await db
    .prepare('INSERT INTO vaults (hash, rev, saved_at, created_at, updated_at, auth) VALUES (?1, NULL, 0, ?2, ?2, ?3) ON CONFLICT (hash) DO NOTHING')
    .bind(hash, now, auth)
    .run()
  if (!r.meta.changes) throw new HttpError(409, 'exists')
  return { rev: null }
}

// have：前端手上的版本。雲端還是同一版就不回傳內容（定期的檢查只要幾十個位元組）
// peek：只確認這組同步碼存在（輸入同步碼時）
async function pull(db, body) {
  const hash = await vaultHash(body.id)
  const row = await db.prepare('SELECT rev, saved_at, data FROM vaults WHERE hash = ?1').bind(hash).first()
  if (!row) throw new HttpError(404, 'unknown vault')
  const rev = row.rev ?? null
  if (body.peek || !rev || rev === body.have) return { rev, savedAt: row.saved_at, same: true }
  return { rev, savedAt: row.saved_at, data: row.data }
}

async function push(env, body, now) {
  const db = env.DB
  const hash = await vaultHash(body.id)
  const { base = null, rev, savedAt, data } = body
  if ((base !== null && !REV.test(base)) || typeof rev !== 'string' || !REV.test(rev) || rev === base || !time(savedAt)) {
    throw new HttpError(400, 'bad version')
  }
  if (typeof data !== 'string' || !BASE64.test(data)) throw new HttpError(400, 'bad data')
  if (data.length > MAX_DATA) throw new HttpError(413, 'too large')
  const auth = await authHash(body.auth)
  // rev IS ?2：base 是 null 時也比得到（空的 vault）。auth：記下了就要對得上；
  // 還沒記（舊的 vault）時，期限前記下這一把，期限後就不再收。
  // 資料庫的總量上限也管寫入：變大的寫入超過上限就擋（變小、一樣大的照常寫，才清得出空間）。
  // 總量檢查放在同一句 UPDATE 裡：同時來好幾個寫入時，不會各自看到「還有空間」一起寫爆
  const legacy = now < cap(env.LEGACY_UNTIL, LEGACY_UNTIL) ? 1 : 0
  const limit = cap(env.MAX_TOTAL, MAX_TOTAL)
  const r = await db
    .prepare(
      `UPDATE vaults SET rev = ?3, saved_at = ?4, data = ?5, size = ?6, updated_at = ?7, auth = COALESCE(auth, ?8)
       WHERE hash = ?1 AND rev IS ?2 AND (auth = ?8 OR (auth IS NULL AND ?9 = 1))
         AND (?6 <= size OR (SELECT COALESCE(SUM(size), 0) FROM vaults) - size + ?6 <= ?10)`,
    )
    .bind(hash, base, rev, savedAt, data, data.length, now, auth, legacy, limit)
    .run()
  if (r.meta.changes) return { rev }
  const row = await db.prepare('SELECT rev, auth FROM vaults WHERE hash = ?1').bind(hash).first()
  if (!row) throw new HttpError(404, 'unknown vault')
  if (row.auth && row.auth !== auth) throw new HttpError(403, 'forbidden')
  if (!row.auth && !legacy) throw new HttpError(403, 'legacy')
  if ((row.rev ?? null) !== base) throw new HttpError(409, 'conflict', { rev: row.rev })
  // 版本和驗證碼都對，還是沒寫進去：是總量滿了
  throw new HttpError(507, 'full')
}

// 刪除一定要帶對的 auth。舊的 vault 還沒記下 auth：回 409 unclaimed（附上目前的版本），
// 前端先寫一次讓它記下這台的 auth 再刪；只知道 vault id 的人刪不掉
async function remove(db, body) {
  const hash = await vaultHash(body.id)
  const auth = await authHash(body.auth)
  const r = await db.prepare('DELETE FROM vaults WHERE hash = ?1 AND auth = ?2').bind(hash, auth).run()
  if (r.meta.changes) return { ok: true }
  const row = await db.prepare('SELECT rev, auth FROM vaults WHERE hash = ?1').bind(hash).first()
  // 本來就沒有這個 vault 也算刪好了
  if (!row) return { ok: true }
  if (!row.auth && auth) throw new HttpError(409, 'unclaimed', { rev: row.rev })
  throw new HttpError(403, 'forbidden')
}
