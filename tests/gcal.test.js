import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../src/store.js'
import { createGcal, gcalExtras, gcalToken, joinExtras, redirectUri } from '../src/gcal.js'
import { fromGoogle, gidOf, GID } from '../src/gcalMap.js'

const TZ = 'Asia/Taipei'
const API = 'https://worker.test'
const CAL = 'cal1@group.calendar.google.com'

// 假的 Google Calendar：events.list 的 syncToken（只給變動的，可以分頁：每一頁都要帶著同一個 syncToken）、
// 刪掉的只剩 id 和狀態（跟真的一樣不一定留著屬性）、用過的 id 再 insert 是 409、沒有的是 404、
// etag（If-Match 對不上回 412）
function fakeGoogle() {
  const g = { cals: new Map(), seq: 0, calls: [], expire: false, worker: [], refreshFail: false, deny401: 0, pageSize: 1000, matches: [], fail412: 0, gate: null }
  const stamp = (ev) => Object.assign(ev, { updated: new Date(Date.now() + ++g.seq).toISOString(), _seq: g.seq, etag: `"${g.seq}"` })
  const out = (ev) => {
    const { _seq, ...rest } = ev
    return ev.status === 'cancelled' ? { id: ev.id, status: 'cancelled', updated: ev.updated, etag: ev.etag } : structuredClone(rest)
  }
  g.cal = (id = CAL) => {
    if (!g.cals.has(id)) g.cals.set(id, new Map())
    return g.cals.get(id)
  }
  g.events = (id = CAL) => [...g.cal(id).values()].filter((e) => e.status !== 'cancelled')
  // 在 Google 網頁上改一筆
  g.edit = (id, patch) => stamp(Object.assign(g.cal().get(id), patch))
  g.remove = (id) => stamp(Object.assign(g.cal().get(id), { status: 'cancelled' }))
  g.add = (ev) => g.cal().set(ev.id, stamp({ status: 'confirmed', ...ev }))
  const res = (status, body) => ({ ok: status < 300, status, json: async () => (body === undefined ? Promise.reject(new Error('no body')) : body) })
  g.fetch = async (url, opts = {}) => {
    if (g.gate) await g.gate
    if (g.offline) throw new TypeError('Failed to fetch')
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    if (url.startsWith(API)) {
      const path = url.slice(API.length)
      g.worker.push(path)
      if (path === '/v1/gcal/config') return res(200, { ok: true, clientId: 'cid.apps.googleusercontent.com', scope: 'https://www.googleapis.com/auth/calendar.app.created' })
      if (path === '/v1/gcal/token') return res(200, { ok: true, access: 'acc0', expires: 3600, refresh: 'ref1' })
      if (path === '/v1/gcal/refresh') return g.refreshFail ? res(401, { error: 'gcal expired' }) : res(200, { ok: true, access: `acc${g.seq}`, expires: 3600 })
      if (path === '/v1/gcal/revoke') return res(200, { ok: true })
      return res(404, { error: 'not found' })
    }
    const u = new URL(url)
    const path = decodeURIComponent(u.pathname.replace('/calendar/v3', ''))
    g.calls.push(`${method} ${path}`)
    const match = opts.headers?.['If-Match']
    if (match) g.matches.push(`${method} ${match}`)
    if (g.deny401 > 0) {
      g.deny401--
      return res(401, { error: { code: 401 } })
    }
    if (method === 'POST' && path === '/calendars') {
      g.cal(CAL)
      return res(200, { id: CAL, summary: body.summary })
    }
    const m = /^\/calendars\/([^/]+)(?:\/events(?:\/([^/]+))?)?$/.exec(path)
    if (!m || !g.cals.has(m[1])) return res(404, { error: { code: 404 } })
    const cal = g.cal(m[1])
    const id = m[2]
    if (!path.includes('/events')) return res(200, { id: m[1] })
    if (!id && method === 'GET') {
      const token = u.searchParams.get('syncToken')
      const pageTok = u.searchParams.get('pageToken')
      if (token && g.expire) {
        g.expire = false
        return res(410, { error: { code: 410 } })
      }
      // 翻頁時查詢條件要跟第一頁一樣
      let from = 0
      if (pageTok) {
        const [tok, at] = pageTok.split('|')
        if (tok !== (token || '')) return res(400, { error: { code: 400 } })
        from = Number(at)
      }
      const all = [...cal.values()].filter((e) => !token || e._seq > Number(token)).sort((a, b) => a._seq - b._seq)
      const items = all.slice(from, from + g.pageSize).map(out)
      const more = from + g.pageSize < all.length
      return res(200, more ? { items, nextPageToken: `${token || ''}|${from + g.pageSize}` } : { items, nextSyncToken: String(g.seq) })
    }
    if (!id && method === 'POST') {
      if (!GID.test(body.id)) return res(400, { error: { code: 400 } })
      if (cal.has(body.id)) return res(409, { error: { code: 409 } })
      const ev = stamp({ ...body, status: body.status || 'confirmed' })
      cal.set(body.id, ev)
      return res(200, out(ev))
    }
    const ev = cal.get(id)
    if (!ev) return res(404, { error: { code: 404 } })
    if (match && (match !== ev.etag || (g.fail412 > 0 && g.fail412--))) return res(412, { error: { code: 412 } })
    if (method === 'GET') return res(200, out(ev))
    // PATCH：只改帶來的欄位（null 是清掉）；刪掉的活動 PATCH 成 confirmed 會回來
    if (method === 'PATCH') {
      const p = body.extendedProperties?.private
      const time = (o, was) => (o ? Object.fromEntries(Object.entries({ ...was, ...o }).filter(([, v]) => v != null)) : was)
      if (ev.status === 'cancelled' && !body.status) return res(404, { error: { code: 404 } })
      Object.assign(ev, body, { start: time(body.start, ev.start), end: time(body.end, ev.end) }, p ? { extendedProperties: { private: { ...(ev.extendedProperties?.private || {}), ...p } } } : {})
      return res(200, out(stamp(ev)))
    }
    if (method === 'DELETE') {
      if (ev.status === 'cancelled') return res(410, { error: { code: 410 } })
      stamp(Object.assign(ev, { status: 'cancelled' }))
      return res(204)
    }
    return res(404, { error: { code: 404 } })
  }
  return g
}

