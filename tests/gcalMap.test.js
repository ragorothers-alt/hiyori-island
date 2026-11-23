import { describe, expect, it } from 'vitest'
import { appItems, b32, fromGoogle, gidOf, GID, importId, plain, plan, sigOf, slotEnd, spanOf, toGoogle } from '../src/gcalMap.js'

const TZ = 'Asia/Taipei'
const TODAY = '2026-11-23'
// 照 Google 的樣子回傳（多了 id、updated；時間換成帶時區的寫法）
function asGoogle(c, id, extra = {}) {
  const gid = gidOf(c.k, id)
  const ev = { id: gid, updated: '2026-11-23T01:00:00Z', ...toGoogle(c, { id, sig: sigOf(c), tz: TZ }), ...extra }
  for (const k of ['start', 'end']) if (ev[k].dateTime) ev[k] = { dateTime: `${ev[k].dateTime}+08:00`, timeZone: TZ }
  return ev
}

describe('Google 日曆的 id', () => {
  it('同一筆每次算出來都一樣、是 Google 收的格式；不同種類不會撞在一起', () => {
    expect(gidOf('e', 'abc123')).toBe(gidOf('e', 'abc123'))
    expect(gidOf('e', 'abc123')).not.toBe(gidOf('t', 'abc123'))
    for (const id of ['a', 'mk2x9q7f1z', 'ex-task-1', 'x'.repeat(40)]) expect(gidOf('t', id)).toMatch(GID)
    expect(b32('f')).toBe('co')
  })
  it('在 Google 新增、帶進 App 的日程（gc-）算回同一個 id；太長的不帶', () => {
    expect(importId('abcde12345')).toBe('gc-abcde12345')
    expect(gidOf('e', 'gc-abcde12345')).toBe('abcde12345')
    expect(importId('a'.repeat(38))).toBe(null)
    expect(importId('ABC')).toBe(null)
  })
})

describe('App → 要寫進 Google 的樣子', () => {
  const state = {
    events: [
      { id: 'e1', title: '  開會  ', date: TODAY, start: '09:00', end: '10:00', note: '帶筆電\r\n' },
      // 跨過午夜的兩段：一個活動
      { id: 'n1', title: '夜班', date: TODAY, start: '23:00', end: '23:59', link: 'L1' },
      { id: 'n2', title: '夜班', date: '2026-11-24', start: '00:00', end: '02:00', link: 'L1' },
      { id: 'a1', title: '旅行', date: '2026-11-25', start: '00:00', end: '23:59', allDay: true, endDate: '2026-11-27' },
      { id: 'ex-1', title: '範例', date: TODAY, start: '08:00', end: '09:00' },
      { id: 'old', title: '很久以前', date: '2026-09-01', start: '08:00', end: '09:00' },
    ],
    tasks: [
      { id: 't1', title: '寫報告', date: TODAY, at: '14:00', dur: 90, due: '2026-11-30', done: false, note: '' },
      { id: 't2', title: '晚上讀書', date: TODAY, at: '23:40', dur: null, done: true },
      // 長期任務（還沒做完）：沒有時段，但截止日照樣寫
      { id: 't3', title: '練曲子', date: TODAY, at: '10:00', ongoing: true, due: '2026-12-10' },
    ],
  }
  const { items, has } = appItems(state, { today: TODAY })
  const get = (k, id) => items.get(gidOf(k, id))
  it('日程：跨過午夜的寫成一個（開始那天到隔天）；整天的照最後一天；範例不寫；太久以前的標成 old', () => {
    expect(get('e', 'e1').c).toEqual({ k: 'e', title: '開會', date: TODAY, start: '09:00', end: '10:00', allDay: false, endDate: '', note: '帶筆電' })
    expect(get('e', 'n1').c).toMatchObject({ date: TODAY, start: '23:00', end: '02:00' })
    expect(get('e', 'n2')).toBeUndefined()
    expect(get('e', 'a1').c).toMatchObject({ allDay: true, start: '', end: '', endDate: '2026-11-27' })
    expect(get('e', 'ex-1')).toBeUndefined()
    expect(get('e', 'old').old).toBe(true)
    expect(has('e', 'n2')).toBe(true)
    expect(has('e', 'nope')).toBe(false)
  })
  it('任務：排了時段的（長度沒填算 30 分鐘、過了午夜截到 23:59）、有截止日的各一筆；長期任務只寫截止日', () => {
    expect(get('t', 't1').c).toMatchObject({ k: 't', date: TODAY, start: '14:00', end: '15:30', done: false })
    expect(get('d', 't1').c).toMatchObject({ k: 'd', date: '2026-11-30' })
    expect(get('t', 't2').c).toMatchObject({ start: '23:40', end: '23:59', done: true })
    expect(get('t', 't3')).toBeUndefined()
    expect(get('d', 't3').c.date).toBe('2026-12-10')
    expect(slotEnd('10:00', 0)).toBe('10:30')
  })
  it('寫進 Google 再讀回來是同一個樣子（指紋一樣）：跨午夜、到午夜、整天、做完的、截止日', () => {
    for (const [k, id] of [['e', 'e1'], ['e', 'n1'], ['e', 'a1'], ['t', 't1'], ['t', 't2'], ['d', 't1']]) {
      const a = get(k, id)
      const r = fromGoogle(asGoogle(a.c, id), TZ)
      expect(r.c, `${k}:${id}`).toEqual(a.c)
      expect(r.h).toBe(a.sig)
      expect(r.b).toBe(a.sig)
      expect(r.hid).toBe(id)
    }
    const g = asGoogle(get('e', 'n1').c, 'n1')
    expect(g.end.dateTime).toBe('2026-11-24T02:00:00+08:00')
    expect(toGoogle(get('t', 't2').c, { id: 't2', sig: 's', tz: TZ }).end.dateTime).toBe('2026-11-24T00:00:00')
    expect(toGoogle(get('d', 't1').c, { id: 't1', sig: 's', tz: TZ })).toMatchObject({ summary: '截止：寫報告', start: { date: '2026-11-30' }, end: { date: '2026-12-01' }, transparency: 'transparent' })
    expect(asGoogle(get('t', 't2').c, 't2').summary).toBe('✓ 晚上讀書')
  })
})

