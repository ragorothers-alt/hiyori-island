// 跨裝置同步的共用邏輯：每次使用者改了資料，小島就換一個版本識別（store.state.rev），
// 記住「上次同步時的版本」(base)。只有一邊改過 → 用改過的那邊；兩邊都改過 → 讓使用者選。
// 只比「是不是同一版」，不比時間大小：各台裝置的時鐘可能不準。被捨棄的那一份一律先備份，可以在設定裡還原。
// 兩種管道共用這套判斷，各自記自己的 base，可以同時開：
//   FileSync（這個檔案）：資料寫進使用者選的檔案，放在 OneDrive／Dropbox 的同步資料夾裡（不需後端，只有電腦版 Chrome／Edge）
//   CloudSync（cloud.js）：透過線上同步伺服器，手機也能用
import { dropBackup, keepBackup, newRev, readBackup, readBackups, newerData, NEWER_MSG, NEWER_TAB_MSG, NO_SAVE_MSG } from './store.js'
import { migrate } from './store/migrate.js'
import { merge3 } from './merge.js'

// 被取代的資料（留最近幾份）由 store.js 管：兩個分頁同時改了資料時也會用到
export { readBackup, readBackups }
// 還原第 i 份備份：當成一次新的變更（會再同步出去）。還原前的小島也留一份，還原錯了可以再換回來。
// 備份讀不進來（壞掉、或是新版 App 存的）、另一個分頁已經是新版、存不進去時丟出錯誤，現在的小島和備份都不動
export function restoreBackup(store, i = 0) {
  const b = readBackup(i)
  if (!b) return false
  if (store.newerApp) throw new Error(NEWER_TAB_MSG)
  const cur = store.state
  if (!store.replaceOrUndo(b.state)) throw new Error(NO_SAVE_MSG)
  dropBackup(i)
  keepBackup(cur, 'restore', cur.updatedAt)
  return true
}
const NO_ROOM = '瀏覽器的儲存空間不夠，沒辦法先備份另一邊，所以先不替換。請先用「匯出資料」存一份'
const NO_SAVE = '瀏覽器的儲存空間不夠，這台的存檔寫不進去。請先用「匯出資料」存一份，再清出一些空間'
const LOAD_FAILED = '這台的存檔讀不進來，雲端也拿不到資料：先不把範例島傳上去，等連上雲端再拿回來'
// 兩份小島只差在計時（跨裝置的計時，見 main.js 的 shareTimer）和版本：兩邊都先照讀檔的規則整理過再比（欄位順序、預設值一樣）；
// 比不出來就當成不一樣，照樣備份
const onlyTimer = (a, b) => {
  const strip = (s) => JSON.stringify({ ...migrate(s), timer: null, rev: '', updatedAt: 0, lineage: [] })
  try {
    return strip(a) === strip(b)
  } catch {
    return false
  }
}
// 上次兩邊同步好的那一份（自動合併的 base）：整份存在 IndexedDB（可能很大，不擠 localStorage 的空間），記著是哪一版。
// 讀到的不是現在的 base 那一版（寫到一半、別的分頁換過、被清掉）就不合併，照舊讓使用者選邊
export const baseStates = {
  read: (key) => idb('readonly', (s) => s.get(`base:${key}`)).catch(() => null),
  write: (key, rev, json) => idb('readwrite', (s) => (rev ? s.put({ rev, json }, `base:${key}`) : s.delete(`base:${key}`))).catch(() => {}),
}
// 這一版包含了之前的哪幾版（store 的 lineage）
const lineageOf = (s) => (Array.isArray(s?.lineage) ? s.lineage : [])
// 有 id 的東西有幾筆（合起來的那一份讀存檔時有沒有被拿掉幾筆）
function countIds(v) {
  let n = 0
  const walk = (x) => {
    if (Array.isArray(x)) for (const y of x) walk(y)
    else if (x && typeof x === 'object') {
      if (typeof x.id === 'string' && x.id) n++
      for (const k in x) if (x[k] && typeof x[k] === 'object') walk(x[k])
    }
  }
  walk(v)
  return n
}
const readKey = (k) => {
  try {
    return localStorage.getItem(k) || ''
  } catch {
    return ''
  }
}

