// 共用的測試工具：每個測試有自己的伺服器（site）和全新的瀏覽器 context（Service Worker、localStorage 都是空的）
import { test as base, expect } from '@playwright/test'
import { startServer } from './server.js'

// Google Fonts：每個測試都是全新的 context（沒有快取），整套跑下來要向 Google 要上千次字型；被限流時頁面的 load 事件
// 會卡上一分多鐘（測試在 goto 就逾時）。測試不看字型：給一份空的樣式表，用系統字
export const noFonts = (context) => context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))

export const test = base.extend({
  // 每天第一次打開時貓咪會出來說今日摘要，蓋住畫面：測別的東西時先當成今天看過了（要測它的把 brief 設成 true）
  brief: [false, { option: true }],
  context: async ({ context, brief }, use) => {
    await noFonts(context)
    if (!brief) {
      await context.addInitScript(() => {
        const d = new Date()
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (!localStorage.getItem('hiyori-brief-day')) localStorage.setItem('hiyori-brief-day', JSON.stringify(today))
      })
    }
    // 出現過的提示卡（標題和小字）都記在 window.__toasts：只留幾秒的那幾張，機器忙的時候輪詢可能剛好錯過（見 toastSeen）
    // App 模式畫面下方もち和ふじ說的話也一樣，每一句都記在 window.__chats（開機後的招呼可能緊接著把剛說的那句換掉，見 chatSaid）
    await context.addInitScript(() => {
      window.__toasts = []
      window.__chats = []
      const watch = () => {
        const box = document.getElementById('toasts')
        if (!box) return
        new MutationObserver((list) => {
          for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('toast')) window.__toasts.push(n.textContent.replace(/\s+/g, ' ').trim())
        }).observe(box, { childList: true })
        const chat = document.getElementById('appChat')
        if (!chat) return
        new MutationObserver(() => {
          const t = chat.textContent.replace(/\s+/g, ' ').trim()
          if (t && window.__chats.at(-1) !== t) window.__chats.push(t)
        }).observe(chat, { childList: true, subtree: true, characterData: true })
      }
      if (document.readyState === 'loading') addEventListener('DOMContentLoaded', watch)
      else watch()
    })
    await use(context)
  },
  site: async ({}, use) => {
    const site = await startServer('a')
    await use(site)
    await site.close()
  },
})
export { expect }

// 用 App 模式開（不載入小島）。只在還沒選過時設：測試裡切回小島後，重新整理也照使用者選的
export const useAppMode = (context) =>
  context.addInitScript(() => {
    if (!localStorage.getItem('hiyori-layout')) localStorage.setItem('hiyori-layout', '"app"')
  })

// 有沒有出現過含 text 的提示卡（就算已經收掉了）：只是要確認「有說一聲」的地方用這個，
// 不用 toBeVisible——一口氣來好幾張時，只留幾秒的那張可能在兩次輪詢之間就收掉了
export const toastSeen = (page, text) => expect.poll(() => page.evaluate((t) => (window.__toasts || []).some((x) => x.includes(t)), text)).toBe(true)
// App 模式下方的對話框有沒有說過含 text 的話（就算已經被下一句換掉了）
export const chatSaid = (page, text) => page.evaluate((t) => (window.__chats || []).some((x) => x.includes(t)), text)

// 開機跑完（window.hiyori 有了），而且頁面已經由 Service Worker 接手
// （CI 的機器慢，等久一點）
export async function bootReady(page) {
  await page.waitForFunction(() => !!window.hiyori?.ui, null, { timeout: 90000 })
}
export async function swReady(page) {
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 })
}

// 所有快取裡的網址
export const cachedUrls = (page) =>
  page.evaluate(async () => {
    const out = []
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url)
    return out
  })
export const cacheNames = (page) => page.evaluate(() => caches.keys())

// 這個頁面跑的是哪一版：入口 JS 的檔名
export const entryScript = (page) => page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => /\/assets\/index-/.test(s)) || '')

// 斷網：伺服器連不上，瀏覽器也進入離線狀態
export async function goOffline(site, context) {
  site.setDown(true)
  await context.setOffline(true)
}

// 開機閒下來後，月曆、教練、專案詳情三個延後載入的畫面都載好、收進快取了
export async function viewsCached(page) {
  await expect
    .poll(async () => (await cachedUrls(page)).filter((u) => /\/assets\/(calendar|coach|project)-[^/]+\.js$/.test(u)).length, { timeout: 30000 })
    .toBe(3)
}

// 讓已註冊的 Service Worker 去檢查新版，等新版裝好接手（activated）或裝失敗（redundant）；沒有新版是 'none'
export const checkUpdate = (page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    const found = new Promise((r) => reg.addEventListener('updatefound', () => r(reg.installing), { once: true }))
    await reg.update().catch(() => {})
    const w = await Promise.race([found, new Promise((r) => setTimeout(() => r(null), 5000))])
    if (!w) return 'none'
    const done = () => w.state === 'activated' || w.state === 'redundant'
    if (done()) return w.state
    return new Promise((r) => w.addEventListener('statechange', () => done() && r(w.state)))
  })
