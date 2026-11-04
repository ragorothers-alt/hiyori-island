// ふじ的 AI：經過自己的 Worker（worker/src/ai.js）呼叫 Claude。
// Claude API 金鑰放在 Worker 的 secret 裡；這裡只有使用者自己設的通行碼，只存在這台裝置（不同步、不匯出）。
import { SYNC_API } from './cloud.js'

const PASS_KEY = 'hiyori-ai-pass'
const MODEL_KEY = 'hiyori-ai-model'

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus', sub: '想得最周到' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet', sub: '快又穩' },
  { id: 'claude-haiku-5-5', label: 'Haiku', sub: '最快最省' },
]

const get = (k) => {
  try {
    return localStorage.getItem(k) || ''
  } catch {
    return ''
  }
}
const put = (k, v) => {
  try {
    if (v) localStorage.setItem(k, v)
    else localStorage.removeItem(k)
  } catch {}
}
export const aiPass = () => get(PASS_KEY)
export const setAiPass = (v) => put(PASS_KEY, String(v || '').trim())
export const aiModel = () => (AI_MODELS.some((m) => m.id === get(MODEL_KEY)) ? get(MODEL_KEY) : AI_MODELS[0].id)
export const setAiModel = (id) => put(MODEL_KEY, AI_MODELS.some((m) => m.id === id) ? id : '')
// 設了通行碼才顯示 AI 的按鈕
export const aiReady = () => !!aiPass()

// Worker 回的錯誤代碼 → 給人看的話
const TEXT = {
  'no pass': '還沒設定通行碼（紀錄 → 設定 → ふじ的 AI）',
  offline: '連不上網路，等一下再試',
  'ai off': 'Worker 還沒設定 Claude 的金鑰或通行碼',
  'bad pass': '通行碼不對，到設定裡改一下',
  'bad key': 'Worker 裡的 Claude API 金鑰不能用',
  'no access': '這把金鑰沒有使用這個模型的權限',
  'no model': '找不到這個模型，換一個試試',
  'claude busy': 'Claude 現在很忙，過一兩分鐘再試',
  'too many requests': '問得太密了，休息一分鐘再試',
  'claude unreachable': 'Worker 連不上 Claude，等一下再試',
  'claude error': 'Claude 那邊出了點狀況，等一下再試',
  refused: '這次的內容 Claude 沒辦法回答',
  'too long': '回答太長被截斷了，再試一次',
  'bad output': '回答的格式不對，再試一次',
  'too large': '要整理的資料太多了',
  locked: '通行碼最近錯太多次，AI 先暫停一小時（防止有人亂猜）',
  'daily limit': '今天問ふじ的次數到上限了，明天再來',
  'server error': 'Worker 出了點狀況，等一下再試',
}
// 通行碼太短容易被猜中：設定裡提醒（Worker 那邊錯太多次會暫停，但長一點最安全）
export const PASS_MIN = 8

export class AiError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${TEXT[code] || code}：${detail}` : TEXT[code] || `出了點狀況（${code}）`)
    this.code = code
  }
}

// task：ping／coach／steps／summary／insight；回傳 Claude 照格式寫好的 JSON（ping 回傳模型資訊）
export async function askAI(task, data, { signal } = {}) {
  const pass = aiPass()
  if (!pass) throw new AiError('no pass')
  let res
  try {
    res = await fetch(`${SYNC_API}/v1/ai`, {
      method: 'POST',
      // 標頭只能放 ASCII：中文通行碼先編碼，Worker 那邊再解開
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${encodeURIComponent(pass)}` },
      body: JSON.stringify({ task, model: aiModel(), data }),
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new AiError('offline')
  }
  let body = null
  try {
    body = await res.json()
  } catch {}
  if (!res.ok || !body?.ok) throw new AiError(body?.error || `http ${res.status}`, body?.detail || '')
  return task === 'ping' ? body : body.out
}
