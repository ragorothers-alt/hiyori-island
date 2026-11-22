// Service Worker（public/sw.js）：用假的 caches 跑它的事件，檢查更新時的快取搬移和離線首頁
import { describe, expect, it, vi } from 'vitest'
import { FakeCaches, SCOPE, loadSW, run } from './helpers/sw.js'

const html = (h) => new Response(h, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

describe('Service Worker', () => {
  it('更新時：舊快取裡新版還用得到的檔案搬過來，其他的丟掉；別的網站的快取不動', async () => {
    const caches = new FakeCaches()
    const old = await caches.open('hiyori-v1')
    await old.put('assets/three-abc.js', new Response('three'))
    await old.put('assets/islandScene-old.js', new Response('old'))
    await (await caches.open('someone-else')).put('x.js', new Response('x'))
    const on = loadSW({ caches, build: ['assets/three-abc.js', 'assets/index-new.js', 'index.html'] })
    await run(on.activate, {})
    expect(await caches.keys()).toEqual(['someone-else', 'hiyori-new'])
    const cur = await caches.open('hiyori-new')
    expect(await (await cur.match('assets/three-abc.js')).text()).toBe('three')
    expect(await cur.match('assets/islandScene-old.js')).toBeUndefined()
  })

  it('頁面：網路回 404／500 時不存成離線首頁，照樣把回應交給頁面', async () => {
    const caches = new FakeCaches()
    const on = loadSW({ caches, fetch: async () => new Response('not found', { status: 404 }) })
    const req = { method: 'GET', mode: 'navigate', url: SCOPE + 'nope' }
    const res = await run(on.fetch, { request: req })
    expect(res.status).toBe(404)
    await new Promise((r) => setTimeout(r))
    expect(await caches.match('./index.html')).toBeUndefined()
    await (await caches.open('hiyori-new')).put('./assets/index-a.js', new Response('a'))
    const home = '<script type="module" src="./assets/index-a.js"></script>'
    const ok = loadSW({ caches, fetch: async () => html(home) })
    await run(ok.fetch, { request: { ...req, url: SCOPE } })
    await new Promise((r) => setTimeout(r))
    expect(await (await caches.match('./index.html')).text()).toBe(home)
  })

  it('頁面：不是首頁（直接打開 favicon.svg）、不是 HTML、沒有入口檔的（維護頁）都不換掉離線首頁', async () => {
    const caches = new FakeCaches()
    const cur = await caches.open('hiyori-new')
    await cur.put('./index.html', new Response('old home'))
    await cur.put('./assets/index-a.js', new Response('a'))
    const home = '<script type="module" src="./assets/index-a.js"></script>'
    const visit = async (url, res) => {
      await run(loadSW({ caches, fetch: async () => res }).fetch, { request: { method: 'GET', mode: 'navigate', url } })
      await new Promise((r) => setTimeout(r))
    }
    await visit(SCOPE + 'favicon.svg', new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }))
    await visit(SCOPE + 'other.html', html(home))
    await visit(SCOPE, new Response(home, { headers: { 'Content-Type': 'text/plain' } }))
    await visit(SCOPE, html('<h1>維護中</h1><link rel="stylesheet" href="./assets/index-a.css">'))
    expect(await (await cur.match('./index.html')).text()).toBe('old home')
    // 帶著查詢字串、或寫成 index.html 的首頁照樣換
    await visit(SCOPE + 'index.html?hour=10', html(home))
    expect(await (await cur.match('./index.html')).text()).toBe(home)
  })

  it('頁面：網路拿到的首頁要的程式不在這個快取裡（新版還沒裝好、裝失敗）就不換掉離線首頁；都在才換', async () => {
    const caches = new FakeCaches()
    const cur = await caches.open('hiyori-new')
    await cur.put('./index.html', new Response('old home'))
    await cur.put('./assets/index-a.js', new Response('a'))
    const page = (h) => loadSW({ caches, fetch: async () => html(h) })
    const req = { method: 'GET', mode: 'navigate', url: SCOPE }
    const other = '<script type="module" src="./assets/index-b.js"></script><link rel="stylesheet" href="./assets/index-a.css">'
    expect(await (await run(page(other).fetch, { request: req })).text()).toBe(other)
    await new Promise((r) => setTimeout(r))
    expect(await (await cur.match('./index.html')).text()).toBe('old home')
    // 同一版（程式都在快取裡）：換成網路拿到的
    const same = '<script type="module" src="./assets/index-a.js"></script>'
    await run(page(same).fetch, { request: req })
    await new Promise((r) => setTimeout(r))
    expect(await (await cur.match('./index.html')).text()).toBe(same)
  })

  const HTML = '<script type="module" src="./assets/index-new.js"></script><link rel="stylesheet" href="./assets/index-new.css">'
  const fetcher = (fail = null, home = null) => async (u) => {
    const url = String(u)
    if (fail && url.includes(fail)) return new Response('', { status: 404 })
    return url === './' ? html(home ?? HTML) : new Response(`file ${url}`)
  }

  it('安裝：首頁和它用到的入口 JS／CSS 都存進新快取', async () => {
    const f = fetcher()
    const caches = new FakeCaches(f)
    const on = loadSW({ caches, fetch: f })
    await run(on.install, {})
    const cur = await caches.open('hiyori-new')
    expect(await (await cur.match('./index.html')).text()).toBe(HTML)
    expect(await (await cur.match('./assets/index-new.js')).text()).toBe('file ./assets/index-new.js')
    expect(await cur.match('./assets/index-new.css')).toBeTruthy()
  })

  it('安裝：伺服器回的首頁是維護頁（沒有入口的 JS）、不是 HTML：不裝，舊版和舊快取留著', async () => {
    for (const res of ['<h1>維護中</h1>', null]) {
      const f = res ? fetcher(null, res) : async (u) => (String(u) === './' ? new Response(HTML, { headers: { 'Content-Type': 'text/plain' } }) : new Response('x'))
      const caches = new FakeCaches(f)
      await (await caches.open('hiyori-old')).put('./index.html', new Response('old'))
      const on = loadSW({ caches, fetch: f })
      await expect(run(on.install, {})).rejects.toThrow()
      expect(await caches.keys()).toEqual(['hiyori-old'])
    }
  })

  it('安裝：入口 JS 抓不到就讓安裝失敗，舊版和舊快取留著', async () => {
    const f = fetcher('index-new.js')
    const caches = new FakeCaches(f)
    await (await caches.open('hiyori-old')).put('./assets/index-old.js', new Response('old'))
    const on = loadSW({ caches, fetch: f })
    await expect(run(on.install, {})).rejects.toThrow()
    expect(await caches.keys()).toEqual(['hiyori-old'])
  })

  it('點通知：只叫出這個 App 範圍裡的視窗，沒有就打開 App', async () => {
    const focused = []
    const opened = []
    const win = (url) => ({ url, focus: async () => focused.push(url) })
    let list = [win('https://hiyori.test/other-site/'), win(SCOPE + '#tasks')]
    const clients = { matchAll: async () => list, openWindow: async (u) => opened.push(u) }
    const on = loadSW({ caches: new FakeCaches(), clients })
    const event = { notification: { close() {} } }
    await run(on.notificationclick, event)
    expect(focused).toEqual([SCOPE + '#tasks'])
    list = [win('https://hiyori.test/other-site/')]
    await run(on.notificationclick, event)
    expect(opened).toEqual([SCOPE])
  })

  it('點警語通知上的按鈕：按了哪一顆留在快取裡（頁面開好了拿走），叫出開著的視窗時也直接傳過去；網址上不帶（別的網站連不出來）；不認得的按鈕只是打開', async () => {
    const said = []
    const opened = []
    let list = []
    // 有的瀏覽器不讓叫到前面：照樣叫它做
    const win = (url, focus = async () => {}) => ({ url, focus, postMessage: (m) => said.push([url, m]) })
    const clients = { matchAll: async () => list, openWindow: async (u) => opened.push(u) }
    const caches = new FakeCaches()
    const on = loadSW({ caches, clients })
    // data.at：那一則提醒排在幾點（推播顯示的、頁面自己發的通知都帶著），留給頁面的回神紀錄認同一則（slot）
    const click = (action, data) => run(on.notificationclick, { action, notification: { close() {}, data } })
    const left = async () => (await (await caches.open('hiyoripush')).match(SCOPE + '__act'))?.json()
    list = [win(SCOPE, async () => { throw new Error('not allowed') })] // prettier-ignore
    await click('pause', { at: 1_800_000_000_000 })
    const first = await left()
    expect(first).toMatchObject({ act: 'pause', id: expect.any(String), at: expect.any(Number), slot: 1_800_000_000_000 })
    await click('focus')
    expect((await left()).slot).toBe(0)
    await click('steal')
    expect(said).toEqual([[SCOPE, { type: 'hiyori-act', act: 'pause', id: first.id, slot: 1_800_000_000_000 }], [SCOPE, expect.objectContaining({ type: 'hiyori-act', act: 'focus', slot: 0 })]])
    expect((await left()).act).toBe('focus')
    list = []
    await click('pause')
    expect((await left()).act).toBe('pause')
    await click('')
    await click('x?y')
    expect(opened).toEqual([SCOPE, SCOPE, SCOPE])
  })
})

