// 自動更新：開著舊版時部署了新版。新的 Service Worker 接手後舊版的檔案就清掉了，
// 舊頁面第一次要載入新的畫面（這裡是從 App 模式切回小島）時會找不到檔案，要換成新版——
// 但不能把打到一半的字刷掉；新版有檔案抓不到時，也不能裝一半就把舊版丟了
import { asset, swVersion } from './builds.js'
import { bootReady, cacheNames, checkUpdate, entryScript, expect, goOffline, swReady, test, useAppMode, viewsCached } from './fixtures.js'

// 用 App 模式開舊版（a），等 Service Worker 接手、延後載入的畫面也收好
async function openOld(page, context, site) {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await swReady(page)
  await viewsCached(page)
  expect(await entryScript(page)).not.toContain('-b.js')
  // 重新整理過就會不見：用來分辨「還是同一個舊頁面」
  await page.evaluate(() => (window.__oldPage = true))
}
// 部署新版（b），等新的 Service Worker 接手；舊版的快取要清掉
async function deployNew(page, site) {
  site.deploy('b')
  expect(await checkUpdate(page)).toBe('activated')
  expect(await cacheNames(page)).toEqual([swVersion('b')])
}
// 舊頁面第一次要看小島（小島的檔案還沒載過）
const openIsland = (page) => page.evaluate(() => document.querySelector('#fullBtn').click())

test('部署了新版：舊頁面要載入新畫面時，自動重新整理換成新版', async ({ page, context, site }) => {
  test.setTimeout(150000)
  await openOld(page, context, site)
  await deployNew(page, site)
  const reloaded = page.waitForEvent('load', { timeout: 20000 })
  await openIsland(page)
  await expect(page.locator('#toasts')).toContainText('有新版本了')
  await reloaded
  await bootReady(page)
  expect(await page.evaluate(() => window.__oldPage)).toBeUndefined()
  expect(await entryScript(page)).toContain('-b.js')
  // 換到新版後切回小島照常載得起來（軟體算圖建小島比較慢，給久一點）
  expect(await page.evaluate(() => window.hiyori.ui.setAppMode(false))).toBe(true)
  expect(await page.evaluate(() => window.hiyori.ui.appMode)).toBe(false)
  await expect(page.locator('#toasts')).not.toContainText('沒有載入成功')
})

test('部署了新版、手上有打到一半的字：不自動重新整理，改成「重新整理」按鈕，按了才換', async ({ page, context, site }) => {
  await openOld(page, context, site)
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await page.locator('#taskTitle').fill('打到一半的任務')
  await deployNew(page, site)
  await openIsland(page)
  const act = page.locator('#toasts .toast-act')
  await expect(act).toBeVisible()
  await expect(page.locator('#toasts')).toContainText('手上還有沒打完的字')
  // 自動重新整理會在 1.2 秒後：多等一下，確定沒有被重新整理、字還在
  await page.waitForTimeout(2500)
  expect(await page.evaluate(() => window.__oldPage)).toBe(true)
  await expect(page.locator('#taskTitle')).toHaveValue('打到一半的任務')

  const reloaded = page.waitForEvent('load', { timeout: 20000 })
  await act.click()
  await reloaded
  await bootReady(page)
  expect(await entryScript(page)).toContain('-b.js')
})

test('新版有檔案下載不到：不裝新版，舊版和舊快取都留著，離線照樣打得開', async ({ page, context, site }) => {
  await openOld(page, context, site)
  // 新版的入口 JS 抓不到（部署到一半、CDN 出錯）
  site.deploy('b', { missing: [asset('b', /^index-.*-b\.js$/)] })
  expect(await checkUpdate(page)).toBe('redundant')
  expect(await cacheNames(page)).toEqual([swVersion('a')])

  await goOffline(site, context)
  await page.reload()
  await bootReady(page)
  expect(await entryScript(page)).not.toContain('-b.js')
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await expect(page.locator('#taskTitle')).toBeVisible()
  await page.locator('body').press('c')
  await expect(page.locator('#calendar')).toBeVisible()
})

test('沒有新版時檢查更新什麼都不動', async ({ page, context, site }) => {
  await openOld(page, context, site)
  expect(await checkUpdate(page)).toBe('none')
  expect(await cacheNames(page)).toEqual([swVersion('a')])
})
