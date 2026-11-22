import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noteError, readErrors, errorDigest, bootFailed } from '../src/errors.js'

const ORIGIN = 'https://hiyori.test'
// 測試環境沒有 DOM：載入畫面用一個假的元素（classList、innerHTML、按鈕）
function fakeLoader() {
  const cls = new Set()
  return {
    classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) },
    innerHTML: '<p>小島甦醒中…</p>',
    addEventListener() {},
    buttons() {
      return [...this.innerHTML.matchAll(/data-boot="(\w+)">([^<]+)</g)].map((m) => m[2])
    },
  }
}
// 自己的程式丟出來的錯誤（stack 指著這個網站的 assets/）
const ours = (msg, Type = Error) => Object.assign(new Type(msg), { stack: `${Type.name}: ${msg}\n    at f (${ORIGIN}/assets/index-abc.js:12:34)` })

// 沒接住的錯誤：只記自己程式的（外掛、別的網站、離線抓不到這類雜訊不算），只有訊息和位置
describe('錯誤紀錄', () => {
  let loader
  beforeEach(() => {
    localStorage.clear()
    loader = fakeLoader()
    vi.stubGlobal('location', { origin: ORIGIN })
    vi.stubGlobal('document', { getElementById: (id) => (id === 'loader' ? loader : null) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('記自己程式的錯誤（訊息、檔名:行號、版本），一樣的只留最新一次，最多 8 筆', () => {
    const err = ours("Cannot read properties of undefined (reading 'at')", TypeError)
    expect(noteError(err, { version: '2026-11-22' })).toEqual({ m: "TypeError: Cannot read properties of undefined (reading 'at')", w: 'index-abc.js:12:34' })
    noteError(err, { version: '2026-11-22' })
    expect(readErrors()).toHaveLength(1)
    for (let i = 0; i < 12; i++) noteError(ours(`第 ${i} 個`))
    expect(readErrors()).toHaveLength(8)
    expect(errorDigest().split('\n')).toHaveLength(5)
  })

  it('不算：外掛、別的網域、離線抓不到、使用者還沒點過不能出聲、取消的請求', () => {
    const ext = new Error('boom')
    ext.stack = 'Error: boom\n    at x (chrome-extension://abc/content.js:1:2)'
    expect(noteError(ext)).toBeNull()
    expect(noteError(new Error('boom'), { file: 'https://evil.example/x.js', line: 3 })).toBeNull()
    expect(noteError(new TypeError('Failed to fetch'))).toBeNull()
    expect(noteError(Object.assign(new Error('play() failed'), { name: 'NotAllowedError' }))).toBeNull()
    expect(noteError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBeNull()
    expect(noteError('ResizeObserver loop completed with undelivered notifications.')).toBeNull()
    expect(readErrors()).toEqual([])
  })

  it('開場就壞掉：載入畫面換成「開不起來」，有重新整理、另存存檔、回報；載入畫面已經收掉就交回去', () => {
    expect(bootFailed(new Error('壞了'), { version: 'v', saveKey: 'k', feedback: 'https://x/new' })).toBe(true)
    expect(loader.classList.contains('failed')).toBe(true)
    expect(loader.buttons()).toEqual(['重新整理', '另存存檔', '回報問題'])
    expect(readErrors().map((x) => x.m)).toEqual(['壞了'])
    loader = fakeLoader()
    loader.classList.add('done')
    expect(bootFailed(new Error('又壞了'))).toBe(false)
  })
})
