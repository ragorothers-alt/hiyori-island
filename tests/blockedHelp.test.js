import { describe, expect, it } from 'vitest'
import { blockedHelp } from '../src/reminders.js'

// 通知被封鎖時的說明：照瀏覽器、是不是從主畫面打開的，說到哪裡改回允許
const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
}

describe('blockedHelp', () => {
  it('電腦的 Chrome、Edge：網址列左邊的圖示（Edge 叫「此網站的權限」）', () => {
    expect(blockedHelp(UA.chrome)).toContain('網站設定')
    expect(blockedHelp(UA.edge)).toContain('此網站的權限')
    expect(blockedHelp(UA.chrome, true)).toContain('應用程式資訊')
  })
  it('Firefox、Safari 各自的地方', () => {
    expect(blockedHelp(UA.firefox)).toContain('傳送通知')
    expect(blockedHelp(UA.safari)).toContain('Safari 選單')
  })
  it('手機：Android 網頁和主畫面的 App、iPhone 主畫面的 App', () => {
    expect(blockedHelp(UA.android)).toContain('權限')
    expect(blockedHelp(UA.android, true)).toContain('長按主畫面')
    expect(blockedHelp(UA.iphone, true)).toContain('「設定」→「通知」')
  })
})
