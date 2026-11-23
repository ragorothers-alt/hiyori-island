// Google 日曆同步：App 的日程、任務 ↔ Google 上「ひより日和」日曆裡的活動。這裡只有純函式（換格式、比對、決定要做什麼），
// 呼叫 Google、動 App 的資料在 src/gcal.js。
//
// 三種（kind）：e 日程（跨過午夜的兩段寫成一個活動）、t 排了時段的任務、d 有截止日的任務（截止那天一個全天的活動）。
// Google 那邊的 id（gid）由 kind 和 App 的 id 算出來：幾台裝置同時寫也不會一筆變兩筆。在 Google 那邊新增、帶進 App 的日程，
// App 的 id 是 gc-<gid>，反過來算回同一個 gid。
// 寫進 Google 時在活動的 extendedProperties.private 記下 kind、App 的 id（hid）、寫進去的內容的指紋（sig）、做完了沒（done）。
// 誰改過靠三方比對：每台裝置記著「上次兩邊對好時，App 和 Google 各是哪個指紋」（base，src/gcal.js 存在這台），
//   App 的跟 base 不一樣＝這台的 App 改過；Google 的不一樣＝在 Google（或別台）改過；兩邊都改了，用比較晚改的那一邊。
// 這台還沒對過的（剛連上、換了裝置）才拿活動上記著的 sig 當基準；這台的 App 沒有、也沒對過的一律不刪
// （可能是別台剛加、這台還沒從線上同步拿到）。
import { PROJECT_LIMITS as PL } from './projects.js'
import { addDays, toMin, minToHHMM, overnight, isSampleId } from './store/util.js'
import { floating, allDayEnd } from './store/migrate.js'

export const KINDS = ['e', 't', 'd']
// 管多久以前的：開始在這之前的不寫、不改、不刪（Google 上留著當紀錄）
export const GCAL_PAST = 30
export const CAL_NAME = 'ひより日和'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const APP_ID = /^[\w-]{1,40}$/
// Google 活動 id 的格式：base32hex 的小寫字母和數字，5～1024 個字
export const GID = /^[0-9a-v]{5,1024}$/
// 在 Google 新增的日程帶進 App 時的 id（gc- 後面接 gid；App 的 id 最長 40 個字）
const IMPORTED = /^gc-([0-9a-v]{5,37})$/

