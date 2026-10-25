import { describe, it, expect } from 'vitest'
import { Store } from '../src/store.js'

describe('smoke', () => {
  it('建立 Store 會產生種子資料', () => {
    localStorage.clear()
    const s = new Store()
    expect(s.state.tasks.length).toBeGreaterThan(0)
    expect(s.level.level).toBe(1)
  })
})