// 子類別要實作：
//   _ready()                             有沒有連結（有檔案 handle、有同步碼）
//   _pull(have)                          讀雲端：null = 還沒有資料；{ rev, savedAt, same: true } = 跟 have 同一版；{ rev, savedAt, state }
//   _push(expect, { rev, savedAt }, json, opts)  寫雲端，雲端不是 expect 那一版時回傳 false（別台剛寫過）
//   _fail(e)                             讀寫失敗時要進哪個狀態
// onMerged({ clashes, rev })：兩邊都改過、自動合在一起了（clashes：兩邊改了同一個地方、用了比較晚改的那一邊的位置；
// rev：合併前這台那一版，留成了備份，換得回去，見 undoMerge）
export class SyncEngine {
  constructor(store, { baseKey, remote, delay = 2500, poll = 60000, onStatus = () => {}, onPulled = () => {}, onConflict = () => {}, onMerged = () => {}, bases = baseStates, autoMerge = true, locks = globalThis.navigator?.locks }) {
    this.store = store
    this.baseKey = baseKey
    this.remote = remote // 備份裡標記「雲端那一份」用的名字
    this.onStatus = onStatus
    this.onPulled = onPulled
    this.onConflict = onConflict
    this.onMerged = onMerged
    this.bases = bases
    this.autoMerge = autoMerge
    // 跨分頁的鎖（Web Locks）：同一個瀏覽器同一時間只有一個分頁在同步
    this.locks = locks
    this.state = 'off'
    this.message = ''
    this.lastSync = 0
    this.conflict = null
    // 封鎖了網站資料的瀏覽器，讀 localStorage 會丟例外：當成還沒同步過，不要讓整個開機停下來
    this.base = readKey(baseKey)
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
      if (e.key === baseKey) this.base = readKey(baseKey)
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
  // json：那一版的內容（之後兩邊都改過時拿來合併）；沒給就只換版本，存著的那一份不動（版本對不上就不會被拿來用）
  _setBase(rev, json = '') {
    this.base = rev || ''
    try {
      if (rev) localStorage.setItem(this.baseKey, rev)
      else localStorage.removeItem(this.baseKey)
    } catch {}
    // 這個分頁剛寫的那一份也記在記憶體裡（IndexedDB 還沒寫完、寫不進去時也拿得到）
    if (!rev) {
      this._snap = null
      this.bases.write(this.baseKey, '', '')
    } else if (json) {
      this._snap = { rev, json }
      this.bases.write(this.baseKey, rev, json)
    }
  }
  // 還沒存過 base 那一份（這個功能上線前就同步好了）：這台現在就是 base 那一版，存一份
  async _seedBase() {
    const rev = this.base
    if (!rev || this._seeded === rev || (this.store.state.rev || '') !== rev) return
    this._seeded = rev
    const have = await this.bases.read(this.baseKey)
    if (have?.rev === rev || this.base !== rev || (this.store.state.rev || '') !== rev) return
    this.bases.write(this.baseKey, rev, JSON.stringify(this.store.state))
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
    this._running = this.locks?.request ? this.locks.request(`hiyori-sync:${this.baseKey}`, () => this._loop(step)) : this._loop(step)
    return this._running
  }
  async _loop(step) {
    this._busy = true
    // 這一輪（連跑的那幾次）第一次合併時這台原本的那一份：提示卡上換回去的就是它，之後再合不另外留備份
    this._runMerge = null
    try {
      // 另一個分頁剛同步、存過（storage 事件還在路上）：先換成那一版、照它記的 base
      if (this.store.catchUp?.()) this.base = readKey(this.baseKey) || this.base
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
    // 這台的存檔讀不進來（換成了範例島）或被清掉了：等一下要整份拿雲端的回來，
    // 不能帶著 base 去問——雲端沒變的話只會回「同一版」，沒有資料可以復原
    const restore = !!this.base && (!this.store.state.rev || !!this.store.loadFailed)
    try {
      remote = await this._pull(restore ? null : this.base)
    } catch (e) {
      if (epoch === this.epoch) this._fail(e)
      return
    }
    if (epoch !== this.epoch) return
    // 這台或雲端的資料是新版 App 存的：這一版看不懂新的欄位，不拉也不推，等使用者更新
    if (this.store.newerApp || newerData(remote?.state)) return this._set('error', NEWER_MSG)
    // 存檔很大時會等停手才寫：比對版本前先寫好，base 才推得動
    this.store.flushSave()
    const local = this.store.state.rev || ''
    if (!remote) return this._write('') // 雲端還沒有資料（剛建立）
    // 上次推上去、沒收到回應的那一版其實到了（雲端就是它，或雲端那一版包含它）：從那一版開始算，不然會拿更舊的那一份合併、重複算
    const sent = this._sent
    if (sent && sent.rev !== this.base && (remote.rev === sent.rev || lineageOf(remote.state).includes(sent.rev))) this._setBase(sent.rev, sent.json)
    this._sent = null
    // 同步過的裝置，這台卻沒有自己的小島可推：沒有版本（被清掉了），或存檔讀不進來換成了範例島
    // （之後就算在範例島上加了東西也一樣）。一律拿雲端的回來，這台後來加的留成備份；
    // 不會把範例島蓋到雲端、再傳到每一台。範例島上已經加了東西的話，那份一定要先備份成功才換
    if (this.base && (!local || this.store.loadFailed)) return this._load(remote, { strict: true })
    if (remote.rev === this.base) {
      if (local !== this.base) return this._write(this.base)
      this._seedBase()
      return this._ok()
    }
    // 同一個版本（例如解除後重新連結）
    if (local === remote.rev) return this._synced(local, JSON.stringify(this.store.state))
    if (local === this.base) return this._load(remote)
    // 雲端那一版已經包含這台的這一版（這台推上去之後別台接著改了）：直接拿雲端的
    if (local && lineageOf(remote.state).includes(local)) return this._load(remote, { ahead: true })
    // 這台的這一版已經包含雲端那一版（另一條同步管道、另一個分頁先合過了）：直接推
    if (lineageOf(this.store.state).includes(remote.rev)) return this._write(remote.rev)
    // 兩邊都有新變更：有上次同步好的那一份就自動合在一起（見 merge.js）
    if (this.autoMerge && this.base && (await this._merge(remote, epoch))) return
    if (epoch !== this.epoch) return
    // 合不了（剛連結還沒同步過、其中一邊整份換過、上次那一份沒存到）：交給使用者
    // first：剛連結（還沒同步過），兩邊各有一份小島
    const st = this.store.state
    this.conflict = { remoteAt: remote.savedAt, localAt: st.updatedAt, rev: remote.rev, savedAt: remote.savedAt, state: remote.state, first: !this.base }
    this._set('conflict')
    this.onConflict(this.conflict)
  }

  // 自動合併：base（上次同步好的那一份）、這台、雲端三份照 merge.js 合成一份，當成這台改的一版推上去。
  // 合併前這台的那一份留成備份（設定裡、合併的提示卡上換得回去）。回傳有沒有處理掉（false：照舊讓使用者選邊）
  async _merge(remote, epoch) {
    const snap = this._snap?.rev === this.base ? this._snap : await this.bases.read(this.baseKey)
    if (epoch !== this.epoch) return true
    if (!snap || snap.rev !== this.base || typeof snap.json !== 'string') return false
    const st = this.store.state
    // 等著讀的時候這台換成了別的一版（另一個分頁同步了、使用者匯入了）：照新的再比一次
    if ((st.rev || '') === this.base || st.rev === remote.rev) {
      this._again = true
      return true
    }
    // 這台的這一版還沒存進去（空間滿了）：先不合（合好的也存不進去）
    if (!this.store.saved) {
      this._set('error', NO_SAVE)
      return true
    }
    let out = null
    let theirs = ''
    try {
      theirs = JSON.stringify(remote.state)
      out = merge3(JSON.parse(snap.json), st, remote.state)
      // 合起來超過上限（兩台各寫了專案的第 100 則筆記）、讀存檔時會被拿掉的：不自動合，讓使用者選邊（不會悄悄少一筆）
      if (out && countIds(migrate(JSON.parse(JSON.stringify(out.state)))) < countIds(out.state)) out = null
    } catch (e) {
      console.warn('[hiyori] 自動合併失敗', e)
      out = null
    }
    if (!out) return false
    // 這一輪第一次合併：合併前這台的那一份留成備份（存不進去就不合）
    const first = !this._runMerge
    if (first && !keepBackup(st, 'merge', st.updatedAt)) {
      this._set('error', NO_ROOM)
      return true
    }
    if (first) this._runMerge = { rev: st.rev }
    // 存合好的那一份時，剛留的備份不能被擠掉（擠不下就是存不進去，換回原本那一份）
    this.store.keepBackups = 1
    try {
      this.store.replaceState(out.state, Math.max(Date.now(), (st.updatedAt || 0) + 1, (remote.savedAt || 0) + 1), { soft: true })
    } catch (e) {
      console.warn('[hiyori] 合併出來的資料讀不進去', e)
      this.store.keepBackups = 0
      if (first) {
        dropBackup(0)
        this._runMerge = null
      }
      return false
    } finally {
      this.store.keepBackups = 0
    }
    if (!this.store.saved) {
      // 存不進去：記憶體裡換回原本那一份（存檔裡也還是它），base 不動——下次再合也不會把雲端那一版算兩次
      try {
        this.store.replaceState(st, st.updatedAt, { soft: true, rev: st.rev, peer: true })
      } catch {}
      this._set('error', NO_SAVE)
      return true
    }
    // 合好的這一份已經包含雲端那一版：之後再跟雲端比，從那一版開始算（推上去之前又被別台寫過，再合一次也不會把那一版的數字加兩次）
    this._setBase(remote.rev, theirs)
    // 合起來才湊齊的（兩台各勾了最後幾個里程碑）補算落成
    this.store.settleMerged?.()
    this.onMerged({ clashes: out.clashes, rev: this._runMerge.rev })
    await this._write(remote.rev)
    return true
  }
  // 換回合併前這台的那一份（rev：onMerged 給的）：當成一次新的變更，會再同步出去。合併好的那一份也留成備份
  undoMerge(rev) {
    const i = readBackups().findIndex((b) => b.from === 'merge' && b.state?.rev === rev)
    if (i < 0) return false
    const done = restoreBackup(this.store, i)
    if (done) this.onStatus(this)
    return done
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

  // 這台的小島現在不能拿去蓋別台：看不懂的新版資料、或存檔讀不進來換成的範例島（已經同步過的話）。
  // 一般同步、切到背景直接送（flush）、雲端沒有資料、衝突選「用這台的」都經過 _write，在這裡一起擋
  _pushBlocked() {
    if (this.store.newerApp) return NEWER_MSG
    if (this.store.loadFailed && this.base) return LOAD_FAILED
    return ''
  }

  async _write(expect, opts = {}) {
    const blocked = this._pushBlocked()
    if (blocked) return this._set('error', blocked)
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
    this._sent = { rev: version.rev, json }
    try {
      ok = await this._push(expect, version, json, opts)
    } catch (e) {
      // 送出去了但沒收到回應（斷線）：雲端可能已經是這一版了，_sent 留著，下次同步時對
      if (epoch === this.epoch) this._fail(e)
      return
    }
    this._sent = null
    if (epoch !== this.epoch) return
    if (!ok) {
      // 別台剛寫過：再跑一輪，重新比對
      this._again = true
      return
    }
    this.store.saveNow()
    this._synced(version.rev, json)
  }

  // ahead：雲端那一版已經包含這台的這一版，這台的不用另外留備份
  _load(remote, { strict = false, ahead = false } = {}) {
    const st = this.store.state
    // 一般拉取時這台沒改過（雲端已經有比較新的那一版），備份只是保險；選邊時一定要備份成功。
    // 雲端那一版只換了計時（別台按了開始、暫停）：這台的這一份跟它只差在計時，不另外留（不然幾次就把真正有用的備份擠掉）
    if (st.rev && !ahead && (strict || !onlyTimer(st, remote.state)) && !keepBackup(st, 'local', st.updatedAt) && strict) return this._set('error', NO_ROOM)
    try {
      this.store.replaceState(remote.state, remote.savedAt, { soft: true, rev: remote.rev })
    } catch (e) {
      return this._fail(e)
    }
    let json = ''
    try {
      json = JSON.stringify(remote.state)
    } catch {}
    if (this._synced(remote.rev, json)) this.onPulled(remote.savedAt)
  }

  // 同步好了：這台的存檔也寫進去了，才把 base 記成這一版。存不進去（瀏覽器空間滿了）時 base 不動——
  // 不然重新整理後讀到的是還沒更新的舊存檔，會被當成「這台改過」推上去，蓋掉雲端比較新的資料
  _synced(rev, json = '') {
    if (!this.store.saved) {
      this._set('error', NO_SAVE)
      return false
    }
    this._setBase(rev, json)
    this._ok()
    return true
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

  // 檔案沒辦法「對得上才寫」：寫之前再讀一次，確認還是 expect 那一版（例如衝突等待期間別台又寫過）。
  // 讀和寫之間仍有一小段空隙：兩台電腦剛好在同一秒寫，雲端資料夾會自己留一份「衝突副本」，不會兩份都不見。
  // 檔案是一般的 JSON（沒有加密）：設定頁在連結前會說清楚，要放在只有自己看得到的資料夾
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