const NOW = Date.UTC(2026, 10, 10, 4)
const MIN = 60000
// 假的通知中心：同一個 tag 的新通知換掉舊的。broken：getNotifications 壞掉的瀏覽器。
// windows：開著的頁面 [{ looking, frozen, visibilityState, focused }]。Service Worker 問「正看著嗎」時，
// 醒著的頁面照 looking 回答；frozen（手機鎖著、頁面被凍住）回不了話。visibilityState／focused 是瀏覽器回報的樣子，不該被拿來判斷。
// plans：計時器的那幾則；mottos：警語的那一串；done：警語念到哪一則了（頁面念過的也算）
function setup({ plans, mottos, done, windows = () => [], before = [], broken = null } = {}) {
  const caches = new FakeCaches()
  let list = before.map((tag) => ({ tag, title: 'old' }))
  const alerts = []
  // ctl.broken：showNotification 出錯的瀏覽器
  const ctl = { broken: false }
  const registration = {
    getNotifications: async ({ tag } = {}) => list.filter((n) => !tag || n.tag === tag).map((n) => ({ ...n, close: () => (list = list.filter((x) => x !== n)) })),
    showNotification: async (title, opts) => {
      if (ctl.broken) throw new Error('boom')
      list = [...list.filter((n) => n.tag !== opts.tag), { title, ...opts }]
      if (opts.renotify) alerts.push(title)
    },
  }
  if (broken === 'missing') delete registration.getNotifications
  if (broken === 'throws') registration.getNotifications = () => { throw new Error('nope') } // prettier-ignore
  let on = null
  // Service Worker 跟頁面說「顯示了這一則警語」
  const messages = []
  const page = (w) => ({
    ...w,
    postMessage: (msg) => {
      if (msg?.type === 'hiyori-motto-shown') return messages.push(msg)
      if (w.frozen || msg?.type !== 'hiyori-looking?') return
      queueMicrotask(() => on.message({ data: { type: 'hiyori-looking', id: msg.id, looking: !!(typeof w.looking === 'function' ? w.looking() : w.looking) } }))
    },
  })
  on = loadSW({ caches, registration, clients: { matchAll: async () => windows().map(page) } })
  const put = (name, v) => caches.open('hiyoripush').then((c) => c.put(SCOPE + name, new Response(JSON.stringify(v))))
  const ready = Promise.all([plans === undefined || put('__timer-plan', plans), mottos === undefined || put('__motto-plan', mottos), done === undefined || put('__motto-done', { at: done })])
  const read = async (name) => (await (await caches.open('hiyoripush')).match(SCOPE + name))?.json()
  return {
    on,
    ready,
    put,
    ctl,
    shown: () => list,
    alerts,
    messages,
    marker: () => read('__timer-shown'),
    // 推播送到這台的紀錄（設定裡的「上一則到點通知」、警語卡上的「上一則推播」讀這個）
    log: () => read('__push-log'),
    mottoLog: () => read('__motto-log'),
    done: () => read('__motto-done'),
    caches,
  }
}
const withClock = async (fn) => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
  vi.setSystemTime(NOW)
  try {
    return await fn()
  } finally {
    vi.useRealTimers()
  }
}

