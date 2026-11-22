// 給獎勵的帳（state.grants）：每一次給獎勵（完成任務、里程碑、習慣當天的獎勵、本命全清、一輪專注、每天第一次打開…）
// 用一個「同一件事在每台都一樣」的代號，記下這一次實際加了哪些數字。
//   兩台都做了同一件事（兩台都勾了同一件任務、同一輪計時兩台都記了），或同步時拿了太舊的那一份當基準：
//   合在一起時照這本帳扣回一份（merge.js 的 dedupeGrants）——不用再從結果去猜哪些是重複的。
//   收回一筆（提早結束的那幾分鐘按了「不算這段」）也照這本帳扣回去（revokeGrant）。
// 一筆：{ at: 記下的時間, day: 那一天（「那天的紀錄」上的數字記在這一天）, d: { 數字的代號: 加了多少（減少是負的） } }
// 數字的代號：
//   xp 經驗值、c 金平糖、ch お守り、b 好感、s:鍵 統計（player.stats）、d:鍵 那天的紀錄（history[day]）、x:花 圖鑑的朵數、
//   ts:任務 id 實際做了幾分鐘、tp:任務 id 番茄的顆數、pf:專案 id 那天的專注分鐘
// 只留最近 GRANT_DAYS 天、最多 GRANT_MAX 筆（同步的那一份不會一直長大）
import { isObj, DATE_RE, ID_RE } from './migrate.js'

export const GRANT_DAYS = 10
export const GRANT_MAX = 400
const KEY_RE = /^[\w:@!.-]{1,80}$/
const CODE_RE = /^(xp|c|ch|b|[sdx]:[\w-]{1,40}|(ts|tp|pf):[\w-]{1,40})$/

