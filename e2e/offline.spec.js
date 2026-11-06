// 離線：打開過一次之後，沒有網路也要打得開，自己的資料和延後載入的畫面都在
import { asset } from './builds.js'
import { bootReady, cachedUrls, expect, goOffline, swReady, test, useAppMode, viewsCached } from './fixtures.js'

test('App 模式：離線重新打開，任務還在，月曆和教練（延後載入的畫面）也打得開', async ({ page, context, site }) => {
  await useAppMode(context)
  await page.goto(site.url)
  await bootReady(page)
  await swReady(page)
  // 開機閒下來後會先把月曆、教練、專案詳情載好，並請 Service Worker 收進快取
  await viewsCached(page)

  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await page.locator('#taskTitle').fill('離線也要在的任務')
  await page.locator('#taskTitle').press('Enter')
  await expect(page.locator('#taskList')).toContainText('離線也要在的任務')

  await goOffline(site, context)
  await page.reload()
  await bootReady(page)
  expect(await page.evaluate(() => navigator.onLine)).toBe(false)
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await expect(page.locator('#taskList')).toContainText('離線也要在的任務')

  // 離線時新增也照常存下來，再重開一次還在
  await page.locator('#taskTitle').fill('離線時加的')
  await page.locator('#taskTitle').press('Enter')
  await page.reload()
  await bootReady(page)
  await page.evaluate(() => window.hiyori.ui.setTab('tasks'))
  await expect(page.locator('#taskList')).toContainText('離線時加的')

  // 延後載入的畫面從快取來
  await page.locator('body').press('c')
  await expect(page.locator('#calendar')).toBeVisible()
  await page.locator('body').press('Escape')
  await page.evaluate(() => window.hiyori.ui.setTab('coach'))
  await expect(page.locator('#coachRoot')).not.toBeEmpty()
  await expect(page.locator('#toasts')).not.toContainText('還沒下載')
})

test('小島模式：看過一次小島之後，離線重新打開小島照樣建得起來', async ({ page, context, site }) => {
  test.setTimeout(150000)
  await page.goto(site.url)
  await bootReady(page)
  await swReady(page)
  await page.evaluate(() => window.hiyori.ensureIsland())
  // 小島用到的檔案（three.js、場景、模型）由頁面請 Service Worker 收好：等到這頁載過的每個檔案都在快取裡
  const three = asset('a', /^three-.*\.js$/)
  await expect
    .poll(
      async () => {
        const loaded = await page.evaluate(() => {
          const dir = new URL('assets/', location.href).href
          return performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(dir))
        })
        const cached = new Set(await cachedUrls(page))
        return loaded.length > 0 && loaded.every((u) => cached.has(u)) && [...cached].some((u) => u.endsWith(three))
      },
      { timeout: 60000, intervals: [500] },
    )
    .toBe(true)

  await goOffline(site, context)
  await page.reload()
  await bootReady(page)
  expect(await page.evaluate(() => window.hiyori.ui.appMode)).toBe(false)
  // 建得起來：場景物件出來了，也沒有跳「小島沒有載入成功」
  const built = await page.evaluate(async () => {
    const scene = await window.hiyori.ensureIsland()
    return !!scene?.debug?.world
  })
  expect(built).toBe(true)
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.locator('#toasts')).not.toContainText('沒有載入成功')
})
