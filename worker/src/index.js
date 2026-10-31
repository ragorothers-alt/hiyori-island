// ひより日和的線上同步後端：Cloudflare Worker + D1。
// 同步碼不會傳到這裡：前端用同步碼推導出 vault id（只拿來找資料）和加密金鑰（只留在裝置上），
// 上傳的是壓縮後加密的整份小島。資料庫只存 vault id 的 SHA-256、版本號和密文。
// 版本識別 rev 是前端每次修改都換一個的隨機字串（savedAt 只是那一版的修改時間，顯示用）。
// 上傳要帶 base（「我以為雲端現在是哪一版」，空的 vault 是 null），對不上代表別台剛寫過，
// 回 409 讓前端重新比對，不會蓋掉別台的變更。

const ID = /^[0-9a-f]{64}$/
const REV = /^[\w-]{1,40}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
// base64 字元數；D1 每列上限 2 MB
export const MAX_DATA = 1_500_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const { pathname } = new URL(req.url)
    if (req.method === 'GET' && pathname === '/') return new Response('hiyori-sync ok', { headers: CORS })
    if (req.method !== 'POST') return json({ error: 'not found' }, 404)
    try {
      await limit(env, req, pathname)
      const text = await req.text()
      if (text.length > MAX_DATA + 1000) throw new HttpError(413, 'too large')
      let body
      try {
        body = JSON.parse(text || '{}')
      } catch {
        throw new HttpError(400, 'bad json')
      }
      if (!body || typeof body !== 'object') throw new HttpError(400, 'bad request')
      const now = Date.now()
      if (pathname === '/v1/create') return json(await create(env.DB, body, now))
      if (pathname === '/v1/pull') return json(await pull(env.DB, body))
      if (pathname === '/v1/push') return json(await push(env.DB, body, now))
      if (pathname === '/v1/delete') return json(await remove(env.DB, body))
      throw new HttpError(404, 'not found')
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status)
      throw e
    }
  },
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// 每個 IP 每分鐘的請求上限（Cloudflare Rate Limiting binding；本機測試沒有就略過）
async function limit(env, req, pathname) {
  const limiter = pathname === '/v1/create' ? env.CREATE_LIMIT : env.SYNC_LIMIT
  if (!limiter) return
  const { success } = await limiter.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' })
  if (!success) throw new HttpError(429, 'too many requests')
}

async function vaultHash(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new HttpError(400, 'bad id')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const time = (v) => Number.isSafeInteger(v) && v >= 0

async function create(db, body, now) {
  const hash = await vaultHash(body.id)
  const r = await db
    .prepare('INSERT INTO vaults (hash, rev, saved_at, created_at, updated_at) VALUES (?1, NULL, 0, ?2, ?2) ON CONFLICT (hash) DO NOTHING')
    .bind(hash, now)
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

async function push(db, body, now) {
  const hash = await vaultHash(body.id)
  const { base = null, rev, savedAt, data } = body
  if ((base !== null && !REV.test(base)) || typeof rev !== 'string' || !REV.test(rev) || rev === base || !time(savedAt)) {
    throw new HttpError(400, 'bad version')
  }
  if (typeof data !== 'string' || !BASE64.test(data)) throw new HttpError(400, 'bad data')
  if (data.length > MAX_DATA) throw new HttpError(413, 'too large')
  // rev IS ?2：base 是 null 時也比得到（空的 vault）
  const r = await db
    .prepare('UPDATE vaults SET rev = ?3, saved_at = ?4, data = ?5, size = ?6, updated_at = ?7 WHERE hash = ?1 AND rev IS ?2')
    .bind(hash, base, rev, savedAt, data, data.length, now)
    .run()
  if (r.meta.changes) return { rev }
  const row = await db.prepare('SELECT rev FROM vaults WHERE hash = ?1').bind(hash).first()
  if (!row) throw new HttpError(404, 'unknown vault')
  throw new HttpError(409, 'conflict', { rev: row.rev })
}

async function remove(db, body) {
  const hash = await vaultHash(body.id)
  await db.prepare('DELETE FROM vaults WHERE hash = ?1').bind(hash).run()
  return { ok: true }
}
