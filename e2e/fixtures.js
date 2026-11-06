// 共用的測試工具：每個測試有自己的伺服器（site）和全新的瀏覽器 context（Service Worker、localStorage 都是空的）
import { test as base, expect } from '@playwright/test'
import { startServer } from './server.js'

export const test = base.extend({
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
