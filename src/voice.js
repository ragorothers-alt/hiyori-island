// 說話用的小工具：挑台詞、填變數、截短名字（開機流程和小島場景都會用到）
import { LINES, FUJI_LINES } from './data/lines.js'

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
export const short = (s, n = 9) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s)
export const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
// who：'mochi' 或 'fuji'，各自用自己的台詞；avoid：不要挑到符合的句子
export function line(key, vars = {}, who = 'mochi', avoid = null) {
  const src = who === 'fuji' ? FUJI_LINES : LINES
  // 'greet.morning'、'season.spring' 這種有點的鍵，往下一層找
  let list = key.split('.').reduce((o, k) => o?.[k], src)
  if (!list?.length) return ''
  const ok = avoid ? list.filter((s) => !avoid.test(s)) : list
  if (ok.length) list = ok
  return fill(pick(list), vars)
}
