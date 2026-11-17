import { afterAll, describe, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store, addDays } from '../src/store.js'
import { agentContext, cleanOut, describe as describeActions } from '../src/agent.js'
import { SYNC_API } from '../src/cloud.js'

const dry = process.env.HIYORI_AI_DRY === '1'
// local：npm run try:fuji:local 開的本機 Worker（臨時的通行碼）。一定要送到本機，不然就停（不讓臨時通行碼送去線上）
const local = process.env.HIYORI_AI_TARGET === 'local'
if (local && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SYNC_API)) throw new Error(`本機模式卻要送到 ${SYNC_API}，停下來`)
const pass = process.env.HIYORI_AI_PASS || ''
const model = process.env.HIYORI_AI_MODEL || 'claude-opus-5-5'
const enabled = dry || !!pass
const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
// 不連網路的檢查另外存一份，不會蓋掉真的跑出來的報告
const reportPath = join(tmpdir(), dry ? 'hiyori-fuji-live-dry.md' : 'hiyori-fuji-live.md')
const results = []
let baseline

const cases = [
  { message: '幫我加入 學測術科選曲' },
  { message: '明天下午三點到四點看牙醫' },
  {
    message: '把明天的看牙醫改到四點',
    prepare(store) {
      store.addEvent({ title: '看牙醫', date: addDays(store.today, 1), start: '15:00', end: '16:00' })
    },
  },
  { message: '加一個每天喝 8 杯水的習慣' },
  { message: '專注改成 50 分鐘，放雨聲' },
  { message: '我現在都七點半起床、十二點睡' },
  { message: '字大一點' },
  { message: '這週專注了多久？', expected: '只回答，不動資料' },
  { message: '建一個搬家專案，12 月底前完成，底下排打包、找搬家公司、退租三個里程碑' },
  {
    message: '這個專案的截止日往後一週',
    prepare(store) {
      const project = store.state.projects.find((p) => !p.archived && !p.completedAt && !p.pausedAt && p.deadline)
      if (!project) throw new Error('範例島缺少有截止日的進行中專案')
      return { here: { page: 'projects', date: store.today, project: project.id } }
    },
  },
  { message: '下週五有期末考，記一下' },
  { message: '把今天還沒做的都移到明天' },
  { message: '刪掉所有習慣', expected: '一次刪很多，應先詢問確認' },
  { message: '幫我排一下', expected: '應詢問，或依今天的狀況安排' },
  { message: '每週二、四晚上八點到九點健身' },
  { run: 'morning', message: '早晨自動整理（本週第一次）', extra: { mode: 'auto', weekStart: true } },
  {
    run: 'capture', message: '安排新任務：準備期末報告',
    prepare(store) {
      const task = store.addTask({ title: '準備期末報告', date: store.today })
      return { fresh: [task.id] }
    },
  },
]

const arrayKeys = ['schedule', 'add', 'steps', 'edit', 'star', 'msteps', 'remember', 'forget', 'done', 'drop', 'events', 'dates']
const actionKeys = [...arrayKeys, 'set', 'create', 'first', 'next', 'go']
const clone = (value) => JSON.parse(JSON.stringify(value))
const json = (value) => JSON.stringify(value, null, 2)

// 所有輸出都經過遮蔽，包括伺服器回傳的錯誤及原始 JSON。
function redact(value) {
  let text = String(value)
  if (pass) {
    for (const secret of new Set([pass, encodeURIComponent(pass), JSON.stringify(pass).slice(1, -1)])) {
      if (secret) text = text.split(secret).join('[通行碼已遮蔽]')
    }
  }
  return text
}
const print = (value) => console.log(redact(value))

function blank(run) {
  const out = { say: 'DRY：收到，這次只檢查流程，沒有變更資料。', ...Object.fromEntries(arrayKeys.map((k) => [k, []])), first: '', next: '', ask: [] }
  if (run === 'chat') Object.assign(out, { set: [], create: [], go: { do: '', id: '' } })
  return out
}

// done/drop 同時出現在舊任務動作和 ops，任務只算一次。
function items(act, key) {
  if (['set', 'create'].includes(key)) return act.ops?.[key] || []
  if (key === 'go') return act.ops?.go ? [act.ops.go] : []
  if (['first', 'next'].includes(key)) return act[key] ? [act[key]] : []
  if (['done', 'drop'].includes(key)) return [...act[key], ...(act.ops?.[key] || []).filter((x) => x.kind !== 'task')]
  return act[key] || []
}

function rawItems(out, key) {
  if (key === 'go') return out.go?.do ? [out.go] : []
  if (['first', 'next'].includes(key)) return out[key] ? [out[key]] : []
  return Array.isArray(out[key]) ? out[key] : []
}

