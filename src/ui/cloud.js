import './cloud.css'
import { esc, armConfirm } from './dom.js'
import { shareLink } from '../cloud.js'

// 設定裡「線上同步」那一列：開始同步、輸入同步碼、顯示同步碼（QR code 與分享連結）、衝突時選邊。
// 輸入框只在切換模式時重建，同步狀態變了只更新文字和按鈕，打字打到一半不會被打斷。

const hhmm = (t) => new Date(t).toTimeString().slice(0, 5)
const when = (t) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()} ${hhmm(t)}`

// QR code：uqr 只負責編碼，畫成一條 SVG path（只在顯示同步碼時才載入）
async function qrSvg(text) {
  const { encode } = await import('uqr')
  const { data, size } = encode(text, { ecc: 'M', border: 2 })
  let d = ''
  data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)))
  return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-label="同步連結的 QR code"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#2c3646"/></svg>`
}

export class CloudView {
  constructor(row, sync, { toast }) {
    this.row = row
    this.sync = sync
    this.toast = toast
    this.mode = '' // '' | 'join' | 'code'
    this.draft = ''
    this.busy = false
    this._panel = null
    row.innerHTML = `<div><b>線上同步<span class="sync-dot"></span></b><small class="cloud-info"></small></div><div class="cloud-panel"></div><div class="sync-btns cloud-btns"></div>`
    this.$ = (s) => row.querySelector(s)
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cloud]')
      if (b && !b.disabled) this._act(b.dataset.cloud, b)
    })
    row.addEventListener('input', (e) => {
      if (e.target.matches('.cloud-input')) this.draft = e.target.value
    })
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.cloud-input')) this._act('join')
    })
    this.render()
  }

  // 從分享連結打開：先填好同步碼，等使用者按「連線」
  offer(code) {
    if (code === this.sync.code && this.sync.state !== 'off') {
      this.toast({ icon: '雲', title: '這台已經連上這組同步碼了' })
      return
    }
    this.mode = 'join'
    this.draft = code
    this.render()
    this.row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async _act(act, btn) {
    const sy = this.sync
    if (act === 'stop') return armConfirm(btn, '再按一次停止', () => (sy.stop(), (this.mode = ''), this.render()))
    if (act === 'delete') return armConfirm(btn, '再按一次刪除', () => this._run(async () => {
      await sy.destroy()
      this.mode = ''
      this.toast({ icon: '雲', title: '已刪除雲端的資料', sub: '這台的資料還在，其他裝置會停止同步' })
    }))
    if (act === 'join-open') return this._mode('join')
    if (act === 'cancel') return this._mode('')
    if (act === 'code') return this._mode(this.mode === 'code' ? '' : 'code')
    if (act === 'copy-code' || act === 'copy-link') {
      const text = act === 'copy-code' ? sy.code : shareLink(sy.code)
      try {
        await navigator.clipboard.writeText(text)
        this.toast({ icon: '雲', title: act === 'copy-code' ? '已複製同步碼' : '已複製同步連結', sub: '傳給自己，在另一台裝置打開' })
      } catch {
        this.toast({ icon: '！', title: '沒辦法複製', sub: '請手動抄下同步碼' })
      }
      return
    }
    if (act === 'remote' || act === 'local') return this._run(() => sy.resolve(act))
    if (act === 'now') return this._run(() => sy.sync())
    if (act === 'start') {
      return this._run(async () => {
        await sy.start()
        this.mode = 'code' // 馬上顯示同步碼，方便接著設定手機
        this.toast({ icon: '雲', title: '開始線上同步了', sub: '在另一台裝置輸入同步碼就能連上' })
      })
    }
    if (act === 'join') {
      return this._run(async () => {
        await sy.join(this.draft)
        this.mode = ''
        this.draft = ''
        this.toast({ icon: '雲', title: '已連上線上同步' })
      })
    }
  }

  _mode(mode) {
    this.mode = mode
    this.render()
    if (mode === 'join') this.$('.cloud-input')?.focus()
  }

  async _run(fn) {
    this.busy = true
    this.render()
    try {
      await fn()
    } catch (err) {
      this.toast({ icon: '！', title: '線上同步沒有連上', sub: err.message })
    } finally {
      this.busy = false
      this.render()
    }
  }

  render() {
    const sy = this.sync
    const st = sy.state
    // 已經在同步時輸入同步碼（分享連結）：改用新的那一組
    const joining = this.mode === 'join' && st !== 'conflict'
    const showCode = this.mode === 'code' && sy.code && st !== 'off' && st !== 'conflict'
    if (!joining && !showCode && this.mode && st !== 'conflict') this.mode = ''

    let info
    let btns
    if (joining) {
      info = st === 'off' ? '輸入另一台裝置上的同步碼（16 個英文字母和數字）' : '要改用這組同步碼嗎？目前這組會停止同步'
      btns = [['join', '連線', 1], ['cancel', '取消']]
    } else if (st === 'unsupported') {
      info = '這個瀏覽器不能用線上同步（版本太舊，或不是用 https 開啟）。可以用下面的匯出／匯入搬資料'
      btns = []
    } else if (st === 'off') {
      info = '手機和電腦輸入同一組同步碼，就能隨時同步。資料在裝置上加密後才上傳，伺服器看不到內容'
      btns = [['start', '開始同步', 1], ['join-open', '輸入同步碼']]
    } else if (st === 'conflict') {
      const c = sy.conflict
      const what = c?.first ? '這台已經有自己的小島，雲端也有一份' : '這台和雲端都有新的變更'
      info = c ? `${what}（雲端 ${when(c.remoteAt)}、這台 ${when(c.localAt)}）。要用哪一邊？另一邊會留一份備份` : ''
      btns = [['remote', '用雲端的', 1], ['local', '用這台的', 1]]
    } else if (st === 'error') {
      info = `同步失敗：${esc(sy.message)}`
      btns = [['now', '重試', 1], ['stop', '停止同步']]
    } else {
      info = st === 'offline' ? '離線中・連上網路後會自動同步' : `已連線・${sy.lastSync ? `${hhmm(sy.lastSync)} 同步過` : '同步中…'}`
      btns = [['now', '立即同步'], ['code', showCode ? '收起同步碼' : '同步碼'], ['stop', '停止同步']]
    }
    this.$('.cloud-info').innerHTML = info
    this.$('.sync-dot').dataset.state = st
    this.$('.cloud-btns').innerHTML = btns
      .map(([act, label, on]) => `<button class="chip-toggle ${on ? 'on' : ''}" data-cloud="${act}" ${this.busy ? 'disabled' : ''}>${label}</button>`)
      .join('')
    this._renderPanel(joining ? 'join' : showCode ? `code:${sy.code}` : '')
  }

  _renderPanel(key) {
    if (key === this._panel) return
    this._panel = key
    const panel = this.$('.cloud-panel')
    if (key === 'join') {
      panel.innerHTML = `<input class="cloud-input" placeholder="XXXX-XXXX-XXXX-XXXX" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="同步碼" value="${esc(this.draft)}">`
      return
    }
    if (!key) {
      panel.innerHTML = ''
      return
    }
    const code = this.sync.code
    panel.innerHTML = `
      <div class="cloud-code">
        <div class="cloud-qr"></div>
        <div class="cloud-code-text">
          <code>${esc(code)}</code>
          <small>在另一台裝置打開ひより，到「紀錄 → 設定 → 線上同步」按「輸入同步碼」；手機也可以直接用相機掃左邊的 QR code。同步碼就是鑰匙，不要給別人。</small>
          <div class="sync-btns"><button class="chip-toggle" data-cloud="copy-code">複製同步碼</button><button class="chip-toggle" data-cloud="copy-link">複製連結</button><button class="chip-toggle danger" data-cloud="delete">刪除雲端資料</button></div>
        </div>
      </div>`
    qrSvg(shareLink(code)).then((svg) => {
      if (this._panel === key) panel.querySelector('.cloud-qr').innerHTML = svg
    })
  }
}
