// 線上同步：手機和電腦輸入同一組同步碼，透過雲端（worker/）互通。
// 端對端加密：同步碼只留在裝置上，用 HKDF 推導出 vault id（給伺服器找資料用）和 AES-GCM 金鑰；
// 上傳的是壓縮後加密的整份小島，伺服器看不到內容。判斷新舊和衝突的邏輯跟資料夾同步共用（sync.js）。
import { SyncEngine } from './sync.js'

// 部署好的 Worker；開發時可用 VITE_SYNC_API 指到本機的 wrangler dev
export const SYNC_API = import.meta.env?.VITE_SYNC_API || 'https://hiyori-sync.ragorothers.workers.dev'
const CODE_KEY = 'hiyori-cloud-code'
// 同步碼字元：Crockford Base32（去掉 I、L、O、U），16 碼 = 80 bits
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
// keepalive 請求的內容上限是 64 KB，超過就用一般請求
const KEEPALIVE_MAX = 60000

const enc = (s) => new TextEncoder().encode(s)
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // 256 是 32 的倍數，取餘數不會偏向某些字元
  return [...bytes].map((b) => ALPHABET[b % 32]).join('').match(/.{4}/g).join('-')
}

// 「ab12 cd34…」→「AB12-CD34-…」；不是 16 碼回傳 null。O/I/L 容易跟 0/1 看錯，一律當成數字
export function normalizeCode(text) {
  const s = String(text ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(s) ? s.match(/.{4}/g).join('-') : null
}

// 分享連結：同步碼放在 # 後面，不會送到網站伺服器
export const shareLink = (code, base = location.href) => `${base.split('#')[0]}#sync=${code}`
export function codeFromHash(hash = location.hash) {
  const m = /[#&]sync=([^&]+)/.exec(hash)
  try {
    return m ? normalizeCode(decodeURIComponent(m[1])) : null
  } catch {
    return null // 網址被截斷、% 編碼壞掉
  }
}

// 需要壓縮串流（Safari 16.4 起）和加密功能（只在 HTTPS 或 localhost 提供）
export const cloudSupported = () =>
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && !!globalThis.crypto?.subtle

// ── 加密 ──
export async function deriveKeys(code) {
  const ikm = await crypto.subtle.importKey('raw', enc(code.replace(/-/g, '')), 'HKDF', false, ['deriveBits', 'deriveKey'])
  const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc('hiyori-sync-v1'), info: enc(info) })
  const id = hex(await crypto.subtle.deriveBits(params('vault-id'), ikm, 256))
  const key = await crypto.subtle.deriveKey(params('vault-key'), ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return { id, key }
}

const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer())

function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

// 格式：1 byte（格式版本，目前是 1 = gzip）+ IV 12 bytes + AES-GCM 密文
export async function seal(key, text) {
  const body = await pipe(enc(text), new CompressionStream('gzip'))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body))
  const out = new Uint8Array(13 + ct.length)
  out[0] = 1
  out.set(iv, 1)
  out.set(ct, 13)
  return toBase64(out)
}

export async function unseal(key, data) {
  let body
  try {
    const raw = fromBase64(data)
    if (raw[0] !== 1) throw new Error('format')
    body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(1, 13) }, key, raw.subarray(13)))
    body = await pipe(body, new DecompressionStream('gzip'))
  } catch {
    throw new Error('雲端的資料解不開，可能不是這組同步碼的')
  }
  return new TextDecoder().decode(body)
}

// ── 伺服器 ──
export class CloudError extends Error {
  // status：HTTP 狀態碼；0 = 連不上
  constructor(status, message, body = {}) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function call(path, payload, { keepalive = false } = {}) {
  const body = JSON.stringify(payload)
  let res
  try {
    // text/plain 是「簡單請求」，瀏覽器不用先送一次 OPTIONS 預檢
    res = await fetch(SYNC_API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
      keepalive: keepalive && body.length < KEEPALIVE_MAX,
    })
  } catch {
    throw new CloudError(0, '連不上同步伺服器')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new CloudError(res.status, data.error || `HTTP ${res.status}`, data)
  return data
}

export class CloudSync extends SyncEngine {
  // state：off | linked | offline | conflict | error | unsupported
  constructor(store, opts = {}) {
    super(store, { delay: 1500, poll: 30000, ...opts, baseKey: 'hiyori-cloud-base', remote: 'cloud' })
    this.code = null
    this.keys = null
    if (!cloudSupported()) this.state = 'unsupported'
    addEventListener('online', () => this.sync())
    // 切到背景時先把還沒送出的變更送出去：手機切走 App 後，頁面可能等不到延遲寫入就被凍結
    document.addEventListener('visibilitychange', () => document.hidden && this.flush())
  }

