import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// ui.js 拆出去的幾組方法用 defineProperties 掛回 UI.prototype：名字跟 ui.js 或另一組一樣的話，後掛的會悄悄蓋掉前一個
// （「找找看」和專案搜尋都叫 _openFound 時，Ctrl+K 打不開專案）
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const SKIP = new Set(['if', 'for', 'while', 'switch', 'catch'])
const names = (src) =>
  [...src.matchAll(/^ {2}(?:async )?(?:get |set )?\*?([_a-zA-Z$][\w$]*)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]).filter((n) => !SKIP.has(n))

describe('ui.js 拆出去的方法', () => {
  it('掛回 UI.prototype 的方法沒有撞名', () => {
    const ui = read('src/ui.js')
    const mixins = [...ui.matchAll(/import \{\s*(\w+Methods)\s*\} from '\.\/ui\/(\w+)\.js'/g)].map((m) => m[2])
    expect(mixins.length).toBeGreaterThanOrEqual(7)
    const owner = new Map(names(ui).map((n) => [n, 'ui.js']))
    const dup = []
    for (const m of mixins) {
      for (const n of new Set(names(read(`src/ui/${m}.js`)))) {
        if (owner.has(n)) dup.push(`${n}：${owner.get(n)} 和 ${m}.js`)
        else owner.set(n, `${m}.js`)
      }
    }
    expect(dup).toEqual([])
  })
})
