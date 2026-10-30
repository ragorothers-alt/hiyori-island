import { describe, expect, it } from 'vitest'
import { lookHour, nightAt } from '../src/daylight.js'
import { Store } from '../src/store.js'

describe('外觀：天空顯示的時間', () => {
  it('依時間就是真實時間', () => {
    for (const h of [0, 6, 12, 19.5, 23]) expect(lookHour(h, 'auto')).toBe(h)
  })
  it('白天：白天照常走，其他時間停在早上或傍晚前，而且都是亮的', () => {
    expect(lookHour(12, 'day')).toBe(12)
    expect(lookHour(3, 'day')).toBe(7.5)
    expect(lookHour(21, 'day')).toBe(16.5)
    for (let h = 0; h < 24; h += 0.5) expect(nightAt(lookHour(h, 'day'))).toBeLessThan(0.05)
  })
  it('夜晚：夜裡照常走，白天停在深夜，而且都是暗的', () => {
    expect(lookHour(23, 'night')).toBe(23)
    expect(lookHour(2, 'night')).toBe(2)
    expect(lookHour(9, 'night')).toBe(4.5)
    expect(lookHour(15, 'night')).toBe(21.5)
    for (let h = 0; h < 24; h += 0.5) expect(nightAt(lookHour(h, 'night'))).toBeGreaterThan(0.95)
  })
  it('跟著系統：深色模式當夜晚、淺色當白天', () => {
    expect(lookHour(12, 'system', true)).toBe(lookHour(12, 'night'))
    expect(lookHour(22, 'system', false)).toBe(lookHour(22, 'day'))
  })
  it('真實的白天與夜晚', () => {
    expect(nightAt(12)).toBeLessThan(0.05)
    expect(nightAt(0)).toBeGreaterThan(0.95)
  })
})

describe('外觀設定存檔', () => {
  it('預設依時間，不認得的值會被丟掉', () => {
    localStorage.clear()
    const store = new Store()
    expect(store.state.settings.theme).toBe('auto')
    store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0 }, settings: { theme: 'night' } }))
    expect(store.state.settings.theme).toBe('night')
    store.importJSON(JSON.stringify({ tasks: [], player: { xp: 0 }, settings: { theme: 'purple' } }))
    expect(store.state.settings.theme).toBe('auto')
  })
})