const B32 = '0123456789abcdefghijklmnopqrstuv'
export function b32(s) {
  let out = ''
  let bits = 0
  let val = 0
  for (const byte of new TextEncoder().encode(s)) {
    val = ((val << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}
// App 的 id → Google 的 id
export function gidOf(k, id) {
  const m = k === 'e' && IMPORTED.exec(id)
  return m ? m[1] : b32(`${k}:${id}`)
}
// 在 Google 新增的那一筆帶進 App 時用的 id（太長的帶不進來：null）
export const importId = (gid) => (/^[0-9a-v]{5,37}$/.test(gid) ? `gc-${gid}` : null)

// 指紋：同一份內容每台算出來都一樣（鍵的順序固定），不用加密強度
export function sigOf(c) {
  const s = JSON.stringify(c)
  let a = 0x811c9dc5
  let b = 0x9747b28c
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    a = Math.imul(a ^ ch, 16777619) >>> 0
    b = Math.imul(b ^ ch, 2246822519) >>> 0
  }
  return a.toString(36) + b.toString(36)
}

// 兩邊比對前先整理成一樣的寫法（多餘的空白、換行符號、長度上限照 App 的）
const title = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 120).trim()
// 備註：兩邊都先換成純文字（App 備註裡寫的 <b> 寫進 Google 再讀回來是同一個樣子，不會以為在 Google 改過）
const note = (v) => plain(v).replace(/\r\n?/g, '\n').trim().slice(0, PL.taskNote).trim()

// 每一種的內容（鍵的順序固定：指紋要一樣）
const eventC = ({ title: t, date, start, end, allDay, endDate, note: n }) =>
  allDay
    ? { k: 'e', title: title(t), date, start: '', end: '', allDay: true, endDate: allDayEnd(endDate, date), note: note(n) }
    : { k: 'e', title: title(t), date, start, end, allDay: false, endDate: '', note: note(n) }
const slotC = ({ title: t, date, start, end, done, note: n }) => ({ k: 't', title: title(t), date, start, end, done: !!done, note: note(n) })
const dueC = ({ title: t, date, done, note: n }) => ({ k: 'd', title: title(t), date, done: !!done, note: note(n) })

// 任務的時段：開始＋預估長度（沒填當 30 分鐘），過了午夜截到 23:59
export function slotEnd(at, dur) {
  const m = toMin(at) + (Number(dur) > 0 ? Number(dur) : 30)
  return m >= 1440 ? '23:59' : minToHHMM(m)
}

// ── App → 要寫進 Google 的樣子 ──
// 回傳 { items: Map(gid → { k, id, c, sig, old }), has(k, id) }：old＝開始在 past 天以前（不管它）。
// has：App 裡還有沒有這個日程／任務（不管有沒有時段、截止日、多久以前）
export function appItems(state, { today, past = GCAL_PAST }) {
  const cut = addDays(today, -past)
  const items = new Map()
  const put = (k, id, c, date) => {
    const sig = sigOf(c)
    items.set(gidOf(k, id), { k, id, c, sig, old: date < cut })
  }
  const eventIds = new Set()
  const groups = new Map()
  for (const e of state.events || []) {
    if (!e || typeof e.id !== 'string' || !APP_ID.test(e.id) || isSampleId(e.id) || !DATE.test(e.date)) continue
    eventIds.add(e.id)
    const key = e.link ? `l:${e.link}` : `i:${e.id}`
    const g = groups.get(key)
    if (g) g.push(e)
    else groups.set(key, [e])
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date))
    const head = list[0]
    const end = list.length > 1 ? list.at(-1).end : head.end
    if (!head.allDay && (!TIME.test(head.start) || !TIME.test(end))) continue
    put('e', head.id, eventC({ ...head, end }), head.date)
  }
  const taskIds = new Set()
  for (const t of state.tasks || []) {
    if (!t || typeof t.id !== 'string' || !APP_ID.test(t.id) || isSampleId(t.id)) continue
    taskIds.add(t.id)
    if (!floating(t) && TIME.test(t.at) && DATE.test(t.date)) put('t', t.id, slotC({ title: t.title, date: t.date, start: t.at, end: slotEnd(t.at, t.dur), done: t.done, note: t.note }), t.date)
    if (DATE.test(t.due)) put('d', t.id, dueC({ title: t.title, date: t.due, done: t.done, note: t.note }), t.due)
  }
  return { items, has: (k, id) => (k === 'e' ? eventIds : taskIds).has(id) }
}

// ── 內容 → Google 活動 ──
function timed(date, start, end, tz) {
  let endDate = date
  let endTime = end
  if (end === '23:59') {
    endDate = addDays(date, 1)
    endTime = '00:00'
  } else if (toMin(end) <= toMin(start)) {
    if (overnight(start, end)) endDate = addDays(date, 1)
    else endTime = minToHHMM(Math.min(toMin(start) + 30, 1439))
  }
  return { start: { dateTime: `${date}T${start}:00`, timeZone: tz }, end: { dateTime: `${endDate}T${endTime}:00`, timeZone: tz } }
}
export function summaryOf(c) {
  if (c.k === 't') return `${c.done ? '✓ ' : ''}${c.title}`
  if (c.k === 'd') return `${c.done ? '✓ ' : ''}截止：${c.title}`
  return c.title
}
export function toGoogle(c, { id, sig, tz }) {
  const allDay = c.k === 'd' || (c.k === 'e' && c.allDay)
  const when = allDay
    ? { start: { date: c.date }, end: { date: addDays(c.k === 'd' ? c.date : c.endDate || c.date, 1) } }
    : timed(c.date, c.start, c.end, tz)
  return {
    summary: summaryOf(c),
    description: c.note,
    ...when,
    status: 'confirmed',
    // 截止日不佔時間（別人看你有沒有空時不算）
    transparency: c.k === 'd' ? 'transparent' : 'opaque',
    // App 自己會提醒：Google 那邊不再響一次
    reminders: { useDefault: false },
    extendedProperties: { private: { hiyori: c.k, hid: id, sig, ...(c.k === 'e' ? {} : { done: c.done ? '1' : '0' }) } },
  }
}

