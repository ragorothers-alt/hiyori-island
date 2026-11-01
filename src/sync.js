// 跨裝置同步的共用邏輯：每次使用者改了資料，小島就換一個版本識別（store.state.rev），
// 記住「上次同步時的版本」(base)。只有一邊改過 → 用改過的那邊；兩邊都改過 → 讓使用者選。
// 只比「是不是同一版」，不比時間大小：各台裝置的時鐘可能不準。被捨棄的那一份一律先備份，可以在設定裡還原。
// 兩種管道共用這套判斷，各自記自己的 base，可以同時開：
//   FileSync（這個檔案）：資料寫進使用者選的檔案，放在 OneDrive／Dropbox 的同步資料夾裡（不需後端，只有電腦版 Chrome／Edge）
//   CloudSync（cloud.js）：透過線上同步伺服器，手機也能用
import { dropBackup, keepBackup, newRev, readBackup } from './store.js'

// 被取代的那一份（只留最近一份）由 store.js 管：兩個分頁同時改了資料時也會用到
export { readBackup }
export function restoreBackup(store) {
  const b = readBackup()
  if (!b) return false
  store.replaceState(b.state) // 當成一次新的變更，會再同步出去
  dropBackup()
  return true
}
const NO_ROOM = '瀏覽器的儲存空間不夠，沒辦法先備份另一邊，所以先不替換。請先用「匯出資料」存一份'

// 子類別要實作：
//   _ready()                             有沒有連結（有檔案 handle、有同步碼）
//   _pull(have)                          讀雲端：null = 還沒有資料；{ rev, savedAt, same: true } = 跟 have 同一版；{ rev, savedAt, state }
//   _push(expect, { rev, savedAt }, json, opts)  寫雲端，雲端不是 expect 那一版時回傳 false（別台剛寫過）
//   _fail(e)                             讀寫失敗時要進哪個狀態
export class SyncEngine {
  constructor(store, { baseKey, remote, delay = 2500, poll = 60000, onStatus = () => {}, onPulled = () => {}, onConflict = () => {} }) {
    this.store = store
    this.baseKey = baseKey
    this.remote = remote // 備份裡標記「雲端那一份」用的名字
    this.onStatus = onStatus
    this.onPulled = onPulled
    this.onConflict = onConflict
    this.state = 'off'
    this.message = ''
    this.lastSync = 0
    this.conflict = null
    this.base = localStorage.getItem(baseKey) || ''
    // 連結世代：解除或換一個連結就加一，還在路上的舊請求回來後不再動狀態
    this.epoch = 0
    this._timer = 0
    this._busy = false
    this._again = false

    // 使用者改了資料 → 稍等一下再寫（連續操作只寫一次）
    store.on('dirty', () => {
      if (!this._canSync()) return
      clearTimeout(this._timer)
      this._timer = setTimeout(() => this.sync(), delay)
    })
    // 同一個瀏覽器的另一個分頁同步完會改 base：跟著更新。不然換成那個分頁的資料後，
    // 這邊會以為兩邊都改過，下次雲端有新資料時就變成要選邊
    addEventListener('storage', (e) => {
      if (e.key === baseKey) this.base = localStorage.getItem(baseKey) || ''
    })
    // 回到這個視窗、或開著時定期看一次：別台裝置可能剛寫過
    addEventListener('focus', () => this.sync())
    document.addEventListener('visibilitychange', () => !document.hidden && this.sync())
    setInterval(() => !document.hidden && this.sync(), poll)
  }

  get backup() {
    return readBackup()
  }
  // 這台改過、還沒同步出去
  get dirty() {
    return (this.store.state.rev || '') !== this.base
  }

  _set(state, message = '') {
    this.state = state
    this.message = message
    this.onStatus(this)
  }
  _setBase(rev) {
    this.base = rev || ''
    try {
      if (rev) localStorage.setItem(this.baseKey, rev)
      else localStorage.removeItem(this.baseKey)
    } catch {}
  }
  _relink() {
    clearTimeout(this._timer)
    this.epoch++
    this.conflict = null
    this._setBase('')
  }
  _canSync() {
    return ['linked', 'error', 'offline'].includes(this.state) && this._ready()
  }

