// 自主的ふじ什麼時候動：
//   早上第一次打開 → 整理今天（每週第一次順便看整週）；晚上 → 準備明天；
//   排好的任務時間過了還沒做完、或撞到後來加的日程 → 重排今天剩下的；
//   剛加了任務 → 替它估時間、排進空檔、太大的拆小步驟；
//   使用者說一句話 → 照著做。
// 每一次是一個請求（askAI('agent')）：整理好的資料送給 Claude，回來的那批動作檢查過才做（store.agentApply），整批可以撤銷。
// 設定的 agentMode：auto 直接做、ask 先放著等使用者按「套用」、off 只在開口時動。
import { aiReady, askAI } from './ai.js'
import { agentContext, cleanOut, dueRun, hasActions, describe, weekOf, saneAct, AGENT_DAYS } from './agent.js'
import { addDays, dateStr } from './store/util.js'
import { floating } from './store/migrate.js'

const LOCAL_KEY = 'hiyori-agent'
const CHAT_KEEP = 24
// 加了任務之後等這麼久（毫秒）才整理：連續加好幾件時一起處理
export const CAPTURE_WAIT = 6000
// 離線、剛出過錯時，隔這麼久再看一次那幾件新任務
export const CAPTURE_RETRY = 30000
// 出錯之後隔多久再自己試
const RETRY_MS = 10 * 60000
// 這些錯誤再試也一樣：等使用者改了設定或隔天
const STOP_CODES = new Set(['bad pass', 'ai off', 'bad key', 'no access', 'no model', 'daily limit', 'locked', 'no pass'])
const RUN_LABEL = { morning: '整理今天', replan: '重排今天', capture: '安排新任務', evening: '準備明天', chat: '' }

// 頁面現在看不到（切到別的分頁、手機鎖著）；離線
const hidden = () => typeof document !== 'undefined' && document.hidden
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

function readLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

// 同一個瀏覽器開了好幾個分頁：自己整理同一刻只有一個分頁在做（Web Locks；別的分頁正在做就跳過這一次）
const withLock = (fn) =>
  typeof navigator !== 'undefined' && navigator.locks?.request ? navigator.locks.request('hiyori-agent', { ifAvailable: true }, (lock) => (lock ? fn() : null)) : fn()
const sameDay = (at) => new Date(at).toDateString() === new Date().toDateString()
// 存在這台裝置、等使用者決定的那一份（重新整理後接著問）：只收今天的、樣子對的
function pendingOf(p) {
  if (!p || typeof p !== 'object' || !saneAct(p.act) || !Array.isArray(p.lines) || !sameDay(p.at)) return null
  if (!['morning', 'replan', 'capture', 'evening'].includes(p.run)) return null
  return { id: String(p.id || 'p'), at: +p.at, run: p.run, say: typeof p.say === 'string' ? p.say : '', act: p.act, lines: p.lines.filter((x) => typeof x === 'string').slice(0, 80), weekStart: !!p.weekStart }
}

