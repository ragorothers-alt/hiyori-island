// 瀏覽器端對端測試（e2e/）：用正式建置（Service Worker 只在正式版註冊）測離線和自動更新。
// 測試前 global-setup 會建兩個版本（舊版 a、新版 b），每個測試開自己的伺服器和全新的瀏覽器 context
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.js',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  // 小島用軟體算圖（沒有顯示卡），好幾個同時建會互相拖慢：同時最多跑 3 個（CI 2 個）
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: 'e2e/.out/results',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 860 },
    serviceWorkers: 'allow',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    // 沒有顯示卡的環境（CI）也要能建小島：用軟體算圖
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
  },
  projects: [{ name: 'chromium' }],
})