let store
let g
let applied
let sync
const connectHere = () => {
  localStorage.setItem('hiyori-gcal-token', JSON.stringify({ refresh: 'ref1', at: 1 }))
  g.cal(CAL)
  store.setGcal({ cal: CAL, on: true })
}
const byHid = (id, k = 'e') => g.cal().get(gidOf(k, id))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  store = new Store()
  store.importJSON(JSON.stringify({ tasks: [], events: [], player: { xp: 0, coins: 0 } }))
  g = fakeGoogle()
  applied = []
  sync = createGcal(store, { fetcher: g.fetch, api: API, tz: TZ, nav: null, onApplied: (rec) => applied.push(rec) })
})
// 排好的下一次同步（reload、412 之後會排）停掉：不然會在下一個測試裡跑，動到同一個 localStorage
afterEach(async () => {
  g.gate = null
  g.offline = false
  await sync.disconnect()
  localStorage.clear()
})

describe('Google 日曆同步：App → Google', () => {
  it('連上之後：日程、排了時段的任務、截止日各寫一筆；再跑一次什麼都不做；別台（沒有記錄）跑也不會多寫', async () => {
    connectHere()
    const today = store.today
    const e = store.addEvent({ title: '開會', date: today, start: '09:00', end: '10:00' })
    const t = store.addTask({ title: '寫報告', date: today, at: '14:00', dur: 60, due: today })
    await sync.run()
    expect(g.events()).toHaveLength(3)
    expect(byHid(e.id)).toMatchObject({ summary: '開會', start: { dateTime: `${today}T09:00:00`, timeZone: TZ }, reminders: { useDefault: false } })
    expect(byHid(t.id, 't').summary).toBe('寫報告')
    expect(byHid(t.id, 'd').summary).toBe('截止：寫報告')
    expect(sync.status()).toMatchObject({ phase: 'ready', count: 3 })
    const writes = () => g.calls.filter((c) => !c.startsWith('GET')).length
    const n = writes()
    await sync.run()
    expect(writes()).toBe(n)
    // 另一台（還沒有記著 Google 上的樣子）：比完都一樣，不寫
    localStorage.removeItem('hiyori-gcal-cache')
    await sync.run()
    expect(writes()).toBe(n)
    expect(g.events()).toHaveLength(3)
  })
  it('App 改了時間、做完了、刪掉了：Google 跟著改、加 ✓、刪掉', async () => {
    connectHere()
    const today = store.today
    const e = store.addEvent({ title: '開會', date: today, start: '09:00', end: '10:00' })
    const t = store.addTask({ title: '寫報告', date: today, at: '14:00', dur: 60 })
    await sync.run()
    store.updateEvent(e.id, { start: '13:00', end: '14:30' })
    store.toggleTask(t.id)
    await sync.run()
    expect(byHid(e.id).start.dateTime).toBe(`${today}T13:00:00`)
    expect(byHid(t.id, 't').summary).toBe('✓ 寫報告')
    store.deleteEvent(e.id)
    await sync.run()
    expect(byHid(e.id).status).toBe('cancelled')
    expect(applied).toEqual([])
  })
  it('App 刪掉又撤銷（同一個 id 回來了）：寫回 Google，不會當成在 Google 刪掉的', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    const copy = { ...e }
    store.deleteEvent(e.id)
    await sync.run()
    store.state.events.push(copy)
    store.save()
    await sync.run()
    expect(byHid(e.id).status).toBe('confirmed')
    expect(store.state.events.some((x) => x.id === e.id)).toBe(true)
  })
})

