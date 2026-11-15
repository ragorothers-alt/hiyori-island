// ひより日和 Service Worker：離線可用 + 提醒通知
// 快取名稱和這次建置的檔案清單，建置時由 vite.config.js 填進來（開發時不註冊 Service Worker，維持原樣）。
// 每次部署換一個新快取：舊快取裡新版還用得到的檔案（例如沒變的 three.js）搬過來，其他的整個丟掉，帶 hash 的舊檔不會一直累積
const VERSION = 'hiyori-v1'
const BUILD = []
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icons/icon-192.png', './icons/icon-512.png']
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']
// 計時器到點的推播：頁面把要顯示的字放在這個快取裡（src/push.js 也寫了一份，要一起改）。
// 名字不能是 hiyori- 開頭：更新時會被當成舊快取清掉
const PLAN_CACHE = 'hiyoripush'
const PLAN_FILE = '__timer-plan'
const SHOWN_FILE = '__timer-shown'
// 最近幾則推播是什麼時候送到這台的 [{ got, at, closed }]：設定裡的「上一則到點通知」讀這個
const LOG_FILE = '__push-log'
// 警語的定時提醒：接下來的那一串 [{ at, title, body }]、念到哪一則了 { at }（頁面念之前也會寫）、推播送到的紀錄
const MOTTO_FILE = '__motto-plan'
const MOTTO_DONE = '__motto-done'
const MOTTO_LOG = '__motto-log'
// 到點晚了這麼久的警語就不顯示了（src/mottos.js 的 MOTTO_LATE，兩邊要一樣）
const MOTTO_LATE = 10 * 60000
// 計時器到點多久以內的字還對得上（推播最晚 10 分鐘後送到）
const TIMER_LATE = 15 * 60000
// 推播送到時問頁面「正看著 App 嗎」，等它回答：問題的 id → 收到回答時叫的函式
const asking = new Map()

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION)
      try {
        // 首頁只抓一次、不經過瀏覽器快取：存起來的首頁和它用到的 JS／CSS 才會是同一版
        const res = await fetch('./', { cache: 'no-store' })
        if (!res.ok) throw new Error(`首頁抓不到（${res.status}）`)
        const html = await res.clone().text()
        await cache.put('./', res.clone())
        await cache.put('./index.html', res)
        // 打包後帶 hash 的入口 JS／CSS 一起快取，第一次安裝後就能離線
        const assets = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => m[1])
        await cache.addAll([...SHELL.filter((f) => f !== './' && f !== './index.html'), ...assets])
      } catch (err) {
        // 有檔案沒抓到就不要裝：舊版繼續用、舊快取也不會被清掉，下次打開再試
        await caches.delete(VERSION)
        throw err
      }
      self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 同一個網域可能還有別的網站（例如 GitHub Pages），只清自己的舊快取
      const cache = await caches.open(VERSION)
      const keep = new Set(BUILD.map((f) => new URL(f, self.registration.scope).href))
      for (const key of await caches.keys()) {
        if (!key.startsWith('hiyori-') || key === VERSION) continue
        // 小島的檔案是第一次看小島時才收的：新版還用得到的先搬過來，更新後離線也還打得開
        const old = await caches.open(key)
        for (const req of await old.keys()) {
          if (!keep.has(req.url) || (await cache.match(req, { ignoreVary: true }))) continue
          const res = await old.match(req)
          if (res) await cache.put(req, res)
        }
        await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // 頁面：網路優先，離線時用快取
  // no-cache：GitHub Pages 讓 HTML 在瀏覽器快取 10 分鐘，不加的話剛部署的新版要等快取過期才拿得到
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          // 404、500 這類錯誤頁不能存成離線用的首頁
          if (res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put('./index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  // 字型：先給快取，背景更新
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req)
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
            return res
          })
          .catch(() => hit)
        return hit || net
      }),
    )
    return
  }

  // 同源靜態檔：快取優先（檔名帶 hash，不會過期）。不看 Vary：有的伺服器回 Vary: Origin，
  // 帶 crossorigin 的 <script>／<link> 和存進快取時的請求 Origin 不同，離線時會對不到
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})