  // ── 同步：一次只跑一個，跑的途中又被要求就再跑一輪（回傳的 Promise 等到那一輪也跑完） ──
  sync() {
    return this._run(() => this._syncOnce())
  }
  _run(step) {
    if (!this._canSync()) return Promise.resolve()
    if (this._busy) {
      this._again = true
      return this._running
    }
    this._running = this._loop(step)
    return this._running
  }
  async _loop(step) {
    this._busy = true
    try {
      // 最多連跑幾輪：別台一直在寫的話，下次再來
      for (let n = 0; n < 5; n++) {
        this._again = false
        await step()
        if (!this._again || !this._canSync()) break
        step = () => this._syncOnce()
      }
    } finally {
      this._busy = false
    }
  }

  async _syncOnce() {
    const epoch = this.epoch
    let remote
    try {
      remote = await this._pull(this.base)
    } catch (e) {
      if (epoch === this.epoch) this._fail(e)
      return
    }
    if (epoch !== this.epoch) return
    const local = this.store.state.rev || ''
    if (!remote) return this._write('') // 雲端還沒有資料（剛建立）
    if (remote.rev === this.base) return local !== this.base ? this._write(this.base) : this._ok()
    if (local === remote.rev) {
      // 同一個版本（例如解除後重新連結）
      this._setBase(local)
      return this._ok()
    }
    if (local === this.base) return this._load(remote)
    // 兩邊都有新變更：不自動決定，交給使用者
    // first：剛連結（還沒同步過），兩邊各有一份小島
    const st = this.store.state
    this.conflict = { remoteAt: remote.savedAt, localAt: st.updatedAt, rev: remote.rev, savedAt: remote.savedAt, state: remote.state, first: !this.base }
    this._set('conflict')
    this.onConflict(this.conflict)
  }

  // keep：'remote'（用雲端的）或 'local'（用這台的）。被捨棄的那一份一定要先備份成功
  resolve(keep) {
    const c = this.conflict
    if (!c) return
    this.conflict = null
    this._set('linked')
    if (keep !== 'local') return this._run(() => this._load(c, { strict: true }))
    return this._run(() => {
      if (!keepBackup(c.state, this.remote, c.savedAt)) return this._set('error', NO_ROOM)
      return this._write(c.rev)
    })
  }

  async _write(expect, opts = {}) {
    const epoch = this.epoch
    const st = this.store.state
    if (!st.rev) {
      // 全新的小島也給一個版本，之後才比得出有沒有改過
      st.rev = newRev()
      st.updatedAt ||= Date.now()
    }
    const version = { rev: st.rev, savedAt: st.updatedAt }
    // 先在這裡轉成文字：寫出去的途中使用者又改了資料，也不會跟 version 對不上
    const json = JSON.stringify(st)
    let ok
    try {
      ok = await this._push(expect, version, json, opts)
    } catch (e) {
      if (epoch === this.epoch) this._fail(e)
      return
    }
    if (epoch !== this.epoch) return
    if (!ok) {
      // 別台剛寫過：再跑一輪，重新比對
      this._again = true
      return
    }
    this.store.saveNow()
    this._setBase(version.rev)
    this._ok()
  }

  _load(remote, { strict = false } = {}) {
    const st = this.store.state
    // 一般拉取時這台沒改過（雲端已經有比較新的那一版），備份只是保險；選邊時一定要備份成功
    if (st.rev && !keepBackup(st, 'local', st.updatedAt) && strict) return this._set('error', NO_ROOM)
    try {
      this.store.replaceState(remote.state, remote.savedAt, { soft: true, rev: remote.rev })
    } catch (e) {
      return this._fail(e)
    }
    this._setBase(remote.rev)
    this._ok()
    this.onPulled(remote.savedAt)
  }

  _ok() {
    this.lastSync = Date.now()
    this._set('linked')
  }