describe('Google 活動 → App 的樣子', () => {
  it('別的時區寫的時間換成這裡的；隔天 00:00 結束是到午夜；跨好幾天的截到午夜', () => {
    expect(spanOf({ start: { dateTime: '2026-11-24T01:00:00Z' }, end: { dateTime: '2026-11-24T02:30:00Z' } }, TZ)).toEqual({ allDay: false, date: '2026-11-24', start: '09:00', end: '10:30', endDate: '' })
    expect(spanOf({ start: { dateTime: '2026-11-24T20:00:00+08:00' }, end: { dateTime: '2026-11-25T00:00:00+08:00' } }, TZ).end).toBe('23:59')
    expect(spanOf({ start: { dateTime: '2026-11-24T09:00:00+08:00' }, end: { dateTime: '2026-11-26T10:00:00+08:00' } }, TZ).end).toBe('23:59')
    expect(spanOf({ start: { date: '2026-11-24' }, end: { date: '2026-11-25' } }, TZ)).toMatchObject({ allDay: true, endDate: '2026-11-24' })
    expect(spanOf({ start: {} }, TZ)).toBe(null)
    // 不到一分鐘的：至少 30 分鐘
    expect(spanOf({ start: { dateTime: '2026-11-24T10:00:00+08:00' }, end: { dateTime: '2026-11-24T10:00:30+08:00' } }, TZ).end).toBe('10:30')
  })
  it('在 Google 新增的（沒有記號）是 foreign、算成日程；重複的、刪掉的標出來；任務的 ✓ 和「截止：」拿掉', () => {
    const f = fromGoogle({ id: 'abcde12345', summary: '看牙醫', start: { dateTime: '2026-11-24T15:00:00+08:00' }, end: { dateTime: '2026-11-24T16:00:00+08:00' } }, TZ)
    expect(f).toMatchObject({ foreign: true, k: 'e', hid: null, b: '', c: { title: '看牙醫', start: '15:00', end: '16:00' } })
    expect(fromGoogle({ id: 'x1234', summary: 'r', recurrence: ['RRULE:FREQ=DAILY'], start: { date: TODAY }, end: { date: '2026-11-24' } }, TZ).rec).toBe(true)
    expect(fromGoogle({ id: 'x1234', status: 'cancelled' }, TZ)).toMatchObject({ cancelled: true, c: null })
    const d = fromGoogle({ id: 'd1234', summary: '✓ 截止：交作業', start: { date: TODAY }, end: { date: '2026-11-24' }, extendedProperties: { private: { hiyori: 'd', hid: 't9', sig: 'x', done: '1' } } }, TZ)
    expect(d.c).toMatchObject({ k: 'd', title: '交作業', done: true })
    // 做完了沒看記號：標題本來就是 ✓ 開頭、還沒做完的不會被拿掉
    const own = fromGoogle({ id: 't1234', summary: '✓ 檢查清單', start: { dateTime: '2026-11-24T09:00:00+08:00' }, end: { dateTime: '2026-11-24T09:30:00+08:00' }, extendedProperties: { private: { hiyori: 't', hid: 't8', sig: 'x', done: '0' } } }, TZ)
    expect(own.c).toMatchObject({ title: '✓ 檢查清單', done: false })
  })
  it('在 Google 網頁上改過的說明（HTML）換回純文字', () => {
    expect(plain('第一行<br>第二行 &amp; <b>粗</b>')).toBe('第一行\n第二行 & 粗')
    expect(plain('a < b')).toBe('a < b')
    // 備註裡自己寫的尖括號不是 HTML
    expect(plain('看 <API> 文件、寄給 <user@example.com>')).toBe('看 <API> 文件、寄給 <user@example.com>')
  })
})

