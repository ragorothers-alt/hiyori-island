// 兩個建置放在哪裡，以及從建置裡讀出來的東西（Service Worker 的快取名稱、入口檔名）
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '.out')
export const OUT = { a: join(ROOT, 'a'), b: join(ROOT, 'b') }

// 這個建置的 Service Worker 快取名稱（vite.config.js 在建置時填進 sw.js）
export function swVersion(tag) {
  const m = readFileSync(join(OUT[tag], 'sw.js'), 'utf8').match(/const VERSION = '([^']+)'/)
  if (!m) throw new Error(`${tag} 版的 sw.js 沒有快取名稱`)
  return m[1]
}

// assets/ 底下符合的檔名，例如 asset('b', /^index-.*\.js$/)
export function asset(tag, re) {
  const f = readdirSync(join(OUT[tag], 'assets')).find((x) => re.test(x))
  if (!f) throw new Error(`${tag} 版找不到 ${re}`)
  return `assets/${f}`
}
