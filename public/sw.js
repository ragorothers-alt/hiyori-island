// ひより日和 Service Worker：離線可用 + 提醒通知
// 快取名稱和這次建置的檔案清單，建置時由 vite.config.js 填進來（開發時不註冊 Service Worker，維持原樣）。
// 每次部署換一個新快取：舊快取裡新版還用得到的檔案（例如沒變的 three.js）搬過來，其他的整個丟掉，帶 hash 的舊檔不會一直累積
const VERSION = 'hiyori-v1'
const BUILD = []
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icons/icon-192.png', './icons/icon-512.png']
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION)
      await cache.addAll(SHELL)
      // 從首頁找出打包後帶 hash 的 JS／CSS 一起快取，第一次安裝後就能離線
      try {
        const html = await (await fetch('./', { cache: 'no-store' })).text()
        const assets = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => m[1])
        await cache.addAll(assets)
      } catch {}
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

// 點通知：回到已開啟的視窗，沒有就開新的
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (all.length) return all[0].focus()
      return self.clients.openWindow('./')
    })(),
  )
})