describe('決定要做什麼', () => {
  const c0 = { k: 'e', title: '開會', date: TODAY, start: '09:00', end: '10:00', allDay: false, endDate: '', note: '' }
  const c1 = { ...c0, start: '11:00', end: '12:00' }
  const c2 = { ...c0, title: '開會（改地點）' }
  const gid = gidOf('e', 'e1')
  const S = sigOf
  const A = (c) => new Map([[gid, { k: 'e', id: 'e1', c, sig: S(c), old: false }]])
  // b：活動上記著的指紋（上次某一台寫上去的）
  const R = (c, b, extra = {}) => new Map([[gid, { gid, k: 'e', hid: 'e1', b: b ? S(b) : '', c, h: c ? S(c) : '', date: c?.date || TODAY, updated: 100, etag: '"1"', ...extra }]])
  // base：這台上次兩邊對好的樣子
  const B = (s, g) => new Map([[gid, { s: s ? S(s) : null, g: g ? S(g) : null }]])
  const has = (k, id) => id === 'e1'
  const none = () => false
  const run = (o) => plan({ has, appAt: 50, cut: '2026-10-24', ...o })
  const nothing = { push: [], del: [], mark: [], apply: [], agree: [] }
  it('Google 上還沒有：寫上去；一樣的記成對好了；只差活動上記著的指紋：更新指紋', () => {
    expect(run({ app: A(c0), remote: new Map() }).push).toMatchObject([{ gid, exists: false }])
    expect(run({ app: A(c0), remote: R(c0, c0) })).toEqual({ ...nothing, agree: [{ gid, s: S(c0), g: S(c0) }] })
    expect(run({ app: A(c0), remote: R(c0, c1) }).mark).toMatchObject([{ gid, sig: S(c0), etag: '"1"' }])
  })
  it('這台的 App 改了：寫上去（帶 etag，Google 那邊之後又改過就不蓋）；在 Google 改了：帶進 App；兩邊都改了：比較晚改的那一邊', () => {
    expect(run({ app: A(c1), remote: R(c0, c0), base: B(c0, c0) }).push).toMatchObject([{ gid, exists: true, c: c1, etag: '"1"' }])
    expect(run({ app: A(c0), remote: R(c1, c0), base: B(c0, c0) }).apply).toMatchObject([{ gid, k: 'e', id: 'e1', op: 'set', c: c1, cur: c0, quiet: false }])
    expect(run({ app: A(c2), remote: R(c1, c0), base: B(c0, c0), appAt: 50 }).apply).toMatchObject([{ op: 'set', c: c1 }])
    expect(run({ app: A(c2), remote: R(c1, c0), base: B(c0, c0), appAt: 500 }).push).toMatchObject([{ c: c2 }])
  })
  it('還沒同步到別台改的（這台的 App 還是舊的）：不把舊的寫回去，照 Google 上別台寫的改（不用說）', () => {
    // 別台把 c0 改成 c1 寫上去了（活動上記著的就是 c1）；這台的 App 和上次對好的都還是 c0
    expect(run({ app: A(c0), remote: R(c1, c1), base: B(c0, c0) }).apply).toMatchObject([{ op: 'set', c: c1, quiet: true }])
  })
  it('還沒同步到別台加的（這台的 App 沒有、也沒對過）：不刪；這台的 App 真的刪了（之前對過）才刪', () => {
    expect(run({ app: new Map(), has: none, remote: R(c0, c0) })).toEqual(nothing)
    expect(run({ app: new Map(), has: none, remote: R(c0, c0), base: B(c0, c0) }).del).toEqual([{ gid, etag: '"1"' }])
    // App 刪了、Google 比較晚改過：留著、帶回 App；App 比較晚：刪
    expect(run({ app: new Map(), has: none, remote: R(c1, c0), base: B(c0, c0), appAt: 50 }).apply).toMatchObject([{ gid, k: 'e', id: 'e1', op: 'add', c: c1 }])
    expect(run({ app: new Map(), has: none, remote: R(c1, c0), base: B(c0, c0), appAt: 500 }).del).toHaveLength(1)
  })
  it('在 Google 刪掉：App 沒改過就跟著刪；App 刪了又撤銷（App 又有了）、App 重新排了：寫回去；兩邊都刪了：記成對好了', () => {
    const gone = R(null, c0, { cancelled: true })
    expect(run({ app: A(c0), remote: gone, base: B(c0, c0) }).apply).toMatchObject([{ gid, op: 'del', c: null }])
    // 這邊刪的（base 記著兩邊都沒有了），之後 App 又有了：寫回去
    expect(run({ app: A(c0), remote: gone, base: B(null, null) }).push).toMatchObject([{ gid, exists: true }])
    expect(run({ app: new Map(), has: none, remote: gone, base: B(c0, c0) }).agree).toEqual([{ gid, s: null, g: null }])
  })
  it('兩邊都沒再改、只是寫法不一樣（Google 上的 App 表示不了）：不來回改', () => {
    const c3 = { ...c0, end: '10:07' }
    expect(run({ app: A(c0), remote: R(c3, c0), base: new Map([[gid, { s: S(c0), g: S(c3) }]]) })).toEqual(nothing)
  })
  it('這台沒對過（剛連上）：用活動上記著的指紋當基準', () => {
    // Google 上是某一台寫的樣子、App 不一樣：比時間（這台的 App 可能是舊的，還沒拿到別台剛寫的那一版）
    expect(run({ app: A(c1), remote: R(c0, c0), appAt: 500 }).push).toHaveLength(1)
    expect(run({ app: A(c1), remote: R(c0, c0), appAt: 50 }).apply).toMatchObject([{ op: 'set', c: c0, quiet: true }])
    expect(run({ app: A(c0), remote: R(c1, c0) }).apply).toMatchObject([{ op: 'set' }])
    expect(run({ app: A(c0), remote: R(null, c0, { cancelled: true }) }).apply).toMatchObject([{ op: 'del' }])
  })
  it('任務只拿掉了時段：Google 那邊比較晚改過的話放回時段；任務刪掉了就從 Google 刪', () => {
    const tg = gidOf('t', 'k1')
    const t0 = { k: 't', title: 'x', date: TODAY, start: '09:00', end: '09:30', done: false, note: '' }
    const t1 = { ...t0, start: '10:00', end: '10:30' }
    const remote = new Map([[tg, { gid: tg, k: 't', hid: 'k1', b: S(t0), c: t1, h: S(t1), date: TODAY, updated: 100, etag: '' }]])
    const base = new Map([[tg, { s: S(t0), g: S(t0) }]])
    expect(plan({ app: new Map(), has: () => true, remote, base, appAt: 50, cut: '' }).apply).toMatchObject([{ gid: tg, k: 't', id: 'k1', op: 'set', c: t1, cur: null }])
    expect(plan({ app: new Map(), has: () => false, remote, base, appAt: 50, cut: '' }).del).toEqual([{ gid: tg, etag: '' }])
  })
  it('在 Google 新增的：帶進 App（gc- 開頭的 id）；重複的、太舊的不帶；帶進來之後補上記號', () => {
    const fg = 'abcde12345'
    const foreign = (extra = {}) => new Map([[fg, { gid: fg, k: 'e', hid: null, b: '', c: c0, h: S(c0), date: TODAY, updated: 100, foreign: true, etag: '', ...extra }]])
    expect(run({ app: new Map(), has: none, remote: foreign() }).apply).toMatchObject([{ gid: fg, k: 'e', id: 'gc-abcde12345', op: 'add', c: c0, quiet: false }])
    expect(run({ app: new Map(), has: none, remote: foreign({ rec: true }) }).apply).toEqual([])
    expect(run({ app: new Map(), has: none, remote: foreign({ date: '2026-01-01' }) }).apply).toEqual([])
    const imported = new Map([[fg, { k: 'e', id: 'gc-abcde12345', c: c0, sig: S(c0), old: false }]])
    expect(run({ app: imported, remote: foreign() }).mark).toMatchObject([{ gid: fg, id: 'gc-abcde12345' }])
  })
  it('App 寫上去的活動在 Google 改成重複的：不動它（App 表示不了重複）；太舊的不管', () => {
    expect(run({ app: A(c1), remote: R(c0, c0, { rec: true }), base: B(c0, c0) })).toEqual(nothing)
    const old = new Map([[gid, { k: 'e', id: 'e1', c: c1, sig: S(c1), old: true }]])
    expect(run({ app: old, remote: R(c0, c0), base: B(c0, c0) })).toEqual(nothing)
  })
})

