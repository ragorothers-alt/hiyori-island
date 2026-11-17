// 匯入的行事曆：照 state.calendars 的網址經過 Worker（/v1/ics）抓回 .ics、解析（src/ics.js），變成唯讀的日程放進 store.external。
// 抓回來的放在這台裝置（localStorage），不存進小島的資料、不同步：每台自己抓（私人網址也不會多一份在別的地方）。
// 打開 App、回到 App、每隔一陣子看一次，超過 30 分鐘沒抓就再抓；設定裡可以馬上抓。抓不到時留著上一次抓到的
import { SYNC_API } from './cloud.js'
import { parseICS } from './ics.js'
import { addDays, dateStr } from './store/util.js'

const KEY = 'hiyori-ics'
export const ICS_EVERY = 30 * 60000
// 抓不到時隔多久再試
const ICS_RETRY = 5 * 60000
// 帶進來的範圍：前一週到之後三個月
export const ICS_PAST = 7
export const ICS_AHEAD = 90
// 一個行事曆最多帶幾筆（課表、輪班表展開後很多）
export const ICS_PER_CAL = 1500

// 錯誤代碼 → 給人看的話
export const ICS_TEXT = {
  'bad url': '網址看起來不對：要 https 或 webcal 開頭的行事曆網址（.ics）',
  'not ics': '這個網址不是行事曆檔，要用「iCal 格式」的那一個網址',
  'ics failed': '對方的伺服器拒絕了，網址可能過期或打錯了',
  'ics unreachable': '連不上那個網址，等一下再試',
  'ics too large': '行事曆檔太大了（超過 2 MB）',
  'too many requests': '抓得太頻繁了，等一分鐘再試',
  offline: '連不上網路，等一下再試',
}
export const icsText = (code) => ICS_TEXT[code] || `出了點狀況（${code}）`

// 字串 → 短的穩定代號（同一筆日程每次抓回來 id 都一樣）
const hash = (s) => {
  let h = 2166136261
  for (const c of String(s)) {
    h ^= c.codePointAt(0)
    h = Math.imul(h, 16777619)
  }
  let h2 = 5381
  for (const c of String(s)) h2 = (Math.imul(h2, 33) ^ c.codePointAt(0)) >>> 0
  return (h >>> 0).toString(36) + h2.toString(36)
}

function readCache() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}
function writeCache(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {}
}

// 解析好的一筆 → App 的日程（唯讀：id 開頭是 x-，ext 是哪一個行事曆；地點放在說明）
export function toEvent(cal, x) {
  return {
    id: `x-${cal.id}-${hash(x.uid)}`, ext: cal.id, title: x.title, date: x.date,
    start: x.allDay ? '00:00' : x.start, end: x.allDay ? '23:59' : x.end, allDay: !!x.allDay, endDate: x.endDate || '',
    note: x.location || '', color: cal.color, done: false, routineId: null,
  }
}
export const isExternal = (e) => typeof e?.id === 'string' && e.id.startsWith('x-')

export async function fetchCalendar(url, { today = dateStr(), fetcher = fetch } = {}) {
  let res
  try {
    res = await fetcher(`${SYNC_API}/v1/ics`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
  } catch {
    throw Object.assign(new Error('offline'), { code: 'offline' })
  }
  let body = null
  try {
    body = await res.json()
  } catch {}
  if (!res.ok || !body?.ok || typeof body.text !== 'string') {
    const code = body?.error || `http ${res.status}`
    throw Object.assign(new Error(code), { code })
  }
  return parseICS(body.text, { from: addDays(today, -ICS_PAST), to: addDays(today, ICS_AHEAD) })
}

// 回傳 { refresh({ force }), sync(), status(id) }。sync：行事曆的設定變了（新增、刪掉、開關、換顏色、同步拉回別台的）才重新套用、去抓
export function createCalendars(store, { fetcher = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  let cache = readCache()
  let running = null
  // 正在抓的時候又要抓（剛刪掉、剛加了一個）：等這一次做完再照最新的設定做一次
  let next = null
  let wantForce = false
  let sig = null
  const listeners = new Set()
  const changed = () => listeners.forEach((fn) => fn())
  const apply = () => {
    const list = []
    for (const c of store.state.calendars) {
      const got = cache[c.id]
      if (!c.on || !got || got.url !== c.url || !Array.isArray(got.events)) continue
      for (const e of got.events) list.push({ ...e, ext: c.id, color: c.color })
    }
    store.setExternal(list)
  }
  function refresh({ force = false } = {}) {
    if (running) {
      wantForce ||= force
      return (next ??= running.then(() => {
        next = null
        const f = wantForce
        wantForce = false
        return refresh({ force: f })
      }))
    }
    running = (async () => {
      const at = now()
      // 刪掉的行事曆、換了網址的：快取也清掉，而且馬上寫回（私密網址和日程不留在這台裝置上）
      const urls = new Map(store.state.calendars.map((c) => [c.id, c.url]))
      let fetched = false
      for (const id of Object.keys(cache)) {
        if (urls.get(id) === cache[id]?.url) continue
        delete cache[id]
        fetched = true
      }
      for (const c of store.state.calendars) {
        if (!c.on) continue
        const got = cache[c.id]
        const same = got && got.url === c.url
        if (!force && same && at - got.at < (got.error ? ICS_RETRY : ICS_EVERY)) continue
        fetched = true
        cache[c.id] = { ...(same ? got : { events: [] }), loading: true }
        changed()
        try {
          const r = await fetchCalendar(c.url, { today: store.today, fetcher })
          const events = r.events.slice(0, ICS_PER_CAL).map((x) => toEvent(c, x))
          cache[c.id] = { at, url: c.url, name: r.name, events, error: '', count: r.events.length }
          // 還沒取名字的：用行事曆自己的名字
          if (!c.name && r.name) store.updateCalendar(c.id, { name: r.name })
        } catch (e) {
          // 抓不到：留著上一次抓到的
          cache[c.id] = { ...(same ? got : { events: [] }), at, url: c.url, error: e?.code || 'error', loading: false }
        }
      }
      if (fetched) writeCache(cache)
      apply()
      changed()
    })().finally(() => (running = null))
    return running
  }
  const sync = () => {
    const next = JSON.stringify(store.state.calendars.map((c) => [c.id, c.url, c.on, c.color]))
    if (next === sig) return
    sig = next
    apply()
    refresh()
  }
  return {
    refresh,
    sync,
    status: (id) => cache[id] || null,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