// 番茄鐘到點的推播：推播本身沒有內容，要顯示的字是頁面先留在快取裡的（最近幾則）
describe('Service Worker：計時器到點的推播', () => {
  const focus = { at: NOW - 800, title: 'ひより · 專注結束', body: '「練習曲」25 分鐘完成，休息一下吧' }

  it('顯示剛到點那一則的字，tag 帶著到點的時間，並記下「這一次通知過了」', () =>
    withClock(async () => {
      const s = setup({ plans: [focus] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown()).toEqual([expect.objectContaining({ title: focus.title, body: focus.body, tag: `hiyori-focus-${focus.at}`, renotify: true, icon: SCOPE + 'icons/icon-192.png' })])
      expect(s.alerts).toEqual([focus.title])
      expect(await s.marker()).toEqual({ at: focus.at })
    }))

  it('頁面醒著、已經排好下一段：晚幾秒到的推播還是顯示剛到點的那一則，不是還沒到的那一則', () =>
    withClock(async () => {
      const rest = { at: NOW + 5 * MIN, title: 'ひより · 休息結束', body: '' }
      const earlier = { at: NOW - 12 * MIN, title: 'ひより · 休息結束', body: '更早的一次' }
      const s = setup({ plans: [earlier, focus, rest] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => n.title)).toEqual([focus.title])
      // 休息結束那一則到的時候換它
      vi.setSystemTime(rest.at + 1500)
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => `${n.title}|${n.tag}`)).toEqual([`ひより · 休息結束|hiyori-focus-${rest.at}`])
      expect(await s.marker()).toEqual({ at: rest.at })
    }))

  it('找不到對得上的字：還是一定顯示一則通知。頁面留過字的（剛改了排法、取消還沒送到時晚到的）不出聲；連字都沒留（快取被清掉）才出聲', () =>
    withClock(async () => {
      for (const plans of [[], [{ at: NOW + 5 * MIN, title: '還沒到', body: '' }], [{ at: NOW - 40 * MIN, title: '舊的', body: '' }], [{ at: 'x', title: 5 }, null], 'oops', { at: NOW, title: '不是清單' }]) {
        const s = setup({ plans })
        await s.ready
        await run(s.on.push, { data: null })
        expect(s.shown(), JSON.stringify(plans)).toEqual([expect.objectContaining({ title: 'ひより', tag: 'hiyori-quiet', silent: true, renotify: false })])
        expect(s.alerts).toEqual([])
        expect(await s.marker()).toBeUndefined()
      }
      // 只留了警語的字也算
      const motto = setup({ mottos: [] })
      await motto.ready
      await run(motto.on.push, { data: null })
      expect(motto.shown()).toEqual([expect.objectContaining({ tag: 'hiyori-quiet', silent: true })])
      // 什麼都沒留：照一般的字出聲
      const none = setup({})
      await none.ready
      await run(none.on.push, { data: null })
      expect(none.shown()).toEqual([expect.objectContaining({ title: 'ひより · 計時到了', body: '', tag: 'hiyori-focus', renotify: true, silent: false })])
      expect(none.alerts).toEqual(['ひより · 計時到了'])
    }))

  it('上一次到點的通知還留著就收掉，別的通知不動；查不到通知清單的瀏覽器照樣顯示', () =>
    withClock(async () => {
      const s = setup({ plans: [focus], before: [`hiyori-focus-${NOW - 30 * MIN}`, 'event-1'] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => n.tag).sort()).toEqual(['event-1', `hiyori-focus-${focus.at}`])

      for (const broken of ['missing', 'throws']) {
        const b = setup({ plans: [focus], broken, windows: () => [{ looking: true }] })
        await b.ready
        const done = run(b.on.push, { data: null })
        await vi.advanceTimersByTimeAsync(5000)
        await done
        expect(b.alerts, broken).toEqual([focus.title])
      }
    }))

  it('正看著 App：通知幾秒後自己收掉（畫面上已經有提示）；沒在看、或這幾秒內切走了就留著', () =>
    withClock(async () => {
      let looking = true
      const s = setup({ plans: [focus], windows: () => [{ looking: () => looking }] })
      await s.ready
      let done = run(s.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(3000)
      expect(s.shown()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1500)
      await done
      expect(s.shown()).toEqual([])

      // 出來之後 2 秒切到別的 App：留著
      done = run(s.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(2000)
      looking = false
      await vi.advanceTimersByTimeAsync(3000)
      await done
      expect(s.shown()).toHaveLength(1)

      // 好幾個分頁：有一個正看著就算
      const two = setup({ plans: [focus], windows: () => [{ looking: false }, { looking: true }] })
      await two.ready
      done = run(two.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(5000)
      await done
      expect(two.shown()).toEqual([])

      const bg = setup({ plans: [focus], windows: () => [{ looking: false }] })
      await bg.ready
      await run(bg.on.push, { data: null })
      expect(bg.shown()).toHaveLength(1)
    }))

  it('手機鎖著、頁面被凍住：瀏覽器還回報鎖螢幕前「正看著」也不收掉（頁面回不了話就當沒在看）', () =>
    withClock(async () => {
      // Samsung Internet 這類：頁面凍住了，clients 回報的還是鎖螢幕前的樣子
      const s = setup({ plans: [focus], windows: () => [{ visibilityState: 'visible', focused: true, frozen: true }] })
      await s.ready
      const done = run(s.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(10000)
      await done
      expect(s.shown()).toEqual([expect.objectContaining({ title: focus.title, tag: `hiyori-focus-${focus.at}` })])
      expect(await s.log()).toEqual([{ got: NOW, at: focus.at, closed: false }])
    }))

  it('同一則又送來一次：不出聲地再放一次（不會又響一次）', () =>
    withClock(async () => {
      const s = setup({ plans: [focus] })
      await s.ready
      await run(s.on.push, { data: null })
      vi.setSystemTime(NOW + 3000)
      await run(s.on.push, { data: null })
      expect(s.alerts).toEqual([focus.title])
      expect(s.shown()).toEqual([expect.objectContaining({ title: focus.title, tag: `hiyori-focus-${focus.at}`, silent: true, renotify: false })])
      expect((await s.log()).at(-1)).toEqual({ got: NOW + 3000, at: focus.at, closed: false, again: true })
    }))

  it('每一則推播送到的時間都記下來（最近 8 筆）；正看著而收掉的也記著是收掉的', () =>
    withClock(async () => {
      const s = setup({ plans: [focus] })
      await s.ready
      await run(s.on.push, { data: null })
      // 同一則又送來的（again）、對不上字的（at 是 null，不出聲的記成 quiet）也記
      for (let i = 1; i <= 9; i++) {
        vi.setSystemTime(NOW + i * 2 * MIN)
        await run(s.on.push, { data: null })
      }
      const log = await s.log()
      expect(log).toHaveLength(8)
      expect(log.at(0)).toEqual({ got: NOW + 4 * MIN, at: focus.at, closed: false, again: true })
      expect(log.at(-1)).toEqual({ got: NOW + 18 * MIN, at: null, closed: false, quiet: true })
      expect(log.map((x) => x.got)).toEqual(Array.from({ length: 8 }, (_, i) => NOW + (i + 2) * 2 * MIN))

      vi.setSystemTime(NOW)
      const one = setup({ plans: [focus], windows: () => [{ looking: true }] })
      await one.ready
      const d1 = run(one.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(5000)
      await d1
      expect(await one.log()).toEqual([{ got: NOW, at: focus.at, closed: true }])
    }))
})

// 警語的定時提醒：頁面離開時把時間交給伺服器，字留在快取裡（__motto-plan），念到哪一則記在 __motto-done
describe('Service Worker：警語的推播', () => {
  const m = (min, text = `第 ${min} 分的那一句`) => ({ at: NOW + min * MIN, title: 'ひより · 給自己的警語', body: `${text}\n現在該做：寫報告` })
  const focus = { at: NOW - 800, title: 'ひより · 專注結束', body: '25 分鐘完成，休息一下吧' }

  it('通知下面的按鈕：字裡寫著現在該做的那一件才有「開始專注」，「先停 1 小時」都有；不出聲地再放一次的也有。計時器的沒有', () =>
    withClock(async () => {
      const s = setup({ mottos: [{ ...m(0), focus: true }] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown()[0].actions).toEqual([{ action: 'focus', title: '▶ 開始專注' }, { action: 'pause', title: '先停 1 小時' }])
      vi.setSystemTime(NOW + 3000)
      await run(s.on.push, { data: null })
      expect(s.shown()[0]).toMatchObject({ silent: true, actions: [{ action: 'focus' }, { action: 'pause' }] })

      const plain = setup({ mottos: [m(0)] })
      await plain.ready
      await run(plain.on.push, { data: null })
      expect(plain.shown()[0].actions).toEqual([{ action: 'pause', title: '先停 1 小時' }])

      const timer = setup({ plans: [focus] })
      await timer.ready
      await run(timer.on.push, { data: null })
      expect(timer.shown()[0].actions).toBeUndefined()
    }))

  it('到點：顯示那一句（tag 是 motto，跟頁面自己發的一樣），記下念到這一則，也跟開著的頁面說一聲', () =>
    withClock(async () => {
      const s = setup({ mottos: [m(-15), m(0), m(15)], windows: () => [{ looking: false }] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown()).toEqual([expect.objectContaining({ title: 'ひより · 給自己的警語', body: m(0).body, tag: 'motto', renotify: true, silent: false })])
      expect(await s.done()).toEqual({ at: NOW })
      expect(s.messages).toEqual([{ type: 'hiyori-motto-shown', at: NOW }])
      expect(await s.mottoLog()).toEqual([{ got: NOW, at: NOW, closed: false }])
      // 計時器的紀錄（設定裡的「上一則到點通知」）不受影響
      expect(await s.log()).toBeUndefined()
    }))

  it('ふじ在 App 關著時的通知（跟警語排在同一串，fuji: true）：自己的 tag、沒有按鈕、不算進回神紀錄；同一則再來不出聲', () =>
    withClock(async () => {
      const note = { at: NOW + 17000, title: 'ふじ · 今天的安排', body: '今天 3 件事，先做「寫報告」。', fuji: true }
      const s = setup({ mottos: [m(0), note], windows: () => [{ looking: false }] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown()).toEqual([expect.objectContaining({ tag: 'motto' })])
      vi.setSystemTime(NOW + 17000)
      await run(s.on.push, { data: null })
      const fuji = s.shown().find((n) => n.tag === 'fuji')
      expect(fuji).toMatchObject({ title: 'ふじ · 今天的安排', body: note.body, renotify: true, silent: false })
      expect(fuji.actions).toBeUndefined()
      // 警語那一則留著（不同 tag，不會被換掉）
      expect(s.shown().map((n) => n.tag).sort()).toEqual(['fuji', 'motto'])
      expect(await s.done()).toEqual({ at: NOW + 17000 })
      expect(await s.mottoLog()).toEqual([{ got: NOW, at: NOW, closed: false }])
      expect(await (await (await s.caches.open('hiyoripush')).match(SCOPE + '__fuji-log'))?.json()).toEqual([{ got: NOW + 17000, at: NOW + 17000, closed: false }])
      vi.setSystemTime(NOW + 20000)
      await run(s.on.push, { data: null })
      expect(s.shown().find((n) => n.tag === 'fuji')).toMatchObject({ silent: true })
      expect(s.alerts).toEqual(['ひより · 給自己的警語', 'ふじ · 今天的安排'])
    }))

  it('推播晚到、警語和ふじ的那一則都到點了：各自顯示（不會只顯示最晚的那一則，把另一種吞掉）', () =>
    withClock(async () => {
      const note = { at: NOW + 17000, title: 'ふじ · 今天的安排', body: '今天 3 件事', fuji: true }
      const s = setup({ mottos: [m(0), note], windows: () => [{ looking: false }] })
      await s.ready
      vi.setSystemTime(NOW + 40000)
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => n.tag).sort()).toEqual(['fuji', 'motto'])
      expect(s.alerts).toEqual(['ひより · 給自己的警語', 'ふじ · 今天的安排'])
      expect(await s.done()).toEqual({ at: NOW + 17000 })
      expect(await s.mottoLog()).toEqual([{ got: NOW + 40000, at: NOW, closed: false }])
      expect(s.messages).toEqual([{ type: 'hiyori-motto-shown', at: NOW + 17000 }])
    }))

  it('推播晚到、錯過好幾則：只顯示最近的那一則；晚了 10 分鐘以上的不顯示', () =>
    withClock(async () => {
      const s = setup({ mottos: [m(-30), m(-20), m(-10), m(0, '舊'), m(10)] })
      await s.ready
      vi.setSystemTime(NOW + 4 * MIN)
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => n.body.split('\n')[0])).toEqual(['舊'])
      expect(await s.done()).toEqual({ at: NOW })

      // 晚太久的：不出聲地放一則（不是那一句，也不記成念過）
      const late = setup({ mottos: [m(-12)] })
      await late.ready
      await run(late.on.push, { data: null })
      expect(late.shown()).toEqual([expect.objectContaining({ tag: 'hiyori-quiet', silent: true })])
      expect(late.alerts).toEqual([])
      expect(await late.done()).toBeUndefined()
    }))

  it('推播晚到、送到時已經過了就寢時間（頁面排的時候記著那一段醒著到幾點）：不出聲地放、記成念過了，不算進回神紀錄；還沒到就寢的照常出聲', () =>
    withClock(async () => {
      const s = setup({ mottos: [{ ...m(0), sleep: NOW + 3 * MIN }] })
      await s.ready
      vi.setSystemTime(NOW + 5 * MIN)
      await run(s.on.push, { data: null })
      expect(s.shown()).toEqual([expect.objectContaining({ tag: 'motto', body: m(0).body, silent: true, renotify: false })])
      expect(s.alerts).toEqual([])
      expect(await s.done()).toEqual({ at: NOW })
      expect(await s.mottoLog()).toEqual([{ got: NOW + 5 * MIN, at: NOW, closed: false, asleep: true }])

      const ok = setup({ mottos: [{ ...m(0), sleep: NOW + 30 * MIN }] })
      await ok.ready
      await run(ok.on.push, { data: null })
      expect(ok.shown()).toEqual([expect.objectContaining({ tag: 'motto', silent: false, renotify: true })])
      expect(await ok.mottoLog()).toEqual([{ got: NOW + 5 * MIN, at: NOW, closed: false }])
    }))

  it('警語的推播紀錄留最近 150 筆（一整天沒打開 App 也算得回回神紀錄）', () =>
    withClock(async () => {
      const s = setup({ mottos: [m(0)] })
      await s.ready
      await s.put('__motto-log', Array.from({ length: 200 }, (_, i) => ({ got: NOW - (200 - i) * MIN, at: NOW - (200 - i) * MIN, closed: false })))
      await run(s.on.push, { data: null })
      const log = await s.mottoLog()
      expect(log).toHaveLength(150)
      expect(log.at(-1)).toEqual({ got: NOW, at: NOW, closed: false })
    }))

  it('頁面已經念過那一句（取消沒送到、推播還是來了）：不出聲地再放一次，不算新的一則；正看著 App 就幾秒後收掉', () =>
    withClock(async () => {
      const s = setup({ mottos: [m(0)], done: NOW, windows: () => [{ looking: true }] })
      await s.ready
      const d = run(s.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(1000)
      expect(s.shown()).toEqual([expect.objectContaining({ tag: 'motto', silent: true, renotify: false })])
      await vi.advanceTimersByTimeAsync(5000)
      await d
      expect(s.shown()).toEqual([])
      expect(s.alerts).toEqual([])
      expect(s.messages).toEqual([])
      expect(await s.mottoLog()).toEqual([{ got: NOW, at: NOW, closed: true, again: true }])
    }))

  it('新的一句不因為正看著 App 而收掉（看著頁面時頁面自己會念；推播是取消沒送到才來的，收掉就沒人念了）', () =>
    withClock(async () => {
      const s = setup({ mottos: [m(0)], windows: () => [{ looking: true }] })
      await s.ready
      const d = run(s.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(8000)
      await d
      expect(s.shown()).toEqual([expect.objectContaining({ tag: 'motto', silent: false })])
    }))

  it('計時器和警語剛好一起到點：一則推播兩個都顯示；下一則推播兩個都顯示過了，不出聲地放最近的那一則', () =>
    withClock(async () => {
      const s = setup({ plans: [focus], mottos: [m(0)] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => n.tag).sort()).toEqual([`hiyori-focus-${focus.at}`, 'motto'])
      expect(s.alerts).toHaveLength(2)
      vi.setSystemTime(NOW + 2000)
      await run(s.on.push, { data: null })
      expect(s.alerts).toHaveLength(2)
      expect(s.shown().find((n) => n.tag === 'motto')).toMatchObject({ silent: true })
    }))

  it('同一則推播同時送到兩次（兩個 push 一起跑）：只響一次，另一次不出聲', () =>
    withClock(async () => {
      const s = setup({ mottos: [m(0)] })
      await s.ready
      await Promise.all([run(s.on.push, { data: null }), run(s.on.push, { data: null })])
      expect(s.alerts).toEqual(['ひより · 給自己的警語'])
      expect(s.shown()).toEqual([expect.objectContaining({ tag: 'motto', silent: true })])
      expect(await s.done()).toEqual({ at: NOW })
    }))

  it('計時器和警語到點了、都還沒顯示過：不管差多久都一起顯示（伺服器把兩則併成一則送時不會漏掉一個）', () =>
    withClock(async () => {
      // 伺服器的鬧鐘晚了：09:00 的計時器和 09:02 的警語一起送了一則
      const s = setup({ plans: [{ ...focus, at: NOW - 2 * MIN }], mottos: [m(0)] })
      await s.ready
      await run(s.on.push, { data: null })
      expect(s.shown().map((n) => n.tag).sort()).toEqual([`hiyori-focus-${NOW - 2 * MIN}`, 'motto'])
      expect(await s.marker()).toEqual({ at: NOW - 2 * MIN })
      expect(await s.done()).toEqual({ at: NOW })
      // 下一則推播（同一則又送來）：兩個都顯示過了，不出聲
      vi.setSystemTime(NOW + 20_000)
      await run(s.on.push, { data: null })
      expect(s.alerts).toHaveLength(2)
    }))

  it('Service Worker 挑好那一句、還沒記下之前頁面剛好念了：改成不出聲地放（不會畫面上念一次、通知又響一次）', () =>
    withClock(async () => {
      const s = setup({ mottos: [m(0)] })
      await s.ready
      const cache = await s.caches.open('hiyoripush')
      const match = cache.match.bind(cache)
      let reads = 0
      cache.match = async (url) => {
        // 第一次讀「念到哪」之後，頁面寫下念到這一則
        const hit = await match(url)
        if (String(url).endsWith('__motto-done') && ++reads === 1) await cache.put(url, new Response(JSON.stringify({ at: NOW })))
        return hit
      }
      await run(s.on.push, { data: null })
      expect(s.alerts).toEqual([])
      expect(s.shown()).toEqual([expect.objectContaining({ tag: 'motto', silent: true })])
      expect(s.messages).toEqual([])
    }))

  it('通知沒顯示出來（瀏覽器出錯）：「念過了」的記號還原，下一則推播來時照樣顯示', () =>
    withClock(async () => {
      const s = setup({ mottos: [m(0)] })
      await s.ready
      s.ctl.broken = true
      await expect(run(s.on.push, { data: null })).rejects.toThrow('boom')
      expect(Number((await s.done())?.at) || 0).toBe(0)
      expect(s.messages).toEqual([])
      s.ctl.broken = false
      vi.setSystemTime(NOW + 3000)
      await run(s.on.push, { data: null })
      expect(s.alerts).toEqual(['ひより · 給自己的警語'])
      expect(await s.done()).toEqual({ at: NOW })
    }))

  it('舊的那一則等著收掉的時候，同一個 tag 來了新的一則：新的留著（只收自己那一則）', () =>
    withClock(async () => {
      // 頁面已經念過 0 分那一句，推播又來了：不出聲地放，正看著 App，等 4 秒要收掉
      const s = setup({ mottos: [m(0), m(0.1, '新的')], done: NOW, windows: () => [{ looking: true }] })
      await s.ready
      const d1 = run(s.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(3000)
      // 3 秒後新的一句（6 秒那一則）的推播到了
      const d2 = run(s.on.push, { data: null })
      await vi.advanceTimersByTimeAsync(8000)
      await Promise.all([d1, d2])
      expect(s.shown()).toEqual([expect.objectContaining({ tag: 'motto', body: m(0.1, '新的').body, silent: false })])
    }))

  it('字壞掉：照樣顯示一則（不出聲）', () =>
    withClock(async () => {
      for (const mottos of ['oops', [{ at: NOW, title: 3 }], [null]]) {
        const s = setup({ mottos })
        await s.ready
        await run(s.on.push, { data: null })
        expect(s.shown(), JSON.stringify(mottos)).toEqual([expect.objectContaining({ tag: 'hiyori-quiet', silent: true })])
      }
    }))

  it('剛按了「先停一下」、取消還沒送到伺服器時，原本排著的那一則晚到：不出聲（不會在停著的時候響一般的「計時到了」）', () =>
    withClock(async () => {
      // 頁面在 10:00 前一秒停到 11:00：存好的那一串裡已經沒有 10:00（下一則是停完那一刻），10:00 的推播還是來了
      const s = setup({ mottos: [m(60)], done: NOW - 30 * MIN })
      await s.ready
      vi.setSystemTime(NOW + 2000)
      await run(s.on.push, { data: null })
      expect(s.shown()).toEqual([expect.objectContaining({ tag: 'hiyori-quiet', silent: true, renotify: false })])
      expect(s.alerts).toEqual([])
      // 念到哪一則不動（之後停完那一則照常顯示）
      expect(await s.done()).toEqual({ at: NOW - 30 * MIN })
      vi.setSystemTime(NOW + 60 * MIN)
      await run(s.on.push, { data: null })
      expect(s.alerts).toEqual(['ひより · 給自己的警語'])
    }))
})