// 逐段餵入同一個清洗器，追蹤被去重、覆蓋、超過上限或無效的原始動作。
// 保留其他欄位，讓 create 的父子 ref 和 add.projectRef 仍能正常解析。
function droppedActions(out, act, ids, run) {
  return actionKeys.map((key) => {
    const raw = rawItems(out, key)
    const kept = items(act, key).length
    if (!Array.isArray(out[key])) return { key, raw: raw.length, kept, dropped: raw.length > kept ? raw : [] }
    let owners = []
    for (let i = 0; i < raw.length; i++) {
      const partial = cleanOut({ ...out, [key]: raw.slice(0, i + 1) }, ids, run)
      const pool = [...owners]
      owners = items(partial, key).map((value) => {
        const signature = JSON.stringify(value)
        const found = pool.findIndex((x) => x.signature === signature)
        return found < 0 ? { signature, index: i } : pool.splice(found, 1)[0]
      })
    }
    const surviving = new Set(owners.map((x) => x.index))
    return { key, raw: raw.length, kept, dropped: raw.filter((_, i) => !surviving.has(i)) }
  })
}

// 排除自動統計、獎勵與紀錄；其餘 state 欄位預設全部比較，包含 agent.memory。
const ignoredRoot = new Set(['createdAt', 'updatedAt', 'rev', 'tallyGen', 'player', 'history', 'quests', 'weekly', 'weekCard', 'town', 'dex', 'pomoSids'])
// editedAt：專案「最近動過」的排序時間，撤銷也算動過（不是沒還原）
const ignoredFields = new Set(['createdAt', 'updatedAt', 'editedAt', 'doneAt', 'rewarded', 'coach'])
const statusTimes = new Set(['completedAt', 'pausedAt', 'archivedAt'])
function comparable(state) {
  function walk(value) {
    if (Array.isArray(value)) return value.map(walk)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().filter((k) => !ignoredFields.has(k)).map((k) => [k, statusTimes.has(k) ? !!value[k] : walk(value[k])]))
  }
  const data = Object.fromEntries(Object.entries(state).filter(([k]) => !ignoredRoot.has(k) && k !== 'agent'))
  data.agent = { memory: state.agent.memory }
  return walk(data)
}

function differences(before, after, path = 'state') {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((k) => differences(before[k], after[k], `${path}.${k}`))
  }
  return [{ path, before: before === undefined ? '(不存在)' : before, after: after === undefined ? '(不存在)' : after }]
}

function validOutput(out, run) {
  return out && typeof out === 'object' && !Array.isArray(out) && typeof out.say === 'string'
    && [...arrayKeys, 'ask', ...(run === 'chat' ? ['set', 'create'] : [])].every((k) => Array.isArray(out[k]))
    && typeof out.first === 'string' && typeof out.next === 'string'
    && (run !== 'chat' || (out.go && typeof out.go === 'object' && typeof out.go.do === 'string' && typeof out.go.id === 'string'))
}

async function request(data, result) {
  if (dry) {
    result.response = { ok: true, model, out: blank(data.run) }
  } else {
    let response
    try {
      // Worker 每分鐘有次數上限：連著送十幾句會被擋（too many requests），等一分鐘再送一次（最多兩次）
      let text
      for (let tries = 0; ; tries++) {
        response = await fetch(`${SYNC_API}/v1/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${encodeURIComponent(pass)}` },
          body: JSON.stringify({ task: 'agent', model, data }),
          signal: AbortSignal.timeout(210000),
        })
        text = await response.text()
        if (response.status !== 429 || tries >= 2 || !/too many requests/.test(text)) break
        print(`  （太頻繁，等 65 秒再試）`)
        await new Promise((r) => setTimeout(r, 65000))
      }
      result.http = response.status
      try {
        result.response = JSON.parse(text)
      } catch {
        result.error = 'bad output'
        result.detail = text || 'Worker 回應不是 JSON'
        return null
      }
    } catch (err) {
      result.error = err.name === 'TimeoutError' ? 'timeout' : 'network error'
      result.detail = err.message
      return null
    }
    result.model = result.response?.model || ''
    if (!response.ok || !result.response?.ok) {
      result.error = result.response?.error || `http ${response.status}`
      result.detail = result.response?.detail || ''
      return null
    }
  }
  result.model = result.response?.model || ''
  if (!validOutput(result.response?.out, data.run)) {
    result.error = 'bad output'
    result.detail = 'Worker out 缺少 agent schema 必要欄位或型別不對，原始回應保留在報告'
    return null
  }
  return result.response.out
}

function summaryRows() {
  return results.map((r) => ({
    情境: r.message, 秒數: r.seconds, 改動: r.changes?.length ?? '—', 丟掉: r.droppedCount ?? '—',
    撤銷還原: r.undoEqual == null ? '未執行' : r.undoEqual ? '是' : '否', 錯誤: r.error || '',
  }))
}

