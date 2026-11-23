import { esc, armConfirm } from './dom.js'
import { gcalText } from '../gcal.js'
import { native } from '../native.js'

// 設定裡「Google 日曆同步」那一列（src/gcal.js）：連接、現在的狀態（幾筆、多久前同步、出了什麼事）、馬上同步、中斷連線

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} 小時前` : `${Math.round(h / 24)} 天前`
}
// 出了這些事要重新連接（其他的等一下會自己再試）
const RECONNECT = new Set(['expired', 'scope', 'gone'])

export class GcalRow {
  constructor(row, store, gcal, { toast }) {
    this.row = row
    this.store = store
    this.gcal = gcal
    this.toast = toast
    row.innerHTML = `<div><b>Google 日曆同步<span class="sync-dot" id="gcalDot"></span></b><small id="gcalInfo"></small></div>
      <div class="sync-btns" id="gcalBtns"></div>
      <small class="ics-help">App 在你的 Google 日曆開一個「ひより日和」日曆，把日程、排了時段的任務、截止日寫進去；在 Google 上改這個日曆（時間、日子、名稱、刪掉、新增），App 也跟著改，可以撤銷。只能動這一個日曆，看不到你其他的日曆（那些用上面的「匯入行事曆」帶進來）。在 Google 新增的重複活動不會帶進 App。</small>`
    this.$ = (s) => row.querySelector(s)
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-gcal]')
      if (!b || b.disabled) return
      const act = b.dataset.gcal
      if (act === 'connect') this.connect(b)
      else if (act === 'sync') this.gcal.run()
      else if (act === 'off') armConfirm(b, '確定中斷？', () => this.disconnect())
    })
    gcal.subscribe(() => this.render())
    store.on('change', () => this.render())
    this.render()
  }
  async connect(b) {
    if (native) return this.toast({ icon: '暦', title: '這裡不能連接 Google', sub: gcalText('webview'), ms: 8000 })
    b.disabled = true
    try {
      // 成功的話整頁換到 Google 的授權畫面，回來後開機時接著做（main.js）
      await this.gcal.connect()
    } catch (e) {
      b.disabled = false
      this.toast({ icon: '暦', title: '沒辦法連接 Google 日曆', sub: gcalText(e?.code), ms: 7000 })
    }
  }
  async disconnect() {
    const { revoked } = await this.gcal.disconnect()
    this.toast({
      icon: '暦',
      title: '跟 Google 日曆中斷了',
      sub: revoked ? '每一台都不再同步。Google 上的「ひより日和」日曆還留著，不要的話到 Google 日曆刪掉' : '每一台都不再同步，但 Google 那邊的授權沒撤銷成功（連不上）：可以到 Google 帳戶的「第三方存取權」移除ひより日和',
      ms: 9000,
    })
  }
  render() {
    const s = this.gcal.status()
    let phase = s.phase
    // 開著、這台有授權，但還沒跑過（剛開、另一個分頁正在同步）
    if (s.on && s.mine && phase === 'off') phase = 'wait'
    if (s.on && !s.mine) phase = 'nokey'
    if (!s.on) phase = 'off'
    const key = JSON.stringify([phase, s.error, s.at && ago(s.at), s.count, s.done, s.total])
    if (key === this._key) return
    this._key = key
    const info =
      phase === 'off' ? '還沒連接'
      : phase === 'nokey' ? '別台已經連上了。這台還沒有授權：開著線上同步的話會自己帶過來，或在這台連接一次'
      : phase === 'syncing' ? (s.total ? `正在同步…（${s.done}／${s.total}）` : '正在同步…')
      : phase === 'wait' ? '已連上，等一下就同步'
      : phase === 'error' ? gcalText(s.error)
      : `已連上・${s.count} 筆・${s.at ? `${ago(s.at)}同步` : '還沒同步'}`
    this.$('#gcalInfo').textContent = info
    this.$('#gcalInfo').classList.toggle('warn', phase === 'error')
    const dot = this.$('#gcalDot')
    dot.dataset.state = phase === 'ready' ? 'linked' : phase === 'error' ? 'error' : phase === 'off' ? '' : 'needs-permission'
    const btn = (act, label, cls = '', dis = false) => `<button type="button" class="chip-toggle ${cls}" data-gcal="${act}" ${dis ? 'disabled' : ''}>${esc(label)}</button>`
    let html
    if (phase === 'off') html = btn('connect', '連接 Google 日曆', 'on')
    else if (phase === 'nokey') html = btn('connect', '在這台連接', 'on') + btn('off', '中斷連線', 'danger')
    else if (phase === 'error' && RECONNECT.has(s.error)) html = btn('connect', '重新連接', 'on') + btn('off', '中斷連線', 'danger')
    else html = btn('sync', phase === 'error' ? '再試一次' : '馬上同步', '', phase === 'syncing') + btn('off', '中斷連線', 'danger')
    // 「中斷連線」按了一下、正在等第二下：不重畫（同步的進度變了也不會把它換回原本的樣子）
    if (this.$('#gcalBtns [data-armed]')) return
    this.$('#gcalBtns').innerHTML = html
  }
}
