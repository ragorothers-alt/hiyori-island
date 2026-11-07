// 專案的快捷搜尋：名稱、目標、里程碑（和底下的細項、備註）、筆記、進度日誌都找（純函式）。
// 空白隔開的幾個字都要在同一個專案裡找得到；不分大小寫和全形半形（打 app、ＡＰＰ、App 都找得到）
import { esc } from './ui/dom.js'

// 每種地方的名字和分數：名稱裡找到的排最前面
const KIND = {
  name: ['名稱', 100],
  ms: ['里程碑', 40],
  goal: ['目標', 30],
  step: ['細項', 25],
  noteTitle: ['筆記', 20],
  msNote: ['里程碑備註', 15],
  note: ['筆記', 12],
  log: ['進度', 10],
}
const MAX_TERMS = 6

// 比對用的字：全形轉半形、轉小寫（同一段字問很多次：記下來，打一個字就重找一次也不慢）
const cache = new Map()
export function fold(s) {
  const text = String(s ?? '')
  let f = cache.get(text)
  if (f === undefined) {
    if (cache.size > 4000) cache.clear()
    f = text.normalize('NFKC').toLowerCase()
    cache.set(text, f)
  }
  return f
}

// 搜尋框裡的字拆成幾個關鍵字（重複的算一個）
export function queryTerms(q) {
  return [...new Set(fold(q).split(/\s+/).filter(Boolean))].slice(0, MAX_TERMS)
}

function fieldsOf(p) {
  const out = [['name', p.name]]
  for (const m of p.milestones || []) {
    out.push(['ms', m.title])
    for (const s of m.steps || []) out.push(['step', s.title])
    if (m.note) out.push(['msNote', m.note])
  }
  if (p.goal) out.push(['goal', p.goal])
  for (const n of p.notes || []) {
    if (n.title) out.push(['noteTitle', n.title])
    if (n.body) out.push(['note', n.body])
  }
  for (const l of p.logs || []) if (l.text) out.push(['log', l.text])
  return out.map(([kind, text]) => ({ kind, text, f: fold(text), w: KIND[kind][1] }))
}

// 找專案：回傳 [{ p, score, hit }]，分數高的在前，同分照原本的順序；沒打字回傳 null。
// hit：名稱以外的哪裡找到的（{ kind: '里程碑', text: 截出來的一段 }）；名稱就全部找到了是 null
export function searchProjects(projects, query) {
  const terms = queryTerms(query)
  if (!terms.length) return null
  const whole = terms.join(' ')
  const out = []
  for (const p of projects) {
    const fields = fieldsOf(p)
    let score = 0
    let ok = true
    for (const t of terms) {
      let best = 0
      for (const f of fields) if (f.w > best && f.f.includes(t)) best = f.w
      if (!best) {
        ok = false
        break
      }
      score += best
    }
    if (!ok) continue
    const name = fields[0].f
    // 名稱整個對上、或從開頭就對上：再往前排
    if (name.trim() === whole) score += 100
    else if (name.startsWith(terms[0])) score += 40
    const rest = terms.filter((t) => !name.includes(t))
    let hit = null
    if (rest.length) {
      const has = (f) => rest.filter((t) => f.f.includes(t)).length
      const f = fields.slice(1).reduce((a, b) => (has(b) > has(a) || (has(b) === has(a) && b.w > a.w) ? b : a))
      hit = { kind: KIND[f.kind][0], text: snippet(f.text, rest) }
    }
    out.push({ p, score, hit })
  }
  // Array.prototype.sort 是穩定排序：同分的照傳進來的順序（最近動過的在前）
  return out.sort((a, b) => b.score - a.score)
}

// 一個字一個字轉：記下轉完的每一格是原文的第幾個字（全形轉半形時長度可能不一樣，標記才對得回去）
function charMap(text) {
  const chars = Array.from(text)
  let out = ''
  const from = []
  chars.forEach((c, i) => {
    const f = c.normalize('NFKC').toLowerCase()
    out += f
    for (let k = 0; k < f.length; k++) from.push(i)
  })
  return { chars, out, from }
}

// 每個關鍵字出現的位置（原文的第幾個字到第幾個字，重疊的併起來）
function ranges(map, terms) {
  const r = []
  for (const t of terms) {
    for (let i = map.out.indexOf(t); i >= 0; i = map.out.indexOf(t, i + t.length)) r.push([map.from[i], map.from[i + t.length - 1] + 1])
  }
  r.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged = []
  for (const x of r) {
    const last = merged.at(-1)
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1])
    else merged.push([...x])
  }
  return merged
}

// 從第一個找到的地方前後截一段（換行和多的空白收成一格），太長的頭尾用「…」
export function snippet(text, terms, len = 40) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  const map = charMap(flat)
  const n = map.chars.length
  if (n <= len) return flat
  const first = ranges(map, terms)[0]
  let start = first ? Math.max(0, first[0] - 12) : 0
  const end = Math.min(n, start + len)
  start = Math.max(0, end - len)
  return (start > 0 ? '…' : '') + map.chars.slice(start, end).join('') + (end < n ? '…' : '')
}

// 跳脫 HTML 之後把找到的字包進 <mark>
export function markHTML(text, terms) {
  const s = String(text ?? '')
  if (!terms?.length) return esc(s)
  const map = charMap(s)
  let html = ''
  let at = 0
  for (const [a, b] of ranges(map, terms)) {
    html += esc(map.chars.slice(at, a).join('')) + `<mark>${esc(map.chars.slice(a, b).join(''))}</mark>`
    at = b
  }
  return html + esc(map.chars.slice(at).join(''))
}