describe('Google 日曆同步：在 Google 上加的東西', () => {
  it('在 Google 加了地點、顏色：App 再改這一筆時留著；整天和有時段互換時舊的那種時間清掉', async () => {
    connectHere()
    const today = store.today
    const e = store.addEvent({ title: '開會', date: today, start: '09:00', end: '10:00' })
    await sync.run()
    const id = gidOf('e', e.id)
    g.edit(id, { location: '三樓會議室', colorId: '5' })
    await sync.run()
    store.updateEvent(e.id, { title: '開會（延長）', end: '11:00' })
    await sync.run()
    expect(g.cal().get(id)).toMatchObject({ summary: '開會（延長）', location: '三樓會議室', colorId: '5', end: { dateTime: `${today}T11:00:00` } })
    store.updateEvent(e.id, { allDay: true })
    await sync.run()
    expect(g.cal().get(id).start).toEqual({ date: today })
    store.updateEvent(e.id, { allDay: false, start: '13:00', end: '14:00' })
    await sync.run()
    expect(g.cal().get(id).start).toEqual({ dateTime: `${today}T13:00:00`, timeZone: TZ })
  })
})

describe('Google 日曆同步：Google → App', () => {
  it('在 Google 改了時間和名稱：App 跟著改，說一聲；撤銷後 App 換回來、Google 也改回去', async () => {
    connectHere()
    const today = store.today
    const e = store.addEvent({ title: '開會', date: today, start: '09:00', end: '10:00' })
    await sync.run()
    g.edit(gidOf('e', e.id), { summary: '開會（三樓）', start: { dateTime: `${today}T15:00:00+08:00` }, end: { dateTime: `${today}T16:30:00+08:00` } })
    await sync.run()
    const now = store.state.events.find((x) => x.id === e.id)
    expect(now).toMatchObject({ title: '開會（三樓）', start: '15:00', end: '16:30' })
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ n: 1, titles: ['開會（三樓）'] })
    // 再跑：兩邊一樣了，記號補上，不再帶
    await sync.run()
    expect(applied).toHaveLength(1)
    expect(store.gcalUndo(applied[0])).toBe(1)
    await sync.run()
    expect(store.state.events.find((x) => x.id === e.id)).toMatchObject({ title: '開會', start: '09:00' })
    expect(byHid(e.id)).toMatchObject({ summary: '開會', start: { dateTime: `${today}T09:00:00` } })
    expect(applied).toHaveLength(1)
  })
  it('在 Google 刪掉：App 也刪掉；撤銷後放回來、Google 上也補回去', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '23:00', end: '01:00' })
    expect(store.state.events.filter((x) => x.link)).toHaveLength(2)
    await sync.run()
    expect(g.events()).toHaveLength(1)
    g.remove(gidOf('e', e.id))
    await sync.run()
    expect(store.state.events).toHaveLength(0)
    expect(applied[0]).toMatchObject({ n: 1, dropped: 1 })
    expect(store.gcalUndo(applied[0])).toBe(1)
    expect(store.state.events).toHaveLength(2)
    await sync.run()
    expect(byHid(e.id).status).toBe('confirmed')
    expect(store.state.events).toHaveLength(2)
  })
  it('任務：在 Google 拖了時段，任務的時間和長度跟著改；刪掉時段那一筆，任務留著、只拿掉時段', async () => {
    connectHere()
    const today = store.today
    const t = store.addTask({ title: '寫報告', date: today, at: '14:00', dur: 60, due: today })
    await sync.run()
    const tg = gidOf('t', t.id)
    g.edit(tg, { start: { dateTime: `${today}T16:00:00+08:00` }, end: { dateTime: `${today}T16:45:00+08:00` } })
    await sync.run()
    expect(store.state.tasks.find((x) => x.id === t.id)).toMatchObject({ at: '16:00', dur: 45 })
    g.remove(tg)
    g.remove(gidOf('d', t.id))
    await sync.run()
    expect(store.state.tasks.find((x) => x.id === t.id)).toMatchObject({ title: '寫報告', at: null, due: null })
    // 之後 App 再排時段：寫上去（同一個 id 復活）
    store.updateTask(t.id, { at: '09:00' })
    await sync.run()
    expect(g.cal().get(tg).status).toBe('confirmed')
  })
  it('在這個日曆新增的活動帶進 App（gc- 開頭的 id），補上記號；重複的不帶', async () => {
    connectHere()
    const today = store.today
    await sync.run()
    g.add({ id: 'abcde12345', summary: '看牙醫', start: { dateTime: `${today}T18:00:00+08:00` }, end: { dateTime: `${today}T19:00:00+08:00` } })
    g.add({ id: 'rrrrr11111', summary: '每天跑步', recurrence: ['RRULE:FREQ=DAILY'], start: { dateTime: `${today}T07:00:00+08:00` }, end: { dateTime: `${today}T07:30:00+08:00` } })
    await sync.run()
    expect(store.state.events.find((x) => x.id === 'gc-abcde12345')).toMatchObject({ title: '看牙醫', start: '18:00', end: '19:00' })
    expect(store.state.events).toHaveLength(1)
    expect(g.cal().get('abcde12345').extendedProperties.private).toMatchObject({ hiyori: 'e', hid: 'gc-abcde12345' })
    // App 改了它：寫回同一個活動
    store.updateEvent('gc-abcde12345', { title: '看牙醫（改時間）' })
    await sync.run()
    expect(g.cal().get('abcde12345').summary).toBe('看牙醫（改時間）')
  })
})

