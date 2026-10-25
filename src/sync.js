// 跨裝置同步（不需後端）：把資料自動寫進使用者選的檔案。
// 放在 OneDrive／Dropbox／Google 雲端硬碟的同步資料夾裡，多台電腦連結同一個檔案就能互通。
// 判斷方式：記住「上次同步時的版本」(base)。只有一邊改過 → 用改過的那邊；兩邊都改過 → 讓使用者選。
// 被捨棄的那一份一律先備份，可以在設定裡還原。
const DB = 'hiyori-sync'
const BASE_KEY = 'hiyori-sync-base'
const BACKUP_KEY = 'hiyori-backup'
const PICK = { types: [{ description: 'ひより同步檔', accept: { 'application/json': ['.json'] } }] }

export const syncSupported = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'indexedDB' in window

// ── 用 IndexedDB 記住檔案 handle（handle 可以被結構化複製，localStorage 存不了） ──
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

function readBackup() {
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null')
    return b?.state ? b : null
  } catch {
    return null
  }
}

export class FileSync {
  constructor(store, { onStatus = () => {}, onPulled = () => {}, onConflict = () => {} } = {}) {
    this.store = store
    this.onStatus = onStatus
    this.onPulled = onPulled
    this.onConflict = onConflict
    this.handle = null
    this.state = syncSupported() ? 'off' : 'unsupported' // off | linked | needs-permission | conflict | error | unsupported
    this.message = ''
    this.lastSync = 0
    this.conflict = null
    this.base = Number(localStorage.getItem(BASE_KEY)) || 0
    this._timer = 0
    this._busy = false
    this._again = false

    // 使用者改了資料 → 稍等一下再寫（連續操作只寫一次）
    store.on('dirty', () => {
      clearTimeout(this._timer)
      this._timer = setTimeout(() => this.sync(), 2500)
    })
    // 回到這個視窗、或開著時每分鐘看一次：別台裝置可能剛寫過
    addEventListener('focus', () => this.sync())
    document.addEventListener('visibilitychange', () => !document.hidden && this.sync())
    setInterval(() => !document.hidden && this.sync(), 60000)
  }

  get fileName() {
    return this.handle?.name || ''
  }
  get backup() {
    return readBackup()
  }

  _set(state, message = '') {
    this.state = state
    this.message = message
    this.onStatus(this)
  }
  _setBase(at) {
    this.base = at
    try {
      if (at) localStorage.setItem(BASE_KEY, String(at))
      else localStorage.removeItem(BASE_KEY)
    } catch {}
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
    this.handle = h
    this._setBase(0)
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
    clearTimeout(this._timer)
    this.handle = null
    this.conflict = null
    this._setBase(0)
    await saveHandle(null)
    this._set('off')
  }

  // ── 同步：一次只跑一個，跑的途中又被要求就再跑一輪 ──
  async sync() {
    if (!this.handle || !['linked', 'error'].includes(this.state)) return
    if (this._busy) {
      this._again = true
      return
    }
    this._busy = true
    try {
      do {
        this._again = false
        await this._syncOnce()
      } while (this._again && this.state === 'linked')
    } finally {
      this._busy = false
    }
  }

  async _syncOnce() {
    let data
    try {
      data = await this._read()
    } catch (e) {
      return this._fail(e)
    }
    const local = this.store.state.updatedAt || 0
    if (!data) return this._write() // 空檔案（剛建立）
    const fileChanged = data.savedAt !== this.base
    const localChanged = local > this.base
    if (!fileChanged) return localChanged ? this._write() : this._ok()
    if (local === data.savedAt) {
      // 同一個版本（例如解除後重新連結）
      this._setBase(local)
      return this._ok()
    }
    if (!localChanged) return this._load(data)
    // 兩邊都有新變更：不自動決定，交給使用者
    this.conflict = { fileAt: data.savedAt, localAt: local, data }
    this._set('conflict')
    this.onConflict(this.conflict)
  }

  async resolve(keep) {
    const c = this.conflict
    if (!c) return
    this.conflict = null
    this._set('linked')
    if (keep === 'file') await this._load(c.data)
    else {
      this._keepBackup(c.data.state, 'file', c.data.savedAt)
      await this._write()
    }
  }

  async _read() {
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
    return data
  }

  async _write() {
    const st = this.store.state
    if (!st.updatedAt) st.updatedAt = Date.now() // 全新的小島也給一個版本，之後才比得出新舊
    try {
      const w = await this.handle.createWritable()
      await w.write(JSON.stringify({ app: 'hiyori', version: 1, savedAt: st.updatedAt, state: st }))
      await w.close()
    } catch (e) {
      return this._fail(e)
    }
    this.store.saveNow()
    this._setBase(st.updatedAt)
    this._ok()
  }

  _load(data) {
    if (this.store.state.updatedAt) this._keepBackup(this.store.state, 'local', this.store.state.updatedAt)
    try {
      this.store.replaceState(data.state, data.savedAt)
    } catch (e) {
      return this._fail(e)
    }
    this._setBase(data.savedAt)
    this._ok()
    this.onPulled(data.savedAt)
  }

  _ok() {
    this.lastSync = Date.now()
    this._set('linked')
  }

  // 被捨棄的那一份留一個備份（只留最近一份）
  _keepBackup(state, from, at) {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify({ from, at, savedAt: Date.now(), state }))
    } catch {}
  }
  restoreBackup() {
    const b = readBackup()
    if (!b) return false
    this.store.replaceState(b.state, Date.now()) // 當成一次新的變更，會再同步出去
    localStorage.removeItem(BACKUP_KEY)
    this.onStatus(this)
    return true
  }
}