describe('第二輪審查找到的情境', () => {
  const S = sigOf
  it('混著 Google 的標籤和自己寫的尖括號：只拿掉 Google 的標籤', () => {
    expect(plain('Read <API><br/>Next')).toBe('Read <API>\nNext')
    expect(plain('<p>看 <待確認> 的</p>')).toBe('看 <待確認> 的\n')
  })
  it('跨過午夜照牆上的時間算（日光節約時間結束那天也一樣：15:00～隔天 06:30 是 15.5 小時，不截到午夜）', () => {
    const s = spanOf({ start: { dateTime: '2026-10-31T15:00:00-04:00' }, end: { dateTime: '2026-11-01T06:30:00-05:00' } }, 'America/New_York')
    expect(s).toMatchObject({ date: '2026-10-31', start: '15:00', end: '06:30' })
  })
  it('在 Google 加的整天活動超過 31 天：照 App 的上限（不會以為 App 改短了而寫回去）', () => {
    const r = fromGoogle({ id: 'abcde12345', summary: '長假', start: { date: '2026-12-01' }, end: { date: '2027-01-10' } }, TZ)
    expect(r.c).toMatchObject({ allDay: true, date: '2026-12-01', endDate: '2026-12-31' })
  })
  it('任務的時段在 Google 改成整天、App 已經沒有時段（App 比較晚）：記成對好了，不從 Google 刪', () => {
    const tg = gidOf('t', 'k1')
    const t0 = { k: 't', title: 'x', date: TODAY, start: '09:00', end: '09:30', done: false, note: '' }
    const t1 = { ...t0, start: '', end: '' }
    const remote = new Map([[tg, { gid: tg, k: 't', hid: 'k1', b: S(t0), c: t1, h: S(t1), date: TODAY, updated: 100, etag: '' }]])
    const base = new Map([[tg, { s: S(t0), g: S(t0) }]])
    const out = plan({ app: new Map(), has: () => true, remote, base, appAt: 500, cut: '' })
    expect(out.del).toEqual([])
    expect(out.agree).toEqual([{ gid: tg, s: null, g: S(t1) }])
  })
  it('兩邊都改了：每一筆照自己在 App 改的時間比', () => {
    const c0 = { k: 'e', title: 'a', date: TODAY, start: '09:00', end: '10:00', allDay: false, endDate: '', note: '' }
    const c1 = { ...c0, title: 'google' }
    const c2 = { ...c0, title: 'app' }
    const gid = gidOf('e', 'e1')
    const app = new Map([[gid, { k: 'e', id: 'e1', c: c2, sig: S(c2), old: false }]])
    const remote = new Map([[gid, { gid, k: 'e', hid: 'e1', b: S(c0), c: c1, h: S(c1), date: TODAY, updated: 100, etag: '' }]])
    const base = new Map([[gid, { s: S(c0), g: S(c0) }]])
    expect(plan({ app, has: () => true, remote, base, appAt: (x) => (x === gid ? 50 : 900), cut: '' }).apply).toMatchObject([{ op: 'set', c: c1 }])
    expect(plan({ app, has: () => true, remote, base, appAt: (x) => (x === gid ? 500 : 0), cut: '' }).push).toMatchObject([{ c: c2 }])
  })
  it('Google 上整筆不見了（這台對過、App 沒再改）：App 跟著刪；App 改過的寫回去', () => {
    const c0 = { k: 'e', title: 'a', date: TODAY, start: '09:00', end: '10:00', allDay: false, endDate: '', note: '' }
    const c2 = { ...c0, title: 'app' }
    const gid = gidOf('e', 'e1')
    const base = new Map([[gid, { s: S(c0), g: S(c0) }]])
    const A = (c) => new Map([[gid, { k: 'e', id: 'e1', c, sig: S(c), old: false }]])
    expect(plan({ app: A(c0), has: () => true, remote: new Map(), base, cut: '' }).apply).toMatchObject([{ gid, op: 'del' }])
    expect(plan({ app: A(c2), has: () => true, remote: new Map(), base, cut: '' }).push).toMatchObject([{ gid, exists: false }])
    // 這台沒對過的（剛連上）：寫上去
    expect(plan({ app: A(c0), has: () => true, remote: new Map(), cut: '' }).push).toHaveLength(1)
  })
})
