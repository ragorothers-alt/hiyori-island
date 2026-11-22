import { describe, expect, it } from 'vitest'
import { installSteps } from '../src/boot/pwa.js'

// 瀏覽器沒給安裝的機會、或按過取消了：照瀏覽器寫怎麼安裝成 App
describe('installSteps', () => {
  it('iPhone、Android、電腦的 Chrome／Edge、Firefox、Safari 各自的做法', () => {
    expect(installSteps('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toContain('加入主畫面')
    expect(installSteps('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')).toContain('安裝應用程式')
    expect(installSteps('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toContain('網址列右邊的安裝圖示')
    expect(installSteps('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0')).toContain('Chrome 或 Edge')
    expect(installSteps('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15')).toContain('加入 Dock')
    // iPad 的 Safari 預設裝成 Mac 的樣子：有觸控就是 iPad
    expect(installSteps('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', true)).toContain('加入主畫面')
  })
})
