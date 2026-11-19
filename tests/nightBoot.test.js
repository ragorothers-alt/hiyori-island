import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lookHour, nightAt } from '../src/daylight.js'
import { Store, LOOK_KEY } from '../src/store.js'

// index.html 開頭那段（程式載入之前就決定載入畫面要不要用深色）要跟 daylight.js 算得一樣，不然開機時會先錯一下再換
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const code = html.match(/<script id="nightBoot">([\s\S]*?)<\/script>/)[1]

function boot({ hour, look = null, saved = null, dark = false }) {
  const store = { 'hiyori-look': look, 'hiyori-daily-v1': saved == null ? null : JSON.stringify(saved) }
  const classes = new Set()
  const meta = {}
  const doc = {
    body: { classList: { add: (c) => classes.add(c) } },
    querySelector: () => ({ setAttribute: (k, v) => (meta[k] = v) }),
  }
  const run = new Function('location', 'localStorage', 'matchMedia', 'document', code)
  run({ search: `?hour=${hour}` }, { getItem: (k) => store[k] ?? null }, () => ({ matches: dark }), doc)
  return { night: classes.has('night'), color: meta.content }
}

describe('開機時的夜晚判斷（index.html）', () => {
  it('每個時刻、每種外觀都跟 nightAt(lookHour()) > 0.5 一樣', () => {
    for (const theme of ['auto', 'day', 'night', 'system'])
      for (const dark of [false, true])
        for (let h = 0; h < 24; h += 0.05) {
          const want = nightAt(lookHour(h, theme, dark)) > 0.5
          expect([theme, dark, h, boot({ hour: h, look: theme, dark }).night]).toEqual([theme, dark, h, want])
        }
  })

  it('夜晚時狀態列也換成深色；還沒記外觀時讀存檔，都沒有就跟著時間', () => {
    expect(boot({ hour: 23, look: 'auto' })).toEqual({ night: true, color: '#283667' })
    expect(boot({ hour: 12, look: 'auto' })).toEqual({ night: false, color: undefined })
    expect(boot({ hour: 12, saved: { settings: { theme: 'night' } } }).night).toBe(true)
    expect(boot({ hour: 23, saved: { settings: { theme: 'day' } } }).night).toBe(false)
    expect(boot({ hour: 23 }).night).toBe(true)
  })

  it('改了外觀設定，存檔時另外記一份給下次開機用', () => {
    localStorage.clear()
    const store = new Store()
    store.setSetting('theme', 'night')
    store.flushSave()
    expect(localStorage.getItem(LOOK_KEY)).toBe('night')
    expect(boot({ hour: 12, look: localStorage.getItem(LOOK_KEY) }).night).toBe(true)
  })
})
