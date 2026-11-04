// 事件目錄（src/events.js）：掃過原始碼，發的和聽的名字都要在目錄裡，目錄裡的也都真的有人發
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { EVENTS } from '../src/events.js'
import { Store } from '../src/store.js'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []
})
const read = (p) => readFileSync(p, 'utf8')

// store.js 發事件的地方：emit('x')、fx.push(['x', …])、_finish([['x', …]])、const fx = [['x', …]]。
// 事件名稱寫在第一個元素：直接寫 'x'，或三元式 cond ? 'x' : 'y'（兩邊都算）
const SITE = /(?:\[\[|\bemit\(|\bpush\(\s*\[)\s*([^\n]*)/g
const LITERAL = /^'(\w+)'/
const TERNARY = /^[^?'\n]*(?:'\w+'[^?'\n]*)?\?\s*'(\w+)'\s*:\s*'(\w+)'/
// 只是把收集好的 [名稱, 內容] 轉發出去的（名字在收集的地方已經掃過）
const RELAY = /^type\s*,\s*payload\)/
function emitted() {
  const out = new Set()
  for (const [, rest] of read(join(SRC, 'store.js')).matchAll(SITE)) {
    const m = rest.match(LITERAL) || rest.match(TERNARY)
    if (m) for (const n of m.slice(1)) out.add(n)
  }
  return out
}
// 各處聽的：store.on('x')、this.store.on('x')
function subscribed() {
  const out = new Map()
  for (const f of files(SRC)) {
    for (const m of read(f).matchAll(/\b(?:store|this\.store)\.on\(\s*'(\w+)'/g)) out.set(m[1], f)
  }
  return out
}

describe('事件目錄', () => {
  it('store 發的每個事件都在目錄裡', () => {
    const missing = [...emitted()].filter((n) => !(n in EVENTS))
    expect(missing).toEqual([])
  })
  it('各處聽的每個事件都在目錄裡（拼錯的名字會在這裡被抓到）', () => {
    const subs = subscribed()
    expect(subs.size).toBeGreaterThan(40)
    const missing = [...subs].filter(([n]) => !(n in EVENTS)).map(([n, f]) => `${n}（${f}）`)
    expect(missing).toEqual([])
  })
  it('store 發事件的寫法都掃得到（名字是算出來的話，拼錯了上面兩條也抓不到）', () => {
    const t = read(join(SRC, 'store.js'))
    // 第一個元素是字串的都算掃得到（中文開頭的是範例資料之類的陣列，不是事件）
    const odd = [...t.matchAll(SITE)].map(([, rest]) => rest.trim()).filter((r) => !r.startsWith("'") && !TERNARY.test(r) && !RELAY.test(r))
    expect(odd).toEqual([])
    // 三元式的兩邊都有算到
    expect(emitted()).toContain('taskAdded')
    expect(emitted()).toContain('eventAdded')
  })
  it('目錄裡的每個事件都真的有人發（沒有留下改名前的舊名字）', () => {
    const sent = emitted()
    expect(Object.keys(EVENTS).filter((n) => !sent.has(n))).toEqual([])
  })
  it('執行時用了不在目錄裡的名字：主控台會說一聲', () => {
    localStorage.clear()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new Store()
    store.on('taskDonne', () => {})
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('taskDonne'))
    warn.mockClear()
    store.on('taskDone', () => {})
    store.addTask({ title: '正常的事件不會說' })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