  restoreBackup() {
    const done = restoreBackup(this.store)
    if (done) this.onStatus(this)
    return done
  }
}

// ── 雲端資料夾同步：把資料自動寫進使用者選的檔案 ──
const DB = 'hiyori-sync'
const PICK = { types: [{ description: 'ひより同步檔', accept: { 'application/json': ['.json'] } }] }

export const syncSupported = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'indexedDB' in window

// 用 IndexedDB 記住檔案 handle（handle 可以被結構化複製，localStorage 存不了）
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('kv')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode)
      const req = fn(tx.objectStore('kv'))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
    }
  })
}
const saveHandle = (h) => idb('readwrite', (s) => (h ? s.put(h, 'handle') : s.delete('handle'))).catch(() => {})
const loadHandle = () => idb('readonly', (s) => s.get('handle')).catch(() => null)

export class FileSync extends SyncEngine {
  constructor(store, opts = {}) {
    super(store, { ...opts, baseKey: 'hiyori-sync-base', remote: 'file' })
    this.handle = null
    this.state = syncSupported() ? 'off' : 'unsupported' // off | linked | needs-permission | conflict | error | unsupported
  }

  get fileName() {
    return this.handle?.name || ''
  }

  _ready() {
    return !!this.handle
  }
  _fail(e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return this._set('needs-permission')
    if (e?.name === 'NotFoundError') return this._set('error', '找不到同步檔，可能被移動或刪除了')
    this._set('error', e?.message || String(e))
  }

  async init() {
    if (!syncSupported()) return this._set('unsupported')
    const h = await loadHandle()
    if (!h) return this._set('off')
    this.handle = h
    const perm = await h.queryPermission?.({ mode: 'readwrite' }).catch(() => 'prompt')
    if (perm !== 'granted') return this._set('needs-permission')
    this._set('linked')
    await this.sync()
  }

  // ── 連結（都必須由使用者點擊觸發） ──
  async create() {
    const h = await window.showSaveFilePicker({ suggestedName: 'hiyori-sync.json', ...PICK })
    await this._link(h)
  }
  async choose() {
    const [h] = await window.showOpenFilePicker(PICK)
    await this._link(h)
  }
  async _link(h) {
    if (this.handle && (await this.handle.isSameEntry?.(h).catch(() => false))) return this.sync()
    this._relink()
    this.handle = h
    await saveHandle(h)
    this._set('linked')
    await this.sync()
  }
  async resume() {
    if (!this.handle) return
    const perm = await this.handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')
    if (perm !== 'granted') return this._set('needs-permission')
    this._set('linked')
    await this.sync()
  }
  async unlink() {
    this._relink()
    this.handle = null
    await saveHandle(null)
    this._set('off')
  }
  // 舊的按鈕代號：'file' = 用雲端的
  resolve(keep) {
    return super.resolve(keep === 'file' ? 'remote' : keep)
  }

  async _pull() {
    const file = await this.handle.getFile()
    const text = await file.text()
    if (!text.trim()) return null
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('同步檔不是 JSON 格式')
    }
    if (data?.app !== 'hiyori' || !data.state || !Number.isFinite(data.savedAt)) throw new Error('這不是ひより的同步檔')
    // 舊版同步檔沒有 rev：用 savedAt 當版本識別（跟舊存檔的 rev 對得起來）
    return { rev: typeof data.rev === 'string' && data.rev ? data.rev : String(data.savedAt), savedAt: data.savedAt, state: data.state }
  }

  // 檔案沒辦法「對得上才寫」：寫之前再讀一次，確認還是 expect 那一版（例如衝突等待期間別台又寫過）
  async _push(expect, { rev, savedAt }, json) {
    const cur = await this._pull()
    if ((cur?.rev || '') !== expect) return false
    const text = `{"app":"hiyori","version":2,"rev":${JSON.stringify(rev)},"savedAt":${savedAt},"state":${json}}`
    const w = await this.handle.createWritable()
    await w.write(text)
    await w.close()
    return true
  }
}