describe('Google 日曆同步：授權和出錯', () => {
  it('access token 過期（401）換一把再試；refresh token 不能用了：狀態寫「要重新連接」', async () => {
    connectHere()
    store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    g.deny401 = 1
    await sync.run()
    expect(sync.status().phase).toBe('ready')
    expect(g.worker.filter((p) => p === '/v1/gcal/refresh').length).toBe(2)
    localStorage.removeItem('hiyori-gcal-access')
    g.refreshFail = true
    await sync.run()
    expect(sync.status()).toMatchObject({ phase: 'error', error: 'expired' })
  })
  it('syncToken 太舊（410）：從頭拿一次，照常同步', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    g.expire = true
    store.updateEvent(e.id, { title: '開會 2' })
    await sync.run()
    expect(byHid(e.id).summary).toBe('開會 2')
    expect(sync.status().phase).toBe('ready')
  })
  it('日曆在 Google 上被刪掉了：狀態是 gone', async () => {
    connectHere()
    g.cals.delete(CAL)
    await sync.run()
    expect(sync.status()).toMatchObject({ phase: 'error', error: 'gone' })
  })
  it('沒開、這台沒有授權：不連 Google', async () => {
    await sync.run()
    expect(sync.status().phase).toBe('off')
    store.setGcal({ cal: CAL, on: true })
    await sync.run()
    expect(sync.status().phase).toBe('nokey')
    expect(g.calls).toEqual([])
  })
  it('連接：帶著 PKCE 和 state 去 Google；回來時 state 對得上才換 token、開日曆；中斷：每台都停、撤銷授權', async () => {
    let went = ''
    const nav = { origin: 'https://me.github.io', pathname: '/hiyori-island/index.html', search: '', href: 'https://me.github.io/hiyori-island/', assign: (u) => (went = u) }
    const s = createGcal(store, { fetcher: g.fetch, api: API, tz: TZ, nav })
    // 不是這個分頁發出去的（重新整理、從瀏覽紀錄打開）：不換 token
    expect(await s.finish('?state=wrong&code=c')).toBe(null)
    expect(await s.finish('?state=x')).toBe(null)
    await s.connect()
    const q = new URL(went).searchParams
    expect(q.get('redirect_uri')).toBe('https://me.github.io/hiyori-island/')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('access_type')).toBe('offline')
    const r = await s.finish(`?state=${q.get('state')}&code=c1&scope=x`)
    expect(r).toEqual({ created: true })
    expect(store.state.gcal).toMatchObject({ cal: CAL, on: true })
    expect(gcalToken().refresh).toBe('ref1')
    // 同一個 state 不能再用一次
    expect(await s.finish(`?state=${q.get('state')}&code=c1`)).toBe(null)
    await s.disconnect()
    expect(store.state.gcal.on).toBe(false)
    expect(gcalToken()).toMatchObject({ refresh: '' })
    expect(g.worker.at(-1)).toBe('/v1/gcal/revoke')
    // 再連一次：日曆還在就接著用
    await s.connect()
    const st2 = new URL(went).searchParams.get('state')
    expect(await s.finish(`?state=${st2}&code=c2`)).toEqual({ created: false })
    expect(redirectUri({ origin: 'http://localhost:5300', pathname: '/' })).toBe('http://localhost:5300/')
  })
  it('授權畫面按了取消：說沒有連上', async () => {
    let went = ''
    const nav = { origin: 'https://me.github.io', pathname: '/', search: '', href: 'https://me.github.io/', assign: (u) => (went = u) }
    const s = createGcal(store, { fetcher: g.fetch, api: API, tz: TZ, nav })
    await s.connect()
    const st = new URL(went).searchParams.get('state')
    await expect(s.finish(`?state=${st}&error=access_denied`)).rejects.toMatchObject({ code: 'denied' })
  })
})

describe('Google 日曆的授權跟著線上同步走', () => {
  it('比較新的連接／中斷蓋過舊的；跟ふじ的通行碼放在同一包', () => {
    const got = []
    const x = gcalExtras((on) => got.push(on))
    x.set({ gcal: { refresh: 'r9', at: 50 } })
    expect(gcalToken()).toEqual({ refresh: 'r9', at: 50 })
    x.set({ gcal: { refresh: 'old', at: 10 } })
    expect(gcalToken().refresh).toBe('r9')
    x.set({ gcal: { refresh: '', at: 60 } })
    expect(gcalToken()).toEqual({ refresh: '', at: 60 })
    expect(got).toEqual([true, false])
    const both = joinExtras({ get: () => ({ aiPass: 'p', aiPassAt: 1 }) }, x)
    expect(both.get()).toEqual({ aiPass: 'p', aiPassAt: 1, gcal: { refresh: '', at: 60 } })
  })
})