  _ready() {
    return !!this.keys
  }
  _fail(e) {
    if (e?.status === 0) return this._set('offline')
    if (e?.status === 404) return this._set('error', '雲端找不到這組同步碼，可能已經被刪除了')
    if (e?.status === 429) return this._set('error', '同步太頻繁，等一下再試')
    if (e?.status === 413) return this._set('error', '資料太大，超過同步的上限')
    this._set('error', e?.message || String(e))
  }

  async init() {
    if (!cloudSupported()) return this._set('unsupported')
    let code = null
    try {
      code = normalizeCode(localStorage.getItem(CODE_KEY))
    } catch {}
    if (!code) return this._set('off')
    await this._use(code)
    this._set('linked')
    await this.sync()
  }
  async _use(code) {
    this.keys = await deriveKeys(code)
    this.code = code
  }
  _remember(code) {
    try {
      localStorage.setItem(CODE_KEY, code)
    } catch {}
  }

  // 這台開一組新的同步碼，把目前的小島放上去
  async start() {
    const code = newCode()
    const { id } = await deriveKeys(code)
    await call('/v1/create', { id })
    await this._link(code)
    return code
  }
  // 輸入別台的同步碼：先確認雲端有這組，再開始同步（這台已經有資料的話會問要留哪一邊）
  async join(text) {
    const code = normalizeCode(text)
    if (!code) throw new Error('同步碼是 16 個英文字母和數字')
    if (code === this.code && this._canSync()) return this.sync()
    const { id } = await deriveKeys(code)
    try {
      await call('/v1/pull', { id, peek: true })
    } catch (e) {
      if (e.status === 404) throw new Error('找不到這組同步碼，請確認有沒有打錯')
      throw e
    }
    await this._link(code)
  }
  async _link(code) {
    const keys = await deriveKeys(code)
    this._relink()
    this.keys = keys
    this.code = code
    this._remember(code)
    this._set('linked')
    await this.sync()
  }
  // 停止同步：這台忘記同步碼，雲端的資料不動（其他裝置照常同步）
  stop() {
    this._relink()
    this.code = null
    this.keys = null
    try {
      localStorage.removeItem(CODE_KEY)
    } catch {}
    this._set('off')
  }
  // 刪除雲端的資料，這台也停止同步（其他裝置下次同步會看到「找不到這組同步碼」）
  async destroy() {
    if (!this.keys) return
    await call('/v1/delete', { id: this.keys.id })
    this.stop()
  }

  // 切到背景：有還沒送出的變更就直接送，不先拉（帶著 base，別台改過的話伺服器會拒絕，回來時再比對）
  flush() {
    if (this._busy || !this._canSync() || !this.store.state.rev || !this.dirty) return
    clearTimeout(this._timer)
    this._run(() => this._write(this.base, { keepalive: true }))
  }

  // 請求一開始就固定這次用的 id 和金鑰：途中換了同步碼，也不會用 A 的金鑰加密、送進 B
  async _pull(have) {
    const { id, key } = this.keys
    const r = await call('/v1/pull', { id, have: have || null })
    if (!r.rev) return null // 剛建立，還沒有資料
    if (r.same) return { rev: r.rev, savedAt: r.savedAt, same: true }
    let data
    try {
      data = JSON.parse(await unseal(key, r.data))
    } catch (e) {
      throw new Error(e instanceof SyntaxError ? '雲端的資料格式不對' : e.message)
    }
    if (data?.app !== 'hiyori' || !data.state) throw new Error('雲端的資料格式不對')
    return { rev: r.rev, savedAt: r.savedAt, state: data.state }
  }

  async _push(expect, { rev, savedAt }, json, { keepalive } = {}) {
    const { id, key } = this.keys
    const data = await seal(key, `{"app":"hiyori","version":1,"state":${json}}`)
    try {
      await call('/v1/push', { id, base: expect || null, rev, savedAt, data }, { keepalive })
    } catch (e) {
      if (e.status === 409) return false
      throw e
    }
    return true
  }
}