const byId = (list, id) => (Array.isArray(list) ? list.find((x) => x?.id === id) : null)
// 代號 → 存著那個數字的物件和鍵（create：那天的紀錄、專案那天的專注還沒有的話建起來）
function ref(state, code, day, create = false) {
  const p = state?.player
  if (code === 'xp' || code === 'c' || code === 'ch') return isObj(p) ? { o: p, k: { xp: 'xp', c: 'coins', ch: 'charms' }[code] } : null
  if (code === 'b') return isObj(p?.bond) ? { o: p.bond, k: 'pts' } : null
  const i = code.indexOf(':')
  const kind = code.slice(0, i)
  const key = code.slice(i + 1)
  if (kind === 's') return isObj(p?.stats) ? { o: p.stats, k: key } : null
  if (kind === 'd') {
    if (!isObj(state.history) || !DATE_RE.test(day)) return null
    if (!isObj(state.history[day])) {
      if (!create) return null
      state.history[day] = {}
    }
    return { o: state.history[day], k: key }
  }
  if (kind === 'x') return isObj(state.dex?.[key]) ? { o: state.dex[key], k: 'n' } : null
  if (kind === 'ts' || kind === 'tp') {
    const t = byId(state.tasks, key)
    return t ? { o: t, k: kind === 'ts' ? 'spent' : 'pomos' } : null
  }
  if (kind === 'pf') {
    const pr = byId(state.projects, key)
    if (!pr || !DATE_RE.test(day)) return null
    if (!isObj(pr.focus)) {
      if (!create) return null
      pr.focus = {}
    }
    return { o: pr.focus, k: day }
  }
  return null
}
export const readCode = (state, code, day) => {
  const r = ref(state, code, day)
  const v = r ? r.o[r.k] : 0
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
// 照代號加減（不會減到負的；減到 0 的那天的專注拿掉）
export function addCode(state, code, day, delta) {
  if (!delta) return
  const r = ref(state, code, day, delta > 0)
  if (!r) return
  const v = typeof r.o[r.k] === 'number' ? r.o[r.k] : 0
  r.o[r.k] = Math.max(0, v + delta)
  if (code.startsWith('pf:') && !r.o[r.k]) delete r.o[r.k]
}
// 代號在存檔裡的位置（merge.js 照它找這個數字合併時是「兩邊加的都算」還是取比較大的）
export function codePath(code, day) {
  if (code === 'xp') return ['player', 'xp']
  if (code === 'c') return ['player', 'coins']
  if (code === 'ch') return ['player', 'charms']
  if (code === 'b') return ['player', 'bond', 'pts']
  const i = code.indexOf(':')
  const kind = code.slice(0, i)
  const key = code.slice(i + 1)
  if (kind === 's') return ['player', 'stats', key]
  if (kind === 'd') return ['history', day, key]
  if (kind === 'x') return ['dex', key, 'n']
  if (kind === 'ts') return ['tasks', '[]', 'spent']
  if (kind === 'tp') return ['tasks', '[]', 'pomos']
  if (kind === 'pf') return ['projects', '[]', 'focus', day]
  return []
}

// 讀存檔時清理：格式不對的拿掉，只留最近 GRANT_DAYS 天、最多 GRANT_MAX 筆
export function cleanGrants(v, now = Date.now()) {
  if (!isObj(v)) return {}
  const list = []
  const keep = (k, g) => list.push({ k, g })
  for (const [k, g] of Object.entries(v)) {
    if (!KEY_RE.test(k) || !isObj(g) || !isObj(g.d) || !Number.isFinite(g.at) || !DATE_RE.test(g.day)) continue
    if (now - g.at > GRANT_DAYS * 86400000) continue
    const d = {}
    for (const [c, n] of Object.entries(g.d)) if (CODE_RE.test(c) && typeof n === 'number' && Number.isFinite(n) && n) d[c] = Math.max(-1e7, Math.min(1e7, n))
    if (Object.keys(d).length) keep(k, { at: g.at, day: g.day, d })
  }
  list.sort((a, b) => a.g.at - b.g.at)
  return Object.fromEntries(list.slice(-GRANT_MAX).map((x) => [x.k, x.g]))
}

export const grantMethods = {
  // 給獎勵的那一段（fn）包起來：前後比一次那些數字，差多少記在 key 這一筆。
  // 包在裡面的另一段（完成任務時順便本命全清）各自記各自的，外面這一筆不重複算它。
  // day：「那天的紀錄」看哪一天（預設今天）；extra：這次還會動到的其他數字（任務的實際分鐘、專案那天的專注）
  _grant(key, fn, { day = null, extra = [] } = {}) {
    if (!key || !KEY_RE.test(key)) return fn()
    const d0 = DATE_RE.test(day) ? day : this.today
    const before = this._counters(d0, extra)
    const frame = { inner: new Map() }
    const stack = (this._grantStack ||= [])
    stack.push(frame)
    try {
      return fn()
    } finally {
      stack.pop()
      const after = this._counters(d0, extra)
      const all = new Map()
      for (const k of new Set([...before.keys(), ...after.keys()])) {
        const v = (after.get(k) || 0) - (before.get(k) || 0)
        if (v) all.set(k, v)
      }
      const own = {}
      for (const [k, v] of all) {
        const n = v - (frame.inner.get(k) || 0)
        if (n) own[k] = n
      }
      if (Object.keys(own).length) this._keepGrant(key, d0, own)
      const parent = stack.at(-1)
      if (parent) for (const [k, v] of all) parent.inner.set(k, (parent.inner.get(k) || 0) + v)
    }
  },
  _counters(day, extra = []) {
    const s = this.state
    const p = s.player
    const m = new Map()
    const put = (k, v) => typeof v === 'number' && Number.isFinite(v) && m.set(k, v)
    put('xp', p.xp)
    put('c', p.coins)
    put('ch', p.charms)
    put('b', p.bond?.pts)
    for (const [k, v] of Object.entries(p.stats || {})) put(`s:${k}`, v)
    for (const [k, v] of Object.entries(s.history[day] || {})) put(`d:${k}`, v)
    for (const [k, e] of Object.entries(s.dex || {})) put(`x:${k}`, e?.n)
    for (const c of extra) if (CODE_RE.test(c)) m.set(c, readCode(s, c, day))
    return m
  },
  _keepGrant(key, day, d) {
    const all = (this.state.grants ||= {})
    const old = all[key]
    // 同一筆又給了一次（同一天的同一件事）：加在一起
    if (old && old.day === day) {
      const sum = { ...old.d }
      for (const [k, v] of Object.entries(d)) sum[k] = (sum[k] || 0) + v
      all[key] = { at: Date.now(), day, d: sum }
    } else all[key] = { at: Date.now(), day, d }
    if (Object.keys(all).length > GRANT_MAX + 40) this.state.grants = cleanGrants(all)
  },
  // 收回 key 那一筆：照帳上記的扣回去（不會扣到負的），帳上拿掉（不能收回兩次）。回傳有沒有收回
  revokeGrant(key) {
    const g = this.state.grants?.[key]
    if (!g) return false
    for (const [code, v] of Object.entries(g.d)) addCode(this.state, code, g.day, -v)
    const rest = { ...this.state.grants }
    delete rest[key]
    this.state.grants = rest
    this._finish()
    return true
  },
}

// 代號裡的 id、日子：只收存檔裡的格式（ID_RE、DATE_RE），組不出來就不記帳
export const grantKey = (...parts) => (parts.every((x) => x != null && (ID_RE.test(String(x)) || DATE_RE.test(String(x)) || /^[\w@!-]{1,40}$/.test(String(x)))) ? parts.join(':') : null)