// hooks：{ notify(entry, run, pending), busy(): 使用者正在打字或開著表單, focusing(): 正在專注的任務 id（沒有是 null）,
//   holding(): 現在不要打擾（專注中、載入中）, settle(): 動手之前先把同步拉回來,
//   here(): 對話時使用者正在看哪裡（{ page, date, project, task, event }）, go(g): 她說完之後要打開的畫面（agentOps.js 的 go） }
export function createAgent(store, hooks = {}) {
  const local = readLocal()
  const subs = new Set()
  const agent = {
    // 正在做哪一種（沒有是 null）
    thinking: null,
    // mode 是 ask 時等使用者決定的那一份：{ id, at, run, say, act, lines, weekStart }
    pending: pendingOf(local.pending),
    // 上一次出錯的說法（對話裡顯示）
    error: '',
    // 對話（這台裝置）：[{ who: 'me'|'fuji', text, at, entry: 那次記下的 id, ask: [可以直接點的回答] }]
    chat: Array.isArray(local.chat) ? local.chat.filter((m) => m && typeof m.text === 'string').slice(-CHAT_KEEP) : [],
  }
  const seenOf = (v) => (v && typeof v === 'object' ? v : {})
  let seen = seenOf(local.seen)
  let stopUntil = 0
  let stopDay = ''
  // 設定改了一次就加一：還在路上的回應回來時對不上，就不套用
  let gen = 0
  const fresh = new Set()
  let captureT = 0
  let chatAbort = null

  const keep = () => {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ seen, chat: agent.chat.slice(-CHAT_KEEP), pending: agent.pending }))
    } catch {}
  }
  const changed = () => {
    for (const fn of subs) fn(agent)
  }
  agent.subscribe = (fn) => {
    subs.add(fn)
    return () => subs.delete(fn)
  }
  const mode = () => store.state.settings.agentMode || 'auto'
  // 對話每一則的時間：一定比上一則、上一筆紀錄晚（畫面照時間排）
  const stamp = () => Math.max(Date.now(), (agent.chat.at(-1)?.at || 0) + 1, (store.state.agent.log.at(-1)?.at || 0) + 1)
  // 接上 Claude 了嗎；會不會自己動
  agent.ready = () => aiReady()
  agent.auto = () => aiReady() && mode() !== 'off'
  const blocked = () => stopDay === store.today || Date.now() < stopUntil

  async function run(kind, extra = {}) {
    if (agent.thinking) return null
    agent.thinking = kind
    agent.error = ''
    changed()
    const chat = kind === 'chat'
    const weekStart = kind === 'morning' && store.state.agent.ran.week !== weekOf(store.today)
    // day：真的日期（不是 store 記著的今天：過了午夜、store 還沒跨日的那一下也認得出來）
    const from = { gen, day: dateStr(), ran: store.state.agent.ran[kind] || '' }
    try {
      // 對話時：使用者正在看哪一頁（「這個專案」「這天」指的是什麼）
      const here = chat ? hooks.here?.() || null : null
      const { data, ids } = agentContext(store, kind, { ...extra, mode: mode(), weekStart, focusing: hooks.focusing?.() || null, here })
      const out = await askAI('agent', data, { signal: extra.signal })
      // 自己整理的：等回應的這段時間裡關掉了、換了設定、過了午夜，或別的分頁／別台已經做完同一種，這次就不算
      if (!chat && !extra.manual && (!agent.auto() || gen !== from.gen || dateStr() !== from.day)) return null
      if (!chat && (kind === 'morning' || kind === 'evening') && store.state.agent.ran[kind] === store.today && from.ran !== store.today) return null
      const act = cleanOut(out, ids, kind)
      // 先給使用者看：有要動資料的才留著等；只有一句話就直接記下
      if (!chat && mode() === 'ask' && hasActions(act)) {
        agent.pending = { id: `p${Date.now().toString(36)}`, at: Date.now(), run: kind, say: act.say, act, lines: describe(act, store), weekStart }
        keep()
        store.agentRan(kind, weekStart)
        hooks.notify?.(null, kind, agent.pending)
        return { act, entry: null }
      }
      const entry = store.agentApply(act, { run: kind, weekStart, focusing: hooks.focusing?.() || null })
      if (!chat && entry) hooks.notify?.(entry, kind, null)
      // 說完之後替使用者打開的畫面（開始專注那一件、某一頁、某個專案）
      if (chat && act.ops?.go) hooks.go?.(act.ops.go)
      return { act, entry }
    } catch (err) {
      if (err?.name === 'AbortError') return null
      agent.error = err?.message || '出了點狀況'
      if (!chat) {
        console.warn('[hiyori] ふじ自己整理時沒連上', err)
        if (STOP_CODES.has(err?.code)) stopDay = store.today
        else stopUntil = Date.now() + RETRY_MS
      }
      throw err
    } finally {
      agent.thinking = null
      changed()
    }
  }

  // 等使用者決定的那一份只算當天的：隔天就不問了（不然會把昨天的安排套到今天，也擋住今天的整理）
  function livePending() {
    if (agent.pending && !sameDay(agent.pending.at)) {
      agent.pending = null
      keep()
      changed()
    }
    return agent.pending
  }
  // 現在該自己整理哪一種（不該動是 null）
  function check(now) {
    if (!agent.auto() || agent.thinking || livePending()) return null
    if (hidden() || offline() || store.newerApp) return null
    if (blocked()) return null
    if (hooks.holding?.() || hooks.busy?.()) return null
    // 別的分頁剛為了同一個狀況重排過：照它記的
    seen = seenOf(readLocal().seen || seen)
    const today = store.today
    return dueRun({
      today,
      nowMin: now.getHours() * 60 + now.getMinutes(),
      rhythm: store.state.rhythm,
      ran: store.state.agent.ran,
      tasks: store.tasksOn(today),
      events: store.timedEventsOn(today),
      tomorrow: store.tasksOn(addDays(today, 1)),
      focusing: hooks.focusing?.() || null,
      seen,
      now: now.getTime(),
    })
  }
  function go(due) {
    const today = store.today
    // 早上沒有任何東西可以排（今天沒有任務、沒有逾期、沒有進行中的專案）：不用問 Claude，記下今天看過了
    if (due.run === 'morning' && !store.tasksOn(today).some((t) => !t.done) && !store.overdue().length && !store.state.projects.some((p) => !p.archived && !p.completedAt && !p.pausedAt)) {
      store.agentRan('morning', store.state.agent.ran.week !== weekOf(today))
      return null
    }
    return Promise.resolve(withLock(() => run(due.run, { why: due.why })))
      .then((res) => {
        // 這個狀況處理過了（做完才記：沒連上的話，等一下還會再試）
        if (res && due.run === 'replan') {
          seen = { sig: due.sig, at: Date.now() }
          keep()
        }
        return res
      })
      .catch(() => null)
  }
  // 每分鐘（和回到 App 時）看一次：現在該不該自己整理。
  // 要動之前先等同步把別台的變更拿回來（hooks.settle）：別台已經整理過就不再做，也不會拿舊資料排、弄出兩邊都改過的衝突
  let settling = false
  agent.tick = (now = new Date()) => {
    if (settling) return null
    const due = check(now)
    if (!due) return null
    if (!hooks.settle) return go(due)
    settling = true
    return Promise.resolve()
      .then(() => hooks.settle())
      .catch(() => null)
      .then(() => {
        settling = false
        const again = check(new Date())
        return again ? go(again) : null
      })
  }
  // 剛加的任務：等一下一起整理（ふじ自己加的、例行公事生成的、問卷排出來的不算）
  agent.added = (t) => {
    if (!agent.auto() || !t || t.done || t.coach || t.routineId || floating(t)) return
    if (t.date < store.today || t.date > addDays(store.today, AGENT_DAYS - 1)) return
    fresh.add(t.id)
    clearTimeout(captureT)
    captureT = setTimeout(capture, CAPTURE_WAIT)
  }
  let capturing = false
  function capture() {
    clearTimeout(captureT)
    if (!fresh.size) return
    if (capturing) return void (captureT = setTimeout(capture, CAPTURE_WAIT))
    // 關掉了、通行碼不對這類今天不會好的：不等了
    if (!agent.auto() || stopDay === store.today) return fresh.clear()
    // 還在打字、正在整理別的、專注中、離線、剛出過錯：留著，晚一點再看
    if (agent.thinking || livePending() || hooks.busy?.() || hooks.holding?.() || hidden() || offline() || blocked()) {
      captureT = setTimeout(capture, offline() || blocked() ? CAPTURE_RETRY : CAPTURE_WAIT)
      return
    }
    const ids = [...fresh].filter((id) => {
      const t = store.state.tasks.find((x) => x.id === id)
      return t && !t.done && !floating(t)
    })
    fresh.clear()
    if (!ids.length) return
    const again = () => {
      for (const id of ids) fresh.add(id)
      clearTimeout(captureT)
      captureT = setTimeout(capture, CAPTURE_RETRY)
    }
    // 跟自己整理走同一條路：先等同步、同一刻只有一個分頁在做。別的分頁正在做（沒拿到鎖）、沒連上：這幾件放回去，等一下再試
    capturing = true
    Promise.resolve()
      .then(() => hooks.settle?.())
      .catch(() => null)
      .then(() => withLock(() => run('capture', { fresh: ids })))
      .then((res) => res || again(), again)
      .finally(() => (capturing = false))
  }
  // 使用者說一句話。回傳 ふじ的那一則（出錯時也回一則，寫著原因）
  agent.say = async (message) => {
    const text = String(message || '').trim().slice(0, 600)
    if (!text) return null
    if (agent.thinking) {
      // 正在自己整理：等它做完再回（不然兩邊會改到同一批任務）
      await new Promise((ok) => {
        const off = agent.subscribe(() => {
          if (agent.thinking) return
          off()
          ok()
        })
      })
    }
    const history = agent.chat.slice(-10)
    agent.chat.push({ who: 'me', text, at: stamp() })
    keep()
    chatAbort = new AbortController()
    let reply
    try {
      const res = await run('chat', { message: text, history, signal: chatAbort.signal })
      if (!res) {
        // 按了停：那一句收回
        agent.chat.pop()
        keep()
        changed()
        return null
      }
      const { act, entry } = res
      reply = { who: 'fuji', text: act.say || (entry?.changes.length ? '好了。' : '嗯。'), at: stamp(), entry: entry?.id || null, ask: act.ask }
    } catch (err) {
      reply = { who: 'fuji', text: err?.message || '這次沒連上，等一下再試。', at: stamp(), failed: true }
    }
    agent.chat.push(reply)
    agent.chat = agent.chat.slice(-CHAT_KEEP)
    keep()
    changed()
    return reply
  }
  agent.stop = () => chatAbort?.abort()
  // 只看不做（除錯用，console 裡 hiyori.agent.preview('morning')）：送出去的資料、Claude 回的、清好的動作、會怎麼說
  agent.preview = async (kind = 'morning', extra = {}) => {
    const { data, ids } = agentContext(store, kind, { ...extra, mode: mode(), focusing: hooks.focusing?.() || null })
    const out = await askAI('agent', data)
    const act = cleanOut(out, ids, kind)
    return { data, out, act, lines: describe(act, store) }
  }
  // 現在就整理一次（按鈕）
  agent.now = (kind = 'morning') => run(kind, { why: '使用者按了「現在整理」', manual: true }).catch(() => null)

  // mode 是 ask 時：套用、不用
  agent.accept = () => {
    const p = livePending()
    if (!p) return null
    agent.pending = null
    keep()
    let entry = null
    try {
      entry = store.agentApply(p.act, { run: p.run, weekStart: p.weekStart, focusing: hooks.focusing?.() || null })
    } catch (err) {
      // 存著的那一份壞掉了（重新整理前存的）：當成沒有
      console.warn('[hiyori] 套用ふじ的安排時出錯', err)
    }
    changed()
    return entry
  }
  agent.dismiss = () => {
    agent.pending = null
    keep()
    changed()
  }
  agent.clearChat = () => {
    agent.chat = []
    keep()
    changed()
  }
  // 設定改了（換通行碼、換模式）：之前出的錯不算了
  agent.reset = () => {
    gen++
    stopDay = ''
    stopUntil = 0
    agent.error = ''
    changed()
  }
  agent.label = (kind) => RUN_LABEL[kind] || ''
  return agent
}
