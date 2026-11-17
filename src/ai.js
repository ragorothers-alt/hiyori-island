// ふじ的 AI：經過自己的 Worker（worker/src/ai.js）呼叫 Claude。
// Claude API 金鑰放在 Worker 的 secret 裡；這裡只有使用者自己設的通行碼：存在這台裝置，不匯出。
// 開著線上同步時，通行碼和選的模型放在加密的那一包裡跟著同步碼帶到別台（cloud.js 的 extras；伺服器看不到），別台輸入同步碼就能用，不用再填、再選一次。
import { SYNC_API } from './cloud.js'

const PASS_KEY = 'hiyori-ai-pass'
const MODEL_KEY = 'hiyori-ai-model'
const PASS_AT_KEY = 'hiyori-ai-pass-at'
const MODEL_AT_KEY = 'hiyori-ai-model-at'

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
// 通行碼是什麼時候設的（毫秒）：開著線上同步時，各台裝置用比較新的那一組。以前設的沒有記時間，算成最舊
export const aiPassAt = () => {
  const n = Number(get(PASS_AT_KEY))
  return Number.isFinite(n) && n > 0 ? n : aiPass() ? 1 : 0
}
// at：這一組是什麼時候設的（別台同步過來的照它原本的時間；自己設的是現在，而且一定比之前那一組新）
export const setAiPass = (v, at = 0) => {
  const was = aiPassAt()
  put(PASS_KEY, String(v || '').trim())
  put(PASS_AT_KEY, String(at > 0 ? at : Math.max(Date.now(), was + 1)))
}
// 跟著線上同步帶到別台的那一包（放在加密的資料裡）：沒設通行碼就不帶；選過模型的話模型也一起帶
export function aiShare() {
  const pass = aiPass()
  if (!pass) return null
  const out = { aiPass: pass, aiPassAt: aiPassAt() }
  const at = aiModelAt()
  if (at) Object.assign(out, { aiModel: aiModel(), aiModelAt: at })
  return out
}
// 別台同步過來的通行碼：比這台的新才換（這台剛停用、剛改過的不會被舊的蓋回去）。回傳有沒有換
export function aiAdopt(x) {
  const pass = typeof x?.aiPass === 'string' ? x.aiPass.trim() : ''
  const at = Number(x?.aiPassAt)
  if (!pass || pass.length > 200 || !Number.isFinite(at) || at <= 0 || at <= aiPassAt()) return false
  const same = pass === aiPass()
  setAiPass(pass, at)
  return !same
}
const isModel = (id) => AI_MODELS.some((m) => m.id === id)
export const aiModel = () => (isModel(get(MODEL_KEY)) ? get(MODEL_KEY) : AI_MODELS[0].id)
// 模型是什麼時候選的（毫秒）：沒選過（用預設的）是 0；以前選的沒有記時間，算成最舊
export const aiModelAt = () => {
  if (!isModel(get(MODEL_KEY))) return 0
  const n = Number(get(MODEL_AT_KEY))
  return Number.isFinite(n) && n > 0 ? n : 1
}
// at：跟通行碼一樣，別台同步過來的照它原本的時間；自己選的是現在，而且一定比之前那一次新
export const setAiModel = (id, at = 0) => {
  const was = aiModelAt()
  put(MODEL_KEY, isModel(id) ? id : '')
  put(MODEL_AT_KEY, isModel(id) ? String(at > 0 ? at : Math.max(Date.now(), was + 1)) : '')
}
// 別台選的模型：比這台選的新才換（這台沒選過就直接用別台的）。跟通行碼分開比，各看各的時間。回傳有沒有換
export function aiAdoptModel(x) {
  const id = x?.aiModel
  const at = Number(x?.aiModelAt)
  if (!isModel(id) || !Number.isFinite(at) || at <= 0 || at <= aiModelAt()) return false
  const same = id === aiModel()
  setAiModel(id, at)
  return !same
}
// ── 跟著線上同步走（接在 CloudSync 的 extras 上，見 main.js） ──
// 這台送上去過哪一份記在 SHARED_KEY：通行碼和模型各是什麼時候設的（沒選過模型的只有通行碼的時間，跟以前記的一樣）
const SHARED_KEY = 'hiyori-ai-pass-shared'
const sigOf = (x) => (x ? [x.aiPassAt, x.aiModelAt].filter(Boolean).join('|') : '')
// 這台現在的通行碼、模型還沒送上去過（剛設、剛換，或這個功能上線前就設好的）
export const aiUnshared = () => !!aiPass() && get(SHARED_KEY) !== sigOf(aiShare())
// onAdopt({ pass, model })：別台的通行碼／模型換進這台了（哪一個換了是 true）
export function aiExtras(onAdopt = () => {}) {
  const sent = (x) => put(SHARED_KEY, sigOf(x))
  return {
    get: aiShare,
    sent,
    set(x) {
      const pass = aiAdopt(x)
      const model = aiAdoptModel(x)
      // 這台現在的跟雲端那一包一樣（剛從那裡拿來的）：不用為了它再送一次
      if (sigOf(aiShare()) === sigOf(x)) sent(x)
      if (pass || model) onAdopt({ pass, model })
    },
  }
}
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
  'claude rejected': 'Claude 沒有接受這次的請求',
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