// ── Google 活動 → 內容 ──
const zones = new Map()
// 某個時間點在 tz 是哪一天、幾點幾分
export function local(ms, tz) {
  let f = zones.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    zones.set(tz, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}
// 在 Google 網頁上改過說明會變成 HTML：換回純文字（只認 Google 會用的那幾種標籤：備註裡寫的 <待確認> 不算）
const HTML = /<\/?(br|p|div|span|b|i|u|strong|em|a|ul|ol|li|html-blob)\b[^>]*>/i
const TAGS = new RegExp(HTML.source, 'gi')
export function plain(v) {
  const s = String(v ?? '')
  if (!HTML.test(s)) return s
  // 只拿掉那幾種標籤（「<API>」這種寫在備註裡的留著）
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(TAGS, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
// 時間點：帶著時差的照它；沒帶的（只有 timeZone）照那個時區的牆上時間換算，不照這台裝置的時區
const OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i
const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
const zoneOk = (z) => {
  try {
    return typeof z === 'string' && !!z && !!local(0, z)
  } catch {
    return false
  }
}
export function instant(dt, zone) {
  if (typeof dt !== 'string') return NaN
  if (OFFSET.test(dt)) return Date.parse(dt)
  const m = WALL.exec(dt)
  if (!m) return NaN
  // 先當成 UTC，再照那個時區差多少拉回來（日光節約時間前後再對一次）。local 只到分鐘：秒數最後加回去
  const wall = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])
  let t = wall
  for (let i = 0; i < 2; i++) {
    const l = local(t, zone)
    t += wall - Date.parse(`${l.date}T${l.time}:00Z`)
  }
  return t + Number(m[6] || 0) * 1000
}
// 活動的時間 → { date, start, end, allDay, endDate }（看不懂的是 null）
export function spanOf(ev, tz) {
  if (DATE.test(ev?.start?.date)) {
    const date = ev.start.date
    const endEx = DATE.test(ev.end?.date) ? ev.end.date : ''
    return { allDay: true, date, start: '', end: '', endDate: endEx > date ? addDays(endEx, -1) : date }
  }
  const zs = zoneOk(ev?.start?.timeZone) ? ev.start.timeZone : tz
  const ze = zoneOk(ev?.end?.timeZone) ? ev.end.timeZone : zs
  const s = instant(ev?.start?.dateTime, zs)
  if (!Number.isFinite(s)) return null
  const e0 = instant(ev?.end?.dateTime, ze)
  const e = Number.isFinite(e0) && e0 > s ? e0 : s + 30 * 60000
  const a = local(s, tz)
  const b = local(e, tz)
  const next = addDays(a.date, 1)
  let end
  // 不到一分鐘的：至少 30 分鐘（App 的時段結束要在開始之後）
  if (b.date === a.date && b.time <= a.time) end = minToHHMM(Math.min(toMin(a.time) + 30, 1439))
  else if (b.date === a.date) end = b.time
  // 隔天 00:00 結束＝到午夜；跨過午夜、不超過 16 小時的照實（App 存成連著的兩段；照牆上的時間算，跟 App 的規則一樣），再長的截到午夜
  else if (b.date === next && b.time !== '00:00' && overnight(a.time, b.time)) end = b.time
  else end = '23:59'
  return { allDay: false, date: a.date, start: a.time, end, endDate: '' }
}

// 一個 Google 活動 → 比對用的樣子：
// { gid, k, hid, b（寫進去時的指紋）, c（內容）, h（內容的指紋）, date, updated, cancelled, foreign（在 Google 新增的）, rec（重複的）, bad }
export function fromGoogle(ev, tz) {
  const p = ev?.extendedProperties?.private || {}
  const k = KINDS.includes(p.hiyori) ? p.hiyori : null
  const hid = k && typeof p.hid === 'string' && APP_ID.test(p.hid) ? p.hid : null
  const base = {
    gid: String(ev?.id || ''),
    k: hid ? k : 'e',
    hid,
    b: hid && typeof p.sig === 'string' ? p.sig.slice(0, 40) : '',
    foreign: !hid,
    updated: Date.parse(ev?.updated) || 0,
    etag: typeof ev?.etag === 'string' ? ev.etag : '',
    rec: !!(ev?.recurrence?.length || ev?.recurringEventId),
  }
  if (ev?.status === 'cancelled') return { ...base, cancelled: true, c: null, h: '', date: '' }
  const when = spanOf(ev, tz)
  if (!when) return { ...base, bad: true, c: null, h: '', date: '' }
  let t = String(ev.summary ?? '').trim()
  // 做完了沒看記號（標題前面的 ✓ 只是給人看的）：拿掉的也只拿掉 App 加上去的那一個，標題本來就是 ✓ 開頭的不動
  const done = p.done === '1'
  if (base.k === 't' || base.k === 'd') {
    if (done && t.startsWith('✓ ')) t = t.slice(2)
    if (base.k === 'd' && t.startsWith('截止：')) t = t.slice(3)
  }
  t = title(t) || '（沒有標題）'
  const n = plain(ev.description)
  let c
  if (base.k === 't') c = slotC({ title: t, date: when.date, start: when.allDay ? '' : when.start, end: when.allDay ? '' : when.end === '23:59' || toMin(when.end) > toMin(when.start) ? when.end : '23:59', done, note: n })
  else if (base.k === 'd') c = dueC({ title: t, date: when.date, done, note: n })
  else c = eventC({ title: t, note: n, ...when })
  return { ...base, c, h: sigOf(c), date: c.date }
}

// ── 決定要做什麼 ──
// app：appItems 的 items；has：appItems 的 has；remote：Map(gid → fromGoogle 的樣子)；
// base：這台上次兩邊對好的樣子 Map(gid → { s: App 的指紋, g: Google 的指紋 })，null＝那一邊沒有這一筆；
// appAt：App 這一筆是什麼時候改的（gid → 毫秒，或一個數字：整份資料最後改的時間），兩邊都改了時比；cut：多久以前的不管。
// 回傳 { push, del, mark, apply, agree }：
//   push：{ gid, k, id, c, sig, exists, etag }  寫進 Google（exists：Google 上有這個 id，含已刪掉的）
//   del：{ gid, etag }                          從 Google 刪掉（App 刪了、Google 那邊沒再改過）
//   mark：{ gid, k, id, sig, done, etag }       內容一樣，只更新活動上記著的指紋
//   apply：{ gid, k, id, op, c, cur, g, quiet }  把 Google 的改動帶進 App（op：set 改、del 刪、add 加；cur：App 現在的樣子，只改不一樣的欄位；
//                                               quiet：其實是別台的 App 改的，不用說）
//   agree：{ gid, s, g }                        兩邊本來就一樣：記成新的 base
export function plan({ app, has, remote, base = new Map(), appAt = 0, cut = '' }) {
  const out = { push: [], del: [], mark: [], apply: [], agree: [] }
  const at = typeof appAt === 'function' ? appAt : () => appAt
  const push = (gid, a, r) => out.push.push({ gid, k: a.k, id: a.id, c: a.c, sig: a.sig, exists: !!r, etag: r?.etag || '' })
  // quiet：Google 上的內容就是某一台 App 寫上去的（活動上記著的指紋對得上）＝別台的 App 改的，不是在 Google 上改的
  const take = (gid, k, id, op, r, a) =>
    // 要帶進來卻沒有內容（記著的被清掉了）：這一次先不動，下次從頭拿清單時就有了
    (op === 'del' || r.c) &&
    out.apply.push({ gid, k, id, op, c: r.cancelled ? null : r.c, cur: a?.c || null, g: r.cancelled ? null : r.h, quiet: !r.cancelled && !r.foreign && !!r.b && r.b === r.h, u: r.updated || 0 })
  // 在 Google 加的、或 App 這邊已經沒有了：帶進 App（日程加回去；任務還在的放回時段、截止日）
  const bring = (gid, r) => {
    if (r.k === 'e') {
      const id = r.hid || importId(gid)
      if (id && !has('e', id)) take(gid, 'e', id, 'add', r, null)
    } else if (r.hid && has(r.k, r.hid)) take(gid, r.k, r.hid, 'set', r, null)
  }
  for (const gid of new Set([...app.keys(), ...remote.keys()])) {
    const a = app.get(gid)
    const r = remote.get(gid)
    if (a?.old) continue
    // 看不懂的、在 Google 改成重複的：不動（App 表示不了重複的活動）
    if (r && (r.rec || r.bad)) continue
    if (!r) {
      const bs = base.get(gid)
      // Google 上本來有（這台對過）、現在整筆不見了（永久刪掉，從頭拿清單時沒有了）：App 沒再改過就跟著刪
      if (a && bs && bs.g !== null && a.sig === bs.s) out.apply.push({ gid, k: a.k, id: a.id, op: 'del', c: null, cur: a.c, g: null, quiet: false, u: 0 })
      else if (a) push(gid, a, r)
      continue
    }
    const aS = a ? a.sig : null
    const gS = r.cancelled ? null : r.h
    if (aS === gS) {
      out.agree.push({ gid, s: aS, g: gS })
      if (a && (r.b !== aS || r.foreign)) out.mark.push({ gid, k: a.k, id: a.id, sig: aS, done: !!a.c.done, etag: r.etag || '' })
      continue
    }
    if (!a && r.date && r.date < cut) continue
    // 任務的時段在 Google 上改成了整天（App 表示不了），App 這邊已經沒有時段了（這台、或別台帶進來時拿掉的）：
    // 兩邊都不動，不從 Google 刪掉那個整天的活動
    if (!a && r.k === 't' && !r.cancelled && r.c && !r.c.start && r.hid && has('t', r.hid)) {
      out.agree.push({ gid, s: null, g: gS })
      continue
    }
    const bs = base.get(gid)
    if (!bs) {
      // 這台還沒跟它對過：App 這邊沒有的不動（可能是別台剛加、這台還沒同步到），只把在 Google 新增的帶進來
      if (!a) {
        if (!r.cancelled && r.foreign) bring(gid, r)
        continue
      }
      // App 有：App 還是上次寫進去的樣子（活動上記著的指紋）＝在 Google 改過；不然看誰比較晚改
      // （Google 上是某一台寫的樣子也一樣比時間：這台的 App 可能是舊的，還沒拿到別台剛寫的）
      if (r.b && !r.foreign && r.b === aS) take(gid, a.k, a.id, r.cancelled ? 'del' : 'set', r, a)
      else if (r.updated > at(gid)) take(gid, a.k, a.id, r.cancelled ? 'del' : 'set', r, a)
      else push(gid, a, r)
      continue
    }
    const appCh = aS !== bs.s
    const gCh = gS !== bs.g
    // 兩邊都沒再改，只是寫法不一樣（Google 上改成了 App 表示不了的樣子）：不來回改
    if (!appCh && !gCh) continue
    if (gCh && (!appCh || r.updated > at(gid))) {
      if (r.cancelled) {
        if (a) take(gid, a.k, a.id, 'del', r, a)
      } else if (a) take(gid, a.k, a.id, 'set', r, a)
      // 任務整件刪掉了：時段、截止日放不回去，從 Google 刪掉
      else if (r.k !== 'e' && !(r.hid && has(r.k, r.hid))) out.del.push({ gid, etag: r.etag || '' })
      else bring(gid, r)
    } else if (a) push(gid, a, r)
    else if (!r.cancelled) out.del.push({ gid, etag: r.etag || '' })
  }
  return out
}
