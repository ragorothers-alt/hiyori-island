// 匯入的行事曆：照 state.calendars 的網址經過 Worker（/v1/ics）抓回 .ics、解析（src/ics.js），變成唯讀的日程放進 store.external。
// 抓回來的放在這台裝置（localStorage），不存進小島的資料、不同步：每台自己抓（私人網址也不會多一份在別的地方）。
// 打開 App、回到 App、每隔一陣子看一次，超過 30 分鐘沒抓就再抓；設定裡可以馬上抓。抓不到時留著上一次抓到的
import { SYNC_API } from './cloud.js'
import { parseICS } from './ics.js'
import { addDays, dateStr } from './store/util.js'
import { calUrlOk } from './store/migrate.js'

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
  'not ics': '這個網址沒有提供行事曆檔。請到原本的行事曆複製 iCal 訂閱網址。',
  'ics failed': '對方的伺服器拒絕了，網址可能過期或打錯了',
  'ics missing': '找不到這份行事曆了。請確認它還在，再複製新的 iCal 網址。',
  'ics denied': '這個行事曆沒有開放讀取。請確認分享設定，或換成私密 iCal 網址。',
  'ics unavailable': '行事曆網站暫時無法回應，過一會兒再試。',
  'ics unreachable': '連不上行事曆網站。請確認來源網站能打開，再按更新。',
  'ics partial': '這次抓到的行事曆不完整（中途斷掉了），先留著上一次的，等一下再按更新。',
  'ics too large': '行事曆檔太大了（超過 2 MB）',
  'too many requests': '抓得太頻繁了，等一分鐘再試',
  offline: '連不上匯入服務。請確認網路連線，再按更新。',
}
function statusCode(status, fallback) {
  if (status === 404 || status === 410) return 'ics missing'
  if (status === 401 || status === 403) return 'ics denied'
  if (status === 429) return 'too many requests'
  if (status >= 500) return 'ics unavailable'
  if (status >= 200 && status < 300) return 'not ics'
  return fallback
}

export function icsText(code) {
  // 舊版抓到空回應時會存「http 200」，連帶把舊訊息換成看得懂的原因。
  const status = /^http (\d{3})$/i.exec(code)
  const key = status ? statusCode(Number(status[1]), '') : code
  return ICS_TEXT[key] || '暫時拿不到行事曆。請確認訂閱網址，再按更新。'
}

// 網址裡像私密金鑰的那一段只留開頭（畫面上、截圖裡不會整串露出來）：字母數字加起來 16 個以上的整段收起來，
// 短一點的裡面有 8 個以上連著、夾著數字的也收起來。看得懂的短名字（class-a.ics、basic.ics、music）照樣看得到
const maskSeg = (seg) => {
  if (seg.replace(/[^A-Za-z0-9]/g, '').length >= 16) return `${seg.slice(0, 3)}…`
  return seg.replace(/[A-Za-z0-9_]{8,}/g, (run) => (/\d/.test(run) ? `${run.slice(0, 3)}…` : run))
}
function calendarPath(url) {
  try {
    const { host, pathname } = new URL(url)
    return host + pathname.split('/').map(maskSeg).join('/')
  } catch {
    return '行事曆網址'
  }
}
// 路徑一樣、靠參數選班級的課表：只秀看得懂的那種參數（group=choir），值像金鑰的不秀
function readableParam(url, same) {
  try {
    const params = new URL(url).searchParams
    const hit = [...params].find(([key, value]) =>
      /^(group|class|course|name)$/i.test(key) && value.length <= 24 && maskSeg(value) === value &&
      same.every((other) => new URL(other).searchParams.get(key) !== value))
    return hit ? `?${hit[0]}=${hit[1]}` : ''
  } catch {
    return ''
  }
}
function baseLabel(url, urls) {
  let path = calendarPath(url)
  const others = urls.filter((other) => other !== url)
  const samePath = others.filter((other) => calendarPath(other) === path)
  if (path !== '行事曆網址' && samePath.length) path += readableParam(url, samePath)
  if (path.length <= 48) return path
  const head = path.slice(0, 25)
  const tail = path.slice(-22)
  // 如果只差在被省略的那一段，把不同的字留在中間。
  let difference = 0
  for (const otherUrl of others) {
    const other = calendarPath(otherUrl)
    if (other === path || !other.startsWith(head) || !other.endsWith(tail)) continue
    let i = head.length
    while (i < path.length && other[i] === path[i]) i++
    difference = Math.max(difference, i)
  }
  if (difference) return path.slice(0, 16) + '…' + path.slice(difference - 4, difference + 10) + '…' + path.slice(-16)
  return head + '…' + tail
}
// 設定列上認行事曆用的那一行：遮好、截短之後還跟另一個一樣的，再加一個固定的來源代號
export function calendarLabel(url, urls = []) {
  const label = baseLabel(url, urls)
  const clash = urls.some((other) => other !== url && baseLabel(other, urls) === label)
  return clash ? `${label}（來源 ${hash(url).slice(0, 5)}）` : label
}

export function replaceCalendarUrl(store, id, value) {
  const url = value.trim()
  const calendar = store.state.calendars.find((c) => c.id === id)
  if (!calendar) return { error: '這個行事曆已經刪掉了' }
  if (url === calendar.url) return { calendar }
  if (!calUrlOk(url)) return { error: icsText('bad url') }
  if (store.state.calendars.some((c) => c.url === url)) return { error: '這個網址已經加過了' }
  // 同一筆換網址（id、名字、顏色、開關不變；兩台同步時也還是同一筆，不會一筆變兩筆）
  if (!store.updateCalendar(id, { url })) return { error: '網址沒換成，請再試一次' }
  return { calendar }
}

// 行事曆檔有沒有完整：最後有 END:VCALENDAR、每個 BEGIN:VEVENT 都有 END:VEVENT
export function icsComplete(text) {
  const count = (re) => (String(text).match(re) || []).length
  return /^END:VCALENDAR\s*$/im.test(text) && count(/^BEGIN:VEVENT\s*$/gim) === count(/^END:VEVENT\s*$/gim)
}

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
  if (!res.ok || !body?.ok || typeof body.text !== 'string' || !/^\s*BEGIN:VCALENDAR\s*$/im.test(body.text.slice(0, 4000))) {
    const code = body?.error === 'ics failed' ? statusCode(body.status, 'ics failed') : body?.error || statusCode(res.status, 'error')
    throw Object.assign(new Error(code), { code })
  }
  // 中途斷掉的（沒有結尾、日程開了沒關）：不收，留著上一次抓到的（不然會換成少了一大半、甚至空的）
  if (!icsComplete(body.text)) throw Object.assign(new Error('ics partial'), { code: 'ics partial' })
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