// 頁面已經用到的檔案，請 Service Worker 收進快取（之後離線也能用）。小島（three.js、場景、兩人的模型）是
// 第一次要看時才下載的，那時 Service Worker 可能還沒接手（第一次打開 App），下載的檔案不會經過上面的 fetch，要頁面來說。
// App 模式從沒切回小島的裝置不會送來這些檔案，也就不用下載
self.addEventListener('message', (event) => {
  // 頁面回答「正看著 App 嗎」（src/push.js 的 answerLooking）
  if (event.data?.type === 'hiyori-looking') return asking.get(event.data.id)?.(!!event.data.looking)
  if (event.data?.type !== 'keep' || !Array.isArray(event.data.urls)) return
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION)
      for (const url of event.data.urls) {
        try {
          if (new URL(url).origin !== self.location.origin || (await cache.match(url, { ignoreVary: true }))) continue
          const res = await fetch(url)
          if (res.ok) await cache.put(url, res)
        } catch {}
      }
    })(),
  )
})

// 到點的推播：番茄鐘到點（專注結束、休息結束）、警語的定時提醒。伺服器到點推一則沒有內容的推播過來，
// 手機鎖著、App 被系統暫停、頁面整個關掉時也收得到。
// 要顯示的字是頁面留在快取裡的。這一則是哪一次到點的：已經到點的裡面最近的那一筆——
// 還沒到點的是下一段的（頁面醒著時，推播還沒到就已經排好下一則了）。計時器和警語剛好一起到點就兩則都顯示。
// 都顯示過了（同一則推播送了兩次、頁面已經念過那一句）：不出聲地把最近那一則再放一次；什麼都對不上（取消沒送到伺服器）就顯示一般的字。
// 每一則推播都一定要顯示通知：不顯示的話瀏覽器會自己補一則「網站在背景更新」，iPhone 還會取消這台的訂閱。
// 所以顯示以外的事（讀快取、收掉舊通知、記下顯示過了）各自包起來，哪一步出錯都不擋顯示

// 有沒有頁面醒著、正看著 App：直接問頁面，它自己回答（src/push.js 的 answerLooking）。
// 不看 clients 回報的 visibilityState／focused：手機鎖著時頁面被凍住，有的 Android 瀏覽器還留著鎖螢幕前「正在看」的樣子，
// 照它收掉的話，通知在螢幕暗著時就不見了。凍住的頁面回不了話：等不到回答就當成沒在看
async function looking(ms = 1500) {
  const wins = await self.clients.matchAll({ type: 'window' })
  if (!wins.length) return false
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve) => {
    let left = wins.length
    const done = (v) => {
      asking.delete(id)
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => done(false), ms)
    // 有一個說「正看著」就算；全部都說沒在看就不用等到時間到
    const answer = (v) => (v ? done(true) : --left <= 0 && done(false))
    asking.set(id, answer)
    for (const c of wins) {
      try {
        c.postMessage({ type: 'hiyori-looking?', id })
      } catch {
        answer(false)
      }
    }
  })
}

const fileUrl = (name) => new URL(name, self.registration.scope).href
async function readJSON(cache, name) {
  try {
    const hit = await cache.match(fileUrl(name))
    return hit ? await hit.json() : null
  } catch {
    return null
  }
}
const putJSON = (cache, name, v) => cache.put(fileUrl(name), new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } }))

// 清單裡已經到點（推播早幾秒到、兩邊時鐘差一點也算）、而且還沒晚太久的最後一則
function latestDue(list, now, late) {
  let best = null
  for (const p of Array.isArray(list) ? list : []) {
    const due = p && Number.isFinite(p.at) && typeof p.title === 'string' && p.at <= now + 5000 && now - p.at < late
    if (due && (!best || p.at > best.at)) best = p
  }
  return best
}

