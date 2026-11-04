import './ai.css'
import { esc, armConfirm } from './dom.js'
import { AI_MODELS, PASS_MIN, aiModel, aiPass, askAI, setAiModel, setAiPass } from '../ai.js'

// 設定裡「ふじ的 AI」那一列：填通行碼、選模型、測試連線。
// Claude API 金鑰不經過這裡：它放在自己的 Worker 的 secret，這裡只放通行碼（只存在這台裝置）。
// 輸入框只在打開時建一次，測試連線的結果只更新文字，打字不會被打斷。

export class AiView {
  constructor(row, { toast }) {
    this.row = row
    this.toast = toast
    this.editing = false
    this.busy = false
    this.result = '' // 上一次測試連線的結果
    this._panel = null
    row.innerHTML = `<div><b>ふじ的 AI<em class="ai-tag">Claude</em><span class="sync-dot"></span></b><small class="ai-info"></small></div><div class="cloud-panel ai-panel"></div><div class="sync-btns ai-btns"></div>`
    this.$ = (s) => row.querySelector(s)
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ai]')
      if (b && !b.disabled) this._act(b.dataset.ai, b)
    })
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.target.matches('.ai-pass')) this._act('save')
    })
    this.render()
  }

  async _act(act, btn) {
    if (act === 'edit') return this._edit(true)
    if (act === 'cancel') return this._edit(false)
    if (act === 'model') {
      setAiModel(btn.dataset.v)
      this.result = ''
      return this.render()
    }
    if (act === 'off') {
      return armConfirm(btn, '再按一次停用', () => {
        setAiPass('')
        this.result = ''
        this.render()
        this.toast({ icon: '藤', title: 'ふじ的 AI 停用了', sub: '排程、拆細項會回到平常的方法' })
      })
    }
    if (act === 'save') {
      const v = this.$('.ai-pass')?.value.trim()
      if (!v) return this.$('.ai-pass')?.focus()
      setAiPass(v)
      this.editing = false
      return this._test(true)
    }
    if (act === 'test') return this._test(false)
  }

  _edit(on) {
    this.editing = on
    this.render()
    if (on) this.$('.ai-pass')?.focus()
  }

  // 測試連線：Worker 查一次模型資料（不產生文字、不花 token）
  async _test(first) {
    this.busy = true
    this.result = '連線中…'
    this.render()
    try {
      const r = await askAI('ping')
      this.result = `連上了・${r.name || r.model}`
      if (first) this.toast({ icon: '藤', title: 'ふじ接上 Claude 了', sub: '排程、拆細項、整理進度和週報都能用了' })
    } catch (err) {
      this.result = err.message
      if (first) this.toast({ icon: '！', title: '還沒連上 Claude', sub: err.message })
    } finally {
      this.busy = false
      this.render()
    }
  }

  render() {
    const on = !!aiPass()
    const model = AI_MODELS.find((m) => m.id === aiModel())
    let info
    let btns
    if (this.editing) {
      info = '填你在 Worker 設的通行碼（AI_PASS）。只存在這台裝置，不會同步也不會匯出'
      btns = [['save', '儲存並測試', 1], ['cancel', '取消']]
    } else if (!on) {
      info = '接上自己 Claude Console 的 API：金鑰放在自己的 Worker 裡，這裡只填通行碼。設好後，ふじ會用 Claude 排程、拆細項、整理專案進度、寫週報洞察'
      btns = [['edit', '設定通行碼', 1]]
    } else {
      info = `${esc(this.result || `已設定・用 ${model.label}`)}`
      // 通行碼太短容易被猜中：提醒到 Worker 重設一組長一點的（這裡跟著改）
      const len = [...aiPass()].length
      if (len < PASS_MIN) info += `<br><span class="ai-warn">通行碼只有 ${len} 個字，容易被猜中。建議在 worker 資料夾執行 <code>npx wrangler@4 secret put AI_PASS</code> 換成 ${PASS_MIN} 個字以上，再按「改通行碼」</span>`
      btns = [['test', '測試連線'], ['edit', '改通行碼'], ['off', '停用']]
    }
    this.$('.ai-info').innerHTML = info
    this.$('.sync-dot').dataset.state = !on ? 'off' : this.result.startsWith('連上了') ? 'linked' : this.busy ? '' : this.result ? 'error' : 'linked'
    this.$('.ai-btns').innerHTML = btns
      .map(([act, label, hi]) => `<button class="chip-toggle ${hi ? 'on' : ''}" data-ai="${act}" ${this.busy ? 'disabled' : ''}>${label}</button>`)
      .join('')
    this._renderPanel(this.editing ? 'edit' : on ? `model:${model.id}` : '')
  }

  _renderPanel(key) {
    if (key === this._panel) return
    this._panel = key
    const panel = this.$('.ai-panel')
    if (key === 'edit') {
      panel.innerHTML = `<input class="cloud-input ai-pass" type="password" maxlength="200" autocomplete="off" spellcheck="false" placeholder="通行碼" aria-label="Claude 通行碼">
        <details class="ai-how"><summary>還沒設定 Worker？</summary>
          <p>在專案的 <code>worker</code> 資料夾執行下面兩行，照提示貼上（Claude Console → API Keys 建立的金鑰，和自己想的一組通行碼，至少 ${PASS_MIN} 個字）。金鑰只存在 Cloudflare，不會出現在這個網頁裡。</p>
          <pre>npx wrangler@4 secret put ANTHROPIC_API_KEY
npx wrangler@4 secret put AI_PASS</pre>
          <p>用到 AI 的功能會把那一項的資料（例如專案的日誌、筆記、這週的數字）經過你的 Worker 交給 Claude；費用照你 Claude Console 的帳單計算。</p>
        </details>`
      return
    }
    if (!key) {
      panel.innerHTML = ''
      return
    }
    const cur = aiModel()
    panel.innerHTML = `<div class="seg ai-models" role="group" aria-label="Claude 模型">${AI_MODELS.map(
      (m) => `<button type="button" data-ai="model" data-v="${m.id}" class="${m.id === cur ? 'on' : ''}" aria-pressed="${m.id === cur}">${m.label}<small>${m.sub}</small></button>`,
    ).join('')}</div>`
  }
}
