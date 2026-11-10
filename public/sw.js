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

// 番茄鐘到點（專注結束、休息結束）：伺服器到點推一則沒有內容的推播過來，手機鎖著、App 被系統暫停時也收得到。
// 要顯示的字是頁面排的時候留在快取裡的（最近幾則）。這一則是哪一次到點的：已經到點的裡面最近的那一筆——
// 還沒到點的是下一段的（頁面醒著時，推播還沒到就已經排好下一則了）。找不到（取消沒送到伺服器）就顯示一般的字。
// 每一則推播都一定要顯示通知：不顯示的話瀏覽器會自己補一則「網站在背景更新」，iPhone 還會取消這台的訂閱。
// 所以顯示以外的事（讀快取、收掉舊通知、記下顯示過了）各自包起來，哪一步出錯都不擋顯示
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const reg = self.registration
      const now = Date.now()
      let cache = null
      let plan = null
      try {
        cache = await caches.open(PLAN_CACHE)
        const hit = await cache.match(new URL(PLAN_FILE, reg.scope).href)
        const list = hit ? await hit.json() : null
        for (const p of Array.isArray(list) ? list : []) {
          const due = p && Number.isFinite(p.at) && typeof p.title === 'string' && p.at <= now + 5000 && now - p.at < 15 * 60000
          if (due && (!plan || p.at > plan.at)) plan = p
        }
      } catch {}
      // 同一次到點，頁面自己發的通知也用這個 tag
      const tag = plan ? `hiyori-focus-${plan.at}` : 'hiyori-focus'
      // 上一次到點的通知還留著就收掉，只留最新的
      try {
        for (const n of await reg.getNotifications()) if (n.tag !== tag && String(n.tag).startsWith('hiyori-focus')) n.close()
      } catch {}
      const icon = new URL('icons/icon-192.png', reg.scope).href
      await reg.showNotification(plan ? plan.title : 'ひより · 計時到了', { body: plan && typeof plan.body === 'string' ? plan.body : '', tag, icon, badge: icon, renotify: true })
      // 記下這一次通知過了：頁面醒著的話，看了就不用自己再發一次
      try {
        if (plan) await cache.put(new URL(SHOWN_FILE, reg.scope).href, new Response(JSON.stringify({ at: plan.at })))
      } catch {}
      // 正看著 App：畫面上已經有提示卡和音效，這一則幾秒後自己收掉（那時已經沒在看就留著；有的瀏覽器不讓剛出來的通知馬上收，那就留著）
      try {
        const looking = async () => (await self.clients.matchAll({ type: 'window' })).some((c) => c.visibilityState === 'visible' && c.focused)
        if (await looking()) {
          await new Promise((r) => setTimeout(r, 4000))
          if (await looking()) for (const n of await reg.getNotifications({ tag })) n.close()
        }
      } catch {}
    })(),
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