// 記下這一則推播什麼時候送到（同一則的第二筆換掉第一筆），留最近 8 筆
async function note(cache, name, entry) {
  try {
    const old = await readJSON(cache, name)
    const list = (Array.isArray(old) ? old : []).filter((x) => x && x.got !== entry.got)
    list.push(entry)
    await putJSON(cache, name, list.slice(-8))
  } catch {}
}

// 好幾則推播同時送到（同一則送了兩次、計時器和警語前後腳）：一則一則來。不然兩邊都在對方記下「顯示過了」之前讀，
// 同一句會響兩次。只排「挑、記、顯示」這一段，後面等著看要不要收掉的那幾秒不擋下一則；哪一則出錯也不擋後面的
let pushQueue = Promise.resolve()

// 挑出這則推播要顯示的、記下顯示過了、顯示出來；回傳 { cache, entries }。
// 推播沒有內容，分不出是計時器還是警語的那一則：到點了、還沒顯示過的都顯示（伺服器剛好一起到點只送一則；
// 計時器那一則晚太久伺服器沒送的話，下一則警語來時跟著出來，晚一點但不會漏）
async function showPush() {
  const reg = self.registration
  const now = Date.now()
  let cache = null
  // 這次要顯示的：計時器、警語（各自只看還沒顯示過的）；都顯示過了的話，最近的那一則（again）
  let timer = null
  let motto = null
  let again = null
  const repeat = (x, tag, log) => {
    if (!again || x.at > again.at) again = { ...x, tag, log }
  }
  // 記號原本是什麼（沒顯示出來時還原）
  let shownBefore = null
  let doneBefore = null
  // 頁面留過要顯示的字嗎（快取裡有計時器或警語的那一份）：有的話，對不上的推播多半是剛改了排法（先停一下、停掉計時、
  // 改了間隔）、取消還沒送到伺服器時晚到的那一則，不出聲地放；連那一份都沒有（快取被清掉了）才照一般的字出聲
  let planned = false
  try {
    cache = await caches.open(PLAN_CACHE)
    const timers = await readJSON(cache, PLAN_FILE)
    const mottos = await readJSON(cache, MOTTO_FILE)
    planned = timers != null || mottos != null
    timer = latestDue(timers, now, TIMER_LATE)
    shownBefore = await readJSON(cache, SHOWN_FILE)
    if (timer && shownBefore?.at === timer.at) {
      repeat(timer, `hiyori-focus-${timer.at}`, LOG_FILE)
      timer = null
    }
    motto = latestDue(mottos, now, MOTTO_LATE)
    doneBefore = await readJSON(cache, MOTTO_DONE)
    if (motto && motto.at <= (Number(doneBefore?.at) || 0)) {
      repeat(motto, 'motto', MOTTO_LOG)
      motto = null
    }
    // 先記下這一次通知過了，再顯示（頁面醒著的話，看了就不用自己再發一次）。
    // 警語寫之前再讀一次：頁面剛好在這之間念了同一句，就改成不出聲地放（不會畫面上念一次、通知又響一次）
    if (timer) await putJSON(cache, SHOWN_FILE, { at: timer.at })
    if (motto) {
      doneBefore = await readJSON(cache, MOTTO_DONE)
      if (Number(doneBefore?.at) >= motto.at) {
        repeat(motto, 'motto', MOTTO_LOG)
        motto = null
      } else await putJSON(cache, MOTTO_DONE, { at: motto.at })
    }
  } catch {}
  const shows = []
  // 同一次到點，頁面自己發的通知也用同一個 tag（計時器：hiyori-focus-到點的時間；警語：motto）
  if (timer) shows.push({ ...timer, tag: `hiyori-focus-${timer.at}`, log: LOG_FILE, kind: 'timer' })
  if (motto) shows.push({ ...motto, tag: 'motto', log: MOTTO_LOG, kind: 'motto', fresh: true })
  if (!shows.length) {
    if (again) shows.push({ ...again, silent: true })
    else if (planned) shows.push({ at: null, title: 'ひより', body: '提醒的時間剛改過，這一則可以略過', tag: 'hiyori-quiet', log: LOG_FILE, silent: true, quiet: true })
    else shows.push({ at: null, title: 'ひより · 計時到了', body: '', tag: 'hiyori-focus', log: LOG_FILE })
  }
  // 上一次到點的通知還留著就收掉，只留最新的
  const focusTag = shows.find((s) => s.tag.startsWith('hiyori-focus'))?.tag
  if (focusTag) {
    try {
      for (const n of await reg.getNotifications()) if (n.tag !== focusTag && String(n.tag).startsWith('hiyori-focus')) n.close()
    } catch {}
  }
  const icon = new URL('icons/icon-192.png', reg.scope).href
  let failed = null
  const out = []
  for (const s of shows) {
    try {
      // data.at：收掉的時候認得出是不是這一則（同一個 tag 的新通知不會被舊的那一次收掉）
      await reg.showNotification(s.title, { body: typeof s.body === 'string' ? s.body : '', tag: s.tag, icon, badge: icon, renotify: !s.silent, silent: !!s.silent, data: { at: s.at } })
      out.push(s)
    } catch (e) {
      // 沒顯示出來：「顯示過了」的記號還原（還是我們寫的那一個才還原），頁面或下一則推播還能顯示
      failed = e
      try {
        if (s.kind === 'timer' && (await readJSON(cache, SHOWN_FILE))?.at === s.at) await putJSON(cache, SHOWN_FILE, shownBefore || {})
        if (s.kind === 'motto' && Number((await readJSON(cache, MOTTO_DONE))?.at) === s.at) await putJSON(cache, MOTTO_DONE, doneBefore || { at: 0 })
      } catch {}
    }
  }
  if (!out.length && failed) throw failed
  // 開著的頁面（在背景、JavaScript 還在跑）馬上知道念到這一則了
  const said = out.find((s) => s.kind === 'motto')
  if (said) {
    try {
      for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'hiyori-motto-shown', at: said.at })
    } catch {}
  }
  const entries = out.map((s) => [s, { got: now, at: s.at, closed: false, ...(s.quiet ? { quiet: true } : s.silent ? { again: true } : {}) }])
  if (cache) for (const [s, e] of entries) await note(cache, s.log, e)
  return { cache, entries }
}