describe('Google 日曆同步：好幾台、出錯、換掉整份資料', () => {
  it('還沒同步到別台加的（這台的 App 沒有、也沒對過）：不從 Google 刪掉', async () => {
    connectHere()
    const today = store.today
    // 別台加的日程（hid 在這台的 App 裡沒有）
    const other = { k: 'e', title: '別台的日程', date: today, start: '08:00', end: '09:00', allDay: false, endDate: '', note: '' }
    const { toGoogle, sigOf } = await import('../src/gcalMap.js')
    g.add({ id: gidOf('e', 'zz9'), ...toGoogle(other, { id: 'zz9', sig: sigOf(other), tz: TZ }) })
    await sync.run()
    await sync.run()
    expect(g.cal().get(gidOf('e', 'zz9')).status).toBe('confirmed')
    expect(store.state.events).toHaveLength(0)
  })
  it('別台的 App 改了、寫上 Google（這台的 App 還是舊的）：這台照著改，不把舊的寫回去，也不說', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    const id = gidOf('e', e.id)
    const ev = g.cal().get(id)
    // 別台改了名稱寫上去：活動上記著的指紋跟著換成新的
    const next = { ...structuredClone(ev), summary: '開會（別台改的）' }
    const sig = fromGoogle(next, TZ).h
    g.edit(id, { summary: '開會（別台改的）', extendedProperties: { private: { ...ev.extendedProperties.private, sig } } })
    await sync.run()
    expect(store.state.events[0].title).toBe('開會（別台改的）')
    expect(g.cal().get(id).summary).toBe('開會（別台改的）')
    expect(applied).toEqual([])
  })
  it('任務的時段和截止日在 Google 上各改一點：名稱、截止日各照改的那一筆，不會互相蓋回去', async () => {
    connectHere()
    const today = store.today
    const t = store.addTask({ title: '寫報告', date: today, at: '14:00', dur: 60, due: today })
    await sync.run()
    const due = new Date(`${today}T00:00:00`)
    due.setDate(due.getDate() + 3)
    const d3 = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`
    const d4 = new Date(due)
    d4.setDate(d4.getDate() + 1)
    const d4s = `${d4.getFullYear()}-${String(d4.getMonth() + 1).padStart(2, '0')}-${String(d4.getDate()).padStart(2, '0')}`
    g.edit(gidOf('t', t.id), { summary: '寫期末報告' })
    g.edit(gidOf('d', t.id), { start: { date: d3 }, end: { date: d4s } })
    await sync.run()
    expect(store.state.tasks[0]).toMatchObject({ title: '寫期末報告', due: d3, at: '14:00', dur: 60 })
    await sync.run()
    expect(g.cal().get(gidOf('t', t.id)).summary).toBe('寫期末報告')
    expect(g.cal().get(gidOf('d', t.id)).summary).toBe('截止：寫期末報告')
  })
  it('23:40 開始、預估 60 分鐘的任務（Google 上只到午夜）：在 Google 只改名稱，預估的長度不變；挪了時間長度也不變', async () => {
    connectHere()
    const today = store.today
    const t = store.addTask({ title: '睡前讀書', date: today, at: '23:40', dur: 60 })
    await sync.run()
    g.edit(gidOf('t', t.id), { summary: '睡前讀英文' })
    await sync.run()
    expect(store.state.tasks[0]).toMatchObject({ title: '睡前讀英文', at: '23:40', dur: 60 })
    g.edit(gidOf('t', t.id), { start: { dateTime: `${today}T22:00:00+08:00` }, end: { dateTime: `${today}T22:20:00+08:00` } })
    await sync.run()
    expect(store.state.tasks[0]).toMatchObject({ at: '22:00', dur: 60 })
  })
  it('寫上去時帶著 etag；Google 那邊剛被改過（412）：不蓋掉，讀回來再比', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    store.updateEvent(e.id, { title: '開會 2' })
    g.fail412 = 1
    await sync.run()
    expect(g.matches.some((m) => m.startsWith('PATCH "'))).toBe(true)
    expect(sync.status().phase).toBe('ready')
    await sync.run()
    expect(g.cal().get(gidOf('e', e.id)).summary).toBe('開會 2')
  })
  it('Google 上的變動很多（好幾頁）：每一頁都帶著 syncToken，全部拿完才算', async () => {
    connectHere()
    g.pageSize = 2
    const ids = []
    for (let i = 0; i < 5; i++) ids.push(store.addEvent({ title: `日程 ${i}`, date: store.today, start: `0${i + 1}:00`, end: `0${i + 1}:30` }).id)
    await sync.run()
    for (const id of ids) g.edit(gidOf('e', id), { summary: `改過的 ${id}` })
    await sync.run()
    expect(sync.status().phase).toBe('ready')
    expect(store.state.events.map((x) => x.title).sort()).toEqual(ids.map((id) => `改過的 ${id}`).sort())
  })
  it('同步到一半中斷連線：還沒回來的請求回來了也不動 App 的資料', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    g.remove(gidOf('e', e.id))
    let open
    g.gate = new Promise((r) => (open = r))
    const running = sync.run()
    await new Promise((r) => setTimeout(r, 10))
    const done = sync.disconnect()
    g.gate = null
    open()
    await Promise.all([running, done])
    expect(store.state.events).toHaveLength(1)
    expect(sync.status().phase).toBe('off')
  })
  it('授權過期：自己排的同步不再一直試（按「再試一次」照常試）', async () => {
    connectHere()
    g.refreshFail = true
    await sync.run()
    expect(sync.status().error).toBe('expired')
    const n = g.worker.length
    await sync.run({ auto: true })
    expect(g.worker.length).toBe(n)
    await sync.run()
    expect(g.worker.length).toBe(n + 1)
  })
  it('匯入、還原舊的資料（App 少了好幾筆）：不會把 Google 上的那幾筆刪掉', async () => {
    connectHere()
    store.addEvent({ title: 'A', date: store.today, start: '09:00', end: '10:00' })
    store.addEvent({ title: 'B', date: store.today, start: '11:00', end: '12:00' })
    await sync.run()
    store.importJSON(JSON.stringify({ tasks: [], events: [], player: { xp: 0, coins: 0 }, gcal: { cal: CAL, on: true } }))
    await sync.run()
    expect(g.events()).toHaveLength(2)
  })
  it('時間照連上時記下的時區換算（這台在別的時區也一樣）', async () => {
    connectHere()
    store.setGcal({ tz: 'Asia/Tokyo' })
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    expect(byHid(e.id).start).toEqual({ dateTime: `${store.today}T09:00:00`, timeZone: 'Asia/Tokyo' })
    // 讀回來也照東京換：不會以為改過
    await sync.run()
    expect(store.state.events[0].start).toBe('09:00')
    expect(applied).toEqual([])
  })
  it('還沒準備好（開機時線上同步還沒拉完）：先不同步', async () => {
    connectHere()
    let ok = false
    const s = createGcal(store, { fetcher: g.fetch, api: API, tz: TZ, nav: null, ready: () => ok })
    store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await s.run()
    expect(g.calls).toEqual([])
    ok = true
    await s.run()
    expect(g.events()).toHaveLength(1)
  })
})

describe('Google 日曆同步：第二輪審查找到的情境', () => {
  const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
  it('匯入時同步還在跑（拿清單卡住）：舊的那一輪停下來，不刪 Google 上的', async () => {
    connectHere()
    store.addEvent({ title: 'A', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    let open
    g.gate = new Promise((r) => (open = r))
    const running = sync.run()
    await tick()
    store.importJSON(JSON.stringify({ tasks: [], events: [], player: { xp: 0, coins: 0 }, gcal: { cal: CAL, on: true } }))
    g.gate = null
    open()
    await running
    await sync.run()
    expect(g.events()).toHaveLength(1)
    expect(g.calls.some((c) => c.startsWith('DELETE'))).toBe(false)
  })
  it('線上同步拿到別台整份換掉的那一份（回神紀錄的 gen 不一樣）：也從頭比，不刪 Google 上的', async () => {
    connectHere()
    store.addEvent({ title: 'A', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    store.replaceState({ ...structuredClone(store.state), events: [], tallyGen: 'other-gen' }, Date.now() + 1000, { soft: true })
    await sync.run()
    expect(g.events()).toHaveLength(1)
    expect(g.calls.some((c) => c.startsWith('DELETE'))).toBe(false)
  })
  it('任務的時段在 Google 改成整天，這台先拿到別台拿掉時段的任務（App 比較晚改）：不從 Google 刪掉', async () => {
    connectHere()
    const today = store.today
    const t = store.addTask({ title: '寫報告', date: today, at: '14:00', dur: 60 })
    await sync.run()
    const id = gidOf('t', t.id)
    const { addDays } = await import('../src/store/util.js')
    g.edit(id, { start: { date: today }, end: { date: addDays(today, 1) } })
    await tick(20)
    store.updateTask(t.id, { at: null })
    const late = createGcal(store, { fetcher: g.fetch, api: API, tz: TZ, nav: null, now: () => Date.now() + 3600000 })
    await late.run()
    await late.run()
    expect(g.cal().get(id).status).toBe('confirmed')
    expect(g.cal().get(id).start).toEqual({ date: today })
    expect(store.state.tasks[0].at ?? null).toBe(null)
  })
  it('App 的資料存不進去：Google 上改的先不記成對好了（重新打開時 App 還是舊的，再帶一次，不寫回舊的）', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    const id = gidOf('e', e.id)
    g.edit(id, { summary: '開會（改過）' })
    const flush = store.flushSave
    store.flushSave = () => false
    await sync.run()
    store.flushSave = flush
    expect(sync.status().error).toBe('save')
    // 重新打開：存檔裡還是舊的名稱
    store.state.events[0].title = '開會'
    await sync.run()
    expect(store.state.events[0].title).toBe('開會（改過）')
    expect(g.cal().get(id).summary).toBe('開會（改過）')
  })
  it('syncToken 太舊、從頭拿時 Google 上整筆不見了（永久刪掉）：App 跟著刪，不重新加回去', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    g.cal().delete(gidOf('e', e.id))
    g.expire = true
    const n = g.calls.length
    await sync.run()
    expect(store.state.events).toHaveLength(0)
    expect(g.calls.slice(n).some((c) => c.startsWith('POST'))).toBe(false)
    expect(applied).toHaveLength(1)
  })
  it('中斷後，卡住的請求以「連不上」結束：不重建快取、不顯示出錯', async () => {
    connectHere()
    store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    let shut
    g.gate = new Promise((_, rej) => (shut = rej))
    const running = sync.run()
    await tick()
    g.gate = null
    const done = sync.disconnect()
    shut(new TypeError('Failed to fetch'))
    await Promise.all([running, done])
    expect(sync.status().phase).toBe('off')
    expect(localStorage.getItem('hiyori-gcal-cache')).toBe(null)
  })
  it('授權回來、還在開日曆時按了中斷：不接著連上；授權在日曆弄好之前不存', async () => {
    let went = ''
    const nav = { origin: 'https://me.github.io', pathname: '/', search: '', href: 'https://me.github.io/', assign: (u) => (went = u) }
    let open = null
    let held = null
    const fetcher = async (url, o = {}) => {
      if (url.endsWith('/calendars') && o.method === 'POST' && held === null) {
        held = gcalToken().refresh
        await new Promise((r) => (open = r))
      }
      return g.fetch(url, o)
    }
    const s = createGcal(store, { fetcher, api: API, tz: TZ, nav })
    await s.connect()
    const st = new URL(went).searchParams.get('state')
    const fin = s.finish(`?state=${st}&code=c1`)
    while (!open) await tick(5)
    expect(held).toBe('')
    await s.disconnect()
    open()
    expect(await fin).toBe(null)
    expect(store.state.gcal.on).toBe(false)
    expect(gcalToken().refresh).toBe('')
    await tick()
    // 沒用上的那把在 Google 那邊撤銷掉
    expect(g.worker.at(-1)).toBe('/v1/gcal/revoke')
  })
  it('授權回來的網址沒有 state：參數照樣拿掉', async () => {
    const nav = { origin: 'https://me.github.io', pathname: '/', search: '', href: 'https://me.github.io/?code=c9&scope=x' }
    const s = createGcal(store, { fetcher: g.fetch, api: API, tz: TZ, nav })
    const seen = []
    globalThis.history = { state: null, replaceState: (st, t, u) => seen.push(u) }
    try {
      expect(await s.finish('?code=c9&scope=x')).toBe(null)
    } finally {
      delete globalThis.history
    }
    expect(seen).toEqual(['/'])
  })
  it('別台勾了完成、寫上 Google（這台還沒拿到）：不把 Google 上的 ✓ 改回去；拿到之後也不再寫', async () => {
    connectHere()
    const t = store.addTask({ title: '寫報告', date: store.today, at: '14:00', dur: 60 })
    await sync.run()
    const id = gidOf('t', t.id)
    const ev = g.cal().get(id)
    const priv = { ...ev.extendedProperties.private, done: '1' }
    const next = { ...structuredClone(ev), summary: '✓ 寫報告', extendedProperties: { private: priv } }
    g.edit(id, { summary: '✓ 寫報告', extendedProperties: { private: { ...priv, sig: fromGoogle(next, TZ).h } } })
    await sync.run()
    await sync.run()
    expect(g.cal().get(id)).toMatchObject({ summary: '✓ 寫報告', extendedProperties: { private: { done: '1' } } })
    expect(store.state.tasks[0].done).toBe(false)
    // 線上同步把別台勾的完成帶過來了
    store.toggleTask(t.id)
    const n = g.calls.length
    await sync.run()
    expect(g.calls.slice(n).filter((c) => c.startsWith('PATCH'))).toEqual([])
    expect(g.cal().get(id).summary).toBe('✓ 寫報告')
  })
  it('撤銷在 Google 上的改期：往後挪的次數、先做這件也換回來', async () => {
    connectHere()
    const today = store.today
    const { addDays } = await import('../src/store/util.js')
    const tom = addDays(today, 1)
    const t = store.addTask({ title: '寫報告', date: today, at: '14:00', dur: 60 })
    const o = store.addTask({ title: '別件', date: tom })
    store.setFirst(t.id)
    store.setFirst(o.id)
    await sync.run()
    g.edit(gidOf('t', t.id), { start: { dateTime: `${tom}T14:00:00`, timeZone: TZ }, end: { dateTime: `${tom}T15:00:00`, timeZone: TZ } })
    await sync.run()
    const task = () => store.state.tasks.find((x) => x.id === t.id)
    expect(task()).toMatchObject({ date: tom, moved: 1, first: false })
    expect(store.gcalUndo(applied[0])).toBe(1)
    expect(task()).toMatchObject({ date: today, at: '14:00', moved: 0, first: true })
  })
  it('同一個 id 在 Google 上是刪掉的（這台不知道）：PATCH 回來，不會一直 409', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    const id = gidOf('e', e.id)
    g.remove(id)
    localStorage.removeItem('hiyori-gcal-cache')
    // 清單裡看不到刪掉的那一筆（例如刪掉很久了）
    const fetcher = async (url, o = {}) => {
      const r = await g.fetch(url, o)
      if ((o.method || 'GET') !== 'GET' || !url.includes('/events?')) return r
      const j = await r.json()
      return { ...r, json: async () => ({ ...j, items: j.items.filter((x) => x.status !== 'cancelled') }) }
    }
    const s = createGcal(store, { fetcher, api: API, tz: TZ, nav: null })
    await s.run()
    expect(g.cal().get(id).status).toBe('confirmed')
    expect(s.status().phase).toBe('ready')
  })
  it('兩邊都改了同一筆：比的是這一筆在 App 改的時間（之後改了別的不算）', async () => {
    connectHere()
    const a = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    store.updateEvent(a.id, { title: '開會（App）' })
    g.offline = true
    await sync.run()
    expect(sync.status().error).toBe('offline')
    g.offline = false
    await tick(20)
    g.edit(gidOf('e', a.id), { summary: '開會（Google）' })
    await tick(20)
    store.addEvent({ title: '別的', date: store.today, start: '11:00', end: '12:00' })
    await sync.run()
    expect(store.state.events.find((x) => x.id === a.id).title).toBe('開會（Google）')
    expect(g.cal().get(gidOf('e', a.id)).summary).toBe('開會（Google）')
  })
  it('回應的標頭到了、內容卡住：照逾時算（連不上），不會一直等', async () => {
    connectHere()
    const fetcher = async (url, o = {}) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_, rej) => o.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    })
    const s = createGcal(store, { fetcher, api: API, tz: TZ, nav: null, timeout: 30 })
    await s.run()
    expect(s.status()).toMatchObject({ phase: 'error', error: 'offline' })
  })
})

describe('Google 日曆同步：第三輪審查找到的情境', () => {
  const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
  it('App 改完馬上關掉、Google 之後才改、隔一陣子才打開：照 App 真的改的時間比（Google 比較晚就照 Google）', async () => {
    connectHere()
    const a = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    store.updateEvent(a.id, { title: '開會（App）' })
    await tick(20)
    g.edit(gidOf('e', a.id), { summary: '開會（Google）' })
    // 一小時後才打開
    const later = createGcal(store, { fetcher: g.fetch, api: API, tz: TZ, nav: null, now: () => Date.now() + 3600000 })
    await later.run()
    expect(store.state.events[0].title).toBe('開會（Google）')
    expect(g.cal().get(gidOf('e', a.id)).summary).toBe('開會（Google）')
  })
  it('同一筆在 App 又改了一次：照最後那一次的時間比', async () => {
    connectHere()
    const a = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    store.updateEvent(a.id, { title: 'v1' })
    g.offline = true
    await sync.run()
    g.offline = false
    await tick(20)
    g.edit(gidOf('e', a.id), { summary: 'Google 改的' })
    await tick(20)
    store.updateEvent(a.id, { title: 'v2' })
    await sync.run()
    expect(store.state.events[0].title).toBe('v2')
    expect(g.cal().get(gidOf('e', a.id)).summary).toBe('v2')
  })
  it('App 的資料一直存不進去：下一輪也不把對好的記下來（重新打開時不會當成 App 改回去）', async () => {
    connectHere()
    const e = store.addEvent({ title: '開會', date: store.today, start: '09:00', end: '10:00' })
    await sync.run()
    const id = gidOf('e', e.id)
    g.edit(id, { summary: '開會（改過）' })
    const flush = store.flushSave
    store.flushSave = () => false
    await sync.run()
    await sync.run()
    expect(sync.status().error).toBe('save')
    expect(applied).toEqual([])
    store.flushSave = flush
    // 重新打開：存檔裡還是舊的名稱
    store.state.events[0].title = '開會'
    await sync.run()
    expect(store.state.events[0].title).toBe('開會（改過）')
    expect(g.cal().get(id).summary).toBe('開會（改過）')
  })
  it('撤銷 Google 上的改期之前，那件任務已經勾完成了：不換回去', async () => {
    connectHere()
    const today = store.today
    const { addDays } = await import('../src/store/util.js')
    const tom = addDays(today, 1)
    const t = store.addTask({ title: '寫報告', date: today, at: '14:00', dur: 60 })
    await sync.run()
    g.edit(gidOf('t', t.id), { start: { dateTime: `${tom}T14:00:00`, timeZone: TZ }, end: { dateTime: `${tom}T15:00:00`, timeZone: TZ } })
    await sync.run()
    store.toggleTask(t.id)
    expect(store.gcalUndo(applied[0])).toBe(0)
    expect(store.state.tasks[0].date).toBe(tom)
  })
  it('別台的 App 寫上去的（不用說）和在 Google 上改的一起帶：照改的先後，只有在 Google 上改的列進撤銷', () => {
    const t = store.addTask({ title: '寫報告', date: store.today, at: '14:00', dur: 60, due: store.today })
    const slot = { k: 't', title: '寫報告', date: store.today, start: '14:00', end: '15:00', done: false, note: '' }
    const due = { k: 'd', title: '寫報告', date: store.today, done: false, note: '' }
    const rec = store.gcalApply([
      { gid: 'a', k: 't', id: t.id, op: 'set', c: { ...slot, title: '舊名' }, cur: slot, quiet: false, u: 1 },
      { gid: 'b', k: 'd', id: t.id, op: 'set', c: { ...due, title: '新名' }, cur: due, quiet: true, u: 2 },
    ])
    expect(store.state.tasks[0].title).toBe('新名')
    expect(rec).toMatchObject({ n: 1, changed: 2, titles: ['舊名'] })
  })
})