if (!enabled) print('略過ふじ live：請依 live/README.md 設定 HIYORI_AI_PASS；只檢查腳本可設 HIYORI_AI_DRY=1。')

describe.skipIf(!enabled)('ふじ真人試跑報告', () => {
  afterAll(async () => {
    if (!results.length) return
    const rows = summaryRows()
    // 使用字串輸出總表，避免 console.table 繞過通行碼遮蔽。
    const table = ['| 情境 | 秒數 | 改動 | 丟掉 | 撤銷還原 | 錯誤 |', '| --- | ---: | ---: | ---: | --- | --- |',
      ...rows.map((row) => `| ${Object.values(row).map((v) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`)].join('\n')
    print(`\n總表（${dry ? 'DRY，未呼叫 Claude' : '真實 Worker'}）\n${table}`)
    const details = results.map((r, i) => `## ${i + 1}. ${r.message}\n\n完整結果：\n\n\`\`\`json\n${json(r)}\n\`\`\``).join('\n\n')
    await writeFile(reportPath, redact(`# ふじ live 報告\n\n時間：${new Date().toISOString()}\n\n模式：${dry ? 'DRY（空動作，無網路）' : local ? '本機 Worker（wrangler dev，真的 Claude）' : '真實 Worker'}；指定模型：${model}\n\n${table}\n\n比較忽略時間戳、統計／獎勵進度、同步版本與 agent 紀錄，保留 agent.memory。清洗統計以整個動作為單位，欄位修正請對照原始及清洗 JSON。\n\n${details}\n`), 'utf8')
    print(`\n報告：${reportPath}`)
  })

  // 每個 it 一個請求；不使用 concurrent，也不自動重試。
  for (const scenario of cases) {
    it(scenario.message, async () => {
      if (!models.includes(model)) throw new Error('HIYORI_AI_MODEL 只接受 README 列出的三種模型')
      const run = scenario.run || 'chat'
      const result = { message: scenario.message, run, expected: scenario.expected || '', model: '', error: '', detail: '' }
      results.push(result)
      const start = performance.now()
      let store
      try {
        localStorage.clear()
        sessionStorage.clear()
        store = new Store()
        if (!baseline) baseline = store.exportJSON()
        store.importJSON(baseline)
        const prepared = scenario.prepare?.(store) || {}
        const extra = { mode: 'auto', ...(run === 'chat' ? { message: scenario.message, history: [], here: null } : {}), ...scenario.extra, ...prepared }
        const { data, ids } = agentContext(store, run, extra, new Date())
        result.data = data
        const out = await request(data, result)
        if (!out) return
        const act = cleanOut(out, ids, run)
        result.act = clone(act)
        result.cleaning = droppedActions(out, act, ids, run)
        result.droppedCount = result.cleaning.reduce((n, c) => n + c.dropped.length, 0)
        result.description = describeActions(act, store)
        const before = comparable(store.state)
        const entry = store.agentApply(act, { run, weekStart: !!extra.weekStart })
        result.changes = entry?.changes.map((c) => c.t) || []
        result.appliedDiff = differences(before, comparable(store.state))
        result.entry = entry ? clone(entry) : null
        result.undoCount = entry ? store.agentUndo(entry.id) : 0
        result.undoDiff = differences(before, comparable(store.state))
        result.undoEqual = result.undoDiff.length === 0
      } catch (err) {
        result.error = '腳本錯誤'
        result.detail = err.message
        // 仍寫出這一輪報告，再讓 Vitest 標記腳本故障。
        throw new Error(redact(`腳本錯誤：${err.message}`))
      } finally {
        store?.flushSave()
        result.seconds = ((performance.now() - start) / 1000).toFixed(2)
        print(`\n${scenario.message}（${run}）｜${result.seconds} 秒｜模型 ${result.model || '未知'}`)
        if (result.expected) print(`預期：${result.expected}`)
        if (result.act) {
          print(`ふじ：${result.act.say || '（無）'}\n可點回答：${json(result.act.ask)}\n前往：${json(result.act.ops?.go || null)}`)
          print(`實際變更：${result.changes?.join('；') || '無'}`)
          print(`清洗數量：${result.cleaning.map((c) => `${c.key} ${c.raw}→${c.kept}`).join('、')}`)
          for (const c of result.cleaning.filter((c) => c.dropped.length)) print(`丟掉 ${c.key}：${json(c.dropped)}`)
          print(`撤銷還原：${result.undoEqual == null ? '未執行' : result.undoEqual ? '是' : '否'}${result.undoDiff?.length ? `\n差異：${json(result.undoDiff)}` : ''}`)
        }
        if (result.error) print(`錯誤：${result.error}\ndetail：${typeof result.detail === 'string' ? result.detail : json(result.detail)}`)
      }
    })
  }
})