self.addEventListener('push', (event) => {
  const shown = pushQueue.then(showPush)
  pushQueue = shown.catch(() => {})
  event.waitUntil(
    shown.then(async ({ cache, entries }) => {
      const reg = self.registration
      // 正看著 App：畫面上已經有提示卡和音效，計時器的這一則幾秒後自己收掉（那時已經沒在看就留著；有的瀏覽器不讓剛出來的通知馬上收，那就留著）。
      // 新的警語不收：看著頁面時頁面會自己念，推播是取消沒送到才來的，收掉的話這一句就沒人念了。
      // 只收這一次顯示的那一則（data.at 對得上）：等的這幾秒裡同一個 tag 又來了新的一則，那一則留著
      const closable = entries.filter(([s]) => !s.fresh)
      try {
        if (closable.length && (await looking())) {
          await new Promise((r) => setTimeout(r, 4000))
          if (await looking()) {
            for (const [s, e] of closable) {
              for (const n of await reg.getNotifications({ tag: s.tag })) if ((n.data?.at ?? null) === s.at) n.close()
              if (cache) await note(cache, s.log, { ...e, closed: true })
            }
          }
        }
      } catch {}
    }),
  )
})

// 點通知：回到已開啟的視窗，沒有就開新的
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      // 同一個網域下可能還有別的網站（github.io）：只把這個 App 範圍裡的視窗叫到前面
      const scope = self.registration.scope
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const mine = all.find((c) => c.url.startsWith(scope))
      if (mine) return mine.focus()
      return self.clients.openWindow(scope)
    })(),
  )
})
