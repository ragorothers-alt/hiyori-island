import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lookHour, nightAt } from '../src/daylight.js'
import { Store, LOOK_KEY } from '../src/store.js'

// index.html 開頭那段（程式載入之前就決定載入畫面、狀態列要不要用深色）要跟 daylight.js 算得一樣，不然開機時會先錯一下再換
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const code = html.match(/<script id="nightBoot">([\s\S]*?)<\/script>/)[1]

// look：hiyori-look 的值；rev：存檔版本（hiyori-daily-rev）；saved：存檔；broken：localStorage 一碰就丟錯
function boot({ hour, look = null, rev = 'r1', saved = null, dark = false, broken = false }) {
  const disk = { 'hiyori-look': look, 'hiyori-daily-rev': rev, 'hiyori-daily-v1': saved == null ? null : typeof saved === 'string' ? saved : JSON.stringify(saved) }
  const ls = {
    getItem: (k) => {
      if (broken) throw new Error('SecurityError')
      return disk[k] ?? null
    },
  }
  const attrs = {}
  const meta = {}
  const doc = {
    documentElement: { setAttribute: (k, v) => (attrs[k] = v) },
    querySelector: () => ({ setAttribute: (k, v) => (meta[k] = v) }),
  }
  const run = new Function('location', 'localStorage', 'matchMedia', 'document', code)
  run({ search: hour == null ? '' : `?hour=${hour}` }, ls, () => ({ matches: dark }), doc)
  return { night: 'data-night' in attrs, color: meta.content }
}

describe('開機時的夜晚判斷（index.html）', () => {
  it('在樣式表之前：字型還在下載時狀態列就先換好', () => {
    expect(html.indexOf('id="nightBoot"')).toBeLessThan(html.indexOf('rel="stylesheet"'))
    expect(html).toMatch(/<body>\s*<script>document\.documentElement\.hasAttribute\('data-night'\) && document\.body\.classList\.add\('night'\)<\/script>/)
  })

  it('每個時刻、每種外觀都跟 nightAt(lookHour()) > 0.5 一樣', () => {
    for (const theme of ['auto', 'day', 'night', 'system'])
      for (const dark of [false, true])
        for (let h = 0; h < 24; h += 0.05) {
          const want = nightAt(lookHour(h, theme, dark)) > 0.5
          expect([theme, dark, h, boot({ hour: h, look: `r1|${theme}`, dark }).night]).toEqual([theme, dark, h, want])
        }
  })

  it('夜晚時狀態列也換成深色；外觀的版本跟存檔對不上、還沒記的時候讀存檔；存檔壞了、存不了就跟著時間', () => {
    expect(boot({ hour: 23, look: 'r1|auto' })).toEqual({ night: true, color: '#283667' })
    expect(boot({ hour: 12, look: 'r1|auto' })).toEqual({ night: false, color: undefined })
    // 記的是舊版本的外觀（後來的存檔沒能一起記）：照存檔
    expect(boot({ hour: 12, look: 'r0|day', saved: { settings: { theme: 'night' } } }).night).toBe(true)
    expect(boot({ hour: 23, saved: { settings: { theme: 'day' } } }).night).toBe(false)
    // 沒有存檔（範例島）：剩下的外觀不算數，跟著時間
    expect(boot({ hour: 12, look: '|night', rev: null }).night).toBe(false)
    expect(boot({ hour: 23 }).night).toBe(true)
    expect(boot({ hour: 23, look: 'r0|day', saved: '{壞掉' }).night).toBe(true)
    expect(boot({ hour: 23, broken: true }).night).toBe(true)
    expect(boot({ hour: 12, broken: true }).night).toBe(false)
  })

  it('沒帶 ?hour= 時照現在的時間（含秒）', () => {
    const d = new Date()
    const want = nightAt(lookHour(d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600, 'auto')) > 0.5
    expect(boot({ hour: null, look: 'r1|auto' }).night).toBe(want)
  })

  it('改了外觀設定，存檔時連同存檔版本另外記一份給下次開機用', () => {
    localStorage.clear()
    const store = new Store()
    store.setSetting('theme', 'night')
    store.flushSave()
    const look = localStorage.getItem(LOOK_KEY)
    expect(look).toBe(`${store.state.rev}|night`)
    expect(boot({ hour: 12, look, rev: localStorage.getItem('hiyori-daily-rev') }).night).toBe(true)
  })
})
